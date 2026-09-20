#!/usr/bin/env python3
"""Fixed I/O, provenance and validation for the AI-authored discovery algorithm."""
from __future__ import annotations

import hashlib
import gzip
import ast
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "domain"))
from _generation_projection import retained_candidate_ids  # noqa: E402
from _generation_projection import validate_cumulative_manifest  # noqa: E402
from cell_need_miner.generator_contract import validate_generation_request  # noqa: E402

ROUTES = (
    "timing_criticality", "timing_context", "structure_frequency",
    "structure_compaction", "mapper_compatibility", "functional_diversity",
)
BUILDABLE_ROUTES = {
    "fusion", "cluster_compose", "boolean_synthesis", "multi_output_resynthesis",
}
SCHEMA = "custom-cell-fmax-ai-research/1"
RESIDUAL_REQUEST_SCHEMA = "lfr-ai-residual-request/1"
RESIDUAL_CONTEXT_SCHEMA = "lfr-ai-residual-context/1"
RESIDUAL_OUTPUT_SCHEMA = "lfr-ai-residual-research/1"
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
RESIDUAL_EXECUTION_TIMEOUT_SECONDS = 5
RESIDUAL_CPU_SECONDS = 2
RESIDUAL_MEMORY_BYTES = 512 * 1024 * 1024
RESIDUAL_FILE_BYTES = 1024 * 1024
RESIDUAL_OUTPUT_BYTES = 256 * 1024
RESIDUAL_STDERR_BYTES = 16 * 1024
RESIDUAL_CONTEXT_BYTES = 512 * 1024
RESIDUAL_CANDIDATE_POOL_BYTES = 8 * 1024 * 1024
# The final document reattaches runner-owned, hash-bound generation requests.
# A 50-Cell real-design portfolio can legitimately exceed 1 MiB even though
# the model context and executable proposal envelope remain tightly bounded.
RESIDUAL_DOCUMENT_BYTES = 8 * 1024 * 1024
RESIDUAL_TEXT_BYTES = 8192
RESIDUAL_NAME_BYTES = 256
RESIDUAL_MAX_STATIC_ITERATIONS = 128
ONSITE_INSPIRATION_LENS = "onsite-inspiration"

_RESIDUAL_EXECUTOR = r'''#!/usr/bin/env python3
import json
import resource
import sys

applied_limits = {}
def apply_limit(name, resource_id, value):
    try:
        resource.setrlimit(resource_id, (value, value))
        applied_limits[name] = {"applied": True, "value": value}
    except (OSError, ValueError):
        applied_limits[name] = {"applied": False, "value": None}

apply_limit("cpu_seconds", resource.RLIMIT_CPU, 2)
apply_limit("file_bytes", resource.RLIMIT_FSIZE, 1048576)
apply_limit("core_bytes", resource.RLIMIT_CORE, 0)
apply_limit("open_files", resource.RLIMIT_NOFILE, 32)
if sys.platform == "darwin":
    applied_limits["memory_bytes"] = {"applied": False, "value": None}
else:
    apply_limit("memory_bytes", resource.RLIMIT_AS, 536870912)

safe_builtins = {
    "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
    "enumerate": enumerate, "float": float, "int": int, "len": len,
    "isinstance": isinstance, "list": list, "max": max, "min": min, "range": range,
    "reversed": reversed, "round": round, "set": set, "sorted": sorted,
    "str": str, "sum": sum, "tuple": tuple, "zip": zip,
}
request = json.load(sys.stdin)
namespace = {"__builtins__": safe_builtins}
source = open(sys.argv[1], "r", encoding="utf-8").read()
exec(compile(source, "<candidate-program>", "exec"), namespace, namespace)
result = namespace["propose_candidates"](request["residual"], request["budget"])
envelope = {"proposals": result, "posix_limits": applied_limits}
payload = (json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n").encode()
if len(payload) > 262144:
    raise SystemExit(65)
sys.stdout.buffer.write(payload)
'''


def _canonical_json(value):
    return (json.dumps(value, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=False) + "\n").encode()


def _bound_json_reference(base, reference, name, maximum_bytes=RESIDUAL_CONTEXT_BYTES):
    """Load one regular JSON file whose bytes are explicitly SHA-bound."""
    if not isinstance(reference, dict) or set(reference) != {"path", "sha256"}:
        raise ValueError("%s must contain exactly path and sha256" % name)
    relative = Path(str(reference.get("path") or ""))
    digest = str(reference.get("sha256") or "")
    if relative.is_absolute() or ".." in relative.parts or not SHA256.fullmatch(digest):
        raise ValueError("%s path or sha256 is invalid" % name)
    root = Path(base).resolve()
    path = (root / relative).resolve()
    if (not path.is_relative_to(root) or not path.is_file() or path.is_symlink()):
        raise ValueError("%s is outside the residual evidence root" % name)
    size = path.stat().st_size
    if size > maximum_bytes:
        raise ValueError("%s exceeds the bound evidence file byte limit" % name)
    raw = path.read_bytes()
    if _sha(raw) != digest:
        raise ValueError("%s changed after the residual request was authored" % name)
    try:
        document = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("%s is not valid JSON" % name) from error
    if not isinstance(document, dict):
        raise ValueError("%s JSON root must be an object" % name)
    return document, {"path": str(relative), "sha256": digest, "bytes": size}


def _finite_metric(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("%s must be numeric" % name)
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("%s must be finite" % name)
    return value


def _bounded_text(value, name, maximum=RESIDUAL_TEXT_BYTES):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s must be non-empty text" % name)
    value = value.strip()
    if len(value.encode()) > maximum:
        raise ValueError("%s exceeds its text byte limit" % name)
    return value


def _canonical_lens_name(value, name):
    text = _bounded_text(value, name, RESIDUAL_NAME_BYTES).casefold()
    canonical = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    if not canonical:
        raise ValueError("%s has no canonical name" % name)
    return canonical


def _metric_layer(name):
    if name.startswith(("F0.", "F1.", "F2.", "F3.")):
        return name[:2]
    return {
        "structural": "F1",
        "mapping": "F2",
        "proxy": "F3",
    }.get(name.split(".", 1)[0])


def _compact_metric_vectors(evaluation):
    """Project the paired agent result without carrying reports or QoR claims."""
    schema = evaluation.get("schema")
    if (schema not in {"lfr-round-evaluation/3", "lfr-baseline-evaluation/1"}
            or evaluation.get("status") != "succeeded"):
        raise ValueError(
            "evaluation must be one succeeded lfr-round-evaluation/3 or lfr-baseline-evaluation/1")
    limits = evaluation.get("claim_limits") or {}
    required_limits = (("commercial_qor_predicted", "fmax_predicted", "commercial_eda_executed")
                       if schema == "lfr-baseline-evaluation/1" else
                       ("fmax_claimed", "commercial_adoption_claimed", "physical_benefit_claimed",
                        "expected_qor_claimed", "commercial_eda_executed"))
    if any(limits.get(key) is not False for key in required_limits):
        raise ValueError("evaluation claim limits do not describe a license-free indicator agent")
    scenarios = evaluation.get("scenarios")
    if not isinstance(scenarios, dict) or not scenarios:
        raise ValueError("evaluation has no scenario metric vectors")
    compact = {}
    available_layers = set()
    for scenario_name in sorted(scenarios):
        scenario = scenarios[scenario_name]
        if not isinstance(scenario, dict) or scenario.get("status") != "succeeded":
            compact[scenario_name] = {
                "status": str((scenario or {}).get("status") or "missing"),
                "reason": str((scenario or {}).get("reason") or "metric vector unavailable"),
            }
            continue
        relation = scenario.get("pairwise_relation") or {}
        comparisons = relation.get("comparisons")
        if schema == "lfr-baseline-evaluation/1" and comparisons == []:
            # A cold-start baseline has no augmented delta yet.  Preserve its
            # measured F0/F2/F3 scalar indicators as equal reference values so
            # the research Agent can reason from the actual design state.  The
            # F1 candidate vectors arrive through the separately hash-bound
            # candidate pool; none of these equal rows predicts commercial QoR.
            directions = {
                "F0.candidate_cells_declared": "maximize",
                "F0.candidate_cells_adopted": "maximize",
                "F2.mapped_instance_count": "minimize",
                "F2.max_logic_level": "minimize",
                "F2.mean_fanout": "minimize",
                "F2.mean_load_indicator": "minimize",
                "F2.buffer_inverter_pressure_ratio": "minimize",
                "F2.mean_path_stage_count": "minimize",
                "F3.worst_delay_indicator_ps": "minimize",
                "F3.worst_slack_indicator_ps": "maximize",
                "F3.negative_slack_mass_indicator_ps": "minimize",
                "F3.path_family_coverage": "maximize",
                "F3.path_count": "maximize",
            }
            comparisons = []
            reference = scenario.get("reference") or {}
            for layer in ("F0", "F2", "F3"):
                values = reference.get(layer) or {}
                if not isinstance(values, dict):
                    continue
                for name, value in sorted(values.items()):
                    metric = "%s.%s" % (layer, name)
                    if (metric in directions and not isinstance(value, bool)
                            and isinstance(value, (int, float)) and math.isfinite(float(value))):
                        comparisons.append({
                            "metric": metric, "direction": directions[metric],
                            "reference": float(value), "augmented": float(value),
                            "relation": "equal",
                        })
        if not isinstance(comparisons, list):
            raise ValueError("scenario %s has no pairwise comparisons" % scenario_name)
        rows = []
        for index, item in enumerate(comparisons):
            if not isinstance(item, dict):
                raise ValueError("scenario comparison %d is not an object" % index)
            metric = str(item.get("metric") or "")
            layer = _metric_layer(metric)
            if layer is None:
                continue
            direction = item.get("direction")
            relation_name = item.get("relation")
            if direction not in {"minimize", "maximize"} or relation_name not in {
                    "improved", "regressed", "equal"}:
                raise ValueError("scenario comparison %s is malformed" % metric)
            rows.append({
                "metric": metric,
                "layer": layer,
                "direction": direction,
                "reference": _finite_metric(item.get("reference"), metric + ".reference"),
                "augmented": _finite_metric(item.get("augmented"), metric + ".augmented"),
                "relation": relation_name,
            })
            available_layers.add(layer)
        migration = scenario.get("path_migration") or {}
        compact_migration = {}
        for key in ("path_families_added", "path_families_removed", "path_families_retained"):
            values = migration.get(key) or []
            if not isinstance(values, list) or any(
                    not isinstance(value, str) or len(value.encode()) > RESIDUAL_NAME_BYTES
                    for value in values):
                raise ValueError("scenario %s path migration is malformed" % scenario_name)
            compact_migration[key] = values[:32]
            compact_migration[key + "_count"] = len(values)
        compact[scenario_name] = {
            "status": "succeeded",
            "relation": relation.get("relation"),
            "metrics": rows,
            "path_migration": compact_migration,
        }
    aggregate = evaluation.get("pairwise_relation") or {}
    return {
        "available_layers": sorted(available_layers),
        "aggregate_relation": aggregate.get("relation"),
        "scenarios": compact,
    }


def _normalize_frontier(frontier, allowed_evaluation_hashes, *, candidate_pool_nonempty=False):
    """Verify, then compact, a generic cross-round Pareto-frontier document.

    The producer may choose its own schema name.  The deterministic seam is the
    four fields below, so the AI never has to infer frontier membership.
    """
    if frontier.get("status") not in (None, "succeeded"):
        raise ValueError("frontier input is not succeeded")
    limits = frontier.get("claim_limits")
    if limits is not None and (
            not isinstance(limits, dict)
            or any(limits.get(name) is not False for name in (
                "commercial_qor_predicted", "fmax_predicted", "commercial_eda_executed"))):
        raise ValueError("frontier claim limits permit an unsupported commercial prediction")
    objectives = frontier.get("objectives")
    members = frontier.get("members")
    declared = frontier.get("frontier_member_ids")
    if not all(isinstance(value, list) for value in (objectives, members, declared)):
        raise ValueError("frontier objectives, members and member ids must be arrays")
    library_cost = frontier.get("library_cost") or {}
    if not isinstance(library_cost, dict):
        raise ValueError("frontier library_cost must be an object")
    normalized_cost = {}
    for name, value in sorted(library_cost.items()):
        if not isinstance(name, str) or not name:
            raise ValueError("frontier library_cost names must be non-empty")
        normalized_cost[name] = _finite_metric(value, "library_cost." + name)
        if normalized_cost[name] < 0:
            raise ValueError("frontier library_cost values must be non-negative")
    residual_question = frontier.get("next_residual_question")
    if (not isinstance(residual_question, dict)
            or not isinstance(residual_question.get("id"), str)
            or not residual_question["id"]
            or not isinstance(residual_question.get("prompt"), str)):
        raise ValueError("frontier has no explicit next residual question")
    normalized_question = {
        "id": _bounded_text(
            residual_question["id"], "frontier residual question id", RESIDUAL_NAME_BYTES),
        "prompt": _bounded_text(
            residual_question["prompt"], "frontier residual question prompt"),
    }
    if not objectives or not members or not declared:
        if objectives or members or declared:
            raise ValueError("empty frontier requires empty objectives, members and member ids")
        gate = (frontier.get("e0_library_validation_candidate")
                or frontier.get("commercial_validation_candidate"))
        if (not candidate_pool_nonempty or not isinstance(gate, dict)
                or gate.get("value") is not False):
            raise ValueError("empty frontier is valid only for a noncommercial candidate-pool cold start")
        return {
            "objectives": [], "members": [], "frontier_member_ids": [],
            "library_cost": normalized_cost,
            "next_residual_question": normalized_question,
            "state": "cold-start-no-adopted-frontier",
        }

    directions = {}
    for index, item in enumerate(objectives):
        if not isinstance(item, dict) or set(item) != {"metric", "direction"}:
            raise ValueError("frontier objective %d is malformed" % index)
        metric, direction = item["metric"], item["direction"]
        if (not isinstance(metric, str) or not metric
                or direction not in {"minimize", "maximize"} or metric in directions):
            raise ValueError("frontier objective %d is invalid" % index)
        directions[metric] = direction

    normalized = []
    ids = set()
    for index, member in enumerate(members):
        required = {"id", "round_id", "evaluation_sha256", "metric_vector"}
        if not isinstance(member, dict) or not required.issubset(member):
            raise ValueError("frontier member %d is malformed" % index)
        member_id = member["id"]
        evaluation_sha = member["evaluation_sha256"]
        vector = member["metric_vector"]
        if (not isinstance(member_id, str) or not member_id or member_id in ids
                or not isinstance(member["round_id"], str) or not member["round_id"]
                or evaluation_sha not in allowed_evaluation_hashes
                or not isinstance(vector, dict) or set(vector) != set(directions)):
            raise ValueError("frontier member %d identity or metric vector is invalid" % index)
        normalized_vector = {
            metric: _finite_metric(vector[metric], "frontier.%s.%s" % (member_id, metric))
            for metric in sorted(directions)
        }
        ids.add(member_id)
        normalized.append({
            "id": member_id,
            "round_id": member["round_id"],
            "evaluation_sha256": evaluation_sha,
            "metric_vector": normalized_vector,
        })
    if len(set(declared)) != len(declared) or any(item not in ids for item in declared):
        raise ValueError("frontier_member_ids contains duplicates or unknown members")

    def dominates(left, right):
        strict = False
        for metric, direction in directions.items():
            lvalue, rvalue = left["metric_vector"][metric], right["metric_vector"][metric]
            better = lvalue < rvalue if direction == "minimize" else lvalue > rvalue
            worse = lvalue > rvalue if direction == "minimize" else lvalue < rvalue
            if worse:
                return False
            strict = strict or better
        return strict

    recomputed = []
    for index, member in enumerate(normalized):
        if any(dominates(other, member) for other in normalized if other is not member):
            continue
        if any(other["metric_vector"] == member["metric_vector"]
               for other in normalized[:index]):
            continue
        recomputed.append(member["id"])
    recomputed.sort()
    if sorted(declared) != recomputed:
        raise ValueError("declared cross-round frontier is not reproducible from its metric vectors")
    return {
        "objectives": [{"metric": metric, "direction": directions[metric]}
                       for metric in sorted(directions)],
        "members": normalized,
        "frontier_member_ids": recomputed,
        "library_cost": normalized_cost,
        "next_residual_question": normalized_question,
        "state": "verified-pareto-frontier",
    }


def _compact_manifest(manifest):
    validate_cumulative_manifest(manifest)
    states = {}
    failures = []
    for row in manifest["functions"]:
        states[row["state"]] = states.get(row["state"], 0) + 1
        for reason in row.get("knownFailures") or []:
            failures.append({
                "function_key": row["functionKey"],
                "candidate_id": row["candidateId"],
                "state": row["state"],
                "reason": _bounded_text(reason, "Library failure reason"),
            })
            if len(failures) > 256:
                raise ValueError("cumulative Library has too many failure records for AI context")
    return {
        "baseline_sha256": manifest["baselineReference"]["sha256"],
        "shards": [{"id": row["id"], "manifest_sha256": row["manifestSha256"]}
                   for row in manifest["shards"]],
        "function_count": len(manifest["functions"]),
        "state_counts": dict(sorted(states.items())),
        "known_failures": failures,
    }


def _compact_candidate_pool(document, source_sha256):
    if (not isinstance(document, dict)
            or document.get("report_schema") != "xspace_cell-pattern-search/v2"):
        raise ValueError("candidate_pool must be xspace_cell-pattern-search/v2")
    requests = document.get("generation_requests")
    if not isinstance(requests, list) or not 1 <= len(requests) <= RESIDUAL_MAX_STATIC_ITERATIONS:
        raise ValueError("candidate_pool generation_requests exceeds its bounded pool size")
    compact = []
    registry = {}
    for index, request in enumerate(requests):
        if not isinstance(request, dict):
            raise ValueError("candidate_pool generation request %d is not an object" % index)
        errors = validate_generation_request(request)
        if errors:
            raise ValueError("candidate_pool generation request %d is invalid: %s"
                             % (index, "; ".join(errors)))
        contract = request.get("generator_contract") or {}
        equivalence = contract.get("equivalence_reference") or {}
        interface = contract.get("interface") or {}
        target_profile = contract.get("target_library_profile") or {}
        implementation = json.loads(json.dumps(contract.get("implementation_request") or {}))
        if (not isinstance(equivalence.get("digest"), str)
                or not isinstance(equivalence.get("input_order"), list)
                or not isinstance(equivalence.get("output_order"), list)
                or not isinstance(equivalence.get("output_truth_tables_hex"), dict)):
            raise ValueError("candidate_pool generation request %d lacks typed equivalence fields"
                             % index)
        if (not isinstance(interface.get("inputs"), list)
                or not isinstance(interface.get("outputs"), list)
                or not interface["outputs"]):
            raise ValueError("candidate_pool generation request %d lacks a typed interface"
                             % index)
        if (not isinstance(target_profile.get("process_family"), str)
                or not isinstance(target_profile.get("cell_architecture_ref"), str)):
            raise ValueError("candidate_pool generation request %d lacks a typed target profile"
                             % index)
        for field in ("drive_strengths", "vt_classes"):
            values = implementation.get(field)
            if not isinstance(values, list) or not values or any(
                    not isinstance(value, str) or not value for value in values):
                raise ValueError("candidate_pool generation request %d has invalid %s"
                                 % (index, field))
            implementation[field] = sorted(set(values))
        if implementation["drive_strengths"] != ["D1", "D2", "D4", "D6", "D8"]:
            raise ValueError("candidate_pool generation request %d lacks the full drive family"
                             % index)
        plan = request.get("implementation_plan") or {}
        route = plan.get("route")
        if route not in BUILDABLE_ROUTES:
            raise ValueError("candidate_pool generation request %d has no buildable route" % index)
        influence = request.get("influence_vector") or (
            (request.get("discovery_evidence") or {}).get("influence_vector") or {})
        structural = influence.get("structural_metrics") or {}
        vector = {
            "levels_removed": structural.get("levels_removed"),
            "nodes_removed": structural.get("nodes_removed"),
            "edges_removed": structural.get("edges_removed"),
            "cut_width": structural.get("cut_width"),
            "reconvergence_coverage": structural.get("reconvergence_coverage"),
            "dominator_endpoint_coverage": influence.get("dominator_endpoint_coverage"),
            "repeat_support": influence.get("repeat_support"),
            "non_overlapping_support": influence.get("non_overlapping_support"),
            "overlap_ratio": influence.get("overlap_ratio"),
            "path_family_count": influence.get("path_family_count"),
        }
        for name, value in vector.items():
            if value is not None:
                _finite_metric(value, "candidate_pool.F1.%s" % name)
        key_material = {
            "equivalence": equivalence,
            "interface": interface,
            "target_library_profile": target_profile,
            "implementation_request": implementation,
            "build_route": route,
            "F1": vector,
        }
        proposal_key = "proposal:" + _sha(_canonical_json(key_material))
        if proposal_key in registry:
            raise ValueError("candidate_pool contains duplicate deterministic proposal identity")
        registry[proposal_key] = json.loads(json.dumps(request))
        compact.append({
            "schema": "hima.lfr-research-candidate/1",
            "proposal_key": proposal_key,
            "equivalence": {
                "digest": equivalence.get("digest"),
                "input_order": equivalence.get("input_order"),
                "output_order": equivalence.get("output_order"),
                "output_truth_tables_hex": equivalence.get("output_truth_tables_hex"),
            },
            "function": {
                "outputs": [
                    {"name": row.get("name"), "liberty_function": row.get("liberty_function")}
                    for row in interface.get("outputs", []) if isinstance(row, dict)
                ],
            },
            "interface": interface,
            "target_library_profile": target_profile,
            "implementation_request": implementation,
            "build_route": route,
            "F1": vector,
            "evidence_source_sha256": source_sha256,
        })
    return {"source_sha256": source_sha256, "count": len(compact),
            "proposal_schema": "hima.lfr-research-candidate/1",
            "proposals": compact}, registry


def _compact_commercial_response(document):
    """Validate the exact typed feedback surface exposed to candidate programs."""
    if (not isinstance(document, dict)
            or document.get("schema") != "hima.lfr-v5-commercial-frontier-response/1"
            or document.get("status") != "observed"):
        raise ValueError("commercial response is not one observed V5 frontier response")
    numeric = ("q_target_ns", "reference_active_count", "generated_active_count",
               "improved_endpoint_count", "worsened_endpoint_count",
               "violations_fixed", "new_violations")
    for name in numeric:
        value = document.get(name)
        if name.endswith("_ns"):
            _finite_metric(value, "commercial_response." + name)
        elif isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("commercial response %s must be a non-negative integer" % name)

    def endpoint_names(name, limit):
        rows = document.get(name)
        if (not isinstance(rows, list) or len(rows) > 4096
                or any(not isinstance(value, str) or not value for value in rows)):
            raise ValueError("commercial response %s is not a typed endpoint array" % name)
        return rows[:limit]

    def endpoint_rows(name, limit):
        rows = document.get(name)
        fields = {"endpoint", "reference_slack_ns", "generated_slack_ns",
                  "delta_slack_ns", "reference_q_ns", "generated_q_ns"}
        if not isinstance(rows, list) or len(rows) > 4096:
            raise ValueError("commercial response %s is not an array" % name)
        result = []
        for index, row in enumerate(rows[:limit]):
            if not isinstance(row, dict) or set(row) != fields or not isinstance(
                    row["endpoint"], str) or not row["endpoint"]:
                raise ValueError("commercial response %s[%d] is malformed" % (name, index))
            result.append({"endpoint": row["endpoint"], **{
                field: _finite_metric(row[field], "commercial_response.%s.%s" % (name, field))
                for field in sorted(fields - {"endpoint"})}})
        return result

    response_sha = document.get("response_sha256")
    if not isinstance(response_sha, str) or not SHA256.fullmatch(response_sha):
        raise ValueError("commercial response has no typed response_sha256")
    claim_limits = document.get("claim_limits")
    if not isinstance(claim_limits, dict):
        raise ValueError("commercial response claim_limits is not an object")
    return {
        "schema": "hima.lfr-commercial-feedback/1",
        "response_sha256": response_sha,
        **{name: document[name] for name in numeric},
        "resolved_reference_endpoints": endpoint_names("resolved_reference_endpoints", 128),
        "new_frontier_entrants": endpoint_names("new_frontier_entrants", 128),
        "remaining_frontier": endpoint_rows("remaining_frontier", 256),
        "largest_frontier_regressions": endpoint_rows("largest_frontier_regressions", 32),
        "largest_frontier_improvements": endpoint_rows("largest_frontier_improvements", 32),
        "claim_limits": claim_limits,
    }


def build_residual_research_context(
        request, *, evaluation, frontier, manifest, history_documents, evidence,
        candidate_pool=None, commercial_response=None):
    """Purely project verified documents into one compact FW-07 AI context."""
    if not isinstance(request, dict) or request.get("schema") != RESIDUAL_REQUEST_SCHEMA:
        raise ValueError("residual request schema is unsupported")
    required = {"schema", "round_id", "evaluation", "frontier", "manifest", "history",
                "budgets", "next_residual_question"}
    optional = {name for name in ("candidate_pool", "commercial_response") if name in request}
    if not required.issubset(request) or set(request) - required != optional:
        raise ValueError("residual request has unexpected or missing fields")
    round_id = request.get("round_id")
    question = request.get("next_residual_question")
    round_id = _bounded_text(round_id, "round_id", RESIDUAL_NAME_BYTES)
    question = _bounded_text(question, "next_residual_question")
    budgets = request.get("budgets")
    if not isinstance(budgets, dict) or set(budgets) != {
            "max_research_lenses", "max_candidate_proposals",
            "max_onsite_inspiration_proposals", "max_candidate_code_bytes"}:
        raise ValueError("residual budgets are incomplete")
    limits = {}
    for name, lower, upper in (
            ("max_research_lenses", 1, 12),
            ("max_candidate_proposals", 1, 50),
            ("max_onsite_inspiration_proposals", 1, 10),
            ("max_candidate_code_bytes", 256, 65536)):
        value = budgets.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or not lower <= value <= upper:
            raise ValueError("%s must be within %d..%d" % (name, lower, upper))
        limits[name] = value

    history_refs = request.get("history")
    if not isinstance(history_refs, list) or len(history_refs) > 50:
        raise ValueError("history must be an array of at most 50 rounds")
    evidence_keys = {"evaluation", "frontier", "manifest", "history"}
    if "candidate_pool" in request:
        evidence_keys.add("candidate_pool")
    if "commercial_response" in request:
        evidence_keys.add("commercial_response")
    if (not isinstance(evidence, dict) or set(evidence) != evidence_keys
            or not isinstance(history_documents, list)
            or len(history_documents) != len(history_refs)
            or not isinstance(evidence["history"], list)
            or len(evidence["history"]) != len(history_refs)):
        raise ValueError("verified residual evidence bindings are incomplete")
    for name in ("evaluation", "frontier", "manifest"):
        if (not isinstance(evidence[name], dict)
                or evidence[name].get("sha256") != request[name].get("sha256")):
            raise ValueError("verified %s binding differs from the request" % name)
    if "candidate_pool" in request and (
            not isinstance(evidence["candidate_pool"], dict)
            or evidence["candidate_pool"].get("sha256")
            != request["candidate_pool"].get("sha256")):
        raise ValueError("verified candidate_pool binding differs from the request")
    if "commercial_response" in request and (
            not isinstance(evidence["commercial_response"], dict)
            or evidence["commercial_response"].get("sha256")
            != request["commercial_response"].get("sha256")):
        raise ValueError("verified commercial_response binding differs from the request")
    if any(
            not isinstance(held, dict)
            or held.get("sha256") != reference.get("sha256")
            for held, reference in zip(evidence["history"], history_refs)):
        raise ValueError("verified history bindings differ from the request")
    history = []
    for index, (document, held) in enumerate(zip(history_documents, evidence["history"])):
        if not isinstance(document, dict):
            raise ValueError("history[%d] is not an object" % index)
        failures = document.get("failures") or []
        if (not isinstance(failures, list) or len(failures) > 50
                or any(not isinstance(value, str) or not value.strip()
                       or len(value.encode()) > RESIDUAL_TEXT_BYTES for value in failures)):
            raise ValueError("history[%d] failures must be compact non-empty strings" % index)
        stop_reason = document.get("stop_reason") or document.get("stopReason")
        if stop_reason is not None:
            stop_reason = _bounded_text(
                stop_reason, "history[%d] stop reason" % index)
        history.append({
            "round_id": _bounded_text(
                str(document.get("round_id") or document.get("id") or held["path"]),
                "history[%d] round_id" % index, RESIDUAL_NAME_BYTES),
            "sha256": held["sha256"],
            "status": document.get("status"),
            "stop_reason": stop_reason,
            "failures": [_bounded_text(value, "history failure") for value in failures],
        })
    allowed_hashes = {evidence["evaluation"]["sha256"]}
    allowed_hashes.update(row["sha256"] for row in history)
    for document in [evaluation, *history_documents]:
        payload = document.get("evaluation_payload_sha256")
        if isinstance(payload, str) and SHA256.fullmatch(payload):
            allowed_hashes.add(payload)
    if candidate_pool is None:
        compact_pool = {"source_sha256": None, "count": 0, "proposals": []}
    else:
        compact_pool, _registry = _compact_candidate_pool(
            candidate_pool, evidence["candidate_pool"]["sha256"])
    normalized_frontier = _normalize_frontier(
        frontier, allowed_hashes, candidate_pool_nonempty=compact_pool["count"] > 0)
    if normalized_frontier["next_residual_question"]["prompt"] != question:
        raise ValueError("residual request question differs from the verified frontier")
    compact_manifest = _compact_manifest(manifest)
    metric_vectors = _compact_metric_vectors(evaluation)
    frontier_layers = {
        layer for row in normalized_frontier["objectives"]
        for layer in [_metric_layer(row["metric"])] if layer is not None
    }
    metric_vectors["scenario_layers"] = metric_vectors["available_layers"]
    metric_vectors["available_layers"] = sorted(
        set(metric_vectors["available_layers"]) | frontier_layers
    )
    context_evidence = {"evaluation": evidence["evaluation"],
                        "frontier": evidence["frontier"],
                        "manifest": evidence["manifest"], "history": history}
    if "candidate_pool" in evidence:
        context_evidence["candidate_pool"] = evidence["candidate_pool"]
    compact_response = None
    if commercial_response is not None:
        compact_response = _compact_commercial_response(commercial_response)
        context_evidence["commercial_response"] = evidence["commercial_response"]
    context = {
        "schema": RESIDUAL_CONTEXT_SCHEMA,
        "round_id": round_id,
        "next_residual_question": question,
        "budgets": limits,
        "evidence": context_evidence,
        "metric_vectors": metric_vectors,
        "pairwise_relation": evaluation.get("pairwise_relation") or {},
        "portfolio_frontier": normalized_frontier,
        "cumulative_library": compact_manifest,
        "library_cost": normalized_frontier["library_cost"],
        "candidate_pool": compact_pool,
        "commercial_frontier_response": compact_response,
        "failures": compact_manifest["known_failures"] + [
            {"round_id": row["round_id"], "detail": failure}
            for row in history for failure in row["failures"]
        ],
        "agent_scope": {
            "may": ["propose_research_lenses", "author_bounded_candidate_code",
                    "respond_to_commercial_frontier"],
            "may_not": ["assign_candidate_identity", "alter_evidence", "alter_budget",
                        "write_judge_facts", "launch_commercial_eda"],
            "commercial_qor_prediction": False,
        },
    }
    payload = _canonical_json(context)
    if len(payload) > RESIDUAL_CONTEXT_BYTES:
        raise ValueError("residual AI context exceeds its byte limit")
    context["context_sha256"] = _sha(payload)
    return context


def load_residual_research_context(request, *, evidence_root):
    """Verify path/hash bindings, then call the pure context projector."""
    if not isinstance(request, dict):
        raise ValueError("residual request must be an object")
    history_refs = request.get("history")
    if not isinstance(history_refs, list) or len(history_refs) > 50:
        raise ValueError("history must be an array of at most 50 rounds")
    evaluation, evaluation_ref = _bound_json_reference(
        evidence_root, request.get("evaluation"), "evaluation")
    frontier, frontier_ref = _bound_json_reference(
        evidence_root, request.get("frontier"), "frontier")
    manifest, manifest_ref = _bound_json_reference(
        evidence_root, request.get("manifest"), "manifest")
    candidate_pool = None
    candidate_pool_ref = None
    if "candidate_pool" in request:
        candidate_pool, candidate_pool_ref = _bound_json_reference(
            evidence_root, request.get("candidate_pool"), "candidate_pool",
            RESIDUAL_CANDIDATE_POOL_BYTES)
    commercial_response = None
    commercial_response_ref = None
    if "commercial_response" in request:
        commercial_response, commercial_response_ref = _bound_json_reference(
            evidence_root, request.get("commercial_response"), "commercial_response",
            RESIDUAL_CONTEXT_BYTES)
    history_documents = []
    history_evidence = []
    for index, reference in enumerate(history_refs):
        document, held = _bound_json_reference(
            evidence_root, reference, "history[%d]" % index,
            RESIDUAL_DOCUMENT_BYTES)
        history_documents.append(document)
        history_evidence.append(held)
    bound_evidence = {"evaluation": evaluation_ref, "frontier": frontier_ref,
                      "manifest": manifest_ref, "history": history_evidence}
    if candidate_pool_ref is not None:
        bound_evidence["candidate_pool"] = candidate_pool_ref
    if commercial_response_ref is not None:
        bound_evidence["commercial_response"] = commercial_response_ref
    return build_residual_research_context(
        request, evaluation=evaluation, frontier=frontier, manifest=manifest,
        history_documents=history_documents, evidence=bound_evidence,
        candidate_pool=candidate_pool, commercial_response=commercial_response,
    )


def load_candidate_pool_registry(workspace):
    root = Path(workspace).resolve() / "flow" / "library-richness"
    request_path = root / "research-context.json"
    if not request_path.is_file() or request_path.is_symlink():
        raise ValueError("residual research-context.json is absent")
    if request_path.stat().st_size > RESIDUAL_CONTEXT_BYTES:
        raise ValueError("residual research-context.json exceeds its byte limit")
    request = json.loads(request_path.read_text())
    if "candidate_pool" not in request:
        return {}
    document, held = _bound_json_reference(
        root, request["candidate_pool"], "candidate_pool",
        RESIDUAL_CANDIDATE_POOL_BYTES)
    _compact, registry = _compact_candidate_pool(document, held["sha256"])
    return registry


def optional_residual_research_context(workspace):
    """Load the Phase-1 adapter when present; normal Campaigns remain legacy."""
    root = Path(workspace).resolve() / "flow" / "library-richness"
    request_path = root / "research-context.json"
    if not request_path.exists():
        return None
    if request_path.is_symlink() or not request_path.is_file():
        raise ValueError("residual research-context.json is not a regular file")
    if request_path.stat().st_size > RESIDUAL_CONTEXT_BYTES:
        raise ValueError("residual research-context.json exceeds its byte limit")
    request = json.loads(request_path.read_text())
    return load_residual_research_context(request, evidence_root=root)


def _range_bound(call, literal_lengths):
    if (not isinstance(call, ast.Call) or not isinstance(call.func, ast.Name)
            or call.func.id != "range" or call.keywords or not 1 <= len(call.args) <= 3):
        return None

    def integer(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "len" and len(node.args) == 1 and not node.keywords
                and isinstance(node.args[0], ast.Name)):
            return literal_lengths.get(node.args[0].id)
        return None

    values = [integer(argument) for argument in call.args]
    if any(value is None for value in values):
        return None
    start, stop, step = ((0, values[0], 1) if len(values) == 1
                         else (values[0], values[1], 1) if len(values) == 2
                         else values)
    if step == 0:
        return None
    return len(range(start, stop, step))


def _validate_candidate_ast(tree):
    forbidden = (ast.Import, ast.ImportFrom, ast.With, ast.AsyncWith, ast.ClassDef,
                 ast.AsyncFunctionDef, ast.Global, ast.Nonlocal, ast.While,
                 ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp,
                 ast.Lambda, ast.Yield, ast.YieldFrom, ast.Await, ast.NamedExpr,
                 ast.JoinedStr, ast.FormattedValue)
    rejected = next((node for node in ast.walk(tree) if isinstance(node, forbidden)), None)
    if rejected is not None:
        raise ValueError("candidate_program forbids %s at line %s; use the documented bounded pure-Python subset (single function)" %
                         (type(rejected).__name__, getattr(rejected, "lineno", "?")))
    functions = [node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
    if len(functions) != 1:
        raise ValueError("candidate_program cannot define nested helper functions")
    function = functions[0]
    literal_lengths = {}

    def pool_projection(node):
        return (
            isinstance(node, ast.Subscript)
            and isinstance(node.slice, ast.Constant) and node.slice.value == "proposals"
            and isinstance(node.value, ast.Subscript)
            and isinstance(node.value.slice, ast.Constant)
            and node.value.slice.value == "candidate_pool"
            and isinstance(node.value.value, ast.Name)
            and node.value.value.id == "residual"
        )

    for statement in function.body:
        if (isinstance(statement, ast.Assign) and len(statement.targets) == 1
                and isinstance(statement.targets[0], ast.Name)
                and isinstance(statement.value, (ast.List, ast.Tuple, ast.Set))):
            literal_lengths[statement.targets[0].id] = len(statement.value.elts)
        elif (isinstance(statement, ast.Assign) and len(statement.targets) == 1
                and isinstance(statement.targets[0], ast.Name)
                and pool_projection(statement.value)):
            literal_lengths[statement.targets[0].id] = RESIDUAL_MAX_STATIC_ITERATIONS
    loop_bounds = []

    def inspect_loops(nodes, enclosing=1):
        for node in nodes:
            if isinstance(node, ast.For):
                bound = _range_bound(node.iter, literal_lengths)
                if (bound is None or bound < 0
                        or bound * enclosing > RESIDUAL_MAX_STATIC_ITERATIONS):
                    raise ValueError("candidate_program loop is not statically bounded")
                loop_bounds.append(bound)
                inspect_loops(node.body, max(1, bound * enclosing))
                inspect_loops(node.orelse, enclosing)
            else:
                inspect_loops(list(ast.iter_child_nodes(node)), enclosing)

    inspect_loops(function.body)
    if sum(loop_bounds) > RESIDUAL_MAX_STATIC_ITERATIONS * 4:
        raise ValueError("candidate_program aggregate static loop budget exceeds %d" %
                         (RESIDUAL_MAX_STATIC_ITERATIONS * 4))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "range":
            bound = _range_bound(node, literal_lengths)
            if bound is None or bound > RESIDUAL_MAX_STATIC_ITERATIONS:
                raise ValueError("candidate_program range is not statically bounded")
        if isinstance(node, ast.Constant) and isinstance(node.value, int) and not isinstance(node.value, bool):
            if abs(node.value).bit_length() > 64:
                raise ValueError("candidate_program contains an oversized integer literal")
        if isinstance(node, ast.Constant) and isinstance(node.value, (str, bytes)):
            if len(node.value) > 4096:
                raise ValueError("candidate_program contains an oversized literal")
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)) and len(node.elts) > 128:
            raise ValueError("candidate_program contains an oversized sequence literal")
        if isinstance(node, ast.Dict) and len(node.keys) > 128:
            raise ValueError("candidate_program contains an oversized object literal")
        if isinstance(node, ast.BinOp):
            if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod)):
                raise ValueError("candidate_program uses a nonessential binary operator")
            right = node.right.value if isinstance(node.right, ast.Constant) else None
            if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)) and right == 0:
                raise ValueError("candidate_program arithmetic divides by zero")
            if isinstance(node.op, ast.Mult):
                for value, count in ((node.left, node.right), (node.right, node.left)):
                    oversized = isinstance(count, ast.Constant) and isinstance(count.value, int) and count.value > 4096
                    if oversized and (isinstance(value, (ast.List, ast.Tuple, ast.Set))
                            or isinstance(value, ast.Constant) and isinstance(value.value, (str, bytes))):
                        raise ValueError("candidate_program contains static memory amplification")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            if (not isinstance(node.operand, ast.Constant)
                    or not isinstance(node.operand.value, (int, float))
                    or isinstance(node.operand.value, bool)):
                raise ValueError("candidate_program unary arithmetic must use a numeric literal")
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Invert):
            raise ValueError("candidate_program bitwise inversion is not allowed")


def _validate_candidate_program(program, byte_budget):
    if (not isinstance(program, dict)
            or set(program) not in ({"language", "entrypoint", "source"},
                                    {"language", "entrypoint", "source", "sha256"})):
        raise ValueError("candidate_program must contain language, entrypoint, source and optional sha256")
    if program["language"] != "python" or program["entrypoint"] != "propose_candidates":
        raise ValueError("candidate_program must be Python propose_candidates")
    source = program["source"]
    if not isinstance(source, str) or not source.strip() or len(source.encode()) > byte_budget:
        raise ValueError("candidate_program source is empty or exceeds its byte budget")
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        raise ValueError("candidate_program is not valid Python") from error
    _validate_candidate_ast(tree)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    if (len(tree.body) != 1 or len(functions) != 1
            or functions[0].name != "propose_candidates"
            or [argument.arg for argument in functions[0].args.args] != ["residual", "budget"]
            or functions[0].args.vararg is not None or functions[0].args.kwarg is not None):
        raise ValueError("candidate_program must define exactly propose_candidates")
    blocked_names = {"open", "exec", "eval", "compile", "__import__", "system", "popen", "spawn"}
    allowed_calls = {
        "abs", "all", "any", "bool", "dict", "enumerate", "float", "int",
        "isinstance", "len", "list", "max", "min", "range", "reversed",
        "round", "set", "sorted", "str", "sum", "tuple", "zip",
    }
    # Candidate and commercial feedback documents are typed.  ``dict.get`` is
    # intentionally absent: trial.13 showed that misspelled feedback fields
    # otherwise become silent zeroes and make a non-adaptive program look valid.
    allowed_methods = {"append", "items", "keys", "values"}
    if (any(isinstance(node, ast.Name) and node.id in blocked_names for node in ast.walk(tree))
            or any(isinstance(node, ast.Attribute) and node.attr in blocked_names
                   for node in ast.walk(tree))
            or any(isinstance(node, ast.Attribute) and node.attr.startswith("_")
                   for node in ast.walk(tree))
            or any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                   and node.func.id == "propose_candidates" for node in ast.walk(tree))
            or any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                   and node.func.id not in allowed_calls for node in ast.walk(tree))
            or any(isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                   and node.func.attr not in allowed_methods for node in ast.walk(tree))
            or any(isinstance(node, ast.Call)
                   and not isinstance(node.func, (ast.Name, ast.Attribute))
                   for node in ast.walk(tree))):
        raise ValueError("candidate_program cannot perform file, process or dynamic-code I/O")
    digest = _sha(source.encode())
    if "sha256" in program and program["sha256"] != digest:
        raise ValueError("candidate_program sha256 differs from its source")
    return {"language": "python", "entrypoint": "propose_candidates", "source": source,
            "sha256": digest}


def _validate_candidate_value(value, *, path="transformation", depth=0):
    if depth > 8:
        raise ValueError("candidate proposal JSON exceeds maximum nesting depth")
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("%s contains a non-finite number" % path)
        return value
    if isinstance(value, str):
        if len(value.encode()) > 4096:
            raise ValueError("%s contains an oversized string" % path)
        return value
    if isinstance(value, list):
        if len(value) > 128:
            raise ValueError("%s contains an oversized array" % path)
        return [_validate_candidate_value(item, path="%s[]" % path, depth=depth + 1)
                for item in value]
    if isinstance(value, dict):
        if len(value) > 128:
            raise ValueError("%s contains an oversized object" % path)
        forbidden = {
            "candidate_id", "function_key", "identity", "sha256", "evidence",
            "judge", "command", "argv", "tool", "commercial_eda",
        }
        normalized = {}
        for key in sorted(value):
            if (not isinstance(key, str) or not key or len(key.encode()) > 128
                    or key.lower() in forbidden or key.startswith("__")):
                raise ValueError("%s contains a runner-owned or invalid key" % path)
            normalized[key] = _validate_candidate_value(
                value[key], path="%s.%s" % (path, key), depth=depth + 1)
        return normalized
    raise ValueError("%s contains a non-JSON value" % path)


def _validate_candidate_proposals(value, *, budget, allowed_lenses):
    if not isinstance(value, list) or len(value) > budget:
        raise ValueError("candidate program must return a JSON array within proposal budget")
    proposals = []
    seen = set()
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise ValueError("candidate proposal %d has an invalid schema" % index)
        if set(item) == {"lens", "transformation", "rationale"}:
            lens = _canonical_lens_name(item["lens"], "candidate proposal lens")
            rationale = item["rationale"]
            transformation = item["transformation"]
            if lens not in allowed_lenses:
                raise ValueError("candidate proposal %d names an undeclared research lens" % index)
        elif set(item) == {"kind", "lens", "target_layers", "must_not_regress",
                           "structural_differentiator"}:
            lens = _canonical_lens_name(item["lens"], "candidate proposal lens")
            layers = item["target_layers"]
            guards = item["must_not_regress"]
            differentiator = item["structural_differentiator"]
            if (item["kind"] != "research_lens" or not isinstance(lens, str) or not lens
                    or not isinstance(layers, list) or not layers
                    or any(layer not in {"F0", "F1", "F2", "F3"} for layer in layers)
                    or not isinstance(guards, list)
                    or any(not isinstance(metric, str)
                           or _metric_layer(metric) not in {"F0", "F1", "F2", "F3"}
                           for metric in guards)
                    or not isinstance(differentiator, str) or not differentiator):
                raise ValueError("candidate proposal %d has an invalid research-lens projection" % index)
            transformation = {
                "target_metric_layers": sorted(set(layers)),
                "must_not_regress": sorted(set(guards)),
                "structural_differentiator": differentiator,
            }
            rationale = "AI-authored bounded research-lens proposal"
        else:
            raise ValueError("candidate proposal %d has an invalid schema" % index)
        if (not isinstance(rationale, str) or not rationale.strip()
                or len(rationale.encode()) > 4096
                or not isinstance(transformation, dict) or not transformation):
            raise ValueError("candidate proposal %d is not explanatory" % index)
        normalized = {
            "lens": lens,
            "transformation": _validate_candidate_value(
                transformation, path="candidate_proposals[%d].transformation" % index),
            "rationale": rationale.strip(),
        }
        key = _canonical_json(normalized)
        if key in seen:
            raise ValueError("candidate program returned a canonical duplicate proposal")
        seen.add(key)
        proposals.append(normalized)
    payload = _canonical_json(proposals)
    if len(payload) > RESIDUAL_OUTPUT_BYTES:
        raise ValueError("candidate proposal JSON exceeds the output byte limit")
    return proposals, payload


def execute_candidate_program(program, context, *, allowed_lenses, candidate_registry=None):
    """Execute the validated pure proposal function under deterministic limits."""
    if not isinstance(program, dict) or not SHA256.fullmatch(str(program.get("sha256") or "")):
        raise ValueError("candidate program must be validated before execution")
    input_payload = _canonical_json({
        "residual": context,
        "budget": context["budgets"],
    })
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="lfr-candidate-") as folder:
        root = Path(folder)
        program_path = root / "candidate.py"
        executor_path = root / "executor.py"
        stdout_path = root / "stdout.json"
        stderr_path = root / "stderr.txt"
        program_path.write_text(program["source"])
        executor_path.write_text(_RESIDUAL_EXECUTOR)
        environment = {
            "HOME": str(root),
            "LANG": "C",
            "LC_ALL": "C",
            "PATH": str(Path(sys.executable).parent),
            "PYTHONHASHSEED": "0",
        }
        try:
            with stdout_path.open("wb") as stdout, stderr_path.open("wb") as stderr:
                completed = subprocess.run(
                    [sys.executable, "-I", "-S", str(executor_path), str(program_path)],
                    input=input_payload, stdout=stdout, stderr=stderr,
                    cwd=root, env=environment, timeout=RESIDUAL_EXECUTION_TIMEOUT_SECONDS,
                    check=False, start_new_session=True,
                )
        except subprocess.TimeoutExpired as error:
            raise ValueError("candidate program exceeded the hard wall timeout") from error
        stdout_bytes = stdout_path.read_bytes()[:RESIDUAL_OUTPUT_BYTES + 1]
        stderr_bytes = stderr_path.read_bytes()[:RESIDUAL_STDERR_BYTES + 1]
    elapsed_ms = round((time.monotonic() - started) * 1000.0, 3)
    if completed.returncode != 0:
        raise ValueError("candidate program failed within its resource or runtime limits")
    if len(stdout_bytes) > RESIDUAL_OUTPUT_BYTES:
        raise ValueError("candidate program output exceeds the byte limit")
    if len(stderr_bytes) > RESIDUAL_STDERR_BYTES:
        raise ValueError("candidate program diagnostic output exceeds the byte limit")
    try:
        envelope = json.loads(stdout_bytes)
    except json.JSONDecodeError as error:
        raise ValueError("candidate program output is not JSON") from error
    if (not isinstance(envelope, dict) or set(envelope) != {"proposals", "posix_limits"}
            or not isinstance(envelope["posix_limits"], dict)):
        raise ValueError("candidate executor envelope is malformed")
    proposals, payload = _validate_candidate_proposals(
        envelope["proposals"], budget=context["budgets"]["max_candidate_proposals"],
        allowed_lenses=set(allowed_lenses),
    )
    onsite_count = sum(row["lens"] == ONSITE_INSPIRATION_LENS for row in proposals)
    if onsite_count > context["budgets"]["max_onsite_inspiration_proposals"]:
        raise ValueError("onsite-inspiration proposals exceed their deterministic budget")
    candidate_registry = candidate_registry or {}
    selected_keys = set()
    attached = []
    for index, proposal in enumerate(proposals):
        transformation = proposal["transformation"]
        proposal_key = transformation.get("proposal_key")
        if candidate_registry and not isinstance(proposal_key, str):
            raise ValueError("candidate proposal %d must select one proposal_key" % index)
        if proposal_key is None:
            attached.append(proposal)
            continue
        if proposal_key not in candidate_registry:
            raise ValueError("candidate proposal %d selects an unknown proposal_key" % index)
        if proposal_key in selected_keys:
            raise ValueError("candidate program selects one proposal_key more than once")
        required_delay = transformation.get("required_delay_ns")
        endpoints = transformation.get("target_endpoints")
        intervention = transformation.get("intervention")
        if (isinstance(required_delay, bool)
                or not isinstance(required_delay, (int, float))
                or not math.isfinite(float(required_delay)) or required_delay <= 0):
            raise ValueError("candidate proposal %d has no positive required_delay_ns" % index)
        if (not isinstance(endpoints, list) or not endpoints
                or any(not isinstance(value, str) or not value for value in endpoints)):
            raise ValueError("candidate proposal %d has invalid target_endpoints" % index)
        if intervention not in {"new-function", "sizing", "stack-optimization",
                                "alternative-topology", "physical-fusion"}:
            raise ValueError("candidate proposal %d has invalid Cell Demand intervention" % index)
        selected_keys.add(proposal_key)
        generation_request = json.loads(json.dumps(candidate_registry[proposal_key]))
        contract = generation_request["generator_contract"]
        cell_demand = {
            "schema": "hima.cell-demand/1",
            "demand_id": "DEMAND_" + proposal_key.split(":", 1)[-1][:24].upper(),
            "proposal_key": proposal_key,
            "input_pins": [row["name"] for row in contract["interface"]["inputs"]],
            "output_pins": [row["name"] for row in contract["interface"]["outputs"]],
            "functions": {row["name"]: row["liberty_function"]
                          for row in contract["interface"]["outputs"]},
            "truth_table": contract["truth_table"],
            "required_delay_ns": float(required_delay),
            "target_endpoints": list(endpoints),
            "intervention": intervention,
            "drive_family": ["D1", "D2", "D4", "D6", "D8"],
        }
        attached.append({
            **proposal,
            "cell_demand": cell_demand,
            "generation_request_sha256": _sha(_canonical_json(generation_request)),
            "generation_request": generation_request,
        })
    proposals = attached
    provenance = {
        "program_sha256": program["sha256"],
        "input_sha256": _sha(input_payload),
        "output_sha256": _sha(payload),
        "proposal_count": len(proposals),
        "return_code": completed.returncode,
        "wall_time_ms": elapsed_ms,
        "isolation": {
            "python_flags": ["-I", "-S"],
            "minimal_environment_keys": sorted(environment),
            "temporary_working_directory": True,
        },
        "limits": {
            "wall_seconds": RESIDUAL_EXECUTION_TIMEOUT_SECONDS,
            "cpu_seconds": RESIDUAL_CPU_SECONDS,
            "memory_bytes": RESIDUAL_MEMORY_BYTES,
            "file_bytes": RESIDUAL_FILE_BYTES,
            "output_bytes": RESIDUAL_OUTPUT_BYTES,
            "posix_applied": envelope["posix_limits"],
        },
    }
    return proposals, provenance


def residual_evidence_sha256(context):
    """Exact residual-evidence identities that a research lens may cite."""
    evidence = context.get("evidence", {}) if isinstance(context, dict) else {}
    if not isinstance(evidence, dict):
        return []
    direct = [row.get("sha256") for key, row in evidence.items()
              if key != "history" and isinstance(row, dict)]
    history = evidence.get("history", [])
    historical = [row.get("sha256") for row in history if isinstance(row, dict)] \
        if isinstance(history, list) else []
    return sorted({value for value in direct + historical
                   if isinstance(value, str) and value})


def validate_residual_research_proposal(proposal, context):
    """Validate model creativity while retaining deterministic ownership."""
    if not isinstance(proposal, dict) or set(proposal) != {
            "research_lenses", "candidate_program", "feedback_interpretation", "stop_reason"}:
        raise ValueError(
            "residual research must return lenses, candidate_program, feedback_interpretation and stop_reason")
    lenses = proposal["research_lenses"]
    maximum = context["budgets"]["max_research_lenses"]
    if not isinstance(lenses, list) or not 1 <= len(lenses) <= maximum:
        raise ValueError("research_lenses exceeds its deterministic budget")
    source_hashes = set(residual_evidence_sha256(context))
    normalized = []
    names = set()
    for index, lens in enumerate(lenses):
        required = {"name", "question", "evidence_sha256", "target_metric_layers"}
        if not isinstance(lens, dict) or set(lens) != required:
            raise ValueError("research lens %d is malformed" % index)
        name = _canonical_lens_name(lens["name"], "research lens name")
        question = _bounded_text(lens["question"], "research lens question")
        evidence = lens["evidence_sha256"]
        layers = lens["target_metric_layers"]
        if name in names:
            raise ValueError("research lens %d repeats canonical name %s" % (index, name))
        if not isinstance(evidence, list) or not evidence:
            raise ValueError("research lens %d needs evidence_sha256 from residual_evidence_sha256(context)" % index)
        unknown = [value for value in evidence if value not in source_hashes]
        if unknown:
            raise ValueError("research lens %d cites evidence_sha256 outside the residual context; use residual_evidence_sha256(context): %s" % (index, ", ".join(map(str, unknown[:3]))))
        if (not isinstance(layers, list) or not layers
                or any(value not in {"F0", "F1", "F2", "F3"} for value in layers)):
            raise ValueError("research lens %d target_metric_layers must be a non-empty subset of F0, F1, F2 and F3" % index)
        names.add(name)
        normalized.append({
            "name": name, "question": question,
            "evidence_sha256": sorted(set(evidence)),
            "target_metric_layers": sorted(set(layers)),
        })
    if ONSITE_INSPIRATION_LENS not in names:
        raise ValueError("research_lenses must include the onsite-inspiration strategy")
    commercial = context.get("evidence", {}).get("commercial_response")
    if isinstance(commercial, dict):
        onsite = next(row for row in normalized if row["name"] == ONSITE_INSPIRATION_LENS)
        if commercial.get("sha256") not in onsite["evidence_sha256"]:
            raise ValueError("onsite-inspiration must cite the current commercial frontier response")
    stop = _bounded_text(proposal["stop_reason"], "stop_reason")
    feedback_interpretation = _bounded_text(
        proposal["feedback_interpretation"], "feedback_interpretation")
    program = _validate_candidate_program(
        proposal["candidate_program"], context["budgets"]["max_candidate_code_bytes"])
    return {"research_lenses": normalized, "candidate_program": program,
            "feedback_interpretation": feedback_interpretation, "stop_reason": stop}


def run_residual_research(research, workspace, output):
    """Run one standalone FW-07 AI turn and its isolated proposal program."""
    context = optional_residual_research_context(workspace)
    if context is None:
        raise ValueError("flow/library-richness/research-context.json is absent")
    proposal = validate_residual_research_proposal(research(context), context)
    candidate_registry = load_candidate_pool_registry(workspace)
    candidate_proposals, candidate_execution = execute_candidate_program(
        proposal["candidate_program"], context,
        allowed_lenses=[row["name"] for row in proposal["research_lenses"]],
        candidate_registry=candidate_registry,
    )
    feedback_ab = {"performed": False, "selection_changed": None,
                   "without_feedback_proposal_keys": [],
                   "with_feedback_proposal_keys": [],
                   "interpretation": proposal["feedback_interpretation"]}
    if context.get("commercial_frontier_response") is not None:
        neutral = json.loads(json.dumps(context))
        neutral["commercial_frontier_response"] = None
        without, without_execution = execute_candidate_program(
            proposal["candidate_program"], neutral,
            allowed_lenses=[row["name"] for row in proposal["research_lenses"]],
            candidate_registry=candidate_registry,
        )
        before = [row["transformation"]["proposal_key"] for row in without]
        after = [row["transformation"]["proposal_key"] for row in candidate_proposals]
        feedback_ab = {"performed": True, "selection_changed": before != after,
                       "without_feedback_proposal_keys": before,
                       "with_feedback_proposal_keys": after,
                       "without_feedback_execution": without_execution,
                       "interpretation": proposal["feedback_interpretation"]}
    document = {
        "schema": RESIDUAL_OUTPUT_SCHEMA,
        "status": "proposed",
        "round_id": context["round_id"],
        "context_sha256": context["context_sha256"],
        "evidence": context["evidence"],
        "next_residual_question": context["next_residual_question"],
        "budgets": context["budgets"],
        "research_lenses": proposal["research_lenses"],
        "candidate_program": proposal["candidate_program"],
        "candidate_proposals": candidate_proposals,
        "candidate_execution": candidate_execution,
        "feedback_ab": feedback_ab,
        "stop_reason": proposal["stop_reason"],
        "claims": {
            "commercial_qor_prediction": False,
            "commercial_eda_executed": False,
            "candidate_identity_assigned": False,
        },
    }
    document["output_sha256"] = _sha(_canonical_json(document))
    payload = _canonical_json(document)
    if len(payload) > RESIDUAL_DOCUMENT_BYTES:
        raise ValueError("residual research document exceeds its byte limit")
    destination = Path(output).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(payload)
    return document


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
            normalized_groups = {b"reg2reg" if group in {b"reg2reg", b"flop2flop"} else group
                                 for group in groups}
            if not groups or normalized_groups != {b"reg2reg"} or not slacks:
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
