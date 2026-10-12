# Spectre output on the synthetic PDKs (test only)

Cadence Spectre 23.1 PSF ASCII output (`rawfmt=psfascii`) written by the `analog-ota-migrate`
Pack's own netlists on the synthetic BSIM4 PDKs of `test/fixtures/analog-pdks/` (made up, no foundry
data). Produced on the EDA server on 2026-10-12 by `ota_cli.py` (the netlists are beside the output,
with the PDK root replaced by `<pdkRoot>`). The tests read them with the Pack's PSF parser, so the
Spectre path is tested without a Spectre licence.

- `ota-tt/`: the two-stage OTA testbench at the tt corner of synth180 (the source design of the
  Pack's simulator test): `dcop.dc` (operating point), `opinfo.info` (every device's operating-point
  parameters), `acan.ac` (the AC sweep, 0.1 Hz to 10 GHz, 40 points per decade).
- `sweep/`: the gm/Id characterization sweep of synth130's nmos at five lengths (`sw.dc`).

The same design in ngspice 47 measured 65.2 dB, 11.98 MHz, 69.4 deg and 161.6 uW at its worst corner,
as Spectre did.
