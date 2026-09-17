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

    def test_early_clock_useful_skew_is_matched_and_bounded_to_100ps(self):
        template = (DOMAIN / "pnr.tcl.tmpl").read_text()
        self.assertIn("-usefulSkew true", template)
        self.assertIn("-opt_skew_pre_cts true", template)
        self.assertIn("-opt_skew_ccopt standard", template)
        self.assertIn("-opt_skew_post_route true", template)
        self.assertIn("-opt_skew_max_allowed_delay 0.100", template)
        self.assertIn("-opt_skew_apply_delay_limits_to_full_flow true", template)
        self.assertLess(template.index("setUsefulSkewMode"), template.index("place_opt_design"))


if __name__ == "__main__":
    unittest.main()
