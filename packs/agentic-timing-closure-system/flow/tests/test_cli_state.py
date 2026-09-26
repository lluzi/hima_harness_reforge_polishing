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
import atcs_cli  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
NEXT_DECISION_REL_PATH = atcs_cli.NEXT_DECISION_REL_PATH
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
        # Fix round 2 item 2: SDC comes from base_design_state's own recorded sdc[0]
        # (sha256-verified), never a separate analysisContract/sdc.json copy.
        scenario_corners_path = workspace / f"scenario-corners-{instance}.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        base_design_state_path = workspace / f"base-design-state-{instance}.json"
        _write_json(base_design_state_path, base_state)
        result = _run("sta", workspace, query_spec_path, scenario_corners_path,
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
        # No integration plan has been admitted yet for round 2 -- Task 12c item 4c's
        # first pass: an absent plan path means resolutions=[] (never a separate
        # resolutions.json).
        plan_path = workspace / "integration-plan.json"
        result = _run("compose-facts", workspace, plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts_round2 = json.loads((workspace / "state" / "composition-facts.json").read_text())
        self.assertEqual(facts_round2["baseStateId"], round1_state_id)
        self.assertNotEqual(facts_round2["baseStateId"], baseline["id"])

        eda_profile_path = workspace / "eda-profile.json"
        _write_json(eda_profile_path, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef"})
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
        self.eda_profile_path = self.workspace / "eda-profile.json"
        _write_json(self.eda_profile_path, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef"})
        self.site_caps_path = self.workspace / "site-caps.json"
        _write_json(self.site_caps_path, {"pgVerification": False})

    def _work_packages(self, **w02_overrides):
        packages = {
            task_id: {
                "taskId": task_id, "baseStateId": self.working_state["id"], "problem": "p",
                "targets": [], "editDomain": {"instances": [], "nets": [], "regions": []},
                "protected": {"instances": [], "nets": []}, "mayAffect": [],
                "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
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

    def test_no_fix_contribution_without_a_diagnosis_is_inadmissible(self):
        manifest = self._seed_workers()
        root = self.workspace / manifest["root"]
        (root / "before.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "after.dump").write_text("U1 BUFX1\n", encoding="utf-8")
        (root / "ops.jsonl").write_text("", encoding="utf-8")
        # No summary.json at all -- no diagnosis.

        result = _run("capture-contribution", self.workspace, "w01")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = json.loads((self.workspace / "state" / "contribution-w01.json").read_text())
        self.assertEqual(contribution["kind"], "no-fix")
        self.assertFalse(contribution["admissible"])
        self.assertTrue(any(r["code"] == "no-diagnosis" for r in contribution["refusals"]))


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
        scenario_corners_path = self.workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        site_profile_path = _site_profile_path(self.workspace)
        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(self.workspace / "research" / "observe" / scenario, _clean_reports())
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
        scenario_corners_path = self.workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        site_profile_path = _site_profile_path(self.workspace)
        for scenario in REQUIRED_SCENARIOS:
            _write_report_set(self.workspace / "research" / "observe" / scenario, _clean_reports())
        return _run("observe", self.workspace, query_spec_path, site_profile_path, scenario_corners_path, "1000")

    def test_succeeds_using_the_working_states_own_recorded_files(self):
        result = self._run_observe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        observation = json.loads((self.workspace / "state" / "observation.json").read_text())
        working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())
        self.assertEqual(observation["designStateId"], working_state["id"])

    def test_refuses_when_the_working_states_spef_sha_changed(self):
        """A tampered/rotated SPEF file (never a model-supplied path) is caught by identity, not trusted."""
        (self.workspace / f"{CORNER}.spef").write_text("*SPEF IEEE 1481-1999 -- tampered\n", encoding="utf-8")
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
        pt_tcl = (self.workspace / "research" / "observe" / REQUIRED_SCENARIOS[0] / "pt-scenario.tcl").read_text()
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
  U_FF_1/CP (DFQD1BWP)
                              0.00       0.00 &     0.00 r
  U_FF_1/Q (DFQD1BWP)
                              0.02       0.08 &     0.08 f
  net1 (net)
                              4     1.50
  U_FF_2/D (DFQD1BWP)
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
        scenario_corners_path = self.workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        site_profile_path = _site_profile_path(self.workspace)

        # The fake wrapper never actually launches PT -- pre-write the report
        # at the exact deterministic path `_cmd_residual` will look for
        # (`compile_pt_query_task` names the sole target `q000`).
        report_path = self.workspace / "research" / "residual" / "func_ssg_rcworst_m40" / "q000.rpt"
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
        scenario_corners_path = self.workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
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

        scenario_corners_path = workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        site_profile_path = _site_profile_path(workspace)
        result = _run("residual", workspace, scenario_corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        pt_tcl = (workspace / "research" / "residual" / "func_ssg_rcworst_m40" / "pt-query.tcl").read_text()
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

        scenario_corners_path = workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        site_profile_path = _site_profile_path(workspace)
        result = _run("residual", workspace, scenario_corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        residual_doc = json.loads((workspace / "state" / "residual-cases.json").read_text())
        case = residual_doc["cases"][0]
        for measure in case["evidence"].values():
            self.assertFalse(core.is_known(measure))
        self.assertTrue(residual_doc["queryNotes"])
        self.assertFalse((workspace / "research" / "residual").exists())


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

        scenario_corners_path = workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
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
        baseline_drc_path = self.workspace / "baseline-verify-drc.rpt"
        baseline_connectivity_path = self.workspace / "baseline-verify-connectivity.rpt"
        _write_text(baseline_drc_path, fixtures.drc_report([]))
        _write_text(baseline_connectivity_path, fixtures.connectivity_report([]))
        result = _run("physical", self.workspace, baseline_drc_path, baseline_connectivity_path, "baseline")
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
        _write_json(corners_path, {"corners": [CORNER]})
        extract_output_root = self.workspace / "implementations" / implement["mergeCommitId"]
        _write_text(extract_output_root / "starrc" / CORNER / f"{self.working_state['top']}.{CORNER}.spef",
                     "*SPEF IEEE 1481-1999\n")
        result = _run("extract", self.workspace, corners_path, site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_apr_run_candidate_flows_through_sta_evaluate_adopt(self):
        """Item 6: an apr-run candidate, driven all the way through sta -> evaluate -> adopt."""
        implement, site_profile_path = self._prepare_and_run_apr("route")
        merge_id = implement["mergeCommitId"]

        corners_path = self.workspace / "corners.json"
        _write_json(corners_path, {"corners": [CORNER]})
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
        scenario_corners_path = self.workspace / "scenario-corners.json"
        _write_json(scenario_corners_path, {scenario: CORNER for scenario in REQUIRED_SCENARIOS})
        result = _run("sta", self.workspace, query_spec_path, scenario_corners_path,
                       self.workspace / "state" / "working-state.json", site_profile_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

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
                          parent_known=True, precision="gba"):
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
        })
        merge_id = merge_commit["id"]
        _write_json(self.workspace / "state" / "merge-commit.json", merge_commit)
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

    def test_measured_positive_delta_is_helped(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"reason": "candidate closed the remaining setup violation on U1"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertEqual(entry["hypothesis"], "candidate closed the remaining setup violation on U1")
        self.assertAlmostEqual(core.value_of(entry["measured"]), 0.04)  # 0.04 - 0.0
        self.assertAlmostEqual(core.value_of(entry["predicted"]), 0.02)  # min(0.02, 0.05) - 0.0
        self.assertEqual(entry["verdict"], "helped")

    def test_measured_negative_delta_is_hurt(self):
        reason_path = self._write_candidate(parent_min_wns=0.05, candidate_setup_wns=0.01, candidate_hold_wns=0.01)
        _write_json(reason_path, {"plan": {"reason": "candidate regressed relative to the parent"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertAlmostEqual(core.value_of(entry["measured"]), -0.04)  # 0.01 - 0.05
        self.assertEqual(entry["verdict"], "hurt")

    def test_measured_zero_delta_is_neutral(self):
        reason_path = self._write_candidate(parent_min_wns=0.04, candidate_setup_wns=0.04, candidate_hold_wns=0.09)
        _write_json(reason_path, {"plan": {"reason": "candidate matched the parent exactly"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertEqual(core.value_of(entry["measured"]), 0.0)
        self.assertEqual(entry["verdict"], "neutral")

    def test_unknown_parent_min_wns_makes_measured_and_predicted_unknown(self):
        reason_path = self._write_candidate(
            parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04, parent_known=False,
        )
        _write_json(reason_path, {"plan": {"reason": "no recorded parent min WNS for this state"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        entry = json.loads((self.workspace / "state" / "experience.json").read_text())["entries"][-1]
        self.assertNotIn("value", entry["measured"])
        self.assertIn("unknown", entry["measured"])
        self.assertNotIn("value", entry["predicted"])
        self.assertEqual(entry["verdict"], "unknown")

    def test_blank_reason_is_refused(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"reason": "   "}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertFalse((self.workspace / "state" / "experience.json").exists())

    def test_missing_reason_field_is_refused(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"question": "no reason field at all"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")

    def test_no_scenario_carrying_a_precision_is_refused(self):
        reason_path = self._write_candidate(
            parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04, precision=None,
        )
        _write_json(reason_path, {"plan": {"reason": "a real reason, but sta has no precision anywhere"}, "facts": {}})

        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertFalse((self.workspace / "state" / "experience.json").exists())

    def test_no_research_requests_experience_file_is_ever_read_or_written(self):
        reason_path = self._write_candidate(parent_min_wns=0.0, candidate_setup_wns=0.07, candidate_hold_wns=0.04)
        _write_json(reason_path, {"plan": {"reason": "candidate closed the remaining setup violation on U1"}, "facts": {}})
        result = _run("record-experience", self.workspace, reason_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.workspace / "research").exists())


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


if __name__ == "__main__":
    unittest.main()
