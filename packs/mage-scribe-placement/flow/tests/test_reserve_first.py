"""Module-level unit tests for the reserve-first method's building blocks.

These exercise `lanes.interior_along_range` and `apply_plan`'s own
`_follow_groups` / `_collect_reserve_keys` / `_reserve` / `_straddle_guard`
helpers directly on small synthetic inputs, one branch per test, so each rule
of the controller's method (`ceiling4.py`) is pinned without a MAGE licence or
the whole case fixture. The CLI-route coverage (a full V-then-H sequence
through the stand-in) lives in `test_apply_plan.py`.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import apply_plan, lanes  # noqa: E402


DBU_PER_UM = 10000


def _fit(fid, box, in_group=""):
    return {"id": fid, "base": fid.split(".")[0], "inst": fid, "boxDbu": list(box),
            "extraRot": "NULL", "postfix": "", "inGroup": in_group}


def _drop(base, box):
    return {"id": f"{base}.{base}", "base": base, "inst": f"{base}.{base}",
            "boxDbu": list(box), "extraRot": "NULL", "placedFlag": 0, "postfix": "", "inGroup": ""}


class InteriorAlongRangeTest(unittest.TestCase):
    def test_interior_lane_shrinks_by_one_scribe_width_at_both_ends(self):
        lane = {"laneId": "V:1", "axis": "V", "alongRangeDbu": [0, 308238000],
                "crossRangeDbu": [63743000, 64343000], "sharedExterior": False}
        lo, hi, shrunk = lanes.interior_along_range(lane, occupant_boxes=[])
        self.assertTrue(shrunk)
        # 600000 == the lane's own cross-range width (one scribe width), not hard-coded.
        self.assertEqual((lo, hi), (600000, 308238000 - 600000))

    def test_shared_exterior_lane_keeps_full_range(self):
        lane = {"laneId": "V:0", "axis": "V", "alongRangeDbu": [0, 308238000],
                "crossRangeDbu": [0, 600000], "sharedExterior": True}
        lo, hi, shrunk = lanes.interior_along_range(lane, occupant_boxes=[[0, 0, 600000, 1000]])
        self.assertFalse(shrunk)
        self.assertEqual((lo, hi), (0, 308238000))

    def test_occupied_edge_band_keeps_full_range(self):
        lane = {"laneId": "V:1", "axis": "V", "alongRangeDbu": [0, 308238000],
                "crossRangeDbu": [63743000, 64343000], "sharedExterior": False}
        # An occupant inside this V lane's cross band, within one scribe width
        # of the bottom end -> the edge band is occupied, so keep full range.
        occ = [[63743000, 0, 64343000, 300000]]
        lo, hi, shrunk = lanes.interior_along_range(lane, occupant_boxes=occ)
        self.assertFalse(shrunk)
        self.assertEqual((lo, hi), (0, 308238000))

    def test_occupant_in_lane_middle_does_not_block_the_shrink(self):
        lane = {"laneId": "V:1", "axis": "V", "alongRangeDbu": [0, 308238000],
                "crossRangeDbu": [63743000, 64343000], "sharedExterior": False}
        occ = [[63743000, 150000000, 64343000, 150500000]]  # mid-lane, not near either end
        lo, hi, shrunk = lanes.interior_along_range(lane, occupant_boxes=occ)
        self.assertTrue(shrunk)
        self.assertEqual((lo, hi), (600000, 308238000 - 600000))


class FollowGroupsTest(unittest.TestCase):
    def test_moved_fit_shifts_its_group_point_by_its_own_delta(self):
        candidate = {"groups": [{"pinstGroup": "G1", "targetPointDbu": [100, 200]},
                                {"pinstGroup": "G2", "targetPointDbu": [300, 400]}]}
        fit = _fit("A.A_1", [50, 0, 70, 20], in_group="G1")
        shifted = apply_plan._follow_groups(candidate, [(fit, 15, 0)])
        self.assertEqual(shifted, 1)
        self.assertEqual(candidate["groups"][0]["targetPointDbu"], [115, 200])
        self.assertEqual(candidate["groups"][1]["targetPointDbu"], [300, 400])

    def test_ungrouped_moved_fit_shifts_nothing(self):
        candidate = {"groups": [{"pinstGroup": "G1", "targetPointDbu": [100, 200]}]}
        fit = _fit("A.A_1", [50, 0, 70, 20], in_group="")
        shifted = apply_plan._follow_groups(candidate, [(fit, 15, 0)])
        self.assertEqual(shifted, 0)
        self.assertEqual(candidate["groups"][0]["targetPointDbu"], [100, 200])


class CollectReserveKeysTest(unittest.TestCase):
    RULE_FACTS = {
        "KV": {"scribeInc": ["VERT"]},
        "KH": {"scribeInc": ["HORIZ"]},
        "KA": {"scribeInc": ["ALL"]},
    }

    def test_vert_key_wider_than_tall_is_transposed_to_a_lane_direction_box(self):
        buckets = apply_plan._collect_reserve_keys(
            [_drop("KV", [0, 0, 9000000, 600000])], reserve_length_dbu=5000000, rule_facts=self.RULE_FACTS)
        self.assertEqual(len(buckets["V"]), 1)
        # 900 um wide x 60 um tall -> transposed to 60 um wide x 900 um tall.
        self.assertEqual(buckets["V"][0]["boxDbu"], [0, 0, 600000, 9000000])

    def test_horiz_key_is_kept_and_short_keys_are_dropped(self):
        buckets = apply_plan._collect_reserve_keys(
            [_drop("KH", [0, 0, 9000000, 600000]), _drop("KH", [0, 0, 100000, 600000])],
            reserve_length_dbu=5000000, rule_facts=self.RULE_FACTS)
        self.assertEqual(len(buckets["H"]), 1)  # the short one is below the reserve length
        self.assertEqual(buckets["H"][0]["boxDbu"], [0, 0, 9000000, 600000])

    def test_non_lane_exclusive_key_is_any_and_reserved_by_neither_stage(self):
        buckets = apply_plan._collect_reserve_keys(
            [_drop("KA", [0, 0, 9000000, 600000])], reserve_length_dbu=5000000, rule_facts=self.RULE_FACTS)
        self.assertEqual(buckets["V"], [])
        self.assertEqual(buckets["H"], [])
        self.assertEqual(len(buckets["ANY"]), 1)


class ReservePlacementTest(unittest.TestCase):
    def test_keys_land_at_slot_starts_with_clearance_and_cross_band(self):
        candidate = {"fits": []}
        plan = {"maxSlots": 2, "slotStarts": [1000000, 5000000], "_crossRangeDbu": [63743000, 64343000]}
        buckets = {"V": [_fit("KV.KV", [0, 0, 600000, 9000000]), _fit("KV.KV2", [0, 0, 600000, 9000000])],
                   "H": [], "ANY": []}
        reserved, unreserved = apply_plan._reserve(candidate, [(plan, "V")], buckets, DBU_PER_UM)
        self.assertEqual(reserved, {"V": 2, "H": 0})
        self.assertEqual(unreserved, [])
        clr = 10000  # 1 um
        # V lane: along is y, cross is x == the lane band exactly.
        self.assertEqual(candidate["fits"][0]["boxDbu"],
                         [63743000, 1000000 + clr, 64343000, 1000000 + clr + 9000000])
        self.assertEqual(candidate["fits"][1]["boxDbu"],
                         [63743000, 5000000 + clr, 64343000, 5000000 + clr + 9000000])

    def test_opposite_axis_and_any_keys_are_reported_unreserved(self):
        candidate = {"fits": []}
        plan = {"maxSlots": 1, "slotStarts": [1000000], "_crossRangeDbu": [63743000, 64343000]}
        buckets = {"V": [_fit("KV.KV", [0, 0, 600000, 9000000])],
                   "H": [_fit("KH.KH", [0, 0, 9000000, 600000])],
                   "ANY": [_fit("KA.KA", [0, 0, 9000000, 600000])]}
        reserved, unreserved = apply_plan._reserve(candidate, [(plan, "V")], buckets, DBU_PER_UM)
        self.assertEqual(reserved, {"V": 1, "H": 0})
        self.assertEqual(unreserved, ["KA.KA", "KH.KH"])

    def test_more_keys_than_slots_leaves_the_overflow_unreserved(self):
        candidate = {"fits": []}
        plan = {"maxSlots": 1, "slotStarts": [1000000], "_crossRangeDbu": [63743000, 64343000]}
        buckets = {"V": [_fit("KV.KV", [0, 0, 600000, 9000000]), _fit("KV.KV2", [0, 0, 600000, 9000000])],
                   "H": [], "ANY": []}
        reserved, unreserved = apply_plan._reserve(candidate, [(plan, "V")], buckets, DBU_PER_UM)
        self.assertEqual(reserved, {"V": 1, "H": 0})
        self.assertEqual(unreserved, ["KV.KV2"])


class StraddleGuardTest(unittest.TestCase):
    LANES = [{"axis": "V", "crossRangeDbu": [40, 60]}, {"axis": "H", "crossRangeDbu": [0, 20]}]
    FRAME = {"widthDbu": 1000, "heightDbu": 1000}

    def _groups(self):
        return [{"pinstGroup": "G1", "targetPointDbu": [20, 10]}]

    def test_a_straddling_mark_is_nudged_clear_within_its_window(self):
        start_fits = [_fit("M.M_1", [10, 0, 30, 20], in_group="G1")]
        candidate = {"fits": [_fit("M.M_1", [45, 0, 65, 20], in_group="G1")],
                     "fixed": [], "groups": self._groups()}
        report = apply_plan._straddle_guard(
            candidate, start_fits, self._groups(), self.LANES, self.FRAME, limit_dbu=100, dbu_per_um=1)
        self.assertEqual(report, {"nudged": 1, "reverted": 0, "keysRemoved": 0})
        box = candidate["fits"][0]["boxDbu"]
        self.assertFalse(box[0] < 60 and box[2] > 40, f"still straddles the V band: {box}")
        # the Group point followed the nudge
        self.assertNotEqual(candidate["groups"][0]["targetPointDbu"], [20, 10])

    def test_a_mark_that_cannot_be_nudged_is_reverted_and_its_keys_removed(self):
        start_fits = [_fit("M.M_1", [10, 0, 30, 20], in_group="G1")]
        candidate = {
            "fits": [
                _fit("M.M_1", [45, 0, 65, 20], in_group="G1"),
                _fit("K.K_1", [15, 5, 25, 15], in_group=""),  # a reserved key over the mark's start box
            ],
            "fixed": [], "groups": self._groups(),
        }
        # A tight limit rejects every nudge (both candidate positions fall far
        # from the CT point), forcing the revert-and-remove branch.
        report = apply_plan._straddle_guard(
            candidate, start_fits, self._groups(), self.LANES, self.FRAME, limit_dbu=5, dbu_per_um=1)
        self.assertEqual(report, {"nudged": 0, "reverted": 1, "keysRemoved": 1})
        mark = next(f for f in candidate["fits"] if f["id"] == "M.M_1")
        self.assertEqual(mark["boxDbu"], [10, 0, 30, 20])  # back at the frozen-start box
        self.assertNotIn("K.K_1", {f["id"] for f in candidate["fits"]})  # the colliding key is gone
        self.assertEqual(candidate["groups"][0]["targetPointDbu"], [20, 10])  # CT restored

    def test_a_non_straddling_mark_is_left_alone(self):
        start_fits = [_fit("M.M_1", [10, 0, 30, 20], in_group="G1")]
        candidate = {"fits": [_fit("M.M_1", [12, 0, 32, 20], in_group="G1")],
                     "fixed": [], "groups": self._groups()}
        report = apply_plan._straddle_guard(
            candidate, start_fits, self._groups(), self.LANES, self.FRAME, limit_dbu=100, dbu_per_um=1)
        self.assertEqual(report, {"nudged": 0, "reverted": 0, "keysRemoved": 0})
        self.assertEqual(candidate["fits"][0]["boxDbu"], [12, 0, 32, 20])


if __name__ == "__main__":
    unittest.main()
