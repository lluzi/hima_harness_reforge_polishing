"""Focused negative tests for `tools/read-mage.py`, run as a subprocess
exactly as the Harness would invoke it (argv `<kind> <report> <out>
<workspace>`). Each test builds the smallest workspace state the handler
needs, tampers with exactly one thing, and asserts the Reader fails
closed: `mage_candidate_error_count`/`mage_review_error_count` becomes `1`
and every other declared fact in that call becomes `unknown`.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402

from tests import fixtures  # noqa: E402


FLOW_DIR = Path(__file__).resolve().parents[1]
CLI = FLOW_DIR / "mage_placement_cli.py"
READER = FLOW_DIR.parent / "tools" / "read-mage.py"
STANDIN = FLOW_DIR / "tests" / "standin_mage.py"


def _run(args, env=None):
    result = subprocess.run([sys.executable, str(CLI)] + [str(a) for a in args], capture_output=True, text=True, env=env)
    assert result.returncode == 0, f"{args} failed: {result.stderr}\n{result.stdout}"
    return result


def _run_reader(kind, report, out, workspace):
    result = subprocess.run(
        [sys.executable, str(READER), kind, str(report), str(out), str(workspace)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, f"reader failed: {result.stderr}\n{result.stdout}"
    return json.loads(Path(out).read_text(encoding="utf-8"))["values"]


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


def _assert_all_unknown_except(values, known_type):
    for value in values:
        if value["type"] == known_type:
            continue
        assert value["value"] is None, f"{value['type']} should be unknown, got {value['value']}"
        assert "unknownReason" in value


class ReaderNegativeTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        os.symlink(FLOW_DIR, self.workspace / "flow")

        self.case = fixtures.make_case(self.root, mage_executable=[sys.executable, str(STANDIN)])
        self.site_caps = fixtures.make_site_capabilities(self.root, [sys.executable, str(STANDIN)])

        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 1}
        task_input = _write_json(self.root / "prepare-input.json", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **goal,
        })
        task_output = self.root / "prepare-output.json"
        _run(["task-prepare-case", self.workspace, task_input, task_output])

        pla_path = self.root / "round1.pla"
        pla_path.write_text(Path(self.case["files"]["startState"]).read_text(encoding="utf-8"), encoding="utf-8")
        self.round_dir = self.workspace / "placement" / "round-01"
        env = dict(os.environ)
        env["MAGE_STANDIN_ROWS"] = "{}"
        _run([
            "mage-round", self.workspace, "--round", "1", "--pla", pla_path,
            "--role", "engineer", "--out-dir", self.round_dir,
        ], env=env)

        ledger_path = _write_json(self.root / "ledger.json", [])
        self.candidate_path = self.root / "candidate.json"
        _run([
            "candidate", self.workspace, "--round", "1", "--round-dir", self.round_dir,
            "--ledger", ledger_path, "--out", self.candidate_path,
        ])
        self.live_candidate_path = self.workspace / "state" / "round" / "placement-candidate.json"
        self.live_candidate_path.parent.mkdir(parents=True, exist_ok=True)
        self.live_candidate_path.write_text(self.candidate_path.read_text(encoding="utf-8"), encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_tampered_pla_is_refused(self):
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        pla_ref_path = Path(doc["files"]["pla"]["path"])
        full = self.workspace / pla_ref_path
        full.write_text(full.read_text(encoding="utf-8") + "\n# tampered\n", encoding="utf-8")

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out1.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 1)
        _assert_all_unknown_except(values, "mage_candidate_error_count")

    def test_missing_verify_file_marks_that_type_and_total_unknown_but_not_an_error(self):
        # The Engineer legitimately never reported an OVERLAP check this
        # round (e.g. a native tool that does not support it) -- the
        # candidate simply never names that type under `files.verify`.
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        doc["files"]["verify"].pop("OVERLAP", None)
        doc["id"] = core.digest({k: v for k, v in doc.items() if k != "id"})
        self.live_candidate_path.write_text(json.dumps(doc), encoding="utf-8")

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out2.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        total = next(v for v in values if v["type"] == "mage_native_violation_total")
        self.assertIsNone(total["value"])
        overlap = next(v for v in values if v["type"] == "mage_native_overlap_rows")
        self.assertIsNone(overlap["value"])
        space = next(v for v in values if v["type"] == "mage_native_space_rows")
        self.assertIsNotNone(space["value"])

    def test_unanswered_open_request_from_previous_round_is_reflected(self):
        request = {
            "schema": "mage.request/1", "id": "R-1", "fromFinding": "F-1", "consumer": "litho-pie",
            "snapshotSha256": doc_sha(self.live_candidate_path), "requestedOutcome": {
                "kind": "move", "targets": ["x"], "limitsUm": {}, "text": "test",
            }, "acceptableAlternatives": [], "strength": "hard",
        }
        previous_decision = core.read_artifact(self.workspace / "state" / "round-decision.json", "round-decision")
        body = {k: v for k, v in previous_decision.items() if k not in ("schema", "id")}
        body["openRequests"] = [request]
        core.write_artifact(self.workspace / "state" / "round-decision.json", core.stamp("round-decision", body))

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out3.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        open_count = next(v for v in values if v["type"] == "mage_open_request_count")
        self.assertEqual(open_count["value"], 1)

    def test_session_log_mutation_under_wrong_role_is_refused(self):
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        log_path = self.workspace / doc["files"]["sessionLog"]["path"]
        with open(log_path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"roundDir": "x", "role": "metrology", "scriptSha256": "a" * 64,
                                      "mutating": True, "returncode": 0, "startedAt": "t", "endedAt": "t"}) + "\n")

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out4.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 1)
        _assert_all_unknown_except(values, "mage_candidate_error_count")


    def test_session_log_outside_round_prefix_is_refused(self):
        """Even a genuine, correctly-hashed session log is refused when its
        declared path sits outside this round's own `placement/round-NN/`
        artifact prefix: a resident's support files only reach the
        Campaign workspace under their own `artifactPrefix`, so a path
        outside it could never really have been published this way."""
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        real_path = self.workspace / doc["files"]["sessionLog"]["path"]
        outside_path = self.workspace / "state" / "escaped-session.jsonl"
        outside_path.parent.mkdir(parents=True, exist_ok=True)
        outside_path.write_text(real_path.read_text(encoding="utf-8"), encoding="utf-8")
        doc["files"]["sessionLog"] = {"path": "state/escaped-session.jsonl", "sha256": core.file_sha256(outside_path)}
        doc["id"] = core.digest({k: v for k, v in doc.items() if k != "id"})
        self.live_candidate_path.write_text(json.dumps(doc), encoding="utf-8")

        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out5.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 1)
        _assert_all_unknown_except(values, "mage_candidate_error_count")

    def test_session_log_inside_round_prefix_is_accepted(self):
        """The ordinary, untampered case: the session log sits at
        `placement/round-NN/session.jsonl`, inside the Engineer's own
        artifact prefix, and the Reader accepts it without error."""
        values = _run_reader("placement-candidate", self.live_candidate_path, self.root / "out6.json", self.workspace)
        error = next(v for v in values if v["type"] == "mage_candidate_error_count")
        self.assertEqual(error["value"], 0)
        doc = json.loads(self.live_candidate_path.read_text(encoding="utf-8"))
        self.assertTrue(doc["files"]["sessionLog"]["path"].startswith("placement/round-01/"))


def doc_sha(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))["snapshotSha256"]


if __name__ == "__main__":
    unittest.main()
