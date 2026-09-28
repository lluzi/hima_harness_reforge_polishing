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
        self.assertEqual(integration.xtop_tcl(size_op("U1", "INVX1", "INVX4")), "size_cell {U1} {INVX4}")

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

    def test_bus_bit_instance_name_is_brace_quoted_not_refused(self):
        """I7 (final review): a real bus-bit signal/instance name (`bus[3]`) used to be
        refused outright by `_validate_tcl_value`; it is now admitted and rendered
        inside a literal Tcl brace group, where `[`/`]` are inert."""
        self.assertEqual(
            integration.xtop_tcl(size_op("bus[3]", "INVX1", "INVX4")), "size_cell {bus[3]} {INVX4}"
        )

    def test_bus_bit_load_pin_and_master_are_brace_quoted(self):
        op = insert_op("N1", "buf0", "net0", "BUFX2", load_pins=["U/A[2]", "U/B[15]"])
        self.assertEqual(
            integration.xtop_tcl(op),
            "insert_buffer {U/A[2] U/B[15]} {BUFX2} -new_cell_names {buf0} -new_net_names {net0}",
        )

    def test_control_character_in_instance_name_still_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1\x01", "INVX1", "INVX4"))
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
            integration.innovus_eco_tcl([size_op("U1", "INVX1", "INVX4")]), "ecoChangeCell -inst {U1} -cell {INVX4}"
        )

    def test_delete_buffer_uses_eco_delete_repeater(self):
        self.assertEqual(integration.innovus_eco_tcl([delete_op("U9", "BUFX2")]), "ecoDeleteRepeater -inst {U9}")

    def test_buffer_insertion_uses_term_cell_name_newnetname(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", load_pins=["U/A"])
        self.assertEqual(
            integration.innovus_eco_tcl([op]),
            "ecoAddRepeater -term {U/A} -cell {BUFX2} -name {atcs_w01_r1_buf0} -newNetName {atcs_w01_r1_net0}",
        )

    def test_buffer_insertion_with_multiple_pins_and_location(self):
        op = insert_op(
            "N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", load_pins=["U/A", "U/B"], location=[10.5, 20.25]
        )
        self.assertEqual(
            integration.innovus_eco_tcl([op]),
            "ecoAddRepeater -term {U/A} {U/B} -cell {BUFX2} -name {atcs_w01_r1_buf0} "
            "-newNetName {atcs_w01_r1_net0} -loc {10.5 20.25}",
        )

    def test_multiple_ops_join_with_newline(self):
        tcl = integration.innovus_eco_tcl([size_op("U1", "A", "B"), delete_op("U2", "C")])
        self.assertEqual(tcl, "ecoChangeCell -inst {U1} -cell {B}\necoDeleteRepeater -inst {U2}")

    def test_pg_local_adjust_unsupported(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.innovus_eco_tcl([pg_op()])
        self.assertEqual(ctx.exception.code, "unsupported-op")

    def test_bus_bit_pin_name_is_brace_quoted_not_refused(self):
        """I7 (final review): the old code embedded load pins bare, space-joined, with
        no brace quoting at all (`-term U/A U/B`) -- a real bus-bit pin name would
        either be refused outright (old `_validate_tcl_value`) or, had the refusal
        merely been dropped, would have let Tcl attempt command substitution on the
        `[...]` when this generated line is later sourced by Innovus. Each pin is now
        its own brace group."""
        op = insert_op("N1", "buf0", "net0", "BUFX2", load_pins=["U/A[2]", "U/B[15]"])
        self.assertEqual(
            integration.innovus_eco_tcl([op]),
            "ecoAddRepeater -term {U/A[2]} {U/B[15]} -cell {BUFX2} -name {buf0} -newNetName {net0}",
        )

    def test_bus_bit_master_name_is_brace_quoted(self):
        self.assertEqual(
            integration.innovus_eco_tcl([size_op("bus[3]", "INVX1", "INVX4")]),
            "ecoChangeCell -inst {bus[3]} -cell {INVX4}",
        )

    def test_control_character_in_instance_name_still_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.innovus_eco_tcl([size_op("U1\x01", "INVX1", "INVX4")])
        self.assertEqual(ctx.exception.code, "unsafe-name")


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

    def test_one_target_with_two_distinct_revised_contributions_is_invalid(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        c1r_a = make_contribution("c1r-a", operations=[size_op("U2", "X", "Y")])
        c1r_b = make_contribution("c1r-b", operations=[size_op("U3", "X", "Y")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1r_a, c1r_b], [])
        conflict = find_conflict(facts, "same-instance-different-master")

        # Two resolutions both say "revise:c1", but disagree on which considered
        # contribution actually replaces it — unresolvable, since only one of
        # them could ever actually replay in c1's slot.
        plan = make_plan(
            "b1",
            select=["c1", "c2"],
            resolutions=[
                {"conflictKey": conflict["key"], "decision": "revise:c1", "revisedContribution": "c1r-a"},
                {"conflictKey": conflict["key"], "decision": "revise:c1", "revisedContribution": "c1r-b"},
            ],
        )

        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_validate_plan_also_catches_a_conflict_left_unresolved_after_substitution(self):
        # Same scenario `prepare_replay`'s
        # test_revise_does_not_hide_a_conflict_the_revised_contribution_is_in
        # exercises — this time checked at `validate_plan`/`plan_invalid_count`
        # time, via the SAME shared helper `prepare_replay` itself calls (no
        # duplicated logic), so a plan `prepare_replay` would refuse is already
        # counted invalid before it ever gets that far.
        c1 = make_contribution("c1", operations=[size_op("X", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("X", "A", "C")])
        c1r = make_contribution("c1r", operations=[size_op("Y", "P", "Q")])
        c3 = make_contribution("c3", operations=[size_op("Y", "P", "R")])
        facts = composition.analyze(BASE_STATE_ID, [c1, c2, c1r, c3], [])
        conflicts = facts["conflicts"]
        conflict_x = next(c for c in conflicts if set(c["contributions"]) == {"c1", "c2"})
        conflict_y = next(c for c in conflicts if set(c["contributions"]) == {"c1r", "c3"})

        plan = make_plan(
            "b1",
            select=["c1", "c3"],
            resolutions=[{"conflictKey": conflict_x["key"], "decision": "revise:c1", "revisedContribution": "c1r"}],
        )

        self.assertGreaterEqual(integration.plan_invalid_count(plan, facts), 1)
        with self.assertRaises(core.AtcsError) as ctx:
            integration.validate_plan(plan, facts)
        self.assertIn(conflict_y["key"], str(ctx.exception))


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
        self.assertIn("-name {atcs_w01_r1_buf0}", merge_commit["innovusEcoTcl"])
        self.assertIn("-newNetName {atcs_w01_r1_net0}", merge_commit["innovusEcoTcl"])

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


# ---------------------------------------------------------------------------
# Issue #64 Task 6: the generation's one replay -- the ranked expert recipe
# through the toolkit procs, protection, auto-finish, one Innovus ECO pair, and
# a plain auto-fix control arm so the refreshed batch is never worse than it.
# ---------------------------------------------------------------------------

PLAN_SHA = "a" * 64
PLAN_SHA_2 = "b" * 64

# Real XTop 2025.09 output (SWERV28, old serial flow run xtop-timing-closure-20260922-090023-5357,
# g002/XTOP/report; notes/real-summarize-sample.txt). pre_opt: `summarize_gba_violations -exclude_path
# -as_reference -setup|-hold`; post_opt: `... -exclude_path -with_reference -with_delta -setup|-hold`.
REAL_PRE_OPT = """### setup summary ###
Scenario                  Count      Worst        TNS
------------------------------------------------------
total                        12    -0.0387    -0.1160
  func_ffg_cbest_125          0     0.0000     0.0000
  func_ffg_cbest_m40          0     0.0000     0.0000
  func_ssg_rcworst_125        0     0.0000     0.0000
  func_ssg_rcworst_m40       12    -0.0387    -0.1160
### hold summary ###
Scenario                  Count      Worst        TNS
------------------------------------------------------
total                        70    -0.1542    -3.9661
  func_ffg_cbest_125         44    -0.0764    -0.7568
  func_ffg_cbest_m40         55    -0.0704    -0.7199
  func_ssg_rcworst_125       49    -0.1398    -2.9593
  func_ssg_rcworst_m40       48    -0.1542    -3.8962
"""
REAL_POST_OPT = """### design: swerv_wrapper ###
Name                      Count     D_Area     Density    D_Density
--------------------------------------------------------------------
total                         -    +2.8980    73.0145%     +0.0007%
  inserted                    4    +2.8980           -     +0.0007%
    DEL025D1BWP30P140         3    +1.1340           -     +0.0003%
    DEL100MD1BWP30P140        1    +1.7640           -     +0.0004%
  sized                       0    +0.0000           -     +0.0000%
  removed                     0    +0.0000           -     +0.0000%
  moved                       0    +0.0000           -     +0.0000%
### setup summary ###
Scenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS
---------------------------------------------------------------------------------------------------------------------------------
total                        12        12         +0    |    -0.0387    -0.0387    +0.0000    |    -0.1160    -0.1160    +0.0000
  func_ffg_cbest_125          0         0         +0    |     0.0000     0.0000    +0.0000    |     0.0000     0.0000    +0.0000
  func_ffg_cbest_m40          0         0         +0    |     0.0000     0.0000    +0.0000    |     0.0000     0.0000    +0.0000
  func_ssg_rcworst_125        0         0         +0    |     0.0000     0.0000    +0.0000    |     0.0000     0.0000    +0.0000
  func_ssg_rcworst_m40       12        12         +0    |    -0.0387    -0.0387    +0.0000    |    -0.1160    -0.1160    +0.0000
### hold summary ###
Scenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS
---------------------------------------------------------------------------------------------------------------------------------
total                        66        70         -4    |    -0.1542    -0.1542    +0.0000    |    -3.7707    -3.9661    +0.1954
  func_ffg_cbest_125         42        44         -2    |    -0.0764    -0.0764    +0.0000    |    -0.6846    -0.7568    +0.0722
  func_ffg_cbest_m40         52        55         -3    |    -0.0704    -0.0704    +0.0000    |    -0.6551    -0.7199    +0.0649
  func_ssg_rcworst_125       46        49         -3    |    -0.1398    -0.1398    +0.0000    |    -2.7901    -2.9593    +0.1692
  func_ssg_rcworst_m40       46        48         -2    |    -0.1542    -0.1542    +0.0000    |    -3.7009    -3.8962    +0.1953
"""
REAL_SCENARIOS = ["func_ffg_cbest_125", "func_ffg_cbest_m40", "func_ssg_rcworst_125", "func_ssg_rcworst_m40"]


def gba_summary(check, rows):
    """An XTop `summarize_gba_violations -exclude_path` table (format read from a real
    SWERV28 session transcript, docs/assessment/2026-09-25/next-stage/wave1-operator-
    delegation/evidence.json). `rows` is `{scenario: (count, worst, tns)}`."""
    worst_total = min(row[1] for row in rows.values())
    tns_total = sum(row[2] for row in rows.values())
    count_total = sum(row[0] for row in rows.values())
    lines = [f"### {check} summary ###", "Scenario                  Count      Worst        TNS",
             "-" * 54, f"total                 {count_total:>10} {worst_total:>10.4f} {tns_total:>10.4f}"]
    for name, (count, worst, tns) in rows.items():
        lines.append(f"  {name:<24}{count:>6} {worst:>10.4f} {tns:>10.4f}")
    return "\n".join(lines) + "\n"


def recipe_command(seq, proc, args, instances, skip=None):
    """One `composition-facts.recipe.sessions[].commands[]` entry (Task 4b, notes/t4b-recipe.md)."""
    return {"seq": seq, "proc": proc, "cmd": proc[len("atcs_"):], "args": args, "instances": list(instances),
            "skip": skip}


def recipe_session(rank, contribution, task_id, commands):
    return {"rank": rank, "contribution": contribution, "taskId": task_id, "blockerCoverage": 1,
            "coveredChecks": [], "value": 0.01, "tnsGain": 0.02, "commands": commands,
            "executedCount": sum(1 for c in commands if c["skip"] is None),
            "skipCount": sum(1 for c in commands if c["skip"] is not None)}


def size_args(instance, to_master, plan=PLAN_SHA):
    return {"instance": instance, "toMaster": to_master, "planSha256": plan}


def hold_args(pins, plan=PLAN_SHA):
    return {"pins": list(pins), "effort": "low", "holdTarget": 0.0, "setupMargin": 0.02, "sizeCellOnly": False,
            "useDummyCell": True, "fixTimingWindow": True, "maxClusterLoaderCount": 4, "maxDelayCellLength": -1,
            "delayCellList": [], "planSha256": plan}


def insert_args(net, loads, masters, new_instances, new_nets, plan=PLAN_SHA_2):
    return {"net": net, "loadPins": list(loads), "masters": list(masters), "newInstances": list(new_instances),
            "newNets": list(new_nets), "planSha256": plan}


def recipe_sessions():
    return {
        "w01": {
            "contributionId": "c1", "revision": 1, "namePrefix": "atcs_w01_r1_",
            "editDomain": {"instances": ["U1", "U2"], "nets": ["N1"], "regions": [[0, 0, 10, 10]]},
            "targetPins": ["U9/D"],
            "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}},
        },
        "w02": {
            "contributionId": "c2", "revision": 3, "namePrefix": "atcs_w02_r1_",
            "editDomain": {"instances": ["U3"], "nets": ["N3"], "regions": []},
            "targetPins": [],
            "delta": {"mastersChanged": {}, "added": {"atcs_w02_r1_b1": "BUFX2"}, "removed": {}},
        },
    }


def recipe_plan(batch_id="b1", base_state_id=BASE_STATE_ID, **extra):
    plan = {"batchId": batch_id, "baseStateId": base_state_id, "reason": "blockers first, then auto-finish"}
    plan.update(extra)
    return plan


def default_recipe():
    return {
        "rankedBy": ["blockerCoverage desc", "value desc", "tnsGain desc", "id asc"], "worstChecks": [],
        "commandCount": 4, "skipCount": 1,
        "sessions": [
            recipe_session(1, "c1", "w01", [
                recipe_command(1, "atcs_size_cell", size_args("U1", "BUFX2"), ["U1"]),
                recipe_command(3, "atcs_fix_hold_pins", hold_args(["U9/D"]), ["U2"]),
            ]),
            recipe_session(2, "c2", "w02", [
                recipe_command(2, "atcs_insert_buffer",
                               insert_args("N3", ["U3/A"], ["BUFX2"], ["atcs_w02_r1_b1"], ["atcs_w02_r1_n1"]),
                               ["atcs_w02_r1_b1"]),
                recipe_command(5, "atcs_size_cell", size_args("U1", "BUFX4", PLAN_SHA_2), ["U1"],
                               skip="shared-instance"),
            ]),
        ],
        "excluded": [{"contribution": "c9", "taskId": "w03", "codes": ["tainted"]}],
    }


def prepare_default(**plan_extra):
    return integration.prepare_recipe_replay(
        recipe_plan(**plan_extra), BASE_STATE_ID, default_recipe(), recipe_sessions(),
        required_scenarios=["s1", "s2"], removable_fillers=["FILL*"],
    )


class PrepareRecipeReplayTests(unittest.TestCase):
    def test_request_groups_sessions_in_rank_order_with_one_dump_each(self):
        request = prepare_default()
        self.assertEqual(request["excluded"], [{"contribution": "c9", "taskId": "w03", "codes": ["tainted"]}])
        self.assertEqual([step["seq"] for step in request["steps"]], [1, 3, 2, 5])
        self.assertEqual(request["schema"], "atcs.replay-request/1")
        self.assertEqual(request["mode"], "recipe")
        self.assertEqual(request["batchId"], "b1")
        self.assertEqual(request["baseStateId"], BASE_STATE_ID)
        self.assertEqual([(s["slot"], s["dumpIndex"], s["contributionId"]) for s in request["sessions"]],
                         [("w01", 1, "c1"), ("w02", 2, "c2")])
        self.assertEqual([step["slot"] for step in request["steps"]], ["w01", "w01", "w02", "w02"])
        self.assertEqual(len({step["stepId"] for step in request["steps"]}), 4)

    def test_kept_commands_render_as_the_same_toolkit_procedure_calls(self):
        steps = prepare_default()["steps"]
        self.assertEqual(steps[0]["tcl"], "atcs_size_cell {U1} {BUFX2} {" + PLAN_SHA + "}")
        self.assertEqual(
            steps[1]["tcl"],
            "atcs_fix_hold_pins {{U9/D}} {low} 0.0 0.02 0 1 1 4 -1 {} {" + PLAN_SHA + "}",
        )
        self.assertEqual(
            steps[2]["tcl"],
            "atcs_insert_buffer {N3} {{U3/A}} {{BUFX2}} {{atcs_w02_r1_b1}} {{atcs_w02_r1_n1}} {" + PLAN_SHA_2 + "}",
        )

    def test_a_skip_entry_is_listed_with_its_reason_and_never_rendered(self):
        steps = prepare_default()["steps"]
        self.assertEqual(steps[3]["skip"], "shared-instance")
        self.assertIsNone(steps[3]["tcl"])
        self.assertIsNone(steps[0]["skip"])

    def test_an_unrenderable_entry_is_skipped_not_a_batch_refusal(self):
        recipe = default_recipe()
        commands = recipe["sessions"][1]["commands"]
        commands.append(recipe_command(6, "atcs_undo", {"planSha256": PLAN_SHA_2}, []))
        commands.append(recipe_command(7, "atcs_size_cell", {"instance": "U3", "planSha256": PLAN_SHA_2}, ["U3"]))
        commands.append(recipe_command(8, "atcs_size_cell", size_args("U3}; exit {", "BUFX2", PLAN_SHA_2), ["U3"]))
        request = integration.prepare_recipe_replay(recipe_plan(), BASE_STATE_ID, recipe, recipe_sessions())
        tail = request["steps"][4:]
        self.assertEqual(len(tail), 3)
        for step in tail:
            self.assertTrue(step["skip"].startswith("invalid-entry:"), step)
            self.assertIsNone(step["tcl"])

    def test_plan_select_filters_the_recipe_and_records_unselected_sessions(self):
        request = prepare_default(select=["c1"])
        self.assertEqual([s["slot"] for s in request["sessions"]], ["w01"])
        self.assertEqual({step["slot"] for step in request["steps"]}, {"w01"})
        self.assertIn({"contribution": "c2", "taskId": "w02", "codes": ["not-selected"]}, request["excluded"])
        self.assertEqual(request["sessions"][0]["dumpIndex"], 1)

    def test_a_plan_without_select_replays_every_ranked_session(self):
        self.assertEqual(len(prepare_default()["sessions"]), 2)

    def test_merged_auto_finish_is_the_control_arms_exact_qualified_sequence(self):
        """The two arms differ only by the expert recipe: merged auto-finish includes the
        qualified hold size-only line (`-size_cell_only -size_rule nominal_keywords`)."""
        request = prepare_default(setupMargin=0.03, holdMargin=0.01)
        self.assertTrue(request["autoFinish"])
        self.assertEqual(request["autoFinishTcl"], [
            "fix_setup_gba_violations -methods size_cell -effort high -setup_target 0.0 -hold_margin 0.01",
            "fix_setup_gba_violations -methods insert_buffer -effort high -setup_target 0.0 -hold_margin 0.01",
            "fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0.0 -setup_margin 0.03",
            "fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin 0.03",
        ])
        self.assertEqual(request["autoFinishTcl"], request["controlTcl"])

    def test_control_arm_is_the_old_flows_qualified_plain_auto_fix(self):
        request = prepare_default(setupMargin=0.03, holdMargin=0.01)
        self.assertEqual(request["controlTcl"], [
            "fix_setup_gba_violations -methods size_cell -effort high -setup_target 0.0 -hold_margin 0.01",
            "fix_setup_gba_violations -methods insert_buffer -effort high -setup_target 0.0 -hold_margin 0.01",
            "fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0.0 -setup_margin 0.03",
            "fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin 0.03",
        ])

    def test_auto_finish_off_leaves_the_merged_arm_expert_only_but_control_unchanged(self):
        request = prepare_default(autoFinish=False)
        self.assertFalse(request["autoFinish"])
        self.assertEqual(request["autoFinishTcl"], [])
        self.assertEqual(len(request["controlTcl"]), 4)

    def test_margins_outside_the_bounded_range_are_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            prepare_default(setupMargin=0.5)
        self.assertEqual(ctx.exception.code, "invalid-recipe")

    def test_each_session_keeps_its_own_edit_domain(self):
        sessions = prepare_default()["sessions"]
        self.assertEqual(sessions[0]["domain"], {"instances": ["U1", "U2"], "nets": ["N1"], "pins": ["U9/D"],
                                                 "regions": [[0, 0, 10, 10]]})
        self.assertEqual(sessions[1]["domain"], {"instances": ["U3"], "nets": ["N3"], "pins": [], "regions": []})
        self.assertNotIn("domain", prepare_default())

    def test_an_inverted_session_region_is_refused(self):
        """The one region rule of work packages and Operator sessions: x1<=x2 and y1<=y2."""
        sessions = recipe_sessions()
        sessions["w01"]["editDomain"]["regions"] = [[10, 0, 0, 10]]
        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_recipe_replay(recipe_plan(), BASE_STATE_ID, default_recipe(), sessions)
        self.assertEqual(ctx.exception.code, "invalid-recipe")

    def test_a_slot_ranked_twice_is_refused(self):
        recipe = default_recipe()
        recipe["sessions"].append(recipe_session(3, "c1", "w01", [
            recipe_command(9, "atcs_size_cell", size_args("U2", "INVX2"), ["U2"])]))
        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_recipe_replay(recipe_plan(), BASE_STATE_ID, recipe, recipe_sessions())
        self.assertEqual(ctx.exception.code, "invalid-recipe")

    def test_a_slot_without_session_identity_is_refused(self):
        sessions = recipe_sessions()
        del sessions["w02"]
        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_recipe_replay(recipe_plan(), BASE_STATE_ID, default_recipe(), sessions)
        self.assertEqual(ctx.exception.code, "invalid-recipe")

    def test_an_entry_naming_another_contribution_is_refused(self):
        recipe = default_recipe()
        recipe["sessions"][0]["contribution"] = "c9"
        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_recipe_replay(recipe_plan(), BASE_STATE_ID, recipe, recipe_sessions())
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_plan_base_state_mismatch_is_identity_mismatch(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_recipe_replay(recipe_plan(base_state_id=OTHER_BASE_STATE_ID), BASE_STATE_ID,
                                              default_recipe(), recipe_sessions())
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_a_real_task_4b_recipe_replays_as_sealed(self):
        """Sessions sealed by `contributions.seal_session` and ranked by `composition.analyze`
        (Task 4b, merged) feed the replay request unchanged: args as the toolkit logged them."""
        sys.path.insert(0, str(TESTS_DIR))
        from test_composition import _hold_gain, _session
        import session_fixtures as sf
        high = _session("w01", [("U1", "BUFX2"), ("U2", "BUFX2")], _hold_gain(0.030))
        low = _session("w02", [("U3", "INVX2"), ("U1", "BUFX4")], _hold_gain(0.010))
        facts = composition.analyze(sf.BASE_STATE_ID, [low, high], [])
        sessions = {}
        for contribution in (high, low):
            base_ref = sf.make_base_ref(slot=contribution["taskId"], instances=("U1", "U2", "U3", "U4"))
            sessions[contribution["taskId"]] = {
                "contributionId": contribution["id"], "revision": contribution["revision"],
                "namePrefix": base_ref["workspaceManifest"]["namePrefix"],
                "editDomain": base_ref["workPackage"]["editDomain"],
                "targetPins": base_ref["workPackage"]["targetPins"], "delta": contribution["delta"],
            }
        request = integration.prepare_recipe_replay(
            {"batchId": "g1", "baseStateId": sf.BASE_STATE_ID, "reason": "ranked"}, sf.BASE_STATE_ID,
            facts["recipe"], sessions)
        self.assertEqual([(s["slot"], s["contributionId"]) for s in request["sessions"]],
                         [("w01", high["id"]), ("w02", low["id"])])
        self.assertEqual([step["tcl"] for step in request["steps"]], [
            f"atcs_size_cell {{U1}} {{BUFX2}} {{{sf.PLAN}}}", f"atcs_size_cell {{U2}} {{BUFX2}} {{{sf.PLAN}}}",
            f"atcs_size_cell {{U3}} {{INVX2}} {{{sf.PLAN}}}", None,
        ])
        self.assertEqual(request["steps"][3]["skip"], "shared-instance")
        self.assertEqual(request["sessions"][0]["namePrefix"], "atcs_w01_r1_")

    def test_recipe_procedures_match_the_contract_argument_order(self):
        text = (FLOW_DIR.parent / "contract.yml").read_text(encoding="utf-8")
        for proc, names in integration.RECIPE_PROCS.items():
            line = next(item for item in text.splitlines() if item.strip().startswith(f"{proc}: ["))
            import re
            self.assertEqual(tuple(re.findall(r"\{ name: (\w+),", line)), names, proc)
        self.assertNotIn("atcs_undo", integration.RECIPE_PROCS)


def real_sections(text):
    """`{setup, hold}` texts of one real XTop summary report, as each arm's predict/*.rpt holds them."""
    setup_at, hold_at = text.index("### setup summary ###"), text.index("### hold summary ###")
    return {"setup": text[setup_at:hold_at], "hold": text[hold_at:]}


class PredictionReadsRealSummariesTests(unittest.TestCase):
    """Each arm's prediction reads its `summarize_gba_violations -exclude_path` reports through the
    one shared parser (`contributions.parse_gain_summary`), pinned to real XTop output."""

    def _prediction(self, predict_text):
        request = integration.prepare_recipe_replay(
            recipe_plan(), BASE_STATE_ID, default_recipe(), recipe_sessions(), required_scenarios=REAL_SCENARIOS)
        _, state = reconcile_default(merged_kw={"predict_text": predict_text}, request=request)
        return state["arms"]["merged"]["prediction"]

    def test_reads_the_real_plain_layout_per_scenario(self):
        prediction = self._prediction(real_sections(REAL_PRE_OPT))
        self.assertEqual(prediction["setup"]["func_ssg_rcworst_m40"], {"count": 12, "worst": -0.0387, "tns": -0.116})
        self.assertEqual(prediction["setup"]["func_ffg_cbest_125"], {"count": 0, "worst": 0.0, "tns": 0.0})
        self.assertEqual(sorted(prediction["hold"]), REAL_SCENARIOS)
        self.assertEqual(prediction["hold"]["func_ffg_cbest_m40"], {"count": 55, "worst": -0.0704, "tns": -0.7199})
        self.assertEqual((prediction["worstSetupWns"], prediction["worstHoldWns"]), (-0.0387, -0.1542))

    def test_reads_the_current_columns_of_the_real_delta_layout(self):
        prediction = self._prediction(real_sections(REAL_POST_OPT))
        row = prediction["hold"]["func_ffg_cbest_125"]
        self.assertEqual((row["count"], row["worst"], row["tns"]), (42, -0.0764, -0.6846))
        self.assertEqual(prediction["holdTns"], -7.8307)

    def test_tolerates_carriage_returns(self):
        sections = {check: text.replace("\n", "\r\n") for check, text in real_sections(REAL_PRE_OPT).items()}
        self.assertEqual(self._prediction(sections)["worstSetupWns"], -0.0387)

    def test_text_without_the_table_is_an_unknown_prediction(self):
        eco_actions_only = REAL_POST_OPT[:REAL_POST_OPT.index("### setup summary ###")]
        for text in ("Error: no timing data\n", "", None, eco_actions_only):
            with self.subTest(text=text):
                prediction = self._prediction({"setup": text, "hold": real_sections(REAL_PRE_OPT)["hold"]})
                self.assertIn("setup", prediction["unknown"])


NETLIST_ECO = "ecoAddRepeater -term {U3/A} -cell BUFX2 -name atcs_w02_r1_b1\necoChangeCell -inst U1 -cell BUFX2\n"
PHYSICAL_ECO = "placeInstance atcs_w02_r1_b1 10.0 20.0 R0\n"


def eco_files(netlist=NETLIST_ECO, physical=PHYSICAL_ECO, arm="merged"):
    folder = "eco" if arm == "merged" else "eco-control"
    files = {}
    if netlist is not None:
        files["netlist"] = [{"path": f"integrations/b1/{arm}/{folder}/atcs_batch_netlist_top.txt",
                             "sha256": core.digest({"t": netlist, "a": arm}) + "0" * 44, "text": netlist}]
    else:
        files["netlist"] = []
    if physical is not None:
        files["physical"] = [{"path": f"integrations/b1/{arm}/{folder}/atcs_batch_physical_top.txt",
                              "sha256": core.digest({"t": physical, "a": arm}) + "1" * 44, "text": physical}]
    else:
        files["physical"] = []
    return files


def arm_evidence(arm, *, setup=None, hold=None, complete=True, tainted="", eco=None, receipts=None,
                 session_deltas=None, auto_delta=None, total_delta=None, protected=None, export_code=0,
                 tool_failure=None, predict_text=None, kept_instance_nets=None):
    setup = setup if setup is not None else {"s1": (1, -0.02, -0.02), "s2": (0, 0.0, 0.0)}
    hold = hold if hold is not None else {"s1": (0, 0.0, 0.0), "s2": (2, -0.05, -0.08)}
    result = None
    if complete:
        result = {"arm": arm, "complete": True, "tainted": tainted, "protected": list(protected or []),
                  "protectCode": 0, "protectResult": "", "autoFix": [], "predict": {"setup": 0, "hold": 0},
                  "exportCode": export_code, "exportResult": ""}
    return {
        "arm": arm, "result": result, "receipts": list(receipts or []), "badReceiptLines": 0,
        "sessionDeltas": dict(session_deltas or {}),
        "autoDelta": auto_delta if auto_delta is not None else {"mastersChanged": {}, "added": {}, "removed": {}},
        "totalDelta": total_delta if total_delta is not None else {"mastersChanged": {}, "added": {}, "removed": {}},
        "predictText": predict_text or {"setup": gba_summary("setup", setup) if setup != "missing" else None,
                                        "hold": gba_summary("hold", hold) if hold != "missing" else None},
        "eco": eco if eco is not None else eco_files(arm=arm),
        "toolFailure": tool_failure,
        "keptInstanceNets": dict(kept_instance_nets or {}),
    }


def merged_receipts(request):
    steps = request["steps"]
    return [
        {"stepId": steps[0]["stepId"], "slot": "w01", "status": "applied", "seq": 1},
        {"stepId": steps[1]["stepId"], "slot": "w01", "status": "skipped", "attempted": True,
         "reason": "atcs_fix_hold_pins: out-of-scope pin: U9/D"},
        {"stepId": steps[2]["stepId"], "slot": "w02", "status": "applied", "seq": 3},
        {"stepId": steps[3]["stepId"], "slot": "w02", "status": "skipped", "attempted": False, "reason": "recipe"},
    ]


def matching_session_deltas():
    sessions = recipe_sessions()
    return {slot: sessions[slot]["delta"] for slot in sessions}


def reconcile_default(merged_kw=None, control_kw=None, request=None):
    request = request or prepare_default()
    merged_kw = dict(merged_kw or {})
    merged_kw.setdefault("receipts", merged_receipts(request))
    merged_kw.setdefault("session_deltas", matching_session_deltas())
    arms = {"merged": arm_evidence("merged", **merged_kw), "control": arm_evidence("control", **(control_kw or {}))}
    return request, integration.reconcile_recipe(request, arms)


class ReconcileRecipeTests(unittest.TestCase):
    def test_skipped_commands_are_recorded_and_the_replay_still_counts(self):
        request, state = reconcile_default()
        steps = request["steps"]
        w01 = state["sessions"]["w01"]
        self.assertEqual(w01["applied"], [steps[0]["stepId"]])
        self.assertEqual(w01["skipped"], [{"stepId": steps[1]["stepId"], "attempted": True,
                                           "reason": "atcs_fix_hold_pins: out-of-scope pin: U9/D"}])
        w02 = state["sessions"]["w02"]
        self.assertEqual(w02["applied"], [steps[2]["stepId"]])
        self.assertEqual(w02["skipped"], [{"stepId": steps[3]["stepId"], "attempted": False,
                                           "reason": "recipe:shared-instance"}])
        self.assertEqual(state["chosen"]["arm"], "merged")
        for key in ("pending", "failed", "replayMismatch", "outOfScope", "unknownReceipts"):
            self.assertEqual(state[key], [], key)

    def test_a_session_replay_delta_that_differs_is_a_recorded_warning_not_a_refusal(self):
        deltas = matching_session_deltas()
        deltas["w02"] = {"mastersChanged": {}, "added": {"atcs_w02_r1_b1": "BUFX4"}, "removed": {}}
        _, state = reconcile_default(merged_kw={"session_deltas": deltas})
        warnings = [w for w in state["warnings"] if w["kind"] == "replayMismatch"]
        self.assertEqual([w["slot"] for w in warnings], ["w02"])
        self.assertFalse(state["sessions"]["w02"]["deltaMatches"])
        self.assertTrue(state["sessions"]["w01"]["deltaMatches"])
        self.assertEqual(state["replayMismatch"], [])
        self.assertEqual(state["chosen"]["arm"], "merged")

    def test_auto_finish_changing_a_protected_instance_is_a_recorded_mismatch(self):
        auto = {"mastersChanged": {"U1": ["BUFX2", "BUFX8"], "UOUT": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}}
        _, state = reconcile_default(merged_kw={"auto_delta": auto, "protected": ["U1", "atcs_w02_r1_b1"]})
        warnings = [w for w in state["warnings"] if w["kind"] == "protectedChanged"]
        self.assertEqual(len(warnings), 1)
        self.assertEqual(warnings[0]["instances"], ["U1"])
        self.assertEqual(state["protectedChanged"], ["U1"])

    def test_a_session_changing_another_sessions_instance_is_out_of_domain(self):
        deltas = matching_session_deltas()
        deltas["w02"] = {"mastersChanged": {"U1": ["BUFX2", "BUFX4"]}, "added": {"atcs_w02_r1_b1": "BUFX2"},
                         "removed": {}}
        _, state = reconcile_default(merged_kw={"session_deltas": deltas})
        self.assertTrue(any("session w02" in p and "U1" in p for p in state["arms"]["merged"]["problems"]))
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_merged_out_of_domain_replay_change_refuses_merged_and_falls_back_to_control(self):
        deltas = matching_session_deltas()
        deltas["w01"] = {"mastersChanged": {"U1": ["BUFX1", "BUFX2"], "UOUT": ["BUFX1", "BUFX2"]},
                         "added": {"FILL_7": "FILL4"}, "removed": {}}
        _, state = reconcile_default(merged_kw={"session_deltas": deltas})
        self.assertFalse(state["arms"]["merged"]["safe"])
        self.assertTrue(any("UOUT" in problem for problem in state["arms"]["merged"]["problems"]))
        self.assertFalse(any("FILL_7" in problem for problem in state["arms"]["merged"]["problems"]))
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_control_is_chosen_when_it_predicts_better(self):
        _, state = reconcile_default(control_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.03, -0.03)}})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("control", state["chosen"]["reason"])
        self.assertEqual(state["chosen"]["eco"]["netlist"]["path"],
                         "integrations/b1/control/eco-control/atcs_batch_netlist_top.txt")

    def test_merged_is_chosen_when_it_predicts_better(self):
        _, state = reconcile_default(merged_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.01, -0.01)}})
        self.assertEqual(state["chosen"]["arm"], "merged")

    def test_merged_is_chosen_on_a_tie(self):
        _, state = reconcile_default()
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertIn("tie", state["chosen"]["reason"])

    def test_merged_with_better_hold_but_worse_setup_wns_is_not_chosen(self):
        """Never worse than plain auto-fix: a merged arm that loses setup WNS is refused even
        when its hold WNS gain makes its worst-of-both slack better."""
        _, state = reconcile_default(merged_kw={"setup": {"s1": (1, -0.03, -0.03), "s2": (0, 0.0, 0.0)},
                                                "hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.01, -0.01)}})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("setup WNS", state["chosen"]["reason"])

    def test_merged_with_better_setup_but_worse_hold_wns_is_not_chosen(self):
        _, state = reconcile_default(merged_kw={"setup": {"s1": (0, 0.0, 0.0), "s2": (0, 0.0, 0.0)},
                                                "hold": {"s1": (0, 0.0, 0.0), "s2": (2, -0.06, -0.06)}})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("hold WNS", state["chosen"]["reason"])

    def test_a_wns_loss_within_one_rounding_step_is_no_worse(self):
        _, state = reconcile_default(merged_kw={"setup": {"s1": (1, -0.0201, -0.0201), "s2": (0, 0.0, 0.0)},
                                                "hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.04, -0.04)}})
        self.assertEqual(state["chosen"]["arm"], "merged")

    def test_merged_no_worse_on_wns_and_worse_on_tns_only_is_not_chosen(self):
        _, state = reconcile_default(merged_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (4, -0.05, -0.20)}})
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_merged_better_on_one_tns_and_worse_on_the_other_is_chosen(self):
        _, state = reconcile_default(merged_kw={"setup": {"s1": (2, -0.02, -0.03), "s2": (0, 0.0, 0.0)},
                                                "hold": {"s1": (0, 0.0, 0.0), "s2": (1, -0.05, -0.05)}})
        self.assertEqual(state["chosen"]["arm"], "merged")

    def test_equal_worst_slack_is_broken_by_tns(self):
        _, state = reconcile_default(control_kw={"setup": {"s1": (3, -0.02, -0.05), "s2": (0, 0.0, 0.0)}})
        self.assertEqual(state["chosen"]["arm"], "merged")
        _, state = reconcile_default(merged_kw={"setup": {"s1": (3, -0.02, -0.05), "s2": (0, 0.0, 0.0)}})
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_only_required_scenarios_are_compared(self):
        control_hold = {"s1": (0, 0.0, 0.0), "s2": (2, -0.05, -0.08), "s_extra": (9, -0.5, -3.0)}
        _, state = reconcile_default(control_kw={"hold": control_hold})
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertIn("tie", state["chosen"]["reason"])

    def test_the_choice_reads_real_xtop_summaries_and_breaks_equal_wns_by_tns(self):
        request = integration.prepare_recipe_replay(
            recipe_plan(), BASE_STATE_ID, default_recipe(), recipe_sessions(), required_scenarios=REAL_SCENARIOS)

        post, pre = real_sections(REAL_POST_OPT), real_sections(REAL_PRE_OPT)
        _, state = reconcile_default(merged_kw={"predict_text": post}, control_kw={"predict_text": pre},
                                     request=request)
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["arms"]["merged"]["prediction"]["worstHoldWns"], -0.1542)
        # TNS across required scenarios is the sum of their own rows (the `total` row is a
        # per-endpoint union, not a sum): -0.6846-0.6551-2.7901-3.7009 vs -0.7568-0.7199-2.9593-3.8962.
        self.assertEqual(state["arms"]["merged"]["prediction"]["holdTns"], -7.8307)
        self.assertEqual(state["arms"]["control"]["prediction"]["holdTns"], -8.3322)
        _, state = reconcile_default(merged_kw={"predict_text": pre}, control_kw={"predict_text": post},
                                     request=request)
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_predictions_of_both_arms_are_recorded_per_scenario(self):
        _, state = reconcile_default()
        merged = state["arms"]["merged"]["prediction"]
        self.assertEqual(merged["setup"]["s1"], {"count": 1, "worst": -0.02, "tns": -0.02})
        self.assertEqual(merged["worstSetupWns"], -0.02)
        self.assertEqual(merged["worstHoldWns"], -0.05)
        self.assertEqual(state["arms"]["control"]["prediction"]["hold"]["s2"]["tns"], -0.08)

    def test_a_safe_control_with_an_unknown_prediction_is_chosen(self):
        _, state = reconcile_default(control_kw={"hold": "missing"})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("control prediction unknown", state["chosen"]["reason"])
        self.assertTrue(state["guarantee"]["evidenced"])

    def test_a_compared_choice_is_an_evidenced_guarantee(self):
        _, state = reconcile_default()
        self.assertEqual(state["guarantee"], {"evidenced": True, "arm": "merged",
                                              "reason": state["chosen"]["reason"]})
        self.assertFalse([w for w in state["warnings"] if w["kind"] == "guaranteeUnevidenced"])

    def test_new_nets_are_empty_when_the_chosen_arm_inserted_nothing(self):
        _, state = reconcile_default()
        self.assertEqual(state["newNets"], [])
        self.assertNotIn("newNetsUnknown", state)

    def test_new_nets_are_the_expert_nets_when_auto_finish_inserted_nothing(self):
        total = {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {"atcs_w02_r1_b1": "BUFX2"}, "removed": {}}
        _, state = reconcile_default(merged_kw={
            "total_delta": total,
            "kept_instance_nets": {"atcs_w02_r1_b1": ["atcs_w02_r1_n1"], "atcs_w02_r1_gone": ["atcs_w02_r1_n9"]}})
        self.assertEqual(state["newNets"], ["atcs_w02_r1_n1"])

    def test_an_expert_instance_without_a_recorded_net_makes_new_nets_unknown(self):
        total = {"mastersChanged": {}, "added": {"atcs_w02_r1_b1": "BUFX2", "atcs_w01_r1_eco_3": "BUFX4"},
                 "removed": {}}
        _, state = reconcile_default(merged_kw={"total_delta": total,
                                                "kept_instance_nets": {"atcs_w02_r1_b1": ["atcs_w02_r1_n1"],
                                                                       "atcs_w01_r1_eco_3": []}})
        self.assertIsNone(state["newNets"])
        self.assertIn("atcs_w01_r1_eco_3", state["newNetsUnknown"])

    def test_new_nets_are_unknown_when_auto_fix_inserted_instances(self):
        auto = {"mastersChanged": {}, "added": {"atcs_b1_auto_eco_1": "BUFX2"}, "removed": {}}
        total = {"mastersChanged": {}, "added": {"atcs_b1_auto_eco_1": "BUFX2"}, "removed": {}}
        _, state = reconcile_default(merged_kw={"auto_delta": auto, "total_delta": total})
        self.assertIsNone(state["newNets"])
        self.assertIn("auto-fix", state["newNetsUnknown"])
        _, state = reconcile_default(control_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (0, 0.0, 0.0)},
                                                 "total_delta": total})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIsNone(state["newNets"])

    def test_filler_insertions_are_not_new_nets(self):
        total = {"mastersChanged": {}, "added": {"FILL_9": "FILL4"}, "removed": {}}
        _, state = reconcile_default(merged_kw={"total_delta": total})
        self.assertEqual(state["newNets"], [])

    def test_an_unknown_merged_prediction_falls_back_to_control(self):
        _, state = reconcile_default(merged_kw={"hold": "missing"})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("unknown", state["chosen"]["reason"])

    def test_a_missing_required_scenario_makes_the_prediction_unknown(self):
        _, state = reconcile_default(merged_kw={"setup": {"s1": (0, 0.0, 0.0)}})
        self.assertIn("unknown", state["arms"]["merged"]["prediction"])
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_a_failed_control_arm_does_not_fail_the_merged_arm(self):
        _, state = reconcile_default(control_kw={
            "complete": False, "eco": eco_files(None, None, arm="control"),
            "tool_failure": {"detail": "tool exited 7", "log": "integrations/b1/control/xtop-replay.log"},
        })
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertFalse(state["arms"]["control"]["safe"])
        self.assertEqual(state["arms"]["control"]["toolFailure"]["detail"], "tool exited 7")
        self.assertIn("control", state["chosen"]["reason"])
        # Nothing shows the merged batch is at least as good as plain auto-fix: sealed as such.
        self.assertEqual(state["guarantee"]["evidenced"], False)
        warnings = [w for w in state["warnings"] if w["kind"] == "guaranteeUnevidenced"]
        self.assertEqual(len(warnings), 1)
        self.assertIn("control", warnings[0]["reason"])

    def test_a_missing_merged_pair_with_no_usable_control_is_missing_input(self):
        with self.assertRaises(core.AtcsError) as ctx:
            reconcile_default(merged_kw={"eco": eco_files(netlist=None)},
                              control_kw={"complete": False, "eco": eco_files(None, None, arm="control")})
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_a_missing_merged_pair_falls_back_to_a_safe_control(self):
        _, state = reconcile_default(merged_kw={"eco": eco_files(physical=None)})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertTrue(any("missing" in problem for problem in state["arms"]["merged"]["problems"]))

    def test_two_netlist_files_are_not_one_pair(self):
        eco = eco_files()
        eco["netlist"].append(dict(eco["netlist"][0], path="integrations/b1/merged/eco/atcs_batch_netlist_x.txt"))
        _, state = reconcile_default(merged_kw={"eco": eco})
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_formatversion_dbnetfreewires_and_editdelete_net_lines_refuse_the_pair(self):
        for netlist, physical in (
            ("FORMATVERSION 2\nADDCELL x\n", PHYSICAL_ECO),
            (NETLIST_ECO, "dbNetFreeWires [dbGetNetByName n1]\n"),
            (NETLIST_ECO + "  editDelete -net n1\n", PHYSICAL_ECO),
        ):
            with self.subTest(netlist=netlist, physical=physical):
                _, state = reconcile_default(merged_kw={"eco": eco_files(netlist, physical)})
                self.assertEqual(state["chosen"]["arm"], "control")
                self.assertFalse(state["arms"]["merged"]["safe"])
                self.assertTrue(state["arms"]["merged"]["problems"])
                self.assertIn("merged", state["chosen"]["reason"])

    def test_an_unsafe_pair_in_both_arms_is_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            reconcile_default(merged_kw={"eco": eco_files("FORMATVERSION 2\n", PHYSICAL_ECO)},
                              control_kw={"eco": eco_files(NETLIST_ECO, "editDelete -net n2\n", arm="control")})
        self.assertEqual(ctx.exception.code, "eco-refused")

    def test_an_unsafe_control_pair_leaves_the_merged_pair_chosen(self):
        _, state = reconcile_default(
            control_kw={"eco": eco_files(NETLIST_ECO, "dbNetFreeWires x\n", arm="control"),
                        "hold": {"s1": (0, 0.0, 0.0), "s2": (0, 0.0, 0.0)}})
        self.assertEqual(state["chosen"]["arm"], "merged")

    def test_a_tainted_merged_session_refuses_merged(self):
        _, state = reconcile_default(merged_kw={"tainted": "size_cell left an unexpected design state (seq 2)"})
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertTrue(any("tainted" in problem for problem in state["arms"]["merged"]["problems"]))

    def test_a_receipt_for_an_unknown_step_refuses_the_merged_evidence(self):
        request = prepare_default()
        receipts = merged_receipts(request) + [{"stepId": "ghost", "slot": "w01", "status": "applied"}]
        _, state = reconcile_default(merged_kw={"receipts": receipts}, request=request)
        self.assertFalse(state["arms"]["merged"]["safe"])
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_a_sendable_step_without_a_receipt_refuses_the_merged_evidence(self):
        request = prepare_default()
        receipts = merged_receipts(request)[1:]
        _, state = reconcile_default(merged_kw={"receipts": receipts}, request=request)
        self.assertEqual(state["sessions"]["w01"]["skipped"][0],
                         {"stepId": request["steps"][0]["stepId"], "attempted": False, "reason": "no-receipt"})
        self.assertFalse(state["arms"]["merged"]["safe"])
        self.assertEqual(state["chosen"]["arm"], "control")

    def test_eco_text_is_hashed_into_the_state_not_copied(self):
        _, state = reconcile_default()
        pair = state["arms"]["merged"]["eco"]
        self.assertEqual(set(pair), {"netlist", "physical"})
        self.assertEqual(set(pair["netlist"]), {"path", "sha256"})
        self.assertEqual(state["chosen"]["eco"], pair)

    def test_a_legacy_request_is_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.reconcile_recipe({"batchId": "b1", "steps": []}, {})
        self.assertEqual(ctx.exception.code, "identity-mismatch")


class SealRecipeBatchTests(unittest.TestCase):
    def _facts(self):
        return {"baseStateId": BASE_STATE_ID, "duplicates": []}

    def _contributions(self):
        return [make_contribution("c1", revision=1), make_contribution("c2", task_id="w02", revision=3)]

    def test_seal_covers_the_chosen_pair_both_predictions_the_choice_and_session_deltas(self):
        auto = {"mastersChanged": {"UOUT": ["BUFX1", "BUFX4"]}, "added": {}, "removed": {}}
        request, state = reconcile_default(merged_kw={"auto_delta": auto})
        merge_commit = integration.seal_batch(state, request, self._facts(), self._contributions())
        self.assertEqual(merge_commit["schema"], "atcs.merge-commit/1")
        self.assertEqual(merge_commit["parentStateId"], BASE_STATE_ID)
        self.assertEqual(merge_commit["eco"], state["chosen"]["eco"])
        self.assertEqual(merge_commit["choice"]["arm"], "merged")
        self.assertTrue(merge_commit["choice"]["reason"])
        self.assertEqual(set(merge_commit["arms"]), {"merged", "control"})
        for arm in ("merged", "control"):
            self.assertIn("prediction", merge_commit["arms"][arm])
            self.assertEqual(set(merge_commit["arms"][arm]["eco"]), {"netlist", "physical"})
        self.assertEqual(merge_commit["sessions"]["w01"]["applied"], state["sessions"]["w01"]["applied"])
        self.assertEqual(merge_commit["sessions"]["w02"]["skipped"], state["sessions"]["w02"]["skipped"])
        self.assertEqual(merge_commit["sessions"]["w02"]["delta"], matching_session_deltas()["w02"])
        self.assertEqual(merge_commit["autoDelta"], auto)
        self.assertEqual(merge_commit["operations"], [])
        self.assertEqual(merge_commit["newNets"], [])
        self.assertEqual(merge_commit["guarantee"], state["guarantee"])
        self.assertEqual(merge_commit["contributions"], [{"id": "c1", "revision": 1}, {"id": "c2", "revision": 3}])

    def test_unknown_new_nets_are_sealed_unknown(self):
        auto = {"mastersChanged": {}, "added": {"atcs_b1_auto_eco_1": "BUFX2"}, "removed": {}}
        request, state = reconcile_default(merged_kw={"auto_delta": auto, "total_delta": auto})
        merge_commit = integration.seal_batch(state, request, self._facts(), self._contributions())
        self.assertIsNone(merge_commit["newNets"])
        self.assertTrue(merge_commit["newNetsUnknown"])

    def test_a_control_choice_credits_no_contribution(self):
        request, state = reconcile_default(control_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (0, 0.0, 0.0)}})
        merge_commit = integration.seal_batch(state, request, self._facts(), self._contributions())
        self.assertEqual(merge_commit["choice"]["arm"], "control")
        self.assertEqual(merge_commit["contributions"], [])
        self.assertEqual(merge_commit["eco"]["netlist"]["path"],
                         "integrations/b1/control/eco-control/atcs_batch_netlist_top.txt")

    def test_a_different_chosen_pair_is_a_different_merge_commit(self):
        request, state = reconcile_default()
        first = integration.seal_batch(state, request, self._facts(), self._contributions())
        _, other = reconcile_default(control_kw={"hold": {"s1": (0, 0.0, 0.0), "s2": (0, 0.0, 0.0)}},
                                     request=request)
        second = integration.seal_batch(other, request, self._facts(), self._contributions())
        self.assertNotEqual(first["id"], second["id"])

    def test_seal_refuses_a_batch_id_mismatch(self):
        request, state = reconcile_default()
        state = dict(state, batchId="other")
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, self._facts(), self._contributions())
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_seal_refuses_a_state_with_no_chosen_pair(self):
        request, state = reconcile_default()
        state = dict(state, chosen=None)
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, self._facts(), self._contributions())
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_seal_refuses_a_recipe_state_against_a_legacy_request(self):
        request, state = reconcile_default()
        legacy = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, legacy, self._facts(), self._contributions())
        self.assertEqual(ctx.exception.code, "identity-mismatch")


if __name__ == "__main__":
    unittest.main()
