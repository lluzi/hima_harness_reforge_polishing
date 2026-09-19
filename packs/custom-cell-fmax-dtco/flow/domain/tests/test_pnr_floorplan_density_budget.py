#!/usr/bin/env python3
"""Regression: the P&R method must not populate the core with fixed DCAP cells.

Observed failure (trial.7, Run run-b8bddd3f-f41a-45ef-a448-4972e029026b):

    node      pnr-foundry
    Job       hima-b8bddd3f-pnr-foundry-6ae90c
    command   /usr/bin/python3 flow/stages.py pnr-foundry <workspace> 0.25
    exit code 3, elapsed 2726 s
    Innovus   **ERROR: (IMPSP-2002): Density too high (103.5%), stopping detail placement.
              **ERROR: (IMPSP-2021): Could not legalize <4661> instances in the design.
              **ERROR: (IMPSP-9022): Command 'refinePlace' completed with some error(s).

Trial.8 inserted 33,215 fixed DCAP instances, reached 99.6% effective occupancy and
produced millions of DRC markers. The current method doubles the failure-baseline area,
sets placement/optimization max density to the reviewed 0.85 value, inserts no DCAP,
and reserves hard checks for physically impossible occupancy above 100%.
"""

from pathlib import Path
import unittest


DOMAIN = Path(__file__).resolve().parents[1]
PACK = DOMAIN.parents[1]
PNR_TEMPLATE = DOMAIN / "pnr.tcl.tmpl"
STAGE_SOURCE = PACK / "flow" / "stages.py"


def pnr_template():
    return PNR_TEMPLATE.read_text()


def pnr_template_without_comments():
    """The template's executable lines only, so placeholder prose cannot answer for code."""
    return "\n".join(
        line for line in pnr_template().splitlines()
        if not line.lstrip().startswith("#")
    )


def pnr_stage_substitution_block():
    """The argument mapping handed to the pnr template inside the stage source."""
    source = STAGE_SOURCE.read_text()
    marker = 'fill_template(DOMAIN / "pnr.tcl.tmpl", {'
    start = source.index(marker)
    end = source.index("\n        })", start)
    return source[start:end]


class PnrFloorplanDensityBudgetTests(unittest.TestCase):
    def test_no_dcap_instances_are_inserted(self):
        template = pnr_template_without_comments()
        self.assertNotIn("addInst -cell {@@DCAP_CELL@@}", template)
        self.assertNotIn("HIMA_DCAP_R%03d_C%04d", template)
        self.assertIn("set _hima_dcap_count 0", template)

    def test_fixed_cell_area_is_observed_with_the_common_density_cap(self):
        template = pnr_template_without_comments()
        required = [
            "set _hima_logic_area [_hima_standard_cell_area]",
            "set _hima_fixed_cell_area [expr {$_hima_planned_area - $_hima_logic_area}]",
            "set _hima_planned_occupancy [expr {$_hima_planned_area / $_hima_budget_core_area}]",
        ]
        for command in required:
            with self.subTest(command=command):
                self.assertIn(command, template)
        self.assertIn("setPlaceMode -place_global_max_density @@MAX_EFFECTIVE_DENSITY@@", template)
        self.assertIn("setOptMode -opt_max_density @@MAX_EFFECTIVE_DENSITY@@", template)

    def test_preplacement_occupancy_guard_precedes_place_opt_design(self):
        template = pnr_template_without_comments()
        comparison = template.index("> (1.0 + 1.0e-9)")
        self.assertLess(
            comparison,
            template.index("place_opt_design"),
            "a physically impossible plan above 100% must be rejected before placement",
        )
        self.assertIn("V5 post-CTS effective site occupancy exceeds", template)
        self.assertIn("V5 final effective site occupancy exceeds", template)

    def test_pnr_stage_is_given_the_floorplan_utilization_it_must_budget_against(self):
        substitution = pnr_stage_substitution_block()
        self.assertIn(
            "utilization",
            substitution,
            "the stage that fixes taps is not given the floorplan "
            "utilization chosen by the init stage, so it cannot compute the "
            "residual area those fixed cells may consume",
        )


if __name__ == "__main__":
    unittest.main()
