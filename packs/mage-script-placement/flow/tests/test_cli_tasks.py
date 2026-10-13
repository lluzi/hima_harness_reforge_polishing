"""End-to-end route test driving every program task and resident subcommand
the way the Harness would: prepare-case -> measure-incumbent -> per-round
(engineer stage + candidate + Reader -> decide-round) -> evaluate-placement
-> deliver, all through the CLI with the stand-in MAGE."""
import json, os, subprocess, sys, tarfile, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402
from tests import fixtures  # noqa: E402
from tests.test_cli_stage import BASELINE, run_cli  # noqa: E402

FLOW = Path(__file__).resolve().parents[1]
CLI = FLOW / "mage_placement_cli.py"
READER = FLOW.parent / "tools" / "read-mage.py"
STANDIN = FLOW / "tests" / "standin_mage.py"

# The route tests move OVL_B 150 um onto its CT target, so the move budget
# must be >= 150; the brief fixes it at 200.
GOAL_INPUTS = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION_LR": 2,
               "MAX_ORDER_DEVIATION_TB": 1, "MAX_PRIORITY_MOVE_UM": 200}


def _improved_pla():
    """A candidate PLA that places OVL_B centred on its CT target (1290, 30)
    um and KEY_V as an ordinary fit, so the fill never re-drops KEY_V and the
    only ordinary drop of the baseline disappears."""
    fit_rows = [
        'OVL_A.OVL_A 122.5 2 257.5 58 NULL "" OVL_A.OVL_A_1 "G1_1"',
        'OVL_B.OVL_B 1222.5 2 1357.5 58 NULL "" OVL_B.OVL_B_1 "G1_2"',
        'AL_X.AL_X -90 665 90 715 NULL "" AL_X.AL_X_1 "G2_1"',
        'KEY_V.KEY_V 0 0 900 60 NULL "" KEY_V.KEY_V ""',
    ]
    fit_block = "set fitinsts {\n" + "\n".join("\t" + r for r in fit_rows) + "\n}\n"
    return (
        "############# For placed fix instances #############\n"
        + fixtures._fixinsts_block() + "\n" + fixtures.FIXINSTS_FOREACH
        + "\n############# For group instances #############\n"
        + fixtures._pinst_group_block() + "\n" + fixtures.PINST_GROUP_FOREACH
        + "\n############# For placed fit instances #############\n"
        + fit_block + "\n" + fixtures.FITINSTS_FOREACH
    )


class CliRouteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.workspace = self.root / "ws"; self.workspace.mkdir()
        os.symlink(FLOW, self.workspace / "flow")
        self.exe = [sys.executable, str(STANDIN)]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=self.exe)
        self.caps = fixtures.make_site_capabilities(self.tmp.name, self.exe)
        self.env = dict(os.environ)

    def tearDown(self):
        self.tmp.cleanup()

    def _task(self, name, task_input):
        in_path = self.root / f"in-{name}-{id(task_input)}.json"
        out_path = self.root / f"out-{name}-{id(task_input)}.json"
        in_path.write_text(json.dumps(task_input), encoding="utf-8")
        run_cli([f"task-{name}", self.workspace, in_path, out_path])
        return json.loads(out_path.read_text(encoding="utf-8"))["value"]

    def _prepare_and_measure(self):
        prepare = self._task("prepare-case", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"], "SITE_CAPABILITIES": self.caps, **GOAL_INPUTS})
        measure = self._task("measure-incumbent", {"CASE": prepare, "INCUMBENT_COMPARISON": "retained"})
        return prepare, measure

    def _round(self, n, stage_text, env=None):
        round_dir = Path("placement/round-%02d" % n)
        (self.workspace / round_dir).mkdir(parents=True, exist_ok=True)
        script = self.workspace / round_dir / "script.tcl"; script.write_text(stage_text, encoding="utf-8")
        stage_dir = round_dir / "stage-1"
        run_cli(["mage-stage", self.workspace, "--round", n, "--script", script, "--out-dir", stage_dir], env=env or self.env)
        summary = json.loads((self.workspace / stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        journal = self.workspace / round_dir / "journal-entry.json"
        journal.write_text(json.dumps(fixtures.journal_entry(n, summary["scriptSha256"])), encoding="utf-8")
        report = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", n, "--stage-dir", stage_dir, "--journal", journal, "--out", report])
        candidate_doc = json.loads(report.read_text(encoding="utf-8"))
        reader_out = self.root / ("reader-%02d.json" % n)
        r = subprocess.run([sys.executable, str(READER), "script-candidate", str(report), str(reader_out), str(self.workspace)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        values = json.loads(reader_out.read_text(encoding="utf-8"))["values"]
        resident = {"observations": [{"contentSha256": core.file_sha256(report), "values": values}],
                    "engineering": {"outcome": candidate_doc["outcome"], "summary": "", "stopReason": candidate_doc.get("stopReason", "")}}
        return self._task("decide-round", {"ROUND": n, "CANDIDATE": resident, **GOAL_INPUTS})

    def _improved_stage(self, n):
        pla_path = self.workspace / ("placement/round-%02d" % n) / "improved.pla"
        pla_path.parent.mkdir(parents=True, exist_ok=True)
        pla_path.write_text(_improved_pla(), encoding="utf-8")
        return ("hima_open_build\nsource {%s}\nhima_snapshot improved\n"
                "g_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\nhima_snapshot filled\n" % pla_path)

    def test_completion_route_stops_at_goal_met(self):
        prepare, measure = self._prepare_and_measure()
        self.assertEqual(measure["ordinaryPopulation"], 3)

        d1 = self._round(1, BASELINE)
        self.assertEqual(d1["route"], "continue")
        self.assertEqual(d1["rules"]["drops-within-goal"], "FAIL")

        d2 = self._round(2, self._improved_stage(2))
        self.assertEqual(d2["route"], "stop")
        self.assertTrue(d2["goalMet"])

        evaluation = self._task("evaluate-placement", {"DECISION": d2, "INCUMBENT": measure, **GOAL_INPUTS})
        self.assertEqual(evaluation["proofLevel"], "completion")

        delivery = self._task("deliver", {"EVALUATION": evaluation})
        self.assertEqual(delivery["goalMet"], True)
        with tarfile.open(self.workspace / "delivery" / "placement-artifacts.tar.gz") as archive:
            names = archive.getnames()
        self.assertIn("state/method-journal.json", names)
        self.assertIn("placement/round-01/stage-1/script.tcl", names)
        self.assertIn("placement/round-02/stage-1/script.tcl", names)
        report_md = (self.workspace / "delivery" / "REPORT.md").read_text(encoding="utf-8")
        self.assertIn("Proof level: completion", report_md)

    def test_two_stalls_reproduction(self):
        prepare, measure = self._prepare_and_measure()
        d1 = self._round(1, BASELINE); self.assertEqual(d1["route"], "continue")
        d2 = self._round(2, BASELINE); self.assertEqual(d2["route"], "continue")
        d3 = self._round(3, BASELINE)
        self.assertEqual(d3["route"], "stop")
        self.assertIn("two consecutive", d3["stopReason"])
        evaluation = self._task("evaluate-placement", {"DECISION": d3, "INCUMBENT": measure, **GOAL_INPUTS})
        self.assertEqual(evaluation["proofLevel"], "reproduction")

    def test_blocked_round_continues_then_recovers(self):
        prepare, measure = self._prepare_and_measure()
        env = dict(self.env); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        d1 = self._round(1, BASELINE, env=env)
        self.assertEqual(d1["route"], "continue")
        self.assertIsNone(d1["best"])
        d2 = self._round(2, BASELINE)
        self.assertEqual(d2["best"]["round"], 2)

    def test_prepare_case_missing_goal_knob_exits_malformed_input(self):
        inputs = dict(GOAL_INPUTS)
        del inputs["MAX_PRIORITY_MOVE_UM"]
        in_path = self.root / "in-prepare-missing.json"
        out_path = self.root / "out-prepare-missing.json"
        in_path.write_text(json.dumps({
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"], "SITE_CAPABILITIES": self.caps, **inputs,
        }), encoding="utf-8")
        result = run_cli(["task-prepare-case", self.workspace, in_path, out_path], expect=2)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "malformed-input")
        self.assertIn("KeyError", payload["detail"])

    def test_deliver_refuses_a_tampered_stage_file(self):
        prepare, measure = self._prepare_and_measure()
        d1 = self._round(1, BASELINE)
        self.assertEqual(d1["route"], "continue")
        d2 = self._round(2, self._improved_stage(2))
        self.assertEqual(d2["route"], "stop")

        tampered = self.workspace / "placement" / "round-02" / "stage-1" / "script.tcl"
        data = bytearray(tampered.read_bytes())
        data[0] ^= 0xFF
        tampered.write_bytes(bytes(data))

        evaluation = self._task("evaluate-placement", {"DECISION": d2, "INCUMBENT": measure, **GOAL_INPUTS})

        in_path = self.root / "in-deliver-tampered.json"
        out_path = self.root / "out-deliver-tampered.json"
        in_path.write_text(json.dumps({"EVALUATION": evaluation}), encoding="utf-8")
        result = run_cli(["task-deliver", self.workspace, in_path, out_path], expect=3)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")


if __name__ == "__main__":
    unittest.main()
