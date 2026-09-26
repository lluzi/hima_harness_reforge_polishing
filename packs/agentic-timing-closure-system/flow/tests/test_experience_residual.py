"""Tests for `atcs.experience` (M8 experience ledger) and `atcs.residual`
(Residual Case extraction).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_experience_residual.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import experience  # noqa: E402
from atcs import residual  # noqa: E402


def _lineage(decision_id, stage="postroute", scenario="func_ssg_rcworst_m40",
             precision="gba", tool_version="innovus-21.1"):
    return {
        "decisionId": decision_id,
        "conditions": {
            "stage": stage,
            "scenario": scenario,
            "precision": precision,
            "toolVersion": tool_version,
        },
    }


class ExperienceRecordTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "experience.json"

    def test_record_creates_ledger_and_stores_predicted_and_measured_distinctly(self):
        decision = {
            "hypothesis": "upsizing U_DRV reduces net delay on the dominant path",
            "action": "size_cell",
            "predicted": core.known(0.03),
        }
        outcome = {"measured": core.known(0.01)}

        exp = experience.record(self.path, _lineage("d1"), decision, outcome)

        self.assertEqual(exp["schema"], "atcs.experience/1")
        self.assertTrue(self.path.exists())
        entry = exp["entries"][0]
        self.assertEqual(entry["decisionId"], "d1")
        self.assertEqual(entry["hypothesis"], decision["hypothesis"])
        self.assertEqual(entry["action"], "size_cell")
        self.assertEqual(entry["predicted"], core.known(0.03))
        self.assertEqual(entry["measured"], core.known(0.01))
        # The pair is preserved distinctly -- never averaged or collapsed --
        # so a later Chooser can read the prediction/measurement difference.
        self.assertNotEqual(entry["predicted"], entry["measured"])

    def test_record_appends_a_second_entry_without_disturbing_the_first(self):
        decision = {"hypothesis": "h1", "action": "size_cell", "predicted": core.known(0.02)}
        outcome = {"measured": core.known(0.02)}
        experience.record(self.path, _lineage("d1"), decision, outcome)

        decision2 = {"hypothesis": "h2", "action": "insert_buffer", "predicted": core.known(-0.01)}
        outcome2 = {"measured": core.known(-0.02)}
        exp = experience.record(self.path, _lineage("d2"), decision2, outcome2)

        self.assertEqual(len(exp["entries"]), 2)
        ids = {entry["decisionId"] for entry in exp["entries"]}
        self.assertEqual(ids, {"d1", "d2"})

    def test_rewriting_an_existing_entry_raises_immutable_entry(self):
        decision = {"hypothesis": "h", "action": "size_cell", "predicted": core.known(0.02)}
        outcome = {"measured": core.known(0.02)}
        experience.record(self.path, _lineage("dup"), decision, outcome)

        with self.assertRaises(core.AtcsError) as ctx:
            experience.record(self.path, _lineage("dup"), decision, outcome)
        self.assertEqual(ctx.exception.code, "immutable-entry")

        # And the original entry must still be exactly as first recorded.
        exp = core.read_artifact(self.path, "experience")
        self.assertEqual(len(exp["entries"]), 1)

    def test_verdict_helped_hurt_neutral_unknown(self):
        cases = [
            ("d-helped", core.known(0.02), core.known(0.05), "helped"),
            ("d-hurt", core.known(0.02), core.known(-0.01), "hurt"),
            ("d-neutral", core.known(0.02), core.known(0.0), "neutral"),
            ("d-unknown-predicted", core.unknown("no forecast"), core.known(0.05), "unknown"),
            ("d-unknown-measured", core.known(0.02), core.unknown("not remeasured"), "unknown"),
        ]
        for decision_id, predicted, measured, expected_verdict in cases:
            with self.subTest(decision_id=decision_id):
                decision = {"hypothesis": "h", "action": "size_cell", "predicted": predicted}
                outcome = {"measured": measured}
                exp = experience.record(self.path, _lineage(decision_id), decision, outcome)
                entry = next(e for e in exp["entries"] if e["decisionId"] == decision_id)
                self.assertEqual(entry["verdict"], expected_verdict)


class ExperienceApplicableTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "experience.json"

    def _query(self, **overrides):
        base = {
            "stage": "postroute",
            "scenario": "func_ssg_rcworst_m40",
            "precision": "gba",
            "toolVersion": "innovus-21.1",
        }
        base.update(overrides)
        return base

    def test_entry_recorded_under_gba_is_not_returned_for_a_pba_query(self):
        decision = {"hypothesis": "h", "action": "insert_buffer", "predicted": core.known(0.01)}
        outcome = {"measured": core.unknown("not yet measured")}
        exp = experience.record(self.path, _lineage("gba-entry", precision="gba"), decision, outcome)

        pba_matches = experience.applicable(exp, self._query(precision="pba"))
        self.assertEqual(pba_matches, [])

        gba_matches = experience.applicable(exp, self._query(precision="gba"))
        self.assertEqual(len(gba_matches), 1)
        self.assertEqual(gba_matches[0]["decisionId"], "gba-entry")

    def test_exact_match_required_on_stage_and_tool_version(self):
        decision = {"hypothesis": "h", "action": "size_cell", "predicted": core.known(0.01)}
        outcome = {"measured": core.known(0.01)}
        exp = experience.record(self.path, _lineage("entry"), decision, outcome)

        self.assertEqual(experience.applicable(exp, self._query(stage="route")), [])
        self.assertEqual(experience.applicable(exp, self._query(toolVersion="innovus-22.1")), [])
        self.assertEqual(len(experience.applicable(exp, self._query())), 1)

    def test_scenario_wildcard_entry_matches_any_query_scenario(self):
        decision = {"hypothesis": "h", "action": "size_cell", "predicted": core.known(0.01)}
        outcome = {"measured": core.known(0.01)}
        exp = experience.record(self.path, _lineage("wild", scenario="*"), decision, outcome)

        matches = experience.applicable(exp, self._query(scenario="func_ffg_cbest_125"))
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["decisionId"], "wild")


def _observation(precision, checks, check_details=None):
    body = {
        "designStateId": "ds1",
        "precision": precision,
        "scenarios": {},
        "checks": checks,
        "missingScenarios": [],
        "coverage": {"complete": True, "reasons": []},
        "sources": [],
    }
    if check_details is not None:
        body["checkDetails"] = check_details
    return body


def _evaluation(remaining):
    return {
        "candidateId": "cand1",
        "comparison": {
            "fixed": [],
            "remaining": remaining,
            "entrant": [],
            "regressed": [],
            "missingPrior": [],
        },
    }


def _readiness(scope, lifecycle_missing=None):
    return {
        "missing": [],
        "missingCount": core.known(0),
        "lifecycleAvailable": core.known(1) if scope == "full-flow" else core.known(0),
        "lifecycleMissing": lifecycle_missing or [],
        "scope": scope,
    }


EMPTY_EXPERIENCE = {"entries": []}


class ResidualExtractTest(unittest.TestCase):
    def test_check_with_only_unknown_slack_produces_no_residual(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "reg/q")
        observation = _observation("gba", {
            key: {"slack": core.unknown("path report truncated"), "startpoint": "U0/CK", "pathGroup": "core_clock"},
        })
        evaluation = _evaluation([key])
        readiness = _readiness("full-flow")

        cases = residual.extract(evaluation, observation, EMPTY_EXPERIENCE, readiness)
        self.assertEqual(cases, [])

    def test_check_dominated_by_net_delay_with_high_fanout_sets_evidence_fields(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "reg/d")
        detail = {
            "cellDelay": core.known(0.05),
            "netDelay": core.known(0.42),
            "slew": core.known(0.09),
            "fanout": core.known(12),
            "location": core.known({"instance": "U_DRV", "x": 120.5, "y": 88.0}),
        }
        observation = _observation(
            "pba",
            {key: {"slack": core.known(-0.11), "startpoint": "U0/CK", "pathGroup": "core_clock"}},
            check_details={key: detail},
        )
        evaluation = _evaluation([key])
        readiness = _readiness("full-flow")

        cases = residual.extract(evaluation, observation, EMPTY_EXPERIENCE, readiness)

        self.assertEqual(len(cases), 1)
        case = cases[0]
        self.assertEqual(case["schema"], "atcs.residual-case/1")
        self.assertEqual(case["checks"], [key])
        self.assertEqual(case["evidence"], detail)
        self.assertEqual(case["limits"], [])
        # Net delay clearly dominates cell delay: a routing/detour mechanism.
        self.assertEqual(case["suggestedStage"], "route")

    def test_suggested_stage_is_null_under_post_route_only_and_names_lifecycle_gaps(self):
        key = core.check_key("func_ffg_cbest_m40", "hold", "reg/q")
        observation = _observation(
            "gba",
            {key: {"slack": core.known(-0.02), "startpoint": "U1/CK", "pathGroup": "core_clock"}},
        )
        evaluation = _evaluation([key])
        readiness = _readiness("post-route-only", lifecycle_missing=["cts checkpoint missing", "flowConfig missing"])

        cases = residual.extract(evaluation, observation, EMPTY_EXPERIENCE, readiness)

        self.assertEqual(len(cases), 1)
        case = cases[0]
        self.assertIsNone(case["suggestedStage"])
        self.assertEqual(case["requiredInputs"], ["cts checkpoint missing", "flowConfig missing"])

    def test_suggested_stage_falls_back_to_postroute_without_a_net_delay_dominant_signal(self):
        key = core.check_key("func_ssg_rcworst_125", "setup", "reg/q")
        detail = {
            "cellDelay": core.known(0.20),
            "netDelay": core.known(0.05),
            "slew": core.unknown(residual.NO_DETAIL_REASON),
            "fanout": core.unknown(residual.NO_DETAIL_REASON),
            "location": core.unknown(residual.NO_DETAIL_REASON),
        }
        observation = _observation(
            "gba",
            {key: {"slack": core.known(-0.03), "startpoint": "U2/CK", "pathGroup": "core_clock"}},
            check_details={key: {"cellDelay": detail["cellDelay"], "netDelay": detail["netDelay"]}},
        )
        evaluation = _evaluation([key])
        readiness = _readiness("full-flow")

        cases = residual.extract(evaluation, observation, EMPTY_EXPERIENCE, readiness)

        self.assertEqual(len(cases), 1)
        case = cases[0]
        self.assertEqual(case["suggestedStage"], "postroute")
        self.assertEqual(case["requiredInputs"], [])
        self.assertEqual(case["evidence"]["slew"], core.unknown(residual.NO_DETAIL_REASON))
        self.assertIn("slew unknown: no path detail observed", case["limits"])
        self.assertIn("fanout unknown: no path detail observed", case["limits"])
        self.assertIn("location unknown: no path detail observed", case["limits"])

    def test_missing_check_details_entirely_yields_all_unknown_evidence(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "reg/x")
        observation = _observation(
            "gba",
            {key: {"slack": core.known(-0.05), "startpoint": "U3/CK", "pathGroup": "core_clock"}},
        )
        evaluation = _evaluation([key])
        readiness = _readiness("full-flow")

        cases = residual.extract(evaluation, observation, EMPTY_EXPERIENCE, readiness)

        self.assertEqual(len(cases), 1)
        case = cases[0]
        for field in residual.EVIDENCE_FIELDS:
            self.assertEqual(case["evidence"][field], core.unknown(residual.NO_DETAIL_REASON))
        self.assertEqual(len(case["limits"]), len(residual.EVIDENCE_FIELDS))
        self.assertEqual(case["suggestedStage"], "postroute")

    def test_fixed_and_entrant_checks_produce_no_residual(self):
        remaining_key = core.check_key("func_ssg_rcworst_m40", "setup", "reg/q")
        observation = _observation(
            "gba",
            {remaining_key: {"slack": core.known(-0.05), "startpoint": "U4/CK", "pathGroup": "core_clock"}},
        )
        # `comparison.remaining` is empty: this candidate's fixed/entrant
        # checks (not modeled here) must never surface as residual cases.
        evaluation = _evaluation([])
        readiness = _readiness("full-flow")

        cases = residual.extract(evaluation, observation, EMPTY_EXPERIENCE, readiness)
        self.assertEqual(cases, [])

    def test_attempts_lists_decision_ids_of_matching_prior_experience(self):
        key = core.check_key("func_ssg_rcworst_m40", "setup", "reg/q")
        observation = _observation(
            "gba",
            {key: {"slack": core.known(-0.05), "startpoint": "U5/CK", "pathGroup": "core_clock"}},
        )
        evaluation = _evaluation([key])
        readiness = _readiness("full-flow")

        exp = {
            "entries": [
                {
                    "decisionId": "tried-1",
                    "conditions": {
                        "stage": "postroute", "scenario": "func_ssg_rcworst_m40",
                        "precision": "gba", "toolVersion": "innovus-21.1",
                    },
                    "hypothesis": "h", "action": "size_cell",
                    "predicted": core.known(0.02), "measured": core.known(-0.01), "verdict": "hurt",
                },
                {
                    "decisionId": "other-precision",
                    "conditions": {
                        "stage": "postroute", "scenario": "func_ssg_rcworst_m40",
                        "precision": "pba", "toolVersion": "innovus-21.1",
                    },
                    "hypothesis": "h", "action": "size_cell",
                    "predicted": core.known(0.02), "measured": core.known(0.01), "verdict": "helped",
                },
                {
                    "decisionId": "other-scenario",
                    "conditions": {
                        "stage": "postroute", "scenario": "func_ffg_cbest_125",
                        "precision": "gba", "toolVersion": "innovus-21.1",
                    },
                    "hypothesis": "h", "action": "size_cell",
                    "predicted": core.known(0.02), "measured": core.known(0.01), "verdict": "helped",
                },
            ]
        }

        cases = residual.extract(evaluation, observation, exp, readiness)
        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0]["attempts"], ["tried-1"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
