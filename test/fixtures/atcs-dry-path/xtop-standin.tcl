# In-memory XTop for the ATCS dry path (Issue #64 Track B): no XTop, timing or QoR claim.
#
# Sourced ahead of the Pack's own rendered XTop Tcl -- a worker slot's session
# (`xtop-analysis-manual.tcl` + `operator.tcl`, by atcs-dry-repl.tcl) and each arm of the recipe
# replay (`xtop-replay.tcl`, by eda-standin.py) -- so the Pack's real `atcs_*` toolkit, recipe
# replay, auto-finish and export run unchanged over it. It is the Pack's own toolkit stub
# (flow/tests/test_xtop_toolkit.py STUB_XTOP and test_adapters.py REPLAY_STUB), loading the design
# its `create_design_definition -verilogs` netlist instead of a fixed array and answering timing from one fixed synthetic model:
#
#   the setup endpoint of block X is u_X/reg0/I in func_ssg_rcworst, with a slack fixed by the
#   master of u_X/reg0: BUFFD1BWP -0.0500, BUFFD2BWP -0.0300, BUFFD4BWP -0.0100, BUFFD8BWP -0.0050. Nothing else
#   violates: no hold check, no func_ffg_cbest check. The same model is eda-standin.py's PrimeTime.
#   `report_timing -to <pin> -delay_type max|min -path_type summary` (`atcs_point`) prints one row per
#   scenario from that model: the endpoint, the scenario and its slack (0.1000 where nothing fails).
#
# Collections as XTop answers them: `get_pins -of_objects` of a cell gives its pins, of a net the pins
# on that net -- what a session's in-session domain derivation (#66 D2) walks one hop out.
#
# ECO bookkeeping as the Pack's stub: every edit pushes one action (the design before it and the
# cells it touched); `count_eco_actions`, `get_eco_cells -last_n` and `undo` read that stack.
# `fix_setup_gba_violations -methods size_cell` (auto-finish, or a targeted fix with -only_pins)
# upsizes every failing, not-dont-touch reg0 one step; every other fix flow changes nothing.
# `write_design_changes` writes an Innovus netlist ECO of `ecoChangeCell` lines (every master that
# differs from the loaded design) and a physical ECO that keeps every changed cell in place.

proc stub_record {args} {
    if {![info exists ::env(STUB_CALLS)]} { return }
    set fh [open $::env(STUB_CALLS) a]
    puts $fh [join $args "\x1f"]
    close $fh
}
foreach stub_name {set_parameter create_workspace link_reference_library
                   set_site_map set_removable_fillers import_designs check_placement_readiness
                   read_timing_data check_inst_reference_library check_inst_timing_library save_workspace
                   create_corner link_timing_library create_mode create_scenario} {
    proc $stub_name {args} {}
}

# ---- design ------------------------------------------------------------------
array set ::stub_mod {}
proc stub_net {prefix net portmap} {
    if {[dict exists $portmap $net]} { return [dict get $portmap $net] }
    return "$prefix$net"
}
proc stub_walk {module prefix portmap} {
    foreach entry $::stub_mod($module) {
        lassign $entry inst master pins
        set path "$prefix$inst"
        if {[info exists ::stub_mod($master)]} {
            set sub [dict create]
            foreach {pin net} $pins { dict set sub $pin [stub_net $prefix $net $portmap] }
            stub_walk $master "$path/" $sub
        } else {
            set ::cells($path) $master
            foreach {pin net} $pins { set ::pin_net($path/$pin) [stub_net $prefix $net $portmap] }
        }
    }
}
proc stub_load_netlist {path} {
    set fh [open $path]
    set text [read $fh]
    close $fh
    set module ""
    foreach line [split $text "\n"] {
        set line [string trim $line]
        if {[regexp {^module\s+(\w+)} $line -> name]} { set module $name; set ::stub_mod($name) {}; continue }
        if {[string match endmodule* $line]} { set module ""; continue }
        if {$module ne "" && [regexp {^(\w+)\s+(\w+)\s*\((.*)\)\s*;} $line -> master inst conns]} {
            if {[lsearch -exact {input output wire inout} $master] >= 0} { continue }
            set pins {}
            foreach {all pin net} [regexp -all -inline {\.(\w+)\((\w+)\)} $conns] { lappend pins $pin $net }
            lappend ::stub_mod($module) [list $inst $master $pins]
        }
    }
    stub_walk top "" [dict create]
    array set ::stub_base_cells [array get ::cells]
}
array set ::cells {}
array set ::pin_net {}
# The design the session or replay defines (`create_design_definition -verilogs <netlist> -def ...`).
proc create_design_definition {args} {
    lassign [stub_opts {-verilogs -def} $args] o pos
    stub_load_netlist [stub_one $o -verilogs]
}

set ::actions {}
set ::stub_dont_touch {}
set ::stub_fix_ran 0
set ::stub_out ""
proc stub_act {touched} {
    lappend ::actions [list [array get ::cells] [array get ::pin_net] $touched]
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
proc stub_owner {pin} { return [join [lrange [split $pin /] 0 end-1] /] }

# ---- collections -------------------------------------------------------------
proc get_cells {args} {
    stub_record get_cells {*}$args
    lassign [stub_opts {-of_objects -filter} $args] o pos
    if {[dict exists $o -hierarchical]} {
        set r {}
        foreach n [lsort [array names ::cells]] { lappend r "cell:$n" }
        return $r
    }
    if {[dict exists $o -of_objects]} {
        set owner [stub_owner [stub_strip [stub_one $o -of_objects]]]
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
        set object [lindex [stub_one $o -of_objects] 0]
        set owner [stub_strip $object]
        set r {}
        foreach p [lsort [array names ::pin_net]] {
            if {[string match net:* $object] ? $::pin_net($p) eq $owner : [stub_owner $p] eq $owner} { lappend r "pin:$p" }
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
    set obj [lindex $obj 0]
    if {![regexp {^(cell|pin|net):} $obj]} { error "get_attribute: unwrapped native object $obj" }
    set name [stub_strip $obj]
    if {$attr eq "full_name"} { return $name }
    if {$attr eq "ref_name" && [string match "cell:*" $obj]} { return $::cells($name) }
    error "get_attribute: unsupported $attr on $obj"
}
proc sizeof_collection {c} { return [llength $c] }
proc foreach_in_collection {iter_var collection body} {
    upvar 1 $iter_var i
    foreach i $collection { uplevel 1 $body }
}

# ---- ECO bookkeeping ---------------------------------------------------------
proc count_eco_actions {args} { return [llength $::actions] }
proc get_eco_cells {args} {
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
proc undo {args} {
    stub_record undo {*}$args
    if {[llength $::actions] == 0} { error "Error: no ECO checkpoint to undo" }
    array unset ::cells
    array unset ::pin_net
    array set ::cells [lindex $::actions end 0]
    array set ::pin_net [lindex $::actions end 1]
    set ::actions [lrange $::actions 0 end-1]
    return ""
}
proc set_dont_touch {args} {
    stub_record set_dont_touch {*}$args
    set ::stub_dont_touch [stub_names [lindex $args 0]]
    return 1
}

# ---- edits -------------------------------------------------------------------
proc size_cell {args} {
    stub_record size_cell {*}$args
    lassign [stub_opts {-design -location} $args] o pos
    set names [stub_names [lindex $pos 0]]
    foreach c $names { if {![info exists ::cells($c)]} { error "size_cell: no cell named $c" } }
    stub_act $names
    foreach c $names { set ::cells($c) [lindex $pos 1] }
    return "Info: sized \"$names\"\tto [lindex $pos 1]\n"
}
foreach stub_name {exchange_cell insert_buffer insert_dummy_cell split_load split_net move_cell remove_buffer} {
    proc $stub_name {args} "stub_record $stub_name {*}\$args; error {the dry-path XTop stand-in does not answer $stub_name}"
}
set ::stub_steps {BUFFD1BWP BUFFD2BWP BUFFD2BWP BUFFD4BWP BUFFD4BWP BUFFD8BWP}
proc fix_setup_gba_violations {args} {
    stub_record fix_setup_gba_violations {*}$args
    set ::stub_fix_ran setup
    lassign [stub_opts {-methods -effort -setup_target -hold_margin -only_pins -buffer_list} $args] o pos
    if {[dict exists $o -methods] && [stub_one $o -methods] ne "size_cell"} { return 0 }
    set only {}
    if {[dict exists $o -only_pins]} { set only [stub_names [stub_one $o -only_pins]] }
    set touched {}
    foreach endpoint [stub_failing_endpoints] {
        set cell [stub_owner $endpoint]
        if {[llength $only] > 0 && [lsearch -exact $only $endpoint] < 0} { continue }
        if {[lsearch -exact $::stub_dont_touch $cell] >= 0} { continue }
        if {![dict exists [dict create {*}$::stub_steps] $::cells($cell)]} { continue }
        lappend touched $cell
    }
    if {[llength $touched] == 0} { return 0 }
    stub_act $touched
    foreach cell $touched { set ::cells($cell) [dict get [dict create {*}$::stub_steps] $::cells($cell)] }
    return [llength $touched]
}
proc fix_hold_gba_violations {args} {
    stub_record fix_hold_gba_violations {*}$args
    set ::stub_fix_ran hold
    return 0
}

# ---- timing ------------------------------------------------------------------
set ::stub_scenarios {func_ssg_rcworst func_ffg_cbest}
proc stub_slack {master} {
    switch -- $master {
        BUFFD2BWP { return -0.0300 }
        BUFFD4BWP { return -0.0100 }
        BUFFD8BWP { return -0.0050 }
        default { return -0.0500 }
    }
}
proc stub_failing_endpoints {} {
    set out {}
    foreach cell [lsort [array names ::cells]] {
        if {[regexp {^u_[a-z]+/reg0$} $cell]} { lappend out "$cell/I" }
    }
    return $out
}
# {count worst tns} of one check in one scenario, on the current design.
proc stub_row {check scenario} {
    if {$check ne "setup" || $scenario ne "func_ssg_rcworst"} { return {0 0.0 0.0} }
    set count 0
    set worst 0.0
    set tns 0.0
    foreach endpoint [stub_failing_endpoints] {
        set slack [stub_slack $::cells([stub_owner $endpoint])]
        incr count
        if {$slack < $worst} { set worst $slack }
        set tns [expr {$tns + $slack}]
    }
    return [list $count $worst $tns]
}
proc stub_rows {check} {
    set rows [dict create]
    set total {0 0.0 0.0}
    foreach scenario $::stub_scenarios {
        set row [stub_row $check $scenario]
        dict set rows $scenario $row
        lassign $total c w t
        lassign $row rc rw rt
        set total [list [expr {$c + $rc}] [expr {min($w, $rw)}] [expr {$t + $rt}]]
    }
    return [list $total $rows]
}
proc stub_plain_table {check} {
    lassign [stub_rows $check] total rows
    set lines [list "### $check summary ###" "Scenario                  Count      Worst        TNS" [string repeat - 54]]
    lassign $total c w t
    lappend lines [format "total                 %10d %10.4f %10.4f" $c $w $t]
    dict for {name row} $rows {
        lassign $row c w t
        lappend lines [format "  %-24s%6d %10.4f %10.4f" $name $c $w $t]
    }
    return [join $lines "\n"]
}
proc stub_delta_line {name row ref} {
    lassign $row c w t
    lassign $ref c0 w0 t0
    return [format "%-26s%6d %9d %+10d    |  %9.4f %10.4f %+10.4f    |  %9.4f %10.4f %+10.4f" \
        $name $c $c0 [expr {$c - $c0}] $w $w0 [expr {$w - $w0}] $t $t0 [expr {$t - $t0}]]
}
proc stub_delta_table {check} {
    if {![info exists ::stub_reference($check)]} { error "Error: no reference to compare with for $check" }
    lassign $::stub_reference($check) ref_total ref_rows
    lassign [stub_rows $check] total rows
    set lines [list "### $check summary ###" \
        "Scenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS" \
        [string repeat - 129]]
    lappend lines [stub_delta_line total $total $ref_total]
    dict for {name row} $rows { lappend lines [stub_delta_line "  $name" $row [dict get $ref_rows $name]] }
    return [join $lines "\n"]
}
proc stub_top_table {check n reasons} {
    set header "  Slack    Scenario                Name       [expr {$reasons ? {Fail Reason      } : {}}]"
    set lines [list "### $check top $n endpoints ###" $header [string repeat - 60]]
    if {$check eq "setup"} {
        foreach endpoint [lrange [stub_failing_endpoints] 0 [expr {$n - 1}]] {
            set line [format "%.4f    func_ssg_rcworst    %s" [stub_slack $::cells([stub_owner $endpoint])] $endpoint]
            if {$reasons} { append line "      no_setup_gain:100%" }
            lappend lines $line
        }
    }
    return [join $lines "\n"]
}
proc summarize_gba_violations {args} {
    stub_record summarize_gba_violations {*}$args
    lassign [stub_opts {-with_top_n} $args] o pos
    set check [expr {[dict exists $o -hold] ? "hold" : "setup"}]
    if {[dict exists $o -with_fail_reason] && $::stub_fix_ran eq "0"} {
        puts "Error: No fail reason since no fix or optimize flow have run yet."
        error ""
    }
    if {[dict exists $o -as_reference]} {
        set ::stub_reference($check) [stub_rows $check]
        set text [stub_plain_table $check]
    } elseif {[dict exists $o -with_reference]} {
        set text [stub_delta_table $check]
    } else {
        set text [stub_plain_table $check]
    }
    if {[dict exists $o -with_top_n]} {
        append text "\n\n" [stub_top_table $check [stub_one $o -with_top_n] [dict exists $o -with_fail_reason]]
    }
    append ::stub_out $text "\n"
    return ""
}
proc redirect {args} {
    if {[lindex $args 0] eq "-file"} {
        set ::stub_out ""
        set code [catch {uplevel #0 [lindex $args 2]} r]
        set fh [open [lindex $args 1] w]
        puts $fh [expr {$::stub_out ne "" ? $::stub_out : $r}]
        close $fh
        set ::stub_out ""
        if {$code} { error $r }
        return ""
    }
    set target [lindex $args end-1]
    set ::stub_out ""
    set code [catch {uplevel #0 [lindex $args end]} r]
    upvar #0 $target captured
    set captured [expr {$::stub_out ne "" ? $::stub_out : $r}]
    set ::stub_out ""
    if {$code} { error $r }
    return ""
}
proc report_timing {args} {
    stub_record report_timing {*}$args
    lassign [stub_opts {-to -delay_type -path_type} $args] o pos
    set endpoint [stub_strip [stub_one $o -to]]
    set failing [expr {[stub_one $o -delay_type] eq "max" && [lsearch -exact [stub_failing_endpoints] $endpoint] >= 0}]
    append ::stub_out "Endpoint                  Scenario                  Slack\n" [string repeat - 60] "\n"
    foreach scenario $::stub_scenarios {
        set slack [expr {$failing && $scenario eq "func_ssg_rcworst" ? [stub_slack $::cells([stub_owner $endpoint])] : 0.1000}]
        append ::stub_out [format "%-26s%-26s%.4f\n" $endpoint $scenario $slack]
    }
    return ""
}
proc get_paths {args} { stub_record get_paths {*}$args; return [list path:1] }
proc analyze_setup_path_violations {args} {
    stub_record analyze_setup_path_violations {*}$args
    set lines {}
    foreach endpoint [stub_failing_endpoints] {
        lappend lines [format "endpoint %s slack %.4f cell %s" $endpoint [stub_slack $::cells([stub_owner $endpoint])] \
            $::cells([stub_owner $endpoint])]
    }
    return [join $lines "\n"]
}
proc analyze_hold_path_violations {args} { stub_record analyze_hold_path_violations {*}$args; return "no hold violation" }
proc report_fail_reasons {args} {
    stub_record report_fail_reasons {*}$args
    append ::stub_out "Fail reasons: none recorded by the dry-path stand-in\n"
    return ""
}
proc get_failed_pins {args} { stub_record get_failed_pins {*}$args; return {} }
foreach stub_name {list_size_cell_candidates list_insert_buffer_candidates list_exchange_cell_candidates} {
    proc $stub_name {args} { return "BUFFD1BWP BUFFD2BWP BUFFD4BWP BUFFD8BWP" }
}
proc write_design_changes {args} {
    stub_record write_design_changes {*}$args
    lassign [stub_opts {-format -eco_file_prefix -output_dir -version -last_n} $args] o pos
    set dir [stub_one $o -output_dir]
    set prefix [stub_one $o -eco_file_prefix]
    file mkdir $dir
    set lines {}
    foreach cell [lsort [array names ::cells]] {
        if {![info exists ::stub_base_cells($cell)] || $::stub_base_cells($cell) ne $::cells($cell)} {
            lappend lines "ecoChangeCell -inst {$cell} -cell {$::cells($cell)}"
        }
    }
    set fh [open [file join $dir "${prefix}_netlist_top.txt"] w]
    puts $fh [join [concat [list "# dry-path stand-in netlist ECO"] $lines] "\n"]
    close $fh
    set fh [open [file join $dir "${prefix}_physical_top.txt"] w]
    puts $fh "# dry-path stand-in physical ECO: every changed cell keeps its place"
    puts $fh "setEcoMode -batchMode true"
    foreach line $lines {
        if {[regexp {^ecoChangeCell -inst \{(\S+)\}} $line -> cell]} { puts $fh "placeInstance {$cell} 0.0 0.0 R0 -placed" }
    }
    puts $fh "setEcoMode -batchMode false"
    close $fh
    return ""
}
