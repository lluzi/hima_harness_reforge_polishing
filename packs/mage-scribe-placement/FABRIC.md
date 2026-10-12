# MAGE scribe-line placement 0.1.0 Fabric record

## Files written

`contract.yml`, `graph.yml`, and `schemas/tasks.json` declare one `hima-flow/1` sequence containing
one `repeat`, with explicit Run/Goal/strategy/committed-output bindings. `flow/mage_placement_cli.py`
routes program-task ABI commands (`task-<name>`) and resident-facing subcommands (`snapshot`,
`lane-view`, `plan-slots`, `evaluate`, `mage-round`, `candidate`, `review`, the two batch fallbacks,
`flow-digest`) into `flow/mage_placement/` — `core`, `pla`, `rules`, `targets`, `lanes`, `snapshot`,
`planner`, `metrics`, `consumers`, `records`, `rounds`, `tasks`, and `native/session`+`native/tcl`.
`tools/read-mage.py` backs both `readers/*.yml` declarations with one fail-closed script, imported
from the Campaign's own copy of `flow/` (`workspace.source: pack`), the same shape as the ATCS
Pack's `read-atcs.py`. Four `flow/templates/*.tcl` files are this Pack's entire verified MAGE
command surface. `flow/consumer_models/{litho-pie,metrology,alignment,wat,bonding}.{yml,json}` are
customer-neutral requirement templates; `bonding` ships `enabled: false` and is never run in 0.1.0.
`knowledge/` carries four shared playbooks and six role briefs (`role-bonding.md` for a later
version only); this Task (8) wrote their content and the four Pack documents.

## Gaps

No model, no commercial EDA, and no GUI were used to produce anything in this repository. Every
MAGE round in `flow/tests/` runs against `flow/tests/standin_mage.py`, a stand-in interpreter that
reproduces the four templates' own control flow (open, replay, verify, export) without a licensed
binary — it proves the driver's wiring (one-writer enforcement, round-exists refusal, session-log
tagging), not MAGE's own effectiveness or the D-status commands' real behaviour. Every schema-
validated document (`placement-candidate`, `consumer-review`, `round-decision`, `placement-result`,
and the four record kinds) has an admitted example fixture, a schema validator, and at least one
Reader negative (tampered PLA, untagged mutation, unanswered Request, fabricated review number,
wrong snapshot binding) under `flow/tests/`. No customer data exists in this repository; every
fixture is synthetic. `knowledge/mage-capabilities.md` separates the V-status templates (actually
run, here and on the real Oct-12 build replaying `pre_place_all.pla`) from the D-status commands
(documented in the vendor manual, never run against a real design in this session).

The Host-level **L2 dry route** is Task 10's work and now passes:
`test/contract/support/mage-resident-durable-worker.ts` plus
`test/contract/mage-scribe-placement-durable.host.test.ts` (registered under
`test/contract-groups.json`'s `atcs-dry` group) boot the real Host in-process, with the stand-in
ACP residents (`test/fixtures/mage-resident-dry/{prepare.py,acp.py}`) standing in only for the
licensed MAGE binary and the native engineering/review agents, and run the whole `repeat` of
engineer-place -> four review-* -> decide-round to completion for both a converging
(`goalMet: true`, 2 rounds, 16 task executions) and a stalled/conflicting (`goalMet: false`, 4
rounds, 28 executions, 1 Decision Request) round sequence, with zero model calls. Getting there
surfaced and fixed two real Pack/Harness integration gaps the Pack-local single-workspace test
could not catch — a session-log delivery path outside the Engineer's own `artifactPrefix` (fixed
in `89c17979`) and `decisionRequests` silently dropped from `decide-round`'s committed output
(fixed in `b6f40829`) — plus a Site capacity correction (`parallelJobs: 2`, not 1: each resident
task's retained Job holds its slot until collecting its own result launches a second, concurrent
Reader Job). Full detail is in `packs/mage-scribe-placement/TEST.md`'s L2 section and
`.superpowers/sdd/task-10-report.md`.

The machine-local offline evaluation of the real P23 package (Task 11, run by the planning session
outside this repository) is separate from this Fabric record and is not claimed here.

## Reviews

Per-task review is recorded in `.superpowers/sdd/task-8-report.md` and the planner's own per-task
review notes (Opus 4.8, `model-policy.md`). The final whole-branch review (Task 12, Opus 5.5 high)
has not run yet.
