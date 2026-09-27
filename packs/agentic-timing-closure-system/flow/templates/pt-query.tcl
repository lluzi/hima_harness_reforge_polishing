########################################################################
# pt-query.tcl -- targeted re-observation of one already-opened PT session's
# checks (M1 `compare_checks`'s optional `recheck`, and residual-evidence
# gathering: cellDelay/netDelay/slew/fanout for a bounded list of check
# keys). Every value below comes from atcs.adapters.compile_pt_query_task's
# preamble; this template never hard-codes a Site/Foundation path.
#
# Required env vars: DESIGN NETLIST INPUT_SDC SPEF REPORT_ROOT
# Optional env vars (C4, final review): LIB_GLOB, and DRIVER_LIBRARY +
# ORIGINAL_DRIVER_LIBRARY together -- without them `link_design` has no cell
# library to resolve references against at all; they are optional here only
# so a caller that genuinely has none to offer (a compile-level unit test)
# still renders. PBA_MODE (final fix batch C, N4) -- "1" runs PBA (path mode,
# the same worst-path-only scope pt-scenario.tcl's own PBA_MODE uses), any
# other value or absence runs GBA; optional for the same reason.
# Required Tcl global: ::ATCS_QUERY_TARGETS -- a list of
#   {startpoint endpoint mode reportName} quadruples, one per targeted check.
#   `mode` is `setup` or `hold` (final fix batch C, N4): every targeted check
#   this template queries is one specific mode's own check -- a setup check
#   queried with PT's default `-delay_type max` is correct, but a HOLD
#   check queried the same way would silently report the wrong (max/setup)
#   delay arc's slack instead of its own min/hold one. `mode` decides
#   `-delay_type` per target below, never a single value shared by every
#   target in the list.
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
if {[info exists env(LIB_GLOB)]} {
    set lib_files [lsort [glob -nocomplain $env(LIB_GLOB)]]
    if {[llength $lib_files] == 0} { error "no PT libraries matched $env(LIB_GLOB)" }
    set_app_var target_library $lib_files
    set_app_var link_path [concat "*" $lib_files]
}
read_verilog $env(NETLIST)
current_design $design
if {![link_design $design]} { error "link_design failed" }
if {[info exists env(DRIVER_LIBRARY)] && [info exists env(ORIGINAL_DRIVER_LIBRARY)]} {
    set fh [open $env(INPUT_SDC) r]
    set sdc_text [read $fh]
    close $fh
    set replacements [regsub -all -- $env(ORIGINAL_DRIVER_LIBRARY) $sdc_text $env(DRIVER_LIBRARY) normalized]
    if {$replacements == 0} { error "expected driving-cell library reference was not found" }
    set normalized_sdc $env(REPORT_ROOT)/query.normalized.sdc
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
# N4 (final fix batch C): same knob, same default-"none"/GBA rule as
# pt-scenario.tcl's own `pba_mode_arg` (report_timing(2)/report_global_timing(2),
# PT X-2025.06 man page, read-only verified: "-pba_mode none|path|exhaustive|
# ml_exhaustive", default "none") -- optional here (unlike pt-scenario.tcl's
# required PBA_MODE) so a caller with no precision to offer at all (a
# compile-level unit test) still renders.
set pba_mode_arg none
if {[info exists env(PBA_MODE)] && $env(PBA_MODE) == 1} { set pba_mode_arg path }
foreach target $::ATCS_QUERY_TARGETS {
    set startpoint [lindex $target 0]
    set endpoint [lindex $target 1]
    set mode [lindex $target 2]
    set report_name [lindex $target 3]
    # N4 (final fix batch C): `-delay_type max` for a setup check, `min` for a
    # hold check -- PT's own default (`max`) would silently report a HOLD
    # check's setup-side slack instead of its own min/hold one. Every target
    # in ::ATCS_QUERY_TARGETS carries its own `mode` (never shared across the
    # whole query) precisely so this never mixes up two targets on the same
    # PT session that happen to query different modes.
    if {$mode eq "setup"} {
        set delay_type max
    } elseif {$mode eq "hold"} {
        set delay_type min
    } else {
        error "target for report $report_name has unknown mode: $mode (expected setup or hold)"
    }
    redirect $env(REPORT_ROOT)/$report_name.rpt {
        # -significant_digits 4 (same knob, same default-2 rule as report_timing(2)/
        # report_global_timing(2), PT X-2025.06 man page, read-only verified -- see
        # pt-scenario.tcl's own comment) -- a genuinely fixed or still-violating
        # targeted check must not display as a bare "0.00"/"-0.00" that
        # atcs.adapters.parse_query_slack could misread; PT's own MET/VIOLATED
        # verdict plus its "increase significant digits" annotation remain the
        # actual fail-closed backstop either way.
        report_timing -from $startpoint -to $endpoint -delay_type $delay_type \
            -path_type full_clock_expanded \
            -input_pins -nets -transition_time -capacitance -max_paths 1 \
            -significant_digits 4 -pba_mode $pba_mode_arg
    }
}
exit
