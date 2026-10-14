"""The Argus LVS engine: the customer's own Argus deck pointed at one candidate, and its report read
as PASS only with a top-level PASS and zero real discrepancies (stdlib only; invented report text)."""
import os
import tempfile
import unittest

from pixelopt import core, judge, receipt, reports
from pixelopt.core import PixelError
from tests.test_judge import build_env

_PASS = """--------------------------- CELL COMPARISON RESULTS ( TOP LEVEL ) ---------------------------
                        ####     ###     ###     ###
                        #   #   #   #   #       #              PASS
LAYOUT CELL NAME=pix
SOURCE CELL NAME=pix
########################################### SUMMARY #########################################
Total Real Discrepancy Count: 0
"""

_FAIL = """  Error:    Property errors.
--------------------------- CELL COMPARISON RESULTS ( TOP LEVEL ) ---------------------------
                        #   #   #   #   #       #              FAIL
LAYOUT CELL NAME=pix
       c_cap: 9.9e-14                     c: 0.09 pf                    9.1%
Total Real Discrepancy Count: 1
"""

_DECK = """layout_input( path "./pixel.gds" )
layout_input( format GDSII )
layout_input( top_cell "orig" )
schematic_input ( path "../LVS/net.sp" )
schematic_input ( top_cell "orig" )
lvs_report( db "out.rep" )
check_property( C c c_cap 2 )
"""


def _write(text):
    fd, p = tempfile.mkstemp()
    with os.fdopen(fd, "w") as fh:
        fh.write(text)
    return p


class ArgusLvsReportTest(unittest.TestCase):
    def test_pass_needs_banner_and_zero_count(self):
        r = reports.argus_lvs(_write(_PASS))
        self.assertTrue(r["correct"])
        self.assertEqual(r["discrepancies"], 0)

    def test_property_error_fails(self):
        r = reports.argus_lvs(_write(_FAIL))
        self.assertFalse(r["correct"])
        self.assertEqual(r["discrepancies"], 1)

    def test_missing_count_is_not_correct(self):
        r = reports.argus_lvs(_write(_PASS.replace("Total Real Discrepancy Count: 0", "")))
        self.assertFalse(r["correct"])
        self.assertIsNone(r["discrepancies"])


class ArgusLvsRuleTest(unittest.TestCase):
    def test_inputs_and_report_are_repointed(self):
        out = judge.argus_lvs_rule(_DECK, "/w/c/pixel.gds", "pix", "/case/net.sp")
        self.assertIn('layout_input( path "/w/c/pixel.gds" )', out)
        self.assertIn('layout_input( top_cell "pix" )', out)
        self.assertIn('schematic_input( path "/case/net.sp" )', out)
        self.assertIn('lvs_report( db "lvs.rep" )', out)
        self.assertIn("check_property( C c c_cap 2 )", out)

    def test_deck_without_schematic_input_is_refused(self):
        with self.assertRaises(PixelError):
            judge.argus_lvs_rule(_DECK.replace("schematic_input ( path", "x( path"), "/a", "pix", "/b")


class ArgusLvsJudgeTest(unittest.TestCase):
    def _run(self, correct):
        case, sitecaps, ws, cand, readiness = build_env(sidecar={"lvsCorrect": correct})
        case.raw["lvs"]["engine"] = "argus"
        case.raw["lvs"]["deckTemplate"] = case.raw["lvs"]["deckTemplate"]  # file content is rewritten below
        deck = case.file(case.raw["lvs"]["deckTemplate"])
        with open(deck, "w") as fh:
            fh.write(_DECK)
        sha = core.sha256_file(deck)
        case.raw["lvs"]["deckTemplate"]["sha256"] = sha
        readiness["options"]["lvsDeck"] = sha
        sitecaps["tools"]["argusLvs"] = list(sitecaps["tools"]["argus"]) + ["-lvs"]
        judge.judge_one(cand, ws, case, sitecaps, mode="full")
        vals = {v["type"]: v for v in receipt.reader_values(os.path.join(cand, "receipt.json"), ws, readiness)}
        lvs = [r for r in core.read_json(os.path.join(cand, "receipt.json"))["reports"] if r["kind"] == "lvs"][0]
        return vals, lvs

    def test_argus_engine_pass_and_fail(self):
        vals, lvs = self._run(True)
        self.assertEqual(lvs["engine"], "argus")
        self.assertEqual(vals["pixel_lvs_correct"]["value"], 1)
        vals, _ = self._run(False)
        self.assertEqual(vals["pixel_lvs_correct"]["value"], 0)


if __name__ == "__main__":
    unittest.main()
