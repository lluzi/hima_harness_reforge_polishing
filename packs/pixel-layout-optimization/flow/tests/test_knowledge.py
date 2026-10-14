"""The knowledge files only name real CLI surface and carry no case data.

Every CLI subcommand and option the four knowledge files name must exist in
``pixel_cli.py``; every ``state/...`` path they name must be a declared
contract output or a documented Task-6 workspace path; and no number that
looks like case data (three or more significant digits) may appear, so a real
coordinate, rule value or capacitance can never be copied into the Pack.
"""
import os
import re
import sys
import unittest

_FLOW = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))
_PACK = os.path.dirname(_FLOW)
_KNOWLEDGE = os.path.join(_PACK, "knowledge")
sys.path.insert(0, _FLOW)

import pixel_cli  # noqa: E402

# Every state path the flow writes: contract outputs plus the Task-6 layout.
_ALLOWED_STATE_PATHS = {
    "state/paths.json", "state/case-readiness.json", "state/rules.json",
    "state/original.json", "state/card.json", "state/card.svg",
    "state/model.json", "state/history.jsonl", "state/round/plan.json",
    "state/round-decision.json", "state/trend.json", "state/trend.svg",
    "state/evaluation.json",
}

# The subcommands the CLI actually registers (plus the dynamic families).
_CLI_SUBCOMMANDS = set(pixel_cli._PRINTING) | set(pixel_cli._NUM_FORWARD) | {"num-judge-one"}


def _knowledge_files():
    return [os.path.join(_KNOWLEDGE, f) for f in os.listdir(_KNOWLEDGE) if f.endswith(".md")]


def _all_text():
    out = []
    for path in _knowledge_files():
        with open(path, "r", encoding="utf-8") as fh:
            out.append((os.path.basename(path), fh.read()))
    return out


class KnowledgeSubcommandsTest(unittest.TestCase):
    def test_named_subcommands_exist(self):
        # inline code of the form `<cmd> WORKSPACE ...`
        named = set()
        for _name, text in _all_text():
            for m in re.finditer(r"`([a-z][a-z0-9-]*)\s+WORKSPACE", text):
                named.add(m.group(1))
        self.assertTrue(named, "no subcommands found in knowledge")
        for cmd in named:
            self.assertIn(cmd, _CLI_SUBCOMMANDS,
                          "knowledge names subcommand %r the CLI does not register" % cmd)

    def test_named_options_exist(self):
        with open(os.path.join(_FLOW, "pixel_cli.py"), encoding="utf-8") as fh:
            cli_src = fh.read()
        named = set()
        for _name, text in _all_text():
            for m in re.finditer(r"(--[a-z][a-z-]+)", text):
                named.add(m.group(1))
        self.assertTrue(named)
        for opt in named:
            self.assertIn(opt, cli_src,
                          "knowledge names option %r absent from the CLI" % opt)


class KnowledgeStatePathsTest(unittest.TestCase):
    def test_state_paths_are_declared(self):
        for name, text in _all_text():
            for m in re.finditer(r"state/[A-Za-z0-9_./-]+", text):
                path = m.group(0).rstrip(".")
                self.assertIn(path, _ALLOWED_STATE_PATHS,
                              "%s names undocumented state path %r" % (name, path))


class KnowledgeNoCaseDataTest(unittest.TestCase):
    @staticmethod
    def _sig_digits(token):
        s = token
        if "." in s:
            whole, frac = s.split(".", 1)
            frac = frac.rstrip("0")
            s = whole + frac
        s = s.lstrip("0")
        return len(s)

    def test_no_case_numbers(self):
        for name, text in _all_text():
            cleaned = re.sub(r"sha-?256", "", text, flags=re.IGNORECASE)
            cleaned = re.sub(r"\d{4}-\d{2}-\d{2}", "", cleaned)  # dates
            offenders = []
            for m in re.finditer(r"\d+(?:\.\d+)?", cleaned):
                tok = m.group(0)
                if self._sig_digits(tok) >= 3:
                    offenders.append(tok)
            self.assertFalse(offenders,
                             "%s carries number(s) that look like case data: %s"
                             % (name, offenders))


if __name__ == "__main__":
    unittest.main()
