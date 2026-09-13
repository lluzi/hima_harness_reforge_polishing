# Derived from legacy extensions/xspace_cell_aes_tsmc28/flow/scripts/dc_syn_tsmc28.tcl
# and constraint_tsmc28.sdc. Foundry-only probe; all paths arrive through entry.tcl.
set_host_options -max_cores 8
set_app_var target_library [list $DB]
set_app_var link_library [concat "*" [list $DB] "dw_foundation.sldb"]
define_design_lib work -path ./work
analyze -format verilog $RTL
elaborate $DESIGN
current_design $DESIGN
link
create_clock -name clk -period $CLK_NS [get_ports clk]
create_clock -name vclk_clk -period $CLK_NS
set_clock_latency [expr {$CLK_NS * 0.197}] [get_clocks clk]
set_clock_latency [expr {$CLK_NS * 0.197}] [get_clocks vclk_clk]
set_input_delay [expr {$CLK_NS * 0.2}] -clock vclk_clk [remove_from_collection [all_inputs] [get_ports clk]]
set_output_delay [expr {$CLK_NS * 0.2}] -clock vclk_clk [all_outputs]
redirect check_design.rpt {check_design}
redirect check_timing.rpt {check_timing}
compile_ultra -no_autoungroup
change_names -rules verilog -hierarchy
write -format verilog -hierarchy -output netlist.v
write_sdc constraints.sdc
redirect timing.rpt {report_timing -max_paths 32 -nworst 2 -input_pins -nets -transition_time -capacitance}
redirect qor.rpt {report_qor}
redirect references.rpt {report_reference}
# Query the worst constrained setup path of every group. Missing/nonfinite results
# are rejected downstream, never replaced by a zero-slack success.
set worst ""
foreach_in_collection group [get_path_groups *] {
    foreach_in_collection p [get_timing_paths -group [get_object_name $group] -delay_type max -max_paths 1 -nworst 1] {
        set s [get_attribute $p slack]
        if {$worst eq "" || $s < $worst} {set worst $s}
    }
}
if {$worst eq ""} {error "no constrained setup paths"}
set report [open metrics.tsv w]
set actual_period [get_attribute [get_clocks clk] period]
if {$actual_period != [get_attribute [get_clocks vclk_clk] period]} {error "clock periods disagree"}
puts $report "asked_period_ns\t$actual_period"
puts $report "worst_slack_ns\t$worst"
puts $report "cell_area_um2\t[get_attribute [current_design] area]"
close $report
exit
