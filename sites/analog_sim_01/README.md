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
