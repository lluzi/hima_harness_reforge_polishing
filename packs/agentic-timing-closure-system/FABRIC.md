## Files written

Task 14 compiled the executable method from `SPEC.md` and the reviewed Pack code (`flow/atcs/*.py`,
`flow/atcs_cli.py` as of Task 12c, `flow/templates/*`, `tools/read-atcs.py`, `semantics.yml`,
`knowledge/*.md`). Apart from the files below it made two small changes to Pack code: the
next-decision `stage` check in `tools/read-atcs.py`, and the removal of the unused `_apr_task_path`
helper from `flow/atcs_cli.py`.

- `contract.yml` — 4 inputs, 42 outputs (18 with a reader, every `readers/*.yml` bound; 7
  `<output>Problems` sidecars, G36), 26 tools
  (25 `python3` subcommand tools of `flow/atcs_cli.py` -- `compose-facts` and `compose-facts-admitted`
  both run its `compose-facts`, G40 -- and 1 interactive-only XTop Operator tool),
  7 Workshops (5 families, the worker family expanded to slots 01–03), 24 rules, 3 Goal parameters
  (`target_setup_wns_ns`, `target_hold_wns_ns`, `max_physical_refreshes`), 1 Strategy knob
  (`maxPaths`), 17 knowledge files (10 method files, `endpoint-resolution.md` (G41), 5 Reader-admitted Workshop examples,
  `example-*.md`, Issue #63 -- slice 3 added the observation-request and integration-plan examples, so
  every request-producing Workshop has one -- and `agent-team.md`, the owner's Team guidance, declared
  in slice 3 so the owner's Pack knowledge search reaches it). Each worker Team member's
  `taskTemplate` ends with one example reply holding exactly its `resultSchema.required` fields.
- `graph.yml` — 111 nodes (62 act, 38 judge, 10 explore, 1 wait), 150 edges, 10 revisit edges.
  Issue #63 slice 3 (G37): `check-worker-request-01` FAIL goes to `retry-worker-01` (Explore,
  `atcs-revisit`), which revisits `research-worker-01` (+1 node, +1 edge), replacing its FAIL edge
  to `wait-for-person`.
  Issue #63 slice 2: `read-refresh-budget` → `check-refresh-budget` between `check-presta-model`
  PASS and `implement`, and `read-refresh-budget-apr` → `check-refresh-budget-apr` before
  `apr-prepare` (+4 nodes, +6 edges); `revisit-implement` and `revisit-earlier-apr` now enter at
  the reading, so every physical refresh passes one fresh budget check (G35).
  Final review (Minor): `check-setup-goal`/`check-hold-goal` each gained an explicit
  `UNDETERMINED` edge to `residual` (+2 edges) -- an unknown final setup/hold WNS is an
  evidence gap the residual/next-decision loop can investigate, the same as a coverage,
  identity or constraint-unknowns FAIL already routes there, never a person-facing wait;
  the engine's edge-label schema (`verdictOutcome.options`) allows a judge node's
  UNDETERMINED outcome to be labelled explicitly, same as PASS/FAIL.
- `rules/inputs-ready.yml`
- `rules/lifecycle-available.yml`
- `rules/request-admissible.yml`
- `rules/request-checked.yml`
- `rules/composition-ready.yml`
- `rules/replay-consistent-mismatch.yml`
- `rules/replay-consistent-scope.yml`
- `rules/presta-model-qualified.yml`
- `rules/final-evidence-ready-coverage.yml`
- `rules/final-evidence-ready-identity.yml`
- `rules/required-constraints-pass-failures.yml`
- `rules/required-constraints-pass-unknowns.yml`
- `rules/setup-goal.yml`
- `rules/hold-goal.yml`
- `rules/artifact-ready.yml`
- `rules/continue-or-wait.yml`
- `rules/next-action-observe.yml`
- `rules/next-action-research.yml`
- `rules/next-action-compose.yml`
- `rules/next-action-revise.yml`
- `rules/next-action-implement.yml`
- `rules/next-action-earlier-apr.yml`
- `rules/next-action-goal-met.yml`
- `choosers/atcs-revisit.yml`
- `choosers/atcs-goal-met.yml`
- `readers/atcs-campaign-plan.yml` (replaces `readers/atcs-work-package.yml`, which no output used
  once the campaign plan became one document).
- `FABRIC.md`
- `tools/read-atcs.py` — one check: a `next-decision` whose action is `earlier-apr` must name a
  `stage` in `atcs_cli.APR_STAGES` (place, cts, route, postroute), else it is inadmissible;
  `apr-prepare` reads that stage from the same document.
- `flow/tests/test_records.py` — FABRIC headings; graph rules and choosers resolve to files; every
  output reader has a file and every reader file an output; tool-written output paths equal
  `atcs_cli.py`'s path table; the Reader's APR stages equal `atcs_cli.APR_STAGES` and the graph fixes
  no stage; the split-rule Judge chains run in SPEC order (mismatch → scope; coverage → identity →
  constraint failures → constraint unknowns → setup Goal → hold Goal); every Explore is entered
  from a Judge listing at least two rules; every tool's argv arity equals the "Extra args" column
  of `atcs_cli.py`'s documented subcommand table.
- `test/contract/agentic-timing-closure-system.test.ts` — node/edge count assertion only.

How the reference graph expresses SPEC behaviour 1–9:

- Inputs and baseline: `bind-inputs` → `inputs-ready` (FAIL → wait) → `baseline` (seeds
  `state/working-state.json`) → `observe-baseline` → `policy` (Goal targets bound from the Run) →
  `physical-baseline` → `risk` → `residual` (PT path-detail evidence for the baseline's failing
  checks) → the owner's first decision, `evaluate-next-investment`, taken on the baseline itself.
- Research: `diagnose-and-observe` → `request-admissible` (FAIL revisits the Workshop) →
  `observe-query` → `risk` → `plan-campaign` → `request-admissible` → `prepare-workers` → slots 01,
  02, 03 in sequence (Workshop → request reading → `request-admissible`, FAIL skips the slot → XTop
  Operator → `capture-contribution` → result reading) → `collect`.
- Composition: `compose-facts` (no resolutions) → `compose-contributions` → `request-admissible` on
  the one integration-plan document → `compose-facts` again with the admitted plan's resolutions →
  `composition-ready` → `replay-prepare` → `reconcile` → `replay-consistent-mismatch` →
  `replay-consistent-scope` → `presta` → `presta-model-qualified` (FAIL → next decision).
- Implementation: fresh `workingState` reading → `refresh-budget` (FAIL/UNDETERMINED → wait) →
  `implement` → `extract` → `sta` → `physical` → `evaluate` → coverage → identity →
  constraint failures (FAIL → `adopt`, where M7 bars best/delivery) → constraint unknowns → setup
  Goal → hold Goal → `adopt` → `artifact-ready` → `residual` → `record-experience` → next decision.
- Decision: `request-admissible` → `continue-or-wait` (FAIL → wait) → routing Judges on
  `tc_next_action` (observe, research, compose, revise, implement, earlier-apr, goal-met), each
  ending in its own Explore node's single revisit edge.
- Earlier APR (executable): fresh readiness reading → `check-apr-scope` → fresh `workingState`
  reading → `refresh-budget` (FAIL/UNDETERMINED → wait) → `apr-prepare` (stage from
  the admitted next-decision) → `apr-run` (Innovus) → the implementation chain from `extract`.
- Goal met: fresh readings of the acceptance record and the final evaluation → every final rule
  again → `atcs-goal-met`, which the Harness refuses unless every gate verdict passed.
- There is no `converge` block; the Run's budget ending is the Runtime's.

## Gaps

2026-09-27 bounded integration: `atcs-worker-01` reuses the frozen Issue #52 Team seam.
The current research path runs only w01 through adopted Researcher/Reviewer results, one typed sizing
Operator, Contribution Reader and collect. w02/w03 and three-worker optimization are deferred under
the coordinator's executable-convergence scope. ATCS-02 required no Runtime changes: the exact
Researcher result is a retained dependency and the existing Workshop output remains the action authority.
Local Host/Tcl fixtures prove the mechanism; commercial qualification remains a separate gate.

Every tool and reader `contract.yml` names is held in this folder (tools run `flow/atcs_cli.py` or
the Site's XTop Operator wrapper; readers run `tools/read-atcs.py`). None of the gaps below is
closed by a hidden loop or background process.

Schema limits and how the graph expresses them:

- G1 Historical imported graph: worker slots ran sequentially, and every round ran all three before
  `collect`. The current bounded graph schedules w01 only, with a native Team and direct collect;
  the three-worker parallel optimization remains deferred. The original limitation below is retained
  as source history: a batch
  can never seal while a slot is still researching, the opposite of SPEC Constraint 7's dynamic
  batching (`pending` is non-empty only for a skipped or stale slot), and a slot with nothing worth
  fixing still costs an XTop Operator session to end as a no-fix. A variant forking the three slot
  chains was refused by `loadPack` (`exploreAfter`: every path from a join to an Explore needs a
  fresh reading and a two-rule Judge with no single-rule Judge after it); a branch holds act nodes
  only, so the per-slot `request-admissible` gate cannot sit in it; and Workshop moments and
  interactive admissions inside `driveBranch` are runtime-unproven.
- G2 A worker request that fails `request-admissible` skips its slot to the next one: there is no
  per-slot revise loop, so that slot contributes nothing this round until a later research revisit
  re-plans it.
- G3 One wait node per graph: the SPEC's `missing-inputs` (inputs-ready FAIL) and
  `scope-or-input-required` (continue-or-wait FAIL) waits, the impossible routing fall-through and
  every unlabelled UNDETERMINED all stop at `wait-for-person`; the failing verdict names which.
- G4 A Judge routes on its first rule only and an Explore with a chooser has one outgoing edge, so
  `tc_next_action` routing is a chain of two-rule Judges (`next-action-<x>`, `continue-or-wait`) with
  one Explore node per revisit target (diagnose, plan, collect, compose-facts, read-refresh-budget
  before implement, read-refresh-budget-apr before apr-prepare, the next-investment Workshop). The chooser `atcs-revisit` makes no domain choice.
- G5 `maxPaths` (100..5000 paths, default 1000) caps the paths per scenario both observe tools use.
  A chooser clause must set a knob and cannot read the Strategy it is on, so every revisit sets
  `maxPaths` to the bound 1000: a Run-start override holds for the first Generation only.
- G6 An Explore weighs only the last Judge of its Generation, which must list two rules whose
  verdicts all cite the Generation's latest readings (`exploreEvidence`, node-turns.ts). Hence
  `request-checked` (`tc_request_invalid_count >= 0`) pairs with `request-admissible`; the
  earlier-apr route re-reads `inputReadiness`; the goal-met route re-reads `acceptanceRecord` and then
  `finalEvaluation`; and `artifact-ready` also requires `tc_final_setup_wns_ns` so its verdict cites
  the final re-read. Goal-met therefore survives a revisit after `adopt`. The two re-read files are
  the latest ones and no rule checks they describe one candidate; the graph keeps them consistent
  (every evaluation is followed by `adopt` except after a coverage, identity or constraint-unknowns
  FAIL, and such an evaluation fails the goal-met gate itself). A goal-met decision before any
  adoption stops at `reread-acceptance` (no acceptance record exists).
- G7 SPEC Constraint 5 (temporary degradation with a follow-up, a limit and a deadline): the limit is
  M7's `allowDegradedWorking`, `degradeLimitNs` and `maxNewConstraintFailures` in the stamped policy;
  the deadline is only the Run's time box (`timeBoxMs` 86400000, `closingReserveMs` 1800000), not a
  per-degradation deadline; the follow-up is structural (every adopted candidate passes residual →
  record-experience → `evaluate-next-investment`, whose purpose requires naming the follow-up and
  falsifier) but no typed value checks it.
- G8 SPEC chooser evidence (waiting value, dependency, joint-verification cost, time comparison for
  earlier APR) is weighed by the Workshops, not by a chooser; no rule reads `tc_pending_research_count`,
  `tc_ready_contribution_count`, `tc_selected_contribution_count` or the XTop/presta WNS values (they
  are observed only). An empty batch's waiting-value reason is required in words only.

Deviations from the brief where the code is the authority:

- G9 Tool argv use `${WORKSPACE}/flow/atcs_cli.py`, not `${FLOW_ROOT}/atcs_cli.py`: `FLOW_ROOT` is
  bound only for Packs declaring a `flowRoot` input, and `workspace.source: pack` deploys `flow/` into
  `<workspace>/flow/`, where `tools/read-atcs.py` also imports `atcs` from.
- G10 `maxPaths` is an argv value of `observe` only (`baseline` runs no PT query). `policy` runs after
  `observe-baseline`, not directly after `baseline`, because it derives `baselineMinWns` from the
  baseline observation; for the same reason `observe` and `residual` read the scenario-to-corner
  map from `analysisContract/scenario-corners.json`, not from `state/policy.json`.
- G11 No interactive XTop replay node: `replay-prepare` itself replays the steps in XTop (batch,
  through `edaShell`), so it holds the `xtop` licence and `reconcile` follows it.
- G12 `artifact-ready` is judged after `adopt` (its value comes from `acceptanceRecord`). `adopt` runs
  after the setup/hold Goal Judges whether they pass or fail and after a constraint-failures FAIL (M7
  keeps best and delivery barred and applies `maxNewConstraintFailures`); a coverage, identity or
  constraint-unknowns FAIL goes to `residual` without adoption.
- G13 `baseline` has no reuse-of-baseline-SPEF/PT branch and no baseline extraction: the CLI builds
  the design-state and `observe-baseline` always runs PT on the manifest's SPEF.
- G14 `baselineState`, `workingState`, `currentObservations`, `riskAtlas` and `acceptancePolicy` have
  no Reader (no `tc_*` value is sourced from them), so no node observes them; Workshops read them
  through `reads`.
- G15 The SPEC's `workerManifestNN` is one output, `workerManifests` (`state/workers.json`), because
  `prepare-workers` writes one index for all slots.
- G16 The Operator's `before.dump`, `after.dump` and `summary.json` are not Ledger readings;
  `contributions.seal` re-validates them when `capture-contribution` reads them.
- G17 (final review batch B: refreshed for accuracy) Earlier APR is executable end to end in the
  graph and reachable from the baseline round: `residual` gives PT path-detail evidence (from the
  baseline observation or the latest evaluation), the next-investment Workshop may choose
  `earlier-apr` with a stage, and the route runs `apr-prepare` → `apr-run` → the implementation
  chain. `check-apr-scope` judges `[lifecycle-available, inputs-ready]` on a fresh readiness reading
  and routes on `lifecycle-available` alone (the second rule is the verdict the Explore needs); a
  post-route-only scope FAILs back to the next-investment Workshop through `revisit-next-decision`,
  not to wait, and `apr-prepare`'s own scope refusal is a second line the graph does not reach.
  `apr-prepare` fails the node (`no-intervention`) when no residual case yields a stage setting.
  `apr-run` itself is now more independently verifiable than the original text of this gap implied:
  it recompiles the same stage task from the current residual-cases/readiness/working-state on disk
  and refuses if that does not reproduce `state/apr-task.json`'s own recorded `tcl`/`taskId` (I8), and
  its predecessor-stage checkpoint is now actually staged into the workspace at `baseline` time (I2,
  see G29) rather than referencing a path nothing ever populated. Both are still self-consistency
  checks within this Pack's own recorded state, not proof against real Foundation data -- the
  `restoreDesign` convention itself (G29) and the whole route are still not yet run with real tools
  (Task 17).
- G18 `residual` runs bounded PT path-detail queries (the 20 worst known checks) at every Campaign
  start and after every evaluation. Decisions reached from a pre-implementation failure route (plan,
  integration plan, composition, replay or pre-check) see the residual cases of the baseline or the
  last evaluation, not refreshed ones.

Known gaps carried from earlier tasks:

- G19 (Task 12) `presta` compares the batch's new nets against the working state's SPEF, so
  `tc_unqualified_rc_net_count > 0` for every batch containing `insert_buffer`; such batches always
  route to the next decision and are implemented only by an explicit implement decision.
- G20 (Task 12; final review batch B: refreshed for accuracy) `parse_path_detail` is unverified
  against a real PT per-arc report; the earlier-APR route now depends on it (via `residual`'s own
  `pt-query.tcl` evidence gathering, `_collect_residual_evidence`). `pt-query.tcl` gained a
  library-linking/driver-library-SDC-normalization preamble in this batch (C4/G27, so `residual`'s
  own `link_design` can succeed against a real netlist at all) -- this changes nothing about the
  `report_timing -from -to ... -input_pins -nets -transition_time -capacitance` output format
  `parse_path_detail` itself parses, so this gap's scope is unchanged, not narrowed.
- G21 (Task 12) Side files left by an EDA run that fails mid-way are untested.
- G22 (Task 9) Adoption is single-writer; `designStateId` honesty rests on `sta` building the
  design-state from the implemented DB, which M6 does not cross-check.
- G23 (Tasks 15, 17) The XTop Operator is `interactive-only`; its settlement in a real Run is
  unproven. Task 15's Site wrapper (`sites/linglong-atcs28/atcs-xtop-operator.sh`, contract
  `<wrapper> <workspace> <slot>`) and the administrator's interactive binding still need L4
  qualification.
- G24 (Task 15) `checkPack` is fit against `linglong-atcs28` and the local Site; against the frozen
  `linglong-swerv28` it is unfit only on Site facts (unbound inputs, `python3` and the ATCS wrapper not
  permitted, `innovus`/`primetime`/`starrc`/`xtop` licences undeclared), which is expected.
- G25 (final review, Minor) `contract.yml`'s `target_setup_wns_ns`/`target_hold_wns_ns` Goal knobs
  are declared `min: 0, max: 0` -- the Global Constraint already fixes both at `0.0`, and this Pack's
  own evidence cannot honestly support any other value: `setup-goal`/`hold-goal` require `tc_final_
  setup_wns_ns`/`tc_final_hold_wns_ns >= target`, but `atcs.reports.parse_global_timing` can only ever
  report a *known* WNS for a clean mode as exactly `known(0.0)` (PT's own "No setup/hold violations
  found." line carries no positive-margin figure) -- a genuinely positive final WNS is not a value
  this Pack's report parsing can produce at all, known or otherwise. A Run configured with a knob
  above `0.0` could therefore never pass its Goal even with every violation fixed, which is a
  configuration this Pack itself is guaranteed to make un-satisfiable, not a Campaign that could
  plausibly still succeed. `min == max == 0` makes the schema itself refuse that configuration rather
  than admitting a Run this Pack cannot ever complete.
- G26 (final review, I12) `research/observe/`/`research/residual/`'s raw PT evidence directories are
  now per-generation write-once (`atcs_cli._next_evidence_generation_dir`, a `g<N>` subdirectory named
  from a monotonic counter file, never a directory-existence scan); `integrations/<batchId>/` is
  write-once by refusal (`AtcsError("batch-id-reused", ...)`) instead, since a `batchId` is an
  external, Workshop-authored identity this dispatcher never invents. No declared output path or
  `contract.yml`/`graph.yml` shape changed -- every Reader-facing artifact was already
  content-addressed or fixed-"latest"; only the *raw*, non-declared evidence directories a failed or
  repeated run could previously have silently overwritten are affected.
- G27 (final review batch B, C4) Per-scenario library identity is now Site-declared:
  `analysisContract/scenarios.json` (`[{name, corner, libGlob, driverLibrary,
  originalDriverLibrary}]`) replaces the old bare `scenario-corners.json`, and
  `observe`/`sta`/`residual`/`presta` all actually thread `libGlob`/`driverLibrary`/
  `originalDriverLibrary` into their PT tasks (`pt-scenario.tcl`/`pt-presta.tcl`/`pt-query.tcl` all
  gained the `target_library`/`link_path`/driver-library-SDC-normalization block `pt-scenario.tcl`
  alone had before -- `pt-presta.tcl`/`pt-query.tcl` could not previously have linked any real,
  non-trivial netlist at all). `sta` hashes each scenario's own matched `.db` files fresh
  (`adapters.hash_library_glob`) and records them in `sta_receipts[scenario]["inputs"]["libraries"]`;
  `verification._missing_identity_legs` treats an absent/empty `libraries` list as a missing identity
  leg. This is a fail-closed *presence* check only, not a cross-generation library-drift detector:
  there is no earlier per-generation declaration of a scenario's expected library set to diff a later
  one against (unlike netlist/SPEF, which flow `implement -> extract -> sta`), so a library set that
  silently changed between two generations of the *same* Campaign (a Site editing `scenarios.json`
  mid-Campaign) would not itself be flagged as an identity error -- only its total absence would be.
  `policy`'s own `scenarioCorners`/`requiredScenarios` are now derived from `scenarios.json` (the
  single source); a static `policy.json` may still carry either field for documentation, but is
  refused if it disagrees with the derived value.
- G28 (final review batch B, I1) StarRC extraction now uses each corner's own Site-provided template
  (`analysisContract/corners.json`: `{"corners": {corner: templatePath}}`, hashed and recorded in
  `state/extract.json`'s `spef[corner].template`) instead of this Pack's one shipped `starrc.cmd`
  fallback for every corner regardless -- real Foundation corners (`cworst_T`/`cbest`) each need their
  own qualified command-file template (`STAR_MODE`, layer stack, etc. genuinely differ per corner).
- G29 (final review batch B, I2; **post-route restore form closed in fix batch C** -- full-flow APR
  stage pre-steps remain open, see below) `baseline` stages every declared full-flow lifecycle
  stage's own checkpoint (`.enc` script + `.enc.dat` directory) into `<workspace>/DBS/<stage>.
  enc(.dat)`, the exact workspace-relative location `atcs.lifecycle.stage_task` has always restored
  from but that nothing ever populated before batch B -- an `apr-run` for any stage past the very
  first would previously have restored a checkpoint that was never actually staged.

  **Fix batch C:** `innovus-export.tcl`/`innovus-eco.tcl`/`apr-stage.tcl` used to call
  `restoreDesign` on `CURRENT_DB`/`CHECKPOINT` alone -- this Pack's own database-identity convention
  names the `.enc` restore-SCRIPT path (`design-state.database.path`; `apr-stage.tcl`'s `CHECKPOINT`
  is already `./DBS/<prevStage>.enc.dat`), but a real Innovus `restoreDesign` call needs the `.enc.dat`
  DIRECTORY plus the top cell name, never the script path alone and never the directory without the
  top cell. Foundation evidence (read-only, `DBS/xtop_round2_eco_route.enc`): the real restore script
  itself runs `restoreDesign …/xtop_round2_eco_route.enc.dat swerv_wrapper` -- every Foundation flow
  restores the `.enc.dat` directory with the top cell, never the script itself and never the directory
  alone. `innovus-export.tcl`/`innovus-eco.tcl` now call `restoreDesign $env(CURRENT_DB).dat
  $env(DESIGN)` (matches `atcs.state.design_state`'s own `f"{path}.dat"` convention for `datDigest`);
  `apr-stage.tcl` now calls `restoreDesign ${CHECKPOINT} ${TOP}`, with `atcs.lifecycle.stage_task`
  gaining a required `top` parameter (`_cmd_apr_prepare`/`_cmd_apr_run` both supply
  `working_state["top"]`) -- the pre-fix template named no top cell at all. `FF/vars.tcl` was read
  (per this fix's own controller decision) and confirmed NOT needed for this fix: it only fills a Tcl
  `vars()` array, nothing this Pack's own `restoreDesign` call reads.

  **Still open:** `innovus-eco.tcl`/`innovus-export.tcl`/`apr-stage.tcl`'s restore calls do not source
  the rest of the Foundation flow config (`FF/procs.tcl` and any Foundation CTS/route-stage spec) the
  old qualified `xtop-timing-closure` Pack sources before running a full-flow stage command
  (`packs/xtop-timing-closure/flow/templates/apply-eco.tcl`'s own `cd $env(WORK_ROOT)` / `source
  FF/vars.tcl` / `foreach file $vars(config_files) { source $file }` / `source FF/procs.tcl`
  preamble, read-only reference). This is now scoped narrowly to full-flow APR stage PRE-STEPS
  (procs/CTS-stage spec a `place`/`cts`/`route`/`postroute` stage command may itself depend on), not
  the restore call itself (closed above) -- implementing it speculatively, without live
  re-verification of the exact `FF/procs.tcl`/CTS-spec contract and how it would interact with this
  Pack's own `OUTPUT_ROOT`/per-generation directory convention, was judged a higher risk of
  introducing an unverifiable regression than leaving it open. A real full-flow Run reaching a stage
  PAST the first may still fail inside the stage command itself (not at `restoreDesign`, now fixed)
  until this is closed with server access to confirm the exact contract. The bounded post-route-only
  route (`implement`/`extract`/`sta`/`physical`/`evaluate`/`adopt`, no `apr-run` stage command
  involved) does not depend on this gap at all.
- G30 (final review batch B, I3) `xtop-replay.tcl` now builds its own fresh XTop workspace from the
  batch's own base-state LEF/netlist/DEF (`create_workspace`/`link_reference_library`/
  `create_design_definition`/`import_designs`, the same shape a worker session's own
  `xtop-operator.tcl` startup uses) instead of calling `open_workspace` on an Innovus `.enc` restore
  script, which could never actually have opened anything real (`open_workspace` opens a previously
  *saved XTop* workspace, not an Innovus checkpoint). A replay run that fails outright is recorded
  (`state/replay-receipts.json`'s own `toolFailure` field), never silently swallowed; `tools/
  read-atcs.py`'s `tc_replay_mismatch_count` is now `unknown` whenever any step is `pending`, `failed`
  or an `unknownReceipts` entry, since that step's true mismatch status was never established.
- G31 (batch A2, I5 -- restated here for FABRIC completeness) `fixedCheckCount`/
  `missingPriorCheckCount` can be `unknown` for two independent, indistinguishable-from-the-artifact
  reasons: no prior observation was ever found for the parent state (C5), or the bounded
  parent-violator recheck (`STA_RECHECK_BOUND` = 200, worst known slack first) did not complete for
  every one of the parent's own violating checks (`receipts["recheckIncomplete"]`). No field in
  `evaluation` distinguishes the two; a controller call on whether that is worth a dedicated reason
  field if a future consumer needs to tell them apart.
- G32 (batch A2, I6 -- restated here for FABRIC completeness) `missingRequiredCheckCount` can go
  non-zero for a reason beyond "a required scenario's STA never ran": an unconstrained-endpoint
  regression against the Campaign baseline's own `check_timing`-derived count
  (`verification._unconstrained_regressions`). The combined count does not, by itself, say which of
  the two causes applies to a given scenario.
- G33 (ATCS-05 -- **code-side closed, L4 unchanged**) Scenario names now come only from the admitted
  `analysisContract/scenarios.json`; query specs must name that exact set, policy derives the same
  ordered set and corner map, and adapters, STA, evaluation and refresh accounting consume it. No
  production flow module carries the four linglong scenario literals. Two different synthetic sets
  pass the same compiler/contract path; duplicate, missing, extra and corner-map mismatches fail closed.
- G34 (ATCS-04 -- **code-side closed, contract/L4 pending**) `observe` can now compile the Site's
  `xtopContext`, hash its XTop Liberty files, export current-state PT timing data and seal
  `state/xtop-context.json`. Both worker and replay re-hash that receipt immediately before XTop and
  use the same site map, removable fillers, placement checks, library Tcl, STA data and `eco_*`
  parameters. The v2 wrapper additionally pins the complete flow and slot session Tcl. The current
  shared `contract.yml` still names v1 until ATCS-03 integrates the v2 path; no real XTop qualification
  has run, so worker research quality and the v2 binding remain unqualified.
- G35 (Issue #63 slice 2) Physical refreshes are capped by the Run's Goal value
  `max_physical_refreshes` (count, 1..4, default 1), not by `generationLimit`: every Explore revisit consumes a Harness generation
  whether or not it refreshes. `read-refresh-budget(-apr)` observes `workingState` (always present
  after `baseline`; `refreshLedger` cannot be the report because it does not exist before the first
  refresh and the Harness blocks on a missing report) with the `atcs-refresh-budget` reader, which
  emits `tc_refreshes_completed` from `state/refresh-ledger.json`: `known(0)` with no ledger and no
  `state/sta.json`, the verified entry count otherwise, `unknown` for an unverifiable ledger. It is
  not `tc_refresh_count` because the acceptance reader never reports a missing ledger as 0. The
  reading sits immediately before each Judge because a Judge takes a type's latest reading
  Run-wide and `sta` records a refresh with no later reading on the coverage/identity FAIL paths.
  The cap is a Goal value, not a Strategy knob (review C-1): an owner's `next-strategy` merges a
  whole Strategy at any Explore completion and a revision resets an omitted knob to its default,
  but a Goal is admitted once when the Run is created and neither path can reach it. Both Judges
  bind it `from: goal`. `wait-for-person` has no outgoing edge, so a refresh-budget FAIL or
  UNDETERMINED ends the Run once a person clears it; more refreshes need a new Run created with a
  higher value. A missing ledger beside `state/sta.json` or any `implementations/*/sta.json`
  archive reads `unknown`, never 0 (review C-4). SPEC.md names `tc_refreshes_completed` and
  `refresh-budget` (review C-2).
- G36 (Issue #63 slice 3, gap 1) A refused request reaches its owner itemized. Every request kind
  in `tools/read-atcs.py` returns `(values, problems)` and counts `len(problems)`, so the text and
  `tc_request_invalid_count` share one source; each problem starts with its field's JSON path (and
  `(slot w0N)`) and, for a work-package field, its required format. The Reader writes the list
  beside the document as `<document>.problems.txt`, and each producing Workshop reads it as the
  output `<output>Problems` its purpose names (`evaluate-next-investment` also reads the plan's and
  integration plan's, whose FAILs route to it). This is host-side on purpose: the Reader is shipped
  alone into `hima-readers/<id>/` (`node-turns.ts` `runPackReader`), a Workshop sees only the
  `flow/` copy, and moving the checks into `flow/atcs` would change the flow digest the installed
  wrapper pins.
- G37 (Issue #63 slice 3, gap 2) No refused request ends the Run. A request document of the wrong
  shape (not an object, a missing or non-object `candidate`/`baseState`/`siteCapabilities`/`plan`/
  `facts`, a non-list `select`), a slot `taskId` that is not the slot's, and every w01 `actions`
  defect (count, keys, instance outside `editDomain.instances`, bare leaf, unsafe master) are
  counted problems, not Reader exceptions -- an exception re-read the same bytes until the Retry
  allowance was spent and a Hard blocker parked the Run at `wait-for-person`. Unreadable JSON and a
  `baseState`/`facts` whose id or source files do not verify still refuse (fail-closed identity).
  `check-worker-request-01` is `[request-admissible, request-checked]` and FAILs to
  `retry-worker-01`, like `check-observation-request`. w02/w03 FAILs still move on to the next
  slot: an Explore with the one-edge `atcs-revisit` chooser always revisits, so a retry there would
  let one hopeless slot spend the Run's generations instead of dropping it.
- G38 (Issue #63, failure catalogue C23) An active slot's `editDomain` must name something XTop
  can edit. The campaign-plan and worker-request Readers count, per slot, an edit domain with no
  instance and no net, and each instance that is not a leaf cell of the sha-verified base netlist
  written as its full path from `top` (a port or net name, a bare leaf, an absent path, or a module
  instance). Before, all five shapes read 0 and cost PR02, PR03 and Fresh03 2-4 Workshop attempts
  each before any XTop.
- G39 (Issue #63, failure catalogue C13) A w01 action's `toMaster` must resize its cell within this
  design's libraries. The source is `state/xtop-context.json`, which the Pack's own `observe`
  stamps from the Site's `xtopContext` (each scenario's Liberty files, hashed). `prepare-workers`
  re-verifies the same file before XTop, so it existed on every Campaign that reached a worker:
  PR03's three `prepare-workers` Jobs exited 0, and its retained worker requests carry the Site
  `xtopContext` with `libertyGlob` and `ecoParameters`. The model-written `siteCapabilities` in the
  request is never read for this. The Reader re-hashes one scenario's Liberty files while it
  collects their `cell (...)` names. Using the Site's `cellNominalSizingPattern` and
  `cellNominalSwapKeywords`, it counts each of these as a problem: a master that is not a library
  cell, one that changes the cell function or the VT, one equal to the current master, and a
  missing, unreadable or other-design-state context. Channel length is not constrained: XTop's
  footprint match decides that. Cost: one pass over one corner's Liberty files for each w01 read.
- G40 (Issue #63, failure catalogue C06) The first composition pass never reads an integration
  plan. In PR03, generation 3's first pass exited 3 (`missing-input`) on generation 2's integration
  plan: the Reader had refused that plan, and its malformed `resolutions` were still on disk.
  `compose-facts` (first pass, and the target of `revisit-revise`) now passes a plan path that
  nothing writes. `compose-facts-admitted` (second pass, reached only through
  `check-integration-plan` PASS) passes `research/requests/integration-plan.json`. So only an
  admitted plan's resolutions are applied, and its `conflictKey`/`decision` shape has already
  been checked. `flow/atcs_cli.py` is unchanged; its own stale-plan rules still apply to the
  second pass.
- G41 (Issue #63, failure catalogue C22) PT endpoints resolve to instances deterministically.
  `tools/read-atcs.py` now reads the netlist statement by statement, so an instantiation may span
  lines. A one-line instantiation is still read on a fast path, and hierarchy-only reads are
  unchanged: 650k lines in about 1.4 s. Comments are skipped and there is no line cap. The same
  file carries `resolve_endpoints` and the command `read-atcs.py resolve-instances WORKSPACE
  ENDPOINTS OUT`:
  - bus spellings `x[0]`, `x_0_` and `x_0` all match;
  - a flattened escaped name matches as one segment;
  - a net resolves to its one output-named driving pin through port connections;
  - ports and module instances are reported unresolved, with a reason.

  The brief asked for `tools/atcs_resolve.py`. It is not a separate file because a reader's script
  is the only Pack file the Harness ships to the Site (`node-turns.ts` `runPackReader`, `shipTo` =
  `hima-readers/<reader-id>/<basename of file>`), so neither the Readers nor a Workshop could reach
  a sibling module. A Workshop runs the copy shipped for the Run's first reader,
  `hima-readers/atcs-readiness/read-atcs.py`. `knowledge/endpoint-resolution.md` gives it that
  path, and the plan and worker purposes point at it.
- G42 (Issue #63, dry path slice 4, BLOCKED 1) A batch decision on a stale XTop context is
  refused with "observe first". After a physical refresh is adopted, `state/xtop-context.json`
  still names the pre-refresh state, and only `observe` rebinds it. So `prepare-workers` (reached
  by `research`) and `replay-prepare` (reached by `compose` and `revise`) exit 3 `stale-base`.
  Option A (routing) was chosen. The next-decision Reader already reads the workspace host-side,
  so it sees both ids. It counts `research`/`compose`/`revise` with the text "observe first: the
  XTop context is bound to <old>, the working state is <new>", and a context that does not verify
  is counted too. The owner's retry (`revisit-next-decision`) then chooses `observe`, which
  rebinds the context. There is no graph growth. With no context at all, the Reader counts nothing
  and leaves it to those tools: that is a Site that declares no `xtopContext`.

## Reviews

- Task 14 (contract, graph, rules, choosers, FABRIC): review pending; the controller records the
  reviewer's verdict here.
- Final whole-branch review (Opus): found C1-C5 (favourable-WNS/precision-boundary parsing,
  design-state root resolution, stale-reimplement/write-once, wrong-generation comparison, PBA
  mismatch), I1-I13 and several Minor items across the pipeline. Landed across three implementer
  batches:
  - Batch A (`.superpowers/sdd/final-fix-A-report.md`, part 1): C1-C5 and I4/I9 fixed and tested;
    I5/I6/I12 and four Minor items explicitly deferred to a follow-up (see that report's "Not
    completed").
  - Batch A2 (same report, part 2): I5 (bounded parent-violator recheck, `STA_RECHECK_BOUND`), I6
    (unconstrained-endpoint coverage vs. baseline), I12 (write-once raw evidence generations and
    batch ids) and the four remaining Minor items (Goal-knob max, PBA precision actually applied,
    UNDETERMINED routing, `core.require`/`REQUIRED_SCENARIOS`/`UNSAFE_TCL_CHARS` dedupe) — all
    landed; see G25/G26/G31/G32 above.
  - Batch B (`.superpowers/sdd/final-fix-B-report.md`): C4 (per-scenario library identity, G27), I1
    (StarRC per-corner templates, G28), I2 (staged lifecycle checkpoint, G29 -- restore convention
    with Foundation flow-config sourcing left open), I3 (XTop replay source + tool-failure recording,
    G30), I7 (bus-bit-safe Tcl quoting), I8 (whole-flow integrity digest + apr-run recompile check),
    I10 (`sta` maxPaths from the Strategy), I13 (baseline physical reports from this Pack's own
    Innovus export) landed; I11 (scenario names generic beyond the fixed four) explicitly not closed
    (G33); Site/README corrected for every input-shape change this batch made.
  - Every landed item has TDD evidence (RED before, GREEN after) in its own batch's implementer
    report; `python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests` and the
    Node contract test (`loadPack`/`checkPack` against `linglong-atcs28` and the local Site) were run
    green after every commit in every batch.
  - Batch C (`.superpowers/sdd/final-fix-C-report.md`), the last four blockers plus Minors before a
    bounded post-route-only real-tool test: N2 (`implement`'s write-once marker written only after
    outputs are verified, matching `apr-run`'s convention; a failed attempt's own `output_root` is
    preserved, moved aside, on retry), N1 (round-2 prior observation -- `sta` persists a combined,
    candidate-labelled observation to `observations/<candidateStateId>.json`; `verification.assemble`'s
    "no prior" comparison lists are `None`, never present-but-empty `[]`, so
    `adoption._timing_failure_count` correctly reads `+inf`, never a false winning `0`; `residual` falls
    back to the candidate's own observation's failing checks when `comparison.remaining` is
    unavailable), N4 (every `pt-query.tcl` target carries its own setup/hold mode; `-delay_type max`/
    `min` emitted per target, plus the PBA flag only when precision is `pba`), and the restore-form half
    of G29 closed (see G29 above: `innovus-export.tcl`/`innovus-eco.tcl` restore the staged `.enc.dat`
    directory, `apr-stage.tcl` now also names the top cell -- `lifecycle.stage_task` gained a required
    `top` parameter). Minors: the other contradictory sign (`NUM 0` with a displayed negative WNS) is
    now also caught; `main()` resolves `workspace` to an absolute path; the Site's own missing
    `query-spec.json` template (bound by `contract.yml` but never actually present) is added with
    `precision: gba`, documented why.
  - Real-model probe follow-ups (Issue #63, `notes/model-probe-report.md`, runs
    `notes/model-probe-run1` and `notes/model-probe-run1-team`; probe outputs copied into
    `flow/tests/probe_fixtures/`):
    - Item 1, empty w01 actions (`research-worker-01/attempt-2`, `ValueError: worker actions must
      contain one to three sizing candidates`). This was already counted by slice 3 (2d3678a1), and
      `EmptyWorkerActionsTest` now reads the probe's own document. The purpose and the example now
      say to exit non-zero with the reason rather than write an empty list. That is the honest
      equivalent of a no-fix request: operate-worker-01's Team needs one action to review.
    - Item 2, reviewer JSON format (`model-probe-run1` team attempts 2 and 3, first answer "Expected
      ',' or ']' after array element"). The reviewer taskTemplate now names every field with its form
      and caps the free text: exactly one JSON object, no prose, no fence, no trailing commas,
      evidenceRefs as record-id strings, at most three limitations under 200 characters. It keeps its
      example reply. `ReviewerReplyFormatTest` shows the retained admitted answer breaks the caps and
      the example keeps them.
    - Item 3, loose admissions:
      - Buffers chosen for AND gates (`research-worker-01` attempts 1 and 3, `BUFFD4BWP30P140` for
        `CKAN2D*`) were closed by C13 (4ed569ba, `WorkerActionMasterReaderTest`).
        `BufferForAndGateTest` reads the probe's own document.
      - next-decision targets written as a bare scenario, wildcards or prose (`evaluate-next-
        investment` attempts 1-3) are now counted one by one, naming the form
        `<scenario>|<setup|hold>|<endpoint>`. The purpose states that form
        (`NextDecisionTargetsTest`).
  - **Pending re-review**: this FABRIC.md's own G27-G33 and the four batches' combined diff have not
    yet had a second reviewer pass since batch C landed.
