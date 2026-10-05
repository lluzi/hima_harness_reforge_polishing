# Evidence and claims

## Measured by HimaHarness (the only numbers that count)

- Every DRC/LVS-clean custom cell's timing: HimaHarness extracts nothing itself, it simulates the
  Magic-extracted netlist you deliver with ngspice (sky130 tt, 1.8 V, 25 °C) on the foundry 7×7
  slew/load grid, plus input capacitance, and calibrates the method per edge against foundry cells
  extracted and simulated the same way (calibration residual within 15 % p90). This measured
  Liberty is the only custom timing the measured arms load.
- Whether the flow uses a cell: instance counts in the custom arm's final routed netlist `6_final.v`.
- ORFS timing, area, power and route DRC of both arms, read by the Pack Readers from ORFS files.
- The matched control: same recipe and measured library, every custom cell forbidden.

## Not measured

- Cells without a DRC/LVS-clean layout and an extracted netlist ("abstract"): excluded from the
  arms, listed with the reason.
- Your own Liberty, derates and trial numbers: claims, shown beside the measurement.
- An `emap` window without an equivalence log: "function not verified".

## Never claimed

- Signoff, silicon, other corners, or full characterization (no power tables, one corner).
- A gain from a cross-library or cross-clock comparison. Only the round's own control arm counts.

## Claim boundary (shown verbatim in the summary)

> Custom-cell timing is SPICE-characterized by HimaHarness from each cell's Magic-extracted layout
> (ngspice, sky130 tt 1.8 V 25 C, calibrated against foundry cells to within 15 % p90), not signed
> off; only DRC/LVS-clean cells are measured and used. Results are open-source ORFS timing on SKY130
> under these measured models; not signoff, not silicon.
