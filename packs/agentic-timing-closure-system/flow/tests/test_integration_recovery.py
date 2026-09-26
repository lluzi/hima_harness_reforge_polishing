"""Tests for `atcs.integration` — M5's deterministic replay and merge.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_integration_recovery.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Fixtures are generated locally in this file (per this task's instructions,
not shared with other in-flight M-task test files). Contributions are
built as literal dicts matching the shape documented in
`atcs.contributions`'s module docstring, and every test whose behavior
depends on conflict/duplicate detection runs them through the *real*
`atcs.composition.analyze` (M4) rather than hand-rolled `composition-facts`
literals — per this fix round's instruction, since M5 must work against
whatever M4 actually computes (M4 added `same-load-pin`/`shared-instance-edit`
mid-development) and a duplicates group always comes paired with a
`shared-instance-edit` conflict on the same object. Only tests that are
purely about `integration-plan` field shape (unrelated to any real
conflict) use a minimal literal `composition-facts` stub.

Tests call only `atcs.integration`'s public functions — never its private
(`_`-prefixed) helpers — so an expected delta/Tcl string is always written
out by hand rather than computed via a private helper.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))

from atcs import composition  # noqa: E402
from atcs import core  # noqa: E402
from atcs import integration  # noqa: E402


BASE_STATE_ID = "base-0000000000000001"
OTHER_BASE_STATE_ID = "base-0000000000000002"


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


def pg_op(region=None, action="widen", detail="test"):
    return {"op": "pg_local_adjust", "region": list(region or [0, 0, 1, 1]), "action": action, "detail": detail}


def _delta_for(operations):
    """The `delta` a fresh (empty-before) replay of `operations` implies — hand-computed,
    mirroring `atcs.contributions.actual_delta`'s documented shape, so fixtures stay
    self-consistent without depending on that module's private replay helper.
    """
    delta = {"mastersChanged": {}, "added": {}, "removed": {}}
    for op in operations:
        if op["op"] == "size_cell":
            delta["mastersChanged"][op["instance"]] = [op["fromMaster"], op["toMaster"]]
        elif op["op"] == "insert_buffer":
            delta["added"][op["newInstance"]] = op["master"]
        elif op["op"] == "delete_buffer":
            delta["removed"][op["instance"]] = op["master"]
    return delta


def _touches_for(operations):
    instances, nets, regions = set(), set(), []
    for op in operations:
        if op["op"] in ("size_cell", "delete_buffer"):
            instances.add(op["instance"])
        elif op["op"] == "insert_buffer":
            instances.add(op["newInstance"])
            nets.add(op["net"])
            nets.add(op["newNet"])
        elif op["op"] == "pg_local_adjust":
            regions.append(list(op["region"]))
    return {"instances": sorted(instances), "nets": sorted(nets), "regions": regions, "checks": [], "cones": []}


def make_contribution(
    contribution_id,
    task_id="w01",
    revision=1,
    base_state_id=BASE_STATE_ID,
    operations=None,
    kind=None,
    dependencies=None,
    before_dump_sha256="a" * 64,
    admissible=True,
):
    """A literal `contribution` artifact, with a caller-fixed `id` (rather than one
    `core.stamp`-derived) so tests can name ids explicitly for `select`/`resolutions`/
    `sourceMap` assertions. `delta`/`touches` are derived from `operations` by the
    module-local helpers above so real `composition.analyze` calls see a consistent
    fixture. `kind` defaults to the real derivation rule (`"fix"` iff `operations` is
    non-empty) but can be forced to exercise a malformed-input defensive path.
    """
    operations = operations if operations is not None else []
    return {
        "schema": "atcs.contribution/1",
        "id": contribution_id,
        "taskId": task_id,
        "revision": revision,
        "baseStateId": base_state_id,
        "kind": kind if kind is not None else ("fix" if operations else "no-fix"),
        "operations": operations,
        "script": None,
        "beforeDumpSha256": before_dump_sha256,
        "delta": _delta_for(operations),
        "touches": _touches_for(operations),
        "preconditions": [],
        "dependencies": list(dependencies or []),
        "atomicGroups": [],
        "predicted": {
            "xtopSetupWns": core.unknown("not-predicted"),
            "xtopHoldWns": core.unknown("not-predicted"),
            "prestaSetupWns": core.unknown("not-predicted"),
            "prestaHoldWns": core.unknown("not-predicted"),
        },
        "validationLevel": "none",
        "diagnosis": "diagnosed" if kind == "no-fix" else None,
        "admissible": admissible,
        "refusals": [],
        "outOfScope": [],
    }


def make_plan(batch_id, select, resolutions=None, deferred=None, base_state_id=BASE_STATE_ID, reason="test"):
    return {
        "batchId": batch_id,
        "baseStateId": base_state_id,
        "select": select,
        "resolutions": resolutions or [],
        "deferred": deferred or [],
        "reason": reason,
    }


def stub_facts(order, considered=None, conflicts=None, base_state_id=BASE_STATE_ID):
    """A minimal literal `composition-facts` for tests purely about plan field shape
    (batchId/reason/deferred typing) that do not depend on real conflict detection.
    """
    body = {
        "baseStateId": base_state_id,
        "considered": considered if considered is not None else sorted(order),
        "duplicates": [],
        "conflicts": conflicts or [],
        "interactions": [],
        "staleBase": [],
        "order": order,
        "unresolvedCount": 0,
        "unknownResolutions": [],
    }
    return core.stamp("composition-facts", body)


def find_conflict(facts, kind):
    for conflict in facts["conflicts"]:
        if conflict["kind"] == kind:
            return conflict
    raise AssertionError(f"no {kind!r} conflict in facts: {facts['conflicts']}")


class XtopTclTests(unittest.TestCase):
    def test_size_cell(self):
        self.assertEqual(integration.xtop_tcl(size_op("U1", "INVX1", "INVX4")), "size_cell {U1} INVX4")

    def test_insert_buffer_without_location(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", load_pins=["U/A", "U/B"])
        self.assertEqual(
            integration.xtop_tcl(op),
            "insert_buffer {U/A U/B} {BUFX2} -new_cell_names {atcs_w01_r1_buf0} "
            "-new_net_names {atcs_w01_r1_net0}",
        )

    def test_insert_buffer_with_location(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", location=[10.5, 20.25])
        self.assertIn("-locations {{10.5 20.25}}", integration.xtop_tcl(op))

    def test_delete_buffer(self):
        self.assertEqual(integration.xtop_tcl(delete_op("U9", "BUFX2")), "remove_buffer {U9}")

    def test_pg_local_adjust_unsupported(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(pg_op())
        self.assertEqual(ctx.exception.code, "unsupported-op")

    def test_unsafe_instance_name_with_semicolon_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1;rm -rf", "INVX1", "INVX4"))
        self.assertEqual(ctx.exception.code, "unsafe-name")

    def test_unsafe_master_with_braces_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1", "INVX1", "{INVX4}"))
        self.assertEqual(ctx.exception.code, "unsafe-name")

    def test_unsafe_value_with_backslash_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1", "INVX1", "INVX4\\nrm"))
        self.assertEqual(ctx.exception.code, "unsafe-name")

    def test_value_starting_with_dash_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1", "INVX1", "-force"))
        self.assertEqual(ctx.exception.code, "unsafe-name")

    def test_rendered_text_has_no_line_continuation(self):
        tcl = integration.xtop_tcl(insert_op("N1", "buf0", "net0", "BUFX2", location=[1.0, 2.0]))
        self.assertNotIn("\\\n", tcl)

    def test_malformed_location_wrong_length_raises_malformed_input(self):
        op = insert_op("N1", "buf0", "net0", "BUFX2", location=[1.0, 2.0, 3.0])
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(op)
        self.assertEqual(ctx.exception.code, "malformed-input")

    def test_non_finite_location_raises_malformed_input(self):
        op = insert_op("N1", "buf0", "net0", "BUFX2", location=[float("nan"), 2.0])
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(op)
        self.assertEqual(ctx.exception.code, "malformed-input")


class InnovusEcoTclTests(unittest.TestCase):
    def test_size_cell_uses_eco_change_cell(self):
        self.assertEqual(
            integration.innovus_eco_tcl([size_op("U1", "INVX1", "INVX4")]), "ecoChangeCell -inst {U1} -cell INVX4"
        )

    def test_delete_buffer_uses_eco_delete_repeater(self):
        self.assertEqual(integration.innovus_eco_tcl([delete_op("U9", "BUFX2")]), "ecoDeleteRepeater -inst {U9}")

    def test_buffer_insertion_uses_term_cell_name_newnetname(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", load_pins=["U/A"])
        self.assertEqual(
            integration.innovus_eco_tcl([op]),
            "ecoAddRepeater -term U/A -cell BUFX2 -name atcs_w01_r1_buf0 -newNetName atcs_w01_r1_net0",
        )

    def test_buffer_insertion_with_multiple_pins_and_location(self):
        op = insert_op(
            "N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", load_pins=["U/A", "U/B"], location=[10.5, 20.25]
        )
        self.assertEqual(
            integration.innovus_eco_tcl([op]),
            "ecoAddRepeater -term U/A U/B -cell BUFX2 -name atcs_w01_r1_buf0 "
            "-newNetName atcs_w01_r1_net0 -loc {10.5 20.25}",
        )

    def test_multiple_ops_join_with_newline(self):
        tcl = integration.innovus_eco_tcl([size_op("U1", "A", "B"), delete_op("U2", "C")])
        self.assertEqual(tcl, "ecoChangeCell -inst {U1} -cell B\necoDeleteRepeater -inst {U2}")

    def test_pg_local_adjust_unsupported(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.innovus_eco_tcl([pg_op()])
        self.assertEqual(ctx.exception.code, "unsupported-op")


class ValidatePlanTests(unittest.TestCase):
    def test_valid_plan_is_stamped_and_invalid_count_is_zero(self):
        facts = stub_facts(order=["c1", "c2"])
        plan = make_plan("b1", select=["c1"])
        result = integration.validate_plan(plan, facts)
        self.assertEqual(result["schema"], "atcs.integration-plan/1")
        self.assertEqual(integration.plan_invalid_count(plan, facts), 0)

    def test_select_id_not_considered_is_invalid(self):
        facts = stub_facts(order=["c1", "c2"])
        plan = make_plan("b1", select=["c1", "unknown-id"])
        with self.assertRaises(core.AtcsError) as ctx:
            integration.validate_plan(plan, facts)
        self.assertEqual(ctx.exception.code, "invalid-plan")
        self.assertEqual(integration.plan_invalid_count(plan, facts), 1)

    def test_baseStateId_mismatch_is_invalid(self):
        facts = stub_facts(order=["c1"])
        plan = make_plan("b1", select=["c1"], base_state_id=OTHER_BASE_STATE_ID)
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)

    def test_missing_batch_id_is_invalid(self):
        facts = stub_facts(order=["c1"])
        plan = make_plan("", select=["c1"])
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)

    def test_missing_reason_is_invalid(self):
        facts = stub_facts(order=["c1"])
        plan = make_plan("b1", select=["c1"], reason="")
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)

    def test_deferred_id_not_considered_is_invalid(self):
        facts = stub_facts(order=["c1"])
        plan = make_plan("b1", select=[], deferred=["not-considered"])
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)

    def test_unknown_conflict_key_is_invalid(self):
        facts = stub_facts(order=["c1"])
        plan = make_plan("b1", select=["c1"], resolutions=[{"conflictKey": "nope", "decision": "drop:c1"}])
        with self.assertRaises(core.AtcsError) as ctx:
            integration.validate_plan(plan, facts)
        self.assertEqual(ctx.exception.code, "invalid-plan")

    def test_decision_target_not_a_member_of_named_conflict_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c3 = make_contribution("c3", operations=[size_op("U2", "A", "B")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c3], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1", select=["c1", "c2", "c3"], resolutions=[{"conflictKey": conflict["key"], "decision": "drop:c3"}]
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_contradictory_resolutions_for_same_target_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "keep:c1"},
                {"conflictKey": conflict["key"], "decision": "drop:c1"},
            ],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_two_different_keep_targets_for_same_conflict_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "keep:c1"},
                {"conflictKey": conflict["key"], "decision": "keep:c2"},
            ],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_complementary_revise_and_drop_for_same_conflict_is_valid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c1_revised = make_contribution("c1-rev", operations=[size_op("U2", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1_revised], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "revise:c1", "revisedContribution": "c1-rev"},
                {"conflictKey": conflict["key"], "decision": "drop:c2"},
            ],
        )
        integration.validate_plan(plan, facts)  # does not raise

    def test_revise_target_must_be_a_conflict_member(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c3 = make_contribution("c3", operations=[size_op("U2", "A", "B")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c3], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1",
            select=["c1", "c2", "c3"],
            resolutions=[{"conflictKey": conflict["key"], "decision": "revise:c3", "revisedContribution": "c1"}],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revised_contribution_not_considered_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "revise:c1", "revisedContribution": "not-considered"}
            ],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_plan_invalid_count_never_raises_on_unhashable_entries(self):
        facts = stub_facts(order=["c1"])
        plan = make_plan("b1", select=[["a", "list", "is", "unhashable"]], deferred=[{"also": "unhashable"}])
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)

    def test_contradictory_decisions_for_one_id_across_different_conflict_keys_is_invalid(self):
        # c1b conflicts with c2b (same-instance-different-master); c1b also shares a
        # load pin with c3b (same-load-pin) — two *different* conflictKeys, both
        # naming c1b, given contradictory decisions across them.
        c1b = make_contribution(
            "c1b", operations=[size_op("U1", "A", "B"), insert_op("N1", "buf1", "net1", "BUFX2", load_pins=["P1"])]
        )
        c2b = make_contribution("c2b", operations=[size_op("U1", "A", "C")])
        c3b = make_contribution("c3b", operations=[insert_op("N2", "buf3", "net3", "BUFX2", load_pins=["P1", "P2"])])
        facts = composition.analyze(BASE_STATE_ID, [c1b, c2b, c3b], [])
        master_conflict = find_conflict(facts, "same-instance-different-master")
        pin_conflict = find_conflict(facts, "same-load-pin")
        self.assertNotEqual(master_conflict["key"], pin_conflict["key"])

        plan = make_plan(
            "b1",
            select=["c1b", "c2b", "c3b"],
            resolutions=[
                {"conflictKey": master_conflict["key"], "decision": "keep:c1b"},
                {"conflictKey": pin_conflict["key"], "decision": "drop:c1b"},
            ],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revised_contribution_also_directly_selected_is_invalid(self):
        c1b = make_contribution("c1b", operations=[size_op("U1", "A", "B")])
        c2b = make_contribution("c2b", operations=[size_op("U1", "A", "C")])
        c1br = make_contribution("c1br", operations=[size_op("U2", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1b, c2b, c1br], [])
        conflict = find_conflict(facts, "same-instance-different-master")

        plan = make_plan(
            "b1",
            select=["c1b", "c1br"],  # c1br is BOTH directly selected AND the revise substitute
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "revise:c1b", "revisedContribution": "c1br"}
            ],
        )
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revised_contribution_also_deferred_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c1r = make_contribution("c1r", operations=[size_op("U2", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1r], [])
        conflict = find_conflict(facts, "same-instance-different-master")

        plan = make_plan(
            "b1",
            select=["c1"],
            deferred=["c1r"],
            resolutions=[{"conflictKey": conflict["key"], "decision": "revise:c1", "revisedContribution": "c1r"}],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revised_contribution_also_a_drop_target_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        # c1r has its own, separate conflict with c3 (on U2) — so "drop:c1r" is a
        # clean decision on its own conflict, isolating this test to exactly
        # "revisedContribution also a drop target" rather than also tripping the
        # separate "target must be a member of its named conflict" check.
        c1r = make_contribution("c1r", operations=[size_op("U2", "X", "Y")])
        c3 = make_contribution("c3", operations=[size_op("U2", "X", "Z")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1r, c3], [])
        conflicts = facts["conflicts"]
        conflict_a = next(c for c in conflicts if set(c["contributions"]) == {"c1", "c2"})
        conflict_b = next(c for c in conflicts if set(c["contributions"]) == {"c1r", "c3"})

        plan = make_plan(
            "b1",
            select=["c1", "c3"],
            resolutions=[
                {"conflictKey": conflict_a["key"], "decision": "revise:c1", "revisedContribution": "c1r"},
                {"conflictKey": conflict_b["key"], "decision": "drop:c1r"},
            ],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revised_contribution_targeted_by_two_different_revises_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c3 = make_contribution("c3", operations=[size_op("U2", "P", "Q")])
        c4 = make_contribution("c4", operations=[size_op("U2", "P", "R")])
        shared_revision = make_contribution("shared-rev", operations=[size_op("U3", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c3, c4, shared_revision], [])
        conflict_a = find_conflict(facts, "same-instance-different-master")
        conflicts = facts["conflicts"]
        conflict_b = next(c for c in conflicts if c["key"] != conflict_a["key"])

        plan = make_plan(
            "b1",
            select=["c1", "c3"],
            resolutions=[
                {"conflictKey": conflict_a["key"], "decision": "revise:c1", "revisedContribution": "shared-rev"},
                {"conflictKey": conflict_b["key"], "decision": "revise:c3", "revisedContribution": "shared-rev"},
            ],
        )
        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)


class PrepareReplayTests(unittest.TestCase):
    def test_steps_follow_facts_order_with_expected_step_ids(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[insert_op("N1", "buf0", "net0", "BUFX2")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        plan = make_plan("b1", select=["c2", "c1"])  # select order deliberately reversed vs. facts.order

        request = integration.prepare_replay(plan, facts, [c1, c2])

        self.assertEqual(request["schema"], "atcs.replay-request/1")
        self.assertEqual([step["contributionId"] for step in request["steps"]], facts["order"])
        expected_step_id_0 = core.digest({"contributionId": facts["order"][0], "opIndex": 0})
        self.assertEqual(request["steps"][0]["stepId"], expected_step_id_0)
        self.assertEqual(request["steps"][0]["opIndex"], 0)

    def test_plan_base_state_id_mismatch_raises_identity_mismatch(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        facts = composition.analyze(BASE_STATE_ID, [c1], [])
        plan = make_plan("b1", select=["c1"], base_state_id=OTHER_BASE_STATE_ID)

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1])
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_unresolved_conflict_raises_regardless_of_kind(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        find_conflict(facts, "same-instance-different-master")  # sanity: this kind is present
        plan = make_plan("b1", select=["c1", "c2"])  # no resolution at all

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual(ctx.exception.code, "unresolved-conflict")

    def test_keep_resolution_excludes_other_conflict_member_generic_over_kind(self):
        # same-load-pin (not same-instance-different-master) — proves keep/drop are
        # generic over conflict kind, per the coordinator's mid-task clarification.
        c1 = make_contribution("c1", operations=[insert_op("N1", "buf1", "net1", "BUFX2", load_pins=["P1"])])
        c2 = make_contribution("c2", operations=[insert_op("N2", "buf2", "net2", "BUFX2", load_pins=["P1", "P2"])])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = find_conflict(facts, "same-load-pin")
        plan = make_plan(
            "b1", select=["c1", "c2"], resolutions=[{"conflictKey": conflict["key"], "decision": "keep:c2"}]
        )

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual([step["contributionId"] for step in request["steps"]], ["c2"])

    def test_stale_base_without_revise_raises(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        stale = make_contribution("c2", base_state_id=OTHER_BASE_STATE_ID, operations=[size_op("U2", "A", "B")])
        facts = composition.analyze(BASE_STATE_ID, [c1, stale], [])
        self.assertIn("c2", facts["staleBase"])
        self.assertNotIn("c2", facts["considered"])

        # Bypasses validate_plan on purpose: this is prepare_replay's own defense.
        plan = make_plan("b1", select=["c2"])
        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1, stale])
        self.assertEqual(ctx.exception.code, "stale-base")

    def test_revise_substitutes_a_considered_contribution_for_a_conflict_member(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c1_revised = make_contribution("c1-rev", operations=[size_op("U2", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1_revised], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "revise:c1", "revisedContribution": "c1-rev"},
                {"conflictKey": conflict["key"], "decision": "drop:c2"},
            ],
        )

        request = integration.prepare_replay(plan, facts, [c1, c2, c1_revised])

        self.assertEqual(len(request["steps"]), 1)
        self.assertEqual(request["steps"][0]["contributionId"], "c1-rev")
        self.assertEqual(request["steps"][0]["op"], size_op("U2", "X", "Y"))

    def test_revise_does_not_hide_a_conflict_the_revised_contribution_is_in(self):
        # Critical fix: conflicts [c1, c2] (on X) and [c1r, c3] (on Y). Plan selects
        # [c1, c3] and revises c1 -> c1r, but never addresses the SECOND conflict at
        # all. Before the fix, `_check_no_unresolved_conflict` only ever looked at
        # the raw selected ids (c1, c3) — since "c1r" never appears in `plan.select`
        # itself, the [c1r, c3] conflict was invisible to it. After the fix, `select`
        # is mapped through `revise_map` before the check, so the effective set
        # {c1r, c3} correctly still trips this conflict.
        c1 = make_contribution("c1", operations=[size_op("X", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("X", "A", "C")])
        c1r = make_contribution("c1r", operations=[size_op("Y", "P", "Q")])
        c3 = make_contribution("c3", operations=[size_op("Y", "P", "R")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1r, c3], [])
        conflicts = facts["conflicts"]
        conflict_x = next(c for c in conflicts if set(c["contributions"]) == {"c1", "c2"})
        conflict_y = next(c for c in conflicts if set(c["contributions"]) == {"c1r", "c3"})
        self.assertNotEqual(conflict_x["key"], conflict_y["key"])

        plan = make_plan(
            "b1",
            select=["c1", "c3"],
            resolutions=[{"conflictKey": conflict_x["key"], "decision": "revise:c1", "revisedContribution": "c1r"}],
        )

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1, c2, c1r, c3])
        self.assertEqual(ctx.exception.code, "unresolved-conflict")

    def test_prepare_replay_refuses_duplicate_steps_as_its_own_defense(self):
        # `validate_plan` would reject this plan (the same revisedContribution
        # targeted by two different revises) — this test bypasses it on purpose to
        # exercise `prepare_replay`'s own redundant defense directly, the same way
        # `test_stale_base_without_revise_raises` bypasses it for that check.
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U2", "A", "B")])
        shared_revision = make_contribution("shared-rev", operations=[size_op("U3", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, shared_revision], [])
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": "irrelevant-1", "decision": "revise:c1", "revisedContribution": "shared-rev"},
                {"conflictKey": "irrelevant-2", "decision": "revise:c2", "revisedContribution": "shared-rev"},
            ],
        )

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1, c2, shared_revision])
        self.assertEqual(ctx.exception.code, "duplicate-step")

    def test_pg_local_adjust_selected_raises_unsupported_op(self):
        c1 = make_contribution("c1", operations=[pg_op()])
        facts = composition.analyze(BASE_STATE_ID, [c1], [])
        plan = make_plan("b1", select=["c1"])

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1])
        self.assertEqual(ctx.exception.code, "unsupported-op")

    def test_selecting_only_the_dropped_duplicate_still_replays_it_no_silent_empty_merge(self):
        shared_ops = [size_op("U1", "A", "B")]
        c1 = make_contribution("c1", operations=shared_ops)  # M4's lexicographic "keep"
        c2 = make_contribution("c2", operations=shared_ops)  # M4's "dropped" duplicate
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        duplicate_group = facts["duplicates"][0]
        self.assertEqual(duplicate_group["keep"], "c1")
        self.assertEqual(duplicate_group["dropped"], ["c2"])
        # This pair also always pairs with a conflict (shared-instance-edit, per M4's
        # docstring) — but c1 was never selected at all, so nothing is left to resolve.
        find_conflict(facts, "shared-instance-edit")

        plan = make_plan("b1", select=["c2"])  # only the "dropped" member is selected
        request = integration.prepare_replay(plan, facts, [c1, c2])

        self.assertEqual(len(request["steps"]), 1)
        self.assertEqual(request["steps"][0]["contributionId"], "c2")
        self.assertEqual(request["steps"][0]["op"], size_op("U1", "A", "B"))

    def test_selecting_only_the_keep_duplicate_replays_it(self):
        shared_ops = [size_op("U1", "A", "B")]
        c1 = make_contribution("c1", operations=shared_ops)
        c2 = make_contribution("c2", operations=shared_ops)
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])

        plan = make_plan("b1", select=["c1"])
        request = integration.prepare_replay(plan, facts, [c1, c2])

        self.assertEqual([step["contributionId"] for step in request["steps"]], ["c1"])

    def test_selected_fix_with_no_operations_raises_selected_without_steps(self):
        # Forced malformed input: kind claims "fix" but operations is empty, which a
        # real `contributions.seal` never produces — this is prepare_replay's own
        # defensive check against a silently empty merge from any other cause.
        broken = make_contribution("c1", operations=[], kind="fix")
        facts = composition.analyze(BASE_STATE_ID, [broken], [])
        plan = make_plan("b1", select=["c1"])

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [broken])
        self.assertEqual(ctx.exception.code, "selected-without-steps")

    def test_dropped_and_deferred_ids_recorded_for_seal_batch(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U2", "A", "B")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        plan = make_plan("b1", select=["c1"], deferred=["c2"])

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual(request["excludedFromCreditIds"], ["c2"])

    def test_keep_excluded_id_is_also_recorded_as_excluded_from_credit(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = find_conflict(facts, "same-instance-different-master")
        plan = make_plan(
            "b1", select=["c1", "c2"], resolutions=[{"conflictKey": conflict["key"], "decision": "keep:c1"}]
        )

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertIn("c2", request["excludedFromCreditIds"])


class PendingStepsTests(unittest.TestCase):
    def _request_with_steps(self, n):
        steps = [
            {"stepId": f"s{i}", "contributionId": "c1", "opIndex": i, "op": size_op(f"U{i}", "A", "B"), "xtopTcl": "x"}
            for i in range(n)
        ]
        return {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": steps, "expectedDelta": {}}

    def test_interrupted_replay_does_not_reinsert_completed_steps(self):
        request = self._request_with_steps(4)
        receipts = [
            {"stepId": "s0", "status": "ok", "observedDelta": {"mastersChanged": {"U0": ["A", "B"]}, "added": {}, "removed": {}}},
            {"stepId": "s1", "status": "ok", "observedDelta": {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}},
        ]
        self.assertEqual(integration.pending_steps(request, receipts), ["s2", "s3"])

    def test_error_receipt_is_not_pending_either(self):
        request = self._request_with_steps(2)
        receipts = [{"stepId": "s0", "status": "error", "observedDelta": {}}]
        self.assertEqual(integration.pending_steps(request, receipts), ["s1"])


class ReconcileTests(unittest.TestCase):
    def _request_with_one_step(self, op, contribution_id="c1"):
        step = {"stepId": "s0", "contributionId": contribution_id, "opIndex": 0, "op": op, "xtopTcl": "x"}
        return {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": [step], "expectedDelta": {}}

    def test_identical_duplicate_receipts_are_idempotent(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [
            {"stepId": "s0", "status": "ok", "observedDelta": good},
            {"stepId": "s0", "status": "ok", "observedDelta": good},
        ]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(list(state["applied"].keys()), ["s0"])
        self.assertEqual(state["failed"], [])
        self.assertEqual(state["pending"], [])
        self.assertEqual(state["replayMismatch"], [])

    def test_non_identical_duplicate_receipts_are_replay_mismatch(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [
            {"stepId": "s0", "status": "ok", "observedDelta": good},
            {"stepId": "s0", "status": "error", "observedDelta": {}},
        ]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(state["replayMismatch"], ["s0"])
        self.assertEqual(state["applied"], {})
        self.assertEqual(state["failed"], [])

    def test_receipt_for_unknown_step_id_is_listed_and_does_not_disturb_known_steps(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [
            {"stepId": "s0", "status": "ok", "observedDelta": good},
            {"stepId": "not-a-real-step", "status": "ok", "observedDelta": {}},
        ]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(state["unknownReceipts"], ["not-a-real-step"])
        self.assertEqual(list(state["applied"].keys()), ["s0"])

    def test_observed_delta_with_missing_keys_is_normalized_before_comparison(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": {"mastersChanged": {"U1": ["A", "B"]}}}]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(list(state["applied"].keys()), ["s0"])
        self.assertEqual(state["applied"]["s0"], {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}})

    def test_observed_delta_mismatch_is_replay_mismatch(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        wrong_delta = {"mastersChanged": {"U1": ["A", "WRONG"]}, "added": {}, "removed": {}}
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": wrong_delta}]

        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(state["replayMismatch"], ["s0"])
        self.assertEqual(state["applied"], {})

    def test_observed_instance_outside_domain_is_out_of_scope_without_mismatch(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": good}]

        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["SOME_OTHER"]}})
        self.assertEqual(state["outOfScope"], ["s0"])
        self.assertEqual(state["replayMismatch"], [])
        self.assertEqual(state["applied"], {})

    def test_observed_extra_instance_is_out_of_scope_and_mismatch(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        expected_plus_extra = {
            "mastersChanged": {"U1": ["A", "B"], "EXTRA": ["X", "Y"]},
            "added": {},
            "removed": {},
        }
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": expected_plus_extra}]

        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(state["outOfScope"], ["s0"])
        self.assertEqual(state["replayMismatch"], ["s0"])
        self.assertEqual(state["applied"], {})

    def test_whole_domain_grants_scope_beyond_targeted_instances(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        observed_with_extra_declared_instance = {
            "mastersChanged": {"U1": ["A", "B"], "U2": ["P", "Q"]},
            "added": {},
            "removed": {},
        }
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": observed_with_extra_declared_instance}]

        # U2 was never targeted by any op, but it IS part of c1's whole declared
        # editDomain.instances — item 3's fix: the scope union is the whole
        # declared domain of each replayed contribution, not only the instances
        # an op happened to name.
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1", "U2"]}})
        self.assertEqual(state["outOfScope"], [])
        # Still a replay mismatch (the op itself only declared U1) — the two
        # checks are independent, per the module docstring.
        self.assertEqual(state["replayMismatch"], ["s0"])

    def test_malformed_receipts_are_counted_in_unknown_receipts_without_raising(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [
            {"stepId": "s0", "status": "ok", "observedDelta": good},
            "not-a-dict",
            {"status": "ok", "observedDelta": {}},  # missing stepId
            {"stepId": 42, "status": "ok", "observedDelta": {}},  # non-string stepId
            {"stepId": ["unhashable"], "status": "ok", "observedDelta": {}},  # unhashable stepId
        ]

        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})

        self.assertEqual(list(state["applied"].keys()), ["s0"])
        self.assertEqual(len(state["unknownReceipts"]), 4)

    def test_insert_buffer_new_instance_in_scope_by_its_net(self):
        op = insert_op("N1", "buf0", "net0", "BUFX2")
        request = self._request_with_one_step(op)
        good = {"mastersChanged": {}, "added": {"buf0": "BUFX2"}, "removed": {}}
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": good}]

        # "buf0" is not itself in domain.instances (it does not pre-exist) — it is
        # in scope because its net N1 is a member of domain.nets (M3's rule).
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": [], "nets": ["N1"]}})
        self.assertEqual(list(state["applied"].keys()), ["s0"])
        self.assertEqual(state["outOfScope"], [])

    def test_missing_receipt_is_pending(self):
        request = self._request_with_one_step(size_op("U1", "A", "B"))
        state = integration.reconcile(request, [], edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(state["pending"], ["s0"])

    def test_error_status_is_failed(self):
        request = self._request_with_one_step(size_op("U1", "A", "B"))
        receipts = [{"stepId": "s0", "status": "error", "observedDelta": {}}]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})
        self.assertEqual(state["failed"], ["s0"])


class SealBatchTests(unittest.TestCase):
    def test_refuses_with_pending(self):
        state = {"batchId": "b1", "pending": ["s0"], "failed": [], "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "applied": {}}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": []}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, facts, [])
        self.assertEqual(ctx.exception.code, "integration-incomplete")

    def test_refuses_with_failed(self):
        state = {"batchId": "b1", "pending": [], "failed": ["s0"], "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "applied": {}}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": []}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError):
            integration.seal_batch(state, request, facts, [])

    def test_refuses_with_replay_mismatch(self):
        state = {"batchId": "b1", "pending": [], "failed": [], "replayMismatch": ["s0"], "outOfScope": [], "unknownReceipts": [], "applied": {}}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": []}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError):
            integration.seal_batch(state, request, facts, [])

    def test_refuses_with_unknown_receipts(self):
        state = {"batchId": "b1", "pending": [], "failed": [], "replayMismatch": [], "outOfScope": [], "unknownReceipts": ["ghost"], "applied": {}}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": []}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, facts, [])
        self.assertEqual(ctx.exception.code, "integration-incomplete")

    def test_refuses_on_batch_id_mismatch(self):
        state = {"batchId": "other", "pending": [], "failed": [], "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "applied": {}}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": []}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, facts, [])
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_refuses_on_base_state_id_mismatch(self):
        state = {"batchId": "b1", "pending": [], "failed": [], "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "applied": {}}
        request = {"batchId": "b1", "baseStateId": OTHER_BASE_STATE_ID, "steps": []}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, facts, [])
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_refuses_when_applied_keys_do_not_match_request_steps(self):
        step = {"stepId": "s0", "contributionId": "c1", "opIndex": 0, "op": size_op("U1", "A", "B"), "xtopTcl": "x"}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": [step]}
        # No pending/failed/etc. flagged, yet `applied` disagrees with the request's
        # own steps — an internal bookkeeping inconsistency seal_batch must still catch.
        state = {"batchId": "b1", "pending": [], "failed": [], "replayMismatch": [], "outOfScope": [], "unknownReceipts": [], "applied": {}}
        facts = {"baseStateId": BASE_STATE_ID, "duplicates": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, facts, [])
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_source_map_credits_all_duplicate_sources_but_contributions_excludes_deferred(self):
        shared_ops = [size_op("U1", "A", "B")]
        c1 = make_contribution("c1", revision=1, operations=shared_ops)
        c2 = make_contribution("c2", revision=2, operations=shared_ops)
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        plan = make_plan("b1", select=["c1"], deferred=["c2"])

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual(request["excludedFromCreditIds"], ["c2"])

        op = shared_ops[0]
        receipt_delta = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [{"stepId": request["steps"][0]["stepId"], "status": "ok", "observedDelta": receipt_delta}]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})

        merge_commit = integration.seal_batch(state, request, facts, [c1, c2])

        op_key = core.digest({"op": op})
        self.assertEqual(merge_commit["sourceMap"][op_key], ["c1", "c2"])  # both sources credited in sourceMap
        self.assertEqual(merge_commit["contributions"], [{"id": "c1", "revision": 1}])  # c2 excluded (deferred)

    def test_keep_excluded_duplicate_source_is_not_credited_either(self):
        # Item 2: a duplicate member excluded via a `keep` decision (rather than
        # `drop`/`deferred`) must be treated the same way for credit purposes —
        # sourceMap still widens to the whole group (historical fact), but
        # `contributions[]` excludes the keep-losing id.
        shared_ops = [size_op("U1", "A", "B")]
        c1 = make_contribution("c1", revision=1, operations=shared_ops)
        c2 = make_contribution("c2", revision=2, operations=shared_ops)
        facts = composition.analyze(BASE_STATE_ID, [c1, c2], [])
        conflict = find_conflict(facts, "shared-instance-edit")
        plan = make_plan(
            "b1", select=["c1", "c2"], resolutions=[{"conflictKey": conflict["key"], "decision": "keep:c1"}]
        )

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertIn("c2", request["excludedFromCreditIds"])
        self.assertEqual([step["contributionId"] for step in request["steps"]], ["c1"])

        op = shared_ops[0]
        receipt_delta = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [{"stepId": request["steps"][0]["stepId"], "status": "ok", "observedDelta": receipt_delta}]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})

        merge_commit = integration.seal_batch(state, request, facts, [c1, c2])

        op_key = core.digest({"op": op})
        self.assertEqual(merge_commit["sourceMap"][op_key], ["c1", "c2"])
        self.assertEqual(merge_commit["contributions"], [{"id": "c1", "revision": 1}])

    def test_buffer_insertion_names_and_lists_new_nets(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2")
        c1 = make_contribution("c1", operations=[op])
        facts = composition.analyze(BASE_STATE_ID, [c1], [])
        plan = make_plan("b1", select=["c1"])
        request = integration.prepare_replay(plan, facts, [c1])

        receipt_delta = {"mastersChanged": {}, "added": {"atcs_w01_r1_buf0": "BUFX2"}, "removed": {}}
        receipts = [{"stepId": request["steps"][0]["stepId"], "status": "ok", "observedDelta": receipt_delta}]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": [], "nets": ["N1"]}})

        merge_commit = integration.seal_batch(state, request, facts, [c1])

        self.assertEqual(merge_commit["newNets"], ["atcs_w01_r1_net0"])
        self.assertIn("-name atcs_w01_r1_buf0", merge_commit["innovusEcoTcl"])
        self.assertIn("-newNetName atcs_w01_r1_net0", merge_commit["innovusEcoTcl"])

    def test_same_inputs_produce_the_same_merge_commit_id(self):
        op = size_op("U1", "A", "B")
        c1 = make_contribution("c1", operations=[op])
        facts = composition.analyze(BASE_STATE_ID, [c1], [])
        plan = make_plan("b1", select=["c1"])
        request = integration.prepare_replay(plan, facts, [c1])
        receipt_delta = {"mastersChanged": {"U1": ["A", "B"]}, "added": {}, "removed": {}}
        receipts = [{"stepId": request["steps"][0]["stepId"], "status": "ok", "observedDelta": receipt_delta}]
        state = integration.reconcile(request, receipts, edit_domains={"c1": {"instances": ["U1"]}})

        first = integration.seal_batch(state, request, facts, [c1])
        second = integration.seal_batch(state, request, facts, [c1])
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["schema"], "atcs.merge-commit/1")


if __name__ == "__main__":
    unittest.main()
