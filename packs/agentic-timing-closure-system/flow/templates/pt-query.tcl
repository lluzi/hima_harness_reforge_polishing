########################################################################
# pt-query.tcl -- targeted re-observation of one already-opened PT session's
# checks (M1 `compare_checks`'s optional `recheck`, and residual-evidence
# gathering: cellDelay/netDelay/slew/fanout for a bounded list of check
# keys). Every value below comes from atcs.adapters.compile_pt_query_task's
# preamble; this template never hard-codes a Site/Foundation path.
#
# Required env vars: DESIGN NETLIST INPUT_SDC SPEF REPORT_ROOT
# Required Tcl global: ::ATCS_QUERY_TARGETS -- a list of
#   {startpoint endpoint reportName} triples, one per targeted check.
########################################################################
foreach required {DESIGN NETLIST INPUT_SDC SPEF REPORT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
if {![info exists ::ATCS_QUERY_TARGETS] || [llength $::ATCS_QUERY_TARGETS] == 0} {
    error "ATCS_QUERY_TARGETS must name at least one targeted check"
}
set design $env(DESIGN)
file mkdir $env(REPORT_ROOT)
foreach file [list $env(NETLIST) $env(INPUT_SDC) $env(SPEF)] {
    if {![file readable $file]} { error "required PrimeTime input is not readable: $file" }
}
set_app_var sh_continue_on_error false
read_verilog $env(NETLIST)
current_design $design
if {![link_design $design]} { error "link_design failed" }
read_sdc $env(INPUT_SDC)
if {[sizeof_collection [all_clocks]] == 0} { error "no clocks were created" }
read_parasitics -format spef $env(SPEF)
set_propagated_clock [all_clocks]
update_timing -full
foreach target $::ATCS_QUERY_TARGETS {
    set startpoint [lindex $target 0]
    set endpoint [lindex $target 1]
    set report_name [lindex $target 2]
    redirect $env(REPORT_ROOT)/$report_name.rpt {
        report_timing -from $startpoint -to $endpoint -path_type full_clock_expanded \
            -input_pins -nets -transition_time -capacitance -max_paths 1
    }
}
exit
