#!/usr/bin/env python3
"""Independently validate the offline demo insight report and emit the Run's readings.

Holds derived/insight-report.json against hima-library-insight-report/1 (the same invariants the
Harness v1 schema enforces), then emits three readings in one observation:

  files_analysed     from the sibling derived/run-manifest.json (null with a reason if absent),
  report_valid       1 only when the report passed every check below,
  findings_reported  the number of findings the report carries.

argv: read-insight.py <REPORT> <OUT>
"""
import json
import os
import sys

HEX = set("0123456789abcdef")
SEVERITY = {"critical", "warning", "info"}
RELEVANCE = {"observed", "none", "unknown"}
ANALYSIS = {"library-health", "library-performance", "design-impact"}


def fail(message):
    raise ValueError(message)


def is_text(value):
    return isinstance(value, str) and 1 <= len(value) <= 2000


def exact(value, names, label):
    if not isinstance(value, dict) or set(value) != set(names):
        fail(label + " fields differ")


def is_hash(value):
    return isinstance(value, str) and len(value) == 64 and not (set(value) - HEX)


def validate_range(value, label):
    exact(value, ("min", "max", "unit"), label)
    for key in ("min", "max"):
        if not isinstance(value[key], (int, float)) or isinstance(value[key], bool):
            fail(label + " bound is not finite")
    if value["max"] < value["min"]:
        fail(label + " max is below min")
    if not is_text(value["unit"]):
        fail(label + " unit is absent")


def validate_provenance(value, label):
    if not isinstance(value, dict):
        fail(label + " is not an object")
    if set(value) - {"sourceRef", "recordId", "sha256", "status", "reason"}:
        fail(label + " has unexpected fields")
    status = value.get("status")
    if status not in ("available", "unknown", "ambiguous"):
        fail(label + " status differs")
    for key in ("sourceRef", "recordId"):
        if key in value and not (isinstance(value[key], str) and 1 <= len(value[key]) <= 1024):
            fail(label + " " + key + " differs")
    if "sha256" in value and not is_hash(value["sha256"]):
        fail(label + " sha256 is not a lowercase SHA-256")
    if status == "available":
        if not value.get("recordId") and not (value.get("sourceRef") and value.get("sha256")):
            fail(label + " available provenance needs a record or hash-bound source")
    elif not is_text(value.get("reason")):
        fail(label + " non-available provenance needs its reason")


def validate_numeric(value, label):
    if not isinstance(value, dict) or set(value) - {"name", "value", "unit", "missingReason"}:
        fail(label + " fields differ")
    if not is_text(value.get("name")):
        fail(label + " name is absent")
    number = value.get("value")
    if number is None:
        if not is_text(value.get("missingReason")):
            fail(label + " missing numeric needs a reason; zero is never substituted")
    elif not isinstance(number, (int, float)) or isinstance(number, bool) or number != number \
            or number in (float("inf"), float("-inf")):
        fail(label + " value is not finite")
    if "unit" in value and not is_text(value["unit"]):
        fail(label + " unit differs")


def validate_report(report):
    exact(report, ("schema", "evidenceClass", "analysis", "conditions", "findings", "summary"), "report")
    if report["schema"] != "hima-library-insight-report/1":
        fail("report schema differs")
    if report["evidenceClass"] not in ("synthetic", "native-qualified"):
        fail("report evidence class differs")
    if report["analysis"] not in ANALYSIS:
        fail("report analysis differs")

    conditions = report["conditions"]
    if not isinstance(conditions, dict) or set(conditions) - {"family", "corners", "views", "load", "slew", "unknowns"} \
            or not {"family", "corners", "views", "unknowns"} <= set(conditions):
        fail("report conditions fields differ")
    if not is_text(conditions["family"]):
        fail("report family is absent")
    for key in ("corners", "views"):
        seq = conditions[key]
        if not isinstance(seq, list) or not (1 <= len(seq) <= 32) or not all(is_text(x) for x in seq):
            fail("report conditions %s differ" % key)
    if not isinstance(conditions["unknowns"], list) or len(conditions["unknowns"]) > 32 \
            or not all(is_text(x) for x in conditions["unknowns"]):
        fail("report conditions unknowns differ")
    if "load" in conditions:
        validate_range(conditions["load"], "conditions load")
    if "slew" in conditions:
        validate_range(conditions["slew"], "conditions slew")
    corners, views = set(conditions["corners"]), set(conditions["views"])

    findings = report["findings"]
    if not isinstance(findings, list) or len(findings) > 5000:
        fail("report findings differ or exceed the cap")
    ids = set()
    for finding in findings:
        exact(finding, ("id", "title", "librarySeverity", "designRelevance", "corner", "view",
                        "values", "provenance", "unknowns", "rankingReason"), "finding")
        if not (isinstance(finding["id"], str) and 1 <= len(finding["id"]) <= 1024):
            fail("finding id differs")
        if finding["id"] in ids:
            fail("finding identities must be unique")
        ids.add(finding["id"])
        if not is_text(finding["title"]) or not is_text(finding["rankingReason"]):
            fail("finding title or ranking reason is absent")
        if finding["librarySeverity"] not in SEVERITY or finding["designRelevance"] not in RELEVANCE:
            fail("finding severity or design relevance differs")
        if finding["corner"] not in corners or finding["view"] not in views:
            fail("finding %s is outside loaded conditions" % finding["id"])
        if not isinstance(finding["values"], list) or len(finding["values"]) > 64:
            fail("finding values differ")
        for value in finding["values"]:
            validate_numeric(value, "finding value")
        if not isinstance(finding["provenance"], list) or not (1 <= len(finding["provenance"]) <= 32):
            fail("finding provenance differs")
        for source in finding["provenance"]:
            validate_provenance(source, "finding provenance")
        if not isinstance(finding["unknowns"], list) or len(finding["unknowns"]) > 32 \
                or not all(is_text(x) for x in finding["unknowns"]):
            fail("finding unknowns differ")

    summary = report["summary"]
    exact(summary, ("best", "unresolved", "nextActions"), "summary")
    for key in ("best", "unresolved"):
        if not isinstance(summary[key], list) or len(summary[key]) > 100:
            fail("summary %s differ" % key)
    refs = list(summary["best"]) + list(summary["unresolved"])
    if not isinstance(summary["nextActions"], list) or len(summary["nextActions"]) > 100:
        fail("summary nextActions differ")
    for action in summary["nextActions"]:
        exact(action, ("text", "findingIds"), "summary action")
        if not is_text(action["text"]):
            fail("summary action text is absent")
        if not isinstance(action["findingIds"], list) or not (1 <= len(action["findingIds"]) <= 100):
            fail("summary action findingIds differ")
        refs.extend(action["findingIds"])
    for ref in refs:
        if ref not in ids:
            fail("summary names unknown finding %s" % ref)
    return len(findings)


def files_analysed(report_path):
    manifest_path = os.path.join(os.path.dirname(report_path), "run-manifest.json")
    try:
        manifest = json.load(open(manifest_path))
    except (OSError, ValueError):
        return None, "no run-manifest.json beside the report, so the analysed-file count is unknown"
    value = manifest.get("files_analysed")
    if not isinstance(value, int) or isinstance(value, bool):
        return None, "run-manifest.json carries no integer files_analysed"
    return value, None


def main(report_path, out_path):
    with open(report_path) as stream:
        report = json.load(stream)
    reported = validate_report(report)
    analysed, reason = files_analysed(report_path)
    files_value = {"type": "files_analysed", "unit": "count", "value": analysed}
    if analysed is None:
        files_value["unknownReason"] = reason
    values = [
        files_value,
        {"type": "report_valid", "unit": "count", "value": 1},
        {"type": "findings_reported", "unit": "count", "value": reported},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
