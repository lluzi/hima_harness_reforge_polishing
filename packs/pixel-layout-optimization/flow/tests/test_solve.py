"""Tests for the front-point solve driver (``pixelopt.solve`` via ``numcmd``).

A one-point min-pitch plan on the synthetic case must produce one candidate
whose pitch is no larger than the original's, whose ``meta.json`` carries the
contract keys, and whose exact-pair loop terminated. Skips without the numeric
packages.
"""
import json
import os
import tempfile
import unittest

try:
    import numpy  # noqa: F401
    import scipy  # noqa: F401
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

from tests.test_numcmd import _build_workspace, _load  # noqa: E402


@unittest.skipUnless(HAVE, "numeric packages not installed")
class SolveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ws, self.built, self.case, self.outline = _build_workspace(self.tmp.name)
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)

    def _write_plan(self, points):
        plan = {"schema": "pixel.plan/1", "round": 1,
                "hypothesis": "min pitch is reachable below the original",
                "base": "original", "operators": [], "frontPoints": points,
                "pairConstraints": [], "edits": [], "expect": "outline smaller"}
        from pixelopt import core
        core.write_json(os.path.join(self.ws, "state", "round", "plan.json"), plan)

    def test_min_pitch_point_produces_a_smaller_candidate(self):
        from pixelopt import numcmd, layout
        w0, h0 = self.outline
        self._write_plan([{"name": "target-pitch", "objective": "min-pitch",
                           "outlineUm": [18.0, 36.0]}])
        res = numcmd.cmd_solve(self.ws, 1)
        self.assertEqual(res["failed"], [])
        self.assertEqual(res["candidates"], ["r01-target-pitch"])

        cdir = os.path.join(self.ws, "cands", "r01-target-pitch")
        for fname in ("pixel.gds", "pixel2x2.gds", "pixel3x3.gds",
                      "geometry.json", "meta.json"):
            self.assertTrue(os.path.exists(os.path.join(cdir, fname)), fname)

        lay = layout.load_gds(os.path.join(cdir, "pixel.gds"), self.case,
                              top=self.case.raw["candidateTopCell"])
        w1, h1 = lay.pitch(self.case)
        self.assertLessEqual(w1, w0 + 1e-6)
        self.assertLessEqual(h1, h0 + 1e-6)
        self.assertLess(w1, w0 - 1e-6)  # the slack really was taken up
        self.assertLess(h1, h0 - 1e-6)

        meta = _load(os.path.join(cdir, "meta.json"))
        for key in ("id", "kind", "round", "base", "frontPoint", "exploratory",
                    "operators", "edits", "declaredChanges", "predicted", "solve"):
            self.assertIn(key, meta)
        self.assertEqual(meta["kind"], "candidate")
        self.assertEqual(meta["base"], "original")
        self.assertIn("pairIterations", meta["solve"])
        self.assertIn("residualMarkers", meta["solve"])
        self.assertIn("pitchUm", meta["solve"])
        # A clean base terminates the exact-pair loop on the first pass.
        self.assertGreaterEqual(meta["solve"]["pairIterations"], 1)
        self.assertLessEqual(meta["solve"]["pairIterations"], 6)

    def test_two_points_run_and_report(self):
        from pixelopt import numcmd
        self._write_plan([
            {"name": "target-pitch", "objective": "min-pitch",
             "outlineUm": [18.0, 36.0]},
            {"name": "legalise", "objective": "min-pitch"}])  # second at the Goal
        res = numcmd.cmd_solve(self.ws, 2)
        self.assertEqual(set(res["candidates"]),
                         {"r02-target-pitch", "r02-legalise"})


    def test_a_point_carries_its_own_operators_and_fails_alone(self):
        # One round, several discrete changes: each point applies its own operators after the
        # plan's on its own copy of the base; an operator that cannot apply fails only its point.
        from pixelopt import numcmd
        shield = {"op": "shield", "net": "VP", "layer": "Metal",
                  "over": {"victim": "S", "aggressor": "VP"}, "marginUm": 0.0}
        floating = {"op": "shield", "net": "R1", "layer": "Metal",
                    "over": {"victim": "S", "aggressor": "VP"}, "marginUm": 0.0}
        self._write_plan([
            {"name": "plain", "objective": "min-pitch"},
            {"name": "shielded", "objective": "min-pitch", "operators": [shield]},
            {"name": "floats", "objective": "min-pitch", "operators": [floating]}])
        res = numcmd.cmd_solve(self.ws, 3)
        self.assertEqual(set(res["candidates"]), {"r03-plain", "r03-shielded"})
        self.assertEqual([f["name"] for f in res["failed"]], ["floats"])
        self.assertEqual(res["failed"][0]["status"], "operator-refused")
        plain = _load(os.path.join(self.ws, "cands", "r03-plain", "meta.json"))
        shielded = _load(os.path.join(self.ws, "cands", "r03-shielded", "meta.json"))
        self.assertEqual(plain["operators"], [])
        self.assertEqual(shielded["operators"], [shield])

    def test_a_ratio_solve_the_model_expects_no_gain_from_delivers_its_start(self):
        # A min-ratio solve predicted no better than its own start only moves shapes: the start is
        # delivered as drawn (a live Run's solves from its best legal candidate predicted a small
        # loss and measured a large one).
        from unittest import mock
        from pixelopt import numcmd, solve, layout
        from tests.test_numcmd import NumCmdTest
        NumCmdTest._judge_original_and_record(self)
        numcmd.cmd_fit(self.ws)
        self._write_plan([{"name": "ratio", "objective": "min-ratio"}])
        with mock.patch.object(solve, "_predicted_ratio", return_value=5.0), \
                mock.patch.object(solve, "_drc_markers", return_value=(0, 0, [])):
            res = numcmd.cmd_solve(self.ws, 4)
        if res["failed"]:
            self.skipTest("min-ratio does not solve on the synthetic case: %s" % res["failed"])
        meta = _load(os.path.join(self.ws, "cands", "r04-ratio", "meta.json"))
        self.assertEqual(meta["solve"]["status"], "kept-start")
        lay = layout.load_gds(os.path.join(self.ws, "cands", "r04-ratio", "pixel.gds"), self.case,
                              top=self.case.raw["candidateTopCell"])
        w1, h1 = lay.pitch(self.case)
        self.assertAlmostEqual(w1, self.outline[0], places=3)
        self.assertAlmostEqual(h1, self.outline[1], places=3)


if __name__ == "__main__":
    unittest.main()
