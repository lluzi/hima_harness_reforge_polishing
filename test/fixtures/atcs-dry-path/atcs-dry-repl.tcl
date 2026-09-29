# Synthetic XTop Operator for the ATCS dry path (Issue #63): no XTop, timing or QoR claim.
# argv: <Campaign workspace> <slot> <the one instance in the slot's edit domain>
# The session runs in the slot's latest prepared revision (workspaces/<slot>/r<N>), as prepare-workers
# left it, and starts from the master the working state's own netlist gives the instance.
set workspace [lindex $argv 0]
set instance [lindex $argv 2]
cd [lindex [lsort -dictionary [glob -directory [file join $workspace workspaces [lindex $argv 1]] -type d r*]] end]
set fh [open [file join $workspace state working-state.json]]; set state [read $fh]; close $fh
regexp {"netlist":\s*\{[^\}]*"path":\s*"([^"]+)"} $state -> netlist
set fh [open [file join $workspace $netlist]]; set text [read $fh]; close $fh
regexp -line "^\\s*(\\w+)\\s+[lindex [split $instance /] end]\\s*\\(" $text -> master
set done 0
proc atcs_query_paths {} { return {synthetic path} }
proc atcs_query_cells {object attr} { return $::master }
proc atcs_size_cell {instance toMaster planSha256} {
    if {$instance ne $::instance} { error out-of-domain }
    set before $::master
    set ::master $toMaster
    set fh [open ops.jsonl a]
    puts $fh [format {{"op":"size_cell","instance":"%s","fromMaster":"%s","toMaster":"%s"}} $instance $before $toMaster]
    close $fh
    return MUTATED
}
proc atcs_dump_cells {target} {
    set fh [open $target w]
    puts $fh "$::instance $::master"
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
