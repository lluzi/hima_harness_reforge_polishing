# Synthetic local command implementation: no XTop, timing or QoR claim.
cd [lindex $argv 0]
set master BUF1
set done 0
proc atcs_query_paths {} { return {synthetic path} }
proc atcs_query_cells {object attr} { return $::master }
proc atcs_size_cell {instance toMaster planSha256} {
    if {$instance ne "U1"} { error out-of-domain }
    set before $::master
    set ::master $toMaster
    set fh [open ops.jsonl a]
    puts $fh [format {{"op":"size_cell","instance":"U1","fromMaster":"%s","toMaster":"%s"}} $before $toMaster]
    close $fh
    return MUTATED
}
proc atcs_dump_cells {target} {
    set fh [open $target w]
    puts $fh "U1 $::master"
    close $fh
    return DUMPED
}
proc atcs_export_changes {} { return {synthetic route-preserving receipt} }
proc atcs_close {} { set ::done 1; return CLOSED }
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
