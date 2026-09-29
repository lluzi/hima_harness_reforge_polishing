"""Regressions from the real-model Workshop probe (Issue #63, `notes/model-probe-report.md`).

Each test reads a document the real model wrote (copied unchanged into `probe_fixtures/`, see its
README) through the shipped Reader. The Reader runs with the probe's two stand-ins, because the
design-state bytes live only on the Site: it skips the design-state file re-hash, and it walks the
546 instance paths the probe proved from retained PR03 data instead of the netlist.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_probe_regressions.py -v
"""
from __future__ import annotations

import copy
import importlib.util
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PACK_DIR = TESTS_DIR.parent.parent
FIXTURES = TESTS_DIR / "probe_fixtures"
sys.path.insert(0, str(TESTS_DIR))

from test_readers import READ_ATCS_PATH, _make_workspace, _write  # noqa: E402


def _fixture(name):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _probe_reader(cell_of=None):
    """A private copy of the shipped Reader with the probe's stand-ins (see module docstring).

    `cell_of` gives some proven instances their real cell type (from the retained Team input's
    researcher `fromMaster`); every other proven instance is a leaf of unknown type.
    """
    spec = importlib.util.spec_from_file_location("read_atcs_probe", READ_ATCS_PATH)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    known = _fixture("known-instances.json")
    cell_of = cell_of or {}

    def hierarchy(_netlist_path):
        tree = {}
        for name in known["instances"]:
            segments = reader._split_instance_path(name)
            if not segments or any(segment == "" for segment in segments):
                continue
            module = known["top"]
            for index, segment in enumerate(segments):
                level = tree.setdefault(module, {})
                if index == len(segments) - 1:
                    level.setdefault(segment, cell_of.get(name, "~leaf"))
                else:
                    child = module + "/" + segment
                    level[segment] = child
                    tree.setdefault(child, {})
                    module = child
        return tree

    reader._verify_design_state_refs = lambda design_state, workspace, core: None
    reader._netlist_hierarchy = hierarchy
    return reader


class _ProbeFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _read(self, reader, kind, name, document, slot=None):
        report = self.workspace / "research" / "requests" / name
        _write(report, json.dumps(document))
        found = reader.problems(kind, report, self.workspace, slot)
        values = {v["type"]: v["value"] for v in reader.read(kind, report, self.workspace, [slot] if slot else None)}
        self.assertEqual(values["tc_request_invalid_count"], len(found), found)
        return found


class EmptyWorkerActionsTest(_ProbeFixture):
    """Probe refusal 1: research-worker-01 attempt 2 could not resolve masters and wrote
    `"actions": []`. The Reader raised `worker actions must contain one to three sizing candidates`,
    which spends the Retry allowance and parks the Run. Slice 3 (2d3678a1) made it a count."""

    def test_the_probes_empty_actions_request_is_counted_not_raised(self):
        document = _fixture("worker-request-w01-attempt-2.json")
        self.assertEqual(document["actions"], [])
        found = self._read(_probe_reader(), "worker-request", "worker-request-w01.json", document, "w01")
        self.assertIn("actions (slot w01): must be a list of one to three {instance, toMaster} size_cell "
                      "candidates, each instance in candidate.editDomain.instances; got 0 entries", found)

    def test_the_worker_purpose_and_example_say_to_exit_non_zero_instead(self):
        """The cheapest honest equivalent of a no-fix request: no admissible w01 request can
        carry zero actions (operate-worker-01's Team reviews one of them), so the Workshop's
        entry exits non-zero with the reason, a coding diagnostic its owner revises."""
        contract = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        body = " ".join(contract.split("  - id: research-worker-01\n", 1)[1].split("\n  - id: ", 1)[0].split())
        rule = "If no safe size_cell action can be resolved, exit non-zero printing the reason; never write an empty or placeholder actions list."
        self.assertIn(rule, body)
        example = (PACK_DIR / "knowledge" / "example-worker-request.md").read_text(encoding="utf-8")
        self.assertIn(rule, " ".join(example.split()))


if __name__ == "__main__":
    unittest.main()
