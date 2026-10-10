## Files written

- `contract.yml` (0.3.0, `reports: { dir: reports }`, default Goal +1 %), `graph.yml` (with the
  strip `view`; `generationLimit: 2`), `semantics.yml`; `flow/andes_cli.py` (every tool step, the
  requirements, plan and verify validators, `merged`, `precheck`, the chart builders);
  `flow/knowledge_charts.py` (writes `knowledge/charts/*.chart.json` from the Site's tools);
  `tools/read-{reference,timing,requirements,plan,verify,round}.py` with `readers/*.yml`;
  `rules/*.yml` (eight); `choosers/andes-next.yml`; `knowledge/*.md` (seven) and
  `knowledge/charts/` (three charts).
- Outside the Pack: `sites/eda_cluster_ctu_01/` (Site, Permit, capability, mock toolchain and its
  tests) and `test/contract/andes-cell-fmax*.ts`.

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
- **Choose**: the owner begins `andescell-agent`, starts its task, collects, releases, completes.
- **Verify**: the segment from `generate-cells` runs AndesCell for the plan's families and stops
  when `generate-cells` opens the verify fork; the owner drives `himatime-verify` and
  `qualib-screen` as in the propose fork. The join `cells-verified` judges both branches by one rule
  set: the `andes-verify` Reader states the same tool numbers on either branch (HimaTime's local
  gain, Qualib's pass count), so neither branch lacks a value its rules need.

`exploreAfter` still holds: after either join the path reaches `next-round` only through
`read-round-goal` (a fresh unbranched reading) and `judge-round` (its own two-rule judge).

### Reports

Pack tools copy their tool's human-readable reports to `reports/<node id>/r<k>/`: `bind-inputs`
(`tools.rpt`), `reference-build` and `new-library-build` (`report_qor.rpt`, `postroute_timing.rpt`,
`area.rpt`, `route_drc.rpt`; the rebuild adds `himatime report`'s `report_timing.rpt`),
`load-timing` (`report_timing.rpt`, `stage_breakdown.rpt`), `generate-cells` (`generation.rpt`),
`compare-round` (`round-<k>.md`, which states the claim boundary in plain words). Each step also
writes a `hima-chart/1` chart beside its reports (SPEC.md, Charts); the proposal, local-gain and
screen charts come from the Reader that accepts the agent's delivery, from the tools' own answer,
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

- The mock is a calibrated path model, not a timer: one design, one corner, one clock.
- The cell targets in requirements are recorded (met / not met) but do not change the cells.
- The local gain uses every new cell of the round, extra-fast variants included, because HimaTime
  verifies while Qualib screens; the rebuild then uses only the cells the screen passes.
- A Qualib agent that fails every cell the screen passes still passes the join (the rule reads the
  tool's pass count); the rebuild then places no new cell and `cells-used` fails the round.
- Pack 0.2 and 0.3 are not yet smoke-tested on linglong.
- The proposal, local-gain and screen charts are written by Readers (a Reader's only other side
  effect is its OUT file). A Reader that cannot write its chart still accepts the delivery and says
  so on stderr; the chart is then missing from Reports.
- The design model of 0.3 (a ~2 GHz block, 0.500 ns): reference Fmax 1951.60 MHz (WNS −12.4 ps);
  round 1 with XNOR3 and BUF reaches 1980.98 MHz (+1.51 %). HimaTime's estimated recovery ranks
  XNOR3 and BUF first, while `himatime estimate` gives other pairs more (XNOR3+XOR2 +1.67 %): the
  AndesCell agent follows the recovery ranking, and either pair meets the +1 % Goal.

## Reviews

- Pack load, stage, strip, semantics and knowledge charts: `test/contract/andes-cell-fmax.test.ts`
  (9 tests), including a refused strip and the mock toolchain unit suite (13 tests).
- Host dry path (`andes-dry` group, 2026-10-10, ~27 s, Pack 0.3): propose fork, AndesCell agent,
  generate, verify fork and rebuild through the stand-in, one round to goal-met (+1.51 %, local
  gain 16.88 ps), a refused requirements list and a refused local-gain number each repaired in the
  same task, a report and a chart from every step at `reports/<node>/r1/`.
- Site smoke on linglong (2026-10-10): every CLI and one reference build plus one round, timings above.
