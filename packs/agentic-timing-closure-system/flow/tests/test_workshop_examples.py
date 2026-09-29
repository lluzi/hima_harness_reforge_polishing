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
"""
from __future__ import annotations

import copy
import json
import re
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
from test_readers import _make_workspace, _build_design_state, _write, read_atcs  # noqa: E402

from atcs import core  # noqa: E402

# Example knowledge file -> the Workshops whose purpose names it and must declare it.
EXAMPLE_WORKSHOPS = {
    "example-campaign-plan.md": ("plan-campaign",),
    "example-worker-request.md": ("research-worker-01", "research-worker-02", "research-worker-03"),
    "example-next-decision.md": ("evaluate-next-investment",),
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

    def test_every_shipped_example_is_one_of_the_three(self):
        shipped = {p.name for p in KNOWLEDGE_DIR.glob("example-*")}
        self.assertEqual(shipped, set(EXAMPLE_WORKSHOPS))
        self.assertFalse((PACK_DIR / "examples").exists(), "examples/ is unreachable by a Workshop; ship knowledge instead")


class _HierarchicalFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace, netlist_text=EXAMPLE_NETLIST)
        _write(self.workspace / "state" / "working-state.json", json.dumps(self.design))

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
        with self.assertRaisesRegex(ValueError, "not a hierarchical instance"):
            self._read("worker-request", "worker-request-w01.json", document, extra=["w01"])


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
