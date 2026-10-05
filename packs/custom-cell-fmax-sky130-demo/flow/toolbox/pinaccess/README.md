# Pin-access check

Tells, per LEF macro, whether OpenROAD's detailed router can reach every signal pin: the analysis
ORFS runs as `pin_access` right before global routing, where an unreachable pin aborts the whole
flow with `[ERROR DRT-0073] No access point for <inst>/<pin>`. Use it to keep such cells out of a
library before they reach an ORFS arm.

```sh
P=$ORFS/flow/platforms/sky130hd
python3 check.py --tech-lef $P/lef/sky130_fd_sc_hd.tlef --platform-lef $P/lef/sky130_fd_sc_hd_merged.lef \
  --tracks $P/make_tracks.tcl --lef custom.lef [--lef more.lef] [--cells A,B | --cells-file names.txt] \
  [--liberty custom.lib] --out pinaccess.json [--jobs 8] [--work DIR --keep]
```

Needs `python3` (stdlib) and `openroad` on `PATH` (IIC-OSIC-TOOLS image, OpenROAD 26Q2). Exit 0
when the check ran, whatever the cells' verdicts; 1 when some cell could not be judged (OpenROAD
failed for another reason than access; listed in `summary.toolErrors`, verdict `ok: false`); 2 on
usage errors (unknown cell, missing SITE).

| Option | Meaning |
| --- | --- |
| `--tech-lef` | routing tech LEF (layers, vias, SITE). Use the ORFS platform one: its rules are what the router applies. |
| `--platform-lef` | platform cell LEF: the foundry neighbours of the context rows come from it, and a `--cells` name not found in `--lef` |
| `--lef` | custom cell LEF(s); default cell list = every MACRO in them |
| `--tracks` | the platform `make_tracks.tcl` (default: `make_tracks` from the tech LEF pitches) |
| `--layers` | signal routing layers, default `met1-met5` (ORFS sky130hd MIN/MAX_ROUTING_LAYER) |
| `--orients` | orientations of the isolated copies, default `N,FS` |
| `--neighbors` | foundry cells at both ends of the abutted rows, default `sky130_fd_sc_hd__nand2_1,sky130_fd_sc_hd__a21oi_1` |
| `--no-context` | isolated copies only (no abutted rows, no platform LEF needed) |
| `--jobs`, `--group` | parallel OpenROAD processes (one thread each); cells per process (default: spread over the jobs, at most 12) |
| `--pin-access-args` | extra `pin_access` arguments (ORFS passes none for sky130hd) |
| `--min-access-points N` | a pin also fails when it has fewer than N access points per unique instance (default 1, the router's own limit; foundry cells have at least 3) |
| `--no-edge-check` | skip the edge-margin rule below |

## What it builds

Per cell, in a DEF with the platform rows (unithd, alternating N/FS) and tracks:

- isolated copies, one per `--orients` orientation, three sites apart from anything;
- two abutted rows, `foundry | N | FN | N | foundry` and `foundry | FS | S | FS | foundry`: each copy
  touches a mirrored copy of itself on one side (left-left and right-right abutment) and a foundry
  cell on the other, in all four legal orientations.

Every signal pin of every instance (foundry neighbours too) is on its own net to an IO pin on the die
edge (met3, on track). `set_routing_layers -signal met1-met5`, then `pin_access`, in one
single-threaded `openroad -python` process per group of cells (`pa_openroad.py`).

`pin_access` stops at the first batch with a pin it cannot reach and names, per failing instance, the
first such pin. The check then reruns the group with the named pins left unconnected (pin_access skips
unconnected pins) until the run completes, so every pin without access is found and the other pins'
access points are counted. A run that fails without naming a pin is split into single cells;
`DRT-0085` (each pin has access points but no conflict-free combination exists) on a single cell is a
cell failure.

Edge margin (no OpenROAD needed): a cell also fails when a signal-pin or OBS rect on a routing layer
(not a full-width rail) comes closer than half that layer's tech-LEF `SPACING` to the left or right
cell edge (li1 0.085 um, met1/met2 0.07 um). Abutted to another cell such metal shorts or violates
spacing inside the cells, which the detailed router cannot repair. No core cell of
`sky130_fd_sc_hd_merged.lef` (440) breaks it; 62 of the 102 pin-accessible factory cells of the
first rebuild did (li1 routed on the x = 0 column).

## Output

```json
{"schema": "pinaccess/1", "seconds": 9.8, "summary": {"cells": 149, "ok": 149, "failed": 0, "toolErrors": []},
 "copies": ["N0", "FS0", "N1", "FN2", "N3", "FS1", "S2", "FS3"],
 "cells": {"C_O21AI_PUA12": {"ok": false, "error": "no access point: A2",
   "pins": {"A2": {"accessPoints": 0, "byCopy": {"N0": 0, "FS0": 0, "N1": null, "...": null}},
            "A1": {"accessPoints": 12, "byCopy": {"N0": 1, "FS0": 1, "...": 1}}}}}}
```

- `ok`: every signal pin of every copy has an access point, pin_access completed, and the edge
  margin holds (`edgeViolations` lists the offending rects).
- `accessPoints`: access points of the pin summed over the cell's unique instances (the router's
  classes of copies with the same orientation and track offset: four on sky130hd, where the tracks
  repeat every site); 0 for a pin DRT-0073 named. `perInstance` = accessPoints / `uniqueInstances`.
  The odb Python API does not say which unique instance an access point belongs to, so no
  per-orientation count is given.
- `byCopy`: preferred access points of each placed copy (1 per pin shape group when reachable), 0 when
  DRT-0073 named that copy, `null` when not analysed (the router names one copy per unique instance).

## Validation (linglong, 2026-10-04, OpenROAD 26Q2-2270)

| Library | Cells | ok | Seconds (`--jobs 8`, `--cpus 8`) |
| --- | --- | --- | --- |
| foundry `sky130_fd_sc_hd_merged.lef`, isolated copies | 441 | 441 (lowest: 3 access points per orientation) | 74 |
| celluzi `NOR3_PU2.sky130hd.lef` (routed in ORFS before), raw and OBS-fixed | 1 | 1 | 0.4 |
| ws-f `cells/r1/library.lef` (149 factory-clean cells of the dry run) | 149 | 59 | see below |

On the ws-f library the check names all 16 cell types of the first `5_1_grt` failure
(`_12388_/A2 (C_O21AI_PUA12)`: A2 is the pin it names for that cell) and all 9 pins of the second
`5_1_grt` failure after those 16 were removed (`C_A211OI_PU2ND15/B1`, `C_A21OI_PU15/A2`,
`C_A22OI_PU2ND15/A1`, `C_A22OI_PUB12/A2`, `C_A311OI_PUC12/Y`, `C_O22AI_PU15/B2`, `C_O31AI_PU15/A2`,
`C_O31AI_PUA32/A2`), in all 90 failing cells. Isolated N,FS copies, all four orientations and the
abutted context rows gave the same 90 verdicts and the same pins.
