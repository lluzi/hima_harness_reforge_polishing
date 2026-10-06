## Goal template

A Campaign of this Pack asks for a custom standard-cell library that makes the ORFS aes design on
sky130hd faster than the stock library at the same clock. Goal parameter `target_fmax_gain_pct`
(percent, 0.1–50, default 5): the best matched Fmax gain of any valid round must reach it. Strategy
parameters: `baselinePeriodNs` (ns, default 3.6, the stock baseline clock), `armTimeoutMin` (min,
default 60, per ORFS run) and `engineeringRevision` (count, the round counter the chooser advances).

## Constraints

- Open-source SKY130 only (IIC-OSIC-TOOLS image pinned by id, ORFS checkout, aes, sky130hd); no
  licence, no commercial tool. The ORFS, celluzi and bool2cmos trees are read-only bindings.
- A Campaign writes only under the Site's `workspaceRoot`; containers run with `--cpus` limits (8 per
  ORFS arm, 16 for characterization); at most three Site jobs at once.
- Cell timing in the arms is only HimaHarness's own characterization: MOCK for `abstract` cells (RC
  model of the sized netlist anchored to foundry tables, no SPICE, error in
  `flow/toolbox/char/mock-fit.json`), ngspice calibrated within 15 % p90 for `drc-lvs-clean` cells.
  The engineer's Liberty is a claim.
- At most 400 new cells per round; every best-library cell stays byte-identical in later recipes.
- Gains count only between the two arms of one round (same recipe, clock and characterized library).

## Run contract

Entry `bind-inputs` → `baseline` → `read-baseline` → `check-baseline` (`baseline-valid`) →
`engineer` (resident OpenCode task, `produces: roundRecipe`, Reader `cellfmax-recipe`) →
`characterize` → fork {`arm-custom` → `read-arm-custom`, `arm-control` → `read-arm-control`} →
`arms-joined` (`arm-finished`) → `compare-round` → `read-round` → `check-round` (`cells-adopted`,
`round-improved`) → `read-round-goal` → `judge-round` (`comparison-valid`, `fmax-goal`) →
`next-round` (explore, chooser `cellfmax-next`, revisit `engineer`). Autopilot drives bind→engineer,
characterize→arms (fork) and arms-joined→next-round; the owner starts and collects `engineer` and
decides `next-round`. Budget: time box 8 h with a 15 min closing reserve, `generationLimit: 4`,
converge on `best_custom_fmax_mhz` (band 0.001 MHz, 2 generations).

## Semantics

Fmax = 1000 / (period − worst setup slack at ORFS finish), MHz. `round_gain_pct` = custom-arm Fmax /
control-arm Fmax − 1; `best_gain_pct` = best valid round gain so far; `best_custom_fmax_mhz` = best
custom-arm Fmax of an improving round (monotone). `comparison_valid`: both arms finished, same recipe
SHA-256 and clock, control used no custom cell, function verified (ORFS synthesis in both arms, or a
passing `emap` equivalence log). `custom_adopted`: custom instances in the custom arm's `6_final.v`.
`round_improved`: valid, positive gain and a custom Fmax above the best so far. Units are lower-case
slugs (`mhz`, `percent`, `count`, `ns`).

## Judge rules

- `baseline-valid`: the stock baseline finished with zero route DRC (`baseline_valid` = 1).
- `arm-finished`: an arm finished and its metrics were read (`arm_finished` = 1), per branch.
- `cells-adopted`: at least one custom instance (`custom_adopted` ≥ 1).
- `round-improved`: `round_improved` = 1.
- `comparison-valid` (constraint of the last judge): `comparison_valid` = 1.
- `fmax-goal` (Goal): `best_gain_pct` ≥ `target_fmax_gain_pct`.

## Choosers

`cellfmax-next` at `next-round`: constraint PASS and Goal PASS → goal met; any other verdict pair →
`next: {engineeringRevision: roundStep}` (another engineering round, `roundStep` 1). It reads
`best_custom_fmax_mhz` for convergence. It changes only the round counter: never the Goal, an arm or
a measured fact.

## Endings

- `ended-goal-met`: the owner accepts the chooser's goal-met at `next-round`.
- `ended-converged`: `best_custom_fmax_mhz` unchanged within 0.001 MHz over two generations.
- `ended-budget-exhausted`: a fifth round would exceed `generationLimit: 4`, or the time box ends.
- `ended-goal-not-met`: the owner ends a Run scoped to fewer rounds.
- `blocked` (wait node, not an ending): the baseline check FAILs or is UNDETERMINED; the Run holds
  there until the owner repairs the Site and revisits, or ends it.

## Workshops

One resident engineering Workshop per round (`engineer`, role `resident-engineering-agent`, reads
`inputsState`, `baselineState`, `lessons`, `best`; knowledge `cell-playbook.md`, `toolbox.md`,
`evidence-and-claims.md`; artifacts under `cells/`). It analyses the critical paths, generates many
cell ideas, builds them as abstract (mock-layout) cells (`flow/toolbox/abstract`, seconds),
optionally mock-characterizes them itself (seconds) and runs at most one trial pair, writes findings,
library table and usage guide, prechecks and delivers one `hima-cellfmax-round-recipe/1`. A refused
delivery is repaired in the same task.

## Knowledge

- `knowledge/cell-playbook.md`: how HimaHarness judges cells, what measurement has shown (skew is a
  trade), resizer equivalence rules (footprint and function text), volume generation and round
  planning.
- `knowledge/toolbox.md`: sandbox tools, trial ORFS runs, abstract (mock-layout) cells, own mock
  characterization, emap; the factory, marked as not part of this demo.
- `knowledge/evidence-and-claims.md`: mock versus measured versus claimed, the mock's recorded
  error, and the verbatim claim boundary.
- Design record: `docs/superpowers/specs/2026-10-04-custom-cell-fmax-sky130-demo-design.md`; the
  graph differs from it as recorded in FABRIC.md `Gaps`.
