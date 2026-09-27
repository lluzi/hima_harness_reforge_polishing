########################################################################
# innovus-export.tcl -- restore a database (no ECO) and export its DEF,
# netlist and physical (DRC/connectivity) evidence. Used for the campaign
# baseline's own physical reports (`atcs.verification.assemble`'s
# `baseline_physical` argument) and any other plain, non-ECO export.
#
# Final review (fix batch C, G29): `CURRENT_DB` is this Pack's own database
# identity convention -- the `.enc` restore-script PATH (`design-state.
# database.path`), never the directory `restoreDesign` itself actually
# reads. Foundation evidence (read-only, `DBS/xtop_round2_eco_route.enc`):
# every real Foundation restore script itself calls
# `restoreDesign <path>.enc.dat <topCell>` -- the `.enc.dat` SIBLING
# directory, plus the top cell. `$env(CURRENT_DB).dat` is exactly that
# sibling (matches `atcs.state.design_state`'s own `f"{path}.dat"`
# convention for `datDigest`).
#
# Required env vars: CURRENT_DB DESIGN OUTPUT_ROOT
########################################################################
foreach required {CURRENT_DB DESIGN OUTPUT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
restoreDesign $env(CURRENT_DB).dat $env(DESIGN)
file mkdir $env(OUTPUT_ROOT)/RPT
file mkdir $env(OUTPUT_ROOT)/EXPORT
defOut -floorplan -placement -netlist -routing -withShield -usedVia $env(OUTPUT_ROOT)/EXPORT/design.def
saveNetlist $env(OUTPUT_ROOT)/EXPORT/design.v
verify_drc -limit 1000000 -report $env(OUTPUT_ROOT)/RPT/verify_drc.rpt
verifyConnectivity -noAntenna -error 1000000 -report $env(OUTPUT_ROOT)/RPT/verify_connectivity.rpt
exit 0
