# IP package: bgcore (bandgap core front end)

The case you size. It has three parts, `topology`, `interface` and `metrics`, as an IP package
would. The Pack fixes the template (`bgcore`): you choose the sizes, never the topology. The Goal
holds the spec sheet's numbers, and it wins if this page and the Goal disagree.

## topology

A bandgap core front end, with five blocks.

1. **Kuijk core.**
   - Q1 (1×) sits at node `a`.
   - R1 then Q2 (n×, n = 8) sit at node `b`.
   - R2a runs from `vbg` to `a`, and R2b from `vbg` to `b`.
   - VBG = VBE1 + (R2/R1) · VT · ln n.
   - The PNPs are the PDK's vertical PNPs, with collector and base at `vss`. The resistors are
     high-value poly.
2. **Amplifier and output stage.**
   - A PMOS-input five-transistor OTA: `pfet_03v3` pair, `nfet_03v3` mirror load, PMOS tail.
   - It drives an NMOS transconductor into a PMOS diode, which the output device mirrors 4:1 into
     `vbg`.
   - Each branch has an optional compensation capacitor.
3. **Start-up and enable.**
   - A weak path pulls the output device's gate down while the core sits at zero current. Once VBG
     is up, the path turns off.
   - `en` low turns off the bias mirror and pulls the output device's gate to `vdd`, so the
     shutdown current is leakage only.
4. **Reference ladder.**
   - `vbg` connects through half a unit to `vref_122`, then 122 unit resistors run down to `vss`.
   - Taps `vref_1` … `vref_120` are outputs, and tap k sits at VBG · k / 122.5.
   - The unit is high-value poly. Its value is a sizing choice (`ladderRUnitKohm`), and the ladder's
     current counts in IQ.
5. **BGOK monitor.**
   - A small comparator senses one ladder tap (`bgokTap`, chosen by the method) against VBE1 (node
     `a`), and drives `bgok` through inverter stages. On GF180 the tap is `vref_88`.
   - In the core's stuck state VBG ≈ VBE1, so every tap sits below `a` and `bgok` stays low.
   - `bgok` can rise only through bias current, after a bias-charged delay. So it is low while the
     bias starts, and its edge is slow.
   - `bgok` is high only when the cell is enabled and VBG is up, and low while `en` is low. This is
     verified for the bench's ramps: power-up in 10 µs, and `en` edges of 1 µs and 50 µs.
   - While `en` is low, the OTA output and the start-up node are held at `vss`.

Every transistor is a 3.3 V device. The PDK's 6 V and native devices have typical models only, and
the native device has no mismatch model, so the corners and Monte Carlo could not cover them.

## interface

| Pin | Direction | Function |
| --- | --- | --- |
| `vdd` | supply | 2.0 V or 3.3 V |
| `vss` | supply | ground and substrate |
| `en` | input | high runs the cell; low shuts it down |
| `isnk_0p2u` | bias | an external sink draws 0.2 µA from this pin; off while `en` is low. Netlist name: `ibias` |
| `vbg` | output | the 1.2 V reference |
| `vref<1:120>` | output | ladder taps; netlist names `vref_1` … `vref_120` |
| `bgok` | output | high when the reference is up |

The netlist cell is `bandgap_lb vdd vss en ibias vbg go g bgok vref_1 … vref_120`, with the loop
broken between `go` and `g`. The closed cell is `bandgap`, which has the same pins without `go`
and `g`.

## metrics

| Metric | Spec | Condition | Goal field |
| --- | --- | --- | --- |
| VBG | 1.2 V ± 2 % | 3.3 V and 2.0 V, every corner | `vbg_v`, `vbg_tol_pct` |
| IQ | < 8 µA | `en` high, both supplies, every corner | `max_iq_ua` |
| ISD | ≤ 2 nA | `en` low, 27 °C | `max_isd_na` |
| TC | < 100 ppm/°C | box method, −40 to 125 °C | `max_tc_ppm` |
| Phase margin | > 60° | every unity crossing; no crossing is a miss | `min_pm_deg` |
| Start-up time | < 100 µs | `en` edges of 1 µs and 50 µs, and power-up | `max_tstart_us` |
| PSRR at 1 kHz | > 40 dB | every corner | `min_psrr_db` |
| BGOK | high when enabled, low when disabled | every corner | (always judged) |
| BGOK trip | `bgok` stays low until VBG reaches 50 % of final | power-up and both `en` edges, every corner | (always judged) |
| Monte Carlo | mean ± 3σ of VBG inside the band | N runs, tt, 27 °C, 3.3 V | `mcRuns` |
| Layout | DRC 0, LVS match | the PDK's decks | (always judged) |
| After layout | every line above | extracted cell, every corner | (always judged) |

**What counts.**
- **Start-up time** is measured from `en` at 50 % until VBG enters ±2 % of its final value and
  stays. It also counts as a miss when:
  - VBG is already in that band before `en` rises;
  - the final value is off the DC solution.
- **Corners** are process tt/ss/ff/sf/fs × −40/27/125 °C × 2.0/3.3 V: 30 corners in all. Each line
  is judged at its worst corner.
