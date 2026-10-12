import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, records  # noqa: E402


def valid_request(request_id, from_finding="F-1"):
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


def valid_finding(finding_id="F-1"):
    return {
        "schema": "mage.finding/1",
        "id": finding_id,
        "round": 0,
        "snapshotSha256": "a" * 64,
        "consumer": "wat",
        "consumerModel": "wat@0.1.0",
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
        self.assertEqual(records.validate_record("request", valid_request("R-1")), [])

    def test_valid_finding_has_no_errors(self):
        self.assertEqual(records.validate_record("finding", valid_finding()), [])

    def test_valid_ledger_entry_has_no_errors(self):
        self.assertEqual(records.validate_record("ledger-entry", ledger("R-1", "satisfied")), [])

    def test_request_with_bad_strength_is_invalid(self):
        broken = {**valid_request("R-3"), "strength": "maybe"}
        self.assertTrue(records.validate_record("request", broken))

    def test_request_missing_required_field_is_invalid(self):
        broken = valid_request("R-4")
        del broken["requestedOutcome"]
        self.assertTrue(records.validate_record("request", broken))

    def test_finding_with_bad_status_is_invalid(self):
        broken = {**valid_finding(), "status": "maybe"}
        self.assertTrue(records.validate_record("finding", broken))

    def test_ledger_entry_tampered_id_is_invalid(self):
        entry = ledger("R-1", "satisfied")
        tampered = dict(entry)
        tampered["note"] = "tampered after stamping"
        self.assertTrue(records.validate_record("ledger-entry", tampered))

    def test_unknown_kind_raises(self):
        with self.assertRaises(core.MageError):
            records.validate_record("not-a-real-kind", {})


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
        "blockingRequests": ["R-1"],
    }


def valid_consumer_review(consumer_id="wat"):
    body = {
        "identity": {"taskId": "t1", "runId": "r1", "executionId": "e1", "nodeId": "n1", "round": 0},
        "consumer": consumer_id,
        "consumerModel": f"{consumer_id}@0.1.0",
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
            {"requests": [valid_request("R-1")]},
            {"requests": [valid_request("R-2"), valid_request("R-3")]},
        ]
        requests = records.open_requests(reviews)
        self.assertEqual([r["id"] for r in requests], ["R-1", "R-2", "R-3"])

    def test_review_with_no_requests_contributes_nothing(self):
        reviews = [{"requests": []}, {"requests": [valid_request("R-1")]}]
        requests = records.open_requests(reviews)
        self.assertEqual([r["id"] for r in requests], ["R-1"])


class LedgerCoversTest(unittest.TestCase):
    def test_unanswered_request_is_reported(self):
        reqs = [valid_request("R-1"), valid_request("R-2")]
        coverage = records.ledger_covers(reqs, [ledger("R-1", "satisfied")])
        self.assertEqual(coverage["unanswered"], ["R-2"])
        self.assertEqual(coverage["answered"], ["R-1"])

    def test_declined_and_alternative_both_count_as_answered(self):
        reqs = [valid_request("R-1"), valid_request("R-2")]
        entries = [ledger("R-1", "declined"), ledger("R-2", "alternative")]
        coverage = records.ledger_covers(reqs, entries)
        self.assertEqual(coverage["unanswered"], [])
        self.assertEqual(sorted(coverage["answered"]), ["R-1", "R-2"])

    def test_entry_with_invalid_answer_leaves_request_unanswered(self):
        reqs = [valid_request("R-1")]
        entries = [{"request": "R-1", "answer": "maybe", "answeredInSnapshot": "x", "evidence": [], "note": ""}]
        coverage = records.ledger_covers(reqs, entries)
        self.assertEqual(coverage["unanswered"], ["R-1"])


if __name__ == "__main__":
    unittest.main()
