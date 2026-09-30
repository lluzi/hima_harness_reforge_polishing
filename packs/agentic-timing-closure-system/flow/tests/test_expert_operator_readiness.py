"""Expert Operator readiness (Issue #64 Track B): what the Operator is told matches what it can run.

The worker Team's Operator cannot read the Pack's knowledge; it runs from its `taskTemplate` in
`contract.yml`, and the plan and research Workshops read `knowledge/xtop-expert-operator.md`. Both
must name the typed procedures of the session the slot really gets -- the Tcl `prepare-workers`
renders from `flow/templates/xtop-operator.tcl` and `xtop-analysis-manual.tcl` -- and nothing else:

- every `atcs_*` procedure either text names is defined in that rendered session;
- every procedure of the session that takes the plan hash is a `mutate` command of the
  `xtop-operator` tool's `interactive.commands`, whose typed arguments end in `planSha256`, and the
  other way round;
- both texts name every interactive command, say that every mutation carries `planSha256`, and carry
  the expert loop (reference, diagnosis, candidates, trial, gain, keep or undo, budget), the hold and
  setup ladders and the fail-reason to move table.

The Operator of every slot (atcs-worker-01..06) is checked. No XTop runs here.
"""
from __future__ import annotations

import re
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import adapters  # noqa: E402
import test_xtop_toolkit as toolkit  # noqa: E402

CONTRACT = (PACK_DIR / "contract.yml").read_text(encoding="utf-8")
KNOWLEDGE = (PACK_DIR / "knowledge" / "xtop-expert-operator.md").read_text(encoding="utf-8")
SLOTS = ["01", "02", "03", "04", "05", "06"]
# The loop, in order, as the words the Operator must be given (the procedures carry the rest).
LOOP_PROCEDURES = ["atcs_ref", "atcs_paths", "atcs_candidates", "atcs_gain", "atcs_undo"]
FAIL_REASONS = ["break_setup", "break_hold", "too_large_slack", "unable_fix_by_dummy_cell",
                "sufficient_driving_strength", "no_setup_gain", "no_hold_gain", "legal_fail_no_space_on_row"]


def _operator_template(slot):
    team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
    body = team.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("      - id: operator\n", 1)[1].split("\n  - id: ", 1)[0]
    return re.search(r"^        taskTemplate: '(.*)'$", body, re.M).group(1).replace("''", "'")


def _interactive_commands():
    """`{class: [procedure]}` of the xtop-operator tool's interactive.commands."""
    return {name: toolkit._contract_class(name) for name in ("read", "mutate", "save", "close")}


def _contract_arguments(proc):
    """The ordered typed argument names of `proc` in the xtop-operator tool's interactive.arguments."""
    return [name for name, _type in toolkit._contract_arguments().get(proc, [])]


def _rendered_session():
    """The session Tcl a slot's Operator gets: the operator bootstrap and toolkit, then the manual gate."""
    with tempfile.TemporaryDirectory(prefix="atcs-readiness-") as tmp:
        root = Path(tmp)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (root / name).write_text("stub", encoding="utf-8")
        slot_root = root / "workspaces" / "w01" / "r1"
        slot_root.mkdir(parents=True)
        manifest = {"namePrefix": "atcs_w01_r1_"}
        operator = adapters.compile_xtop_operator_task(
            manifest, "top", str(root / "tech.lef"), str(root / "cells.lef"), str(root / "netlist.v"),
            str(root / "design.def"), str(slot_root), toolkit._xtop_context(root))
        manual = adapters.compile_xtop_analysis_manual_task(
            manifest, toolkit.DOMAIN, slot_root / "operator.tcl", slot_root / "ops.jsonl",
            target_pins=toolkit.TARGET_PINS, max_mutations=3)
        return operator["tcl"] + "\n" + manual["tcl"]


class ExpertOperatorReadinessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.session = _rendered_session()
        cls.procs = dict(re.findall(r"^proc (atcs_\w+) \{([^}]*)\}", cls.session, re.M))
        # The typed procedures the Operator drives: those the toolkit defines from its read section on
        # (before it are the JSON, domain, observation and mutation-core helpers, never typed commands).
        public = cls.session[cls.session.index("# ---- read procedures"):]
        cls.typed = dict(re.findall(r"^proc (atcs_\w+) \{([^}]*)\}", public, re.M))
        cls.commands = _interactive_commands()
        cls.texts = {"knowledge/xtop-expert-operator.md": KNOWLEDGE,
                     **{f"atcs-worker-{slot} operator taskTemplate": _operator_template(slot) for slot in SLOTS}}

    def test_the_contract_classes_are_read(self):
        self.assertEqual({name: len(procs) for name, procs in self.commands.items()},
                         {"read": 6, "mutate": 11, "save": 2, "close": 1})

    def test_every_procedure_the_operator_is_told_of_exists_in_the_rendered_session(self):
        for label, text in self.texts.items():
            named = sorted(set(re.findall(r"\batcs_[a-z_]+\b", text)))
            self.assertTrue(named, label)
            self.assertEqual([name for name in named if name not in self.procs], [], f"{label} names procedures the session lacks")

    def test_every_plan_hash_procedure_is_a_contract_mutation_ending_in_plan_sha256(self):
        hashed = sorted(name for name, args in self.typed.items() if args.split() and args.split()[-1] == "plan_sha256")
        self.assertEqual(hashed, sorted(self.commands["mutate"]), "mutations of the session == contract mutate commands")
        for proc in self.commands["mutate"]:
            self.assertEqual(_contract_arguments(proc)[-1:], ["planSha256"], f"{proc}'s last typed argument is planSha256")
        for cls in ("read", "save", "close"):
            for proc in self.commands[cls]:
                self.assertIn(proc, self.procs, f"{cls} command {proc} is a session procedure")
                self.assertNotIn("planSha256", _contract_arguments(proc), f"{cls} command {proc} takes no plan hash")

    def test_every_text_names_every_interactive_command_and_the_plan_hash_argument(self):
        every = sorted(sum(self.commands.values(), []))
        problems = []
        for label, text in self.texts.items():
            problems += [f"{label} does not name {proc}" for proc in every if not re.search(rf"\b{proc}\b", text)]
            if "planSha256" not in text:
                problems.append(f"{label} does not name the planSha256 argument every mutation carries")
        self.assertEqual(problems, [])

    def test_every_text_carries_the_expert_loop_ladders_and_fail_reason_moves(self):
        for label, text in self.texts.items():
            lower = text.lower()
            positions = [lower.find(proc) for proc in LOOP_PROCEDURES]
            self.assertTrue(all(position >= 0 for position in positions), f"{label} names the loop procedures")
            self.assertEqual(positions[:3], sorted(positions[:3]), f"{label}: reference, then diagnosis, then candidates")
            for word in ("trial", "keep", "undo", "budget", "hold ladder", "setup ladder"):
                self.assertTrue(word in lower, f"{label} carries {word!r}")
            self.assertEqual([reason for reason in FAIL_REASONS if reason not in text], [], f"{label} carries the fail-reason moves")



if __name__ == "__main__":
    unittest.main()
