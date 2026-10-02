# Matched ordinary AutoFix reference. The enclosing task starts from the common R1.
# There is intentionally no method-specific round or wall-clock cap: the Runtime/Site budget is the
# fence. Stop only when the actual native timing reports stop changing or both violation sets clear.
set rounds {}
set stopped ""
redirect -variable previous_setup {summarize_gba_violations -exclude_path -setup -with_distribution -with_top_n 10000}
redirect -variable previous_hold {summarize_gba_violations -exclude_path -hold -with_distribution -with_top_n 10000}
set previous_fingerprint "$previous_setup\n$previous_hold"
for {set round 1} {$stopped eq ""} {incr round} {
    set results {}
    foreach command $fixes {
        set code [catch {uplevel #0 $command} message]
        lappend results [atcs_jobj [list command [atcs_js $command] code $code result [atcs_js [atcs_clip $message 2000]]]]
        if {$code != 0} { error "ordinary AutoFix failed: $message" }
    }
    redirect -variable current_setup {summarize_gba_violations -exclude_path -setup -with_distribution -with_top_n 10000}
    redirect -variable current_hold {summarize_gba_violations -exclude_path -hold -with_distribution -with_top_n 10000}
    set setup_pins [sizeof_collection [get_setup_gba_violated_pins -exclude_path -endpoint_only]]
    set hold_pins [sizeof_collection [get_hold_gba_violated_pins -exclude_path -endpoint_only]]
    set current_fingerprint "$current_setup\n$current_hold"
    lappend rounds [atcs_jobj [list round $round commands "\[[join $results ,]\]" setupViolations $setup_pins holdViolations $hold_pins]]
    if {$setup_pins == 0 && $hold_pins == 0} {
        set stopped goal
    } elseif {$current_fingerprint eq $previous_fingerprint} {
        set stopped no-timing-report-improvement
    } else {
        set previous_fingerprint $current_fingerprint
    }
}
file mkdir [file join $::operator_root eco]
write_design_changes -format INNOVUS -eco_file_prefix atcs_autofix_reference -output_dir [file join $::operator_root eco] -keep_route
save_workspace -as [file join $::operator_root best-workspace]
set fh [open [file join $::operator_root control-result.json] w]
puts $fh [atcs_jobj [list complete true stopped [atcs_js $stopped] rounds "\[[join $rounds ,]\]" completedAt [clock seconds]]]
close $fh
