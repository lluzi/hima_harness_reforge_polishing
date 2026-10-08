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

## 0.2.0 insight rules (2026-10-08)

- **Code.** `python3 -m unittest discover -s packs/libinsight-analysis/flow/tests -p 'test_*.py'` (76 tests:
  the four example rules on synthetic facts with planted findings and the four corrections, `insight_page`
  shape check and fill, `insight-delivery` end to end). Template functions (score, action files, brief):
  `node --test packages/harness/src/libinsight-insight-template.test.ts`. Host composition and page links:
  `test/contract/libinsight-analyses.test.ts`.
- **Site dry run.** All four rules ran through `insight-delivery` in the resident image (Python 3.6.8) on
  linglong over the Site's TSMC28 facts and the AES28 report and netlist, and each delivery was accepted by
  the delivery check. One defect found there (the Vmin command line exceeded 2000 characters with one
  `--netlist` per file) was fixed by netlist globs.
- **Packaged App.** trial.47 internal candidates, kits `kit-li-06..08` (git-ignored `.hima-tmp/`): in one
  Guide conversation, four plain-English questions were each recognised as their rule, proposed, confirmed in
  chat, run by the resident on linglong, admitted, and shown on the three-column page through the reply's
  link; the final page holds all four rules and their score; the demo closed on the Vmin redesign brief. In
  the final run the resident adapted `table_spikes_kinks` on the fly (`--module`), and the Guide audited two
  deliveries against the agreed question. Numbers and screenshots stay in `.hima-tmp/` (real data, not in Git).
- **Open.** The catalogue does not list each rule's settable parameters, so the Guide proposed settings the
  rules do not take (threshold, equivalence definition); the gaps list stops at its widest 12 items; spike
  items carry no per-point evidence.
