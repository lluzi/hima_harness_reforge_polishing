"""The worker Team's turn budgets hold the replies the real model gives (Issue #64 Track B probe).

`scripts/probe-atcs-workshops.ts` runs the Team's Researcher and Reviewer with the product model on the
retained PR03 inputs. A member turn that reaches `maxTokensPerTurn` ends `max-tokens`: the Host then
reads no completed reply and the next member never runs, so the budget is part of admission.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

PACK_DIR = Path(__file__).resolve().parents[2]
CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
SLOTS = ["01", "02", "03", "04", "05", "06"]

def _member_budget(slot, member):
    team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
    body = team.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split(f"      - id: {member}\n", 1)[1].split("\n      - id: ", 1)[0]
    return int(re.search(r"maxTokensPerTurn: (\d+)", body).group(1))


class TeamTurnBudgetTest(unittest.TestCase):
    # The #64 Track B real-model probe (PR03 inputs, atcs-worker-01 version 4): two of three Researcher
    # turns ended `max-tokens` at maxTokensPerTurn 8000 -- 8598 output tokens, 7190 of them reasoning --
    # so the Host could not read a completed reply ("no explicit completed boundary") and the Reviewer
    # never ran. The completed turn used about 6.3k. A Researcher turn is reasoning plus one JSON
    # object; its budget must hold the observed truncated turn with room to spare (about twice it).
    PROBED_TRUNCATED_TURN = 8598
    REQUIRED = 16000

    def test_the_branch_researcher_turn_budget_holds_the_probed_reply(self):
        """ADR-0016: the branch's Researcher is the fork's child Agent that authors the research Workshop
        entry (graph.yml autopilot author share); its turn is reasoning plus one JSON object too."""
        graph = (PACK_DIR / "graph.yml").read_text(encoding="utf-8")
        fork = re.search(r"\{ fork: prepare-workers, [^\n]*maxTokensPerTurn: (\d+)", graph)
        self.assertIsNotNone(fork, "the self-driving fork declares its author's turn budget")
        self.assertGreaterEqual(self.REQUIRED, self.PROBED_TRUNCATED_TURN)
        self.assertGreaterEqual(int(fork.group(1)), self.REQUIRED)



if __name__ == "__main__":
    unittest.main()
