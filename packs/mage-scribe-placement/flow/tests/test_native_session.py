import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402
from mage_placement.native import session, tcl  # noqa: E402
from tests import fixtures  # noqa: E402


TEMPLATES_DIR = str(Path(__file__).resolve().parents[1] / "templates")
STANDIN = str(Path(__file__).resolve().parent / "standin_mage.py")

_SLEEPER_SOURCE = "import time, sys\ntime.sleep(5)\nsys.exit(0)\n"


class MageSessionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case_info = fixtures.make_case(self.tmp.name)
        self.frb_path = self.case_info["manifest"]["frb"]["path"]
        self.log_path = str(Path(self.tmp.name) / "session-log.jsonl")
        self.env = dict(os.environ)

    def tearDown(self):
        self.tmp.cleanup()

    def _session(self, executable=None, env=None, auto_refine_converge=None):
        case = {"frb": self.frb_path}
        if auto_refine_converge is not None:
            case["autoRefineConverge"] = auto_refine_converge
        return session.MageSession(
            executable=executable or [sys.executable, STANDIN],
            env=env or self.env,
            workdir=self.tmp.name,
            log_path=self.log_path,
            templates_dir=TEMPLATES_DIR,
            case=case,
        )

    def _write_experiment(self, text):
        path = Path(self.tmp.name) / "experiment-src.tcl"
        path.write_text(text, encoding="utf-8")
        return str(path)

    def _read_log(self):
        if not Path(self.log_path).exists():
            return []
        return [json.loads(line) for line in Path(self.log_path).read_text(encoding="utf-8").splitlines()]

    def test_round_with_standin_exports_and_logs(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-01"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer")

        self.assertEqual(result["returncode"], 0)
        self.assertFalse(result["timedOut"])
        self.assertTrue(Path(result["exportPla"]).exists())
        self.assertTrue(Path(result["verifyFiles"]["OVERLAP"]).exists())
        self.assertEqual(len(result["verifyFiles"]), len(session.NATIVE_TYPES))
        self.assertTrue(Path(result["summary"]).exists())

        # The real native build's own `-saveMark` writes the DBU shape
        # directly -- `export.pla` itself, not a separate exportDbuPla.
        doc = pla.read_pla(Path(result["exportPla"]).read_text(encoding="utf-8"), 10000)
        self.assertEqual(doc["units"], "dbu")
        self.assertNotIn("exportDbuPla", result)

        log = self._read_log()
        self.assertEqual(len(log), 1)
        self.assertTrue(log[-1]["mutating"])
        self.assertEqual(log[-1]["role"], "engineer")
        self.assertEqual(log[-1]["returncode"], 0)
        self.assertEqual(log[-1]["scriptSha256"], result["scriptSha256"])

    def test_consumer_cannot_run_mutating_round(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-02"
        candidate_pla = self.case_info["files"]["startState"]

        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="metrology")

        self.assertEqual(ctx.exception.code, "writer")
        self.assertFalse((round_dir / "round.tcl").exists())
        self.assertEqual(self._read_log(), [])

    def test_failed_round_is_recorded_not_hidden(self):
        env = dict(self.env)
        env["MAGE_STANDIN_FAIL"] = "1"
        s = session.MageSession(
            executable=[sys.executable, STANDIN], env=env, workdir=self.tmp.name,
            log_path=self.log_path, templates_dir=TEMPLATES_DIR, case={"frb": self.frb_path},
        )
        round_dir = Path(self.tmp.name) / "round-03"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer")

        self.assertEqual(result["returncode"], 2)
        self.assertFalse(result["timedOut"])
        self.assertIsNone(result["exportPla"])

        log = self._read_log()
        self.assertEqual(len(log), 1)
        self.assertEqual(log[-1]["returncode"], 2)
        self.assertFalse(log[-1]["timedOut"])

    def test_timeout_kills_process_group_and_is_recorded(self):
        sleeper_path = Path(self.tmp.name) / "sleeper.py"
        sleeper_path.write_text(_SLEEPER_SOURCE, encoding="utf-8")
        s = session.MageSession(
            executable=[sys.executable, str(sleeper_path)], env=self.env, workdir=self.tmp.name,
            log_path=self.log_path, templates_dir=TEMPLATES_DIR, case={"frb": self.frb_path},
        )
        round_dir = Path(self.tmp.name) / "round-04"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer", timeout_s=1)

        self.assertTrue(result["timedOut"])
        self.assertEqual(result["returncode"], -9)

        log = self._read_log()
        self.assertEqual(len(log), 1)
        self.assertTrue(log[-1]["timedOut"])
        self.assertEqual(log[-1]["returncode"], -9)

    def test_run_round_refuses_a_pre_existing_round_tcl(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-05"
        candidate_pla = self.case_info["files"]["startState"]
        s.run_round(str(round_dir), candidate_pla, role="engineer")

        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="engineer")
        self.assertEqual(ctx.exception.code, "round-exists")

    def test_fill_round_adds_converge_and_autorefine(self):
        s = self._session(auto_refine_converge={"VERT": 7, "HORZ": 5})
        round_dir = Path(self.tmp.name) / "round-fill"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer", fill=True)
        self.assertTrue(result["fill"])

        script = (round_dir / "round.tcl").read_text(encoding="utf-8")
        vert = "smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum 7"
        horz = "smPFlow -setAutoRefineSimpleConverge -arSLType HORZ -arConvergeNum 5"
        g_params = "g_params -set {smPFlow::s_ARTestConvergePrplaced false}"
        autorefine = "smPFlow -autoRefine"
        for token in (vert, horz, g_params, autorefine):
            self.assertIn(token, script)

        source_pos = script.index(f"source {{{candidate_pla}}}")
        verify_pos = script.index("MAGE_VERIFY_BEGIN")
        self.assertLess(source_pos, script.index(vert))
        self.assertLess(script.index(vert), script.index(horz))
        self.assertLess(script.index(horz), script.index(g_params))
        self.assertLess(script.index(g_params), script.index(autorefine))
        self.assertLess(script.index(autorefine), verify_pos)

        log = self._read_log()
        self.assertTrue(log[-1]["fill"])

    def test_fill_without_converge_emits_comment(self):
        s = self._session()  # no autoRefineConverge in the case
        round_dir = Path(self.tmp.name) / "round-fill-nocv"
        candidate_pla = self.case_info["files"]["startState"]

        s.run_round(str(round_dir), candidate_pla, role="engineer", fill=True)
        script = (round_dir / "round.tcl").read_text(encoding="utf-8")
        self.assertIn("# no autoRefineConverge in the case manifest", script)
        self.assertNotIn("-setAutoRefineSimpleConverge", script)
        self.assertIn("smPFlow -autoRefine", script)

    def test_experiment_is_copied_hashed_and_sourced(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-exp"
        candidate_pla = self.case_info["files"]["startState"]
        experiment_src = self._write_experiment("smPFlow -autoRefine\n")

        result = s.run_round(str(round_dir), candidate_pla, role="engineer", experiment_tcl=experiment_src)

        dest = round_dir / "experiment.tcl"
        self.assertEqual(dest.read_bytes(), Path(experiment_src).read_bytes())
        self.assertEqual(result["experimentSha256"], core.file_sha256(dest))
        self.assertEqual(result["experimentTcl"], str(dest))

        script = (round_dir / "round.tcl").read_text(encoding="utf-8")
        source_pos = script.index(f"source {{{candidate_pla}}}")
        exp_pos = script.index(f"source {{{dest}}}")
        verify_pos = script.index("MAGE_VERIFY_BEGIN")
        self.assertLess(source_pos, exp_pos)
        self.assertLess(exp_pos, verify_pos)

        log = self._read_log()
        self.assertEqual(log[-1]["experimentSha256"], result["experimentSha256"])

    def test_experiment_with_exit_is_refused(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-exp-exit"
        candidate_pla = self.case_info["files"]["startState"]
        experiment_src = self._write_experiment("smPFlow -autoRefine\nexit 0\n")

        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="engineer", experiment_tcl=experiment_src)
        self.assertEqual(ctx.exception.code, "experiment")
        self.assertFalse(round_dir.exists())
        self.assertEqual(self._read_log(), [])

    def test_experiment_with_frbopen_is_refused(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-exp-frbopen"
        candidate_pla = self.case_info["files"]["startState"]
        experiment_src = self._write_experiment("frbOpen {/some/other.frb}\n")

        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="engineer", experiment_tcl=experiment_src)
        self.assertEqual(ctx.exception.code, "experiment")
        self.assertFalse(round_dir.exists())

    def test_experiment_printing_mage_verify_marker_is_refused(self):
        # I1: an experiment may not print a fake native-check marker.
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-exp-verify"
        candidate_pla = self.case_info["files"]["startState"]
        experiment_src = self._write_experiment('puts "MAGE_VERIFY_BEGIN SPACE"\n')
        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="engineer", experiment_tcl=experiment_src)
        self.assertEqual(ctx.exception.code, "experiment")
        self.assertFalse(round_dir.exists())

    def test_experiment_printing_round_end_marker_is_refused(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-exp-end"
        candidate_pla = self.case_info["files"]["startState"]
        experiment_src = self._write_experiment('puts "MAGE_ROUND_END code 0"\n')
        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="engineer", experiment_tcl=experiment_src)
        self.assertEqual(ctx.exception.code, "experiment")

    def test_duplicate_verify_begin_block_reads_unknown(self):
        # I1: a second MAGE_VERIFY_BEGIN SPACE (e.g. a planted fake 0 before
        # MAGE's real count) makes that type unknown, never the fake value.
        stdout = "\n".join([
            "MAGE_VERIFY_BEGIN SPACE", "0 spacing overlapped instance(s)",
            "MAGE_VERIFY_CODE SPACE 0", "MAGE_VERIFY_END SPACE",
            "MAGE_VERIFY_BEGIN SPACE", "3 spacing overlapped instance(s)",
            "MAGE_VERIFY_CODE SPACE 0", "MAGE_VERIFY_END SPACE",
        ])
        blocks = session.slice_verify(stdout)
        self.assertIsNone(blocks["SPACE"]["instances"])
        self.assertIsNone(blocks["SPACE"]["code"])

    def test_consumer_cannot_run_experiment(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-exp-consumer"
        candidate_pla = self.case_info["files"]["startState"]
        experiment_src = self._write_experiment("smPFlow -autoRefine\n")

        with self.assertRaises(core.MageError) as ctx:
            s.run_round(str(round_dir), candidate_pla, role="metrology", experiment_tcl=experiment_src)
        self.assertEqual(ctx.exception.code, "writer")
        self.assertFalse((round_dir / "round.tcl").exists())

    def test_verify_files_come_from_stdout_markers(self):
        env = dict(self.env)
        env["MAGE_STANDIN_ROWS"] = '{"SPACE": ["P_X 2 10.0 0.0 (1,2)"]}'
        s = self._session(env=env)
        round_dir = Path(self.tmp.name) / "round-verify"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer")
        self.assertEqual(set(result["verifyFiles"]), {"OVERLAP", "SPACE", "BOUNDARY"})

        space = Path(result["verifyFiles"]["SPACE"]).read_text(encoding="utf-8").splitlines()
        self.assertEqual(space[0], "# mage-verify/1 type=SPACE command=frbCheckSpace instances=1")
        overlap = Path(result["verifyFiles"]["OVERLAP"]).read_text(encoding="utf-8").splitlines()
        self.assertEqual(overlap[0], "# mage-verify/1 type=OVERLAP command=frbCheckOverlap instances=0")
        boundary = Path(result["verifyFiles"]["BOUNDARY"]).read_text(encoding="utf-8").splitlines()
        self.assertEqual(boundary[0], "# mage-verify/1 type=BOUNDARY command=frbCheckBoundary instances=0")

    def test_verify_type_with_failed_catch_is_not_written(self):
        env = dict(self.env)
        env["MAGE_STANDIN_VERIFY_FAIL"] = "BOUNDARY"
        s = self._session(env=env)
        round_dir = Path(self.tmp.name) / "round-verify-fail"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer")
        self.assertNotIn("BOUNDARY", result["verifyFiles"])
        self.assertFalse((round_dir / "out" / "verify-BOUNDARY.txt").exists())
        self.assertIn("OVERLAP", result["verifyFiles"])

    def test_open_build_has_no_arenabled_and_has_sort(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-openbuild"
        candidate_pla = self.case_info["files"]["startState"]
        s.run_round(str(round_dir), candidate_pla, role="engineer")
        script = (round_dir / "round.tcl").read_text(encoding="utf-8")
        self.assertIn("smPFlow -sortFit", script)
        self.assertNotIn("-arEnabled", script)

    def test_round_without_end_marker_is_not_completed(self):
        env = dict(self.env)
        env["MAGE_STANDIN_NO_END"] = "1"
        s = self._session(env=env)
        round_dir = Path(self.tmp.name) / "round-noend"
        candidate_pla = self.case_info["files"]["startState"]

        result = s.run_round(str(round_dir), candidate_pla, role="engineer")
        self.assertEqual(result["returncode"], 0)
        self.assertFalse(result["completed"])
        log = self._read_log()
        self.assertFalse(log[-1]["completed"])

    def test_completed_round_sets_completed_true(self):
        s = self._session()
        round_dir = Path(self.tmp.name) / "round-ok"
        candidate_pla = self.case_info["files"]["startState"]
        result = s.run_round(str(round_dir), candidate_pla, role="engineer")
        self.assertTrue(result["completed"])


class TclHelpersTest(unittest.TestCase):
    def test_quote_wraps_in_braces(self):
        self.assertEqual(tcl.quote("/a/b.pla"), "{/a/b.pla}")

    def test_quote_refuses_forbidden_characters(self):
        for bad in ("{", "}", "\n", "[", "$", "\\"):
            with self.assertRaises(core.MageError):
                tcl.quote(f"path{bad}x")

    def test_fill_substitutes_every_placeholder(self):
        self.assertEqual(tcl.fill("frbOpen {@FRB@}", {"FRB": "/case.frb"}), "frbOpen {/case.frb}")

    def test_fill_refuses_missing_mapping_key(self):
        with self.assertRaises(core.MageError):
            tcl.fill("frbOpen {@FRB@}", {})

    def test_fill_refuses_unused_mapping_key(self):
        with self.assertRaises(core.MageError):
            tcl.fill("frbOpen {@FRB@}", {"FRB": "/case.frb", "EXTRA": "x"})


if __name__ == "__main__":
    unittest.main()
