"""The timing-only analysis contract (#64 treatment attempt 3, user decision 2026-09-29).

The ATCS comparison is judged on timing only: DRC/connectivity deltas are recorded but must not
stop the treatment Run. `inputs/analysisContract-timing-only/` is the Site's analysis contract with
only the static acceptance terms of `policy.json` changed (allowDegradedWorking true,
maxNewConstraintFailures 1000000, degradeLimitNs still 0.0). No Pack byte changes: the Pack's own
policy tool, evaluate, adopt, Reader and graph are driven as they ship. No EDA, no SSH.

    python3 sites/linglong-atcs28/test_timing_only_contract.py -v
"""
import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent
REPO = SITE.parents[1]
PACK = REPO / "packs/agentic-timing-closure-system"
FLOW = PACK / "flow"
TESTS = FLOW / "tests"
sys.path.insert(0, str(FLOW))
sys.path.insert(0, str(TESTS))

import yaml  # noqa: E402

from atcs import composition, core, integration  # noqa: E402
import fixtures  # noqa: E402
import test_cli_state as base  # noqa: E402  (the Pack's own CLI-state helpers, read only)

ORIGINAL = SITE / "inputs/analysisContract"
VARIANT = SITE / "inputs/analysisContract-timing-only"
STATIC_TERMS = ("allowDegradedWorking", "degradeLimitNs", "maxNewConstraintFailures")
READER = PACK / "tools/read-atcs.py"


def _static_terms(contract_dir):
    policy = json.loads((contract_dir / "policy.json").read_text())
    return {key: policy[key] for key in STATIC_TERMS}


class VariantShapeTest(unittest.TestCase):
    """The variant is the Site contract with only the physical-constraint acceptance terms relaxed."""

    def test_every_file_but_policy_is_byte_identical(self):
        names = sorted(p.name for p in ORIGINAL.iterdir())
        self.assertEqual(sorted(p.name for p in VARIANT.iterdir()), names)
        for name in names:
            if name != "policy.json":
                self.assertEqual((VARIANT / name).read_bytes(), (ORIGINAL / name).read_bytes(), name)

    def test_policy_changes_only_the_constraint_terms_and_keeps_the_timing_limit(self):
        original = json.loads((ORIGINAL / "policy.json").read_text())
        variant = json.loads((VARIANT / "policy.json").read_text())
        self.assertEqual(sorted(variant), sorted(original))
        changed = sorted(key for key in original if original[key] != variant[key])
        self.assertEqual(changed, ["allowDegradedWorking", "maxNewConstraintFailures"])
        self.assertIs(variant["allowDegradedWorking"], True)
        self.assertEqual(variant["maxNewConstraintFailures"], 1000000)
        # The WNS bound stays exactly as tight: no candidate may regress timing.
        self.assertEqual(variant["degradeLimitNs"], 0.0)


class PolicyToolAdmitsVariantTest(unittest.TestCase):
    """The Pack's own `policy` tool reads the real variant directory (real scenarios.json)."""

    def setUp(self):
        self.workspace = base._tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest_path = self.workspace / "manifest.json"
        base._write_json(manifest_path, base._make_baseline_manifest(self.workspace))
        self.assertEqual(base._run("baseline", self.workspace, manifest_path).returncode, 0)
        baseline = json.loads((self.workspace / "state/baseline.json").read_text())
        core.write_artifact(self.workspace / "state/observation.json",
                            base._baseline_observation(self.workspace, baseline))

    def _policy(self, contract_dir):
        result = base._run("policy", self.workspace, contract_dir, "0", "0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads((self.workspace / "state/policy.json").read_text())

    def test_variant_is_admitted_with_its_relaxed_terms_and_the_goal_unchanged(self):
        policy = self._policy(VARIANT)
        self.assertIs(policy["allowDegradedWorking"], True)
        self.assertEqual(policy["maxNewConstraintFailures"], 1000000)
        self.assertEqual(policy["degradeLimitNs"], 0.0)
        self.assertEqual(policy["goal"], {"setup": 0.0, "hold": 0.0})
        self.assertEqual(sorted(policy["requiredScenarios"]), sorted(base.REQUIRED_SCENARIOS))
        self.assertEqual(policy["scenarioCorners"], json.loads((VARIANT / "policy.json").read_text())["scenarioCorners"])

    def test_the_original_contract_still_stamps_the_physical_gate(self):
        policy = self._policy(ORIGINAL)
        self.assertIs(policy["allowDegradedWorking"], False)
        self.assertEqual(policy["maxNewConstraintFailures"], 0)


class ConnectivityDeltaTest(base.TwoRoundFlowTest):
    """A refreshed candidate with new connectivity identities, driven through the Pack's real CLI
    stages (implement/extract/sta/physical/evaluate/adopt against the no-op wrapper), then the
    evaluation Reader and the constraint Judge's rule, then the graph edge the verdict takes."""

    def test_two_round_flow_uses_adopted_state_id(self):
        self.skipTest("inherited from the Pack's TwoRoundFlowTest; covered there")

    NEW_NETS = ["n_eco_a", "n_eco_b", "n_eco_c"]
    BASELINE_NETS = ["n_old_1", "n_old_2"]

    def _drive(self, static_terms, setup_wns=0.06, hold_wns=0.04, candidate_nets=None):
        workspace = self.workspace
        manifest_path = workspace / "manifest.json"
        base._write_json(manifest_path, base._make_baseline_manifest(workspace))
        self.assertEqual(base._run("baseline", workspace, manifest_path).returncode, 0)
        baseline = json.loads((workspace / "state/baseline.json").read_text())
        core.write_artifact(workspace / "state/observation.json", base._baseline_observation(workspace, baseline))
        # The Site contract's own static terms over the fixture's scenarios.json (its corner is the fixture's).
        contract_dir = base._analysis_contract_dir(workspace, **static_terms)
        result = base._run("policy", workspace, contract_dir, "0", "0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        baseline_connectivity = fixtures.connectivity_report(self.BASELINE_NETS)
        self.assertEqual(base._run_physical_baseline(workspace, connectivity_text=baseline_connectivity).returncode, 0)

        contribution, work_package = self._build_fix_contribution(baseline, instance="U1")
        base._write_json(workspace / "state/contributions-collected.json", {"contributions": [contribution]})
        facts = composition.analyze(baseline["id"], [contribution], [])
        plan = integration.validate_plan({
            "batchId": "batch-U1", "baseStateId": baseline["id"], "select": [contribution["id"]],
            "resolutions": [], "deferred": [], "reason": "single fix",
        }, facts)
        request = integration.prepare_replay(plan, facts, [contribution])
        step = request["steps"][0]
        receipt = {"stepId": step["stepId"], "status": "ok",
                   "observedDelta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}}}
        integration_state = integration.reconcile(request, [receipt], {contribution["id"]: work_package["editDomain"]})
        core.write_artifact(workspace / "state/composition-facts.json", facts)
        core.write_artifact(workspace / "state/replay-request.json", request)
        core.write_artifact(workspace / "state/integration-state.json", integration_state)
        merge_id = integration.seal_batch(integration_state, request, facts, [contribution])["id"]

        impl_root = workspace / "implementations" / merge_id
        (impl_root / "DBS").mkdir(parents=True, exist_ok=True)
        (impl_root / "DBS/top.enc").write_bytes(f"database for {merge_id}".encode("utf-8"))
        base._sha256_matching_empty_directory(impl_root / "DBS/top.enc.dat")
        base._write_text(impl_root / "EXPORT/design.def", "DEF placeholder\n")
        base._write_text(impl_root / "EXPORT/design.v", "module top(); endmodule\n")
        base._write_text(impl_root / "RPT/verify_drc.rpt", fixtures.drc_report([]))
        nets = self.BASELINE_NETS + (self.NEW_NETS if candidate_nets is None else candidate_nets)
        base._write_text(impl_root / "RPT/verify_connectivity.rpt", fixtures.connectivity_report(nets))

        site_profile = base._site_profile_path(workspace)
        current_state = workspace / "current-state.json"
        base._write_json(current_state, baseline)
        self.assertEqual(base._run("implement", workspace, current_state, site_profile).returncode, 0)
        base._write_text(impl_root / "starrc" / base.CORNER / f"top.{base.CORNER}.spef", "*SPEF IEEE 1481-1999\n")
        corners = workspace / "corners.json"
        base._write_json(corners, {"corners": {base.CORNER: str(base.STARRC_TEMPLATE_PATH)}})
        self.assertEqual(base._run("extract", workspace, corners, site_profile).returncode, 0)
        for scenario in base.REQUIRED_SCENARIOS:
            base._write_report_set(impl_root / "sta" / scenario, base._clean_reports(setup_wns, hold_wns))
        query_spec = workspace / "query-spec.json"
        base._write_json(query_spec, {"precision": "gba", "requiredScenarios": list(base.REQUIRED_SCENARIOS), "maxPaths": 1000})
        base_state = workspace / "base-design-state.json"
        base._write_json(base_state, baseline)
        result = base._run("sta", workspace, query_spec, base._scenarios_contract_path(workspace), base_state, site_profile, "5000")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(base._run("physical", workspace, "candidate").returncode, 0)
        result = base._run("evaluate", workspace, workspace / "state/policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evaluation = json.loads((workspace / "state/evaluation.json").read_text())
        result = base._run("adopt", workspace, workspace / "state/policy.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        envelope = json.loads((workspace / "accepted/latest.json").read_text())
        record = json.loads((workspace / envelope["acceptanceRecord"]).read_text())
        working = json.loads((workspace / "state/working-state.json").read_text())
        return baseline, evaluation, record, working

    def _read_values(self):
        out = self.workspace / "evaluation-values.json"
        # The Reader imports `atcs` from the deployed `<workspace>/flow`, as a Run's workspace has it.
        if not (self.workspace / "flow").exists():
            (self.workspace / "flow").symlink_to(FLOW, target_is_directory=True)
        result = subprocess.run([sys.executable, str(READER), "evaluation", str(self.workspace / "state/evaluation.json"),
                                 str(out), str(self.workspace)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return {entry["type"]: entry for entry in json.loads(out.read_text())["values"]}

    def _judge(self, rule_id, values):
        rule = yaml.safe_load((PACK / "rules" / f"{rule_id}.yml").read_text())
        value = values[rule["subject"]["type"]]
        self.assertEqual(rule["predicate"]["op"], "eq")
        return "PASS" if value["value"] == rule["predicate"]["threshold"] else "FAIL"

    def test_a_connectivity_delta_moves_working_under_the_timing_only_terms(self):
        baseline, evaluation, record, working = self._drive(_static_terms(VARIANT))
        # The delta is measured and recorded, never hidden.
        self.assertEqual(core.value_of(evaluation["constraintFailureCount"]), len(self.NEW_NETS))
        self.assertEqual(core.value_of(evaluation["constraintUnknownCount"]), 0)
        self.assertEqual(core.value_of(evaluation["physical"]["connectivity"]["newIdentityCount"]), len(self.NEW_NETS))
        values = self._read_values()
        self.assertEqual(values["tc_applicable_constraint_failure_count"]["value"], len(self.NEW_NETS))
        self.assertEqual(self._judge("required-constraints-pass-failures", values), "FAIL")
        self.assertEqual(self._judge("required-constraints-pass-unknowns", values), "PASS")
        # The candidate is adopted as the working state: the next generation builds on it.
        self.assertEqual(record["decision"], "working-only", record)
        self.assertIn("constraint-failures-degraded-working", record["reason"])
        self.assertEqual(working["id"], evaluation["stateId"])
        self.assertNotEqual(working["id"], baseline["id"])
        pointers = json.loads((self.workspace / "state/pointers.json").read_text())
        self.assertEqual(pointers["working"]["stateId"], evaluation["stateId"])
        # best/delivery stay physically gated by the Pack (not a Site term).
        self.assertIsNone(pointers["best"])
        self.assertIsNone(pointers["delivery"])

    def test_the_same_candidate_is_refused_under_the_original_terms(self):
        baseline, evaluation, record, working = self._drive(_static_terms(ORIGINAL))
        self.assertEqual(core.value_of(evaluation["constraintFailureCount"]), len(self.NEW_NETS))
        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "constraint-failures-exceed-cap")
        self.assertEqual(working["id"], baseline["id"])

    def test_a_timing_regression_is_still_refused_under_the_timing_only_terms(self):
        # Baseline min WNS is 0.03 ns (the fixture's clean hold); this candidate's hold is 0.01 ns.
        baseline, evaluation, record, working = self._drive(_static_terms(VARIANT), setup_wns=0.06, hold_wns=0.01)
        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "degrade-limit-exceeded")
        self.assertEqual(working["id"], baseline["id"])

    def test_a_timing_regression_without_a_physical_delta_is_refused_too(self):
        baseline, evaluation, record, working = self._drive(_static_terms(VARIANT), setup_wns=0.06, hold_wns=0.01,
                                                             candidate_nets=[])
        self.assertEqual(core.value_of(evaluation["constraintFailureCount"]), 0)
        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "degrade-limit-exceeded")

    def test_a_clean_timing_gain_still_wins_best(self):
        baseline, evaluation, record, working = self._drive(_static_terms(VARIANT), candidate_nets=[])
        self.assertIn(record["decision"], ("best", "delivery"), record)
        pointers = json.loads((self.workspace / "state/pointers.json").read_text())
        self.assertEqual(pointers["best"]["stateId"], evaluation["stateId"])


class GraphRouteTest(unittest.TestCase):
    """Where a physical-constraint verdict goes in the Pack's graph: never to the wait node."""

    @classmethod
    def setUpClass(cls):
        graph = yaml.safe_load((PACK / "graph.yml").read_text())
        cls.nodes = {node["id"]: node for node in graph["nodes"]}
        cls.edges = graph["edges"]

    def _to(self, source, outcome=None):
        return sorted(e["to"] for e in self.edges if e["from"] == source and (outcome is None or e.get("outcome") == outcome))

    def test_a_constraint_failure_goes_to_adopt_and_adopt_goes_on_to_residual(self):
        self.assertEqual(self._to("check-constraint-failures", "FAIL"), ["adopt"])
        self.assertEqual(self._to("adopt"), ["read-acceptance"])
        self.assertEqual(self._to("read-acceptance"), ["check-artifact-ready"])
        self.assertEqual(self._to("check-artifact-ready"), ["residual", "residual"])

    def test_no_constraint_judge_routes_to_the_wait_node(self):
        judges = [node_id for node_id, node in self.nodes.items() if node.get("kind") == "judge"
                  and any(rule.startswith("required-constraints-pass") for rule in node["parameters"]["rules"])]
        self.assertIn("check-constraint-failures", judges)
        for judge in judges:
            self.assertNotIn("wait-for-person", self._to(judge), judge)

    def test_the_timing_goal_judges_still_bind_the_goal(self):
        for node_id, rule in (("check-setup-goal", "setup-goal"), ("check-hold-goal", "hold-goal")):
            params = self.nodes[node_id]["parameters"]
            self.assertEqual(params["rules"], [rule])
            self.assertEqual(next(iter(params["bind"].values()))["from"], "goal")


if __name__ == "__main__":
    unittest.main()
