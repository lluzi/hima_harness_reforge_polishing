# analog_sim_01: the analog Site (not yet deployed)

The Site the `analog-ota-migrate` Pack runs on: Cadence Spectre measures, open PDKs only. Only the
install tools are in the repository so far; `site.yml`, the Permit and the resident capability come
with the Site slice, after the server writes are approved (see `docs/specs/analog-ota-pack/spec.md`).

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
