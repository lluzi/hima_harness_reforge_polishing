# Real-model probe outputs (Issue #63)

Copied unchanged from the real-model Workshop probe (`scripts/probe-atcs-workshops.ts` on
`atcs63/model-probe` 373a10ca, run `notes/model-probe-run1`, model `deepseek-flash`, Pack 0.1.10,
inputs from retained PR03 Run `run-1ca6cdd3`). `test_probe_regressions.py` reads them.

- `worker-request-w01-attempt-2.json`: `actions: []` (the Reader raised; now counted).
- `worker-request-w01-attempt-1.json`: `toMaster: BUFFD4BWP30P140` for `CKAN2D*` cells.
- `known-instances.json`: the 546 instance paths the probe proved from retained data, its
  netlist stand-in (the real netlist is on the Site).
- `next-decision-attempt-{1,2,3}.json`: `targets` as a bare scenario, wildcards and prose.
- `reviewer-answer-attempt-1.json`: the Team reviewer's first answer (admitted; nested
  `evidenceRefs` and long `limitations`, the shape that broke inside arrays in 2 of 5 answers).
