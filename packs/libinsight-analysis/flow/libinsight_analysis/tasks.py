"""The three deterministic business tasks of the libinsight-analysis route (program ABI)."""
import json
import os

from . import common, delivery, library, request
from .common import LiaError


def _artifact(name, path, media="application/json"):
    return {"name": name, "path": path, "mediaType": media}


def prepare_task(workspace, inputs):
    prepared, target = request.prepare(
        workspace, inputs["ANALYSIS_REQUEST"], inputs["ANALYSIS_LIBRARY"], inputs.get("FACTS_CORPUS") or "",
        inputs.get("ENGINEERING_CAPABILITIES") or "", inputs.get("LICENCE_MODE_FILE") or "")
    req = prepared["request"]
    value = {
        "requestId": req["requestId"],
        "question": req["question"],
        "preparedPath": common.PREPARED_PATH,
        "preparedSha256": common.sha256_file(target),
        "sources": [{"path": item["path"], "kind": item["kind"], "sha256": item["sha256"]} for item in prepared["sources"]],
        "buildsOn": [item["ref"] for item in prepared["buildsOn"]],
        "libraryAnalyses": len(prepared["library"]["analyses"]),
        "goal": request.goal_text(req, os.path.join(workspace, common.PREPARED_PATH)),
    }
    return value, [_artifact("prepared-request", common.PREPARED_PATH)]


def _markdown(value, doc):
    lines = ["# LibInsight custom analysis", "", "Request: %s" % value["requestId"], "",
             "Question: %s" % value["question"], ""]
    if value["admitted"]:
        lines += ["Admitted: %s@%d at %s%s" % (value["id"], value["version"], value["path"],
                                                " (identical version already admitted)" if value.get("reused") else ""), "",
                  "Resident outcome: %s" % value.get("outcome"), "", "## Summary", "", doc["summary"], "",
                  "## Datasets and plots", ""]
        for name in sorted(doc["datasets"]):
            dataset = doc["datasets"][name]
            lines.append("- dataset `%s`: %d rows, columns %s" % (name, len(dataset["rows"]), ", ".join(
                "%s%s" % (c["name"], " [%s]" % c["unit"] if c.get("unit") else "") for c in dataset["columns"])))
        for plot in doc["plots"]:
            lines.append("- %s plot `%s` (%s) of `%s`" % (plot["kind"], plot["id"], plot["title"], plot["dataset"]))
        lines += ["", "## Sources", ""]
        for source in doc["sources"]:
            lines.append("- %s %s sha256 %s%s" % (source["kind"], source["path"], source["sha256Before"],
                                                  " (Liberty sha256 %s)" % source["libertySha256"] if "libertySha256" in source else ""))
        lines += ["", "## Code", "", "Main script `%s` sha256 %s; run `%s` exit %d in %.3f s; QuaLib API used: %s." % (
            doc["code"]["main"]["path"], doc["code"]["main"]["sha256"], doc["run"]["command"], doc["run"]["exitCode"],
            doc["run"]["elapsedSeconds"], "yes" if doc["run"]["usedQualib"] else "no"), "", "## Assumptions", ""]
        lines += ["- " + item for item in doc["assumptions"]] or ["- none stated"]
        lines += ["", "## Limits", ""]
        lines += ["- " + item for item in doc["limits"]] or ["- none stated"]
    else:
        lines += ["Not admitted: %s" % value["reason"], "", "The Reader-checked result is retained for inspection but was "
                  "not added to the analysis library.", "", "## Summary", "", doc["summary"]]
    return "\n".join(lines) + "\n"


def deliver_task(workspace, inputs):
    admission, prepared = inputs["ADMISSION"], inputs["PREPARED"]
    target = inputs["TARGET_ADMITTED"]
    if not common.finite_number(target) or target != 1:
        raise LiaError("invalid-input", "the admitted_analyses Goal of this Pack is exactly 1")
    if admission.get("requestId") != prepared.get("requestId"):
        raise LiaError("identity-mismatch", "admission and prepared request belong to different requests")
    ref = admission["domainReport"]
    report = os.path.join(workspace, ref["path"])
    common.plain_file(report, "retained domain-report")
    if common.sha256_file(report) != ref["sha256"]:
        raise LiaError("identity-mismatch", "retained domain-report changed after admission")
    doc, _ = delivery.load_result(report)
    if admission["admitted"]:
        admitted_at = admission["path"]
        if common.sha256_file(os.path.join(admitted_at, "analysis-result.json")) != admission["resultSha256"]:
            raise LiaError("identity-mismatch", "the admitted library result changed after admission")
    value = {
        "goalMet": (1 if admission["admitted"] else 0) >= target,
        "requestId": prepared["requestId"],
        "question": prepared["question"],
        "admitted": bool(admission["admitted"]),
        "analysis": {"id": doc["id"], "version": doc["version"], "summary": doc["summary"],
                     "plots": len(doc["plots"]), "datasets": len(doc["datasets"])},
        "libraryPath": admission.get("path"),
        "reason": admission.get("reason"),
        "outcome": admission.get("outcome"),
        "domainReport": ref,
        "reportPath": "delivery/REPORT.md",
        "resultPath": "delivery/analysis-result.json",
    }
    root = os.path.join(workspace, "delivery")
    if not os.path.isdir(root):
        os.makedirs(root)
    with open(report, "rb") as stream:
        data = stream.read()
    with open(os.path.join(root, "analysis-result.json"), "wb") as stream:
        stream.write(data)
    with open(os.path.join(root, "REPORT.md"), "w", encoding="utf-8") as stream:
        stream.write(_markdown(dict(admission, question=prepared["question"]), doc))
    common.write_json(os.path.join(root, "report.json"), value)
    return value, [_artifact("final-report-json", "delivery/report.json"),
                   _artifact("final-report", "delivery/REPORT.md", "text/markdown"),
                   _artifact("analysis-result", "delivery/analysis-result.json")]


def execute(task, workspace, inputs):
    if task == "prepare-request":
        value, artifacts = prepare_task(workspace, inputs)
    elif task == "admit-analysis":
        value = library.admit_task(workspace, inputs)
        artifacts = [_artifact("admission", common.ADMISSION_PATH)]
    elif task == "deliver":
        value, artifacts = deliver_task(workspace, inputs)
    else:
        raise LiaError("invalid-input", "unknown business task %s" % task)
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def read_task_input(path):
    with open(path, "rb") as stream:
        return json.loads(stream.read().decode("utf-8"))
