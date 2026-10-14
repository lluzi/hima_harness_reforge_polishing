# Delivery files

Every agent delivers one JSON object as the `result` of its task and its reports as `support`.
`k` is `timingState.round`. Reports live in your private workspace at `reports/<your step>/r<k>/`
(the step is `himatime-agent`, `qualib-agent`, `andescell-agent`, `himatime-verify` or
`qualib-screen`) and land at the same path in the Campaign. `report` names your `analysis.md`
there. Support paths are immutable: a repair in the same round writes the same path only if it is
unchanged, otherwise a new name (e.g. `analysis-2.md`).

You never type a tool's numbers. **Draft** each file from the tool's own output, then write the
`summary` (and the plan's `reason`) in your own words, and **precheck** it:

```
python3 <campaign>/flow/andes_cli.py draft <campaign> <kind> [<tool json>] > <file>
python3 <campaign>/flow/andes_cli.py precheck <campaign> <kind> <file>
```

| kind | tool json | file |
| --- | --- | --- |
| `himatime` | `./hw/whatif.json` (`himatime whatif --scale 0.9 --out ./hw`) | arcs to customize |
| `qualib` | `./ql/library_analysis.json` (`qualib analyze --arcs ./hw/whatif.json --out ./ql`) | cells and constraints |
| `andescell` | none (it reads both accepted requirement files) | generation plan |
| `himatime-verify` | `./hv/verify.json` (`himatime verify --out ./hv`) | cell-level check |
| `qualib-screen` | `./qs/screen.json` (`qualib screen --cells ./hv/kept --out ./qs`) | cell screen |

Without a tool json the draft asks the tool itself. The draft leaves `summary` (and `reason`)
empty: the precheck refuses an empty one. Edit the file with your editor; keep it one JSON object.

## Requirements (hima-andes-requirements/2): himatime-agent

```json
{
  "schema": "hima-andes-requirements/2",
  "agent": "himatime",
  "round": 1,
  "summary": "HimaTime narrows the design to its high-value cells; the what-if merges seven rankings into the arcs below, led by ...",
  "arcs": [
    { "cell": "ND2D1X", "from": "A1", "to": "ZN", "edge": "fall", "rankedBy": ["TNS", "TSC_F"], "tnsGainNs": 0.012, "wnsGainNs": 0.0 }
  ],
  "report": "reports/himatime-agent/r1/analysis.md"
}
```

- `arcs`: arcs of HimaTime's merged what-if list (`himatime whatif --scale 0.9`), each once, with
  the rankings that name it and its best TNS and WNS what-if gain in ns, as HimaTime prints them.
  List every arc of the merged list (the draft does); say in `summary` and the analysis which arcs
  matter most. You may not drop, add or change one.

## Requirements (hima-andes-requirements/2): qualib-agent

```json
{
  "schema": "hima-andes-requirements/2",
  "agent": "qualib",
  "round": 1,
  "summary": "ULVT is already the fastest Vt on most of the requested arcs; LVT and SVT are slower; only a custom cell helps.",
  "cells": ["ND2D1X", "INVD2X"],
  "constraints": { "footprint": "same area and pins as the stock cell", "inputCapMaxRatio": 1.3, "lvs": "match" },
  "notes": { "INVD2X": "LVT is faster than ULVT at the table centre on its requested arc" },
  "report": "reports/qualib-agent/r1/analysis.md"
}
```

- `cells`: every cell of `qualib analyze` on the what-if arcs, each once (the draft lists them). A
  remark about one cell, such as a stock Vt that is faster on some arcs, goes in `notes`; the cell
  stays listed, because only the measured cell-level gain keeps or drops a custom cell. `constraints`: Qualib's own
  (`inputCapMaxRatio` and `lvs` as the analysis states them; `footprint` in words).

## Generation plan (hima-andes-plan/2): andescell-agent

```json
{
  "schema": "hima-andes-plan/2",
  "agent": "andescell",
  "round": 1,
  "summary": "Every arc HimaTime asked for sits on a cell Qualib lists; the plan takes them all.",
  "arcs": [ { "cell": "ND2D1X", "from": "A1", "to": "ZN", "edge": "fall" } ],
  "settings": { "iterations": 50, "scale": 0.9 },
  "reason": "All arcs both lists allow, at the Site's AndesCell settings: 50 iterations per arc toward a 10 % faster arc.",
  "report": "reports/andescell-agent/r1/analysis.md"
}
```

- `arcs`: each one of the HimaTime agent's arcs whose cell the Qualib agent lists, each once.
- `settings`: `iterations` 50 and `scale` 0.9 (the Site's AndesCell data). `reason`: a sentence or two.

## Cell-level check (hima-andes-cell-check/1): himatime-verify

```json
{
  "schema": "hima-andes-cell-check/1",
  "agent": "himatime",
  "round": 1,
  "summary": "HimaTime keeps the generated cells whose arc beats the stock cell; the rest are dropped.",
  "generated": 6, "kept": 4, "dropped": 2,
  "keptArcs": ["ND2D1X_A1_ZN_fall"],
  "report": "reports/himatime-verify/r1/analysis.md"
}
```

- `generated`, `kept`, `dropped` and `keptArcs` (arc names `<cell>_<from>_<to>_<edge>`) exactly as
  `himatime verify` reports them for `<campaign>/<generation.dir>` against the build this round
  started from.

## Cell screen (hima-andes-cell-screen/2): qualib-screen

```json
{
  "schema": "hima-andes-cell-screen/2",
  "agent": "qualib",
  "round": 1,
  "summary": "Every kept cell keeps the footprint and passes LVS; input capacitance stays within 1.30x.",
  "cells": [
    { "arc": "ND2D1X_A1_ZN_fall", "status": "PASS", "reasons": [] },
    { "arc": "INVD2X_I_ZN_rise", "status": "FAIL", "reasons": ["input cap 1.341x stock > 1.30x"] }
  ],
  "report": "reports/qualib-screen/r1/analysis.md"
}
```

- `cells`: every cell HimaTime keeps, exactly once. A cell that `qualib screen` fails cannot be
  PASS; a FAIL needs its reasons. Only PASS cells enter the rebuild.

## Delivery

Deliver the file as the one `result` artifact and your reports as `support`. A refused delivery
comes back with the problems; repair it in the same task (draft again from the tool output when the
numbers are off).
