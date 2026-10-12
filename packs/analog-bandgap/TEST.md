# Tests

Real PDKs are installed per Site and never in git. The tests run the Pack's steps on a synthetic
process (`test/fixtures/analog-pdks/synth180/`: BSIM4 transistors, a made-up PNP and poly resistor).

- `test/contract/analog-bandgap.test.ts` (group `local`, no simulator): the drift guard (the two
  `ota_cli.py` copies are byte-identical); cell and bench netlist shapes for both templates; the
  measurements recomputed in the test from recorded Spectre output (VBG, currents, TC, loop phase
  margin against a known loop, start-up, PSRR, Monte Carlo statistics); the first-cut equations; the
  refusals; the Pelgrom step; the SHA binding.
- `test/contract/analog-bandgap-pack.test.ts` (group `local`): the Pack loads at stage compiled with
  the eight Goal lines; the graph's judges and edges; every argv name bound; the strip places every
  node; the harness's own `choose` on `bg-next`; the Readers on records the flow writes; the layout
  step and the round record on a stand-in layout tool (sign-off only when every stage passes; a
  post-layout result of another layout is refused).
- `test/contract/analog-bandgap-sim.test.ts` (group `analog-sim`, real ngspice): characterization,
  the PVT set end to end on the synthetic process for both templates, ngspice against the committed
  Spectre output on the same cell.
- On the Site by hand (Spectre, GF180MCU; evidence in the FABRIC record).
