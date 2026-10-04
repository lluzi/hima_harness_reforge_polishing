* FUSE_XNOR3_MUX2I : Y = ((A^B^C)&!S)|(!D&S)
* Auto-composed by scripts/compose_netlist.py from foundry CDL topologies
* (sky130_fd_sc_hd__xnor3_1 + sky130_fd_sc_hd__mux2i_1) wired through internal net XI.
* Foundry bulks VGND/VNB->gnd, VPWR/VPB->vdd.
.subckt FUSE_XNOR3_MUX2I A B C D S Y vdd gnd
* --- xnor3_1 stage ---
M0   XI       c1_net57 gnd      gnd      nmos w=0.65u l=0.15u
M1   c1_Ab    c1_Bb    c1_mid2  gnd      nmos w=0.6u l=0.15u
M2   c1_Abb   c1_Bb    c1_mid1  gnd      nmos w=0.42u l=0.15u
M3   c1_Bb    B        gnd      gnd      nmos w=0.65u l=0.15u
M4   c1_mid1  c1_Cb    c1_net57 gnd      nmos w=0.64u l=0.15u
M5   c1_Ab    A        gnd      gnd      nmos w=0.64u l=0.15u
M6   c1_Cb    C        gnd      gnd      nmos w=0.42u l=0.15u
M7   c1_mid2  C        c1_net57 gnd      nmos w=0.64u l=0.15u
M8   c1_Abb   c1_Ab    gnd      gnd      nmos w=0.64u l=0.15u
M9   c1_Ab    B        c1_mid1  gnd      nmos w=0.64u l=0.15u
M10  c1_Abb   B        c1_mid2  gnd      nmos w=0.64u l=0.15u
M11  XI       c1_net57 vdd      vdd      pmos w=1.0u l=0.15u
M12  c1_mid1  C        c1_net57 vdd      pmos w=0.84u l=0.15u
M13  c1_mid2  B        c1_Ab    vdd      pmos w=0.84u l=0.15u
M14  c1_Abb   c1_Ab    vdd      vdd      pmos w=1.0u l=0.15u
M15  c1_mid1  B        c1_Abb   vdd      pmos w=0.64u l=0.15u
M16  c1_mid2  c1_Bb    c1_Abb   vdd      pmos w=0.64u l=0.15u
M17  c1_mid2  c1_Cb    c1_net57 vdd      pmos w=0.84u l=0.15u
M18  c1_Cb    C        vdd      vdd      pmos w=0.64u l=0.15u
M19  c1_Ab    A        vdd      vdd      pmos w=1.0u l=0.15u
M20  c1_Bb    B        vdd      vdd      pmos w=1.0u l=0.15u
M21  c1_mid1  c1_Bb    c1_Ab    vdd      pmos w=0.84u l=0.15u
* --- mux2i_1 stage ---
M22  Y        XI       c2_smdNA0 gnd      nmos w=0.65u l=0.15u
M23  c2_smdNA0 c2_Sb    gnd      gnd      nmos w=0.65u l=0.15u
M24  Y        D        c2_sndNA1 gnd      nmos w=0.65u l=0.15u
M25  c2_sndNA1 S        gnd      gnd      nmos w=0.65u l=0.15u
M26  c2_Sb    S        gnd      gnd      nmos w=0.65u l=0.15u
M27  vdd      S        c2_sndPS vdd      pmos w=1.0u l=0.15u
M28  c2_sndPS XI       Y        vdd      pmos w=1.0u l=0.15u
M29  vdd      c2_Sb    c2_sndPSb vdd      pmos w=1.0u l=0.15u
M30  c2_sndPSb D        Y        vdd      pmos w=1.0u l=0.15u
M31  c2_Sb    S        vdd      vdd      pmos w=1.0u l=0.15u
.ends FUSE_XNOR3_MUX2I
