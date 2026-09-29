"""Proves `examples/*.json` are exact, Reader-admitted documents (Issue #63 slice 1).

Live Run run-6de8b715 (Pack 0.2.0) had its first plan rejected with 41 schema errors;
live Run run-1ca6cdd3 (0.1.9) had a next-decision rejected because the `evaluate-next-
investment` purpose never states the formats of `stateRef`/`observationRef`/`budgetRef`
(E019). `contract.yml`'s purposes described these schemas only in prose, so the model
guessed. This module is the RED/GREEN proof that `packs/agentic-timing-closure-system/
examples/*.json` (which those purposes now point Workshops at) are documents the real
Reader in `tools/read-atcs.py` actually admits -- not just prose that looks right.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_workshop_examples.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Before this file existed (RED), every `test_*_example_is_admitted` case below failed
with `FileNotFoundError` -- `examples/` did not exist yet.
"""
from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
EXAMPLES_DIR = PACK_DIR / "examples"
CONTRACT_PATH = PACK_DIR / "contract.yml"

sys.path.insert(0, str(TESTS_DIR))

# Reuse the real repo's own fixture builders (`_make_workspace`/`_build_design_state`)
# rather than hand-rolling a second copy of them -- these are exactly what produce the
# deterministic identities `examples/README.md` documents.
from test_readers import _make_workspace, _build_design_state, _write, read_atcs  # noqa: E402

from atcs import core  # noqa: E402


def _load_example(name):
    path = EXAMPLES_DIR / name
    if not path.is_file():
        raise FileNotFoundError(f"missing example file: {path}")
    return json.loads(path.read_text(encoding="utf-8")), path


class ExampleFilesAreWiredIntoPurposesTest(unittest.TestCase):
    """Every `examples/<file>.json` this Pack ships is actually pointed at by a
    Workshop purpose in `contract.yml` -- an example nobody reads is not a fix."""

    def test_every_example_file_is_named_in_a_purpose(self):
        contract_text = CONTRACT_PATH.read_text(encoding="utf-8")
        referenced = set(re.findall(r"examples/([\w.-]+\.json)", contract_text))
        shipped = {p.name for p in EXAMPLES_DIR.glob("*.json")}
        self.assertTrue(shipped, "no example files shipped under examples/")
        self.assertEqual(
            shipped, referenced,
            f"examples/ and contract.yml purposes disagree: shipped={shipped} referenced={referenced}",
        )

    def test_five_purposes_point_at_an_example(self):
        contract_text = CONTRACT_PATH.read_text(encoding="utf-8")
        for workshop_id in (
            "plan-campaign", "research-worker-01", "research-worker-02",
            "research-worker-03", "evaluate-next-investment",
        ):
            match = re.search(rf"id: {workshop_id}\n(.*?)\n    directory:", contract_text, re.S)
            self.assertIsNotNone(match, f"workshop {workshop_id} not found in contract.yml")
            self.assertIn("examples/", match.group(1), f"{workshop_id}'s purpose does not point at an example")


class CampaignPlanExampleTest(unittest.TestCase):
    """`examples/campaign-plan.json` is exactly what `plan-campaign` must write --
    proved by running it through the real `campaign-plan` Reader."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        # Deterministic fixture: default args always produce id 17adadf2abdce4a6d351
        # (see `examples/README.md`), matching the example file's own `baseState`/
        # `baseStateId` values byte-for-byte.
        self.design = _build_design_state(self.workspace)
        _write(self.workspace / "state" / "working-state.json", json.dumps(self.design))

    def test_example_id_matches_the_fixture_it_documents(self):
        self.assertEqual(self.design["id"], "17adadf2abdce4a6d351")

    def test_campaign_plan_example_is_admitted_with_zero_problems(self):
        example, _ = _load_example("campaign-plan.json")
        self.assertEqual(example["baseState"], self.design, "example baseState drifted from the fixture it documents")
        report = self.workspace / "research" / "requests" / "campaign-plan.json"
        _write(report, json.dumps(example))
        values = read_atcs.read("campaign-plan", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)


class WorkerRequestExampleTest(unittest.TestCase):
    """`examples/worker-request.json` is exactly what `research-worker-01` must write --
    proved by running it through the real `worker-request` Reader."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace)

    def test_worker_request_example_is_admitted_with_zero_problems(self):
        example, _ = _load_example("worker-request.json")
        self.assertEqual(example["baseState"], self.design, "example baseState drifted from the fixture it documents")
        report = self.workspace / "research" / "requests" / "worker-request-w01.json"
        _write(report, json.dumps(example))
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)


class NextDecisionExampleTest(unittest.TestCase):
    """`examples/next-decision.json` is exactly what `evaluate-next-investment` must
    write -- proved by running it through the real `next-decision` Reader, which is
    also where the live Run run-1ca6cdd3 rejection (E019) came from."""

    def setUp(self):
        import tempfile
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.state_ref = core.digest({"marker": "state"})
        self.observation_ref = core.digest({"marker": "observation"})
        _write(self.workspace / "flow" / "records" / "observation.json",
               json.dumps({"schema": "atcs.observation-set/1", "id": self.observation_ref, "marker": "observation"}))
        _write(self.workspace / "state" / "working-state.json",
               json.dumps({"schema": "atcs.design-state/1", "id": self.state_ref, "marker": "state"}))

    def test_refs_match_the_fixture_they_document(self):
        self.assertEqual(self.state_ref, "62a80a2154c907c13526")
        self.assertEqual(self.observation_ref, "de4af36c311de90baad2")

    def test_next_decision_example_is_admitted_and_names_observe(self):
        example, _ = _load_example("next-decision.json")
        self.assertEqual(example["stateRef"], self.state_ref)
        self.assertEqual(example["observationRef"], self.observation_ref)
        report = self.workspace / "research" / "requests" / "next-decision.json"
        _write(report, json.dumps(example))
        values = read_atcs.read("next-decision", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)
        self.assertEqual(by_type["tc_next_action"]["value"], 1)  # "observe"
        self.assertEqual(by_type["tc_stop_required"]["value"], 0)


if __name__ == "__main__":
    unittest.main()
