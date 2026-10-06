# LibInsight resident custom analysis 0.1 test record

## Site

Development Pack, not released. Real verification used linglong (`luzi@192.168.50.41`) under
`/data/eda/project/hima_harness/libinsight-runs/dev/claude-r1-20261005` on 2026-10-05: facts mode
with `/usr/bin/python3` 3.12.3 on the host and `python3` 3.6.8 inside the edarunner image with the
resident sandbox's mount shape; live QuaLib inside the same image, once in licence mode `old` (null
handle, exit 3) and, after the user's switch, in mode `new` (45 cells, tables equal to the facts,
delivery accepted by the Reader). Host integration used a private local Site with the unchanged resident wrapper, sandbox
`none` and an ACP stand-in.

## Run

No sealed release Run yet. The L2 Host test (`test/contract/libinsight-resident-durable.host.test.ts`)
starts a test Run through the public `startRun` with the per-Run `analysisRequest` override.

## Ending

The L2 Run ends `ended-goal-met` with the analysis admitted; the repair case first receives a
Reader rejection in the same resident task.

## Generations

One generation; no Explore node.

## Code

`python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'`.

## Refusals

Reader rejections, prepare-request refusals (missing/symlinked/unknown sources, outside sandbox
roots, unknown buildsOn, live QuaLib in XTop licence mode) and conflicting admissions are covered
by the Pack suites.

## Disagreements

None recorded.
