create_clock -name clk -period 1.0 [get_ports clk]
set_driving_cell -lib_cell BUFFD1BWP40P140 [all_inputs]
set_load 0.01 [all_outputs]
