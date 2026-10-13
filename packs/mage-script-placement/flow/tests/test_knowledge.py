"""Checks on the Pack's `knowledge/*.md` files (Task 8).

Ported from the sibling Pack's `mage-scribe-placement/flow/tests/test_knowledge.py`
and adapted to this Pack's single resident tool. The top-level `knowledge:` table
uses the sibling's own block style (`- file: x` then a wrapped `purpose:`
continuation) -- a flow-mapping `- {file: x, purpose: <prose with commas>}` broke
on every purpose whose prose itself contained a comma, since YAML reads each
unescaped comma inside `{...}` as another mapping key. A tool's nested
`outsourcing.knowledge` stays the single-line flow list `[a.md, b.md, ...]`, which
only ever holds comma-free filenames.

This module never imports PyYAML (not a Pack runtime dependency) -- it reads
`contract.yml` and `mage_placement_cli.py` with small regex-based extraction, the
same "tiny parser-free approach" the rest of this Pack already uses for its own YAML
twins.

Checked, per the Task 8 brief:

- every file named in `contract.yml`'s top-level `knowledge:` list and in the
  `engineer-script` tool's `outsourcing.knowledge` list exists under `knowledge/`
  with a flat name matching the Pack's own name regex;
- no placeholder text (the unreplaced `engineer-script.description` marker) remains
  in any of them;
- the Engineer's five files total under 12,000 words;
- every token that looks like a CLI subcommand reference in a knowledge file -- a
  backtick span naming `mage_placement_cli.py <token>`, or a bare `<token> --flag
  ...` span whose first word is shaped like a subcommand name -- names a real
  subcommand (never silently skipped just because the token is not recognized) and
  uses only `--flags` that subcommand defines;
- every `state/...` path mentioned is either a declared `contract.yml` output path
  or a `state/history/round-NN/...` archive path (`rounds.py`'s own round archiver).
  The session log lives inside the Engineer's own round directory
  (`placement/round-NN/session.jsonl`, under its `artifactPrefix`), not under
  `state/`, so it is not part of this check.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path


FLOW_DIR = Path(__file__).resolve().parents[1]
PACK_DIR = FLOW_DIR.parent
KNOWLEDGE_DIR = PACK_DIR / "knowledge"
CONTRACT_PATH = PACK_DIR / "contract.yml"
CLI_PATH = FLOW_DIR / "mage_placement_cli.py"

FLAT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.(md|txt|pdf)$")
PLACEHOLDER_MARKER = "<the Engineer's complete brief"

# The one resident tool this Pack ships (no consumer roles): its
# `outsourcing.knowledge` list is read from `contract.yml` below; kept here only
# as the expected *set* of tool ids so a typo in the contract (missing/renamed
# tool) fails loudly.
RESIDENT_TOOL_IDS = ("engineer-script",)

WORD_BUDGET = 12000

# No knowledge file in this Pack names a `state/...` path that is not a declared
# contract.yml output or a round-archive path (unlike the sibling's
# `role-bonding.md` carve-out) -- kept empty per the Task 8 brief.
_EXTRA_STATE_PATHS = set()
_ARCHIVE_STATE_PATTERN = re.compile(r"^state/history/round-\d\d/")


def _read_text(path):
    return path.read_text(encoding="utf-8")


def _knowledge_purpose_table_files(text):
    """Every `file:` name of the top-level `knowledge:` purpose table in this
    Pack's own `contract.yml`, written the sibling's block style: one
    `- file: <name>` line starts an entry, followed by a `purpose:` line that may
    wrap onto further indented continuation lines. An entry's file name is taken
    from the `- file: <name>` line only; its (possibly wrapped) `purpose:` text is
    skipped over, not parsed, by continuing past every line indented under the
    entry. The block ends at the first line that starts neither a new `- file:`
    entry nor an indented continuation (end of file, in this Pack, since
    `knowledge:` is its own `contract.yml`'s last top-level key)."""
    pattern = re.compile(r"^knowledge:\s*$", re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return []
    start = match.end()
    lines = text[start:].splitlines()
    files = []
    for line in lines:
        if not line.strip():
            continue
        entry_match = re.match(r"-\s*file:\s*(\S+)\s*$", line)
        if entry_match:
            files.append(entry_match.group(1))
            continue
        if line[:1] in (" ", "\t"):
            # a `purpose:` line or one of its wrapped continuation lines,
            # indented under the `- file:` entry above it.
            continue
        break
    return files


def _tool_outsourcing_knowledge(text, tool_id):
    """The `knowledge: [...]` flow-style list inside one `- id: <tool_id>` tool
    block of `contract.yml` (this Pack writes it as a single-line flow sequence,
    not the sibling's one-item-per-line block list)."""
    tool_match = re.search(rf"^- id: {re.escape(tool_id)}\n(.*?)(?=^- id: |\Z)", text, re.MULTILINE | re.DOTALL)
    if not tool_match:
        return []
    block = tool_match.group(1)
    list_match = re.search(r"knowledge:\s*\[([^\]]*)\]", block)
    if not list_match:
        return []
    return [item.strip() for item in list_match.group(1).split(",") if item.strip()]


def _knowledge_file_list_from_contract():
    """Every filename this Pack's `contract.yml` names as knowledge: the
    top-level `knowledge:` purpose table's `file:` entries, plus the
    `engineer-script` tool's own `outsourcing.knowledge:` list."""
    text = _read_text(CONTRACT_PATH)

    top_level = _knowledge_purpose_table_files(text)

    per_tool = {}
    for tool_id in RESIDENT_TOOL_IDS:
        per_tool[tool_id] = _tool_outsourcing_knowledge(text, tool_id)
    return top_level, per_tool


def _subcommand_flags_from_cli():
    """Map every real `mage_placement_cli.py` subcommand to the set of
    `--flags` its own `argparse.ArgumentParser` defines, plus the set of
    `task-<name>` program subcommands (which take no flags: `WORKSPACE
    TASK_INPUT TASK_OUTPUT` positionals only), the batch fallback
    (`script-candidate`), and `flow-digest`."""
    text = _read_text(CLI_PATH)

    flags = {}
    for func_match in re.finditer(r"def (_cmd_\w+)\(workspace, args\):\n(.*?)(?=\ndef |\Z)", text, re.DOTALL):
        func_name, body = func_match.group(1), func_match.group(2)
        prog_match = re.search(r'ArgumentParser\(prog="([a-z-]+)"\)', body)
        if not prog_match:
            continue
        subcommand = prog_match.group(1)
        flags[subcommand] = set(re.findall(r'add_argument\("(--[a-zA-Z0-9-]+)"', body))

    program_tasks = {
        "task-prepare-case", "task-measure-incumbent", "task-decide-round",
        "task-evaluate-placement", "task-deliver",
    }
    for name in program_tasks:
        flags[name] = set()
    flags["script-candidate"] = set()
    flags["flow-digest"] = set()
    return flags


def _contract_output_paths():
    text = _read_text(CONTRACT_PATH)
    return set(re.findall(r"^\s*path:\s*(\S+)\s*$", text, re.MULTILINE))


SUBCOMMAND_FLAGS = _subcommand_flags_from_cli()
CONTRACT_OUTPUT_PATHS = _contract_output_paths()

_CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
_STATE_PATH_RE = re.compile(r"\bstate/[A-Za-z0-9._/-]+")
# A bare token shaped like one of this CLI's own subcommand names
# (`snapshot`, `plan-slots`, `task-prepare-case`, ...): lowercase words
# joined by single hyphens, no dots, no placeholders.
_SUBCOMMAND_SHAPE_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")


def _cli_reference_problems(text):
    """Every CLI-subcommand-or-flag reference in `text` that is not real, as a
    list of human-readable problem strings (empty when `text` is clean). Two
    reference shapes are checked, both inside backtick code spans only:

    1. `mage_placement_cli.py <token> ...` (anywhere `mage_placement_cli.py`
       appears as its own token in the span) -- `<token>` MUST be a real
       subcommand; this never continues past a bad token, it fails.
    2. a bare `<token> --flag ...` span whose first token is shaped like a
       subcommand name (`_SUBCOMMAND_SHAPE_RE`) and is followed by at least
       one `--flag`-looking token -- `<token>` MUST be a real subcommand,
       for the same reason: a span that *looks* like a CLI invocation is
       held to that standard, not silently skipped because the renamed/
       typo'd subcommand happens not to be recognized.

    In both shapes, once the subcommand is confirmed real, every
    `--flag`-looking token after it must be one that subcommand's own
    `argparse.ArgumentParser` actually defines.
    """
    problems = []
    for span in _CODE_SPAN_RE.findall(text):
        tokens = span.split()
        if not tokens:
            continue

        head_index = None
        if "mage_placement_cli.py" in tokens:
            idx = tokens.index("mage_placement_cli.py")
            if idx + 1 < len(tokens):
                head_index = idx + 1
        elif _SUBCOMMAND_SHAPE_RE.match(tokens[0]) and any(t.startswith("--") for t in tokens[1:]):
            head_index = 0

        if head_index is None:
            continue

        head = tokens[head_index]
        if head not in SUBCOMMAND_FLAGS:
            problems.append(f"{head!r} is not a real mage_placement_cli.py subcommand (span: {span!r})")
            continue

        for token in tokens[head_index + 1:]:
            if not token.startswith("--"):
                continue
            flag = token.split("=", 1)[0].rstrip(",).")
            if flag not in SUBCOMMAND_FLAGS[head]:
                problems.append(f"{flag!r} is not a flag of subcommand {head!r} (span: {span!r})")
    return problems


def _iter_knowledge_files():
    top_level, per_tool = _knowledge_file_list_from_contract()
    names = sorted(set(top_level) | {name for files in per_tool.values() for name in files})
    return names, per_tool


class KnowledgeFilesTest(unittest.TestCase):
    def setUp(self):
        self.names, self.per_tool = _iter_knowledge_files()
        self.assertTrue(self.names, "contract.yml named no knowledge files -- extraction broke")

    def test_every_named_file_exists_and_is_flat(self):
        for name in self.names:
            self.assertRegex(name, FLAT_NAME_RE, f"{name!r} is not a flat knowledge name")
            path = KNOWLEDGE_DIR / name
            self.assertTrue(path.is_file(), f"contract.yml names {name!r} but {path} does not exist")

    def test_no_placeholder_text_remains(self):
        for name in self.names:
            text = _read_text(KNOWLEDGE_DIR / name)
            self.assertNotIn(PLACEHOLDER_MARKER, text, f"{name} still has placeholder text")
            self.assertGreater(len(text.split()), 20, f"{name} looks too short to be real content")

    def test_top_level_knowledge_list_matches_the_engineer_union(self):
        top_level, per_tool = _knowledge_file_list_from_contract()
        self.assertEqual(len(top_level), 5, f"expected 5 files in the top-level knowledge: table, got {top_level}")
        self.assertEqual(len(set(top_level)), 5, "the top-level knowledge: table has a duplicate file")
        per_tool_union = {name for files in per_tool.values() for name in files}
        self.assertEqual(
            set(top_level), per_tool_union,
            "the top-level knowledge: table must equal the engineer-script tool's own "
            "outsourcing.knowledge union (this Pack has no other resident tool)",
        )

    def test_engineer_knowledge_set_under_word_budget(self):
        files = self.per_tool.get("engineer-script")
        self.assertTrue(files, "engineer-script has no outsourcing.knowledge in contract.yml")
        total = sum(len(_read_text(KNOWLEDGE_DIR / name).split()) for name in files)
        self.assertLess(total, WORD_BUDGET, f"engineer-script knowledge set is {total} words")

    def test_cli_subcommands_and_flags_are_real(self):
        self.assertIn("snapshot", SUBCOMMAND_FLAGS)
        self.assertIn("--pla", SUBCOMMAND_FLAGS["snapshot"])
        self.assertIn("mage-stage", SUBCOMMAND_FLAGS)
        self.assertIn("--round", SUBCOMMAND_FLAGS["mage-stage"])
        for name in self.names:
            text = _read_text(KNOWLEDGE_DIR / name)
            problems = _cli_reference_problems(text)
            self.assertEqual(problems, [], f"{name}: {problems}")

    def test_cli_reference_checker_catches_bogus_subcommands_and_flags(self):
        # Negative self-check: a bogus subcommand and a bogus flag on a real
        # subcommand must both be reported -- proves the checker fails loudly
        # on a renamed/nonexistent subcommand rather than silently skipping it
        # (what `continue`-on-unrecognized-head used to do).
        bogus_text = (
            "Run `frobnicate --pla x --out y` to build the frame.\n\n"
            "Then run `snapshot --pla x --bogus-flag y --out z` to snapshot it.\n\n"
            "Finally run `python3 mage_placement_cli.py obsolete-subcommand WORKSPACE` to finish.\n"
        )
        problems = _cli_reference_problems(bogus_text)
        self.assertTrue(
            any("frobnicate" in p and "not a real" in p for p in problems),
            f"bogus subcommand not caught: {problems}",
        )
        self.assertTrue(
            any("bogus-flag" in p for p in problems),
            f"bogus flag not caught: {problems}",
        )
        self.assertTrue(
            any("obsolete-subcommand" in p and "not a real" in p for p in problems),
            f"bogus mage_placement_cli.py subcommand not caught: {problems}",
        )
        # and a clean reference must report nothing:
        clean_text = "Run `snapshot --pla x --stage start --out y` to build the start snapshot.\n"
        self.assertEqual(_cli_reference_problems(clean_text), [])

    def test_state_paths_are_real(self):
        for name in self.names:
            text = _read_text(KNOWLEDGE_DIR / name)
            for match in _STATE_PATH_RE.finditer(text):
                raw = match.group(0).rstrip(".,)`'\"")
                if raw.endswith("/") or raw.endswith("/.."):
                    # a bare directory prefix in prose (e.g. "state/round/...")
                    # -- real iff some declared output path starts with it.
                    prefix = raw[:-2] if raw.endswith("/..") else raw
                    if any(p.startswith(prefix) for p in CONTRACT_OUTPUT_PATHS):
                        continue
                if raw in CONTRACT_OUTPUT_PATHS or raw in _EXTRA_STATE_PATHS:
                    continue
                if _ARCHIVE_STATE_PATTERN.match(raw):
                    continue
                self.fail(f"{name}: {raw!r} is not a declared contract.yml output path or a known archive path")


if __name__ == "__main__":
    unittest.main()
