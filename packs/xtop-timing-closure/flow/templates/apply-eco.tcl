foreach required {WORK_ROOT CURRENT_DB DESIGN NETLIST_ECO PHYSICAL_ECO OUTPUT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
cd $env(WORK_ROOT)
source FF/vars.tcl
set vars(ff_exe_dir) $env(WORK_ROOT)
set vars(rundir) $env(WORK_ROOT)
foreach file $vars(config_files) { source $file }
source FF/procs.tcl
restoreDesign $env(CURRENT_DB) $env(DESIGN)
source $env(NETLIST_ECO)
source $env(PHYSICAL_ECO)
setNanoRouteMode -routeWithEco true -routeWithTimingDriven false -routeWithSiDriven false -drouteUseMultiCutViaEffort high
ecoRoute
file mkdir $env(OUTPUT_ROOT)/RPT
file mkdir $env(OUTPUT_ROOT)/EXPORT
file mkdir $env(OUTPUT_ROOT)/DBS
verify_drc -limit 1000000 -report $env(OUTPUT_ROOT)/RPT/verify_drc.rpt
verifyConnectivity -noAntenna -error 1000000 -report $env(OUTPUT_ROOT)/RPT/verify_connectivity.rpt
set physical [open $env(OUTPUT_ROOT)/RPT/physical-check.json w]
puts $physical {{"schema":"xtop-timing-closure-physical-check/2","coverage":"complete","drcLimit":1000000,"connectivityLimit":1000000,"drcReport":"verify_drc.rpt","connectivityReport":"verify_connectivity.rpt"}}
close $physical
saveDesign $env(OUTPUT_ROOT)/DBS/closed.enc -compress
defOut -floorplan -placement -netlist -routing -withShield -usedVia $env(OUTPUT_ROOT)/EXPORT/design.def
saveNetlist $env(OUTPUT_ROOT)/EXPORT/design.v
exit 0
