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
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _report(self, envelope):
        report = self.workspace / "flow" / "records" / "precheck.json"
        _write(report, json.dumps(envelope))
        return report

    def test_all_nets_qualified(self):
        report = self._report({"newNets": ["n1", "n2"], "spefNetNames": ["n1", "n2", "n3"]})
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_unqualified_rc_net_count", "unit": "count", "value": 0}])

    def test_unreadable_spef_net_list_is_unknown_not_zero(self):
        report = self._report({"newNets": ["n1"], "spefNetNames": None})
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertIsNone(values[0]["value"])
        self.assertTrue(values[0]["unknownReason"])

    def test_no_new_nets_is_known_zero(self):
        report = self._report({"newNets": [], "spefNetNames": None})
        values = read_atcs.read("precheck-evidence", report, self.workspace)
        self.assertEqual(values[0]["value"], 0)


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


class AcceptanceRecordReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def test_ready_and_refresh_count(self):
        obj = core.stamp("acceptance-record", {
            "decision": "best", "pointersBefore": {"history": []},
            "pointersAfter": {"history": [{"acceptanceRecordId": "r1"}, {"acceptanceRecordId": "r2"}]},
            "acceptedArtifactReady": core.known(1), "reason": "ok",
        })
        report = self.workspace / "flow" / "records" / "acceptance.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("acceptance-record", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_accepted_artifact_ready"]["value"], 1)
        self.assertEqual(by_type["tc_refresh_count"]["value"], 2)

    def test_refused_decision_never_reports_ready_as_zero_by_default(self):
        obj = core.stamp("acceptance-record", {
            "decision": "refused", "pointersBefore": {"history": []},
            "pointersAfter": {"history": []},
            "acceptedArtifactReady": core.unknown("no database ref"), "reason": "not clean",
        })
        report = self.workspace / "flow" / "records" / "acceptance.json"
        core.write_artifact(report, obj)
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
            report = self._write_decision(self._decision(action=action))
            values = read_atcs.read("next-decision", report, self.workspace)
            by_type = {v["type"]: v for v in values}
            self.assertEqual(by_type["tc_next_action"]["value"], code, action)
            self.assertEqual(by_type["tc_stop_required"]["value"], 1 if code == 7 else 0, action)
            self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0, action)

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
