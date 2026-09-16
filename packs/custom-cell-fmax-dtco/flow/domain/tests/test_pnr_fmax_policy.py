#!/usr/bin/env python3
"""Fmax Campaign policy: optimize setup and observe hold without fixing it."""

from pathlib import Path
import unittest


DOMAIN = Path(__file__).resolve().parents[1]


class PnrFmaxPolicyTests(unittest.TestCase):
    def test_postroute_hold_is_observed_but_never_optimized(self):
        template = (DOMAIN / "pnr.tcl.tmpl").read_text()

        self.assertIn("optDesign -postRoute -setup", template)
        self.assertNotIn("optDesign -postRoute -hold", template)
        self.assertIn("timeDesign -postRoute -hold", template)
        self.assertLess(
            template.index("optDesign -postRoute -setup"),
            template.index("timeDesign -postRoute -hold"),
        )


if __name__ == "__main__":
    unittest.main()
