# The AndesCell flow on OpenC910

## The design and the goal

- Design `openc910`: the OpenC910 (T-Head XuanTie C910) dual-core RISC-V CPU with its shared L2
  cache, on 7 nm-class stock libraries (ULVT, with LVT and SVT alongside), clock 0.500 ns (2 GHz).
  `design-notes.md` has the numbers the Site's tools print for it; the Campaign measures them again.
- The flow (Synthesis and APR, `sapr`) is netlist load (prePlace), placement (place_opt),
  clock-tree synthesis (CTS) and routing with optimization (route). **Every build's result is its
  timing at the end of route, path group reg2reg** (flop to flop: the paths that set the core clock).
- The measure is the reg2reg worst slack at route. **Timing gain** = (custom-cell build's worst
  slack − reference worst slack) / clock period, in percent: +5 ps at 0.500 ns is +1 %. The Goal
  (default +1 % of the clock period) is reached when the best valid round's gain reaches it.
- Show worst slack in ps, TNS in ns and violating paths as counts. There is no Fmax in this flow.
- The only way to gain is new standard cells. The netlist, the clock and the flow settings stay fixed.
- The Site has build data for one custom-cell round; one round is expected to meet the Goal. A
  second round's rebuild with another cell set is refused by the Site, so the owner ends at the Goal.

## One round

1. **HimaTime loads the latest build** (`load-timing`): the reference build in round 1.
   `state/timing.json` holds its reg2reg worst slack, TNS and violating paths at route, the 8 worst
   paths, where the worst path's time goes (launch clock, SRAM access, cell families, nets) and
   HimaTime's high-value summary. Its `round` is this round's number k.
2. **Propose, two agents in parallel.** The HimaTime agent runs `himatime highvalue` (the design's
   cells ranked by logic depth, logic dimension, count, count × delay and count × slack, down to the
   high-value library cells) and `himatime whatif --scale 0.9` (seven rankings of what each cell arc
   would give back if it were 10 % faster, merged and deduplicated) and asks for those **arcs**
   (cell, from pin, to pin, edge). The Qualib agent runs `qualib analyze` on the same arcs and shows
   the stock libraries cannot make them faster (ULVT is already the fastest Vt on most arcs; LVT and
   SVT are slower), and lists the **cells** with the constraints a custom cell must meet (same
   footprint, input capacitance within its limit, LVS match). A Reader checks each delivery against
   the tools; the join "Both requirement lists ready" passes when both are valid.
3. **The AndesCell agent plans** (`andescell-agent`): the arcs both lists allow (HimaTime's arcs
   whose cell Qualib lists) and AndesCell's settings, 50 iterations per arc at an arc delay target
   10 % below the stock cell's.
4. **AndesCell generates** (`generate-cells`) exactly the plan's arcs: per arc a design-space
   exploration that keeps the best versions; some arcs fail (no version passes). `state/generation.json`
   holds the counts and the cells' directory.
5. **Verify, two agents in parallel.** The HimaTime agent runs the cell-level check (`himatime
   verify`): each generated cell's best version against its stock cell; the cells with a positive
   cell-level gain are **kept**. The Qualib agent screens the kept cells (`qualib screen`: area no
   larger than the stock cell's, input capacitance within 1.30×, LVS match) and passes or fails each.
   Each delivery is checked against the tools' own answer.
6. **Cell-level gain confirmed** (`cells-verified`): at least one cell kept and at least one kept cell
   passed the screen. Otherwise the Run stops for a person.
7. **The full flow runs again** (`new-library-build`) with the stock libraries plus every kept and
   screened cell (`sapr run --design openc910 --extra-lib <the round's library folder>`).
8. **Compare** at route: `state/round.json` and `derived/round-<k>.md` hold the table (reg2reg worst
   slack, TNS, violating paths, all groups, density, power, custom-cell instances and share) against
   the reference build, the timing gain, the best gain so far, and whether the round improved.
9. **Checks and next round**: custom cells used, better than every earlier build, clean build,
   Goal reached. The owner ends at the Goal or decides another round.

## Reports

Every step leaves the reports a person reads at `reports/<step>/r<k>/` of the Campaign workspace:
both builds (the stage summaries `prePlace/place/cts/route.summary.rpt`, the reg2reg timing
`*_reg2reg.tarpt`, power, congestion, the clock tree `cts.sum.rpt`, and `flow_summary.rpt`; the
rebuild adds HimaTime's `report_timing.rpt`), the HimaTime load (`report_timing.rpt`,
`stage_breakdown.rpt`, `high_value_cells.rpt`), AndesCell (`generation.rpt`), the comparison
(`round-<k>.md`). Each agent delivers its own `analysis.md` and the tool reports it used.

Charts (`hima-chart/1`) sit beside the reports, each written by a Pack step or by the Reader that
accepts a delivery, from the tools' own numbers:

| Step | Chart | Shows |
| --- | --- | --- |
| `reference-build` | `summary.chart.json` | the reference build at route: reg2reg worst slack, TNS and violating paths, all groups, path groups, density, power, clock sinks and gates (a table) |
| `reference-build` | `path-groups.chart.json` | worst slack, TNS and violating paths per path group at route (a table) |
| `reference-build` | `flow-stages.chart.json` | reg2reg worst slack after prePlace, place_opt, CTS and route |
| `reference-build` | `timing.chart.json` | slack of the 8 worst reg2reg paths at route, by end point |
| `load-timing` | `stage-breakdown.chart.json` | where the worst path's time goes: launch clock, SRAM access, cell families, nets (ps) |
| `himatime-agent` | `funnel.chart.json` | design cells → high-value instances → library cells → high-value cells → what-if arcs → arcs requested (a table) |
| `himatime-agent` | `proposal.chart.json` | the 10 requested arcs with the most what-if TNS gain (ns), and how many rankings name each |
| `qualib-agent` | `proposal.chart.json` | stock arc delay of ULVT, LVT and SVT (ps) for 8 requested arcs: ULVT is already the fastest |
| `generate-cells` | `generation.chart.json` | requested, generated, failed, iterations per arc, versions kept per arc (a table) |
| `himatime-verify` | `cell-check.chart.json` | kept cells by family, kept of generated in the subtitle |
| `himatime-verify` | `top-cells.chart.json` | the first kept cells: best version and its delay (ps), Δ as HimaTime reports it, input-cap change (%) (a table) |
| `qualib-screen` | `screen.chart.json` | the screen: pass, fail, input-cap ratio min/median/max, area ratio, LVS (a table) |
| `compare-round` | `comparison.chart.json` | reference against custom cells at route, the same rows plus custom-cell instances, share and the timing gain (% of the clock) |
| `compare-round` | `flow-stages.chart.json` | reg2reg worst slack by stage, both builds |
| `compare-round` | `path-groups.chart.json` | each path group at route, both builds |
| `compare-round` | `worst-paths.chart.json` | the custom build's 8 worst reg2reg paths against the same paths in the reference build |

## For the Campaign owner: what to do each round

The five agent steps do not start by themselves. Each round has three agent turns, and each comes
as soon as the automatic segment before it hands back. Talk like a chip designer: worst slack in
ps, TNS in ns, violating paths and cells as counts, real cell and instance names from the charts
and reports; every number you say is one a chart or report shows.

0. **Initial summary** (round 1 only): when "Reference build and timing" hands back, first summarize
   the reference build at route in a few sentences: the design, the reg2reg worst slack, TNS and
   violating paths, which path group limits the all-group slack, the clock tree, how the slack moved
   through prePlace, place_opt, CTS and route, and where the worst path's time goes (which unit, the
   SRAM access). Show `reports/reference-build/r1/summary.chart.json`,
   `reports/reference-build/r1/path-groups.chart.json`, `reports/reference-build/r1/flow-stages.chart.json`,
   `reports/reference-build/r1/timing.chart.json` and `reports/load-timing/r1/stage-breakdown.chart.json`
   with `hima_chart`. Then propose.
1. **Propose**: begin **both** `himatime-agent` and `qualib-agent` and start **both** engineering
   tasks in the same turn, so they run in parallel (the Site allows 3 jobs). Give each task this
   round's number k and, from round 2 on, one sentence on what the last round showed.
2. **Choose**: after "Requirement check", and before you begin the AndesCell agent, show
   `reports/himatime-agent/r<k>/funnel.chart.json`, `reports/himatime-agent/r<k>/proposal.chart.json`
   and `reports/qualib-agent/r<k>/proposal.chart.json` with `hima_chart`, and say in a sentence each:
   how HimaTime narrowed the design to the arcs it asks for (name the top three arcs by what-if TNS
   gain with their cells), and why Qualib says the stock libraries cannot help (ULVT already the
   fastest Vt on most arcs, LVT and SVT slower). Then begin `andescell-agent` and start its task.
3. **Verify**: after "Cell generation", show `reports/generate-cells/r<k>/generation.chart.json`
   and say how many arcs were generated and how many failed; begin **both** `himatime-verify` and
   `qualib-screen` and start **both** tasks in the same turn. When both are complete, show
   `reports/himatime-verify/r<k>/cell-check.chart.json` and `reports/himatime-verify/r<k>/top-cells.chart.json`
   with `hima_chart` and say how many cells HimaTime kept of those generated and how many passed the
   Qualib screen.

When a task delivers, collect it; when its Reader accepts the delivery, release and complete that
node. A refused delivery comes back with the problems: send them to the same task to repair. After
the verify pair, the automatic segment "Rebuild and comparison" runs to the round checks; then decide
the next round. **At the end**, give the comparison at route in a few plain sentences: reg2reg worst
slack before → after in ps and the gain as a percentage of the 0.500 ns clock against the Goal,
TNS before → after and the change in percent, violating paths before → after and the change in
percent, custom-cell instances and their share, and what did not move (the all-group worst slack
when an input or output group sets it). Show `reports/compare-round/r<k>/comparison.chart.json`,
`reports/compare-round/r<k>/flow-stages.chart.json`, `reports/compare-round/r<k>/path-groups.chart.json`
and `reports/compare-round/r<k>/worst-paths.chart.json` with `hima_chart`, then end with the claim
boundary sentence (`evidence-and-claims.md`).

## The tools (all on PATH in the agents' sandbox)

| Tool | Command | What it does | Time |
| --- | --- | --- | --- |
| Synthesis and APR | `sapr run --design openc910 --out DIR [--extra-lib DIR]` | the full flow to route | 80–100 s (the Pack runs it; agents do not) |
| HimaTime | `himatime load --db SAPR_DIR --out DIR` | `report_timing.rpt`, `stage_breakdown.rpt`, `timing_summary.json` of a build at route | a few s |
| HimaTime | `himatime report --db SAPR_DIR [--json]` | the same to stdout | < 1 s |
| HimaTime | `himatime highvalue --db SAPR_DIR [--out DIR] [--json]` | the high-value cell analysis: `high_value_cells.rpt`, `high_value.json` | a few s |
| HimaTime | `himatime whatif --db SAPR_DIR --scale 0.9 [--out DIR] [--json]` | the cell what-if: seven rankings `cell_what_if_sort_by_<KEY>.rpt` and `whatif.json` with the merged arcs | a few s |
| HimaTime | `himatime verify --cells ANDESCELL_DIR --db SAPR_DIR [--out DIR] [--json]` | the cell-level check: `verify.rpt`, `verify.json`, `kept/` | a few s; `--json` alone instant |
| Qualib | `qualib analyze --db SAPR_DIR --arcs FILE --out DIR [--json]` | stock delay per Vt per arc, the cells by family, the custom-cell constraints: `library_analysis.rpt`, `library_analysis.json` | a few s |
| Qualib | `qualib list --arcs FILE [--json]` or `--cells A,B` | stock arc facts per Vt | < 1 s |
| Qualib | `qualib screen --cells DIR [--out DIR] [--json]` | the screen of a cell folder: `cell_screen.rpt`, `screen.json` | a few s; `--json` alone instant |
| AndesCell | `andescell generate --arcs FILE --round K --iterations 50 --scale 0.9 --dry-run` | what a generation of these arcs would give | < 1 s |
| Pack | `python3 <campaign>/flow/andes_cli.py draft <campaign> <kind> [<tool json>]` | a delivery skeleton filled from the tool's own output | < 1 s |
| Pack | `python3 <campaign>/flow/andes_cli.py precheck <campaign> <kind> <file>` | the Reader's own check of a delivery | a few s |
| XTop | `xtop -version` | timing ECO; installed, not part of this flow | — |

An arc file is any JSON with `arcs: [{cell, from, to, edge}]` (a what-if `whatif.json` with its
`merged` list works too). `-help` on any tool prints its options. The Campaign workspace is
read-only for you. The build this round starts from is `<campaign>/<timingState.buildDir>`;
AndesCell's cells of this round are in `<campaign>/<generation.dir>`. Write your own tool outputs
under your private workspace (`--out ./hw`, `--out ./ql`) and keep the reports you deliver in
`reports/<your step>/r<k>/` there.

## What the round results mean

- `timingGainPct`: this round's custom-cell build against the reference build at route, as a share
  of the clock period. TNS and violating paths usually move more than the worst slack: the custom
  cells speed up many paths a little, while the worst path is dominated by an SRAM access no cell
  changes.
- The all-group worst slack may sit on an input or output path group (reg2out); custom cells inside
  the core do not move it. Say so rather than calling it a regression.
- The placement stage (place_opt) moves too, but the result is the route timing.
- `lessons.json` lists every round's counts (asked, planned, generated, kept, screened, built) and
  result at route.
