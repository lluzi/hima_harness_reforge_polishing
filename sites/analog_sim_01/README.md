# analog_sim_01: the analog Site

The Site the `analog-ota-migrate` Pack runs on: Cadence Spectre measures, open PDKs only. Deployed on
the lab server on 2026-10-12 (the user approved server writes under our project area). `site.yml`
carries the host name `linglong`; the App's saved Site holds the real address, which is never in git.

## Paths on the server

| Path | What | Access |
| --- | --- | --- |
| `/data/eda/project/hima_harness/operator-admin/analog-sim-01/bin/{spectre,ngspice}` | the simulator wrappers (copies of `bin/`) | read-only |
| `/data/eda/project/hima_harness/operator-admin/analog-sim-01/pdks` | `gf180mcuD` and `ihp-sg13g2` copied from the pinned tool image, plus `ihp-sg13g2/libs.tech/spectre-hima` from `install/ihp_spectre.py` | read-only |
| `/data/eda/project/hima_harness/operator-admin/analog-sim-01/resident-engineering` | the resident wrapper (`sites/linglong-atcs28/templates/resident-engineering-wrapper.py`) and `engineering-capabilities-analog01.json` | read-only |
| `/data/eda/project/hima_harness/operator-admin/analog-sim-01/layout/{cell_layout.py,run_cell.sh}` | the layout tool (copies of `layout/`), bound as `layoutTool` | read-only |
| `/data/eda/project/hima_harness/analog-runs` | Campaign workspaces | the only write root |

Live check (2026-10-12, `analog-runs/site-check-20261012`, the OTA Pack's tool steps by hand):
`bind` found spectre-23.1.0 and ngspice-46. `characterize` built 20 curves in 3.4 s. Round 1:
the GF180MCU source measured 92.1 dB, 11.63 MHz, 61.5 deg and 188.7 uW, and met the spec. The
naive IHP port measured 46.8 dB, and the margin was -21.98 %. Round 2: the re-biased port measured
62.8 dB, 14.79 MHz, 70.9 deg and 144.9 uW, with a margin of 4.67 %. All of this is Spectre, and
each simulate step takes about 3 s. An agent's own `sim` of the same port, run with ngspice-46 in
the sandbox image (`OTA_SIM=ngspice`, `OTA_PDK_ROOT=/foss/pdks`), gives 144.939 uW, as Spectre
does.

## Toolchain

- `simulators: spectre=<wrapper>,ngspice=<wrapper>`. The Spectre wrapper runs `spectre` inside the
  server's EDA container (`edarun`) in the caller's directory, on the Cadence licence (no Empyrean
  licence switch). The ngspice wrapper runs the ngspice of the pinned resident sandbox image.
- Agents iterate in their sandbox with that image's ngspice and `/foss/pdks`.

## PDKs (open, Apache-2.0; installed per Site, never in git)

`pdkRoot` holds, in the layout of the open_pdks install the sandbox image has:

| PDK | Files | Spectre | ngspice |
| --- | --- | --- | --- |
| `gf180mcuD` | `gf180mcuD/libs.tech/ngspice/` from the image | reads `design.spice` and `sm141064.spice` (sections `nfet_03v3_<c>`, `pfet_03v3_<c>`, `noise_corner`) as shipped | the same files |
| `ihp-sg13g2` | `ihp-sg13g2/libs.tech/ngspice/` from the image, plus `ihp-sg13g2/libs.tech/spectre-hima/` written by `install/ihp_spectre.py` | `spectre-hima/cornerMOSlv_spectre.lib` (`mos_tt/ss/ff`): IHP's PSP 103.6 cards on Spectre's built-in `psp103` | IHP's own `cornerMOSlv.lib` with `osdi/psp103.osdi` |

```
python3 install/ihp_spectre.py <pdkRoot>/ihp-sg13g2/libs.tech/ngspice/models <pdkRoot>/ihp-sg13g2/libs.tech/spectre-hima
```

Checked on the EDA server (2026-10-12): an NMOS and a PMOS at 0.6 V give the same drain current in
Spectre 23.1 on the converted deck and in ngspice 46 on IHP's OSDI deck (18.36885 uA, 12.75485 uA);
a two-stage OTA at three corners gives the same worst corner in both (62.8 dB, 14.79 MHz, 70.94 deg,
144.94 uW). SKY130's decks do not read in Spectre (brace expressions).

## Layout (probe, `layout/`)

`layout/run_layout.sh <design.json> <out> <flow dir> <pdkRoot> <spectre wrapper>` turns a sized
`gf180mcuD` OTA design into a layout and checks it after layout. It runs about 33 s end to end.

1. **Layout:** `ota_layout.py` in the tool image draws each device at an exact W/L. It writes
   `ota.gds` and `ota.mag`.
2. **DRC:** both Magic and KLayout `gf180mcu.drc` (variant D) report 0. Only the die-level density
   rules fire, because they need fill.
3. **LVS:** netgen with `gf180mcuD_setup.tcl` reports "Circuits match uniquely" against the
   Pack's nets and sizes. A width 2 % off is caught.
4. **PEX:** Magic writes a C-only and an R+C netlist. `ota_postlayout.py` simulates both in
   Spectre with the Pack's own testbench and arithmetic.
5. **Picture:** a KLayout render.

Checked 2026-10-12 on the first-cut GF180 OTA: at tt, 92.25 dB / 11.17 MHz / 63.6 deg before
layout and 92.54 dB / 10.93 MHz / 60.95 deg with R+C extracted. At ff the post-layout phase
margin is 57.5 deg, below the 60 deg line. The layout uses two rows and a routing channel, with
no common centroid or dummies. Magic extracts the GF180 PNPs under the wrong device name, so a
bandgap needs KLayout LVS for the BJTs.

Generalized the same day. `layout/cell_layout.py` lays out any GF180 SPICE subcircuit; run it with
`layout/run_cell.sh <netlist> <subckt> <out>`. It takes MOS, the two PNP sizes, `ppolyf_u(_1k)`
segments and MIM.

- **Bipolar array:** a 1:8 PNP pair becomes a 3×3 common-centroid block with the single unit in
  the centre.
- **Resistors:** straight segments in series.
- **Input pair:** ABBA or AB, with poly dummies.
- **Two LVS checks:**
  - netgen. Magic names every PNP `pnp_10p00x00p42`, so the name is corrected from the PDK cell
    that holds it.
  - The PDK's KLayout `run_lvs.py`, which recognises the PNP size from the layout. It needs the
    MIM marker GDS 117/10 added to the GDS.

The OTA, a hand-written bandgap-shaped cell (`layout/tests/bandgap_shape.spice`) and the bandgap
Pack's own netlist (`layout/tests/bandgap_pack_lb.spice`) all pass with 0 DRC errors on both decks
and both LVS checks matching. The PDK's bare PNP cell carries 6 Magic-only well errors per unit; the
KLayout deck reports 0. Nine wrong references are caught by both LVS checks: a PNP multiplicity of
7, the wrong PNP size, a resistor length 1.65 % off, and a MOS width 2.47 % off, among them
(`layout/tests/negative_lvs.py`).

Bandgap chain on the Site (2026-10-12, `analog-runs/bg-site-check-20261012`, the `analog-bandgap`
Pack's tool steps by hand, Spectre 23.1, GF180MCU):

| Step | Time | Result |
| --- | --- | --- |
| characterize | 8 s | |
| simulate schematic | 70 s | 30 corners, every line met on the method's first cut |
| Monte Carlo, N=100 | 1.3 s | sigma 4.75 mV, in band |
| layout | 18.5 s | NOT clean: DRC 2/3, both LVS checks mismatch |
| simulate post | 70 s | |

The layout tool handled the earlier hand-picked cell but not this real first cut (598.7 × 133.1 um).
The Pack recorded the round as valid and not signed off, as it should. Fixed the same day: the cell
is folded into stripes with serpentine resistor bands, 164.2 × 189.2 um, DRC 0 on both decks, both
LVS checks matching.

### Reference ladder, 128 pins and fill (2026-10-13)

The bgcore case adds a 120-tap ladder and a BGOK monitor (`layout/tests/bgcore_shape.spice`).
`bandgap_lb` has 128 pins: `vdd vss en ibias vbg go g bgok vref_1 … vref_120`.

- **Ladder.** A chain of at least 8 equal unit resistors (one model, width and length, `s=1`) is
  found from the netlist. Each junction must join exactly two of its elements, and an element may
  be up to 4 units in parallel (`m=`, `par=` or repeated instances). It is drawn as one serpentine
  block:
  - each junction is a short metal1 strap between neighbouring segments;
  - a tap that is a pin and used by nothing else carries its pin label on its strap (a Magic port
    on metal1, GDS 34/10, which the KLayout deck reads);
  - only the ends (`vbg`, `vss`) and the taps other devices use (`vref_100`) reach the routing
    channel, so the channel does not grow with the tap count.

  Both references write parallel units as separate resistors.
- **KLayout LVS** runs with `--top_lvl_pins`. Without it the layout's top cell has no pins, and
  `--combine` merges the series ladder through its tap nets while the reference keeps them apart.
  The deck matches topology, not labels, so the tool also reads the LVS database. Every reference
  pin's net must be cross-referenced to a layout net of the same name. A swapped tap label fails
  this check.
- **netgen** "Top level cell failed pin matching" counts as a mismatch, as "do not match" and
  "Property errors" do.
- **Fill.** After the drawing, the PDK's `scripts/fill_all.rb` fills a copy of the GDS:
  - it fills COMP, Poly2 and Metal1–5 dummy squares, with the script's own keep-outs, DM.4–DM.7
    included;
  - two markers move its 26 um scribe-line ring outside the block, then are removed again;
  - the output is `<cell>_filled.gds`, with each layer's coverage before and after in `layout.json`
    (`fill`);
  - the block and density decks and KLayout LVS (which counts dummy metal as metal) run again on
    the filled GDS;
  - netgen LVS and the extraction stay on the unfilled GDS (`pexOn: "unfilled"`);
  - `klayoutDrc` and `densityRules` keep the unfilled results, and `densityRulesFilled`,
    `drcKlayoutFilled`, `klayoutLvsFilled` and `filledGdsSha256` are new.

Checked on the Site (`analog-runs/bgcore-layout-20261013-1029`):

| Cell | Size (um) | Magic | KLayout block, unfilled / filled | Density rules, unfilled / filled | LVS netgen, KLayout, KLayout filled | Tool time |
| --- | --- | --- | --- | --- | --- | --- |
| bgcore shape | 200.7 × 223.0 | 0 | 0 / 0 | 6 / 5 | match, match (128/128 pins), match | 41 s |
| site r1 | 164.2 × 189.2 | 0 | 0 / 0 | 6 / 3 | match, match, match | 45 s |

The PDK fill does not reach the die-level 30 % metal density on a block of this size. Its pattern
is 2 um squares at a 3.2 um pitch: at most 40 % where it may fill, and 25 % on Metal5 (4 um pitch).
It also keeps 2 um from circuit metal on the same and the adjacent layers. On bgcore it reaches,
after / before fill:

| Layer | Metal1 | Metal2 | Metal3 | Metal4 | Metal5 |
| --- | --- | --- | --- | --- | --- |
| Coverage after / before fill (%) | 18.6 / 5.0 | 17.3 / 0.6 | 25.8 / 3.9 | 37.7 / 13.5 | 28.7 / 10.9 |

Turning off the script's adjacent-layer keep-outs (`MetalN_ignore_active`) gives 26.0 / 29.3 /
29.9 / 41.5 / 32.1 %, still short on Metal1–3. The kept scribe ring gives 10.0 / 8.9 / 15.6 / 26.1 /
21.0 %. The density lines stay a reported verdict, not a tool failure: die-level density is closed
at chip assembly.

Negatives on the earlier runs (`analog-runs/bgcore-layout-20261013-1005`):
- 13 of 14 wrong references are caught by both LVS checks, two of them new on bgcore: a ladder unit
  10 % long and a BGOK width. The miss is a MIM with its width and length swapped at the same area,
  which only netgen sees; the baseline missed it too.
- All six layout faults are caught by both: four on the pack cell, plus a dropped ladder unit and two
  swapped tap labels on bgcore.
