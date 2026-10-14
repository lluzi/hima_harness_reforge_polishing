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
    def test_fit_recovers_planted_coefficients(self):
        from pixelopt import attribution
        rng = random.Random(1234)
        coef = {"ov:A-B": 2.5, "fr1.0:A-B": 0.4}
        intercept = 1.2
        rows = []
        for _ in range(10):
            f = {"ov:A-B": rng.uniform(1.0, 5.0),
                 "fr1.0:A-B": rng.uniform(0.0, 3.0)}
            cap = intercept + coef["ov:A-B"] * f["ov:A-B"] + coef["fr1.0:A-B"] * f["fr1.0:A-B"]
            rows.append(({"P|Q": f}, {"P|Q": cap}))
        model = attribution.fit(rows, [("P", "Q")])
        info = model["pairs"]["P|Q"]
        self.assertFalse(info["reduced"])
        self.assertGreater(info["r2"], 0.95)
        self.assertAlmostEqual(info["coef"]["ov:A-B"], 2.5, delta=0.05)
        self.assertAlmostEqual(info["coef"]["fr1.0:A-B"], 0.4, delta=0.05)
        self.assertAlmostEqual(info["intercept"], 1.2, delta=0.1)

        # the model is JSON-serialisable (state/model.json)
        import json
        json.dumps(model)

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

    def test_fit_falls_back_to_reduced_set_when_short_of_rows(self):
        from pixelopt import attribution
        # three features but only two rows -> reduced 3-term model
        rows = [
            ({"P|Q": {"ov:A-B": 1.0, "ov:C-D": 2.0, "fr1.0:A-B": 0.5}}, {"P|Q": 5.0}),
            ({"P|Q": {"ov:A-B": 2.0, "ov:C-D": 1.0, "fr1.0:A-B": 1.0}}, {"P|Q": 6.0}),
        ]
        model = attribution.fit(rows, [("P", "Q")])
        info = model["pairs"]["P|Q"]
        self.assertTrue(info["reduced"])
        self.assertEqual(sorted(info["features"]), ["__fr1__", "__fr25__", "__ov__"])
        # predict still works on the reduced model
        pred = attribution.predict(model, {"P|Q": {"ov:A-B": 1.0, "ov:C-D": 2.0, "fr1.0:A-B": 0.5}})
        self.assertIn("P|Q", pred)


if __name__ == "__main__":
    unittest.main()
