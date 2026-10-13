import sys, unittest, tempfile
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla, targets
from tests import fixtures


FRAME = {
    'widthDbu': 21800000, 'heightDbu': 17800000, 'scribeDbu': 600000,
    'cols': 2, 'rows': 2, 'dieWidthDbu': 10000000, 'dieHeightDbu': 8000000,
}

# A small, self-contained CSV exercising the literal customer split_csv
# predicate (abs(y - extreme) <= tol first, then abs(x - extreme) <= tol):
# rows 0/1 sit exactly at the Y extremes (-> TB); row 2 is in the Y middle
# but exactly at the X minimum (-> LR).
CSV_TEXT = (
    "﻿Group Name,Part/Cluster Name,Target,Part/Cluster Length(um),LOC X,LOC Y\n"
    "G1,OVL_A,T1,135,-900,-860\n"
    "G1,OVL_B,T2,135,200,-200\n"
    "G2,AL_X,T3,180,-1090,-500\n"
)

REQUEST_TEXT = (
    "smPFlow -placeGroup -groupItem G1 -groupTargetPoint (190.0,30.0) -groupPlaceType CT\n"
    "smPFlow -placeGroup -groupItem G1 -groupTargetPoint (1290.0,30.0) -groupPlaceType CT\n"
    "smPFlow -placeGroup -groupItem G2 -groupTargetPoint (0.0,690.0) -groupPlaceType CT\n"
)


class TargetsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_ct_conversion_and_partition(self):
        rows = targets.read_targets(CSV_TEXT, FRAME, 10000)
        self.assertEqual(rows[0]['ctDbu'], [1900000, 300000])
        self.assertEqual([r['partition'] for r in rows], ['TB', 'TB', 'LR'])

    def test_bind_by_exact_target_point(self):
        csv_text = Path(self.case['files']['targetTable']).read_text()
        rows = targets.read_targets(csv_text, FRAME, 10000)
        doc = pla.read_pla(Path(self.case['files']['startState']).read_text(), 10000)
        bound = targets.bind_targets(rows, doc['groups'], doc['fits'])
        self.assertEqual(bound[1]['pinstGroup'], 'G1_2')
        self.assertEqual(bound[1]['fitId'], 'OVL_B.OVL_B_1')

    def test_ambiguous_binding_refused(self):
        csv_text = Path(self.case['files']['targetTable']).read_text()
        rows = targets.read_targets(csv_text, FRAME, 10000)
        doc = pla.read_pla(Path(self.case['files']['startState']).read_text(), 10000)
        duplicate_group = dict(doc['groups'][0])
        groups_with_dup = doc['groups'] + [duplicate_group]
        with self.assertRaises(core.MageError):
            targets.bind_targets(rows, groups_with_dup, doc['fits'])

    def test_request_order_matches_csv_order(self):
        self.assertEqual(
            targets.read_request_order(REQUEST_TEXT),
            [['190.0', '30.0'], ['1290.0', '30.0'], ['0.0', '690.0']],
        )

    def test_request_order_from_fixture_file(self):
        text = Path(self.case['files']['requestOrder']).read_text()
        self.assertEqual(targets.read_request_order(text), [['190', '30'], ['1290', '30'], ['0', '690']])


if __name__ == '__main__':
    unittest.main()
