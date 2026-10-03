"""Review 2 of the reader-problems branch (Issue #63, notes/review2-report.md): three refusals
that had no executable success path for inputs that really occur (principle 4).

- C13: a Site sizing pattern that matches at the start of the cell name (`BUF([0-9]+)`, the
  dry-path Site's) refused every resize; the function is what precedes the drive digits.
- I1: next-decision targets refused 209 of PR03's real observation keys, whose endpoints carry
  `@**async_default**`; a target that is a key of state/observation.json is admitted as written.
- I2: a w01 with no safe size_cell action had no admissible form; `actions: []` with a
  `noSafeAction` reason is admitted, and the graph routes it to decide-next instead of the Team.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_success_paths.py -v
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PACK_DIR = TESTS_DIR.parent.parent
sys.path.insert(0, str(TESTS_DIR))

import yaml  # noqa: E402

from atcs import core  # noqa: E402
from test_probe_regressions import _ProbeFixture, _fixture, _probe_reader  # noqa: E402
from test_readers import _write  # noqa: E402
from test_workshop_examples import read_atcs  # noqa: E402

REAL_ASYNC_KEY = "func_ffg_cbest_125|hold|swerv_dbg/dmcontrol_dmactive_ff_dffs_dout_reg_0_@**async_default**"
PLAIN_KEY = "func_ssg_rcworst_m40|setup|dec_tlu_perfcnt0[0]"


class SizingPatternAtNameStartTest(unittest.TestCase):
    """C13: the function is the text before the drive-strength digits (the pattern's group)."""

    def test_a_pattern_matching_at_the_start_of_the_name_gives_a_family(self):
        eco = {"cellNominalSizingPattern": "BUF([0-9]+)", "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"]}
        self.assertEqual(read_atcs._sizing_family("BUF2", eco), ("BUF", ""))
        self.assertEqual(read_atcs._sizing_family("BUF4", eco), read_atcs._sizing_family("BUF1", eco))
        self.assertEqual(read_atcs._sizing_family("BUF4LVT", eco), ("BUF", "LVT"))

    def test_the_site_pattern_keeps_function_and_vt_apart(self):
        eco = {"cellNominalSizingPattern": "D([0-9]+)BWP", "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"]}
        self.assertEqual(read_atcs._sizing_family("CKAN2D4BWP35P140HVT", eco), ("CKAN2D", "HVT"))
        self.assertEqual(read_atcs._sizing_family("CKAN2D1BWP35P140HVT", eco),
                         read_atcs._sizing_family("CKAN2D4BWP35P140HVT", eco))
        self.assertNotEqual(read_atcs._sizing_family("BUFFD4BWP35P140HVT", eco)[0],
                            read_atcs._sizing_family("CKAN2D4BWP35P140HVT", eco)[0])

    def test_a_name_the_pattern_does_not_match_has_no_family(self):
        eco = {"cellNominalSizingPattern": "BUF([0-9]+)", "cellNominalSwapKeywords": [""]}
        self.assertIsNone(read_atcs._sizing_family("INVX2", eco))


class ObservedTargetKeysTest(_ProbeFixture):
    """I1: a target copied unchanged from state/observation.json's checks is admitted."""

    def _observe(self, keys):
        checks = {key: {"slack": core.known(-0.01), "violated": True} for key in keys}
        _write(self.workspace / "state" / "observation.json", json.dumps({"checks": checks}))

    def _target_problems(self, targets):
        document = _fixture("next-decision-attempt-1.json")
        document["targets"] = targets
        found = self._read(_probe_reader(), "next-decision", "next-decision.json", document)
        return [text for text in found if text.startswith("targets[")]

    def test_an_async_default_key_of_the_observation_is_admitted(self):
        self._observe([REAL_ASYNC_KEY, PLAIN_KEY])
        self.assertEqual(self._target_problems([REAL_ASYNC_KEY, PLAIN_KEY]), [])

    def test_a_target_the_observation_does_not_hold_is_named(self):
        self._observe([REAL_ASYNC_KEY])
        found = self._target_problems([REAL_ASYNC_KEY, PLAIN_KEY, "func_ssg_rcworst_m40|setup|*"])
        self.assertEqual(len(found), 2, found)
        self.assertTrue(found[0].startswith("targets[1]"), found)
        self.assertIn("is not a check key of state/observation.json", found[0])
        self.assertTrue(found[1].startswith("targets[2]"), found)

    def test_without_an_observation_the_key_form_is_checked(self):
        self.assertEqual(self._target_problems([PLAIN_KEY]), [])
        self.assertEqual(len(self._target_problems(["func_ssg_rcworst_125"])), 1)


class NoSafeActionTest(_ProbeFixture):
    """I2: an honest "no safe action" w01 request is admitted and routed to decide-next."""

    def _request(self, **changes):
        document = copy.deepcopy(_fixture("worker-request-w01-attempt-2.json"))
        document.update(changes)
        report = self.workspace / "research" / "requests" / "worker-request-w01.json"
        found = self._read(_probe_reader(), "worker-request", "worker-request-w01.json", document, "w01")
        values = {v["type"]: v["value"] for v in _probe_reader().read("worker-request", report, self.workspace, ["w01"])}
        return found, values

    def test_empty_actions_with_a_reason_is_admitted_with_no_action(self):
        found, values = self._request(actions=[], noSafeAction="every candidate master changes the cell function")
        self.assertEqual([text for text in found if text.startswith("actions") or text.startswith("noSafeAction")], [])
        self.assertEqual(values["tc_worker_action_count"], 0)

    def test_empty_actions_without_a_reason_is_still_refused(self):
        found, values = self._request(actions=[])
        self.assertTrue(any(text.startswith("actions (slot w01)") and "noSafeAction" in text for text in found), found)
        self.assertEqual(values["tc_worker_action_count"], 0)

    def test_a_reason_beside_actions_is_refused(self):
        document = _fixture("worker-request-w01-attempt-1.json")
        found, values = self._request(actions=document["actions"], noSafeAction="none is safe")
        self.assertTrue(any(text.startswith("noSafeAction (slot w01)") for text in found), found)
        self.assertEqual(values["tc_worker_action_count"], len(document["actions"]))

    def test_the_graph_routes_no_action_to_decide_next_and_malformed_to_the_retry(self):
        graph = yaml.safe_load((PACK_DIR / "graph.yml").read_text(encoding="utf-8"))
        edges = {(e["from"], e.get("outcome"), e["to"]) for e in graph["edges"]}
        node = next(n for n in graph["nodes"] if n["id"] == "route-worker-action-01")
        self.assertEqual(node["kind"], "judge")
        self.assertEqual(node["parameters"]["rules"], ["worker-action-proposed"])
        self.assertIn(("check-worker-request-01", "FAIL", "retry-worker-01"), edges)
        self.assertIn(("check-worker-request-01", "PASS", "route-worker-action-01"), edges)
        self.assertIn(("route-worker-action-01", "PASS", "operate-worker-01"), edges)
        self.assertIn(("route-worker-action-01", "FAIL", "decide-next"), edges)
        self.assertNotIn(("check-worker-request-01", "PASS", "operate-worker-01"), edges)
        rule = yaml.safe_load((PACK_DIR / "rules" / "worker-action-proposed.yml").read_text(encoding="utf-8"))
        self.assertEqual(rule["subject"]["type"], "tc_worker_action_count")
        self.assertEqual((rule["predicate"]["op"], rule["predicate"]["threshold"]), ("gt", 0))

    def test_the_purpose_says_how_to_write_no_safe_action(self):
        contract = yaml.safe_load((PACK_DIR / "contract.yml").read_text(encoding="utf-8"))
        purpose = " ".join(next(w for w in contract["workshops"] if w["id"] == "research-worker-01")["purpose"].split())
        self.assertIn('write "actions": [] and a top-level "noSafeAction"', purpose)
        self.assertNotIn("exit non-zero", purpose)
        decider = next(w for w in contract["workshops"] if w["id"] == "evaluate-next-investment")
        self.assertIn("workerRequest01", decider["reads"])


if __name__ == "__main__":
    unittest.main()
