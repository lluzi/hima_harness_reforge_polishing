#!/usr/bin/env python3
"""Independently validate the bounded Wave 2 E2/E3/E4 artifact chain."""
import hashlib
import json
import math
import os
import sys

KINDS = {
    "hima-library-facts/1": "library_facts_complete",
    "hima-library-delta/1": "library_delta_complete",
    "hima-library-insight-report/1": "library_insight_report_available",
    "hima-library-analysis-proposal/1": "library_proposal_available",
    "hima-library-rule-result/1": "library_rule_result_available",
}
HEX = set("0123456789abcdef")


def canon(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def sha(value):
    return hashlib.sha256(canon(value).encode()).hexdigest()


def file_sha(path):
    result = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def read(path):
    with open(path) as stream:
        return json.load(stream)


def fail(message):
    raise ValueError(message)


def text(value, label):
    if not isinstance(value, str) or not value:
        fail(label + " is absent")
    return value


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(label + " is not finite")
    return value


def hash_value(value, label):
    if not isinstance(value, str) or len(value) != 64 or set(value) - HEX:
        fail(label + " is not a lowercase SHA-256")
    return value


def exact(value, names, label):
    if not isinstance(value, dict) or set(value) != set(names):
        fail(label + " fields differ")
    return value


def provenance(value, label, required_status=None):
    exact(value, ("derivationLevel", "sourceDomain", "evidenceStatus"), label + " provenance")
    if value["derivationLevel"] not in ("explicit", "derived", "inferred"):
        fail(label + " derivation level differs")
    if value["sourceDomain"] not in ("Liberty", "design", "STA", "SPICE", "physical", "silicon"):
        fail(label + " source domain differs")
    if value["evidenceStatus"] not in ("available", "unknown", "ambiguous", "contradicted", "corroborated"):
        fail(label + " evidence status differs")
    if required_status is not None and value["evidenceStatus"] != required_status:
        fail(label + " evidence status must remain " + required_status)


def unknown(value, label):
    exact(value, ("reason", "provenance"), label)
    text(value["reason"], label + " reason")
    provenance(value["provenance"], label, "unknown")


def embedded_identity(value, field):
    identity = hash_value(value.get(field), field)
    content = dict(value)
    content.pop(field, None)
    if identity != sha(content):
        fail("Library stage identity differs")
    return identity


def facts_path(directory, position):
    return os.path.join(directory, position + "-facts.json")


def validate_facts(value, report_path):
    exact(value, ("schema", "position", "source", "producer", "library", "cells", "coverage",
                  "unknowns", "qualificationRef", "recordSha256"), "facts")
    identity = embedded_identity(value, "recordSha256")
    if value["position"] not in ("baseline", "candidate"):
        fail("facts position differs")
    source = exact(value["source"], ("path", "sha256", "bytes", "role", "family", "corner", "view"), "facts source")
    text(source["path"], "facts source path")
    if not os.path.isabs(source["path"]) or file_sha(source["path"]) != hash_value(source["sha256"], "facts source SHA-256"):
        fail("facts source bytes differ from the qualified source")
    if not isinstance(source["bytes"], int) or source["bytes"] < 1 or os.path.getsize(source["path"]) != source["bytes"]:
        fail("facts source byte count differs")
    for name in ("role", "family", "corner", "view"):
        text(source[name], "facts source " + name)
    producer = value["producer"]
    for name in ("apiBuild", "python", "adapterSha256"):
        if name not in producer:
            fail("facts producer identity is incomplete")
    text(producer["apiBuild"], "facts API build")
    text(producer["python"], "facts Python")
    hash_value(producer["adapterSha256"], "facts adapter SHA-256")
    library = exact(value["library"], ("name", "units", "pvt"), "facts library")
    text(library["name"], "Library name")
    units = exact(library["units"], ("time_s", "cap_F", "voltage_V"), "Library units")
    for name, unit_value in units.items():
        if finite(unit_value, "Library unit " + name) <= 0:
            fail("Library unit must be positive")
    exact(library["pvt"], ("unknown",), "Library PVT")
    unknown(library["pvt"]["unknown"], "Library PVT unknown")
    if not isinstance(value["cells"], list) or not value["cells"]:
        fail("facts have no observed Cell")
    for cell in value["cells"]:
        exact(cell, ("id", "name", "function", "drive", "vt", "family", "area", "pins", "arcs", "provenance"), "Cell")
        text(cell["id"], "Cell id")
        text(cell["name"], "Cell name")
        for name in ("function", "drive", "vt", "family"):
            exact(cell[name], ("unknown",), "Cell " + name)
            unknown(cell[name]["unknown"], "Cell " + name + " unknown")
        area = exact(cell["area"], ("value", "unit", "provenance"), "Cell area")
        finite(area["value"], "Cell area")
        text(area["unit"], "Cell area unit")
        provenance(area["provenance"], "Cell area", "available")
        provenance(cell["provenance"], "Cell", "available")
        if not isinstance(cell["pins"], list) or not cell["pins"] or not isinstance(cell["arcs"], list) or not cell["arcs"]:
            fail("Cell pin/arc coverage is absent")
        pins = set()
        for pin in cell["pins"]:
            exact(pin, ("name", "direction", "provenance"), "pin")
            pins.add(text(pin["name"], "pin name"))
            text(pin["direction"], "pin direction")
            provenance(pin["provenance"], "pin", "available")
        for arc in cell["arcs"]:
            exact(arc, ("id", "relatedPin", "outputPin", "type", "sense", "when", "sourceLocator", "tables", "provenance", "unknowns"), "arc")
            for name in ("id", "relatedPin", "outputPin", "type", "sense"):
                text(arc[name], "arc " + name)
            if arc["outputPin"] not in pins:
                fail("arc output pin is not declared")
            if arc["when"] is not None:
                text(arc["when"], "arc when")
            child = exact(arc["sourceLocator"], ("qualificationChildSha256",), "arc source locator")
            hash_value(child["qualificationChildSha256"], "arc qualification child SHA-256")
            provenance(arc["provenance"], "arc", "available")
            if not isinstance(arc["unknowns"], list) or not arc["unknowns"]:
                fail("arc unknown coverage is absent")
            for item in arc["unknowns"]:
                unknown(item, "arc unknown")
            if not isinstance(arc["tables"], list) or not arc["tables"]:
                fail("arc table coverage is absent")
            for table in arc["tables"]:
                exact(table, ("id", "model", "unit", "valueCount", "sample", "provenance", "unknowns"), "table")
                text(table["id"], "table id")
                if table["model"] != "unknown" or table["unit"] != "unknown":
                    fail("unmeasured table model/unit must remain unknown")
                if not isinstance(table["valueCount"], int) or table["valueCount"] < 1:
                    fail("table value count differs")
                finite(table["sample"], "table sample")
                provenance(table["provenance"], "table", "available")
                if not isinstance(table["unknowns"], list) or not table["unknowns"]:
                    fail("table unknown coverage is absent")
                for item in table["unknowns"]:
                    unknown(item, "table unknown")
    coverage = exact(value["coverage"], ("declaredCells", "observedCells", "complete", "scope"), "facts coverage")
    if (not isinstance(coverage["declaredCells"], int) or not isinstance(coverage["observedCells"], int)
            or coverage["observedCells"] != len(value["cells"]) or coverage["declaredCells"] < coverage["observedCells"]
            or not isinstance(coverage["complete"], bool) or coverage["complete"] != (coverage["declaredCells"] == coverage["observedCells"])
            or coverage["scope"] != "representative-query-only"):
        fail("facts coverage accounting differs")
    if not isinstance(value["unknowns"], list) or not value["unknowns"]:
        fail("facts must retain unavailable fields")
    for item in value["unknowns"]:
        unknown(item, "facts unknown")
    reference = exact(value["qualificationRef"], ("receiptSha256", "resultRole", "childSha256"), "qualification reference")
    qualification_path = os.path.normpath(os.path.join(os.path.dirname(report_path), "../qualification/receipt.json"))
    qualification = read(qualification_path)
    if hash_value(reference["receiptSha256"], "qualification receipt SHA-256") != sha(qualification):
        fail("facts qualification receipt identity differs")
    matches = [item for item in qualification.get("results", []) if item.get("role") == reference["resultRole"]]
    if len(matches) != 1 or matches[0].get("childSha256") != hash_value(reference["childSha256"], "qualification child SHA-256"):
        fail("facts qualification child identity differs")
    return identity


def validate_delta(value, report_path):
    exact(value, ("schema", "baselineRef", "candidateRef", "conditions", "cellDeltas", "coverage",
                  "unknowns", "comparisonKind", "recordSha256"), "delta")
    identity = embedded_identity(value, "recordSha256")
    if value["comparisonKind"] != "same-qualified-source-zero-delta":
        fail("delta comparison identity is absent")
    directory = os.path.dirname(report_path)
    baseline = read(facts_path(directory, "baseline"))
    candidate = read(facts_path(directory, "candidate"))
    baseline_identity = validate_facts(baseline, facts_path(directory, "baseline"))
    candidate_identity = validate_facts(candidate, facts_path(directory, "candidate"))
    if exact(value["baselineRef"], ("sha256",), "baseline ref")["sha256"] != baseline_identity:
        fail("delta baseline reference differs")
    if exact(value["candidateRef"], ("sha256",), "candidate ref")["sha256"] != candidate_identity:
        fail("delta candidate reference differs")
    conditions = exact(value["conditions"], ("family", "corner", "view"), "delta conditions")
    if conditions != {key: baseline["source"][key] for key in ("family", "corner", "view")} or conditions != {key: candidate["source"][key] for key in ("family", "corner", "view")}:
        fail("delta conditions are not comparable")
    if baseline["source"]["sha256"] != candidate["source"]["sha256"]:
        fail("this zero-delta control requires the exact same qualified source")
    if not isinstance(value["cellDeltas"], list) or len(value["cellDeltas"]) != 1:
        fail("delta Cell accounting differs")
    area = exact(value["cellDeltas"][0].get("area"), ("unit", "baseline", "candidate", "delta"), "area delta")
    before = finite(area["baseline"], "baseline area")
    after = finite(area["candidate"], "candidate area")
    change = finite(area["delta"], "area delta")
    if area["unit"] != baseline["cells"][0]["area"]["unit"] or area["unit"] != candidate["cells"][0]["area"]["unit"] or not math.isclose(change, after - before, rel_tol=0, abs_tol=1e-15):
        fail("area delta value/unit differs")
    if change != 0:
        fail("same-source control must retain an explicit zero delta")
    if not isinstance(value["unknowns"], list) or not value["unknowns"]:
        fail("delta unknown coverage is absent")
    return identity


def validate_report(value, report_path):
    exact(value, ("schema", "evidenceClass", "analysis", "conditions", "findings", "summary"), "report")
    if value["evidenceClass"] != "native-qualified" or value["analysis"] not in ("library-health", "library-performance", "design-impact"):
        fail("report evidence class or analysis differs")
    conditions = exact(value["conditions"], ("family", "corners", "views", "unknowns"), "report conditions")
    text(conditions["family"], "report family")
    if not isinstance(conditions["corners"], list) or not conditions["corners"] or not isinstance(conditions["views"], list) or not conditions["views"] or not isinstance(conditions["unknowns"], list) or not conditions["unknowns"]:
        fail("report conditions are incomplete")
    delta_path = os.path.join(os.path.dirname(report_path), "delta.json")
    delta = read(delta_path)
    delta_identity = validate_delta(delta, delta_path)
    if not isinstance(value["findings"], list) or not value["findings"]:
        fail("report finding set is empty")
    ids = set()
    for finding in value["findings"]:
        exact(finding, ("id", "title", "librarySeverity", "designRelevance", "corner", "view", "values",
                        "provenance", "unknowns", "rankingReason"), "report finding")
        identity = text(finding["id"], "finding id")
        if identity in ids:
            fail("report finding identity repeats")
        ids.add(identity)
        if finding["librarySeverity"] not in ("critical", "warning", "info") or finding["designRelevance"] not in ("observed", "none", "unknown") or finding["corner"] not in conditions["corners"] or finding["view"] not in conditions["views"]:
            fail("report finding axes differ")
        text(finding["title"], "finding title")
        text(finding["rankingReason"], "finding ranking reason")
        if not isinstance(finding["values"], list):
            fail("finding values differ")
        for numeric in finding["values"]:
            if not isinstance(numeric, dict) or set(numeric) - {"name", "value", "unit", "missingReason"}:
                fail("finding numeric fields differ")
            text(numeric.get("name"), "numeric name")
            if numeric.get("value") is None:
                text(numeric.get("missingReason"), "missing numeric reason")
            else:
                finite(numeric["value"], "finding numeric value")
        if not isinstance(finding["provenance"], list) or not finding["provenance"]:
            fail("finding provenance is absent")
        for source in finding["provenance"]:
            if source.get("status") != "available" or source.get("sourceRef") != "library-delta" or source.get("sha256") != delta_identity:
                fail("report provenance does not bind the exact delta")
        if not isinstance(finding["unknowns"], list):
            fail("finding unknowns differ")
    summary = exact(value["summary"], ("best", "unresolved", "nextActions"), "report summary")
    refs = list(summary["best"]) + list(summary["unresolved"])
    if not isinstance(summary["nextActions"], list):
        fail("report next actions differ")
    for action in summary["nextActions"]:
        exact(action, ("text", "findingIds"), "report next action")
        text(action["text"], "next action text")
        refs.extend(action["findingIds"])
    if any(reference not in ids for reference in refs):
        fail("report summary names an unknown finding")
    return sha(value)


def validate_result(value, report_path):
    exact(value, ("schema", "status", "inputRefs", "outputRefs", "workspace", "applicability", "unknowns",
                  "recommendation", "recordSha256"), "rule result")
    identity = embedded_identity(value, "recordSha256")
    if value["status"] != "no-mutation-recommended" or value["outputRefs"] != [] or exact(value["workspace"], ("scope",), "result workspace")["scope"] != "private-workspace-only":
        fail("typed rule result boundary differs")
    insight_path = os.path.join(os.path.dirname(report_path), "insight-report.json")
    insight = read(insight_path)
    insight_identity = validate_report(insight, insight_path)
    if value["inputRefs"] != [{"ref": "report", "schema": insight["schema"], "sha256": insight_identity}]:
        fail("rule result input reference differs")
    expected = {"family": insight["conditions"]["family"], "corner": insight["conditions"]["corners"][0], "view": insight["conditions"]["views"][0]}
    if value["applicability"] != expected or not isinstance(value["unknowns"], list) or not value["unknowns"]:
        fail("rule result applicability or unknown coverage differs")
    text(value["recommendation"], "rule result recommendation")
    return identity


def validate_proposal(value, report_path):
    exact(value, ("schema", "rule", "inputRefs", "outputRefs", "workspace", "budget", "applicability", "unknowns",
                  "independentValidation", "mutations", "writeAuthorization", "proposalSha256"), "proposal")
    identity = embedded_identity(value, "proposalSha256")
    if value["mutations"] != [] or value["writeAuthorization"] != "none" or exact(value["workspace"], ("scope",), "proposal workspace")["scope"] != "private-workspace-only":
        fail("proposal write boundary differs")
    directory = os.path.dirname(report_path)
    insight_path = os.path.join(directory, "insight-report.json")
    result_path = os.path.join(directory, "rule-result.json")
    insight = read(insight_path)
    result_value = read(result_path)
    insight_identity = validate_report(insight, insight_path)
    result_identity = validate_result(result_value, result_path)
    if value["inputRefs"] != [{"ref": "report", "schema": insight["schema"], "sha256": insight_identity}] or value["outputRefs"] != [{"ref": "rule-result", "schema": result_value["schema"], "sha256": result_identity}]:
        fail("proposal input/output references differ")
    rule = exact(value["rule"], ("id", "version", "algorithmPath", "algorithmSha256", "inputSchema", "outputSchema"), "proposal rule")
    if (rule["id"] != "same-source-zero-delta-result" or rule["version"] != "1"
            or rule["inputSchema"] != insight["schema"] or rule["outputSchema"] != result_value["schema"]
            or os.path.basename(rule["algorithmPath"]) != "library-stages.py"
            or file_sha(rule["algorithmPath"]) != hash_value(rule["algorithmSha256"], "proposal algorithm SHA-256")):
        fail("proposal algorithm identity differs")
    budget = exact(value["budget"], ("maxInputs", "maxOutputBytes"), "proposal budget")
    if not isinstance(budget["maxInputs"], int) or budget["maxInputs"] < len(value["inputRefs"]) or not isinstance(budget["maxOutputBytes"], int) or budget["maxOutputBytes"] < os.path.getsize(result_path):
        fail("proposal budget differs")
    validation = exact(value["independentValidation"], ("required", "recommendation"), "independent validation")
    if validation["required"] is not True:
        fail("proposal does not require independent validation")
    text(validation["recommendation"], "independent validation recommendation")
    if value["applicability"] != result_value["applicability"] or not isinstance(value["unknowns"], list) or not value["unknowns"]:
        fail("proposal applicability or unknown coverage differs")
    return identity


def main(report, output):
    value = read(report)
    kind = KINDS.get(value.get("schema"))
    if kind is None:
        fail("unrecognised Library stage schema")
    if kind == "library_facts_complete":
        validate_facts(value, report)
    elif kind == "library_delta_complete":
        validate_delta(value, report)
    elif kind == "library_insight_report_available":
        validate_report(value, report)
    elif kind == "library_rule_result_available":
        validate_result(value, report)
    else:
        validate_proposal(value, report)
    with open(output, "x") as stream:
        json.dump({"values": [{"type": kind, "unit": "count", "value": 1}]}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError, IndexError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
