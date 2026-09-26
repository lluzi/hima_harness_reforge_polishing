"""Structural checks on the Pack's authoring records (INTENT.md, SPEC.md, FABRIC.md)
and a cheap cross-check of the compiled method files (graph.yml, contract.yml).

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
FABRIC_PATH = PACK_ROOT / "FABRIC.md"
GRAPH_PATH = PACK_ROOT / "graph.yml"
CONTRACT_PATH = PACK_ROOT / "contract.yml"

FABRIC_HEADINGS = ["Files written", "Gaps", "Reviews"]

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


def _strip_comment(line):
    """Drop a YAML `#` comment (these files never put `#` inside a value)."""
    return line.split(" #", 1)[0] if not line.lstrip().startswith("#") else ""


def _inline_list(text):
    """Items of an inline YAML flow list `[a, b]` (plain scalars only)."""
    inner = text.strip()
    if not (inner.startswith("[") and inner.endswith("]")):
        return None
    return [item.strip().strip("'\"") for item in inner[1:-1].split(",") if item.strip()]


def yaml_key_lists(text, key):
    """Every list value of `key:` in `text`, inline (`key: [a, b]`) or block (`key:` + `- a` lines).

    Deliberately tiny (stdlib only, no YAML library): it understands exactly the two list
    spellings this Pack's own graph.yml/contract.yml use, and returns one list per occurrence.
    """
    lines = [_strip_comment(line) for line in text.splitlines()]
    found = []
    pattern = re.compile(r"^(\s*)(?:- )?(?:\{\s*)?" + re.escape(key) + r":\s*(.*)$")
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            # `parameters: { rules: [a, b] }` puts the key inside an inline mapping.
            inline = re.search(r"[{,]\s*" + re.escape(key) + r":\s*(\[[^\]]*\])", line)
            if inline:
                found.append(_inline_list(inline.group(1)))
            continue
        indent, rest = len(match.group(1)), match.group(2).strip()
        if rest.startswith("["):
            found.append(_inline_list(rest[: rest.index("]") + 1]))
            continue
        if rest:
            continue
        items = []
        for following in lines[index + 1:]:
            if not following.strip():
                continue
            stripped = following.strip()
            if len(following) - len(following.lstrip()) < indent or not stripped.startswith("- "):
                break
            items.append(stripped[2:].strip().strip("'\""))
        found.append(items)
    return found


def contract_outputs(text):
    """`[(name, reader or None)]` for every entry of contract.yml's top-level `outputs:` block."""
    lines = text.splitlines()
    start = lines.index("outputs:")
    outputs = []
    for line in lines[start + 1:]:
        if line and not line.startswith(" "):
            break
        name = re.match(r"^  - name: (\S+)", line)
        if name:
            outputs.append([name.group(1), None])
            continue
        reader = re.match(r"^    reader: (\S+)", line)
        if reader and outputs:
            outputs[-1][1] = reader.group(1)
    return [tuple(entry) for entry in outputs]


class FabricRecordTest(unittest.TestCase):
    def test_headings_exact_and_ordered(self):
        text = FABRIC_PATH.read_text(encoding="utf-8")
        headings = [heading for heading, _ in parse_h2_sections(text)]
        self.assertEqual(headings, FABRIC_HEADINGS)

    def test_every_section_non_empty(self):
        sections = dict(parse_h2_sections(FABRIC_PATH.read_text(encoding="utf-8")))
        for heading in FABRIC_HEADINGS:
            self.assertTrue(sections.get(heading, "").strip(), f"FABRIC.md section '{heading}' must not be empty")


class CompiledMethodCrossCheckTest(unittest.TestCase):
    """Cheap Python mirror of the references `loadPack`/`checkPack` resolve (no Node needed)."""

    def test_every_graph_rule_has_a_rule_file(self):
        graph_rules = {rule for rules in yaml_key_lists(GRAPH_PATH.read_text(encoding="utf-8"), "rules") for rule in rules}
        self.assertTrue(graph_rules, "graph.yml names no rules at all; the parser found nothing")
        missing = sorted(rule for rule in graph_rules if not (PACK_ROOT / "rules" / f"{rule}.yml").is_file())
        self.assertEqual(missing, [], f"graph.yml names rule(s) with no rules/<id>.yml: {missing}")

    def test_contract_rules_cover_graph_rules_and_have_files(self):
        contract_rules = yaml_key_lists(CONTRACT_PATH.read_text(encoding="utf-8"), "rules")
        top_level = [rules for rules in contract_rules if rules]
        self.assertEqual(len(top_level), 1, "contract.yml must hold exactly one rules: list")
        declared = set(top_level[0])
        graph_rules = {rule for rules in yaml_key_lists(GRAPH_PATH.read_text(encoding="utf-8"), "rules") for rule in rules}
        self.assertEqual(sorted(graph_rules - declared), [], "graph.yml applies rules contract.yml does not list")
        for rule in declared:
            path = PACK_ROOT / "rules" / f"{rule}.yml"
            self.assertTrue(path.is_file(), f"contract.yml lists {rule} with no {path.name}")
            self.assertIn(f"id: {rule}\n", path.read_text(encoding="utf-8"), f"{path.name} must declare id {rule}")

    def test_every_graph_chooser_has_a_chooser_file(self):
        text = GRAPH_PATH.read_text(encoding="utf-8")
        choosers = set(re.findall(r"chooser: ([a-z0-9-]+)", text))
        self.assertTrue(choosers)
        missing = sorted(c for c in choosers if not (PACK_ROOT / "choosers" / f"{c}.yml").is_file())
        self.assertEqual(missing, [], f"graph.yml names chooser(s) with no choosers/<id>.yml: {missing}")

    def test_every_output_reader_has_a_reader_file(self):
        outputs = contract_outputs(CONTRACT_PATH.read_text(encoding="utf-8"))
        readers = [reader for _, reader in outputs if reader]
        self.assertTrue(readers, "contract.yml declares no output reader; the parser found nothing")
        missing = sorted(r for r in readers if not (PACK_ROOT / "readers" / f"{r}.yml").is_file())
        self.assertEqual(missing, [], f"contract.yml names reader(s) with no readers/<id>.yml: {missing}")

    def test_every_reader_file_is_bound_to_an_output(self):
        bound = {reader for _, reader in contract_outputs(CONTRACT_PATH.read_text(encoding="utf-8")) if reader}
        on_disk = {path.stem for path in (PACK_ROOT / "readers").glob("*.yml")}
        self.assertEqual(sorted(on_disk - bound), [], "readers/ holds reader(s) no contract output uses")

    def test_tool_written_outputs_match_the_cli_path_table(self):
        """Every declared output under state/, accepted/ or apr/ is a path atcs_cli.py really writes."""
        import importlib.util
        import sys

        flow_dir = PACK_ROOT / "flow"
        sys.path.insert(0, str(flow_dir))
        try:
            spec = importlib.util.spec_from_file_location("atcs_cli_for_records", flow_dir / "atcs_cli.py")
            cli = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cli)
        finally:
            sys.path.remove(str(flow_dir))
        root = Path("/campaign")
        written = {str(path.relative_to(root)) for path in cli._paths(root).values()}
        written |= {str(cli._contribution_path(root, slot).relative_to(root)) for slot in ("w01", "w02", "w03")}
        written |= {str(cli._apr_task_path(root, stage).relative_to(root)) for stage in cli.APR_STAGES}
        declared = re.findall(r"^    path: (\S+)$", CONTRACT_PATH.read_text(encoding="utf-8"), re.M)
        tool_written = [path for path in declared if path.split("/")[0] in ("state", "accepted", "apr")]
        self.assertTrue(tool_written)
        self.assertEqual(sorted(set(tool_written) - written), [], "contract.yml declares tool outputs atcs_cli.py never writes")

    def test_parser_reads_both_list_spellings(self):
        sample = "a:\n  rules: [x, y]\n  rules:\n    - z\n    - w\nb: { rules: [v] }\n"
        self.assertEqual(yaml_key_lists(sample, "rules"), [["x", "y"], ["z", "w"], ["v"]])


if __name__ == "__main__":
    unittest.main()
