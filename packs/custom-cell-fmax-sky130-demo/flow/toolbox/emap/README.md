# emap window remapping toolbox

Remap one critical combinational window of the synthesized aes netlist with mockturtle's `emap`
(a mapper that can use multi-output cells), stitch it back, prove it equivalent, and hand the
stitched netlist to ORFS through `SYNTH_NETLIST_FILES` (recipe `synthesis.method: emap-window`).
`emap` maps a whole network, so only the window is remapped. Everything outside the window keeps its
cells and net names. ORFS still places, resizes, buffers, routes and times the whole design.

All commands run inside the EDA image (`yosys`, `python3`, g++ on PATH). Paths below are the
linglong install. Inside the resident sandbox, use the toolbox copy in your workspace
(`flow/toolbox/emap/`) and the read-only binary.

| What | Where |
|---|---|
| mockturtle source (header-only use), pinned | `/data/eda/project/hima_harness/operator-admin/cellfmax-toolbox/mockturtle-47d1e70` (lsils/mockturtle `47d1e70fdf775e1a295016c3c17a1ad206db24c0`, 2026-09-29; see `PINNED_COMMIT`) |
| `emap_window` binary | `/data/eda/project/hima_harness/operator-admin/cellfmax-toolbox/bin/emap_window` |
| scripts (this directory) | `emap_window.cpp`, `build.sh`, `liberty_to_genlib.py`, `window.py`, `equiv.sh` |
| sky130hd Liberty | `<ORFS>/flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib` |

## Recipe in six commands

Set `E=flow/toolbox/emap`, `L=<sky130hd lib>`, and `K=cells/r<k>` (your round's directory). The
baseline netlist is `<baseline run>/results/sky130hd/aes/base/1_2_yosys.v`. The paths report is any
OpenSTA `report_checks` text with `inst/pin (cell)` lines, for example the baseline's `top-paths.txt`.

```bash
# 1. genlibs: custom = platform lib + your custom lib; control = the same with your cells excluded
python3 $E/liberty_to_genlib.py --lib $L --lib $K/custom.lib --out $K/custom.genlib --report $K/custom.genlib.json
python3 $E/liberty_to_genlib.py --lib $L --lib $K/custom.lib --exclude MYCELL1 --exclude MYCELL2 \
        --out $K/control.genlib --report $K/control.genlib.json
# 2. cut the window (pass the custom lib too if the netlist already holds custom cells)
python3 $E/window.py cut --netlist <baseline>/1_2_yosys.v --lib $L --paths <baseline>/top-paths.txt \
        --max-paths 5 --grow 1 --max-cells 300 --out-dir $K/win
# 3. map it twice: same flags, only the genlib differs
for arm in custom control; do
  emap_window --genlib $K/$arm.genlib --aig $K/win/window.aig --names $K/win/window.names \
     --arrivals $K/win/window.arrivals --multioutput --module emap_win_core \
     --out $K/win/mapped.$arm.v --stats $K/win/mapped.$arm.json
done
# 4. stitch (run it for each arm; the last stitch leaves wrapper.v in the window dir)
python3 $E/window.py stitch --dir $K/win --mapped $K/win/mapped.control.v --out $K/aes.emap-stock.v
python3 $E/window.py stitch --dir $K/win --mapped $K/win/mapped.custom.v  --out $K/aes.emap.v
# 5. equivalence of the custom window (optional; must run after a stitch)
bash $E/equiv.sh $K/win $K/win/mapped.custom.v $K/equiv.log
# 6. recipe: synthesis = {"method":"emap-window","netlist":"cells/r<k>/aes.emap.v",
#            "controlNetlist":"cells/r<k>/aes.emap-stock.v","equivalence":"cells/r<k>/equiv.log"}
```

If a custom cell is a multi-output cell, its Liberty must declare one `function` per output, and it
must appear in the genlib report's `multiOutput` list. Otherwise emap cannot use it as one cell.

## Tools

**`liberty_to_genlib.py`** turns Liberty files into a genlib (python3 stdlib).
- It writes one `GATE` line per output pin, using the real cell and pin names. A multi-output cell
  becomes consecutive `GATE` lines with the same name and the same `PIN` order.
- Area is the Liberty `area`.
- Each pin's block delay is the `cell_rise`/`cell_fall` table value at an input slew of 0.1 ns and
  a load of 0.005 pF. The load is roughly two to three x1 inputs; change it with
  `--slew-ns`/`--load-pf`. The model ignores load, so emap only sees relative cell speeds.
- Skipped cells: `--exclude`/`--exclude-file` patterns (fnmatch), `dont_use`, sequential cells,
  tristate cells, more than 6 inputs or more than 2 outputs, tie/fill/tap/decap/diode/probe cells,
  lpflow, clk*, dly* and macro cells.
- `--report` lists the kept cells with their arc delays and every skipped cell with the reason.
- Stock sky130hd gives 277 cells, 9 of them multi-output (fa_1/2/4, fah_1, fahcin_1, fahcon_1,
  ha_1/2/4), in 1 s.

**`emap_window`** maps the window. Its options:
- `--genlib`, `--aig`, `--out`, `--module` (always `emap_win_core` for `window.py stitch`).
- `--multioutput` lets emap use multi-output cells.
- `--area` maps for area. The default maps for delay first, then recovers area.
- `--all-sizes` loads every drive strength. The default loads only the smallest size of each
  function, because ORFS resizes later.
- `--arrivals`: one ns value per AIGER input, which emap uses as `arrival_times`. This changes the
  result: on the dry-run window, emap gives 225 cells and model delay 1.55 ns without arrivals,
  and 158 cells and 2.24 ns with them. With arrivals, the delay includes the input arrival.
- `--names`: lines of the form `i k name` / `o k name`.
- `--stats`: JSON with area, model delay, cell histogram, `multioutputGates` and seconds.

On stdout, `delay` is emap's own model delay in genlib ns; it is not an STA number. Exit codes:
2 usage error, 3 input error, 4 mapping error.

**`window.py cut`** picks the window as follows:
1. Seeds are the instances on the first `--max-paths` paths of `--paths`, worst path first. Use
   `--cells FILE` (one instance per line) to choose them yourself. Instances that are missing from
   the synthesized netlist are ignored; resizer buffers such as `placeNNNN` are listed in
   `window.json` under `unknownSeedInstances`.
2. Only combinational Liberty cells enter the window. Flops, ports and tie cells always bound it.
3. Each path's cells are added whole until `--max-cells` would be exceeded.
4. `--grow K` adds K levels of combinational fan-in, the side inputs of the critical cones, up to
   `--max-cells`. This gives emap room to restructure.

It writes these files to the output directory:
- `cut.v`: the netlist with the window moved into module `emap_win`.
- `window.aig` and `window.map`: the AIGER of the window, built from the Liberty functions.
- `window.names`
- `window.arrivals`: the longest path from a flop or input, using the same arc delays as the genlib.
- `window.json`: sizes, ports, cell types, and `goldModelDelayNs`, the original window's delay in
  the same model. Compare it with emap's `delay`.

Size guidance: keep windows at 100–500 cells. Every net the window drives that is used outside it
becomes a window output, and emap must keep that function. Large windows with many outputs leave
little room to restructure. emap runs in well under a second at this size.

**`window.py stitch`** does the following:
1. Writes `wrapper.v`, which maps the original ports to `wi*`/`wo*`.
2. Swaps the window into `cut.v` and flattens.
3. Runs `opt_clean -purge`, so the netlist has no `assign`s and keeps the original net names.
4. Renames the window instances to `emapw_*`.
5. Checks that the cell counts outside the window are unchanged. `stitch.json` records the result;
   a mismatch exits 1.

**`equiv.sh`** compares the original window (gold) with wrapper plus core (gate).
1. Both are flattened onto the Liberty functions.
2. Yosys runs `equiv_make`/`equiv_simple`/`equiv_induct`/`equiv_status -assert`. If that fails, it
   runs a SAT miter.
3. The log ends with `EQUIVALENCE: PASS` or `EQUIVALENCE: FAIL`. The raw transcript is
   `<log>.yosys`; keep it next to the log.

The log you reference in the recipe must not contain the word "unproven". The Pack's compare step
treats that word as a failure, and raw Yosys prints it even on success, so `equiv.sh` summarises
the line instead of copying it. A deliberately broken netlist (one nand2 turned into an and2) gives
`EQUIVALENCE: FAIL`; this was tested.

## Measured on linglong (8-CPU container, 2026-10-04)

| Step | Time |
|---|---|
| `build.sh` (g++ 13.3, -O2) | ~15 s |
| `liberty_to_genlib.py` (sky130hd, 12.8 MB) | 1 s |
| `window.py cut` on aes `1_2_yosys.v` | ~6 s |
| `emap_window`, 122-cell window (163 in / 65 out / 438 AND) | 0.04 s, 33 MB |
| `window.py stitch` | ~5–8 s |
| `equiv.sh`, 65 outputs | ~3 s |
| ORFS `finish` + top paths from `SYNTH_NETLIST_FILES` (aes, 8 CPUs) | 900–924 s (baseline with Yosys: 1099 s) |

Dry-run result (stock lib, 5 worst paths, `--grow 1`): see the "Dry run" section at the end.

## Known failure modes

- **`yosys failed (yosys_cut.log)`**: an instance name in `--cells` does not exist, or the netlist
  is hierarchical in an unexpected way. Read `yosys_cut.log.full`.
- **`no combinational seed cell found`**: the paths report names only flops and buffers that the
  resizer inserted. Use more paths, or pass `--cells`.
- **emap warnings `library does not contain cells that could match the delay of output pin ... of
  multi-output cell`**: these are harmless. They mean that cell has no single-output equivalent at
  the same delay.
- **`multioutputGates: 0` with `--multioutput`**: in delay mode, emap picks a multi-output cell only
  when the cell is faster than the single-output cover in the genlib model. Stock fa/ha are slow in
  that model (fa_1 SUM about 0.5 ns per arc, ha_1 SUM about 0.31 ns, against about 0.08–0.19 ns
  for xor2_1 and a21oi_1), so they appear only with `--area`.
  On an 8-bit adder, `--area` gives `fa_1` ×1. A faster custom multi-output cell must be faster in
  its Liberty tables to be chosen.
- **Exit 4, `mapping error`**: the genlib lacks a function emap needs, for example the inverter was
  excluded. Check the genlib report.
- **More cells after remapping** (122 → 158 in the dry run): the delay mode spends area, and ORFS
  may recover some of it.
- **The model delay is not STA delay**: a lower emap `delay` does not guarantee a better routed
  WNS. Only the measured arm counts.
- **Equivalence FAIL**: do not submit the round. Rerun with `--area` or a smaller window; if it
  repeats, report it as a tool defect with the logs.
- **`stitch` count MISMATCH**: something outside the window changed. Do not use the netlist.

## Dry run (2026-10-04, linglong)

Scratch directory: `/data/eda/project/hima_harness/cellfmax-runs/dryrun-20261004/emap/`.
- Window `w1/`: 47 seed cells from the 5 worst baseline paths, grown to 122 cells (163 in, 65 out).
- Model delay: 2.453 ns for the original window, 2.238 ns after emap, which used 158 cells and no
  multi-output cells.
- Equivalence: PASS (65/65 points).
- There were no custom cells, so the custom and control netlists are byte-identical.

| ORFS run (aes, sky130hd, 3.6 ns) | finished | WNS ns | TNS ns | Fmax MHz | route DRC | area um^2 | runtime |
|---|---|---|---|---|---|---|---|
| baseline (ORFS Yosys/ABC) | yes | -0.249 | -1.91 | 259.8 | 0 | 124076 | 1099 s |
| unmodified `1_2_yosys.v` via `SYNTH_NETLIST_FILES` (`ws-d`) | yes | -0.249 | -1.91 | 259.8 | 0 | 124076 | 901 s |
| emap-stitched `aes.emap.v` via `SYNTH_NETLIST_FILES` (`ws-c`) | yes | -0.628 | -4.39 | 236.5 | 0 | 125872 | 924 s |

- **`SYNTH_NETLIST_FILES` itself is neutral.** The unmodified netlist reproduces the baseline
  bit-for-bit (`6_final.v` is identical), so any difference comes from the window.
- **This first emap window made the design slower: -2.4 ns TNS and -9 % Fmax.**
  - The remapped endpoints themselves improved. The baseline's worst endpoints, sa23/sa22, now
    have slack -0.03 to -0.19 ns.
  - The new worst path, sa00_sr[5] -> sa00_sr[6], does not pass through the window. It goes
    through a 1.2 ns `mux2i_2` stage, so ORFS placement and repair responded globally.
  - Treat an emap window as an experiment that only the measured arm can judge. The
    with/without-custom-cells comparison runs the same emap pass in both arms for this reason.
