"""Judge rules, legality, ranking and the round decision (stdlib only)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

from pixelopt import core, rounds  # noqa: E402


def _goal(**over):
    values = {"outline_w_um": 20.0, "outline_h_um": 40.0, "ratio_target_pct": 9.0,
              "load_allowance_pct": 5.0, "t_min_pct": 5.0, "t_max_pct": 30.0,
              "cst_ceiling_ff": 0.0}
    values.update(over.pop("values", {}))
    g = {"values": values, "topologyMoves": "off", "convergeBandPct": 0.02,
         "ratioDefinition": "broad"}
    g.update(over)
    return g


def _legal_values(**over):
    v = {"pixel_receipt_error_count": 0, "pixel_drc_authority_1x1": 0,
         "pixel_drc_authority_2x2": 0, "pixel_drc_authority_3x3": 0,
         "pixel_interact_violations": 0, "pixel_lvs_correct": 1,
         "pixel_channels_changed": 0, "pixel_undeclared_change_count": 0,
         "pixel_coupling_over_limit_count": 0, "pixel_load_over_limit_count": 0,
         "pixel_t_judged_pct": 10.0, "pixel_outline_w_um": 19.0,
         "pixel_outline_h_um": 39.0, "pixel_ratio_judged_pct": 8.0}
    v.update(over)
    return v


class RuleResultsTest(unittest.TestCase):
    def test_all_pass(self):
        res = rounds.rule_results(_legal_values(), _goal())
        self.assertTrue(all(v == "PASS" for v in res.values()))

    def test_null_subject_is_unknown(self):
        res = rounds.rule_results(_legal_values(pixel_lvs_correct=None), _goal())
        self.assertEqual(res["lvs-correct"], "UNKNOWN")

    def test_transmittance_not_declared(self):
        g = _goal(values={"t_min_pct": None, "t_max_pct": None})
        res = rounds.rule_results(_legal_values(), g)
        self.assertEqual(res["transmittance-above-min"], "NOT_DECLARED")
        self.assertEqual(res["transmittance-below-max"], "NOT_DECLARED")

    def test_fail(self):
        res = rounds.rule_results(_legal_values(pixel_drc_authority_3x3=2), _goal())
        self.assertEqual(res["drc-authority-3x3-clean"], "FAIL")

    def test_accepts_reader_rows(self):
        rows = [{"type": "pixel_lvs_correct", "unit": "flag", "value": 1}]
        res = rounds.rule_results(rows, _goal())
        self.assertEqual(res["lvs-correct"], "PASS")


class LegalTest(unittest.TestCase):
    def test_legal(self):
        self.assertTrue(rounds.legal(_legal_values(), _goal()))

    def test_illegal_on_hard_failure(self):
        self.assertFalse(rounds.legal(_legal_values(pixel_load_over_limit_count=1), _goal()))

    def test_not_declared_edge_is_no_bar(self):
        g = _goal(values={"t_min_pct": None, "t_max_pct": None})
        self.assertTrue(rounds.legal(_legal_values(), g))

    def test_goal_rules_do_not_affect_legality(self):
        # ratio and outline above target: still legal (those are Goal rules)
        self.assertTrue(rounds.legal(
            _legal_values(pixel_ratio_judged_pct=50.0, pixel_outline_w_um=99.0), _goal()))


class RankTest(unittest.TestCase):
    def test_legal_before_illegal(self):
        legal = rounds.rank_key(_legal_values(), _goal())
        illegal = rounds.rank_key(_legal_values(pixel_lvs_correct=0), _goal())
        self.assertLess(legal, illegal)

    def test_more_outline_met_first(self):
        both = rounds.rank_key(_legal_values(pixel_outline_w_um=19, pixel_outline_h_um=39), _goal())
        one = rounds.rank_key(_legal_values(pixel_outline_w_um=19, pixel_outline_h_um=99), _goal())
        self.assertLess(both, one)

    def test_lower_ratio_first(self):
        lo = rounds.rank_key(_legal_values(pixel_ratio_judged_pct=7.0), _goal())
        hi = rounds.rank_key(_legal_values(pixel_ratio_judged_pct=8.5), _goal())
        self.assertLess(lo, hi)


class DecideTest(unittest.TestCase):
    def _orig(self):
        return {"id": "original", "round": 0, "exploratory": False, "legal": False,
                "values": {"pixel_ratio_judged_pct": 12.0, "pixel_outline_w_um": 25.0,
                           "pixel_outline_h_um": 45.0}}

    def test_goal_met(self):
        hist = [self._orig(),
                {"id": "r1-a", "round": 1, "exploratory": False, "legal": True,
                 "values": _legal_values()}]
        d = rounds.decide(1, _goal(), hist, None, None)
        self.assertEqual(d["route"], "stop")
        self.assertEqual(d["stopReason"], "goal-met")
        self.assertTrue(d["goalMet"])
        self.assertEqual(core.validate(d, core.load_schema("round-decision")), [])

    def test_continue_when_not_met(self):
        hist = [self._orig(),
                {"id": "r1-a", "round": 1, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(1, _goal(), hist, None, None)
        self.assertEqual(d["route"], "continue")
        self.assertEqual(d["nextRound"]["round"], 2)

    def test_round_limit(self):
        hist = [self._orig(),
                {"id": "r6", "round": 6, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(6, _goal(), hist, None, None)
        self.assertEqual(d["route"], "stop")
        self.assertEqual(d["stopReason"], "round-limit")

    def test_converged(self):
        ratio = 11.0
        hist = [self._orig()]
        for rnd in (1, 2):
            hist.append({"id": "r%d" % rnd, "round": rnd, "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=ratio,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        d = rounds.decide(2, _goal(), hist, None, None)
        self.assertEqual(d["route"], "stop")
        self.assertEqual(d["stopReason"], "converged")

    def test_blocked_from_exploratory(self):
        hist = [self._orig(),
                {"id": "r6", "round": 6, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)},
                {"id": "r6-explore", "round": 6, "exploratory": True, "legal": False,
                 "values": _legal_values(pixel_ratio_judged_pct=5.0, pixel_load_over_limit_count=1,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(6, _goal(), hist, None, None)
        self.assertEqual(d["stopReason"], "blocked")

    def test_trust_radius_doubles_on_hit(self):
        hist = [self._orig(),
                {"id": "r1", "round": 1, "exploratory": False, "legal": True,
                 "predicted": {"ratioPct": {"broad": 10.0}},
                 "values": _legal_values(pixel_ratio_judged_pct=10.0,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(1, _goal(), hist, {"trustRadiusUm": 0.5, "best": None}, None)
        # reference ratio is the original 12.0; predicted gain 2.0, measured 2.0 -> double
        self.assertAlmostEqual(d["trustRadiusUm"], 1.0)

    def test_trust_radius_halves_on_miss(self):
        hist = [self._orig(),
                {"id": "r1", "round": 1, "exploratory": False, "legal": True,
                 "predicted": {"ratioPct": {"broad": 8.0}},
                 "values": _legal_values(pixel_ratio_judged_pct=11.5,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(1, _goal(), hist, {"trustRadiusUm": 0.5, "best": None}, None)
        # predicted gain 4.0, measured 0.5 < half -> halve
        self.assertAlmostEqual(d["trustRadiusUm"], 0.25)

    def test_no_legal_candidate(self):
        hist = [self._orig(),
                {"id": "r1", "round": 1, "exploratory": False, "legal": False,
                 "values": _legal_values(pixel_lvs_correct=0)}]
        d = rounds.decide(1, _goal(), hist, None, None)
        self.assertIsNotNone(d["best"])
        self.assertFalse(d["best"]["legal"])


if __name__ == "__main__":
    unittest.main()
