export PLATFORM = sky130hd
export DONT_USE_CELLS += \
    sky130_fd_sc_hd__probe_p_8 sky130_fd_sc_hd__probec_p_8 \
    sky130_fd_sc_hd__lpflow_bleeder_1 sky130_fd_sc_hd__lpflow_clkbufkapwr_1
export LIB_FILES = $(PLATFORM_DIR)/lib/sky130_fd_sc_hd__tt_025C_1v80.lib
