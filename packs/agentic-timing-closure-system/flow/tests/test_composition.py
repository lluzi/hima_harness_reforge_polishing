"""Tests for `atcs.composition` — M4's semantic composition analysis over
sealed ECO Contributions.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_composition.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Fixtures are generated locally in this file (per this task's instructions,
not shared with other in-flight M-task test files). Most contributions are
built as literal dicts matching the `contribution` shape documented in
`atcs.contributions`'s module docstring (fastest way to pin exact `delta`/
`touches`/`dependencies` fields for each acceptance case); one test builds
real contributions through `contributions.seal` end to end, per this task's
instructions ("through contributions.seal where practical").
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

from atcs import composition  # noqa: E402
from atcs import contributions  # noqa: E402
from atcs import core  # noqa: E402


BASE_STATE_ID = "base-0000000000000001"


def make_contribution(
    task_id="w01",
    revision=1,
    base_state_id=BASE_STATE_ID,
    kind="fix",
    operations=None,
    delta=None,
    touches=None,
    dependencies=None,
    atomic_groups=None,
    admissible=True,
    before_dump_sha256="a" * 64,
    diagnosis=None,
    refusals=None,
):
    """A literal `contribution` artifact matching `atcs.contributions`'s
    module-docstring shape, stamped with `core.stamp` exactly as `seal`
    would stamp one.
    """
    body = {
        "taskId": task_id,
        "revision": revision,
        "baseStateId": base_state_id,
        "kind": kind,
        "operations": operations if operations is not None else [],
        "script": None,
        "beforeDumpSha256": before_dump_sha256,
        "delta": delta if delta is not None else {"mastersChanged": {}, "added": {}, "removed": {}},
        "touches": touches
        if touches is not None
        else {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
        "preconditions": [],
        "dependencies": list(dependencies or []),
        "atomicGroups": atomic_groups if atomic_groups is not None else [],
        "predicted": {
            "xtopSetupWns": core.unknown("not-predicted"),
            "xtopHoldWns": core.unknown("not-predicted"),
            "prestaSetupWns": core.unknown("not-predicted"),
            "prestaHoldWns": core.unknown("not-predicted"),
        },
        "validationLevel": "none",
        "diagnosis": diagnosis,
        "admissible": admissible,
        "refusals": list(refusals or []),
        "outOfScope": [],
    }
    return core.stamp("contribution", body)


def size_op(instance, from_master, to_master):
    return {"op": "size_cell", "instance": instance, "fromMaster": from_master, "toMaster": to_master}


def insert_op(net, new_instance, new_net, master, location=None, load_pins=None):
    return {
        "op": "insert_buffer",
        "net": net,
        "loadPins": list(load_pins or ["U/A"]),
        "newInstance": new_instance,
        "newNet": new_net,
        "master": master,
        "location": location,
    }


def delete_op(instance, master):
    return {"op": "delete_buffer", "instance": instance, "master": master}


def pg_op(region, action="strap", detail="widen"):
    return {"op": "pg_local_adjust", "region": list(region), "action": action, "detail": detail}


class ConflictKeyTests(unittest.TestCase):
    def test_stable_regardless_of_input_order(self):
        key1 = composition.conflict_key("name-collision", ["b", "a"], ["y", "x"])
        key2 = composition.conflict_key("name-collision", ["a", "b"], ["x", "y"])
        self.assertEqual(key1, key2)

    def test_format_is_kind_pipe_ids_pipe_objects(self):
        key = composition.conflict_key("missing-dependency", ["c1"], ["c0"])
        self.assertEqual(key, "missing-dependency|c1|c0")

    def test_dedupes_within_each_part(self):
        key = composition.conflict_key("x", ["a", "a"], ["o", "o"])
        self.assertEqual(key, "x|a|o")


class DisjointFixesTests(unittest.TestCase):
    def test_two_disjoint_fixes_no_conflicts_both_in_order(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual(facts["conflicts"], [])
        self.assertEqual(facts["order"], sorted([c1["id"], c2["id"]]))
        self.assertEqual(sorted(facts["considered"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(facts["unresolvedCount"], 0)


class DuplicateTests(unittest.TestCase):
    def test_identical_operations_dedupe_keeping_lower_id(self):
        ops = [size_op("U1", "BUFX1", "BUFX2")]
        delta = {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}}
        c1 = make_contribution(task_id="w01", operations=ops, delta=delta)
        c2 = make_contribution(task_id="w02", operations=ops, delta=delta)
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual(len(facts["duplicates"]), 1)
        entry = facts["duplicates"][0]
        expected_keep = min(c1["id"], c2["id"])
        self.assertEqual(entry["keep"], expected_keep)
        self.assertEqual(sorted(entry["sources"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(entry["dropped"], [max(c1["id"], c2["id"])])


class SameInstanceDifferentMasterTests(unittest.TestCase):
    def test_conflict_raised(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U1", "BUFX1", "BUFX4")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("same-instance-different-master", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "same-instance-different-master")
        self.assertEqual(sorted(conflict["contributions"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(conflict["objects"], ["U1"])
        self.assertEqual(
            conflict["key"],
            composition.conflict_key("same-instance-different-master", [c1["id"], c2["id"]], ["U1"]),
        )
        self.assertEqual(facts["unresolvedCount"], 1)


class DeleteVsModifyTests(unittest.TestCase):
    def test_delete_and_size_on_same_instance_conflict(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[delete_op("U1", "BUFX1")],
            delta={"mastersChanged": {}, "added": {}, "removed": {"U1": "BUFX1"}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U1", "BUFX1", "BUFX4")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("delete-vs-modify", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "delete-vs-modify")
        self.assertEqual(sorted(conflict["contributions"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(conflict["objects"], ["U1"])


class SharedInstanceEditTests(unittest.TestCase):
    """`shared-instance-edit`: any pre-existing instance edited by two
    contributions in a way `same-instance-different-master`/
    `delete-vs-modify` don't already cover more specifically — a
    converging same-master resize, or two independent deletes."""

    def test_same_instance_same_target_master_still_conflicts(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("shared-instance-edit", kinds)
        self.assertNotIn("same-instance-different-master", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "shared-instance-edit")
        self.assertEqual(sorted(conflict["contributions"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(conflict["objects"], ["U1"])

    def test_same_instance_both_deleted_conflicts(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[delete_op("U1", "BUFX1")],
            delta={"mastersChanged": {}, "added": {}, "removed": {"U1": "BUFX1"}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[delete_op("U1", "BUFX1")],
            delta={"mastersChanged": {}, "added": {}, "removed": {"U1": "BUFX1"}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("shared-instance-edit", kinds)

    def test_different_master_precedence_suppresses_shared_instance_edit(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U1", "BUFX1", "BUFX4")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("same-instance-different-master", kinds)
        self.assertNotIn("shared-instance-edit", kinds)

    def test_delete_vs_modify_precedence_suppresses_shared_instance_edit(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[delete_op("U1", "BUFX1")],
            delta={"mastersChanged": {}, "added": {}, "removed": {"U1": "BUFX1"}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U1", "BUFX1", "BUFX4")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("delete-vs-modify", kinds)
        self.assertNotIn("shared-instance-edit", kinds)


class SameLoadPinTests(unittest.TestCase):
    def test_shared_load_pin_conflicts_with_prefixed_distinct_names_and_null_location(self):
        # namePrefix (`atcs_<taskId>_r<rev>_`) makes name-collision and
        # identical-op duplicates impossible across workers; same-load-pin
        # is the cross-worker conflict that still catches two independent
        # insertions fighting over the same load pin's connectivity.
        c1 = make_contribution(
            task_id="w01",
            operations=[
                insert_op(
                    "N1", "atcs_w01_r1_BUF1", "atcs_w01_r1_N1_buf", "BUFX1", location=None, load_pins=["U9/A"]
                )
            ],
            delta={"mastersChanged": {}, "added": {"atcs_w01_r1_BUF1": "BUFX1"}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[
                insert_op(
                    "N2", "atcs_w02_r1_BUF7", "atcs_w02_r1_N2_buf", "BUFX1", location=None, load_pins=["U9/A"]
                )
            ],
            delta={"mastersChanged": {}, "added": {"atcs_w02_r1_BUF7": "BUFX1"}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual(facts["duplicates"], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertNotIn("name-collision", kinds)
        self.assertIn("same-load-pin", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "same-load-pin")
        self.assertEqual(conflict["objects"], ["U9/A"])
        self.assertEqual(sorted(conflict["contributions"]), sorted([c1["id"], c2["id"]]))

    def test_shared_load_pin_suppresses_shared_net_interaction(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[insert_op("N1", "atcs_w01_r1_BUF1", "atcs_w01_r1_N1b", "BUFX1", location=None, load_pins=["U9/A"])],
            delta={"mastersChanged": {}, "added": {"atcs_w01_r1_BUF1": "BUFX1"}, "removed": {}},
            touches={"instances": [], "nets": ["N1"], "regions": [], "checks": [], "cones": []},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[insert_op("N1", "atcs_w02_r1_BUF2", "atcs_w02_r1_N1c", "BUFX1", location=None, load_pins=["U9/A"])],
            delta={"mastersChanged": {}, "added": {"atcs_w02_r1_BUF2": "BUFX1"}, "removed": {}},
            touches={"instances": [], "nets": ["N1"], "regions": [], "checks": [], "cones": []},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertIn("same-load-pin", [c["kind"] for c in facts["conflicts"]])
        self.assertNotIn("shared-net", [i["kind"] for i in facts["interactions"]])


class SharedNetTests(unittest.TestCase):
    def test_overlapping_nets_without_shared_load_pin_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[insert_op("N1", "atcs_w01_r1_BUF1", "atcs_w01_r1_N1b", "BUFX1", location=None, load_pins=["U1/A"])],
            delta={"mastersChanged": {}, "added": {"atcs_w01_r1_BUF1": "BUFX1"}, "removed": {}},
            touches={"instances": [], "nets": ["N1"], "regions": [], "checks": [], "cones": []},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[insert_op("N1", "atcs_w02_r1_BUF2", "atcs_w02_r1_N1c", "BUFX1", location=None, load_pins=["U2/A"])],
            delta={"mastersChanged": {}, "added": {"atcs_w02_r1_BUF2": "BUFX1"}, "removed": {}},
            touches={"instances": [], "nets": ["N1"], "regions": [], "checks": [], "cones": []},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertNotIn("same-load-pin", [c["kind"] for c in facts["conflicts"]])
        self.assertIn("shared-net", [i["kind"] for i in facts["interactions"]])
        interaction = next(i for i in facts["interactions"] if i["kind"] == "shared-net")
        self.assertEqual(sorted(interaction["contributions"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(interaction["evidence"]["sharedNets"], ["N1"])


class PgLocalAdjustSharedSpaceTests(unittest.TestCase):
    def test_overlapping_pg_local_adjust_regions_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[pg_op([0.0, 0.0, 2.0, 2.0])],
            delta={"mastersChanged": {}, "added": {}, "removed": {}},
            touches={"instances": [], "nets": [], "regions": [[0.0, 0.0, 2.0, 2.0]], "checks": [], "cones": []},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[pg_op([3.0, 0.0, 5.0, 2.0])],
            delta={"mastersChanged": {}, "added": {}, "removed": {}},
            touches={"instances": [], "nets": [], "regions": [[3.0, 0.0, 5.0, 2.0]], "checks": [], "cones": []},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [i["kind"] for i in facts["interactions"]]
        self.assertIn("shared-space", kinds)

    def test_pg_local_adjust_and_insertion_can_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[pg_op([0.0, 0.0, 1.0, 1.0])],
            delta={"mastersChanged": {}, "added": {}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[insert_op("N1", "atcs_w02_r1_BUF1", "atcs_w02_r1_N1b", "BUFX1", location=[1.5, 0.5])],
            delta={"mastersChanged": {}, "added": {"atcs_w02_r1_BUF1": "BUFX1"}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [i["kind"] for i in facts["interactions"]]
        self.assertIn("shared-space", kinds)


class OrderTieBreakTests(unittest.TestCase):
    def test_dependency_edge_overrides_alphabetical_tie_break(self):
        # "a" sorts before "z", but "a" depends on "z", so "z" must be
        # placed first regardless of the plain alphabetical tie-break.
        a = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            dependencies=["z"],
        )
        z = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        a = dict(a, id="a")
        z = dict(z, id="z")
        facts = composition.analyze(BASE_STATE_ID, [a, z], [])
        self.assertEqual(facts["order"], ["z", "a"])

    def test_three_independent_ids_tie_break_alphabetically(self):
        ids = ["b0", "a0", "c0"]
        contributions = []
        for index, cid in enumerate(ids):
            contribution = make_contribution(
                task_id=f"w{index:02d}",
                operations=[size_op(f"U{index}", "BUFX1", "BUFX2")],
                delta={"mastersChanged": {f"U{index}": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            )
            contributions.append(dict(contribution, id=cid))
        facts = composition.analyze(BASE_STATE_ID, contributions, [])
        self.assertEqual(facts["order"], sorted(ids))


class BaseDumpMismatchTests(unittest.TestCase):
    def test_three_fixes_one_differing_hash_yields_one_conflict_with_exact_key(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            before_dump_sha256="a" * 64,
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            before_dump_sha256="a" * 64,
        )
        c3 = make_contribution(
            task_id="w03",
            operations=[size_op("U3", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U3": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            before_dump_sha256="b" * 64,
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c3], [])
        mismatches = [c for c in facts["conflicts"] if c["kind"] == "base-dump-mismatch"]
        self.assertEqual(len(mismatches), 1)
        conflict = mismatches[0]
        # Only the minority (c3, hash "b"*64) is named — c1/c2 agree with
        # the majority and are never swept into the conflict's identity.
        self.assertEqual(conflict["contributions"], [c3["id"]])
        self.assertEqual(conflict["objects"], ["b" * 64])
        self.assertEqual(
            conflict["key"], composition.conflict_key("base-dump-mismatch", [c3["id"]], ["b" * 64])
        )

    def test_majority_tie_breaks_to_lexicographically_smallest_hash(self):
        c1 = make_contribution(task_id="w01", before_dump_sha256="b" * 64)
        c2 = make_contribution(task_id="w02", before_dump_sha256="a" * 64)
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "base-dump-mismatch")
        # Both groups have size 1, so the lexicographically smallest hash
        # ("a"*64) is the majority and only c1 (hash "b"*64) is named.
        self.assertEqual(conflict["contributions"], [c1["id"]])
        self.assertEqual(conflict["objects"], ["b" * 64])


class DeterminismTests(unittest.TestCase):
    def test_analyze_is_independent_of_input_order(self):
        p = make_contribution(
            task_id="w01",
            operations=[insert_op("N1", "atcs_w01_r1_BUF1", "atcs_w01_r1_N1b", "BUFX1", location=[10.0, 10.0])],
            delta={"mastersChanged": {}, "added": {"atcs_w01_r1_BUF1": "BUFX1"}, "removed": {}},
            touches={"instances": [], "nets": ["N1"], "regions": [], "checks": ["c1"], "cones": []},
        )
        q = make_contribution(
            task_id="w02",
            operations=[insert_op("N1", "atcs_w02_r1_BUF2", "atcs_w02_r1_N1c", "BUFX1", location=[11.0, 10.0])],
            delta={"mastersChanged": {}, "added": {"atcs_w02_r1_BUF2": "BUFX1"}, "removed": {}},
            touches={"instances": [], "nets": ["N1"], "regions": [], "checks": ["c1"], "cones": []},
        )
        facts_pq = composition.analyze(BASE_STATE_ID, [p, q], [])
        facts_qp = composition.analyze(BASE_STATE_ID, [q, p], [])
        self.assertEqual(facts_pq, facts_qp)


class ValidationErrorTests(unittest.TestCase):
    def test_duplicate_contribution_id_raises(self):
        c1 = make_contribution(task_id="w01")
        c2 = dict(make_contribution(task_id="w02"), id=c1["id"])
        with self.assertRaises(core.AtcsError) as ctx:
            composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual(ctx.exception.code, "duplicate-contribution")

    def test_missing_contribution_id_raises_missing_input(self):
        c1 = dict(make_contribution(task_id="w01"))
        c1.pop("id")
        with self.assertRaises(core.AtcsError) as ctx:
            composition.analyze(BASE_STATE_ID, [c1], [])
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_non_string_conflict_key_in_resolution_raises_missing_input(self):
        c1 = make_contribution(task_id="w01")
        with self.assertRaises(core.AtcsError) as ctx:
            composition.analyze(BASE_STATE_ID, [c1], [{"conflictKey": 42, "decision": "keep:x"}])
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_resolution_missing_conflict_key_raises_missing_input(self):
        c1 = make_contribution(task_id="w01")
        with self.assertRaises(core.AtcsError) as ctx:
            composition.analyze(BASE_STATE_ID, [c1], [{"decision": "keep:x"}])
        self.assertEqual(ctx.exception.code, "missing-input")


class SharedTimingWindowTests(unittest.TestCase):
    def test_different_instances_sharing_checks_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            touches={
                "instances": ["U1"], "nets": [], "regions": [],
                "checks": ["func_ssg_rcworst_m40|setup|EP1"], "cones": [],
            },
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            touches={
                "instances": ["U2"], "nets": [], "regions": [],
                "checks": ["func_ssg_rcworst_m40|setup|EP1"], "cones": [],
            },
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual(facts["conflicts"], [])
        kinds = [interaction["kind"] for interaction in facts["interactions"]]
        self.assertIn("shared-timing-window", kinds)
        interaction = next(i for i in facts["interactions"] if i["kind"] == "shared-timing-window")
        self.assertEqual(sorted(interaction["contributions"]), sorted([c1["id"], c2["id"]]))

    def test_shared_cones_also_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            touches={"instances": ["U1"], "nets": [], "regions": [], "checks": [], "cones": ["coneA"]},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            touches={"instances": ["U2"], "nets": [], "regions": [], "checks": [], "cones": ["coneA"]},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [interaction["kind"] for interaction in facts["interactions"]]
        self.assertIn("shared-timing-window", kinds)


class SharedSpaceTests(unittest.TestCase):
    def test_overlapping_insertion_boxes_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[insert_op("N1", "BUF1", "N1_buf", "BUFX1", location=[10.0, 10.0])],
            delta={"mastersChanged": {}, "added": {"BUF1": "BUFX1"}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[insert_op("N2", "BUF2", "N2_buf", "BUFX1", location=[11.5, 10.0])],
            delta={"mastersChanged": {}, "added": {"BUF2": "BUFX1"}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [interaction["kind"] for interaction in facts["interactions"]]
        self.assertIn("shared-space", kinds)

    def test_far_apart_insertions_do_not_interact(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[insert_op("N1", "BUF1", "N1_buf", "BUFX1", location=[0.0, 0.0])],
            delta={"mastersChanged": {}, "added": {"BUF1": "BUFX1"}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[insert_op("N2", "BUF2", "N2_buf", "BUFX1", location=[100.0, 100.0])],
            delta={"mastersChanged": {}, "added": {"BUF2": "BUFX1"}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [interaction["kind"] for interaction in facts["interactions"]]
        self.assertNotIn("shared-space", kinds)


class NameCollisionTests(unittest.TestCase):
    def test_same_new_instance_name_conflicts(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[insert_op("N1", "BUF1", "N1_buf", "BUFX1")],
            delta={"mastersChanged": {}, "added": {"BUF1": "BUFX1"}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[insert_op("N2", "BUF1", "N2_buf", "BUFX2")],
            delta={"mastersChanged": {}, "added": {"BUF1": "BUFX2"}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("name-collision", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "name-collision")
        self.assertEqual(conflict["objects"], ["BUF1"])


class MissingDependencyTests(unittest.TestCase):
    def test_dependency_not_in_considered_set_conflicts(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            dependencies=["does-not-exist"],
        )
        facts = composition.analyze(BASE_STATE_ID, [c1], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("missing-dependency", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "missing-dependency")
        self.assertEqual(conflict["contributions"], [c1["id"]])
        self.assertEqual(conflict["objects"], ["does-not-exist"])
        # Still deterministically ordered even though the dependency is unmet.
        self.assertEqual(facts["order"], [c1["id"]])


class DependencyCycleTests(unittest.TestCase):
    def test_cycle_flagged_and_order_still_deterministic(self):
        # A genuine content-addressed id can't reference its own cycle
        # partner's final id (each id would depend on the other), so this
        # wires the two ids directly rather than through `core.stamp` —
        # `composition.analyze` only reads `id`/`dependencies` as plain
        # strings, it never re-verifies a contribution's own hash (that is
        # `core.read_artifact`'s job).
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            dependencies=["c2"],
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
            dependencies=["c1"],
        )
        c1 = dict(c1, id="c1")
        c2 = dict(c2, id="c2")

        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        kinds = [conflict["kind"] for conflict in facts["conflicts"]]
        self.assertIn("dependency-cycle", kinds)
        conflict = next(c for c in facts["conflicts"] if c["kind"] == "dependency-cycle")
        self.assertEqual(sorted(conflict["contributions"]), sorted([c1["id"], c2["id"]]))
        self.assertEqual(sorted(facts["order"]), sorted([c1["id"], c2["id"]]))


class StaleBaseTests(unittest.TestCase):
    def test_different_base_state_id_excluded_and_flagged(self):
        stale = make_contribution(task_id="w01", base_state_id="some-other-base")
        fresh = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [stale, fresh], [])
        self.assertEqual(facts["staleBase"], [stale["id"]])
        self.assertNotIn(stale["id"], facts["considered"])
        self.assertIn(fresh["id"], facts["considered"])
        self.assertNotIn(stale["id"], facts["order"])


class InadmissibleTests(unittest.TestCase):
    def test_inadmissible_excluded_from_considered_and_everywhere_else(self):
        bad = make_contribution(task_id="w01", admissible=False, refusals=[{"code": "out-of-scope", "detail": "x"}])
        good = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        facts = composition.analyze(BASE_STATE_ID, [bad, good], [])
        self.assertNotIn(bad["id"], facts["considered"])
        self.assertNotIn(bad["id"], facts["staleBase"])
        self.assertNotIn(bad["id"], facts["order"])
        for conflict in facts["conflicts"]:
            self.assertNotIn(bad["id"], conflict["contributions"])
        for interaction in facts["interactions"]:
            self.assertNotIn(bad["id"], interaction["contributions"])


class NoFixTests(unittest.TestCase):
    def test_no_fix_considered_last_in_order_no_conflicts(self):
        no_fix = make_contribution(task_id="w01", kind="no-fix", operations=[], diagnosis="root-caused elsewhere")
        fix_a = make_contribution(
            task_id="w02",
            operations=[size_op("U2", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U2": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        another_no_fix = make_contribution(task_id="w03", kind="no-fix", operations=[], diagnosis="also studied")
        facts = composition.analyze(BASE_STATE_ID, [no_fix, fix_a, another_no_fix], [])
        self.assertEqual(facts["conflicts"], [])
        self.assertEqual(facts["order"][-1], sorted([no_fix["id"], another_no_fix["id"]])[-1])
        self.assertEqual(set(facts["order"][-2:]), {no_fix["id"], another_no_fix["id"]})
        self.assertEqual(facts["order"][0], fix_a["id"])


class ResolutionsTests(unittest.TestCase):
    def test_resolution_lowers_unresolved_count_and_unknown_ones_are_reported(self):
        c1 = make_contribution(
            task_id="w01",
            operations=[size_op("U1", "BUFX1", "BUFX2")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        )
        c2 = make_contribution(
            task_id="w02",
            operations=[size_op("U1", "BUFX1", "BUFX4")],
            delta={"mastersChanged": {"U1": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}},
        )
        facts_unresolved = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual(facts_unresolved["unresolvedCount"], 1)
        conflict_key = facts_unresolved["conflicts"][0]["key"]

        facts_resolved = composition.analyze(
            BASE_STATE_ID, [c1, c2], [{"conflictKey": conflict_key, "decision": f"keep:{c1['id']}"}]
        )
        self.assertEqual(facts_resolved["unresolvedCount"], 0)

        facts_unknown = composition.analyze(
            BASE_STATE_ID, [c1, c2], [{"conflictKey": "not-a-real-key", "decision": "keep:x"}]
        )
        self.assertEqual(facts_unknown["unresolvedCount"], 1)
        self.assertEqual(facts_unknown["unknownResolutions"], ["not-a-real-key"])


class SealedContributionIntegrationTest(unittest.TestCase):
    """Builds real contributions through `contributions.seal` end to end,
    then checks M4 finds them disjoint and orderable — the happy path this
    module exists to compose over."""

    def _seal_one(self, tmp_dir, task_id, base_dump, instance, from_master, to_master, edit_instances):
        work_package_body = {
            "taskId": task_id,
            "baseStateId": BASE_STATE_ID,
            "problem": "close setup",
            "targets": [],
            "editDomain": {"instances": list(edit_instances), "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []},
            "mayAffect": [],
            "actions": ["size_cell", "insert_buffer", "delete_buffer", "pg_local_adjust"],
            "budget": {"xtopMinutes": 10, "queries": 10, "attempts": 3},
        }
        work_package = core.stamp("work-package", work_package_body)
        manifest_body = {
            "workPackageId": work_package["id"],
            "taskId": task_id,
            "revision": 1,
            "root": f"workspaces/{task_id}/r1/",
            "readOnly": [],
            "namePrefix": f"atcs_{task_id}_r1_",
            "recovery": {"checkpoint": None},
            "baseStateId": BASE_STATE_ID,
        }
        manifest = core.stamp("workspace-manifest", manifest_body)
        base_ref = {"stateId": BASE_STATE_ID, "workspaceManifest": manifest, "workPackage": work_package}

        # Both workers checkpoint out of the *same* base state, so a
        # faithful `beforeDump` is the whole shared native dump, byte for
        # byte identical across workspaces — not just the one instance
        # this workspace happens to touch. Only `afterDump` differs, by
        # this worker's own edit.
        before_path = Path(tmp_dir) / "shared_before.txt"
        if not before_path.exists():
            before_path.write_text(
                "".join(f"{inst} {master}\n" for inst, master in sorted(base_dump.items())), encoding="utf-8"
            )
        after_dump = dict(base_dump)
        after_dump[instance] = to_master
        after_path = Path(tmp_dir) / f"{task_id}_after.txt"
        after_path.write_text(
            "".join(f"{inst} {master}\n" for inst, master in sorted(after_dump.items())), encoding="utf-8"
        )
        result_refs = {"beforeDump": str(before_path), "afterDump": str(after_path), "script": None}
        operation_trace = json.dumps(
            {"op": "size_cell", "instance": instance, "fromMaster": from_master, "toMaster": to_master}
        )
        return contributions.seal(base_ref, result_refs, operation_trace)

    def test_two_real_sealed_fixes_compose_without_conflict(self):
        base_dump = {"U1": "BUFX1", "U2": "BUFX1"}
        with tempfile.TemporaryDirectory() as tmp_dir:
            c1 = self._seal_one(tmp_dir, "w01", base_dump, "U1", "BUFX1", "BUFX2", ["U1"])
            c2 = self._seal_one(tmp_dir, "w02", base_dump, "U2", "BUFX1", "BUFX2", ["U2"])
            self.assertTrue(c1["admissible"])
            self.assertTrue(c2["admissible"])

            facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
            self.assertEqual(facts["conflicts"], [])
            self.assertEqual(facts["duplicates"], [])
            self.assertEqual(sorted(facts["considered"]), sorted([c1["id"], c2["id"]]))
            self.assertEqual(set(facts["order"]), {c1["id"], c2["id"]})
            self.assertEqual(facts["unresolvedCount"], 0)
            self.assertEqual(facts["schema"], "atcs.composition-facts/1")



# ---------------------------------------------------------------------------
# Issue #64 Task 4 (user amendment 2026-09-28): a ranked recipe over admitted
# `xtop-session` Contributions -- rank, mark `skip: shared-instance`, never refuse.
# ---------------------------------------------------------------------------

import session_fixtures as sf  # noqa: E402

SESSION_BEFORE = {"U1": "BUFX1", "U2": "BUFX1", "U3": "INVX1", "U4": "BUFX1"}
NO_GAIN = ((-0.020, -0.100), (-0.020, -0.100))


def _hold_gain(delta_wns, delta_tns=0.1):
    return NO_GAIN, ((-0.070, -1.200), (-0.070 + delta_wns, -1.200 + delta_tns))


def _session(slot, sizes, gain, targets=None, target_pins=None, extra=None, before=None):
    """Seal one admitted session in `slot` that sizes each `(instance, to)` in `sizes`."""
    before = dict(before or SESSION_BEFORE)
    base_ref = sf.make_base_ref(slot=slot, instances=tuple(sorted(before)), targets=targets,
                                target_pins=target_pins)
    log = sf.SessionLog()
    after = dict(before)
    for instance, to_master in sizes:
        log.size(instance, after[instance], to_master, gain=gain)
        after[instance] = to_master
    if extra is not None:
        extra(log, after)
    with tempfile.TemporaryDirectory() as tmp:
        before_path = Path(tmp) / "before.dump"
        after_path = Path(tmp) / "after.dump"
        before_path.write_text(sf.dump_text(before), encoding="utf-8")
        after_path.write_text(sf.dump_text(after), encoding="utf-8")
        contribution = contributions.seal_session(
            base_ref,
            {"beforeDump": str(before_path), "afterDump": str(after_path),
             "evidence": {"taintedJson": None, "transcriptTaint": "clean", "ecoOutput": True}},
            log.ops_text(), log.gain_text())
    return contribution


class XtopSessionRecipeTests(unittest.TestCase):
    def test_a_shared_instance_is_skipped_in_the_lower_ranked_session_and_the_batch_still_composes(self):
        high = _session("w01", [("U1", "BUFX2"), ("U2", "BUFX2")], _hold_gain(0.030))
        low = _session("w02", [("U3", "INVX2"), ("U1", "BUFX4")], _hold_gain(0.010))
        self.assertTrue(high["admissible"], high["refusals"])
        self.assertTrue(low["admissible"], low["refusals"])

        facts = composition.analyze(BASE_STATE_ID, [low, high], [])

        self.assertEqual(facts["conflicts"], [])
        self.assertEqual(facts["unresolvedCount"], 0)
        self.assertEqual(sorted(facts["considered"]), sorted([high["id"], low["id"]]))
        recipe = facts["recipe"]
        self.assertEqual([entry["contribution"] for entry in recipe["sessions"]], [high["id"], low["id"]])
        self.assertEqual([entry["rank"] for entry in recipe["sessions"]], [1, 2])
        high_commands, low_commands = (entry["commands"] for entry in recipe["sessions"])
        self.assertEqual([command["skip"] for command in high_commands], [None, None])
        self.assertEqual([command["args"]["instance"] for command in low_commands], ["U3", "U1"])
        self.assertIsNone(low_commands[0]["skip"])
        self.assertEqual(low_commands[1]["skip"], "shared-instance")
        self.assertEqual(low_commands[1]["sharedWith"], [{"instance": "U1", "contribution": high["id"], "rank": 1}])
        self.assertEqual(recipe["commandCount"], 4)
        self.assertEqual(recipe["skipCount"], 1)
        self.assertEqual(facts["order"], [high["id"], low["id"]])

    def test_blocker_coverage_ranks_before_predicted_value(self):
        covers = _session("w01", [("U1", "BUFX2")], _hold_gain(0.005),
                          targets=["func_ss|hold|U1/D"], target_pins=["U1/D"])
        bulk = _session("w02", [("U2", "BUFX2")], _hold_gain(0.040),
                        targets=["func_ss|hold|U2/D"], target_pins=["U2/D"])
        worst = ["func_ss|hold|U1/D"]

        ranked = composition.analyze(BASE_STATE_ID, [bulk, covers], [], worst_checks=worst)["recipe"]
        self.assertEqual([entry["contribution"] for entry in ranked["sessions"]], [covers["id"], bulk["id"]])
        self.assertEqual(ranked["sessions"][0]["blockerCoverage"], 1)
        self.assertEqual(ranked["sessions"][0]["coveredChecks"], worst)
        self.assertEqual(ranked["worstChecks"], worst)

        by_value = composition.analyze(BASE_STATE_ID, [covers, bulk], [])["recipe"]
        self.assertEqual([entry["contribution"] for entry in by_value["sessions"]], [bulk["id"], covers["id"]])

    def test_a_skipped_creation_cascades_to_commands_on_the_instance_it_created(self):
        def fix_then_size(log, after):
            log.fix_hold(["U1/D"], {"U1": "BUFX2", "atcs_w02_r1_eco_1": None},
                         {"U1": "BUFX4", "atcs_w02_r1_eco_1": "DELAY2"}, gain=_hold_gain(0.010))
            log.size("atcs_w02_r1_eco_1", "DELAY2", "DELAY4", gain=_hold_gain(0.012))
            after.update({"U1": "BUFX4", "atcs_w02_r1_eco_1": "DELAY4"})

        high = _session("w01", [("U1", "BUFX2")], _hold_gain(0.030))
        low = _session("w02", [("U1", "BUFX2")], _hold_gain(0.001), extra=fix_then_size)
        self.assertTrue(low["admissible"], low["refusals"])

        recipe = composition.analyze(BASE_STATE_ID, [high, low], [])["recipe"]
        skips = [command["skip"] for command in recipe["sessions"][1]["commands"]]
        self.assertEqual(skips, ["shared-instance", "shared-instance", "depends-on-skipped"])

    def test_an_inadmissible_session_is_listed_as_excluded_and_never_ranked(self):
        good = _session("w01", [("U1", "BUFX2")], _hold_gain(0.030))
        worse = _session("w02", [("U2", "BUFX2")], _hold_gain(-0.010))
        self.assertEqual([refusal["code"] for refusal in worse["refusals"]], ["no-predicted-gain"])

        facts = composition.analyze(BASE_STATE_ID, [good, worse], [])
        self.assertEqual([entry["contribution"] for entry in facts["recipe"]["sessions"]], [good["id"]])
        self.assertEqual(facts["recipe"]["excluded"],
                         [{"contribution": worse["id"], "taskId": "w02", "codes": ["no-predicted-gain"]}])
        self.assertNotIn(worse["id"], facts["considered"])

    def test_the_recipe_does_not_depend_on_input_order(self):
        first = _session("w01", [("U1", "BUFX2")], _hold_gain(0.020))
        second = _session("w02", [("U1", "BUFX4")], _hold_gain(0.020))
        one = composition.analyze(BASE_STATE_ID, [first, second], [])
        two = composition.analyze(BASE_STATE_ID, [second, first], [])
        self.assertEqual(one["id"], two["id"])
        self.assertEqual(one["recipe"]["sessions"][0]["contribution"], min(first["id"], second["id"]))

    def test_legacy_kinds_keep_their_conflicts_and_an_empty_recipe(self):
        c1 = make_contribution(task_id="w01", delta={"mastersChanged": {"U1": ["BUFX1", "BUFX2"]},
                                                     "added": {}, "removed": {}})
        c2 = make_contribution(task_id="w02", delta={"mastersChanged": {"U1": ["BUFX1", "BUFX4"]},
                                                     "added": {}, "removed": {}})
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        self.assertEqual([conflict["kind"] for conflict in facts["conflicts"]], ["same-instance-different-master"])
        self.assertEqual(facts["recipe"]["sessions"], [])

    def test_a_session_whose_base_dump_disagrees_is_excluded_from_the_recipe_not_a_conflict(self):
        one = _session("w01", [("U1", "BUFX2")], _hold_gain(0.030))
        two = _session("w02", [("U2", "BUFX2")], _hold_gain(0.020))
        odd = _session("w03", [("U3", "INVX2")], _hold_gain(0.050), before={**SESSION_BEFORE, "U9": "BUFX1"})
        self.assertNotEqual(odd["beforeDumpSha256"], one["beforeDumpSha256"])

        facts = composition.analyze(BASE_STATE_ID, [odd, one, two], [])
        self.assertEqual(facts["conflicts"], [])
        self.assertEqual([entry["contribution"] for entry in facts["recipe"]["sessions"]], [one["id"], two["id"]])
        self.assertEqual(facts["recipe"]["excluded"],
                         [{"contribution": odd["id"], "taskId": "w03", "codes": ["base-dump-mismatch"]}])
        self.assertNotIn(odd["id"], facts["considered"])
        self.assertNotIn(odd["id"], facts["order"])

    def test_the_tns_tie_break_uses_the_target_checks_only(self):
        a = _session("w01", [("U1", "BUFX2")], _hold_gain(0.010, 0.10))
        b = _session("w02", [("U2", "BUFX2")], _hold_gain(0.010, 0.30))
        recipe = composition.analyze(BASE_STATE_ID, [a, b], [])["recipe"]
        self.assertEqual([entry["contribution"] for entry in recipe["sessions"]], [b["id"], a["id"]])
        self.assertAlmostEqual(recipe["sessions"][0]["tnsGain"], 0.30)

    def test_worst_checks_are_the_worst_failing_check_per_scenario_and_mode(self):
        observation = {"checks": {
            "a|setup|P1": {"slack": core.known(-0.01)}, "a|setup|P2": {"slack": core.known(-0.05)},
            "a|hold|P3": {"slack": core.known(-0.02)}, "b|hold|P4": {"slack": core.known(0.01)},
            "b|setup|P5": {"slack": core.unknown("not reported")},
        }}
        self.assertEqual(composition.worst_checks(observation), ["a|hold|P3", "a|setup|P2"])


if __name__ == "__main__":
    unittest.main()
