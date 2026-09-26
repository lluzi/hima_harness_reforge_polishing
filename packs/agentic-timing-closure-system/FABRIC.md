## Files written

Task 14 compiled the executable method from `SPEC.md` and the reviewed Pack code (`flow/atcs/*.py`,
`flow/atcs_cli.py` as of Task 12b and its fix round, `flow/templates/*`, `tools/read-atcs.py`, `readers/*.yml`,
`semantics.yml`, `knowledge/*.md`); it changed no module under `flow/atcs/` nor `flow/atcs_cli.py`:

- `contract.yml` — 4 inputs, 35 outputs (17 with a reader, every `readers/*.yml` bound), 25 tools
  (24 `python3` subcommand tools of `flow/atcs_cli.py`, 1 interactive-only XTop Operator tool),
  7 Workshops (5 families, the worker family expanded to slots 01–03), 23 rules, 2 Goal parameters,
  1 Strategy knob (`maxPaths`), 10 knowledge files.
- `graph.yml` — 102 nodes (56 act, 36 judge, 9 explore, 1 wait), 137 edges, 9 revisit edges.
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
- `tools/read-atcs.py` — one check only: a `next-decision` whose action is `earlier-apr` must name a
  `stage` in `atcs_cli.APR_STAGES` (place, cts, route, postroute), else it is inadmissible
  (`flow/tests/test_readers.py` covers it); `apr-prepare` reads that stage from the same document.
- `flow/tests/test_records.py` (extended: FABRIC headings; graph rules and choosers resolve to files;
  every output reader has a file and every reader file an output; tool-written output paths equal
  `atcs_cli.py`'s own path table; the Reader's APR stages equal `atcs_cli.APR_STAGES` and the graph
  fixes no stage).

How the reference graph expresses SPEC behaviour 1–9: `bind-inputs` → `inputs-ready` (FAIL → wait);
`baseline` (seeds `state/working-state.json`) → `observe-baseline` → `policy` (Goal targets bound
from the Run) → `physical-baseline` → `risk`; `diagnose-and-observe` → `request-admissible` (FAIL
revisits the Workshop) → `observe-query` → `risk`; `plan-campaign` → `request-admissible` →
`prepare-workers` → slots 01, 02, 03 in sequence (Workshop → request reading → `request-admissible`,
FAIL skips the slot → XTop Operator → `capture-contribution` → result reading) → `collect` →
`compose-facts` → `compose-contributions` → `request-admissible` → `composition-ready` →
`replay-prepare` → `reconcile` → `replay-consistent-mismatch` → `replay-consistent-scope` → `presta` →
`presta-model-qualified` (FAIL → next decision) → `implement` → `extract` → `sta` → `physical` →
`evaluate` → coverage → identity → constraint failures → constraint unknowns → setup Goal → hold Goal →
`adopt` (moves `state/working-state.json` when working moves) → `artifact-ready` → `residual` →
`record-experience` → `evaluate-next-investment` → `request-admissible` → `continue-or-wait` (FAIL →
wait) → routing Judges on `tc_next_action` (observe, research, compose, revise, implement,
earlier-apr, goal-met), each ending in its own Explore node's single revisit edge. Earlier APR
re-reads readiness, checks `lifecycle-available` and `inputs-ready`, then `apr-prepare` (stage from
the admitted next-decision) → `apr-run` joins the implement chain at `extract`. Goal-met re-reads the final evaluation, re-judges every final
rule and ends only through `atcs-goal-met`, which the Harness refuses unless every gate verdict
passed. There is no `converge` block; the Run's budget ending is the Runtime's.

## Gaps

Every tool and reader `contract.yml` names is held in this folder (tools run `flow/atcs_cli.py` or
the Site's XTop Operator wrapper; readers run `tools/read-atcs.py`). Task 12b closed the former
argv seams (literal ids, capture inputs, candidate report paths, run-time policy, experience inputs
and their reason provenance, baseline source refs, working-state base, observation history, Strategy
knob consumer, APR execution and the APR stage taken from the admitted next-decision).
The gaps below remain; none is closed by a hidden loop or background process.

Schema limits and how the graph expresses them:

- G1 Worker slots run sequentially, and every batch prepares all three (`prepare-workers` requires
  three packages; the SPEC fixes Workshop argv). A variant with `prepare-workers` forking to the three
  slot chains joining at one Judge was refused by `loadPack`: every path from a join to an Explore
  needs a fresh reading and a two-rule Judge with no single-rule Judge after it (`exploreAfter`,
  packs.ts); a branch holds act nodes only, so the per-slot `request-admissible` gate cannot sit in
  it; and Workshop moments and interactive admissions inside `driveBranch` are runtime-unproven.
- G2 One wait node per graph: the SPEC's `missing-inputs` (inputs-ready FAIL) and
  `scope-or-input-required` (continue-or-wait FAIL) waits, the impossible routing fall-through and
  every unlabelled UNDETERMINED all stop at `wait-for-person`; the failing verdict names which.
- G3 A Judge routes on its first rule only and an Explore with a chooser has one outgoing edge, so
  `tc_next_action` routing is a chain of two-rule Judges (`next-action-<x>`, `continue-or-wait`) with
  one Explore node per revisit target (diagnose, plan, collect, compose-facts, implement,
  apr-prepare, the next-investment Workshop). The chooser `atcs-revisit` makes no domain choice.
- G4 `maxPaths` (100..5000 paths, default 1000) caps the paths per scenario both observe tools use
  (an observation request asking for more is clamped). A chooser clause must set a knob and cannot
  read the Strategy it is on, so every revisit sets `maxPaths` to the bound 1000: a Run-start override
  holds for the first Generation only.
- G5 An Explore weighs only the last Judge of its Generation, which must list two rules whose
  verdicts all cite the Generation's latest reading (`exploreEvidence`, node-turns.ts). Hence
  `request-checked` (`tc_request_invalid_count >= 0`) pairs with `request-admissible`; the
  earlier-apr route re-reads `inputReadiness`; the goal-met route re-reads `finalEvaluation`; and
  `artifact-ready` additionally requires `tc_final_setup_wns_ns` so its verdict cites that re-read.
  Consequence: goal-met is only reachable in the Generation that ran `adopt`; a goal-met decision in a
  later Generation leaves the Explore blocked (fail closed) instead of ending on stale evidence.
- G6 SPEC Constraint 5 (temporary degradation with a follow-up, a limit and a deadline): the limit is
  M7's `allowDegradedWorking`, `degradeLimitNs` and `maxNewConstraintFailures` in the stamped policy;
  the deadline is only the Run's time box (`timeBoxMs` 86400000, `closingReserveMs` 1800000), not a
  per-degradation deadline; the follow-up is structural (every adopted candidate passes residual →
  record-experience → `evaluate-next-investment`, whose purpose requires naming the follow-up and
  falsifier) but no typed value checks it.
- G7 SPEC chooser evidence (waiting value, dependency, joint-verification cost, time comparison for
  earlier APR) is weighed by the Workshops, not by a chooser; no rule reads `tc_pending_research_count`,
  `tc_ready_contribution_count`, `tc_selected_contribution_count` or the XTop/presta WNS values (they
  are observed only). An empty batch's waiting-value reason is required in words only.

Deviations from the Task 14 brief and controller notes where the code is the authority:

- G8 Tool argv use `${WORKSPACE}/flow/atcs_cli.py`, not `${FLOW_ROOT}/atcs_cli.py`: `FLOW_ROOT` is
  bound only for Packs declaring a `flowRoot` input, and `workspace.source: pack` deploys `flow/` into
  `<workspace>/flow/`, where `tools/read-atcs.py` also imports `atcs` from.
- G9 `maxPaths` is a positional argv value of `observe` only; `baseline` runs no PT query and takes
  none. `policy` runs after `observe-baseline`, not directly after `baseline`, because it derives
  `baselineMinWns` from the baseline observation.
- G10 No interactive XTop replay node: `replay-prepare` itself replays the steps in XTop (batch,
  through `edaShell`), so it holds the `xtop` licence and `reconcile` follows it.
- G11 `artifact-ready` is judged after `adopt` (its value comes from `acceptanceRecord`). `adopt` runs
  after the setup/hold Goal Judges whether they pass or fail (M7 decides best, working-only, delivery
  or refused), but not after an evidence or constraint FAIL, which goes straight to `residual`.
- G12 `baseline` has no reuse-of-baseline-SPEF/PT branch and no baseline extraction: the CLI builds
  the design-state and `observe-baseline` always runs PT on the manifest's SPEF.
- G13 `baselineState`, `workingState`, `currentObservations`, `riskAtlas` and `acceptancePolicy` have
  no Reader (no `tc_*` value is sourced from them), so no node observes them; Workshops read them
  through `reads`.
- G14 The SPEC's `workerManifestNN` is one output, `workerManifests` (`state/workers.json`), because
  `prepare-workers` writes one index for all slots.
- G15 `campaignPlan` uses the `atcs-work-package` reader: its envelope's `candidate` is slot w01's
  package; w02 and w03 are checked by their own worker-request readers and refused by
  `prepare-workers` (exit 3) when invalid.
- G16 Workshop companion files (`observe-scenario-inputs.json`, `work-package-w0N.json`,
  `resolutions.json`, raw `integration-plan.json`) and the Operator's `before.dump`, `after.dump` and
  `summary.json` are not Ledger readings; `observe`, `validate_work_package`, `validate_plan` and
  `contributions.seal` re-validate them when the tools read them.
- G17 `composition-ready` judges the facts computed before the compose Workshop's new resolutions; the
  plan's own conflict coverage is judged by `request-admissible` (`plan_invalid_count`) and
  re-validated by `replay-prepare`.

Known gaps carried from earlier tasks:

- G18 (Task 12) `presta` compares the batch's new nets against the working state's SPEF, so
  `tc_unqualified_rc_net_count > 0` for every batch containing `insert_buffer`; such batches always
  route to the next decision and are implemented only by an explicit implement decision.
- G19 (Task 12) `residual` does not launch the `pt-query.tcl` path-detail query, so residual evidence
  fields stay unknown.
- G20 (Task 12) `parse_path_detail` is unverified against a real PT per-arc report.
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
