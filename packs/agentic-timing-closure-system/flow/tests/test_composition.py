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
        self.assertEqual(set(facts["order"]), {c1["id"], c2["id"]})
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


if __name__ == "__main__":
    unittest.main()
