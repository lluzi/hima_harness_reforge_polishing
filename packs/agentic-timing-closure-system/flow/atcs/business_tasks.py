"""Five-task route adapters. Technical helpers remain owned by atcs_cli/Reader."""
from pathlib import Path
import json
import math
import tarfile
from . import core


def _artifact(name, path):
    return {"name": name, "path": path, "mediaType": "application/json"}


def _report(workspace, ref):
    path = Path(workspace) / ref["path"]
    if path.is_symlink() or not path.is_file() or core.file_sha256(path) != ref["sha256"]:
        raise core.AtcsError("identity-mismatch", "committed domain-report bytes changed or are missing")
    return path


def evaluate(workspace, inputs):
    ref, verified = inputs["DOMAIN_REPORT"], inputs["READER_VALUE"]
    _report(workspace, ref)
    observations = verified["observations"]
    if len(observations) != 1 or observations[0]["contentSha256"] != ref["sha256"]:
        raise core.AtcsError("identity-mismatch", "committed Reader observation differs from domain-report")
    values = {row["type"]: row for row in observations[0]["values"]}
    def metric(suffix):
        row = values["tc_engineering_" + suffix]
        return {"unknown": row["unknownReason"]} if row["value"] is None else {"value": row["value"]}
    if metric("result_error_count") != {"value": 0}:
        raise core.AtcsError("invalid-result", "engineering Reader refused delivery; repair its reported evidence")
    timing = {mode: {field: metric(mode + "_" + suffix) for field, suffix in (
        ("wnsNs", "wns_ns"), ("tnsNs", "tns_ns"), ("violations", "violation_count"))} for mode in ("setup", "hold")}
    before = {mode: {field: metric("before_" + mode + "_" + suffix) for field, suffix in (
        ("wnsNs", "wns_ns"), ("tnsNs", "tns_ns"), ("violations", "violation_count"))} for mode in ("setup", "hold")}
    targets = {"setup": inputs["TARGET_SETUP_NS"], "hold": inputs["TARGET_HOLD_NS"]}
    for mode, target in targets.items():
        if isinstance(target, bool) or not isinstance(target, (int, float)) or not math.isfinite(target) or target != 0:
            raise core.AtcsError("invalid-input", "current native Goal targets must be zero")
    goal = all(timing[mode]["violations"] == {"value": 0} and
               timing[mode]["wnsNs"].get("value", float("-inf")) >= targets[mode]
               for mode in targets)
    return {"goalMet": goal, "timing": timing, "beforeTiming": before,
            "collateral": {"remaining": metric("remaining_violation_count"),
                           "regression": metric("regression_count"),
                           "unknown": metric("collateral_unknown_count")},
            "engineering": verified["engineering"], "domainReport": ref}


def _engineering_files(workspace, document):
    """Recheck retained refs at packaging, including the entire checkpoint support tree."""
    workspace = Path(workspace).resolve()
    files = set()
    def walk(value):
        if isinstance(value, dict):
            if "path" in value and ("sha256" in value or "digest" in value):
                target = workspace / value["path"]
                if target.is_symlink() or not target.resolve().is_relative_to(workspace):
                    raise core.AtcsError("invalid-input", "engineering support must stay inside workspace")
                if "digest" in value:
                    if core.tree_digest(target) != value["digest"]:
                        raise core.AtcsError("identity-mismatch", "engineering checkpoint/support tree changed")
                    for item in target.rglob("*"):
                        if item.is_symlink():
                            raise core.AtcsError("invalid-input", "engineering checkpoint contains a symlink")
                        if item.is_file():
                            files.add(item.relative_to(workspace).as_posix())
                else:
                    if not target.is_file() or core.file_sha256(target) != value["sha256"]:
                        raise core.AtcsError("identity-mismatch", "engineering support file changed or is missing")
                    files.add(target.relative_to(workspace).as_posix())
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(document)
    return sorted(files)


def execute(task, workspace, inputs, cli):
    workspace = Path(workspace)
    artifacts = []
    if task == "prepare-inputs":
        args = [inputs[name] for name in ("DESIGN_STATE_MANIFEST", "SITE_CAPABILITIES", "NATIVE_TIMING_CONTEXT")]
        path, readiness = cli._cmd_bind_resident_inputs(workspace, args)
        core.write_artifact(path, readiness)
        if readiness["missingCount"] != {"value": 0}:
            raise core.AtcsError("missing-input", "input readiness: " + ", ".join(readiness["missing"]))
        value = {**inputs, "readinessId": readiness["id"]}
        artifacts = [_artifact("input-readiness", "state/readiness.json")]
    elif task == "prepare-baseline":
        path, baseline = cli._cmd_baseline(workspace, [inputs["DESIGN_STATE_MANIFEST"]])
        core.write_artifact(path, baseline)
        path, context = cli._cmd_prepare_native_context(workspace, [inputs["NATIVE_TIMING_CONTEXT"], inputs["SITE_CAPABILITIES"]])
        core.write_artifact(path, context)
        path, common = cli._cmd_resident_common_autofix(workspace, [inputs["SITE_CAPABILITIES"], str(inputs["NATIVE_REPORT_PATHS"])])
        core.write_artifact(path, common)
        value = {name: inputs[name] for name in ("DESIGN_STATE_MANIFEST", "SITE_CAPABILITIES", "NATIVE_TIMING_CONTEXT")}
        value.update(baselineStateId=baseline["id"], nativeContextId=context["id"], commonStateId=common["stateId"], worklistId=common["worklistId"])
        artifacts = [_artifact(name, path) for name, path in (("baseline-state", "state/baseline.json"), ("native-context", "state/xtop-context.json"), ("common-stage", "state/common-stage.json"))]
    elif task == "evaluate-timing":
        value = evaluate(workspace, inputs)
        core.write_artifact(workspace / "state/timing-evaluation.json", value)
        artifacts = [_artifact("timing-evaluation", "state/timing-evaluation.json")]
    elif task == "deliver":
        value = dict(inputs["EVALUATION"])
        if inputs["DOMAIN_REPORT"] != value["domainReport"]:
            raise core.AtcsError("identity-mismatch", "delivery domain-report differs from evaluation")
        report = _report(workspace, value["domainReport"])
        document = cli._read_declared(report, "engineering-result")
        files = _engineering_files(workspace, document)
        files.append(value["domainReport"]["path"])
        root = workspace / "delivery"
        root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(root / "engineering-artifacts.tar.gz", "w:gz") as archive:
            for relative in sorted(set(files)):
                archive.add(workspace / relative, arcname=relative, recursive=False)
        value.update(reportPath="delivery/REPORT.md", engineeringPackagePath="delivery/engineering-artifacts.tar.gz")
        core.write_artifact(root / "report.json", value)
        (root / "REPORT.md").write_text("# ATCS engineering delivery\n\nGoal met: " + str(value["goalMet"]).lower() + "\n\nStop reason: " + value["engineering"]["stopReason"] + "\n\nTiming (raw verified Reader values):\n\n```json\n" + json.dumps(value["timing"], indent=2) + "\n```\n\nCollateral / regression / UNKNOWN:\n\n```json\n" + json.dumps(value["collateral"], indent=2) + "\n```\n\nEngineering artifacts: engineering-artifacts.tar.gz\n\nNative timing evidence is prediction-only; physical adoption/signoff is not claimed.\n", encoding="utf-8")
        artifacts = [_artifact("final-report-json", "delivery/report.json"), {"name": "final-report", "path": "delivery/REPORT.md", "mediaType": "text/markdown"}, {"name": "engineering-package", "path": "delivery/engineering-artifacts.tar.gz", "mediaType": "application/gzip"}]
    else:
        raise core.AtcsError("invalid-input", "unknown business task " + task)
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}
