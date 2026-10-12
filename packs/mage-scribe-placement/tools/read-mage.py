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

Harness contract: on success this script writes ``{"values": [{"type",
"unit", "value": number|null[, "unknownReason"]}, ...]}`` to `<out path>`
and exits 0 — the *set* of types written always equals the reader's own
declared `emits` exactly, using `unknown()` wherever a fact could not be
established (a missing native verify file, an unbound target), with
``mage_candidate_error_count``/``mage_review_error_count`` always ``0``.

Fail closed (C1): any structural, identity, recompute-mismatch, inventory
or session-log/writer refusal exits NON-ZERO (code 3) with a
``{"code","detail"}`` line on stderr and leaves `<out path>` unwritten —
never a `0` exit carrying ``error_count: 1``. The Harness then marks the
Reader job failed, returns it to the same resident Task as a
``reader-rejected`` repair message, and never admits the unverified
delivery (``durable-task-adapters.ts``). This mirrors the ATCS Reader's
own re-raising posture. Only genuine admitted unknowns (native type /
unbound target) ever ride a successful, ``error_count: 0`` reading.
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
    "mage_dropped_ordinary_count": "count",
    "mage_dropped_ordinary_length_um": "um",
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
    "mage_dropped_length_um", "mage_dropped_ordinary_count", "mage_dropped_ordinary_length_um",
    "mage_target_distance_max_um", "mage_target_over_limit_count",
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


def _check_scripts(workspace, files, mods):
    """Re-hash every `files.scripts[]` entry (round.tcl, experiment.tcl).

    I1: the Reader "re-hashes every referenced file" -- the scripts bind the
    export to the exact round that produced it, so a changed or missing
    script is a fail-closed refusal exactly like a tampered PLA.
    """
    for ref in files.get("scripts", []):
        path = _resolve_ref(workspace, ref)
        if not path.is_file() or mods["core"].file_sha256(path) != ref["sha256"]:
            raise mods["core"].MageError("identity-mismatch", f"candidate script changed or missing: {path}")


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


def _check_inventory(workspace, start, candidate, mods):
    """C4/N2/N7: inventory conservation (Group/Fixed identities + ordinary
    population), delegated to the single shared
    `snapshot.check_inventory_conservation` -- the candidate assembler
    (`mage_placement_cli.py`) re-checks the identical function, so the two
    sides can never disagree on what "conserved" means. A legitimate MAGE
    re-suffix of an instance (same base, same Group, changed suffix) is
    admitted; a deleted, extra, or vanished structure, or an export that no
    longer carries the incumbent's ordinary population, is refused."""
    mods["snapshot"].check_inventory_conservation(
        start, candidate, _incumbent_ordinary_population(workspace, mods),
    )


def _check_session_log(workspace, doc, mods, script_sha0):
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
    entries = []
    for line in log_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        entry = json.loads(line)
        if entry.get("mutating") and entry.get("role") != "engineer":
            raise mods["core"].MageError("writer", f"mutating round logged under role {entry.get('role')!r}")
        entries.append(entry)
    # I1: an empty session log can never back a real export -- refuse it,
    # never admit the candidate as if its round had been logged.
    if not entries:
        raise mods["core"].MageError("writer", "session log is empty; no logged round backs this candidate")
    # I1: a candidate claiming `completed` must be backed by a logged
    # Engineer round that itself completed, whose script sha matches the
    # candidate's own first script (round.tcl). Anything less is a
    # best-effort/blocked claim dressed as a completed one -- refused.
    if doc.get("outcome") == "completed":
        last = entries[-1]
        if last.get("role") != "engineer":
            raise mods["core"].MageError("writer", f"completed candidate's last logged round is role {last.get('role')!r}")
        if not last.get("completed"):
            raise mods["core"].MageError(
                "identity-mismatch", "candidate claims completed but the session log's last round did not complete"
            )
        if script_sha0 is not None and last.get("scriptSha256") != script_sha0:
            raise mods["core"].MageError(
                "identity-mismatch", "completed candidate's round.tcl sha does not match the logged round"
            )


def _candidate_unknowns(reason):
    """Every candidate fact unknown except `mage_candidate_error_count` (0),
    in the declared order -- a blocked candidate claims no metric (I1)."""
    values = []
    for type_name in CANDIDATE_EMITS:
        if type_name == "mage_candidate_error_count":
            values.append(_known(type_name, 0))
        else:
            values.append(_unknown(type_name, reason))
    return values


def _read_candidate(report_path, workspace, mods):
    core, metrics, snapshot, pla, _consumers, records = (
        mods["core"], mods["metrics"], mods["snapshot"], mods["pla"], mods["consumers"], mods["records"],
    )

    doc = core.read_artifact(report_path, "placement-candidate")
    errors = records.validate_record("placement-candidate", doc)
    if errors:
        raise core.MageError("schema", "; ".join(errors))

    # N4: every Ledger entry is schema-validated here too (the candidate
    # assembler already validates on write) -- a mis-scoped or bare Request
    # id in a Ledger entry is a fail-closed refusal, never silently ignored.
    for entry in doc.get("ledger", []):
        ledger_errors = records.validate_record("ledger-entry", entry)
        if ledger_errors:
            raise core.MageError("schema", "; ".join(ledger_errors))

    files = doc["files"]
    scripts = files.get("scripts", [])
    _check_scripts(workspace, files, mods)
    script_sha0 = scripts[0]["sha256"] if scripts else None
    _check_session_log(workspace, doc, mods, script_sha0)

    # I1: a candidate that did not complete claims no metric -- it is read
    # as every-fact-unknown (error_count 0), never as a measured state that
    # could become `best`. Its export/snapshot are not required to exist.
    outcome = doc.get("outcome")
    if outcome != "completed":
        return _candidate_unknowns(f"candidate outcome is {outcome!r}; no metrics claimed")

    pla_ref, export_ref, snapshot_ref = files["pla"], files["export"], files["snapshot"]
    for ref in (pla_ref, export_ref, snapshot_ref):
        path = _resolve_ref(workspace, ref)
        if not path.is_file() or core.file_sha256(path) != ref["sha256"]:
            raise core.MageError("identity-mismatch", f"referenced file changed or missing: {path}")

    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    export_path = _resolve_ref(workspace, export_ref)
    export_doc = pla.read_pla(export_path.read_text(encoding="utf-8"), start["dbuPerUm"])
    rebuilt = snapshot.build_snapshot(
        "candidate", export_doc, start["frame"], start["ruleFacts"], start["targets"], {},
        {"exportPla": export_ref}, pending_from_rules=False,
    )
    if rebuilt["snapshotSha256"] != doc["snapshotSha256"]:
        raise core.MageError("identity-mismatch", "rebuilt candidate snapshot does not match the declared snapshotSha256")

    # C4/N7: a start structure that vanished (neither placed nor dropped),
    # or an export that no longer carries the incumbent's ordinary
    # population, is a fail-closed refusal, never a metric improvement.
    _check_inventory(workspace, start, rebuilt, mods)

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

    target_reason = target.get("unknownReason") or "target distance is unknown"
    order_reason = order.get("unknownReason") or "order deviation is unknown"

    values = [_known("mage_candidate_error_count", 0)]
    values.append(_known("mage_priority_unplaced_count", len(priority_unplaced)))
    values.append(_known("mage_dropped_count", drops["count"]))
    values.append(_known("mage_dropped_length_um", float(drops["lengthUm"])))
    values.append(_known("mage_dropped_ordinary_count", drops["ordinary"]["count"]))
    values.append(_known("mage_dropped_ordinary_length_um", float(drops["ordinary"]["lengthUm"])))
    # C4: an unbound target reads as unknown, never 0.
    values.append(_known("mage_target_distance_max_um", float(target["maxUm"]))
                  if target["maxUm"] is not None else _unknown("mage_target_distance_max_um", target_reason))
    values.append(_known("mage_target_over_limit_count", target["overLimitCount"])
                  if target["overLimitCount"] is not None else _unknown("mage_target_over_limit_count", target_reason))
    values.append(_known("mage_order_deviation_max", order["max"])
                  if order["max"] is not None else _unknown("mage_order_deviation_max", order_reason))
    for type_name, fact in _NATIVE_TYPE_FACT.items():
        count = native["byType"].get(type_name)
        values.append(_known(fact, count) if count is not None else _unknown(fact, f"no verify file for {type_name}"))
    values.append(_known("mage_native_violation_total", native["total"]) if native["total"] is not None
                  else _unknown("mage_native_violation_total", "one or more native verify types is unknown"))
    values.append(_known("mage_open_request_count", open_request_count))
    return values


def _slot_from_report_path(report_path):
    """N3: the consumer slot a review was delivered for, parsed from the
    REPORT file name `review-<slot>.json`. The Reader receives the report
    path as its own argv, so the on-disk delivery slot is the robust source
    of truth (a review whose declared `consumer` disagrees with the slot it
    was delivered into is refused). Returns `None` when the file name does
    not match that shape (e.g. a probe or batch path), in which case the
    slot check is skipped."""
    name = Path(report_path).name
    if name.startswith("review-") and name.endswith(".json"):
        return name[len("review-"):-len(".json")]
    return None


def _read_review(report_path, workspace, mods):
    core, _metrics, snapshot, _pla, consumers, records = (
        mods["core"], mods["metrics"], mods["snapshot"], mods["pla"], mods["consumers"], mods["records"],
    )

    doc = core.read_artifact(report_path, "consumer-review")
    errors = records.validate_record("consumer-review", doc)
    if errors:
        raise core.MageError("schema", "; ".join(errors))

    # N3: the review's own `consumer` must equal the slot it was delivered
    # for (`review-<slot>.json`). A WAT resident that ran
    # `evaluate/review --consumer litho-pie` and delivered it into the wat
    # slot is refused here, so a wrong-consumer review can never ride through
    # as a clean consumer.
    slot = _slot_from_report_path(report_path)
    if slot is not None and doc.get("consumer") != slot:
        raise core.MageError(
            "identity-mismatch",
            f"review consumer {doc.get('consumer')!r} does not match its delivery slot {slot!r}",
        )

    candidate_path = Path(workspace) / "state" / "round" / "placement-candidate.json"
    candidate = core.read_artifact(candidate_path, "placement-candidate")

    # N1: a non-completed (blocked) candidate carries no `files.snapshot`, so
    # its review is an *empty review* -- validated WITHOUT reading any
    # snapshot and bound to the candidate id (not the snapshot sha, which a
    # blocked candidate shares with the start state). It emits error 0 and
    # zero counts.
    if candidate.get("outcome") != "completed":
        if doc.get("candidateOutcome") != "blocked":
            raise core.MageError(
                "identity-mismatch",
                "candidate is blocked but the review does not declare candidateOutcome: blocked",
            )
        if doc.get("candidateId") != candidate.get("id"):
            raise core.MageError("identity-mismatch", "blocked review is not bound to the current candidate id")
        if doc.get("findings") or doc.get("requests"):
            raise core.MageError("identity-mismatch", "a blocked candidate's review must carry no findings or requests")
        if doc.get("identity", {}).get("round") != candidate.get("identity", {}).get("round"):
            raise core.MageError("identity-mismatch", "review round does not match the current candidate's round")
        return [
            _known("mage_review_error_count", 0),
            _known("mage_review_hard_fail_count", 0),
            _known("mage_review_request_count", 0),
            _known("mage_review_unknown_count", 0),
        ]

    if doc["snapshotSha256"] != candidate["snapshotSha256"]:
        raise core.MageError("identity-mismatch", "review is bound to a different snapshot than the current candidate")
    # N1: when a review carries a candidate id it must match the current
    # candidate's -- binding by id as well as by snapshot sha.
    if doc.get("candidateId") and doc.get("candidateId") != candidate.get("id"):
        raise core.MageError("identity-mismatch", "review candidateId does not match the current candidate")

    consumer_id, _, version = doc["consumerModel"].partition("@")
    # I5: the review's own `consumer` must equal the consumer named by its
    # `consumerModel`, and its round must equal the candidate's round.
    if doc.get("consumer") != consumer_id:
        raise core.MageError("identity-mismatch", "review consumer does not match its consumerModel")
    if doc.get("identity", {}).get("round") != candidate.get("identity", {}).get("round"):
        raise core.MageError("identity-mismatch", "review round does not match the current candidate's round")
    # I5: every Request must reference a Finding in THIS review and name THIS
    # review's consumer -- a Request can never answer another consumer's
    # Finding, and a Ledger entry can never cross consumers.
    finding_ids = {f.get("id") for f in doc.get("findings", [])}
    for request in doc.get("requests", []):
        if request.get("consumer") != doc.get("consumer"):
            raise core.MageError("identity-mismatch", f"request {request.get('id')!r} consumer does not match the review")
        if request.get("fromFinding") not in finding_ids:
            raise core.MageError("identity-mismatch", f"request {request.get('id')!r} fromFinding names no Finding in this review")

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
    except Exception as exc:  # noqa: BLE001
        # C1: the Reader FAILS CLOSED -- any structural, identity,
        # recompute-mismatch, inventory or session-log/writer refusal exits
        # non-zero (never a `0` exit carrying `error_count: 1`), so the
        # Harness marks the Reader job failed, turns it into a
        # `reader-rejected` repair message to the same resident Task, and
        # never admits an unverified delivery. Exactly the ATCS Reader's
        # own posture (`read-atcs.py` re-raises). "Native type unknown" and
        # "unbound target unknown" are NOT refusals -- they are admitted
        # unknowns emitted with `error_count: 0` inside the read functions,
        # never reaching here. `OUT` is left unwritten on refusal.
        code = getattr(exc, "code", type(exc).__name__)
        detail = getattr(exc, "detail", str(exc))
        sys.stderr.write(json.dumps({"code": code, "detail": detail}, sort_keys=True) + "\n")
        return 3

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(json.dumps({"values": values}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
