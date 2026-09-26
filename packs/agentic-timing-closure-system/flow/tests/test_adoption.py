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


def _evaluation(candidate_id, setup, hold, parent_state_id=None, missing=None, identity=None,
                 constraint_fail=None, constraint_unknown=None, comparison=None, database=None, tag=""):
    """A minimal, directly-stamped `evaluation`-shaped dict carrying exactly the
    fields `atcs.adoption` reads. `tag` lets otherwise-identical scenarios get
    distinct ids when a test needs two non-colliding evaluations."""
    missing = core.known(0) if missing is None else missing
    identity = core.known(0) if identity is None else identity
    constraint_fail = core.known(0) if constraint_fail is None else constraint_fail
    constraint_unknown = core.known(0) if constraint_unknown is None else constraint_unknown
    body = {
        "candidateId": candidate_id,
        "parentStateId": parent_state_id,
        "finalSetupWns": setup,
        "finalHoldWns": hold,
        "missingRequiredCheckCount": missing,
        "finalIdentityErrorCount": identity,
        "constraintFailureCount": constraint_fail,
        "constraintUnknownCount": constraint_unknown,
        "comparison": comparison or {},
    }
    if database is not None:
        body["database"] = database
    if tag:
        body["_tag"] = tag
    return core.stamp("evaluation", body)


DEFAULT_POLICY = {"allowDegradedWorking": False, "degradeLimitNs": 0.0, "goal": {"setup": 0.0, "hold": 0.0}}


def _degraded_policy(limit_ns, campaign_root=None):
    policy = {"allowDegradedWorking": True, "degradeLimitNs": limit_ns, "goal": {"setup": 0.0, "hold": 0.0}}
    if campaign_root is not None:
        policy["campaignRoot"] = str(campaign_root)
    return policy


def _policy_with_root(root, **overrides):
    policy = dict(DEFAULT_POLICY)
    policy["campaignRoot"] = str(root)
    policy.update(overrides)
    return policy


def _write_database_files(root, name="design"):
    """Real `.enc`/`.enc.dat` files on disk with a matching sha256/treeDigest,
    in the canonical `{"path", "sha256", "datDigest"}` shape — `path` is
    campaign-relative (just the filename, `root` playing the campaign root)."""
    enc_path = root / f"{name}.enc"
    enc_path.write_text("encoded-database-bytes-v1")
    dat_dir = root / f"{name}.enc.dat"
    dat_dir.mkdir()
    (dat_dir / "part1").write_text("part-one")
    ref = {
        "path": f"{name}.enc",
        "sha256": core.file_sha256(enc_path),
        "datDigest": core.tree_digest(dat_dir),
    }
    return ref, enc_path, dat_dir


class ArtifactReadyTest(unittest.TestCase):
    """`artifact_ready` itself always takes an already-resolved `path` (path
    resolution against `policy["campaignRoot"]` is `publish`'s job — see
    `PublishGuardTest`'s campaign-root tests)."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_matching_hashes_are_ready(self):
        ref, _enc, _dat = _write_database_files(self.root)
        ref = dict(ref, path=str(self.root / ref["path"]))
        self.assertEqual(adoption.artifact_ready(ref), core.known(1))

    def test_enc_bytes_changed_is_not_ready(self):
        ref, enc_path, _dat = _write_database_files(self.root)
        ref = dict(ref, path=str(enc_path))
        enc_path.write_text("tampered-bytes")
        self.assertEqual(adoption.artifact_ready(ref), core.known(0))

    def test_enc_dat_bytes_changed_is_not_ready(self):
        ref, enc_path, dat_dir = _write_database_files(self.root)
        ref = dict(ref, path=str(enc_path))
        (dat_dir / "part1").write_text("mutated-content")
        self.assertEqual(adoption.artifact_ready(ref), core.known(0))

    def test_missing_ref_is_unknown(self):
        result = adoption.artifact_ready(None)
        self.assertFalse(core.is_known(result))
        self.assertEqual(result["unknown"], "missing-database-ref")

    def test_missing_identity_field_is_unknown(self):
        ref, enc_path, _dat = _write_database_files(self.root)
        ref = dict(ref, path=str(enc_path))
        del ref["datDigest"]
        result = adoption.artifact_ready(ref)
        self.assertFalse(core.is_known(result))
        self.assertEqual(result["unknown"], "missing-database-identity")

    def test_missing_enc_file_is_known_zero(self):
        ref, enc_path, _dat = _write_database_files(self.root)
        ref = dict(ref, path=str(enc_path))
        enc_path.unlink()
        self.assertEqual(adoption.artifact_ready(ref), core.known(0))

    def test_missing_enc_dat_directory_is_known_zero(self):
        ref, enc_path, dat_dir = _write_database_files(self.root)
        ref = dict(ref, path=str(enc_path))
        for child in dat_dir.iterdir():
            child.unlink()
        dat_dir.rmdir()
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


class PolicyValidationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "pointers.json"
        self.ev = _evaluation("state-a", core.known(0.0), core.known(0.0))

    def test_non_bool_allow_degraded_working_raises_invalid_policy(self):
        policy = {"allowDegradedWorking": "yes", "degradeLimitNs": 0.0, "goal": {"setup": 0.0, "hold": 0.0}}
        with self.assertRaises(core.AtcsError) as ctx:
            adoption.publish(self.ev, None, self.path, policy)
        self.assertEqual(ctx.exception.code, "invalid-policy")

    def test_negative_degrade_limit_raises_invalid_policy(self):
        policy = {"allowDegradedWorking": True, "degradeLimitNs": -1.0, "goal": {"setup": 0.0, "hold": 0.0}}
        with self.assertRaises(core.AtcsError) as ctx:
            adoption.publish(self.ev, None, self.path, policy)
        self.assertEqual(ctx.exception.code, "invalid-policy")

    def test_non_finite_degrade_limit_raises_invalid_policy(self):
        policy = {"allowDegradedWorking": True, "degradeLimitNs": float("inf"), "goal": {"setup": 0.0, "hold": 0.0}}
        with self.assertRaises(core.AtcsError) as ctx:
            adoption.publish(self.ev, None, self.path, policy)
        self.assertEqual(ctx.exception.code, "invalid-policy")

    def test_nan_degrade_limit_raises_invalid_policy(self):
        policy = {"allowDegradedWorking": True, "degradeLimitNs": float("nan"), "goal": {"setup": 0.0, "hold": 0.0}}
        with self.assertRaises(core.AtcsError) as ctx:
            adoption.publish(self.ev, None, self.path, policy)
        self.assertEqual(ctx.exception.code, "invalid-policy")


class EvaluationIdentityValidationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "pointers.json"

    def test_wrong_schema_raises_schema_mismatch(self):
        fake = {"schema": "atcs.something-else/1", "id": "deadbeef00000000", "candidateId": "x"}
        with self.assertRaises(core.AtcsError) as ctx:
            adoption.publish(fake, None, self.path, DEFAULT_POLICY)
        self.assertEqual(ctx.exception.code, "schema-mismatch")

    def test_tampered_id_raises_schema_mismatch(self):
        ev = _evaluation("state-a", core.known(0.0), core.known(0.0))
        tampered = dict(ev, candidateId="state-tampered")  # id no longer matches the body
        with self.assertRaises(core.AtcsError) as ctx:
            adoption.publish(tampered, None, self.path, DEFAULT_POLICY)
        self.assertEqual(ctx.exception.code, "schema-mismatch")


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

        ev_b = _evaluation("state-b", core.known(-0.01), core.known(-0.005), parent_state_id="state-a")
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

    def test_stale_base_via_working_mismatch_is_refused_and_file_byte_identical(self):
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)
        before_bytes = self.path.read_bytes()

        ev_c = _evaluation("state-c", core.known(0.0), core.known(0.0), parent_state_id="not-current", tag="stale")
        record = adoption.publish(ev_c, "not-the-current-working-state", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "stale-base")
        after_bytes = self.path.read_bytes()
        self.assertEqual(before_bytes, after_bytes)

    def test_stale_base_via_parent_state_id_mismatch_alone_is_refused(self):
        # working *does* match expected_base, but the evaluation's own
        # parentStateId disagrees -- the candidate itself was built on a
        # different base than the one being CAS-checked.
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_d = _evaluation("state-d", core.known(0.0), core.known(0.0), parent_state_id="some-other-state", tag="d")
        record = adoption.publish(ev_d, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "stale-base")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-a")

    def test_refused_bootstrap_publish_creates_no_file(self):
        ev = _evaluation("state-x", core.known(0.0), core.known(0.0), parent_state_id="some-base")
        record = adoption.publish(ev, "some-base-that-does-not-exist", self.path, DEFAULT_POLICY)
        self.assertEqual(record["decision"], "refused")
        self.assertFalse(self.path.exists())

    # -- Partial evidence (coverage/identity) refuses every pointer, including working --

    def test_missing_required_check_count_unknown_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)
        before_bytes = self.path.read_bytes()

        ev = _evaluation("state-e", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          missing=core.unknown("sta-not-collected"))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "missing-required-checks")
        self.assertEqual(self.path.read_bytes(), before_bytes)

    def test_missing_required_check_count_known_positive_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-f", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          missing=core.known(1))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "missing-required-checks")

    def test_identity_error_count_unknown_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)
        before_bytes = self.path.read_bytes()

        ev = _evaluation("state-g", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          identity=core.unknown("identity-chain-incomplete"))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "identity-errors-present")
        self.assertEqual(self.path.read_bytes(), before_bytes)

    def test_identity_error_count_known_positive_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-h", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          identity=core.known(2))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "identity-errors-present")

    # -- Constraints known/unknown: refused for every pointer, not just "best" --

    def test_constraint_unknown_count_unknown_refuses_every_pointer(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-i", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          constraint_unknown=core.unknown("presta-not-qualified"))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "constraints-not-verified")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-a")  # NOT state-i

    def test_constraint_unknown_count_known_positive_refuses_every_pointer(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-j", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          constraint_unknown=core.known(1))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "constraints-not-verified")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-a")

    def test_constraint_failure_count_unknown_refuses_every_pointer(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-k", core.known(0.0), core.known(0.0), parent_state_id="state-a",
                          constraint_fail=core.unknown("drc-truncated"))
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "constraints-not-verified")

    def test_constraint_failure_known_positive_is_degradation_needing_permission(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        # Same WNS as current best/working (no WNS regression at all) but two
        # known constraint failures -- a *constraint* regression.
        ev = _evaluation("state-l", core.known(-0.01), core.known(-0.005), parent_state_id="state-a",
                          constraint_fail=core.known(2))
        refused = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)
        self.assertEqual(refused["decision"], "refused")
        self.assertEqual(refused["reason"], "degraded-working-not-allowed")

        ev2 = _evaluation("state-m", core.known(-0.01), core.known(-0.005), parent_state_id="state-a",
                           constraint_fail=core.known(2), tag="m")
        allowed = adoption.publish(ev2, "state-a", self.path, _degraded_policy(0.0))
        self.assertEqual(allowed["decision"], "working-only")
        self.assertIn("constraint-failures-degraded-working", allowed["reason"])
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-m")
        self.assertEqual(pointers["best"]["candidateId"], "state-a")  # never becomes best

    # -- WNS known/finite --

    def test_unknown_wns_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_i = _evaluation("state-i2", core.unknown("incomplete-coverage"), core.known(0.0),
                            parent_state_id="state-a")
        record = adoption.publish(ev_i, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "wns-unknown")

    def test_non_finite_setup_wns_is_refused_like_unknown(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-n", core.known(float("nan")), core.known(0.0), parent_state_id="state-a")
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)
        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "wns-unknown")

    def test_non_finite_hold_wns_is_refused_like_unknown(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev = _evaluation("state-o", core.known(0.0), core.known(float("inf")), parent_state_id="state-a")
        record = adoption.publish(ev, "state-a", self.path, DEFAULT_POLICY)
        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "wns-unknown")

    # -- Degraded-working baseline is best (falling back to working only when
    # best has never been set), never the absolute goal --

    def test_degraded_but_verified_evaluation_within_limit_is_working_only(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_f = _evaluation("state-f", core.known(-0.05), core.known(-0.03), parent_state_id="state-a")
        record = adoption.publish(ev_f, "state-a", self.path, _degraded_policy(0.1))

        self.assertEqual(record["decision"], "working-only")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-a")
        self.assertEqual(pointers["working"]["candidateId"], "state-f")

    def test_degraded_evaluation_beyond_limit_is_refused(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_g = _evaluation("state-g", core.known(-5.0), core.known(-0.005), parent_state_id="state-a")
        record = adoption.publish(ev_g, "state-a", self.path, _degraded_policy(0.1))

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "degrade-limit-exceeded")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-a")

    def test_degraded_evaluation_refused_when_policy_disallows(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_h = _evaluation("state-h2", core.known(-0.02), core.known(-0.005), parent_state_id="state-a")
        record = adoption.publish(ev_h, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "degraded-working-not-allowed")

    def test_repeated_within_step_regressions_refused_once_total_drift_from_best_exceeds_limit(self):
        # Baseline best stays at state-a's minWns (-0.01) throughout, since
        # neither later step ever beats it. Each *individual* step's
        # regression from the immediately preceding `working` would look
        # small enough to pass a working-relative bound, but bounding
        # against the fixed `best` baseline instead catches the cumulative
        # drift on the second step.
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        policy = _degraded_policy(0.1)
        ev_b = _evaluation("state-b", core.known(-0.08), core.known(-0.005), parent_state_id="state-a")
        record_b = adoption.publish(ev_b, "state-a", self.path, policy)
        self.assertEqual(record_b["decision"], "working-only")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-b")
        self.assertEqual(pointers["best"]["candidateId"], "state-a")

        # Regression from state-b (-0.08) to state-c (-0.15) is only 0.07 --
        # within limit relative to *working* -- but relative to best (-0.01)
        # it is 0.14, past the 0.1 limit.
        ev_c = _evaluation("state-c", core.known(-0.15), core.known(-0.005), parent_state_id="state-b")
        record_c = adoption.publish(ev_c, "state-b", self.path, policy)
        self.assertEqual(record_c["decision"], "refused")
        self.assertEqual(record_c["reason"], "degrade-limit-exceeded")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["working"]["candidateId"], "state-b")  # unchanged

    # -- Tie-break: fewer failing timing checks; a full tie keeps the incumbent --

    def test_tie_break_prefers_fewer_failing_timing_checks(self):
        ev_a = _evaluation("state-a", core.known(-0.01), core.known(-0.005),
                            comparison={"remaining": ["k1", "k2"]})
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        # Same minWns as state-a, but zero failing timing checks -- strictly
        # better on the tie-break metric alone.
        ev_b = _evaluation("state-b", core.known(-0.01), core.known(-0.005), parent_state_id="state-a",
                            comparison={})
        record_b = adoption.publish(ev_b, "state-a", self.path, DEFAULT_POLICY)
        self.assertEqual(record_b["decision"], "best")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-b")

        # Same minWns AND same (zero) failing timing checks as state-b: a
        # full tie -- the incumbent (state-b) keeps `best`.
        ev_c = _evaluation("state-c", core.known(-0.01), core.known(-0.005), parent_state_id="state-b",
                            comparison={})
        record_c = adoption.publish(ev_c, "state-b", self.path, DEFAULT_POLICY)
        self.assertEqual(record_c["decision"], "working-only")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-b")
        self.assertEqual(pointers["working"]["candidateId"], "state-c")

    # -- Delivery: goal met, constraints pass, and a live, campaign-root-resolved artifact_ready --

    def test_goal_met_and_artifact_ready_yields_delivery(self):
        root = Path(self.temp.name)
        ref, _enc, _dat = _write_database_files(root)
        ev = _evaluation("state-p", core.known(0.0), core.known(0.0), database=ref)

        record = adoption.publish(ev, None, self.path, _policy_with_root(root))

        self.assertEqual(record["decision"], "delivery")
        self.assertEqual(record["acceptedArtifactReady"], core.known(1))
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["delivery"]["candidateId"], "state-p")
        self.assertEqual(pointers["best"]["candidateId"], "state-p")
        self.assertEqual(pointers["working"]["candidateId"], "state-p")
        pointer_names = {h["pointer"] for h in pointers["history"]}
        self.assertEqual(pointer_names, {"working", "best", "delivery"})

    def test_artifact_bytes_changed_after_evaluation_blocks_delivery(self):
        root = Path(self.temp.name)
        ref, enc_path, _dat = _write_database_files(root)
        ev = _evaluation("state-q", core.known(0.0), core.known(0.0), database=ref)

        # The recorded identity was captured earlier; the real file has since
        # drifted (e.g. a later, unrelated write) by the time we publish.
        enc_path.write_text("bytes-changed-after-evaluation-was-assembled")

        record = adoption.publish(ev, None, self.path, _policy_with_root(root))

        self.assertEqual(record["decision"], "best")
        self.assertEqual(record["acceptedArtifactReady"], core.known(0))
        pointers = adoption.load_pointers(self.path)
        self.assertIsNone(pointers["delivery"])
        self.assertEqual(pointers["best"]["candidateId"], "state-q")

    def test_missing_enc_dat_directory_blocks_delivery(self):
        root = Path(self.temp.name)
        ref, _enc, dat_dir = _write_database_files(root)
        ev = _evaluation("state-r", core.known(0.0), core.known(0.0), database=ref)

        for child in dat_dir.iterdir():
            child.unlink()
        dat_dir.rmdir()

        record = adoption.publish(ev, None, self.path, _policy_with_root(root))
        self.assertEqual(record["decision"], "best")
        self.assertEqual(record["acceptedArtifactReady"], core.known(0))
        pointers = adoption.load_pointers(self.path)
        self.assertIsNone(pointers["delivery"])

    def test_missing_campaign_root_blocks_delivery_but_still_allows_best(self):
        root = Path(self.temp.name)
        ref, _enc, _dat = _write_database_files(root)
        ev = _evaluation("state-s", core.known(0.0), core.known(0.0), database=ref)

        record = adoption.publish(ev, None, self.path, DEFAULT_POLICY)  # no campaignRoot

        self.assertEqual(record["decision"], "best")
        self.assertFalse(core.is_known(record["acceptedArtifactReady"]))
        self.assertEqual(record["acceptedArtifactReady"]["unknown"], "missing-campaign-root")
        pointers = adoption.load_pointers(self.path)
        self.assertIsNone(pointers["delivery"])

    def test_no_database_ref_never_needs_campaign_root(self):
        ev = _evaluation("state-t", core.known(0.0), core.known(0.0))  # no database at all
        record = adoption.publish(ev, None, self.path, DEFAULT_POLICY)
        self.assertEqual(record["decision"], "best")
        self.assertEqual(record["acceptedArtifactReady"]["unknown"], "missing-database-ref")

    # -- Idempotency: original decision/pointersAfter reported, never current state --

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

    def test_replay_after_working_has_moved_reports_original_snapshot(self):
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        first = adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)
        self.assertEqual(first["decision"], "best")

        ev_b = _evaluation("state-b", core.known(-0.01), core.known(-0.005), parent_state_id="state-a")
        adoption.publish(ev_b, "state-a", self.path, DEFAULT_POLICY)

        # Current pointers have moved on to state-b/version 2.
        current = adoption.load_pointers(self.path)
        self.assertEqual(current["working"]["candidateId"], "state-b")
        self.assertEqual(current["version"], 2)

        # Replaying ev_a must still report ITS OWN original decision and
        # pointers-after snapshot (state-a, version 1) -- not today's.
        replay = adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)
        self.assertEqual(replay["decision"], "best")
        self.assertEqual(replay["reason"], "idempotent-replay")
        self.assertEqual(replay["pointersAfter"]["version"], 1)
        self.assertEqual(replay["pointersAfter"]["working"]["candidateId"], "state-a")
        self.assertEqual(replay["pointersAfter"]["best"]["candidateId"], "state-a")
        self.assertIsNone(replay["pointersAfter"]["delivery"])
        self.assertEqual(replay["pointersBefore"]["version"], 0)
        self.assertIsNone(replay["pointersBefore"]["working"])
        self.assertIsNone(replay["pointersBefore"]["best"])

        # And the replay itself must not have touched anything.
        after_replay = adoption.load_pointers(self.path)
        self.assertEqual(after_replay["working"]["candidateId"], "state-b")
        self.assertEqual(after_replay["version"], 2)

    def test_late_evaluation_after_newer_best_cannot_overwrite_best(self):
        ev_a = _evaluation("state-a", core.known(-0.05), core.known(-0.02))
        adoption.publish(ev_a, None, self.path, DEFAULT_POLICY)

        ev_b = _evaluation("state-b", core.known(-0.01), core.known(-0.005), parent_state_id="state-a")
        adoption.publish(ev_b, "state-a", self.path, DEFAULT_POLICY)

        # A late result still carrying the original (now stale) base, even
        # though its own numbers would have beaten state-b.
        ev_late = _evaluation("state-late", core.known(0.0), core.known(0.0),
                               parent_state_id="state-a", tag="late")
        record = adoption.publish(ev_late, "state-a", self.path, DEFAULT_POLICY)

        self.assertEqual(record["decision"], "refused")
        self.assertEqual(record["reason"], "stale-base")
        pointers = adoption.load_pointers(self.path)
        self.assertEqual(pointers["best"]["candidateId"], "state-b")
        self.assertEqual(pointers["working"]["candidateId"], "state-b")


if __name__ == "__main__":
    unittest.main()
