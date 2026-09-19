#!/usr/bin/env python3
"""Fixed FW-07 replay tests for the compact AI residual context."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


FLOW = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FLOW))

from ai_research_runner import (  # noqa: E402
    BUILDABLE_ROUTES,
    RESIDUAL_CONTEXT_SCHEMA,
    RESIDUAL_OUTPUT_SCHEMA,
    build_residual_research_context,
    execute_candidate_program,
    load_residual_research_context,
    load_candidate_pool_registry,
    optional_residual_research_context,
    run_residual_research,
    validate_residual_research_proposal,
)
from mine_timing_route import _route_requests, rank_critical_subgraph  # noqa: E402
from verilog_netlist import Instance  # noqa: E402


def _write_json(root: Path, name: str, document: dict) -> dict[str, str]:
    payload = (json.dumps(document, indent=2, sort_keys=True) + "\n").encode()
    (root / name).write_bytes(payload)
    return {"path": name, "sha256": hashlib.sha256(payload).hexdigest()}


def _candidate_pool():
    cell = SimpleNamespace(
        is_seq=False, inputs=("A", "B"),
        outputs={"Y": ("and", ("var", "A"), ("var", "B"))},
    )
    instance = Instance("top", "AND", "U0", {"A": "a", "B": "b", "Y": "y"})
    critical = rank_critical_subgraph("top", [instance], {"AND": cell}, {"AND": 2.0})
    arguments = SimpleNamespace(
        max_inputs=4, max_cuts_per_root=32, max_critical_roots=24,
        max_outputs=4, objective="critical_context_pareto", top=10,
        strategy_id="residual_pool", process_family="test_process",
        cell_architecture_ref="test_architecture",
        characterization_profile_ref="test_characterization",
        drive_strength=["X1"], vt_class=["SVT"], model_type=["NLDM"],
    )
    requests, _statistics = _route_requests(
        {"top": [instance]}, {"AND": cell}, [critical], {}, {}, {"AND": 2.0}, arguments
    )
    request = next(row for row in requests if row["implementation_plan"]["route"] in {
        "fusion", "cluster_compose", "boolean_synthesis"})
    return {
        "report_schema": "xspace_cell-pattern-search/v2",
        "generation_requests": [request],
    }


def _evaluation() -> dict:
    comparisons = [
        {
            "metric": "F0.candidate_adoption_fraction", "direction": "maximize",
            "reference": 0.0, "augmented": 0.5, "relation": "improved",
        },
        {
            "metric": "F2.max_logic_level", "direction": "minimize",
            "reference": 12.0, "augmented": 10.0, "relation": "improved",
        },
        {
            "metric": "F3.negative_slack_mass_indicator_ps", "direction": "minimize",
            "reference": 45.0, "augmented": 39.0, "relation": "improved",
        },
    ]
    scenarios = {}
    for name in ("optimistic", "nominal", "conservative"):
        scenarios[name] = {
            "status": "succeeded",
            "pairwise_relation": {
                "relation": "augmented-dominates", "comparisons": copy.deepcopy(comparisons),
            },
            "path_migration": {
                "path_families_added": ["launch1->capture1"],
                "path_families_removed": ["launch0->capture0"],
            },
        }
    document = {
        "schema": "lfr-round-evaluation/3",
        "status": "succeeded",
        "claim_limits": {
            "fmax_claimed": False,
            "commercial_adoption_claimed": False,
            "physical_benefit_claimed": False,
            "expected_qor_claimed": False,
            "commercial_eda_executed": False,
        },
        "scenarios": scenarios,
        "pairwise_relation": {
            "relation": "augmented-dominates",
            "by_scenario": {name: "augmented-dominates" for name in scenarios},
        },
    }
    document["evaluation_payload_sha256"] = hashlib.sha256(
        (json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode()
    ).hexdigest()
    return document


def _baseline_evaluation() -> dict:
    scenarios = {}
    for name in ("optimistic", "nominal", "conservative"):
        metrics = {
            "F0": {"candidate_cells_declared": 0, "candidate_cells_adopted": 0},
            "F1": {},
            "F2": {"mapped_instance_count": 121, "max_logic_level": 11},
            "F3": {
                "indicator_only": True,
                "worst_delay_indicator_ps": 438.0,
                "worst_slack_indicator_ps": -38.0,
                "negative_slack_mass_indicator_ps": 71.0,
                "path_family_coverage": 3,
            },
        }
        scenarios[name] = {
            "status": "succeeded",
            "reference": metrics,
            "augmented": copy.deepcopy(metrics),
            "pairwise_relation": {"relation": "equal", "comparisons": []},
            "path_migration": {
                "path_families_added": [], "path_families_removed": [],
                "path_families_retained": ["launch->capture"],
            },
        }
    document = {
        "schema": "lfr-baseline-evaluation/1", "status": "succeeded",
        "claim_limits": {
            "commercial_qor_predicted": False, "fmax_predicted": False,
            "commercial_eda_executed": False,
        },
        "scenarios": scenarios,
        "pairwise_relation": {"relation": "equal", "comparisons": []},
    }
    document["evaluation_payload_sha256"] = hashlib.sha256(
        (json.dumps(document, sort_keys=True, separators=(",", ":")) + "\n").encode()
    ).hexdigest()
    return document


def _manifest() -> dict:
    function_key = "sha256:" + "1" * 64
    return {
        "schema": "custom-cell-cumulative-library/1",
        "baselineReference": {"sha256": "2" * 64, "bytes": 42, "source": "baseline.lib"},
        "shards": [{
            "id": "0001", "manifestSha256": "3" * 64,
            "functionKeys": [function_key],
        }],
        "functions": [{
            "functionKey": function_key,
            "candidateId": "CAND_REJECTED_0001",
            "shardId": "0001",
            "state": "proxy-rejected",
            "stateHistory": ["discovered", "proxy-rejected"],
            "knownFailures": ["not adopted by augmented open-source mapping"],
            "identity": {
                "outputPins": [{"name": "Y", "liberty_function": "A"}],
            },
            "physicalCellNames": ["XS_REJECTED_0001_Y"],
        }],
    }


def _request(root: Path) -> dict:
    evaluation_ref = _write_json(root, "evaluation.json", _evaluation())
    history_ref = _write_json(root, "round-0001.json", {
        "round_id": "round-0001", "status": "screened",
        "failures": ["F1 reconvergence coverage unchanged"],
        "stop_reason": "residual structure remains",
    })
    frontier = {
        "schema": "producer-owned-frontier/7",
        "objectives": [
            {"metric": "F1.levels_removed", "direction": "maximize"},
            {"metric": "F2.mapped_instance_count", "direction": "minimize"},
            {"metric": "F3.negative_slack_mass_indicator_ps", "direction": "minimize"},
        ],
        "members": [
            {
                "id": "round-0001/portfolio-a", "round_id": "round-0001",
                "evaluation_sha256": history_ref["sha256"],
                "metric_vector": {
                    "F1.levels_removed": 1.0,
                    "F2.mapped_instance_count": 120.0,
                    "F3.negative_slack_mass_indicator_ps": 40.0,
                },
            },
            {
                "id": "round-0002/portfolio-b", "round_id": "round-0002",
                "evaluation_sha256": evaluation_ref["sha256"],
                "metric_vector": {
                    "F1.levels_removed": 2.0,
                    "F2.mapped_instance_count": 125.0,
                    "F3.negative_slack_mass_indicator_ps": 39.0,
                },
            },
        ],
        "frontier_member_ids": ["round-0001/portfolio-a", "round-0002/portfolio-b"],
        "library_cost": {"cumulative_cells": 17, "new_cells_this_round": 4},
        "next_residual_question": {
            "id": "reconvergent-cut",
            "prompt": "Which reconvergent cuts can reduce logic levels without regressing the F3 frontier?",
        },
    }
    return {
        "schema": "lfr-ai-residual-request/1",
        "round_id": "round-0002",
        "evaluation": evaluation_ref,
        "frontier": _write_json(root, "frontier.json", frontier),
        "manifest": _write_json(root, "cumulative-manifest.json", _manifest()),
        "history": [history_ref],
        "budgets": {
            "max_research_lenses": 4,
            "max_candidate_proposals": 8,
            "max_onsite_inspiration_proposals": 2,
            "max_candidate_code_bytes": 4096,
        },
        "next_residual_question": (
            "Which reconvergent cuts can reduce logic levels without regressing the F3 frontier?"
        ),
    }


def _proposal(context: dict) -> dict:
    onsite_evidence = [context["evidence"]["evaluation"]["sha256"]]
    if "commercial_response" in context["evidence"]:
        onsite_evidence.append(context["evidence"]["commercial_response"]["sha256"])
    return {
        "research_lenses": [
            {
                "name": "reconvergent-cut",
                "question": context["next_residual_question"],
                "evidence_sha256": [context["evidence"]["evaluation"]["sha256"]],
                "target_metric_layers": ["F1", "F2", "F3"],
            },
            {
                "name": "onsite-inspiration",
                "question": "Which evidence-backed local strategy is missing from the six fixed miners?",
                "evidence_sha256": onsite_evidence,
                "target_metric_layers": ["F1", "F2", "F3"],
            },
        ],
        "candidate_program": {
            "language": "python",
            "entrypoint": "propose_candidates",
            "source": (
                "def propose_candidates(residual, budget):\n"
                "    return residual.get('cuts', [])[:budget['max_candidate_proposals']]\n"
            ),
        },
        "stop_reason": "One bounded lens addresses the stated residual question.",
    }


class ResidualResearchContextTests(unittest.TestCase):
    def test_residual_context_admits_the_pack_multi_output_resynthesis_route(self):
        self.assertIn("multi_output_resynthesis", BUILDABLE_ROUTES)

    def test_commercial_frontier_response_is_hash_bound_and_visible_to_research(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            response = {
                "schema": "hima.lfr-v5-commercial-frontier-response/1",
                "status": "observed", "response_sha256": "a" * 64,
                "q_target_ns": 0.53, "reference_active_count": 3,
                "generated_active_count": 2,
                "resolved_reference_endpoints": ["E0"],
                "new_frontier_entrants": [],
                "remaining_frontier": [{"endpoint": "E1", "generated_q_ns": 0.55}],
                "largest_frontier_regressions": [{"endpoint": "E1", "delta_slack_ns": -0.01}],
                "largest_frontier_improvements": [{"endpoint": "E0", "delta_slack_ns": 0.02}],
                "improved_endpoint_count": 2, "worsened_endpoint_count": 1,
                "violations_fixed": 1, "new_violations": 0,
                "claim_limits": {"per_action_causality": False},
            }
            request["commercial_response"] = _write_json(
                root, "commercial-response.json", response)
            context = load_residual_research_context(request, evidence_root=root)
            self.assertEqual(2, context["commercial_frontier_response"]["generated_active_count"])
            self.assertEqual("E1", context["commercial_frontier_response"]["remaining_frontier"][0]["endpoint"])
            self.assertIn("commercial_response", context["evidence"])
            validated = validate_residual_research_proposal(_proposal(context), context)
            onsite = next(row for row in validated["research_lenses"]
                          if row["name"] == "onsite-inspiration")
            self.assertIn(context["evidence"]["commercial_response"]["sha256"],
                          onsite["evidence_sha256"])
            missing_citation = _proposal(context)
            missing_citation["research_lenses"][1]["evidence_sha256"] = [
                context["evidence"]["evaluation"]["sha256"]]
            with self.assertRaisesRegex(ValueError, "must cite the current commercial"):
                validate_residual_research_proposal(missing_citation, context)
            (root / "commercial-response.json").write_text("{}\n")
            with self.assertRaisesRegex(ValueError, "changed after"):
                load_residual_research_context(request, evidence_root=root)

    def test_cold_start_baseline_exposes_f0_f2_f3_without_qor_prediction(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            request["evaluation"] = _write_json(root, "baseline-evaluation.json", _baseline_evaluation())
            request["candidate_pool"] = _write_json(root, "candidate-pool.json", _candidate_pool())
            frontier = json.loads((root / request["frontier"]["path"]).read_text())
            frontier.update({
                "objectives": [], "members": [], "frontier_member_ids": [],
                "e0_library_validation_candidate": {
                    "value": False, "meaning": "no commercial observation before paired mapping",
                    "reasons": [],
                },
            })
            request["frontier"] = _write_json(root, "cold-frontier.json", frontier)

            context = load_residual_research_context(request, evidence_root=root)

            self.assertEqual(["F0", "F2", "F3"], context["metric_vectors"]["available_layers"])
            nominal = context["metric_vectors"]["scenarios"]["nominal"]
            self.assertTrue(all(row["relation"] == "equal" for row in nominal["metrics"]))
            self.assertFalse(context["agent_scope"]["commercial_qor_prediction"])
            self.assertEqual(1, context["candidate_pool"]["count"])

    def test_candidate_pool_identity_separates_drive_variants_and_rejects_exact_duplicate(self):
        pool = _candidate_pool()
        x1 = pool["generation_requests"][0]
        x2 = copy.deepcopy(x1)
        x2["candidate_id"] = x1["candidate_id"] + "_X2"
        x2["generator_contract"]["implementation_request"]["drive_strengths"] = ["X2"]
        pool["generation_requests"] = [x1, x2]
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            request["candidate_pool"] = _write_json(root, "candidate-pool.json", pool)

            context = load_residual_research_context(request, evidence_root=root)

            rows = context["candidate_pool"]["proposals"]
            self.assertEqual(2, len({row["proposal_key"] for row in rows}))
            self.assertEqual(
                [["X1"], ["X2"]],
                sorted(row["implementation_request"]["drive_strengths"] for row in rows),
            )
            self.assertTrue(all(row["target_library_profile"] for row in rows))

            duplicate = copy.deepcopy(pool)
            duplicate["generation_requests"] = [x1, copy.deepcopy(x1)]
            duplicate["generation_requests"][1]["candidate_id"] += "_DUPLICATE_NAME_ONLY"
            request["candidate_pool"] = _write_json(root, "candidate-pool.json", duplicate)
            with self.assertRaisesRegex(ValueError, "duplicate deterministic proposal identity"):
                load_residual_research_context(request, evidence_root=root)

    def test_verified_empty_frontier_with_nonempty_pool_is_a_cold_start(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            frontier = json.loads((root / request["frontier"]["path"]).read_text())
            frontier.update({
                "objectives": [], "members": [], "frontier_member_ids": [],
                "e0_library_validation_candidate": {
                    "value": False,
                    "meaning": "no adopted frontier member",
                    "reasons": [],
                    "blocking_reasons": ["no-eligible-frontier-member"],
                },
            })
            request["frontier"] = _write_json(root, "frontier.json", frontier)
            request["candidate_pool"] = _write_json(
                root, "candidate-pool.json", _candidate_pool())

            context = load_residual_research_context(request, evidence_root=root)

            self.assertEqual(
                "cold-start-no-adopted-frontier", context["portfolio_frontier"]["state"])
            self.assertEqual([], context["portfolio_frontier"]["frontier_member_ids"])
            self.assertEqual(1, context["candidate_pool"]["count"])

            partial = copy.deepcopy(frontier)
            partial["objectives"] = [{"metric": "F1.levels_removed", "direction": "maximize"}]
            request["frontier"] = _write_json(root, "frontier.json", partial)
            with self.assertRaisesRegex(ValueError, "requires empty objectives"):
                load_residual_research_context(request, evidence_root=root)

    def test_hash_bound_candidate_pool_compacts_without_exposing_candidate_id(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder)
            root = workspace / "flow" / "library-richness"
            root.mkdir(parents=True)
            request = _request(root)
            request["candidate_pool"] = _write_json(root, "candidate-pool.json", _candidate_pool())
            (root / "research-context.json").write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n")

            context = load_residual_research_context(request, evidence_root=root)
            registry = load_candidate_pool_registry(workspace)

        self.assertEqual(1, context["candidate_pool"]["count"])
        compact = context["candidate_pool"]["proposals"][0]
        self.assertRegex(compact["proposal_key"], r"^proposal:[0-9a-f]{64}$")
        self.assertNotIn("candidate_id", json.dumps(context["candidate_pool"]))
        self.assertEqual([compact["proposal_key"]], list(registry))

    def test_candidate_pool_tamper_unknown_key_and_duplicate_selection_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder)
            root = workspace / "flow" / "library-richness"
            root.mkdir(parents=True)
            request = _request(root)
            request["candidate_pool"] = _write_json(root, "candidate-pool.json", _candidate_pool())
            (root / "research-context.json").write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n")
            context = load_residual_research_context(request, evidence_root=root)
            registry = load_candidate_pool_registry(workspace)
            proposal_key = next(iter(registry))
            (root / "candidate-pool.json").write_text("{}\n")
            with self.assertRaisesRegex(ValueError, "changed after"):
                load_residual_research_context(request, evidence_root=root)

        def program_for(keys):
            rows = [
                {"lens": "reconvergent-cut",
                 "transformation": {"proposal_key": key, "variant": index},
                 "rationale": "select one immutable production candidate"}
                for index, key in enumerate(keys)
            ]
            return (
                "def propose_candidates(residual, budget):\n"
                "    return " + repr(rows) + "\n"
            )

        for keys, message in (
                (["proposal:" + "0" * 64], "unknown proposal_key"),
                ([proposal_key, proposal_key], "more than once")):
            proposal = _proposal(context)
            proposal["candidate_program"]["source"] = program_for(keys)
            validated = validate_residual_research_proposal(proposal, context)
            with self.assertRaisesRegex(ValueError, message):
                execute_candidate_program(
                    validated["candidate_program"], context,
                    allowed_lenses={"reconvergent-cut"}, candidate_registry=registry)

    def test_candidate_pool_selection_attaches_immutable_generation_request(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder)
            root = workspace / "flow" / "library-richness"
            root.mkdir(parents=True)
            request = _request(root)
            request["candidate_pool"] = _write_json(root, "candidate-pool.json", _candidate_pool())
            (root / "research-context.json").write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n")
            context = load_residual_research_context(request, evidence_root=root)
            registry = load_candidate_pool_registry(workspace)
        proposal_key = next(iter(registry))
        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return [{\"lens\": \"reconvergent-cut\",\n"
            "             \"transformation\": {\"proposal_key\": \"%s\"},\n"
            "             \"rationale\": \"select source-bound Boolean function\"}]\n"
            % proposal_key
        )
        validated = validate_residual_research_proposal(proposal, context)

        selected, _execution = execute_candidate_program(
            validated["candidate_program"], context,
            allowed_lenses={"reconvergent-cut"}, candidate_registry=registry)

        self.assertEqual(proposal_key, selected[0]["transformation"]["proposal_key"])
        self.assertIn("candidate_id", selected[0]["generation_request"])
        self.assertRegex(selected[0]["generation_request_sha256"], r"^[0-9a-f]{64}$")

    def test_pure_context_projection_matches_hash_bound_loader(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            loaded = load_residual_research_context(request, evidence_root=root)
            documents = {
                name: json.loads((root / request[name]["path"]).read_text())
                for name in ("evaluation", "frontier", "manifest")
            }
            history_documents = [
                json.loads((root / reference["path"]).read_text())
                for reference in request["history"]
            ]

            def held(reference):
                path = root / reference["path"]
                return {**reference, "bytes": path.stat().st_size}

            projected = build_residual_research_context(
                request,
                evaluation=documents["evaluation"],
                frontier=documents["frontier"],
                manifest=documents["manifest"],
                history_documents=history_documents,
                evidence={
                    "evaluation": held(request["evaluation"]),
                    "frontier": held(request["frontier"]),
                    "manifest": held(request["manifest"]),
                    "history": [held(reference) for reference in request["history"]],
                },
            )

        self.assertEqual(loaded, projected)

    def test_fixed_replay_exposes_indicators_frontier_cost_and_failures(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            context = load_residual_research_context(request, evidence_root=root)

        self.assertEqual(RESIDUAL_CONTEXT_SCHEMA, context["schema"])
        self.assertEqual(["F0", "F1", "F2", "F3"], context["metric_vectors"]["available_layers"])
        self.assertEqual(["F0", "F2", "F3"], context["metric_vectors"]["scenario_layers"])
        self.assertEqual(
            ["round-0001/portfolio-a", "round-0002/portfolio-b"],
            context["portfolio_frontier"]["frontier_member_ids"],
        )
        self.assertEqual(17, context["library_cost"]["cumulative_cells"])
        self.assertEqual("proxy-rejected", context["failures"][0]["state"])
        self.assertIn("reconvergent", context["next_residual_question"])
        serialized = json.dumps(context, sort_keys=True).lower()
        self.assertNotIn("target_gain", serialized)
        self.assertNotIn("predicted_gain", serialized)
        self.assertFalse(context["agent_scope"]["commercial_qor_prediction"])

    def test_tampered_evidence_and_false_frontier_fail_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            (root / "evaluation.json").write_text("{}\n")
            with self.assertRaisesRegex(ValueError, "changed after"):
                load_residual_research_context(request, evidence_root=root)

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            frontier = json.loads((root / "frontier.json").read_text())
            frontier["members"][1]["metric_vector"] = {
                "F1.levels_removed": 3.0,
                "F2.mapped_instance_count": 110.0,
                "F3.negative_slack_mass_indicator_ps": 30.0,
            }
            frontier["frontier_member_ids"] = [
                "round-0001/portfolio-a", "round-0002/portfolio-b"
            ]
            request["frontier"] = _write_json(root, "frontier.json", frontier)
            with self.assertRaisesRegex(ValueError, "not reproducible"):
                load_residual_research_context(request, evidence_root=root)

    def test_proposal_is_evidence_bound_and_candidate_code_is_pure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        result = validate_residual_research_proposal(_proposal(context), context)
        self.assertRegex(result["candidate_program"]["sha256"], r"^[0-9a-f]{64}$")
        replayed = _proposal(context)
        replayed["candidate_program"] = result["candidate_program"]
        self.assertEqual(
            result["candidate_program"],
            validate_residual_research_proposal(replayed, context)["candidate_program"],
        )
        replayed["candidate_program"]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "differs from its source"):
            validate_residual_research_proposal(replayed, context)

        unsafe = _proposal(context)
        unsafe["candidate_program"]["source"] = (
            "import subprocess\n"
            "def propose_candidates(residual, budget):\n"
            "    return subprocess.run(['dc_shell'])\n"
        )
        with self.assertRaisesRegex(ValueError, "bounded pure-Python subset"):
            validate_residual_research_proposal(unsafe, context)
        escape = _proposal(context)
        escape["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return ().__class__.__mro__[1].__subclasses__()\n"
        )
        with self.assertRaisesRegex(ValueError, "file, process or dynamic-code"):
            validate_residual_research_proposal(escape, context)

    def test_candidate_program_executes_to_bounded_identity_free_proposals(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return [{\"lens\": \"reconvergent-cut\",\n"
            "             \"transformation\": {\"cut_kind\": \"reconvergent\", \"max_inputs\": 4},\n"
            "             \"rationale\": residual[\"next_residual_question\"]}][:budget['max_candidate_proposals']]\n"
        )
        validated = validate_residual_research_proposal(proposal, context)

        candidates, execution = execute_candidate_program(
            validated["candidate_program"], context,
            allowed_lenses={"reconvergent-cut"},
        )

        self.assertEqual(1, len(candidates))
        self.assertNotIn("candidate_id", json.dumps(candidates))
        self.assertEqual(1, execution["proposal_count"])
        self.assertEqual(["-I", "-S"], execution["isolation"]["python_flags"])
        self.assertRegex(execution["output_sha256"], r"^[0-9a-f]{64}$")

    def test_candidate_program_timeout_is_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        program = validate_residual_research_proposal(_proposal(context), context)["candidate_program"]
        with patch("ai_research_runner.RESIDUAL_EXECUTION_TIMEOUT_SECONDS", 0.000001):
            with self.assertRaisesRegex(ValueError, "timeout|resource or runtime"):
                execute_candidate_program(program, context, allowed_lenses={"reconvergent-cut"})

    def test_static_memory_amplifiers_and_comprehensions_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        sources = (
            "def propose_candidates(residual, budget):\n    values = [0] * 1000000000\n    return []\n",
            "def propose_candidates(residual, budget):\n    value = 'x' * 1000000000\n    return []\n",
            "def propose_candidates(residual, budget):\n    return [x for x in range(4)]\n",
            "def propose_candidates(residual, budget):\n    return list(range(1000000000))\n",
            "def propose_candidates(residual, budget):\n    x = 'a'\n    return [f'{x}{x}']\n",
            "def propose_candidates(residual, budget):\n    return [1 << 8000000000]\n",
        )
        for source in sources:
            proposal = _proposal(context)
            proposal["candidate_program"]["source"] = source
            with self.assertRaisesRegex(
                    ValueError, "amplification|bounded|loop|operator|arithmetic|pure-Python"):
                validate_residual_research_proposal(proposal, context)

    def test_normal_ranking_arithmetic_and_three_sequential_bounded_passes_are_authorable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    pool = residual['candidate_pool']['proposals']\n"
            "    scores = [0.0] * 128\n"
            "    for index in range(128):\n"
            "        if index >= len(pool):\n"
            "            break\n"
            "        scores[index] = index * 8 + 1\n"
            "    total = 0.0\n"
            "    for index in range(128):\n"
            "        total = total + scores[index]\n"
            "    output = []\n"
            "    for index in range(1):\n"
            "        output.append({'lens': 'reconvergent-cut',\n"
            "                       'transformation': {'proposal_key': pool[0]['proposal_key']},\n"
            "                       'rationale': 'bounded ranking score ' + str(total)})\n"
            "    return output\n"
        )
        validated = validate_residual_research_proposal(proposal, context)
        self.assertRegex(validated["candidate_program"]["sha256"], r"^[0-9a-f]{64}$")

    def test_oversized_hash_bound_evidence_fails_before_json_read(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            payload = b"{" + b" " * (600 * 1024) + b"}\n"
            path = root / "oversized-evaluation.json"
            path.write_bytes(payload)
            request["evaluation"] = {
                "path": path.name,
                "sha256": hashlib.sha256(payload).hexdigest(),
            }
            with self.assertRaisesRegex(ValueError, "evidence file byte limit"):
                load_residual_research_context(request, evidence_root=root)

    def test_history_round_document_admits_up_to_the_document_byte_limit(self):
        # A real 50-Cell portfolio round can legitimately exceed the 512 KiB
        # RESIDUAL_CONTEXT_BYTES bound that other, smaller evidence kinds use;
        # history documents are written with RESIDUAL_DOCUMENT_BYTES (8 MiB,
        # see ai_research_runner.py's own comment above that constant) and
        # must be readable back at the same size on a later generation.
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            payload = json.dumps(
                {"round_id": "round-0001", "status": "screened",
                 "failures": ["F1 reconvergence coverage unchanged"],
                 "stop_reason": "residual structure remains"},
                sort_keys=True,
            ).encode()
            payload += b" " * (600 * 1024)
            path = root / "round-0000-large.json"
            path.write_bytes(payload)
            request["history"].insert(0, {
                "path": path.name,
                "sha256": hashlib.sha256(payload).hexdigest(),
            })

            context = load_residual_research_context(request, evidence_root=root)

        self.assertEqual(2, len(context["evidence"]["history"]))

    def test_large_candidate_pool_is_compacted_before_context_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            request = _request(root)
            payload = json.dumps(_candidate_pool(), sort_keys=True).encode()
            payload += b" " * (600 * 1024)
            path = root / "candidate-pool-large.json"
            path.write_bytes(payload)
            request["candidate_pool"] = {
                "path": path.name,
                "sha256": hashlib.sha256(payload).hexdigest(),
            }

            context = load_residual_research_context(request, evidence_root=root)

        self.assertEqual(1, context["candidate_pool"]["count"])
        self.assertLess(
            len(json.dumps(context, sort_keys=True).encode()),
            512 * 1024,
        )

    def test_candidate_program_malformed_output_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return {\"candidate_id\": \"MODEL_OWNED\"}\n"
        )
        program = validate_residual_research_proposal(proposal, context)["candidate_program"]
        with self.assertRaisesRegex(ValueError, "JSON array"):
            execute_candidate_program(program, context, allowed_lenses={"reconvergent-cut"})

    def test_onsite_inspiration_has_a_separate_bounded_share_of_the_common_portfolio(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return [\n"
            "      {'lens': 'onsite-inspiration', 'transformation': {'slot': 1}, 'rationale': 'one'},\n"
            "      {'lens': 'onsite-inspiration', 'transformation': {'slot': 2}, 'rationale': 'two'},\n"
            "      {'lens': 'onsite-inspiration', 'transformation': {'slot': 3}, 'rationale': 'three'}]\n"
        )
        program = validate_residual_research_proposal(proposal, context)["candidate_program"]
        with self.assertRaisesRegex(ValueError, "onsite-inspiration proposals exceed"):
            execute_candidate_program(
                program, context,
                allowed_lenses={"reconvergent-cut", "onsite-inspiration"})

    def test_normalized_duplicate_lenses_proposals_and_large_stop_are_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        duplicate_lenses = _proposal(context)
        duplicate_lenses["research_lenses"].append({
            **duplicate_lenses["research_lenses"][0],
            "name": "Reconvergent_Cut",
        })
        with self.assertRaisesRegex(ValueError, "repeats canonical name"):
            validate_residual_research_proposal(duplicate_lenses, context)

        missing_onsite = _proposal(context)
        missing_onsite["research_lenses"] = missing_onsite["research_lenses"][:1]
        with self.assertRaisesRegex(ValueError, "must include the onsite-inspiration"):
            validate_residual_research_proposal(missing_onsite, context)

        wrong_identity = _proposal(context)
        wrong_identity["research_lenses"][0]["evidence_sha256"] = ["0" * 64]
        with self.assertRaisesRegex(ValueError, r"outside the residual context.*residual_evidence_sha256"):
            validate_residual_research_proposal(wrong_identity, context)

        huge_stop = _proposal(context)
        huge_stop["stop_reason"] = "x" * (1024 * 1024)
        with self.assertRaisesRegex(ValueError, "text byte limit"):
            validate_residual_research_proposal(huge_stop, context)

        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return [{\"lens\": \"reconvergent-cut\",\n"
            "             \"transformation\": {\"kind\": \"cut\"},\n"
            "             \"rationale\": \"same\"},\n"
            "            {\"lens\": \"Reconvergent Cut\",\n"
            "             \"transformation\": {\"kind\": \"cut\"},\n"
            "             \"rationale\": \"same\"}]\n"
        )
        program = validate_residual_research_proposal(proposal, context)["candidate_program"]
        with self.assertRaisesRegex(ValueError, "canonical duplicate"):
            execute_candidate_program(program, context, allowed_lenses={"reconvergent-cut"})

    def test_candidate_execution_does_not_inherit_parent_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            context = load_residual_research_context(_request(root), evidence_root=root)
        proposal = _proposal(context)
        proposal["candidate_program"]["source"] = (
            "def propose_candidates(residual, budget):\n"
            "    return [{\"lens\": \"reconvergent-cut\",\n"
            "             \"transformation\": {\"question\": residual[\"next_residual_question\"]},\n"
            "             \"rationale\": \"bounded residual proposal\"}]\n"
        )
        program = validate_residual_research_proposal(proposal, context)["candidate_program"]
        prior = os.environ.get("LFR_TEST_SECRET")
        os.environ["LFR_TEST_SECRET"] = "must-not-cross-executor-boundary"
        try:
            candidates, execution = execute_candidate_program(
                program, context, allowed_lenses={"reconvergent-cut"})
        finally:
            if prior is None:
                del os.environ["LFR_TEST_SECRET"]
            else:
                os.environ["LFR_TEST_SECRET"] = prior
        serialized = json.dumps({"candidates": candidates, "execution": execution})
        self.assertNotIn("must-not-cross-executor-boundary", serialized)
        self.assertNotIn("LFR_TEST_SECRET", execution["isolation"]["minimal_environment_keys"])

    def test_standalone_mode_writes_proposal_without_executing_candidate_code(self):
        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder)
            root = workspace / "flow" / "library-richness"
            root.mkdir(parents=True)
            request = _request(root)
            (root / "research-context.json").write_text(
                json.dumps(request, indent=2, sort_keys=True) + "\n"
            )
            output = root / "research-output.json"
            observed = {}

            def research(context):
                observed.update(context)
                proposal = _proposal(context)
                proposal["candidate_program"]["source"] = (
                    "def propose_candidates(residual, budget):\n"
                    "    return [{\"lens\": \"reconvergent-cut\",\n"
                    "             \"transformation\": {\"cut_kind\": \"reconvergent\"},\n"
                    "             \"rationale\": \"advance the residual structure\"}][:budget['max_candidate_proposals']]\n"
                )
                return proposal

            document = run_residual_research(research, workspace, output)

            self.assertEqual(RESIDUAL_OUTPUT_SCHEMA, document["schema"])
            self.assertEqual("proposed", document["status"])
            self.assertTrue(output.is_file())
            self.assertEqual(observed["context_sha256"], document["context_sha256"])
            self.assertFalse(document["claims"]["commercial_eda_executed"])
            self.assertEqual(1, len(document["candidate_proposals"]))
            self.assertEqual(1, document["candidate_execution"]["proposal_count"])

    def test_absent_adapter_preserves_legacy_workspace_behavior(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(optional_residual_research_context(Path(folder)))


if __name__ == "__main__":
    unittest.main()
