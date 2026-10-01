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
import fixtures  # noqa: E402

CLI_PATH = FLOW_DIR / "atcs_cli.py"
CORPUS_PREFLIGHT = PACK_DIR.parent.parent / "scripts" / "atcs-corpus-preflight.py"
TEMPLATES_DIR = FLOW_DIR / "templates"
TCLSH = shutil.which("tclsh")
SCENARIOS = ("slow_setup", "fast_hold")


def _tmp():
    return Path(tempfile.mkdtemp(prefix="atcs-adapters-"))


def _xtop_context(root=None):
    if root is None:
        library_tcl, sta_data = "/ws/xtop-library.tcl", "/ws/sta_data"
    else:
        library_path = Path(root) / "xtop-library.tcl"
        library_path.write_text("# synthetic XTop library context\n", encoding="utf-8")
        timing_path = Path(root) / "sta_data"
        timing_path.mkdir(exist_ok=True)
        (timing_path / "slow_setup_data_finish").write_text("done\n", encoding="utf-8")
        library_tcl, sta_data = str(library_path), str(timing_path)
    return {
        "libraryTcl": {"path": library_tcl}, "staData": {"path": sta_data},
        "siteMap": ["unit", "core"], "removableFillers": ["FILL*", "DCAP*"],
        "ecoParameters": {
            "bufferListForHold": ["DELAY1", "BUF2"], "bufferListForSetup": ["BUF2", "BUF4"],
            "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
            "cellNominalSwapKeywords": ["ULVT", "LVT", "", "HVT"],
            "cellNominalSizingPattern": "D([0-9]+)BWP", "gainThreshold": 0.001,
        },
    }


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

    def test_corpus_preflight_help_does_not_touch_the_real_corpus(self):
        result = subprocess.run([sys.executable, str(CORPUS_PREFLIGHT), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("usage:", result.stdout)
        self.assertNotIn("Foundation ROUND3", result.stdout)


# ---------------------------------------------------------------------------
# Step 1 requirement: PT scenario task compiles all four scenario names,
# max_paths/nworst and PBA mode exactly from query_spec.
# ---------------------------------------------------------------------------


def _scenario_inputs(scenarios=SCENARIOS):
    return {
        scenario: {
            "design": "top", "netlist": "/ws/netlist.v", "sdc": "/ws/constraints.sdc",
            "spef": f"/ws/{scenario}.spef",
        }
        for scenario in scenarios
    }


class HashLibraryGlobTest(unittest.TestCase):
    """C4 (final review, per-scenario library identity): `adapters.hash_library_glob`
    catches an unmatched Site `libGlob` in Python, before PT ever launches, with an
    informative error -- the same failure Tcl's own `lsort [glob -nocomplain ...]`
    check inside `pt-scenario.tcl`/`pt-presta.tcl` would otherwise only surface as an
    opaque PT `error`."""

    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_matches_are_hashed_and_sorted_by_path(self):
        (self.tmp / "b.db").write_bytes(b"b")
        (self.tmp / "a.db").write_bytes(b"a")
        result = adapters.hash_library_glob(str(self.tmp / "*.db"))
        self.assertEqual([entry["path"] for entry in result], [str(self.tmp / "a.db"), str(self.tmp / "b.db")])
        self.assertEqual(result[0]["sha256"], core.file_sha256(self.tmp / "a.db"))
        self.assertEqual(result[1]["sha256"], core.file_sha256(self.tmp / "b.db"))

    def test_no_match_is_a_missing_input_refusal(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.hash_library_glob(str(self.tmp / "nope-*.db"))
        self.assertEqual(ctx.exception.code, "missing-input")


class XtopSiteContextTest(unittest.TestCase):
    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for name in ("slow", "fast"):
            directory = self.tmp / name
            directory.mkdir()
            (directory / f"{name}.lib").write_text(f"library({name}) {{}}\n", encoding="utf-8")

    def _profile(self):
        runtime = _xtop_context()
        return {"xtopContext": {
            "siteMap": runtime["siteMap"], "removableFillers": runtime["removableFillers"],
            "scenarios": [
                {"name": "slow_setup", "corner": "slow", "libertyGlob": str(self.tmp / "slow" / "*.lib")},
                {"name": "fast_hold", "corner": "fast", "libertyGlob": str(self.tmp / "fast" / "*.lib")},
            ],
            "ecoParameters": runtime["ecoParameters"],
        }}

    def test_compiles_library_and_hashes_for_the_dynamic_scenario_set(self):
        context = adapters.compile_xtop_site_context(self._profile(), SCENARIOS)
        self.assertIn("create_scenario -corner slow -mode func slow_setup", context["libraryTcl"])
        self.assertEqual(set(context["libraryFiles"]), set(SCENARIOS))

    def test_mismatched_site_scenarios_are_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_xtop_site_context(self._profile(), ("slow_setup", "unexpected"))
        self.assertEqual(ctx.exception.code, "invalid-input")

    def test_missing_context_field_is_refused_before_task_compilation(self):
        context = _xtop_context()
        del context["staData"]
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_xtop_operator_task(
                {"namePrefix": "atcs_w01_r1_"}, "top", "tech.lef", "*.lef", "net.v", "design.def",
                "/ws/run", context,
            )
        self.assertEqual(ctx.exception.code, "missing-input")


class PtScenarioTaskTest(unittest.TestCase):
    def test_compiles_the_declared_scenario_names(self):
        query_spec = {"precision": "gba", "requiredScenarios": list(SCENARIOS), "maxPaths": 500}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
        self.assertEqual(tuple(tasks), SCENARIOS)
        for scenario, task in tasks.items():
            self.assertEqual(task["scenario"], scenario)
            self.assertIn(f'set env(SCENARIO) "{scenario}"', task["tcl"])

    def test_max_paths_and_nworst_come_from_query_spec(self):
        query_spec = {"precision": "gba", "requiredScenarios": list(SCENARIOS), "maxPaths": 777, "nworst": 13}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
        for task in tasks.values():
            self.assertEqual(task["env"]["MAX_PATHS"], "777")
            self.assertEqual(task["env"]["NWORST"], "13")
            self.assertIn('set env(MAX_PATHS) "777"', task["tcl"])
            self.assertIn('set env(NWORST) "13"', task["tcl"])

    def test_nworst_defaults_when_query_spec_omits_it(self):
        query_spec = {"precision": "gba", "requiredScenarios": list(SCENARIOS), "maxPaths": 100}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
        for task in tasks.values():
            self.assertEqual(task["env"]["NWORST"], str(adapters.DEFAULT_NWORST))

    def test_pba_mode_reflects_query_spec_precision(self):
        for precision, expected in (("gba", "0"), ("pba", "1")):
            query_spec = {"precision": precision, "requiredScenarios": list(SCENARIOS), "maxPaths": 100}
            tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")
            for task in tasks.values():
                self.assertEqual(task["env"]["PBA_MODE"], expected)

    def test_pba_precision_actually_runs_pba_mode_in_the_rendered_tcl(self):
        """Minor (final review): a `precision: pba` request must make
        report_timing/report_global_timing actually pass PT's own `-pba_mode` flag
        (verified read-only against the PT X-2025.06 man page: report_timing(2)/
        report_global_timing(2) both accept `-pba_mode none|path|exhaustive|
        ml_exhaustive`, default `none` == GBA) -- setting `PBA_MODE=1` in the
        environment alone (previously only consumed by the optional icexplorer
        STA_DATA export block) never actually ran PBA for the reports this Pack's own
        `state.capture` labels "precision: pba", which would have been a mismatched
        label. The template computes its own `-pba_mode` argument from `$env
        (PBA_MODE)` at Tcl runtime (`pba_mode_arg`), so the rendered Tcl text is the
        same either way -- this checks that computed argument is actually threaded
        into all three report calls, never silently dropped."""
        task = adapters.compile_pt_scenario_task(
            SCENARIOS[0],
            _scenario_inputs()[SCENARIOS[0]],
            "/ws/reports",
            {"precision": "pba", "requiredScenarios": list(SCENARIOS), "maxPaths": 100},
        )
        tcl = task["tcl"]
        self.assertIn("set pba_mode_arg none", tcl)
        self.assertIn("if {$env(PBA_MODE) == 1} { set pba_mode_arg path }", tcl)
        self.assertIn("report_global_timing -significant_digits 4 -pba_mode $pba_mode_arg", tcl)
        self.assertEqual(
            tcl.count("-pba_mode $pba_mode_arg"), 3, "setup.rpt/hold.rpt/global_timing.rpt each need it",
        )

    def test_missing_required_scenario_is_refused(self):
        query_spec = {"precision": "gba", "requiredScenarios": list(SCENARIOS), "maxPaths": 100}
        inputs = _scenario_inputs()
        del inputs[SCENARIOS[0]]
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_pt_scenario_tasks(query_spec, inputs, "/ws/reports")
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_invalid_precision_is_refused(self):
        query_spec = {"precision": "bogus", "requiredScenarios": list(SCENARIOS), "maxPaths": 100}
        with self.assertRaises(core.AtcsError):
            adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(), "/ws/reports")

    def test_a_second_site_scenario_set_uses_the_same_compiler(self):
        scenarios = ("mode_a_rcmax", "mode_b_rcmin", "scan_slow")
        query_spec = {"precision": "gba", "requiredScenarios": list(scenarios), "maxPaths": 100}
        tasks = adapters.compile_pt_scenario_tasks(query_spec, _scenario_inputs(scenarios), "/ws/reports")
        self.assertEqual(tuple(tasks), scenarios)

    def test_an_extra_site_scenario_is_refused(self):
        query_spec = {"precision": "gba", "requiredScenarios": list(SCENARIOS), "maxPaths": 100}
        inputs = _scenario_inputs(SCENARIOS + ("unexpected",))
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_pt_scenario_tasks(query_spec, inputs, "/ws/reports")
        self.assertEqual(ctx.exception.code, "missing-input")


class PtQueryTaskTest(unittest.TestCase):
    """N4 (final fix batch C): every `pt-query.tcl` target now carries its own
    `mode` (`setup`/`hold`), and `-delay_type max`/`min` is emitted per target
    from it -- PT's own `-delay_type` default (`max`) would otherwise silently
    report a hold check's setup-side slack. `pba` threads `PBA_MODE` the same
    way `compile_pt_scenario_task`'s own `query_spec["precision"]` does."""

    def _inputs(self):
        return {"design": "top", "netlist": "/ws/design.v", "sdc": "/ws/design.sdc", "spef": "/ws/corner.spef"}

    def test_setup_and_hold_targets_map_to_delay_type_max_and_min(self):
        targets = [
            {"checkKey": "s1|setup|EP1", "startpoint": "SP1", "endpoint": "EP1", "mode": "setup"},
            {"checkKey": "s1|hold|EP2", "startpoint": "SP2", "endpoint": "EP2", "mode": "hold"},
        ]
        task = adapters.compile_pt_query_task(self._inputs(), "/ws/reports", targets)
        tcl = task["tcl"]
        self.assertIn("{SP1 EP1 setup q000}", tcl)
        self.assertIn("{SP2 EP2 hold q001}", tcl)
        # The template's own mode->delay_type mapping (rendered verbatim; the
        # actual selection happens at Tcl runtime, but the mapping logic itself
        # must be present and correct in the compiled text).
        self.assertIn('if {$mode eq "setup"} {\n        set delay_type max', tcl)
        self.assertIn('} elseif {$mode eq "hold"} {\n        set delay_type min', tcl)
        self.assertIn("-delay_type $delay_type", tcl)

    def test_refuses_a_target_missing_mode(self):
        targets = [{"checkKey": "s1|setup|EP1", "startpoint": "SP1", "endpoint": "EP1"}]
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_pt_query_task(self._inputs(), "/ws/reports", targets)
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_refuses_an_invalid_mode(self):
        targets = [{"checkKey": "s1|bogus|EP1", "startpoint": "SP1", "endpoint": "EP1", "mode": "bogus"}]
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_pt_query_task(self._inputs(), "/ws/reports", targets)
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_pba_flag_only_set_when_requested(self):
        targets = [{"checkKey": "s1|setup|EP1", "startpoint": "SP1", "endpoint": "EP1", "mode": "setup"}]
        task = adapters.compile_pt_query_task(self._inputs(), "/ws/reports", targets)
        self.assertEqual(task["env"]["PBA_MODE"], "0")
        self.assertIn('set env(PBA_MODE) "0"', task["tcl"])

        task_pba = adapters.compile_pt_query_task(self._inputs(), "/ws/reports", targets, pba=True)
        self.assertEqual(task_pba["env"]["PBA_MODE"], "1")
        self.assertIn('set env(PBA_MODE) "1"', task_pba["tcl"])
        self.assertIn("-pba_mode $pba_mode_arg", task_pba["tcl"])


class PtPrestaTaskTest(unittest.TestCase):
    """C4 (final review): `pt-presta.tcl` never set `target_library`/`link_path` at
    all before this fix -- `link_design` for a real (non-fixture) netlist would have
    had no cell library to resolve references against. `compile_pt_presta_task`'s
    `inputs` gains the same optional `libGlob`/`driverLibrary`/`originalDriverLibrary`
    triple `compile_pt_scenario_task` already accepted."""

    def _inputs(self, **extra):
        return {
            "design": "top", "netlist": "/ws/design.v", "sdc": "/ws/design.sdc", "spef": "/ws/corner.spef",
            **extra,
        }

    def test_without_library_fields_the_env_carries_no_library_vars(self):
        task = adapters.compile_pt_presta_task("func_ssg_rcworst_m40", self._inputs(), "/ws/reports")
        self.assertNotIn("LIB_GLOB", task["env"])
        self.assertNotIn("DRIVER_LIBRARY", task["env"])
        self.assertNotIn('set env(LIB_GLOB)', task["tcl"])

    def test_with_library_fields_the_env_carries_them_and_the_tcl_links_a_library(self):
        inputs = self._inputs(
            libGlob="/foundation/libdb/ssg_m40c/*.db",
            driverLibrary="tcbn28...ssg0p81vm40c", originalDriverLibrary="tcbn28...typ0p9v25c",
        )
        task = adapters.compile_pt_presta_task("func_ssg_rcworst_m40", inputs, "/ws/reports")
        self.assertEqual(task["env"]["LIB_GLOB"], inputs["libGlob"])
        self.assertEqual(task["env"]["DRIVER_LIBRARY"], inputs["driverLibrary"])
        self.assertEqual(task["env"]["ORIGINAL_DRIVER_LIBRARY"], inputs["originalDriverLibrary"])
        self.assertIn("set_app_var target_library", task["tcl"])
        self.assertIn("info exists env(LIB_GLOB)", task["tcl"])

    def test_missing_a_required_input_is_refused(self):
        inputs = self._inputs()
        del inputs["spef"]
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_pt_presta_task("func_ssg_rcworst_m40", inputs, "/ws/reports")
        self.assertEqual(ctx.exception.code, "missing-input")


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

    def test_a_custom_per_corner_template_text_is_used_instead_of_the_shipped_fallback(self):
        """I1 (final review): a Site-provided StarRC command-file template
        (`corners.json`'s own per-corner `templatePath`) must actually be the text
        StarXtract runs against -- not this Pack's own single shipped `starrc.cmd`
        fallback, which real Foundation corners each need their own qualified
        version of (different STAR_MODE/layer-stack settings per corner)."""
        custom_template = (
            "STAR_MODE: RC_EXTRACT\n"
            "TOP_DEF_FILE: placeholder\n"
            "STAR_DIRECTORY: placeholder\n"
            "NETLIST_FILE: placeholder\n"
        )
        task = adapters.compile_starrc_task(
            "top", "cworst_T", "/ws/EXPORT/design.def", "/ws/implementations/m1", template_text=custom_template,
        )
        self.assertIn("STAR_MODE: RC_EXTRACT", task["cmdText"])
        self.assertIn("TOP_DEF_FILE: /ws/EXPORT/design.def", task["cmdText"])

    def test_omitting_template_text_falls_back_to_the_shipped_starrc_cmd(self):
        task = adapters.compile_starrc_task("top", "corner", "/ws/EXPORT/design.def", "/ws/implementations/m1")
        shipped = adapters.load_template("starrc.cmd")
        self.assertNotIn("STAR_MODE: RC_EXTRACT", shipped)

    def test_multiple_corners_each_use_their_own_template(self):
        """`compile_starrc_tasks`'s `templates` param maps corner -> base text -- two
        corners with genuinely different templates must render genuinely different
        command text, not both silently fall back to the one shipped default."""
        templates = {
            "cworst_T": "STAR_MODE: RC_WORST\nTOP_DEF_FILE: x\nSTAR_DIRECTORY: x\nNETLIST_FILE: x\n",
            "cbest": "STAR_MODE: RC_BEST\nTOP_DEF_FILE: x\nSTAR_DIRECTORY: x\nNETLIST_FILE: x\n",
        }
        tasks = adapters.compile_starrc_tasks(
            "top", ["cworst_T", "cbest"], "/ws/EXPORT/design.def", "/ws", templates=templates,
        )
        self.assertIn("STAR_MODE: RC_WORST", tasks["cworst_T"]["cmdText"])
        self.assertIn("STAR_MODE: RC_BEST", tasks["cbest"]["cmdText"])


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
            "innovusEcoTcl": "ecoChangeCell -inst {U1} -cell MOCKBUFX4\n", "sourceMap": {}, "newNets": [],
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

    def test_restores_the_staged_enc_dat_directory_with_the_top_cell(self):
        """Final review fix C, G29: `CURRENT_DB` is the `.enc` restore-script path
        (`design-state.database.path`), never the directory `restoreDesign` itself
        reads -- the real Foundation restore convention (read-only verified) is
        `restoreDesign <path>.enc.dat <topCell>`."""
        merge_commit = core.stamp("merge-commit", {
            "parentStateId": "base123", "contributions": [], "operations": [],
            "innovusEcoTcl": "ecoChangeCell -inst {U1} -cell MOCKBUFX4\n", "sourceMap": {}, "newNets": [],
        })
        output_root = f"/campaign/implementations/{merge_commit['id']}"
        task = adapters.compile_innovus_eco_task(merge_commit, "/campaign/state/current.enc", "top", output_root)
        self.assertIn("restoreDesign $env(CURRENT_DB).dat $env(DESIGN)", task["tcl"])
        self.assertNotIn("restoreDesign $env(CURRENT_DB) $env(DESIGN)", task["tcl"])


class InnovusExportTaskTest(unittest.TestCase):
    def test_restores_the_staged_enc_dat_directory_with_the_top_cell(self):
        """Final review fix C, G29: same restore convention as
        `compile_innovus_eco_task` -- see that test's own docstring."""
        task = adapters.compile_innovus_export_task("/campaign/DBS/top.enc", "swerv_wrapper", "/campaign/out")
        self.assertIn("restoreDesign $env(CURRENT_DB).dat $env(DESIGN)", task["tcl"])
        self.assertNotIn("restoreDesign $env(CURRENT_DB) $env(DESIGN)", task["tcl"])


# ---------------------------------------------------------------------------
# Step 1 requirement: xtop_operator argv carries the workspace-manifest
# namePrefix.
# ---------------------------------------------------------------------------


class XtopOperatorArgvTest(unittest.TestCase):
    def test_argv_carries_workspace_manifest_name_prefix(self):
        manifest = {"namePrefix": "atcs_w01_r3_"}
        task = adapters.compile_xtop_operator_task(
            manifest, "top", "/pdk/tech.lef", "/pdk/cells/*.lef", "/ws/netlist.v", "/ws/design.def", "/ws/run",
            _xtop_context(),
        )
        self.assertIn(manifest["namePrefix"], task["argv"])
        self.assertEqual(task["ecoPrefix"], manifest["namePrefix"] + "eco")
        self.assertIn('puts "HIMA:hima-tcl-line-v1:1:READY"', task["tcl"])
        self.assertNotIn('HIMA:hima-tcl-line-v1:1:READY:', task["tcl"])

    def test_refuses_a_manifest_with_no_name_prefix(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_xtop_operator_task({}, "top", "lef", "glob", "net", "def", "/ws/run", _xtop_context())
        self.assertEqual(ctx.exception.code, "missing-input")

    def test_worker_and_replay_share_legality_timing_and_eco_settings(self):
        context = _xtop_context()
        operator = adapters.compile_xtop_operator_task(
            {"namePrefix": "atcs_w01_r1_"}, "top", "tech.lef", "*.lef", "net.v", "design.def",
            "/ws/operator", context,
        )
        replay = adapters.compile_xtop_replay_task(
            "top", "tech.lef", "*.lef", "net.v", "design.def", [], "/ws/replay", context,
        )
        for token in (
            "set_site_map $::XTOP_SITE_MAP", "set_removable_fillers $::XTOP_REMOVABLE_FILLERS",
            "check_placement_readiness", "source $env(LIBRARY_TCL)",
            "read_timing_data -data_dir $env(STA_DATA)", "eco_buffer_list_for_hold",
            "eco_buffer_list_for_setup", "eco_cell_nominal_sizing_pattern", "eco_gain_threshold",
        ):
            self.assertIn(token, operator["tcl"])
            self.assertIn(token, replay["tcl"])


# ---------------------------------------------------------------------------
# Session-setup stubs for tests that source a compiled XTop template in tclsh.
# The typed toolkit's edit-domain, budget, trace and undo behaviour is covered
# by `test_xtop_toolkit.py` (Issue #64 Task 3).
# ---------------------------------------------------------------------------


_STUB_PROCS = """
proc set_parameter {args} {}
proc create_workspace {args} {}
proc link_reference_library {args} {}
proc create_design_definition {args} {}
proc set_site_map {args} {}
proc set_removable_fillers {args} {}
proc import_designs {args} {}
proc check_placement_readiness {args} {}
proc read_timing_data {args} {}
proc check_inst_reference_library {args} {}
proc check_inst_timing_library {args} {}
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
            str(tmp / "netlist.v"), str(tmp / "design.def"), str(run_root), _xtop_context(tmp),
        )
        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, {"instances": [], "nets": []}, run_root / "operator.tcl", run_root / "ops.jsonl",
            max_mutations=1,
        )
        (run_root / "operator.tcl").write_text(operator_task["tcl"], encoding="utf-8")
        script_path = tmp / "dump-session.tcl"
        # #64 D-T03-2: the typed dump writes only before.dump or after.dump, always in the slot root.
        dump_path = run_root / "before.dump"
        script_path.write_text(
            _STUB_PROCS + analysis_task["tcl"] + f'\natcs_dump_cells "{tmp / "elsewhere" / "before.dump"}"\n', encoding="utf-8",
        )
        result = subprocess.run([TCLSH, str(script_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        parsed = contributions_module.parse_cell_dump(dump_path.read_text(encoding="utf-8"))
        self.assertEqual(parsed, {"U_IN_DOMAIN": "MASTERX", "U_OUT_DOMAIN": "MASTERX"})


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class DumpNameConfinementTest(unittest.TestCase):
    """#64 D-T03-2: an Operator that named its dumps w04-before.dump left capture nothing to seal. The
    typed dump states the two names capture seals and refuses any other, before writing anything; the
    replay's own dumps go through atcs_write_cell_dump, which no typed command reaches."""

    def test_any_other_name_is_refused_naming_the_two(self):
        tmp = _tmp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (tmp / name).write_text("stub", encoding="utf-8")
        run_root = tmp / "run"
        run_root.mkdir()
        manifest = {"namePrefix": "atcs_w04_r1_"}
        operator_task = adapters.compile_xtop_operator_task(
            manifest, "top", str(tmp / "tech.lef"), str(tmp / "cells.lef"),
            str(tmp / "netlist.v"), str(tmp / "design.def"), str(run_root), _xtop_context(tmp),
        )
        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, {"instances": [], "nets": []}, run_root / "operator.tcl", run_root / "ops.jsonl", max_mutations=1,
        )
        (run_root / "operator.tcl").write_text(operator_task["tcl"], encoding="utf-8")
        script_path = tmp / "dump-names.tcl"
        script_path.write_text(_STUB_PROCS + analysis_task["tcl"]
                               + '\nputs [catch {atcs_dump_cells w04-before.dump} message]\nputs $message\n', encoding="utf-8")
        result = subprocess.run([TCLSH, str(script_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("1\natcs_dump_cells writes only before.dump or after.dump", result.stdout)
        self.assertFalse((run_root / "w04-before.dump").exists())
        self.assertFalse((tmp / "w04-before.dump").exists())
        self.assertIn("atcs_write_cell_dump", (PACK_DIR / "flow" / "templates" / "xtop-replay.tcl").read_text(encoding="utf-8"))


class XtopReplayWorkspaceTest(unittest.TestCase):
    """I3 (final review): `xtop-replay.tcl` builds its own fresh XTop workspace from
    the batch's own base-state LEF/netlist/DEF -- never `open_workspace` on an
    Innovus `.enc` restore script."""

    def test_never_calls_open_workspace(self):
        task = adapters.compile_xtop_replay_task(
            "top", "/pdk/tech.lef", "/pdk/cells/*.lef", "/ws/netlist.v", "/ws/design.def", [], "/ws/run",
            _xtop_context(),
        )
        code_lines = [line for line in task["tcl"].splitlines() if not line.strip().startswith("#")]
        self.assertFalse(any("open_workspace" in line for line in code_lines), task["tcl"])
        self.assertIn("create_workspace", task["tcl"])
        self.assertIn("link_reference_library", task["tcl"])
        self.assertIn("create_design_definition", task["tcl"])

    def test_env_carries_lef_and_design_inputs_not_a_current_db(self):
        task = adapters.compile_xtop_replay_task(
            "top", "/pdk/tech.lef", "/pdk/cells/*.lef", "/ws/netlist.v", "/ws/design.def", [], "/ws/run",
            _xtop_context(),
        )
        self.assertEqual(task["env"]["TECH_LEF"], "/pdk/tech.lef")
        self.assertEqual(task["env"]["CELL_LEF_GLOB"], "/pdk/cells/*.lef")
        self.assertEqual(task["env"]["NETLIST"], "/ws/netlist.v")
        self.assertEqual(task["env"]["DEF"], "/ws/design.def")
        self.assertNotIn("CURRENT_DB", task["env"])


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class XtopReplayEndToEndTest(unittest.TestCase):
    """Real `tclsh` execution (documented XTop commands stubbed): confirms the
    compiled `xtop-replay.tcl` actually builds a workspace and replays a step,
    never just that its text happens to contain the right substrings."""

    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (self.tmp / name).write_text("stub", encoding="utf-8")
        self.run_root = self.tmp / "run"
        self.run_root.mkdir()

    def _compile_and_write(self, steps):
        task = adapters.compile_xtop_replay_task(
            "top", str(self.tmp / "tech.lef"), str(self.tmp / "cells.lef"),
            str(self.tmp / "netlist.v"), str(self.tmp / "design.def"), steps, str(self.run_root),
            _xtop_context(self.tmp),
        )
        Path(task["stepsPath"]).write_text(task["stepsText"], encoding="utf-8")
        script_path = self.tmp / "replay-session.tcl"
        script_path.write_text(_STUB_PROCS + task["tcl"], encoding="utf-8")
        return task, script_path

    def test_a_successful_step_produces_an_ok_receipt_and_two_dumps(self):
        steps = [{"stepId": "s1", "op": {"op": "size_cell", "instance": "U_IN_DOMAIN", "toMaster": "MOCKBUFX4"}}]
        task, script_path = self._compile_and_write(steps)
        result = subprocess.run([TCLSH, str(script_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipts = adapters.read_replay_receipts(task["receiptsLog"])
        self.assertEqual(len(receipts), 1)
        self.assertEqual(receipts[0]["stepId"], "s1")
        self.assertEqual(receipts[0]["status"], "ok")
        self.assertTrue((Path(task["dumpDir"]) / "000.dump").is_file())
        self.assertTrue((Path(task["dumpDir"]) / "001.dump").is_file())

    def test_a_failing_step_is_recorded_and_the_replay_continues(self):
        """Best effort (replay is an aggregator): the failing step gets an `error` receipt, the state
        after it is dumped, and the next step still runs."""
        steps = [{"stepId": "s1", "op": {"op": "size_cell", "instance": "U_BAD", "toMaster": "MOCKBUFX4"}},
                 {"stepId": "s2", "op": {"op": "size_cell", "instance": "U_IN_DOMAIN", "toMaster": "MOCKBUFX4"}}]
        task, script_path = self._compile_and_write(steps)
        failing = ('proc size_cell {insts master} {\n'
                   '    if {$insts eq "U_BAD"} { error "stub refused U_BAD" }\n'
                   '    set ::ATCS_TEST_LAST_CALL [list size_cell $insts $master]\n}\n')
        text = script_path.read_text(encoding="utf-8")
        script_path.write_text(text.replace(_STUB_PROCS, _STUB_PROCS + failing, 1), encoding="utf-8")
        result = subprocess.run([TCLSH, str(script_path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        rows = [json.loads(line) for line in Path(task["receiptsLog"]).read_text().splitlines()]
        self.assertEqual([(row["stepId"], row["status"]) for row in rows], [("s1", "error"), ("s2", "ok")])
        self.assertIn("stub refused U_BAD", rows[0]["error"])
        receipts = adapters.read_replay_receipts(task["receiptsLog"])
        self.assertEqual([receipt["status"] for receipt in receipts], ["error", "ok"])
        for index in (0, 1, 2):
            self.assertTrue((Path(task["dumpDir"]) / f"{index:03d}.dump").is_file(), index)

    def test_a_missing_required_input_refuses_before_any_workspace_command(self):
        # DEF file does not exist -- must fail on the `file readable` check, never
        # silently proceed to `create_workspace`.
        (self.tmp / "design.def").unlink()
        task, script_path = self._compile_and_write([])
        result = subprocess.run([TCLSH, str(script_path)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("not readable", result.stdout + result.stderr)


# ---------------------------------------------------------------------------
# Issue #64 Task 6: the generation's one replay -- the ranked expert recipe
# through the toolkit procedures, protection, auto-finish, one ECO pair, and a
# concurrent plain auto-fix control arm -- and the Innovus ECO-pair implement.
# ---------------------------------------------------------------------------

from atcs import integration as integration_module  # noqa: E402

RECIPE_PLAN_A = "a" * 64
RECIPE_PLAN_B = "b" * 64
RECIPE_SCENARIOS = ["s1", "s2"]


def _recipe_command(seq, proc, args, instances, skip=None):
    return {"seq": seq, "proc": proc, "cmd": proc[len("atcs_"):], "args": args, "instances": instances,
            "skip": skip}


def _recipe_request(batch_id="b1", auto_finish=True, extra_w02=()):
    """Two ranked sessions over the toolkit's stub design (test_xtop_toolkit.STUB_XTOP):
    w01 resizes U1 (applied), resizes U2 to its own master (the toolkit refuses it) and
    splits N2 (XTop fails it); w02 inserts a buffer on N1 (applied) and carries one
    command the composition skipped, then tries to resize w01's U2 (outside its own domain)."""
    recipe = {"sessions": [
        {"rank": 1, "contribution": "c1", "taskId": "w01", "commands": [
            _recipe_command(1, "atcs_size_cell",
                            {"instance": "U1", "toMaster": "BUFX2", "planSha256": RECIPE_PLAN_A}, ["U1"]),
            _recipe_command(2, "atcs_size_cell",
                            {"instance": "U2", "toMaster": "INVX1", "planSha256": RECIPE_PLAN_A}, ["U2"]),
            _recipe_command(3, "atcs_split_net", {"net": "N2", "master": "BUFX2", "rule": "wire_length",
                                                  "segments": 2, "planSha256": RECIPE_PLAN_A}, []),
        ]},
        {"rank": 2, "contribution": "c2", "taskId": "w02", "commands": [
            _recipe_command(1, "atcs_insert_buffer", {
                "net": "N1", "loadPins": ["U3/A"], "masters": ["BUFX2"], "newInstances": ["atcs_w02_r1_b1"],
                "newNets": ["atcs_w02_r1_n1"], "planSha256": RECIPE_PLAN_B}, ["atcs_w02_r1_b1"]),
            _recipe_command(2, "atcs_size_cell",
                            {"instance": "U1", "toMaster": "BUFX4", "planSha256": RECIPE_PLAN_B}, ["U1"],
                            skip="shared-instance"),
            _recipe_command(3, "atcs_size_cell",
                            {"instance": "U2", "toMaster": "INVX2", "planSha256": RECIPE_PLAN_B}, ["U2"]),
            *extra_w02,
        ]},
    ], "excluded": []}
    sessions = {
        "w01": {"contributionId": "c1", "revision": 1, "namePrefix": "atcs_w01_r1_",
                "editDomain": {"instances": ["U1", "U2"], "nets": ["N2"], "regions": [[0, 0, 50, 50]]},
                "targetPins": ["U9/D"],
                "delta": {"mastersChanged": {"U1": ["BUFX1", "BUFX2"]}, "added": {}, "removed": {}}},
        "w02": {"contributionId": "c2", "revision": 1, "namePrefix": "atcs_w02_r1_",
                "editDomain": {"instances": ["U3"], "nets": ["N1"], "regions": []}, "targetPins": [],
                "delta": {"mastersChanged": {}, "added": {"atcs_w02_r1_b1": "BUFX2"}, "removed": {}}},
    }
    plan = {"batchId": batch_id, "baseStateId": "base-1", "reason": "blockers first", "autoFinish": auto_finish}
    return integration_module.prepare_recipe_replay(plan, "base-1", recipe, sessions,
                                                    required_scenarios=RECIPE_SCENARIOS, removable_fillers=["FILL*"])


def _summary_table(check, rows):
    """`summarize_gba_violations -exclude_path` in the real XTop layout (notes/real-summarize-sample.txt)."""
    lines = [f"### {check} summary ###", "Scenario                  Count      Worst        TNS", "-" * 54,
             f"total                 {sum(r[0] for r in rows.values()):>10} "
             f"{min(r[1] for r in rows.values()):>10.4f} {sum(r[2] for r in rows.values()):>10.4f}"]
    for name, (count, worst, tns) in rows.items():
        lines.append(f"  {name:<24}{count:>6} {worst:>10.4f} {tns:>10.4f}")
    return "\n".join(lines)


# Additions to the toolkit's stub XTop for a replay: dont-touch, `redirect -file`,
# the final per-scenario summaries, and an ECO pair from write_design_changes.
REPLAY_STUB = r"""
set ::stub_dont_touch {}
proc set_dont_touch {args} {
    stub_record set_dont_touch {*}$args
    set ::stub_dont_touch [stub_names [lindex $args 0]]
    return 1
}
proc redirect {args} {
    if {[lindex $args 0] eq "-file"} {
        stub_record redirect -file
        set code [catch {uplevel #0 [lindex $args 2]} r]
        set fh [open [lindex $args 1] w]
        puts $fh $r
        close $fh
        if {$code} { error $r }
        return ""
    }
    stub_record redirect {*}[lrange $args 0 end-1]
    set target [lindex $args end-1]
    set code [catch {uplevel #0 [lindex $args end]} r]
    upvar #0 $target captured
    set captured "captured: $r\n"
    if {$code} { error $r }
    return ""
}
# The probe tables in real XTop's layout (live_session_samples.LIVE_PROBE_SETUP): one endpoint row per reason.
set ::stub_fail_reasons_setup "### setup top 4 endpoints ###\n  Slack    Scenario                Name       Fail Reason      \n------------------------------------------------------------\n-0.0100    func_ss                 U0/D      no_setup_gain:100%\n-0.0100    func_ss                 U1/D      no_setup_gain:100%\n-0.0100    func_ss                 U2/D      no_setup_gain:100%\n-0.0100    func_ss                 U3/D      legal_fail_no_space_on_row:100%\n"
set ::stub_fail_reasons_hold "### hold top 7 endpoints ###\n  Slack    Scenario                Name       Fail Reason      \n------------------------------------------------------------\n-0.0100    func_ss                 U0/D      break_setup:100%\n-0.0100    func_ss                 U1/D      break_setup:100%\n-0.0100    func_ss                 U2/D      no_hold_gain:100%\n-0.0100    func_ss                 U3/D      no_hold_gain:100%\n-0.0100    func_ss                 U4/D      no_hold_gain:100%\n-0.0100    func_ss                 U5/D      no_hold_gain:100%\n-0.0100    func_ss                 U6/D      no_hold_gain:100%\n"
proc summarize_gba_violations {args} {
    stub_record summarize_gba_violations {*}$args
    if {[lsearch -exact $args -with_fail_reason] >= 0} {
        # Real XTop (Task 7, #64 Q1 both arms' xtop-replay.log): fail reasons belong to the last fix flow's check.
        if {[lsearch -exact $args -$::stub_fix_ran] < 0} {
            puts "Error: Last flow is '${::stub_fix_ran}_gba', mismatched with current summary."
            error ""
        }
        if {[lsearch -exact $args -setup] >= 0} { return $::stub_fail_reasons_setup }
        return $::stub_fail_reasons_hold
    }
    if {[lsearch -exact $args -exclude_path] >= 0} {
        if {[lsearch -exact $args -setup] >= 0} { return $::stub_summary_setup }
        return $::stub_summary_hold
    }
    return "WNS \"delta\"\t-0.010 for $args"
}
proc write_design_changes {args} {
    stub_record write_design_changes {*}$args
    lassign [stub_opts {-format -eco_file_prefix -output_dir} $args] o pos
    foreach kind {netlist physical} {
        set fh [open [file join [stub_one $o -output_dir] "[stub_one $o -eco_file_prefix]_${kind}_top.txt"] w]
        puts $fh [set ::stub_eco_$kind]
        close $fh
    }
    return ""
}
set ::stub_eco_netlist "ecoChangeCell -inst U1 -cell BUFX2"
set ::stub_eco_physical "placeInstance U1 1.0 2.0 R0"
"""


class RecipeReplayTaskTest(unittest.TestCase):
    def setUp(self):
        self.request = _recipe_request()
        self.task = adapters.compile_recipe_replay_task(
            "top", "/pdk/tech.lef", "/pdk/cells/*.lef", "/ws/netlist.v", "/ws/design.def", self.request,
            "/ws/integrations/b1", _xtop_context(),
        )

    def test_each_arm_is_the_worker_session_setup_and_toolkit_then_the_replay(self):
        for arm in ("merged", "control"):
            tcl = self.task["arms"][arm]["tcl"]
            self.assertIn("proc atcs_size_cell {instance to_master plan_sha256}", tcl)
            self.assertIn("read_timing_data -data_dir $env(STA_DATA)", tcl)
            self.assertLess(tcl.index("proc atcs_mutate"), tcl.index("source $env(RECIPE_TCL)"))
            self.assertIn(f"set ::ATCS_ARM {{{arm}}}", tcl)
            self.assertEqual(self.task["arms"][arm]["root"], f"/ws/integrations/b1/{arm}")
            self.assertEqual(self.task["arms"][arm]["env"]["RUN_ROOT"], f"/ws/integrations/b1/{arm}")

    def test_the_toolkit_domain_is_set_per_session_never_a_union(self):
        for arm in ("merged", "control"):
            self.assertIn("set ::EDIT_DOMAIN_INSTANCES {}", self.task["arms"][arm]["tcl"])
        self.assertIn("set ::ATCS_MAX_MUTATIONS {5}", self.task["arms"]["merged"]["tcl"])
        self.assertIn("set ::ATCS_MAX_MUTATIONS {1}", self.task["arms"]["control"]["tcl"])

    def test_the_merged_recipe_runs_sessions_in_rank_order_each_ending_in_its_dump(self):
        steps = self.request["steps"]
        text = self.task["arms"]["merged"]["recipeText"]
        self.assertEqual(text.splitlines(), [
            "atcs_replay_session {w01} {atcs_w01_r1_} {U1 U2} {N2} {U9/D} {0 0 50 50}",
            f"atcs_replay_step {{{steps[0]['stepId']}}} 0 {{atcs_size_cell {{U1}} {{BUFX2}} {{{RECIPE_PLAN_A}}}}}",
            f"atcs_replay_step {{{steps[1]['stepId']}}} 0 {{atcs_size_cell {{U2}} {{INVX1}} {{{RECIPE_PLAN_A}}}}}",
            f"atcs_replay_step {{{steps[2]['stepId']}}} 0 {{atcs_split_net {{N2}} {{BUFX2}} {{wire_length}} 2 "
            f"{{{RECIPE_PLAN_A}}}}}",
            "atcs_replay_session_end 1",
            "atcs_replay_session {w02} {atcs_w02_r1_} {U3} {N1} {} {}",
            f"atcs_replay_step {{{steps[3]['stepId']}}} 0 {{atcs_insert_buffer {{N1}} {{{{U3/A}}}} {{{{BUFX2}}}} "
            f"{{{{atcs_w02_r1_b1}}}} {{{{atcs_w02_r1_n1}}}} {{{RECIPE_PLAN_B}}}}}",
            f"atcs_replay_step {{{steps[4]['stepId']}}} 1 {{}}",
            f"atcs_replay_step {{{steps[5]['stepId']}}} 0 {{atcs_size_cell {{U2}} {{INVX2}} {{{RECIPE_PLAN_B}}}}}",
            "atcs_replay_session_end 2",
        ])
        self.assertEqual(self.task["arms"]["control"]["recipeText"], "")

    def test_each_arm_carries_its_own_auto_fix(self):
        self.assertEqual(self.task["arms"]["merged"]["autoFixText"].splitlines(), self.request["autoFinishTcl"])
        self.assertEqual(self.task["arms"]["control"]["autoFixText"].splitlines(), self.request["controlTcl"])
        request = _recipe_request(auto_finish=False)
        task = adapters.compile_recipe_replay_task("top", "t", "c", "n", "d", request, "/ws/i/b1", _xtop_context())
        self.assertEqual(task["arms"]["merged"]["autoFixText"], "")
        self.assertEqual(task["arms"]["control"]["autoFixText"].splitlines(), request["controlTcl"])

    def test_the_template_exports_one_innovus_pair_per_arm_with_keep_route(self):
        text = adapters.load_template("xtop-replay.tcl")
        self.assertIn("write_design_changes -format INNOVUS -eco_file_prefix atcs_batch -output_dir eco -keep_route",
                      text)
        self.assertIn(
            "write_design_changes -format INNOVUS -eco_file_prefix atcs_batch -output_dir eco-control -keep_route",
            text)
        self.assertIn("{summarize_gba_violations -exclude_path -setup}", text)
        self.assertIn("{summarize_gba_violations -exclude_path -hold}", text)
        self.assertIn("set_dont_touch [get_cells -exact $protected] true", text)

    def test_every_xtop_option_the_replay_body_emits_is_on_the_knowledge_packs_surface(self):
        from test_xtop_toolkit import XTOP_SURFACE
        # `set_dont_touch object_list [value]` is a man-only row of command_surface.tsv (no options).
        surface = dict(XTOP_SURFACE, set_dont_touch=set())
        text = adapters.load_template("xtop-replay.tcl")
        lines = [line for line in text.splitlines() if not line.strip().startswith("#")]
        import re
        for command in ("write_design_changes", "summarize_gba_violations", "redirect", "set_dont_touch"):
            for line in lines:
                for match in re.finditer(rf"\b{command}\b([^\[\]}}\n]*)", line):
                    options = set(re.findall(r"(?<![\w$])-([a-z_]+)", match.group(1)))
                    self.assertLessEqual(options, surface[command], line)
        for line in self.request["autoFinishTcl"] + self.request["controlTcl"]:
            command, *words = line.split()
            options = {word[1:] for word in words if word.startswith("-") and not word[1:2].isdigit()}
            self.assertLessEqual(options, surface[command], line)

    def test_a_legacy_request_is_refused(self):
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.compile_recipe_replay_task("top", "t", "c", "n", "d", {"steps": []}, "/ws/i/b1",
                                                _xtop_context())
        self.assertEqual(ctx.exception.code, "identity-mismatch")


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class RecipeReplayTclshTest(unittest.TestCase):
    """Both arms run to completion in `tclsh` over the toolkit's stub XTop, then the Pack
    reads them back, reconciles, chooses and seals -- the real Tcl, never a text match."""

    def setUp(self):
        from test_xtop_toolkit import STUB_XTOP  # the Task 3 toolkit's in-memory XTop
        self.stub = STUB_XTOP + REPLAY_STUB
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (self.tmp / name).write_text("stub", encoding="utf-8")
        self.request = _recipe_request()
        self.output_root = self.tmp / "integrations" / "b1"
        self.task = adapters.compile_recipe_replay_task(
            "top", str(self.tmp / "tech.lef"), str(self.tmp / "cells.lef"), str(self.tmp / "netlist.v"),
            str(self.tmp / "design.def"), self.request, str(self.output_root), _xtop_context(self.tmp),
        )

    def _run_arm(self, arm, setup_rows, hold_rows, fix_effect, extra=""):
        arm_task = self.task["arms"][arm]
        root = Path(arm_task["root"])
        root.mkdir(parents=True, exist_ok=True)
        Path(arm_task["recipePath"]).write_text(arm_task["recipeText"], encoding="utf-8")
        Path(arm_task["autoFixPath"]).write_text(arm_task["autoFixText"], encoding="utf-8")
        calls = root / "calls.txt"
        preamble = (
            f'set env(STUB_CALLS) "{calls}"\n' + self.stub
            + f"set ::stub_summary_setup {{{_summary_table('setup', setup_rows)}}}\n"
            + f"set ::stub_summary_hold {{{_summary_table('hold', hold_rows)}}}\n"
            + f"set ::stub_fix_effect {{{fix_effect}}}\nset ::stub_fail {{split_net}}\n" + extra
        )
        script = root / "run.tcl"
        script.write_text(preamble + arm_task["tcl"], encoding="utf-8")
        result = subprocess.run([TCLSH, str(script)], capture_output=True, text=True, cwd=str(root))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.arm_output = {**getattr(self, "arm_output", {}), arm: result.stdout + result.stderr}
        words = [line.split("\x1f") for line in calls.read_text(encoding="utf-8").splitlines()]
        return words

    def _run_both(self, merged_rows, control_rows, merged_fix="UOUT BUFX4", control_fix="UOUT BUFX8"):
        merged = self._run_arm("merged", *merged_rows, merged_fix)
        control = self._run_arm("control", *control_rows, control_fix)
        arms = {arm: adapters.read_replay_arm(self.task["arms"][arm]["root"], arm, self.request, self.tmp)
                for arm in ("merged", "control")}
        return merged, control, arms

    EVEN = ({"s1": (1, -0.02, -0.02), "s2": (0, 0.0, 0.0)}, {"s1": (0, 0.0, 0.0), "s2": (2, -0.05, -0.08)})
    BETTER = ({"s1": (0, 0.0, 0.0), "s2": (0, 0.0, 0.0)}, {"s1": (0, 0.0, 0.0), "s2": (1, -0.01, -0.01)})

    def test_merged_replays_protects_auto_finishes_and_exports_in_order(self):
        merged, _, arms = self._run_both(self.EVEN, self.EVEN)
        commands = [words[0] for words in merged]
        first = {name: commands.index(name) for name in
                 ("size_cell", "insert_buffer", "set_dont_touch", "fix_hold_gba_violations",
                  "fix_setup_gba_violations", "write_design_changes")}
        self.assertLess(first["size_cell"], first["insert_buffer"])
        self.assertLess(first["insert_buffer"], first["set_dont_touch"])
        self.assertLess(first["set_dont_touch"], first["fix_setup_gba_violations"])
        self.assertLess(first["fix_setup_gba_violations"], first["fix_hold_gba_violations"])
        self.assertLess(first["fix_hold_gba_violations"], first["write_design_changes"])
        auto = [words for words in merged if words[0] in ("fix_hold_gba_violations", "fix_setup_gba_violations")]
        self.assertEqual([" ".join(words) for words in auto], self.request["autoFinishTcl"])
        dont_touch = next(words for words in merged if words[0] == "set_dont_touch")
        self.assertEqual(dont_touch[-1], "true")
        self.assertEqual(arms["merged"]["result"]["protected"], ["U1", "atcs_w02_r1_b1"])
        export = next(words for words in merged if words[0] == "write_design_changes")
        self.assertEqual(export[1:], ["-format", "INNOVUS", "-eco_file_prefix", "atcs_batch", "-output_dir", "eco",
                                      "-keep_route"])
        dumps = Path(self.task["arms"]["merged"]["dumpDir"])
        self.assertEqual(sorted(p.name for p in dumps.iterdir()), ["000.dump", "001.dump", "002.dump", "auto.dump"])

    def test_both_arms_record_fail_reasons_after_auto_fix_and_the_chosen_arms_are_sealed(self):
        """US10/US34: the reasons XTop could not fix what is left after auto-finish, read back from both
        arms, and the chosen arm's sealed with the batch. XTop keeps them for the last fix flow's check
        only (auto-finish ends with a hold pass): D-Q1-6 (#64 Q1) reads that check alone, so the replay log
        holds no "Error:" line, and the other check is recorded unread with why."""
        merged, control, arms = self._run_both(self.EVEN, self.EVEN)
        for words in (merged, control):
            commands = [" ".join(w) for w in words]
            last_fix = max(i for i, w in enumerate(words)
                           if w[0] in ("fix_hold_gba_violations", "fix_setup_gba_violations"))
            self.assertEqual(words[last_fix][0], "fix_hold_gba_violations")
            export = next(i for i, w in enumerate(words) if w[0] == "write_design_changes")
            line = "summarize_gba_violations -exclude_path -with_top_n 20 -with_fail_reason -hold"
            self.assertIn(line, commands)
            self.assertLess(last_fix, commands.index(line))
            self.assertLess(commands.index(line), export)
            self.assertNotIn("summarize_gba_violations -exclude_path -with_top_n 20 -with_fail_reason -setup", commands)
        expected = {"hold": {"break_setup": 2, "no_hold_gain": 5}}
        for arm in ("merged", "control"):
            self.assertEqual(arms[arm]["result"]["failReasons"]["hold"], 0)
            self.assertIn("last fix flow's check only (hold_gba)", arms[arm]["result"]["failReasons"]["setup"])
            self.assertNotIn("Error:", self.arm_output[arm], "the replay log a Site wrapper scans holds no error line")
        state = integration_module.reconcile_recipe(self.request, arms)
        for arm in ("merged", "control"):
            self.assertEqual(state["arms"][arm]["failReasons"], expected)
            self.assertEqual(state["arms"][arm]["failReasonsUnread"], ["setup"])
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["failReasons"], {"arm": "merged", **expected, "unread": ["setup"]})
        merge = integration_module.seal_batch(state, self.request, {"baseStateId": "base-1"}, [
            {"id": "c1", "revision": 1}, {"id": "c2", "revision": 3}])
        self.assertEqual(merge["failReasons"], {"arm": "merged", **expected, "unread": ["setup"]})

    def test_skipped_commands_are_recorded_and_the_replay_continues(self):
        _, _, arms = self._run_both(self.EVEN, self.EVEN)
        receipts = {row["stepId"]: row for row in arms["merged"]["receipts"]}
        steps = self.request["steps"]
        self.assertEqual(receipts[steps[0]["stepId"]]["status"], "applied")
        self.assertEqual(receipts[steps[1]["stepId"]]["status"], "skipped")
        self.assertIn("already INVX1", receipts[steps[1]["stepId"]]["reason"])
        self.assertEqual(receipts[steps[2]["stepId"]]["status"], "skipped")
        self.assertIn("split_net failed", receipts[steps[2]["stepId"]]["reason"])
        self.assertEqual(receipts[steps[3]["stepId"]]["status"], "applied")
        self.assertEqual(receipts[steps[4]["stepId"]], {"stepId": steps[4]["stepId"], "slot": "w02",
                                                        "status": "skipped", "attempted": False, "reason": "recipe"})
        # A later session never edits an earlier session's instance: its own domain only.
        self.assertEqual(receipts[steps[5]["stepId"]]["status"], "skipped")
        self.assertIn("out-of-scope instance: U2", receipts[steps[5]["stepId"]]["reason"])
        state = integration_module.reconcile_recipe(self.request, arms)
        self.assertEqual(state["sessions"]["w01"]["applied"], [steps[0]["stepId"]])
        self.assertEqual([s["stepId"] for s in state["sessions"]["w01"]["skipped"]],
                         [steps[1]["stepId"], steps[2]["stepId"]])
        self.assertTrue(state["sessions"]["w01"]["deltaMatches"])
        self.assertTrue(state["sessions"]["w02"]["deltaMatches"])
        self.assertEqual(state["sessions"]["w02"]["skipped"][0]["reason"], "recipe:shared-instance")

    def test_the_expert_nets_of_kept_commands_are_read_back(self):
        _, _, arms = self._run_both(self.EVEN, self.EVEN)
        self.assertEqual(arms["merged"]["keptInstanceNets"], {"atcs_w02_r1_b1": ["atcs_w02_r1_n1"]})
        self.assertEqual(arms["control"]["keptInstanceNets"], {})

    def test_a_changed_instance_that_no_longer_exists_is_not_protected_and_is_recorded(self):
        self.request = _recipe_request(extra_w02=[_recipe_command(
            4, "atcs_remove_buffer", {"instance": "atcs_w02_r1_b1", "planSha256": RECIPE_PLAN_B},
            ["atcs_w02_r1_b1"])])
        self.task = adapters.compile_recipe_replay_task(
            "top", str(self.tmp / "tech.lef"), str(self.tmp / "cells.lef"), str(self.tmp / "netlist.v"),
            str(self.tmp / "design.def"), self.request, str(self.output_root), _xtop_context(self.tmp),
        )
        merged = self._run_arm("merged", *self.EVEN, "UOUT BUFX4")
        dont_touch = next(words for words in merged if words[0] == "set_dont_touch")
        self.assertEqual(dont_touch[1:], ["cell:U1", "true"])
        result = json.loads(Path(self.task["arms"]["merged"]["armResult"]).read_text())
        self.assertEqual(result["protected"], ["U1"])
        self.assertEqual(result["protectMissing"], ["atcs_w02_r1_b1"])
        self.assertEqual(result["protectCode"], 0)

    def test_control_runs_plain_auto_fix_only_into_eco_control(self):
        _, control, arms = self._run_both(self.EVEN, self.EVEN)
        names = [words[0] for words in control]
        for absent in ("size_cell", "insert_buffer", "split_net", "set_dont_touch"):
            self.assertNotIn(absent, names)
        auto = [" ".join(words) for words in control
                if words[0] in ("fix_hold_gba_violations", "fix_setup_gba_violations")]
        self.assertEqual(auto, self.request["controlTcl"])
        export = next(words for words in control if words[0] == "write_design_changes")
        self.assertIn("eco-control", export)
        self.assertEqual(len(arms["control"]["eco"]["netlist"]), 1)
        self.assertTrue(arms["control"]["eco"]["netlist"][0]["path"].endswith(
            "integrations/b1/control/eco-control/atcs_batch_netlist_top.txt"))
        self.assertEqual(arms["control"]["autoDelta"]["mastersChanged"], {"UOUT": ["BUFX1", "BUFX8"]})

    def test_control_is_chosen_when_it_predicts_better_and_sealed_with_both_predictions(self):
        _, _, arms = self._run_both(self.EVEN, self.BETTER)
        state = integration_module.reconcile_recipe(self.request, arms)
        self.assertEqual(state["chosen"]["arm"], "control")
        merge = integration_module.seal_batch(state, self.request, {"baseStateId": "base-1"}, [])
        self.assertEqual(merge["choice"]["arm"], "control")
        self.assertEqual(merge["eco"]["netlist"]["path"],
                         "integrations/b1/control/eco-control/atcs_batch_netlist_top.txt")
        self.assertEqual(merge["eco"]["netlist"]["sha256"],
                         core.file_sha256(self.tmp / merge["eco"]["netlist"]["path"]))
        self.assertEqual(merge["arms"]["merged"]["prediction"]["worstHoldWns"], -0.05)
        self.assertEqual(merge["arms"]["control"]["prediction"]["worstHoldWns"], -0.01)

    def test_merged_is_chosen_on_a_tie(self):
        _, _, arms = self._run_both(self.EVEN, self.EVEN)
        state = integration_module.reconcile_recipe(self.request, arms)
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertEqual(state["chosen"]["eco"]["physical"]["path"],
                         "integrations/b1/merged/eco/atcs_batch_physical_top.txt")

    def test_auto_finish_changing_a_protected_instance_is_recorded(self):
        _, _, arms = self._run_both(self.EVEN, self.EVEN, merged_fix="U1 BUFX8")
        state = integration_module.reconcile_recipe(self.request, arms)
        self.assertEqual(state["protectedChanged"], ["U1"])

    def test_an_unsafe_merged_pair_falls_back_to_a_safe_control(self):
        self._run_arm("merged", *self.BETTER, "UOUT BUFX4",
                      extra='set ::stub_eco_netlist "FORMATVERSION 2"\n')
        self._run_arm("control", *self.EVEN, "UOUT BUFX8")
        arms = {arm: adapters.read_replay_arm(self.task["arms"][arm]["root"], arm, self.request, self.tmp)
                for arm in ("merged", "control")}
        state = integration_module.reconcile_recipe(self.request, arms)
        self.assertEqual(state["chosen"]["arm"], "control")
        self.assertIn("FORMATVERSION", state["chosen"]["reason"])

    def test_a_control_arm_that_never_ran_does_not_fail_the_merged_arm(self):
        self._run_arm("merged", *self.EVEN, "UOUT BUFX4")
        arms = {arm: adapters.read_replay_arm(self.task["arms"][arm]["root"], arm, self.request, self.tmp)
                for arm in ("merged", "control")}
        self.assertIsNone(arms["control"]["result"])
        state = integration_module.reconcile_recipe(self.request, arms)
        self.assertEqual(state["chosen"]["arm"], "merged")
        self.assertFalse(state["arms"]["control"]["safe"])


class InnovusEcoPairTaskTest(unittest.TestCase):
    PAIR = {"netlist": {"path": "integrations/b1/merged/eco/atcs_batch_netlist_top.txt", "sha256": "1" * 64},
            "physical": {"path": "integrations/b1/merged/eco/atcs_batch_physical_top.txt", "sha256": "2" * 64}}

    def test_without_an_eco_pair_the_task_is_byte_identical_to_before(self):
        merge_commit = core.stamp("merge-commit", {
            "parentStateId": "base123", "contributions": [], "operations": [],
            "innovusEcoTcl": "ecoChangeCell -inst {U1} -cell MOCKBUFX4\n", "sourceMap": {}, "newNets": [],
        })
        task = adapters.compile_innovus_eco_task(merge_commit, "/campaign/state/current.enc", "top",
                                                 "/campaign/implementations/m1")
        import hashlib
        self.assertEqual(hashlib.sha256(task["tcl"].encode("utf-8")).hexdigest(),
                         "baa34fba6ee006ef873b4c69d405e19ee9caac876a4f3895fcac111d28b67f50")
        self.assertEqual(sorted(task), ["command", "ecoPath", "ecoText", "env", "outputs", "tcl"])

    def test_an_eco_pair_is_sourced_netlist_then_physical_then_routed(self):
        task = adapters.compile_innovus_eco_task({"eco": self.PAIR}, "/campaign/state/current.enc", "top",
                                                 "/campaign/implementations/m1", eco_root="/campaign")
        tcl = task["tcl"]
        order = ["restoreDesign $env(CURRENT_DB).dat $env(DESIGN)", "source $env(NETLIST_ECO)",
                 "source $env(PHYSICAL_ECO)",
                 "setNanoRouteMode -routeWithEco true -routeWithTimingDriven false -routeWithSiDriven false "
                 "-drouteUseMultiCutViaEffort high",
                 "ecoRoute", "saveDesign $env(OUTPUT_ROOT)/DBS/$env(DESIGN).enc -compress"]
        positions = [tcl.index(line) for line in order]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(task["ecoCopies"], [
            {"role": "netlist", "from": "/campaign/integrations/b1/merged/eco/atcs_batch_netlist_top.txt",
             "to": "/campaign/implementations/m1/eco/netlist.tcl", "sha256": "1" * 64},
            {"role": "physical", "from": "/campaign/integrations/b1/merged/eco/atcs_batch_physical_top.txt",
             "to": "/campaign/implementations/m1/eco/physical.tcl", "sha256": "2" * 64},
        ])
        self.assertEqual(task["env"]["NETLIST_ECO"], "/campaign/implementations/m1/eco/netlist.tcl")
        self.assertEqual(set(task["outputs"]), {"database", "def", "netlist", "drc", "connectivity"})
        self.assertNotIn("ecoText", task)

    def test_a_relative_pair_without_a_root_or_a_malformed_hash_is_missing_input(self):
        for eco, root in ((self.PAIR, None), ({"netlist": self.PAIR["netlist"]}, "/c"),
                          ({"netlist": self.PAIR["netlist"], "physical": {"path": "x", "sha256": "ZZ"}}, "/c")):
            with self.subTest(eco=eco, root=root):
                with self.assertRaises(core.AtcsError) as ctx:
                    adapters.compile_innovus_eco_task({"eco": eco}, "/c/db.enc", "top", "/c/i/m1", eco_root=root)
                self.assertEqual(ctx.exception.code, "missing-input")

    @unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
    def test_the_pair_template_runs_in_order_under_a_stub_innovus(self):
        tmp = _tmp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        task = adapters.compile_innovus_eco_task({"eco": self.PAIR}, str(tmp / "db.enc"), "top",
                                                 str(tmp / "impl"), eco_root=str(tmp))
        log = tmp / "calls.txt"
        (tmp / "impl" / "eco").mkdir(parents=True)
        Path(task["ecoCopies"][0]["to"]).write_text("record netlist-eco\n", encoding="utf-8")
        Path(task["ecoCopies"][1]["to"]).write_text("record physical-eco\n", encoding="utf-8")
        stub = f'proc record {{args}} {{ set fh [open "{log}" a]; puts $fh [join $args " "]; close $fh }}\n'
        for name in ("restoreDesign", "setNanoRouteMode", "ecoRoute", "verify_drc", "verifyConnectivity",
                     "saveDesign", "defOut", "saveNetlist"):
            stub += f"proc {name} {{args}} {{ record {name} }}\n"
        script = tmp / "run.tcl"
        script.write_text(stub + task["tcl"], encoding="utf-8")
        result = subprocess.run([TCLSH, str(script)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(log.read_text(encoding="utf-8").splitlines()[:5],
                         ["restoreDesign", "netlist-eco", "physical-eco", "setNanoRouteMode", "ecoRoute"])


# ---------------------------------------------------------------------------
# `parse_path_detail` / `parse_spef_net_names` (bounded, best-effort helpers).
# ---------------------------------------------------------------------------


class ParsePathDetailTest(unittest.TestCase):
    """Grammar cross-checked against a real Foundation ROUND3 ``setup.rpt``
    sample (Task 16, ``docs/assessment/2026-09-26/atcs-qualification/
    corpus-preflight.md``) via `fixtures.path_detail_report`. Every
    cell/instance/net name is invented; the shape (wrapped long names, the
    stray ``&`` annotation, fanout/cap-only net rows) is real.
    """

    def test_sums_cell_and_net_arcs_from_wrapped_long_names(self):
        text = fixtures.path_detail_report(
            [
                (
                    "mock_block/mock_leaf_ff_stage1/A", "mock_block/mock_leaf_ff_stage1/Z",
                    "MOCKBUFX2", 0.02, 0.08, 0.01, 0.05, "n_mock_1", 4, 1.50,
                ),
                (
                    "mock_block/mock_leaf_ff_stage2/A", "mock_block/mock_leaf_ff_stage2/Z",
                    "MOCKINVX1", 0.03, 0.10, 0.02, 0.04, "n_mock_2", 1, 0.80,
                ),
            ],
            tail_net_fanout=2,
        )
        detail = adapters.parse_path_detail(text)
        # Each stage's *input*-pin Incr is that net's delay; its *output*-pin
        # Incr is the cell's own delay -- see module docstring's net/cell
        # alternation rule.
        self.assertAlmostEqual(core.value_of(detail["netDelay"]), 0.08 + 0.10, places=6)
        self.assertAlmostEqual(core.value_of(detail["cellDelay"]), 0.05 + 0.04, places=6)
        self.assertAlmostEqual(core.value_of(detail["slew"]), 0.03, places=6)
        self.assertEqual(core.value_of(detail["fanout"]), 4)  # worst fanout across every net row (stage1's, not the smaller tail net's)
        self.assertEqual(core.value_of(detail["location"]), "mock_block/mock_leaf_ff_stage2")

    def test_terminal_net_without_cap_does_not_corrupt_delay_totals(self):
        # Regression: a fanout-only net line (the shape a path's very last,
        # off-chip net has) must never be misread as a delay value.
        text = fixtures.path_detail_report(
            [("mock_a/A", "mock_a/Z", "MOCKAOI21X1", 0.01, 0.02, 0.01, 0.03, "n_mock", 5, 0.20)],
            tail_net_fanout=9,
        )
        detail = adapters.parse_path_detail(text)
        self.assertAlmostEqual(core.value_of(detail["netDelay"]), 0.02, places=6)
        self.assertAlmostEqual(core.value_of(detail["cellDelay"]), 0.03, places=6)
        self.assertEqual(core.value_of(detail["fanout"]), 9)

    def test_short_name_and_values_sharing_one_line_with_annotation(self):
        # A short name (e.g. a top-level port) fits its values on the same
        # physical line; the "&" annotation between Incr and Path must not
        # break the match.
        text = (
            "  Point                       Fanout    Cap      Trans       Incr       Path\n"
            "  -----------------------------------------------------------------------------\n"
            "  mock_clk (in)                                   0.04       0.02 &     0.02 r\n"
            "  data arrival time                                                     0.02\n"
        )
        detail = adapters.parse_path_detail(text)
        self.assertAlmostEqual(core.value_of(detail["netDelay"]), 0.02, places=6)
        self.assertFalse(core.is_known(detail["cellDelay"]))  # only one pin arc: net-delay role, no cell arc at all
        self.assertAlmostEqual(core.value_of(detail["slew"]), 0.04, places=6)
        self.assertEqual(core.value_of(detail["location"]), "mock_clk")

    def test_unparseable_text_yields_unknown_never_zero(self):
        detail = adapters.parse_path_detail("not a timing report at all\n")
        for measure in detail.values():
            self.assertFalse(core.is_known(measure))


class ParseQuerySlackTest(unittest.TestCase):
    """`adapters.parse_query_slack` -- I5 (final review): the single targeted path's own
    slack Measure from one `pt-query.tcl` report, MET or VIOLATED, fed to
    `atcs.state.compare_checks`'s own `recheck` parameter."""

    def test_met_verdict_is_a_known_non_negative_slack(self):
        text = "  slack (MET)                       0.12\n"
        self.assertEqual(adapters.parse_query_slack(text), core.known(0.12))

    def test_violated_verdict_is_a_known_negative_slack(self):
        text = "  slack (VIOLATED)                  -0.05\n"
        self.assertEqual(adapters.parse_query_slack(text), core.known(-0.05))

    def test_precision_limited_violated_row_is_unknown_never_a_bare_zero(self):
        text = "  slack (VIOLATED: increase significant digits) -0.00\n"
        measure = adapters.parse_query_slack(text)
        self.assertFalse(core.is_known(measure))

    def test_precision_limited_met_row_is_also_unknown(self):
        text = "  slack (MET: increase significant digits)      0.00\n"
        measure = adapters.parse_query_slack(text)
        self.assertFalse(core.is_known(measure))

    def test_no_slack_line_is_unknown(self):
        measure = adapters.parse_query_slack("not a timing report at all\n")
        self.assertFalse(core.is_known(measure))


class ParseSpefNetNamesTest(unittest.TestCase):
    """Grammar cross-checked against a real Foundation ROUND3 StarRC
    ``.spef`` sample (Task 16, ``docs/assessment/2026-09-26/atcs-
    qualification/corpus-preflight.md``). Every index and name is invented.
    """

    def test_resolves_name_map_index_aliases(self):
        text = fixtures.spef_net_name_map_and_d_nets(
            {1001: "mock_net_a", 1002: "mock_net_b[3]"},
            [(1001, 12.34), (1002, 5.6)],
        )
        self.assertEqual(adapters.parse_spef_net_names(text), {"mock_net_a", "mock_net_b[3]"})

    def test_literal_d_net_name_used_directly_when_not_index_aliased(self):
        text = "*D_NET n1 1.2\n...\n*D_NET n2 3.4\n"
        self.assertEqual(adapters.parse_spef_net_names(text), {"n1", "n2"})

    def test_unresolvable_alias_is_dropped_not_guessed(self):
        text = fixtures.spef_net_name_map_and_d_nets({}, [(9999, 1.0)])
        self.assertEqual(adapters.parse_spef_net_names(text), set())

    def test_none_when_unreadable(self):
        self.assertIsNone(adapters.parse_spef_net_names(None))

    def test_ports_section_direction_line_never_collides_with_name_map(self):
        # Fix round 1 (Task 16 review, Important #3): confirmed against a
        # real, unfiltered SPEF prefix that a real *PORTS section reuses
        # the identical "*<index> <token>" line shape as *NAME_MAP, for an
        # entirely different purpose (port direction I/O/B, not a name).
        # Real *NAME_MAP index *98784 named "clk"; the real file's *PORTS
        # section separately has "*98784 I" (an unrelated input-direction
        # marker for the same index) -- this must resolve to "clk", not
        # raise a spurious conflict against "I".
        text = (
            "*NAME_MAP\n"
            "*98784 mock_clk\n"
            "*98785 mock_rst\n"
            "\n"
            "*PORTS\n"
            "\n"
            "*98784 I\n"
            "*98785 B\n"
            "\n"
            "*D_NET *98784 1.0\n"
        )
        self.assertEqual(adapters.parse_spef_net_names(text), {"mock_clk"})

    def test_identical_duplicate_name_map_line_is_tolerated(self):
        # Fix round 1 (Task 16 review, Minor): a harmless, redundant repeat
        # of the same index/name pair is not an identity conflict.
        text = fixtures.spef_net_name_map_and_d_nets(
            [(1001, "mock_net_a"), (1001, "mock_net_a")],
            [(1001, 12.34)],
        )
        self.assertEqual(adapters.parse_spef_net_names(text), {"mock_net_a"})

    def test_conflicting_duplicate_name_map_line_raises(self):
        # The same index naming two different nets is a real identity
        # conflict -- fail closed rather than silently picking one.
        text = fixtures.spef_net_name_map_and_d_nets(
            [(1001, "mock_net_a"), (1001, "mock_net_b")],
            [(1001, 12.34)],
        )
        with self.assertRaises(core.AtcsError) as ctx:
            adapters.parse_spef_net_names(text)
        self.assertEqual(ctx.exception.code, "spef-name-map-conflict")


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


class StarrcToolkitEnvTest(unittest.TestCase):
    """Issue 63: StarXtract fails `error while loading shared libraries: libtbb.so.12`
    on a Site whose `edarun` wrapper runs `bash -lc` with no shell_env -- the container's
    own EDA init never puts the StarRC toolkit's `linux64_starrc/lib` on
    `LD_LIBRARY_PATH`. `discover_starrc_toolkit`/`starrc_shell_env` mirror the already-
    qualified `xtop-timing-closure` Pack's `closure.py` behaviour (probe through the
    Site's own `edaShell`, walk up from the resolved binary to the directory holding
    `linux64_starrc/lib`), so `extract`'s StarXtract invocation carries the same
    LD_LIBRARY_PATH prefix `cworst_T.log` needed.
    """

    def setUp(self):
        self.tmp = _tmp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_starrc_shell_env_prefixes_with_both_lib_dirs_and_preserves_inherited_value(self):
        toolkit = self.tmp / "toolkit"
        (toolkit / "linux64_starrc" / "lib" / "shlib").mkdir(parents=True)
        env = adapters.starrc_shell_env(toolkit)
        self.assertEqual(len(env), 1)
        name, value = env[0]
        self.assertEqual(name, "LD_LIBRARY_PATH")
        self.assertEqual(
            value,
            f'"{toolkit}/linux64_starrc/lib:{toolkit}/linux64_starrc/lib/shlib:${{LD_LIBRARY_PATH:-}}"',
        )

    def test_starrc_shell_env_is_empty_when_neither_lib_dir_exists(self):
        toolkit = self.tmp / "toolkit-with-nothing"
        toolkit.mkdir()
        self.assertEqual(adapters.starrc_shell_env(toolkit), [])

    def test_starrc_shell_env_keeps_a_space_in_the_toolkit_path_as_one_shell_word(self):
        toolkit = self.tmp / "tool kit"
        (toolkit / "linux64_starrc" / "lib").mkdir(parents=True)
        env = adapters.starrc_shell_env(toolkit)
        name, value = env[0]
        line = adapters.shell_line(["StarXtract", "-clean", "cmd"], env)
        # One shell word despite the embedded space: the assignment is double-quoted,
        # and shlex.join would otherwise have single-quoted (and thus frozen literal)
        # the ${LD_LIBRARY_PATH:-} expansion.
        self.assertIn(f'LD_LIBRARY_PATH="{toolkit}/linux64_starrc/lib:${{LD_LIBRARY_PATH:-}}" ', line)
        self.assertTrue(line.endswith("StarXtract -clean cmd"))

    def test_run_tool_carries_the_starrc_shell_env_prefix_into_the_recorded_invocation(self):
        capture = self.tmp / "captured.txt"
        wrapper = self.tmp / "record-wrapper.sh"
        wrapper.write_text(
            '#!/bin/sh\nprintf %s "$1" >> ' + str(capture) + '\nexit 0\n', encoding="utf-8",
        )
        wrapper.chmod(0o755)
        toolkit = self.tmp / "toolkit"
        (toolkit / "linux64_starrc" / "lib").mkdir(parents=True)

        adapters.run_tool(
            {"edaShell": [str(wrapper)]}, ["StarXtract", "-clean", "cworst_T.cmd"],
            cwd=self.tmp, log_path=self.tmp / "log.txt", shell_env=adapters.starrc_shell_env(toolkit),
        )
        recorded = capture.read_text(encoding="utf-8")
        self.assertTrue(
            recorded.startswith(f'LD_LIBRARY_PATH="{toolkit}/linux64_starrc/lib:${{LD_LIBRARY_PATH:-}}" '),
            recorded,
        )
        self.assertTrue(recorded.endswith("StarXtract -clean cworst_T.cmd"), recorded)

    def test_discover_starrc_toolkit_walks_up_from_the_probed_binary_through_edashell(self):
        toolkit = self.tmp / "toolkit"
        bin_dir = toolkit / "support" / "bin"
        bin_dir.mkdir(parents=True)
        (toolkit / "linux64_starrc" / "lib").mkdir(parents=True)
        star_xtract = bin_dir / "StarXtract"
        star_xtract.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        star_xtract.chmod(0o755)

        wrapper = self.tmp / "probe-wrapper.sh"
        wrapper.write_text('#!/bin/sh\nexec sh -c "$1"\n', encoding="utf-8")
        wrapper.chmod(0o755)

        import os
        old_path = os.environ.get("PATH", "")
        os.environ["PATH"] = str(bin_dir) + os.pathsep + old_path
        try:
            found = adapters.discover_starrc_toolkit({"edaShell": [str(wrapper)]})
        finally:
            os.environ["PATH"] = old_path

        self.assertIsNotNone(found)
        self.assertEqual(str(found), str(toolkit))

    def test_discover_starrc_toolkit_returns_none_when_the_probe_fails(self):
        wrapper = self.tmp / "failing-probe-wrapper.sh"
        wrapper.write_text('#!/bin/sh\nexec sh -c "$1"\n', encoding="utf-8")
        wrapper.chmod(0o755)
        import os
        old_path = os.environ.get("PATH", "")
        # A PATH holding no StarXtract at all -- `command -v StarXtract` fails inside the probe.
        os.environ["PATH"] = str(self.tmp)
        try:
            found = adapters.discover_starrc_toolkit({"edaShell": [str(wrapper)]})
        finally:
            os.environ["PATH"] = old_path
        self.assertIsNone(found)


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
        "physical": ["MISSING/site.json", "baseline"],
        "evaluate": ["MISSING/policy.json"],
        "adopt": ["MISSING/policy.json"],
        "residual": ["MISSING/scenarios.json", "MISSING/site.json"],
        "apr-prepare": [],
        "apr-run": ["MISSING/site.json"],
        "policy": ["MISSING/analysis-contract-dir", "0.0", "0.0"],
        "record-experience": ["MISSING/reason.json"],
        "capture-contribution": ["w01"],
        "prepare-workers": ["MISSING/base.json", "MISSING/site.json", "MISSING/eda.json",
                             "MISSING/campaign-plan.json"],
        "reconcile": [],
        "presta": ["MISSING/base.json", "MISSING/scenarios.json", "MISSING/site.json"],
        "implement": ["MISSING/state.json", "MISSING/site.json"],
        "extract": ["MISSING/corners.json", "MISSING/site.json"],
        "sta": ["MISSING/query.json", "MISSING/scenarios.json", "MISSING/base.json", "MISSING/site.json", "1000"],
        "observe": ["MISSING/query.json", "MISSING/site.json", "MISSING/scenarios.json", "1000"],
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
        _write_json(corners_path, {"corners": {corner: "unused/template.cmd"}})
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

    def test_collect_succeeds_with_no_contributions_yet_and_reports_every_slot_pending(self):
        workspace = _tmp()
        self.addCleanup(shutil.rmtree, workspace, ignore_errors=True)
        result = subprocess.run([sys.executable, str(CLI_PATH), "collect", str(workspace)],
                                 capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        body = json.loads((workspace / "state" / "contributions-collected.json").read_text())
        self.assertEqual(body["contributions"], [])
        # Issue #64 Task 4: six declared slots.
        self.assertEqual(sorted(entry["slot"] for entry in body["pending"]), ["w01", "w02", "w03", "w04", "w05", "w06"])
        self.assertTrue(all(entry.get("reason") for entry in body["pending"]))

    def test_collect_reports_the_rest_pending_when_two_slots_sealed(self):
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
        self.assertEqual([entry["slot"] for entry in body["pending"]], ["w03", "w04", "w05", "w06"])
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
