* INV2X: minimum-scale probe for lclayout inter-column poly gate routing.
* Gate net A has fanout 4 (two nmos + two pmos) -> cannot fit lclayout's 2-slot column.
* Only ONE net needs routing and congestion is impossible, so a failure here is a
* placement-independent defect, not a congestion artifact.
.subckt INV2X A Y vdd gnd
M0 Y A gnd gnd nmos w=0.65u l=0.15u
M1 Y A gnd gnd nmos w=0.65u l=0.15u
M2 Y A vdd vdd pmos w=1.0u l=0.15u
M3 Y A vdd vdd pmos w=1.0u l=0.15u
.ends INV2X
