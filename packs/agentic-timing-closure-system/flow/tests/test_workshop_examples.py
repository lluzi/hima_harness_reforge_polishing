"""The copyable examples in the `plan-campaign` and `research-worker-NN` Workshop purposes.

Issue #64 live retest: the plan Workshop's model wrote a campaign plan with 41 schema
problems (descriptive `taskId`s, missing `protected` and `actions`, read procedures in
`scope.commands`), because the purpose described the fields only in prose. The purposes
now carry an exact example envelope and a self-check snippet. This test extracts both
from `contract.yml`, fills the placeholders from a fixture Campaign workspace, and runs
them through the real validators and Reader handlers, so an example that drifts from
`workspaces.validate_work_package` or `tools/read-atcs.py` fails here first.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_workshop_examples.py -v
"""
from __future__ import annotations

import copy
import json
import re
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import workspaces  # noqa: E402
import atcs_cli  # noqa: E402
from test_readers import _build_design_state, _make_workspace, _write, read_atcs  # noqa: E402

CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
SLOTS = [task_id[1:] for task_id in workspaces.TASK_IDS]

STATE_ID = "<id of state/working-state.json>"
STATE_OBJECT = "<the whole JSON object in state/working-state.json, verbatim>"

SCENARIO = "func_ssg_rcworst_m40"
# The example's hierarchy: top/u_core (module core)/u_lsu (module lsu)/<leaf cells>.
NETLIST = """module lsu (clk);
  DFFQ_X1 data_reg_3_ (.D(n4410), .CK(clk));
  DFFQ_X1 addr_reg_0_ (.D(n4411), .CK(clk));
  BUF_X2 U2231 (.A(n4409), .Z(n4410));
endmodule
module core (clk);
  lsu u_lsu (.clk(clk));
endmodule
module top (clk);
  core u_core (.clk(clk));
endmodule
"""

# What the retained live plan got wrong (the diagnostic of 2026-09-28).
READ_PROCS = ["atcs_ref", "atcs_paths", "atcs_gain", "atcs_candidates", "atcs_fail_reasons", "atcs_dump_cells"]


def _workshop_block(workshop_id):
    """The raw `contract.yml` text of one Workshop entry."""
    return CONTRACT.split(f"  - id: {workshop_id}\n", 1)[1].split("\n  - id: ", 1)[0]


def _example(workshop_id, marker):
    """The JSON example that follows `marker` in the Workshop's purpose.

    Read from the raw YAML: every example line is more indented than the purpose's
    prose, so the folded scalar keeps it verbatim (the contract test checks the same
    examples in the loaded Pack).
    """
    block = _workshop_block(workshop_id)
    at = block.index(marker)
    start = block.index("{", at + len(marker))
    value, _end = json.JSONDecoder().raw_decode(block[start:])
    return value


def _snippet(workshop_id, marker):
    """The Python lines that follow `marker` in the Workshop's purpose, dedented."""
    block = _workshop_block(workshop_id)
    lines = block.split(marker, 1)[1].split("\n")[1:]
    indent = len(lines[0]) - len(lines[0].lstrip())
    code = []
    for line in lines:
        if line.strip() and len(line) - len(line.lstrip()) < indent:
            break
        code.append(line)
    return textwrap.dedent("\n".join(code))


def _fill(value, design):
    """Replace the example's placeholders with the fixture's working state; refuse any other `<...>`."""
    if value == STATE_ID:
        return design["id"]
    if value == STATE_OBJECT:
        return copy.deepcopy(design)
    if isinstance(value, str):
        if value.startswith("<") and value.endswith(">"):
            raise AssertionError(f"the example holds a placeholder this test does not know: {value!r}")
        return value
    if isinstance(value, list):
        return [_fill(item, design) for item in value]
    if isinstance(value, dict):
        return {key: _fill(item, design) for key, item in value.items()}
    return value


def _run_snippet(code, workspace, names):
    """Run a purpose's snippet as entry.py would: argv[1] is the workspace."""
    saved = list(sys.argv)
    sys.argv = ["entry.py", str(workspace), "research/workshop"]
    try:
        exec(compile(code, "<purpose snippet>", "exec"), dict(names))
    finally:
        sys.argv = saved


class ExampleWorkspace(unittest.TestCase):
    """A Campaign workspace the examples are admissible in: the example's netlist, a working
    state, a policy requiring the example's scenario, an observation whose worst setup and hold
    checks are the example's target pins, and all six worker slots."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace, netlist_text=NETLIST)
        core.write_artifact(self.workspace / "state" / "working-state.json", self.design)
        policy = core.stamp("policy", {"requiredScenarios": [SCENARIO], "baselineStateId": self.design["id"]})
        core.write_artifact(self.workspace / "state" / "policy.json", policy)
        slacks = {
            f"{SCENARIO}|setup|u_core/u_lsu/data_reg_3_/D": -0.20, f"{SCENARIO}|setup|u_core/u_lsu/U2231/A": -0.05,
            f"{SCENARIO}|hold|u_core/u_lsu/addr_reg_0_/D": -0.10,
        }
        checks = {key: {"slack": core.known(value), "violated": True, "endpoint": key.split("|", 2)[2]}
                  for key, value in slacks.items()}
        observation = core.stamp("observation-set", {
            "designStateId": self.design["id"], "precision": "gba", "scenarios": {}, "checks": checks,
            "missingScenarios": [], "coverage": {"complete": True, "reasons": []}, "sources": [],
        })
        core.write_artifact(self.workspace / "state" / "observation.json", observation)
        self.assertEqual(atcs_cli.main(["worker-slots", str(self.workspace), "6"]), 0)

    def plan(self):
        return _fill(_example("plan-campaign", "Example research/requests/campaign-plan.json"), self.design)

    def read_plan(self, envelope):
        report = _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(envelope))
        (value,) = read_atcs.read("campaign-plan", report, self.workspace)
        return value["value"]

    def prepare(self, plan):
        """`state/workers.json` as `prepare-workers` leaves it: each slot's stamped, validated package."""
        workers = {}
        for slot, package in plan["candidate"]["workPackages"].items():
            validated = workspaces.validate_work_package(package, self.design, plan["siteCapabilities"])
            workers[slot] = {"workPackageId": validated["id"], "workPackage": validated,
                             **({"parked": True} if workspaces.is_parked(validated) else {})}
        _write(self.workspace / "state" / "workers.json", json.dumps({"workers": workers}))


class PlanCampaignExampleTest(ExampleWorkspace):
    def test_the_example_holds_all_six_slots_keyed_by_task_id(self):
        packages = self.plan()["candidate"]["workPackages"]
        self.assertEqual(list(packages), list(workspaces.TASK_IDS))
        for slot, package in packages.items():
            self.assertEqual(package["taskId"], slot)
        self.assertEqual(workspaces.is_parked(packages["w01"]), False)
        self.assertEqual(sorted(packages["w02"]), sorted(workspaces.PARKED_FIELDS))

    def test_the_active_example_shows_every_required_field(self):
        active = self.plan()["candidate"]["workPackages"]["w01"]
        for field in ("taskId", "baseStateId", *workspaces._REQUIRED_WORK_PACKAGE_FIELDS, "observe"):
            self.assertIn(field, active)
        self.assertEqual(active["scope"]["maxMutations"], workspaces.SCOPE_MAX_MUTATIONS)
        self.assertIn("atcs_undo", active["scope"]["commands"])

    def test_every_example_package_passes_validate_work_package(self):
        plan = self.plan()
        for slot, package in plan["candidate"]["workPackages"].items():
            with self.subTest(slot=slot):
                self.assertEqual(workspaces.request_invalid_count(package, self.design, plan["siteCapabilities"]), 0)
                workspaces.validate_work_package(package, self.design, plan["siteCapabilities"])

    def test_the_example_envelope_reads_with_zero_problems(self):
        self.assertEqual(self.read_plan(self.plan()), 0)

    def test_the_self_check_snippet_admits_the_example(self):
        plan = self.plan()
        code = _snippet("plan-campaign", "like this:")
        self.assertIn("validate_work_package", code)
        _run_snippet(code, self.workspace, {"packages": plan["candidate"]["workPackages"],
                                            "site_capabilities": plan["siteCapabilities"]})

    def test_the_self_check_snippet_refuses_an_uncovered_blocker(self):
        plan = self.plan()
        packages = plan["candidate"]["workPackages"]
        packages["w01"]["targets"] = [key for key in packages["w01"]["targets"] if "|hold|" not in key]
        packages["w01"]["targetPins"] = ["u_core/u_lsu/data_reg_3_/D"]
        code = _snippet("plan-campaign", "like this:")
        with self.assertRaises(AssertionError):
            _run_snippet(code, self.workspace, {"packages": packages, "site_capabilities": plan["siteCapabilities"]})
        self.assertEqual(self.read_plan(plan), 1, "the Reader counts the same uncovered worst hold check")

    def test_the_checklist_names_the_validators_own_sets(self):
        purpose = _workshop_block("plan-campaign")
        for command in workspaces.MUTATE_COMMANDS:
            self.assertIn(command, purpose)
        for action in workspaces.ACTION_KINDS:
            self.assertIn(action, purpose)
        self.assertIn(f'"maxMutations": {workspaces.SCOPE_MAX_MUTATIONS}', purpose)
        for task_id in workspaces.TASK_IDS:
            self.assertIn(task_id, purpose)


class RetainedBadPlanTest(ExampleWorkspace):
    """RED: the shapes of the live plan the Reader refused are each counted."""

    def bad_plan(self):
        plan = self.plan()
        packages = plan["candidate"]["workPackages"]
        w01 = packages.pop("w01")
        w01["taskId"] = f"w01-{SCENARIO}-func_ssg_rcworst_125-hold+setup"
        del w01["protected"], w01["actions"]
        w01["scope"]["commands"] = list(READ_PROCS)
        w04 = packages.pop("w04")
        w04["taskId"] = "w04-parked"
        plan["candidate"]["workPackages"] = {"w01": w01, "w02": packages["w02"], "w03": packages["w03"], "w04": w04,
                                             "w05": packages["w05"], "w06": packages["w06"]}
        return plan

    def test_each_bad_shape_is_a_problem(self):
        plan = self.bad_plan()
        w01 = plan["candidate"]["workPackages"]["w01"]
        with self.assertRaises(core.AtcsError) as refused:
            workspaces.validate_work_package(w01, self.design, plan["siteCapabilities"])
        message = str(refused.exception)
        self.assertIn("taskId must be one of", message)
        self.assertIn("missing field: protected", message)
        self.assertIn("missing field: actions", message)
        for proc in READ_PROCS:
            self.assertIn(f"scope command {proc!r} is not a toolkit mutation", message)
        self.assertIn("scope.commands must keep atcs_undo", message)
        # Descriptive taskId 1, two missing fields 2, six read procedures 6, no atcs_undo 1.
        self.assertEqual(workspaces.request_invalid_count(w01, self.design, plan["siteCapabilities"]), 10)
        w04 = plan["candidate"]["workPackages"]["w04"]
        self.assertEqual(workspaces.request_invalid_count(w04, self.design, plan["siteCapabilities"]), 1)

    def test_the_reader_counts_every_bad_shape(self):
        self.assertEqual(self.read_plan(self.bad_plan()), 11)
        self.assertEqual(self.read_plan(self.plan()), 0, "the example, fixed, is admitted")


class WorkerRequestExampleTest(ExampleWorkspace):
    ACTIVE = "for an active slot"
    PARKED = "Example for a parked slot"

    def worker_example(self, slot, marker):
        return _fill(_example(f"research-worker-{slot}", marker), self.design)

    def read_request(self, slot, envelope):
        report = _write(self.workspace / "research" / "requests" / f"worker-request-w{slot}.json", json.dumps(envelope))
        (value,) = read_atcs.read("worker-request", report, self.workspace, [f"w{slot}"])
        return value["value"]

    def plan_with_active_slot(self, slot):
        """The plan example with its active cluster moved to slot `slot` (every other slot parked)."""
        plan = self.plan()
        packages = plan["candidate"]["workPackages"]
        active = dict(packages["w01"], taskId=f"w{slot}")
        parked = {"taskId": None, "baseStateId": self.design["id"], "parked": True,
                  "problem": "no blocker cluster left for this slot"}
        plan["candidate"]["workPackages"] = {
            task_id: active if task_id == f"w{slot}" else dict(parked, taskId=task_id) for task_id in workspaces.TASK_IDS}
        return plan

    def test_the_six_worker_workshops_are_identical_modulo_slot(self):
        def slotless(slot):
            return (_workshop_block(f"research-worker-{slot}").replace(f"-{slot}", "-NN")
                    .replace(f"Request{slot}", "RequestNN").replace(f"Result{slot}", "ResultNN").replace(f"w{slot}", "wNN"))
        for slot in SLOTS:
            self.assertEqual(slotless(slot), slotless("01"), f"research-worker-{slot} is research-worker-01 for w{slot}")

    def test_the_active_example_is_the_plan_examples_package(self):
        plan_package = self.plan()["candidate"]["workPackages"]["w01"]
        for slot in SLOTS:
            candidate = self.worker_example(slot, self.ACTIVE)["candidate"]
            self.assertEqual(candidate, dict(plan_package, taskId=f"w{slot}"))

    def test_each_active_example_reads_with_zero_problems_against_its_prepared_package(self):
        for slot in SLOTS:
            with self.subTest(slot=f"w{slot}"):
                self.prepare(self.plan_with_active_slot(slot))
                example = self.worker_example(slot, self.ACTIVE)
                self.assertIn("sessionPlan", example)
                self.assertEqual(self.read_request(slot, example), 0)

    def test_each_parked_example_reads_with_zero_problems_against_its_parked_package(self):
        for slot in SLOTS:
            with self.subTest(slot=f"w{slot}"):
                plan = self.plan_with_active_slot("01" if slot != "01" else "02")
                self.prepare(plan)
                example = self.worker_example(slot, self.PARKED)
                self.assertNotIn("sessionPlan", example)
                self.assertEqual(self.read_request(slot, example), 0)

    def test_the_snippet_builds_a_candidate_the_reader_admits(self):
        for slot in SLOTS:
            with self.subTest(slot=f"w{slot}"):
                plan = self.plan_with_active_slot(slot)
                _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
                self.prepare(plan)
                code = _snippet(f"research-worker-{slot}", "like this:")
                self.assertIn(f'"w{slot}"', code)
                names = {}
                _run_snippet(code + "\nresult['candidate'] = candidate\n", self.workspace, {"result": names})
                envelope = {"candidate": names["candidate"], "baseState": self.design,
                            "siteCapabilities": plan["siteCapabilities"], "sessionPlan": []}
                self.assertEqual(self.read_request(slot, envelope), 0)

    def test_the_prepared_packages_schema_and_id_must_be_removed_for_a_parked_slot(self):
        plan = self.plan_with_active_slot("01")
        self.prepare(plan)
        prepared = json.loads((self.workspace / "state" / "workers.json").read_text())["workers"]["w02"]["workPackage"]
        envelope = {"candidate": prepared, "baseState": self.design, "siteCapabilities": plan["siteCapabilities"]}
        self.assertGreater(self.read_request("02", envelope), 0)

    def test_an_edited_scope_is_counted(self):
        self.prepare(self.plan_with_active_slot("03"))
        example = self.worker_example("03", self.ACTIVE)
        example["candidate"]["scope"]["commands"] = ["atcs_size_cell", "atcs_undo"]
        self.assertEqual(self.read_request("03", example), 1, "a narrowed scope differs from the prepared package")


if __name__ == "__main__":
    unittest.main()
