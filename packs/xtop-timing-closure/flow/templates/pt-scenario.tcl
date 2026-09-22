foreach required {DESIGN NETLIST INPUT_SDC SPEF REPORT_ROOT STA_DATA LIB_GLOB DRIVER_LIBRARY ORIGINAL_DRIVER_LIBRARY SCENARIO} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set scenario $env(SCENARIO)
set report_dir $env(REPORT_ROOT)/$scenario
file mkdir $report_dir
file mkdir $env(STA_DATA)
set lib_files [lsort [glob -nocomplain $env(LIB_GLOB)]]
if {[llength $lib_files] == 0} { error "no PT libraries matched $env(LIB_GLOB)" }
foreach file [concat [list $env(NETLIST) $env(INPUT_SDC) $env(SPEF)] $lib_files] {
    if {![file readable $file]} { error "required PrimeTime input is not readable: $file" }
}
set_app_var sh_continue_on_error false
set_app_var target_library $lib_files
set_app_var link_path [concat "*" $lib_files]
set_host_options -max_cores 8
read_verilog $env(NETLIST)
current_design $design
if {![link_design $design]} { error "link_design failed for $scenario" }
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
if {[sizeof_collection [all_clocks]] == 0} { error "no clocks were created" }
read_parasitics -format spef $env(SPEF)
set_propagated_clock [all_clocks]
update_timing -full
if {[sizeof_collection [get_timing_paths -delay_type max -max_paths 1 -slack_lesser_than 1000.0]] == 0} {
    error "no constrained max timing path exists"
}
redirect $report_dir/check_timing.rpt { check_timing -verbose }
redirect $report_dir/global_timing.rpt { report_global_timing }
redirect $report_dir/constraints.rpt { report_constraint -all_violators -verbose }
redirect $report_dir/setup.rpt {
    report_timing -delay_type max -path_type full_clock_expanded -max_paths 2000 -nworst 20 -slack_lesser_than 0.0 -input_pins -nets -transition_time -capacitance
}
redirect $report_dir/hold.rpt {
    report_timing -delay_type min -path_type full_clock_expanded -max_paths 2000 -nworst 20 -slack_lesser_than 0.0 -input_pins -nets -transition_time -capacitance
}
if {![info exists env(ICEXPLORER_XTOP_HOME)]} { error "ICEXPLORER_XTOP_HOME is not set" }
source $env(ICEXPLORER_XTOP_HOME)/utilities/sta/timing_data_0.tcl
report_scenario_data_for_icexplorer -scenario_name $scenario -dir $env(STA_DATA)
report_pba_data_for_icexplorer -scenario_name $scenario -dir $env(STA_DATA) -delay_type min_max -max_paths 4000 -nworst 20
exit

