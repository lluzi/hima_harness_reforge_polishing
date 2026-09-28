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
# hash (64 hex, pinned to the first accepted mutation); refuses once
# ::ATCS_MAX_MUTATIONS mutations reached XTop; validates every argument and
# refuses any object outside the edit domain (::EDIT_DOMAIN_INSTANCES/NETS/
# PINS plus the objects this session created) before XTop is called;
# captures the session reference once if it is not captured yet; calls XTop;
# observes the result; appends one ops.jsonl line and, when the design
# changed as intended, one gain.jsonl line. Refusals before XTop are not
# logged and do not use the budget. Every XTop command and option emitted
# here is on the XTop knowledge pack's evidence/command_surface.tsv.
#
# ops.jsonl (OPS_LOG), one line per mutation that reached XTop, seq 1, 2, ...:
#   {"seq","cmd","proc","args","status","before","after","xtop"[,"verified"]
#    [,"outOfDomain","undo"]}           an undo line adds "undoes": <seq>
#   cmd     the XTop command (size_cell ... fix_setup_gba_violations, undo)
#   args    the procedure's named arguments, as the Host sent them
#   status  kept | no-change | error | reverted | uncertain
#   before/after {"instances": {name: master | null}}: the named instance
#           (size_cell, move_cell) or the observed whole-design delta (every
#           other edit); null = the instance is absent
#   newNets nets created by the edit that its new instances sit on
#   xtop    {"command","code","result"}: the Tcl command and XTop's return
#   verified "xtop-return" when cell masters cannot show the effect (move_cell)
#   matchesRequest  whether the delta holds the named new/removed instances
#   outOfDomain, undo  the refused objects and the immediate XTop undo
# gain.jsonl (beside ops.jsonl): {"seq","kind","checks":{"setup"|"hold":
#   {"command","code","result","text"}}[,"topN"]}, kind reference | mutation
#   | undo | probe; seq is the ops.jsonl line it follows (0 = session start).
########################################################################
foreach {atcs_name atcs_default} {EDIT_DOMAIN_INSTANCES {} EDIT_DOMAIN_NETS {} EDIT_DOMAIN_PINS {} ATCS_MAX_MUTATIONS 1} {
    if {![info exists ::$atcs_name]} { set ::$atcs_name $atcs_default }
}
if {![regexp {^[1-9][0-9]*$} $::ATCS_MAX_MUTATIONS]} {
    error "ATCS_MAX_MUTATIONS must be a positive integer, got '$::ATCS_MAX_MUTATIONS'"
}
set ::atcs_seq 0
set ::atcs_mutations 0
set ::atcs_plan_sha256 ""
set ::atcs_tainted ""
set ::atcs_reference_captured 0
set ::atcs_kept {}
set ::atcs_session_instances {}
set ::atcs_session_nets {}
array set ::atcs_op {}
set ::ATCS_SLACK_LIMIT 0.2
set ::ATCS_EFFORTS {low medium high ultra_high extreme_high}
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
# Whole-design instance -> master map, with the same documented iteration as atcs_dump_cells.
proc atcs_snapshot {} {
    set snap [dict create]
    foreach_in_collection i [get_cells -hierarchical] {
        dict set snap [get_attribute [get_cells $i] full_name] [get_attribute [get_cells $i] ref_name]
    }
    return $snap
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

# ---- edit domain -----------------------------------------------------------
proc atcs_member {items value} { return [expr {[lsearch -exact $items $value] >= 0}] }
proc atcs_instance_in_domain {name} {
    return [expr {[atcs_member $::EDIT_DOMAIN_INSTANCES $name] || [atcs_member $::atcs_session_instances $name]}]
}
proc atcs_net_in_domain {name} {
    return [expr {[atcs_member $::EDIT_DOMAIN_NETS $name] || [atcs_member $::atcs_session_nets $name]}]
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
proc atcs_net_snapshot {} {
    set nets [dict create]
    foreach_in_collection n [get_nets -hierarchical] { dict set nets [get_attribute [get_nets $n] full_name] 1 }
    return $nets
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
# Confinement of an observed whole-design delta. Out of domain: a changed or removed
# instance outside the domain; a created instance whose leaf name lacks the session
# prefix; a created instance on a net that existed before (`n0`) and is outside the
# domain (reported as instance@net). Returns {outOfDomain newNets}; newNets are nets
# the created instances sit on that did not exist before.
proc atcs_delta_check {delta n0} {
    set bad {}
    set new_nets {}
    dict for {name pair} $delta {
        if {[lindex $pair 0] ne ""} {
            if {![atcs_instance_in_domain $name]} { lappend bad $name }
            continue
        }
        if {[string first $::env(NAME_PREFIX) [lindex [split $name /] end]] != 0} {
            lappend bad $name
            continue
        }
        foreach net [atcs_instance_nets $name] {
            if {[dict exists $n0 $net]} {
                if {![atcs_net_in_domain $net]} { lappend bad "$name@$net" }
            } elseif {[lsearch -exact $new_nets $net] < 0} {
                lappend new_nets $net
            }
        }
    }
    return [list $bad $new_nets]
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
        set entry [atcs_summarize $check {-as_reference}]
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
        lappend pairs $check [atcs_summary_json [atcs_summarize $check {-with_delta -with_reference}]]
    }
    set line [atcs_jobj [list seq $seq kind [atcs_js $kind] checks [atcs_jobj $pairs]]]
    atcs_append [atcs_gain_path] $line
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
    atcs_ensure_reference
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
proc atcs_keep {seq mode before after verified nets} {
    lappend ::atcs_kept $seq
    set ::atcs_op($seq) [dict create mode $mode before $before after $after verified $verified nets $nets]
    dict for {name master} $before {
        if {$master eq "" && [dict get $after $name] ne ""} { lappend ::atcs_session_instances $name }
    }
    foreach net $nets { lappend ::atcs_session_nets $net }
}
proc atcs_forget {seq} {
    set op $::atcs_op($seq)
    set ::atcs_kept [lrange $::atcs_kept 0 end-1]
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
proc atcs_taint {reason} {
    set ::atcs_tainted $reason
    error "$reason; session tainted, further mutations are refused"
}

# A mutation whose touched instances are known in advance. `expected` is the state
# the command must leave; `verified` "xtop-return" marks an effect cell masters
# cannot show (move_cell), which is then judged by XTop's return code alone.
proc atcs_targeted {proc cmd args_json plan_sha256 touched expected command {verified observed}} {
    atcs_commit_mutation $plan_sha256
    set before [atcs_state $touched]
    lassign [atcs_call $command] code result
    set after [atcs_state $touched]
    if {$verified eq "xtop-return"} {
        set expected $before
    }
    if {$code == 0 && [atcs_state_equal $after $expected]} {
        set status kept
    } elseif {[atcs_state_equal $after $before]} {
        set status [expr {$code == 0 ? "no-change" : "error"}]
    } else {
        set status uncertain
    }
    set fields [list cmd [atcs_js $cmd] proc [atcs_js $proc] args $args_json status [atcs_js $status] \
        before [atcs_state_json $before] after [atcs_state_json $after] xtop [atcs_xtop_json $command $code $result]]
    if {$verified eq "xtop-return"} { lappend fields verified [atcs_js xtop-return] }
    lassign [atcs_log_op $fields] seq line
    switch -- $status {
        kept {
            atcs_keep $seq targeted $before $after $verified {}
            return "$line\n[atcs_log_gain mutation $seq]"
        }
        no-change { error "$cmd reported success but the design did not change (seq $seq): $result" }
        error { error "$cmd failed (seq $seq): $result" }
        default { atcs_taint "$cmd left an unexpected design state (seq $seq, XTop code $code: $result)" }
    }
}

# A mutation whose effect is observed on the whole design: every cell master is
# diffed and every created instance's nets are checked; an out-of-domain effect is
# undone at once and refused. `expected` (name -> master, "" = removed) is what a
# requested edit asked for: an empty delta then fails, and "matchesRequest" says
# whether the observed delta carries it. Fixes and splits pass no expectation.
proc atcs_snapshot_mutation {proc cmd args_json plan_sha256 command {expected {}} {named_nets {}}} {
    atcs_commit_mutation $plan_sha256
    set s0 [atcs_snapshot]
    set n0 [atcs_net_snapshot]
    lassign [atcs_call $command] code result
    set s1 [atcs_snapshot]
    set delta [atcs_diff $s0 $s1]
    lassign [atcs_delta_check $delta $n0] bad new_nets
    set extra {}
    if {[dict size $delta] == 0} {
        set status [expr {$code == 0 ? "no-change" : "error"}]
    } elseif {[llength $bad] > 0} {
        lassign [atcs_call [list undo]] undo_code undo_result
        set status [expr {[dict size [atcs_diff $s0 [atcs_snapshot]]] == 0 ? "reverted" : "uncertain"}]
        set extra [list outOfDomain [atcs_jarr $bad] undo [atcs_xtop_json undo $undo_code $undo_result]]
    } elseif {$code != 0} {
        set status uncertain
    } else {
        set status kept
    }
    set before [atcs_delta_side $delta 0]
    set after [atcs_delta_side $delta 1]
    if {[dict size $expected] > 0} {
        set matches 1
        dict for {name master} $expected {
            if {![dict exists $after $name] || [dict get $after $name] ne $master} { set matches 0 }
        }
        lappend extra matchesRequest [atcs_jbool $matches]
    }
    set fields [concat [list cmd [atcs_js $cmd] proc [atcs_js $proc] args $args_json status [atcs_js $status] \
        before [atcs_state_json $before] after [atcs_state_json $after] newNets [atcs_jarr $new_nets] \
        xtop [atcs_xtop_json $command $code $result]] $extra]
    lassign [atcs_log_op $fields] seq line
    switch -- $status {
        kept {
            set nets $named_nets
            foreach net $new_nets { if {[lsearch -exact $nets $net] < 0} { lappend nets $net } }
            atcs_keep $seq snapshot $before $after observed $nets
            return "$line\n[atcs_log_gain mutation $seq]"
        }
        no-change {
            if {[dict size $expected] > 0} {
                error "$cmd reported success but the design did not change (seq $seq): $result"
            }
            return $line
        }
        error { error "$cmd failed (seq $seq): $result" }
        reverted { error "$cmd changed out-of-domain objects [join $bad {, }]; the change was undone (seq $seq)" }
        default {
            if {[llength $bad] > 0} {
                atcs_taint "$cmd changed out-of-domain objects [join $bad {, }] and undo did not restore them (seq $seq)"
            }
            atcs_taint "$cmd failed after changing the design (seq $seq, XTop code $code: $result)"
        }
    }
}

# ---- read procedures -------------------------------------------------------
proc atcs_ref {} {
    if {$::atcs_reference_captured} { return "session reference already captured; it is never moved" }
    return [atcs_capture_reference]
}
proc atcs_gain {check top_n} {
    atcs_choice check $check {setup hold}
    atcs_int topN $top_n 1 100
    atcs_ensure_reference
    set entry [atcs_summarize $check [list -with_delta -with_reference -with_top_n $top_n -with_fail_reason]]
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
        set command [concat [list report_fail_reasons] $method_option [list -stats -verbose -pins $pins]]
        lappend pairs report [atcs_js [uplevel #0 $command]]
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
# size_cell and move_cell touch exactly the named instance; every other edit is
# observed on the whole design (atcs_snapshot_mutation).
proc atcs_size_cell {instance to_master plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    atcs_check_master $to_master
    set args_json [atcs_jobj [list instance [atcs_js $instance] toMaster [atcs_js $to_master] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_targeted atcs_size_cell size_cell $args_json $plan_sha256 [list $instance] \
        [dict create $instance $to_master] [list size_cell [list $instance] $to_master]]
}
proc atcs_exchange_cell {instance cells plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    set cells [atcs_list cells $cells 1]
    foreach cell $cells {
        atcs_check_name cell $cell
        if {[atcs_cell_master $cell] ne "" && ![atcs_instance_in_domain $cell]} { error "out-of-scope instance: $cell" }
    }
    set args_json [atcs_jobj [list instance [atcs_js $instance] cells [atcs_jarr $cells] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_snapshot_mutation atcs_exchange_cell exchange_cell $args_json $plan_sha256 \
        [list exchange_cell $instance $cells]]
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
    return [atcs_snapshot_mutation atcs_insert_buffer insert_buffer $args_json $plan_sha256 \
        [list insert_buffer -new_cell_names $new_instances -new_net_names $new_nets $load_pins $masters] \
        $expected $new_nets]
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
    return [atcs_snapshot_mutation atcs_insert_dummy insert_dummy_cell $args_json $plan_sha256 \
        [list insert_dummy_cell -new_cell_name $new_instance $pin $master] [dict create $new_instance $master]]
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
    set args_json [atcs_jobj [list net [atcs_js $net] pinGroups "\[[join $groups_json ,]\]" master [atcs_js $master] \
        newInstances [atcs_jarr $new_instances] newNets [atcs_jarr $new_nets] planSha256 [atcs_js $plan_sha256]]]
    return [atcs_snapshot_mutation atcs_split_load split_load $args_json $plan_sha256 \
        [list split_load -pin_group $groups -lib_cell $master -new_cell_names $new_instances \
            -new_net_names $new_nets] $expected $new_nets]
}
proc atcs_split_net {net master rule segments plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_net $net
    atcs_check_master $master
    atcs_choice rule $rule {wire_length cap}
    atcs_int segments $segments 2 16
    set args_json [atcs_jobj [list net [atcs_js $net] master [atcs_js $master] rule [atcs_js $rule] \
        segments $segments planSha256 [atcs_js $plan_sha256]]]
    return [atcs_snapshot_mutation atcs_split_net split_net $args_json $plan_sha256 \
        [list split_net $net -lib_cell $master -rule $rule -segment $segments]]
}
proc atcs_move_cell {instance mode x y plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    atcs_choice mode $mode {to delta}
    atcs_number x $x -1000000 1000000
    atcs_number y $y -1000000 1000000
    set args_json [atcs_jobj [list instance [atcs_js $instance] mode [atcs_js $mode] x $x y $y \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_targeted atcs_move_cell move_cell $args_json $plan_sha256 [list $instance] {} \
        [list move_cell -$mode [list $x $y] $instance] xtop-return]
}
proc atcs_remove_buffer {instance plan_sha256} {
    atcs_begin_mutation $plan_sha256
    atcs_require_instance $instance
    set args_json [atcs_jobj [list instance [atcs_js $instance] planSha256 [atcs_js $plan_sha256]]]
    return [atcs_snapshot_mutation atcs_remove_buffer remove_buffer $args_json $plan_sha256 \
        [list remove_buffer [list $instance]] [dict create $instance ""]]
}
proc atcs_fix_hold_pins {pins effort hold_target setup_margin size_cell_only use_dummy_cell fix_timing_window
                         max_cluster_loader_count max_delay_cell_length delay_cell_list plan_sha256} {
    atcs_begin_mutation $plan_sha256
    set pins [atcs_list pins $pins 1]
    foreach pin $pins { atcs_require_domain_pin $pin }
    atcs_choice effort $effort $::ATCS_EFFORTS
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
    if {$fix_timing_window && $size_cell_only} { error "fix_timing_window cannot be combined with size_cell_only" }
    if {$fix_timing_window && $effort ne "low"} { error "fix_timing_window works only with low effort, got $effort" }
    set command [list fix_hold_gba_violations -effort $effort -hold_target $hold_target -setup_margin $setup_margin]
    if {$size_cell_only} { lappend command -size_cell_only }
    if {$use_dummy_cell} { lappend command -use_dummy_cell }
    if {$fix_timing_window} { lappend command -fix_timing_window }
    if {$max_cluster_loader_count > 0} { lappend command -max_cluster_loader_count $max_cluster_loader_count }
    if {$max_delay_cell_length >= 0} {
        lappend command -max_delay_cell_length $max_delay_cell_length -delay_cell_list $delay_cell_list
    }
    lappend command -only_pins $pins
    set args_json [atcs_jobj [list pins [atcs_jarr $pins] effort [atcs_js $effort] holdTarget $hold_target \
        setupMargin $setup_margin sizeCellOnly [atcs_jbool $size_cell_only] useDummyCell [atcs_jbool $use_dummy_cell] \
        fixTimingWindow [atcs_jbool $fix_timing_window] maxClusterLoaderCount $max_cluster_loader_count \
        maxDelayCellLength $max_delay_cell_length delayCellList [atcs_jarr $delay_cell_list] \
        planSha256 [atcs_js $plan_sha256]]]
    return [atcs_snapshot_mutation atcs_fix_hold_pins fix_hold_gba_violations $args_json $plan_sha256 $command]
}
proc atcs_fix_setup_pins {pins methods remove_buffer_only size_down_only setup_target hold_margin plan_sha256} {
    atcs_begin_mutation $plan_sha256
    set pins [atcs_list pins $pins 1]
    foreach pin $pins { atcs_require_domain_pin $pin }
    set methods [atcs_list methods $methods]
    foreach method $methods { atcs_choice method $method $::ATCS_FIX_SETUP_METHODS }
    atcs_flag removeBufferOnly $remove_buffer_only
    atcs_flag sizeDownOnly $size_down_only
    atcs_number setupTarget $setup_target -$::ATCS_SLACK_LIMIT $::ATCS_SLACK_LIMIT
    atcs_number holdMargin $hold_margin -$::ATCS_SLACK_LIMIT $::ATCS_SLACK_LIMIT
    if {$remove_buffer_only && ([llength $methods] > 0 || $size_down_only)} {
        error "removeBufferOnly is a pass of its own: no methods and no sizeDownOnly with it"
    }
    if {!$remove_buffer_only && !$size_down_only && [llength $methods] == 0} {
        error "name methods, removeBufferOnly or sizeDownOnly"
    }
    set command [list fix_setup_gba_violations]
    if {[llength $methods] > 0} { lappend command -methods $methods }
    if {$remove_buffer_only} { lappend command -remove_buffer_only }
    if {$size_down_only} { lappend command -size_down_only }
    lappend command -setup_target $setup_target -hold_margin $hold_margin -only_pins $pins
    set args_json [atcs_jobj [list pins [atcs_jarr $pins] methods [atcs_jarr $methods] \
        removeBufferOnly [atcs_jbool $remove_buffer_only] sizeDownOnly [atcs_jbool $size_down_only] \
        setupTarget $setup_target holdMargin $hold_margin planSha256 [atcs_js $plan_sha256]]]
    return [atcs_snapshot_mutation atcs_fix_setup_pins fix_setup_gba_violations $args_json $plan_sha256 $command]
}
# Undo the last kept, not yet undone mutation. XTop's `undo` reverts its latest ECO
# checkpoint; the result is checked against that mutation's recorded `before` state.
proc atcs_undo {plan_sha256} {
    atcs_begin_mutation $plan_sha256
    if {[llength $::atcs_kept] == 0} { error "nothing to undo: no kept mutation remains in this session" }
    set target [lindex $::atcs_kept end]
    set op $::atcs_op($target)
    set op_before [dict get $op before]
    set op_after [dict get $op after]
    atcs_commit_mutation $plan_sha256
    set command [list undo]
    if {[dict get $op mode] eq "snapshot"} {
        set s0 [atcs_snapshot]
        lassign [atcs_call $command] code result
        set s1 [atcs_snapshot]
        set delta [atcs_diff $s0 $s1]
        set restored [expr {$code == 0 && [dict size $delta] == [dict size $op_before]}]
        dict for {name master} $op_before {
            if {![dict exists $delta $name] || [dict get $delta $name] ne [list [dict get $op_after $name] $master]} {
                set restored 0
            }
        }
        set before [dict create]
        set after [dict create]
        foreach name [lsort -unique [concat [dict keys $op_before] [dict keys $delta]]] {
            dict set before $name [expr {[dict exists $s0 $name] ? [dict get $s0 $name] : ""}]
            dict set after $name [expr {[dict exists $s1 $name] ? [dict get $s1 $name] : ""}]
        }
        set unchanged [expr {[dict size $delta] == 0}]
    } else {
        set touched [dict keys $op_before]
        set before [atcs_state $touched]
        lassign [atcs_call $command] code result
        set after [atcs_state $touched]
        if {[dict get $op verified] eq "xtop-return"} {
            set restored [expr {$code == 0 && [atcs_state_equal $after $before]}]
        } else {
            set restored [expr {$code == 0 && [atcs_state_equal $after $op_before]}]
        }
        set unchanged [atcs_state_equal $after $before]
    }
    if {$restored} {
        set status kept
    } elseif {$code != 0 && $unchanged} {
        set status error
    } else {
        set status uncertain
    }
    set fields [list cmd [atcs_js undo] proc [atcs_js atcs_undo] undoes $target \
        args [atcs_jobj [list planSha256 [atcs_js $plan_sha256]]] status [atcs_js $status] \
        before [atcs_state_json $before] after [atcs_state_json $after] xtop [atcs_xtop_json $command $code $result]]
    if {[dict get $op verified] eq "xtop-return"} { lappend fields verified [atcs_js xtop-return] }
    lassign [atcs_log_op $fields] seq line
    switch -- $status {
        kept {
            atcs_forget $target
            return "$line\n[atcs_log_gain undo $seq]"
        }
        error { error "undo of seq $target failed and changed nothing (seq $seq): $result" }
        default { atcs_taint "undo of seq $target did not restore its before state (seq $seq, XTop code $code: $result)" }
    }
}

proc atcs_dump_cells {path} {
    # `get_cells -hierarchical` (documented, get_cells.1) plus
    # `foreach_in_collection` (documented, foreach_in_collection.1) is the
    # confirmed way to iterate every cell; `full_name`/`ref_name` are
    # queried the same way get_attribute.1's own worked example does
    # (`get_attribute [get_cells U43] ref_name`) -- see
    # knowledge/xtop-capabilities.md for the full citation. There is no
    # documented `get_object_name`; do not reintroduce it.
    set fh [open $path w]
    foreach_in_collection i [get_cells -hierarchical] {
        set inst [get_attribute [get_cells $i] full_name]
        set master [get_attribute [get_cells $i] ref_name]
        puts $fh "$inst $master"
    }
    close $fh
}
proc atcs_export_changes {} {
    file mkdir $::eco_output_dir
    write_design_changes -format INNOVUS -eco_file_prefix $::env(ECO_PREFIX) \
        -output_dir $::eco_output_dir -keep_route
    save_workspace -as ${::design}_operator_candidate
    return $::eco_output_dir
}
proc atcs_close {} {
    return "closing after adapter receipt"
}

puts "ATCS:worker:$env(NAME_PREFIX)"
puts "HIMA:hima-tcl-line-v1:1:READY"
