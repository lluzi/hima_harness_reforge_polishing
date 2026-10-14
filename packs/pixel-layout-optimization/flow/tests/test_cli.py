"""The CLI dispatcher's stdlib subcommands and exit codes."""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr

_FLOW = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir)
sys.path.insert(0, _FLOW)

import pixel_cli  # noqa: E402
from pixelopt import core  # noqa: E402


def _readiness():
    return {
        "schema": "pixel.case-readiness/1",
        "goal": {"values": {"outline_w_um": 20.0, "outline_h_um": 40.0,
                            "ratio_target_pct": 9.0, "load_allowance_pct": 5.0,
                            "t_min_pct": 5.0, "t_max_pct": 30.0, "cst_ceiling_ff": 0.0},
                 "topologyMoves": "off", "ratioDefinition": "broad",
                 "transmittanceBasis": "tiled", "extraCsOverlap": "count"},
        "manifest": {"layers": {"Poly": {}, "GateA": {}},
                     "nets": {"storageNode": "S", "storageNet": "VP", "anode": "AN"},
                     "ratioDefinitions": {"broad": ["SC", "AN"], "narrow": ["R1"]},
                     "loadLimitedLines": ["SC"], "couplingLimits": []},
        "options": {"decks": {"authority": None, "reference": None}, "lvsDeck": None,
                    "schematic": None, "extraction": {}},
        "original": {"loads": {}, "cstDeviceFf": None},
    }


def _plan(**over):
    p = {"schema": "pixel.plan/1", "round": 2, "hypothesis": "x", "base": "best",
         "operators": [], "frontPoints": [{"name": "t", "objective": "min-ratio"}],
         "pairConstraints": [], "edits": [], "expect": "y"}
    p.update(over)
    return p


class CliTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(os.path.join(self.tmp, "state"))
        core.write_json(os.path.join(self.tmp, "state", "case-readiness.json"), _readiness())

    def _run(self, argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = pixel_cli.main(argv)
        return rc, out.getvalue(), err.getvalue()

    def test_card(self):
        card = {"schema": "pixel.card/1", "sites": [], "levers": [],
                "pitchBound": {"x": {"pitchUm": 20.0, "binding": []},
                               "y": {"pitchUm": 40.0, "binding": []}},
                "floor": {"ctFf": None, "note": ""}, "front": [], "openMarkers": []}
        core.write_json(os.path.join(self.tmp, "state", "card.json"), card)
        rc, out, _ = self._run(["card", self.tmp])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["schema"], "pixel.card/1")

    def test_history_last(self):
        path = os.path.join(self.tmp, "state", "history.jsonl")
        with open(path, "w") as fh:
            for i in range(3):
                fh.write(json.dumps({"id": "c%d" % i}) + "\n")
        rc, out, _ = self._run(["history", self.tmp, "--last", "2"])
        self.assertEqual(rc, 0)
        rows = json.loads(out)
        self.assertEqual([r["id"] for r in rows], ["c1", "c2"])

    def test_plan_check_writes(self):
        plan_path = os.path.join(self.tmp, "plan.json")
        core.write_json(plan_path, _plan())
        rc, out, _ = self._run(["plan-check", self.tmp, "--plan", plan_path,
                                "--out", "state/round/plan.json"])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out)["errorCount"], 0)
        self.assertTrue(os.path.exists(os.path.join(self.tmp, "state", "round", "plan.json")))

    def test_plan_check_reports_errors(self):
        plan_path = os.path.join(self.tmp, "plan.json")
        core.write_json(plan_path, _plan(base="nope"))
        rc, out, _ = self._run(["plan-check", self.tmp, "--plan", plan_path])
        self.assertEqual(rc, 3)  # a plan with errors is refused, with the errors printed
        self.assertGreater(json.loads(out)["errorCount"], 0)

    def test_plan_round_fallback(self):
        os.makedirs(os.path.join(self.tmp, "state", "round"))
        core.write_json(os.path.join(self.tmp, "state", "round", "plan.json"), _plan())
        rc, out, _ = self._run(["plan-round", self.tmp, "2"])
        self.assertEqual(rc, 0)
        env = json.loads(out)
        self.assertEqual(env["engineering"]["outcome"], "completed")
        self.assertEqual(len(env["observations"]), 1)

    def test_show(self):
        campaign = tempfile.mkdtemp()
        cand = os.path.join(campaign, "cands", "original")
        os.makedirs(cand)
        receipt = {"schema": "pixel.receipt/1", "candidate": "original", "mode": "drc",
                   "reports": [], "options": {"dbPrecision": True,
                   "decks": {"authority": None, "reference": None}, "lvsDeck": None,
                   "schematic": None, "extraction": {}}, "freshLibrary": False,
                   "declaredChanges": {}, "seconds": 0.0}
        core.write_json(os.path.join(cand, "receipt.json"), receipt)
        rc, out, _ = self._run(["show", self.tmp, "--campaign", campaign, "original"])
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        self.assertEqual(doc["candidate"], "original")
        self.assertTrue(any(v["type"] == "pixel_receipt_error_count" for v in doc["values"]))

    def test_unknown_subcommand(self):
        rc, _, err = self._run(["frobnicate", self.tmp])
        self.assertEqual(rc, 2)
        self.assertEqual(json.loads(err.strip())["code"], "missing-input")

    def test_task_unknown(self):
        ti = os.path.join(self.tmp, "in.json")
        to = os.path.join(self.tmp, "out.json")
        core.write_json(ti, {})
        rc, _, err = self._run(["task-nope", self.tmp, ti, to])
        self.assertEqual(rc, 3)
        self.assertEqual(json.loads(err.strip())["code"], "schema")

    def test_no_args(self):
        rc, _, err = self._run([])
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()
