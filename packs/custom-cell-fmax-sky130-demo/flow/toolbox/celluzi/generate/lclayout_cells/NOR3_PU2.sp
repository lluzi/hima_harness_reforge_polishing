* NOR3_PU2 : transistor-level variant of sky130_fd_sc_hd__nor3_1
* drive=1 skew_p=1 skew_n=1 scale_w=1 -- W scaled / fingers expanded; L untouched
.subckt NOR3_PU2 A B C Y vdd gnd
M0   vdd      A        sndPA    vdd      pmos w=1u l=0.15u
M1   vdd      A        sndPA    vdd      pmos w=1u l=0.15u
M2   sndPA    B        sndPB    vdd      pmos w=1u l=0.15u
M3   sndPA    B        sndPB    vdd      pmos w=1u l=0.15u
M4   sndPB    C        Y        vdd      pmos w=1u l=0.15u
M5   sndPB    C        Y        vdd      pmos w=1u l=0.15u
M6   Y        A        gnd      gnd      nmos w=0.65u l=0.15u
M7   Y        B        gnd      gnd      nmos w=0.65u l=0.15u
M8   Y        C        gnd      gnd      nmos w=0.65u l=0.15u
.ends NOR3_PU2
