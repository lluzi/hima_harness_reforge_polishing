# Specification

Design: `docs/superpowers/specs/2026-10-04-custom-cell-fmax-sky130-demo-design.md` (approved
2026-10-04). Differences from that design, found while verifying the Harness (§6 of the design):

| Design said | Built | Why |
| --- | --- | --- |
| `roundLimit` strategy bound into `generationLimit` | `generationLimit: 4` in `graph.yml`; the Run-start `generations` override sets fewer rounds | `generationLimit` is a plain number (`packs.ts`) |
| `judge-round` rules `[comparison-valid, cells-adopted, round-improved, fmax-goal]` | `check-round` judges `[cells-adopted, round-improved]`; a second Reader of the round record feeds `judge-round` `[comparison-valid, fmax-goal]` | The first two rules of the last judge are the constraint and the Goal; goal-met needs every rule of that judge to pass; an explore node needs exactly one judge after a fresh reading |
| `next-round` revisits `engineer` until a limit | Same; convergence reads `best_custom_fmax_mhz` (monotone), `generations: 2`, band 0.001 MHz | Converge measures movement; a best-so-far value moves only when a round improves |
| `round_improved` = valid and custom Fmax above the best so far | Also requires a positive matched gain | A faster custom arm that only tracks a faster control is not a cell gain |
| `finish` node writes the summary | `compare-round` rewrites `derived/summary.{md,json}` every round; the Run ends at the explore decision | An explore ending has no tool step after it |
| Validator is the `engineer` argv | The `cellfmax-recipe` Reader on `roundRecipe` runs the same validator at delivery; the argv is the no-delivery fallback | The Host verifies a resident delivery through the Reader of `produces` |
| `engineer` reads `[inputsState, baselineState, lessons, best]` | Same; `bind-inputs` creates empty `lessons.json` and `best.json` | A missing read file refuses the task start |

Schemas: `hima-cellfmax-inputs/1`, `hima-cellfmax-arm/1` (baseline and arms),
`hima-cellfmax-round-recipe/1` (design §3.2), `hima-cellfmax-round/1`, `hima-cellfmax-lessons/1`,
`hima-cellfmax-best/1`, `hima-cellfmax-summary/1`. Fmax = 1000 / (period − worst setup slack at
finish). Function verification: rounds synthesised from RTL by ORFS in both arms count as verified;
an `emap-window` round counts only with a passing equivalence log.
