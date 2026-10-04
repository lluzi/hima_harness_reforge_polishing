* NOR3_PU2 : transistor-level variant of sky130_fd_sc_hd__nor3_1
* drive=1 skew_p=1 skew_n=1 scale_w=1 -- W scaled / fingers expanded; L untouched
.subckt NOR3_PU2 A B C Y vdd gnd
X0   vdd      A        sndPA    VPB      sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X1   vdd      A        sndPA    VPB      sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X2   sndPA    B        sndPB    VPB      sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X3   sndPA    B        sndPB    VPB      sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X4   sndPB    C        Y        VPB      sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X5   sndPB    C        Y        VPB      sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X6   Y        A        gnd      VNB      sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X7   Y        B        gnd      VNB      sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X8   Y        C        gnd      VNB      sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
.ends NOR3_PU2
