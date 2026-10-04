# Dump worst setup paths for Method A (critical-path fusion). Prints full report to stdout;
# the driver redirects it to data/runs/aes_paths.raw. The Python parser filters to reg2reg.
set F /foss/designs/celluzi/OpenROAD-flow-scripts/flow
set B $F/results/sky130hd/aes/base
read_liberty $F/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib
read_db $B/6_final.odb
read_sdc $B/6_final.sdc
read_spef $B/6_final.spef
report_checks -path_delay max -group_path_count 400 -endpoint_path_count 1 -unique_paths_to_endpoint \
  -format full_clock_expanded -fields {input net cap slew fanout} -digits 4
