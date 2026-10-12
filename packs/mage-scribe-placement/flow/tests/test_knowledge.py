"""Checks on the Pack's `knowledge/*.md` files (Task 8).

This module never imports PyYAML (not a Pack runtime dependency; see
`docs/adr` / global constraints) -- it reads `contract.yml` and
`mage_placement_cli.py` with small regex-based extraction, exactly the
"tiny parser-free approach" the rest of this Pack already uses for its own
YAML twins.

Checked, per the Task 8 brief:

- every file named in `contract.yml`'s top-level `knowledge:` list and in
  every tool's `outsourcing.knowledge` list exists under `knowledge/`
  with a flat name matching the Pack's own name regex;
- no placeholder text (`Written in Task 8`) remains in any of them;
- the Engineer's knowledge set (the five files `engineer-place` reads) and
  each consumer's knowledge set (the three files each `review-*` tool
  reads) are each under 12,000 words in total;
- every token that looks like a CLI subcommand reference in a knowledge
  file (a backtick code span whose first word names a real
  `mage_placement_cli.py` subcommand) only uses subcommands and `--flags`
  that subcommand actually defines;
- every `state/...` path mentioned is either a declared `contract.yml`
  output path, the one real session-log path (`state/session.jsonl`), or
  a `state/history/round-NN/...` archive path (`rounds.py:_archive_round`).
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
PLACEHOLDER_MARKER = "Written in Task 8"

# Resident tool id -> its `outsourcing.knowledge` list, read from
# `contract.yml` below; kept here only as the expected *set* of tool ids
# so a typo in the contract (missing/renamed tool) fails loudly.
RESIDENT_TOOL_IDS = (
    "engineer-place", "review-litho-pie", "review-metrology", "review-alignment", "review-wat",
)

WORD_BUDGET = 12000

# Additional `state/...` paths this Pack's own code writes that are not
# `contract.yml` declared outputs: the one native-session log, and the
# program's permanent per-round archive (`rounds.py:_archive_round`).
_EXTRA_STATE_PATHS = {"state/session.jsonl"}
_ARCHIVE_STATE_PATTERN = re.compile(r"^state/history/round-\d\d/")


def _read_text(path):
    return path.read_text(encoding="utf-8")


def _extract_yaml_block_list(text, key):
    """Return the flat string items of a top-level `<key>:` block-list in
    `contract.yml`'s own restricted YAML subset (one `- name` or `- file`
    style list, or a plain `- scalar` list) -- good enough for the two
    shapes this function is used on here (`knowledge:` file names and a
    tool's `outsourcing.knowledge` list)."""
    pattern = re.compile(rf"^{re.escape(key)}:\s*$", re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return []
    start = match.end()
    lines = text[start:].splitlines()
    indent = None
    items = []
    for line in lines:
        if not line.strip():
            continue
        stripped = line.lstrip(" ")
        this_indent = len(line) - len(stripped)
        if indent is None:
            if not stripped.startswith("- "):
                break
            indent = this_indent
        if this_indent < indent or not stripped.startswith("- "):
            break
        if this_indent > indent:
            continue
        items.append(stripped[2:].strip())
    return items


def _knowledge_file_list_from_contract():
    """Every filename this Pack's `contract.yml` names as knowledge: the
    top-level `knowledge:` purpose table's `file:` entries, plus every
    resident tool's own `outsourcing.knowledge:` list."""
    text = _read_text(CONTRACT_PATH)

    top_level = []
    for raw in _extract_yaml_block_list(text, "knowledge"):
        file_match = re.match(r"file:\s*(\S+)", raw)
        if file_match:
            top_level.append(file_match.group(1))

    per_tool = {}
    for tool_id in RESIDENT_TOOL_IDS:
        tool_match = re.search(rf"^- id: {re.escape(tool_id)}\n(.*?)(?=^- id: |\Z)", text, re.MULTILINE | re.DOTALL)
        if not tool_match:
            continue
        block = tool_match.group(1)
        files = _extract_yaml_block_list(block, "    knowledge")
        if not files:
            # fallback: the nested list may be indented differently than the
            # top-level one `_extract_yaml_block_list` assumes a flush `key:`
            # line -- re-search for "knowledge:" anywhere in this tool block.
            nested = re.search(r"knowledge:\s*\n((?:\s*-\s*\S+\s*\n?)+)", block)
            if nested:
                files = [line.strip()[2:].strip() for line in nested.group(1).splitlines() if line.strip().startswith("-")]
        per_tool[tool_id] = files
    return top_level, per_tool


def _subcommand_flags_from_cli():
    """Map every real `mage_placement_cli.py` subcommand to the set of
    `--flags` its own `argparse.ArgumentParser` defines, plus the set of
    `task-<name>` program subcommands (which take no flags: `WORKSPACE
    TASK_INPUT TASK_OUTPUT` positionals only) and the two positional batch
    fallbacks (`placement-candidate`, `consumer-review`)."""
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
    flags["placement-candidate"] = set()
    flags["consumer-review"] = set()
    flags["flow-digest"] = set()
    return flags


def _contract_output_paths():
    text = _read_text(CONTRACT_PATH)
    return set(re.findall(r"^\s*path:\s*(\S+)\s*$", text, re.MULTILINE))


SUBCOMMAND_FLAGS = _subcommand_flags_from_cli()
CONTRACT_OUTPUT_PATHS = _contract_output_paths()

_CODE_SPAN_RE = re.compile(r"`([^`\n]+)`")
_STATE_PATH_RE = re.compile(r"\bstate/[A-Za-z0-9._/-]+")


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

    def test_role_bonding_exists_even_though_unreferenced(self):
        # role-bonding.md ships for a later version; no tool outsourcing.knowledge
        # names it, so it is not in self.names, but it must still exist flat-named.
        path = KNOWLEDGE_DIR / "role-bonding.md"
        self.assertTrue(path.is_file())
        self.assertRegex("role-bonding.md", FLAT_NAME_RE)
        self.assertNotIn(PLACEHOLDER_MARKER, _read_text(path))

    def test_engineer_knowledge_set_under_word_budget(self):
        files = self.per_tool.get("engineer-place")
        self.assertTrue(files, "engineer-place has no outsourcing.knowledge in contract.yml")
        total = sum(len(_read_text(KNOWLEDGE_DIR / name).split()) for name in files)
        self.assertLess(total, WORD_BUDGET, f"engineer-place knowledge set is {total} words")

    def test_each_consumer_knowledge_set_under_word_budget(self):
        for tool_id in ("review-litho-pie", "review-metrology", "review-alignment", "review-wat"):
            files = self.per_tool.get(tool_id)
            self.assertTrue(files, f"{tool_id} has no outsourcing.knowledge in contract.yml")
            total = sum(len(_read_text(KNOWLEDGE_DIR / name).split()) for name in files)
            self.assertLess(total, WORD_BUDGET, f"{tool_id} knowledge set is {total} words")

    def test_cli_subcommands_and_flags_are_real(self):
        self.assertIn("snapshot", SUBCOMMAND_FLAGS)
        self.assertIn("--pla", SUBCOMMAND_FLAGS["snapshot"])
        for name in self.names:
            text = _read_text(KNOWLEDGE_DIR / name)
            for span in _CODE_SPAN_RE.findall(text):
                tokens = span.split()
                if not tokens:
                    continue
                head = tokens[0]
                if head not in SUBCOMMAND_FLAGS:
                    continue
                for token in tokens[1:]:
                    if not token.startswith("--"):
                        continue
                    flag = token.split("=", 1)[0].rstrip(",).")
                    self.assertIn(
                        flag, SUBCOMMAND_FLAGS[head],
                        f"{name}: {flag!r} is not a flag of subcommand {head!r} (span: {span!r})",
                    )

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
