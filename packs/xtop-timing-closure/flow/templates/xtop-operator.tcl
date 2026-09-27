foreach required {DESIGN TECH_LEF CELL_LEF_GLOB NETLIST DEF STA_DATA RUN_ROOT LIBRARY_TCL ACTIONS_TCL ACTION_COUNT PLAN_SHA256 ECO_PREFIX OPERATOR_IDENTITY} {
    if {![info exists env($required)]} { error "$required is required" }
}
set design $env(DESIGN)
set operator_root [file normalize $env(RUN_ROOT)]
set eco_output_dir [file join $operator_root eco_output]
set cell_lefs [lsort [glob -nocomplain $env(CELL_LEF_GLOB)]]
set lef_files [linsert $cell_lefs 0 $env(TECH_LEF)]
foreach file [concat [list $env(NETLIST) $env(DEF) $env(LIBRARY_TCL) $env(ACTIONS_TCL)] $lef_files] {
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
set hima_mutation_count 0
set hima_plan_state ready

proc hima_directory_entries {directory} {
    set entries [concat \
        [glob -nocomplain -directory $directory *] \
        [glob -nocomplain -directory $directory .*]]
    set retained {}
    foreach entry $entries {
        if {[file tail $entry] ni {. ..}} { lappend retained $entry }
    }
    return $retained
}

proc hima_operator_identity {} {
    return $::env(OPERATOR_IDENTITY)
}
proc hima_summary {mode} {
    if {$mode eq "setup"} { summarize_gba_violations -exclude_path -as_reference -setup; return }
    if {$mode eq "hold"} { summarize_gba_violations -exclude_path -as_reference -hold; return }
    error "mode must be setup or hold"
}
proc hima_apply_action {kind effort setup_target hold_target setup_margin hold_margin plan_sha256} {
    if {$::hima_plan_state ne "ready"} {
        error "reviewed action was already attempted; state=$::hima_plan_state"
    }
    set ::hima_plan_state applying
    set apply_code [catch {
        if {$plan_sha256 ne $::env(PLAN_SHA256)} { error "reviewed action plan hash differs from live retained plan" }
        switch -- $kind {
            setup-size { fix_setup_gba_violations -methods size_cell -effort $effort -setup_target $setup_target -hold_margin $hold_margin }
            setup-buffer { fix_setup_gba_violations -methods insert_buffer -effort $effort -setup_target $setup_target -hold_margin $hold_margin }
            hold-size { fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target $hold_target -setup_margin $setup_margin }
            hold-buffer { fix_hold_gba_violations -effort $effort -hold_target $hold_target -setup_margin $setup_margin }
            default { error "unsupported reviewed action kind" }
        }
        set receipt_path [file join $::operator_root selected-action.json]
        if {![catch {file lstat $receipt_path receipt_stat}]} { error "selected-action receipt already exists" }
        set receipt [open $receipt_path {WRONLY CREAT EXCL}]
        puts $receipt [format {{"schema":"xtop-selected-action/1","planSha256":"%s","action":{"kind":"%s","effort":"%s","setupTargetNs":%s,"holdTargetNs":%s,"setupMarginNs":%s,"holdMarginNs":%s}}} $plan_sha256 $kind $effort $setup_target $hold_target $setup_margin $hold_margin]
        close $receipt
    } apply_result apply_options]
    if {$apply_code != 0} {
        set ::hima_plan_state uncertain
        return -options $apply_options $apply_result
    }
    set ::hima_plan_state applied
    incr ::hima_mutation_count
    return "applied reviewed action kind=$kind"
}
proc hima_save_candidate {} {
    if {$::hima_plan_state eq "uncertain"} {
        error "reviewed action application is uncertain; candidate save is forbidden"
    }
    if {$::hima_mutation_count < 1} {
        error "candidate requires at least one successful typed mutation"
    }
    if {[file exists $::eco_output_dir]} {
        set existing [hima_directory_entries $::eco_output_dir]
        if {[llength $existing] == 0} {
            file delete -force $::eco_output_dir
        } else {
            error "candidate ECO output already exists; refusing an uncertain overwrite"
        }
    }
    file mkdir $::eco_output_dir
    set write_code [catch {
        write_design_changes -format INNOVUS -eco_file_prefix $::env(ECO_PREFIX) -output_dir $::eco_output_dir -keep_route
    } write_result write_options]
    if {$write_code != 0} {
        if {[llength [hima_directory_entries $::eco_output_dir]] == 0} {
            file delete -force $::eco_output_dir
        }
        return -options $write_options $write_result
    }
    set logical [glob -nocomplain [file join $::eco_output_dir "$::env(ECO_PREFIX)_netlist_*.txt"]]
    set physical [glob -nocomplain [file join $::eco_output_dir "$::env(ECO_PREFIX)_physical_*.txt"]]
    if {[llength $logical] != 1 || [llength $physical] != 1} {
        if {[llength [hima_directory_entries $::eco_output_dir]] == 0} {
            file delete -force $::eco_output_dir
        }
        error "candidate write produced no unique netlist and physical ECO pair"
    }
    return $::eco_output_dir
}
proc hima_close {} {
    return "closing after adapter receipt"
}

puts "HIMA:hima-tcl-line-v1:1:READY"
