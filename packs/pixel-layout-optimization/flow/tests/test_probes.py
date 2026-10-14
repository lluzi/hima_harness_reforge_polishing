"""Tests for ``pixelopt.probes`` (numeric; skipped without numpy/scipy/shapely/gdstk)."""
import tempfile
import unittest

try:
    import numpy as np
    import scipy  # noqa: F401
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class MakeProbesTest(unittest.TestCase):
    def setUp(self):
        from tests import fixtures
        from pixelopt import manifest, layout, rules, nets
        self.tmp = tempfile.TemporaryDirectory()
        built = fixtures.build_case(self.tmp.name)
        self.case = manifest.load_case(built["manifest"])
        self.lay = layout.load_gds(built["gds"], self.case,
                                   top=self.case.raw["original"]["topCell"])
        with open(self.case.file(self.case.raw["decks"]["authority"])) as fh:
            text = fh.read()
        self.table = rules.compaction_table(rules.parse_deck(text), self.case)
        self.nets = nets.extract(self.lay, self.case)

    def tearDown(self):
        self.tmp.cleanup()

    def test_probes_are_legal_levers_on_the_ct_sites(self):
        from pixelopt import probes, compact
        out = probes.make_probes(self.lay, self.case, self.table, None, self.nets,
                                 [("S", "AN")], k=3, step=0.2)
        self.assertTrue(out)
        good = [p for p in out if p["layout"] is not None]
        self.assertTrue(good, "no feasible probe produced")
        for p in good:
            self.assertIn("lever", p["meta"])
            self.assertIn("step", p["meta"])
            self.assertIn(p["meta"]["axis"], ("x", "y"))
            # the probe is a real candidate: it has an outline and a positive pitch
            (x0, y0), (x1, y1) = p["layout"].outline(self.case)
            self.assertGreater(x1 - x0, 0.0)
            self.assertGreater(y1 - y0, 0.0)
            # legal under the compaction table: its own LP (which encodes the
            # table) was feasible at the probe pitch
            L = p["layout"] if p["meta"]["axis"] == "x" else compact.transpose(p["layout"])
            model = compact.build(L, self.case, self.table)
            r = compact.solve(model, objective="movement")
            self.assertEqual(r["status"], "optimal")

    def test_dropped_probes_record_a_reason(self):
        from pixelopt import probes
        out = probes.make_probes(self.lay, self.case, self.table, None, self.nets,
                                 [("S", "AN")], k=4, step=0.2)
        for p in out:
            if p["layout"] is None:
                self.assertIn("dropped", p["meta"])


@unittest.skipUnless(HAVE, "numeric packages not installed")
class ProposePairsTest(unittest.TestCase):
    """Hand-built layouts: a tall shape with a mid-edge vertex facing another
    shape's edge, so the marker zone contains a real vertex."""

    def _layout(self, bx_left):
        from pixelopt.layout import Layout
        a = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 5.0], [1.0, 10.0], [0.0, 10.0]])
        b = np.array([[bx_left, 0.0], [bx_left + 1.0, 0.0],
                      [bx_left + 1.0, 10.0], [bx_left, 10.0]])
        return Layout({"Metal": [a, b]})

    def _parsed(self):
        # a single modelled same-layer space rule of 0.6 um
        return {"checks": [{"rule": "M.SP", "kind": "space", "layers": ["Metal"],
                            "value": 0.6, "modelled": True, "derivedFrom": None}],
                "derived": {}}

    def _marks(self):
        # a marker polygon over the facing region near the mid-edge vertex (1, 5)
        return [("M.SP", [[0.9, 4.0], [1.4, 4.0], [1.4, 6.0], [0.9, 6.0]])]

    def test_returns_the_planted_vertex_edge_pair(self):
        from pixelopt import probes
        lay = self._layout(1.3)   # gap 0.3 < 0.6: violated after the move
        base = self._layout(2.0)  # gap 1.0 >= 0.6: legal in base
        pairs = probes.propose_pairs(lay, self._marks(), self._parsed(), base, "x")
        self.assertTrue(pairs)
        # the mid-edge vertex (index 2 of polygon 0) is the planted vertex
        self.assertTrue(any(t[0] == "Metal" and t[2] == 2 for t in pairs))
        for t in pairs:
            self.assertEqual(len(t), 8)   # euclid.pair_constraints format
            self.assertEqual(t[7], 0)     # within the cell (k == 0)

    def test_none_for_a_place_already_violated_in_base(self):
        from pixelopt import probes
        lay = self._layout(1.3)   # gap 0.3
        base = self._layout(1.2)  # gap 0.2 < 0.6: already violated in base
        pairs = probes.propose_pairs(lay, self._marks(), self._parsed(), base, "x")
        self.assertEqual(pairs, [])


if __name__ == "__main__":
    unittest.main()
