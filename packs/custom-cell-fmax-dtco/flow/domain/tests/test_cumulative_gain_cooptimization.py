#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[2]
DOMAIN = FLOW / "domain"
sys.path.insert(0, str(FLOW))
sys.path.insert(0, str(DOMAIN))

from mine_timing_route import (  # noqa: E402
    build_endpoint_frontier,
    compare_endpoint_frontiers,
    evaluate_physical_fusion,
)
from mine_patterns import evaluate_cover_opportunity  # noqa: E402
from library_richness import (  # noqa: E402
    derive_cell_demands,
    evaluate_cumulative_gain,
    optimize_action_portfolio,
)
from _generation_projection import patterns_from_cell_demands  # noqa: E402
import stages  # noqa: E402

FIXTURE = DOMAIN / "tests" / "fixtures" / "lfr-pre-mapping-portfolio.production.json"


def _state(slacks, epsilon=0.01):
    return build_endpoint_frontier([
        {"endpoint": name, "beginpoint": "b/" + name, "slack_ns": slack,
         "path_group": "reg2reg", "instances": ["top/U_" + name]}
        for name, slack in slacks.items()
    ], epsilon_ns=epsilon)


def _action(name, deltas, resource=None, demand=None, kind="single-output", module="top"):
    demand = demand or name
    return {
        "action_id": name,
        "kind": kind,
        "apply_mode": "eco-only" if kind != "single-output" else "synthesis-eligible",
        "module": module,
        "source_instances": [resource or name],
        "resources": [module + "/" + (resource or name)],
        "delta_slack_by_endpoint": deltas,
        "model_uncertainty_ns": 0.0,
        "physical_penalty_ns": 0.0,
        "root_checks": [{"root": "Y", "output_used": True, "required_time_met": True}],
        "cell_demand": {
            "demand_id": demand,
            "function_vector": ["A"],
            "apply_mode": "eco-only" if kind != "single-output" else "synthesis-eligible",
        },
    }


class EndpointFrontierTests(unittest.TestCase):
    def test_paths_are_deduplicated_by_endpoint(self):
        frontier = build_endpoint_frontier([
            {"endpoint": "R0/D", "beginpoint": "A/Q", "slack_ns": -0.1},
            {"endpoint": "R0/D", "beginpoint": "B/Q", "slack_ns": -0.09},
            {"endpoint": "R1/D", "beginpoint": "C/Q", "slack_ns": -0.08},
        ], epsilon_ns=0.01)
        self.assertEqual(2, frontier["unique_endpoint_count"])
        self.assertEqual(3, frontier["path_count"])
        self.assertEqual(["R0/D"], frontier["frontier_endpoints"])
        self.assertEqual(2, frontier["endpoints"][0]["path_count"])

    def test_path_migration_names_the_new_frontier(self):
        before = _state({"E0": -0.1, "E1": -0.095, "E2": -0.08})
        after = _state({"E0": -0.07, "E1": -0.065, "E2": -0.08})
        migration = compare_endpoint_frontiers(before, after)
        self.assertTrue(migration["path_migrated"])
        self.assertEqual(["E2"], migration["entered_frontier"])

    def test_fusion_preserves_side_output(self):
        result = evaluate_physical_fusion(0.02, 0.008, 0.004, 0.018,
                                          added_pin_load_ns=0.002,
                                          reroute_penalty_ns=0.001,
                                          side_load_count=3)
        self.assertTrue(result["admitted"])
        self.assertTrue(result["preserve_intermediate_output"])
        self.assertEqual(2, result["required_output_count"])


class CoverAndPortfolioTests(unittest.TestCase):
    def test_three_output_required_time_is_all_or_nothing(self):
        result = evaluate_cover_opportunity(
            opportunity_id="MO3", kind="multi-output",
            roots=[
                {"root": "Y0", "endpoint": "E0", "output_used": True,
                 "required_time_ns": 0.1, "candidate_arrival_ns": 0.08},
                {"root": "Y1", "endpoint": "E1", "output_used": True,
                 "required_time_ns": 0.1, "candidate_arrival_ns": 0.11},
                {"root": "Y2", "endpoint": "E2", "output_used": True,
                 "required_time_ns": 0.1, "candidate_arrival_ns": 0.07},
            ],
            baseline_cover={"Y0": 0.1, "Y1": 0.13, "Y2": 0.09},
            candidate_cover={"Y0": 0.08, "Y1": 0.11, "Y2": 0.07},
        )
        self.assertEqual("rejected", result["status"])
        self.assertIn("required-time-miss:Y1", result["rejection_reasons"])

    def test_three_of_32_endpoints_cannot_claim_a_portfolio(self):
        state = _state({"E%02d" % index: -0.1 for index in range(32)})
        result = optimize_action_portfolio(
            state, [_action("A", {"E00": 0.02, "E01": 0.02, "E02": 0.02})], 100
        )
        self.assertEqual([], result["selected_action_ids"])
        self.assertEqual(0.0, result["final"]["wns_ns"] - result["baseline"]["wns_ns"])

    def test_full_frontier_portfolio_recomputes_until_wns_moves(self):
        state = _state({"E%02d" % index: -0.1 for index in range(32)})
        actions = [_action("A%02d" % index, {"E%02d" % index: 0.02})
                   for index in range(32)]
        result = optimize_action_portfolio(state, actions, 100)
        self.assertEqual(32, len(result["selected_actions"]))
        self.assertAlmostEqual(-0.08, result["final"]["wns_ns"])
        self.assertEqual("portfolio-preparation", result["selected_actions"][0]["admission"])
        self.assertGreater(result["selected_actions"][-1]["marginal_at_selection"]["delta_wns_ns"], 0)

    def test_overlap_is_not_double_counted_but_module_scope_is_distinct(self):
        state = _state({"E0": -0.1, "E1": -0.1})
        actions = [
            _action("M0", {"E0": 0.02}, resource="U0", module="m0"),
            _action("M1", {"E1": 0.02}, resource="U0", module="m1"),
            _action("M0_OVERLAP", {"E0": 0.05}, resource="U0", module="m0"),
        ]
        result = optimize_action_portfolio(state, actions, 100)
        self.assertIn("M1", result["selected_action_ids"])
        self.assertEqual(2, len(result["selected_action_ids"]))
        self.assertFalse({"M0", "M0_OVERLAP"} <= set(result["selected_action_ids"]))

    def test_demands_aggregate_actions_and_project_delta_generation(self):
        state = _state({"E0": -0.1, "E1": -0.1})
        fixture = json.loads(FIXTURE.read_text())
        request = fixture["candidate_evaluations"][0]["candidate"]["source_generation_request"]
        a0 = _action("A0", {"E0": 0.02}, demand="D0")
        a1 = _action("A1", {"E1": 0.02}, demand="D0")
        for action in (a0, a1):
            action["cell_demand"]["generation_request"] = request
        portfolio = optimize_action_portfolio(state, [a0, a1], 100)
        demands = derive_cell_demands(portfolio)
        patterns = patterns_from_cell_demands(demands)
        self.assertEqual(1, demands["demand_count"])
        self.assertEqual(2, demands["demands"][0]["expected_occurrences"])
        self.assertEqual(1, len(patterns["generation_requests"]))

    def test_request_api_returns_commercial_gate_without_qor_claim(self):
        state = _state({"E0": -0.1})
        result = evaluate_cumulative_gain({
            "schema": "hima.lfr-cumulative-gain-request/1",
            "design_state": state,
            "actions": [_action("A", {"E0": 0.02})],
            "cell_budget": 100,
        })
        self.assertTrue(result["commercial_gate"]["eligible"])
        self.assertEqual(1, result["commercial_gate"]["maximum_generated_arms"])
        self.assertFalse(result["claim_limits"]["fmax_prediction"])

    def test_sampled_top_paths_cannot_open_the_commercial_gate(self):
        state = _state({"E0": -0.1})
        state["coverage_scope"] = "sampled-commercial-top-paths"
        result = evaluate_cumulative_gain({
            "schema": "hima.lfr-cumulative-gain-request/1",
            "design_state": state,
            "actions": [_action("A", {"E0": 0.02})],
            "cell_budget": 100,
        })
        self.assertFalse(result["commercial_gate"]["eligible"])
        self.assertIn(
            "endpoint-frontier-is-sampled-not-complete",
            result["commercial_gate"]["blocking_reasons"],
        )

    def test_existing_stage_workspace_writes_the_five_internal_artifacts(self):
        state = _state({"E0": -0.1})
        request = {
            "schema": "hima.lfr-cumulative-gain-request/1",
            "design_state": state, "actions": [_action("A", {"E0": 0.02})],
            "cell_budget": 100,
        }
        with tempfile.TemporaryDirectory() as folder:
            paths = stages.write_cumulative_gain_artifacts(folder, request)
            self.assertEqual({
                "endpoint-frontier.json", "opportunities.json",
                "action-portfolio.json", "cell-demand.json", "gain-evaluation.json",
            }, set(paths))
            result = json.loads(paths["gain-evaluation.json"].read_text())
        self.assertEqual("hima.lfr-cumulative-gain-evaluation/1", result["schema"])
        self.assertEqual(["A"], result["action_portfolio"]["selected_action_ids"])


if __name__ == "__main__":
    unittest.main()
