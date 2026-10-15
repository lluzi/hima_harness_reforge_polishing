"""Plan admissibility check and the pixel-plan Reader values (stdlib only)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

from pixelopt import core, plan  # noqa: E402


def _readiness(**over):
    goal = {"values": {"outline_w_um": 20.0, "outline_h_um": 40.0,
                       "ratio_target_pct": 9.0, "load_allowance_pct": 5.0,
                       "t_min_pct": 5.0, "t_max_pct": 30.0, "cst_ceiling_ff": 0.0},
            "topologyMoves": "off"}
    goal.update(over.pop("goal", {}))
    manifest = {"layers": {"Poly": {}, "GateA": {}, "Anode": {}, "Bank": {}},
                }
    manifest["nets"] = {"storageNode": "S", "storageNet": "VP", "anode": "AN"}
    manifest["ratioDefinitions"] = {"broad": ["SC", "AN"], "narrow": ["R1"]}
    manifest["loadLimitedLines"] = ["SC", "AN"]
    manifest["couplingLimits"] = [{"pair": ["S", "DL"], "maxFf": 0.5}]
    return {"goal": goal, "manifest": manifest}


def _plan(**over):
    p = {"schema": "pixel.plan/1", "round": 2, "hypothesis": "x", "base": "best",
         "operators": [], "frontPoints": [{"name": "t", "objective": "min-ratio"}],
         "pairConstraints": [], "edits": [], "expect": "y"}
    p.update(over)
    return p


class CheckTest(unittest.TestCase):
    def test_good_plan(self):
        self.assertEqual(plan.check(_plan(), _readiness(), [], round=2), [])

    def test_bad_base(self):
        errs = plan.check(_plan(base="nope"), _readiness(), [], round=2)
        self.assertTrue(any("base" in e for e in errs))

    def test_base_from_history(self):
        self.assertEqual(plan.check(_plan(base="r1-x"), _readiness(), ["r1-x"], round=2), [])

    def test_round_mismatch(self):
        errs = plan.check(_plan(round=3), _readiness(), [], round=2)
        self.assertTrue(any("round" in e for e in errs))

    def test_cst_stretch_needs_ceiling(self):
        errs = plan.check(_plan(operators=[{"op": "cst-stretch", "dyUm": 0.5}]),
                          _readiness(), [], round=2)
        self.assertTrue(any("cst-stretch" in e for e in errs))

    def test_cst_stretch_allowed_with_ceiling(self):
        r = _readiness(goal={"values": {"outline_w_um": 20.0, "outline_h_um": 40.0,
                                        "ratio_target_pct": 9.0, "load_allowance_pct": 5.0,
                                        "t_min_pct": 5.0, "t_max_pct": 30.0,
                                        "cst_ceiling_ff": 30.0}})
        self.assertEqual(plan.check(_plan(operators=[{"op": "cst-stretch", "dyUm": 0.5}]),
                                    r, [], round=2), [])

    def test_contact_move_needs_topology(self):
        errs = plan.check(_plan(operators=[{"op": "contact-move", "net": "SC",
                                            "toward": "left", "stepUm": 0.1}]),
                          _readiness(), [], round=2)
        self.assertTrue(any("contact-move" in e for e in errs))

    def test_unknown_layer(self):
        errs = plan.check(_plan(operators=[{"op": "band-trim", "net": "SC",
                                            "layer": "Nope", "widthUm": 1.0}]),
                          _readiness(), [], round=2)
        self.assertTrue(any("layer" in e for e in errs))

    def test_unknown_net(self):
        errs = plan.check(_plan(operators=[{"op": "band-trim", "net": "ZZ",
                                            "layer": "Poly", "widthUm": 1.0}]),
                          _readiness(), [], round=2)
        self.assertTrue(any("net" in e for e in errs))

    def test_exploratory_mismatch(self):
        # looser load allowance but not flagged exploratory
        errs = plan.check(_plan(frontPoints=[{"name": "t", "objective": "min-ratio",
                                              "loadAllowancePct": 20}]),
                          _readiness(), [], round=2)
        self.assertTrue(any("exploratory" in e for e in errs))

    def test_exploratory_ok_when_flagged(self):
        self.assertEqual(plan.check(_plan(frontPoints=[{"name": "t", "objective": "min-ratio",
                                                        "loadAllowancePct": 20,
                                                        "exploratory": True}]),
                                    _readiness(), [], round=2), [])

    def test_point_operators_are_checked_like_plan_operators(self):
        good = _plan(frontPoints=[
            {"name": "s1", "objective": "min-ratio",
             "operators": [{"op": "shield", "net": "VP", "layer": "GateA",
                            "over": {"victim": "S", "aggressor": "SC"}, "marginUm": -0.2}]},
            {"name": "plain", "objective": "min-ratio"}])
        self.assertEqual(plan.check(good, _readiness(), [], round=2), [])
        bad = _plan(frontPoints=[{"name": "s1", "objective": "min-ratio",
                                  "operators": [{"op": "shield", "net": "ZZ", "layer": "Nope"}]}])
        errs = plan.check(bad, _readiness(), [], round=2)
        self.assertTrue(any("front point 's1'" in e and "layer" in e for e in errs))
        self.assertTrue(any("front point 's1'" in e and "net" in e for e in errs))

    def test_fixed_outline_refuses_min_pitch_and_other_outlines(self):
        r = _readiness(goal={"outlineMode": "fixed"})
        self.assertEqual(plan.check(_plan(frontPoints=[
            {"name": "a", "objective": "legalise"},
            {"name": "b", "objective": "min-ratio", "outlineUm": [20.0, 40.0]}]), r, [], round=2), [])
        errs = plan.check(_plan(frontPoints=[{"name": "p", "objective": "min-pitch"}]), r, [], round=2)
        self.assertTrue(any("min-pitch" in e and "fixed" in e for e in errs))
        errs = plan.check(_plan(frontPoints=[{"name": "q", "objective": "min-ratio",
                                              "outlineUm": [19.5, 40.0]}]), r, [], round=2)
        self.assertTrue(any("fixes it" in e for e in errs))
        # a shrink target is still allowed when the outline is a target
        self.assertEqual(plan.check(_plan(frontPoints=[{"name": "p", "objective": "min-pitch"}]),
                                    _readiness(), [], round=2), [])

    def test_too_many_front_points(self):
        fps = [{"name": "p%d" % i, "objective": "min-ratio"} for i in range(7)]
        errs = plan.check(_plan(frontPoints=fps), _readiness(), [], round=2)
        # schema maxItems 6 catches it
        self.assertTrue(errs)


class ReaderValuesTest(unittest.TestCase):
    def test_counts(self):
        with tempfile.TemporaryDirectory() as ws:
            os.makedirs(os.path.join(ws, "state"))
            plan_doc = _plan(operators=[{"op": "shield", "net": "SC", "layer": "GateA",
                                         "over": {"victim": "S", "aggressor": "SC"},
                                         "marginUm": 0.2}],
                             frontPoints=[{"name": "a", "objective": "min-pitch"},
                                          {"name": "b", "objective": "min-ratio",
                                           "loadAllowancePct": 20, "exploratory": True}],
                             edits=[{"layer": "Poly", "dx": 0.5, "dy": 0.0}])
            plan_path = os.path.join(ws, "plan.json")
            core.write_json(plan_path, plan_doc)
            core.write_json(os.path.join(ws, "state", "case-readiness.json"), {})
            rows = plan.reader_values(plan_path, ws, _readiness())
            vmap = {r["type"]: r["value"] for r in rows}
            self.assertEqual(vmap["pixel_plan_error_count"], 0)
            self.assertEqual(vmap["pixel_plan_front_points"], 2)
            self.assertEqual(vmap["pixel_plan_operator_count"], 1)
            self.assertEqual(vmap["pixel_plan_edit_count"], 1)
            self.assertEqual(vmap["pixel_plan_exploratory_points"], 1)

    def test_error_count_nonzero(self):
        with tempfile.TemporaryDirectory() as ws:
            plan_path = os.path.join(ws, "plan.json")
            core.write_json(plan_path, _plan(base="nope"))
            rows = plan.reader_values(plan_path, ws, _readiness())
            vmap = {r["type"]: r["value"] for r in rows}
            self.assertGreater(vmap["pixel_plan_error_count"], 0)


if __name__ == "__main__":
    unittest.main()
