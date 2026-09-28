########################################################################
# innovus-eco-pair.tcl -- implement a recipe batch's one Innovus ECO pair
# (Issue #64 Task 6): restore the batch's base database, `source` the chosen
# arm's `write_design_changes -keep_route` netlist file, then its physical
# file, route the ECO and export the implemented DB/DEF/netlist/physical
# evidence. The apply sequence is the frozen serial flow's qualified one
# (`packs/xtop-timing-closure/flow/templates/apply-eco.tcl`); the restore and
# export are this Pack's own (`innovus-eco.tcl`). `NETLIST_ECO`/`PHYSICAL_ECO`
# are the copies `implement` made under OUTPUT_ROOT/eco/ after checking each
# against the sha256 the merge commit sealed.
#
# Required env vars: CURRENT_DB DESIGN NETLIST_ECO PHYSICAL_ECO OUTPUT_ROOT
########################################################################
foreach required {CURRENT_DB DESIGN NETLIST_ECO PHYSICAL_ECO OUTPUT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
foreach file [list $env(NETLIST_ECO) $env(PHYSICAL_ECO)] {
    if {![file readable $file]} { error "ECO file is not readable: $file" }
}
restoreDesign $env(CURRENT_DB).dat $env(DESIGN)
source $env(NETLIST_ECO)
source $env(PHYSICAL_ECO)
setNanoRouteMode -routeWithEco true -routeWithTimingDriven false -routeWithSiDriven false -drouteUseMultiCutViaEffort high
ecoRoute
file mkdir $env(OUTPUT_ROOT)/RPT
file mkdir $env(OUTPUT_ROOT)/EXPORT
file mkdir $env(OUTPUT_ROOT)/DBS
verify_drc -limit 1000000 -report $env(OUTPUT_ROOT)/RPT/verify_drc.rpt
verifyConnectivity -noAntenna -error 1000000 -report $env(OUTPUT_ROOT)/RPT/verify_connectivity.rpt
saveDesign $env(OUTPUT_ROOT)/DBS/$env(DESIGN).enc -compress
defOut -floorplan -placement -netlist -routing -withShield -usedVia $env(OUTPUT_ROOT)/EXPORT/design.def
saveNetlist $env(OUTPUT_ROOT)/EXPORT/design.v
exit 0
