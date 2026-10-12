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

    def test_drops_split_ordinary_and_grouped(self):
        # One grouped drop (inGroup "G1", long side 616 um) and two
        # ordinary drops (empty inGroup, long side 5188 um each) -- the
        # ordinary/grouped split the external benchmark scores on.
        snap = {
            "dbuPerUm": 10000,
            "pending": [
                {"id": "A.A", "base": "A", "sizeDbu": [6160000, 100], "blockType": "OVL",
                 "ruleItem": "A", "inGroup": "G1", "placedFlag": 0},
                {"id": "B.B", "base": "B", "sizeDbu": [51880000, 100], "blockType": "OVL",
                 "ruleItem": "B", "inGroup": "", "placedFlag": 0},
                {"id": "C.C", "base": "C", "sizeDbu": [51880000, 100], "blockType": "OVL",
                 "ruleItem": "C", "inGroup": "", "placedFlag": 0},
            ],
        }
        d = metrics.drops(snap)
        self.assertEqual(d["count"], 3)
        self.assertEqual(d["lengthUm"], "10992")
        self.assertEqual(d["ordinary"]["count"], 2)
        self.assertEqual(d["ordinary"]["lengthUm"], "10376")
        self.assertEqual(d["ordinary"]["ids"], ["B.B", "C.C"])
        self.assertEqual(d["grouped"]["count"], 1)
        self.assertEqual(d["grouped"]["lengthUm"], "616")
        self.assertEqual(d["grouped"]["ids"], ["A.A"])

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


# Frame for the hand-built order_deviation snapshots: width/height 1000
# DBU (dbuPerUm 1 throughout, so DBU and "um" coincide for readability),
# centre at (500, 500). A TB target's side is bottom when ctDbu[1] < 500,
# top otherwise; an LR target's side is left when ctDbu[0] < 500, right
# otherwise.
_ORDER_FRAME = {"widthDbu": 1000, "heightDbu": 1000}


def _marks_snapshot(marks, partition="TB", frame=None):
    """A minimal snapshot from `marks` (`{'row', 'groupName', 'ct', 'placed',
    'bound': True}`), built to exercise `order_deviation`'s per-side split
    and its requested-vs-placed sort independently: `ct` is the target's
    requested along-axis CT coordinate (what `list2`/"requested" sorts
    by), `placed` is the bound fit's along-axis bbox-centre coordinate
    (what `list1`/"placed" sorts by) — unlike the shared case fixture,
    these two are never forced to move together, so a test can hold one
    fixed while permuting the other. `bound=False` omits the fit entirely
    (the target's `fitId` stays `None`, i.e. unplaced).

    Every mark's CT/box sits on the axis its `partition` cares about
    (`ctDbu[0]`/`boxDbu` x-extent for `TB`'s x-axis test marks, `ctDbu[1]`/
    y-extent for `LR`'s y-axis ones) — the other axis is left at the
    frame's own centre (500) so every mark lands on the *same* side
    `_side_of` would pick for that partition, letting a test choose the
    side via `partition` + one extra `side` override below.
    """
    frame = frame or _ORDER_FRAME
    fits = []
    targets = []
    for index, mark in enumerate(marks):
        bound = mark.get("bound", True)
        fit_id = f"{mark['groupName']}.MARK{index}" if bound else None
        axis_is_x = partition == "TB"
        on_axis, off_axis = mark.get("ct", 0), 0
        if bound:
            placed_on_axis = mark.get("placed", mark.get("ct", 0))
            if axis_is_x:
                box = [placed_on_axis, off_axis, placed_on_axis + 10, off_axis + 10]
            else:
                box = [off_axis, placed_on_axis, off_axis + 10, placed_on_axis + 10]
            fits.append({
                "id": fit_id, "base": mark["groupName"], "boxDbu": box,
                "extraRot": "NULL", "postfix": "", "inGroup": "G", "blockType": "OVL",
                "priority": True, "ruleItem": mark["groupName"], "lane": {"axis": "H", "track": 0},
            })
        # Off-axis coordinate pinned at the frame centre (500) so every
        # mark falls on the side `mark.get('side')` asks for by construction;
        # 'side' only ever varies the off-axis coordinate across the
        # centre line, never the on-axis one used for sorting.
        side = mark.get("side", "near")
        off = 10 if side == "near" else 990  # "near"/"far" relative to the centre (500)
        ct = [on_axis, off] if axis_is_x else [off, on_axis]
        targets.append({
            "row": mark["row"], "groupName": mark["groupName"], "partName": mark["groupName"],
            "target": f"T{mark['row']}", "lengthUm": "10", "locXUm": "0", "locYUm": "0",
            "ctDbu": ct, "pinstGroup": "G", "fitId": fit_id, "partition": partition,
        })
    return {"dbuPerUm": 1, "frame": frame, "fits": fits, "targets": targets}


class OrderDeviationTest(unittest.TestCase):
    def test_order_matches_requested_order_is_zero(self):
        marks = [
            {"row": 0, "groupName": "A", "ct": 0, "placed": 0},
            {"row": 1, "groupName": "B", "ct": 10, "placed": 10},
            {"row": 2, "groupName": "C", "ct": 20, "placed": 20},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB-bottom"], 0)
        self.assertEqual(d["byPartition"]["TB-top"], -1)
        self.assertEqual(d["byPartition"]["LR-left"], -1)
        self.assertEqual(d["byPartition"]["LR-right"], -1)
        self.assertIsNone(d["byPartition"]["IN"])
        self.assertEqual(d["max"], 0)
        self.assertEqual(d["missing"], [])
        self.assertEqual(d["flags"], {"LR": 3, "TB": 2})

    def test_in_partition_is_never_checked(self):
        marks = [{"row": 0, "groupName": "A", "ct": 0, "placed": 0, "bound": False}]
        snap = _marks_snapshot(marks, partition="IN")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"], {"TB-bottom": -1, "TB-top": -1, "LR-left": -1,
                                             "LR-right": -1, "IN": None})
        self.assertEqual(d["max"], -1)
        self.assertEqual(d["missing"], [])  # IN's unbound target is never even considered

    def test_tb_top_and_bottom_are_scored_independently(self):
        # Bottom (ctY=10 < 500): A, B, C match perfectly (requested ==
        # placed order) -> dev 0. Top (ctY=990 >= 500): D, E have their
        # *placed* x-positions swapped relative to their requested CT
        # x-order -> dev 1. Two different nonzero/zero outcomes on the
        # same partition, from a single call, is only possible if the
        # two sides are genuinely split and scored independently (a bug
        # that lumped them into one TB list could not reproduce both).
        marks = [
            {"row": 0, "groupName": "A", "ct": 0, "placed": 0, "side": "near"},
            {"row": 1, "groupName": "B", "ct": 10, "placed": 10, "side": "near"},
            {"row": 2, "groupName": "C", "ct": 20, "placed": 20, "side": "near"},
            {"row": 3, "groupName": "D", "ct": 0, "placed": 10, "side": "far"},
            {"row": 4, "groupName": "E", "ct": 10, "placed": 0, "side": "far"},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB-bottom"], 0)
        self.assertEqual(d["byPartition"]["TB-top"], 1)
        self.assertEqual(d["max"], 1)

    def test_duplicate_groupname_same_name_swap_is_zero_deviation(self):
        # Four TB-bottom marks requested (sorted by ct ascending) A, A, B,
        # C. The two "A" marks' CT/placed values are swapped between
        # themselves (A1 <-> A2); the sorted *name* sequence list2/list1
        # are built from is unaffected (both slots are still "A"), so
        # k-th-occurrence matching still pairs 0th-A<->0th-A, 1st-A<->
        # 1st-A: deviation stays 0.
        marks = [
            {"row": 0, "groupName": "A", "ct": 10, "placed": 10},
            {"row": 1, "groupName": "A", "ct": 0, "placed": 0},
            {"row": 2, "groupName": "B", "ct": 20, "placed": 20},
            {"row": 3, "groupName": "C", "ct": 30, "placed": 30},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB-bottom"], 0)
        self.assertEqual(d["missing"], [])

    def test_duplicate_groupname_cross_name_swap_is_nonzero_deviation(self):
        # Requested (ct, ascending) = A(0), A(10), B(20), C(30) ->
        # list2 = [A, A, B, C]. Placed positions swap A2's and B's slots:
        # A1 stays at 0, A2 moves to 20, B moves to 10, C stays at 30 ->
        # sorted-by-placed order = A1(0), B(10), A2(20), C(30) ->
        # list1 = [A, B, A, C]. k-th-occurrence matching (walk list1):
        #   list1[0]=A(k=0) <-> list2 idx 0 (A's 0th) -> dev |0-0| = 0
        #   list1[1]=B(k=0) <-> list2 idx 2 (B's 0th) -> dev |1-2| = 1
        #   list1[2]=A(k=1) <-> list2 idx 1 (A's 1st) -> dev |2-1| = 1
        #   list1[3]=C(k=0) <-> list2 idx 3 (C's 0th) -> dev |3-3| = 0
        # max = 1.
        marks = [
            {"row": 0, "groupName": "A", "ct": 0, "placed": 0},
            {"row": 1, "groupName": "A", "ct": 10, "placed": 20},
            {"row": 2, "groupName": "B", "ct": 20, "placed": 10},
            {"row": 3, "groupName": "C", "ct": 30, "placed": 30},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB-bottom"], 1)
        self.assertEqual(d["missing"], [])

    def test_duplicate_groupname_one_occurrence_unbound_pairs_by_index(self):
        # Requested (ct ascending, all three targets, bound or not) =
        # A(ct=0, unbound), A(ct=10), B(ct=20) -> list2 = [A, A, B].
        # Placed (bound only, by placed-x ascending) = B(placed=0),
        # A(placed=5) -> list1 = [B, A]. k-th-occurrence matching (walk
        # list1, the "placed" list):
        #   list1[0]=B(k=0) <-> list2 idx 2 (B's 0th) -> dev |0-2| = 2
        #   list1[1]=A(k=0) <-> list2 idx 0 (A's 0th) -> dev |1-0| = 1
        # max = 2. The unbound target ("A", ct=0, row 0) is unplaced and
        # reported under `missing`.
        marks = [
            {"row": 0, "groupName": "A", "ct": 0, "bound": False},
            {"row": 1, "groupName": "A", "ct": 10, "placed": 5},
            {"row": 2, "groupName": "B", "ct": 20, "placed": 0},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["TB-bottom"], 2)
        self.assertEqual(d["missing"], ["A"])

    def test_lr_partition_sorts_by_y_not_x(self):
        # Three LR-left marks (ctX < 500 for all) whose ctX and placed
        # box x-extents are deliberately uncorrelated with ctY/placed-y
        # and with each other (unlike `_marks_snapshot`'s marks, where
        # the off-axis coordinate is a constant and could not actually
        # distinguish an x-axis bug — verified by hand: a constant
        # off-axis value makes every axis choice produce the same
        # tie-broken-by-row order). Correct (y-axis, descending) sort:
        # requested by ctY = X(30), Y(20), Z(10); placed by box y-extent
        # (2*ctY+10, built to match) = X(70), Y(50), Z(30) — same order,
        # dev 0. Hand-verified that sorting by x instead (requested by
        # ctX ascending = X(10), Z(30), Y(50); placed by box x-extent
        # ascending = Y(30), Z(110), X(190)) gives mismatched orders
        # ([X, Z, Y] vs [Y, Z, X]) and a nonzero deviation (2) — so this
        # assertion of 0 is only reachable through a genuine y-axis sort.
        frame = {"widthDbu": 1000, "heightDbu": 1000}

        def target(row, name, ct_x, ct_y):
            return {"row": row, "groupName": name, "partName": name, "target": f"T{row}",
                    "lengthUm": "10", "locXUm": "0", "locYUm": "0", "ctDbu": [ct_x, ct_y],
                    "pinstGroup": "G", "fitId": f"{name}.F", "partition": "LR"}

        def fit(name, box_x_l, b, t):
            return {"id": f"{name}.F", "base": name, "boxDbu": [box_x_l, b, box_x_l + 10, t],
                    "extraRot": "NULL", "postfix": "", "inGroup": "G", "blockType": "OVL",
                    "priority": True, "ruleItem": name, "lane": {"axis": "H", "track": 0}}

        snap = {
            "dbuPerUm": 1, "frame": frame,
            "targets": [target(0, "X", 10, 30), target(1, "Y", 50, 20), target(2, "Z", 30, 10)],
            "fits": [fit("X", 90, 30, 40), fit("Y", 10, 20, 30), fit("Z", 50, 10, 20)],
        }
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["LR-left"], 0)

    def test_lr_left_and_right_split_by_ct_x(self):
        marks = [
            {"row": 0, "groupName": "L", "ct": 10, "placed": 10, "side": "near"},
            {"row": 1, "groupName": "R", "ct": 10, "placed": 10, "side": "far"},
        ]
        snap = _marks_snapshot(marks, partition="LR")
        d = metrics.order_deviation(snap)
        self.assertEqual(d["byPartition"]["LR-left"], 0)
        self.assertEqual(d["byPartition"]["LR-right"], 0)
        self.assertNotEqual(d["byPartition"]["LR-left"], -1)
        self.assertNotEqual(d["byPartition"]["LR-right"], -1)


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


def _verify_header(type_name, command, instances):
    return f"# mage-verify/1 type={type_name} command={command} instances={instances}"


_NATIVE_COMMANDS = {"OVERLAP": "frbCheckOverlap", "SPACE": "frbCheckSpace", "BOUNDARY": "frbCheckBoundary"}


class NativeRowsTest(unittest.TestCase):
    def test_native_rows_reads_instances_header(self):
        self.tmp = tempfile.TemporaryDirectory()
        overlap_path = Path(self.tmp.name) / "verify-OVERLAP.txt"
        overlap_path.write_text(
            _verify_header("OVERLAP", "frbCheckOverlap", 3) + "\nP_X 1 0.0 0.0\narbitrary line\n",
            encoding="utf-8",
        )
        r = metrics.native_rows({"OVERLAP": str(overlap_path)})
        self.assertEqual(r["byType"]["OVERLAP"], 3)
        self.tmp.cleanup()

    def test_native_rows_without_header_is_unknown(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = Path(self.tmp.name) / "verify-OVERLAP.txt"
        path.write_text("# header\nrow one\nrow two\n", encoding="utf-8")
        r = metrics.native_rows({"OVERLAP": str(path)})
        self.assertIsNone(r["byType"]["OVERLAP"])
        self.assertIn("OVERLAP", r["unknown"])
        self.assertIsNone(r["total"])
        self.tmp.cleanup()

    def test_native_rows_missing_file_is_unknown(self):
        self.tmp = tempfile.TemporaryDirectory()
        overlap_path = Path(self.tmp.name) / "verify-OVERLAP.txt"
        overlap_path.write_text(_verify_header("OVERLAP", "frbCheckOverlap", 2) + "\n", encoding="utf-8")
        r = metrics.native_rows({"OVERLAP": str(overlap_path)})
        self.assertEqual(r["byType"]["OVERLAP"], 2)
        self.assertIsNone(r["byType"]["SPACE"])
        self.assertIsNone(r["byType"]["BOUNDARY"])
        self.assertIsNone(r["total"])
        self.assertIn("SPACE", r["unknown"])
        self.assertIn("BOUNDARY", r["unknown"])
        self.tmp.cleanup()

    def test_native_rows_all_present_sums_total(self):
        self.tmp = tempfile.TemporaryDirectory()
        files = {}
        for i, type_name in enumerate(["OVERLAP", "SPACE", "BOUNDARY"]):
            path = Path(self.tmp.name) / f"verify-{type_name}.txt"
            path.write_text(_verify_header(type_name, _NATIVE_COMMANDS[type_name], i) + "\n", encoding="utf-8")
            files[type_name] = str(path)
        r = metrics.native_rows(files)
        self.assertEqual(r["unknown"], [])
        self.assertEqual(r["total"], sum(range(3)))
        self.tmp.cleanup()

    def test_native_rows_unreadable_file_is_unknown(self):
        r = metrics.native_rows({"OVERLAP": "/no/such/file-mage-metrics-test.rpt"})
        self.assertIsNone(r["byType"]["OVERLAP"])
        self.assertIn("OVERLAP", r["unknown"])
        self.assertIsNone(r["total"])


class UnboundTargetUnknownTest(unittest.TestCase):
    """C4: an unbound target makes the target-distance facts unknown, never 0."""

    def _snap(self, targets, fits):
        return {"dbuPerUm": 1, "frame": _ORDER_FRAME, "fits": fits, "targets": targets, "pending": []}

    def _bound_fit(self, fit_id, placed_x):
        return {"id": fit_id, "base": fit_id.split(".")[0], "boxDbu": [placed_x, 0, placed_x + 100, 40],
                "extraRot": "NULL", "postfix": "", "inGroup": "G", "blockType": "OVL",
                "priority": True, "ruleItem": "X", "lane": {"axis": "H", "track": 0}}

    def _target(self, row, fit_id, ct_x):
        return {"row": row, "groupName": "G", "partName": "X", "target": f"T{row}", "lengthUm": "10",
                "locXUm": "0", "locYUm": "0", "ctDbu": [ct_x, 0], "pinstGroup": "G",
                "fitId": fit_id, "partition": "TB"}

    def test_zero_bound_targets_report_unknown_not_zero(self):
        snap = self._snap(targets=[self._target(0, None, 200)], fits=[])
        t = metrics.target_distances(snap, "100")
        self.assertIsNone(t["maxUm"])
        self.assertIsNone(t["overLimitCount"])
        self.assertEqual([x["row"] for x in t["unbound"]], [0])

    def test_any_unbound_target_makes_over_limit_unknown(self):
        # One bound over-limit fit + one unbound target -> both facts unknown.
        fits = [self._bound_fit("F.F_1", 200)]
        targets = [self._target(0, "F.F_1", 400), self._target(1, None, 10)]
        t = metrics.target_distances(self._snap(targets, fits), "100")
        self.assertIsNone(t["overLimitCount"])
        self.assertIsNone(t["maxUm"])

    def test_all_bound_targets_stay_known(self):
        fits = [self._bound_fit("F.F_1", 200)]
        targets = [self._target(0, "F.F_1", 400)]
        t = metrics.target_distances(self._snap(targets, fits), "100")
        self.assertEqual(t["overLimitCount"], 1)
        self.assertEqual(t["maxUm"], "150")


class DroppedTargetKnownTest(unittest.TestCase):
    """N5: a target whose bound Fit is a known drop is reported under
    `droppedTargets` and excluded -- it does NOT make the round's target or
    order facts unknown (that mark is already counted by priorityUnplaced).
    Only a Fit that appears *nowhere* reads unknown."""

    def _snap(self, targets, fits, pending):
        return {"dbuPerUm": 1, "frame": _ORDER_FRAME, "fits": fits, "targets": targets, "pending": pending}

    def _target(self, row, fit_id, ct_x):
        return {"row": row, "groupName": "G", "partName": "X", "target": f"T{row}", "lengthUm": "10",
                "locXUm": "0", "locYUm": "0", "ctDbu": [ct_x, 0], "pinstGroup": "G",
                "fitId": fit_id, "partition": "TB"}

    def _fit(self, fit_id, placed_x):
        return {"id": fit_id, "base": fit_id.split(".")[0], "boxDbu": [placed_x, 0, placed_x + 100, 40],
                "extraRot": "NULL", "postfix": "", "inGroup": "G", "blockType": "OVL",
                "priority": True, "ruleItem": "X", "lane": {"axis": "H", "track": 0}}

    def test_one_dropped_priority_mark_keeps_target_facts_known(self):
        fits = [self._fit("F.F_1", 200)]  # placed centre 250, ct 250 -> alongUm 0
        targets = [self._target(0, "F.F_1", 250), self._target(1, "D.D_1", 100)]
        pending = [{"id": "D.D_1", "base": "D", "sizeDbu": [50, 50], "blockType": "OVL",
                    "ruleItem": "D", "inGroup": "G", "placedFlag": 0}]
        t = metrics.target_distances(self._snap(targets, fits, pending), "100")
        self.assertIsNotNone(t["maxUm"])
        self.assertIsNotNone(t["overLimitCount"])
        self.assertEqual(t["unbound"], [])
        self.assertEqual([x["row"] for x in t["droppedTargets"]], [1])

    def test_one_dropped_priority_mark_keeps_order_known(self):
        fits = [self._fit("F.F_1", 200)]
        targets = [self._target(0, "F.F_1", 250), self._target(1, "D.D_1", 100)]
        pending = [{"id": "D.D_1", "base": "D", "sizeDbu": [50, 50], "blockType": "OVL",
                    "ruleItem": "D", "inGroup": "G", "placedFlag": 0}]
        d = metrics.order_deviation(self._snap(targets, fits, pending))
        self.assertEqual(d["byPartition"]["TB-bottom"], 0)
        self.assertIsNotNone(d["max"])
        self.assertEqual([x["row"] for x in d["droppedTargets"]], [1])
        self.assertNotIn("G", d["missing"])

    def test_target_whose_fit_appears_nowhere_still_unknown(self):
        # A target bound to an id that is neither placed nor dropped is still
        # truly unknown (unplaced), not a drop.
        fits = [self._fit("F.F_1", 200)]
        targets = [self._target(0, "F.F_1", 250), self._target(1, "GHOST.G_1", 100)]
        t = metrics.target_distances(self._snap(targets, fits, []), "100")
        self.assertIsNone(t["maxUm"])
        self.assertIsNone(t["overLimitCount"])
        self.assertEqual([x["row"] for x in t["unbound"]], [1])
        self.assertEqual(t["droppedTargets"], [])


class AllUnboundSideOrderUnknownTest(unittest.TestCase):
    def test_side_with_rows_but_zero_bound_is_unknown_not_zero(self):
        marks = [
            {"row": 0, "groupName": "A", "ct": 0, "bound": False},
            {"row": 1, "groupName": "B", "ct": 10, "bound": False},
        ]
        snap = _marks_snapshot(marks, partition="TB")
        d = metrics.order_deviation(snap)
        self.assertIsNone(d["byPartition"]["TB-bottom"])
        self.assertIsNone(d["max"])


if __name__ == "__main__":
    unittest.main()
