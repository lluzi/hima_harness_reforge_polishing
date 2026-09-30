########################################################################
# xtop-operator.tcl -- typed XTop Operator session startup (batch-launched,
# then driven by the Harness's interactive Tcl-line adapter; see
# `.superpowers/sdd/pack-mechanics.md` section 1.8). Only the read/mutate/
# save/close procedures a Pack's `contract.yml` classifies are meant to be
# invoked once this prints its ready line -- everything above that line is
# fixed session setup, never itself a typed command.
#
# Required env vars: DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STA_DATA
#                     RUN_ROOT ECO_PREFIX NAME_PREFIX
########################################################################
foreach required {DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF RUN_ROOT ECO_PREFIX NAME_PREFIX LIBRARY_TCL STA_DATA ECO_CELL_CLASSIFY_RULE ECO_CELL_MATCH_ATTRIBUTE ECO_CELL_NOMINAL_SIZING_PATTERN ECO_GAIN_THRESHOLD} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set operator_root [file normalize $env(RUN_ROOT)]
set eco_output_dir [file join $operator_root eco_output]
set cell_lefs [lsort [glob -nocomplain $env(CELL_LEF_GLOB)]]
set lef_files [linsert $cell_lefs 0 $env(TECH_LEF)]
foreach file [concat [list $env(NETLIST) $env(DEF) $env(LIBRARY_TCL)] $lef_files] {
    if {![file readable $file]} { error "required XTop input is not readable: $file" }
}
if {![file isdirectory $env(STA_DATA)]} { error "PrimeTime timing-data directory is missing" }
cd $operator_root
set_parameter max_thread_number 8
create_workspace ${design}_operator -overwrite
link_reference_library -format lef $lef_files
create_design_definition -verilogs $env(NETLIST) -def $env(DEF)
set_site_map $::XTOP_SITE_MAP
set_removable_fillers $::XTOP_REMOVABLE_FILLERS
import_designs
check_placement_readiness
source $env(LIBRARY_TCL)
read_timing_data -data_dir $env(STA_DATA)
check_inst_reference_library
check_inst_timing_library
set_parameter eco_new_object_prefix "$env(NAME_PREFIX)eco"
set_parameter eco_buffer_list_for_hold $::XTOP_ECO_BUFFER_LIST_FOR_HOLD
set_parameter eco_buffer_list_for_setup $::XTOP_ECO_BUFFER_LIST_FOR_SETUP
set_parameter eco_cell_classify_rule $env(ECO_CELL_CLASSIFY_RULE)
set_parameter eco_cell_match_attribute $env(ECO_CELL_MATCH_ATTRIBUTE)
set_parameter eco_cell_nominal_swap_keywords $::XTOP_ECO_CELL_NOMINAL_SWAP_KEYWORDS
set_parameter eco_cell_nominal_sizing_pattern $env(ECO_CELL_NOMINAL_SIZING_PATTERN)
set_parameter eco_gain_threshold $env(ECO_GAIN_THRESHOLD)
save_workspace -as ${design}_operator_baseline

########################################################################
# XTop expert toolkit (Issue #64 Task 3). The typed procedures an Operator
# agent drives, classified in contract.yml `interactive.commands`:
#
#   read    atcs_ref atcs_gain atcs_paths atcs_fail_reasons atcs_candidates
#   mutate  atcs_size_cell atcs_exchange_cell atcs_insert_buffer
#           atcs_insert_dummy atcs_split_load atcs_split_net atcs_move_cell
#           atcs_remove_buffer atcs_fix_hold_pins atcs_fix_setup_pins atcs_undo
#
# Every mutation, in this order: refuses a tainted session; checks the plan
# hash (64 hex, pinned to the first mutation that reaches XTop); refuses once
# ::ATCS_MAX_MUTATIONS mutations reached XTop; validates every argument and
# refuses any object outside the edit domain (::EDIT_DOMAIN_INSTANCES/NETS/
# PINS/REGIONS plus the objects this session created) before XTop is called;
# captures the session reference once; records the pre-call observation; then,
# inside one guard, calls XTop, observes the result, undoes an out-of-domain
# effect at once, and appends one ops.jsonl line. Any unexpected error after
# the call logs an `uncertain` line if it can and taints the session. A kept
# edit is followed by one gain.jsonl line. Refusals before XTop are not logged
# and do not use the budget.
#
# Observation (::ATCS_OBSERVE). The Contribution capture's before/after dump
# delta is the authoritative confinement check; these are defence in depth:
#   fast  (default) count_eco_actions before/after, get_eco_cells -last_n for
#         the cells the call's ECO actions touched, the domain instances' own
#         masters and nets. No whole-design walk.
#   full  adds whole-design cell and net snapshots (get_cells/get_nets
#         -hierarchical); Task 7 uses it to cross-check the fast path.
# Cells whose master matches ::XTOP_REMOVABLE_FILLERS are exempt and logged.
#
# Every XTop command and option emitted here is on the XTop knowledge pack's
# evidence/command_surface.tsv.
#
# ops.jsonl (OPS_LOG), one line per mutation that reached XTop, seq 1, 2, ...:
#   {"seq","cmd","proc"[,"undoes","discards","undoCalls"],"args","status",
#    "observe","ecoActions","before","after"[,"newNets"][,"fillers"],"xtop"
#    [,"verified"][,"ecoCells"][,"matchesRequest"][,"outOfDomain","undo"][,"error"]}
#   cmd     the XTop command (size_cell ... fix_setup_gba_violations, undo)
#   args    the procedure's named arguments, as the Host sent them
#   status  kept | no-change | error | reverted | uncertain
#   ecoActions  count_eco_actions after minus before (a checkpoint XTop holds)
#   before/after {"instances": {name: master | null}}: the observed delta
#           (null = absent); move_cell records its instance's master
#   newNets nets created by the edit that its new instances sit on
#   fillers exempt removable-filler cells the edit touched
#   xtop    {"command","code","result"}: the Tcl command and XTop's return
#   verified "eco-actions" when cell masters cannot show the effect: move_cell,
#           or a fix whose ECO actions touched domain cells without a master
#           change (those cells are listed under "ecoCells")
#   matchesRequest  whether the delta holds the named new/removed instances
#   outOfDomain, undo  the refused objects and the immediate XTop undo calls
#   error   the unexpected Tcl error that made the line uncertain
# Every summarize_gba_violations call carries -exclude_path, as the qualified
# flow's reports do, so the reference and every reading share one option set.
# gain.jsonl (beside ops.jsonl): {"seq","kind","checks":{"setup"|"hold":
#   {"command","code","result","text"}}[,"topN"]}, kind reference | mutation
#   | undo | probe; seq is the ops.jsonl line it follows (0 = session start).
# tainted.json (beside ops.jsonl) exists once the session is tainted:
#   {"reason","seq"}; atcs_export_changes then refuses, and atcs_close prints
#   ATCS:taint:tainted:<reason> (else ATCS:taint:clean) to the transcript.
########################################################################
foreach {atcs_name atcs_default} {EDIT_DOMAIN_INSTANCES {} EDIT_DOMAIN_NETS {} EDIT_DOMAIN_PINS {}
        EDIT_DOMAIN_REGIONS {} ATCS_MAX_MUTATIONS 1 ATCS_OBSERVE fast XTOP_REMOVABLE_FILLERS {}
        EDIT_DOMAIN_LOCAL 0 ATCS_LOCAL_FANOUT_MAX 12} {
    if {![info exists ::$atcs_name]} { set ::$atcs_name $atcs_default }
}
if {![regexp {^[1-9][0-9]*$} $::ATCS_MAX_MUTATIONS]} {
    error "ATCS_MAX_MUTATIONS must be a positive integer, got '$::ATCS_MAX_MUTATIONS'"
}
if {[lsearch -exact {fast full} $::ATCS_OBSERVE] < 0} { error "ATCS_OBSERVE must be fast or full" }
if {[llength $::EDIT_DOMAIN_REGIONS] % 4 != 0} { error "EDIT_DOMAIN_REGIONS must hold x1 y1 x2 y2 boxes" }
foreach atcs_value $::EDIT_DOMAIN_REGIONS {
    if {![string is double -strict $atcs_value]} { error "EDIT_DOMAIN_REGIONS holds a non-number '$atcs_value'" }
}
set ::atcs_seq 0
set ::atcs_mutations 0
set ::atcs_plan_sha256 ""
set ::atcs_tainted ""
set ::atcs_reference_captured 0
set ::atcs_fix_ran ""
set ::atcs_kept {}
set ::atcs_stack {}
set ::atcs_session_instances {}
set ::atcs_session_nets {}
array set ::atcs_op {}
set ::ATCS_SLACK_LIMIT 0.2
set ::ATCS_HOLD_EFFORTS {omit low medium high ultra_high extreme_high}
set ::ATCS_SETUP_EFFORTS {medium high}
set ::ATCS_FIX_SETUP_METHODS {size_cell insert_buffer split_net}
set ::ATCS_FAIL_REASON_METHODS {insert_buffer size_cell split_net remove_buffer move_cell}

# ---- JSON ------------------------------------------------------------------
set ::atcs_json_map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t" "\b" "\\b" "\f" "\\f"]
for {set atcs_i 0} {$atcs_i < 32} {incr atcs_i} {
    if {[lsearch -exact {8 9 10 12 13} $atcs_i] < 0} {
        lappend ::atcs_json_map [format %c $atcs_i] [format "\\u%04x" $atcs_i]
    }
}
proc atcs_js {s} { return "\"[string map $::atcs_json_map $s]\"" }
proc atcs_jarr {items} {
    set out {}
    foreach item $items { lappend out [atcs_js $item] }
    return "\[[join $out ,]\]"
}
proc atcs_jints {items} { return "\[[join $items ,]\]" }
proc atcs_jobj {pairs} {
    set out {}
    foreach {key value} $pairs { lappend out "[atcs_js $key]:$value" }
    return "{[join $out ,]}"
}
proc atcs_jbool {flag} { return [expr {$flag ? "true" : "false"}] }
proc atcs_clip {s limit} {
    if {[string length $s] <= $limit} { return $s }
    return "[string range $s 0 [expr {$limit - 1}]]...\[truncated\]"
}
proc atcs_append {path line} {
    set fh [open $path a]
    fconfigure $fh -encoding utf-8
    puts $fh $line
    close $fh
}
proc atcs_gain_path {} { return [file join [file dirname $::env(OPS_LOG)] gain.jsonl] }
proc atcs_taint_path {} { return [file join [file dirname $::env(OPS_LOG)] tainted.json] }

# ---- argument validation ---------------------------------------------------
proc atcs_check_name {kind value} {
    if {$value eq "" || [string index $value 0] eq "-" || [regexp {[[:cntrl:]]} $value]
            || ![regexp {^[^\s{}"\\;$*?]+$} $value]} {
        error "invalid $kind name '$value'"
    }
    return $value
}
proc atcs_check_master {value} {
    if {![regexp {^[A-Za-z0-9_]+$} $value]} { error "invalid library cell '$value'" }
    return $value
}
proc atcs_list {label value {min 0} {unique 1}} {
    if {![string is list $value]} { error "$label must be a Tcl list" }
    if {[llength $value] < $min} { error "$label needs at least $min entr[expr {$min == 1 ? "y" : "ies"}]" }
    if {$unique && [llength [lsort -unique $value]] != [llength $value]} { error "$label repeats an entry" }
    return [lrange $value 0 end]
}
proc atcs_number {label value min max} {
    if {![regexp {^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?$} $value]
            || [expr {double($value) < $min || double($value) > $max}]} {
        error "$label must be a number in \[$min, $max\], got '$value'"
    }
    return $value
}
proc atcs_int {label value min max} {
    if {![regexp {^-?(0|[1-9][0-9]*)$} $value] || $value < $min || $value > $max} {
        error "$label must be an integer in \[$min, $max\], got '$value'"
    }
    return $value
}
proc atcs_flag {label value} {
    if {$value ne "0" && $value ne "1"} { error "$label must be 0 or 1, got '$value'" }
    return $value
}
proc atcs_choice {label value choices} {
    if {[lsearch -exact $choices $value] < 0} { error "$label must be one of [join $choices {, }], got '$value'" }
    return $value
}

# ---- XTop object queries ---------------------------------------------------
# Mutations pass exact collections (`get_cells/get_pins/get_nets -exact`), never
# name patterns, so a bus-bit name such as reg[3] is never read as a glob.
proc atcs_cell_master {name} {
    set cell [get_cells -quiet -exact $name]
    if {[sizeof_collection $cell] == 0} { return "" }
    return [get_attribute $cell ref_name]
}
proc atcs_pin_object {pin} {
    set object [get_pins -quiet -exact $pin]
    if {[sizeof_collection $object] != 1} { error "out-of-scope pin: $pin does not name exactly one pin" }
    return $object
}
proc atcs_pin_net {pin} {
    set net [get_nets -of_objects [atcs_pin_object $pin]]
    if {[sizeof_collection $net] != 1} { error "out-of-scope pin: $pin is not on exactly one net" }
    return [get_attribute $net full_name]
}
proc atcs_pin_owner {pin} {
    set object [get_pins -quiet -exact $pin]
    if {[sizeof_collection $object] != 1} { return "" }
    set cell [get_cells -quiet -of_objects $object]
    if {[sizeof_collection $cell] != 1} { return "" }
    return [get_attribute $cell full_name]
}
proc atcs_instance_nets {name} {
    set nets {}
    set cell [get_cells -quiet -exact $name]
    if {[sizeof_collection $cell] == 0} { return $nets }
    foreach_in_collection pin [get_pins -quiet -of_objects $cell] {
        set net [get_nets -quiet -of_objects $pin]
        if {[sizeof_collection $net] == 1} { lappend nets [get_attribute $net full_name] }
    }
    return [lsort -unique $nets]
}
proc atcs_state {instances} {
    set state [dict create]
    foreach name $instances { dict set state $name [atcs_cell_master $name] }
    return $state
}
proc atcs_state_json {state} {
    set pairs {}
    dict for {name master} $state { lappend pairs $name [expr {$master eq "" ? "null" : [atcs_js $master]}] }
    return [atcs_jobj [list instances [atcs_jobj $pairs]]]
}
proc atcs_state_equal {a b} {
    if {[dict size $a] != [dict size $b]} { return 0 }
    dict for {name master} $a {
        if {![dict exists $b $name] || [dict get $b $name] ne $master} { return 0 }
    }
    return 1
}
# Whole-design instance -> master map (observe full), one get_cells per cell.
proc atcs_snapshot {} {
    set snap [dict create]
    foreach_in_collection i [get_cells -hierarchical] {
        set cell [get_cells $i]
        dict set snap [get_attribute $cell full_name] [get_attribute $cell ref_name]
    }
    return $snap
}
proc atcs_net_snapshot {} {
    set nets [dict create]
    foreach_in_collection n [get_nets -hierarchical] { dict set nets [get_attribute [get_nets $n] full_name] 1 }
    return $nets
}
# name -> {before after} for every instance whose master differs ("" = absent).
proc atcs_diff {s0 s1} {
    set delta [dict create]
    dict for {name master} $s0 {
        set now [expr {[dict exists $s1 $name] ? [dict get $s1 $name] : ""}]
        if {$now ne $master} { dict set delta $name [list $master $now] }
    }
    dict for {name master} $s1 {
        if {![dict exists $s0 $name]} { dict set delta $name [list "" $master] }
    }
    return $delta
}
proc atcs_delta_side {delta index} {
    set side [dict create]
    dict for {name pair} $delta { dict set side $name [lindex $pair $index] }
    return $side
}
proc atcs_is_filler {master} {
    if {$master eq ""} { return 0 }
    foreach pattern $::XTOP_REMOVABLE_FILLERS {
        if {[string match $pattern $master]} { return 1 }
    }
    return 0
}
proc atcs_eco_count {} {
    set count [count_eco_actions]
    if {![regexp {^[0-9]+$} $count]} { error "count_eco_actions returned '$count', not a count" }
    return $count
}
# Existing cells the last `n` ECO actions touched.
proc atcs_eco_cells {n} {
    set names {}
    if {$n <= 0} { return $names }
    foreach_in_collection cell [get_eco_cells -last_n $n] { lappend names [get_attribute $cell full_name] }
    return [lsort -unique $names]
}

# ---- edit domain -----------------------------------------------------------
proc atcs_member {items value} { return [expr {[lsearch -exact $items $value] >= 0}] }
proc atcs_instance_in_domain {name} {
    return [expr {[atcs_member $::EDIT_DOMAIN_INSTANCES $name] || [atcs_member $::atcs_session_instances $name]}]
}
proc atcs_net_in_domain {name} {
    return [expr {[atcs_member $::EDIT_DOMAIN_NETS $name] || [atcs_member $::atcs_session_nets $name]}]
}
proc atcs_leaf_prefixed {name} {
    return [expr {[string first $::env(NAME_PREFIX) [lindex [split $name /] end]] == 0}]
}
proc atcs_domain_instances {} {
    return [lsort -unique [concat $::EDIT_DOMAIN_INSTANCES $::atcs_session_instances]]
}
proc atcs_require_instance {name} {
    atcs_check_name instance $name
    if {![atcs_instance_in_domain $name]} { error "out-of-scope instance: $name" }
}
proc atcs_require_net {name} {
    atcs_check_name net $name
    if {![atcs_net_in_domain $name]} { error "out-of-scope net: $name" }
}
proc atcs_require_pin_on_net {pin net} {
    atcs_check_name pin $pin
    set actual [atcs_pin_net $pin]
    if {$actual ne $net} { error "out-of-scope pin: $pin is on net $actual, not $net" }
}
# A pin a targeted fix may name: a work-package target pin, or a pin of a domain instance.
proc atcs_require_domain_pin {pin} {
    atcs_check_name pin $pin
    if {[atcs_member $::EDIT_DOMAIN_PINS $pin]} { return }
    set owner [atcs_pin_owner $pin]
    if {$owner ne "" && [atcs_instance_in_domain $owner]} { return }
    error "out-of-scope pin: $pin"
}
# Removing an instance merges its nets: every one of them must be in the domain.
# XTop commits a fix flow's actions: `undo` cannot revert them ("The committed actions cannot be
# undone.", real XTop, Issue #64 Task 7). A fix that may insert cells (a hold fix unless it is
# size-only without a dummy cell; a setup fix with insert_buffer or split_net) must have each
# -only_pins pin's net in the domain, or an out-of-domain insertion could only taint the session.
# For a hold fix that is the net the delay or dummy cell goes on. For setup insert_buffer/split_net
# the check is necessary but not sufficient: XTop may buffer or split an upstream net of the path
# through a pin's cell, which only the after-call observation (and the capture's dump delta) sees.
proc atcs_require_pin_nets {pins} {
    foreach pin $pins {
        set net [atcs_pin_net $pin]
        if {![atcs_net_in_domain $net]} {
            error "out-of-scope pin: $pin is on net $net outside the edit domain; a fix that may insert cells there cannot be undone"
        }
    }
}
proc atcs_require_instance_nets {name} {
    foreach net [atcs_instance_nets $name] {
        if {![atcs_net_in_domain $net]} { error "out-of-scope net: $net (on $name)" }
    }
}
proc atcs_require_point {x y} {
    foreach {x1 y1 x2 y2} $::EDIT_DOMAIN_REGIONS {
        if {$x >= $x1 && $x <= $x2 && $y >= $y1 && $y <= $y2} { return }
    }
    error "out-of-scope point ($x, $y): outside every edit-domain region"
}
proc atcs_require_new_names {kind names} {
    set prefix $::env(NAME_PREFIX)
    foreach name $names {
        if {[string first $prefix $name] != 0 || [string length $name] <= [string length $prefix]
                || ![regexp {^[A-Za-z0-9_]+$} $name]} {
            error "new $kind name '$name' must be $prefix followed by letters, digits or underscores"
        }
        if {$kind eq "instance" && [atcs_cell_master $name] ne ""} { error "new instance name '$name' already exists" }
    }
}

# ---- observation -----------------------------------------------------------
# Before the XTop call: the ECO action count, the domain instances' masters and
# nets, and in full mode whole-design cell and net snapshots.
proc atcs_observe_before {} {
    set domain [atcs_domain_instances]
    set nets [dict create]
    foreach name $domain { dict set nets $name [atcs_instance_nets $name] }
    set pre [dict create count [atcs_eco_count] domain [atcs_state $domain] nets $nets]
    if {$::ATCS_OBSERVE eq "full"} {
        dict set pre cells [atcs_snapshot]
        dict set pre netset [atcs_net_snapshot]
    }
    return $pre
}
# After the XTop call: {count delta outOfDomain newNets fillers}. The delta holds
# in-domain changes and created instances (fillers excluded); outOfDomain holds
# out-of-domain instances, and instance@net for a created instance on a
# pre-existing out-of-domain net or a removed instance with an out-of-domain net.
proc atcs_observe_after {pre} {
    set c0 [dict get $pre count]
    set c1 [atcs_eco_count]
    set d0 [dict get $pre domain]
    set delta [dict create]
    set bad {}
    set fillers {}
    if {$::ATCS_OBSERVE eq "full"} {
        dict for {name pair} [atcs_diff [dict get $pre cells] [atcs_snapshot]] {
            lassign $pair m0 m1
            if {![atcs_instance_in_domain $name] && ([atcs_is_filler $m0] || [atcs_is_filler $m1])} {
                lappend fillers $name
            } elseif {$m0 eq ""} {
                if {[atcs_leaf_prefixed $name]} { dict set delta $name $pair } else { lappend bad $name }
            } elseif {[atcs_instance_in_domain $name]} {
                dict set delta $name $pair
            } else {
                lappend bad $name
            }
        }
    } else {
        dict for {name m0} $d0 {
            set m1 [atcs_cell_master $name]
            if {$m1 ne $m0} { dict set delta $name [list $m0 $m1] }
        }
        set reported [atcs_eco_cells [expr {$c1 - $c0}]]
        foreach name $reported {
            if {[dict exists $d0 $name]} { continue }
            set m1 [atcs_cell_master $name]
            if {[atcs_is_filler $m1]} {
                lappend fillers $name
            } elseif {[atcs_leaf_prefixed $name]} {
                dict set delta $name [list "" $m1]
            } else {
                lappend bad $name
            }
        }
    }
    # The cells every ECO action touched, moves, reconnects and swaps included: one outside
    # the domain is out of domain even beside an in-domain master change (full mode diffs
    # masters only). A call that changed no master keeps its domain cells as `ecoCells`.
    set eco_cells {}
    if {$c1 > $c0} {
        set no_master_change [expr {[dict size $delta] == 0 && [llength $bad] == 0}]
        if {![info exists reported]} { set reported [atcs_eco_cells [expr {$c1 - $c0}]] }
        foreach name $reported {
            if {[dict exists $delta $name] || [lsearch -exact $bad $name] >= 0} { continue }
            if {[atcs_is_filler [atcs_cell_master $name]]} {
                if {[lsearch -exact $fillers $name] < 0} { lappend fillers $name }
            } elseif {[atcs_instance_in_domain $name]} {
                if {$no_master_change} { lappend eco_cells $name }
            } else {
                lappend bad $name
            }
        }
    }
    set new_nets {}
    dict for {name pair} $delta {
        lassign $pair m0 m1
        if {$m0 eq ""} {
            foreach net [atcs_instance_nets $name] {
                if {[atcs_net_in_domain $net]} { continue }
                if {$::ATCS_OBSERVE eq "full"} {
                    set fresh [expr {![dict exists [dict get $pre netset] $net]}]
                } else {
                    set fresh [atcs_leaf_prefixed $net]
                }
                if {!$fresh} {
                    lappend bad "$name@$net"
                } elseif {[lsearch -exact $new_nets $net] < 0} {
                    lappend new_nets $net
                }
            }
        } elseif {$m1 eq "" && [dict exists $pre nets $name]} {
            foreach net [dict get $pre nets $name] {
                if {![atcs_net_in_domain $net]} { lappend bad "$name@$net" }
            }
        }
    }
    return [dict create count $c1 delta $delta bad $bad newNets $new_nets fillers $fillers ecoCells $eco_cells]
}
# Undo XTop ECO actions until count_eco_actions is back at `goal`; stop at the
# first undo that fails or does not lower the count. Returns {count calls}.
proc atcs_undo_to {goal} {
    set count [atcs_eco_count]
    set calls {}
    while {$count > $goal} {
        lassign [atcs_call [list undo]] code result
        lappend calls [list $code $result]
        set next [atcs_eco_count]
        if {$code != 0 || $next >= $count} { set count $next; break }
        set count $next
    }
    return [list $count $calls]
}
proc atcs_undo_calls_json {calls} {
    set out {}
    foreach call $calls {
        lassign $call code result
        lappend out [atcs_jobj [list command [atcs_js undo] code $code result [atcs_js [atcs_clip $result 4000]]]]
    }
    return "\[[join $out ,]\]"
}
# Whether the design is back at the pre-call observation.
proc atcs_restored {pre count delta} {
    if {$count != [dict get $pre count]} { return 0 }
    dict for {name pair} $delta {
        if {[lindex $pair 0] eq "" && [atcs_cell_master $name] ne ""} { return 0 }
    }
    if {![atcs_state_equal [atcs_state [dict keys [dict get $pre domain]]] [dict get $pre domain]]} { return 0 }
    if {$::ATCS_OBSERVE eq "full"} {
        dict for {name pair} [atcs_diff [dict get $pre cells] [atcs_snapshot]] {
            if {![atcs_is_filler [lindex $pair 0]] && ![atcs_is_filler [lindex $pair 1]]} { return 0 }
        }
    }
    return 1
}

# ---- session reference and gain --------------------------------------------
proc atcs_summarize {check options} {
    set command [concat [list summarize_gba_violations] $options [list -$check]]
    set ::atcs_capture ""
    set code [catch {redirect -variable ::atcs_capture $command} result]
    return [list $command $code $result $::atcs_capture]
}
proc atcs_summary_json {entry} {
    lassign $entry command code result text
    return [atcs_jobj [list command [atcs_js $command] code $code \
        result [atcs_js [atcs_clip $result 4000]] text [atcs_js [atcs_clip $text 60000]]]]
}
proc atcs_capture_reference {} {
    set pairs {}
    foreach check {setup hold} {
        set entry [atcs_summarize $check {-as_reference -exclude_path}]
        if {[lindex $entry 1] != 0} { error "session reference capture failed for $check: [lindex $entry 2]" }
        lappend pairs $check [atcs_summary_json $entry]
    }
    set ::atcs_reference_captured 1
    set line [atcs_jobj [list seq $::atcs_seq kind [atcs_js reference] checks [atcs_jobj $pairs]]]
    atcs_append [atcs_gain_path] $line
    return $line
}
proc atcs_ensure_reference {} {
    if {!$::atcs_reference_captured} { atcs_capture_reference }
}
proc atcs_log_gain {kind seq} {
    set pairs {}
    foreach check {setup hold} {
        lappend pairs $check [atcs_summary_json [atcs_summarize $check {-with_delta -with_reference -exclude_path}]]
    }
    set line [atcs_jobj [list seq $seq kind [atcs_js $kind] checks [atcs_jobj $pairs]]]
    if {[catch {atcs_append [atcs_gain_path] $line} message]} {
        atcs_taint "gain.jsonl write failed after kept seq $seq: $message"
    }
    return $line
}

# ---- mutation core ---------------------------------------------------------
proc atcs_begin_mutation {plan_sha256} {
    if {$::atcs_tainted ne ""} { error "session tainted, mutation refused: $::atcs_tainted" }
    if {![regexp {^[0-9a-f]{64}$} $plan_sha256]} { error "planSha256 must be 64 lowercase hex characters" }
    if {$::atcs_plan_sha256 ne "" && $plan_sha256 ne $::atcs_plan_sha256} {
        error "planSha256 differs from the plan this session's mutations already use"
    }
    if {$::atcs_mutations >= $::ATCS_MAX_MUTATIONS} {
        error "mutation budget exhausted: $::atcs_mutations of $::ATCS_MAX_MUTATIONS used"
    }
}
proc atcs_commit_mutation {plan_sha256} {
    incr ::atcs_mutations
    set ::atcs_plan_sha256 $plan_sha256
}
proc atcs_call {command} {
    set code [catch {uplevel #0 $command} result]
    return [list $code $result]
}
proc atcs_xtop_json {command code result} {
    return [atcs_jobj [list command [atcs_js $command] code $code result [atcs_js [atcs_clip $result 4000]]]]
}
proc atcs_log_op {fields} {
    incr ::atcs_seq
    set line [atcs_jobj [concat [list seq $::atcs_seq] $fields]]
    if {[catch {atcs_append $::env(OPS_LOG) $line} message]} {
        atcs_taint "ops.jsonl write failed after XTop was called (seq $::atcs_seq): $message"
    }
    return [list $::atcs_seq $line]
}
proc atcs_taint {reason} {
    if {$::atcs_tainted eq ""} {
        set ::atcs_tainted $reason
        catch {
            set fh [open [atcs_taint_path] w]
            fconfigure $fh -encoding utf-8
            puts $fh [atcs_jobj [list reason [atcs_js $reason] seq $::atcs_seq]]
            close $fh
        }
    }
    error "$reason; session tainted, further mutations are refused"
}
# After an unexpected error once XTop may have been called: log what is known, then taint.
proc atcs_fail_uncertain {cmd proc args_json message} {
    if {$::atcs_tainted ne ""} { error $message }
    catch {atcs_log_op [list cmd [atcs_js $cmd] proc [atcs_js $proc] args $args_json status [atcs_js uncertain] \
        observe [atcs_js $::ATCS_OBSERVE] error [atcs_js $message]]}
    atcs_taint "$cmd: $message"
}
proc atcs_keep {seq kind before after nets c0 c1} {
    lappend ::atcs_kept $seq
    lappend ::atcs_stack $seq
    set ::atcs_op($seq) [dict create kind $kind before $before after $after nets $nets c0 $c0 c1 $c1]
    dict for {name master} $before {
        if {$master eq "" && [dict get $after $name] ne ""} { lappend ::atcs_session_instances $name }
    }
    foreach net $nets { lappend ::atcs_session_nets $net }
}
proc atcs_forget {seq} {
    set op $::atcs_op($seq)
    dict for {name master} [dict get $op before] {
        set at [lsearch -exact $::atcs_session_instances $name]
        if {$master eq "" && $at >= 0} { set ::atcs_session_instances [lreplace $::atcs_session_instances $at $at] }
    }
    foreach net [dict get $op nets] {
        set at [lsearch -exact $::atcs_session_nets $net]
        if {$at >= 0} { set ::atcs_session_nets [lreplace $::atcs_session_nets $at $at] }
    }
    unset ::atcs_op($seq)
}

# The instance a request named: `name` itself, or `<module>/name` for one of `modules`, the modules
# that own the request's load pins (real XTop creates a new cell in its load pins' module under the
# requested leaf name, Issue #64 Task 7: swerv_dbg/atcs_w01_r1_chain_d0). A removal names an existing
# instance, which is found as given. "" when none matches.
proc atcs_request_instance {state name modules} {
    if {[dict exists $state $name]} { return $name }
    set found {}
    foreach module [lsort -unique $modules] {
        if {$module ne "" && [dict exists $state "$module/$name"]} { lappend found "$module/$name" }
    }
    return [expr {[llength $found] == 1 ? [lindex $found 0] : ""}]
}
# The module path owning each pin's cell ("" at the top level).
proc atcs_pin_modules {pins} {
    set modules {}
    foreach pin $pins {
        set owner [atcs_pin_owner $pin]
        if {$owner eq ""} { set owner [join [lrange [split $pin /] 0 end-1] /] }
        lappend modules [join [lrange [split $owner /] 0 end-1] /]
    }
    return [lsort -unique $modules]
}
# One mutation. `kind`:
#   exact    (size_cell) the delta must be exactly `expected`
#   request  (inserts, split_load, remove) an empty delta fails; "matchesRequest"
#            says whether the delta holds `expected`
#   fix      (fixes, split_net, exchange) an empty delta is a legal no-change
#   move     (move_cell) masters cannot show it: kept when XTop returned 0 and
#            added an ECO action, with no master change
proc atcs_mutate {proc cmd args_json plan_sha256 command kind {expected {}} {named_nets {}} {move_instance ""}
                  {load_modules {}}} {
    atcs_ensure_reference
    set pre [atcs_observe_before]
    atcs_commit_mutation $plan_sha256
    if {[catch {
        lassign [atcs_call $command] code result
        if {$code == 0 && $cmd eq "fix_hold_gba_violations"} { set ::atcs_fix_ran hold }
        if {$code == 0 && $cmd eq "fix_setup_gba_violations"} { set ::atcs_fix_ran setup }
        set post [atcs_observe_after $pre]
        set c0 [dict get $pre count]
        set c1 [dict get $post count]
        set delta [dict get $post delta]
        set bad [dict get $post bad]
        set eco_cells [dict get $post ecoCells]
        set extra {}
        if {[llength $bad] > 0} {
            lassign [atcs_undo_to $c0] count calls
            set status [expr {[atcs_restored $pre $count $delta] ? "reverted" : "uncertain"}]
            set extra [list outOfDomain [atcs_jarr $bad] undo [atcs_undo_calls_json $calls]]
        } elseif {[dict size $delta] > 0 && $c1 <= $c0} {
            set status uncertain
            set extra [list error [atcs_js "the design changed but count_eco_actions did not grow ($c0 -> $c1)"]]
        } elseif {$kind eq "move"} {
            if {[dict size $delta] > 0} {
                set status uncertain
            } elseif {$code == 0 && $c1 > $c0} {
                set status kept
            } else {
                set status [expr {$code == 0 ? "no-change" : "error"}]
            }
        } elseif {[dict size $delta] == 0 && [llength $eco_cells] > 0} {
            # XTop acted on domain cells without changing a master: kept when a fix asked for it.
            if {$kind eq "fix" && $code == 0} {
                set kind eco
                set status kept
            } else {
                set status uncertain
            }
        } elseif {[dict size $delta] == 0} {
            set status [expr {$code == 0 ? "no-change" : "error"}]
        } elseif {$code != 0} {
            set status uncertain
        } elseif {$kind eq "exact" && ![atcs_state_equal [atcs_delta_side $delta 1] $expected]} {
            set status uncertain
        } else {
            set status kept
        }
        if {$kind eq "move"} {
            set before [dict create $move_instance [dict get $pre domain $move_instance]]
            set after [atcs_state [list $move_instance]]
        } elseif {$kind eq "eco"} {
            set before [dict create]
            foreach name $eco_cells { dict set before $name [dict get $pre domain $name] }
            set after [atcs_state $eco_cells]
        } else {
            set before [atcs_delta_side $delta 0]
            set after [atcs_delta_side $delta 1]
        }
        if {$kind eq "request"} {
            set matches 1
            dict for {name master} $expected {
                set placed [atcs_request_instance $after $name $load_modules]
                if {$placed eq "" || [dict get $after $placed] ne $master} {
                    set matches 0
                }
            }
            lappend extra matchesRequest [atcs_jbool $matches]
        }
        if {$kind eq "move" || $kind eq "eco"} { lappend extra verified [atcs_js eco-actions] }
        if {[llength $eco_cells] > 0} { lappend extra ecoCells [atcs_jarr $eco_cells] }
        set fields [list cmd [atcs_js $cmd] proc [atcs_js $proc] args $args_json status [atcs_js $status] \
            observe [atcs_js $::ATCS_OBSERVE] ecoActions [expr {$c1 - $c0}] \
            before [atcs_state_json $before] after [atcs_state_json $after]]
        if {[llength [dict get $post newNets]] > 0} { lappend fields newNets [atcs_jarr [dict get $post newNets]] }
        if {[llength [dict get $post fillers]] > 0} { lappend fields fillers [atcs_jarr [dict get $post fillers]] }
        lappend fields xtop [atcs_xtop_json $command $code $result]
        lassign [atcs_log_op [concat $fields $extra]] seq line
        if {$status eq "kept"} {
            set nets $named_nets
            foreach net [dict get $post newNets] { if {[lsearch -exact $nets $net] < 0} { lappend nets $net } }
            atcs_keep $seq $kind $before $after $nets $c0 $c1
        } elseif {($status eq "no-change" || $status eq "error") && $c1 > $c0} {
            # XTop holds a checkpoint without a design change; atcs_undo discards it on the way.
            lappend ::atcs_stack $seq
            set ::atcs_op($seq) [dict create kind empty before {} after {} nets {} c0 $c0 c1 $c1]
        }
    } message]} {
        atcs_fail_uncertain $cmd $proc $args_json $message
    }
    switch -- $status {
        kept { return "$line\n[atcs_log_gain mutation $seq]" }
        no-change {
            if {$kind eq "fix"} { return $line }
            error "$cmd reported success but the design did not change (seq $seq): $result"
        }
        error { error "$cmd failed (seq $seq): $result" }
        reverted { error "$cmd changed out-of-domain objects [join $bad {, }]; the change was undone (seq $seq)" }
        default {
            if {[llength $bad] > 0} {
                atcs_taint "$cmd changed out-of-domain objects [join $bad {, }] and undo did not restore them (seq $seq)"
            }
            atcs_taint "$cmd left an unexpected design state (seq $seq, XTop code $code: $result)"
        }
    }
}

# ---- read procedures -------------------------------------------------------
proc atcs_ref {} {
    if {$::atcs_reference_captured} { return "session reference already captured; it is never moved" }
    return [atcs_capture_reference]
}
# XTop keeps fail reasons only for the check of the last fix flow in the session: before any fix,
# `-with_fail_reason` fails ("No fail reason since no fix or optimize flow have run yet."), and
# after a hold fix it fails for setup ("Last flow is 'hold_gba', mismatched with current summary.",
# real XTop, Issue #64 Task 7). `-with_top_n` alone always lists the worst endpoints.
proc atcs_gain {check top_n} {
    atcs_choice check $check {setup hold}
    atcs_int topN $top_n 1 100
    atcs_ensure_reference
    set options [list -with_delta -with_reference -exclude_path -with_top_n $top_n]
    if {$::atcs_fix_ran eq $check} { lappend options -with_fail_reason }
    set entry [atcs_summarize $check $options]
    atcs_append [atcs_gain_path] [atcs_jobj [list seq $::atcs_seq kind [atcs_js probe] topN $top_n \
        checks [atcs_jobj [list $check [atcs_summary_json $entry]]]]]
    lassign $entry command code result text
    if {$code != 0} { error "$command failed: $result" }
    return [expr {$text ne "" ? $text : $result}]
}
proc atcs_paths {check top_n end_points} {
    atcs_choice check $check {setup hold}
    atcs_int topN $top_n 1 100
    set end_points [atcs_list endPoints $end_points]
    foreach pin $end_points { atcs_check_name pin $pin }
    set command [list analyze_${check}_path_violations]
    if {[llength $end_points] > 0} {
        set delay_type [expr {$check eq "setup" ? "max" : "min"}]
        lappend command [get_paths -delay_type $delay_type -end_points $end_points]
    }
    lappend command -top $top_n -detail_info
    return [uplevel #0 $command]
}
proc atcs_fail_reasons {pins reasons methods} {
    set pins [atcs_list pins $pins]
    set reasons [atcs_list reasons $reasons]
    set methods [atcs_list methods $methods]
    foreach pin $pins { atcs_check_name pin $pin }
    foreach reason $reasons {
        if {![regexp {^[A-Za-z0-9_]+$} $reason]} { error "invalid fail reason '$reason'" }
    }
    foreach method $methods { atcs_choice method $method $::ATCS_FAIL_REASON_METHODS }
    if {[llength $pins] == 0 && [llength $reasons] == 0} { error "name pins, reasons or both" }
    set method_option {}
    if {[llength $methods] > 0} { set method_option [list -methods $methods] }
    set pairs {}
    if {[llength $pins] > 0} {
        # report_fail_reasons prints its report and returns "" (real XTop, Issue #64 Task 7): capture it.
        # Before any fix or optimize flow it prints an empty table (XTop keeps no fail reasons yet).
        set command [concat [list report_fail_reasons] $method_option [list -stats -verbose -pins $pins]]
        set ::atcs_capture ""
        set result [uplevel #0 [list redirect -variable ::atcs_capture $command]]
        lappend pairs report [atcs_js [expr {$::atcs_capture ne "" ? $::atcs_capture : $result}]]
    }
    if {[llength $reasons] > 0} {
        set failed [uplevel #0 [concat [list get_failed_pins] $method_option [list -reasons $reasons]]]
        set names {}
        foreach_in_collection pin $failed { lappend names [get_attribute [get_pins $pin] full_name] }
        lappend pairs failedPins [atcs_jarr $names]
    }
    return [atcs_jobj $pairs]
}
proc atcs_candidates {kind object} {
    atcs_choice kind $kind {size_cell insert_buffer exchange_cell}
    atcs_check_name [expr {$kind eq "insert_buffer" ? "pin" : "instance"}] $object
    return [uplevel #0 [list list_${kind}_candidates $object]]
}

# ---- mutation procedures ---------------------------------------------------
proc atcs_size_cell {instance to_master plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    atcs_check_master $to_master
    set from_master [atcs_cell_master $instance]
    if {$from_master eq ""} { error "instance $instance does not exist" }
    if {$from_master eq $to_master} { error "instance $instance is already $to_master" }
    set args_json [atcs_jobj [list instance [atcs_js $instance] toMaster [atcs_js $to_master] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_size_cell size_cell $args_json $plan_sha256 \
        [list size_cell [get_cells -exact $instance] $to_master] exact [dict create $instance $to_master]]
}
proc atcs_exchange_cell {instance cells plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    if {[atcs_cell_master $instance] eq ""} { error "instance $instance does not exist" }
    # exchange_cell swaps with "the specified cell instances": every partner is an existing domain instance.
    set cells [atcs_list cells $cells 1]
    foreach cell $cells {
        atcs_require_instance $cell
        if {[atcs_cell_master $cell] eq ""} { error "instance $cell does not exist" }
    }
    set args_json [atcs_jobj [list instance [atcs_js $instance] cells [atcs_jarr $cells] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_exchange_cell exchange_cell $args_json $plan_sha256 \
        [list exchange_cell [get_cells -exact $instance] [get_cells -exact $cells]] fix]
}
proc atcs_insert_buffer {net load_pins masters new_instances new_nets plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_net $net
    set load_pins [atcs_list loadPins $load_pins 1]
    foreach pin $load_pins { atcs_require_pin_on_net $pin $net }
    set masters [atcs_list masters $masters 1 0]
    foreach master $masters { atcs_check_master $master }
    set count [llength $masters]
    set new_instances [atcs_list newInstances $new_instances]
    set new_nets [atcs_list newNets $new_nets]
    if {[llength $new_instances] != $count || [llength $new_nets] != $count} {
        error "insert_buffer needs one new instance and one new net name per master ($count)"
    }
    atcs_require_new_names instance $new_instances
    atcs_require_new_names net $new_nets
    set expected [dict create]
    foreach name $new_instances master $masters { dict set expected $name $master }
    set args_json [atcs_jobj [list net [atcs_js $net] loadPins [atcs_jarr $load_pins] masters [atcs_jarr $masters] \
        newInstances [atcs_jarr $new_instances] newNets [atcs_jarr $new_nets] planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_insert_buffer insert_buffer $args_json $plan_sha256 \
        [list insert_buffer -new_cell_names $new_instances -new_net_names $new_nets \
            [get_pins -exact $load_pins] $masters] request $expected $new_nets "" [atcs_pin_modules $load_pins]]
}
proc atcs_insert_dummy {pin master new_instance plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_check_name pin $pin
    set net [atcs_pin_net $pin]
    if {![atcs_net_in_domain $net]} { error "out-of-scope pin: $pin is on net $net outside the edit domain" }
    atcs_check_master $master
    atcs_require_new_names instance [list $new_instance]
    set args_json [atcs_jobj [list pin [atcs_js $pin] master [atcs_js $master] newInstance [atcs_js $new_instance] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_insert_dummy insert_dummy_cell $args_json $plan_sha256 \
        [list insert_dummy_cell -new_cell_name $new_instance [get_pins -exact $pin] $master] \
        request [dict create $new_instance $master] {} "" [atcs_pin_modules [list $pin]]]
}
proc atcs_split_load {net pin_groups master new_instances new_nets plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_net $net
    set groups {}
    set groups_json {}
    foreach group [atcs_list pinGroups $pin_groups 1] {
        set group [atcs_list "pin group" $group 1]
        foreach pin $group { atcs_require_pin_on_net $pin $net }
        lappend groups $group
        lappend groups_json [atcs_jarr $group]
    }
    atcs_check_master $master
    set count [llength $groups]
    set new_instances [atcs_list newInstances $new_instances]
    set new_nets [atcs_list newNets $new_nets]
    if {[llength $new_instances] != $count || [llength $new_nets] != $count} {
        error "split_load needs one new instance and one new net name per pin group ($count)"
    }
    atcs_require_new_names instance $new_instances
    atcs_require_new_names net $new_nets
    set expected [dict create]
    foreach name $new_instances { dict set expected $name $master }
    set command [list split_load]
    foreach group $groups { lappend command -pin_group [get_pins -exact $group] }
    lappend command -lib_cell $master -new_cell_names $new_instances -new_net_names $new_nets
    set args_json [atcs_jobj [list net [atcs_js $net] pinGroups "\[[join $groups_json ,]\]" master [atcs_js $master] \
        newInstances [atcs_jarr $new_instances] newNets [atcs_jarr $new_nets] planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_split_load split_load $args_json $plan_sha256 $command request $expected $new_nets "" \
        [atcs_pin_modules [concat {*}$groups]]]
}
proc atcs_split_net {net master rule segments plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_net $net
    atcs_check_master $master
    atcs_choice rule $rule {wire_length cap}
    atcs_int segments $segments 2 16
    set args_json [atcs_jobj [list net [atcs_js $net] master [atcs_js $master] rule [atcs_js $rule] \
        segments $segments planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_split_net split_net $args_json $plan_sha256 \
        [list split_net [get_nets -exact $net] -lib_cell $master -rule $rule -segment $segments] fix]
}
# Absolute moves only: the target point must lie in an edit-domain region. XTop's point is "(x,y)"
# (move_cell.1; real XTop refuses "{x y}" as "not a valid 'pointf'", Issue #64 Task 7). A
# -delta move is not offered, because no documented attribute reads a cell's
# location to resolve its target.
proc atcs_move_cell {instance x y plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    atcs_number x $x -1000000 1000000
    atcs_number y $y -1000000 1000000
    atcs_require_point $x $y
    set args_json [atcs_jobj [list instance [atcs_js $instance] x $x y $y planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_move_cell move_cell $args_json $plan_sha256 \
        [list move_cell -to "($x,$y)" [get_cells -exact $instance]] move {} {} $instance]
}
proc atcs_remove_buffer {instance plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    atcs_require_instance_nets $instance
    set args_json [atcs_jobj [list instance [atcs_js $instance] planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_remove_buffer remove_buffer $args_json $plan_sha256 \
        [list remove_buffer [get_cells -exact $instance]] request [dict create $instance ""]]
}
proc atcs_fix_hold_pins {pins effort hold_target setup_margin size_cell_only use_dummy_cell fix_timing_window
                         max_cluster_loader_count max_delay_cell_length delay_cell_list plan_sha256} {
    atcs_begin_mutation $plan_sha256
    set pins [atcs_list pins $pins 1]
    foreach pin $pins { atcs_require_domain_pin $pin }
    atcs_choice effort $effort $::ATCS_HOLD_EFFORTS
    atcs_number holdTarget $hold_target -$::ATCS_SLACK_LIMIT $::ATCS_SLACK_LIMIT
    atcs_number setupMargin $setup_margin -$::ATCS_SLACK_LIMIT $::ATCS_SLACK_LIMIT
    atcs_flag sizeCellOnly $size_cell_only
    atcs_flag useDummyCell $use_dummy_cell
    atcs_flag fixTimingWindow $fix_timing_window
    atcs_int maxClusterLoaderCount $max_cluster_loader_count 0 6
    atcs_int maxDelayCellLength $max_delay_cell_length -1 5
    set delay_cell_list [atcs_list delayCellList $delay_cell_list]
    foreach cell $delay_cell_list { atcs_check_master $cell }
    if {($max_delay_cell_length >= 0) != ([llength $delay_cell_list] > 0)} {
        error "maxDelayCellLength and delayCellList go together: give both, or -1 and an empty list"
    }
    if {$effort eq "omit" && !$size_cell_only} { error "effort may be omitted only with sizeCellOnly" }
    if {$fix_timing_window && $size_cell_only} { error "fix_timing_window cannot be combined with size_cell_only" }
    if {$fix_timing_window && $effort ne "low"} { error "fix_timing_window works only with low effort, got $effort" }
    if {!$size_cell_only || $use_dummy_cell} { atcs_require_pin_nets $pins }
    set command [list fix_hold_gba_violations]
    if {$effort ne "omit"} { lappend command -effort $effort }
    # The frozen Pack's qualified hold-size string: -size_cell_only -size_rule nominal_keywords.
    if {$size_cell_only} { lappend command -size_cell_only -size_rule nominal_keywords }
    lappend command -hold_target $hold_target -setup_margin $setup_margin
    if {$use_dummy_cell} { lappend command -use_dummy_cell }
    if {$fix_timing_window} { lappend command -fix_timing_window }
    if {$max_cluster_loader_count > 0} { lappend command -max_cluster_loader_count $max_cluster_loader_count }
    if {$max_delay_cell_length >= 0} {
        lappend command -max_delay_cell_length $max_delay_cell_length -delay_cell_list $delay_cell_list
    }
    lappend command -only_pins [get_pins -exact $pins]
    set args_json [atcs_jobj [list pins [atcs_jarr $pins] effort [atcs_js $effort] holdTarget $hold_target \
        setupMargin $setup_margin sizeCellOnly [atcs_jbool $size_cell_only] useDummyCell [atcs_jbool $use_dummy_cell] \
        fixTimingWindow [atcs_jbool $fix_timing_window] maxClusterLoaderCount $max_cluster_loader_count \
        maxDelayCellLength $max_delay_cell_length delayCellList [atcs_jarr $delay_cell_list] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_fix_hold_pins fix_hold_gba_violations $args_json $plan_sha256 $command fix]
}
proc atcs_fix_setup_pins {pins methods remove_buffer_only size_down_only effort setup_target hold_margin
                          plan_sha256} {
    atcs_begin_mutation $plan_sha256
    set pins [atcs_list pins $pins 1]
    foreach pin $pins { atcs_require_domain_pin $pin }
    set methods [atcs_list methods $methods]
    foreach method $methods { atcs_choice method $method $::ATCS_FIX_SETUP_METHODS }
    atcs_flag removeBufferOnly $remove_buffer_only
    atcs_flag sizeDownOnly $size_down_only
    atcs_choice effort $effort $::ATCS_SETUP_EFFORTS
    atcs_number setupTarget $setup_target -$::ATCS_SLACK_LIMIT $::ATCS_SLACK_LIMIT
    atcs_number holdMargin $hold_margin -$::ATCS_SLACK_LIMIT $::ATCS_SLACK_LIMIT
    if {$remove_buffer_only && ([llength $methods] > 0 || $size_down_only)} {
        error "removeBufferOnly is a pass of its own: no methods and no sizeDownOnly with it"
    }
    if {!$remove_buffer_only && !$size_down_only && [llength $methods] == 0} {
        error "name methods, removeBufferOnly or sizeDownOnly"
    }
    if {[lsearch -exact $methods insert_buffer] >= 0 || [lsearch -exact $methods split_net] >= 0} {
        atcs_require_pin_nets $pins
    }
    set command [list fix_setup_gba_violations]
    if {[llength $methods] > 0} { lappend command -methods $methods }
    if {$remove_buffer_only} { lappend command -remove_buffer_only }
    if {$size_down_only} { lappend command -size_down_only }
    lappend command -effort $effort -setup_target $setup_target -hold_margin $hold_margin \
        -only_pins [get_pins -exact $pins]
    set args_json [atcs_jobj [list pins [atcs_jarr $pins] methods [atcs_jarr $methods] \
        removeBufferOnly [atcs_jbool $remove_buffer_only] sizeDownOnly [atcs_jbool $size_down_only] \
        effort [atcs_js $effort] setupTarget $setup_target holdMargin $hold_margin planSha256 [atcs_js $plan_sha256]]]
    return [atcs_mutate atcs_fix_setup_pins fix_setup_gba_violations $args_json $plan_sha256 $command fix]
}
# Undo the last kept, not yet undone mutation: XTop `undo` until count_eco_actions
# is back where it was before that mutation (discarding any empty checkpoints a
# later no-change or failed call left on top), then check its recorded delta is
# reversed and nothing else moved.
proc atcs_undo {plan_sha256} {
    atcs_begin_mutation $plan_sha256
    if {[llength $::atcs_kept] == 0} { error "nothing to undo: no kept mutation remains in this session" }
    set target [lindex $::atcs_kept end]
    set op $::atcs_op($target)
    set discards [lrange $::atcs_stack [expr {[lsearch -exact $::atcs_stack $target] + 1}] end]
    set op_before [dict get $op before]
    set op_after [dict get $op after]
    atcs_ensure_reference
    set pre [atcs_observe_before]
    set keys [lsort -unique [concat [dict keys $op_before] [dict keys [dict get $pre domain]]]]
    set current [atcs_state $keys]
    atcs_commit_mutation $plan_sha256
    set args_json [atcs_jobj [list planSha256 [atcs_js $plan_sha256]]]
    if {[catch {
        set c_before [dict get $pre count]
        lassign [atcs_undo_to [dict get $op c0]] count calls
        set now [atcs_state $keys]
        set restored [expr {$count == [dict get $op c0]}]
        foreach name $keys {
            set want [expr {[dict exists $op_before $name] && [lsearch -exact {move eco} [dict get $op kind]] < 0
                ? [dict get $op_before $name] : [dict get $current $name]}]
            if {[dict get $now $name] ne $want} { set restored 0 }
        }
        if {$::ATCS_OBSERVE eq "full"} {
            set seen [dict create]
            dict for {name pair} [atcs_diff [dict get $pre cells] [atcs_snapshot]] {
                if {[atcs_is_filler [lindex $pair 0]] || [atcs_is_filler [lindex $pair 1]]} { continue }
                dict set seen $name $pair
                if {![dict exists $op_before $name]
                        || $pair ne [list [dict get $op_after $name] [dict get $op_before $name]]} { set restored 0 }
            }
            if {[dict size $seen] != [dict size $op_before] && [lsearch -exact {move eco} [dict get $op kind]] < 0} {
                set restored 0
            }
        }
        set undo_ok 0
        foreach call $calls { if {[lindex $call 0] == 0} { set undo_ok 1 } }
        if {$restored} {
            set status kept
        } elseif {!$undo_ok && $count == $c_before && [atcs_state_equal $now $current]} {
            set status error
        } else {
            set status uncertain
        }
        set shown [dict keys $op_before]
        set before [dict create]
        set after [dict create]
        foreach name $shown {
            dict set before $name [dict get $current $name]
            dict set after $name [dict get $now $name]
        }
        set last [lindex $calls end]
        set fields [list cmd [atcs_js undo] proc [atcs_js atcs_undo] undoes $target discards [atcs_jints $discards] \
            undoCalls [llength $calls] args $args_json status [atcs_js $status] observe [atcs_js $::ATCS_OBSERVE] \
            ecoActions [expr {$count - $c_before}] before [atcs_state_json $before] after [atcs_state_json $after] \
            xtop [atcs_xtop_json undo [expr {$last eq "" ? 0 : [lindex $last 0]}] [lindex $last 1]] \
            undo [atcs_undo_calls_json $calls]]
        if {[lsearch -exact {move eco} [dict get $op kind]] >= 0} { lappend fields verified [atcs_js eco-actions] }
        lassign [atcs_log_op $fields] seq line
        if {$status eq "kept"} {
            set ::atcs_kept [lrange $::atcs_kept 0 end-1]
            foreach gone [concat [list $target] $discards] {
                set at [lsearch -exact $::atcs_stack $gone]
                set ::atcs_stack [lreplace $::atcs_stack $at $at]
                atcs_forget $gone
            }
        }
    } message]} {
        atcs_fail_uncertain undo atcs_undo $args_json $message
    }
    switch -- $status {
        kept { return "$line\n[atcs_log_gain undo $seq]" }
        error { error "undo of seq $target failed and changed nothing (seq $seq): [lindex $last 1]" }
        default { atcs_taint "undo of seq $target did not restore its before state (seq $seq)" }
    }
}

# The Operator's typed dump. #64 D-T03-2: capture seals exactly before.dump and after.dump in the slot
# root, so those are the only two names this writes, always in the slot root; any other name is
# refused before anything is written, naming the two. The replay's own dumps go through
# atcs_write_cell_dump, which no typed command reaches.
proc atcs_dump_cells {path} {
    set name [file tail $path]
    if {$name ni {before.dump after.dump}} {
        error "atcs_dump_cells writes only before.dump or after.dump (in the slot root $::operator_root); capture seals exactly those two names, not $name"
    }
    atcs_write_cell_dump [file join $::operator_root $name]
}
proc atcs_write_cell_dump {path} {
    # `get_cells -hierarchical` (documented, get_cells.1) plus
    # `foreach_in_collection` (documented, foreach_in_collection.1) is the
    # confirmed way to iterate every cell; `full_name`/`ref_name` are
    # queried the same way get_attribute.1's own worked example does
    # (`get_attribute [get_cells U43] ref_name`) -- see
    # knowledge/xtop-capabilities.md for the full citation. There is no
    # documented `get_object_name`; do not reintroduce it.
    set fh [open $path w]
    foreach_in_collection i [get_cells -hierarchical] {
        set cell [get_cells $i]
        puts $fh "[get_attribute $cell full_name] [get_attribute $cell ref_name]"
    }
    close $fh
}
# A tainted session's changes are untrusted: no ECO export (tainted.json records why).
proc atcs_export_changes {} {
    if {$::atcs_tainted ne ""} { error "session tainted, export refused: $::atcs_tainted" }
    file mkdir $::eco_output_dir
    write_design_changes -format INNOVUS -eco_file_prefix $::env(ECO_PREFIX) \
        -output_dir $::eco_output_dir -keep_route
    save_workspace -as ${::design}_operator_candidate
    return $::eco_output_dir
}
# The transcript always states the taint state the capture must honour.
proc atcs_close {} {
    if {$::atcs_tainted ne ""} {
        puts "ATCS:taint:tainted:$::atcs_tainted"
        return "closing after adapter receipt; session tainted: $::atcs_tainted"
    }
    puts "ATCS:taint:clean"
    return "closing after adapter receipt; session clean"
}

# ---- local-topology edit domain (#64 attempt 5) ------------------------------
# A worker session (::EDIT_DOMAIN_LOCAL 1; the replay never sets it and confines each session to
# the domain its Contribution recorded) widens its edit domain once, here, before the ready line,
# to its blockers' local topology: the nets of every target pin and of every pin of the plan's own
# instances, and the leaf cells on those nets (their drivers and loads). One hop only: the added
# cells' other nets stay outside. A net with more than ::ATCS_LOCAL_FANOUT_MAX leaf pins is global
# (clock, reset, scan enable) and stays out with its cells. The result is written to domain.json
# beside ops.jsonl; capture seals it into the Contribution, the composition checks that no two
# slots' kept edits reach into each other's domain, and the replay enters it. A derivation that
# fails leaves the plan's domain as it was and records the error.
proc atcs_domain_record_path {} { return [file join [file dirname $::env(OPS_LOG)] domain.json] }
proc atcs_pin_names_of {object} {
    set names {}
    foreach_in_collection pin [get_pins -quiet -leaf -of_objects $object] {
        lappend names [get_attribute $pin full_name]
    }
    return [lsort -unique $names]
}
proc atcs_derive_local_domain {} {
    set plan_instances [lsort -unique $::EDIT_DOMAIN_INSTANCES]
    set plan_nets [lsort -unique $::EDIT_DOMAIN_NETS]
    set seeds [lsort -unique $::EDIT_DOMAIN_PINS]
    set unresolved {}
    foreach name $plan_instances {
        set cell [get_cells -quiet -exact $name]
        if {[sizeof_collection $cell] != 1} { lappend unresolved $name; continue }
        set seeds [lsort -unique [concat $seeds [atcs_pin_names_of $cell]]]
    }
    set nets {}
    foreach pin $seeds {
        set object [get_pins -quiet -exact $pin]
        if {[sizeof_collection $object] != 1} { lappend unresolved $pin; continue }
        set net [get_nets -quiet -of_objects $object]
        if {[sizeof_collection $net] == 1} { lappend nets [get_attribute $net full_name] }
    }
    set instances $plan_instances
    set domain_nets $plan_nets
    set global {}
    foreach net [lsort -unique $nets] {
        set pins [atcs_pin_names_of [get_nets -quiet -exact $net]]
        if {[llength $pins] > $::ATCS_LOCAL_FANOUT_MAX} {
            lappend global [atcs_jobj [list net [atcs_js $net] pins [llength $pins]]]
            continue
        }
        lappend domain_nets $net
        foreach pin $pins {
            set owner [atcs_pin_owner $pin]
            if {$owner ne ""} { lappend instances $owner }
        }
    }
    set ::EDIT_DOMAIN_INSTANCES [lsort -unique $instances]
    set ::EDIT_DOMAIN_NETS [lsort -unique $domain_nets]
    return [list $global [lsort -unique $unresolved]]
}
proc atcs_write_domain_record {global unresolved error} {
    set boxes {}
    foreach {x1 y1 x2 y2} $::EDIT_DOMAIN_REGIONS { lappend boxes [atcs_jints [list $x1 $y1 $x2 $y2]] }
    set fields [list schema [atcs_js atcs-local-domain/1] fanoutMax $::ATCS_LOCAL_FANOUT_MAX \
        planInstances [atcs_jarr $::atcs_plan_instances] planNets [atcs_jarr $::atcs_plan_nets] \
        targetPins [atcs_jarr [lsort -unique $::EDIT_DOMAIN_PINS]] \
        instances [atcs_jarr $::EDIT_DOMAIN_INSTANCES] nets [atcs_jarr $::EDIT_DOMAIN_NETS] \
        regions "\[[join $boxes ,]\]" globalNets "\[[join $global ,]\]" unresolved [atcs_jarr $unresolved]]
    if {$error ne ""} { lappend fields error [atcs_js [atcs_clip $error 2000]] }
    set fh [open [atcs_domain_record_path] w]
    fconfigure $fh -encoding utf-8
    puts $fh [atcs_jobj $fields]
    close $fh
}
if {$::EDIT_DOMAIN_LOCAL} {
    if {![regexp {^[1-9][0-9]*$} $::ATCS_LOCAL_FANOUT_MAX]} {
        error "ATCS_LOCAL_FANOUT_MAX must be a positive integer, got '$::ATCS_LOCAL_FANOUT_MAX'"
    }
    set ::atcs_plan_instances [lsort -unique $::EDIT_DOMAIN_INSTANCES]
    set ::atcs_plan_nets [lsort -unique $::EDIT_DOMAIN_NETS]
    set atcs_saved [list $::EDIT_DOMAIN_INSTANCES $::EDIT_DOMAIN_NETS]
    if {[catch {atcs_derive_local_domain} atcs_derived]} {
        lassign $atcs_saved ::EDIT_DOMAIN_INSTANCES ::EDIT_DOMAIN_NETS
        atcs_write_domain_record {} {} $atcs_derived
    } else {
        atcs_write_domain_record {*}$atcs_derived ""
    }
    puts "ATCS:domain:[llength $::EDIT_DOMAIN_INSTANCES] instances, [llength $::EDIT_DOMAIN_NETS] nets"
}

puts "ATCS:worker:$env(NAME_PREFIX)"
puts "HIMA:hima-tcl-line-v1:1:READY"
