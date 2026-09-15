# Design Compiler synthesis for the current-process generated-standard-cell flow.
#
# PROVENANCE. Derived from the site-bound templates site_bound_process/scripts/dc_syn_current_process.tcl and
# site_bound_process/config.tcl, collapsed into one script. The logic is the reference logic. The ONLY
# change is that every site path the site files hardcoded is now read from the run input
# binding, so this script carries no foundry path, no design path and no site literal:
#
#   site configuration.tcl  set current-process/NLDM/DB ...   ->  $::env(FOUNDRY_DB) / $::env(FOUNDRY_LIB)
#   site configuration.tcl  set PLAT .../designs/src ->  $::env(DESIGN_RTL_GLOB)
#   Site configuration.tcl  set DESIGN <top> ->  $::env(DESIGN_TOP)
#   site synthesis      $FLOW/results, $FLOW/work ->  the run workspace (cwd)
#
# BOTH ARMS COME FROM THIS ONE SCRIPT. That is deliberate and is the shared-method behaviour: the only
# difference between the baseline and the custom arm is whether CCFMAX_CUSTOM_DB is set, so an arm
# difference can never be a script difference.

proc need {name} {
    if {![info exists ::env($name)] || $::env($name) eq ""} {
        error "input binding $name is not set"
    }
    return $::env($name)
}

set DESIGN   [need DESIGN_TOP]
set RTL_GLOB [need DESIGN_RTL_GLOB]
set CLK_NS   [need CLK_NS]
set ARM      [need CCFMAX_ARM]

# The foundry library. This flow's library ships .db directly (1:1 with .lib), so unlike a
# .lib-only PDK there is no lc_shell pass for the FOUNDRY library -- the generated library still
# gets one, and that pass is the hard gate in stage 6.
set DB [need FOUNDRY_DB]
if {![file exists $DB]} { error "foundry .db not found via FOUNDRY_DB: $DB" }

# Optional generated-cell injection. CCFMAX_CUSTOM_DB points at the compiled .db of the generated
# cells; unset = the untouched foundry-only baseline.
set CUSTOM ""
if {[info exists ::env(CCFMAX_CUSTOM_DB)] && $::env(CCFMAX_CUSTOM_DB) ne ""} {
    set CUSTOM $::env(CCFMAX_CUSTOM_DB)
    if {![file exists $CUSTOM]} { error "generated .db not found: $CUSTOM" }
    puts "   generated : $CUSTOM"
}
if {$ARM ne "base" && $CUSTOM eq ""} {
    error "CCFMAX_ARM requires a generated db but CCFMAX_CUSTOM_DB is unset: the generated-library \
arm would silently be a second baseline"
}
if {$ARM eq "base" && $CUSTOM ne ""} {
    error "CCFMAX_ARM is base but CCFMAX_CUSTOM_DB is set: the baseline would be contaminated and the \
mining substrate would no longer be foundry-only"
}

set WORK_DIR "./work/dc_work"
if {[info exists ::env(CCFMAX_WORK_DIR)] && $::env(CCFMAX_WORK_DIR) ne ""} {
    set WORK_DIR $::env(CCFMAX_WORK_DIR)
}
set REPORT_DIR "./reports"
if {[info exists ::env(CCFMAX_REPORT_DIR)] && $::env(CCFMAX_REPORT_DIR) ne ""} {
    set REPORT_DIR $::env(CCFMAX_REPORT_DIR)
}
file mkdir $WORK_DIR
file mkdir $REPORT_DIR

set_app_var target_library [concat [list $DB] $CUSTOM]
set_app_var link_library [concat "*" [list $DB] $CUSTOM "dw_foundation.sldb"]
define_design_lib work -path $WORK_DIR

# The design RTL is technology-independent, so the same source tree feeds every technology and
# nothing is forked or copied.
set rtl [glob $RTL_GLOB]
puts "== current-process synthesis =="
puts "   arm    : $ARM"
puts "   db     : $DB"
puts "   clock  : $CLK_NS ns"
analyze -format verilog $rtl
elaborate $DESIGN
current_design $DESIGN
link

source [need CCFMAX_SDC]
redirect ${REPORT_DIR}/check_design.rpt      { check_design }
redirect ${REPORT_DIR}/check_timing_pre.rpt  { check_timing }
set _registers [all_registers]
if {[sizeof_collection $_registers] == 0} {error "no registers available for Fmax path grouping"}
group_path -name reg2reg -from $_registers -to $_registers -weight 10 -critical_range 0.10
group_path -name in2reg -from [all_inputs] -to $_registers -weight 1
group_path -name reg2out -from $_registers -to [all_outputs] -weight 1

# Both arms see the same deliberate logic-optimization pressure. The generated
# library remains the only arm-specific input. Route receives a separately frozen
# 25% plus a fixed 50 ps uncertainty through the SDC written below. The fixed
# addition keeps useful post-route pressure when the nominal period is 0.5 ns.
set _dc_uncertainty [expr {$CLK_NS * 0.50}]
set _route_uncertainty [expr {$CLK_NS * 0.25 + 0.050}]
set_clock_uncertainty $_dc_uncertainty [get_clocks *]
puts "=== CUSTOM_CELL_FMAX DC_UNCERTAINTY_NS $_dc_uncertainty ==="
compile_ultra -no_autoungroup

change_names -rules verilog -hierarchy
write -format verilog -hierarchy -output ./results/${ARM}.dc.v
redirect ${REPORT_DIR}/timing_${ARM}.rpt { report_timing -max_paths 5 -nworst 2 }
redirect ${REPORT_DIR}/timing_reg2reg_${ARM}.rpt { report_timing -group reg2reg -max_paths 20 -nworst 3 -input_pins -nets -transition_time -capacitance }
redirect ${REPORT_DIR}/qor_${ARM}.rpt    { report_qor }
redirect ${REPORT_DIR}/area_${ARM}.rpt   { report_area -hierarchy }
redirect ${REPORT_DIR}/power_${ARM}.rpt  { report_power }
# Adoption evidence. report_reference is the tool's own instance-to-master census; the adoption
# record is built from the NETLIST relation, and this report is kept as the cross-check.
redirect ${REPORT_DIR}/refs_${ARM}.rpt   { report_reference }
set_clock_uncertainty $_route_uncertainty [get_clocks *]
write_sdc ./results/${ARM}.dc.sdc
puts "=== CUSTOM_CELL_FMAX ROUTE_UNCERTAINTY_NS $_route_uncertainty ==="
set _xs_pattern [need CCFMAX_GENERATED_LIB_CELL_PATTERN]
set _xs_generated [get_lib_cells -quiet */$_xs_pattern]
puts "=== CUSTOM_CELL_FMAX LIBRARY_VISIBLE_COUNT [sizeof_collection $_xs_generated] ==="
puts "=== CUSTOM_CELL_FMAX SYNTHESIS_COMPLETE $ARM ==="
exit
