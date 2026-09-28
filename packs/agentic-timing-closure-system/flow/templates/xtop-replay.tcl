########################################################################
# xtop-replay.tcl -- one arm of a generation's single XTop replay (Issue #64
# Task 6). `atcs.adapters.compile_recipe_replay_task` renders it twice, below
# the worker session's own `xtop-operator.tcl` (same workspace setup, legality,
# timing data and ECO parameters, and the same `atcs_*` toolkit procedures),
# and the replay job runs the two XTop processes from the same base together:
#
#   ::ATCS_ARM merged   000.dump; per ranked session (RECIPE_TCL): its kept
#                       commands through the toolkit procedures, confined to
#                       that session's own edit domain, name prefix and plan
#                       hash, as its worker session was, then NNN.dump;
#                       set_dont_touch on every instance the applied commands
#                       changed; auto-finish (AUTO_FIX_TCL: the control arm's
#                       plain auto-fix; empty when autoFinish is off);
#                       auto.dump; the final summaries and fail reasons; one
#                       Innovus ECO pair into eco/.
#   ::ATCS_ARM control  000.dump; the old flow's qualified plain auto-fix
#                       (AUTO_FIX_TCL); auto.dump; the final summaries and fail
#                       reasons; one Innovus ECO pair into eco-control/.
#
# Best effort: a recipe command the composition
# marked skip is never sent; a command that errors or that the toolkit refuses
# is recorded as skipped with its reason, and the replay continues. Each
# auto-fix line is attempted once and its code recorded. The Pack chooses the
# arm afterwards (`atcs.integration.reconcile_recipe`); this file never judges.
#
# Outputs (cwd is RUN_ROOT, set by xtop-operator.tcl):
#   RECEIPTS_LOG  one JSON line per recipe command:
#                 {"stepId","slot","status":"applied"|"skipped","attempted",
#                  ["reason"],["seq"]} (seq = this run's ops.jsonl line)
#   DUMP_DIR      000.dump, 001.dump .. (one per session), auto.dump
#   PREDICT_DIR   setup.rpt, hold.rpt: summarize_gba_violations -exclude_path;
#                 setup-fail-reasons.rpt, hold-fail-reasons.rpt: the same with
#                 -with_top_n FAIL_REASON_TOP_N -with_fail_reason, after auto-fix
#   ARM_RESULT    {"arm","complete":true,"tainted","protected","protectMissing","protectCode",
#                  "protectResult","autoFix":[{command,code,result}],
#                  "predict":{"setup","hold"},"failReasons":{"setup","hold"},
#                  "exportCode","exportResult"},
#                 written last: its absence means the run never finished.
#
# Required env vars: RECIPE_TCL AUTO_FIX_TCL AUTO_PREFIX RECEIPTS_LOG DUMP_DIR
#                    PREDICT_DIR ARM_RESULT FAIL_REASON_TOP_N (plus xtop-operator.tcl's own)
########################################################################
foreach required {RECIPE_TCL AUTO_FIX_TCL AUTO_PREFIX RECEIPTS_LOG DUMP_DIR PREDICT_DIR ARM_RESULT FAIL_REASON_TOP_N} {
    if {![info exists env($required)]} { error "$required is required" }
}
atcs_int FAIL_REASON_TOP_N $env(FAIL_REASON_TOP_N) 1 100
if {![info exists ::ATCS_ARM] || [lsearch -exact {merged control} $::ATCS_ARM] < 0} {
    error "ATCS_ARM must be merged or control"
}
foreach file [list $env(RECIPE_TCL) $env(AUTO_FIX_TCL)] {
    if {![file readable $file]} { error "replay input is not readable: $file" }
}
file mkdir $env(DUMP_DIR)
file mkdir $env(PREDICT_DIR)
set ::atcs_replay_slot ""

proc atcs_replay_receipt {fields} {
    atcs_append $::env(RECEIPTS_LOG) [atcs_jobj $fields]
}
# Enter one ranked session: its own edit domain, new-object prefix and plan
# hash, as its worker session had them. The toolkit pins one plan hash per
# session and treats objects a session created as its own domain, so both are
# reset: a session never edits another session's objects.
proc atcs_replay_session {slot prefix instances nets pins regions} {
    if {[llength $regions] % 4 != 0} { error "session $slot regions must hold x1 y1 x2 y2 boxes" }
    foreach value $regions {
        if {![string is double -strict $value]} { error "session $slot regions hold a non-number '$value'" }
    }
    set ::atcs_replay_slot $slot
    set ::EDIT_DOMAIN_INSTANCES $instances
    set ::EDIT_DOMAIN_NETS $nets
    set ::EDIT_DOMAIN_PINS $pins
    set ::EDIT_DOMAIN_REGIONS $regions
    set ::atcs_session_instances {}
    set ::atcs_session_nets {}
    set ::env(NAME_PREFIX) $prefix
    set ::atcs_plan_sha256 ""
    set_parameter eco_new_object_prefix "${prefix}eco"
}
proc atcs_replay_step {step_id skip call} {
    set fields [list stepId [atcs_js $step_id] slot [atcs_js $::atcs_replay_slot]]
    if {$skip} {
        atcs_replay_receipt [concat $fields [list status [atcs_js skipped] attempted false reason [atcs_js recipe]]]
        return
    }
    set kept [llength $::atcs_kept]
    set code [catch {uplevel #0 $call} message]
    if {$code == 0 && [llength $::atcs_kept] > $kept} {
        atcs_replay_receipt [concat $fields [list status [atcs_js applied] attempted true seq [lindex $::atcs_kept end]]]
    } else {
        set reason [expr {$code == 0 ? "no-change" : [atcs_clip $message 2000]}]
        atcs_replay_receipt [concat $fields [list status [atcs_js skipped] attempted true reason [atcs_js $reason]]]
    }
}
proc atcs_replay_session_end {index} {
    atcs_dump_cells [format "%s/%03d.dump" $::env(DUMP_DIR) $index]
}
# Every instance an applied command changed and that still exists: the masters
# the kept toolkit lines recorded on their `after` side.
proc atcs_replay_protected {} {
    set names {}
    foreach seq $::atcs_kept {
        dict for {name master} [dict get $::atcs_op($seq) after] {
            if {$master ne "" && [lsearch -exact $names $name] < 0} { lappend names $name }
        }
    }
    return [lsort $names]
}
proc atcs_replay_read_lines {path} {
    set fh [open $path r]
    set text [read $fh]
    close $fh
    set lines {}
    foreach line [split $text "\n"] {
        if {[string trim $line] ne ""} { lappend lines $line }
    }
    return $lines
}

atcs_dump_cells [file join $env(DUMP_DIR) 000.dump]
source $env(RECIPE_TCL)

# Only instances that still exist are protected (a later command may have removed
# one); a missing name is recorded rather than failing the whole protection.
set protected {}
set protect_missing {}
set protect_code 0
set protect_result ""
if {$::ATCS_ARM eq "merged"} {
    foreach name [atcs_replay_protected] {
        if {[sizeof_collection [get_cells -quiet -exact $name]] == 1} {
            lappend protected $name
        } else {
            lappend protect_missing $name
        }
    }
    if {[llength $protected] > 0} {
        set protect_code [catch {set_dont_touch [get_cells -exact $protected] true} protect_result]
    }
}

# Auto-fix objects carry the batch's own prefix, never a worker's.
set ::env(NAME_PREFIX) $env(AUTO_PREFIX)
set_parameter eco_new_object_prefix "$env(AUTO_PREFIX)eco"
set auto_fix {}
foreach line [atcs_replay_read_lines $env(AUTO_FIX_TCL)] {
    set code [catch {uplevel #0 $line} result]
    lappend auto_fix [atcs_jobj [list command [atcs_js $line] code $code result [atcs_js [atcs_clip $result 2000]]]]
}
atcs_dump_cells [file join $env(DUMP_DIR) auto.dump]

set predict_setup [catch {redirect -file [file join $env(PREDICT_DIR) setup.rpt] {summarize_gba_violations -exclude_path -setup}}]
set predict_hold [catch {redirect -file [file join $env(PREDICT_DIR) hold.rpt] {summarize_gba_violations -exclude_path -hold}}]
# What auto-fix left unfixed, and why (the atcs_gain probe's fail-reason reading, without a reference).
set fail_reason_codes {}
foreach check {setup hold} {
    lappend fail_reason_codes $check [catch {redirect -file [file join $env(PREDICT_DIR) $check-fail-reasons.rpt] \
        [list summarize_gba_violations -exclude_path -with_top_n $env(FAIL_REASON_TOP_N) -with_fail_reason -$check]}]
}

if {$::ATCS_ARM eq "merged"} {
    file mkdir eco
    set export_code [catch {write_design_changes -format INNOVUS -eco_file_prefix atcs_batch -output_dir eco -keep_route} export_result]
} else {
    file mkdir eco-control
    set export_code [catch {write_design_changes -format INNOVUS -eco_file_prefix atcs_batch -output_dir eco-control -keep_route} export_result]
}

set fh [open $env(ARM_RESULT) w]
fconfigure $fh -encoding utf-8
puts $fh [atcs_jobj [list arm [atcs_js $::ATCS_ARM] complete true tainted [atcs_js $::atcs_tainted] \
    protected [atcs_jarr $protected] protectMissing [atcs_jarr $protect_missing] protectCode $protect_code protectResult [atcs_js [atcs_clip $protect_result 2000]] \
    autoFix "\[[join $auto_fix ,]\]" predict [atcs_jobj [list setup $predict_setup hold $predict_hold]] \
    failReasons [atcs_jobj $fail_reason_codes] \
    exportCode $export_code exportResult [atcs_js [atcs_clip $export_result 2000]]]]
close $fh
exit 0
