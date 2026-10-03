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

from atcs import adapters  # noqa: E402
from atcs import core  # noqa: E402
from atcs import integration  # noqa: E402
from atcs import reports  # noqa: E402
from atcs import verification  # noqa: E402

import fixtures  # noqa: E402


class RequireHelperTest(unittest.TestCase):
    """`core.require` -- final review (mechanical dedupe): the one shared
    helper every `atcs` module used to define its own private, byte-identical
    copy of (`contributions.py`, `experience.py`, `lifecycle.py`,
    `residual.py`, `state.py`, `workspaces.py`)."""

    def test_returns_the_present_value(self):
        self.assertEqual(core.require({"a": 1}, "a", "thing"), 1)

    def test_missing_key_raises_missing_input_named_by_label_and_key(self):
        with self.assertRaises(core.AtcsError) as ctx:
            core.require({"a": 1}, "b", "thing")
        self.assertEqual(ctx.exception.code, "missing-input")
        self.assertEqual(ctx.exception.detail, "thing.b")

    def test_non_dict_mapping_is_treated_like_a_missing_key_not_a_typeerror(self):
        with self.assertRaises(core.AtcsError) as ctx:
            core.require(["not", "a", "dict"], "a", "thing")
        self.assertEqual(ctx.exception.code, "missing-input")


class SharedConstantsDedupeTest(unittest.TestCase):
    """Shared Tcl safety constants and dynamic scenario-list validation."""

    def test_required_scenarios_preserves_site_order(self):
        self.assertEqual(core.required_scenarios(["slow_setup", "fast_hold"]), ("slow_setup", "fast_hold"))

    def test_required_scenarios_refuses_duplicates(self):
        with self.assertRaises(core.AtcsError) as ctx:
            core.required_scenarios(["slow_setup", "slow_setup"])
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_unsafe_tcl_chars_includes_backslash(self):
        self.assertIn("\\", core.UNSAFE_TCL_CHARS)
        self.assertIs(adapters._UNSAFE_TCL_CHARS, core.UNSAFE_TCL_CHARS)
        self.assertIs(integration._UNSAFE_TCL_CHARS, core.UNSAFE_TCL_CHARS)

    def test_tcl_safe_rejects_a_backslash_the_same_way_integration_does(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.tcl_safe("evil\\name", "value")
        self.assertEqual(ctx.exception.code, "unsafe-name")


class IsTclUnsafeTest(unittest.TestCase):
    """`core.is_tcl_unsafe` -- final review (I7, bus-bit-safe names): the one shared
    predicate `adapters.tcl_safe`/`integration._validate_tcl_value` (the emitters)
    and `workspaces._collect_problems` (the Reader-side pre-flight) both consult, so
    a name a tool would refuse is never admitted by a Reader first."""

    def test_plain_name_is_safe_in_both_modes(self):
        self.assertFalse(core.is_tcl_unsafe("U1/BUF1"))
        self.assertFalse(core.is_tcl_unsafe("U1/BUF1", allow_brackets=True))

    def test_brackets_are_unsafe_by_default(self):
        self.assertTrue(core.is_tcl_unsafe("bus[3]"))

    def test_brackets_are_safe_when_allowed(self):
        self.assertFalse(core.is_tcl_unsafe("bus[3]", allow_brackets=True))

    def test_braces_stay_unsafe_even_when_brackets_are_allowed(self):
        self.assertTrue(core.is_tcl_unsafe("{bus}", allow_brackets=True))

    def test_backslash_stays_unsafe_even_when_brackets_are_allowed(self):
        self.assertTrue(core.is_tcl_unsafe("bus\\3", allow_brackets=True))

    def test_dollar_quote_and_semicolon_stay_unsafe_even_when_brackets_are_allowed(self):
        for value in ("bus$3", 'bus"3', "bus;3"):
            with self.subTest(value=value):
                self.assertTrue(core.is_tcl_unsafe(value, allow_brackets=True))

    def test_whitespace_stays_unsafe_in_both_modes(self):
        self.assertTrue(core.is_tcl_unsafe("bus 3"))
        self.assertTrue(core.is_tcl_unsafe("bus 3", allow_brackets=True))

    def test_a_non_newline_control_character_is_unsafe_in_both_modes(self):
        """Neither mode previously refused a bare control character (e.g. SOH) that is
        not itself whitespace and not in the old fixed punctuation set -- both do now."""
        self.assertTrue(core.is_tcl_unsafe("bus\x013"))
        self.assertTrue(core.is_tcl_unsafe("bus\x013", allow_brackets=True))


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

    # --- C1 (final review, probe_negzero.py): a "-0.00"-style negative-zero
    # WNS (or any other non-negative WNS) must never be a known, goal-passing
    # value while that mode's own NUM says it has violations. ---

    def test_negative_zero_wns_with_positive_violations_is_unknown(self):
        text = fixtures.global_report("-0.00", "-0.01", 3, "-0.02", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertFalse(core.is_known(result["setup"]["wns"]))
        # `violations` itself is still a known, trustworthy count -- only
        # `wns` is downgraded.
        self.assertEqual(result["setup"]["violations"], {"value": 3})
        # The Goal's own `>= 0.0` reading can therefore never fire on this
        # value: there is no known value left to compare at all.
        with self.assertRaises(core.AtcsError):
            core.value_of(result["setup"]["wns"])

    def test_true_zero_wns_with_positive_violations_is_unknown(self):
        text = fixtures.global_report("0.00", "-0.02", 5, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertFalse(core.is_known(result["setup"]["wns"]))

    def test_positive_wns_with_positive_violations_is_unknown(self):
        text = fixtures.global_report("0.01", "-0.01", 2, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertFalse(core.is_known(result["setup"]["wns"]))

    def test_negative_wns_with_positive_violations_stays_known(self):
        """A genuinely negative WNS consistent with NUM>0 is never downgraded."""
        text = fixtures.global_report("-0.05", "-0.10", 3, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertEqual(result["setup"]["wns"], {"value": -0.05})

    def test_negative_zero_wns_with_zero_violations_is_unknown(self):
        """Minor (final fix batch C): the OTHER contradictory sign -- `NUM 0` (no
        violating paths) but a displayed NEGATIVE `WNS -0.00` -- is just as
        untrustworthy as `NUM>0` with a non-negative WNS. `float("-0.00") == -0.0`
        and `-0.0 >= 0.0` is `True` in Python, so this could not be caught by the
        existing `violations > 0 and wns >= 0.0` check (`violations` here is `0`,
        not `> 0`) -- a distinct rule is needed for this direction."""
        text = fixtures.global_report("-0.00", "0.00", 0, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertFalse(core.is_known(result["setup"]["wns"]))
        self.assertEqual(result["setup"]["violations"], {"value": 0})

    def test_negative_nonzero_wns_with_zero_violations_is_also_unknown(self):
        """Same contradiction, not just the `-0.00` display case: any displayed
        negative WNS paired with a confirmed `NUM 0` is untrustworthy."""
        text = fixtures.global_report("-0.04", "0.00", 0, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertFalse(core.is_known(result["setup"]["wns"]))

    def test_true_zero_wns_with_zero_violations_stays_known(self):
        """`WNS 0.00`/`NUM 0` (no leading minus sign) is NOT contradictory -- a
        clean mode's own table-form zero, never downgraded."""
        text = fixtures.global_report("0.00", "0.00", 0, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertEqual(result["setup"]["wns"], {"value": 0.0})

    def test_zero_wns_with_zero_violations_stays_known(self):
        """NUM==0 (not >0) never triggers the cross-check -- a genuinely clean
        mode may legitimately show a WNS of exactly 0.0."""
        text = fixtures.global_report("0.00", "0.00", 0, "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertEqual(result["setup"]["wns"], {"value": 0.0})

    def test_unparsable_violations_count_makes_wns_unknown_too(self):
        """An unresolved NUM leaves nothing to cross-check a non-negative WNS
        against, so WNS cannot be trusted either -- never a known value."""
        text = fixtures.global_report("0.00", "-0.02", "N/A", "-0.01", "0.00", 0)
        result = reports.parse_global_timing(text)
        self.assertFalse(core.is_known(result["setup"]["violations"]))
        self.assertFalse(core.is_known(result["setup"]["wns"]))


class ParsePathReportTest(unittest.TestCase):
    def test_complete_when_below_cap(self):
        text = fixtures.path_report([("epA", -0.1), ("epB", -0.2)], "setup")
        result = reports.parse_path_report(text, "setup", max_paths=10)
        self.assertTrue(result["complete"])
        self.assertEqual(len(result["paths"]), 2)
        self.assertEqual(result["paths"][0]["endpoint"], "epA")
        self.assertEqual(result["paths"][0]["startpoint"], "U_START_0")
        self.assertEqual(result["paths"][0]["pathGroup"], "core_clock")
        self.assertEqual(core.value_of(result["paths"][0]["slack"]), -0.1)
        self.assertIs(result["paths"][0]["violated"], True)

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
        self.assertEqual(core.value_of(result["paths"][0]["slack"]), -0.3)

    def test_duplicate_endpoint_two_clock_groups_still_raises(self):
        # One endpoint under two different real clock groups would need two
        # keys with no order-independent way to tell which is which; the
        # real corpus never shows it, so it stays refused.
        text = fixtures.path_report(
            [("epA", -0.1), ("epA", -0.3)], "setup", groups=["core_clock", "other_clock"]
        )
        with self.assertRaises(core.AtcsError) as ctx:
            reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(ctx.exception.code, "duplicate-check")

    def test_real_block_shape_removal_check_and_clock_check_on_one_endpoint(self):
        # Retained failure (GitHub issue #63): the real hold.rpt reports one
        # endpoint once as a removal check in `**async_default**` (/CDN) and,
        # repeated per `-nworst`, as the data hold check in `core_clock`
        # (/SE). Two checks on one register: both kept, worst slack per
        # group, and each key is the same whichever group the report lists
        # first, so baseline and candidate reports key the check alike.
        endpoint = "swerv_dmi_wrapper_i_dmi_jtag_to_core_sync_rden_reg_0_"
        rows = [(endpoint, -0.05), (endpoint, -0.4), (endpoint, -0.2)]
        groups = ["**async_default**", "core_clock", "core_clock"]
        keyed = []
        for order in (rows, rows[::-1]):
            order_groups = groups if order is rows else groups[::-1]
            text = fixtures.path_report(order, "hold", groups=order_groups)
            result = reports.parse_path_report(text, "hold", max_paths=10)
            self.assertTrue(result["complete"])
            by_group = {row["pathGroup"]: row for row in result["paths"]}
            self.assertEqual(set(by_group), {"**async_default**", "core_clock"})
            removal, clocked = by_group["**async_default**"], by_group["core_clock"]
            self.assertEqual(removal["endpoint"], f"{endpoint}@**async_default**")
            self.assertEqual(removal["rawEndpoint"], endpoint)
            self.assertEqual(core.value_of(removal["slack"]), -0.05)
            self.assertEqual(clocked["endpoint"], endpoint)
            self.assertEqual(clocked["rawEndpoint"], endpoint)
            self.assertEqual(core.value_of(clocked["slack"]), -0.4)
            keyed.append({row["endpoint"] for row in result["paths"]})
        self.assertEqual(keyed[0], keyed[1])

    def test_reserved_group_alone_keeps_its_suffixed_key(self):
        # The key must not depend on whether the endpoint's clock-group check
        # is also present: a removal check alone keys exactly as it does
        # beside the clock-group check.
        text = fixtures.path_report([("epA", -0.2)], "hold", groups=["**async_default**"])
        result = reports.parse_path_report(text, "hold", max_paths=10)
        self.assertEqual([row["endpoint"] for row in result["paths"]], ["epA@**async_default**"])
        self.assertEqual(result["paths"][0]["rawEndpoint"], "epA")

    def test_duplicate_endpoint_unknown_group_still_raises(self):
        # A repeated endpoint where at least one of the colliding rows has
        # no parseable `Path Group:` line at all stays the genuinely
        # ambiguous case: an unresolved group can never prove the rows are
        # the same check or two distinct ones.
        text = """  Startpoint: U_START_0
  Endpoint: epA
  Path Group: core_clock
  Path Type: max
  slack (VIOLATED) -0.1

  Startpoint: U_START_1
  Endpoint: epA
  Path Type: max
  slack (VIOLATED) -0.3

"""
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
        # must still parse as a violated path, not fail as malformed. The
        # annotated row's own slack Measure is `unknown` (the displayed
        # number is not trustworthy at this precision), but `violated`
        # stays a known `True`, sourced from PT's own classification, not
        # the numeric sign (`float("-0.0") < 0` is `False`).
        text = fixtures.path_report(
            [("epA", -0.0), ("epB", -0.2)],
            "setup",
            slack_annotations=[": increase significant digits", ""],
        )
        result = reports.parse_path_report(text, "setup", max_paths=10)
        self.assertEqual(len(result["paths"]), 2)
        by_endpoint = {p["endpoint"]: p for p in result["paths"]}
        self.assertFalse(core.is_known(by_endpoint["epA"]["slack"]))
        self.assertIs(by_endpoint["epA"]["violated"], True)
        self.assertEqual(core.value_of(by_endpoint["epB"]["slack"]), -0.2)
        self.assertIs(by_endpoint["epB"]["violated"], True)

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
