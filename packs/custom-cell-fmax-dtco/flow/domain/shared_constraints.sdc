# The selected top and constraints are Site bindings. This conservative fallback is
# used only when the Site explicitly chooses this template for its design.
current_design $DESIGN

set clk_name      clk
set clk_port_name clk
set clk_period    $CLK_NS
set clk_io_pct    0.2

set clk_port [get_ports $clk_port_name]

create_clock -name $clk_name -period $clk_period $clk_port
set clk_io_name vclk_$clk_name
create_clock -name $clk_io_name -period $clk_period

# sky130 reference used 0.710 ns of clock latency on a 3.6 ns period (0.197 x period). Keep the same
# RATIO rather than the absolute value, so the constraint is equivalently tight at 28nm.
set clk_lat [expr $clk_period * 0.197]
set_clock_latency $clk_lat [get_clocks $clk_name]
set_clock_latency $clk_lat [get_clocks $clk_io_name]

# NOTE: the ORFS SDC that the sky130 commercial flow sources uses `all_inputs -no_clocks`, which is
# an OpenSTA/PrimeTime idiom that Design Compiler REJECTS ("unknown option '-no_clocks'"). In the
# sky130 commercial runs that error is non-fatal, so set_input_delay was silently never applied and
# those runs synthesised with unconstrained inputs. Use the DC-correct idiom here.
set non_clock_inputs [remove_from_collection [all_inputs] $clk_port]
set_input_delay  [expr $clk_period * $clk_io_pct] -clock $clk_io_name $non_clock_inputs
set_output_delay [expr $clk_period * $clk_io_pct] -clock $clk_io_name [all_outputs]
