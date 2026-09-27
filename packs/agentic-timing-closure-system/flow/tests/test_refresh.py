"""Tests for `atcs.refresh` (the append-only completed-physical-refresh ledger).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_refresh.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import refresh  # noqa: E402
from atcs import verification  # noqa: E402


def _sta_sources(**overrides):
    sources = {
        scenario: {"path": f"flow/records/sta/{scenario}.rpt", "sha256": f"{i:064x}"}
        for i, scenario in enumerate(verification.REQUIRED_SCENARIOS)
    }
    sources.update(overrides)
    return sources


class LoadLedgerTest(unittest.TestCase):
    def test_missing_file_returns_fresh_empty_stamped_ledger(self):
        ledger = refresh.load_ledger("/nonexistent/path/refresh-ledger.json")
        self.assertEqual(ledger["schema"], "atcs.refresh-ledger/1")
        self.assertEqual(ledger["entries"], [])
        without_id = dict(ledger)
        without_id.pop("id")
        self.assertEqual(ledger["id"], core.digest(without_id))

    def test_round_trips_through_record_refresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "refresh-ledger.json"
            refresh.record_refresh(path, "mc-1", "ds-1", _sta_sources())
            reloaded = refresh.load_ledger(path)
            self.assertEqual(len(reloaded["entries"]), 1)
            self.assertEqual(reloaded["entries"][0]["mergeCommitId"], "mc-1")


class RecordRefreshTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "refresh-ledger.json"

    def test_first_call_appends_one_entry(self):
        ledger = refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        self.assertEqual(ledger["entries"], [
            {"mergeCommitId": "mc-1", "designStateId": "ds-1", "sources": _sta_sources()},
        ])

    def test_two_different_merge_commits_both_recorded(self):
        refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        ledger = refresh.record_refresh(self.path, "mc-2", "ds-2", _sta_sources())
        self.assertEqual(len(ledger["entries"]), 2)
        self.assertEqual({e["mergeCommitId"] for e in ledger["entries"]}, {"mc-1", "mc-2"})

    def test_identical_resubmission_is_idempotent_no_op(self):
        first = refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        second = refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        self.assertEqual(first, second)
        self.assertEqual(len(second["entries"]), 1)

    def test_resubmission_with_different_design_state_id_is_refused(self):
        refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        with self.assertRaises(core.AtcsError) as ctx:
            refresh.record_refresh(self.path, "mc-1", "ds-DIFFERENT", _sta_sources())
        self.assertEqual(ctx.exception.code, "immutable-entry")
        # The ledger on disk must be untouched by the refused call.
        self.assertEqual(len(refresh.load_ledger(self.path)["entries"]), 1)

    def test_resubmission_with_different_sources_is_refused(self):
        refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        changed = _sta_sources()
        changed[verification.REQUIRED_SCENARIOS[0]] = {"path": "different.rpt", "sha256": "f" * 64}
        with self.assertRaises(core.AtcsError) as ctx:
            refresh.record_refresh(self.path, "mc-1", "ds-1", changed)
        self.assertEqual(ctx.exception.code, "immutable-entry")

    def test_missing_required_scenario_is_refused(self):
        incomplete = _sta_sources()
        del incomplete[verification.REQUIRED_SCENARIOS[0]]
        with self.assertRaises(core.AtcsError) as ctx:
            refresh.record_refresh(self.path, "mc-1", "ds-1", incomplete)
        self.assertEqual(ctx.exception.code, "missing-input")
        self.assertFalse(self.path.exists())

    def test_malformed_source_reference_is_refused(self):
        malformed = _sta_sources()
        malformed[verification.REQUIRED_SCENARIOS[0]] = "not-a-reference"
        with self.assertRaises(core.AtcsError):
            refresh.record_refresh(self.path, "mc-1", "ds-1", malformed)

    def test_empty_merge_commit_id_is_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            refresh.record_refresh(self.path, "", "ds-1", _sta_sources())
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_empty_design_state_id_is_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            refresh.record_refresh(self.path, "mc-1", "", _sta_sources())
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_ledger_id_reflects_full_entry_list(self):
        ledger = refresh.record_refresh(self.path, "mc-1", "ds-1", _sta_sources())
        without_id = dict(ledger)
        without_id.pop("id")
        self.assertEqual(ledger["id"], core.digest(without_id))


if __name__ == "__main__":
    unittest.main()
