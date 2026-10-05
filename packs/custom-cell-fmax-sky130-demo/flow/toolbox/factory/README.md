# Cell factory

Turns a batch of Boolean cell specs into SKY130 standard cells (sky130hd row: 2.72 um tall, width a
multiple of the 0.46 um `unithd` site) with GDS, LEF, an RC-extracted SPICE netlist, DRC and LVS
results, and a per-batch manifest. No hand work: write a spec, run one command, read
`manifest.json`, use the cells whose `state` is `clean`.

Pipeline per cell: bool2cmos (function -> transistors) -> sizing variant -> switch-level check ->
LibreCell layout -> post-process fixes -> Magic extraction -> Netgen LVS -> KLayout DRC (two decks)
-> LEF normalization -> OpenROAD pin access (`../pinaccess/check.py`). A cell that fails is retried with another layout (up to 6 attempts) and the
best attempt is kept.

## Run it

Inside the sandbox (IIC-OSIC-TOOLS image; `PDK_ROOT`, `PDK=sky130A` and the tools are already set):

```sh
F=<campaign>/flow/toolbox/factory            # this directory
python3 $F/factory.py check spec.json                          # validate only, no tools, < 1 s
python3 $F/factory.py run spec.json --out cells/r<k>/factory --jobs 16
python3 $F/factory.py summarize cells/r<k>/factory             # yield table again
```

`run` exits 0 when every cell is clean, 3 when some are not, 2 on spec errors. Re-running into the
same `--out` reuses every cell that is already clean with the same spec and the same factory
version (`--force` rebuilds). `--only NAME,NAME` builds a subset. Other flags: `--attempts N`
(default 6), `--profiles strict-m1,relaxed-m1,strict,relaxed`, `--drc-deck mr,lydrc-feol`,
`--layout-timeout S` (per LibreCell run, default 240), `--site-nm 460`, `--route-max-iter 60`,
`--place-candidates 2`, `--pa-tech-lef`, `--pa-tracks`.

The pin-access stage needs `openroad` on `PATH`, `toolbox/pinaccess/` next to `factory/`, and the ORFS
sky130hd platform: `$ORFS_PLATFORM_DIR` [`$CELLUZI_ROOT/OpenROAD-flow-scripts/flow/platforms/sky130hd`]
for `lef/sky130_fd_sc_hd.tlef`, `lef/sky130_fd_sc_hd_merged.lef` (foundry neighbours) and
`make_tracks.tcl`.

Environment the factory reads (defaults in brackets): `CELLUZI_ROOT` [/data/eda/project/celluzi]
for the LibreCell venv, `BOOL2CMOS_ROOT` [/data/eda/project/bool2cmos], `PDK_ROOT` [/foss/pdks],
`PDK` [sky130A]. Both roots may be read-only. Everything is written under `--out`.

From the linglong host (what the 2026-10-04 proof used):

```sh
D=/data/eda/project/hima_harness/cellfmax-runs/factory-dev
podman run --rm --userns=keep-id --cpus=16 \
  -v /data/eda/project/celluzi:/data/eda/project/celluzi:ro \
  -v /data/eda/project/bool2cmos:/data/eda/project/bool2cmos:ro -v $D:$D:rw \
  localhost/iic-osic-celluzi-hima:2026.06 /bin/bash -c 'export PATH=/foss/tools/bin:/foss/tools/klayout:/usr/bin:/bin \
  PYTHONPATH=/usr/local/lib/python3.12/dist-packages:/usr/lib/python3/dist-packages \
  LD_LIBRARY_PATH=/foss/tools/klayout PDK_ROOT=/foss/pdks PDK=sky130A; cd '$D'; \
  python3 factory/factory.py run factory/examples/batch24.json --out runs/b3 --jobs 16'
```

Give `--jobs` the number of CPUs you have (each job runs one single-threaded tool at a time).

## Spec

```json
{
  "jobs": 16,
  "cells": [
    {"name": "NOR3_PU2", "outputs": {"Y": "!(A|B|C)"}, "inputs": ["A", "B", "C"], "variant": "PU2",
     "notes": "rise-skewed nor3"},
    {"name": "NOR2_PUA2", "outputs": {"Y": "!(A|B)"}, "variant": {"pullup": {"A": 2}}},
    {"name": "XOR2_OPU2", "outputs": {"X": "A^B"}, "variant": {"pullup": {"out:X": 2}}},
    {"name": "MO_HA", "outputs": {"S": "A^B", "CO": "A&B"}, "inputs": ["A", "B"]}
  ]
}
```

- `name`: `[A-Za-z][A-Za-z0-9_]{0,63}`, unique in the batch; it is the subckt, GDS top cell and
  LEF macro name.
- `outputs`: `{pin: function}`, one entry per output. Liberty syntax as bool2cmos parses it:
  `!X ~X X'` not, `&` `*` or juxtaposition and, `^` xor, `|` `+` or; precedence
  or < xor < and < not (so `A^B&C` is `A^(B&C)`). Several outputs make one multi-output cell that
  may share internal logic.
- `inputs`: pin order (default: order of first appearance). Every input must be used; at most 8.
  Pin names `VPWR VGND VPB VNB VDD GND VSS VCC` are reserved.
- `variant` (optional) sizes the bool2cmos netlist (base widths are sky130_fd_sc_hd `_1`: NMOS
  0.65 um, PMOS 1.0 um):
  - `"PU2"`, `"ND2"` (= `"PD2"`), `"PU2ND2"`, `"PU1.5"`: every PMOS / NMOS times the factor.
  - `{"pullup": {...}, "pulldown": {...}}` with keys `"all"`, an input pin (every device whose gate
    is that pin), an internal gate net of the bool2cmos netlist (e.g. `n2`), or `"out:<net>"` (every
    device of the stage that drives that net, e.g. `out:X` = only the output stage). Precedence per
    device: gate-net key > `out:` key > `all`. Factors 0.5 to 8.
  - A factor f becomes ceil(f) parallel fingers of width w*f/ceil(f) (rounded to 0.01 um, at least
    0.42 um); a factor below 1 makes one narrower device. Fingers keep every device inside the fixed
    row height; Netgen merges parallel fingers, so LVS compares total width.
- `notes`: free text, copied to `status.json`.
- `jobs`: default for `--jobs`.

`check` reports every invalid cell at once (bad name, undeclared or unused input, unparsable
function, unknown variant key) and builds nothing.

## Outputs

`<out>/manifest.json`: `summary` (cells, clean, cleanYield, `stageYield` = passed/of per stage,
`failureClasses` = class -> cell names), `wallSeconds`, the DRC decks, the clean policy, and one row
per cell (state, seconds, DRC count and rules, Magic DRC count, LVS verdict, device count, failure).

`<out>/<NAME>/`, files of the best attempt:

| File | What |
| --- | --- |
| `NAME.sp` | sized source netlist, sky130 primitives (`sky130_fd_pr__nfet_01v8`, `__pfet_01v8_hvt`), pins `<inputs> <outputs> VGND VNB VPB VPWR` |
| `NAME.gds` | final layout (post-processed); `NAME.raw.gds` is LibreCell's output |
| `NAME.lef` | sky130hd abstract: pins `VPWR`/`VGND` (USE POWER/GROUND), `VPB`/`VNB` on the rails, inputs `DIRECTION INPUT`, outputs `DIRECTION OUTPUT`, OBS without pin metal (an OBS rect touching a signal pin's port on its layer is moved into the pin); width snapped to the site; metal the post-processor added is in its pin (if it touches one) or in OBS |
| `NAME.ext.spice` | Magic RC extraction for characterization: `.subckt NAME <inputs> <outputs> VGND VNB VPB VPWR`, all coupling and substrate capacitors (`cthresh 0`), `**FLOATING` removed. The cells are tapless (like sky130_fd_sc_hd): Magic sees the n-well and the substrate as floating nodes; they are renamed to `VPB` and `VNB` here, original names in `status.json` -> `wellNodes` (`nwellNodes`, e.g. `w_n11_257#`; `substrateNodes`, `VSUBS`) |
| `NAME.magic.spice` | Magic's RC netlist unchanged (rails `VDD`/`GND`, port order as Magic wrote it) |
| `NAME.lvs.spice`, `NAME.lvs.log` | device-only extraction and the Netgen report |
| `NAME.drc.xml` | KLayout report of the first deck; per-deck reports are in `tryK/NAME.drc.<deck>.xml` |
| `magic_drc.txt` | Magic `drc(full)` counts by rule (advisory, see below) |
| `postprocess.json` | every automatic fix applied (rects in um) and what could not be fixed |
| `status.json` | `state`, `stages` (ok, seconds, details per stage), `attempts` (profile, seed, LVS, DRC per try), `bestTry`, `failure`, `wellNodes`, `files`, `specHash` |
| `tryK/` | every attempt with its logs (`layout.log`, `postprocess.log`, `extract.log`, `lvs.log`, `drc.log`, `lef.log`) |

`state`: `clean`, `layout-not-clean` (a layout exists but LVS, DRC, extraction, LEF or pin access
failed; do not deliver it as a real cell), `failed` (no layout). `tryK/pinaccess.json` is the
pin-access report of each attempt (`../pinaccess/README.md`); `status.json` -> `stages.pinaccess`
has `accessPoints` per pin and `noAccess`.

## What "clean" means

`clean` = Magic extraction has every signal pin as a port, Netgen says `Circuits match uniquely`
(pins compared; only pins that every output function is symmetric in are declared permutable), the
LEF has exactly the spec pins plus the four power pins, OpenROAD's detailed router finds an access
point on every signal pin (`pinaccess`, see "Router pin access"), and **both** KLayout decks report
zero items:

1. `mr`: `$PDK_ROOT/sky130A/libs.tech/klayout/drc/sky130A_mr.drc` with `feol=true beol=true
   offgrid=true` (seal ring and floating-metal checks off: not meaningful for one cell).
2. `lydrc-feol`: `sky130A.lydrc` with its hard-coded `FEOL = false` switched to true (patched copy in
   `<out>/.factory/`). It codes rules `mr` lacks (licon.8a, licon.14, npc) and counts the pin-purpose
   layers as metal.

celluzi ran only `sky130A.lydrc` with FEOL off. Its "clean" NOR3_PU2
(`$CELLUZI_ROOT/lib/tlo/_nor3_pu2`) has 9 items there (li.6, m1.6) and 40 under `mr` (li.5, m1.5,
poly.2, li.6, m1.6). The factory's NOR3_PU2 has 0 under both decks.

Magic `drc(full)` runs too; its count is reported, not gated. For every factory cell it still reports:
- `nwell.4`, `LU.2`, `LU.3` (well taps): expected, the cells are tapless and get their ties from the
  row's tap cells, like sky130_fd_sc_hd.
- `licon.9 + psdm.5a` (poly contact to P-diffusion < 0.235 um): **real and not fixed**. The gate
  contact sits on LibreCell's 1.19 um channel track, 0.19 um below the PMOS diffusion; psdm must
  enclose the diffusion by 0.125 and stay 0.11 from the contact, which needs 0.235. Neither KLayout
  deck codes licon.9. Two probes (moving the track to 1.16 um; moving the contacts down in
  post-processing with a 0.60 um channel) removed it only by creating li.3 / m1.2 / licon.5c
  markers, so both were backed out (the second is kept behind `-rd liconshift=1`). Treat it as a
  known waiver until the LibreCell channel geometry is re-tuned.
- `licon.5c` (diffusion overlap of a diffusion contact < 0.06 on one of two adjacent sides) on some
  cells: Magic only, not coded in either KLayout deck; not fixed.

## Automatic fixes

In the LibreCell tech (`librecell_sky130_tech.py`, factory copy) and `postprocess_cell.py`; every
change is recorded in `postprocess.json`.

| Fix | Rule |
| --- | --- |
| gate pitch 0.50 um, width snapped up to a 0.46 um multiple (rails, n-well, boundary extended) | poly.2, li.5 between adjacent gate contacts |
| (x, y) contact enclosures in the tech, so LibreCell draws li1/met1/met2 pads and routes around them | li.5, m1.5, via.5a, m2.5, li.6, m1.6 |
| transistor offset 255 nm, channel gate extension 285 nm | licon.14 |
| gate jogs over diffusion trimmed, nsdm/psdm/hvtp drawn (celluzi) | device typing, LVS |
| poly pads grown to 0.08 on two sides; npc over every poly contact | licon.8a, licon.15, npc.1/2 |
| only pin-name labels kept on 67/5, 68/5, 69/5 | internal nets became ports (LVS pin mismatch) |
| enclosure pads where still missing | li.5, m1.5, via.5a, m2.5 |
| same-net gaps bridged (nets traced poly-licon-li1-mcon-met1-via-met2) | li.3, m1.2, m2.2 |
| over-sized via-pad overhangs trimmed when they crowd another net | m1.2, m2.2, li.3 |
| undersized islands grown along the free side | li.6, m1.6, m2.6 |
| pin-purpose shapes clipped to the final metal | m1.2 under `lydrc-feol` |

Attempts: LibreCell is deterministic per `PYTHONHASHSEED`, and another seed gives another layout.
Attempts interleave four profiles, seed by seed: `strict-m1` and `relaxed-m1` (LibreCell routes in li1
and met1 only, see "Router pin access"), then `strict` and `relaxed` (li1, met1 and met2). `strict`
uses the tech enclosures above and `relaxed` the celluzi enclosures (easier to route;
post-processing adds the pads where they fit). With `--attempts 3` that is strict-m1, relaxed-m1 and
strict at seed 0. The first clean attempt wins; otherwise the best by (LVS ok, fewest DRC items,
fewest pins without access). No new attempt starts once a cell has
spent `--cell-budget` seconds (default 300).

## Router pin access

Stage `pinaccess` runs `../pinaccess/check.py` on the attempt's LEF: OpenROAD `pin_access` (what ORFS
runs before global routing) on copies of the cell in all four orientations, isolated and abutted to
mirrored copies and to foundry cells. A cell is `clean` only if every signal pin of every copy has an
access point. `status.json` -> `stages.pinaccess.accessPoints` is the count per pin, summed over the
four orientations.

Why: the 2026-10-04 dry run (ws-f, 149 cells clean by DRC/LVS) aborted at `5_1_grt` with DRT-0073
twice (16 cell types, then 8 more after those were removed). `check.py` finds 90 of the 149 without
access, including every pin both ORFS logs name. Two causes, both falsified one at a time on that LEF:

1. **met2 above the pins.** OpenROAD reaches a met1 pin of a standard cell by a via1 to met2.
   LibreCell routed inside the cell on met2 too, in vertical wires between the gate columns; the met1
   pin squares of adjacent inputs sit 0.21 um apart on one met1 track with such a wire 0.03-0.07 um
   beside them, so no via1 (met2 pad 0.26 x 0.32, met2 spacing 0.14) fits and no met1 wire can leave
   sideways. Deleting the met2 OBS from the LEF (a probe, not a fix) leaves 9 failing cells instead of 90.
   Fix: the `-m1` profiles (`tech_m1_overrides.py`) route in li1 and met1 only, like sky130_fd_sc_hd,
   and are tried first. Every `-m1` layout of the rebuild had pin access; met2 layouts are kept only when
   the check passes.
2. **Pin metal in OBS.** Some met1 rects of a pin's net were written to OBS flush against the pin
   (rect decomposition and post-process trims), e.g. `C_NOR2_NDB2/Y`; the router treats them as foreign
   metal touching the pin. `absorb_pin_obs` moves every OBS rect that touches exactly one signal pin on
   its layer into that pin (touching metal is one net in a DRC-clean cell). With both fixes applied to
   the ws-f LEF the probe passes 149/149; with only this one, 72/149.

Pins stay met1 squares on the 1.19 um track (LibreCell's pin layer), not li1 shapes like the foundry
cells: most pins get 1-2 access points per orientation (foundry: at least 3). `check.py
--min-access-points` can demand more; the factory uses the router's own threshold (1).

## Timing and yield (linglong, 2026-10-04, `examples/batch24.json`, --jobs 16)

Final run `runs/b4` (factory-dev on linglong), 24 specs, `--jobs 16`, decks `mr,lydrc-feol`:

| Stage | netlist | layout | postprocess | extract | LVS | DRC (both decks 0) | LEF |
| --- | --- | --- | --- | --- | --- | --- | --- |
| passed / 24 | 24 | 19 | 19 | 19 | 19 | **13** | 19 |

- Wall time 558 s for the batch. The 13 clean cells were all done after 77 s; the rest is the
  failing cells using their 300 s budget (`--cell-budget`). A clean attempt costs about 10 s of one
  CPU (LibreCell 3-5 s, post-process 1.3 s, Magic 0.3 s, Netgen < 0.1 s, two KLayout decks 4 s);
  9 of the 13 were clean on the first attempt.
- Clean: NOR2_PU2, NOR2_PUA2, NOR3_PU2, NOR3_ND2, NAND2_ND2, NAND2_PU2, NAND3_ND2, NAND3_NDA2,
  A21OI_PU2, A21OI_NDB2, A22OI_PU2, A211OI_PU2, MO_NAND2_NOR2 (multi-output).
- Every cell with a layout matched LVS (19/19).
- `examples/nor3_pu2.json` alone (`runs/nor3_pu2`): clean in 44 s, 9 devices (6 PMOS fingers, 3
  NMOS), Netgen `Circuits match uniquely`, 0 items in `mr`, `lydrc-feol` and celluzi's deck, 45
  capacitors in `NOR3_PU2.ext.spice`, 3.68 x 2.72 um.

How the yield got there (same 24 specs):

| Run | Change | Clean | Wall |
| --- | --- | --- | --- |
| b0 | celluzi tech and post-process, `mr` deck | 0 | > 20 min (routes capped at 1000 iterations) |
| b1 | 0.50 um pitch, tech enclosures, pads/gap fill/trim/min-area, seeds, `mr` deck | 14 | 1827 s |
| b2 | gate on `mr` + `lydrc-feol`; licon.14, licon.8a, npc, pin-layer clip | 13 | 764 s |
| b3 | relaxed profile interleaved | 13 | 1172 s |
| b4 | gap fills on the 5 nm grid, 300 s cell budget | 13 | 558 s |

(b1's 14 were clean under `mr` only; under the stricter b2+ gate the same cells needed the FEOL
fixes.)

## Failure classes and what to do

Grouped by rule; `manifest.json` -> `summary.failureClasses` lists the cells.

| Class | Cells in b4 | What happens | What to do |
| --- | --- | --- | --- |
| `layout:routing-congestion` | XNOR2_PU2, XOR2_ND2, XOR2_OPU2, MUX2I_PU2, MUX2I_ND2 (15-18 devices, single output) | LibreCell's one-row router does not converge on any placement or seed. Not tech-specific: with celluzi's tech these failed at 1000 iterations too (b0). | Do not ask for skewed xor2/xnor2/mux2i; a plain two-output {xor2, xnor2} does route. Fewer devices route better. |
| `drc:li.5+li.6` (one contact) | O21AI_ND2, O21AI_PU2, MO_HAN | The strict profile did not route or left m1.2; the relaxed layout has one contact whose li1 pad cannot fit (li.5) and whose landing stays below 0.0561 um2 (li.6). | Treat as not clean. More seeds (`--attempts 12 --cell-budget 600`) may help; not tried. |
| `drc:difftap.3` + pad classes | MO_XOR2_XNOR2, MO_HA, MO_XOR3_MAJ3 | Diffusion breaks are 0.25 um apart with the 0.50 um pitch (difftap.3 needs 0.27); dense multi-output routing leaves li.5 / m1.5 / via.5a / m2.5 pads that do not fit. | Not clean; the extraction and LVS of these cells are valid if you want to model them, but do not deliver the GDS. |
| `layout:lclayout-lvs` | none in b4 (MO_XOR2_XNOR2 in b1, every seed) | LibreCell's own LVS refused the layout. | Another seed or profile. |
| `layout:timeout` | none in b4 | One LibreCell run took more than `--layout-timeout`. | Raise `--layout-timeout`. |
| `lvs:pin-mismatch` | none in b4 | An internal net became a port (fixed by the label filter) or pins really differ. | Read `NAME.lvs.log`. |
| `netlist:*` | none | bool2cmos refused the function, or the sized netlist failed the switch-level check. | Read `netlist.log`. |

Magic-only classes (not gated): `licon.9 + psdm.5a` on every cell, `licon.5c` on some, `nwell.4`
/ `LU.2` / `LU.3` everywhere (tapless). See "What clean means".

## Tests

`python3 -m unittest test/contract/support/cellfmax_factory_test.py` (from the repository root)
covers the pure-Python parts: expression grammar and symmetry, spec validation, sizing transforms,
switch-level check, emitted netlists, LVS/DRC report parsing, extraction normalization, attempt
ranking, manifest yield, and the LEF normalization (multi-output) and LEF edits.

## Not verified

- No factory cell has been placed and routed in ORFS yet; the LEF pin/OBS geometry was checked only
  by pin names and the unit tests. LibreCell's met1 pin ports are the whole met1 shape of the net,
  not on the sky130hd routing tracks.
- `NAME.ext.spice` has not been run through the characterizer.
- No Liberty is produced; use the toolbox Liberty scripts or the characterizer.
- Cells are larger than LibreCell's 0.46 um pitch would give (0.50 um gate pitch plus the site
  snap): NOR3_PU2 is 3.68 um wide (8 sites); celluzi's was 3.22 um (7 sites, not DRC-clean).
