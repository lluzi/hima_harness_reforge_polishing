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
import shutil
import subprocess
import sys
import tempfile
import unittest
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
import fixtures  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
REQUIRED_SCENARIOS = ("func_ssg_rcworst_m40", "func_ssg_rcworst_125", "func_ffg_cbest_m40", "func_ffg_cbest_125")
CORNER = "corner1"


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


def _site_profile_path(root):
    wrapper = _no_op_wrapper(root)
    path = root / "site-profile.json"
    _write_json(path, {"edaShell": [str(wrapper)]})
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
    (workspace / "netlist.v").write_text("module top(); endmodule\n", encoding="utf-8")
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
    directory = root / "analysis-contract"
    policy = {
        "allowDegradedWorking": False, "degradeLimitNs": 0.0, "maxNewConstraintFailures": 0,
        "scenarioCorners": {scenario: CORNER for scenario in REQUIRED_SCENARIOS},
        "requiredScenarios": list(REQUIRED_SCENARIOS),
    }
    policy.update(policy_overrides)
    _write_json(directory / "policy.json", policy)
    return directory


def _sha256_matching_empty_directory(path):
    path.mkdir(parents=True, exist_ok=True)
    (path / "placeholder.txt").write_text("placeholder\n", encoding="utf-8")


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

    def _run_implement_round(self, base_state, instance):
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
        _write_json(corners_path, {"corners": [CORNER]})
        result = _run("extract", workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(impl_root / "sta" / scenario, _clean_reports())
        query_spec_path = workspace / f"query-spec-{instance}.json"
        _write_json(query_spec_path, {"precision": "gba", "requiredScenarios": list(REQUIRED_SCENARIOS), "maxPaths": 1000})
        sdc_path = workspace / f"sdc-{instance}.json"
        _write_json(sdc_path, {"sdc": ["constraints.sdc"]})
        scenario_corners_path = workspace / f"scenario-corners-{instance}.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        base_design_state_path = workspace / f"base-design-state-{instance}.json"
        _write_json(base_design_state_path, base_state)
        result = _run("sta", workspace, query_spec_path, sdc_path, scenario_corners_path,
                       base_design_state_path, site_profile_path)
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

        baseline_drc_path = workspace / "baseline-verify-drc.rpt"
        baseline_connectivity_path = workspace / "baseline-verify-connectivity.rpt"
        _write_text(baseline_drc_path, fixtures.drc_report([]))
        _write_text(baseline_connectivity_path, fixtures.connectivity_report([]))
        result = _run("physical", workspace, baseline_drc_path, baseline_connectivity_path, "baseline")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        # --- Round 1 ---
        round1_state_id = self._run_implement_round(baseline, instance="U1")
        working_state_after_round1 = json.loads((workspace / "state" / "working-state.json").read_text())
        self.assertEqual(working_state_after_round1["id"], round1_state_id)
        self.assertNotEqual(round1_state_id, baseline["id"])

        # --- Round 2: compose-facts and prepare-workers must use the ADOPTED state's id ---
        resolutions_path = workspace / "resolutions.json"
        _write_json(resolutions_path, {"resolutions": []})
        result = _run("compose-facts", workspace, resolutions_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts_round2 = json.loads((workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(facts_round2["baseStateId"], round1_state_id)
        self.assertNotEqual(facts_round2["baseStateId"], baseline["id"])

        eda_profile_path = workspace / "eda-profile.json"
        _write_json(eda_profile_path, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef"})
        site_caps_path = workspace / "site-caps.json"
        _write_json(site_caps_path, {"pgVerification": False})
        wp_paths = []
        for task_id in workspaces.TASK_IDS:
            wp_path = workspace / f"wp-round2-{task_id}.json"
            _write_json(wp_path, {
                "taskId": task_id, "baseStateId": round1_state_id, "problem": "round 2",
                "targets": [], "editDomain": {"instances": [], "nets": [], "regions": []},
                "protected": {"instances": [], "nets": []}, "mayAffect": [],
                "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
            })
            wp_paths.append(wp_path)
        working_state_path = workspace / "state" / "working-state.json"
        result = _run("prepare-workers", workspace, working_state_path, site_caps_path,
                       eda_profile_path, *wp_paths)
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


class AprPrepareRunTest(unittest.TestCase):
    """G24: `apr-prepare` refuses under post-route-only scope; `apr-run` actually
    executes the prepared stage task and writes an `implement`-shaped candidate
    `extract` accepts."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        self.manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", self.manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())

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

    def test_apr_prepare_refuses_under_post_route_only(self):
        readiness = _post_route_only_readiness(self.manifest)
        self.assertEqual(readiness["scope"], "post-route-only")
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()

        result = _run("apr-prepare", self.workspace, "place")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "lifecycle-unavailable")
        self.assertFalse((self.workspace / "apr" / "place" / "task.json").exists())

    def test_apr_run_writes_an_implement_shaped_candidate_extract_accepts(self):
        readiness = _full_flow_readiness(self.workspace, self.manifest)
        self.assertEqual(readiness["scope"], "full-flow")
        core.write_artifact(self.workspace / "state" / "readiness.json", readiness)
        self._write_residual_cases()

        stage = "place"
        result = _run("apr-prepare", self.workspace, stage)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        task = json.loads((self.workspace / "apr" / stage / "task.json").read_text())
        self.assertIn("taskId", task)

        output_root = self.workspace / "apr" / stage / task["taskId"]
        (output_root / "DBS").mkdir(parents=True, exist_ok=True)
        (output_root / "DBS" / f"{stage}.enc").write_bytes(b"apr stage database bytes")
        _sha256_matching_empty_directory(output_root / "DBS" / f"{stage}.enc.dat")
        _write_text(output_root / "EXPORT" / "design.def", "DEF placeholder\n")
        _write_text(output_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        _write_text(output_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        _write_text(output_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = _site_profile_path(self.workspace)
        result = _run("apr-run", self.workspace, stage, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        implement = json.loads((self.workspace / "state" / "implement.json").read_text())
        self.assertEqual(implement["mergeCommitId"], task["taskId"])
        self.assertEqual(implement["parentStateId"], self.working_state["id"])
        self.assertEqual(implement["design"], self.working_state["top"])
        self.assertIn("sha256", implement["drcReport"])

        corners_path = self.workspace / "corners.json"
        _write_json(corners_path, {"corners": [CORNER]})
        extract_output_root = self.workspace / "implementations" / implement["mergeCommitId"]
        _write_text(extract_output_root / "starrc" / CORNER / f"{self.working_state['top']}.{CORNER}.spef",
                     "*SPEF IEEE 1481-1999\n")
        result = _run("extract", self.workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


class RecordExperienceComposedTest(unittest.TestCase):
    """G5: `record-experience` composes lineage/decision/outcome from state files --
    predicted/measured come from the evaluation and contributions, never from a
    `research/requests/experience-*` file."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())

        _write_json(self.workspace / "state" / "implement.json", {
            "mergeCommitId": "merge-1", "design": "top", "parentStateId": self.working_state["id"],
        })
        contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 1, "baseStateId": self.working_state["id"], "kind": "fix",
            "operations": [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}],
            "script": None, "beforeDumpSha256": "0" * 64,
            "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            "touches": {"instances": ["U1"], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {"xtopSetupWns": core.known(0.02), "xtopHoldWns": core.known(0.05)},
            "validationLevel": "xtop", "diagnosis": None, "admissible": True, "refusals": [], "outOfScope": [],
        })
        _write_json(self.workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        evaluation = core.stamp("evaluation", {
            "candidateId": "merge-1", "parentStateId": self.working_state["id"], "stateId": "candidate-state-1",
            "finalSetupWns": core.known(0.07), "finalHoldWns": core.known(0.04),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(0), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(1), "missingPriorCheckCount": core.known(0),
            "comparison": {"fixed": [], "remaining": [], "entrant": [], "regressed": [], "missingPrior": []},
            "physical": {"drc": {"total": core.known(0)}, "connectivity": {"total": core.known(0)}},
        })
        _write_json(self.workspace / "state" / "evaluation.json", evaluation)

    def test_composes_predicted_and_measured_from_state_without_a_research_requests_file(self):
        reason_path = self.workspace / "next-decision.json"
        _write_json(reason_path, {"reason": "candidate closed the remaining setup violation on U1"})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        experience = json.loads((self.workspace / "state" / "experience.json").read_text())
        entry = experience["entries"][-1]
        self.assertEqual(entry["hypothesis"], "candidate closed the remaining setup violation on U1")
        self.assertEqual(entry["action"], "merge-1")
        # predicted: best known xtop prediction among admissible fix contributions (min(0.02, 0.05))
        self.assertEqual(core.value_of(entry["predicted"]), 0.02)
        # measured: evaluation's own min(finalSetupWns, finalHoldWns)
        self.assertEqual(core.value_of(entry["measured"]), 0.04)
        # No `research/requests/experience-*` file was ever read or created (G5).
        self.assertFalse((self.workspace / "research").exists())


if __name__ == "__main__":
    unittest.main()
