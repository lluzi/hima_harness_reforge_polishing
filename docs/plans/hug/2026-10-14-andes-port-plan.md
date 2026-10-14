# HUG-DBOS: AndesCell port and one station view

Date 2026-10-14. Branch `HUG-DBOS` (worktree `.hima-tmp/worktrees/hug-dbos`). Evidence:
[GUI inventory](2026-10-14-andes-gui-inventory.md) and [Pack on DBOS](2026-10-14-andes-pack-on-dbos.md).

## User outcome

For HUG, ATCS, LibInsight, MAGE, AndesCell DTCO (mock EDA data) and later PixelPack all run on one
DBOS App build and look alike:

- **One station view.** A Pack declares `view.yml`. A station holds either a checklist or a team.
  Packs without a view keep the live node graph.
- **Results and Reports tabs.** AndesCell's Reports and Results tabs work for any Pack that declares them.
- **Chart cards.** The Campaign agent can show `hima_chart` cards in chat.

Out of scope: analog, Cell-Fmax sky130, the live tool view (xpra is GPL).

## Current behaviour (evidence)

- HUG-DBOS has MAGE's team view: `packs.ts` `packView`, read from `view.yml`. Its state logic is
  `team-view.ts` `teamViewState`, which reads DBOS `DurableTaskView` projections, iterations and activity.
  It is drawn by `client/TeamCanvas.tsx`.
- The AndesCell GUI is on pre-DBOS `demo/andes-openc910`: 53 files, +5.4k lines. Its strip state logic
  reads Ledger generations and the deleted autopilot. Its Reports listing (`run-reports.ts`) and
  `hima_chart` read the Ledger.
- The AndesCell Pack does not load on HUG-DBOS. Three things fail: `contract.reports/results` keys, node
  and segment `label/about`, and an inline `view:` with `row/hidden`. Once those load, it compiles to
  legacy IR: 22 tasks, 2 parallel blocks, 1 repeat. The parallel resident tasks really do overlap
  (`flow-workflow.ts` parallel). The Readers' workspace-path asserts hold under `hima-task-effect/2`.

## Slices

Each slice gets its own branch off `HUG-DBOS` and its own worktree `.hima-tmp/worktrees/hug-<slice>`.
The integrator (main session) merges each slice into `HUG-DBOS`, runs the combined tests and pushes.
Workers commit and push their own branch. They never touch `HUG-DBOS` directly, and never touch a file
outside their ownership list.

### A0. Pack format (first; unblocks everything). Opus 4.8 medium.

**Owns:** `packages/harness/src/packs.ts`, `test/contract/team-view.test.ts` (schema cases only),
and a new `test/contract/pack-view-schema.test.ts`.

The schema change goes into `packs.ts`. Port the demo shapes from `demo/andes-openc910`'s `packs.ts`.

- **Display fields on nodes and segments.** `packNode` act/judge/explore/wait and `segmentAutopilot`
  accept optional `label` (≤48) and `about` (≤240). They are display only.
- **`packContract` gets optional `results` and `reports`.** Same shapes as the demo
  (`demo:packs.ts` `packResults`, `packReports`), and `flowPackContract` inherits them.
- **`packView` grows:**
  - station `row?: int 0..7`;
  - top-level `hidden?: nodeId[]` (default `[]`);
  - `edges` becomes optional, where *undefined* means "derive from the graph" (`[]` stays "no edges");
  - each metric is either `{node, path}` (today) or `{reader, type}` (a Reader semantic value), plus
    `digits?` and `pick?: latest|best`.
- **`validatePack`:**
  - a station has a checklist XOR a team;
  - at most 2 stations share a `row`;
  - a node is placed at most once;
  - when `hidden` is declared, every graph node must be placed or hidden;
  - a metric `reader` must name a contract reader;
  - a metric `type` must be one that reader declares.
- `graph.yml` still refuses an inline `view:`. `view.yml` is the only declaration.
- **Preserve:** the MAGE `view.yml` loads unchanged, and every existing Pack loads unchanged
  (`node scripts/run-contract-tests.mjs local --files test/contract/team-view.test.ts` plus a load loop
  over `packs/*`).
- **Tests:**
  - pass cases: the MAGE view; a strip-style view with rows, hidden and derived edges; a Reader metric;
  - refusal cases: checklist+team, 3 stations in one row, a node placed twice, an unplaced node when
    `hidden` is declared, a metric naming an unknown reader or type.

### A. Station view. Opus 4.8 medium. After A0.

**Owns:** `team-view.ts`, `client/TeamCanvas.tsx`, `packs/mage-scribe-placement/view.yml` (only if
needed), `test/contract/team-view.test.ts`, new `test/contract/team-canvas.test.ts`.

**State and layout (`team-view.ts`):**
- `teamViewState` keeps its state rules.
- It adds `row/col/span` per station.
- It derives edges from `graph.edges` crossing stations when `edges` is undefined. `back` applies when
  the target row ≤ the source row (port `demo:strip-layout.ts:169-188`).
- It folds runs of more than 4 shown lines that start with done ones (`TeamLine.folds`).
- It computes Reader metrics from `view.observations`, porting `bestHeadline` from `demo:results-view.ts:89-104`.
- Signature: `view: Pick<RunView,'run'|'tasks'|'observations'>`.

**Drawing (`TeamCanvas.tsx`):**
- Rows go in a 2-column grid. A lone station in its row spans both columns.
- Edges between boxes that don't overlap horizontally get an elbow (fork 1→2, join 2→1).
- Back edges route through the left gutter.
- Folded lines render collapsed.
- Fold the demo's `BARE_TOOL_WORDS` filter into `LiveLine`.

**Tests:** port the meaningful cases from `demo:test/contract/strip-layout.test.ts`, re-expressed over
`DurableTaskView` fixtures with `iterations`:
- round 1 with the fork active (both branches active);
- round 2 with `rounds: first` lines hidden;
- a failed task;
- an ended Run.

MAGE regression: `team-view.test.ts` passes unchanged.

### B. Reports and charts on the Host. Opus 4.8 medium. After A0.

**Owns:** `run-reports.ts`, `chart-files.ts`, `charts.ts`, `errors.ts` (`ReportPathError` only),
`channel.ts`, `paths.ts`, and the single-owner wiring files `remote.ts`, `index.ts`, `tools.ts`,
`client/api.ts`. Tests: new `test/contract/run-reports.host.test.ts` and `hima-chart.host.test.ts`.

**First commit** (so C can build on it): the `remote.ts` types `RunReportFile/RunReportsView/RunReportText`
and the `client/api.ts` calls `fetchRunReports/fetchRunReport`.

**Port `run-reports.ts`** with three lookups replaced:
- `existingRun(ledger)` → durable `readRun`;
- `workspaceOf(ledger)` → `readRunRecords(runId,'workspace')`;
- `loadRunPack` → `executionContext(runId).method`.

Deps become `{ readers, sitesDir }`. Drop `listFresh`.

**Route:** `/hima/api/runs/<id>/reports(/file?path=)` goes beside `/assets` (`remote.ts` ~1820) and
uses `hasRun`. Re-apply the `channel.ts` `find`/`head -c` admissions by hand.

**`hima_chart`:**
- The tool goes in `tools.ts`; the Host gives it its `RunReports`.
- `index.ts` gets the Pack-chart inventory line and two prompt sentences: "show charts with
  hima_chart", and the chip-designer reply style (HUG-DBOS already has the latter; don't duplicate).
- `hima_context` facts list the newest round's `*.chart.json` paths. These replace the autopilot
  hand-back.

**Drop:** every autopilot, notice and headline hunk.

**Tests (Host):**
- a DBOS-shaped Run whose workspace comes from the `preparation` fact, on a local Site fixture;
- list and read work;
- a path outside the reports dir is refused;
- a chart file validates;
- an invalid chart is refused with its reason;
- a Pack chart is read from `knowledge/charts`.

### C. Client faces. Sonnet 5 medium. Starts after B's first commit.

**Owns:** `client/ReportsView.tsx`, `client/results-view.ts`, `client/view-news.ts`,
`client/HimaChartCard.tsx`, `client/chart-geometry.ts`, `client/CampaignTab.tsx`, `client/index.ts`,
`client/workbench-style.ts`. Tests: `chart-geometry`, `results-view` and `groupReports` unit or
contract tests.

**Sections and tabs:**
- `sectionsFor(contract)`: Results replaces Generations when `contract.results` is declared. Reports
  replaces Report when `contract.reports` is declared.
- `groupReports` also groups `team[].node`.
- The Reports poll is keyed on a digest of `view.tasks` states, not `run.currentNode`.
- News badges.

**Charts:** register `HimaChartCard` for `hima_chart` beside HUG's `InsightAnalysisCard`.

**CSS:** take the `.hima-results*`, `.hima-reports*`, `.hima-chart*`, `.hima-view-count/dot` and
`.hima-run-card-compact` rules. Drop `.hima-strip*` and `.hima-insight-analyse*`.

**Do not port:** `StripCanvas`, `library-analysis.ts`, or InsightView's analysis section (LibInsight 0.2 supersedes it).

### P. AndesCell Pack, Site and DBOS dry route. Opus 4.8 medium. After A0.

**Owns:** `packs/andes-cell-fmax/**`, `sites/eda_cluster_ctu_01/**`, new
`test/contract/andes-cell-fmax-durable.host.test.ts`, `test/contract/support/andes-resident-durable-worker.ts`,
`test/fixtures/andes-resident-dry/**`, and the `test/contract-groups.json` entry (`atcs-dry` group).

**Pack and Site:**
- Copy them from `demo/andes-openc910`.
- Move `graph.yml view:` to `view.yml` (rows, `hidden: [blocked]`, derived edges). Add a Reader
  `best` metric with the Goal target.
- Keep `contract.results/reports` (A0 accepts them).

**Dry route,** modelled on `mage-scribe-placement-durable.host.test.ts` and its worker and
`test/fixtures/mage-resident-dry`:
- **Real parts:** the Host, Postgres and the Site's mock-EDA CLIs (`CTU_MOCK_TIME_SCALE=0`).
- **Synthetic parts:** a `CTU_OPENC910_DATA` bundle, a `none`-sandbox test capability, and an ACP
  stand-in for the five resident roles that drafts each delivery from `andes_cli.py draft` output.
- **Proof:**
  - both forks' tasks start before their join;
  - one round meets the +1 % Goal;
  - `readerJobs == engineeringJobs`;
  - `productModelCalls == 0`;
  - the workspace-path asserts in `read-requirements.py`, `read-plan.py` and `read-verify.py` pass.

**Site on Linglong.**
- Point the Site at the HUG wrapper folder, deployed 2026-10-14 at
  `/data/eda/project/hima_harness/operator-admin/resident-engineering-ctu01-hug/`. It holds the HUG-DBOS
  template (sha256 prefix `02a46760`, the same as MAGE's) and `engineering-capabilities-ctu01.json`.
- In `site.yml`, set `engineeringCapabilities` to that folder. In `permit.yml`, update `allowedReadRoots`
  and `allowedWrappers` to it.
- The old `resident-engineering-ctu01/` stays for the pre-DBOS App.
- **Known gap.** The demo wrapper also passed the Host artifact prefix to the agent and captured its
  reply (`da9c859f`); the HUG template has neither. MAGE meets its Goal without them. Check AndesCell
  agents in the live rehearsal before porting either.

**Never commit real data.**
- `knowledge/design-notes.md` and `mock-eda/share/designs/openc910/**` stay git-ignored.
- Run `git diff --cached | grep -E -i '<foundry prefixes>'` before every commit; the integrator gives the pattern.

### D. Generic polish. Sonnet 5 medium. After A, B, C.

**Scope:**
- `HimaRunCard.tsx`: compact follow-up receipts.
- `run-auto-open.ts`, with the receipt tool list checked against HUG's start tools.
- `Masthead.tsx`: "where" names the running tasks from `view.tasks`, with labels from `method.reference.nodes[].label`.
- `HimaWorkbench.tsx`: `key={selected}` and the secondary button classes.

### E. Chinese UI (locale). Dropped (user, 2026-10-14): HUG uses the English UI.

The demo's zh/en dictionaries (`client/locale/*`, 960 lines), with keys re-cut against HUG surfaces
and the `locale` injection made soft.

## Order and parallelism

A0 → {A, B, P} in parallel (three workers) → C (once B's first commit lands) → D.

Then:
- an Opus 5.5 high review of the whole branch;
- one desktop pass: a MAGE Run as regression, plus an AndesCell fixture Run.

**Live AndesCell Run on the CTU Site.** Before it, deploy the current wrapper template from
`sites/linglong-atcs28/templates/resident-engineering-wrapper.py` to
`operator-admin/resident-engineering-ctu01/` on Linglong. The user approved this server write on 2026-10-14.

## Rollback

`HUG-DBOS` before this plan is `f12af213`. Each slice lands as one merge commit, so it can be reverted alone.
