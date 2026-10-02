"""Structural checks on the Pack's method Knowledge files.

Knowledge explains methods, conditions and failure interpretation; it never states a
measured fact as established (see `docs/package-development/THE_DEVELOPMENT_OF_HIMA_PACK.md`
Section "Knowledge"). SPEC.md's "Knowledge" chapter names ten files and, for each, the
decision it must change. This test holds every file to a minimal, checkable shape: it
exists, it carries the four required `##` headings in order, every one of those
sections is non-empty, and the `Source` section actually names a path or a document
version rather than only prose. It does not evaluate the quality or accuracy of the
prose itself.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_knowledge.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_DIR = PACK_ROOT / "knowledge"

# The ten files SPEC.md's "Knowledge" chapter commits to, in the order that chapter
# lists them.
KNOWLEDGE_FILES = [
    "method-and-benchmark.md",
    "state-and-evidence.md",
    "observation-strategy.md",
    "mechanisms-and-falsifiers.md",
    "xtop-capabilities.md",
    "contribution-and-merge.md",
    "cheap-verification.md",
    "innovus-stage-interventions.md",
    "lifecycle-and-input-modes.md",
    "experience-transfer.md",
]

REQUIRED_HEADINGS = [
    "Source",
    "Applies when",
    "Changes this decision",
    "Counterexample",
]

# A path-like token: at least one path separator between non-space segments, e.g.
# "packs/xtop-timing-closure/knowledge" or "share/doc/man/man1/undo.1".
PATH_TOKEN_RE = re.compile(r"(?<![\w/])[\w.\-]+(?:/[\w.\-]+)+(?![\w/])")

# A version-like token: an ISO-ish date or year, a dotted version number (e.g.
# "23.14" or "1.0.14"), a long hex digest, or a dated man-page footer like
# "12/15/2025".
VERSION_TOKEN_RE = re.compile(
    r"(20\d\d-\d\d-\d\d"        # 2026-09-26
    r"|\b20\d\d\b"              # 2026
    r"|\b\d{1,2}/\d{1,2}/20\d\d\b"  # 12/15/2025
    r"|\b\d+\.\d+(?:\.\d+)?\b"  # 23.14, 1.0.14, 2025.09
    r"|\b[0-9a-f]{16,64}\b"     # sha256-style digest
    r")",
    re.IGNORECASE,
)


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


def make_knowledge_file_test(filename):
    path = KNOWLEDGE_DIR / filename

    class _KnowledgeFileTest(unittest.TestCase):
        def test_file_exists(self):
            self.assertTrue(path.is_file(), f"missing {path}")

        def test_required_headings_present_and_ordered(self):
            text = path.read_text(encoding="utf-8")
            headings = [heading for heading, _ in parse_h2_sections(text)]
            self.assertEqual(
                headings,
                REQUIRED_HEADINGS,
                f"{filename} must have exactly the headings {REQUIRED_HEADINGS} "
                f"in order (### subsections underneath are fine), got {headings}",
            )

        def test_every_required_section_non_empty(self):
            text = path.read_text(encoding="utf-8")
            sections = dict(parse_h2_sections(text))
            for heading in REQUIRED_HEADINGS:
                self.assertIn(heading, sections)
                self.assertTrue(
                    sections[heading].strip(),
                    f"{filename} section '{heading}' must not be empty",
                )

        def test_source_names_a_path_or_a_version(self):
            text = path.read_text(encoding="utf-8")
            sections = dict(parse_h2_sections(text))
            source_body = sections.get("Source", "")
            self.assertIsNotNone(
                PATH_TOKEN_RE.search(source_body),
                f"{filename} 'Source' section must name at least one path",
            )
            self.assertIsNotNone(
                VERSION_TOKEN_RE.search(source_body),
                f"{filename} 'Source' section must name at least one version, "
                f"date or digest",
            )

    _KnowledgeFileTest.__name__ = "KnowledgeFileTest_" + filename.replace("-", "_").replace(".", "_")
    _KnowledgeFileTest.__qualname__ = _KnowledgeFileTest.__name__
    return _KnowledgeFileTest


def load_tests(loader, standard_tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(standard_tests)
    for filename in KNOWLEDGE_FILES:
        test_case = make_knowledge_file_test(filename)
        suite.addTests(loader.loadTestsFromTestCase(test_case))
    return suite


class KnowledgeManifestTest(unittest.TestCase):
    def test_all_ten_files_listed(self):
        self.assertEqual(len(KNOWLEDGE_FILES), 10)

    def test_knowledge_dir_exists(self):
        self.assertTrue(KNOWLEDGE_DIR.is_dir(), f"missing {KNOWLEDGE_DIR}")


# Issue #64 Task 4: the XTop expert-operator knowledge, read by the plan and research
# Workshops and condensed into the worker Team's Operator template.
EXPERT_FILE = "xtop-expert-operator.md"

# Every fail reason in the XTop 2025.09.tmp15 Reference Manual: the 112 "Fail Reasons" rows of
# the knowledge pack's `evidence/man_catalog.tsv` (sha256 591caecac2a7bf9661153b87e550e61e554d7514818d4b821885abe26f391ded).
XTOP_FAIL_REASONS = frozenset("""
    assigned_net break_hold break_hold_of_driver break_max_capacitance
    break_max_capacitance_of_driver break_max_fanout break_max_transition
    break_max_transition_of_driver break_minimum_cell_delay break_setup break_setup_of_driver
    buffer_chain_length chain_buffer_max_distance chain_header_surround_distance
    connected_mib_net cross_hierarchy_mib_net cross_hierarchy_net cross_multi_tech_design_net
    dangling_pin_on_net data_dont_touch_cell data_dont_touch_net dont_touch_pin
    exclude_move_target_boxes fail_to_legalize feed_through_module floating_pin heavy_fanout_net
    illegal_length_threshold illegal_net_to_split incomplete_net incomplete_timing_cell
    inout_pin_on_net input_port invalid_power_frequency invalid_power_voltage
    invalid_reference_cell large_area_to_size_up large_input_transition legal_fail_congestion
    legal_fail_density legal_fail_drc legal_fail_fixed_cell legal_fail_locked_cell
    legal_fail_no_available_row legal_fail_no_space_on_row legal_fail_unplaced_cell
    meco_fail_congestion meco_fail_density meco_fail_fill_not_meet meco_fail_fixed_cell
    meco_fail_locked_cell meco_fail_no_available_row meco_fail_no_fill_space_on_row
    meco_fail_unplaced_cell module_not_unique module_power_domain_conflict multi_driven_net
    newly_created_object no_alternative_cell no_alternative_cell_by_multi_tech
    no_annotated_data_mib_net no_annotated_data_net no_available_buffer
    no_available_buffer_by_multi_tech no_available_dummy_cell no_capacitance_gain
    no_capacitance_total_gain no_dynamic_power_gain no_fanout_gain no_ga_cell_found
    no_glitch_gain no_hold_gain no_hold_margin no_hold_total_gain no_physical_pin no_setup_gain
    no_setup_margin no_setup_total_gain no_si_gain no_spare_cell_found no_spare_or_ga_cell_found
    no_transition_gain no_transition_total_gain no_valid_eco_cell node_drives_multi_module
    node_not_on_route not_buffer_chain not_core_cell not_found_driver
    not_greater_than_density_threshold not_only_pin not_parallel_mib not_size_and_remove_cell
    null_physical_net off_path_violated_pin place_not_ready port_net power_domain_conflict
    power_intent_cell sequential_cell si_critical_net special_power_domain
    sufficient_driving_strength too_far_buffer too_large_slack too_weak_drive_strength
    unable_fix_by_dummy_cell unconstrained_cell used_as_clock user_dont_touch_cell
    user_dont_touch_net wrong_direction_net
""".split())

# Each toolkit procedure and the installed man page(s) its XTop commands are documented in
# (`notes/t3-toolkit-surface.md`, `flow/templates/xtop-operator.tcl`).
TOOLKIT_MAN_PAGES = {
    "atcs_ref": ["summarize_gba_violations.1", "redirect.1"],
    "atcs_gain": ["summarize_gba_violations.1"],
    "atcs_paths": ["get_paths.1", "analyze_setup_path_violations.1", "analyze_hold_path_violations.1"],
    "atcs_fail_reasons": ["report_fail_reasons.1", "get_failed_pins.1"],
    "atcs_candidates": ["list_size_cell_candidates.1", "list_insert_buffer_candidates.1",
                        "list_exchange_cell_candidates.1"],
    "atcs_size_cell": ["size_cell.1"],
    "atcs_exchange_cell": ["exchange_cell.1"],
    "atcs_insert_buffer": ["insert_buffer.1"],
    "atcs_insert_dummy": ["insert_dummy_cell.1"],
    "atcs_split_load": ["split_load.1"],
    "atcs_split_net": ["split_net.1"],
    "atcs_move_cell": ["move_cell.1"],
    "atcs_remove_buffer": ["remove_buffer.1"],
    "atcs_fix_hold_pins": ["fix_hold_gba_violations.1"],
    "atcs_fix_setup_pins": ["fix_setup_gba_violations.1"],
    "atcs_undo": ["undo.1", "count_eco_actions.1"],
}

EXPERT_SUBSECTIONS = [
    "The expert loop",
    "Six expertise priors",
    "Bounded rank and legalization settings",
    "Hold ladder",
    "Setup ladder",
    "Target/margin pairing",
    "Fail-reason to move table",
    "Blockers vs bulk",
]


def _h3_sections(text):
    sections, heading, body = [], None, []
    for line in text.splitlines():
        if line.startswith("### "):
            if heading is not None:
                sections.append((heading, "\n".join(body)))
            heading, body = line[4:].strip(), []
        elif line.startswith("## "):
            if heading is not None:
                sections.append((heading, "\n".join(body)))
            heading, body = None, []
        elif heading is not None:
            body.append(line)
    if heading is not None:
        sections.append((heading, "\n".join(body)))
    return sections


def _in_order(test, text, words, label):
    """Each word must appear after the previous one (a later step may repeat an earlier word)."""
    index = 0
    for word in words:
        found = text.find(word, index)
        test.assertGreaterEqual(found, 0, f"{label} must name {word!r} after {text[:index][-40:]!r} ({words})")
        index = found + len(word)


class ExpertOperatorKnowledgeTest(unittest.TestCase):
    def setUp(self):
        self.path = KNOWLEDGE_DIR / EXPERT_FILE
        self.text = self.path.read_text(encoding="utf-8")
        self.sections = dict(parse_h2_sections(self.text))
        self.subsections = dict(_h3_sections(self.text))

    def test_four_headings_and_at_most_180_lines(self):
        self.assertEqual([heading for heading, _ in parse_h2_sections(self.text)], REQUIRED_HEADINGS)
        self.assertLessEqual(len(self.text.splitlines()), 180)
        self.assertTrue(all(self.sections[heading].strip() for heading in REQUIRED_HEADINGS))

    def test_the_decision_section_carries_the_brief_subsections_in_order(self):
        headings = [heading for heading, _ in _h3_sections(self.sections["Changes this decision"])]
        self.assertEqual(headings, EXPERT_SUBSECTIONS)

    def test_the_loop_references_diagnoses_trials_measures_and_undoes(self):
        _in_order(self, self.subsections["The expert loop"],
                  ["atcs_ref", "atcs_paths", "atcs_fail_reasons", "atcs_gain", "atcs_undo"], "the expert loop")
        self.assertRegex(self.subsections["The expert loop"], r"(?i)budget")

    def test_a_targeted_fix_is_kept_not_trialled(self):
        # Task 7, real XTop: "The committed actions cannot be undone." after a fix flow.
        loop = self.subsections["Setup ladder"]
        self.assertIn("cannot be undone", loop)
        for word in ("atcs_fix_hold_pins", "atcs_fix_setup_pins", "sizeCellOnly", "insert_buffer", "split_net"):
            self.assertIn(word, loop)

    def test_domain_nets_are_xtop_names_not_primetime_names(self):
        # Task 7, real XTop: the pin's net was the module's local net, not PrimeTime's flattened name.
        applies = " ".join(self.sections["Applies when"].split())
        self.assertIn("`editDomain.nets` are XTop's names", applies)
        self.assertIn("block/local_net", applies)

    def test_the_ladders_run_in_expert_order(self):
        _in_order(self, self.subsections["Hold ladder"].lower(),
                  ["high-margin", "insertion", "create setup margin", "legalization", "transition", "atcs_split_load"], "the hold ladder")
        _in_order(self, self.subsections["Setup ladder"].lower(),
                  ["removing a redundant buffer", "topology", "split net", "paired repair", "hold insertion"], "the setup ladder")

    def test_every_pairing_names_a_target_and_its_opposite_margin(self):
        pairing = self.subsections["Target/margin pairing"]
        for words in (("holdTarget", "setupMargin"), ("setupTarget", "holdMargin")):
            for word in words:
                self.assertIn(word, pairing)

    def test_the_move_table_uses_only_xtop_fail_reason_names(self):
        table = self.subsections["Fail-reason to move table"]
        rows = [line for line in table.splitlines() if line.startswith("|") and not set(line) <= set("|- ")]
        self.assertGreater(len(rows), 8)
        cited = set()
        for row in rows[1:]:
            reasons = re.findall(r"`([a-z_]+)`", row.split("|")[1])
            self.assertTrue(reasons, f"row names no fail reason: {row}")
            cited.update(reasons)
        self.assertEqual(sorted(cited - XTOP_FAIL_REASONS), [], "the table names a fail reason XTop does not have")
        for reason in ("break_setup", "break_hold", "too_large_slack", "unable_fix_by_dummy_cell",
                       "legal_fail_no_space_on_row", "no_hold_gain", "no_setup_gain"):
            self.assertIn(reason, cited)

    def test_only_host_refusals_are_free(self):
        """Review fix round 1: a mutation the Host admits and the toolkit then refuses still spends one
        approved mutation of the Reviewer's budget; only a Host scope, hash or budget refusal is free."""
        loop = self.subsections["The expert loop"]
        self.assertNotRegex(loop, r"(?i)refused call[^.]*costs no budget")
        self.assertRegex(loop, r"(?i)host refus[^.]*(free|costs nothing)")
        self.assertRegex(loop, r"(?i)toolkit refus[^.]*costs one approved mutation")
        self.assertRegex(self.text, r"(?i)budget[^.]*trials[^.]*undo[^.]*refusals")

    def _row(self, reason):
        table = self.subsections["Fail-reason to move table"]
        rows = [line for line in table.splitlines() if line.startswith("|") and f"`{reason}`" in line.split("|")[1]]
        self.assertEqual(len(rows), 1, reason)
        return rows[0].split("|")[3].lower()

    def test_hold_specific_reasons_follow_the_pack_remedies(self):
        """Knowledge pack section 7: `too_weak_drive_strength` and `off_path_violated_pin` are
        hold-specific; the remedy is a buffer chain, a timing window or a targeted path, not sizing."""
        for reason in ("too_weak_drive_strength", "off_path_violated_pin"):
            move = self._row(reason)
            self.assertIn("chain", move, reason)
            self.assertIn("timing window", move, reason)
            self.assertNotIn("sizedownonly", move, reason)

    def test_collateral_reasons_raise_the_opposite_margin_first(self):
        self.assertIn("setupmargin", self._row("break_setup").split(";")[0])
        self.assertIn("holdmargin", self._row("break_hold").split(";")[0])

    def test_target_pins_are_instance_pins_not_ports(self):
        self.assertRegex(self.text, r"(?i)targetPins[^.]*instance pins[^.]*not[^.]*ports")

    def test_blockers_are_separated_from_the_bulk(self):
        blockers = self.subsections["Blockers vs bulk"].lower()
        self.assertIn("fail reason", blockers)
        self.assertIn("auto-finish", blockers)

    def test_every_toolkit_procedure_cites_its_man_page(self):
        for proc, pages in TOOLKIT_MAN_PAGES.items():
            self.assertIn(proc, self.text)
            for page in pages:
                self.assertIn(page, self.sections["Source"], f"{proc} man page {page} is not cited")

    def test_the_counterexample_is_global_high_effort_before_blockers(self):
        counter = self.sections["Counterexample"].lower()
        self.assertIn("high effort", counter)
        self.assertIn("round 2", counter)

    def test_the_session_is_a_probabilistic_trial_the_merge_ranks(self):
        self.assertRegex(self.text, r"(?i)probab")
        self.assertRegex(self.text, r"(?i)rank")

    def test_the_contract_declares_it_for_the_worker_workshops(self):
        contract = (PACK_ROOT / "contract.yml").read_text(encoding="utf-8")
        self.assertIn(f"  - file: {EXPERT_FILE}\n", contract)
        for slot in ("01", "02", "03"):
            block = contract.split(f"  - id: research-worker-{slot}\n", 1)[1].split("\n  - id: ", 1)[0]
            self.assertRegex(block, r"knowledge: \[[^\]]*xtop-expert-operator\.md")


if __name__ == "__main__":
    unittest.main()
