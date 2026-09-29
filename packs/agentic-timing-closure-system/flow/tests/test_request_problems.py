"""Itemized request problems: the Reader writes `<document>.problems.txt` beside each request.

Issue #64 Track B (from #63 slice 3 gap 1). Live02 (Pack 0.2.0): the plan Workshop wrote a
campaign plan the Reader counted at 41 problems; the Judge refused it, but the owner saw only
the count, and the Run spent its second generation re-planning blind. Every request kind now
returns one problem string per counted problem (`read_atcs.problems`), the count is their
number, and `main()` writes them beside the document for the producing Workshop to read back
as its declared `<output>Problems` output.

`live_fixtures/` holds the retained live02 bytes (see its README). The plan is verbatim
(sha256 4f60f78d...); the Site's design files are not, so the tests that read it stub the
design-state file re-hash (`_verify_design_state_refs`) and nothing else.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_request_problems.py -v
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
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
from test_readers import READ_ATCS_PATH, _make_workspace, _write, read_atcs  # noqa: E402

LIVE = TESTS_DIR / "live_fixtures"
LIVE02_PLAN_SHA256 = "4f60f78d9b4d2d4f7ddf26465e68cbfce80b371235004b0e0ac171632073a772"
SLOTS = ("w01", "w02", "w03", "w04", "w05", "w06")

# Each request output, its document path and the Workshop that writes it (contract.yml).
REQUEST_OUTPUTS = {
    "observationRequest": ("research/requests/observation-request.json", "diagnose-and-observe"),
    "campaignPlan": ("research/requests/campaign-plan.json", "plan-campaign"),
    **{f"workerRequest{slot[1:]}": (f"research/requests/worker-request-{slot}.json", f"research-worker-{slot[1:]}")
       for slot in SLOTS},
    "integrationPlan": ("research/requests/integration-plan.json", "compose-contributions"),
    "nextDecision": ("research/requests/next-decision.json", "evaluate-next-investment"),
}


def live02_workspace(root):
    """A Campaign workspace holding the live02 state the plan was read against."""
    workspace = _make_workspace(root)
    for name, target in (("live02-working-state.json", "state/working-state.json"),
                         ("live02-policy.json", "state/policy.json"),
                         ("live02-worker-slots.json", "state/worker-slots.json"),
                         ("live02-observation-worst.json", "state/observation.json"),
                         ("live02-campaign-plan.json", "research/requests/campaign-plan.json")):
        (workspace / target).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(LIVE / name, workspace / target)
    return workspace


class Live02PlanProblemsTest(unittest.TestCase):
    """RED on e94398ea: `read_atcs` had no `problems` and wrote no sidecar; the owner saw 41."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = live02_workspace(self.tmp.name)
        self.plan = self.workspace / "research" / "requests" / "campaign-plan.json"
        # The Site's netlist, DEF and SPEF are not retained here; only their re-hash is skipped.
        patcher = mock.patch.object(read_atcs, "_verify_design_state_refs", lambda *args, **kwargs: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_fixture_is_the_retained_live02_plan(self):
        self.assertEqual(hashlib.sha256((LIVE / "live02-campaign-plan.json").read_bytes()).hexdigest(),
                         LIVE02_PLAN_SHA256)

    def test_forty_one_problems_one_line_each(self):
        found = read_atcs.problems("campaign-plan", self.plan, self.workspace)
        (value,) = read_atcs.read("campaign-plan", self.plan, self.workspace)
        self.assertEqual(value["value"], 41, "the live count")
        self.assertEqual(len(found), 41)
        for line in found:
            self.assertRegex(line, r"^(candidate\.workPackages(\.w0[1-6]\.\w+)?|baseState|workPackages|candidate\.reason): ")

    def test_each_live_error_class_is_named_with_its_field_and_format(self):
        found = read_atcs.problems("campaign-plan", self.plan, self.workspace)

        def lines(prefix):
            return [line for line in found if line.startswith(prefix)]

        for slot in SLOTS:
            (task_id,) = lines(f"candidate.workPackages.{slot}.taskId: ")
            self.assertIn("required format: exactly the slot key", task_id)
        self.assertIn("got 'w04-parked'", lines("candidate.workPackages.w04.taskId: ")[0])
        for slot in ("w01", "w02", "w03"):
            for field in ("protected", "actions"):
                (missing,) = lines(f"candidate.workPackages.{slot}.{field}: missing field: {field}")
                self.assertIn("required format:", missing)
        read_procs = lines("candidate.workPackages.w01.scope: scope command ")
        self.assertEqual(len(read_procs), 8, "atcs_dump_cells, the five reads, export and close")
        self.assertTrue(all("never atcs_ref" in line for line in read_procs))
        self.assertEqual(len(lines("candidate.workPackages.w01.targetPins: targetPin 'ifu_axi_araddr[")), 2)
        (shared,) = lines("candidate.workPackages: instance 'swerv_dma_ctrl' is claimed by active slots w01, w02, w03")
        self.assertIn("share no instance", shared)
        blockers = lines("candidate.workPackages: blocker ")
        self.assertEqual(len(blockers), 4)
        self.assertTrue(all("|hold|swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_" in line for line in blockers))

    def test_the_reader_process_writes_the_same_lines_beside_the_plan(self):
        out = self.workspace / "hima-readers" / "out.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        with mock.patch.object(sys, "argv", ["read-atcs.py", "campaign-plan", str(self.plan), str(out), str(self.workspace)]):
            read_atcs.main()
        sidecar = (self.workspace / "research" / "requests" / "campaign-plan.problems.txt").read_text().splitlines()
        self.assertEqual(sidecar[0], "41 problems in campaign-plan.json (tc_request_invalid_count = 41); "
                                     "fix every line and write the whole document again:")
        found = read_atcs.problems("campaign-plan", self.plan, self.workspace)
        self.assertEqual(sidecar[1:], ["- " + " ".join(line.split()) for line in found])
        self.assertEqual(json.loads(out.read_text())["values"][0]["value"], 41)


class RequestProblemsTest(unittest.TestCase):
    """Every request kind: the count is the number of problems, each named by its field."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _run(self, kind, report, *extra):
        out = self.workspace / "hima-readers" / f"{kind}.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        done = subprocess.run([sys.executable, str(READ_ATCS_PATH), kind, str(report), str(out), str(self.workspace), *extra],
                              capture_output=True, text=True)
        sidecar = report.with_name(report.name[: -len(".json")] + ".problems.txt")
        return done, out, sidecar.read_text() if sidecar.exists() else None

    def test_observation_request_problems_name_their_fields(self):
        report = _write(self.workspace / "research" / "requests" / "observation-request.json",
                        json.dumps({"designStateId": "nope", "precision": "exact"}))
        found = read_atcs.problems("observation-request", report, self.workspace)
        self.assertEqual([line.split(":", 1)[0] for line in found],
                         ["requiredScenarios", "maxPaths", "precision", "designStateId"])
        done, out, sidecar = self._run("observation-request", report)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(out.read_text())["values"][0]["value"], 4)
        self.assertTrue(sidecar.startswith("4 problems in observation-request.json"))

    def test_a_document_that_is_not_an_object_is_counted_not_raised(self):
        for kind, name in (("observation-request", "observation-request.json"), ("campaign-plan", "campaign-plan.json"),
                           ("integration-plan", "integration-plan.json"), ("next-decision", "next-decision.json")):
            with self.subTest(kind):
                report = _write(self.workspace / "research" / "requests" / name, "[]")
                found = read_atcs.problems(kind, report, self.workspace)
                self.assertGreaterEqual(len(found), 1)
                self.assertEqual(read_atcs.read(kind, report, self.workspace)[0]["value"], len(found))
        report = _write(self.workspace / "research" / "requests" / "worker-request-w04.json", json.dumps({"candidate": []}))
        found = read_atcs.problems("worker-request", report, self.workspace, "w04")
        self.assertEqual([line.split(":", 1)[0] for line in found],
                         ["candidate (slot w04)", "baseState (slot w04)", "siteCapabilities (slot w04)"])

    def test_integration_plan_problems_start_with_plan(self):
        facts = core.stamp("composition-facts", {
            "baseStateId": "a" * 20, "considered": ["c1"], "duplicates": [],
            "conflicts": [], "interactions": [], "staleBase": [], "order": ["c1"], "unresolvedCount": 0,
        })
        plan = {"batchId": "", "baseStateId": "b" * 20, "select": "c1", "resolutions": [], "deferred": [], "reason": "x"}
        report = _write(self.workspace / "research" / "requests" / "integration-plan.json",
                        json.dumps({"plan": plan, "facts": facts}))
        found = read_atcs.problems("integration-plan", report, self.workspace)
        self.assertTrue(found and all(line.startswith("plan.") for line in found), found)
        values = {value["type"]: value for value in read_atcs.read("integration-plan", report, self.workspace)}
        self.assertEqual(values["tc_request_invalid_count"]["value"], len(found))
        self.assertIsNone(values["tc_selected_contribution_count"]["value"], "a non-list select is unknown, not raised")

    def test_next_decision_problems_are_the_count(self):
        report = _write(self.workspace / "research" / "requests" / "next-decision.json", json.dumps({"action": "fly"}))
        found = read_atcs.problems("next-decision", report, self.workspace)
        self.assertIn("action must be one of", " ".join(found))
        self.assertEqual(read_atcs.read("next-decision", report, self.workspace)[0]["value"], len(found))

    def test_an_identity_refusal_writes_its_reason_and_no_reading(self):
        tampered = core.stamp("composition-facts", {"baseStateId": "a" * 20, "considered": [], "duplicates": [],
                                                    "conflicts": [], "interactions": [], "staleBase": [], "order": [],
                                                    "unresolvedCount": 0})
        tampered["considered"] = ["forged"]
        report = _write(self.workspace / "research" / "requests" / "integration-plan.json",
                        json.dumps({"plan": {"select": []}, "facts": tampered}))
        done, out, sidecar = self._run("integration-plan", report)
        self.assertNotEqual(done.returncode, 0)
        self.assertFalse(out.exists(), "a refused document leaves no reading")
        self.assertTrue(sidecar.startswith("integration-plan.json was refused before its problems could be counted: "),
                        sidecar)

    def test_a_non_request_kind_has_no_problems(self):
        with self.assertRaisesRegex(ValueError, "not a request kind"):
            read_atcs.problems("readiness", self.workspace / "x.json", self.workspace)


class ProblemsWiringTest(unittest.TestCase):
    """contract.yml: each request output has its `<output>Problems` beside it, read by its Workshop
    (stdlib-only text checks; the contract test loads the same declarations with `loadPack`)."""

    CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")

    def _output(self, name):
        match = re.search(rf"^  - name: {name}\n((?:    .*\n|      .*\n)*)", self.CONTRACT, re.M)
        self.assertIsNotNone(match, f"output {name} is declared")
        return match.group(1)

    def _workshop(self, workshop_id):
        return self.CONTRACT.split(f"  - id: {workshop_id}\n", 1)[1].split("\n  - id: ", 1)[0]

    def test_every_request_output_has_its_problems_output_beside_it(self):
        for name, (path, workshop_id) in REQUEST_OUTPUTS.items():
            with self.subTest(name):
                self.assertIn(f"    path: {path}\n", self._output(name))
                problems = self._output(f"{name}Problems")
                expected = path[: -len(".json")] + ".problems.txt"
                self.assertIn(f"    path: {expected}\n", problems)
                self.assertEqual(str(read_atcs._problems_file(Path(path))), expected, "where the Reader writes it")
                self.assertNotIn("    reader:", problems)
                workshop = self._workshop(workshop_id)
                self.assertIn(f"    produces: {name}\n", workshop)
                reads = re.search(r"^    reads: \[(.*)\]$", workshop, re.M).group(1).split(", ")
                self.assertIn(f"{name}Problems", reads)
                self.assertIn(f"read output {name}Problems first", workshop)

    def test_the_decision_workshop_also_reads_the_plan_refusals_routed_to_it(self):
        workshop = self._workshop("evaluate-next-investment")
        reads = re.search(r"^    reads: \[(.*)\]$", workshop, re.M).group(1).split(", ")
        for name in ("campaignPlanProblems", "integrationPlanProblems"):
            self.assertIn(name, reads)
            self.assertIn(name, workshop.split("    directory:")[0])


if __name__ == "__main__":
    unittest.main()
