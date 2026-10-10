# aes_cipher_top timing constraints (MOCK EDA demo design of the Site eda_cluster_ctu_01)
set_units -time ns -capacitance pF
create_clock -name clk -period 1.000 [get_ports clk]
set_clock_uncertainty -setup 0.025 [get_clocks clk]
set_clock_transition 0.030 [get_clocks clk]
set_input_delay  0.200 -clock clk [remove_from_collection [all_inputs] [get_ports clk]]
set_output_delay 0.200 -clock clk [all_outputs]
set_load 0.004 [all_outputs]
set_driving_cell -lib_cell BUF_X2 [remove_from_collection [all_inputs] [get_ports clk]]
