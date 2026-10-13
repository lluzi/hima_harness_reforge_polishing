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
from pathlib import Path

from . import core, metrics as metrics_mod, pla, rules, snapshot, targets


NATIVE_TYPES = metrics_mod.NATIVE_TYPES
RULE_IDS = ()


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

    goal = {
        "target_dropped_count": inputs["TARGET_DROPPED"],
        "max_target_distance_um": inputs["MAX_TARGET_DISTANCE_UM"],
        "max_order_deviation": inputs["MAX_ORDER_DEVIATION"],
    }

    case_readiness = core.stamp("case-readiness", {
        "goal": goal,
        "manifestSha256": core.file_sha256(manifest_path),
        "siteCapabilitiesSha256": site_capabilities_sha256,
        "ruleFactsSummary": {"count": len(case["ruleFacts"])},
        "blockTypes": {"count": len(case["blockTypes"])},
        "manifest": case["manifest"],
        "siteCapabilities": site_capabilities,
    })
    core.write_artifact(workspace / "state" / "case-readiness.json", case_readiness)

    round0 = core.stamp("round-decision", {
        "round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None,
        "openRequests": [], "decisionRequests": [], "history": [], "stopReason": "",
    })
    core.write_artifact(workspace / "state" / "round-decision.json", round0)

    value = {
        "MAGE_CASE_MANIFEST": manifest_path,
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


TASKS = {
    "prepare-case": prepare_case,
    "measure-incumbent": measure_incumbent,
}


def execute(task, workspace, inputs):
    handler = TASKS.get(task)
    if handler is None:
        raise core.MageError("invalid-input", f"unknown business task {task!r}")
    return handler(workspace, inputs)
