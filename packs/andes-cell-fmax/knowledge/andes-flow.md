# The AndesCell Fmax flow

## The design and the goal

- Design `aes_cipher_top` (AES-128, one round per clock), 28 nm, stock library `std9t_svt`
  (9-track SVT, corner tt0p90v25c), clock `clk` at 1.000 ns.
- Reference build (stock library only): Fmax ≈ 957.67 MHz, worst slack −0.0442 ns, TNS ≈ −3.2 ns,
  ≈ 41 200 µm², ≈ 18 400 instances, route DRC 0.
- Fmax = 1000 / (1.000 − worst slack in ns) MHz. The Campaign Goal is a percentage: the best
  new-library build's Fmax gain over the reference build must reach it (default 5 %).
- The only way to gain is new standard cells. The clock, the RTL and the flow settings stay fixed.

## One round

1. **HimaTime loads the latest build** (`load-timing`): the reference build in round 1, the latest
   new-library build after. `state/timing.json` holds its Fmax, the 8 worst paths, and the stage
   breakdown by cell family. Its `round` is this round's number k.
2. **Propose, two agents in parallel**: the HimaTime agent (timing view: which cell types eat the
   worst paths) and the Qualib agent (library view: which of those cell types the stock library
   serves badly). Each delivers its own requirements file; a Reader checks each one, and the join
   "Both requirement lists ready" passes when both are valid.
3. **The AndesCell agent chooses the cells** (`andescell-agent`): it merges both lists, ranks the
   requested families that AndesCell has a template for and that are not in the delivered library
   by HimaTime's estimated slack recovery on the build this round started from, and writes a
   generation plan of **one or two families**, each with its reason, plus why every other requested
   family waits.
4. **AndesCell generates** (`generate-cells`) exactly the plan's families. AndesCell also tries an
   extra-fast high-drive variant (`XF...`) of some families; it usually fails the screen's
   leakage/capacitance limits. `state/generation.json` holds the cells and their directory.
5. **Verify, two agents in parallel**: the HimaTime agent re-times the 8 worst paths of the build
   this round started from with the new cells (`himatime verify`): each path's delay before and
   after in ps, the **local gain** on the worst path, and each cell's FO4 against its stock cell.
   The Qualib agent screens every new cell (`qualib screen`: area ≤ 1.35×, input capacitance
   ≤ 1.30×, leakage ≤ 2.5× the stock cell, DRC 0, LVS match, pin access) and passes or fails each.
   Each delivery is checked against the tools' own answer.
6. **Local gain confirmed** (`cells-verified`): the local gain is above 0 ps and at least one cell
   passed the screen. Otherwise the Run stops for a person.
7. **Synthesis and APR rebuilds** the design with the stock library plus every accepted new cell
   of this and earlier rounds (cells the Qualib agent did not pass are dont-use).
8. **Compare**: `state/round.json` and `derived/round-<k>.md` hold the before/after table (Fmax,
   worst slack, TNS, area, new-cell instances, route DRC) against the reference build, the gain, the
   best gain so far, and whether the round improved on every earlier build.
9. **Checks and next round**: new cells used, faster than before, clean build, Goal reached. The
   Campaign owner decides another round (back to step 1, with this round in `state/lessons.json`)
   or ends at the Goal. At most 4 rounds.

## Reports

Every step leaves the reports a person reads at `reports/<step>/r<k>/` of the Campaign workspace:
the reference build and each rebuild (`report_qor.rpt`, `postroute_timing.rpt`, `area.rpt`,
`route_drc.rpt`; the rebuild adds HimaTime's `report_timing.rpt`), the HimaTime load
(`report_timing.rpt`, `stage_breakdown.rpt`), AndesCell (`generation.rpt`), the comparison
(`round-<k>.md`). Each agent delivers its own: its `analysis.md` and the tool reports it used, in
`reports/<its step>/r<k>/` of its private workspace, delivered as support (`himatime-agent`,
`qualib-agent`, `andescell-agent`, `himatime-verify`, `qualib-screen`).

## For the Campaign owner: what to do each round

The five agent steps do not start by themselves. Each round has three agent turns, and each comes
as soon as the automatic segment before it hands back:

1. **Propose**: after "Reference build and timing" (round 1) or "Load into HimaTime" (later
   rounds), begin **both** `himatime-agent` and `qualib-agent` and start **both** engineering tasks
   in the same turn, so they run in parallel (the Site allows 3 jobs). Give each task this round's
   number k and, from round 2 on, one sentence on what the last round showed.
2. **Choose**: after "Requirement check", begin `andescell-agent` and start its task
   (round k; the two lists are its inputs).
3. **Verify**: after "Cell generation", begin **both** `himatime-verify` and `qualib-screen` and
   start **both** tasks in the same turn.

When a task delivers, collect it; when its Reader accepts the delivery, release and complete that
node. A refused delivery comes back with the problems: send them to the same task to repair. After
the verify pair, the automatic segment "Rebuild and comparison" runs to the round checks; then decide
the next round.

Report to the person in chip-designer words, one line per step as it finishes: what each agent
asked for or chose and why, the local gain in ps on the worst path, which cells passed the screen
and why the others did not, then before → after (Fmax, worst slack, TNS, area, new-cell instances)
against the reference build, the gain against the target, and the next step.

## The tools (all on PATH in the agents' sandbox)

| Tool | Command | What it does | Time |
| --- | --- | --- | --- |
| Synthesis and APR | `sapr run --design aes_cipher_top --out DIR [--extra-lib DIR] [--dont-use CELL]` | RTL to routed design | 60–120 s (the Pack runs it; agents do not) |
| HimaTime | `himatime load --db SAPR_DIR --out DIR` | timing reports: `report_timing.rpt`, `stage_breakdown.rpt`, `timing_summary.json` | ~5 s in the sandbox |
| HimaTime | `himatime report --db SAPR_DIR --stages --paths 5` | the same to stdout | < 1 s |
| HimaTime | `himatime estimate --db SAPR_DIR --families XNOR3,BUF` | what-if: Fmax if those families were AndesCell-class faster | < 1 s |
| HimaTime | `himatime verify --cells ANDESCELL_DIR --db SAPR_DIR --paths 8 --out DIR` | the worst paths re-timed with new cells (before/after/gain in ps, the local gain), each cell's FO4 against its stock cell: `verify.rpt`, `verify.json` | ~3 s in the sandbox; `--json` alone instant |
| Qualib | `qualib analyze --lib std9t_svt --timing TIMING_SUMMARY.json --out DIR [--extra-lib DIR]` | library gaps per family, ranked by the design's critical-path need | ~3 s in the sandbox |
| Qualib | `qualib list --family XNOR3` | stock cells of a family with area, cap, leakage, rise/fall FO4 | < 1 s |
| Qualib | `qualib screen --cells ANDESCELL_DIR --out DIR` | the cell screen: `cell_screen.rpt`, `screen.json` | ~3 s in the sandbox; `--json` alone instant |
| AndesCell | `andescell families` | the families AndesCell can build | < 1 s |
| AndesCell | `andescell generate --requirements FILE --db SAPR_DIR --round K --dry-run [--existing DIR ...]` | which families AndesCell would pick from a requirements file, ranked by estimated recovery | < 1 s |
| Pack | `python3 <campaign>/flow/andes_cli.py merged <campaign>` | both agents' requirements of this round as one list | < 1 s |
| Pack | `python3 <campaign>/flow/andes_cli.py precheck <campaign> <kind> <file>` | the Reader's own check of a delivery | < 1 s |
| XTop | `xtop -version` | timing ECO; installed, not part of this flow | — |

`-help` on any tool prints its options. Paths: the Campaign workspace is read-only for you. The
build this round starts from is `<campaign>/<timingState.buildDir>`; HimaTime's reports of it are
under `<campaign>/<timingState.dir>`; each delivered library is `<campaign>/<library.rounds[].dir>`.
AndesCell's cells of this round are in `<campaign>/<generation.dir>`. Write your own tool outputs
under your private workspace (`--out ./ht`, `--out ./ql`) and keep the reports you deliver in
`reports/<your step>/r<k>/` there.

## What the round results mean

- `fmaxGainPct`: this round's new-library build against the reference build (not against the
  previous round). Rounds accumulate: round 2's build has round 1's cells too.
- A round that adds a family that is not on the worst paths gains nothing: the worst path is set by
  the slowest stages, and only the cell families on it matter.
- After a round, the worst path usually moves to a different path group (S-box/MixColumns,
  key expansion, load/round control, output decode). Read the new stage breakdown, not the old one.
- The local gain is the worst path's own gain, before the rebuild: it says the cells help where
  they sit. The rebuild's Fmax gain is smaller, because the next path group then limits Fmax.
- `lessons.json` lists for every round what each agent asked for, what the AndesCell agent chose
  and why, what was skipped, the local gain, the screen and the gain. Do not ask again for a family
  already in `library.json`.
