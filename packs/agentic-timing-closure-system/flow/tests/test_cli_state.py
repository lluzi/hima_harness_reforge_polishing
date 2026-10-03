"""Tests for Task 12b: state-driven CLI inputs (`flow/atcs_cli.py`).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_cli_state.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

No test here launches EDA or SSH: every subcommand that would launch a real
tool (`implement`, `extract`, `sta`, `apr-run`) is driven as a subprocess
against a fake, local, no-op wrapper script (`FAKE_WRAPPER`, `exit 0`) --
never a real Innovus/StarRC/PrimeTime/XTop binary or SSH. Every file such a
tool would have produced is pre-created by the test itself, at the exact
deterministic path the dispatcher will look for it (computed the same way
the dispatcher computes it, by calling the same pure M4/M5 functions with
the same inputs) -- so the CLI's own post-`run_tool` existence/identity
checks pass without any real tool ever running.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import state  # noqa: E402
from atcs import workspaces  # noqa: E402
from atcs import contributions  # noqa: E402
from atcs import composition  # noqa: E402
from atcs import integration  # noqa: E402
from atcs import adapters  # noqa: E402
import fixtures  # noqa: E402
import atcs_cli  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
NEXT_DECISION_REL_PATH = atcs_cli.NEXT_DECISION_REL_PATH
REQUIRED_SCENARIOS = ("func_ssg_rcworst_m40", "func_ssg_rcworst_125", "func_ffg_cbest_m40", "func_ffg_cbest_125")
CORNER = "corner1"
# I1 (final review): `corners.json` now maps {corner: templatePath} -- every test that
# used to write a bare corner-name list points its corner(s) at this Pack's own
# real, shipped fallback template instead (a genuine file StarRC's `patch`-style
# substitution can act on), never a synthetic string.
STARRC_TEMPLATE_PATH = FLOW_DIR / "templates" / "starrc.cmd"


def _tmp():
    return Path(tempfile.mkdtemp(prefix="atcs-cli-state-"))


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


def _write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _no_op_wrapper(root):
    """A fake `edaShell` wrapper that never launches anything real (`exit 0`)."""
    wrapper = root / "fake-wrapper.sh"
    wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    wrapper.chmod(0o755)
    return wrapper


def _site_profile_path(root, xtop_scenarios=None):
    """`siteCapabilities.json` -- `edaShell` is all most subcommands read; `design`/
    `techLef`/`cellLefGlob` are also included (I3, final review: `replay-prepare`
    now reads these three the same way `prepare-workers` already did) as plain,
    non-empty placeholder strings -- the fake no-op wrapper never actually launches
    XTop, so nothing here needs to resolve to a real file on disk.

    Issue 63: `starrcHome` is declared here too (a toolkit dir with a real
    `linux64_starrc/lib` on disk), so `extract`'s StarXtract-toolkit resolution
    finds it directly -- the fake no-op wrapper (`exit 0`, no stdout) can't answer
    the `discover_starrc_toolkit` probe, so every extract-driving test needs this
    declared override to keep resolving the toolkit at all.
    """
    wrapper = _no_op_wrapper(root)
    starrc_home = root / "starrc-toolkit"
    (starrc_home / "linux64_starrc" / "lib").mkdir(parents=True, exist_ok=True)
    path = root / "site-profile.json"
    profile = {
        "edaShell": [str(wrapper)], "design": "top",
        "techLef": str(root / "tech.lef"), "cellLefGlob": str(root / "cells" / "*.lef"),
        "starrcHome": str(starrc_home),
    }
    if xtop_scenarios is not None:
        profile.update(_xtop_site_config(root, xtop_scenarios))
    _write_json(path, profile)
    return path


def _xtop_site_config(workspace, required_scenarios):
    runtime = {
        "siteMap": ["unit", "core"], "removableFillers": ["FILL*", "DCAP*"],
        "scenarios": [],
        "ecoParameters": {
            "bufferListForHold": ["DELAY1"], "bufferListForSetup": ["BUF2"],
            "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
            "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"],
            "cellNominalSizingPattern": "D([0-9]+)BWP", "gainThreshold": 0.001,
        },
    }
    for index, scenario in enumerate(required_scenarios):
        library_dir = workspace / "xtop-context" / "libs" / f"corner-{index}"
        library_dir.mkdir(parents=True, exist_ok=True)
        (library_dir / "synthetic.lib").write_text("library(synthetic) {}\n", encoding="utf-8")
        runtime["scenarios"].append({
            "name": scenario, "corner": f"corner-{index}", "libertyGlob": str(library_dir / "*.lib"),
        })
    return {"xtopContext": runtime}


def _write_xtop_context(workspace, design_state_id, required_scenarios=REQUIRED_SCENARIOS):
    """Write one synthetic, fully hash-bound worker/replay context; no EDA is launched."""
    site_config = _xtop_site_config(workspace, required_scenarios)
    compiled = adapters.compile_xtop_site_context(site_config, required_scenarios)
    library_tcl = workspace / "xtop-context" / "library.tcl"
    library_tcl.parent.mkdir(parents=True, exist_ok=True)
    library_tcl.write_text(compiled["libraryTcl"], encoding="utf-8")
    sta_data = workspace / "xtop-context" / "sta_data"
    sta_data.mkdir(parents=True, exist_ok=True)
    (sta_data / "timing_data_finish").write_text("done\n", encoding="utf-8")
    body = core.stamp("xtop-context", {
        "designStateId": design_state_id,
        "requiredScenarios": list(required_scenarios),
        "libraryTcl": {"path": str(library_tcl.relative_to(workspace)), "sha256": core.file_sha256(library_tcl)},
        "staData": {"path": str(sta_data.relative_to(workspace)), "digest": core.tree_digest(sta_data)},
        "libraryFiles": compiled["libraryFiles"], "siteMap": compiled["siteMap"],
        "removableFillers": compiled["removableFillers"], "ecoParameters": compiled["ecoParameters"],
    })
    core.write_artifact(workspace / "state" / "xtop-context.json", body)
    return site_config


def _run_physical_baseline(workspace, drc_text=None, connectivity_text=None):
    """I13 (final review): `physical baseline` now runs `adapters.compile_innovus_export_task`
    itself against `state/baseline.json`'s own staged database -- no real Innovus runs in
    tests (the fake no-op wrapper), so the exact output path that task computes
    (`baseline/physical/RPT/verify_{drc,connectivity}.rpt`) is pre-seeded here instead,
    mirroring this suite's established fake-EDA-wrapper convention."""
    output_root = workspace / "baseline" / "physical" / "RPT"
    _write_text(output_root / "verify_drc.rpt", drc_text if drc_text is not None else fixtures.drc_report([]))
    _write_text(
        output_root / "verify_connectivity.rpt",
        connectivity_text if connectivity_text is not None else fixtures.connectivity_report([]),
    )
    site_profile_path = _site_profile_path(workspace)
    return _run("physical", workspace, site_profile_path, "baseline")


def _scenarios_contract_path(workspace, corner=None, filename="scenarios.json"):
    """A real `analysisContract/scenarios.json` fixture (C4, final review): every
    required scenario shares one `corner` and one real, on-disk `.db` library file
    this call creates -- `adapters.hash_library_glob` globs the actual filesystem, so
    a fixture (unlike the old bare `{scenario: corner}` map) must name a glob that
    genuinely matches something, or every PT-launching subcommand refuses before
    ever compiling a task."""
    corner = corner if corner is not None else CORNER
    lib_dir = workspace / "libs"
    lib_dir.mkdir(parents=True, exist_ok=True)
    lib_file = lib_dir / "lib.db"
    if not lib_file.is_file():
        lib_file.write_bytes(b"fake-lib-cell\n")
    scenarios = [
        {
            "name": scenario, "corner": corner, "libGlob": str(lib_dir / "*.db"),
            "driverLibrary": "driver_lib", "originalDriverLibrary": "driver_lib",
        }
        for scenario in REQUIRED_SCENARIOS
    ]
    path = workspace / filename
    _write_json(path, scenarios)
    return path


def _run(subcommand, workspace, *args):
    result = subprocess.run(
        [sys.executable, str(CLI_PATH), subcommand, str(workspace), *[str(a) for a in args]],
        capture_output=True, text=True,
    )
    return result


def _clean_reports(setup_wns=0.05, hold_wns=0.03):
    """One `{global_timing.rpt, setup.rpt, hold.rpt, check_timing.rpt}` set: clean, complete, goal-meeting."""
    return {
        "global_timing.rpt": fixtures.global_report(setup_wns, "0.00", "0", hold_wns, "0.00", "0"),
        "setup.rpt": fixtures.path_report([], "setup"),
        "hold.rpt": fixtures.path_report([], "hold"),
        "check_timing.rpt": fixtures.check_timing_report(0),
    }


def _write_report_set(directory, reports):
    directory.mkdir(parents=True, exist_ok=True)
    for name, text in reports.items():
        (directory / name).write_text(text, encoding="utf-8")


def _make_baseline_manifest(workspace):
    """Write tiny, real files for a `state.design_state` manifest covering every REQUIRED_SCENARIOS entry."""
    (workspace / "db.enc").write_bytes(b"encrypted-database-bytes")
    dat_dir = workspace / "db.enc.dat"
    dat_dir.mkdir(parents=True, exist_ok=True)
    (dat_dir / "manifest.txt").write_text("dat contents\n", encoding="utf-8")
    # `U1` is a real declared leaf-cell instance directly under `top` so the
    # Reader's hierarchical-instance check (T63) admits the bare instance
    # name this test suite's `worker-request` fixtures already use for it.
    (workspace / "netlist.v").write_text("module top();\n  SOME_CELL U1 (.A(a));\nendmodule\n", encoding="utf-8")
    (workspace / "constraints.sdc").write_text("create_clock -period 1.0 clk\n", encoding="utf-8")
    (workspace / f"{CORNER}.spef").write_text("*SPEF IEEE 1481-1999\n", encoding="utf-8")
    return {
        "top": "top", "stage": "postroute", "root": str(workspace),
        "database": {"enc": "db.enc", "encDat": "db.enc.dat"},
        "netlist": "netlist.v",
        "spef": {CORNER: f"{CORNER}.spef"},
        "sdc": ["constraints.sdc"],
        "scenarios": [{"name": name, "corner": CORNER} for name in REQUIRED_SCENARIOS],
    }


def _baseline_observation(workspace, base_state):
    """Build a real, complete, clean `observation-set` for `base_state` (no CLI/EDA involved)."""
    report_root = workspace / "baseline-pt"
    scenario_refs = {}
    for scenario in REQUIRED_SCENARIOS:
        directory = report_root / scenario
        _write_report_set(directory, _clean_reports())
        scenario_refs[scenario] = {
            "globalTiming": str(directory / "global_timing.rpt"), "setupPaths": str(directory / "setup.rpt"),
            "holdPaths": str(directory / "hold.rpt"), "checkTiming": str(directory / "check_timing.rpt"),
        }
    source_refs = {"designStateId": base_state["id"], "scenarios": scenario_refs}
    query_spec = {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000}
    return state.capture(source_refs, query_spec)


def _analysis_contract_dir(root, **policy_overrides):
    """C4 (final review): `scenarioCorners`/`requiredScenarios` are no longer part of
    the static `policy.json` fixture at all -- `policy` now derives both from
    `scenarios.json` (`_scenarios_contract_path`, written into this same directory),
    the single source every PT-launching subcommand's own corner lookup also reads."""
    directory = root / "analysis-contract"
    policy = {"allowDegradedWorking": False, "degradeLimitNs": 0.0, "maxNewConstraintFailures": 0}
    policy.update(policy_overrides)
    _write_json(directory / "policy.json", policy)
    _scenarios_contract_path(directory)
    return directory


def _sha256_matching_empty_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    (path / "placeholder.txt").write_text("placeholder\n", encoding="utf-8")


def _valid_scenario_entry(name, **overrides):
    entry = {
        "name": name, "corner": CORNER, "libGlob": "/tmp/unused-*.db",
        "driverLibrary": "driver_lib", "originalDriverLibrary": "driver_lib",
    }
    entry.update(overrides)
    return entry


class LoadScenariosContractTest(unittest.TestCase):
    """C4 (final review): `atcs_cli._load_scenarios_contract` -- the single admission
    point for `analysisContract/scenarios.json`, the new per-scenario corner + PT
    library identity source that replaces the old bare `scenario-corners.json`."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def _write(self, obj):
        path = self.workspace / "scenarios.json"
        _write_json(path, obj)
        return path

    def test_valid_document_returns_a_name_keyed_map(self):
        doc = [_valid_scenario_entry(name) for name in REQUIRED_SCENARIOS]
        result = atcs_cli._load_scenarios_contract(self._write(doc))
        self.assertEqual(set(result), set(REQUIRED_SCENARIOS))
        self.assertEqual(result["func_ssg_rcworst_m40"]["corner"], CORNER)

    def test_not_a_list_is_refused(self):
        with self.assertRaises(atcs_cli.InputError) as ctx:
            atcs_cli._load_scenarios_contract(self._write({"not": "a list"}))
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_two_different_site_scenario_sets_are_accepted(self):
        for names in (("slow_setup", "fast_hold"), ("mode_a_rcmax", "mode_b_rcmin", "scan_slow")):
            doc = [_valid_scenario_entry(name) for name in names]
            result = atcs_cli._load_scenarios_contract(self._write(doc))
            self.assertEqual(tuple(result), names)

    def test_query_scenario_set_must_match_the_site_contract(self):
        contract = atcs_cli._load_scenarios_contract(
            self._write([_valid_scenario_entry("slow_setup"), _valid_scenario_entry("fast_hold")]),
        )
        with self.assertRaises(atcs_cli.InputError) as ctx:
            atcs_cli._required_scenarios_for_contract(
                {"requiredScenarios": ["slow_setup", "unexpected"]}, contract,
            )
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_duplicate_query_scenario_is_refused(self):
        contract = atcs_cli._load_scenarios_contract(
            self._write([_valid_scenario_entry("slow_setup"), _valid_scenario_entry("fast_hold")]),
        )
        with self.assertRaises(atcs_cli.InputError) as ctx:
            atcs_cli._required_scenarios_for_contract(
                {"requiredScenarios": ["slow_setup", "slow_setup"]}, contract,
            )
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_duplicate_scenario_name_is_refused(self):
        doc = [_valid_scenario_entry(name) for name in REQUIRED_SCENARIOS] + [
            _valid_scenario_entry(REQUIRED_SCENARIOS[0])
        ]
        with self.assertRaises(atcs_cli.InputError) as ctx:
            atcs_cli._load_scenarios_contract(self._write(doc))
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_entry_missing_a_field_is_refused(self):
        doc = [_valid_scenario_entry(name) for name in REQUIRED_SCENARIOS]
        del doc[0]["libGlob"]
        with self.assertRaises(atcs_cli.InputError) as ctx:
            atcs_cli._load_scenarios_contract(self._write(doc))
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_empty_field_value_is_refused(self):
        doc = [_valid_scenario_entry(name) for name in REQUIRED_SCENARIOS]
        doc[0]["driverLibrary"] = ""
        with self.assertRaises(atcs_cli.InputError) as ctx:
            atcs_cli._load_scenarios_contract(self._write(doc))
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_derive_scenario_corners_maps_each_scenario_to_its_own_corner(self):
        doc = [_valid_scenario_entry(name, corner=f"corner-{name}") for name in REQUIRED_SCENARIOS]
        contract = atcs_cli._load_scenarios_contract(self._write(doc))
        corners = atcs_cli._derive_scenario_corners(contract)
        self.assertEqual(corners, {name: f"corner-{name}" for name in REQUIRED_SCENARIOS})


class FlowDigestTest(unittest.TestCase):
    """I8 (final review, whole-flow integrity): `flow-digest` prints a deterministic
    digest over exactly what `contract.yml`'s `workspace.copy` deploys (atcs_cli.py,
    atcs/, templates/) -- never `flow/tests/`, and never a stray file living beside
    the deployed tree."""

    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "atcs_cli.py").write_text("print('cli')\n", encoding="utf-8")
        (self.tmp / "atcs").mkdir()
        (self.tmp / "atcs" / "core.py").write_text("X = 1\n", encoding="utf-8")
        (self.tmp / "templates").mkdir()
        (self.tmp / "templates" / "a.tcl").write_text("puts hi\n", encoding="utf-8")

    def test_deterministic_across_repeated_calls(self):
        first = atcs_cli.flow_digest(self.tmp)
        second = atcs_cli.flow_digest(self.tmp)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)
        int(first, 16)  # raises ValueError if not hex

    def test_changing_a_deployed_file_changes_the_digest(self):
        before = atcs_cli.flow_digest(self.tmp)
        (self.tmp / "atcs" / "core.py").write_text("X = 2\n", encoding="utf-8")
        after = atcs_cli.flow_digest(self.tmp)
        self.assertNotEqual(before, after)

    def test_python_import_cache_does_not_change_the_deployed_method_identity(self):
        before = atcs_cli.flow_digest(self.tmp)
        cache = self.tmp / "atcs" / "__pycache__"
        cache.mkdir()
        (cache / "core.cpython-312.pyc").write_bytes(b"generated import cache")
        self.assertEqual(before, atcs_cli.flow_digest(self.tmp))

    def test_a_file_outside_the_deployed_roots_never_affects_the_digest(self):
        """`flow/tests/` (and anything else beside the deployed tree) is never
        copied into a Campaign workspace -- it must not be able to change the
        pinned digest at all."""
        before = atcs_cli.flow_digest(self.tmp)
        (self.tmp / "tests").mkdir()
        (self.tmp / "tests" / "test_whatever.py").write_text("assert True\n", encoding="utf-8")
        (self.tmp / "some-other-file.txt").write_text("irrelevant\n", encoding="utf-8")
        after = atcs_cli.flow_digest(self.tmp)
        self.assertEqual(before, after)

    def test_missing_a_deployed_root_is_refused(self):
        shutil.rmtree(self.tmp / "templates")
        with self.assertRaises(core.AtcsError) as ctx:
            atcs_cli.flow_digest(self.tmp)
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_cli_subcommand_prints_the_same_digest_and_writes_no_output(self):
        result = subprocess.run(
            [sys.executable, str(CLI_PATH), "flow-digest", str(self.tmp)], capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        printed = result.stdout.strip()
        self.assertEqual(printed, atcs_cli.flow_digest(self.tmp))
        self.assertFalse((self.tmp / "state").exists())

    def test_cli_subcommand_defaults_to_this_files_own_directory(self):
        """No explicit flow-dir argument -- digests the real, deployed `flow/` this
        atcs_cli.py itself lives in."""
        result = subprocess.run([sys.executable, str(CLI_PATH), "flow-digest"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(result.stdout.strip()), 64)
        int(result.stdout.strip(), 16)


class IsStaleBaseTest(unittest.TestCase):
    """Minor (final review): `atcs_cli._is_stale_base` is the one shared "stale base"
    comparison `compose-facts`'s own plan-vs-working-state check and `replay-
    prepare`'s own base-vs-facts check both now use, instead of each independently
    re-writing the identical `!=`."""

    def test_matching_ids_are_not_stale(self):
        self.assertFalse(atcs_cli._is_stale_base("state-1", "state-1"))

    def test_differing_ids_are_stale(self):
        self.assertTrue(atcs_cli._is_stale_base("state-1", "state-2"))

    def test_a_missing_candidate_id_is_stale(self):
        self.assertTrue(atcs_cli._is_stale_base(None, "state-1"))


class BaselineStagesLifecycleCheckpointsTest(unittest.TestCase):
    """I2 (final review): `atcs.lifecycle.stage_task` has always restored
    `./DBS/<prevStage>.enc.dat`, workspace-relative -- but nothing ever staged a
    checkpoint there before this fix. `baseline` now does, whenever the manifest
    declares a `lifecycle` block."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def _manifest_with_lifecycle(self, stages=state.REQUIRED_LIFECYCLE_STAGES):
        manifest = _make_baseline_manifest(self.workspace)
        lifecycle_stages = {}
        for stage in stages:
            (self.workspace / f"{stage}.enc").write_bytes(f"restore script for {stage}".encode("utf-8"))
            data_dir = self.workspace / f"{stage}.enc.dat"
            data_dir.mkdir(parents=True, exist_ok=True)
            (data_dir / "session.txt").write_text(f"{stage} session\n", encoding="utf-8")
            lifecycle_stages[stage] = {"checkpoint": f"{stage}.enc.dat", "script": f"{stage}.enc"}
        manifest["lifecycle"] = {"stages": lifecycle_stages, "flowConfig": ["FF/vars.tcl"]}
        return manifest

    def test_every_declared_stage_is_staged_at_the_fixed_dbs_path(self):
        manifest = self._manifest_with_lifecycle()
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for stage in state.REQUIRED_LIFECYCLE_STAGES:
            script = self.workspace / "DBS" / f"{stage}.enc"
            data = self.workspace / "DBS" / f"{stage}.enc.dat"
            self.assertTrue(script.is_file(), script)
            self.assertTrue(data.is_dir(), data)
            self.assertEqual(script.read_bytes(), f"restore script for {stage}".encode("utf-8"))
            self.assertTrue((data / "session.txt").is_file())

    def test_no_lifecycle_block_stages_nothing_and_still_succeeds(self):
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.workspace / "DBS").exists())

    def test_a_declared_stage_missing_its_checkpoint_file_is_refused(self):
        manifest = self._manifest_with_lifecycle()
        # A declared checkpoint the manifest claims exists, but does not -- unlike
        # "stage absent from lifecycle.stages entirely" (silently skipped), a stage
        # that IS declared must actually be stageable, or this must fail loudly.
        shutil.rmtree(self.workspace / "place.enc.dat")
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertFalse((self.workspace / "state" / "baseline.json").exists())


class TwoRoundFlowTest(unittest.TestCase):
    """G1/G7: `state/working-state.json` propagates the adopted candidate's id
    across a second round, never re-basing on the original baseline."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def _build_fix_contribution(self, base_state, task_id="w01", instance="U1"):
        """A real, admissible, single-op `size_cell` fix contribution sealed against `base_state`."""
        work_package_raw = {
            "taskId": task_id, "baseStateId": base_state["id"], "problem": "resize U1",
            "targets": [], "editDomain": {"instances": [instance], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [],
            "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            "targetPins": [], "scope": {"commands": ["atcs_size_cell", "atcs_undo"], "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
        }
        validated = workspaces.validate_work_package(work_package_raw, base_state, {"pgVerification": False})
        manifest = workspaces.prepare(validated, str(self.workspace), base_state)
        ops_text = json.dumps({"op": "size_cell", "instance": instance, "fromMaster": "BUFX1", "toMaster": "BUFX2"})
        root = self.workspace / manifest["root"]
        before_dump = root / "before.dump"
        after_dump = root / "after.dump"
        before_dump.write_text(f"{instance} BUFX1\n", encoding="utf-8")
        after_dump.write_text(f"{instance} BUFX2\n", encoding="utf-8")
        base_ref = {"stateId": base_state["id"], "workspaceManifest": manifest, "workPackage": validated}
        result_refs = {
            "beforeDump": str(before_dump), "afterDump": str(after_dump), "script": None,
            "predicted": {"xtopSetupWns": core.known(0.05), "xtopHoldWns": core.known(0.03)},
            "diagnosis": None, "cones": [],
        }
        contribution = contributions.seal(base_ref, result_refs, ops_text)
        self.assertTrue(contribution["admissible"], contribution.get("refusals"))
        return contribution, validated

    def _run_implement_round(self, base_state, instance, max_paths_cap="5000"):
        """Compose one real fix, replay+reconcile it directly (M4/M5, no XTop), then run
        `implement`/`extract`/`sta`/`physical`/`evaluate`/`adopt` as real subprocesses
        against a no-op EDA wrapper, pre-creating every file those tools would have
        produced at their deterministic paths."""
        workspace = self.workspace
        contribution, work_package = self._build_fix_contribution(base_state, instance=instance)
        collected = {"contributions": [contribution]}
        _write_json((workspace / "state" / "contributions-collected.json"), collected)

        facts = composition.analyze(base_state["id"], [contribution], [])
        plan_raw = {
            "batchId": f"batch-{instance}", "baseStateId": base_state["id"],
            "select": [contribution["id"]], "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        self.assertEqual(len(request["steps"]), 1)
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {instance: ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        self.assertEqual(integration_state["applied"], {step["stepId"]: receipt["observedDelta"]})

        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        merge_commit = integration.seal_batch(integration_state, request, facts, [contribution])
        merge_id = merge_commit["id"]
        impl_root = workspace / "implementations" / merge_id

        design_bytes = f"database for {merge_id}".encode("utf-8")
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS" / "top.enc").write_bytes(design_bytes)
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(workspace)
        current_state_path = workspace / f"current-state-{instance}.json"
        _write_json(current_state_path, base_state)
        result = _run("implement", workspace, current_state_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        implement = json.loads((workspace / "state" / "implement.json").read_text())
        self.assertEqual(implement["mergeCommitId"], merge_id)
        self.assertEqual(implement["parentStateId"], base_state["id"])

        for corner in (CORNER,):
            spef_path = impl_root / "starrc" / corner / f"top.{corner}.spef"
            _write_text(spef_path, "*SPEF IEEE 1481-1999\n")
        corners_path = workspace / f"corners-{instance}.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())
        query_spec_path = workspace / f"query-spec-{instance}.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        # Fix round 2 item 2: SDC comes from base_design_state's own recorded sdc[0]
        # (sha256-verified), never a separate analysisContract/sdc.json copy.
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / f"base-design-state-{instance}.json"
        _write_json(base_design_state_path, base_state)
        result = _run("sta", workspace, query_spec_path, scenario_corners_path,
                       base_design_state_path, site_profile_path, str(max_paths_cap))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        sta = json.loads((workspace / "state" / "sta.json").read_text())
        candidate_state_id = sta["designStateId"]

        result = _run("physical", workspace, "candidate")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        result = _run("evaluate", workspace, workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evaluation = json.loads((workspace / "state" / "evaluation.json").read_text())
        self.assertEqual(core.value_of(evaluation["missingRequiredCheckCount"]), 0)
        self.assertEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 0)

        result = _run("adopt", workspace, workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        envelope = json.loads((workspace / "accepted" / "latest.json").read_text())
        acceptance_record = json.loads((workspace / envelope["acceptanceRecord"]).read_text())
        self.assertNotEqual(acceptance_record["decision"], "refused")
        return candidate_state_id

    def test_two_round_flow_uses_adopted_state_id(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        _write_json(manifest_path, manifest)
        result = _run("baseline", workspace, manifest_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        working_state = json.loads((workspace / "state" / "working-state.json").read_text())
        self.assertEqual(working_state["id"], baseline["id"])

        baseline_observation = _baseline_observation(workspace, baseline)
        core.write_artifact(workspace / "state" / "observation.json", baseline_observation)

        contract_dir = _analysis_contract_dir(workspace)
        result = _run("policy", workspace, contract_dir, "0.0", "0.0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        policy = json.loads((workspace / "state" / "policy.json").read_text())
        self.assertEqual(policy["baselineStateId"], baseline["id"])
        self.assertAlmostEqual(policy["baselineMinWns"], 0.03)

        result = _run_physical_baseline(workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        # --- Round 1 ---
        round1_state_id = self._run_implement_round(baseline, instance="U1")
        working_state_after_round1 = json.loads((workspace / "state" / "working-state.json").read_text())
        self.assertEqual(working_state_after_round1["id"], round1_state_id)
        self.assertNotEqual(round1_state_id, baseline["id"])

        # --- Round 2: compose-facts and prepare-workers must use the ADOPTED state's id ---
        # No integration plan has been admitted yet for round 2 -- Task 12c item 4c's
        # first pass: an absent plan path means resolutions=[] (never a separate
        # resolutions.json).
        plan_path = workspace / "integration-plan.json"
        result = _run("compose-facts", workspace, plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts_round2 = json.loads((workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(facts_round2["baseStateId"], round1_state_id)
        self.assertNotEqual(facts_round2["baseStateId"], baseline["id"])
        xtop_site = _write_xtop_context(workspace, round1_state_id)

        eda_profile_path = workspace / "eda-profile.json"
        _write_json(eda_profile_path, {
            "design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef", **xtop_site,
        })
        site_caps_path = workspace / "site-caps.json"
        _write_json(site_caps_path, {"pgVerification": False})
        # Task 12c item 4a + Fix round 1 item 1: `prepare-workers` reads
        # `candidate.workPackages` of the ONE admitted campaign-plan envelope,
        # never three separate work-package-w0N.json files and never a second,
        # top-level `workPackages` copy.
        work_packages = {
            task_id: {
                "taskId": task_id, "baseStateId": round1_state_id, "problem": "round 2",
                "targets": [], "editDomain": {"instances": [], "nets": [], "regions": []},
                "protected": {"instances": [], "nets": []}, "mayAffect": [],
                "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
                "targetPins": [], "scope": {"commands": ["atcs_size_cell", "atcs_undo"], "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
            }
            for task_id in workspaces.TASK_IDS
        }
        campaign_plan_path = workspace / "campaign-plan-round2.json"
        _write_json(campaign_plan_path, {
            "candidate": {"workPackages": work_packages, "reason": "round 2 plan"},
            "baseState": working_state_after_round1, "siteCapabilities": {"pgVerification": False},
        })
        working_state_path = workspace / "state" / "working-state.json"
        result = _run("prepare-workers", workspace, working_state_path, site_caps_path,
                       eda_profile_path, campaign_plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        workers = json.loads((workspace / "state" / "workers.json").read_text())
        for task_id in workspaces.TASK_IDS:
            self.assertEqual(workers["workers"][task_id]["workPackage"]["baseStateId"], round1_state_id)

        # --- Round 2's own implement/evaluate/adopt: CAS must succeed against the
        # NOW-current working state, never the original baseline ---
        round1_working_state = json.loads(working_state_path.read_text())
        round2_state_id = self._run_implement_round(round1_working_state, instance="U2")
        self.assertNotEqual(round2_state_id, round1_state_id)
        working_state_after_round2 = json.loads(working_state_path.read_text())
        self.assertEqual(working_state_after_round2["id"], round2_state_id)


class StaleXtopContextAfterAdoptTest(TwoRoundFlowTest):
    """#64 Track B (from #63's dry path): after a physical refresh is adopted, a batch cannot start
    on the XTop context `observe` bound to the pre-refresh state. This reproduces the exit through
    the real CLI stages, then shows the next-decision Reader refuses the `research` that led there,
    with the way out."""

    def test_research_after_adopt_on_the_old_context_is_refused_with_observe_first(self):
        workspace = self.workspace
        manifest_path = workspace / "manifest.json"
        _write_json(manifest_path, _make_baseline_manifest(workspace))
        self.assertEqual(_run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        core.write_artifact(workspace / "state" / "observation.json", _baseline_observation(workspace, baseline))
        self.assertEqual(_run("policy", workspace, _analysis_contract_dir(workspace), "0.0", "0.0").returncode, 0)
        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)
        xtop_site = _write_xtop_context(workspace, baseline["id"])  # what observe-baseline binds

        adopted_id = self._run_implement_round(baseline, instance="U1")  # the one physical refresh
        working_state = json.loads((workspace / "state" / "working-state.json").read_text())
        self.assertEqual(working_state["id"], adopted_id)

        # Generation 2: route-research -> plan -> prepare-workers, one active slot and five parked.
        site_path = workspace / "site-caps.json"
        _write_json(site_path, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef",
                                "pgVerification": False, **xtop_site})
        active = {
            "taskId": "w01", "baseStateId": adopted_id, "problem": "round 2", "targets": [],
            "editDomain": {"instances": ["U1"], "nets": [], "regions": []}, "protected": {"instances": [], "nets": []},
            "mayAffect": [], "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            "targetPins": ["U1/A"],
            "scope": {"commands": list(workspaces.MUTATE_COMMANDS), "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
        }
        packages = {task_id: active if task_id == "w01" else
                    {"taskId": task_id, "baseStateId": adopted_id, "parked": True, "problem": "no cluster"}
                    for task_id in workspaces.TASK_IDS}
        plan_path = workspace / "campaign-plan.json"
        _write_json(plan_path, {"candidate": {"workPackages": packages, "reason": "round 2"},
                                "baseState": working_state, "siteCapabilities": {"pgVerification": False}})
        result = _run("prepare-workers", workspace, workspace / "state" / "working-state.json", site_path,
                      site_path, plan_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr), {"code": "stale-base",
                                                     "detail": "XTop context is not bound to the current design state"})

        # The decision that led there is refused by its Reader, naming the way out.
        import importlib.util
        spec = importlib.util.spec_from_file_location("read_atcs_stale", PACK_DIR / "tools" / "read-atcs.py")
        read_atcs = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(read_atcs)
        observation_id = json.loads((workspace / "state" / "observation.json").read_text())["id"]
        decision = {
            "stateRef": adopted_id, "observationRef": observation_id, "budgetRef": "budget-2",
            "question": "another batch?", "action": "research", "targets": [], "reason": "residual violations",
            "falsifier": "no candidate", "costBasis": {"xtopMinutes": 30}, "requiredArtifacts": [],
        }
        report = workspace / "research" / "requests" / "next-decision.json"
        _write_json(report, decision)
        found = read_atcs.problems("next-decision", report, workspace)
        self.assertEqual(found, [f"action: observe first: the XTop context is bound to {baseline['id']!r}, "
                                 f"the working state is {adopted_id!r}; research needs a context bound to the "
                                 "working state, which only observe writes"])


class AdoptConsistencyTest(TwoRoundFlowTest):
    """I9 (final review, adopt consistency): `adopt` must never silently leave
    `state/working-state.json` behind a pointers document it is supposed to mirror --
    if the working pointer moved but the adopted candidate's own design-state cannot
    actually be copied into `state/working-state.json`, `adopt` refuses outright."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_missing_candidate_design_state_file_refuses_adopt_inconsistent(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        _write_json(manifest_path, manifest)
        self.assertEqual(_run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        core.write_artifact(workspace / "state" / "observation.json", _baseline_observation(workspace, baseline))
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(baseline["id"], [contribution], [])
        plan_raw = {
            "batchId": "batch-U1", "baseStateId": baseline["id"], "select": [contribution["id"]],
            "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        merge_commit = integration.seal_batch(integration_state, request, facts, [contribution])
        merge_id = merge_commit["id"]
        impl_root = workspace / "implementations" / merge_id
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS" / "top.enc").write_bytes(f"database for {merge_id}".encode("utf-8"))
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(workspace)
        current_state_path = workspace / "current-state.json"
        _write_json(current_state_path, baseline)
        self.assertEqual(_run("implement", workspace, current_state_path, site_profile_path).returncode, 0)

        for corner in (CORNER,):
            _write_text(impl_root / "starrc" / corner / f"top.{corner}.spef", "*SPEF IEEE 1481-1999\n")
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        self.assertEqual(_run("extract", workspace, corners_path, site_profile_path).returncode, 0)

        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())
        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)
        self.assertEqual(
            _run("sta", workspace, query_spec_path, scenario_corners_path,
                 base_design_state_path, site_profile_path, "5000").returncode,
            0,
        )
        self.assertEqual(_run("physical", workspace, "candidate").returncode, 0)
        self.assertEqual(_run("evaluate", workspace, workspace / "state" / "policy.json").returncode, 0)
        evaluation = json.loads((workspace / "state" / "evaluation.json").read_text())
        self.assertEqual(core.value_of(evaluation["missingRequiredCheckCount"]), 0)
        self.assertEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 0)

        # Simulate the design-state archive `sta` should have written having
        # never actually landed (a crash/partial write between `sta` and
        # `adopt`, or a hand-edited/rsynced workspace missing that one file).
        (impl_root / "design-state.json").unlink()

        result = _run("adopt", workspace, workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "adopt-inconsistent")
        # The pointers document may already have moved (adoption.publish's own
        # write happens before this consistency check) but working-state.json
        # itself must be left exactly as it was -- never silently advanced
        # past a copy that could not actually be completed.
        working_state_after = json.loads((workspace / "state" / "working-state.json").read_text())
        self.assertEqual(working_state_after["id"], baseline["id"])


class StaIdentityByHashingAtUseTest(TwoRoundFlowTest):
    """I4 (final review, identity by hashing at use): `sta` hashes the netlist file it
    actually passes to PT, right here, rather than copying implement.json's own
    (possibly stale) recorded sha256 through unchecked."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_sta_refuses_when_the_netlist_it_actually_reads_no_longer_matches_implements_recorded_sha256(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        _write_json(manifest_path, manifest)
        self.assertEqual(_run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        core.write_artifact(workspace / "state" / "observation.json", _baseline_observation(workspace, baseline))
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(baseline["id"], [contribution], [])
        plan_raw = {
            "batchId": "batch-U1", "baseStateId": baseline["id"], "select": [contribution["id"]],
            "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        merge_commit = integration.seal_batch(integration_state, request, facts, [contribution])
        merge_id = merge_commit["id"]
        impl_root = workspace / "implementations" / merge_id
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS" / "top.enc").write_bytes(f"database for {merge_id}".encode("utf-8"))
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(workspace)
        current_state_path = workspace / "current-state.json"
        _write_json(current_state_path, baseline)
        self.assertEqual(_run("implement", workspace, current_state_path, site_profile_path).returncode, 0)

        for corner in (CORNER,):
            _write_text(impl_root / "starrc" / corner / f"top.{corner}.spef", "*SPEF IEEE 1481-1999\n")
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        self.assertEqual(_run("extract", workspace, corners_path, site_profile_path).returncode, 0)

        # The implemented netlist changed on disk after `implement` recorded
        # its identity (a hand-edited/rsynced workspace, or a stale copy) --
        # `sta` must catch this itself, at the moment it is about to hand
        # this exact file to PT, not blindly trust implement.json's own
        # recorded sha256.
        implement = json.loads((workspace / "state" / "implement.json").read_text())
        (workspace / implement["netlist"]["path"]).write_text(
            "module top(); // tampered\nendmodule\n", encoding="utf-8",
        )

        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())
        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)

        result = _run("sta", workspace, query_spec_path, scenario_corners_path,
                       base_design_state_path, site_profile_path, "5000")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((workspace / "state" / "sta.json").exists())


class StaParentViolatorRecheckTest(TwoRoundFlowTest):
    """I5 (final review, fixed count): `sta` re-queries the parent's own violating
    checks on the candidate (bounded, worst-known-slack first), and `evaluate` uses
    that recheck to tell a genuinely fixed check apart from one this generation's own
    top-N-worst-path STA simply stopped reporting -- never defaulting the latter to
    `missingPrior` the way a bare `compare_checks(prior, current, {})` would."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def _baseline_observation_with_one_violation(self, workspace, base_state, scenario, endpoint, slack):
        report_root = workspace / "baseline-pt-violating"
        scenario_refs = {}
        for s in REQUIRED_SCENARIOS:
            directory = report_root / s
            if s == scenario:
                reports = {
                    "global_timing.rpt": fixtures.global_report(slack, "0.00", "1", "0.03", "0.00", "0"),
                    "setup.rpt": fixtures.path_report([(endpoint, slack)], "setup"),
                    "hold.rpt": fixtures.path_report([], "hold"),
                    "check_timing.rpt": fixtures.check_timing_report(0),
                }
            else:
                reports = _clean_reports()
            _write_report_set(directory, reports)
            scenario_refs[s] = {
                "globalTiming": str(directory / "global_timing.rpt"), "setupPaths": str(directory / "setup.rpt"),
                "holdPaths": str(directory / "hold.rpt"), "checkTiming": str(directory / "check_timing.rpt"),
            }
        source_refs = {"designStateId": base_state["id"], "scenarios": scenario_refs}
        query_spec = {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000}
        return state.capture(source_refs, query_spec)

    def test_a_check_no_longer_in_the_worst_n_paths_is_recognized_as_fixed_not_missing(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())

        regressed_scenario = REQUIRED_SCENARIOS[0]
        endpoint = "U_FIXED/D"
        baseline_observation = self._baseline_observation_with_one_violation(
            workspace, baseline, regressed_scenario, endpoint, -0.05,
        )
        core.write_artifact(workspace / "state" / "observation.json", baseline_observation)
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(baseline["id"], [contribution], [])
        plan_raw = {
            "batchId": "batch-U1", "baseStateId": baseline["id"], "select": [contribution["id"]],
            "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        merge_commit = integration.seal_batch(integration_state, request, facts, [contribution])
        merge_id = merge_commit["id"]
        impl_root = workspace / "implementations" / merge_id
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS" / "top.enc").write_bytes(f"database for {merge_id}".encode("utf-8"))
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(workspace)
        current_state_path = workspace / "current-state.json"
        _write_json(current_state_path, baseline)
        self.assertEqual(_run("implement", workspace, current_state_path, site_profile_path).returncode, 0)

        for corner in (CORNER,):
            _write_text(impl_root / "starrc" / corner / f"top.{corner}.spef", "*SPEF IEEE 1481-1999\n")
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        self.assertEqual(_run("extract", workspace, corners_path, site_profile_path).returncode, 0)

        # The candidate's own full STA is entirely clean -- the fixed check is no
        # longer among the worst-N paths this generation's own setup.rpt reports at
        # all (a real -slack_lesser_than 0.0 report would never list a now-positive
        # path). Without the recheck, `compare_checks` would find it in neither
        # `current` nor `recheck` and default it to `missingPrior`.
        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())

        # Pre-seed the ONE recheck report `_cmd_sta`'s bounded parent-violator
        # recheck will look for (the fake wrapper never launches real PT): the
        # regressed scenario's own targeted query for `endpoint`, PT's own "q000"
        # naming (`adapters.compile_pt_query_task`, the first/only target).
        recheck_report_path = impl_root / "recheck" / regressed_scenario / "q000.rpt"
        _write_text(recheck_report_path, "  slack (MET)                       0.05\n")

        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)
        self.assertEqual(
            _run("sta", workspace, query_spec_path, scenario_corners_path,
                 base_design_state_path, site_profile_path, "5000").returncode,
            0,
        )
        sta = json.loads((workspace / "state" / "sta.json").read_text())
        check_key = core.check_key(regressed_scenario, "setup", endpoint)
        self.assertTrue(sta["recheckComplete"], sta.get("recheckNotes"))
        self.assertEqual(sta["recheck"][check_key], core.known(0.05))

        self.assertEqual(_run("physical", workspace, "candidate").returncode, 0)
        result = _run("evaluate", workspace, workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evaluation = json.loads((workspace / "state" / "evaluation.json").read_text())

        # The whole point: recognized as FIXED, never miscounted as missing, even
        # though this generation's own full STA never reported it at all.
        self.assertEqual(core.value_of(evaluation["fixedCheckCount"]), 1)
        self.assertEqual(core.value_of(evaluation["missingPriorCheckCount"]), 0)
        self.assertIn(check_key, evaluation["comparison"]["fixed"])

    def test_a_failed_recheck_makes_the_counts_unknown_not_a_false_missing_prior(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())

        regressed_scenario = REQUIRED_SCENARIOS[0]
        endpoint = "U_UNRESOLVED/D"
        baseline_observation = self._baseline_observation_with_one_violation(
            workspace, baseline, regressed_scenario, endpoint, -0.05,
        )
        core.write_artifact(workspace / "state" / "observation.json", baseline_observation)
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(baseline["id"], [contribution], [])
        plan_raw = {
            "batchId": "batch-U1", "baseStateId": baseline["id"], "select": [contribution["id"]],
            "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        merge_commit = integration.seal_batch(integration_state, request, facts, [contribution])
        merge_id = merge_commit["id"]
        impl_root = workspace / "implementations" / merge_id
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS" / "top.enc").write_bytes(f"database for {merge_id}".encode("utf-8"))
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(workspace)
        current_state_path = workspace / "current-state.json"
        _write_json(current_state_path, baseline)
        self.assertEqual(_run("implement", workspace, current_state_path, site_profile_path).returncode, 0)

        for corner in (CORNER,):
            _write_text(impl_root / "starrc" / corner / f"top.{corner}.spef", "*SPEF IEEE 1481-1999\n")
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        self.assertEqual(_run("extract", workspace, corners_path, site_profile_path).returncode, 0)

        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())
        # Deliberately never pre-seed the recheck report -- the fake wrapper produces
        # nothing, so the targeted query "fails" (no report at the expected path).

        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)
        self.assertEqual(
            _run("sta", workspace, query_spec_path, scenario_corners_path,
                 base_design_state_path, site_profile_path, "5000").returncode,
            0,
        )
        sta = json.loads((workspace / "state" / "sta.json").read_text())
        self.assertFalse(sta["recheckComplete"])
        self.assertTrue(sta.get("recheckNotes"))

        self.assertEqual(_run("physical", workspace, "candidate").returncode, 0)
        result = _run("evaluate", workspace, workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evaluation = json.loads((workspace / "state" / "evaluation.json").read_text())

        # An incomplete recheck must never let a real count through -- neither a
        # false "fixed" nor a false "missingPrior".
        self.assertFalse(core.is_known(evaluation["fixedCheckCount"]))
        self.assertFalse(core.is_known(evaluation["missingPriorCheckCount"]))


class BoundedParentViolatorRecheckModeMappingTest(unittest.TestCase):
    """N4 (final fix batch C): `_bounded_parent_violator_recheck` carries each check
    key's own mode (`"<scenario>|<mode>|<endpoint>"`) into its `pt-query.tcl`
    target -- a hold check's own targeted requery must never carry `mode: "setup"`
    (which `pt-query.tcl` maps to `-delay_type max`, a setup check's own delay arc),
    and vice versa. Exercises `atcs_cli._bounded_parent_violator_recheck` directly
    (in-process, no subprocess) against a no-op wrapper -- the point is the
    compiled `pt-query.tcl` text and the checkKey->mode mapping, not a real PT run."""

    SCENARIO = "func_ssg_rcworst_m40"
    SETUP_KEY = f"{SCENARIO}|setup|EP_SETUP"
    HOLD_KEY = f"{SCENARIO}|hold|EP_HOLD"

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def test_a_hold_check_never_receives_a_setup_target_and_vice_versa(self):
        prior_observation = {
            "checks": {
                self.SETUP_KEY: {"slack": core.known(-0.05), "startpoint": "SP_SETUP", "pathGroup": "reg2reg"},
                self.HOLD_KEY: {"slack": core.known(-0.02), "startpoint": "SP_HOLD", "pathGroup": "reg2reg"},
            },
        }
        scenario_inputs_by_scenario = {
            self.SCENARIO: {
                "design": "top", "netlist": "/unused/netlist.v", "sdc": "/unused/design.sdc",
                "spef": "/unused/corner.spef",
            },
        }
        site_profile = {"edaShell": [str(_no_op_wrapper(self.workspace))]}
        report_root = self.workspace / "recheck"

        recheck, complete, notes = atcs_cli._bounded_parent_violator_recheck(
            self.workspace, prior_observation, scenario_inputs_by_scenario, site_profile, report_root,
        )
        self.assertFalse(complete, notes)  # the no-op wrapper produced no reports at all

        # The compiled pt-query.tcl this call wrote to disk -- inspect the actual
        # ATCS_QUERY_TARGETS literal, never just trust the Python-side dict.
        tcl_text = (report_root / self.SCENARIO / "pt-query.tcl").read_text(encoding="utf-8")
        self.assertIn("{SP_SETUP EP_SETUP setup ", tcl_text)
        self.assertIn("{SP_HOLD EP_HOLD hold ", tcl_text)
        # Never swapped: neither startpoint appears paired with the other's mode.
        self.assertNotIn("{SP_SETUP EP_SETUP hold ", tcl_text)
        self.assertNotIn("{SP_HOLD EP_HOLD setup ", tcl_text)

    def test_the_recheck_slack_actually_answers_the_right_check_not_the_other_ones(self):
        """Pre-seed each target's own fake PT report at its deterministic path
        (this suite's established fake-wrapper convention) with DIFFERENT slack
        values, and confirm each check key's own recheck slack is its own --
        never the other check's, which a mode/target mix-up would produce."""
        prior_observation = {
            "checks": {
                self.SETUP_KEY: {"slack": core.known(-0.05), "startpoint": "SP_SETUP", "pathGroup": "reg2reg"},
                self.HOLD_KEY: {"slack": core.known(-0.02), "startpoint": "SP_HOLD", "pathGroup": "reg2reg"},
            },
        }
        scenario_inputs_by_scenario = {
            self.SCENARIO: {
                "design": "top", "netlist": "/unused/netlist.v", "sdc": "/unused/design.sdc",
                "spef": "/unused/corner.spef",
            },
        }
        site_profile = {"edaShell": [str(_no_op_wrapper(self.workspace))]}
        report_root = self.workspace / "recheck"
        # `_bounded_remaining_checks` orders targets by WORST (most negative) known
        # slack first -- SETUP_KEY's -0.05 is worse than HOLD_KEY's -0.02, so
        # SETUP_KEY becomes q000 and HOLD_KEY becomes q001
        # (`compile_pt_query_task` numbers targets in the order it is given them).
        _write_text(report_root / self.SCENARIO / "q000.rpt", 'slack (VIOLATED) -0.05\n')
        _write_text(report_root / self.SCENARIO / "q001.rpt", 'slack (VIOLATED) -0.02\n')

        recheck, complete, notes = atcs_cli._bounded_parent_violator_recheck(
            self.workspace, prior_observation, scenario_inputs_by_scenario, site_profile, report_root,
        )
        self.assertTrue(complete, notes)
        self.assertEqual(core.value_of(recheck[self.HOLD_KEY]), -0.02)
        self.assertEqual(core.value_of(recheck[self.SETUP_KEY]), -0.05)


class StaLibraryIdentityTest(TwoRoundFlowTest):
    """C4 (final review): `sta` hashes each scenario's own PT library-file set fresh,
    right before that scenario's PT task launches, and records it in
    `sta_receipts[scenario]["inputs"]["libraries"]` -- a real leg of the identity
    chain `verification.assemble` now requires present."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_sta_json_carries_each_scenarios_own_library_hashes(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        baseline_observation = _baseline_observation(workspace, baseline)
        core.write_artifact(workspace / "state" / "observation.json", baseline_observation)
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)

        self._run_implement_round(baseline, "U1")

        sta = json.loads((workspace / "state" / "sta.json").read_text())
        expected_lib = core.file_sha256(workspace / "libs" / "lib.db")
        for scenario in REQUIRED_SCENARIOS:
            libraries = sta["sta"][scenario]["inputs"]["libraries"]
            self.assertEqual(len(libraries), 1, libraries)
            self.assertEqual(libraries[0]["sha256"], expected_lib)

    def test_an_unmatched_libglob_refuses_before_any_pt_launch(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenarios_path = workspace / "scenarios.json"
        _write_json(scenarios_path, [
            {
                "name": scenario, "corner": CORNER, "libGlob": str(workspace / "no-such-dir" / "*.db"),
                "driverLibrary": "driver_lib", "originalDriverLibrary": "driver_lib",
            }
            for scenario in REQUIRED_SCENARIOS
        ])
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)
        site_profile_path = _site_profile_path(workspace)
        # No implement/extract has even run -- this must fail on the library glob
        # before it ever gets that far (or on a declared input read first, both
        # equally acceptable exit-2/3 refusals, never exit 0).
        result = _run("sta", workspace, query_spec_path, scenarios_path, base_design_state_path,
                       site_profile_path, "1000")
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)


class PrestaPredictedLabelTest(TwoRoundFlowTest):
    """Minor (final review): `presta`'s own `predicted.json` side file is labelled
    explicitly as base-netlist-derived -- PT runs against the *base* (pre-batch,
    pre-ECO) netlist at this stage, since no post-fix netlist exists yet, and a bare
    `"predicted"` key could be mistaken for a genuine prediction of the batch."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_predicted_json_carries_explicit_base_netlist_labels(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        base_state = json.loads((workspace / "state" / "working-state.json").read_text())

        contribution, work_package = self._build_fix_contribution(base_state, instance="U1")
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(base_state["id"], [contribution], [])
        plan_raw = {
            "batchId": "batch-presta", "baseStateId": base_state["id"],
            "select": [contribution["id"]], "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        scenarios_path = _scenarios_contract_path(workspace)
        site_profile_path = _site_profile_path(workspace)
        # `presta` only ever runs REQUIRED_SCENARIOS[0]'s own PT task -- pre-seed its
        # clean global_timing.rpt at the exact path `compile_pt_presta_task` computes
        # (integrations/<batchId>/presta/<scenario>/global_timing.rpt).
        report_root = workspace / "integrations" / "batch-presta" / "presta"
        _write_text(
            report_root / REQUIRED_SCENARIOS[0] / "global_timing.rpt",
            fixtures.global_report("0.05", "0.00", "0", "0.03", "0.00", "0"),
        )
        result = _run("presta", workspace, workspace / "state" / "working-state.json",
                       scenarios_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        predicted = json.loads((report_root / "predicted.json").read_text())
        self.assertEqual(predicted["scenario"], REQUIRED_SCENARIOS[0])
        self.assertEqual(predicted["basis"], "base-netlist")
        self.assertIn("predictedBaseNetlistSetupWns", predicted)
        self.assertIn("predictedBaseNetlistHoldWns", predicted)
        self.assertNotIn("predicted", predicted)
        self.assertAlmostEqual(core.value_of(predicted["predictedBaseNetlistSetupWns"]), 0.05)
        self.assertAlmostEqual(core.value_of(predicted["predictedBaseNetlistHoldWns"]), 0.03)


class RecipePrestaTest(TwoRoundFlowTest):
    """Issue #64 Task 6 review: a recipe batch whose auto-fix inserted instances seals unknown
    new nets; `presta` records a non-predictive pre-check that does not gate the batch, and never
    claims a qualification it does not have."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_unknown_new_nets_make_a_non_predictive_pre_check_that_does_not_gate(self):
        import test_integration_recovery as tir
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        base_state = json.loads((workspace / "state" / "working-state.json").read_text())
        request = integration.prepare_recipe_replay(
            tir.recipe_plan(batch_id="batch-recipe", base_state_id=base_state["id"]), base_state["id"],
            tir.default_recipe(), tir.recipe_sessions(), required_scenarios=["s1", "s2"])
        auto = {"mastersChanged": {}, "added": {"atcs_b_auto_eco_1": "BUFX2"}, "removed": {}}
        arms = {"merged": tir.arm_evidence("merged", receipts=tir.merged_receipts(request),
                                           session_deltas=tir.matching_session_deltas(),
                                           auto_delta=auto, total_delta=auto),
                "control": tir.arm_evidence("control")}
        state = integration.reconcile_recipe(request, arms)
        self.assertIsNone(state["newNets"])
        facts = core.stamp("composition-facts", {"baseStateId": base_state["id"], "considered": [],
                                                 "duplicates": [], "conflicts": [], "order": []})
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", state)
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [
            tir.make_contribution("c1"), tir.make_contribution("c2", task_id="w02", revision=3)]})
        report_root = workspace / "integrations" / "batch-recipe" / "presta"
        _write_text(report_root / REQUIRED_SCENARIOS[0] / "global_timing.rpt",
                    fixtures.global_report("0.05", "0.00", "0", "0.03", "0.00", "0"))
        result = _run("presta", workspace, workspace / "state" / "working-state.json",
                      _scenarios_contract_path(workspace), _site_profile_path(workspace))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = json.loads((workspace / "state" / "presta.json").read_text())
        self.assertEqual(evidence["batchKind"], "recipe")
        self.assertIs(evidence["predictive"], False)
        self.assertIsNone(evidence["newNets"])
        self.assertIn("auto-fix", evidence["newNetsUnknown"])


class StaMaxPathsTest(TwoRoundFlowTest):
    """I10 (final review): `sta` now takes `MAX_PATHS` from the Strategy the same way
    `observe` does -- the Site/Workshop-authored `query-spec.json`'s own `maxPaths` is
    an upper *request*, capped by the Run-level Strategy value, never used verbatim
    with no bound at all."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_request_above_cap_is_clamped_and_recorded_per_candidate(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())

        baseline_observation = _baseline_observation(workspace, baseline)
        core.write_artifact(workspace / "state" / "observation.json", baseline_observation)
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)

        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)

        # query-spec.json (built inside `_run_implement_round`) requests `maxPaths: 1000`;
        # a Strategy cap of 7 must win.
        self._run_implement_round(baseline, "U1", max_paths_cap=7)

        implement = json.loads((workspace / "state" / "implement.json").read_text())
        merge_id = implement["mergeCommitId"]
        record = json.loads((workspace / "implementations" / merge_id / "sta-max-paths.json").read_text())
        self.assertEqual(record, {"cap": 7, "requested": 1000, "used": 7, "clamped": True})

    def test_invalid_cap_is_refused_before_any_pt_launch(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)
        site_profile_path = _site_profile_path(workspace)
        result = _run("sta", workspace, query_spec_path, scenario_corners_path,
                       base_design_state_path, site_profile_path, "not-a-number")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertFalse((workspace / "state" / "sta.json").exists())


class ExtractStarrcTemplateTest(unittest.TestCase):
    """I1 (final review): `corners.json` maps `{corner: templatePath}` -- each corner's
    own StarRC command-file template (read, hashed, and threaded into
    `adapters.compile_starrc_task`), never one shared shipped fallback regardless of
    corner."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def test_two_corners_each_use_their_own_template_and_record_its_identity(self):
        workspace = self.workspace
        merge_id = "m" + "1" * 19
        def_path = workspace / "def" / "design.def"
        _write_text(def_path, "DEF placeholder\n")
        def_sha256 = core.file_sha256(def_path)
        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id, "design": "top",
            "def": {"path": "def/design.def", "sha256": def_sha256},
        })

        impl_root = workspace / "implementations" / merge_id
        template_a = workspace / "templates" / "cworst_T.cmd"
        template_b = workspace / "templates" / "cbest.cmd"
        _write_text(template_a, "STAR_MODE: RC_WORST\nTOP_DEF_FILE: x\nSTAR_DIRECTORY: x\nNETLIST_FILE: x\n")
        _write_text(template_b, "STAR_MODE: RC_BEST\nTOP_DEF_FILE: x\nSTAR_DIRECTORY: x\nNETLIST_FILE: x\n")
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {"cworst_T": str(template_a), "cbest": str(template_b)}})

        # No real StarXtract runs in tests (fake no-op wrapper) -- pre-create the exact
        # SPEF path `compile_starrc_task` will look for, per corner.
        for corner in ("cworst_T", "cbest"):
            _write_text(impl_root / "starrc" / corner / f"top.{corner}.spef", "*SPEF IEEE 1481-1999\n")

        site_profile_path = _site_profile_path(workspace)
        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        extract = json.loads((workspace / "state" / "extract.json").read_text())
        self.assertEqual(set(extract["spef"]), {"cworst_T", "cbest"})
        self.assertEqual(extract["spef"]["cworst_T"]["template"]["sha256"], core.file_sha256(template_a))
        self.assertEqual(extract["spef"]["cbest"]["template"]["sha256"], core.file_sha256(template_b))
        self.assertNotEqual(
            extract["spef"]["cworst_T"]["template"]["sha256"], extract["spef"]["cbest"]["template"]["sha256"]
        )

        cworst_cmd = (impl_root / "starrc" / "cworst_T" / "cworst_T.cmd").read_text(encoding="utf-8")
        cbest_cmd = (impl_root / "starrc" / "cbest" / "cbest.cmd").read_text(encoding="utf-8")
        self.assertIn("STAR_MODE: RC_WORST", cworst_cmd)
        self.assertIn("STAR_MODE: RC_BEST", cbest_cmd)

    def test_a_corner_naming_no_readable_template_file_is_refused(self):
        workspace = self.workspace
        def_path = workspace / "def" / "design.def"
        _write_text(def_path, "DEF placeholder\n")
        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": "m" + "2" * 19, "design": "top",
            "def": {"path": "def/design.def", "sha256": core.file_sha256(def_path)},
        })
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {"cworst_T": str(workspace / "no-such-template.cmd")}})
        site_profile_path = _site_profile_path(workspace)
        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertFalse((workspace / "state" / "extract.json").exists())

    def test_corners_as_a_bare_list_is_now_refused_not_silently_accepted(self):
        """The old shape (`{"corners": [names...]}`) is gone -- `corners.json` must now
        map each corner to its own template path."""
        workspace = self.workspace
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": ["cworst_T"]})
        site_profile_path = _site_profile_path(workspace)
        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "invalid-input")


class ExtractStarrcToolkitEnvTest(unittest.TestCase):
    """Issue 63: `extract`'s StarXtract invocation must carry the StarRC toolkit's
    `LD_LIBRARY_PATH` prefix (the retained failure: `error while loading shared
    libraries: libtbb.so.12`, because the Site's `edarun` wrapper forwards no such
    value on its own), and must fail closed -- before StarXtract ever runs -- when
    no toolkit can be resolved (no declared `starrcHome`, and the discovery probe
    through `edaShell` finds nothing)."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def _write_single_corner_implement(self, workspace, merge_id):
        def_path = workspace / "def" / "design.def"
        _write_text(def_path, "DEF placeholder\n")
        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id, "design": "top",
            "def": {"path": "def/design.def", "sha256": core.file_sha256(def_path)},
        })
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        return corners_path

    def test_extract_fails_closed_before_running_starxtract_when_no_toolkit_resolves(self):
        workspace = self.workspace
        merge_id = "m" + "3" * 19
        corners_path = self._write_single_corner_implement(workspace, merge_id)

        # A site profile whose edaShell is a no-op wrapper (`exit 0`, no stdout --
        # never answers the discover_starrc_toolkit probe) and declares no
        # starrcHome override: no toolkit can be resolved at all.
        wrapper = _no_op_wrapper(workspace)
        site_profile_path = workspace / "site-profile.json"
        _write_json(site_profile_path, {
            "edaShell": [str(wrapper)], "design": "top",
            "techLef": str(workspace / "tech.lef"), "cellLefGlob": str(workspace / "cells" / "*.lef"),
        })

        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertIn("starrcHome", payload["detail"])
        self.assertIn("linux64_starrc/lib", payload["detail"])
        self.assertFalse((workspace / "state" / "extract.json").exists())

    def test_extract_discovers_the_toolkit_through_edashell_when_no_starrchome_is_declared(self):
        """The production Site declares no starrcHome: `_cmd_extract` must probe through the Site's own
        edaShell and prefix StarXtract with the discovered toolkit's libraries (review finding)."""
        workspace = self.workspace
        merge_id = "m" + "5" * 19
        corners_path = self._write_single_corner_implement(workspace, merge_id)
        starrc_home = workspace / "discovered-toolkit"
        (starrc_home / "linux64_starrc" / "lib").mkdir(parents=True)
        capture = workspace / "captured-invocation.txt"
        wrapper = workspace / "probe-wrapper.sh"
        wrapper.write_text(
            '#!/bin/sh\ncase "$1" in *"command -v StarXtract"*) echo "' + str(starrc_home) + '"; exit 0;; esac\n'
            'printf %s "$1" >> ' + str(capture) + '\nexit 0\n', encoding="utf-8",
        )
        wrapper.chmod(0o755)
        site_profile_path = workspace / "site-profile.json"
        _write_json(site_profile_path, {
            "edaShell": [str(wrapper)], "design": "top",
            "techLef": str(workspace / "tech.lef"), "cellLefGlob": str(workspace / "cells" / "*.lef"),
        })
        impl_root = workspace / "implementations" / merge_id
        _write_text(impl_root / "starrc" / CORNER / f"top.{CORNER}.spef", "*SPEF IEEE 1481-1999\n")

        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        recorded = capture.read_text(encoding="utf-8")
        self.assertTrue(
            recorded.startswith(f'LD_LIBRARY_PATH="{starrc_home}/linux64_starrc/lib:${{LD_LIBRARY_PATH:-}}" '),
            recorded,
        )
        self.assertIn("StarXtract", recorded)

    def test_extract_prefixes_the_starxtract_invocation_with_the_declared_toolkits_ld_library_path(self):
        workspace = self.workspace
        merge_id = "m" + "4" * 19
        corners_path = self._write_single_corner_implement(workspace, merge_id)

        capture = workspace / "captured-invocation.txt"
        wrapper = workspace / "record-wrapper.sh"
        wrapper.write_text(
            '#!/bin/sh\nprintf %s "$1" >> ' + str(capture) + '\nexit 0\n', encoding="utf-8",
        )
        wrapper.chmod(0o755)

        starrc_home = workspace / "starrc-toolkit"
        (starrc_home / "linux64_starrc" / "lib").mkdir(parents=True)

        site_profile_path = workspace / "site-profile.json"
        _write_json(site_profile_path, {
            "edaShell": [str(wrapper)], "design": "top",
            "techLef": str(workspace / "tech.lef"), "cellLefGlob": str(workspace / "cells" / "*.lef"),
            "starrcHome": str(starrc_home),
        })

        # The recording wrapper never actually runs StarXtract -- pre-create the exact
        # SPEF path `compile_starrc_task` will look for, as `ExtractStarrcTemplateTest` does.
        impl_root = workspace / "implementations" / merge_id
        _write_text(impl_root / "starrc" / CORNER / f"top.{CORNER}.spef", "*SPEF IEEE 1481-1999\n")

        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        recorded = capture.read_text(encoding="utf-8")
        self.assertTrue(
            recorded.startswith(f'LD_LIBRARY_PATH="{starrc_home}/linux64_starrc/lib:${{LD_LIBRARY_PATH:-}}" '),
            recorded,
        )
        expected_cmd_path = impl_root / "starrc" / CORNER / f"{CORNER}.cmd"
        self.assertTrue(recorded.endswith(f"StarXtract -clean {expected_cmd_path}"), recorded)


class PhysicalBaselineInnovusTest(unittest.TestCase):
    """I13 (final review): `physical baseline` runs `adapters.compile_innovus_export_task`
    against the Campaign baseline's own staged database, with the same verify_drc/
    verifyConnectivity limits a candidate is held to -- never a Site-authored static
    document of unproven provenance."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_baseline_physical_records_the_reports_the_export_task_actually_produced(self):
        drc_text = fixtures.drc_report([])
        connectivity_text = fixtures.connectivity_report([])
        result = _run_physical_baseline(self.workspace, drc_text=drc_text, connectivity_text=connectivity_text)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        body = json.loads((self.workspace / "state" / "baseline-physical.json").read_text())
        self.assertEqual(body["drc"], drc_text)
        self.assertEqual(body["connectivity"], connectivity_text)

    def test_the_rendered_tcl_uses_the_same_limits_the_candidate_eco_uses(self):
        """`innovus-export.tcl` (baseline) and `innovus-eco.tcl` (candidate) must apply
        the identical verify_drc/verifyConnectivity limits, or a baseline-vs-candidate
        physical comparison would not be apples-to-apples."""
        export_text = (FLOW_DIR / "templates" / "innovus-export.tcl").read_text(encoding="utf-8")
        eco_text = (FLOW_DIR / "templates" / "innovus-eco.tcl").read_text(encoding="utf-8")
        self.assertIn("verify_drc -limit 1000000", export_text)
        self.assertIn("verify_drc -limit 1000000", eco_text)
        self.assertIn("verifyConnectivity -noAntenna -error 1000000", export_text)
        self.assertIn("verifyConnectivity -noAntenna -error 1000000", eco_text)

    def test_a_tampered_staged_baseline_database_is_refused(self):
        baseline = json.loads((self.workspace / "state" / "baseline.json").read_text())
        (self.workspace / baseline["database"]["path"]).write_bytes(b"tampered")
        site_profile_path = _site_profile_path(self.workspace)
        result = _run("physical", self.workspace, site_profile_path, "baseline")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "baseline-physical.json").exists())

    def test_a_missing_export_output_is_a_tool_failed_exit(self):
        # No fixture report pre-seeded at all this time -- the fake wrapper is a
        # genuine no-op, so `compile_innovus_export_task`'s expected output never
        # actually appears.
        site_profile_path = _site_profile_path(self.workspace)
        result = _run("physical", self.workspace, site_profile_path, "baseline")
        self.assertEqual(result.returncode, 4, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "tool-failed")


class ReconcileIgnoresRewrittenWorkPackageTest(unittest.TestCase):
    """Task 12c item 2: `reconcile` takes each contribution's edit domain from
    `state/workers.json[slot]["workPackage"]["editDomain"]`, never from a
    (possibly rewritten) `research/requests/work-package-w0N.json` -- there
    is no argv slot left for that file to be read through at all."""

    def test_out_of_scope_decision_follows_workers_json_never_the_raw_request_file(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)

        request = core.stamp("replay-request", {
            "batchId": "batch1", "baseStateId": "base1",
            "steps": [{
                "stepId": "s1", "contributionId": "c1", "opIndex": 0,
                "op": {"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"},
                "xtopTcl": "size_cell {U1} BUFX2",
            }],
            "expectedDelta": {},
        })
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        _write_json(workspace / "state" / "replay-receipts.json", {
            "receipts": [{
                "stepId": "s1", "status": "ok",
                "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            }],
        })
        _write_json(workspace / "state" / "contributions-collected.json", {
            "contributions": [{"id": "c1", "taskId": "w01"}],
        })
        # The ADMITTED, validated package: U1 is in scope.
        _write_json(workspace / "state" / "workers.json", {
            "workers": {"w01": {"workPackage": {"editDomain": {"instances": ["U1"], "nets": [], "regions": []}}}},
        })
        # A rewritten raw request file claiming an EMPTY edit domain (U1 would
        # be out-of-scope if this were ever consulted) -- reconcile must never
        # read this file at all.
        _write_json(workspace / "research" / "requests" / "work-package-w01.json", {
            "taskId": "w01", "baseStateId": "base1", "problem": "tampered after admission",
            "targets": [], "editDomain": {"instances": [], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [],
            "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
        })

        result = _run("reconcile", workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        integration_state = json.loads((workspace / "state" / "integration-state.json").read_text())
        self.assertEqual(integration_state["outOfScope"], [])
        self.assertIn("s1", integration_state["applied"])


class PrepareWorkersByteIdentityTest(unittest.TestCase):
    """Task 12c item 4a + Fix round 1 item 1 (Critical): `prepare-workers` reads
    `candidate.workPackages` of the ONE admitted campaign-plan envelope -- the
    exact field the campaign-plan Reader itself validates. Any content
    divergent from what the Reader would have found valid is caught by the
    same `workspaces.validate_work_package` call the Reader's own
    `tc_request_invalid_count` uses, since both run over the identical
    field of the identical current file. A top-level `workPackages` key
    (a second, unenforced copy) is refused outright, regardless of its
    content."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state_path = self.workspace / "state" / "working-state.json"
        self.working_state = json.loads(self.working_state_path.read_text())
        xtop_site = _write_xtop_context(self.workspace, self.working_state["id"])
        self.eda_profile_path = self.workspace / "eda-profile.json"
        _write_json(self.eda_profile_path, {
            "design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef", **xtop_site,
        })
        self.site_caps_path = self.workspace / "site-caps.json"
        _write_json(self.site_caps_path, {"pgVerification": False})

    def _work_packages(self, **w02_overrides):
        packages = {
            task_id: {
                "taskId": task_id, "baseStateId": self.working_state["id"], "problem": "p",
                "targets": [], "editDomain": {"instances": [], "nets": [], "regions": []},
                "protected": {"instances": [], "nets": []}, "mayAffect": [],
                "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
                "targetPins": [], "scope": {"commands": ["atcs_size_cell", "atcs_undo"], "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
            }
            for task_id in workspaces.TASK_IDS
        }
        packages["w02"].update(w02_overrides)
        return packages

    def _envelope(self, work_packages, reason="valid plan"):
        return {
            "candidate": {"workPackages": work_packages, "reason": reason},
            "baseState": self.working_state, "siteCapabilities": {"pgVerification": False},
        }

    def _run_prepare_workers(self, campaign_plan_path):
        return _run("prepare-workers", self.workspace, self.working_state_path, self.site_caps_path,
                     self.eda_profile_path, campaign_plan_path)

    def test_a_valid_single_copy_plan_is_prepared_from_candidate_workpackages(self):
        campaign_plan_path = self.workspace / "campaign-plan.json"
        _write_json(campaign_plan_path, self._envelope(self._work_packages()))
        result = self._run_prepare_workers(campaign_plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        workers = json.loads((self.workspace / "state" / "workers.json").read_text())
        for task_id in workspaces.TASK_IDS:
            self.assertEqual(workers["workers"][task_id]["workPackage"]["taskId"], task_id)
            self.assertEqual(len(workers["workers"][task_id]["sessionTclSha256"]), 64)
        # Issue #64 Task 4: six slots, and each session bakes the package's scope budget (the recipe
        # cap; the Reviewer's smaller budget is the Host's) and its observation mode.
        self.assertEqual(sorted(workers["workers"]), ["w01", "w02", "w03", "w04", "w05", "w06"])
        session_tcl = Path(workers["workers"]["w06"]["sessionTcl"]).read_text(encoding="utf-8")
        self.assertIn(f"set ::ATCS_MAX_MUTATIONS {{{workspaces.SCOPE_MAX_MUTATIONS}}}", session_tcl)
        self.assertIn("set ::ATCS_OBSERVE {fast}", session_tcl)

    def test_missing_xtop_context_refuses_before_any_worker_session_is_compiled(self):
        (self.workspace / "state" / "xtop-context.json").unlink()
        campaign_plan_path = self.workspace / "campaign-plan.json"
        _write_json(campaign_plan_path, self._envelope(self._work_packages()))
        result = self._run_prepare_workers(campaign_plan_path)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.workspace / "state" / "workers.json").exists())

    def test_changed_sta_data_refuses_before_any_worker_session_is_compiled(self):
        (self.workspace / "xtop-context" / "sta_data" / "timing_data_finish").write_text(
            "changed\n", encoding="utf-8",
        )
        campaign_plan_path = self.workspace / "campaign-plan.json"
        _write_json(campaign_plan_path, self._envelope(self._work_packages()))
        result = self._run_prepare_workers(campaign_plan_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertFalse((self.workspace / "state" / "workers.json").exists())

    def test_bytes_differing_from_the_admitted_plan_are_refused(self):
        """Simulates a plan whose bytes changed after admission: w02's own package now
        names an action outside ACTION_KINDS -- the exact same content problem the
        campaign-plan Reader's own `tc_request_invalid_count` would have flagged."""
        campaign_plan_path = self.workspace / "campaign-plan.json"
        _write_json(campaign_plan_path, self._envelope(
            self._work_packages(actions=["not-a-real-action"]), reason="tampered after admission",
        ))
        result = self._run_prepare_workers(campaign_plan_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "invalid-work-package")
        self.assertFalse((self.workspace / "state" / "workers.json").exists())

    def test_a_second_top_level_workpackages_copy_is_refused_even_when_it_agrees(self):
        """Fix round 1 item 1 (Critical): a top-level `workPackages` key is a hazard the
        moment it exists -- refused unconditionally, not only when it happens to disagree
        with `candidate.workPackages`."""
        campaign_plan_path = self.workspace / "campaign-plan.json"
        work_packages = self._work_packages()
        envelope = self._envelope(work_packages)
        envelope["workPackages"] = work_packages  # identical copy -- still refused
        _write_json(campaign_plan_path, envelope)
        result = self._run_prepare_workers(campaign_plan_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "ambiguous-plan")
        self.assertFalse((self.workspace / "state" / "workers.json").exists())

    def test_a_diverging_top_level_workpackages_copy_is_refused(self):
        campaign_plan_path = self.workspace / "campaign-plan.json"
        envelope = self._envelope(self._work_packages())
        envelope["workPackages"] = self._work_packages(actions=["not-a-real-action"])  # diverges
        _write_json(campaign_plan_path, envelope)
        result = self._run_prepare_workers(campaign_plan_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "ambiguous-plan")
        self.assertFalse((self.workspace / "state" / "workers.json").exists())


class CaptureContributionComposedTest(unittest.TestCase):
    """G2: `capture-contribution <slot>` composes everything from `state/workers.json`
    and the slot's own workspace root; refuses (exit 2) when an Operator output
    file is missing."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.base_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {CORNER: {"path": f"{CORNER}.spef", "sha256": "d" * 64}},
            "sdc": [{"path": "constraints.sdc", "sha256": "e" * 64}], "tools": {},
            "scenarios": list(REQUIRED_SCENARIOS), "parentId": None,
        })

    def _seed_workers(self, slot="w01", instance="U1"):
        work_package_raw = {
            "taskId": slot, "baseStateId": self.base_state["id"], "problem": "resize",
            "targets": [], "editDomain": {"instances": [instance], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [],
            "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            "targetPins": [], "scope": {"commands": ["atcs_size_cell", "atcs_undo"], "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
        }
        validated = workspaces.validate_work_package(work_package_raw, self.base_state, {"pgVerification": False})
        manifest = workspaces.prepare(validated, str(self.workspace), self.base_state)
        workers_doc = {"workers": {slot: {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "sessionTcl": str(Path(manifest["root"]) / "session.tcl"),
            "opsLog": str(Path(manifest["root"]) / "ops.jsonl"),
            "workPackage": validated, "workspaceManifest": manifest,
        }}}
        _write_json(self.workspace / "state" / "workers.json", workers_doc)
        return manifest

    def test_composes_an_admissible_contribution_from_fake_operator_outputs(self):
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX2\n", encoding="utf-8")
        (root / "ops.jsonl").write_text(
            json.dumps({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}),
            encoding="utf-8",
        )
        _write_json(root / "summary.json", {"xtopSetupWns": 0.05, "xtopHoldWns": 0.02, "diagnosis": None})

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())
        self.assertTrue(contribution["admissible"], contribution.get("refusals"))
        self.assertEqual(contribution["kind"], "fix")
        self.assertEqual(core.value_of(contribution["predicted"]["xtopSetupWns"]), 0.05)

    def test_refuses_when_ops_log_is_missing(self):
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX2\n", encoding="utf-8")
        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")

    def test_refuses_when_a_dump_is_missing(self):
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "ops.jsonl").write_text(
            json.dumps({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}),
            encoding="utf-8",
        )
        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")

    def test_composes_an_admissible_no_fix_contribution_with_a_diagnosis(self):
        """Item 6: a no-fix contribution (empty ops.jsonl) is admissible only
        with a diagnosis -- `contributions.seal`'s own `no-diagnosis` refusal."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX1\n", encoding="utf-8")  # unchanged: no-fix
        (root / "ops.jsonl").write_text("", encoding="utf-8")
        _write_json(root / "summary.json", {"diagnosis": "no admissible fix found within budget"})

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())
        self.assertEqual(contribution["kind"], "no-fix")
        self.assertTrue(contribution["admissible"], contribution.get("refusals"))
        self.assertEqual(contribution["diagnosis"], "no admissible fix found within budget")

    def test_empty_ops_log_without_a_summary_diagnosis_gets_a_deterministic_one(self):
        """Issue 63: an explicit `summary.json` diagnosis is not the only honest path
        to a `no-fix` Contribution any more -- byte-identical dumps plus an empty
        (present but empty) ops trace and no explicit diagnosis now compose a
        deterministic diagnosis (evidence, never model prose) instead of refusing."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "ops.jsonl").write_text("", encoding="utf-8")
        # No summary.json at all -- no explicit diagnosis.

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())
        self.assertEqual(contribution["kind"], "no-fix")
        self.assertTrue(contribution["admissible"], contribution.get("refusals"))
        before_sha = core.file_sha256(root / "before.dump")
        self.assertIn(before_sha, contribution["diagnosis"])
        self.assertIn("ops trace empty", contribution["diagnosis"])

    def test_missing_ops_log_with_identical_dumps_is_an_admissible_no_fix(self):
        """Issue 63 retained failure: a real Operator session that made no mutation
        never writes ops.jsonl at all (xtop-operator.tcl's atcs_log_op only appends
        on a successful mutation) -- so 'ops.jsonl absent' must be as honest a
        no-fix signal as 'ops.jsonl present but empty', not a missing-input refusal."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        # No ops.jsonl file at all -- not even an empty one.

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())
        self.assertEqual(contribution["kind"], "no-fix")
        self.assertTrue(contribution["admissible"], contribution.get("refusals"))
        self.assertIn("ops trace empty", contribution["diagnosis"])

    def test_missing_ops_log_with_identical_dumps_surfaces_adapter_errors(self):
        """The deterministic diagnosis includes the first few verbatim
        HIMA-ADAPTER-ERROR lines from the slot's own XTop transcript, when one
        exists, bounded to <= 5 lines and <= 300 chars each."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "xtop_log_00.txt").write_text(
            "some normal line\n"
            "HIMA-ADAPTER-ERROR:1 Error: Library cell 'DFQD2BWP12T' not found.\n"
            "another normal line\n",
            encoding="utf-8",
        )

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())
        self.assertIn("HIMA-ADAPTER-ERROR", contribution["diagnosis"])
        self.assertIn("DFQD2BWP12T", contribution["diagnosis"])

    def test_no_fix_diagnosis_ignores_echoed_command_wrappers(self):
        """The real XTop transcript echoes every adapter-wrapped command (each
        containing the literal HIMA-ADAPTER-ERROR text) after an `xtop > `
        prompt; only the tool's own `Error...` output and bare
        HIMA-ADAPTER-ERROR status lines are evidence (retained run-5a5b8ba5 w01)."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        wrapper = ('set __hima_code [catch {{*}$__hima_command} __hima_result __hima_options]; '
                   'if {$__hima_code != 0} { puts stderr "HIMA-ADAPTER-ERROR:$__hima_code:$__hima_result" }')
        (root / "xtop_log_1.txt").write_text(
            f'xtop > puts "HIMA:a:ACK"; set __hima_command [list atcs_dump_cells "before.dump"]; {wrapper}\n'
            "HIMA:a:DONE\n"
            f'xtop > puts "HIMA:b:ACK"; set __hima_command [list atcs_size_cell "u/sr_reg_1_" "DFQD2BWP12T"]; {wrapper}\n'
            "Error: Library cell 'DFQD2BWP12T' not found.\n"
            "HIMA-ADAPTER-ERROR:1:\n"
            "HIMA:b:FAIL\n"
            f'xtop > puts "HIMA:c:ACK"; set __hima_command [list atcs_close]; {wrapper}\n',
            encoding="utf-8",
        )

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        diagnosis = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())["diagnosis"]
        self.assertIn("Error: Library cell 'DFQD2BWP12T' not found.", diagnosis)
        self.assertNotIn("xtop >", diagnosis)
        self.assertNotIn("__hima_command", diagnosis)

    def test_missing_ops_log_with_differing_dumps_is_still_refused(self):
        """Counterexample: a real design change with no ops trace at all is still
        a missing-input refusal, not an honest no-fix -- only byte-identical
        dumps license the no-fix path."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX2\n", encoding="utf-8")
        # No ops.jsonl file -- but the dumps genuinely differ.

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")

    def test_a_dump_missing_is_still_missing_input_even_with_no_ops_log(self):
        """Counterexample: a genuinely missing dump is still refused before any
        no-fix reasoning is attempted."""
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        # No after.dump, no ops.jsonl.

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")


class PolicyTest(unittest.TestCase):
    """G4: `policy` composes the run-time acceptance policy and refuses a static
    file that tries to set a run-time or Goal field."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        baseline = json.loads((self.workspace / "state" / "baseline.json").read_text())
        observation = _baseline_observation(self.workspace, baseline)
        core.write_artifact(self.workspace / "state" / "observation.json", observation)
        self.baseline = baseline

    def test_static_policy_may_not_set_run_time_or_goal_fields(self):
        for forbidden_key, value in (
            ("baselineStateId", "sneaky"), ("campaignRoot", "/somewhere"), ("goal", {"setup": 1, "hold": 1}),
        ):
            with self.subTest(forbidden_key=forbidden_key):
                contract_dir = _analysis_contract_dir(self.workspace, **{forbidden_key: value})
                result = _run("policy", self.workspace, contract_dir, "0.0", "0.0")
                self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
                payload = json.loads(result.stderr)
                self.assertEqual(payload["code"], "invalid-policy")

    def test_well_formed_static_policy_composes_run_time_fields(self):
        contract_dir = _analysis_contract_dir(self.workspace)
        result = _run("policy", self.workspace, contract_dir, "0.0", "0.0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        policy = json.loads((self.workspace / "state" / "policy.json").read_text())
        self.assertEqual(policy["schema"], "atcs.policy/1")
        self.assertEqual(policy["baselineStateId"], self.baseline["id"])
        self.assertEqual(policy["campaignRoot"], str(self.workspace))
        self.assertEqual(policy["goal"], {"setup": 0.0, "hold": 0.0})
        self.assertAlmostEqual(policy["baselineMinWns"], 0.03)

    def test_scenario_corners_and_required_scenarios_are_derived_from_scenarios_json(self):
        """C4 (final review): the single source is scenarios.json -- a static
        policy.json that names neither field at all still gets a real, derived
        scenarioCorners/requiredScenarios in the composed policy."""
        contract_dir = _analysis_contract_dir(self.workspace)
        self.assertEqual(_run("policy", self.workspace, contract_dir, "0.0", "0.0").returncode, 0)
        policy = json.loads((self.workspace / "state" / "policy.json").read_text())
        self.assertEqual(policy["scenarioCorners"], {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        self.assertEqual(sorted(policy["requiredScenarios"]), sorted(REQUIRED_SCENARIOS))

    def test_a_static_scenario_corners_disagreeing_with_scenarios_json_is_refused(self):
        contract_dir = _analysis_contract_dir(
            self.workspace, scenarioCorners={scenario: "wrong-corner" for scenario in REQUIRED_SCENARIOS}
        )
        result = _run("policy", self.workspace, contract_dir, "0.0", "0.0")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "invalid-policy")

    def test_a_static_scenario_corners_agreeing_with_scenarios_json_is_accepted(self):
        contract_dir = _analysis_contract_dir(
            self.workspace, scenarioCorners={scenario: CORNER for scenario in REQUIRED_SCENARIOS}
        )
        result = _run("policy", self.workspace, contract_dir, "0.0", "0.0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class BaselineMinWnsTest(unittest.TestCase):
    """`_baseline_min_wns` reads each scenario's global-timing WNS; a path list
    capped at maxPaths (Issue #63 postroute_final: up to 5675 hold violations
    against a 5000 ceiling) does not make that WNS unknown."""

    def _observation(self, complete):
        scenarios = {
            name: {
                "setup": {"wns": core.known(setup)}, "hold": {"wns": core.known(hold)},
                "complete": {"setup": complete, "hold": complete},
            }
            for name, setup, hold in (("a", -0.16, -0.20), ("b", -0.09, -0.18))
        }
        return {"scenarios": scenarios, "missingScenarios": []}

    def test_capped_path_lists_keep_the_global_timing_wns(self):
        self.assertEqual(atcs_cli._baseline_min_wns(self._observation(False), ["a", "b"]), -0.20)

    def test_missing_scenario_or_unknown_wns_is_still_none(self):
        observation = self._observation(True)
        self.assertIsNone(atcs_cli._baseline_min_wns(observation, ["a", "b", "c"]))
        observation["scenarios"]["b"]["hold"]["wns"] = core.unknown("unreadable")
        self.assertIsNone(atcs_cli._baseline_min_wns(observation, ["a", "b"]))


class IdentityMismatchTest(unittest.TestCase):
    """Every entry-file reference with a changed sha256 -> exit 3 (identity-mismatch), no output."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def test_physical_candidate_refuses_when_drc_report_sha256_changed(self):
        (self.workspace / "RPT").mkdir(parents=True, exist_ok=True)
        drc_path = self.workspace / "RPT" / "verify_drc.rpt"
        connectivity_path = self.workspace / "RPT" / "verify_connectivity.rpt"
        drc_path.write_text(fixtures.drc_report([]), encoding="utf-8")
        connectivity_path.write_text(fixtures.connectivity_report([]), encoding="utf-8")
        implement = {
            "mergeCommitId": "m1", "design": "top", "parentStateId": "base1",
            "database": {"path": "DBS/top.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "EXPORT/design.v", "sha256": "c" * 64},
            "def": {"path": "EXPORT/design.def", "sha256": "d" * 64},
            "drcReport": {"path": "RPT/verify_drc.rpt", "sha256": core.file_sha256(drc_path)},
            "connectivityReport": {"path": "RPT/verify_connectivity.rpt", "sha256": core.file_sha256(connectivity_path)},
        }
        _write_json(self.workspace / "state" / "implement.json", implement)

        # Tamper with the report after `implement` recorded its identity.
        drc_path.write_text(fixtures.drc_report([("GEOM-1 (M4)", (0, 0, 1, 1))]), encoding="utf-8")

        result = _run("physical", self.workspace, "candidate")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "physical.json").exists())

    def test_physical_candidate_refuses_when_connectivity_report_sha256_changed(self):
        (self.workspace / "RPT").mkdir(parents=True, exist_ok=True)
        drc_path = self.workspace / "RPT" / "verify_drc.rpt"
        connectivity_path = self.workspace / "RPT" / "verify_connectivity.rpt"
        drc_path.write_text(fixtures.drc_report([]), encoding="utf-8")
        connectivity_path.write_text(fixtures.connectivity_report([]), encoding="utf-8")
        implement = {
            "mergeCommitId": "m1", "design": "top", "parentStateId": "base1",
            "database": {"path": "DBS/top.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "EXPORT/design.v", "sha256": "c" * 64},
            "def": {"path": "EXPORT/design.def", "sha256": "d" * 64},
            "drcReport": {"path": "RPT/verify_drc.rpt", "sha256": core.file_sha256(drc_path)},
            "connectivityReport": {"path": "RPT/verify_connectivity.rpt", "sha256": core.file_sha256(connectivity_path)},
        }
        _write_json(self.workspace / "state" / "implement.json", implement)

        # Tamper with the report after `implement` recorded its identity.
        connectivity_path.write_text(fixtures.connectivity_report(["n_tampered"]), encoding="utf-8")

        result = _run("physical", self.workspace, "candidate")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "physical.json").exists())

    def test_extract_refuses_when_the_def_it_actually_reads_no_longer_matches_implements_recorded_sha256(self):
        """I4 (final review, identity by hashing at use): `extract` hashes the DEF it actually
        reads, right here, not implement.json's own (possibly stale) recorded copy."""
        def_path = self.workspace / "EXPORT" / "design.def"
        def_path.parent.mkdir(parents=True, exist_ok=True)
        def_path.write_text("DEF placeholder\n", encoding="utf-8")
        implement = {
            "mergeCommitId": "m1", "design": "top", "parentStateId": "base1",
            "database": {"path": "DBS/top.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "EXPORT/design.v", "sha256": "c" * 64},
            "def": {"path": "EXPORT/design.def", "sha256": core.file_sha256(def_path)},
        }
        _write_json(self.workspace / "state" / "implement.json", implement)

        # The DEF changed on disk after `implement` recorded its identity.
        def_path.write_text("DEF placeholder -- tampered\n", encoding="utf-8")

        corners_path = self.workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        site_profile_path = _site_profile_path(self.workspace)
        result = _run("extract", self.workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "extract.json").exists())


class ObserveMaxPathsTest(unittest.TestCase):
    """Item 5: the Strategy's `maxPaths` argv value is an upper cap, not a blind override."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def _run_observe(self, requested_max_paths, cap):
        query_spec = {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS)}
        if requested_max_paths is not None:
            query_spec["maxPaths"] = requested_max_paths
        query_spec_path = self.workspace / "query-spec.json"
        _write_json(query_spec_path, query_spec)
        # Task 12c item 3: `observe` builds scenario inputs itself from
        # `state/working-state.json` (already seeded by `baseline` in
        # `setUp`) -- only the Site-fixed corner map is still an argv input.
        scenario_corners_path = _scenarios_contract_path(self.workspace)
        site_profile_path = _site_profile_path(self.workspace)
        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(self.workspace / "research" / "observe" / "g1" / scenario, _clean_reports())
        return _run("observe", self.workspace, query_spec_path, site_profile_path, scenario_corners_path, str(cap))

    def _clamp_record(self):
        return json.loads((self.workspace / "research" / "observe" / "max-paths.json").read_text())

    def test_request_within_cap_uses_the_requests_own_value(self):
        result = self._run_observe(requested_max_paths=500, cap=2000)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = self._clamp_record()
        self.assertEqual(record, {"cap": 2000, "requested": 500, "used": 500, "clamped": False})

    def test_request_above_cap_is_clamped(self):
        result = self._run_observe(requested_max_paths=5000, cap=500)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = self._clamp_record()
        self.assertEqual(record, {"cap": 500, "requested": 5000, "used": 500, "clamped": True})

    def test_no_requested_value_uses_the_cap(self):
        result = self._run_observe(requested_max_paths=None, cap=800)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = self._clamp_record()
        self.assertEqual(record, {"cap": 800, "requested": None, "used": 800, "clamped": False})


class ObserveInputsFromWorkingStateTest(unittest.TestCase):
    """Task 12c item 3: `observe` builds its own PT scenario inputs from
    `state/working-state.json` (re-verified by sha256) and never trusts a
    model-supplied file path -- there is no `scenario_inputs`/`observe-
    scenario-inputs.json` argv slot left for one to arrive through."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def _run_observe(self):
        query_spec_path = self.workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(self.workspace)
        site_profile_path = _site_profile_path(self.workspace)
        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(self.workspace / "research" / "observe" / "g1" / scenario, _clean_reports())
        return _run("observe", self.workspace, query_spec_path, site_profile_path, scenario_corners_path, "1000")

    def test_succeeds_using_the_working_states_own_recorded_files(self):
        result = self._run_observe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        observation = json.loads((self.workspace / "state" / "observation.json").read_text())
        working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())
        self.assertEqual(observation["designStateId"], working_state["id"])

    def test_refuses_when_the_working_states_spef_sha_changed(self):
        """A tampered/rotated SPEF file (never a model-supplied path) is caught by identity, not trusted.

        C3 (final review): `baseline` now stages its own immutable copy of
        every source file under `workspace/baseline/` (the campaign's own
        frozen snapshot), so `state/working-state.json`'s own recorded
        `spef` path names that STAGED copy, not the original external
        source `_make_baseline_manifest` wrote -- tampering must therefore
        target the staged copy `working-state.json` itself points at.
        """
        working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())
        staged_spef_path = self.workspace / working_state["spef"][CORNER]["path"]
        staged_spef_path.write_text("*SPEF IEEE 1481-1999 -- tampered\n", encoding="utf-8")
        result = self._run_observe()
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "observation.json").exists())

    def test_ignores_a_model_supplied_scenario_inputs_file(self):
        """There is no argv slot for a model-authored scenario-inputs file any more: even when one
        exists on disk at the old conventional path, pointing at a bogus netlist, `observe` never
        reads it -- only `state/working-state.json`'s own recorded files are ever used."""
        bogus_netlist = self.workspace / "bogus-netlist.v"
        bogus_netlist.write_text("module NOT_THE_REAL_DESIGN(); endmodule\n", encoding="utf-8")
        _write_json(self.workspace / "research" / "requests" / "observe-scenario-inputs.json", {
            scenario: {
                "design": "top", "netlist": str(bogus_netlist),
                "sdc": str(self.workspace / "constraints.sdc"), "spef": str(self.workspace / f"{CORNER}.spef"),
            }
            for scenario in REQUIRED_SCENARIOS
        })
        result = self._run_observe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # The real netlist (never the bogus one) is what was actually queried.
        pt_tcl = (self.workspace / "research" / "observe" / "g1" / REQUIRED_SCENARIOS[0] / "pt-scenario.tcl").read_text()
        self.assertNotIn(str(bogus_netlist), pt_tcl)
        self.assertIn("netlist.v", pt_tcl)


class RiskFirstObservationTest(unittest.TestCase):
    """G19: `risk` self-compares on the campaign's first observation (no `state/observation-prev.json` yet)."""

    def test_missing_prior_compares_current_against_itself(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        observation = _baseline_observation(workspace, baseline)
        current_path = workspace / "current.json"
        core.write_artifact(current_path, observation)
        recheck_path = workspace / "recheck.json"
        _write_json(recheck_path, {})

        result = _run("risk", workspace, workspace / "state" / "observation-prev.json", current_path, recheck_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        risk = json.loads((workspace / "state" / "risk.json").read_text())
        self.assertEqual(risk["remaining"], [])
        self.assertEqual(risk["regressed"], [])
        self.assertEqual(risk["missingPrior"], [])


def _full_flow_readiness(workspace, manifest):
    """A real `input-readiness` with `scope == "full-flow"` (a hash-bound lifecycle for every stage)."""
    lifecycle_dir = workspace / "lifecycle"
    stages = {}
    for stage in ("init", "place", "cts", "route", "postroute"):
        checkpoint = lifecycle_dir / f"{stage}.enc"
        _write_text(checkpoint, f"# {stage} checkpoint\n")
        script = lifecycle_dir / f"{stage}.tcl"
        _write_text(script, f"# {stage} script\n")
        stages[stage] = {"checkpoint": str(checkpoint), "script": str(script)}
    full_manifest = dict(manifest)
    full_manifest["lifecycle"] = {"stages": stages, "flowConfig": ["init", "place", "cts", "route", "postroute"]}
    return state.input_readiness(full_manifest, {"pgVerification": False})


def _post_route_only_readiness(manifest):
    return state.input_readiness(manifest, {"pgVerification": False})


def _write_next_decision(workspace, stage, reason="residual evidence points at an earlier restart"):
    next_decision = {
        "stateRef": "0" * 20, "observationRef": "1" * 20, "budgetRef": "budget-1",
        "question": "would an earlier APR restart close the remaining residual cases?",
        "action": "earlier-apr", "targets": [], "reason": reason,
        "falsifier": "the stage intervention does not improve the targeted checks",
        "costBasis": "one bounded APR stage cycle", "requiredArtifacts": [], "stage": stage,
    }
    _write_json(workspace / NEXT_DECISION_REL_PATH, next_decision)
    return next_decision


class ResidualPtQueryEvidenceTest(unittest.TestCase):
    """Task 12c item 1a: `residual` actually launches a targeted `pt-query.tcl`
    for its worst remaining checks and passes the parsed evidence to
    `residual.extract`, so `apr-prepare` can compile a real intervention
    hook (previously `observation["checkDetails"]` was never populated, so
    every evidence field was always `unknown` and `compile_intervention`
    could never fire a setting)."""

    CHECK_KEY = "func_ssg_rcworst_m40|setup|U_FF_2/D"

    # A real per-arc PT `report_timing -input_pins -nets -transition_time
    # -capacitance` sample, in the grammar cross-checked against a real
    # Foundation ROUND3 `setup.rpt` (Task 16 real-corpus preflight, same
    # shape `adapters.parse_path_detail`'s own fixture test uses): the
    # launching flop's CP arc is net delay (0.00, into the flop from the
    # clock net), its Q arc is that same instance's cell delay (0.08,
    # clock-to-Q), `net1`'s own line carries only Fanout/Cap (never a
    # delay value), and the capturing flop's D arc is net delay again
    # (0.10, `net1`'s actual wire delay) -- netDelay (0.10) > cellDelay
    # (0.08), driving `residual.extract`'s own suggestedStage rule below.
    NET_DOMINATED_REPORT = """  Point                       Fanout    Cap      Trans       Incr       Path
  -----------------------------------------------------------------------------
  clock core_clock (rise edge)                               0.00       0.00
  U_FF_1/CP (MOCKDFFX1)
                              0.00       0.00 &     0.00 r
  U_FF_1/Q (MOCKDFFX1)
                              0.02       0.08 &     0.08 f
  net1 (net)
                              4     1.50
  U_FF_2/D (MOCKDFFX1)
                              0.03       0.10 &     0.18 f
  data arrival time                                                     0.18
"""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", self.manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())

        readiness = _full_flow_readiness(self.workspace, self.manifest)
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)

        sta = {
            "designStateId": self.working_state["id"], "database": {},
            "sta": {
                "func_ssg_rcworst_m40": {
                    "corner": CORNER, "inputs": {},
                    "observation": {
                        "precision": "gba",
                        "checks": {
                            self.CHECK_KEY: {
                                "slack": core.known(-0.12), "startpoint": "U_FF_1/CP", "pathGroup": "reg2reg",
                            },
                        },
                        "scenarios": {}, "sources": [],
                    },
                },
            },
        }
        _write_json(self.workspace / "state" / "sta.json", sta)

        # Fix round 2 item 1: residual now queries the EVALUATED CANDIDATE's own
        # design-state (implementations/<mergeId>/design-state.json), cross-checked
        # against evaluation.stateId -- reuse the working (baseline) state itself as
        # that candidate's state here, since this test is about evidence-collection
        # mechanics, not about the candidate/parent distinction (see
        # ResidualQueriesTheEvaluatedCandidateStateTest for that).
        merge_id = "cand-1"
        _write_json(self.workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id, "design": "top", "parentStateId": self.working_state["id"],
        })
        core.write_artifact(self.workspace / "implementations" / merge_id / "design-state.json", self.working_state)

        evaluation = core.stamp("evaluation", {
            "candidateId": merge_id, "parentStateId": self.working_state["id"], "stateId": self.working_state["id"],
            "finalSetupWns": core.known(-0.12), "finalHoldWns": core.known(0.03),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(1), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(0), "missingPriorCheckCount": core.known(0),
            "comparison": {
                "fixed": [], "remaining": [self.CHECK_KEY], "entrant": [], "regressed": [], "missingPrior": [],
            },
            "physical": {"drc": {"total": core.known(0)}, "connectivity": {"total": core.known(0)}},
        })
        _write_json(self.workspace / "state" / "evaluation.json", evaluation)

    def _run_residual(self, report_text):
        scenario_corners_path = _scenarios_contract_path(self.workspace)
        site_profile_path = _site_profile_path(self.workspace)

        # The fake wrapper never actually launches PT -- pre-write the report
        # at the exact deterministic path `_cmd_residual` will look for
        # (`compile_pt_query_task` names the sole target `q000`).
        report_path = self.workspace / "research" / "residual" / "g1" / "func_ssg_rcworst_m40" / "q000.rpt"
        _write_text(report_path, report_text)
        return _run("residual", self.workspace, scenario_corners_path, site_profile_path)

    def test_residual_evidence_is_known_and_apr_prepare_compiles_a_real_hook(self):
        result = self._run_residual(self.NET_DOMINATED_REPORT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        residual_doc = json.loads((self.workspace / "state" / "residual-cases.json").read_text())
        self.assertEqual(len(residual_doc["cases"]), 1)
        case = residual_doc["cases"][0]
        self.assertEqual(case["checks"], [self.CHECK_KEY])
        self.assertTrue(core.is_known(case["evidence"]["cellDelay"]))
        self.assertTrue(core.is_known(case["evidence"]["netDelay"]))
        self.assertAlmostEqual(core.value_of(case["evidence"]["netDelay"]), 0.10, places=6)
        self.assertEqual(residual_doc["queryNotes"], [])
        # netDelay (0.10) > cellDelay (0.08) -- residual.extract's own suggestedStage rule.
        self.assertEqual(case["suggestedStage"], "route")

        _write_next_decision(self.workspace, "route")
        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        task = json.loads((self.workspace / "state" / "apr-task.json").read_text())
        self.assertIn("setPathGroupOptions", task["tcl"])

    def test_missing_report_leaves_evidence_unknown_and_notes_the_reason(self):
        """No report was ever produced (fake wrapper is a no-op with nothing pre-written):
        evidence is honestly unknown, never guessed, and apr-prepare then has no
        intervention to compile."""
        scenario_corners_path = _scenarios_contract_path(self.workspace)
        site_profile_path = _site_profile_path(self.workspace)
        result = _run("residual", self.workspace, scenario_corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        residual_doc = json.loads((self.workspace / "state" / "residual-cases.json").read_text())
        case = residual_doc["cases"][0]
        for measure in case["evidence"].values():
            self.assertFalse(core.is_known(measure))
        self.assertTrue(residual_doc["queryNotes"])

        _write_next_decision(self.workspace, "route")
        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "no-intervention")


class ResidualFallsBackWhenComparisonRemainingIsUnavailableTest(ResidualPtQueryEvidenceTest):
    """N1 (final fix batch C): `evaluation.comparison.remaining` is `None` when
    `evaluate` had no prior observation to diff against
    (`verification.assemble`'s own "no prior" case). `residual` must not crash
    (`residual.extract`'s own `for key in remaining_keys` on a bare `None`) and
    must not silently treat "unknown" as "nothing is failing" either -- it
    falls back to the candidate's own combined observation's known-negative-
    slack checks, exactly like the "no evaluation exists yet" branch already
    does."""

    def setUp(self):
        super().setUp()
        evaluation = json.loads((self.workspace / "state" / "evaluation.json").read_text())
        evaluation["comparison"] = {
            "fixed": None, "remaining": None, "entrant": None, "regressed": None, "missingPrior": None,
            "reason": f"no prior observation recorded for parentStateId {evaluation['parentStateId']!r}",
        }
        evaluation = core.stamp("evaluation", evaluation)
        _write_json(self.workspace / "state" / "evaluation.json", evaluation)

    def test_residual_falls_back_to_the_candidates_own_observation(self):
        result = self._run_residual(self.NET_DOMINATED_REPORT)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        residual_doc = json.loads((self.workspace / "state" / "residual-cases.json").read_text())
        self.assertEqual(len(residual_doc["cases"]), 1)
        case = residual_doc["cases"][0]
        self.assertEqual(case["checks"], [self.CHECK_KEY])
        self.assertTrue(core.is_known(case["evidence"]["netDelay"]))


class ResidualQueriesTheEvaluatedCandidateStateTest(unittest.TestCase):
    """Fix round 2 item 1 (Important): once an evaluation exists, residual's targeted PT
    queries run against the EVALUATED CANDIDATE's own design-state
    (implementations/<mergeId>/design-state.json, cross-checked against
    evaluation.stateId) -- never state/working-state.json, which is still the PARENT
    state for a refused (non-adopted) candidate (adopt never rewrites it on refusal)."""

    CHECK_KEY = "func_ssg_rcworst_m40|setup|U_FF_2/D"

    def test_refused_candidate_uses_its_own_netlist_and_spef_not_the_parents(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)  # parent netlist "netlist.v", spef "corner1.spef"
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        parent_state = json.loads((workspace / "state" / "working-state.json").read_text())
        readiness = _full_flow_readiness(workspace, manifest)
        core.write_artifact(workspace / "state" / "readiness.json", readiness)

        # A distinct CANDIDATE implementation with its OWN netlist/SPEF, never adopted --
        # state/working-state.json below stays the PARENT throughout this test.
        merge_id = "merge-candidate-1"
        candidate_root = workspace / "implementations" / merge_id
        candidate_netlist = candidate_root / "EXPORT" / "design.v"
        _write_text(candidate_netlist, "module top(); wire candidate_only_net; endmodule\n")
        candidate_spef = candidate_root / f"{CORNER}.spef"
        _write_text(candidate_spef, "*SPEF IEEE 1481-1999 candidate\n")
        db_path = candidate_root / "DBS" / "top.enc"
        _write_text(db_path, "candidate db bytes")
        _sha256_matching_empty_directory(db_path.parent / "top.enc.dat")

        candidate_manifest = {
            "top": "top", "stage": "postroute", "root": str(workspace),
            "database": {
                "enc": str(db_path.relative_to(workspace)),
                "encDat": str((db_path.parent / "top.enc.dat").relative_to(workspace)),
            },
            "netlist": str(candidate_netlist.relative_to(workspace)),
            "spef": {CORNER: str(candidate_spef.relative_to(workspace))},
            "sdc": ["constraints.sdc"],  # unchanged by the ECO -- inherited from the parent
            "scenarios": [{"name": name, "corner": CORNER} for name in REQUIRED_SCENARIOS],
            "parentId": parent_state["id"],
        }
        candidate_state = state.design_state(candidate_manifest)
        core.write_artifact(candidate_root / "design-state.json", candidate_state)

        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id, "design": "top", "parentStateId": parent_state["id"],
        })
        evaluation = core.stamp("evaluation", {
            "candidateId": merge_id, "parentStateId": parent_state["id"], "stateId": candidate_state["id"],
            "finalSetupWns": core.known(-0.12), "finalHoldWns": core.known(0.03),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(1), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(0), "missingPriorCheckCount": core.known(0),
            "comparison": {
                "fixed": [], "remaining": [self.CHECK_KEY], "entrant": [], "regressed": [], "missingPrior": [],
            },
            "physical": {"drc": {"total": core.known(0)}, "connectivity": {"total": core.known(0)}},
        })
        _write_json(workspace / "state" / "evaluation.json", evaluation)
        sta = {
            "designStateId": candidate_state["id"], "database": {},
            "sta": {
                "func_ssg_rcworst_m40": {
                    "corner": CORNER, "inputs": {},
                    "observation": {
                        "precision": "gba",
                        "checks": {
                            self.CHECK_KEY: {"slack": core.known(-0.12), "startpoint": "U_FF_1/CP", "pathGroup": "reg2reg"},
                        },
                        "scenarios": {}, "sources": [],
                    },
                },
            },
        }
        _write_json(workspace / "state" / "sta.json", sta)

        # Refused (never adopted): the working state is still the PARENT.
        self.assertEqual(
            json.loads((workspace / "state" / "working-state.json").read_text())["id"], parent_state["id"],
        )

        scenario_corners_path = _scenarios_contract_path(workspace)
        site_profile_path = _site_profile_path(workspace)
        result = _run("residual", workspace, scenario_corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        pt_tcl = (workspace / "research" / "residual" / "g1" / "func_ssg_rcworst_m40" / "pt-query.tcl").read_text()
        self.assertIn(str(candidate_netlist), pt_tcl)
        self.assertIn(str(candidate_spef), pt_tcl)
        self.assertNotIn(str(workspace / "netlist.v"), pt_tcl)
        self.assertNotIn(str(workspace / f"{CORNER}.spef"), pt_tcl)

    def test_evaluated_candidate_state_that_cannot_be_verified_leaves_evidence_unknown(self):
        """When the candidate's own recorded state cannot be located (a broken/incomplete
        implementations/<mergeId>/design-state.json), every bounded check's evidence is
        `unknown` with the reason -- never a silent fall-back to the parent state."""
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        parent_state = json.loads((workspace / "state" / "working-state.json").read_text())
        readiness = _full_flow_readiness(workspace, manifest)
        core.write_artifact(workspace / "state" / "readiness.json", readiness)

        merge_id = "merge-candidate-2"
        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id, "design": "top", "parentStateId": parent_state["id"],
        })
        # No implementations/<merge_id>/design-state.json ever written.
        evaluation = core.stamp("evaluation", {
            "candidateId": merge_id, "parentStateId": parent_state["id"], "stateId": "0" * 20,
            "finalSetupWns": core.known(-0.12), "finalHoldWns": core.known(0.03),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(1), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(0), "missingPriorCheckCount": core.known(0),
            "comparison": {
                "fixed": [], "remaining": [self.CHECK_KEY], "entrant": [], "regressed": [], "missingPrior": [],
            },
            "physical": {"drc": {"total": core.known(0)}, "connectivity": {"total": core.known(0)}},
        })
        _write_json(workspace / "state" / "evaluation.json", evaluation)
        sta = {
            "designStateId": "0" * 20, "database": {},
            "sta": {
                "func_ssg_rcworst_m40": {
                    "corner": CORNER, "inputs": {},
                    "observation": {
                        "precision": "gba",
                        "checks": {
                            self.CHECK_KEY: {"slack": core.known(-0.12), "startpoint": "U_FF_1/CP", "pathGroup": "reg2reg"},
                        },
                        "scenarios": {}, "sources": [],
                    },
                },
            },
        }
        _write_json(workspace / "state" / "sta.json", sta)

        scenario_corners_path = _scenarios_contract_path(workspace)
        site_profile_path = _site_profile_path(workspace)
        result = _run("residual", workspace, scenario_corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        residual_doc = json.loads((workspace / "state" / "residual-cases.json").read_text())
        case = residual_doc["cases"][0]
        for measure in case["evidence"].values():
            self.assertFalse(core.is_known(measure))
        self.assertTrue(residual_doc["queryNotes"])
        self.assertFalse((workspace / "research" / "residual").exists())


class ResidualCarriesTheBatchFailReasonsTest(unittest.TestCase):
    """US10/US34: the evaluated batch's sealed post-auto-finish fail reasons reach the residual,
    per check kind, so the next generation's research reads what plain auto-fix could not fix."""

    CHECK_KEY = "func_ssg_rcworst_m40|setup|U_FF_2/D"

    def _workspace(self, fail_reasons, merge_id_override=None):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        parent_state = json.loads((workspace / "state" / "working-state.json").read_text())
        core.write_artifact(workspace / "state" / "readiness.json", _full_flow_readiness(workspace, manifest))
        merge_commit = core.stamp("merge-commit", {
            "parentStateId": parent_state["id"], "batchId": "gen-1", "contributions": [], "operations": [],
            "choice": {"arm": "control", "reason": "r"}, "failReasons": fail_reasons,
        })
        _write_json(workspace / "state" / "merge-commit.json", merge_commit)
        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id_override or merge_commit["id"], "design": "top",
            "parentStateId": parent_state["id"],
        })
        evaluation = core.stamp("evaluation", {
            "candidateId": merge_commit["id"], "parentStateId": parent_state["id"], "stateId": "0" * 20,
            "finalSetupWns": core.known(-0.12), "finalHoldWns": core.known(0.03),
            "comparison": {"fixed": [], "remaining": [self.CHECK_KEY], "entrant": [], "regressed": [],
                           "missingPrior": []},
        })
        _write_json(workspace / "state" / "evaluation.json", evaluation)
        _write_json(workspace / "state" / "sta.json", {"designStateId": "0" * 20, "database": {}, "sta": {
            "func_ssg_rcworst_m40": {"corner": CORNER, "inputs": {}, "observation": {
                "precision": "gba", "scenarios": {}, "sources": [],
                "checks": {self.CHECK_KEY: {"slack": core.known(-0.12), "startpoint": "U_FF_1/CP"}}}}}})
        return workspace, merge_commit

    def _residual(self, workspace):
        result = _run("residual", workspace, _scenarios_contract_path(workspace), _site_profile_path(workspace))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((workspace / "state" / "residual-cases.json").read_text())

    def test_the_sealed_fail_reasons_reach_the_residual_and_each_case_of_that_check(self):
        reasons = {"arm": "control", "setup": {"no_setup_gain": 3}, "hold": {"break_setup": 2}}
        workspace, merge_commit = self._workspace(reasons)
        doc = self._residual(workspace)
        self.assertEqual(doc["batchFailReasons"], {"mergeCommitId": merge_commit["id"], **reasons})
        self.assertEqual(doc["cases"][0]["failReasons"], {"no_setup_gain": 3})

    def test_a_merge_commit_of_another_candidate_is_not_read(self):
        workspace, _ = self._workspace({"arm": "merged", "setup": {"no_setup_gain": 3}}, merge_id_override="other")
        doc = self._residual(workspace)
        self.assertNotIn("batchFailReasons", doc)
        self.assertEqual(doc["cases"][0]["failReasons"], {})


class ResidualBaselineOnlyTest(unittest.TestCase):
    """Task 12c item 1b: `residual` derives its remaining failing checks from
    `state/observation.json` when `state/evaluation.json` does not exist yet,
    so earlier APR can be chosen straight from the baseline (SPEC Constraint 3)."""

    def test_derives_remaining_checks_from_observation_when_no_evaluation_exists(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        readiness = _full_flow_readiness(workspace, manifest)
        core.write_artifact(workspace / "state" / "readiness.json", readiness)

        failing_check = "func_ssg_rcworst_m40|setup|U1/D"
        passing_check = "func_ssg_rcworst_m40|hold|U2/D"
        observation = core.stamp("observation-set", {
            "designStateId": baseline["id"], "precision": "gba", "scenarios": {},
            "checks": {
                failing_check: {"slack": core.known(-0.05), "startpoint": "U1/CP", "pathGroup": "reg2reg"},
                passing_check: {"slack": core.known(0.02), "startpoint": "U2/CP", "pathGroup": "reg2reg"},
            },
            "missingScenarios": [], "coverage": {"complete": True, "reasons": []}, "sources": [],
        })
        core.write_artifact(workspace / "state" / "observation.json", observation)
        self.assertFalse((workspace / "state" / "evaluation.json").exists())

        scenario_corners_path = _scenarios_contract_path(workspace)
        site_profile_path = _site_profile_path(workspace)

        result = _run("residual", workspace, scenario_corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        residual_doc = json.loads((workspace / "state" / "residual-cases.json").read_text())
        # Only the check with known, NEGATIVE slack is a confirmed failure;
        # the positive-slack check never becomes a residual case.
        self.assertEqual(len(residual_doc["cases"]), 1)
        self.assertEqual(residual_doc["cases"][0]["checks"], [failing_check])
        # No PT report exists for this check yet -- evidence is honestly unknown.
        for measure in residual_doc["cases"][0]["evidence"].values():
            self.assertFalse(core.is_known(measure))
        self.assertTrue(residual_doc["queryNotes"])


class AprPrepareRunTest(unittest.TestCase):
    """G24 + fix round 1 (Task 14 G1): `apr-prepare` reads `stage` from
    `research/requests/next-decision.json` (never argv) and refuses under
    post-route-only scope; `apr-run` reads everything from
    `state/apr-task.json` and actually executes the prepared stage task,
    writing an `implement`-shaped candidate `extract` (and, further, `sta`/
    `evaluate`/`adopt`) accept unchanged."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", self.manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())
        baseline_observation = _baseline_observation(self.workspace, self.working_state)
        core.write_artifact(self.workspace / "state" / "observation.json", baseline_observation)
        contract_dir = _analysis_contract_dir(self.workspace)
        result = _run("policy", self.workspace, contract_dir, "0.0", "0.0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result = _run_physical_baseline(self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def _write_residual_cases(self):
        residual_case = {
            "checks": ["func_ssg_rcworst_m40|setup|U1/reg"],
            "evidence": {
                "cellDelay": core.known(0.1), "netDelay": core.known(0.5),
                "slew": core.unknown("not observed"), "fanout": core.unknown("not observed"),
                "location": core.unknown("not observed"),
            },
            "attempts": [], "limits": [], "suggestedStage": "route", "requiredInputs": [],
        }
        _write_json(self.workspace / "state" / "residual-cases.json", {"cases": [residual_case]})

    def test_apr_prepare_requires_earlier_apr_action(self):
        readiness = _full_flow_readiness(self.workspace, self.manifest)
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()
        _write_json(self.workspace / NEXT_DECISION_REL_PATH, {"action": "observe", "stage": "place"})

        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "invalid-input")
        self.assertFalse((self.workspace / "state" / "apr-task.json").exists())

    def test_apr_prepare_refuses_under_post_route_only(self):
        readiness = _post_route_only_readiness(self.manifest)
        self.assertEqual(readiness["scope"], "post-route-only")
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()
        _write_next_decision(self.workspace, "place")

        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "lifecycle-unavailable")
        self.assertFalse((self.workspace / "state" / "apr-task.json").exists())

    def _prepare_and_run_apr(self, stage):
        readiness = _full_flow_readiness(self.workspace, self.manifest)
        self.assertEqual(readiness["scope"], "full-flow")
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()
        _write_next_decision(self.workspace, stage)

        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        task = json.loads((self.workspace / "state" / "apr-task.json").read_text())
        self.assertIn("taskId", task)
        self.assertEqual(task["stage"], stage)

        output_root = self.workspace / "apr" / stage / task["taskId"]
        (output_root / "DBS").mkdir(parents=True, exist_ok=True)
        (output_root / "DBS" / f"{stage}.enc").write_bytes(b"apr stage database bytes")
        _sha256_matching_empty_directory(output_root / "DBS" / f"{stage}.enc.dat")
        _write_text(output_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(output_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(output_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(output_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(self.workspace)
        result = _run("apr-run", self.workspace, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        implement = json.loads((self.workspace / "state" / "implement.json").read_text())
        self.assertEqual(implement["mergeCommitId"], task["taskId"])
        self.assertEqual(implement["parentStateId"], self.working_state["id"])
        self.assertEqual(implement["design"], self.working_state["top"])
        self.assertIn("sha256", implement["drcReport"])
        return implement, site_profile_path

    def test_apr_run_writes_an_implement_shaped_candidate_extract_accepts(self):
        implement, site_profile_path = self._prepare_and_run_apr("place")

        corners_path = self.workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        extract_output_root = self.workspace / "implementations" / implement["mergeCommitId"]
        _write_text(extract_output_root / "starrc" / CORNER / f"{self.working_state['top']}.{CORNER}.spef",
                     "*SPEF IEEE 1481-1999\n")
        result = _run("extract", self.workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_apr_run_refuses_when_the_recorded_tcl_does_not_match_a_fresh_recompile(self):
        """I8 (final review): `apr-run` recompiles the task from its recorded recipe
        (residual cases, readiness, working state) and refuses if the result does not
        reproduce state/apr-task.json's own tcl -- a tampered or stale recorded task
        is never trusted blindly."""
        readiness = _full_flow_readiness(self.workspace, self.manifest)
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()
        _write_next_decision(self.workspace, "place")
        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        task_path = self.workspace / "state" / "apr-task.json"
        task = json.loads(task_path.read_text())
        task["tcl"] = task["tcl"] + "\n# tampered\n"
        _write_json(task_path, task)

        site_profile_path = _site_profile_path(self.workspace)
        result = _run("apr-run", self.workspace, site_profile_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "implement.json").exists())
        self.assertFalse((self.workspace / "apr" / "place" / task["taskId"]).exists())

    def test_apr_run_refuses_when_residual_cases_changed_since_prepare(self):
        """A stale `apr-task.json` compiled against different residual-case evidence
        must also be caught -- not only a hand-edited `tcl` string."""
        readiness = _full_flow_readiness(self.workspace, self.manifest)
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()
        _write_next_decision(self.workspace, "place")
        result = _run("apr-prepare", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        task = json.loads((self.workspace / "state" / "apr-task.json").read_text())

        # The residual evidence changes (e.g. a fresh `residual` re-run) to a
        # cell/transition-dominated case (useful-skew mechanism) instead of the
        # original net-delay-dominated one (path-group mechanism) -- a genuinely
        # different compiled hook, not just different numbers feeding the same one.
        _write_json(self.workspace / "state" / "residual-cases.json", {"cases": [{
            "checks": ["func_ssg_rcworst_m40|setup|U1/reg"],
            "evidence": {
                "cellDelay": core.known(0.5), "netDelay": core.unknown("not observed"),
                "slew": core.known(0.2), "fanout": core.unknown("not observed"),
                "location": core.unknown("not observed"),
            },
            "attempts": [], "limits": [], "suggestedStage": "route", "requiredInputs": [],
        }]})

        site_profile_path = _site_profile_path(self.workspace)
        result = _run("apr-run", self.workspace, site_profile_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "apr" / "place" / task["taskId"]).exists())

    def test_apr_run_candidate_flows_through_sta_evaluate_adopt(self):
        """Item 6: an apr-run candidate, driven all the way through sta -> evaluate -> adopt."""
        implement, site_profile_path = self._prepare_and_run_apr("route")
        merge_id = implement["mergeCommitId"]

        corners_path = self.workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        impl_root = self.workspace / "implementations" / merge_id
        _write_text(impl_root / "starrc" / CORNER / f"{self.working_state['top']}.{CORNER}.spef",
                     "*SPEF IEEE 1481-1999\n")
        result = _run("extract", self.workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())
        query_spec_path = self.workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        # Fix round 2 item 2: SDC comes from working-state's own recorded sdc[0].
        scenario_corners_path = _scenarios_contract_path(self.workspace)
        result = _run("sta", self.workspace, query_spec_path, scenario_corners_path,
                       self.workspace / "state" / "working-state.json", site_profile_path, "5000")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # Minor (final review): the candidate's own design-state must carry the real
        # APR stage ("route") it was actually implemented at, never a hard-coded
        # "postroute" borrowed from the real-merge-commit path.
        candidate_design_state = json.loads((impl_root / "design-state.json").read_text())
        self.assertEqual(candidate_design_state["stage"], "route")

        result = _run("physical", self.workspace, "candidate")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        result = _run("evaluate", self.workspace, self.workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evaluation = json.loads((self.workspace / "state" / "evaluation.json").read_text())
        self.assertEqual(core.value_of(evaluation["missingRequiredCheckCount"]), 0)
        self.assertEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 0)

        result = _run("adopt", self.workspace, self.workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        envelope = json.loads((self.workspace / "accepted" / "latest.json").read_text())
        acceptance_record = json.loads((self.workspace / envelope["acceptanceRecord"]).read_text())
        self.assertNotEqual(acceptance_record["decision"], "refused")
        working_state_after = json.loads((self.workspace / "state" / "working-state.json").read_text())
        self.assertNotEqual(working_state_after["id"], self.working_state["id"])

        # No merge-commit.json was ever written for this candidate (no Integration
        # Fix Session batch was composed) -- record-experience must still work,
        # falling back to the next-decision's own reason (item 4).
        result = _run("record-experience", self.workspace, self.workspace / "research" / "requests" / "integration-plan.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        experience = json.loads((self.workspace / "state" / "experience.json").read_text())
        entry = experience["entries"][-1]
        self.assertEqual(entry["hypothesis"], "residual evidence points at an earlier restart")


class RecordExperienceComposedTest(unittest.TestCase):
    """G5 + fix round 1 (items 1, 2): `record-experience` composes lineage/decision/
    outcome from state files, never a `research/requests/experience-*` file;
    `predicted`/`measured` are deltas against the parent state's own min WNS;
    a blank reason or a missing precision refuses rather than writing `null`."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())
        self.decision_id_seed = 0

    def _write_candidate(self, parent_min_wns, candidate_setup_wns, candidate_hold_wns,
                          predicted_setup=0.02, predicted_hold=0.05, validation_level="xtop",
                          parent_known=True, precision="gba", merge_commit_extra=None):
        self.decision_id_seed += 1
        state_id = f"candidate-state-{self.decision_id_seed}"

        if parent_known:
            policy = core.stamp("policy", {
                "allowDegradedWorking": True, "degradeLimitNs": 1.0, "maxNewConstraintFailures": 0,
                "scenarioCorners": {}, "requiredScenarios": list(REQUIRED_SCENARIOS),
                "goal": {"setup": 0.0, "hold": 0.0}, "baselineStateId": self.working_state["id"],
                "baselineMinWns": parent_min_wns, "campaignRoot": str(self.workspace),
            })
            _write_json(self.workspace / "state" / "policy.json", policy)
        else:
            (self.workspace / "state" / "policy.json").unlink(missing_ok=True)

        # Task 12c item 5: provenance is decided by comparing implement.json's own
        # mergeCommitId against merge-commit.json's own (real, digest-computed) id --
        # never an arbitrary label -- so this fixture's merge_id must be the actual
        # stamped id, not a synthetic string.
        merge_commit = core.stamp("merge-commit", {
            "parentStateId": self.working_state["id"],
            "contributions": [{"id": "contrib-1", "revision": 1}],
            "operations": [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}],
            "innovusEcoTcl": "ecoChangeCell -inst {U1} -cell BUFX2", "sourceMap": {}, "newNets": [],
            **(merge_commit_extra or {}),
        })
        merge_id = merge_commit["id"]
        _write_json(self.workspace / "state" / "merge-commit.json", merge_commit)
        # Minor (final review): `record-experience` now checks the reasonSource plan's
        # own `batchId` against `state/replay-request.json`'s -- this fixture's
        # `reason_path` envelopes all name "batch-fixture" (see the module-level sed
        # above/each test's own `_write_json(reason_path, ...)` call).
        replay_request = core.stamp("replay-request", {
            "batchId": "batch-fixture", "baseStateId": self.working_state["id"],
            "steps": [], "expectedDelta": {},
        })
        _write_json(self.workspace / "state" / "replay-request.json", replay_request)
        _write_json(self.workspace / "state" / "implement.json", {
            "mergeCommitId": merge_id, "design": "top", "parentStateId": self.working_state["id"],
        })

        predicted = {}
        if validation_level == "xtop":
            predicted = {"xtopSetupWns": core.known(predicted_setup), "xtopHoldWns": core.known(predicted_hold)}
        elif validation_level == "presta":
            predicted = {"prestaSetupWns": core.known(predicted_setup), "prestaHoldWns": core.known(predicted_hold)}
        contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 1, "baseStateId": self.working_state["id"], "kind": "fix",
            "operations": [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}],
            "script": None, "beforeDumpSha256": "0" * 64,
            "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            "touches": {"instances": ["U1"], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": predicted, "validationLevel": validation_level, "diagnosis": None,
            "admissible": True, "refusals": [], "outOfScope": [],
        })
        contribution["id"] = "contrib-1"
        _write_json(self.workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})

        evaluation = core.stamp("evaluation", {
            "candidateId": merge_id, "parentStateId": self.working_state["id"], "stateId": state_id,
            "finalSetupWns": core.known(candidate_setup_wns), "finalHoldWns": core.known(candidate_hold_wns),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(0), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(1), "missingPriorCheckCount": core.known(0),
            "comparison": {"fixed": [], "remaining": [], "entrant": [], "regressed": [], "missingPrior": []},
            "physical": {"drc": {"total": core.known(0)}, "connectivity": {"total": core.known(0)}},
        })
        _write_json(self.workspace / "state" / "evaluation.json", evaluation)

        if precision is not None:
            sta = {
                "designStateId": state_id, "database": {},
                "sta": {"func_ssg_rcworst_m40": {"corner": CORNER, "inputs": {}, "observation": {"precision": precision}}},
            }
        else:
            sta = {"designStateId": state_id, "database": {}, "sta": {}}
        _write_json(self.workspace / "state" / "sta.json", sta)

        reason_path = self.workspace / f"reason-{self.decision_id_seed}.json"
        return reason_path

    def test_a_reason_source_from_a_different_batch_is_refused(self):
        """Minor (final review): `record-experience` used to trust `<reasonSource>`'s
        own `reason` purely by convention -- nothing verified it was actually the plan
        the sealed merge commit was produced from. A stale envelope from an unrelated
        batch (still sitting on disk from an earlier round) must not silently supply
        this candidate's recorded hypothesis."""
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {
            "plan": {"batchId": "some-other-stale-batch", "reason": "wrong batch's own reason"}, "facts": {},
        })

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "experience.json").exists())

    def test_measured_positive_delta_is_helped(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "candidate closed the remaining setup violation on U1"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertEqual(entry["hypothesis"], "candidate closed the remaining setup violation on U1")
        self.assertAlmostEqual(core.value_of(entry["measured"]), 0.04)  # 0.04 - 0.0
        self.assertAlmostEqual(core.value_of(entry["predicted"]), 0.02)  # min(0.02, 0.05) - 0.0
        self.assertEqual(entry["verdict"], "helped")

    def _recipe_entry(self, control_prediction):
        """A recipe batch that chose control: its prediction is the chosen arm's XTop summary."""
        reason_path = self._write_candidate(
            parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04, merge_commit_extra={
                "contributions": [], "choice": {"arm": "control", "reason": "r"}, "arms": {
                    "merged": {"prediction": {"worstSetupWns": -0.01, "worstHoldWns": -0.02}},
                    "control": {"prediction": control_prediction}}})
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "ranked recipe"}, "facts": {}})
        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]

    def test_a_recipe_batch_predicts_from_the_chosen_arms_xtop_summary(self):
        entry = self._recipe_entry({"worstSetupWns": 0.0, "worstHoldWns": -0.03})
        self.assertAlmostEqual(core.value_of(entry["predicted"]), -0.03)  # min(0.0, -0.03) - 0.0
        self.assertEqual(entry["conditions"]["predictionModel"], "xtop")

    def test_an_unknown_chosen_arm_prediction_is_an_unknown_prediction(self):
        entry = self._recipe_entry({"unknown": "no readable hold table"})
        self.assertFalse(core.is_known(entry["predicted"]))
        self.assertIn("no readable hold table", entry["predicted"]["unknown"])
        self.assertEqual(entry["conditions"]["predictionModel"], "unknown")

    def test_measured_negative_delta_is_hurt(self):
        reason_path = self._write_candidate(parent_min_wns=0.05, candidate_setup_wns=0.01, candidate_hold_wns=0.01)
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "candidate regressed relative to the parent"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertAlmostEqual(core.value_of(entry["measured"]), -0.04)  # 0.01 - 0.05
        self.assertEqual(entry["verdict"], "hurt")

    def test_measured_zero_delta_is_neutral(self):
        reason_path = self._write_candidate(parent_min_wns=0.04, candidate_setup_wns=0.04, candidate_hold_wns=0.09)
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "candidate matched the parent exactly"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertEqual(core.value_of(entry["measured"]), 0.0)
        self.assertEqual(entry["verdict"], "neutral")

    def test_unknown_parent_min_wns_makes_measured_and_predicted_unknown(self):
        reason_path = self._write_candidate(
            parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04, parent_known=False,
        )
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "no recorded parent min WNS for this state"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertNotIn("value", entry["measured"])
        self.assertIn("unknown", entry["measured"])
        self.assertNotIn("value", entry["predicted"])
        self.assertEqual(entry["verdict"], "unknown")

    def test_blank_reason_is_refused(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "   "}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertFalse((self.workspace / "state" / "experience.json").exists())

    def test_missing_reason_field_is_refused(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "question": "no reason field at all"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")

    def test_no_scenario_carrying_a_precision_is_refused(self):
        reason_path = self._write_candidate(
            parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04, precision=None,
        )
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "a real reason, but sta has no precision anywhere"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertFalse((self.workspace / "state" / "experience.json").exists())

    def test_no_research_requests_experience_file_is_ever_read_or_written(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"batchId": "batch-fixture", "reason": "candidate closed the remaining setup violation on U1"}, "facts": {}})
        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.workspace / "research").exists())


class ReplayPrepareBatchIdWriteOnceTest(unittest.TestCase):
    """I12 (final review): batch ids must be unique -- `replay-prepare` refuses to
    replay the same `batchId` a second time (`integrations/<batchId>/` write-once)."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        working_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {}, "sdc": [], "tools": {}, "scenarios": [], "parentId": None,
        })
        self.base_state_path = self.workspace / "base-state.json"
        _write_json(self.base_state_path, working_state)
        self.base_state_id = working_state["id"]
        _write_xtop_context(self.workspace, self.base_state_id, ("synthetic",))

        contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 1, "baseStateId": self.base_state_id, "kind": "fix",
            "operations": [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}],
            "script": None, "beforeDumpSha256": "0" * 64,
            "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            "touches": {"instances": ["U1"], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {}, "validationLevel": "none", "diagnosis": None,
            "admissible": True, "refusals": [], "outOfScope": [],
        })
        _write_json(self.workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(self.base_state_id, [contribution], [])
        _write_json(self.workspace / "state" / "composition-facts.json", facts)

        self.plan_path = self.workspace / "integration-plan.json"
        _write_json(self.plan_path, {
            "plan": {
                "batchId": "batch-1", "baseStateId": self.base_state_id,
                "select": [contribution["id"]], "resolutions": [], "deferred": [], "reason": "single fix",
            },
            "facts": facts,
        })
        self.site_profile_path = _site_profile_path(self.workspace, ("synthetic",))

    def test_second_replay_prepare_with_the_same_batch_id_is_refused(self):
        result1 = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, self.site_profile_path)
        self.assertEqual(result1.returncode, 0, result1.stdout + result1.stderr)
        self.assertTrue((self.workspace / "integrations" / "batch-1" / "xtop-replay.tcl").is_file())

        result2 = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, self.site_profile_path)
        self.assertEqual(result2.returncode, 3, result2.stdout + result2.stderr)
        payload = json.loads(result2.stderr)
        self.assertEqual(payload["code"], "batch-id-reused")

    def test_a_genuinely_different_batch_id_succeeds_independently(self):
        result1 = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, self.site_profile_path)
        self.assertEqual(result1.returncode, 0, result1.stdout + result1.stderr)

        envelope = json.loads(self.plan_path.read_text())
        envelope["plan"]["batchId"] = "batch-2"
        _write_json(self.plan_path, envelope)
        result2 = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, self.site_profile_path)
        self.assertEqual(result2.returncode, 0, result2.stdout + result2.stderr)
        self.assertTrue((self.workspace / "integrations" / "batch-2" / "xtop-replay.tcl").is_file())


class ReplayPrepareToolFailureTest(unittest.TestCase):
    """I3 (final review): a replay run that fails outright is no longer silently
    swallowed -- its detail and log path are recorded, never discarded."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        working_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {}, "sdc": [], "tools": {}, "scenarios": [], "parentId": None,
        })
        self.base_state_path = self.workspace / "base-state.json"
        _write_json(self.base_state_path, working_state)
        self.base_state_id = working_state["id"]
        _write_xtop_context(self.workspace, self.base_state_id, ("synthetic",))

        contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 1, "baseStateId": self.base_state_id, "kind": "fix",
            "operations": [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}],
            "script": None, "beforeDumpSha256": "0" * 64,
            "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            "touches": {"instances": ["U1"], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {}, "validationLevel": "none", "diagnosis": None,
            "admissible": True, "refusals": [], "outOfScope": [],
        })
        _write_json(self.workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(self.base_state_id, [contribution], [])
        _write_json(self.workspace / "state" / "composition-facts.json", facts)
        self.plan_path = self.workspace / "integration-plan.json"
        _write_json(self.plan_path, {
            "plan": {
                "batchId": "batch-fail", "baseStateId": self.base_state_id,
                "select": [contribution["id"]], "resolutions": [], "deferred": [], "reason": "single fix",
            },
            "facts": facts,
        })
        # A wrapper that always fails -- stands in for a real XTop session that
        # never even reaches the point of producing any receipts.
        failing_wrapper = self.workspace / "failing-wrapper.sh"
        failing_wrapper.write_text("#!/bin/sh\necho 'ERROR: xtop crashed' >&2\nexit 7\n", encoding="utf-8")
        failing_wrapper.chmod(0o755)
        self.site_profile_path = self.workspace / "site-profile.json"
        _write_json(self.site_profile_path, {
            "edaShell": [str(failing_wrapper)], "design": "top",
            "techLef": str(self.workspace / "tech.lef"), "cellLefGlob": str(self.workspace / "cells" / "*.lef"),
            **_xtop_site_config(self.workspace, ("synthetic",)),
        })

    def test_a_failed_replay_run_records_tool_failure_instead_of_being_swallowed(self):
        result = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, self.site_profile_path)
        # Not a replay-prepare refusal in its own right (architecture Sec.8.4):
        # the declared output is still written, exit 0.
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipts_doc = json.loads((self.workspace / "state" / "replay-receipts.json").read_text())
        self.assertIn("toolFailure", receipts_doc)
        self.assertIn("log", receipts_doc["toolFailure"])
        self.assertTrue(Path(receipts_doc["toolFailure"]["log"]).is_file())
        self.assertEqual(receipts_doc["receipts"], [])

    def test_a_successful_replay_run_never_carries_a_tool_failure_field(self):
        ok_wrapper = self.workspace / "ok-wrapper.sh"
        ok_wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        ok_wrapper.chmod(0o755)
        _write_json(self.site_profile_path, {
            "edaShell": [str(ok_wrapper)], "design": "top",
            "techLef": str(self.workspace / "tech.lef"), "cellLefGlob": str(self.workspace / "cells" / "*.lef"),
            **_xtop_site_config(self.workspace, ("synthetic",)),
        })
        result = _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path, self.site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipts_doc = json.loads((self.workspace / "state" / "replay-receipts.json").read_text())
        self.assertNotIn("toolFailure", receipts_doc)


class ComposeFactsSecondPassTest(unittest.TestCase):
    """Task 12c item 4c: `compose-facts`' `resolutions` come only from the SAME
    admitted integration-plan envelope `replay-prepare`/`record-experience`
    read -- no separate `resolutions.json`. The first pass (no plan file
    exists yet) resolves nothing; the second pass (after the compose
    Workshop's plan is admitted) applies its own `resolutions` and lowers
    `unresolvedCount` -- the conflict itself is still reported as a fact,
    just now counted as resolved."""

    def _contribution(self, contribution_id, base_state_id, to_master):
        body = {
            "taskId": "w01", "revision": 1, "baseStateId": base_state_id, "kind": "fix",
            "operations": [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": to_master}],
            "script": None, "beforeDumpSha256": "0" * 64,
            "delta": {"mastersChanged": {"U1": ["BUFX1", to_master]}, "added": {}, "removed": {}},
            "touches": {"instances": ["U1"], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {}, "validationLevel": "none", "diagnosis": None,
            "admissible": True, "refusals": [], "outOfScope": [],
        }
        stamped = core.stamp("contribution", body)
        stamped["id"] = contribution_id
        return stamped

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        working_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {}, "sdc": [], "tools": {}, "scenarios": [], "parentId": None,
        })
        _write_json(self.workspace / "state" / "working-state.json", working_state)
        self.base_state_id = working_state["id"]
        contribution_a = self._contribution("contrib-a", self.base_state_id, "BUFX2")
        contribution_b = self._contribution("contrib-b", self.base_state_id, "BUFX3")
        _write_json(self.workspace / "state" / "contributions-collected.json",
                    {"contributions": [contribution_a, contribution_b]})
        self.conflict_key = composition.conflict_key(
            "same-instance-different-master", ["contrib-a", "contrib-b"], ["U1"],
        )

    def test_first_pass_has_no_resolutions_and_reports_the_conflict_unresolved(self):
        plan_path = self.workspace / "integration-plan.json"  # not admitted yet -- does not exist
        result = _run("compose-facts", self.workspace, plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = json.loads((self.workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(len(facts["conflicts"]), 1)
        self.assertEqual(facts["conflicts"][0]["key"], self.conflict_key)
        self.assertEqual(facts["unresolvedCount"], 1)

    def test_second_pass_applies_the_admitted_plans_own_resolutions(self):
        plan_path = self.workspace / "integration-plan.json"
        envelope = {
            "plan": {
                "batchId": "batch1", "baseStateId": self.base_state_id,
                "select": ["contrib-a"],
                "resolutions": [{"conflictKey": self.conflict_key, "decision": "keep:contrib-a"}],
                "deferred": ["contrib-b"], "reason": "keep contrib-a, defer contrib-b",
            },
            "facts": {},
        }
        _write_json(plan_path, envelope)
        result = _run("compose-facts", self.workspace, plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = json.loads((self.workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(len(facts["conflicts"]), 1)  # still reported as a fact...
        self.assertEqual(facts["conflicts"][0]["key"], self.conflict_key)
        self.assertEqual(facts["unresolvedCount"], 0)  # ...just now resolved, via the admitted plan.

    def test_a_plan_for_a_stale_base_state_id_is_skipped_like_a_first_pass(self):
        """Fix round 2 item 4: an admitted plan file left over from an earlier round, whose
        own baseStateId no longer matches the CURRENT working state, is treated exactly
        like no plan exists yet -- never re-applied to the current batch."""
        plan_path = self.workspace / "integration-plan.json"
        _write_json(plan_path, {
            "plan": {
                "batchId": "old-batch", "baseStateId": "some-other-stale-state-id",
                "select": ["contrib-a"],
                "resolutions": [{"conflictKey": self.conflict_key, "decision": "keep:contrib-a"}],
                "deferred": ["contrib-b"], "reason": "an earlier round's own plan",
            },
            "facts": {},
        })
        result = _run("compose-facts", self.workspace, plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = json.loads((self.workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(facts["unresolvedCount"], 1)  # resolutions NOT applied

    def test_a_plan_whose_batch_was_already_replayed_is_skipped(self):
        """Fix round 2 item 4: an admitted plan whose own batchId already appears in
        state/replay-request.json (that exact batch has already been prepared/replayed)
        is stale -- skipped like a first pass, never re-applied."""
        replay_request = core.stamp("replay-request", {
            "batchId": "batch1", "baseStateId": self.base_state_id, "steps": [], "expectedDelta": {},
        })
        core.write_artifact(self.workspace / "state" / "replay-request.json", replay_request)

        plan_path = self.workspace / "integration-plan.json"
        _write_json(plan_path, {
            "plan": {
                "batchId": "batch1", "baseStateId": self.base_state_id,
                "select": ["contrib-a"],
                "resolutions": [{"conflictKey": self.conflict_key, "decision": "keep:contrib-a"}],
                "deferred": ["contrib-b"], "reason": "already replayed in an earlier pass",
            },
            "facts": {},
        })
        result = _run("compose-facts", self.workspace, plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = json.loads((self.workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(facts["unresolvedCount"], 1)  # resolutions NOT applied



    def _graph_tool_argv(self, node_id):
        """The argv the shipped contract gives the tool that graph node `node_id` runs,
        `${WORKSPACE}` bound to this test's workspace (read from graph.yml and contract.yml)."""
        import re
        graph = (PACK_DIR / "legacy/0.2.10/graph.yml").read_text(encoding="utf-8")
        contract = (PACK_DIR / "legacy/0.2.10/contract.yml").read_text(encoding="utf-8")
        node = re.search(rf"^  - id: {re.escape(node_id)}\n    kind: act\n    parameters: \{{ tool: ([\w-]+) \}}$",
                         graph, re.M)
        self.assertIsNotNone(node, f"graph node {node_id} runs no tool")
        tool = re.search(rf"^  - id: {re.escape(node.group(1))}\n(.*?)(?=^  - id: |^\S)", contract, re.S | re.M)
        argv = re.findall(r"^      - (\S+)$", tool.group(1).split("    argv:\n", 1)[1], re.M)
        return [word.replace("${WORKSPACE}", str(self.workspace)) for word in argv]

    def test_a_refused_plan_with_malformed_resolutions_is_not_applied(self):
        """C06 (#63 failure catalogue, ea3993f3, ported for #64): PR03's generation-3 first pass exited 3
        (missing-input `resolutions[].conflictKey is required`) on the integration plan the Reader had
        refused in generation 2, still on disk. The first pass runs before the compose Workshop writes
        this batch's plan, so the graph's first-pass node must never read that file; only the second
        pass, behind request-admissible PASS, applies a plan's resolutions."""
        plan_path = self.workspace / "research" / "requests" / "integration-plan.json"
        _write_json(plan_path, {"plan": {
            "batchId": "batch-g2", "baseStateId": self.base_state_id, "select": [],
            "resolutions": [{"contributionId": "contrib-a", "decision": "drop", "reason": "no-fix", "taskId": "w01"}],
            "deferred": [], "reason": "gen-2 plan the Reader refused"}, "facts": {}})
        first = self._graph_tool_argv("compose-facts")
        self.assertEqual(first[:3], ["python3", f"{self.workspace}/flow/atcs_cli.py", "compose-facts"])
        result = _run("compose-facts", self.workspace, *first[4:])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = json.loads((self.workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(facts["unresolvedCount"], 1)  # the refused plan's resolutions are not applied
        second = self._graph_tool_argv("compose-facts-admitted")
        self.assertEqual(second[4:], [str(plan_path)], "the second pass reads the admitted plan")


class RecordExperienceProvenanceTest(unittest.TestCase):
    """Task 12c item 5: `record-experience` decides merge-vs-APR by comparing ids
    (`state/implement.json`'s `mergeCommitId` against `state/merge-commit.json`'s
    own `id` and `state/apr-task.json`'s own `taskId`), never by whether
    `state/merge-commit.json` merely exists on disk -- a stale merge-commit
    left over from an earlier batch (never deleted by `apr-run`) must not make
    a later `apr-run` candidate's `record-experience` call read that stale
    batch's own (wrong) reason."""

    def test_stale_merge_commit_file_does_not_override_the_apr_candidates_reason(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        working_state = json.loads((workspace / "state" / "working-state.json").read_text())

        # A real, earlier batch's own merge commit -- left on disk (apr-run never deletes it).
        stale_merge_commit = core.stamp("merge-commit", {
            "parentStateId": working_state["id"], "contributions": [], "operations": [],
            "innovusEcoTcl": "ecoChangeCell -inst {U1} -cell BUFX2", "sourceMap": {}, "newNets": [],
        })
        _write_json(workspace / "state" / "merge-commit.json", stale_merge_commit)

        # The CURRENT candidate is a pure APR-run stage intervention -- no batch was composed.
        apr_task_id = "apr-task-1"
        _write_json(workspace / "state" / "apr-task.json", {"tcl": "# stage tcl", "taskId": apr_task_id, "stage": "route"})
        _write_json(workspace / "state" / "implement.json", {
            "mergeCommitId": apr_task_id, "design": "top", "parentStateId": working_state["id"],
        })

        evaluation = core.stamp("evaluation", {
            "candidateId": apr_task_id, "parentStateId": working_state["id"], "stateId": "apr-candidate-state",
            "finalSetupWns": core.known(0.05), "finalHoldWns": core.known(0.04),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(0), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(1), "missingPriorCheckCount": core.known(0),
            "comparison": {"fixed": [], "remaining": [], "entrant": [], "regressed": [], "missingPrior": []},
            "physical": {"drc": {"total": core.known(0)}, "connectivity": {"total": core.known(0)}},
        })
        _write_json(workspace / "state" / "evaluation.json", evaluation)
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": []})
        _write_json(workspace / "state" / "sta.json", {
            "designStateId": "apr-candidate-state", "database": {},
            "sta": {"func_ssg_rcworst_m40": {"corner": CORNER, "inputs": {}, "observation": {"precision": "gba"}}},
        })
        policy = core.stamp("policy", {
            "allowDegradedWorking": True, "degradeLimitNs": 1.0, "maxNewConstraintFailures": 0,
            "scenarioCorners": {}, "requiredScenarios": list(REQUIRED_SCENARIOS),
            "goal": {"setup": 0.0, "hold": 0.0}, "baselineStateId": working_state["id"],
            "baselineMinWns": 0.0, "campaignRoot": str(workspace),
        })
        _write_json(workspace / "state" / "policy.json", policy)

        # The stale batch's own (WRONG -- must never be read) integration-plan envelope.
        integration_plan_path = workspace / "research" / "requests" / "integration-plan.json"
        _write_json(integration_plan_path, {
            "plan": {"reason": "WRONG: this is the earlier stale batch's own reason"}, "facts": {},
        })
        # The next-investment Workshop's own reason for THIS (APR) candidate.
        _write_json(workspace / NEXT_DECISION_REL_PATH, {
            "action": "earlier-apr", "stage": "route", "reason": "earlier APR route chosen for this candidate",
        })

        result = _run("record-experience", workspace, integration_plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        experience = json.loads((workspace / "state" / "experience.json").read_text())
        entry = experience["entries"][-1]
        self.assertEqual(entry["hypothesis"], "earlier APR route chosen for this candidate")


class MainErrorMappingTest(unittest.TestCase):
    """Minor (final review): `main()` never lets an `OSError`/`KeyError`/`TypeError`/
    `ValueError` escaping a handler surface as a raw traceback at exit 1 -- each is
    mapped to a `{"code","detail"}` JSON payload on stderr at exit 2, the same
    "malformed/unreadable declared input" contract as `InputError`."""

    def setUp(self):
        self.addCleanup(atcs_cli.SUBCOMMANDS.pop, "test-raise", None)

    def _run_with_raising_handler(self, exc):
        def handler(workspace, args):
            raise exc

        atcs_cli.SUBCOMMANDS["test-raise"] = handler
        import contextlib
        import io
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = atcs_cli.main(["test-raise", "unused-workspace"])
        return exit_code, stderr.getvalue()

    def test_key_error_is_mapped_not_a_raw_traceback(self):
        exit_code, stderr = self._run_with_raising_handler(KeyError("missingField"))
        self.assertEqual(exit_code, 2)
        payload = json.loads(stderr)
        self.assertEqual(payload["code"], "malformed-input")
        self.assertIn("KeyError", payload["detail"])

    def test_type_error_is_mapped_not_a_raw_traceback(self):
        exit_code, stderr = self._run_with_raising_handler(TypeError("not subscriptable"))
        self.assertEqual(exit_code, 2)
        self.assertEqual(json.loads(stderr)["code"], "malformed-input")

    def test_value_error_is_mapped_not_a_raw_traceback(self):
        exit_code, stderr = self._run_with_raising_handler(ValueError("invalid literal"))
        self.assertEqual(exit_code, 2)
        self.assertEqual(json.loads(stderr)["code"], "malformed-input")

    def test_os_error_is_mapped_not_a_raw_traceback(self):
        exit_code, stderr = self._run_with_raising_handler(OSError("disk gone"))
        self.assertEqual(exit_code, 2)
        self.assertEqual(json.loads(stderr)["code"], "malformed-input")


class MainResolvesWorkspaceToAnAbsolutePathTest(unittest.TestCase):
    """Minor (final review, final fix batch C): `main()`'s own `workspace` argv
    value is resolved to an absolute path BEFORE it is handed to any subcommand
    handler -- a relative `workspace` argument (e.g. a Harness invocation whose
    own cwd is not guaranteed stable, or simply `.`) must never leave every
    later-written path (declared outputs, `_relpath`-computed refs a LATER,
    separately-invoked subcommand must resolve the exact same way) dependent on
    this one process's transient cwd."""

    def setUp(self):
        self.addCleanup(atcs_cli.SUBCOMMANDS.pop, "test-capture-workspace", None)

    def test_relative_workspace_argv_is_absolute_by_the_time_a_handler_sees_it(self):
        captured = {}

        def handler(workspace, args):
            captured["workspace"] = workspace
            return Path(workspace) / "out.json", {"ok": True}

        atcs_cli.SUBCOMMANDS["test-capture-workspace"] = handler
        tmp = _tmp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        original_cwd = os.getcwd()
        os.chdir(tmp)
        try:
            exit_code = atcs_cli.main(["test-capture-workspace", "relative-ws"])
        finally:
            os.chdir(original_cwd)

        self.assertEqual(exit_code, 0)
        self.assertTrue(os.path.isabs(captured["workspace"]), captured["workspace"])
        self.assertEqual(Path(captured["workspace"]).resolve(), (tmp / "relative-ws").resolve())
        # The declared output the handler named (workspace-relative) actually
        # landed under the RESOLVED absolute workspace, not wherever a later,
        # different-cwd process might have (mis)resolved "relative-ws" against.
        self.assertTrue((tmp / "relative-ws" / "out.json").is_file())


class EvaluateUnconstrainedCoverageTest(TwoRoundFlowTest):
    """I6 (final review): `evaluate` must count a candidate whose own `check_timing`
    unconstrained-endpoint count went UP versus the Campaign baseline as a missing
    required check -- CLI-level wiring for `atcs_cli._baseline_unconstrained_counts`
    + `verification.assemble`'s own coverage rule."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_candidate_scenario_with_more_unconstrained_endpoints_than_baseline_is_missing(self):
        workspace = self.workspace
        manifest = _make_baseline_manifest(workspace)
        _write_json(workspace / "manifest.json", manifest)
        self.assertEqual(_run("baseline", workspace, workspace / "manifest.json").returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        # Baseline: every scenario reports zero unconstrained endpoints (_clean_reports's default).
        core.write_artifact(workspace / "state" / "observation.json", _baseline_observation(workspace, baseline))
        contract_dir = _analysis_contract_dir(workspace)
        self.assertEqual(_run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(_run_physical_baseline(workspace).returncode, 0)

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        _write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(baseline["id"], [contribution], [])
        plan_raw = {
            "batchId": "batch-U1", "baseStateId": baseline["id"], "select": [contribution["id"]],
            "resolutions": [], "deferred": [], "reason": "single fix",
        }
        plan = integration.validate_plan(plan_raw, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {
            "stepId": step["stepId"], "status": "ok",
            "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        }
        edit_domains = {contribution["id"]: work_package["editDomain"]}
        integration_state = integration.reconcile(request, [receipt], edit_domains)
        core.write_artifact(workspace / "state" / "composition-facts.json", facts)
        core.write_artifact(workspace / "state" / "replay-request.json", request)
        core.write_artifact(workspace / "state" / "integration-state.json", integration_state)

        merge_commit = integration.seal_batch(integration_state, request, facts, [contribution])
        merge_id = merge_commit["id"]
        impl_root = workspace / "implementations" / merge_id
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS" / "top.enc").write_bytes(f"database for {merge_id}".encode("utf-8"))
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(workspace)
        current_state_path = workspace / "current-state.json"
        _write_json(current_state_path, baseline)
        self.assertEqual(_run("implement", workspace, current_state_path, site_profile_path).returncode, 0)

        for corner in (CORNER,):
            _write_text(impl_root / "starrc" / corner / f"top.{corner}.spef", "*SPEF IEEE 1481-1999\n")
        corners_path = workspace / "corners.json"
        _write_json(corners_path, {"corners": {CORNER: str(STARRC_TEMPLATE_PATH)}})
        self.assertEqual(_run("extract", workspace, corners_path, site_profile_path).returncode, 0)

        # Candidate: every scenario is otherwise clean, EXCEPT the first required
        # scenario now reports 3 unconstrained endpoints -- a real regression
        # versus the baseline's own 0, even though every WNS/identity leg is fine.
        regressed_scenario = REQUIRED_SCENARIOS[0]
        for scenario in REQUIRED_SCENARIOS:
            reports = _clean_reports()
            if scenario == regressed_scenario:
                reports["check_timing.rpt"] = fixtures.check_timing_report(3)
            _write_report_set(impl_root / "sta" / scenario, reports)
        query_spec_path = workspace / "query-spec.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        scenario_corners_path = _scenarios_contract_path(workspace)
        base_design_state_path = workspace / "base-design-state.json"
        _write_json(base_design_state_path, baseline)
        self.assertEqual(
            _run("sta", workspace, query_spec_path, scenario_corners_path,
                 base_design_state_path, site_profile_path, "5000").returncode,
            0,
        )
        self.assertEqual(_run("physical", workspace, "candidate").returncode, 0)

        result = _run("evaluate", workspace, workspace / "state" / "policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evaluation = json.loads((workspace / "state" / "evaluation.json").read_text())
        # Everything else about this candidate is clean -- the ONLY reason it is
        # missing a required check is the unconstrained-endpoint regression.
        self.assertEqual(core.value_of(evaluation["finalIdentityErrorCount"]), 0)
        self.assertEqual(core.value_of(evaluation["missingRequiredCheckCount"]), 1)


# ---------------------------------------------------------------------------
# Issue #64 Task 6: `replay-prepare` replays Task 4b's ranked recipe as two concurrent
# XTop arms; `reconcile` chooses; `implement` sources the chosen ECO pair.
# ---------------------------------------------------------------------------

_RECIPE_PLAN = "c" * 64

_CONCURRENT_WRAPPER = """#!/bin/sh
# Each call registers itself, then waits (5 s at most) until both arms have started:
# run one after the other, the first call would time out and fail.
starts="$(dirname "$0")/starts"
mkdir -p "$starts"
: > "$starts/$$"
i=0
while [ $i -lt 100 ]; do
  [ "$(ls "$starts" | wc -l)" -ge 2 ] && exit 0
  sleep 0.05
  i=$((i + 1))
done
exit 9
"""

_CONTROL_FAILS_WRAPPER = """#!/bin/sh
case "$(pwd)" in */control) echo "ERROR: xtop crashed" ; exit 7 ;; esac
exit 0
"""


class RecipeReplayCliTest(unittest.TestCase):
    """The replay job, end to end through the CLI with a fake Site wrapper (no XTop)."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.base_state = core.stamp("design-state", {
            "top": "top", "stage": "postroute",
            "database": {"path": "db.enc", "sha256": "a" * 64, "datDigest": "b" * 64},
            "netlist": {"path": "netlist.v", "sha256": "c" * 64}, "def": None,
            "spef": {}, "sdc": [], "tools": {}, "scenarios": [], "parentId": None,
        })
        self.base_state_path = self.workspace / "base-state.json"
        _write_json(self.base_state_path, self.base_state)
        base_id = self.base_state["id"]
        _write_xtop_context(self.workspace, base_id, ("synthetic",))
        contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 2, "baseStateId": base_id, "kind": "xtop-session",
            "operations": [], "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            "admissible": True, "refusals": [], "session": {"lines": 1},
        })
        self.contribution = contribution
        _write_json(self.workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        _write_json(self.workspace / "state" / "workers.json", {"workers": {"w01": {
            "namePrefix": "atcs_w01_r2_",
            "workPackage": {"editDomain": {"instances": ["U1"], "nets": [], "regions": []}, "targetPins": []},
        }}, "requiredSlots": ["w01"]})
        recipe = {"sessions": [{"rank": 1, "contribution": contribution["id"], "taskId": "w01", "commands": [
            {"seq": 1, "proc": "atcs_size_cell", "cmd": "size_cell", "instances": ["U1"], "skip": None,
             "args": {"instance": "U1", "toMaster": "BUFX2", "planSha256": _RECIPE_PLAN}},
        ]}], "excluded": []}
        self.facts = core.stamp("composition-facts", {
            "baseStateId": base_id, "considered": [contribution["id"]], "duplicates": [], "conflicts": [],
            "interactions": [], "staleBase": [], "order": [contribution["id"]], "unresolvedCount": 0,
            "unknownResolutions": [], "recipe": recipe,
        })
        _write_json(self.workspace / "state" / "composition-facts.json", self.facts)
        self.plan_path = self.workspace / "integration-plan.json"
        _write_json(self.plan_path, {"plan": {"batchId": "gen-1", "baseStateId": base_id,
                                              "select": [contribution["id"]],
                                              "resolutions": [], "deferred": [], "reason": "ranked recipe"},
                                     "facts": self.facts})

    def _site(self, wrapper_text):
        wrapper = self.workspace / "wrapper.sh"
        wrapper.write_text(wrapper_text, encoding="utf-8")
        wrapper.chmod(0o755)
        path = self.workspace / "site-profile.json"
        _write_json(path, {
            "edaShell": [str(wrapper)], "design": "top",
            "techLef": str(self.workspace / "tech.lef"), "cellLefGlob": str(self.workspace / "cells" / "*.lef"),
            **_xtop_site_config(self.workspace, ("synthetic",)),
        })
        return path

    def _prepare(self, wrapper_text="#!/bin/sh\nexit 0\n", *extra):
        return _run("replay-prepare", self.workspace, self.base_state_path, self.plan_path,
                    self._site(wrapper_text), *extra)

    def test_both_arms_are_started_together_in_one_replay_job(self):
        result = self._prepare(_CONCURRENT_WRAPPER)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipts = json.loads((self.workspace / "state" / "replay-receipts.json").read_text())
        self.assertEqual(receipts["mode"], "recipe")
        self.assertEqual(set(receipts["arms"]), {"merged", "control"})
        for arm in ("merged", "control"):
            self.assertNotIn("toolFailure", receipts["arms"][arm], receipts)
            root = self.workspace / "integrations" / "gen-1" / arm
            for name in ("xtop-replay.tcl", "recipe.tcl", "auto-fix.tcl"):
                self.assertTrue((root / name).is_file(), f"{arm}/{name}")
        request = json.loads((self.workspace / "state" / "replay-request.json").read_text())
        self.assertEqual(request["mode"], "recipe")
        self.assertEqual(request["requiredScenarios"], ["synthetic"])
        self.assertEqual(request["sessions"][0]["namePrefix"], "atcs_w01_r2_")
        recipe_text = (self.workspace / "integrations" / "gen-1" / "merged" / "recipe.tcl").read_text()
        self.assertIn(f"atcs_size_cell {{U1}} {{BUFX2}} {{{_RECIPE_PLAN}}}", recipe_text)

    def test_a_failing_control_arm_is_recorded_and_never_fails_the_replay(self):
        result = self._prepare(_CONTROL_FAILS_WRAPPER)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipts = json.loads((self.workspace / "state" / "replay-receipts.json").read_text())
        self.assertIn("toolFailure", receipts["arms"]["control"])
        self.assertNotIn("toolFailure", receipts["arms"]["merged"])

    def test_the_auto_finish_knob_turns_off_only_the_merged_auto_finish(self):
        result = self._prepare("#!/bin/sh\nexit 0\n", "0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        root = self.workspace / "integrations" / "gen-1"
        self.assertEqual((root / "merged" / "auto-fix.tcl").read_text(), "")
        self.assertEqual(len((root / "control" / "auto-fix.tcl").read_text().splitlines()), 4)

    def test_a_reused_batch_id_is_refused(self):
        self.assertEqual(self._prepare().returncode, 0)
        result = self._prepare()
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "batch-id-reused")

    def _write_arm(self, arm, hold_worst, netlist="ecoChangeCell -inst U1 -cell BUFX2\n"):
        root = self.workspace / "integrations" / "gen-1" / arm
        (root / "dumps").mkdir(parents=True, exist_ok=True)
        (root / "dumps" / "000.dump").write_text("U1 BUFX1\nUOUT BUFX1\n", encoding="utf-8")
        after = "U1 BUFX2\nUOUT BUFX1\n" if arm == "merged" else "U1 BUFX1\nUOUT BUFX1\n"
        if arm == "merged":
            (root / "dumps" / "001.dump").write_text(after, encoding="utf-8")
        (root / "dumps" / "auto.dump").write_text(after.replace("UOUT BUFX1", "UOUT BUFX4"), encoding="utf-8")
        request = json.loads((self.workspace / "state" / "replay-request.json").read_text())
        if arm == "merged":
            (root / "receipts.jsonl").write_text(json.dumps({
                "stepId": request["steps"][0]["stepId"], "slot": "w01", "status": "applied", "attempted": True,
                "seq": 1}) + "\n", encoding="utf-8")
        (root / "predict").mkdir(exist_ok=True)
        for check, worst in (("setup", 0.0), ("hold", hold_worst)):
            (root / "predict" / f"{check}.rpt").write_text(
                f"### {check} summary ###\nScenario                  Count      Worst        TNS\n"
                f"{'-' * 54}\ntotal                         1    {worst:.4f}    {worst:.4f}\n"
                f"  synthetic                   1    {worst:.4f}    {worst:.4f}\n", encoding="utf-8")
        eco = root / ("eco" if arm == "merged" else "eco-control")
        eco.mkdir(exist_ok=True)
        (eco / "atcs_batch_netlist_top.txt").write_text(netlist, encoding="utf-8")
        (eco / "atcs_batch_physical_top.txt").write_text("placeInstance U1 1.0 2.0 R0\n", encoding="utf-8")
        (root / "arm-result.json").write_text(json.dumps({
            "arm": arm, "complete": True, "tainted": "", "protected": ["U1"] if arm == "merged" else [],
            "protectCode": 0, "protectResult": "", "autoFix": [], "predict": {"setup": 0, "hold": 0},
            "exportCode": 0, "exportResult": ""}), encoding="utf-8")
        return eco

    def test_reconcile_chooses_the_better_arm_and_implement_sources_its_pair(self):
        self.assertEqual(self._prepare().returncode, 0)
        self._write_arm("merged", -0.01)
        control_eco = self._write_arm("control", -0.03)
        result = _run("reconcile", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads((self.workspace / "state" / "integration-state.json").read_text())
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["chosen"]["eco"]["netlist"]["path"],
                         "integrations/gen-1/merged/eco/atcs_batch_netlist_top.txt")
        self.assertTrue(state["sessions"]["w01"]["deltaMatches"])
        self.assertTrue(control_eco.is_dir())

        request = json.loads((self.workspace / "state" / "replay-request.json").read_text())
        merge_commit = integration.seal_batch(state, request, self.facts, [self.contribution])
        impl_root = self.workspace / "implementations" / merge_commit["id"]
        (impl_root / "DBS").mkdir(parents=True)
        (impl_root / "DBS" / "top.enc").write_bytes(b"db")
        _sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        _write_text(impl_root / "EXPORT" / "design.def", "DEF\n")
        _write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))
        result = _run("implement", self.workspace, self.base_state_path, self._site("#!/bin/sh\nexit 0\n"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        sealed = json.loads((self.workspace / "state" / "merge-commit.json").read_text())
        self.assertEqual(sealed["id"], merge_commit["id"])
        self.assertEqual(sealed["choice"]["arm"], "merged")
        self.assertEqual((impl_root / "eco" / "netlist.tcl").read_text(), "ecoChangeCell -inst U1 -cell BUFX2\n")
        self.assertTrue((impl_root / "eco" / "physical.tcl").is_file())
        innovus = (impl_root / "innovus-eco.tcl").read_text()
        self.assertIn(f'set env(NETLIST_ECO) "{impl_root / "eco" / "netlist.tcl"}"', innovus)
        self.assertIn("source $env(NETLIST_ECO)\nsource $env(PHYSICAL_ECO)\nsetNanoRouteMode -routeWithEco true",
                      innovus)
        self.assertFalse((impl_root / "eco.tcl").exists())

    def test_implement_refuses_a_pair_that_changed_after_the_batch_was_sealed(self):
        self.assertEqual(self._prepare().returncode, 0)
        merged_eco = self._write_arm("merged", -0.01)
        self._write_arm("control", -0.03)
        self.assertEqual(_run("reconcile", self.workspace).returncode, 0)
        (merged_eco / "atcs_batch_netlist_top.txt").write_text("ecoChangeCell -inst U1 -cell BUFX8\n",
                                                               encoding="utf-8")
        result = _run("implement", self.workspace, self.base_state_path, self._site("#!/bin/sh\nexit 0\n"))
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "identity-mismatch")
        self.assertFalse((self.workspace / "state" / "merge-commit.json").exists())

    def test_reconcile_falls_back_to_control_when_the_merged_pair_is_unsafe(self):
        self.assertEqual(self._prepare().returncode, 0)
        self._write_arm("merged", 0.0, netlist="FORMATVERSION 2\n")
        self._write_arm("control", -0.03)
        result = _run("reconcile", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state = json.loads((self.workspace / "state" / "integration-state.json").read_text())
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("FORMATVERSION", state["chosen"]["reason"])

    def test_an_unexpected_error_in_one_arm_is_recorded_and_the_other_arm_still_runs(self):
        calls = []

        def fake_run_tool(site_profile, command, cwd, log_path, shell_env=None):
            calls.append(Path(cwd).name)
            if Path(cwd).name == "control":
                raise RuntimeError("wrapper vanished")
            return log_path

        site = self._site("#!/bin/sh\nexit 0\n")
        with mock.patch.object(atcs_cli.adapters, "run_tool", side_effect=fake_run_tool):
            code = atcs_cli.main(["replay-prepare", str(self.workspace), str(self.base_state_path),
                                  str(self.plan_path), str(site)])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(calls), ["control", "merged"])
        receipts = json.loads((self.workspace / "state" / "replay-receipts.json").read_text())
        self.assertNotIn("toolFailure", receipts["arms"]["merged"])
        self.assertIn("RuntimeError: wrapper vanished", receipts["arms"]["control"]["toolFailure"]["detail"])

    def test_reconcile_refuses_when_no_arm_left_an_eco_pair(self):
        self.assertEqual(self._prepare().returncode, 0)
        result = _run("reconcile", self.workspace)
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "missing-input")


if __name__ == "__main__":
    unittest.main()
