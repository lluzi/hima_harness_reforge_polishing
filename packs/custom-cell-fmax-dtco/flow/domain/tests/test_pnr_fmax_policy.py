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
        self.assertIn("clock_opt_design -cts", template)
        self.assertIn("optDesign -postCTS -setup", template)
        self.assertLess(template.index("clock_opt_design -cts"), template.index("optDesign -postCTS -setup"))
        self.assertNotIn("\nclock_opt_design\n", template)

    def test_v5_reserves_pg_and_density_without_inserting_dcap(self):
        template = (DOMAIN / "pnr.tcl.tmpl").read_text()
        executable = "\n".join(line for line in template.splitlines()
                               if not line.lstrip().startswith("#"))
        self.assertIn("addRing -nets", template)
        self.assertIn("addStripe -nets", template)
        self.assertIn("sroute -connect {corePin floatingStripe}", template)
        self.assertNotIn("addInst -cell {@@DCAP_CELL@@}", executable)
        self.assertNotIn("HIMA_DCAP_R%03d_C%04d", executable)
        self.assertIn("set _hima_dcap_count 0", executable)
        self.assertIn("setPlaceMode -place_global_max_density @@MAX_EFFECTIVE_DENSITY@@", executable)
        self.assertIn("setOptMode -opt_max_density @@MAX_EFFECTIVE_DENSITY@@", executable)
        self.assertLess(template.index("addStripe -nets"), template.index("place_opt_design"))
        self.assertNotIn("addFiller -cell", template)
        self.assertIn("NO ORDINARY FILLER", template)


if __name__ == "__main__":
    unittest.main()
