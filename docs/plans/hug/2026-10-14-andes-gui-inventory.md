# AndesCell GUI port onto HUG-DBOS — inventory and plan

Read-only investigation, 2026-10-14. Base facts:

- Fork point `git merge-base main demo/andes-openc910` = `9c3a39c1`. HUG-DBOS contains main
  (`merge-base HUG-DBOS main` = `5d2ea5bd` = main tip). Demo diff over `packages/`: 53 files, +5365/−502.
- `demo:` = `demo/andes-openc910`; `hug:` = `HUG-DBOS` (worktree `.hima-tmp/worktrees/hug-dbos`).
- **HUG-DBOS has no `packs/andes-cell-fmax`.** It is a *legacy* graph Pack (no `schema: hima-flow/1`;
  forks, autopilot segments, `revisit` edge `next-round -> load-timing`, demo `graph.yml:210`). On DBOS it
  runs through `compileLegacyFlow` (`hug:flow-compiler.ts:309`): a revisit becomes a `repeat` block
  (`:426`), so every task carries `iterations[]` — the round source `team-view.ts` already uses.
  Whether 0.4.0 *executes* end to end on DBOS (outsourced fork branches, explore chooser) is not a GUI
  question; the GUI port can be proven on fixture `RunView`s first.
- Note: `.hima-tmp/worktrees/hug-port/` already held `packs/andes-cell-fmax` and `sites/eda_cluster_ctu_01`
  (someone is staging there). It is not a git worktree; `git worktree add` will refuse it while non-empty.

## 1. File-by-file inventory

Port class: **a** new standalone file, ports as-is · **b** needs rewiring to DBOS data (source named) ·
**c** obsolete / superseded on HUG-DBOS · **d** demo-only hack, drop.
Demo: **S** AndesCell strip · **R** Reports tab / Results · **C** hima_chart · **L** LibInsight (QuaLib
Insight) · **Lo** locale · **G** generic polish · **N** owner-chat notices/autopilot.

### Host (`packages/harness/src/`)

| File | Change | Demo | Class | DBOS-side source / note |
|---|---|---|---|---|
| `strip-layout.ts` (new, 529) | `stripFacts` (round = `run.generation`, transitions from `GenerationView.nodes`), `stripState` (station/line/edge state, lit edges), `layoutStrip` SVG placement, `wrapWords`, fold >4 done lines | S | **c** (fold logic into team-view) | State semantics move into `teamViewState` (`hug:team-view.ts:102`), which already reads `DurableTaskView.projection/iterations`. Keep only: graph-derived edges (`demo:strip-layout.ts:169-188`), `row`/`span`, fold rule (`STRIP_FOLD_OVER`, `:215,:347`). SVG placement is not needed: TeamCanvas lays out HTML boxes. |
| `packs.ts` (+98) | `nodeWords` label/about on act/judge/explore/wait + segment autopilot; `packResults`, `packReports` on contract; strip `packView` (stations+row+checklist, `hidden`) on `graph.yml`; `validateView` | S,R | **b** | HUG already has `packView` (`hug:packs.ts:1059-1074`, loaded from `view.yml` at `:1962-1963`, validated at `:2045-2059`). Port: `nodeWords` (display only), `results`, `reports` onto `packContract` (`hug:packs.ts:721`; `flowPackContract` extends it at `:806`), and **merge** strip fields into the one `packView` (see §2). Do not re-add `graph.yml view:` — `view.yml` is the single declaration. |
| `run-reports.ts` (new, 300) | `RunReports` (list/read/listFresh/readChart, 5 s TTL cache), bounded `find`/`head -c` over `<ws>/<dir>/<node>/r<k>/<file>`, permit-checked | R,C | **b** | Replace `existingRun(ledger)` (`demo:run-reports.ts:95,191,269`) with `createDurableViewReaders(...).readRun` (`hug:durable-views.ts:44`); replace `workspaceOf(ledger)` (`:198,:276`) with `readRunRecords(runId,'workspace')` (`hug:durable-views.ts:50`, which synthesizes the workspace record from the `preparation` flow fact; `prepared.file.workspace`, cf. `hug:durable-fabric.ts:67-73`); replace `loadRunPack(packsDir, packId, packDigest)` (`:131`) with `executionContext(runId).method` (`contract.reports.dir`, `reference` for node order; reader at `hug:durable-views.ts:327`). Deps become `{ readers, sitesDir }`, not `{ ledger, packsDir }`. Drop `listFresh` (only the deleted autopilot used it). |
| `chart-files.ts` (new, 91) | `hima_chart` host side: run chart via `RunReports.readChart`, Pack chart from `knowledge/charts/*.chart.json`, `packChartPattern` | C | **a** (after run-reports rewire) | Only depends on `RunReports`, `loadPack`, errors. |
| `charts.ts` (new, 72) | `hima-chart/1` zod schema (bar/metrics), answer/source types | C | **a** | Shared host/client. |
| `engineering-activity.ts` (new, 71) | per-Ledger in-memory activity of resident nodes from `state.json.activity` | S | **c** | Superseded by `hug:resident-activity.ts` (`noteResidentActivity`, fed at `hug:task-effects.ts:398`) → `DurableTaskView.activity` (`hug:record-views.ts:521`). |
| `remote.ts` (+78) | `RunView.engineeringActivity`; `RunReportFile/RunReportsView/RunReportText`; `runReports/runReport` ops; route `/runs/<id>/reports(/file)` (`runReportsOperation`) | S,R | **b** (types+route) / **c** (activity) | Keep types + route; replace `ops.ledger.run(runId)` with `hasRun(ops, runId)` (`hug:remote.ts:999`). Drop `engineeringActivity` (use `tasks[].activity`). Insert route before the run read, beside `/runs/<id>/assets` (`hug:remote.ts:1820`). |
| `index.ts` (+116) | `RunReports` instance; ops wiring; exports; Pack-chart inventory line in `himaRuntimeContext`; role prompts (chip-designer style, hima_chart use, fork begin-all); `postStatus` running-status lines; plain `NOTICE_PREFIX` headlines; referenceGraph labels | R,C,N | **b** (reports/chart/exports/inventory) / **c** (status/notices/autopilot `reportFiles`) | Construct `RunReports` from `this.viewReaders()` (`hug:index.ts:963`); wire `runReports/runReport` next to `readRunAssets/readTaskArtifact` (`hug:index.ts:725-726`). Prompt lines: keep "show charts with hima_chart" and the chip-designer reply style (generic), drop "begin outsourced nodes"/autopilot status wording (DBOS starts resident tasks itself). Labels in `referenceGraph`: now at `hug:index.ts:1671` and `hug:fabric.ts:190` (optional, G). |
| `tools.ts` (+31) | `hima_chart` tool; `himaTools(..., reports?)` param | C | **b** | Pass the Host's `RunReports`; access check `assertProjectAccess` exists (`hug:tools.ts:37`). |
| `errors.ts` (+27) | `ReportPathError`; `EngineeringDeliveryRejectedError` | R / G | **a** / **c** | `ReportPathError` ports as-is. `EngineeringDeliveryRejectedError` belonged to the pre-DBOS `fabric.ts` delivery path (commit `da9c859f`); not GUI — leave out. |
| `channel.ts` (+14) | admit `find <root> -mindepth 3 -maxdepth 3 -type f -print0` and `head -c N -- /abs` | R | **a** (re-apply hunk) | HUG changed `admit` (`ps` probe); re-apply by hand, not by patch. |
| `paths.ts` (+2) | `runReportsPath`, `runReportFilePath` | R | **a** | |
| `engineering-executor.ts` (+21) | `activity` in state schema; `delivery.artifactPrefix` in plan; typed rejection errors | S,G | **c** / not-GUI | `activity: z.json()` already on HUG (`hug:engineering-executor.ts:65`). `artifactPrefix` hand-off needs the Site wrapper change in `sites/linglong-atcs28/templates/` too — separate resident slice if AndesCell agents need it. |
| `autopilot.ts` (+151) | hand-back headlines, `nextStepPhrase`, `finishedNodeCharts`/`chartInstruction`, segment status lines | N,C | **c** | File deleted on main; DBOS drives tasks. A "charts just appeared" nudge could later hang off task completion, not here. |
| `fabric.ts` (+183) | `NOTICE_PREFIX`, `nodeDisplayName`, `runNodeName`, `noticeValue`, `statusValues`, `segmentStatusLine`, `executionNotice` | N | **c** | Pre-DBOS notify path (`hug:fabric.ts` is 892 lines of shims). `nodeDisplayName` (label ?? id) is trivial to re-home in `team-view.ts`/`card-labels.ts` if needed. |
| `node-turns.ts` (+7), `interactive-runtime.ts` (+5), `recovery.ts` (+5) | `notify(..., headline)`, `status` dep, headline call sites | N | **c** | Emptied on main. |
| `canvas-layout.ts` (+208), `scene.ts` (+176), `node-card-layout.ts` (+15) | full canvas: merged autopilot-segment steps with checklist, AI node mark/ring, fork lanes over spine, wide pitch; node card tabs for AI nodes | S,G | **c** for view-Packs / optional **b** | AndesCell gets the station view instead. AI marks from `contract.tools[].outsourcing` are generic and could feed `sceneInputs` (`hug:scene.ts`, which now reads `view.tasks` via `taskStateForNode`, `hug:card-labels.ts:1537`) — defer. |
| `workbench.ts` (+2) | `PreparationView.referenceGraph.nodes[].label` | G | **b** optional | Type now lives with the preparation code; HUG `workbench.ts` is 218 lines. |

### Client (`packages/harness/src/client/`)

| File | Change | Demo | Class | DBOS-side source / note |
|---|---|---|---|---|
| `StripCanvas.tsx` (new, 156) | SVG strip; TopLine "Round k · best · target"; AI activity line from `engineeringActivity` | S | **c** | `TeamCanvas.tsx` (`hug:TeamCanvas.tsx:135`) is the one station renderer. Port only TopLine's *best/target* idea as a metric (§2). |
| `ReportsView.tsx` (new, 168) | Reports tab: grouped by round → station → node, open text in place; `useRunReports(runId, currentNode, enabled)` 10 s poll | R | **a** + small **b** | `groupReports` reads `graph.view.stations[].checklist` — extend for `team[].node`. Poll key `view.run.currentNode` is unset for DBOS runs; key on a digest of `view.tasks` states (e.g. count of `projection.state==='succeeded'`) instead. |
| `results-view.ts` (new, 110) | before/after table + `bestHeadline` from `contract.results` over `view.observations` | R,S | **a** (verify) | DBOS observation records carry `generation = iteration+1` (`hug:durable-task-adapters.ts:191`) and reach `RunView.observations` via `readRunView` (`hug:durable-views.ts:149-155`). `view.generations` is likely empty on DBOS; `resultsRounds` already falls back to observation generations. Add a fixture test on a DBOS-shaped view. |
| `view-news.ts` (new, 27) | per-viewer unseen counts for Reports/Results tabs | R | **a** | |
| `run-auto-open.ts` (new, 63) | open the workspace once when a fresh start receipt appears | G | **a** + **b** | Receipt tool list (`hima_run`, `hima_execute`, `hima_context`) must match HUG's start tools; status check uses DBOS `RunHeadView.status`. |
| `HimaChartCard.tsx` (new, 137), `chart-geometry.ts` (new, 191) | chat card for `hima_chart` (bar + metrics table) | C | **a** | Registered in `client/index.ts`. |
| `engineering-activity.ts` (new, 43) | `activityPhrase` (drops bare tool names), `aiWorking`, kind keys | S | **c** | `TeamCanvas` `LiveLine`/`KIND_SAID` (`hug:TeamCanvas.tsx:51,62`) + `shortPaths`. Fold `BARE_TOOL_WORDS` into `LiveLine` (one helper). |
| `CampaignTab.tsx` (+213) | `sectionsFor(contract)`: Results replaces Generations, Reports replaces Report; `ResultsSection`; Reports tab; news badges; StripCanvas branch; i18n | R,S,Lo | **b** | HUG: `SECTIONS` (`hug:CampaignTab.tsx:43-44`), TeamCanvas branch on `methodReference?.view` (`:281-282`), `context.method.contract/reference` exist (`hug:fabric.ts:569`). Port `sectionsFor`/`ResultsSection`/Reports wiring; no StripCanvas branch. |
| `FabricCanvas.tsx` (+237), `FabricNode.tsx` (+145), `NodeCard.tsx` (+147) | merged-step/AI-node canvas pieces, exports reused by StripCanvas (`AiRing`, `CheckMark`, `CurrentRing`), labels | S,G,Lo | **c** / optional **b** | Not needed once StripCanvas is dropped. HUG versions changed (DBOS task states); do not overwrite. |
| `HimaRunCard.tsx` (+182) | compact follow-up receipts, node label via `fetchExecutionContext`, auto-open, i18n | G,Lo | **b** | HUG changed it +91 (TaskSection, task artifacts `:405-459`, respond). Re-apply by hand; DBOS heads have no `currentNode` → name the running task (`view.tasks` running/waiting) instead. |
| `HimaWorkbench.tsx` (+22) | i18n, `key={selected}` on CampaignTab, secondary buttons, InsightView props for library analysis | Lo,G,L | **b** (key/buttons) / **c** (Insight props) | Conflicts with LibInsight 0.2 wiring (`hug:HimaWorkbench.tsx:229,242`). |
| `Masthead.tsx` (+51) | node labels (fork branches), budget word, pack title, i18n | G,Lo | **b** | Fork branches → running tasks from `view.tasks`; labels from `context.method.reference.nodes[].label`. |
| `InsightView.tsx` (+239), `library-analysis.ts` (new, 163) | "Analyse a library folder" section starting a Campaign from the Insight tab | L | **c** | Superseded by LibInsight 0.2 on HUG (§4). |
| `LibraryInsightPanel.tsx` (+43) | i18n only | Lo | **c**/Lo | Ports with the locale slice if wanted. |
| `locale/index.ts` (new, 94), `locale/dictionaries.ts` (new, 866) | zh/en dictionaries, `useHimaT`, `installHimaLocale` | Lo | **a** + **b** | Hard `inject` of `locale` in `client/index.ts`; make it soft (`ctx.get?.('locale')`) unless the HUG App shell is confirmed to provide it. Keys for strip/results/reports/campaign/insight must be re-cut against HUG's surfaces. |
| `index.ts` (client, +32) | register `HimaChartCard` for `hima_chart`; locale install; "project" wording | C,Lo,d | **a** (card) / Lo / **d** | HUG added `InsightAnalysisCard` + `runStatusSaid` here; merge by hand. |
| `api.ts` (+15) | `fetchRunReports`, `fetchRunReport` | R | **a** | |
| `workbench-style.ts` (+171) | CSS: strip, results table, reports list, chart card, compact receipt, secondary buttons, Analyse | S,R,C,G | **b** | Take `.hima-results*`, `.hima-reports*`, `.hima-chart*`, `.hima-view-count/dot`, `.hima-run-card-compact`; drop `.hima-strip*`, `.hima-insight-analyse*`. |
| `ConfigurationPage.tsx` (+83), `Diagnostics.tsx` (+8), `PackOwnerPanel.tsx` (+30), `CampaignChip.tsx` (+10), `TeamPanel.tsx` (+4), `WorkMemoryPanel.tsx` (+4) | i18n; "Campaign" → "project" wording | Lo,d | Lo / **d** | "project" wording was a customer-demo choice (`5ecf524e`); drop unless the product definition adopts it. |
| `glyphs.tsx` (+9) | `sparkle` glyph | S | **c** | TeamCanvas draws its own `Spark`. |
| `packages/desktop/package.json` | `0.3.0-trial.34 → .37` | — | **d** | |

## 2. Station model: strip vs team, and the unified schema

### Schema diff

| Field | Strip (`demo:packs.ts` `packView`, in `graph.yml view:`) | Team (`hug:packs.ts:1059-1074`, `view.yml`) |
|---|---|---|
| file | `graph.yml` key `view` | `view.yml` beside `graph.yml` |
| `title` | — | optional ≤80 |
| `stations` | 2..6 | 1..8 |
| station `id/label/about` | label ≤40, about ≤240 | label ≤48, about ≤240 |
| station `row` | **required** int 0..5, ≤2 per row | — (single column) |
| `checklist[]` | required, 1..12; item label ≤40, `rounds` default `all` | default `[]`, ≤12; item label ≤64, `rounds` optional |
| `team[]` | — | optional ≤8 `{node, label ≤32, role?}` |
| checklist XOR team | n/a | not enforced (needs one of them, `:2051`) |
| `hidden` | node ids drawn nowhere; validation demands every graph node be placed or hidden | — (unplaced nodes allowed) |
| `edges` | none — derived from graph edges crossing stations; `down`/`back` from row order; lit by "entered this visit" | declared `{from,to,label?,back?}` ≤16 |
| `metrics` | none (TopLine reads `contract.results.headline` best + Goal) | ≤4 `{label,node,path,unit?,goal?,better?}` from a task's committed output |
| validation | `validateView` in `validatePack` (nodes exist, each once, coverage, ≤2/row) | `validatePack` `:2045-2059` (nodes exist, station ids unique, edges name stations, metric node exists) |

### Per-station state

| Aspect | Strip (`demo:strip-layout.ts`) | Team (`hug:team-view.ts`) |
|---|---|---|
| round | `run.generation` (`:87`) — pre-DBOS Ledger generations | `max(task.iterations.at(-1).iteration)+1` over current root-flow tasks (`:106-108`) — DBOS-native |
| node state in round | latest `node` transition of that generation (`:119-122`); done ⇔ `done`/`reconciled` | invocation of that round for repeated tasks, else latest; started outranks pending (`:112-118`); `succeeded→done`, `running/waiting→active`, `failed→failed` (`:80-87`) |
| "current" | open fork branches' `currentNode`, else `run.currentNode` (`:94-99`) | any task `running`/`waiting` — parallel branches fall out naturally |
| line | hidden / done (all nodes completed) / active (one current) / pending | same plus `failed` (`:129-135`) |
| station | active (any member current) / done (all shown lines done) / waiting | active (not ended) / failed / done / waiting; members count too (`:145-149`) |
| AI | act node whose tool declares `outsourcing` (`:125-126`) | identical rule (`:125-126`) |
| live activity | `RunView.engineeringActivity[node]` (Ledger-keyed memory) | `task.activity` (`ResidentActivity`) on the active AI task (`:140,:155`) |
| summary/delivered | — | `engineering.summary` of the round's output; delivered count (`:97-100,:119`) |
| lit edges | edge into a node of the active station's current visit from a node completed this round (`:153-176`) | target station active and source station has done work this round (`:159-164`) |
| ended Run | current = [] | `ended` flag suppresses active/lit/activity |

Conclusion: team-view's state machine is the DBOS-correct one; nothing from `stripFacts` survives.
The strip contributes **layout declarations** (`row`, `hidden`, derived edges, fold) and a
**Reader-sourced metric**.

### Unified `view.yml` (owner: `packs.ts` `packView` + `validatePack`; state: `team-view.ts`)

```yaml
title: AndesCell Fmax rounds            # optional
stations:
  - id: rtl2gds
    label: RTL2GDS flow
    about: ...
    row: 0                              # NEW optional; stations sharing a row sit side by side (≤2)
    checklist:                          # a station has checklist XOR team (enforce)
      - { label: Reference build, nodes: [reference-build], rounds: first }
  - id: himatime
    label: HimaTime agent
    row: 1
    checklist: [ ... ]
  - id: reviews
    label: Consumer review team
    team: [ { node: review-wat, label: WAT test, role: parametric test } ]
hidden: [blocked]                       # NEW optional; when present, every graph node must be placed or hidden
edges:                                  # optional; ABSENT => derived from graph edges crossing stations
  - { from: decide, to: engineer, label: requests, back: true }
metrics:                                # either a task output OR a Reader semantic value
  - { label: best, reader: andes-round, type: timing_gain_pct, unit: "%", digits: 2,
      pick: best, better: higher, goal: target_timing_gain_pct }
  - { label: best, node: decide-round, path: [best, metrics, drops, count], unit: dropped, goal: target_dropped_count, better: lower }
```

Changes, all in existing modules:

- `hug:packs.ts:1059-1074`: add `row?: int 0..7`, `hidden: packId[] default []`, metric union
  (`node`+`path` | `reader`+`type`) plus `digits?`, `pick?: latest|best`; make `edges` optional
  (undefined ⇒ derive). Keep MAGE's limits (label ≤48, ≤8 stations). Do **not** accept `view:` in
  `graph.yml` (strict `packGraph` keeps rejecting it from YAML; `loadPackFrom` injects from `view.yml`).
- `validatePack` (`hug:packs.ts:2045`): checklist XOR team; ≤2 stations per `row`; each node in at most
  one place; coverage only when `hidden` is declared (MAGE leaves nodes unplaced); metric `reader`
  must be a contract reader; `edges[].back` with `row` present must agree with row order (or derive).
- `team-view.ts`: carry `row`/`col`/`span` onto `TeamStation`; derive edges from
  `graph.edges` when `declared.edges` is undefined (port `demo:strip-layout.ts:169-188`; `back` when
  target row ≤ source row); `TeamLine.folds` for >4 shown lines with a leading done run; Reader
  metrics from `view.observations` (port `bestHeadline` math from `demo:results-view.ts:89-104`).
  Signature grows `view: Pick<RunView,'run'|'tasks'|'observations'>`; `graph: Pick<PackGraph,'nodes'|'edges'>`.
- `TeamCanvas.tsx`: render rows as a 2-column CSS grid (`span` 2 for a lone station); `edgePath`
  (`:124`) needs an elbow when boxes do not overlap horizontally (fork: 1 → 2, join: 2 → 1), and
  back edges on the left gutter when the source is a left column; render folded lines.
- AndesCell Pack: move `graph.yml view:` (demo `:215-252`) to `packs/andes-cell-fmax/view.yml`,
  add `metrics` (Reader-sourced best + target), keep `hidden: [blocked]`. Its node/segment
  `label/about` require the `nodeWords` schema port (or strip them from `graph.yml`).

## 3. Reports tab, run-reports, `contract.reports.dir`, hima_chart

Pre-DBOS data path (demo):

1. Pack declares `reports: { dir: reports }` (AndesCell `contract.yml:304`); tools/agents write
   `<workspace>/reports/<node>/r<k>/<file>`.
2. `RunReports.list(runId)`: `existingRun(ledger)` → `loadRunPack(packsDir, packId, packDigest)` for
   `dir` and node order → `workspaceOf(ledger)` (Ledger `workspace` record) → `loadSite` →
   `decideRead` workspace + reports root (must resolve inside) → `find -mindepth 3 -maxdepth 3 -type f
   -print0` → `wc -c` in byte-bounded batches → newest round first, ≤500 entries, 5 s TTL cache.
3. `read(runId, path)`: same resolution, `reportPathPattern`, `head -c 262144 -- <abs>`, text only.
4. Route `GET /hima/api/runs/<id>/reports(/file?path=)` → `fetchRunReports/fetchRunReport` →
   `ReportsView` (grouped round → station → node, last entry = Run report) inside CampaignTab.
5. `hima_chart` tool → `chartRequestOf` → `readChartAnswer`: run chart through `RunReports.readChart`
   (path must match `chartPathPattern`), or Pack chart `knowledge/charts/*.chart.json` from
   `loadPack`; validated by `himaChart` (`charts.ts`); card `HimaChartCard` draws it. The owner
   learnt chart paths from autopilot hand-backs (`finishedNodeCharts`) — gone on DBOS.

What HUG-DBOS already has (no tool-reports listing):

- `GET /hima/api/runs/<id>/assets` (`hug:remote.ts:1820-1854`): run archive (`readRunAssets`,
  `hug:durable-views.ts:237`), `?material=` archived material, `?effect=&artifact=` **task artifact**
  (`readTaskArtifact`, wired `hug:index.ts:726`), `?artifact=&execution=&delivery=` engineering asset.
- `TaskResult.artifacts[]` (`hug:task-contract.ts:61-64`: `{runId,taskId,effectId,name,path,sha256,mediaType?}`)
  shown per task in `TaskSection` → `TaskArtifactMaterial` (`hug:HimaRunCard.tsx:405-459`).

DBOS-side equivalent and recommendation:

- Keep the Site listing (`run-reports.ts`) — AndesCell tools write reports that are **not** declared
  task artifacts (legacy-compiled tasks return `artifacts: []`), and the listing is display-only.
  Rewire its three lookups to the durable readers (table §1). `RunReportsDeps` becomes
  `{ readers: Pick<ReturnType<typeof createDurableViewReaders>,'readRun'|'readRunRecords'|'executionContext'>, sitesDir }`.
- Results face needs no new API: `view.observations` with `generation` exists on DBOS.
- Later (not this port): let ReportsView also list `view.tasks[].result.artifacts` (opened through the
  existing `/assets?effect=&artifact=` route) so hima-flow/1 Packs that declare artifacts need no
  `reports.dir`. That is the DBOS-native long-term path; `contract.reports.dir` stays the bridge.
- hima_chart: run charts then work for any Run whose `reports.dir` is declared; without hand-backs,
  the owner finds chart paths via the Reports listing — expose it to the agent cheaply by adding
  the newest round's `*.chart.json` paths to `hima_context`'s facts (optional, tools.ts owner).

## 4. Conflicts with LibInsight 0.2 on HUG-DBOS

- `InsightView.tsx`: demo adds `pickFolder/openRun/onRunStarted` props and `LibraryAnalysisSection`
  (start a library-analysis Campaign from the tab, poll, open its `hima-library-insight-report/1`).
  HUG's 0.2 takes `onShowLibInsight` (`hug:InsightView.tsx` diff, "Back to LibInsight pages") and the
  analysis flow moved to the conversation: `hima_insight_analysis` → `InsightAnalysisCard`
  (`hug:client/InsightAnalysisCard.tsx`), host `hug:libinsight-analyses.ts` (Pack `libinsight-analysis`,
  Site `linglong-libinsight`), viewer `LibInsightAppPanel` (`hug:HimaWorkbench.tsx:229,242`). Same
  surface, two designs → **do not port** `library-analysis.ts`/`LibraryAnalysisSection`.
- `library-analysis.ts` discovers Packs by input `libInsightRoot`; HUG's Pack `libinsight-analysis` uses
  `analysisRequests`/`analysisRequest` (`libInsightAnalysisDefaults`). Incompatible keys.
- `LibraryInsightPanel.tsx`: i18n-only diff; ports cleanly only with the locale slice (no logic clash).
- `HimaWorkbench.tsx`: the demo hunk at its InsightView call (`pickFolder/openRun/onRunStarted`)
  collides with HUG's line 229; take only `key={selected}` and button-class hunks.
- `client/index.ts`: HUG registers `InsightAnalysisCard`; demo registers `HimaChartCard` and changes the
  sidebar description to "Project and QuaLib Insight" — keep HUG's text, add the chart card.
- No other file in the demo diff touches `library-insight-*`, `libinsight-*`, or `InsightAnalysisCard`.

## 5. Slice order and ownership (≤3 implementers in parallel)

Single-owner wiring files: `index.ts`, `remote.ts`, `tools.ts`, `client/api.ts` → all owned by **B**.
Other hot files: `packs.ts` → **A** only; `CampaignTab.tsx`, `client/index.ts`, `workbench-style.ts` →
**C** only. Locale (touches ~15 client files) runs **after** A–C.

**A0 (A, first, small, ~half a day; unblocks B and C)** — `packs.ts` schema only: unified `packView`
(§2), `nodeWords` label/about on nodes and segments, `packResults`, `packReports`; `validatePack` rules;
`test/contract/team-view.test.ts` schema cases + pack-load tests. Commit, push; B and C rebase on it.

Then in parallel:

- **A — Station view** (owns `team-view.ts`, `client/TeamCanvas.tsx`, `packs/andes-cell-fmax/**`,
  `packs/mage-scribe-placement/view.yml`, `test/contract/team-view.test.ts`, new
  `test/contract/team-canvas*.test.ts`): rows/span, derived edges, fold, Reader metrics, ended/lit
  rules; TeamCanvas grid + elbow edges; fold `BARE_TOOL_WORDS` into `LiveLine`; port the useful
  `strip-layout.test.ts` cases (line/station/lit semantics) re-expressed over `DurableTaskView`
  fixtures with `iterations`; AndesCell `view.yml`; MAGE view regression unchanged.
- **B — Reports + charts host** (owns `run-reports.ts`, `chart-files.ts`, `charts.ts`, `errors.ts`,
  `channel.ts`, `paths.ts`, **`remote.ts`, `index.ts`, `tools.ts`, `client/api.ts`**, tests
  `run-reports.host.test.ts`, `hima-chart.host.test.ts`): rewire to durable readers (§3), route +
  ops + exports, `hima_chart` tool, Pack-chart inventory line and the two prompt sentences in
  `index.ts`, `fetchRunReports/fetchRunReport`. Land `remote.ts` types + `api.ts` fetchers as the
  first commit so C can import them.
- **C — Client faces** (owns `client/ReportsView.tsx`, `client/results-view.ts`, `client/view-news.ts`,
  `client/HimaChartCard.tsx`, `client/chart-geometry.ts`, `client/CampaignTab.tsx`,
  `client/index.ts`, `client/workbench-style.ts`, tests `chart-geometry.test.ts`, results-view /
  view tests): `sectionsFor` (Results replaces Generations; Reports replaces Report), ResultsSection,
  Reports tab with DBOS poll key, news badges, HimaChartCard registration, CSS subset. Starts on
  pure modules (`results-view`, `chart-geometry`, `view-news`, `groupReports`) while B lands
  `api.ts`; touches no file of A or B.

After A–C merge:

- **D — Generic polish** (one implementer): `HimaRunCard.tsx` compact receipts + `run-auto-open.ts`,
  `Masthead.tsx` labels (task-based "where"), `HimaWorkbench.tsx` `key={selected}`; optional AI marks
  in `scene.ts`/`canvas-layout.ts` for packs without a view.
- **E — Locale** (one implementer, last): `locale/*` with re-cut keys, soft `locale` injection,
  `useHimaT` across client files; LibraryInsightPanel/LibInsight 0.2 surfaces get keys in this pass.
- **Drop**: `strip-layout.ts`, `StripCanvas.tsx`, both `engineering-activity.ts`, `autopilot.ts`/
  `fabric.ts`/`node-turns.ts`/`interactive-runtime.ts`/`recovery.ts` notice hunks, `postStatus`,
  `library-analysis.ts` + InsightView analysis section, "project" wording, desktop version bump,
  `glyphs.tsx` sparkle.

Verification per slice (fast-convergence): A/C contract tests on fixture `RunView`s (round 1, fork
active, round 2 with `rounds: first` hidden, ended Run); B host tests with a local Site fixture and a
DBOS-shaped run (workspace from the `preparation` fact); one desktop pass on a MAGE Run (regression)
and an AndesCell fixture Run after A+C.
