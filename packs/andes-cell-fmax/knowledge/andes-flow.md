# The AndesCell Fmax flow

Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); not signoff, not silicon.

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
2. **Two agents in parallel**: the HimaTime agent (timing view: which cell types eat the worst
   paths) and the Qualib agent (library view: which of those cell types the stock library serves
   badly). Each delivers its own requirements file; a Reader checks each one.
3. **AndesCell generates** from both lists merged. It ranks every requested family that it has a
   template for and that is not already in the delivered library by HimaTime's estimated slack
   recovery on the build this round started from, breaks ties by priority, and generates **at most
   two families per round**. Requirements naming a family already delivered, or one AndesCell has
   no template for, are skipped with the reason in `state/generation.json`.
4. **Qualib cell screen**: every new cell against its stock cell (area ≤ 1.35×, input capacitance
   ≤ 1.30×, leakage ≤ 2.5×, DRC 0, LVS match, pin access). AndesCell also tries an extra-fast
   high-drive variant (`XF...`) of some families; it usually fails the leakage/capacitance limits.
5. **HimaTime verifies** the cells (FO4 delay against the stock cell) and estimates the design.
6. **Synthesis and APR rebuilds** the design with the stock library plus every accepted new cell
   of this and earlier rounds (cells that failed the screen are dont-use).
7. **Compare**: `state/round.json` and `derived/round-<k>.md` hold the before/after table (Fmax,
   worst slack, TNS, area, new-cell instances, route DRC) against the reference build, the gain, the
   best gain so far, and whether the round improved on every earlier build.
8. **Checks and next round**: new cells used, faster than before, clean build, Goal reached. The
   Campaign owner decides another round (back to step 1, with this round in `state/lessons.json`)
   or ends at the Goal. At most 4 rounds.

## The tools (all on PATH in the agents' sandbox)

| Tool | Command | What it does | Time |
| --- | --- | --- | --- |
| Synthesis and APR | `sapr run --design aes_cipher_top --out DIR [--extra-lib DIR] [--dont-use CELL]` | RTL to routed design | 60–120 s (the Pack runs it; agents do not) |
| HimaTime | `himatime load --db SAPR_DIR --out DIR` | timing reports: `report_timing.rpt`, `stage_breakdown.rpt`, `timing_summary.json` | ~5 s in the sandbox |
| HimaTime | `himatime report --db SAPR_DIR --stages --paths 5` | the same to stdout | < 1 s |
| HimaTime | `himatime estimate --db SAPR_DIR --families XNOR3,BUF` | what-if: Fmax if those families were AndesCell-class faster | < 1 s |
| Qualib | `qualib analyze --lib std9t_svt --timing TIMING_SUMMARY.json --out DIR [--extra-lib DIR]` | library gaps per family, ranked by the design's critical-path need | ~3 s in the sandbox |
| Qualib | `qualib list --family XNOR3` | stock cells of a family with area, cap, leakage, rise/fall FO4 | < 1 s |
| AndesCell | `andescell families` | the families AndesCell can build | < 1 s |
| AndesCell | `andescell generate --requirements FILE --db SAPR_DIR --round K --dry-run [--existing DIR ...]` | which families AndesCell would pick from a requirements file | < 1 s |
| XTop | `xtop -version` | timing ECO; installed, not part of this flow | — |

`-help` on any tool prints its options. Paths: the Campaign workspace is read-only for you. The
build this round starts from is `<campaign>/<timingState.buildDir>`; HimaTime's reports of it are
under `<campaign>/<timingState.dir>`; each delivered library is `<campaign>/<library.rounds[].dir>`.
Write your own tool outputs under your private workspace (`--out ./ht`, `--out ./ql`).

## What the round results mean

- `fmaxGainPct`: this round's new-library build against the reference build (not against the
  previous round). Rounds accumulate: round 2's build has round 1's cells too.
- A round that adds a family that is not on the worst paths gains nothing: the worst path is set by
  the slowest stages, and only the cell families on it matter.
- After a round, the worst path usually moves to a different path group (S-box/MixColumns,
  key expansion, load/round control, output decode). Read the new stage breakdown, not the old one.
- `lessons.json` lists for every round what each agent asked for, what AndesCell picked and skipped,
  and the gain. Do not ask again for a family already in `library.json`.
