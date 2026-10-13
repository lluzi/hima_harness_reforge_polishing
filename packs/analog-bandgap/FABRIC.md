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
- **0.2.0, the bgcore case** (2026-10-13). This is the competitor's bandgap case on GF180: a
  120-tap ladder, a BGOK monitor and a 0.2 uA reference on the mirror core. The case is
  `knowledge/bgcore-case.md` and `docs/specs/analog-bandgap-pack/bgcore-case.md`.
  - **Engine and layout.** Built by two workers and checked on the server.
  - **Defects found and fixed on the way:**
    - **Spectre crash.** Spectre 23.1 crashed on every attempt to compile the PDK resistor's code
      in a fresh workspace. The fix: the Site ships `bin/spectre.ahdl-seed/`, and the Pack seeds
      from it.
    - **netgen false alarm.** netgen merged the ladder's series pair before RL0's parallel pair.
      It then reported "match with property errors" for a correct layout. The fix: a tool-owned
      netgen setup that never merges poly resistors in parallel.
  - **Signed off on the Site by hand, the method's first cut with no agent.**
    - Run: 2026-10-13, `analog-runs/bgcore-site-20261013-1145`, Spectre 23.1, a fresh workspace, no Spectre crash.
    - **Corners (30, 64 s).** Every line met at the worst corner:

      | Line | Worst | Corner |
      | --- | --- | --- |
      | VBG | 1.2109 V | ss 3.3 V |
      | IQ | 6.40 uA | ff 2 V |
      | ISD | 0.047 nA | |
      | TC | 22.3 ppm/C | |
      | PM | 70.9 deg | ss 3.3 V -40 C |
      | Start-up | 50.4 us | |
      | PSRR | 49.0 dB | |
      | BGOK | correct | |

    - **Monte Carlo.** N=100: sigma 4.77 mV, mean +/- 3 sigma 1.1908 to 1.2194 V (1.7 s).
    - **Layout.** 228.1 x 252.7 um in 35 s.
      - Magic DRC 0. KLayout block DRC 0, both unfilled and with the PDK's fill.
      - netgen: "Circuits match uniquely", no property errors.
      - KLayout LVS: match, 128/128 pins (the filled GDS too).
      - Density rules: 6 unfilled, 4 with the PDK's fill; die level, reported only.
    - **After layout** (C extraction, 69 s): every line met at every corner (PM 68.3 deg, start-up
      51.4 us).
    - **Round:** signed off, worst margin 13.8 % (PM after layout). The whole chain took 176 s.
- **Independent review of the bgcore slice** (Claude Opus 5.5, 2026-10-13): no Critical findings,
  two Important ones, both fixed with tests.
  - **BGOK checked only two of four states.** A monitor that followed `en` would have passed.
  - **A failed fill stopped a clean layout.**
  - **The fix's result: the design no longer signs off.** BGOK is now also judged in the start-up
    transients: `bgokTrip` requires VBG at 50 % or more of its final value before `bgok` rises. On
    the method's first cut it fails (`analog-runs/bgcore-eng2-20261013-1228`):
    - schematic: trip at 16.5 % of final VBG, at ff 3.3 V 125 C on power-up;
    - after layout: 11.4 %.
    - Cause: `bgok` follows vdd before the bias exists, then stays high while VBG sits near 0.56 V
      at 125 C.
    - The 11:45 sign-off above was under the weaker check. The BGOK monitor needs a redesign.
  - **Monte Carlo claim corrected.** It varies the MOS and the PNPs, never the poly resistors; the
    PDK has no resistor mismatch model.
- **BGOK redesigned, and the case signed off again** (2026-10-13, `analog-runs/bgcore-eng8-20261013-1408`,
  a fresh workspace, the full chain).
  - **The new monitor:** a comparator of `vref_88` against VBE1, with a bias-charged delay.
  - **en-low clamps:** MEN5 and MEN7 hold the OTA output and the start-up node.
  - **Every line before and after layout:**

    | Line | Before layout | After layout |
    | --- | --- | --- |
    | VBG | 1.2109 V | |
    | IQ | 6.39 uA | |
    | ISD | 0.091 nA | 0.134 nA |
    | TC | 22.3 ppm/C | |
    | PM | 70.5 deg | 66.8 deg |
    | Start-up | 62.8 us | 64.7 us |
    | PSRR | 49.0 dB | 48.0 dB |
    | bgokTrip | 61.7 % (ss 2 V 125 C) | 99.7 % |

  - **Monte Carlo:** N=100, sigma 4.78 mV. Spectre crashed in 3 of the 4 chunks; the crashing
    chunks were split, 14 attempts in all.
  - **Layout:** 68,406 um2, DRC 0/0, both LVS match.
  - **Open:**
    - the 70 % trip aim at 2 V 125 C;
    - routing the BGOK nets away from `b`, `d1`, `g` and the tap, which couple about 10 fF each
      after layout.
