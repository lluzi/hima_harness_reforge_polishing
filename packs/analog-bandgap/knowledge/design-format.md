# The bandgap design file and the delivery

The sizing agent delivers one JSON object, a bandgap design (`hima-bandgap-design/1`), as the
`result` of its task, and its reports as `support`. `k` is the round: the number of rounds in
`lessons` plus one. Reports live in your private workspace at `reports/size-agent/r<k>/` and land at
the same path in the Campaign; `report` names your `analysis.md` there.

```json
{
  "schema": "hima-bandgap-design/1",
  "pdk": "gf180mcuD",
  "topology": "kuijk-p5t-mirror",
  "round": 1,
  "n": 8,
  "ibiasUa": 0.5,
  "devices": {
    "MB0": {"wUm": 5.61, "lUm": 5.0}, "MT": {"wUm": 11.22, "lUm": 5.0},
    "M1": {"wUm": 86.215, "lUm": 5.0}, "M2": {"wUm": 86.215, "lUm": 5.0},
    "M3": {"wUm": 10.5, "lUm": 40.0}, "M4": {"wUm": 10.5, "lUm": 40.0},
    "M5": {"wUm": 11.515, "lUm": 40.0}, "M6": {"wUm": 2.295, "lUm": 2.0},
    "MO": {"wUm": 9.185, "lUm": 2.0},
    "MSU1": {"wUm": 0.28, "lUm": 5.0}, "MSU2": {"wUm": 0.5, "lUm": 20.0}, "MSU3": {"wUm": 1.0, "lUm": 1.0},
    "MSU4": {"wUm": 1.0, "lUm": 1.0}, "MEN1": {"wUm": 1.0, "lUm": 1.0}, "MEN2": {"wUm": 1.0, "lUm": 1.0},
    "MEN3": {"wUm": 1.0, "lUm": 1.0}
  },
  "resistors": {
    "R1": {"wUm": 2.0, "lUm": 32.095, "s": 3},
    "R2a": {"wUm": 2.0, "lUm": 39.465, "s": 26}, "R2b": {"wUm": 2.0, "lUm": 39.465, "s": 26}
  },
  "caps": {"CC": {"wUm": 70.71, "lUm": 70.71, "m": 1}},
  "intent": {"n": 8, "ibiasUa": 0.5, "itailUa": 1.0, "iCoreUa": 1.097, "r2r1": 10.6471, "isuNa": 25.0,
             "resWUm": 2.0, "resSegMaxUm": 40.0, "ccPf": 10.0, "coutPf": 0.0, "mcBandSharePct": 50.0,
             "driveRatio": 4.0,
             "pair": {"gmId": 20.0, "lUm": 5.0}, "load": {"gmId": 10.0, "lUm": 40.0},
             "mirror": {"gmId": 10.0, "lUm": 5.0}, "out": {"gmId": 10.0, "lUm": 2.0}},
  "summary": "First cut from the spec sheet, then ...",
  "reason": "The 2.0 V corners set ...",
  "report": "reports/size-agent/r1/analysis.md"
}
```

The sizes above are the method's first cut on gf180mcuD (`draft size` computed them). `topology` is the Campaign's template
(bind chose it): `kuijk-p5t` (the five-transistor OTA drives the output device's gate) has no `M5`,
`M6` or `driveRatio`; `kuijk-p5t-mirror` adds the transconductor `M5` and the diode `M6`.

### `bgcore` (the competitor's case)

`bgcore` is `kuijk-p5t-mirror` plus a reference ladder and a BGOK monitor, with a 0.2 uA reference.
Its design differs in five places:

- `ibiasUa` is 0.2.
- `devices` adds:
  - the `en` inverter `MENI1` and `MENI2`, and `MEN5`, `MEN6` and `MEN7`;
  - the BGOK monitor: `MOK1` to `MOK8`, `MOKI1`, `MOKI2`, `MOKF1` to `MOKF3`, `MOKC`, `MOKO1`
    and `MOKO2`.
- `ladder` is the ladder's unit segment, `{"wUm": ..., "lUm": ...}`: one `ppolyf_u_1k` segment
  (`s` = 1).
- `bgokTap` is the ladder tap the BGOK comparator senses, a whole number from 1 to 120.
- `intent` adds three choices:
  - `ladderRUnitKohm`: the unit's resistance. The ladder draws VBG / (122.5 units).
  - `bgokNa`: the BGOK bias mirrors' current.
  - `bgokTap`: the tap. The method picks it from the coldest VBE1 (below).

The method's first cut on gf180mcuD:

```json
"ladder": {"wUm": 2.0, "lUm": 38.525},
"caps": {"CC": {"wUm": 44.72, "lUm": 44.72, "m": 1}},
"intent": {"...": "...", "ibiasUa": 0.2, "itailUa": 0.4, "ccPf": 4.0, "ladderRUnitKohm": 19.6, "bgokNa": 50.0, "bgokTap": 88}
```

In `bgcore` the start-up switch MSU3 is 2 x 4 um, and its gate is the start-up node `su`. At
1 x 1 um, Spectre crashed in the power-up transient.

## The cell

- **Core:** Q1 (one PNP) at `a`; R1 then n PNPs at `b`; R2a from `vbg` to `a` and R2b from `vbg` to
  `b`. Every PNP is one instance of the PDK's vertical PNP; resistor `s` is the number of series
  segments of length `lUm` (the model's `s` parameter); a capacitor of `m` units is `m` instances.
- **Amplifier:** the PMOS pair M1/M2 with tail MT, the NMOS mirror load M3/M4 (its foot through MEN3),
  and, in `kuijk-p5t-mirror`, M5 (gate on the OTA output, matched to the load's current density) into
  the diode M6, which the output device MO mirrors (`driveRatio` = MO / M6).
- **Bias:** the diode MB0 is the `ibias` pin; MT and the start-up pull-up MSU1 mirror it.
- **Start-up:** MSU1 pulls `su` up; MSU2 (long and narrow: it must not pull `su` down until `vbg` is
  well above the near-zero state) pulls it down; while `su` is high, MSU3 (enabled by MSU4) pulls the
  output device's gate down.
- **Enable:** `en` low turns the bias mirror off (MEN1), pulls the output device's gate to vdd (MEN2)
  and opens the load's foot (MEN3).
- **Pins:** `.subckt bandgap_lb vdd vss en ibias vbg go g` with the loop broken between `go` (the
  amplifier side) and `g` (the output device's gate); `.subckt bandgap vdd vss en ibias vbg` joins
  them. `cell_spice(card, design)` in `flow/bg_cli.py` writes both; post-layout simulation substitutes
  the extracted `bandgap_lb` (`state/cell-post.spice`).
- **bgcore only:**
  - **Ladder.** `RL0a` and `RL0b` (two units in parallel, half a unit) join `vbg` to `vref_122`.
    `RLk` joins `vref_k` to `vref_(k-1)` for k = 122 … 1, and `vref_0` is `vss`. Tap k sits at
    VBG · k / 122.5.
  - **Enable.**
    - `MENI1` and `MENI2` invert `en` into `enb`.
    - `MEN5` holds the OTA output `o1`, and with it CC, at vss while `en` is low. Without it, `o1`
      floated up to about 3 V. At `en`, VBG then overshot to about vdd, and on a slow `en` ramp the
      falling `o1` pulled the input pair's gates `a` and `b` to −1.2 V.
    - `MEN7` holds the start-up node `su` at vss while `en` is low. Floating at up to 1.65 V, it
      made VBG spike to 1.7 V (2.2 V after layout) on the 1 µs `en` ramp.
  - **BGOK**, in five parts:
    - **Comparator.** `MOK5` (gate on `vref_<bgokTap>`) and `MOK6` (gate on `a`, which is VBE1)
      are a PMOS pair, 10 × 1 um (deep weak inversion), on the tail `MOK2`, a bias mirror at `bgokNa`. Their load is the
      NMOS mirror `MOK7`, with `MOK8` four times `MOK7`. Equal inputs therefore read "not OK", and
      "OK" needs the tap above `a` by n·VT·ln 4. The output `okc` is high for OK.
    - **Stuck-state safety.** In the core's stuck state VBG is close to VBE1, so every tap sits
      below `a` and the comparator reads not OK. The tap is the lowest one that sits 50 mV above
      the PNP's highest VBE1 at −40 °C (at the core current, over the characterized corners) plus
      that offset. VBG settled therefore reads OK at every corner.
    - **Inverting stage.** `MOKI2` (gate `okc`) pulls `okcb` down against the bias pull-up
      `MOKI1`, so `okcb` is low for OK.
    - **Delay.** While `okcb` is low, the bias mirror `MOKF1` (at `bgokNa` / 8) charges `okf` and
      its MOS capacitor `MOKC` (10 × 10 um) through `MOKF2`. While it is high, `MOKF3` discharges
      them fast. `MOKO1`/`MOKO2` buffer `okf` into `okg`. `okg` switches bgok's pull-up, the bias mirror
      `MOKB` through `MOK3`, against the strong pull-down `MOK4` (4 × 1 um). The MOS capacitor
      `MOKCB` (8 × 8 um) slows bgok's rise to 10 to 20 µs, which the core loop can track. So bgok rises only
      through bias current (no bias, no bgok), and only after a delay of tens of µs while VBG
      settles.
    - **en low.** `MOK1` holds `okc` low and `MEN6` holds `okcb` high, so `okf` and `bgok` are
      driven low.
  - **Pins:** `bandgap_lb vdd vss en ibias vbg go g bgok vref_1 … vref_120`, and `bandgap` without
    `go g`, all on one `.subckt` line. `vref_121` and `vref_122` are internal. An extracted
    `bandgap_lb` must carry the same pins in the same order.

## What precheck and the Reader refuse

- a schema, PDK, topology or round other than this round's;
- devices other than exactly the template's, or a device that is not `{wUm, lUm}`;
- resistors other than R1, R2a, R2b, a resistor that is not `{wUm, lUm, s}`, R2a different from R2b,
  resistors of different widths;
- capacitors other than CC and CO, or not `{wUm, lUm, m}` with m from 1 to 16;
- an L or W outside the PDK's limits or off its grid; M1 different from M2, M3 different from M4;
- n not a whole number from 2 to 24; ibiasUa other than the template's reference current (0.5 uA;
  0.2 uA in `bgcore`), the current the bench provides;
- in `bgcore`, a missing `ladder` or one that is not `{wUm, lUm}` legal for the resistor, or a
  `bgokTap` that is not a whole number from 1 to 120; a `ladder` or `bgokTap` in any other
  template;
- any field that is not part of the design (a VBG or a PSRR you computed, for example), and any field
  in `intent` other than the design choices;
- sizes that do not follow the intent;
- an empty summary or reason, a missing analysis report; the report must be
  `reports/size-agent/r<k>/analysis.md` (a repair: `analysis-2.md`, `-3`, ...).

## Drafting

Never type sizes. `draft intent <spec sheet>` gives the method's first cut; the sheet may carry
`choices`, any intent field or one key of a device group (`{"pair": {"gmId": 16}}`), and the method
derives everything that depends on them (R2/R1 from n and the core current, the pair's and load's L
from the Pelgrom area, the output device's gm/Id from the gate window). `draft size <intent>` gives
the design; `draft mc` applies the Pelgrom step to the accepted design's intent from the measured
Monte Carlo sigma; `draft keep` carries last round's accepted design. Change a choice and draft again.
To size by hand instead, remove `intent` and edit sizes; precheck checks legality, the simulator the
rest. Fill `summary` and `reason` in your own words, then:

```
python3 <campaign>/flow/bg_cli.py precheck <campaign> design.json
```

and deliver `design.json` as the result and `reports/size-agent/r<k>/analysis.md` (and any other
reports under that folder) as support. A refused delivery comes back with every problem listed.
