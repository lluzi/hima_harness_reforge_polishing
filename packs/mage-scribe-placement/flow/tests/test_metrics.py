import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, metrics, pla, rules, snapshot, targets
from tests import fixtures


def _frame_and_facts(case):
    rule_text = Path(case["files"]["rule"]).read_text()
    pblock_text = Path(case["files"]["pblock"]).read_text()
    block_text = Path(case["files"]["block"]).read_text()
    frame = rules.frame_from_rule(rule_text, pblock_text, 10000)
    rule_facts = rules.read_rule_facts(rule_text, 10000)
    block_types = rules.read_block_types(block_text, 10000)
    return frame, rule_facts, block_types


def _bound_targets(case, frame):
    csv_text = Path(case["files"]["targetTable"]).read_text()
    rows = targets.read_targets(csv_text, frame, 10000)
    doc = pla.read_pla(Path(case["files"]["startState"]).read_text(), 10000)
    return targets.bind_targets(rows, doc["groups"], doc["fits"])


def build_start(case):
    frame, rule_facts, block_types = _frame_and_facts(case)
    bound_targets = _bound_targets(case, frame)
    doc = pla.read_pla(Path(case["files"]["startState"]).read_text(), 10000)
    inputs = {"startState": {"path": case["files"]["startState"],
                              "sha256": core.file_sha256(case["files"]["startState"])}}
    return snapshot.build_snapshot(
        "start", doc, frame, rule_facts, bound_targets, block_types, inputs, pending_from_rules=True
    )


def build_incumbent(case):
    frame, rule_facts, block_types = _frame_and_facts(case)
    bound_targets = _bound_targets(case, frame)
    doc = pla.read_pla(Path(case["files"]["incumbentState"]).read_text(), 10000)
    inputs = {"startState": {"path": case["files"]["startState"],
                              "sha256": core.file_sha256(case["files"]["startState"])}}
    return snapshot.build_snapshot(
        "incumbent", doc, frame, rule_facts, bound_targets, block_types, inputs, pending_from_rules=False
    )


class DropsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_drops_count_and_long_side_length(self):
        snap = build_incumbent(self.case)
        d = metrics.drops(snap)
        self.assertEqual(d["count"], 1)
        self.assertEqual(d["lengthUm"], "900")
        self.assertEqual(d["byBlockType"], {"TSK/MPAD": 1})
        self.assertEqual(d["ids"], ["KEY_V.KEY_V"])
        self.assertEqual(d["ruleShortfallCount"], 0)

    def test_drops_on_start_snapshot_are_rule_shortfalls_not_drops(self):
        # pending_from_rules=True on a start snapshot yields only synthetic
        # placedFlag=None pending copies (KEY_V x1, OVL_F x2 -- no drops
        # table exists yet); those are rule shortfalls, never PLA drops.
        snap = build_start(self.case)
        d = metrics.drops(snap)
        self.assertEqual(d["count"], 0)
        self.assertEqual(d["lengthUm"], "0")
        self.assertEqual(d["ruleShortfallCount"], 3)


class TargetDistancesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_target_distance_flags_ovl_b(self):
        snap = build_start(self.case)
        t = metrics.target_distances(snap, "100")
        self.assertEqual(t["overLimitCount"], 1)
        self.assertEqual(t["maxUm"], "150")
        ovl_b = next(p for p in t["perTarget"] if p["fitId"] == "OVL_B.OVL_B_1")
        self.assertEqual(ovl_b["alongUm"], "150")
        self.assertEqual(t["unplaced"], [])

    def test_lane_unknown_fit_uses_wider_axis(self):
        snap = build_start(self.case)
        t = metrics.target_distances(snap, "100")
        self.assertIn("AL_X.AL_X_1", t["laneUnknown"])
        al_x = next(p for p in t["perTarget"] if p["fitId"] == "AL_X.AL_X_1")
        self.assertEqual(al_x["alongUm"], "0")
        self.assertEqual(al_x["crossUm"], "0")

    def test_unplaced_target_excluded_from_max(self):
        snap = build_start(self.case)
        snap = dict(snap)
        snap["targets"] = [dict(t) for t in snap["targets"]]
        snap["targets"][0]["fitId"] = None
        t = metrics.target_distances(snap, "100")
        self.assertEqual(len(t["unplaced"]), 1)
        self.assertEqual(t["unplaced"][0]["row"], 0)


# A small, hand-built snapshot for order_deviation: three TB-partition
# targets with distinct groupNames (so the customer check_dev's
# occurrence-index matching is actually exercised by a position swap,
# unlike the shared fixture where OVL_A/OVL_B share groupName "G1").
def _order_snapshot(ovl_a_x, ovl_b_x, al_x_x):
    def fit(fit_id, x):
        return {"id": fit_id, "base": fit_id.split(".")[0], "boxDbu": [x, 0, x + 10, 10],
                "extraRot": "NULL", "postfix": "", "inGroup": "G", "blockType": "OVL",
                "priority": True, "ruleItem": fit_id.split(".")[0], "lane": {"axis": "H", "track": 0}}

    def target(row, name, fit_id):
        return {"row": row, "groupName": name, "partName": name, "target": f"T{row}",
                "lengthUm": "10", "locXUm": "0", "locYUm": "0", "ctDbu": [0, 0],
                "pinstGroup": "G", "fitId": fit_id, "partition": "TB"}

    return {
        "dbuPerUm": 10000,
        "fits": [fit("OVL_A.OVL_A_1", ovl_a_x), fit("OVL_B.OVL_B_1", ovl_b_x), fit("AL_X.AL_X_1", al_x_x)],
        "targets": [
            target(0, "OVL_A", "OVL_A.OVL_A_1"),
            target(1, "OVL_B", "OVL_B.OVL_B_1"),
            target(2, "AL_X", "AL_X.AL_X_1"),
        ],
    }


def _marks_snapshot(marks, partition="TB"):
    """A minimal snapshot from `marks` (`{'row', 'groupName', 'x', 'y',
    'bound': True}`), for duplicate-groupName / axis-selection cases the
    fixed-shape `_order_snapshot` above cannot express. `bound=False`
    omits the fit entirely (so the target's `fitId` stays `None`, i.e.
    unbound/unplaced)."""
    fits = []
    targets = []
    for index, mark in enumerate(marks):
        x, y = mark.get("x", 0), mark.get("y", 0)
        bound = mark.get("bound", True)
        fit_id = f"{mark['groupName']}.MARK{index}" if bound else None
        if bound:
            fits.append({
                "id": fit_id, "base": mark["groupName"], "boxDbu": [x, y, x + 10, y + 10],
                "extraRot": "NULL", "postfix": "", "inGroup": "G", "blockType": "OVL",
                "priority": True, "ruleItem": mark["groupName"], "lane": {"axis": "H", "track": 0},
            })
        targets.append({
            "row": mark["row"], "groupName": mark["groupName"], "partName": mark["groupName"],
            "target": f"T{mark['row']}", "lengthUm": "10", "locXUm": "0", "locYUm": "0",
            "ctDbu": [0, 0], "pinstGroup": "G", "fitId": fit_id, "partition": partition,
        })
    return {"dbuPerUm": 10000, "fits": fits, "targets": targets}


class OrderDeviationTest(unittest.TestCase):
    def test_order_matches_requested_order_is_zero(self):
        snap = _order_snapshot(ovl_a_x=0, ovl_b_x=10, al_x_x=20)
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB"], 0)
        self.assertEqual(d["byPartition"]["LR"], -1)
        self.assertEqual(d["byPartition"]["IN"], -1)
        self.assertEqual(d["max"], 0)
        self.assertEqual(d["missing"], [])

    def test_order_deviation_uses_customer_check_dev(self):
        # swap OVL_A and OVL_B along X -> TB list deviation 1
        snap = _order_snapshot(ovl_a_x=10, ovl_b_x=0, al_x_x=20)
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB"], 1)
        self.assertEqual(d["max"], 1)

    def test_unbound_target_is_missing(self):
        snap = _order_snapshot(ovl_a_x=0, ovl_b_x=10, al_x_x=20)
        snap["targets"][2]["fitId"] = None
        d = metrics.order_deviation(snap)
        self.assertEqual(d["missing"], ["AL_X"])

    def test_duplicate_groupname_same_name_swap_is_zero_deviation(self):
        # Four TB marks requested in order A, A, B, C. Swapping the two
        # same-named "A" marks' placed x-positions between themselves
        # cannot change the *name* sequence list2 is built from (both
        # slots are still "A", just held by a different physical mark),
        # so k-th-occurrence matching still pairs 0th-A-in-list1 with
        # 0th-A-in-list2 and 1st-A with 1st-A: deviation stays 0.
        marks = [
            {"row": 0, "groupName": "A", "x": 10},
            {"row": 1, "groupName": "A", "x": 0},
            {"row": 2, "groupName": "B", "x": 20},
            {"row": 3, "groupName": "C", "x": 30},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB"], 0)
        self.assertEqual(d["missing"], [])

    def test_duplicate_groupname_cross_name_swap_is_nonzero_deviation(self):
        # Same four TB marks, but the *second* "A" (row 1) and "B" (row 2)
        # trade placed x-positions. list1 (requested) = [A, A, B, C].
        # Placed order by x: row0 A(x=0), row2 B(x=10), row1 A(x=20),
        # row3 C(x=30) -> list2 = [A, B, A, C]. k-th-occurrence matching:
        #   list1[0]=A(k=0) <-> list2 idx 0 (A's 0th)  -> dev |0-0| = 0
        #   list1[1]=A(k=1) <-> list2 idx 2 (A's 1st)  -> dev |1-2| = 1
        #   list1[2]=B(k=0) <-> list2 idx 1 (B's 0th)  -> dev |2-1| = 1
        #   list1[3]=C(k=0) <-> list2 idx 3 (C's 0th)  -> dev |3-3| = 0
        # max = 1.
        marks = [
            {"row": 0, "groupName": "A", "x": 0},
            {"row": 1, "groupName": "A", "x": 20},
            {"row": 2, "groupName": "B", "x": 10},
            {"row": 3, "groupName": "C", "x": 30},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB"], 1)
        self.assertEqual(d["missing"], [])

    def test_duplicate_groupname_one_occurrence_unbound_pairs_by_index(self):
        # list1 (requested, full) = [A, A, B]: row0's "A" is unplaced
        # (no fit); row1's "A" is placed at x=5; row2's "B" at x=0.
        # list2 (placed-only) sorted by x = [B(x=0), A(x=5)].
        # k-th-occurrence matching against the *full* list1 (not a
        # "skip the unbound one" list) per the customer procedure:
        #   list1[0]=A(k=0) <-> list2 idx 1 (A's 0th, the only placed A)
        #       -> dev |0-1| = 1
        #   list1[1]=A(k=1) -> list2 has only one "A" occurrence (k=1 is
        #       out of range) -> unmatched, contributes no deviation
        #   list1[2]=B(k=0) <-> list2 idx 0 (B's 0th) -> dev |2-0| = 2
        # max = 2. The unbound row0 ("A") is reported under `missing`.
        marks = [
            {"row": 0, "groupName": "A", "x": 0, "bound": False},
            {"row": 1, "groupName": "A", "x": 5},
            {"row": 2, "groupName": "B", "x": 0},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB"], 2)
        self.assertEqual(d["missing"], ["A"])

    def test_lr_partition_sorts_by_y_not_x(self):
        # Three LR marks requested in order X, Y, Z. Their y-positions
        # already match the requested order (0, 10, 20 -> deviation 0 if
        # sorted by y, as LR must be); their x-positions are deliberately
        # reversed (100, 50, 0) so sorting by x instead would produce a
        # nonzero deviation. A passing assertion of 0 here is only
        # possible if the implementation sorts LR by y.
        marks = [
            {"row": 0, "groupName": "X", "x": 100, "y": 0},
            {"row": 1, "groupName": "Y", "x": 50, "y": 10},
            {"row": 2, "groupName": "Z", "x": 0, "y": 20},
        ]
        snap = _marks_snapshot(marks, partition="LR")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["LR"], 0)


class DisplacementTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_displacement_separate_from_target_distance(self):
        start = build_start(self.case)
        d = metrics.displacement(start, start)
        self.assertEqual(d["movedCount"], 0)
        self.assertEqual(d["totalUm"], "0")
        self.assertEqual(d["perFit"], [])
        self.assertEqual(d["added"], [])
        self.assertEqual(d["removed"], [])

    def test_displacement_detects_moved_fit(self):
        start = build_start(self.case)
        moved = dict(start)
        moved["fits"] = [dict(f) for f in start["fits"]]
        ovl_a = next(f for f in moved["fits"] if f["id"] == "OVL_A.OVL_A_1")
        l, b, r, t = ovl_a["boxDbu"]
        ovl_a["boxDbu"] = [l + 10000, b, r + 10000, t]  # +1um in x
        d = metrics.displacement(start, moved)
        self.assertEqual(d["movedCount"], 1)
        self.assertEqual(d["totalUm"], "1")
        self.assertEqual(d["perFit"], [{"id": "OVL_A.OVL_A_1", "dxUm": "1", "dyUm": "0"}])

    def test_displacement_reports_added_and_removed(self):
        start = build_start(self.case)
        trimmed = dict(start)
        trimmed["fits"] = [dict(f) for f in start["fits"] if f["id"] != "OVL_A.OVL_A_1"]
        d = metrics.displacement(start, trimmed)
        self.assertEqual(d["removed"], ["OVL_A.OVL_A_1"])
        self.assertEqual(d["added"], [])


class NativeRowsTest(unittest.TestCase):
    def test_native_rows_missing_file_is_unknown(self):
        self.tmp = tempfile.TemporaryDirectory()
        overlap_path = Path(self.tmp.name) / "overlap.rpt"
        overlap_path.write_text("# header\nrow one\nrow two\n", encoding="utf-8")
        r = metrics.native_rows({"OVERLAP": str(overlap_path)})
        self.assertEqual(r["byType"]["OVERLAP"], 2)
        self.assertIsNone(r["byType"]["SPACE"])
        self.assertIsNone(r["total"])
        self.assertIn("SPACE", r["unknown"])
        self.tmp.cleanup()

    def test_native_rows_all_present_sums_total(self):
        self.tmp = tempfile.TemporaryDirectory()
        files = {}
        for i, type_name in enumerate(
            ["OVERLAP", "SPACE", "BOUNDARY", "CROSS", "OFFGRID", "DIECORNER", "PEPPER", "PADS",
             "LOCATION", "AUTOREFINE"]
        ):
            path = Path(self.tmp.name) / f"{type_name}.rpt"
            path.write_text(f"# header\n" + "\n".join(f"row {j}" for j in range(i)) + ("\n" if i else ""),
                             encoding="utf-8")
            files[type_name] = str(path)
        r = metrics.native_rows(files)
        self.assertEqual(r["unknown"], [])
        self.assertEqual(r["total"], sum(range(10)))
        self.tmp.cleanup()

    def test_native_rows_unreadable_file_is_unknown(self):
        r = metrics.native_rows({"OVERLAP": "/no/such/file-mage-metrics-test.rpt"})
        self.assertIsNone(r["byType"]["OVERLAP"])
        self.assertIn("OVERLAP", r["unknown"])
        self.assertIsNone(r["total"])


if __name__ == "__main__":
    unittest.main()
