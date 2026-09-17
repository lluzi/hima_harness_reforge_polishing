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

proc _hima_dig_setting {_name} {
  if {[info exists ::env($_name)] && $::env($_name) ne ""} {
    return $::env($_name)
  }
  if {[info exists ::$_name] && [set ::$_name] ne ""} {
    return [set ::$_name]
  }
  error "missing required setting $_name"
}
set _db [_hima_dig_setting HIMA_DIG_DB]
set _top [_hima_dig_setting HIMA_DIG_TOP]
set _phase [_hima_dig_setting HIMA_DIG_PHASE]
set _out [file normalize [_hima_dig_setting HIMA_DIG_OUT]]
if {$_phase ne "place" && $_phase ne "postroute"} {
  error "HIMA_DIG_PHASE must be place or postroute"
}
file mkdir $_out
restoreDesign $_db $_top

saveNetlist [file join $_out design.v]
if {$_phase eq "postroute"} {
  defOut -netlist -routing [file join $_out design.def]
} else {
  defOut -netlist [file join $_out design.def]
}
write_sdc [file join $_out constraints.sdc]

# A restored Innovus checkpoint does not retain an rcOut-ready in-memory RC
# graph.  Recompute RC from the restored geometry in this disposable process;
# no database is saved, and no physical or logical optimization is issued.
set _spef_status ok
set _views [all_analysis_views]
set _view [lindex $_views 0]
if {$_phase eq "postroute"} {
  setExtractRCMode -engine postRoute -effortLevel medium
} else {
  setExtractRCMode -engine preRoute
}
if {[catch {
  extractRC
  rcOut -spef [file join $_out parasitics.spef] -view $_view
} _spef_error]} {
  set _spef_status unavailable
  set _fp [open [file join $_out parasitics.unavailable.txt] w]
  puts $_fp $_spef_error
  close $_fp
}

# Enumerate near-critical internal setup alternatives.  Completeness is not
# inferred here: the Python parser checks both the global limit and per-endpoint
# nworst saturation before it may publish a bounded-complete timing view.
report_timing -late -skip_io_paths -max_paths 100000 -nworst 100 \
  -max_slack 0.100 -net -view $_view > [file join $_out timing-alternatives.rpt]
report_timing -late -skip_io_paths -begin_end_pair -max_slack 0.100 \
  -net -view $_view > [file join $_out timing-begin-end-pairs.rpt]

# V5 endpoint-complete state.  Enumerate every register data pin first, then
# request one worst setup path for each identity.  This is intentionally not a
# Top-N report.  It proves current endpoint coverage while keeping the separate
# statement that path alternatives are incomplete.
set _endpoint_index [file join $_out setup-endpoints.tsv]
set _endpoint_report [file join $_out endpoint-worst-setup.rpt]
set _fp [open $_endpoint_index w]
puts $_fp "# endpoint"
set _setup_endpoints [lsort [get_object_name [all_registers -data_pins]]]
foreach _endpoint $_setup_endpoints {
  puts $_fp $_endpoint
}
close $_fp
file delete -force $_endpoint_report
foreach _endpoint $_setup_endpoints {
  set _pin [get_pins $_endpoint]
  report_timing -late -to $_pin -max_paths 1 -nworst 1 -net -view $_view >> $_endpoint_report
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
puts $_fp [join [list top $_top] "\t"]
puts $_fp [join [list database $_db] "\t"]
puts $_fp [join [list instance_count [llength [dbGet top.insts.name]]] "\t"]
puts $_fp [join [list net_count [llength [dbGet top.nets.name]]] "\t"]
puts $_fp [join [list dbu_per_micron [dbGet head.dbUnits]] "\t"]
puts $_fp [join [list spef_status $_spef_status] "\t"]
puts $_fp [join [list analysis_view $_view] "\t"]
puts $_fp [join [list timing_max_paths 100000] "\t"]
puts $_fp [join [list timing_nworst 100] "\t"]
puts $_fp [join [list timing_max_slack_ns 0.100] "\t"]
puts $_fp [join [list setup_endpoint_count [llength $_setup_endpoints]] "\t"]
close $_fp

set _fp [open [file join $_out tool-version.txt] w]
puts $_fp [getVersion]
close $_fp
puts "=== HIMA DIG EXPORT DONE $_phase $_out ==="
exit
