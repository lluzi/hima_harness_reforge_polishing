"""The admitted examples every request-writing Workshop reads as declared knowledge.

Issue #64 live retest: the plan Workshop's model wrote a campaign plan with 41 schema
problems (descriptive `taskId`s, missing `protected` and `actions`, read procedures in
`scope.commands`), because the purpose described the fields only in prose. Track B (from
#63): each model-written document has one admitted example in `knowledge/example-*.md`,
declared in `contract.yml` and in the knowledge list of the Workshop that writes it; the
plan and worker purposes keep their checklist and self-check snippet. This test reads each
example, fills the placeholders from a fixture Campaign workspace, and runs it through the
real validators and Reader handlers, so an example that drifts from
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
# The example's hierarchy: top/u_core (module core)/u_lsu (module lsu)/<leaf cells>. Masters follow the
# Site's sizing pattern D([0-9]+)BWP; LIBRARY is the Liberty the sealed XTop context names.
# The six clusters of the plan example: u_core/u_lsu (w01), u_core/u_ifu, u_core/u_dec, u_core/u_exu,
# u_dma and u_dbg (w02..w06), each holding the leaf cells its slot edits.
NETLIST = """module lsu (clk);
  SDFQD1BWP35P140 data_reg_3_ (.D(n4410), .CP(clk));
  SDFQD1BWP35P140 addr_reg_0_ (.D(n4411), .CP(clk));
  BUFFD2BWP35P140 U2231 (.I(n4409), .Z(n4410));
endmodule
module ifu (clk);
  SDFQD1BWP35P140 pc_reg_1_ (.D(n212), .CP(clk));
  BUFFD2BWP35P140 U880 (.I(n211), .Z(n212));
endmodule
module dec (clk);
  SDFQD1BWP35P140 ins_reg_7_ (.D(n98), .CP(clk));
  BUFFD2BWP35P140 U517 (.I(n97), .Z(n98));
endmodule
module exu (clk);
  SDFQD1BWP35P140 mul_reg_2_ (.D(n5), .CP(clk));
endmodule
module dma (clk);
  SDFQD1BWP35P140 fifo_reg_0_ (.D(n7), .CP(clk));
endmodule
module dbg (clk);
  SDFQD1BWP35P140 dmactive_reg_0_ (.D(n9), .CP(clk));
endmodule
module core (clk);
  lsu u_lsu (.clk(clk));
  ifu u_ifu (.clk(clk));
  dec u_dec (.clk(clk));
  exu u_exu (.clk(clk));
endmodule
module top (clk);
  core u_core (.clk(clk));
  dma u_dma (.clk(clk));
  dbg u_dbg (.clk(clk));
endmodule
"""

LIBRARY = ("SDFQD1BWP35P140", "SDFQD2BWP35P140", "BUFFD1BWP35P140", "BUFFD2BWP35P140", "BUFFD4BWP35P140")
ECO_PARAMETERS = {
    "bufferListForHold": ["BUFFD1BWP35P140"], "bufferListForSetup": ["BUFFD4BWP35P140"],
    "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
    "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"], "cellNominalSizingPattern": "D([0-9]+)BWP",
    "gainThreshold": 0.001,
}


def seal_xtop_context(workspace, design, cells=LIBRARY):
    """`state/xtop-context.json` as `observe` seals it for `design`, over a Liberty holding `cells`."""
    liberty = _write(workspace / "inputs" / "libs" / "standin.lib",
                     "library(standin) {\n" + "".join(f"  cell ({name}) {{}}\n" for name in cells) + "}\n")
    files = [{"path": str(liberty), "sha256": core.file_sha256(liberty)}]
    core.write_artifact(workspace / "state" / "xtop-context.json", core.stamp("xtop-context", {
        "designStateId": design["id"], "requiredScenarios": [SCENARIO], "libraryFiles": {SCENARIO: files},
        "ecoParameters": dict(ECO_PARAMETERS), "siteMap": ["unit", "core"], "removableFillers": ["FILL*"],
    }))


# What the retained live plan got wrong (the diagnostic of 2026-09-28).
READ_PROCS = ["atcs_ref", "atcs_paths", "atcs_gain", "atcs_candidates", "atcs_fail_reasons", "atcs_dump_cells"]


def _workshop_block(workshop_id):
    """The raw `contract.yml` text of one Workshop entry."""
    return CONTRACT.split(f"  - id: {workshop_id}\n", 1)[1].split("\n  - id: ", 1)[0]


KNOWLEDGE = PACK_DIR / "knowledge"
# Each request-writing Workshop, its example and the Reader kind that admits it.
EXAMPLES = {
    "plan-campaign": "example-campaign-plan.md",
    **{f"research-worker-{slot}": "example-worker-request.md" for slot in ("01", "02", "03", "04", "05", "06")},
    "compose-contributions": "example-integration-plan.md",
}


def _example(file, section=None):
    """The fenced json block of knowledge `file` (under the `## section` heading, when given)."""
    text = (KNOWLEDGE / file).read_text(encoding="utf-8")
    if section is not None:
        text = text.split(f"\n## {section}\n", 1)[1].split("\n## ", 1)[0]
    blocks = re.findall(r"```json\n(.*?)\n```", text, re.S)
    assert len(blocks) == 1, f"{file} {section!r} holds one json block, got {len(blocks)}"
    return json.loads(blocks[0])


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


def _fill(value, design, known=None):
    """Replace the example's placeholders with the fixture's values; refuse any other `<...>`.

    `known` maps further placeholders (or a `keep:<...>` decision's placeholder) to values."""
    known = known or {}
    if value == STATE_ID:
        return design["id"]
    if value == STATE_OBJECT:
        return copy.deepcopy(design)
    if isinstance(value, str):
        if value in known:
            return copy.deepcopy(known[value])
        prefix, _, rest = value.partition(":")
        if rest in known and prefix in ("keep", "drop", "revise"):
            return f"{prefix}:{known[rest]}"
        if "<" in value and ">" in value:
            raise AssertionError(f"the example holds a placeholder this test does not know: {value!r}")
        return value
    if isinstance(value, list):
        return [_fill(item, design, known) for item in value]
    if isinstance(value, dict):
        return {key: _fill(item, design, known) for key, item in value.items()}
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
        seal_xtop_context(self.workspace, self.design)
        policy = core.stamp("policy", {"requiredScenarios": [SCENARIO], "baselineStateId": self.design["id"]})
        core.write_artifact(self.workspace / "state" / "policy.json", policy)
        # Seven violating checks: the worst setup and hold (w01's cluster) and five more, one per cluster.
        slacks = {
            f"{SCENARIO}|setup|u_core/u_lsu/data_reg_3_/D": -0.20, f"{SCENARIO}|hold|u_core/u_lsu/addr_reg_0_/D": -0.10,
            f"{SCENARIO}|setup|u_core/u_ifu/pc_reg_1_/D": -0.15, f"{SCENARIO}|setup|u_core/u_dec/ins_reg_7_/D": -0.12,
            f"{SCENARIO}|hold|u_core/u_exu/mul_reg_2_/D": -0.08, f"{SCENARIO}|hold|u_dma/fifo_reg_0_/D": -0.07,
            f"{SCENARIO}|hold|u_dbg/dmactive_reg_0_/D": -0.05,
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
        return _fill(_example("example-campaign-plan.md"), self.design)

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

    def test_the_example_fills_every_seat_with_a_disjoint_cluster_and_gets_no_advice(self):
        """#64 treatment attempt 1 parked three of six seats while disjoint violating checks remained. The
        example shows six active clusters, worst first, and the plan Reader admits it with no advice; the
        parked shape is stated in its text (every key of workspaces.PARKED_FIELDS)."""
        plan = self.plan()
        packages = plan["candidate"]["workPackages"]
        self.assertEqual([slot for slot, package in packages.items() if not workspaces.is_parked(package)],
                         list(workspaces.TASK_IDS))
        report = _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
        self.assertEqual(read_atcs.problems("campaign-plan", report, self.workspace), [])
        self.assertEqual(read_atcs.advice("campaign-plan", report, self.workspace), [])
        text = (KNOWLEDGE / "example-campaign-plan.md").read_text().split("```json", 1)[0]
        for field in workspaces.PARKED_FIELDS:
            self.assertIn(f'"{field}"', text)

    def test_parking_a_seat_while_checks_are_uncovered_is_advice_not_a_refusal(self):
        plan = self.plan()
        plan["candidate"]["workPackages"]["w06"] = {"taskId": "w06", "baseStateId": self.design["id"], "parked": True,
                                                    "problem": "no cluster left"}
        report = _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
        self.assertEqual(read_atcs.problems("campaign-plan", report, self.workspace), [])
        (line,) = read_atcs.advice("campaign-plan", report, self.workspace)
        self.assertIn(f"{SCENARIO}|hold|u_dbg/dmactive_reg_0_/D", line)
        code = _snippet("plan-campaign", "like this:")
        _run_snippet(code, self.workspace, {"packages": plan["candidate"]["workPackages"],
                                            "site_capabilities": plan["siteCapabilities"]})

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
        # ADR-0016: the Workshop's own self-check still refuses it; the Reader advises, never counts, it.
        self.assertEqual(self.read_plan(plan), 0, "an uncovered worst hold check is the Reader's advice")

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
    ACTIVE = "Active slot"
    NO_SAFE_MOVE = "Active slot with no safe move"
    PARKED = "Parked slot"

    def worker_example(self, slot, section):
        """The example for `section`, with the taskId of slot `slot` (the example is written for w01)."""
        example = _fill(_example("example-worker-request.md", section), self.design)
        self.assertEqual(example["candidate"]["taskId"], "w01")
        example["candidate"]["taskId"] = f"w{slot}"
        return example

    def read_request(self, slot, envelope):
        report = _write(self.workspace / "research" / "requests" / f"worker-request-w{slot}.json", json.dumps(envelope))
        value = next(item for item in read_atcs.read("worker-request", report, self.workspace, [f"w{slot}"])
                     if item["type"] == "tc_request_invalid_count")
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


class KnowledgeDeliveryTest(unittest.TestCase):
    """Each request-writing Workshop reads its example as declared knowledge, and only those ship."""

    def test_each_example_is_declared_listed_and_named_by_its_workshop(self):
        declared = re.findall(r"^  - file: (\S+)$", CONTRACT.split("\nknowledge:\n", 1)[1].split("\nagentTeams:\n", 1)[0], re.M)
        for workshop_id, file in EXAMPLES.items():
            with self.subTest(workshop_id):
                self.assertIn(file, declared)
                block = _workshop_block(workshop_id)
                listed = re.search(r"^    knowledge: \[(.*)\]$", block, re.M).group(1).split(", ")
                self.assertIn(file, listed)
                self.assertIn(f"knowledge {file[:-3]}", " ".join(block.split("    directory:")[0].split()))
                self.assertTrue((KNOWLEDGE / file).is_file())

    def test_exactly_the_five_examples_ship_and_no_purpose_inlines_one(self):
        self.assertEqual(sorted(path.name for path in KNOWLEDGE.glob("example-*.md")), sorted(set(EXAMPLES.values())))
        for workshop_id in EXAMPLES:
            self.assertNotIn("Example research/requests", _workshop_block(workshop_id), workshop_id)


class NoSafeMoveExampleTest(WorkerRequestExampleTest):
    """#64 Track B (from #63 review 2, I2): research that finds no safe move says so; it never
    invents one. The request is admitted, and its Team reviews no move."""

    def test_each_no_safe_move_example_reads_with_zero_problems(self):
        for slot in SLOTS:
            with self.subTest(slot=f"w{slot}"):
                self.prepare(self.plan_with_active_slot(slot))
                example = self.worker_example(slot, self.NO_SAFE_MOVE)
                self.assertEqual(example["sessionPlan"], [])
                self.assertTrue(example["noSafeAction"].strip())
                self.assertEqual(self.read_request(slot, example), 0)

    def test_a_no_safe_move_request_that_still_plans_or_states_no_reason_is_counted(self):
        self.prepare(self.plan_with_active_slot("02"))
        planned = self.worker_example("02", self.NO_SAFE_MOVE)
        planned["sessionPlan"] = self.worker_example("02", self.ACTIVE)["sessionPlan"]
        self.assertEqual(self.read_request("02", planned), 1)
        blank = self.worker_example("02", self.NO_SAFE_MOVE)
        blank["noSafeAction"] = " "
        self.assertEqual(self.read_request("02", blank), 1)
        report = self.workspace / "research" / "requests" / "worker-request-w02.json"
        self.assertTrue(read_atcs.problems("worker-request", report, self.workspace, "w02")[0]
                        .startswith("noSafeAction (slot w02): must be a non-empty string"))

    def test_a_parked_slot_carries_no_no_safe_action(self):
        self.prepare(self.plan_with_active_slot("01"))
        parked = dict(self.worker_example("02", self.PARKED), noSafeAction="nothing to do")
        self.assertEqual(self.read_request("02", parked), 1)

    def test_the_team_reviews_no_move_for_a_no_safe_move_request(self):
        # ADR-0016: the Operator works from the request itself (no Researcher or Reviewer in between),
        # so its own template carries the no-safe-move path: mutate nothing and say so.
        team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
        self.assertEqual(team.count("When the request states noSafeAction, mutate nothing"), 6)
        self.assertEqual(team.count("with stopReason no-safe-action"), 6)
        self.assertEqual(team.count("stopReason (budget, no-candidate-gains, blockers-clear, no-safe-action, tainted or refused)"), 6)


def _reviewer_template(slot="01"):
    team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
    body = team.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("      - id: reviewer\n", 1)[1].split("\n      - id: ", 1)[0]
    template = re.search(r"^        taskTemplate: '(.*)'$", body, re.M).group(1).replace("''", "'")
    required = [f.strip() for f in re.search(r"^          required: \[(.*)\]$", body, re.M).group(1).split(",")]
    return template, required


def _reviewer_format_problems(reply):
    """The reviewer taskTemplate's format caps, as checks (#63 probe refusal 2)."""
    found = []
    for field, value in reply.items():
        if isinstance(value, dict) and field != "scope":
            found.append(f"{field} is a nested object")
    refs = reply.get("evidenceRefs")
    if not isinstance(refs, list) or not all(isinstance(ref, str) for ref in refs):
        found.append("evidenceRefs is not a list of record-id strings")
    limitations = reply.get("limitations")
    if not isinstance(limitations, list) or len(limitations) > 3 \
            or not all(isinstance(item, str) and len(item) < 200 for item in limitations):
        found.append("limitations is not at most three strings under 200 characters")
    return found


class ReviewerReplyFormatTest(unittest.TestCase):
    """ADR-0016: the Reviewer is an optional advisory member; nothing waits for it and nothing is gated
    on it. Its template still names every required field and caps the reply (#64 Track B, from #63
    probe item 2), and the probe answer that broke a reply still breaks the caps."""

    def test_every_reviewer_is_advisory_and_names_each_required_field_and_the_rules(self):
        for slot in ("01", "02", "03", "04", "05", "06"):
            template, required = _reviewer_template(slot)
            for field in required:
                self.assertRegex(template, rf"\b{field}\b", f"slot {slot}")
            for rule in ("Advisory only: nothing waits for you and nothing is gated on you",
                         "exactly one JSON object and nothing else", "at most three limitations under 200 characters"):
                self.assertIn(rule, template, f"slot {slot}")
            self.assertEqual(required, ["schema", "planSha256", "evidenceRefs", "limitations"])

    def test_the_probe_answer_breaks_the_caps(self):
        probe = json.loads((TESTS_DIR / "live_fixtures" / "probe-reviewer-answer.json").read_text(encoding="utf-8"))
        self.assertEqual(_reviewer_format_problems(probe), [
            "arguments is a nested object",
            "evidenceRefs is not a list of record-id strings",
            "limitations is not at most three strings under 200 characters",
        ])


class IntegrationPlanExampleTest(ExampleWorkspace):
    """w01 and w02 edit the same instance; the example keeps w01 and replays it with w03."""

    def facts(self):
        ids = {slot: core.digest({"contribution": slot}) for slot in ("w01", "w02", "w03")}
        key = f"same-instance-different-master|{ids['w01']},{ids['w02']}|u_core/u_lsu/U2231"
        facts = core.stamp("composition-facts", {
            "baseStateId": self.design["id"], "considered": [ids["w01"], ids["w02"], ids["w03"]], "duplicates": [],
            "conflicts": [{"key": key, "kind": "same-instance-different-master",
                           "contributions": [ids["w01"], ids["w02"]], "objects": ["u_core/u_lsu/U2231"]}],
            "interactions": [], "staleBase": [], "order": [ids["w01"], ids["w02"], ids["w03"]], "unresolvedCount": 1,
        })
        known = {"<facts.baseStateId>": self.design["id"], "<id of w01's Contribution>": ids["w01"],
                 "<id of w03's Contribution>": ids["w03"], "<the facts.conflicts key naming w01 and w02>": key,
                 "<the whole JSON object in state/composition-facts.json, verbatim>": facts}
        return facts, known

    def test_the_example_reads_with_zero_problems_and_selects_two(self):
        _facts, known = self.facts()
        example = _fill(_example("example-integration-plan.md"), self.design, known)
        report = _write(self.workspace / "research" / "requests" / "integration-plan.json", json.dumps(example))
        self.assertEqual(read_atcs.problems("integration-plan", report, self.workspace), [])
        values = {value["type"]: value["value"] for value in read_atcs.read("integration-plan", report, self.workspace)}
        self.assertEqual(values, {"tc_request_invalid_count": 0, "tc_selected_contribution_count": 2})

    def test_a_resolution_for_a_no_fix_contribution_is_counted(self):
        """C05 (#63 failure catalogue, 9737b28f, ported for #64): PR03 lost a generation on a plan that
        wrote a resolution for a no-fix Contribution, which is considered but in no conflict. A
        resolution exists only for a facts.conflicts key and has exactly {conflictKey, decision}; the
        example with the no-fix id added to `deferred` is admitted, and each live shape is counted."""
        facts, known = self.facts()
        no_fix = core.digest({"contribution": "w04-no-fix"})
        body = {k: v for k, v in facts.items() if k not in ("schema", "id")}
        body["considered"] = sorted(body["considered"] + [no_fix])
        body["order"] = body["order"] + [no_fix]
        facts = core.stamp("composition-facts", body)
        known["<the whole JSON object in state/composition-facts.json, verbatim>"] = facts
        admitted = _fill(_example("example-integration-plan.md"), self.design, known)
        admitted["plan"]["deferred"] = [no_fix]
        report = self.workspace / "research" / "requests" / "integration-plan.json"
        _write(report, json.dumps(admitted))
        self.assertEqual(read_atcs.problems("integration-plan", report, self.workspace), [])
        for label, resolution in (
            ("decision only", {"decision": "drop"}),
            ("live PR03 shape", {"contributionId": no_fix, "decision": "drop", "reason": "no-fix", "taskId": "w04"}),
            ("drop by id, no conflict", {"conflictKey": "no-fix", "decision": "drop:" + no_fix}),
        ):
            with self.subTest(label=label):
                document = copy.deepcopy(admitted)
                document["plan"]["resolutions"].append(resolution)
                _write(report, json.dumps(document))
                found = read_atcs.problems("integration-plan", report, self.workspace)
                (count,) = [v["value"] for v in read_atcs.read("integration-plan", report, self.workspace)
                            if v["type"] == "tc_request_invalid_count"]
                self.assertEqual(count, len(found))
                self.assertGreaterEqual(len(found), 1, found)
                self.assertTrue(all(text.startswith("plan.") for text in found), found)
                self.assertTrue(any(text.startswith("plan.resolution") for text in found), found)

    def test_selecting_both_sides_of_the_conflict_without_its_resolution_is_counted(self):
        facts, known = self.facts()
        example = _fill(_example("example-integration-plan.md"), self.design, known)
        example["plan"]["resolutions"] = []
        example["plan"]["select"] = list(facts["considered"])
        report = _write(self.workspace / "research" / "requests" / "integration-plan.json", json.dumps(example))
        found = read_atcs.problems("integration-plan", report, self.workspace)
        self.assertTrue(found and all(line.startswith("plan.") for line in found), found)


class Live02ToExampleShapeTest(unittest.TestCase):
    """The live02 plan reads 41; corrected along its 41 lines (and its netlist advice) into the example's shape,
    it reads 0 with no advice.

    The success path of the refusal, on the retained bytes and state: every line of
    campaign-plan.problems.txt says what to change, and changing exactly that is admitted."""

    def setUp(self):
        from unittest import mock
        from test_request_problems import live02_workspace

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = live02_workspace(self.tmp.name)
        self.report = self.workspace / "research" / "requests" / "campaign-plan.json"
        patcher = mock.patch.object(read_atcs, "_verify_design_state_refs", lambda *args, **kwargs: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def read(self, plan):
        self.report.write_text(json.dumps(plan), encoding="utf-8")
        return read_atcs.problems("campaign-plan", self.report, self.workspace)

    def test_the_live_plan_reads_41_and_its_corrected_shape_reads_0(self):
        # ADR-0016: 37 of the live 41 stay counted; the four uncovered-blocker lines are advice.
        self.assertEqual(len(read_atcs.problems("campaign-plan", self.report, self.workspace)), 37)
        plan = json.loads(self.report.read_text())
        packages = plan["candidate"]["workPackages"]
        example = _example("example-campaign-plan.md")["candidate"]["workPackages"]
        w01 = packages["w01"]
        # taskId is the slot key; protected and actions present (the example's shapes).
        w01.update(taskId="w01", protected=example["w01"]["protected"], actions=example["w01"]["actions"])
        # scope lists toolkit mutations only, with atcs_undo; ports are named by check key, never in targetPins.
        w01["scope"]["commands"] = [c for c in w01["scope"]["commands"] if c in workspaces.MUTATE_COMMANDS]
        w01["targetPins"] = [pin for pin in w01["targetPins"] if "/" in pin]
        # C23: the edit domain names the leaf cells the endpoints end at, never a port or a module
        # instance, and each target pin is a pin of one of them.
        w01["editDomain"]["instances"] = list(w01["targetPins"])
        w01["targetPins"] = [f"{cell}/D" for cell in w01["editDomain"]["instances"]]
        # w02 and w03 worked w01's hold endpoint at other corners, so their instance was shared:
        # w01 takes their checks and they are parked in the exact parked shape.
        for slot in ("w02", "w03"):
            w01["targets"] += packages[slot]["targets"]
        # The four uncovered blockers (the async_default hold group) become w04's cluster.
        blockers = [key for key in _live02_blockers(self.workspace) if "@**async_default**" in key]
        self.assertEqual(len(blockers), 4)
        w04 = copy.deepcopy(example["w01"])
        w04.update(taskId="w04", baseStateId=w01["baseStateId"], targets=blockers, targetPins=[],
                   problem="the four required scenarios' worst hold check, in the async_default group",
                   editDomain={"instances": ["swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_"], "nets": [], "regions": []},
                   mayAffect=[])
        parked = {slot: {"taskId": slot, "baseStateId": w01["baseStateId"], "parked": True,
                         "problem": "no separate blocker cluster for this slot"} for slot in ("w02", "w03", "w05", "w06")}
        plan["candidate"]["workPackages"] = {"w01": w01, "w02": parked["w02"], "w03": parked["w03"], "w04": w04,
                                             "w05": parked["w05"], "w06": parked["w06"]}
        self.assertEqual(self.read(plan), [])
        self.assertEqual(read_atcs.advice("campaign-plan", self.report, self.workspace), [])


def _live02_blockers(workspace):
    from atcs import composition
    observation = json.loads((workspace / "state" / "observation.json").read_text())
    return list(composition.worst_check_endpoints(observation))


if __name__ == "__main__":
    unittest.main()
