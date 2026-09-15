#!/usr/bin/env python3
"""Fixed I/O, provenance and validation for the AI-authored discovery algorithm."""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import uuid
from pathlib import Path

ROUTES = (
    "timing_criticality", "timing_context", "structure_frequency",
    "structure_compaction", "mapper_compatibility", "functional_diversity",
)
BUILDABLE_ROUTES = {"fusion", "cluster_compose", "boolean_synthesis"}
SCHEMA = "custom-cell-fmax-ai-research/1"
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(path):
    return json.loads(path.read_text())


def _probe_context(workspace, revision):
    flow = workspace / "flow"
    probe = _json(flow / "probe.json")
    identity = probe.get("effectiveIdentity") or {}
    top = (identity.get("inputs") or {}).get("designTop")
    timing_ref = (probe.get("evidence") or {}).get("timing.rpt") or {}
    metrics_ref = (probe.get("evidence") or {}).get("metrics") or {}
    timing_path = flow / str(timing_ref.get("path") or "")
    metrics_path = flow / str(metrics_ref.get("path") or "")
    if not isinstance(top, str) or not top or not timing_path.is_file() or not metrics_path.is_file():
        raise ValueError("probe lacks designTop, timing report or metrics")
    timing = timing_path.read_bytes()
    metrics = metrics_path.read_text()
    if _sha(timing) != timing_ref.get("sha256") or _sha(metrics.encode()) != metrics_ref.get("sha256"):
        raise ValueError("probe evidence changed after synthesis")
    design = re.findall(rb"(?m)^Design\s*:\s*(\S+)\s*$", timing)
    groups = re.findall(rb"(?m)^\s*Path Group:\s*(\S+)\s*$", timing)
    slacks = [float(value) for value in re.findall(rb"(?m)^\s*slack\s+\([^)]*\)\s+(-?[0-9.]+)\s*$", timing)]
    metric = dict(line.split("\t", 1) for line in metrics.splitlines() if "\t" in line)
    if design != [top.encode()] or not groups or set(groups) != {b"reg2reg"} or not slacks:
        raise ValueError("AI research requires one design identity and exclusively reg2reg timing paths")
    return {
        "design_top": top,
        "path_group": "reg2reg",
        "reg2reg_wns_ns": float(metric["worst_slack_ns"]),
        "reg2reg_path_count": len(groups),
        "timing_report_sha256": _sha(timing),
        "algorithm_revision": str(revision),
    }


def _prior_feedback(workspace):
    rows = []
    for stage in ("custom-synth", "adoption", "compare"):
        path = workspace / "flow" / "records" / (stage + ".json")
        if not path.is_file() or path.is_symlink():
            continue
        raw = path.read_bytes()
        record = json.loads(raw)
        if record.get("schema") != "custom-cell-fmax-stage/1" or record.get("stage") != stage:
            continue
        facts = record.get("facts") or {}
        rows.append({
            "stage": stage, "sha256": _sha(raw),
            "facts": {key: facts.get(key) for key in (
                "adopted_instance_count", "generated_fmax_mhz", "foundry_fmax_mhz",
                "fmax_delta_mhz", "fmax_improved", "full_constraint_failures",
                "reg2reg_wns_ns", "rejected_reason", "tool_failure_reason",
            ) if key in facts},
        })
    return rows


def _sources(workspace):
    flow = workspace / "flow"
    candidates, sources, by_identity = [], {}, {}
    for route in ROUTES:
        raw_path = flow / "mining" / route / "raw.json"
        record_path = flow / "records" / ("mine-" + route + ".json")
        raw_bytes, record_bytes = raw_path.read_bytes(), record_path.read_bytes()
        raw, record = json.loads(raw_bytes), json.loads(record_bytes)
        if raw.get("report_schema") != "xspace_cell-pattern-search/v2" or raw.get("strategy_id") != route:
            raise ValueError("%s raw report identity is invalid" % route)
        if record.get("schema") != "custom-cell-fmax-stage/1" or record.get("status") != "passed":
            raise ValueError("%s mine record is not passed" % route)
        artifact = [row for row in record.get("artifacts", []) if row.get("role") == "mining_raw"]
        if len(artifact) != 1 or artifact[0].get("sha256") != _sha(raw_bytes):
            raise ValueError("%s raw report is not held by its mine record" % route)
        code = (record.get("facts") or {}).get("codeSha256")
        sources[route] = {"rawSha256": _sha(raw_bytes), "recordSha256": _sha(record_bytes), "minerCodeSha256": code}
        requests = raw.get("generation_requests")
        if not isinstance(requests, list):
            raise ValueError("%s generation_requests is not an array" % route)
        for request in requests:
            candidate_id = request.get("candidate_id") if isinstance(request, dict) else None
            plan = (request.get("implementation_plan") or {}) if isinstance(request, dict) else {}
            digest = (((request.get("generator_contract") or {}).get("equivalence_reference") or {}).get("digest")
                      if isinstance(request, dict) else None)
            if not isinstance(candidate_id, str) or not IDENTIFIER.fullmatch(candidate_id) or plan.get("route") not in BUILDABLE_ROUTES or not digest:
                continue
            item = json.loads(json.dumps(request))
            item["route"] = route
            evidence = item.get("discovery_evidence") or {}
            contract = item.get("generator_contract") or {}
            item["evidence"] = json.loads(json.dumps(evidence))
            item["interface"] = json.loads(json.dumps(contract.get("interface") or {}))
            item["equivalence_digest"] = digest
            item["implementation_route"] = plan.get("route")
            candidates.append(item)
            by_identity[(route, candidate_id)] = item
    return candidates, sources, by_identity


def _validate(proposal, candidates, by_identity, budget):
    if not isinstance(proposal, dict) or set(proposal) != {"hypotheses", "selected", "stop_reason"}:
        raise ValueError("research() must return hypotheses, selected and stop_reason")
    hypotheses = proposal["hypotheses"]
    selected = proposal["selected"]
    if not isinstance(hypotheses, list) or not 3 <= len(hypotheses) <= 12:
        raise ValueError("research() must examine 3..12 distinct hypotheses")
    names = set()
    for item in hypotheses:
        if not isinstance(item, dict) or set(item) != {"name", "question", "signals"}:
            raise ValueError("each hypothesis must contain name, question and signals")
        if not all(isinstance(item[key], str) and item[key].strip() for key in ("name", "question")):
            raise ValueError("hypothesis name and question must be nonempty")
        if item["name"] in names:
            raise ValueError("hypothesis names must be unique")
        names.add(item["name"])
        if not isinstance(item["signals"], list) or not item["signals"] or any(not isinstance(value, str) or not value.strip() for value in item["signals"]):
            raise ValueError("each hypothesis must name at least one evidence signal")
    distinct_pool = {((row.get("generator_contract") or {}).get("equivalence_reference") or {}).get("digest")
                     for row in candidates}
    distinct_pool.discard(None)
    expected_count = min(budget, len(distinct_pool))
    if not isinstance(selected, list) or len(selected) != expected_count or expected_count < 1:
        raise ValueError("research selection must fill min(MAX_CELLS, distinct Boolean pool)")
    seen, digests = set(), set()
    for item in selected:
        if not isinstance(item, dict) or set(item) != {"route", "candidate_id", "hypothesis", "rationale"}:
            raise ValueError("each selection must contain route, candidate_id, hypothesis and rationale")
        key = (item["route"], item["candidate_id"])
        if key not in by_identity or key in seen or item["hypothesis"] not in names:
            raise ValueError("selection is not a unique source candidate tied to a stated hypothesis")
        if not isinstance(item["rationale"], str) or not item["rationale"].strip():
            raise ValueError("each selection needs a rationale")
        digest = ((by_identity[key]["generator_contract"].get("equivalence_reference") or {}).get("digest"))
        if digest in digests:
            raise ValueError("AI research selected duplicate Boolean equivalence classes")
        seen.add(key)
        digests.add(digest)
    used_hypotheses = {item["hypothesis"] for item in selected}
    if len(selected) > 1 and len(used_hypotheses) < 2:
        raise ValueError("a multi-Cell screen must represent at least two competing hypotheses")
    if not isinstance(proposal["stop_reason"], str) or not proposal["stop_reason"].strip():
        raise ValueError("research() must state why this finite selection is enough for the next screen")
    return hypotheses, selected


def run(research, argv):
    if len(argv) != 3:
        raise SystemExit("usage: entry.py WORKSPACE REVISION")
    workspace = Path(argv[1]).resolve()
    revision = argv[2]
    inputs = _json(workspace / "flow" / "inputs.json")
    budget = inputs.get("MAX_CELLS")
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 32:
        raise ValueError("MAX_CELLS must be within 1..32")
    context = _probe_context(workspace, revision)
    context["max_cells"] = budget
    context["prior_feedback"] = _prior_feedback(workspace)
    candidates, sources, by_identity = _sources(workspace)
    context["candidate_pool_count"] = len(candidates)
    proposal = research(candidates, context)
    hypotheses, selected = _validate(proposal, candidates, by_identity, budget)
    entry = Path(argv[0]).resolve()
    if not entry.is_relative_to(workspace / "research" / "ai-discovery" / ".executions"):
        raise ValueError("Workshop entry is outside its isolated execution directory")
    entry_sha = _sha(entry.read_bytes())
    output = workspace / "flow" / "research" / "research.json"
    attempt = workspace / "flow" / "research-attempts" / uuid.uuid4().hex
    output.parent.mkdir(parents=True, exist_ok=True)
    attempt.mkdir(parents=True, exist_ok=False)
    if output.exists():
        output.replace(attempt / "previous-research.json")
    document = {
        "schema": SCHEMA,
        "target": {key: context[key] for key in ("design_top", "path_group", "reg2reg_wns_ns", "reg2reg_path_count", "timing_report_sha256")},
        "algorithm": {"revision": str(revision), "entryPath": str(entry.relative_to(workspace)),
                      "entrySha256": entry_sha, "candidatePoolCount": len(candidates)},
        "sources": sources,
        "priorFeedback": context["prior_feedback"],
        "hypotheses": hypotheses,
        "selected": selected,
        "stopReason": proposal["stop_reason"],
        "limitations": ["Selection is a research hypothesis, not mapper adoption or PPA evidence.",
                        "Only the downstream pressured synthesis and matched physical comparison can establish value."],
    }
    output.write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")
    for route in ROUTES:
        raw = (workspace / "flow" / "mining" / route / "raw.json").read_bytes()
        ids = [row["candidate_id"] for row in selected if row["route"] == route]
        destination = workspace / "flow" / "mining" / route / "selected.json"
        destination.write_text(json.dumps({"sourceSha256": _sha(raw), "selected": ids,
                                           "codeSha256": sources[route]["minerCodeSha256"]}, indent=2) + "\n")
    (attempt / "research.json").write_bytes(output.read_bytes())
    checked = subprocess.run(["/usr/bin/python3", str(workspace / "flow" / "read-stage.py"),
                              str(output), str(attempt / "reading.json"), "research-selection"], timeout=30)
    (attempt / "receipt.json").write_text(json.dumps({"entrySha256": entry_sha, "revision": revision,
                                                       "validationExit": checked.returncode}, indent=2) + "\n")
    if checked.returncode:
        raise SystemExit(checked.returncode)
    print(json.dumps({"selected": len(selected), "hypotheses": len(hypotheses), "entrySha256": entry_sha}))
