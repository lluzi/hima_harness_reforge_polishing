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

    def _session(self, executable=None):
        return session.MageSession(
            executable=executable or [sys.executable, STANDIN],
            env=self.env,
            workdir=self.tmp.name,
            log_path=self.log_path,
            templates_dir=TEMPLATES_DIR,
            case={"frb": self.frb_path},
        )

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

        doc = pla.read_pla(Path(result["exportDbuPla"]).read_text(encoding="utf-8"), 10000)
        self.assertEqual(doc["units"], "dbu")

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
