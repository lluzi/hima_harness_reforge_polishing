# HimaTime agent playbook

You own the timing view of the round: where do the worst paths of `aes_cipher_top` spend their
time, and which cell families would give the most Fmax back if AndesCell made them faster.

## Read first

- `timingState` (`state/timing.json`): `round` (your k), `source`, `fmaxMhz`, `wnsNs`,
  `worstPaths` (id, group, start/end, slack, cell delay by family) and `stageBreakdown` (per family:
  stages, cell delay, share of path delay, worst-path share, `estRecoveryNs`, achievable speed-up,
  whether it is already generated).
- `lessons` (`state/lessons.json`): earlier rounds, what was requested, picked, skipped, gained.
- `library` (`state/library.json`): families already delivered. They are not generated again.

## Analyse

1. `himatime report --db <campaign>/<timingState.buildDir> --stages --paths 5` prints the summary,
   the stage table and the 5 worst paths in full (Startpoint/Endpoint, every cell with its incr
   and path delay, slack). Look at which cell types repeat on the worst path and its neighbours.
2. Group by path group: S-box/MixColumns paths are XNOR3/BUF/XOR2-heavy, key expansion is
   XOR2/MUX2I-heavy, load/round control is AOI21/OAI21-heavy, output decode is NAND2/NOR2-heavy.
   The worst group sets Fmax now; the next group sets it once the worst one is fixed.
3. `estRecoveryNs` is HimaTime's own ranking signal (criticality-weighted slack it expects back);
   AndesCell ranks your families by it. `worstPathSharePct` tells you what limits Fmax right now.
4. Test pairs: `himatime estimate --db <campaign>/<buildDir> --families XNOR3,BUF` prints the
   estimated Fmax with both families faster. Try 2-3 pairs; the best pair is your top two.
5. Net delay is about a quarter of path delay and no cell changes it; DFF clock-to-Q helps only a
   little (−10 % achievable).

## Write

- 2-5 requirements, highest impact first (priority 1, 2, ...). The first two decide this round.
- Each requirement: `family` (an AndesCell family: `andescell families`), `purpose` (what the cell
  must do better, e.g. "faster rising output on the S-box XNOR3 trees"), `target` with a percentage
  (`"cell delay -30 % at fanout 4"`; AndesCell's typical reach per family is the stage table's
  achievable column), `evidence` (paths and numbers: "A1-A7: XNOR3 268 ps of 1044 ps on A1, est.
  recovery 3.04 ns"), `priority`.
- `analysis.md`: what you ran, what you found (the numbers), why these families, what you expect
  the round to give (the estimate), and what will limit Fmax next.
