"""Tests for ``pixelopt.edits`` (numeric; skipped without numpy/shapely/gdstk)."""
import tempfile
import unittest

try:
    import numpy as np
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class EditsTest(unittest.TestCase):
    def setUp(self):
        from tests import fixtures
        from pixelopt import manifest, layout
        self.tmp = tempfile.TemporaryDirectory()
        built = fixtures.build_case(self.tmp.name)
        self.case = manifest.load_case(built["manifest"])
        self.lay = layout.load_gds(built["gds"], self.case,
                                   top=self.case.raw["original"]["topCell"])

    def tearDown(self):
        self.tmp.cleanup()

    def _find(self, layer, bbox, tol=1e-3):
        """Index of the polygon on ``layer`` whose bounding box matches ``bbox``."""
        for i, p in enumerate(self.lay.polys.get(layer, [])):
            lo = p.min(0)
            hi = p.max(0)
            if (abs(lo[0] - bbox[0]) < tol and abs(lo[1] - bbox[1]) < tol
                    and abs(hi[0] - bbox[2]) < tol and abs(hi[1] - bbox[3]) < tol):
                return i
        self.fail("no %s polygon with bbox %s" % (layer, bbox))

    def test_valid_edit_applies_and_snaps(self):
        from pixelopt import edits
        idx = self._find("Metal", (1.0, 33.0, 12.0, 34.0))  # the R1 line, far from channels
        before = self.lay.polys["Metal"][idx].copy()
        out, log = edits.apply_edits(
            self.lay, [{"layer": "Metal", "polygon": idx, "vertices": [0],
                        "dx": 0.5, "dy": 0.0}], self.case)
        self.assertEqual(len(log), 1)
        moved = out.polys["Metal"][idx][0]
        self.assertAlmostEqual(moved[0], before[0][0] + 0.5, places=4)
        self.assertAlmostEqual(moved[1], before[0][1], places=4)
        # grid snap (0.005 um)
        self.assertAlmostEqual((moved[0] / self.case.grid_um) % 1.0, 0.0, places=6)

    def test_refuses_an_edge_that_slides_across_a_channel(self):
        """The scan line's edge has no vertex on a channel, yet moving it widens both TFT
        channels (flow5: a Gate1 edge shift changed m4's L from 6.6 to 5.6 um and failed LVS)."""
        from pixelopt import edits
        from pixelopt.core import PixelError
        idx = self._find("GateA", (15.5, -1.0, 16.5, 41.0))
        arr = self.lay.polys["GateA"][idx]
        edge = [e for e in range(len(arr))
                if abs(arr[e][0] - 16.5) < 1e-6 and abs(arr[(e + 1) % len(arr)][0] - 16.5) < 1e-6][0]
        with self.assertRaises(PixelError) as cm:
            edits.apply_edits(self.lay, [{"layer": "GateA", "polygon": idx, "edge": edge,
                                          "dx": 0.5, "dy": 0.0}], self.case)
        self.assertEqual(cm.exception.code, "bad-plan")
        self.assertIn("channel", cm.exception.detail)

    def test_box_cut_reshapes_and_is_bounded(self):
        """A designer-style local reshape: a box cut from the end of the R1 line moves the
        outline 1 um; a deeper one, or one that splits the line, is refused."""
        from pixelopt import edits
        from pixelopt.core import PixelError
        idx = self._find("Metal", (1.0, 33.0, 12.0, 34.0))
        out, log = edits.apply_edits(self.lay, [{"layer": "Metal", "polygon": idx, "op": "cut",
                                                 "box": [0.5, 32.5, 2.0, 34.5]}], self.case)
        p = out.polys["Metal"][idx]
        self.assertAlmostEqual(float(p[:, 0].min()), 2.0, places=4)
        self.assertEqual(log[0]["op"], "cut")
        for bx in ([0.5, 32.5, 3.0, 34.5], [5.0, 32.5, 6.0, 34.5]):
            with self.assertRaises(PixelError) as cm:
                edits.apply_edits(self.lay, [{"layer": "Metal", "polygon": idx, "op": "cut",
                                              "box": bx}], self.case)
            self.assertEqual(cm.exception.code, "bad-plan")

    def test_refuses_more_than_the_edit_bound(self):
        from pixelopt import edits
        from pixelopt.core import PixelError
        idx = self._find("Metal", (1.0, 33.0, 12.0, 34.0))
        with self.assertRaises(PixelError) as cm:
            edits.apply_edits(self.lay, [{"layer": "Metal", "polygon": idx,
                                          "vertices": [0], "dx": 2.0, "dy": 0.0}],
                              self.case)
        self.assertEqual(cm.exception.code, "bad-plan")

    def test_refuses_more_than_twelve_edits(self):
        from pixelopt import edits
        from pixelopt.core import PixelError
        idx = self._find("Metal", (1.0, 33.0, 12.0, 34.0))
        one = {"layer": "Metal", "polygon": idx, "vertices": [0], "dx": 0.1, "dy": 0.0}
        with self.assertRaises(PixelError) as cm:
            edits.apply_edits(self.lay, [dict(one) for _ in range(13)], self.case)
        self.assertEqual(cm.exception.code, "bad-plan")

    def test_refuses_a_channel_vertex(self):
        from pixelopt import edits
        from pixelopt.core import PixelError
        lay = self.lay.copy()
        # a dummy shape with a vertex inside the channel (Poly AND GateA at the TFT)
        dummy = np.array([[16.0, 15.5], [16.6, 15.5], [16.3, 16.0]])
        lay.polys.setdefault("Metal", []).append(dummy)
        idx = len(lay.polys["Metal"]) - 1
        with self.assertRaises(PixelError) as cm:
            edits.apply_edits(lay, [{"layer": "Metal", "polygon": idx,
                                     "vertices": [0], "dx": 0.1, "dy": 0.0}], self.case)
        self.assertEqual(cm.exception.code, "bad-plan")
        self.assertIn("channel", cm.exception.detail)

    def test_refuses_a_capacitor_vertex(self):
        from pixelopt import edits
        from pixelopt.core import PixelError
        idx = self._find("GateA", (3.0, 6.0, 9.0, 12.0))  # the storage-capacitor plate
        with self.assertRaises(PixelError) as cm:
            edits.apply_edits(self.lay, [{"layer": "GateA", "polygon": idx,
                                          "vertices": [0], "dx": 0.1, "dy": 0.1}],
                              self.case)
        self.assertEqual(cm.exception.code, "bad-plan")
        self.assertIn("capacitor", cm.exception.detail)


if __name__ == "__main__":
    unittest.main()
