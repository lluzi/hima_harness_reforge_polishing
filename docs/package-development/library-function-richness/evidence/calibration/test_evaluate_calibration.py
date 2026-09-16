#!/usr/bin/env python3

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from evaluate_calibration import (
    CalibrationError,
    _spearman_with_ties,
    build_calibration_report,
    main,
)
from validate_corpus import canonical_identity


REPOSITORY = Path(__file__).resolve().parents[5]
PRODUCTION_PATH = REPOSITORY / "packs/custom-cell-fmax-dtco/flow/library_richness.py"
PRODUCTION_SPEC = importlib.util.spec_from_file_location("lfr_production_round", PRODUCTION_PATH)
assert PRODUCTION_SPEC is not None and PRODUCTION_SPEC.loader is not None
PRODUCTION_ROUND = importlib.util.module_from_spec(PRODUCTION_SPEC)
sys.modules[PRODUCTION_SPEC.name] = PRODUCTION_ROUND
PRODUCTION_SPEC.loader.exec_module(PRODUCTION_ROUND)


def _write(path: Path, value: object) -> str:
    path.write_text(json.dumps(value, sort_keys=True), encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _corpus(adoption_sha: str) -> dict[str, object]:
    shared = {
        "designTop": "aes_cipher_top",
        "rtlSetSha256": "placeholder",
        "constraintsSha256": "2" * 64,
        "foundryLibertySha256": "3" * 64,
        "foundryDbSha256": "4" * 64,
        "predicted47CellLibertySha256": "5" * 64,
        "clockPeriodNs": 0.5,
        "dcUncertaintyNs": 0.25,
    }
    rtl = [
        {
            "path": f"/site/rtl/{name}",
            "sha256": hashlib.sha256(f"rtl-{index}-{name}".encode()).hexdigest(),
            "storage": "site-only",
            "committed": False,
        }
        for index, name in enumerate(
            [
                "aes_cipher_top.v",
                "aes_inv_cipher_top.v",
                "aes_inv_sbox.v",
                "aes_key_expand_128.v",
                "aes_rcon.v",
                "aes_sbox.v",
                "timescale.v",
            ],
            start=6,
        )
    ]
    encoded_rtl = json.dumps(
        [{"path": item["path"], "sha256": item["sha256"]} for item in rtl],
        sort_keys=True,
        separators=(",", ":"),
    ).encode()
    shared["rtlSetSha256"] = hashlib.sha256(encoded_rtl).hexdigest()

    def locator(kind: str, sha: str) -> dict[str, object]:
        return {
            "kind": kind,
            "path": f"/site/{kind}.json",
            "sha256": sha,
            "bytes": 10,
            "storage": "site-only",
            "committed": False,
        }

    evidence_hashes = {
        "predicted-liberty": "a" * 64,
        "dc-adoption": adoption_sha,
        "generated-route-record": "b" * 64,
        "final-route-timing": "c" * 64,
        "final-route-census": "d" * 64,
        "matched-comparison": "e" * 64,
    }

    def trial(
        trial_id: str,
        route_uncertainty: float,
        cts: str,
        generated_wns: float,
        custom_count: int,
        positive: bool,
    ) -> dict[str, object]:
        return {
            "id": trial_id,
            "sharedIdentity": copy.deepcopy(shared),
            "conditions": {
                "routeUncertaintyNs": route_uncertainty,
                "ctsPolicy": cts,
                "routeTimingExpansion": cts,
                "pinPlanSha256": ("f" if positive else "1") * 64,
            },
            "facts": {
                "dcAdoptedCandidateCount": 21,
                "dcAdoptedInstanceCount": 307,
                "routeCustomInstanceCount": custom_count,
                "foundrySetupWnsNs": -0.020 if positive else -0.057,
                "generatedSetupWnsNs": generated_wns,
                "fmaxImprovementPct": 0.19 if positive else -0.17,
                "comparisonValid": True,
            },
            "evidence": [locator(kind, sha) for kind, sha in evidence_hashes.items()],
            "retainedIndex": {
                "path": f".hima-tmp/{trial_id}.json",
                "sha256": "9" * 64,
                "bytes": 10,
                "storage": "local-private-retained",
                "committed": False,
            },
        }

    document: dict[str, object] = {
        "schema": "hima.library-richness.calibration-corpus/1",
        "corpusId": "aes-tsmc28-47cell-commercial-v1",
        "frozenAt": "2026-09-15",
        "handling": {"rawPayloadsCommitted": False, "siteDeletionAllowed": False},
        "design": {"top": "aes_cipher_top", "rtl": rtl},
        "constraints": {
            "source": {
                "path": "/site/a.sdc",
                "sha256": "2" * 64,
                "storage": "site-only",
                "committed": False,
            },
            "equivalentSource": {
                "path": "/site/b.sdc",
                "sha256": "2" * 64,
                "storage": "site-only",
                "committed": False,
            },
            "summary": {
                "clockName": "clk",
                "clockPeriodNs": 0.5,
                "dcUncertaintyNs": 0.25,
                "pathGroups": {"reg2reg": {"weight": 10}},
            },
        },
        "libraries": {
            "foundryLiberty": {
                "path": "/site/f.lib",
                "sha256": "3" * 64,
                "storage": "site-only",
                "committed": False,
            },
            "foundryDb": {
                "path": "/site/f.db",
                "sha256": "4" * 64,
                "storage": "site-only",
                "committed": False,
            },
            "predicted47CellLiberty": {
                "path": "/site/c.lib",
                "sha256": "5" * 64,
                "storage": "site-only",
                "committed": False,
                "cellCount": 47,
            },
        },
        "sharedIdentity": shared,
        "trials": [
            trial("first-clean-low-gain", 0.125, "legacy", -0.019, 250, True),
            trial("corrected-pressure-negative", 0.175, "dcck", -0.058, 222, False),
        ],
        "knownGaps": [{"id": "synthetic", "impact": "unit test"}],
    }
    document["corpusIdentitySha256"] = canonical_identity(document)
    return document


def _commercial() -> dict[str, object]:
    rows = [
        {
            "offered_masters": ["CUSTOM_A"],
            "adopted_masters": [{"master": "CUSTOM_A", "instance_count": 9}],
        },
        {
            "offered_masters": ["CUSTOM_B"],
            "adopted_masters": [{"master": "CUSTOM_B", "instance_count": 4}],
        },
        {"offered_masters": ["CUSTOM_C"], "adopted_masters": []},
        {
            "offered_masters": ["CUSTOM_D"],
            "adopted_masters": [{"master": "CUSTOM_D", "instance_count": 4}],
        },
    ]
    return {
        "schema": "custom-cell-fmax-stage/1",
        "status": "passed",
        "stage": "adoption",
        "facts": {"candidate_rows": rows},
    }


def _mapping() -> dict[str, object]:
    adoption = lambda census: {"cell_census": census}
    return {
        "schema": "lfr-proxy-mapping-result/1",
        "status": "succeeded",
        "request_sha256": "8" * 64,
        "script_audit": {
            "constraint_drift": False,
            "profile_drift": False,
            "rtl_drift": False,
            "top_drift": False,
        },
        "arms": {
            "reference": {"status": "succeeded", "adoption": adoption({"BASE": 3})},
            "augmented": {
                "status": "succeeded",
                "adoption": adoption(
                    {"BASE": 3, "CUSTOM_A": 10, "CUSTOM_B": 0, "CUSTOM_C": 7, "CUSTOM_D": 7}
                ),
            },
        },
    }


def _timing_tables(delay: float) -> str:
    return f'''cell_rise (delay_template) {{ values ("{delay}, {delay}", "{delay}, {delay}"); }}
cell_fall (delay_template) {{ values ("{delay}, {delay}", "{delay}, {delay}"); }}
rise_transition (delay_template) {{ values ("0.01, 0.01", "0.01, 0.01"); }}
fall_transition (delay_template) {{ values ("0.01, 0.01", "0.01, 0.01"); }}'''


def _library(name: str, include_custom: bool) -> str:
    custom = f'''cell (CUSTOM_A) {{
    pin (A) {{ direction : input; capacitance : 0.01; }}
    pin (Y) {{ direction : output; function : "A"; timing () {{
      related_pin : "A"; timing_sense : positive_unate; {_timing_tables(0.10)}
    }} }}
  }}''' if include_custom else ""
    return f'''library ({name}) {{
  time_unit : "1ns";
  capacitive_load_unit (1, pf);
  lu_table_template (delay_template) {{
    variable_1 : input_net_transition;
    variable_2 : total_output_net_capacitance;
    index_1 ("0.01, 0.10");
    index_2 ("0.01, 0.10");
  }}
  cell (DFF) {{
    ff (IQ, IQN) {{ next_state : "D"; clocked_on : "CK"; }}
    pin (D) {{ direction : input; capacitance : 0.01; }}
    pin (CK) {{ direction : input; capacitance : 0.01; }}
    pin (Q) {{ direction : output; function : "IQ"; }}
  }}
  cell (BUF) {{
    pin (A) {{ direction : input; capacitance : 0.01; }}
    pin (Y) {{ direction : output; function : "A"; timing () {{
      related_pin : "A"; timing_sense : positive_unate; {_timing_tables(0.20)}
    }} }}
  }}
  {custom}
}}'''


def _production_round_result(root: Path) -> dict[str, object]:
    """Call the production evaluate_round and return its exact result shape."""

    root.mkdir(parents=True, exist_ok=True)
    rtl = root / "design.sv"
    reference_lib = root / "reference.lib"
    augmented_lib = root / "augmented.lib"
    reference_netlist = root / "reference.v"
    augmented_netlist = root / "augmented.v"
    rtl.write_text("module top(input clk,input seed,output observed); endmodule\n")
    reference_lib.write_text(_library("reference", False))
    augmented_lib.write_text(_library("augmented", True))
    reference_netlist.write_text(
        "module top(input clk,input seed,output observed);\n"
        "  DFF launch (.D(seed), .CK(clk), .Q(q0));\n"
        "  BUF logic0 (.A(q0), .Y(n0));\n"
        "  DFF capture (.D(n0), .CK(clk), .Q(observed));\n"
        "endmodule\n"
    )
    augmented_netlist.write_text(
        "module top(input clk,input seed,output observed);\n"
        "  DFF launch (.D(seed), .CK(clk), .Q(q0));\n"
        "  CUSTOM_A logic0 (.A(q0), .Y(n0));\n"
        "  DFF capture (.D(n0), .CK(clk), .Q(observed));\n"
        "endmodule\n"
    )

    def sha(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def adoption(census: dict[str, int]) -> dict[str, object]:
        return {
            "cell_census": census,
            "cells": [],
            "unknown_cells": [],
            "function_class_census": {},
            "pin_interface_census": {},
            "drive_variant_census": {},
        }

    def arm(name: str, netlist: Path, census: dict[str, int]) -> dict[str, object]:
        return {
            "arm": name,
            "status": "succeeded",
            "return_code": 0,
            "adoption": adoption(census),
            "artifacts": [
                {
                    "role": "mapped_netlist",
                    "path": str(netlist),
                    "sha256": sha(netlist),
                    "bytes": netlist.stat().st_size,
                }
            ],
        }

    request_identity = "8" * 64
    mapping_result = {
        "schema": "lfr-proxy-mapping-result/1",
        "status": "succeeded",
        "request_sha256": request_identity,
        "script_audit": {
            "constraint_drift": False,
            "profile_drift": False,
            "rtl_drift": False,
            "top_drift": False,
            "invariant_plan_sha256": "7" * 64,
        },
        "inputs": {
            "libraries": {
                "reference": {"files": [{"path": str(reference_lib), "sha256": sha(reference_lib)}]},
                "augmented": {"files": [{"path": str(augmented_lib), "sha256": sha(augmented_lib)}]},
            }
        },
        "tool_identity": {
            "yosys": {"sha256": "6" * 64},
            "abc": {"sha256": "5" * 64},
        },
        "arms": {
            "reference": arm("reference", reference_netlist, {"DFF": 2, "BUF": 1}),
            "augmented": arm("augmented", augmented_netlist, {"DFF": 2, "CUSTOM_A": 1}),
        },
    }
    mapping_request = {
        "schema": "lfr-proxy-mapping/1",
        "top": "top",
        "rtl_files": [str(rtl)],
        "output_dir": str(root / "mapping"),
        "libraries": {
            "reference": {"mapping": str(reference_lib), "support": []},
            "augmented": {"mapping": str(augmented_lib), "support": []},
        },
        "constraints": {"sdc_files": []},
    }
    request = {
        "schema": "lfr-round/3",
        "mapping": mapping_request,
        "input_hashes": {
            str(rtl): sha(rtl),
            str(reference_lib): sha(reference_lib),
            str(augmented_lib): sha(augmented_lib),
        },
        "candidate_cells": ["CUSTOM_A"],
        "timing": {"clock_period_ps": 150, "uncertainty_ps": 0},
        "scenarios": {
            "optimistic": {"initial_slew_ps": 8, "wire_capacitance_in_library_units": 0},
            "nominal": {"initial_slew_ps": 10, "wire_capacitance_in_library_units": 0},
            "conservative": {"initial_slew_ps": 20, "wire_capacitance_in_library_units": 0.01},
        },
        "metric_policy": {
            "objectives": [
                {"metric": "F0.candidate_adoption_fraction", "direction": "maximize"},
                {"metric": "F2.mapped_instance_count", "direction": "minimize"},
                {"metric": "F3.worst_delay_indicator_ps", "direction": "minimize"},
                {"metric": "F3.negative_slack_mass_indicator_ps", "direction": "minimize"},
            ],
            "required_metrics": [
                "F0.candidate_adoption_fraction",
                "F2.mapped_instance_count",
                "F3.worst_delay_indicator_ps",
                "F3.negative_slack_mass_indicator_ps",
            ],
        },
        "budgets": {"max_candidate_cells": 50, "max_augmented_mapped_instances": 10},
    }
    with patch.object(
        PRODUCTION_ROUND,
        "map_reference_and_augmented",
        return_value=mapping_result,
    ):
        result = PRODUCTION_ROUND.evaluate_round(request)
    if result.get("status") != "succeeded":
        raise AssertionError(result)
    return result


class CalibrationEvaluatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.commercial_path = self.root / "commercial.json"
        self.commercial_sha = _write(self.commercial_path, _commercial())
        self.corpus_path = self.root / "corpus.json"
        _write(self.corpus_path, _corpus(self.commercial_sha))
        self.mapping_path = self.root / "mapping.json"
        self.mapping_sha = _write(self.mapping_path, _mapping())

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_mapping_metrics_use_exact_custom_masters_and_tie_aware_ranks(self) -> None:
        report = build_calibration_report(
            corpus_path=self.corpus_path,
            mapping_path=self.mapping_path,
            mapping_sha256=self.mapping_sha,
            commercial_adoption_path=self.commercial_path,
            top_ks=(2,),
        )
        mapping = report["f2_to_f4_adoption_relationship"]
        observations = mapping["relationship_observations"]
        self.assertEqual(report["status"], "passed")
        self.assertFalse(report["universal_thresholds_applied"])
        self.assertFalse(report["assessment_complete"])
        self.assertFalse(mapping["optimization_target"])
        self.assertEqual(observations["adoption_overlap"]["matched_adopted_count"], 2)
        self.assertAlmostEqual(observations["adoption_overlap"]["precision"], 2 / 3)
        self.assertAlmostEqual(observations["adoption_overlap"]["recall"], 2 / 3)
        self.assertIsNotNone(observations["instance_count_rank_correlation"]["rho"])
        overlap = observations["top_k_overlap"][0]
        self.assertEqual(overlap["proxy_set_size"], 3)  # tie at proxy's second rank
        self.assertEqual(overlap["commercial_set_size"], 3)  # tie at commercial's second rank
        self.assertEqual(report["available_metric_layers"], ["F2"])
        self.assertEqual(report["f0_f3_to_f4_qor_relationship"]["status"], "not_evaluated")

    def test_rank_correlation_returns_one_with_matching_ties(self) -> None:
        result = _spearman_with_ties(
            {"A": 5, "B": 2, "C": 2, "D": 0},
            {"A": 9, "B": 3, "C": 3, "D": 0},
        )
        self.assertAlmostEqual(result["rho"], 1.0)

    def test_production_round_result_is_consumed_with_system_owned_directions(self) -> None:
        production = _production_round_result(self.root / "production")
        self.assertEqual(production["schema"], "lfr-round-evaluation/3")
        self.assertIn("changes", production["scenarios"]["nominal"])

        production_mapping_path = self.root / "production-mapping.json"
        production_mapping_sha = _write(production_mapping_path, production["mapping"])
        round_path = self.root / "round.json"
        round_sha = _write(round_path, production)
        report = build_calibration_report(
            corpus_path=self.corpus_path,
            mapping_path=production_mapping_path,
            mapping_sha256=production_mapping_sha,
            commercial_adoption_path=self.commercial_path,
            round_evaluation_path=round_path,
            round_evaluation_sha256=round_sha,
        )
        relationship = report["f0_f3_to_f4_qor_relationship"]
        self.assertTrue(report["assessment_complete"])
        self.assertFalse(relationship["conditions_homogeneous"])
        self.assertEqual(relationship["relationship_row_count"], 6)
        self.assertEqual(report["available_metric_layers"], ["F0", "F2", "F3"])
        self.assertEqual(report["round_reader"]["mode"], "production-layered-scenario-interface")
        self.assertEqual(
            report["relation_evidence_coverage"]["F2_to_F4"],
            "observed-scenario-by-trial",
        )
        rows = relationship["rows"]
        first_changes = {item["metric"]: item for item in rows[0]["open_source_metric_changes"]}
        delay = first_changes["F3.worst_delay_indicator_ps"]
        self.assertEqual(delay["canonical_direction"], "minimize")
        self.assertLess(delay["raw_augmented_minus_reference"], 0)
        self.assertGreater(delay["improvement_positive_change"], 0)
        self.assertEqual(delay["wns_sign_relationship"], "same-direction")
        self.assertEqual(delay["fmax_sign_relationship"], "same-direction")
        adoption = first_changes["F0.candidate_adoption_fraction"]
        self.assertEqual(adoption["canonical_direction"], "maximize")
        self.assertGreater(adoption["raw_augmented_minus_reference"], 0)
        self.assertGreater(adoption["improvement_positive_change"], 0)
        descriptive = first_changes["F0.function_class_count"]
        self.assertEqual(descriptive["canonical_direction"], "descriptive-only")
        self.assertIsNone(descriptive["improvement_positive_change"])
        self.assertEqual(descriptive["wns_sign_relationship"], "unavailable")
        second_trial = rows[3]
        second_delay = {
            item["metric"]: item for item in second_trial["open_source_metric_changes"]
        }["F3.worst_delay_indicator_ps"]
        self.assertEqual(second_delay["wns_sign_relationship"], "opposite-direction")
        self.assertEqual(second_delay["fmax_sign_relationship"], "opposite-direction")

    def test_legacy_round_reader_translates_old_prediction_names_into_indicators(self) -> None:
        round_path = self.root / "legacy-round.json"
        round_sha = _write(
            round_path,
            {
                "schema": "lfr-round-evaluation/1",
                "status": "succeeded",
                "mapping": {"request_sha256": "8" * 64},
                "scenarios": {
                    "nominal": {
                        "status": "succeeded",
                        "assumptions": {},
                        "predicted_delta_ps": 6.0,
                        "worst_slack_gain_ps": 6.0,
                        "negative_slack_mass_reduction_ps": 9.0,
                    }
                },
            },
        )
        report = build_calibration_report(
            corpus_path=self.corpus_path,
            mapping_path=self.mapping_path,
            mapping_sha256=self.mapping_sha,
            commercial_adoption_path=self.commercial_path,
            round_evaluation_path=round_path,
            round_evaluation_sha256=round_sha,
        )
        self.assertEqual(report["round_reader"]["mode"], "legacy-lfr-round-evaluation-v1-adapter")
        self.assertEqual(
            report["relation_evidence_coverage"]["F2_to_F4"],
            "observed-exact-master-adoption-only",
        )
        row = report["f0_f3_to_f4_qor_relationship"]["rows"][0]
        changes = {item["metric"]: item for item in row["open_source_metric_changes"]}
        self.assertEqual(
            changes["F3.worst_delay_indicator_ps"]["improvement_positive_change"],
            6.0,
        )
        self.assertEqual(
            changes["F3.worst_delay_indicator_ps"]["raw_augmented_minus_reference"],
            -6.0,
        )

    def test_hash_mismatch_is_a_root_cause_not_a_relationship_result(self) -> None:
        with self.assertRaisesRegex(CalibrationError, "mapping result SHA-256 mismatch"):
            build_calibration_report(
                corpus_path=self.corpus_path,
                mapping_path=self.mapping_path,
                mapping_sha256="0" * 64,
                commercial_adoption_path=self.commercial_path,
            )

    def test_commercial_record_must_match_a_manifest_adoption_identity(self) -> None:
        unbound_commercial = self.root / "unbound-commercial.json"
        value = _commercial()
        value["facts"]["candidate_rows"][0]["adopted_masters"][0]["instance_count"] = 10
        _write(unbound_commercial, value)
        with self.assertRaisesRegex(CalibrationError, "does not match any corpus"):
            build_calibration_report(
                corpus_path=self.corpus_path,
                mapping_path=self.mapping_path,
                mapping_sha256=self.mapping_sha,
                commercial_adoption_path=unbound_commercial,
            )

    def test_cli_emits_failed_report_on_unbound_round(self) -> None:
        round_path = self.root / "round.json"
        _write(
            round_path,
            {
                "schema": "lfr-round-evaluation/1",
                "status": "succeeded",
                "mapping": {"request_sha256": "7" * 64},
                "objective": {"nominal_predicted_delta_ps": 6.0},
            },
        )
        output = self.root / "report.json"
        return_code = main(
            [
                "--corpus",
                str(self.corpus_path),
                "--mapping",
                str(self.mapping_path),
                "--mapping-sha256",
                self.mapping_sha,
                "--commercial-adoption",
                str(self.commercial_path),
                "--round-evaluation",
                str(round_path),
                "--round-evaluation-sha256",
                hashlib.sha256(round_path.read_bytes()).hexdigest(),
                "--output",
                str(output),
            ]
        )
        report = json.loads(output.read_text())
        self.assertEqual(return_code, 2)
        self.assertEqual(report["status"], "failed")
        self.assertIn("different mapping request", report["root_causes"][0])


if __name__ == "__main__":
    unittest.main()
