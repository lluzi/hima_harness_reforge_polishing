# ATCS Upgrade: XTop-Driven Parallel Tail-First Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With the smallest change to the tested Pack (0.1.10, main `e7c71927`), make ATCS close post-route timing in fewer refreshes and less time than the serial XTop auto-fix loop:
- three workers each diagnose one worst-timing cluster and steer XTop to fix it;
- XTop's own fail reasons drive the next choice;
- one XTop replay applies all workers' passes plus a global auto-finish;
- one Innovus → StarRC → PrimeTime refresh verifies each generation.

**Architecture:** Change only the worker's *vocabulary* and the replay/implement ends. Everything built and proven on real data stays:
- the three-slot workspaces;
- the Team (Researcher → Reviewer → Operator);
- capture, collect, composition and the integration plan;
- the replay session, the refresh and evaluation, and adoption.

The Operator's reviewed action changes from "one hand edit" to "one XTop strategy pass": whitelisted `fix_*` commands with options, scoped by `-only_pins` to the worker's target pins. The old Pack already qualified this pattern on this Site: `hima_apply_action` running `fix_*_gba_violations`, then `write_design_changes -format INNOVUS -keep_route`, then `source` the pair, then `ecoRoute`. **No Harness change.**

**Tech Stack:**
- Pack: Python 3.9 stdlib (`unittest`), Tcl for XTop, Innovus, StarRC and PrimeTime, and YAML.
- Tests: Node 24 contract tests.
- Knowledge source: `/Users/lluzi/Documents/linglong setup/xtop_knowledge.zip` (XTop 2025.09.tmp15 strategy map, command surface, 112 fail reasons).

---

## 1. First principles: why this closes faster

1. **A refresh has a fixed cost.**
   - Measured on `postroute_final` (Run `run-1ca6cdd3`): Innovus ECO + `ecoRoute` 452 s, StarRC over 2 corners 592 s, PrimeTime over 4 scenarios 109 s. That is about 20 min per refresh, whether it carries 1 change or 3,000.
   - An XTop session is about 100 s. Agent turns were about 75 of the Run's 106 min.
   - So **T_close ≈ G × (T_research + T_xtop + 20 min)**. Speed comes from:
     - few generations G;
     - research off the critical path;
     - never refreshing a batch that cannot move the goal.
2. **The goal is WNS, a tail property. XTop's global auto-fix is a bulk tool.** The serial flow's measured record on this design (`packs/xtop-timing-closure/knowledge/source-flow.md` §9):
   - Round 1 took hold violations from 7,430 to 148 (−98%). It inserted 2,908 cells and resized 919.
   - Round 2 left hold WNS at −0.154 and setup WNS at −0.0383 (XTop estimate); PrimeTime then measured hold at −0.16.
   - B_lazy Run `ddabd488` fixed 0 endpoints.

   Serial rounds spend 20-minute refreshes re-attacking a tail that one global strategy cannot fix.
3. **The tail needs a different XTop strategy per cause, and XTop reports the cause.** The XTop knowledge says: "Auto-fix is an executor, not a strategy". Diagnose why there is no candidate, or why candidates fail, then pick the method. Its 112 fail reasons are the strategy feedback API:

   | Fail reason | Next strategy |
   | --- | --- |
   | `break_setup` | `-fix_timing_window` (low effort), or a different margin |
   | `legal_fail_no_space_on_row` | density relief, or `-max_cluster_loader_count` |
   | `no_*_gain` | a different method or scope, not more effort |
   | tiny hold | `-use_dummy_cell` |
   | redundant chain | `-remove_buffer_only` |
   | off-path load | `-size_down_only` |

   Clusters with different causes need different passes. Those are independent decisions, so three workers research them in parallel.
4. **Order: targeted tail passes first, the global bulk pass last, in one session.** Global auto-fix first consumes the placement space and setup margin the tail needs: 2,908 inserts in round 1, and the over-fixed `xtop_round2_eco_route`. Targeted `-only_pins` passes on the worst clusters first, then the global GBA passes finishing the bulk in the same XTop replay, give one refresh per generation covering tail and bulk.
5. **XTop's feedback closes the loop cheaply.** Each worker pass reports XTop-estimated gain (`summarize_gba_violations -with_delta`) and fail reasons. So:
   - a pass with no estimated gain is dropped before any refresh;
   - the next generation's Researcher starts from real fail reasons, not a guess.

**Acceptance** (§4; refreshed PrimeTime only): the serial flow's best was −0.16 hold / −0.04 setup after 2 refreshes, then it stalled. This plan must reach hold better than −0.15 and setup better than −0.038 in at most 2 refreshes, within 120 min.

## 2. Global Constraints

- **Version and change scope.**
  - Pack version 0.1.10 → **0.2.0** in `contract.yml` (quoted, line 2), `graph.yml` and the contract-test regex.
  - Pack and Site changes only. **No change under `packages/`.**
  - `packs/xtop-timing-closure/` and `sites/linglong-swerv28/` are frozen; copy qualified command strings from them.
- **XTop commands.** Only commands present in `command_surface.tsv` / `man_catalog.tsv` of the knowledge pack, with the exact option names listed there.
- **Mutating pass whitelist.** Exactly:
  - `fix_hold_gba_violations`
  - `fix_setup_gba_violations`
  - `fix_transition_violations -check_timing_margin`
- **Diagnostic commands.** Non-mutating:
  - `summarize_gba_violations` (incl. `-with_top_n N -with_fail_reason`)
  - `report_fail_reasons -stats -verbose`
  - `get_failed_pins`
  - `analyze_setup_path_violations -top N -detail_info`
  - `analyze_hold_path_violations -top N -detail_info`
  - `get_paths`
- **Not used in this upgrade** (knowledge §10 risks; not qualified): clock ECO, useful skew, `commit_rank_pin_candidate`, `adjust_path_slack`, `enlarge_timing_violations`, post-mask and PBA path fix.
- **Python:** stdlib 3.9. Run the tests with `cd packs/agentic-timing-closure-system/flow && python3 -m unittest discover -s tests`.
- **Fail closed.** No convergence claim except from refreshed PrimeTime on the implemented DB with new SPEF.
- **Server** (`ssh luzi@192.168.50.41`):
  - `empyrean-license status` must show `old`; never switch it.
  - Write only `atcs-runs/qual-*`, `qual-tools/` and new `operator-admin/atcs-vN/`.
  - Never write a live Campaign workspace or the Foundation.
- **Wrapper v10.**
  - Derive it on the server from the **installed** v9.
  - Diff it against installed v9.
  - `grep REPLACE` must match comments only.
  - Its own preflight must pass on the new flow and refuse the old flow at the adapter check.
  - `kit.mjs` `wrapper-pins-pack-flow` must pass.
- **Git.** Every commit: `git push origin HEAD:main` and verify the remote SHA. Messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Node 24:** `export PATH="$HOME/.local/node24/bin:$PATH"`.
- **Live Campaigns:** none until Task 7 passes on real `postroute_final`.

## 3. File map (all under `packs/agentic-timing-closure-system/` unless noted)

| File | Change |
| --- | --- |
| `knowledge/xtop-strategy.md` (new) | Strategy ladder, fail-reason → strategy table, GBA vs path, target/margin pairing, and the risky commands not to use. Condensed from the knowledge pack with a `## Source` section. |
| `flow/atcs/workspaces.py` | Work package `passes[]` (typed XTop strategy passes) and `targetPins[]`. |
| `tools/read-atcs.py` | Worker request: 1–3 passes, whitelist, option types and ranges, `-only_pins` ⊆ target pins, full hierarchical pin paths. |
| `flow/templates/xtop-operator.tcl` | `atcs_xtop_pass {planSha256 passId}` runs one admitted pass once, then collects `summarize -with_delta` and fail reasons. Non-mutating diagnostic procs. |
| `contract.yml` | Interactive commands (mutate: `atcs_xtop_pass`; read: diagnostics). Teams `atcs-worker-01..03` v4 with `reviewedAction.command: atcs_xtop_pass`. Knobs `workerSlots` (1..3, default 3) and `autoFinish` (0/1, default 1). Workshop purposes. |
| `flow/atcs/contributions.py`, `flow/atcs_cli.py` capture | Contribution kind `xtop-pass`: pass spec, dump delta, XTop-estimated delta, fail-reason stats, ECO pair from the worker session. No `ops.jsonl` needed for this kind. |
| `flow/atcs/composition.py` | Conflicts between `xtop-pass` contributions by overlapping dump deltas and target pins; the existing kinds are unchanged. |
| `flow/atcs/integration.py`, `flow/templates/xtop-replay.tcl`, `flow/atcs/adapters.py` | Replay re-runs the selected passes in order on the base, then the auto-finish global passes, then one `write_design_changes -format INNOVUS -keep_route`. Seal the ECO pair plus per-pass and auto-finish dump deltas into the merge commit. |
| `flow/templates/innovus-eco.tcl`, `adapters.compile_innovus_eco_task` | When the merge commit carries an ECO pair: `source` netlist ECO, `source` physical ECO, `ecoRoute`, following the old `apply-eco.tcl`. Otherwise unchanged. |
| `graph.yml` | Reconnect w02/w03 after w01 (sequential); an optional fork for research after the Task 6 spike. |
| `sites/linglong-atcs28/*` | v10 wrapper template, environment template, Permit, README. |
| `test/contract/agentic-timing-closure-system.test.ts` | Teams, commands, reachability, version. |

---

## Task 1: XTop strategy knowledge for the agents

**Files:** Create `knowledge/xtop-strategy.md`. Modify `contract.yml` (add it to the `knowledge:` lists of `plan-campaign`, `research-worker-01..03`, `evaluate-next-investment` and the Team researcher and reviewer task templates by name), and `flow/tests/test_knowledge.py`.

- [ ] **Step 1: RED.** `test_knowledge.py`:
  - the file exists with the four required headings;
  - it names every whitelisted command and option used by Task 2's schema;
  - it contains the fail-reason table rows `break_setup`, `legal_fail_no_space_on_row`, `no_setup_gain` and `no_hold_gain`.
- [ ] **Step 2: Write the file** (≤ 150 lines), condensed from the knowledge pack.
  - **Source:** knowledge pack version 2026-09-24; XTop `2025.09.tmp15` install path; man pages.
  - **Tail vs bulk:**
    - Tail = checks at or below each scenario's WNS × 0.5, max 60, clustered by shared driver or net, cone, or a 20 µm region.
    - Bulk = the rest, left to auto-finish.
  - **Hold ladder:**
    1. size down / VT swap (`-size_cell_only -size_rule nominal_keywords`);
    2. dummy for tiny violations (`-use_dummy_cell`);
    3. buffer or delay chain (`-max_delay_cell_length N -delay_cell_list …`);
    4. loader clustering (`-max_cluster_loader_count 4`);
    5. `-fix_timing_window` when `break_setup` dominates. It needs low effort and cannot combine with `-size_cell_only`.
  - **Setup ladder:**
    1. `-remove_buffer_only`;
    2. `-methods size_cell`;
    3. `-methods insert_buffer`;
    4. `-methods split_net`;
    5. `-size_down_only` for off-path load.
  - **Pairing:** `hold_target` always with `setup_margin`, and `setup_target` always with `hold_margin`.
  - **Effort:** higher is not better; change the method or scope on `no_*_gain`.
  - **The fail-reason → strategy table.**
  - **Counterexample:** a global high-effort pass before tail passes over-fixed `xtop_round2_eco_route`.
- [ ] **Step 3:** GREEN, then commit `docs(atcs): XTop strategy knowledge for workers`; push.

## Task 2: Worker strategy pass — plan schema, Reader and Operator

**Files:**
- `flow/atcs/workspaces.py`
- `tools/read-atcs.py`
- `flow/templates/xtop-operator.tcl`
- `contract.yml` (interactive commands, Teams v4 × 3)
- Tests: `flow/tests/test_workspace_isolation.py`, `flow/tests/test_readers.py`, `flow/tests/test_adapters.py`, and the contract test

**Interfaces — Produces:** a work-package field `passes`:

```json
[{"passId": "p1",
  "command": "fix_hold_gba_violations",
  "options": {"effort": "low", "hold_target": 0.0, "setup_margin": 0.01,
              "fix_timing_window": true, "max_cluster_loader_count": 4},
  "onlyPins": ["swerv_dec_tlu/g96219/A1"]}]
```

Option schema, taken from `command_surface.tsv`:

| Command | Allowed options |
| --- | --- |
| `fix_hold_gba_violations` | `effort` ∈ {low, medium, high}; `hold_target`, `setup_margin`, `transition_margin`, `capacitance_margin` floats in [-0.05, 0.1]; `size_cell_only`, `use_dummy_cell`, `fix_timing_window` bools; `size_rule` ∈ {nominal_keywords}; `max_cluster_loader_count` 1..6; `max_delay_cell_length` 0..5 plus `delay_cell_list` (cell names) |
| `fix_setup_gba_violations` | `effort`; `setup_target`, `hold_margin`, transition/capacitance margins; `methods` ⊆ {size_cell, insert_buffer, split_net}; `remove_buffer_only`, `size_down_only` bools; `size_rule` |
| `fix_transition_violations` | `check_timing_margin` true only |

Incompatibilities are refused: `fix_timing_window` with `size_cell_only`, and `fix_timing_window` with effort ≠ low.

- [ ] **Step 1: RED tests.**
  - `validate_work_package` accepts the example.
  - It refuses:
    - an unknown command;
    - an unknown option;
    - an out-of-range margin;
    - `fix_timing_window` + `size_cell_only`;
    - an empty `onlyPins`;
    - a pin outside `targetPins`;
    - more than 3 passes.
  - The Reader admits a w0N request whose `onlyPins` are full hierarchical pin paths (`<instance path>/<pin>`, instance checked by `_is_hierarchical_instance`), and refuses a bare leaf pin.
  - `test_adapters`: the rendered operator Tcl defines:
    - `atcs_xtop_pass`, which reads the admitted pass by id from the retained plan file, checks the plan hash, is single-use per `passId`, builds the exact option string, and runs `summarize_gba_violations -setup -with_delta` / `-hold -with_delta` plus `report_fail_reasons -stats -verbose -pins <onlyPins>` after the pass into `pass-<id>.summary`;
    - read-only `atcs_summarize`, `atcs_fail_reasons` and `atcs_analyze_paths`.
  - Contract test:
    - Teams `atcs-worker-01..03` at version `"4"`.
    - `reviewedAction.command == "atcs_xtop_pass"` and `actionListField == "passes"`.
    - `atcs_xtop_pass` is in mutate; the diagnostics are in read commands.
- [ ] **Step 2:** Run them and confirm FAIL.
- [ ] **Step 3: Implement.**
  - The Tcl option builder maps the JSON options to flags in the table's order. Bools become flags. `onlyPins` becomes `-only_pins [get_pins {…}]`.
  - Reuse the old Pack's single-use state pattern (`hima_plan_state`, `packs/xtop-timing-closure/flow/templates/xtop-operator.tcl:63-90`), keyed per `passId`.
  - Reviewer template: "Select one pass from `passes` whose command and options fit the diagnosed cause (see xtop-strategy.md); return `{command: atcs_xtop_pass, arguments: {passId, planSha256}}`…".
  - Operator template: "Dump before.dump, run the diagnostics for the target pins, apply the reviewed pass once, run the diagnostics again, dump after.dump, export changes, close."
- [ ] **Step 4:** GREEN; full suite and contract test.
- [ ] **Step 5:** Get a review (Opus). Commit `feat(atcs): workers steer XTop with one reviewed strategy pass`; push.

## Task 3: Capture and compose an `xtop-pass` Contribution

**Files:** `flow/atcs/contributions.py`, `flow/atcs_cli.py` (`_cmd_capture_contribution`), `flow/atcs/composition.py`. Tests: `test_contribution_replay.py`, `test_composition.py`.

**Produces:** a Contribution with:
- `kind: "xtop-pass"`;
- `pass` (the admitted spec);
- `delta` from the before/after dumps;
- `predicted` from the `-with_delta` summaries (Measures);
- `failReasons{reason: count}`;
- `touches.instances` = the delta keys, and `touches.checks` = the target checks.

It is `admissible` only if:
- the dumps exist;
- the delta is non-empty, or it is recorded as `no-fix` with the diagnosis;
- the predicted target-pin slack did not get worse.

`ops.jsonl` is not required for this kind.

- [ ] **Step 1: RED tests.**
  - An `xtop-pass` capture with a size and an insert in the dump delta → admissible `fix`.
  - An empty delta → `no-fix` with the fail-reason diagnosis.
  - Predicted gain < 0 → `admissible false`, refusal `no-predicted-gain`.
  - Composition:
    - two `xtop-pass` contributions whose deltas share an instance → conflict `shared-instance`;
    - disjoint deltas with overlapping target checks → interaction `shared-timing-window`;
    - the existing typed-op tests unchanged.
- [ ] **Step 2:** Confirm FAIL. **Step 3:** Implement. **Step 4:** GREEN, then get a review (Opus: identity and sealing). Commit `feat(atcs): capture and compose XTop strategy-pass contributions`; push.

## Task 4: One replay — worker passes, then auto-finish, then one Innovus ECO

**Files:**
- `flow/atcs/integration.py` (`prepare_replay`, `reconcile`, `seal_batch`)
- `flow/templates/xtop-replay.tcl`
- `flow/atcs/adapters.py` (`compile_xtop_replay_task`, `compile_innovus_eco_task`)
- `flow/templates/innovus-eco.tcl`
- `flow/atcs_cli.py`

Tests: `test_integration_recovery.py`, `test_adapters.py`.

**Produces:**
- **`replay-request`:**
  - `passes[]` (the selected contributions' pass specs, in composition order);
  - `autoFinish{enabled, hold: {effort high, hold_target 0.0, setup_margin m_s}, setup: {methods [size_cell, insert_buffer], effort high, setup_target 0.0, hold_margin m_h}}`. The strings match `packs/xtop-timing-closure/flow/closure.py:684-690`.
- **`integration-state`:** per-pass dump deltas; the `autoFinish` dump delta; `eco{netlist{path,sha256}, physical{path,sha256}}`.
- **`merge-commit`:** gains `eco` and `passDeltas`. The id covers them.

- [ ] **Step 1: RED tests.**
  - The rendered replay Tcl, in order:
    1. `000.dump`;
    2. for each pass: `atcs_xtop_pass`-equivalent execution of the spec, then `NNN.dump`;
    3. if `autoFinish`: `fix_hold_gba_violations …`, `fix_setup_gba_violations …`, then `auto.dump`;
    4. `write_design_changes -format INNOVUS -eco_file_prefix atcs_batch -output_dir eco -keep_route`.
  - `reconcile`:
    - missing ECO pair → `AtcsError("missing-input")`;
    - an ECO file containing `FORMATVERSION`, `dbNetFreeWires` or `editDelete -net` → refused (the old `validate_sourceable_eco` rule);
    - a pass whose replay delta is empty while its Contribution delta was not → `replayMismatch` entry (a warning, recorded, not fatal).
  - `seal_batch`: changing one ECO byte changes the merge id.
  - `compile_innovus_eco_task` with `merge.eco` sources netlist then physical ECO, then `setNanoRouteMode -routeWithEco true …`, then `ecoRoute`, and not `innovusEcoTcl`. Without `eco`, output is byte-identical to today.
- [ ] **Step 2:** Confirm FAIL. **Step 3:** Implement. `autoFinish.enabled = false` with no passes reproduces today exactly. **Step 4:** GREEN.
- [ ] **Step 5:** Get a review (Opus). Commit `feat(atcs): replay worker XTop passes then auto-finish into one Innovus ECO`; push.

## Task 5: Three workers, tail first

**Files:** `graph.yml`, `contract.yml` (the `plan-campaign` and `research-worker-0N` purposes, knob `workerSlots`), `tools/read-atcs.py` (`_read_campaign_plan`), `test_readers.py`, contract test.

- [ ] **Step 1: RED tests.**
  - Campaign plan Reader:
    - two slots with overlapping `targetPins` instances → invalid;
    - the worst check of any required scenario not targeted by some slot → invalid;
    - a parked slot (`"parked": true`) is admitted.
  - Contract test: `research-worker-02` and `03` and `operate-worker-02` and `03` are reachable from `prepare-workers`; `collect` follows the slot-03 end.
- [ ] **Step 2:** Confirm FAIL.
- [ ] **Step 3: Implement.**
  - Graph edges:
    - `read-worker-result-01` → `research-worker-02`, replacing `→ collect`;
    - `prepare-workers` → `research-worker-01`, kept;
    - `check-worker-request-02` FAIL → `research-worker-03`, existing;
    - `read-worker-result-03` → `collect` and `check-worker-request-03` FAIL → `collect`, existing.
  - `plan-campaign` purpose: "Partition the tail (xtop-strategy.md) into up to three disjoint clusters, worst first; for each, choose 1–3 XTop passes from the ladders that fit its diagnosed cause; park a slot with no cluster; the bulk is left to auto-finish."
  - Update `FABRIC.md` G1.
- [ ] **Step 4:** GREEN, then get a review. Commit `feat(atcs): three tail-first worker slots in one batch`; push.

## Task 6: Spike — research Workshops in a Harness fork (optional speed lever)

**Files:** `test/contract/fork-join.test.ts` (new case only).

- [ ] Add a fixture Pack whose fork branches are Workshop → Reader `act` chains joined at one judge. Assert both Workshops begin before either finishes.
- [ ] **If it passes:** change `graph.yml` so `prepare-workers` forks `research-worker-0N` → `read-worker-request-0N` (×3) into the join judge `check-worker-request-01`, and the operate chain stays serial. Rerun the contract test and commit.
- [ ] **If it fails:** keep Task 5's sequential graph, record the evidence in `FABRIC.md`, and make no Harness change in this plan.

## Task 7: Identity, then a server chain dry run on real `postroute_final`

- [ ] Pack 0.2.0.
- [ ] Derive the v10 wrapper from installed v9 (§2) and qualify it with its own preflight.
- [ ] Repo: v10 template, environment template, Permit, README. Run the contract test. Commit and push.
- [ ] `qual-tools/chain-dryrun.sh` on a qualification copy:
  1. bind-inputs → baseline → observe → policy → physical → risk → residual;
  2. a hand-authored three-slot plan from the real `residual-cases.json`, with full pin paths and passes chosen from the ladders;
  3. `prepare-workers`;
  4. for each slot, a non-interactive XTop session running `atcs_xtop_pass` for the plan's first pass, then `capture-contribution`;
  5. `collect` → `compose-facts` → an admitted plan selecting all admissible → `replay-prepare` with auto-finish → `reconcile` → `presta` → `implement` → `extract` → `sta` → `evaluate`.
- [ ] Record per stage: exit code, time, XTop-estimated and fail-reason summaries, and refreshed PrimeTime WNS/TNS/violations per scenario, against the baseline and the serial rounds 1–2.
- [ ] **Pass:** all stages exit 0; ECO sourced and routed; PrimeTime reader-backed.
- [ ] **If `write_design_changes` misbehaves after replayed passes** (for example, duplicate or missing changes): change Task 4 to export per pass with `-last_n`, add a RED test, and redo this task.

## Task 8: One live Campaign judged against the serial flow

- [ ] Build the kit with `kit.mjs`: Pack 0.2.0, binding v10, all preflights.
- [ ] Guide request:
  - Goal WNS 0 / 0, post-route only.
  - 180 min, 2 generations.
  - `workerSlots` 3, `autoFinish` 1.
  - PrimeTime-only judgement.
- [ ] Watch with `watch.py`, with a UI check each cycle.
- [ ] Report against §4, and update Issue #63.

---

## 4. Acceptance

The following apply to reader-backed PrimeTime on implemented DBs with new SPEF:

| # | Criterion |
| --- | --- |
| A1 | At most 2 refreshes. |
| A2 | Hold WNS better than −0.15 ns and setup WNS better than −0.038 ns in every required scenario. |
| A3 | ssg_m40 hold TNS no worse than −4.10 ns, and setup TNS no worse than −0.12 ns. |
| A4 | Run start to the second refreshed PrimeTime result in no more than 120 min. |
| A5 | No new signal DRC from `ecoRoute`; connectivity no worse than the baseline. |
| A6 | Identity errors 0; required scenarios complete. |

## 5. Next levers (not in this plan)

- **PBA path fixing** (`fix_*_path_violations`) for the last few residuals, once PBA data export is qualified.
- **Density relief** before hold insertion when `legal_fail_*` dominates.
- **Concurrent XTop sessions** across slots.
- **A faster refresh:** multi-corner StarRC and multi-scenario PrimeTime in one session.
- **PrimeTime refine/revert** from `utilities/post_verification/` to drop harmful sizing before implementation.

## Self-review

- **Your ask mapped to tasks:**

  | Ask | Where |
  | --- | --- |
  | multiple workers | Tasks 5–6 |
  | analysis | Tasks 1 and 2 (diagnostics and fail reasons) |
  | fixes done by XTop, steered by agents | Task 2 |
  | big troubles first | Task 5 (the worst check must be targeted; tail before bulk) |
  | auto-fix finishes the rest | Task 4 |
  | faster and better than serial | §1, §4, Tasks 7–8 |

- **Minimal change:** no Harness change. It reuses the Team seam (one reviewed action), the three slots, composition, replay, the refresh and adoption. The new surface:
  - one Operator command;
  - one Contribution kind;
  - replay and implement ends taken from the old qualified flow;
  - three graph edges;
  - one knowledge file.
- **Unverified assumptions, each with a test and a fallback:**
  - `-only_pins` targeted passes on SWERV28 (Task 7);
  - `write_design_changes` after replayed passes (Task 7);
  - Workshops in forks (Task 6, optional).
