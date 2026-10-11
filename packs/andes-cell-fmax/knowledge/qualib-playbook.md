# Qualib agent playbook

You own the library view of the round, twice: first (`qualib-agent`) whether the stock libraries can
make HimaTime's critical cells faster, and what a custom cell must respect; then (`qualib-screen`)
whether each cell HimaTime keeps may enter a build.

## Read first

- `timingState` (`state/timing.json`): `buildDir` (the routed build this round starts from) and
  the worst paths. `library` (`state/library.json`): cells already delivered. `lessons`: earlier rounds.

## Analyse (qualib-agent)

With `db = <campaign>/<timingState.buildDir>`, in your private workspace:

1. `himatime whatif --db <db> --scale 0.9 --out ./hw` gives the arcs HimaTime ranks (`./hw/whatif.json`).
2. `qualib analyze --db <db> --arcs ./hw/whatif.json --out ./ql` writes `library_analysis.rpt` and
   `library_analysis.json`: per arc the stock delay of the ULVT, LVT and SVT cell at the centre of
   its delay table and which Vt is fastest; the cells by family; and the **constraints** a custom
   cell must meet: the same footprint (area and pins as the stock cell), input capacitance within a
   limit of the stock cell's, LVS match.
3. The question: can the stock libraries make these cells faster? The design already uses the ULVT
   cells; where ULVT is the fastest Vt, a Vt swap only makes the arc slower (LVT and SVT are slower by
   a median the report states). Then only a new cell can help. `qualib list --arcs ./hw/whatif.json`
   prints the same per-arc facts.

## Write (qualib-agent)

- `python3 <campaign>/flow/andes_cli.py draft <campaign> qualib ./ql/library_analysis.json > requirements.json`
  writes the cells and Qualib's constraints. You may remove cells (say why); never add cells or change
  the constraints: the precheck holds them to Qualib's own answer.
- Write `summary`: how many arcs and cells, on how many arcs ULVT is already the fastest, how much
  slower LVT and SVT are, and the constraints.
- `reports/qualib-agent/r<k>/analysis.md` and `library_analysis.rpt` beside it, delivered as support.

## Screen the kept cells (qualib-screen)

1. Read `generation` (`state/generation.json`): the cells AndesCell built and `dir`.
2. HimaTime keeps only the cells with a positive cell-level gain. Get them: `himatime verify --cells
   <campaign>/<generation.dir> --db <campaign>/<timingState.buildDir> --out ./hv` (its `kept/` folder).
3. `qualib screen --cells ./hv/kept --out ./qs` writes `cell_screen.rpt` and `screen.json`: per cell
   the area ratio (no larger than the stock cell: the same footprint), the input-capacitance ratio
   (within 1.30× the stock cell's), LVS, and PASS/FAIL with reasons.
4. `python3 <campaign>/flow/andes_cli.py draft <campaign> qualib-screen ./qs/screen.json > screen.json`
   writes PASS or FAIL per kept cell with Qualib's reasons. A cell the screen fails cannot pass; you
   may fail a cell the screen passes if you say why. Only the cells you pass enter the rebuild.
5. Write `summary` (pass and fail counts, the input-cap range). Keep `cell_screen.rpt` and
   `analysis.md` in `reports/qualib-screen/r<k>/` and deliver them as support.
