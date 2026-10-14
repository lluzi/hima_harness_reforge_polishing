"""Tests for the design-space card and its SVG (``pixelopt.card``).

Skips cleanly when the numeric packages are absent (stdlib-only runs ignore it).
"""
import json
import tempfile
import unittest

try:
    import numpy  # noqa: F401
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "numeric packages not installed")
class CardTest(unittest.TestCase):
    def _inputs(self):
        sites = [{"victim": "S", "aggressor": "AN", "victimLayer": "GateA",
                  "aggressorLayer": "Anode", "overlapUm2": 2.0, "fringe1Um2": 0.4,
                  "fringe25Um2": 0.1, "bbox": [9.0, 27.0, 15.0, 36.0],
                  "sharePct": 40.0, "estFf": 0.31},
                 {"victim": "S", "aggressor": "DL", "victimLayer": "GateA",
                  "aggressorLayer": "Metal", "overlapUm2": 1.0, "fringe1Um2": 0.2,
                  "fringe25Um2": 0.05, "bbox": [13.0, 2.0, 14.0, 38.0],
                  "sharePct": 20.0, "estFf": 0.3}]
        levers = [{"id": "lever-0", "kind": "edge", "axis": "x", "layer": "Metal",
                   "net": None, "gradientFfPerUm": {"S|AN": 0.02}, "boundUm": 0.5}]
        px = {"pitchUm": 17.5, "binding": ["S:Metal y=20.0 x=13.0..14.0"]}
        py = {"pitchUm": 36.0, "binding": []}
        floor = {"ctFf": 0.12, "note": "estimated"}
        front = [{"id": "r01-target", "outlineUm": [18.0, 36.0],
                  "ratioPct": 6.5, "legal": True}]
        markers = [{"candidate": "original", "rule": "M.SP", "class": "model-gap",
                    "bbox": [1.0, 2.0, 1.5, 3.0]}]
        return sites, levers, px, py, floor, front, markers

    def test_card_has_contract_keys_and_is_small(self):
        from pixelopt import card
        sites, levers, px, py, floor, front, markers = self._inputs()
        doc = card.make_card(sites, levers, px, py, floor, front, markers)
        for key in ("schema", "sites", "levers", "pitchBound", "floor", "front",
                    "openMarkers"):
            self.assertIn(key, doc)
        self.assertEqual(doc["schema"], "pixel.card/1")
        self.assertEqual(doc["pitchBound"]["x"]["pitchUm"], 17.5)
        self.assertEqual(doc["sites"][0]["layers"], ["GateA", "Anode"])
        size = len(json.dumps(doc).encode("utf-8"))
        self.assertLessEqual(size, 4096)

    def test_card_trims_under_four_kb(self):
        from pixelopt import card
        # Many long levers would overflow 4 KB; make_card must trim to fit.
        levers = [{"id": "lever-%d" % i, "kind": "edge", "axis": "x",
                   "layer": "SomeConductorLayer%d" % i, "net": "NetName%d" % i,
                   "gradientFfPerUm": {"S|AN": 0.01234567, "S|DL": 0.00987654,
                                       "S|EN": 0.001, "S|R1": 0.002},
                   "boundUm": 0.5} for i in range(40)]
        sites = [{"victim": "S", "aggressor": "AG%d" % i, "victimLayer": "GateA",
                  "aggressorLayer": "Metal", "overlapUm2": 1.0, "fringe1Um2": 0.1,
                  "fringe25Um2": 0.0, "bbox": [0, 0, 1, 1], "sharePct": 1.0,
                  "estFf": 0.1} for i in range(40)]
        doc = card.make_card(sites, levers, {"pitchUm": 1.0, "binding": []},
                             {"pitchUm": 1.0, "binding": []},
                             {"ctFf": 0.0, "note": "estimated"}, [], [])
        self.assertLessEqual(len(json.dumps(doc).encode("utf-8")), 4096)

    def test_svg_draws_outline_and_legend(self):
        from tests import fixtures
        from pixelopt import manifest, layout, card
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        built = fixtures.build_case(tmp.name)
        case = manifest.load_case(built["manifest"])
        lay = layout.load_gds(built["gds"], case, top=case.raw["original"]["topCell"])
        sites, *_ = self._inputs()
        svg = card.card_svg(case, lay, sites)
        self.assertTrue(svg.startswith("<svg"))
        self.assertIn("</svg>", svg)
        self.assertIn("Metal", svg)   # a conductor appears in the legend
        self.assertIn("polygon", svg)


if __name__ == "__main__":
    unittest.main()
