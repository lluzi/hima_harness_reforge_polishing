# Delivery files

Every agent delivers one JSON object as the `result` of its task and its reports as `support`.
`k` is `timingState.round`. Reports live in your private workspace at `reports/<your step>/r<k>/`
(the step is `himatime-agent`, `qualib-agent`, `andescell-agent`, `himatime-verify` or
`qualib-screen`) and land at the same path in the Campaign. `report` names your `analysis.md`
there. Support paths are immutable: a repair in the same round writes the same path only if it is
unchanged, otherwise a new name (e.g. `analysis-2.md`).

## Cell requirements (hima-andes-requirements/1): himatime-agent, qualib-agent

```json
{
  "schema": "hima-andes-requirements/1",
  "agent": "himatime",
  "round": 1,
  "summary": "The S-box/MixColumns paths set Fmax: XNOR3 and BUF stages carry 44 % of the worst path.",
  "requirements": [
    {
      "family": "XNOR3",
      "purpose": "Faster rising output for the S-box XNOR3 trees",
      "target": "cell delay -30 % at fanout 4",
      "evidence": "A1-A7 S-box paths; XNOR3 268 ps of 1044 ps on A1; HimaTime est. recovery 3.04 ns",
      "priority": 1
    },
    {
      "family": "BUF",
      "purpose": "Mid-drive balanced buffer for the fanout-6..12 S-box nets",
      "target": "cell delay -25 % at fanout 6",
      "evidence": "BUF on all 20 worst paths, 18.8 % of A1; est. recovery 2.09 ns",
      "priority": 2
    }
  ],
  "report": "reports/himatime-agent/r1/analysis.md"
}
```

- `agent`: `himatime` or `qualib` (your role). `round`: k.
- `requirements`: 1-8 items (2-5 recommended). `family`: an AndesCell family (`andescell
  families`; `XNOR2` means `XOR2`). `target`: text with a percentage. `evidence`: text or an object
  naming paths, stages, report numbers. `priority`: 1-5 (1 highest) or high/medium/low.
- `report`: `reports/<himatime-agent|qualib-agent>/r<k>/analysis.md`.

## Generation plan (hima-andes-plan/1): andescell-agent

```json
{
  "schema": "hima-andes-plan/1",
  "agent": "andescell",
  "round": 1,
  "summary": "Both lists ask for XNOR3; XNOR3 and BUF have the most estimated recovery on the S-box paths.",
  "families": [
    { "family": "XNOR3", "reason": "Asked by both agents; 25.7 % of the worst path, the largest estimated recovery", "estRecoveryNs": 3.041 },
    { "family": "BUF", "reason": "On all 20 worst paths; second largest estimated recovery", "estRecoveryNs": 2.087 }
  ],
  "skipped": [
    { "family": "XOR2", "reason": "Third by estimated recovery (1.966 ns); AndesCell builds two families a round" },
    { "family": "MUX2I", "reason": "1.178 ns estimated recovery; the key-expansion paths come after the S-box paths" }
  ],
  "report": "reports/andescell-agent/r1/analysis.md"
}
```

- `families`: 1-2 families that one of this round's lists requested, AndesCell has a template for,
  and the library does not hold yet. `estRecoveryNs` is HimaTime's, from
  `timingState.stageBreakdown` (to 3 decimals). `reason`: a sentence.
- `skipped`: every other requested family not yet delivered, with a reason (families already
  delivered may be listed too).
- `report`: `reports/andescell-agent/r<k>/analysis.md`.

## Cell timing (hima-andes-cell-timing/1): himatime-verify

Copy HimaTime's numbers from `himatime verify --paths 8` (`verify.json`).

```json
{
  "schema": "hima-andes-cell-timing/1",
  "agent": "himatime",
  "round": 1,
  "summary": "With the new XNOR3 and BUF cells the worst path A1 is 168.5 ps faster; key expansion (B1) limits Fmax next.",
  "worstPath": "A1",
  "localGainPs": 168.48,
  "paths": [
    { "id": "A1", "beforePs": 1044.2, "afterPs": 875.72, "gainPs": 168.48 },
    { "id": "B1", "beforePs": 1041.45, "afterPs": 1014.17, "gainPs": 27.28 }
  ],
  "cells": [
    { "name": "ANDES_XNOR3_F1_R1", "fo4Ps": 38.1, "stockCell": "XNOR3_X1", "stockFo4Ps": 56.0 }
  ],
  "report": "reports/himatime-verify/r1/analysis.md"
}
```

- `worstPath`, `localGainPs`: HimaTime's worst path of the build this round started from and its
  gain in ps with the new cells. `paths`: worst first, at least the worst path; every listed path
  is one of HimaTime's 8 with its numbers. `cells`: every new cell of `generation`, with its FO4
  and its stock cell's. Numbers agree with HimaTime within 0.5 ps.
- `report`: `reports/himatime-verify/r<k>/analysis.md`; deliver `verify.rpt` beside it.

## Cell screen (hima-andes-cell-screen/1): qualib-screen

```json
{
  "schema": "hima-andes-cell-screen/1",
  "agent": "qualib",
  "round": 1,
  "summary": "4 of 6 cells pass; both extra-fast variants fail on leakage and input capacitance.",
  "cells": [
    { "name": "ANDES_XNOR3_F1_R1", "status": "PASS", "reasons": [] },
    { "name": "ANDES_XNOR3_XF4_R1", "status": "FAIL", "reasons": ["input cap 1.34x stock > 1.30x", "leakage 2.90x stock > 2.50x"] }
  ],
  "report": "reports/qualib-screen/r1/analysis.md"
}
```

- `cells`: every new cell of `generation` exactly once. A cell that `qualib screen` fails cannot
  be PASS; a FAIL needs its reasons. Only PASS cells enter the rebuild.
- `report`: `reports/qualib-screen/r<k>/analysis.md`; deliver `cell_screen.rpt` beside it.

## Precheck and delivery

```
python3 <campaign>/flow/andes_cli.py precheck <campaign> <kind> <your file>
```

`<kind>` is `himatime`, `qualib`, `andescell`, `himatime-verify` or `qualib-screen`. It runs the
same check as the Pack's Reader (for the verify files it asks HimaTime and Qualib for their own
answer) and prints every problem, or `precheck PASS`. Deliver the file as the one `result` artifact
and your reports as `support`. A refused delivery comes back with the problems; repair it in the
same task.
