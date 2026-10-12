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
    "M5": {"wUm": 14.395, "lUm": 40.0}, "M6": {"wUm": 2.87, "lUm": 2.0},
    "MO": {"wUm": 11.48, "lUm": 2.0},
    "MSU1": {"wUm": 0.28, "lUm": 5.0}, "MSU2": {"wUm": 0.5, "lUm": 20.0}, "MSU3": {"wUm": 1.0, "lUm": 1.0},
    "MSU4": {"wUm": 1.0, "lUm": 1.0}, "MEN1": {"wUm": 1.0, "lUm": 1.0}, "MEN2": {"wUm": 1.0, "lUm": 1.0},
    "MEN3": {"wUm": 1.0, "lUm": 1.0}
  },
  "resistors": {
    "R1": {"wUm": 2.0, "lUm": 38.555, "s": 2},
    "R2a": {"wUm": 2.0, "lUm": 38.7, "s": 21}, "R2b": {"wUm": 2.0, "lUm": 38.7, "s": 21}
  },
  "caps": {"CC": {"wUm": 70.71, "lUm": 70.71, "m": 1}},
  "intent": {"n": 8, "ibiasUa": 0.5, "itailUa": 1.0, "iCoreUa": 1.371, "r2r1": 10.5397, "isuNa": 25.0,
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

## What precheck and the Reader refuse

- a schema, PDK, topology or round other than this round's;
- devices other than exactly the template's, or a device that is not `{wUm, lUm}`;
- resistors other than R1, R2a, R2b, a resistor that is not `{wUm, lUm, s}`, R2a different from R2b,
  resistors of different widths;
- capacitors other than CC and CO, or not `{wUm, lUm, m}` with m from 1 to 16;
- an L or W outside the PDK's limits or off its grid; M1 different from M2, M3 different from M4;
- n not a whole number from 2 to 24; ibiasUa outside 0.05 to 10 uA;
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
