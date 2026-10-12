import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import consumers, core  # noqa: E402
from tests import fixtures  # noqa: E402
from tests.test_metrics import build_incumbent, build_start  # noqa: E402


MODELS_DIR = Path(__file__).resolve().parents[1] / "consumer_models"
MODEL_IDS = ["litho-pie", "metrology", "alignment", "wat", "bonding"]


# --- a tiny, deliberately small YAML subset reader (mappings, lists of
# scalars/mappings, quoted/bare strings, ints, booleans, "{}"/"[]"; no
# anchors) -- test-only, kept out of the Pack's runtime code per the
# standard-library-only constraint. ---------------------------------------


def _scalar(text):
    text = text.strip()
    if text == "{}":
        return {}
    if text == "[]":
        return []
    if text == "true":
        return True
    if text == "false":
        return False
    if text == "null" or text == "":
        return None
    if text.startswith('"') and text.endswith('"') and len(text) >= 2:
        return text[1:-1]
    try:
        return int(text)
    except ValueError:
        return text


def _indent(line):
    return len(line) - len(line.lstrip(" "))


def _kv(line):
    stripped = line.strip()
    if ":" not in stripped:
        return stripped, ""
    key, value = stripped.split(":", 1)
    return key.strip(), value.strip()


def load_yaml_subset(text):
    lines = [line for line in text.splitlines() if line.strip() != ""]
    pos = [0]

    def parse_block(min_indent):
        if pos[0] >= len(lines) or _indent(lines[pos[0]]) < min_indent:
            return {}
        indent = _indent(lines[pos[0]])
        if lines[pos[0]].strip().startswith("- "):
            return parse_list(indent)
        return parse_map(indent)

    def parse_list(indent):
        result = []
        while pos[0] < len(lines) and _indent(lines[pos[0]]) == indent and lines[pos[0]].strip().startswith("- "):
            content = lines[pos[0]].strip()[2:].strip()
            pos[0] += 1
            if ":" in content:
                key, value = _kv(content)
                item = {key: _scalar(value) if value else parse_block(indent + 2)}
                while pos[0] < len(lines) and _indent(lines[pos[0]]) == indent + 2 and not lines[pos[0]].strip().startswith("- "):
                    k2, v2 = _kv(lines[pos[0]])
                    pos[0] += 1
                    item[k2] = _scalar(v2) if v2 else parse_block(indent + 4)
                result.append(item)
            else:
                result.append(_scalar(content))
        return result

    def parse_map(indent):
        result = {}
        while pos[0] < len(lines) and _indent(lines[pos[0]]) == indent and not lines[pos[0]].strip().startswith("- "):
            key, value = _kv(lines[pos[0]])
            pos[0] += 1
            result[key] = _scalar(value) if value else parse_block(indent + 2)
        return result

    return parse_block(0)


class YamlJsonAgreementTest(unittest.TestCase):
    def test_yaml_and_json_models_agree(self):
        for model_id in MODEL_IDS:
            with self.subTest(model=model_id):
                json_body = json.loads((MODELS_DIR / f"{model_id}.json").read_text(encoding="utf-8"))
                yaml_body = load_yaml_subset((MODELS_DIR / f"{model_id}.yml").read_text(encoding="utf-8"))
                self.assertEqual(yaml_body, json_body)


class LoadConsumerModelTest(unittest.TestCase):
    def test_loads_and_validates_every_model(self):
        for model_id in MODEL_IDS:
            with self.subTest(model=model_id):
                model = consumers.load_consumer_model(MODELS_DIR, model_id)
                self.assertEqual(model["id"], model_id)
                self.assertEqual(model["schema"], "mage.consumer-model/1")

    def test_bonding_is_disabled(self):
        model = consumers.load_consumer_model(MODELS_DIR, "bonding")
        self.assertFalse(model.get("enabled", True))

    def test_schema_violation_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "broken.json"
            path.write_text(json.dumps({"schema": "mage.consumer-model/1", "id": "broken", "version": "0.1.0",
                                         "scope": {}, "requirements": [], "unexpectedField": 1}), encoding="utf-8")
            with self.assertRaises(core.MageError):
                consumers.load_consumer_model(tmp, "broken")


class EvaluateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)
        self.out_dir = str(Path(self.tmp.name) / "receipts")

    def tearDown(self):
        self.tmp.cleanup()

    def _context(self, **overrides):
        context = dict(self.case["consumerContext"])
        context.update(overrides)
        return context

    def test_unknown_parameter_yields_unknown_not_zero(self):
        start = build_start(self.case)
        candidate = build_incumbent(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "metrology")
        context_without_window = self._context(metrology={})
        result = consumers.evaluate(model, context_without_window, candidate, start, {}, self.out_dir)
        edit = next(f for f in result["findings"] if f["predicate"] == "edit_on_move")
        self.assertEqual(edit["status"], "unknown")
        self.assertIn("metrology.search_window_um", edit["numbers"]["missing"])

    def test_wat_dropped_key_is_hard_fail(self):
        start = build_start(self.case)
        incumbent = build_incumbent(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "wat")
        context = self._context()
        result = consumers.evaluate(model, context, incumbent, start, {}, self.out_dir)
        placed = next(f for f in result["findings"] if f["predicate"] == "placed")
        self.assertEqual((placed["status"], placed["severity"]), ("fail", "hard"))
        self.assertEqual(placed["targets"], ["KEY_V.KEY_V"])

    def test_receipt_sha_matches_file(self):
        start = build_start(self.case)
        incumbent = build_incumbent(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "wat")
        result = consumers.evaluate(model, self._context(), incumbent, start, {}, self.out_dir)
        self.assertEqual(core.file_sha256(result["receiptPath"]), result["receiptSha256"])
        for finding in result["findings"]:
            self.assertEqual(finding["evaluatorReceipt"], result["receiptSha256"])

    def test_receipt_body_omits_evaluator_receipt_field(self):
        start = build_start(self.case)
        incumbent = build_incumbent(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "wat")
        result = consumers.evaluate(model, self._context(), incumbent, start, {}, self.out_dir)
        receipt_body = json.loads(Path(result["receiptPath"]).read_text(encoding="utf-8"))
        for finding in receipt_body["findings"]:
            self.assertNotIn("evaluatorReceipt", finding)

    def test_findings_are_numbered_and_validate(self):
        from mage_placement import records

        start = build_start(self.case)
        incumbent = build_incumbent(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "wat")
        result = consumers.evaluate(model, self._context(), incumbent, start, {}, self.out_dir)
        ids = [f["id"] for f in result["findings"]]
        # C3: Finding ids are per-consumer, F-<consumer>-<n>, so one Run's
        # four reviews never collide on a bare F-<n>.
        self.assertEqual(ids, [f"F-wat-{i}" for i in range(1, len(ids) + 1)])
        for finding in result["findings"]:
            self.assertEqual(records.validate_record("finding", finding), [])

    def test_wat_move_cost_uses_pad_pitch_from_context(self):
        start = build_start(self.case)
        candidate = dict(build_start(self.case))
        candidate["fits"] = [dict(f) for f in candidate["fits"]]
        key_fit = None
        for fit in candidate["fits"]:
            if fit["base"] == "KEY_V":
                key_fit = fit
        # Synthesize a moved KEY_V fit (start has none placed; move a copy of
        # AL_X's box far enough to trigger the wrong-pad risk threshold at
        # pad_pitch_um=100 -> need a delta >= 50um = 500000 dbu half-pitch).
        if key_fit is None:
            template = dict(candidate["fits"][0])
            template["id"] = "KEY_V.KEY_V_1"
            template["base"] = "KEY_V"
            template["blockType"] = "TSK/MPAD"
            template["ruleItem"] = "KEY_V"
            template["boxDbu"] = [0, 0, 9000000, 600000]
            candidate["fits"].append(template)
        model = consumers.load_consumer_model(MODELS_DIR, "wat")

        base_start = dict(start)
        base_start["fits"] = [dict(f) for f in base_start["fits"]]
        base_start["fits"].append({
            "id": "KEY_V.KEY_V_1", "base": "KEY_V", "boxDbu": [0, 0, 9000000, 600000],
            "extraRot": "NULL", "postfix": "", "inGroup": "", "blockType": "TSK/MPAD",
            "priority": False, "ruleItem": "KEY_V", "lane": None,
        })
        moved = dict(candidate)
        moved["fits"] = [dict(f) for f in base_start["fits"]]
        for fit in moved["fits"]:
            if fit["id"] == "KEY_V.KEY_V_1":
                l, b, r, t = fit["boxDbu"]
                fit["boxDbu"] = [l + 600000, b, r + 600000, t]  # +60um in x -> 0.6 pitch at 100um pitch
        moved["snapshotSha256"] = "d" * 64

        result = consumers.evaluate(model, self._context(), moved, base_start, {}, self.out_dir)
        move_cost = next(f for f in result["findings"] if f["predicate"] == "move_in_pitch_units")
        self.assertEqual(move_cost["status"], "fail")
        self.assertIn("KEY_V.KEY_V_1", move_cost["numbers"]["wrongPadRisk"])


class PredicateUnitTest(unittest.TestCase):
    """Direct predicate exercises not covered by the fixture-driven evaluate() tests above."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)
        self.out_dir = str(Path(self.tmp.name) / "receipts")

    def tearDown(self):
        self.tmp.cleanup()

    def test_canon_side_rule_is_unknown_not_an_error(self):
        start = build_start(self.case)
        candidate = build_incumbent(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "alignment")
        result = consumers.evaluate(model, dict(self.case["consumerContext"]), candidate, start, {}, self.out_dir)
        canon = next(f for f in result["findings"] if f["predicate"] == "not_implemented")
        self.assertEqual(canon["status"], "unknown")
        self.assertIn("Canon", canon["explanation"])

    def test_unrecognised_predicate_raises(self):
        model = {
            "schema": "mage.consumer-model/1", "id": "broken", "version": "0.1.0",
            "scope": {"blockTypes": ["OVL"]},
            "requirements": [{"id": "x", "kind": "hard", "predicate": "nope", "parameters": {},
                               "source": {"type": "assumption"}, "confidence": "low"}],
        }
        start = build_start(self.case)
        candidate = build_incumbent(self.case)
        with self.assertRaises(core.MageError):
            consumers.evaluate(model, {}, candidate, start, {}, self.out_dir)

    def test_region_coverage_fails_when_a_corner_drops_to_zero(self):
        start = build_start(self.case)
        candidate = dict(start)
        candidate["fits"] = [f for f in start["fits"] if f["base"] != "OVL_A"]
        candidate["snapshotSha256"] = "e" * 64
        model = consumers.load_consumer_model(MODELS_DIR, "metrology")
        result = consumers.evaluate(model, dict(self.case["consumerContext"]), candidate, start, {}, self.out_dir)
        region = [f for f in result["findings"] if f["predicate"] == "region_coverage"]
        self.assertTrue(any(f["status"] == "fail" for f in region))

    def test_order_deviation_unknown_without_threshold_or_goal(self):
        start = build_start(self.case)
        candidate = build_start(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "litho-pie")
        result = consumers.evaluate(model, dict(self.case["consumerContext"]), candidate, start, {}, self.out_dir)
        order = next(f for f in result["findings"] if f["predicate"] == "order_deviation")
        self.assertEqual(order["status"], "unknown")

    def test_order_deviation_uses_goal_fallback(self):
        start = build_start(self.case)
        candidate = build_start(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "litho-pie")
        result = consumers.evaluate(
            model, dict(self.case["consumerContext"]), candidate, start, {}, self.out_dir,
            goal={"max_target_distance_um": "100", "max_order_deviation": 5, "target_dropped_count": 0},
        )
        order = next(f for f in result["findings"] if f["predicate"] == "order_deviation")
        self.assertEqual(order["status"], "pass")
        self.assertEqual(order["numbers"]["threshold"], 5)

    def test_target_distance_uses_goal_fallback_when_context_lacks_it(self):
        start = build_start(self.case)
        candidate = build_start(self.case)
        model = consumers.load_consumer_model(MODELS_DIR, "litho-pie")
        result = consumers.evaluate(
            model, dict(self.case["consumerContext"]), candidate, start, {}, self.out_dir,
            goal={"max_target_distance_um": "100", "max_order_deviation": 1, "target_dropped_count": 0},
        )
        target = next(f for f in result["findings"] if f["predicate"] == "target_distance")
        self.assertNotEqual(target["status"], "unknown")

    def test_native_rows_for_reports_unknown_for_missing_file(self):
        start = build_start(self.case)
        candidate = build_incumbent(self.case)
        model = {
            "schema": "mage.consumer-model/1", "id": "diag", "version": "0.1.0",
            "scope": {"blockTypes": ["OVL"]},
            "requirements": [{"id": "rows", "kind": "cost", "predicate": "native_rows_for",
                               "parameters": {"types": {"value": ["OVERLAP", "SPACE"]}},
                               "source": {"type": "assumption"}, "confidence": "low"}],
        }
        result = consumers.evaluate(model, {}, candidate, start, {}, self.out_dir)
        rows = [f for f in result["findings"] if f["predicate"] == "native_rows_for"]
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(f["status"] == "unknown" for f in rows))
        self.assertTrue(all(f["severity"] == "info" for f in rows))

    @staticmethod
    def _cohesion_snapshot(fit_a_box, fit_b_box, sha):
        return {
            "dbuPerUm": 10000,
            "frame": {"widthDbu": 1000000, "heightDbu": 1000000, "scribeDbu": 1000,
                      "cols": 1, "rows": 1, "dieWidthDbu": 998000, "dieHeightDbu": 998000},
            "fits": [
                {"id": "A.A_1", "base": "A", "boxDbu": fit_a_box, "extraRot": "NULL", "postfix": "",
                 "inGroup": "", "blockType": "OVL", "priority": False, "ruleItem": "A", "lane": None},
                {"id": "B.B_1", "base": "B", "boxDbu": fit_b_box, "extraRot": "NULL", "postfix": "",
                 "inGroup": "", "blockType": "OVL", "priority": False, "ruleItem": "B", "lane": None},
            ],
            "pending": [],
            "targets": [],
            "ruleFacts": {"A": {"cluster": "CL1"}, "B": {"cluster": "CL1"}},
            "snapshotSha256": sha,
        }

    def test_pair_cohesion_mismatch_is_cost_severity_on_the_metrology_model(self):
        # metrology.json's pair-cohesion requirement is `kind: cost` -- its
        # fail Finding must carry `severity: cost`, not the hard-coded
        # "hard" the review flagged (coordinator fix-round-1).
        start = self._cohesion_snapshot([0, 0, 100, 100], [0, 0, 100, 100], "f" * 64)
        candidate = self._cohesion_snapshot([10, 0, 110, 100], [0, 0, 100, 100], "g" * 64)
        model = consumers.load_consumer_model(MODELS_DIR, "metrology")
        result = consumers.evaluate(model, {}, candidate, start, {}, self.out_dir)
        cohesion = next(f for f in result["findings"] if f["predicate"] == "pair_cohesion")
        self.assertEqual(cohesion["status"], "fail")
        self.assertEqual(cohesion["severity"], "cost")

    def test_pair_cohesion_mismatch_is_hard_severity_when_requirement_kind_is_hard(self):
        start = self._cohesion_snapshot([0, 0, 100, 100], [0, 0, 100, 100], "f" * 64)
        candidate = self._cohesion_snapshot([10, 0, 110, 100], [0, 0, 100, 100], "g" * 64)
        model = {
            "schema": "mage.consumer-model/1", "id": "diag-hard", "version": "0.1.0",
            "scope": {"blockTypes": ["OVL"]},
            "requirements": [{"id": "pair-cohesion", "kind": "hard", "predicate": "pair_cohesion",
                               "parameters": {}, "source": {"type": "assumption"}, "confidence": "low"}],
        }
        result = consumers.evaluate(model, {}, candidate, start, {}, self.out_dir)
        cohesion = next(f for f in result["findings"] if f["predicate"] == "pair_cohesion")
        self.assertEqual(cohesion["status"], "fail")
        self.assertEqual(cohesion["severity"], "hard")


if __name__ == "__main__":
    unittest.main()
