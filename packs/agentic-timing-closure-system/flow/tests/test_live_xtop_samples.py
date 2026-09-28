"""The first live expert sessions' XTop output (Issue #64 Task 7), read by the Pack's parsers.

`live_session_samples` holds verbatim `gain.jsonl` and probe texts from the server chain dry run
on real `postroute_final` (qual-issue64-chain-20260928). These tests pin the Contribution's
readings and its fail-reason summary to what XTop actually prints.
"""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TESTS_DIR.parent))
sys.path.insert(0, str(TESTS_DIR))

from atcs import contributions  # noqa: E402
import live_session_samples as live  # noqa: E402


def _lines():
    return [json.loads(line) for line in live.LIVE_GAIN_JSONL_W02.splitlines() if line.strip()]


class LiveGainJsonlTest(unittest.TestCase):
    def test_the_first_live_gain_log_has_the_toolkit_shape(self):
        self.assertEqual([(line["seq"], line["kind"]) for line in _lines()],
                         [(0, "reference"), (1, "mutation"), (1, "probe"), (2, "undo"), (3, "mutation"), (3, "probe")])

    def test_reference_and_mutation_readings_parse(self):
        lines = _lines()
        reference = contributions.parse_gain_summary(lines[0]["checks"]["setup"]["text"])
        self.assertEqual(reference["setup"]["total"], {"count": 281, "worst": -0.1567, "tns": -15.4228})
        self.assertEqual(reference["setup"]["scenarios"]["func_ssg_rcworst_125"],
                         {"count": 86, "worst": -0.0851, "tns": -2.7588})
        fix = contributions.parse_gain_summary(lines[4]["checks"]["setup"]["text"])
        self.assertEqual(fix["setup"]["total"]["worst"], -0.1542)
        self.assertEqual(fix["setup"]["total"]["dWorst"], 0.0025)
        self.assertEqual(fix["setup"]["total"]["tns"], -15.3131)
        undo = contributions.parse_gain_summary(lines[3]["checks"]["hold"]["text"])
        self.assertEqual(undo["hold"]["total"]["worst"], -0.2016)
        self.assertEqual(undo["hold"]["total"]["dTns"], 0.0)

    def test_a_probe_before_any_fix_failed_with_no_text(self):
        failed = _lines()[2]["checks"]["setup"]
        self.assertIn("-with_fail_reason", failed["command"])
        self.assertEqual((failed["code"], failed["text"]), (1, ""))
        self.assertIn("No fail reason since no fix or optimize flow have run yet.", live.LIVE_PROBE_BEFORE_FIX_LOG)

    def test_the_probe_summary_parses_beside_its_top_n_table(self):
        probe = contributions.parse_gain_summary(live.LIVE_PROBE_SETUP)
        self.assertEqual(probe["setup"]["total"]["worst"], -0.1542)
        hold = contributions.parse_gain_summary(live.LIVE_PROBE_HOLD)
        self.assertEqual(hold["hold"]["total"]["worst"], -0.1693)
        self.assertEqual(hold["hold"]["scenarios"]["func_ssg_rcworst_m40"]["dWorst"], 0.0323)
        before_fix = contributions.parse_gain_summary(live.LIVE_TOP_N_BEFORE_FIX_SETUP)
        self.assertEqual(before_fix["setup"]["total"]["worst"], -0.1567)


class LiveFailReasonTest(unittest.TestCase):
    """XTop prints fail reasons as the top-N table's last column, `<reason>:<percent>%`."""

    def test_fail_reasons_count_the_endpoints_that_name_each_reason(self):
        self.assertEqual(contributions.parse_fail_reasons(live.LIVE_PROBE_SETUP), {"not_only_pin": 10})
        self.assertEqual(contributions.parse_fail_reasons(live.LIVE_PROBE_HOLD), {"not_only_pin": 10})

    def test_every_reason_of_a_multi_reason_endpoint_counts(self):
        # Run 3 replay arm: `break_setup:66% port_net:16% no_annotated_data_net:16%` in one cell.
        self.assertEqual(contributions.parse_fail_reasons(live.LIVE_ARM_HOLD_FAIL_REASONS), {
            "break_setup": 4, "port_net": 20, "no_annotated_data_net": 14, "legal_fail_no_space_on_row": 6,
            "break_setup_of_driver": 1})

    def test_a_top_n_table_without_the_fail_reason_column_names_no_reason(self):
        self.assertEqual(contributions.parse_fail_reasons(live.LIVE_TOP_N_BEFORE_FIX_SETUP), {})

    def test_the_summary_rows_are_never_read_as_reasons(self):
        self.assertEqual(contributions.parse_fail_reasons(live.LIVE_GAIN_JSONL_W02.split("\\n")[0]), {})


if __name__ == "__main__":
    unittest.main()
