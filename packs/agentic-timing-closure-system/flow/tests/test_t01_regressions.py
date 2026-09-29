"""Regressions from the #64 treatment attempt 1 (run-9a5f197a, Pack 0.2.0 at 12950dac).

The retained Run documents are in `live_fixtures/` (see its README): each test reads them as the
Run wrote them and changes only what the case names. The Site's design files stayed on the Site, so
the tests stub `read-atcs.py`'s design-file re-hash (`_verify_design_state_refs`) and nothing else,
and write a stand-in netlist and Liberty file at the paths the retained working state and a sealed
XTop context name. Stand-in masters: `SDFCNQARD1BWP35P140` of
`swerv_ifu/mem_ctl/miss_state_ff_dffs_dout_reg_2_` is proven by w03's session (it sized it to
`SDFCNQD2BWP35P140` and undid it); the other masters are assumed and follow the Site's sizing pattern
`D([0-9]+)BWP`.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_t01_regressions.py -v
"""
from __future__ import annotations

import copy
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from test_readers import _make_workspace, _prepare_slot, _write, read_atcs  # noqa: E402

LIVE = TESTS_DIR / "live_fixtures"
CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
SLOTS = ("01", "02", "03", "04", "05", "06")

# The retained bytes (Ledger observation records #144 and #254).
T01_W01_SHA256 = "649ca0d5a31842d3953ee61375bbe4ba8f2822147afa212ece61cfad83c2a0e8"
T01_W03_SHA256 = "0a434f5f1950e19d40f3e24a288cc512bfbdb48e9d9a96c7866cfe1f23ed2eb0"
# Ledger #117, admitted at 0 (#119).
T01_PLAN_SHA256 = "b09ca014cdd5327a99806d62216106c44f62986922a0efeb7dfa2cc3759a513b"

W01_REG = "swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_"
W02_REG = "swerv_ifu/mem_ctl/miss_state_ff_dffs_dout_reg_0_"
W03_REG = "swerv_ifu/mem_ctl/miss_state_ff_dffs_dout_reg_2_"

# The Site's ecoParameters (sites/linglong-atcs28/inputs/siteCapabilities-v4.json).
SITE_ECO = {
    "bufferListForHold": ["DEL025D1BWP30P140", "BUFFD2BWP30P140"], "bufferListForSetup": ["BUFFD2BWP30P140"],
    "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
    "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"], "cellNominalSizingPattern": "D([0-9]+)BWP",
    "gainThreshold": 0.001,
}
LIBRARY = ("SDFCNQD1BWP35P140", "SDFCNQD2BWP35P140", "SDFCNQD4BWP35P140", "SDFCNQARD1BWP35P140",
           "SDFCNQARD2BWP35P140", "SDFCNQARD4BWP35P140", "SDFCNQARD2BWP35P140LVT", "BUFFD2BWP30P140")
MASTERS = {W01_REG: "SDFCNQD1BWP35P140", W02_REG: "SDFCNQARD1BWP35P140", W03_REG: "SDFCNQARD1BWP35P140"}


def standin_netlist(top, leaves):
    """A structural netlist under `top` holding each `{path: master}` leaf, one module per level."""
    modules = {top: {}}
    for path, master in leaves.items():
        parts = path.split("/")
        module = top
        for depth, part in enumerate(parts[:-1]):
            child = "m_" + "_".join(parts[:depth + 1])
            modules[module][part] = child
            modules.setdefault(child, {})
            module = child
        modules[module][parts[-1]] = master
    text = []
    for name, instances in modules.items():
        text.append(f"module {name} (clk);")
        text += [f"  {kind} {instance} (.CP(clk));" for instance, kind in instances.items()]
        text.append("endmodule")
    return "\n".join(text) + "\n"


def t01_workspace(root, leaves=None, library=LIBRARY):
    """A Campaign workspace holding attempt 1's working state, a stand-in netlist at its path and a
    sealed XTop context over a stand-in Liberty file."""
    workspace = _make_workspace(root)
    working = json.loads((LIVE / "live02-working-state.json").read_text())
    _write(workspace / "state" / "working-state.json", (LIVE / "live02-working-state.json").read_text())
    _write(workspace / working["netlist"]["path"], standin_netlist(working["top"], leaves or MASTERS))
    liberty = _write(Path(root) / "libs" / "tcbn28_ssg.lib",
                     "library(standin) {\n" + "".join(f"  cell ({name}) {{}}\n" for name in library) + "}\n")
    files = [{"path": str(liberty), "sha256": core.file_sha256(liberty)}]
    context = core.stamp("xtop-context", {
        "designStateId": working["id"], "requiredScenarios": working["scenarios"],
        "libraryFiles": {scenario: files for scenario in working["scenarios"]},
        "ecoParameters": dict(SITE_ECO), "siteMap": ["unit", "core"], "removableFillers": ["FILL*"],
    })
    core.write_artifact(workspace / "state" / "xtop-context.json", context)
    return workspace, working


class T01Workspace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace, self.working = t01_workspace(self.tmp.name)
        patcher = mock.patch.object(read_atcs, "_verify_design_state_refs", lambda *args, **kwargs: None)
        patcher.start()
        self.addCleanup(patcher.stop)
        read_atcs._netlist_hierarchy_cache.clear()

    def request(self, slot):
        document = json.loads((LIVE / f"t01-worker-request-w{slot}.json").read_text())
        _prepare_slot(self.workspace, document["candidate"])
        return document

    def problems(self, slot, document):
        report = _write(self.workspace / "research" / "requests" / f"worker-request-w{slot}.json", json.dumps(document))
        found = read_atcs.problems("worker-request", report, self.workspace, f"w{slot}")
        (value,) = read_atcs.read("worker-request", report, self.workspace, [f"w{slot}"])
        self.assertEqual(value["value"], len(found), found)
        return found

    def advised(self, slot, document):
        """The #64 worker/aggregation principle: the request is admitted; the findings are advice."""
        self.assertEqual(self.problems(slot, document), [])
        report = self.workspace / "research" / "requests" / f"worker-request-w{slot}.json"
        return read_atcs.advice("worker-request", report, self.workspace, f"w{slot}")


def size_entry(document):
    (index,) = [i for i, entry in enumerate(document["sessionPlan"]) if entry["command"] == "atcs_size_cell"]
    return index, document["sessionPlan"][index]


class SizeMoveMasterTest(T01Workspace):
    """C13 (#63) on the six-slot 0.2.0 request, from attempt 1's w01 and w03.

    w01's Operator sized its register to 'SDGCNQOPTMC D12BWP30P140', two columns of atcs_candidates
    joined, and XTop refused it twice as an invalid library cell (two approved mutations spent). w03
    sized SDFCNQARD1BWP35P140 to SDFCNQD2BWP35P140, which drops the asynchronous reset, and undid it.
    Both requests' size entries named no master: the Reader admitted them at 0 (Ledger #144, #254) and
    said nothing. Under the #64 worker/aggregation principle (FABRIC.md, 2026-09-29) each master finding
    is advice in the sidecar, never a refusal; only a size move outside the slot's edit domain is counted
    (merge integrity). RED on 12950dac: no advice existed; the out-of-domain object read 0.
    """

    def test_the_fixtures_are_the_retained_requests(self):
        for slot, digest in (("01", T01_W01_SHA256), ("03", T01_W03_SHA256)):
            self.assertEqual(hashlib.sha256((LIVE / f"t01-worker-request-w{slot}.json").read_bytes()).hexdigest(), digest)

    def test_a_size_entry_without_its_master_is_advised_where_masters_come_from(self):
        for slot, reg in (("01", W01_REG), ("03", W03_REG)):
            with self.subTest(slot=slot):
                index, _entry = size_entry(self.request(slot))
                (line,) = self.advised(slot, self.request(slot))
                self.assertTrue(line.startswith(f"sessionPlan[{index}].toMaster (slot w{slot}): missing"), line)
                self.assertIn(reg, line)
                for source in ("libraryFiles", "cellNominalSizingPattern", "no cell table", "read-atcs.py masters"):
                    self.assertIn(source, line)

    def test_the_joined_columns_w01_sent_are_advised(self):
        document = self.request("01")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDGCNQOPTMC D12BWP30P140"
        (line,) = self.advised("01", document)
        self.assertRegex(line, rf"^sessionPlan\[{index}\]\.toMaster \(slot w01\): 'SDGCNQOPTMC D12BWP30P140' is not one "
                               "plain cell name")

    def test_a_master_outside_the_libraries_is_advised(self):
        document = self.request("01")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDGCNQOPTMCD12BWP30P140"
        (line,) = self.advised("01", document)
        self.assertIn(f"sessionPlan[{index}].toMaster (slot w01): 'SDGCNQOPTMCD12BWP30P140' is not a cell of this "
                      "design's libraries", line)

    def test_the_flop_swap_w03_tried_changes_the_function(self):
        document = self.request("03")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDFCNQD2BWP35P140"
        (line,) = self.advised("03", document)
        self.assertIn(f"sessionPlan[{index}].toMaster (slot w03): 'SDFCNQD2BWP35P140' changes the cell function "
                      "'SDFCNQARD'", line)

    def test_a_same_function_resize_or_vt_swap_is_admitted(self):
        for master in ("SDFCNQARD2BWP35P140", "SDFCNQARD2BWP35P140LVT"):
            with self.subTest(master=master):
                document = self.request("03")
                size_entry(document)[1]["toMaster"] = master
                self.assertEqual(self.advised("03", document), [])

    def test_the_current_master_is_advised(self):
        document = self.request("03")
        index, entry = size_entry(document)
        entry["toMaster"] = "SDFCNQARD1BWP35P140"
        (line,) = self.advised("03", document)
        self.assertIn("is already the master of", line)

    def test_a_size_entry_outside_the_edit_domain_is_counted(self):
        document = self.request("03")
        index, entry = size_entry(document)
        entry.update(object=W02_REG, toMaster="SDFCNQARD2BWP35P140")
        (line,) = self.problems("03", document)
        self.assertTrue(line.startswith(f"sessionPlan[{index}].object (slot w03): "), line)

    def test_a_context_for_another_state_is_one_advice(self):
        path = self.workspace / "state" / "xtop-context.json"
        body = {k: v for k, v in json.loads(path.read_text()).items() if k not in ("schema", "id")}
        body["designStateId"] = "0" * 20
        core.write_artifact(path, core.stamp("xtop-context", body))
        document = self.request("03")
        size_entry(document)[1]["toMaster"] = "SDFCNQARD2BWP35P140"
        (line,) = self.advised("03", document)
        self.assertIn("no toMaster can be checked", line)
        self.assertIn("observe first", line)

    def test_the_masters_command_lists_the_same_function_only(self):
        instances = _write(self.workspace / "research" / "worker-03" / "instances.json", json.dumps([W03_REG, "swerv_ifu"]))
        out = self.workspace / "research" / "worker-03" / "masters.json"
        with mock.patch.object(sys, "argv", ["read-atcs.py", "masters", str(self.workspace), str(instances), str(out)]):
            with mock.patch.object(read_atcs, "_require_file", lambda *args, **kwargs: None):
                read_atcs.main()
        answer = json.loads(out.read_text())
        (row,) = answer["masters"]
        self.assertEqual((row["instance"], row["master"], row["function"]), (W03_REG, "SDFCNQARD1BWP35P140", "SDFCNQARD"))
        self.assertEqual(row["toMasters"], ["SDFCNQARD2BWP35P140", "SDFCNQARD2BWP35P140LVT", "SDFCNQARD4BWP35P140"])
        (unresolved,) = answer["unresolved"]
        self.assertIn("module instance", unresolved["unresolved"])


class SizeMoveGuidanceTest(unittest.TestCase):
    """#63 live finding #250: the researcher looked for the cell table in xtop-context.json. The
    Workshop, the knowledge and the Operator say where a master comes from and in what form."""

    def test_each_research_workshop_says_where_the_masters_come_from(self):
        for slot in SLOTS:
            block = CONTRACT.split(f"  - id: research-worker-{slot}\n", 1)[1].split("\n  - id: ", 1)[0]
            with self.subTest(slot=slot):
                for words in ("toMaster", "libraryFiles", "cell (NAME)", "cellNominalSizingPattern", "no cell table",
                              "hima-readers/atcs-readiness/read-atcs.py masters"):
                    self.assertIn(words, block)

    def test_the_example_size_entry_names_its_master(self):
        text = (PACK_DIR / "knowledge" / "example-worker-request.md").read_text()
        self.assertIn('"toMaster"', text)
        self.assertIn("cellNominalSizingPattern", text)

    def test_each_operator_types_one_library_cell_name(self):
        for slot in SLOTS:
            team = CONTRACT.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("\n  - id: atcs-worker-", 1)[0]
            operator = team.split("      - id: operator\n", 1)[1]
            with self.subTest(slot=slot):
                self.assertIn("toMaster", operator)
                self.assertIn("never join two columns", operator)
                self.assertIn("invalid library cell", operator)


def plan_workspace(test):
    """`t01_workspace` plus the plan's companions: attempt 1's policy, its worker-slots record, the
    reduced observation and the retained plan."""
    for name, target in (("t01-policy.json", "state/policy.json"), ("live02-worker-slots.json", "state/worker-slots.json"),
                         ("t01-observation-top.json", "state/observation.json")):
        _write(test.workspace / target, (LIVE / name).read_text())
    return json.loads((LIVE / "t01-campaign-plan.json").read_text())


class T01PlanWorkspace(T01Workspace):
    def setUp(self):
        super().setUp()
        self.plan = plan_workspace(self)

    def plan_problems(self, plan):
        report = _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
        found = read_atcs.problems("campaign-plan", report, self.workspace)
        (value,) = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertEqual(value["value"], len(found), found)
        return found

    def plan_advice(self, plan, fields=None):
        """The advice lines on `plan`; with `fields`, only those about `candidate.workPackages.wNN.<field>`."""
        report = _write(self.workspace / "research" / "requests" / "campaign-plan.json", json.dumps(plan))
        found = read_atcs.advice("campaign-plan", report, self.workspace)
        if fields is None:
            return found
        return [line for line in found if line.split(":", 1)[0].rsplit(".", 1)[-1] in fields]


class LeafCellEditDomainTest(T01PlanWorkspace):
    """C23 (#63) on the six-slot 0.2.0 plan, as advice (the #64 worker/aggregation principle, FABRIC.md):
    the plan Reader never read the netlist, so a plan naming a module instance, a port, a bare leaf or
    an absent path as an edit-domain cell reached the Operator with no word to the Workshop. Now each is
    one advice line in the sidecar, naming the resolver, and the plan is not refused for it. RED on
    12950dac: no Reader advice existed."""

    def test_the_fixture_is_the_retained_plan_and_its_domains_are_leaf_cells(self):
        self.assertEqual(hashlib.sha256((LIVE / "t01-campaign-plan.json").read_bytes()).hexdigest(), T01_PLAN_SHA256)
        self.assertEqual(self.plan_advice(self.plan, ("editDomain", "targetPins")), [])

    def test_an_unusable_edit_domain_instance_is_advised(self):
        for label, name, needle in (
            ("module instance", "swerv_ifu/mem_ctl", "is a module instance"),
            ("top port", "ifu_axi_araddr[5]", "is not a hierarchical instance"),
            ("bare leaf", "miss_state_ff_dffs_dout_reg_0_", "is not a hierarchical instance"),
            ("absent", "swerv_ifu/mem_ctl/no_such_reg", "is not a hierarchical instance"),
        ):
            with self.subTest(label=label):
                plan = copy.deepcopy(self.plan)
                plan["candidate"]["workPackages"]["w02"]["editDomain"]["instances"] = [name]
                self.assertEqual([line for line in self.plan_problems(plan) if ".editDomain" in line], [])
                lines = self.plan_advice(plan, ("editDomain", "targetPins"))
                self.assertEqual(len(lines), 1, lines)
                self.assertTrue(lines[0].startswith(f"candidate.workPackages.w02.editDomain: instance {name!r} "), lines)
                self.assertIn(needle, lines[0])
                if needle != "is a module instance":
                    self.assertIn("resolve-instances", lines[0])
                    self.assertIn("pass the endpoint, not the check key", lines[0])

    def test_a_module_pin_as_target_pin_is_advised(self):
        plan = copy.deepcopy(self.plan)
        plan["candidate"]["workPackages"]["w03"]["targetPins"] = ["swerv_ifu/mem_ctl/D"]
        self.assertEqual([line for line in self.plan_problems(plan) if ".targetPins" in line], [])
        lines = self.plan_advice(plan, ("editDomain", "targetPins"))
        self.assertEqual(len(lines), 1, lines)
        self.assertTrue(lines[0].startswith("candidate.workPackages.w03.targetPins: 'swerv_ifu/mem_ctl/D' is not a "
                                            "hierarchical pin of a leaf cell"), lines)

    def test_a_worker_request_naming_a_module_instance_is_advised(self):
        document = self.request("03")
        document["candidate"]["editDomain"]["instances"] = ["swerv_ifu/mem_ctl"]
        document["sessionPlan"] = []
        _prepare_slot(self.workspace, document["candidate"])
        self.assertEqual(self.problems("03", document), [])
        report = self.workspace / "research" / "requests" / "worker-request-w03.json"
        (line,) = read_atcs.advice("worker-request", report, self.workspace, "w03")
        self.assertTrue(line.startswith("candidate.editDomain (slot w03): instance 'swerv_ifu/mem_ctl' is a module "
                                        "instance"), line)


class ParkedSeatTest(T01PlanWorkspace):
    """Treatment attempt 1's plan made 3 clusters from the scenarios' single worst checks and parked w04..w06
    although workerSlots was 6 and the observation held disjoint violating checks (the dma FIFO and dmi sync
    flops, lsu_axi_arvalid, sb_axi_wdata[0]). Guidance and advice, never a refusal for parking (the #64
    worker/aggregation principle): each parked seat is one advice line naming the worst uncovered check.
    RED on c1269571: the retained plan got no advice."""

    def test_the_retained_plan_is_advised_once_per_parked_seat_with_the_worst_uncovered_check(self):
        self.assertEqual(self.plan_problems(self.plan), [])
        found = self.plan_advice(self.plan)
        self.assertEqual([line.split(":", 1)[0] for line in found],
                         ["candidate.workPackages.w04", "candidate.workPackages.w05", "candidate.workPackages.w06"], found)
        observation = json.loads((LIVE / "t01-observation-top.json").read_text())
        named = [line.split("violating check ", 1)[1].split(" ", 1)[0] for line in found]
        self.assertEqual(len(set(named)), 3)
        slacks = [observation["checks"][key]["slack"]["value"] for key in named]
        self.assertEqual(slacks, sorted(slacks), "worst first")
        for line in found:
            self.assertIn("parked, but workerSlots is 6", line)
            self.assertIn("resolve-instances", line)

    def test_a_plan_filling_the_seats_with_disjoint_clusters_gets_no_advice(self):
        """The success path: w04..w06 take the next worst uncovered checks in their own leaf cells, and
        every remaining violating check goes into the targets of an active slot."""
        plan = copy.deepcopy(self.plan)
        packages = plan["candidate"]["workPackages"]
        observation = json.loads((LIVE / "t01-observation-top.json").read_text())
        clusters = {"w04": "swerv_dma_ctrl/GenFifo_3__fifo_done_bus_dff_dffsc_dout_reg_0_",
                    "w05": "swerv_dmi_wrapper_i_dmi_jtag_to_core_sync_rden_reg_0_",
                    "w06": "swerv_dmi_wrapper_i_dmi_jtag_to_core_sync_wren_reg_0_"}
        leaves = dict(MASTERS, **{cell: "SDFCNQD1BWP35P140" for cell in clusters.values()})
        _write(self.workspace / self.working["netlist"]["path"], standin_netlist(self.working["top"], leaves))
        read_atcs._netlist_hierarchy_cache.clear()
        for slot, cell in clusters.items():
            keys = sorted(key for key, check in observation["checks"].items() if check["endpoint"] == cell)
            packages[slot] = dict(copy.deepcopy(packages["w01"]), taskId=slot, problem=f"hold checks at {cell}",
                                  targets=keys, mayAffect=[], targetPins=[f"{cell}/D"],
                                  editDomain={"instances": [cell], "nets": [], "regions": []})
        for key, check in sorted(observation["checks"].items()):
            if not any(read_atcs._atcs_modules(self.workspace)["composition"].covers(
                    key, check["endpoint"], p["targets"], p["targetPins"]) for p in packages.values()):
                packages["w01"]["targets"].append(key)
        self.assertEqual(self.plan_problems(plan), [])
        self.assertEqual(self.plan_advice(plan), [])
        packages["w06"] = {"taskId": "w06", "baseStateId": self.working["id"], "parked": True,
                           "problem": "no cluster left"}
        self.assertEqual(self.plan_problems(plan), [], "parking is never refused")
        found = self.plan_advice(plan)
        self.assertEqual(len(found), 1, found)
        self.assertTrue(found[0].startswith("candidate.workPackages.w06: parked, but workerSlots is 6"), found)


def team_members(slot):
    team = CONTRACT.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("\n  - id: atcs-worker-", 1)[0]
    members = {}
    for block in team.split("      - id: ")[1:]:
        name = block.split("\n", 1)[0]
        members[name] = " ".join(block.split())
    return members


class OperatorLoopTest(unittest.TestCase):
    """Treatment attempt 1's w03 (Ledger #258, #271, #321; live_fixtures/t01-w03-team-results.json): the
    Researcher's falsifier said "atcs_undo and stop this cluster", the Reviewer approved 15 mutations, and
    the Operator sized once, undid it (rightly: the new master dropped the reset) and stopped with
    no-candidate-gains, 13 mutations unspent. The worker/aggregation principle (FABRIC G45): an undo is
    never a stop, the Operator tries freely inside its domain, and the Reviewer sharpens the plan with a
    wide default scope. RED on acb5d45f: no text said so."""

    def test_the_retained_w03_session_undid_its_one_trial_and_stopped(self):
        results = json.loads((LIVE / "t01-w03-team-results.json").read_text())
        operator = results["operator"]["output"]
        self.assertEqual((operator["stopReason"], operator["mutationReceipts"]), ("no-candidate-gains", ["w03r7"]))
        self.assertIn("atcs_undo", " ".join(operator["limitations"]))
        self.assertIn("stop this cluster", results["researcher"]["output"]["hypotheses"][0]["falsifier"])
        self.assertEqual(results["reviewer"]["output"]["scope"]["maxMutations"], 15)

    def test_the_knowledge_says_an_undo_is_never_a_stop_and_to_try_freely(self):
        text = " ".join((PACK_DIR / "knowledge" / "xtop-expert-operator.md").read_text().split())
        for words in ("then try the next rung", "an undo is never a stop", "Try freely inside your domain",
                      "no wrong attempt, only an unmeasured one", "every rung the scope allows"):
            self.assertIn(words, text)

    def test_each_team_carries_the_next_rung_and_the_wide_default_scope(self):
        for slot in SLOTS:
            members = team_members(slot)
            with self.subTest(slot=slot):
                self.assertIn("then try the next rung of the ladder", members["operator"])
                self.assertIn("an undo is never the end of the session", members["operator"])
                self.assertIn("no wrong attempt, only an unmeasured one", members["operator"])
                self.assertIn("never tell the Operator to stop after one undo", members["researcher"])
                reviewer = members["reviewer"]
                self.assertIn("sharpen the plan and record concerns", reviewer)
                self.assertIn("scope.commands defaults to every command of candidate.scope.commands", reviewer)
                self.assertIn("scope.maxMutations defaults to 50", reviewer)
                self.assertIn("never below 3", reviewer)
                example = json.loads(reviewer.split("Example reply (shape only): ", 1)[1].split("'", 1)[0])
                self.assertGreaterEqual(example["scope"]["maxMutations"], 3)
                self.assertIn("atcs_undo", example["scope"]["commands"])

    def test_the_recipe_cap_leaves_room_for_the_default(self):
        from atcs import workspaces
        self.assertGreaterEqual(workspaces.SCOPE_MAX_MUTATIONS, 50)
        for slot in SLOTS:
            operator = CONTRACT.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("reviewedAction:", 1)[1]
            self.assertIn(f"maxMutations: {workspaces.SCOPE_MAX_MUTATIONS}", operator.split("\n  - id:", 1)[0])

    def test_the_examples_list_every_toolkit_mutation(self):
        from atcs import workspaces
        text = (PACK_DIR / "knowledge" / "example-campaign-plan.md").read_text()
        plan = json.loads(text.split("```json\n", 1)[1].split("\n```", 1)[0])
        for slot, package in plan["candidate"]["workPackages"].items():
            with self.subTest(slot=slot):
                self.assertEqual(sorted(package["scope"]["commands"]), sorted(workspaces.MUTATE_COMMANDS))


if __name__ == "__main__":
    unittest.main()
