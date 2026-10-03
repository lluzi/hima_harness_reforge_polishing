"""Resident engineering result Reader: complete, no-op, mixed and tampered evidence."""
from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))

from atcs import core  # noqa: E402
from external_timing_evaluation import evaluate

spec = importlib.util.spec_from_file_location("read_atcs_engineering", PACK_DIR / "tools" / "read-atcs.py")
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class EngineeringResultReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.w = Path(self.tmp.name) / "workspace"
        (self.w / "flow").mkdir(parents=True)
        os.symlink(FLOW_DIR / "atcs", self.w / "flow" / "atcs")
        (self.w / "state").mkdir()
        self._write_state("baseline.json", core.stamp("design-state", {"top": "top"}))
        self._write_state("xtop-context.json", core.stamp("xtop-context", {"requiredScenarios": ["s1"]}))
        self.before = self._metrics("before", -0.10, -0.20, 1, 0.0, 0.0, 0)
        common = core.stamp("common-stage", {
            "stateId": "common-state", "worklistId": "common-worklist",
            "measurements": {"before": self.before, "after": self.before},
        })
        self._write_state("common-stage.json", common)
        identity = {
            "baselineStateId": json.loads((self.w / "state/baseline.json").read_text())["id"],
            "nativeContextId": json.loads((self.w / "state/xtop-context.json").read_text())["id"],
            "commonStateId": "common-state", "worklistId": "common-worklist",
        }
        self.identity = identity
        self.reference = self._metrics("reference", -0.02, -0.02, 1, 0.0, 0.0, 0)
        self._write_state("autofix-reference.json", core.stamp("autofix-reference", {
            "inputIdentity": identity, "goal": {"setupWnsNs": 0, "holdWnsNs": 0},
            "measurements": {"before": self.before, "after": self.reference},
        }))

    def _write_state(self, name, obj):
        core.write_artifact(self.w / "state" / name, obj)

    def _file(self, rel, text):
        path = self.w / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return {"path": rel, "sha256": core.file_sha256(path)}

    def _metrics(self, prefix, setup_wns, setup_tns, setup_count, hold_wns, hold_tns, hold_count):
        def report(mode, wns, tns, count):
            text = (f"### {mode} summary ###\n"
                    "Scenario Count Worst TNS\n"
                    "--------------------------------\n"
                    f"total {count} {wns} {tns}\n")
            return self._file(f"raw/{prefix}-{mode}.rpt", text)
        return {
            "setup": {"wnsNs": setup_wns, "tnsNs": setup_tns, "violations": setup_count,
                      "report": report("setup", setup_wns, setup_tns, setup_count)},
            "hold": {"wnsNs": hold_wns, "tnsNs": hold_tns, "violations": hold_count,
                     "report": report("hold", hold_wns, hold_tns, hold_count)},
        }

    def _collateral_phase(self, phase, counts=None):
        counts = counts or {check: 1 for check in ("transition", "capacitance", "fanout", "legality")}
        reason = {
            "transition": "break_max_transition", "capacitance": "break_max_capacitance",
            "fanout": "break_max_fanout", "legality": "legal_fail_no_space_on_row",
        }
        result = {}
        for check in ("transition", "capacitance", "fanout", "legality"):
            rows = "".join(
                f"-0.01 s1 U{i}/D {reason[check]}:100%\n" for i in range(counts.get(check, 0)))
            raw = ("### setup top 20 endpoints ###\n"
                   "Slack Scenario Name Fail Reason\n"
                   "--------------------------------\n" + rows)
            result[check] = {
                "scope": "timing-fix-fail-reasons",
                "stateId": self.identity["commonStateId"] if phase == "before" else "selected-state",
                "requiredScenarios": ["s1"],
                "source": {**self._file(f"raw/{phase}-{check}.rpt", raw),
                           "tool": "XTop", "version": "fixture",
                           "command": "summarize_gba_violations -with_fail_reason"},
            }
        return result

    def _result(self, after=None, no_op=False):
        after = after or self._metrics("after", 0.0, 0.0, 0, 0.0, 0.0, 0)
        checkpoint = self.w / "engineering/best-workspace"
        checkpoint.mkdir(parents=True, exist_ok=True)
        (checkpoint / "state").write_text("native checkpoint", encoding="utf-8")
        remaining = [{"mode": "setup", "endpoint": f"U{i}/D"} for i in range(
            after["setup"]["violations"] + after["hold"]["violations"])]
        collateral = {"before": self._collateral_phase("before"), "after": self._collateral_phase("after")}
        body = {
            "kind": "result",
            "task": {"taskId": "task-1", "runId": "run-1", "executionId": "execution-1", "nodeId": "fix-timing"},
            "inputIdentity": dict(self.identity),
            "selected": {"stateId": "selected-state",
                         "checkpoint": {"path": "engineering/best-workspace", "digest": core.tree_digest(checkpoint)}},
            "measurements": {"before": self.before, "after": after},
            "collateral": collateral,
            "artifacts": {
                "scripts": [self._file("engineering/fix.tcl", "# actual engineering script\n")],
                "logicalEco": self._file("engineering/final_netlist_eco.txt", ""),
                "physicalEco": self._file("engineering/final_physical_eco.txt", ""),
                "reproduction": self._file("engineering/REPRODUCE.md", "source fix.tcl\n"),
                "nativeTrace": [self._file("engineering/native.log", "XTop native trace\n")],
            },
            "remaining": remaining, "regressed": [], "blocked": [], "unknown": [],
            "stopReason": "best measured state delivered", "bestEffort": bool(remaining), "noOp": no_op,
        }
        return core.stamp("engineering-result", body)

    def _deliver(self, result):
        report = self.w / "state/engineering-result.json"
        core.write_artifact(report, result)
        body = {
            "schema": "hima-resident-engineering-delivery/1",
            "taskId": result["task"]["taskId"], "runId": result["task"]["runId"],
            "executionId": result["task"]["executionId"], "nodeId": result["task"]["nodeId"],
            "sessionId": "native-session", "outcome": "best-effort", "summary": "fixture",
            "stopReason": result["stopReason"], "candidate": {"path": "resident-delivery.json", "sha256": "0" * 64},
            "artifactRoot": "workspace", "artifacts": [{
                "path": "result.json", "sha256": core.file_sha256(report), "kind": "result",
            }], "createdAt": "2026-10-02T00:00:00.000Z",
        }
        body["sha256"] = hashlib.sha256(core.canonical(body)).hexdigest()
        manifest = self.w / ".hima-engineering/task-1/delivery/manifest.json"
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps(body), encoding="utf-8")
        return report

    def _external_comparison(self, report):
        external = self.w.parent / "independent-reference"
        external.mkdir(exist_ok=True)
        shutil.copytree(self.w / "raw", external / "raw", dirs_exist_ok=True)
        reference = external / "reference.json"
        shutil.copy2(self.w / "state/autofix-reference.json", reference)
        return evaluate(reader, report, self.w, reference, external, {"setupWnsNs": 0, "holdWnsNs": 0})

    def test_complete_result_emits_native_goal_and_external_evaluator_compares_independently(self):
        report = self._deliver(self._result())
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_result_error_count"]["value"], 0)
        self.assertEqual(values["tc_engineering_setup_wns_ns"]["value"], 0.0)
        self.assertEqual(values["tc_engineering_remaining_violation_count"]["value"], 4)
        self.assertEqual(values["tc_engineering_collateral_unknown_count"]["value"], 4,
                         "timing-fix fail reasons are bounded blocker evidence, not global checks")
        self.assertEqual(self._external_comparison(report)["effect"]["value"], 1)

    def test_product_delivery_needs_no_external_benchmark(self):
        (self.w / "state/autofix-reference.json").unlink()
        report = self._deliver(self._result())
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_timing_remaining_violation_count"]["value"], 0)
        self.assertNotIn("tc_engineering_effect_vs_autofix", values)
        self.assertFalse(any("reference" in name for name in values))

    def test_unrelated_external_reference_cannot_change_product_reading(self):
        (self.w / "state/autofix-reference.json").write_text("not product input")
        report = self._deliver(self._result())
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_setup_violation_count"]["value"], 0)

    def test_complete_best_effort_mixed_effect_is_unknown_and_goal_can_remain_false(self):
        after = self._metrics("mixed", 0.0, 0.0, 0, -0.01, -0.01, 1)
        report = self._deliver(self._result(after=after))
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_result_error_count"]["value"], 0)
        self.assertEqual(values["tc_engineering_remaining_violation_count"]["value"], 5)
        effect = self._external_comparison(report)["effect"]
        self.assertIsNone(effect["value"])
        self.assertIn("mixed", effect["unknownReason"])

    def test_effect_comparison_allows_positive_setup_margin_to_fund_hold_progress(self):
        control = self._metrics("margin-control", 0.10, 0.0, 0, -0.10, -0.30, 2)
        self._write_state("autofix-reference.json", core.stamp("autofix-reference", {
            "inputIdentity": self.identity, "goal": {"setupWnsNs": 0, "holdWnsNs": 0},
            "measurements": {"before": self.before, "after": control},
        }))
        after = self._metrics("margin-resident", 0.03, 0.0, 0, -0.05, -0.10, 1)
        report = self._deliver(self._result(after=after))
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(self._external_comparison(report)["effect"]["value"], 1)

    def test_legitimate_no_op_requires_real_exports_and_equal_measurements(self):
        report = self._deliver(self._result(after=self.before, no_op=True))
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_result_error_count"]["value"], 0)
        self.assertEqual(self._external_comparison(report)["effect"]["value"], -1)

    def test_unknown_required_collateral_keeps_all_violations_goal_unknown(self):
        result = self._result()
        result["collateral"]["after"]["legality"] = {"unknown": "native legality report command was unavailable"}
        result["unknown"] = [{"check": "legality", "reason": "native legality report command was unavailable"}]
        result = core.stamp("engineering-result", {key: value for key, value in result.items() if key not in ("schema", "id")})
        report = self._deliver(result)
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_remaining_violation_count"]["value"], 3,
                         "other raw blockers remain a known positive lower bound")
        self.assertEqual(values["tc_engineering_collateral_unknown_count"]["value"], 4)

    def test_raw_collateral_and_timing_facts_override_empty_model_remaining_and_regressed_lists(self):
        after = self._metrics("regressed", -0.20, -0.30, 2, 0.0, 0.0, 0)
        result = self._result(after=after)
        result["collateral"]["after"] = self._collateral_phase(
            "after", {"transition": 2, "capacitance": 1, "fanout": 1, "legality": 1})
        result["remaining"] = []
        result["regressed"] = []
        result = core.stamp("engineering-result", {key: value for key, value in result.items() if key not in ("schema", "id")})
        report = self._deliver(result)
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_remaining_violation_count"]["value"], 7)
        self.assertEqual(values["tc_engineering_timing_remaining_violation_count"]["value"], 2)
        self.assertEqual(values["tc_engineering_regression_count"]["value"], 2,
                         "setup and transition regressions come from raw before/after facts")

    def test_unsupported_collateral_report_format_is_unknown_never_proof_of_zero(self):
        result = self._result()
        unsupported = self._file("raw/after-legality-unsupported.rpt", "native format not yet supported\n")
        result["collateral"]["after"]["legality"] = {
            "scope": "timing-fix-fail-reasons", "stateId": "selected-state", "requiredScenarios": ["s1"],
            "source": {**unsupported, "tool": "XTop", "version": "fixture", "command": "unknown report"},
        }
        result["unknown"] = []
        result = core.stamp("engineering-result", {key: value for key, value in result.items() if key not in ("schema", "id")})
        report = self._deliver(result)
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertEqual(values["tc_engineering_remaining_violation_count"]["value"], 3)
        self.assertIsNone(values["tc_engineering_regression_count"]["value"])
        self.assertEqual(values["tc_engineering_collateral_unknown_count"]["value"], 4)

    def test_model_declared_zero_collateral_is_refused_even_with_a_hashed_file(self):
        result = self._result()
        source = result["collateral"]["after"]["transition"]["source"]
        result["collateral"]["after"]["transition"] = {
            "violations": 0, "report": {"path": source["path"], "sha256": source["sha256"]},
        }
        result = core.stamp("engineering-result", {key: value for key, value in result.items() if key not in ("schema", "id")})
        report = self._deliver(result)
        with self.assertRaisesRegex(ValueError, "model counts are not evidence"):
            reader.read("engineering-result", report, self.w)

    def test_empty_bounded_fail_reason_reports_cannot_prove_global_zero(self):
        result = self._result()
        empty = {check: 0 for check in ("transition", "capacitance", "fanout", "legality")}
        result["collateral"] = {
            "before": self._collateral_phase("before", empty),
            "after": self._collateral_phase("after", empty),
        }
        result = core.stamp("engineering-result", {key: value for key, value in result.items() if key not in ("schema", "id")})
        report = self._deliver(result)
        values = {row["type"]: row for row in reader.read("engineering-result", report, self.w)}
        self.assertIsNone(values["tc_engineering_remaining_violation_count"]["value"])
        self.assertIsNone(values["tc_engineering_regression_count"]["value"])
        self.assertEqual(values["tc_engineering_timing_remaining_violation_count"]["value"], 0)
        self.assertEqual(values["tc_engineering_setup_violation_count"]["value"], 0)
        self.assertEqual(values["tc_engineering_hold_violation_count"]["value"], 0)
        self.assertNotIn("tc_engineering_reference_setup_violation_count", values)
        self.assertEqual(values["tc_engineering_collateral_unknown_count"]["value"], 4)

    def test_tampered_raw_report_is_refused_instead_of_becoming_unknown_or_zero(self):
        result = self._result()
        report = self._deliver(result)
        (self.w / result["measurements"]["after"]["setup"]["report"]["path"]).write_text("tampered", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "sha256 mismatch"):
            reader.read("engineering-result", report, self.w)

    def test_missing_script_is_an_incomplete_delivery(self):
        result = self._result()
        result["artifacts"]["scripts"] = []
        result = core.stamp("engineering-result", {key: value for key, value in result.items() if key not in ("schema", "id")})
        report = self._deliver(result)
        with self.assertRaisesRegex(ValueError, "scripts must be a non-empty list"):
            reader.read("engineering-result", report, self.w)

    def test_external_comparison_refuses_mismatched_identity_and_forged_raw_reference(self):
        report = self._deliver(self._result())
        self._external_comparison(report)
        external = self.w.parent / "independent-reference"
        reference = external / "reference.json"
        original = json.loads(reference.read_text())
        wrong = dict(original, inputIdentity=dict(self.identity, commonStateId="another-R1"))
        core.write_artifact(reference, core.stamp("autofix-reference", {k:v for k,v in wrong.items() if k not in ("schema", "id")}))
        with self.assertRaisesRegex(ValueError, "exact input/R1"):
            evaluate(reader, report, self.w, reference, external, {"setupWnsNs": 0, "holdWnsNs": 0})
        core.write_artifact(reference, original)
        (external / original["measurements"]["after"]["setup"]["report"]["path"]).write_text("forged")
        with self.assertRaisesRegex(ValueError, "sha256 mismatch"):
            evaluate(reader, report, self.w, reference, external, {"setupWnsNs": 0, "holdWnsNs": 0})
        # The independent benchmark's corruption does not replace or invalidate a product result.
        self.assertEqual(reader.read("engineering-result", report, self.w)[0]["value"], 0)

    def test_missing_or_fabricated_timing_cannot_be_hidden_without_a_reference(self):
        (self.w / "state/autofix-reference.json").unlink()
        obj = self._result()
        obj["measurements"]["after"]["setup"]["wnsNs"] = 1.0
        obj = core.stamp("engineering-result", {k:v for k,v in obj.items() if k not in ("schema", "id")})
        report = self._deliver(obj)
        with self.assertRaisesRegex(ValueError, "raw|differ|match|disagree"):
            reader.read("engineering-result", report, self.w)
        (self.w / obj["measurements"]["after"]["setup"]["report"]["path"]).unlink()
        with self.assertRaisesRegex(ValueError, "file not found"):
            reader.read("engineering-result", report, self.w)

    def test_external_comparison_cannot_change_the_product_target(self):
        report = self._deliver(self._result())
        control = json.loads((self.w / "state/autofix-reference.json").read_text())
        changed_goal = {"setupWnsNs": 0.1, "holdWnsNs": 0}
        control["goal"] = changed_goal
        control = core.stamp("autofix-reference", {k:v for k,v in control.items() if k not in ("schema", "id")})
        self._write_state("autofix-reference.json", control)
        with self.assertRaisesRegex(ValueError, "product.*target"):
            evaluate(reader, report, self.w, self.w / "state/autofix-reference.json", self.w, changed_goal)


if __name__ == "__main__":
    unittest.main()
