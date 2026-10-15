"""Tests for ``pixelopt.repair`` (numeric; skipped without numpy/shapely)."""
import unittest

try:
    import numpy as np
    import shapely  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

_CHECKS = [{"rule": "X.1", "kind": "space2", "layers": ["G", "S"], "value": 0.5}]
_TABLE = {"width": {"G": 1.0, "S": 1.0}, "space": {"G": 1.0, "S": 1.0}}


def _lay(polys):
    from pixelopt import layout
    return layout.Layout({k: [np.array(p, float) for p in v] for k, v in polys.items()})


@unittest.skipUnless(HAVE, "numeric packages not installed")
class RepairTest(unittest.TestCase):

    def test_an_enclosure_sliver_is_cut_back_past_the_spacing(self):
        """A plate (P) edge a few nm onto a line (L) edge: L just inside P, far under the 1.0
        enclosure. The cut pulls P's edge back off L past the 0.5 spacing; a fat marker is not a
        sliver and gets no cut."""
        from pixelopt import repair
        checks = [{"rule": "P.3", "kind": "enc", "layers": ["L", "P"], "value": 1.0},
                  {"rule": "LP.5", "kind": "space2", "layers": ["L", "P"], "value": 0.5}]
        lay = _lay({"P": [[(0, 5.0), (10, 5.0), (10, 12), (0, 12)]],
                    "L": [[(2, 0), (8, 0), (8, 5.004), (2, 5.004)]]})
        marks = [("P.3", [(2.0, 5.0), (8.0, 5.0), (8.0, 5.004), (2.0, 5.004)])]
        props = [p for p in repair.propose(lay, marks, checks, 0.005) if p["kind"] == "enc-sliver-cut"]
        self.assertEqual(len(props), 1)
        e = props[0]["edits"][0]
        self.assertEqual((e["layer"], e["polygon"], e["op"]), ("P", 0, "cut"))
        x0, y0, x1, y1 = e["box"]
        self.assertLessEqual(x0, 2.0)
        self.assertGreaterEqual(x1, 8.0)
        self.assertGreaterEqual(y1 - 5.004, 0.5)      # the new edge clears L by the spacing
        self.assertLessEqual(y1 - y0, 1.5)             # a bounded edit
        fat = [("P.3", [(2.0, 5.0), (8.0, 5.0), (8.0, 5.6), (2.0, 5.6)])]
        self.assertEqual([p for p in repair.propose(lay, fat, checks, 0.005)
                          if p["kind"] == "enc-sliver-cut"], [])
    def test_a_corner_cut_crossing_an_edge_is_cleared_by_moving_that_edge(self):
        """A 45-degree corner cut of S crosses G's right edge (the acute crossing compaction
        cannot remove); moving G's edge 1 um left clears it by the rule distance."""
        from pixelopt import repair
        lay = _lay({"G": [[(0, 0), (5, 0), (5, 10), (0, 10)]],
                    "S": [[(6.6, 4), (9, 4), (9, 12), (4.6, 12), (4.6, 6)]]})
        marks = [("X.1", [(5.0, 5.6), (5.0, 4.9), (5.5, 5.1)])]
        props = repair.propose(lay, marks, _CHECKS, 0.005, table=_TABLE)
        shifts = [p for p in props if p["kind"] == "edge-shift"]
        self.assertTrue(shifts, props)
        e = shifts[0]["edits"][0]
        self.assertEqual((e["layer"], e["polygon"], e["edge"]), ("G", 0, 1))
        self.assertAlmostEqual(e["dx"], -1.0)
        self.assertAlmostEqual(e["dy"], 0.0)

    def test_a_jog_crossing_an_edge_slides_clear(self):
        """An S jog between two vertical edges crosses G's bottom edge; sliding the jog down
        clears it (or squaring it would)."""
        from pixelopt import repair
        lay = _lay({"G": [[(0, 8), (20, 8), (20, 12), (0, 12)]],
                    "S": [[(4, 3), (6, 3), (6, 7), (4, 9), (4, 14), (2, 14), (2, 9), (2, 3)]]})
        # S: right edge x=6 up to y=7, jog (6,7)->(4,9) crossing G's bottom edge y=8, then x=4 up
        marks = [("X.1", [(5.0, 8.0), (5.5, 7.5), (5.7, 8.0)])]
        props = repair.propose(lay, marks, _CHECKS, 0.005, table=_TABLE)
        kinds = {p["kind"] for p in props}
        self.assertTrue(kinds & {"jog-shift", "jog-square"}, props)
        for p in props:
            for e in p["edits"]:
                self.assertLessEqual(abs(e["dx"]), 1.5 + 1e-9)
                self.assertLessEqual(abs(e["dy"]), 1.5 + 1e-9)

    def test_a_move_that_breaks_the_layer_own_spacing_is_screened_out(self):
        """A move may not bring a shape within its own layer's spacing of another (unless the
        start already was that close)."""
        from pixelopt import repair
        lay = _lay({"G": [[(0, 0), (5, 0), (5, 10), (0, 10)],
                          [(3.5, 11.0), (4.5, 11.0), (4.5, 20), (3.5, 20)]]})
        narrower = np.array([(0, 0), (4, 0), (4, 10), (0, 10)], float)
        taller = np.array([(0, 0), (5, 0), (5, 10.5), (0, 10.5)], float)
        self.assertTrue(repair._same_layer_ok(lay, "G", 0, narrower, _TABLE, lay_window()))
        self.assertFalse(repair._same_layer_ok(lay, "G", 0, taller, _TABLE, lay_window()))

    def test_verify_keeps_only_what_the_deck_confirms(self):
        from pixelopt import repair
        props = [{"rule": "X.1", "bbox": [0, 0, 1, 1], "kind": "edge-shift", "moveUm": 1.0,
                  "edits": [{"n": 1}]},
                 {"rule": "X.1", "bbox": [0, 0, 1, 1], "kind": "jog-shift", "moveUm": 1.25,
                  "edits": [{"n": 2}]},
                 {"rule": "X.1", "bbox": [0, 0, 1, 1], "kind": "jog-shift", "moveUm": 1.5,
                  "edits": [{"n": 3}]}]
        results = {1: {"total": 3, "byRule": {"X.1": 2, "Y.1": 1}},   # new rule: refused
                   2: {"total": 1, "byRule": {"X.1": 1}},
                   3: {"total": 0, "byRule": {}}}
        base = {"total": 2, "byRule": {"X.1": 2}}
        out, best = repair.verify(props, base, lambda eds: results[eds[0]["n"]])
        self.assertEqual([p["verified"] for p in out], [False, True, True])
        self.assertEqual(len(best), 1)
        self.assertEqual(best[0]["edits"][0]["n"], 3)


def lay_window():
    from shapely.geometry import box
    return box(-10, -10, 30, 30)


if __name__ == "__main__":
    unittest.main()
