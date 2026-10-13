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
session log of that round holds three entries, one completed.

## L4 (S3) — live resident Run on the Site (Task 13: real Host, real resident Engineer, real MAGE)

Run `run-5efb6ac0-fce1-4aed-bb8b-d54525197106`, started 2026-10-13 03:11 UTC from the Host's
own Run path (the machine-local live worker, Pack as of commit `f0d280b5`, Site
`linglong-mage-script`, Goal `target_dropped_count 0 / max_target_distance_um 100 /
max_order_deviation_lr 2 / max_order_deviation_tb 1 / max_priority_move_um 100`), ended 03:56 UTC
`ended-goal-not-met` after 4 rounds, 12 tasks, 45.5 min. One resident Engineer per round wrote and
ran its own Tcl through `mage-stage`; 19 stages in all (1 / 7 / 6 / 5 per round), every one of them
either `completed` or failed at a named boundary; no stage was refused by the gate and no stage
timed out. Every round delivered a `completed` candidate and the Reader read all 17 values each
round (`readerJobs == engineeringJobs == rounds == 4`). Evidence stays on the Site (Campaign
`mage-script-placement-20261013-031102-8e39`; a copy of the delivery, journal, decisions and stage
reports is machine-local under `.superpowers/live/runA-delivery/`).

| | ordinary drops | ordinary drop length | priority placed | priority move max | order LR / TB | marks beyond 100 µm | native O / S / B |
| --- | --- | --- | --- | --- | --- | --- | --- |
| native baseline (incumbent) | 27 | 135,113 µm | 225 / 225 | 0 | 2 / 1 | 60 | 0 / 1 / 0 |
| **delivered best (round 2)** | **16** | **78,045 µm** | 225 / 225 | 4,036 µm | 3 / 5 | 157 | 0 / 1 / 0 |
| customer reference (retained fill) | 18 | 52,453 µm | 225 / 225 | — | — | — | — |

**Proof level: Improvement** (`delivery/report.json` `proofLevel: "improvement"`, `goalMet: false`,
stop reason "no improvement for two consecutive rounds"). The delivered export beats the native
baseline on both ordinary count and length and beats the reference on count (16 < 18) but not on
length (78,045 > 52,453 µm), so it is not a Match. Rules: `placement-delivery-ready` and
`priority-all-placed` PASS; `drops-within-goal`, `target-limit-met`, `order-lr-within-goal`,
`order-tb-within-goal`, `priority-move-within-budget` and `no-native-violation` FAIL. The one
native SPACE row is the frame-corner instance already present in the frozen start state, so
`no-native-violation` cannot pass on this case for any candidate that keeps the start geometry.

Round history (rank key = native total → unplaced → ordinary count → ordinary length → over-limit
→ max(order LR, TB) → moved → move max):

| round | stages | result | key tail (count, length, over-limit, order, moved, move max) | route |
| --- | --- | --- | --- | --- |
| 1 | 1 | baseline reproduced, export byte-identical to the incumbent | 27, 135113, 60, 2, 0, 0 | continue |
| 2 | 7 | reference compaction reproduced and isolated; its conserved partial output applied explicitly, then filled | 16, 78045, 157, 5, 117, 4036.2 | continue (new best) |
| 3 | 6 | explicit tape placement into computed free lane intervals | 16, 78045, 157, 5, 117, 4036.2 (tie, different dropped set) | continue (stall 1) |
| 4 | 5 | converge-count variant 6/4 (130 moved, same fill) and an agent-computed packing of all ordinary marks (306 placed, 67 SPACE, inventory −1, not deliverable) | 16, 78045, 161, 9, 130, 7314.3 | stop (stall 2) |

Method-journal digest (the Engineer's own conclusions, aggregate wording): round 1 reproduced the
incumbent exactly. Round 2 showed signature one (the invalidation) is exactly the per-item offset
edit after point placement and disappears when the relaxation runs before the placement is sourced;
signature two (the preplaced-sort failure under converge mode) then remains, is setting-independent
across three documented variants (byte-identical compacted boundary each time), and is fatal to
native converge compaction on this build — but its conserved partial output, applied explicitly and
filled in non-converge mode, is what yields 16 / 78,045 µm at the cost of the movement, order and
target limits. Round 3 found that on the frozen priority placement an explicit, budget-respecting
tape placement reaches 24 / 119,549 µm with priority movement 0 and order inside the Goal (a
rules-respecting improvement on the baseline, ranked below round 2 by the key), and on the
compacted geometry ties round 2 exactly. Round 4 concluded the 16-drop floor is lane capacity of
the compacted priority geometry, not the specific compaction: a fuller compaction (130 moved Fits)
fills to the same 16 / 78,045 µm, and a clearance-unaware packer is refused by MAGE. The journal's
stated next lever is a clearance-aware packer for the ordinary marks (they are not covered by the
movement budget).

Independent checks after the Run:

- **Kit evaluator.** The benchmark kit's `evaluate.py` (frozen bundle verified, 675 files) scored
  the delivered export: placed 528 (225 grouped, 303 ordinary, 10 Fixed), ordinary drops 16 /
  78,045 µm, grouped drops 0; gates `priority_all_placed`, `fixed_preserved`,
  `ordinary_inventory_complete`, `no_known_footprint_change`, `source_material_intact`,
  `outer_boundary_clear` all true; `drop_numerically_improves_reference: false` (count better,
  length worse), `customer_zero_drop_goal_met_in_pla: false`. Candidate sha
  `75459438f8765cf6dc0c3a6431eb6bb46e271ce4c2839a7cf25ae8a6cb8c23ce`.
- **Cold replay.** The delivered stage chain (round 2 stage 2, the compaction; round 2 stage 5, the
  fill from its compacted snapshot) was re-run from the Engineer's exact agent text in a fresh
  workspace through `mage-stage` on the Site host: both stages completed, 10 s wall in total, the
  compaction export (`b8a732eb…`) and the delivered export (`75459438…`) are byte-identical to the
  Run's, and `stage-report` reproduces 16 / 78,045 µm, inventory pass, native 0 / 1 / 0.

Open checks carried from the probes: the pre-existing SPACE row (judge whether the start state
itself is accepted), the 8 exact-block mismatches and the missing technology `a` noted in the
Task 12 ledger; none of them changed in this Run. Design observations for the next slice: the
rank key orders ordinary count/length ahead of rule compliance, so a budget-breaking candidate
(round 2) outranks a budget-respecting one (round 3 stage 2, 24 / 119,549 µm, movement 0) — the
Goal should decide whether the movement/order limits are hard constraints on the ranking; and
D-status commands in `knowledge/mage-capabilities.md` can now be qualified from the 19 recorded
stages.

## No model, no EDA

Every test in this Task's own work (`test_knowledge.py`) runs with `/usr/bin/python3` against the
Pack's own `contract.yml` and `flow/mage_placement_cli.py` source text — no model call, no licensed
MAGE binary, and no GUI ran anything recorded in this Task.
