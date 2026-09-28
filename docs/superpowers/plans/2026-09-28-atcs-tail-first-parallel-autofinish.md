# ATCS Tail-First Parallel Repair with Auto-Finish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current `agentic-timing-closure-system` Pack (0.1.10, main `e7c71927`) so it closes post-route timing in fewer physical refreshes and less elapsed time than the serial XTop auto-fix loop. Three workers research the worst timing troubles in parallel. Each applies a multi-edit manual repair. XTop auto-fix then finishes the bulk in the same session, and one joint Innovus → StarRC → PrimeTime refresh verifies each generation.

**Architecture:** This is a minimal change to what is already built and tested on real data. It keeps the three-slot workspaces (M2), Contributions (M3), composition (M4), replay and merge commit (M5), refresh and evaluation (M6), and adoption (M7). It adds four things:
1. **Parallel research.** An existing Harness fork runs the three research Workshops at once. XTop sessions stay serial: they take about 100 s, against about 20 minutes for a refresh.
2. **Multi-edit reviewed repair.** One narrow, generic Harness change: `reviewedAction` accepts an ordered list of 1 to N actions instead of exactly one.
3. **Tail-first partition.** The plan Workshop, its Reader and its knowledge target the WNS-defining clusters first.
4. **Auto-finish.** At the end of the existing XTop replay session, a hold and then a setup auto-fix runs with the manual edits locked. Its changes are exported with `write_design_changes -format INNOVUS -keep_route` and sealed into the same merge commit, so there is one refresh per generation.

**Tech Stack:**
- Pack: Python 3.9 stdlib (`unittest`), Tcl templates for XTop, Innovus, StarRC and PrimeTime, and YAML (`contract.yml`, `graph.yml`).
- Harness: TypeScript in `packages/harness/src`, with contract tests run through `scripts/run-contract-tests.mjs` on Node 24.

---

## 1. First principles: why this closes timing faster

### 1.1 What one generation costs, measured on `postroute_final`

Run `run-1ca6cdd3` (2026-09-28, Pack 0.1.9, 3 generations, 106 min wall):

| Step | Measured | Depends on batch size? |
| --- | --- | --- |
| XTop Operator session | 101–106 s | no |
| Physical refresh: replay 33 s + Innovus ECO + `ecoRoute` 452 s + StarRC (2 corners) 592 s + PrimeTime (4 scenarios) 109 s | ≈ 20 min | no |
| Agent turns (owner, research Workshops, Team) | ≈ 75 of 106 min | sequential today |

A refresh costs about 20 minutes whether it carries one edit or three thousand. So:

> **T_close ≈ G × (T_research + Σ T_xtop + T_refresh)**, where G is the number of generations (refreshes).

Closing faster means three things:
- G must be small.
- T_research must stay off the critical path.
- No refresh may be spent on a batch that cannot move the goal.

### 1.2 The goal is a tail property, and auto-fix is a bulk tool

The goal is WNS ≥ 0 for setup and hold in all four scenarios: the single worst check, not the violation count. The serial flow's own measured record on this design (`packs/xtop-timing-closure/knowledge/source-flow.md` §9) shows the split.

**Round 1** (one refresh; XTop inserted 2,908 cells and resized 919):

| Metric | Before | After |
| --- | --- | --- |
| Hold violations | 7,430 | 148 (−98%) |
| Hold TNS | −279.8 | −4.8 |
| Hold WNS | −0.2016 | −0.1523 |
| Setup violations | 281 | 33 |
| Setup WNS | −0.1567 | −0.038 |

**Round 2** (second refresh; 116 inserts, 121 resizes):

| Metric | Before | After |
| --- | --- | --- |
| Hold WNS | −0.154 | −0.154 (unchanged) |
| Setup WNS | −0.0383 | −0.0383 (unchanged) |
| PT-measured hold WNS | −0.15 | −0.16 (worse) |

The frozen B_lazy Run `ddabd488` found the same stall: 0 endpoints fixed.

Conclusion: auto-fix removes the bulk in one pass, then stalls on a small tail that sets WNS. Every further serial round spends another 20-minute refresh attacking a tail it cannot fix.

### 1.3 Why the tail needs agents, and why agents parallelize

Tail checks fail for structural reasons a global greedy fix does not resolve:
- hold and setup windows overlapping on the same path, so a hold fix consumes setup margin;
- clock-skew-driven paths;
- high-fanout or net-delay-dominated nets;
- congested neighbourhoods.

Each tail cluster needs diagnosis followed by a specific multi-edit repair, for example:
- resize the driver chain;
- insert a buffer at a chosen load pin and location;
- delete a redundant buffer;
- split a fanout.

That work is minutes of reasoning per cluster. Clusters that do not share instances, nets or timing windows are independent, and M4 composition already detects conflicts and shared windows cheaply. So research across clusters runs in parallel: its wall time is the max, not the sum.

### 1.4 Why tail first, then auto-fix, both in one refresh

- **Auto-fix first harms the tail.** It inserts thousands of buffers (2,908 in round 1), consuming placement space and setup margin exactly where tail repairs need them. That is the over-fixed state seen in `xtop_round2_eco_route`.
- **Tail first protects the manual edits.** Running the manual repairs first, then auto-fix with those instances and their nets marked `dont_touch`, lets auto-fix see the repaired tail and finish only the bulk. It cannot undo a tail repair.
- **Both happen in one session, so one refresh.** The manual edits are replayed in the existing XTop replay session, and auto-finish runs at its end. The exported Innovus ECO carries tail plus bulk into a single refresh.

### 1.5 Predicted outcome and how it is judged

The prediction:
- **Generation 1:** about one refresh reaches the serial round-1 bulk result, and moves the tail that round 2 could not.
- **Generation 2:** targets the residual tail.

Success is judged only by refreshed PrimeTime on the implemented database with new SPEF. Acceptance, §4, has three parts:

| | Old serial flow, best measured (2 refreshes) | This plan must reach |
| --- | --- | --- |
| Refreshes | 2 | ≤ 2 |
| Hold WNS (all scenarios) | −0.16 ns | better than −0.15 ns |
| Setup WNS | −0.04 ns | better than −0.038 ns |
| Hold TNS, ssg_m40 | −4.10 ns | no worse than −4.10 ns |
| Wall time to the second refresh result | — | ≤ 120 min |
| Physical checks | — | no new signal DRC or connectivity failures beyond the baseline |

---

## 2. Global Constraints

- **Pack layers.** Pack id `agentic-timing-closure-system`. The version goes from 0.1.10 to **0.2.0** in `contract.yml` (quoted, line 2), in `graph.yml`, and in the regex in `test/contract/agentic-timing-closure-system.test.ts`. Fix location priority is Pack → Site integration → generic Harness seam.
- **Exactly two Harness changes, both generic, with no Pack-specific branch:**
  1. Task 2: an ordered `reviewedAction` action list.
  2. Task 1, only if the spike fails: Workshop nodes inside fork branches.

  Each needs a contract-level RED/GREEN test, an independent review, and `pnpm run check:boundary`.
- **Frozen.** `packs/xtop-timing-closure/` and `sites/linglong-swerv28/` are read-only; copy exact XTop command strings from them.
- **Python.** Stdlib only, Python 3.9 compatible. Tests: `cd packs/agentic-timing-closure-system/flow && python3 -m unittest discover -s tests`.
- **Fail closed.** A missing, truncated or mismatched source yields `unknown` or an `AtcsError`, never 0 or PASS.
- **Convergence.** Claimed only from refreshed PrimeTime on the implemented DB with new SPEF, never from XTop's own timing estimates.
- **Server.** `ssh luzi@192.168.50.41`.
  - Check `empyrean-license status`; the mode must be `old`. Never switch the mode.
  - Write only under `atcs-runs/qual-*`, `qual-tools/` and new `operator-admin/atcs-vN/` directories.
  - Never write into a live Campaign workspace or the Foundation root.
- **Wrapper identity.** A flow change means a new wrapper `atcs-v10`, derived on the server from the **installed** `atcs-v9`. It is qualified with its own preflight: positive on the new flow after a native `prepare-workers`, and negative on the old flow at the adapter check. The kit's `wrapper-pins-pack-flow` check must pass.
- **Commits.** Every commit is followed by `git push origin HEAD:main` and a check that the remote SHA matches. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Node 24.** Run `export PATH="$HOME/.local/node24/bin:$PATH"` first, and never run two Electron suites at once.
- **Live Campaigns.** None until Task 9's server chain dry run passes on real `postroute_final`.

## 3. File map

| File | Change |
| --- | --- |
| `packages/harness/src/packs.ts` | `reviewedAction.commands` (list) and `maxActions`; validation. The single-`command` form stays valid. |
| `packages/harness/src/index.ts` | Build an ordered `actions[]` inline payload (~1028-1053); enforce each mutation equals the next unconsumed action (~882-891). |
| `packages/harness/src/delegation.ts` | `TeamRecipeBinding.inlinePayload` and `reviewOutput` types. |
| `test/contract/delegation-team-settlement.host.test.ts` (or a new sibling `team-reviewed-action-list.host.test.ts`) | RED/GREEN tests for the ordered list. |
| `test/contract/fork-join.test.ts` | Spike: a fork whose branches are Workshop → Reader act nodes. |
| `packs/.../contract.yml` | insert/delete gain `planSha256`; Teams `atcs-worker-01..03` v4 with reviewer `commands` and `maxActions: 8`; strategy knobs `workerSlots` and `autoFinish`; Workshop purposes. |
| `packs/.../graph.yml` | Fork `prepare-workers` → 3 × (research → read request) → join; serial operate chain; `collect`. |
| `packs/.../flow/templates/xtop-operator.tcl` | Single-use guard per reviewed action key; `planSha256` on insert/delete. |
| `packs/.../flow/templates/xtop-replay.tcl` | Auto-finish block, `dont_touch` on manual edits, pre/post dumps, `write_design_changes`. |
| `packs/.../flow/atcs/integration.py` | `prepare_replay` carries the auto-finish spec; `seal_batch` seals `autoFinish{eco pair sha, delta}`. |
| `packs/.../flow/atcs/adapters.py` | `compile_xtop_replay_task` passes auto-finish settings; `compile_innovus_eco_task` sources the XTop ECO pair when present. |
| `packs/.../flow/atcs_cli.py` | `_cmd_replay_prepare` and `_cmd_implement` wiring. |
| `packs/.../tools/read-atcs.py` | Worker actions: 1–8, kinds size/insert/delete with exact fields. Campaign plan: disjoint edit domains across slots. |
| `packs/.../knowledge/*.md` | Tail vs bulk, tail clustering, repair recipes, auto-finish policy. |
| `sites/linglong-atcs28/*` | v10 wrapper template, environment template, Permit, README. |

---

## Task 1: Spike — Workshop and Reader nodes inside Harness fork branches

**Why:** `forkFrom` (`packs.ts:2411-2447`) accepts branches that are chains of `act` nodes joined at one judge, and branches run concurrently (`forks.ts:107-127`). ATCS Workshop and Reader nodes are `act` nodes, but `FABRIC.md:110` records Workshops inside a branch as runtime-unproven. This task decides the graph shape.

**Files:** Modify `test/contract/fork-join.test.ts` (add a case).

- [ ] **Step 1:** Add a test that loads a minimal fixture Pack whose graph is:
  - `prep` (act tool);
  - a fork to `ws-a → read-a` and `ws-b → read-b`, where `ws-*` are Workshop act nodes with deterministic entry scripts and `read-*` are Reader act nodes;
  - a join judge `join` with a rule on `read-a`'s value.

  Drive the Run with the existing fork-join helpers. Assert that:
  - (a) both Workshop executions begin before either finishes, by comparing their `begun` and `finished` record order;
  - (b) the join waits for both Readers;
  - (c) the Ledger holds one Workshop code record per branch.
- [ ] **Step 2:** Run `node scripts/run-contract-tests.mjs local --files test/contract/fork-join.test.ts`.
- [ ] **Step 3 (decision):**
  - **PASS:** record "Workshops in fork branches: proven" in `FABRIC.md` G1 and use the fork graph in Task 5.
  - **FAIL:** make the smallest generic Harness change in `forks.ts` so a Workshop act node inside a branch is driven like any other act node. Write a RED test first, then get an independent review. If that change exceeds about 60 lines, stop and use the sequential fallback in Task 5. Batching still gives most of the speed-up (§1.1), and FABRIC must say so.
- [ ] **Step 4:** Commit `test(harness): fork branches may carry Workshop and Reader act nodes`; push; verify the SHA.

## Task 2: Harness — `reviewedAction` carries an ordered list of actions

**Why:** Today the Host takes exactly one `{command, arguments}` from the adopted Reviewer (`index.ts:1036-1052`) and pins every mutation to it (`index.ts:882-891`). One edit per Operator session cannot repair a tail cluster.

**Files:** `packages/harness/src/packs.ts`, `index.ts`, `delegation.ts`, and the contract test named in §3.

**Interfaces — Produces:**
- **Schema:** `reviewedAction.commands: string[]` (optional; mutually exclusive with `command`) and `reviewedAction.maxActions: number` (1..32, default 1). Each command must be in the tool's `interactive.commands.mutate` and must take the `hostPlanHashArgument`.
- **Reviewer result:** `actions: [{command, arguments}]` (length 1..maxActions) when `commands` is set. Each item must match some entry of the plan's `actionListField`. Items keep their order and may not repeat.
- **Operator enforcement:** within one `toolSessionId`, the k-th accepted mutation must equal `actions[k]` exactly (command and arguments, plus the hash). Any other mutation is refused with `reviewed action k of n differs`, and a repeat is refused as `already applied`.

- [ ] **Step 1: RED tests**, reusing the existing team fixture shape in `delegation-team-settlement.host.test.ts`:
  1. A Reviewer returning 3 ordered actions → the Operator's three mutations in that order are accepted.
  2. The same three in a different order → the second is refused.
  3. A fourth mutation → refused.
  4. `maxActions: 2` with 3 actions → adoption refused.
  5. An action whose arguments match no plan entry → adoption refused.
  6. The existing single-`command` recipes are unchanged: the old Pack test `test/contract/interactive-eda.host.test.ts` still passes.
- [ ] **Step 2:** Run them and confirm they FAIL.
- [ ] **Step 3: Implement.**
  - In `index.ts` at 1036-1052, when `effective.recipe.reviewedAction.commands` is set, read `payload.actions`. Validate each item as today: typed arguments, a plan-entry match and the hash. Store `inlinePayload.actions = [...]`.
  - At 882-891, count the mutation inputs already accepted for this `toolSessionId` from the Ledger (`interactive` records with `event: 'command-completed'` whose command is in `mutate`) to get k. Then compare against `actions[k]`.
  - Keep the single-`command` path byte-identical.
- [ ] **Step 4:** Run GREEN, then `pnpm run check:boundary` and the local contract group files touched.
- [ ] **Step 5:** Get an independent review (Opus, fresh context, diff package). Commit `feat(harness): a Team reviewer may approve an ordered list of actions`; push; verify.

## Task 3: Pack Operator — multi-edit manual repair, safely

**Files:**
- `contract.yml`: `xtop-operator` interactive commands and the Team recipes.
- `flow/templates/xtop-operator.tcl`.
- `tools/read-atcs.py`: the w01..w03 worker-request branch.
- Tests: `flow/tests/test_readers.py` and `test/contract/agentic-timing-closure-system.test.ts`.

- [ ] **Step 1: RED tests.**
  - **Reader** (`test_readers.py`):
    - A w01..w03 request with 8 actions mixing `{"kind":"size_cell","instance","toMaster"}`, `{"kind":"insert_buffer","net","loadPins","master","location"}` and `{"kind":"delete_buffer","instance"}` is admitted when every instance or net is a full hierarchical path (existing `_is_hierarchical_instance`) inside the edit domain.
    - 9 actions → refused.
    - An unknown `kind` → refused.
    - `insert_buffer` with a load pin outside the domain nets → refused.
  - **Contract test:**
    - Teams `atcs-worker-01..03` exist, version `"4"`.
    - The reviewer `reviewedAction.commands` equals `["atcs_size_cell","atcs_insert_buffer","atcs_delete_buffer"]` and `maxActions` is 8.
    - `atcs_insert_buffer` and `atcs_delete_buffer` declare a `planSha256` argument.
- [ ] **Step 2:** Run and confirm FAIL.
- [ ] **Step 3: Implement.**
  - **`contract.yml`:**
    - Add `planSha256: {type: string}` to `atcs_insert_buffer` and `atcs_delete_buffer`.
    - Clone the `atcs-worker-01` Team to `atcs-worker-02` and `atcs-worker-03`, with `triggerNode: operate-worker-0N` and inputs `workerRequest0N`.
    - Reviewer `taskTemplate`: "Read the adopted Researcher result and the exact workerRequest. Return an ordered `actions` list of 1 to 8 `{command, arguments}` taken only from the plan's actions, which repairs the targeted cluster in dependency order (for example insert the buffer, then size its driver). Return one compact JSON object; if the owner returns a refusal of your reply, answer with the corrected single JSON object only."
    - Operator `taskTemplate`: "Dump before.dump, query the falsifier, apply each reviewed action once in order, dump after.dump, export, finalize and close."
    - Keep `followup: reuse-same-child` and `maxFollowups: 1` for the researcher and reviewer.
  - **`xtop-operator.tcl`:** add a per-action single-use guard. Keep a Tcl dict `::atcs_applied` keyed by the canonical argument string. Refuse a key already applied, and mark it applied only after the XTop command succeeds; the Host enforces the order.
  - **`read-atcs.py`:** replace "one to three sizing candidates" with the 1..8 typed kinds above. Keep the existing hierarchical and domain checks for every instance and net named.
- [ ] **Step 4:** Run GREEN. Run the Pack suite and the ATCS contract test.
- [ ] **Step 5:** Get a review (Sonnet). Commit `feat(atcs): a worker applies an ordered multi-edit reviewed repair`; push.

## Task 4: Tail-first campaign plan across three disjoint slots

**Files:** `contract.yml` (the `plan-campaign` purpose), `knowledge/contribution-and-merge.md`, new `knowledge/tail-first-repair.md`, `tools/read-atcs.py` (`_read_campaign_plan`), `test_readers.py`.

- [ ] **Step 1: RED tests** (`test_readers.py` `CampaignPlanReaderTest`):
  - A plan whose w01 and w02 edit domains share an instance → `tc_request_invalid_count` ≥ 1.
  - Disjoint domains → 0.
  - A slot marked `"parked": true` with an empty package is admitted.
  - A plan whose targets do not include the observation's worst check in any required scenario → counted invalid. That is "tail first": the worst check must be targeted.
- [ ] **Step 2:** Run and confirm FAIL.
- [ ] **Step 3: Implement** the Reader rules.
  - **Knowledge** `tail-first-repair.md`, with the four required headings:
    - **Tail:** checks whose slack is at or below the scenario's WNS plus 50% of |WNS|, capped at 60 checks.
    - **Clustering:** group tail checks by shared driver or net, shared cone, or placement region within 20 µm, into at most 3 clusters. Assign one cluster per slot with disjoint edit domains.
    - **Bulk:** left to auto-finish.
    - **Repair recipes:**
      - setup, cell-delay dominated → up-size the driver chain;
      - setup, net-delay or fanout dominated → buffer and split;
      - hold → insert a delay cell at the capture-side load pin, checking the setup margin of the same path;
      - redundant buffer → delete.
    - **Counterexample:** a hold fix on a path whose setup slack is below the hold deficit.
  - **`plan-campaign` purpose:** "Partition the current tail (see tail-first-repair.md) into up to three disjoint clusters, worst first. Each slot's editDomain holds full hierarchical instance paths. A slot with no cluster is parked."
- [ ] **Step 4:** Run GREEN, then get a review. Commit `feat(atcs): plan the tail first across three disjoint worker slots`; push.

## Task 5: Graph — parallel research, serial cheap XTop, one batch

**Files:** `graph.yml`, `contract.yml` (strategy knob `workerSlots` 1..3, default 3), `test/contract/agentic-timing-closure-system.test.ts` (node and edge counts, reachability).

- [ ] **Step 1: RED contract test.**
  - Every `research-worker-0N`, `operate-worker-0N` and `capture-worker-0N` is reachable from `prepare-workers`.
  - `collect` is reachable only after `read-worker-result-03`, or after the slot-03 skip.
  - Under the Task 1 PASS shape, `prepare-workers` has 3 unlabelled out-edges forming a valid fork that joins at `check-worker-request-01`.
- [ ] **Step 2:** Run and confirm FAIL.
- [ ] **Step 3: Implement.**
  - **Fork shape (Task 1 PASS):**
    - `prepare-workers` → {`research-worker-01` → `read-worker-request-01`, `research-worker-02` → `read-worker-request-02`, `research-worker-03` → `read-worker-request-03`}. All three join at judge `check-worker-request-01`.
    - `check-worker-request-01`: PASS → `operate-worker-01` → `capture-worker-01` → `read-worker-result-01` → `check-worker-request-02`; FAIL → `check-worker-request-02`.
    - `check-worker-request-02`: PASS → `operate-worker-02` → … → `check-worker-request-03`; FAIL → `check-worker-request-03`.
    - `check-worker-request-03`: PASS → `operate-worker-03` → … → `collect`; FAIL → `collect`.
    - A parked slot's request carries `"parked": true`. Its check FAILs and it is skipped.
  - **Sequential shape (Task 1 FAIL):** the same edges, except `prepare-workers` → `research-worker-01` → `read-worker-request-01` → `research-worker-02` → … → `read-worker-request-03` → `check-worker-request-01`.
  - Remove the `FABRIC.md` G1 "deferred" note, and record the shape and the Task 1 evidence.
- [ ] **Step 4:** Run GREEN, then get a review. Commit `feat(atcs): research three worker slots in parallel into one batch`; push.

## Task 6: Auto-finish at the end of the replay session

**Files:**
- `flow/templates/xtop-replay.tcl`
- `flow/atcs/integration.py` (`prepare_replay`, `seal_batch`, `reconcile`)
- `flow/atcs/adapters.py` (`compile_xtop_replay_task`, `compile_innovus_eco_task`)
- `flow/templates/innovus-eco.tcl`
- `flow/atcs_cli.py` (`_cmd_replay_prepare`, `_cmd_implement`)
- `contract.yml`: strategy knob `autoFinish` (0/1, default 1), plus `autoFinishHoldMarginNs` and `autoFinishSetupMarginNs` (0..0.05, default 0.01)
- Tests: `flow/tests/test_integration_recovery.py` and `flow/tests/test_adapters.py`

**Interfaces — Produces:**
- `replay-request.autoFinish = {"enabled": bool, "holdTargetNs": 0.0, "setupTargetNs": 0.0, "holdMarginNs": m_h, "setupMarginNs": m_s, "protect": [<instances touched by the batch>]}`.
- `integration-state.autoFinish = {"preDump": {path,sha256}, "postDump": {path,sha256}, "delta": delta, "eco": {"netlist": {path,sha256}, "physical": {path,sha256}}}`, or `null`.
- `merge-commit.autoFinish` is the same value, covered by the merge-commit id.

- [ ] **Step 1: RED tests.**
  - `prepare_replay` with `autoFinish.enabled` lists the union of the batch's touched instances in `protect`.
  - The replay Tcl rendered by `compile_xtop_replay_task` contains, after the last step and in this order:
    1. `set_dont_touch` on each protected instance;
    2. `atcs_dump_cells` → `pre-autofinish.dump`;
    3. `fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin <m_s>`;
    4. `fix_setup_gba_violations -methods size_cell|insert_buffer -effort high -setup_target 0.0 -hold_margin <m_h>`;
    5. `atcs_dump_cells` → `post-autofinish.dump`;
    6. `write_design_changes -format INNOVUS -eco_file_prefix atcs_autofinish -output_dir <dir> -keep_route`.

    The command strings are copied from `packs/xtop-timing-closure/flow/closure.py:684-690`.
  - `reconcile`:
    - a `post-autofinish` delta that changes a protected instance → `replayMismatch` names it;
    - missing ECO files → `integration-state.autoFinish` fails closed (`AtcsError("missing-input")`);
    - it refuses an ECO file that contains `FORMATVERSION`, `dbNetFreeWires` or `editDelete -net` (the same rule as old `validate_sourceable_eco`).
  - `seal_batch` with auto-finish → the merge-commit id changes when an ECO byte changes.
  - `compile_innovus_eco_task` with `merge.autoFinish`:
    - sources the netlist ECO, then the physical ECO, and **not** the typed `innovusEcoTcl`, because the XTop export already contains the replayed typed operations;
    - then `setNanoRouteMode -routeWithEco true …` and `ecoRoute`.
  - Without auto-finish, the Innovus task is unchanged.
- [ ] **Step 2:** Run and confirm FAIL.
- [ ] **Step 3: Implement** as specified. `autoFinish.enabled = false` reproduces today's behaviour exactly.
- [ ] **Step 4:** Run GREEN, then the full Pack suite and the ATCS contract test.
- [ ] **Step 5:** Get a review (Opus: it touches sealed identity). Commit `feat(atcs): auto-finish the bulk after the manual tail repair in one replay`; push.

## Task 7: Offline vertical acceptance (plan T18, on fixtures)

**Files:** `flow/tests/test_vertical_acceptance.py` (new).

- [ ] **Step 1:** Write a test that drives the CLI end to end on synthesized fixtures:
  - three work packages with disjoint domains;
  - w01 and w02 contributions that are complementary;
  - w03 contribution sharing a precondition with w01, then a `revise:<id>` resolution;
  - a replay with stubbed receipts and stubbed auto-finish dumps and ECO files;
  - one merge commit;
  - an Innovus task that sources the auto-finish ECO pair.

  Assert:
  - one merge commit whose `contributions` lists w01, w02 and revised w03;
  - `autoFinish.delta` present;
  - exactly one implement task;
  - `sourceMap` covers every typed op.
- [ ] **Step 2:** Run, GREEN (it exercises Tasks 3–6). Commit `test(atcs): three-worker tail-first batch with auto-finish seals one refresh`; push.

## Task 8: Identity — Pack 0.2.0, wrapper v10, binding

- [ ] Bump the Pack to 0.2.0.
- [ ] Compute the new adapter SHA-256 and `flow-digest`.
- [ ] On the server, derive `operator-admin/atcs-v10/` from the **installed** v9 by `sed` of the paths, `adapter_sha256` and `flow_digest`. Show the diff against installed v9, and confirm `grep REPLACE` finds comments only.
- [ ] Qualify with the wrapper's own preflight:
  - a positive run on a qualification copy after a native `prepare-workers` on 0.2.0;
  - a negative run on 0.1.10, which must refuse at the adapter check.
- [ ] Repo: add the `atcs-xtop-operator-v10.sh` template and environment template, update the Permit and contract to v10, and update the README. Run the contract test, commit and push.

## Task 9: Server chain dry run on real `postroute_final` (no GUI, no model)

- [ ] Extend `qual-tools/baseline-dryrun.sh` into `chain-dryrun.sh`. It runs bind-inputs → baseline → observe → policy → physical → risk → residual, then `prepare-workers` with a hand-written three-slot plan that covers real tail clusters. The plan is taken from `residual-cases.json`, using full hierarchical paths.
- [ ] Then run a real XTop Operator-equivalent batch session per slot. It uses the Operator Tcl procedures non-interactively on a qualification copy, applying the same reviewed actions that `atcs_size_cell`/`atcs_insert_buffer` would. Then run `capture-contribution` × 3 → `collect` → `compose-facts` → an admitted plan → `replay-prepare` with auto-finish → `reconcile` → `presta` → `implement` → `extract` → `sta` → `evaluate`.
- [ ] Record per stage the exit code, time and the PrimeTime WNS, TNS and violation counts, against baseline and against the old flow's round 1 and round 2. Pass: all stages exit 0 and the refreshed PrimeTime is reader-backed.
- [ ] If the XTop `write_design_changes` export does not contain the replayed typed operations, which Task 6 assumes, switch Task 6 to "typed `innovusEcoTcl` then the auto-finish ECO with only post-snapshot changes". Use `write_design_changes` after `save_workspace` / `-last_n` per `knowledge/xtop-capabilities.md`, and add a RED test for it.

## Task 10: One live Campaign, judged against the serial flow

- [ ] Build the kit with `kit.mjs`: Pack 0.2.0, binding v10, all preflights ok.
- [ ] Guide request:
  - Goal WNS 0 / 0, post-route only.
  - Time box 180 min, 2 generations.
  - Strategy: `workerSlots` 3, `autoFinish` 1.
  - Progress judged by PrimeTime only.
- [ ] Watch with `watch.py` and a UI check each cycle.
- [ ] Report against the §1.5 table. Update Issue #63 with the result: PASS, or an honest miss with the measured gap and the next lever (§5).

---

## 4. Acceptance

The Campaign must meet all of these, from reader-backed PrimeTime on implemented DBs with new SPEF:

| # | Criterion |
| --- | --- |
| A1 | At most 2 refreshes to the reported result. |
| A2 | Hold WNS better than −0.15 ns and setup WNS better than −0.038 ns in every required scenario (the serial flow stalled at −0.16 / −0.04). |
| A3 | ssg_m40 hold TNS no worse than −4.10 ns, and setup TNS no worse than −0.12 ns. |
| A4 | Wall time from Run start to the second refreshed PrimeTime result ≤ 120 min. |
| A5 | No new signal DRC from `ecoRoute`; connectivity no worse than the baseline. |
| A6 | Identity errors 0; required scenarios complete. |

## 5. Levers after acceptance (not in this plan)

- **Refresh time**, now ~20 min dominated by StarRC at 592 s: extract both corners in one run, or concurrently, and run PrimeTime multi-scenario in one session.
- **Concurrent XTop Operator sessions** across slots, once interactive admission inside fork branches is proven.
- **Dynamic batch sealing** before every slot finishes (SPEC Constraint 7).

## Self-review

- **Coverage:** the user's asks map to tasks.
  - Multiple workers → Tasks 1 and 5.
  - Analysis → Task 4 (tail clusters and recipes).
  - Manual fixes → Tasks 2 and 3 (ordered multi-edit).
  - Big troubles first → Task 4 (the worst check must be targeted; tail before bulk).
  - Auto-fix to finish → Task 6.
  - Faster and better than serial → §1 and §4, proven by Tasks 9–10.
- **Harness changes:** limited to Tasks 1 (conditional) and 2, both generic.
- **Unverified assumptions, each with a test and a fallback:**
  - Workshops inside forks → Task 1.
  - What `write_design_changes` includes → Task 9.
