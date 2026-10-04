# S0 — Fusion Upside Bound. Dump every real fusion site in the frozen golden, with the wire
# capacitance fusion would remove and the slack that says whether removing it could ever matter.
#
# Why wire cap is the whole story: scripts/compose_netlist.py wires cell1's output into cell2's input
# through internal net XI and emits both device sets unchanged -- no stack merging, no eliminated
# buffer stage, and the internal node still swings full rail. So a fused cell is the same transistor
# chain minus one wire. The wire is the entire prize.
#
# A site qualifies only if the driver's output net has EXACTLY ONE load: with a second load, fusing
# would have to duplicate cell1 or keep the net anyway, so the wire does not disappear.
#
# Emits parseable FUSION_SITE records + report_net blocks to stdout; detect/fusion_upside_score.py
# converts wire cap to nanoseconds through the foundry liberty. Runs on 6_final (real routed SPEF).

set F /foss/designs/celluzi/OpenROAD-flow-scripts/flow
set B $F/results/sky130hd/aes/base
read_liberty $F/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib
read_db $B/6_final.odb
read_sdc $B/6_final.sdc
read_spef $B/6_final.spef

# (cell1_base, cell1_out, cell2_base, cell2_in) from generate/model_specs/*.json. Drive strength is
# deliberately NOT pinned: a fusion OPPORTUNITY exists wherever the topology matches, at any drive.
# The score step reports the drive distribution, because we can only BUILD _1 (the foundry ladder is
# m=, unbuildable in lclayout's single row) -- so a site whose driver is _4 would be a DOWNGRADE.
set PAIRS {
  {xor2  X nand2 A}
  {xor2  X nor2  A}
  {xnor2 Y nand2 A}
  {xnor2 Y xnor3 A}
  {xnor3 X xnor3 A}
  {xnor3 X mux2i A0}
  {mux2i Y xor2  A}
  {mux2i Y xnor2 A}
}

proc base_of {master} {
  # sky130_fd_sc_hd__xor2_1 -> xor2 ; also yields the drive suffix
  if {[regexp {__([a-z0-9]+)_(\d+)$} $master -> base drive]} { return [list $base $drive] }
  return [list "" ""]
}

set block [ord::get_db_block]
set nsite 0
foreach inst [$block getInsts] {
  set master [[$inst getMaster] getName]
  lassign [base_of $master] c1base c1drive
  if {$c1base eq ""} { continue }

  foreach pair $PAIRS {
    lassign $pair p1 p1out p2 p2in
    if {$c1base ne $p1} { continue }

    foreach it [$inst getITerms] {
      if {[$it getIoType] ne "OUTPUT"} { continue }
      if {[[$it getMTerm] getName] ne $p1out} { continue }
      set net [$it getNet]
      if {$net eq "NULL"} { continue }

      # exactly one load, and it must be the target cell's fusion input pin
      set loads {}
      foreach lit [$net getITerms] {
        if {[$lit getIoType] eq "INPUT"} { lappend loads $lit }
      }
      if {[llength $loads] != 1} { continue }
      set lit [lindex $loads 0]
      set linst [$lit getInst]
      lassign [base_of [[$linst getMaster] getName]] c2base c2drive
      if {$c2base ne $p2} { continue }
      if {[[$lit getMTerm] getName] ne $p2in} { continue }

      # slack at the driver output decides whether this site is on a path that matters
      set dpin [$inst getName]/$p1out
      set slack "NA"
      catch { set slack [get_property [get_pins $dpin] slack_max] }

      puts "FUSION_SITE spec=${p1}__${p2} c1=[$inst getName] c1_master=$master c1_drive=$c1drive\
 c2=[$linst getName] c2_master=[[$linst getMaster] getName] c2_drive=$c2drive c2_pin=$p2in\
 net=[$net getName] slack=$slack"
      report_net -digits 6 [$net getName]
      puts "END_SITE"
      incr nsite
    }
  }
}
puts "TOTAL_FUSION_SITES $nsite"
