# Evidence and claims

## Characterized by HimaHarness (the only cell timing that counts)

HimaHarness simulates every delivered cell itself with ngspice (sky130 tt, 1.8 V, 25 °C) on the
foundry 7×7 slew/load grid, plus input capacitance, and writes the Liberty the arms load. Each path
is calibrated per quantity against foundry cells prepared the same way, within 15 % p90:

- **Measured** — a DRC/LVS-clean layout: HimaHarness simulates your Magic-extracted netlist;
  calibrated against Magic extractions of 12 foundry cells.
- **Modelled** — an abstract layout (flow/toolbox/abstract): HimaHarness simulates your pre-layout
  netlist with its own parasitic estimate (diffusion area and perimeter as in the foundry
  extractions, wiring capacitance per terminal, more on the inputs of bigger cells); calibrated
  against the 12 foundry cells' schematics with the same estimate. The abstract LEF copies foundry
  pin and rail geometry and is widened by transistor width; there is no GDS and no internal wiring.

Every cell's Liberty banner, the round report's status column and state/characterization.json say
which of the two a cell is. Also measured, by the Pack Readers from ORFS files:

- Whether the flow uses a cell: instance counts in the custom arm's final routed netlist `6_final.v`.
- ORFS timing, area, power and route DRC of both arms.
- The matched control: same recipe and characterized library, every custom cell forbidden.

## Not characterized

- Cells that fail characterization (a function that does not match the transistors, a netlist that
  does not simulate): excluded from the arms, listed with the reason.
- Your own Liberty, derates and trial numbers: claims, shown beside HimaHarness's numbers.
- An `emap` window without an equivalence log: "function not verified".

## Never claimed

- Signoff, silicon, other corners, or full characterization (no power tables, one corner).
- Tape-out readiness of an abstract cell, or layout-accurate timing of a modelled one.
- A gain from a cross-library or cross-clock comparison. Only the round's own control arm counts.

## Claim boundary (shown verbatim in the summary)

> Custom-cell timing is SPICE-characterized by HimaHarness (ngspice, sky130 tt 1.8 V 25 C, calibrated
> against foundry cells to within 15 % p90): MEASURED from the Magic-extracted layout for DRC/LVS-clean
> cells, MODELLED from the pre-layout netlist plus a parasitic estimate for abstract-layout cells
> (foundry-derived abstract LEF, no GDS, not tape-out ready). Results are open-source ORFS timing on
> SKY130 under these models; not signoff, not silicon.
