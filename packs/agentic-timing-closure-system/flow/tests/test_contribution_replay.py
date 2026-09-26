"""Tests for `atcs.contributions` — M3's sealed ECO Contributions.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_contribution_replay.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Dump and ops-log fixtures are generated locally in this file (per this
task's instructions, not shared with other in-flight M-task test files).
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import contributions  # noqa: E402
from atcs import core  # noqa: E402


BASE_STATE_ID = "base-0000000000000001"


def make_base_ref(edit_instances=(), edit_nets=(), targets=None, regions=None,
                   task_id="w01", revision=1):
    """Build a self-consistent `base_ref` (work-package + workspace-manifest).

    Both artifacts are `core.stamp`-ed plain dicts (never written to disk —
    `seal` only reads their fields), wired so `workPackage.baseStateId ==
    workspaceManifest.baseStateId == stateId` and `workspaceManifest.
    workPackageId == workPackage.id`, exactly what `seal`'s base-mismatch
    check requires.
    """
    work_package_body = {
        "taskId": task_id,
        "baseStateId": BASE_STATE_ID,
        "problem": "test problem",
        "targets": list(targets or []),
        "editDomain": {
            "instances": list(edit_instances),
            "nets": list(edit_nets),
            "regions": list(regions or []),
        },
        "protected": {"instances": [], "nets": []},
        "mayAffect": [],
        "actions": ["size_cell", "insert_buffer", "delete_buffer", "pg_local_adjust"],
        "budget": {"xtopMinutes": 10, "queries": 10, "attempts": 3},
    }
    work_package = core.stamp("work-package", work_package_body)

    manifest_body = {
        "workPackageId": work_package["id"],
        "taskId": task_id,
        "revision": revision,
        "root": f"workspaces/{task_id}/r{revision}/",
        "readOnly": [],
        "namePrefix": f"atcs_{task_id}_r{revision}_",
        "recovery": {"checkpoint": None},
        "baseStateId": BASE_STATE_ID,
    }
    manifest = core.stamp("workspace-manifest", manifest_body)

    base_ref = {"stateId": BASE_STATE_ID, "workspaceManifest": manifest, "workPackage": work_package}
    return base_ref, manifest["namePrefix"]


def write_dump(directory, name, mapping):
    """Write a plain-text cell dump (`"<instance> <master>"` per line); return its path."""
    path = Path(directory) / name
    lines = [f"{instance} {master}" for instance, master in mapping.items()]
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return str(path)


def ops_text(*operations):
    """Render operation dicts as `ops.jsonl` text (one JSON object per line)."""
    return "\n".join(json.dumps(op) for op in operations)


class ParseOpsLogTests(unittest.TestCase):
    def test_parses_each_known_op_kind(self):
        text = ops_text(
            {"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"},
            {
                "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": "BUF1",
                "newNet": "N1_buf", "master": "BUFX1", "location": [1, 2],
            },
            {"op": "delete_buffer", "instance": "U3", "master": "BUFX1"},
            {"op": "pg_local_adjust", "region": [0, 0, 1, 1], "action": "strap", "detail": "widen"},
        )
        operations = contributions.parse_ops_log(text)
        self.assertEqual([op["op"] for op in operations], [
            "size_cell", "insert_buffer", "delete_buffer", "pg_local_adjust",
        ])

    def test_blank_lines_are_skipped(self):
        text = "\n" + json.dumps({"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B"}) + "\n\n"
        self.assertEqual(len(contributions.parse_ops_log(text)), 1)

    def test_empty_text_yields_no_operations(self):
        self.assertEqual(contributions.parse_ops_log(""), [])

    def test_rejects_unknown_op(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps({"op": "rewire_everything"}))
        self.assertEqual(ctx.exception.code, "unknown-op")

    def test_rejects_missing_field(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps({"op": "size_cell", "instance": "U1", "fromMaster": "A"}))
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_rejects_duplicate_new_instance(self):
        text = ops_text(
            {
                "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": "BUF1",
                "newNet": "N1_buf", "master": "BUFX1", "location": None,
            },
            {
                "op": "insert_buffer", "net": "N2", "loadPins": ["U3/A"], "newInstance": "BUF1",
                "newNet": "N2_buf", "master": "BUFX1", "location": None,
            },
        )
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(text)
        self.assertEqual(ctx.exception.code, "duplicate-new-instance")

    def test_rejects_malformed_json_line(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log("{not json")
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_preserves_extra_group_field(self):
        operations = contributions.parse_ops_log(
            json.dumps({"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B", "group": 3})
        )
        self.assertEqual(operations[0]["group"], 3)


class ParseCellDumpTests(unittest.TestCase):
    def test_parses_instance_master_pairs(self):
        self.assertEqual(contributions.parse_cell_dump("U1 BUFX1\nU2 INVX1\n"), {"U1": "BUFX1", "U2": "INVX1"})

    def test_skips_blank_lines(self):
        self.assertEqual(contributions.parse_cell_dump("\nU1 BUFX1\n\n"), {"U1": "BUFX1"})

    def test_rejects_malformed_line(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_cell_dump("U1 BUFX1 EXTRA")
        self.assertEqual(ctx.exception.code, "malformed-cell-dump")

    def test_rejects_duplicate_instance(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_cell_dump("U1 BUFX1\nU1 BUFX2\n")
        self.assertEqual(ctx.exception.code, "duplicate-instance")


class ActualDeltaTests(unittest.TestCase):
    def test_changed_added_removed(self):
        before = {"U1": "BUFX1", "U2": "INVX1"}
        after = {"U1": "BUFX2", "U3": "BUFX1"}
        delta = contributions.actual_delta(before, after)
        self.assertEqual(delta["mastersChanged"], {"U1": ["BUFX1", "BUFX2"]})
        self.assertEqual(delta["added"], {"U3": "BUFX1"})
        self.assertEqual(delta["removed"], {"U2": "INVX1"})

    def test_identical_dumps_yield_empty_delta(self):
        dump = {"U1": "BUFX1"}
        delta = contributions.actual_delta(dump, dict(dump))
        self.assertEqual(delta, {"mastersChanged": {}, "added": {}, "removed": {}})


class ImpliedDeltaTests(unittest.TestCase):
    def test_size_cell_matches_actual_delta_shape(self):
        before = {"U1": "BUFX1"}
        operations = [{"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"}]
        self.assertEqual(
            contributions.implied_delta(operations, before),
            contributions.actual_delta(before, {"U1": "BUFX2"}),
        )

    def test_sequential_insert_then_size_replays_in_order(self):
        before = {}
        operations = [
            {
                "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": "BUF1",
                "newNet": "N1_buf", "master": "BUFX1", "location": None,
            },
            {"op": "size_cell", "instance": "BUF1", "fromMaster": "BUFX1", "toMaster": "BUFX2"},
        ]
        delta = contributions.implied_delta(operations, before)
        self.assertEqual(delta["added"], {"BUF1": "BUFX2"})
        self.assertEqual(delta["mastersChanged"], {})

    def test_delete_buffer_removes_instance(self):
        before = {"BUF1": "BUFX1"}
        operations = [{"op": "delete_buffer", "instance": "BUF1", "master": "BUFX1"}]
        delta = contributions.implied_delta(operations, before)
        self.assertEqual(delta["removed"], {"BUF1": "BUFX1"})


class SealTests(unittest.TestCase):
    def test_sizing_op_with_agreeing_dumps_is_admissible_fix(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1", "U2": "INVX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2", "U2": "INVX1"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertEqual(contribution["refusals"], [])
            self.assertEqual(contribution["kind"], "fix")
            self.assertEqual(contribution["delta"]["mastersChanged"], {"U1": ["BUFX1", "BUFX2"]})
            self.assertEqual(contribution["preconditions"], [{"instance": "U1", "master": "BUFX1"}])

    def test_trace_that_understates_actual_delta_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1", "U2"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1", "U2": "INVX1"})
            # Both U1 and U2 actually changed, but the trace only accounts for U1.
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2", "U2": "INVX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("trace-mismatch", [r["code"] for r in contribution["refusals"]])

    def test_op_outside_edit_domain_is_out_of_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])  # U2 is not in scope
            before = write_dump(tmp, "before.txt", {"U2": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U2": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U2", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertEqual(contribution["outOfScope"], ["U2"])

    def test_insert_buffer_without_workspace_name_prefix_is_bad_name(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"])
            before = write_dump(tmp, "before.txt", {})
            after = write_dump(tmp, "after.txt", {"NOT_PREFIXED_BUF": "BUFX1"})
            trace = ops_text({
                "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": "NOT_PREFIXED_BUF",
                "newNet": "N1_buf", "master": "BUFX1", "location": None,
            })
            self.assertFalse("NOT_PREFIXED_BUF".startswith(prefix))

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("bad-name", [r["code"] for r in contribution["refusals"]])

    def test_historical_eco_instances_in_base_dump_do_not_pollute_delta(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1", "LEGACY_BUF": "BUFX9"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2", "LEGACY_BUF": "BUFX9"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertEqual(contribution["delta"]["mastersChanged"], {"U1": ["BUFX1", "BUFX2"]})
            self.assertEqual(contribution["delta"]["added"], {})
            self.assertEqual(contribution["delta"]["removed"], {})

    def test_no_fix_with_empty_ops_and_diagnosis_is_admissible_research_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref()
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX1"})

            contribution = contributions.seal(
                base_ref,
                {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": "root cause is X"},
                "",
            )

            self.assertEqual(contribution["kind"], "no-fix")
            self.assertTrue(contribution["admissible"])
            self.assertEqual(contribution["operations"], [])

    def test_no_fix_without_diagnosis_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref()
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX1"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, ""
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("no-diagnosis", [r["code"] for r in contribution["refusals"]])

    def test_atomic_group_insert_then_size_its_driver_is_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"])
            new_instance = f"{prefix}BUF1"
            before = write_dump(tmp, "before.txt", {})
            after = write_dump(tmp, "after.txt", {new_instance: "BUFX2"})
            trace = ops_text(
                {
                    "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": new_instance,
                    "newNet": "N1_buf", "master": "BUFX1", "location": [10, 20],
                },
                {"op": "size_cell", "instance": new_instance, "fromMaster": "BUFX1", "toMaster": "BUFX2"},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertIn([0, 1], contribution["atomicGroups"])
            self.assertEqual(contribution["touches"]["regions"], [[10, 20, 10, 20]])

    def test_explicit_group_field_groups_operations(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1", "U2"])
            before = write_dump(tmp, "before.txt", {"U1": "A", "U2": "C"})
            after = write_dump(tmp, "after.txt", {"U1": "B", "U2": "D"})
            trace = ops_text(
                {"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B", "group": 7},
                {"op": "size_cell", "instance": "U2", "fromMaster": "C", "toMaster": "D", "group": 7},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertIn([0, 1], contribution["atomicGroups"])

    def test_seal_is_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})
            result_refs = {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}

            first = contributions.seal(base_ref, result_refs, trace)
            second = contributions.seal(base_ref, result_refs, trace)

            self.assertEqual(first["id"], second["id"])

    def test_missing_predicted_values_are_unknown_with_no_validation_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertEqual(contribution["validationLevel"], "none")
            for key in contributions.PREDICTED_KEYS:
                self.assertIn("unknown", contribution["predicted"][key])

    def test_presta_predicted_value_raises_validation_level(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {
                    "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                    "predicted": {"prestaSetupWns": core.known(0.05)},
                },
                trace,
            )

            self.assertEqual(contribution["validationLevel"], "presta")
            self.assertEqual(contribution["predicted"]["prestaSetupWns"], core.known(0.05))

    def test_base_mismatch_between_manifest_and_state_id_raises(self):
        base_ref, _prefix = make_base_ref(edit_instances=["U1"])
        base_ref["workspaceManifest"] = dict(base_ref["workspaceManifest"])
        base_ref["workspaceManifest"]["baseStateId"] = "some-other-state"

        with self.assertRaises(core.AtcsError) as ctx:
            contributions.seal(base_ref, {"beforeDump": "x", "afterDump": "y", "script": None}, "")
        self.assertEqual(ctx.exception.code, "base-mismatch")

    def test_unreadable_dump_raises(self):
        base_ref, _prefix = make_base_ref(edit_instances=["U1"])
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.seal(
                base_ref,
                {"beforeDump": "/no/such/file.txt", "afterDump": "/no/such/other.txt", "script": None},
                "",
            )
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_malformed_ops_log_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX1"})
            with self.assertRaises(core.AtcsError) as ctx:
                contributions.seal(
                    base_ref, {"beforeDump": before, "afterDump": after, "script": None}, "{not json"
                )
            self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_script_is_hashed_when_provided(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            script_path = Path(tmp) / "fix.tcl"
            script_path.write_text("size_cell U1 BUFX2\n", encoding="utf-8")
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {"beforeDump": before, "afterDump": after, "script": str(script_path), "diagnosis": None},
                trace,
            )

            self.assertEqual(contribution["script"]["path"], str(script_path))
            self.assertEqual(contribution["script"]["sha256"], core.file_sha256(script_path))

    def test_touches_checks_come_from_work_package_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"], targets=["s|setup|EP1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "cones": ["cone-1"]}, trace
            )

            self.assertEqual(contribution["touches"]["checks"], ["s|setup|EP1"])
            self.assertEqual(contribution["touches"]["cones"], ["cone-1"])
            self.assertEqual(contribution["touches"]["instances"], ["U1"])


if __name__ == "__main__":
    unittest.main()
