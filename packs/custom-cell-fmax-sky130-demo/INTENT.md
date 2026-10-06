## Business

A person wants a faster design on open-source SKY130 and asks HimaHarness for it. The delivery is a
new standard-cell library: the cells a resident OpenCode engineer designs, with HimaHarness's own
timing for every cell and the evidence of where they help. Cell generation is cheap for a resident agent, so a round should try
many ideas (single-output skew and strength variants, fused cells, multi-output cells for shared-input
cones) and let characterization and the flow decide which ones win. HimaHarness characterizes every
cell itself and judges
the library only by a matched ORFS comparison against the stock library at the same clock.

## Golden Flow

1. Bind the ORFS checkout, aes design, sky130hd platform and the pinned container; run the stock
   baseline (synthesis to finish) once.
2. Each round, the resident engineer reads the lessons and the best library so far, analyses the
   critical paths, and builds hundreds of cells in seconds as abstract cells (bool2cmos netlist with
   a sizing variant and a MOCK layout: abstract LEF from foundry pin geometry); multi-output cells
   enter through `emap` window remapping.
3. HimaHarness characterizes every cell in seconds with MOCK timing (an RC model of the sized netlist
   anchored to the foundry tables, no SPICE); only this Liberty enters the arms, each cell labelled.
4. Two matched ORFS arms run in parallel: custom cells allowed versus the same library with every
   custom cell forbidden. A Reader computes the matched Fmax gain and adoption from ORFS files.
5. The round's lessons (adopted and unused cells, HimaHarness versus claimed timing, remaining top
   paths) feed the next round. The Campaign ends at the Goal, after two rounds that add nothing, or
   at the round limit.

## Answers

- Tool path: open-source SKY130 on linglong (IIC-OSIC-TOOLS image), no commercial tool or licence.
- Layout and cell timing are mocked (user, 2026-10-05: "mock the library and layout, like ... the
  tsmc28nm aes dtco pack, save some time"; 2026-10-06: "mock the lclayout, and library char, i need
  to show our dtco flow pack works"): abstract LEFs stand in for LibreCell layout, and HimaHarness's
  own MOCK characterization (RC model anchored to foundry tables, error recorded in mock-fit.json)
  stands in for ngspice. The SPICE characterizer and the factory stay in the toolbox for a measured
  study. The engineer's own Liberty is only a claim shown beside HimaHarness's.
- Multi-output cells: built like any other cell and mapped by `emap` on critical windows; the control
  arm runs the same remap with the custom cells removed.
- Goal: at least 5 % matched Fmax gain over the stock control arm at the same clock (default).
- Breadth: no small cap on new cells per round; the round report covers every cell.

## Ambiguities resolved

- "Faster" means Fmax = 1000 / (period − worst setup slack) at ORFS finish, compared only between the
  two arms of the same round, never across libraries or clocks.
- An abstract cell (mock layout) enters the arms with MOCK timing, never presented as measured;
  every Liberty banner, report row and the claim boundary say which cells are mock.
- The mock must not favour custom cells: wherever a foundry arc corresponds, a custom table is the
  foundry table scaled by the model's ratio, so an unchanged netlist keeps foundry timing.
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
  17–31 %) but took 26 min for 227 cells in run-b38106d8; the mock takes 3 s, with a table-middle
  bias of −5 % to +4 % against those SPICE tables.
- TSMC28 aes DTCO Pack: abstract cells with real size and legal pins, and a learned
  characterization model instead of SPICE; "fairness is part of correctness" when generated cells
  compete with foundry cells.
- EPFL `emap` (Tempia Calvino, De Micheli): multi-output global mapping mostly saves area; use local
  windows on critical cones. A first 122-cell window on aes made timing worse because the worst path
  moved outside it.
