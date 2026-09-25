#!/usr/bin/env python3
"""Pack-local synthetic E2/E4 schema boundary.

This adapter deliberately consumes already extracted, hash-bound JSON.  Native Liberty
objects remain in the E1/E2 worker boundary; this tool neither parses Liberty nor executes
customer code.  It makes E2 facts/deltas and E4 proposals explicit, deterministic and
safe to exercise with plain fixtures before a real corpus is admitted.
"""

import hashlib
import json
import math
import os
import sys


FACTS_SCHEMA = "hima-library-facts/1"
DELTA_SCHEMA = "hima-library-delta/1"
PROPOSAL_SCHEMA = "hima-library-analysis-proposal/1"
HEX = set("0123456789abcdef")


def fail(message):
    raise ValueError(message)


def read_json(path):
    with open(path, encoding="utf-8") as stream:
        return json.load(stream)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def write_once(path, value):
    if os.path.exists(path):
        fail("refusing to overwrite analysis output")
    with open(path, "x", encoding="utf-8") as stream:
        stream.write(canonical(value) + "\n")


def sha256(value, label):
    if not isinstance(value, str) or len(value) != 64 or set(value) - HEX:
        fail(label + " must be a lowercase SHA-256")
    return value


def string(value, label):
    if not isinstance(value, str) or not value:
        fail(label + " must be a nonempty string")
    return value


def number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        fail(label + " must be a finite number")
    return value


def provenance(value, label):
    if not isinstance(value, dict):
        fail(label + " provenance is required")
    required = {"derivationLevel", "sourceDomain", "evidenceStatus"}
    if set(value) != required:
        fail(label + " provenance fields differ")
    if value["derivationLevel"] not in ("explicit", "derived", "inferred"):
        fail(label + " derivation level is invalid")
    if value["sourceDomain"] not in ("Liberty", "design", "STA", "SPICE", "physical", "silicon"):
        fail(label + " source domain is invalid")
    if value["evidenceStatus"] not in ("available", "unknown", "ambiguous", "contradicted", "corroborated"):
        fail(label + " evidence status is invalid")
    return value


def enrich(item, label, domain="Liberty"):
    result = dict(item)
    result.setdefault("provenance", {
        "derivationLevel": "explicit", "sourceDomain": domain, "evidenceStatus": "available"
    })
    provenance(result["provenance"], label)
    return result


def known_quantity(value, label):
    if value is None:
        return None
    if not isinstance(value, dict):
        fail(label + " must be a quantity or explicit unknown")
    if "unknown" in value:
        if set(value) != {"unknown"} or not isinstance(value["unknown"], dict):
            fail(label + " unknown shape is invalid")
        string(value["unknown"].get("reason"), label + " unknown reason")
        return None
    if set(value) != {"value", "unit"}:
        fail(label + " quantity fields differ")
    number(value["value"], label + " value")
    string(value["unit"], label + " unit")
    return value


def validate_source(value):
    if not isinstance(value, dict) or set(value) != {"path", "sha256", "bytes", "role", "family", "corner", "view"}:
        fail("source identity fields differ")
    string(value["path"], "source path")
    sha256(value["sha256"], "source sha256")
    if not isinstance(value["bytes"], int) or value["bytes"] < 0:
        fail("source bytes must be a nonnegative integer")
    for name in ("role", "family", "corner", "view"):
        string(value[name], "source " + name)
    if value["role"] not in ("baseline", "candidate"):
        fail("source role must be baseline or candidate")
    if not os.path.isfile(value["path"]):
        fail("source path is absent")
    with open(value["path"], "rb") as stream:
        payload = stream.read()
    if hashlib.sha256(payload).hexdigest() != value["sha256"] or len(payload) != value["bytes"]:
        fail("source bytes differ from declared identity")


def validate_table(value):
    value = enrich(value, "table")
    required = {"id", "model", "axes", "shape", "values", "unit", "provenance"}
    if set(value) != required:
        fail("table fields differ")
    string(value["id"], "table id")
    string(value["model"], "table model")
    string(value["unit"], "table unit")
    if not isinstance(value["axes"], list) or not value["axes"]:
        fail("table axes are required")
    for axis in value["axes"]:
        if not isinstance(axis, dict) or set(axis) != {"variable", "unit", "indexes"}:
            fail("table axis fields differ")
        string(axis["variable"], "axis variable")
        string(axis["unit"], "axis unit")
        if not isinstance(axis["indexes"], list) or not axis["indexes"]:
            fail("axis indexes are required")
        for index in axis["indexes"]:
            number(index, "axis index")
    if not isinstance(value["shape"], list) or len(value["shape"]) != len(value["axes"]):
        fail("table shape must align with axes")
    total = 1
    for dimension in value["shape"]:
        if not isinstance(dimension, int) or dimension <= 0:
            fail("table shape dimensions must be positive integers")
        total *= dimension
    if not isinstance(value["values"], list) or len(value["values"]) != total:
        fail("table values must match shape")
    for item in value["values"]:
        number(item, "table value")
    return value


def validate_cell(value):
    value = enrich(value, "cell")
    required = {"id", "name", "area", "pins", "arcs", "provenance"}
    if set(value) != required:
        fail("cell fields differ")
    string(value["id"], "cell id")
    string(value["name"], "cell name")
    known_quantity(value["area"], "cell area")
    if not isinstance(value["pins"], list) or not value["pins"]:
        fail("cell pins are required")
    pins = set()
    for pin in value["pins"]:
        pin = enrich(pin, "pin")
        if set(pin) != {"name", "direction", "provenance"}:
            fail("pin fields differ")
        string(pin["name"], "pin name")
        if pin["direction"] not in ("input", "output", "inout", "internal", "unknown"):
            fail("pin direction is invalid")
        if pin["name"] in pins:
            fail("duplicate pin name")
        pins.add(pin["name"])
    if not isinstance(value["arcs"], list):
        fail("cell arcs must be a list")
    seen = set()
    arcs = []
    for arc in value["arcs"]:
        arc = enrich(arc, "arc")
        required_arc = {"id", "relatedPin", "outputPin", "type", "sense", "when", "sourceLocator", "tables", "provenance"}
        if set(arc) != required_arc:
            fail("arc fields differ")
        for name in ("id", "relatedPin", "outputPin", "type", "sense"):
            string(arc[name], "arc " + name)
        if arc["relatedPin"] not in pins or arc["outputPin"] not in pins:
            fail("arc pins must refer to declared pins")
        if arc["when"] is not None:
            string(arc["when"], "arc when")
        if not isinstance(arc["sourceLocator"], dict) or not isinstance(arc["sourceLocator"].get("line"), int):
            fail("arc source locator is required")
        if arc["id"] in seen:
            fail("duplicate arc id")
        seen.add(arc["id"])
        if not isinstance(arc["tables"], list):
            fail("arc tables must be a list")
        arc["tables"] = [validate_table(table) for table in arc["tables"]]
        arcs.append(arc)
    value["arcs"] = arcs
    return value


def facts(request):
    if not isinstance(request, dict) or request.get("schema") != "hima-library-facts-request/1":
        fail("facts request schema differs")
    required = {"schema", "source", "producer", "library", "cells", "coverage", "unknowns"}
    if set(request) != required:
        fail("facts request fields differ")
    validate_source(request["source"])
    producer = request["producer"]
    if not isinstance(producer, dict) or set(producer) != {"apiBuild", "python", "adapterSha256"}:
        fail("producer identity fields differ")
    string(producer["apiBuild"], "producer apiBuild")
    string(producer["python"], "producer python")
    sha256(producer["adapterSha256"], "producer adapter sha256")
    library = request["library"]
    if not isinstance(library, dict) or set(library) != {"name", "units", "pvt"}:
        fail("library fields differ")
    string(library["name"], "library name")
    if not isinstance(library["units"], dict) or set(library["units"]) != {"time", "capacitance", "voltage", "area"}:
        fail("library unit table is incomplete")
    for value in library["units"].values():
        string(value, "library unit")
    pvt = library["pvt"]
    if not isinstance(pvt, dict) or set(pvt) != {"process", "voltage", "temperature", "voltageUnit", "temperatureUnit"}:
        fail("PVT fields differ")
    string(pvt["process"], "PVT process")
    number(pvt["voltage"], "PVT voltage")
    number(pvt["temperature"], "PVT temperature")
    string(pvt["voltageUnit"], "PVT voltage unit")
    string(pvt["temperatureUnit"], "PVT temperature unit")
    if not isinstance(request["cells"], list):
        fail("cells must be a list")
    cells = [validate_cell(cell) for cell in request["cells"]]
    if len({cell["id"] for cell in cells}) != len(cells):
        fail("duplicate cell id")
    coverage = request["coverage"]
    if not isinstance(coverage, dict) or set(coverage) != {"declaredCells", "observedCells", "complete"}:
        fail("coverage fields differ")
    if any(not isinstance(coverage[key], int) or coverage[key] < 0 for key in ("declaredCells", "observedCells")) or not isinstance(coverage["complete"], bool):
        fail("coverage values are invalid")
    if coverage["observedCells"] != len(cells) or coverage["observedCells"] > coverage["declaredCells"]:
        fail("coverage does not account for cells")
    if not isinstance(request["unknowns"], list) or any(not isinstance(item, dict) or not isinstance(item.get("reason"), str) or not item["reason"] for item in request["unknowns"]):
        fail("unknowns must retain explicit reasons")
    record = {"schema": FACTS_SCHEMA, "source": request["source"], "producer": producer,
              "library": library, "cells": cells, "coverage": coverage, "unknowns": request["unknowns"]}
    record["recordSha256"] = digest(record)
    return record


def delta(request):
    if not isinstance(request, dict) or set(request) != {"schema", "baseline", "candidate"} or request["schema"] != "hima-library-delta-request/1":
        fail("delta request fields differ")
    baseline, candidate = request["baseline"], request["candidate"]
    if not isinstance(baseline, dict) or not isinstance(candidate, dict) or baseline.get("schema") != FACTS_SCHEMA or candidate.get("schema") != FACTS_SCHEMA:
        fail("delta requires typed facts records")
    for record, role in ((baseline, "baseline"), (candidate, "candidate")):
        if "recordSha256" in record:
            expected = record["recordSha256"]
            content = {key: value for key, value in record.items() if key != "recordSha256"}
            if sha256(expected, role + " facts record sha256") != digest(content):
                fail(role + " facts record hash differs")
        if record.get("source", {}).get("role") != role:
            fail("delta source roles must be baseline then candidate")
        for key in ("family", "corner", "view"):
            string(record["source"].get(key), role + " " + key)
    conditions = {key: baseline["source"][key] for key in ("family", "corner", "view")}
    if conditions != {key: candidate["source"][key] for key in conditions}:
        fail("delta requires comparable family, corner, and view")
    if baseline["library"]["pvt"] != candidate["library"]["pvt"]:
        fail("delta requires matching PVT conditions")
    candidate_cells = {cell["id"]: cell for cell in candidate["cells"]}
    changes = []
    for before in baseline["cells"]:
        after = candidate_cells.get(before["id"])
        if after is None:
            changes.append({"cellId": before["id"], "availability": "candidate-missing", "area": None})
            continue
        before_area, after_area = known_quantity(before["area"], "baseline cell area"), known_quantity(after["area"], "candidate cell area")
        area = None
        if before_area is not None and after_area is not None:
            if before_area["unit"] != after_area["unit"]:
                fail("area units must match before delta")
            area = {"unit": before_area["unit"], "baseline": before_area["value"], "candidate": after_area["value"], "delta": after_area["value"] - before_area["value"]}
        changes.append({"cellId": before["id"], "availability": "comparable", "area": area})
    output = {"schema": DELTA_SCHEMA, "baselineRef": {"sha256": baseline.get("recordSha256", digest({k: v for k, v in baseline.items() if k != "recordSha256"}))},
              "candidateRef": {"sha256": candidate.get("recordSha256", digest({k: v for k, v in candidate.items() if k != "recordSha256"}))},
              "conditions": conditions, "cellDeltas": changes,
              "unknowns": list(baseline.get("unknowns", [])) + list(candidate.get("unknowns", [])),
              "coverage": {"baseline": baseline["coverage"], "candidate": candidate["coverage"]}}
    output["recordSha256"] = digest(output)
    return output


def proposal(request, output_path):
    if not isinstance(request, dict) or request.get("schema") != "hima-library-rule-proposal-request/1":
        fail("proposal request schema differs")
    required = {"schema", "rule", "inputs", "policy", "result", "independentValidation"}
    if set(request) != required:
        fail("proposal request fields differ")
    rule = request["rule"]
    if not isinstance(rule, dict) or set(rule) != {"id", "version", "path", "sha256", "inputSchema", "outputSchema"}:
        fail("rule identity fields differ")
    for key in ("id", "version", "path", "inputSchema", "outputSchema"):
        string(rule[key], "rule " + key)
    sha256(rule["sha256"], "rule sha256")
    if not os.path.isfile(rule["path"]):
        fail("rule path is absent")
    with open(rule["path"], "rb") as stream:
        if hashlib.sha256(stream.read()).hexdigest() != rule["sha256"]:
            fail("rule bytes differ from declared SHA-256")
    policy = request["policy"]
    if not isinstance(policy, dict) or set(policy) != {"applicability", "budget", "permit"}:
        fail("proposal policy fields differ")
    applicability = policy["applicability"]
    if not isinstance(applicability, dict) or set(applicability) != {"family", "corner", "view"}:
        fail("proposal applicability fields differ")
    for value in applicability.values():
        string(value, "proposal applicability")
    budget = policy["budget"]
    if not isinstance(budget, dict) or set(budget) != {"maxInputs", "maxOutputBytes"} or any(not isinstance(value, int) or value < 1 for value in budget.values()):
        fail("proposal budget fields are invalid")
    permit = policy["permit"]
    if not isinstance(permit, dict) or set(permit) != {"workspaceRoot", "writeRoot"}:
        fail("proposal permit fields differ")
    workspace = os.path.realpath(permit["workspaceRoot"])
    if not os.path.isdir(workspace) or os.path.realpath(permit["writeRoot"]) != workspace:
        fail("write root must equal private workspace root")
    if os.path.commonpath([workspace, os.path.realpath(output_path)]) != workspace:
        fail("proposal output must remain in private workspace")
    inputs = request["inputs"]
    if not isinstance(inputs, list) or not inputs or len(inputs) > budget["maxInputs"]:
        fail("proposal input count exceeds budget")
    for item in inputs:
        if not isinstance(item, dict) or set(item) != {"ref", "schema", "sha256"}:
            fail("proposal input ref fields differ")
        string(item["ref"], "proposal input ref")
        if item["schema"] != rule["inputSchema"]:
            fail("proposal input schema differs from rule")
        sha256(item["sha256"], "proposal input sha256")
    result = request["result"]
    if not isinstance(result, dict) or set(result) != {"ref", "schema", "sha256", "bytes", "unknowns"}:
        fail("proposal result fields differ")
    if result["schema"] != rule["outputSchema"] or not isinstance(result["bytes"], int) or result["bytes"] < 0 or result["bytes"] > budget["maxOutputBytes"]:
        fail("proposal result violates output schema or budget")
    string(result["ref"], "proposal result ref")
    sha256(result["sha256"], "proposal result sha256")
    if not isinstance(result["unknowns"], list) or any(not isinstance(item, str) or not item for item in result["unknowns"]):
        fail("proposal result unknowns are invalid")
    validation = request["independentValidation"]
    if not isinstance(validation, dict) or set(validation) != {"required", "recommendation"} or validation["required"] is not True:
        fail("independent validation must be required")
    string(validation["recommendation"], "independent validation recommendation")
    value = {"schema": PROPOSAL_SCHEMA, "rule": rule, "inputRefs": inputs, "outputRef": result,
             "applicability": applicability, "budget": budget, "workspace": workspace,
             "writeBoundary": "private-workspace-only", "unknowns": result["unknowns"],
             "independentValidation": validation, "mutations": []}
    value["proposalSha256"] = digest(value)
    return value


def main(argv):
    if len(argv) != 4 or argv[1] not in ("facts", "delta", "proposal"):
        raise SystemExit("usage: library-analysis.py facts|delta|proposal INPUT OUTPUT")
    mode, input_path, output_path = argv[1:]
    request = read_json(input_path)
    result = facts(request) if mode == "facts" else delta(request) if mode == "delta" else proposal(request, output_path)
    write_once(output_path, result)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
