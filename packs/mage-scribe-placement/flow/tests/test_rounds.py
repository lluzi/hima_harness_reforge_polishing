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


def _candidate(snapshot_sha="s" * 64, metrics=None, ledger=None, outcome="completed"):
    return core.stamp("placement-candidate", {
        "identity": {"taskId": "t", "runId": "r", "executionId": "e", "nodeId": "n", "round": 1},
        "startSnapshotSha256": "x" * 64, "snapshotSha256": snapshot_sha, "buildBanner": "synthetic",
        "files": {}, "metrics": metrics or _metrics(),
        "ledger": ledger or [], "remaining": [], "blocked": [], "unknown": [],
        "outcome": outcome, "stopReason": "", "reproduction": {},
    })


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

    def test_stop_after_two_rounds_without_improvement(self):
        candidate = _candidate(metrics=_metrics(drops_count=5))
        finding = _finding("F-1", "litho-pie", "fail", "hard")
        request = _request("R-1", "litho-pie", "move", ["OVL_B.OVL_B_1"], finding="F-1")
        reviews = [
            _review("litho-pie", findings=[finding], requests=[request]),
            _review("metrology"), _review("alignment"), _review("wat"),
        ]
        decision1 = rounds.decide(self.workspace, 1, {}, reviews, candidate, self._round0_decision())
        self.assertEqual(decision1["route"], "continue")

        ledger_answer = {"schema": "mage.ledger-entry/1", "id": "L-1", "request": "R-1",
                          "answer": "declined", "answeredInSnapshot": "s" * 64, "evidence": [], "note": ""}
        candidate2 = _candidate(metrics=_metrics(drops_count=5), ledger=[ledger_answer])
        reviews2 = [
            _review("litho-pie", findings=[finding], requests=[request]),
            _review("metrology"), _review("alignment"), _review("wat"),
        ]
        decision2 = rounds.decide(self.workspace, 2, {}, reviews2, candidate2, decision1)
        self.assertEqual(decision2["route"], "stop")
        self.assertEqual(decision2["stopReason"], "no improvement for two consecutive rounds")

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
