"""Builder/reader for `mage.layout-snapshot/2`.

`build_snapshot` assembles one snapshot body from a `pla.PlaDocument`, the
rule facts and frame geometry from `rules.py`, bound target rows from
`targets.py`, and a `block_types` map (`rules.read_block_types`). Every
Fit/Pending item gets a lane via `lanes.assign_lane`; a Fit landing in no
scribe band gets `lane: null` and a `warnings` entry.

Pending inventory: the PLA's own `drops` table always contributes (one
pending entry per drop, `placedFlag` kept). When `pending_from_rules` is
true, every `SLFIT` rule item also contributes `setNumMin - placed` more
synthetic pending copies (ids `<base>.<base>#pending-<k>`, `placedFlag:
null`, size from `block_types`) — a Fit with a non-empty `inGroup` (a
Group-placed priority mark) counts toward `placed` the same as an
ordinary Fit. This is meant for a `start` snapshot, which has no `drops`
table yet; an `incumbent`/`candidate` snapshot (whose `drops` table is
MAGE's own accounting) should pass `pending_from_rules=False` so a
dropped item is never double-counted as pending.

Identity: the snapshot carries two independent checks, computed in order.
`id` is the usual Pack-wide artifact digest (`core.digest`, 20 hex) over
the body (with `schema` set to `mage.layout-snapshot/2`, not the
`core.stamp` default `mage.layout-snapshot/1`) before `id` itself exists.
`snapshotSha256` is then a full 64-hex SHA-256 over the canonical body
*including* that `id` (only `snapshotSha256` itself is excluded), so any
later mutation of the body — including a hand-edited `boxDbu` — is caught
by `load_snapshot` recomputing `snapshotSha256` over the stored body.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import core, lanes


def _lane_or_warning(frame, box_dbu, fit_id, warnings):
    lane = lanes.assign_lane(frame, box_dbu)
    if lane is None:
        warnings.append({"code": "no-lane", "id": fit_id})
        return None
    return lane


def _rule_item_or_block_type(base, rule_facts, block_types):
    rule_fact = rule_facts.get(base)
    if rule_fact is not None:
        return base, rule_fact.get("blockType")
    block = block_types.get(base)
    return None, block.get("blockType") if block else None


def build_snapshot(stage, pla_doc, frame, rule_facts, targets, block_types, inputs, pending_from_rules=True):
    warnings = []

    fixed = [{"id": f["id"], "base": f["base"], "boxDbu": f["boxDbu"]} for f in pla_doc["fixed"]]

    targets_by_ct = {}
    for target in targets:
        targets_by_ct.setdefault(tuple(target["ctDbu"]), target["row"])
    groups = []
    for group in pla_doc["groups"]:
        groups.append({
            "groupItem": group["groupItem"],
            "pinstGroup": group["pinstGroup"],
            "targetPointDbu": group["targetPointDbu"],
            "vertSL": group["vertSL"],
            "targetRow": targets_by_ct.get(tuple(group["targetPointDbu"])),
        })

    fits = []
    placed_count_by_base = {}
    for fit in pla_doc["fits"]:
        base = fit["base"]
        placed_count_by_base[base] = placed_count_by_base.get(base, 0) + 1
        rule_item, block_type = _rule_item_or_block_type(base, rule_facts, block_types)
        fits.append({
            "id": fit["id"], "base": base, "boxDbu": fit["boxDbu"],
            "extraRot": fit["extraRot"], "postfix": fit["postfix"], "inGroup": fit["inGroup"],
            "blockType": block_type, "priority": bool(fit["inGroup"]), "ruleItem": rule_item,
            "lane": _lane_or_warning(frame, fit["boxDbu"], fit["id"], warnings),
        })

    pending = []
    for drop in pla_doc["drops"]:
        base = drop["base"]
        rule_item, block_type = _rule_item_or_block_type(base, rule_facts, block_types)
        l, b, r, t = drop["boxDbu"]
        pending.append({
            "id": drop["id"], "base": base, "sizeDbu": [r - l, t - b],
            "blockType": block_type, "ruleItem": rule_item, "inGroup": drop["inGroup"],
            "placedFlag": drop["placedFlag"],
        })
    if pending_from_rules:
        for base, rule_fact in rule_facts.items():
            if rule_fact.get("itemType") != "SLFIT":
                continue
            needed = rule_fact["setNum"][1] - placed_count_by_base.get(base, 0)
            block = block_types.get(base)
            size_dbu = block["sizeDbu"] if block else None
            for k in range(1, needed + 1):
                pending.append({
                    "id": f"{base}.{base}#pending-{k}", "base": base, "sizeDbu": size_dbu,
                    "blockType": rule_fact.get("blockType"), "ruleItem": base, "inGroup": "",
                    "placedFlag": None,
                })

    body = {
        "stage": stage,
        "dbuPerUm": pla_doc["dbuPerUm"],
        "frame": frame,
        "fixed": fixed,
        "groups": groups,
        "fits": fits,
        "pending": pending,
        "targets": targets,
        "ruleFacts": rule_facts,
        "lanes": lanes.lane_model(frame),
        "inputs": inputs,
        "warnings": warnings,
    }
    body["schema"] = "mage.layout-snapshot/2"
    body["id"] = core.digest(body)
    body["snapshotSha256"] = snapshot_sha(body)
    return body


def snapshot_sha(body):
    """Full (64 hex char) SHA-256 over the canonical body, `snapshotSha256` excluded."""
    stripped = {k: v for k, v in body.items() if k != "snapshotSha256"}
    return hashlib.sha256(core.canonical(stripped)).hexdigest()


def load_snapshot(path):
    """Read a snapshot written by `build_snapshot`; verify `snapshotSha256`."""
    target = Path(path)
    try:
        body = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise core.MageError("missing-input", f"cannot read snapshot {target}: {exc}") from exc
    if body.get("schema") != "mage.layout-snapshot/2":
        raise core.MageError("schema-mismatch", f"expected mage.layout-snapshot/2, got {body.get('schema')!r}")
    stored = body.get("snapshotSha256")
    if stored != snapshot_sha(body):
        raise core.MageError("identity-mismatch", f"stored snapshotSha256 does not match recomputed hash at {target}")
    return body
