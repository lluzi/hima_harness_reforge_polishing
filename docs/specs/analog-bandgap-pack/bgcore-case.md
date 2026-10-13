# The bgcore case: the competitor's bandgap case, on an open PDK

Status: accepted by the main agent, 2026-10-13. The user asked that we run the same case as the
Aether Agent recordings ([benchmark](../../research/2026-10-12-aether-agent-benchmark.md)). The
competitor does not share its case files, so this case is written from what the recordings show,
in our own words. It contains none of their netlist, foundry, PDK cell names or people.

## What is the same as theirs

- **The input format.** An IP package of three parts: topology, interface, metrics. Our agent
  reads it as they do: in the knowledge file `bgcore-case.md`.
- **The prompt and the approval.** "生成一个bgcore前端电路" ("generate a bgcore front-end
  circuit"), then one approval.
- **The blocks.**
  - A Kuijk core with PNPs at n = 8 : 1.
  - A five-transistor amplifier driving an output device.
  - A start-up path and an enable.
  - A 120-tap reference ladder.
  - A BGOK ("bandgap OK") monitor.
- **The pins:** `en`, `isnk_0p2u`, `vdd`, `vss`, `bgok`, `vbg`, `vref<1:120>`.
- **The bias:** 0.2 µA drawn from the bias pin by the bench, off while `en` is low.
- **The seven spec lines and their conditions:**

  | Line | Spec | Condition |
  | --- | --- | --- |
  | VBG | 1.2 V ± 2 % | at 3.3 V and at 2.0 V |
  | IQ | < 8 µA | |
  | ISD | ≤ 2 nA | at 27 °C |
  | TC | < 100 ppm/°C | box method, −40 to 125 °C |
  | Phase margin | > 60° | |
  | Start-up time | < 100 µs | `en` edges of 1 µs and 50 µs |
  | PSRR at 1 kHz | > 40 dB | judged here; their run only recorded it |

## What differs, and why

- **The PDK is GF180MCU, and every transistor is a 3.3 V device.** Their pair is a native NMOS on
  5 V devices. GF180MCU ships both kinds, but only with typical models: its 6 V and native
  transistors have no process corners, and the native one has no mismatch model. With those
  devices, the 30 corners could not move the transistors, and Monte Carlo could not vary the input
  pair that dominates VBG's offset. The 3.3 V devices have both, so the amplifier keeps a PMOS
  input pair, which reaches the core's ~0.7 V input level at a 2.0 V supply.
- **Net names.**
  - The bias pin is `ibias` in our netlists. Its interface name is `isnk_0p2u`, and the direction
    is the same: an external sink draws 0.2 µA from it.
  - The tap pins are `vref_1` … `vref_120`, because angle-bracket buses do not read reliably in
    both simulators.
- **Their run verified more, here.**
  - 30 PVT corners: 5 process × 3 temperatures × 2 supplies.
  - Monte Carlo mismatch, N = 100.
  - A BGOK check at every corner.
  - The layout of the sized cell, DRC and LVS on the PDK's decks, and a post-layout re-check at
    every corner.
  - All judged by Readers outside the agent.

## Circuit (template `bgcore`; the agent chooses sizes, never topology)

**Core, amplifier, bias, start-up and enable.** The same as `kuijk-p5t-mirror`
([spec](spec.md)).

**Ladder.**
- `RL0` connects `vbg` to `vref_122`. It is half a unit: two unit segments in parallel.
- `RL1` … `RL122` each join `vref_k` to `vref_(k-1)`. `vref_0` is `vss`.
- The taps `vref_1` … `vref_120` are pins. `vref_121` and `vref_122` are internal.
- Tap k sits at VBG · k / 122.5.
- The unit is one `ppolyf_u_1k` segment of `ladderRUnitKohm`. The method chooses it from the IQ
  budget, and the ladder's current counts in IQ.

**BGOK.**
- It senses `vref_100` (≈ 0.98 V when VBG is right) and drives `bgok` through two inverter stages.
- `bgok` is high exactly when the cell is enabled and VBG is up.
- It is low and defined (no floating node) while `en` is low.
- Its current counts in IQ, and its leakage counts in ISD.

**Pins, in order.**
- `bandgap_lb`: `vdd vss en ibias vbg go g bgok vref_1 … vref_120`, with the loop broken between
  `go` and `g`.
- `bandgap`: the same pins without `go` and `g`.

## Checks added over the base Pack

- **BGOK, at every corner.**
  - With the cell enabled and settled, `bgok` is above 90 % of vdd.
  - With `en` low, `bgok` is below 10 % of vdd.
  - Either failing fails the line.
- **Start-up stays causal.** Before `en` starts to rise, VBG must stay out of its final ±2 % band.
  If VBG enters the band before the trigger, the copy did not start correctly. This is a miss, not
  a 0 µs start-up. It is the error class behind the competitor's −48.88 ns pass.
- **Monte Carlo** varies the resistors as well as the transistors. That includes the ladder, but VBG
  is judged at `vbg`.

## Layout

- The same tool as the base Pack.
- **The ladder** is one serpentine of unit segments. Each of the 120 taps is a labelled pin, and
  LVS matches all 127 pins.
- **The BGOK inverters** sit on the cell's edge.
- **Gates:** DRC 0 on both decks, LVS matched on both checks, and the post-layout re-check at every
  corner.

## Order of work

1. This case and its knowledge file.
2. Engine: the template, bench pins, BGOK and causal-start checks, and the first cut with the
   ladder in the IQ budget.
3. Layout: the ladder and 127 pins.
4. Site sign-off in Spectre.
5. App run with the resident agent.
6. Recording. Each step is reported before the next large one.
