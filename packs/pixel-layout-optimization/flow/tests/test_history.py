"""History append/load and the trend chart (stdlib only)."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

from pixelopt import history  # noqa: E402


def _goal():
    return {"values": {"outline_w_um": 20.0, "outline_h_um": 40.0,
                       "ratio_target_pct": 9.0, "load_allowance_pct": 5.0,
                       "t_min_pct": 5.0, "t_max_pct": 30.0}}


def _row(id_, rnd, ratio, legal, w=19.0, h=39.0, load=2.0, t=10.0, drc=0):
    return {"id": id_, "round": rnd, "legal": legal, "exploratory": False,
            "values": {"pixel_ratio_judged_pct": ratio, "pixel_outline_w_um": w,
                       "pixel_outline_h_um": h, "pixel_load_increase_max_pct": load,
                       "pixel_t_judged_pct": t, "pixel_drc_authority_3x3": drc}}


class AppendLoadTest(unittest.TestCase):
    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as ws:
            history.append(ws, _row("original", 0, 12.0, False))
            history.append(ws, _row("r1", 1, 10.0, True))
            rows = history.load(ws)
            self.assertEqual([r["id"] for r in rows], ["original", "r1"])

    def test_load_missing(self):
        with tempfile.TemporaryDirectory() as ws:
            self.assertEqual(history.load(ws), [])


class TrendTest(unittest.TestCase):
    def test_normalises_to_target(self):
        hist = [_row("r1", 1, 18.0, True)]  # ratio 18 / target 9 = 2.0
        series = history.trend(hist, _goal())
        pt = series["metrics"]["ratio"]["points"][0]
        self.assertAlmostEqual(pt["value"], 2.0)

    def test_best_so_far_runs_min_over_legal(self):
        hist = [_row("r1", 1, 18.0, True), _row("r2", 2, 9.0, True),
                _row("r3", 3, 36.0, True)]
        series = history.trend(hist, _goal())
        best = series["metrics"]["ratio"]["best"]
        # normalised: 2.0, 1.0, 4.0 -> running min 2.0, 1.0, 1.0
        self.assertAlmostEqual(best[0]["value"], 2.0)
        self.assertAlmostEqual(best[1]["value"], 1.0)
        self.assertAlmostEqual(best[2]["value"], 1.0)

    def test_illegal_not_in_best(self):
        hist = [_row("r1", 1, 4.5, False)]  # illegal: excluded from best line
        series = history.trend(hist, _goal())
        self.assertIsNone(series["metrics"]["ratio"]["best"][0]["value"])

    def test_outline_and_load_series(self):
        hist = [_row("r1", 1, 9.0, True, w=10.0, h=20.0, load=5.0)]
        series = history.trend(hist, _goal())
        self.assertAlmostEqual(series["metrics"]["outline_w"]["points"][0]["value"], 0.5)
        self.assertAlmostEqual(series["metrics"]["load"]["points"][0]["value"], 1.0)


class TrendSvgTest(unittest.TestCase):
    def test_svg_is_wellformed(self):
        hist = [_row("r1", 1, 18.0, True), _row("r2", 2, 9.0, True)]
        svg = history.trend_svg(history.trend(hist, _goal()))
        self.assertTrue(svg.startswith("<svg"))
        self.assertTrue(svg.rstrip().endswith("</svg>"))
        self.assertIn("target 1.0", svg)
        self.assertIn("ratio best-so-far", svg)

    def test_svg_handles_empty(self):
        svg = history.trend_svg(history.trend([], _goal()))
        self.assertTrue(svg.startswith("<svg"))


if __name__ == "__main__":
    unittest.main()
