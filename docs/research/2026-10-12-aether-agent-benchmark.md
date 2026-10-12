# Benchmark: the Aether Agent analog video, and how our demo beats it (2026-10-12)

The user shared a 28-second sped-up video of Empyrean's **Aether Agent** ("AI Agent for Analog Circuit
Design", v0.19.0, a local Qwen3.8 27B model) and said "we need to beat this". This note records what
the video shows, read frame by frame, and the plan. Their foundry PDK, account and cell names are
left out on purpose.

## What the video shows

1. **Spec to sized bandgap, in about 17 minutes of wall time** (desktop clock 16:07 to 16:24).
   - The prompt: "generate a bandgap-core front-end circuit". The agent reads an IP package: `metrics.yaml`,
     `topology.md` and `interface.yaml`.
   - It explains the circuit: the core, start-up, a 120-tap divider and a ready monitor. It lists 11
     specs: VBG 1.2 V ±2 % at 3.3 V and 2.0 V, IQ < 8 µA, ISD ≤ 2 nA, TC < 100 ppm/°C (−40 to
     125 °C), PM > 60°, start-up < 100 µs on fast and slow ramps, and PSRR observed only. It then
     plans five stages.
   - It draws the schematic in the vendor's schematic editor: 45 devices, 29 nets and 340 wires. It
     also builds a stability variant, two testbenches and an MDE simulation platform with 8 tests.
   - In the baseline simulation, 4 hard specs fail: VBG 1.076 V, TC 481 ppm/°C, PM 52.8°, and fast
     start-up never fires.
   - It optimizes 14 variables by differential evolution, then a pattern search. The budget is 180
     evaluations, and it converges after 134.
   - All specs pass: VBG 1.2015 V and 1.1843 V, TC 95.2 ppm/°C, PM 64.95°. It writes the 43 sizes
     back and re-reads them 43/43.
2. **Layout in about 2 minutes** (another day and another account).
   - The prompt: "draw the layout of" an output-buffer cell. This is a different cell, built from a reference
     design.
   - The steps: wipe, realize (332 instances), align (13 groups, residual 0), route (701 shapes, 323
     vias), then Argus sign-off.
   - The **LVS report shows PASS** with the warning "Unequally merged mosfets were matched". All 9
     tasks show green.

## Where it is strong, and where it is open

**Strong:**
- It drives a real vendor GUI on screen: schematic, simulation platform and layout.
- It uses a foundry PDK.
- The circuit is a real one, with 45 devices and 11 specs.
- It goes all the way to layout and LVS.
- It runs on a local model.

**Open (read from the frames):**

- **One corner only.** The MDE results use Nominal Setup, and Min = Max in every row. The Corner
  Setup tab is unused. Every test runs at 27 °C except the TC sweep. There is no Monte Carlo, yet a
  ±2 % VBG spec is dominated by mismatch.
- **The agent marks its own work.** The final pass table is the agent's own chat text. The optimizer,
  the write-back check and the verdict all live inside the same agent.
- **The layout is not of the circuit they sized.** It is a template APR of a reference cell. The video
  shows no extraction and no post-layout re-simulation, and the LVS pass carries a matching warning.
- **No migration**, no saved lessons, and no budget or Goal outside the agent.

## How we beat it: match the headline, then do what it cannot

| | Aether Agent (video) | HimaHarness now | HimaHarness demo v2 |
| --- | --- | --- | --- |
| Circuit | Bandgap, 45 devices, 11 specs | Two-stage OTA, 4 specs | **Bandgap with the same kind of spec sheet** (GF180MCU ships PNPs; the OTA becomes its amplifier) |
| Sizing | DE then pattern search, 134 evaluations | gm/Id first cut plus agent re-bias, about 10 Spectre runs | Method-first, plus an optimizer step the agent seeds; we show the simulation count |
| Corners | Nominal, 27 °C | tt/ss/ff | **PVT** (process × −40/27/125 °C × ±10 % supply) **plus Monte Carlo mismatch**; both PDKs ship statistical models |
| Who says pass | The agent | Independent Readers and judges, bound to the design's SHA | The same, plus an on-screen refusal: the agent says done, and the judge sends it back on a failing corner |
| Layout | A different cell, template APR, LVS pass | None | **The layout of the cell we sized**, with KLayout DRC and LVS using the PDK's own decks, extraction, and **post-layout Spectre** at the worst corners |
| Second process | None | GF180MCU → IHP SG13G2 | Kept as act 2 |
| Method | Inside the agent | Tested Pack code plus playbooks | The same, re-run on the second process |

The framing for leadership: the Aether Agent is an *agent*, and HimaHarness is the *OS that runs
agents*. It could run the Aether Agent itself, with outside verification, corners, budget and
lessons.

## Checked on the lab server (read-only, 2026-10-12)

- **Cadence:** Virtuoso (IC 23.1), PVS 24.1, Quantus 23.1, Assura and Spectre 23.1 are installed.
  The open PDKs ship no OpenAccess or PVS decks, so the open decks do layout sign-off. Spectre stays
  the measuring simulator.
- **GF180MCU (`sm141064.spice`):** process corners tt/ff/ss/fs/sf; a `statistical` section with
  `fets_mm` mismatch; `bjt_mc` with PNPs `pnp_05p00x05p00` and `pnp_10p00x10p00`; and a KLayout tech
  folder.
- **IHP SG13G2:** per-device mismatch and statistical model files (MOS, HBT, resistors,
  capacitors); a KLayout LVS deck (`sg13g2.lvs`, `run_lvs.py`) and DRC; extraction rule decks
  (`libs.tech/parasitics`); and IHP's gdsfactory cells.
- **The resident image:** KLayout, Magic, netgen, xschem and gdsfactory 9.44. gLayout is not
  installed.

## Plan and gates

1. **Local, no approval needed.**
   - A bandgap template in the Pack: core, start-up and the OTA as its amplifier.
   - Its Readers: VBG, IQ, TC, PM, start-up, PSRR.
   - PVT and Monte Carlo corner sets in the testbench.
   - Spectre checks on the server, one job at a time in a temporary directory: the GF180 PNP and
     statistical sections, and the IHP HBT/PNP models.
2. **Site `analog_sim_01`.** Needs the user's approval for server writes under our project area.
3. **Layout slice:**
   - a gdsfactory/pcell generator for the sized cell;
   - KLayout DRC and LVS, then extraction, then post-layout Spectre;
   - Readers for each step.
   Analog layout quality (matching, common centroid) is the largest risk, and the fallback is a
   placed-and-routed cell that passes DRC and LVS.
4. **App run on Catsights, then the recording.** Reported before any take.

Comparisons stay honest. We show our own simulation count and corner coverage. We do not claim
"faster than Aether" across different circuits and PDKs.

## Measured, 2026-10-12 (branch `demo/analog-ota`)

On the lab server, with Cadence Spectre 23.1 and the open GF180MCU PDK, the `analog-bandgap`
Pack's tool chain signed off a bandgap on the Pack method's first cut. These are the Pack's own
steps run by hand; no agent was involved yet.

| | Aether Agent (video) | HimaHarness, measured |
| --- | --- | --- |
| Corners judged | 1 (nominal, 27 C) | 30 (5 process x 3 temperatures x 2 supplies), worst of each line |
| VBG | 1.2015 V / 1.1843 V | worst 1.2108 V over every corner (band 1.176-1.224) |
| IQ | 2.89 uA | 6.39 uA worst corner (< 8) |
| TC | 95.2 ppm/C | 21.6 ppm/C worst corner (< 100) |
| Phase margin | 64.95 deg | 75.7 deg worst corner (> 60), every crossing |
| PSRR at 1 kHz | observed only | 53.3 dB worst corner, judged (> 40) |
| Monte Carlo | none | 100 runs, sigma 4.79 mV, mean +/- 3 sigma inside +/- 2 % |
| Layout | a different reference cell | the sized cell: 201 x 204 um, DRC 0 on two decks, LVS match on two checks |
| After layout | none | every line met at every corner again (C extraction) |
| Who decided | the agent | Readers and judges outside the agent, bound to the design's SHA-256 |
| Wall time | ~17 min sizing + 2 min layout | ~3 min for the whole check chain |

The competitor's numbers are their own circuit at one corner, on a foundry PDK; ours are a different
sizing on an open PDK. The comparison is coverage and who decides, not the values. The agent's part
(the App run with the resident design agent) is the next step.
