import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, lanes, pla, rules, snapshot, targets
from tests import fixtures


SCHEMAS = Path(__file__).resolve().parents[1] / "schemas"


def _frame_and_facts(case):
    rule_text = Path(case["files"]["rule"]).read_text()
    pblock_text = Path(case["files"]["pblock"]).read_text()
    block_text = Path(case["files"]["block"]).read_text()
    frame = rules.frame_from_rule(rule_text, pblock_text, 10000)
    rule_facts = rules.read_rule_facts(rule_text, 10000)
    block_types = rules.read_block_types(block_text, 10000)
    return frame, rule_facts, block_types


def _targets(case, frame):
    csv_text = Path(case["files"]["targetTable"]).read_text()
    rows = targets.read_targets(csv_text, frame, 10000)
    doc = pla.read_pla(Path(case["files"]["startState"]).read_text(), 10000)
    return targets.bind_targets(rows, doc["groups"], doc["fits"])


def build_start(case):
    frame, rule_facts, block_types = _frame_and_facts(case)
    bound_targets = _targets(case, frame)
    doc = pla.read_pla(Path(case["files"]["startState"]).read_text(), 10000)
    inputs = {"startState": {"path": case["files"]["startState"],
                              "sha256": core.file_sha256(case["files"]["startState"])}}
    return snapshot.build_snapshot(
        "start", doc, frame, rule_facts, bound_targets, block_types, inputs, pending_from_rules=True
    )


def build_incumbent(case):
    frame, rule_facts, block_types = _frame_and_facts(case)
    bound_targets = _targets(case, frame)
    doc = pla.read_pla(Path(case["files"]["incumbentState"]).read_text(), 10000)
    inputs = {"startState": {"path": case["files"]["startState"],
                              "sha256": core.file_sha256(case["files"]["startState"])}}
    return snapshot.build_snapshot(
        "incumbent", doc, frame, rule_facts, bound_targets, block_types, inputs, pending_from_rules=False
    )


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_start_snapshot_has_priority_fits_and_pending_from_rules(self):
        snap = build_start(self.case)
        self.assertEqual(sorted(f["base"] for f in snap["fits"] if f["priority"]), ["AL_X", "OVL_A", "OVL_B"])
        self.assertEqual(sorted(p["base"] for p in snap["pending"]), ["KEY_V", "OVL_F", "OVL_F"])

    def test_incumbent_snapshot_pending_from_drops(self):
        snap = build_incumbent(self.case)
        self.assertEqual([p["base"] for p in snap["pending"]], ["KEY_V"])
        self.assertEqual(snap["pending"][0]["placedFlag"], 0)

    def test_sha_binds_body(self):
        snap = build_start(self.case)
        snap["fits"][0]["boxDbu"][0] += 100
        path = Path(self.tmp.name) / "mutated-snapshot.json"
        path.write_text(json.dumps(snap), encoding="utf-8")
        with self.assertRaises(core.MageError):
            snapshot.load_snapshot(path)

    def test_schema_validates(self):
        snap = build_start(self.case)
        schema = json.loads((SCHEMAS / "snapshot.json").read_text())
        self.assertEqual(core.validate(snap, schema), [])

    def test_load_snapshot_round_trips(self):
        snap = build_start(self.case)
        path = Path(self.tmp.name) / "start-snapshot.json"
        path.write_text(json.dumps(snap), encoding="utf-8")
        loaded = snapshot.load_snapshot(path)
        self.assertEqual(loaded, snap)

    def test_fit_without_lane_gets_warning(self):
        # AL_X's box (-90, 665, 90, 715) um straddles the shared V:0 scribe
        # at x=0 (its -setZone centers it there) but, at 1800 um wide, is
        # wider than the 60 um scribe band itself, so it is not fully
        # contained in any single lane: this is the fixture's built-in
        # no-lane case.
        frame, rule_facts, block_types = _frame_and_facts(self.case)
        bound_targets = _targets(self.case, frame)
        doc = pla.read_pla(Path(self.case["files"]["startState"]).read_text(), 10000)
        inputs = {}
        snap = snapshot.build_snapshot("start", doc, frame, rule_facts, bound_targets, block_types, inputs)
        al_x = next(f for f in snap["fits"] if f["base"] == "AL_X")
        self.assertIsNone(al_x["lane"])
        self.assertIn({"code": "no-lane", "id": al_x["id"]}, snap["warnings"])

        # A fit that genuinely has no home in any scribe band also warns.
        doc["fits"][0]["boxDbu"] = [1000000, 1000000, 1100000, 1100000]
        snap2 = snapshot.build_snapshot("start", doc, frame, rule_facts, bound_targets, block_types, inputs)
        self.assertIsNone(snap2["fits"][0]["lane"])
        self.assertIn({"code": "no-lane", "id": doc["fits"][0]["id"]}, snap2["warnings"])


if __name__ == "__main__":
    unittest.main()
