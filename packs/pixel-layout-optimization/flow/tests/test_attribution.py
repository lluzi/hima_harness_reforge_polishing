"""Tests for ``pixelopt.attribution`` (numeric; skipped without numpy/scipy/shapely)."""
import random
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


@unittest.skipUnless(HAVE, "numeric packages not installed")
class AttributionTest(unittest.TestCase):
    def setUp(self):
        from tests import fixtures
        from pixelopt import manifest
        self.tmp = tempfile.TemporaryDirectory()
        built = fixtures.build_case(self.tmp.name)
        self.case = manifest.load_case(built["manifest"])

    def tearDown(self):
        self.tmp.cleanup()

    # -- geometry inputs (hand-crafted so the assertions are exact) ---------- #
    def _nets(self, extra=None):
        from shapely.geometry import box
        nets = {
            "nets": {
                "S": [("PolySD", box(0.0, 0.0, 4.0, 4.0))],
                "AN": [("GateB", box(2.0, 0.0, 6.0, 4.0))],
            },
            "channels": [],
            "unnamed": [],
        }
        if extra:
            nets["nets"].update(extra)
        return nets

    def test_screen_order_puts_polysd_first_anode_last(self):
        from pixelopt import attribution
        order = attribution._screen_order(self.case)
        self.assertEqual(order[0], "PolySD")
        self.assertEqual(order[-1], "Anode")
        self.assertIn("GateB", order)

    def test_feature_grows_with_overlap(self):
        from pixelopt import attribution
        from shapely.geometry import box
        pairs = [("S", "AN")]
        f1 = attribution.features(self._nets(), self.case, pairs)
        ov1 = f1["S|AN"]["ov:PolySD-GateB"]
        # widen the aggressor so the visible overlap grows
        wider = {"AN": [("GateB", box(1.0, 0.0, 6.0, 4.0))]}
        f2 = attribution.features(self._nets(wider), self.case, pairs)
        ov2 = f2["S|AN"]["ov:PolySD-GateB"]
        self.assertAlmostEqual(ov1, 8.0, places=4)
        self.assertAlmostEqual(ov2, 12.0, places=4)
        self.assertGreater(ov2, ov1)

    def test_screened_overlap_counts_zero(self):
        from pixelopt import attribution
        from shapely.geometry import box
        # a third net's conductor on GateA (strictly between PolySD and GateB)
        screen = {"X": [("GateA", box(0.0, 0.0, 6.0, 4.0))]}
        f = attribution.features(self._nets(screen), self.case, [("S", "AN")])
        self.assertAlmostEqual(f["S|AN"].get("ov:PolySD-GateB", 0.0), 0.0, places=6)

    def test_sites_reports_storage_node_coupling(self):
        from pixelopt import attribution
        sites = attribution.sites(self._nets(), self.case)
        self.assertTrue(sites)
        top = sites[0]
        self.assertEqual(top["victim"], "S")
        self.assertEqual(top["aggressor"], "AN")
        self.assertAlmostEqual(top["overlapUm2"], 8.0, places=4)

    # -- surrogate fit ------------------------------------------------------- #
    def test_pooled_fit_recovers_shared_coefficients_from_one_candidate(self):
        """Coefficients per layer-pair feature are shared by every net pair, so one extraction
        with many pairs determines them; each pair keeps its own offset."""
        from pixelopt import attribution
        rng = random.Random(3)
        feats, caps = {}, {}
        for i in range(30):
            pair = "N%02d|M%02d" % (i, i)
            f = {"ov:A-B": rng.uniform(0.0, 5.0), "fr1.0:A-B": rng.uniform(0.0, 8.0),
                 "ov:C-D": rng.uniform(0.0, 3.0)}
            feats[pair] = f
            caps[pair] = 2.5 * f["ov:A-B"] + 0.4 * f["fr1.0:A-B"] + 1.0 * f["ov:C-D"]
        model = attribution.fit([(feats, caps)], [("N00", "M00")])
        coef = model["pooled"]["coef"]
        self.assertAlmostEqual(coef["ov:A-B"], 2.5, delta=0.01)
        self.assertAlmostEqual(coef["fr1.0:A-B"], 0.4, delta=0.01)
        self.assertAlmostEqual(coef["ov:C-D"], 1.0, delta=0.01)
        pred = attribution.predict(model, feats)
        for pair in feats:
            self.assertAlmostEqual(pred[pair], caps[pair], delta=1e-6)
        import json
        json.dumps(model)

    def test_offset_absorbs_what_geometry_does_not_explain(self):
        from pixelopt import attribution
        rows = []
        for k in range(4):
            feats = {"P|Q": {"ov:A-B": 1.0 + k}, "R|S": {"ov:A-B": 2.0 + k}, "T|U": {"ov:A-B": 0.5 + k}}
            caps = {"P|Q": 2.0 * (1.0 + k) + 0.3, "R|S": 2.0 * (2.0 + k), "T|U": 2.0 * (0.5 + k)}
            rows.append((feats, caps))
        model = attribution.fit(rows, [("P", "Q")])
        self.assertAlmostEqual(model["pairs"]["P|Q"]["offset"], 0.3, delta=0.1)
        self.assertIsNotNone(model["pairs"]["P|Q"]["rmse"])

    def test_predict_matches_the_fitted_rows(self):
        from pixelopt import attribution
        rng = random.Random(7)
        coef = 3.0
        rows = []
        for _ in range(8):
            f = {"ov:A-B": rng.uniform(1.0, 4.0)}
            rows.append(({"P|Q": f}, {"P|Q": 0.5 + coef * f["ov:A-B"]}))
        model = attribution.fit(rows, [("P", "Q")])
        feats = {"P|Q": {"ov:A-B": 2.0}}
        pred = attribution.predict(model, feats)
        self.assertAlmostEqual(pred["P|Q"], 0.5 + coef * 2.0, delta=0.1)

@unittest.skipUnless(HAVE, "numeric packages not installed")
class GradientTest(unittest.TestCase):
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
        self.nets = nets

    def tearDown(self):
        self.tmp.cleanup()

    def _right_edge_var(self, comp_model, bbox, xedge):
        """Variable of the class holding the vertices at x == ``xedge`` of the
        polygon on 'Metal' whose bbox matches ``bbox``."""
        polys = comp_model["polys"]
        var = comp_model["var"]
        for pi, (n, i, p) in enumerate(polys):
            if n != "Metal":
                continue
            lo = p.min(0)
            hi = p.max(0)
            if (abs(lo[0] - bbox[0]) < 1e-3 and abs(hi[0] - bbox[2]) < 1e-3
                    and abs(lo[1] - bbox[1]) < 1e-3 and abs(hi[1] - bbox[3]) < 1e-3):
                for v in range(len(p)):
                    if abs(p[v][0] - xedge) < 1e-6:
                        return var(pi, v)
        self.fail("no Metal polygon with bbox %s" % (bbox,))

    def test_gradient_has_sign_of_the_facing_length(self):
        from pixelopt import attribution, compact
        # R1 (Metal, 1..12 x 33..34) faces the data line DL (Metal, 13..14) across
        # a 1 um gap on the same layer. A surrogate whose coupling rises with the
        # Metal-Metal fringe must have a POSITIVE gradient for the R1 right edge:
        # moving it toward DL (+x) lengthens the facing and raises the coupling.
        model = {"pairs": {"R1|DL": {
            "coef": {"fr1.0:Metal-Metal": 1.0}, "intercept": 0.0,
            "features": ["fr1.0:Metal-Metal"], "reduced": False,
            "n": 1, "rmse": None, "r2": None}}}
        comp_model = compact.build(self.lay, self.case, self.table)
        out = attribution.gradients(model, self.lay, self.case, comp_model,
                                    [("R1", "DL")], axis="x")
        self.assertIn("R1|DL", out["base"])
        self.assertGreaterEqual(out["differenced"], 1)
        self.assertLessEqual(out["differenced"], out["considered"])
        jr = self._right_edge_var(comp_model, (1.0, 33.0, 12.0, 34.0), 12.0)
        self.assertIn(jr, out["gradients"]["R1|DL"])
        self.assertGreater(out["gradients"]["R1|DL"][jr], 0.0)


if __name__ == "__main__":
    unittest.main()
