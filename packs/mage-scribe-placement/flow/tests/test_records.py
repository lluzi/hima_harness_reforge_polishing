import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, records  # noqa: E402


def valid_request(request_id="R-wat-1-1", from_finding="F-wat-1"):
    return {
        "schema": "mage.request/1",
        "id": request_id,
        "fromFinding": from_finding,
        "consumer": "wat",
        "snapshotSha256": "a" * 64,
        "requestedOutcome": {
            "kind": "move",
            "targets": ["KEY_V.KEY_V"],
            "limitsUm": {},
            "text": "please re-place the dropped key",
        },
        "acceptableAlternatives": [],
        "strength": "hard",
    }


def valid_finding(finding_id="F-wat-1"):
    return {
        "schema": "mage.finding/1",
        "id": finding_id,
        "round": 0,
        "snapshotSha256": "a" * 64,
        "consumer": "wat",
        "consumerModel": "wat@0.2.0",
        "evaluatorReceipt": "b" * 64,
        "targets": ["KEY_V.KEY_V"],
        "predicate": "placed",
        "status": "fail",
        "severity": "hard",
        "numbers": {"blockType": "TSK/MPAD"},
        "explanation": "KEY_V.KEY_V is still pending",
    }


def ledger(request_id, answer):
    body = {
        "request": request_id,
        "answer": answer,
        "answeredInSnapshot": "c" * 64,
        "evidence": [],
        "note": "",
    }
    return core.stamp("ledger-entry", body)


class ValidateRecordTest(unittest.TestCase):
    def test_valid_request_has_no_errors(self):
        self.assertEqual(records.validate_record("request", valid_request("R-wat-1-1")), [])

    def test_valid_finding_has_no_errors(self):
        self.assertEqual(records.validate_record("finding", valid_finding()), [])

    def test_valid_ledger_entry_has_no_errors(self):
        self.assertEqual(records.validate_record("ledger-entry", ledger("R-wat-1-1", "satisfied")), [])

    def test_request_with_bad_strength_is_invalid(self):
        broken = {**valid_request("R-wat-1-3"), "strength": "maybe"}
        self.assertTrue(records.validate_record("request", broken))

    def test_request_missing_required_field_is_invalid(self):
        broken = valid_request("R-wat-1-4")
        del broken["requestedOutcome"]
        self.assertTrue(records.validate_record("request", broken))

    def test_finding_with_bad_status_is_invalid(self):
        broken = {**valid_finding(), "status": "maybe"}
        self.assertTrue(records.validate_record("finding", broken))

    def test_ledger_entry_with_bare_request_id_is_invalid(self):
        # N4: a Ledger entry whose `request` is a bare/mis-scoped id (not the
        # round-scoped `R-<consumer>-<round>-<n>`) is refused -- `ledger_covers`
        # could otherwise silently leave every real Request unanswered.
        self.assertTrue(records.validate_record("ledger-entry", ledger("R-2", "satisfied")))
        self.assertTrue(records.validate_record("ledger-entry", ledger("R-wat-1", "satisfied")))

    def test_ledger_entry_id_is_a_sequence_not_a_digest(self):
        # N4: a Ledger entry's `id` is a human-authored sequence (`L-<n>`),
        # never a content digest -- a plain `L-1` id validates.
        entry = {"schema": "mage.ledger-entry/1", "id": "L-1", "request": "R-wat-1-1",
                 "answer": "satisfied", "answeredInSnapshot": "c" * 64, "evidence": [], "note": ""}
        self.assertEqual(records.validate_record("ledger-entry", entry), [])

    def test_unknown_kind_raises(self):
        with self.assertRaises(core.MageError):
            records.validate_record("not-a-real-kind", {})

    def test_request_id_without_consumer_scope_is_invalid(self):
        # C3: a bare `R-<n>` id (no consumer scope) no longer validates;
        # the convention is `R-<consumer>-<round>-<n>`.
        self.assertTrue(records.validate_record("request", valid_request("R-1")))

    def test_finding_id_without_consumer_scope_is_invalid(self):
        self.assertTrue(records.validate_record("finding", valid_finding("F-1")))

    def test_request_fromfinding_must_be_consumer_scoped(self):
        self.assertTrue(records.validate_record("request", valid_request("R-wat-1-1", from_finding="F-1")))


def valid_decision_request(request_id="D-1"):
    return {
        "schema": "mage.decision-request/1",
        "id": request_id,
        "round": 1,
        "question": "keep the dropped key pending or relax its limit?",
        "options": [
            {"id": "keep", "description": "leave KEY_V pending", "perConsumer": {}, "nativeChecked": True,
             "snapshotSha256": "a" * 64},
        ],
        "blockingRequests": ["R-wat-1"],
    }


def valid_consumer_review(consumer_id="wat"):
    body = {
        "identity": {"taskId": "t1", "runId": "r1", "executionId": "e1", "nodeId": "n1", "round": 0},
        "consumer": consumer_id,
        "consumerModel": f"{consumer_id}@0.2.0",
        "snapshotSha256": "a" * 64,
        "findings": [valid_finding()],
        "requests": [],
        "receipt": {"path": "receipts/wat-abc.json", "sha256": "b" * 64},
        "summary": "one hard fail",
    }
    return core.stamp("consumer-review", body)


class SchemaCoverageTest(unittest.TestCase):
    def test_decision_request_validates(self):
        self.assertEqual(records.validate_record("decision-request", valid_decision_request()), [])

    def test_consumer_review_validates(self):
        self.assertEqual(records.validate_record("consumer-review", valid_consumer_review()), [])

    def test_consumer_review_tampered_is_invalid(self):
        review = valid_consumer_review()
        tampered = dict(review)
        tampered["summary"] = "tampered"
        self.assertTrue(records.validate_record("consumer-review", tampered))


class OpenRequestsTest(unittest.TestCase):
    def test_flattens_requests_from_every_review_in_order(self):
        reviews = [
            {"requests": [valid_request("R-wat-1")]},
            {"requests": [valid_request("R-wat-2"), valid_request("R-wat-3")]},
        ]
        requests = records.open_requests(reviews)
        self.assertEqual([r["id"] for r in requests], ["R-wat-1", "R-wat-2", "R-wat-3"])

    def test_review_with_no_requests_contributes_nothing(self):
        reviews = [{"requests": []}, {"requests": [valid_request("R-wat-1")]}]
        requests = records.open_requests(reviews)
        self.assertEqual([r["id"] for r in requests], ["R-wat-1"])


class LedgerCoversTest(unittest.TestCase):
    def test_unanswered_request_is_reported(self):
        reqs = [valid_request("R-wat-1"), valid_request("R-wat-2")]
        coverage = records.ledger_covers(reqs, [ledger("R-wat-1", "satisfied")])
        self.assertEqual(coverage["unanswered"], ["R-wat-2"])
        self.assertEqual(coverage["answered"], ["R-wat-1"])

    def test_declined_and_alternative_both_count_as_answered(self):
        reqs = [valid_request("R-wat-1"), valid_request("R-wat-2")]
        entries = [ledger("R-wat-1", "declined"), ledger("R-wat-2", "alternative")]
        coverage = records.ledger_covers(reqs, entries)
        self.assertEqual(coverage["unanswered"], [])
        self.assertEqual(sorted(coverage["answered"]), ["R-wat-1", "R-wat-2"])

    def test_entry_with_invalid_answer_leaves_request_unanswered(self):
        reqs = [valid_request("R-wat-1")]
        entries = [{"request": "R-wat-1", "answer": "maybe", "answeredInSnapshot": "x", "evidence": [], "note": ""}]
        coverage = records.ledger_covers(reqs, entries)
        self.assertEqual(coverage["unanswered"], ["R-wat-1"])

    def test_cross_consumer_ids_never_collide(self):
        # C3 regression: before per-consumer ids, litho-pie's R-1 and wat's
        # R-1 shared one key, so a single Ledger entry "answered" both. With
        # `R-<consumer>-<n>`, answering litho-pie's request leaves wat's open.
        litho = {**valid_request("R-litho-pie-1"), "consumer": "litho-pie"}
        wat = valid_request("R-wat-1")
        coverage = records.ledger_covers([litho, wat], [ledger("R-litho-pie-1", "declined")])
        self.assertEqual(coverage["answered"], ["R-litho-pie-1"])
        self.assertEqual(coverage["unanswered"], ["R-wat-1"])


if __name__ == "__main__":
    unittest.main()
