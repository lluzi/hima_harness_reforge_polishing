# Qualib agent playbook

You own the library view of the round, twice: first (`qualib-agent`) which cell families on the
critical paths the stock library `std9t_svt` serves badly and what custom cells would close that
gap; then (`qualib-screen`) whether each cell AndesCell built may enter a build.

## Read first

- `timingState` (`state/timing.json`): the stage breakdown by cell family and the worst paths of
  the build this round starts from; `reports.summary` is HimaTime's `timing_summary.json`.
- `library` (`state/library.json`): families already delivered (with their directories).
- `lessons` (`state/lessons.json`): what earlier rounds asked for and gained.

## Analyse

1. `qualib analyze --lib std9t_svt --timing <campaign>/<timingState.reports.summary> --out ./ql`
   (add `--extra-lib <campaign>/<dir>` for every `library.rounds[].dir`). Read
   `./ql/library_analysis.rpt`: one row per family, ranked by the design's need, with drive range,
   FO4 delay, rise/fall ratio, critical-path share, estimated recovery, AndesCell headroom and the
   library gap (missing drives, slow rise, slow select arc, high input capacitance).
2. `qualib list --family XNOR3` shows the stock cells of one family: area, input cap, leakage, rise
   and fall FO4. A rise/fall ratio well above 1.1 or a missing drive step on a family with a large
   critical-path share is a strong case for a custom cell.
3. Families with no critical-path share are not worth a cell this round, whatever their gap.
4. `andescell generate --requirements <your file> --db <campaign>/<timingState.buildDir> --round <k>
   --dry-run --existing <each delivered library dir>` shows which of your families AndesCell would
   pick (at most two per round).

## Write

- 2-5 requirements, highest impact first. Each: `family`, `purpose` (the library gap to close:
  "balanced rise/fall XNOR3 with an X4 drive"), `target` with a percentage, `evidence` (the gap and
  the critical-path numbers: "XNOR3 r/f 1.36, only X1/X2; 25.7 % of the worst path"), `priority`.
- `reports/qualib-agent/r<k>/analysis.md`: the library facts you used, the gaps that matter on the
  critical paths, why these families, and which gaps you leave for later rounds. Keep Qualib's
  `library_analysis.rpt` beside it and deliver both as support.

## Screen the new cells (qualib-screen)

1. Read `generation` (`state/generation.json`): the cells AndesCell built this round and `dir`.
2. `qualib screen --cells <campaign>/<generation.dir> --out ./qs` writes `cell_screen.rpt` and
   `screen.json`: per cell the area, input capacitance and leakage against its stock cell, DRC,
   LVS, pin access, and PASS/FAIL with reasons.
3. Decide every cell: PASS or FAIL with its reasons. A cell the screen fails cannot pass. You may
   fail a cell the screen passes if you say why (e.g. a drive the design cannot use). Only the cells
   you pass enter the rebuild; the rest are dont-use.
4. The extra-fast variants (`XF...`) usually fail on leakage or input capacitance: say so in plain
   words ("leakage 2.9× the stock cell, above 2.5×").
5. Write the cell-screen file (`hima-andes-cell-screen/1`). Keep `cell_screen.rpt` and
   `analysis.md` in `reports/qualib-screen/r<k>/` and deliver them as support.
