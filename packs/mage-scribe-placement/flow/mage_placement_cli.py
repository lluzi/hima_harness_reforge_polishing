#!/usr/bin/env python3
"""`mage_placement_cli.py <subcommand> <workspace> [args]` — the glue
between the Harness graph (`graph.yml`) and the Pack's own
`flow/mage_placement/` modules, mirroring the shape of the ATCS Pack's
`atcs_cli.py`.

Two subcommand families:

- `task-<name>` (program tasks: `prepare-case`, `measure-incumbent`,
  `decide-round`, `evaluate-placement`, `deliver`) — argv is
  `<workspace> <task-input-path> <task-output-path>`; `TASK_INPUT` is a
  plain JSON object keyed by the task's own bound input names
  (`graph.yml`); this dispatcher calls `mage_placement.tasks.execute` and
  writes its `{"schemaVersion","value","artifacts","diagnostics"}` result
  straight to `TASK_OUTPUT` (`core.write_artifact`).
- resident-facing subcommands (`snapshot`, `lane-view`, `plan-slots`,
  `evaluate`, `mage-round`, `candidate`, `review`, the `placement-candidate`/
  `consumer-review` batch fallbacks, `flow-digest`) — each either prints a
  JSON result to stdout (`lane-view`, `evaluate` — diagnostics with no
  single declared output file) or returns `(output_path, body)` for
  `main()` to write atomically with `core.write_artifact`.

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
import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parent)]

from mage_placement import (  # noqa: E402
    consumers, core, metrics as metrics_mod, pla, planner, records, snapshot, tasks,
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


def _case_readiness(workspace):
    return core.read_artifact(Path(workspace) / "state" / "case-readiness.json", "case-readiness")


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
    pla_text = Path(opts.pla).read_text(encoding="utf-8")
    doc = pla.read_pla(pla_text, start["dbuPerUm"])
    body = snapshot.build_snapshot(
        opts.stage, doc, start["frame"], start["ruleFacts"], start["targets"], {},
        {"pla": {"path": opts.pla, "sha256": core.file_sha256(opts.pla)}},
        pending_from_rules=(opts.stage == "start"),
    )
    return opts.out, body


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
    del workspace

    snap = snapshot.load_snapshot(opts.snapshot)
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
    return opts.out, body


def _cmd_evaluate(workspace, args):
    parser = argparse.ArgumentParser(prog="evaluate")
    parser.add_argument("--consumer", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--start", default=None)
    opts = parser.parse_args(args)

    readiness = _case_readiness(workspace)
    models_dir = Path(__file__).resolve().parent / "consumer_models"
    model = consumers.load_consumer_model(models_dir, opts.consumer)
    candidate_snapshot = snapshot.load_snapshot(opts.candidate)
    start_path = opts.start or str(Path(workspace) / "state" / "start-snapshot.json")
    start_snapshot = snapshot.load_snapshot(start_path)

    verify_files = {}
    candidate_dir = Path(opts.candidate).parent
    for type_name in NATIVE_TYPES:
        candidate_path = candidate_dir / f"verify-{type_name}.txt"
        if candidate_path.is_file():
            verify_files[type_name] = str(candidate_path)

    result = consumers.evaluate(
        model, readiness["consumerContext"], candidate_snapshot, start_snapshot, verify_files,
        Path(opts.out_dir), goal=readiness["goal"],
    )
    print(json.dumps(result, sort_keys=True))
    return None


def _cmd_mage_round(workspace, args):
    parser = argparse.ArgumentParser(prog="mage-round")
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--pla", required=True)
    parser.add_argument("--role", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--fill", action="store_true")
    parser.add_argument("--experiment", default=None)
    opts = parser.parse_args(args)

    readiness = _case_readiness(workspace)
    site_mage = readiness["siteCapabilities"]["mage"]
    case = readiness["manifest"]
    auto_refine_converge = case.get("mage", {}).get("autoRefineConverge")

    import shutil

    round_dir = Path(opts.out_dir)
    round_dir.mkdir(parents=True, exist_ok=True)
    pla_copy = round_dir / "candidate.pla"
    shutil.copyfile(opts.pla, pla_copy)

    experiment_path = None
    if opts.experiment:
        experiment_path = Path(opts.experiment)
        if not experiment_path.is_absolute():
            experiment_path = Path(workspace) / experiment_path

    env = dict(os.environ)
    env.update(site_mage.get("env", {}))
    templates_dir = Path(__file__).resolve().parent / "templates"
    # The session log lives inside the round directory, under the
    # Engineer tool's own `artifactPrefix` (`placement/round-NN/`) --
    # a resident's support files only reach the Campaign workspace when
    # they sit under its artifact prefix and are listed in the delivery,
    # so a log at a Pack-wide `state/` path would never actually publish.
    log_path = round_dir / "session.jsonl"

    sess = native_session.MageSession(
        executable=site_mage["executable"], env=env, workdir=str(Path(workspace)),
        log_path=str(log_path), templates_dir=str(templates_dir),
        case={"frb": case["frb"]["path"], "autoRefineConverge": auto_refine_converge},
    )
    result = sess.run_round(
        str(round_dir), str(pla_copy), opts.role,
        fill=opts.fill, experiment_tcl=str(experiment_path) if experiment_path is not None else None,
    )

    summary_path = round_dir / "round-summary.json"
    summary = core.stamp("round-summary", {"round": opts.round, "role": opts.role, **result})
    core.write_artifact(summary_path, summary)
    return str(summary_path), summary


def _native_verify_refs(workspace, round_dir):
    workspace = Path(workspace)
    refs = {}
    for type_name in NATIVE_TYPES:
        path = round_dir / "out" / f"verify-{type_name}.txt"
        if path.is_file():
            refs[type_name] = {"path": str(path.relative_to(workspace)), "sha256": core.file_sha256(path)}
    return refs


def _cmd_candidate(workspace, args):
    parser = argparse.ArgumentParser(prog="candidate")
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--round-dir", required=True)
    parser.add_argument("--ledger", required=False, default=None)
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)

    workspace_path = Path(workspace)
    round_dir = Path(opts.round_dir)
    summary = json.loads((round_dir / "round-summary.json").read_text(encoding="utf-8"))

    export_pla_path = round_dir / "out" / "export.pla"
    export_text = export_pla_path.read_text(encoding="utf-8")
    readiness = _case_readiness(workspace)
    dbu_per_um = readiness["manifest"]["dbuPerUm"]
    export_doc = pla.read_pla(export_text, dbu_per_um)

    start = snapshot.load_snapshot(workspace_path / "state" / "start-snapshot.json")
    candidate_snapshot = snapshot.build_snapshot(
        "candidate", export_doc, start["frame"], start["ruleFacts"], start["targets"], {},
        {"exportPla": {"path": str(export_pla_path.relative_to(workspace_path)), "sha256": core.file_sha256(export_pla_path)}},
        pending_from_rules=False,
    )
    snapshot_path = round_dir / "out" / "snapshot.json"
    core.write_artifact(snapshot_path, candidate_snapshot)

    goal = readiness["goal"]
    verify_files = {t: str(round_dir / "out" / f"verify-{t}.txt") for t in NATIVE_TYPES
                    if (round_dir / "out" / f"verify-{t}.txt").is_file()}
    computed_metrics = {
        "drops": metrics_mod.drops(candidate_snapshot),
        "targetDistances": metrics_mod.target_distances(candidate_snapshot, str(goal["max_target_distance_um"])),
        "orderDeviation": metrics_mod.order_deviation(candidate_snapshot),
        "displacement": metrics_mod.displacement(start, candidate_snapshot),
        "nativeRows": metrics_mod.native_rows(verify_files),
        "priorityUnplaced": _priority_unplaced(candidate_snapshot),
    }

    ledger = []
    if opts.ledger and Path(opts.ledger).is_file():
        ledger = json.loads(Path(opts.ledger).read_text(encoding="utf-8"))

    # The vendor launcher returns 0 even when MAGE fails, so trust the
    # driver's own `completed` flag (return code 0, not timed out, and the
    # `MAGE_ROUND_END code 0` marker present), never the return code alone.
    completed = summary.get("completed", False)
    returncode = summary.get("returncode", 0)
    outcome = "completed" if completed else "blocked"
    if completed:
        stop_reason = ""
    elif returncode == 0:
        stop_reason = "native round did not reach MAGE_ROUND_END"
    else:
        stop_reason = f"native round returned {returncode}"

    pla_copy_path = round_dir / "candidate.pla"
    # The session log lives inside this round's own directory (under the
    # Engineer tool's `artifactPrefix`), not at a Pack-wide `state/` path
    # -- see `_cmd_mage_round`'s own comment.
    session_log_path = round_dir / "session.jsonl"
    scripts = [{"path": str((round_dir / "round.tcl").relative_to(workspace_path)),
                "sha256": core.file_sha256(round_dir / "round.tcl")}]
    if summary.get("experimentTcl"):
        experiment_path = round_dir / "experiment.tcl"
        scripts.append({"path": str(experiment_path.relative_to(workspace_path)),
                        "sha256": core.file_sha256(experiment_path)})
    files = {
        "pla": {"path": str(pla_copy_path.relative_to(workspace_path)), "sha256": core.file_sha256(pla_copy_path)},
        "snapshot": {"path": str(snapshot_path.relative_to(workspace_path)), "sha256": core.file_sha256(snapshot_path)},
        "export": {"path": str(export_pla_path.relative_to(workspace_path)), "sha256": core.file_sha256(export_pla_path)},
        "verify": _native_verify_refs(workspace_path, round_dir),
        "sessionLog": {"path": str(session_log_path.relative_to(workspace_path)), "sha256": core.file_sha256(session_log_path)},
        "scripts": scripts,
    }

    pending_remaining = [p["id"] for p in candidate_snapshot["pending"]]

    body = core.stamp("placement-candidate", {
        "identity": {**_identity(), "round": opts.round},
        "startSnapshotSha256": start["snapshotSha256"],
        "snapshotSha256": candidate_snapshot["snapshotSha256"],
        "buildBanner": readiness["manifest"].get("mage", {}).get("buildBanner", ""),
        "files": files, "metrics": computed_metrics, "ledger": ledger,
        "remaining": pending_remaining, "blocked": [], "unknown": computed_metrics["nativeRows"].get("unknown", []),
        "outcome": outcome, "stopReason": stop_reason,
        "reproduction": {
            "roundDir": str(round_dir.relative_to(workspace_path)), "script": "round.tcl",
            "fill": bool(summary.get("fill", False)),
            "experimentSha256": summary.get("experimentSha256"),
        },
    })
    errors = records.validate_record("placement-candidate", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return opts.out, body


def _cmd_review(workspace, args):
    parser = argparse.ArgumentParser(prog="review")
    parser.add_argument("--consumer", required=True)
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--findings", required=True)
    parser.add_argument("--requests", required=True)
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)

    findings_payload = json.loads(Path(opts.findings).read_text(encoding="utf-8"))
    findings = []
    for finding in findings_payload.get("findings", []):
        entry = dict(finding)
        entry["round"] = opts.round
        findings.append(entry)

    requests_raw = json.loads(Path(opts.requests).read_text(encoding="utf-8")) if Path(opts.requests).is_file() else []
    snapshot_sha = findings[0]["snapshotSha256"] if findings else ""
    requests = []
    for index, raw in enumerate(requests_raw, start=1):
        entry = dict(raw)
        entry["schema"] = "mage.request/1"
        entry["id"] = f"R-{index}"
        entry.setdefault("snapshotSha256", snapshot_sha)
        requests.append(entry)

    hard_fail_count = sum(1 for f in findings if f.get("severity") == "hard" and f.get("status") == "fail")
    consumer_model = findings[0]["consumerModel"] if findings else f"{opts.consumer}@unknown"

    body = core.stamp("consumer-review", {
        "identity": {**_identity(), "round": opts.round},
        "consumer": opts.consumer, "consumerModel": consumer_model, "snapshotSha256": snapshot_sha,
        "findings": findings, "requests": requests,
        "receipt": {"path": findings_payload.get("receiptPath", ""), "sha256": findings_payload.get("receiptSha256", "")},
        "summary": f"{len(findings)} finding(s), {hard_fail_count} hard fail(s), {len(requests)} request(s)",
    })
    errors = records.validate_record("consumer-review", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return opts.out, body


def _cmd_placement_candidate_fallback(workspace, args):
    """Batch fallback for `engineer-place`: validate the existing
    `state/round/placement-candidate.json`, never fabricate one."""
    del args
    path = Path(workspace) / "state" / "round" / "placement-candidate.json"
    if not path.is_file():
        raise core.MageError("engineering-required", "no placement-candidate delivered for this round")
    body = core.read_artifact(path, "placement-candidate")
    errors = records.validate_record("placement-candidate", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return path, body


def _cmd_consumer_review_fallback(workspace, args):
    """Batch fallback for a `review-*` tool: validate the existing
    `state/round/review-<role>.json`, never fabricate one."""
    if not args:
        raise core.MageError("missing-input", "consumer-review requires a ROLE argument")
    role = args[0]
    path = Path(workspace) / "state" / "round" / f"review-{role}.json"
    if not path.is_file():
        raise core.MageError("engineering-required", f"no consumer-review delivered for role {role!r}")
    body = core.read_artifact(path, "consumer-review")
    errors = records.validate_record("consumer-review", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return path, body


RESIDENT_SUBCOMMANDS = {
    "snapshot": _cmd_snapshot,
    "plan-slots": _cmd_plan_slots,
    "mage-round": _cmd_mage_round,
    "candidate": _cmd_candidate,
    "review": _cmd_review,
    "placement-candidate": _cmd_placement_candidate_fallback,
    "consumer-review": _cmd_consumer_review_fallback,
}

# These two print JSON to stdout and write no declared output file.
PRINTING_SUBCOMMANDS = {
    "lane-view": _cmd_lane_view,
    "evaluate": _cmd_evaluate,
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
