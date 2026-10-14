import tempfile
import unittest

try:
    import gdstk  # noqa: F401
    import numpy as np
    import shapely  # noqa: F401
    HAVE = True
except ImportError:  # stdlib-only runs skip this file
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class GeometryTest(unittest.TestCase):
    def setUp(self):
        from tests import fixtures
        from pixelopt import manifest, layout, rules
        self.tmp = tempfile.TemporaryDirectory()
        built = fixtures.build_case(self.tmp.name)
        self.case = manifest.load_case(built["manifest"])
        self.lay = layout.load_gds(built["gds"], self.case,
                                   top=self.case.raw["original"]["topCell"])
        with open(self.case.file(self.case.raw["decks"]["authority"])) as fh:
            text = fh.read()
        self.parsed = rules.parse_deck(text)

    def tearDown(self):
        self.tmp.cleanup()

    def test_measure_of_the_original(self):
        from pixelopt import geometry
        m = geometry.measure(self.lay, self.case, self.lay, self.parsed)
        self.assertEqual(m["outlineUm"], [20.0, 40.0])
        self.assertEqual(m["channelsChanged"], 0)
        self.assertEqual(m["interactViolations"], {})
        # CapMark & GateA & GateB = the 5x5 GateB plate region, x 0.6 fF/um^2.
        self.assertAlmostEqual(m["cstDeviceFf"], 15.0, places=4)
        self.assertAlmostEqual(m["cstMarkerAreaUm2"], 36.0, places=4)
        self.assertAlmostEqual(m["oledAreaUm2"], 28.0, places=4)
        self.assertIsNotNone(m["pdlSymmetryMin"])
        self.assertEqual(m["offGridVertices"], 0)
        self.assertEqual(m["badAngleEdges"], 0)
        for expected in ("S", "VP", "SC", "EN", "R1", "DL", "AN"):
            self.assertIn(expected, m["nets"])
        self.assertLessEqual(m["tTiledPct"], m["tOwnPct"] + 1e-9)

    def test_tiled_transmittance_below_own_when_a_neighbour_overhangs(self):
        from pixelopt import geometry, manifest, layout
        raw = {
            "candidateTopCell": "c", "gridUm": 0.005,
            "layers": {
                "Bound": {"gds": [12, 0], "roles": ["outline"]},
                "Metal": {"gds": [4, 0], "roles": ["conductor", "opaque"]},
            },
        }
        case = manifest.Case(raw, self.tmp.name)
        lay = layout.Layout({
            "Bound": [np.array([[0, 0], [10, 0], [10, 10], [0, 10]], float)],
            # An opaque shape poking out of the right edge (x up to 12 > 10): its
            # left-neighbour copy pokes back into the empty left side of the cell.
            "Metal": [np.array([[8, 4], [12, 4], [12, 6], [8, 6]], float)],
        })
        t_tiled = geometry.transmittance(lay, case, True)
        t_own = geometry.transmittance(lay, case, False)
        self.assertLess(t_tiled, t_own)

    def test_reshaped_channel_with_same_bbox_counts_as_changed(self):
        from pixelopt import geometry
        layb = self.lay.copy()
        gatea = layb.polys["GateA"]
        sc_idx = None
        for i, p in enumerate(gatea):
            if abs(p[:, 0].min() - 15.5) < 1e-6 and abs(p[:, 0].max() - 16.5) < 1e-6:
                sc_idx = i
                break
        self.assertIsNotNone(sc_idx)
        # Re-shape the scan line with a notch on its right edge inside the first
        # channel's y-range, keeping the channel's bounding box corners intact.
        notched = np.array([[15.5, -1], [16.5, -1], [16.5, 15.3], [16.2, 15.3],
                            [16.2, 15.7], [16.5, 15.7], [16.5, 41], [15.5, 41]],
                           float)
        layb.polys["GateA"][sc_idx] = notched

        m = geometry.measure(layb, self.case, self.lay, self.parsed)
        self.assertGreaterEqual(m["channelsChanged"], 1)

        # The vendor prototype's blind spot: the channel bounding boxes are
        # unchanged, so a bbox-only check would miss the reshape.
        before = set(r["bbox"] for r in geometry._channels(self.lay, self.case))
        after = set(r["bbox"] for r in geometry._channels(layb, self.case))
        self.assertEqual(before, after)

    def test_interact_violation_counted_after_deleting_a_landing(self):
        from pixelopt import geometry
        layb = self.lay.copy()
        # Drop the Metal pad of the S contact; its via now touches a gate but no
        # Metal, so no VIA.LAND alternative is satisfied.
        kept = []
        for p in layb.polys["Metal"]:
            lo, hi = p.min(0), p.max(0)
            if abs(lo[0] - 8.5) < 1e-6 and abs(hi[0] - 9.5) < 1e-6 \
                    and abs(lo[1] - 8.8) < 1e-6:
                continue
            kept.append(p)
        self.assertEqual(len(kept), len(layb.polys["Metal"]) - 1)
        layb.polys["Metal"] = kept
        m = geometry.measure(layb, self.case, self.lay, self.parsed)
        self.assertGreaterEqual(m["interactViolations"].get("VIA.LAND", 0), 1)


if __name__ == "__main__":
    unittest.main()
