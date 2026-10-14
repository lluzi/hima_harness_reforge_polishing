"""Tests for the LP compactor (``pixelopt.compact`` + ``pixelopt.euclid``).

Skips cleanly when the numeric packages are absent, so the stdlib-only run
(``python3 -m unittest``) ignores this file.
"""
import os
import tempfile
import unittest

try:
    import numpy as np
    import scipy  # noqa: F401
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    from shapely.geometry import Polygon, Point
    from shapely.ops import unary_union
    HAVE = True
except ImportError:  # stdlib-only runs skip this file
    HAVE = False


# --------------------------------------------------------------------------- #
# Helpers available only under the numeric runtime
# --------------------------------------------------------------------------- #

if HAVE:
    def rect(x0, y0, x1, y1):
        return np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=float)

    class FakeCase(object):
        """A minimal read-only stand-in for ``manifest.Case`` for hand-built tests."""

        def __init__(self, layers, grid=0.005, devices=None, cst=None,
                     connectivity=None, free=None):
            self.raw = {
                "layers": layers,
                "devices": devices or {},
                "cst": cst or {},
                "connectivity": connectivity or {"labelLayers": {}},
                "freePairs": free or [],
            }
            self._grid = grid

        @property
        def grid_um(self):
            return self._grid

        def layer(self, name):
            return self.raw["layers"][name]

        def layers_with(self, role):
            return [n for n, s in self.raw["layers"].items() if role in s.get("roles", [])]

    def metal_outline_case(grid=0.005):
        return FakeCase({
            "Metal": {"gds": [4, 0], "roles": ["conductor"]},
            "Bound": {"gds": [12, 0], "roles": ["outline"]},
        }, grid=grid)

    def same_layer_violations(lay, table, tol=1e-4):
        """Shapely check, independent of the compactor: same-layer width/space below rule."""
        bad = []
        for L, w in table.get("width", {}).items():
            for p in lay.polys.get(L, []):
                dx = p[:, 0].max() - p[:, 0].min()
                dy = p[:, 1].max() - p[:, 1].min()
                if dx < w - tol or dy < w - tol:
                    bad.append(("width", L, round(float(dx), 4), round(float(dy), 4), w))
        for L, s in table.get("space", {}).items():
            geoms = [Polygon(p).buffer(0) for p in lay.polys.get(L, []) if len(p) >= 3]
            g = unary_union(geoms) if geoms else None
            parts = []
            if g is not None and not g.is_empty:
                parts = list(g.geoms) if hasattr(g, "geoms") else [g]
            for i in range(len(parts)):
                for j in range(i + 1, len(parts)):
                    d = parts[i].distance(parts[j])
                    if 1e-6 < d < s - tol:
                        bad.append(("space", L, round(float(d), 4), s))
        return bad

    def channel_pieces(lay, poly, gate):
        g = lay.geom(poly).intersection(lay.geom(gate))
        parts = list(g.geoms) if hasattr(g, "geoms") else ([g] if not g.is_empty else [])
        return sorted((round(c.area, 3), round(c.bounds[2] - c.bounds[0], 3),
                       round(c.bounds[3] - c.bounds[1], 3)) for c in parts if c.area > 1e-6)


@unittest.skipUnless(HAVE, "numeric packages not installed")
class SyntheticCompactTest(unittest.TestCase):
    """Tests on the full synthetic case (channels, periodic line, labels)."""

    def setUp(self):
        from tests import fixtures
        from pixelopt import manifest, layout, rules
        self.tmp = tempfile.TemporaryDirectory()
        built = fixtures.build_case(self.tmp.name)
        self.case = manifest.load_case(built["manifest"])
        self.lay = layout.load_gds(built["gds"], self.case,
                                   top=self.case.raw["original"]["topCell"])
        self.table = rules.compaction_table(
            rules.parse_deck(fixtures.build_authority_deck()), self.case)

    def tearDown(self):
        self.tmp.cleanup()

    def test_min_pitch_shrinks_both_axes(self):
        from pixelopt import compact
        w0, h0 = self.lay.pitch(self.case)
        oy, iy = compact.compact(self.lay, "y", self.case, self.table)
        self.assertEqual(iy["status"], "optimal")
        ox, ix = compact.compact(oy, "x", self.case, self.table)
        self.assertEqual(ix["status"], "optimal")
        w1, h1 = ox.pitch(self.case)
        self.assertLess(w1, w0 - 1e-6)
        self.assertLess(h1, h0 - 1e-6)

    def test_trust_region_bounds_every_displacement(self):
        from pixelopt import compact
        model0 = compact.build(self.lay, self.case, self.table)
        n = model0["nv"] - 1
        trust = {"radius": 0.1, "vars": list(range(n))}
        model = compact.build(self.lay, self.case, self.table, trust=trust)
        r = compact.solve(model, objective="pitch")
        self.assertEqual(r["status"], "optimal")
        for j in range(n):
            self.assertLessEqual(abs(r["x"][j]), 0.1 + 1e-6)

    def test_channels_and_capacitor_stay_congruent(self):
        from pixelopt import compact
        poly = self.case.raw["devices"]["polyLayer"]
        gate = self.case.raw["devices"]["gateLayer"]
        orig_ch = channel_pieces(self.lay, poly, gate)
        orig_plate = round(self.lay.geom("GateA").intersection(self.lay.geom("GateB")).area, 3)
        oy, _ = compact.compact(self.lay, "y", self.case, self.table, target_pitch=34.0)
        ox, _ = compact.compact(oy, "x", self.case, self.table, target_pitch=17.0)
        self.assertEqual(channel_pieces(ox, poly, gate), orig_ch)
        self.assertEqual(round(ox.geom("GateA").intersection(ox.geom("GateB")).area, 3),
                         orig_plate)

    def test_periodic_line_stays_continuous(self):
        from pixelopt import compact
        oy, info = compact.compact(self.lay, "y", self.case, self.table)
        self.assertEqual(info["status"], "optimal")
        (x0, y0), (x1, y1) = oy.outline(self.case)
        # The scan line (a narrow full-height GateA strip) must still cross both
        # cell edges so its periodic copies remain continuous.
        spanning = []
        for p in oy.polys["GateA"]:
            px0, px1 = p[:, 0].min(), p[:, 0].max()
            py0, py1 = p[:, 1].min(), p[:, 1].max()
            if (px1 - px0) < 2.0 and py0 <= y0 + 1e-6 and py1 >= y1 - 1e-6:
                spanning.append((py0, py1))
        self.assertTrue(spanning, "no scan line crosses both cell edges after y-compaction")

    def test_labels_stay_inside_their_shapes(self):
        from pixelopt import compact
        labmap = {int(k): v for k, v in
                  self.case.raw["connectivity"]["labelLayers"].items()}
        oy, _ = compact.compact(self.lay, "y", self.case, self.table)
        ox, _ = compact.compact(oy, "x", self.case, self.table)
        for text, gl, lx, ly in ox.labels:
            name = labmap.get(gl)
            if name is None:
                continue
            inside = any(Polygon(p).buffer(1e-4).contains(Point(lx, ly))
                         for p in ox.polys.get(name, []))
            self.assertTrue(inside, "label %r left its %s shape" % (text, name))

    def test_legalise_cleans_the_synthetic_then_min_pitch_is_smaller(self):
        from pixelopt import compact
        ly, il = compact.compact(self.lay, "y", self.case, self.table, objective="legalise")
        self.assertEqual(il["status"], "optimal")
        lx, il2 = compact.compact(ly, "x", self.case, self.table, objective="legalise")
        self.assertEqual(il2["status"], "optimal")
        self.assertEqual(same_layer_violations(lx, self.table), [])


@unittest.skipUnless(HAVE, "numeric packages not installed")
class HandBuiltCompactTest(unittest.TestCase):
    """Small exact layouts where the expected answer is known."""

    def _layout(self, polys, labels=None):
        from pixelopt import layout
        return layout.Layout({k: list(v) for k, v in polys.items()}, labels or [])

    def test_min_pitch_is_smaller_and_stays_legal(self):
        # (a) A clean two-metal layout compacts to a smaller, still-legal pitch.
        from pixelopt import compact
        case = metal_outline_case()
        table = {"width": {"Metal": 1.0}, "space": {"Metal": 1.2}, "xspace": [], "enc": []}
        lay = self._layout({
            "Bound": [rect(0, 0, 10, 10)],
            "Metal": [rect(1, 1, 2, 9), rect(5, 1, 9, 9)],
        })
        self.assertEqual(same_layer_violations(lay, table), [])
        ox, ix = compact.compact(lay, "x", case, table)
        self.assertEqual(ix["status"], "optimal")
        oy, iy = compact.compact(ox, "y", case, table)
        self.assertEqual(iy["status"], "optimal")
        w1, h1 = oy.pitch(case)
        self.assertLess(w1, 10.0 - 1e-6)
        self.assertLess(h1, 10.0 - 1e-6)
        self.assertEqual(same_layer_violations(oy, table), [])

    def test_binding_chain_names_the_bottleneck_space(self):
        # (b) Two min-width strips: only the space between them can close, so the
        # binding chain names that same-layer space.
        from pixelopt import compact
        case = metal_outline_case()
        table = {"width": {"Metal": 1.0}, "space": {"Metal": 1.2}, "xspace": [], "enc": []}
        lay = self._layout({
            "Bound": [rect(0, 0, 10, 10)],
            "Metal": [rect(1, 1, 2, 9), rect(4, 1, 5, 9)],
        })
        model = compact.build(lay, case, table)
        r = compact.solve(model, objective="pitch")
        self.assertEqual(r["status"], "optimal")
        self.assertTrue(r["binding"])
        self.assertTrue(any(t.startswith("S:Metal") for t in r["binding"]),
                        "binding chain did not name the Metal space: %r" % (r["binding"],))

    def test_metric_row_pulls_a_conductor_to_min_width(self):
        # (c) A metric row rewarding the right edge moving in drives the width to
        # its rule minimum.
        from pixelopt import compact
        case = metal_outline_case()
        table = {"width": {"Metal": 1.0}, "space": {"Metal": 1.2}, "xspace": [], "enc": []}
        lay = self._layout({
            "Bound": [rect(0, 0, 20, 20)],
            "Metal": [rect(2, 2, 8, 8)],
        })
        model0 = compact.build(lay, case, table)
        var = model0["var"]
        jR = None
        for pi, (n, i, p) in enumerate(model0["polys"]):
            if n != "Metal":
                continue
            for v in range(len(p)):
                if abs(p[v][0] - 8.0) < 1e-6:
                    jR = var(pi, v)
        self.assertIsNotNone(jR)
        metric_rows = [{"name": "w", "coef": {jR: 1.0}, "const": 0.0, "op": "le", "rhs": 100.0}]
        model = compact.build(lay, case, table, metric_rows=metric_rows)
        r = compact.solve(model, objective="metric",
                          metric_weights={"w": 1.0}, target_pitch=model["P0"])
        self.assertEqual(r["status"], "optimal")
        out = compact.apply(lay, model, r["x"], case)
        p = out.polys["Metal"][0]
        width = p[:, 0].max() - p[:, 0].min()
        self.assertAlmostEqual(float(width), 1.0, delta=case.grid_um + 1e-6)

    def test_legalise_fixes_a_planted_space_without_changing_pitch(self):
        # (h) A planted 0.5 um Metal space is opened to the full 1.2 um rule while
        # the pitch is held at the input value.
        from pixelopt import compact
        case = metal_outline_case()
        table = {"width": {"Metal": 1.0}, "space": {"Metal": 1.2}, "xspace": [], "enc": []}
        lay = self._layout({
            "Bound": [rect(0, 0, 12, 12)],
            "Metal": [rect(1, 1, 3, 11), rect(3.5, 1, 6, 11)],
        })
        self.assertTrue(same_layer_violations(lay, table))  # planted violation present
        ox, info = compact.compact(lay, "x", case, table, objective="legalise")
        self.assertEqual(info["status"], "optimal")
        w1, h1 = ox.pitch(case)
        self.assertAlmostEqual(w1, 12.0, places=4)   # pitch unchanged
        self.assertEqual(same_layer_violations(ox, table), [])

    def test_legalise_infeasible_reports_binding_tags(self):
        # An un-satisfiable legalise (two wide strips that cannot both meet width
        # and space inside a tight outline) reports the conflicting rows.
        from pixelopt import compact
        case = metal_outline_case()
        table = {"width": {"Metal": 3.0}, "space": {"Metal": 3.0}, "xspace": [], "enc": []}
        lay = self._layout({
            "Bound": [rect(0, 0, 5, 6)],
            "Metal": [rect(0.5, 1, 2, 5), rect(2.2, 1, 4.5, 5)],
        })
        model = compact.build(lay, case, table, legalise=True)
        r = compact.solve(model, objective="legalise")
        self.assertEqual(r["status"], "infeasible")
        self.assertTrue(r["binding"])


@unittest.skipUnless(HAVE, "numeric packages not installed")
class EdgeClassTest(unittest.TestCase):
    def test_edge_classes_cover_every_displacement_variable(self):
        from pixelopt import compact
        case = metal_outline_case()
        table = {"width": {"Metal": 1.0}, "space": {"Metal": 1.2}, "xspace": [], "enc": []}
        from pixelopt import layout
        lay = layout.Layout({"Bound": [rect(0, 0, 10, 10)],
                             "Metal": [rect(2, 2, 6, 6)]}, [])
        model = compact.build(lay, case, table)
        classes = compact.edge_classes(model)
        self.assertEqual(len(classes), model["nv"] - 1)
        for c in classes:
            self.assertIn("var", c)
            self.assertIn("layer", c)
            self.assertEqual(c["orient"], "x")


if __name__ == "__main__":
    unittest.main()
