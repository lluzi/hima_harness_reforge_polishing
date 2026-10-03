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
import yaml

TESTS_DIR = Path(__file__).resolve().parent
PACK_DIR = TESTS_DIR.parents[1]
sys.path.insert(0, str(TESTS_DIR.parent))

from atcs import workspaces  # noqa: E402

CONTRACT = (PACK_DIR / "legacy/0.2.10/contract.yml").read_text(encoding="utf-8")
CONTRACT_DATA = yaml.safe_load(CONTRACT)
GRAPH = (PACK_DIR / "legacy/0.2.10/graph.yml").read_text(encoding="utf-8")
SLOTS = ["01", "02", "03", "04", "05", "06"]


def _operator(slot):
    team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
    body = team.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("\n  - id: ", 1)[0]
    member = body.split("      - id: operator\n", 1)[1]
    declared = next(team for team in CONTRACT_DATA["agentTeams"] if team["id"] == f"atcs-worker-{slot}")
    template = next(item for item in declared["members"] if item["id"] == "operator")["taskTemplate"]
    return body, member, template


class BatchOperatorPromptTest(unittest.TestCase):
    def test_every_task_template_fits_the_harness_contract_bound(self):
        """The Harness pack contract bounds a taskTemplate to 8000 characters (`packs.ts` packContract,
        `taskTemplate: z.string().trim().min(1).max(8000)`); a template above it makes the whole Pack
        unloadable. The #64 T06 repairs nearly crossed it: this is the cheap falsifier."""
        team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
        templates = [member["taskTemplate"] for team in CONTRACT_DATA["agentTeams"] for member in team["members"]]
        self.assertGreaterEqual(len(templates), 12)
        for template in templates:
            self.assertLessEqual(len(template.strip()), 8000, template[:80])
        for slot in SLOTS:
            self.assertLess(len(_operator(slot)[2]), 3500, "the Operator contract stays readable in one view")

    def test_the_contradicting_sentences_are_gone(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                self.assertNotIn("short, clean kept log", template)
                self.assertNotIn("bulk belongs to auto-finish", template)

    def test_the_seat_has_one_identity_and_an_evidence_led_goal(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                for words in (f"w{slot}'s DeepSeek timing specialist", "Owner's tool hand", "actual unique cluster",
                              "no raw shell or source search", "root-cause hypothesis"):
                    self.assertIn(words, template)

    def test_each_trial_is_measured_kept_or_undone_at_once(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                for words in ("HOLD WNS first", "coherent", "keep or undo", "next distinct mechanism/range", "standalone expert evidence"):
                    self.assertIn(words, template)
                self.assertNotIn("refused whole", template)

    def test_the_seat_continues_through_the_cluster_and_hands_over_one_batch(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                template = _operator(slot)[2]
                for words in ("One operation or undo is not completion", "actual Host budget remains",
                              "evidenced exhaustion", "after.dump", "current export", "typed atcs_close"):
                    self.assertIn(words, template)

    def test_the_template_names_every_scope_command(self):
        for slot in SLOTS:
            with self.subTest(slot=slot):
                body, member, template = _operator(slot)
                commands = re.search(r"^          commands: \[(.*)\]$", member, re.M).group(1).split(", ")
                self.assertEqual(sorted(commands), sorted(workspaces.MUTATE_COMMANDS))
                self.assertIn("typed interactive commands", template)
                self.assertLess(sum(template.count(c) for c in commands), len(commands),
                                "the task does not duplicate the Host's exact typed-command catalog")

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

    def test_worker_author_purposes_fit_the_host_projection_and_front_load_the_runnable_contract(self):
        for slot in SLOTS:
            workshop = next(item for item in CONTRACT_DATA["workshops"] if item["id"] == f"research-worker-{slot}")
            purpose = workshop["purpose"]
            self.assertLessEqual(len(purpose), 3200, "the Host projects the complete purpose without truncation")
            self.assertLess(purpose.index("sys.argv[1]"), purpose.index("On a revision only"))
            self.assertIn(f'research/requests/worker-request-w{slot}.json', purpose)
            self.assertIn("On the first attempt there is no Problems file", purpose)
            self.assertIn("Never guess source paths", purpose)


if __name__ == "__main__":
    unittest.main()
