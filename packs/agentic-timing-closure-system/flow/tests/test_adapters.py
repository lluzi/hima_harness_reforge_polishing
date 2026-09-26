"""Tests for `atcs.adapters` (T12: tool adapters, task templates, CLI contract).

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_adapters.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v

No test here launches EDA or SSH: template compilation is checked as text
and (for the typed edit-domain gate) by sourcing the generated Tcl in a
plain `tclsh` with hand-written stubs standing in for the real XTop
commands -- never a real XTop/Innovus/StarRC/PrimeTime binary. Subcommand
I/O-contract tests drive `flow/atcs_cli.py` as a subprocess against a fake,
local wrapper script (never a real Site wrapper or SSH).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
FLOW_DIR = TESTS_DIR.parent
PACK_DIR = FLOW_DIR.parent
sys.path.insert(0, str(FLOW_DIR))
sys.path.insert(0, str(TESTS_DIR))

from atcs import core  # noqa: E402
from atcs import adapters  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
TEMPLATES_DIR = FLOW_DIR / "templates"
TCLSH = shutil.which("tclsh")


def _tmp():
    return Path(tempfile.mkdtemp(prefix="atcs-adapters-"))


# ---------------------------------------------------------------------------
# Step 1 requirement: no template references the frozen old Pack's real corpus path.
# ---------------------------------------------------------------------------


class NoDesignZooReferenceTest(unittest.TestCase):
    def test_no_template_references_design_zoo(self):
        template_files = sorted(TEMPLATES_DIR.glob("*"))
        self.assertTrue(template_files, "expected flow/templates/ to contain template files")
        for path in template_files:
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("/data/eda/project/design_zoo", text, f"{path} references design_zoo")

    def test_no_template_uses_the_undocumented_get_object_name(self):
        # Confirmed absent from both the XTop man tree and command_surface.tsv
        # (Task 12 fix round item 2) -- get_cells + foreach_in_collection +
        # get_attribute full_name/ref_name replace it. See
        # knowledge/xtop-capabilities.md for the citation. Only *code* lines
        # are checked -- a comment is allowed to name the banned command
        # while explaining why it must not be used (as this Pack's own
        # templates do).
        for path in sorted(TEMPLATES_DIR.glob("*.tcl")):
            code_lines = [line for line in path.read_text(encoding="utf-8").splitlines()
                          if not line.strip().startswith("#")]
            self.assertNotIn("get_object_name", "\n".join(code_lines),
                              f"{path} uses undocumented get_object_name")


# ---------------------------------------------------------------------------
# Step 1 requirement: PT scenario task compiles all four scenario names,
# max_paths/nworst and PBA mode exactly from query_spec.
# ---------------------------------------------------------------------------


def _scenario_inputs():
    return {
        scenario: {
            "design": "top", "netlist": "/ws/netlist.v", "sdc": "/ws/constraints.sdc",
            "spef": f"/ws/{scenario}.spef",
        }
        for scenario in adapters.REQUIRED_SCENARIOS
    }


class PtScenarioTaskTest(unittest.TestCase):
    def test_compiles_all_four_scenario_names(self):
        query_spec = {"precision": "gba", "requiredScenarios": list(adapters.REQUIRED_SCENARIOS), "maxPaths": 500}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
        self.assertEqual(set(tasks), set(adapters.REQUIRED_SCENARIOS))
        for scenario, task in tasks.items():
            self.assertEqual(task["scenario"], scenario)
            self.assertIn(f'set env(SCENARIO) "{scenario}"', task["tcl"])

    def test_max_paths_and_nworst_come_from_query_spec(self):
        query_spec = {"precision": "gba", "requiredScenarios": [], "maxPaths": 777, "nworst": 13}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
        for task in tasks.values():
            self.assertEqual(task["env"]["MAX_PATHS"], "777")
            self.assertEqual(task["env"]["NWORST"], "13")
            self.assertIn('set env(MAX_PATHS) "777"', task["tcl"])
            self.assertIn('set env(NWORST) "13"', task["tcl"])

    def test_nworst_defaults_when_query_spec_omits_it(self):
        query_spec = {"precision": "gba", "requiredScenarios": [], "maxPaths": 100}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
        for task in tasks.values():
            self.assertEqual(task["env"]["NWORST"], str(adapters.DEFAULT_NWORST))

    def test_pba_mode_reflects_query_spec_precision(self):
        for precision, expected in (("gba", "0"), ("pba", "1")):
            query_spec = {"precision": precision, "requiredScenarios": [], "maxPaths": 100}
            tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
            for task in tasks.values():
                self.assertEqual(task["env"]["PBA_MODE"], expected)

    def test_missing_required_scenario_is_refused(self):
        query_spec = {"precision": "gba", "requiredScenarios": [], "maxPaths": 100}
        inputs = _scenario_inputs()
        del inputs[adapters.REQUIRED_SCENARIOS[0]]
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_pt_scenario_tasks(query_spec, inputs, "/ws/reports")
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_invalid_precision_is_refused(self):
        query_spec = {"precision": "bogus", "requiredScenarios": [], "maxPaths": 100}
        with self.assertRaises(core.AtcsError):
            adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")


# ---------------------------------------------------------------------------
# Step 1 requirement: StarRC task writes into a new private work dir, never
# into the input's directory.
# ---------------------------------------------------------------------------


class StarrcTaskTest(unittest.TestCase):
    def test_work_dir_is_new_and_private_not_the_input_directory(self):
        task = adapters.compile_starrc_task("top", "rcworst_m40", "/campaign/implementations/m1a2b3c4d5e6f7a8b9c0/EXPORT/design.def",
                                             "/campaign/implementations/m1a2b3c4d5e6f7a8b9c0")
        work_dir = Path(task["workDir"])
        def_dir = Path("/campaign/implementations/m1a2b3c4d5e6f7a8b9c0/EXPORT")
        self.assertNotEqual(work_dir, def_dir)
        self.assertNotEqual(work_dir.resolve(), def_dir.resolve())
        self.assertTrue(str(work_dir).startswith("/campaign/implementations/m1a2b3c4d5e6f7a8b9c0/starrc/rcworst_m40"))
        self.assertIn("STAR_DIRECTORY: " + str(work_dir), task["cmdText"])
        self.assertIn("TOP_DEF_FILE: /campaign/implementations/m1a2b3c4d5e6f7a8b9c0/EXPORT/design.def", task["cmdText"])

    def test_refuses_when_work_dir_would_equal_def_directory(self):
        # A pathological base template whose own work dir happens to fall in the DEF's directory.
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_starrc_task(
                "top", "corner", "/ws/starrc/corner/work/design.def", "/ws",
            )
        self.assertEqual(ctx.exception.code, "invalid-workspace")

    def test_multiple_corners_each_get_their_own_work_dir(self):
        tasks = adapters.compile_starrc_tasks("top", ["rcworst_m40", "cbest_125"], "/ws/EXPORT/design.def", "/ws")
        self.assertEqual(set(tasks), {"rcworst_m40", "cbest_125"})
        self.assertNotEqual(tasks["rcworst_m40"]["workDir"], tasks["cbest_125"]["workDir"])

    def test_refuses_a_corner_that_would_escape_output_root(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_starrc_task("top", "../x", "/ws/EXPORT/design.def", "/ws")
        self.assertEqual(ctx.exception.code, "invalid-path-segment")

    def test_refuses_a_corner_containing_a_newline(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_starrc_task("top", "a\nb", "/ws/EXPORT/design.def", "/ws")
        self.assertEqual(ctx.exception.code, "invalid-path-segment")

    def test_refuses_a_design_that_would_escape_output_root(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_starrc_task("../x", "corner", "/ws/EXPORT/design.def", "/ws")
        self.assertEqual(ctx.exception.code, "invalid-path-segment")

    def test_refuses_work_dir_nested_several_levels_inside_the_def_directory(self):
        # `output_root` itself lands under the DEF's own directory, so the
        # computed work dir is nested (not just equal) inside it -- the
        # containment check must catch this, not only exact-path equality.
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_starrc_task(
                "top", "corner", "/ws/EXPORT/design.def", "/ws/EXPORT/nested/deeper",
            )
        self.assertEqual(ctx.exception.code, "invalid-workspace")

    def test_accepts_a_work_dir_genuinely_inside_output_root_and_outside_def_dir(self):
        task = adapters.compile_starrc_task("top", "corner", "/ws/EXPORT/design.def", "/ws/implementations/m1")
        self.assertTrue(Path(task["workDir"]).is_relative_to(Path("/ws/implementations/m1")))


class NoMutableCurrentDirectoryTest(unittest.TestCase):
    """Architecture Sec.13.4 (Task 12 fix round item 3): no implementation or
    integration artifact may live under a mutable directory named `current`
    -- every one lives under its own real `implementations/<mergeId>/` or
    `integrations/<batchId>/`."""

    def test_dispatcher_never_builds_a_current_directory_path(self):
        text = (FLOW_DIR / "atcs_cli.py").read_text(encoding="utf-8")
        code_lines = [line for line in text.splitlines() if not line.strip().startswith("#")]
        code_text = "\n".join(code_lines)
        self.assertNotIn('"implementations" / "current"', code_text)
        self.assertNotIn('"integrations" / "current"', code_text)
        self.assertNotIn("implementations/current", code_text)
        self.assertNotIn("integrations/current", code_text)


class PathSegmentValidatorTest(unittest.TestCase):
    def test_accepts_ordinary_identifiers(self):
        for value in ("rcworst_m40", "func_ssg_rcworst_m40", "top-design", "m1a2b3c4d5e6f7a8b9c0", "place"):
            self.assertEqual(adapters.validate_path_segment(value, "x"), value)

    def test_refuses_empty_or_non_string(self):
        for value in ("", None, 123, [], {}):
            with self.assertRaises(core.AtcsError) as ctx:
                adapters.validate_path_segment(value, "x")
            self.assertEqual(ctx.exception.code, "invalid-path-segment")

    def test_refuses_dot_and_dotdot(self):
        for value in (".", ".."):
            with self.assertRaises(core.AtcsError) as ctx:
                adapters.validate_path_segment(value, "x")
            self.assertEqual(ctx.exception.code, "invalid-path-segment")

    def test_refuses_path_traversal(self):
        for value in ("../x", "a/../b", "/etc/passwd", "a/b"):
            with self.assertRaises(core.AtcsError) as ctx:
                adapters.validate_path_segment(value, "x")
            self.assertEqual(ctx.exception.code, "invalid-path-segment")

    def test_refuses_newline_and_other_unsafe_characters(self):
        for value in ("a\nb", "a;b", "a$b", "a b"):
            with self.assertRaises(core.AtcsError) as ctx:
                adapters.validate_path_segment(value, "x")
            self.assertEqual(ctx.exception.code, "invalid-path-segment")


# ---------------------------------------------------------------------------
# Step 1 requirement: Innovus ECO task sources the merge commit's own
# innovusEcoTcl and exports DB/DEF/netlist under implementations/<mergeId>/.
# ---------------------------------------------------------------------------


class InnovusEcoTaskTest(unittest.TestCase):
    def test_sources_merge_commit_eco_tcl_and_exports_under_merge_id_root(self):
        merge_commit = core.stamp("merge-commit", {
            "parentStateId": "base123", "contributions": [], "operations": [],
            "innovusEcoTcl": "ecoChangeCell -inst {U1} -cell BUFFD4BWP\n", "sourceMap": {}, "newNets": [],
        })
        output_root = f"/campaign/implementations/{merge_commit['id']}"
        task = adapters.compile_innovus_eco_task(merge_commit, "/campaign/state/current.enc", "top", output_root)

        self.assertEqual(task["ecoText"], merge_commit["innovusEcoTcl"])
        self.assertTrue(task["ecoPath"].startswith(output_root))
        self.assertIn(f'set env(ECO_TCL) "{task["ecoPath"]}"', task["tcl"])
        self.assertIn("source $env(ECO_TCL)", adapters.load_template("innovus-eco.tcl"))
        for key in ("database", "def", "netlist", "drc", "connectivity"):
            self.assertTrue(task["outputs"][key].startswith(output_root),
                             f"{key} output {task['outputs'][key]} is not under {output_root}")
        self.assertTrue(task["outputs"]["database"].endswith("top.enc"))
        self.assertTrue(task["outputs"]["def"].endswith("design.def"))
        self.assertTrue(task["outputs"]["netlist"].endswith("design.v"))

    def test_refuses_a_merge_commit_with_no_eco_tcl(self):
        merge_commit = {"innovusEcoTcl": ""}
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_innovus_eco_task(merge_commit, "/campaign/state/current.enc", "top", "/campaign/implementations/x")
        self.assertEqual(ctx.exception.code, "missing-input")


# ---------------------------------------------------------------------------
# Step 1 requirement: xtop_operator argv carries the workspace-manifest
# namePrefix.
# ---------------------------------------------------------------------------


class XtopOperatorArgvTest(unittest.TestCase):
    def test_argv_carries_workspace_manifest_name_prefix(self):
        manifest = {"namePrefix": "atcs_w01_r3_"}
        task = adapters.compile_xtop_operator_task(
            manifest, "top", "/pdk/tech.lef", "/pdk/cells/*.lef", "/ws/netlist.v", "/ws/design.def", "/ws/run",
        )
        self.assertIn(manifest["namePrefix"], task["argv"])
        self.assertEqual(task["ecoPrefix"], manifest["namePrefix"] + "eco")

    def test_refuses_a_manifest_with_no_name_prefix(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_xtop_operator_task({}, "top", "lef", "glob", "net", "def", "/ws/run")
        self.assertEqual(ctx.exception.code, "missing-input")


# ---------------------------------------------------------------------------
# Step 1 requirement: typed procedures reject a target outside the
# edit-domain list passed at session start (real tclsh execution, XTop
# commands stubbed).
# ---------------------------------------------------------------------------


_STUB_PROCS = """
proc set_parameter {args} {}
proc create_workspace {args} {}
proc link_reference_library {args} {}
proc create_design_definition {args} {}
proc import_designs {args} {}
proc read_timing_data {args} {}
proc save_workspace {args} {}
proc get_attribute {obj attr} {
    if {$attr eq "full_name"} { return $obj }
    return "MASTERX"
}
proc size_cell {insts master} { set ::ATCS_TEST_LAST_CALL [list size_cell $insts $master] }
proc insert_buffer {args} { set ::ATCS_TEST_LAST_CALL [linsert $args 0 insert_buffer] }
proc remove_buffer {insts} { set ::ATCS_TEST_LAST_CALL [list remove_buffer $insts] }
# Documented XTop commands only (knowledge/xtop-capabilities.md): get_cells
# -hierarchical enumerates every cell; foreach_in_collection iterates; there
# is no get_object_name. "get_cells $i" (a single, already-known name) just
# re-wraps that name, matching get_attribute.1's own worked example.
proc get_cells {args} {
    if {[llength $args] == 1 && [lindex $args 0] eq "-hierarchical"} {
        return {U_IN_DOMAIN U_OUT_DOMAIN}
    }
    return [lindex $args 0]
}
proc foreach_in_collection {iter_var collection body} {
    upvar 1 $iter_var i
    foreach i $collection { uplevel 1 $body }
}
"""


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class TypedProcedureEditDomainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (self.tmp / name).write_text("stub", encoding="utf-8")
        self.run_root = self.tmp / "run"
        self.run_root.mkdir()
        self.ops_log = self.run_root / "ops.jsonl"

        manifest = {"namePrefix": "atcs_w01_r1_"}
        operator_task = adapters.compile_xtop_operator_task(
            manifest, "top", str(self.tmp / "tech.lef"), str(self.tmp / "cells.lef"),
            str(self.tmp / "netlist.v"), str(self.tmp / "design.def"), str(self.run_root),
        )
        self.operator_tcl_path = self.run_root / "operator.tcl"
        self.operator_tcl_path.write_text(operator_task["tcl"], encoding="utf-8")

        edit_domain = {"instances": ["U_IN_DOMAIN"], "nets": ["N_IN_DOMAIN"]}
        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, edit_domain, self.operator_tcl_path, self.ops_log,
        )
        self.script_path = self.tmp / "test-session.tcl"
        self.script_path.write_text(_STUB_PROCS + analysis_task["tcl"], encoding="utf-8")

    def _run_tcl(self, extra_commands):
        script = self.script_path.read_text(encoding="utf-8") + "\n" + extra_commands
        combined = self.tmp / "combined.tcl"
        combined.write_text(script, encoding="utf-8")
        return subprocess.run([TCLSH, str(combined)], capture_output=True, text=True)

    def test_rejects_size_cell_on_out_of_domain_instance(self):
        result = self._run_tcl('atcs_size_cell U_OUT_DOMAIN BUFFD4BWP\n')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("out-of-scope", result.stdout + result.stderr)
        self.assertFalse(self.ops_log.exists() and self.ops_log.read_text().strip(),
                          "an out-of-scope mutation must not be logged")

    def test_rejects_delete_buffer_on_out_of_domain_instance(self):
        result = self._run_tcl('atcs_delete_buffer U_OUT_DOMAIN\n')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("out-of-scope", result.stdout + result.stderr)

    def test_rejects_insert_buffer_on_out_of_domain_net(self):
        result = self._run_tcl('atcs_insert_buffer N_OUT_DOMAIN {P1 P2} U_NEW N_NEW BUFFD2BWP\n')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("out-of-scope", result.stdout + result.stderr)

    def test_accepts_size_cell_on_in_domain_instance_and_logs_one_operation(self):
        result = self._run_tcl('atcs_size_cell U_IN_DOMAIN BUFFD4BWP\nputs "TCL-OK"\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("TCL-OK", result.stdout)
        lines = [line for line in self.ops_log.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertEqual(len(lines), 1)
        op = json.loads(lines[0])
        self.assertEqual(op, {"op": "size_cell", "instance": "U_IN_DOMAIN", "fromMaster": "MASTERX", "toMaster": "BUFFD4BWP"})

    def test_accepts_insert_buffer_on_in_domain_net_and_logs_one_operation(self):
        result = self._run_tcl('atcs_insert_buffer N_IN_DOMAIN {P1 P2} U_NEW N_NEW BUFFD2BWP\nputs "TCL-OK"\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        lines = [line for line in self.ops_log.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertEqual(len(lines), 1)
        op = json.loads(lines[0])
        self.assertEqual(op["op"], "insert_buffer")
        self.assertEqual(op["net"], "N_IN_DOMAIN")
        self.assertEqual(op["loadPins"], ["P1", "P2"])
        self.assertEqual(op["newInstance"], "U_NEW")
        self.assertEqual(op["newNet"], "N_NEW")
        self.assertEqual(op["master"], "BUFFD2BWP")
        self.assertIsNone(op["location"])


# ---------------------------------------------------------------------------
# atcs_dump_cells writes the "instance master" dump M3 parses.
# ---------------------------------------------------------------------------


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class DumpCellsTest(unittest.TestCase):
    def test_dump_matches_the_instance_master_grammar_m3_parses(self):
        from atcs import contributions as contributions_module

        tmp = _tmp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (tmp / name).write_text("stub", encoding="utf-8")
        run_root = tmp / "run"
        run_root.mkdir()
        manifest = {"namePrefix": "atcs_w01_r1_"}
        operator_task = adapters.compile_xtop_operator_task(
            manifest, "top", str(tmp / "tech.lef"), str(tmp / "cells.lef"),
            str(tmp / "netlist.v"), str(tmp / "design.def"), str(run_root),
        )
        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, {"instances": [], "nets": []}, run_root / "operator.tcl", run_root / "ops.jsonl",
        )
        (run_root / "operator.tcl").write_text(operator_task["tcl"], encoding="utf-8")
        script_path = tmp / "dump-session.tcl"
        dump_path = tmp / "cells.dump"
        script_path.write_text(
            _STUB_PROCS + analysis_task["tcl"] + f'\natcs_dump_cells "{dump_path}"\n', encoding="utf-8",
        )
        result = subprocess.run([TCLSH, str(script_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        parsed = contributions_module.parse_cell_dump(dump_path.read_text(encoding="utf-8"))
        self.assertEqual(parsed, {"U_IN_DOMAIN": "MASTERX", "U_OUT_DOMAIN": "MASTERX"})


# ---------------------------------------------------------------------------
# `parse_path_detail` / `parse_spef_net_names` (bounded, best-effort helpers).
# ---------------------------------------------------------------------------


class ParsePathDetailTest(unittest.TestCase):
    def test_sums_cell_and_net_arcs_and_tracks_worst_transition_and_fanout(self):
        text = """  Point                                                   Fanout     Trans      Cap        Incr       Path
  ------------------------------------------------------------------------------------------------------------
  clock core_clock (rise edge)                                                              0.00       0.00
  U_FF_1/CP (DFQD1BWP)                                                                       0.00       0.00 r
  U_FF_1/Q (DFQD1BWP)                                          4    0.02      1.50    0.08       0.08 f
  net1 (net)                                                                                 0.10       0.18 f
  U_BUF/A (BUFFD2BWP)                                          1    0.03      0.80    0.05       0.23 f
  U_BUF/Z (BUFFD2BWP)                                                                        0.04       0.27 f
  net2 (net)                                                                                 0.02       0.29 f
  U_FF_2/D (DFQD1BWP)                                                                        0.00       0.29 f
  data arrival time                                                                                     0.29
"""
        detail = adapters.parse_path_detail(text)
        self.assertAlmostEqual(core.value_of(detail["cellDelay"]), 0.08 + 0.05 + 0.04, places=6)
        self.assertAlmostEqual(core.value_of(detail["netDelay"]), 0.10 + 0.02, places=6)
        self.assertAlmostEqual(core.value_of(detail["slew"]), 0.03, places=6)
        self.assertEqual(core.value_of(detail["fanout"]), 4)
        self.assertEqual(core.value_of(detail["location"]), "U_FF_2")

    def test_unparseable_text_yields_unknown_never_zero(self):
        detail = adapters.parse_path_detail("not a timing report at all\n")
        for measure in detail.values():
            self.assertFalse(core.is_known(measure))


class ParseSpefNetNamesTest(unittest.TestCase):
    def test_reads_d_net_records(self):
        text = "*D_NET n1 1.2\n...\n*D_NET n2 3.4\n"
        self.assertEqual(adapters.parse_spef_net_names(text), {"n1", "n2"})

    def test_none_when_unreadable(self):
        self.assertIsNone(adapters.parse_spef_net_names(None))


# ---------------------------------------------------------------------------
# `run_tool` and the CLI dispatcher's exit-code contract, driven against a
# fake local wrapper script (never real EDA/SSH).
# ---------------------------------------------------------------------------


class RunToolTest(unittest.TestCase):
    """`run_tool` joins `command` into one string and hands it to the Site
    wrapper as a single argv entry (`site_profile["edaShell"] + [shell_line
    (...)]`) -- exactly `closure.py`'s `run_eda` convention. A wrapper that
    itself runs an ssh+container command line ultimately re-interprets that
    one string through a remote shell; the fake wrapper here does the same
    locally (`sh -c "$1"`), never launching real EDA or SSH.
    """

    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.wrapper = self.tmp / "fake-wrapper.sh"
        self.wrapper.write_text('#!/bin/sh\nexec sh -c "$1"\n', encoding="utf-8")
        self.wrapper.chmod(0o755)

    def test_raises_adapter_tool_error_on_nonzero_exit(self):
        with self.assertRaises(adapters.AdapterToolError):
            adapters.run_tool({"edaShell": [str(self.wrapper)]}, ["false"], cwd=self.tmp, log_path=self.tmp / "log.txt")

    def test_raises_adapter_tool_error_on_error_marker_in_log(self):
        with self.assertRaises(adapters.AdapterToolError):
            adapters.run_tool({"edaShell": [str(self.wrapper)]}, ["sh", "-c", 'echo "ERROR: bad"'],
                               cwd=self.tmp, log_path=self.tmp / "log.txt")

    def test_succeeds_and_returns_the_log_path(self):
        log = adapters.run_tool({"edaShell": [str(self.wrapper)]}, ["echo", "hello"], cwd=self.tmp,
                                 log_path=self.tmp / "log.txt")
        self.assertIn("hello", Path(log).read_text())

    def test_missing_eda_shell_is_an_atcs_error(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.run_tool({}, ["true"], cwd=self.tmp, log_path=self.tmp / "log.txt")
        self.assertEqual(ctx.exception.code, "missing-input")


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")


class CliMissingInputExitCodeTest(unittest.TestCase):
    """Step 1 requirement: every subcommand refuses a missing declared input
    with exit code 2, a JSON error on stderr, and no output file."""

    # `compose-facts` is deliberately absent from this table: its own `plan`
    # arg is *optional* (a missing/absent path is the legitimate first-pass
    # case, Task 12c item 4c), so a "MISSING/..." value there would pass this
    # sweep for the wrong reason (the real, always-required missing input is
    # `state/working-state.json`, never read via this arg at all) -- see
    # `ComposeFactsMissingWorkingStateTest` below, which names the real cause
    # directly (Fix round 1 item 2).
    CASES = {
        "bind-inputs": ["MISSING/manifest.json", "MISSING/site.json"],
        "baseline": ["MISSING/manifest.json"],
        "risk": ["MISSING/prior.json", "MISSING/current.json", "MISSING/recheck.json"],
        "physical": ["MISSING/drc.rpt", "MISSING/connectivity.rpt", "baseline"],
        "evaluate": ["MISSING/policy.json"],
        "adopt": ["MISSING/policy.json"],
        "residual": ["MISSING/scenario-corners.json", "MISSING/site.json"],
        "apr-prepare": [],
        "apr-run": ["MISSING/site.json"],
        "policy": ["MISSING/analysis-contract-dir", "0.0", "0.0"],
        "record-experience": ["MISSING/reason.json"],
        "capture-contribution": ["w01"],
        "prepare-workers": ["MISSING/base.json", "MISSING/site.json", "MISSING/eda.json",
                             "MISSING/campaign-plan.json"],
        "reconcile": [],
        "presta": ["MISSING/base.json", "MISSING/corners.json", "MISSING/site.json"],
        "implement": ["MISSING/state.json", "MISSING/site.json"],
        "extract": ["MISSING/corners.json", "MISSING/site.json"],
        "sta": ["MISSING/query.json", "MISSING/sdc.json", "MISSING/corners.json", "MISSING/base.json", "MISSING/site.json"],
        "observe": ["MISSING/query.json", "MISSING/site.json", "MISSING/scenario-corners.json", "1000"],
        "replay-prepare": ["MISSING/base.json", "MISSING/plan.json", "MISSING/site.json"],
    }

    def test_every_subcommand_refuses_a_missing_declared_input(self):
        for subcommand, args in self.CASES.items():
            with self.subTest(subcommand=subcommand):
                workspace = _tmp()
                self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
                result = subprocess.run(
                    [sys.executable, str(CLI_PATH), subcommand, str(workspace)] + args,
                    capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 2, f"{subcommand}: stdout={result.stdout} stderr={result.stderr}")
                payload = json.loads(result.stderr)
                self.assertIn("code", payload)
                self.assertIn("detail", payload)
                self.assertFalse(any((workspace / "state").glob("**/*.json")),
                                  f"{subcommand} must not write any output on a missing input")

    def test_unknown_subcommand_is_exit_code_2(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        result = subprocess.run([sys.executable, str(CLI_PATH), "bogus-subcommand", str(workspace)],
                                 capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)


class ComposeFactsMissingWorkingStateTest(unittest.TestCase):
    """Fix round 1 item 2: `compose-facts`'s `plan` arg is optional (an absent path is the
    legitimate Task 12c item 4c first-pass case), so the missing-input sweep above cannot
    use it to exercise a real refusal. `state/working-state.json` is the subcommand's own
    always-required declared input; this asserts the refusal actually names it, not just
    that *some* exit-2 refusal happened for *some* reason."""

    def test_missing_working_state_is_refused_and_named(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        plan_path = workspace / "integration-plan.json"  # legitimately absent -- the first pass
        self.assertFalse(plan_path.exists())
        result = subprocess.run(
            [sys.executable, str(CLI_PATH), "compose-facts", str(workspace), str(plan_path)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 2, f"stdout={result.stdout} stderr={result.stderr}")
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "missing-input")
        self.assertIn("working-state.json", payload["detail"])
        self.assertFalse((workspace / "state").exists())


class CliBindInputsIntegrationTest(unittest.TestCase):
    """A minimal end-to-end pass for one non-EDA subcommand, exercising the
    real dispatcher process and the atomic single-output-file contract."""

    def test_bind_inputs_writes_exactly_the_declared_output(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        manifest_path = workspace / "in" / "manifest.json"
        site_path = workspace / "in" / "site.json"
        _write_json(manifest_path, {
            "top": "top", "stage": "postroute", "root": str(workspace),
            "database": {"enc": "db.enc", "encDat": "db.enc.dat"},
            "netlist": "netlist.v", "sdc": [], "scenarios": [],
        })
        _write_json(site_path, {"pgVerification": False})
        result = subprocess.run([sys.executable, str(CLI_PATH), "bind-inputs", str(workspace),
                                  str(manifest_path), str(site_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output_path = workspace / "state" / "readiness.json"
        self.assertTrue(output_path.is_file())
        body = json.loads(output_path.read_text())
        self.assertEqual(body["schema"], "atcs.input-readiness/1")


class CliExtractPathSegmentTest(unittest.TestCase):
    """`extract` validates every `corners` entry via `validate_path_segment`
    before touching the filesystem (Task 12 fix round item 1)."""

    def _run(self, corner):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        corners_path = workspace / "in" / "corners.json"
        _write_json(corners_path, {"corners": [corner]})
        result = subprocess.run(
            [sys.executable, str(CLI_PATH), "extract", str(workspace), str(corners_path), "MISSING/site.json"],
            capture_output=True, text=True,
        )
        return result

    def test_path_traversal_corner_is_refused(self):
        result = self._run("../x")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "invalid-path-segment")

    def test_newline_containing_corner_is_refused(self):
        result = self._run("a\nb")
        self.assertEqual(result.returncode, 3, result.stdout + result.stderr)
        payload = json.loads(result.stderr)
        self.assertEqual(payload["code"], "invalid-path-segment")


class CliCollectContributionIndexTest(unittest.TestCase):
    """`collect`'s output must match `tools/read-atcs.py`'s `contribution-index`
    read envelope exactly: partial completion is reported via `pending`,
    never a missing-input refusal (see `_cmd_collect`'s own docstring)."""

    def test_collect_succeeds_with_no_contributions_yet_and_reports_all_three_pending(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        result = subprocess.run([sys.executable, str(CLI_PATH), "collect", str(workspace)],
                                 capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        body = json.loads((workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(body["contributions"], [])
        self.assertEqual(sorted(entry["slot"] for entry in body["pending"]), ["w01", "w02", "w03"])
        self.assertTrue(all(entry.get("reason") for entry in body["pending"]))

    def test_collect_reports_one_pending_when_two_of_three_slots_sealed(self):
        from atcs import contributions as contributions_module

        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        workers = {}
        for slot, task_id in (("w01", "w01"), ("w02", "w02")):
            contribution = core.stamp("contribution", {
                "taskId": task_id, "revision": 1, "baseStateId": "base123", "kind": "no-fix",
                "operations": [], "script": None,
                "delta": {"mastersChanged": {}, "added": {}, "removed": {}},
                "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
                "preconditions": [], "dependencies": [], "atomicGroups": [],
                "predicted": {}, "validationLevel": "none", "diagnosis": "nothing to fix",
                "admissible": True, "refusals": [], "outOfScope": [], "beforeDumpSha256": "0" * 64,
            })
            _write_json(workspace / "state" / f"contribution-{slot}.json", contribution)
            # Item 6: `collect` only accepts a contribution matching the CURRENT
            # `state/workers.json[slot]` revision -- seed that same revision here.
            workers[slot] = {"workspaceManifest": {"revision": 1}}
        _write_json(workspace / "state" / "workers.json", {"workers": workers})
        result = subprocess.run([sys.executable, str(CLI_PATH), "collect", str(workspace)],
                                 capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        body = json.loads((workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(len(body["contributions"]), 2)
        self.assertEqual([entry["slot"] for entry in body["pending"]], ["w03"])
        del contributions_module  # imported only to document the shape's producer module


class CliCollectNoResurrectionTest(unittest.TestCase):
    """Task 12c item 6: `collect` never resurrects a previous batch's contribution.

    A slot's sealed `state/contribution-<slot>.json` is only collected when
    its own `revision` still matches `state/workers.json[slot]`'s CURRENT
    `workspaceManifest.revision` -- a contribution left over from an
    earlier `prepare-workers` revision (a new batch's work package for that
    slot has since been prepared) must be reported as `pending`, never
    silently re-collected into the new batch.
    """

    def test_stale_revision_contribution_is_pending_not_collected(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        stale_contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 1, "baseStateId": "base123", "kind": "no-fix",
            "operations": [], "script": None,
            "delta": {"mastersChanged": {}, "added": {}, "removed": {}},
            "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {}, "validationLevel": "none", "diagnosis": "from an earlier batch",
            "admissible": True, "refusals": [], "outOfScope": [], "beforeDumpSha256": "0" * 64,
        })
        _write_json(workspace / "state" / "contribution-w01.json", stale_contribution)
        # A new `prepare-workers` call has since produced revision 2 for this slot.
        _write_json(workspace / "state" / "workers.json", {
            "workers": {"w01": {"workspaceManifest": {"revision": 2}}},
        })

        result = subprocess.run([sys.executable, str(CLI_PATH), "collect", str(workspace)],
                                 capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        body = json.loads((workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(body["contributions"], [])
        pending_by_slot = {entry["slot"]: entry["reason"] for entry in body["pending"]}
        self.assertIn("w01", pending_by_slot)
        self.assertIn("revision", pending_by_slot["w01"])

    def test_current_revision_contribution_is_collected(self):
        """Sanity check: the same slot IS collected once its revision matches current."""
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        contribution = core.stamp("contribution", {
            "taskId": "w01", "revision": 2, "baseStateId": "base123", "kind": "no-fix",
            "operations": [], "script": None,
            "delta": {"mastersChanged": {}, "added": {}, "removed": {}},
            "touches": {"instances": [], "nets": [], "regions": [], "checks": [], "cones": []},
            "preconditions": [], "dependencies": [], "atomicGroups": [],
            "predicted": {}, "validationLevel": "none", "diagnosis": "this batch's own result",
            "admissible": True, "refusals": [], "outOfScope": [], "beforeDumpSha256": "0" * 64,
        })
        _write_json(workspace / "state" / "contribution-w01.json", contribution)
        _write_json(workspace / "state" / "workers.json", {
            "workers": {"w01": {"workspaceManifest": {"revision": 2}}},
        })

        result = subprocess.run([sys.executable, str(CLI_PATH), "collect", str(workspace)],
                                 capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        body = json.loads((workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(len(body["contributions"]), 1)
        self.assertEqual(body["contributions"][0]["id"], contribution["id"])


class CliPrestaEnvelopeTest(unittest.TestCase):
    """`presta`'s output is `verification.precheck_evidence`'s own stamped
    `precheck-evidence` artifact; the SPEF net-name source it points at must
    be plain text, one name per line -- exactly what `tools/read-atcs.py`'s
    `precheck-evidence` reader parses (`resolved.read_text(...)
    .splitlines()`), never JSON."""

    def test_precheck_evidence_over_a_plain_text_net_name_file(self):
        from atcs import verification

        tmp = _tmp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        merge_commit = core.stamp("merge-commit", {
            "parentStateId": "base123", "contributions": [], "operations": [],
            "innovusEcoTcl": "", "sourceMap": {}, "newNets": ["n_new_2", "n_new_1"],
        })
        spef_net_names = adapters.parse_spef_net_names("*D_NET n_new_1 1.0\n*D_NET n_existing 2.0\n")
        names_path = tmp / "spef-net-names.txt"
        names_path.write_text("\n".join(sorted(spef_net_names)) + "\n", encoding="utf-8")

        result = verification.precheck_evidence(merge_commit, str(names_path))
        self.assertEqual(result["schema"], "atcs.precheck-evidence/1")
        self.assertEqual(result["newNets"], ["n_new_1", "n_new_2"])
        self.assertEqual(result["spefNetNames"]["path"], str(names_path))
        self.assertEqual(result["spefNetNames"]["sha256"], core.file_sha256(names_path))

        # What the Reader does with that source: re-parse as plain lines and
        # recompute qualification independently.
        reread = {line.strip() for line in names_path.read_text(encoding="utf-8").splitlines() if line.strip()}
        qualification = verification.presta_qualification(result["newNets"], sorted(reread))
        self.assertEqual(qualification["unqualified"], ["n_new_2"])


if __name__ == "__main__":
    unittest.main()
