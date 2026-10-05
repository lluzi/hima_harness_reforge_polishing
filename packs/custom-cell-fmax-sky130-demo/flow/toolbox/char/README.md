# char: SPICE characterizer for custom cells

`characterize.py` simulates extracted custom standard cells with ngspice and writes a Liberty file
from the measurements. The cell's arcs come from its Liberty `function`. The tables are calibrated
against the sky130 foundry Liberty. Only this measured Liberty may enter the measured ORFS arms. A
modelled Liberty (a foundry table times a derate) may not.

| File | Role |
| --- | --- |
| `charcore.py` | Pure-Python core: function parser and sensitization, netlist sanitizing, deck and measure handling, Liberty reader and writer, calibration math and gate |
| `characterize.py` | Job → `custom.measured.lib`, `characterization.json`, `<cell>.timing.csv` |
| `calibrate.py` | Extracts foundry cells with Magic, characterizes them, compares them with the shipped Liberty and writes `calibration.json` |
| `compare_lib.py` | Point-by-point ratio of one cell between two Liberty files |

Unit tests (no ngspice needed): `python3 -m unittest test/contract/support/cellfmax_char_test.py`.

## Run (inside the IIC-OSIC-TOOLS container)

```sh
podman run --rm --userns=keep-id --cpus=16 -v $W:$W:rw -v $REFDIR:$REFDIR:ro \
  localhost/iic-osic-celluzi-hima:2026.06 /bin/bash -c 'export PATH=/foss/tools/bin:/usr/bin:/bin; cd '$W'; ...'
# REF = $ORFS_ROOT/flow/platforms/sky130hd/lib/sky130_fd_sc_hd__tt_025C_1v80.lib

# once per method version (about 50 s with 16 workers; reuses OUT/extract/ if present):
python3 flow/toolbox/char/calibrate.py --reference-lib $REF --out cal --jobs 16
# every round:
python3 flow/toolbox/char/characterize.py job.json --reference-lib $REF \
  --calibration cal/calibration.json --out char --jobs 16
```

Do not use `-w` together with the bind mount. Use `cd` inside the container. Mount every path that the
job names at the same path inside the container.

## Job

```json
{"cells": [{
  "name": "NOR3_PU2",
  "spice": "/abs/NOR3_PU2.ext.spice",
  "subckt": "NOR3_PU2",
  "pins": {"power": "VDD", "ground": "GND", "inputs": ["A", "B", "C"], "outputs": ["Y"]},
  "functions": {"Y": "!(A|B|C)"},
  "area_um2": 8.7584,
  "lef": "/abs/NOR3_PU2.sky130hd.lef",
  "index_ref": "sky130_fd_sc_hd__nor3_1",
  "footprint": "NOR3_PU2"
}]}
```

- `spice` is the Magic-extracted netlist, with `cthresh 0` as in `celluzi/generate/extract_cell.sh`.
  Pre-layout netlists also run, but the calibration describes extracted netlists.
- `pins.power` and `pins.ground` name the subckt supply ports (defaults `VPWR`/`VGND`). Ports named
  `VPB`/`VNB` tie to power and ground. Any other port that is not in `inputs` or `outputs` is refused.
- `functions` uses Liberty syntax (`! ' & * | + ^`, parentheses, juxtaposition = AND). Give one
  function per output. Multi-output cells are supported.
- `lef` is optional. When it is given, its signal pins must equal `inputs + outputs`, or the cell
  fails before simulation.
- `index_ref` names the foundry cell whose `del_1_7_7` `index_1`/`index_2` the tables use. The default
  is `sky130_fd_sc_hd__inv_1`. Use the cell you compare against. You can also give explicit `index_1`,
  and `index_2` as a list or as `{output: list}`.
- `footprint` defaults to the cell name, so every cell gets its own footprint.

## Outputs (`--out`)

- `custom.measured.lib`: `cell` groups only, mergeable with `cellfmax_cli.py _merge_liberty` or
  `celluzi/scripts/merge_lib.py`. Each group has a banner: `SPICE-characterized from extracted layout,
  tt 1.8V 25C, calibrated`, plus the method fingerprint and the netlist SHA-256. It has `pg_pin`s
  VPWR/VGND/VPB/VNB in the style of the reference Liberty, `area`, `cell_footprint`, input
  `capacitance`/`rise_capacitance`/`fall_capacitance`, and output `function`, `max_capacitance` (the
  largest `index_2`) and `timing` groups with `related_pin`, `timing_sense` and `cell_rise`/`cell_fall`/`rise_transition`/`fall_transition` on the 7×7 grid.
- `custom.measured.standalone.lib`: the same cells inside a complete `library` group, for tools that
  read the file on its own.
- `characterization.json` (`hima-cellchar-result/1`): the method and its fingerprint, the calibration
  file and its SHA-256, the factors applied, and per cell: `status` ok|failed, `reason`, `sims`,
  `simCpuSeconds`, arcs with timing sense and side-input vectors, capacitances, the sanitize report
  (what was tied, how many `**FLOATING` comments were stripped) and warnings (negative delays, delays
  that fall as load rises). It also holds `wallSeconds`. A refused run has `refused` set and writes
  no Liberty.
- `<cell>.timing.csv`: every table point with the raw and the calibrated value, and the input
  capacitances.
- `work/<cell>/`: the sanitized netlist, every deck (`*.sp`) and every ngspice log.

`--uncalibrated` writes `custom.uncalibrated.lib`, with an UNCALIBRATED banner, for diagnosis only.
Never deliver it to an arm.

## Method (`charcore.METHOD`, fingerprint in every output)

- **Netlist sanitizing.** Strips Magic's trailing ` **FLOATING` comments, which ngspice rejects. Ties
  every pfet bulk that is not a port to power and every nfet bulk that is not a port to ground,
  together with a non-port `VSUBS`. This covers LibreCell/celluzi cells, whose n-well (`w_*#`) and
  substrate float. Drops capacitors that become self-loops.
- **Sensitization.** For every output and input, the code enumerates the other inputs and keeps the
  assignments under which the input toggles the output. Positive vectors give a positive_unate arc
  and negative vectors a negative_unate arc. A non-unate pair (XOR, MUX select, adder SUM) gets both
  timing groups, as the foundry Liberty does. Each group is the point-wise worst case over at most 4
  vectors per sense.
- **One ngspice process per (output, input, vector).** It holds 49 copies of the cell (7 input slews ×
  7 loads) plus one copy for input capacitance, in one transient run. Each input ramp rises at
  0.05 ns and falls after a settle window of 0.5 ns + 80 ns/pF × max load, plus the ramp. Delay is
  measured 50 %→50 %. Transition is 20–80 % with derate 1.0, as in the reference Liberty. The ramp
  takes 1.4 × the index_1 slew from 0 to 100 %. That value was fitted on the calibration set: 1/0.6 and
  1.25 leave −5…+4 % residual trends across slews, and 1.4 leaves at most ±1.6 % (−3 % on
  rise_transition at 1.5 ns). The other outputs carry 1.7 fF. Input capacitance is the charge drawn
  from the input source over each edge divided by VDD (0.053 ns slew, index_2[2] load). A missed
  crossing is retried with the settle window ×3, then ×9.
- **Model subset.** Only the device models used by the netlists are loaded: the corner files plus the
  parameters and `.option scale` from `all.spice`. The full `sky130.lib.spice tt` takes 21 s to load in
  every process. With the subset, `NOR3_PU2.timing.csv` is byte-identical to a `--full-models` run,
  and the cell finishes in 1.2 s instead of 27 s. `num_threads=1` comes from `work/.spiceinit`.

## Calibration and its gate

`calibrate.py` extracts the 12 default foundry cells with the Magic sequence of `extract_cell.sh`:
inv_1, nand2_1, nor2_1, nor3_1, nor3_2, xor2_1, xnor2_1, a21oi_1, o21ai_1, mux2i_1, ha_1 and fa_1.
It characterizes them with the same method and compares every table point and every pin capacitance
with the shipped Liberty, 8682 points in all. For each quantity, the factor is the median of
reference/simulated. The residual of a point is simulated × factor / reference − 1.

Result for method `c8032f559b2a64d3` (2026-10-04, char-dev/calibration):

| quantity | factor | p90 before | p50 after | p90 after | max after |
| --- | --- | --- | --- | --- | --- |
| cell_rise | 1.0118 | 10.2 % | 4.0 % | 10.0 % | 43.7 % |
| cell_fall | 1.1362 | 19.6 % | 4.5 % | 10.4 % | 96.4 % |
| rise_transition | 1.0106 | 11.8 % | 5.0 % | 12.1 % | 27.4 % |
| fall_transition | 1.1496 | 18.6 % | 4.0 % | 13.2 % | 37.6 % |
| rise_capacitance | 0.9304 | 12.4 % | 2.3 % | 6.0 % | 9.9 % |
| fall_capacitance | 0.8655 | 24.7 % | 3.9 % | 8.2 % | 11.9 % |

Most of the remaining spread is cell-to-cell, not slew- or load-dependent. inv_1 cell_rise has a p90
residual of 22 % after the factor, while most cells' delay p90 is 5–11 %. The largest errors are at
1.5 ns slew with tiny loads, where delays are a few ps. Per-cell factors cannot be used, because a
custom cell has no reference. **±10 % p90 is not reachable** with per-quantity factors: it holds for
cell_rise but not for the transitions. **The tolerance is ±15 % p90 per quantity**, and
`MAX_TOLERANCE` keeps a calibration from loosening it.

`characterize.py --calibration` refuses (exit 2, no Liberty) when any of these holds:

- the calibration fingerprint differs from the current method;
- any quantity's p90 exceeds the tolerance;
- the tolerance is above 15 %;
- a factor is outside 0.75–1.33, which means the method is broken, not miscalibrated;
- a factor is missing.

Rerun `calibrate.py` after any change to `METHOD`.

## Runtime (linglong, `--cpus=16 --jobs 16`, 2026-10-04)

| run | cells | units | wall |
| --- | --- | --- | --- |
| calibration (12 foundry cells, extraction cached) | 12 | 59 | 49 s |
| NOR3_PU2 alone | 1 | 3 | 1.2 s |
| proof (NOR3_PU2, nor3_1, ha_1, fa_1) | 4 | 30 | 33 s |
| 20 cells (NOR3_PU2 + 19 foundry incl. ha_1, fa_1) | 20 | 111 | 38 s |

A 2–3-input cell takes 1–3 s of CPU per unit. fa_1 is the long pole: 18 units of about 20 s each,
which is about 60 % of the 20-cell CPU. Units are scheduled longest first.

## Failure modes

| Symptom (`characterization.json`) | Cause / fix |
| --- | --- |
| `REFUSED: calibration ...` | Rerun `calibrate.py` for this method, or fix the method |
| `subckt X has no port VPWR` | Set `pins.power`/`pins.ground` to the netlist's names (e.g. `VDD`/`GND`) |
| `subckt port EN is neither a signal pin nor power/ground/well` | Add the pin to `inputs`/`outputs`, or remove the port |
| `LEF signal pins ... differ` | The LEF and the job disagree; fix the job or the LEF |
| `output Y never switched when A toggled with B=1, C=1; the netlist does not implement Y = ...` | The function does not match the transistors (checked on every sensitizing vector) |
| `N measurement(s) failed` after the ×9 retry | A very slow or stuck cell; inspect `work/<cell>/*.log` |
| warnings `negative delays` / `decreases with load` | Kept and reported; usually 1.5 ns slew with tiny loads |
