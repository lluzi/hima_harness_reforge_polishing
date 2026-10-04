* FUSE_O22AI_XNOR2 : LVS REFERENCE for the ABUTTED foundry layout (scripts/abut_cells.py).
* Y = !((!((A1|A2)&(B1|B2))) ^ E)
* Keeps the foundry convention on BOTH sides of the comparison: sky130_fd_pr__* device
* names and VPWR/VGND/VPB/VNB rails, exactly as Magic extracts them from a layout built
* out of foundry cells. The --lvs-ref convention (generic nmos/pmos + vdd/gnd) is for
* lclayout-generated cells; against a foundry-derived layout netgen reports every device
* as "(no matching element)" and then fails pin matching.
.subckt FUSE_O22AI_XNOR2 A1 A2 B1 B2 E Y VPWR VGND VPB VNB
* --- o22ai_1 stage ---
X0   VPWR      A1        c1_sndA1  VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X1   c1_sndA1  A2        XI        VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X2   VPWR      B1        c1_sndB1  VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X3   c1_sndB1  B2        XI        VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X4   c1_pndA   A1        VGND      VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X5   c1_pndA   A2        VGND      VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X6   XI        B1        c1_pndA   VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X7   XI        B2        c1_pndA   VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
* --- xnor2_1 stage ---
X8   VGND      XI        c2_sndNA  VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X9   c2_sndNA  E         c2_inand  VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X10  c2_nmid   XI        VGND      VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X11  c2_nmid   E         VGND      VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X12  Y         c2_inand  c2_nmid   VNB       sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X13  c2_inand  XI        VPWR      VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X14  c2_inand  E         VPWR      VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X15  VPWR      XI        c2_sndPA  VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X16  c2_sndPA  E         Y         VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
X17  Y         c2_inand  VPWR      VPB       sky130_fd_pr__pfet_01v8_hvt w=1.0 l=0.15
.ends FUSE_O22AI_XNOR2
