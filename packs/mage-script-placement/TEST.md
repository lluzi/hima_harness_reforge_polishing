# MAGE script-method test-structure placement 0.1.0 test record

## L1 — Pack-local unittest on synthetic fixtures

`cd packs/mage-script-placement && /usr/bin/python3 -m unittest discover -s flow/tests -t flow`

148 tests passed before this Task's additions (Tasks 1–7's driver, Reader, rules, schemas and
fixtures). This Task (8) added `flow/tests/test_knowledge.py` (7 tests: every `contract.yml`-named
knowledge file exists and is flat-named, no placeholder text remains, the top-level `knowledge:`
table equals the `engineer-script` tool's own `outsourcing.knowledge` union, the Engineer's five
files stay under the 12,000-word budget, every CLI subcommand/flag a knowledge file names is real
(including the checker's own negative self-test), and every `state/...` path named is a declared
`contract.yml` output or a `state/history/round-NN/...` archive path). Current total:

```
Ran 155 tests in 5.943s

OK
```

No skips, no `--pattern` narrowing. Python 3.9.6 (Mac, `/usr/bin/python3`); the Linglong resident
container's own Python 3.8.16 has not yet been checked for this Task's additions (test code is
written to the 3.8-compatible standard-library-only constraint: no f-string syntax beyond 3.8, no
`match` statements, no walrus-dependent control flow).

## L0/L2 — Host contract test (pending)

Not run by this Task. Expected command, once the Host contract test exists:
`pnpm run build && pnpm run test:local -- --files test/contract/mage-script-placement.test.ts`.

## L2 dry route (Task 10 — passing, 3/3)

The whole `repeat` of `engineer-script → decide-round` runs on the real Host and durable runtime
with zero model calls. A stand-in ACP Engineer (`test/fixtures/mage-script-dry/acp.py`, the
`native.executable` the resident wrapper launches) authors a real Tcl stage script and drives the
deployed `mage_placement_cli.py` through `mage-stage → stage-report → candidate` exactly as the
Pack's knowledge instructs, with the stand-in MAGE (`flow/tests/standin_mage.py`) in place of the
licensed binary. Three scenarios are selected by env `MAGE_SCRIPT_DRY_CASE`:
`converge` (round 1 baseline → continue, round 2 improved PLA → goal met, stop at 2),
`stall` (baseline every round → stop at 3 by two consecutive stalls),
`blocked` (round 1 fails after boundary `priority-start` via `MAGE_STANDIN_FAIL_AFTER_SNAPSHOT` so
its candidate is blocked and the round continues with no best, round 2 improved → goal met, stop at 2).

Registered in `test/contract-groups.json`'s `atcs-dry` group. Run from the worktree root:

```bash
export PATH="$HOME/.local/node24/bin:$PATH" HIMA_POSTGRES_RUNTIME=/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/dbos-migration/u2/runtime-final CI=true
mkdir -p .hima-tmp/dbos-migration/u8/dry
pnpm run build && node scripts/run-contract-tests.mjs atcs-dry --files test/contract/mage-script-placement-durable.host.test.ts
```

Result: 3 passing. The three proof lines the worker printed (`productModelCalls` 0; `readerJobs ==
engineeringJobs == rounds` on every run):

```
{"ok":true,"mode":"converge","runId":"run-6e672532-2e4d-49f7-aaf8-3a020dd15296","tasks":8,"rounds":2,"readerJobs":2,"engineeringJobs":2,"productModelCalls":0,"goalState":"met","goalMet":true,"proofLevel":"completion","journalEntries":2,"elapsedMs":16895}
{"ok":true,"mode":"stall","runId":"run-8390ec0b-fb1e-4f39-a723-40b50051b288","tasks":10,"rounds":3,"readerJobs":3,"engineeringJobs":3,"productModelCalls":0,"goalState":"not-met","goalMet":false,"proofLevel":"reproduction","journalEntries":3,"elapsedMs":14220}
{"ok":true,"mode":"blocked","runId":"run-4f474182-ff98-4445-bb29-9fa7f1470bc7","tasks":8,"rounds":2,"readerJobs":2,"engineeringJobs":2,"productModelCalls":0,"goalState":"met","goalMet":true,"proofLevel":"completion","journalEntries":2,"elapsedMs":9708}
```

This proves the Harness/Pack wiring (rounds, task counts `2 + rounds*2 + 2`, one Reader Job per
resident execution reading `mage_candidate_error_count == 0`, journal entries, `goalMet`,
`proofLevel`) against a stand-in MAGE interpreter that accepts this Pack's own baseline and improved
scripts verbatim — not MAGE's own behaviour.

## L4 (S2) — native qualification (pending — Tasks 10, 12, 13)

Not started. Needs the permanent MAGE licence server, a stamped Site manifest version carrying
`referenceMethod`/`referenceFiles`/`referenceNotes`, and the user's own live, watched Run before any
D-status command in `knowledge/mage-capabilities.md` can move from documented to qualified, and
before the knowledge's exact Tcl command text (the four reference-method stages, the two known
failure signatures, the compatibility repairs) can be confirmed against the real build rather than
only against the Pack's own code.

## No model, no EDA

Every test in this Task's own work (`test_knowledge.py`) runs with `/usr/bin/python3` against the
Pack's own `contract.yml` and `flow/mage_placement_cli.py` source text — no model call, no licensed
MAGE binary, and no GUI ran anything recorded in this Task.
