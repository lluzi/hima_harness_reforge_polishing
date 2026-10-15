"""Candidates of earlier Runs on the same case, to start a new Run from (stdlib only).

A Run with Strategy ``warmStart: prior-runs`` looks at the other Run workspaces under the same
workspace root. Only a Run whose case readiness names the same case manifest digest and the same
authority and reference deck digests counts: its candidates were drawn on the same cell under the
same rules. From those Runs' histories it takes the best legal candidates and the best near-misses
(authority-DRC failures only) under *this* Run's Goal; ``judge-original`` then re-judges every one
with this Run's judge before any of them is trusted (a recorded verdict is not evidence under a
newer judge).
"""
from __future__ import annotations

import json
import os

from . import rounds

__all__ = ["prior_runs", "pick"]

_MAX_RUNS = 6


def _read(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def _history(run_dir):
    rows = []
    path = os.path.join(run_dir, "state", "history.jsonl")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        rows.append(json.loads(line))
                    except ValueError:
                        continue
    except OSError:
        pass
    return rows


def _same_case(a, b):
    if not a or not b:
        return False
    if a.get("manifestSha256") != b.get("manifestSha256"):
        return False
    da = ((a.get("options") or {}).get("decks") or {})
    db = ((b.get("options") or {}).get("decks") or {})
    return da.get("authority") == db.get("authority") and da.get("reference") == db.get("reference")


def prior_runs(workspace, readiness, limit=_MAX_RUNS):
    """Sibling Run workspaces of the same case and decks, newest first."""
    workspace = os.path.abspath(workspace)
    root = os.path.dirname(workspace)
    found = []
    try:
        names = os.listdir(root)
    except OSError:
        return []
    for name in names:
        d = os.path.join(root, name)
        if d == workspace or not os.path.isdir(d):
            continue
        other = _read(os.path.join(d, "state", "case-readiness.json"))
        if not _same_case(readiness, other):
            continue
        try:
            mtime = os.path.getmtime(os.path.join(d, "state", "history.jsonl"))
        except OSError:
            continue
        found.append((mtime, d))
    found.sort(reverse=True)
    return [d for _, d in found[:limit]]


def pick(runs, goal_resolved, legal_k=2, near_k=2):
    """The candidates to import: ``[(run_dir, candidate_id, why)]``.

    Up to ``legal_k`` best legal candidates (ranked by :func:`rounds.better` under this Goal) and up
    to ``near_k`` best near-misses (authority-DRC failures only, few single-cell markers, ratio
    below the best legal one), across all ``runs``; a candidate whose GDS file is missing is
    skipped. Recorded values only choose; the re-judge decides.
    """
    legal, near = [], []
    for run in runs:
        rows = [r for r in _history(run)
                if r.get("kind") in ("candidate", "incumbent", "repair") and not r.get("exploratory")]
        rows = [r for r in rows if os.path.exists(os.path.join(run, "cands", str(r.get("id")), "pixel.gds"))]
        for r in rows:
            if rounds.legal(r.get("values", {}), goal_resolved):
                legal.append((run, r))
        for o in rounds.repair_orders(rows, goal_resolved, limit=near_k):
            r = next(x for x in rows if x.get("id") == o["candidate"])
            near.append((run, r))
    chosen = []
    for _ in range(legal_k):
        best = None
        for item in legal:
            if item in chosen:
                continue
            if best is None or rounds.better(item[1].get("values", {}), best[1].get("values", {}),
                                             goal_resolved):
                best = item
        if best is None:
            break
        chosen.append(best)
    out = [(run, r.get("id"), "legal") for run, r in chosen]
    near.sort(key=lambda it: it[1].get("values", {}).get("pixel_ratio_judged_pct") or 1e9)
    seen = {(run, cid) for run, cid, _ in out}
    for run, r in near:
        if len([o for o in out if o[2] == "near-miss"]) >= near_k:
            break
        if (run, r.get("id")) in seen:
            continue
        out.append((run, r.get("id"), "near-miss"))
        seen.add((run, r.get("id")))
    return out
