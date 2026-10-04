# Top setup paths of the final routed design, for the arm record (run through `make run`).
source $::env(SCRIPTS_DIR)/load.tcl
load_design 6_final.odb 6_final.sdc
if { [file exists $::env(RESULTS_DIR)/6_final.spef] } {
  read_spef $::env(RESULTS_DIR)/6_final.spef
} else {
  estimate_parasitics -global_routing
}
set_propagated_clock [all_clocks]
report_checks -path_delay max -group_path_count 20 -endpoint_path_count 1 -digits 3 > /work/top-paths.txt
report_worst_slack -max -digits 4 >> /work/top-paths.txt
