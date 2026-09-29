# The XTop Operator for the ATCS dry path (Issue #64 Track B): no XTop, timing or QoR claim.
# argv: <Campaign workspace> <slot> -- the qualified wrapper's own call shape.
#
# Where the Site's wrapper would start XTop on the slot's regenerated session Tcl, this starts
# `tclsh` on the very Tcl `prepare-workers` rendered into the slot's latest prepared revision
# (workspaces/<slot>/r<N>/xtop-analysis-manual.tcl, which sources that revision's operator.tcl and
# its typed atcs_* toolkit), over the in-memory XTop of xtop-standin.tcl. Everything the session
# prints to stdout is also written to xtop_log_1.txt in the slot root, as XTop's own transcript is,
# so `atcs_close`'s ATCS:taint line reaches the capture. Commands then arrive one Tcl-line adapter
# frame at a time; the adapter's close frame ends with `exit`.
set workspace [lindex $argv 0]
set slot [lindex $argv 1]
set root [lindex [lsort -dictionary [glob -directory [file join $workspace workspaces $slot] -type d r*]] end]
set ::dry_transcript [file join $root xtop_log_1.txt]
rename puts ::dry_puts
proc puts {args} {
    set words $args
    set newline 1
    if {[lindex $words 0] eq "-nonewline"} { set newline 0; set words [lrange $words 1 end] }
    if {[llength $words] == 1 || [lindex $words 0] eq "stdout"} {
        set fh [open $::dry_transcript a]
        if {$newline} { ::dry_puts $fh [lindex $words end] } else { ::dry_puts -nonewline $fh [lindex $words end] }
        close $fh
    }
    uplevel 1 [linsert $args 0 ::dry_puts]
}
source [file join [file dirname [file normalize [info script]]] xtop-standin.tcl]
source [file join $root xtop-analysis-manual.tcl]
flush stdout
set script ""
while {[gets stdin line] >= 0} {
    append script $line "\n"
    if {![info complete $script]} { continue }
    if {[catch {uplevel #0 $script} message]} { puts stderr "FIXTURE-EVAL-ERROR:$message" }
    flush stdout
    flush stderr
    set script ""
}
