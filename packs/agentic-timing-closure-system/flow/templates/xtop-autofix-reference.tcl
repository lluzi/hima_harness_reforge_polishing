# Matched ordinary AutoFix reference. The enclosing task starts from the common R1.
# Runtime/Site budget is the only outer fence. A round advances the reference only when its actual
# Goal/residual comparison improves: satisfied positive margin may be spent, but no satisfied mode
# may fail and no unsatisfied residual may regress. The export is always the saved BEST, never last.

proc atcs_reference_metric {text check} {
    foreach line [split $text "\n"] {
        set fields [regexp -all -inline {\S+} [string trim $line]]
        if {[llength $fields] >= 4 && [lindex $fields 0] eq "total"} {
            set count [lindex $fields 1]; set worst [lindex $fields 2]; set tns [lindex $fields 3]
            if {[scan $count %d parsed_count] == 1 && [scan $worst %g parsed_worst] == 1 && [scan $tns %g parsed_tns] == 1} {
                return [list $parsed_count $parsed_worst $parsed_tns]
            }
        }
    }
    error "ordinary AutoFix cannot parse native $check total Count/Worst/TNS"
}
proc atcs_reference_capture {directory} {
    file mkdir $directory
    set metrics {}
    foreach check {setup hold} {
        set report [file join $directory "$check.rpt"]
        redirect -file $report [list summarize_gba_violations -exclude_path -$check -with_distribution -with_top_n 10000]
        set fh [open $report r]
        set text [read $fh]
        close $fh
        lappend metrics {*}[atcs_reference_metric $text $check]
    }
    return $metrics
}
proc atcs_reference_satisfied {metrics offset target} {
    expr {[lindex $metrics $offset] == 0 && [lindex $metrics [expr {$offset + 1}]] >= $target}
}
proc atcs_reference_compare {current best} {
    # Return improved/equal/regression. Once a mode satisfies its fixed Goal, positive margin is
    # expendable; losing satisfaction is not. For an unsatisfied mode, violation count is primary,
    # then WNS/TNS, and no other mode may regress.
    set strict 0
    foreach {offset target} [list 0 $::ATCS_REFERENCE_SETUP_TARGET 3 $::ATCS_REFERENCE_HOLD_TARGET] {
        set current_ok [atcs_reference_satisfied $current $offset $target]
        set best_ok [atcs_reference_satisfied $best $offset $target]
        if {$best_ok} {
            if {!$current_ok} { return regression }
            continue
        }
        if {$current_ok} { set strict 1; continue }
        set cc [lindex $current $offset]; set bc [lindex $best $offset]
        set cw [lindex $current [expr {$offset + 1}]]; set bw [lindex $best [expr {$offset + 1}]]
        set ct [lindex $current [expr {$offset + 2}]]; set bt [lindex $best [expr {$offset + 2}]]
        if {$cc > $bc || $cw < $bw || $ct < $bt} { return regression }
        if {$cc < $bc || $cw > $bw || $ct > $bt} { set strict 1 }
    }
    return [expr {$strict ? "improved" : "equal"}]
}
proc atcs_reference_metrics_json {metrics} {
    set setup_json [atcs_jobj [list violations [lindex $metrics 0] wnsNs [lindex $metrics 1] tnsNs [lindex $metrics 2]]]
    set hold_json [atcs_jobj [list violations [lindex $metrics 3] wnsNs [lindex $metrics 4] tnsNs [lindex $metrics 5]]]
    return [atcs_jobj [list setup $setup_json hold $hold_json]]
}
proc atcs_reference_save_best {root round_dir metrics round} {
    set best [file join $root best]
    file delete -force $best
    file mkdir [file join $best eco]
    file copy -force [file join $round_dir setup.rpt] [file join $best setup.rpt]
    file copy -force [file join $round_dir hold.rpt] [file join $best hold.rpt]
    write_design_changes -format INNOVUS -eco_file_prefix atcs_autofix_reference -output_dir [file join $best eco] -keep_route
    save_workspace -as [file join $best workspace]
    set fh [open [file join $best selection.json] w]
    puts $fh [atcs_jobj [list round $round metrics [atcs_reference_metrics_json $metrics]]]
    close $fh
}

set root $::operator_root
set rounds {}
set stopped ""
set best_round 0
atcs_write_cell_dump [file join $root loaded-r1.dump]
set best_metrics [atcs_reference_capture [file join $root round-000]]
set initial_metrics $best_metrics
set seen [list [join $best_metrics {|}]]
atcs_reference_save_best $root [file join $root round-000] $best_metrics 0
if {[atcs_reference_satisfied $best_metrics 0 $::ATCS_REFERENCE_SETUP_TARGET]
        && [atcs_reference_satisfied $best_metrics 3 $::ATCS_REFERENCE_HOLD_TARGET]} {
    set stopped goal
}

for {set round 1} {$stopped eq ""} {incr round} {
    set results {}
    foreach command $fixes {
        set code [catch {uplevel #0 $command} message]
        lappend results [atcs_jobj [list command [atcs_js $command] code $code result [atcs_js [atcs_clip $message 2000]]]]
        if {$code != 0} { error "ordinary AutoFix failed: $message" }
    }
    set round_dir [file join $root [format "round-%03d" $round]]
    set current [atcs_reference_capture $round_dir]
    set fingerprint [join $current {|}]
    lappend rounds [atcs_jobj [list round $round commands "\[[join $results ,]\]" metrics [atcs_reference_metrics_json $current]]]
    set comparison [atcs_reference_compare $current $best_metrics]
    if {$comparison eq "equal"} {
        set stopped no-improvement
    } elseif {[lsearch -exact $seen $fingerprint] >= 0} {
        set stopped oscillation
    } elseif {$comparison eq "improved"} {
        set best_metrics $current
        set best_round $round
        lappend seen $fingerprint
        atcs_reference_save_best $root $round_dir $best_metrics $best_round
        if {[atcs_reference_satisfied $best_metrics 0 $::ATCS_REFERENCE_SETUP_TARGET]
                && [atcs_reference_satisfied $best_metrics 3 $::ATCS_REFERENCE_HOLD_TARGET]} { set stopped goal }
    } elseif {$comparison eq "regression"} {
        set stopped regression
    } else {
        set stopped mixed-no-improvement
    }
}
set fh [open [file join $root control-result.json] w]
set best_metrics_json [atcs_reference_metrics_json $best_metrics]
set initial_metrics_json [atcs_reference_metrics_json $initial_metrics]
puts $fh [atcs_jobj [list complete true stopped [atcs_js $stopped] bestRound $best_round initialMetrics $initial_metrics_json bestMetrics $best_metrics_json rounds "\[[join $rounds ,]\]" completedAt [clock seconds]]]
close $fh
