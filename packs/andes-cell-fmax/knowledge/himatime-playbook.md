# HimaTime agent playbook

You own the timing view of the round, twice: first (`himatime-agent`) where the worst paths of
`aes_cipher_top` spend their time and which cell families would give the most Fmax back if
AndesCell made them faster; then (`himatime-verify`) how much faster the worst paths are with the
cells AndesCell built.

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
- `reports/himatime-agent/r<k>/analysis.md`: what you ran, what you found (the numbers), why these
  families, what you expect the round to give (the estimate), and what will limit Fmax next. Keep
  the HimaTime output you quote beside it (e.g. `himatime report ... > stage_report.rpt`) and
  deliver both as support.

## Verify the new cells (himatime-verify)

1. Read `generation` (`state/generation.json`): the cells AndesCell built this round and `dir`,
   where they are. The build to re-time is `<campaign>/<timingState.buildDir>`, the one this round
   started from.
2. `himatime verify --cells <campaign>/<generation.dir> --db <campaign>/<timingState.buildDir>
   --paths 8 --out ./hv` writes `verify.rpt` and `verify.json`: the 8 worst paths worst first, each
   with its delay before and after the new cells and the gain in ps; the **local gain** (the worst
   path's gain); every new cell's FO4 against its stock cell; and a design estimate.
3. A positive local gain says the cells help where they sit. Say which paths gain the most, which
   gain nothing (no new cell on them) and which path group will limit Fmax after the rebuild.
4. The extra-fast variants (`XF...`) are faster still but may not pass the Qualib screen, which
   runs at the same time; the rebuild uses only the cells that pass.
5. Copy HimaTime's numbers into the cell-timing file (`hima-andes-cell-timing/1`); the precheck
   holds them against HimaTime's own answer. Keep `verify.rpt` and `analysis.md` in
   `reports/himatime-verify/r<k>/` and deliver them as support.
