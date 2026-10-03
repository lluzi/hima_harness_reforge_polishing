set state [dict create]
set done 0

# Reviewed-scope fixture: every mutation carries the Host plan hash as its last typed argument.
proc size_cell {instance master planSha256} {
  dict set ::state $instance $master
  return "SIZED $instance=$master"
}

proc insert_buffer {net cell planSha256} {
  dict set ::state $net $cell
  return "INSERTED $net=$cell"
}

proc set_value {key value planSha256} {
  dict set ::state $key $value
  return "SET $key=$value"
}

proc get_value {key} {
  if {![dict exists $::state $key]} { return "VALUE $key=" }
  return "VALUE $key=[dict get $::state $key]"
}

proc save_state {file} {
  set channel [open $file w]
  puts $channel $::state
  close $channel
  return "SAVED $file"
}

proc close_session {} {
  set ::done 1
  return CLOSED
}

puts "HIMA:hima-tcl-line-v1:1:READY"
flush stdout
set script ""
while {!$done && [gets stdin line] >= 0} {
  append script $line "\n"
  if {![info complete $script]} { continue }
  if {[catch {uplevel #0 $script} message]} {
    puts stderr "FIXTURE-EVAL-ERROR:$message"
  }
  flush stdout
  flush stderr
  set script ""
}
