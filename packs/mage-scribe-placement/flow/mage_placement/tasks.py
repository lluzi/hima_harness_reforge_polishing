"""The five program-task ABI adapters this Pack's `mage_placement_cli.py`
dispatches `task-<name>` subcommands into (mirrors the ATCS Pack's
`atcs/business_tasks.py:execute`).

Each function takes `(workspace, inputs)` — `inputs` is the plain dict read
from the task's `TASK_INPUT` JSON file, keyed by the graph's own bound
input names (`MAGE_CASE_MANIFEST`, `ROUND`, `CANDIDATE`, ...) — and returns
`{"schemaVersion": "1", "value": ..., "artifacts": [...], "diagnostics": []}`
exactly as `atcs_cli.py:main`'s `task-` branch expects, so the dispatcher
can write it straight to `TASK_OUTPUT` with `core.write_artifact`.
"""
from __future__ import annotations

import json
import os
import tarfile
from pathlib import Path

from . import consumers, core, metrics as metrics_mod, pla, records, rounds, rules, snapshot, targets


NATIVE_TYPES = metrics_mod.NATIVE_TYPES
RULE_IDS = (
    "placement-delivery-ready", "priority-all-placed", "no-native-violation",
    "drops-within-goal", "target-limit-met", "order-within-goal", "no-open-requests",
)


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
    if manifest.get("referenceMethod") is not None:
        _verify_file(Path(manifest_path).parent, manifest["referenceMethod"], "referenceMethod")

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
    manifest_path, consumer_context_path, site_capabilities_path = (
        inputs["MAGE_CASE_MANIFEST"], inputs["CONSUMER_CONTEXT"], inputs["SITE_CAPABILITIES"],
    )
    case = _load_case(manifest_path)

    start_inputs = {"startState": dict(case["manifest"]["startState"])}
    start_snapshot = snapshot.build_snapshot(
        "start", case["startPla"], case["frame"], case["ruleFacts"], case["targets"],
        case["blockTypes"], start_inputs, pending_from_rules=True,
    )
    core.write_artifact(workspace / "state" / "start-snapshot.json", start_snapshot)

    consumer_context = core.read_artifact(consumer_context_path, "consumer-context")
    consumer_context_sha256 = core.file_sha256(consumer_context_path)

    site_capabilities_text = Path(site_capabilities_path).read_text(encoding="utf-8")
    site_capabilities = json.loads(site_capabilities_text)
    if site_capabilities.get("schema") != "mage.site-capabilities/1":
        raise core.MageError("schema-mismatch", "siteCapabilities is not a mage.site-capabilities/1 document")
    site_capabilities_sha256 = core.file_sha256(site_capabilities_path)

    goal = {
        "target_dropped_count": inputs["TARGET_DROPPED"],
        "max_target_distance_um": inputs["MAX_TARGET_DISTANCE_UM"],
        "max_order_deviation": inputs["MAX_ORDER_DEVIATION"],
    }

    case_readiness = core.stamp("case-readiness", {
        "goal": goal,
        "manifestSha256": core.file_sha256(manifest_path),
        "consumerContextSha256": consumer_context_sha256,
        "siteCapabilitiesSha256": site_capabilities_sha256,
        "ruleFactsSummary": {"count": len(case["ruleFacts"])},
        "blockTypes": {"count": len(case["blockTypes"])},
        "manifest": case["manifest"],
        "siteCapabilities": site_capabilities,
        "consumerContext": consumer_context,
    })
    core.write_artifact(workspace / "state" / "case-readiness.json", case_readiness)

    round0 = core.stamp("round-decision", {
        "round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None,
        "openRequests": [], "decisionRequests": [], "history": [], "stopReason": "",
    })
    core.write_artifact(workspace / "state" / "round-decision.json", round0)

    value = {
        "MAGE_CASE_MANIFEST": manifest_path, "CONSUMER_CONTEXT": consumer_context_path,
        "SITE_CAPABILITIES": site_capabilities_path,
        "readinessId": case_readiness["id"], "startSnapshotSha256": start_snapshot["snapshotSha256"],
    }
    artifacts = [
        _artifact("case-readiness", "state/case-readiness.json"),
        _artifact("start-snapshot", "state/start-snapshot.json"),
        _artifact("round-decision", "state/round-decision.json"),
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

    models_dir = Path(__file__).resolve().parents[1] / "consumer_models"
    eval_dir = workspace / "state" / "incumbent-eval"
    consumer_findings = {}
    for consumer_id in ("litho-pie", "metrology", "alignment", "wat"):
        model = consumers.load_consumer_model(models_dir, consumer_id)
        result = consumers.evaluate(
            model, case_readiness["consumerContext"], incumbent_snapshot, start_snapshot, {}, eval_dir, goal=goal,
        )
        consumer_findings[consumer_id] = result["findings"]

    incumbent_doc = core.stamp("incumbent-measure", {
        "stage": "incumbent", "evidence": "modelled", "nativeRequested": native_requested,
        "snapshotSha256": incumbent_snapshot["snapshotSha256"], "metrics": computed_metrics,
        "consumerFindings": consumer_findings,
    })
    core.write_artifact(workspace / "state" / "incumbent.json", incumbent_doc)

    value = {
        "incumbentId": incumbent_doc["id"], "snapshotSha256": incumbent_snapshot["snapshotSha256"],
        "metrics": computed_metrics, "evidence": "modelled", "nativeRequested": native_requested,
    }
    artifacts = [_artifact("incumbent-measure", "state/incumbent.json")]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def _reader_values(resident_output):
    observations = resident_output.get("observations", [])
    if not observations:
        return []
    return observations[0].get("values", [])


def _load_committed_document(workspace, resident_output, path, kind):
    observations = resident_output.get("observations", [])
    if len(observations) != 1:
        raise core.MageError("identity-mismatch", f"expected exactly one observation for {kind}")
    content_sha256 = observations[0]["contentSha256"]
    full_path = Path(workspace) / path
    if not full_path.is_file() or core.file_sha256(full_path) != content_sha256:
        raise core.MageError("identity-mismatch", f"{kind} bytes at {full_path} do not match the committed observation")
    return core.read_artifact(full_path, kind)


_REVIEW_INPUT_NAMES = {
    "litho-pie": "REVIEW_LITHO_PIE", "metrology": "REVIEW_METROLOGY",
    "alignment": "REVIEW_ALIGNMENT", "wat": "REVIEW_WAT",
}


def decide_round(workspace, inputs):
    workspace = Path(workspace)
    round_no = int(inputs["ROUND"])

    candidate_doc = _load_committed_document(
        workspace, inputs["CANDIDATE"], "state/round/placement-candidate.json", "placement-candidate",
    )
    candidate_doc = dict(candidate_doc)
    candidate_doc["_readerValues"] = _reader_values(inputs["CANDIDATE"])

    # C1: a review bound to the wrong snapshot -- or delivered into the wrong
    # consumer slot -- is treated as "no review from that consumer this round"
    # (recorded in the decision's `skippedReviews` with a reason) and the Run
    # continues, rather than crashing the whole Run on one mis-bound review.
    reviews = []
    skipped = []
    for role, input_name in _REVIEW_INPUT_NAMES.items():
        review_doc = _load_committed_document(
            workspace, inputs[input_name], f"state/round/review-{role}.json", "consumer-review",
        )
        if review_doc.get("consumer") != role:
            skipped.append({"consumer": review_doc.get("consumer"), "slot": role,
                            "reason": f"review delivered in slot {role!r} is a {review_doc.get('consumer')!r} review"})
            continue
        if review_doc["snapshotSha256"] != candidate_doc["snapshotSha256"]:
            skipped.append({"consumer": role, "slot": role,
                            "reason": "review bound to a different snapshot than the candidate"})
            continue
        reviews.append(review_doc)

    previous_decision = core.read_artifact(workspace / "state" / "round-decision.json", "round-decision")

    goal = {
        "target_dropped_count": inputs["TARGET_DROPPED"],
        "max_target_distance_um": inputs["MAX_TARGET_DISTANCE_UM"],
        "max_order_deviation": inputs["MAX_ORDER_DEVIATION"],
    }
    decision = rounds.decide(workspace, round_no, goal, reviews, candidate_doc, previous_decision, skipped_reviews=skipped)

    value = {
        "route": decision["route"], "nextRound": decision["nextRound"], "best": decision["best"],
        "openRequestCount": len(decision["openRequests"]), "decisionRequestCount": len(decision["decisionRequests"]),
        # `evaluate_placement` reads this round's actual Decision Requests from its own `DECISION`
        # input (this committed value, not the on-disk `state/round-decision.json` document) via
        # `decision.get("decisionRequests", [])`; without this field that lookup always silently
        # defaulted to an empty list, so the final `deliver` report never carried a real Decision
        # Request even when one was genuinely open (caught by Task 10's own L2 dry route, which
        # drives `evaluate-placement` from the repeat's own committed output exactly as the real
        # Host does -- `flow/tests/test_cli_tasks.py` never catches this because it never asserts
        # `evaluation["decisionRequests"]`, only `openRequestCount`/`stopReason`/`rules`).
        "decisionRequests": decision["decisionRequests"],
        "stopReason": decision["stopReason"],
        "skippedReviews": decision.get("skippedReviews", []),
    }
    artifacts = [
        _artifact("round-decision", "state/round-decision.json"),
        _artifact("placement-result", "state/placement-result.json"),
    ]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def _measure(value):
    return {"unknown": value.get("unknownReason")} if value.get("value") is None else {"value": value.get("value")}


def _rule_measure(reader_values, type_name):
    for row in reader_values:
        if row.get("type") == type_name:
            return _measure(row)
    return {"unknown": f"{type_name} was not emitted"}


def evaluate_placement(workspace, inputs):
    workspace = Path(workspace)
    decision = inputs["DECISION"]
    incumbent = inputs["INCUMBENT"]
    best = decision.get("best") or {}
    reader_values = best.get("readerValues", [])

    goal = {
        "target_dropped_count": inputs["TARGET_DROPPED"],
        "max_target_distance_um": inputs["MAX_TARGET_DISTANCE_UM"],
        "max_order_deviation": inputs["MAX_ORDER_DEVIATION"],
    }

    checks = {
        "placement-delivery-ready": ("mage_candidate_error_count", "eq", 0),
        "priority-all-placed": ("mage_priority_unplaced_count", "eq", 0),
        "no-native-violation": ("mage_native_violation_total", "eq", 0),
        "drops-within-goal": ("mage_dropped_count", "lte", goal["target_dropped_count"]),
        "target-limit-met": ("mage_target_distance_max_um", "lte", goal["max_target_distance_um"]),
        "order-within-goal": ("mage_order_deviation_max", "lte", goal["max_order_deviation"]),
        "no-open-requests": ("mage_open_request_count", "eq", 0),
    }

    rules_result = {}
    unknowns = []
    for rule_id, (type_name, op, threshold) in checks.items():
        measure = _rule_measure(reader_values, type_name)
        if "value" not in measure:
            rules_result[rule_id] = "UNKNOWN"
            unknowns.append({"rule": rule_id, "type": type_name, "reason": measure.get("unknown")})
            continue
        value = measure["value"]
        passed = (value == threshold) if op == "eq" else (value <= threshold)
        rules_result[rule_id] = "PASS" if passed else "FAIL"

    goal_met = all(rules_result[rule_id] == "PASS" for rule_id in RULE_IDS)

    best_metrics = best.get("metrics", {})
    incumbent_metrics = incumbent.get("metrics", {})

    def _delta(path):
        try:
            a = best_metrics
            b = incumbent_metrics
            for key in path:
                a, b = a[key], b[key]
            return core.known(float(a) - float(b))
        except (KeyError, TypeError, ValueError):
            return core.unknown("comparison not available")

    # Q2 is never a delta against a fit-id-fallback incumbent binding (F8,
    # identity-unknown) -- a target-distance number measured under a
    # carried-over fit id is not the same measurement as one bound by
    # Group point, so comparing them would silently misreport "better" or
    # "worse" against an incomparable baseline.
    incumbent_identity = incumbent_metrics.get("targetDistances", {}).get("identity")
    if incumbent_identity == "identity-unknown":
        q2 = core.unknown("incumbent target-distance binding is identity-unknown (fit-id fallback)")
    else:
        q2 = _delta(["targetDistances", "overLimitCount"])

    def _drop_length(metrics_dict, group):
        try:
            return metrics_dict["drops"][group]["lengthUm"]
        except (KeyError, TypeError):
            return None

    comparison = {
        "Q1_dropsDelta": _delta(["drops", "count"]),
        "Q1_ordinaryLengthUm": {
            "best": _drop_length(best_metrics, "ordinary"), "incumbent": _drop_length(incumbent_metrics, "ordinary"),
        },
        "Q1_groupedLengthUm": {
            "best": _drop_length(best_metrics, "grouped"), "incumbent": _drop_length(incumbent_metrics, "grouped"),
        },
        "Q2_targetDistanceDelta": q2,
        "Q3_orderDeviationDelta": _delta(["orderDeviation", "max"]),
        "Q4_displacementMovedDelta": _delta(["displacement", "movedCount"]),
    }

    value = {
        "goalMet": goal_met, "metrics": best_metrics, "incumbent": incumbent, "comparison": comparison,
        "rules": rules_result, "unknowns": unknowns, "decisionRequests": decision.get("decisionRequests", []),
        "domainReport": {"round": best.get("round"), "candidatePath": best.get("candidatePath")},
    }
    core.write_artifact(workspace / "state" / "placement-evaluation.json", value)
    artifacts = [_artifact("placement-evaluation", "state/placement-evaluation.json")]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


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
                target = workspace / value["path"] if not os.path.isabs(value["path"]) else Path(value["path"])
                if target.is_file() and core.file_sha256(target) == value["sha256"]:
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

    for review_ref in round_entry.get("reviews", {}).values():
        review_path = _verify_file(workspace, review_ref, "round review")
        files.add(review_path.relative_to(workspace).as_posix())

    return files


def deliver(workspace, inputs):
    workspace = Path(workspace)
    evaluation = inputs["EVALUATION"]

    result_doc = core.read_artifact(workspace / "state" / "placement-result.json", "placement-result")

    all_files = {"state/placement-result.json", "state/placement-evaluation.json"}
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

    report_md = (
        "# MAGE scribe-line placement delivery\n\n"
        f"Goal met: {str(report['goalMet']).lower()}\n\n"
        f"Rules:\n\n```json\n{json.dumps(report['rules'], indent=2)}\n```\n\n"
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
