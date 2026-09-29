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
from atcs import composition  # noqa: E402
from atcs import integration  # noqa: E402
from atcs import verification  # noqa: E402
from atcs import adoption  # noqa: E402
from atcs import refresh  # noqa: E402
import atcs_cli  # noqa: E402

READ_ATCS_PATH = PACK_DIR / "tools" / "read-atcs.py"

# Issue #64 Task 4: every work package carries the expert Operator's scope (the Task 3 toolkit
# mutations, at the recipe cap) and its target pins.
EXPERT_SCOPE = {"commands": ["atcs_size_cell", "atcs_insert_buffer", "atcs_fix_hold_pins", "atcs_undo"],
                "maxMutations": 120}

_spec = importlib.util.spec_from_file_location("read_atcs", READ_ATCS_PATH)
read_atcs = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(read_atcs)


def _prepare_slot(workspace, package):
    """What `prepare-workers` leaves for a slot: `state/workers.json[slot].workPackage`, stamped."""
    body = {k: v for k, v in package.items() if k not in ("schema", "id")}
    path = workspace / "state" / "workers.json"
    workers = json.loads(path.read_text()) if path.exists() else {"workers": {}}
    workers["workers"][package["taskId"]] = {"workPackage": core.stamp("work-package", body)}
    _write(path, json.dumps(workers))


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


def _build_design_state(workspace, name="baseline", netlist_text=None):
    """A real `design-state` artifact over real files under `workspace`."""
    root = workspace / "inputs" / name
    _write(root / "top.enc", "encrypted-checkpoint")
    _write(root / "top.enc.dat" / "cells.dat", "cell-data")
    if netlist_text is None:
        # `U1` is a real declared leaf-cell instance directly under `top` so
        # the hierarchical-instance check (T63) admits the bare name
        # `worker-request` tests already use for it; `OUTSIDE` is
        # deliberately never declared.
        netlist_text = "module top;\n  SOME_CELL U1 (.A(a));\nendmodule\n"
    _write(root / "top.v", netlist_text)
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
            "targetPins": [], "scope": dict(EXPERT_SCOPE),
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

    def _write_envelope(self, candidate, site_capabilities=None, prepared=None):
        envelope = {"candidate": candidate, "baseState": self.design, "siteCapabilities": site_capabilities or {}}
        report = self.workspace / "flow" / "records" / "work-package.json"
        _write(report, json.dumps(envelope))
        _prepare_slot(self.workspace, candidate if prepared is None else prepared)
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
            "targetPins": ["U1/A"],
            "scope": dict(EXPERT_SCOPE),
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

    def test_an_expert_worker_request_needs_no_pinned_action_list(self):
        """Issue #64 Task 4: the Team's Reviewer approves a scope, not one of a list of
        sizing actions, so a request is admitted on its package alone."""
        report = self._write_envelope(self._valid_candidate())
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertEqual(values, [{"type": "tc_request_invalid_count", "unit": "count", "value": 0}])

    def test_a_scope_command_outside_the_toolkit_mutations_is_invalid(self):
        for command in ("atcs_ref", "atcs_export_changes", "size_cell", "exec"):
            with self.subTest(command=command):
                scope = {"commands": ["atcs_size_cell", command, "atcs_undo"], "maxMutations": 120}
                report = self._write_envelope(self._valid_candidate(scope=scope))
                values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
                self.assertGreaterEqual(values[0]["value"], 1)

    def test_a_request_without_scope_or_target_pins_is_invalid(self):
        for key in ("scope", "targetPins"):
            with self.subTest(key=key):
                candidate = self._valid_candidate()
                del candidate[key]
                report = self._write_envelope(candidate)
                values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
                self.assertGreaterEqual(values[0]["value"], 1)

    def test_slot_w06_is_accepted_and_w07_is_refused(self):
        report = self._write_envelope(self._valid_candidate(taskId="w06"))
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w06"])
        self.assertEqual(values[0]["value"], 0)
        report = self._write_envelope(self._valid_candidate(taskId="w07"))
        with self.assertRaisesRegex(ValueError, "w07"):
            read_atcs.read("worker-request", report, self.workspace, extra=["w07"])

    def test_a_request_matching_its_prepared_package_is_admitted(self):
        report = self._write_envelope(self._valid_candidate(problem="refined wording", observe="fast"),
                                      prepared=self._valid_candidate())
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertEqual(values[0]["value"], 0)

    def test_regions_are_compared_by_value_not_by_spelling(self):
        """`0` and `0.0` are the same coordinate: an integer region the Workshop copied from a
        prepared float region is not drift."""
        prepared = self._valid_candidate(editDomain={"instances": ["U1"], "nets": [], "regions": [[0.0, 0.0, 10.5, 20.0]]})
        request = self._valid_candidate(editDomain={"instances": ["U1"], "nets": [], "regions": [[0, 0, 10.5, 20]]})
        report = self._write_envelope(request, prepared=prepared)
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertEqual(values[0]["value"], 0)

    def test_a_request_drifting_from_its_prepared_package_is_invalid(self):
        """Review fix round 1: the session Tcl is baked from `state/workers.json[slot].workPackage`,
        so a request whose domain, pins, observation or scope differs would review one scope and run
        another."""
        prepared = self._valid_candidate()
        drifts = {
            "a wider edit domain": {"editDomain": {"instances": ["U1"], "nets": ["n1"], "regions": []}},
            "a narrower edit domain": {"editDomain": {"instances": [], "nets": [], "regions": []}},
            "a new region": {"editDomain": {"instances": ["U1"], "nets": [], "regions": [[0, 0, 1, 1]]}},
            "other target pins": {"targetPins": ["U1/Z"]},
            "another observation mode": {"observe": "full"},
            "a wider scope": {"scope": {"commands": EXPERT_SCOPE["commands"] + ["atcs_move_cell"],
                                        "maxMutations": 120}},
        }
        for label, change in drifts.items():
            with self.subTest(drift=label):
                report = self._write_envelope(self._valid_candidate(**change), prepared=prepared)
                values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
                self.assertGreaterEqual(values[0]["value"], 1, label)

    def test_a_request_for_an_unprepared_slot_is_invalid(self):
        report = self._write_envelope(self._valid_candidate())
        (self.workspace / "state" / "workers.json").unlink()
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertGreaterEqual(values[0]["value"], 1)
        _write(self.workspace / "state" / "workers.json", json.dumps({"workers": {"w02": {}}}))
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_a_tampered_prepared_package_is_invalid(self):
        report = self._write_envelope(self._valid_candidate())
        workers = json.loads((self.workspace / "state" / "workers.json").read_text())
        workers["workers"]["w01"]["workPackage"]["targetPins"] = ["U1/Z"]
        _write(self.workspace / "state" / "workers.json", json.dumps(workers))
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertGreaterEqual(values[0]["value"], 1)

    def test_a_parked_request_matching_its_parked_package_is_admitted(self):
        """Issue #64 Task 5: a parked slot's Workshop writes the parked package as prepared."""
        parked = {"taskId": "w05", "baseStateId": self.design["id"], "parked": True, "problem": "no cluster left"}
        report = self._write_envelope(parked)
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w05"])
        self.assertEqual(values, [{"type": "tc_request_invalid_count", "unit": "count", "value": 0}])

    def test_parking_must_agree_with_the_prepared_package(self):
        parked = {"taskId": "w05", "baseStateId": self.design["id"], "parked": True, "problem": "no cluster left"}
        active = self._valid_candidate(taskId="w05")
        for label, (candidate, prepared) in {
            "a parked request for an active slot": (parked, active),
            "an active request for a parked slot": (active, parked),
        }.items():
            with self.subTest(label):
                report = self._write_envelope(candidate, prepared=prepared)
                values = read_atcs.read("worker-request", report, self.workspace, extra=["w05"])
                self.assertGreaterEqual(values[0]["value"], 1, label)

    def test_a_target_pin_whose_owner_is_not_in_the_netlist_is_refused(self):
        report = self._write_envelope(self._valid_candidate(targetPins=["OUTSIDE/A"]))
        with self.assertRaisesRegex(ValueError, "not a hierarchical pin"):
            read_atcs.read("worker-request", report, self.workspace, extra=["w01"])

    def test_tampered_base_state_is_refused(self):
        tampered_design = dict(self.design)
        tampered_design["top"] = "not-the-real-top"  # id no longer matches
        report = self._write_envelope(self._valid_candidate(), )
        envelope = json.loads(report.read_text())
        envelope["baseState"] = tampered_design
        report.write_text(json.dumps(envelope))
        with self.assertRaises(ValueError):
            read_atcs.read("work-package", report, self.workspace)


class HierarchicalWorkerInstanceReaderTest(unittest.TestCase):
    """T63 real failure: w01 admitted actions naming a bare LEAF instance name
    from a hierarchical post-route netlist (`g96219`, declared inside a
    sub-module, not directly under `top`) -- XTop, opened at `top`, could not
    find it. The expert Operator names edit-domain instances and target pins
    exactly (Issue #64 Task 4), so every one must be a full `/`-separated
    hierarchical path from the base netlist's own top module."""

    HIER_NETLIST = (
        "module top;\n"
        "  SUB_MOD u_sub (.X(x));\n"
        "endmodule\n"
        "module SUB_MOD;\n"
        "  \\CKAN2D2BWP35P140HVT g96219 (.A1(n));\n"
        "endmodule\n"
    )

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace, netlist_text=self.HIER_NETLIST)

    def _write_envelope(self, instance, domain, target_pins=None):
        candidate = {
            "taskId": "w01",
            "baseStateId": self.design["id"],
            "problem": "hold violation on endpoint X",
            "targets": ["func_ssg_rcworst_m40|hold|X"],
            "editDomain": {"instances": domain, "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []},
            "mayAffect": [],
            "actions": ["size_cell"],
            "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3},
            "targetPins": [instance + "/A1"] if target_pins is None else target_pins,
            "scope": dict(EXPERT_SCOPE),
        }
        envelope = {
            "candidate": candidate,
            "baseState": self.design,
            "siteCapabilities": {},
        }
        report = self.workspace / "flow" / "records" / "worker-request.json"
        _write(report, json.dumps(envelope))
        _prepare_slot(self.workspace, candidate)
        return report

    def test_bare_leaf_name_is_refused(self):
        """The real Issue #63 failure: `g96219` alone, admitted by the Reader
        before this fix, is not resolvable against a hierarchical netlist."""
        report = self._write_envelope("g96219", domain=["g96219"])
        with self.assertRaisesRegex(ValueError, "not a hierarchical instance"):
            read_atcs.read("worker-request", report, self.workspace, extra=["w01"])

    def test_full_hierarchical_path_is_admitted(self):
        report = self._write_envelope("u_sub/g96219", domain=["u_sub/g96219"])
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertEqual(values[0]["value"], 0)

    def test_wrong_middle_segment_is_refused(self):
        report = self._write_envelope("wrong_sub/g96219", domain=["wrong_sub/g96219"])
        with self.assertRaisesRegex(ValueError, "not a hierarchical instance"):
            read_atcs.read("worker-request", report, self.workspace, extra=["w01"])

    def test_a_bare_leaf_target_pin_is_refused(self):
        report = self._write_envelope("u_sub/g96219", domain=["u_sub/g96219"], target_pins=["g96219/A1"])
        with self.assertRaisesRegex(ValueError, "not a hierarchical pin"):
            read_atcs.read("worker-request", report, self.workspace, extra=["w01"])

    def test_a_pin_on_a_module_instance_is_refused(self):
        """A target pin names a leaf cell's pin; `u_sub` is a module instance, not a cell."""
        report = self._write_envelope("u_sub/g96219", domain=["u_sub/g96219"], target_pins=["u_sub/X"])
        with self.assertRaisesRegex(ValueError, "not a hierarchical pin"):
            read_atcs.read("worker-request", report, self.workspace, extra=["w01"])

    def test_a_full_hierarchical_target_pin_outside_the_domain_is_admitted(self):
        """Target pins are the blockers' endpoints; they need not be edit-domain cells."""
        report = self._write_envelope("u_sub/g96219", domain=[], target_pins=["u_sub/g96219/A1"])
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertEqual(values[0]["value"], 0)

    def test_escaped_identifier_instance_works(self):
        """`g96219` is declared in the netlist as the Verilog escaped
        identifier `\\CKAN2D2BWP35P140HVT g96219 (...)` is the *cell type*
        here, not the escape target -- exercise an escaped *instance* name
        directly to confirm the leading backslash is stripped when matching."""
        netlist = (
            "module top;\n"
            "  SUB_MOD \\u_sub (.X(x));\n"
            "endmodule\n"
            "module SUB_MOD;\n"
            "  CKAN2D2BWP35P140HVT \\g96219 (.A1(n));\n"
            "endmodule\n"
        )
        design = _build_design_state(self.workspace, name="escaped", netlist_text=netlist)
        candidate = {
            "taskId": "w01",
            "baseStateId": design["id"],
            "problem": "hold violation on endpoint X",
            "targets": ["func_ssg_rcworst_m40|hold|X"],
            "editDomain": {"instances": ["u_sub/g96219"], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []},
            "mayAffect": [],
            "actions": ["size_cell"],
            "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3},
            "targetPins": ["u_sub/g96219/A1"],
            "scope": dict(EXPERT_SCOPE),
        }
        envelope = {
            "candidate": candidate,
            "baseState": design,
            "siteCapabilities": {},
        }
        report = self.workspace / "flow" / "records" / "worker-request-escaped.json"
        _write(report, json.dumps(envelope))
        _prepare_slot(self.workspace, candidate)
        values = read_atcs.read("worker-request", report, self.workspace, extra=["w01"])
        self.assertEqual(values[0]["value"], 0)


    def test_escaped_names_in_the_action_path_match_escaped_netlist_instances(self):
        """Review finding: an escaped segment arrives as `\\name ` (trailing space), and a flattened
        escaped instance may contain `/`. The path splits only on unescaped `/` and strips each
        escape, symmetric with the netlist parser. (Whether such a name is admissible in an edit
        domain at all is the flow's own Tcl-safety rule, not this matcher's.)"""
        netlist = self.workspace / "escaped-path.v"
        _write(netlist, (
            "module top;\n"
            "  SUB_MOD u_sub (.X(x));\n"
            "endmodule\n"
            "module SUB_MOD;\n"
            "  DFQD1BWP35P140 \\dout_reg[15]  (.D(d));\n"
            "  DFQD1BWP35P140 \\u_a/u_b/reg_0_  (.D(d));\n"
            "endmodule\n"
        ))
        hierarchy = read_atcs._parse_netlist_hierarchy(netlist)
        for path in ("u_sub/\\dout_reg[15] ", "u_sub/\\dout_reg[15]", "u_sub/\\u_a/u_b/reg_0_ ", "u_sub/dout_reg[15]"):
            with self.subTest(path=path):
                self.assertTrue(read_atcs._is_hierarchical_instance(hierarchy, "top", path))
        for path in ("u_sub/u_a/u_b/reg_0_", "\\u_sub/dout_reg[15]", "u_sub/\\dout_reg[15] x"):
            with self.subTest(path=path):
                self.assertFalse(read_atcs._is_hierarchical_instance(hierarchy, "top", path))


class CampaignPlanReaderTest(unittest.TestCase):
    """Task 12c item 4a: the `campaign-plan` reader kind counts problems across
    every slot's work package (`workspaces.request_invalid_count`), not just
    slot w01's own package. Fix round 2 item 3: it also counts a top-level
    `workPackages` key (a second, unenforced copy) and a `baseState` whose
    id disagrees with `state/working-state.json`'s current one.

    Issue #64 Task 5: the six slots run as parallel fork branches, so the plan is
    also refused when active slots share an instance (edit domain or target-pin
    owner), when the worst setup or hold check of a required scenario is in no
    active slot's `targetPins` (blockers first), or when a slot above the Run's
    `workerSlots` knob is active. Parked slots are admitted."""

    SCENARIO = "func_ssg_rcworst_m40"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        self.design = _build_design_state(self.workspace)
        # Fix round 2 item 3's own check needs a real, current state/working-state.json
        # to compare envelope.baseState against; every "zero problems" case in this class
        # keeps it matching self.design, and the dedicated mismatch tests below diverge it.
        core.write_artifact(self.workspace / "state" / "working-state.json", self.design)
        self._write_policy([self.SCENARIO])
        # The worst setup check ends at U1/A and the worst hold check at U2/A.
        self._write_observation({
            f"{self.SCENARIO}|setup|U1/A": -0.20, f"{self.SCENARIO}|setup|U3/A": -0.05,
            f"{self.SCENARIO}|hold|U2/A": -0.10, f"{self.SCENARIO}|hold|U4/A": -0.01,
        })
        self._write_worker_slots(6)

    def _write_policy(self, required):
        policy = core.stamp("policy", {"requiredScenarios": list(required), "baselineStateId": self.design["id"]})
        core.write_artifact(self.workspace / "state" / "policy.json", policy)

    def _write_observation(self, slacks, design_state_id=None):
        checks = {key: {"slack": core.known(value), "violated": value < 0, "endpoint": key.split("|", 2)[2]}
                  for key, value in slacks.items()}
        observation = core.stamp("observation-set", {
            "designStateId": design_state_id or self.design["id"], "precision": "gba",
            "scenarios": {}, "checks": checks, "missingScenarios": [],
            "coverage": {"complete": True, "reasons": []}, "sources": [],
        })
        core.write_artifact(self.workspace / "state" / "observation.json", observation)

    def _write_worker_slots(self, count):
        self.assertEqual(atcs_cli.main(["worker-slots", str(self.workspace), str(count)]), 0)

    def _valid_package(self, task_id):
        """An active package: slot wNN owns instance U<N> and targets its pin U<N>/A (disjoint)."""
        n = int(task_id[1:])
        return {
            "taskId": task_id, "baseStateId": self.design["id"], "problem": "hold violation",
            "targets": [f"{self.SCENARIO}|hold|U{n}/A"],
            "editDomain": {"instances": [f"U{n}"], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3},
            "targetPins": [f"U{n}/A"], "scope": dict(EXPERT_SCOPE),
        }

    def _parked_package(self, task_id, why="no blocker cluster left for this slot"):
        return {"taskId": task_id, "baseStateId": self.design["id"], "parked": True, "problem": why}

    def _six(self, parked=()):
        return {task_id: (self._parked_package(task_id) if task_id in parked else self._valid_package(task_id))
                for task_id in workspaces.TASK_IDS}

    def _write_envelope(self, work_packages, reason="close the campaign's targeted checks", site_capabilities=None):
        envelope = {
            "candidate": {"workPackages": work_packages, "reason": reason},
            "baseState": self.design, "siteCapabilities": site_capabilities or {},
        }
        report = self.workspace / "flow" / "records" / "campaign-plan.json"
        _write(report, json.dumps(envelope))
        return report

    def _count(self, work_packages, **kwargs):
        report = self._write_envelope(work_packages, **kwargs)
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertEqual([v["type"] for v in values], ["tc_request_invalid_count"])
        return values[0]["value"]

    def test_six_disjoint_blocker_covering_packages_have_zero_invalid_count(self):
        report = self._write_envelope(self._six())
        values = read_atcs.read("campaign-plan", report, self.workspace)
        self.assertEqual(values, [{"type": "tc_request_invalid_count", "unit": "count", "value": 0}])

    def test_a_problem_in_w06_is_counted(self):
        packages = self._six()
        packages["w06"]["actions"] = ["not-a-real-action"]
        self.assertGreaterEqual(self._count(packages), 1)

    def test_missing_slot_is_counted(self):
        for slot in ("w03", "w06"):
            with self.subTest(missing=slot):
                packages = self._six()
                del packages[slot]
                self.assertGreaterEqual(self._count(packages), 1)

    def test_blank_reason_is_counted(self):
        self.assertGreaterEqual(self._count(self._six(), reason="   "), 1)

    def test_tampered_base_state_is_refused(self):
        report = self._write_envelope(self._six())
        envelope = json.loads(report.read_text())
        envelope["baseState"] = dict(self.design, top="not-the-real-top")
        report.write_text(json.dumps(envelope))
        with self.assertRaises(ValueError):
            read_atcs.read("campaign-plan", report, self.workspace)

    def test_top_level_workpackages_key_is_counted(self):
        """Fix round 2 item 3: a second, top-level copy is a problem even when it is
        byte-identical to candidate.workPackages -- prepare-workers refuses it outright."""
        packages = self._six()
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
        self.assertGreaterEqual(self._count(self._six()), 1)  # envelope.baseState is still self.design

    def test_missing_working_state_is_counted_not_treated_as_a_match(self):
        """Fix round 2 item 3: an unreadable/missing state/working-state.json can never be
        silently treated as "matches" -- it is itself counted as a problem."""
        (self.workspace / "state" / "working-state.json").unlink()
        self.assertGreaterEqual(self._count(self._six()), 1)

    # ---- Issue #64 Task 5: disjoint domains -------------------------------------------------

    def test_an_edit_domain_instance_shared_by_two_active_slots_is_counted(self):
        packages = self._six()
        packages["w05"]["editDomain"]["instances"].append("U2")
        self.assertGreaterEqual(self._count(packages), 1)

    def test_an_edit_domain_net_shared_by_two_active_slots_is_counted(self):
        """US8: active slots' edit domains are disjoint in nets as well as instances."""
        packages = self._six()
        self.assertEqual(self._count(packages), 0)
        packages["w02"]["editDomain"]["nets"].append("n_shared")
        packages["w05"]["editDomain"]["nets"].append("n_shared")
        self.assertEqual(self._count(packages), 1)

    def test_a_net_named_by_a_parked_slot_is_not_shared(self):
        packages = self._six(parked=("w06",))
        packages["w02"]["editDomain"]["nets"].append("n_only")
        self.assertEqual(self._count(packages), 0)

    def test_a_target_pin_owner_shared_by_two_active_slots_is_counted(self):
        packages = self._six()
        packages["w05"]["targetPins"].append("U2/B")  # another pin of w02's instance U2
        self.assertGreaterEqual(self._count(packages), 1)

    def test_a_target_pin_owner_inside_another_active_slots_domain_is_counted(self):
        packages = self._six()
        packages["w05"]["editDomain"]["instances"].append("U7")
        packages["w06"]["targetPins"].append("U7/Z")
        self.assertGreaterEqual(self._count(packages), 1)

    def test_escaped_pin_owners_are_compared_as_instances(self):
        packages = self._six()
        packages["w05"]["editDomain"]["instances"].append("\\u_a/u_b ")
        packages["w06"]["targetPins"].append("\\u_a/u_b /D")
        self.assertGreaterEqual(self._count(packages), 1)

    # ---- blockers first --------------------------------------------------------------------

    def test_the_worst_setup_check_outside_every_active_slots_target_pins_is_counted(self):
        packages = self._six()
        packages["w01"]["targetPins"] = ["U1/B"]  # U1/A ends the worst setup check
        self.assertGreaterEqual(self._count(packages), 1)

    def test_the_worst_hold_check_outside_every_active_slots_target_pins_is_counted(self):
        self.assertGreaterEqual(self._count(self._six(parked=("w02",))), 1)  # U2/A ends the worst hold check

    def test_a_less_severe_check_may_wait(self):
        packages = self._six()
        packages["w03"]["targetPins"] = ["U3/B"]  # U3/A is a setup check, but not the worst one
        self.assertEqual(self._count(packages), 0)

    def test_a_worst_check_named_by_its_raw_pt_endpoint_is_covered(self):
        """A check in a reserved PT path group is keyed `<endpoint>@<group>`; its raw endpoint is the pin."""
        self._write_observation({f"{self.SCENARIO}|setup|U1/A@**async_default**": -0.30,
                                 f"{self.SCENARIO}|hold|U2/A": -0.10})
        checks_path = self.workspace / "state" / "observation.json"
        observation = json.loads(checks_path.read_text())
        observation["checks"][f"{self.SCENARIO}|setup|U1/A@**async_default**"]["endpoint"] = "U1/A"
        core.write_artifact(checks_path, core.stamp("observation-set", {
            k: v for k, v in observation.items() if k not in ("schema", "id")}))
        self.assertEqual(self._count(self._six()), 0)

    def test_a_worst_check_at_a_top_level_port_is_covered_by_its_check_key_in_targets(self):
        """Fix round 1: a port endpoint has no `/`, so no targetPin can name it; the check key in an
        active slot's `targets` covers it (the same `composition.covers` rule the recipe ranks by)."""
        self._write_observation({f"{self.SCENARIO}|setup|out_port": -0.20, f"{self.SCENARIO}|hold|U2/A": -0.10})
        packages = self._six()
        self.assertGreaterEqual(self._count(packages), 1, "a port blocker named nowhere is uncovered")
        packages["w01"]["targets"].append(f"{self.SCENARIO}|setup|out_port")
        self.assertEqual(self._count(packages), 0)

    def test_the_worst_check_of_a_scenario_that_is_not_required_may_wait(self):
        self._write_observation({f"{self.SCENARIO}|setup|U1/A": -0.20, f"{self.SCENARIO}|hold|U2/A": -0.10,
                                 "func_other|setup|U9/A": -0.50})
        self.assertEqual(self._count(self._six()), 0)

    def test_no_failing_check_needs_no_blocker_slot(self):
        self._write_observation({f"{self.SCENARIO}|setup|U1/A": 0.02})
        self.assertEqual(self._count(self._six(parked=workspaces.TASK_IDS)), 0)

    def test_an_observation_of_another_design_state_is_counted(self):
        """Blockers are read from the evidence the plan Workshop cites; a stale observation cannot rank them."""
        self._write_observation({f"{self.SCENARIO}|setup|U1/A": -0.20}, design_state_id="f" * 20)
        self.assertGreaterEqual(self._count(self._six()), 1)

    def test_missing_observation_or_policy_is_counted(self):
        for name in ("observation.json", "policy.json"):
            with self.subTest(missing=name):
                self.setUp()
                (self.workspace / "state" / name).unlink()
                self.assertGreaterEqual(self._count(self._six()), 1)

    # ---- parking and the workerSlots knob ---------------------------------------------------

    def test_parked_slots_are_admitted(self):
        self.assertEqual(self._count(self._six(parked=("w03", "w04", "w05", "w06"))), 0)

    def test_a_malformed_parked_package_is_counted(self):
        broken = {
            "a parked slot with work fields": dict(self._parked_package("w06"), targetPins=["U6/A"]),
            "a parked slot with no reason": dict(self._parked_package("w06"), problem=" "),
            "parked not true": dict(self._valid_package("w06"), parked="yes"),
            "a parked slot on another base": dict(self._parked_package("w06"), baseStateId="f" * 20),
        }
        for label, package in broken.items():
            with self.subTest(label):
                packages = self._six()
                packages["w06"] = package
                self.assertGreaterEqual(self._count(packages), 1, label)

    def test_an_active_slot_above_the_worker_slots_knob_is_counted(self):
        self._write_worker_slots(4)
        self.assertGreaterEqual(self._count(self._six()), 2)  # w05 and w06 are active

    def test_slots_above_the_knob_parked_are_admitted(self):
        self._write_worker_slots(4)
        self.assertEqual(self._count(self._six(parked=("w05", "w06"))), 0)

    def test_a_missing_worker_slots_record_is_counted(self):
        (self.workspace / "state" / "worker-slots.json").unlink()
        self.assertGreaterEqual(self._count(self._six()), 1)


class WorkerResultReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)

    def _write_contribution(self, predicted=None, task_id="w01", script=None, admissible=True, refusals=()):
        body = {
            "taskId": task_id, "revision": 1, "baseStateId": "a" * 20, "kind": "fix",
            "operations": [], "script": script,
            "delta": {"mastersChanged": {}, "added": {}, "removed": {}},
            "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": predicted or {}, "validationLevel": "xtop", "diagnosis": None,
            "admissible": admissible, "refusals": list(refusals), "outOfScope": [], "beforeDumpSha256": "b" * 64,
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
            if value["type"] == "tc_worker_refusal_count":
                continue
            self.assertIsNone(value["value"])
            self.assertTrue(value.get("unknownReason"))

    def test_refusals_are_counted_and_an_admissible_result_has_none(self):
        """Issue #64 Task 5: the join `check-worker-results` judges each branch's sealed result."""
        values = read_atcs.read("worker-result", self._write_contribution(), self.workspace, extra=["w01"])
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_worker_refusal_count"], {"type": "tc_worker_refusal_count", "unit": "count",
                                                              "value": 0})
        report = self._write_contribution(admissible=False, refusals=[{"code": "tainted", "detail": "x"},
                                                                      {"code": "missing-export", "detail": "y"}])
        by_type = {v["type"]: v for v in read_atcs.read("worker-result", report, self.workspace, extra=["w01"])}
        self.assertEqual(by_type["tc_worker_refusal_count"]["value"], 2)
        report = self._write_contribution(admissible=False, refusals=[])
        by_type = {v["type"]: v for v in read_atcs.read("worker-result", report, self.workspace, extra=["w01"])}
        self.assertEqual(by_type["tc_worker_refusal_count"]["value"], 1, "an inadmissible result always counts")

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
            "replayMismatch": ["s1"], "outOfScope": ["s2", "s3"], "unknownReceipts": [], "delta": {},
        })
        report = self.workspace / "flow" / "records" / "state.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("integration-state", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_replay_mismatch_count"]["value"], 1)
        self.assertEqual(by_type["tc_out_of_scope_edit_count"]["value"], 2)

    def test_a_pending_step_makes_the_mismatch_count_unknown(self):
        """I3 (final review): a step that never even replayed must not let a precise
        mismatch count through -- its own true status was never established."""
        obj = core.stamp("integration-state", {
            "batchId": "b1", "applied": {}, "failed": [], "pending": ["s2"],
            "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "delta": {},
        })
        report = self.workspace / "flow" / "records" / "state.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("integration-state", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_replay_mismatch_count"]["value"])
        self.assertIn("unknownReason", by_type["tc_replay_mismatch_count"])

    def test_a_failed_step_makes_the_mismatch_count_unknown(self):
        obj = core.stamp("integration-state", {
            "batchId": "b1", "applied": {}, "failed": ["s1"], "pending": [],
            "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "delta": {},
        })
        report = self.workspace / "flow" / "records" / "state.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("integration-state", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_replay_mismatch_count"]["value"])
        self.assertIn("unknownReason", by_type["tc_replay_mismatch_count"])

    def test_an_unknown_receipt_makes_the_mismatch_count_unknown(self):
        obj = core.stamp("integration-state", {
            "batchId": "b1", "applied": {}, "failed": [], "pending": [],
            "replayMismatch": [], "outOfScope": [], "unknownReceipts": ["ghost-step"], "delta": {},
        })
        report = self.workspace / "flow" / "records" / "state.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("integration-state", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertIsNone(by_type["tc_replay_mismatch_count"]["value"])
        self.assertIn("unknownReason", by_type["tc_replay_mismatch_count"])


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
        self.assertEqual(values, [{"type": "tc_unqualified_rc_net_count", "unit": "count", "value": 0},
                                  {"type": "tc_presta_gate_net_count", "unit": "count", "value": 0}])

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

    def test_a_legacy_batch_gates_on_its_unqualified_nets(self):
        report, _spef = self._write_evidence(["n1", "n2"], ["n1"])
        values = {v["type"]: v for v in read_atcs.read("precheck-evidence", report, self.workspace)}
        self.assertEqual(values["tc_presta_gate_net_count"]["value"], 1)

    def _write_recipe_evidence(self, new_nets, spef_lines, predictive, unknown_reason=None, provenance=True):
        if provenance:
            _write(self.workspace / "state" / "replay-request.json", json.dumps({"mode": "recipe"}))
        spef_path = self.workspace / "inputs" / "spef-net-names.txt"
        _write(spef_path, "\n".join(spef_lines) + ("\n" if spef_lines else ""))
        body = {"parentStateId": "a" * 20, "contributions": [], "operations": [], "innovusEcoTcl": "",
                "sourceMap": {}, "newNets": new_nets,
                "eco": {"netlist": {"path": "n", "sha256": "1" * 64}, "physical": {"path": "p", "sha256": "2" * 64}}}
        if unknown_reason:
            body["newNetsUnknown"] = unknown_reason
        evidence = verification.precheck_evidence(core.stamp("merge-commit", body), spef_path, predictive=predictive)
        evidence = core.stamp("precheck-evidence", {
            **{k: v for k, v in evidence.items() if k not in ("schema", "id")},
            "spefNetNames": {"path": str(spef_path.relative_to(self.workspace)),
                             "sha256": evidence["spefNetNames"]["sha256"]},
        })
        report = self.workspace / "flow" / "records" / "precheck.json"
        core.write_artifact(report, evidence)
        return report

    def test_a_recipe_batch_with_unknown_new_nets_is_non_predictive_and_does_not_gate(self):
        report = self._write_recipe_evidence(None, ["n1"], predictive=False, unknown_reason="auto-fix inserted 2")
        values = {v["type"]: v for v in read_atcs.read("precheck-evidence", report, self.workspace)}
        self.assertIsNone(values["tc_unqualified_rc_net_count"]["value"])
        self.assertIn("auto-fix inserted 2", values["tc_unqualified_rc_net_count"]["unknownReason"])
        self.assertEqual(values["tc_presta_gate_net_count"]["value"], 0)

    def test_a_recipe_batch_with_unqualified_nets_is_non_predictive_and_does_not_gate(self):
        report = self._write_recipe_evidence(["n1", "n2"], ["n1"], predictive=False)
        values = {v["type"]: v for v in read_atcs.read("precheck-evidence", report, self.workspace)}
        self.assertEqual(values["tc_unqualified_rc_net_count"]["value"], 1)
        self.assertEqual(values["tc_presta_gate_net_count"]["value"], 0)

    def test_a_recipe_claim_without_recipe_provenance_is_read_as_legacy(self):
        report = self._write_recipe_evidence(["n1", "n2"], ["n1"], predictive=False, provenance=False)
        values = {v["type"]: v for v in read_atcs.read("precheck-evidence", report, self.workspace)}
        self.assertEqual(values["tc_presta_gate_net_count"]["value"], 1)
        report = self._write_recipe_evidence(None, ["n1"], predictive=False, unknown_reason="auto-fix inserted 2",
                                             provenance=False)
        values = {v["type"]: v for v in read_atcs.read("precheck-evidence", report, self.workspace)}
        self.assertIsNone(values["tc_presta_gate_net_count"]["value"])

    def test_integration_state_with_a_chosen_pair_is_recipe_provenance(self):
        _write(self.workspace / "state" / "integration-state.json",
               json.dumps({"chosen": {"arm": "merged", "eco": {"netlist": {}, "physical": {}}}}))
        report = self._write_recipe_evidence(["n1", "n2"], ["n1"], predictive=False, provenance=False)
        values = {v["type"]: v for v in read_atcs.read("precheck-evidence", report, self.workspace)}
        self.assertEqual(values["tc_presta_gate_net_count"]["value"], 0)

    def test_a_recipe_batch_claiming_a_prediction_it_does_not_have_is_refused(self):
        report = self._write_recipe_evidence(["n1", "n2"], ["n1"], predictive=True)
        with self.assertRaises(ValueError):
            read_atcs.read("precheck-evidence", report, self.workspace)
        report = self._write_recipe_evidence([], [], predictive=False)
        with self.assertRaises(ValueError):
            read_atcs.read("precheck-evidence", report, self.workspace)

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

    def _guarantee_value(self, extra):
        obj = core.stamp("evaluation", dict({"candidateId": "m" * 20, "finalSetupWns": core.known(0.0)}, **extra))
        report = self.workspace / "flow" / "records" / "evaluation.json"
        core.write_artifact(report, obj)
        values = read_atcs.read("evaluation", report, self.workspace)
        return {v["type"]: v for v in values}["tc_batch_guarantee_unevidenced"]["value"]

    def test_an_unevidenced_batch_guarantee_is_a_reader_value(self):
        """A recipe batch whose merged arm was chosen only because control was unusable is
        reported with the final evaluation."""
        self.assertEqual(self._guarantee_value({"batchGuarantee": {
            "evidenced": False, "arm": "merged", "reason": "control arm unusable"}}), 1)
        self.assertEqual(self._guarantee_value({"batchGuarantee": {
            "evidenced": True, "arm": "merged", "reason": "compared"}}), 0)
        self.assertEqual(self._guarantee_value({}), 0, "a batch with no recipe guarantee has none unevidenced")

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
_READER_SCENARIOS = ("slow_setup", "fast_hold")
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
            for i, scenario in enumerate(_READER_SCENARIOS)
        }, _READER_SCENARIOS)

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
            for i, scenario in enumerate(_READER_SCENARIOS)
        }, _READER_SCENARIOS)
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
        # Minor (final review): `stateRef` must now equal `state/working-state.json`'s
        # own current id, not merely resolve to *some* artifact in the workspace --
        # this IS that current working state for every test in this class that does
        # not call `_write_ready_implement_batch` (which overwrites it with a
        # different, real one, and updates its own decisions' `stateRef` to match).
        _write(self.workspace / "state" / "working-state.json",
               json.dumps({"schema": "atcs.design-state/1", "id": self.state_ref, "marker": "state"}))

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

    def test_next_decision_cli_decodes_declared_report_file_with_string_workspace(self):
        # Retained ATCS-07 input shape: all ten fields, action=research,
        # string costBasis. REPORT is a file; sys.argv WORKSPACE is a str.
        decision = self._decision(action="research", costBasis="one bounded worker")
        report = self.workspace / "research" / "requests" / "next-decision.json"
        _write(report, json.dumps(decision))
        out = self.workspace / "reader-output.json"
        proc = subprocess.run(
            [sys.executable, str(READ_ATCS_PATH), "next-decision", str(report),
             str(out), str(self.workspace)], capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        by_type = {v["type"]: v for v in json.loads(out.read_text())["values"]}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)
        self.assertEqual(by_type["tc_next_action"]["value"], 2)
        self.assertEqual(by_type["tc_stop_required"]["value"], 0)

    def test_string_workspace_still_refuses_stale_state_reference(self):
        stale = core.digest({"marker": "stale"})
        _write(self.workspace / "state" / "stale.json", json.dumps({"id": stale}))
        report = self._write_decision(self._decision(stateRef=stale))
        values = read_atcs.read("next-decision", str(report), str(self.workspace))
        by_type = {v["type"]: v for v in values}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertIsNone(by_type["tc_next_action"]["value"])

    def _write_ready_implement_batch(self):
        """A minimal but real, fully-reconciled, unimplemented (empty) batch
        based on a fresh `state/working-state.json` -- everything C2's
        `_implement_batch_ready` requires for `action == "implement"` to be
        counted as a real, actionable request (see that function's own
        docstring for exactly which state files and which `baseStateId`
        agreement it checks)."""
        working_state = _build_design_state(self.workspace, name="implement-ready")
        _write(self.workspace / "state" / "working-state.json", json.dumps(working_state))
        facts = composition.analyze(working_state["id"], [], [])
        _write(self.workspace / "state" / "composition-facts.json", json.dumps(facts))
        plan = integration.validate_plan(
            {"batchId": "b1", "baseStateId": working_state["id"], "select": [], "resolutions": [],
             "deferred": [], "reason": "empty batch, ready to implement"},
            facts,
        )
        request = integration.prepare_replay(plan, facts, [])
        _write(self.workspace / "state" / "replay-request.json", json.dumps(request))
        integration_state = integration.reconcile(request, [], {})
        _write(self.workspace / "state" / "integration-state.json", json.dumps(integration_state))
        _write(self.workspace / "state" / "contributions-collected.json", json.dumps({"contributions": []}))
        return working_state["id"]

    def test_each_of_the_eight_actions_encodes_and_matches_stop_required(self):
        # Minor (final review): this real, fresh working state's own id -- not
        # `self.state_ref`, which `_write_ready_implement_batch` just overwrote
        # `state/working-state.json` away from -- is what `stateRef` must now match.
        working_state_id = self._write_ready_implement_batch()
        codes = {
            "observe": 1, "research": 2, "compose": 3, "revise": 4,
            "implement": 5, "earlier-apr": 6, "wait": 7, "goal-met": 8,
        }
        for action, code in codes.items():
            extra = {"stage": "postroute"} if action == "earlier-apr" else {}
            report = self._write_decision(self._decision(action=action, stateRef=working_state_id, **extra))
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
        # "revise" (not "implement" -- that action now also has its own,
        # unrelated C2 batch-readiness requirement, covered separately below)
        # never requires a `stage` field.
        report = self._write_decision(self._decision(action="revise"))
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

    def test_a_state_ref_resolving_to_a_stale_non_working_state_is_counted_invalid(self):
        """Minor (final review): resolving to *some* real artifact in the workspace was
        never enough on its own -- an old baseline, or a superseded candidate's own
        design-state, still resolves; only the CURRENT `state/working-state.json` id
        may be named."""
        stale_id = core.digest({"marker": "a stale, unrelated design-state"})
        _write(self.workspace / "flow" / "records" / "stale-state.json",
               json.dumps({"schema": "atcs.design-state/1", "id": stale_id, "marker": "stale"}))
        report = self._write_decision(self._decision(stateRef=stale_id))
        values = read_atcs.read("next-decision", report, self.workspace)
        by_type = {v["type"]: v for v in values}
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertIsNone(by_type["tc_next_action"]["value"])


class NextDecisionImplementBatchReadinessTest(unittest.TestCase):
    """C2 (final review): `action == "implement"` is only counted as a valid,
    actionable request when a reconciled, unimplemented batch based on the
    CURRENT working state actually exists in workspace state files -- never
    just because the eight-action vocabulary itself accepts the string
    "implement". Converted from the controller's own `probe_reimplement.py`
    scenario (stale re-implement overwrote an already-adopted database)."""

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
            "question": "should we implement the reconciled batch?", "action": "implement", "targets": [],
            "reason": "batch reconciled cleanly", "falsifier": "if implement fails, escalate",
            "costBasis": {"queries": 1}, "requiredArtifacts": [],
        }
        decision.update(overrides)
        return decision

    def _write_decision(self, decision):
        report = self.workspace / "flow" / "records" / "next-decision.json"
        _write(report, json.dumps(decision))
        return report

    def _ready_batch(self, base_state_id):
        facts = composition.analyze(base_state_id, [], [])
        _write(self.workspace / "state" / "composition-facts.json", json.dumps(facts))
        plan = integration.validate_plan(
            {"batchId": "b1", "baseStateId": base_state_id, "select": [], "resolutions": [],
             "deferred": [], "reason": "empty batch, ready to implement"},
            facts,
        )
        request = integration.prepare_replay(plan, facts, [])
        _write(self.workspace / "state" / "replay-request.json", json.dumps(request))
        integration_state = integration.reconcile(request, [], {})
        _write(self.workspace / "state" / "integration-state.json", json.dumps(integration_state))
        _write(self.workspace / "state" / "contributions-collected.json", json.dumps({"contributions": []}))
        return integration.seal_batch(integration_state, request, facts, [])

    def test_implement_with_no_state_files_at_all_is_invalid(self):
        report = self._write_decision(self._decision())
        by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertIsNone(by_type["tc_next_action"]["value"])

    def test_implement_with_a_ready_reconciled_batch_is_valid(self):
        working_state = _build_design_state(self.workspace, name="ready")
        _write(self.workspace / "state" / "working-state.json", json.dumps(working_state))
        self._ready_batch(working_state["id"])

        # Minor (final review): `stateRef` must equal this real working state's own
        # id, not the arbitrary `self.state_ref` marker `setUp` only wrote to
        # `flow/records/state.json`.
        report = self._write_decision(self._decision(stateRef=working_state["id"]))
        by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
        self.assertEqual(by_type["tc_request_invalid_count"]["value"], 0)
        self.assertEqual(by_type["tc_next_action"]["value"], 5)

    def test_implement_for_a_batch_already_recorded_in_implement_json_is_invalid(self):
        """probe_reimplement.py: after `adopt` moves the working pointer, the SAME stale
        batch (never recomposed against the new working state) is not a real "implement"
        request any more -- it was already implemented."""
        working_state = _build_design_state(self.workspace, name="ready")
        _write(self.workspace / "state" / "working-state.json", json.dumps(working_state))
        merge_commit = self._ready_batch(working_state["id"])
        _write(self.workspace / "state" / "implement.json", json.dumps({
            "mergeCommitId": merge_commit["id"], "parentStateId": working_state["id"],
        }))

        report = self._write_decision(self._decision())
        by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
        self.assertGreaterEqual(by_type["tc_request_invalid_count"]["value"], 1)
        self.assertIsNone(by_type["tc_next_action"]["value"])

    def test_implement_for_a_batch_based_on_a_stale_working_state_is_invalid(self):
        """The reconciled batch's own baseStateId no longer matches the CURRENT
        working state (e.g. `adopt` moved it since compose/replay ran) -- stale,
        never a real "implement" request for the campaign's current generation."""
        working_state = _build_design_state(self.workspace, name="ready")
        _write(self.workspace / "state" / "working-state.json", json.dumps(working_state))
        self._ready_batch("some-other-stale-state-id")

        report = self._write_decision(self._decision())
        by_type = {v["type"]: v for v in read_atcs.read("next-decision", report, self.workspace)}
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
        "tc_selected_contribution_count", "tc_worker_refusal_count", "tc_presta_gate_net_count",
        "tc_batch_guarantee_unevidenced", "tc_refreshes_completed",
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
