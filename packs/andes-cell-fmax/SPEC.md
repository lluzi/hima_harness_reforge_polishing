## Goal template

A Campaign of this Pack asks for new standard cells that make `aes_cipher_top` faster than its
reference build. Goal parameter `target_fmax_gain_pct` (percent, 0.1–30, default 5): the best valid
round's Fmax gain over the reference build must reach it. Strategy: `buildTimeoutMin` (min, default
20, per Synthesis and APR run) and `roundRevision` (count, the round counter the chooser advances).

## Constraints

- Site `eda_cluster_ctu_01` (or a Site binding `mockEdaRoot`, `designRoot`, `stockLibrary`,
  `engineeringCapabilities`): the toolchain and design are read-only; Campaigns write only under
  `workspaceRoot`; at most three Site jobs at once (two resident agents and one Reader fit).
- Clock fixed at 1.000 ns; RTL and flow settings fixed; only new cells change the build.
- At most two new families per round (AndesCell); at most 4 rounds (`generationLimit`).

## Run contract

Entry `bind-inputs` → `reference-build` → `read-reference` → `check-reference` (`reference-valid`)
→ `load-timing` → `read-timing` → fork {`himatime-agent` ∥ `qualib-agent`} (resident OpenCode
tasks; each `produces` its requirements file, Reader `andes-requirements`) → `requirements-joined`
(`requirements-valid`, per branch) → `generate-cells` → `screen-cells` → `verify-cells` →
`new-library-build` → `compare-round` → `read-round` → `check-round` (`cells-used`,
`round-improved`) → `read-round-goal` → `judge-round` (`round-valid`, `fmax-goal`) → `next-round`
(explore, chooser `andes-next`, revisit `load-timing`). Autopilot drives bind→read-timing (which
opens the fork) and requirements-joined→judge-round; the owner drives both agent branches (begin,
`engineering start`, delivery, release, complete) and decides `next-round`. Budget: time box 3 h
with a 10 min closing reserve; `generationLimit: 4`; converge on `best_fmax_mhz` (band 0.001 MHz,
2 generations).

## Semantics

`design_fmax_mhz` = 1000 / (1.000 − WNS) from the sapr post-route summary (reference build via
`andes-reference`, new-library build via `andes-round`). `fmax_gain_pct` = new-library Fmax /
reference Fmax − 1; `best_gain_pct` = best valid round's; `best_fmax_mhz` monotone. `round_valid`:
the build finished at the reference clock, route DRC 0, only screened and verified new cells used.
`round_improved`: valid and faster than every earlier build. `new_cell_instances`: AndesCell cell
instances in the routed netlist.

## Judge rules

- `reference-valid`: `reference_valid` = 1.
- `requirements-valid` (join, per branch): `requirements_valid` = 1.
- `cells-used`: `new_cell_instances` ≥ 1. `round-improved`: `round_improved` = 1.
- `round-valid` (constraint): `round_valid` = 1. `fmax-goal` (Goal): `best_gain_pct` ≥ target.

## Choosers

`andes-next` at `next-round`: constraint PASS and Goal PASS → goal met; otherwise
`next: {roundRevision: roundStep}` (another round). Reads `best_fmax_mhz` for convergence; changes
only the round counter.

## Endings

`ended-goal-met` (owner accepts goal-met), `ended-converged` (best Fmax flat over two rounds),
`ended-budget-exhausted` (round limit or time box), `ended-goal-not-met` (owner ends early);
`blocked` (wait) when the reference build or a requirements join fails.

## Workshops

Two resident engineering Workshops per round, in parallel: `himatime-agent` (knowledge
`andes-flow.md`, `himatime-playbook.md`, `requirements-format.md`, `evidence-and-claims.md`;
artifacts `requirements/himatime/`) and `qualib-agent` (same with `qualib-playbook.md`; artifacts
`requirements/qualib/`). Both read `inputsState`, `referenceBuild`, `timingState`, `lessons`,
`library`. Each prechecks and delivers one `hima-andes-requirements/1` with `analysis.md`; a refused
delivery is repaired in the same task.
