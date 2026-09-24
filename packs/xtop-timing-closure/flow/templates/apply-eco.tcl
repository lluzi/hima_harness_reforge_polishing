foreach required {WORK_ROOT CURRENT_DB DESIGN ECO_DIR OUTPUT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
cd $env(WORK_ROOT)
source FF/vars.tcl
set vars(ff_exe_dir) $env(WORK_ROOT)
set vars(rundir) $env(WORK_ROOT)
foreach file $vars(config_files) { source $file }
source FF/procs.tcl
restoreDesign $env(CURRENT_DB) $env(DESIGN)
set netlist_eco_files [lsort [glob -nocomplain $env(ECO_DIR)/xtop_opt_innovus_netlist_*.txt]]
set physical_eco_files [lsort [glob -nocomplain $env(ECO_DIR)/xtop_opt_innovus_physical_*.txt]]
if {[llength $netlist_eco_files] != 1 || [llength $physical_eco_files] != 1} {
    error "expected exactly one XTop netlist ECO and one physical ECO"
}
source [lindex $netlist_eco_files 0]
source [lindex $physical_eco_files 0]
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
