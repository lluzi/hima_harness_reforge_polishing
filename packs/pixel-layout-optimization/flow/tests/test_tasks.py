"""The stdlib parts of the program-task module (no numeric, no tools)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

from pixelopt import core, tasks  # noqa: E402
from pixelopt.core import PixelError  # noqa: E402


def _goal():
    return {"values": {"outline_w_um": 20.0, "outline_h_um": 40.0,
                       "ratio_target_pct": 9.0, "load_allowance_pct": 5.0,
                       "t_min_pct": 5.0, "t_max_pct": 30.0, "cst_ceiling_ff": 0.0}}


class HelpersTest(unittest.TestCase):
    def test_values_map(self):
        rows = [{"type": "a", "unit": "count", "value": 1},
                {"type": "b", "unit": "fF", "value": None, "unknownReason": "gone"}]
        vmap, unknown = tasks._values_map(rows)
        self.assertEqual(vmap, {"a": 1, "b": None})
        self.assertEqual(unknown, {"b": "gone"})

    def test_load_totals(self):
        caps = {"SC|S": 1.0, "SC|AN": 2.0, "SC|RCE_UNCONN_1": 9.0, "DL|S": 3.0}
        totals = tasks._load_totals(caps, ["SC"])
        self.assertAlmostEqual(totals["SC"], 3.0)  # 1.0 + 2.0; UNCONN excluded

    def test_history_entry_legal_and_rules(self):
        rows = [{"type": t, "unit": "count", "value": 0} for t in (
            "pixel_receipt_error_count", "pixel_drc_authority_1x1",
            "pixel_drc_authority_2x2", "pixel_drc_authority_3x3",
            "pixel_interact_violations", "pixel_channels_changed",
            "pixel_undeclared_change_count", "pixel_coupling_over_limit_count",
            "pixel_load_over_limit_count", "pixel_floating_new_count")]
        rows += [{"type": "pixel_lvs_correct", "unit": "flag", "value": 1},
                 {"type": "pixel_t_judged_pct", "unit": "pct", "value": 10.0},
                 {"type": "pixel_outline_w_um", "unit": "um", "value": 19.0},
                 {"type": "pixel_outline_h_um", "unit": "um", "value": 39.0},
                 {"type": "pixel_ratio_judged_pct", "unit": "pct", "value": 8.0}]
        entry = tasks._history_entry("r1", {"kind": "candidate", "round": 1}, rows, _goal())
        self.assertTrue(entry["legal"])
        self.assertEqual(entry["hardFailures"], [])
        self.assertEqual(entry["goalRules"]["ratio-met"], "PASS")
        self.assertEqual(entry["id"], "r1")
        self.assertEqual(entry["round"], 1)

    def test_history_entry_illegal(self):
        rows = [{"type": "pixel_lvs_correct", "unit": "flag", "value": 0}]
        entry = tasks._history_entry("m", {}, rows, _goal())
        self.assertFalse(entry["legal"])
        self.assertIn("lvs-correct", entry["hardFailures"])


class ExecuteTest(unittest.TestCase):
    def test_unknown_task(self):
        with self.assertRaises(PixelError) as ctx:
            tasks.execute("nope", "/tmp", {})
        self.assertEqual(ctx.exception.code, "schema")


class ReportMdTest(unittest.TestCase):
    def test_writes_markdown(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "REPORT.md")
            report = {"caseId": "synthetic-1", "ending": "goal-met", "goalMet": True,
                      "best": {"id": "r1", "legal": True},
                      "rules": {"ratio-met": "PASS", "lvs-correct": "PASS"},
                      "unknowns": ["pixel_pdl_symmetry_min"]}
            tasks._write_report_md(path, report, {})
            with open(path) as fh:
                text = fh.read()
            self.assertIn("# Pixel layout optimization delivery", text)
            self.assertIn("goal-met", text)
            self.assertIn("ratio-met", text)
            self.assertIn("pixel_pdl_symmetry_min", text)

    def test_today_and_delivered_values_come_as_one_table(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "REPORT.md")
            report = {"caseId": "c", "ending": "goal-met", "goalMet": True,
                      "baseline": {"id": "original",
                                   "values": {"pixel_ratio_judged_pct": 10.22,
                                              "pixel_ct_anode_ff": 3.71}},
                      "best": {"id": "r4", "legal": True,
                               "values": {"pixel_ratio_judged_pct": 7.12,
                                          "pixel_ct_anode_ff": 3.098}},
                      "rules": {}, "unknowns": []}
            tasks._write_report_md(path, report, {})
            with open(path) as fh:
                text = fh.read()
            self.assertIn("| Ct/Cs (%) | 10.22 | 7.12 |", text)
            self.assertIn("| C(N1,N4) (fF) | 3.71 | 3.098 |", text)


if __name__ == "__main__":
    unittest.main()
