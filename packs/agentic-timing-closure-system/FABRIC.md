## Files written

Task 14 compiled the executable method from `SPEC.md` and the reviewed Pack code (`flow/atcs/*.py`,
`flow/atcs_cli.py` as of Task 12c, `flow/templates/*`, `tools/read-atcs.py`, `semantics.yml`,
`knowledge/*.md`). Apart from the files below it made two small changes to Pack code: the
next-decision `stage` check in `tools/read-atcs.py`, and the removal of the unused `_apr_task_path`
helper from `flow/atcs_cli.py`.

- `contract.yml` — 4 inputs, 35 outputs (17 with a reader, every `readers/*.yml` bound), 25 tools
  (24 `python3` subcommand tools of `flow/atcs_cli.py`, 1 interactive-only XTop Operator tool),
  7 Workshops (5 families, the worker family expanded to slots 01–03), 23 rules, 2 Goal parameters,
  1 Strategy knob (`maxPaths`), 10 knowledge files.
- `graph.yml` — 106 nodes (60 act, 36 judge, 9 explore, 1 wait), 141 edges, 9 revisit edges.
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
- Implementation: `implement` → `extract` → `sta` → `physical` → `evaluate` → coverage → identity →
  constraint failures (FAIL → `adopt`, where M7 bars best/delivery) → constraint unknowns → setup
  Goal → hold Goal → `adopt` → `artifact-ready` → `residual` → `record-experience` → next decision.
- Decision: `request-admissible` → `continue-or-wait` (FAIL → wait) → routing Judges on
  `tc_next_action` (observe, research, compose, revise, implement, earlier-apr, goal-met), each
  ending in its own Explore node's single revisit edge.
- Earlier APR (executable): fresh readiness reading → `check-apr-scope` → `apr-prepare` (stage from
  the admitted next-decision) → `apr-run` (Innovus) → the implementation chain from `extract`.
- Goal met: fresh readings of the acceptance record and the final evaluation → every final rule
  again → `atcs-goal-met`, which the Harness refuses unless every gate verdict passed.
- There is no `converge` block; the Run's budget ending is the Runtime's.

## Gaps

Every tool and reader `contract.yml` names is held in this folder (tools run `flow/atcs_cli.py` or
the Site's XTop Operator wrapper; readers run `tools/read-atcs.py`). None of the gaps below is
closed by a hidden loop or background process.

Schema limits and how the graph expresses them:

- G1 Worker slots run sequentially, and every round runs all three slots before `collect`: a batch
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
  one Explore node per revisit target (diagnose, plan, collect, compose-facts, implement,
  apr-prepare, the next-investment Workshop). The chooser `atcs-revisit` makes no domain choice.
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
- G17 Earlier APR is executable end to end in the graph and reachable from the baseline round:
  `residual` gives PT path-detail evidence (from the baseline observation or the latest evaluation),
  the next-investment Workshop may choose `earlier-apr` with a stage, and the route runs
  `apr-prepare` → `apr-run` → the implementation chain. `check-apr-scope` judges
  `[lifecycle-available, inputs-ready]` on a fresh readiness reading and routes on
  `lifecycle-available` alone (the second rule is the verdict the Explore needs); a post-route-only
  scope FAILs back to the next-investment Workshop through `revisit-next-decision`, not to wait, and
  `apr-prepare`'s own scope refusal is a second line the graph does not reach. `apr-prepare` fails
  the node (`no-intervention`) when no residual case yields a stage setting. Not yet run with real
  tools (Task 17).
- G18 `residual` runs bounded PT path-detail queries (the 20 worst known checks) at every Campaign
  start and after every evaluation. Decisions reached from a pre-implementation failure route (plan,
  integration plan, composition, replay or pre-check) see the residual cases of the baseline or the
  last evaluation, not refreshed ones.

Known gaps carried from earlier tasks:

- G19 (Task 12) `presta` compares the batch's new nets against the working state's SPEF, so
  `tc_unqualified_rc_net_count > 0` for every batch containing `insert_buffer`; such batches always
  route to the next decision and are implemented only by an explicit implement decision.
- G20 (Task 12) `parse_path_detail` is unverified against a real PT per-arc report; the earlier-APR
  route now depends on it.
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

## Reviews

- Task 14 (contract, graph, rules, choosers, FABRIC): review pending; the controller records the
  reviewer's verdict here.
