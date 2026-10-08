# LibInsight resident custom analysis 0.1 Fabric record

## Files written

`contract.yml`, `graph.yml` (`hima-flow/1`, four tasks) and `schemas/tasks.json` follow the ATCS
0.4 resident shape: TASK_INPUT/TASK_OUTPUT program tasks, `runInput`/`committedOutput`/`artifactRef`
bindings, one outsourced tool with `artifactPrefix: analysis` producing the Reader-backed output
`analysisResult`. `flow/libinsight_cli.py` routes the program ABI and the resident self-check to
`flow/libinsight_analysis/` (`request.py` prepare, `delivery.py` the one delivery contract,
`library.py` admission, `tasks.py` the business tasks). `tools/read-analysis.py` is the shipped-alone
Reader; it imports the Campaign's deployed `flow/libinsight_analysis`, as the ATCS Reader does.
All Pack Python runs on Python 3.6 through 3.12.

## Gaps

No Host change was needed. The Reader cannot return its problems through the Host's rejection
message (the Host reports only the Reader Job's exit), so it also writes them to
`state/analysis-result.problems.txt`, which the resident reads read-only. Live QuaLib and facts mode
are both verified on linglong in the sandbox image shape; neither has yet run under a real model in a
product Run (slice R4).

Source bounds: Pack tools run on the Site and cannot read the Host-side Permit, so the Site binds
`sourceReadRoots` (the Permit's `allowedReadRoots` joined with `:`; kept in step by hand, see the
Site README). prepare-request refuses a source outside it whatever the sandbox kind, records it as
`readRoots`, and the Reader refuses an additional delivered source outside it.

Licence claim (review M8): `custom-analysis` holds `QuaLib-2026-new-59099: 1` even for a facts-only
analysis, which serialises facts-only runs on the Site. Pack `licences` are a static per-tool map
(`packs.ts` packTool), so the claim cannot depend on the request's mode, and the resident may decide
mid-task that it needs live QuaLib. Keeping one seat per resident analysis is the honest bound; a
facts-only tool without the claim would need a second outsourced tool and a choice node, which this
small Pack does not take on.

## Reviews

Pack Python suites cover the real SAED14 delivery and every Reader rejection, prepare-request
hashing/catalog/licence refusals, idempotent and conflicting admission, deliver, the Reader script
and the CLI. The L2 Host test drives the full graph through the real resident wrapper with an ACP
stand-in. See TEST.md.

## 0.2.0 insight rules

`flow/libinsight_analysis/rules/` holds four example rules (stdlib, Python 3.6+), each `run(...) -> dict` in
the shape of `knowledge/insight-rule-shape.md`. `insight_delivery.py` (`libinsight_cli.py insight-delivery`)
runs one rule, or a rule module the resident writes under `analysis/`, and writes the complete delivery with
the rule as its optional `insight` block, every facts file hashed before and after, the code that ran and the
candidate; `delivery.py` checks the block with `insight_page.check_rule`. `page/insight-page.html` is the fixed
template; the Host fills it from the Reader-accepted bytes (ADR-0021, 2026-10-08 note). No new task, Reader
value or rule: the graph is unchanged.
