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
defOut -floorplan -placement -netlist -routing -withShield -usedVia $env(EXPORT_ROOT)/design.def
saveNetlist $env(EXPORT_ROOT)/design.v
exit 0

