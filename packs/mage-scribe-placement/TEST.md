# MAGE scribe-line placement 0.1.0 test record

## L1 — Pack-local unittest on synthetic fixtures

`cd packs/mage-scribe-placement/flow && /usr/bin/python3 -m unittest discover -s tests -v`

148 tests pass as of this Task (2026-10-12), covering: PLA parsing in µm and DBU with drops and
round-trip writing (`test_pla.py`); rule facts (`test_rules.py`); target binding and TB/LR/IN
partition (`test_targets.py`); snapshot round trip and sha (`test_snapshot.py`); the exact slot
planner against a brute-force oracle (`test_planner.py`); metrics against hand-computed values
(`test_metrics.py`); the consumer evaluator's `unknown` behaviour on missing parameters
(`test_consumers.py`); record/schema validation (`test_schemas.py`, `test_records.py`); the
decide-round best-state order and stop rule (`test_rounds.py`); the stand-in MAGE session driver,
one-writer enforcement, and round-exists refusal (`test_native_session.py`); the two Readers'
negatives — tampered PLA, untagged mutation, unanswered Request, fabricated review number, wrong
snapshot binding (`test_readers.py`); the end-to-end two-round CLI route exercising every program
task and every resident subcommand in sequence (`test_cli_tasks.py`); and this Task's own
`flow/tests/test_knowledge.py` (every `contract.yml`-named knowledge file exists, is flat-named, has
no placeholder text, and each resident's own knowledge set stays under 12,000 words; every CLI
subcommand/flag a playbook names is real; every `state/...` path a playbook names is a declared
output or a documented support-path pattern).

## L0/L2 — Host contract test

`pnpm run build && pnpm run test:local -- --files test/contract/mage-scribe-placement.test.ts`

`test/contract/mage-scribe-placement.test.ts` (registered in `test/contract-groups.json`'s `local`
group) checks `loadPack`'s structure — the entry sequence, the one `repeat` block with its
`carry`/`stop`/`maxIterations`, the five resident tools with their `outsourcing` blocks and
licences, the Goal/strategy knobs, the absence of `agentTeams`/Workshops — and `checkPack` against a
synthetic local Site declaring `licences: {mage: 1}`, confirming Reader argv and emitted facts line
up with the rules' own `requires`.

## L2 dry route — not yet run

The Host durable dry route (`test/contract/mage-scribe-placement-durable.host.test.ts` plus stand-in
ACP residents under `test/fixtures/mage-resident-dry/`, `sandbox.kind: none, testOnly: true`,
registered as `test/contract-groups.json`'s `mage-dry` group) is **Task 10's** work. **This
sentence will be replaced by Task 10's own result** — whether the repeat ran its expected number of
rounds, every Reader admitted, and both scripted scenarios (converge by round 2 with `route: stop`;
a consumer conflict producing a Decision Request with `goalMet` false) committed through evaluation
and delivery — once that route passes.

## L1 machine-local — not run from this repository

The real P23 package evaluation (start/incumbent snapshot reproduction, the 225/225 target binding,
60-beyond-100µm and 19-drop counts, the two-slot V-lane planner result) is Task 11's work, run by
the planning session under
`/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/pack-eval/`,
outside this repository. No customer data and no result from that evaluation appear here.

## L4 (S2) — native qualification

Not started. Needs a user-opened MAGE licence window and Site `linglong-mage` work agreed with the
user (capability JSON, licence-mode guard, display, case copy) before any D-status command in
`knowledge/mage-capabilities.md` can move from documented to qualified.

## No model, no EDA

Every test above runs with `/usr/bin/python3` 3.9.6 against synthetic fixtures and (for native-round
behaviour) `flow/tests/standin_mage.py`. No DeepSeek/OpenCode session, no licensed MAGE binary, and
no GUI ran anything recorded in this document.
