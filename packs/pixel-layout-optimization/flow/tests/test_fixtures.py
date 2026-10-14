"""Tests for the real gdstk-drawn synthetic case (skipped without gdstk)."""
import tempfile
import unittest

try:
    import gdstk  # noqa: F401
    _HAVE_GDSTK = True
except ImportError:
    _HAVE_GDSTK = False

from pixelopt import manifest as mani
from tests import fixtures


@unittest.skipUnless(_HAVE_GDSTK, "gdstk not installed")
class TestBuildCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.built = fixtures.build_case(self.dir)

    def test_load_case_accepts_built_manifest(self):
        case = mani.load_case(self.built["manifest"])
        self.assertEqual(case.case_id, "synthetic-1")
        self.assertEqual(case.candidate_top_cell, "pix")

    def test_gds_is_real_and_has_expected_layers(self):
        lib = gdstk.read_gds(self.built["gds"])
        names = [c.name for c in lib.cells]
        self.assertIn("pix", names)
        cell = [c for c in lib.cells if c.name == "pix"][0]
        layers = set((p.layer, p.datatype) for p in cell.polygons)
        # outline, device and top-stack layers are all present
        for want in [(12, 0), (2, 0), (3, 0), (4, 0), (19, 0), (7, 0),
                     (5, 0), (9, 0), (6, 0), (14, 0), (11, 0)]:
            self.assertIn(want, layers)
        label_layers = set(lb.layer for lb in cell.labels)
        self.assertEqual({2, 3, 4, 19}, label_layers)

    def test_scan_line_crosses_boundary(self):
        lib = gdstk.read_gds(self.built["gds"])
        cell = [c for c in lib.cells if c.name == "pix"][0]
        # at least one GateA polygon extends beyond the 0..40 outline in y
        crosses = False
        for p in cell.polygons:
            if (p.layer, p.datatype) == (2, 0):
                ys = p.points[:, 1]
                if ys.min() < 0 or ys.max() > 40:
                    crosses = True
        self.assertTrue(crosses)


if __name__ == "__main__":
    unittest.main()
