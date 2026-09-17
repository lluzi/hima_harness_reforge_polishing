# Read-only, hash-bound source export for DIG construction.
#
# Required environment:
#   HIMA_DIG_DB      Innovus checkpoint base or .dat restore path
#   HIMA_DIG_TOP     design top
#   HIMA_DIG_PHASE   place | postroute
#   HIMA_DIG_OUT     new/empty export directory
#
# The script restores one checkpoint and issues no placement, optimization,
# CTS, routing or ECO command.  Hashing and manifest publication happen in the
# Pack Python adapter after Innovus exits successfully.

foreach _name {HIMA_DIG_DB HIMA_DIG_TOP HIMA_DIG_PHASE HIMA_DIG_OUT} {
  if {![info exists ::env($_name)] || $::env($_name) eq ""} {
    error "missing required environment $_name"
  }
}
set _phase $::env(HIMA_DIG_PHASE)
if {$_phase ne "place" && $_phase ne "postroute"} {
  error "HIMA_DIG_PHASE must be place or postroute"
}
set _out [file normalize $::env(HIMA_DIG_OUT)]
file mkdir $_out
restoreDesign $::env(HIMA_DIG_DB) $::env(HIMA_DIG_TOP)

saveNetlist [file join $_out design.v]
defOut [file join $_out design.def]
write_sdc [file join $_out constraints.sdc]

# rcOut reads the active extracted/pre-route RC state.  It must not trigger a
# fresh extraction because that would mutate the observed checkpoint state.
set _spef_status ok
if {[catch {rcOut -spef [file join $_out parasitics.spef]} _spef_error]} {
  set _spef_status unavailable
  set _fp [open [file join $_out parasitics.unavailable.txt] w]
  puts $_fp $_spef_error
  close $_fp
}

set _fp [open [file join $_out census.tsv] w]
puts $_fp "kind\tname\tmaster\tx\ty\tplace_status"
foreach _inst [lsort [dbGet top.insts.name]] {
  set _ptr [dbGet -p1 top.insts.name $_inst]
  set _master [dbGet $_ptr.cell.name]
  set _pt [dbGet $_ptr.pt]
  set _status [dbGet $_ptr.pStatus]
  puts $_fp [join [list instance $_inst $_master [lindex $_pt 0] [lindex $_pt 1] $_status] "\t"]
}
close $_fp

set _fp [open [file join $_out checkpoint-facts.tsv] w]
puts $_fp [join [list phase $_phase] "\t"]
puts $_fp [join [list top $::env(HIMA_DIG_TOP)] "\t"]
puts $_fp [join [list database $::env(HIMA_DIG_DB)] "\t"]
puts $_fp [join [list instance_count [llength [dbGet top.insts.name]]] "\t"]
puts $_fp [join [list net_count [llength [dbGet top.nets.name]]] "\t"]
puts $_fp [join [list dbu_per_micron [dbGet head.dbUnits]] "\t"]
puts $_fp [join [list spef_status $_spef_status] "\t"]
close $_fp

set _fp [open [file join $_out tool-version.txt] w]
puts $_fp [getVersion]
close $_fp
puts "=== HIMA DIG EXPORT DONE $_phase $_out ==="
exit
