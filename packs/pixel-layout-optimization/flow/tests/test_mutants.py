import tempfile
import unittest

try:
    import gdstk  # noqa: F401
    import numpy as np
    import shapely  # noqa: F401
    HAVE = True
except ImportError:  # stdlib-only runs skip this file
    HAVE = False


def _poly_lists_equal(a, b):
    if sorted(a) != sorted(b):
        return False
    for name in a:
        pa, pb = a[name], b[name]
        if len(pa) != len(pb):
            return False
        for x, y in zip(pa, pb):
            if x.shape != y.shape or not np.array_equal(x, y):
                return False
    return True


@unittest.skipUnless(HAVE, "numeric packages not installed")
class MutantsTest(unittest.TestCase):
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
        self.table = rules.compaction_table(rules.parse_deck(text), self.case)

    def tearDown(self):
        self.tmp.cleanup()

    def test_remove_contact_splits_a_net_and_changes_exactly_one_thing(self):
        from pixelopt import mutants, nets
        cand, desc = mutants.remove_contact(self.lay, self.case)
        self.assertEqual(desc["kind"], "remove-contact")
        self.assertIsNotNone(desc["net"])

        # Exactly one contact shape removed, every other layer untouched.
        via = self.case.raw["connectivity"]["contactLayer"]
        self.assertEqual(len(cand.polys[via]), len(self.lay.polys[via]) - 1)
        others_before = dict((k, v) for k, v in self.lay.polys.items() if k != via)
        others_after = dict((k, v) for k, v in cand.polys.items() if k != via)
        self.assertTrue(_poly_lists_equal(others_before, others_after))

        # The removal really splits a labelled net (more unnamed components).
        before = nets.extract(self.lay, self.case)
        after = nets.extract(cand, self.case)
        self.assertGreater(len(after["unnamed"]), len(before["unnamed"]))

    def test_shrink_space_makes_a_sub_rule_gap_and_changes_exactly_one_thing(self):
        from pixelopt import mutants
        cand, desc = mutants.shrink_space(self.lay, self.case, self.table)
        self.assertEqual(desc["kind"], "shrink-space")
        layer = desc["layer"]
        self.assertLess(desc["newSpace"], desc["rule"])

        # Exactly one polygon on exactly one layer changed.
        diffs = 0
        for name in self.lay.polys:
            pa, pb = self.lay.polys[name], cand.polys[name]
            self.assertEqual(len(pa), len(pb))
            for x, y in zip(pa, pb):
                if x.shape != y.shape or not np.array_equal(x, y):
                    diffs += 1
        self.assertEqual(diffs, 1)
        self.assertNotIn(layer, self.case.raw["cst"]["plateLayers"])


if __name__ == "__main__":
    unittest.main()
