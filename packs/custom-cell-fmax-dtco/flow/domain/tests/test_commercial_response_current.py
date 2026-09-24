"""A later failed comparison cannot promote a prior generation's feedback."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


FLOW = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FLOW))
import stages  # noqa: E402


class CurrentCommercialResponseTests(unittest.TestCase):
    def test_failed_next_comparison_preserves_history_but_revokes_current_feedback(self):
        with tempfile.TemporaryDirectory(prefix="lfr-commercial-current-") as folder:
            workspace = Path(folder)
            flow = workspace / "flow"
            flow.mkdir()
            manifest = flow / "library" / "cumulative-manifest.json"
            manifest.parent.mkdir()
            baseline = flow / "foundry.lib"
            baseline.write_text("synthetic baseline Library\n")
            original_manifest = stages.empty_cumulative_manifest({
                "source": str(baseline), "bytes": baseline.stat().st_size,
                "sha256": stages.sha_file(baseline),
            })
            manifest.write_text(json.dumps(original_manifest) + "\n")
            inputs = flow / "inputs.json"
            inputs.write_text(json.dumps({"evidenceClass": "synthetic-fixture",
                                          "LFR_CUMULATIVE_LIBRARY_MANIFEST": str(manifest)}) + "\n")
            reference = {"schema": "hima.innovus-timing-facts/1", "completeness": "complete",
                         "endpoint_alternatives": [{"endpoint": "E0", "worst_slack_ns": -0.1}]}
            generated = {"schema": "hima.innovus-timing-facts/1", "completeness": "complete",
                         "endpoint_alternatives": [{"endpoint": "E0", "worst_slack_ns": 0.0}]}
            response = stages.compare_v5_frontiers(
                reference, generated,
                {"q_target_ns": 1.0, "period_ns": 1.0},
                {"q_target_ns": 1.0, "q_target_source": "frozen-baseline-target"})
            first = stages.Context("compare", workspace)
            observations = {"matched_conditions": True,
                            "analysisViews": {"foundry": "slow", "generated": "slow"},
                            "v5_frontier_response_sha256": response["response_sha256"]}
            comparison = first.run_dir / "comparison.json"
            stages.atomic_json(comparison, observations)
            first.add_artifact(comparison, "comparison", "derived-from-held-postroute-evidence")
            stages.publish_commercial_response(first, comparison, observations, response, [])
            scenario = flow / "scenario.rpt"
            scenario.write_text("slow corner\n")
            first.inputs.append(stages.file_ref(scenario, workspace, "scenario", "comparison-input"))
            first.facts.update(observations)
            first.write("passed")
            historical = first.run_dir / "frontier-response.json"
            persistent = flow / "library-richness" / "commercial-response.json"
            self.assertEqual(response, stages.current_commercial_response(first, manifest))
            scenario.write_text("fast corner\n")
            self.assertIsNone(stages.current_commercial_response(first, manifest))
            scenario.write_text("slow corner\n")

            # Changed Campaign inputs make the old pointer stale even before another compare.
            changed = json.loads(inputs.read_text())
            changed["designTop"] = "different-input"
            inputs.write_text(json.dumps(changed) + "\n")
            self.assertIsNone(stages.current_commercial_response(first, manifest))
            inputs.write_text(json.dumps({"evidenceClass": "synthetic-fixture",
                                          "LFR_CUMULATIVE_LIBRARY_MANIFEST": str(manifest)}) + "\n")
            manifest.write_text('{"changed": true}\n')
            self.assertIsNone(stages.current_commercial_response(first, manifest))
            manifest.write_text(json.dumps(original_manifest) + "\n")

            # G2 compare cannot find its required G2 stage evidence. It records an
            # unavailable current pointer while leaving G1 bytes available for audit.
            second = stages.Context("compare", workspace)
            stages.stage_compare(second)
            second.write("passed")
            self.assertTrue(historical.is_file())
            self.assertEqual(response, stages.read_json(historical))
            self.assertEqual(response, stages.read_json(persistent))
            marker = stages.read_json(flow / "library-richness" / "commercial-response-current.json")
            self.assertEqual(marker["status"], "unavailable")
            self.assertIsNone(stages.current_commercial_response(second, manifest))


if __name__ == "__main__":
    unittest.main()
