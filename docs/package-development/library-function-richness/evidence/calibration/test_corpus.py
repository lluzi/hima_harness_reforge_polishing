#!/usr/bin/env python3

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from validate_corpus import (
    CorpusError,
    canonical_identity,
    load_manifest,
    validate_manifest,
    verify_local_retained,
)


HERE = Path(__file__).resolve().parent


class CalibrationCorpusTest(unittest.TestCase):
    def setUp(self) -> None:
        self.document = load_manifest(HERE / "corpus.v1.json")

    def test_frozen_manifest_is_valid(self) -> None:
        validate_manifest(self.document)

    def test_manifest_contains_identities_without_raw_payloads(self) -> None:
        encoded = json.dumps(self.document, sort_keys=True)
        self.assertFalse(self.document["handling"]["rawPayloadsCommitted"])
        self.assertNotIn("BEGIN LIBRARY", encoded)
        self.assertNotIn("module aes_cipher_top", encoded)
        for trial in self.document["trials"]:
            self.assertTrue(all(item["committed"] is False for item in trial["evidence"]))

    def test_two_trials_cannot_be_collapsed_into_one_condition(self) -> None:
        by_id = {trial["id"]: trial for trial in self.document["trials"]}
        first = by_id["first-clean-low-gain"]["conditions"]
        corrected = by_id["corrected-pressure-negative"]["conditions"]
        self.assertEqual(first["routeUncertaintyNs"], 0.125)
        self.assertEqual(corrected["routeUncertaintyNs"], 0.175)
        self.assertNotEqual(first["ctsPolicy"], corrected["ctsPolicy"])

    def test_tampered_fact_invalidates_self_hash(self) -> None:
        damaged = copy.deepcopy(self.document)
        damaged["trials"][0]["facts"]["routeCustomInstanceCount"] = 251
        with self.assertRaisesRegex(CorpusError, "corpus identity mismatch"):
            validate_manifest(damaged)

    def test_missing_commercial_evidence_is_rejected(self) -> None:
        damaged = copy.deepcopy(self.document)
        damaged["trials"][0]["evidence"] = damaged["trials"][0]["evidence"][:-1]
        damaged["corpusIdentitySha256"] = canonical_identity(damaged)
        with self.assertRaisesRegex(CorpusError, "evidence kinds"):
            validate_manifest(damaged)

    def test_shared_identity_is_derived_from_constraints_and_libraries(self) -> None:
        mutations = (
            ("constraints source", ("constraints", "source", "sha256"), "shared constraints identity"),
            ("constraints equivalent", ("constraints", "equivalentSource", "sha256"), "shared constraints identity"),
            ("foundry Liberty", ("libraries", "foundryLiberty", "sha256"), "shared foundry Liberty identity"),
            ("foundry DB", ("libraries", "foundryDb", "sha256"), "shared foundry DB identity"),
            ("predicted Liberty", ("libraries", "predicted47CellLiberty", "sha256"), "shared predicted Liberty identity"),
        )
        for label, path, message in mutations:
            with self.subTest(label=label):
                damaged = copy.deepcopy(self.document)
                target = damaged
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = "f" * 64
                damaged["corpusIdentitySha256"] = canonical_identity(damaged)
                with self.assertRaisesRegex(CorpusError, message):
                    validate_manifest(damaged)

    def test_local_verifier_fails_closed_when_retained_index_is_absent(self) -> None:
        with self.assertRaisesRegex(CorpusError, "retained index is unavailable"):
            verify_local_retained(self.document, Path("/definitely-not-the-repository"))


if __name__ == "__main__":
    unittest.main()
