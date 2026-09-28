"""Issue #64 Task 5: six parallel worker slots, the `workerSlots` knob and parked slots.

The graph forks `prepare-workers` into six branches, one per slot, joined at
`check-worker-results`. A slot the plan parks (or one above the Run's
`workerSlots` knob) still runs its branch, but as a pure no-op chain: its
Workshop writes the parked package, `operate-parked` confirms it without any
XTop session, and `capture-contribution` seals a `parked` no-fix. Nothing here
launches EDA.

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import json
import shutil
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import workspaces  # noqa: E402
from test_cli_state import (  # noqa: E402
    _make_baseline_manifest, _run, _tmp, _write_json, _write_xtop_context,
)


def _active(task_id, base_state_id):
    n = int(task_id[1:])
    return {
        "taskId": task_id, "baseStateId": base_state_id, "problem": "hold blockers",
        "targets": [], "editDomain": {"instances": [f"U{n}"], "nets": [], "regions": []},
        "protected": {"instances": [], "nets": []}, "mayAffect": [],
        "actions": ["size_cell"], "budget": {"xtopMinutes": 1, "queries": 1, "attempts": 1},
        "targetPins": [], "scope": {"commands": ["atcs_size_cell", "atcs_undo"],
                                    "maxMutations": workspaces.SCOPE_MAX_MUTATIONS},
    }


def _parked(task_id, base_state_id, why="no blocker cluster left for this slot"):
    return {"taskId": task_id, "baseStateId": base_state_id, "parked": True, "problem": why}


class ParkedWorkPackageTest(unittest.TestCase):
    BASE = {"id": "a" * 20}

    def test_a_parked_package_is_stamped(self):
        stamped = workspaces.validate_work_package(_parked("w05", "a" * 20), self.BASE, {})
        self.assertTrue(stamped["parked"])
        self.assertTrue(workspaces.is_parked(stamped))
        self.assertFalse(workspaces.is_parked(_active("w05", "a" * 20)))

    def test_a_parked_package_carries_only_its_identity_and_reason(self):
        broken = {
            "work fields": dict(_parked("w05", "a" * 20), editDomain={"instances": ["U5"], "nets": []}),
            "a blank reason": _parked("w05", "a" * 20, why=" "),
            "another base": _parked("w05", "b" * 20),
            "an unknown slot": _parked("w07", "a" * 20),
            "parked false": dict(_active("w05", "a" * 20), parked=False),
        }
        for label, package in broken.items():
            with self.subTest(label):
                self.assertGreaterEqual(workspaces.request_invalid_count(package, self.BASE, {}), 1, label)
                with self.assertRaises(core.AtcsError):
                    workspaces.validate_work_package(package, self.BASE, {})

    def test_slot_numbers(self):
        self.assertEqual([workspaces.slot_number(slot) for slot in workspaces.TASK_IDS], [1, 2, 3, 4, 5, 6])


class WorkerSlotsCliTest(unittest.TestCase):
    """`worker-slots` binds the Run's `workerSlots` knob for the plan Reader, every generation."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)

    def test_the_knob_names_the_active_and_parked_slots(self):
        result = _run("worker-slots", self.workspace, "4")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = core.read_artifact(self.workspace / "state" / "worker-slots.json", "worker-slots")
        self.assertEqual(record["workerSlots"], 4)
        self.assertEqual(record["activeSlots"], ["w01", "w02", "w03", "w04"])
        self.assertEqual(record["parkedSlots"], ["w05", "w06"])

    def test_the_default_six_parks_nothing(self):
        result = _run("worker-slots", self.workspace, "6")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = core.read_artifact(self.workspace / "state" / "worker-slots.json", "worker-slots")
        self.assertEqual(record["parkedSlots"], [])

    def test_a_value_outside_one_to_six_is_refused(self):
        for value in ("0", "7", "2.5", "six", "true"):
            with self.subTest(value=value):
                result = _run("worker-slots", self.workspace, value)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertFalse((self.workspace / "state" / "worker-slots.json").exists())


class ParkedBranchTest(unittest.TestCase):
    """prepare-workers, operate-parked, capture-contribution and collect over a plan with parked slots."""

    PARKED = ("w03", "w04", "w05", "w06")

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state_path = self.workspace / "state" / "working-state.json"
        self.working_state = json.loads(self.working_state_path.read_text())
        xtop_site = _write_xtop_context(self.workspace, self.working_state["id"])
        self.eda_profile_path = self.workspace / "eda-profile.json"
        _write_json(self.eda_profile_path, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef", **xtop_site})
        self.site_caps_path = self.workspace / "site-caps.json"
        _write_json(self.site_caps_path, {"pgVerification": False})
        packages = {slot: (_parked(slot, self.working_state["id"]) if slot in self.PARKED
                           else _active(slot, self.working_state["id"])) for slot in workspaces.TASK_IDS}
        self.plan_path = self.workspace / "campaign-plan.json"
        _write_json(self.plan_path, {"candidate": {"workPackages": packages, "reason": "two blocker clusters"},
                                     "baseState": self.working_state, "siteCapabilities": {"pgVerification": False}})
        result = _run("prepare-workers", self.workspace, self.working_state_path, self.site_caps_path,
                      self.eda_profile_path, self.plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.workers = json.loads((self.workspace / "state" / "workers.json").read_text())

    def test_prepare_workers_prepares_parked_slots_without_a_session(self):
        self.assertEqual(self.workers["requiredSlots"], list(workspaces.TASK_IDS),
                         "collect waits for every slot, active and parked")
        for slot in workspaces.TASK_IDS:
            entry = self.workers["workers"][slot]
            self.assertEqual(entry["workPackage"]["taskId"], slot)
            self.assertEqual(entry["workspaceManifest"]["taskId"], slot)
            if slot in self.PARKED:
                self.assertIs(entry["parked"], True)
                self.assertNotIn("sessionTcl", entry, "a parked slot has no XTop session to open")
                self.assertFalse((self.workspace / entry["root"] / "xtop-analysis-manual.tcl").exists())
            else:
                self.assertIs(entry.get("parked", False), False)
                self.assertEqual(len(entry["sessionTclSha256"]), 64)

    def _request(self, slot, **changes):
        candidate = dict(_active(slot, self.working_state["id"]), **changes)
        _write_json(self.workspace / "research" / "requests" / f"worker-request-{slot}.json",
                    {"candidate": candidate, "baseState": self.working_state, "siteCapabilities": {"pgVerification": False}})

    def test_operate_parked_confirms_a_parked_slot_and_refuses_an_admissible_active_one(self):
        result = _run("operate-parked", self.workspace, "w05")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = core.read_artifact(self.workspace / self.workers["workers"]["w05"]["root"] / "parked.json",
                                     "parked-operate")
        self.assertEqual([receipt["taskId"], receipt["why"]], ["w05", "parked"])
        self.assertEqual(receipt["workPackageId"], self.workers["workers"]["w05"]["workPackageId"])
        self._request("w01")
        result = _run("operate-parked", self.workspace, "w01")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "slot-active")
        self.assertFalse((self.workspace / self.workers["workers"]["w01"]["root"] / "parked.json").exists())
        result = _run("operate-parked", self.workspace, "w07")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)

    def test_an_active_slot_with_an_inadmissible_request_is_skipped_as_a_no_fix(self):
        """The branch holds no Judge, so an inadmissible request's operate node is the no-op too."""
        self._request("w02", targetPins=["U2/A"])  # drifts from the prepared package's targetPins
        result = _run("operate-parked", self.workspace, "w02")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = core.read_artifact(self.workspace / self.workers["workers"]["w02"]["root"] / "parked.json",
                                     "parked-operate")
        self.assertEqual(receipt["why"], "inadmissible-request")
        result = _run("capture-contribution", self.workspace, "w02")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = core.read_artifact(self.workspace / "state" / "contribution-w02.json", "contribution")
        self.assertEqual([contribution["kind"], contribution["parked"]], ["no-fix", True])
        self.assertIn("worker request has 1 problem", contribution["diagnosis"])
        # Fix round 1: the skip is visible at the join -- the result carries a refusal, so its
        # branch's `worker-result-admissible` verdict FAILs (both outcomes still collect).
        self.assertFalse(contribution["admissible"])
        self.assertEqual([refusal["code"] for refusal in contribution["refusals"]], ["inadmissible-request"])

    def test_operate_parked_refuses_when_it_cannot_read_the_request_or_the_working_state(self):
        """Fix round 1: only a request that parses and fails validation is skipped."""
        result = _run("operate-parked", self.workspace, "w02")  # no request written yet
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self._request("w02", targetPins=["U2/A"])
        (self.workspace / "state" / "working-state.json").rename(self.workspace / "state" / "working-state.moved")
        result = _run("operate-parked", self.workspace, "w02")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertFalse((self.workspace / self.workers["workers"]["w02"]["root"] / "parked.json").exists())

    def test_a_re_prepare_removes_an_earlier_skip_receipt(self):
        """Fix round 1: an identical package reuses its root; a later generation's real session there
        must not meet the earlier generation's skip receipt."""
        self._request("w02", targetPins=["U2/A"])
        self.assertEqual(_run("operate-parked", self.workspace, "w02").returncode, 0)
        receipt = self.workspace / self.workers["workers"]["w02"]["root"] / "parked.json"
        self.assertTrue(receipt.exists())
        result = _run("prepare-workers", self.workspace, self.working_state_path, self.site_caps_path,
                      self.eda_profile_path, self.plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        again = json.loads((self.workspace / "state" / "workers.json").read_text())
        self.assertEqual(again["workers"]["w02"]["root"], self.workers["workers"]["w02"]["root"], "the root is reused")
        self.assertFalse(receipt.exists())
        result = _run("capture-contribution", self.workspace, "w02")
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "missing-input", "an active slot's capture needs its session")

    def test_capture_seals_a_parked_no_fix_and_collect_takes_every_slot(self):
        for slot in self.PARKED:
            result = _run("capture-contribution", self.workspace, slot)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            contribution = core.read_artifact(self.workspace / "state" / f"contribution-{slot}.json", "contribution")
            self.assertEqual(contribution["kind"], "no-fix")
            self.assertIs(contribution["parked"], True)
            self.assertTrue(contribution["admissible"], contribution["refusals"])
            self.assertEqual(contribution["operations"], [])
            self.assertIn("parked", contribution["diagnosis"])
            self.assertIn("no blocker cluster left", contribution["diagnosis"])
            self.assertEqual(contribution["revision"], self.workers["workers"][slot]["workspaceManifest"]["revision"])
        result = _run("collect", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        collected = json.loads((self.workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(sorted(c["taskId"] for c in collected["contributions"]), list(self.PARKED))
        self.assertEqual(sorted(p["slot"] for p in collected["pending"]), ["w01", "w02"],
                         "active slots without a sealed session stay pending")

    def test_a_slot_whose_prepared_entry_and_package_disagree_on_parking_is_refused(self):
        """One parked predicate: `state/workers.json` marks a slot parked exactly when its
        prepared package is parked; operate and capture refuse a slot where the two disagree."""
        workers_path = self.workspace / "state" / "workers.json"
        tampered = json.loads(workers_path.read_text())
        tampered["workers"]["w01"]["parked"] = True        # an active package marked parked
        del tampered["workers"]["w05"]["parked"]           # a parked package not marked
        workers_path.write_text(json.dumps(tampered), encoding="utf-8")
        for slot in ("w01", "w05"):
            for command in ("operate-parked", "capture-contribution"):
                with self.subTest(slot=slot, command=command):
                    result = _run(command, self.workspace, slot)
                    self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
                    self.assertEqual(json.loads(result.stderr)["code"], "identity-mismatch")
            self.assertFalse((self.workspace / "state" / f"contribution-{slot}.json").exists())

    def test_a_parked_slot_that_ran_a_session_is_refused(self):
        root = self.workspace / self.workers["workers"]["w06"]["root"]
        (root / "before.dump").write_text("U6 BUF1\n", encoding="utf-8")
        result = _run("capture-contribution", self.workspace, "w06")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "parked-slot-ran")
        self.assertFalse((self.workspace / "state" / "contribution-w06.json").exists())


if __name__ == "__main__":
    unittest.main()
