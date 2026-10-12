# The design file and the delivery

Both agents deliver one JSON object, an OTA design (`hima-ota-design/1`), as the `result` of their
task and their reports as `support`. `k` is the round: the number of rounds in `lessons` plus one.
Reports live in your private workspace at `reports/<your step>/r<k>/` (the step is `size-agent` or
`migrate-agent`) and land at the same path in the Campaign; `report` names your `analysis.md` there.

```json
{
  "schema": "hima-ota-design/1",
  "stage": "source",
  "pdk": "gf180mcuD",
  "topology": "miller2",
  "round": 1,
  "ibiasUa": 10.0,
  "ccPf": 0.6,
  "rzKohm": 2.1,
  "devices": {
    "M1": {"wUm": 1.48, "lUm": 0.5}, "M2": {"wUm": 1.48, "lUm": 0.5},
    "M3": {"wUm": 2.0, "lUm": 0.5},  "M4": {"wUm": 2.0, "lUm": 0.5},
    "M5": {"wUm": 2.36, "lUm": 1.0}, "M6": {"wUm": 25.0, "lUm": 0.5},
    "M7": {"wUm": 14.78, "lUm": 1.0}, "M8": {"wUm": 2.96, "lUm": 1.0}
  },
  "intent": {"ibiasUa": 10, "i1Ua": 4, "i6Ua": 50, "ccPf": 0.6, "rzKohm": 2.1,
             "input": {"gmId": 15, "lUm": 0.5}, "load": {"gmId": 10, "lUm": 0.5}, "sink": {"gmId": 12, "lUm": 1.0}},
  "summary": "First cut from the spec, then ...",
  "reason": "The slow corner set the pair current ...",
  "report": "reports/size-agent/r1/analysis.md"
}
```

A target design has `"stage": "target"`, the target PDK, and
`"migratedFrom": {"pdk": "<source PDK>", "sha256": "<SHA-256 of state/design-source.json>"}`.

## What precheck and the Reader refuse

- a schema, stage, PDK, topology or round other than this round's;
- devices other than exactly M1 to M8, or a device that is not `{wUm, lUm}`;
- an L or W outside the PDK's limits or off its grid;
- M1 different from M2, or M3 different from M4;
- a bias current, Cc or Rz out of range (0.5 to 500 uA, 0.05 to 20 pF, 0 to 200 kOhm);
- any field that is not part of the design, for example a gain or a phase margin you computed,
  and any field in `intent` other than the design choices;
- devices that do not follow the intent;
- an empty summary or reason, a missing analysis report;
- a target design that does not cite the accepted source design.

## Drafting

Never type sizes by hand when a draft can compute them: `draft intent`, `draft size`, `draft
migrate` and `draft keep` print a complete design from the tables (see `analog-flow.md`). The
`intent` holds only design choices (bias, the two currents, Cc, Rz, and a gm/Id and L per group, all
numbers), and the devices must be exactly what `draft size` / `draft migrate` give for it: change
the intent and draft again. To size by hand instead, remove `intent` and edit W, L, bias, Cc or Rz
directly; precheck checks legality, the simulator checks the rest, and the round record says the
design was sized by hand.
Fill `summary` and `reason` in your own words. Then:

```
python3 <campaign>/flow/ota_cli.py precheck <campaign> <stage> design.json
```

and deliver `design.json` as the result and `reports/<step>/r<k>/analysis.md` (and any other reports
under that folder) as support. A refused delivery comes back to you in the same task with every
problem listed; fix and deliver again. Support paths are immutable: a repair writes a new file name
(e.g. `analysis-2.md`) if the content changed.
