## Business

A person wants a faster design on open-source SKY130 and asks HimaHarness for it. The delivery is a
new standard-cell library: the cells a resident OpenCode engineer designs, with HimaHarness's own
timing for every cell and the evidence of where they help. Cell generation is cheap for a resident agent, so a round should try
many ideas (single-output skew and strength variants, fused cells, multi-output cells for shared-input
cones) and let measurement decide which ones win. HimaHarness measures every cell itself and judges
the library only by a matched ORFS comparison against the stock library at the same clock.

## Golden Flow

1. Bind the ORFS checkout, aes design, sky130hd platform and the pinned container; run the stock
   baseline (synthesis to finish) once.
2. Each round, the resident engineer reads the lessons and the best library so far, analyses the
   critical paths, and builds hundreds of cells in seconds as abstract cells (bool2cmos netlist with
   a sizing variant, abstract LEF from foundry pin geometry), or real layouts with the cell factory
   where it wants them; multi-output cells enter through `emap` window remapping.
3. HimaHarness characterizes every cell with ngspice, calibrated against foundry cells: modelled from
   the pre-layout netlist for abstract cells, measured from extraction for clean layouts; only this
   Liberty enters the arms, each cell labelled.
4. Two matched ORFS arms run in parallel: custom cells allowed versus the same library with every
   custom cell forbidden. A Reader computes the matched Fmax gain and adoption from ORFS files.
5. The round's lessons (adopted and unused cells, HimaHarness versus claimed timing, remaining top
   paths) feed the next round. The Campaign ends at the Goal, after two rounds that add nothing, or
   at the round limit.

## Answers

- Tool path: open-source SKY130 on linglong (IIC-OSIC-TOOLS image), no commercial tool or licence.
- Cell timing: characterized by HimaHarness (ngspice, tt 1.8 V 25 °C, calibrated per quantity against
  foundry cells within 15 % p90): modelled from the pre-layout netlist for abstract cells (user,
  2026-10-05: mock the library and layout as in the TSMC28 aes DTCO Pack, to save time), measured
  from extraction for clean layouts. The engineer's own Liberty is only a claim shown beside it.
- Multi-output cells: built like any other cell and mapped by `emap` on critical windows; the control
  arm runs the same remap with the custom cells removed.
- Goal: at least 5 % matched Fmax gain over the stock control arm at the same clock (default).
- Breadth: no small cap on new cells per round; the round report covers every cell.

## Ambiguities resolved

- "Faster" means Fmax = 1000 / (period − worst setup slack) at ORFS finish, compared only between the
  two arms of the same round, never across libraries or clocks.
- An abstract cell (no layout) enters the arms with modelled timing, never presented as measured;
  every Liberty banner, report row and the claim boundary say which cells are modelled.
- A harder clock alone is never credited: the control arm is re-measured at the round's clock.
- The engineer's trial numbers are claims; HimaHarness never uses them as results.

## Knowledge applied

- celluzi July 2026: matched arms only; ORFS is σ = 0 deterministic; NOR3_PU2 adopted 14× with a
  modelled Liberty; fused cells stranded without drive variants; invalid-control trap of
  DONT_USE_CELLS on the make command line.
- Measured 2026-10-04 on linglong (same ngspice testbench, extracted layouts): NOR3_PU2 rises 0.56–
  0.72× nor3_1 but falls 1.05–1.21× slower with +44–70 % input capacitance, and against nor3_2 it is
  a trade-off cell (5–11 % faster rise, 21 % less input capacitance, 44–71 % slower fall). Derates
  hide these costs, which is why only SPICE-characterized Liberty may enter the arms.
- Measured 2026-10-04/05: factory layouts of 149 cells failed router pin access (DRT-0073) and,
  after a fix, detailed route; abstract LEFs with foundry pin geometry avoid both. Pre-layout SPICE
  with a parasitic estimate reproduces the foundry tables within 13.3 % p90 (flat factors alone:
  17–31 %).
- EPFL `emap` (Tempia Calvino, De Micheli): multi-output global mapping mostly saves area; use local
  windows on critical cones. A first 122-cell window on aes made timing worse because the worst path
  moved outside it.
