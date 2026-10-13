import json, os, sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402
from mage_placement.native import session  # noqa: E402
from tests import fixtures  # noqa: E402

STANDIN = str(Path(__file__).resolve().parent / "standin_mage.py")
BASELINE = (
    "hima_open_build\n"
    "source $hima_start_pla\n"
    "hima_snapshot priority-start\n"
    "hima_check\n"
    "g_params -set {smPFlow::s_ARTestConvergePrplaced false}\n"
    "smPFlow -autoRefine\n"
    "hima_snapshot filled\n"
)


class StageDriverTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        exe = [sys.executable, STANDIN]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=exe)
        caps = fixtures.make_site_capabilities(self.tmp.name, exe)
        self.workspace = self.root / "ws"
        (self.workspace / "placement" / "round-01").mkdir(parents=True)
        goal = {"target_dropped_count": 0, "max_target_distance_um": 100, "max_order_deviation_lr": 2,
                "max_order_deviation_tb": 1, "max_priority_move_um": 200}
        fixtures.write_workspace_state(self.workspace, self.case, caps, goal)   # the stand-in's fill reads state/start-snapshot.json
        self.log = self.workspace / "placement" / "round-01" / "session.jsonl"
        self.env = dict(os.environ)

    def tearDown(self):
        self.tmp.cleanup()

    def _session(self, env=None):
        m = self.case["manifest"]
        return session.MageSession(
            executable=[sys.executable, STANDIN], env=env or self.env, workdir=str(self.workspace),
            log_path=str(self.log),
            case={"frb": m["frb"]["path"], "caseDir": str(Path(m["frb"]["path"]).parent), "startPla": m["startState"]["path"]},
        )

    def _script(self, text, name="s.tcl"):
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def _stage(self, k=1):
        return str(self.workspace / "placement" / "round-01" / f"stage-{k}")

    def test_baseline_stage_completes_with_snapshots_checks_export_and_log(self):
        result = self._session().run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertTrue(result["completed"]); self.assertEqual(result["returncode"], 0)
        self.assertEqual([s["name"] for s in result["snapshots"]], ["priority-start", "filled"])
        self.assertTrue(Path(result["snapshots"][0]["pla"]).is_file())
        self.assertEqual(result["checks"]["1"]["OVERLAP"]["instances"], 0)
        self.assertEqual(sorted(result["verifyFiles"]), ["BOUNDARY", "OVERLAP", "SPACE"])
        doc = pla.read_pla(Path(result["exportPla"]).read_text(encoding="utf-8"), 10000)
        self.assertEqual(doc["units"], "dbu")
        self.assertTrue(any(f["base"] == "OVL_F" for f in doc["fits"]), "fill placed ordinary structures")
        self.assertEqual([d["base"] for d in doc["drops"]], ["KEY_V"])
        stage_text = Path(result["stageTcl"]).read_text(encoding="utf-8")
        self.assertIn(session.AGENT_BEGIN, stage_text); self.assertIn("MAGE_ROUND_END", stage_text)
        self.assertEqual(result["lastBoundary"], "filled"); self.assertIsNone(result["stageError"])
        lines = [json.loads(l) for l in self.log.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["stageSha256"], result["stageSha256"])
        self.assertEqual(lines[0]["exportSha256"], result["exportSha256"]); self.assertTrue(lines[0]["completed"])

    def test_forbidden_patterns_are_refused_before_any_write(self):
        for text in ("exit 0\n", "frbOpen ../x.frb\n", "puts MAGE_ROUND_END\n", "puts {MAGE_SNAPSHOT 1 x}\n",
                     "puts MAGE_CHECK_BEGIN\n", "proc hima_snapshot {n} {}\n", "rename hima_check old\n",
                     "# hima:agent-end\n"):
            with self.assertRaises(core.MageError) as caught:
                self._session().run_stage(self._stage(), self._script(text), "engineer")
            self.assertEqual(caught.exception.code, "experiment", text)
            self.assertFalse(Path(self._stage()).exists(), text)

    def test_non_engineer_role_is_refused(self):
        with self.assertRaises(core.MageError) as caught:
            self._session().run_stage(self._stage(), self._script(BASELINE), "reviewer")
        self.assertEqual(caught.exception.code, "writer")

    def test_existing_stage_is_refused(self):
        self._session().run_stage(self._stage(), self._script(BASELINE), "engineer")
        with self.assertRaises(core.MageError) as caught:
            self._session().run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertEqual(caught.exception.code, "stage-exists")

    def test_timeout_out_of_range_is_refused(self):
        with self.assertRaises(core.MageError) as caught:
            self._session().run_stage(self._stage(), self._script(BASELINE), "engineer", timeout_s=10)
        self.assertEqual(caught.exception.code, "timeout")

    def test_failure_after_a_boundary_is_blocked_with_the_boundary_named(self):
        env = dict(self.env); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        result = self._session(env).run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertFalse(result["completed"]); self.assertEqual(result["returncode"], 2)
        self.assertEqual(result["lastBoundary"], "priority-start")
        self.assertIn("MAGE_STAGE_ERROR", result["stageError"]); self.assertIsNone(result["exportPla"])
        self.assertEqual([s["name"] for s in result["snapshots"]], ["priority-start"])

    def test_converge_autorefine_fails_like_the_real_build(self):
        text = BASELINE.replace("s_ARTestConvergePrplaced false", "s_ARTestConvergePrplaced true")
        result = self._session().run_stage(self._stage(), self._script(text), "engineer")
        self.assertFalse(result["completed"]); self.assertIn("Failed at auto refinement", result["stageError"])

    def test_offset_range_edit_invalidates_fits_in_the_snapshot(self):
        text = ("hima_open_build\nsource $hima_start_pla\n"
                "smSLFit {OVL_A} -setAutoRefine -arOffsetRangeX -1.000000 -arOffsetRangeY -1.000000\n"
                "hima_snapshot after-offsets\n")
        result = self._session().run_stage(self._stage(), self._script(text), "engineer")
        snap = pla.read_pla(Path(result["snapshots"][0]["pla"]).read_text(encoding="utf-8"), 10000)
        self.assertEqual(snap["fits"], []); self.assertEqual(len(snap["groups"]), 3)

    def test_no_end_marker_is_not_completed(self):
        env = dict(self.env); env["MAGE_STANDIN_NO_END"] = "1"
        result = self._session(env).run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertFalse(result["completed"]); self.assertEqual(result["returncode"], 0)

    def test_slice_checks_and_snapshots_from_stdout(self):
        text = "MAGE_SNAPSHOT 1 a\nMAGE_CHECK_BEGIN 1 SPACE\n2 spacing overlapped instance(s)\nMAGE_CHECK_CODE 1 SPACE 0\nMAGE_CHECK_END 1 SPACE\n"
        checks = session.slice_checks(text)
        self.assertEqual(checks["1"]["SPACE"]["instances"], 2)
        with tempfile.TemporaryDirectory() as out:
            (Path(out) / "snap-01-a").mkdir()
            (Path(out) / "snap-01-a" / "placement.pla").write_text("x", encoding="utf-8")
            self.assertEqual(session.snapshots_from_stdout(text, out)[0]["name"], "a")
            self.assertEqual(session.snapshots_from_stdout("MAGE_SNAPSHOT 2 b\n", out), [])


if __name__ == "__main__":
    unittest.main()
