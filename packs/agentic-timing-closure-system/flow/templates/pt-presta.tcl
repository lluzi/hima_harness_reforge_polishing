########################################################################
# pt-presta.tcl -- cheap PT pre-check ("presta") over a not-yet-implemented
# candidate netlist, using the BASE state's own SPEF (no fresh StarRC
# extraction has run yet). The predicted WNS this produces is only ever
# trusted for nets `atcs.verification.presta_qualification` finds present
# in that SPEF's own net list (knowledge/cheap-verification.md) -- this
# template does not claim anything stronger.
#
# Required env vars: DESIGN NETLIST INPUT_SDC SPEF SCENARIO REPORT_ROOT
# Optional env vars (C4, final review): LIB_GLOB, and DRIVER_LIBRARY +
# ORIGINAL_DRIVER_LIBRARY together -- without them `link_design` has no
# cell library to resolve references against at all and will fail for any
# real (non-fixture) netlist; they are optional here only so a caller that
# genuinely has none to offer (a compile-level unit test) still renders.
########################################################################
foreach required {DESIGN NETLIST INPUT_SDC SPEF SCENARIO REPORT_ROOT} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set scenario $env(SCENARIO)
set report_dir $env(REPORT_ROOT)/$scenario
file mkdir $report_dir
foreach file [list $env(NETLIST) $env(INPUT_SDC) $env(SPEF)] {
    if {![file readable $file]} { error "required PrimeTime input is not readable: $file" }
}
set_app_var sh_continue_on_error false
if {[info exists env(LIB_GLOB)]} {
    set lib_files [lsort [glob -nocomplain $env(LIB_GLOB)]]
    if {[llength $lib_files] == 0} { error "no PT libraries matched $env(LIB_GLOB)" }
    set_app_var target_library $lib_files
    set_app_var link_path [concat "*" $lib_files]
}
set_host_options -max_cores 8
read_verilog $env(NETLIST)
current_design $design
if {![link_design $design]} { error "link_design failed for presta" }
if {[info exists env(DRIVER_LIBRARY)] && [info exists env(ORIGINAL_DRIVER_LIBRARY)]} {
    set fh [open $env(INPUT_SDC) r]
    set sdc_text [read $fh]
    close $fh
    set replacements [regsub -all -- $env(ORIGINAL_DRIVER_LIBRARY) $sdc_text $env(DRIVER_LIBRARY) normalized]
    if {$replacements == 0} { error "expected driving-cell library reference was not found" }
    set normalized_sdc $report_dir/$scenario.normalized.sdc
    set fh [open $normalized_sdc w]
    puts -nonewline $fh $normalized
    close $fh
    read_sdc $normalized_sdc
} else {
    read_sdc $env(INPUT_SDC)
}
if {[sizeof_collection [all_clocks]] == 0} { error "no clocks were created" }
read_parasitics -format spef $env(SPEF)
set_propagated_clock [all_clocks]
update_timing -full
redirect $report_dir/global_timing.rpt { report_global_timing -significant_digits 4 }
exit
