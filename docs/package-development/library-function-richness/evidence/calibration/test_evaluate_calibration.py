#!/usr/bin/env python3

from __future__ import annotations

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from evaluate_calibration import (
    CalibrationError,
    _spearman_with_ties,
    build_calibration_report,
    main,
)
from validate_corpus import canonical_identity


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
        mapping = report["mapping_proxy"]
        self.assertEqual(report["status"], "passed")
        self.assertFalse(report["universal_thresholds_applied"])
        self.assertFalse(report["assessment_complete"])
        self.assertEqual(mapping["adoption"]["matched_adopted_count"], 2)
        self.assertAlmostEqual(mapping["adoption"]["precision"], 2 / 3)
        self.assertAlmostEqual(mapping["adoption"]["recall"], 2 / 3)
        self.assertIsNotNone(mapping["rank_correlation"]["rho"])
        overlap = mapping["top_k_overlap"][0]
        self.assertEqual(overlap["proxy_set_size"], 3)  # tie at proxy's second rank
        self.assertEqual(overlap["commercial_set_size"], 3)  # tie at commercial's second rank
        self.assertEqual(report["physical_correction"]["status"], "not_evaluated")

    def test_rank_correlation_returns_one_with_matching_ties(self) -> None:
        result = _spearman_with_ties(
            {"A": 5, "B": 2, "C": 2, "D": 0},
            {"A": 9, "B": 3, "C": 3, "D": 0},
        )
        self.assertAlmostEqual(result["rho"], 1.0)

    def test_round_evaluation_reports_condition_preserving_error_envelope(self) -> None:
        round_path = self.root / "round.json"
        round_sha = _write(
            round_path,
            {
                "schema": "lfr-round-evaluation/1",
                "status": "succeeded",
                "mapping": {"request_sha256": "8" * 64},
                "objective": {"nominal_predicted_delta_ps": 6.0},
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
        physical = report["physical_correction"]
        self.assertTrue(report["assessment_complete"])
        self.assertFalse(physical["conditions_homogeneous"])
        self.assertAlmostEqual(
            physical["observed_error_band_ps"]["conservative_absolute_bound"],
            7.0,
        )
        self.assertEqual(physical["sign_agreement"]["agreeing_trials"], 1)
        observed = [
            row["observed_matched_route_wns_delta_ps"]
            for row in physical["commercial_trials"]
        ]
        self.assertAlmostEqual(observed[0], 1.0)
        self.assertAlmostEqual(observed[1], -1.0)

    def test_hash_mismatch_is_a_root_cause_not_a_calibration_result(self) -> None:
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
