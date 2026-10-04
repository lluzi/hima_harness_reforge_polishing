# Fabric notes

1. `bind-inputs` (tool) verifies the Site bindings and writes `state/inputs.json`, empty
   `state/lessons.json` and `state/best.json`.
2. `baseline` (tool) runs ORFS aes at `baselinePeriodNs` in the pinned container; `read-baseline`
   and `check-baseline` (`baseline-valid`) gate the loop. Self-driving up to `engineer`.
3. `engineer` (resident OpenCode task, one per round; owner starts and collects it). Delivery is
   verified by the `cellfmax-recipe` Reader; a refused recipe is repaired in the same task.
4. Completing `engineer` opens the fork: `arm-custom → read-arm-custom` and
   `arm-control → read-arm-control` drive themselves in parallel (Site `parallelJobs: 3`).
5. `arms-joined` (judge, `arm-finished` per branch) → `compare-round` → `read-round` →
   `check-round` (`cells-adopted`, `round-improved`) → `read-round-goal` → `judge-round`
   (`comparison-valid`, `fmax-goal`). Self-driving up to `next-round`.
6. `next-round` (owner decision, chooser `cellfmax-next`): Goal met → `ended-goal-met`; best custom
   Fmax unchanged for two rounds → `ended-converged`; otherwise revisit `engineer`. Round five would
   exceed `generationLimit: 4` → `ended-budget-exhausted`.

No licence is held. An ORFS run of aes takes about 15–25 min with 8 CPUs on linglong.
