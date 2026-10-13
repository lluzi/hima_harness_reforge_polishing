# MAGE script-method test-structure placement 0.1.0 test record

## L1 — Pack-local unittest on synthetic fixtures

`cd packs/mage-script-placement && /usr/bin/python3 -m unittest discover -s flow/tests -t flow`

148 tests passed before this Task's additions (Tasks 1–7's driver, Reader, rules, schemas and
fixtures). This Task (8) added `flow/tests/test_knowledge.py` (7 tests: every `contract.yml`-named
knowledge file exists and is flat-named, no placeholder text remains, the top-level `knowledge:`
table equals the `engineer-script` tool's own `outsourcing.knowledge` union, the Engineer's five
files stay under the 12,000-word budget, every CLI subcommand/flag a knowledge file names is real
(including the checker's own negative self-test), and every `state/...` path named is a declared
`contract.yml` output or a `state/history/round-NN/...` archive path). Task 8 total was 155.

The final whole-branch review fix round (2026-10-13) added 7 regression tests — one per behavioural
change: the stall rule ignoring blocked rounds (`test_rounds`), each new refusal pattern and the
unbalanced-brace guard (`test_native_session`), the Reader refusing a swapped verify file, a swapped
stdout and a missing incumbent (`test_readers`), and `lane-view`'s relative snapshot path
(`test_cli_stage`). Current total:

```
Ran 162 tests in 5.853s

OK
```

No skips, no `--pattern` narrowing. Python 3.9.6 (Mac, `/usr/bin/python3`). The Task 8 count (155)
was also reproduced on the Linglong resident container's own Python 3.8.16 (rsync of the Pack to
`/home/luzi/tmp/mage-script-flow-check/`, then `podman run … localhost/edarunner:alma8 … python3 -m
unittest discover -s flow/tests -t flow`, 2026-10-13, `Ran 155 tests … OK`); the fix round's 7
additions use the same 3.8-compatible standard library and have not been re-run in the container.

## L0/L2 — Host contract test

`test/contract/mage-script-placement.test.ts` (Task 9): `loadPack` structure (entry, `repeat` with
`maxIterations: 6`, one resident tool with `licences {mage: 1}` and `produces: scriptCandidate`, the
five goal knobs, the eight rules, no `agentTeams`/workshops), Reader emits == semantics, and
`checkPack` against a synthetic Site with `licences {mage: 1}` (fit), without it (refuse), and
against the real `sites/linglong-mage-script` files including an extra `consumerContext` binding
(tolerated, fit). Passing 3/3; the run is recorded in the Task 9 report. Command:

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

## L4 (S2) — native probes on the Site (Task 12: host-side, no resident, no model)

Run 2026-10-13 02:36–02:37 UTC on the Site host against the staged frame case through this Pack's
own `mage-stage` driver (Pack flow as of commit `5d8ac199`; the permanent MAGE licence server; the
stamped Site manifest `manifest-script.json`, sha recorded in `sites/linglong-mage-script/README.md`,
carrying `referenceMethod`, 54 `referenceFiles`, 24 `referenceNotes` and the reference ordinary
drop length). Evidence stays on the Site (`/home/luzi/tmp/mage-script-probe-01/ws-baseline/`).

- **Baseline stage** (the playbook's round-1 script, with the two converge lines): completed in
  12 s; boundaries `priority-start` and `filled`; export sha
  `0a95e89d61cf46bcd4575227ff4be11d7c0a37b5690522f27eae2173b0f61901`, byte-identical to the kit's
  native baseline PLA; 27 ordinary drops / 135,113 µm, 0 grouped drops, 225 priority Fits, 10 Fixed,
  292 ordinary Fits (inventory pass against the incumbent population); native OVERLAP 0, SPACE 1
  (the known instance row), BOUNDARY 0; 60 priority marks beyond 100 µm (pre-existing in the start
  state), order deviation LR 2 / TB 1, priority movement 0. `candidate` assembled a `completed`
  candidate and the Reader exited 0 with all 17 values known. **Proof level: Reproduction.**
- **Compaction failure probe, invalidation** (relax the 129 zero-offset items after point
  placement, then the reference converge call): the `after-offsets` boundary reads 225 Groups and
  **0 in-group Fits** (the invalidation signature); `smPFlow -autoRefine` failed; the stage ended
  `MAGE_STAGE_ERROR boundary after-offsets`, 3 s.
- **Compaction failure probe, restored** (same, then `source $hima_start_pla` again before the
  converge call): the `priority-restored` boundary reads 225 Fits but **0 in-group / 225 ordinary** —
  a plain re-source after the offset edits restores the Fits unbound from their Groups; the converge
  call then printed `Sort sl <lane> preplaced fits failed` twice and `Failed at auto refinement`;
  blocked at `priority-restored`, 3 s.

Both signatures the handoff describes are therefore reproducible and visible in `stage-report`
rows within seconds, and a blocked stage yields a blocked candidate (no metrics claimed). The
session log of that round holds three entries, one completed. The live resident Run (Task 13) has
not run yet; D-status commands in `knowledge/mage-capabilities.md` remain unqualified until an
Engineer qualifies them with a passing and a failing stage.

## No model, no EDA

Every test in this Task's own work (`test_knowledge.py`) runs with `/usr/bin/python3` against the
Pack's own `contract.yml` and `flow/mage_placement_cli.py` source text — no model call, no licensed
MAGE binary, and no GUI ran anything recorded in this Task.
