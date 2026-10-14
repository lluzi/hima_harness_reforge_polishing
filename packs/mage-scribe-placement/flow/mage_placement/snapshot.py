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


def _in_group_counts(snap):
    """Count of in-group (priority) instances per Group label (`inGroup`),
    over `fits` + `pending`. Rule-derived synthetic shortfall copies carry an
    empty `inGroup`, so they never count; only real Fits and real drops with
    a non-empty `inGroup` do."""
    counts = {}
    for item in list(snap.get("fits", [])) + list(snap.get("pending", [])):
        group = item.get("inGroup")
        if group:
            counts[group] = counts.get(group, 0) + 1
    return counts


def _ordinary_population_count(snap):
    fits = sum(1 for f in snap.get("fits", []) if not f.get("inGroup"))
    drops = sum(1 for p in snap.get("pending", []) if not p.get("inGroup"))
    return fits + drops


def ordinary_population(snap):
    """Count of ordinary (non-group) structures in an export snapshot:
    ordinary Fits (empty `inGroup`) + ordinary drops (empty `inGroup`).

    Measured on an export snapshot (`pending_from_rules=False`), whose
    `pending` is MAGE's own drops table and so carries no rule-derived
    synthetic shortfall copies. This is the number real MAGE conserves
    across a delivered round (the measured population of a filled export),
    and `check_inventory_conservation` anchors it to the incumbent's own
    value rather than to the start's rule-derived `pending` count (which is
    larger: a priority-only start declares every rule shortfall as pending,
    while a filled export carries only the structures MAGE actually placed
    or dropped)."""
    return _ordinary_population_count(snap)


def check_inventory_conservation(start, candidate, ordinary_population):
    """N2/N7: inventory conservation at the level real MAGE output actually
    conserves -- the Group (not the exact instance id, and not the base
    master count), plus the ordinary population as a count.

    Why not per base: a fresh auto-refine replay turns a priority-only start
    into a much larger filled export (new masters the start/rule never
    named); and refine legitimately re-suffixes -- even re-*masters* -- an
    in-group priority instance while keeping it in the same Group. A
    per-base or exact-id count therefore refuses a genuine MAGE result
    (empirically it refused the customer's own post-refine incumbent). What
    MAGE *does* conserve, and what a structural loss breaks, is:

    - **Fixed instance ids**, equal as a set (a Fixed object is never
      renamed, moved to Fits, or dropped).
    - **Group labels** (`pinstGroup`), equal as a set.
    - **The count of in-group (priority) instances per Group label**, equal
      between start and export. A priority mark re-suffixed or re-mastered
      inside its Group keeps the Group's count (admitted); a priority mark
      genuinely deleted drops its Group's count (refused); an extra priority
      instance raises it (refused).
    - **The ordinary (non-group) population as a count** (N7). Ordinary fill
      is fluid in its ids and masters, but a legitimately delivered round
      still carries the full ordinary set the incumbent does. An export that
      simply omits ordinary structures (e.g. a round that skipped the fill
      stage) would otherwise read as fewer drops and a shorter dropped
      length -- a false improvement on the objective that the ranking loop
      would keep as best. The required count is the incumbent's own measured
      ordinary population (`ordinaryPopulation` in `state/incumbent.json`),
      passed in as `ordinary_population`; it is deliberately NOT the start
      snapshot's rule-derived ordinary `pending` count (which is larger).
      `ordinary_population is None` means no incumbent has been measured in
      this workspace yet (a Pack-local path that never reaches the live
      Campaign, where `measure-incumbent` always runs before any round), and
      the ordinary-population clause is then not enforced; the Group/Fixed
      clauses always run.

    Verified on the real staged frame case (Linglong): the vendor start vs
    the customer post-refine incumbent conserves the Group/Fixed identities
    and the ordinary population and is admitted, while the same export with
    one priority Fit row deleted, or one ordinary drop row removed, is
    refused.

    Raises `MageError('inventory', ...)` on any violation; returns `None`
    when conserved. Shared verbatim by the candidate assembler
    (`mage_placement_cli.py`) and the Reader (`tools/read-mage.py`) so the
    two sides can never disagree about what "conserved" means.
    """
    start_fixed = {f["id"] for f in start.get("fixed", [])}
    candidate_fixed = {f["id"] for f in candidate.get("fixed", [])}
    missing_fixed = sorted(start_fixed - candidate_fixed)
    extra_fixed = sorted(candidate_fixed - start_fixed)

    start_groups = {g["pinstGroup"] for g in start.get("groups", [])}
    candidate_groups = {g["pinstGroup"] for g in candidate.get("groups", [])}
    missing_groups = sorted(start_groups - candidate_groups)
    extra_groups = sorted(candidate_groups - start_groups)

    start_counts = _in_group_counts(start)
    candidate_counts = _in_group_counts(candidate)
    deleted = sorted(g for g in set(start_counts) | set(candidate_counts)
                     if candidate_counts.get(g, 0) < start_counts.get(g, 0))
    fabricated = sorted(g for g in set(start_counts) | set(candidate_counts)
                        if candidate_counts.get(g, 0) > start_counts.get(g, 0))

    if deleted or fabricated or missing_fixed or extra_fixed or missing_groups or extra_groups:
        raise core.MageError(
            "inventory",
            "inventory not conserved by Group: "
            f"groupsLosingPriorityInstance={deleted} groupsGainingPriorityInstance={fabricated} "
            f"fixedMissing={missing_fixed} fixedExtra={extra_fixed} "
            f"groupLabelMissing={missing_groups} groupLabelExtra={extra_groups}",
        )

    # N7: the ordinary (non-group) population is conserved against the
    # incumbent's own measured value, never the start's rule-derived pending.
    if ordinary_population is not None:
        candidate_ordinary = _ordinary_population_count(candidate)
        if candidate_ordinary != ordinary_population:
            raise core.MageError(
                "inventory",
                f"ordinary population {candidate_ordinary} != incumbent {ordinary_population}",
            )


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
