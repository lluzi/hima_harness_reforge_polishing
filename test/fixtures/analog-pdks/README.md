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
