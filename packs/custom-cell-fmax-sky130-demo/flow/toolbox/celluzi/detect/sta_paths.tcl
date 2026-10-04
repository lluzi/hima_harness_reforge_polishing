# Extract worst setup paths from the frozen aes baseline (substrate for Method A: critical-path fusion).
# Run: openroad -no_init -exit detect/sta_paths.tcl   (inside the container)
set F /foss/designs/celluzi/OpenROAD-flow-scripts/flow
set B $F/results/sky130hd/aes/base
read_liberty $F/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib
read_db $B/6_final.odb
read_sdc $B/6_final.sdc
read_spef $B/6_final.spef
puts "=== WNS / TNS (setup) ==="
report_worst_slack -max
report_tns
puts "=== WORST SETUP PATHS (eyeball the recurring gate sequences) ==="
report_checks -path_delay max -group_path_count 8 -endpoint_path_count 1 -unique_paths_to_endpoint \
  -format full_clock_expanded -fields {slew cap input net fanout} -digits 4
