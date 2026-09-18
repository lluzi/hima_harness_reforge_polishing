#!/usr/bin/env python3
"""Reproduction: the fixed tap/DCAP plan is not bounded by the floorplan density budget.

Observed failure (trial.7, Run run-b8bddd3f-f41a-45ef-a448-4972e029026b):

    node      pnr-foundry
    Job       hima-b8bddd3f-pnr-foundry-6ae90c
    command   /usr/bin/python3 flow/stages.py pnr-foundry <workspace> 0.25
    exit code 3, elapsed 2726 s
    Innovus   **ERROR: (IMPSP-2002): Density too high (103.5%), stopping detail placement.
              **ERROR: (IMPSP-2021): Could not legalize <4661> instances in the design.
              **ERROR: (IMPSP-9022): Command 'refinePlace' completed with some error(s).

Mechanism the three tests below pin down, at the level the method itself is written in:

1. `flow/domain/init.tcl.tmpl` sizes the core from the logic-only netlist area at
   `utilization` (`floorPlan -site <site> -r 1.0 <utilization> 2.0 2.0 2.0 2.0`,
   built in `flow/stages.py:build_arm_files`), so a core utilisation of 0.25 leaves
   three quarters of a four-times-logic core free.
2. `flow/domain/pnr.tcl.tmpl` then fixes well taps (`addWellTap`, line 59) and a
   DCAP checkerboard (`addInst`, lines 66-99) into that core *before* placement. The
   checkerboard's only bounds are the row box, `@@DCAP_ROW_STRIDE@@` and
   `@@DCAP_X_PITCH_UM@@`; nothing relates the area it consumes to the core area or to
   `@@MAX_EFFECTIVE_DENSITY@@`.
3. The single comparison against `@@MAX_EFFECTIVE_DENSITY@@` (line 134) runs **after**
   `place_opt_design` (line 120), as an `error` raised once placement has already
   failed. The template's own comment ("DCAPs are fixed before logic placement and
   therefore count against the 85% effective occupancy budget") is therefore asserted
   but not enforced before placement.

These tests are intentionally satisfied by a *pre-placement* budget guard; they do not
prescribe where that guard lives.
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
    def test_density_ceiling_is_consulted_before_fixed_dcap_cells_are_inserted(self):
        template = pnr_template_without_comments()
        first_ceiling_use = template.index("MAX_EFFECTIVE_DENSITY")
        first_fixed_cell = template.index("addInst -cell")
        self.assertLess(
            first_ceiling_use,
            first_fixed_cell,
            "the effective-density ceiling is first used after the fixed DCAP "
            "checkerboard has already been inserted, so the pre-placement plan is "
            "not bounded by it",
        )

    def test_preplacement_occupancy_guard_precedes_place_opt_design(self):
        template = pnr_template_without_comments()
        comparison = template.index("> (@@MAX_EFFECTIVE_DENSITY@@")
        self.assertLess(
            comparison,
            template.index("place_opt_design"),
            "the only occupancy comparison against the ceiling runs after "
            "place_opt_design, so a design that cannot fit is only reported once "
            "Innovus has already failed to legalize it",
        )

    def test_pnr_stage_is_given_the_floorplan_utilization_it_must_budget_against(self):
        substitution = pnr_stage_substitution_block()
        self.assertIn(
            "utilization",
            substitution,
            "the stage that fixes taps and DCAPs is not given the floorplan "
            "utilization chosen by the init stage, so it cannot compute the "
            "residual area those fixed cells may consume",
        )


if __name__ == "__main__":
    unittest.main()
