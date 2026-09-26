"""Tests for `atcs.lifecycle` (T11: residual-driven APR stage tasks).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_lifecycle.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import lifecycle  # noqa: E402


FULL_FLOW = {"scope": "full-flow", "lifecycleAvailable": core.known(1), "lifecycleMissing": []}
POST_ROUTE_ONLY = {"scope": "post-route-only", "lifecycleAvailable": core.known(0),
                    "lifecycleMissing": ["lifecycle not provided"]}


def _case(check_key, cell_delay=None, net_delay=None, slew=None, fanout=None, location=None):
    def _m(value):
        return core.unknown("no path detail observed") if value is None else core.known(value)

    return core.stamp("residual-case", {
        "checks": [check_key],
        "evidence": {
            "cellDelay": _m(cell_delay),
            "netDelay": _m(net_delay),
            "slew": _m(slew),
            "fanout": _m(fanout),
            "location": _m(location),
        },
        "attempts": [],
        "limits": [],
        "suggestedStage": None,
        "requiredInputs": [],
    })


ROUTE_DOMINATED = _case("func_ssg_rcworst_m40|setup|U_FF_1/D", cell_delay=0.05, net_delay=0.20)
SLEW_DOMINATED = _case("func_ssg_rcworst_m40|setup|U_FF_2/D", cell_delay=0.20, net_delay=0.05, slew=0.35)
FANOUT_AT_LOCATION = _case("func_ssg_rcworst_m40|hold|U_FF_3/D", fanout=24, location="U_DRV_3")
NO_EVIDENCE = _case("func_ssg_rcworst_m40|setup|U_FF_4/D")
INJECTION_LOCATION = _case("func_ssg_rcworst_m40|hold|U_FF_5/D", fanout=8, location="U_DRV; exec rm -rf /")


class CompileInterventionScopeTest(unittest.TestCase):
    def test_refuses_post_route_only_for_any_stage(self):
        for stage in ("place", "cts", "route", "postroute", "init", "bogus"):
            with self.assertRaises(core.AtcsError) as ctx:
                lifecycle.compile_intervention([ROUTE_DOMINATED], stage, POST_ROUTE_ONLY)
            self.assertEqual(ctx.exception.code, "lifecycle-unavailable")

    def test_refuses_stage_outside_the_verified_lifecycle(self):
        for stage in ("init", "bogus", "postcts_hold"):
            with self.assertRaises(core.AtcsError) as ctx:
                lifecycle.compile_intervention([ROUTE_DOMINATED], stage, FULL_FLOW)
            self.assertEqual(ctx.exception.code, "unsupported-stage")

    def test_raises_no_intervention_when_no_case_yields_a_setting(self):
        with self.assertRaises(core.AtcsError) as ctx:
            lifecycle.compile_intervention([NO_EVIDENCE], "route", FULL_FLOW)
        self.assertEqual(ctx.exception.code, "no-intervention")

    def test_empty_case_list_raises_no_intervention(self):
        with self.assertRaises(core.AtcsError) as ctx:
            lifecycle.compile_intervention([], "route", FULL_FLOW)
        self.assertEqual(ctx.exception.code, "no-intervention")


class CompileInterventionMappingTest(unittest.TestCase):
    def test_net_delay_dominated_evidence_yields_path_group_effort_setting(self):
        result = lifecycle.compile_intervention([ROUTE_DOMINATED], "route", FULL_FLOW)
        self.assertEqual(result["stage"], "route")
        self.assertIn("setPathGroupOptions", result["hookTcl"])
        self.assertIn("reg2reg", result["hookTcl"])
        self.assertNotIn("setUsefulSkewMode", result["hookTcl"])
        self.assertNotIn("createPlaceBlockage", result["hookTcl"])
        self.assertTrue(result["expected"])

    def test_cell_slew_dominated_evidence_yields_useful_skew_setting(self):
        result = lifecycle.compile_intervention([SLEW_DOMINATED], "cts", FULL_FLOW)
        self.assertIn("setUsefulSkewMode", result["hookTcl"])
        self.assertIn("set_ccopt_property", result["hookTcl"])
        self.assertNotIn("setPathGroupOptions", result["hookTcl"])

    def test_fanout_and_location_evidence_yields_placement_blockage_setting(self):
        result = lifecycle.compile_intervention([FANOUT_AT_LOCATION], "place", FULL_FLOW)
        self.assertIn("createPlaceBlockage", result["hookTcl"])
        self.assertIn("U_DRV_3", result["hookTcl"])
        self.assertIn("-type partial", result["hookTcl"])

    def test_unknown_evidence_contributes_no_setting_never_a_default(self):
        # Mixed with a case that DOES yield a setting, so compile succeeds overall,
        # but the unknown-evidence case must not itself inject any setting.
        result = lifecycle.compile_intervention([NO_EVIDENCE, ROUTE_DOMINATED], "route", FULL_FLOW)
        # Only the one setting from ROUTE_DOMINATED — no fabricated fallback setting.
        self.assertEqual(result["hookTcl"].count("setPathGroupOptions"), 1)

    def test_setattribute_weight_is_never_used(self):
        for case, stage in ((ROUTE_DOMINATED, "route"), (SLEW_DOMINATED, "cts"),
                             (FANOUT_AT_LOCATION, "place")):
            result = lifecycle.compile_intervention([case], stage, FULL_FLOW)
            self.assertNotIn("setAttribute", result["hookTcl"])

    def test_readback_queries_every_setting_the_hook_sets(self):
        result = lifecycle.compile_intervention(
            [ROUTE_DOMINATED, SLEW_DOMINATED, FANOUT_AT_LOCATION], "route", FULL_FLOW,
        )
        self.assertIn("reportPathGroupOptions", result["readbackTcl"])
        self.assertIn("getUsefulSkewMode", result["readbackTcl"])
        self.assertIn("get_ccopt_property", result["readbackTcl"])
        self.assertIn("writeFPlanScript", result["readbackTcl"])

    def test_outputs_key_present_and_empty_when_no_kind_writes_an_extra_file(self):
        result = lifecycle.compile_intervention([ROUTE_DOMINATED], "route", FULL_FLOW)
        self.assertEqual(result["outputs"], [])

    def test_outputs_key_carries_the_blockage_kinds_fplan_path(self):
        result = lifecycle.compile_intervention([FANOUT_AT_LOCATION], "place", FULL_FLOW)
        self.assertEqual(len(result["outputs"]), 1)
        self.assertIn("fplan_", result["outputs"][0])

    def test_rejects_evidence_that_would_inject_tcl_syntax(self):
        with self.assertRaises(core.AtcsError) as ctx:
            lifecycle.compile_intervention([INJECTION_LOCATION], "place", FULL_FLOW)
        self.assertEqual(ctx.exception.code, "invalid-value")


class StageTaskTest(unittest.TestCase):
    def setUp(self):
        self.intervention = lifecycle.compile_intervention([ROUTE_DOMINATED], "route", FULL_FLOW)

    def test_refuses_post_route_only_for_every_stage(self):
        for stage in ("place", "cts", "route", "postroute", "init", "bogus"):
            with self.assertRaises(core.AtcsError) as ctx:
                lifecycle.stage_task(stage, POST_ROUTE_ONLY, self.intervention, "workspaces/w01/r1")
            self.assertEqual(ctx.exception.code, "lifecycle-unavailable")

    def test_refuses_unsupported_stage(self):
        with self.assertRaises(core.AtcsError) as ctx:
            lifecycle.stage_task("init", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        self.assertEqual(ctx.exception.code, "unsupported-stage")

    def test_refuses_absolute_workspace_root(self):
        with self.assertRaises(core.AtcsError) as ctx:
            lifecycle.stage_task("route", FULL_FLOW, self.intervention,
                                  "/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation")
        self.assertEqual(ctx.exception.code, "absolute-workspace-root")

    def test_restores_the_matching_earlier_checkpoint(self):
        task = lifecycle.stage_task("route", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        self.assertIn("restoreDesign", task["tcl"])
        self.assertIn("cts.enc.dat", task["tcl"])
        self.assertNotIn("route.enc.dat", task["tcl"].split("restoreDesign", 1)[1].split("\n", 1)[0])

    def test_restores_init_checkpoint_for_place(self):
        place_intervention = lifecycle.compile_intervention([FANOUT_AT_LOCATION], "place", FULL_FLOW)
        task = lifecycle.stage_task("place", FULL_FLOW, place_intervention, "workspaces/w02/r1")
        restore_line = task["tcl"].split("restoreDesign", 1)[1].split("\n", 1)[0]
        self.assertIn("init.enc.dat", restore_line)

    def test_restores_route_checkpoint_for_postroute(self):
        postroute_intervention = lifecycle.compile_intervention([ROUTE_DOMINATED], "postroute", FULL_FLOW)
        task = lifecycle.stage_task("postroute", FULL_FLOW, postroute_intervention, "workspaces/w02/r1")
        restore_line = task["tcl"].split("restoreDesign", 1)[1].split("\n", 1)[0]
        self.assertIn("route.enc.dat", restore_line)
        self.assertNotIn("postroute.enc.dat", restore_line)

    def test_refuses_stage_mismatch_between_intervention_and_requested_stage(self):
        with self.assertRaises(core.AtcsError) as ctx:
            lifecycle.stage_task("cts", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        self.assertEqual(ctx.exception.code, "stage-mismatch")

    def test_blockage_output_path_is_carried_into_stage_task_outputs(self):
        blockage_intervention = lifecycle.compile_intervention([FANOUT_AT_LOCATION], "place", FULL_FLOW)
        self.assertTrue(blockage_intervention["outputs"], "expected compile_intervention to declare an output")
        task = lifecycle.stage_task("place", FULL_FLOW, blockage_intervention, "workspaces/w03/r1")
        fplan_outputs = [path for path in task["outputs"] if "fplan_" in path]
        self.assertTrue(fplan_outputs, task["outputs"])
        for path in fplan_outputs:
            self.assertTrue(path.startswith("workspaces/w03/r1/apr/place/"), path)

    def test_stage_command_matches_the_requested_stage(self):
        place_intervention = lifecycle.compile_intervention([FANOUT_AT_LOCATION], "place", FULL_FLOW)
        task = lifecycle.stage_task("place", FULL_FLOW, place_intervention, "workspaces/w02/r1")
        self.assertIn("place_opt_design", task["tcl"])
        cts_intervention = lifecycle.compile_intervention([SLEW_DOMINATED], "cts", FULL_FLOW)
        task = lifecycle.stage_task("cts", FULL_FLOW, cts_intervention, "workspaces/w02/r1")
        self.assertIn("clock_opt_design", task["tcl"])

    def test_outputs_are_written_under_apr_stage_id(self):
        task = lifecycle.stage_task("route", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        self.assertTrue(task["outputs"], "expected at least one declared output path")
        for output in task["outputs"]:
            self.assertTrue(output.startswith("workspaces/w01/r1/apr/route/"), output)
        for output in task["outputs"]:
            self.assertNotIn("swerv_wrapper_tsmc28", output)

    def test_inputs_and_tcl_never_carry_the_foundation_root(self):
        task = lifecycle.stage_task("route", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        foundation_root = "/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation"
        self.assertNotIn(foundation_root, task["tcl"])
        for path in task["inputs"] + task["outputs"]:
            self.assertFalse(path.startswith("/"), path)
            self.assertNotIn(foundation_root, path)

    def test_hook_and_readback_content_is_embedded_in_the_stage_tcl(self):
        task = lifecycle.stage_task("route", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        self.assertIn("setPathGroupOptions", task["tcl"])
        self.assertIn("reportPathGroupOptions", task["tcl"])

    def test_same_intervention_and_workspace_are_deterministic(self):
        task_a = lifecycle.stage_task("route", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        task_b = lifecycle.stage_task("route", FULL_FLOW, self.intervention, "workspaces/w01/r1")
        self.assertEqual(task_a["tcl"], task_b["tcl"])
        self.assertEqual(task_a["outputs"], task_b["outputs"])


if __name__ == "__main__":
    unittest.main()
