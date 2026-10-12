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
