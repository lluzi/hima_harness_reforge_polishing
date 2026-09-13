#!/usr/bin/env python3
"""Corrected, data-dependent motif selection for a staged finite AES sample.

The independent reader derives each candidate's term as
``len(cells) * len({occurrence.path})`` and counts every physical cell reused across the chosen
candidates as a conflict. This entry therefore treats the task as a budgeted maximum-value set
packing over whatever ``sample.json`` it is handed: candidates are valued only by that reader
formula, and no candidate id, score, cell name, path or absolute location is baked in. Exactly one
file is read (the declared workspace sample) and exactly ``sampleSha256`` plus ``selected`` are
written. The workshop argv's REVISION field is not needed here: this entry *is* the revision-1
algorithm and it derives every decision from the sample bytes.

Search order: several deterministic greedy starts, a local search (add, one-for-one and one-for-two
exchanges), and an exact branch-and-bound whose node count is capped, so the answer is optimal when
the cap is not reached and a measured feasible selection otherwise.
"""
import hashlib
import json
import sys
from itertools import combinations
from pathlib import Path

EXACT_NODE_CAP = 400000
PAIR_SCAN_MAX_ITEMS = 600


def reader_value(candidate):
    """The reader's own per-candidate objective term."""
    return len(candidate["cells"]) * len({item["path"] for item in candidate["occurrences"]})


def build_items(sample):
    items = []
    for candidate in sample["candidates"]:
        items.append(
            {
                "id": candidate["id"],
                "cells": frozenset(candidate["cells"]),
                "value": reader_value(candidate),
            }
        )
    return items


def total_value(items, chosen):
    return sum(items[index]["value"] for index in chosen)


def pick_key(items, chosen):
    return tuple(sorted(items[index]["id"] for index in chosen))


def union_cells(items, chosen):
    used = frozenset()
    for index in chosen:
        used |= items[index]["cells"]
    return used


def greedy(items, budget, key):
    chosen = []
    used = frozenset()
    for index in sorted(range(len(items)), key=key):
        if len(chosen) >= budget:
            break
        if used & items[index]["cells"]:
            continue
        chosen.append(index)
        used |= items[index]["cells"]
    return chosen


def improve(items, chosen, budget):
    """Deterministic local search: add while there is room, then exchange for strict gains."""
    chosen = list(dict.fromkeys(chosen))
    for _ in range(64):
        base = total_value(items, chosen)
        chosen_cells = union_cells(items, chosen)
        if len(chosen) < budget:
            added = False
            for index in range(len(items)):
                if index in chosen or (chosen_cells & items[index]["cells"]):
                    continue
                if items[index]["value"] <= 0:
                    continue
                chosen.append(index)
                chosen_cells |= items[index]["cells"]
                added = True
                if len(chosen) >= budget:
                    break
            if added:
                continue
        best_pick = None
        best_value = base
        for index in list(chosen):
            rest = [other for other in chosen if other != index]
            rest_cells = union_cells(items, rest)
            for swap in range(len(items)):
                if swap in rest or (rest_cells & items[swap]["cells"]):
                    continue
                trial = rest + [swap]
                value = total_value(items, trial)
                if value > best_value:
                    best_value = value
                    best_pick = trial
            if len(rest) + 2 > budget:
                continue
            pool = [
                other
                for other in range(len(items))
                if other not in rest
                and other != index
                and not (rest_cells & items[other]["cells"])
            ]
            if len(pool) > PAIR_SCAN_MAX_ITEMS:
                continue
            for first, second in combinations(pool, 2):
                if items[first]["cells"] & items[second]["cells"]:
                    continue
                trial = rest + [first, second]
                value = total_value(items, trial)
                if value > best_value:
                    best_value = value
                    best_pick = trial
        if best_pick is None or best_value <= base:
            break
        chosen = best_pick
    return chosen


def exact_best(items, budget, node_cap=EXACT_NODE_CAP):
    """Branch and bound over disjoint candidates; returns (pick, completed_within_cap)."""
    count = len(items)
    order = sorted(range(count), key=lambda index: (-items[index]["value"], items[index]["id"]))
    suffix = [0] * (count + 1)
    for position in range(count - 1, -1, -1):
        suffix[position] = suffix[position + 1] + items[order[position]]["value"]
    best = {"value": 0, "pick": []}
    nodes = [0]
    complete = [True]

    def visit(position, remaining, used, chosen, value):
        nodes[0] += 1
        if nodes[0] > node_cap:
            complete[0] = False
            return
        if value > best["value"]:
            best["value"] = value
            best["pick"] = list(chosen)
        if remaining == 0 or position >= count or value + suffix[position] < best["value"]:
            return
        for step in range(position, count):
            if not complete[0]:
                return
            index = order[step]
            if used & items[index]["cells"]:
                continue
            visit(
                step + 1,
                remaining - 1,
                used | items[index]["cells"],
                chosen + (index,),
                value + items[index]["value"],
            )

    visit(0, budget, frozenset(), (), 0)
    return best["pick"], complete[0]


def select(items, budget):
    budget = max(0, min(int(budget), len(items)))
    starts = [
        greedy(items, budget, lambda index: (-items[index]["value"], items[index]["id"])),
        greedy(
            items,
            budget,
            lambda index: (
                -items[index]["value"] / max(1, len(items[index]["cells"])),
                items[index]["id"],
            ),
        ),
        greedy(
            items,
            budget,
            lambda index: (len(items[index]["cells"]), -items[index]["value"], items[index]["id"]),
        ),
        greedy(items, budget, lambda index: items[index]["id"]),
    ]
    best = {"value": -1, "key": None, "pick": []}

    def consider(pick):
        value = total_value(items, pick)
        key = pick_key(items, pick)
        if value > best["value"] or (
            value == best["value"] and best["key"] is not None and key < best["key"]
        ):
            best["value"] = value
            best["key"] = key
            best["pick"] = list(pick)

    for start in starts:
        consider(improve(items, list(start), budget))
    exact_pick, _complete = exact_best(items, budget)
    consider(exact_pick)
    return best["pick"]


def main():
    workspace = Path(sys.argv[1]).resolve()
    sample_path = workspace / "sample.json"
    sample = json.loads(sample_path.read_text(encoding="utf-8"))
    items = build_items(sample)
    chosen = select(items, sample["budget"])
    selection = {
        "sampleSha256": hashlib.sha256(sample_path.read_bytes()).hexdigest(),
        "selected": sorted(items[index]["id"] for index in chosen),
    }
    target = workspace / "selection.json"
    target.write_text(json.dumps(selection, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
