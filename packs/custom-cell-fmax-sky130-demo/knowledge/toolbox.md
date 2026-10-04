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

## Build a cell

1. **SPICE.** Write the transistor netlist yourself or generate it with bool2cmos
   (`/data/eda/project/bool2cmos`, see its README). Examples: `flow/toolbox/celluzi/generate/lclayout_cells/*.sp`
   (NOR3_PU2, INV2X, fused cells), LVS references in `generate/lvs_ref/`.
2. **Layout (LibreCell).** `$CELLUZI_ROOT/tools/librecell_venv/bin/python3 -m lclayout.standalone
   --cell <NAME> --netlist <cell.sp> --tech $CELLUZI_ROOT/pdk/librecell_sky130_tech.py --output-dir <dir>`
   (the same command as `generate/run_lclayout.sh`). LVS failure means the cell is wrong; do not use
   `--ignore-lvs`. Minutes per cell; large cells can take much longer.
3. **Post-process and checks.** `generate/postprocess_cell.py`, Magic extraction (`extract_cell.sh`),
   Netgen LVS (`run_lvs.sh`), KLayout DRC with the full sky130A deck (`run_drc_cell.sh <gds> <top> <report.xml>`).
   A cell is `drc-lvs-clean` only when both passed; otherwise mark it `abstract` and say why.
4. **LEF.** `python3 flow/toolbox/celluzi/scripts/fix_lef_sky130hd.py <in.lef> --inputs A,B,C --output Y -o <out.lef>`
   renames VDD/GND to VPWR/VGND and adds VPB/VNB; `fix_lef_obs.py` adds obstructions.
5. **Modelled Liberty.** `python3 flow/toolbox/celluzi/scripts/estimate_lib.py enhance ...` scales the
   edge of a base foundry cell (`--edge rise|fall|both --derate 0.6`); `merge` composes fused cells;
   `skew_lib.py` and `model_fused_cell.py` are the earlier variants. Run each with `-h` first. State
   the base cell, the derate and the physical reason in the recipe. Every Liberty cell must declare
   `pg_pin`s VPWR, VGND, VPB, VNB, and its output pins must equal the recipe `outputs`.

The recipe validator refuses: a missing file, a SHA-256 that differs, Liberty and LEF signal pins
that differ, missing power pins, a changed or dropped best-library cell, a support file outside
`cells/r<k>/`, more than 10 new cells, a multi-output cell without `emap-window`, and a missing
findings report, datasheet or usage guide. The message says exactly what to change.

## Images for datasheets

`klayout -b -r render.py` with `pya.LayoutView()`, `load_layout(<gds>)`, `max_hier()`, `zoom_fit()`,
`save_image(<png>, 600, 900)`; set `QT_QPA_PLATFORM=offscreen`.

## Multi-output remapping with emap

See `flow/toolbox/emap/README.md` (exact commands, window cutting, stitching, equivalence check).
