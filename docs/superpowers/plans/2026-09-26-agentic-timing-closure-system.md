# Agentic Timing Closure System HimaPack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new HimaPack `agentic-timing-closure-system` — cooperative parallel ECO research, contribution merge, joint physical verification and Residual→APR — as an executable, fail-closed, tested Pack, then qualify and release it on the linglong Site.

**Architecture:** A new Pack folder beside the frozen B_lazy Pack. Business behavior lives in Pack-owned Python modules M1–M8 (`flow/atcs/`), Readers, rules, Choosers, Workshops and knowledge; HimaHarness source stays unchanged. Commercial EDA runs only as declared Pack tools/interactive Jobs through Site wrappers; Python compiles inputs, parses reports, computes deltas and builds typed artifacts.

**Tech Stack:** Python 3.9-compatible stdlib only (`unittest`), YAML Pack declarations validated by `packages/harness/src/packs.ts`, Node 24 contract tests (`scripts/run-contract-tests.mjs`), Tcl templates for PrimeTime / Innovus / StarRC / XTop.

## Source documents (authority order)

1. `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_SPEC.md` — business SPEC (nine chapters). **Authority for semantics, rules, endings.**
2. `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md` — architecture and acceptance cases (§17.1).
3. `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/EDA_SERVER_TOOLS_AND_EVIDENCE_GUIDE.zh-CN.md` — server, tools, report locations, historical evidence.
4. `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md` §3 (M1–M8), §13 (P0–P10), §14 (tests) and `OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md` §6–§10 — development mapping.
5. `docs/package-development/THE_DEVELOPMENT_OF_HIMA_PACK.md` and `.superpowers/sdd/pack-mechanics.md` (schema reference with exact `packs.ts` line numbers — every implementer touching YAML reads this).

## Global Constraints

- Pack id `agentic-timing-closure-system`, folder `packs/agentic-timing-closure-system/`, version `0.1.0`. Typed value prefix `tc_`; artifact `schema` prefix `atcs.` (e.g. `atcs.contribution/1`).
- HimaHarness source (`packages/**`, `scripts/**` except new test registration) is unchanged. A capability the schema cannot express is reported as a gap in `FABRIC.md`, never patched into the Harness or hidden in a background process.
- `packs/xtop-timing-closure/` (B_lazy, `xtop-timing-closure@1.0.14`, digest `19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`) and `sites/linglong-swerv28/` are frozen: read, copy from, never modify.
- Python code is stdlib-only and Python 3.9 compatible (no `match`, no runtime `X | Y` unions, no third-party imports). Tests: `python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v`.
- Fail closed: a missing, truncated, duplicated, non-finite or identity-mismatched source yields `unknown` with a reason or an `AtcsError` refusal — never `0`, never PASS. `0` is emitted only when the data explicitly supports zero.
- Goal parameters `target_setup_wns_ns = 0.0`, `target_hold_wns_ns = 0.0` (unit `ns`). The model may not change frequency, relax exceptions, drop required checks or widen its own budget/permissions.
- Required scenarios: `func_ssg_rcworst_m40`, `func_ssg_rcworst_125`, `func_ffg_cbest_m40`, `func_ffg_cbest_125`. `mode` ∈ {`setup`,`hold`}; `scope` ∈ {`all`,`reg2reg`} (Harness-fixed vocabularies).
- Bounded worker slots: exactly **3** (`01`, `02`, `03`), each its own literal outputs/nodes (no dynamic output names exist).
- Execution scope is strictly `full-flow` or `post-route-only`; `tc_lifecycle_available = 1` only when the full declared lifecycle set is verified. No partial-stage fallback; never reconstruct unprovided early state.
- Three state pointers are independent: `workingState`, `bestVerifiedState`, `deliveryState`. State version, observation revision, contribution revision and physical refresh count are counted separately.
- No customer, PDK or library report content is committed. Test fixtures are synthesized in the grammar observed in real reports; real-corpus checks read the server read-only.
- linglong server (`ssh luzi@192.168.50.41`) is read-only for this plan except jobs the user approves one by one in chat. Never edit `/data/eda/env/empyrean-license-mode`, restart licence services, kill processes, bypass wrappers, or write under the Foundation root or existing Hima run directories.
- Every commit: conventional message `feat(atcs): …` / `test(atcs): …` / `docs(atcs): …`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; immediately `git push origin HEAD:claude/himapack-development-c56369` and confirm `git rev-parse HEAD` equals `git ls-remote origin claude/himapack-development-c56369`.
- Node 24 for all `pnpm`/`node` commands: `export PATH="$HOME/.local/node24/bin:$PATH"`. Never run two Electron suites at once.

## Model allocation (user instruction, 2026-09-26)

The user asked for three tiers; this session can reach two (`sonnet` = Sonnet 5; `opus` = Opus 5.5, effort not controllable). Opus is kept for judgment-critical work.

| Role | Model |
| --- | --- |
| Implementers T1–T13, T15–T17 | `sonnet` |
| Implementer T14 (contract + graph compile) | `opus` |
| Reviewers T1, T5, T6, T7, T9, T14; final whole-branch review | `opus` |
| Reviewers T2, T3, T4, T8, T10–T13, T15–T17 | `sonnet` |
| Escalation after a BLOCKED Sonnet implementer with located evidence | `opus` |

## File structure

```text
packs/agentic-timing-closure-system/
  INTENT.md SPEC.md FABRIC.md            # authoring records (exact ## headings)
  contract.yml graph.yml semantics.yml   # T14
  knowledge/*.md                          # T2 (10 files) + manifest if used
  readers/*.yml                           # T13
  rules/*.yml choosers/*.yml              # T14
  tools/read-atcs.py                      # T13 single fail-closed Reader script
  flow/atcs_cli.py                        # T12 subcommand dispatcher used by tools
  flow/atcs/__init__.py
  flow/atcs/core.py                       # T3 hashing, artifacts, Measure, errors
  flow/atcs/reports.py                    # T3 PT/StarRC/Innovus report parsers
  flow/atcs/state.py                      # T3 M1 DesignState/readiness/ObservationSet
  flow/atcs/workspaces.py                 # T4 M2
  flow/atcs/contributions.py              # T5 M3
  flow/atcs/composition.py                # T6 M4
  flow/atcs/integration.py                # T7 M5
  flow/atcs/verification.py               # T8 M6
  flow/atcs/adoption.py                   # T9 M7
  flow/atcs/experience.py                 # T10 M8
  flow/atcs/residual.py                   # T10 Residual Case
  flow/atcs/lifecycle.py                  # T11 APR intervention + stage task
  flow/atcs/adapters.py                   # T12 tool task compile/collect
  flow/templates/*.tcl                    # T12 (and T11 hooks)
  flow/tests/fixtures.py                  # T3 synthesized report generators
  flow/tests/test_*.py                    # per task
sites/linglong-atcs28/                    # T15 site.yml permit.yml README.md wrappers
test/contract/agentic-timing-closure-system.test.ts   # T15
scripts/atcs-corpus-preflight.py          # T16 (outside the Pack; never released)
```

## Shared data model (binding for every task)

All artifacts are JSON objects written by `core.write_artifact`. Every artifact carries `schema` (`"atcs.<kind>/1"`) and `id` = `core.digest(obj without "id")` — first 20 hex chars of SHA-256 over canonical JSON (`json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False)`, UTF-8). `sources` is a list of `{"path": <campaign-relative>, "sha256": <64 hex>}`.

**Measure** — every numeric fact: `{"value": <number>}` or `{"unknown": "<reason>"}`, exactly one key. Helpers `known(v)`, `unknown(reason)`, `is_known(m)`, `value_of(m)` (raises `AtcsError("unknown-value")` on unknown).

**Check key** — `"<scenario>|<mode>|<endpoint>"` from `core.check_key(scenario, mode, endpoint)`.

**AtcsError(code, detail)** — the only refusal type; `code` is a kebab-case string listed in each task.

| Kind | Producer | Required fields |
| --- | --- | --- |
| `design-state` | M1 `design_state(manifest)` | `top`, `stage`, `database{path,sha256,datDigest}`, `netlist{path,sha256}`, `def{path,sha256}` or null, `spef{<corner>:{path,sha256}}`, `sdc[{path,sha256}]`, `tools{<name>:<version>}`, `scenarios[]`, `parentId` or null |
| `input-readiness` | M1 `input_readiness(manifest)` | `missing[]`, `missingCount`(Measure), `lifecycleAvailable`(Measure 0/1), `lifecycleMissing[]`, `scope` (`"full-flow"`/`"post-route-only"`) |
| `observation-set` | M1 `capture(source_refs, query_spec)` | `designStateId`, `precision` (`gba`/`pba`), `scenarios{<name>:{setup:{wns,tns,violations},hold:{…},unconstrained,complete:{setup:bool,hold:bool}}}` (values are Measures), `checks{<checkKey>:{slack(Measure),startpoint,pathGroup}}`, `missingScenarios[]`, `coverage{complete:bool,reasons[]}`, `sources[]` |
| `check-comparison` | M1 `compare_checks(prior, current, recheck)` | `fixed[]`, `remaining[]`, `entrant[]`, `regressed[]`, `missingPrior[]` (check keys) |
| `work-package` | plan Workshop → Reader validates via M2 `validate_work_package` | `taskId` (`w01`–`w03`), `baseStateId`, `problem`, `targets[checkKey]`, `editDomain{instances[],nets[],regions[[x1,y1,x2,y2]]}`, `protected{instances[],nets[]}`, `mayAffect[checkKey]`, `actions[]` ⊆ `ACTION_KINDS`, `budget{xtopMinutes,queries,attempts}` |
| `workspace-manifest` | M2 `prepare(work_package, campaign_root, base_state)` | `workPackageId`, `taskId`, `revision`, `root` (`workspaces/<taskId>/r<rev>/`), `readOnly[sources]`, `namePrefix` (`atcs_<taskId>_r<rev>_`), `recovery{checkpoint or null}`, `baseStateId` |
| `operation` | XTop typed procedure log (`ops.jsonl`), parsed by M3 | one of: `{"op":"size_cell","instance","fromMaster","toMaster"}`, `{"op":"insert_buffer","net","loadPins[]","newInstance","newNet","master","location[x,y] or null"}`, `{"op":"delete_buffer","instance","master"}`, `{"op":"pg_local_adjust","region[x1,y1,x2,y2]","action","detail"}` |
| `contribution` | M3 `seal(base_ref, result_refs, operation_trace)` | `taskId`, `revision`, `baseStateId`, `kind` (`fix`/`no-fix`), `operations[]`, `script{path,sha256}` or null, `delta{mastersChanged{inst:[from,to]},added{inst:master},removed{inst:master}}`, `touches{instances[],nets[],regions[],checks[],cones[]}`, `preconditions[{instance,master}]`, `dependencies[contributionId]`, `atomicGroups[[opIndex]]`, `predicted{xtopSetupWns,xtopHoldWns,prestaSetupWns,prestaHoldWns}` (Measures), `validationLevel` (`none`/`xtop`/`presta`), `diagnosis`, `admissible` (bool), `refusals[]`, `outOfScope[]`, `beforeDumpSha256` |
| `composition-facts` | M4 `analyze(base_state_id, contributions, resolutions)` | `baseStateId`, `considered[]`, `duplicates[{keep,dropped[],sources[]}]`, `conflicts[{key,kind,contributions[],objects[]}]`, `interactions[{kind,contributions[],evidence}]`, `staleBase[]`, `order[]`, `unresolvedCount` |
| `integration-plan` | compose Workshop → Reader via M5 `validate_plan` | `batchId`, `baseStateId`, `select[]`, `resolutions[{conflictKey,decision}]` where decision ∈ `keep:<id>`/`drop:<id>`/`revise:<id>` + optional `revisedContribution`, `deferred[]`, `reason` |
| `replay-request` | M5 `prepare_replay(plan, facts, contributions)` | `batchId`, `baseStateId`, `steps[{stepId,contributionId,opIndex,op,xtopTcl}]`, `expectedDelta` |
| `integration-state` | M5 `reconcile(request, receipts)` | `batchId`, `applied[stepId]`, `failed[]`, `pending[]`, `replayMismatch[]`, `outOfScope[]`, `delta` |
| `merge-commit` | M5 `seal_batch(state, request, facts)` | `parentStateId`, `contributions[{id,revision}]`, `operations[]`, `innovusEcoTcl`, `sourceMap{<opKey>:[contributionId]}`, `newNets[]` |
| `check-plan` | M6 `plan_checks(merge_commit, policy)` | `requiredScenarios[]`, `scenarioCorners{<scenario>:<corner>}` (from `policy.scenarioCorners`, i.e. the analysis contract), `extraction` (`full`), `sta` (`full`), `physical[]`, `functional[]`, `pg[]` |
| `evaluation` | M6 `assemble(plan, receipts, prior_observation, baseline_physical)`; receipts shape: `verification.py` module docstring (each `sta[scenario]` carries `corner`; any missing identity leg makes `finalIdentityErrorCount` unknown) | `candidateId`, `finalSetupWns`, `finalHoldWns`, `missingRequiredCheckCount`, `finalIdentityErrorCount`, `constraintFailureCount`, `constraintUnknownCount`, `fixedCheckCount`, `missingPriorCheckCount` (all Measures), `comparison` (check-comparison), `physical{drc,connectivity}` |
| `acceptance-record` | M7 `publish(evaluation, expected_base, pointers_path, policy)` | `decision` (`best`/`working-only`/`delivery`/`refused`), `pointersBefore`, `pointersAfter`, `acceptedArtifactReady` (Measure), `reason` |
| `experience` | M8 `record(lineage, decision, outcome)` | append-only `entries[{decisionId,hypothesis,action,conditions{stage,scenario,precision,toolVersion},predicted,measured,verdict}]` |
| `residual-case` | `residual.extract(evaluation, observation, experience, readiness)` | `checks[]`, `evidence{cellDelay,netDelay,slew,fanout,location}`, `attempts[]`, `limits[]`, `suggestedStage` (`postroute`/`route`/`cts`/`place`/null), `requiredInputs[]` |
| `next-decision` | evaluate-next-investment Workshop → Reader | `stateRef`, `observationRef`, `budgetRef`, `question`, `action` ∈ {`observe`,`research`,`compose`,`revise`,`implement`,`earlier-apr`,`wait`,`goal-met`}, `targets[]`, `reason`, `falsifier`, `costBasis`, `requiredArtifacts[]` |

`ACTION_KINDS = ("size_cell", "insert_buffer", "delete_buffer", "pg_local_adjust")`. `pg_local_adjust` is admissible only when the Site declares the PG verification capability (`siteCapabilities.pgVerification == true`).

---

## Phase A — Authoring records and knowledge

### Task 1: Pack scaffold, INTENT.md, SPEC.md, B_lazy freeze

**Model:** implementer `sonnet`; reviewer `opus`.

**Files:**
- Create: `packs/agentic-timing-closure-system/INTENT.md`, `packs/agentic-timing-closure-system/SPEC.md`, `packs/agentic-timing-closure-system/flow/atcs/__init__.py` (empty), `packs/agentic-timing-closure-system/flow/tests/__init__.py` (empty), `docs/package-development/agentic-timing-closure-system/b-lazy-freeze.md`
- Test: `packs/agentic-timing-closure-system/flow/tests/test_records.py`

**Interfaces:**
- Produces: the SPEC that every later task cites; the `tc_*` value table (T13), rule list (T14), next-action codes (T14).

- [ ] **Step 1: Write the failing test** `test_records.py`: parse `##` headings of INTENT.md and SPEC.md and assert they equal exactly, in order, `["Business","Golden Flow","Answers","Ambiguities resolved","Knowledge applied"]` and `["Goal template","Constraints","Run contract","Semantics","Judge rules","Choosers","Endings","Workshops","Knowledge"]`, each section non-empty; assert SPEC.md mentions every value name in the SPEC table below and every rule id below.
- [ ] **Step 2: Run** `python3 -m unittest packs/agentic-timing-closure-system/flow/tests/test_records.py -v` → FAIL (files missing).
- [ ] **Step 3: Write INTENT.md** from source doc 1 "Goal template"/"Constraints" and the architecture's interview rounds 1–4 (Q1–Q14): Business (user, result, B_lazy benchmark), Golden Flow (Foundation root `/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation`, state chain table from source doc 3 §8, historical residual: SSG −40 setup ≈ −0.04 ns, hold ≈ −0.16 ns, 3 unconstrained endpoints per scenario, full-chip DRC 72,799 pre-existing), Answers (one line per confirmed decision), Ambiguities resolved, Knowledge applied (the six Harness knowledge files named in source doc 1).
- [ ] **Step 4: Write SPEC.md** — the nine chapters of source doc 1, preserving every table, with these compile decisions added in the relevant chapter:
  - Run contract: worker slots are exactly 3 (`workerManifest01..03`, `workerRequest01..03`, `workerResult01..03`); Workshop directories `research/diagnose`, `research/plan`, `research/worker-01..03`, `research/compose`, `research/next`; Workshop argv `[python3, '${ENTRY}', '${WORKSPACE}', '${WORKSHOP}']`.
  - Semantics: add `tc_next_action` (count; codes 1 observe, 2 research, 3 compose, 4 revise, 5 implement, 6 earlier-apr, 7 wait, 8 goal-met; emitted only from a schema-valid `next-decision`; unknown otherwise) and `tc_selected_contribution_count` (count; contributions in the current integration plan's `select`). State that a Harness judge routes on its **first** rule only, so compound predicates compile to chained judge nodes in the listed order.
  - Judge rules: the eleven rules of source doc 1 keep their ids: `inputs-ready`, `request-admissible`, `replay-consistent`, `composition-ready`, `presta-model-qualified`, `final-evidence-ready`, `required-constraints-pass`, `setup-goal`, `hold-goal`, `artifact-ready`, `continue-or-wait`; compound ones split into single-predicate files named `<id>-<part>` (e.g. `replay-consistent-mismatch`, `replay-consistent-scope`, `final-evidence-ready-coverage`, `final-evidence-ready-identity`, `required-constraints-pass-failures`, `required-constraints-pass-unknowns`).
- [ ] **Step 5: Write `b-lazy-freeze.md`**: B_lazy method id/version/digest, Run `run-ddabd488-f05c-44d6-9c9b-45abccaff226`, server workspace path, best DB path, measured ending (`ended-budget-exhausted`, generationLimit 1, setup −0.04 ns/12, hold −0.15 ns/196), J3 verdict `inconclusive`, and the list of data the old Run lacks for a same-oracle comparison (all from source doc 3 §9).
- [ ] **Step 6: Run test** → PASS. Commit `docs(atcs): author INTENT and SPEC, freeze B_lazy` and push.

### Task 2: Knowledge files

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:**
- Create under `packs/agentic-timing-closure-system/knowledge/`: `method-and-benchmark.md`, `state-and-evidence.md`, `observation-strategy.md`, `mechanisms-and-falsifiers.md`, `xtop-capabilities.md`, `contribution-and-merge.md`, `cheap-verification.md`, `innovus-stage-interventions.md`, `lifecycle-and-input-modes.md`, `experience-transfer.md`
- Test: `packs/agentic-timing-closure-system/flow/tests/test_knowledge.py`

- [ ] **Step 1: Failing test** — every file exists, and each contains the four headings `## Source`, `## Applies when`, `## Changes this decision`, `## Counterexample`, each non-empty; `## Source` names a path or document with version.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the ten files** (content table: source doc 1 "Knowledge"). Sources: the user documents above; XTop docs read-only on the server (`/data/eda/software/eda_tools/empyrean/xtop-2025.09.tmp15/share/doc/man/man1/{write_design_changes,report_eco_actions,save_workspace,undo}.1`, `utilities/post_verification/refine_xtop_eco_commands.tcl`, and `/data/eda/project/design_zoo/docs/xtop_advanced_timing_closure/evidence/command_surface.tsv`); Innovus TCR pages named in source doc 3 §6. Paraphrase; quote no more than one line per source; record the exact command names and flags verified. `xtop-capabilities.md` must list the exact XTop commands T12 will use for: path query, per-instance attribute query, sizing, buffer insertion, buffer deletion, change export (`write_design_changes` options incl. `-last_n` limits), workspace save/restore — each marked "documented" (not "qualified").
- [ ] **Step 4: Run** → PASS. Commit `docs(atcs): add method knowledge` and push.

---

## Phase B — Pack-owned modules (L1 tests)

Every task in Phase B: TDD with `unittest`; tests import modules via `sys.path.insert(0, <pack>/flow)` then `from atcs import <module>`; each test uses `tempfile.TemporaryDirectory()`; run `python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v` before commit; commit and push per task.

### Task 3: core, report parsers, M1 state

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:**
- Create: `flow/atcs/core.py`, `flow/atcs/reports.py`, `flow/atcs/state.py`, `flow/tests/fixtures.py`, `flow/tests/test_core.py`, `flow/tests/test_observation_contract.py`
- Reference (read-only): `packs/xtop-timing-closure/flow/closure.py` (`parse_global`, `parse_endpoints`), `packs/xtop-timing-closure/tools/read-output.py`, `packs/xtop-timing-closure/flow/tests/test_closure.py:26-58` (`global_report`, `path_report` generators).

**Interfaces — Produces:**
- `core`: `AtcsError(code, detail)`, `canonical(obj)->bytes`, `digest(obj)->str`, `file_sha256(path)->str`, `tree_digest(dir)->str` (sorted relative paths + sizes + sha256), `stamp(kind, obj)->dict`, `write_artifact(path, obj)->str` (atomic; returns sha256), `read_artifact(path, kind)->dict` (raises `schema-mismatch`), `known`, `unknown`, `is_known`, `value_of`, `check_key`.
- `reports`: `parse_global_timing(text)->{"setup":{"wns","tns","violations"},"hold":{…}}` (Measures), `parse_path_report(text, mode, max_paths)->{"paths":[{"endpoint","startpoint","pathGroup","slack"}],"complete":bool}` (`complete=False` when path count ≥ `max_paths`, or the text ends mid-path), `parse_check_timing(text)->{"unconstrainedEndpoints":Measure}`.
- `state`: `design_state(manifest)->dict`, `input_readiness(manifest, site_capabilities)->dict`, `capture(source_refs, query_spec)->dict`, `compare_checks(prior, current, recheck)->dict`.
- `fixtures`: `global_report(...)`, `path_report(rows, mode)`, `check_timing_report(unconstrained)` producing PT grammar.

- [ ] **Step 1: Failing tests** covering: canonical digest stable under key order; `write_artifact` atomic and `read_artifact` rejects wrong kind; global report true zero → `{"value":0}`, missing hold section → hold Measures unknown, `inf`/`nan` → unknown; path report with count == max_paths → `complete False`; truncated mid-block → `complete False`; duplicate endpoint rows in one report → `AtcsError("duplicate-check")`; `capture` with one required scenario absent → `missingScenarios` lists it and `coverage.complete False`; `compare_checks`: a check negative in prior and **absent** from a truncated current report → `missingPrior`, not `fixed`; the same check re-observed by `recheck` with slack 0.01 → `fixed`; a check non-negative in prior and negative now → `regressed`; new negative check → `entrant`; `input_readiness`: missing SDC → `missingCount 1`; manifest without `lifecycle` → `lifecycleAvailable {"value":0}`, `scope "post-route-only"`, `lifecycleMissing ["lifecycle not provided"]`; lifecycle with all stages `init,place,cts,route,postroute` having existing hash-bound checkpoint + script and `flowConfig` present → 1 / `full-flow`; lifecycle missing only `cts` checkpoint → 0 (no partial scope); unreadable file (permission error) → `lifecycleAvailable` unknown.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the three modules and fixtures. `design_state` hashes the `.enc` file and `tree_digest` of `.enc.dat`; refuses (`missing-input`) when the `.enc.dat` directory is absent.
- [ ] **Step 4: Run** → PASS. Commit `feat(atcs): observation contract and design state (M1)`; push.

### Task 4: M2 workspaces

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:** Create `flow/atcs/workspaces.py`, `flow/tests/test_workspace_isolation.py`.

**Interfaces:**
- Consumes: `core.*`, `design-state`.
- Produces: `ACTION_KINDS`, `validate_work_package(obj, base_state, site_capabilities)->dict` (stamped `work-package`; raises `invalid-work-package` listing every problem), `prepare(work_package, campaign_root, base_state)->dict` (`workspace-manifest`, written to `<root>/manifest.json`), `request_invalid_count(obj, base_state, site_capabilities)->int` (for `tc_request_invalid_count`).

- [ ] **Step 1: Failing tests**: valid package passes; `taskId` outside `w01..w03` rejected; action `swap_rtl` rejected; `pg_local_adjust` rejected when `siteCapabilities.pgVerification` false; `baseStateId` ≠ base state id rejected; target in `protected` rejected; `prepare` twice with the same package returns the identical manifest and creates one directory (idempotent recovery); a second revision of the same task gets `r2` and a different `namePrefix`; two tasks prepared concurrently (two threads) get disjoint roots; a package whose computed root escapes `campaign_root` (e.g. `taskId` with `..`) is refused; manifest lists base sources read-only (files are not copied or linked into the write root).
- [ ] **Step 2–4:** run FAIL → implement → run PASS. Commit `feat(atcs): private worker workspaces (M2)`; push.

### Task 5: M3 contributions

**Model:** implementer `sonnet`; reviewer `opus`.

**Files:** Create `flow/atcs/contributions.py`, `flow/tests/test_contribution_replay.py`.

**Interfaces:**
- Consumes: `workspace-manifest`, `work-package`, `core`.
- Produces: `parse_ops_log(text)->list[operation]` (JSON lines; rejects unknown `op`, missing fields, duplicate `newInstance`), `parse_cell_dump(text)->{instance: master}` (lines `instance master`; rejects duplicates/malformed), `actual_delta(before, after)->delta`, `implied_delta(operations, before)->delta`, `seal(base_ref, result_refs, operation_trace)->contribution` where `base_ref={"stateId","workspaceManifest","workPackage"}`, `result_refs={"beforeDump","afterDump","script" or None,"predicted"{…},"diagnosis","cones"[]}`.

- [ ] **Step 1: Failing tests**: sizing op whose dumps agree → admissible `fix`, `delta.mastersChanged` exact, `preconditions` = `[{instance, fromMaster}]`; ops say size A but dumps show A and B changed → `admissible False`, refusal `trace-mismatch`; op on an instance outside `editDomain` → `outOfScope` lists it and `admissible False`; buffer insertion whose `newInstance` lacks the manifest `namePrefix` → refusal `bad-name`; base dump already containing earlier historical ECO instances → delta contains only this workspace's changes; `kind no-fix` with empty ops and a diagnosis → admissible, counts as research result; `no-fix` without diagnosis → refusal; atomic group `[0,1]` (insert buffer + size its driver) recorded; `seal` is deterministic (same inputs → same `id`); predicted values missing → Measures unknown, `validationLevel "none"`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): sealed ECO contributions (M3)`; push.

### Task 6: M4 composition

**Model:** implementer `sonnet`; reviewer `opus`.

**Files:** Create `flow/atcs/composition.py`, `flow/tests/test_composition.py`.

**Interfaces:**
- Consumes: `contribution`.
- Produces: `analyze(base_state_id, contributions, resolutions)->composition-facts`, `conflict_key(kind, ids, objects)->str` (stable).

- [ ] **Step 1: Failing tests** (architecture §17.1 rows): two disjoint fixes → no conflicts, both in `order`; two identical operation sets → one `duplicates` entry keeping the lower id, `sources` both ids; same instance, different target master → conflict `same-instance-different-master`; delete-buffer vs size of the same instance → `delete-vs-modify`; different instances whose `touches.checks` or `touches.cones` intersect → interaction `shared-timing-window` (no object overlap needed); two insertions with overlapping `location` bboxes (within 2.0 µm) → interaction `shared-space`; two contributions creating the same `newInstance` name → conflict `name-collision`; selection including op 0 but not op 1 of an atomic group is impossible at contribution level, so a contribution depending on another not in the set → conflict `missing-dependency`; contribution whose `baseStateId` differs from `base_state_id` → `staleBase`; `unresolvedCount` counts conflicts whose `key` has no resolution; a supplied resolution lowers it; inadmissible contributions are excluded from `considered` and listed nowhere else; `order` is a dependency-respecting topological order, ties broken by id.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): semantic composition facts (M4)`; push.

### Task 7: M5 integration

**Model:** implementer `sonnet`; reviewer `opus`.

**Files:** Create `flow/atcs/integration.py`, `flow/tests/test_integration_recovery.py`.

**Interfaces:**
- Consumes: `composition-facts`, `contribution`, `integration-plan`.
- Produces: `validate_plan(obj, facts)->integration-plan` (raises `invalid-plan`), `prepare_replay(plan, facts, contributions)->replay-request`, `pending_steps(request, receipts)->list[stepId]`, `reconcile(request, receipts, edit_domains)->integration-state`, `seal_batch(state, request, facts, contributions)->merge-commit`, `xtop_tcl(op)->str`, `innovus_eco_tcl(operations)->str`. `receipts` = list of `{"stepId","status":"ok"|"error","observedDelta"}`. Exact XTop/Innovus command spellings come from `knowledge/xtop-capabilities.md` and `knowledge/innovus-stage-interventions.md` (T2); Innovus ECO uses `ecoChangeCell -inst -cell`, `ecoAddRepeater -net -cell -name`, `ecoDeleteRepeater -inst`.

- [ ] **Step 1: Failing tests**: plan selecting two complementary contributions → request steps in facts `order`, `stepId = digest(contributionId, opIndex)`; plan leaving an unresolved conflict → `prepare_replay` raises `unresolved-conflict`; stale-base contribution without `revise` → raises `stale-base`; `revise:<id>` with `revisedContribution` substitutes the revised one; `pending_steps` after receipts for steps 1–2 of 4 returns only 3–4 (interrupted replay does not re-insert); duplicate receipts for one step are idempotent; receipt whose `observedDelta` differs from the op → `replayMismatch`; observed change outside the union edit domain → `outOfScope`; `seal_batch` refuses with pending/failed/mismatch; merge commit `sourceMap` maps each op to all contributing ids (duplicates keep both sources); `innovus_eco_tcl` for a buffer insertion names `newInstance`/`newNet` exactly and lists `newNets`; the same inputs produce the same merge-commit id.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): deterministic replay and merge commit (M5)`; push.

### Task 8: M6 verification

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:** Create `flow/atcs/verification.py`, `flow/tests/test_precheck_validity.py`.

**Interfaces:**
- Consumes: `merge-commit`, `observation-set`, `state.compare_checks`, `reports.*`.
- Produces: `plan_checks(merge_commit, policy)->check-plan`; `presta_qualification(new_nets, spef_net_names)->{"unqualified":[…],"count":Measure}`; `parse_drc_summary(text)`, `parse_connectivity_summary(text)` (truncation → unknown); `assemble(plan, receipts, prior_observation, baseline_physical)->evaluation`. `receipts` = `{"database":{path,sha256},"netlist":{…},"def":{…},"spef":{corner:{path,sha256,inputDefSha256}},"sta":{scenario:{"inputs":{netlistSha256,spefSha256},"observation":observation-set}},"physical":{"drc":text,"connectivity":text}}`.

- [ ] **Step 1: Failing tests**: new nets absent from SPEF → count equals their number; unreadable SPEF list → unknown; one required scenario missing → `missingRequiredCheckCount 1` and `finalSetupWns` unknown; STA input SPEF sha ≠ extraction output sha → `finalIdentityErrorCount ≥ 1`; all consistent → identity 0 and final WNS = min over scenarios; connectivity report truncated at its limit → `constraintUnknownCount ≥ 1` (not 0 failures); new DRC identities beyond baseline policy → `constraintFailureCount` counts them; `plan_checks` for sizing-only commit has no `functional` entry, for `pg_local_adjust` includes `pg`; an estimated (non-final) SPEF flagged `estimated: true` is refused for final evaluation (`AtcsError("estimated-rc")`).
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): check planning and evaluation (M6)`; push.

### Task 9: M7 adoption

**Model:** implementer `sonnet`; reviewer `opus`.

**Files:** Create `flow/atcs/adoption.py`, `flow/tests/test_adoption.py`.

**Interfaces:**
- Consumes: `evaluation`, `core`.
- Produces: `load_pointers(path)`, `publish(evaluation, expected_base, pointers_path, policy)->acceptance-record`, `artifact_ready(database_ref)->Measure` (re-hashes `.enc` and `tree_digest(.enc.dat)` against the recorded identity). `policy` = `{"allowDegradedWorking":bool,"degradeLimitNs":float,"goal":{"setup":0.0,"hold":0.0}}`. Pointer file writes are atomic and include a monotonically increasing `version`; comparison policy for best = higher `min(finalSetupWns, finalHoldWns)`, tie → fewer failing checks.

- [ ] **Step 1: Failing tests**: better evaluation with all constraint counts known and 0 → `best` updated, old best kept in `history`; `expected_base` ≠ current `working` → `refused` (`stale-base`), pointers unchanged; evaluation with `constraintUnknownCount` unknown or > 0 → never `best`; degraded but verified evaluation with `allowDegradedWorking` and within limit → `working-only`, best unchanged; goal met + `artifact_ready` 1 → `delivery` set; artifact `.enc.dat` bytes changed after evaluation → `artifact_ready` 0 and no delivery; publishing the same evaluation twice is idempotent (version not bumped twice); an older evaluation arriving after a newer best (late result) cannot overwrite best.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): guarded adoption and state pointers (M7)`; push.

### Task 10: M8 experience and Residual Cases

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:** Create `flow/atcs/experience.py`, `flow/atcs/residual.py`, `flow/tests/test_experience_residual.py`.

**Interfaces:**
- Produces: `experience.record(path, lineage, decision, outcome)->experience` (append-only; rewriting an existing entry raises `immutable-entry`), `experience.applicable(exp, conditions)->entries` (exact match on `stage`, `precision`, `toolVersion`; scenario match or `"*"`); `residual.extract(evaluation, observation, exp, readiness)->list[residual-case]`.

- [ ] **Step 1: Failing tests**: failure recorded under `precision gba` is not returned for a `pba` query; predicted vs measured difference stored; residual for a check dominated by net delay with high fanout sets evidence fields; `suggestedStage` is `null` whenever `readiness.scope == "post-route-only"` (and `requiredInputs` names the lifecycle items), and `route`/`cts`/`place` only under `full-flow`; a check with only unknown slack produces no residual (it is a coverage problem, not a residual).
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): experience ledger and residual cases (M8)`; push.

### Task 11: Lifecycle — APR intervention and stage task

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:** Create `flow/atcs/lifecycle.py`, `flow/templates/apr-stage.tcl`, `flow/tests/test_lifecycle.py`.

**Interfaces:**
- Produces: `compile_intervention(residual_cases, stage, readiness)->{"stage","hookTcl","readbackTcl","expected"}`, `stage_task(stage, readiness, intervention, workspace_root)->{"tcl","inputs[]","outputs[]"}`. Intervention kinds limited to: path-group effort/weight (`setPathGroupOptions`), useful skew (`setUsefulSkewMode`, `set_ccopt_property`), cell padding / placement blockage (`specifyCellPad`, `createPlaceBlockage`). `setAttribute -weight` is excluded (documented contradiction, source doc 4 playbook §8).

- [ ] **Step 1: Failing tests**: `post-route-only` readiness → `AtcsError("lifecycle-unavailable")` for any stage; stage not in the verified lifecycle → refusal; readback Tcl queries every setting the hook sets; hook paths are workspace-relative and never the Foundation root; the stage task restores the matching checkpoint (`<stage-1>` checkpoint) and writes outputs under `apr/<stage>/<id>/`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): residual-driven APR stage tasks`; push.

### Task 12: Tool adapters, templates and CLI

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:**
- Create: `flow/atcs/adapters.py`, `flow/atcs_cli.py`, `flow/templates/{pt-scenario.tcl,pt-query.tcl,pt-presta.tcl,starrc.cmd,innovus-eco.tcl,innovus-export.tcl,xtop-operator.tcl,xtop-analysis-manual.tcl,xtop-replay.tcl}`, `flow/tests/test_adapters.py`
- Reference (copy patterns, not code identity): `packs/xtop-timing-closure/flow/closure.py` (PT/StarRC/Innovus task compile, `run_starrc`/`starrc_shell_env`, XTop operator ~747), `packs/xtop-timing-closure/flow/templates/`.

**Interfaces:**
- Produces: `atcs_cli.py <subcommand> <workspace> [args]` with subcommands `bind-inputs`, `baseline`, `observe`, `risk`, `prepare-workers`, `capture-contribution <slot>`, `collect`, `compose-facts`, `replay-prepare`, `reconcile`, `presta`, `implement`, `extract`, `sta`, `physical`, `evaluate`, `adopt`, `residual`, `apr-prepare`, `record-experience`; each reads declared artifacts under `<workspace>/state|research|contributions|integrations|implementations|accepted` (layout: architecture §13.4) and writes exactly one declared output. `xtop-analysis-manual.tcl` defines typed procedures (`atcs_query_paths`, `atcs_query_cells`, `atcs_size_cell`, `atcs_insert_buffer`, `atcs_delete_buffer`, `atcs_dump_cells`, `atcs_export_changes`) that each append one JSON line to `ops.jsonl` for mutations — the M3 trace.

- [ ] **Step 1: Failing tests**: every subcommand refuses a missing declared input with exit code 2 and a JSON error on stderr (no partial output file); PT scenario task compiles all four scenario names, `max_paths`/`nworst` and PBA mode exactly from `query_spec`; the StarRC task writes into a new private work dir and never into the input's directory; the Innovus ECO task sources the merge commit's `innovusEcoTcl` and exports DB/DEF/netlist under `implementations/<mergeId>/`; `xtop_operator` argv carries the workspace-manifest `namePrefix`; typed procedures reject a target outside the edit domain list passed at session start; no template references `/data/eda/project/design_zoo`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): tool adapters and task templates`; push.

### Task 13: Readers and semantics

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:** Create `semantics.yml`, `readers/*.yml` (one per read output), `tools/read-atcs.py`, `flow/tests/test_readers.py`.

**Interfaces:**
- Produces: `read-atcs.py <kind> ${REPORT} ${OUT}` emitting the Harness Reader document (shape: `.superpowers/sdd/pack-mechanics.md` §1.13–1.14) with the `tc_*` values of SPEC "Semantics" plus `tc_next_action` and `tc_selected_contribution_count`; it re-validates the artifact's `schema`, `id` and `sources` hashes, never trusting producer booleans. Each value names its unit (`ns` or `count`) and, for WNS values, `mode`.

- [ ] **Step 1: Failing tests**: every `tc_*` in SPEC is emitted by some reader kind; a tampered artifact (`id` mismatch) → reader exits non-zero; a source file whose sha256 changed → non-zero; Measure unknown → value omitted with `unknown` reason (never 0); `next-decision` with an action outside the eight → `tc_next_action` unknown; `tc_required_input_missing_count` 0 only from a complete readiness document.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(atcs): fail-closed readers and semantics`; push.

---

## Phase C — Compile and check (L0/L2)

### Task 14: contract.yml, graph.yml, rules, choosers, Workshops, FABRIC.md

**Model:** implementer `opus`; reviewer `opus`.

**Files:** Create `contract.yml`, `graph.yml`, `rules/*.yml`, `choosers/*.yml`, `FABRIC.md`; Modify: nothing outside the Pack.

**Interfaces:**
- Consumes: SPEC.md (T1), knowledge (T2), CLI subcommands (T12), readers/semantics (T13), schema reference `.superpowers/sdd/pack-mechanics.md`.
- Produces: a Pack that `loadPack` accepts and `checkPack` against `sites/linglong-atcs28` (T15) reports `fit`.

Graph requirements (SPEC "Run contract" reference-graph behaviour 1–9):
1. `bind-inputs` → read readiness → judge `inputs-ready` (FAIL → wait `missing-inputs`).
2. `baseline` (reuse hash-bound baseline SPEF/PT when the manifest provides them, else extract+STA) → read observations → `risk` → read risk atlas.
3. Workshop `diagnose-and-observe` → read `observationRequest` → judge `request-admissible` (FAIL revisits diagnose) → `observe` query tool → read observations.
4. Workshop `plan-campaign` → read `campaignPlan` → `prepare-workers` → for each slot 01–03: Workshop `research-worker-NN` → read `workerRequestNN` → XTop operator (interactive tool) → `capture-contribution NN` → read `workerResultNN`. Slots run sequentially unless a contract test proves Workshops inside a fork (record the outcome in FABRIC.md "Gaps").
5. `collect` → `compose-facts` → Workshop `compose-contributions` → read `integrationPlan` → judge `composition-ready` → `replay-prepare` → XTop replay (interactive) → `reconcile` → judges `replay-consistent-mismatch`, `replay-consistent-scope`.
6. `presta` → judge `presta-model-qualified` (FAIL does not terminate; routes to the next-decision path).
7. `implement` → `extract` → `sta` → `physical` → `evaluate` → judges `final-evidence-ready-coverage`, `final-evidence-ready-identity`, `required-constraints-pass-failures`, `required-constraints-pass-unknowns`, `setup-goal`, `hold-goal`, `artifact-ready` (all goal-path judges in that order) → `adopt`.
8. `residual` → `record-experience` → Workshop `evaluate-next-investment` → read `nextDecision` → judge `continue-or-wait` (FAIL → wait `scope-or-input-required`) → routing on `tc_next_action` through chained judges to revisit observe / research / compose / revise / implement / `apr-prepare` (earlier-apr, full-flow only) → explore node with chooser whose goal-met move requires all final rules passed.
9. No `converge` block (SPEC disables score-based convergence); the Run's budget ending is the Runtime's.

- [ ] **Step 1:** Write `contract.yml` (inputs `designStateManifest`, `analysisContract`, `siteCapabilities`, `workspaceRoot`; every output in SPEC "Run contract" with reader; tools with argv `[python3, '${FLOW_ROOT}/atcs_cli.py', <subcommand>, '${WORKSPACE}', …]` and licences `innovus`, `primetime`, `starrc`, `xtop` = 1 where they launch EDA; interactive XTop tools with typed commands matching T12 procedures; five Workshop families (worker expanded to three); `workspace.source: pack`; budget `timeBoxMs` 86400000 max with `closingReserveMs` 1800000; goal knobs; one strategy knob `workerSlots` number 1..3 default 3).
- [ ] **Step 2:** Write rules (one predicate per file), choosers, `graph.yml` per requirements.
- [ ] **Step 3:** Temporary local check: `export PATH="$HOME/.local/node24/bin:$PATH"; pnpm run build` then a Node one-off (scratchpad, not committed) that calls `loadPack(repoRoot+'/packs','agentic-timing-closure-system')` and prints errors. Iterate until load succeeds. Full `checkPack` fit waits for T15.
- [ ] **Step 4:** Write `FABRIC.md` (`## Files written`, `## Gaps`, `## Reviews`) — every file, every unexpressible SPEC behaviour, and the fork-of-Workshops question.
- [ ] **Step 5:** Commit `feat(atcs): compile contract and reference graph`; push.

### Task 15: Site and contract test

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:**
- Create: `sites/linglong-atcs28/{site.yml,permit.yml,README.md}`, `sites/linglong-atcs28/atcs-xtop-operator.sh` (admin-installed wrapper template: fixed Pack adapter path, old-mode check preserved, no bypass), `test/contract/agentic-timing-closure-system.test.ts`
- Modify: `test/contract-groups.json` (add the test to the `local` group).
- Reference: `sites/linglong-swerv28/*`, `test/contract/xtop-timing-closure.test.ts`.

- [ ] **Step 1:** Write the contract test first: `loadPack` succeeds; node/edge counts asserted; `checkPack(pack, loadSite(local))` and against `linglong-atcs28` both `fit`; through `bootInProcess` `/hima pack check agentic-timing-closure-system --site local` succeeds; spawns `python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v` and asserts exit 0; asserts no tool argv references `/data/eda/project/design_zoo` or `xtop-timing-closure-runs`.
- [ ] **Step 2:** Run `node scripts/run-contract-tests.mjs local --files test/contract/agentic-timing-closure-system.test.ts` → FAIL (no site).
- [ ] **Step 3:** Write the Site: new `workspaceRoot` `/data/eda/project/hima_harness/atcs-runs`, bindings for the four inputs (manifest files under `/data/eda/project/hima_harness/atcs-inputs/`), capacity `parallelJobs: 1`, licences `innovus/primetime/starrc/xtop: 1`, Permit read roots (Foundation root, techlib, inputs) and write root (`atcs-runs` only).
- [ ] **Step 4:** Run → PASS; also `pnpm run check:boundary`. Commit `test(atcs): site binding and contract test`; push.

---

## Phase D — Real-input qualification (L4) — checkpoints with the user

### Task 16: Real-corpus preflight (read-only)

**Model:** implementer `sonnet`; reviewer `sonnet`.

**Files:** Create `scripts/atcs-corpus-preflight.py`, `docs/assessment/2026-09-26/atcs-qualification/corpus-preflight.md`.

- [ ] **Step 1:** Script copies nothing into the repo: over SSH it streams each real report (Foundation `SIGNOFF/ROUND3/PT/reports/<scenario>/{global_timing,setup,hold,check_timing,constraints}.rpt`, `RPT/xtop_round2_eco_route/verify_{drc,connectivity}.rpt`, StarRC logs, B_lazy Run `flow/iterations/g001` reports) through the Pack parsers locally and prints per-file: parsed/unknown fields, completeness, refusals.
- [ ] **Step 2:** Every refusal is either a real defect (fix the parser in its owning task's module with a new synthesized fixture reproducing the grammar) or a correct fail-closed outcome (documented). Commit `test(atcs): real report corpus preflight`; push.

### Task 17: Real-tool qualification — **stop and ask the user before each job**

**Model:** implementer `sonnet` (drives commands the user approved); reviewer `sonnet`.

- [ ] PT query + presta on the Foundation round-3 state in a new `atcs-runs/qual-*` directory (PrimeTime licence).
- [ ] StarRC extraction of one exported DEF into a private work dir.
- [ ] Innovus: restore checkpoint → apply a two-op merge commit → export → readback of instance→master relation.
- [ ] XTop Operator session with `xtop-analysis-manual.tcl` — requires the licence mode `old`, which the administrator must arrange; the new wrapper binding must be generated by the admin protocol (`scripts/generate-xtop-operator-binding.mjs` pattern), never by editing hash fields.
- [ ] Record each job's command, exit, artifacts and hashes in `docs/assessment/2026-09-26/atcs-qualification/tools.md`.

### Task 18: Minimum vertical acceptance, TEST and release — **user checkpoint**

- [ ] Real Campaign (test-marked) on `linglong-atcs28`: two complementary worker contributions, one shared-precondition revision, one joint implementation + full refresh (source doc 4 §13 "最小垂直验收").
- [ ] `TEST.md` from the terminal Run via `/hima-test`; B_lazy same-oracle comparison recorded separately.
- [ ] `/hima-release` generates `VERSION.yml`; install/upgrade preview, stale-review refusal and rollback verified.

---

## Self-review

- Spec coverage: SPEC chapters → T1; knowledge → T2; M1–M8 → T3–T10; Residual/APR (P6a) → T10–T11; adapters (P1–P5 tools) → T12; Readers/semantics → T13; rules/choosers/graph/Workshops → T14; Site/tests → T15; corpus preflight → T16; tool qualification → T17; vertical acceptance/TEST/release → T18. Architecture §17.1 cases map to T5–T9 tests.
- Known risks recorded for T14: judge routes on first rule only (chained judges), Workshops inside forks unverified (sequential slots), multi-way routing via `tc_next_action` judge chain.
