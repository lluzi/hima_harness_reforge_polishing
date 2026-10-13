import sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, rounds  # noqa: E402

GOAL = {"target_dropped_count": 0, "max_target_distance_um": 100, "max_order_deviation_lr": 2,
        "max_order_deviation_tb": 1, "max_priority_move_um": 100}


def values(**over):
    base = {"mage_candidate_error_count": 0, "mage_priority_unplaced_count": 0, "mage_dropped_count": 1,
            "mage_dropped_length_um": 900.0, "mage_dropped_ordinary_count": 1, "mage_dropped_ordinary_length_um": 900.0,
            "mage_target_distance_max_um": 150.0, "mage_target_over_limit_count": 1, "mage_order_deviation_max": 0,
            "mage_order_deviation_max_lr": 0, "mage_order_deviation_max_tb": 0, "mage_priority_move_max_um": 0.0,
            "mage_priority_moved_count": 0, "mage_native_overlap_rows": 0, "mage_native_space_rows": 0,
            "mage_native_boundary_rows": 0, "mage_native_violation_total": 0}
    base.update(over)
    return [{"type": k, "unit": "x", "value": v} for k, v in base.items()]


def candidate(round_no, reader_values, outcome="completed"):
    return {"id": f"c{round_no}", "identity": {"round": round_no}, "snapshotSha256": f"s{round_no}", "outcome": outcome,
            "metrics": {}, "files": {"journal": {"path": "placement/round-%02d/journal-entry.json" % round_no, "sha256": "j"}},
            "_readerValues": reader_values}


class RuleResultsTest(unittest.TestCase):
    def test_all_pass_when_within_goal(self):
        r = rounds.rule_results(values(mage_dropped_count=0, mage_target_distance_max_um=50.0, mage_target_over_limit_count=0), GOAL)
        self.assertTrue(all(v == "PASS" for v in r.values())); self.assertEqual(len(r), 8)

    def test_unknown_value_is_unknown_rule(self):
        vals = values(); vals[-1]["value"] = None
        self.assertEqual(rounds.rule_results(vals, GOAL)["no-native-violation"], "UNKNOWN")

    def test_move_budget_rule(self):
        self.assertEqual(rounds.rule_results(values(mage_priority_move_max_um=150.0), GOAL)["priority-move-within-budget"], "FAIL")


class BestStateKeyTest(unittest.TestCase):
    def test_native_rows_first_then_unplaced_then_ordinary_drops(self):
        self.assertLess(rounds.best_state_key(values()), rounds.best_state_key(values(mage_native_violation_total=1)))
        self.assertLess(rounds.best_state_key(values()), rounds.best_state_key(values(mage_priority_unplaced_count=1)))
        self.assertLess(rounds.best_state_key(values(mage_dropped_ordinary_length_um=500.0)), rounds.best_state_key(values()))

    def test_unknown_sorts_worst(self):
        vals = values(); vals[0]["value"] = 0
        for v in vals:
            if v["type"] == "mage_dropped_ordinary_count": v["value"] = None
        self.assertGreater(rounds.best_state_key(vals), rounds.best_state_key(values(mage_dropped_ordinary_count=99)))


class DecideTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.ws = Path(self.tmp.name)
        (self.ws / "placement" / "round-01").mkdir(parents=True)
        (self.ws / "placement" / "round-01" / "journal-entry.json").write_text(
            '{"schema":"mage.journal-entry/1","round":1,"hypothesis":"h","stages":[{"stage":1,"scriptSha256":"a","outcome":"completed","boundaries":[],"stageError":null,"note":""}],"observations":[],"conclusion":"c","nextStep":""}', encoding="utf-8")
        core.write_artifact(self.ws / "state" / "method-journal.json", core.stamp("method-journal", {"entries": [], "bestRound": None}))
        self.round0 = core.stamp("round-decision", {"round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None,
                                                     "history": [], "stopReason": "", "goalMet": False, "rules": {}, "blockedRound": False})

    def tearDown(self):
        self.tmp.cleanup()

    def _journal_for(self, round_no):
        d = self.ws / "placement" / ("round-%02d" % round_no); d.mkdir(parents=True, exist_ok=True)
        src = (self.ws / "placement" / "round-01" / "journal-entry.json").read_text(encoding="utf-8").replace('"round":1', '"round":%d' % round_no)
        (d / "journal-entry.json").write_text(src, encoding="utf-8")

    def test_round_one_continues_and_is_best_and_journal_appended(self):
        d = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self.assertEqual(d["route"], "continue"); self.assertEqual(d["best"]["round"], 1); self.assertTrue(d["history"][0]["improved"])
        journal = core.read_artifact(self.ws / "state" / "method-journal.json", "method-journal")
        self.assertEqual(len(journal["entries"]), 1); self.assertEqual(journal["bestRound"], 1)

    def test_goal_met_stops(self):
        d = rounds.decide(self.ws, 1, GOAL, candidate(1, values(mage_dropped_count=0, mage_dropped_ordinary_count=0,
                          mage_dropped_ordinary_length_um=0.0, mage_dropped_length_um=0.0, mage_target_distance_max_um=50.0,
                          mage_target_over_limit_count=0)), self.round0)
        self.assertEqual(d["route"], "stop"); self.assertTrue(d["goalMet"]); self.assertEqual(d["stopReason"], "goal met")

    def test_two_stalls_after_round_one_stop(self):
        d1 = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d1)
        self.assertEqual(d2["route"], "continue")
        self._journal_for(3); d3 = rounds.decide(self.ws, 3, GOAL, candidate(3, values()), d2)
        self.assertEqual(d3["route"], "stop"); self.assertIn("two consecutive", d3["stopReason"]); self.assertEqual(d3["best"]["round"], 1)

    def test_blocked_round_continues_and_never_becomes_best(self):
        d = rounds.decide(self.ws, 1, GOAL, candidate(1, [], outcome="blocked"), self.round0)
        self.assertEqual(d["route"], "continue"); self.assertIsNone(d["best"]); self.assertTrue(d["blockedRound"])
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d)
        self.assertEqual(d2["best"]["round"], 2)

    def test_blocked_round_is_transparent_to_the_stall_rule(self):
        # Finding 1: a blocked round neither counts as a stall nor resets the
        # counter. With round 2 blocked, two *completed* non-improving rounds
        # (3 and 4) are required to stop -- the old code counted the blocked
        # round as a stall and stopped one round too early at round 3.
        d1 = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, [], outcome="blocked"), d1)
        self.assertEqual(d2["route"], "continue"); self.assertEqual(d2["best"]["round"], 1); self.assertTrue(d2["blockedRound"])
        self._journal_for(3); d3 = rounds.decide(self.ws, 3, GOAL, candidate(3, values()), d2)
        self.assertEqual(d3["route"], "continue"); self.assertEqual(d3["best"]["round"], 1)
        self._journal_for(4); d4 = rounds.decide(self.ws, 4, GOAL, candidate(4, values()), d3)
        self.assertEqual(d4["route"], "stop"); self.assertIn("two consecutive", d4["stopReason"])

    def test_round_limit_stops(self):
        prev = self.round0
        for n in range(1, 7):
            self._journal_for(n); prev = rounds.decide(self.ws, n, GOAL, candidate(n, values(mage_dropped_ordinary_length_um=900.0 - n)), prev)
        self.assertEqual(prev["route"], "stop"); self.assertIn("round limit", prev["stopReason"])

    def test_improvement_resets_the_stall_counter(self):
        d1 = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d1)
        self._journal_for(3); d3 = rounds.decide(self.ws, 3, GOAL, candidate(3, values(mage_dropped_ordinary_length_um=800.0)), d2)
        self.assertEqual(d3["route"], "continue"); self.assertEqual(d3["best"]["round"], 3)

    def test_decide_rerun_of_the_same_round_does_not_duplicate_history_or_rounds(self):
        d1 = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self._journal_for(2)
        rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d1)
        result = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d1)
        self.assertEqual(len(result["history"]), 2)
        script_result = core.read_artifact(self.ws / "state" / "script-result.json", "script-result")
        self.assertEqual(len(script_result["rounds"]), 2)


if __name__ == "__main__":
    unittest.main()
