"""Tests for `atcs.integration` — M5's deterministic replay and merge.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_integration_recovery.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

Fixtures are generated locally in this file (per this task's instructions,
not shared with other in-flight M-task test files). Contributions and
composition-facts are built as literal dicts matching the shapes documented
in `atcs.contributions`'s and `atcs.composition`'s module docstrings —
this lets each test pin the exact `baseStateId`/`delta`/`order`/`conflicts`
fields an acceptance case needs without depending on M4's own algorithm.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))

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


def make_contribution(
    contribution_id,
    task_id="w01",
    revision=1,
    base_state_id=BASE_STATE_ID,
    operations=None,
    delta=None,
    admissible=True,
):
    """A literal `contribution` artifact, id fixed by the caller (not `core.stamp`-derived)
    so tests can name ids explicitly for `select`/`resolutions`/`sourceMap` assertions.
    """
    return {
        "schema": "atcs.contribution/1",
        "id": contribution_id,
        "taskId": task_id,
        "revision": revision,
        "baseStateId": base_state_id,
        "kind": "fix",
        "operations": operations if operations is not None else [],
        "script": None,
        "beforeDumpSha256": "a" * 64,
        "delta": delta if delta is not None else {"mastersChanged": {}, "added": {}, "removed": {}},
        "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
        "preconditions": [],
        "dependencies": [],
        "atomicGroups": [],
        "predicted": {
            "xtopSetupWns": core.unknown("not-predicted"),
            "xtopHoldWns": core.unknown("not-predicted"),
            "prestaSetupWns": core.unknown("not-predicted"),
            "prestaHoldWns": core.unknown("not-predicted"),
        },
        "validationLevel": "none",
        "diagnosis": None,
        "admissible": admissible,
        "refusals": [],
        "outOfScope": [],
    }


def make_facts(order, conflicts=None, duplicates=None, base_state_id=BASE_STATE_ID):
    body = {
        "baseStateId": base_state_id,
        "considered": sorted(order),
        "duplicates": duplicates or [],
        "conflicts": conflicts or [],
        "interactions": [],
        "staleBase": [],
        "order": order,
        "unresolvedCount": 0,
        "unknownResolutions": [],
    }
    return core.stamp("composition-facts", body)


def make_plan(batch_id, select, resolutions=None, base_state_id=BASE_STATE_ID):
    return {
        "batchId": batch_id,
        "baseStateId": base_state_id,
        "select": select,
        "resolutions": resolutions or [],
        "deferred": [],
        "reason": "test",
    }


class XtopTclTests(unittest.TestCase):
    def test_size_cell(self):
        self.assertEqual(
            integration.xtop_tcl(size_op("U1", "INVX1", "INVX4")),
            "size_cell {U1} INVX4",
        )

    def test_insert_buffer_without_location(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", load_pins=["U/A", "U/B"])
        self.assertEqual(
            integration.xtop_tcl(op),
            "insert_buffer {U/A U/B} {BUFX2} -new_cell_names {atcs_w01_r1_buf0} "
            "-new_net_names {atcs_w01_r1_net0}",
        )

    def test_insert_buffer_with_location(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2", location=[10.5, 20.25])
        tcl = integration.xtop_tcl(op)
        self.assertIn("-locations {{10.5 20.25}}", tcl)

    def test_delete_buffer(self):
        self.assertEqual(integration.xtop_tcl(delete_op("U9", "BUFX2")), "remove_buffer {U9}")

    def test_pg_local_adjust_unsupported(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(pg_op())
        self.assertEqual(ctx.exception.code, "unsupported-op")

    def test_unsafe_instance_name_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1;rm -rf", "INVX1", "INVX4"))
        self.assertEqual(ctx.exception.code, "unsafe-name")

    def test_unsafe_master_with_braces_rejected(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.xtop_tcl(size_op("U1", "INVX1", "{INVX4}"))
        self.assertEqual(ctx.exception.code, "unsafe-name")


class InnovusEcoTclTests(unittest.TestCase):
    def test_size_cell_uses_eco_change_cell(self):
        tcl = integration.innovus_eco_tcl([size_op("U1", "INVX1", "INVX4")])
        self.assertEqual(tcl, "ecoChangeCell -inst {U1} -cell INVX4")

    def test_delete_buffer_uses_eco_delete_repeater(self):
        tcl = integration.innovus_eco_tcl([delete_op("U9", "BUFX2")])
        self.assertEqual(tcl, "ecoDeleteRepeater -inst {U9}")

    def test_buffer_insertion_names_new_instance_and_new_net_exactly(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2")
        tcl = integration.innovus_eco_tcl([op])
        self.assertEqual(
            tcl,
            "ecoAddRepeater -net N1 -cell BUFX2 -name atcs_w01_r1_buf0 -newNetName atcs_w01_r1_net0",
        )

    def test_multiple_ops_join_with_newline(self):
        tcl = integration.innovus_eco_tcl([size_op("U1", "A", "B"), delete_op("U2", "C")])
        self.assertEqual(tcl, "ecoChangeCell -inst {U1} -cell B\necoDeleteRepeater -inst {U2}")

    def test_pg_local_adjust_unsupported(self):
        with self.assertRaises(core.AtcsError) as ctx:
            integration.innovus_eco_tcl([pg_op()])
        self.assertEqual(ctx.exception.code, "unsupported-op")


class ValidatePlanTests(unittest.TestCase):
    def setUp(self):
        self.facts = make_facts(order=["c1", "c2"])

    def test_valid_plan_is_stamped(self):
        plan = make_plan("b1", select=["c1"])
        result = integration.validate_plan(plan, self.facts)
        self.assertEqual(result["schema"], "atcs.integration-plan/1")
        self.assertEqual(integration.plan_invalid_count(plan, self.facts), 0)

    def test_select_id_not_considered_is_invalid(self):
        plan = make_plan("b1", select=["c1", "unknown-id"])
        with self.assertRaises(core.AtcsError) as ctx:
            integration.validate_plan(plan, self.facts)
        self.assertEqual(ctx.exception.code, "invalid-plan")
        self.assertEqual(integration.plan_invalid_count(plan, self.facts), 1)

    def test_baseStateId_mismatch_is_invalid(self):
        plan = make_plan("b1", select=["c1"], base_state_id=OTHER_BASE_STATE_ID)
        self.assertGreaterEqual(integration.plan_invalid_count(plan, self.facts), 1)
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, self.facts)

    def test_unknown_conflict_key_is_invalid(self):
        plan = make_plan(
            "b1", select=["c1"], resolutions=[{"conflictKey": "nope", "decision": "drop:c1"}]
        )
        with self.assertRaises(core.AtcsError) as ctx:
            integration.validate_plan(plan, self.facts)
        self.assertEqual(ctx.exception.code, "invalid-plan")

    def test_revise_without_revised_contribution_is_invalid(self):
        facts = make_facts(order=["c1"], conflicts=[{"key": "k1", "kind": "x", "contributions": ["c1"], "objects": []}])
        plan = make_plan("b1", select=["c1"], resolutions=[{"conflictKey": "k1", "decision": "revise:c1"}])
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revise_with_inadmissible_revised_contribution_is_invalid(self):
        facts = make_facts(order=["c1"], conflicts=[{"key": "k1", "kind": "x", "contributions": ["c1"], "objects": []}])
        revised = make_contribution("c1-rev", admissible=False)
        plan = make_plan(
            "b1",
            select=["c1"],
            resolutions=[{"conflictKey": "k1", "decision": "revise:c1", "revisedContribution": revised}],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_revise_with_mismatched_base_state_is_invalid(self):
        facts = make_facts(order=["c1"], conflicts=[{"key": "k1", "kind": "x", "contributions": ["c1"], "objects": []}])
        revised = make_contribution("c1-rev", base_state_id=OTHER_BASE_STATE_ID)
        plan = make_plan(
            "b1",
            select=["c1"],
            resolutions=[{"conflictKey": "k1", "decision": "revise:c1", "revisedContribution": revised}],
        )
        with self.assertRaises(core.AtcsError):
            integration.validate_plan(plan, facts)

    def test_valid_revise_passes(self):
        facts = make_facts(order=["c1"], conflicts=[{"key": "k1", "kind": "x", "contributions": ["c1"], "objects": []}])
        revised = make_contribution("c1-rev")
        plan = make_plan(
            "b1",
            select=["c1"],
            resolutions=[{"conflictKey": "k1", "decision": "revise:c1", "revisedContribution": revised}],
        )
        integration.validate_plan(plan, facts)  # does not raise


class PrepareReplayTests(unittest.TestCase):
    def test_steps_follow_facts_order_with_expected_step_ids(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[insert_op("N1", "buf0", "net0", "BUFX2")])
        facts = make_facts(order=["c2", "c1"])
        plan = make_plan("b1", select=["c1", "c2"])  # select order deliberately reversed vs. facts.order

        request = integration.prepare_replay(plan, facts, [c1, c2])

        self.assertEqual(request["schema"], "atcs.replay-request/1")
        self.assertEqual([step["contributionId"] for step in request["steps"]], ["c2", "c1"])
        expected_step_id_0 = core.digest({"contributionId": "c2", "opIndex": 0})
        self.assertEqual(request["steps"][0]["stepId"], expected_step_id_0)
        self.assertEqual(request["steps"][0]["opIndex"], 0)
        self.assertEqual(request["steps"][1]["op"], size_op("U1", "A", "B"))

    def test_unresolved_conflict_raises(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        facts = make_facts(
            order=["c1", "c2"],
            conflicts=[
                {"key": "same-instance-different-master|c1,c2|U1", "kind": "same-instance-different-master",
                 "contributions": ["c1", "c2"], "objects": ["U1"]}
            ],
        )
        plan = make_plan("b1", select=["c1", "c2"])  # no resolution at all

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual(ctx.exception.code, "unresolved-conflict")

    def test_keep_resolution_excludes_other_conflict_member(self):
        c1 = make_contribution("c1", operations=[size_op("U1", "A", "B")])
        c2 = make_contribution("c2", operations=[size_op("U1", "A", "C")])
        conflict_key = "same-instance-different-master|c1,c2|U1"
        facts = make_facts(
            order=["c1", "c2"],
            conflicts=[{"key": conflict_key, "kind": "same-instance-different-master",
                        "contributions": ["c1", "c2"], "objects": ["U1"]}],
        )
        plan = make_plan(
            "b1", select=["c1", "c2"],
            resolutions=[{"conflictKey": conflict_key, "decision": "keep:c1"}],
        )

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual([step["contributionId"] for step in request["steps"]], ["c1"])

    def test_stale_base_without_revise_raises(self):
        stale = make_contribution("c1", base_state_id=OTHER_BASE_STATE_ID, operations=[size_op("U1", "A", "B")])
        facts = make_facts(order=[])  # a stale-base contribution is excluded from considered/order by M4
        plan = make_plan("b1", select=["c1"])

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [stale])
        self.assertEqual(ctx.exception.code, "stale-base")

    def test_revise_substitutes_revised_contribution(self):
        stale = make_contribution("c1", base_state_id=OTHER_BASE_STATE_ID, operations=[size_op("U1", "A", "B")])
        revised = make_contribution("c1-rev", operations=[size_op("U1", "A", "D")])
        facts = make_facts(order=[])
        plan = make_plan(
            "b1", select=["c1"],
            resolutions=[{"conflictKey": "irrelevant", "decision": "revise:c1", "revisedContribution": revised}],
        )

        request = integration.prepare_replay(plan, facts, [stale, revised])

        self.assertEqual(len(request["steps"]), 1)
        self.assertEqual(request["steps"][0]["contributionId"], "c1-rev")
        self.assertEqual(request["steps"][0]["op"], size_op("U1", "A", "D"))

    def test_pg_local_adjust_selected_raises_unsupported_op(self):
        c1 = make_contribution("c1", operations=[pg_op()])
        facts = make_facts(order=["c1"])
        plan = make_plan("b1", select=["c1"])

        with self.assertRaises(core.AtcsError) as ctx:
            integration.prepare_replay(plan, facts, [c1])
        self.assertEqual(ctx.exception.code, "unsupported-op")

    def test_duplicate_dropped_contribution_is_not_replayed_twice(self):
        shared_ops = [size_op("U1", "A", "B")]
        c1 = make_contribution("c1", operations=shared_ops)
        c2 = make_contribution("c2", operations=shared_ops)
        facts = make_facts(
            order=["c1", "c2"],
            duplicates=[{"keep": "c1", "dropped": ["c2"], "sources": ["c1", "c2"]}],
        )
        plan = make_plan("b1", select=["c1", "c2"])

        request = integration.prepare_replay(plan, facts, [c1, c2])
        self.assertEqual([step["contributionId"] for step in request["steps"]], ["c1"])


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
            {"stepId": "s0", "status": "ok", "observedDelta": integration._op_expected_delta(request["steps"][0]["op"])},
            {"stepId": "s1", "status": "ok", "observedDelta": integration._op_expected_delta(request["steps"][1]["op"])},
        ]
        self.assertEqual(integration.pending_steps(request, receipts), ["s2", "s3"])

    def test_error_receipt_is_not_pending_either(self):
        request = self._request_with_steps(2)
        receipts = [{"stepId": "s0", "status": "error", "observedDelta": {}}]
        self.assertEqual(integration.pending_steps(request, receipts), ["s1"])


class ReconcileTests(unittest.TestCase):
    def _request_with_one_step(self, op):
        step = {"stepId": "s0", "contributionId": "c1", "opIndex": 0, "op": op, "xtopTcl": "x"}
        return {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": [step], "expectedDelta": {}}

    def test_duplicate_receipts_for_one_step_are_idempotent(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = integration._op_expected_delta(op)
        receipts = [
            {"stepId": "s0", "status": "ok", "observedDelta": good},
            {"stepId": "s0", "status": "ok", "observedDelta": good},
        ]
        state = integration.reconcile(request, receipts, edit_domains=[{"instances": ["U1"]}])
        self.assertEqual(list(state["applied"].keys()), ["s0"])
        self.assertEqual(state["failed"], [])
        self.assertEqual(state["pending"], [])

    def test_observed_delta_mismatch_is_replay_mismatch(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        wrong_delta = {"mastersChanged": {"U1": ["A", "WRONG"]}, "added": {}, "removed": {}}
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": wrong_delta}]

        state = integration.reconcile(request, receipts, edit_domains=[{"instances": ["U1"]}])
        self.assertEqual(state["replayMismatch"], ["s0"])
        self.assertEqual(state["applied"], {})

    def test_observed_change_outside_union_edit_domain_is_out_of_scope(self):
        op = size_op("U1", "A", "B")
        request = self._request_with_one_step(op)
        good = integration._op_expected_delta(op)
        receipts = [{"stepId": "s0", "status": "ok", "observedDelta": good}]

        state = integration.reconcile(request, receipts, edit_domains=[{"instances": ["SOME_OTHER_INSTANCE"]}])
        self.assertEqual(state["outOfScope"], ["s0"])
        self.assertEqual(state["applied"], {})

    def test_missing_receipt_is_pending(self):
        request = self._request_with_one_step(size_op("U1", "A", "B"))
        state = integration.reconcile(request, [], edit_domains=[{"instances": ["U1"]}])
        self.assertEqual(state["pending"], ["s0"])

    def test_error_status_is_failed(self):
        request = self._request_with_one_step(size_op("U1", "A", "B"))
        receipts = [{"stepId": "s0", "status": "error", "observedDelta": {}}]
        state = integration.reconcile(request, receipts, edit_domains=[{"instances": ["U1"]}])
        self.assertEqual(state["failed"], ["s0"])


class SealBatchTests(unittest.TestCase):
    def _facts(self, duplicates=None):
        return make_facts(order=["c1", "c2"], duplicates=duplicates or [])

    def test_refuses_with_pending(self):
        state = {"pending": ["s0"], "failed": [], "replayMismatch": [], "outOfScope": [], "applied": {}}
        request = {"batchId": "b1", "steps": []}
        with self.assertRaises(core.AtcsError) as ctx:
            integration.seal_batch(state, request, self._facts(), [])
        self.assertEqual(ctx.exception.code, "integration-incomplete")

    def test_refuses_with_failed(self):
        state = {"pending": [], "failed": ["s0"], "replayMismatch": [], "outOfScope": [], "applied": {}}
        request = {"batchId": "b1", "steps": []}
        with self.assertRaises(core.AtcsError):
            integration.seal_batch(state, request, self._facts(), [])

    def test_refuses_with_replay_mismatch(self):
        state = {"pending": [], "failed": [], "replayMismatch": ["s0"], "outOfScope": [], "applied": {}}
        request = {"batchId": "b1", "steps": []}
        with self.assertRaises(core.AtcsError):
            integration.seal_batch(state, request, self._facts(), [])

    def test_source_map_includes_all_duplicate_sources(self):
        op = size_op("U1", "A", "B")
        c1 = make_contribution("c1", revision=1, operations=[op])
        c2 = make_contribution("c2", revision=2, operations=[op])
        facts = self._facts(duplicates=[{"keep": "c1", "dropped": ["c2"], "sources": ["c1", "c2"]}])

        step = {"stepId": "s0", "contributionId": "c1", "opIndex": 0, "op": op, "xtopTcl": "x"}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": [step], "expectedDelta": {}}
        state = {
            "applied": {"s0": integration._op_expected_delta(op)},
            "failed": [], "pending": [], "replayMismatch": [], "outOfScope": [],
        }

        merge_commit = integration.seal_batch(state, request, facts, [c1, c2])

        op_key = core.digest({"op": op})
        self.assertEqual(merge_commit["sourceMap"][op_key], ["c1", "c2"])
        self.assertEqual(
            sorted(merge_commit["contributions"], key=lambda entry: entry["id"]),
            [{"id": "c1", "revision": 1}, {"id": "c2", "revision": 2}],
        )

    def test_buffer_insertion_names_and_lists_new_nets(self):
        op = insert_op("N1", "atcs_w01_r1_buf0", "atcs_w01_r1_net0", "BUFX2")
        c1 = make_contribution("c1", operations=[op])
        facts = self._facts()
        step = {"stepId": "s0", "contributionId": "c1", "opIndex": 0, "op": op, "xtopTcl": "x"}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": [step], "expectedDelta": {}}
        state = {
            "applied": {"s0": integration._op_expected_delta(op)},
            "failed": [], "pending": [], "replayMismatch": [], "outOfScope": [],
        }

        merge_commit = integration.seal_batch(state, request, facts, [c1])

        self.assertEqual(merge_commit["newNets"], ["atcs_w01_r1_net0"])
        self.assertIn("-name atcs_w01_r1_buf0", merge_commit["innovusEcoTcl"])
        self.assertIn("-newNetName atcs_w01_r1_net0", merge_commit["innovusEcoTcl"])

    def test_same_inputs_produce_the_same_merge_commit_id(self):
        op = size_op("U1", "A", "B")
        c1 = make_contribution("c1", operations=[op])
        facts = self._facts()
        step = {"stepId": "s0", "contributionId": "c1", "opIndex": 0, "op": op, "xtopTcl": "x"}
        request = {"batchId": "b1", "baseStateId": BASE_STATE_ID, "steps": [step], "expectedDelta": {}}
        state = {
            "applied": {"s0": integration._op_expected_delta(op)},
            "failed": [], "pending": [], "replayMismatch": [], "outOfScope": [],
        }

        first = integration.seal_batch(state, request, facts, [c1])
        second = integration.seal_batch(state, request, facts, [c1])
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["schema"], "atcs.merge-commit/1")


if __name__ == "__main__":
    unittest.main()
