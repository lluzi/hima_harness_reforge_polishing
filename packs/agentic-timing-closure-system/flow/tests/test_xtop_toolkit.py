"""The XTop expert toolkit in the worker Operator session (Issue #64, Task 3).

`flow/templates/xtop-operator.tcl` defines the typed `atcs_*` procedures an
Operator agent drives through the Harness's `hima-tcl-line-v1` adapter. This
suite sources the rendered session Tcl in a plain `tclsh` with a small
in-memory design standing in for XTop (never a real XTop binary) and checks the
confinement surface:

- every mutation refuses an object outside the session's edit domain before it
  calls XTop, refuses once the session's mutation budget is used, and pins the
  plan hash;
- every mutation appends one `ops.jsonl` line (`seq`, `cmd`, `args`, `before`,
  `after`, XTop return) and one `gain.jsonl` line against the session reference;
- `atcs_undo` undoes the last kept mutation and logs `{"cmd":"undo","undoes":N}`;
- the `fix_*_pins` procedures emit only whitelisted flags and `-only_pins` from
  domain pins;
- every XTop command and option the toolkit emits is on the knowledge pack's
  command surface (`evidence/command_surface.tsv`, rows copied below).

The Pack contract's interactive command classes and argument order are checked
against the Tcl procedures themselves.
"""
from __future__ import annotations

import json
import re
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

from atcs import adapters, core  # noqa: E402

TCLSH = shutil.which("tclsh")
PREFIX = "atcs_w01_r1_"
PLAN = "a" * 64
OTHER_PLAN = "b" * 64

READ_PROCS = ["atcs_ref", "atcs_gain", "atcs_paths", "atcs_fail_reasons", "atcs_candidates"]
MUTATE_PROCS = [
    "atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load",
    "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins",
    "atcs_undo",
]
SAVE_PROCS = ["atcs_dump_cells", "atcs_export_changes"]
CLOSE_PROCS = ["atcs_close"]

# Options per command, copied from the knowledge pack's `evidence/command_surface.tsv`
# (column `options`, XTop 2025.09.tmp15). A command absent here must never be emitted.
XTOP_SURFACE = {
    "summarize_gba_violations": {"as_reference", "exclude_dont_touch", "exclude_path", "hold", "io_only",
                                 "r2r_only", "setup", "with_delta", "with_distribution", "with_fail_reason",
                                 "with_reference", "with_top_n"},
    "redirect": {"append", "channel", "compress", "file", "tee", "variable"},
    "get_paths": {"across", "completely_conflict", "delay_type", "end_points", "filter", "from_hierarchy",
                  "group", "lower_bound", "path_names", "path_type", "quiet", "scenario", "start_points",
                  "through_points", "to_hierarchy", "upper_bound", "within"},
    "analyze_setup_path_violations": {"debug", "detail_info", "output_dir", "prefix", "top"},
    "analyze_hold_path_violations": {"debug", "detail_info", "output_dir", "prefix", "top"},
    "report_fail_reasons": {"disable_timing", "exclude_reasons", "methods", "paths", "pins", "stats",
                            "truncate", "verbose"},
    "get_failed_pins": {"methods", "reasons"},
    "list_size_cell_candidates": {"by_function", "design", "dont_use", "filter", "gate_array"},
    "list_insert_buffer_candidates": {"design", "dont_use", "filter", "gate_array", "inverter"},
    "list_exchange_cell_candidates": {"by_function", "design", "filter"},
    "size_cell": {"design", "location"},
    "exchange_cell": {"design"},
    "insert_buffer": {"design", "force", "inverter_pair", "locations", "new_cell_names", "new_net_names"},
    "insert_dummy_cell": {"design", "force", "location", "new_cell_name"},
    "split_load": {"design", "inverter_pair", "lib_cell", "locations", "new_cell_names", "new_net_names",
                   "pin_group"},
    "split_net": {"design", "lib_cell", "rule", "scenario", "segment"},
    "move_cell": {"delta", "design", "to"},
    "remove_buffer": {"design"},
    "fix_hold_gba_violations": {"buffer_list", "capacitance_margin", "debug_pins", "delay_cell_list", "dff_only",
                                "disable_report", "dummy_only", "effort", "fix_timing_window", "group",
                                "hold_target", "max_cluster_loader_count", "max_delay_cell_length", "only_pins",
                                "rel_transition_margin", "setup_margin", "size_cell_only", "size_rule",
                                "summarize_internal_iteration", "transition_margin", "use_dummy_cell"},
    "fix_setup_gba_violations": {"buffer_list", "capacitance_margin", "debug_pins", "dff_only", "disable_report",
                                 "effort", "enable_multithread", "group", "hold_margin", "methods", "only_pins",
                                 "priority_weight", "rel_transition_margin", "remove_buffer_only", "setup_target",
                                 "size_down_only", "size_rule", "summarize_internal_iteration",
                                 "transition_margin"},
    "undo": set(),
    "get_cells": {"exact", "filter", "hierarchical", "nocase", "of_objects", "quiet", "regex"},
    "get_pins": {"exact", "filter", "hierarchical", "leaf", "nocase", "of_objects", "quiet", "regex"},
    "get_nets": {"boundary_type", "exact", "filter", "hierarchical", "nocase", "of_objects", "quiet", "regex",
                 "segments", "top_net_of_hierarchical_group"},
    "get_attribute": {"class", "quiet", "scenario"},
    "sizeof_collection": set(),
    "foreach_in_collection": set(),
    "write_design_changes": {"add_on_route", "eco_file_prefix", "exclude_new_created", "exclude_phy_info", "force",
                             "format", "keep_route", "last_n", "output_dir", "reorder", "strong_force", "version",
                             "write_atomic_cmd"},
    "save_workspace": {"as", "overwrite"},
}

# Stricter than the surface: the only flags each targeted-fix procedure may emit (Task 3 brief).
FIX_HOLD_FLAGS = {"effort", "hold_target", "setup_margin", "size_cell_only", "use_dummy_cell", "fix_timing_window",
                  "max_cluster_loader_count", "max_delay_cell_length", "delay_cell_list", "only_pins"}
FIX_SETUP_FLAGS = {"methods", "remove_buffer_only", "size_down_only", "setup_target", "hold_margin", "only_pins"}

_OPTION_WORD = re.compile(r"^-([a-z_]+)$")

# An in-memory design standing in for XTop. Objects are tagged names ("cell:U1",
# "pin:U1/A", "net:N1"); every XTop command the toolkit may call records its words.
STUB_XTOP = r"""
proc stub_record {args} {
    set fh [open $::env(STUB_CALLS) a]
    puts $fh [join $args "\x1f"]
    close $fh
}
foreach stub_name {set_parameter create_workspace link_reference_library create_design_definition
                   set_site_map set_removable_fillers import_designs check_placement_readiness
                   read_timing_data check_inst_reference_library check_inst_timing_library save_workspace} {
    proc $stub_name {args} {}
}
array set ::cells {U1 BUFX1 U2 INVX1 U3 BUFX2 UOUT BUFX1 U9 DFFX1}
array set ::pin_net {U1/A N1 U1/Y N2 U2/A N2 U2/Y N4 U3/A N1 U3/Y N3 UOUT/A N1 UOUT/Y N9 U9/D N2 U9/Q N9}
set ::undo_stack {}
set ::stub_fix_effect {}
set ::stub_fix_pins {}
set ::stub_remove_extra {}
set ::stub_insert_hier ""
set ::stub_exchange_effect {}
set ::stub_undo_broken 0
set ::stub_fail {}
set ::stub_noop {}
proc stub_push {} { lappend ::undo_stack [list [array get ::cells] [array get ::pin_net]] }
proc stub_gate {name} {
    if {[lsearch -exact $::stub_fail $name] >= 0} { error "XTop stub refused $name" }
    return [expr {[lsearch -exact $::stub_noop $name] >= 0}]
}
proc stub_strip {obj} {
    set obj [lindex $obj 0]
    regsub {^(cell|pin|net):} $obj {} name
    return $name
}
proc stub_opts {valued words} {
    set opts [dict create]
    set pos {}
    for {set i 0} {$i < [llength $words]} {incr i} {
        set w [lindex $words $i]
        if {[regexp {^-[a-z_]+$} $w]} {
            if {[lsearch -exact $valued $w] >= 0} {
                incr i
                dict set opts $w [lindex $words $i]
            } else {
                dict set opts $w 1
            }
        } else {
            lappend pos $w
        }
    }
    return [list $opts $pos]
}
proc get_cells {args} {
    stub_record get_cells {*}$args
    lassign [stub_opts {-of_objects -filter} $args] o pos
    if {[dict exists $o -hierarchical]} {
        set r {}
        foreach n [lsort [array names ::cells]] { lappend r "cell:$n" }
        return $r
    }
    if {[dict exists $o -of_objects]} {
        set p [stub_strip [dict get $o -of_objects]]
        set owner [join [lrange [split $p /] 0 end-1] /]
        if {[info exists ::cells($owner)]} { return [list "cell:$owner"] }
        return {}
    }
    set n [stub_strip [lindex $pos 0]]
    if {[info exists ::cells($n)]} { return [list "cell:$n"] }
    if {[dict exists $o -quiet]} { return {} }
    error "get_cells: no cell named $n"
}
proc get_pins {args} {
    stub_record get_pins {*}$args
    lassign [stub_opts {-of_objects -filter} $args] o pos
    if {[dict exists $o -of_objects]} {
        set owner [stub_strip [dict get $o -of_objects]]
        set r {}
        foreach p [lsort [array names ::pin_net]] {
            if {[join [lrange [split $p /] 0 end-1] /] eq $owner} { lappend r "pin:$p" }
        }
        return $r
    }
    set n [stub_strip [lindex $pos 0]]
    if {[info exists ::pin_net($n)]} { return [list "pin:$n"] }
    if {[dict exists $o -quiet]} { return {} }
    error "get_pins: no pin named $n"
}
proc get_nets {args} {
    stub_record get_nets {*}$args
    lassign [stub_opts {-of_objects -filter} $args] o pos
    if {[dict exists $o -of_objects]} {
        set p [stub_strip [dict get $o -of_objects]]
        if {[info exists ::pin_net($p)]} { return [list "net:$::pin_net($p)"] }
        return {}
    }
    if {[dict exists $o -hierarchical]} {
        set r {}
        foreach n [lsort -unique [lsort [array get ::pin_net]]] {
            if {[lsearch -exact [array names ::pin_net] $n] < 0} { lappend r "net:$n" }
        }
        return $r
    }
    if {[string match "net:*" [lindex $pos 0]]} { return [lindex $pos 0] }
    error "get_nets: unsupported $args"
}
proc get_attribute {obj attr args} {
    stub_record get_attribute $obj $attr {*}$args
    set obj [lindex $obj 0]
    if {![regexp {^(cell|pin|net):} $obj]} { error "get_attribute: unwrapped native object $obj" }
    set name [stub_strip $obj]
    if {$attr eq "full_name"} { return $name }
    if {$attr eq "ref_name" && [string match "cell:*" $obj]} { return $::cells($name) }
    error "get_attribute: unsupported $attr on $obj"
}
proc sizeof_collection {c} { stub_record sizeof_collection $c; return [llength $c] }
proc foreach_in_collection {iter_var collection body} {
    upvar 1 $iter_var i
    foreach i $collection { uplevel 1 $body }
}
proc size_cell {args} {
    stub_record size_cell {*}$args
    if {[stub_gate size_cell]} { return "size_cell accepted" }
    lassign [stub_opts {-design -location} $args] o pos
    stub_push
    foreach c [lindex $pos 0] { set ::cells([stub_strip $c]) [lindex $pos 1] }
    return "Info: sized \"[lindex $pos 0]\"\tto [lindex $pos 1]\n"
}
proc exchange_cell {args} {
    stub_record exchange_cell {*}$args
    stub_gate exchange_cell
    stub_push
    foreach {inst master} $::stub_exchange_effect {
        if {$master eq ""} { unset ::cells($inst) } else { set ::cells($inst) $master }
    }
    return 1
}
proc insert_buffer {args} {
    stub_record insert_buffer {*}$args
    if {[stub_gate insert_buffer]} { return 1 }
    lassign [stub_opts {-design -new_cell_names -new_net_names -locations} $args] o pos
    stub_push
    foreach n [dict get $o -new_cell_names] l [lindex $pos 1] { set ::cells($::stub_insert_hier$n) $l }
    return 1
}
proc insert_dummy_cell {args} {
    stub_record insert_dummy_cell {*}$args
    stub_gate insert_dummy_cell
    lassign [stub_opts {-design -new_cell_name -location} $args] o pos
    stub_push
    set ::cells([dict get $o -new_cell_name]) [lindex $pos 1]
    return 1
}
proc split_load {args} {
    stub_record split_load {*}$args
    stub_gate split_load
    lassign [stub_opts {-design -new_cell_names -new_net_names -locations -pin_group -lib_cell} $args] o pos
    stub_push
    foreach n [dict get $o -new_cell_names] { set ::cells($n) [dict get $o -lib_cell] }
    return 1
}
proc split_net {args} {
    stub_record split_net {*}$args
    stub_gate split_net
    lassign [stub_opts {-design -scenario -lib_cell -rule -segment} $args] o pos
    stub_push
    for {set k 1} {$k < [dict get $o -segment]} {incr k} {
        set ::cells([format "%seco_sn%d" $::env(NAME_PREFIX) $k]) [dict get $o -lib_cell]
    }
    return 1
}
proc move_cell {args} {
    stub_record move_cell {*}$args
    stub_gate move_cell
    stub_push
    return 1
}
proc remove_buffer {args} {
    stub_record remove_buffer {*}$args
    stub_gate remove_buffer
    stub_push
    foreach c [concat [lindex $args end] $::stub_remove_extra] { unset ::cells([stub_strip $c]) }
    return 1
}
proc stub_fix {name words} {
    stub_record $name {*}$words
    stub_gate $name
    stub_push
    foreach {inst master} $::stub_fix_effect {
        if {$master eq ""} { unset ::cells($inst) } else { set ::cells($inst) $master }
    }
    foreach {pin net} $::stub_fix_pins { set ::pin_net($pin) $net }
    return 3
}
proc fix_hold_gba_violations {args} { return [stub_fix fix_hold_gba_violations $args] }
proc fix_setup_gba_violations {args} { return [stub_fix fix_setup_gba_violations $args] }
proc undo {args} {
    stub_record undo {*}$args
    if {$::stub_undo_broken} { return "" }
    if {[llength $::undo_stack] == 0} { error "Error: no ECO checkpoint to undo" }
    array unset ::cells
    array unset ::pin_net
    array set ::cells [lindex $::undo_stack end 0]
    array set ::pin_net [lindex $::undo_stack end 1]
    set ::undo_stack [lrange $::undo_stack 0 end-1]
    return ""
}
proc summarize_gba_violations {args} {
    stub_record summarize_gba_violations {*}$args
    stub_gate summarize_gba_violations
    return "WNS \"delta\"\t-0.010 for $args"
}
proc redirect {args} {
    stub_record redirect {*}[lrange $args 0 end-1]
    lassign [stub_opts {-variable -file -channel} [lrange $args 0 end-2]] o pos
    set target [lindex $args end-1]
    set code [catch {uplevel #0 [lindex $args end]} r]
    upvar #0 $target captured
    set captured "captured: $r\n"
    if {$code} { error $r }
    return ""
}
proc get_paths {args} { stub_record get_paths {*}$args; return [list path:1 path:2] }
proc analyze_setup_path_violations {args} { stub_record analyze_setup_path_violations {*}$args; return "SETUP-ANALYSIS" }
proc analyze_hold_path_violations {args} { stub_record analyze_hold_path_violations {*}$args; return "HOLD-ANALYSIS" }
proc report_fail_reasons {args} { stub_record report_fail_reasons {*}$args; return "REASONS" }
proc get_failed_pins {args} { stub_record get_failed_pins {*}$args; return [list pin:U1/A pin:U2/A] }
proc list_size_cell_candidates {args} { stub_record list_size_cell_candidates {*}$args; return "BUFX2 BUFX4" }
proc list_insert_buffer_candidates {args} { stub_record list_insert_buffer_candidates {*}$args; return "BUFX2" }
proc list_exchange_cell_candidates {args} { stub_record list_exchange_cell_candidates {*}$args; return "INVX2" }
proc write_design_changes {args} { stub_record write_design_changes {*}$args; return "" }
proc stub_cells {} {
    set out {}
    foreach n [lsort [array names ::cells]] { lappend out "$n=$::cells($n)" }
    return [join $out " "]
}
proc T {tag script} {
    if {[catch {uplevel #0 $script} message]} {
        puts "$tag:ERR:[string map [list "\n" " "] $message]"
    } else {
        puts "$tag:OK:[string map [list "\n" " "] $message]"
    }
}
"""

DOMAIN = {"instances": ["U1", "U2", "U3"], "nets": ["N1", "N2"], "regions": []}
TARGET_PINS = ["U9/D"]


def _tmp():
    return Path(tempfile.mkdtemp(prefix="atcs-toolkit-"))


def _xtop_context(root):
    library_path = Path(root) / "xtop-library.tcl"
    library_path.write_text("# synthetic XTop library context\n", encoding="utf-8")
    timing_path = Path(root) / "sta_data"
    timing_path.mkdir(exist_ok=True)
    return {
        "libraryTcl": {"path": str(library_path)}, "staData": {"path": str(timing_path)},
        "siteMap": ["unit", "core"], "removableFillers": ["FILL*"],
        "ecoParameters": {
            "bufferListForHold": ["DELAY1", "BUFX2"], "bufferListForSetup": ["BUFX2", "BUFX4"],
            "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
            "cellNominalSwapKeywords": ["LVT", "HVT"],
            "cellNominalSizingPattern": "X([0-9]+)", "gainThreshold": 0.001,
        },
    }


def _contract_text():
    return (PACK_DIR / "contract.yml").read_text(encoding="utf-8")


def _xtop_operator_block():
    text = _contract_text()
    start = text.index("  - id: xtop-operator\n")
    end = text.index("\n  - id: ", start + 1)
    return text[start:end]


def _contract_class(name):
    match = re.search(rf"^\s+{name}: \[([^\]]*)\]\s*$", _xtop_operator_block(), re.M)
    if match is None:
        raise AssertionError(f"contract xtop-operator commands.{name} not found")
    return [item.strip() for item in match.group(1).split(",") if item.strip()]


def _contract_arguments():
    block = _xtop_operator_block()
    section = block[block.index("      arguments:\n"):]
    result = {}
    for line in section.splitlines()[1:]:
        match = re.match(r"^        (atcs_\w+): \[(.*)\]\s*$", line)
        if not match:
            break
        result[match.group(1)] = re.findall(r"\{ name: (\w+), type: (\w+)", match.group(2))
    return result


def _snake(name):
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


class Session:
    """One rendered worker session under a stub XTop, run to completion by `tclsh`."""

    def __init__(self, test, domain=None, target_pins=None, max_mutations=10):
        self.tmp = _tmp()
        test.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for name in ("tech.lef", "cells.lef", "netlist.v", "design.def"):
            (self.tmp / name).write_text("stub", encoding="utf-8")
        self.root = self.tmp / "workspaces" / "w01" / "r1"
        self.root.mkdir(parents=True)
        manifest = {"namePrefix": PREFIX}
        operator = adapters.compile_xtop_operator_task(
            manifest, "top", str(self.tmp / "tech.lef"), str(self.tmp / "cells.lef"),
            str(self.tmp / "netlist.v"), str(self.tmp / "design.def"), str(self.root), _xtop_context(self.tmp),
        )
        (self.root / "operator.tcl").write_text(operator["tcl"], encoding="utf-8")
        self.analysis = adapters.compile_xtop_analysis_manual_task(
            manifest, DOMAIN if domain is None else domain, self.root / "operator.tcl", self.root / "ops.jsonl",
            target_pins=TARGET_PINS if target_pins is None else target_pins, max_mutations=max_mutations,
        )
        self.calls_path = self.tmp / "calls.txt"

    def run(self, commands):
        script = self.tmp / "session.tcl"
        preamble = f'set env(STUB_CALLS) "{self.calls_path}"\n'
        session = self.analysis["tcl"]
        # Only what the toolkit emits after session setup is recorded.
        script.write_text(
            preamble + STUB_XTOP + session + "\nfile delete -force $env(STUB_CALLS)\n" + commands + "\n",
            encoding="utf-8",
        )
        result = subprocess.run([TCLSH, str(script)], capture_output=True, text=True)
        self.stdout, self.stderr, self.returncode = result.stdout, result.stderr, result.returncode
        return self

    def outcome(self, tag):
        for line in self.stdout.splitlines():
            if line.startswith(tag + ":OK:"):
                return "OK", line[len(tag) + 4:]
            if line.startswith(tag + ":ERR:"):
                return "ERR", line[len(tag) + 5:]
        raise AssertionError(f"no outcome for {tag}\nstdout={self.stdout}\nstderr={self.stderr}")

    def _jsonl(self, name):
        path = self.root / name
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    @property
    def ops(self):
        return self._jsonl("ops.jsonl")

    @property
    def gains(self):
        return self._jsonl("gain.jsonl")

    @property
    def calls(self):
        if not self.calls_path.exists():
            return []
        return [line.split("\x1f") for line in self.calls_path.read_text(encoding="utf-8").splitlines() if line]

    def calls_to(self, command):
        return [call for call in self.calls if call[0] == command]


MUTATING_XTOP = {"size_cell", "exchange_cell", "insert_buffer", "insert_dummy_cell", "split_load", "split_net",
                 "move_cell", "remove_buffer", "fix_hold_gba_violations", "fix_setup_gba_violations", "undo"}


# ---------------------------------------------------------------------------
# Contract: the interactive command classes and typed arguments match the toolkit.
# ---------------------------------------------------------------------------


class ToolkitContractTest(unittest.TestCase):
    def test_read_and_mutate_lists_match_the_toolkit_table(self):
        self.assertEqual(_contract_class("read"), READ_PROCS)
        self.assertEqual(_contract_class("mutate"), MUTATE_PROCS)
        self.assertEqual(_contract_class("save"), SAVE_PROCS)
        self.assertEqual(_contract_class("close"), CLOSE_PROCS)

    def test_every_mutation_takes_the_plan_hash_as_its_last_string_argument(self):
        arguments = _contract_arguments()
        for proc in MUTATE_PROCS:
            self.assertIn(proc, arguments, proc)
            self.assertEqual(arguments[proc][-1], ("planSha256", "string"), proc)
        for proc in READ_PROCS:
            self.assertNotIn(("planSha256", "string"), arguments[proc], proc)

    def test_the_reviewed_action_seam_still_names_atcs_size_cell(self):
        self.assertEqual(
            _contract_arguments()["atcs_size_cell"],
            [("instance", "string"), ("toMaster", "string"), ("planSha256", "string")],
        )

    @unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
    def test_contract_arguments_are_the_tcl_procedure_arguments_in_order(self):
        session = Session(self)
        procs = READ_PROCS + MUTATE_PROCS + SAVE_PROCS + CLOSE_PROCS
        lines = "".join(f'puts "ARGS:{proc}:[info args {proc}]"\n' for proc in procs)
        session.run(lines)
        self.assertEqual(session.returncode, 0, session.stdout + session.stderr)
        declared = _contract_arguments()
        for proc in procs:
            line = next(item for item in session.stdout.splitlines() if item.startswith(f"ARGS:{proc}:"))
            tcl_args = line.split(":", 2)[2].split()
            self.assertEqual(tcl_args, [_snake(name) for name, _type in declared.get(proc, [])], proc)


# ---------------------------------------------------------------------------
# The adapter bakes the work package's pins and mutation budget into the session.
# ---------------------------------------------------------------------------


class AnalysisTaskBudgetTest(unittest.TestCase):
    def _compile(self, **kwargs):
        return adapters.compile_xtop_analysis_manual_task(
            {"namePrefix": PREFIX}, DOMAIN, "/ws/operator.tcl", "/ws/ops.jsonl", **kwargs,
        )

    def test_bakes_target_pins_and_budget(self):
        task = self._compile(target_pins=["U9/D", "u/q_reg[3]/D"], max_mutations=12)
        self.assertIn("set ::EDIT_DOMAIN_PINS {U9/D u/q_reg[3]/D}", task["tcl"])
        self.assertIn("set ::ATCS_MAX_MUTATIONS {12}", task["tcl"])
        self.assertEqual(task["maxMutations"], 12)
        self.assertEqual(task["targetPins"], ["U9/D", "u/q_reg[3]/D"])

    def test_absent_budget_defaults_to_one_mutation(self):
        task = self._compile()
        self.assertEqual(task["maxMutations"], adapters.DEFAULT_OPERATOR_MAX_MUTATIONS)
        self.assertEqual(adapters.DEFAULT_OPERATOR_MAX_MUTATIONS, 1)
        self.assertIn("set ::ATCS_MAX_MUTATIONS {1}", task["tcl"])

    def test_refuses_a_budget_outside_one_to_two_hundred(self):
        for bad in (0, 201, -1, "3", True, 2.5):
            with self.assertRaises(core.AtcsError, msg=repr(bad)) as ctx:
                self._compile(max_mutations=bad)
            self.assertEqual(ctx.exception.code, "invalid-input")

    def test_refuses_an_unsafe_target_pin(self):
        with self.assertRaises(core.AtcsError):
            self._compile(target_pins=["U9/D; exec rm"])


# ---------------------------------------------------------------------------
# The rendered session.
# ---------------------------------------------------------------------------


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class ToolkitProceduresTest(unittest.TestCase):
    def test_rendered_session_defines_every_toolkit_procedure(self):
        session = Session(self).run('puts "PROCS:[lsort [info procs atcs_*]]"')
        self.assertEqual(session.returncode, 0, session.stdout + session.stderr)
        line = next(item for item in session.stdout.splitlines() if item.startswith("PROCS:"))
        defined = set(line[len("PROCS:"):].split())
        for proc in READ_PROCS + MUTATE_PROCS + SAVE_PROCS + CLOSE_PROCS:
            self.assertIn(proc, defined)
        for retired in ("atcs_query_paths", "atcs_query_cells", "atcs_delete_buffer"):
            self.assertNotIn(retired, defined)


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class DomainConfinementTest(unittest.TestCase):
    """Each mutation refuses an out-of-domain object before any mutating XTop call."""

    REFUSED = {
        "size": f"atcs_size_cell UOUT BUFX4 {PLAN}",
        "exchange": f"atcs_exchange_cell UOUT INVX2 {PLAN}",
        "exchange_other": f"atcs_exchange_cell U1 UOUT {PLAN}",
        "insert_net": f"atcs_insert_buffer N9 UOUT/Y BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}",
        "insert_pin_elsewhere": f"atcs_insert_buffer N1 U2/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}",
        "dummy": f"atcs_insert_dummy UOUT/Y BUFX1 {PREFIX}d1 {PLAN}",
        "split_load": f"atcs_split_load N9 {{{{UOUT/Y}}}} BUFX2 {PREFIX}s1 {PREFIX}sn1 {PLAN}",
        "split_net": f"atcs_split_net N9 BUFX2 wire_length 2 {PLAN}",
        "move": f"atcs_move_cell UOUT delta 1.0 0 {PLAN}",
        "remove": f"atcs_remove_buffer UOUT {PLAN}",
        "fix_hold": f"atcs_fix_hold_pins UOUT/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
        "fix_setup": f"atcs_fix_setup_pins UOUT/A size_cell 0 0 0.0 0.02 {PLAN}",
    }

    def test_every_mutation_refuses_an_out_of_domain_object_without_mutating(self):
        session = Session(self)
        script = "".join(f"T {tag} {{{command}}}\n" for tag, command in self.REFUSED.items())
        session.run(script + 'puts "CELLS:[stub_cells]"\n')
        self.assertEqual(session.returncode, 0, session.stdout + session.stderr)
        for tag in self.REFUSED:
            status, message = session.outcome(tag)
            self.assertEqual(status, "ERR", tag)
            self.assertIn("out-of-scope", message, tag)
        self.assertEqual([call for call in session.calls if call[0] in MUTATING_XTOP], [])
        self.assertEqual(session.ops, [])
        self.assertIn("CELLS:U1=BUFX1 U2=INVX1 U3=BUFX2 U9=DFFX1 UOUT=BUFX1", session.stdout)

    def test_new_names_must_use_the_workspace_name_prefix(self):
        session = Session(self).run(
            f"T bad {{atcs_insert_buffer N1 UOUT/A BUFX2 X1 {PREFIX}n1 {PLAN}}}\n"
            f"T badnet {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 n1 {PLAN}}}\n"
            f"T dummy {{atcs_insert_dummy U1/A BUFX1 d1 {PLAN}}}\n"
            f"T exists {{atcs_insert_buffer N1 UOUT/A BUFX2 U1 {PREFIX}n1 {PLAN}}}\n"
        )
        for tag in ("bad", "badnet", "dummy"):
            status, message = session.outcome(tag)
            self.assertEqual(status, "ERR", tag)
            self.assertIn(PREFIX, message, tag)
        self.assertEqual(session.outcome("exists")[0], "ERR")
        self.assertEqual(session.calls_to("insert_buffer") + session.calls_to("insert_dummy_cell"), [])

    def test_plan_hash_is_required_and_pinned_for_the_session(self):
        session = Session(self).run(
            "T malformed {atcs_size_cell U1 BUFX2 notahash}\n"
            f"T first {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T other {{atcs_size_cell U2 INVX2 {OTHER_PLAN}}}\n"
        )
        self.assertEqual(session.outcome("malformed")[0], "ERR")
        self.assertEqual(session.outcome("first")[0], "OK")
        status, message = session.outcome("other")
        self.assertEqual(status, "ERR")
        self.assertIn("planSha256", message)
        self.assertEqual(len(session.calls_to("size_cell")), 1)


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class MutationTraceTest(unittest.TestCase):
    def test_kept_mutation_logs_one_op_and_one_gain_line_after_the_reference(self):
        session = Session(self).run(f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n")
        self.assertEqual(session.outcome("size")[0], "OK", session.stdout)
        self.assertEqual(len(session.ops), 1)
        op = session.ops[0]
        self.assertEqual(op["seq"], 1)
        self.assertEqual(op["cmd"], "size_cell")
        self.assertEqual(op["proc"], "atcs_size_cell")
        self.assertEqual(op["args"], {"instance": "U1", "toMaster": "BUFX2", "planSha256": PLAN})
        self.assertEqual(op["before"], {"instances": {"U1": "BUFX1"}})
        self.assertEqual(op["after"], {"instances": {"U1": "BUFX2"}})
        self.assertEqual(op["status"], "kept")
        self.assertEqual(op["xtop"]["code"], 0)
        self.assertIn("sized", op["xtop"]["result"])
        self.assertEqual(op["xtop"]["command"], "size_cell U1 BUFX2")

        gains = session.gains
        self.assertEqual([gain["kind"] for gain in gains], ["reference", "mutation"])
        self.assertEqual(gains[0]["seq"], 0)
        self.assertEqual(gains[1]["seq"], 1)
        for check in ("setup", "hold"):
            self.assertIn("-as_reference", gains[0]["checks"][check]["command"])
            command = gains[1]["checks"][check]["command"]
            self.assertIn("-with_delta", command)
            self.assertIn("-with_reference", command)
            self.assertTrue(command.endswith(f"-{check}"), command)
            self.assertIn("captured:", gains[1]["checks"][check]["text"])
        # The reference is captured once, before the first mutation reaches XTop.
        order = [call[0] for call in session.calls if call[0] in ("summarize_gba_violations", "size_cell")]
        self.assertEqual(order[:3], ["summarize_gba_violations", "summarize_gba_violations", "size_cell"])

    def test_reference_is_captured_once(self):
        session = Session(self).run(
            "T r1 {atcs_ref}\nT r2 {atcs_ref}\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("r1")[0], "OK")
        self.assertEqual(session.outcome("r2")[0], "OK")
        as_reference = [call for call in session.calls_to("summarize_gba_violations") if "-as_reference" in call]
        self.assertEqual(len(as_reference), 2)
        self.assertEqual([gain["kind"] for gain in session.gains], ["reference", "mutation"])

    def test_insert_buffer_chain_uses_named_new_objects_and_logs_them(self):
        session = Session(self).run(
            f"T ins {{atcs_insert_buffer N1 {{UOUT/A U3/A}} {{DELAY1 BUFX2}} "
            f"{{{PREFIX}b1 {PREFIX}b2}} {{{PREFIX}n1 {PREFIX}n2}} {PLAN}}}\n"
            f"T size_new {{atcs_size_cell {PREFIX}b2 BUFX4 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("ins")[0], "OK", session.stdout)
        call = session.calls_to("insert_buffer")[0]
        self.assertIn("-new_cell_names", call)
        self.assertEqual(call[call.index("-new_cell_names") + 1], f"{PREFIX}b1 {PREFIX}b2")
        self.assertEqual(call[call.index("-new_net_names") + 1], f"{PREFIX}n1 {PREFIX}n2")
        op = session.ops[0]
        self.assertEqual(op["args"]["masters"], ["DELAY1", "BUFX2"])
        self.assertEqual(op["args"]["loadPins"], ["UOUT/A", "U3/A"])
        self.assertEqual(op["before"], {"instances": {f"{PREFIX}b1": None, f"{PREFIX}b2": None}})
        self.assertEqual(op["after"], {"instances": {f"{PREFIX}b1": "DELAY1", f"{PREFIX}b2": "BUFX2"}})
        # A cell this session created is inside its domain.
        self.assertEqual(session.outcome("size_new")[0], "OK", session.stdout)

    def test_xtop_error_without_change_is_logged_and_raised(self):
        session = Session(self).run(
            "set ::stub_fail {size_cell}\n"
            f"T size {{atcs_size_cell U1 NOSUCHCELL {PLAN}}}\n"
        )
        status, message = session.outcome("size")
        self.assertEqual(status, "ERR")
        self.assertIn("XTop stub refused size_cell", message)
        self.assertEqual(len(session.ops), 1)
        self.assertEqual(session.ops[0]["status"], "error")
        self.assertEqual(session.ops[0]["xtop"]["code"], 1)
        self.assertEqual(session.ops[0]["after"], session.ops[0]["before"])
        self.assertEqual([gain["kind"] for gain in session.gains], ["reference"])

    def test_accepted_command_that_changed_nothing_is_not_kept(self):
        session = Session(self).run(
            "set ::stub_noop {size_cell}\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("size")[0], "ERR")
        self.assertEqual(session.ops[0]["status"], "no-change")
        status, message = session.outcome("undo")
        self.assertEqual(status, "ERR")
        self.assertIn("nothing to undo", message)

    def test_log_lines_stay_valid_json_for_awkward_xtop_text(self):
        session = Session(self).run(f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n")
        self.assertEqual(session.outcome("size")[0], "OK", session.stdout)
        self.assertIn('"delta"', session.gains[1]["checks"]["setup"]["text"])
        self.assertIn("\t", session.ops[0]["xtop"]["result"])

    def test_snapshot_mutation_logs_the_observed_delta(self):
        session = Session(self).run(
            f"T split {{atcs_split_net N1 BUFX2 wire_length 3 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("split")[0], "OK", session.stdout)
        op = session.ops[0]
        self.assertEqual(op["cmd"], "split_net")
        self.assertEqual(op["before"], {"instances": {f"{PREFIX}eco_sn1": None, f"{PREFIX}eco_sn2": None}})
        self.assertEqual(op["after"], {"instances": {f"{PREFIX}eco_sn1": "BUFX2", f"{PREFIX}eco_sn2": "BUFX2"}})
        call = session.calls_to("split_net")[0]
        self.assertEqual(call[1:], ["N1", "-lib_cell", "BUFX2", "-rule", "wire_length", "-segment", "3"])


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class BudgetTest(unittest.TestCase):
    def test_refuses_once_max_mutations_is_reached_and_undo_counts(self):
        session = Session(self, max_mutations=2).run(
            f"T m1 {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T m2 {{atcs_undo {PLAN}}}\n"
            f"T m3 {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            f"T m4 {{atcs_undo {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("m1")[0], "OK")
        self.assertEqual(session.outcome("m2")[0], "OK")
        for tag in ("m3", "m4"):
            status, message = session.outcome(tag)
            self.assertEqual(status, "ERR", tag)
            self.assertIn("budget", message, tag)
        self.assertEqual(len(session.calls_to("size_cell")), 1)
        self.assertEqual(len(session.calls_to("undo")), 1)

    def test_domain_refusals_do_not_consume_the_budget(self):
        session = Session(self, max_mutations=1).run(
            f"T out {{atcs_size_cell UOUT BUFX2 {PLAN}}}\n"
            f"T in {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("out")[0], "ERR")
        self.assertEqual(session.outcome("in")[0], "OK")


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class UndoTest(unittest.TestCase):
    def test_undo_pops_kept_mutations_last_first(self):
        session = Session(self).run(
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
            f"T u1 {{atcs_undo {PLAN}}}\n"
            f"T u2 {{atcs_undo {PLAN}}}\n"
            f"T u3 {{atcs_undo {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        for tag in ("size", "ins", "u1", "u2"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout)
        status, message = session.outcome("u3")
        self.assertEqual(status, "ERR")
        self.assertIn("nothing to undo", message)
        undo_lines = [op for op in session.ops if op["cmd"] == "undo"]
        self.assertEqual([(op["seq"], op["undoes"]) for op in undo_lines], [(3, 2), (4, 1)])
        self.assertEqual(undo_lines[0]["status"], "kept")
        self.assertEqual(undo_lines[0]["args"], {"planSha256": PLAN})
        self.assertEqual(undo_lines[0]["after"], {"instances": {f"{PREFIX}b1": None}})
        self.assertEqual(undo_lines[1]["after"], {"instances": {"U1": "BUFX1"}})
        self.assertEqual(len(session.calls_to("undo")), 2)
        self.assertEqual([gain["kind"] for gain in session.gains],
                         ["reference", "mutation", "mutation", "undo", "undo"])
        cells_line = next(line for line in session.stdout.splitlines() if line.startswith("CELLS:"))
        self.assertNotIn(f"{PREFIX}b1", cells_line)

    def test_an_undone_new_cell_leaves_the_session_domain(self):
        session = Session(self).run(
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            f"T again {{atcs_remove_buffer {PREFIX}b1 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("undo")[0], "OK")
        status, message = session.outcome("again")
        self.assertEqual(status, "ERR")
        self.assertIn("out-of-scope", message)

    def test_undo_that_does_not_restore_taints_the_session(self):
        session = Session(self).run(
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            "set ::stub_undo_broken 1\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            f"T next {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            "T read {atcs_gain setup 5}\n"
        )
        status, message = session.outcome("undo")
        self.assertEqual(status, "ERR")
        self.assertIn("did not restore", message)
        self.assertEqual(session.ops[-1]["cmd"], "undo")
        self.assertEqual(session.ops[-1]["undoes"], 1)
        self.assertEqual(session.ops[-1]["status"], "uncertain")
        status, message = session.outcome("next")
        self.assertEqual(status, "ERR")
        self.assertIn("tainted", message)
        self.assertEqual(session.outcome("read")[0], "OK")

    def test_snapshot_mutation_undo_restores_the_whole_delta(self):
        session = Session(self).run(
            f"set ::stub_fix_effect {{U1 BUFX4 {PREFIX}eco_1 DELAY1}}\n"
            f"T fix {{atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        self.assertEqual(session.ops[0]["before"], {"instances": {"U1": "BUFX1", f"{PREFIX}eco_1": None}})
        self.assertEqual(session.ops[0]["after"], {"instances": {"U1": "BUFX4", f"{PREFIX}eco_1": "DELAY1"}})
        self.assertEqual(session.outcome("undo")[0], "OK", session.stdout)
        self.assertEqual(session.ops[1]["undoes"], 1)
        self.assertEqual(session.ops[1]["after"], {"instances": {"U1": "BUFX1", f"{PREFIX}eco_1": None}})


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class TargetedFixTest(unittest.TestCase):
    def _flags(self, call):
        return {match.group(1) for word in call if (match := _OPTION_WORD.match(word))}

    def test_fix_hold_emits_only_whitelisted_flags_and_domain_pins(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{atcs_fix_hold_pins {{U9/D U1/A}} high 0.01 0.02 1 1 0 4 3 {{DELAY1 DELAY2}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        (call,) = session.calls_to("fix_hold_gba_violations")
        self.assertLessEqual(self._flags(call), FIX_HOLD_FLAGS)
        self.assertEqual(call[call.index("-only_pins") + 1], "U9/D U1/A")
        self.assertEqual(call[call.index("-effort") + 1], "high")
        self.assertEqual(call[call.index("-hold_target") + 1], "0.01")
        self.assertEqual(call[call.index("-setup_margin") + 1], "0.02")
        self.assertEqual(call[call.index("-max_cluster_loader_count") + 1], "4")
        self.assertEqual(call[call.index("-max_delay_cell_length") + 1], "3")
        self.assertEqual(call[call.index("-delay_cell_list") + 1], "DELAY1 DELAY2")
        self.assertIn("-size_cell_only", call)
        self.assertIn("-use_dummy_cell", call)
        self.assertNotIn("-fix_timing_window", call)
        self.assertEqual(session.ops[0]["cmd"], "fix_hold_gba_violations")
        self.assertEqual(session.ops[0]["status"], "kept")

    def test_fix_hold_omits_optional_flags_at_their_sentinels(self):
        session = Session(self).run(
            f"set ::stub_fix_effect {{U1 BUFX4}}\n"
            f"T fix {{atcs_fix_hold_pins U1/A low 0.0 0.02 0 0 1 0 -1 {{}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        (call,) = session.calls_to("fix_hold_gba_violations")
        self.assertEqual(self._flags(call), {"effort", "hold_target", "setup_margin", "fix_timing_window", "only_pins"})

    def test_fix_hold_refusals(self):
        refused = {
            "window_and_size_only": f"atcs_fix_hold_pins U1/A low 0.0 0.02 1 0 1 0 -1 {{}} {PLAN}",
            "window_needs_low_effort": f"atcs_fix_hold_pins U1/A high 0.0 0.02 0 0 1 0 -1 {{}} {PLAN}",
            "cluster_high": f"atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 7 -1 {{}} {PLAN}",
            "cluster_fraction": f"atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 2.5 -1 {{}} {PLAN}",
            "delay_len_high": f"atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 6 DELAY1 {PLAN}",
            "delay_len_without_list": f"atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 2 {{}} {PLAN}",
            "delay_list_without_len": f"atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 DELAY1 {PLAN}",
            "effort": f"atcs_fix_hold_pins U1/A turbo 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "target_range": f"atcs_fix_hold_pins U1/A medium 0.5 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "margin_nan": f"atcs_fix_hold_pins U1/A medium 0.0 NaN 0 0 0 0 -1 {{}} {PLAN}",
            "flag_word": f"atcs_fix_hold_pins U1/A medium 0.0 0.02 yes 0 0 0 -1 {{}} {PLAN}",
            "no_pins": f"atcs_fix_hold_pins {{}} medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "option_as_pin": f"atcs_fix_hold_pins -effort medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
        }
        session = Session(self).run("".join(f"T {tag} {{{command}}}\n" for tag, command in refused.items()))
        for tag in refused:
            self.assertEqual(session.outcome(tag)[0], "ERR", tag)
        self.assertEqual(session.calls_to("fix_hold_gba_violations"), [])
        self.assertIn("fix_timing_window", session.outcome("window_and_size_only")[1])

    def test_fix_setup_emits_only_whitelisted_flags(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{atcs_fix_setup_pins {{U9/D}} {{size_cell insert_buffer}} 0 0 -0.01 0.02 {PLAN}}}\n"
            f"T rb {{atcs_fix_setup_pins U1/A {{}} 1 0 0.0 0.02 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        self.assertEqual(session.outcome("rb")[0], "OK", session.stdout)
        first, second = session.calls_to("fix_setup_gba_violations")
        self.assertLessEqual(self._flags(first), FIX_SETUP_FLAGS)
        self.assertEqual(first[first.index("-methods") + 1], "size_cell insert_buffer")
        self.assertEqual(first[first.index("-setup_target") + 1], "-0.01")
        self.assertEqual(first[first.index("-hold_margin") + 1], "0.02")
        self.assertEqual(first[first.index("-only_pins") + 1], "U9/D")
        self.assertEqual(self._flags(second), {"remove_buffer_only", "setup_target", "hold_margin", "only_pins"})

    def test_fix_setup_refusals(self):
        refused = {
            "method": f"atcs_fix_setup_pins U1/A remove_buffer 0 0 0.0 0.02 {PLAN}",
            "nothing": f"atcs_fix_setup_pins U1/A {{}} 0 0 0.0 0.02 {PLAN}",
            "rb_and_methods": f"atcs_fix_setup_pins U1/A size_cell 1 0 0.0 0.02 {PLAN}",
            "rb_and_down": f"atcs_fix_setup_pins U1/A {{}} 1 1 0.0 0.02 {PLAN}",
            "target_range": f"atcs_fix_setup_pins U1/A size_cell 0 0 -0.3 0.02 {PLAN}",
            "pin": f"atcs_fix_setup_pins UOUT/A size_cell 0 0 0.0 0.02 {PLAN}",
        }
        session = Session(self).run("".join(f"T {tag} {{{command}}}\n" for tag, command in refused.items()))
        for tag in refused:
            self.assertEqual(session.outcome(tag)[0], "ERR", tag)
        self.assertEqual(session.calls_to("fix_setup_gba_violations"), [])

    def test_fix_without_any_domain_pin_is_refused(self):
        session = Session(self, domain={"instances": [], "nets": []}, target_pins=[]).run(
            f"T fix {{atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        status, message = session.outcome("fix")
        self.assertEqual(status, "ERR")
        self.assertIn("out-of-scope", message)

    def test_an_out_of_domain_effect_is_undone_and_refused(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4 UOUT BUFX4}\n"
            f"T fix {{atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        status, message = session.outcome("fix")
        self.assertEqual(status, "ERR")
        self.assertIn("out-of-domain", message)
        self.assertIn("UOUT", message)
        op = session.ops[0]
        self.assertEqual(op["status"], "reverted")
        self.assertEqual(op["outOfDomain"], ["UOUT"])
        self.assertEqual(len(session.calls_to("undo")), 1)
        cells_line = next(line for line in session.stdout.splitlines() if line.startswith("CELLS:"))
        self.assertIn("U1=BUFX1", cells_line)
        self.assertIn("UOUT=BUFX1", cells_line)
        # A reverted mutation is not on the undo stack.
        self.assertIn("nothing to undo", session.outcome("undo")[1])

    def test_a_new_cell_without_the_name_prefix_is_out_of_domain(self):
        session = Session(self).run(
            "set ::stub_fix_effect {eco_foreign_1 BUFX2}\n"
            f"T fix {{atcs_fix_setup_pins U1/A size_cell 0 0 0.0 0.02 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "ERR")
        self.assertEqual(session.ops[0]["outOfDomain"], ["eco_foreign_1"])

    def test_an_out_of_domain_effect_that_undo_cannot_restore_taints_the_session(self):
        session = Session(self).run(
            "set ::stub_fix_effect {UOUT BUFX4}\nset ::stub_undo_broken 1\n"
            f"T fix {{atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T next {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "ERR")
        self.assertEqual(session.ops[0]["status"], "uncertain")
        self.assertIn("tainted", session.outcome("next")[1])


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class ObservedEffectConfinementTest(unittest.TestCase):
    """Edits whose full effect XTop decides are judged on the observed design, nets included."""

    def test_a_new_cell_on_an_existing_out_of_domain_net_is_undone(self):
        session = Session(self).run(
            f"set ::stub_fix_effect {{{PREFIX}eco_9 BUFX2}}\n"
            f"set ::stub_fix_pins {{{PREFIX}eco_9/A N9 {PREFIX}eco_9/Y NEWN}}\n"
            f"T fix {{atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        status, message = session.outcome("fix")
        self.assertEqual(status, "ERR")
        self.assertIn(f"{PREFIX}eco_9@N9", message)
        self.assertEqual(session.ops[0]["status"], "reverted")
        self.assertEqual(session.ops[0]["outOfDomain"], [f"{PREFIX}eco_9@N9"])

    def test_a_net_created_by_a_kept_edit_joins_the_domain_until_undone(self):
        session = Session(self).run(
            f"set ::stub_fix_effect {{{PREFIX}eco_7 BUFX2}}\n"
            f"set ::stub_fix_pins {{{PREFIX}eco_7/A N1 {PREFIX}eco_7/Y NEWN}}\n"
            f"T fix {{atcs_fix_hold_pins U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T split {{atcs_split_net NEWN BUFX2 cap 2 {PLAN}}}\n"
            f"T u1 {{atcs_undo {PLAN}}}\nT u2 {{atcs_undo {PLAN}}}\n"
            f"T again {{atcs_split_net NEWN BUFX2 cap 2 {PLAN}}}\n"
        )
        for tag in ("fix", "split", "u1", "u2"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout)
        self.assertEqual(session.ops[0]["newNets"], ["NEWN"])
        status, message = session.outcome("again")
        self.assertEqual(status, "ERR")
        self.assertIn("out-of-scope net: NEWN", message)

    def test_remove_buffer_that_takes_an_out_of_domain_cell_with_it_is_undone(self):
        session = Session(self).run(
            "set ::stub_remove_extra {UOUT}\n"
            f"T rm {{atcs_remove_buffer U3 {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        status, message = session.outcome("rm")
        self.assertEqual(status, "ERR")
        self.assertIn("UOUT", message)
        self.assertEqual(session.ops[0]["status"], "reverted")
        self.assertIn("U3=BUFX2", session.stdout)
        self.assertIn("UOUT=BUFX1", session.stdout)

    def test_an_insert_that_xtop_names_differently_is_kept_and_flagged(self):
        session = Session(self).run(
            "set ::stub_insert_hier u_core/\n"
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
            "set ::stub_insert_hier {}\n"
            f"T ok {{atcs_insert_buffer N1 U3/A BUFX2 {PREFIX}b2 {PREFIX}n2 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("ins")[0], "OK", session.stdout)
        self.assertIs(session.ops[0]["matchesRequest"], False)
        self.assertEqual(session.ops[0]["after"], {"instances": {f"u_core/{PREFIX}b1": "BUFX2"}})
        self.assertIs(session.ops[1]["matchesRequest"], True)

    def test_an_ops_log_that_cannot_be_written_taints_the_session(self):
        session = Session(self).run(
            f"T first {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            "set ::env(OPS_LOG) /nonexistent-atcs-dir/ops.jsonl\n"
            f"T second {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            f"T third {{atcs_size_cell U3 BUFX4 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("first")[0], "OK")
        status, message = session.outcome("second")
        self.assertEqual(status, "ERR")
        self.assertIn("ops.jsonl write failed", message)
        self.assertIn("tainted", session.outcome("third")[1])
        self.assertEqual(len(session.calls_to("size_cell")), 2)


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class ReadProceduresTest(unittest.TestCase):
    def test_reads_call_the_documented_commands(self):
        session = Session(self).run(
            "T gain {atcs_gain hold 7}\n"
            "T paths_all {atcs_paths setup 5 {}}\n"
            "T paths_end {atcs_paths hold 3 {U9/D}}\n"
            "T reasons {atcs_fail_reasons {U1/A U2/A} {} {}}\n"
            "T failed {atcs_fail_reasons {} {legal_fail_no_space_on_row} {size_cell insert_buffer}}\n"
            "T c1 {atcs_candidates size_cell U1}\n"
            "T c2 {atcs_candidates insert_buffer U1/Y}\n"
            "T c3 {atcs_candidates exchange_cell U2}\n"
            "T bad_check {atcs_gain both 7}\n"
            "T bad_top {atcs_gain hold 0}\n"
            "T bad_method {atcs_fail_reasons U1/A {} {clock_eco}}\n"
            "T bad_kind {atcs_candidates split_net N1}\n"
        )
        for tag in ("gain", "paths_all", "paths_end", "reasons", "failed", "c1", "c2", "c3"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout + session.stderr)
        for tag in ("bad_check", "bad_top", "bad_method", "bad_kind"):
            self.assertEqual(session.outcome(tag)[0], "ERR", tag)
        probe = [gain for gain in session.gains if gain["kind"] == "probe"]
        self.assertEqual(len(probe), 1)
        command = probe[0]["checks"]["hold"]["command"]
        self.assertEqual(command, "summarize_gba_violations -with_delta -with_reference -with_top_n 7 "
                                  "-with_fail_reason -hold")
        (setup_analysis,) = session.calls_to("analyze_setup_path_violations")
        self.assertEqual(setup_analysis[1:], ["-top", "5", "-detail_info"])
        (get_paths,) = session.calls_to("get_paths")
        self.assertEqual(get_paths[1:], ["-delay_type", "min", "-end_points", "U9/D"])
        (report,) = session.calls_to("report_fail_reasons")
        self.assertEqual(report[1:], ["-stats", "-verbose", "-pins", "U1/A U2/A"])
        (failed,) = session.calls_to("get_failed_pins")
        self.assertEqual(failed[1:], ["-methods", "size_cell insert_buffer", "-reasons", "legal_fail_no_space_on_row"])
        self.assertIn("U2/A", session.outcome("failed")[1])
        self.assertEqual([call[0] for call in session.calls if call[0] in MUTATING_XTOP], [])
        self.assertEqual(session.ops, [])


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class KnowledgeSurfaceTest(unittest.TestCase):
    """Every XTop command and option the toolkit emits is on the knowledge pack's command surface."""

    def test_a_full_expert_session_stays_on_the_documented_surface(self):
        session = Session(self, max_mutations=20).run(
            "T ref {atcs_ref}\n"
            "T gain {atcs_gain setup 10}\n"
            "T paths {atcs_paths setup 5 {U9/D}}\n"
            "T reasons {atcs_fail_reasons {U1/A} {legal_fail_no_space_on_row} {size_cell}}\n"
            "T c1 {atcs_candidates size_cell U1}\nT c2 {atcs_candidates insert_buffer U1/Y}\n"
            "T c3 {atcs_candidates exchange_cell U2}\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"set ::stub_exchange_effect {{U2 INVX2}}\nT exch {{atcs_exchange_cell U2 INVX2 {PLAN}}}\n"
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
            f"T dummy {{atcs_insert_dummy U1/A BUFX1 {PREFIX}d1 {PLAN}}}\n"
            f"T sl {{atcs_split_load N2 {{{{U2/A}} {{U9/D}}}} BUFX2 {{{PREFIX}s1 {PREFIX}s2}} "
            f"{{{PREFIX}sn1 {PREFIX}sn2}} {PLAN}}}\n"
            f"T sn {{atcs_split_net N1 BUFX2 cap 2 {PLAN}}}\n"
            f"T mv {{atcs_move_cell U3 to 10.5 20 {PLAN}}}\n"
            f"T rm {{atcs_remove_buffer U3 {PLAN}}}\n"
            f"set ::stub_fix_effect {{U1 BUFX4}}\n"
            f"T fh {{atcs_fix_hold_pins U1/A low 0.0 0.02 0 1 1 2 1 DELAY1 {PLAN}}}\n"
            f"set ::stub_fix_effect {{U1 BUFX1}}\n"
            f"T fs {{atcs_fix_setup_pins U1/A {{split_net}} 0 1 0.0 0.02 {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            f'T dump {{atcs_dump_cells "{Path("/dev/null")}"}}\n'
            "T export {atcs_export_changes}\n",
        )
        for tag in ("ref", "gain", "paths", "reasons", "c1", "c2", "c3", "size", "exch", "ins", "dummy", "sl", "sn",
                    "mv", "rm", "fh", "fs", "undo", "dump", "export"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + "\n" + session.stdout + session.stderr)
        emitted = set()
        for call in session.calls:
            command = call[0]
            self.assertIn(command, XTOP_SURFACE, f"{command} is not on the knowledge-pack command surface")
            for word in call[1:]:
                match = _OPTION_WORD.match(word)
                if match:
                    self.assertIn(match.group(1), XTOP_SURFACE[command], f"{command} -{match.group(1)}")
            emitted.add(command)
        for command in ("size_cell", "exchange_cell", "insert_buffer", "insert_dummy_cell", "split_load",
                        "split_net", "move_cell", "remove_buffer", "fix_hold_gba_violations",
                        "fix_setup_gba_violations", "undo", "summarize_gba_violations", "get_paths",
                        "analyze_setup_path_violations", "report_fail_reasons", "get_failed_pins",
                        "list_size_cell_candidates", "list_insert_buffer_candidates",
                        "list_exchange_cell_candidates"):
            self.assertIn(command, emitted)
        self.assertEqual([op["seq"] for op in session.ops], list(range(1, len(session.ops) + 1)))
        (move,) = session.calls_to("move_cell")
        self.assertEqual(move[1:], ["-to", "10.5 20", "U3"])
        self.assertEqual([op["status"] for op in session.ops if op["cmd"] == "move_cell"], ["kept"])
        self.assertEqual([op.get("verified") for op in session.ops if op["cmd"] == "move_cell"], ["xtop-return"])


if __name__ == "__main__":
    unittest.main()
