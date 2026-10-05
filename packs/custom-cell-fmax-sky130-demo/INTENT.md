## Business

A person wants a faster design on open-source SKY130 and asks HimaHarness for it. The delivery is a
new standard-cell library: the cells a resident OpenCode engineer designs, with measured timing and
the evidence of where they help. Cell generation is cheap for a resident agent, so a round should try
many ideas (single-output skew and strength variants, fused cells, multi-output cells for shared-input
cones) and let measurement decide which ones win. HimaHarness measures every cell itself and judges
the library only by a matched ORFS comparison against the stock library at the same clock.

## Golden Flow

1. Bind the ORFS checkout, aes design, sky130hd platform and the pinned container; run the stock
   baseline (synthesis to finish) once.
2. Each round, the resident engineer reads the measured lessons and the best library so far, analyses
   the critical paths, and builds cells in volume with the cell factory (bool2cmos, LibreCell, DRC,
   LVS, Magic extraction, LEF); multi-output cells enter through `emap` window remapping.
3. HimaHarness characterizes every DRC/LVS-clean extracted cell with ngspice, calibrated against
   foundry reference cells in the same testbench; only this measured Liberty enters the arms.
4. Two matched ORFS arms run in parallel: custom cells allowed versus the same library with every
   custom cell forbidden. A Reader computes the matched Fmax gain and adoption from ORFS files.
5. The round's lessons (adopted and unused cells, measured versus claimed timing, remaining top
   paths) feed the next round. The Campaign ends at the Goal, after two rounds that add nothing, or
   at the round limit.

## Answers

- Tool path: open-source SKY130 on linglong (IIC-OSIC-TOOLS image), no commercial tool or licence.
- Cell timing: measured by HimaHarness from extracted layout (ngspice, tt 1.8 V 25 °C, calibrated per
  edge against foundry cells); the engineer's own Liberty is only a claim shown beside it.
- Multi-output cells: built like any other cell and mapped by `emap` on critical windows; the control
  arm runs the same remap with the custom cells removed.
- Goal: at least 5 % matched Fmax gain over the stock control arm at the same clock (default).
- Breadth: no small cap on new cells per round; the round report covers every cell.

## Ambiguities resolved

- "Faster" means Fmax = 1000 / (period − worst setup slack) at ORFS finish, compared only between the
  two arms of the same round, never across libraries or clocks.
- A cell without a DRC/LVS-clean layout and an extracted netlist cannot be measured, so it does not
  enter the arms; it is listed as excluded with the reason.
- A harder clock alone is never credited: the control arm is re-measured at the round's clock.
- The engineer's trial numbers are claims; HimaHarness never uses them as results.

## Knowledge applied

- celluzi July 2026: matched arms only; ORFS is σ = 0 deterministic; NOR3_PU2 adopted 14× with a
  modelled Liberty; fused cells stranded without drive variants; invalid-control trap of
  DONT_USE_CELLS on the make command line.
- Measured 2026-10-04 on linglong (same ngspice testbench, extracted layouts): NOR3_PU2 rises 0.56–
  0.72× nor3_1 but falls 1.05–1.21× slower with +44–70 % input capacitance, and against nor3_2 it is
  a trade-off cell (5–11 % faster rise, 21 % less input capacitance, 44–71 % slower fall). Modelled
  derates hide these costs, which is why only measured Liberty may enter the arms.
- EPFL `emap` (Tempia Calvino, De Micheli): multi-output global mapping mostly saves area; use local
  windows on critical cones. A first 122-cell window on aes made timing worse because the worst path
  moved outside it.
