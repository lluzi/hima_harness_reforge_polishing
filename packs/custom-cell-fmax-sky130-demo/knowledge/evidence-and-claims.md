# Evidence and claims

## Characterized by HimaHarness (the only cell timing that counts)

HimaHarness characterizes every delivered cell itself on the foundry 7×7 slew/load grid, plus input
capacitance, and writes the Liberty the arms load. A cell gets one of two bases:

- **Mock** — an abstract cell (flow/toolbox/abstract): the MOCK layout and MOCK timing this demo
  uses for volume. The abstract LEF copies foundry pin and rail geometry and is widened by
  transistor width; there is no GDS and no internal wiring. Timing comes from an RC model of your
  sized netlist (stages, worst series resistance per input, node capacitance) with no SPICE, in
  seconds for hundreds of cells. Wherever a foundry arc corresponds (your `compareTo` cell, or the
  `layoutFrom` source of a multi-output cell's output), the table is that foundry table times
  model(your netlist) / model(foundry netlist): an unchanged netlist keeps the foundry timing and a
  2× pull-up changes it by what the model says 2× does. Other arcs use the model alone. Accuracy
  (`flow/toolbox/char/mock-fit.json`), against the calibrated SPICE tables of 227 round-1 cells:
  anchored arcs within 8–13 % at the median entry and 29–48 % at p90, model-only arcs 13–20 % and
  37–50 %; the signed bias at the table middle is −5 % to +4 %; input capacitance 9 % median,
  21 % p90. The model ranks the skew variants of one function the way SPICE does.
- **Measured** — a DRC/LVS-clean layout (flow/toolbox/factory): ngspice on your Magic-extracted
  netlist, sky130 tt 1.8 V 25 °C, calibrated against Magic extractions of 12 foundry cells within
  15 % p90. Minutes per cell; not part of the demo's volume path.

Every cell's Liberty banner, the round report's status column and state/characterization.json say
which a cell is. Also measured, by the Pack Readers from ORFS files:

- Whether the flow uses a cell: instance counts in the custom arm's final routed netlist `6_final.v`.
- ORFS timing, area, power and route DRC of both arms.
- The matched control: same recipe and characterized library, every custom cell forbidden.

## Not characterized

- Cells that fail characterization (a function with no matching stage path in the transistors, a
  netlist that does not parse): excluded from the arms, listed with the reason.
- Your own Liberty, derates and trial numbers: claims, shown beside HimaHarness's numbers.
- An `emap` window without an equivalence log: "function not verified".

## Never claimed

- Signoff, silicon, other corners, or full characterization (no power tables, one corner).
- Tape-out readiness of an abstract cell, or SPICE-accurate or layout-accurate timing of a mock one.
- A gain from a cross-library or cross-clock comparison. Only the round's own control arm counts.

## Claim boundary (shown verbatim in the summary)

> Custom-cell timing is characterized by HimaHarness. DRC/LVS-clean cells are MEASURED: ngspice on the
> Magic-extracted layout, sky130 tt 1.8 V 25 C, calibrated against foundry cells to within 15 % p90.
> Abstract-layout cells (MOCK layout: foundry-derived abstract LEF, no GDS, not tape-out ready) have MOCK
> timing: an RC model of the sized netlist anchored to the foundry tables, no SPICE (mock-fit.json records
> its error). Results are open-source ORFS timing on SKY130 under these models; not signoff, not silicon.
