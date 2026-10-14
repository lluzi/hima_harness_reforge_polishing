import tempfile
import unittest

try:
    import gdstk  # noqa: F401
    import numpy as np  # noqa: F401
    import shapely  # noqa: F401
    HAVE = True
except ImportError:  # stdlib-only runs skip this file
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class NetsTest(unittest.TestCase):
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

    def test_nets_named_as_labelled(self):
        from pixelopt import nets
        out = nets.extract(self.lay, self.case)
        named = set(out["nets"]) - set(out["unnamed"])
        for expected in ("S", "VP", "SC", "EN", "R1", "DL", "AN"):
            self.assertIn(expected, named, "net %r missing from %s" % (expected, named))

    def test_storage_capacitor_plates_are_distinct_nets(self):
        from pixelopt import nets
        out = nets.extract(self.lay, self.case)
        # The GateA plate (storageNode S) and the GateB plate (storageNet VP) are
        # separate nets: the via lands on GateB first, never shorting them.
        layers_s = [n for n, _g in out["nets"].get("S", [])]
        layers_vp = [n for n, _g in out["nets"].get("VP", [])]
        self.assertIn("GateA", layers_s)
        self.assertIn("GateB", layers_vp)

    def test_anode_net_carries_its_anode_layer(self):
        from pixelopt import nets
        out = nets.extract(self.lay, self.case)
        an_layers = [n for n, _g in out["nets"].get("AN", [])]
        # The anode via joins the driving Metal pad to the Anode plate.
        self.assertIn("Metal", an_layers)
        self.assertIn("Anode", an_layers)

    def test_polysd_reported_and_channels_counted(self):
        from pixelopt import nets
        out = nets.extract(self.lay, self.case)
        self.assertEqual(len(out["channels"]), 2)
        all_layers = set()
        for items in out["nets"].values():
            for n, _g in items:
                all_layers.add(n)
        self.assertIn("PolySD", all_layers)
        # The two unlabelled poly-outside-gate pieces have no name.
        self.assertGreaterEqual(len(out["unnamed"]), 1)


if __name__ == "__main__":
    unittest.main()
