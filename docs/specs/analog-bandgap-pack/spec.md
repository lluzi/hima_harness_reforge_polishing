# Analog bandgap Pack: spec to sized, corner- and Monte-Carlo-verified, laid-out bandgap

Status: plan accepted by the main agent on 2026-10-12. The user said "we need to beat this!" about
the Aether Agent video
([benchmark](../../research/2026-10-12-aether-agent-benchmark.md)), and went ahead with the plan and
with server writes for the analog Site. Results are recorded here only once measured.

## Why this circuit

The competitor sized a bandgap core: Kuijk-style, 8:1 PNPs, an OTA with an output device, start-up
and enable. It had 11 spec lines, and every one was verified at one corner only. We size the same
kind of core against the same kind of spec sheet, and verify it where theirs was not:

- every process corner, temperature and supply, judged outside the agent;
- Monte Carlo mismatch, judged outside the agent;
- the layout of the cell we sized, followed by a post-layout re-check.

The Pack is `packs/analog-bandgap`, separate from `analog-ota-migrate`. That Pack stays as act 2,
migration.

## Measured feasibility (lab server, Spectre 23.1, GF180MCU as shipped, 2026-10-12)

- `pnp_10p00x10p00` (vertical PNP, section `bjt_typical`) and `ppolyf_u_1k` (section
  `res_typical`) read in Spectre once `design.spice` is included. The only warning is a harmless
  "`noise` is not a valid parameter".
- A Kuijk core with an ideal amplifier, 8:1 PNPs, 100 k / 10 k poly resistors and a 1 nA start-up
  current gives VBG 1.2030 V at 27 °C and 38 ppm/°C box from −40 to 125 °C. The resistor ratio was
  not tuned.
- Spectre `montecarlo` (variations=all; `sw_stat_mismatch=1` set after the includes, with
  `options redefinedparams=warning`; `savefamilyplots=yes` keeps every iteration) reads the deck's
  `agauss` mismatch: 30 runs give σVBG 0.43 mV (PNPs and resistors only, ideal amplifier).
- MOS mismatch lives in the section `fets_mm` (subcircuits `nfet_03v3` and `pfet_03v3` with
  Pelgrom `delvto`/`mulu0`). Per device, σVth = 0.7071 · 7.148 mV·µm / √(W·L) for nfet and
  0.7071 · 6.66 mV·µm / √(W·L) for pfet.

## Template decision (main agent, 2026-10-12, on measured evidence)

The first template below, `kuijk-p5t`, drives the output PMOS gate straight from the OTA. Spectre on
GF180MCU shows it cannot meet the sheet:

- The gate must sit at vdd − |VGS| ≈ 1.6–1.9 V below the supply, and that shifts 0.35 V over
  temperature.
- At 2.0 V and 125 °C the OTA's load leaves saturation.
- At 3.3 V and the fast-PMOS corners the input pair is starved.
- The window that serves both supplies is about 0.05 V at tt and closes at the corners.

Three rounds that changed only the intent all failed VBG, TC, phase margin and PSRR.

The Pack's template is therefore `kuijk-p5t-mirror`. The same OTA drives an NMOS stage into a PMOS
diode, and the output device mirrors it 4:1. The method's first cut then meets every line at every
corner plus Monte Carlo. `kuijk-p5t` stays in the CLI (`bind ... kuijk-p5t`) as the recorded
negative result. The evidence is on the server in `analog-sim-01/bg-probe/` (`ws-a`: kuijk-p5t,
`ws-b`: mirror), and in the playbook.

## Circuit (template; the agent chooses sizes, never topology)

- **Core (Kuijk).** Q1 (1×) at node `a`; R1 then Q2 (n×, default n = 8) at node `b`; R2a from
  `vbg` to `a` and R2b from `vbg` to `b`; VBG = VBE1 + (R2/R1)·VT·ln n. The PNPs are
  `pnp_10p00x10p00` (collector and base at vss). The resistors are `ppolyf_u_1k`, with length and
  width chosen.
- **Amplifier.** A PMOS-input 5-transistor OTA (`pfet_03v3` pair, `nfet_03v3` mirror load, PMOS
  tail). The input common mode sits at VBE, about 0.6 to 0.8 V, which an NMOS pair cannot reach at
  2.0 V. A PMOS output device `mp_out` sources the core current into `vbg`, with its gate on the OTA
  output. Each branch carries an optional compensation capacitor (MIM `cap_mim_2f0fF`, or a MOS cap
  if MIM does not read).
- **Bias.** A PMOS mirror from one reference current, `ibias` (default 0.5 µA, an ideal source in
  the testbench, the same as the competitor's `i_bias`).
- **Start-up.** A small transistor or resistor path that pulls `vbg` up while the core is at zero
  current, then turns off (its current is under 1 % of IQ once started).
- **Enable.** `en` high runs the circuit. `en` low turns off the bias mirror and pulls the amplifier
  output to vdd, so the shutdown current is leakage only.
- **Pins:** `vdd vss en ibias vbg`.

## Spec sheet (Goal lines; the defaults mirror the competitor's)

| Line | Default | Measured how |
| --- | --- | --- |
| VBG at vdd 3.3 V and 2.0 V | 1.2 V ± 2 % | DC, every PVT corner |
| IQ (en = 1) | < 8 µA | DC supply current, both supplies, every corner |
| ISD (en = 0) | ≤ 2 nA at 27 °C | DC; reported at every corner |
| TC | < 100 ppm/°C, box method, −40 to 125 °C | DC temperature sweep per process corner and supply |
| Loop phase margin | > 60° | Every loop crossing; the smallest margin counts; no crossing is not a pass |
| Start-up time | < 100 µs | Transient: `en` ramps in 1 µs and in 50 µs; time from `en` at 50 % until VBG enters ±2 % of its final value and stays |
| PSRR at 1 kHz | > 40 dB | AC from vdd to vbg, every corner (the competitor only observed it) |
| **Monte Carlo** | mean ± 3σ of VBG inside 1.2 V ± 2 % | Spectre `montecarlo`, mismatch, N = 100 (default), tt, 27 °C, 3.3 V |

The corners are process tt/ss/ff/sf/fs (GF180 sections `nfet_03v3_<c>` and `pfet_03v3_<c>`, with
`bjt_<typical|ss|ff>` and `res_<typical|ss|ff>` following the process corner), temperature −40,
27 and 125 °C, and supply 2.0 V and 3.3 V. The worst value of each line across the corners is
judged.

## Executable method (Pack code, regression-tested; agents call it, never type numbers)

- **Characterize.** gm/Id tables for `nfet_03v3`/`pfet_03v3`, as the OTA Pack does. The PNP gets
  VBE(I, T) at the core current: the slope dVBE/dT and VBE at 27 °C.
- **First cut from the spec.**
  - Branch current I from the IQ budget.
  - R1 = VT·ln n / I.
  - R2/R1 = −(dVBE/dT) / ((k/q)·ln n), so that dVBG/dT = 0 at 27 °C.
  - Resistor lengths on the `ppolyf_u_1k` sheet resistance and grid.
  - Amplifier: gm/Id choices for the pair, load and tail (lookup tables).
  - The input-pair area from the Monte Carlo line, by Pelgrom: σVBG ≈ (1 + R2/R1)·σVos with
    σVos = √2·σVth(W·L). The required W·L is the area at which 3σVBG fits inside the band less
    the corner spread.
- **Intent → sizes**, then `precheck` (grid, limits, matched pairs, fields), as in the OTA Pack.

## Flow commands (`flow/bg_cli.py`, stdlib, python ≥ 3.9)

They share the simulator adapters with the OTA Pack's `ota_cli.py`: Spectre (PSF ASCII) and ngspice
(wrdata). There is one measurement arithmetic, and every number is computed from the raw
simulator output.

- `bind`, `characterize`, `draft intent|size|keep`, `precheck`, `sim` (an agent's own try), and
  `simulate <stage>` (the full PVT set).
- `mc` (Monte Carlo on the accepted design) and `record` (round record, lessons, charts).
- Every output carries the design's SHA-256. A Reader accepts a measurement only for the accepted
  design and conditions.

## Graph (the Pack wiring, done by the main agent)

1. bind → characterize → size-agent → simulate (PVT) → check-pvt.
2. On PASS: mc → check-mc. On PASS: layout → drc/lvs → pex → simulate-post → check-post →
   record → next round.
3. A failing judge returns to the size-agent with the failing lines and corners. The round budget
   and the converge settings follow the OTA Pack's (the judge's first rule is the composite verdict;
   the chooser weighs its first two rules).

## Layout (worker-owned probe first: `sites/analog_sim_01/layout/`)

- The layout of the sized design.
- DRC with the PDK's deck; LVS against the netlist the Pack simulates; extraction (C, and R where
  feasible).
- The post-layout netlist simulated in Spectre at the worst PVT corners.
- A KLayout PNG for the milestone panel.

## Tests

- **Local (group `local`)**, on the synthetic PDKs plus a synthetic PNP card in
  `test/fixtures/analog-pdks/`:
  - netlist shape for both simulators;
  - measure arithmetic on recorded raw files (DC sweep TC, transient start-up time, AC PSRR, loop
    PM, the MC statistics);
  - the first-cut equations;
  - the refusals.
- **`analog-sim`** (real ngspice): one tt corner end to end on the synthetic decks, and ngspice vs
  Spectre fixture agreement.
- **Server (by hand, then the Site):** the full PVT set and Monte Carlo in Spectre on GF180MCU.

## Claim boundary

Schematic plus a layout of the sized cell checked with open decks. Open PDK models. Not a silicon
claim. Monte Carlo covers device mismatch and the PDK's global statistics only, not package stress
or trimming.
