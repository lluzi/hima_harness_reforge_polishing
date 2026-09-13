# Design Compiler synthesis for the TSMC28 generated-standard-cell flow.
#
# PROVENANCE. Derived from the golden control assets aes_tsmc28/scripts/dc_syn_tsmc28.tcl and
# aes_tsmc28/config.tcl, collapsed into one script. The logic is the golden logic. The ONLY
# change is that every site path the golden files hardcoded is now read from the run input
# binding, so this script carries no foundry path, no design path and no site literal:
#
#   golden config.tcl  set TSMC28/NLDM/DB ...   ->  $::env(FOUNDRY_DB) / $::env(FOUNDRY_LIB)
#   golden config.tcl  set PLAT .../designs/src ->  $::env(DESIGN_RTL_GLOB)
#   golden config.tcl  set DESIGN aes_cipher_top->  $::env(DESIGN_TOP)
#   golden dc_syn      $FLOW/results, $FLOW/work ->  the run workspace (cwd)
#
# BOTH ARMS COME FROM THIS ONE SCRIPT. That is deliberate and is the golden behaviour: the only
# difference between the baseline and the custom arm is whether XS28_CUSTOM_DB is set, so an arm
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
set ARM      [need XS28_ARM]

# The foundry library. This flow's library ships .db directly (1:1 with .lib), so unlike a
# .lib-only PDK there is no lc_shell pass for the FOUNDRY library -- the generated library still
# gets one, and that pass is the hard gate in stage 6.
set DB [need FOUNDRY_DB]
if {![file exists $DB]} { error "foundry .db not found via FOUNDRY_DB: $DB" }

# Optional generated-cell injection. XS28_CUSTOM_DB points at the compiled .db of the generated
# cells; unset = the untouched foundry-only baseline.
set CUSTOM ""
if {[info exists ::env(XS28_CUSTOM_DB)] && $::env(XS28_CUSTOM_DB) ne ""} {
    set CUSTOM $::env(XS28_CUSTOM_DB)
    if {![file exists $CUSTOM]} { error "generated .db not found: $CUSTOM" }
    puts "   generated : $CUSTOM"
}
if {$ARM ne "base" && $CUSTOM eq ""} {
    error "XS28_ARM requires a generated db but XS28_CUSTOM_DB is unset: the generated-library \
arm would silently be a second baseline"
}
if {$ARM eq "base" && $CUSTOM ne ""} {
    error "XS28_ARM is base but XS28_CUSTOM_DB is set: the baseline would be contaminated and the \
mining substrate would no longer be foundry-only"
}

set WORK_DIR "./work/dc_work"
if {[info exists ::env(XS28_WORK_DIR)] && $::env(XS28_WORK_DIR) ne ""} {
    set WORK_DIR $::env(XS28_WORK_DIR)
}
set REPORT_DIR "./reports"
if {[info exists ::env(XS28_REPORT_DIR)] && $::env(XS28_REPORT_DIR) ne ""} {
    set REPORT_DIR $::env(XS28_REPORT_DIR)
}
file mkdir $WORK_DIR
file mkdir $REPORT_DIR

set_app_var target_library [concat [list $DB] $CUSTOM]
set_app_var link_library [concat "*" [list $DB] $CUSTOM "dw_foundation.sldb"]
define_design_lib work -path $WORK_DIR

# The design RTL is technology-independent, so the same source tree feeds every technology and
# nothing is forked or copied.
set rtl [glob $RTL_GLOB]
puts "== TSMC28 synthesis =="
puts "   arm    : $ARM"
puts "   db     : $DB"
puts "   clock  : $CLK_NS ns"
analyze -format verilog $rtl
elaborate $DESIGN
current_design $DESIGN
link

source [need XS28_SDC]
redirect ${REPORT_DIR}/check_design.rpt      { check_design }
redirect ${REPORT_DIR}/check_timing_pre.rpt  { check_timing }

compile_ultra -no_autoungroup

change_names -rules verilog -hierarchy
write -format verilog -hierarchy -output ./results/${ARM}.dc.v
write_sdc ./results/${ARM}.dc.sdc
redirect ${REPORT_DIR}/timing_${ARM}.rpt { report_timing -max_paths 5 -nworst 2 }
redirect ${REPORT_DIR}/qor_${ARM}.rpt    { report_qor }
redirect ${REPORT_DIR}/area_${ARM}.rpt   { report_area -hierarchy }
redirect ${REPORT_DIR}/power_${ARM}.rpt  { report_power }
# Adoption evidence. report_reference is the tool's own instance-to-master census; the adoption
# record is built from the NETLIST relation, and this report is kept as the cross-check.
redirect ${REPORT_DIR}/refs_${ARM}.rpt   { report_reference }
set _xs_pattern [need XS28_GENERATED_LIB_CELL_PATTERN]
set _xs_generated [get_lib_cells -quiet */$_xs_pattern]
puts "=== AES_DTCO LIBRARY_VISIBLE_COUNT [sizeof_collection $_xs_generated] ==="
puts "=== AES_DTCO SYNTHESIS_COMPLETE $ARM ==="
exit
