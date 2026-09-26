########################################################################
# pt-scenario.tcl -- one PrimeTime scenario refresh (M1 observation-set
# evidence). Every value below is baked in as an env var by
# atcs.adapters.compile_pt_scenario_task's preamble (never a Site/Foundation
# path hard-coded here); this template only reads $env(...).
#
# Required env vars: DESIGN NETLIST INPUT_SDC SPEF SCENARIO REPORT_ROOT
#                     MAX_PATHS NWORST PBA_MODE
# Optional env vars: STA_DATA LIB_GLOB DRIVER_LIBRARY ORIGINAL_DRIVER_LIBRARY
########################################################################
foreach required {DESIGN NETLIST INPUT_SDC SPEF SCENARIO REPORT_ROOT MAX_PATHS NWORST PBA_MODE} {
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
read_verilog $env(NETLIST)
current_design $design
if {![link_design $design]} { error "link_design failed for $scenario" }
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
redirect $report_dir/check_timing.rpt { check_timing -verbose }
redirect $report_dir/global_timing.rpt { report_global_timing }
# -significant_digits 4 (default is 2, per PT's own man page --
# report_timing(2), "-significant_digits digits ... the default is
# determined by the report_default_significant_digits variable, which is 2
# by default") widens the displayed precision so a genuinely violating but
# tiny slack does not round to a bare "-0.00" that reads as clean; PT still
# marks such a row "(VIOLATED: increase significant digits)" whenever its
# own internal, full-precision value would otherwise display as zero at
# the requested digit count, so atcs.reports.parse_path_report's own
# VIOLATED-classification fact (never the displayed number alone) remains
# this Pack's actual source of truth either way.
redirect $report_dir/setup.rpt {
    report_timing -delay_type max -path_type full_clock_expanded \
        -max_paths $env(MAX_PATHS) -nworst $env(NWORST) -slack_lesser_than 0.0 \
        -input_pins -nets -transition_time -capacitance -significant_digits 4
}
redirect $report_dir/hold.rpt {
    report_timing -delay_type min -path_type full_clock_expanded \
        -max_paths $env(MAX_PATHS) -nworst $env(NWORST) -slack_lesser_than 0.0 \
        -input_pins -nets -transition_time -capacitance -significant_digits 4
}
if {$env(PBA_MODE) == 1 && [info exists env(STA_DATA)]} {
    file mkdir $env(STA_DATA)
    if {[info exists env(ICEXPLORER_XTOP_HOME)]} {
        source $env(ICEXPLORER_XTOP_HOME)/utilities/sta/timing_data_0.tcl
        report_scenario_data_for_icexplorer -scenario_name $scenario -dir $env(STA_DATA)
        report_pba_data_for_icexplorer -scenario_name $scenario -dir $env(STA_DATA) \
            -delay_type min_max -max_paths $env(MAX_PATHS) -nworst $env(NWORST)
    }
}
exit
