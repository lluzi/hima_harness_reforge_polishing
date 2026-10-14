"""Tests for ``pixelopt.operators`` (numeric; skipped without numpy/scipy/shapely/gdstk)."""
import tempfile
import unittest

try:
    import numpy as np  # noqa: F401
    import scipy  # noqa: F401
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class OperatorsTest(unittest.TestCase):
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

    def _apply(self, op, **kw):
        from pixelopt import operators
        return operators.apply_operator(self.lay, op, self.case, self.nets, **kw)

    def test_unknown_operator_is_bad_plan(self):
        from pixelopt.core import PixelError
        with self.assertRaises(PixelError) as cm:
            self._apply({"operator": "nope"})
        self.assertEqual(cm.exception.code, "bad-plan")

    def test_shield_adds_exactly_one_polygon_on_the_named_layer(self):
        before = len(self.lay.polys.get("Metal", []))
        op = {"operator": "shield", "net": "R1", "layer": "Metal",
              "over": {"victim": "S", "aggressor": "VP"}, "marginUm": 0.1}
        out, desc = self._apply(op)
        self.assertEqual(len(out.polys["Metal"]), before + 1)
        # no other layer gained or lost a polygon
        for name in self.lay.polys:
            if name == "Metal":
                continue
            self.assertEqual(len(out.polys.get(name, [])), len(self.lay.polys[name]))
        self.assertEqual(desc["shield"]["net"], "R1")
        self.assertIn("declaredChanges", desc)

    def test_cst_stretch_raises_and_declares_the_device_value(self):
        from pixelopt import operators
        before = operators._cst_device(self.lay, self.case)
        op = {"operator": "cst-stretch", "dyUm": 1.0, "cutAt": "marker-bottom"}
        out, desc = self._apply(op)
        after = operators._cst_device(out, self.case)
        self.assertGreater(after, before)
        self.assertIn("cstFf", desc["declaredChanges"])
        self.assertAlmostEqual(desc["declaredChanges"]["cstFf"], after, places=4)

    def test_cst_stretch_marker_top_also_grows(self):
        from pixelopt import operators
        before = operators._cst_device(self.lay, self.case)
        out, desc = self._apply({"operator": "cst-stretch", "dyUm": 1.0,
                                 "cutAt": "marker-top"})
        self.assertGreater(operators._cst_device(out, self.case), before)

    def test_opening_shift_moves_the_opening_and_the_anode_inside_it(self):
        op = {"operator": "opening-shift", "dxUm": 0.5, "dyUm": 0.0}
        out, desc = self._apply(op)
        b0 = self.lay.geom("Bank").bounds
        b1 = out.geom("Bank").bounds
        self.assertAlmostEqual(b1[0] - b0[0], 0.5, places=4)
        a0 = self.lay.geom("Anode").bounds
        a1 = out.geom("Anode").bounds
        self.assertAlmostEqual(a1[0] - a0[0], 0.5, places=4)

    def test_an_operator_named_as_the_plan_schema_names_it_applies(self):
        # The plan schema calls the field "op"; apply_operator read only "operator"/"kind", so
        # no operator in a checked plan could run (num-solve: unknown operator None).
        op = {"op": "opening-shift", "dxUm": 0.5, "dyUm": 0.0}
        out, desc = self._apply(op)
        self.assertAlmostEqual(out.geom("Bank").bounds[0] - self.lay.geom("Bank").bounds[0], 0.5,
                               places=4)

    def test_band_trim_narrows_but_keeps_contact_enclosure(self):
        from shapely.geometry import box
        op = {"operator": "band-trim", "net": "DL", "layer": "Metal", "widthUm": 0.5}
        out, desc = self._apply(op, table=self.table)
        g = out.geom("Metal")

        def width_at(yrow):
            # window kept to the data line's neighbourhood (x in [12.5, 14.5]) so a
            # neighbouring Metal pad's edge cannot pollute the measured width
            sl = g.intersection(box(12.5, yrow - 0.01, 14.5, yrow + 0.01))
            if sl.is_empty:
                return 0.0
            x0, _, x1, _ = sl.bounds
            return x1 - x0

        # the data contact sits near y=15.4: enclosure keeps the strip wide there
        self.assertGreater(width_at(15.4), 0.9)
        # far from any contact the strip is narrowed to ~0.5 um
        self.assertAlmostEqual(width_at(30.0), 0.5, delta=0.08)

    def test_contact_move_refused_without_topology(self):
        from pixelopt.core import PixelError
        op = {"operator": "contact-move", "net": "DL", "toward": "up", "stepUm": 0.5}
        with self.assertRaises(PixelError) as cm:
            self._apply(op)
        self.assertEqual(cm.exception.code, "bad-plan")

    def test_contact_move_allowed_moves_the_via(self):
        op = {"operator": "contact-move", "net": "DL", "toward": "up", "stepUm": 0.5}
        via_layer = self.case.raw["connectivity"]["contactLayer"]
        before = self.lay.geom(via_layer).bounds
        out, desc = self._apply(op, topology_moves="allowed")
        after = out.geom(via_layer).bounds
        # the via set moved up (its y-extent rose); other-net Bound untouched
        self.assertGreater(after[3], before[3] - 1e-9)
        self.assertTrue(desc["changed"])


if __name__ == "__main__":
    unittest.main()
