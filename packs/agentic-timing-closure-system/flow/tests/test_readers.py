"""Tests for `tools/read-atcs.py`, the Pack's one fail-closed Reader script.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_readers.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Every test builds its fixtures through the real `atcs.*` producers (never
hand-rolled JSON with a guessed `id`), then either calls `read_atcs.read(...)`
directly (unit level) or shells out to `tools/read-atcs.py` as a real
subprocess (process level, for the "exits non-zero, writes nothing" claims).
A fresh temporary directory stands in for the Campaign workspace; a symlink
`<workspace>/flow/atcs` points at this repo's real `flow/atcs` package so
`read-atcs.py`'s own `${WORKSPACE}`-relative import
(`_atcs_modules`/`sys.path.insert(0, "<workspace>/flow")`) resolves exactly
as it would once a real Campaign deploys this Pack's `workspace.copy` under
its own `<workspace>/flow/`.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))

from atcs import core  # noqa: E402
from atcs import state  # noqa: E402
from atcs import workspaces  # noqa: E402
from atcs import integration  # noqa: E402
from atcs import verification  # noqa: E402
from atcs import adoption  # noqa: E402
from atcs import refresh  # noqa: E402

READ_ATCS_PATH = PACK_DIR / "tools" / "read-atcs.py"

_spec = importlib.util.spec_from_file_location("read_atcs", READ_ATCS_PATH)
read_atcs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(read_atcs)


def _make_workspace(tmp_root):
    """A fresh Campaign-workspace-shaped directory with `flow/atcs` symlinked in."""
    workspace = Path(tmp_root) / "workspace"
    (workspace / "flow").mkdir(parents=True)
    os.symlink(FLOW_DIR / "atcs", workspace / "flow" / "atcs")
    return workspace


def _write(path, text=""):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _build_design_state(workspace, name="baseline"):
    """A real `design-state` artifact over real files under `workspace`."""
    root = workspace / "inputs" / name
    _write(root / "top.enc", "encrypted-checkpoint")
    _write(root / "top.enc.dat" / "cells.dat", "cell-data")
    _write(root / "top.v", "module top; endmodule")
    _write(root / "func_ssg_rcworst_m40.spef", "*SPEF ...")
    _write(root / "top.sdc", "create_clock ...")

    manifest = {
        "top": "top",
        "stage": "postroute",
        "root": str(root),
        "database": {"enc": "top.enc", "encDat": "top.enc.dat"},
        "netlist": "top.v",
        "spef": {"m40": "func_ssg_rcworst_m40.spef"},
        "sdc": ["top.sdc"],
        "scenarios": [{"name": "func_ssg_rcworst_m40", "corner": "m40"}],
    }
    design_state = state.design_state(manifest)

    # `design_state`'s own output stores paths as given in the manifest
    # (relative to `manifest["root"]`), but this script resolves every
    # reference against `${WORKSPACE}` — so for this fixture, campaign-relative
    # paths are rewritten onto `workspace` itself (a real producer would build
    # `root` as a campaign-relative directory from the start).
    campaign_relative_root = root.relative_to(workspace)
    design_state["database"]["path"] = str(campaign_relative_root / "top.enc")
    design_state["netlist"]["path"] = str(campaign_relative_root / "top.v")
    design_state["spef"]["m40"]["path"] = str(campaign_relative_root / "func_ssg_rcworst_m40.spef")
    design_state["sdc"][0]["path"] = str(campaign_relative_root / "top.sdc")
    # Re-stamp: the path rewrite above changes the body, so `id` must be
    # recomputed the same way `core.stamp` would (this is fixture plumbing,
    # not something a real producer needs, since a real one builds
    # campaign-relative paths from the start).
    return core.stamp("design-state", {k: v for k, v in design_state.items() if k not in ("schema", "id")})


class ReadinessReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _write_report(self, obj):
        path = self.workspace / "flow" / "records" / "readiness.json"
        core.write_artifact(path, obj)
        return path

    def test_complete_readiness_emits_zero_missing_and_lifecycle_known(self):
        obj = core.stamp("input-readiness", {
            "missing": [],
            "missingCount": core.known(0),
            "lifecycleAvailable": core.known(1),
            "lifecycleMissing": [],
            "scope": "full-flow",
        })
        report = self._write_report(obj)
        values = read_atcs.read("readiness", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_required_input_missing_count"]["value"], 0)
        self.assertEqual(by_type["tc_lifecycle_available"]["value"], 1)
        self.assertEqual({v["type"] for v in values}, {"tc_required_input_missing_count", "tc_lifecycle_available"})

    def test_missing_count_zero_but_missing_list_nonempty_is_refused(self):
        """tc_required_input_missing_count is 0 only from a genuinely complete document."""
        obj = core.stamp("input-readiness", {
            "missing": ["database.enc"],
            "missingCount": core.known(0),  # tampered / inconsistent with `missing`
            "lifecycleAvailable": core.known(0),
            "lifecycleMissing": ["lifecycle not provided"],
            "scope": "post-route-only",
        })
        report = self._write_report(obj)
        with self.assertRaises(ValueError):
            read_atcs.read("readiness", report, self.workspace)

    def test_incomplete_readiness_reports_positive_missing_count(self):
        obj = core.stamp("input-readiness", {
            "missing": ["database.enc", "sdc"],
            "missingCount": core.known(2),
            "lifecycleAvailable": core.known(0),
            "lifecycleMissing": ["lifecycle not provided"],
            "scope": "post-route-only",
        })
        report = self._write_report(obj)
        values = read_atcs.read("readiness", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_required_input_missing_count"]["value"], 2)
        self.assertEqual(by_type["tc_lifecycle_available"]["value"], 0)

    def test_tampered_identity_is_refused(self):
        obj = core.stamp("input-readiness", {
            "missing": [], "missingCount": core.known(0),
            "lifecycleAvailable": core.known(0), "lifecycleMissing": ["x"], "scope": "post-route-only",
        })
        report = self._write_report(obj)
        tampered = json.loads(report.read_text())
        tampered["missingCount"] = {"value": 999}
        report.write_text(json.dumps(tampered))
        with self.assertRaises(ValueError):
            read_atcs.read("readiness", report, self.workspace)

    def test_wrong_schema_is_refused(self):
        obj = core.stamp("evaluation", {"finalSetupWns": core.known(0.0)})
        report = self._write_report(obj)
        with self.assertRaises(ValueError):
            read_atcs.read("readiness", report, self.workspace)


class SubprocessIdentityTest(unittest.TestCase):
    """Process-level checks: a fail-closed reader exits non-zero and writes nothing."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _run(self, kind, report, out, extra=()):
        return subprocess.run(
            [sys.executable, str(READ_ATCS_PATH), kind, str(report), str(out), str(self.workspace), *extra],
            capture_output=True, text=True,
        )

    def test_tampered_artifact_exits_nonzero_and_writes_no_output(self):
        obj = core.stamp("input-readiness", {
            "missing": [], "missingCount": core.known(0),
            "lifecycleAvailable": core.known(0), "lifecycleMissing": ["x"], "scope": "post-route-only",
        })
        report = self.workspace / "flow" / "records" / "readiness.json"
        core.write_artifact(report, obj)
        tampered = json.loads(report.read_text())
        tampered["id"] = "0" * 20
        report.write_text(json.dumps(tampered))

        out = self.workspace / "out.json"
        result = self._run("readiness", report, out)

        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertFalse(out.exists())

    def test_valid_artifact_exits_zero_and_writes_declared_values(self):
        obj = core.stamp("input-readiness", {
            "missing": [], "missingCount": core.known(0),
            "lifecycleAvailable": core.known(1), "lifecycleMissing": [], "scope": "full-flow",
        })
        report = self.workspace / "flow" / "records" / "readiness.json"
        core.write_artifact(report, obj)
        out = self.workspace / "out.json"

        result = self._run("readiness", report, out)

        self.assertEqual(result.returncode, 0, result.stderr)
        document = json.loads(out.read_text())
        self.assertEqual({v["type"] for v in document["values"]},
                          {"tc_required_input_missing_count", "tc_lifecycle_available"})

    def test_source_file_sha256_changed_exits_nonzero(self):
        design = _build_design_state(self.workspace)
        candidate = {
            "taskId": "w01", "baseStateId": design["id"], "problem": "x",
            "targets": [], "editDomain": {"instances": [], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [],
            "actions": ["size_cell"], "budget": {"xtopMinutes": 5, "queries": 1, "attempts": 1},
        }
        envelope = {"candidate": candidate, "baseState": design, "siteCapabilities": {}}
        report = self.workspace / "flow" / "records" / "work-package.json"
        _write(report, json.dumps(envelope))

        # Corrupt the referenced netlist file after the envelope was built.
        (self.workspace / design["netlist"]["path"]).write_text("tampered-netlist")

        out = self.workspace / "out.json"
        result = self._run("work-package", report, out)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertFalse(out.exists())


class WorkPackageReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace)

    def _write_envelope(self, candidate, site_capabilities=None):
        envelope = {"candidate": candidate, "baseState": self.design, "siteCapabilities": site_capabilities or {}}
        report = self.workspace / "flow" / "records" / "work-package.json"
        _write(report, json.dumps(envelope))
        return report

    def _valid_candidate(self, **overrides):
        candidate = {
            "taskId": "w01",
            "baseStateId": self.design["id"],
            "problem": "hold violation on endpoint X",
            "targets": ["func_ssg_rcworst_m40|hold|X"],
            "editDomain": {"instances": ["U1"], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []},
            "mayAffect": [],
            "actions": ["size_cell"],
            "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3},
        }
        candidate.update(overrides)
        return candidate

    def test_valid_work_package_has_zero_invalid_count(self):
        report = self._write_envelope(self._valid_candidate())
        values = read_atcs.read("work-package", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_request_invalid_count", "unit": "count", "value": 0}])

    def test_invalid_action_kind_is_counted(self):
        report = self._write_envelope(self._valid_candidate(actions=["not-a-real-action"]))
        values = read_atcs.read("work-package", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_pg_local_adjust_without_capability_is_counted(self):
        report = self._write_envelope(self._valid_candidate(actions=["pg_local_adjust"]), site_capabilities={})
        values = read_atcs.read("work-package", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_pg_local_adjust_with_capability_is_admitted(self):
        report = self._write_envelope(
            self._valid_candidate(actions=["pg_local_adjust"]), site_capabilities={"pgVerification": True}
        )
        values = read_atcs.read("work-package", report, self.workspace)
        self.assertEqual(values[0]["value"], 0)

    def test_wrong_task_id_for_slot_is_refused(self):
        report = self._write_envelope(self._valid_candidate(taskId="w01"))
        with self.assertRaises(ValueError):
            read_atcs.read("worker-request", report, self.workspace, extra=["w02"])

    def test_tampered_base_state_is_refused(self):
        tampered_design = dict(self.design)
        tampered_design["top"] = "not-the-real-top"  # id no longer matches
        report = self._write_envelope(self._valid_candidate(), )
        envelope = json.loads(report.read_text())
        envelope["baseState"] = tampered_design
        report.write_text(json.dumps(envelope))
        with self.assertRaises(ValueError):
            read_atcs.read("work-package", report, self.workspace)


class CampaignPlanReaderTest(unittest.TestCase):
    """Task 12c item 4a: the `campaign-plan` reader kind counts problems across
    all three work packages (`workspaces.request_invalid_count`), not just
    slot w01's own package. Fix round 2 item 3: it also counts a top-level
    `workPackages` key (a second, unenforced copy) and a `baseState` whose
    id disagrees with `state/working-state.json`'s current one."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace)
        # Fix round 2 item 3's own check needs a real, current state/working-state.json
        # to compare envelope.baseState against; every "zero problems" case in this class
        # keeps it matching self.design, and the dedicated mismatch tests below diverge it.
        core.write_artifact(self.workspace / "state" / "working-state.json", self.design)

    def _valid_package(self, task_id):
        return {
            "taskId": task_id, "baseStateId": self.design["id"], "problem": "hold violation",
            "targets": ["func_ssg_rcworst_m40|hold|X"], "editDomain": {"instances": ["U1"], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3},
        }

    def _write_envelope(self, work_packages, reason="close the campaign's targeted checks", site_capabilities=None):
        envelope = {
            "candidate": {"workPackages": work_packages, "reason": reason},
            "baseState": self.design, "siteCapabilities": site_capabilities or {},
        }
        report = self.workspace / "flow" / "records" / "campaign-plan.json"
        _write(report, json.dumps(envelope))
        return report

    def test_three_valid_packages_have_zero_invalid_count(self):
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        report = self._write_envelope(packages)
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_request_invalid_count", "unit": "count", "value": 0}])

    def test_a_problem_in_w03_is_counted(self):
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        packages["w03"]["actions"] = ["not-a-real-action"]
        report = self._write_envelope(packages)
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_missing_slot_is_counted(self):
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02")}  # w03 missing
        report = self._write_envelope(packages)
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_blank_reason_is_counted(self):
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        report = self._write_envelope(packages, reason="   ")
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_tampered_base_state_is_refused(self):
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        report = self._write_envelope(packages)
        envelope = json.loads(report.read_text())
        envelope["baseState"] = dict(self.design, top="not-the-real-top")
        report.write_text(json.dumps(envelope))
        with self.assertRaises(ValueError):
            read_atcs.read("campaign-plan", report, self.workspace)

    def test_top_level_workpackages_key_is_counted(self):
        """Fix round 2 item 3: a second, top-level copy is a problem even when it is
        byte-identical to candidate.workPackages -- prepare-workers refuses it outright."""
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        report = self._write_envelope(packages)
        envelope = json.loads(report.read_text())
        envelope["workPackages"] = packages  # identical copy -- still a problem
        report.write_text(json.dumps(envelope))
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_base_state_disagreeing_with_working_state_is_counted(self):
        """Fix round 2 item 3: a baseState snapshot that no longer matches the campaign's
        CURRENT state/working-state.json is a stale-plan problem."""
        other_design = _build_design_state(self.workspace, name="other")
        core.write_artifact(self.workspace / "state" / "working-state.json", other_design)
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        report = self._write_envelope(packages)  # envelope.baseState is still self.design
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_missing_working_state_is_counted_not_treated_as_a_match(self):
        """Fix round 2 item 3: an unreadable/missing state/working-state.json can never be
        silently treated as "matches" -- it is itself counted as a problem."""
        (self.workspace / "state" / "working-state.json").unlink()
        packages = {task_id: self._valid_package(task_id) for task_id in ("w01", "w02", "w03")}
        report = self._write_envelope(packages)
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)


class WorkerResultReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _write_contribution(self, predicted=None, task_id="w01", script=None):
        body = {
            "taskId": task_id, "revision": 1, "baseStateId": "a" * 20, "kind": "fix",
            "operations": [], "script": script,
            "delta": {"mastersChanged": {}, "added": {}, "removed": {}},
            "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": predicted or {}, "validationLevel": "xtop", "diagnosis": None,
            "admissible": True, "refusals": [], "outOfScope": [], "beforeDumpSha256": "b" * 64,
        }
        obj = core.stamp("contribution", body)
        report = self.workspace / "flow" / "records" / "result.json"
        core.write_artifact(report, obj)
        return report

    def test_predicted_measures_pass_through(self):
        predicted = {
            "xtopSetupWns": core.known(-0.05), "xtopHoldWns": core.known(0.01),
            "prestaSetupWns": core.known(-0.02), "prestaHoldWns": core.known(0.02),
        }
        report = self._write_contribution(predicted=predicted)
        values = read_atcs.read("worker-result", report, self.workspace, extra=["w01"])
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_xtop_setup_wns_ns"]["value"], -0.05)
        self.assertEqual(by_type["tc_xtop_setup_wns_ns"]["mode"], "setup")
        self.assertEqual(by_type["tc_xtop_hold_wns_ns"]["mode"], "hold")

    def test_missing_predicted_values_are_unknown_never_zero(self):
        report = self._write_contribution(predicted={})
        values = read_atcs.read("worker-result", report, self.workspace, extra=["w01"])
        for value in values:
            self.assertIsNone(value["value"])
            self.assertTrue(value.get("unknownReason"))

    def test_wrong_slot_is_refused(self):
        report = self._write_contribution(task_id="w01")
        with self.assertRaises(ValueError):
            read_atcs.read("worker-result", report, self.workspace, extra=["w02"])

    def test_missing_script_file_is_refused(self):
        report = self._write_contribution(script={"path": "does/not/exist.tcl", "sha256": "c" * 64})
        with self.assertRaises(ValueError):
            read_atcs.read("worker-result", report, self.workspace, extra=["w01"])


class ContributionIndexReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _contribution(self, kind="fix", admissible=True):
        body = {
            "taskId": "w01", "revision": 1, "baseStateId": "a" * 20, "kind": kind,
            "operations": [], "script": None,
            "delta": {"mastersChanged": {}, "added": {}, "removed": {}},
            "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {}, "validationLevel": "none", "diagnosis": None,
            "admissible": admissible, "refusals": [], "outOfScope": [], "beforeDumpSha256": "b" * 64,
        }
        return core.stamp("contribution", body)

    def test_ready_count_excludes_no_fix_and_inadmissible(self):
        envelope = {
            "contributions": [
                self._contribution(kind="fix", admissible=True),
                self._contribution(kind="fix", admissible=False),
                self._contribution(kind="no-fix", admissible=True),
            ],
            "pending": ["w02", "w03"],
        }
        report = self.workspace / "flow" / "records" / "contribution-index.json"
        _write(report, json.dumps(envelope))
        values = read_atcs.read("contribution-index", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_ready_contribution_count"]["value"], 1)
        self.assertEqual(by_type["tc_pending_research_count"]["value"], 2)


class CompositionFactsReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def test_unresolved_conflict_count_passes_through(self):
        obj = core.stamp("composition-facts", {
            "baseStateId": "a" * 20, "considered": ["c1"], "duplicates": [],
            "conflicts": [{"key": "k1", "kind": "name-collision", "contributions": ["c1"], "objects": []}],
            "interactions": [], "staleBase": [], "order": ["c1"], "unresolvedCount": 1,
        })
        report = self.workspace / "flow" / "records" / "facts.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("composition-facts", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_unresolved_conflict_count", "unit": "count", "value": 1}])

    def test_unresolved_count_exceeding_conflicts_is_refused(self):
        obj = core.stamp("composition-facts", {
            "baseStateId": "a" * 20, "considered": [], "duplicates": [],
            "conflicts": [], "interactions": [], "staleBase": [], "order": [], "unresolvedCount": 5,
        })
        report = self.workspace / "flow" / "records" / "facts.json"
        core.write_artifact(report, obj)
        with self.assertRaises(ValueError):
            read_atcs.read("composition-facts", report, self.workspace)


class IntegrationPlanReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def test_valid_plan_against_facts(self):
        facts = core.stamp("composition-facts", {
            "baseStateId": "a" * 20, "considered": ["c1", "c2"], "duplicates": [],
            "conflicts": [], "interactions": [], "staleBase": [], "order": ["c1", "c2"], "unresolvedCount": 0,
        })
        plan = {"batchId": "b1", "baseStateId": "a" * 20, "select": ["c1"], "resolutions": [], "deferred": ["c2"], "reason": "x"}
        envelope = {"plan": plan, "facts": facts}
        report = self.workspace / "flow" / "records" / "plan-review.json"
        _write(report, json.dumps(envelope))
        values = read_atcs.read("integration-plan", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)
        self.assertEqual(by_type["tc_selected_contribution_count"]["value"], 1)

    def test_select_id_not_in_considered_is_counted_invalid(self):
        facts = core.stamp("composition-facts", {
            "baseStateId": "a" * 20, "considered": ["c1"], "duplicates": [],
            "conflicts": [], "interactions": [], "staleBase": [], "order": ["c1"], "unresolvedCount": 0,
        })
        plan = {"batchId": "b1", "baseStateId": "a" * 20, "select": ["not-considered"], "resolutions": [], "deferred": [], "reason": "x"}
        envelope = {"plan": plan, "facts": facts}
        report = self.workspace / "flow" / "records" / "plan-review.json"
        _write(report, json.dumps(envelope))
        values = read_atcs.read("integration-plan", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertEqual(by_type["tc_selected_contribution_count"]["value"], 1)


class IntegrationStateReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def test_counts_from_lists(self):
        obj = core.stamp("integration-state", {
            "batchId": "b1", "applied": {}, "failed": [], "pending": [],
            "replayMismatch": ["s1"], "outOfScope": ["s2", "s3"], "delta": {},
        })
        report = self.workspace / "flow" / "records" / "state.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("integration-state", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_replay_mismatch_count"]["value"], 1)
        self.assertEqual(by_type["tc_out_of_scope_edit_count"]["value"], 2)


class PrecheckEvidenceReaderTest(unittest.TestCase):
    """Reads a real `atcs.verification.precheck_evidence(...)` artifact — no
    envelope, as of this task's review round (Controller decision 2)."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _merge_commit(self, new_nets):
        return core.stamp("merge-commit", {
            "parentStateId": "a" * 20, "contributions": [], "operations": [],
            "innovusEcoTcl": "", "sourceMap": {}, "newNets": new_nets,
        })

    def _write_evidence(self, new_nets, spef_lines):
        spef_path = self.workspace / "inputs" / "spef-net-names.txt"
        _write(spef_path, "\n".join(spef_lines) + ("\n" if spef_lines else ""))
        evidence = verification.precheck_evidence(self._merge_commit(new_nets), spef_path)
        # Rewrite the recorded source path to be workspace-relative (the
        # producer just records whatever path it was given; the caller --
        # here, this fixture, standing in for T12 -- is responsible for
        # passing a workspace-relative one, then re-stamp so `id` reflects it).
        rel = str(spef_path.relative_to(self.workspace))
        evidence = core.stamp("precheck-evidence", {
            **{k: v for k, v in evidence.items() if k not in ("schema", "id")},
            "spefNetNames": {"path": rel, "sha256": evidence["spefNetNames"]["sha256"]},
        })
        report = self.workspace / "flow" / "records" / "precheck.json"
        core.write_artifact(report, evidence)
        return report, spef_path

    def test_all_nets_qualified(self):
        report, _spef = self._write_evidence(["n1", "n2"], ["n1", "n2", "n3"])
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_unqualified_rc_net_count", "unit": "count", "value": 0}])

    def test_some_nets_unqualified(self):
        report, _spef = self._write_evidence(["n1", "n2"], ["n1"])
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertEqual(values[0]["value"], 1)

    def test_missing_spef_source_file_is_unknown_not_zero(self):
        report, spef_path = self._write_evidence(["n1"], ["n1"])
        spef_path.unlink()
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertIsNone(values[0]["value"])
        self.assertTrue(values[0]["unknownReason"])

    def test_no_new_nets_is_known_zero(self):
        report, _spef = self._write_evidence([], [])
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertEqual(values[0]["value"], 0)

    def test_changed_spef_source_is_a_hard_failure(self):
        report, spef_path = self._write_evidence(["n1"], ["n1"])
        spef_path.write_text("n1\nn2\ntampered\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            read_atcs.read("precheck-evidence", report, self.workspace)

    def test_tampered_artifact_id_is_refused(self):
        report, _spef = self._write_evidence(["n1"], ["n1"])
        tampered = json.loads(report.read_text())
        tampered["newNets"] = ["n1", "n9"]
        report.write_text(json.dumps(tampered))
        with self.assertRaises(ValueError):
            read_atcs.read("precheck-evidence", report, self.workspace)


class EvaluationReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def test_full_evaluation_passes_through_measures(self):
        obj = core.stamp("evaluation", {
            "candidateId": "m" * 20, "finalSetupWns": core.known(0.012), "finalHoldWns": core.known(0.003),
            "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
            "constraintFailureCount": core.known(0), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(3), "missingPriorCheckCount": core.known(0),
            "comparison": {}, "physical": {"drc": {}, "connectivity": {}},
        })
        report = self.workspace / "flow" / "records" / "evaluation.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("evaluation", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_final_setup_wns_ns"]["value"], 0.012)
        self.assertEqual(by_type["tc_final_setup_wns_ns"]["mode"], "setup")
        self.assertEqual(by_type["tc_final_hold_wns_ns"]["mode"], "hold")
        self.assertEqual(by_type["tc_fixed_check_count"]["value"], 3)

    def test_unknown_final_wns_is_never_zero(self):
        obj = core.stamp("evaluation", {
            "candidateId": "m" * 20,
            "finalSetupWns": core.unknown("scenario func_ffg_cbest_125 missing"),
            "finalHoldWns": core.unknown("scenario func_ffg_cbest_125 missing"),
            "missingRequiredCheckCount": core.known(1), "finalIdentityErrorCount": core.unknown("leg missing"),
            "constraintFailureCount": core.known(0), "constraintUnknownCount": core.known(0),
            "fixedCheckCount": core.known(0), "missingPriorCheckCount": core.known(0),
            "comparison": {}, "physical": {},
        })
        report = self.workspace / "flow" / "records" / "evaluation.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("evaluation", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_final_setup_wns_ns"]["value"])
        self.assertTrue(by_type["tc_final_setup_wns_ns"]["unknownReason"])
        self.assertIsNone(by_type["tc_final_identity_error_count"]["value"])


_ACCEPTANCE_BASELINE = "baseline-" + "0" * 12
_ACCEPTANCE_POLICY = {
    "allowDegradedWorking": False,
    "degradeLimitNs": 0.0,
    "goal": {"setup": 0.0, "hold": 0.0},
    "baselineStateId": _ACCEPTANCE_BASELINE,
    "baselineMinWns": -1.0,
}
_COMPLETE_EMPTY_COMPARISON = {"remaining": [], "entrant": [], "regressed": []}


def _real_evaluation(state_id):
    """A real, `adoption.publish`-acceptable `evaluation` artifact (mirrors
    `test_adoption.py`'s own `_evaluation` fixture, kept local here so this
    file does not depend on another test module's internals)."""
    return core.stamp("evaluation", {
        "candidateId": state_id, "stateId": state_id, "parentStateId": _ACCEPTANCE_BASELINE,
        "finalSetupWns": core.known(-0.02), "finalHoldWns": core.known(-0.01),
        "missingRequiredCheckCount": core.known(0), "finalIdentityErrorCount": core.known(0),
        "constraintFailureCount": core.known(0), "constraintUnknownCount": core.known(0),
        "comparison": dict(_COMPLETE_EMPTY_COMPARISON),
    })


class AcceptanceRecordReaderTest(unittest.TestCase):
    """Envelope `{"acceptanceRecord": <path>, "refreshLedger": <path>}`
    (Controller decision, Task 13 review round 1) — built through the real
    `atcs.adoption.publish` and `atcs.refresh.record_refresh` producers, not
    hand-stamped fictional shapes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _write_envelope(self, acceptance_rel, ledger_rel):
        envelope = {"acceptanceRecord": acceptance_rel, "refreshLedger": ledger_rel}
        report = self.workspace / "flow" / "records" / "acceptance-review.json"
        _write(report, json.dumps(envelope))
        return report

    def test_ready_and_refresh_count_from_real_producers(self):
        evaluation = _real_evaluation("state-a")
        acceptance_record = adoption.publish(evaluation, _ACCEPTANCE_BASELINE,
                                              self.workspace / "flow" / "state" / "pointers.json",
                                              _ACCEPTANCE_POLICY)
        self.assertEqual(acceptance_record["decision"], "best")
        acceptance_path = self.workspace / "flow" / "records" / "acceptance-record.json"
        core.write_artifact(acceptance_path, acceptance_record)

        ledger_path = self.workspace / "flow" / "state" / "refresh-ledger.json"
        refresh.record_refresh(ledger_path, "candidate-mc-1", "state-a", {
            scenario: {"path": f"flow/records/sta/{scenario}.rpt", "sha256": f"{i:064x}"}
            for i, scenario in enumerate(verification.REQUIRED_SCENARIOS)
        })

        report = self._write_envelope(
            str(acceptance_path.relative_to(self.workspace)),
            str(ledger_path.relative_to(self.workspace)),
        )
        values = read_atcs.read("acceptance-record", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        # No `database` ref on this fixture's evaluation -> `publish` itself
        # reports `acceptedArtifactReady` unknown ("missing-database-ref");
        # this reader's job is to pass that Measure through faithfully, not
        # to guess a value `publish` never established.
        self.assertFalse(core.is_known(acceptance_record["acceptedArtifactReady"]))
        self.assertIsNone(by_type["tc_accepted_artifact_ready"]["value"])
        self.assertTrue(by_type["tc_accepted_artifact_ready"]["unknownReason"])
        self.assertEqual(by_type["tc_refresh_count"]["value"], 1)

    def test_verified_empty_ledger_is_known_zero(self):
        evaluation = _real_evaluation("state-b")
        acceptance_record = adoption.publish(evaluation, _ACCEPTANCE_BASELINE,
                                              self.workspace / "flow" / "state" / "pointers.json",
                                              _ACCEPTANCE_POLICY)
        acceptance_path = self.workspace / "flow" / "records" / "acceptance-record.json"
        core.write_artifact(acceptance_path, acceptance_record)

        ledger_path = self.workspace / "flow" / "state" / "refresh-ledger.json"
        core.write_artifact(ledger_path, refresh.load_ledger(ledger_path))  # verified, genuinely empty

        report = self._write_envelope(
            str(acceptance_path.relative_to(self.workspace)),
            str(ledger_path.relative_to(self.workspace)),
        )
        values = read_atcs.read("acceptance-record", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_refresh_count"]["value"], 0)

    def test_missing_ledger_is_unknown_not_zero(self):
        evaluation = _real_evaluation("state-c")
        acceptance_record = adoption.publish(evaluation, _ACCEPTANCE_BASELINE,
                                              self.workspace / "flow" / "state" / "pointers.json",
                                              _ACCEPTANCE_POLICY)
        acceptance_path = self.workspace / "flow" / "records" / "acceptance-record.json"
        core.write_artifact(acceptance_path, acceptance_record)

        report = self._write_envelope(
            str(acceptance_path.relative_to(self.workspace)),
            "flow/state/never-written-ledger.json",
        )
        values = read_atcs.read("acceptance-record", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_refresh_count"]["value"])
        self.assertTrue(by_type["tc_refresh_count"]["unknownReason"])

    def test_tampered_ledger_identity_is_refused(self):
        evaluation = _real_evaluation("state-d")
        acceptance_record = adoption.publish(evaluation, _ACCEPTANCE_BASELINE,
                                              self.workspace / "flow" / "state" / "pointers.json",
                                              _ACCEPTANCE_POLICY)
        acceptance_path = self.workspace / "flow" / "records" / "acceptance-record.json"
        core.write_artifact(acceptance_path, acceptance_record)

        ledger_path = self.workspace / "flow" / "state" / "refresh-ledger.json"
        refresh.record_refresh(ledger_path, "candidate-mc-1", "state-d", {
            scenario: {"path": f"flow/records/sta/{scenario}.rpt", "sha256": f"{i:064x}"}
            for i, scenario in enumerate(verification.REQUIRED_SCENARIOS)
        })
        tampered = json.loads(ledger_path.read_text())
        tampered["entries"] = []
        ledger_path.write_text(json.dumps(tampered))

        report = self._write_envelope(
            str(acceptance_path.relative_to(self.workspace)),
            str(ledger_path.relative_to(self.workspace)),
        )
        with self.assertRaises(ValueError):
            read_atcs.read("acceptance-record", report, self.workspace)

    def test_refused_decision_never_reports_ready_as_zero_by_default(self):
        evaluation = _real_evaluation("state-e")
        evaluation = core.stamp("evaluation", {
            **{k: v for k, v in evaluation.items() if k not in ("schema", "id")},
            "constraintFailureCount": core.unknown("not measured"),
        })
        acceptance_record = adoption.publish(evaluation, _ACCEPTANCE_BASELINE,
                                              self.workspace / "flow" / "state" / "pointers.json",
                                              _ACCEPTANCE_POLICY)
        self.assertEqual(acceptance_record["decision"], "refused")
        acceptance_path = self.workspace / "flow" / "records" / "acceptance-record.json"
        core.write_artifact(acceptance_path, acceptance_record)
        ledger_path = self.workspace / "flow" / "state" / "refresh-ledger.json"
        core.write_artifact(ledger_path, refresh.load_ledger(ledger_path))

        report = self._write_envelope(
            str(acceptance_path.relative_to(self.workspace)),
            str(ledger_path.relative_to(self.workspace)),
        )
        values = read_atcs.read("acceptance-record", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_accepted_artifact_ready"]["value"])
        self.assertTrue(by_type["tc_accepted_artifact_ready"]["unknownReason"])


class NextDecisionReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.state_ref = core.digest({"marker": "state"})
        self.observation_ref = core.digest({"marker": "observation"})
        _write(self.workspace / "flow" / "records" / "state.json",
               json.dumps({"schema": "atcs.design-state/1", "id": self.state_ref, "marker": "state"}))
        _write(self.workspace / "flow" / "records" / "observation.json",
               json.dumps({"schema": "atcs.observation-set/1", "id": self.observation_ref, "marker": "observation"}))

    def _decision(self, **overrides):
        decision = {
            "stateRef": self.state_ref, "observationRef": self.observation_ref, "budgetRef": "budget-1",
            "question": "is the candidate clean?", "action": "observe", "targets": [],
            "reason": "need one more PT query", "falsifier": "if slack worsens, stop",
            "costBasis": {"queries": 1}, "requiredArtifacts": [],
        }
        decision.update(overrides)
        return decision

    def _write_decision(self, decision):
        report = self.workspace / "flow" / "records" / "next-decision.json"
        _write(report, json.dumps(decision))
        return report

    def test_each_of_the_eight_actions_encodes_and_matches_stop_required(self):
        codes = {
            "observe": 1, "research": 2, "compose": 3, "revise": 4,
            "implement": 5, "earlier-apr": 6, "wait": 7, "goal-met": 8,
        }
        for action, code in codes.items():
            extra = {"stage": "postroute"} if action == "earlier-apr" else {}
            report = self._write_decision(self._decision(action=action, **extra))
            values = read_atcs.read("next-decision", report, self.workspace)
            by_type = {v["type"]: v for v in values}
            self.assertEqual(by_type["tc_next_action"]["value"], code, action)
            self.assertEqual(by_type["tc_stop_required"]["value"], 1 if code == 7 else 0, action)
            self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0, action)

    def test_earlier_apr_requires_a_declared_stage(self):
        for stage in ("place", "cts", "route", "postroute"):
            report = self._write_decision(self._decision(action="earlier-apr", stage=stage))
            by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
            self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0, stage)
            self.assertEqual(by_type["tc_next_action"]["value"], 6, stage)
        for bad in ({}, {"stage": "floorplan"}, {"stage": None}):
            report = self._write_decision(self._decision(action="earlier-apr", **bad))
            by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
            self.assertEqual(by_type["tc_request_invalid_count"]["value"], 1, bad)
            self.assertIsNone(by_type["tc_next_action"]["value"], bad)

    def test_stage_is_not_required_for_other_actions(self):
        report = self._write_decision(self._decision(action="implement"))
        by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)

    def test_action_outside_the_eight_is_unknown_not_a_guess(self):
        report = self._write_decision(self._decision(action="freelance"))
        values = read_atcs.read("next-decision", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_next_action"]["value"])
        self.assertTrue(by_type["tc_next_action"]["unknownReason"])
        self.assertIsNone(by_type["tc_stop_required"]["value"])
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)

    def test_missing_field_counts_as_invalid_and_makes_action_unknown(self):
        decision = self._decision()
        del decision["falsifier"]
        report = self._write_decision(decision)
        values = read_atcs.read("next-decision", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertIsNone(by_type["tc_next_action"]["value"])

    def test_unresolvable_state_ref_is_counted_invalid(self):
        report = self._write_decision(self._decision(stateRef="f" * 20))
        values = read_atcs.read("next-decision", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertIsNone(by_type["tc_next_action"]["value"])


class ObservationRequestReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _report(self, obj):
        report = self.workspace / "flow" / "records" / "observation-request.json"
        _write(report, json.dumps(obj))
        return report

    def test_valid_request_is_zero(self):
        report = self._report({
            "designStateId": "a" * 20, "precision": "pba",
            "requiredScenarios": ["func_ssg_rcworst_m40"], "maxPaths": 50,
        })
        values = read_atcs.read("observation-request", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_request_invalid_count", "unit": "count", "value": 0}])

    def test_bad_precision_is_counted(self):
        report = self._report({
            "designStateId": "a" * 20, "precision": "fast",
            "requiredScenarios": ["func_ssg_rcworst_m40"], "maxPaths": 50,
        })
        values = read_atcs.read("observation-request", report, self.workspace)
        self.assertGreaterEqual(values[0]["value"], 1)


class SemanticsCoverageTest(unittest.TestCase):
    """Every `tc_*` row of SPEC.md's Semantics table is declared in semantics.yml
    and emitted by at least one reader's `emits` list."""

    SPEC_VALUE_TYPES = {
        "tc_required_input_missing_count", "tc_lifecycle_available", "tc_request_invalid_count",
        "tc_pending_research_count", "tc_ready_contribution_count", "tc_replay_mismatch_count",
        "tc_unresolved_conflict_count", "tc_out_of_scope_edit_count", "tc_unqualified_rc_net_count",
        "tc_xtop_setup_wns_ns", "tc_xtop_hold_wns_ns", "tc_presta_setup_wns_ns", "tc_presta_hold_wns_ns",
        "tc_final_setup_wns_ns", "tc_final_hold_wns_ns", "tc_missing_required_check_count",
        "tc_final_identity_error_count", "tc_applicable_constraint_failure_count",
        "tc_applicable_constraint_unknown_count", "tc_fixed_check_count", "tc_missing_prior_check_count",
        "tc_refresh_count", "tc_accepted_artifact_ready", "tc_stop_required", "tc_next_action",
        "tc_selected_contribution_count",
    }

    def _load_yaml_light(self, path):
        """Minimal `emits:`/top-level-key extraction, stdlib-only (no `yaml` dependency)."""
        text = Path(path).read_text(encoding="utf-8")
        lines = text.splitlines()
        result = {}
        i = 0
        while i < len(lines):
            line = lines[i]
            if line.startswith("emits:"):
                items = []
                i += 1
                while i < len(lines) and lines[i].startswith("  - "):
                    items.append(lines[i][4:].strip())
                    i += 1
                result["emits"] = items
                continue
            if line.startswith("id:"):
                result["id"] = line.split(":", 1)[1].strip()
            i += 1
        return result

    def test_semantics_yml_declares_every_spec_value(self):
        semantics_text = (PACK_DIR / "semantics.yml").read_text(encoding="utf-8")
        for value_type in self.SPEC_VALUE_TYPES:
            self.assertIn(f"\n  {value_type}:\n", "\n" + semantics_text, value_type)

    def test_every_spec_value_is_emitted_by_some_reader(self):
        readers_dir = PACK_DIR / "readers"
        emitted = set()
        for reader_yml in sorted(readers_dir.glob("*.yml")):
            declared = self._load_yaml_light(reader_yml)
            emitted.update(declared.get("emits", []))
        missing = self.SPEC_VALUE_TYPES - emitted
        self.assertEqual(missing, set(), f"tc_* values with no reader: {sorted(missing)}")
        extra = emitted - self.SPEC_VALUE_TYPES
        self.assertEqual(extra, set(), f"readers emit undeclared tc_* values: {sorted(extra)}")

    def test_every_reader_yml_names_the_shared_script(self):
        readers_dir = PACK_DIR / "readers"
        for reader_yml in sorted(readers_dir.glob("*.yml")):
            text = reader_yml.read_text(encoding="utf-8")
            self.assertIn("file: tools/read-atcs.py", text, reader_yml.name)


if __name__ == "__main__":
    unittest.main()
