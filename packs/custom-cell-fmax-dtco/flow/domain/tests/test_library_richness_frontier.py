#!/usr/bin/env python3
"""Focused FW-07 contracts for the production cross-round frontier seam."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path


FLOW = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FLOW))

from library_richness import (  # noqa: E402
    FRONTIER_REQUEST_SCHEMA,
    FRONTIER_RESULT_SCHEMA,
    evaluate_frontier,
)


def _canonical_sha(value):
    payload = (json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ) + "\n").encode()
    return hashlib.sha256(payload).hexdigest()


def _key(number):
    return "sha256:" + ("%064x" % number)


def _manifest(function_keys):
    shard_id = "0001"
    return {
        "schema": "custom-cell-cumulative-library/1",
        "baselineReference": {
            "sha256": "a" * 64,
            "bytes": 123,
            "source": "fixture.lib",
        },
        "shards": [{
            "id": shard_id,
            "manifestSha256": "b" * 64,
            "functionKeys": sorted(function_keys),
        }],
        "functions": [{
            "functionKey": key,
            "candidateId": "CAND_%02d" % index,
            "shardId": shard_id,
            "state": "proxy-mapped",
            "stateHistory": ["discovered", "proxy-mapped"],
            "knownFailures": [],
            "identity": {
                "outputPins": [{"name": "Y", "liberty_function": "A"}],
            },
            "physicalCellNames": ["XS_%02d_Y" % index],
        } for index, key in enumerate(function_keys, 1)],
    }


def _layer(*, adoption, levels_removed, level, delay, slack_mass):
    return {
        "F0": {"candidate_adoption_fraction": adoption},
        "F1": {"levels_removed": levels_removed},
        "F2": {"max_logic_level": level},
        "F3": {
            "worst_delay_indicator_ps": delay,
            "negative_slack_mass_indicator_ps": slack_mass,
            "path_family_coverage": 2,
        },
    }


def _evaluation(*, token, level, delay, slack_mass, complete=True, adopted=True):
    objectives = [
        {"metric": "F0.candidate_adoption_fraction", "direction": "maximize"},
        {"metric": "F1.levels_removed", "direction": "maximize"},
        {"metric": "F2.max_logic_level", "direction": "minimize"},
        {"metric": "F3.worst_delay_indicator_ps", "direction": "minimize"},
        {"metric": "F3.negative_slack_mass_indicator_ps", "direction": "minimize"},
    ]
    required_metrics = [item["metric"] for item in objectives] + [
        "F3.path_family_coverage"
    ]
    scenarios = {}
    for index, name in enumerate(("optimistic", "nominal", "conservative"), 1):
        reference = _layer(
            adoption=0.0, levels_removed=0.0, level=10.0,
            delay=100.0 * index, slack_mass=200.0 * index,
        )
        augmented = _layer(
            adoption=1.0 if adopted else 0.0,
            levels_removed=2.0,
            level=level,
            delay=delay * index,
            slack_mass=slack_mass * index,
        )
        comparisons = []
        better = worse = False
        for objective in objectives:
            layer, field = objective["metric"].split(".", 1)
            before = reference[layer][field]
            after = augmented[layer][field]
            improved = (
                after < before if objective["direction"] == "minimize"
                else after > before
            )
            relation = "equal" if after == before else (
                "improved" if improved else "regressed"
            )
            better = better or relation == "improved"
            worse = worse or relation == "regressed"
            comparisons.append({
                "metric": objective["metric"],
                "direction": objective["direction"],
                "reference": before,
                "augmented": after,
                "augmented_minus_reference": after - before,
                "relation": relation,
            })
        pairwise_relation = (
            "tradeoff" if better and worse
            else "augmented-dominates" if better
            else "reference-dominates" if worse
            else "equal"
        )
        arm_completeness = {
            "required": required_metrics,
            "available": required_metrics,
            "missing": [],
            "fraction": 1.0,
            "complete": True,
        }
        scenarios[name] = {
            "status": "succeeded",
            "assumptions": {
                "clock_period_ps": 1000.0,
                "uncertainty_ps": 100.0,
                "initial_slew_ps": 10.0 * index,
                "wire_capacitance_in_library_units": float(index),
            },
            "reference": reference,
            "augmented": augmented,
            "metric_completeness": {
                "reference": copy.deepcopy(arm_completeness),
                "augmented": copy.deepcopy(arm_completeness),
                "complete": True,
            },
            "pairwise_relation": {
                "relation": pairwise_relation,
                "comparisons": comparisons,
            },
        }
    aggregate_values = [
        scenarios[name]["pairwise_relation"]["relation"]
        for name in ("optimistic", "nominal", "conservative")
    ]
    if all(value == "equal" for value in aggregate_values):
        aggregate = "equal"
    elif all(value in ("augmented-dominates", "equal") for value in aggregate_values):
        aggregate = "augmented-dominates"
    elif all(value in ("reference-dominates", "equal") for value in aggregate_values):
        aggregate = "reference-dominates"
    else:
        aggregate = "tradeoff"
    candidate_cell = "XS_%02d_Y" % token
    augmented_library_sha = "%064x" % (100 + token)
    reference_library_sha = (
        "4" * 64 if token == 1 else "%064x" % (99 + token)
    )
    augmented_netlist_sha = "%064x" % (200 + token)
    reference_netlist_sha = (
        "5" * 64 if token == 1 else "%064x" % (199 + token)
    )
    top_completeness = {
        "by_scenario": {
            name: copy.deepcopy(scenarios[name]["metric_completeness"])
            for name in ("optimistic", "nominal", "conservative")
        },
        "complete": complete,
    }
    if not complete:
        del scenarios["nominal"]["augmented"]["F3"]["path_family_coverage"]
        top_completeness["by_scenario"]["nominal"]["augmented"] = {
            "required": required_metrics,
            "available": required_metrics[:-1],
            "missing": ["F3.path_family_coverage"],
            "fraction": (len(required_metrics) - 1) / len(required_metrics),
            "complete": False,
        }
        top_completeness["by_scenario"]["nominal"]["complete"] = False
        scenarios["nominal"]["metric_completeness"] = copy.deepcopy(
            top_completeness["by_scenario"]["nominal"]
        )
    result = {
        "schema": "lfr-round-evaluation/3",
        "status": "succeeded",
        "request_sha256": "%064x" % token,
        "claim_limits": {
            "fmax_claimed": False,
            "commercial_adoption_claimed": False,
            "physical_benefit_claimed": False,
            "expected_qor_claimed": False,
            "commercial_eda_executed": False,
        },
        "hashes": {
            "invariant_mapping_plan_sha256": "1" * 64,
            "tools": {"yosys": "2" * 64, "abc": "3" * 64},
            "libraries": {
                "reference": [{"path": "fixture.lib", "sha256": reference_library_sha}],
                "augmented": [{"path": "augmented.lib", "sha256": augmented_library_sha}],
            },
            "mapped_netlists_revalidated": {
                "reference": reference_netlist_sha,
                "augmented": augmented_netlist_sha,
            },
            "outputs": {
                "reference": {"abc_constraints": "6" * 64},
                "augmented": {"abc_constraints": "6" * 64},
            },
        },
        "mapping": {
            "inputs": {
                "top": "fixture_top",
                "rtl": [{"path": "fixture.sv", "sha256": "7" * 64}],
            },
        },
        "metric_policy": {
            "objectives": objectives,
            "required_metrics": required_metrics,
        },
        "scenarios": scenarios,
        "metric_completeness": top_completeness,
        "pairwise_relation": {
            "relation": aggregate,
            "by_scenario": {
                name: scenarios[name]["pairwise_relation"]["relation"]
                for name in ("optimistic", "nominal", "conservative")
            },
        },
        "mapping_adoption": {
            "candidate_cells": [candidate_cell],
            "candidate_instances_in_augmented": {candidate_cell: 1} if adopted else {},
            "candidate_instance_count": 1 if adopted else 0,
            "candidate_cells_present_in_reference": {},
            "reference": {"cell_census": {"BASE": 10}},
            "augmented": {"cell_census": (
                {"BASE": 9, candidate_cell: 1} if adopted else {"BASE": 10}
            )},
        },
        "budgets": {
            "limits": {
                "max_candidate_cells": 10,
                "max_augmented_mapped_instances": 100,
            },
            "usage": {
                "candidate_cells": 1,
                "augmented_mapped_instances": 10,
            },
            "violations": [],
            "within_budget": True,
        },
        "commercial_validation_candidate": {
            "value": False,
            "meaning": "worth one commercial QoR observation; never an expected-benefit claim",
            "reasons": [
                "declared-candidate-adopted-by-open-source-mapper",
                "required-metric-vectors-complete",
                "evaluation-budgets-satisfied",
                "pairwise-relation:augmented-dominates",
                "nominal-non-f0-indicator-improvement:F2.max_logic_level",
            ],
            "blocking_reasons": ["portfolio-frontier-not-supplied"],
        },
    }
    result["evaluation_payload_sha256"] = _canonical_sha(result)
    return result


def _round(round_id, function_key, evaluation, *, cells=1, units=1.0, question=None):
    evaluation = copy.deepcopy(evaluation)
    evaluation["evaluation_payload_sha256"] = _canonical_sha({
        key: value for key, value in evaluation.items()
        if key != "evaluation_payload_sha256"
    })
    return {
        "round_id": round_id,
        "research_question": {
            "id": question or "question-" + round_id,
            "prompt": "Find a new structural transformation for " + round_id,
        },
        "function_keys": [function_key],
        "library_cost": {
            "new_library_cells": cells,
            "generation_units": units,
        },
        "evaluation": evaluation,
    }


def _request(rounds, manifest, *, next_question=None, **budget_overrides):
    budgets = {
        "max_rounds": 10,
        "max_new_library_cells": 20,
        "max_generation_units": 20.0,
        "plateau_rounds": 2,
    }
    budgets.update(budget_overrides)
    return {
        "schema": FRONTIER_REQUEST_SCHEMA,
        "library_manifest": manifest,
        "library_manifest_sha256": _canonical_sha(manifest),
        "rounds": rounds,
        "budgets": budgets,
        "next_residual_question": next_question,
    }


class FrontierContractTests(unittest.TestCase):
    def test_frontier_normalizes_directions_and_opens_one_observation_gate_at_stop(self):
        keys = [_key(1), _key(2)]
        manifest = _manifest(keys)
        first = _round("r1", keys[0], _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        second = _round("r2", keys[1], _evaluation(
            token=2, level=7.0, delay=85.0, slack_mass=170.0
        ))

        result = evaluate_frontier(_request([first, second], manifest))

        self.assertEqual(FRONTIER_RESULT_SCHEMA, result["schema"])
        self.assertEqual("succeeded", result["status"])
        self.assertEqual(["r1", "r2"], result["frontier"]["member_round_ids"])
        self.assertEqual(["r1", "r2"], result["frontier_member_ids"])
        self.assertEqual(["r1", "r2"], [row["id"] for row in result["members"]])
        self.assertEqual(
            result["rounds"][0]["metric_changes"],
            result["members"][0]["metric_vector"],
        )
        self.assertEqual("minimize", result["metric_directions"][
            "nominal:F3.worst_delay_indicator_ps"
        ])
        self.assertGreater(
            result["rounds"][1]["normalized_vector"][
                "nominal:F3.worst_delay_indicator_ps"
            ],
            result["rounds"][0]["normalized_vector"][
                "nominal:F3.worst_delay_indicator_ps"
            ],
        )
        self.assertEqual(["no-new-residual-question"], result["stopping"]["reasons"])
        self.assertTrue(result["commercial_validation_candidate"]["value"])
        self.assertEqual("r2", result["commercial_validation_candidate"]["round_id"])
        self.assertFalse(result["claim_limits"]["commercial_qor_predicted"])
        self.assertEqual("r1", result["rounds"][1]["parent_round"]["round_id"])
        self.assertEqual(
            result["rounds"][0]["lineage"]["augmented_library_sha256"],
            result["rounds"][1]["lineage"]["reference_library_sha256"],
        )

    def test_weaker_later_round_is_dominated_and_plateau_stops(self):
        keys = [_key(1), _key(2), _key(3)]
        manifest = _manifest(keys)
        rounds = [
            _round("r1", keys[0], _evaluation(
                token=1, level=7.0, delay=80.0, slack_mass=160.0
            )),
            _round("r2", keys[1], _evaluation(
                token=2, level=8.0, delay=90.0, slack_mass=180.0
            )),
            _round("r3", keys[2], _evaluation(
                token=3, level=9.0, delay=95.0, slack_mass=190.0
            )),
        ]
        next_question = {"id": "question-r4", "prompt": "Try a new reconvergent cut"}

        result = evaluate_frontier(_request(
            rounds, manifest, next_question=next_question, plateau_rounds=2
        ))

        self.assertEqual(["r1"], result["frontier"]["member_round_ids"])
        self.assertEqual(["r2", "r3"], result["frontier"]["dominated_round_ids"])
        self.assertTrue(result["convergence"]["plateau"])
        self.assertIn("pareto-frontier-plateau", result["stopping"]["reasons"])
        self.assertEqual(next_question, result["next_residual_question"])

    def test_duplicate_function_identity_is_retained_as_rejected_evidence(self):
        key = _key(1)
        manifest = _manifest([key])
        rounds = [
            _round("r1", key, _evaluation(
                token=1, level=8.0, delay=90.0, slack_mass=180.0
            )),
            _round("r2", key, _evaluation(
                token=2, level=7.0, delay=85.0, slack_mass=170.0
            )),
        ]

        result = evaluate_frontier(_request(rounds, manifest))

        self.assertEqual(["r2"], result["frontier"]["rejected_round_ids"])
        self.assertTrue(any(
            reason.startswith("duplicate-function-identity:")
            for reason in result["rounds"][1]["reasons"]
        ))

    def test_manifest_function_identity_must_bind_declared_candidate_cell(self):
        key = _key(1)
        manifest = _manifest([key])
        wrong_cell = _round("r1", key, _evaluation(
            token=99, level=8.0, delay=90.0, slack_mass=180.0
        ))

        result = evaluate_frontier(_request([wrong_cell], manifest))

        self.assertEqual(["r1"], result["frontier"]["rejected_round_ids"])
        self.assertIn(
            "candidate-cell-function-identity-mismatch",
            result["rounds"][0]["reasons"],
        )

    def test_hash_mismatch_and_incomplete_metric_record_are_rejected(self):
        keys = [_key(1), _key(2)]
        manifest = _manifest(keys)
        damaged = _round("r1", keys[0], _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        damaged["evaluation"]["scenarios"]["nominal"]["augmented"]["F2"][
            "max_logic_level"
        ] = 1.0
        incomplete = _evaluation(
            token=2, level=7.0, delay=85.0, slack_mass=170.0, complete=False
        )

        result = evaluate_frontier(_request([
            damaged,
            _round("r2", keys[1], incomplete),
        ], manifest))

        self.assertEqual(["r1", "r2"], result["frontier"]["rejected_round_ids"])
        self.assertIn("payload hash mismatch", " ".join(result["rounds"][0]["reasons"]))
        self.assertIn("required-metric-vectors-incomplete", result["rounds"][1]["reasons"])
        self.assertFalse(result["commercial_validation_candidate"]["value"])

    def test_f3_regression_stays_on_frontier_but_blocks_commercial_observation(self):
        key = _key(1)
        manifest = _manifest([key])
        regressed = _evaluation(token=1, level=5.0, delay=110.0, slack_mass=220.0)
        regressed["commercial_validation_candidate"]["blocking_reasons"] += [
            "f3-regression:nominal:F3.worst_delay_indicator_ps"
        ]
        regressed["evaluation_payload_sha256"] = _canonical_sha({
            key: value for key, value in regressed.items()
            if key != "evaluation_payload_sha256"
        })

        result = evaluate_frontier(_request([
            _round("r1", key, regressed),
        ], manifest))

        self.assertEqual(["r1"], result["frontier"]["member_round_ids"])
        self.assertTrue(result["rounds"][0]["f3_regressions"])
        self.assertFalse(result["commercial_validation_candidate"]["value"])
        self.assertTrue(any(
            reason.startswith("f3-regression:")
            for reason in result["commercial_validation_candidate"]["blocking_reasons"]
        ))

    def test_budget_and_duplicate_next_question_are_explicit_stop_reasons(self):
        key = _key(1)
        manifest = _manifest([key])
        round_one = _round("r1", key, _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ), cells=2, units=3.0, question="already-asked")

        result = evaluate_frontier(_request(
            [round_one],
            manifest,
            next_question={"id": "already-asked", "prompt": "Repeat the same question"},
            max_rounds=1,
            max_new_library_cells=2,
            max_generation_units=3.0,
        ))

        self.assertEqual({
            "round-budget-exhausted",
            "new-library-cell-budget-exhausted",
            "generation-unit-budget-exhausted",
            "no-new-residual-question",
        }, set(result["stopping"]["reasons"]))
        self.assertIsNone(result["next_residual_question"])

    def test_budget_overshoot_rejects_offending_round_and_cannot_open_gate(self):
        key = _key(1)
        manifest = _manifest([key])
        overshoot = _round("r1", key, _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ), cells=2, units=3.0)

        result = evaluate_frontier(_request(
            [overshoot], manifest,
            max_rounds=1,
            max_new_library_cells=1,
            max_generation_units=2.0,
        ))

        self.assertEqual(["r1"], result["frontier"]["rejected_round_ids"])
        self.assertIn("new-library-cell-budget-overshoot", result["rounds"][0]["reasons"])
        self.assertIn("generation-unit-budget-overshoot", result["rounds"][0]["reasons"])
        self.assertFalse(result["commercial_validation_candidate"]["value"])

    def test_budget_equality_stops_but_keeps_frontier_member_eligible(self):
        key = _key(1)
        manifest = _manifest([key])
        at_limit = _round("r1", key, _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ), cells=1, units=1.0)

        result = evaluate_frontier(_request(
            [at_limit], manifest,
            max_rounds=1,
            max_new_library_cells=1,
            max_generation_units=1.0,
        ))

        self.assertEqual(["r1"], result["frontier"]["member_round_ids"])
        self.assertNotIn("new-library-cell-budget-overshoot", result["rounds"][0]["reasons"])
        self.assertTrue(result["commercial_validation_candidate"]["value"])

    def test_self_hashed_forged_adoption_is_rejected(self):
        key = _key(1)
        manifest = _manifest([key])
        forged = _round("r1", key, _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        forged["evaluation"]["mapping_adoption"]["candidate_instance_count"] = 999
        forged["evaluation"]["evaluation_payload_sha256"] = _canonical_sha({
            name: value for name, value in forged["evaluation"].items()
            if name != "evaluation_payload_sha256"
        })

        result = evaluate_frontier(_request([forged], manifest))

        self.assertEqual(["r1"], result["frontier"]["rejected_round_ids"])
        self.assertIn("candidate instance count is internally inconsistent", " ".join(
            result["rounds"][0]["reasons"]
        ))

    def test_self_hashed_forged_pairwise_relation_is_rejected(self):
        key = _key(1)
        manifest = _manifest([key])
        forged = _round("r1", key, _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        forged["evaluation"]["scenarios"]["nominal"]["pairwise_relation"][
            "relation"
        ] = "reference-dominates"
        forged["evaluation"]["evaluation_payload_sha256"] = _canonical_sha({
            name: value for name, value in forged["evaluation"].items()
            if name != "evaluation_payload_sha256"
        })

        result = evaluate_frontier(_request([forged], manifest))

        self.assertEqual(["r1"], result["frontier"]["rejected_round_ids"])
        self.assertIn("pairwise relation is internally inconsistent", " ".join(
            result["rounds"][0]["reasons"]
        ))

    def test_self_hashed_evaluation_budget_inconsistency_is_rejected(self):
        key = _key(1)
        manifest = _manifest([key])
        forged = _round("r1", key, _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        forged["evaluation"]["budgets"]["usage"]["augmented_mapped_instances"] = 1
        forged["evaluation"]["evaluation_payload_sha256"] = _canonical_sha({
            name: value for name, value in forged["evaluation"].items()
            if name != "evaluation_payload_sha256"
        })

        result = evaluate_frontier(_request([forged], manifest))

        self.assertEqual(["r1"], result["frontier"]["rejected_round_ids"])
        self.assertIn("budget status is internally inconsistent", " ".join(
            result["rounds"][0]["reasons"]
        ))

    def test_manifest_physical_cell_collision_fails_closed(self):
        keys = [_key(1), _key(2)]
        manifest = _manifest(keys)
        manifest["functions"][1]["physicalCellNames"] = list(
            manifest["functions"][0]["physicalCellNames"]
        )

        result = evaluate_frontier(_request([
            _round("r1", keys[0], _evaluation(
                token=1, level=8.0, delay=90.0, slack_mass=180.0
            )),
        ], manifest))

        self.assertEqual("failed", result["status"])
        self.assertIn("physical Cell", result["error"]["message"])

    def test_broken_cumulative_library_lineage_rejects_child_round(self):
        keys = [_key(1), _key(2)]
        manifest = _manifest(keys)
        first = _round("r1", keys[0], _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        second = _round("r2", keys[1], _evaluation(
            token=2, level=7.0, delay=85.0, slack_mass=170.0
        ))
        second["evaluation"]["hashes"]["libraries"]["reference"][0][
            "sha256"
        ] = "8" * 64
        second["evaluation"]["evaluation_payload_sha256"] = _canonical_sha({
            name: value for name, value in second["evaluation"].items()
            if name != "evaluation_payload_sha256"
        })

        result = evaluate_frontier(_request([first, second], manifest))

        self.assertEqual(["r2"], result["frontier"]["rejected_round_ids"])
        self.assertIn("reference-library-lineage-mismatch", result["rounds"][1]["reasons"])

    def test_rejected_rounds_do_not_create_a_plateau_or_open_gate(self):
        keys = [_key(1), _key(2), _key(3)]
        manifest = _manifest(keys)
        first = _round("r1", keys[0], _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        rejected = []
        for round_id, key, token in (("r2", keys[1], 2), ("r3", keys[2], 3)):
            row = _round(round_id, key, _evaluation(
                token=token, level=7.0, delay=85.0, slack_mass=170.0
            ))
            row["evaluation"]["mapping_adoption"]["candidate_instance_count"] = 999
            row["evaluation"]["evaluation_payload_sha256"] = _canonical_sha({
                name: value for name, value in row["evaluation"].items()
                if name != "evaluation_payload_sha256"
            })
            rejected.append(row)

        result = evaluate_frontier(_request(
            [first, *rejected],
            manifest,
            next_question={"id": "question-r4", "prompt": "Try a new cut family"},
            plateau_rounds=2,
        ))

        self.assertEqual(["r2", "r3"], result["frontier"]["rejected_round_ids"])
        self.assertEqual(0, result["convergence"][
            "trailing_rounds_without_frontier_progress"
        ])
        self.assertFalse(result["convergence"]["plateau"])
        self.assertFalse(result["stopping"]["should_stop"])
        self.assertFalse(result["commercial_validation_candidate"]["value"])

    def test_nonadopted_f1_positive_round_never_enters_frontier_or_lineage(self):
        keys = [_key(1), _key(2), _key(3)]
        manifest = _manifest(keys)
        first = _round("r1", keys[0], _evaluation(
            token=1, level=8.0, delay=90.0, slack_mass=180.0
        ))
        nonadopted = _round("r2", keys[1], _evaluation(
            token=2, level=6.0, delay=80.0, slack_mass=160.0, adopted=False
        ))
        third = _round("r3", keys[2], _evaluation(
            token=3, level=7.0, delay=85.0, slack_mass=170.0
        ))
        third["evaluation"]["hashes"]["libraries"]["reference"] = copy.deepcopy(
            first["evaluation"]["hashes"]["libraries"]["augmented"]
        )
        third["evaluation"]["hashes"]["mapped_netlists_revalidated"][
            "reference"
        ] = first["evaluation"]["hashes"]["mapped_netlists_revalidated"]["augmented"]
        third["evaluation"]["evaluation_payload_sha256"] = _canonical_sha({
            name: value for name, value in third["evaluation"].items()
            if name != "evaluation_payload_sha256"
        })

        result = evaluate_frontier(_request([first, nonadopted, third], manifest))

        self.assertEqual(["r2"], result["frontier"]["rejected_round_ids"])
        self.assertIn("no-declared-candidate-adoption", result["rounds"][1]["reasons"])
        self.assertNotIn("r2", result["frontier_member_ids"])
        self.assertFalse(result["rounds"][1]["commercial_validation_candidate"]["value"])
        self.assertEqual("r1", result["rounds"][2]["parent_round"]["round_id"])
        self.assertEqual(0, result["convergence"][
            "trailing_rounds_without_frontier_progress"
        ])


if __name__ == "__main__":
    unittest.main()
