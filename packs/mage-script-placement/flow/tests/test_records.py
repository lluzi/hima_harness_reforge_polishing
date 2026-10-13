import sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, records  # noqa: E402
from tests import fixtures  # noqa: E402


class RecordSchemaTest(unittest.TestCase):
    def test_journal_entry_valid_and_invalid(self):
        entry = fixtures.journal_entry(1, "a" * 64)
        self.assertEqual(records.validate_record("journal-entry", entry), [])
        bad = dict(entry); bad["stages"] = []
        self.assertTrue(records.validate_record("journal-entry", bad))
        bad2 = dict(entry); bad2["hypothesis"] = ""
        self.assertTrue(records.validate_record("journal-entry", bad2))

    def test_method_journal_digest_id(self):
        doc = core.stamp("method-journal", {"entries": [fixtures.journal_entry(1, "b" * 64)], "bestRound": 1})
        self.assertEqual(records.validate_record("method-journal", doc), [])
        doc["bestRound"] = 2
        self.assertIn("digest", "".join(records.validate_record("method-journal", doc)))

    def test_script_candidate_requires_journal_and_session_log(self):
        ref = {"path": "placement/round-01/x", "sha256": "c" * 64}
        body = {
            "identity": {"taskId": "t", "runId": "r", "executionId": "e", "nodeId": "n", "round": 1},
            "startSnapshotSha256": "s" * 64, "snapshotSha256": "s" * 64, "buildBanner": "",
            "files": {"script": ref, "stageScript": ref, "sessionLog": ref, "journal": ref, "verify": {}, "snapshots": []},
            "metrics": {}, "remaining": [], "blocked": [], "unknown": [], "outcome": "blocked",
            "stopReason": "x", "reproduction": {"stageDir": "placement/round-01/stage-1", "script": "script.tcl", "stageScript": "stage.tcl"},
        }
        self.assertEqual(records.validate_record("script-candidate", core.stamp("script-candidate", body)), [])
        del body["files"]["journal"]
        self.assertTrue(records.validate_record("script-candidate", core.stamp("script-candidate", body)))

    def test_round_decision_and_result_shapes(self):
        decision = core.stamp("round-decision", {
            "round": 1, "route": "continue", "nextRound": {"round": 2}, "best": None, "history": [],
            "stopReason": "", "goalMet": False, "rules": {}, "blockedRound": False,
        })
        self.assertEqual(records.validate_record("round-decision", decision), [])
        result = core.stamp("script-result", {
            "best": None, "rounds": [], "journal": {"path": "state/method-journal.json", "sha256": "d" * 64},
            "metrics": {}, "incumbent": {}, "outcome": "blocked", "stopReason": "",
        })
        self.assertEqual(records.validate_record("script-result", result), [])

    def test_stage_summary_and_report_minimal(self):
        summary = core.stamp("stage-summary", {
            "round": 1, "stage": 1, "role": "engineer", "stageDir": "placement/round-01/stage-1",
            "scriptTcl": "a", "scriptSha256": "a" * 64, "stageTcl": "b", "stageSha256": "b" * 64,
            "returncode": 0, "timedOut": False, "completed": True, "lastBoundary": "filled", "stageError": None,
            "exportPla": "e", "exportSha256": "e" * 64, "summary": "s", "stdout": "o", "stdoutSha256": "o" * 64,
            "verifyFiles": {}, "snapshots": [], "checks": {}, "startedAt": "t", "endedAt": "t",
        })
        self.assertEqual(records.validate_record("stage-summary", summary), [])
        report = core.stamp("stage-report", {"stageDir": "placement/round-01/stage-1", "rows": []})
        self.assertEqual(records.validate_record("stage-report", report), [])


class ManifestReferenceTest(unittest.TestCase):
    def test_fixture_manifest_carries_reference_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = fixtures.make_case(tmp)["manifest"]
            self.assertTrue(Path(manifest["referenceMethod"]["path"]).is_file())
            self.assertEqual(len(manifest["referenceFiles"]), 2)
            self.assertEqual(manifest["referenceNotes"][0]["title"], "synthetic probe notes")
            self.assertEqual(manifest["referenceOrdinaryDropLengthUm"], 450)
            self.assertEqual(records.validate_record("case-manifest", manifest), [])

    def test_fixture_without_reference_still_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = fixtures.make_case(tmp, reference=False)["manifest"]
            self.assertNotIn("referenceMethod", manifest)
            self.assertEqual(records.validate_record("case-manifest", manifest), [])


if __name__ == "__main__":
    unittest.main()
