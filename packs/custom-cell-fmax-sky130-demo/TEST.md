# Validation

Local: `test/contract/custom-cell-fmax-sky130-demo.test.ts` (Pack load and graph shape, Site fit,
argv binding, capability identity) and `test/contract/support/cellfmax_cli_test.py` (Fmax formula,
Liberty/LEF/netlist parsing, dont-use resolution, recipe validator refusals, compare-round outcomes,
Readers on fixtures).

Server dry runs (linglong, `/data/eda/project/hima_harness/cellfmax-runs/dryrun-20261004/`) and the
GUI Campaign are recorded in `docs/product-demo/customer-demo/README.md`.

## Recorded Runs (2026-10-04, App 0.3.0-trial.37, Pack digest `1969617d…` at `2e0cfc26`)

Kit `.hima-tmp/cellfmax-demo-kit-c1c` (fresh Home, Site `linglong-sky130-cells`), operated through the
App on Catsights; cycle record `.hima-tmp/hltbf/cellfmax-sky130-c1/`.

- Wiring Run `run-1a52e6fd-3a4d-482d-8156-03f73deebf70` (1 generation): baseline PASS, resident
  engineer built DRC/LVS-clean `NOR2_PU2` and `NOR3_PU2`, Reader-accepted on first delivery, both arms
  in parallel; matched gain +4.96 % (claim +4.96 %), `fmax-goal` FAIL; owner ended it
  `ended-goal-not-met` as scoped. Survived a Mac reboot mid-round: Host recovery re-attached the live
  resident task without replay.
- Live Run `run-f42706a0-d392-44a5-8f54-085b2c95d2b1` (up to 4 generations): round 1 +4.06 %,
  round 2 +5.14 % (273.15 vs 259.79 MHz, 122 custom instances, route DRC 0) → `ended-goal-met` in
  200.8 of 300 min. Agent claims matched the Harness numbers in both rounds.

Untested: rounds 3–4 and convergence on the real Site, an `emap-window` round chosen by the
engineer, DRC/LVS-clean layouts in the live Run (its cells are `abstract`).
