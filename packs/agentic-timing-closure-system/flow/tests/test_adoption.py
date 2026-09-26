"""Tests for `atcs.adoption` (M7 guarded adoption and state pointers).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_adoption.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import adoption  # noqa: E402
from atcs import core  # noqa: E402


def _evaluation(candidate_id, setup, hold, missing=None, identity=None, constraint_fail=None,
                 constraint_unknown=None, database=None, tag=""):
    """A minimal, directly-stamped `evaluation`-shaped dict carrying exactly the
    fields `atcs.adoption` reads. `tag` lets otherwise-identical scenarios get
    distinct ids when a test needs two non-colliding evaluations."""
    missing = core.known(0) if missing is None else missing
    identity = core.known(0) if identity is None else identity
    constraint_fail = core.known(0) if constraint_fail is None else constraint_fail
    constraint_unknown = core.known(0) if constraint_unknown is None else constraint_unknown
    body = {
        "candidateId": candidate_id,
        "finalSetupWns": setup,
        "finalHoldWns": hold,
        "missingRequiredCheckCount": missing,
        "finalIdentityErrorCount": identity,
        "constraintFailureCount": constraint_fail,
        "constraintUnknownCount": constraint_unknown,
    }
    if database is not None:
        body["database"] = database
    if tag:
        body["_tag"] = tag
    return core.stamp("evaluation", body)


DEFAULT_POLICY = {"allowDegradedWorking": False, "degradeLimitNs": 0.0, "goal": {"setup": 0.0, "hold": 0.0}}


def _degraded_policy(limit_ns):
    return {"allowDegradedWorking": True, "degradeLimitNs": limit_ns, "goal": {"setup": 0.0, "hold": 0.0}}


def _make_database_ref(root):
    """Real files on disk with a matching sha256/treeDigest, for `artifact_ready`
    round-trip tests; returns (ref, enc_path, dat_dir)."""
    enc_path = root / "design.enc"
    enc_path.write_text("encoded-database-bytes-v1")
    dat_dir = root / "design.enc.dat"
    dat_dir.mkdir()
    (dat_dir / "part1").write_text("part-one")
    ref = {
        "enc": {"path": str(enc_path), "sha256": core.file_sha256(enc_path)},
        "encDat": {"path": str(dat_dir), "treeDigest": core.tree_digest(dat_dir)},
    }
    return ref, enc_path, dat_dir


class ArtifactReadyTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_matching_hashes_are_ready(self):
        ref, _enc, _dat = _make_database_ref(self.root)
        self.assertEqual(adoption.artifact_ready(ref), core.known(1))

    def test_enc_bytes_changed_is_not_ready(self):
        ref, enc_path, _dat = _make_database_ref(self.root)
        enc_path.write_text("tampered-bytes")
        self.assertEqual(adoption.artifact_ready(ref), core.known(0))

    def test_enc_dat_bytes_changed_is_not_ready(self):
        ref, _enc, dat_dir = _make_database_ref(self.root)
        (dat_dir / "part1").write_text("mutated-content")
        self.assertEqual(adoption.artifact_ready(ref), core.known(0))

    def test_missing_ref_is_unknown(self):
        self.assertTrue(core.is_known(adoption.artifact_ready(None)) is False)
        self.assertEqual(adoption.artifact_ready(None)["unknown"], "missing-database-ref")

    def test_missing_enc_identity_is_unknown(self):
        ref, _enc, dat_dir = _make_database_ref(self.root)
        del ref["enc"]["sha256"]
        result = adoption.artifact_ready(ref)
        self.assertFalse(core.is_known(result))
        self.assertEqual(result["unknown"], "missing-enc-identity")

    def test_missing_files_on_disk_is_known_zero(self):
        ref, enc_path, dat_dir = _make_database_ref(self.root)
        enc_path.unlink()
        self.assertEqual(adoption.artifact_ready(ref), core.known(0))


class LoadPointersTest(unittest.TestCase):
    def test_missing_file_returns_bootstrap_default(self):
        pointers = adoption.load_pointers("/nonexistent/path/pointers.json")
        self.assertEqual(pointers, {"version": 0, "working": None, "best": None, "delivery": None, "history": []})

    def test_round_trips_through_publish(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pointers.json"
            ev = _evaluation("state-a", core.known(-0.02), core.known(-0.01))
            adoption.publish(ev, None, path, DEFAULT_POLICY)
            pointers = adoption.load_pointers(path)
            self.assertEqual(pointers["working"]["candidateId"], "state-a")
            self.assertEqual(pointers["version"], 1)


class PublishGuardTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "pointers.json"

    def test_first_publish_becomes_best_with_no_prior_best(self):
        ev = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        record = adoption.publish(ev, None, self.path, DEFAULT_POLICY)
        self.assertEqual(record["decision"], "best")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-a")
        self.assertEqual(pointers["working"]["candidateId"], "state-a")
        self.assertEqual(pointers["version"], 1)

    def test_better_evaluation_updates_best_and_keeps_old_best_in_history(self):
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_b = _evaluation("state-b", core.known(-0.01), core.known(-0.005))
        record = adoption.publish(ev_b, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "best")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-b")
        self.assertEqual(pointers["working"]["candidateId"], "state-b")

        best_history = [h for h in pointers["history"] if h["pointer"] == "best"]
        self.assertEqual(len(best_history), 2)
        self.assertEqual(best_history[0]["previous"], None)
        self.assertEqual(best_history[0]["new"]["candidateId"], "state-a")
        self.assertEqual(best_history[1]["previous"]["candidateId"], "state-a")
        self.assertEqual(best_history[1]["new"]["candidateId"], "state-b")
        self.assertEqual(best_history[1]["acceptanceRecordId"], record["id"])

    def test_stale_base_is_refused_and_file_left_byte_identical(self):
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)
        before_bytes = self.path.read_bytes()

        ev_c = _evaluation("state-c", core.known(0.0), core.known(0.0), tag="stale")
        record = adoption.publish(ev_c, "not-the-current-working-state", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "stale-base")
        after_bytes = self.path.read_bytes()
        self.assertEqual(before_bytes, after_bytes)

    def test_refused_bootstrap_publish_creates_no_file(self):
        ev = _evaluation("state-x", core.known(0.0), core.known(0.0))
        record = adoption.publish(ev, "some-base-that-does-not-exist", self.path, DEFAULT_POLICY)
        self.assertEqual(record["decision"], "refused")
        self.assertFalse(self.path.exists())

    def test_unknown_constraint_count_never_becomes_best(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_d = _evaluation(
            "state-d", core.known(0.0), core.known(0.0),
            constraint_unknown=core.unknown("presta-not-qualified"),
        )
        record = adoption.publish(ev_d, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "working-only")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-a")
        self.assertEqual(pointers["working"]["candidateId"], "state-d")

    def test_positive_constraint_failure_count_never_becomes_best(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_e = _evaluation("state-e", core.known(0.0), core.known(0.0), constraint_fail=core.known(1))
        record = adoption.publish(ev_e, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "working-only")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-a")

    def test_degraded_but_verified_evaluation_within_limit_is_working_only(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_f = _evaluation("state-f", core.known(-0.05), core.known(-0.03))
        record = adoption.publish(ev_f, "state-a", self.path, _degraded_policy(0.1))

        self.assertEqual(record["decision"], "working-only")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-a")
        self.assertEqual(pointers["working"]["candidateId"], "state-f")

    def test_degraded_evaluation_beyond_limit_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_g = _evaluation("state-g", core.known(-5.0), core.known(-0.005))
        record = adoption.publish(ev_g, "state-a", self.path, _degraded_policy(0.1))

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "degrade-limit-exceeded")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-a")

    def test_degraded_evaluation_refused_when_policy_disallows(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_h = _evaluation("state-h", core.known(-0.02), core.known(-0.005))
        record = adoption.publish(ev_h, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "degraded-working-not-allowed")

    def test_unknown_wns_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_i = _evaluation("state-i", core.unknown("incomplete-coverage"), core.known(0.0))
        record = adoption.publish(ev_i, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "wns-unknown")

    def test_goal_met_and_artifact_ready_yields_delivery(self):
        ref, _enc, _dat = _make_database_ref(Path(self.temp.name))
        ev = _evaluation("state-j", core.known(0.0), core.known(0.0), database=ref)

        record = adoption.publish(ev, None, self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "delivery")
        self.assertEqual(record["acceptedArtifactReady"], core.known(1))
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["delivery"]["candidateId"], "state-j")
        self.assertEqual(pointers["best"]["candidateId"], "state-j")
        self.assertEqual(pointers["working"]["candidateId"], "state-j")
        pointer_names = {h["pointer"] for h in pointers["history"]}
        self.assertEqual(pointer_names, {"working", "best", "delivery"})

    def test_artifact_bytes_changed_after_evaluation_blocks_delivery(self):
        root = Path(self.temp.name)
        ref, enc_path, _dat = _make_database_ref(root)
        ev = _evaluation("state-k", core.known(0.0), core.known(0.0), database=ref)

        # The recorded identity was captured earlier; the real file has since
        # drifted (e.g. a later, unrelated write) by the time we publish.
        enc_path.write_text("bytes-changed-after-evaluation-was-assembled")

        record = adoption.publish(ev, None, self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "best")
        self.assertEqual(record["acceptedArtifactReady"], core.known(0))
        pointers = adoption.load_pointers(self.path)
        self.assertIsNone(pointers["delivery"])
        self.assertEqual(pointers["best"]["candidateId"], "state-k")

    def test_publishing_same_evaluation_twice_is_idempotent(self):
        ev = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        first = adoption.publish(ev, None, self.path, DEFAULT_POLICY)
        bytes_after_first = self.path.read_bytes()

        second = adoption.publish(ev, None, self.path, DEFAULT_POLICY)

        self.assertEqual(second["decision"], first["decision"])
        self.assertEqual(second["reason"], "idempotent-replay")
        bytes_after_second = self.path.read_bytes()
        self.assertEqual(bytes_after_first, bytes_after_second)
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["version"], 1)

    def test_late_evaluation_after_newer_best_cannot_overwrite_best(self):
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_b = _evaluation("state-b", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_b, "state-a", self.path, DEFAULT_POLICY)

        # A late result still carrying the original (now stale) base, even
        # though its own numbers would have beaten state-b.
        ev_late = _evaluation("state-late", core.known(0.0), core.known(0.0), tag="late")
        record = adoption.publish(ev_late, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "stale-base")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-b")
        self.assertEqual(pointers["working"]["candidateId"], "state-b")


if __name__ == "__main__":
    unittest.main()
