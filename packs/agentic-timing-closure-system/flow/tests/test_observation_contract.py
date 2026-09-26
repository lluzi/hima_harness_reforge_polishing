"""Tests for `atcs.state` — M1's design state, input readiness, observation
capture and check comparison (the "observation contract").

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_observation_contract.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import state  # noqa: E402

import fixtures  # noqa: E402


class DesignStateTestBase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

        (self.root / "design.enc").write_text("enc-content")
        dat_dir = self.root / "design.enc.dat"
        dat_dir.mkdir()
        (dat_dir / "part-a.txt").write_text("part a")
        (dat_dir / "part-b.txt").write_text("part b")

        (self.root / "design.v").write_text("netlist")
        (self.root / "design.def").write_text("def")
        (self.root / "ssg_m40.spef").write_text("spef-ssg-m40")
        (self.root / "ffg_125.spef").write_text("spef-ffg-125")
        (self.root / "constraints.sdc").write_text("sdc")
        (self.root / "lib_slow.lib").write_text("lib")

    def base_manifest(self):
        return {
            "top": "swerv_wrapper",
            "stage": "postroute",
            "root": str(self.root),
            "database": {"enc": "design.enc", "encDat": "design.enc.dat"},
            "netlist": "design.v",
            "def": "design.def",
            "spef": {"ssg_m40": "ssg_m40.spef", "ffg_125": "ffg_125.spef"},
            "sdc": ["constraints.sdc"],
            "libraries": ["lib_slow.lib"],
            "scenarios": [
                {"name": "func_ssg_rcworst_m40", "corner": "ssg_m40"},
                {"name": "func_ffg_cbest_125", "corner": "ffg_125"},
            ],
        }


class DesignStateTest(DesignStateTestBase):
    def test_hashes_enc_and_tree_digests_encdat(self):
        result = state.design_state(self.base_manifest())

        self.assertEqual(result["schema"], "atcs.design-state/1")
        self.assertEqual(result["top"], "swerv_wrapper")
        self.assertEqual(result["database"]["sha256"], core.file_sha256(self.root / "design.enc"))
        self.assertEqual(result["database"]["datDigest"], core.tree_digest(self.root / "design.enc.dat"))
        self.assertEqual(result["netlist"]["sha256"], core.file_sha256(self.root / "design.v"))
        self.assertEqual(set(result["spef"]), {"ssg_m40", "ffg_125"})
        self.assertEqual(result["scenarios"], ["func_ssg_rcworst_m40", "func_ffg_cbest_125"])
        self.assertIsNone(result["parentId"])

    def test_def_is_null_when_omitted(self):
        manifest = self.base_manifest()
        del manifest["def"]
        result = state.design_state(manifest)
        self.assertIsNone(result["def"])

    def test_missing_encdat_directory_refuses(self):
        manifest = self.base_manifest()
        shutil.rmtree(self.root / "design.enc.dat")
        with self.assertRaises(core.AtcsError) as ctx:
            state.design_state(manifest)
        self.assertEqual(ctx.exception.code, "missing-input")


class InputReadinessMinimumInputsTest(DesignStateTestBase):
    def test_missing_sdc_gives_missing_count_one(self):
        manifest = self.base_manifest()
        manifest["sdc"] = ["absent.sdc"]

        result = state.input_readiness(manifest, site_capabilities={})

        self.assertEqual(result["missingCount"], {"value": 1})
        self.assertEqual(result["missing"], ["sdc:absent.sdc"])

    def test_all_present_gives_no_missing(self):
        result = state.input_readiness(self.base_manifest(), site_capabilities={})
        self.assertEqual(result["missing"], [])
        self.assertEqual(result["missingCount"], {"value": 0})


class InputReadinessLifecycleTest(DesignStateTestBase):
    def stage_files(self):
        stage_dir = self.root / "stages"
        stage_dir.mkdir()
        stages = {}
        for stage in state.REQUIRED_LIFECYCLE_STAGES:
            checkpoint = stage_dir / f"{stage}.checkpoint"
            script = stage_dir / f"{stage}.tcl"
            checkpoint.write_text(f"checkpoint for {stage}")
            script.write_text(f"script for {stage}")
            stages[stage] = {
                "checkpoint": str(checkpoint),
                "script": str(script),
            }
        return stages

    def test_manifest_without_lifecycle(self):
        manifest = self.base_manifest()
        self.assertNotIn("lifecycle", manifest)

        result = state.input_readiness(manifest, site_capabilities={})

        self.assertEqual(result["lifecycleAvailable"], {"value": 0})
        self.assertEqual(result["scope"], "post-route-only")
        self.assertEqual(result["lifecycleMissing"], ["lifecycle not provided"])

    def test_full_lifecycle_is_available_and_full_flow(self):
        manifest = self.base_manifest()
        manifest["lifecycle"] = {"stages": self.stage_files(), "flowConfig": ["step-a", "step-b"]}

        result = state.input_readiness(manifest, site_capabilities={})

        self.assertEqual(result["lifecycleAvailable"], {"value": 1})
        self.assertEqual(result["scope"], "full-flow")
        self.assertEqual(result["lifecycleMissing"], [])

    def test_lifecycle_missing_only_cts_checkpoint_stays_post_route_only(self):
        manifest = self.base_manifest()
        stages = self.stage_files()
        missing_checkpoint = Path(stages["cts"]["checkpoint"])
        missing_checkpoint.unlink()
        manifest["lifecycle"] = {"stages": stages, "flowConfig": ["step-a"]}

        result = state.input_readiness(manifest, site_capabilities={})

        self.assertEqual(result["lifecycleAvailable"], {"value": 0})
        self.assertEqual(result["scope"], "post-route-only")
        self.assertIn("cts checkpoint missing", result["lifecycleMissing"])
        # No partial-stage fallback scope is ever introduced.
        self.assertNotEqual(result["scope"], "cts-only")

    def test_unreadable_lifecycle_file_is_unknown_not_zero(self):
        manifest = self.base_manifest()
        stages = self.stage_files()
        manifest["lifecycle"] = {"stages": stages, "flowConfig": ["step-a"]}
        unreadable_path = str(Path(stages["cts"]["checkpoint"]))

        real_file_sha256 = core.file_sha256

        def side_effect(path):
            if str(path) == unreadable_path:
                raise PermissionError("permission denied (simulated)")
            return real_file_sha256(path)

        with mock.patch("atcs.core.file_sha256", side_effect=side_effect):
            result = state.input_readiness(manifest, site_capabilities={})

        self.assertIn("unknown", result["lifecycleAvailable"])
        self.assertEqual(result["scope"], "post-route-only")


class CaptureTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

        scenario_dir = self.root / "func_ssg_rcworst_m40"
        scenario_dir.mkdir()
        (scenario_dir / "global_timing.rpt").write_text(
            fixtures.global_report(-0.5, -1.2, 3, -0.1, -0.2, 1)
        )
        (scenario_dir / "setup.rpt").write_text(
            fixtures.path_report([("epA", -0.5), ("epB", -0.3)], "setup")
        )
        (scenario_dir / "hold.rpt").write_text(
            fixtures.path_report([("epC", -0.1)], "hold")
        )
        (scenario_dir / "check_timing.rpt").write_text(fixtures.check_timing_report(2))

        self.scenario_dir = scenario_dir

    def source_refs(self):
        return {
            "designStateId": "ds-0001",
            "scenarios": {
                "func_ssg_rcworst_m40": {
                    "globalTiming": str(self.scenario_dir / "global_timing.rpt"),
                    "setupPaths": str(self.scenario_dir / "setup.rpt"),
                    "holdPaths": str(self.scenario_dir / "hold.rpt"),
                    "checkTiming": str(self.scenario_dir / "check_timing.rpt"),
                },
            },
        }

    def test_missing_required_scenario_lists_it_and_marks_coverage_incomplete(self):
        query_spec = {
            "precision": "pba",
            "requiredScenarios": ["func_ssg_rcworst_m40", "func_ffg_cbest_125"],
            "maxPaths": 50,
        }

        result = state.capture(self.source_refs(), query_spec)

        self.assertEqual(result["missingScenarios"], ["func_ffg_cbest_125"])
        self.assertFalse(result["coverage"]["complete"])
        self.assertIn("func_ssg_rcworst_m40", result["scenarios"])

    def test_present_scenario_builds_check_keys(self):
        query_spec = {
            "precision": "pba",
            "requiredScenarios": ["func_ssg_rcworst_m40"],
            "maxPaths": 50,
        }

        result = state.capture(self.source_refs(), query_spec)

        self.assertTrue(result["coverage"]["complete"])
        setup_key = core.check_key("func_ssg_rcworst_m40", "setup", "epA")
        self.assertEqual(result["checks"][setup_key]["slack"], {"value": -0.5})
        self.assertEqual(result["checks"][setup_key]["startpoint"], "U_START_0")
        hold_key = core.check_key("func_ssg_rcworst_m40", "hold", "epC")
        self.assertEqual(result["checks"][hold_key]["slack"], {"value": -0.1})
        self.assertEqual(result["designStateId"], "ds-0001")
        self.assertEqual(result["precision"], "pba")


class CompareChecksTest(unittest.TestCase):
    def test_missing_from_truncated_current_is_missing_prior_not_fixed(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "epA")
        prior = {"checks": {key: {"slack": core.known(-0.5), "startpoint": "s", "pathGroup": "g"}}}
        current = {"checks": {}}

        result = state.compare_checks(prior, current, recheck=None)

        self.assertEqual(result["missingPrior"], [key])
        self.assertNotIn(key, result["fixed"])

    def test_recheck_resolves_missing_check_to_fixed(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "epA")
        prior = {"checks": {key: {"slack": core.known(-0.5), "startpoint": "s", "pathGroup": "g"}}}
        current = {"checks": {}}
        recheck = {key: core.known(0.01)}

        result = state.compare_checks(prior, current, recheck)

        self.assertEqual(result["fixed"], [key])
        self.assertEqual(result["missingPrior"], [])

    def test_non_negative_prior_gone_negative_is_regressed(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "epB")
        prior = {"checks": {key: {"slack": core.known(0.02), "startpoint": "s", "pathGroup": "g"}}}
        current = {"checks": {key: {"slack": core.known(-0.01), "startpoint": "s", "pathGroup": "g"}}}

        result = state.compare_checks(prior, current, {})

        self.assertEqual(result["regressed"], [key])

    def test_new_negative_check_is_entrant(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "epC")
        prior = {"checks": {}}
        current = {"checks": {key: {"slack": core.known(-0.03), "startpoint": "s", "pathGroup": "g"}}}

        result = state.compare_checks(prior, current, {})

        self.assertEqual(result["entrant"], [key])

    def test_negative_prior_still_negative_is_remaining(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "epD")
        prior = {"checks": {key: {"slack": core.known(-0.4), "startpoint": "s", "pathGroup": "g"}}}
        current = {"checks": {key: {"slack": core.known(-0.2), "startpoint": "s", "pathGroup": "g"}}}

        result = state.compare_checks(prior, current, {})

        self.assertEqual(result["remaining"], [key])


if __name__ == "__main__":
    unittest.main(verbosity=2)
