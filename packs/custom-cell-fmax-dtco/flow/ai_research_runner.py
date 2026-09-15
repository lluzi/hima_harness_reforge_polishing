#!/usr/bin/env python3
"""Fixed I/O, provenance and validation for the AI-authored discovery algorithm."""
from __future__ import annotations

import hashlib
import gzip
import json
import math
import re
import subprocess
import sys
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "domain"))
from _generation_projection import retained_candidate_ids  # noqa: E402

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


def _held_artifact(workspace, record, role):
    rows = [row for row in record.get("artifacts", []) if row.get("role") == role]
    if len(rows) != 1:
        raise ValueError("prior record has no unique %s artifact" % role)
    ref = rows[0]
    path = Path(str(ref.get("path") or ""))
    at = path if path.is_absolute() else workspace / path
    at = at.resolve()
    if not at.is_file() or at.is_symlink():
        raise ValueError("prior %s artifact is unavailable" % role)
    raw = at.read_bytes()
    if _sha(raw) != ref.get("sha256") or len(raw) != ref.get("bytes"):
        raise ValueError("prior %s artifact identity changed" % role)
    return at


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
    context = {
        "design_top": top,
        "path_group": "reg2reg",
        "reg2reg_wns_ns": float(metric["worst_slack_ns"]),
        "reg2reg_path_count": len(groups),
        "timing_report_sha256": _sha(timing),
        "algorithm_revision": str(revision),
        "source_phase": "dc-probe",
        "current_fmax_mhz": 1000.0 / (float(metric["asked_period_ns"]) - float(metric["worst_slack_ns"])),
        "current_gain_pct": 0.0,
    }
    pnr_path = flow / "records" / "pnr-generated.json"
    compare_path = flow / "records" / "compare.json"
    if pnr_path.is_file() and compare_path.is_file():
        pnr, compare = _json(pnr_path), _json(compare_path)
        facts = compare.get("facts") or {}
        if (pnr.get("status") == "passed" and compare.get("status") == "passed"
                and facts.get("comparison_valid") is True):
            compressed = _held_artifact(workspace, pnr, "postroute_timing_paths")
            with gzip.open(compressed, "rb") as source:
                routed_timing = source.read()
            groups = re.findall(rb"(?m)^Path Groups:\s*\{([^}]+)\}\s*$", routed_timing)
            slacks = [float(value) for value in re.findall(rb"(?m)^= Slack Time\s+(-?[0-9.eE+-]+)\s*$", routed_timing)]
            if not groups or set(groups) != {b"reg2reg"} or not slacks:
                raise ValueError("prior generated post-route timing is not explicit reg2reg evidence")
            context.update({
                "source_phase": "generated-postroute",
                "reg2reg_wns_ns": min(slacks),
                "reg2reg_path_count": len(groups),
                "timing_report_sha256": _sha(routed_timing),
                "current_fmax_mhz": float(facts["generated_fmax_mhz"]),
                "current_gain_pct": float(facts["fmax_improvement_pct"]),
            })
    return context


def _theoretical_gain(item, context):
    evidence = item.get("discovery_evidence") or {}
    occurrences = evidence.get("occurrences") or []
    increments = [float(row.get("reg2reg_increment_ns") or 0.0)
                  for row in occurrences if isinstance(row, dict)]
    root_upper = max(increments + [float(evidence.get("reg2reg_increment_ns") or 0.0)])
    cone_upper = float(evidence.get("reg2reg_cone_delay_upper_ns") or 0.0)
    saving_upper = max(root_upper, cone_upper)
    path_ranks = sorted({int(rank) for row in occurrences if isinstance(row, dict)
                         for rank in (row.get("reg2reg_path_ranks") or [])
                         if isinstance(rank, int) and rank > 0})
    path_families = sorted({str(family) for row in occurrences if isinstance(row, dict)
                            for family in (row.get("reg2reg_path_family_ids") or [])
                            if isinstance(family, str) and family})
    if not path_families:
        path_families = sorted(str(value) for value in (evidence.get("reg2reg_path_family_ids") or [])
                               if isinstance(value, str) and value)
    current_fmax = float(context["current_fmax_mhz"])
    closed_period = 1000.0 / current_fmax
    if saving_upper <= 0 or saving_upper >= closed_period:
        gain_upper = None
    else:
        gain_upper = (1000.0 / (closed_period - saving_upper) / current_fmax - 1.0) * 100.0
    return {
        "evidence_status": "path-delay upper bound" if gain_upper is not None else "no explicit path-delay bound",
        "path_delay_basis": ("observed candidate-cone delay" if cone_upper > 0
                             else "observed root Cell delay" if root_upper > 0 else None),
        "path_delay_removal_upper_ns": round(saving_upper, 6) if saving_upper > 0 else None,
        "incremental_fmax_gain_upper_pct": round(gain_upper, 6) if gain_upper is not None and math.isfinite(gain_upper) else None,
        "covered_reg2reg_path_count": len(path_ranks),
        "covered_reg2reg_path_ranks": path_ranks,
        "covered_reg2reg_path_family_count": len(path_families),
        "covered_reg2reg_path_families": path_families,
        "covered_reg2reg_family_path_support": int(evidence.get("reg2reg_path_family_support") or 0),
        "worst_covered_path_slack_ns": evidence.get("reg2reg_worst_path_slack_ns"),
        "current_fmax_mhz": round(current_fmax, 6),
        "current_gain_pct": round(float(context["current_gain_pct"]), 6),
        "target_gain_pct": round(float(context["target_gain_pct"]), 6),
        "remaining_gain_pct": round(max(0.0, float(context["target_gain_pct"]) - float(context["current_gain_pct"])), 6),
        "required_incremental_fmax_gain_pct": round(float(context["required_incremental_fmax_gain_pct"]), 6),
        "meets_remaining_target_upper_bound": (gain_upper is not None
                                                and gain_upper >= float(context["required_incremental_fmax_gain_pct"])),
        "limitations": "upper bound removes the full observed Cell-cone increment and does not model remapping, RC, path migration or overlap",
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
        compact = {key: facts.get(key) for key in (
            "adopted_instance_count", "adopted_candidate_count",
            "generated_fmax_mhz", "foundry_fmax_mhz",
            "fmax_delta_mhz", "fmax_improved", "full_constraint_failures",
            "reg2reg_wns_ns", "rejected_reason", "tool_failure_reason",
        ) if key in facts}
        if stage == "adoption":
            compact["method_rows"] = facts.get("method_rows") or []
            compact["adopted_candidates"] = [
                row for row in (facts.get("candidate_rows") or [])
                if isinstance(row, dict) and int(row.get("adopted_instance_count") or 0) > 0
            ]
        rows.append({
            "stage": stage, "sha256": _sha(raw),
            "facts": compact,
        })
    return rows


def _candidate_key(request):
    contract = request.get("generator_contract") or {}
    reference = contract.get("equivalence_reference") or {}
    profile = contract.get("target_library_profile") or {}
    return (reference.get("digest"), tuple(reference.get("output_order") or ()),
            json.dumps(profile, sort_keys=True, separators=(",", ":")))


def _prior_candidates(workspace, budget):
    flow = workspace / "flow"
    adoption_path = flow / "records" / "adoption.json"
    characterize_path = flow / "records" / "characterize.json"
    if not adoption_path.is_file() or not characterize_path.is_file():
        return [], None
    adoption, characterize = _json(adoption_path), _json(characterize_path)
    if adoption.get("status") != "passed" or characterize.get("status") != "passed":
        return [], None
    pattern_path = _held_artifact(workspace, characterize, "characterized_patterns")
    patterns = _json(pattern_path)
    requests = patterns.get("generation_requests")
    rows = (adoption.get("facts") or {}).get("candidate_rows")
    if not isinstance(requests, list):
        raise ValueError("prior characterized patterns have no generation requests")
    retained_ids = retained_candidate_ids(rows, budget)
    by_id = {row.get("candidate_id"): row for row in requests if isinstance(row, dict)}
    if len(by_id) != len(requests) or any(candidate not in by_id for candidate in retained_ids):
        raise ValueError("prior adopted candidates differ from characterized patterns")
    adopted = {row["candidate_id"]: row for row in rows if isinstance(row, dict)}
    retained = []
    for candidate in retained_ids:
        request = json.loads(json.dumps(by_id[candidate]))
        request["retained_adoption"] = {
            "generation_rank": adopted[candidate]["generation_rank"],
            "adopted_instance_count": adopted[candidate]["adopted_instance_count"],
            "source_methods": adopted[candidate]["source_methods"],
        }
        retained.append(request)
    source = {"patternsSha256": _sha(pattern_path.read_bytes()),
              "adoptionRecordSha256": _sha(adoption_path.read_bytes()),
              "retainedCandidateIds": retained_ids}
    return retained, source


def _representative_rank(item):
    evidence = item.get("discovery_evidence") or {}
    slack = evidence.get("reg2reg_worst_path_slack_ns")
    slack_rank = float(slack) if isinstance(slack, (int, float)) else math.inf
    return (-int(evidence.get("reg2reg_path_family_count") or 0),
            -int(evidence.get("reg2reg_path_family_support") or 0),
            slack_rank,
            -int(evidence.get("reg2reg_path_hits") or 0),
            -float(evidence.get("reg2reg_increment_ns") or 0.0),
            -int(evidence.get("non_overlapping_support") or 0),
            ROUTES.index(item["route"]), item["candidate_id"])


def _sources(workspace, context, excluded_keys):
    flow = workspace / "flow"
    sources, grouped = {}, {}
    raw_count = 0
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
        for local_rank, request in enumerate(requests, 1):
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
            key = _candidate_key(item)
            if not key[0]:
                continue
            raw_count += 1
            group = grouped.setdefault(key, {"representatives": [], "members": []})
            group["representatives"].append(item)
            group["members"].append({"method": route, "candidate_id": candidate_id,
                                     "local_rank": local_rank})
    candidates, by_identity = [], {}
    for group in grouped.values():
        if _candidate_key(group["representatives"][0]) in excluded_keys:
            continue
        representative = min(group["representatives"], key=_representative_rank)
        methods = sorted({row["method"] for row in group["members"]}, key=ROUTES.index)
        rankings = {}
        for row in group["members"]:
            current = rankings.get(row["method"])
            if current is None or row["local_rank"] < current["local_rank"]:
                rankings[row["method"]] = {"candidate_id": row["candidate_id"],
                                            "local_rank": row["local_rank"]}
        representative["source_methods"] = methods
        representative["method_rankings"] = rankings
        representative["theoretical_gain"] = _theoretical_gain(representative, context)
        candidates.append(representative)
        by_identity[(representative["route"], representative["candidate_id"])] = representative
    candidates.sort(key=_representative_rank)
    return candidates, sources, by_identity, raw_count


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
    expected_count = min(budget, len(candidates))
    if not isinstance(selected, list) or len(selected) != expected_count:
        raise ValueError("research selection must fill min(MAX_CELLS, unified unique candidate pool)")
    seen = set()
    for item in selected:
        if not isinstance(item, dict) or set(item) != {"route", "candidate_id", "hypothesis", "rationale"}:
            raise ValueError("each selection must contain route, candidate_id, hypothesis and rationale")
        key = (item["route"], item["candidate_id"])
        if key not in by_identity or key in seen or item["hypothesis"] not in names:
            raise ValueError("selection is not a unique source candidate tied to a stated hypothesis")
        if not isinstance(item["rationale"], str) or not item["rationale"].strip():
            raise ValueError("each selection needs a rationale")
        seen.add(key)
    if not isinstance(proposal["stop_reason"], str) or not proposal["stop_reason"].strip():
        raise ValueError("research() must state why this finite selection is enough for the next screen")
    return hypotheses, selected


def run(research, argv):
    if len(argv) != 4:
        raise SystemExit("usage: entry.py WORKSPACE REVISION TARGET_GAIN_PCT")
    workspace = Path(argv[1]).resolve()
    revision = argv[2]
    target_gain = float(argv[3])
    if not math.isfinite(target_gain) or not 0.1 <= target_gain <= 25:
        raise ValueError("TARGET_GAIN_PCT must be within 0.1..25")
    inputs = _json(workspace / "flow" / "inputs.json")
    budget = inputs.get("MAX_CELLS")
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 50:
        raise ValueError("MAX_CELLS must be within 1..50")
    context = _probe_context(workspace, revision)
    context["target_gain_pct"] = target_gain
    baseline_fmax = context["current_fmax_mhz"] / (1.0 + context["current_gain_pct"] / 100.0)
    target_fmax = baseline_fmax * (1.0 + target_gain / 100.0)
    context["baseline_fmax_mhz"] = baseline_fmax
    context["target_fmax_mhz"] = target_fmax
    context["required_incremental_fmax_gain_pct"] = max(
        0.0, (target_fmax / context["current_fmax_mhz"] - 1.0) * 100.0)
    context["required_closed_period_reduction_ns"] = max(
        0.0, 1000.0 / context["current_fmax_mhz"] - 1000.0 / target_fmax)
    context["prior_feedback"] = _prior_feedback(workspace)
    retained, prior_source = _prior_candidates(workspace, budget)
    retained_keys = {_candidate_key(row) for row in retained}
    new_budget = budget - len(retained)
    context["active_cell_budget"] = budget
    context["retained_candidate_count"] = len(retained)
    context["retained_candidates"] = [row["retained_adoption"] | {"candidate_id": row["candidate_id"]}
                                      for row in retained]
    context["max_cells"] = new_budget
    context["max_new_cells"] = new_budget
    candidates, sources, by_identity, raw_count = _sources(workspace, context, retained_keys)
    context["candidate_pool_count"] = len(candidates)
    context["raw_candidate_count"] = raw_count
    proposal = research(candidates, context)
    hypotheses, selected = _validate(proposal, candidates, by_identity, new_budget)
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
        "target": {key: context[key] for key in ("design_top", "path_group", "reg2reg_wns_ns", "reg2reg_path_count",
                                                   "timing_report_sha256", "source_phase", "current_fmax_mhz",
                                                   "current_gain_pct", "target_gain_pct", "baseline_fmax_mhz",
                                                   "target_fmax_mhz", "required_incremental_fmax_gain_pct",
                                                   "required_closed_period_reduction_ns")},
        "algorithm": {"revision": str(revision), "entryPath": str(entry.relative_to(workspace)),
                      "entrySha256": entry_sha, "candidatePoolCount": len(candidates),
                      "rawCandidateCount": raw_count},
        "sources": sources,
        "priorCandidateSource": prior_source,
        "retainedCandidates": context["retained_candidates"],
        "priorFeedback": context["prior_feedback"],
        "hypotheses": hypotheses,
        "selected": selected,
        "theoreticalEstimates": [
            {"route": row["route"], "candidate_id": row["candidate_id"],
             **by_identity[(row["route"], row["candidate_id"])]["theoretical_gain"]}
            for row in selected
        ],
        "stopReason": proposal["stop_reason"],
        "limitations": ["The ordered Cell set combines all method evidence; it is not a method competition.",
                        "Candidate ranking is a research hypothesis, not mapper adoption or PPA evidence.",
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
