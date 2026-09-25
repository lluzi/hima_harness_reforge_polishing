foreach required {DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STA_DATA RUN_ROOT LIBRARY_TCL ECO_PREFIX OPERATOR_IDENTITY} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set operator_root [file normalize $env(RUN_ROOT)]
set eco_output_dir [file join $operator_root eco_output]
set cell_lefs [lsort [glob -nocomplain $env(CELL_LEF_GLOB)]]
set lef_files [linsert $cell_lefs 0 $env(TECH_LEF)]
foreach file [concat [list $env(NETLIST) $env(DEF) $env(LIBRARY_TCL)] $lef_files] {
    if {![file readable $file]} { error "required XTop input is not readable: $file" }
}
if {![file isdirectory $env(STA_DATA)]} { error "PrimeTime timing-data directory is missing" }

cd $operator_root
set_parameter max_thread_number 8
create_workspace ${design}_operator -overwrite
link_reference_library -format lef $lef_files
create_design_definition -verilogs $env(NETLIST) -def $env(DEF)
set_site_map {unit core}
set_removable_fillers {FILL* DCAP*}
import_designs
check_placement_readiness
source $env(LIBRARY_TCL)
read_timing_data -data_dir $env(STA_DATA)
save_workspace -as ${design}_operator_baseline
check_inst_reference_library
check_inst_timing_library
set_parameter eco_new_object_prefix hima_operator_eco
set_parameter eco_buffer_list_for_hold {
    DEL025D1BWP30P140 DEL050MD1BWP30P140 DEL075MD1BWP30P140 DEL100MD1BWP30P140
    DEL150MD1BWP30P140 DEL200MD1BWP30P140 DEL250MD1BWP30P140 BUFFD2BWP30P140 BUFFD4BWP30P140
}
set_parameter eco_buffer_list_for_setup {
    BUFFD2BWP30P140 BUFFD3BWP30P140 BUFFD4BWP30P140 BUFFD6BWP30P140
    BUFFD8BWP30P140 BUFFD12BWP30P140 BUFFD16BWP30P140
}
set_parameter eco_cell_classify_rule cell_attribute
set_parameter eco_cell_match_attribute footprint
set_parameter eco_cell_nominal_swap_keywords {ULVT LVT {} HVT}
set_parameter eco_cell_nominal_sizing_pattern {D([0-9]+)BWP}
set_parameter eco_gain_threshold 0.001

proc hima_operator_identity {} {
    return $::env(OPERATOR_IDENTITY)
}
proc hima_summary {mode} {
    if {$mode eq "setup"} { summarize_gba_violations -exclude_path -as_reference -setup; return }
    if {$mode eq "hold"} { summarize_gba_violations -exclude_path -as_reference -hold; return }
    error "mode must be setup or hold"
}
proc hima_fix_hold {effort target margin} {
    if {$effort ni {low medium high}} { error "effort must be low, medium or high" }
    if {![string is double -strict $target] || ![string is double -strict $margin]} {
        error "target and margin must be finite numeric Tcl literals"
    }
    fix_hold_gba_violations -effort $effort -hold_target $target -setup_margin $margin
}
proc hima_save_candidate {} {
    file mkdir $::eco_output_dir
    write_design_changes -format INNOVUS -eco_file_prefix $::env(ECO_PREFIX) -output_dir $::eco_output_dir -keep_route
    save_workspace -as ${::design}_operator_candidate
    return $::eco_output_dir
}
proc hima_close {} {
    return "closing after adapter receipt"
}

puts "HIMA:hima-tcl-line-v1:1:READY"
