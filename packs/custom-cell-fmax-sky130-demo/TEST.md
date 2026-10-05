## Site

`linglong-sky130-cells` (ssh luzi@192.168.50.41, `workspaceRoot`
`/data/eda/project/hima_harness/cellfmax-runs`, capacity 24 cores, `parallelJobs: 3`), image
`localhost/iic-osic-celluzi-hima:2026.06` (id `c8e8a7a4…`), resident capability
`engineering-capabilities-sky130.json` (sha `6aee66c4`). Kit `.hima-tmp/cellfmax-demo-kit-c1c`
(App 0.3.0-trial.37, fresh Home), operated through the App on Catsights; cycle record
`.hima-tmp/hltbf/cellfmax-sky130-c1/`.

## Run

Recorded with Pack 0.1.0 (digest `1969617d…` at `2e0cfc26`, abstract cells with the engineer's
modelled Liberty; superseded by 0.2.0/0.3.0, where HimaHarness characterizes every cell):

- Wiring Run `run-1a52e6fd-3a4d-482d-8156-03f73deebf70` (1 generation).
- Live Run `run-f42706a0-d392-44a5-8f54-085b2c95d2b1` (up to 4 generations).

Pack 0.3.0 has no GUI Run yet; its server dry runs are under
`/data/eda/project/hima_harness/cellfmax-runs/dryrun-20261004/` (`ws-f`: 149 factory cells, `ws-m`:
236 abstract cells with modelled timing).

## Ending

- Wiring Run: `ended-goal-not-met` by the owner, as scoped (one generation; `fmax-goal` FAIL).
- Live Run: `ended-goal-met` in 200.8 of 300 min.

## Generations

- Wiring Run, round 1: resident engineer built DRC/LVS-clean `NOR2_PU2` and `NOR3_PU2`, Reader
  accepted on first delivery, both arms in parallel; matched gain +4.96 % (claim +4.96 %). Survived
  a Mac reboot mid-round: Host recovery re-attached the live resident task without replay.
- Live Run: round 1 +4.06 %; round 2 +5.14 % (273.15 vs 259.79 MHz, 122 custom instances, route DRC
  0). Agent claims matched the Harness numbers in both rounds. Those cells' timing was the engineer's
  modelled Liberty, which 0.2.0 replaced: measured NOR3_PU2 alone gave +1.01 % (3 instances).

## Code

Local: `test/contract/custom-cell-fmax-sky130-demo.test.ts` 6/6 (Pack load, graph shape, Site fit,
argv binding, capability identity, the four Python suites: CLI 35, characterizer 27, factory 36,
abstract 6); `cellfmax-dry` Host group 2/2 (goal-met in two rounds; converged).

## Refusals

- Wiring Run: none; the recipe Reader accepted the first delivery.
- Dry runs: the factory library's custom arm refused at global route (DRT-0073, no access point) on
  16, then 24 more, cell types; root-caused to met2 inside the cells and pin metal written as OBS.

## Disagreements

- Live Run 0.1.0: none between the agent's claimed and the Harness's matched gains; the disagreement
  that mattered was between modelled and measured cell timing (NOR3_PU2 +3.96 % modelled with 14
  instances against +1.01 % measured with 3), which is why the Pack now characterizes every cell.
