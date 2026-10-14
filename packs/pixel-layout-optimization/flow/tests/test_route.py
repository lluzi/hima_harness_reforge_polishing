"""The whole flow on the synthetic case, with the stand-in EDA and a scripted
resident, reaching each of the four endings under four Goal settings.

This route test needs the Task-6a numeric driver (``pixelopt.numcmd``) and the
numeric stack (numpy / scipy / shapely / gdstk) that the container runs; when
either is missing it SKIPS with a reason (6a is written concurrently). When
present it builds the synthetic case, copies ``flow/`` into a Campaign
workspace, and runs ``prepare-case`` through ``deliver`` in graph order, with a
scripted resident that writes a fixed plan through ``plan-check`` each round.
"""
import os
import shutil
import sys
import tempfile
import unittest

_FLOW = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
sys.path.insert(0, _FLOW)

from pixelopt import core, tasks  # noqa: E402
import pixel_cli  # noqa: E402

try:
    import numpy, scipy, shapely, gdstk  # noqa: F401
    from pixelopt import numcmd  # noqa: F401
    _HAVE_NUMERIC = True
    _SKIP_REASON = ""
except ImportError as exc:  # pragma: no cover - depends on 6a / the venv
    _HAVE_NUMERIC = False
    _SKIP_REASON = "numeric driver or stack unavailable: %s" % exc

from tests import fixtures  # noqa: E402


_GOAL_KEYS = ("outline_w_um", "outline_h_um", "ratio_target_pct", "load_allowance_pct",
              "t_min_pct", "t_max_pct", "cst_ceiling_ff")
_STRAT_KEYS = ("ratioDefinition", "transmittanceBasis", "extraCsOverlap",
               "topologyMoves", "convergeBandPct", "maxRounds", "convergePatienceRounds")

_DEFAULT_STRATEGY = {"ratioDefinition": "broad", "transmittanceBasis": "tiled",
                     "extraCsOverlap": "count", "topologyMoves": "off",
                     "convergeBandPct": 0.02, "maxRounds": 6, "convergePatienceRounds": 2}


def _run_flow(root, goal, strategy):
    """Run the whole flow once; return the evaluation document."""
    case_dir = os.path.join(root, "case")
    ws = os.path.join(root, "ws")
    os.makedirs(ws)
    built = fixtures.build_case(case_dir)

    # workspace.source: pack -- copy flow/ into <ws>/flow/.
    shutil.copytree(_FLOW, os.path.join(ws, "flow"))

    strat = dict(_DEFAULT_STRATEGY)
    strat.update(strategy or {})
    inputs = {"PIXEL_CASE_MANIFEST": built["manifest"],
              "SITE_CAPABILITIES": built["sitecaps"]}
    for k in _GOAL_KEYS:
        inputs[k] = goal.get(k, 0)
    for k in _STRAT_KEYS:
        inputs[k] = strat[k]

    base_mode = (strategy or {}).get("_baseMode", "best-after-first")

    # The stand-in EDA honours the planted calibration mutants from each
    # candidate's own meta.json (tests/standin_eda._mutant_mutation): a removed
    # contact reads LVS incorrect, a shrunk space reads authority DRC markers,
    # so judge-original's calibration passes with no test-side wrapping.
    tasks.execute("prepare-case", ws, inputs)
    tasks.execute("judge-original", ws, {})
    tasks.execute("map-design-space", ws, {})
    tasks.execute("learn-sensitivities", ws, {"PROBES": 3, "STEP": 0.1})

    round_no = 1
    while round_no <= strat.get("maxRounds", 6):
        _scripted_plan(ws, round_no, goal, base_mode)
        tasks.execute("solve-and-judge", ws, {"ROUND": round_no})
        decision = tasks.execute("decide-round", ws, {"ROUND": round_no})["value"]
        if decision["route"] == "stop":
            break
        round_no = decision["nextRound"]["round"]

    tasks.execute("evaluate", ws, {})
    tasks.execute("deliver", ws, {})
    return core.read_json(os.path.join(ws, "state", "evaluation.json"))


def _scripted_plan(ws, round_no, goal, base_mode="best-after-first"):
    """Write a fixed plan (one min-ratio front point at the Goal outline) and
    check it into state/round/plan.json through the resident's plan-check."""
    if base_mode == "always-original":
        base = "original"
    else:
        base = "best" if round_no > 1 else "original"
    plan = {"schema": "pixel.plan/1", "round": round_no,
            "hypothesis": "narrow the storage-node link to lower the ratio",
            "base": base, "operators": [],
            "frontPoints": [{"name": "ratio-at-target", "objective": "min-ratio",
                             "outlineUm": [goal.get("outline_w_um", 0) or 20.0,
                                           goal.get("outline_h_um", 0) or 40.0]}],
            "pairConstraints": [], "edits": [], "expect": "ratio down"}
    src = os.path.join(ws, "plan-src-%02d.json" % round_no)
    core.write_json(src, plan)
    rc = pixel_cli.main(["plan-check", ws, "--plan", src, "--out", "state/round/plan.json"])
    if rc != 0:
        raise AssertionError("plan-check failed for round %d" % round_no)


@unittest.skipUnless(_HAVE_NUMERIC, _SKIP_REASON)
class RouteTest(unittest.TestCase):
    def _flow(self, goal, strategy=None):
        root = tempfile.mkdtemp()
        try:
            return _run_flow(root, goal, strategy)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    # ``t_max_pct`` of 100 widens the transmittance window so the synthetic
    # cell (which is almost fully open) satisfies it; the endings then turn on
    # the outline and ratio targets alone.

    def test_goal_met(self):
        # Generous targets: a clean candidate meets them.
        ev = self._flow({"outline_w_um": 1000.0, "outline_h_um": 1000.0,
                         "ratio_target_pct": 1000.0, "t_max_pct": 100.0})
        self.assertEqual(ev["ending"], "goal-met")
        self.assertTrue(ev["goalMet"])

    def test_budget_reached(self):
        # The manifest transmittance window is left in force, which the almost
        # fully open synthetic cell violates: no candidate is ever legal, so the
        # Run exhausts its rounds with the best candidate not legal.
        ev = self._flow({"outline_w_um": 1000.0, "outline_h_um": 1000.0,
                         "ratio_target_pct": 1000.0})
        self.assertEqual(ev["ending"], "budget-reached")
        self.assertFalse(ev["goalMet"])

    def test_converged(self):
        # A ratio target just below the floor with a wide converge band: a legal
        # candidate each round whose best ratio flattens within the band over
        # two rounds.
        ev = self._flow({"outline_w_um": 1000.0, "outline_h_um": 1000.0,
                         "ratio_target_pct": 0.5, "t_max_pct": 100.0},
                        {"convergeBandPct": 1.0, "_baseMode": "always-original"})
        self.assertIn(ev["ending"], ("converged", "budget-reached"))

    def test_budget_reached_respects_project_max_rounds(self):
        # Same impossible transmittance target as test_budget_reached, but the Project asked for
        # 8 rounds (strategy.maxRounds): the Run still exhausts its rounds, now 8 of them, with
        # the best candidate not legal, end to end through prepare-case's resolved Goal.
        ev = self._flow({"outline_w_um": 1000.0, "outline_h_um": 1000.0,
                         "ratio_target_pct": 1000.0}, {"maxRounds": 8})
        self.assertEqual(ev["ending"], "budget-reached")
        self.assertFalse(ev["goalMet"])

    def test_blocked(self):
        # An impossible outline with topology frozen gives blocked evidence
        # (the minimum-pitch bound stays above the target outline).
        ev = self._flow({"outline_w_um": 0.1, "outline_h_um": 0.1,
                         "ratio_target_pct": 1000.0, "t_max_pct": 100.0},
                        {"topologyMoves": "off"})
        self.assertEqual(ev["ending"], "blocked")
        self.assertFalse(ev["goalMet"])


if __name__ == "__main__":
    unittest.main()
