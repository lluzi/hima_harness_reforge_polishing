* FUSE_XNOR3_XNOR3 : Y = !((!(A^B^C))^D^E)
* Auto-composed by scripts/compose_netlist.py from foundry CDL topologies
* (sky130_fd_sc_hd__xnor3_1 + sky130_fd_sc_hd__xnor3_1) wired through internal net XI.
* Foundry bulks VGND/VNB->gnd, VPWR/VPB->vdd.
.subckt FUSE_XNOR3_XNOR3 A B C D E X vdd gnd
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
* --- xnor3_1 stage ---
M22  X        c2_net57 gnd      gnd      nmos w=0.65u l=0.15u
M23  c2_Ab    c2_Bb    c2_mid2  gnd      nmos w=0.6u l=0.15u
M24  c2_Abb   c2_Bb    c2_mid1  gnd      nmos w=0.42u l=0.15u
M25  c2_Bb    D        gnd      gnd      nmos w=0.65u l=0.15u
M26  c2_mid1  c2_Cb    c2_net57 gnd      nmos w=0.64u l=0.15u
M27  c2_Ab    XI       gnd      gnd      nmos w=0.64u l=0.15u
M28  c2_Cb    E        gnd      gnd      nmos w=0.42u l=0.15u
M29  c2_mid2  E        c2_net57 gnd      nmos w=0.64u l=0.15u
M30  c2_Abb   c2_Ab    gnd      gnd      nmos w=0.64u l=0.15u
M31  c2_Ab    D        c2_mid1  gnd      nmos w=0.64u l=0.15u
M32  c2_Abb   D        c2_mid2  gnd      nmos w=0.64u l=0.15u
M33  X        c2_net57 vdd      vdd      pmos w=1.0u l=0.15u
M34  c2_mid1  E        c2_net57 vdd      pmos w=0.84u l=0.15u
M35  c2_mid2  D        c2_Ab    vdd      pmos w=0.84u l=0.15u
M36  c2_Abb   c2_Ab    vdd      vdd      pmos w=1.0u l=0.15u
M37  c2_mid1  D        c2_Abb   vdd      pmos w=0.64u l=0.15u
M38  c2_mid2  c2_Bb    c2_Abb   vdd      pmos w=0.64u l=0.15u
M39  c2_mid2  c2_Cb    c2_net57 vdd      pmos w=0.84u l=0.15u
M40  c2_Cb    E        vdd      vdd      pmos w=0.64u l=0.15u
M41  c2_Ab    XI       vdd      vdd      pmos w=1.0u l=0.15u
M42  c2_Bb    D        vdd      vdd      pmos w=1.0u l=0.15u
M43  c2_mid1  c2_Bb    c2_Ab    vdd      pmos w=0.84u l=0.15u
.ends FUSE_XNOR3_XNOR3
