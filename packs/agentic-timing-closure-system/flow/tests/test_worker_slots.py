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
import os
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
from test_readers import read_atcs  # noqa: E402


def _write_json_at(path, obj):
    _write_json(path, obj)
    return path


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

    def test_zero_parks_every_seat(self):
        """#66 D8: the qualified full-auto control arm is the same Pack with every seat parked."""
        result = _run("worker-slots", self.workspace, "0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = core.read_artifact(self.workspace / "state" / "worker-slots.json", "worker-slots")
        self.assertEqual(record["workerSlots"], 0)
        self.assertEqual(record["activeSlots"], [])
        self.assertEqual(record["parkedSlots"], list(workspaces.TASK_IDS))

    def test_the_contract_knob_admits_zero(self):
        contract = (TESTS_DIR.parent.parent / "contract.yml").read_text(encoding="utf-8")
        self.assertIn("workerSlots: { type: number, unit: slots, min: 0, max: 6, default: 6 }", contract)

    def test_a_value_outside_zero_to_six_is_refused(self):
        for value in ("7", "-1", "2.5", "six", "true", ""):
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

    def _reader_problems(self, slot, text, age=0):
        path = self.workspace / "research" / "requests" / f"worker-request-{slot}.problems.txt"
        path.write_text(text, encoding="utf-8")
        request = self.workspace / "research" / "requests" / f"worker-request-{slot}.json"
        stamp = request.stat().st_mtime + age
        os.utime(path, (stamp, stamp))
        return path

    T06_PROBLEMS = (
        "1 problem in worker-request-w02.json (tc_request_invalid_count = 1); fix every line and write the whole "
        "document again:\n- operatorBrief (slot w02): missing; the Host gives the Operator this bounded summary of "
        "the request; run python3 <workspace>/hima-readers/atcs-readiness/read-atcs.py brief "
        "<workspace>/research/requests/worker-request-w02.json after writing the request: it writes operatorBrief "
        "in place\n")

    def test_t06_an_active_slot_the_reader_refused_settles_as_a_no_fix(self):
        """D-T06-1(a) (#64 T06 w06, here on active slot w02): the Reader refused the request three times (operatorBrief missing), no
        worker Team ran, and the autopilot ran `operate-parked` on the active slot, which exited 3
        (`slot-active`: the flow-side half of the rule found the request admissible). The Reader's own
        current verdict (its `.problems.txt`) now settles the branch as an honest no-fix naming the problem."""
        self._request("w02")
        self._reader_problems("w02", self.T06_PROBLEMS)
        result = _run("operate-parked", self.workspace, "w02")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = core.read_artifact(self.workspace / self.workers["workers"]["w02"]["root"] / "parked.json",
                                     "parked-operate")
        self.assertEqual(receipt["why"], "inadmissible-request")
        self.assertIn("operatorBrief (slot w02): missing", receipt["reason"])
        result = _run("capture-contribution", self.workspace, "w02")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        contribution = core.read_artifact(self.workspace / "state" / "contribution-w02.json", "contribution")
        self.assertEqual([contribution["kind"], contribution["parked"]], ["no-fix", True])
        self.assertIn("operatorBrief (slot w02): missing", contribution["diagnosis"])

    def test_t06_an_admitted_or_stale_reader_verdict_keeps_the_slot_active(self):
        self._request("w02")
        self._reader_problems("w02", "0 problems in worker-request-w02.json: the Reader admits it "
                                     "(tc_request_invalid_count = 0).\n")
        result = _run("operate-parked", self.workspace, "w02")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stderr)["code"], "slot-active")
        self._reader_problems("w02", self.T06_PROBLEMS, age=-60)  # read before the request was rewritten
        result = _run("operate-parked", self.workspace, "w02")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)

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



_DEF_TEXT = """VERSION 5.8 ;
DESIGN top ;
UNITS DISTANCE MICRONS 2000 ;
DIEAREA ( 0 0 ) ( 400000 400000 ) ;
ROW core_row_0 core 0 0 N DO 1000 BY 1 STEP 280 0 ;
ROW core_row_1 core 0 1152 FS DO 1000 BY 1 STEP 280 0 ;
ROW core_row_2 core 0 2304 N DO 1000 BY 1 STEP 280 0 ;
COMPONENTS 3 ;
 - U1 SOME_CELL + PLACED ( 20000 40000 ) N ;
 - u_a/reg\\[3\\] DFF
   + PLACED ( 100000 60000 ) FS ;
 - U9 SOME_CELL + FIXED ( 1000 1000 ) N ;
END COMPONENTS
END DESIGN
"""


class LocalTopologyPrepareTest(unittest.TestCase):
    """#64 attempt 5: every active slot's session derives its blockers' local topology in-session,
    and a plan that gives no region gets one box per plan instance from the base DEF (+- 4 rows)."""

    def _prepare(self, packages_for):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest = _make_baseline_manifest(workspace)
        (workspace / "design.def").write_text(_DEF_TEXT, encoding="utf-8")
        manifest["def"] = "design.def"
        _write_json(workspace / "manifest.json", manifest)
        result = _run("baseline", workspace, workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        state_path = workspace / "state" / "working-state.json"
        working = json.loads(state_path.read_text())
        xtop_site = _write_xtop_context(workspace, working["id"])
        eda = workspace / "eda-profile.json"
        _write_json(eda, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef", **xtop_site})
        caps = workspace / "site-caps.json"
        _write_json(caps, {"pgVerification": False})
        plan = workspace / "campaign-plan.json"
        _write_json(plan, {"candidate": {"workPackages": packages_for(working["id"]), "reason": "r"},
                           "baseState": working, "siteCapabilities": {"pgVerification": False}})
        result = _run("prepare-workers", workspace, state_path, caps, eda, plan)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return workspace, json.loads((workspace / "state" / "workers.json").read_text())

    def test_an_active_slot_derives_its_topology_and_gets_one_box_per_plan_instance(self):
        def packages(base):
            out = {slot: _parked(slot, base) for slot in workspaces.TASK_IDS}
            out["w01"] = dict(_active("w01", base), editDomain={"instances": ["U1", "u_a/reg[3]"], "nets": [],
                                                                 "regions": []})
            return out
        workspace, workers = self._prepare(packages)
        entry = workers["workers"]["w01"]
        tcl = (workspace / entry["root"] / "xtop-analysis-manual.tcl").read_text()
        self.assertIn("set ::EDIT_DOMAIN_LOCAL {1}\n", tcl)
        # #66 D2: every active session is baked with the Pack's local fanout cap (default 12).
        self.assertEqual(workspaces.LOCAL_FANOUT_MAX, 12)
        self.assertIn(f"set ::ATCS_LOCAL_FANOUT_MAX {{{workspaces.LOCAL_FANOUT_MAX}}}\n", tcl)
        self.assertEqual(entry["localFanoutMax"], workspaces.LOCAL_FANOUT_MAX)
        self.assertIs(entry["localTopology"], True)
        # Row pitch 1152 DBU = 0.576 um; 4 rows = 2.304 um around each instance's origin (um).
        self.assertEqual(entry["derivedRegions"], [[7.696, 17.696, 12.304, 22.304],
                                                   [47.696, 27.696, 52.304, 32.304]])
        self.assertIn("set ::EDIT_DOMAIN_REGIONS {7.696 17.696 12.304 22.304 47.696 27.696 52.304 32.304}", tcl)
        self.assertEqual(entry["workPackage"]["editDomain"]["regions"], [], "the admitted package is unchanged")

    def test_a_plans_own_region_is_honoured(self):
        def packages(base):
            out = {slot: _parked(slot, base) for slot in workspaces.TASK_IDS}
            out["w01"] = dict(_active("w01", base), editDomain={"instances": ["U1"], "nets": [],
                                                                 "regions": [[0, 0, 5, 5]]})
            return out
        workspace, workers = self._prepare(packages)
        entry = workers["workers"]["w01"]
        self.assertEqual(entry["derivedRegions"], [])
        tcl = (workspace / entry["root"] / "xtop-analysis-manual.tcl").read_text()
        self.assertIn("set ::EDIT_DOMAIN_REGIONS {0 0 5 5}", tcl)

    def test_an_instance_the_def_does_not_place_gets_no_box(self):
        def packages(base):
            out = {slot: _parked(slot, base) for slot in workspaces.TASK_IDS}
            out["w01"] = dict(_active("w01", base), editDomain={"instances": ["U_GHOST"], "nets": [], "regions": []})
            return out
        _, workers = self._prepare(packages)
        self.assertEqual(workers["workers"]["w01"]["derivedRegions"], [])

    def test_a_parked_slot_gets_no_session_and_no_derivation(self):
        def packages(base):
            out = {slot: _parked(slot, base) for slot in workspaces.TASK_IDS}
            out["w01"] = dict(_active("w01", base), editDomain={"instances": ["U1"], "nets": [], "regions": []})
            return out
        workspace, workers = self._prepare(packages)
        parked = workers["workers"]["w02"]
        self.assertTrue(parked["parked"])
        for key in ("sessionTcl", "localTopology", "localFanoutMax", "derivedRegions"):
            self.assertNotIn(key, parked)
        self.assertFalse((workspace / parked["root"] / "xtop-analysis-manual.tcl").exists())

class AllParkedControlArmTest(unittest.TestCase):
    """#66 D8: `workerSlots 0` is the qualified full-auto control arm. Every seat is parked, the plan
    Reader admits the all-parked plan, every fork branch takes its batch no-op (`batchWhen`
    `tc_slot_parked = 1`), every capture seals a parked no-fix, and the recipe selects nothing, so the
    batch runs the auto-finish alone."""

    def setUp(self):
        self.workspace = _tmp()
        self.addCleanup(shutil.rmtree, self.workspace, ignore_errors=True)
        (self.workspace / "flow").mkdir()
        os.symlink(FLOW_DIR / "atcs", self.workspace / "flow" / "atcs")  # the Readers import the Pack's flow
        manifest = _make_baseline_manifest(self.workspace)
        _write_json(self.workspace / "manifest.json", manifest)
        result = _run("baseline", self.workspace, self.workspace / "manifest.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.working_state_path = self.workspace / "state" / "working-state.json"
        self.working_state = json.loads(self.working_state_path.read_text())
        xtop_site = _write_xtop_context(self.workspace, self.working_state["id"])
        eda_profile = self.workspace / "eda-profile.json"
        _write_json(eda_profile, {"design": "top", "techLef": "tech.lef", "cellLefGlob": "*.lef", **xtop_site})
        site_caps = self.workspace / "site-caps.json"
        _write_json(site_caps, {"pgVerification": False})
        result = _run("worker-slots", self.workspace, "0")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        packages = {slot: _parked(slot, self.working_state["id"], "workerSlots 0: the full-auto control arm")
                    for slot in workspaces.TASK_IDS}
        self.plan = {"candidate": {"workPackages": packages, "reason": "control arm: every seat parked"},
                     "baseState": self.working_state, "siteCapabilities": {"pgVerification": False}}
        self.plan_path = _write_json_at(self.workspace / "research" / "requests" / "campaign-plan.json", self.plan)
        result = _run("prepare-workers", self.workspace, self.working_state_path, site_caps, eda_profile,
                      self.plan_path)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.workers = json.loads((self.workspace / "state" / "workers.json").read_text())

    def test_the_plan_reader_admits_an_all_parked_plan(self):
        self.assertEqual(read_atcs.problems("campaign-plan", self.plan_path, self.workspace), [])
        (value,) = read_atcs.read("campaign-plan", self.plan_path, self.workspace)
        self.assertEqual(value["value"], 0)
        # workerSlots 0 allows no active seat, so no parked seat is advised to take a cluster.
        advice = read_atcs.advice("campaign-plan", self.plan_path, self.workspace)
        self.assertEqual([line for line in advice if "parked, but workerSlots" in line], [])

    def test_an_active_seat_under_workerslots_zero_is_counted(self):
        plan = json.loads(json.dumps(self.plan))
        plan["candidate"]["workPackages"]["w01"] = _active("w01", self.working_state["id"])
        path = _write_json_at(self.workspace / "research" / "requests" / "campaign-plan.json", plan)
        (line,) = read_atcs.problems("campaign-plan", path, self.workspace)
        self.assertIn("candidate.workPackages.w01: active, but only slots up to workerSlots 0 may be active", line)

    def test_every_branch_takes_the_batch_no_op_and_the_recipe_selects_nothing(self):
        contract = (FLOW_DIR.parent / "contract.yml").read_text(encoding="utf-8")
        for slot in workspaces.TASK_IDS:
            nn = slot[1:]
            with self.subTest(slot=slot):
                self.assertIs(self.workers["workers"][slot]["parked"], True)
                request = _write_json_at(self.workspace / "research" / "requests" / f"worker-request-{slot}.json",
                                         {"candidate": _parked(slot, self.working_state["id"],
                                                               "workerSlots 0: the full-auto control arm"),
                                          "baseState": self.working_state,
                                          "siteCapabilities": {"pgVerification": False}})
                values = {value["type"]: value["value"]
                          for value in read_atcs.read("worker-request", request, self.workspace, [slot])}
                self.assertEqual(values, {"tc_request_invalid_count": 0, "tc_slot_parked": 1})
                team = contract.split(f"  - id: atcs-worker-{nn}\n", 1)[1].split("\n  - id: ", 1)[0]
                self.assertIn(f"{{ input: workerRequest{nn}, value: tc_slot_parked, equals: 1 }}", team)
                result = _run("operate-parked", self.workspace, slot)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                result = _run("capture-contribution", self.workspace, slot)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                contribution = core.read_artifact(self.workspace / "state" / f"contribution-{slot}.json",
                                                  "contribution")
                self.assertEqual([contribution["kind"], contribution["parked"], contribution["admissible"]],
                                 ["no-fix", True, True])
        result = _run("collect", self.workspace)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        collected = json.loads((self.workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(sorted(c["taskId"] for c in collected["contributions"]), list(workspaces.TASK_IDS))
        self.assertEqual(collected["pending"], [])
        result = _run("compose-facts", self.workspace, self.workspace / "research" / "requests" / "integration-plan.json")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        facts = core.read_artifact(self.workspace / "state" / "composition-facts.json", "composition-facts")
        self.assertEqual(facts["recipe"]["sessions"], [], "no seat contributed, so the batch is auto-finish alone")


if __name__ == "__main__":
    unittest.main()
