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

DEFAULT_ACTIONS = ["size_cell", "insert_buffer", "delete_buffer", "pg_local_adjust"]


def make_base_ref(edit_instances=(), edit_nets=(), targets=None, may_affect=None, regions=None,
                   actions=None, task_id="w01", revision=1):
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
        "mayAffect": list(may_affect or []),
        "actions": list(actions) if actions is not None else list(DEFAULT_ACTIONS),
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


def workspace_script(tmp_dir, task_id="w01", revision=1, name="fix.tcl", text="size_cell U1 BUFX2\n"):
    """Write a script file under `<tmp_dir>/workspaces/<task_id>/r<revision>/<name>`.

    Matches the manifest `root` `make_base_ref` builds, so the script
    resolves inside its own workspace root.
    """
    workspace_dir = Path(tmp_dir) / "workspaces" / task_id / f"r{revision}"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    script_path = workspace_dir / name
    script_path.write_text(text, encoding="utf-8")
    return str(script_path)


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

    def test_rejects_empty_string_identifier(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(
                json.dumps({"op": "size_cell", "instance": "", "fromMaster": "A", "toMaster": "B"})
            )
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_non_string_identifier(self):
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(
                json.dumps({"op": "size_cell", "instance": 42, "fromMaster": "A", "toMaster": "B"})
            )
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_non_string_load_pin(self):
        op = {
            "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A", 123], "newInstance": "BUF1",
            "newNet": "N1_buf", "master": "BUFX1", "location": None,
        }
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_malformed_location_shape(self):
        op = {
            "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": "BUF1",
            "newNet": "N1_buf", "master": "BUFX1", "location": [1, 2, 3],
        }
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_non_finite_location_coordinate(self):
        text = (
            '{"op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": "BUF1", '
            '"newNet": "N1_buf", "master": "BUFX1", "location": [1, NaN]}'
        )
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(text)
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_malformed_region_shape(self):
        op = {"op": "pg_local_adjust", "region": [0, 0, 1], "action": "strap", "detail": "widen"}
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_inverted_region(self):
        op = {"op": "pg_local_adjust", "region": [20, 20, -5, -5], "action": "strap", "detail": "widen"}
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_non_finite_region_coordinate(self):
        text = '{"op": "pg_local_adjust", "region": [0, 0, 1, Infinity], "action": "strap", "detail": "widen"}'
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(text)
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_group_as_string(self):
        op = {"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B", "group": "high"}
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_group_as_bool(self):
        op = {"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B", "group": True}
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")

    def test_rejects_group_as_float(self):
        op = {"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B", "group": 1.5}
        with self.assertRaises(core.AtcsError) as ctx:
            contributions.parse_ops_log(json.dumps(op))
        self.assertEqual(ctx.exception.code, "malformed-ops-log")


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

    def test_delete_buffer_seal_is_admissible(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {})
            trace = ops_text({"op": "delete_buffer", "instance": "U1", "master": "BUFX1"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertEqual(contribution["delta"]["removed"], {"U1": "BUFX1"})
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

    def test_trace_that_overstates_actual_delta_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1", "U2"])
            before = write_dump(tmp, "before.txt", {"U1": "A", "U2": "C"})
            # The trace claims U2 also changed, but the dumps show it unchanged.
            after = write_dump(tmp, "after.txt", {"U1": "B", "U2": "C"})
            trace = ops_text(
                {"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B"},
                {"op": "size_cell", "instance": "U2", "fromMaster": "C", "toMaster": "D"},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("trace-mismatch", [r["code"] for r in contribution["refusals"]])

    def test_trace_mismatch_detail_embeds_canonical_delta_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1", "U2"])
            before = write_dump(tmp, "before.txt", {"U1": "A", "U2": "C"})
            after = write_dump(tmp, "after.txt", {"U1": "B", "U2": "D"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            mismatch = next(r for r in contribution["refusals"] if r["code"] == "trace-mismatch")
            expected_actual_json = core.canonical(contribution["delta"]).decode("utf-8")
            self.assertIn(expected_actual_json, mismatch["detail"])

    def test_size_cell_precondition_mismatch_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            # The dump shows a different prior master than the op declares.
            before = write_dump(tmp, "before.txt", {"U1": "BUFX9"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("precondition-mismatch", [r["code"] for r in contribution["refusals"]])

    def test_delete_buffer_precondition_mismatch_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX9"})
            after = write_dump(tmp, "after.txt", {})
            trace = ops_text({"op": "delete_buffer", "instance": "U1", "master": "BUFX1"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("precondition-mismatch", [r["code"] for r in contribution["refusals"]])

    def test_insert_buffer_duplicate_instance_precondition_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"])
            new_instance = f"{prefix}BUF1"
            before = write_dump(tmp, "before.txt", {new_instance: "OLD"})
            after = write_dump(tmp, "after.txt", {new_instance: "BUFX1"})
            trace = ops_text({
                "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": new_instance,
                "newNet": "N1_buf", "master": "BUFX1", "location": None,
            })

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("precondition-mismatch", [r["code"] for r in contribution["refusals"]])

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

    def test_insert_buffer_on_net_outside_edit_domain_is_out_of_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"])  # N2 is not in scope
            new_instance = f"{prefix}BUF1"
            before = write_dump(tmp, "before.txt", {})
            after = write_dump(tmp, "after.txt", {new_instance: "BUFX1"})
            trace = ops_text({
                "op": "insert_buffer", "net": "N2", "loadPins": ["U2/A"], "newInstance": new_instance,
                "newNet": "N2_buf", "master": "BUFX1", "location": None,
            })

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertEqual(contribution["outOfScope"], [new_instance])
            self.assertNotIn("bad-name", [r["code"] for r in contribution["refusals"]])

    def test_op_kind_not_in_work_package_actions_is_action_not_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"], actions=["insert_buffer"])
            before = write_dump(tmp, "before.txt", {"U1": "A"})
            after = write_dump(tmp, "after.txt", {"U1": "B"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "A", "toMaster": "B"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertIn("action-not-allowed", [r["code"] for r in contribution["refusals"]])
            # An undeclared op kind is a different problem from an
            # out-of-scope object; it must not also show up there.
            self.assertEqual(contribution["outOfScope"], [])
            self.assertNotIn("out-of-scope", [r["code"] for r in contribution["refusals"]])

    def test_pg_local_adjust_within_edit_domain_region_is_admissible(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(regions=[[0, 0, 100, 100]])
            before = write_dump(tmp, "before.txt", {})
            after = write_dump(tmp, "after.txt", {})
            trace = ops_text({"op": "pg_local_adjust", "region": [10, 10, 20, 20], "action": "strap", "detail": "widen VDD"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertIn([10, 10, 20, 20], contribution["touches"]["regions"])

    def test_pg_local_adjust_outside_edit_domain_regions_is_out_of_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(regions=[[0, 0, 10, 10]])
            before = write_dump(tmp, "before.txt", {})
            after = write_dump(tmp, "after.txt", {})
            trace = ops_text({"op": "pg_local_adjust", "region": [50, 50, 60, 60], "action": "strap", "detail": "widen VDD"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertFalse(contribution["admissible"])
            self.assertEqual(contribution["outOfScope"], ["region:[50, 50, 60, 60]"])

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

    def test_no_fix_with_whitespace_only_diagnosis_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref()
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX1"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": "   "}, ""
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
            # A trace-created instance is never preconditioned on the base dump.
            self.assertEqual(contribution["preconditions"], [])

    def test_atomic_group_joins_non_adjacent_later_op_on_same_new_instance(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"], edit_instances=["U9"])
            new_instance = f"{prefix}BUF1"
            before = write_dump(tmp, "before.txt", {"U9": "A"})
            after = write_dump(tmp, "after.txt", {"U9": "B", new_instance: "BUFX2"})
            trace = ops_text(
                {
                    "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": new_instance,
                    "newNet": "N1_buf", "master": "BUFX1", "location": None,
                },
                {"op": "size_cell", "instance": "U9", "fromMaster": "A", "toMaster": "B"},
                {"op": "size_cell", "instance": new_instance, "fromMaster": "BUFX1", "toMaster": "BUFX2"},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertIn([0, 2], contribution["atomicGroups"])

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

    def test_explicit_group_merges_with_creator_dependent_edge(self):
        # Controller decision: an explicit "group" tag adds an edge, it
        # never suppresses the creator->dependent edge. Here op 0 (the
        # creator) is explicitly tagged alone; op 1 (untagged) still
        # targets op 0's own new instance, so the two must merge into one
        # group rather than staying [0] and un-grouped.
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"])
            new_instance = f"{prefix}BUF1"
            before = write_dump(tmp, "before.txt", {})
            after = write_dump(tmp, "after.txt", {new_instance: "BUFX2"})
            trace = ops_text(
                {
                    "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": new_instance,
                    "newNet": "N1_buf", "master": "BUFX1", "location": None, "group": 1,
                },
                {"op": "size_cell", "instance": new_instance, "fromMaster": "BUFX1", "toMaster": "BUFX2"},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertEqual(contribution["atomicGroups"], [[0, 1]])

    def test_atomic_group_merges_explicit_pair_then_creator_edge(self):
        # [insert B (group 7), size D (group 7), size B (no group)] -> [[0, 1, 2]]
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"], edit_instances=["D"])
            new_instance = f"{prefix}B"
            before = write_dump(tmp, "before.txt", {"D": "X"})
            after = write_dump(tmp, "after.txt", {"D": "Y", new_instance: "BUFX2"})
            trace = ops_text(
                {
                    "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": new_instance,
                    "newNet": "N1_buf", "master": "BUFX1", "location": None, "group": 7,
                },
                {"op": "size_cell", "instance": "D", "fromMaster": "X", "toMaster": "Y", "group": 7},
                {"op": "size_cell", "instance": new_instance, "fromMaster": "BUFX1", "toMaster": "BUFX2"},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertEqual(contribution["atomicGroups"], [[0, 1, 2]])

    def test_atomic_group_merges_creator_edge_then_explicit_pair(self):
        # [insert B (no group), size B (group 7), size D (group 7)] -> [[0, 1, 2]]
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, prefix = make_base_ref(edit_nets=["N1"], edit_instances=["D"])
            new_instance = f"{prefix}B"
            before = write_dump(tmp, "before.txt", {"D": "X"})
            after = write_dump(tmp, "after.txt", {"D": "Y", new_instance: "BUFX2"})
            trace = ops_text(
                {
                    "op": "insert_buffer", "net": "N1", "loadPins": ["U2/A"], "newInstance": new_instance,
                    "newNet": "N1_buf", "master": "BUFX1", "location": None,
                },
                {"op": "size_cell", "instance": new_instance, "fromMaster": "BUFX1", "toMaster": "BUFX2", "group": 7},
                {"op": "size_cell", "instance": "D", "fromMaster": "X", "toMaster": "Y", "group": 7},
            )

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertTrue(contribution["admissible"])
            self.assertEqual(contribution["atomicGroups"], [[0, 1, 2]])

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

    def test_before_dump_sha256_is_recorded(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertEqual(contribution["beforeDumpSha256"], core.file_sha256(before))

    def test_dependencies_default_to_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "diagnosis": None}, trace
            )

            self.assertEqual(contribution["dependencies"], [])

    def test_dependencies_are_sorted_and_deduplicated_strings(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {
                    "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                    "dependencies": ["dep-b", "dep-a", "dep-a"],
                },
                trace,
            )

            self.assertEqual(contribution["dependencies"], ["dep-a", "dep-b"])

    def test_dependencies_bare_string_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            with self.assertRaises(core.AtcsError) as ctx:
                contributions.seal(
                    base_ref,
                    {
                        "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                        "dependencies": "dep-a",
                    },
                    trace,
                )
            self.assertEqual(ctx.exception.code, "malformed-input")

    def test_non_dict_result_refs_raise_missing_input(self):
        base_ref, _prefix = make_base_ref(edit_instances=["U1"])
        trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})
        for bad in (None, "x", []):
            with self.assertRaises(core.AtcsError) as ctx:
                contributions.seal(base_ref, bad, trace)
            self.assertEqual(ctx.exception.code, "missing-input")

    def test_dependencies_with_invalid_entries_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            for bad_entry in (None, {"id": "dep-a"}, ""):
                with self.subTest(bad_entry=bad_entry):
                    with self.assertRaises(core.AtcsError) as ctx:
                        contributions.seal(
                            base_ref,
                            {
                                "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                                "dependencies": ["dep-a", bad_entry],
                            },
                            trace,
                        )
                    self.assertEqual(ctx.exception.code, "malformed-input")

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

    def test_predicted_measure_with_extra_keys_is_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {
                    "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                    "predicted": {"xtopSetupWns": {"value": 0.1, "extra": True}},
                },
                trace,
            )

            self.assertIn("unknown", contribution["predicted"]["xtopSetupWns"])
            self.assertEqual(contribution["validationLevel"], "none")

    def test_predicted_measure_with_non_finite_value_is_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {
                    "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                    "predicted": {"xtopSetupWns": {"value": float("inf")}},
                },
                trace,
            )

            self.assertIn("unknown", contribution["predicted"]["xtopSetupWns"])
            self.assertEqual(contribution["validationLevel"], "none")

    def test_predicted_measure_with_empty_unknown_reason_is_malformed_measure(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {
                    "beforeDump": before, "afterDump": after, "script": None, "diagnosis": None,
                    "predicted": {"xtopSetupWns": {"unknown": ""}, "xtopHoldWns": {"unknown": 123}},
                },
                trace,
            )

            self.assertEqual(contribution["predicted"]["xtopSetupWns"], core.unknown("malformed measure"))
            self.assertEqual(contribution["predicted"]["xtopHoldWns"], core.unknown("malformed measure"))

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

    def test_non_utf8_before_dump_raises_missing_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before_path = Path(tmp) / "before.txt"
            before_path.write_bytes(b"\xff\xfe\x00bad")
            after = write_dump(tmp, "after.txt", {"U1": "BUFX1"})

            with self.assertRaises(core.AtcsError) as ctx:
                contributions.seal(
                    base_ref, {"beforeDump": str(before_path), "afterDump": after, "script": None}, ""
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

    def test_script_is_hashed_and_made_campaign_relative(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            script_path = workspace_script(tmp)
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref,
                {"beforeDump": before, "afterDump": after, "script": script_path, "diagnosis": None},
                trace,
            )

            self.assertEqual(contribution["script"]["path"], "workspaces/w01/r1/fix.tcl")
            self.assertEqual(contribution["script"]["sha256"], core.file_sha256(script_path))

    def test_script_outside_workspace_root_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(edit_instances=["U1"])
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            outside_dir = Path(tmp) / "elsewhere"
            outside_dir.mkdir()
            outside_script = outside_dir / "fix.tcl"
            outside_script.write_text("size_cell U1 BUFX2\n", encoding="utf-8")
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            with self.assertRaises(core.AtcsError) as ctx:
                contributions.seal(
                    base_ref,
                    {"beforeDump": before, "afterDump": after, "script": str(outside_script), "diagnosis": None},
                    trace,
                )
            self.assertEqual(ctx.exception.code, "script-outside-workspace")

    def test_touches_checks_are_union_of_targets_and_may_affect(self):
        with tempfile.TemporaryDirectory() as tmp:
            base_ref, _prefix = make_base_ref(
                edit_instances=["U1"], targets=["s|setup|EP1"], may_affect=["s|hold|EP2"]
            )
            before = write_dump(tmp, "before.txt", {"U1": "BUFX1"})
            after = write_dump(tmp, "after.txt", {"U1": "BUFX2"})
            trace = ops_text({"op": "size_cell", "instance": "U1", "fromMaster": "BUFX1", "toMaster": "BUFX2"})

            contribution = contributions.seal(
                base_ref, {"beforeDump": before, "afterDump": after, "script": None, "cones": ["cone-1"]}, trace
            )

            self.assertEqual(contribution["touches"]["checks"], ["s|hold|EP2", "s|setup|EP1"])
            self.assertEqual(contribution["touches"]["cones"], ["cone-1"])
            self.assertEqual(contribution["touches"]["instances"], ["U1"])


if __name__ == "__main__":
    unittest.main()
