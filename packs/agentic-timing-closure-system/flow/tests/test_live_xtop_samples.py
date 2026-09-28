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



REQUIRED = ["func_ssg_rcworst_m40", "func_ssg_rcworst_125", "func_ffg_cbest_m40", "func_ffg_cbest_125"]


def _seal_live_w03(required=REQUIRED, gain_text=None):
    """Seal the real w03 session: its ops and gain logs verbatim, dumps of its own instances."""
    import tempfile
    from session_fixtures import make_base_ref
    base_ref = make_base_ref(slot="w03", instances=("rm_assigns_buf_ifu_axi_araddr_4", "swerv_ifu/mem_ctl/g37835"),
                             nets=(), targets=["func_ssg_rcworst_125|setup|ifu_axi_araddr[4]"],
                             target_pins=["rm_assigns_buf_ifu_axi_araddr_4/Z"])
    before = {"rm_assigns_buf_ifu_axi_araddr_4": "BUFFD1BWP40P140HVT", "swerv_ifu/mem_ctl/g37835": "IOA21D4BWP35P140LVT"}
    after = {"rm_assigns_buf_ifu_axi_araddr_4": "BUFFD4BWP30P140ULVT", "swerv_ifu/mem_ctl/g37835": "IOA21D4BWP35P140ULVT"}
    with tempfile.TemporaryDirectory() as tmp:
        paths = {}
        for name, mapping in (("before.dump", before), ("after.dump", after)):
            paths[name] = str(Path(tmp) / name)
            Path(paths[name]).write_text("".join(f"{k} {v}\n" for k, v in mapping.items()))
        result_refs = {"beforeDump": paths["before.dump"], "afterDump": paths["after.dump"],
                       "evidence": {"taintedJson": None, "transcriptTaint": "clean", "ecoOutput": True},
                       "fillerPatterns": ["FILL*", "DCAP*"], "requiredScenarios": required}
        return contributions.seal_session(base_ref, result_refs, live.LIVE_OPS_JSONL_W03,
                                          live.LIVE_GAIN_JSONL_W03 if gain_text is None else gain_text)


class LiveSessionValueTest(unittest.TestCase):
    """Fix round 1: a repair in one scenario is not hidden behind another scenario's worst endpoint."""

    def test_the_w03_repair_in_ssg_125_has_value(self):
        contribution = _seal_live_w03()
        self.assertTrue(contribution["admissible"], contribution["refusals"])
        self.assertEqual(contribution["kind"], "xtop-session")
        # ssg_125 setup -0.0851 -> -0.0828; the total row (ssg_m40's -0.1567) did not move.
        self.assertAlmostEqual(contribution["value"], 0.0023, places=9)
        detail = contribution["valueDetail"]
        self.assertEqual(detail["bestScenario"], {"setup": "func_ssg_rcworst_125"})
        self.assertEqual(detail["wnsGain"]["setup"], 0.0)
        # ssg_m40's worst endpoint is unchanged but its TNS improved: WNS equal, TNS better.
        self.assertEqual(detail["improvingScenarios"], {"setup": ["func_ssg_rcworst_125", "func_ssg_rcworst_m40"]})
        self.assertAlmostEqual(detail["scenarioGain"]["setup"]["func_ssg_rcworst_125"]["tnsGain"], 0.0563, places=9)

    def test_no_scenario_improving_is_no_predicted_gain(self):
        # The same session read only against ssg_m40, whose worst endpoint the repair did not touch
        # and whose TNS improved: that still counts as a gain (WNS equal, TNS better).
        self.assertTrue(_seal_live_w03(required=["func_ssg_rcworst_m40"])["admissible"])
        # ffg scenarios are not violating on setup: nothing to improve there.
        contribution = _seal_live_w03(required=["func_ffg_cbest_m40", "func_ffg_cbest_125"])
        self.assertIn("no-predicted-gain", {r["code"] for r in contribution["refusals"]})

    def test_an_opposite_scenario_worsening_breaks_the_opposite_check(self):
        text = live.LIVE_GAIN_JSONL_W03
        worse = "  func_ssg_rcworst_125     4587      4587         +0    |    -0.1801    -0.1799    -0.0002"
        lines = text.splitlines()
        last_mutation = max(i for i, line in enumerate(lines) if '"kind":"mutation"' in line)
        lines[last_mutation] = lines[last_mutation].replace(
            "  func_ssg_rcworst_125     4587      4587         +0    |    -0.1799    -0.1799    +0.0000", worse)
        self.assertNotEqual(lines[last_mutation], live.LIVE_GAIN_JSONL_W03.splitlines()[last_mutation])
        contribution = _seal_live_w03(gain_text="\n".join(lines) + "\n")
        codes = {r["code"] for r in contribution["refusals"]}
        self.assertIn("breaks-opposite-check", codes)

if __name__ == "__main__":
    unittest.main()
