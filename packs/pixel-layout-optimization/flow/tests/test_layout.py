import os, tempfile, unittest

try:
    import gdstk  # noqa: F401
    import numpy as np
    HAVE = True
except ImportError:  # stdlib-only runs skip this file
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class LayoutTest(unittest.TestCase):
    def setUp(self):
        from tests import fixtures
        from pixelopt import manifest
        self.tmp = tempfile.TemporaryDirectory()
        built = fixtures.build_case(self.tmp.name)
        self.case = manifest.load_case(built["manifest"])
        self.gds = built["gds"]

    def tearDown(self):
        self.tmp.cleanup()

    def test_round_trip_and_tiles(self):
        from pixelopt import layout
        lay = layout.load_gds(self.gds, self.case, top=self.case.raw["original"]["topCell"])
        self.assertTrue(lay.polys)
        self.assertEqual(lay.dropped, {})
        w, h = lay.pitch(self.case)
        out = layout.write_set(lay, os.path.join(self.tmp.name, "c"), self.case)
        top = self.case.raw["candidateTopCell"]
        self.assertEqual(out["1x1"][1], top)
        self.assertEqual(out["3x3"][1], top + "3x3")
        back = layout.load_gds(out["1x1"][0], self.case, top=top)
        self.assertEqual(sorted(back.polys), sorted(lay.polys))
        self.assertEqual(len(back.labels), len(lay.labels))
        tiled = layout.load_gds(out["3x3"][0], self.case, top=top + "3x3")
        name = self.case.layers_with("outline")[0]
        self.assertEqual(len(tiled.polys[name]), 9)
        pts = np.vstack(tiled.polys[name])
        self.assertAlmostEqual(float(pts[:, 0].max() - pts[:, 0].min()), 3 * w, places=4)
        self.assertAlmostEqual(float(pts[:, 1].max() - pts[:, 1].min()), 3 * h, places=4)

    def test_transpose_is_an_involution_and_clean_drops_collinear(self):
        from pixelopt import layout
        lay = layout.load_gds(self.gds, self.case, top=self.case.raw["original"]["topCell"])
        tt = layout.transpose(layout.transpose(lay))
        for n in lay.polys:
            for a, b in zip(lay.polys[n], tt.polys[n]):
                self.assertTrue((a == b).all())
        sq = layout.Layout({"X": [np.array([[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]], float)]})
        self.assertEqual(len(layout.clean(sq).polys["X"][0]), 4)


if __name__ == "__main__":
    unittest.main()
