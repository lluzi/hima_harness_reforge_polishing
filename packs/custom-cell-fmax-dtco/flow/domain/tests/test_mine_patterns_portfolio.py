#!/usr/bin/env python3
"""Focused FW-05 tests for the production candidate/portfolio seam."""

from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from mine_patterns import (  # noqa: E402
    mapper_evidence_from_mapping_result,
    portfolio_candidate_from_generation_request,
    project_candidate_identity,
    select_candidate_portfolio,
)
from mine_timing_route import _route_requests, rank_critical_subgraph  # noqa: E402
from verilog_netlist import Instance  # noqa: E402


FIXTURE = DOMAIN / "tests" / "fixtures" / "lfr-proxy-mapping-result.real-projection.json"
FIXTURE_SHA256 = "7f22712b792c97388dcc3c2b723c0f4acdf4826afea6230a851a2a68f315100e"


def _cell(inputs=("A",), ast=None):
    return SimpleNamespace(
        is_seq=False,
        inputs=tuple(inputs),
        outputs={"Y": ast or ("var", inputs[0])},
    )


def _instance(cell_type, name, output, **inputs):
    return Instance("top", cell_type, name, dict(inputs, Y=output))


def _production_requests():
    """Run the actual timing-route request builder over a two-level cone."""
    cells = {
        "AND": _cell(("A", "B"), ("and", ("var", "A"), ("var", "B"))),
        "INV": _cell(("A",), ("not", ("var", "A"))),
    }
    instances = [
        _instance("AND", "U0", "n0", A="a", B="b"),
        _instance("INV", "U1", "o", A="n0"),
    ]
    delays = {"AND": 2.0, "INV": 1.0}
    critical = rank_critical_subgraph("top", instances, cells, delays)
    args = SimpleNamespace(
        max_inputs=4,
        max_cuts_per_root=32,
        max_critical_roots=24,
        max_outputs=4,
        objective="critical_context_pareto",
        top=10,
        strategy_id="portfolio_roundtrip",
        process_family="test_process",
        cell_architecture_ref="test_architecture",
        characterization_profile_ref="test_characterization",
        drive_strength=["X1"],
        vt_class=["SVT"],
        model_type=["NLDM"],
    )
    requests, _statistics = _route_requests(
        {"top": instances}, cells, [critical], {}, {}, delays, args
    )
    return requests


def _ready_request():
    return next(
        request for request in _production_requests()
        if request["implementation_plan"]["route"] == "boolean_synthesis"
        and request["discovery_evidence"]["influence_vector"]["mapping_feasible"]
    )


def _fixture_request():
    request = copy.deepcopy(_ready_request())
    request["candidate_id"] = "CAND_TIMING_CRITICALITY_A2_SINGLE_0004"
    return request


def _write_mapping_result(folder, document):
    path = Path(folder) / "mapping-result.json"
    payload = (json.dumps(document, indent=2, sort_keys=True) + "\n").encode()
    path.write_bytes(payload)
    return path, hashlib.sha256(payload).hexdigest()


def _proxy(baseline=None, delta=None):
    return {
        "evidence_id": "paired-map-001",
        "baseline_slack_by_endpoint_family_ps": baseline or {
            "launch0->capture0": -20.0,
            "launch1->capture1": -10.0,
        },
        "paired_delta_by_endpoint_family_ps": delta or {
            "launch0->capture0": 2.0,
            "launch1->capture1": 9.0,
        },
    }


class CandidateIdentityTests(unittest.TestCase):
    def test_projection_is_deterministic_for_production_request(self):
        request = _ready_request()
        reordered = copy.deepcopy(request)
        implementation = reordered["generator_contract"]["implementation_request"]
        implementation["drive_strengths"] = ["X2", "X1", "X2"]
        implementation["vt_classes"] = ["SVT", "LVT"]
        first = project_candidate_identity(reordered)
        implementation["drive_strengths"] = ["X1", "X2"]
        implementation["vt_classes"] = ["LVT", "SVT"]
        second = project_candidate_identity(reordered)

        self.assertEqual(first, second)
        self.assertTrue(first["function_class"].startswith("NPN:"))
        self.assertEqual(4, len(first["drive_variants"]))


class PortfolioSelectionTests(unittest.TestCase):
    def test_route_request_round_trips_through_canonical_adapter(self):
        request = _ready_request()
        candidate = portfolio_candidate_from_generation_request(
            request, stage="pre_mapping"
        )

        result = select_candidate_portfolio(
            [candidate], 1, stage="pre_mapping", design_proxy_evidence=_proxy()
        )

        self.assertEqual(request, candidate["source_generation_request"])
        self.assertEqual("ready", candidate["generation_feasibility"]["status"])
        self.assertEqual("pass", candidate["local_break_even"]["status"])
        self.assertGreater(candidate["structural_metrics"]["levels_removed"], 0)
        self.assertEqual(
            3,
            candidate["structural_metrics"]["cut_width"],
            "the production 2-input/1-output Boolean cut includes top PI/PO boundaries",
        )
        self.assertEqual([request["candidate_id"]], [
            row["candidate_id"] for row in result["selected"]
        ])
        self.assertEqual("PRE_MAPPING_PLANNING", result["status"])
        self.assertFalse(result["evidence_layers"]["F2_whole_design_mapping"])
        self.assertFalse(result["claims"]["commercial_qor_prediction"])

    def test_structure_candidate_without_timing_counterfactual_enters_f1_portfolio(self):
        request = copy.deepcopy(_ready_request())
        request.pop("mapping_feasibility", None)
        evidence = request["discovery_evidence"]
        evidence.pop("influence_vector", None)
        evidence.pop("counterfactual", None)
        request.pop("counterfactual", None)
        evidence.update({
            "raw_support": 4,
            "non_overlapping_support": 3,
            "current_cells_per_site": {"min": 3, "max": 3},
            "current_logic_levels_per_site": {"min": 2, "max": 2},
            "occurrence_alignments": [{
                "module": "top", "instances": ["U0", "U1", "U2"],
                "contract_pin_mapping": {},
            }],
            "representative_occurrence": {
                "module": "top", "instances": ["U0", "U1", "U2"],
                "internal_nets": 2,
            },
        })

        candidate = portfolio_candidate_from_generation_request(
            request, stage="pre_mapping"
        )
        result = select_candidate_portfolio(
            [candidate], 1, stage="pre_mapping", design_proxy_evidence=_proxy()
        )

        self.assertEqual("ready", candidate["generation_feasibility"]["status"])
        self.assertEqual("missing", candidate["local_break_even"]["status"])
        self.assertEqual(1.0, candidate["structural_metrics"]["levels_removed"])
        self.assertEqual([request["candidate_id"]], [
            row["candidate_id"] for row in result["selected"]
        ])

    def test_nonreplaceable_occurrence_still_enters_whole_library_screen(self):
        good_request = _ready_request()
        bad_request = copy.deepcopy(good_request)
        bad_request["candidate_id"] += "_LOCAL_BYPASS"
        bad_request["discovery_evidence"]["influence_vector"]["mapping_feasible"] = False
        bad_request["mapping_feasibility"] = {
            "status": "INFEASIBLE",
            "reasons": ["original occurrence has a side output"],
        }
        good = portfolio_candidate_from_generation_request(
            good_request, stage="pre_mapping"
        )
        bad = portfolio_candidate_from_generation_request(
            bad_request, stage="pre_mapping"
        )
        bad["raw_metrics"]["occurrences"].append({
            "endpoint_family": "launch0->capture0",
            "baseline_slack_ps": -9999.0,
        })

        result = select_candidate_portfolio(
            [bad, good], 2, stage="pre_mapping", design_proxy_evidence=_proxy()
        )

        self.assertEqual(-20.0, result["baseline"]["proxy_worst_frontier_indicator_ps"])
        self.assertEqual(2, len(result["selected"]))
        observed = next(
            row for row in result["candidate_evaluations"]
            if row["candidate_id"] == bad["candidate_id"]
        )
        self.assertEqual([], observed["rejection_reasons"])
        self.assertFalse(
            observed["candidate"]["raw_metrics"]["influence_vector"]["mapping_feasible"]
        )

    def test_same_family_delta_is_applied_once_for_multiple_candidates(self):
        first = portfolio_candidate_from_generation_request(
            _ready_request(), stage="pre_mapping"
        )
        second = copy.deepcopy(first)
        second["candidate_id"] += "_SECOND"
        second["covered_instance_keys"] = ["top/U2", "top/U3"]
        proxy = _proxy(
            baseline={"launch0->capture0": -20.0},
            delta={"launch0->capture0": 4.0},
        )

        result = select_candidate_portfolio(
            [first, second], 2,
            stage="pre_mapping", design_proxy_evidence=proxy,
        )

        self.assertEqual(2, len(result["selected"]))
        self.assertEqual(
            -16.0,
            result["paired_augmented_indicator"][
                "proxy_worst_frontier_indicator_ps"
            ],
        )
        self.assertEqual(
            "once_for_the_paired_augmented_mapping_not_per_candidate_or_occurrence",
            result["family_delta_application"],
        )

    def test_real_mapping_result_adoption_round_trips_to_post_selection(self):
        request = _fixture_request()
        mapper = mapper_evidence_from_mapping_result(
            request, FIXTURE, FIXTURE_SHA256
        )
        candidate = portfolio_candidate_from_generation_request(
            request,
            stage="post_mapping",
            verified_mapper_evidence=mapper,
        )

        result = select_candidate_portfolio(
            [candidate], 1, stage="post_mapping", design_proxy_evidence=_proxy()
        )

        self.assertEqual("ready", candidate["generation_feasibility"]["status"])
        self.assertEqual("adopted", candidate["mapper_evidence"]["status"])
        self.assertEqual(11, candidate["mapper_evidence"]["candidate_instances"])
        self.assertEqual(1, len(result["selected"]))
        self.assertTrue(result["evidence_layers"]["F2_whole_design_mapping"])
        self.assertEqual(
            FIXTURE_SHA256,
            candidate["mapper_evidence"]["source_hashes"][
                "mapping_result_sha256"
            ],
        )

    def test_generation_ready_but_verified_nonadopted_is_rejected(self):
        request = _fixture_request()
        document = json.loads(FIXTURE.read_text())
        cell = "XS_TIMING_CRITICALITY_A2_SINGLE_0004_Y"
        del document["arms"]["augmented"]["adoption"]["cell_census"][cell]
        with tempfile.TemporaryDirectory() as folder:
            path, digest = _write_mapping_result(folder, document)
            mapper = mapper_evidence_from_mapping_result(request, path, digest)
        candidate = portfolio_candidate_from_generation_request(
            request, stage="post_mapping", verified_mapper_evidence=mapper
        )

        result = select_candidate_portfolio(
            [candidate], 1, stage="post_mapping", design_proxy_evidence=_proxy()
        )

        self.assertEqual("ready", candidate["generation_feasibility"]["status"])
        self.assertEqual("not_adopted", candidate["mapper_evidence"]["status"])
        self.assertEqual([], result["selected"])
        self.assertIn(
            "mapper_non_adoption",
            result["candidate_evaluations"][0]["rejection_reasons"],
        )

    def test_mapping_result_tamper_and_reference_leakage_fail_closed(self):
        request = _fixture_request()
        document = json.loads(FIXTURE.read_text())
        cell = "XS_TIMING_CRITICALITY_A2_SINGLE_0004_Y"
        with tempfile.TemporaryDirectory() as folder:
            tampered = copy.deepcopy(document)
            tampered["arms"]["augmented"]["adoption"]["cell_census"][cell] = 12
            tampered_path, _tampered_digest = _write_mapping_result(folder, tampered)
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                mapper_evidence_from_mapping_result(
                    request, tampered_path, FIXTURE_SHA256
                )

            leaked = copy.deepcopy(document)
            leaked["arms"]["reference"]["adoption"]["cell_census"][cell] = 1
            leaked_path, leaked_digest = _write_mapping_result(folder, leaked)
            with self.assertRaisesRegex(ValueError, "leaked into reference"):
                mapper_evidence_from_mapping_result(
                    request, leaked_path, leaked_digest
                )

    def test_overlapping_distinct_functions_both_enter_pre_mapping_portfolio(self):
        first = portfolio_candidate_from_generation_request(
            _ready_request(), stage="pre_mapping"
        )
        second = copy.deepcopy(first)
        second["candidate_id"] += "_OVERLAP"
        second["identity"] = copy.deepcopy(first["identity"])
        second["identity"]["function_interface_id"] += "_DISTINCT"

        result = select_candidate_portfolio(
            [first, second], 2, stage="pre_mapping", design_proxy_evidence=_proxy()
        )

        self.assertEqual(2, len(result["selected"]))
        self.assertEqual(1, len(result["overlap_advisories"]))
        self.assertEqual(
            "advisory_only_pre_mapping_include_both_in_one_augmented_mapping",
            result["overlap_advisories"][0]["effect"],
        )


if __name__ == "__main__":
    unittest.main()
