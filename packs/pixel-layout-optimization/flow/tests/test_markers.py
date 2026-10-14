"""Tests for ``pixelopt.markers`` (stdlib only; runs under plain python3)."""
import unittest

from pixelopt import markers


def _p(idx, pts):
    """One Argus ``.db`` marker block: ``p <idx> <npts>`` then integer db units."""
    lines = ["p %d %d" % (idx, len(pts))]
    for x, y in pts:
        lines.append("%d %d" % (round(x * 1000), round(y * 1000)))
    return "\n".join(lines)


def _db(blocks):
    """Assemble a synthetic Argus ``.db`` file (invented coordinates)."""
    out = ["pixel3x3 1000"]
    for rule, markers_pts in blocks:
        out.append(rule)
        out.append("3 3 1 Tue Oct 13 00:00:00 2026")
        out.append("LAYOUT_PRECISION 1000")
        out.append("rule %s {" % rule)
        out.append("; synthetic rule comment")
        out.append("space( Metal < 1.2 )")
        out.append("}")
        for idx, pts in markers_pts:
            out.append(_p(idx, pts))
    return "\n".join(out) + "\n"


class ParseDbTest(unittest.TestCase):
    def test_parses_rules_and_micrometre_points(self):
        text = _db([
            ("M.SP", [(1, [(5.0, 5.0), (5.0, 6.0), (6.0, 6.0)])]),
            ("VIA.LAND", [(2, [(12.0, 8.0), (12.5, 8.0), (12.5, 8.5), (12.0, 8.5)])]),
        ])
        marks = markers.parse_db(text)
        self.assertEqual(len(marks), 2)
        self.assertEqual(marks[0][0], "M.SP")
        self.assertEqual(marks[0][1][0], [5.0, 5.0])
        self.assertEqual(marks[1][0], "VIA.LAND")
        self.assertEqual(len(marks[1][1]), 4)

    def test_skips_truncated_marker(self):
        text = "M.SP\np 1 3\n5000 5000\n5000 6000\n"  # declares 3 points, gives 2
        self.assertEqual(markers.parse_db(text), [])


class FoldTest(unittest.TestCase):
    def test_three_tile_copies_fold_into_one(self):
        outline = ((0.0, 0.0), (20.0, 40.0))
        tri = [(5.0, 5.0), (5.0, 6.0), (6.0, 6.0)]

        def shift(pts, dx, dy):
            return [(x + dx, y + dy) for x, y in pts]

        # The same violation in three different tiles of a 3x3 run.
        marks = [
            ("M.SP", tri),
            ("M.SP", shift(tri, 20.0, 0.0)),    # tile to the right
            ("M.SP", shift(tri, 0.0, 40.0)),    # tile above
            ("M.SP", shift(tri, 20.0, 40.0)),   # diagonal tile
        ]
        folded = markers.fold(marks, outline)
        self.assertEqual(len(folded), 1)
        self.assertEqual(folded[0][0], "M.SP")
        for (fx, fy), (ex, ey) in zip(folded[0][1], tri):
            self.assertAlmostEqual(fx, ex, places=6)
            self.assertAlmostEqual(fy, ey, places=6)

    def test_distinct_markers_survive(self):
        outline = ((0.0, 0.0), (20.0, 40.0))
        marks = [
            ("M.SP", [(5.0, 5.0), (5.0, 6.0), (6.0, 6.0)]),
            ("M.SP", [(9.0, 9.0), (9.0, 10.0), (10.0, 10.0)]),
        ]
        self.assertEqual(len(markers.fold(marks, outline)), 2)


class ClassifyTest(unittest.TestCase):
    def setUp(self):
        self.table = {"width": {}, "space": {}, "xspace": [], "enc": [],
                      "unmodelled": ["VIA.LAND: geom_interact"]}

    def _mark(self, rule, x, y):
        return (rule, [(x, y), (x, y + 0.5), (x + 0.5, y + 0.5), (x + 0.5, y)])

    def test_unmodelled_rule_is_model_gap(self):
        marks = [self._mark("VIA.LAND", 1 + i, 1) for i in range(5)]
        out = markers.classify(marks, self.table, start_marks=[])
        self.assertTrue(all(m["class"] == "model-gap" for m in out))

    def test_near_binding_tag_is_binding_chain(self):
        marks = [self._mark("M.SP", 2 + 3 * i, 2) for i in range(5)]
        tags = [{"loc": [2.25, 2.25]}]
        out = markers.classify(marks, self.table, start_marks=[], binding_tags=tags)
        self.assertEqual(out[0]["class"], "binding-chain")
        self.assertTrue(all(m["class"] != "binding-chain" for m in out[1:]))

    def test_new_single_place_is_exact_pair(self):
        marks = [self._mark("M.SP", 2 + 3 * i, 2) for i in range(5)]
        out = markers.classify(marks, self.table, start_marks=[])
        self.assertTrue(all(m["class"] == "exact-pair" for m in out))

    def test_place_already_in_start_is_not_exact_pair(self):
        marks = [self._mark("M.SP", 2 + 3 * i, 2) for i in range(5)]
        start = [marks[0]]  # the first place was already violated in the start layout
        out = markers.classify(marks, self.table, start_marks=start)
        self.assertEqual(out[0]["class"], "bounded-edit")
        self.assertNotEqual(out[0]["class"], "exact-pair")

    def test_three_or_fewer_is_bounded_edit(self):
        marks = [self._mark("M.SP", 2 + 3 * i, 2) for i in range(3)]
        out = markers.classify(marks, self.table, start_marks=[])
        self.assertTrue(all(m["class"] == "bounded-edit" for m in out))


if __name__ == "__main__":
    unittest.main()
