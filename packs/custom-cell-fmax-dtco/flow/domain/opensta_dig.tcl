# Replaceable local timing view for a hash-bound DIG export/LocalWindow.
# Caller defines HIMA_STA_LIBERTIES (Tcl list), HIMA_STA_NETLIST,
# HIMA_STA_TOP, HIMA_STA_SDC, HIMA_STA_SPEF and HIMA_STA_OUT.

foreach _name {HIMA_STA_LIBERTIES HIMA_STA_NETLIST HIMA_STA_TOP HIMA_STA_SDC HIMA_STA_SPEF HIMA_STA_OUT} {
  if {![info exists ::$_name] || [set ::$_name] eq ""} {
    error "missing OpenSTA DIG setting $_name"
  }
}
foreach _lib $HIMA_STA_LIBERTIES { read_liberty $_lib }
read_verilog $HIMA_STA_NETLIST
link_design $HIMA_STA_TOP
read_sdc $HIMA_STA_SDC
read_spef $HIMA_STA_SPEF

set _paths [find_timing_paths -path_delay max -group_path_count 2000 \
  -endpoint_path_count 20 -slack_max 0.100 -sort_by_slack \
  -unique_paths_to_endpoint]
set _fp [open $HIMA_STA_OUT w]
puts $_fp "schema\thima.opensta-dig-paths/1"
puts $_fp "top\t$HIMA_STA_TOP"
puts $_fp "instance_count\t[sta::network_leaf_instance_count]"
puts $_fp "net_count\t[sta::network_net_count]"
puts $_fp "pin_count\t[sta::network_leaf_pin_count]"
puts $_fp "path_count\t[llength $_paths]"
set _rank 0
foreach _path $_paths {
  incr _rank
  set _start [get_property [get_property $_path startpoint] full_name]
  set _end [get_property [get_property $_path endpoint] full_name]
  set _slack [get_property $_path slack]
  set _points [get_property $_path points]
  puts $_fp [join [list path $_rank $_start $_end $_slack [llength $_points]] "\t"]
  set _ordinal 0
  foreach _point $_points {
    set _pin [get_property [get_property $_point pin] full_name]
    set _arrival [get_property $_point arrival]
    if {[catch {get_property $_point slew} _slew]} { set _slew "" }
    if {[catch {get_property $_point load} _load]} { set _load "" }
    puts $_fp [join [list point $_rank $_ordinal $_pin $_arrival $_slew $_load] "\t"]
    incr _ordinal
  }
}
close $_fp
puts "=== HIMA OPENSTA DIG DONE [llength $_paths] $HIMA_STA_OUT ==="
exit
