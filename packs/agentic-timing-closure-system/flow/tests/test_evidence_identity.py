"""Regression tests for the final whole-branch review's Critical evidence-identity
findings (batch A): a -0.00 WNS passing the Goal (C1), a stale re-implement
overwriting an adopted database (C2), design-state files resolved under the wrong
root (C3), and comparisons against the wrong generation (C5).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_evidence_identity.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

C1's own parser/observation-contract regression tests live in `test_core.py`
(`ParseGlobalTimingTest`) and `test_observation_contract.py`
(`CaptureWnsIdentityCrossCheckTest`) alongside the rest of `atcs.reports`/
`atcs.state`'s existing coverage; this module holds the CLI-subprocess-level
regressions converted from the reviewer's own probe scripts
(`probe_reimplement.py` -> C2, plus new C3/C5 CLI-level cases), which do not
fit naturally into any single existing per-module test file.
"""
from __future__ import annotations

import json
import shutil
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

import atcs_cli  # noqa: E402
from atcs import core  # noqa: E402

import fixtures  # noqa: E402
import test_cli_state as cli  # noqa: E402 -- reuses its rich CLI-subprocess fixtures/helpers


class ReimplementRefusesStaleBaseTest(cli.TwoRoundFlowTest):
    """C2 (final review), converted from the controller's own `probe_reimplement.py`:
    once a candidate is adopted, `state/working-state.json` moves to it -- but
    `state/integration-state.json`/`composition-facts.json`/`replay-request.json`
    (what `implement` reseals its merge commit from) are only refreshed by a fresh
    compose/replay round. Calling `implement` again with no such round in between
    used to resurrect the EXACT SAME already-adopted merge commit (a pure function of
    those unchanged inputs) and silently re-run the ECO into the very
    `implementations/<id>/` directory the campaign had already adopted evidence from.
    """

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from cli.TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_reimplementing_the_same_stale_batch_after_adopt_is_refused(self):
        workspace = self.workspace
        manifest = cli._make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        cli._write_json(manifest_path, manifest)
        self.assertEqual(cli._run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        core.write_artifact(workspace / "state" / "observation.json", cli._baseline_observation(workspace, baseline))
        contract_dir = cli._analysis_contract_dir(workspace)
        self.assertEqual(cli._run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(cli._run_physical_baseline(workspace).returncode, 0)

        # Round 1: implement, evaluate and adopt a real, single-op fix -- this
        # moves `state/working-state.json` to the adopted candidate's own id.
        self._run_implement_round(baseline, instance="U1")
        working_after_round1 = json.loads((workspace / "state" / "working-state.json").read_text())
        pointers = json.loads((workspace / "state" / "pointers.json").read_text())
        self.assertEqual(pointers["working"]["stateId"], working_after_round1["id"])
        self.assertNotEqual(working_after_round1["id"], baseline["id"])

        # The model now (incorrectly) decides "implement" again, WITHOUT ever
        # recomposing/replaying a fresh batch against the now-current working
        # state -- `state/integration-state.json`/`composition-facts.json`/
        # `replay-request.json` still all describe the ORIGINAL batch, whose
        # own `baseStateId`/`parentStateId` is the baseline, not the adopted
        # state. Before C2's fix, this resealed the exact same merge commit
        # (same id, same parentStateId) and silently re-ran the ECO into the
        # already-adopted `implementations/<id>/` directory.
        site_profile_path = cli._site_profile_path(workspace)
        result = cli._run("implement", workspace, workspace / "state" / "working-state.json", site_profile_path)

        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "stale-base")
        # The already-adopted implementation output must be untouched: no
        # new/rewritten declared `state/implement.json` from this refused call.
        implement_before = json.loads((workspace / "state" / "implement.json").read_text())
        self.assertEqual(implement_before["parentStateId"], baseline["id"])


class ImplementIsWriteOnceTest(cli.TwoRoundFlowTest):
    """C2 (final review): `implementations/<mergeId>/` is write-once -- even a SECOND
    `implement` call whose merge commit legitimately still matches the current
    working state (a plain retry, not a stale-base situation) must never re-run the
    ECO into a directory a prior call already completed."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from cli.TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_a_second_implement_call_for_the_same_merge_commit_is_refused(self):
        workspace = self.workspace
        manifest = cli._make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        cli._write_json(manifest_path, manifest)
        self.assertEqual(cli._run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        cli._write_json(workspace / "state" / "contributions-collected.json", {"contributions": [contribution]})
        from atcs import composition, integration
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
        cli._sha256_matching_empty_directory(impl_root / "DBS" / "top.enc.dat")
        cli._write_text(impl_root / "EXPORT" / "design.def", "DEF placeholder\n")
        cli._write_text(impl_root / "EXPORT" / "design.v", "module top(); endmodule\n")
        cli._write_text(impl_root / "RPT" / "verify_drc.rpt", fixtures.drc_report([]))
        cli._write_text(impl_root / "RPT" / "verify_connectivity.rpt", fixtures.connectivity_report([]))

        site_profile_path = cli._site_profile_path(workspace)
        current_state_path = workspace / "current-state.json"
        cli._write_json(current_state_path, baseline)

        first = cli._run("implement", workspace, current_state_path, site_profile_path)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)

        # A second call, over the SAME unchanged reconciled batch (same merge
        # commit id, same parentStateId -- not a stale-base situation at all).
        second = cli._run("implement", workspace, current_state_path, site_profile_path)
        self.assertEqual(second.returncode, 3, second.stdout + second.stderr)
        payload = json.loads(second.stderr)
        self.assertEqual(payload["code"], "write-once")


class BaselineExternalRootTest(unittest.TestCase):
    """C3 (final review): `baseline`'s manifest may name an EXTERNAL root (a
    Site-supplied staging directory the Campaign workspace never otherwise sees) --
    every later subcommand must still resolve the resulting design-state's own
    recorded paths as `workspace / ref["path"]`. Drives baseline -> observe with a
    fake PT wrapper, exactly as the final-fix brief specifies."""

    def setUp(self):
        self.workspace = cli._tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        # A source directory that is NOT the campaign workspace at all.
        self.external_root = cli._tmp()
        self.addCleanup(shutil.rmtree, self.external_root, ignore_errors=True)

    def _make_external_manifest(self):
        root = self.external_root
        (root / "DBS").mkdir(parents=True, exist_ok=True)
        (root / "DBS" / "top.enc").write_bytes(b"encrypted-database-bytes")
        dat_dir = root / "DBS" / "top.enc.dat"
        dat_dir.mkdir(parents=True, exist_ok=True)
        (dat_dir / "manifest.txt").write_text("dat contents\n", encoding="utf-8")
        (root / "EXPORT").mkdir(parents=True, exist_ok=True)
        (root / "EXPORT" / "top.v").write_text("module top(); endmodule\n", encoding="utf-8")
        (root / "EXPORT" / "top.sdc").write_text("create_clock -period 1.0 clk\n", encoding="utf-8")
        (root / "SPEF").mkdir(parents=True, exist_ok=True)
        (root / "SPEF" / f"{cli.CORNER}.spef").write_text("*SPEF IEEE 1481-1999\n", encoding="utf-8")
        return {
            "top": "top", "stage": "postroute", "root": str(root),
            "database": {"enc": "DBS/top.enc", "encDat": "DBS/top.enc.dat"},
            "netlist": "EXPORT/top.v",
            "spef": {cli.CORNER: f"SPEF/{cli.CORNER}.spef"},
            "sdc": ["EXPORT/top.sdc"],
            "scenarios": [{"name": name, "corner": cli.CORNER} for name in cli.REQUIRED_SCENARIOS],
        }

    def test_baseline_stages_external_files_and_observe_resolves_them_from_the_workspace(self):
        manifest = self._make_external_manifest()
        manifest_path = self.workspace / "manifest.json"
        cli._write_json(manifest_path, manifest)

        result = cli._run("baseline", self.workspace, manifest_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

        working_state = json.loads((self.workspace / "state" / "working-state.json").read_text())
        # Every recorded path must be workspace-relative -- never naming (or
        # requiring) the external root at all.
        for path in (
            working_state["database"]["path"], working_state["netlist"]["path"],
            working_state["spef"][cli.CORNER]["path"], working_state["sdc"][0]["path"],
        ):
            self.assertFalse(Path(path).is_absolute(), path)
            self.assertTrue((self.workspace / path).is_file(), path)
            self.assertNotIn(str(self.external_root), path)

        # observe must resolve every one of those staged copies correctly,
        # never the external originals (which a real Campaign worker would
        # never even have read access to again).
        query_spec_path = self.workspace / "query-spec.json"
        cli._write_json(query_spec_path, {
            "precision": "gba", "requiredScenarios": list(cli.REQUIRED_SCENARIOS), "maxPaths": 1000,
        })
        scenario_corners_path = cli._scenarios_contract_path(self.workspace)
        site_profile_path = cli._site_profile_path(self.workspace)
        for scenario in cli.REQUIRED_SCENARIOS:
            cli._write_report_set(self.workspace / "research" / "observe" / "g1" / scenario, cli._clean_reports())

        result = cli._run(
            "observe", self.workspace, query_spec_path, site_profile_path, scenario_corners_path, "1000",
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        observation = json.loads((self.workspace / "state" / "observation.json").read_text())
        self.assertEqual(observation["designStateId"], working_state["id"])
        self.assertTrue(observation["coverage"]["complete"], observation["coverage"]["reasons"])


class StaLabelsWithCandidateStateIdTest(cli.TwoRoundFlowTest):
    """C5 (final review): `sta` must label its own fresh observations with the
    CANDIDATE's own new design-state id, never the parent's -- converted from the
    controller's own investigation into wrong-generation comparisons."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from cli.TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_sta_observation_designstateid_is_the_candidates_own_not_the_parents(self):
        workspace = self.workspace
        manifest = cli._make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        cli._write_json(manifest_path, manifest)
        self.assertEqual(cli._run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        core.write_artifact(workspace / "state" / "observation.json", cli._baseline_observation(workspace, baseline))
        contract_dir = cli._analysis_contract_dir(workspace)
        self.assertEqual(cli._run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(cli._run_physical_baseline(workspace).returncode, 0)

        candidate_state_id = self._run_implement_round(baseline, instance="U1")
        sta = json.loads((workspace / "state" / "sta.json").read_text())

        self.assertEqual(sta["designStateId"], candidate_state_id)
        self.assertNotEqual(sta["designStateId"], baseline["id"])
        for scenario, entry in sta["sta"].items():
            self.assertEqual(
                entry["observation"]["designStateId"], candidate_state_id,
                f"{scenario} observation mislabeled with a different generation's state id",
            )
            self.assertNotEqual(entry["observation"]["designStateId"], baseline["id"])

        # C5: the exact receipts a candidate was evaluated against must also
        # be recoverable from its own immutable implementations/<id>/ archive.
        merge_id = json.loads((workspace / "state" / "implement.json").read_text())["mergeCommitId"]
        archived = json.loads((workspace / "implementations" / merge_id / "sta.json").read_text())
        self.assertEqual(archived, sta)


class EvaluateComparesAgainstTheCorrectGenerationTest(cli.TwoRoundFlowTest):
    """C5 (final review): `evaluate` must pick the prior observation whose own
    `designStateId` equals the merge commit's `parentStateId` -- never whatever
    `state/observation.json` currently holds, which (after a second implementation
    round with no fresh `observe` in between) may still be labeled with an earlier
    generation's state id."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from cli.TwoRoundFlowTest -- already covered there, not this class's own case")

    def test_missing_matching_prior_observation_makes_the_comparison_unknown(self):
        workspace = self.workspace
        manifest = cli._make_baseline_manifest(workspace)
        manifest_path = workspace / "manifest.json"
        cli._write_json(manifest_path, manifest)
        self.assertEqual(cli._run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state" / "baseline.json").read_text())
        core.write_artifact(workspace / "state" / "observation.json", cli._baseline_observation(workspace, baseline))
        contract_dir = cli._analysis_contract_dir(workspace)
        self.assertEqual(cli._run("policy", workspace, contract_dir, "0.0", "0.0").returncode, 0)
        self.assertEqual(cli._run_physical_baseline(workspace).returncode, 0)

        # Round 1: a prior observation DOES exist for the baseline (written
        # above) -- the comparison must be known.
        self._run_implement_round(baseline, instance="U1")
        evaluation_round1 = json.loads((workspace / "state" / "evaluation.json").read_text())
        self.assertTrue(core.is_known(evaluation_round1["fixedCheckCount"]))
        self.assertTrue(core.is_known(evaluation_round1["missingPriorCheckCount"]))

        # Round 2: the adopted state (round 1's own candidate) becomes the
        # new working state, but `state/observation.json` was never
        # refreshed by a fresh `observe` against it -- there is no
        # persisted observation anywhere whose own designStateId equals
        # round 2's parentStateId. The comparison must be unknown, never a
        # silent diff against the wrong (round-1-parent) generation.
        working_after_round1 = json.loads((workspace / "state" / "working-state.json").read_text())
        self._run_implement_round(working_after_round1, instance="U2")
        evaluation_round2 = json.loads((workspace / "state" / "evaluation.json").read_text())
        self.assertFalse(core.is_known(evaluation_round2["fixedCheckCount"]))
        self.assertFalse(core.is_known(evaluation_round2["missingPriorCheckCount"]))


class EvidenceGenerationWriteOnceTest(unittest.TestCase):
    """I12 (final review): `research/observe/`/`research/residual/`'s own raw PT
    evidence directories are per-generation write-once -- a second `observe` call in
    the same Campaign (a follow-up diagnostic query, or the next round) must never
    silently overwrite the first generation's own raw reports at a shared path."""

    def setUp(self):
        self.workspace = cli._tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def test_generation_dir_helper_never_reuses_a_number(self):
        parent = self.workspace / "research" / "observe"
        first = atcs_cli._next_evidence_generation_dir(parent)
        second = atcs_cli._next_evidence_generation_dir(parent)
        third = atcs_cli._next_evidence_generation_dir(parent)
        self.assertEqual([path.name for path in (first, second, third)], ["g1", "g2", "g3"])

    def test_two_observe_calls_each_get_their_own_write_once_generation(self):
        manifest = cli._make_baseline_manifest(self.workspace)
        cli._write_json(self.workspace / "manifest.json", manifest)
        self.assertEqual(cli._run("baseline", self.workspace, self.workspace / "manifest.json").returncode, 0)

        query_spec_path = self.workspace / "query-spec.json"
        cli._write_json(
            query_spec_path, {"precision": "gba", "requiredScenarios": list(cli.REQUIRED_SCENARIOS), "maxPaths": 1000},
        )
        scenario_corners_path = cli._scenarios_contract_path(self.workspace)
        site_profile_path = cli._site_profile_path(self.workspace)

        # First generation, at the exact deterministic path the dispatcher's own
        # counter-driven `_next_evidence_generation_dir` will name first (`g1`).
        for scenario in cli.REQUIRED_SCENARIOS:
            cli._write_report_set(self.workspace / "research" / "observe" / "g1" / scenario, cli._clean_reports())
        result1 = cli._run(
            "observe", self.workspace, query_spec_path, site_profile_path, scenario_corners_path, "1000",
        )
        self.assertEqual(result1.returncode, 0, result1.stdout + result1.stderr)

        # Second call, same working state, distinct (worse) reports -- names its
        # own `g2`, never reusing or overwriting `g1`.
        for scenario in cli.REQUIRED_SCENARIOS:
            cli._write_report_set(
                self.workspace / "research" / "observe" / "g2" / scenario, cli._clean_reports(setup_wns=-0.02),
            )
        result2 = cli._run(
            "observe", self.workspace, query_spec_path, site_profile_path, scenario_corners_path, "1000",
        )
        self.assertEqual(result2.returncode, 0, result2.stdout + result2.stderr)

        g1_report = self.workspace / "research" / "observe" / "g1" / cli.REQUIRED_SCENARIOS[0] / "global_timing.rpt"
        g2_report = self.workspace / "research" / "observe" / "g2" / cli.REQUIRED_SCENARIOS[0] / "global_timing.rpt"
        self.assertTrue(g1_report.is_file())
        self.assertTrue(g2_report.is_file())
        self.assertNotEqual(g1_report.read_text(), g2_report.read_text())
        # The second call's own observation reflects the SECOND generation's own
        # (worse) reports -- proof the dispatcher actually read `g2`, not `g1` again.
        observation = json.loads((self.workspace / "state" / "observation.json").read_text())
        self.assertAlmostEqual(
            core.value_of(observation["scenarios"][cli.REQUIRED_SCENARIOS[0]]["setup"]["wns"]), -0.02, places=6,
        )


if __name__ == "__main__":
    unittest.main()
