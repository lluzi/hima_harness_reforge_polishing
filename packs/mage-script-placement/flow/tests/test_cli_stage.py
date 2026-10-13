import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla, rules, snapshot, targets  # noqa: E402
from tests import fixtures  # noqa: E402

FLOW = Path(__file__).resolve().parents[1]
CLI, STANDIN = FLOW / "mage_placement_cli.py", FLOW / "tests" / "standin_mage.py"
BASELINE = ("hima_open_build\nsource $hima_start_pla\nhima_snapshot priority-start\nhima_check\n"
            "g_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\nhima_snapshot filled\n")


def run_cli(args, env=None, expect=0):
    r = subprocess.run([sys.executable, str(CLI)] + [str(a) for a in args], capture_output=True, text=True, env=env)
    assert r.returncode == expect, f"{args}: rc={r.returncode}\n{r.stderr}\n{r.stdout}"
    return r


write_readiness_and_start = fixtures.write_workspace_state   # Task 3's helper; kept under this name for test_readers

GOAL = {"target_dropped_count": 0, "max_target_distance_um": 100, "max_order_deviation_lr": 2,
        "max_order_deviation_tb": 1, "max_priority_move_um": 200}


class CliStageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.workspace = self.root / "ws"; self.workspace.mkdir()
        os.symlink(FLOW, self.workspace / "flow")
        exe = [sys.executable, str(STANDIN)]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=exe)
        caps = fixtures.make_site_capabilities(self.tmp.name, exe)
        self.start = write_readiness_and_start(self.workspace, self.case, caps, GOAL)
        self.round_dir = Path("placement/round-01")
        (self.workspace / self.round_dir).mkdir(parents=True)
        self.env = dict(os.environ)

    def tearDown(self):
        self.tmp.cleanup()

    def _stage(self, k, text, env=None, expect=0):
        script = self.workspace / self.round_dir / f"script-{k}.tcl"; script.write_text(text, encoding="utf-8")
        run_cli(["mage-stage", self.workspace, "--round", 1, "--script", script, "--out-dir", self.round_dir / f"stage-{k}"],
                env=env or self.env, expect=expect)
        return self.workspace / self.round_dir / f"stage-{k}"

    def _journal(self, stage_dir):
        summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        path = self.workspace / self.round_dir / "journal-entry.json"
        path.write_text(json.dumps(fixtures.journal_entry(1, summary["scriptSha256"])), encoding="utf-8")
        return path

    def test_mage_stage_writes_summary_and_session_log(self):
        stage_dir = self._stage(1, BASELINE)
        summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["schema"], "mage.stage-summary/1"); self.assertTrue(summary["completed"])
        self.assertEqual(summary["round"], 1); self.assertEqual(summary["stage"], 1)
        self.assertTrue((self.workspace / self.round_dir / "session.jsonl").is_file())

    def test_mage_stage_refuses_a_stage_dir_outside_the_round(self):
        script = self.workspace / self.round_dir / "s.tcl"; script.write_text(BASELINE, encoding="utf-8")
        r = run_cli(["mage-stage", self.workspace, "--round", 1, "--script", script, "--out-dir", "placement/round-02/stage-1"], expect=3)
        self.assertIn("invalid-input", r.stderr)

    def test_stage_report_rows_cover_every_boundary_and_the_export(self):
        stage_dir = self._stage(1, BASELINE)
        out = self.workspace / self.round_dir / "report.json"
        run_cli(["stage-report", self.workspace, "--stage-dir", stage_dir, "--out", out])
        report = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual([r["boundary"] for r in report["rows"]], ["priority-start", "filled", "export"])
        self.assertEqual(report["rows"][0]["inGroupFits"], 3); self.assertEqual(report["rows"][0]["ordinaryFits"], 0)
        self.assertEqual(report["rows"][2]["drops"]["ordinary"]["count"], 1)
        self.assertEqual(report["rows"][0]["nativeRows"]["total"], 0)
        self.assertIsNone(report["rows"][1]["nativeRows"])
        self.assertEqual(report["rows"][2]["inventory"]["status"], "pass")
        self.assertEqual(report["rows"][0]["inventory"]["status"], "fail")   # priority-only: ordinary population 0

    def test_stage_report_names_the_invalidated_state(self):
        text = ("hima_open_build\nsource $hima_start_pla\n"
                "smSLFit {OVL_A} -setAutoRefine -arOffsetRangeX -1.000000 -arOffsetRangeY -1.000000\n"
                "hima_snapshot after-offsets\ng_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\n")
        stage_dir = self._stage(1, text)
        out = self.workspace / self.round_dir / "report.json"
        run_cli(["stage-report", self.workspace, "--stage-dir", stage_dir, "--out", out])
        row = json.loads(out.read_text(encoding="utf-8"))["rows"][0]
        self.assertEqual(row["groups"], 3); self.assertEqual(row["inGroupFits"], 0)

    def test_candidate_completed_carries_metrics_and_files(self):
        stage_dir = self._stage(1, BASELINE)
        journal = self._journal(stage_dir)
        out = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", out])
        doc = core.read_artifact(out, "script-candidate")
        self.assertEqual(doc["outcome"], "completed")
        self.assertEqual(doc["metrics"]["drops"]["ordinary"]["count"], 1)
        self.assertEqual(doc["metrics"]["displacement"]["priority"]["maxUm"], "0")
        # the synthetic case has no LR side, so maxLr is the empty-side sentinel -1
        self.assertEqual(doc["metrics"]["orderDeviation"]["maxTb"], 0)
        self.assertEqual(doc["metrics"]["orderDeviation"]["maxLr"], -1)
        self.assertEqual(len(doc["files"]["snapshots"]), 2)
        for key in ("script", "stageScript", "sessionLog", "journal", "export", "snapshot"):
            ref = doc["files"][key]
            self.assertEqual(core.file_sha256(self.workspace / ref["path"]), ref["sha256"], key)
            self.assertTrue(ref["path"].startswith("placement/round-01/"), key)
        self.assertTrue((stage_dir / "out" / "snapshot.json").is_file())

    def test_candidate_from_a_failed_stage_is_blocked_with_the_boundary(self):
        env = dict(self.env); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        stage_dir = self._stage(1, BASELINE, env=env)
        journal = self._journal(stage_dir)
        out = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", out])
        doc = core.read_artifact(out, "script-candidate")
        self.assertEqual(doc["outcome"], "blocked"); self.assertIn("priority-start", doc["stopReason"])
        self.assertNotIn("export", doc["files"]); self.assertEqual(doc["metrics"], {})

    def test_candidate_with_lost_inventory_is_blocked_not_an_improvement(self):
        text = "hima_open_build\nsource $hima_start_pla\nhima_snapshot priority-only\n"   # no fill: ordinary population 0
        stage_dir = self._stage(1, text)
        journal = self._journal(stage_dir)
        out = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", out])
        doc = core.read_artifact(out, "script-candidate")
        self.assertEqual(doc["outcome"], "blocked"); self.assertIn("ordinary population", doc["stopReason"])

    def test_candidate_refuses_an_invalid_journal(self):
        stage_dir = self._stage(1, BASELINE)
        bad = self.workspace / self.round_dir / "journal-entry.json"
        bad.write_text(json.dumps({"schema": "mage.journal-entry/1", "round": 1}), encoding="utf-8")
        r = run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", bad,
                     "--out", self.workspace / "state" / "round" / "script-candidate.json"], expect=3)
        self.assertIn("schema", r.stderr)

    def test_script_candidate_fallback_validates_never_fabricates(self):
        r = run_cli(["script-candidate", self.workspace, 0, 100, 2, 1, 200], expect=3)
        self.assertIn("engineering-required", r.stderr)


if __name__ == "__main__":
    unittest.main()
