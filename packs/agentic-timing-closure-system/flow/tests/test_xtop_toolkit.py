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
    "count_eco_actions": {"last_n", "types"},
    "get_eco_cells": {"last_n", "show_remove_cell_max_num", "types"},
}

# Stricter than the surface: the only flags each targeted-fix procedure may emit (Task 3 brief,
# widened by the controller toward the frozen Pack's qualified strings, closure.py ~681-690).
FIX_HOLD_FLAGS = {"effort", "hold_target", "setup_margin", "size_cell_only", "size_rule", "use_dummy_cell",
                  "fix_timing_window", "max_cluster_loader_count", "max_delay_cell_length", "delay_cell_list",
                  "only_pins"}
FIX_SETUP_FLAGS = {"methods", "remove_buffer_only", "size_down_only", "effort", "setup_target", "hold_margin",
                   "only_pins"}

_OPTION_WORD = re.compile(r"^-([a-z_]+)$")

# An in-memory design standing in for XTop. Objects are tagged names ("cell:U1",
# "pin:U1/A", "net:N1"); every XTop command the toolkit may call records its words.
# ECO bookkeeping: every edit pushes actions (the state before it plus the cells it
# touched); `count_eco_actions` counts them, `get_eco_cells -last_n` reads their cells
# and `undo` pops one, restoring its saved state.
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
set ::actions {}
set ::stub_fix_effect {}
set ::stub_fix_pins {}
set ::stub_fix_actions 1
set ::stub_remove_extra {}
set ::stub_insert_hier ""
set ::stub_insert_removes {}
set ::stub_undo_broken 0
# Real XTop (Issue #64 Task 7, qual-issue64-chain-20260928): a fix flow's actions are committed and
# `undo` refuses them ("Error: The committed actions cannot be undone."); set ::stub_fix_committed 1
# to model it. Most mechanism tests below use a fix as a vehicle for an arbitrary effect and keep 0.
set ::stub_fix_committed 0
# Real XTop: `summarize_gba_violations -with_fail_reason` fails until a fix or optimize flow has run.
set ::stub_fix_ran 0
set ::stub_fail {}
set ::stub_noop {}
proc stub_act {touched {committed 0}} {
    lappend ::actions [list [array get ::cells] [array get ::pin_net] $touched $committed]
}
proc stub_gate {name} {
    if {[lsearch -exact $::stub_fail $name] >= 0} { error "XTop stub refused $name" }
    return [expr {[lsearch -exact $::stub_noop $name] >= 0}]
}
proc stub_strip {obj} {
    set obj [lindex $obj 0]
    regsub {^(cell|pin|net):} $obj {} name
    return $name
}
proc stub_names {collection} {
    set out {}
    foreach obj $collection { lappend out [stub_strip $obj] }
    return $out
}
proc stub_opts {valued words} {
    set opts [dict create]
    set pos {}
    for {set i 0} {$i < [llength $words]} {incr i} {
        set w [lindex $words $i]
        if {[regexp {^-[a-z_]+$} $w]} {
            if {[lsearch -exact $valued $w] >= 0} {
                incr i
                dict lappend opts $w [lindex $words $i]
            } else {
                dict set opts $w 1
            }
        } else {
            lappend pos $w
        }
    }
    return [list $opts $pos]
}
proc stub_one {opts name} { return [lindex [dict get $opts $name] 0] }
proc stub_nets {} {
    set nets {}
    foreach {p n} [array get ::pin_net] { lappend nets $n }
    return [lsort -unique $nets]
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
        set p [stub_strip [stub_one $o -of_objects]]
        set owner [join [lrange [split $p /] 0 end-1] /]
        if {[info exists ::cells($owner)]} { return [list "cell:$owner"] }
        return {}
    }
    set r {}
    foreach n [lindex $pos 0] {
        set n [stub_strip $n]
        if {[info exists ::cells($n)]} {
            lappend r "cell:$n"
        } elseif {![dict exists $o -quiet]} {
            error "get_cells: no cell named $n"
        }
    }
    return $r
}
proc get_pins {args} {
    stub_record get_pins {*}$args
    lassign [stub_opts {-of_objects -filter} $args] o pos
    if {[dict exists $o -of_objects]} {
        set owner [stub_strip [stub_one $o -of_objects]]
        set r {}
        foreach p [lsort [array names ::pin_net]] {
            if {[join [lrange [split $p /] 0 end-1] /] eq $owner} { lappend r "pin:$p" }
        }
        return $r
    }
    set r {}
    foreach n [lindex $pos 0] {
        set n [stub_strip $n]
        if {[info exists ::pin_net($n)]} {
            lappend r "pin:$n"
        } elseif {![dict exists $o -quiet]} {
            error "get_pins: no pin named $n"
        }
    }
    return $r
}
proc get_nets {args} {
    stub_record get_nets {*}$args
    lassign [stub_opts {-of_objects -filter} $args] o pos
    if {[dict exists $o -of_objects]} {
        set p [stub_strip [stub_one $o -of_objects]]
        if {[info exists ::pin_net($p)]} { return [list "net:$::pin_net($p)"] }
        return {}
    }
    if {[dict exists $o -hierarchical]} {
        set r {}
        foreach n [stub_nets] { lappend r "net:$n" }
        return $r
    }
    set n [stub_strip [lindex $pos 0]]
    if {[lsearch -exact [stub_nets] $n] >= 0} { return [list "net:$n"] }
    if {[dict exists $o -quiet]} { return {} }
    error "get_nets: no net named $n"
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
proc count_eco_actions {args} {
    stub_record count_eco_actions {*}$args
    stub_gate count_eco_actions
    return [llength $::actions]
}
proc get_eco_cells {args} {
    stub_record get_eco_cells {*}$args
    stub_gate get_eco_cells
    lassign [stub_opts {-last_n -types -show_remove_cell_max_num} $args] o pos
    set n [stub_one $o -last_n]
    set r {}
    foreach entry [lrange $::actions end-[expr {$n - 1}] end] {
        foreach c [lindex $entry 2] {
            if {[info exists ::cells($c)] && [lsearch -exact $r "cell:$c"] < 0} { lappend r "cell:$c" }
        }
    }
    return $r
}
proc size_cell {args} {
    stub_record size_cell {*}$args
    if {[stub_gate size_cell]} { return "size_cell accepted" }
    lassign [stub_opts {-design -location} $args] o pos
    set names [stub_names [lindex $pos 0]]
    stub_act $names
    foreach c $names { set ::cells($c) [lindex $pos 1] }
    return "Info: sized \"$names\"\tto [lindex $pos 1]\n"
}
proc exchange_cell {args} {
    stub_record exchange_cell {*}$args
    stub_gate exchange_cell
    set touched {}
    foreach {inst master} $::stub_exchange_effect { lappend touched $inst }
    stub_act $touched
    foreach {inst master} $::stub_exchange_effect {
        if {$master eq ""} { unset ::cells($inst) } else { set ::cells($inst) $master }
    }
    return 1
}
set ::stub_exchange_effect {}
proc insert_buffer {args} {
    stub_record insert_buffer {*}$args
    if {[stub_gate insert_buffer]} { return 1 }
    lassign [stub_opts {-design -new_cell_names -new_net_names -locations} $args] o pos
    set names {}
    foreach n [stub_one $o -new_cell_names] { lappend names $::stub_insert_hier$n }
    stub_act $names
    foreach n $names l [lindex $pos 1] { set ::cells($n) $l }
    foreach f $::stub_insert_removes { unset ::cells($f) }
    return 1
}
proc insert_dummy_cell {args} {
    stub_record insert_dummy_cell {*}$args
    stub_gate insert_dummy_cell
    lassign [stub_opts {-design -new_cell_name -location} $args] o pos
    set n [stub_one $o -new_cell_name]
    stub_act [list $n]
    set ::cells($n) [lindex $pos 1]
    return 1
}
proc split_load {args} {
    stub_record split_load {*}$args
    stub_gate split_load
    lassign [stub_opts {-design -new_cell_names -new_net_names -locations -pin_group -lib_cell} $args] o pos
    if {[llength [dict get $o -pin_group]] != [llength [stub_one $o -new_cell_names]]} {
        error "split_load: one -pin_group per new cell"
    }
    stub_act [stub_one $o -new_cell_names]
    foreach n [stub_one $o -new_cell_names] { set ::cells($n) [stub_one $o -lib_cell] }
    return 1
}
proc split_net {args} {
    stub_record split_net {*}$args
    stub_gate split_net
    lassign [stub_opts {-design -scenario -lib_cell -rule -segment} $args] o pos
    set names {}
    for {set k 1} {$k < [stub_one $o -segment]} {incr k} {
        lappend names [format "%seco_sn%d" $::env(NAME_PREFIX) $k]
    }
    stub_act $names
    foreach n $names { set ::cells($n) [stub_one $o -lib_cell] }
    return 1
}
proc move_cell {args} {
    stub_record move_cell {*}$args
    stub_gate move_cell
    stub_act [stub_names [lindex $args end]]
    return 1
}
proc remove_buffer {args} {
    stub_record remove_buffer {*}$args
    stub_gate remove_buffer
    stub_act {}
    foreach c [concat [stub_names [lindex $args end]] $::stub_remove_extra] { unset ::cells($c) }
    return 1
}
proc stub_fix {name words} {
    stub_record $name {*}$words
    stub_gate $name
    set ::stub_fix_ran 1
    set touched {}
    foreach {inst master} $::stub_fix_effect { lappend touched $inst }
    if {[llength $touched] == 0 && $::stub_fix_actions == 0} { return 0 }
    stub_act $touched $::stub_fix_committed
    foreach {inst master} $::stub_fix_effect {
        if {$master eq ""} { unset ::cells($inst) } else { set ::cells($inst) $master }
    }
    foreach {pin net} $::stub_fix_pins { set ::pin_net($pin) $net }
    for {set k 1} {$k < $::stub_fix_actions} {incr k} { stub_act {} $::stub_fix_committed }
    return 3
}
proc fix_hold_gba_violations {args} { return [stub_fix fix_hold_gba_violations $args] }
proc fix_setup_gba_violations {args} { return [stub_fix fix_setup_gba_violations $args] }
proc undo {args} {
    stub_record undo {*}$args
    if {$::stub_undo_broken} { return "" }
    if {[llength $::actions] == 0} { error "Error: no ECO checkpoint to undo" }
    if {[lindex $::actions end 3]} { error "" }
    array unset ::cells
    array unset ::pin_net
    array set ::cells [lindex $::actions end 0]
    array set ::pin_net [lindex $::actions end 1]
    set ::actions [lrange $::actions 0 end-1]
    return ""
}
proc summarize_gba_violations {args} {
    stub_record summarize_gba_violations {*}$args
    stub_gate summarize_gba_violations
    if {[lsearch -exact $args -with_fail_reason] >= 0 && !$::stub_fix_ran} {
        puts "Error: No fail reason since no fix or optimize flow have run yet."
        error ""
    }
    return "WNS \"delta\"\t-0.010 for $args"
}
proc redirect {args} {
    stub_record redirect {*}[lrange $args 0 end-1]
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

DOMAIN = {"instances": ["U1", "U2", "U3"], "nets": ["N1", "N2", "N3"], "regions": [[0, 0, 100, 100]]}
TARGET_PINS = ["U9/D"]
INITIAL_CELLS = "CELLS:U1=BUFX1 U2=INVX1 U3=BUFX2 U9=DFFX1 UOUT=BUFX1"


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


def _contract_choices(proc, argument):
    block = _xtop_operator_block()
    line = next(item for item in block.splitlines() if item.startswith(f"        {proc}: ["))
    match = re.search(rf"\{{ name: {argument}, type: string, choices: \[([^\]]*)\]", line)
    return [item.strip() for item in match.group(1).split(",")]


def _snake(name):
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), name)


class Session:
    """One rendered worker session under a stub XTop, run to completion by `tclsh`."""

    def __init__(self, test, domain=None, target_pins=None, max_mutations=10, observe=None):
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
            observe=observe,
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

    def cells_line(self):
        return next(line for line in self.stdout.splitlines() if line.startswith("CELLS:"))


MUTATING_XTOP = {"size_cell", "exchange_cell", "insert_buffer", "insert_dummy_cell", "split_load", "split_net",
                 "move_cell", "remove_buffer", "fix_hold_gba_violations", "fix_setup_gba_violations", "undo"}
HOLD = "atcs_fix_hold_pins"
SETUP = "atcs_fix_setup_pins"


def _flags(call):
    return {match.group(1) for word in call if (match := _OPTION_WORD.match(word))}


def _after(call, flag):
    return call[call.index(flag) + 1]


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

    def test_fix_effort_choices(self):
        self.assertEqual(_contract_choices(SETUP, "effort"), ["medium", "high"])
        self.assertEqual(_contract_choices(HOLD, "effort"),
                         ["omit", "low", "medium", "high", "ultra_high", "extreme_high"])

    def test_move_cell_is_absolute_only(self):
        self.assertEqual(
            _contract_arguments()["atcs_move_cell"],
            [("instance", "string"), ("x", "number"), ("y", "number"), ("planSha256", "string")],
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
# The adapter bakes the work package's pins, regions, budget and observation mode.
# ---------------------------------------------------------------------------


class AnalysisTaskBudgetTest(unittest.TestCase):
    def _compile(self, domain=DOMAIN, **kwargs):
        return adapters.compile_xtop_analysis_manual_task(
            {"namePrefix": PREFIX}, domain, "/ws/operator.tcl", "/ws/ops.jsonl", **kwargs,
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

    def test_bakes_regions_as_flat_boxes(self):
        task = self._compile(domain={"instances": [], "nets": [], "regions": [[0, 0, 10.5, 20], [30, 40, 50, 60]]})
        self.assertIn("set ::EDIT_DOMAIN_REGIONS {0 0 10.5 20 30 40 50 60}", task["tcl"])
        self.assertEqual(task["editDomain"]["regions"], [[0, 0, 10.5, 20], [30, 40, 50, 60]])

    def test_refuses_a_malformed_region(self):
        for bad in ([0, 0, 10], [10, 0, 0, 10], [0, 0, "x", 1], [0, 0, float("inf"), 1], [0, True, 1, 1]):
            with self.assertRaises(core.AtcsError, msg=repr(bad)) as ctx:
                self._compile(domain={"instances": [], "nets": [], "regions": [bad]})
            self.assertEqual(ctx.exception.code, "invalid-input")

    def test_observation_mode_defaults_to_fast_and_accepts_full(self):
        self.assertIn("set ::ATCS_OBSERVE {fast}", self._compile()["tcl"])
        task = self._compile(observe="full")
        self.assertIn("set ::ATCS_OBSERVE {full}", task["tcl"])
        self.assertEqual(task["observe"], "full")
        with self.assertRaises(core.AtcsError) as ctx:
            self._compile(observe="everything")
        self.assertEqual(ctx.exception.code, "invalid-input")


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
        "move": f"atcs_move_cell UOUT 1.0 0 {PLAN}",
        "move_outside": f"atcs_move_cell U3 150 20 {PLAN}",
        "remove": f"atcs_remove_buffer UOUT {PLAN}",
        "remove_mixed_nets": f"atcs_remove_buffer U2 {PLAN}",
        "fix_hold": f"{HOLD} UOUT/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
        "fix_setup": f"{SETUP} UOUT/A size_cell 0 0 medium 0.0 0.02 {PLAN}",
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
        self.assertIn("N4", session.outcome("remove_mixed_nets")[1])
        self.assertEqual([call for call in session.calls if call[0] in MUTATING_XTOP], [])
        self.assertEqual(session.ops, [])
        self.assertEqual(session.cells_line(), INITIAL_CELLS)

    def test_exchange_partners_must_be_existing_domain_instances(self):
        session = Session(self, domain={"instances": ["U1", "U2", "UGHOST"], "nets": [], "regions": []}).run(
            f"T bracket {{atcs_exchange_cell U1 {{U[O]UT U2}} {PLAN}}}\n"
            f"T elsewhere {{atcs_exchange_cell U1 u_other/SPARE {PLAN}}}\n"
            f"T ghost {{atcs_exchange_cell U1 UGHOST {PLAN}}}\n"
            f"T libcell {{atcs_exchange_cell U1 INVX2 {PLAN}}}\n"
            f"set ::stub_exchange_effect {{U1 INVX1 U2 BUFX1}}\n"
            f"T ok {{atcs_exchange_cell U1 U2 {PLAN}}}\n"
        )
        for tag in ("bracket", "elsewhere", "libcell"):
            status, message = session.outcome(tag)
            self.assertEqual(status, "ERR", tag)
            self.assertIn("out-of-scope", message, tag)
        status, message = session.outcome("ghost")
        self.assertEqual(status, "ERR")
        self.assertIn("does not exist", message)
        self.assertEqual(session.outcome("ok")[0], "OK", session.stdout)
        (call,) = session.calls_to("exchange_cell")
        self.assertEqual(call[1:], ["cell:U1", "cell:U2"])

    def test_move_needs_an_edit_region(self):
        session = Session(self, domain={"instances": ["U3"], "nets": [], "regions": []}).run(
            f"T move {{atcs_move_cell U3 10 20 {PLAN}}}\n"
        )
        status, message = session.outcome("move")
        self.assertEqual(status, "ERR")
        self.assertIn("out-of-scope", message)

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

    def test_size_cell_to_the_current_master_is_refused(self):
        session = Session(self, max_mutations=1).run(
            f"T same {{atcs_size_cell U1 BUFX1 {PLAN}}}\n"
            f"T other {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
        )
        status, message = session.outcome("same")
        self.assertEqual(status, "ERR")
        self.assertIn("already", message)
        self.assertEqual(session.outcome("other")[0], "OK")
        self.assertEqual(len(session.calls_to("size_cell")), 1)

    def test_mutations_pass_exact_collections_not_name_patterns(self):
        session = Session(self).run(
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T rm {{atcs_remove_buffer U3 {PLAN}}}\n"
            f"T fix {{{HOLD} {{U9/D U1/A}} medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        (size,) = session.calls_to("size_cell")
        self.assertEqual(size[1:], ["cell:U1", "BUFX2"])
        (remove,) = session.calls_to("remove_buffer")
        self.assertEqual(remove[1:], ["cell:U3"])
        (fix,) = session.calls_to("fix_hold_gba_violations")
        self.assertEqual(_after(fix, "-only_pins"), "pin:U9/D pin:U1/A")
        exact_lookups = [call for call in session.calls_to("get_cells") if "-exact" in call]
        self.assertTrue(exact_lookups)


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
        self.assertEqual(op["ecoActions"], 1)
        self.assertEqual(op["observe"], "fast")
        self.assertEqual(op["xtop"]["code"], 0)
        self.assertIn("sized", op["xtop"]["result"])
        self.assertEqual(op["xtop"]["command"], "size_cell cell:U1 BUFX2")

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
        self.assertEqual(_after(call, "-new_cell_names"), f"{PREFIX}b1 {PREFIX}b2")
        self.assertEqual(_after(call, "-new_net_names"), f"{PREFIX}n1 {PREFIX}n2")
        self.assertEqual(call[-2:], ["pin:UOUT/A pin:U3/A", "DELAY1 BUFX2"])
        op = session.ops[0]
        self.assertEqual(op["args"]["masters"], ["DELAY1", "BUFX2"])
        self.assertEqual(op["args"]["loadPins"], ["UOUT/A", "U3/A"])
        self.assertEqual(op["before"], {"instances": {f"{PREFIX}b1": None, f"{PREFIX}b2": None}})
        self.assertEqual(op["after"], {"instances": {f"{PREFIX}b1": "DELAY1", f"{PREFIX}b2": "BUFX2"}})
        self.assertIs(op["matchesRequest"], True)
        self.assertEqual(session.outcome("size_new")[0], "OK", session.stdout)

    def test_xtop_error_without_change_is_logged_and_raised(self):
        session = Session(self).run(
            "set ::stub_fail {size_cell}\n"
            f"T size {{atcs_size_cell U1 BUFX4 {PLAN}}}\n"
        )
        status, message = session.outcome("size")
        self.assertEqual(status, "ERR")
        self.assertIn("XTop stub refused size_cell", message)
        self.assertEqual(len(session.ops), 1)
        self.assertEqual(session.ops[0]["status"], "error")
        self.assertEqual(session.ops[0]["xtop"]["code"], 1)
        self.assertEqual(session.ops[0]["ecoActions"], 0)
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

    def test_split_net_logs_the_cells_xtop_reports(self):
        session = Session(self).run(f"T split {{atcs_split_net N1 BUFX2 wire_length 3 {PLAN}}}\n")
        self.assertEqual(session.outcome("split")[0], "OK", session.stdout)
        op = session.ops[0]
        self.assertEqual(op["cmd"], "split_net")
        self.assertEqual(op["before"], {"instances": {f"{PREFIX}eco_sn1": None, f"{PREFIX}eco_sn2": None}})
        self.assertEqual(op["after"], {"instances": {f"{PREFIX}eco_sn1": "BUFX2", f"{PREFIX}eco_sn2": "BUFX2"}})
        call = session.calls_to("split_net")[0]
        self.assertEqual(call[1:], ["net:N1", "-lib_cell", "BUFX2", "-rule", "wire_length", "-segment", "3"])

    def test_split_load_repeats_the_pin_group_flag(self):
        session = Session(self).run(
            f"T sl {{atcs_split_load N2 {{{{U2/A}} {{U9/D}}}} BUFX2 {{{PREFIX}s1 {PREFIX}s2}} "
            f"{{{PREFIX}sn1 {PREFIX}sn2}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("sl")[0], "OK", session.stdout)
        (call,) = session.calls_to("split_load")
        groups = [call[i + 1] for i, word in enumerate(call) if word == "-pin_group"]
        self.assertEqual(groups, ["pin:U2/A", "pin:U9/D"])

    def test_fast_observation_never_walks_the_whole_design(self):
        session = Session(self).run(
            f"set ::stub_fix_effect {{U1 BUFX4}}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
        )
        for tag in ("fix", "undo", "ins"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout)
        walks = [call for call in session.calls if call[0] in ("get_cells", "get_nets") and "-hierarchical" in call]
        self.assertEqual(walks, [])
        self.assertTrue(session.calls_to("count_eco_actions"))
        self.assertTrue(session.calls_to("get_eco_cells"))


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class TaintAndFailureTest(unittest.TestCase):
    def test_an_error_after_the_xtop_call_logs_uncertain_and_taints(self):
        session = Session(self).run(
            "set ::stub_fail {get_eco_cells}\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            "set ::stub_fail {}\n"
            f"T next {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            "T export {atcs_export_changes}\n"
            f'T dump {{atcs_dump_cells "{Path("/dev/null")}"}}\n'
        )
        status, message = session.outcome("size")
        self.assertEqual(status, "ERR")
        self.assertIn("tainted", message)
        self.assertEqual(session.ops[-1]["status"], "uncertain")
        self.assertIn("get_eco_cells", session.ops[-1]["error"])
        self.assertIn("tainted", session.outcome("next")[1])
        status, message = session.outcome("export")
        self.assertEqual(status, "ERR")
        self.assertIn("tainted", message)
        self.assertEqual(session.calls_to("write_design_changes"), [])
        self.assertEqual(session.outcome("dump")[0], "OK")
        marker = json.loads((session.root / "tainted.json").read_text(encoding="utf-8"))
        self.assertIn("get_eco_cells", marker["reason"])

    def test_close_reports_the_taint_state(self):
        clean = Session(self).run("T close {atcs_close}\n")
        self.assertIn("ATCS:taint:clean", clean.stdout)
        tainted = Session(self).run(
            "set ::stub_fail {get_eco_cells}\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            "T close {atcs_close}\n"
        )
        self.assertIn("ATCS:taint:tainted:", tainted.stdout)
        self.assertIn("tainted", tainted.outcome("close")[1])

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

    def test_a_gain_line_that_cannot_be_written_taints_but_keeps_the_edit_logged(self):
        session = Session(self).run(
            "T ref {atcs_ref}\n"
            "file delete [file join [file dirname $env(OPS_LOG)] gain.jsonl]\n"
            "file mkdir [file join [file dirname $env(OPS_LOG)] gain.jsonl]\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T next {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
        )
        status, message = session.outcome("size")
        self.assertEqual(status, "ERR")
        self.assertIn("gain.jsonl", message)
        self.assertEqual(session.ops[0]["status"], "kept")
        self.assertIn("tainted", session.outcome("next")[1])


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
        self.assertEqual(undo_lines[0]["discards"], [])
        self.assertEqual(undo_lines[0]["args"], {"planSha256": PLAN})
        self.assertEqual(undo_lines[0]["after"], {"instances": {f"{PREFIX}b1": None}})
        self.assertEqual(undo_lines[1]["after"], {"instances": {"U1": "BUFX1"}})
        self.assertEqual(len(session.calls_to("undo")), 2)
        self.assertEqual([gain["kind"] for gain in session.gains],
                         ["reference", "mutation", "mutation", "undo", "undo"])
        self.assertEqual(session.cells_line(), INITIAL_CELLS)

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
        self.assertIn("tainted", session.outcome("next")[1])
        self.assertEqual(session.outcome("read")[0], "OK")

    def test_a_move_undo_is_verified_by_eco_bookkeeping(self):
        session = Session(self).run(
            f"T mv {{atcs_move_cell U3 10 20 {PLAN}}}\n"
            "set ::stub_undo_broken 1\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("mv")[0], "OK", session.stdout)
        self.assertEqual(session.ops[0]["verified"], "eco-actions")
        self.assertEqual(session.outcome("undo")[0], "ERR")
        self.assertEqual(session.ops[-1]["status"], "uncertain")

    def test_undo_after_a_fix_that_changed_nothing_is_routine(self):
        session = Session(self).run(
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            f"T fix {{{SETUP} U1/A size_cell 0 0 medium 0.0 0.02 {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            f"T next {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        self.assertEqual(session.ops[1]["status"], "no-change")
        self.assertEqual(session.ops[1]["ecoActions"], 1)
        self.assertEqual(session.outcome("undo")[0], "OK", session.stdout)
        undo = session.ops[2]
        self.assertEqual((undo["undoes"], undo["discards"], undo["undoCalls"]), (1, [2], 2))
        self.assertEqual(session.outcome("next")[0], "OK", session.stdout)
        self.assertIn("U1=BUFX1", session.cells_line())

    def test_undo_of_a_multi_action_fix_undoes_every_action(self):
        session = Session(self).run(
            "set ::stub_fix_actions 3\nset ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        self.assertEqual(session.ops[0]["ecoActions"], 3)
        self.assertEqual(session.outcome("undo")[0], "OK", session.stdout)
        self.assertEqual(session.ops[1]["undoCalls"], 3)
        self.assertEqual(session.ops[1]["after"], {"instances": {"U1": "BUFX1"}})
        self.assertEqual(session.cells_line(), INITIAL_CELLS)

    def test_full_observation_undo_restores_the_whole_delta(self):
        session = Session(self, observe="full").run(
            f"set ::stub_fix_effect {{U1 BUFX4 {PREFIX}eco_1 DELAY1}}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        self.assertEqual(session.ops[0]["observe"], "full")
        self.assertEqual(session.ops[0]["before"], {"instances": {"U1": "BUFX1", f"{PREFIX}eco_1": None}})
        self.assertEqual(session.ops[0]["after"], {"instances": {"U1": "BUFX4", f"{PREFIX}eco_1": "DELAY1"}})
        self.assertEqual(session.outcome("undo")[0], "OK", session.stdout)
        self.assertEqual(session.ops[1]["undoes"], 1)
        self.assertEqual(session.ops[1]["after"], {"instances": {"U1": "BUFX1", f"{PREFIX}eco_1": None}})


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class TargetedFixTest(unittest.TestCase):
    def test_fix_hold_emits_only_whitelisted_flags_and_domain_pins(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{HOLD} {{U9/D U1/A}} high 0.01 0.02 0 1 0 4 3 {{DELAY1 DELAY2}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        (call,) = session.calls_to("fix_hold_gba_violations")
        self.assertLessEqual(_flags(call), FIX_HOLD_FLAGS)
        self.assertEqual(_after(call, "-only_pins"), "pin:U9/D pin:U1/A")
        self.assertEqual(_after(call, "-effort"), "high")
        self.assertEqual(_after(call, "-hold_target"), "0.01")
        self.assertEqual(_after(call, "-setup_margin"), "0.02")
        self.assertEqual(_after(call, "-max_cluster_loader_count"), "4")
        self.assertEqual(_after(call, "-max_delay_cell_length"), "3")
        self.assertEqual(_after(call, "-delay_cell_list"), "DELAY1 DELAY2")
        self.assertIn("-use_dummy_cell", call)
        self.assertNotIn("-size_cell_only", call)
        self.assertNotIn("-size_rule", call)
        self.assertEqual(session.ops[0]["cmd"], "fix_hold_gba_violations")
        self.assertEqual(session.ops[0]["status"], "kept")

    def test_hold_size_only_uses_the_qualified_nominal_rule_and_may_omit_effort(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{HOLD} U1/A omit 0.0 0.02 1 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        (call,) = session.calls_to("fix_hold_gba_violations")
        self.assertEqual(_flags(call), {"size_cell_only", "size_rule", "hold_target", "setup_margin", "only_pins"})
        self.assertEqual(_after(call, "-size_rule"), "nominal_keywords")
        self.assertEqual(call.index("-size_rule"), call.index("-size_cell_only") + 1)

    def test_fix_hold_omits_optional_flags_at_their_sentinels(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{HOLD} U1/A low 0.0 0.02 0 0 1 0 -1 {{}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        (call,) = session.calls_to("fix_hold_gba_violations")
        self.assertEqual(_flags(call), {"effort", "hold_target", "setup_margin", "fix_timing_window", "only_pins"})

    def test_fix_hold_refusals(self):
        refused = {
            "window_and_size_only": f"{HOLD} U1/A low 0.0 0.02 1 0 1 0 -1 {{}} {PLAN}",
            "window_needs_low_effort": f"{HOLD} U1/A high 0.0 0.02 0 0 1 0 -1 {{}} {PLAN}",
            "omit_needs_size_only": f"{HOLD} U1/A omit 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "cluster_high": f"{HOLD} U1/A medium 0.0 0.02 0 0 0 7 -1 {{}} {PLAN}",
            "cluster_fraction": f"{HOLD} U1/A medium 0.0 0.02 0 0 0 2.5 -1 {{}} {PLAN}",
            "delay_len_high": f"{HOLD} U1/A medium 0.0 0.02 0 0 0 0 6 DELAY1 {PLAN}",
            "delay_len_without_list": f"{HOLD} U1/A medium 0.0 0.02 0 0 0 0 2 {{}} {PLAN}",
            "delay_list_without_len": f"{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 DELAY1 {PLAN}",
            "effort": f"{HOLD} U1/A turbo 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "target_range": f"{HOLD} U1/A medium 0.5 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "margin_nan": f"{HOLD} U1/A medium 0.0 NaN 0 0 0 0 -1 {{}} {PLAN}",
            "flag_word": f"{HOLD} U1/A medium 0.0 0.02 yes 0 0 0 -1 {{}} {PLAN}",
            "no_pins": f"{HOLD} {{}} medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
            "option_as_pin": f"{HOLD} -effort medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}",
        }
        session = Session(self).run("".join(f"T {tag} {{{command}}}\n" for tag, command in refused.items()))
        for tag in refused:
            self.assertEqual(session.outcome(tag)[0], "ERR", tag)
        self.assertEqual(session.calls_to("fix_hold_gba_violations"), [])
        self.assertIn("fix_timing_window", session.outcome("window_and_size_only")[1])

    def test_fix_setup_emits_only_whitelisted_flags(self):
        session = Session(self).run(
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{SETUP} {{U9/D}} {{size_cell insert_buffer}} 0 0 high -0.01 0.02 {PLAN}}}\n"
            "set ::stub_fix_effect {U1 BUFX2}\n"
            f"T rb {{{SETUP} U1/A {{}} 1 0 medium 0.0 0.02 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        self.assertEqual(session.outcome("rb")[0], "OK", session.stdout)
        first, second = session.calls_to("fix_setup_gba_violations")
        self.assertLessEqual(_flags(first), FIX_SETUP_FLAGS)
        self.assertEqual(_after(first, "-methods"), "size_cell insert_buffer")
        self.assertEqual(_after(first, "-effort"), "high")
        self.assertEqual(_after(first, "-setup_target"), "-0.01")
        self.assertEqual(_after(first, "-hold_margin"), "0.02")
        self.assertEqual(_after(first, "-only_pins"), "pin:U9/D")
        self.assertEqual(_flags(second), {"remove_buffer_only", "effort", "setup_target", "hold_margin", "only_pins"})

    def test_fix_setup_refusals(self):
        refused = {
            "method": f"{SETUP} U1/A remove_buffer 0 0 medium 0.0 0.02 {PLAN}",
            "nothing": f"{SETUP} U1/A {{}} 0 0 medium 0.0 0.02 {PLAN}",
            "rb_and_methods": f"{SETUP} U1/A size_cell 1 0 medium 0.0 0.02 {PLAN}",
            "rb_and_down": f"{SETUP} U1/A {{}} 1 1 medium 0.0 0.02 {PLAN}",
            "target_range": f"{SETUP} U1/A size_cell 0 0 medium -0.3 0.02 {PLAN}",
            "low_effort": f"{SETUP} U1/A size_cell 0 0 low 0.0 0.02 {PLAN}",
            "pin": f"{SETUP} UOUT/A size_cell 0 0 medium 0.0 0.02 {PLAN}",
        }
        session = Session(self).run("".join(f"T {tag} {{{command}}}\n" for tag, command in refused.items()))
        for tag in refused:
            self.assertEqual(session.outcome(tag)[0], "ERR", tag)
        self.assertEqual(session.calls_to("fix_setup_gba_violations"), [])

    def test_fix_without_any_domain_pin_is_refused(self):
        session = Session(self, domain={"instances": [], "nets": []}, target_pins=[]).run(
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        status, message = session.outcome("fix")
        self.assertEqual(status, "ERR")
        self.assertIn("out-of-scope", message)


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class ObservedEffectConfinementTest(unittest.TestCase):
    """Edits whose full effect XTop decides are judged after the call, in both observation modes."""

    def _both(self):
        return (Session(self), Session(self, observe="full"))

    def test_an_out_of_domain_effect_is_undone_and_refused(self):
        for session in self._both():
            session.run(
                "set ::stub_fix_actions 2\nset ::stub_fix_effect {U1 BUFX4 UOUT BUFX4}\n"
                f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
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
            self.assertEqual(len(session.calls_to("undo")), 2)
            self.assertEqual(session.cells_line(), INITIAL_CELLS)
            self.assertIn("nothing to undo", session.outcome("undo")[1])

    def test_a_new_cell_without_the_name_prefix_is_out_of_domain(self):
        for session in self._both():
            session.run(
                "set ::stub_fix_effect {eco_foreign_1 BUFX2}\n"
                f"T fix {{{SETUP} U1/A size_cell 0 0 medium 0.0 0.02 {PLAN}}}\n"
            )
            self.assertEqual(session.outcome("fix")[0], "ERR")
            self.assertEqual(session.ops[0]["outOfDomain"], ["eco_foreign_1"])

    def test_an_out_of_domain_effect_that_undo_cannot_restore_taints_the_session(self):
        session = Session(self).run(
            "set ::stub_fix_effect {UOUT BUFX4}\nset ::stub_undo_broken 1\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T next {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "ERR")
        self.assertEqual(session.ops[0]["status"], "uncertain")
        self.assertIn("tainted", session.outcome("next")[1])

    def test_a_new_cell_on_an_existing_out_of_domain_net_is_undone(self):
        for session in self._both():
            session.run(
                f"set ::stub_fix_effect {{{PREFIX}eco_9 BUFX2}}\n"
                f"set ::stub_fix_pins {{{PREFIX}eco_9/A N9 {PREFIX}eco_9/Y {PREFIX}econ_1}}\n"
                f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            )
            status, message = session.outcome("fix")
            self.assertEqual(status, "ERR")
            self.assertIn(f"{PREFIX}eco_9@N9", message)
            self.assertEqual(session.ops[0]["status"], "reverted")

    def test_a_net_created_by_a_kept_edit_joins_the_domain_until_undone(self):
        cases = ((Session(self), f"{PREFIX}econ_1"), (Session(self, observe="full"), "NEWN"))
        for session, new_net in cases:
            session.run(
                f"set ::stub_fix_effect {{{PREFIX}eco_7 BUFX2}}\n"
                f"set ::stub_fix_pins {{{PREFIX}eco_7/A N1 {PREFIX}eco_7/Y {new_net}}}\n"
                f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
                f"T split {{atcs_split_net {new_net} BUFX2 cap 2 {PLAN}}}\n"
                f"T u1 {{atcs_undo {PLAN}}}\nT u2 {{atcs_undo {PLAN}}}\n"
                f"T again {{atcs_split_net {new_net} BUFX2 cap 2 {PLAN}}}\n"
            )
            for tag in ("fix", "split", "u1", "u2"):
                self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout)
            self.assertEqual(session.ops[0]["newNets"], [new_net])
            status, message = session.outcome("again")
            self.assertEqual(status, "ERR")
            self.assertIn(f"out-of-scope net: {new_net}", message)

    def test_an_eco_action_that_leaves_masters_unchanged_is_kept_and_undoable(self):
        for session in self._both():
            session.run(
                "set ::stub_fix_effect {U1 BUFX1}\n"
                f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
                f"T undo {{atcs_undo {PLAN}}}\n"
                f"T next {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            )
            self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
            op = session.ops[0]
            self.assertEqual(op["status"], "kept")
            self.assertEqual(op["verified"], "eco-actions")
            self.assertEqual(op["ecoCells"], ["U1"])
            self.assertEqual(op["before"], {"instances": {"U1": "BUFX1"}})
            self.assertEqual([gain["kind"] for gain in session.gains], ["reference", "mutation", "undo", "mutation"])
            self.assertEqual(session.outcome("undo")[0], "OK", session.stdout)
            self.assertEqual(session.ops[1]["undoes"], 1)
            self.assertEqual(session.outcome("next")[0], "OK", session.stdout)

    def test_an_eco_action_on_an_out_of_domain_cell_without_a_master_change_is_undone(self):
        for session in self._both():
            session.run(
                "set ::stub_fix_effect {UOUT BUFX1}\n"
                f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            )
            status, message = session.outcome("fix")
            self.assertEqual(status, "ERR")
            self.assertIn("UOUT", message)
            self.assertEqual(session.ops[0]["status"], "reverted")
            self.assertEqual(session.ops[0]["outOfDomain"], ["UOUT"])

    def test_fast_mode_refuses_a_new_net_it_cannot_prove_new(self):
        session = Session(self).run(
            f"set ::stub_fix_effect {{{PREFIX}eco_7 BUFX2}}\n"
            f"set ::stub_fix_pins {{{PREFIX}eco_7/A N1 {PREFIX}eco_7/Y NEWN}}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("fix")[0], "ERR")
        self.assertEqual(session.ops[0]["outOfDomain"], [f"{PREFIX}eco_7@NEWN"])

    def test_removing_a_domain_instance_on_an_out_of_domain_net_is_undone(self):
        for session in self._both():
            session.run(
                "set ::stub_fix_effect {U2 {}}\n"
                f"T fix {{{SETUP} U1/A {{}} 1 0 medium 0.0 0.02 {PLAN}}}\n"
                'puts "CELLS:[stub_cells]"\n'
            )
            status, message = session.outcome("fix")
            self.assertEqual(status, "ERR")
            self.assertIn("U2@N4", message)
            self.assertEqual(session.ops[0]["status"], "reverted")
            self.assertEqual(session.cells_line(), INITIAL_CELLS)

    def test_full_mode_sees_an_out_of_domain_cell_removed_as_a_side_effect(self):
        session = Session(self, observe="full").run(
            "set ::stub_remove_extra {UOUT}\n"
            f"T rm {{atcs_remove_buffer U3 {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        status, message = session.outcome("rm")
        self.assertEqual(status, "ERR")
        self.assertIn("UOUT", message)
        self.assertEqual(session.ops[0]["status"], "reverted")
        self.assertEqual(session.cells_line(), INITIAL_CELLS)

    def test_an_insert_that_xtop_names_differently_is_kept_and_flagged(self):
        session = Session(self, observe="full").run(
            "set ::stub_insert_hier u_core/\n"
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
            "set ::stub_insert_hier {}\n"
            f"T ok {{atcs_insert_buffer N1 U3/A BUFX2 {PREFIX}b2 {PREFIX}n2 {PLAN}}}\n"
        )
        self.assertEqual(session.outcome("ins")[0], "OK", session.stdout)
        self.assertIs(session.ops[0]["matchesRequest"], False)
        self.assertEqual(session.ops[0]["after"], {"instances": {f"u_core/{PREFIX}b1": "BUFX2"}})
        self.assertIs(session.ops[1]["matchesRequest"], True)

    def test_removable_fillers_are_exempt_and_logged(self):
        full = Session(self, observe="full").run(
            "set ::cells(FILL_1) FILL4\nset ::stub_insert_removes {FILL_1}\n"
            f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
        )
        self.assertEqual(full.outcome("ins")[0], "OK", full.stdout)
        self.assertEqual(full.ops[0]["fillers"], ["FILL_1"])
        self.assertEqual(full.ops[0]["after"], {"instances": {f"{PREFIX}b1": "BUFX2"}})
        fast = Session(self).run(
            "set ::cells(FILL_9) FILL2\nset ::stub_fix_effect {U1 BUFX4 FILL_9 FILL4}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        self.assertEqual(fast.outcome("fix")[0], "OK", fast.stdout)
        self.assertEqual(fast.ops[0]["fillers"], ["FILL_9"])
        self.assertEqual(fast.ops[0]["after"], {"instances": {"U1": "BUFX4"}})


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
        # No fix has run in this session, so XTop has no fail reasons to report yet (Task 7, real XTop).
        self.assertEqual(command, "summarize_gba_violations -with_delta -with_reference -exclude_path "
                                  "-with_top_n 7 -hold")
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


    def test_the_probe_asks_for_fail_reasons_only_after_a_fix_ran(self):
        # Real XTop, Task 7 (qual-issue64-chain-20260928, w01..w03): before any fix or optimize flow,
        # `-with_fail_reason` fails ("No fail reason since no fix or optimize flow have run yet.");
        # `-with_top_n` alone works. After a fix the probe carries the fail reasons.
        session = Session(self).run(
            "T before {atcs_gain setup 5}\n"
            f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
            "T after_size {atcs_gain setup 5}\n"
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            "T after_fix {atcs_gain hold 5}\n"
        )
        for tag in ("before", "size", "after_size", "fix", "after_fix"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout + session.stderr)
        probes = [gain for gain in session.gains if gain["kind"] == "probe"]
        self.assertEqual([next(iter(probe["checks"].values()))["command"] for probe in probes], [
            "summarize_gba_violations -with_delta -with_reference -exclude_path -with_top_n 5 -setup",
            "summarize_gba_violations -with_delta -with_reference -exclude_path -with_top_n 5 -setup",
            "summarize_gba_violations -with_delta -with_reference -exclude_path -with_top_n 5 -with_fail_reason -hold",
        ])
        self.assertTrue(all(next(iter(probe["checks"].values()))["code"] == 0 for probe in probes))


@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class CommittedFixTest(unittest.TestCase):
    """Real XTop commits a fix flow's actions (Task 7): `undo` cannot revert a targeted fix."""

    def test_undo_of_a_committed_fix_fails_changes_nothing_and_does_not_taint(self):
        session = Session(self).run(
            "set ::stub_fix_committed 1\nset ::stub_fix_effect {U1 BUFX4}\n"
            f"T fix {{{HOLD} U1/A medium 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T undo {{atcs_undo {PLAN}}}\n"
            f"T next {{atcs_size_cell U2 INVX2 {PLAN}}}\n"
            'puts "CELLS:[stub_cells]"\n'
        )
        self.assertEqual(session.outcome("fix")[0], "OK", session.stdout)
        status, message = session.outcome("undo")
        self.assertEqual(status, "ERR")
        self.assertIn("failed and changed nothing", message)
        self.assertEqual([op["status"] for op in session.ops], ["kept", "error", "kept"])
        self.assertEqual(session.outcome("next")[0], "OK", session.stdout)
        self.assertIn("U1=BUFX4", session.cells_line())
        self.assertFalse((session.root / "tainted.json").exists())

    def test_a_fix_that_may_insert_cells_needs_each_pin_net_in_the_domain(self):
        # Task 7 w01: a hold fix on a target pin whose net was outside the domain inserted a delay
        # cell there; XTop could not undo it, so the session was tainted. The toolkit now refuses such
        # a fix before XTop: hold fixes (unless size-only) and setup fixes that may insert or split.
        domain = {"instances": ["U1", "U2", "U3"], "nets": ["N1"], "regions": []}
        session = Session(self, domain=domain, target_pins=["U9/D"]).run(
            "set ::stub_fix_committed 1\n"
            f"T hold {{{HOLD} U9/D high 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
            f"T setup_insert {{{SETUP} U9/D {{size_cell insert_buffer}} 0 0 high 0.0 0.02 {PLAN}}}\n"
            f"T setup_split {{{SETUP} U9/D split_net 0 0 high 0.0 0.02 {PLAN}}}\n"
            "set ::stub_fix_effect {U1 BUFX4}\n"
            f"T hold_size {{{HOLD} U9/D omit 0.0 0.02 1 0 0 0 -1 {{}} {PLAN}}}\n"
            "set ::stub_fix_effect {U1 BUFX2}\n"
            f"T setup_size {{{SETUP} U9/D size_cell 0 0 high 0.0 0.02 {PLAN}}}\n"
            "set ::stub_fix_effect {U2 INVX2}\n"
            f"T hold_domain_net {{{HOLD} U1/A high 0.0 0.02 0 0 0 0 -1 {{}} {PLAN}}}\n"
        )
        for tag in ("hold", "setup_insert", "setup_split"):
            status, message = session.outcome(tag)
            self.assertEqual(status, "ERR", tag)
            self.assertIn("U9/D is on net N2 outside the edit domain", message)
        for tag in ("hold_size", "setup_size", "hold_domain_net"):
            self.assertEqual(session.outcome(tag)[0], "OK", tag + session.stdout)
        self.assertEqual(len(session.calls_to("fix_hold_gba_violations")), 2)
        self.assertEqual(len(session.calls_to("fix_setup_gba_violations")), 1)
        self.assertEqual([op["seq"] for op in session.ops], [1, 2, 3])

@unittest.skipUnless(TCLSH, "tclsh is not available in this environment")
class KnowledgeSurfaceTest(unittest.TestCase):
    """Every XTop command and option the toolkit emits is on the knowledge pack's command surface."""

    SCRIPT = (
        "T ref {atcs_ref}\n"
        "T gain {atcs_gain setup 10}\n"
        "T paths {atcs_paths setup 5 {U9/D}}\n"
        "T reasons {atcs_fail_reasons {U1/A} {legal_fail_no_space_on_row} {size_cell}}\n"
        "T c1 {atcs_candidates size_cell U1}\nT c2 {atcs_candidates insert_buffer U1/Y}\n"
        "T c3 {atcs_candidates exchange_cell U2}\n"
        f"T size {{atcs_size_cell U1 BUFX2 {PLAN}}}\n"
        f"set ::stub_exchange_effect {{U2 INVX2}}\nT exch {{atcs_exchange_cell U2 U1 {PLAN}}}\n"
        f"T ins {{atcs_insert_buffer N1 UOUT/A BUFX2 {PREFIX}b1 {PREFIX}n1 {PLAN}}}\n"
        f"T dummy {{atcs_insert_dummy U1/A BUFX1 {PREFIX}d1 {PLAN}}}\n"
        f"T sl {{atcs_split_load N2 {{{{U2/A}} {{U9/D}}}} BUFX2 {{{PREFIX}s1 {PREFIX}s2}} "
        f"{{{PREFIX}sn1 {PREFIX}sn2}} {PLAN}}}\n"
        f"T sn {{atcs_split_net N1 BUFX2 cap 2 {PLAN}}}\n"
        f"T mv {{atcs_move_cell U3 10.5 20 {PLAN}}}\n"
        f"T rm {{atcs_remove_buffer U3 {PLAN}}}\n"
        "set ::stub_fix_effect {U1 BUFX4}\n"
        f"T fh {{{HOLD} U1/A low 0.0 0.02 0 1 1 2 1 DELAY1 {PLAN}}}\n"
        "set ::stub_fix_effect {U1 BUFX1}\n"
        f"T fh2 {{{HOLD} U1/A omit 0.0 0.02 1 0 0 0 -1 {{}} {PLAN}}}\n"
        "set ::stub_fix_effect {U1 BUFX2}\n"
        f"T fs {{{SETUP} U1/A {{split_net}} 0 1 high 0.0 0.02 {PLAN}}}\n"
        f"T undo {{atcs_undo {PLAN}}}\n"
        f'T dump {{atcs_dump_cells "{Path("/dev/null")}"}}\n'
        "T export {atcs_export_changes}\n"
    )
    TAGS = ("ref", "gain", "paths", "reasons", "c1", "c2", "c3", "size", "exch", "ins", "dummy", "sl", "sn",
            "mv", "rm", "fh", "fh2", "fs", "undo", "dump", "export")

    def test_a_full_expert_session_stays_on_the_documented_surface(self):
        for observe in ("fast", "full"):
            session = Session(self, max_mutations=20, observe=observe).run(self.SCRIPT)
            for tag in self.TAGS:
                self.assertEqual(session.outcome(tag)[0], "OK", f"{observe} {tag}\n{session.stdout}{session.stderr}")
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
                            "list_exchange_cell_candidates", "count_eco_actions"):
                self.assertIn(command, emitted, observe)
            # Fast mode always reads get_eco_cells; full mode reads it for ECO actions that change no master.
            self.assertIn("get_eco_cells", emitted, observe)
            self.assertEqual([op["seq"] for op in session.ops], list(range(1, len(session.ops) + 1)))
            # Reference and every reading share the qualified flow's option set (real reports use -exclude_path).
            summaries = session.calls_to("summarize_gba_violations")
            self.assertTrue(summaries)
            for call in summaries:
                self.assertIn("-exclude_path", call, call)
            for gain in session.gains:
                for check in gain["checks"].values():
                    self.assertIn("-exclude_path", check["command"].split())
            (move,) = session.calls_to("move_cell")
            self.assertEqual(move[1:], ["-to", "10.5 20", "cell:U3"])
            self.assertEqual([op["status"] for op in session.ops if op["cmd"] == "move_cell"], ["kept"])


if __name__ == "__main__":
    unittest.main()
