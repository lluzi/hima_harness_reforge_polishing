"""Tests for `mage_placement.rounds`: best-state order, conflicts, and the
full `decide()` join (route rule, ledger coverage, archiving)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, rounds  # noqa: E402


def _metrics(native_total=0, priority_unplaced=0, hard_fail=0, drops_count=0, drops_length="0",
             over_limit=0, order_max=0, rework=0, moved=0, disp_total="0"):
    return {
        "nativeRows": {"total": native_total},
        "priorityUnplaced": {"count": priority_unplaced},
        "hardFailCount": hard_fail,
        "drops": {"count": drops_count, "lengthUm": drops_length},
        "targetDistances": {"overLimitCount": over_limit},
        "orderDeviation": {"max": order_max},
        "reworkTotal": rework,
        "displacement": {"movedCount": moved, "totalUm": disp_total},
    }


def _request(id_, consumer, kind, targets, finding="F-1"):
    return {
        "schema": "mage.request/1", "id": id_, "fromFinding": finding, "consumer": consumer,
        "snapshotSha256": "s" * 64,
        "requestedOutcome": {"kind": kind, "targets": targets, "limitsUm": {}, "text": f"{consumer} wants {kind}"},
        "acceptableAlternatives": [], "strength": "hard",
    }


def _finding(id_, consumer, status, severity, numbers=None):
    return {
        "schema": "mage.finding/1", "id": id_, "round": 1, "snapshotSha256": "s" * 64,
        "consumer": consumer, "consumerModel": f"{consumer}@1", "evaluatorReceipt": "r" * 64,
        "targets": [], "predicate": "placed", "status": status, "severity": severity,
        "numbers": numbers or {}, "explanation": "test finding",
    }


def _review(consumer, findings=None, requests=None, snapshot_sha="s" * 64):
    return core.stamp("consumer-review", {
        "identity": {"taskId": "t", "runId": "r", "executionId": "e", "nodeId": "n", "round": 1},
        "consumer": consumer, "consumerModel": f"{consumer}@1", "snapshotSha256": snapshot_sha,
        "findings": findings or [], "requests": requests or [],
        "receipt": {"path": "receipt.json", "sha256": "d" * 64}, "summary": "test review",
    })


def _reader_values(error=0, native=0, priority=0, drops=0, drops_len="0", over=0, order=0):
    def v(type_name, value):
        return {"type": type_name, "value": value}
    return [
        v("mage_candidate_error_count", error),
        v("mage_native_violation_total", native),
        v("mage_priority_unplaced_count", priority),
        v("mage_dropped_count", drops),
        v("mage_dropped_length_um", drops_len),
        v("mage_target_over_limit_count", over),
        v("mage_order_deviation_max", order),
    ]


def _candidate(snapshot_sha="s" * 64, metrics=None, ledger=None, outcome="completed", reader_values=None):
    doc = core.stamp("placement-candidate", {
        "identity": {"taskId": "t", "runId": "r", "executionId": "e", "nodeId": "n", "round": 1},
        "startSnapshotSha256": "x" * 64, "snapshotSha256": snapshot_sha, "buildBanner": "synthetic",
        "files": {}, "metrics": metrics or _metrics(),
        "ledger": ledger or [], "remaining": [], "blocked": [], "unknown": [],
        "outcome": outcome, "stopReason": "", "reproduction": {},
    })
    if reader_values is not None:
        doc = dict(doc)
        doc["_readerValues"] = reader_values
    return doc


class BestStateKeyTests(unittest.TestCase):
    def test_fewer_native_rows_wins(self):
        better = rounds.best_state_key(_metrics(native_total=0), None)
        worse = rounds.best_state_key(_metrics(native_total=3), None)
        self.assertLess(better, worse)

    def test_unknown_native_rows_sorts_worst(self):
        known = rounds.best_state_key(_metrics(native_total=5), None)
        unknown = rounds.best_state_key({"nativeRows": {"total": None}}, None)
        self.assertLess(known, unknown)

    def test_priority_unplaced_breaks_tie_after_native_rows(self):
        better = rounds.best_state_key(_metrics(native_total=0, priority_unplaced=0), None)
        worse = rounds.best_state_key(_metrics(native_total=0, priority_unplaced=1), None)
        self.assertLess(better, worse)

    def test_drops_count_then_length_order(self):
        fewer = rounds.best_state_key(_metrics(drops_count=1, drops_length="10"), None)
        more = rounds.best_state_key(_metrics(drops_count=2, drops_length="1"), None)
        self.assertLess(fewer, more)
        same_count_shorter = rounds.best_state_key(_metrics(drops_count=1, drops_length="10"), None)
        same_count_longer = rounds.best_state_key(_metrics(drops_count=1, drops_length="20"), None)
        self.assertLess(same_count_shorter, same_count_longer)


class ConflictsTests(unittest.TestCase):
    def test_move_vs_keep_on_shared_target_conflicts(self):
        a = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"])
        b = _request("R-2", "metrology", "keep", ["OVL_B.OVL_B_1"])
        found = rounds.conflicts([a, b])
        self.assertEqual(len(found), 1)

    def test_same_consumer_never_conflicts_with_itself(self):
        a = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"])
        b = _request("R-2", "litho-pie", "keep", ["OVL_B.OVL_B_1"])
        self.assertEqual(rounds.conflicts([a, b]), [])

    def test_disjoint_targets_never_conflict(self):
        a = _request("R-1", "litho-pie", "move", ["OVL_A.OVL_A_1"])
        b = _request("R-2", "metrology", "keep", ["OVL_B.OVL_B_1"])
        self.assertEqual(rounds.conflicts([a, b]), [])

    def test_compatible_kinds_never_conflict(self):
        a = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"])
        b = _request("R-2", "metrology", "move", ["OVL_B.OVL_B_1"])
        self.assertEqual(rounds.conflicts([a, b]), [])


class DecideTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.workspace = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _round0_decision(self):
        return core.stamp("round-decision", {
            "round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None,
            "openRequests": [], "decisionRequests": [], "history": [], "stopReason": "",
        })

    def test_stop_when_no_hard_fail_and_no_open_requests(self):
        candidate = _candidate()
        reviews = [_review("litho-pie"), _review("metrology"), _review("alignment"), _review("wat")]
        decision = rounds.decide(self.workspace, 1, {}, reviews, candidate, self._round0_decision())
        self.assertEqual(decision["route"], "stop")
        self.assertEqual(decision["stopReason"], "no consumer hard failure and no open request")

    def test_continue_when_open_requests(self):
        finding = _finding("F-1", "litho-pie", "fail", "hard")
        request = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-1")
        candidate = _candidate()
        reviews = [
            _review("litho-pie", findings=[finding], requests=[request]),
            _review("metrology"), _review("alignment"), _review("wat"),
        ]
        decision = rounds.decide(self.workspace, 1, {}, reviews, candidate, self._round0_decision())
        self.assertEqual(decision["route"], "continue")
        self.assertEqual([r["id"] for r in decision["openRequests"]], ["R-1"])

    def _stalled_round(self, round_no, previous_decision):
        """One round whose candidate never improves (same drops) and whose
        review carries a hard fail + Request, answering the previous round's
        same Request."""
        finding = _finding("F-litho-pie-1", "litho-pie", "fail", "hard")
        request = _request("R-litho-pie-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-litho-pie-1")
        ledger = []
        if round_no > 1:
            ledger = [{"schema": "mage.ledger-entry/1", "id": "L-1", "request": "R-litho-pie-1",
                       "answer": "declined", "answeredInSnapshot": "s" * 64, "evidence": [], "note": ""}]
        candidate = _candidate(metrics=_metrics(drops_count=5), ledger=ledger)
        reviews = [
            _review("litho-pie", findings=[finding], requests=[request]),
            _review("metrology"), _review("alignment"), _review("wat"),
        ]
        return rounds.decide(self.workspace, round_no, {}, reviews, candidate, previous_decision)

    def test_round_one_is_recorded_as_improved(self):
        # I2: the first ranked round is an improvement over nothing, so the
        # two-rounds-no-improvement rule cannot fire on rounds 1+2 alone.
        decision1 = self._stalled_round(1, self._round0_decision())
        self.assertTrue(decision1["history"][-1]["improved"])
        self.assertEqual(decision1["route"], "continue")

    def test_stop_after_two_stalls_following_the_first_round(self):
        # I2: a stall at round 2 is the FIRST non-improvement; only a second
        # consecutive stall at round 3 stops the Run.
        decision1 = self._stalled_round(1, self._round0_decision())
        decision2 = self._stalled_round(2, decision1)
        self.assertEqual(decision2["route"], "continue")
        decision3 = self._stalled_round(3, decision2)
        self.assertEqual(decision3["route"], "stop")
        self.assertEqual(decision3["stopReason"], "no improvement for two consecutive rounds")

    def test_round_limit_with_unanswered_previous_stops_not_continues(self):
        # C2: at the final round an unanswered previous Request must STOP
        # (deliver best effort), not route continue into a repeat the Harness
        # cannot run -- which would fail the whole Run with nothing delivered.
        finding = _finding("F-litho-pie-1", "litho-pie", "fail", "hard")
        request = _request("R-litho-pie-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-litho-pie-1")
        previous = core.stamp("round-decision", {
            "round": 3, "route": "continue", "nextRound": {"round": 4}, "best": None,
            "openRequests": [request], "decisionRequests": [], "history": [], "stopReason": "",
        })
        candidate = _candidate(ledger=[])  # round 4 never answers R-litho-pie-1
        reviews = [_review("litho-pie"), _review("metrology"), _review("alignment"), _review("wat")]
        decision = rounds.decide(self.workspace, rounds.MAX_ROUNDS, {}, reviews, candidate, previous)
        self.assertEqual(decision["route"], "stop")
        self.assertIn("round limit reached", decision["stopReason"])
        self.assertIn("R-litho-pie-1", decision["stopReason"])

    def test_best_state_order_prefers_fewer_native_rows_then_priority_then_hard_fails_then_drops(self):
        worse = _metrics(native_total=2, drops_count=5)
        better = _metrics(native_total=0, drops_count=10)
        self.assertLess(rounds.best_state_key(better, None), rounds.best_state_key(worse, None))

    def test_conflict_move_vs_keep_becomes_decision_request_with_both_consumers_numbers(self):
        finding_a = _finding("F-1", "litho-pie", "fail", "hard", numbers={"alongUm": "150"})
        finding_b = _finding("F-1", "metrology", "fail", "hard", numbers={"coverage": "ok"})
        request_a = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-1")
        request_b = _request("R-2", "metrology", "keep", ["OVL_B.OVL_B_1"], finding="F-1")
        candidate = _candidate()
        reviews = [
            _review("litho-pie", findings=[finding_a], requests=[request_a]),
            _review("metrology", findings=[finding_b], requests=[request_b]),
            _review("alignment"), _review("wat"),
        ]
        decision = rounds.decide(self.workspace, 1, {}, reviews, candidate, self._round0_decision())
        self.assertEqual(len(decision["decisionRequests"]), 1)
        options = decision["decisionRequests"][0]["options"]
        consumers_seen = {k for opt in options for k in opt["perConsumer"]}
        self.assertEqual(consumers_seen, {"litho-pie", "metrology"})

    def test_ranks_by_reader_values_not_self_reported_metrics(self):
        # C1: round 1 has a genuinely good Reader reading (2 drops). Round 2's
        # candidate self-reports 0 drops in its own `metrics`, but its Reader
        # values say 5 drops -- so it must NOT beat round 1. If decide ranked
        # by the self-reported metrics it would wrongly become best.
        reviews = [_review("litho-pie"), _review("metrology"), _review("alignment"), _review("wat")]
        cand1 = _candidate(metrics=_metrics(drops_count=2), reader_values=_reader_values(drops=2))
        d1 = rounds.decide(self.workspace, 1, {}, reviews, cand1, self._round0_decision())
        self.assertEqual(d1["best"]["round"], 1)

        cand2 = _candidate(metrics=_metrics(drops_count=0), reader_values=_reader_values(drops=5))
        d2 = rounds.decide(self.workspace, 2, {}, reviews, cand2, d1)
        self.assertEqual(d2["best"]["round"], 1)

    def test_blocked_candidate_never_becomes_best(self):
        # C1: a blocked candidate (no clean Reader reading) is ranked worst
        # and never replaces a completed better round.
        reviews = [_review("litho-pie"), _review("metrology"), _review("alignment"), _review("wat")]
        cand1 = _candidate(reader_values=_reader_values(drops=1))
        d1 = rounds.decide(self.workspace, 1, {}, reviews, cand1, self._round0_decision())
        self.assertEqual(d1["best"]["round"], 1)

        cand2 = _candidate(outcome="blocked", reader_values=None)
        d2 = rounds.decide(self.workspace, 2, {}, reviews, cand2, d1)
        self.assertEqual(d2["best"]["round"], 1)

    def test_review_bound_to_wrong_snapshot_is_skipped_and_recorded(self):
        # C1: a review bound to a different snapshot is dropped (its hard fail
        # and requests do not count this round) and recorded in the decision.
        finding = _finding("F-litho-pie-1", "litho-pie", "fail", "hard")
        request = _request("R-litho-pie-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-litho-pie-1")
        stale = _review("litho-pie", findings=[finding], requests=[request], snapshot_sha="z" * 64)
        candidate = _candidate(reader_values=_reader_values())
        reviews = [stale, _review("metrology"), _review("alignment"), _review("wat")]
        decision = rounds.decide(self.workspace, 1, {}, reviews, candidate, self._round0_decision())
        self.assertEqual(decision["openRequests"], [])
        self.assertEqual([s["consumer"] for s in decision["skippedReviews"]], ["litho-pie"])
        # With the stale litho-pie review dropped there is no hard fail and no
        # open request this round, so the Run stops cleanly.
        self.assertEqual(decision["route"], "stop")

    def test_unanswered_previous_request_is_a_candidate_error_not_a_decision(self):
        finding = _finding("F-1", "litho-pie", "fail", "hard")
        request = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-1")
        reviews1 = [
            _review("litho-pie", findings=[finding], requests=[request]),
            _review("metrology"), _review("alignment"), _review("wat"),
        ]
        candidate1 = _candidate()
        decision1 = rounds.decide(self.workspace, 1, {}, reviews1, candidate1, self._round0_decision())
        self.assertIn("R-1", [r["id"] for r in decision1["openRequests"]])

        # Round 2's candidate never answers R-1 in its ledger.
        candidate2 = _candidate(ledger=[])
        reviews2 = [_review("litho-pie"), _review("metrology"), _review("alignment"), _review("wat")]
        decision2 = rounds.decide(self.workspace, 2, {}, reviews2, candidate2, decision1)
        self.assertEqual(decision2["route"], "continue")
        self.assertIn("R-1", decision2["stopReason"])


if __name__ == "__main__":
    unittest.main()
