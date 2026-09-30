"""The seat's Operator runs a point-to-point batch, and its budgets hold one (#66 D7, D9).

Attempt 4 gave each expert seat one endpoint, 20 minutes, 5000 tokens a turn and 120 mutations, and
told the Operator that "a short, clean kept log beats many marginal edits" and "the bulk belongs to
auto-finish": four of six seats produced nothing and the merged arm tied auto-finish alone. Manual ECO
as the person practises it is risk assessment and bottleneck removal: the seat owns a blocker cluster,
reads every target first, works point to point through the hardest endpoints, keeps every measured
gain, undoes every regression at once and hands over one batch. These tests read what the Operator is
told and what it is given; no XTop and no model run here.
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
PACK_DIR = TESTS_DIR.parents[1]
sys.path.insert(0, str(TESTS_DIR.parent))

from atcs import workspaces  # noqa: E402

CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
GRAPH = (PACK_DIR / "graph.yml").read_text(encoding="utf-8")
SLOTS = ["01", "02", "03", "04", "05", "06"]


def _operator(slot):
    team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
    body = team.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("\n  - id: ", 1)[0]
    member = body.split("      - id: operator\n", 1)[1]
    template = re.search(r"^        taskTemplate: '(.*)'$", member, re.M).group(1).replace("''", "'")
    return body, member, template


class BatchOperatorPromptTest(unittest.TestCase):
    def test_every_task_template_fits_the_harness_contract_bound(self):
        """The Harness pack contract bounds a taskTemplate to 8000 characters (`packs.ts` packContract,
        `taskTemplate: z.string().trim().min(1).max(8000)`); a template above it makes the whole Pack
        unloadable. The #64 T06 repairs nearly crossed it: this is the cheap falsifier."""
        team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
        templates = [match.group(1).replace("''", "'")
                     for match in re.finditer(r"^        taskTemplate: '(.*)'$", team, re.M)]
        self.assertGreaterEqual(len(templates), 12)
        for template in templates:
            self.assertLessEqual(len(template.strip()), 8000, template[:80])

    def test_the_contradicting_sentences_are_gone(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                self.assertNotIn("short, clean kept log", template)
                self.assertNotIn("bulk belongs to auto-finish", template)

    def test_the_seat_risk_assesses_every_target_before_its_first_trial(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                self.assertIn(f"Exact input workerRequest{slot}", template)
                for words in ("cluster.checks, hardest first", "Risk-assess before any change",
                              "atcs_point on every target pin", "on the hardest targets first",
                              "read atcs_fail_reasons on the target pins after your first fix"):
                    self.assertIn(words, template)
                order = [template.index(words) for words in
                         ("atcs_dump_cells before.dump", "atcs_ref once", "atcs_point on every target pin", "atcs_paths (",
                          "Then point to point, hardest target first")]
                self.assertEqual(order, sorted(order), "reference, then every point, then paths, then the trials")

    def test_each_trial_is_measured_kept_or_undone_at_once(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                for words in ("one bounded move per trial",
                              "atcs_point on the target pins, and atcs_gain for the target check and the opposite check",
                              "Keep it only if the target slack improved and the opposite check did not break; "
                              "otherwise atcs_undo at once",
                              "refused whole"):
                    self.assertIn(words, template)

    def test_the_seat_continues_through_the_cluster_and_hands_over_one_batch(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                for words in ("keep every measured gain", "Continue hardest first through the cluster",
                              "Every kept edit is part of your one batch", "never stop early to keep the log short",
                              "Stop only when the list is done", "the budget is spent", "the time is nearly spent",
                              "atcs_export_changes with limitations"):
                    self.assertIn(words, template)
                close = [template.index(words) for words in
                         ("atcs_dump_cells after.dump", "atcs_export_changes with limitations", "and atcs_close")]
                self.assertEqual(close, sorted(close))

    def test_the_template_names_every_scope_command(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                body, member, template = _operator(slot)
                commands = re.search(r"^          commands: \[(.*)\]$", member, re.M).group(1).split(", ")
                self.assertEqual(sorted(commands), sorted(workspaces.MUTATE_COMMANDS))
                self.assertEqual([c for c in commands if not re.search(rf"\b{c}\b", template)], [])

    def test_the_operator_share_and_cap_hold_a_batch(self):
        self.assertEqual(workspaces.SCOPE_MAX_MUTATIONS, 600)
        for slot in SLOTS:
            with self.subTest(slot=slot):
                body, member, _ = _operator(slot)
                self.assertIn('    version: "6"\n', body)
                self.assertIn("        budgetShare: { maxElapsedMs: 2400000, maxFollowups: 4, maxTokensPerTurn: 12000 }\n", member)
                self.assertIn("          maxMutations: 600\n", member)

    def test_the_branch_author_turn_and_the_one_generation_floor(self):
        fork = re.search(r"\{ fork: prepare-workers, revisions: 2, author: \{ maxElapsedMs: (\d+), maxFollowups: (\d+), "
                         r"maxTokensPerTurn: (\d+) \} \}", GRAPH)
        self.assertEqual(fork.groups(), ("900000", "4", "48000"))
        self.assertRegex(CONTRACT, r"\nbudget:\n(?:  [^\n]*\n)*?  minimumGenerations: 1\n")


if __name__ == "__main__":
    unittest.main()
