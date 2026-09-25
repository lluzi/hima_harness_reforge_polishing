#!/usr/bin/env python3
"""Derive bounded E2/E3/E4 records only from a successful E1 receipt.

The first vertical slice intentionally uses the same qualified source as baseline and
candidate.  It proves identity, condition alignment and a zero delta without claiming a
second Library revision or invented PVT/table axes.  A future corpus worker may replace
the sample-only extraction, but must retain these record identities and unknowns.
"""
import hashlib
import json
import os
import sys


def canon(value): return json.dumps(value, sort_keys=True, separators=(",", ":"))
def sha(value): return hashlib.sha256(canon(value).encode()).hexdigest()
def file_sha(path):
    with open(path, "rb") as stream: return hashlib.sha256(stream.read()).hexdigest()
def read(path):
    with open(path) as stream: return json.load(stream)
def fail(message): raise ValueError(message)
def write(path, value):
    if os.path.exists(path): fail("refusing to overwrite versioned Library output")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "x") as stream: stream.write(canon(value) + "\n")


def prov(level="explicit", domain="Liberty", status="available"):
    return {"derivationLevel": level, "sourceDomain": domain, "evidenceStatus": status}


def qualified(receipt, role):
    if receipt.get("schema") != "hima-library-qualification/1" or receipt.get("status") != "passed" or receipt.get("nativeStatus") != "passed" or receipt.get("facts") is not None:
        fail("E2 requires a complete passed E1 receipt with no partial facts")
    matches = [item for item in receipt.get("results", []) if item.get("role") == role]
    if len(matches) != 1 or matches[0].get("status") != "passed": fail("qualified source is absent or blocked")
    item = matches[0]
    for name in ("source", "sourceSha256", "sourceAfterSha256", "childSha256", "queryEvidence"):
        if not item.get(name): fail("qualification result lacks " + name)
    if item["sourceSha256"] != item["sourceAfterSha256"] or file_sha(item["source"]) != item["sourceSha256"]:
        fail("qualified source identity no longer matches E1 evidence")
    return item


def facts(receipt, analysis_path, position):
    analysis = read(analysis_path)
    if not isinstance(analysis, dict) or set(analysis) != {"schema", "comparisonKind", "baseline", "candidate"} or analysis["schema"] != "hima-library-analysis-input/1" or analysis["comparisonKind"] != "same-qualified-source-control": fail("analysis manifest differs")
    if position not in ("baseline", "candidate"): fail("facts position differs")
    selected = analysis[position]
    if not isinstance(selected, dict) or set(selected) != {"qualificationRole", "expectedSourceSha256", "family", "corner", "view"}: fail("analysis source declaration differs")
    for key in ("qualificationRole", "expectedSourceSha256", "family", "corner", "view"):
        if not isinstance(selected[key], str) or not selected[key]: fail("analysis source " + key + " is absent")
    role = selected["qualificationRole"]
    item = qualified(receipt, role)
    if item["sourceSha256"] != selected["expectedSourceSha256"]: fail("analysis source hash differs from qualification")
    query = item["queryEvidence"]
    sample = query.get("sample")
    if not isinstance(sample, dict): fail("qualification query sample is absent")
    units = query.get("units")
    if not isinstance(units, dict): fail("qualification units are absent")
    for key in ("time_s", "cap_F", "voltage_V"):
        if not isinstance(units.get(key), (int, float)) or units[key] <= 0: fail("qualification unit is invalid")
    for key in ("cell", "area", "pin", "direction", "relatedPin", "timingType", "tableType", "tableSize", "firstValue"):
        if key not in sample: fail("qualification sample lacks " + key)
    unknown = {"reason": "The admitted E2 worker covers one representative Cell/table only; full PVT, function, drive, VT, when and the remaining Library corpus are unknown.", "provenance": prov("explicit", "Liberty", "unknown")}
    native_table = sample.get("table")
    if not isinstance(native_table, dict) or set(native_table) != {"model", "unit", "unitScaleToSI", "axes", "shape", "values"}: fail("qualification query lacks a complete typed table")
    table = {"id": sample["tableType"], "model": native_table["model"], "unit": native_table["unit"],
             "unitScaleToSI": native_table["unitScaleToSI"], "axes": native_table["axes"],
             "shape": native_table["shape"], "values": native_table["values"], "provenance": prov(), "unknowns": []}
    arc = {"id": "%s:%s>%s:%s" % (sample["cell"], sample["relatedPin"], sample["pin"], sample["timingType"]), "relatedPin": sample["relatedPin"], "outputPin": sample["pin"], "type": sample["timingType"], "sense": "unknown", "when": None, "sourceLocator": {"qualificationChildSha256": item["childSha256"]}, "tables": [table], "provenance": prov(), "unknowns": [unknown]}
    cell = {"id": sample["cell"], "name": sample["cell"], "function": {"unknown": unknown}, "drive": {"unknown": unknown}, "vt": {"unknown": unknown}, "family": {"unknown": unknown}, "area": {"value": sample["area"], "unit": "library-area-unit", "provenance": prov()}, "pins": [{"name": sample["pin"], "direction": sample["direction"], "provenance": prov()}], "arcs": [arc], "provenance": prov()}
    record = {"schema": "hima-library-facts/1", "position": position, "source": {"path": item["source"], "sha256": item["sourceSha256"], "bytes": os.path.getsize(item["source"]), "role": role, "family": selected["family"], "corner": selected["corner"], "view": selected["view"]}, "producer": receipt["producer"], "library": {"name": query["library"], "units": {"time_s": units["time_s"], "cap_F": units["cap_F"], "voltage_V": units["voltage_V"]}, "pvt": {"unknown": unknown}}, "cells": [cell], "coverage": {"declaredCells": query["cellCount"], "observedCells": 1, "complete": query["cellCount"] == 1, "scope": "representative-query-only"}, "unknowns": [unknown], "analysisRef": {"path": analysis_path, "sha256": file_sha(analysis_path)}, "qualificationRef": {"receiptSha256": sha(receipt), "resultRole": role, "childSha256": item["childSha256"]}}
    record["recordSha256"] = sha(record)
    return record


def delta(baseline, candidate):
    if baseline.get("schema") != "hima-library-facts/1" or candidate.get("schema") != "hima-library-facts/1": fail("delta requires E2 facts")
    if {key: baseline["source"].get(key) for key in ("family", "corner", "view")} != {key: candidate["source"].get(key) for key in ("family", "corner", "view")}:
        fail("facts are not under comparable conditions")
    before, after = baseline["cells"][0], candidate["cells"][0]
    if before["id"] != after["id"]: fail("same-source zero delta requires a stable cell identity")
    value = {"schema": "hima-library-delta/1", "baselineRef": {"sha256": baseline["recordSha256"]}, "candidateRef": {"sha256": candidate["recordSha256"]}, "conditions": {key: baseline["source"][key] for key in ("family", "corner", "view")}, "cellDeltas": [{"cellId": before["id"], "availability": "comparable", "area": {"unit": before["area"]["unit"], "baseline": before["area"]["value"], "candidate": after["area"]["value"], "delta": after["area"]["value"] - before["area"]["value"]}}], "coverage": {"baseline": baseline["coverage"], "candidate": candidate["coverage"]}, "unknowns": baseline["unknowns"] + candidate["unknowns"], "comparisonKind": "same-qualified-source-zero-delta"}
    value["recordSha256"] = sha(value)
    return value


def report(delta_value):
    if delta_value.get("schema") != "hima-library-delta/1": fail("report requires typed delta")
    # This is the exact producer document.  Host attaches reportRef/version/source when it
    # creates the observation; the Pack must not manufacture that envelope.
    return {"schema": "hima-library-insight-report/1", "evidenceClass": "native-qualified", "analysis": "library-health", "conditions": {"family": delta_value["conditions"]["family"], "corners": [delta_value["conditions"]["corner"]], "views": [delta_value["conditions"]["view"]], "unknowns": [item["reason"] for item in delta_value["unknowns"]]}, "findings": [{"id": "same-source-zero-delta", "title": "Same qualified source baseline/candidate control", "librarySeverity": "info", "designRelevance": "unknown", "corner": delta_value["conditions"]["corner"], "view": delta_value["conditions"]["view"], "values": [{"name": "area delta", "value": delta_value["cellDeltas"][0]["area"]["delta"], "unit": delta_value["cellDeltas"][0]["area"]["unit"]}], "provenance": [{"sourceRef": "library-delta", "sha256": delta_value["recordSha256"], "status": "available"}], "unknowns": ["Design evidence was not supplied; design impact is unknown."], "rankingReason": "A zero delta from one source is a control, not an equivalence or release conclusion."}], "summary": {"best": [], "unresolved": ["same-source-zero-delta"], "nextActions": [{"text": "Extract an independently qualified candidate under matching PVT/corner/view before a Library decision.", "findingIds": ["same-source-zero-delta"]}]}}


def result(report_value):
    if report_value.get("schema") != "hima-library-insight-report/1": fail("rule result requires typed report")
    value = {"schema": "hima-library-rule-result/1", "status": "no-mutation-recommended", "inputRefs": [{"ref": "report", "schema": report_value["schema"], "sha256": sha(report_value)}], "outputRefs": [], "workspace": {"scope": "private-workspace-only"}, "applicability": {"family": report_value["conditions"]["family"], "corner": report_value["conditions"]["corners"][0], "view": report_value["conditions"]["views"][0]}, "unknowns": report_value["conditions"]["unknowns"], "recommendation": "No Library mutation is recommended from a same-source zero-delta control."}
    value["recordSha256"] = sha(value)
    return value

def proposal(report_value, result_value, script):
    if report_value.get("schema") != "hima-library-insight-report/1": fail("proposal requires typed report")
    if result_value.get("schema") != "hima-library-rule-result/1" or result_value.get("recordSha256") != sha({key: value for key, value in result_value.items() if key != "recordSha256"}): fail("proposal requires a hash-bound typed rule result")
    value = {"schema": "hima-library-analysis-proposal/1", "rule": {"id": "same-source-zero-delta-result", "version": "1", "algorithmPath": script, "algorithmSha256": file_sha(script), "inputSchema": "hima-library-insight-report/1", "outputSchema": "hima-library-rule-result/1"}, "inputRefs": [{"ref": "report", "schema": report_value["schema"], "sha256": sha(report_value)}], "outputRefs": [{"ref": "rule-result", "schema": result_value["schema"], "sha256": result_value["recordSha256"]}], "workspace": {"scope": "private-workspace-only"}, "budget": {"maxInputs": 1, "maxOutputBytes": 65536}, "applicability": {"family": report_value["conditions"]["family"], "corner": report_value["conditions"]["corners"][0], "view": report_value["conditions"]["views"][0]}, "unknowns": report_value["conditions"]["unknowns"], "independentValidation": {"required": True, "recommendation": "Compare an independently extracted candidate facts record under the same PVT/corner/view before any Library, timing, design or release decision."}, "mutations": [], "writeAuthorization": "none"}
    value["proposalSha256"] = sha(value)
    return value


def main(argv):
    if len(argv) < 2: raise SystemExit("usage: library-stages.py facts|delta|report|proposal ...")
    mode = argv[1]
    if mode == "facts" and len(argv) == 6: write(argv[5], facts(read(argv[2]), argv[3], argv[4]))
    elif mode == "delta" and len(argv) == 5: write(argv[4], delta(read(argv[2]), read(argv[3])))
    elif mode == "report" and len(argv) == 4: write(argv[3], report(read(argv[2])))
    elif mode == "result" and len(argv) == 4: write(argv[3], result(read(argv[2])))
    elif mode == "proposal" and len(argv) == 6: write(argv[5], proposal(read(argv[2]), read(argv[3]), argv[4]))
    else: raise SystemExit("invalid library stage arguments")

if __name__ == "__main__":
    try: main(sys.argv)
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr); raise SystemExit(2)
