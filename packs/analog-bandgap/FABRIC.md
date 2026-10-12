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
- R+C extraction of the bandgap (about 10.7k resistors) is clean in layout but Spectre 23.1
  segfaults on it at every retry (`analog-runs/bg-site-check3-rc-20261012`); the post-layout default
  is C extraction (`pex: c`). Reducing the R network (merging the PNP emitter-plate mesh) is the next step.
- Spectre 23.1 crashed on the server in three reproducible ways; the flow works around them (a
  seeded AHDL cache, one cell copy per transient netlist, a 10 fF node floor) and retries a crashed
  run up to five times, recording the attempts. Root cause unknown.

## Reviews

- Engine by a worker (2026-10-12) on the server, Spectre on GF180MCU: the direct-drive template
  fails the sheet in three rounds; the mirror template's first cut meets every line at every corner
  (worst: VBG 1.2105 V, IQ 7.61 uA, TC 19.6 ppm/C, PM 77.5 deg, start-up 70.8 us, PSRR 55.8 dB) and
  Monte Carlo (sigma 4.75 mV, mean +/- 3 sigma 1.1910 to 1.2195 V); the Pelgrom step predicts sigma
  4.0 mV, Spectre measures 3.63 mV. Evidence on the server: `analog-sim-01/bg-probe/`.
- Independent review (Claude Opus 5.5, 2026-10-12) of the engine and the layout tool: 20 findings
  (3 critical: post-layout cell not bound to the design's clean layout, post verdict trusted, layout
  tool exit codes and stale outputs), all fixed with tests (commit 6ce02bc1); the dry path and the
  Site run below are after the fixes.
- Signed off on the Site by hand (2026-10-12, `analog-runs/bg-site-check2-20261012`, Spectre 23.1,
  GF180MCU, the method's first cut with no agent changes): every corner (30, 79 s) worst VBG
  1.2108 V, IQ 6.39 uA, ISD 0.033 nA, TC 21.6 ppm/C, PM 75.7 deg, start-up 71.3 us, PSRR 53.3 dB;
  Monte Carlo N=100 sigma 4.79 mV, mean +/- 3 sigma 1.1909 to 1.2196 V (1.5 s); layout 201.0 x 203.5
  um, DRC 0 on both decks, netgen and KLayout LVS match (17.7 s); after layout (C extraction) every
  line met at every corner (PM 73.8 deg, start-up 42.5 us; 80 s); round recorded signed off.
