## Files written

- `contract.yml` (0.4.0, `reports: { dir: reports }`, Goal `target_timing_gain_pct` default +1 %),
  `graph.yml` (with the strip `view`; `generationLimit: 2`), `semantics.yml`; `flow/andes_cli.py`
  (every tool step, the requirements, plan and verify validators against the tools, `draft`,
  `precheck`, the chart builders); `flow/knowledge_charts.py` (writes the generated knowledge,
  `knowledge/design-notes.md` from `knowledge/design-notes.template.md` and `knowledge/charts/`,
  from the Site's tools; both git-ignored); `tools/read-{reference,timing,requirements,plan,verify,round}.py`
  with `readers/*.yml`; `rules/*.yml` (eight); `choosers/andes-next.yml`; `knowledge/*.md` (six
  tracked, plus the template).
- Outside the Pack: `sites/eda_cluster_ctu_01/` (Site, Permit, capability, the toolchain with its
  openc910 replay mode and tests) and `test/contract/andes-cell-fmax*.ts`.

### Installing the Pack on a Site (0.4)

The generated knowledge is the Site's: before the Pack is used (or packaged), run
`python3 packs/andes-cell-fmax/flow/knowledge_charts.py <EDA_ROOT>` where the Site's tools read the
installed openc910 data (or `CTU_OPENC910_DATA` points at it). It writes `knowledge/design-notes.md`
and `knowledge/charts/*.chart.json`; without them `checkPack` refuses the Pack. The Site's bindings
for 0.4: `designRoot` = the Site's `share/designs/openc910`, `stockLibrary` = a label (`n7-ulvt`).

### How the agents deliver (0.4)

Each agent runs its tools (HimaTime `highvalue`/`whatif`/`verify`, Qualib `analyze`/`screen`,
AndesCell `--dry-run`) and drafts its delivery with `andes_cli.py draft <campaign> <kind> <tool
json>`: the arcs, cells, constraints, plan and check numbers come from the tool's own JSON; the agent
writes the summary, the plan's reason and its analysis, may leave items out, and prechecks. The
Readers re-ask the tools (`himatime whatif --json`, `qualib analyze --json`, `himatime verify
--json`, `qualib screen --json` on the kept cells) and refuse what disagrees.

### Site

`eda_cluster_ctu_01` (ssh to linglong; `workspaceRoot` `/data/eda/project/hima_harness/ctu-runs`,
`parallelJobs: 3`), toolchain `/data/eda/project/hima_harness/ctu01-eda`, resident capability
`operator-admin/resident-engineering-ctu01/engineering-capabilities-ctu01.json`.

### How the agents run (0.2)

Two forks and one single resident step a round, none of them an autopilot fork, because the
autopilot does not drive resident tasks:

- **Propose**: the fork at `read-timing` has two outsourced act nodes as branches. The first
  segment stops when `read-timing` opens it; the owner begins `himatime-agent` and `qualib-agent`,
  starts a resident task on each (two wrapper Jobs, inside the Site's three slots), collects each
  delivery (its Reader runs on that branch), releases and completes each node in any order. The
  last completion closes the fork; the segment from `requirements-joined` judges each branch's
  reading and stops at `andescell-agent`.
- **Plan**: the owner begins `andescell-agent`, starts its task, collects, releases, completes.
- **Verify**: the segment from `generate-cells` runs AndesCell for the plan's arcs and stops
  when `generate-cells` opens the verify fork; the owner drives `himatime-verify` and
  `qualib-screen` as in the propose fork. The join `cells-verified` judges both branches by one rule
  set: the `andes-verify` Reader states the same tool numbers on either branch (HimaTime's kept
  cells, Qualib's pass count of the kept cells), so neither branch lacks a value its rules need.

`exploreAfter` still holds: after either join the path reaches `next-round` only through
`read-round-goal` (a fresh unbranched reading) and `judge-round` (its own two-rule judge).

### Reports

Pack tools copy their tool's human-readable reports to `reports/<node id>/r<k>/`: `bind-inputs`
(`tools.rpt`), `reference-build` and `new-library-build` (every report of the build: the stage
summaries, reg2reg timing, power, congestion, clock tree, `flow_summary.rpt`; the rebuild adds
`himatime report`'s `report_timing.rpt`), `load-timing` (`report_timing.rpt`, `stage_breakdown.rpt`,
`high_value_cells.rpt`), `generate-cells` (`generation.rpt`), `compare-round` (`round-<k>.md`, which
states the claim boundary in plain words and that the timing is at the end of route). Each step also
writes a `hima-chart/1` chart beside its reports (SPEC.md, Charts); the proposal, funnel, cell-check,
top-cells and screen charts come from the Reader that accepts the agent's delivery, from the tools' own answer,
so an agent never types a chart's numbers. A resident agent's
`artifactPrefix` is `reports/<its node id>`: it keeps its `analysis.md` and the tool reports it used
in `reports/<node id>/r<k>/` of its private workspace and delivers them as support, which the Host
materializes at the same path in the Campaign workspace. No copy step and no second location.

### Smoke on the Site (2026-10-10, time scale 1, Pack 0.1)

Pack 0.1 (Pack tools for screen and verify). Not repeated for 0.2: the deployment is the main
agent's.

Toolchain deployed to `/data/eda/project/hima_harness/ctu01-eda`; wrapper copy (template
`fb4739c2`) and capability (`b8e76e1d`) in `operator-admin/resident-engineering-ctu01/`. Every CLI
answers `-version`. One reference build and one round with hand-written requirements in
`ctu-runs/smoke-20261010/` (log `smoke.log`), host python3 3.12:

| step | time |
| --- | --- |
| bind-inputs | 0.4 s |
| reference-build (sapr) | 80.1 s |
| load-timing (himatime load) | 12.2 s |
| requirements check, each | 0.1 s |
| generate-cells (andescell, 2 families, 6 cells) | 29.2 s |
| screen-cells (qualib) | 7.9 s |
| verify-cells (himatime) | 15.7 s |
| new-library-build (sapr) | 84.2 s |
| compare-round | 0.1 s |

Round 1 (XNOR3+BUF requested by HimaTime, XNOR3+XOR2 by Qualib): AndesCell picked XNOR3 and BUF,
4 of 6 cells passed the screen, Fmax 957.67 → 981.64 MHz (+2.50 %; the 1 GHz calibration of 0.1,
replaced in 0.3 by the 2 GHz one), 474 new-cell instances. In the
podman sandbox image (`c8e8a7a4…`, python3 3.12, toolchain read-only, CTU_MOCK_TIME_SCALE 0.25):
`himatime load` 3.1 s, `qualib analyze` 2.3 s, `himatime report/estimate`, `andescell --dry-run`
and the Pack precheck instant.

## Gaps

- The Site replays one design's data: one reference build and one custom-cell set. A round whose
  rebuild uses another cell set is refused by the Site (the build fails, the round is invalid); one
  round is the data's round.
- The custom build's CTS and route timing follow the Site's stated basis (`basis` in its sapr
  summary, carried into the round record and the claim boundary, never shown on screen).
- The chart of the first kept cells shows five cells (three rows each): a metrics table holds at
  most 16 rows, and a table of two or more columns shows a change column, which has no meaning
  between different measures.
- Pack 0.2–0.4 are not yet smoke-tested on linglong; 0.4 needs the openc910 data and the generated
  knowledge installed on the Site, and the Site bindings above.
- The proposal, funnel, cell-check, top-cells and screen charts are written by Readers (a Reader's
  only other side effect is its OUT file). A Reader that cannot write its chart still accepts the
  delivery and says so on stderr; the chart is then missing from Reports.

## Reviews

- Pack load, stage, strip, semantics, generated knowledge and one round of the Pack's steps on the
  fixture: `test/contract/andes-cell-fmax.test.ts` (10 tests, 2026-10-11, Pack 0.4.0).
- Host dry path (`andes-dry` group, 2026-10-11, ~23 s, Pack 0.4.0, fixture bundle): propose fork,
  AndesCell agent, generate, verify fork and rebuild through the stand-in, one round to goal-met, a
  refused Qualib list and a refused kept count each repaired in the same task, a report and the
  charts from every step at `reports/<node>/r1/`.
- Real data (by hand, 2026-10-11): the Pack's steps and `knowledge_charts.py` on the installed
  openc910 data reproduce the data owner's numbers at route; generated files not committed.
- Site smoke on linglong (2026-10-10): Pack 0.1, every CLI and one reference build plus one round.
