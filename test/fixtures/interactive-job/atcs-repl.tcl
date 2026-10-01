# Synthetic local command implementation: no XTop, timing or QoR claim.
#
# It stands in for one slot's xtop-operator session and writes what the Task 3 toolkit writes
# (flow/templates/xtop-operator.tcl), so `capture-contribution` seals a real `xtop-session`
# Contribution from it: one `ops.jsonl` line per mutation ({seq, cmd, proc, args with planSha256,
# status, observe, ecoActions, before, after, xtop}), `gain.jsonl` readings (the seq-0 session
# reference and one `mutation` reading per kept mutation, in the real summarize_gba_violations
# layout pinned by flow/tests/xtop_summary_samples.py), `eco_output/` on export and the
# `ATCS:taint:clean` transcript line on close. The readings are fixed synthetic numbers.
cd [lindex $argv 0]
set master BUF1
set seq 0
set reference_captured 0
set done 0
set ::ref_checks {{"setup":{"command":"summarize_gba_violations -as_reference -setup","code":0,"result":"","text":"### setup summary ###\nScenario                  Count      Worst        TNS\n------------------------------------------------------\ntotal                       4    -0.0200    -0.1000\n  func_ss                   4    -0.0200    -0.1000\n"},"hold":{"command":"summarize_gba_violations -as_reference -hold","code":0,"result":"","text":"### hold summary ###\nScenario                  Count      Worst        TNS\n------------------------------------------------------\ntotal                      30    -0.0700    -1.2000\n  func_ss                  30    -0.0700    -1.2000\n"}}}
set ::mutation_checks {{"setup":{"command":"summarize_gba_violations -with_delta -with_reference -setup","code":0,"result":"","text":"### setup summary ###\nScenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS\n---------------------------------------------------------------------------------------------------------------------------------\ntotal                        3         4         -1    |    -0.0100    -0.0200    +0.0100    |    -0.0500    -0.1000    +0.0500\n  func_ss                    3         4         -1    |    -0.0100    -0.0200    +0.0100    |    -0.0500    -0.1000    +0.0500\n"},"hold":{"command":"summarize_gba_violations -with_delta -with_reference -hold","code":0,"result":"","text":"### hold summary ###\nScenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS\n---------------------------------------------------------------------------------------------------------------------------------\ntotal                        3         4         -1    |    -0.0500    -0.0700    +0.0200    |    -0.9000    -1.2000    +0.3000\n  func_ss                    3         4         -1    |    -0.0500    -0.0700    +0.0200    |    -0.9000    -1.2000    +0.3000\n"}}}
proc atcs_js {text} { return "\"[string map [list \\ \\\\ \" \\\" \n \\n] $text]\"" }
proc atcs_append {file line} { set fh [open $file a]; puts $fh $line; close $fh }
proc atcs_capture_reference {} {
    if {$::reference_captured} { return "session reference already captured; it is never moved" }
    set ::reference_captured 1
    set line "{\"seq\":$::seq,\"kind\":\"reference\",\"checks\":$::ref_checks}"
    atcs_append gain.jsonl $line
    return $line
}
proc atcs_query_paths {} { return {synthetic path} }
proc atcs_query_cells {object attr} { return $::master }
proc atcs_ref {} { return [atcs_capture_reference] }
proc atcs_size_cell {instance toMaster planSha256} {
    if {$instance ne "U1"} { error out-of-domain }
    atcs_capture_reference
    set before $::master
    set ::master $toMaster
    incr ::seq
    set args "{\"instance\":[atcs_js $instance],\"toMaster\":[atcs_js $toMaster],\"planSha256\":[atcs_js $planSha256]}"
    set line "{\"seq\":$::seq,\"cmd\":\"size_cell\",\"proc\":\"atcs_size_cell\",\"args\":$args,\"status\":\"kept\",\"observe\":\"fast\",\"ecoActions\":1,\"before\":{\"instances\":{\"U1\":[atcs_js $before]}},\"after\":{\"instances\":{\"U1\":[atcs_js $toMaster]}},\"xtop\":{\"command\":[atcs_js "size_cell U1 $toMaster"],\"code\":0,\"result\":\"\"}}"
    atcs_append ops.jsonl $line
    atcs_append gain.jsonl "{\"seq\":$::seq,\"kind\":\"mutation\",\"checks\":$::mutation_checks}"
    return MUTATED
}
proc atcs_dump_cells {target} {
    set fh [open $target w]
    puts $fh "U1 $::master"
    close $fh
    return DUMPED
}
proc atcs_export_changes {{limitations ""}} {
    file mkdir eco_output
    set fh [open [file join eco_output synthetic_eco.tcl] w]
    puts $fh "# synthetic route-preserving ECO receipt"
    close $fh
    return eco_output
}
proc atcs_close {} {
    set fh [open xtop_log_1.txt a]
    puts $fh "ATCS:taint:clean"
    close $fh
    puts "ATCS:taint:clean"
    set ::done 1
    return CLOSED
}
# A test may slow this session's startup, as a real XTop's is: `startup-delay-ms` in the slot holds
# how long to wait before the ready line.
if {[file exists startup-delay-ms]} {
    set fh [open startup-delay-ms]; set delay [string trim [read $fh]]; close $fh
    after $delay
}
puts "HIMA:hima-tcl-line-v1:1:READY"
flush stdout
set script ""
while {!$done && [gets stdin line] >= 0} {
    append script $line "\n"
    if {![info complete $script]} { continue }
    if {[catch {uplevel #0 $script} message]} { puts stderr "FIXTURE-EVAL-ERROR:$message" }
    flush stdout
    flush stderr
    set script ""
}
