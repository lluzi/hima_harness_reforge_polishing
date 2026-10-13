#!/usr/bin/env python3
"""`mage_placement_cli.py <subcommand> <workspace> [args]` — the glue
between the Harness graph (`graph.yml`) and the Pack's own
`flow/mage_placement/` modules, mirroring the shape of the ATCS Pack's
`atcs_cli.py`.

Two subcommand families:

- `task-<name>` (program tasks: `prepare-case`, `measure-incumbent`) — argv
  is `<workspace> <task-input-path> <task-output-path>`; `TASK_INPUT` is a
  plain JSON object keyed by the task's own bound input names
  (`graph.yml`); this dispatcher calls `mage_placement.tasks.execute` and
  writes its `{"schemaVersion","value","artifacts","diagnostics"}` result
  straight to `TASK_OUTPUT` (`core.write_artifact`).
- resident-facing subcommands (`snapshot`, `plan-slots`, `mage-stage`,
  `stage-report`, `candidate`, `script-candidate`, `lane-view`,
  `flow-digest`) — each either prints a JSON result to stdout (`lane-view`
  — diagnostics with no single declared output file) or returns
  `(output_path, body)` for `main()` to write atomically with
  `core.write_artifact`.

Exit codes, exactly as `atcs_cli.py:_fail`: `0` success; `2` a malformed or
missing declared input (`MageError` with most refusal codes, or a bare
`OSError`/`KeyError`/`TypeError`/`ValueError` escaping a handler); `3` a
`MageError` refusal from a module given otherwise well-formed inputs. Every
failure writes a plain `{"code","detail"}` JSON object to stderr — never a
raw traceback.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent)]

from mage_placement import (  # noqa: E402
    core, metrics as metrics_mod, pla, planner, records, snapshot, tasks,
)
from mage_placement.native import session as native_session  # noqa: E402


NATIVE_TYPES = metrics_mod.NATIVE_TYPES


def _read_plain(path):
    target = Path(path)
    if not target.is_file():
        raise core.MageError("missing-input", f"declared input not found: {target}")
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise core.MageError("missing-input", f"cannot parse {target}: {exc}") from exc


def _identity():
    return {
        "taskId": os.environ.get("HIMA_TASK_ID", "unknown"),
        "runId": os.environ.get("HIMA_RUN_ID", "unknown"),
        "executionId": os.environ.get("HIMA_EXECUTION_ID", "unknown"),
        "nodeId": os.environ.get("HIMA_NODE_ID", "unknown"),
    }


def _priority_unplaced(snap):
    ids = [p["id"] for p in snap["pending"] if p.get("inGroup")]
    return {"count": len(ids), "ids": ids}


def _incumbent_ordinary_population(workspace):
    """N7: the incumbent's measured ordinary population from
    `state/incumbent.json` (`ordinaryPopulation`), or `None` when no
    incumbent has been measured in this workspace yet. In the live Campaign
    `measure-incumbent` always runs before any round, so the anchor is
    always present on the real path; `None` only arises on Pack-local paths
    that assemble a candidate without a measured incumbent."""
    path = Path(workspace) / "state" / "incumbent.json"
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc.get("ordinaryPopulation")


def _check_inventory_conservation(workspace, start, candidate):
    """C4/N2/N7: inventory conservation (Group/Fixed identities + ordinary
    population), delegated to the single shared
    `snapshot.check_inventory_conservation` so the candidate assembler and
    the Reader can never disagree on what "conserved" means."""
    snapshot.check_inventory_conservation(
        start, candidate, _incumbent_ordinary_population(workspace),
    )


def _case_readiness(workspace):
    return core.read_artifact(Path(workspace) / "state" / "case-readiness.json", "case-readiness")


def _resolve_in_workspace(workspace, value):
    """A `--out-dir`/`--pla`/`--experiment`/`--round-dir`/`--ledger` value, resolved
    against `workspace` when relative.

    These flags are documented (`placement/round-NN`, a sibling candidate
    PLA) as workspace-relative, but `argparse` only ever hands back the
    literal string, which Python resolves against the *process* cwd, not
    the workspace, the moment it is joined with anything else. A caller
    whose cwd differs from `workspace` (any real resident invocation --
    the Harness never guarantees cwd == WORKSPACE) would otherwise split
    one round's files across two directories and leave `round.tcl`
    pointing at a candidate PLA that MAGE, running with cwd=round_dir,
    cannot read. Resolving every such flag here, once, before anything
    is created or passed onward, keeps the round's files and its
    `round.tcl` references under one absolute root regardless of cwd.
    """
    path = Path(value)
    return path if path.is_absolute() else Path(workspace) / path


# ---------------------------------------------------------------------------
# resident subcommands
# ---------------------------------------------------------------------------


def _cmd_snapshot(workspace, args):
    parser = argparse.ArgumentParser(prog="snapshot")
    parser.add_argument("--pla", required=True)
    parser.add_argument("--stage", required=True, choices=["start", "incumbent", "candidate"])
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)

    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    # `--pla`/`--out` are workspace-relative by convention (same class of
    # bug as the Linglong cwd failure); resolve against WORKSPACE.
    pla_path = _resolve_in_workspace(workspace, opts.pla)
    out_path = str(_resolve_in_workspace(workspace, opts.out))
    pla_text = pla_path.read_text(encoding="utf-8")
    doc = pla.read_pla(pla_text, start["dbuPerUm"])
    body = snapshot.build_snapshot(
        opts.stage, doc, start["frame"], start["ruleFacts"], start["targets"], {},
        {"pla": {"path": str(pla_path), "sha256": core.file_sha256(pla_path)}},
        pending_from_rules=(opts.stage == "start"),
    )
    return out_path, body


def _cmd_lane_view(workspace, args):
    del workspace
    parser = argparse.ArgumentParser(prog="lane-view")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--lane", required=True)
    parser.add_argument("--along", default=None)
    parser.add_argument("--cross", default=None)
    opts = parser.parse_args(args)

    from mage_placement import lanes

    snap = snapshot.load_snapshot(opts.snapshot)
    along = tuple(int(v) for v in opts.along.split(",")) if opts.along else None
    cross = tuple(int(v) for v in opts.cross.split(",")) if opts.cross else None
    boxes = [[f["id"], f["boxDbu"]] for f in snap["fits"]]
    result = lanes.project(snap["frame"], boxes, opts.lane, along=along, cross=cross)
    print(json.dumps(result, sort_keys=True))
    return None


def _grid_dbu_for_lane(snap, fit_ids_in_lane, axis_index, default=100):
    """The placement grid (DBU) for one lane's along axis.

    Reads `gridDbu[axis_index]` off the rule fact of the first fit in
    `fit_ids_in_lane` that names one (spec section 7.1: "unless the rule
    file says otherwise"); falls back to `default` (100 DBU = 0.01 um,
    the Pack's own default grid) when none of this lane's fits name a
    grid at all.
    """
    for fit in snap["fits"]:
        if fit["id"] not in fit_ids_in_lane:
            continue
        rule_item = fit.get("ruleItem")
        fact = snap["ruleFacts"].get(rule_item) if rule_item else None
        grid = fact.get("gridDbu") if fact else None
        if grid and grid[axis_index]:
            return grid[axis_index]
    return default


def _to_grid(value_dbu, grid_dbu):
    """Exact DBU -> grid-unit conversion; refuses an inexact division."""
    if value_dbu % grid_dbu != 0:
        raise core.MageError(
            "units", f"{value_dbu} dbu is not an exact multiple of the {grid_dbu} dbu placement grid",
        )
    return value_dbu // grid_dbu


def _crosses_band(box_dbu, lane_axis, along_low, along_high, cross_low, cross_high):
    l, b, r, t = box_dbu
    cross_lo, cross_hi = (b, t) if lane_axis == "H" else (l, r)
    along_lo, along_hi = (l, r) if lane_axis == "H" else (b, t)
    return cross_lo < cross_high and cross_hi > cross_low and along_lo < along_high and along_hi > along_low


def _cmd_plan_slots(workspace, args):
    """Plan `--count` slots of `--length-um` (clearance 0) inside one
    scribe lane, following the exact slot planner (spec section 7.1).

    Every DBU quantity is converted to the lane's own placement-grid
    units before `planner.plan_lane` ever sees it, and the result's
    `moves`/`slotStarts`/`totalDisplacementDbu` are converted back to DBU
    before the `mage.slot-plan/1` body is written (`plan_lane`'s own
    `*Dbu`-named fields are frozen schema labels, not a claim about which
    units the caller passed it -- see its docstring).

    Item model: a priority fit's window is the CT-target window
    `[t - limit - len/2, t + limit - len/2]`, widened by the empty-window
    rule when the fit is already further from its target than `limit`
    (`effective_limit = max(limit, |current_centre - t|)`, so an
    already-out-of-limit mark's own current position is always inside
    its window -- a plan can only ever hold it or improve it, never ask
    for a worse position). A non-priority fit is an immovable point item
    unless `--movable-nonpriority <um>` gives it a `[current - budget,
    current + budget]` baseline window. Every Fixed object and every
    "crossing intruder" (a box of the frame's other axis whose own box
    still overlaps this lane's cross/along band) is an immovable point
    item too. Two immovable zero-length sentinels, `@start`/`@end`, pin
    the lane's own along range.

    Exterior fold: a frame's two opposite exterior tracks of one axis
    (`V:0`/`V:<cols>`, `H:0`/`H:<rows>`) are one physical scribe after
    stepping (`lanes.physical_lane` already folds their id; the lane
    model marks both `sharedExterior: true`). Both tracks' along range is
    the same full frame span (`V:0`/`V:<cols>` both run `[0, heightDbu]`;
    likewise `H:0`/`H:<rows>` both run `[0, widthDbu]`) -- only their
    *cross* range differs (opposite ends of the frame), which this
    command's item/intruder collection already treats per-band, so an
    occupant assigned to either track (or any crossing intruder whose box
    falls inside either track's own cross band) is included without
    needing a coordinate translation: both tracks already share the
    along axis the planner actually reasons and moves items on. Requesting
    either track's own lane id plans the identical folded result and
    writes `lane` back as the physical lane id (`V:0`) plus
    `foldedTracks: [0, <last>]`.
    """
    parser = argparse.ArgumentParser(prog="plan-slots")
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--lane", required=True)
    parser.add_argument("--length-um", required=True)
    parser.add_argument("--count", required=True, type=int)
    parser.add_argument("--limit-um", required=True)
    parser.add_argument("--relaxed", action="store_true")
    parser.add_argument("--movable-nonpriority", default=None, metavar="UM")
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)

    # `--snapshot`/`--out` are workspace-relative by convention.
    snap = snapshot.load_snapshot(_resolve_in_workspace(workspace, opts.snapshot))
    out_path = str(_resolve_in_workspace(workspace, opts.out))
    dbu_per_um = snap["dbuPerUm"]
    length_dbu = core.um_to_dbu(opts.length_um, dbu_per_um)
    limit_dbu = core.um_to_dbu(opts.limit_um, dbu_per_um)
    nonpriority_budget_dbu = (
        core.um_to_dbu(opts.movable_nonpriority, dbu_per_um) if opts.movable_nonpriority is not None else None
    )

    lane_entry = next((entry for entry in snap["lanes"] if entry["laneId"] == opts.lane), None)
    if lane_entry is None:
        raise core.MageError("missing-input", f"unknown lane {opts.lane!r}")
    lane_axis = lane_entry["axis"]
    axis_index = 0 if lane_axis == "H" else 1
    physical_lane_id = lane_entry["physicalLane"]

    # The physical lane's own along range is shared by every band folded
    # into it (see the exterior-fold docstring above); any one band's
    # alongRangeDbu is therefore the physical lane's.
    along_low_dbu, along_high_dbu = lane_entry["alongRangeDbu"]
    bands = [
        (entry["track"], entry["crossRangeDbu"][0], entry["crossRangeDbu"][1])
        for entry in snap["lanes"]
        if entry["axis"] == lane_axis and entry["physicalLane"] == physical_lane_id
    ]
    lane_tracks = {track for track, _lo, _hi in bands}
    folded_tracks = sorted(lane_tracks) if len(lane_tracks) > 1 else None

    def crosses_any_band(box_dbu):
        return any(
            _crosses_band(box_dbu, lane_axis, along_low_dbu, along_high_dbu, cross_lo, cross_hi)
            for _track, cross_lo, cross_hi in bands
        )

    fit_ids_in_lane = {
        fit["id"] for fit in snap["fits"]
        if fit.get("lane") is not None and fit["lane"]["axis"] == lane_axis and fit["lane"]["track"] in lane_tracks
    }
    grid_dbu = _grid_dbu_for_lane(snap, fit_ids_in_lane, axis_index)

    def to_grid(value_dbu):
        return _to_grid(value_dbu, grid_dbu)

    length = to_grid(length_dbu)
    targets_by_fit = {t["fitId"]: t for t in snap["targets"] if t.get("fitId")}

    items = []
    for fit in snap["fits"]:
        lane = fit.get("lane")
        in_this_lane = lane is not None and lane["axis"] == lane_axis and lane["track"] in lane_tracks
        crosses = crosses_any_band(fit["boxDbu"])
        if not in_this_lane and not crosses:
            continue

        l, b, r, t_ = fit["boxDbu"]
        along_lo_dbu, along_hi_dbu = (l, r) if lane_axis == "H" else (b, t_)
        along_length_dbu = along_hi_dbu - along_lo_dbu
        along_current_dbu = along_lo_dbu

        if not in_this_lane:
            # A crossing intruder from a different lane: immovable point item.
            point = to_grid(along_current_dbu)
            items.append(planner.LaneItem(
                id=fit["id"], length=to_grid(along_length_dbu), gap_after=0,
                window=(point, point), current=point, movable=False, cluster=None, intruder=True,
            ))
            continue

        is_priority = bool(fit.get("priority"))
        if is_priority:
            target = targets_by_fit.get(fit["id"])
            if target is not None:
                centre_dbu = (along_lo_dbu + along_hi_dbu) // 2
                ct_dbu = target["ctDbu"][0] if lane_axis == "H" else target["ctDbu"][1]
                deviation_dbu = abs(centre_dbu - ct_dbu)
                effective_limit_dbu = max(limit_dbu, deviation_dbu)
                lo_dbu = ct_dbu - effective_limit_dbu - along_length_dbu // 2
                hi_dbu = ct_dbu + effective_limit_dbu - along_length_dbu // 2
                window = (to_grid(lo_dbu), to_grid(hi_dbu))
            else:
                point = to_grid(along_current_dbu)
                window = (point, point)
            movable = True
        elif nonpriority_budget_dbu is not None:
            lo_dbu, hi_dbu = along_current_dbu - nonpriority_budget_dbu, along_current_dbu + nonpriority_budget_dbu
            window = (to_grid(lo_dbu), to_grid(hi_dbu))
            movable = True
        else:
            point = to_grid(along_current_dbu)
            window, movable = (point, point), False

        items.append(planner.LaneItem(
            id=fit["id"], length=to_grid(along_length_dbu), gap_after=0, window=window,
            current=to_grid(along_current_dbu), movable=movable, cluster=None, priority=is_priority,
        ))

    for fixed in snap["fixed"]:
        if not crosses_any_band(fixed["boxDbu"]):
            continue
        l, b, r, t_ = fixed["boxDbu"]
        along_lo_dbu, along_hi_dbu = (l, r) if lane_axis == "H" else (b, t_)
        point = to_grid(along_lo_dbu)
        items.append(planner.LaneItem(
            id=fixed["id"], length=to_grid(along_hi_dbu - along_lo_dbu), gap_after=0,
            window=(point, point), current=point, movable=False, cluster=None,
        ))

    start_point, end_point = to_grid(along_low_dbu), to_grid(along_high_dbu)
    items.append(planner.LaneItem(id="@start", length=0, gap_after=0, window=(start_point, start_point),
                                   current=start_point, movable=False))
    items.append(planner.LaneItem(id="@end", length=0, gap_after=0, window=(end_point, end_point),
                                   current=end_point, movable=False))
    items.sort(key=lambda it: it.current)

    slot = planner.SlotRequest(count=opts.count, length=length, clearance=0)
    relaxations = {"ignoreGaps": True, "intrudersMovable": True} if opts.relaxed else None
    body = planner.plan_lane(items, slot, relaxations=relaxations, lane_id=physical_lane_id)

    # `plan_lane`'s own `*Dbu`-named fields are the frozen schema labels
    # (its docstring); the caller passed it grid units, so convert back.
    # Moves/slotStarts are along-axis positions, which both tracks of a
    # folded exterior pair already share verbatim (see the exterior-fold
    # docstring above) -- no further per-track translation is needed.
    body["slot"] = {"count": opts.count, "length": length_dbu, "clearance": 0}
    body["moves"] = [
        {"id": move["id"], "fromDbu": move["fromDbu"] * grid_dbu, "toDbu": move["toDbu"] * grid_dbu}
        for move in body["moves"]
    ]
    body["slotStarts"] = [start * grid_dbu for start in body["slotStarts"]]
    body["totalDisplacementDbu"] = body["totalDisplacementDbu"] * grid_dbu
    if folded_tracks is not None:
        body["foldedTracks"] = folded_tracks

    body = core.stamp("slot-plan", body)
    errors = records.validate_record("slot-plan", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return out_path, body


_ROUND_DIR_RE = re.compile(r"^placement/round-(\d{2})$")


def _round_dir_of(workspace, stage_dir, round_no):
    """`stage_dir` must be `placement/round-NN/<stage>` for this round; returns the round dir."""
    try:
        rel = Path(stage_dir).resolve().relative_to(Path(workspace).resolve()).as_posix()
    except ValueError:
        raise core.MageError("invalid-input", f"stage dir {stage_dir} is outside the workspace")
    parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
    match = _ROUND_DIR_RE.match(parent)
    if not match or int(match.group(1)) != int(round_no):
        raise core.MageError("invalid-input", f"stage dir {rel!r} is not under placement/round-{int(round_no):02d}/")
    return Path(workspace) / parent


def _stage_session(workspace, readiness, log_path):
    site_mage = readiness["siteCapabilities"]["mage"]
    manifest = readiness["manifest"]
    env = dict(os.environ); env.update(site_mage.get("env", {}))
    return native_session.MageSession(
        executable=site_mage["executable"], env=env, workdir=str(Path(workspace)), log_path=str(log_path),
        case={"frb": manifest["frb"]["path"], "caseDir": str(Path(manifest["frb"]["path"]).parent),
              "startPla": manifest["startState"]["path"]},
    )


def _cmd_mage_stage(workspace, args):
    parser = argparse.ArgumentParser(prog="mage-stage")
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--script", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--timeout-s", type=int, default=1800)
    opts = parser.parse_args(args)
    readiness = _case_readiness(workspace)
    stage_dir = _resolve_in_workspace(workspace, opts.out_dir)
    round_dir = _round_dir_of(workspace, stage_dir, opts.round)
    round_dir.mkdir(parents=True, exist_ok=True)
    sess = _stage_session(workspace, readiness, round_dir / "session.jsonl")
    result = sess.run_stage(str(stage_dir), str(_resolve_in_workspace(workspace, opts.script)),
                            native_session.ENGINEER_ROLE, timeout_s=opts.timeout_s)
    stage_no = int(re.sub(r"\D", "", stage_dir.name) or 0) or 1
    summary = core.stamp("stage-summary", {"round": opts.round, "stage": stage_no, "role": native_session.ENGINEER_ROLE, **result})
    errors = records.validate_record("stage-summary", summary)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return str(stage_dir / "stage-summary.json"), summary


def _snapshot_from_pla(workspace, start, pla_path, stage, inputs):
    doc = pla.read_pla(Path(pla_path).read_text(encoding="utf-8"), start["dbuPerUm"])
    return snapshot.build_snapshot(stage, doc, start["frame"], start["ruleFacts"], start["targets"], {},
                                   inputs, pending_from_rules=False)


def _report_row(workspace, start, snap, boundary, index, source, goal, native):
    try:
        snapshot.check_inventory_conservation(start, snap, _incumbent_ordinary_population(workspace))
        inventory = {"status": "pass", "detail": ""}
    except core.MageError as exc:
        inventory = {"status": "fail", "detail": exc.detail}
    target = metrics_mod.target_distances(snap, str(goal["max_target_distance_um"]))
    order = metrics_mod.order_deviation(snap)
    moved = metrics_mod.displacement(start, snap)["priority"]
    return {
        "boundary": boundary, "index": index, "source": source,
        "fixed": len(snap["fixed"]), "groups": len(snap["groups"]),
        "inGroupFits": sum(1 for f in snap["fits"] if f.get("inGroup")),
        "ordinaryFits": sum(1 for f in snap["fits"] if not f.get("inGroup")),
        "drops": metrics_mod.drops(snap), "inventory": inventory,
        "targetDistances": {"maxUm": target["maxUm"], "overLimitCount": target["overLimitCount"],
                            "identity": "known" if not target["unplaced"] else "identity-unknown"},
        "orderDeviation": {"max": order["max"], "maxLr": order["maxLr"], "maxTb": order["maxTb"], "byPartition": order["byPartition"]},
        "priorityMovement": {"movedCount": moved["movedCount"], "maxUm": moved["maxUm"], "totalUm": moved["totalUm"], "unmatched": moved["unmatched"]},
        "nativeRows": native,
    }


def _cmd_stage_report(workspace, args):
    parser = argparse.ArgumentParser(prog="stage-report")
    parser.add_argument("--stage-dir", required=True)
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)
    stage_dir = _resolve_in_workspace(workspace, opts.stage_dir)
    summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
    readiness = _case_readiness(workspace)
    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    rows = []
    for snap_ref in summary["snapshots"]:
        snap = _snapshot_from_pla(workspace, start, snap_ref["pla"], "candidate", {})
        checks = summary.get("checks", {}).get(str(snap_ref["index"]))
        native = None
        if checks:
            by_type = {t: checks.get(t, {}).get("instances") for t in NATIVE_TYPES}
            native = {"byType": by_type, "total": None if any(v is None for v in by_type.values()) else sum(by_type.values())}
        rows.append(_report_row(workspace, start, snap, snap_ref["name"], snap_ref["index"], "snapshot", readiness["goal"], native))
    if summary.get("completed") and summary.get("exportPla"):
        snap = _snapshot_from_pla(workspace, start, summary["exportPla"], "candidate", {})
        native = metrics_mod.native_rows({t: p for t, p in summary.get("verifyFiles", {}).items()})
        rows.append(_report_row(workspace, start, snap, "export", None, "export", readiness["goal"],
                                {"byType": native["byType"], "total": native["total"]}))
    body = core.stamp("stage-report", {"stageDir": str(stage_dir.resolve().relative_to(Path(workspace).resolve())), "rows": rows})
    errors = records.validate_record("stage-report", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return str(_resolve_in_workspace(workspace, opts.out)), body


def _ref(workspace, path):
    path = Path(path)
    return {"path": str(path.resolve().relative_to(Path(workspace).resolve())), "sha256": core.file_sha256(path)}


def _cmd_candidate(workspace, args):
    parser = argparse.ArgumentParser(prog="candidate")
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--stage-dir", required=True)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)
    ws = Path(workspace).resolve()
    stage_dir = _resolve_in_workspace(workspace, opts.stage_dir)
    round_dir = _round_dir_of(workspace, stage_dir, opts.round)
    out_path = str(_resolve_in_workspace(workspace, opts.out))
    summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
    readiness = _case_readiness(workspace)
    start = snapshot.load_snapshot(ws / "state" / "start-snapshot.json")

    journal_path = _resolve_in_workspace(workspace, opts.journal)
    try:
        entry = json.loads(journal_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise core.MageError("missing-input", f"cannot read journal entry {journal_path}: {exc}") from exc
    errors = records.validate_record("journal-entry", entry)
    if errors or entry.get("round") != opts.round:
        raise core.MageError("schema", "; ".join(errors) or "journal entry round does not match --round")

    files = {
        "script": _ref(ws, stage_dir / "script.tcl"), "stageScript": _ref(ws, stage_dir / "stage.tcl"),
        "sessionLog": _ref(ws, round_dir / "session.jsonl"), "journal": _ref(ws, journal_path),
        "verify": {t: _ref(ws, p) for t, p in summary.get("verifyFiles", {}).items()},
        "snapshots": [{"index": s["index"], "name": s["name"], **_ref(ws, s["pla"])} for s in summary.get("snapshots", [])],
    }
    reproduction = {"stageDir": str(stage_dir.resolve().relative_to(ws)), "script": "script.tcl", "stageScript": "stage.tcl"}
    build_banner = readiness["manifest"].get("mage", {}).get("buildBanner", "")
    identity = {**_identity(), "round": opts.round}

    def _blocked(reason):
        body = core.stamp("script-candidate", {
            "identity": identity, "startSnapshotSha256": start["snapshotSha256"], "snapshotSha256": start["snapshotSha256"],
            "buildBanner": build_banner, "files": files, "metrics": {}, "remaining": [], "blocked": [{"reason": reason}],
            "unknown": [], "outcome": "blocked", "stopReason": reason, "reproduction": reproduction,
        })
        errs = records.validate_record("script-candidate", body)
        if errs:
            raise core.MageError("schema", "; ".join(errs))
        return out_path, body

    export = stage_dir / "out" / "export.pla"
    if not summary.get("completed") or not export.is_file():
        boundary = summary.get("lastBoundary") or "prelude"
        detail = summary.get("stageError") or ("no export.pla" if not export.is_file() else "no MAGE_ROUND_END marker")
        return _blocked(f"stage did not complete after boundary {boundary}: {detail}")

    candidate_snapshot = _snapshot_from_pla(workspace, start, export, "candidate", {"exportPla": _ref(ws, export)})
    try:
        _check_inventory_conservation(workspace, start, candidate_snapshot)
    except core.MageError as exc:
        return _blocked(f"inventory not conserved: {exc.detail}")
    snapshot_path = stage_dir / "out" / "snapshot.json"
    core.write_artifact(snapshot_path, candidate_snapshot)
    files["export"] = _ref(ws, export); files["snapshot"] = _ref(ws, snapshot_path)
    if summary.get("summary") and Path(summary["summary"]).is_file():
        files["summary"] = _ref(ws, summary["summary"])
    goal = readiness["goal"]
    verify_files = {t: str(ws / r["path"]) for t, r in files["verify"].items()}
    computed = {
        "drops": metrics_mod.drops(candidate_snapshot),
        "targetDistances": metrics_mod.target_distances(candidate_snapshot, str(goal["max_target_distance_um"])),
        "orderDeviation": metrics_mod.order_deviation(candidate_snapshot),
        "displacement": metrics_mod.displacement(start, candidate_snapshot),
        "nativeRows": metrics_mod.native_rows(verify_files),
        "priorityUnplaced": _priority_unplaced(candidate_snapshot),
    }
    body = core.stamp("script-candidate", {
        "identity": identity, "startSnapshotSha256": start["snapshotSha256"],
        "snapshotSha256": candidate_snapshot["snapshotSha256"], "buildBanner": build_banner,
        "files": files, "metrics": computed, "remaining": [p["id"] for p in candidate_snapshot["pending"]],
        "blocked": [], "unknown": computed["nativeRows"].get("unknown", []),
        "outcome": "completed", "stopReason": "", "reproduction": reproduction,
    })
    errors = records.validate_record("script-candidate", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return out_path, body


def _cmd_script_candidate_fallback(workspace, args):
    """Batch fallback for `engineer-script`: validate the existing delivery, never fabricate one."""
    del args
    path = Path(workspace) / "state" / "round" / "script-candidate.json"
    if not path.is_file():
        raise core.MageError("engineering-required", "no script-candidate delivered for this round")
    body = core.read_artifact(path, "script-candidate")
    errors = records.validate_record("script-candidate", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return path, body


RESIDENT_SUBCOMMANDS = {
    "snapshot": _cmd_snapshot,
    "plan-slots": _cmd_plan_slots,
    "mage-stage": _cmd_mage_stage,
    "stage-report": _cmd_stage_report,
    "candidate": _cmd_candidate,
    "script-candidate": _cmd_script_candidate_fallback,
}

# Prints JSON to stdout and writes no declared output file.
PRINTING_SUBCOMMANDS = {
    "lane-view": _cmd_lane_view,
}


def flow_digest(flow_dir=None):
    flow_dir = Path(flow_dir) if flow_dir else Path(__file__).resolve().parent
    entries = []
    for current, dirnames, filenames in os.walk(flow_dir):
        dirnames.sort()
        if "tests" in Path(current).relative_to(flow_dir).parts:
            continue
        for name in sorted(filenames):
            full = Path(current) / name
            rel = full.relative_to(flow_dir).as_posix()
            if rel.startswith("tests/"):
                continue
            entries.append({"path": rel, "sha256": core.file_sha256(full)})
    entries.sort(key=lambda entry: entry["path"])
    import hashlib

    return hashlib.sha256(core.canonical(entries)).hexdigest()


def _fail(code, detail, exit_code, extra=None):
    payload = {"code": code, "detail": detail}
    if extra:
        payload.update(extra)
    sys.stderr.write(json.dumps(payload, sort_keys=True) + "\n")
    return exit_code


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return _fail("missing-input", "usage: mage_placement_cli.py <subcommand> <workspace> [args]", 2)

    if argv[0] == "flow-digest":
        flow_dir = argv[1] if len(argv) > 1 else None
        try:
            print(flow_digest(flow_dir))
        except core.MageError as exc:
            return _fail(exc.code, exc.detail, 3)
        return 0

    if len(argv) < 2:
        return _fail("missing-input", "usage: mage_placement_cli.py <subcommand> <workspace> [args]", 2)
    subcommand, workspace, *rest = argv
    workspace = os.path.abspath(workspace)

    if subcommand.startswith("task-"):
        try:
            task_input, task_output = rest
            result = tasks.execute(subcommand[len("task-"):], workspace, _read_plain(task_input))
            core.write_artifact(task_output, result)
            return 0
        except core.MageError as exc:
            return _fail(exc.code, exc.detail, 3)
        except (OSError, KeyError, TypeError, ValueError) as exc:
            return _fail("malformed-input", f"{type(exc).__name__}: {exc}", 2)

    if subcommand in PRINTING_SUBCOMMANDS:
        try:
            PRINTING_SUBCOMMANDS[subcommand](workspace, rest)
            return 0
        except core.MageError as exc:
            return _fail(exc.code, exc.detail, 3)
        except (OSError, KeyError, TypeError, ValueError) as exc:
            return _fail("malformed-input", f"{type(exc).__name__}: {exc}", 2)

    handler = RESIDENT_SUBCOMMANDS.get(subcommand)
    if handler is None:
        return _fail("missing-input", f"unknown subcommand: {subcommand!r}", 2)

    try:
        output_path, body = handler(workspace, rest)
    except core.MageError as exc:
        return _fail(exc.code, exc.detail, 3)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        return _fail("malformed-input", f"{type(exc).__name__}: {exc}", 2)

    core.write_artifact(output_path, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
