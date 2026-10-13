#!/usr/bin/env python3
"""Fail-closed Reader for the mage-script-placement Pack's single resident
artifact kind (`mage.script-candidate/1`).

One script backs `readers/mage-script-candidate.yml`'s declaration (the same
"one script, one thin reader declaration" shape as the ATCS Pack's
`read-atcs.py`). The reader's own `argv` is::

    [/usr/bin/python3, '${READER}', script-candidate, '${REPORT}', '${OUT}', '${WORKSPACE}']

so this script's own `sys.argv` is
``[read-mage.py, script-candidate, <report path>, <out path>, <workspace path>]``.

Deployment: this script is shipped alone into the Campaign workspace's
``hima-readers/<reader-id>/`` directory, never alongside this Pack's own
``flow/`` tree, so it cannot import `mage_placement` via a path relative to
itself. `workspace.source: pack`'s own copy of `flow/` into
``<workspace>/flow/`` is exactly what `${WORKSPACE}` (the fourth
placeholder) lets this script find: `_mage_modules()` inserts
``<workspace>/flow`` onto `sys.path` and imports `mage_placement.*` as a
top-level package, the same way `flow/tests/*.py` do.

Harness contract: on success this script writes ``{"values": [{"type",
"unit", "value": number|null[, "unknownReason"]}, ...]}`` to `<out path>`
and exits 0 -- the *list* of types written always equals the reader's own
declared `emits` exactly and in the declared order, using `unknown()`
wherever a fact could not be established (a missing native verify file, an
unbound target, an unmatched priority mark), with
``mage_candidate_error_count`` always ``0``. A blocked (non-completed)
candidate reads ``mage_candidate_error_count`` 0 and every other fact
unknown -- it claims no metric.

Fail closed (C1): any structural, identity, recompute-mismatch, inventory
or session-log/stage-binding refusal exits NON-ZERO (code 3) with a
``{"code","detail"}`` line on stderr and leaves `<out path>` unwritten --
never a `0` exit carrying ``error_count: 1``. The Harness then marks the
Reader job failed, returns it to the same resident Task as a
``reader-rejected`` repair message, and never admits the unverified
delivery (``durable-task-adapters.ts``). This mirrors the ATCS Reader's
own re-raising posture. Only genuine admitted unknowns (native type /
unbound target / unmatched priority mark) ever ride a successful,
``error_count: 0`` reading.
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path


def _mage_modules(workspace):
    flow_dir = str(Path(workspace) / "flow")
    if flow_dir not in sys.path:
        sys.path.insert(0, flow_dir)
    names = ("core", "metrics", "snapshot", "pla", "records")
    return {name: importlib.import_module(f"mage_placement.{name}") for name in names}


_UNITS = {
    "mage_candidate_error_count": "count", "mage_priority_unplaced_count": "count",
    "mage_dropped_count": "count", "mage_dropped_length_um": "um",
    "mage_dropped_ordinary_count": "count", "mage_dropped_ordinary_length_um": "um",
    "mage_target_distance_max_um": "um", "mage_target_over_limit_count": "count",
    "mage_order_deviation_max": "rank", "mage_order_deviation_max_lr": "rank", "mage_order_deviation_max_tb": "rank",
    "mage_priority_move_max_um": "um", "mage_priority_moved_count": "count",
    "mage_native_overlap_rows": "rows", "mage_native_space_rows": "rows", "mage_native_boundary_rows": "rows",
    "mage_native_violation_total": "rows",
}

_NATIVE_TYPE_FACT = {"OVERLAP": "mage_native_overlap_rows", "SPACE": "mage_native_space_rows", "BOUNDARY": "mage_native_boundary_rows"}

CANDIDATE_EMITS = [
    "mage_candidate_error_count", "mage_priority_unplaced_count", "mage_dropped_count", "mage_dropped_length_um",
    "mage_dropped_ordinary_count", "mage_dropped_ordinary_length_um", "mage_target_distance_max_um",
    "mage_target_over_limit_count", "mage_order_deviation_max", "mage_order_deviation_max_lr",
    "mage_order_deviation_max_tb", "mage_priority_move_max_um", "mage_priority_moved_count",
] + list(_NATIVE_TYPE_FACT.values()) + ["mage_native_violation_total"]


def _known(type_name, value):
    return {"type": type_name, "unit": _UNITS[type_name], "value": value}


def _unknown(type_name, reason):
    return {"type": type_name, "unit": _UNITS[type_name], "value": None, "unknownReason": reason}


def _resolve_ref(workspace, ref):
    path = Path(ref["path"])
    if not path.is_absolute():
        path = Path(workspace) / path
    return path


def _incumbent_ordinary_population(workspace, mods):
    """N7: the incumbent's measured ordinary population from
    `state/incumbent.json` (`ordinaryPopulation`), or `None` when no
    incumbent has been measured in this workspace. The Reader already reads
    Campaign `state/` files; on the live Campaign `measure-incumbent` always
    runs before any round, so the anchor is always present on the real
    path."""
    path = Path(workspace) / "state" / "incumbent.json"
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return doc.get("ordinaryPopulation")


def _check_ref(workspace, ref, label, mods):
    path = _resolve_ref(workspace, ref)
    if not path.is_file() or mods["core"].file_sha256(path) != ref["sha256"]:
        raise mods["core"].MageError("identity-mismatch", f"{label} changed or missing: {path}")
    return path


def _check_session_log(workspace, doc, mods):
    files = doc["files"]
    round_no = doc.get("identity", {}).get("round")
    prefix = f"placement/round-{round_no:02d}/" if isinstance(round_no, int) else None
    for key in ("script", "stageScript", "sessionLog", "journal"):
        if prefix is None or not files[key]["path"].startswith(prefix):
            raise mods["core"].MageError("identity-mismatch", f"{key} path {files[key]['path']!r} is not under this round's artifact prefix")
    log_path = _check_ref(workspace, files["sessionLog"], "session log", mods)
    entries = [json.loads(l) for l in log_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not entries:
        raise mods["core"].MageError("writer", "session log is empty; no logged stage backs this candidate")
    for entry in entries:
        if entry.get("role") != "engineer":
            raise mods["core"].MageError("writer", f"stage logged under role {entry.get('role')!r}")
    if doc.get("outcome") == "completed":
        stage_sha = files["stageScript"]["sha256"]; export_sha = files["export"]["sha256"]
        if not any(e.get("completed") and e.get("stageSha256") == stage_sha and e.get("exportSha256") == export_sha for e in entries):
            raise mods["core"].MageError("identity-mismatch", "no completed logged stage matches the delivered stage.tcl and export")


def _candidate_unknowns(reason):
    return [_known(t, 0) if t == "mage_candidate_error_count" else _unknown(t, reason) for t in CANDIDATE_EMITS]


def _read_candidate(report_path, workspace, mods):
    core, metrics, snapshot, pla, records = mods["core"], mods["metrics"], mods["snapshot"], mods["pla"], mods["records"]
    doc = core.read_artifact(report_path, "script-candidate")
    errors = records.validate_record("script-candidate", doc)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    files = doc["files"]
    for key in ("script", "stageScript", "journal"):
        _check_ref(workspace, files[key], key, mods)
    journal = json.loads(_resolve_ref(workspace, files["journal"]).read_text(encoding="utf-8"))
    journal_errors = records.validate_record("journal-entry", journal)
    if journal_errors or journal.get("round") != doc["identity"]["round"]:
        raise core.MageError("schema", "; ".join(journal_errors) or "journal entry round does not match the candidate")
    for snap_ref in files.get("snapshots", []):
        _check_ref(workspace, snap_ref, f"boundary snapshot {snap_ref.get('name')}", mods)
    _check_session_log(workspace, doc, mods)
    if doc.get("outcome") != "completed":
        return _candidate_unknowns(f"candidate outcome is {doc.get('outcome')!r}; no metrics claimed")

    export_path = _check_ref(workspace, files["export"], "export", mods)
    _check_ref(workspace, files["snapshot"], "snapshot", mods)
    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    export_doc = pla.read_pla(export_path.read_text(encoding="utf-8"), start["dbuPerUm"])
    rebuilt = snapshot.build_snapshot("candidate", export_doc, start["frame"], start["ruleFacts"], start["targets"], {},
                                      {"exportPla": files["export"]}, pending_from_rules=False)
    if rebuilt["snapshotSha256"] != doc["snapshotSha256"]:
        raise core.MageError("identity-mismatch", "rebuilt candidate snapshot does not match the declared snapshotSha256")
    snapshot.check_inventory_conservation(start, rebuilt, _incumbent_ordinary_population(workspace, mods))
    goal = core.read_artifact(Path(workspace) / "state" / "case-readiness.json", "case-readiness")["goal"]
    verify_files = {t: str(_check_ref(workspace, ref, f"verify {t}", mods)) for t, ref in files.get("verify", {}).items()}

    drops = metrics.drops(rebuilt)
    target = metrics.target_distances(rebuilt, str(goal["max_target_distance_um"]))
    order = metrics.order_deviation(rebuilt)
    moved = metrics.displacement(start, rebuilt)["priority"]
    native = metrics.native_rows(verify_files)
    unplaced = [p["id"] for p in rebuilt["pending"] if p.get("inGroup")]
    t_reason = target.get("unknownReason") or "target distance is unknown"
    o_reason = order.get("unknownReason") or "order deviation is unknown"

    def kn(name, value, reason):
        return _known(name, value) if value is not None else _unknown(name, reason)

    values = [_known("mage_candidate_error_count", 0), _known("mage_priority_unplaced_count", len(unplaced)),
              _known("mage_dropped_count", drops["count"]), _known("mage_dropped_length_um", float(drops["lengthUm"])),
              _known("mage_dropped_ordinary_count", drops["ordinary"]["count"]),
              _known("mage_dropped_ordinary_length_um", float(drops["ordinary"]["lengthUm"])),
              kn("mage_target_distance_max_um", None if target["maxUm"] is None else float(target["maxUm"]), t_reason),
              kn("mage_target_over_limit_count", target["overLimitCount"], t_reason),
              kn("mage_order_deviation_max", order["max"], o_reason),
              kn("mage_order_deviation_max_lr", order["maxLr"], o_reason),
              kn("mage_order_deviation_max_tb", order["maxTb"], o_reason),
              kn("mage_priority_move_max_um", None if moved["maxUm"] is None else float(moved["maxUm"]),
                 "a start priority mark could not be matched: " + ", ".join(moved["unmatched"])),
              _known("mage_priority_moved_count", moved["movedCount"])]
    for type_name, fact in _NATIVE_TYPE_FACT.items():
        values.append(kn(fact, native["byType"].get(type_name), f"no verify file for {type_name}"))
    values.append(kn("mage_native_violation_total", native["total"], "one or more native verify types is unknown"))
    return values


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 4:
        sys.stderr.write(json.dumps({"code": "missing-input", "detail": "usage: read-mage.py <kind> <report> <out> <workspace>"}) + "\n")
        return 2
    kind, report_path, out_path, workspace = argv

    try:
        mods = _mage_modules(workspace)
        if kind == "script-candidate":
            values = _read_candidate(report_path, workspace, mods)
        else:
            sys.stderr.write(json.dumps({"code": "missing-input", "detail": f"unknown reader kind: {kind!r}"}) + "\n")
            return 2
    except Exception as exc:  # noqa: BLE001
        # C1: the Reader FAILS CLOSED -- any structural, identity,
        # recompute-mismatch, inventory or session-log/stage-binding refusal
        # exits non-zero (never a `0` exit carrying `error_count: 1`), so the
        # Harness marks the Reader job failed, turns it into a
        # `reader-rejected` repair message to the same resident Task, and
        # never admits an unverified delivery. Exactly the ATCS Reader's
        # own posture (`read-atcs.py` re-raises). "Native type unknown",
        # "unbound target unknown" and "unmatched priority mark" are NOT
        # refusals -- they are admitted unknowns emitted with
        # `error_count: 0` inside `_read_candidate`, never reaching here.
        # `OUT` is left unwritten on refusal.
        code = getattr(exc, "code", type(exc).__name__)
        detail = getattr(exc, "detail", str(exc))
        sys.stderr.write(json.dumps({"code": code, "detail": detail}, sort_keys=True) + "\n")
        return 3

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps({"values": values}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
