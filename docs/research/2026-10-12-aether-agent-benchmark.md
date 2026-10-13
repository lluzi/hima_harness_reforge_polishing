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
| Layout | a different reference cell | the sized cell: 201 x 204 um, block DRC 0 on two decks (Magic, KLayout), LVS match on two checks; 6 die-level minimum-density hits reported (they need metal fill), as in their 95 |
| After layout | none | every line met at every corner again (C extraction) |
| Who decided | the agent | Readers and judges outside the agent, bound to the design's SHA-256 |
| Wall time | ~17 min sizing + 2 min layout | ~3 min for the whole check chain |

The competitor's numbers are their own circuit at one corner, on a foundry PDK; ours are a different
sizing on an open PDK. The comparison is coverage and who decides, not the values. The agent's part
(the App run with the resident design agent) is the next step.

## Three more recordings, read frame by frame (2026-10-13)

The user shared three more silent screen recordings. As before, their foundry process, PDK cell
names, user accounts, host and library names are left out of this note.

| Recording | Length | What it is |
| --- | --- | --- |
| A | 16 min, real time | One full bandgap run on Oct 12, 17:02 to 17:18 |
| B | 1 min, edited | Three sessions from three days and three users, spliced into one reel |
| C | 2 min, real time | The output-buffer layout run from the first video, Oct 11 |

### What the bandgap run does (recording A)

1. **Input and approvals.** The prompt is one line: "generate a bandgap-core front-end circuit".
   - The agent reads a prepared IP package: `topology.md`, `interface.yaml` and `metrics.yaml`. The
     topology, pins and specs all come from that package.
   - It explains the plan, and the person types "continue". Nobody touches the screen again until
     the run ends.
2. **Execution.** Each stage is one call to the same script, `run_fullflow.sh --from N --to N`:

   | Stage | Time | What it produced |
   | --- | --- | --- |
   | Schematic and stability variant | 31 s | 46 devices, 30 nets, 345 wires; "0 errors, 6 warnings" left unaddressed |
   | Testbenches | 18 s | Two testbenches |
   | Simulation platform and baseline | 5 min 57 s | Platform with 8 tests; about 3.5 min shows nothing on screen |
   | Optimizer: differential evolution, then pattern search | 4 min 12 s | 14 variables, 134 evaluations, about 1.9 s each, run headless |
   | Write-back and re-run | 2 min 1 s | Sizes written back, platform re-run |

   Total: about 15 min, on a local Qwen3.8 27B model.
3. **Conditions simulated.** One condition, 27 °C, typical process.
   - The Corner Setup tab is never opened, and Min = Max = Nominal in every result row.
   - TC is a box over three temperatures.
   - There are no process corners and no Monte Carlo.
4. **Results.** The final values are the same as in the first video: VBG 1.2015 V at 3.3 V and
   1.1843 V at 2.0 V, IQ 2.89 µA, TC 95.2 ppm/°C, PM 64.95°. The margins are thin even at that one
   condition:
   - VBG at 2.0 V sits 8 mV inside its limit;
   - TC is 4.8 % inside its limit;
   - PSRR fell from 49.2 to 46.4 dB, and the agent does not mention it;
   - the bias transistors sit at the minimum width the optimizer allowed.
5. **Who judges.** The pass/fail column belongs to the vendor's simulation platform, but the
   agent's script wrote the limits and the measurement expressions.
   - **The final table marks the fast start-up time as −48.88 ns, a pass against "< 100 µs".** The
     expression is the first crossing of VBG at 1.176 V minus the crossing of EN at 1.65 V, so a
     negative time means VBG crossed the threshold before EN reached the trigger. Nobody flags it.
   - The agent's own counts disagree with its tables: "4 hard specs fail" with 5 listed, and "11
     items pass" with 10 rows.
6. **Not done:** no layout, DRC, LVS, extraction or post-layout simulation of this bandgap.

### What the layout run does (recording C)

- **The run.** The prompt is "draw the layout of" the output-buffer cell, which already exists in a
  reference library. The flow replays it:
  - it mounts the stored reference layout;
  - then it wipes, realizes from the schematic, aligns 13 groups and routes;
  - the pass rule is a zero difference from the reference: 557/557 shapes and 323/323 vias.
- **Sign-off.** The vendor's sign-off tool reports **LVS PASS**, with the warning "Unequally merged
  mosfets were matched".
  - DRC reports **95 violations over 16 rules**, so the layout is not DRC-clean. The agent waives
    them as "identical to the golden baseline, chip-level false alarms".
  - The DRC report is never shown.
  - There is no extraction and no post-layout simulation.
- **Size and time.** The cell is 68.4 × 29.7 µm with 8 nets, and the run takes about 2 min.

### What the edited reel shows (recording B)

The 1-minute reel joins three separate sessions:

| Part | When and who | What it shows | How it is cut |
| --- | --- | --- | --- |
| Bandgap run | Oct 12, one user | The front-end run from prompt to re-simulation | About 8 min cut, then roughly 40× time-lapse during the optimizer |
| Layout run | Oct 11, another user | The output-buffer layout from recording C | |
| Top-level layout | Oct 13, a third user | The agent opening a top-level layout and an LVS report | |

The last part's LVS report was made on Oct 12 by a fourth person, so the agent only opens files. The
reel reads as "front end, then layout, then top-level LVS", but none of the three parts uses the
bandgap from the first. Only the desktop clock shows the dates.

### What this changes for our demo

**Where they are stronger:**
- **In the vendor's tools.** The agent draws real cellviews in the vendor's editor and builds a
  native simulation platform with colour-coded pass/fail tables.
- **Simple to drive.** A one-word approval is enough, there is a stage chart, and every result has
  a baseline-versus-final table.
- **Built-in optimizer.** It runs about 2 evaluations per second, with area as part of the
  objective.
- **Fast.** About 15 min from prompt to a sized schematic.

The App run should match these on screen: a stage strip, a baseline-versus-final table, and the
live round.

**What we lead with**, all on one cell in one continuous take with an honest clock:
- **30 PVT corners and 100-run Monte Carlo**, judged outside the agent.
- **A refusal shown on screen.** When the agent claims a pass, the judge checks it and refuses
  wherever a line fails at some corner.
- **Layout of the cell we sized,** with block DRC 0 on two decks rather than 95 waived violations, LVS
  matched on two checks, and a post-layout re-check at every corner.
- **A start-up metric that is hard to fool.** It measures entry into ±2 % of the final value and
  staying there, and it refuses a final value off the DC solution. A first threshold crossing does
  not count.

**Fair limits on our side:**
- Both flows start from a given topology.
- Our start-up metric clamps an early entry to 0 µs rather than flagging it.
- Our agent has not yet driven the run in the App.

**A useful extra panel: what one condition hides.** Size a cut that just meets the sheet at
nominal, with margins like theirs, then show the same design failing lines across the 30 corners
and Monte Carlo. This uses our own PDK and design; we cannot run their design.

### Correction (2026-10-13): what "DRC 0" covered

Our signed-off layout (2026-10-12) had 0 errors on the block rules of both decks (Magic, and the PDK's
KLayout deck). The PDK's die-level minimum-density deck reported 6 hits (one per metal layer). Only
metal fill clears those, and the Pack records them without judging them. The competitor's 95
include the same 6 density hits, so the fair comparison is block rules: 0 against 89. The next step
runs the PDK's own fill scripts, so that density is judged as well.

## The same case, measured (2026-10-13)

The bgcore case is their case from the recordings: the same blocks, pins, bias, spec sheet and test
conditions, on GF180MCU with 3.3 V devices
([case](../specs/analog-bandgap-pack/bgcore-case.md)). The Pack's chain signed it off on the lab
Site in Spectre 23.1, in 176 s from a fresh workspace. It ran the method's first cut, by hand, with
no agent yet.

| | Aether Agent (recording, 27 C typical only) | HimaHarness, bgcore on GF180 (worst of 30 corners) |
| --- | --- | --- |
| VBG at 3.3 V / 2.0 V | 1.2015 / 1.1843 V (8 mV inside the band) | worst 1.2109 V anywhere (band 1.176-1.224) |
| IQ | 2.89 uA | 6.40 uA |
| ISD | 0.162 nA | 0.047 nA |
| TC | 95.2 ppm/C (3 temperatures) | 22.3 ppm/C (5 C sweep) |
| Phase margin | 64.95 deg | 70.9 deg; 68.3 deg after layout |
| Start-up | -48.88 ns marked pass; 29.6 us slow edge | 50.4 us worst over the 1 us edge, the 50 us edge and power-up |
| PSRR at 1 kHz | 46.4 dB, recorded only | 49.0 dB, judged |
| BGOK | not judged | judged at every corner |
| Monte Carlo | none | 100 runs, sigma 4.77 mV, every run in the band |
| Layout | none of this cell (a reference replay of another cell: 95 DRC violations waived) | this cell: 228 x 253 um, block DRC 0, LVS match on 128 pins in two tools |
| After layout | none | every line at every corner again |
| Who judged | the agent's script wrote limits and expressions | Readers outside the agent; every result bound to the design's SHA-256 |
| Wall time | about 15 min, prompt to nominal re-simulation | 176 s for the whole check chain; the agent's sizing time is not yet measured |

**Fair limits on this comparison:**
- Their IQ is lower, at one condition. Ours is the worst corner at 2 V, ff, within the 8 uA line.
- Their 5 V native-input process differs from our 3.3 V open PDK.
- Our agent has not sized this case in the App yet.
