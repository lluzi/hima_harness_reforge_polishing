########################################################################
# xtop-operator.tcl -- typed XTop Operator session startup (batch-launched,
# then driven by the Harness's interactive Tcl-line adapter; see
# `.superpowers/sdd/pack-mechanics.md` section 1.8). Only the read/mutate/
# save/close procedures a Pack's `contract.yml` classifies are meant to be
# invoked once this prints its ready line -- everything above that line is
# fixed session setup, never itself a typed command.
#
# Required env vars: DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STA_DATA
#                     RUN_ROOT ECO_PREFIX NAME_PREFIX
########################################################################
foreach required {DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF RUN_ROOT ECO_PREFIX NAME_PREFIX} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set operator_root [file normalize $env(RUN_ROOT)]
set eco_output_dir [file join $operator_root eco_output]
set cell_lefs [lsort [glob -nocomplain $env(CELL_LEF_GLOB)]]
set lef_files [linsert $cell_lefs 0 $env(TECH_LEF)]
foreach file [concat [list $env(NETLIST) $env(DEF)] $lef_files] {
    if {![file readable $file]} { error "required XTop input is not readable: $file" }
}
cd $operator_root
set_parameter max_thread_number 8
create_workspace ${design}_operator -overwrite
link_reference_library -format lef $lef_files
create_design_definition -verilogs $env(NETLIST) -def $env(DEF)
import_designs
if {[info exists env(STA_DATA)] && [file isdirectory $env(STA_DATA)]} {
    read_timing_data -data_dir $env(STA_DATA)
}
save_workspace -as ${design}_operator_baseline

proc atcs_in_domain {name domain} {
    return [expr {[lsearch -exact $domain $name] >= 0}]
}
proc atcs_json_escape {s} {
    return [string map {"\\" "\\\\" "\"" "\\\"" "\n" "\\n"} $s]
}
proc atcs_log_op {json_line} {
    set fh [open $::env(OPS_LOG) a]
    puts $fh $json_line
    close $fh
}
proc atcs_query_paths {args} {
    return [uplevel 1 [linsert $args 0 get_paths]]
}
proc atcs_query_cells {object_spec attr_name args} {
    return [uplevel 1 [linsert $args 0 get_attribute $object_spec $attr_name]]
}
proc atcs_size_cell {instance to_master} {
    if {![atcs_in_domain $instance $::EDIT_DOMAIN_INSTANCES]} {
        error "out-of-scope instance: $instance"
    }
    set from_master [get_attribute $instance ref_name]
    size_cell [list $instance] $to_master
    atcs_log_op "{\"op\":\"size_cell\",\"instance\":\"[atcs_json_escape $instance]\",\"fromMaster\":\"[atcs_json_escape $from_master]\",\"toMaster\":\"[atcs_json_escape $to_master]\"}"
}
proc atcs_insert_buffer {net load_pins new_instance new_net master {x ""} {y ""}} {
    if {![atcs_in_domain $net $::EDIT_DOMAIN_NETS]} {
        error "out-of-scope net: $net"
    }
    if {$x ne "" && $y ne ""} {
        insert_buffer $load_pins $master -new_cell_names [list $new_instance] \
            -new_net_names [list $new_net] -locations [list [list $x $y]]
    } else {
        insert_buffer $load_pins $master -new_cell_names [list $new_instance] -new_net_names [list $new_net]
    }
    set pins_quoted {}
    foreach p $load_pins { lappend pins_quoted [format "\"%s\"" [atcs_json_escape $p]] }
    set pins_json [join $pins_quoted ,]
    set loc_json "null"
    if {$x ne "" && $y ne ""} { set loc_json "\[$x, $y\]" }
    atcs_log_op "{\"op\":\"insert_buffer\",\"net\":\"[atcs_json_escape $net]\",\"loadPins\":\[$pins_json\],\"newInstance\":\"[atcs_json_escape $new_instance]\",\"newNet\":\"[atcs_json_escape $new_net]\",\"master\":\"[atcs_json_escape $master]\",\"location\":$loc_json}"
}
proc atcs_delete_buffer {instance} {
    if {![atcs_in_domain $instance $::EDIT_DOMAIN_INSTANCES]} {
        error "out-of-scope instance: $instance"
    }
    set from_master [get_attribute $instance ref_name]
    remove_buffer [list $instance]
    atcs_log_op "{\"op\":\"delete_buffer\",\"instance\":\"[atcs_json_escape $instance]\",\"master\":\"[atcs_json_escape $from_master]\"}"
}
proc atcs_dump_cells {path} {
    # `get_cells -hierarchical` (documented, get_cells.1) plus
    # `foreach_in_collection` (documented, foreach_in_collection.1) is the
    # confirmed way to iterate every cell; `full_name`/`ref_name` are
    # queried the same way get_attribute.1's own worked example does
    # (`get_attribute [get_cells U43] ref_name`) -- see
    # knowledge/xtop-capabilities.md for the full citation. There is no
    # documented `get_object_name`; do not reintroduce it.
    set fh [open $path w]
    foreach_in_collection i [get_cells -hierarchical] {
        set inst [get_attribute [get_cells $i] full_name]
        set master [get_attribute [get_cells $i] ref_name]
        puts $fh "$inst $master"
    }
    close $fh
}
proc atcs_export_changes {} {
    file mkdir $::eco_output_dir
    write_design_changes -format INNOVUS -eco_file_prefix $::env(ECO_PREFIX) \
        -output_dir $::eco_output_dir -keep_route
    save_workspace -as ${::design}_operator_candidate
    return $::eco_output_dir
}
proc atcs_close {} {
    return "closing after adapter receipt"
}

puts "HIMA:hima-tcl-line-v1:1:READY:$env(NAME_PREFIX)"
