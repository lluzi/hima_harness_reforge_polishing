"""Proves the Workshop examples are declared knowledge the real Readers admit (Issue #63).

Live Run run-6de8b715 (Pack 0.2.0) had its first plan rejected with 41 schema errors;
live Run run-1ca6cdd3 (0.1.9) had a next-decision rejected because the `evaluate-next-
investment` purpose never stated the formats of `stateRef`/`observationRef`/`budgetRef`
(E019); T63 had a worker action naming a bare leaf instance a nested netlist rejects.

A Workshop can read only the knowledge files its contract entry declares (the Harness
resolves `workshop.knowledge` against the top-level `knowledge:` list and serves each
from the Pack's `knowledge/` through `hima_workshop_knowledge`). So each example lives
in exactly one place, a declared `knowledge/example-*.md` file holding one fenced
```json block, and this module parses that block and runs it through the real Reader
in `tools/read-atcs.py` -- the same `read_atcs.read(<kind>, report, workspace, extra)`
entry point the Harness uses.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_workshop_examples.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Recorded RED (first version, 16b0e58c): only the two wiring tests failed; the admission
tests passed once `examples/*.json` existed. Recorded RED (this version, on 8c936c2c):
all nine tests failed or errored because no `knowledge/example-*.md` existed and no
purpose named a knowledge file; a probe of the old `examples/*.json` showed the worker
candidate (bare leaf `U1`) differed from the plan's w01 (`u_a/reg0`), and that carrying
the plan's w01 into a worker request was rejected as not a hierarchical instance.

Recorded RED (slice 3 gap 1, on 18829968): RefusalTextTest and ProblemsDeliveryTest -- 14
errors (`read_atcs` had no `problems`, the Reader wrote no `.problems.txt`) and 7 failures
(no `<output>Problems` output, read or purpose for any of the seven request outputs).
Recorded RED (slice 3 gap 2, on 4b3af279): 19 errors and 1 failure across test_readers and this
module -- every malformed-shape, slot-taskId and w01-action case raised ValueError instead of
counting, and the Reader process exited 1 on a w01 request without `actions`; the ATCS contract
test failed on 110 !== 111 nodes (no retry-worker-01).
Recorded RED (slice 3 gap 3, on 2d3678a1): 3 failures and 4 errors -- neither
example-observation-request.md nor example-integration-plan.md existed, was declared, or was
named by its Workshop's purpose, and the purpose-field check had no example to read.
Recorded RED (slice 3 gap 6, on e4266f19): TeamRepairGuidanceTest -- 4 failures and 1 error: no
member taskTemplate held an example reply, and knowledge/agent-team.md was not declared.
"""
from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
KNOWLEDGE_DIR = PACK_DIR / "knowledge"
CONTRACT_PATH = PACK_DIR / "contract.yml"

sys.path.insert(0, str(TESTS_DIR))

# Reuse the repo's own fixture builders rather than a second copy of them.
from test_readers import READ_ATCS_PATH, _make_workspace, _build_design_state, _write, _write_xtop_context, read_atcs  # noqa: E402

from atcs import core  # noqa: E402

# Example knowledge file -> the Workshops whose purpose names it and must declare it.
EXAMPLE_WORKSHOPS = {
    "example-campaign-plan.md": ("plan-campaign",),
    "example-worker-request.md": ("research-worker-01", "research-worker-02", "research-worker-03"),
    "example-next-decision.md": ("evaluate-next-investment",),
    "example-observation-request.md": ("diagnose-and-observe",),
    "example-integration-plan.md": ("compose-contributions",),
}

# The nested netlist every example's baseState describes: leaf cells live inside
# sub-module instances, as in a real post-route netlist (T63), so a worker action
# must name `u_a/reg0`, never the bare leaf `reg0`.
EXAMPLE_NETLIST = (
    "module top;\n"
    "  BLOCK u_a (.A(a));\n"
    "  BLOCK u_b (.A(b));\n"
    "  BLOCK u_c (.A(c));\n"
    "endmodule\n"
    "module BLOCK;\n"
    "  DFQD1BWP35P140 reg0 (.D(d));\n"
    "  DFQD1BWP35P140 reg1 (.D(d));\n"
    "endmodule\n"
)

_FENCE_RE = re.compile(r"^```json\n(.*?)^```$", re.S | re.M)


def _load_example(name):
    """The one fenced ```json block of `knowledge/<name>`, parsed."""
    text = (KNOWLEDGE_DIR / name).read_text(encoding="utf-8")
    blocks = _FENCE_RE.findall(text)
    if len(blocks) != 1:
        raise AssertionError(f"knowledge/{name} must hold exactly one ```json block, found {len(blocks)}")
    return json.loads(blocks[0])


def _contract_text():
    return CONTRACT_PATH.read_text(encoding="utf-8")


def _declared_knowledge(contract_text):
    """File names under the contract's top-level `knowledge:` list."""
    match = re.search(r"^knowledge:\n(.*?)(?=^\S)", contract_text, re.S | re.M)
    if match is None:
        raise AssertionError("contract.yml has no top-level knowledge: list")
    return set(re.findall(r"^  - file: (\S+)$", match.group(1), re.M))


def _workshop(contract_text, workshop_id):
    """(purpose text, declared knowledge files) of one Workshop entry."""
    match = re.search(rf"^  - id: {re.escape(workshop_id)}\n(.*?)(?=^  - id: |\Z)", contract_text, re.S | re.M)
    if match is None:
        raise AssertionError(f"workshop {workshop_id} not found in contract.yml")
    body = match.group(1)
    purpose = re.search(r"^    purpose: >-\n(.*?)(?=^    \S)", body, re.S | re.M).group(1)
    knowledge = re.search(r"^    knowledge: \[(.*?)\]$", body, re.M)
    files = {f.strip() for f in knowledge.group(1).split(",")} if knowledge else set()
    return " ".join(purpose.split()), files


def _workshop_ids(contract_text):
    section = contract_text[contract_text.index("\nworkshops:\n"):]
    return re.findall(r"^  - id: (\S+)$", section, re.M)


class ExampleKnowledgeIsReachableTest(unittest.TestCase):
    """A purpose may point a Workshop only at knowledge it can actually open."""

    def test_every_knowledge_file_a_purpose_names_is_declared_and_present(self):
        text = _contract_text()
        declared = _declared_knowledge(text)
        named_any = False
        for workshop_id in _workshop_ids(text):
            purpose, files = _workshop(text, workshop_id)
            for name in re.findall(r"\bknowledge ([\w.-]+\.(?:md|txt|pdf))\b", purpose):
                named_any = True
                with self.subTest(workshop=workshop_id, file=name):
                    self.assertIn(name, declared, "not in the top-level knowledge: list")
                    self.assertIn(name, files, f"not in {workshop_id}'s own knowledge: list")
                    self.assertTrue((KNOWLEDGE_DIR / name).is_file(), f"knowledge/{name} is missing")
        self.assertTrue(named_any, "no purpose names a knowledge file")

    def test_each_example_is_named_and_declared_by_exactly_its_workshops(self):
        text = _contract_text()
        for name, workshop_ids in EXAMPLE_WORKSHOPS.items():
            for workshop_id in workshop_ids:
                purpose, files = _workshop(text, workshop_id)
                with self.subTest(workshop=workshop_id, file=name):
                    self.assertIn(f"knowledge {name}", purpose)
                    self.assertIn(name, files)

    def test_every_shipped_example_is_one_of_the_five(self):
        shipped = {p.name for p in KNOWLEDGE_DIR.glob("example-*")}
        self.assertEqual(shipped, set(EXAMPLE_WORKSHOPS))
        self.assertFalse((PACK_DIR / "examples").exists(), "examples/ is unreachable by a Workshop; ship knowledge instead")


def _all_keys(value):
    """Every object key at any depth of a parsed JSON document."""
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in _all_keys(v)}
    if isinstance(value, list):
        return {k for v in value for k in _all_keys(v)}
    return set()


# Fields each purpose names in prose lists rather than in a `{name: <...>}` skeleton.
PURPOSE_LISTED_FIELDS = {
    "plan-campaign": ("workPackages", "reason"),
    "research-worker-01": ("actions", "instance", "toMaster"),
    "diagnose-and-observe": ("designStateId", "precision", "requiredScenarios", "maxPaths", "nworst"),
    "compose-contributions": ("batchId", "baseStateId", "select", "resolutions", "deferred", "reason"),
    "evaluate-next-investment": (
        "stateRef", "observationRef", "budgetRef", "question", "action", "targets", "reason",
        "falsifier", "costBasis", "requiredArtifacts",
    ),
}


class PurposeFieldsMatchTheirExampleTest(unittest.TestCase):
    """A purpose and the example it points at never disagree on a field: every field the
    purpose tells the model to write is in the example (review re-check: the worker
    purposes demanded a `sessionPlan` the example and the Reader never had)."""

    def test_every_field_a_purpose_names_is_in_its_example(self):
        text = _contract_text()
        for name, workshop_ids in EXAMPLE_WORKSHOPS.items():
            keys = _all_keys(_load_example(name))
            for workshop_id in workshop_ids:
                purpose, _ = _workshop(text, workshop_id)
                # The document skeleton the purpose spells out: `{field: <...>, field: {...}}`.
                named = set(re.findall(r"[{,] ?(\w+): [<{]", purpose))
                listed = set(PURPOSE_LISTED_FIELDS.get(workshop_id, ()))
                for field in listed:
                    self.assertRegex(purpose, rf"\b{field}\b", f"{workshop_id}'s purpose no longer names {field}")
                self.assertTrue(named | listed, f"{workshop_id}'s purpose names no field")
                with self.subTest(workshop=workshop_id):
                    self.assertEqual(sorted((named | listed) - keys), [],
                                     f"{workshop_id}'s purpose names fields {name} does not contain")


class _HierarchicalFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace, netlist_text=EXAMPLE_NETLIST)
        _write(self.workspace / "state" / "working-state.json", json.dumps(self.design))
        _write_xtop_context(self.workspace, self.design)

    def _read(self, kind, name, document, extra=None):
        report = self.workspace / "research" / "requests" / name
        _write(report, json.dumps(document))
        values = read_atcs.read(kind, report, self.workspace, extra) if extra else read_atcs.read(kind, report, self.workspace)
        return {v["type"]: v["value"] for v in values}


class CampaignPlanExampleTest(_HierarchicalFixture):
    def test_campaign_plan_example_is_admitted_with_zero_problems(self):
        example = _load_example("example-campaign-plan.md")
        self.assertEqual(example["baseState"], self.design, "example baseState drifted from the fixture it documents")
        values = self._read("campaign-plan", "campaign-plan.json", example)
        self.assertEqual(values["tc_request_invalid_count"], 0)

    def test_active_slot_with_unusable_edit_domain_is_counted(self):
        """C23 (failure catalogue): PR02, PR03 and Fresh03 each lost 2-4 Workshop attempts on a
        plan whose edit domain named nothing XTop can size. Each slot of the 0.1.10 plan is an
        active worker, so its editDomain must name leaf cells of the base netlist by full path."""
        cases = (
            ([], "empty", "names no instance"),
            (["a"], "top port / net", "not an instance"),
            (["u_a"], "module instance", "module instance"),
            (["reg0"], "bare leaf", "not an instance"),
            (["u_z/reg9"], "absent", "not an instance"),
        )
        for instances, label, needle in cases:
            with self.subTest(label=label):
                document = _load_example("example-campaign-plan.md")
                document["candidate"]["workPackages"]["w01"]["editDomain"]["instances"] = instances
                document["candidate"]["workPackages"]["w01"]["protected"]["instances"] = []
                report = self.workspace / "research" / "requests" / "campaign-plan.json"
                _write(report, json.dumps(document))
                values = self._read("campaign-plan", "campaign-plan.json", document)
                found = read_atcs.problems("campaign-plan", report, self.workspace)
                self.assertEqual(values["tc_request_invalid_count"], len(found))
                self.assertEqual(len(found), 1, found)
                self.assertTrue(found[0].startswith("candidate.workPackages.w01.editDomain"), found)
                self.assertIn(needle, found[0])


class WorkerRequestExampleTest(_HierarchicalFixture):
    def test_worker_request_example_is_admitted_in_every_slot(self):
        example = _load_example("example-worker-request.md")
        self.assertEqual(example["baseState"], self.design, "example baseState drifted from the fixture it documents")
        for slot in ("w01", "w02", "w03"):
            with self.subTest(slot=slot):
                document = copy.deepcopy(example)
                document["candidate"]["taskId"] = slot
                values = self._read("worker-request", f"worker-request-{slot}.json", document, extra=[slot])
                self.assertEqual(values["tc_request_invalid_count"], 0)

    def test_worker_candidate_is_the_plan_examples_w01_package(self):
        """Carrying the plan's w01 package into a worker request, as the purposes say,
        is admitted -- the two examples teach one consistent shape."""
        plan = _load_example("example-campaign-plan.md")
        worker = _load_example("example-worker-request.md")
        w01 = plan["candidate"]["workPackages"]["w01"]
        self.assertEqual(worker["candidate"], w01)
        document = {"candidate": w01, "baseState": plan["baseState"],
                    "siteCapabilities": plan["siteCapabilities"], "actions": worker["actions"]}
        values = self._read("worker-request", "worker-request-w01.json", document, extra=["w01"])
        self.assertEqual(values["tc_request_invalid_count"], 0)

    def test_every_example_action_is_a_hierarchical_path_in_the_edit_domain(self):
        worker = _load_example("example-worker-request.md")
        domain = worker["candidate"]["editDomain"]["instances"]
        for action in worker["actions"]:
            self.assertIn("/", action["instance"])
            self.assertIn(action["instance"], domain)

    def test_bare_leaf_instance_is_rejected(self):
        """Pins T63: the example with each action (and its edit domain) cut to the bare
        leaf name -- the exact live failure shape -- is refused by the Reader."""
        document = _load_example("example-worker-request.md")
        leaves = [a["instance"].rsplit("/", 1)[-1] for a in document["actions"]]
        document["candidate"]["editDomain"]["instances"] = leaves
        for action, leaf in zip(document["actions"], leaves):
            action["instance"] = leaf
        values = self._read("worker-request", "worker-request-w01.json", document, extra=["w01"])
        # Each bare leaf is refused twice: in the edit domain (C23) and as the action's instance.
        self.assertEqual(values["tc_request_invalid_count"], 2 * len(leaves))


# Every Reader-owned request kind, its contract output, and the output its itemized
# problems are delivered through (Issue #63 gap 1: the owner saw only "41").
REQUEST_OUTPUTS = {
    "observationRequest": ("diagnose-and-observe", "research/requests/observation-request.json"),
    "campaignPlan": ("plan-campaign", "research/requests/campaign-plan.json"),
    "workerRequest01": ("research-worker-01", "research/requests/worker-request-w01.json"),
    "workerRequest02": ("research-worker-02", "research/requests/worker-request-w02.json"),
    "workerRequest03": ("research-worker-03", "research/requests/worker-request-w03.json"),
    "integrationPlan": ("compose-contributions", "research/requests/integration-plan.json"),
    "nextDecision": ("evaluate-next-investment", "research/requests/next-decision.json"),
}


def _output_block(contract_text, name):
    match = re.search(rf"^  - name: {re.escape(name)}\n(.*?)(?=^  - name: |^\S)", contract_text, re.S | re.M)
    return None if match is None else match.group(1)


def _workshop_reads(contract_text, workshop_id):
    match = re.search(rf"^  - id: {re.escape(workshop_id)}\n(.*?)(?=^  - id: |\Z)", contract_text, re.S | re.M)
    reads = re.search(r"^    reads: \[(.*?)\]$", match.group(1), re.M)
    return {r.strip() for r in reads.group(1).split(",")} if reads else set()


class RefusalTextTest(_HierarchicalFixture):
    """Issue #63 gap 1: a refused request reaches its owner as one line per problem, each
    naming the field (and the slot, for a slot-scoped document) and what it must be, and
    the Reader's tc_request_invalid_count is exactly the number of those lines -- one
    source, `read_atcs.problems`, for both. Each case mutates a shipped example into a
    live error class (the 41-error plan of run-6de8b715, T63's bare leaf)."""

    FIELD_FIRST = re.compile(r"^[A-Za-z][\w.\[\]-]*(?: \(slot w0[123]\))?: \S")

    def _problems(self, kind, name, document, slot=None):
        report = self.workspace / "research" / "requests" / name
        _write(report, json.dumps(document))
        found = read_atcs.problems(kind, report, self.workspace, slot)
        extra = [slot] if slot else None
        values = {v["type"]: v["value"] for v in read_atcs.read(kind, report, self.workspace, extra)}
        self.assertEqual(values["tc_request_invalid_count"], len(found), found)
        for text in found:
            self.assertRegex(text, self.FIELD_FIRST, "a problem starts with the field it is about")
        return found

    def _one(self, found, *needles):
        self.assertEqual(len(found), 1, found)
        for needle in needles:
            self.assertIn(needle, found[0])
        return found[0]

    # --- campaign plan -------------------------------------------------------------
    def _plan(self):
        return _load_example("example-campaign-plan.md")

    def test_example_plan_has_no_problems(self):
        self.assertEqual(self._problems("campaign-plan", "campaign-plan.json", self._plan()), [])

    def test_top_level_work_packages_names_the_one_allowed_copy(self):
        plan = self._plan()
        plan["workPackages"] = copy.deepcopy(plan["candidate"]["workPackages"])
        self._one(self._problems("campaign-plan", "campaign-plan.json", plan),
                  "workPackages", "candidate.workPackages")

    def test_stale_base_state_names_the_working_state(self):
        other = _build_design_state(self.workspace, name="other", netlist_text=EXAMPLE_NETLIST)
        _write(self.workspace / "state" / "working-state.json", json.dumps(other))
        found = self._problems("campaign-plan", "campaign-plan.json", self._plan())
        self._one(found, "baseState", "state/working-state.json", other["id"])

    def test_missing_budget_names_slot_field_and_format(self):
        plan = self._plan()
        del plan["candidate"]["workPackages"]["w03"]["budget"]
        text = self._one(self._problems("campaign-plan", "campaign-plan.json", plan),
                         "candidate.workPackages.w03", "budget", "xtopMinutes")
        self.assertNotIn("w01", text)

    def test_wrong_action_kind_names_slot_and_the_allowed_kinds(self):
        plan = self._plan()
        plan["candidate"]["workPackages"]["w02"]["actions"] = ["resize_cell"]
        self._one(self._problems("campaign-plan", "campaign-plan.json", plan),
                  "candidate.workPackages.w02", "actions", "'resize_cell'", "size_cell")

    def test_missing_slot_and_blank_reason_are_named(self):
        plan = self._plan()
        del plan["candidate"]["workPackages"]["w03"]
        plan["candidate"]["reason"] = " "
        found = self._problems("campaign-plan", "campaign-plan.json", plan)
        self.assertEqual(len(found), 2, found)
        self.assertTrue(any(t.startswith("candidate.workPackages.w03") for t in found), found)
        self.assertTrue(any(t.startswith("candidate.reason") for t in found), found)

    def test_the_five_error_plan_lists_five_lines(self):
        """The audit's probe: wrong w01 baseStateId, w02 resize_cell, w03 missing problem
        and budget, and a top-level workPackages -- five problems, five lines."""
        plan = self._plan()
        packages = plan["candidate"]["workPackages"]
        packages["w01"]["baseStateId"] = "0" * 20
        packages["w02"]["actions"] = ["resize_cell"]
        del packages["w03"]["problem"]
        del packages["w03"]["budget"]
        plan["workPackages"] = copy.deepcopy(packages)
        found = self._problems("campaign-plan", "campaign-plan.json", plan)
        self.assertEqual(len(found), 5, found)
        for slot, needle in (("w01", "baseStateId"), ("w02", "actions"), ("w03", "problem"), ("w03", "budget")):
            self.assertTrue(any(t.startswith(f"candidate.workPackages.{slot}") and needle in t for t in found),
                            f"{slot}/{needle} not named: {found}")

    # --- worker requests -----------------------------------------------------------
    def _worker(self, slot):
        document = _load_example("example-worker-request.md")
        document["candidate"]["taskId"] = slot
        return document

    def test_worker_missing_budget_and_wrong_kind_name_their_slot(self):
        for slot in ("w01", "w02", "w03"):
            with self.subTest(slot=slot):
                document = self._worker(slot)
                del document["candidate"]["budget"]
                document["candidate"]["actions"] = ["resize_cell"]
                found = self._problems("worker-request", f"worker-request-{slot}.json", document, slot)
                self.assertEqual(len(found), 2, found)
                for text in found:
                    self.assertIn(f"slot {slot}", text)
                self.assertTrue(any("budget" in t and "xtopMinutes" in t for t in found), found)
                self.assertTrue(any("'resize_cell'" in t for t in found), found)

    def test_bare_leaf_names_the_action_slot_and_the_full_path_form(self):
        document = self._worker("w01")
        leaves = [a["instance"].rsplit("/", 1)[-1] for a in document["actions"]]
        document["candidate"]["editDomain"]["instances"] = leaves
        for action, leaf in zip(document["actions"], leaves):
            action["instance"] = leaf
        found = self._problems("worker-request", "worker-request-w01.json", document, "w01")
        self.assertEqual(len(found), 2 * len(leaves), found)
        domain = [t for t in found if t.startswith("candidate.editDomain.instances (slot w01)")]
        self.assertEqual(len(domain), len(leaves), found)
        found = [t for t in found if t.startswith("actions[")]
        for index, (text, leaf) in enumerate(zip(found, leaves)):
            self.assertTrue(text.startswith(f"actions[{index}].instance (slot w01): {leaf!r} is not a hierarchical"), text)
            self.assertIn("u_a/reg0", text)

    def test_worker_actions_missing_is_named_not_raised(self):
        document = self._worker("w01")
        del document["actions"]
        self._one(self._problems("worker-request", "worker-request-w01.json", document, "w01"),
                  "actions (slot w01)", "{instance, toMaster}")

    # --- observation request and integration plan ----------------------------------
    def test_observation_request_names_each_field(self):
        document = {"designStateId": self.design["id"], "precision": "fast", "maxPaths": "1000", "nworst": 1}
        found = self._problems("observation-request", "observation-request.json", document)
        self.assertEqual(len(found), 3, found)
        for field, needle in (("precision", "'gba' or 'pba'"), ("maxPaths", "positive integer"),
                              ("requiredScenarios", "non-empty list")):
            self.assertTrue(any(t.startswith(field) and needle in t for t in found), f"{field}: {found}")

    def test_integration_plan_names_each_field(self):
        facts = core.stamp("composition-facts", {
            "baseStateId": "a" * 20, "considered": ["c1"], "duplicates": [], "conflicts": [],
            "interactions": [], "staleBase": [], "order": ["c1"], "unresolvedCount": 0,
        })
        plan = {"batchId": "b1", "baseStateId": "b" * 20, "select": ["c9"], "resolutions": [],
                "deferred": [], "reason": "x"}
        found = self._problems("integration-plan", "integration-plan.json", {"plan": plan, "facts": facts})
        self.assertEqual(len(found), 2, found)
        self.assertTrue(any(t.startswith("plan.baseStateId") for t in found), found)
        self.assertTrue(any(t.startswith("plan.select") and "'c9'" in t for t in found), found)


class ProblemsDeliveryTest(_HierarchicalFixture):
    """The itemized list reaches the owner: the Reader process writes it beside the
    document it read, as `<document>.problems.txt`, and the producing Workshop declares
    that file as a readable output its purpose points at."""

    def _run(self, kind, name, document, extra=()):
        report = self.workspace / "research" / "requests" / name
        _write(report, json.dumps(document))
        out = self.workspace / "out.json"
        if out.exists():
            out.unlink()
        result = subprocess.run(
            [sys.executable, str(READ_ATCS_PATH), kind, str(report), str(out), str(self.workspace), *extra],
            capture_output=True, text=True,
        )
        sidecar = report.with_name(report.name[: -len(".json")] + ".problems.txt")
        return result, out, sidecar

    def test_a_refused_plan_leaves_one_line_per_problem_and_a_fixed_plan_clears_it(self):
        plan = _load_example("example-campaign-plan.md")
        plan["candidate"]["workPackages"]["w02"]["actions"] = ["resize_cell"]
        del plan["candidate"]["workPackages"]["w03"]["budget"]
        result, out, sidecar = self._run("campaign-plan", "campaign-plan.json", plan)
        self.assertEqual(result.returncode, 0, result.stderr)
        count = json.loads(out.read_text())["values"][0]["value"]
        lines = sidecar.read_text(encoding="utf-8").splitlines()
        self.assertEqual(count, 2)
        self.assertIn("2 problem", lines[0])
        items = [line[2:] for line in lines if line.startswith("- ")]
        self.assertEqual(items, read_atcs.problems("campaign-plan", sidecar.with_name("campaign-plan.json"), self.workspace))

        result, out, sidecar = self._run("campaign-plan", "campaign-plan.json", _load_example("example-campaign-plan.md"))
        self.assertEqual(result.returncode, 0, result.stderr)
        text = sidecar.read_text(encoding="utf-8")
        self.assertIn("0 problems", text)
        self.assertNotIn("- ", text)

    def test_a_document_the_reader_cannot_read_names_why(self):
        plan = _load_example("example-campaign-plan.md")
        plan["baseState"]["top"] = "edited"  # its id no longer matches its body
        result, out, sidecar = self._run("campaign-plan", "campaign-plan.json", plan)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(out.exists())
        self.assertIn("id mismatch", sidecar.read_text(encoding="utf-8"))

    def test_every_request_output_has_a_problems_output_its_workshop_reads(self):
        text = _contract_text()
        for output, (workshop_id, path) in REQUEST_OUTPUTS.items():
            with self.subTest(output=output):
                sidecar_name = output + "Problems"
                block = _output_block(text, sidecar_name)
                self.assertIsNotNone(block, f"no {sidecar_name} output")
                self.assertIn(f"path: {path[: -len('.json')]}.problems.txt", block)
                self.assertNotIn("reader:", block)
                self.assertIn(sidecar_name, _workshop_reads(text, workshop_id))
                purpose, _ = _workshop(text, workshop_id)
                self.assertIn(f"output {sidecar_name}", purpose)


class ObservationRequestExampleTest(_HierarchicalFixture):
    """Issue #63 gap 3: diagnose-and-observe had only purpose prose for its document."""

    def test_observation_request_example_is_admitted_for_the_working_state(self):
        example = _load_example("example-observation-request.md")
        self.assertEqual(example["designStateId"], self.design["id"], "names the working design-state it observes")
        self.assertEqual(self._read("observation-request", "observation-request.json", example),
                         {"tc_request_invalid_count": 0})


def _example_facts():
    """The composition facts example-integration-plan.md embeds: three slot Contributions
    against the examples' common base, w01 and w02 sizing the same instance differently."""
    ids = {slot: core.digest({"example-contribution": slot}) for slot in ("w01", "w02", "w03")}
    members = sorted([ids["w01"], ids["w02"]])
    conflict = {"key": "same-instance-different-master|" + ",".join(members) + "|u_a/reg0",
                "kind": "same-instance-different-master", "contributions": members, "objects": ["u_a/reg0"]}
    facts = core.stamp("composition-facts", {
        "baseStateId": "3956975ce47374c313fc", "considered": [ids["w01"], ids["w02"], ids["w03"]],
        "duplicates": [], "conflicts": [conflict], "interactions": [], "staleBase": [],
        "order": [ids["w01"], ids["w02"], ids["w03"]], "unresolvedCount": 1, "unknownResolutions": [],
    })
    return facts, ids


class IntegrationPlanExampleTest(_HierarchicalFixture):
    """Issue #63 gap 3: compose-contributions had only purpose prose for its document."""

    def test_integration_plan_example_is_admitted_against_its_facts(self):
        example = _load_example("example-integration-plan.md")
        facts, ids = _example_facts()
        self.assertEqual(example["facts"], facts, "example facts drifted from the fixture it documents")
        self.assertEqual(example["plan"]["baseStateId"], self.design["id"])
        values = self._read("integration-plan", "integration-plan.json", example)
        self.assertEqual(values, {"tc_request_invalid_count": 0,
                                  "tc_selected_contribution_count": len(example["plan"]["select"])})
        self.assertEqual(example["plan"]["resolutions"][0]["conflictKey"], facts["conflicts"][0]["key"])

    def test_dropping_the_resolution_leaves_the_conflict_counted(self):
        example = _load_example("example-integration-plan.md")
        example["plan"]["select"] = list(example["facts"]["considered"])
        example["plan"]["resolutions"] = []
        example["plan"]["deferred"] = []
        values = self._read("integration-plan", "integration-plan.json", example)
        self.assertEqual(values["tc_request_invalid_count"], 1)


def _team_members(contract_text):
    """`{role: (taskTemplate text, resultSchema id, required fields)}` of the worker Team."""
    section = contract_text[contract_text.index("\nagentTeams:\n"):contract_text.index("\nworkshops:\n")]
    members = {}
    for match in re.finditer(r"^      - id: (\w+)\n(.*?)(?=^      - id: |\Z)", section, re.S | re.M):
        body = match.group(2)
        folded = re.search(r"^        taskTemplate: >-\n((?:^          .*\n)+)", body, re.M)
        plain = re.search(r"^        taskTemplate: (?!>-)(.*)$", body, re.M)
        template = " ".join(folded.group(1).split()) if folded else plain.group(1)
        schema = re.search(r"^          id: (\S+)$", body, re.M).group(1)
        required = [f.strip() for f in re.search(r"^          required: \[(.*)\]$", body, re.M).group(1).split(",")]
        members[match.group(1)] = (template, schema, required)
    return members


class TeamRepairGuidanceTest(unittest.TestCase):
    """Issue #63 gap 6: the Team's format guidance must reach the model that needs it. Each
    member's taskTemplate (the child's own prompt) carries one example reply with every
    required field, and knowledge/agent-team.md, which tells the owner to spend the one
    same-child follow-up on a formatting refusal, is declared knowledge the owner can search."""

    def test_each_member_template_holds_one_example_reply_with_its_required_fields(self):
        members = _team_members(_contract_text())
        self.assertEqual(sorted(members), ["operator", "researcher", "reviewer"])
        for role, (template, schema, required) in members.items():
            with self.subTest(role=role):
                match = re.search(r"Example reply \(shape only\): (\{.*\})\s*$", template)
                self.assertIsNotNone(match, f"{role}'s taskTemplate has no example reply")
                example = json.loads(match.group(1))
                self.assertEqual(example["schema"], schema)
                self.assertEqual(sorted(example), sorted(required), f"{role}'s example fields")

    def test_reviewer_example_arguments_are_the_typed_command_minus_the_host_hash(self):
        text = _contract_text()
        template = _team_members(text)["reviewer"][0]
        example = json.loads(re.search(r"Example reply \(shape only\): (\{.*\})\s*$", template).group(1))
        declared = re.search(r"^        atcs_size_cell: \[(.*)\]$", text, re.M).group(1)
        names = re.findall(r"name: (\w+)", declared)
        self.assertEqual(example["command"], "atcs_size_cell")
        self.assertEqual(sorted(example["arguments"]), sorted(n for n in names if n != "planSha256"))
        worker = _load_example("example-worker-request.md")
        self.assertIn(example["arguments"], worker["actions"], "the example reviews an action of the worker example")

    def test_agent_team_guidance_is_declared_knowledge(self):
        self.assertIn("agent-team.md", _declared_knowledge(_contract_text()))


class WorkerActionMasterReaderTest(_HierarchicalFixture):
    """C13 (failure catalogue): a worker action's toMaster must be a cell of this design's
    libraries with the same function and VT as the cell it resizes. Before, NO_SUCH_CELL,
    DFQD2BWP12T (a live "Library cell not found") and a buffer for a flop were all admitted
    and XTop was spent for no effect. The library is the Site's, as the Pack's own `observe`
    sealed it in state/xtop-context.json (the file prepare-workers re-verifies before XTop)."""

    def _master(self, to_master):
        document = _load_example("example-worker-request.md")
        document["actions"][0]["toMaster"] = to_master
        report = self.workspace / "research" / "requests" / "worker-request-w01.json"
        _write(report, json.dumps(document))
        values = self._read("worker-request", "worker-request-w01.json", document, extra=["w01"])
        found = read_atcs.problems("worker-request", report, self.workspace, "w01")
        self.assertEqual(values["tc_request_invalid_count"], len(found))
        return found

    def test_a_same_function_same_vt_size_is_admitted(self):
        self.assertEqual(self._master("DFQD2BWP35P140"), [])

    def test_a_master_outside_the_libraries_is_refused(self):
        for master in ("NO_SUCH_CELL", "DFQD2BWP12T"):
            with self.subTest(master=master):
                found = self._master(master)
                self.assertEqual(len(found), 1, found)
                self.assertTrue(found[0].startswith("actions[0].toMaster (slot w01)"), found)
                self.assertIn("is not a cell of this design's libraries", found[0])

    def test_a_master_of_another_function_is_refused(self):
        found = self._master("BUFFD4BWP35P140")
        self.assertEqual(len(found), 1, found)
        self.assertIn("changes cell function", found[0])
        self.assertIn("'DFQ'", found[0])

    def test_a_master_of_another_vt_is_refused(self):
        found = self._master("DFQD2BWP35P140LVT")
        self.assertEqual(len(found), 1, found)
        self.assertIn("changes VT", found[0])

    def test_the_current_master_is_refused_as_no_change(self):
        found = self._master("DFQD1BWP35P140")
        self.assertEqual(len(found), 1, found)
        self.assertIn("already", found[0])

    def test_without_a_sealed_library_context_the_master_is_not_admitted(self):
        (self.workspace / "state" / "xtop-context.json").unlink()
        found = self._master("DFQD2BWP35P140")
        self.assertEqual(len(found), 1, found)
        self.assertIn("state/xtop-context.json", found[0])

    def test_a_context_for_another_design_state_is_not_used(self):
        other = _build_design_state(self.workspace, name="other", netlist_text=EXAMPLE_NETLIST)
        _write_xtop_context(self.workspace, other)
        found = self._master("DFQD2BWP35P140")
        self.assertEqual(len(found), 1, found)
        self.assertIn("another design state", found[0])


class NextDecisionExampleTest(unittest.TestCase):
    """The `next-decision` Reader is where the live run-1ca6cdd3 rejection (E019) came from."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.state_ref = core.digest({"marker": "state"})
        self.observation_ref = core.digest({"marker": "observation"})
        _write(self.workspace / "state" / "observation.json",
               json.dumps({"schema": "atcs.observation-set/1", "id": self.observation_ref, "marker": "observation"}))
        _write(self.workspace / "state" / "working-state.json",
               json.dumps({"schema": "atcs.design-state/1", "id": self.state_ref, "marker": "state"}))

    def test_next_decision_example_is_admitted_and_names_observe(self):
        example = _load_example("example-next-decision.md")
        self.assertEqual(example["stateRef"], self.state_ref)
        self.assertEqual(example["observationRef"], self.observation_ref)
        report = self.workspace / "research" / "requests" / "next-decision.json"
        _write(report, json.dumps(example))
        by_type = {v["type"]: v["value"] for v in read_atcs.read("next-decision", report, self.workspace)}
        self.assertEqual(by_type["tc_request_invalid_count"], 0)
        self.assertEqual(by_type["tc_next_action"], 1)  # "observe"
        self.assertEqual(by_type["tc_stop_required"], 0)


if __name__ == "__main__":
    unittest.main()
