import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402
from tests import fixtures  # noqa: E402
from tests.test_cli_stage import BASELINE, GOAL, run_cli, write_readiness_and_start  # noqa: E402

FLOW = Path(__file__).resolve().parents[1]
READER = FLOW.parent / "tools" / "read-mage.py"
READERS_DIR = FLOW.parent / "readers"
STANDIN = FLOW / "tests" / "standin_mage.py"


def reader_emits():
    lines = (READERS_DIR / "mage-script-candidate.yml").read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == "emits:")
    out = []
    for l in lines[start + 1:]:
        if not l.strip().startswith("- "): break
        out.append(l.strip()[2:])
    return out


class ReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.workspace = self.root / "ws"; self.workspace.mkdir(); os.symlink(FLOW, self.workspace / "flow")
        exe = [sys.executable, str(STANDIN)]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=exe)
        caps = fixtures.make_site_capabilities(self.tmp.name, exe)
        write_readiness_and_start(self.workspace, self.case, caps, GOAL)
        (self.workspace / "placement" / "round-01").mkdir(parents=True)
        self.report = self.workspace / "state" / "round" / "script-candidate.json"
        self.out = self.root / "reader-out.json"

    def tearDown(self):
        self.tmp.cleanup()

    def _deliver(self, text=BASELINE, env=None):
        script = self.workspace / "placement" / "round-01" / "script.tcl"; script.write_text(text, encoding="utf-8")
        stage_dir = Path("placement/round-01/stage-1")
        run_cli(["mage-stage", self.workspace, "--round", 1, "--script", script, "--out-dir", stage_dir], env=env)
        summary = json.loads((self.workspace / stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        journal = self.workspace / "placement" / "round-01" / "journal-entry.json"
        journal.write_text(json.dumps(fixtures.journal_entry(1, summary["scriptSha256"])), encoding="utf-8")
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", self.report])
        return self.workspace / stage_dir

    def _read(self, expect=0):
        r = subprocess.run([sys.executable, str(READER), "script-candidate", str(self.report), str(self.out), str(self.workspace)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, expect, r.stderr)
        if expect == 0:
            return {v["type"]: v for v in json.loads(self.out.read_text(encoding="utf-8"))["values"]}
        self.assertFalse(self.out.exists(), "OUT must stay unwritten on refusal")
        return json.loads(r.stderr.strip().splitlines()[-1])

    def test_emits_declared_set_in_order_with_known_values(self):
        self._deliver()
        self._read()
        values = json.loads(self.out.read_text(encoding="utf-8"))["values"]
        self.assertEqual([v["type"] for v in values], reader_emits())
        by = {v["type"]: v["value"] for v in values}
        self.assertEqual(by["mage_candidate_error_count"], 0)
        self.assertEqual(by["mage_dropped_ordinary_count"], 1); self.assertEqual(by["mage_dropped_ordinary_length_um"], 900.0)
        self.assertEqual(by["mage_priority_move_max_um"], 0.0); self.assertEqual(by["mage_priority_moved_count"], 0)
        self.assertEqual(by["mage_order_deviation_max_lr"], -1)   # the synthetic case has no LR side: the customer sentinel -1
        self.assertEqual(by["mage_order_deviation_max_tb"], 0); self.assertEqual(by["mage_native_violation_total"], 0)
        self.assertEqual(by["mage_target_over_limit_count"], 1)   # OVL_B starts 150 um off target

    def test_tampered_export_is_refused(self):
        stage_dir = self._deliver()
        export = stage_dir / "out" / "export.pla"
        export.write_text(export.read_text(encoding="utf-8").replace("\n", "\n", 1) + "# tamper\n", encoding="utf-8")
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")

    def test_stage_script_not_in_session_log_is_refused(self):
        stage_dir = self._deliver()
        log = self.workspace / "placement" / "round-01" / "session.jsonl"
        entry = json.loads(log.read_text(encoding="utf-8").splitlines()[0]); entry["stageSha256"] = "0" * 64
        log.write_text(json.dumps(entry) + "\n", encoding="utf-8")
        doc = json.loads(self.report.read_text(encoding="utf-8"))
        doc["files"]["sessionLog"]["sha256"] = core.file_sha256(log)
        body = {k: v for k, v in doc.items() if k != "id"}; doc["id"] = core.digest(body)
        self.report.write_text(json.dumps(doc), encoding="utf-8")
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")

    def test_missing_verify_file_reads_unknown_not_error(self):
        env = dict(os.environ); env["MAGE_STANDIN_VERIFY_FAIL"] = "SPACE"
        self._deliver(env=env)
        values = self._read()
        self.assertIsNone(values["mage_native_space_rows"]["value"]); self.assertIn("unknownReason", values["mage_native_space_rows"])
        self.assertIsNone(values["mage_native_violation_total"]["value"]); self.assertEqual(values["mage_candidate_error_count"]["value"], 0)

    def test_blocked_candidate_reads_all_unknown_without_error(self):
        env = dict(os.environ); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        self._deliver(env=env)
        values = self._read()
        self.assertEqual(values["mage_candidate_error_count"]["value"], 0)
        self.assertTrue(all(values[t]["value"] is None for t in values if t != "mage_candidate_error_count"))

    def test_deleted_priority_fit_in_export_is_refused(self):
        stage_dir = self._deliver()
        export = stage_dir / "out" / "export.pla"
        lines = export.read_text(encoding="utf-8").splitlines()
        kept = [l for l in lines if "AL_X.AL_X_1" not in l]
        export.write_text("\n".join(kept) + "\n", encoding="utf-8")
        doc = json.loads(self.report.read_text(encoding="utf-8"))
        doc["files"]["export"]["sha256"] = core.file_sha256(export)
        body = {k: v for k, v in doc.items() if k != "id"}; doc["id"] = core.digest(body)
        self.report.write_text(json.dumps(doc), encoding="utf-8")
        self.assertIn(self._read(expect=3)["code"], ("identity-mismatch", "inventory"))

    def test_missing_journal_file_is_refused(self):
        self._deliver()
        (self.workspace / "placement" / "round-01" / "journal-entry.json").unlink()
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")

    def test_session_log_outside_round_prefix_is_refused(self):
        self._deliver()
        doc = json.loads(self.report.read_text(encoding="utf-8"))
        doc["files"]["sessionLog"]["path"] = "state/session.jsonl"
        body = {k: v for k, v in doc.items() if k != "id"}; doc["id"] = core.digest(body)
        self.report.write_text(json.dumps(doc), encoding="utf-8")
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")


if __name__ == "__main__":
    unittest.main()
