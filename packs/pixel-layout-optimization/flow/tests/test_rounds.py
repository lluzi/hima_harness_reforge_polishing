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
         "ratioDefinition": "broad", "maxRounds": 6, "convergePatienceRounds": 2}
    g.update(over)
    return g


def _legal_values(**over):
    v = {"pixel_receipt_error_count": 0, "pixel_drc_authority_1x1": 0,
         "pixel_drc_authority_2x2": 0, "pixel_drc_authority_3x3": 0,
         "pixel_interact_violations": 0, "pixel_lvs_correct": 1,
         "pixel_channels_changed": 0, "pixel_undeclared_change_count": 0,
         "pixel_coupling_over_limit_count": 0, "pixel_load_over_limit_count": 0,
         "pixel_floating_new_count": 0, "pixel_t_judged_pct": 10.0, "pixel_outline_w_um": 19.0,
         "pixel_outline_h_um": 39.0, "pixel_ratio_judged_pct": 8.0}
    v.update(over)
    return v


class BetterTest(unittest.TestCase):
    def test_a_clearly_lower_ratio_wins_whatever_the_secondary_couplings(self):
        a = _legal_values(pixel_ratio_judged_pct=8.0, pixel_ct_anode_ff=5.0, pixel_ct_lines_ff=2.0)
        b = _legal_values(pixel_ratio_judged_pct=8.5, pixel_ct_anode_ff=1.0, pixel_ct_lines_ff=0.5)
        self.assertTrue(rounds.better(a, b, _goal()))
        self.assertFalse(rounds.better(b, a, _goal()))

    def test_within_the_band_the_lower_secondary_couplings_win(self):
        a = _legal_values(pixel_ratio_judged_pct=8.010, pixel_ct_anode_ff=3.0, pixel_ct_lines_ff=0.5)
        b = _legal_values(pixel_ratio_judged_pct=8.000, pixel_ct_anode_ff=3.4, pixel_ct_lines_ff=0.6)
        self.assertTrue(rounds.better(a, b, _goal()))   # band 0.02: 8.010 ~ 8.000
        self.assertFalse(rounds.better(a, b, _goal(convergeBandPct=0.005)))

    def test_legal_always_beats_illegal(self):
        a = _legal_values(pixel_ratio_judged_pct=9.0)
        b = _legal_values(pixel_ratio_judged_pct=7.0, pixel_lvs_correct=0)
        self.assertTrue(rounds.better(a, b, _goal()))

    def test_best_legal_uses_the_band(self):
        hist = [{"id": "x", "round": 1, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=8.000, pixel_ct_anode_ff=3.4,
                                         pixel_ct_lines_ff=0.6)},
                {"id": "y", "round": 1, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=8.010, pixel_ct_anode_ff=3.0,
                                         pixel_ct_lines_ff=0.5)}]
        d = rounds.decide(1, _goal(), hist, None, None)
        self.assertEqual(d["best"]["id"], "y")


class SecondaryTargetTest(unittest.TestCase):
    def test_unstated_coupling_targets_do_not_bar_the_goal(self):
        res = rounds.rule_results(_legal_values(), _goal())
        self.assertEqual(res["anode-coupling-met"], "NOT_DECLARED")
        self.assertEqual(res["scan-coupling-met"], "NOT_DECLARED")
        hist = [{"id": "a", "round": 1, "exploratory": False, "legal": True, "values": _legal_values()}]
        self.assertTrue(rounds.decide(1, _goal(), hist, None, None)["goalMet"])

    def test_stated_coupling_targets_must_be_met_too(self):
        goal = _goal(values={"anode_coupling_max_ff": 3.0, "scan_coupling_max_ff": 1.0})
        ok = _legal_values(pixel_ct_anode_ff=2.9, pixel_ct_lines_ff=0.9)
        high = _legal_values(pixel_ct_anode_ff=3.2, pixel_ct_lines_ff=0.9)
        for vals, met in ((ok, True), (high, False)):
            hist = [{"id": "a", "round": 1, "exploratory": False, "legal": True, "values": vals}]
            d = rounds.decide(1, goal, hist, None, None)
            self.assertEqual(d["goalMet"], met)
        # a coupling target is a Goal rule, never a hard limit: the high one is still legal
        self.assertTrue(rounds.legal(high, goal))


class RepairOrdersTest(unittest.TestCase):
    def _row(self, cid, kind="candidate", base=None, **vals):
        return {"id": cid, "round": 1, "kind": kind, "base": base, "exploratory": False,
                "values": _legal_values(**vals)}

    def test_near_misses_better_than_the_best_legal_one_are_ordered_best_first(self):
        hist = [self._row("legal", pixel_ratio_judged_pct=8.5),
                self._row("near-a", pixel_ratio_judged_pct=8.0, pixel_drc_authority_1x1=2,
                          pixel_drc_authority_3x3=18),
                self._row("near-b", pixel_ratio_judged_pct=7.5, pixel_drc_authority_1x1=1,
                          pixel_drc_authority_3x3=9),
                self._row("worse", pixel_ratio_judged_pct=8.9, pixel_drc_authority_1x1=1),
                self._row("many", pixel_ratio_judged_pct=7.0, pixel_drc_authority_1x1=9),
                self._row("lvs", pixel_ratio_judged_pct=7.0, pixel_drc_authority_1x1=1,
                          pixel_lvs_correct=0)]
        orders = rounds.repair_orders(hist, _goal())
        self.assertEqual([o["candidate"] for o in orders], ["near-b", "near-a"])
        self.assertEqual(orders[0]["markers1x1"], 1)
        self.assertEqual(orders[0]["fails"], ["drc-authority-1x1-clean", "drc-authority-3x3-clean"])

    def test_a_candidate_already_repaired_is_not_ordered_again(self):
        hist = [self._row("near", pixel_ratio_judged_pct=8.0, pixel_drc_authority_1x1=1),
                self._row("r02-fix-1", kind="repair", base="near", pixel_ratio_judged_pct=8.1,
                          pixel_drc_authority_1x1=1)]
        self.assertEqual([o["candidate"] for o in rounds.repair_orders(hist, _goal())],
                         ["r02-fix-1"])


    def test_a_near_miss_that_would_meet_more_targets_is_ordered_despite_a_higher_ratio(self):
        # A live Run left a 7.13 % near-miss that met the anode target unrepaired because the best
        # legal candidate (6.98 %) had a lower ratio but missed that target.
        goal = _goal(values={"ratio_target_pct": 7.5, "anode_coupling_max_ff": 3.1})
        hist = [self._row("legal", pixel_ratio_judged_pct=6.98, pixel_ct_anode_ff=3.19),
                self._row("meets-all", pixel_ratio_judged_pct=7.13, pixel_ct_anode_ff=3.05,
                          pixel_drc_authority_1x1=3, pixel_drc_authority_3x3=20),
                self._row("misses-too", pixel_ratio_judged_pct=7.2, pixel_ct_anode_ff=3.3,
                          pixel_drc_authority_1x1=1, pixel_drc_authority_3x3=9)]
        self.assertEqual([o["candidate"] for o in rounds.repair_orders(hist, goal)],
                         ["meets-all"])


class GoalTargetsRankTest(unittest.TestCase):
    def test_a_legal_candidate_meeting_every_target_is_the_best_and_meets_the_goal(self):
        goal = _goal(values={"ratio_target_pct": 7.5, "anode_coupling_max_ff": 3.1})
        hist = [{"id": "lower", "round": 1, "kind": "candidate", "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=6.98, pixel_ct_anode_ff=3.19)},
                {"id": "meets", "round": 1, "kind": "candidate", "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=7.13, pixel_ct_anode_ff=3.05)}]
        d = rounds.decide(1, goal, hist, None, None)
        self.assertEqual(d["best"]["id"], "meets")
        self.assertTrue(d["goalMet"])

    def test_with_no_coupling_targets_the_lower_ratio_still_wins(self):
        a = _legal_values(pixel_ratio_judged_pct=6.98, pixel_ct_anode_ff=3.19)
        b = _legal_values(pixel_ratio_judged_pct=7.13, pixel_ct_anode_ff=3.05)
        self.assertTrue(rounds.better(a, b, _goal(values={"ratio_target_pct": 7.5})))


class RuleResultsTest(unittest.TestCase):
    def test_all_pass(self):
        res = rounds.rule_results(_legal_values(pixel_ct_anode_ff=1.0, pixel_ct_lines_ff=1.0),
                                  _goal(values={"anode_coupling_max_ff": 2.0,
                                                "scan_coupling_max_ff": 2.0}))
        self.assertTrue(all(v == "PASS" for v in res.values()))

    def test_a_new_floating_plate_is_a_hard_failure(self):
        self.assertFalse(rounds.legal(_legal_values(pixel_floating_new_count=1), _goal()))
        self.assertIn("no-new-floating-net", rounds.HARD_RULES)

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

    def test_converged_waits_for_patience_rounds(self):
        # Default convergePatienceRounds is 2: one stalled round is not enough evidence (that
        # eagerness is what stopped a live Run "blocked" at round 3, Project PLS-pixel8). Round 2
        # has only one round of no-improvement behind it, so the Run keeps going.
        ratio = 11.0
        hist = [self._orig()]
        for rnd in (1, 2):
            hist.append({"id": "r%d" % rnd, "round": rnd, "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=ratio,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        d = rounds.decide(2, _goal(), hist, None, None)
        self.assertEqual(d["route"], "continue")

    def test_converged_after_patience_rounds(self):
        # A third round at the same stalled ratio gives convergePatienceRounds=2 its two
        # consecutive stalled rounds (round 1 -> round 3 improvement is below the band).
        ratio = 11.0
        hist = [self._orig()]
        for rnd in (1, 2, 3):
            hist.append({"id": "r%d" % rnd, "round": rnd, "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=ratio,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        d = rounds.decide(3, _goal(), hist, None, None)
        self.assertEqual(d["route"], "stop")
        self.assertEqual(d["stopReason"], "converged")

    def test_a_pending_repair_keeps_a_stalled_run_going(self):
        hist = [self._orig()]
        for rnd in (1, 2, 3):
            hist.append({"id": "r%d" % rnd, "round": rnd, "kind": "candidate",
                         "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        hist.append({"id": "r3-near", "round": 2, "kind": "candidate", "exploratory": False,
                     "legal": False,
                     "values": _legal_values(pixel_ratio_judged_pct=10.0, pixel_outline_w_um=24.0,
                                             pixel_outline_h_um=44.0, pixel_drc_authority_1x1=2,
                                             pixel_drc_authority_3x3=18)})
        d = rounds.decide(3, _goal(), hist, None, None)
        self.assertEqual(d["route"], "continue")

    def test_the_round_before_the_budget_ends_flags_the_next_as_final(self):
        hist = [self._orig(),
                {"id": "r1", "round": 1, "kind": "candidate", "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=11.0, pixel_outline_w_um=24.0,
                                         pixel_outline_h_um=44.0)}]
        self.assertFalse(rounds.decide(1, _goal(maxRounds=3), hist, None, None)["finalRound"])
        self.assertTrue(rounds.decide(2, _goal(maxRounds=3), hist, None, None)["finalRound"])
        self.assertFalse(rounds.decide(3, _goal(maxRounds=3), hist, None, None)["finalRound"])

    def test_lower_patience_reverts_to_single_round_stall(self):
        # A Project that explicitly asks for patience 1 gets the old single-round read back.
        ratio = 11.0
        hist = [self._orig()]
        for rnd in (1, 2):
            hist.append({"id": "r%d" % rnd, "round": rnd, "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=ratio,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        d = rounds.decide(2, _goal(convergePatienceRounds=1), hist, None, None)
        self.assertEqual(d["route"], "stop")
        self.assertEqual(d["stopReason"], "converged")

    def test_project_requesting_eight_rounds_keeps_going_past_six(self):
        # A Project's campaign.yml asks for 8 rounds (strategy.maxRounds); round 6, which used to
        # be the hard stop, is now mid-Run with the Goal unmet and no plateau evidence yet.
        hist = [self._orig(),
                {"id": "r6", "round": 6, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(6, _goal(maxRounds=8), hist, None, None)
        self.assertEqual(d["route"], "continue")
        self.assertEqual(d["nextRound"]["round"], 7)

    def test_project_requesting_eight_rounds_stops_at_eight(self):
        hist = [self._orig(),
                {"id": "r8", "round": 8, "exploratory": False, "legal": True,
                 "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                         pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)}]
        d = rounds.decide(8, _goal(maxRounds=8), hist, None, None)
        self.assertEqual(d["route"], "stop")
        self.assertEqual(d["stopReason"], "round-limit")

    def test_a_candidate_one_transmittance_fix_away_keeps_the_run_going(self):
        # Live Run B stopped "blocked" at round 3: the best legal ratio had stalled, beside a clean
        # 9.92 % candidate that missed only the transmittance minimum. That candidate is a live
        # lever: no convergence while it is untried, and the decision names it for the resident.
        ratio = 11.0
        hist = [self._orig()]
        for rnd in (1, 2):
            hist.append({"id": "r%d" % rnd, "round": rnd, "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=ratio,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        hist.append({"id": "r2-ratio", "round": 2, "exploratory": False, "legal": False,
                     "values": _legal_values(pixel_ratio_judged_pct=10.0, pixel_t_judged_pct=4.8,
                                             pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        d = rounds.decide(2, _goal(), hist, None, None)
        self.assertEqual(d["route"], "continue")
        self.assertEqual(d["nextLever"]["candidate"], "r2-ratio")
        self.assertEqual(d["nextLever"]["fails"], ["transmittance-above-min"])
        self.assertIn("band-trim", d["nextLever"]["action"])

    def test_a_fixed_outline_never_hints_a_shrink_for_transmittance(self):
        # outlineMode fixed: a candidate over the transmittance maximum is fixed by more opaque
        # coverage at its own outline, never by min-pitch (the Goal keeps the cell's size).
        hist = [self._orig()]
        hist.append({"id": "r1", "round": 1, "exploratory": False, "legal": True,
                     "values": _legal_values(pixel_ratio_judged_pct=11.0, pixel_t_judged_pct=8.0)})
        hist.append({"id": "r1-bright", "round": 1, "exploratory": False, "legal": False,
                     "values": _legal_values(pixel_ratio_judged_pct=10.0, pixel_t_judged_pct=9.5)})
        goal = _goal(outlineMode="fixed", values={"t_min_pct": 7.0, "t_max_pct": 9.0})
        lever = rounds.decide(1, goal, hist, None, None)["nextLever"]
        self.assertEqual(lever["fails"], ["transmittance-below-max"])
        self.assertIn("shield", lever["action"])
        self.assertNotIn("min-pitch", lever["action"])
        target = rounds.decide(1, _goal(values={"t_min_pct": 7.0, "t_max_pct": 9.0}), hist, None, None)
        self.assertIn("min-pitch", target["nextLever"]["action"])

    def _stalled_with(self, **near):
        # Three stalled rounds (3, 4, 5) so the default convergePatienceRounds=2 window
        # (round 5 compared back to round 3) has a running best legal ratio to compare against.
        hist = [self._orig()]
        for rnd in (3, 4, 5):
            hist.append({"id": "r%d" % rnd, "round": rnd, "exploratory": False, "legal": True,
                         "values": _legal_values(pixel_ratio_judged_pct=11.0,
                                                 pixel_outline_w_um=24.0, pixel_outline_h_um=44.0)})
        hist.append({"id": "r5-near", "round": 5, "exploratory": False, "legal": False,
                     "values": _legal_values(pixel_ratio_judged_pct=10.0,
                                             pixel_outline_w_um=24.0, pixel_outline_h_um=44.0, **near)})
        return rounds.decide(5, _goal(), hist, None, None)

    def test_a_candidate_one_marker_away_keeps_the_run_going(self):
        # A live Run ended "blocked" a round early beside its best-ratio candidate whose only
        # failure was one authority marker (1 / 4 / 9 in the 1x1 / 2x2 / 3x3 tiles): a repair.
        d = self._stalled_with(pixel_drc_authority_1x1=1, pixel_drc_authority_2x2=4,
                               pixel_drc_authority_3x3=9)
        self.assertEqual(d["route"], "continue")
        self.assertEqual(d["nextLever"]["candidate"], "r5-near")
        self.assertIn("markers", d["nextLever"]["action"])

    def test_many_markers_are_no_lever(self):
        d = self._stalled_with(pixel_drc_authority_1x1=6, pixel_drc_authority_2x2=24,
                               pixel_drc_authority_3x3=54)
        self.assertIsNone(d["nextLever"])
        self.assertEqual(d["route"], "stop")

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
