#!/usr/bin/env python3
"""Fail-closed Reader for the mage-scribe-placement Pack's two resident
artifact kinds (`placement-candidate`, `consumer-review`).

One script backs both `readers/*.yml` declarations (the same "one script,
many thin reader declarations" shape as the ATCS Pack's `read-atcs.py`).
Each reader's own `argv` is::

    [/usr/bin/python3, '${READER}', <kind>, '${REPORT}', '${OUT}', '${WORKSPACE}']

so this script's own `sys.argv` is
``[read-mage.py, <kind>, <report path>, <out path>, <workspace path>]`` —
`<kind>` is `placement-candidate` or `consumer-review`.

Deployment: this script is shipped alone into the Campaign workspace's
``hima-readers/<reader-id>/`` directory, never alongside this Pack's own
``flow/`` tree, so it cannot import `mage_placement` via a path relative to
itself. `workspace.source: pack`'s own copy of `flow/` into
``<workspace>/flow/`` is exactly what `${WORKSPACE}` (the fourth
placeholder) lets this script find: `_mage_modules()` inserts
``<workspace>/flow`` onto `sys.path` and imports `mage_placement.*` as a
top-level package, the same way `flow/tests/*.py` do.

Harness contract: this script writes ``{"values": [{"type", "unit",
"value": number|null[, "unknownReason"]}, ...]}`` to `<out path>` — the
*set* of types written always equals the reader's own declared `emits`
exactly, using `unknown()` wherever a fact could not be established. Any
exception escaping `main()`'s inner recompute is caught at the outermost
level and turned into `error_count: 1` plus every other declared fact
`unknown` — a fail-closed Reader never leaves a stale or partial reading
and never raises past its own `main()`.
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
    names = ("core", "metrics", "snapshot", "pla", "consumers", "records")
    return {name: importlib.import_module(f"mage_placement.{name}") for name in names}


_UNITS = {
    "mage_candidate_error_count": "count",
    "mage_priority_unplaced_count": "count",
    "mage_dropped_count": "count",
    "mage_dropped_length_um": "um",
    "mage_target_distance_max_um": "um",
    "mage_target_over_limit_count": "count",
    "mage_order_deviation_max": "rank",
    "mage_native_overlap_rows": "rows",
    "mage_native_space_rows": "rows",
    "mage_native_boundary_rows": "rows",
    "mage_native_violation_total": "rows",
    "mage_open_request_count": "count",
    "mage_review_error_count": "count",
    "mage_review_hard_fail_count": "count",
    "mage_review_request_count": "count",
    "mage_review_unknown_count": "count",
}

_NATIVE_TYPE_FACT = {
    "OVERLAP": "mage_native_overlap_rows", "SPACE": "mage_native_space_rows",
    "BOUNDARY": "mage_native_boundary_rows",
}

CANDIDATE_EMITS = [
    "mage_candidate_error_count", "mage_priority_unplaced_count", "mage_dropped_count",
    "mage_dropped_length_um", "mage_target_distance_max_um", "mage_target_over_limit_count",
    "mage_order_deviation_max",
] + list(_NATIVE_TYPE_FACT.values()) + ["mage_native_violation_total", "mage_open_request_count"]

REVIEW_EMITS = [
    "mage_review_error_count", "mage_review_hard_fail_count", "mage_review_request_count",
    "mage_review_unknown_count",
]


def _known(type_name, value):
    return {"type": type_name, "unit": _UNITS[type_name], "value": value}


def _unknown(type_name, reason):
    return {"type": type_name, "unit": _UNITS[type_name], "value": None, "unknownReason": reason}


def _all_unknown(emits, reason):
    return [_unknown(t, reason) for t in emits]


def _resolve_ref(workspace, ref):
    path = Path(ref["path"])
    if not path.is_absolute():
        path = Path(workspace) / path
    return path


def _priority_unplaced(snap):
    return [p["id"] for p in snap["pending"] if p.get("inGroup")]


def _check_session_log(workspace, doc, mods):
    log_ref = doc.get("files", {}).get("sessionLog")
    if not log_ref:
        # Fail closed, never skip: a candidate that omits its session log
        # entirely must never let the one-writer audit go unperformed.
        # (`records.validate_record` already refuses this via the schema's
        # own `required: ["sessionLog"]` on `files` before this function
        # ever runs; this is the defense-in-depth half of the same rule.)
        raise mods["core"].MageError("missing-input", "candidate has no files.sessionLog to audit")
    # Fail closed on prefix: a resident's support files only reach the
    # Campaign workspace when they sit under its own `artifactPrefix`
    # (`placement/round-NN/` for the Engineer) and are listed in the
    # delivery -- a sessionLog path outside that round's own directory
    # could never actually have been published this way, so it is
    # refused before any read, exactly like a tampered sha256.
    round_no = doc.get("identity", {}).get("round")
    expected_prefix = f"placement/round-{round_no:02d}/" if isinstance(round_no, int) else None
    if expected_prefix is None or not log_ref["path"].startswith(expected_prefix):
        raise mods["core"].MageError(
            "identity-mismatch",
            f"session log path {log_ref['path']!r} is not under this round's own artifact prefix",
        )
    log_path = _resolve_ref(workspace, log_ref)
    if mods["core"].file_sha256(log_path) != log_ref["sha256"]:
        raise mods["core"].MageError("identity-mismatch", "session log bytes changed")
    for line in log_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if entry.get("mutating") and entry.get("role") != "engineer":
            raise mods["core"].MageError("writer", f"mutating round logged under role {entry.get('role')!r}")


def _read_candidate(report_path, workspace, mods):
    core, metrics, snapshot, pla, _consumers, records = (
        mods["core"], mods["metrics"], mods["snapshot"], mods["pla"], mods["consumers"], mods["records"],
    )

    doc = core.read_artifact(report_path, "placement-candidate")
    errors = records.validate_record("placement-candidate", doc)
    if errors:
        raise core.MageError("schema", "; ".join(errors))

    files = doc["files"]
    pla_ref, export_ref, snapshot_ref = files["pla"], files["export"], files["snapshot"]
    for ref in (pla_ref, export_ref, snapshot_ref):
        path = _resolve_ref(workspace, ref)
        if not path.is_file() or core.file_sha256(path) != ref["sha256"]:
            raise core.MageError("identity-mismatch", f"referenced file changed or missing: {path}")

    _check_session_log(workspace, doc, mods)

    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    export_path = _resolve_ref(workspace, export_ref)
    export_doc = pla.read_pla(export_path.read_text(encoding="utf-8"), start["dbuPerUm"])
    rebuilt = snapshot.build_snapshot(
        "candidate", export_doc, start["frame"], start["ruleFacts"], start["targets"], {},
        {"exportPla": export_ref}, pending_from_rules=False,
    )
    if rebuilt["snapshotSha256"] != doc["snapshotSha256"]:
        raise core.MageError("identity-mismatch", "rebuilt candidate snapshot does not match the declared snapshotSha256")

    case_readiness = core.read_artifact(Path(workspace) / "state" / "case-readiness.json", "case-readiness")
    goal = case_readiness["goal"]

    verify_files = {}
    for type_name, ref in files.get("verify", {}).items():
        path = _resolve_ref(workspace, ref)
        if not path.is_file() or core.file_sha256(path) != ref["sha256"]:
            raise core.MageError("identity-mismatch", f"verify file changed or missing: {path}")
        verify_files[type_name] = str(path)

    drops = metrics.drops(rebuilt)
    target = metrics.target_distances(rebuilt, str(goal["max_target_distance_um"]))
    order = metrics.order_deviation(rebuilt)
    native = metrics.native_rows(verify_files)
    priority_unplaced = _priority_unplaced(rebuilt)

    previous_decision = core.read_artifact(Path(workspace) / "state" / "round-decision.json", "round-decision")
    coverage = records.ledger_covers(previous_decision.get("openRequests", []), doc.get("ledger", []))
    open_request_count = len(coverage["unanswered"])

    values = [_known("mage_candidate_error_count", 0)]
    values.append(_known("mage_priority_unplaced_count", len(priority_unplaced)))
    values.append(_known("mage_dropped_count", drops["count"]))
    values.append(_known("mage_dropped_length_um", float(drops["lengthUm"])))
    values.append(_known("mage_target_distance_max_um", float(target["maxUm"])))
    values.append(_known("mage_target_over_limit_count", target["overLimitCount"]))
    values.append(_known("mage_order_deviation_max", order["max"]))
    for type_name, fact in _NATIVE_TYPE_FACT.items():
        count = native["byType"].get(type_name)
        values.append(_known(fact, count) if count is not None else _unknown(fact, f"no verify file for {type_name}"))
    values.append(_known("mage_native_violation_total", native["total"]) if native["total"] is not None
                  else _unknown("mage_native_violation_total", "one or more native verify types is unknown"))
    values.append(_known("mage_open_request_count", open_request_count))
    return values


def _read_review(report_path, workspace, mods):
    core, _metrics, snapshot, _pla, consumers, records = (
        mods["core"], mods["metrics"], mods["snapshot"], mods["pla"], mods["consumers"], mods["records"],
    )

    doc = core.read_artifact(report_path, "consumer-review")
    errors = records.validate_record("consumer-review", doc)
    if errors:
        raise core.MageError("schema", "; ".join(errors))

    candidate_path = Path(workspace) / "state" / "round" / "placement-candidate.json"
    candidate = core.read_artifact(candidate_path, "placement-candidate")
    if doc["snapshotSha256"] != candidate["snapshotSha256"]:
        raise core.MageError("identity-mismatch", "review is bound to a different snapshot than the current candidate")

    consumer_id, _, version = doc["consumerModel"].partition("@")
    models_dir = Path(workspace) / "flow" / "consumer_models"
    model = consumers.load_consumer_model(models_dir, consumer_id)
    if model["version"] != version:
        raise core.MageError("identity-mismatch", f"declared consumer model version {version!r} does not match {model['version']!r}")

    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    candidate_snapshot = snapshot.load_snapshot(_resolve_ref(workspace, candidate["files"]["snapshot"]))
    case_readiness = core.read_artifact(Path(workspace) / "state" / "case-readiness.json", "case-readiness")

    verify_files = {}
    for type_name, ref in candidate["files"].get("verify", {}).items():
        path = _resolve_ref(workspace, ref)
        if path.is_file():
            verify_files[type_name] = str(path)

    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        result = consumers.evaluate(
            model, case_readiness["consumerContext"], candidate_snapshot, start, verify_files, tmp,
            goal=case_readiness["goal"],
        )
    recomputed = result["findings"]

    declared = doc["findings"]
    if len(declared) != len(recomputed):
        raise core.MageError("identity-mismatch", "review finding count does not match the evaluator")
    for given, fresh in zip(declared, recomputed):
        for field in ("status", "severity", "targets", "numbers", "predicate"):
            if given.get(field) != fresh.get(field):
                raise core.MageError("identity-mismatch", f"review finding {given.get('id')!r} field {field!r} does not reproduce")

    hard_fail_count = sum(1 for f in declared if f.get("severity") == "hard" and f.get("status") == "fail")
    unknown_count = sum(1 for f in declared if f.get("status") == "unknown")
    request_count = len(doc.get("requests", []))

    return [
        _known("mage_review_error_count", 0),
        _known("mage_review_hard_fail_count", hard_fail_count),
        _known("mage_review_request_count", request_count),
        _known("mage_review_unknown_count", unknown_count),
    ]


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 4:
        sys.stderr.write(json.dumps({"code": "missing-input", "detail": "usage: read-mage.py <kind> <report> <out> <workspace>"}) + "\n")
        return 2
    kind, report_path, out_path, workspace = argv

    try:
        mods = _mage_modules(workspace)
        if kind == "placement-candidate":
            values = _read_candidate(report_path, workspace, mods)
        elif kind == "consumer-review":
            values = _read_review(report_path, workspace, mods)
        else:
            sys.stderr.write(json.dumps({"code": "missing-input", "detail": f"unknown reader kind: {kind!r}"}) + "\n")
            return 2
    except Exception as exc:  # noqa: BLE001 — fail closed: never leave OUT unwritten or raise past main()
        emits = CANDIDATE_EMITS if kind == "placement-candidate" else REVIEW_EMITS
        error_fact = "mage_candidate_error_count" if kind == "placement-candidate" else "mage_review_error_count"
        values = [_known(error_fact, 1)] + [
            _unknown(t, f"{type(exc).__name__}: {exc}") for t in emits if t != error_fact
        ]

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps({"values": values}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
