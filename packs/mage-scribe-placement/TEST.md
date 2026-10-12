# MAGE scribe-line placement 0.2.0 test record

## L1 — Pack-local unittest on synthetic fixtures

`/usr/bin/python3 -m unittest discover -s flow/tests -t flow` (run from the Pack root)

174 tests pass as of Task 13 (2026-10-12), covering: PLA parsing in µm and DBU with drops and
round-trip writing (`test_pla.py`); rule facts (`test_rules.py`); target binding and TB/LR/IN
partition (`test_targets.py`); snapshot round trip and sha (`test_snapshot.py`); the exact slot
planner against a brute-force oracle (`test_planner.py`); metrics against hand-computed values
(`test_metrics.py`); the consumer evaluator's `unknown` behaviour on missing parameters
(`test_consumers.py`); record/schema validation (`test_schemas.py`, `test_records.py`); the
decide-round best-state order and stop rule (`test_rounds.py`); the stand-in MAGE session driver,
one-writer enforcement, round-exists refusal, the fill stage (manifest converge lines) and Engineer
`--experiment` (byte-copy, sha256, `exit`/`frbOpen` refusal, consumer refusal), the three native
checks sliced from stdout markers, and completion judged by the `MAGE_ROUND_END` marker rather than
the vendor launcher's unconditional exit 0 (`test_native_session.py`); the two Readers'
negatives — tampered PLA, untagged mutation, unanswered Request, fabricated review number, wrong
snapshot binding (`test_readers.py`); the end-to-end two-round CLI route exercising every program
task and every resident subcommand in sequence, plus the `--fill`/`--experiment` route and the
blocked-outcome path (`test_cli_tasks.py`); and this Task's own
`flow/tests/test_knowledge.py` (every `contract.yml`-named knowledge file exists, is flat-named, has
no placeholder text, and each resident's own knowledge set stays under 12,000 words; every CLI
subcommand/flag a playbook names is real; every `state/...` path a playbook names is a declared
output or a documented support-path pattern).

The native route under test is the Site's proven one: exactly three native checks — `OVERLAP`
(`frbCheckOverlap`), `SPACE` (`frbCheckSpace`), `BOUNDARY` (`frbCheckBoundary`) — each report
sliced from MAGE's own `MAGE_VERIFY_*` stdout markers and counted by the `instances=<N>` header a
SPACE row being one offending instance, not a pair. The old ten-way `smVerify -checkType` family is
D-status only (unqualified) and this Pack no longer runs it.

## L0/L2 — Host contract test

`pnpm run build && pnpm run test:local -- --files test/contract/mage-scribe-placement.test.ts`

`test/contract/mage-scribe-placement.test.ts` (registered in `test/contract-groups.json`'s `local`
group) checks `loadPack`'s structure — the entry sequence, the one `repeat` block with its
`carry`/`stop`/`maxIterations`, the five resident tools with their `outsourcing` blocks and
licences, the Goal/strategy knobs, the absence of `agentTeams`/Workshops — and `checkPack` against a
synthetic local Site declaring `licences: {mage: 1}`, confirming Reader argv and emitted facts line
up with the rules' own `requires`.

## L2 dry route — passes on the real Host

`export HIMA_POSTGRES_RUNTIME=.../.hima-tmp/dbos-migration/u2/runtime-final CI=true
PATH="$HOME/.local/node24/bin:$PATH"; pnpm run build && node scripts/run-contract-tests.mjs
atcs-dry --files test/contract/mage-scribe-placement-durable.host.test.ts`

Task 10 built `test/fixtures/mage-resident-dry/{prepare.py,acp.py}` (an ACP v1 stand-in Engineer
and the four stand-in consumers, driving the real, deployed `mage_placement_cli.py` through the
exact `snapshot`/`mage-round`/`candidate` and `evaluate`/`review` sequences
`flow/tests/test_cli_tasks.py` already proves) and `test/contract/support/mage-resident-durable-
worker.ts` / `test/contract/mage-scribe-placement-durable.host.test.ts` (registered under
`test/contract-groups.json`'s `atcs-dry` group), booting the real Host in-process against a
genuine private-resident-workspace-vs-Campaign-workspace layout (never the Pack-local test's
single shared workspace): `sandbox.kind: none, testOnly: true`, `HIMA_RESIDENT_TESTING=1`, the real
`sites/linglong-atcs28/templates/resident-engineering-wrapper.py`, the real
`tools/read-mage.py`/`readers/*.yml` Readers, zero model calls, zero commercial EDA.

Both scripted scenarios ran their full round sequence and committed through evaluation and
delivery:

- **converge** (`run-5f02ee49...`): round 1 continues (`openRequestCount: 2`), round 2 stops —
  `"no consumer hard failure and no open request"`. 16 task executions (`2 + 2×6 + 2`), 10
  `engineering-*` Jobs and 10 `reader-mage-*` Jobs launched (one of each per resident task
  execution), `productModelCalls: 0`, `goalState: "met"`, `deliver.value.goalMet === true`, all
  seven delivery rules PASS, `openRequests: 0`.
- **conflict** (`run-8653bd2f...`): KEY_V never gets placed; WAT keeps filing a `place` Request on
  it, litho-pie's own hard fail clears in round 2 (a genuine improvement) then it files a `keep`
  Request on the very same target from round 2 on — a real cross-consumer conflict every round
  after. Round 2 continues (improved), round 3 continues (no change from round 2, not improved
  alone), round 4 stops — `"no improvement for two consecutive rounds"` (round 3 and round 4 both
  not improved). 28 task executions (`2 + 4×6 + 2`), 20 `engineering-*` and 20 `reader-mage-*` Jobs,
  `productModelCalls: 0`, `goalState: "not-met"`, `goalMet: false`, `drops-within-goal` is the one
  FAILing rule (every other rule PASSes), `openRequests: 2`, `decisionRequests: 1`. This is the
  Pack's own proven `decide()` math for this exact request/ledger shape (matching
  `flow/tests/test_cli_tasks.py:test_no_improvement_for_two_rounds_stops_with_a_decision_request`'s
  4-round result), not the 3-round/22-execution number this section originally predicted before
  anyone had actually run it.

Getting here surfaced two real integration gaps the Pack-local single-workspace test could not
have caught, both now fixed:

1. **Session-log delivery path** (fixed in `89c17979`): `mage-round`/`candidate` now write/record
   the MAGE session log at `placement/round-NN/session.jsonl` (inside the Engineer's own
   `artifactPrefix`) instead of a cumulative `state/session.jsonl` the resident delivery mechanism
   could never actually publish into the Campaign workspace — the `placement-candidate` Reader
   failed every round with `mage_candidate_error_count: 1` until this landed. (This Pack change
   also needed `chmod +x` on the stand-in ACP/`prepare.py` scripts — the wrapper execs
   `native.executable` directly, and without the bit the ACP process never started, with no
   diagnostic beyond the task sitting `"waiting"` forever.)
2. **`decisionRequests` dropped from the committed decide-round output** (fixed in `b6f40829`):
   `task-decide-round`'s own `TASK_OUTPUT` value carried `decisionRequestCount` (a number) but not
   the actual `decisionRequests` list; `evaluate_placement` reads `decision.get("decisionRequests",
   [])` from that same committed value (never the on-disk `state/round-decision.json`), so it
   always silently defaulted to empty — the delivered report never carried a real Decision Request
   even when one was genuinely open. `test_cli_tasks.py`'s own conflict test never asserted
   `evaluation["decisionRequests"]`, only `goalMet`/`rules`; this dry route's own
   `decisionRequests.length >= 1` assertion on the conflict scenario is what caught it. Full
   diagnosis of both gaps is in `.superpowers/sdd/task-10-report.md`.

Also needed: Site `capacity.parallelJobs: 2`, not 1 (the dispatch's own first guess) — each
resident task's retained engineering Job holds one job slot until its own `release()` runs right
after its result is collected, but collecting that result launches a second, concurrent Job (its
own Reader); with `parallelJobs: 1` every resident task after the first permanently refuses with
reason `site-capacity` and the whole repeat stalls on round 1 forever (confirmed by inspecting
`task.projection.reason` on a live, unmolested run before raising it to 2).

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
