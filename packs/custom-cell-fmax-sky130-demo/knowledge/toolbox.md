# Toolbox

Everything runs inside your sandbox: the IIC-OSIC-TOOLS image (Ubuntu 24.04) with Yosys 0.66,
OpenROAD, OpenSTA (`sta`), KLayout 0.30, Magic 8.3, Netgen 1.5, ngspice, python3 3.12, g++ 13 and
cmake on `PATH`. `PDK=sky130A`, `PDK_ROOT=/foss/pdks`. Read-only roots:

| Path (environment variable) | What |
| --- | --- |
| `$CELLUZI_ROOT` = `/data/eda/project/celluzi` | earlier cell project: scripts, LibreCell venv, earlier cells |
| `$ORFS_ROOT` = `$CELLUZI_ROOT/OpenROAD-flow-scripts` | ORFS checkout (sky130hd platform, aes design) |
| `/data/eda/project/bool2cmos` | Boolean function → transistor SPICE |
| `$CELLFMAX_TOOLBOX` | built `emap_window` binary and mockturtle |
| the Campaign workspace | `flow/` (this Pack's tools, `flow/toolbox/`), `state/`, `runs/` (earlier arms) |

Write only in your private workspace (the current directory). Deliver files under `cells/r<k>/`.

The celluzi scripts were written for the celluzi container mount `/foss/designs/celluzi`. In your
sandbox that tree is at `$CELLUZI_ROOT`. Copy a script into your workspace and change the path, or
pass paths as arguments. Do not run `patch_lclayout_*.py` or `patch_welltap.py`: the LibreCell venv is
already patched and read-only.

Pack copies of the scripts are in `flow/toolbox/celluzi/` (sources and SHA-256 in
`flow/toolbox/SOURCES.json`).

## Inspect the design and the timing

- Baseline and earlier arms: `runs/baseline/` and `runs/r<j>/{custom,control}/` in the Campaign
  workspace, ORFS `WORK_HOME` layout: `results/sky130hd/aes/<variant>/{1_synth.v,6_final.v,6_final.odb,6_final.sdc,6_final.spef}`,
  `logs/sky130hd/aes/<variant>/*.json` (metrics), `top-paths.txt` (top 20 setup paths at finish).
  The variant is `base` for the baseline, `custom` or `control` for the arms.
- Your own STA: write a Tcl script and run `openroad -exit script.tcl` with
  `read_lef`/`read_liberty`/`read_def` or `read_db <6_final.odb>`, `read_sdc`, `read_spef`, then
  `report_checks -path_delay max -group_path_count 50 -fields {slew cap fanout}`.
- `flow/toolbox/celluzi/detect/` holds the earlier critical-path fusion detector (`run_critpath.py`,
  `sta_paths.tcl`, `dump_paths.tcl`); its Tcl files set `F` to the celluzi mount, change it to `$ORFS_ROOT/flow`.

## Trial ORFS run (your own comparison)

```sh
cd $ORFS_ROOT/flow
make DESIGN_CONFIG=./designs/sky130hd/aes/config.mk WORK_HOME=$PWD_OF_YOUR_WORKSPACE/trial-a \
  FLOW_VARIANT=trial NUM_CORES=8 \
  OPENROAD_EXE=/foss/tools/bin/openroad OPENSTA_EXE=/foss/tools/bin/sta \
  YOSYS_EXE=/foss/tools/bin/yosys KLAYOUT_CMD=/foss/tools/klayout/klayout \
  LIB_FILES=<merged.lib> ADDITIONAL_LEFS=<custom.lef> ADDITIONAL_GDS=<cell.gds ...> \
  DONT_USE_CELLS="<the 36 platform cells> [your cells for the control]" \
  SDC_FILE=<your copy of constraint.sdc with clk_period changed> finish
```

`WORK_HOME` must be inside your workspace (the ORFS tree is read-only). The 36 platform dont-use
cells are in `state/inputs.json` → `platformDontUse`. Merge your cells into the platform Liberty with
`python3 flow/toolbox/celluzi/scripts/merge_lib.py <platform.lib> <custom.lib> <merged.lib>`
(platform Liberty: `$ORFS_ROOT/flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib`).
A cell without GDS needs `GDS_ALLOW_EMPTY=<name|name>`. Run at most two trials at once. One run
takes about 8–20 min. Metrics: `logs/.../6_report.json` → `finish__timing__setup__ws`.

## Build cells in volume: abstract cells (seconds)

```sh
A=<campaign>/flow/toolbox/abstract
python3 $A/abstract_cells.py spec.json <k> "$PWD" --jobs 16 --out cells.json
```

Same spec format as the factory below, plus `compareTo` (required) and, for a cell whose pins differ
from its foundry cell (multi-output, fused), `layoutFrom`: a list of `{"cell": "nand2_1", "pins":
{foundry pin: your pin or null}}` placed side by side (a `null` pin's shapes become obstruction).
Per cell it writes the sized SPICE netlist (bool2cmos + the variant, switch-level checked) and an
abstract LEF: the foundry cells' pin, rail and obstruction geometry, so the router reaches every
pin as it reaches the foundry cell's, widened by whole sites when your transistors are wider. The
recipe entries come out with `layout: abstract`; HimaHarness models their timing from the netlist.
236 cells take about 4 s; HimaHarness's characterization of them takes about 4–5 min. No GDS: the
arms set `GDS_ALLOW_EMPTY` for these cells.

```json
{"name": "MO_NAND2_NOR2", "inputs": ["A", "B"], "outputs": {"Y1": "!(A&B)", "Y2": "!(A|B)"},
 "compareTo": "sky130_fd_sc_hd__nand2_1",
 "layoutFrom": [{"cell": "nand2_1", "pins": {"A": "A", "B": "B", "Y": "Y1"}},
                {"cell": "nor2_1", "pins": {"A": "A", "B": "B", "Y": "Y2"}}]}
```

## Real layouts: the cell factory (minutes; measured, not modelled)

`flow/toolbox/factory/README.md` has the full spec format. In short:

```sh
F=<campaign>/flow/toolbox/factory
python3 $F/factory.py check spec.json                       # < 1 s, validates every spec
python3 $F/factory.py run spec.json --out factory-out --jobs 16 --attempts 3
python3 $F/to_recipe.py factory-out spec.json <k> "$PWD" --out cells.json
```

- A spec cell: `{"name", "outputs": {pin: function}, "inputs": [...], "variant": "PU2" | "ND2" |
  "PU1.5" | {"pullup": {pin|"all"|"out:<net>": factor}, "pulldown": {...}}, "compareTo":
  "sky130_fd_sc_hd__nor3_1", "footprint"?, "notes"?}`. Several outputs make one multi-output cell.
- Use the foundry cell's own pin names (A, B, C / A1, A2, B1 ...) and logic for drop-in variants:
  HimaHarness then gives the measured cell the foundry footprint and function text, so the resizer
  can swap it in. Give your own families one shared `footprint` and identical function strings.
- A clean cell takes about 10–15 s of one CPU (16 in parallel). "Clean" = Netgen LVS match and zero
  violations in two KLayout decks (sky130A_mr.drc FEOL/BEOL/offgrid and sky130A.lydrc with FEOL).
  Magic additionally reports licon.9/psdm.5a on every LibreCell gate contact; that is a documented
  waiver, not checked by either KLayout deck.
- Measured yield on linglong (24 diverse specs): NAND/NOR/AOI/OAI skew variants mostly clean;
  skewed XNOR2/XOR2/MUX2I (15–18 devices) often fail routing; dense multi-output cells (XOR2+XNOR2,
  half adder, XOR3+MAJ3) fail diffusion spacing; a plain two-output {nand2, nor2} is clean. Failed
  cells are left out of the recipe by `to_recipe.py`; their outcome stays in library.md.
- `to_recipe.py` copies every clean cell's `.sp`, `.gds`, `.lef`, `.ext.spice` into `cells/r<k>/lib/`,
  writes `cells/r<k>/library.lef` and `library.md`, and emits the recipe `library` object with SHA-256.

## Measure before you deliver (optional)

HimaHarness characterizes every cell itself after delivery. To prune hopeless cells or to back your
`agentClaim`, run the same characterizer (`flow/toolbox/char/README.md`). Abstract cells: spice =
the `.sp`, add `--netlist-kind pre-layout` and use `<campaign>/runs/calibration-prelayout/`
(`calibrate.py --netlist pre-layout` before the first characterize step, about 1 min). Clean
layouts: write a job from your clean cells (spice = the `.ext.spice`, functions, `index_ref` =
compareTo) and run
`python3 flow/toolbox/char/characterize.py job.json --reference-lib $ORFS_ROOT/flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib --calibration <campaign>/runs/calibration/calibration.json --out mychar --jobs 16`
(the Campaign's calibration exists after the first characterize step; before that, run
`calibrate.py` into your workspace, about 50 s). `compare_lib.py` prints point ratios against a
foundry cell.

## Single-cell tools (the factory wraps these)

bool2cmos (`PYTHONPATH=/data/eda/project/bool2cmos:$PYTHONPATH python3 -m bool2cmos ...`), LibreCell
(`$CELLUZI_ROOT/tools/librecell_venv/bin/python3 -c 'import sys; from lclayout.standalone import main; ...'`),
Magic extraction, Netgen LVS and the KLayout decks are all on the sandbox `PATH`; the celluzi copies in
`flow/toolbox/celluzi/` are the older single-cell scripts (their `/foss/designs/celluzi` paths are
`$CELLUZI_ROOT` here). Prefer the factory.

## Images for datasheets

`klayout -b -r render.py` with `pya.LayoutView()`, `load_layout(<gds>)`, `max_hier()`, `zoom_fit()`,
`save_image(<png>, 600, 900)`; set `QT_QPA_PLATFORM=offscreen`.

## Multi-output remapping with emap

See `flow/toolbox/emap/README.md` (exact commands, window cutting, stitching, equivalence check).
