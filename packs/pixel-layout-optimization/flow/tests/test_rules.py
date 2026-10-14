"""Tests for pixelopt.rules, the Argus DRC deck parser (stdlib only)."""
import tempfile
import unittest

from pixelopt import manifest as mani
from pixelopt import rules
from pixelopt.core import PixelError
from tests import fixtures


def _check(parsed, rule_id):
    for chk in parsed["checks"]:
        if chk["rule"] == rule_id:
            return chk
    raise AssertionError("no check for rule %s" % rule_id)


class TestParseDeck(unittest.TestCase):
    def setUp(self):
        self.parsed = rules.parse_deck(fixtures.build_authority_deck())

    def test_vars_layers_derived(self):
        self.assertEqual(self.parsed["vars"]["metal_min_space"], 1.5)
        self.assertEqual(self.parsed["vars"]["via_min_w"], 0.35)
        self.assertEqual(self.parsed["layers"]["Poly"], 3)
        self.assertEqual(self.parsed["layers"]["Plan"], 9)  # written as 'layer ( ... )'
        self.assertEqual(len(self.parsed["layers"]), 11)
        self.assertIn("GAB", self.parsed["derived"])

    def test_literal_overrides_var_comment(self):
        # M.SP comment names $metal_min_space (1.5) but the check literal is 1.2.
        chk = _check(self.parsed, "M.SP")
        self.assertEqual(chk["kind"], "space")
        self.assertEqual(chk["value"], 1.2)

    def test_var_reference_resolves(self):
        self.assertEqual(_check(self.parsed, "GA.W")["value"], 0.8)
        self.assertEqual(_check(self.parsed, "V.W")["value"], 0.35)

    def test_two_layer_space(self):
        chk = _check(self.parsed, "MB.SP")
        self.assertEqual(chk["kind"], "space2")
        self.assertEqual(chk["layers"], ["Metal", "GateB"])
        self.assertEqual(chk["value"], 0.6)

    def test_enc_and_derived_from(self):
        plain = _check(self.parsed, "P.ENC")
        self.assertEqual(plain["kind"], "enc")
        self.assertEqual(plain["layers"], ["Poly", "GateA"])
        self.assertIsNone(plain["derivedFrom"])

        derived = _check(self.parsed, "CAP.ENC")
        self.assertEqual(derived["kind"], "enc")
        self.assertEqual(derived["layers"], ["GAB", "GateB"])
        self.assertIn("GAB", derived["derivedFrom"])

    def test_commented_rule_ignored(self):
        ids = [c["rule"] for c in self.parsed["checks"]]
        self.assertNotIn("DEAD.1", ids)

    def test_geom_interact_is_unmodelled(self):
        chk = _check(self.parsed, "VIA.LAND")
        self.assertEqual(chk["kind"], "other")
        self.assertFalse(chk["modelled"])
        self.assertTrue(any(u.startswith("VIA.LAND:") for u in self.parsed["unmodelled"]))
        self.assertTrue(any("offgrid_check:" in u for u in self.parsed["unmodelled"]))

    def test_options(self):
        self.assertFalse(self.parsed["options"]["db_precision"])  # uses precision( 100 )
        self.assertEqual(self.parsed["options"]["tolerance"], 0.001)


class TestCompactionTable(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        built = fixtures.build_text_case(d)
        self.case = mani.load_case(built["manifest"], verify=False)
        self.table = rules.compaction_table(
            rules.parse_deck(fixtures.build_authority_deck()), self.case)

    def test_width_space(self):
        self.assertEqual(self.table["width"],
                         {"Metal": 1.0, "GateA": 0.8, "Via": 0.35})
        self.assertEqual(self.table["space"], {"Metal": 1.2, "GateA": 0.7})

    def test_xspace(self):
        self.assertEqual(self.table["xspace"], [["Metal", "GateB", 0.6]])

    def test_enc_resolves_derived_to_base(self):
        # P.ENC -> [outer GateA, inner Poly]; CAP.ENC -> derived inner GAB -> GateA.
        self.assertIn(["GateA", "Poly", 0.5], self.table["enc"])
        self.assertIn(["GateB", "GateA", 0.25], self.table["enc"])

    def test_unmodelled_carried(self):
        self.assertEqual(len(self.table["unmodelled"]), 2)


class TestMakeRuleFile(unittest.TestCase):
    def test_substitutes_and_replaces_precision(self):
        text, record = rules.make_rule_file(
            fixtures.build_authority_deck(), "/work/cand/pixel3x3.gds", "pix3x3")
        self.assertIn('layout_input( path "/work/cand/pixel3x3.gds" )', text)
        self.assertIn('layout_input( top_cell "pix3x3" )', text)
        self.assertIn('drc_result( db "argus_drc.db" )', text)
        self.assertIn('drc_summary( "argus_drc.sum" )', text)
        self.assertEqual(text.count("layout_use_db_precision( yes )"), 1)
        self.assertNotIn("precision( 100 )", text)
        self.assertEqual(record["precision"], "replaced precision( 100 )")
        self.assertEqual(record["stripped"], [])

    def test_present_precision(self):
        _text, record = rules.make_rule_file(
            fixtures.build_reference_deck(), "p.gds", "pix")
        self.assertEqual(record["precision"], "present")

    def test_inserted_precision(self):
        deck = ('layout_input( path "pixel.gds" )\n'
                'rule M.W {\nwidth( Metal < 1.0 )\n}\n')
        text, record = rules.make_rule_file(deck, "x.gds", "pix")
        self.assertEqual(record["precision"], "inserted")
        self.assertEqual(text.count("layout_use_db_precision( yes )"), 1)

    def test_strips_geom_interact_rule(self):
        text, record = rules.make_rule_file(
            fixtures.build_authority_deck(), "p.gds", "pix",
            strip_functions=("geom_interact",))
        self.assertEqual(record["stripped"], ["VIA.LAND"])
        self.assertNotIn("geom_interact", text)
        self.assertIn("rule M.W", text)  # other rules survive

    def test_refuses_deck_without_layout_input(self):
        with self.assertRaises(PixelError) as cm:
            rules.make_rule_file("rule M.W {\nwidth( Metal < 1.0 )\n}\n", "p", "t")
        self.assertEqual(cm.exception.code, "schema")

    def test_refuses_deck_without_rules(self):
        with self.assertRaises(PixelError) as cm:
            rules.make_rule_file('layout_input( path "p.gds" )\n', "p", "t")
        self.assertEqual(cm.exception.code, "schema")


class TestRuleLocalDerivedLayers(unittest.TestCase):
    """A name assigned inside a rule body (decks reuse X in many rules) is local to that rule."""

    def test_same_local_name_in_two_rules_resolves_per_rule(self):
        deck = (
            "layout_input( path \"a.gds\" )\n"
            "layer( Via 5 )\nlayer( Plan 9 )\n"
            "rule V.1 {\n; via width\nX = geom_get_boundaries( Via )\nwidth( X < 2.5 adjacent < 90 region )\n}\n"
            "rule P.1 {\n; plan width\nX = geom_get_boundaries( Plan )\nwidth( X < 4 adjacent < 90 region )\n}\n"
        )
        parsed = rules.parse_deck(deck)
        table = rules.compaction_table(parsed, None)
        self.assertEqual(table["width"], {"Via": 2.5, "Plan": 4.0})


if __name__ == "__main__":
    unittest.main()
