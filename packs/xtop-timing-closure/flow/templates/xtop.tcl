foreach required {DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STA_DATA RUN_ROOT LIBRARY_TCL ACTIONS_TCL ECO_PREFIX} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set report_dir $env(RUN_ROOT)/report
set eco_output_dir $env(RUN_ROOT)/eco_output
file mkdir $report_dir
file mkdir $eco_output_dir
set cell_lefs [lsort [glob -nocomplain $env(CELL_LEF_GLOB)]]
set lef_files [linsert $cell_lefs 0 $env(TECH_LEF)]
foreach file [concat [list $env(NETLIST) $env(DEF)] $lef_files] {
    if {![file readable $file]} { error "required XTop input is not readable: $file" }
}
if {![file isdirectory $env(STA_DATA)]} { error "PrimeTime timing-data directory is missing" }
set_parameter max_thread_number 8
create_workspace $design -overwrite
link_reference_library -format lef $lef_files
create_design_definition -verilogs $env(NETLIST) -def $env(DEF)
set_site_map {unit core}
set_removable_fillers {FILL* DCAP*}
import_designs
check_placement_readiness
source $env(LIBRARY_TCL)
read_timing_data -data_dir $env(STA_DATA)
save_workspace
check_inst_reference_library
check_inst_timing_library
set_parameter eco_new_object_prefix $env(ECO_PREFIX)
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
redirect -file $report_dir/pre_opt.rpt { summarize_gba_violations -exclude_path -as_reference -setup }
redirect -file $report_dir/pre_opt.rpt -append { summarize_gba_violations -exclude_path -as_reference -hold }
source $env(ACTIONS_TCL)
redirect -file $report_dir/post_opt.rpt { summarize_eco_actions }
redirect -file $report_dir/post_opt.rpt -append { summarize_gba_violations -exclude_path -with_reference -with_delta -setup }
redirect -file $report_dir/post_opt.rpt -append { summarize_gba_violations -exclude_path -with_reference -with_delta -hold }
write_design_changes -format INNOVUS -eco_file_prefix xtop_opt_innovus -output_dir $eco_output_dir -keep_route
save_workspace -as ${design}_xtop_eco
exit
