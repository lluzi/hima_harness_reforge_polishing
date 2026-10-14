"""Tests for pixelopt.reports, the EDA report parsers (stdlib only)."""
import os
import tempfile
import unittest

from pixelopt import reports
from pixelopt.core import PixelError

_SUM = """                    DRC Flat SUMMARY REPORT(ARGUS)

ARGUS Version:                 Version 2099.01, standin, Build 0
Top Cell Name:                 pix
**********************************************************************************
                RULE RESULTS INFORMATION

RULE NAME M.W ------------------- Result Count = 0
RULE NAME M.SP ------------------ Result Count = 2
RULE NAME GA.W ------------------ Result Count = 1
**********************************************************************************
                SUMMARY

ALL DRC Rule:                    3
ALL DRC Results:                 3
"""

_LVS_CORRECT = """
                  ##  L V S   R E P O R T  ##
                         ###################
                         #    CORRECT      #
                         ###################
  Result         Layout                        Source
  CORRECT        pixel                         pixel
"""

_LVS_INCORRECT = """
                  ##  L V S   R E P O R T  ##
                         ###################
                         #    INCORRECT    #
                         ###################
  Result         Layout                        Source
  INCORRECT      pixel                         pixel
  Nets with discrepancies
"""

_RCE = """
.subckt pix S VP SC RCE_UNCONN_1
C_S_VP S VP 1.2e-14
C_S_SC S SC 4e-16
C_S_SC_b S SC 1e-16
C_S_RCE_UNCONN_1 S RCE_UNCONN_1 1e-22
.ends pix
"""

_GDSIN_LOG = """*****
Tool:		gdsIn               0.10.0
*****
Running: gdsIn -lib pixel ...
"""


def _tmp(text, name="r.txt"):
    d = tempfile.mkdtemp()
    p = os.path.join(d, name)
    with open(p, "w") as fh:
        fh.write(text)
    return p


class TestArgusSummary(unittest.TestCase):
    def test_counts(self):
        r = reports.argus_summary(_tmp(_SUM))
        self.assertEqual(r["total"], 3)
        self.assertEqual(r["byRule"], {"M.W": 0, "M.SP": 2, "GA.W": 1})

    def test_missing_file_raises(self):
        with self.assertRaises(PixelError):
            reports.argus_summary("/no/such/file.sum")

    def test_blank_file_raises(self):
        with self.assertRaises(PixelError):
            reports.argus_summary(_tmp("nothing here\n"))


class TestCalibreLvs(unittest.TestCase):
    def test_correct(self):
        self.assertTrue(reports.calibre_lvs(_tmp(_LVS_CORRECT))["correct"])

    def test_incorrect_anywhere_is_false(self):
        rep = reports.calibre_lvs(_tmp(_LVS_INCORRECT))
        self.assertFalse(rep["correct"])
        self.assertTrue(rep["lines"])


class TestRceCaps(unittest.TestCase):
    def test_sums_parallel_and_converts_to_fF(self):
        caps = reports.rce_caps(_tmp(_RCE))
        self.assertAlmostEqual(caps["S|VP"], 12.0, places=6)
        # two parallel S-SC cards summed: (4e-16 + 1e-16) * 1e15 = 0.5 fF
        self.assertAlmostEqual(caps["S|SC"], 0.5, places=6)
        # the UNCONN pseudo-node pair is retained for the Reader to exclude
        self.assertIn("RCE_UNCONN_1|S", caps)

    def test_empty_is_empty_dict(self):
        self.assertEqual(reports.rce_caps(_tmp(".subckt pix\n.ends pix\n")), {})


class TestToolVersions(unittest.TestCase):
    def test_gdsin_banner(self):
        v = reports.tool_versions(_GDSIN_LOG)
        self.assertEqual(v.get("gdsIn"), "0.10.0")

    def test_empty_log(self):
        self.assertEqual(reports.tool_versions(""), {})


if __name__ == "__main__":
    unittest.main()
