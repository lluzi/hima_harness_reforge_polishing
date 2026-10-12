## Files written

- `contract.yml` (0.1.0; Goal: eight spec lines; strategy: Monte Carlo runs, extraction, round
  counter; results: schematic vs after layout at the worst corner, headline `worst_margin_pct`),
  `graph.yml` (strip: simulator and judges, design agent, layout and checks), `semantics.yml`.
- `flow/bg_cli.py` (the bandgap flow on `flow/ota_cli.py`, a byte-identical copy of the OTA Pack's
  simulator adapters), `flow/pdks.json` (cards `synth180`, `gf180mcuD`).
- `tools/read-{tables,design,measure,mc,layout,round}.py` with `readers/bg-*.yml`; `rules/*.yml`
  (six); `choosers/bg-next.yml`; `knowledge/*.md` (four).
- Outside the Pack: `sites/analog_sim_01/layout/` (the Site's layout tool), the synthetic fixtures,
  the Spectre fixtures in `test/fixtures/analog-bandgap/`, the tests in `test/contract/analog-bandgap*`.

## Gaps

- One template, one PDK (GF180MCU); no trimming; Monte Carlo covers mismatch at one corner.
- Layout is a basic placement (common-centroid PNPs, interleaved input pair with poly dummies); no
  resistor or mirror interdigitation; die-level density fill is out of scope.
- Spectre 23.1 crashed on the server in three reproducible ways; the flow works around them (a
  seeded AHDL cache, one cell copy per transient netlist, a 10 fF node floor) and retries a crashed
  run up to five times, recording the attempts. Root cause unknown.

## Reviews

- Engine by a worker (2026-10-12) on the server, Spectre on GF180MCU: the direct-drive template
  fails the sheet in three rounds; the mirror template's first cut meets every line at every corner
  (worst: VBG 1.2105 V, IQ 7.61 uA, TC 19.6 ppm/C, PM 77.5 deg, start-up 70.8 us, PSRR 55.8 dB) and
  Monte Carlo (sigma 4.75 mV, mean +/- 3 sigma 1.1910 to 1.2195 V); the Pelgrom step predicts sigma
  4.0 mV, Spectre measures 3.63 mV. Evidence on the server: `analog-sim-01/bg-probe/`.
- Independent review of the engine and the layout tool: pending.
