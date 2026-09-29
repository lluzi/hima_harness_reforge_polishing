"""The physical-refresh budget: a reader-backed count a Judge caps by the Run's Goal value
`max_physical_refreshes` (Issue #63 slice 2, ported to Pack 0.2.0 for Issue #64 Track B).

Live Ledger (Pack 0.2.0, live02): two `revisit-research` Explore decisions each consumed one
Harness generation although no Innovus/StarRC/PrimeTime refresh ran, so `generationLimit`
bounds revisits, not physical refreshes. On this Pack the default cap is 2, the two full
refreshes the #64 comparison is run with. `atcs.refresh` already counts completed refreshes
in `state/refresh-ledger.json`, but nothing capped that count.

This module pins the Pack side of the cap:

- the `refresh-budget` Reader kind emits `tc_refreshes_completed`: `known(0)` for a prepared
  Campaign whose ledger does not exist yet (the first refresh must never be blocked by an
  `unknown`), `known(n)` for an identity-verified ledger of `n` entries, and `unknown` for
  a corrupt/tampered ledger or a ledger missing while an STA receipt or its
  `implementations/<mergeId>/sta.json` archive proves a refresh ran;
- the Reader's fixed paths are the ones `atcs_cli.py` actually writes;
- the declarations (reader file, semantics, rule, Goal value, graph gates) agree, and the cap
  is a Goal value -- fixed when the Run is created -- never a Strategy knob an owner's
  next-strategy decision or a revision could change.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_refresh_budget.py -v
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(TESTS_DIR))
sys.path.insert(0, str(FLOW_DIR))

from test_readers import READ_ATCS_PATH, _build_design_state, _make_workspace, _write, read_atcs  # noqa: E402

from atcs import core  # noqa: E402
from atcs import refresh  # noqa: E402

FACT = "tc_refreshes_completed"
SCENARIOS = ("slow_setup", "fast_hold")


def _sources(tag):
    return {
        scenario: {"path": f"implementations/{tag}/sta/{scenario}.rpt", "sha256": f"{i + 1:064x}"}
        for i, scenario in enumerate(SCENARIOS)
    }


class RefreshBudgetReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workspace = _make_workspace(self.tmp.name)
        # A prepared Campaign: `baseline` has seeded the working state the reader is anchored on.
        self.report = self.workspace / "state" / "working-state.json"
        core.write_artifact(self.report, _build_design_state(self.workspace))
        self.ledger = self.workspace / "state" / "refresh-ledger.json"

    def _read(self):
        values = read_atcs.read("refresh-budget", self.report, self.workspace)
        self.assertEqual([v["type"] for v in values], [FACT])
        self.assertEqual(values[0]["unit"], "count")
        return values[0]

    def test_prepared_workspace_without_a_ledger_is_known_zero(self):
        self.assertFalse(self.ledger.exists())
        self.assertEqual(self._read(), {"type": FACT, "unit": "count", "value": 0})

    def test_one_recorded_refresh_is_known_one(self):
        refresh.record_refresh(self.ledger, "mc-1", "state-1", _sources("mc-1"), SCENARIOS)
        self.assertEqual(self._read()["value"], 1)

    def test_idempotent_resubmission_still_counts_one(self):
        refresh.record_refresh(self.ledger, "mc-1", "state-1", _sources("mc-1"), SCENARIOS)
        refresh.record_refresh(self.ledger, "mc-1", "state-1", _sources("mc-1"), SCENARIOS)
        refresh.record_refresh(self.ledger, "mc-2", "state-2", _sources("mc-2"), SCENARIOS)
        self.assertEqual(self._read()["value"], 2)

    def test_corrupt_ledger_is_unknown(self):
        _write(self.ledger, "{not json")
        value = self._read()
        self.assertIsNone(value["value"])
        self.assertIn("refresh ledger", value["unknownReason"])

    def test_tampered_ledger_identity_is_unknown(self):
        stamped = refresh.record_refresh(self.ledger, "mc-1", "state-1", _sources("mc-1"), SCENARIOS)
        tampered = dict(stamped)
        tampered["entries"] = []  # a hand-edited ledger claiming no refresh ran
        _write(self.ledger, json.dumps(tampered))
        value = self._read()
        self.assertIsNone(value["value"])
        self.assertTrue(value["unknownReason"])

    def test_malformed_entries_are_unknown(self):
        core.write_artifact(self.ledger, core.stamp("refresh-ledger", {"entries": [{"mergeCommitId": ""}]}))
        self.assertIsNone(self._read()["value"])

    def test_missing_ledger_beside_an_sta_receipt_is_unknown_not_zero(self):
        # `sta` records the ledger entry before it writes state/sta.json, so an STA receipt
        # without a ledger means the ledger was lost, never that no refresh completed.
        _write(self.workspace / "state" / "sta.json", "{}")
        value = self._read()
        self.assertIsNone(value["value"])
        self.assertIn("sta.json", value["unknownReason"])

    def test_missing_ledger_beside_an_archived_sta_receipt_is_unknown_not_zero(self):
        # Review C-4: state/sta.json lost too, but the per-implementation archive of the same
        # receipt survives -- still proof that a refresh completed.
        _write(self.workspace / "implementations" / "mc-1" / "sta.json", "{}")
        value = self._read()
        self.assertIsNone(value["value"])
        self.assertIn("implementations/mc-1/sta.json", value["unknownReason"])

    def test_implementation_without_an_sta_archive_is_still_known_zero(self):
        # `implement` writes under implementations/<mergeId>/ before any refresh completes.
        _write(self.workspace / "implementations" / "mc-1" / "merge-commit.json", "{}")
        self.assertEqual(self._read()["value"], 0)

    def test_symlinked_ledger_is_unknown(self):
        real = self.workspace / "elsewhere.json"
        refresh.record_refresh(real, "mc-1", "state-1", _sources("mc-1"), SCENARIOS)
        self.ledger.symlink_to(real)
        self.assertIsNone(self._read()["value"])

    def test_anchor_that_is_not_a_design_state_is_refused(self):
        core.write_artifact(self.report, core.stamp("refresh-ledger", {"entries": []}))
        with self.assertRaises(ValueError):
            read_atcs.read("refresh-budget", self.report, self.workspace)

    def test_process_level_reading_writes_the_declared_document(self):
        out = self.workspace / "hima-readers" / "out.json"
        out.parent.mkdir(parents=True)
        done = subprocess.run(
            [sys.executable, str(READ_ATCS_PATH), "refresh-budget", str(self.report), str(out), str(self.workspace)],
            capture_output=True, text=True,
        )
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(out.read_text()), {"values": [{"type": FACT, "unit": "count", "value": 0}]})

    def test_fixed_paths_are_the_ones_the_cli_writes(self):
        spec = importlib.util.spec_from_file_location("atcs_cli_for_budget", FLOW_DIR / "atcs_cli.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        root = Path("/campaign")
        paths = cli._paths(root)
        self.assertEqual(read_atcs._REFRESH_LEDGER_REL, str(paths["refresh_ledger"].relative_to(root)))
        self.assertEqual(read_atcs._STA_RECEIPT_REL, str(paths["sta"].relative_to(root)))
        self.assertEqual("state/working-state.json", str(paths["working_state"].relative_to(root)))


class RefreshBudgetDeclarationTest(unittest.TestCase):
    """The declarations the Harness reads agree with the Reader (stdlib-only text checks;
    the TypeScript contract test additionally runs `loadPack`/`checkPack`)."""

    def test_reader_file_emits_exactly_the_fact(self):
        text = (PACK_DIR / "readers" / "atcs-refresh-budget.yml").read_text(encoding="utf-8")
        self.assertIn("'refresh-budget'", text)
        self.assertEqual(re.findall(r"^  - (\S+)$", text, re.M), [FACT])

    def test_semantics_declares_the_fact_in_count(self):
        text = (PACK_DIR / "semantics.yml").read_text(encoding="utf-8")
        match = re.search(rf"^  {FACT}:\n    unit: (\S+)$", text, re.M)
        self.assertIsNotNone(match)
        self.assertEqual(match.group(1), "count")

    def test_working_state_output_is_read_by_the_budget_reader(self):
        text = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        block = re.search(r"  - name: workingState\n    path: (\S+)\n    reader: (\S+)\n", text)
        self.assertIsNotNone(block, "workingState declares the refresh-budget reader")
        self.assertEqual(block.groups(), ("state/working-state.json", "atcs-refresh-budget"))

    def test_rule_caps_the_fact_below_the_bound_limit(self):
        text = (PACK_DIR / "rules" / "refresh-budget.yml").read_text(encoding="utf-8")
        self.assertIn("parameter: { name: max_physical_refreshes, unit: count }", text)
        self.assertIn(f"subject: {{ type: {FACT} }}", text)
        self.assertRegex(text, r"op: lt\n\s+threshold: \{ parameter: max_physical_refreshes \}\n\s+unit: count")

    def test_cap_is_a_goal_value_with_a_label_and_no_strategy_knob(self):
        text = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
        goal = re.search(r"^goal:\n(.*?)(?=^\S)", text, re.S | re.M).group(1)
        strategy = re.search(r"^strategy:\n(.*?)(?=^\S)", text, re.S | re.M).group(1)
        words = re.search(r"^words:\n(.*?)(?=^\S)", text, re.S | re.M).group(1)
        self.assertIn(
            "  max_physical_refreshes: { type: number, unit: count, min: 1, max: 4, default: 2, precision: 0 }\n", goal)
        self.assertRegex(words, r"\n  max_physical_refreshes: \{ label: [^,]+, unit: count \}")
        self.assertNotIn("refresh", strategy.lower())
        self.assertNotIn("refreshLimit", text)

    def test_both_budget_judges_bind_the_cap_from_goal(self):
        text = (PACK_DIR / "graph.yml").read_text(encoding="utf-8")
        binds = re.findall(
            r"^  - id: (check-refresh-budget\S*)\n    kind: judge\n    parameters:\n      rules: \[refresh-budget\]\n      bind: (.*)$",
            text, re.M)
        self.assertEqual(sorted(binds), [
            ("check-refresh-budget", "{ max_physical_refreshes: { from: goal, name: max_physical_refreshes } }"),
            ("check-refresh-budget-apr", "{ max_physical_refreshes: { from: goal, name: max_physical_refreshes } }"),
        ])


if __name__ == "__main__":
    unittest.main()
