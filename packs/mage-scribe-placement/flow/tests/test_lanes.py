import sys, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import lanes


FRAME = {
    'widthDbu': 21800000, 'heightDbu': 17800000, 'scribeDbu': 600000,
    'cols': 2, 'rows': 2, 'dieWidthDbu': 10000000, 'dieHeightDbu': 8000000,
}


class LanesTest(unittest.TestCase):
    def test_lane_model_counts_and_shared_exterior(self):
        lanes_ = lanes.lane_model(FRAME)
        self.assertEqual(len(lanes_), 6)  # H:0..2, V:0..2
        self.assertEqual(lanes.physical_lane(FRAME, 'H', 2), 'H:0')
        by_id = {l['laneId']: l for l in lanes_}
        self.assertTrue(by_id['H:0']['sharedExterior'])
        self.assertTrue(by_id['H:2']['sharedExterior'])
        self.assertFalse(by_id['H:1']['sharedExterior'])
        self.assertEqual(by_id['H:0']['crossRangeDbu'], [0, 600000])
        self.assertEqual(by_id['H:1']['crossRangeDbu'], [8600000, 9200000])
        self.assertEqual(by_id['V:1']['crossRangeDbu'], [10600000, 11200000])

    def test_assign_lane(self):
        self.assertEqual(
            lanes.assign_lane(FRAME, [1000000, 20000, 2350000, 580000]),
            {'axis': 'H', 'track': 0},
        )
        self.assertIsNone(lanes.assign_lane(FRAME, [1000000, 20000, 2350000, 900000]))  # leaves the band

    def test_assign_lane_corner_prefers_longer_side_ties_to_h(self):
        # A box inside both H:0 and V:0 (the frame's bottom-left scribe
        # corner): wider than tall -> H; taller than wide -> V; square -> H.
        wide = lanes.assign_lane(FRAME, [0, 0, 500000, 100000])
        self.assertEqual(wide, {'axis': 'H', 'track': 0})
        tall = lanes.assign_lane(FRAME, [0, 0, 100000, 500000])
        self.assertEqual(tall, {'axis': 'V', 'track': 0})
        square = lanes.assign_lane(FRAME, [0, 0, 300000, 300000])
        self.assertEqual(square, {'axis': 'H', 'track': 0})

    def test_projection_free_intervals_with_periodic_images(self):
        view = lanes.project(FRAME, [['a', [600000, 0, 1950000, 560000]]], 'H:2')
        self.assertEqual(view['occupants'][0]['sourceImage'], [0, 1])
        self.assertEqual(view['occupants'][0]['alongDbu'], [600000, 1950000])
        self.assertEqual(view['occupants'][0]['crossDbu'], [17200000, 17760000])

    def test_projection_largest_free_interval(self):
        # The box also reappears as its own +1-x-period image near the far
        # end of the lane (the frame tiles periodically), so both ends of
        # the along-range are blocked and only the middle gap is free.
        view = lanes.project(FRAME, [['a', [0, 0, 600000, 560000]]], 'H:0')
        self.assertEqual(len(view['occupants']), 2)
        self.assertEqual(view['freeIntervals'], [{'alongDbu': [600000, 21200000], 'lengthDbu': 20600000}])
        self.assertEqual(view['largestFreeDbu'], 20600000)

    def test_projection_respects_explicit_along_and_cross_window(self):
        view = lanes.project(
            FRAME, [['a', [0, 0, 600000, 560000]]], 'H:0',
            along=[0, 1000000], cross=[0, 600000],
        )
        self.assertEqual(view['queryAlongDbu'], [0, 1000000])
        self.assertEqual(len(view['occupants']), 1)


if __name__ == '__main__':
    unittest.main()
