"""Tests for `atcs.core` (canonical digest, artifact I/O) and `atcs.reports`
(PrimeTime report parsers).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_core.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import reports  # noqa: E402

import fixtures  # noqa: E402


class CanonicalDigestTest(unittest.TestCase):
    def test_digest_stable_under_key_order(self):
        a = {"top": "swerv", "stage": "postroute", "sdc": ["x.sdc"]}
        b = {"sdc": ["x.sdc"], "stage": "postroute", "top": "swerv"}
        self.assertEqual(core.digest(a), core.digest(b))

    def test_digest_changes_with_content(self):
        self.assertNotEqual(core.digest({"a": 1}), core.digest({"a": 2}))

    def test_digest_is_twenty_hex_chars(self):
        value = core.digest({"a": 1})
        self.assertEqual(len(value), 20)
        int(value, 16)  # raises ValueError if not hex

    def test_stamp_sets_schema_and_id_excluding_id_itself(self):
        stamped = core.stamp("design-state", {"top": "swerv"})
        self.assertEqual(stamped["schema"], "atcs.design-state/1")
        without_id = dict(stamped)
        without_id.pop("id")
        self.assertEqual(stamped["id"], core.digest(without_id))


class ArtifactIoTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "nested" / "artifact.json"

    def test_write_artifact_round_trips_and_returns_sha256_of_bytes(self):
        obj = core.stamp("design-state", {"top": "swerv", "stage": "postroute"})
        returned_sha = core.write_artifact(self.path, obj)

        written_bytes = self.path.read_bytes()
        self.assertEqual(returned_sha, hashlib.sha256(written_bytes).hexdigest())

        read_back = core.read_artifact(self.path, "design-state")
        self.assertEqual(read_back, obj)

    def test_write_artifact_is_atomic_on_a_failed_replace(self):
        first = core.stamp("design-state", {"top": "first"})
        core.write_artifact(self.path, first)
        original_bytes = self.path.read_bytes()

        second = core.stamp("design-state", {"top": "second"})
        with mock.patch("atcs.core.os.replace", side_effect=OSError("simulated crash")):
            with self.assertRaises(OSError):
                core.write_artifact(self.path, second)

        # The failed write must never have touched the original file, and must
        # not leave a stray temp file with the target's basename pattern lying
        # around unexplained (os.replace itself is what we're not calling).
        self.assertEqual(self.path.read_bytes(), original_bytes)
        leftover_tmp = list(self.path.parent.glob(f"{self.path.name}.tmp-*"))
        self.assertEqual(leftover_tmp, [])

    def test_read_artifact_rejects_wrong_kind(self):
        obj = core.stamp("design-state", {"top": "swerv"})
        core.write_artifact(self.path, obj)

        with self.assertRaises(core.AtcsError) as ctx:
            core.read_artifact(self.path, "input-readiness")
        self.assertEqual(ctx.exception.code, "schema-mismatch")

    def test_read_artifact_rejects_tampered_identity(self):
        obj = core.stamp("design-state", {"top": "swerv"})
        core.write_artifact(self.path, obj)

        import json
        tampered = json.loads(self.path.read_text())
        tampered["top"] = "tampered-without-recomputing-id"
        self.path.write_text(json.dumps(tampered))

        with self.assertRaises(core.AtcsError) as ctx:
            core.read_artifact(self.path, "design-state")
        self.assertEqual(ctx.exception.code, "identity-mismatch")


class MeasureHelperTest(unittest.TestCase):
    def test_known_and_unknown_round_trip(self):
        self.assertTrue(core.is_known(core.known(0)))
        self.assertFalse(core.is_known(core.unknown("no data")))
        self.assertEqual(core.value_of(core.known(3.5)), 3.5)

    def test_value_of_unknown_raises(self):
        with self.assertRaises(core.AtcsError) as ctx:
            core.value_of(core.unknown("no data"))
        self.assertEqual(ctx.exception.code, "unknown-value")

    def test_check_key_format(self):
        self.assertEqual(core.check_key("func_ssg_rcworst_m40", "setup", "reg/q"), "func_ssg_rcworst_m40|setup|reg/q")


class ParseGlobalTimingTest(unittest.TestCase):
    def test_true_zero_is_known_zero(self):
        text = fixtures.global_report(0.00, 0.00, 0, 0.00, 0.00, 0)
        result = reports.parse_global_timing(text)
        self.assertEqual(result["setup"]["wns"], {"value": 0.0})
        self.assertEqual(result["setup"]["tns"], {"value": 0.0})
        self.assertEqual(result["setup"]["violations"], {"value": 0})
        self.assertEqual(result["hold"]["wns"], {"value": 0.0})

    def test_explicit_no_violations_line_is_known_zero(self):
        text = "Setup violations\nNo setup violations found.\n\nHold violations\nNo hold violations found.\n"
        result = reports.parse_global_timing(text)
        self.assertEqual(result["setup"]["wns"], {"value": 0.0})
        self.assertEqual(result["hold"]["violations"], {"value": 0})

    def test_missing_hold_section_is_unknown(self):
        text = fixtures.global_report(-0.5, -1.2, 3, 0.0, 0.0, 0)
        # Strip everything from "Hold violations" onward to simulate a report
        # that never generated a hold section at all.
        setup_only = text.split("Hold violations")[0]
        result = reports.parse_global_timing(setup_only)
        self.assertEqual(result["setup"]["wns"], {"value": -0.5})
        self.assertIn("unknown", result["hold"]["wns"])
        self.assertIn("unknown", result["hold"]["tns"])
        self.assertIn("unknown", result["hold"]["violations"])

    def test_inf_and_nan_are_unknown(self):
        text = fixtures.global_report("-inf", -1.2, 3, "nan", 0.0, 0)
        result = reports.parse_global_timing(text)
        self.assertIn("unknown", result["setup"]["wns"])
        self.assertIn("unknown", result["hold"]["wns"])
        # Sibling fields in the same well-formed block are unaffected.
        self.assertEqual(result["setup"]["tns"], {"value": -1.2})


class ParsePathReportTest(unittest.TestCase):
    def test_complete_when_below_cap(self):
        text = fixtures.path_report([("epA", -0.1), ("epB", -0.2)], "setup")
        result = reports.parse_path_report(text, "setup", max_paths=10)
        self.assertTrue(result["complete"])
        self.assertEqual(len(result["paths"]), 2)
        self.assertEqual(result["paths"][0]["endpoint"], "epA")
        self.assertEqual(result["paths"][0]["startpoint"], "U_START_0")
        self.assertEqual(result["paths"][0]["pathGroup"], "core_clock")
        self.assertEqual(result["paths"][0]["slack"], -0.1)

    def test_incomplete_when_count_equals_max_paths(self):
        rows = [(f"ep{i}", -0.1) for i in range(5)]
        text = fixtures.path_report(rows, "setup")
        result = reports.parse_path_report(text, "setup", max_paths=5)
        self.assertFalse(result["complete"])
        self.assertEqual(len(result["paths"]), 5)

    def test_incomplete_when_truncated_mid_block(self):
        text = fixtures.path_report([("epA", -0.1)], "setup")
        # Cut the text off right after "Path Group:" so the trailing block
        # never reaches its slack line — simulates the tool being killed
        # mid-write.
        cut_point = text.index("Path Type:")
        truncated = text[:cut_point]
        result = reports.parse_path_report(truncated, "setup", max_paths=10)
        self.assertFalse(result["complete"])
        self.assertEqual(result["paths"], [])

    def test_duplicate_endpoint_same_group_keeps_worst_slack(self):
        # A real `-nworst>1` report (this Pack's own default,
        # `atcs.adapters.DEFAULT_NWORST = 20`) lists several of an
        # endpoint's worst paths, all in the same path group — confirmed
        # against the real Foundation/B_lazy corpus. The worst (most
        # negative) slack is kept; the less-critical repeat contributes
        # nothing.
        text = fixtures.path_report([("epA", -0.1), ("epA", -0.3), ("epA", -0.2)], "setup")
        result = reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(len(result["paths"]), 1)
        self.assertEqual(result["paths"][0]["endpoint"], "epA")
        self.assertEqual(result["paths"][0]["slack"], -0.3)

    def test_duplicate_endpoint_different_group_raises(self):
        # Two rows for the same endpoint that disagree on path group are
        # genuinely ambiguous (this Pack's check key omits path group) and
        # still refuse the whole report.
        text = fixtures.path_report(
            [("epA", -0.1), ("epA", -0.3)], "setup", groups=["core_clock", "other_clock"]
        )
        with self.assertRaises(core.AtcsError) as ctx:
            reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(ctx.exception.code, "duplicate-check")

    def test_incomplete_when_raw_block_count_reaches_cap_despite_dedup(self):
        # A real report's `-max_paths` cap bounds the tool's own raw path
        # count, not the number of distinct endpoints they land on: ten
        # raw blocks all converging on one endpoint, with `max_paths=10`,
        # must still report `complete=False` even though only one
        # deduplicated path survives.
        text = fixtures.path_report([("epA", -0.1 * (i + 1)) for i in range(10)], "setup")
        result = reports.parse_path_report(text, "setup", max_paths=10)
        self.assertFalse(result["complete"])
        self.assertEqual(len(result["paths"]), 1)

    def test_annotated_violated_slack_is_parsed_not_refused(self):
        # Real PT reports append an annotation to the slack line's own
        # parenthetical whenever a violation rounds to a displayed -0.00
        # (confirmed against the real Foundation/B_lazy corpus) -- this
        # must still parse as a violated path, not fail as malformed.
        text = fixtures.path_report(
            [("epA", -0.0), ("epB", -0.2)],
            "setup",
            slack_annotations=[": increase significant digits", ""],
        )
        result = reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(len(result["paths"]), 2)
        self.assertEqual({p["endpoint"]: p["slack"] for p in result["paths"]}, {"epA": -0.0, "epB": -0.2})

    def test_path_type_mismatch_raises_identity_mismatch(self):
        # A hold report (Path Type: min) fed in as mode="setup".
        text = fixtures.path_report([("epA", -0.1)], "hold")
        with self.assertRaises(core.AtcsError) as ctx:
            reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(ctx.exception.code, "identity-mismatch")

    def test_non_finite_slack_raises_malformed_report(self):
        # "1e400" is within the slack regex's character class (digits/e/+)
        # but overflows float parsing to +inf — a report grammar Python's
        # own float() would otherwise accept silently.
        text = fixtures.path_report([("epA", "1e400")], "setup")
        with self.assertRaises(core.AtcsError) as ctx:
            reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(ctx.exception.code, "malformed-report")


class ParseCheckTimingTest(unittest.TestCase):
    def test_explicit_count_is_known(self):
        text = fixtures.check_timing_report(3)
        result = reports.parse_check_timing(text)
        self.assertEqual(result["unconstrainedEndpoints"], {"value": 3})

    def test_explicit_zero_is_known_zero(self):
        text = fixtures.check_timing_report(0)
        result = reports.parse_check_timing(text)
        self.assertEqual(result["unconstrainedEndpoints"], {"value": 0})

    def test_missing_line_is_unknown(self):
        result = reports.parse_check_timing("some unrelated report text\n")
        self.assertIn("unknown", result["unconstrainedEndpoints"])

    def test_negative_count_is_unknown(self):
        result = reports.parse_check_timing("There are -3 endpoints which are not constrained\n")
        self.assertIn("unknown", result["unconstrainedEndpoints"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
