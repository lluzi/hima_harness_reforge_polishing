########################################################################
# pt-presta.tcl -- cheap PT pre-check ("presta") over a not-yet-implemented
# candidate netlist, using the BASE state's own SPEF (no fresh StarRC
# extraction has run yet). The predicted WNS this produces is only ever
# trusted for nets `atcs.verification.presta_qualification` finds present
# in that SPEF's own net list (knowledge/cheap-verification.md) -- this
# template does not claim anything stronger.
#
# Required env vars: DESIGN NETLIST INPUT_SDC SPEF SCENARIO REPORT_ROOT
########################################################################
foreach required {DESIGN NETLIST INPUT_SDC SPEF SCENARIO REPORT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set report_dir $env(REPORT_ROOT)/$env(SCENARIO)
file mkdir $report_dir
foreach file [list $env(NETLIST) $env(INPUT_SDC) $env(SPEF)] {
    if {![file readable $file]} { error "required PrimeTime input is not readable: $file" }
}
set_app_var sh_continue_on_error false
read_verilog $env(NETLIST)
current_design $design
if {![link_design $design]} { error "link_design failed for presta" }
read_sdc $env(INPUT_SDC)
if {[sizeof_collection [all_clocks]] == 0} { error "no clocks were created" }
read_parasitics -format spef $env(SPEF)
set_propagated_clock [all_clocks]
update_timing -full
redirect $report_dir/global_timing.rpt { report_global_timing }
exit
