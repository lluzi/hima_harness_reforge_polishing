# HimaTime agent playbook

You own the timing view of the round, twice: first (`himatime-agent`) which cell arcs of OpenC910
would give the most timing back if AndesCell made them faster; then (`himatime-verify`) which of the
cells AndesCell built really are faster than their stock cells (the cell-level check).

## Read first

- `timingState` (`state/timing.json`): `round` (your k), `buildDir` (the routed build this round
  starts from), `wnsNs`/`tnsNs`/`nvp` (reg2reg at route), `paths` (the 8 worst), `breakdown` (where
  the worst path's time goes) and `highValue` (HimaTime's high-value summary).
- `lessons` (`state/lessons.json`): earlier rounds. `library` (`state/library.json`): cells already delivered.

## Analyse (himatime-agent)

With `db = <campaign>/<timingState.buildDir>`, in your private workspace:

1. `himatime highvalue --db <db> --out ./hv` writes `high_value_cells.rpt` and `high_value.json`:
   the design's cells, the high-value instances (the top instances per rank type: logic depth,
   logic dimension, count, count × delay, count × slack), the library cells they use and the
   **listed high-value cells**, by family. These are the cells that sit on the most critical logic.
2. `himatime whatif --db <db> --scale 0.9 --out ./hw` writes seven rankings
   (`cell_what_if_sort_by_<KEY>.rpt`: TNS, WNS, NVP, and the slack-contribution keys) of what each
   cell arc would give back if its delay were 10 % lower, the top 50 of each, and `whatif.json`
   with the **merged** arcs (union, deduplicated, the arcs most rankings name first).
3. Read the rankings: which arcs give the most TNS back (`tns_delta_ns`), which move the worst
   slack (`wns_delta_ns`), which several rankings agree on. An arc is a cell, an input pin, an
   output pin and an edge (rise or fall): AndesCell makes one custom cell per arc.
4. The worst path itself is mostly an SRAM access (`breakdown`); no standard cell changes that. The
   custom cells work on the many paths just behind it: expect TNS and violating paths to move more
   than the worst slack.

## Write (himatime-agent)

- `python3 <campaign>/flow/andes_cli.py draft <campaign> himatime ./hw/whatif.json > requirements.json`
  writes the requirements with every merged arc and its `rankedBy`, `tnsGainNs` and `wnsGainNs`
  from HimaTime. Keep every arc (say in the analysis which matter most; HimaTime's cell-level check decides later which custom cells stay); never add
  arcs or change numbers: the precheck holds them to HimaTime's own answer.
- Write `summary`: how far the high-value analysis narrows the design (cells → high-value instances
  → listed cells → arcs) and the top three arcs by TNS gain, with their cell names.
- `reports/himatime-agent/r<k>/analysis.md`: what you ran, the funnel, the top arcs, how many
  rankings agree, what you expect. Keep `high_value_cells.rpt` and the `cell_what_if_sort_by_*.rpt`
  files beside it and deliver them all as support.

## Check the new cells (himatime-verify)

1. Read `generation` (`state/generation.json`): the counts and `dir`, where the cells are.
2. `himatime verify --cells <campaign>/<generation.dir> --db <campaign>/<timingState.buildDir> --out ./hv`
   writes `verify.rpt`, `verify.json` and `kept/`: per generated cell its best version, arc delay
   in ps and the Δ HimaTime reports, and whether it is kept (positive cell-level gain).
3. `python3 <campaign>/flow/andes_cli.py draft <campaign> himatime-verify ./hv/verify.json > check.json`
   writes `generated`, `kept`, `dropped` and `keptArcs` from HimaTime. Write `summary`: kept of
   generated, the families with the most kept cells, what the dropped cells mean (no cell-level gain:
   they never enter a build). Quote Δ as HimaTime reports it; do not reinterpret it.
4. Keep `verify.rpt` and `analysis.md` in `reports/himatime-verify/r<k>/` and deliver them as support.
