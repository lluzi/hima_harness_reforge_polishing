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

## L2 dry route — BLOCKED on a real resident/Campaign path mismatch

Task 10 built `test/fixtures/mage-resident-dry/{prepare.py,acp.py}` (an ACP v1 stand-in Engineer
and the four stand-in consumers, driving the real, deployed `mage_placement_cli.py` through the
exact `snapshot`/`mage-round`/`candidate` and `evaluate`/`review` sequences
`flow/tests/test_cli_tasks.py` already proves) and, before wiring the TypeScript Host worker,
reproduced the whole resident round loop in Python against a real two-workspace layout (a private
resident workspace separate from the Campaign workspace, exactly as the real Harness separates
them, instead of `test_cli_tasks.py`'s single shared workspace) — program tasks run against the
Campaign workspace; the Engineer's and each consumer's resident CLI calls run against their own
private workspace, with `state/case-readiness.json`, `state/start-snapshot.json`,
`state/incumbent.json`, `state/round-decision.json` and `state/round/placement-candidate.json`
copied in from the Campaign per round (mirroring exactly what `task.inputs` gives a real resident
task), and every `placement/round-NN/...` support file materialized back into the Campaign workspace
at the same relative path (mirroring `materializeEngineeringResult`'s own join of
`identity.workspace` + `artifact.path`).

Both scripted round sequences (`converge`: round 1 OVL_B 150µm off target and KEY_V dropped, hard
fails on both, round 2 corrects both, `route: stop` / `"no consumer hard failure and no open
request"` at round 2 — 16 task executions, matching the brief's prediction exactly; `conflict`: KEY_V
stays dropped every round, litho-pie's hard fail clears in round 2 then it files a `keep` Request
conflicting with WAT's standing `place` Request, `route: stop` / `"no improvement for two
consecutive rounds"` at round 4 — 28 executions, not the 22/3-round number the brief predicted; the
Pack's own proven `decide()` math needs round 2's genuine hard-fail-count improvement and round 3's
non-improvement before round 4's second non-improvement triggers the stop rule, exactly as
`flow/tests/test_cli_tasks.py:test_no_improvement_for_two_rounds_stops_with_a_decision_request`
already establishes for this identical request/ledger pattern) ran their expected rounds and routed
correctly. But **every** round's `placement-candidate` Reader (`tools/read-mage.py`) fails with
`mage_candidate_error_count: 1` and every other declared fact `unknown`, reason:

```
FileNotFoundError: [Errno 2] No such file or directory:
'<campaign>/state/session.jsonl'
```

Root cause: `mage_placement_cli.py:_cmd_mage_round` writes the MAGE session JSONL log at a fixed,
cumulative, non-round-scoped path, `<WORKSPACE>/state/session.jsonl` (`log_path = Path(workspace) /
"state" / "session.jsonl"`), and `_cmd_candidate` records that exact path as
`files.sessionLog.path` (a literal `"state/session.jsonl"`, not `round_dir`-relative) inside the
published `placement-candidate` document. The Reader (`_check_session_log`) resolves that path
against the Campaign workspace — correctly, per its own module docstring ("this script is shipped
... into the Campaign workspace's `hima-readers/<reader-id>/` directory"). But the resident
delivery mechanism (`engineering-executor.ts:materializeEngineeringResult`) only ever copies a
support artifact into the Campaign workspace when its path starts with the tool's own
`artifactPrefix` (`placement/` for `engineer-place`) — `collect_delivery` in
`resident-engineering-wrapper.py` validates every delivered artifact path against the *private*
resident workspace, and the wrapper's own schema requires exactly one `result` artifact and rejects
any other kind outside that prefix. `state/session.jsonl` can never satisfy that prefix check (it
is not under `placement/`), so it can never be delivered, and the Campaign workspace never receives
it — only the round's own private workspace does. `flow/tests/test_cli_tasks.py` never catches
this because it drives every program task and every resident subcommand against one shared
workspace, where no such copy step exists at all.

This is a genuine Pack/Harness contract mismatch between the one-writer `MageSession` log design
(assumed one shared workspace per the Pack-local test) and the real two-workspace resident
architecture (private resident workspace vs. Campaign workspace, artifactPrefix-scoped delivery)
that only running the actual two-workspace shape — not the Pack-local test's single shared one —
surfaces. Per Task 10's own dispatch resolution, this is **not** worked around by weakening the
Pack (e.g. silently dropping the `sessionLog` check, or fabricating the file): the TypeScript Host
worker and `test/contract/mage-scribe-placement-durable.host.test.ts` were therefore **not**
written, since they would hit this identical, deterministic failure on round 1 of either scenario
(the flow itself does not halt — `decide_round` does not require clean Reader values — but
`evaluate_placement`'s `placement-delivery-ready` rule FAILs and every drops/target/order/native
rule reads UNKNOWN, so `goalMet` can never legitimately reach `true`, contradicting this milestone's
own point). Full reproduction, the exact simulation script, and the controller's options are in
`.superpowers/sdd/task-10-report.md`. **BLOCKED — the controller decides** whether to scope the
session-log path under the Engineer's own round prefix (a Pack fix, likely
`placement/round-NN/session.jsonl` instead of the cumulative `state/session.jsonl`, in a follow-up
task) before Task 10's TypeScript Host worker is written.

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
