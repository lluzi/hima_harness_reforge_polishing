if {![info exists env(WORK_ROOT)] || ![info exists env(CURRENT_DB)] || ![info exists env(DESIGN)] || ![info exists env(EXPORT_ROOT)]} {
    error "WORK_ROOT, CURRENT_DB, DESIGN and EXPORT_ROOT are required"
}
cd $env(WORK_ROOT)
source FF/vars.tcl
set vars(ff_exe_dir) $env(WORK_ROOT)
set vars(rundir) $env(WORK_ROOT)
foreach file $vars(config_files) { source $file }
source FF/procs.tcl
restoreDesign $env(CURRENT_DB) $env(DESIGN)
file mkdir $env(EXPORT_ROOT)
file mkdir $env(EXPORT_ROOT)/RPT
defOut -floorplan -placement -netlist -routing -withShield -usedVia $env(EXPORT_ROOT)/design.def
saveNetlist $env(EXPORT_ROOT)/design.v
verify_drc -limit 1000000 -report $env(EXPORT_ROOT)/RPT/verify_drc.rpt
verifyConnectivity -noAntenna -report $env(EXPORT_ROOT)/RPT/verify_connectivity.rpt
set physical [open $env(EXPORT_ROOT)/RPT/physical-check.json w]
puts $physical {{"schema":"xtop-timing-closure-physical-check/1","coverage":"unknown","drcLimit":1000000,"drcReport":"verify_drc.rpt","connectivityReport":"verify_connectivity.rpt"}}
close $physical
exit 0
