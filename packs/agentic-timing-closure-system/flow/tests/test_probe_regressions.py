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

from atcs import core  # noqa: E402


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
                      "candidates, each instance in candidate.editDomain.instances; got 0 entries; when none "
                      "is safe, write \"actions\": [] with a top-level \"noSafeAction\" reason", found)

    def test_the_worker_purpose_and_example_say_how_to_state_no_safe_action(self):
        """Review 2 (I2) replaced "exit non-zero": a non-zero Workshop exit retries without limit in
        one generation. An empty list with its noSafeAction reason is admitted and reaches
        decide-next (test_success_paths.NoSafeActionTest)."""
        contract = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        body = " ".join(contract.split("  - id: research-worker-01\n", 1)[1].split("\n  - id: ", 1)[0].split())
        rule = ('If no safe size_cell action can be resolved, write "actions": [] and a top-level "noSafeAction" '
                "string stating why; the Reader admits that request and it goes to evaluate-next-investment "
                "instead of the Team.")
        self.assertIn(rule, body)
        example = (PACK_DIR / "knowledge" / "example-worker-request.md").read_text(encoding="utf-8")
        self.assertIn(rule, " ".join(example.split()))


def _reviewer_template():
    contract = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
    team = contract[contract.index("\nagentTeams:\n"):contract.index("\nworkshops:\n")]
    body = team.split("      - id: reviewer\n", 1)[1].split("\n      - id: ", 1)[0]
    folded = re.search(r"^        taskTemplate: >-\n((?:^          .*\n)+)", body, re.M)
    required = [f.strip() for f in re.search(r"^          required: \[(.*)\]$", body, re.M).group(1).split(",")]
    return " ".join(folded.group(1).split()), required


def _reviewer_format_problems(reply):
    """The reviewer taskTemplate's format rules, as checks (probe refusal 2)."""
    found = []
    for field, value in reply.items():
        if isinstance(value, dict) and field != "arguments":
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
    """Probe refusal 2: in 2 of 5 first answers the reviewer's reply broke inside an array
    ("Expected ',' or ']' after array element in JSON at position 1393"). The retained admitted
    answer shows the shape that grows that long: evidenceRefs as nested objects and three
    limitations of 150-250 characters. The template now caps it and names every field."""

    def test_the_template_names_every_required_field_in_its_instructions(self):
        template, required = _reviewer_template()
        instructions = template.split("Example reply (shape only):", 1)[0]
        for field in required:
            with self.subTest(field=field):
                self.assertRegex(instructions, rf"\b{field}\b")

    def test_the_template_states_the_json_format_rules(self):
        template, _ = _reviewer_template()
        for rule in ("exactly one JSON object and nothing else", "no prose", "no Markdown fence",
                     "no trailing commas", "a list of Runtime input record-id strings",
                     "at most three strings, each under 200 characters", "no nested object except arguments"):
            with self.subTest(rule=rule):
                self.assertIn(rule, template)

    def test_the_templates_example_keeps_the_rules_and_the_probes_answer_breaks_them(self):
        template, required = _reviewer_template()
        example = json.loads(template.split("Example reply (shape only):", 1)[1])
        self.assertEqual(sorted(example), sorted(required))
        self.assertEqual(_reviewer_format_problems(example), [])
        probe = json.loads((FIXTURES / "reviewer-answer-attempt-1.json").read_text(encoding="utf-8"))
        self.assertEqual(_reviewer_format_problems(probe), [
            "evidenceRefs is not a list of record-id strings",
            "limitations is not at most three strings under 200 characters",
        ])


class BufferForAndGateTest(_ProbeFixture):
    """Probe loose admission: worker attempts 1 and 3 sized CKAN2D* AND gates to the setup
    buffer BUFFD4BWP30P140 (taken from xtopContext.bufferListForSetup). The 0.1.10 Reader
    checked only a safe name. C13 (4ed569ba, WorkerActionMasterReaderTest.
    test_a_master_of_another_function_is_refused) counts a master of another function; this
    reads the probe's own document with the Site's own sizing rule from the same request."""

    CELLS = ("CKAN2D2BWP35P140HVT", "CKAN2D4BWP35P140HVT", "CKAN2D2BWP40P140HVT", "CKAN2D4BWP40P140HVT",
             "BUFFD2BWP30P140", "BUFFD4BWP30P140")
    # The retained Team input's researcher names each instance's current master (fromMaster).
    CELL_OF = {"swerv_dec_tlu/g96219": "CKAN2D2BWP35P140HVT", "swerv_dec_tlu/g96216": "CKAN2D2BWP40P140HVT",
               "swerv_dec_tlu/g96221": "CKAN2D2BWP35P140HVT"}

    def test_the_probes_buffer_for_an_and_gate_is_counted(self):
        document = _fixture("worker-request-w01-attempt-1.json")
        library = _write(self.workspace / "libs" / "cells.lib", "library (probe) {\n"
                         + "".join(f"  cell ({name}) {{ }}\n" for name in self.CELLS) + "}\n")
        context = core.stamp("xtop-context", {
            "designStateId": document["baseState"]["id"], "requiredScenarios": ["func_ssg_rcworst_m40"],
            "libraryFiles": {"func_ssg_rcworst_m40": [{"path": str(library), "sha256": core.file_sha256(library)}]},
            "ecoParameters": document["siteCapabilities"]["xtopContext"]["ecoParameters"],
        })
        _write(self.workspace / "state" / "xtop-context.json", json.dumps(context))
        found = self._read(_probe_reader(self.CELL_OF), "worker-request", "worker-request-w01.json", document, "w01")
        refused = [text for text in found if "changes cell function 'CKAN2D'" in text and "'BUFFD'" in text]
        self.assertEqual(len(refused), len(document["actions"]), found)


class NextDecisionTargetsTest(_ProbeFixture):
    """Probe loose admission: evaluate-next-investment wrote targets as a bare scenario
    (attempt 1), wildcards (attempt 2) and prose with counts (attempt 3). Each target must be one
    exact check key `<scenario>|<setup|hold>|<endpoint>`."""

    def _targets_problems(self, name):
        document = _fixture(name)
        found = self._read(_probe_reader(), "next-decision", "next-decision.json", document)
        return document["targets"], [text for text in found if text.startswith("targets[")]

    def test_the_probes_free_form_targets_are_counted_one_by_one(self):
        expected_bad = {
            "next-decision-attempt-1.json": ["func_ssg_rcworst_125"],
            "next-decision-attempt-2.json": None,  # every one holds a wildcard
            "next-decision-attempt-3.json": None,  # every one is prose
        }
        for name, bad in expected_bad.items():
            with self.subTest(document=name):
                targets, found = self._targets_problems(name)
                bad = targets if bad is None else bad
                self.assertEqual(len(found), len(bad), found)
                for text, target in zip(found, bad):
                    self.assertIn(repr(target), text)
                    self.assertIn("<scenario>|<setup|hold>|<endpoint>", text)

    def test_exact_check_keys_are_admitted(self):
        document = _fixture("next-decision-attempt-1.json")
        document["targets"] = ["func_ssg_rcworst_m40|setup|dec_tlu_perfcnt0[0]",
                               "func_ffg_cbest_125|hold|swerv_dbg/axi_rdata_ff/dout_reg_0_"]
        found = self._read(_probe_reader(), "next-decision", "next-decision.json", document)
        self.assertEqual([text for text in found if text.startswith("targets[")], [])


if __name__ == "__main__":
    unittest.main()
