########################################################################
# innovus-eco.tcl -- restore the batch's base database, source the sealed
# MergeCommit's own `innovusEcoTcl` (already-compiled, documented
# ecoChangeCell/ecoAddRepeater/ecoDeleteRepeater text -- see
# `atcs.integration.innovus_eco_tcl`, never re-derived here), route the ECO
# and export the implemented DB/DEF/netlist/physical evidence.
#
# Required env vars: CURRENT_DB DESIGN ECO_TCL OUTPUT_ROOT
########################################################################
foreach required {CURRENT_DB DESIGN ECO_TCL OUTPUT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
if {![file readable $env(ECO_TCL)]} { error "ECO_TCL is not readable: $env(ECO_TCL)" }
restoreDesign $env(CURRENT_DB) $env(DESIGN)
source $env(ECO_TCL)
setNanoRouteMode -routeWithEco true -routeWithTimingDriven false -routeWithSiDriven false \
    -drouteUseMultiCutViaEffort high
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
