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

## Reviews

Pack Python suites cover the real SAED14 delivery and every Reader rejection, prepare-request
hashing/catalog/licence refusals, idempotent and conflicting admission, deliver, the Reader script
and the CLI. The L2 Host test drives the full graph through the real resident wrapper with an ACP
stand-in. See TEST.md.
