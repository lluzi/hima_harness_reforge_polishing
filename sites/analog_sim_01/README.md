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
