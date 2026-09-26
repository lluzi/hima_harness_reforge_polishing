########################################################################
# xtop-replay.tcl -- M5's deterministic replay of one batch's ordered
# steps. Every step's command text is already fully determined by
# `atcs.integration.xtop_tcl(op)` (documented XTop commands only) before
# this file ever runs; this template performs no AI-driven choice, only
# mechanical apply-dump-log per step, so a lost receipt can always be
# recovered by re-reading the dumps rather than re-inserting an edit
# (architecture Sec.8.4).
#
# I3 (final review, XTop replay source): builds its own fresh XTop workspace
# from the batch's own base-state LEF/netlist/DEF -- the same shape a worker
# session's own `xtop-operator.tcl` startup uses -- never `open_workspace`
# on an Innovus `.enc` restore script (that command opens a previously
# *saved XTop* workspace, not an Innovus checkpoint; it could never have
# opened anything real against a `.enc` path).
#
# Required env vars: DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STEPS_TCL
#                     DUMP_DIR RECEIPTS_LOG
########################################################################
foreach required {DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STEPS_TCL DUMP_DIR RECEIPTS_LOG} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set cell_lefs [lsort [glob -nocomplain $env(CELL_LEF_GLOB)]]
set lef_files [linsert $cell_lefs 0 $env(TECH_LEF)]
foreach file [concat [list $env(NETLIST) $env(DEF)] $lef_files] {
    if {![file readable $file]} { error "required XTop input is not readable: $file" }
}
if {![file readable $env(STEPS_TCL)]} { error "STEPS_TCL is not readable: $env(STEPS_TCL)" }
file mkdir $env(DUMP_DIR)

set_parameter max_thread_number 8
create_workspace ${design}_replay -overwrite
link_reference_library -format lef $lef_files
create_design_definition -verilogs $env(NETLIST) -def $env(DEF)
set_site_map {unit core}
set_removable_fillers {FILL* DCAP*}
import_designs
check_placement_readiness

proc atcs_dump_cells {path} {
    # Same documented get_cells/foreach_in_collection/get_attribute pattern
    # as xtop-operator.tcl's own atcs_dump_cells -- see
    # knowledge/xtop-capabilities.md. No documented get_object_name exists.
    set fh [open $path w]
    foreach_in_collection i [get_cells -hierarchical] {
        set inst [get_attribute [get_cells $i] full_name]
        set master [get_attribute [get_cells $i] ref_name]
        puts $fh "$inst $master"
    }
    close $fh
}
proc atcs_receipt {json_line} {
    set fh [open $::env(RECEIPTS_LOG) a]
    puts $fh $json_line
    close $fh
}
proc atcs_json_escape {s} {
    return [string map {"\\" "\\\\" "\"" "\\\"" "\n" "\\n"} $s]
}

atcs_dump_cells $env(DUMP_DIR)/000.dump

# `STEPS_TCL` is generated per run by `atcs.adapters.compile_xtop_replay_task`;
# it calls `atcs_replay_step {stepId opTcl dumpIndex}` once per ordered step,
# stopping the batch (steps after a failure stay receipt-less, i.e. pending)
# the first time one op's command raises.
proc atcs_replay_step {stepId opTcl dumpIndex} {
    set before [format "%s/%03d.dump" $::env(DUMP_DIR) [expr {$dumpIndex - 1}]]
    set after [format "%s/%03d.dump" $::env(DUMP_DIR) $dumpIndex]
    if {[catch {uplevel #0 $opTcl} err]} {
        atcs_receipt "{\"stepId\":\"[atcs_json_escape $stepId]\",\"status\":\"error\",\"error\":\"[atcs_json_escape $err]\"}"
        error "replay stopped at step $stepId: $err"
    }
    atcs_dump_cells $after
    atcs_receipt "{\"stepId\":\"[atcs_json_escape $stepId]\",\"status\":\"ok\",\"beforeDump\":\"[atcs_json_escape $before]\",\"afterDump\":\"[atcs_json_escape $after]\"}"
}

source $env(STEPS_TCL)
exit 0
