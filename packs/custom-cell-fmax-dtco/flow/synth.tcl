# Portable Design Compiler probe. Site bindings supply the design, library and
# constraints; all paths arrive through entry.tcl.
set_host_options -max_cores 8
set_app_var target_library [list $DB]
set_app_var link_library [concat "*" [list $DB] "dw_foundation.sldb"]
define_design_lib work -path ./work
analyze -format verilog $RTL
elaborate $DESIGN
current_design $DESIGN
link
source $CONSTRAINTS_TCL
redirect check_design.rpt {check_design}
redirect check_timing.rpt {check_timing}
set _registers [all_registers]
if {[sizeof_collection $_registers] == 0} {error "no registers available for Fmax path grouping"}
group_path -name reg2reg -from $_registers -to $_registers -weight 10 -critical_range 0.10
group_path -name in2reg -from [all_inputs] -to $_registers -weight 1
group_path -name reg2out -from $_registers -to [all_outputs] -weight 1
set_clock_uncertainty [expr {$CLK_NS * 0.50}] [get_clocks $CLOCK_NAME]
compile_ultra -no_autoungroup
change_names -rules verilog -hierarchy
write -format verilog -hierarchy -output netlist.v
write_sdc constraints.sdc
redirect timing.rpt {report_timing -group reg2reg -max_paths 32 -nworst 2 -input_pins -nets -transition_time -capacitance}
redirect qor.rpt {report_qor}
redirect references.rpt {report_reference}
# Query only the path group that determines sequential Fmax. I/O paths remain
# constrained, but never stand in for reg-to-reg optimization pressure.
set worst ""
foreach_in_collection p [get_timing_paths -group reg2reg -delay_type max -max_paths 1 -nworst 1] {
    set s [get_attribute $p slack]
    if {$worst eq "" || $s < $worst} {set worst $s}
}
if {$worst eq ""} {error "no constrained reg2reg setup paths"}
set report [open metrics.tsv w]
set actual_period [get_attribute [get_clocks $CLOCK_NAME] period]
if {$actual_period eq ""} {error "Site clock $CLOCK_NAME is not defined by its constraints"}
puts $report "asked_period_ns\t$actual_period"
puts $report "worst_slack_ns\t$worst"
# X-2025.06-SP3 does not expose area on current_design (UID-101). Use its actual
# QoR Cell Area field; the source report is retained and hashed beside metrics.
set qor_file [open qor.rpt r]
set qor_text [read $qor_file]
close $qor_file
set area_matches [regexp -all -inline -line {^[ \t]*Cell Area:[ \t]+([0-9.eE+-]+)[ \t]*$} $qor_text]
if {[llength $area_matches] != 2} {error "missing or ambiguous Cell Area in QoR"}
puts $report "cell_area_um2\t[lindex $area_matches 1]"
close $report
exit
