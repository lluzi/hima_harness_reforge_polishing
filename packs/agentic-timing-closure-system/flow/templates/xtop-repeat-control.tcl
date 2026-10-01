# Strong control: default setup-size/setup-buffer/hold-size/hold, re-observe, repeat.
# Same persistent R1 session, same external parent and final physical-refresh budget.
set rounds {}
set stopped deadline
for {set round 1} {$round <= 128 && [clock seconds] < $deadline} {incr round} {
    set actions_before [count_eco_actions]
    set results {}
    foreach command $fixes {
        # A tool failure is execution failure, never a convergence result.
        set code [catch {uplevel #0 $command} message]
        lappend results [atcs_jobj [list command [atcs_js $command] code $code result [atcs_js [atcs_clip $message 2000]]]]
        if {$code != 0} { error "strong control fix failed: $message" }
    }
    set pins 0
    foreach check {setup hold} {
        redirect -file "control-${round}-${check}.rpt" [list summarize_gba_violations -exclude_path -$check -with_distribution]
        incr pins [sizeof_collection [get_${check}_gba_violated_pins -exclude_path -endpoint_only]]
    }
    lappend rounds [atcs_jobj [list round $round commands "\[[join $results ,]\]" violatedPins $pins actions [count_eco_actions]]]
    if {$pins == 0} { set stopped goal; break }
    if {[count_eco_actions] == $actions_before} { set stopped no-change; break }
    if {$round == 128} { set stopped bounded-round-limit }
}
atcs_export_changes "Strong default GBA control; stopped $stopped"
set fh [open control-result.json w]
puts $fh [atcs_jobj [list complete true stopped [atcs_js $stopped] rounds "\[[join $rounds ,]\]" completedAt [clock seconds]]]
close $fh
exit 0
