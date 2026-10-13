"""The program-task ABI adapters of the mage-script-placement Pack
(mirrors the ATCS Pack's `atcs/business_tasks.py:execute`).

Each function takes `(workspace, inputs)` — `inputs` is the plain dict read
from the task's `TASK_INPUT` JSON file, keyed by the graph's own bound
input names (`MAGE_CASE_MANIFEST`, `CASE`, ...) — and returns
`{"schemaVersion": "1", "value": ..., "artifacts": [...], "diagnostics": []}`
exactly as `atcs_cli.py:main`'s `task-` branch expects, so the dispatcher
can write it straight to `TASK_OUTPUT` with `core.write_artifact`.
"""
from __future__ import annotations

import json
import os
import tarfile
from pathlib import Path

from . import core, metrics as metrics_mod, pla, records, rounds, rules, snapshot, targets


NATIVE_TYPES = metrics_mod.NATIVE_TYPES
RULE_IDS = rounds.RULE_IDS


def _artifact(name, path):
    return {"name": name, "path": path, "mediaType": "application/json"}


def _verify_file(workspace, ref, label):
    path = Path(workspace) / ref["path"] if not os.path.isabs(ref["path"]) else Path(ref["path"])
    if not path.is_file() or core.file_sha256(path) != ref["sha256"]:
        raise core.MageError("identity-mismatch", f"{label} bytes changed or are missing: {path}")
    return path


def _load_case(manifest_path):
    """Verify every manifest file digest and parse the whole case into
    `(manifest, dbu_per_um, frame, rule_facts, block_types, targets_bound, start_pla, start_text, incumbent_pla, incumbent_text)`.

    `referenceMethod` (optional) is a `fileRef` naming an external
    baseline/reference method's own script -- verified by digest exactly
    like `frb`/`rule`/etc when present, carried into the returned case
    dict for `case-readiness` to expose, and never replayed as a result:
    this Pack only records its identity, it never runs it.
    """
    manifest = core.read_artifact(manifest_path, "case-manifest")
    dbu_per_um = manifest["dbuPerUm"]

    for key in ("frb", "prj", "rule", "pblock", "block", "targetTable", "requestOrder", "startState", "incumbentState"):
        _verify_file(Path(manifest_path).parent, manifest[key], key)
    for entry in manifest.get("clusterTcl", []):
        _verify_file(Path(manifest_path).parent, entry, "clusterTcl")
    if manifest.get("referenceMethod") is None:
        raise core.MageError("missing-input", "manifest names no referenceMethod")
    _verify_file(Path(manifest_path).parent, manifest["referenceMethod"], "referenceMethod")
    for entry in manifest.get("referenceFiles", []):
        _verify_file(Path(manifest_path).parent, entry, "referenceFiles")
    for entry in manifest.get("referenceNotes", []):
        _verify_file(Path(manifest_path).parent, entry, "referenceNotes")

    rule_text = Path(manifest["rule"]["path"]).read_text(encoding="utf-8")
    pblock_text = Path(manifest["pblock"]["path"]).read_text(encoding="utf-8")
    block_text = Path(manifest["block"]["path"]).read_text(encoding="utf-8")
    target_csv_text = Path(manifest["targetTable"]["path"]).read_text(encoding="utf-8")
    start_text = Path(manifest["startState"]["path"]).read_text(encoding="utf-8")
    incumbent_text = Path(manifest["incumbentState"]["path"]).read_text(encoding="utf-8")

    frame = rules.frame_from_rule(rule_text, pblock_text, dbu_per_um)
    rule_facts = rules.read_rule_facts(rule_text, dbu_per_um)
    block_types = rules.read_block_types(block_text, dbu_per_um)
    tolerance_um = manifest["partitionRule"]["toleranceUm"]
    targets_raw = targets.read_targets(target_csv_text, frame, dbu_per_um, tolerance_um)

    start_pla = pla.read_pla(start_text, dbu_per_um)
    incumbent_pla = pla.read_pla(incumbent_text, dbu_per_um)
    targets_bound = targets.bind_targets(targets_raw, start_pla["groups"], start_pla["fits"])

    return {
        "manifest": manifest, "dbuPerUm": dbu_per_um, "frame": frame, "ruleFacts": rule_facts,
        "blockTypes": block_types, "targets": targets_bound, "targetsRaw": targets_raw,
        "startPla": start_pla, "incumbentPla": incumbent_pla,
    }


def _incumbent_target_identity(targets_raw, start_targets_bound, start_pla, incumbent_pla):
    """Bind `targets_raw` against the incumbent's own Group target points
    first (`identity.method: 'group-point'`); fall back to carrying each
    target's fit id over from the start snapshot (`identity.method:
    'fit-id'`) when the incumbent's Group points/labels no longer match the
    CSV one-for-one -- the real vendor post-refine incumbent PLA's own
    Group target points differ from the CSV targets for most groups and
    Group labels get renumbered (F8, spec section 9/13's identity-unknown
    case), so binding by Group point there raises `MageError('identity')`.

    Returns `(bound_targets, identity)`; `identity` is `{method,
    groupPointsMatchingCsv, unmatchedTargets, inGroupRelabels}`.
    `groupPointsMatchingCsv` counts, independent of which method actually
    bound the result, how many CSV rows' CT point exactly matches some
    incumbent Group's own target point. `inGroupRelabels` (fit-id method
    only) counts incumbent Group labels (`pinstGroup`) absent from the
    start snapshot's own Group labels -- a renumbered/relabelled Group.
    """
    incumbent_groups, incumbent_fits = incumbent_pla["groups"], incumbent_pla["fits"]
    incumbent_group_points = {tuple(group["targetPointDbu"]) for group in incumbent_groups}
    matching_points = sum(1 for row in targets_raw if tuple(row["ctDbu"]) in incumbent_group_points)

    try:
        bound = targets.bind_targets(targets_raw, incumbent_groups, incumbent_fits)
        identity = {
            "method": "group-point", "groupPointsMatchingCsv": matching_points,
            "unmatchedTargets": 0, "inGroupRelabels": 0,
        }
        return bound, identity
    except core.MageError as exc:
        if exc.code != "identity":
            raise

    incumbent_fit_ids = {fit["id"] for fit in incumbent_fits}
    start_group_names = {group["pinstGroup"] for group in start_pla["groups"]}
    incumbent_group_names = {group["pinstGroup"] for group in incumbent_groups}

    bound, unmatched = [], 0
    for start_row in start_targets_bound:
        entry = dict(start_row)
        fit_id = start_row.get("fitId")
        if fit_id in incumbent_fit_ids:
            entry["fitId"] = fit_id
        else:
            entry["fitId"] = None
            unmatched += 1
        bound.append(entry)

    identity = {
        "method": "fit-id", "groupPointsMatchingCsv": matching_points,
        "unmatchedTargets": unmatched,
        "inGroupRelabels": len(incumbent_group_names - start_group_names),
    }
    return bound, identity


def _priority_unplaced(snap):
    ids = [p["id"] for p in snap["pending"] if p.get("inGroup")]
    return {"count": len(ids), "ids": ids}


def prepare_case(workspace, inputs):
    workspace = Path(workspace)
    manifest_path, site_capabilities_path = (
        inputs["MAGE_CASE_MANIFEST"], inputs["SITE_CAPABILITIES"],
    )
    case = _load_case(manifest_path)

    start_inputs = {"startState": dict(case["manifest"]["startState"])}
    start_snapshot = snapshot.build_snapshot(
        "start", case["startPla"], case["frame"], case["ruleFacts"], case["targets"],
        case["blockTypes"], start_inputs, pending_from_rules=True,
    )
    core.write_artifact(workspace / "state" / "start-snapshot.json", start_snapshot)

    site_capabilities_text = Path(site_capabilities_path).read_text(encoding="utf-8")
    site_capabilities = json.loads(site_capabilities_text)
    if site_capabilities.get("schema") != "mage.site-capabilities/1":
        raise core.MageError("schema-mismatch", "siteCapabilities is not a mage.site-capabilities/1 document")
    site_capabilities_sha256 = core.file_sha256(site_capabilities_path)

    goal = _goal(inputs)
    manifest = case["manifest"]
    reference = {k: manifest.get(k) for k in
                 ("referenceMethod", "referenceFiles", "referenceNotes", "referenceOrdinaryDropLengthUm")}

    case_readiness = core.stamp("case-readiness", {
        "goal": goal,
        "manifestSha256": core.file_sha256(manifest_path),
        "siteCapabilitiesSha256": site_capabilities_sha256,
        "ruleFactsSummary": {"count": len(case["ruleFacts"])},
        "blockTypes": {"count": len(case["blockTypes"])},
        "manifest": manifest,
        "siteCapabilities": site_capabilities,
        "reference": reference,
    })
    core.write_artifact(workspace / "state" / "case-readiness.json", case_readiness)

    round0 = core.stamp("round-decision", {
        "round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None,
        "history": [], "stopReason": "", "goalMet": False, "rules": {}, "blockedRound": False,
    })
    core.write_artifact(workspace / "state" / "round-decision.json", round0)

    journal = core.stamp("method-journal", {"entries": [], "bestRound": None})
    core.write_artifact(workspace / "state" / "method-journal.json", journal)

    value = {
        "MAGE_CASE_MANIFEST": manifest_path,
        "SITE_CAPABILITIES": site_capabilities_path,
        "readinessId": case_readiness["id"], "startSnapshotSha256": start_snapshot["snapshotSha256"],
    }
    artifacts = [
        _artifact("case-readiness", "state/case-readiness.json"),
        _artifact("start-snapshot", "state/start-snapshot.json"),
        _artifact("round-decision", "state/round-decision.json"),
        _artifact("method-journal", "state/method-journal.json"),
    ]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def measure_incumbent(workspace, inputs):
    workspace = Path(workspace)
    case_input = inputs["CASE"]
    native_requested = inputs.get("INCUMBENT_COMPARISON") == "native"

    case = _load_case(case_input["MAGE_CASE_MANIFEST"])
    start_snapshot = snapshot.load_snapshot(workspace / "state" / "start-snapshot.json")
    case_readiness = core.read_artifact(workspace / "state" / "case-readiness.json", "case-readiness")
    goal = case_readiness["goal"]

    incumbent_targets, target_identity = _incumbent_target_identity(
        case["targetsRaw"], case["targets"], case["startPla"], case["incumbentPla"],
    )

    incumbent_inputs = {"incumbentState": dict(case["manifest"]["incumbentState"])}
    incumbent_snapshot = snapshot.build_snapshot(
        "incumbent", case["incumbentPla"], case["frame"], case["ruleFacts"], incumbent_targets,
        case["blockTypes"], incumbent_inputs, pending_from_rules=False,
    )

    target_distances = metrics_mod.target_distances(incumbent_snapshot, str(goal["max_target_distance_um"]))
    # F8 (identity-unknown): a target-distance number computed against a
    # fit-id-fallback binding is not comparable to a real Group-point
    # measurement -- `evaluate_placement`'s Q2 comparison must read this
    # flag and report `unknown` rather than a delta whenever it is set.
    target_distances["identity"] = "identity-unknown" if target_identity["method"] == "fit-id" else "known"

    computed_metrics = {
        "drops": metrics_mod.drops(incumbent_snapshot),
        "targetDistances": target_distances,
        "orderDeviation": metrics_mod.order_deviation(incumbent_snapshot),
        "displacement": metrics_mod.displacement(start_snapshot, incumbent_snapshot),
        "priorityUnplaced": _priority_unplaced(incumbent_snapshot),
        "identity": target_identity,
    }

    # N7: the ordinary (non-group) population of the incumbent export -- the
    # count every delivered round must also carry, anchoring the shared
    # inventory check so an export that simply omits ordinary structures can
    # never read as a (false) improvement. Measured here, once, from the
    # incumbent export and never from the start's rule-derived pending.
    ordinary_population = snapshot.ordinary_population(incumbent_snapshot)

    incumbent_doc = core.stamp("incumbent-measure", {
        "stage": "incumbent", "evidence": "modelled", "nativeRequested": native_requested,
        "snapshotSha256": incumbent_snapshot["snapshotSha256"], "metrics": computed_metrics,
        "ordinaryPopulation": ordinary_population,
    })
    core.write_artifact(workspace / "state" / "incumbent.json", incumbent_doc)

    value = {
        "incumbentId": incumbent_doc["id"], "snapshotSha256": incumbent_snapshot["snapshotSha256"],
        "metrics": computed_metrics, "ordinaryPopulation": ordinary_population,
        "evidence": "modelled", "nativeRequested": native_requested,
    }
    artifacts = [_artifact("incumbent-measure", "state/incumbent.json")]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def _goal(inputs):
    return {"target_dropped_count": inputs["TARGET_DROPPED"],
            "max_target_distance_um": inputs["MAX_TARGET_DISTANCE_UM"],
            "max_order_deviation_lr": inputs["MAX_ORDER_DEVIATION_LR"],
            "max_order_deviation_tb": inputs["MAX_ORDER_DEVIATION_TB"],
            "max_priority_move_um": inputs["MAX_PRIORITY_MOVE_UM"]}


def _committed_document(workspace, resident_output, path, kind):
    observations = resident_output.get("observations", [])
    if len(observations) != 1:
        raise core.MageError("identity-mismatch", f"expected exactly one observation for {kind}")
    full = Path(workspace) / path
    if not full.is_file() or core.file_sha256(full) != observations[0]["contentSha256"]:
        raise core.MageError("identity-mismatch", f"{kind} bytes at {full} do not match the committed observation")
    doc = dict(core.read_artifact(full, kind))
    doc["_readerValues"] = observations[0].get("values", [])
    return doc


def decide_round(workspace, inputs):
    workspace = Path(workspace)
    round_no = int(inputs["ROUND"])
    candidate = _committed_document(workspace, inputs["CANDIDATE"], "state/round/script-candidate.json", "script-candidate")
    previous = core.read_artifact(workspace / "state" / "round-decision.json", "round-decision")
    decision = rounds.decide(workspace, round_no, _goal(inputs), candidate, previous)
    value = {"route": decision["route"], "nextRound": decision["nextRound"], "best": decision["best"],
             "stopReason": decision["stopReason"], "goalMet": decision["goalMet"], "rules": decision["rules"],
             "journalEntries": decision.get("_journalEntries", 0)}
    artifacts = [_artifact("round-decision", "state/round-decision.json"), _artifact("script-result", "state/script-result.json"),
                 _artifact("method-journal", "state/method-journal.json")]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def proof_level(best_ordinary_um, incumbent_ordinary_um, reference_um, rules, inventory_ok):
    if best_ordinary_um is None or not inventory_ok:
        return "none"
    best, incumbent = float(best_ordinary_um), float(incumbent_ordinary_um)
    all_pass = all(v == "PASS" for v in rules.values())
    priority_ok = rules.get("priority-all-placed") == "PASS"
    others_pass = all(v == "PASS" for k, v in rules.items() if k != "drops-within-goal")
    if all_pass and best == 0:
        return "completion"
    if reference_um is not None and best < float(reference_um) and others_pass:
        return "surpass"
    if reference_um is not None and best <= float(reference_um) and priority_ok:
        return "match"
    if best < incumbent and priority_ok:
        return "improvement"
    if abs(best - incumbent) <= 0.5:
        return "reproduction"
    return "none"


def evaluate_placement(workspace, inputs):
    workspace = Path(workspace)
    decision, incumbent = inputs["DECISION"], inputs["INCUMBENT"]
    best = decision.get("best") or {}
    reader_values = best.get("readerValues", [])
    goal = _goal(inputs)
    rules_result = rounds.rule_results(reader_values, goal) if best else {r: "UNKNOWN" for r in rounds.RULE_IDS}
    unknowns = [{"rule": r, "reason": "no measured best state" if not best else "fact unknown"} for r, v in rules_result.items() if v == "UNKNOWN"]
    goal_met = bool(best) and all(v == "PASS" for v in rules_result.values())
    readiness = core.read_artifact(workspace / "state" / "case-readiness.json", "case-readiness")
    reference_um = (readiness.get("reference") or {}).get("referenceOrdinaryDropLengthUm")
    best_ordinary = rounds.reader_value(reader_values, "mage_dropped_ordinary_length_um")
    incumbent_ordinary = incumbent.get("metrics", {}).get("drops", {}).get("ordinary", {}).get("lengthUm")
    level = proof_level(best_ordinary, incumbent_ordinary, reference_um, rules_result, inventory_ok=bool(best)) if incumbent_ordinary is not None else "none"
    comparison = {
        "ordinaryLengthUm": {"best": best_ordinary, "incumbent": incumbent_ordinary, "reference": reference_um},
        "ordinaryCount": {"best": rounds.reader_value(reader_values, "mage_dropped_ordinary_count"),
                          "incumbent": incumbent.get("metrics", {}).get("drops", {}).get("ordinary", {}).get("count")},
        "priorityMoveMaxUm": rounds.reader_value(reader_values, "mage_priority_move_max_um"),
        "targetOverLimitCount": {"best": rounds.reader_value(reader_values, "mage_target_over_limit_count"),
                                 "incumbent": incumbent.get("metrics", {}).get("targetDistances", {}).get("overLimitCount")},
    }
    value = {"goalMet": goal_met, "metrics": best.get("metrics", {}), "incumbent": incumbent, "comparison": comparison,
             "rules": rules_result, "unknowns": unknowns, "proofLevel": level,
             "domainReport": {"round": best.get("round"), "candidatePath": best.get("candidatePath"), "stopReason": decision.get("stopReason")}}
    core.write_artifact(workspace / "state" / "placement-evaluation.json", value)
    return {"schemaVersion": "1", "value": value, "artifacts": [_artifact("placement-evaluation", "state/placement-evaluation.json")], "diagnostics": []}


def _collect_round_files(workspace, round_entry):
    workspace = Path(workspace)
    files = set()
    candidate_ref = round_entry["candidate"]
    candidate_path = _verify_file(workspace, candidate_ref, "round candidate")
    files.add(candidate_path.relative_to(workspace).as_posix())
    candidate_doc = json.loads(candidate_path.read_text(encoding="utf-8"))

    def _walk(value):
        if isinstance(value, dict):
            if "path" in value and "sha256" in value and isinstance(value["path"], str):
                raw_path = value["path"]
                if os.path.isabs(raw_path):
                    target = Path(raw_path)
                    try:
                        target.relative_to(workspace)
                        inside_workspace = True
                    except ValueError:
                        inside_workspace = False
                else:
                    target = workspace / raw_path
                    inside_workspace = True
                if inside_workspace:
                    if not target.is_file() or core.file_sha256(target) != value["sha256"]:
                        raise core.MageError(
                            "identity-mismatch", f"referenced file bytes changed or are missing: {target}")
                    try:
                        relative = target.relative_to(workspace).as_posix()
                    except ValueError:
                        relative = str(target)
                    files.add(relative)
            for child in value.values():
                _walk(child)
        elif isinstance(value, list):
            for child in value:
                _walk(child)

    _walk(candidate_doc.get("files", {}))
    return files


def deliver(workspace, inputs):
    workspace = Path(workspace)
    evaluation = inputs["EVALUATION"]

    result_doc = core.read_artifact(workspace / "state" / "script-result.json", "script-result")
    journal = core.read_artifact(workspace / "state" / "method-journal.json", "method-journal")

    all_files = {"state/method-journal.json", "state/script-result.json", "state/placement-evaluation.json"}
    for round_entry in result_doc.get("rounds", []):
        all_files |= _collect_round_files(workspace, round_entry)

    delivery_dir = workspace / "delivery"
    delivery_dir.mkdir(parents=True, exist_ok=True)
    package_path = delivery_dir / "placement-artifacts.tar.gz"
    with tarfile.open(package_path, "w:gz") as archive:
        for relative in sorted(all_files):
            full = workspace / relative
            if full.is_file():
                archive.add(full, arcname=relative, recursive=False)

    report = dict(evaluation)
    report["reportPath"] = "delivery/REPORT.md"
    report["packagePath"] = "delivery/placement-artifacts.tar.gz"
    core.write_artifact(delivery_dir / "report.json", report)

    comparison = report.get("comparison", {})
    journal_lines = "".join(
        "- round %s: %s -> %s\n" % (entry.get("round"), entry.get("hypothesis", ""), entry.get("conclusion", ""))
        for entry in journal.get("entries", [])
    ) or "- (no journal entries)\n"
    report_md = (
        "# MAGE script-method test-structure placement delivery\n\n"
        f"Goal met: {str(report['goalMet']).lower()}\n\n"
        f"Proof level: {report.get('proofLevel')}\n\n"
        f"Rules:\n\n```json\n{json.dumps(report['rules'], indent=2)}\n```\n\n"
        f"Comparison against incumbent and reference:\n\n```json\n{json.dumps(comparison, indent=2)}\n```\n\n"
        f"Stop reason: {report.get('domainReport', {}).get('stopReason', '')}\n\n"
        f"Method journal:\n\n{journal_lines}\n"
        f"Metrics (best state):\n\n```json\n{json.dumps(report['metrics'], indent=2)}\n```\n\n"
        "Placement artifacts: placement-artifacts.tar.gz\n"
    )
    (delivery_dir / "REPORT.md").write_text(report_md, encoding="utf-8")

    artifacts = [
        _artifact("final-report-json", "delivery/report.json"),
        {"name": "final-report", "path": "delivery/REPORT.md", "mediaType": "text/markdown"},
        {"name": "placement-package", "path": "delivery/placement-artifacts.tar.gz", "mediaType": "application/gzip"},
    ]
    return {"schemaVersion": "1", "value": report, "artifacts": artifacts, "diagnostics": []}


TASKS = {
    "prepare-case": prepare_case,
    "measure-incumbent": measure_incumbent,
    "decide-round": decide_round,
    "evaluate-placement": evaluate_placement,
    "deliver": deliver,
}


def execute(task, workspace, inputs):
    handler = TASKS.get(task)
    if handler is None:
        raise core.MageError("invalid-input", f"unknown business task {task!r}")
    return handler(workspace, inputs)
