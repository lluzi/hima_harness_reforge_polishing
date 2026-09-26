## Files written

Task 14 compiled the executable method from `SPEC.md` and the reviewed Pack code (`flow/atcs/*.py`,
`flow/atcs_cli.py`, `flow/templates/*`, `tools/read-atcs.py`, `readers/*.yml`, `semantics.yml`,
`knowledge/*.md`, all written by Tasks 2–13 and not changed here):

- `contract.yml` — 4 inputs, 33 outputs (17 with a reader), 23 tools (22 `python3` subcommand tools
  of `flow/atcs_cli.py`, 1 interactive-only XTop Operator tool), 7 Workshops (5 families, the worker
  family expanded to slots 01–03), 23 rules, 2 Goal parameters, 1 Strategy knob, 10 knowledge files.
- `graph.yml` — 100 nodes (54 act, 36 judge, 9 explore, 1 wait), 135 edges, 9 revisit edges.
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
- `FABRIC.md`
- `flow/tests/test_records.py` (extended: FABRIC headings; graph rules, choosers and output readers
  resolve to files; tool-written output paths equal `atcs_cli.py`'s own path table).

How the reference graph expresses SPEC behaviour 1–9: `bind-inputs` → `inputs-ready` (FAIL → wait);
`baseline` → `observe-baseline` → `physical-baseline` → `risk`; `diagnose-and-observe` →
`request-admissible` (FAIL revisits the Workshop) → `observe-query` → `risk`; `plan-campaign` →
`request-admissible` → `prepare-workers` → slots 01, 02, 03 in sequence (Workshop → request reading →
`request-admissible`, FAIL skips the slot → XTop Operator → `capture-contribution` → result reading) →
`collect` → `compose-facts` → `compose-contributions` → `request-admissible` → `composition-ready` →
`replay-prepare` → `reconcile` → `replay-consistent-mismatch` → `replay-consistent-scope` → `presta` →
`presta-model-qualified` (FAIL → next decision) → `implement` → `extract` → `sta` → `physical` →
`evaluate` → coverage → identity → constraint failures → constraint unknowns → setup Goal → hold Goal →
`adopt` → `artifact-ready` → `residual` → `record-experience` → `evaluate-next-investment` →
`request-admissible` → `continue-or-wait` (FAIL → wait) → routing Judges on `tc_next_action` (observe,
research, compose, revise, implement, earlier-apr, goal-met), each ending in its own Explore node's
single revisit edge; goal-met re-reads the final evaluation, re-judges every final rule and ends only
through `atcs-goal-met`, which the Harness refuses unless every gate verdict passed. There is no
`converge` block; the Run's budget ending is the Runtime's.

## Gaps

Every tool and reader `contract.yml` names is held in this folder (tools run `flow/atcs_cli.py` or
the Site's XTop Operator wrapper; readers run `tools/read-atcs.py`). The gaps below are SPEC
behaviours or code seams the schema or the current code cannot express; none is closed by a hidden
loop or background process.

Code seams that need a decision (argv cannot supply what `atcs_cli.py` expects; reported as
NEEDS_CONTEXT, Python not edited by this task):

- G1 `compose-facts` takes a literal `baseStateId` and `adopt` a literal `expectedBaseId`; argv cannot
  read an id out of a file, so both receive the path `state/baseline.json`. This fails closed (every
  Contribution is stale; `replay-prepare` refuses `stale-base`; `adopt` never publishes) until the CLI
  resolves the id from the artifact itself.
- G2 `capture-contribution` reads `research/requests/capture-<slot>-base-ref.json`,
  `…-result-refs.json` and `…-ops.jsonl`; nothing writes them. The real ops log lives at
  `workspaces/<slot>/r<rev>/ops.jsonl` (a per-revision path from `state/workers.json`) and `base_ref`
  / `result_refs` (workspace manifest, work package, dumps, predicted values) are composed by nobody.
- G3 `physical-candidate` reads `state/candidate-verify-drc.rpt` and
  `state/candidate-verify-connectivity.rpt`; `implement` writes those reports under
  `implementations/<mergeId>/` and records their paths in `state/implement.json` only.
- G4 `evaluate` and `adopt` read `${analysisContract}/policy.json`, a static Site document, but M6/M7
  need runtime fields in it: `baselineStateId`, `baselineMinWns` and `campaignRoot`. No deterministic
  producer composes them; assigning it to a Workshop would let the model write its own acceptance
  policy, which the SPEC forbids.
- G5 `record-experience` reads `research/requests/experience-{lineage,decision,outcome}.json`; nothing
  writes them (the next-investment Workshop runs after it, and measured outcomes must not be
  model-transcribed).
- G6 `observe-baseline` reads `${analysisContract}/baseline-source-refs.json`, which must carry the
  runtime baseline design-state id and absolute report paths inside this Campaign's workspace; a
  static Site document cannot know either.
- G7 Every batch replays from `state/baseline.json`: `prepare-workers`, `replay-prepare`, `presta`,
  `implement`, `sta`, `compose-facts` and `adopt` all receive the baseline design-state, because the
  adopted working state lives at `implementations/<mergeId>/design-state.json`, a per-merge path no
  argv can name. A second implementation round therefore re-bases on the original baseline.

Schema limits and how the graph expresses them:

- G8 Worker slots run sequentially. A variant with `prepare-workers` forking to the three slot chains
  (Workshop → request reading → Operator → capture → result reading) joining at one Judge was compiled
  and refused by `loadPack`: every path from a join to an Explore needs a fresh reading and a
  two-rule Judge with no single-rule Judge after it (`exploreAfter`, packs.ts), which this graph's
  single-rule gates break; a branch also holds act nodes only, so the per-slot `request-admissible`
  gate cannot sit inside it; and Workshop moments and interactive admissions inside `driveBranch` are
  runtime-unproven. `workerSlots` therefore cannot shorten the batch (G11).
- G9 One wait node per graph: the SPEC's `missing-inputs` (inputs-ready FAIL) and
  `scope-or-input-required` (continue-or-wait FAIL) waits, the impossible routing fall-through and
  every unlabelled UNDETERMINED all stop at `wait-for-person`; the failing verdict names which.
- G10 A Judge routes on its first rule only and an Explore with a chooser has one outgoing edge, so
  `tc_next_action` routing is a chain of two-rule Judges (`next-action-<x>`, `continue-or-wait`) with
  one Explore node per revisit target (diagnose, plan, collect, compose-facts, implement,
  apr-prepare, the next-investment Workshop). The chooser `atcs-revisit` makes no domain choice; it
  carries `workerSlots` into the next Generation.
- G11 `workerSlots` (number 1..3, default 3) has no consumer: the SPEC fixes Workshop argv to four
  words and `prepare-workers` requires exactly three work packages, so every batch prepares three
  slots; a slot with nothing to do is expected to end as a valid no-fix.
- G12 An Explore weighs only the last Judge of its Generation, which must list two rules whose
  verdicts all cite the Generation's latest reading (`exploreEvidence`, node-turns.ts). Hence
  `request-checked` (`tc_request_invalid_count >= 0`) exists to pair with `request-admissible`; the
  earlier-apr route re-reads `inputReadiness`; the goal-met route re-reads `finalEvaluation`; and
  `artifact-ready` additionally requires `tc_final_setup_wns_ns` so its verdict cites that re-read.
  Consequence: goal-met is only reachable in the Generation that ran `adopt`; a goal-met decision in a
  later Generation leaves the Explore blocked (fail closed) instead of ending on stale evidence.
- G13 SPEC Constraint 5 (temporary degradation with a follow-up, a limit and a deadline, deferred from
  M7): the limit is M7's `allowDegradedWorking`, `degradeLimitNs` and `maxNewConstraintFailures` in the
  fixed policy; the deadline is only the Run's time box (`timeBoxMs` 86400000, `closingReserveMs`
  1800000), not a per-degradation deadline; the follow-up is structural (every adopted candidate
  passes residual → record-experience → `evaluate-next-investment`, whose purpose requires naming the
  follow-up and falsifier) but no typed value checks it.
- G14 SPEC chooser evidence (waiting value, dependency, joint-verification cost, time comparison for
  earlier APR) is weighed by the Workshops, not by a chooser; no rule reads `tc_pending_research_count`,
  `tc_ready_contribution_count`, `tc_selected_contribution_count` or the XTop/presta WNS values (they
  are observed only). An empty batch's waiting-value reason is required in words only.

Deviations from the Task 14 brief where the code is the authority:

- G15 Tool argv use `${WORKSPACE}/flow/atcs_cli.py`, not `${FLOW_ROOT}/atcs_cli.py`: `FLOW_ROOT` is
  bound only for Packs declaring a `flowRoot` input, and `workspace.source: pack` deploys `flow/` into
  `<workspace>/flow/`, where `tools/read-atcs.py` also imports `atcs` from.
- G16 No interactive XTop replay node: `replay-prepare` itself replays the steps in XTop (batch,
  through `edaShell`), so it holds the `xtop` licence and `reconcile` follows it.
- G17 `artifact-ready` is judged after `adopt` (its value comes from `acceptanceRecord`). `adopt` runs
  after the setup/hold Goal Judges whether they pass or fail (M7 decides best, working-only, delivery
  or refused), but not after an evidence or constraint FAIL, which goes straight to `residual`.
- G18 `baseline` has no reuse-of-baseline-SPEF/PT branch and no baseline extraction: the CLI builds
  the design-state and `observe-baseline` always runs PT on the manifest's SPEF.
- G19 `baselineState`, `currentObservations` and `riskAtlas` have no Reader (Task 13), so no node
  observes them; Workshops read them through `reads`. `risk` compares `state/observation.json` with
  itself, yielding the current violation atlas (no prior observation is preserved by the CLI).
- G20 The SPEC's `workerManifestNN` is one output, `workerManifests` (`state/workers.json`), because
  `prepare-workers` writes one index for all slots.
- G21 `campaignPlan` uses the `atcs-work-package` reader: its envelope's `candidate` is slot w01's
  package; w02 and w03 are checked by their own worker-request readers and refused by
  `prepare-workers` (exit 3) when invalid.
- G22 Workshop companion files (`observe-source-refs.json`, `observe-scenario-inputs.json`,
  `work-package-w0N.json`, `resolutions.json`, raw `integration-plan.json`) are not Ledger readings;
  `capture`, `validate_work_package` and `validate_plan` re-validate them when the tools read them.
- G23 `composition-ready` judges the facts computed before the compose Workshop's new resolutions; the
  plan's own conflict coverage is judged by `request-admissible` (`plan_invalid_count`) and
  re-validated by `replay-prepare`.
- G24 Earlier APR: `apr-prepare` only prepares `apr/postroute/task.json`; no Pack tool runs an APR
  stage, the stage is fixed to `postroute` (no typed value selects one), and after preparation the Run
  returns to the next decision. Post-route-only scope is refused twice: by `lifecycle-available` on a
  fresh readiness reading and by `lifecycle._check_scope`.

Known gaps carried from earlier tasks:

- G25 (Task 12) `presta` compares the batch's new nets against the base SPEF, so
  `tc_unqualified_rc_net_count > 0` for every batch containing `insert_buffer`; such batches always
  route to the next decision and are implemented only by an explicit implement decision.
- G26 (Task 12) `residual` does not launch the `pt-query.tcl` path-detail query, so residual evidence
  fields stay unknown.
- G27 (Task 12) `parse_path_detail` is unverified against a real PT per-arc report.
- G28 (Task 12) Side files left by an EDA run that fails mid-way are untested.
- G29 (Task 9) Adoption is single-writer; `designStateId` honesty rests on `sta` building the
  design-state from the implemented DB, which M6 does not cross-check.
- G30 (Tasks 13, 15, 17) The XTop Operator is `interactive-only`; its settlement in a real Run is
  unproven. The Site wrapper contract is `<wrapper> <workspace> <slot>`, resolving
  `state/workers.json[slot].sessionTcl`; Task 15 writes the wrapper at
  `/data/eda/project/hima_harness/operator-admin/atcs-v1/atcs-xtop-operator.sh` and the admin binding.
- G31 (Task 15) `checkPack` against `linglong-swerv28` fails only on Site facts: the four inputs are
  unbound, `python3` (tools, Workshops) and the ATCS XTop wrapper are not permitted, and the licences
  `innovus`, `primetime`, `starrc`, `xtop` are not declared. A Permit entry `python3` also admits the
  readers' `/usr/bin/python3` by basename.

## Reviews

- Task 14 (contract, graph, rules, choosers, FABRIC): review pending; the controller records the
  reviewer's verdict here.
