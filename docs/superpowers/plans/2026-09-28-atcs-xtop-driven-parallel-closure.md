# ATCS Upgrade: Parallel XTop Expert Operators, Blockers First, Auto-Finish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the smallest change to the tested Pack (0.1.10, main `e7c71927`) so that ATCS closes post-route timing much faster, and better, than repeated plain auto-fix iterations. The work per generation:

1. Up to six worker Operators run at the same time. Each is an XTop expert on one blocker cluster.
2. Each Operator analyzes, tries XTop manual ECOs and targeted fixes, reads XTop's fix gain, undoes what does not help, and keeps what does.
3. All kept repairs are replayed into one XTop session.
4. XTop global auto-fix finishes everything else.
5. One Innovus → StarRC → PrimeTime refresh verifies the result.

**Architecture:** Keep everything built and proven on real data:
- slot workspaces (M2), Contributions (M3) and composition (M4);
- replay and merge commit (M5), refresh and evaluation (M6), and adoption (M7);
- the Team (Researcher → Reviewer → Operator) and the Site wrapper.

Change five things:

| # | Change | Where |
| --- | --- | --- |
| 1 | The Operator's authority becomes a reviewed **scope** (edit domain, allowed XTop commands, mutation budget) instead of one pinned action | one small generic Harness change |
| 2 | An XTop **expert toolkit** in the Operator session: XTop manual ECO, candidate lists, targeted `fix_*`, gain readout and undo, all domain-confined and traced | Pack Tcl |
| 3 | Slots w01..w06 run **in parallel** through the existing Harness fork | graph; a generic Harness fix only if the spike shows interactive Jobs cannot run in fork branches |
| 4 | A **blockers-first** plan | plan Workshop, Reader and knowledge |
| 5 | **Auto-finish** at the end of the replay, exported as one Innovus ECO | the old flow's qualified path |

**Tech Stack:**
- Pack: Python 3.9 stdlib (`unittest`) and Tcl for XTop/Innovus/StarRC/PrimeTime.
- Harness: TypeScript, with contract tests on Node 24.
- XTop knowledge pack: `/Users/lluzi/Documents/linglong setup/xtop_knowledge.zip` (XTop 2025.09.tmp15: 388 commands, 112 fail reasons, manual-ECO and strategy chapters).

---

## 1. First principles: why this is much faster than repeated auto-fix

### 1.1 One refresh costs the same regardless of batch size

Measured on `postroute_final` in Run `run-1ca6cdd3`:

| Step | Time |
| --- | --- |
| Innovus ECO + `ecoRoute` | 452 s |
| StarRC, 2 corners | 592 s |
| PrimeTime, 4 scenarios | 109 s |
| **One refresh** | **≈ 20 min** |
| One XTop session | ≈ 100 s |

So closing time is **T ≈ G × (T_operators + 20 min)**, where G is the number of refreshes. Getting faster means:
- fewer refreshes, each carrying far more verified-in-XTop improvement;
- operator time in parallel, not in series.

### 1.2 Goal = worst slack; plain auto-fix removes the bulk, then stalls on blockers

The serial flow's own record on this design (`packs/xtop-timing-closure/knowledge/source-flow.md` §9), plus B_lazy Run `ddabd488`:

| Round / Run | What happened |
| --- | --- |
| Round 1 | Hold violations 7,430 → 148. 2,908 cells inserted, 919 resized. |
| Round 2 | Hold WNS −0.154 → −0.154 and setup WNS −0.0383 → −0.0383 (XTop estimate). PrimeTime measured hold at −0.16. |
| B_lazy `ddabd488` | 0 endpoints fixed. |

Each extra no-brainer round buys another 20-minute refresh without moving WNS.

### 1.3 Blockers need an expert in the loop

The XTop knowledge says two things directly:
- "Auto-fix is an executor, not a strategy."
- The 112 fail reasons are XTop's strategy feedback.

A blocker is an endpoint auto-fix cannot close, for example:
- `break_setup` on a hold path;
- `legal_fail_no_space_on_row`;
- `no_hold_gain`;
- a cross-hierarchy net;
- a high-fanout net.

It needs an expert loop inside XTop:
1. Diagnose: `analyze_*_path_violations`, `get_paths`, `report_fail_reasons`.
2. List candidates: `list_size_cell_candidates`, `list_insert_buffer_candidates`.
3. Trial manual ECO: `size_cell`, `exchange_cell`, `insert_buffer`, `insert_dummy_cell`, `split_load`, `split_net`, `move_cell`, `remove_buffer`.
4. Or a targeted fix with the right option: `fix_hold_gba_violations -only_pins … -fix_timing_window | -max_cluster_loader_count 4 | -use_dummy_cell`.
5. Read the fix gain immediately: `summarize_gba_violations -with_delta` against the session reference.
6. `undo` if there is no gain.

XTop's incremental timing makes each trial cost seconds, not a 20-minute refresh. Blocker clusters that share no cells, nets or timing windows are independent, so six experts work on six clusters at once.

### 1.4 Order: blockers first, auto-fix last, in one session

- Global auto-fix first consumes placement space and setup margin near the blockers. Round 1 inserted 2,908 buffers; that is the over-fixed `xtop_round2_eco_route`.
- Expert repairs first, locked with `set_dont_touch`, then global auto-fix for the rest, all replayed in one XTop session, puts blockers and bulk into one refresh.

### 1.5 Prediction and acceptance

- Generation 1, in one refresh: the serial round-1 bulk result plus the blockers round 2 could not move.
- Generation 2: the residual blockers, starting from real fail reasons.

Acceptance (§4, refreshed PrimeTime only):
- the serial flow's best after 2 refreshes: −0.16 hold / −0.04 setup, then it stalls;
- this plan: hold better than −0.15 and setup better than −0.038 in every scenario, within 2 refreshes and 120 min.

## 2. Global Constraints

- **Pack version and scope.** Pack 0.1.10 → **0.2.0**, in `contract.yml` (quoted, line 2), `graph.yml` and the contract-test regex. Fix priority: Pack → Site → generic Harness seam.
- **Harness changes.** Only these:
  - Task 1: reviewed scope (required).
  - Task 2: interactive Jobs in fork branches, only if the spike fails.

  Each must be generic, have a contract-level RED/GREEN test, get an independent Opus review, and pass `pnpm run check:boundary`.
- **Frozen.** `packs/xtop-timing-closure/` and `sites/linglong-swerv28/`.
- **XTop surface.** Only commands and options present in the knowledge pack's `command_surface.tsv` / `man_catalog.tsv`.
- **Out of scope for this upgrade.** Clock ECO, useful skew, `commit_rank_pin_candidate`, `adjust_path_slack`, `enlarge_timing_violations`, post-mask and PBA path fix (knowledge §10, not qualified).
- **Python.** Stdlib 3.9. Tests: `cd packs/agentic-timing-closure-system/flow && python3 -m unittest discover -s tests`.
- **Fail closed.** Convergence is claimed only from refreshed PrimeTime on the implemented DB with new SPEF. XTop gain is used only to screen candidates.
- **Server.**
  - `empyrean-license status` must be `old`; never switch it.
  - Write only `atcs-runs/qual-*`, `qual-tools/` and new `operator-admin/atcs-vN/`.
- **Wrapper v10.**
  - Derive it on the server from **installed** v9.
  - Diff it against installed v9.
  - `grep REPLACE` must hit comments only.
  - Its own preflight must pass on the new flow and refuse the old flow at the adapter check.
  - `kit.mjs` `wrapper-pins-pack-flow` must pass.
- **Commits.** `git push origin HEAD:main` after each commit and verify the SHA. The message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Node.** `export PATH="$HOME/.local/node24/bin:$PATH"`.
- **Live Campaigns.** None until Task 7 passes on real `postroute_final`.

## 3. File map

| File | Change |
| --- | --- |
| `packages/harness/src/packs.ts`, `index.ts`, `delegation.ts` | `reviewedAction.mode: "scope"` (Task 1). |
| `packages/harness/src/forks.ts` | Only if the Task 2 spike fails. |
| `test/contract/delegation-team-settlement.host.test.ts`, `test/contract/fork-join.test.ts` | Harness RED/GREEN. |
| `packs/.../knowledge/xtop-expert-operator.md` (new) | Expert loop, ladders, fail-reason → move table, gain reading, undo discipline, blockers vs bulk. |
| `packs/.../flow/templates/xtop-operator.tcl` | Expert toolkit procs, domain guard, op/gain log. |
| `packs/.../contract.yml` | Interactive commands; Teams `atcs-worker-01..06` v4 (reviewer returns a scope; operator scope mode); knobs `workerSlots` 1..6 and `autoFinish`; Workshop purposes. |
| `packs/.../flow/atcs/workspaces.py` | Slots `w01..w06`; work package `scope{commands[], maxMutations}` and `targetPins[]`. |
| `packs/.../tools/read-atcs.py` | Worker request with the scope schema; campaign plan with disjoint domains and blockers first. |
| `packs/.../flow/atcs/contributions.py`, `atcs_cli.py` | `xtop-session` Contribution (net command log after undo, dump delta, gain, fail reasons). |
| `packs/.../flow/atcs/composition.py` | Overlap conflicts for session deltas. |
| `packs/.../flow/atcs/integration.py`, `templates/xtop-replay.tcl`, `adapters.py`, `templates/innovus-eco.tcl` | Replay the kept command logs, then auto-finish, then one `write_design_changes -format INNOVUS -keep_route`, then `source` the pair, then `ecoRoute`. |
| `packs/.../graph.yml` | Fork `prepare-workers` → six branches (research → read request → check → operate → capture → read result) → join → `collect`. |
| `sites/linglong-atcs28/*` | v10 wrapper and environment templates, Permit, README; `parallelJobs` 6 and `xtop` licences 6. |

---

## Task 1: Harness — reviewed scope instead of one pinned action

**Why:** `index.ts:1036-1052` takes one `{command, arguments}` from the Reviewer, and `index.ts:882-891` refuses any other mutation. An expert cannot try, measure and undo under that rule.

**Interfaces — Produces:**
- Schema: `reviewedAction.mode: "action" | "scope"` (default `"action"`, so every existing Pack is unchanged).
- In `"scope"` mode:
  - the Reviewer result carries `scope: {commands: string[], maxMutations: int}`;
  - `commands` ⊆ the tool's `interactive.commands.mutate`;
  - `maxMutations` is between 1 and the recipe's `maxMutations` cap (schema field, 1..200);
  - the Host stores `inlinePayload.scope` plus `planSha256`.
- Operator enforcement:
  - a mutation is accepted iff its command ∈ `scope.commands`, its `planSha256` argument equals the plan hash, and fewer than `maxMutations` mutations were accepted in this `toolSessionId` (counted from the Ledger);
  - otherwise it is refused with a reason;
  - read commands are unaffected.
- Domain confinement stays in the Pack Tcl: each typed proc checks the edit domain, as today.

- [ ] **Step 1: RED tests** (reuse the Team fixture in `delegation-team-settlement.host.test.ts`):
  1. Scope `{commands:[size, insert], maxMutations: 3}`: size, insert, size are accepted; a fourth mutation is refused.
  2. A mutation of a command outside the scope → refused.
  3. A wrong `planSha256` → refused.
  4. Reviewer `maxMutations` above the recipe cap → adoption refused.
  5. The existing `"action"` mode tests and `interactive-eda.host.test.ts` are unchanged and pass.
- [ ] **Step 2:** Run them and confirm FAIL.
- [ ] **Step 3: Implement.**
  - `packs.ts` schema and validation: each scope command must be a mutate command with the hash argument.
  - `index.ts` build (1036-1052) and enforcement (882-891).
  - `delegation.ts` types.
  - The `"action"` path stays byte-identical.
- [ ] **Step 4:** GREEN; `pnpm run check:boundary`.
- [ ] **Step 5:** Independent Opus review of the diff package. Commit `feat(harness): a Team reviewer may approve an operator scope`; push; verify.

## Task 2: Spike — six concurrent worker branches with interactive XTop Teams

**Why:** `forkFrom` (`packs.ts:2411-2447`) accepts branches of `act` nodes joined at one judge, and `forks.ts:107-127` drives them concurrently. ATCS Workshops, Readers and the interactive operate node are all `act` nodes. The workers' check judge moves after the join (Task 5). `FABRIC.md:110` records interactive admission inside branches as runtime-unproven.

- [ ] **Step 1: RED/GREEN test** in `test/contract/fork-join.test.ts`. The fixture Pack forks into two branches, each `workshop → reader → interactive tool (Team with scope) → capture tool`, joined at one judge. Use the existing interactive REPL fixture (`test/fixtures/interactive-job/atcs-repl.tcl`). Assert:
  - both interactive Jobs are open at the same time;
  - each Team's delegations belong to its own execution;
  - the join waits for both captures;
  - the Site `parallelJobs: 2` cap holds.
- [ ] **Step 2:**
  - **If it passes:** record "concurrent interactive branches: proven" in `FABRIC.md`.
  - **If it fails:** make the smallest generic fix in `forks.ts` / `interactive-runtime.ts` so a branch's interactive open follows the same admission as the main cursor. Write the RED test first and get an Opus review.
- [ ] **Step 3:** Commit and push.

## Task 3: XTop expert toolkit in the Operator session

**Files:** `flow/templates/xtop-operator.tcl`, `contract.yml` (interactive `commands.read` / `commands.mutate`), `flow/tests/test_adapters.py`, contract test.

**Interfaces — Produces:** typed procs. Every mutation proc does the same four things:
- refuses an object outside the session's edit domain;
- refuses once `maxMutations` is reached;
- appends one JSON line to `ops.jsonl`: `{seq, cmd, args, before, after}`, with the XTop return;
- appends the XTop gain (`summarize_gba_violations -setup/-hold -with_delta`, against a reference captured at session start) to `gain.jsonl`.

| Kind | Proc | XTop command |
| --- | --- | --- |
| read | `atcs_ref` | `summarize_gba_violations -setup|-hold -as_reference` (once) |
| read | `atcs_gain` | `summarize_gba_violations -with_delta -with_top_n N -with_fail_reason` |
| read | `atcs_paths` | `get_paths` / `analyze_setup_path_violations -top N -detail_info` / `analyze_hold_path_violations …` |
| read | `atcs_fail_reasons` | `report_fail_reasons -stats -verbose -pins …`, `get_failed_pins -reasons …` |
| read | `atcs_candidates` | `list_size_cell_candidates`, `list_insert_buffer_candidates`, `list_exchange_cell_candidates` |
| mutate | `atcs_size_cell` | `size_cell` |
| mutate | `atcs_exchange_cell` | `exchange_cell` |
| mutate | `atcs_insert_buffer` | `insert_buffer` (sink-side chains included) |
| mutate | `atcs_insert_dummy` | `insert_dummy_cell` |
| mutate | `atcs_split_load` | `split_load` |
| mutate | `atcs_split_net` | `split_net` |
| mutate | `atcs_move_cell` | `move_cell` |
| mutate | `atcs_remove_buffer` | `remove_buffer` |
| mutate | `atcs_fix_hold_pins` | `fix_hold_gba_violations -only_pins <domain pins> …` (options whitelist: effort, hold_target, setup_margin, size_cell_only, use_dummy_cell, fix_timing_window, max_cluster_loader_count 1..6, max_delay_cell_length 0..5 + delay_cell_list) |
| mutate | `atcs_fix_setup_pins` | `fix_setup_gba_violations -only_pins <domain pins> …` (methods ⊆ {size_cell, insert_buffer, split_net}, remove_buffer_only, size_down_only, setup_target, hold_margin) |
| mutate | `atcs_undo` | `undo`; logged as an undo of the last kept mutation |

The last three rows (`atcs_fix_hold_pins`, `atcs_fix_setup_pins`, `atcs_undo`) are the mutations that act as targeted fixes and undo. Exact command names and options come from `command_surface.tsv`; the implementer verifies each against the installed man page and records the page path in `xtop-expert-operator.md`. Every mutation takes `planSha256`. New cell and net names use the workspace `namePrefix`.

- [ ] **Step 1: RED tests.**
  - The rendered Tcl defines every proc.
  - Each mutation proc checks the domain before calling XTop and logs `ops.jsonl` plus `gain.jsonl`.
  - `atcs_undo` logs `{"cmd":"undo","undoes":<seq>}`.
  - A `fix_*_pins` proc builds only whitelisted flags and refuses `fix_timing_window` + `size_cell_only`.
  - Contract: the read and mutate lists match the table.
- [ ] **Step 2:** Confirm FAIL. **Step 3:** Implement. **Step 4:** GREEN.
- [ ] **Step 5:** Review (Opus: it is the confinement surface). Commit `feat(atcs): XTop expert toolkit for worker operators`; push.

## Task 4: Expert knowledge, scope plan and `xtop-session` Contributions

**Files:**
- `knowledge/xtop-expert-operator.md` (new)
- `flow/atcs/workspaces.py` (slots w01..w06; `scope`, `targetPins`)
- `tools/read-atcs.py`
- `contract.yml`: Teams 01..06 v4; researcher and reviewer templates. The reviewer returns `{scope:{commands,maxMutations}, planSha256}`. The operator template is the expert loop in the knowledge file. `followup: reuse-same-child` with `maxFollowups: 1` stays for the researcher and reviewer.
- `flow/atcs/contributions.py`, `atcs_cli.py` capture, `flow/atcs/composition.py`
- Tests: `test_knowledge.py`, `test_workspace_isolation.py`, `test_readers.py`, `test_contribution_replay.py`, `test_composition.py`

**Knowledge file** (≤ 180 lines, four headings):
- **The expert loop:**
  1. `atcs_ref`;
  2. diagnose with paths, fail reasons and the analyze commands;
  3. choose from the ladders;
  4. trial;
  5. `atcs_gain`;
  6. keep, or `atcs_undo` if the target slack did not improve or the opposite check broke;
  7. stop at the budget or when no candidate gains.
- **Hold ladder:** size down → dummy → delay/buffer chain → loader clustering → timing window.
- **Setup ladder:** remove buffer → size → buffer → split net → size down off-path.
- **Target/margin pairing.**
- **The fail-reason → move table.**
- **Blockers vs bulk:** blockers are endpoints whose fail reasons are not "no violation left"; the bulk goes to auto-finish.
- **Counterexample:** global high effort before blockers over-fixed round 2.

**`xtop-session` Contribution:**

| Field | Content |
| --- | --- |
| `commands` | The net kept command log: undone entries removed, order kept. |
| `delta` | Before/after dumps. |
| `predicted` | The last gain line, as Measures. |
| `failReasons` | Counts per reason. |

It is admissible iff all four hold:
- both dumps exist;
- replaying the kept `commands` delta equals the dump delta for the typed kinds (size/exchange/insert/remove), with `fix_*_pins`, split and move accepted from the dump delta;
- predicted target slack did not worsen;
- no out-of-domain object.

- [ ] **Step 1: RED tests** for each rule above:
  - a session with an undone insert → the net log excludes it;
  - a negative gain → refusal `no-predicted-gain`;
  - an out-of-domain change in the dump → `outOfScope`;
  - two sessions changing the same instance → conflict `shared-instance`;
  - a scope `commands` outside the Task 3 mutate list → Reader invalid;
  - slot `w06` accepted, `w07` refused.
- [ ] **Step 2:** Confirm FAIL. **Step 3:** Implement. **Step 4:** GREEN.
- [ ] **Step 5:** Review (Opus). Commit `feat(atcs): expert operator scope and XTop session contributions`; push.

## Task 5: Graph — six parallel workers, blockers first

**Files:** `graph.yml` (nodes w04..w06 copied from w01..w03), `contract.yml` (knob `workerSlots` 1..6, default 6; `plan-campaign` purpose), `tools/read-atcs.py` (`_read_campaign_plan`), tests, `FABRIC.md`.

- [ ] **Step 1: RED tests.**
  - **Campaign plan Reader:**
    - overlapping `targetPins` instances across slots → invalid;
    - the worst check of any required scenario not in some slot → invalid (blockers first);
    - parked slots admitted.
  - **Contract:** `prepare-workers` forks into six branches, each:
    - `research-worker-0N` → `read-worker-request-0N` → `operate-worker-0N` → `capture-worker-0N` → `read-worker-result-0N`;
    - joined at judge `check-worker-results`.

    Then `check-worker-results` → `collect`. A parked or invalid slot's operate node is a no-op: the Reader-admitted parked request makes capture record a `parked` no-fix, so every branch stays a pure act chain as `forkFrom` requires.
- [ ] **Step 2:** Confirm FAIL. **Step 3:** Implement. If Task 2 failed and was not fixed, use the sequential chain of the same nodes. **Step 4:** GREEN.
- [ ] **Step 5:** Review. Commit `feat(atcs): six parallel blocker-first worker branches`; push.

## Task 6: One replay — kept expert repairs, then auto-finish, then one Innovus ECO

**Files:** `flow/atcs/integration.py`, `flow/templates/xtop-replay.tcl`, `flow/atcs/adapters.py`, `flow/templates/innovus-eco.tcl`, `flow/atcs_cli.py`. Tests: `test_integration_recovery.py`, `test_adapters.py`.

- [ ] **Step 1: RED tests.** The replay Tcl does, in order:
  1. `000.dump`;
  2. per selected `xtop-session` Contribution, in composition order: its kept `commands` through the same procs, then `NNN.dump`;
  3. `set_dont_touch` on every instance those sessions changed;
  4. if `autoFinish`:
     - `fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin <m_s>`;
     - `fix_setup_gba_violations -methods size_cell|insert_buffer -effort high -setup_target 0.0 -hold_margin <m_h>` (strings from `packs/xtop-timing-closure/flow/closure.py:684-690`);
     - `auto.dump`;
  5. `write_design_changes -format INNOVUS -eco_file_prefix atcs_batch -output_dir eco -keep_route`.

  Beyond that sequence:
  - `reconcile`:
    - a missing ECO pair → `missing-input`;
    - a `FORMATVERSION`, `dbNetFreeWires` or `editDelete -net` line → refused;
    - a session replay delta differing from its Contribution delta → a recorded `replayMismatch` warning;
    - auto-finish changing a protected instance → mismatch.
  - `seal_batch` covers the ECO pair hashes and the per-session and auto deltas.
  - `compile_innovus_eco_task` with `merge.eco` does `source` netlist, `source` physical, `setNanoRouteMode -routeWithEco true …`, `ecoRoute`. Without it, output is byte-identical to today.
- [ ] **Step 2:** Confirm FAIL. **Step 3:** Implement. **Step 4:** GREEN.
- [ ] **Step 5:** Review (Opus). Commit `feat(atcs): replay expert repairs then auto-finish into one Innovus ECO`; push.

## Task 7: Identity, then a server chain dry run on real `postroute_final`

- [ ] Pack 0.2.0.
- [ ] Wrapper v10 (§2) with its own preflight.
- [ ] Site: `parallelJobs: 6`; `licences.xtop: 6`. Innovus, StarRC and PrimeTime stay 1, since refresh is serial in this plan.
- [ ] Binding. Contract test. Commit and push.
- [ ] `qual-tools/chain-dryrun.sh` on a qualification copy:
  1. baseline chain;
  2. a hand-authored 3-slot blockers-first plan from the real `residual-cases.json`;
  3. per slot, a non-interactive XTop session that runs a short scripted expert sequence through the Task 3 procs: ref → paths → candidates → one manual ECO → gain → undo → one `atcs_fix_hold_pins` → gain;
  4. capture ×3;
  5. collect → compose-facts;
  6. an admitted plan;
  7. replay with auto-finish;
  8. reconcile → presta → implement → extract → sta → evaluate.
- [ ] Record per stage the exit code, time, the XTop gain lines and fail reasons, and the refreshed PrimeTime per scenario, against the baseline and against serial rounds 1–2.
- [ ] **Pass:** every stage exits 0 and the PrimeTime result is reader-backed.
- [ ] If `write_design_changes` after replay duplicates or omits changes: export per session with `-last_n`, add a RED test, and redo this task.

## Task 8: One live Campaign against the serial flow

- [ ] Build the kit with `kit.mjs`: Pack 0.2.0, binding v10, all preflights.
- [ ] Guide request:
  - Goal WNS 0 / 0, post-route only;
  - 180 min, 2 generations;
  - `workerSlots` 6, `autoFinish` 1;
  - PrimeTime-only judgement.
- [ ] Watch with `watch.py` plus a UI check each cycle.
- [ ] Report against §4 and update Issue #63.

---

## 4. Acceptance

All on reader-backed PrimeTime, implemented DBs, new SPEF:

| # | Criterion |
| --- | --- |
| A1 | At most 2 refreshes. |
| A2 | Hold WNS better than −0.15 ns and setup WNS better than −0.038 ns in every required scenario. |
| A3 | ssg_m40 hold TNS no worse than −4.10 ns, and setup TNS no worse than −0.12 ns. |
| A4 | Run start to the second refreshed PrimeTime result in ≤ 120 min. |
| A5 | No new signal DRC from `ecoRoute`; connectivity no worse than baseline. |
| A6 | Identity errors 0; required scenarios complete. |

## 5. Next levers (not in this plan)

- PBA path fix (`fix_*_path_violations`) for the last residuals.
- Density relief before hold insertion when `legal_fail_*` dominates.
- A parallel refresh: multi-corner StarRC and multi-scenario PrimeTime.
- PrimeTime refine/revert (`utilities/post_verification/`) before implementation.

## Self-review

- **Coverage of the brief:**

  | Brief | Where |
  | --- | --- |
  | Parallel agents (6 seats; XTop unlimited) | Tasks 2 and 5 |
  | Operator as an XTop expert: analysis, trial, manual ECO, gain, undo | Tasks 1, 3, 4 |
  | Blockers first | Tasks 4–5 |
  | Auto-fix for the rest | Task 6 |
  | Faster and better than no-brainer iterations | §1, §4, Tasks 7–8 |

- **Minimal change:**
  - One generic Harness change (scope mode), plus a conditional fork fix.
  - The rest reuses slots, Teams, composition, replay, refresh and adoption.
  - New surface: the operator toolkit, one Contribution kind, the replay and implement ends from the old qualified flow, six branches, and one knowledge file.
- **Unverified, each with a test and a fallback:**
  - interactive Jobs in fork branches (Task 2);
  - `-only_pins` targeted fixes and the manual ECO commands on SWERV28 (Task 7);
  - `write_design_changes` after replay (Task 7).
