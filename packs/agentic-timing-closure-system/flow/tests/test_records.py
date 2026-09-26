"""Structural checks on the Pack's authoring records: INTENT.md and SPEC.md.

These records are prose, not code, but the next stage that compiles them (and the
tasks that follow Task 1) rely on an exact, ordered set of level-2 (`## `) headings
and on SPEC.md actually naming every value and rule id it commits to. This test
holds both files to that contract; it does not evaluate the quality of the prose.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_records.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[2]
INTENT_PATH = PACK_ROOT / "INTENT.md"
SPEC_PATH = PACK_ROOT / "SPEC.md"

INTENT_HEADINGS = [
    "Business",
    "Golden Flow",
    "Answers",
    "Ambiguities resolved",
    "Knowledge applied",
]

SPEC_HEADINGS = [
    "Goal template",
    "Constraints",
    "Run contract",
    "Semantics",
    "Judge rules",
    "Choosers",
    "Endings",
    "Workshops",
    "Knowledge",
]

# Every tc_* value name SPEC.md's Semantics chapter must name, including the two
# added by Task 1's compile decision (tc_next_action, tc_selected_contribution_count).
SPEC_VALUE_NAMES = [
    "tc_required_input_missing_count",
    "tc_lifecycle_available",
    "tc_request_invalid_count",
    "tc_pending_research_count",
    "tc_ready_contribution_count",
    "tc_replay_mismatch_count",
    "tc_unresolved_conflict_count",
    "tc_out_of_scope_edit_count",
    "tc_unqualified_rc_net_count",
    "tc_xtop_setup_wns_ns",
    "tc_xtop_hold_wns_ns",
    "tc_presta_setup_wns_ns",
    "tc_presta_hold_wns_ns",
    "tc_final_setup_wns_ns",
    "tc_final_hold_wns_ns",
    "tc_missing_required_check_count",
    "tc_final_identity_error_count",
    "tc_applicable_constraint_failure_count",
    "tc_applicable_constraint_unknown_count",
    "tc_fixed_check_count",
    "tc_missing_prior_check_count",
    "tc_refresh_count",
    "tc_accepted_artifact_ready",
    "tc_stop_required",
    "tc_next_action",
    "tc_selected_contribution_count",
]

# The eleven base Judge rule ids plus the six single-predicate split-part ids that
# the three compound rules (replay-consistent, final-evidence-ready,
# required-constraints-pass) compile down to.
SPEC_RULE_IDS = [
    "inputs-ready",
    "request-admissible",
    "replay-consistent",
    "composition-ready",
    "presta-model-qualified",
    "final-evidence-ready",
    "required-constraints-pass",
    "setup-goal",
    "hold-goal",
    "artifact-ready",
    "continue-or-wait",
    "replay-consistent-mismatch",
    "replay-consistent-scope",
    "final-evidence-ready-coverage",
    "final-evidence-ready-identity",
    "required-constraints-pass-failures",
    "required-constraints-pass-unknowns",
]


def parse_h2_sections(text):
    """Return an ordered list of (heading, body) for every level-2 heading.

    A level-2 heading is a line starting with exactly "## " (two hashes and a
    space). A "### " line never matches: its third character is "#", not " ",
    so `line.startswith("## ")` is already false for it.
    """
    sections = []
    current_heading = None
    current_body = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current_heading is not None:
                sections.append((current_heading, "\n".join(current_body)))
            current_heading = line[len("## "):].strip()
            current_body = []
        elif current_heading is not None:
            current_body.append(line)
    if current_heading is not None:
        sections.append((current_heading, "\n".join(current_body)))
    return sections


def contains_token(text, token):
    """True if `token` occurs in `text` as a standalone identifier.

    A plain substring check (`token in text`) would let `replay-consistent`
    be satisfied by `replay-consistent-mismatch`, since the former is a
    literal substring of the latter. `\\b` word boundaries do not fix this
    either: a hyphen is a non-word character, so `\\breplay-consistent\\b`
    still matches at the boundary right before the "-mismatch" suffix. So
    this instead requires that no identifier character (letter, digit,
    underscore or hyphen) sits on either side of the match.
    """
    pattern = re.compile(r"(?<![A-Za-z0-9_-])" + re.escape(token) + r"(?![A-Za-z0-9_-])")
    return pattern.search(text) is not None


class IntentRecordTest(unittest.TestCase):
    def test_file_exists(self):
        self.assertTrue(INTENT_PATH.is_file(), f"missing {INTENT_PATH}")

    def test_headings_exact_and_ordered(self):
        text = INTENT_PATH.read_text(encoding="utf-8")
        headings = [heading for heading, _ in parse_h2_sections(text)]
        self.assertEqual(headings, INTENT_HEADINGS)

    def test_every_section_non_empty(self):
        text = INTENT_PATH.read_text(encoding="utf-8")
        sections = dict(parse_h2_sections(text))
        for heading in INTENT_HEADINGS:
            self.assertIn(heading, sections)
            self.assertTrue(
                sections[heading].strip(),
                f"INTENT.md section '{heading}' must not be empty",
            )


class SpecRecordTest(unittest.TestCase):
    def test_file_exists(self):
        self.assertTrue(SPEC_PATH.is_file(), f"missing {SPEC_PATH}")

    def test_headings_exact_and_ordered(self):
        text = SPEC_PATH.read_text(encoding="utf-8")
        headings = [heading for heading, _ in parse_h2_sections(text)]
        self.assertEqual(headings, SPEC_HEADINGS)

    def test_every_section_non_empty(self):
        text = SPEC_PATH.read_text(encoding="utf-8")
        sections = dict(parse_h2_sections(text))
        for heading in SPEC_HEADINGS:
            self.assertIn(heading, sections)
            self.assertTrue(
                sections[heading].strip(),
                f"SPEC.md section '{heading}' must not be empty",
            )

    def test_mentions_every_semantics_value_name(self):
        text = SPEC_PATH.read_text(encoding="utf-8")
        sections = dict(parse_h2_sections(text))
        semantics_body = sections.get("Semantics", "")
        missing = [
            name for name in SPEC_VALUE_NAMES if not contains_token(semantics_body, name)
        ]
        self.assertEqual(
            missing, [], f"SPEC.md Semantics chapter is missing value name(s): {missing}"
        )

    def test_mentions_every_rule_id(self):
        text = SPEC_PATH.read_text(encoding="utf-8")
        sections = dict(parse_h2_sections(text))
        judge_rules_body = sections.get("Judge rules", "")
        missing = [
            rule_id for rule_id in SPEC_RULE_IDS if not contains_token(judge_rules_body, rule_id)
        ]
        self.assertEqual(
            missing, [], f"SPEC.md Judge rules chapter is missing rule id(s): {missing}"
        )


if __name__ == "__main__":
    unittest.main()
