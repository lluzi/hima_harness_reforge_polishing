# Synthetic analog PDKs (test only)

`synth180` and `synth130` are made-up BSIM4 (ngspice level 54) model cards for the
`analog-ota-migrate` Pack's tests. They are not any foundry's process and carry no foundry data:
every parameter was chosen by hand so that a two-stage OTA behaves plausibly (weak to strong
inversion, finite output resistance, a lower-voltage second process) and simulates in milliseconds.

| PDK | supply | minimum L | corners |
| --- | --- | --- | --- |
| synth180 | 1.8 V | 0.18 um | tt, ss, ff |
| synth130 | 1.2 V | 0.13 um | tt, ss, ff |

The `ss`/`ff` corners shift the threshold by +/-50 mV (+/-40 mV for synth130) and the mobility by
-/+10 %. Real open PDKs (SKY130, IHP SG13G2, GF180MCU) are installed per Site and never in git.

`synth180` also carries the `analog-bandgap` Pack's devices, all made up:

- `bandgap.lib`:
  - 3.3 V MOS cards (`nch33`, `pch33` in `synth180_33.inc`) at tt, ss, ff, sf and fs;
  - the sections `bjt_<c>` (a Gummel-Poon vertical PNP `spnp` and the capacitor `scap`, in
    `synth180_bjt.inc`) and `res_<c>` (the 3-terminal poly resistor `sres`, in `synth180_res.inc`);
  - a mismatch section `mm` that turns `nch33`/`pch33` into subcircuits with Pelgrom `delvto`.
- `design.inc`: the Monte Carlo switches `sw_stat_mismatch` and `sw_stat_global`.

Both simulators read every file. A parameter expression passes only named parameters to `agauss`,
as the open PDKs do, because Spectre refuses a nested call there.

