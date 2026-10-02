#!/usr/bin/env python3
"""T12: the `atcs_cli.py <subcommand> <workspace> [args]` subcommand dispatcher.

This is the glue between the Harness graph (T14) and the M1-M8/M11 modules
under `flow/atcs/`: every subcommand reads its declared inputs from plain
JSON files under the Campaign `<workspace>`, calls exactly the module
functions named below, and writes **exactly one** declared output
(`core.write_artifact`, atomic). A subcommand that also launches EDA
compiles its task through `flow/atcs/adapters.py` and runs it via a
Site-supplied wrapper (`site_profile["edaShell"]`, read from a caller-given
JSON file -- never a hard-coded path); see `adapters.py`'s own module
docstring for that convention.

Exit codes (Phase B contract; no output file is written on any non-zero exit)
-------------------------------------------------------------------------------

- ``0`` -- success; the one declared output was written atomically.
- ``2`` -- a declared input file is missing, unreadable or malformed (wrong
  JSON, or the wrong `schema`/`id` for an artifact-shaped input). A plain
  ``{"code","detail"}`` JSON object on stderr.
- ``3`` -- an `atcs.core.AtcsError` refusal raised by a module function
  given otherwise well-formed inputs. ``{"code","detail"}`` JSON on stderr
  (`code` is the module's own kebab-case refusal code).
- ``4`` -- the launched EDA tool itself failed (nonzero exit, or an
  ``ERROR``/``Fatal`` line in its captured log). ``{"code":"tool-failed",
  "detail","log"}`` JSON on stderr, naming the captured log path.

Minor (final review): `main()` additionally maps a bare `OSError`/`KeyError`/
`TypeError`/`ValueError` escaping a handler to exit ``2`` with
``{"code":"malformed-input","detail"}`` on stderr -- a handler that lets one
of these four escape unwrapped is still a malformed/unreadable declared
input, never a raw traceback and never a bare exit ``1``.

Workspace layout (architecture Sec.13.4; binding, do not rename)
--------------------------------------------------------------------

``state/`` holds readiness, design states, observations, `pointers.json`
and `experience.json`; ``research/<dir>/`` holds raw PT evidence this Pack
generates (Workshop-authored plans/resolutions also live under
``research/``, supplied externally, not written by this module);
``workspaces/<task>/r<rev>/`` holds each worker's private write root
(``atcs.workspaces.prepare``'s own files); ``contributions/<id>.json``,
``integrations/<batchId>/`` and ``implementations/<mergeId>/`` are
content-addressed, Pack-internal stores this dispatcher reads/writes across
its own subcommand invocations; ``accepted/`` and ``apr/<stage>/<id>/`` hold
M7/M11 output. I12 (final review): ``research/observe/`` and
``research/residual/`` are themselves per-generation write-once --
`_next_evidence_generation_dir` names each call's own raw-evidence
subdirectory ``g<N>`` from a plain monotonic counter file
(``<dir>/.generation``, never a directory-existence scan, so a Site/adapter
or a test's own fake-wrapper convention pre-seeding that exact path is never
mistaken for "the slot is already taken"); `integrations/<batchId>/`'s own
uniqueness is instead enforced by refusal (`AtcsError("batch-id-reused",
...)`, `_cmd_replay_prepare`), since a Workshop-authored `batchId` is an
external identity this dispatcher never invents, not a counter it controls.
Because a Harness `outputs[]` entry must be one **fixed,
literal** path (`.superpowers/sdd/pack-mechanics.md` Sec.1.2 -- no
per-run/per-id templating), every subcommand's *declared* output (the one
Reader-facing file T14 lists in `contract.yml`) is instead a small, fixed
"latest" mirror under `state/`/`apr/<stage>/`; this dispatcher also writes
the full canonical, content-addressed artifact into the architecture's own
dynamic-path store when one is named above, purely for cross-subcommand and
provenance lookups -- that canonical copy is never itself "the declared
output" a Reader watches -- **never** a mutable directory named `current`:
the architecture requires every implementation/integration artifact to live
under its own real, content-addressed `implementations/<mergeId>/` /
`integrations/<batchId>/` (a controller decision explicit about this: a
mutable `current` directory would make history un-interpretable -- two
generations' raw evidence could otherwise silently overwrite each other at
the same path, and a failed EDA run's partial output could get mistaken for
a different generation's). `<mergeId>` is `merge_commit["id"]`
(`integration.seal_batch`'s own stamped id -- `implement` computes it before
choosing any output path, and `presta`/`extract`/`sta` all read it back off
an already-written declared output rather than recomputing it, except
`presta`, which calls `seal_batch` itself, read-only, before one exists for
real). `<batchId>` is `replay-request["batchId"]` (`prepare_replay`'s own
`plan.batchId` passthrough). Both are validated via
`adapters.validate_path_segment` before use (see Global Constraints below).
A failed EDA run therefore only ever leaves partial files under that one
real id's own directory -- never under a shared, generation-ambiguous path,
and never as a declared output (exit 4 leaves no output file at all, per
the exit-code contract above).

Subcommand table (path column is workspace-relative; "in" lists positional
args after `<workspace>`, in order; a name in *italics-by-convention*
`snake_case` names a fixed internal path this dispatcher reads by
convention, not a positional arg)
-------------------------------------------------------------------------------------------------------------

Task 12b (state-driven CLI inputs) changed the rule for every subcommand
below: argv carries only the workspace, fixed Site-bound input paths, slot
numbers, and Goal/Strategy values -- every run-time id or per-id path is
read from a fixed `state/*.json` entry file a predecessor subcommand wrote
(see "Gaps closed by Task 12b" below for the G-numbers this closes).

| # | Subcommand | Extra args | Calls | Declared output |
|---|---|---|---|---|
| 1 | `bind-inputs` | manifest, siteCapabilities | `state.input_readiness` | `state/readiness.json` |
| 2 | `baseline` | manifest | `_stage_lifecycle_checkpoints` (I2, final review, when the manifest declares one) then `state.design_state` | `state/baseline.json` (also seeds `state/working-state.json`, and `DBS/<stage>.enc(.dat)` per declared lifecycle stage) |
| 3 | `policy` | analysisContractDir, targetSetupNs(`{from: goal}`), targetHoldNs(`{from: goal}`) | reads `<analysisContractDir>/policy.json` + `state/baseline.json` + `state/observation.json` | `state/policy.json` (stamped) |
| 4 | `observe` | querySpec, siteProfile, scenariosContract(Site-fixed `analysisContract/scenarios.json`, per-scenario corner + PT library identity -- C4 final review, was `scenario-corners.json`, see "Task 12c fix round" below), maxPaths(`{from: strategy}`, an upper cap -- see "Fix round 1" below) | `_scenario_pt_inputs` (x4, built from `state/working-state.json`, re-verified by sha256) then `adapters.compile_pt_scenario_tasks` + `run_tool` (x4) then `state.capture` | `state/observation.json` (also `state/observation-prev.json`, `observations/<id>.json` and `research/observe/max-paths.json`) |
| 5 | `risk` | priorObservation(`state/observation-prev.json`), currentObservation(`state/observation.json`), recheck | `state.compare_checks` (self-compares on the campaign's first observation, when `priorObservation` does not exist yet) | `state/risk.json` |
| 6 | `prepare-workers` | baseState(`state/working-state.json`), siteCapabilities, edaProfile, campaignPlan(the ONE admitted envelope `{"candidate":{"workPackages":{"w01"..,"w06"..},"reason"},"baseState":..,"siteCapabilities":..}`; reads `candidate.workPackages`, refuses `ambiguous-plan` if a top-level `workPackages` key is also present -- see "Task 12c fix round" below) | `workspaces.validate_work_package` + `workspaces.prepare` (one per slot in `workspaces.TASK_IDS`, w01..w06) + `adapters.compile_xtop_operator_task`/`compile_xtop_analysis_manual_task` (per active slot, materialized into each worker's own root; a parked slot gets a workspace and no session -- Issue #64 Task 5) | `state/workers.json` (now embeds each slot's full `workPackage`/`workspaceManifest`, `parked: true` for a parked slot, and `requiredSlots` = all six) |
| 7 | `capture-contribution` | slot | `contributions.seal` (base_ref/result_refs composed from `state/workers.json[slot]` and the slot's own workspace root -- see `_cmd_capture_contribution`'s docstring for the exact `before.dump`/`after.dump`/`ops.jsonl`/`summary.json` file names); `contributions.seal_session` instead when `ops.jsonl` holds Task 3 toolkit lines or `tainted.json` exists (`_seal_xtop_session`: also `gain.jsonl`, the transcript's `ATCS:taint:` line, `eco_output/`, `state/xtop-context.json` filler patterns); `contributions.seal_parked` for a slot that ran no session (parked, or skipped by `operate-parked`) | `state/contribution-<slot>.json` (one of 6 literal names) |
| 8 | `collect` | (none) | reads whichever `contribution-w0N.json` exist AND still matches `state/workers.json[slot]`'s current revision (`contribution-index` read envelope: `{"contributions","pending":[{"slot","reason"}]}` -- see "Task 12c fix round" below) | `state/contributions-collected.json` |
| 9 | `compose-facts` | plan(the SAME admitted integration-plan envelope row 10 reads; absent on the first pass -- see "Task 12c fix round" below) | `composition.analyze` (`baseStateId` from `state/working-state.json`; `resolutions` from the admitted plan, `[]` on the first pass; `worst_checks` from `state/observation.json` when it observes that state, for the xtop-session recipe's blocker coverage) | `state/composition-facts.json` |
| 10 | `replay-prepare` | baseState(`state/working-state.json`), plan(the admitted integration-plan envelope `{"plan":...,"facts":...}` -- see "Task 12c fix round" below), siteProfile; baseState, plan, siteProfile, autoFinish(optional knob `0`/`1`, overrides `plan.autoFinish`) | recipe batch (`composition-facts.recipe`, Issue #64 Task 6): `integration.prepare_recipe_replay` then `adapters.compile_recipe_replay_task` + `run_tool` for the merged and control arms at once (`integrations/<batchId>/{merged,control}/`); legacy `fix` selection: `integration.validate_plan` + `integration.prepare_replay` then `adapters.compile_xtop_replay_task` + `run_tool` (best-effort) | `state/replay-request.json` |
| 11 | `reconcile` | (none -- legacy edit domains come from `state/workers.json`, see "Task 12c fix round" below; a recipe batch's from `state/replay-request.json`, each session's sealed `effectiveDomain` per `_recipe_sessions`) | recipe batch: `adapters.read_replay_arm` (x2) + `integration.reconcile_recipe` (safety, choice, `manualValue`); legacy: `integration.reconcile` | `state/integration-state.json` |
| 12 | `presta` | baseState(`state/working-state.json`), scenariosContract, siteProfile | `integration.seal_batch` (read-only re-derivation, for `newNets`) + `adapters.compile_pt_presta_task` + `run_tool`, `verification.precheck_evidence` (a recipe batch also seals `batchKind: "recipe"` and whether the pre-check is `predictive`; it never gates) | `state/presta.json` (the stamped `precheckEvidence` artifact) |
| 13 | `implement` | currentDesignState(`state/working-state.json`), siteProfile | `integration.seal_batch` then `adapters.compile_innovus_eco_task` + `run_tool` (a recipe batch sources the chosen ECO pair, copied under `implementations/<mergeId>/eco/` only if its sha256 still matches the seal; refuses `stale-base` unless the sealed merge commit's own `parentStateId` equals `currentDesignState["id"]`; refuses `write-once` if `implementations/<mergeId>/`'s own outputs already exist -- C2, final review) | `state/implement.json` |
| 14 | `extract` | corners, siteProfile | `adapters.compile_starrc_task` + `run_tool` (per corner) | `state/extract.json` |
| 15 | `sta` | querySpec, scenariosContract, baseDesignState(`state/working-state.json`), siteProfile, maxPaths(`{from: strategy}`, an upper cap -- I10, final review, same rule as `observe`'s) | `_verified_state_sdc_path` (SDC from `baseDesignState`'s own recorded `sdc[0]`, sha256-verified -- no separate `sdc` argv any more, see "Fix round 2" below) + `state.design_state` (built FIRST, from the implemented outputs -- C5, final review), `adapters.compile_pt_scenario_task` + `run_tool` (per scenario), `state.capture` (each observation labeled with the candidate's OWN new state id, never `baseDesignState`'s), `refresh.record_refresh` (once, on completion) | `state/sta.json` (also archived verbatim to `implementations/<mergeId>/sta.json`, and appends `state/refresh-ledger.json`) |
| 16 | `physical` | (candidate) mode only; (baseline) siteProfile, mode (I13: no longer two static rpt paths) | (candidate) I/O packaging only, reads+re-hashes `state/implement.json`'s `drcReport`/`connectivityReport`; (baseline) `adapters.compile_innovus_export_task` + `run_tool` against `state/baseline.json`'s own staged database, same `-limit`/`-error` values `innovus-eco.tcl` uses | `state/baseline-physical.json` or `state/physical.json` |
| 17 | `evaluate` | policy(`state/policy.json`) | `verification.plan_checks` + `_find_prior_observation_for_state` (picks the prior observation whose own `designStateId` equals the merge commit's `parentStateId`, never just whatever `state/observation.json` currently holds -- C5, final review) + `verification.assemble` | `state/evaluation.json` |
| 18 | `adopt` | policy(`state/policy.json`) | `adoption.publish` (`expectedBase` from `state/working-state.json`; rewrites `state/working-state.json` whenever `working` moves) | `accepted/latest.json` (envelope: `{"acceptanceRecord","refreshLedger"}` paths) |
| 19 | `residual` | scenariosContract(Site-fixed, same file row 4 reads), siteProfile -- see "Task 12c fix round"/"Fix round 2" below | `_residual_candidate_state` (the EVALUATED candidate's own `implementations/<mergeId>/design-state.json` once `state/evaluation.json` exists, never `state/working-state.json`, which may still be the parent for a refused candidate; the working state itself before any evaluation) + `_scenario_pt_inputs` + `adapters.compile_pt_query_task` + `run_tool` (per scenario, bounded to `RESIDUAL_QUERY_BOUND` worst checks) + `adapters.parse_path_detail` then `residual.extract` | `state/residual-cases.json` (also `queryNotes`, a side field) |
| 20 | `apr-prepare` | (none -- see "Fix round 1" below) | reads `research/requests/next-decision.json` then `lifecycle.compile_intervention` + `lifecycle.stage_task` | `state/apr-task.json` (one fixed literal path for every stage; carries `taskId` and `stage`) |
| 21 | `apr-run` | siteProfile | reads `state/apr-task.json` then `run_tool` (stage batch) + `adapters.compile_innovus_export_task` + `run_tool` (export batch) | `state/implement.json` (same shape `implement` writes) |
| 22 | `record-experience` | reasonSource(the SAME admitted integration-plan envelope row 10 reads -- only actually read when `_merge_commit_provenance` says `"merge"`; see "Task 12c fix round" below) | `experience.record` (lineage/decision/outcome composed from `state/working-state.json`, `state/implement.json`, `state/evaluation.json`, `state/contributions-collected.json`, `state/merge-commit.json`/`state/apr-task.json` (provenance), `state/sta.json`, `state/policy.json`/`state/pointers.json`) | `state/experience.json` |
| 23 | `worker-slots` | workerSlots(`{from: strategy}`, an integer 0..6; Issue #64 Task 5, 0 since #66 D8) | validates the knob; slots up to it may be active and every slot above it must be parked | `state/worker-slots.json` (stamped `worker-slots`: `workerSlots`, `activeSlots`, `parkedSlots`) |
| 24 | `operate-parked` | slot | the `xtop-operator` tool's batch path (Issue #64 Task 5): opens no XTop session for a slot `prepare-workers` parked or an active slot whose worker request is inadmissible (`workspaces.request_invalid_count` + `workspaces.bound_view` against the prepared package, or the Reader's own current `worker-request-<slot>.problems.txt` counting a problem, #64 T06 w06); refuses any other active slot (`slot-active`) | `<slot root>/parked.json` (stamped `parked-operate` receipt, `why` parked or inadmissible-request; an unreadable request or working state refuses; `prepare-workers` removes a stale one) |

Site-admin utility (not a Harness graph subcommand -- no workspace, no declared output)
-------------------------------------------------------------------------------------------

- `flow-digest` (I8, final review, whole-flow integrity): `python3 atcs_cli.py
  flow-digest [<flow-dir>]` prints a deterministic 64-hex-char sha256
  (`flow_digest`/`_flow_digest_entries`) over exactly what `contract.yml`'s
  `workspace.copy` stages into a Campaign workspace's own `flow/` tree
  (`atcs_cli.py` itself, `atcs/`, `templates/` -- never `flow/tests/`).
  `<flow-dir>` defaults to this file's own directory (the deployed copy's own
  `flow/` root when run from inside a Campaign workspace); an explicit path
  lets the admin check the repository's own `packs/agentic-timing-closure-
  system/flow/` before deployment. See `sites/linglong-atcs28/README.md`'s
  "Installing the wrapper" step for how the admin uses this alongside
  `adapter_sha256` to pin the whole deployed Pack, not just the one
  dispatcher file.

Gaps closed by Task 12b (G1-G7, G11, G19, G24 per `FABRIC.md`)
-------------------------------------------------------------------

- G1/G7: `compose-facts`/`adopt` no longer take a literal state-id argv arg;
  every subcommand that used to base itself on `state/baseline.json` now
  bases itself on `state/working-state.json`, which `baseline` seeds and
  `adopt` rewrites whenever the `working` pointer moves (`_cmd_baseline`/
  `_cmd_adopt`) -- a second implementation round re-bases on the *adopted*
  state, not the original baseline.
- G2: `capture-contribution <slot>` composes `base_ref`/`result_refs` itself
  from `state/workers.json[slot]` and the slot's own workspace root; no
  `research/requests/capture-*` inputs (`_cmd_capture_contribution`).
- G3: `physical` (candidate mode) reads the DRC/connectivity report
  identity from `state/implement.json`'s own `drcReport`/`connectivityReport`
  (`{"path","sha256"}`, re-hashed), not fixed `state/candidate-*.rpt` paths
  (`_cmd_physical`).
- G4: the new `policy` subcommand composes the run-time acceptance policy;
  `evaluate`/`adopt` read it at `state/policy.json` (`_cmd_policy`).
- G5: `record-experience` composes lineage/decision/outcome from state
  files; no `research/requests/experience-*` inputs (`_cmd_record_experience`).
- G6: `observe` composes its own PT source refs from the PT it just ran and
  `state/working-state.json`'s own id; no `${analysisContract}/baseline-
  source-refs.json` (`_cmd_observe`, serves both "observe-baseline" and
  "observe-query" graph roles).
- G11: the Strategy knob (`maxPaths`) is threaded into `observe`'s
  `query_spec` via a plain argv value (`_cmd_observe`).
- G19: `observe` preserves the prior `state/observation.json` at
  `state/observation-prev.json` and writes its immutable original to
  `observations/<id>.json`; `risk` self-compares on the campaign's first
  observation (`_cmd_observe`/`_cmd_risk`).
- G24: `next-decision` gains a required `stage` field when
  `action == "earlier-apr"` -- **`tools/read-atcs.py`'s
  `_collect_next_decision_problems` (around the existing `action must be
  one of ...` check) must also require and validate that field** when
  `action == "earlier-apr"` (one of `place`/`cts`/`route`/`postroute`,
  matching `atcs_cli.APR_STAGES`); this dispatcher's own CLI-side
  validation for `stage` is `apr-prepare`/`apr-run`'s existing
  `stage not in APR_STAGES` check. The new `apr-run` subcommand actually
  executes the prepared stage task and writes an `implement`-shaped
  candidate (`_cmd_apr_run`), so `extract`/`sta`/`physical`/`evaluate`/
  `adopt`/`record-experience` all follow unchanged.

Fix round 1 (controller review of Task 12b + two more CLI seams from Task 14's re-wire)
-----------------------------------------------------------------------------------------------

- `record-experience` refuses (`InputError("missing-input", ...)`, exit 2)
  a reason source whose `.reason` is missing or blank, and refuses the same
  way when no scenario in `state/sta.json` carries a `precision` -- neither
  is ever silently written as `""`/`null` (item 1).
- `record-experience`'s `predicted`/`measured` are now **deltas against the
  parent state's own `min(setup, hold)` WNS** (`_parent_min_wns`, looked up
  from `state/policy.json`'s `baselineMinWns` or `state/pointers.json`'s own
  pointer values by state id), not the candidate's raw absolute WNS --
  a controller decision on the risk that an absolute pair cannot itself
  express "helped"/"hurt"/"neutral" the way `experience._verdict`
  interprets `measured`'s sign. `conditions` also gains `predictionModel`
  (`_selected_predicted_min_wns`'s own "xtop"/"presta"/"unknown"). **Known
  limitation, out of this fix round's file scope (`atcs_cli.py` only):**
  `atcs.experience.record`'s own `_read_conditions` rebuilds `conditions`
  from a hardcoded `CONDITION_KEYS = ("stage","scenario","precision","toolVersion")`
  tuple, so `predictionModel` is computed and passed through correctly here
  but is currently *dropped*, never actually persisted into
  `state/experience.json`, until that M8 tuple itself gains a fifth entry
  -- a controller call on whether to include that one-line change (item 2).
- `apr-prepare` no longer takes `stage` on argv -- it reads `research/requests/next-decision.json`
  (a fixed, Pack-wide-known Workshop path, `NEXT_DECISION_REL_PATH`),
  requires `action == "earlier-apr"` and a `stage` in `APR_STAGES`, and
  records both `taskId` and `stage` in its new single fixed declared output,
  `state/apr-task.json` (replacing the old, four-stage `apr/<stage>/task.json`,
  which cannot be one fixed literal path across four possible stages).
  `apr-run` now takes only `<siteProfile>` and reads everything else back
  from `state/apr-task.json` (item 3).
- `record-experience` picks its reason source from `state/implement.json`'s
  own provenance: when `state/merge-commit.json` exists (a real batch was
  composed), it reads the given `<reasonSource>` argv path (the compose
  Workshop's `integration-plan`) as before; otherwise (an `apr-run`
  candidate, which never composes one) it reads `research/requests/next-decision.json`
  directly instead, never the nonexistent integration plan (item 4).
- `observe`'s argv `maxPaths` is now an upper **cap**, not a value that
  blindly overwrites the request: when `query_spec` already names its own
  `maxPaths` at or below the cap, that value is used; above the cap, it is
  clamped down; absent, the cap itself is used. The decision
  (`cap`/`requested`/`used`/`clamped`) is recorded at the non-declared side
  path `research/observe/max-paths.json` (item 5).

Task 12c fix round (Opus review of the compiled graph: CLI/Reader fixes)
-----------------------------------------------------------------------------

1. **Earlier APR is now executable.** `residual` (item 1a) builds
   `observation["checkDetails"]` itself: for up to `RESIDUAL_QUERY_BOUND`
   (20) of the evaluated candidate's `remaining` failing checks, the worst
   by known slack, it groups them by scenario, compiles and runs one
   `pt-query.tcl` task per scenario through the PT wrapper
   (`site_profile`/`scenarioCorners`, both new argv, see `_cmd_residual`)
   against the *working* design-state's own recorded netlist/SDC/SPEF
   (`_scenario_pt_inputs` -- shared with `observe`, re-verified by sha256),
   and parses each report with `adapters.parse_path_detail`. A query/parse
   failure leaves that one check's evidence `unknown` (never guessed) and
   is recorded in `queryNotes`. Item 1b: when `state/evaluation.json` does
   not exist yet, "remaining failing checks" are instead derived directly
   from `state/observation.json`'s own known-negative-slack checks
   (`_failing_checks_from_observation`), so earlier APR can be chosen
   straight from the baseline (SPEC Constraint 3). Item 1c is unchanged:
   `lifecycle.compile_intervention` (via `apr-prepare`) still refuses
   `no-intervention` (exit 3) when no case yields a setting.
2. **`reconcile`'s edit domains come from admitted state.** No longer takes
   `research/requests/work-package-w0N.json` argv paths at all; edit
   domains are read from `state/workers.json[slot]["workPackage"]
   ["editDomain"]` (written by `prepare-workers` from the validated
   package) -- a rewritten raw request file is never consulted.
3. **`observe`'s scenario inputs are not model-authored.** The
   `research/requests/observe-scenario-inputs.json` input is gone; `observe`
   builds every scenario's `{"design","netlist","sdc","spef"}` PT inputs
   itself from `state/working-state.json` (`_scenario_pt_inputs`,
   re-verified by sha256), using the *Site-fixed*
   `analysisContract/scenario-corners.json` for the corner map (not
   `state/policy.json`, which does not exist yet at `observe-baseline` time
   -- `graph.yml`'s own node order is `baseline -> observe-baseline ->
   policy`; `scenario-corners.json` is the same fixed document `sta`/
   `presta` already read). The model's own observation request still only
   chooses what to query (precision, required scenarios, path breadth).
4. **One admitted document per Workshop output.**
   a. `prepare-workers` reads `candidate.workPackages` of the ONE admitted
      campaign-plan envelope (`{"candidate":{"workPackages":{"w01"..,
      "w02"..,"w03"..},"reason"},"baseState":...,"siteCapabilities":...}`)
      -- the exact field the `campaign-plan` Reader itself counts -- instead
      of three separate, unadmitted `work-package-w0N.json` files. Fix
      round 1 (Critical, controller review): an earlier version of this fix
      had `prepare-workers` read a *different*, top-level `workPackages`
      key of that same file than the one the Reader validates
      (`candidate.workPackages`), reintroducing "two copies, nothing
      enforces they match" one level in; a top-level `workPackages` key
      present at all is now `AtcsError("ambiguous-plan", ...)` (exit 3) --
      see `_cmd_prepare_workers`'s own docstring. A new `campaign-plan`
      reader kind in `tools/read-atcs.py` counts problems
      (`workspaces.request_invalid_count`) across every slot in
      `workspaces.TASK_IDS` (Issue #64 Task 5, which also refuses shared
      instances, uncovered worst checks and active slots above the
      `workerSlots` knob) plus structural problems (missing
      `workPackages`/a slot/`reason`).
   b. `replay-prepare`, `compose-facts` (second pass) and
      `record-experience` all read the SAME integration-plan envelope file
      (`{"plan":...,"facts":...}` -- the exact shape
      `tools/read-atcs.py`'s existing `integration-plan` reader already
      expects) via the new shared `_read_admitted_plan` helper; the
      separate, unadmitted `integration-plan.json` (raw plan) is gone.
   c. `compose-facts` no longer takes `research/requests/resolutions.json`;
      its one `plan` argv arg is the same integration-plan envelope. The
      first pass (before the compose Workshop ever runs) has no file yet,
      so `resolutions=[]`; the second pass (after the plan is admitted)
      reads that plan's own `resolutions`, and *that* output is what feeds
      `composition-ready`/`replay-prepare`.
5. **Experience provenance is decided by id, not by file existence.**
   `_merge_commit_provenance` compares `state/implement.json`'s own
   `mergeCommitId` against `state/merge-commit.json`'s own `id` and
   `state/apr-task.json`'s own `taskId` -- fixing a real bug where a stale
   `state/merge-commit.json` left over from an earlier batch (never deleted
   by `apr-run`) would make `record-experience` misattribute a later
   `apr-run` candidate to that stale batch's own (wrong) reason.
   `_load_merge_commit_like` shares the same fix.
6. **No resurrected contributions.** `collect` only accepts a slot's sealed
   `state/contribution-<slot>.json` when its own `revision` still matches
   `state/workers.json[slot]["workspaceManifest"]["revision"]` -- the
   CURRENT `prepare-workers` call for that slot. A slot with no
   `state/workers.json` entry, or whose contribution's revision no longer
   matches, is reported in `pending` (now `{"slot","reason"}`, not a bare
   slot string) and its old contribution is never re-collected.

Fix round 2 (Opus re-review of Task 14 + Task 12c)
-------------------------------------------------------

1. **`residual` queries the EVALUATED candidate's own state.** Once
   `state/evaluation.json` exists, `_residual_candidate_state` loads
   `implementations/<mergeId>/design-state.json` (the exact file `sta`
   wrote and hashed for this candidate, `<mergeId>` from `state/
   implement.json`'s own `mergeCommitId`), cross-checks its `id` against
   `evaluation["stateId"]`, and hands *that* state to `_scenario_pt_inputs`
   -- never `state/working-state.json`, which is still the **parent** state
   for a refused (non-adopted) candidate (`adopt` only rewrites it when the
   `working` pointer actually moves). When the candidate's own state cannot
   be located or its id does not match, every queried check's evidence is
   left `unknown` with that reason (`queryNotes`), never silently falling
   back to a different (and wrong) state. Before any evaluation exists,
   this still queries the working state (the baseline), unchanged from the
   original Task 12c item 1b fix.
2. **One SDC source (controller decision).** `sta` no longer takes a
   separate `sdc` argv arg bound to a Site-fixed `analysisContract/sdc.json`
   copy; `_verified_state_sdc_path` reads SDC from the design state actually
   being timed (`baseDesignState`'s own recorded `sdc[0]`, sha256-verified)
   -- the exact same source `observe`/`residual` already use via
   `_scenario_pt_inputs`. `contract.yml`'s `sta` argv no longer names an
   SDC file.

Known gaps still open (see also `adapters.py`'s own "Gaps")
-------------------------------------------------------------------------------

- `presta` runs its cheap pre-check against the **base** state's own
  netlist/SPEF (not an intermediate, ECO-applied-but-not-yet-extracted
  netlist XTop would hold only inside a live session) -- this is the
  correctly-scoped, honest reading of `knowledge/cheap-verification.md`
  for this Pack's current artifact set: it demonstrates that a candidate's
  new nets are `unqualified` against RC modeling that predates them
  (`verification.presta_qualification`'s whole point), rather than
  fabricating a more precise predicted value this Pack cannot yet obtain
  without a full StarRC extraction.
- Direct consequence of the above (controller-flagged, for T14's
  `FABRIC.md` Gaps, not a code fix): because `presta` always compares a
  batch's `newNets` against the **base** SPEF's own net names, and the base
  SPEF by definition never models a net that batch itself is about to
  create, `tc_unqualified_rc_net_count` is >0 for **every** batch that
  contains an `insert_buffer` op, with no exception. Whatever Judge rule
  this Pack wires on top of `precheck-evidence` (a "presta-model-qualified"
  gate) will therefore always route an insertion-containing batch to its
  next-decision/escalation path rather than ever accepting presta's own
  predicted WNS for such a batch, until a real in-session RC source (a
  live XTop incremental extraction, or a genuine post-implement StarRC
  refresh) exists for T12 to point `precheck_evidence` at instead of the
  base SPEF. This is a real, structural limitation of what evidence this
  Pack's current artifact set makes available at `presta` time, not a bug
  in the qualification check itself.

`atcs.refresh` / `verification.precheck_evidence` wiring (Task 13 fix round)
--------------------------------------------------------------------------------

- `_cmd_sta` calls `refresh.record_refresh(state/refresh-ledger.json,
  mergeCommitId, designStateId, sta_sources)` exactly once, after the
  per-scenario STA loop and the new design-state are both built.
  `sta_sources` is `{scenario: {"path","sha256"}}` for every
  required scenario entry -- the SPEF ref that scenario's
  STA actually read, matching `record_refresh`'s own validated shape
  (`atcs/refresh.py`'s module docstring: "must name a `{path, sha256}`
  reference for every scenario").
- `_cmd_presta` calls `integration.seal_batch` itself (read-only,
  side-effect-free re-derivation over the already-reconciled
  `integration-state`) purely to obtain `merge_commit["newNets"]` before
  `implement` has sealed one for real; writes the base SPEF's net names to
  `integrations/<batchId>/presta/spef-net-names.txt`, **one name per line**
  (matching `tools/read-atcs.py`'s `precheck-evidence` reader, which parses
  that source as plain text, never JSON), and calls
  `verification.precheck_evidence(merge_commit, spef_net_names_path)` for
  the declared output directly -- `precheck_evidence` never parses or
  embeds that source's content itself, only hashes it, so the Reader can
  independently re-parse and re-hash it.
- `_cmd_adopt`'s declared output is `{"acceptanceRecord","refreshLedger"}`,
  both workspace-relative paths (never embedded content), matching
  `tools/read-atcs.py`'s updated `acceptance-record` reader.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import re
import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_FLOW_DIR = Path(__file__).resolve().parent
if str(_FLOW_DIR) not in sys.path:
    sys.path.insert(0, str(_FLOW_DIR))

from atcs import core  # noqa: E402
from atcs import state  # noqa: E402
from atcs import workspaces  # noqa: E402
from atcs import contributions  # noqa: E402
from atcs import composition  # noqa: E402
from atcs import integration  # noqa: E402
from atcs import verification  # noqa: E402
from atcs import adoption  # noqa: E402
from atcs import experience  # noqa: E402
from atcs import residual as residual_module  # noqa: E402
from atcs import lifecycle  # noqa: E402
from atcs import adapters  # noqa: E402


APR_STAGES = ("place", "cts", "route", "postroute")

# Fix round 1 (G1/G2): the next-investment Workshop's own `next-decision` --
# a fixed, Pack-wide-known path (`contract.yml`'s `nextDecision` output),
# never per-run/per-id -- is read directly by convention, the same way
# every other fixed Site/Workshop path already is; `apr-prepare` reads its
# `stage` from here (it is no longer an argv value), and `record-experience`
# falls back to it for an `apr-run` candidate's own reason (no integration
# plan was ever composed for one).
NEXT_DECISION_REL_PATH = "research/requests/next-decision.json"


class InputError(Exception):
    """A declared input file is missing, unreadable or malformed (exit code 2)."""

    def __init__(self, code, detail):
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------------------
# Declared-input readers (exit code 2 on any failure)
# ---------------------------------------------------------------------------


def _read_plain(path):
    """Read one plain (non artifact-stamped) JSON input file."""
    target = Path(path)
    if not target.is_file():
        raise InputError("missing-input", f"declared input not found: {target}")
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError("invalid-input", f"cannot parse {target}: {exc}") from exc


def _read_json_or_default(path, default):
    """Like `_read_plain`, but a missing file is not an error (returns `default`)."""
    target = Path(path)
    if not target.is_file():
        return default
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InputError("invalid-input", f"cannot parse {target}: {exc}") from exc


def _read_declared(path, kind):
    """Read one `core.stamp`-ed artifact input, enforcing its `schema`/`id`."""
    obj = _read_plain(path)
    expected_schema = f"atcs.{kind}/1"
    if obj.get("schema") != expected_schema:
        raise InputError("invalid-input", f"expected schema {expected_schema} at {path}, got {obj.get('schema')!r}")
    stored_id = obj.get("id")
    body = dict(obj)
    body.pop("id", None)
    if stored_id != core.digest(body):
        raise InputError("invalid-input", f"identity mismatch at {path}")
    return obj


def _read_text(path):
    target = Path(path)
    if not target.is_file():
        raise InputError("missing-input", f"declared input not found: {target}")
    try:
        return target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise InputError("invalid-input", f"cannot read {target}: {exc}") from exc


def _relpath(path, workspace):
    return os.path.relpath(str(path), start=str(workspace))


def _canonical_write(path, obj):
    """Write a side (non-declared) artifact/record file -- best-effort provenance only."""
    core.write_artifact(path, obj)


def _next_evidence_generation_dir(parent_dir):
    """A fresh `<parent_dir>/g<N>` subdirectory naming this call's own generation
    (I12, final review: write-once raw evidence).

    `research/observe/`/`research/residual/` used to write every call's own raw PT
    reports at one fixed, scenario-named path -- a second `observe`/`residual` call in
    the same Campaign (a follow-up diagnostic query, or the "at every evaluation" cadence
    `residual` already runs at, per FABRIC.md G18) silently overwrote the previous
    generation's own raw evidence at that same path, even though the *parsed*
    observation/residual-case artifacts this Pack writes are each their own,
    content-addressed, never-overwritten file. This makes each call's own raw evidence
    directory itself write-once: a fresh `g<N>` every call, so a failed or partial run
    never gets mistaken for -- or silently destroys -- a different generation's own
    files, the same rule this dispatcher's module docstring already states for
    `implementations/<mergeId>/`/`integrations/<batchId>/`.

    `N` comes from a plain monotonic counter file (`<parent_dir>/.generation`,
    starting at `1`), never from scanning which `g<N>` directories already happen to
    exist on disk: a Site/adapter (or a test's own fake-wrapper convention: pre-seed
    the exact report path this call is about to look for, since the fake wrapper
    never actually runs PT) is expected to write real files *into* the directory this
    function names before this call returns -- that is this call's own generation's
    evidence, not a sign the slot is already taken by someone else. The counter itself
    is what "write-once" is actually enforced by: it only ever advances, one call at a
    time, never re-issuing a generation number this campaign has already used, even
    across the entire life of the Campaign workspace.
    """
    parent_dir = Path(parent_dir)
    counter_path = parent_dir / ".generation"
    try:
        generation = int(counter_path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        generation = 1
    parent_dir.mkdir(parents=True, exist_ok=True)
    counter_path.write_text(str(generation + 1), encoding="utf-8")
    return parent_dir / f"g{generation}"


# ---------------------------------------------------------------------------
# Fixed workspace paths (see module docstring's table)
# ---------------------------------------------------------------------------


def _paths(workspace):
    workspace = Path(workspace)
    state_dir = workspace / "state"
    return {
        "readiness": state_dir / "readiness.json",
        "baseline": state_dir / "baseline.json",
        "working_state": state_dir / "working-state.json",
        "policy": state_dir / "policy.json",
        "pointers": state_dir / "pointers.json",
        "observation": state_dir / "observation.json",
        "observation_prev": state_dir / "observation-prev.json",
        "xtop_context": state_dir / "xtop-context.json",
        "risk": state_dir / "risk.json",
        "experience": state_dir / "experience.json",
        "workers": state_dir / "workers.json",
        "worker_slots": state_dir / "worker-slots.json",
        "contributions_collected": state_dir / "contributions-collected.json",
        "composition_facts": state_dir / "composition-facts.json",
        "replay_request": state_dir / "replay-request.json",
        "replay_receipts": state_dir / "replay-receipts.json",
        "integration_state": state_dir / "integration-state.json",
        "presta": state_dir / "presta.json",
        "merge_commit": state_dir / "merge-commit.json",
        "implement": state_dir / "implement.json",
        "extract": state_dir / "extract.json",
        "sta": state_dir / "sta.json",
        "physical": state_dir / "physical.json",
        "baseline_physical": state_dir / "baseline-physical.json",
        "evaluation": state_dir / "evaluation.json",
        "residual_cases": state_dir / "residual-cases.json",
        "refresh_ledger": state_dir / "refresh-ledger.json",
        "apr_task": state_dir / "apr-task.json",
        "accepted": workspace / "accepted" / "latest.json",
    }


def _contribution_path(workspace, slot):
    return Path(workspace) / "state" / f"contribution-{slot}.json"


# ---------------------------------------------------------------------------
# Subcommand handlers -- each returns (output_path, body_to_write)
# ---------------------------------------------------------------------------


def _cmd_bind_inputs(workspace, args):
    manifest_path, site_caps_path = args
    manifest = _read_plain(manifest_path)
    site_capabilities = _read_plain(site_caps_path)
    body = state.input_readiness(manifest, site_capabilities)
    return _paths(workspace)["readiness"], body


def _native_timing_input(path, manifest_path=None):
    """Validate the Site-bound retained native timing input before it is copied or consumed."""
    obj = _read_plain(path)
    if not isinstance(obj, dict) or obj.get("schema") != "atcs.native-timing-context/1":
        raise InputError("invalid-input", "nativeTimingContext must have schema atcs.native-timing-context/1")
    required = {"schema", "designStateManifestSha256", "requiredScenarios", "staData",
                "sourceReports", "constraints", "producer"}
    if set(obj) != required:
        raise InputError("invalid-input", f"nativeTimingContext must have exactly {sorted(required)}")
    if manifest_path is not None and obj["designStateManifestSha256"] != core.file_sha256(Path(manifest_path)):
        raise core.AtcsError("identity-mismatch", "native timing data belongs to another designStateManifest")
    scenarios = obj["requiredScenarios"]
    if (not isinstance(scenarios, list) or not scenarios
            or not all(isinstance(item, str) and item for item in scenarios)
            or len(set(scenarios)) != len(scenarios)):
        raise InputError("invalid-input", "nativeTimingContext.requiredScenarios must be unique non-empty names")
    sta_data = obj["staData"]
    if not isinstance(sta_data, dict) or set(sta_data) != {"path", "digest"}:
        raise InputError("invalid-input", "nativeTimingContext.staData must be {path,digest}")
    sta_path = Path(sta_data["path"])
    if sta_path.is_symlink() or not sta_path.is_dir() or core.tree_digest(sta_path) != sta_data["digest"]:
        raise core.AtcsError("identity-mismatch", "retained native STA data is missing, linked or changed")
    for field in ("sourceReports", "constraints"):
        refs = obj[field]
        if not isinstance(refs, list) or not refs:
            raise InputError("invalid-input", f"nativeTimingContext.{field} must be a non-empty list")
        for index, ref in enumerate(refs):
            if not isinstance(ref, dict) or set(ref) != {"path", "sha256"}:
                raise InputError("invalid-input", f"nativeTimingContext.{field}[{index}] must be {{path,sha256}}")
            target = Path(ref["path"])
            if target.is_symlink() or not target.is_file() or core.file_sha256(target) != ref["sha256"]:
                raise core.AtcsError("identity-mismatch", f"nativeTimingContext.{field}[{index}] is missing, linked or changed")
    producer = obj["producer"]
    if (not isinstance(producer, dict) or set(producer) != {"tool", "version", "command"}
            or not all(isinstance(producer[key], str) and producer[key] for key in producer)):
        raise InputError("invalid-input", "nativeTimingContext.producer needs non-empty tool/version/command")
    return obj


def _cmd_bind_resident_inputs(workspace, args):
    manifest_path, site_caps_path, native_context_path = args
    native = _native_timing_input(native_context_path, manifest_path)
    manifest = _read_plain(manifest_path)
    manifest_scenarios = [entry.get("name") for entry in manifest.get("scenarios") or []]
    if manifest_scenarios != native["requiredScenarios"]:
        raise core.AtcsError("identity-mismatch", "nativeTimingContext scenarios differ from designStateManifest")
    root = Path(manifest.get("root") or ".")
    constraint_hashes = []
    for value in manifest.get("sdc") or []:
        target = Path(value)
        if not target.is_absolute():
            target = root / target
        constraint_hashes.append(core.file_sha256(target))
    if constraint_hashes != [ref["sha256"] for ref in native["constraints"]]:
        raise core.AtcsError("identity-mismatch", "nativeTimingContext constraints differ from designStateManifest")
    return _cmd_bind_inputs(workspace, [manifest_path, site_caps_path])


def _copy_verified_file(source, destination):
    source, destination = Path(source), Path(destination)
    if source.is_symlink() or not source.is_file():
        raise core.AtcsError("missing-input", f"retained native file is missing or linked: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return {"path": None, "sha256": core.file_sha256(destination)}


def _cmd_prepare_native_context(workspace, args):
    native_context_path, site_caps_path = args
    workspace = Path(workspace)
    native = _native_timing_input(native_context_path)
    base = _read_declared(_paths(workspace)["baseline"], "design-state")
    if list(base.get("scenarios") or []) != native["requiredScenarios"]:
        raise core.AtcsError("identity-mismatch", "retained native scenarios differ from staged baseline")
    if [entry.get("sha256") for entry in base.get("sdc") or []] != [entry["sha256"] for entry in native["constraints"]]:
        raise core.AtcsError("identity-mismatch", "retained native constraints differ from staged baseline")
    site = _read_plain(site_caps_path)
    site_context = adapters.compile_xtop_site_context(site, native["requiredScenarios"])
    if site_context is None:
        raise core.AtcsError("missing-input", "the Site declares no XTop context")
    root = workspace / "research" / "native-input"
    sta_target = root / "sta-data"
    if sta_target.exists():
        raise core.AtcsError("write-once", "native timing context was already prepared")
    shutil.copytree(native["staData"]["path"], sta_target, symlinks=False)
    if core.tree_digest(sta_target) != native["staData"]["digest"]:
        raise core.AtcsError("identity-mismatch", "copied native STA data differs from retained input")
    library_path = root / "xtop-library.tcl"
    library_path.parent.mkdir(parents=True, exist_ok=True)
    library_path.write_text(site_context["libraryTcl"], encoding="utf-8")
    report_refs = []
    for index, ref in enumerate(native["sourceReports"]):
        target = root / "source-reports" / f"{index:03d}-{Path(ref['path']).name}"
        copied = _copy_verified_file(ref["path"], target)
        copied["path"] = _relpath(target, workspace)
        if copied["sha256"] != ref["sha256"]:
            raise core.AtcsError("identity-mismatch", f"copied native source report {index} changed")
        report_refs.append(copied)
    body = {
        "designStateId": base["id"], "requiredScenarios": list(native["requiredScenarios"]),
        "libraryTcl": {"path": _relpath(library_path, workspace), "sha256": core.file_sha256(library_path)},
        "staData": {"path": _relpath(sta_target, workspace), "digest": core.tree_digest(sta_target)},
        "libraryFiles": site_context["libraryFiles"], "siteMap": site_context["siteMap"],
        "removableFillers": site_context["removableFillers"], "ecoParameters": site_context["ecoParameters"],
        "constraints": list(native["constraints"]), "sourceReports": report_refs,
        "producer": dict(native["producer"]), "sourceInputSha256": core.file_sha256(Path(native_context_path)),
    }
    return _paths(workspace)["xtop_context"], core.stamp("xtop-context", body)


def _stage_baseline_inputs(workspace, manifest):
    """Copy `manifest`'s referenced source files into `<workspace>/baseline/` and return a
    new manifest whose `root` is `workspace` itself (C3, final review: wrong file root).

    Controller decision: stage the baseline into the Campaign workspace like
    the qualified old Pack does (`packs/xtop-timing-closure/flow/closure.py`
    ~225-249, read-only reference, never imported: it stages the Foundation's
    own `.enc`/`.enc.dat` and related trees under the workspace before ever
    computing an identity over them). `manifest["root"]` (and every path
    entry that is not already absolute) may name an arbitrary EXTERNAL
    directory the Campaign workspace never sees again (a Site-supplied
    staging area, for instance) -- every later subcommand, though
    (`workspaces.prepare`'s `_base_sources`, `_scenario_pt_inputs`,
    `_cmd_implement`, ...), resolves a design-state's own recorded `path`
    fields as `workspace / ref["path"]`. Building the baseline `design-state`
    directly against `manifest`'s own (possibly external) root would silently
    bind every one of those `path` fields to a root no other subcommand ever
    joins against again -- `workspace / ref["path"]` would then resolve to a
    nonexistent or, worse, a coincidentally-existing but wrong file.

    This function copies each of `database.enc`, `database.encDat` (a
    directory), `netlist`, `def` (when present), each `spef` corner and each
    `sdc` entry into a fixed, category-named subtree under
    `<workspace>/baseline/` (by basename, not by the original manifest's own
    relative structure, which may not even be relative at all — an absolute
    manifest path joined onto another path is not what Python's `pathlib`
    does), and returns a new manifest with `root = str(workspace)` and every
    one of those keys rewritten to its new `baseline/...`-relative location.
    `atcs.state.design_state` then hashes the COPIES, so the resulting
    design-state's own identity is bound to bytes that actually live inside
    the Campaign workspace, at paths every later subcommand can resolve the
    same way. `libraries`/`scenarios`/`tools`/`parentId`/`top`/`stage` are
    passed through unchanged (`design_state` never reads `libraries`, and
    the rest are not paths).

    Raises `AtcsError("missing-input", ...)` when a referenced source file or
    directory cannot actually be copied (does not exist, or an `OSError`
    reading it) -- a baseline this Pack cannot honestly stage is never
    silently skipped.
    """
    workspace = Path(workspace)
    baseline_dir = workspace / "baseline"
    root = manifest.get("root")

    def _resolve_source(rel_path):
        if root and not os.path.isabs(rel_path):
            return str(Path(root) / rel_path)
        return str(rel_path)

    def _copy_file(rel_path, dest_rel):
        """`dest_rel` is relative to `baseline_dir` (i.e. it does NOT itself start
        with `baseline/`); returns the manifest-relative path (relative to
        `workspace`, i.e. WITH the `baseline/` prefix) `state.design_state` should
        record."""
        source = _resolve_source(rel_path)
        destination = baseline_dir / dest_rel
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source, destination)
        except OSError as exc:
            raise core.AtcsError("missing-input", f"cannot stage baseline file {rel_path!r}: {exc}") from exc
        return f"baseline/{dest_rel}"

    def _copy_tree(rel_path, dest_rel):
        """Directory counterpart of `_copy_file` -- same `dest_rel`/return convention."""
        source = _resolve_source(rel_path)
        destination = baseline_dir / dest_rel
        if destination.exists():
            shutil.rmtree(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copytree(source, destination, symlinks=True)
        except OSError as exc:
            raise core.AtcsError("missing-input", f"cannot stage baseline directory {rel_path!r}: {exc}") from exc
        return f"baseline/{dest_rel}"

    staged = dict(manifest)
    staged["root"] = str(workspace)

    database = dict(manifest.get("database") or {})
    if database.get("enc"):
        database["enc"] = _copy_file(database["enc"], f"database/{Path(database['enc']).name}")
    if database.get("encDat"):
        database["encDat"] = _copy_tree(database["encDat"], f"database/{Path(database['encDat']).name}")
    staged["database"] = database

    if manifest.get("netlist"):
        staged["netlist"] = _copy_file(manifest["netlist"], f"netlist/{Path(manifest['netlist']).name}")

    if manifest.get("def") is not None:
        staged["def"] = _copy_file(manifest["def"], f"def/{Path(manifest['def']).name}")

    if manifest.get("spef"):
        staged["spef"] = {
            corner: _copy_file(rel_path, f"spef/{corner}/{Path(rel_path).name}")
            for corner, rel_path in manifest["spef"].items()
        }

    if manifest.get("sdc"):
        staged["sdc"] = [
            _copy_file(rel_path, f"sdc/{index}/{Path(rel_path).name}")
            for index, rel_path in enumerate(manifest["sdc"])
        ]

    return staged


def _stage_lifecycle_checkpoints(workspace, manifest):
    """Copy each full-flow lifecycle stage's own checkpoint (`.enc` script + `.enc.dat`
    directory) into `<workspace>/DBS/<stage>.enc(.dat)` (I2, final review: staged
    lifecycle checkpoint).

    `atcs.lifecycle.stage_task` has always restored `./DBS/<prevStage>.enc.dat`
    (workspace-relative to the Campaign root `apr/<stage>/<taskId>/`'s own
    parent) -- confirmed by reading `stage_task` directly, nothing in this
    dispatcher ever copied a stage checkpoint to that exact location. A
    full-flow campaign's `apr-run` for any stage past the very first would
    therefore restore a checkpoint that was never staged at all. Mirrors
    `_stage_baseline_inputs`'s own copy convention (by basename, resolved
    against `manifest["root"]` when the source path is relative) rather than
    reusing it directly, since the source shape here (`lifecycle.stages.
    <stage>.{checkpoint,script}`, `atcs.state`'s own manifest schema) is
    unrelated to a `design-state`'s `database.enc`/`encDat` pair.

    Never raises when `manifest` carries no `lifecycle` block at all (a
    post-route-only campaign has none to stage) or when a given stage is
    simply absent from `lifecycle.stages` (`state.input_readiness` is the
    authority on whether the *declared* set is actually complete; this
    function stages whatever is honestly present, never invents a stage).
    Raises `AtcsError("missing-input", ...)` when a declared stage's own
    checkpoint/script cannot actually be copied.
    """
    lifecycle = manifest.get("lifecycle")
    if not lifecycle:
        return
    root = manifest.get("root")
    stages = lifecycle.get("stages") or {}
    dbs_dir = Path(workspace) / "DBS"

    def _resolve_source(rel_path):
        if root and not os.path.isabs(rel_path):
            return str(Path(root) / rel_path)
        return str(rel_path)

    for stage in state.REQUIRED_LIFECYCLE_STAGES:
        entry = stages.get(stage)
        if not isinstance(entry, dict):
            continue
        script_ref, checkpoint_ref = entry.get("script"), entry.get("checkpoint")
        if not script_ref or not checkpoint_ref:
            continue
        script_dest = dbs_dir / f"{stage}.enc"
        data_dest = dbs_dir / f"{stage}.enc.dat"
        try:
            script_dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(_resolve_source(script_ref), script_dest)
            if data_dest.exists():
                shutil.rmtree(data_dest)
            shutil.copytree(_resolve_source(checkpoint_ref), data_dest, symlinks=True)
        except OSError as exc:
            raise core.AtcsError("missing-input", f"cannot stage {stage} lifecycle checkpoint: {exc}") from exc


def _cmd_baseline(workspace, args):
    """Build the baseline `design-state` and seed `state/working-state.json` from it verbatim.

    `state/working-state.json` is the one fixed, literal-path entry file
    every later subcommand that used to take `state/baseline.json` as its
    base (`prepare-workers`, `compose-facts`, `replay-prepare`, `presta`,
    `implement`, `sta`, `adopt`) reads instead (G1/G7) -- `adopt` rewrites it
    with the adopted candidate's own design-state whenever the `working`
    pointer moves (see `_cmd_adopt`), so a second implementation round
    re-bases on the *adopted* state, never the original baseline again.

    C3 (final review, wrong file root): the manifest's referenced source
    files are staged into `<workspace>/baseline/` first
    (`_stage_baseline_inputs`), and `state.design_state` is called against
    the STAGED manifest (`root = workspace`), never the caller-supplied
    manifest's own (possibly external) root -- see `_stage_baseline_inputs`'s
    own docstring for why every later subcommand depends on this.

    I2 (final review, staged lifecycle checkpoint): when the manifest also
    declares a `lifecycle` block, every stage's own checkpoint is
    additionally staged into `<workspace>/DBS/<stage>.enc(.dat)`
    (`_stage_lifecycle_checkpoints`) -- the exact workspace-relative location
    `atcs.lifecycle.stage_task` has always restored from but that nothing
    ever populated before this fix.
    """
    (manifest_path,) = args
    manifest = _read_plain(manifest_path)
    staged_manifest = _stage_baseline_inputs(workspace, manifest)
    _stage_lifecycle_checkpoints(workspace, manifest)
    body = state.design_state(staged_manifest)
    _canonical_write(_paths(workspace)["working_state"], body)
    return _paths(workspace)["baseline"], body


def _verified_state_sdc_path(workspace, design_state):
    """The single SDC file `design_state` itself records (its own `sdc[0]` entry),
    re-verified by sha256 -- the ONE SDC source every PT-launching subcommand uses
    (Fix round 2 item 2, controller decision): `observe`/`residual` already read it this
    way via `_scenario_pt_inputs` below; `sta` now reads it the same way, from the design
    state actually being timed, instead of a separate Site-fixed `analysisContract/
    sdc.json` copy that could silently name a different SDC than the one the state itself
    was built from. Raises `AtcsError("missing-input", ...)` when `design_state` has no
    SDC entries, and `AtcsError("identity-mismatch", ...)` when the referenced file's
    current sha256 no longer matches the recorded one.
    """
    sdc_list = design_state.get("sdc") or []
    if not sdc_list:
        raise core.AtcsError("missing-input", "design state has no SDC entries")
    sdc_ref = sdc_list[0]
    sdc_path = workspace / sdc_ref["path"]
    if core.file_sha256(sdc_path) != sdc_ref.get("sha256"):
        raise core.AtcsError("identity-mismatch", f"design state sdc sha256 mismatch at {sdc_path}")
    return sdc_path


_SCENARIOS_CONTRACT_FIELDS = {"name", "corner", "libGlob", "driverLibrary", "originalDriverLibrary"}


def _load_scenarios_contract(scenarios_path):
    """`{scenario: {"corner","libGlob","driverLibrary","originalDriverLibrary"}}` from
    `analysisContract/scenarios.json` (C4, final review, per-scenario library identity).

    `scenarios.json` is `[{name, corner, libGlob, driverLibrary,
    originalDriverLibrary}]` -- the single Site-provided source of both a
    scenario's RC corner AND its PT library identity (previously two
    independent documents, `scenario-corners.json` for the corner and
    nothing at all for the library, which `_scenario_pt_inputs` never
    filled). Raises `InputError("invalid-input", ...)` when the document is
    not a non-empty list, an entry's fields are not exactly the five above (each a
    non-empty string), or a scenario name repeats. This admitted Site document owns
    the scenario names; each query and derived policy must agree with it exactly.
    """
    raw = _read_plain(scenarios_path)
    if not isinstance(raw, list) or not raw:
        raise InputError("invalid-input", "scenarios.json must be a non-empty list")
    scenarios = {}
    for entry in raw:
        if not isinstance(entry, dict) or set(entry) != _SCENARIOS_CONTRACT_FIELDS:
            raise InputError(
                "invalid-input",
                f"each scenarios.json entry must have exactly {sorted(_SCENARIOS_CONTRACT_FIELDS)}",
            )
        for key in _SCENARIOS_CONTRACT_FIELDS:
            if not isinstance(entry[key], str) or not entry[key]:
                raise InputError("invalid-input", f"scenarios.json entry field {key!r} must be a non-empty string")
        name = entry["name"]
        if name in scenarios:
            raise InputError("invalid-input", f"duplicate scenario name in scenarios.json: {name!r}")
        scenarios[name] = entry
    return scenarios


def _required_scenarios_for_contract(query_spec, scenarios_contract):
    """Return the query's ordered names after exact agreement with ``scenarios.json``."""
    try:
        required = core.required_scenarios((query_spec or {}).get("requiredScenarios"))
    except core.AtcsError as exc:
        raise InputError(exc.code, exc.detail) from exc
    contract_names = tuple(scenarios_contract)
    if set(required) != set(contract_names):
        missing = [name for name in contract_names if name not in required]
        extra = [name for name in required if name not in scenarios_contract]
        raise InputError(
            "invalid-input",
            f"requiredScenarios disagrees with scenarios.json; missing={missing}, extra={extra}",
        )
    return required


def _derive_scenario_corners(scenarios_contract):
    """`{scenario: corner}`, derived from `scenarios.json` -- the single source C4 makes
    `policy`'s own `scenarioCorners` and every PT-launching subcommand's corner lookup
    agree with, instead of two independently-authored Site documents that could
    silently diverge."""
    return {scenario: entry["corner"] for scenario, entry in scenarios_contract.items()}


def _workspace_context_path(workspace, value, label):
    """Resolve a context ref and prove it remains inside this Campaign workspace."""
    workspace = Path(workspace).resolve()
    path = Path(value)
    resolved = path.resolve() if path.is_absolute() else (workspace / path).resolve()
    if not resolved.is_relative_to(workspace):
        raise core.AtcsError("invalid-input", f"{label} is outside the Campaign workspace")
    return resolved


def _verified_xtop_context(workspace, design_state_id, site_profile):
    """Load and re-hash the timing/library context immediately before XTop starts."""
    workspace = Path(workspace)
    if not (workspace / "state/method-clock.json").exists():
        _canonical_write(workspace / "state/method-clock.json", {"startedAt": time.time()})
    context = _read_declared(_paths(workspace)["xtop_context"], "xtop-context")
    if context.get("designStateId") != design_state_id:
        raise core.AtcsError("stale-base", "XTop context is not bound to the current design state")
    required_scenarios = core.required_scenarios(context.get("requiredScenarios"), "xtopContext.requiredScenarios")
    current_site_context = adapters.compile_xtop_site_context(site_profile, required_scenarios)
    if current_site_context is None:
        raise core.AtcsError("missing-input", "the current Site declares no XTop context")
    for key in ("libraryFiles", "siteMap", "removableFillers", "ecoParameters"):
        if context.get(key) != current_site_context.get(key):
            raise core.AtcsError("identity-mismatch", f"XTop context {key} differs from the current Site")
    library_ref = context.get("libraryTcl") or {}
    timing_ref = context.get("staData") or {}
    library_path = _workspace_context_path(workspace, library_ref.get("path", ""), "libraryTcl.path")
    timing_path = _workspace_context_path(workspace, timing_ref.get("path", ""), "staData.path")
    if not library_path.is_file() or core.file_sha256(library_path) != library_ref.get("sha256"):
        raise core.AtcsError("identity-mismatch", "XTop library Tcl is missing or changed")
    if library_path.read_text(encoding="utf-8") != current_site_context["libraryTcl"]:
        raise core.AtcsError("identity-mismatch", "XTop library Tcl differs from the current Site")
    if not timing_path.is_dir() or core.tree_digest(timing_path) != timing_ref.get("digest"):
        raise core.AtcsError("identity-mismatch", "XTop STA data is missing or changed")
    for scenario, refs in (context.get("libraryFiles") or {}).items():
        if not isinstance(refs, list) or not refs:
            raise core.AtcsError("missing-input", f"XTop library identity is missing for {scenario}")
        for ref in refs:
            path = Path(ref.get("path", ""))
            if not path.is_file() or core.file_sha256(path) != ref.get("sha256"):
                raise core.AtcsError("identity-mismatch", f"XTop library file is missing or changed: {path}")
    common_path = workspace / "state/common-stage.json"
    seed = None
    if common_path.is_file():
        common = _read_plain(common_path)
        if common.get("parentStateId") != design_state_id:
            raise core.AtcsError("stale-base", "common R1 belongs to another external state")
        seed = common["seed"]
        seed_path = _workspace_context_path(workspace, seed["path"], "seed.path")
        if not seed_path.is_dir() or core.tree_digest(seed_path) != seed["digest"]:
            raise core.AtcsError("identity-mismatch", "saved common R1 bytes changed")
    verified = dict(context)
    if seed:
        verified["seed"] = {**seed, "path": str(seed_path)}
    verified["libraryTcl"] = {**library_ref, "path": str(library_path)}
    verified["staData"] = {**timing_ref, "path": str(timing_path)}
    return verified


def _scenario_pt_inputs(workspace, working_state, scenarios_contract, scenario):
    """One scenario's `{"design","netlist","sdc","spef","libGlob","driverLibrary",
    "originalDriverLibrary","libraryFiles"}` PT inputs, built from the *working*
    design-state's own recorded files -- never a model-supplied path (Task 12c item 3).

    `working_state` is an already schema/id-verified `design-state` artifact
    (`_read_declared`); this function additionally re-verifies, by sha256,
    that the netlist/SDC/SPEF files it is about to hand to PT still match
    the bytes that `design_state` recorded -- the same defense-in-depth
    `tools/read-atcs.py`'s `_verify_design_state_refs` applies on the Reader
    side. `scenarios_contract` is `_load_scenarios_contract`'s own
    `{scenario: {...}}` map (C4, final review) -- the single Site-provided
    source of both this scenario's RC corner and its PT library identity
    (`libGlob`/`driverLibrary`/`originalDriverLibrary`), never a bare
    `{scenario: corner}` map with no library information at all. `libGlob`'s
    matched `.db` files are hashed fresh, right here, via
    `adapters.hash_library_glob` -- fail-closed (`AtcsError("missing-input",
    ...)`) when the Site's own configured glob matches nothing, before PT
    ever launches. Raises `InputError("invalid-input", ...)` for a scenario
    missing from `scenarios_contract`, `AtcsError("missing-input", ...)` for
    a working state missing the named corner's SPEF or any SDC entry, and
    `AtcsError("identity-mismatch", ...)` when a referenced file's current
    sha256 no longer matches the working state's own recorded one.
    """
    entry = scenarios_contract.get(scenario)
    if not entry:
        raise InputError("invalid-input", f"scenarios contract is missing {scenario!r}")
    corner = entry["corner"]
    netlist_ref = working_state.get("netlist") or {}
    spef_ref = (working_state.get("spef") or {}).get(corner)
    if not netlist_ref.get("path"):
        raise core.AtcsError("missing-input", "working state has no netlist")
    if not spef_ref:
        raise core.AtcsError("missing-input", f"working state has no SPEF for corner {corner!r}")

    netlist_path = workspace / netlist_ref["path"]
    spef_path = workspace / spef_ref["path"]
    if core.file_sha256(netlist_path) != netlist_ref.get("sha256"):
        raise core.AtcsError("identity-mismatch", f"working state netlist sha256 mismatch at {netlist_path}")
    sdc_path = _verified_state_sdc_path(workspace, working_state)
    if core.file_sha256(spef_path) != spef_ref.get("sha256"):
        raise core.AtcsError("identity-mismatch", f"working state spef sha256 mismatch at {spef_path}")

    library_files = adapters.hash_library_glob(entry["libGlob"], label=f"{scenario} libGlob")

    return {
        "design": working_state["top"], "netlist": str(netlist_path),
        "sdc": str(sdc_path), "spef": str(spef_path),
        "libGlob": entry["libGlob"], "driverLibrary": entry["driverLibrary"],
        "originalDriverLibrary": entry["originalDriverLibrary"], "libraryFiles": library_files,
    }


def _apply_max_paths_cap(query_spec, max_paths_raw, side_path):
    """Clamp `query_spec["maxPaths"]` to the Strategy's own upper cap (`max_paths_raw`);
    return the mutated `query_spec`.

    I10 (final review): shared by `observe` (Fix round 1 item 5's original home)
    and `sta`, which used to take its whole `query_spec` -- including `maxPaths`
    -- verbatim from a static `analysisContract/query-spec.json`, with no
    Strategy-driven upper bound at all. Same rule both places: when
    `query_spec` already names its own `maxPaths` and it is `<= cap`, that
    value is used verbatim; when it is greater than the cap, it is clamped
    down; when the request names none at all, the cap itself is used. The
    clamp decision itself (`cap`, `requested`, `used`, `clamped`) is recorded,
    verbatim, at the non-declared `side_path` -- neither `observation-set` nor
    `state/sta.json` has a field for it. Raises `InputError("invalid-input",
    ...)` when `max_paths_raw` is not a positive int.
    """
    try:
        cap = int(max_paths_raw)
    except (TypeError, ValueError):
        raise InputError("invalid-input", f"maxPaths must be an integer, got {max_paths_raw!r}")
    if isinstance(cap, bool) or cap <= 0:
        raise InputError("invalid-input", f"maxPaths must be a positive int, got {max_paths_raw!r}")

    requested = query_spec.get("maxPaths")
    if isinstance(requested, bool) or not isinstance(requested, int) or requested <= 0:
        requested = None
    effective = cap if requested is None else min(requested, cap)
    clamped = requested is not None and requested > cap
    query_spec["maxPaths"] = effective

    _canonical_write(side_path, {"cap": cap, "requested": requested, "used": effective, "clamped": clamped})
    return query_spec


def _cmd_observe(workspace, args):
    """Run PT for every required scenario and compose the `observation-set` from what this call itself produced.

    G6/G19: `sourceRefs` is no longer an argv-bound Site/Workshop document
    (there is no static file that could know this campaign's own working
    design-state id or the workspace-relative report paths this same call
    is about to create) -- `designStateId` comes from `state/working-state.json`
    and every scenario's report paths come straight from the PT task this
    call just ran, never a second, separately-authored copy of the same
    paths. Serves both the "observe-baseline" and "observe-query" graph
    roles identically. `maxPaths` (G11's Strategy knob, `--max-paths`)
    arrives as a plain argv value, merged into `query_spec` here rather than
    baked into a Workshop/Site-authored `query_spec` file.

    Task 12c item 3 (observe inputs are not model-authored): the per-scenario
    PT inputs (design, netlist, SDC, SPEF per corner) are no longer read from
    a `scenario_inputs`/`observe-scenario-inputs.json` file the diagnose-and-
    observe Workshop wrote itself -- that file let the model point PT at an
    arbitrary path with no admission at all. This call now builds every
    scenario's inputs itself, from `state/working-state.json`'s own recorded
    files (`_scenario_pt_inputs`, re-verified by sha256) plus the *Site-fixed*
    scenarios contract (C4, final review: `analysisContract/scenarios.json`,
    `_load_scenarios_contract` -- was `scenario-corners.json`, a bare corner
    map with no library identity at all; the model never writes it, and it
    is already available before `observe-baseline` runs, unlike `state/
    policy.json`, which this call cannot use for the corner map since
    `policy` itself runs immediately *after* `observe-baseline` in
    `graph.yml`). The model's own observation request (`query_spec`) only
    ever chose *what* to query (precision, required scenarios, path
    breadth); it never supplied a file path.

    G19: before overwriting the declared `state/observation.json`, the
    *previous* current observation (if any) is preserved verbatim at
    `state/observation-prev.json`, and this call's own new observation is
    also stored, immutably, at `observations/<id>.json`.

    Fix round 1 (item 5): the argv `maxPaths` value is the Strategy's own
    upper *cap*, not a value to blindly overwrite the request with. When
    `query_spec` (the Workshop/Site-authored request) already names its own
    `maxPaths` and it is `<= cap`, that request value is used verbatim; when
    it is greater than the cap, it is clamped down to the cap; when the
    request names none at all, the cap itself is used. Either way the
    effective value actually used is what is compiled into the PT task
    (`state.capture`'s own completeness check is keyed off it); the clamp
    decision itself (`cap`, `requested`, `used`, `clamped`) is recorded as a
    non-declared side file, `research/observe/max-paths.json`, since
    `atcs.state.capture`'s own `observation-set` shape has no field for it.
    """
    query_spec_path, site_profile_path, scenarios_path, max_paths_raw = args
    query_spec = dict(_read_plain(query_spec_path))
    site_profile = _read_plain(site_profile_path)
    scenarios_contract = _load_scenarios_contract(scenarios_path)
    required_scenarios = _required_scenarios_for_contract(query_spec, scenarios_contract)
    workspace = Path(workspace)
    query_spec = _apply_max_paths_cap(query_spec, max_paths_raw, workspace / "research" / "observe" / "max-paths.json")
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")

    # I12 (final review): a fresh, write-once generation directory every call -- a
    # second observe (a follow-up query, or the next Campaign round) must never
    # silently overwrite a previous generation's own raw PT reports at a shared
    # scenario-named path.
    report_root = _next_evidence_generation_dir(workspace / "research" / "observe")
    xtop_site_context = adapters.compile_xtop_site_context(site_profile, required_scenarios)
    library_tcl_path = report_root / "xtop-library.tcl"
    sta_data_path = report_root / "sta_data"
    if xtop_site_context is not None:
        library_tcl_path.parent.mkdir(parents=True, exist_ok=True)
        library_tcl_path.write_text(xtop_site_context["libraryTcl"], encoding="utf-8")
    scenario_inputs = {
        scenario: _scenario_pt_inputs(workspace, working_state, scenarios_contract, scenario)
        for scenario in required_scenarios
    }
    if xtop_site_context is not None:
        for inputs in scenario_inputs.values():
            inputs["staData"] = str(sta_data_path)
    tasks = adapters.compile_pt_scenario_tasks(query_spec, scenario_inputs, str(report_root))
    scenario_source_refs = {}
    for scenario, task in tasks.items():
        scenario_dir = report_root / scenario
        tcl_path = scenario_dir / "pt-scenario.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(task["tcl"], encoding="utf-8")
        log_path = scenario_dir / "pt.log"
        adapters.run_tool(site_profile, task["command"] + [str(tcl_path)], cwd=scenario_dir, log_path=log_path)
        for name, report_path in task["reports"].items():
            if not Path(report_path).is_file():
                raise adapters.AdapterToolError(f"expected PT report missing: {report_path}", log_path)
        scenario_source_refs[scenario] = {
            "globalTiming": task["reports"]["global_timing.rpt"], "setupPaths": task["reports"]["setup.rpt"],
            "holdPaths": task["reports"]["hold.rpt"], "checkTiming": task["reports"]["check_timing.rpt"],
        }

    if xtop_site_context is not None:
        missing_timing = [
            scenario for scenario in required_scenarios
            if not any(sta_data_path.glob(f"{scenario}_data_finish*"))
        ]
        if missing_timing:
            raise core.AtcsError(
                "missing-input", f"PrimeTime produced no XTop timing-data finish file for {missing_timing}",
            )
        context_body = {
            "designStateId": working_state["id"],
            "requiredScenarios": list(required_scenarios),
            "libraryTcl": {
                "path": _relpath(library_tcl_path, workspace), "sha256": core.file_sha256(library_tcl_path),
            },
            "staData": {"path": _relpath(sta_data_path, workspace), "digest": core.tree_digest(sta_data_path)},
            "libraryFiles": xtop_site_context["libraryFiles"],
            "siteMap": xtop_site_context["siteMap"],
            "removableFillers": xtop_site_context["removableFillers"],
            "ecoParameters": xtop_site_context["ecoParameters"],
        }
        _canonical_write(_paths(workspace)["xtop_context"], core.stamp("xtop-context", context_body))

    source_refs = {"designStateId": working_state["id"], "scenarios": scenario_source_refs}
    body = state.capture(source_refs, query_spec)

    observation_path = _paths(workspace)["observation"]
    if observation_path.is_file():
        _canonical_write(_paths(workspace)["observation_prev"], _read_plain(observation_path))
    _canonical_write(workspace / "observations" / f"{body['id']}.json", body)
    return observation_path, body


def _cmd_risk(workspace, args):
    """Compare the previous observation against the current one (G19).

    `prior_path` is expected to be `state/observation-prev.json` -- a fixed
    literal path `observe` only ever writes *after* a first observation
    already exists (see `_cmd_observe`). On this campaign's very first
    observation there is nothing to compare against yet; per this task's
    brief, that first call compares `current` against itself (documented
    here, not a missing-input refusal) rather than requiring a predecessor
    that cannot yet exist.
    """
    prior_path, current_path, recheck_path = args
    current = _read_declared(current_path, "observation-set")
    prior = _read_declared(prior_path, "observation-set") if Path(prior_path).is_file() else current
    recheck = _read_plain(recheck_path)
    body = state.compare_checks(prior, current, recheck)
    return _paths(workspace)["risk"], body


def _cmd_prepare_workers(workspace, args):
    """Every slot's raw candidate comes from `candidate.workPackages` of the ONE admitted
    campaign-plan envelope -- the exact field the `campaign-plan` Reader itself counts
    (Task 12c item 4a; Fix round 1 item 1, Critical).

    Previously this read three separate, unadmitted
    `research/requests/work-package-w0N.json` files -- no `readers/*.yml`
    entry ever validated them, so their content could silently diverge from
    `research/requests/campaign-plan.json`, the file the plan Workshop's
    `campaignPlan` output actually admits via the Reader (`tc_request_
    invalid_count`). A first fix round then had this call read a *different*
    field of that same file (a top-level `workPackages` key) than the one the
    Reader actually validates (`candidate.workPackages`, per
    `tools/read-atcs.py`'s `_read_campaign_plan` envelope) -- reintroducing
    the exact same "two copies, nothing enforces they match" problem one
    level in, since nothing required the top-level copy to equal the
    `candidate` one. Controller decision: **one copy**. This call now reads
    `candidate.workPackages` -- the SAME field the Reader counted -- and
    refuses outright (`AtcsError("ambiguous-plan", ...)`, exit 3) when a
    top-level `workPackages` key is present at all, regardless of whether
    its content happens to agree with `candidate.workPackages`: a second
    copy is a hazard the moment it exists, not only once it disagrees.

    "Verifies the same bytes the Reader admitted": this Harness's Reader
    contract has no channel to pass a recorded digest forward to a Tool (a
    Reader's own `OUT` only ever carries typed numeric values, never a
    hash) -- and since `read-campaign-plan` and `prepare-workers` both read
    the *same* fixed campaign-plan path, in the *same* field
    (`candidate.workPackages`), with no rewriting node in between
    (`graph.yml`), "the envelope the graph admits is the file itself": by
    construction there is only ever one copy of these bytes, read from the
    one field the Reader itself validated, for this call to read. Any
    content that would flip the Reader's own `tc_request_invalid_count`
    away from zero also makes `workspaces.validate_work_package` refuse
    here, since both call the identical validation function on the
    identical field of the identical bytes.
    """
    base_state_path, site_caps_path, eda_profile_path, campaign_plan_path = args
    base_state = _read_declared(base_state_path, "design-state")
    site_capabilities = _read_plain(site_caps_path)
    eda_profile = _read_plain(eda_profile_path)
    for key in ("design", "techLef", "cellLefGlob"):
        if not eda_profile.get(key):
            raise InputError("invalid-input", f"eda profile is missing {key!r}")

    envelope = _read_plain(campaign_plan_path)
    if not isinstance(envelope, dict):
        raise InputError("invalid-input", f"campaign plan at {campaign_plan_path} must be a JSON object")
    if "workPackages" in envelope:
        raise core.AtcsError(
            "ambiguous-plan",
            f"campaign plan at {campaign_plan_path} carries a top-level workPackages key as well as "
            "candidate.workPackages -- there must be exactly one copy (candidate.workPackages, the "
            "field the campaign-plan Reader itself validates)",
        )
    candidate = envelope.get("candidate")
    if not isinstance(candidate, dict):
        raise InputError("invalid-input", f"campaign plan at {campaign_plan_path} is missing candidate")
    work_packages = candidate.get("workPackages")
    if not isinstance(work_packages, dict):
        raise InputError("invalid-input", f"campaign plan candidate at {campaign_plan_path} is missing workPackages")

    workspace = Path(workspace)
    netlist_path = workspace / base_state["netlist"]["path"]
    def_path = None
    if base_state.get("def"):
        def_path = workspace / base_state["def"]["path"]
    xtop_context = _verified_xtop_context(workspace, base_state["id"], eda_profile)

    common_path = workspace / "state/common-stage.json"
    if common_path.is_file():
        common = _read_plain(common_path)
        base_state = {**base_state, "xtopSeed": {"stateId": common["stateId"],
            "worklistId": common["worklistId"], **common["seed"]}}
    index = {}
    for slot in workspaces.TASK_IDS:
        raw = work_packages.get(slot)
        if not isinstance(raw, dict):
            raise InputError("invalid-input", f"campaign plan workPackages is missing slot {slot!r}")
        validated = workspaces.validate_work_package(raw, base_state, site_capabilities)
        manifest = workspaces.prepare(validated, str(workspace), base_state)
        # Issue #64 Task 5 fix round 1: `prepare` reuses the root of an identical package, so an
        # earlier generation's `operate-parked` receipt is removed here; this preparation's own
        # operate node decides afresh whether the slot runs a session.
        stale_receipt = workspace / manifest["root"] / "parked.json"
        if stale_receipt.is_file() or stale_receipt.is_symlink():
            stale_receipt.unlink()
        if workspaces.is_parked(validated):
            # Issue #64 Task 5: a parked slot's branch still runs, as a no-op. It gets its private
            # workspace (so its parked Contribution is bound to this revision) but no XTop session:
            # `operate-parked` settles its operate node and `capture-contribution` seals a parked no-fix.
            index[slot] = {
                "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
                "namePrefix": manifest["namePrefix"], "parked": True,
                "workPackage": validated, "workspaceManifest": manifest,
            }
            continue

        # `manifest["root"]` is workspace-relative (`atcs.workspaces.prepare`'s own
        # convention: "workspaces/<taskId>/r<rev>/"); join it against `workspace`
        # before writing anything, or this dispatcher's own subprocess cwd (never
        # guaranteed to be the campaign workspace) silently decides where these
        # session files land instead (pre-existing Task 12 bug, fixed here).
        session_dir = workspace / manifest["root"]
        ops_log_path = session_dir / "ops.jsonl"
        operator_task = adapters.compile_xtop_operator_task(
            manifest, eda_profile["design"], eda_profile["techLef"], eda_profile["cellLefGlob"],
            str(netlist_path), str(def_path) if def_path else "", str(session_dir), xtop_context,
        )
        operator_tcl_path = Path(operator_task["tclPath"])
        operator_tcl_path.parent.mkdir(parents=True, exist_ok=True)
        operator_tcl_path.write_text(operator_task["tcl"], encoding="utf-8")

        # #66 D2: the session derives its blockers' local topology in-session (nets and their
        # drivers and loads, one hop, nets above workspaces.LOCAL_FANOUT_MAX leaf pins left out) and
        # records it in domain.json; a plan that gives no region gets one box per plan instance from
        # the base DEF. The admitted package itself is unchanged (the worker request binds to it).
        session_domain = dict(validated.get("editDomain") or {})
        derived_regions = []
        if not session_domain.get("regions") and def_path is not None and def_path.is_file():
            derived_regions = adapters.def_instance_regions(def_path, list(session_domain.get("instances") or []))
            session_domain["regions"] = derived_regions
        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, session_domain, operator_tcl_path, ops_log_path,
            target_pins=validated.get("targetPins"), max_mutations=validated["scope"]["maxMutations"],
            observe=validated.get("observe"), local_topology=True, fanout_max=workspaces.LOCAL_FANOUT_MAX,
        )
        analysis_tcl_path = session_dir / "xtop-analysis-manual.tcl"
        analysis_tcl_path.write_text(analysis_task["tcl"], encoding="utf-8")

        index[slot] = {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "sessionTcl": str(analysis_tcl_path), "opsLog": str(ops_log_path),
            "sessionTclSha256": core.file_sha256(analysis_tcl_path),
            "derivedRegions": derived_regions, "localTopology": True, "localFanoutMax": workspaces.LOCAL_FANOUT_MAX,
            # G2: the full stamped artifacts, not just their ids -- `capture-contribution
            # <slot>` composes `base_ref` from these directly, so it needs no argv path
            # of its own beyond the slot name.
            "workPackage": validated, "workspaceManifest": manifest,
        }
    # Issue #64 Task 5: every slot runs as its own fork branch, so `collect` waits for all six; a
    # parked slot contributes its parked no-fix.
    return _paths(workspace)["workers"], {"workers": index, "requiredSlots": list(workspaces.TASK_IDS)}


def _cmd_worker_slots(workspace, args):
    """Bind the Run's `workerSlots` Strategy knob for this generation's campaign plan (Issue #64 Task 5).

    `bind-worker-slots` runs on every way into the plan Workshop, so the campaign-plan
    Reader reads the knob the Run holds now: slots w01..w0<n> may be active and every
    slot above <n> must be parked. The value is an integer from 0 to 6; 0 parks every seat,
    the qualified full-auto control arm (#66 D8): every branch runs its batch no-op and the
    batch runs the auto-finish alone.
    """
    (raw,) = args
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]+", raw.strip()):
        raise InputError("invalid-input", f"workerSlots must be an integer from 0 to {len(workspaces.TASK_IDS)}, got {raw!r}")
    count = int(raw.strip())
    if not 0 <= count <= len(workspaces.TASK_IDS):
        raise InputError("invalid-input", f"workerSlots must be an integer from 0 to {len(workspaces.TASK_IDS)}, got {count}")
    body = {
        "workerSlots": count,
        "activeSlots": list(workspaces.TASK_IDS[:count]),
        "parkedSlots": list(workspaces.TASK_IDS[count:]),
    }
    return _paths(workspace)["worker_slots"], core.stamp("worker-slots", body)


def _parked_entry(workspace, slot):
    """`state/workers.json[slot]` for a slot argument; `(entry, parked)`."""
    if slot not in workspaces.TASK_IDS:
        raise InputError("invalid-input", f"slot must be one of {workspaces.TASK_IDS}, got {slot!r}")
    workers_doc = _read_plain(_paths(workspace)["workers"])
    entry = workers_doc.get("workers", {}).get(slot)
    if not entry:
        raise InputError("missing-input", f"state/workers.json has no entry for slot {slot!r}")
    return entry, workspaces.prepared_slot_parked(entry)


def _worker_request_problem_count(workspace, slot, entry):
    """How many problems slot `slot`'s current worker request has, by the flow-side half of the Reader's rule.

    `workspaces.request_invalid_count` against the working state, a `taskId` other than
    the slot, and every `workspaces.PREPARED_BINDING_FIELDS` field that differs from the
    package `prepare-workers` prepared; an envelope with no candidate object is one problem.
    An absent or unreadable request, or working state, refuses (exit 2/3) instead: the
    owner never skips a slot whose request could not be read.
    It never admits what the worker-request Reader refused: the Reader also resolves the
    names against the base netlist and refuses the read outright on a miss.
    """
    path = Path(workspace) / "research" / "requests" / f"worker-request-{slot}.json"
    # Unreadable inputs refuse (InputError/AtcsError propagate): only a request that parses
    # and then fails validation is skipped.
    envelope = _read_plain(path)
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    if not isinstance(envelope, dict) or not isinstance(envelope.get("candidate"), dict):
        return 1
    candidate = envelope["candidate"]
    site_capabilities = envelope.get("siteCapabilities")
    count = workspaces.request_invalid_count(candidate, working_state,
                                             site_capabilities if isinstance(site_capabilities, dict) else {})
    if candidate.get("taskId") != slot:
        count += 1
    prepared, requested = workspaces.bound_view(entry.get("workPackage")), workspaces.bound_view(candidate)
    return count + sum(1 for field in workspaces.PREPARED_BINDING_FIELDS if prepared[field] != requested[field])


def _reader_refusal(workspace, slot):
    """The worker-request Reader's own current refusal of slot `slot`'s request, or ``None``.

    The Reader writes ``<request>.problems.txt`` beside the request on every read: its first line
    counts the problems (``N problem(s) in ...``, ``0 problems in ...`` when it admits the request,
    ``... was refused before ...``). Some problems are Reader-only (#64 T06 w06: ``operatorBrief``
    missing), so the flow-side count can call a request admissible that the Reader refused. A
    sidecar older than the request is a verdict on earlier bytes and is ignored.
    """
    request = Path(workspace) / "research" / "requests" / f"worker-request-{slot}.json"
    sidecar = request.with_name(f"worker-request-{slot}.problems.txt")
    try:
        if sidecar.stat().st_mtime < request.stat().st_mtime:
            return None
        text = sidecar.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return None
    match = re.match(r"^(\d+) problems? in ", lines[0])
    if match and int(match.group(1)) > 0:
        problems = [line[2:] for line in lines[1:] if line.startswith("- ")][:int(match.group(1))]
        return f"the Reader refused its worker request: {'; '.join(problems) or lines[0]}"
    if " was refused before its problems could be counted" in lines[0]:
        return f"the Reader refused its worker request: {lines[0]}"
    return None


def _cmd_operate_parked(workspace, args):
    """The operate node of a slot that runs no session (Issue #64 Task 5): the xtop-operator batch path.

    An active slot's operate node is its worker Team Operator's interactive XTop session.
    This batch path opens no XTop session and writes only a stamped receipt,
    `<slot root>/parked.json`, so the branch stays a pure act chain and its capture seals
    a parked no-fix. It admits two slots: one `prepare-workers` parked (`why: parked`), and
    an active slot whose worker request is inadmissible (`why: inadmissible-request`, the
    branch holds no Judge to stop it, so the owner skips it here) by the flow-side count or by
    the Reader's own current verdict (`_reader_refusal`, #64 T06 w06). Any other active slot is
    refused (`slot-active`, exit 3): this path never stands in for an expert session.
    """
    (slot,) = args
    if slot == "lead":
        brief = _read_plain(Path(workspace) / "state/lead-brief.json")
        if brief.get("control") is not True:
            raise core.AtcsError("interactive-required", "Timing Lead must use one retained Operator session")
        return Path(workspace) / "state/lead-operated.json", {"control": True, "session": False}
    workspace = Path(workspace)
    entry, parked = _parked_entry(workspace, slot)
    if parked:
        why, reason = "parked", entry["workPackage"]["problem"]
    else:
        problems = _worker_request_problem_count(workspace, slot, entry)
        refused = _reader_refusal(workspace, slot) if problems == 0 else None
        if problems == 0 and refused is not None:
            # D-T06-1(a): the branch settles as an honest no-fix instead of refusing `slot-active`.
            body = {
                "taskId": slot, "workPackageId": entry["workPackageId"],
                "revision": entry["workspaceManifest"]["revision"], "why": "inadmissible-request",
                "reason": f"slot {slot} was skipped: {refused}, so no session ran",
            }
            return workspace / entry["root"] / "parked.json", core.stamp("parked-operate", body)
        if problems == 0:
            raise core.AtcsError(
                "slot-active",
                f"slot {slot!r} is active and its worker request is admissible: its operate node runs only as "
                "the worker Team Operator's interactive XTop session",
            )
        why = "inadmissible-request"
        reason = f"slot {slot} was skipped: its worker request has {problems} problem(s), so no session ran"
    body = {
        "taskId": slot, "workPackageId": entry["workPackageId"],
        "revision": entry["workspaceManifest"]["revision"], "why": why, "reason": reason,
    }
    return workspace / entry["root"] / "parked.json", core.stamp("parked-operate", body)


_NO_FIX_ADAPTER_ERROR_MARKER = "HIMA-ADAPTER-ERROR"
_NO_FIX_ADAPTER_ERROR_MAX_LINES = 5
_NO_FIX_ADAPTER_ERROR_MAX_CHARS = 300


def _no_fix_diagnosis(root, dump_sha256):
    """Deterministic evidence for an honest no-fix Contribution (Issue 63) -- never
    model prose. States the sha256 that was actually checked (before.dump and
    after.dump are byte-identical, so either one's digest names the same
    bytes), plus, when the slot root holds an XTop transcript
    (``xtop_log_*.txt``) naming a `HIMA-ADAPTER-ERROR`, the first few such
    lines verbatim (bounded: <= `_NO_FIX_ADAPTER_ERROR_MAX_LINES` lines, each
    truncated to `_NO_FIX_ADAPTER_ERROR_MAX_CHARS` chars; tool `Error...` lines too, never the
    echoed `xtop > ` command wrappers) -- the closest thing
    to "why" a fail-closed diagnosis is allowed to assert.
    """
    parts = [
        f"Operator session produced no design change: before/after dumps identical "
        f"(sha256 {dump_sha256}); ops trace empty"
    ]
    error_lines = []
    for log_path in sorted(root.glob("xtop_log_*.txt")):
        try:
            text = log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            # The transcript echoes every adapter-wrapped command after an `xtop > ` prompt, and each
            # wrapper contains the marker text; only the tool's own output lines are evidence.
            line = line.strip()
            if line.startswith(_NO_FIX_ADAPTER_ERROR_MARKER) or line.startswith("Error"):
                error_lines.append(line[:_NO_FIX_ADAPTER_ERROR_MAX_CHARS])
                if len(error_lines) >= _NO_FIX_ADAPTER_ERROR_MAX_LINES:
                    break
        if len(error_lines) >= _NO_FIX_ADAPTER_ERROR_MAX_LINES:
            break
    if error_lines:
        parts.append("XTop transcript errors: " + " | ".join(error_lines))
    return "; ".join(parts)


_TAINT_MARKER = "ATCS:taint:"


def _transcript_taint(root):
    """The slot's taint state from every ``ATCS:taint:<state>`` line in every XTop transcript.

    ``atcs_close`` prints ``ATCS:taint:clean`` or ``ATCS:taint:tainted:<reason>``;
    echoed ``xtop > `` command lines never start with the marker. Returns
    ``None`` when no transcript holds such a line, ``"clean"`` only when every
    such line says ``clean``, and otherwise the first non-clean state found
    (in sorted transcript order; any non-clean line refuses, so the order
    only picks which reason is quoted). An unreadable transcript is a
    non-clean state.
    """
    states = []
    for log_path in sorted(root.glob("xtop_log_*.txt")):
        try:
            text = log_path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            states.append(f"unreadable transcript {log_path.name}: {exc}")
            continue
        for line in text.splitlines():
            line = line.strip()
            if line.startswith(_TAINT_MARKER):
                states.append(line[len(_TAINT_MARKER):])
    if not states:
        return None
    return next((state for state in states if state != "clean"), "clean")


def _seal_xtop_session(workspace, root, base_ref, before_dump, after_dump, ops_log_path, operation_trace,
                       tainted_path):
    """Issue #64 Task 4: seal a Task 3 expert session (`contributions.seal_session`).

    Reads, beside ``ops.jsonl``: ``gain.jsonl`` (absent = no readings) and
    ``tainted.json`` (any content, even unreadable, taints); in the slot
    root: the XTop transcripts' ``ATCS:taint:`` line and ``eco_output/``
    (at least one file). The Site's removable-filler master patterns and
    the required scenarios whose rows the gain gates read come from the
    bound ``state/xtop-context.json`` (``removableFillers``,
    ``requiredScenarios``; none when that file is absent, so every filler
    change then counts as an out-of-domain change and every scenario row
    is read).

    #66 D4: also beside ``ops.jsonl``, ``reads.jsonl`` (the read log; absent = none) and
    ``domain.json`` (the session's effective domain; absent = the plan's), and from
    ``summary.json`` the Operator's ``limitations`` (a list of strings), all sealed into the batch
    record (`contributions.seal_session`).
    """
    gain_path = ops_log_path.parent / "gain.jsonl"
    gain_text = _read_text(str(gain_path)) if gain_path.is_file() else ""
    reads_path = ops_log_path.parent / "reads.jsonl"
    reads_text = _read_text(str(reads_path)) if reads_path.is_file() else None
    domain_path = ops_log_path.parent / "domain.json"
    domain_text = _read_text(str(domain_path)) if domain_path.is_file() else None
    tainted = None
    if tainted_path.is_file():
        try:
            tainted = json.loads(tainted_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            tainted = {"reason": f"unreadable tainted.json: {exc}"}
        if tainted is None:
            tainted = {"reason": "tainted.json holds null"}
    eco_output = root / "eco_output"
    filler_patterns, required_scenarios = [], []
    context_path = _paths(workspace)["xtop_context"]
    if context_path.is_file():
        context = _read_declared(context_path, "xtop-context")
        filler_patterns = list(context.get("removableFillers") or [])
        required_scenarios = list(context.get("requiredScenarios") or [])
    summary = _read_json_or_default(root / "summary.json", {})
    result_refs = {
        "beforeDump": str(before_dump), "afterDump": str(after_dump),
        "evidence": {
            "taintedJson": tainted, "transcriptTaint": _transcript_taint(root),
            "ecoOutput": eco_output.is_dir() and any(path.is_file() for path in eco_output.rglob("*")),
        },
        "fillerPatterns": filler_patterns, "requiredScenarios": required_scenarios,
        "diagnosis": summary.get("diagnosis"), "domainText": domain_text,
        "operatorLimitations": summary.get("limitations"),
    }
    return contributions.seal_session(base_ref, result_refs, operation_trace, gain_text, reads_text)


_PARKED_FORBIDDEN_OUTPUTS = ("before.dump", "after.dump", "ops.jsonl", "gain.jsonl", "tainted.json", "eco_output",
                             "summary.json")


def _cmd_capture_contribution(workspace, args):
    """Compose `base_ref`/`result_refs` from `state/workers.json` and the slot's own workspace (G2).

    `<slot>` is the only argv arg beyond `<workspace>` -- no
    `research/requests/capture-*` files exist any more. `base_ref` comes
    straight from `state/workers.json[slot]`'s own `workspaceManifest`/
    `workPackage` (full stamped artifacts, per `_cmd_prepare_workers`'s own
    change). `result_refs` is composed from the Operator's outputs inside
    the slot's own workspace root (`state/workers.json[slot]["root"]`):

    - ``before.dump`` / ``after.dump`` -- cell dumps the Operator must write
      (via the session's own ``atcs_dump_cells`` typed procedure, already
      defined by ``xtop-operator.tcl``) immediately before and after its
      edits, at exactly these two fixed names. Both are always required.
    - ``ops.jsonl`` -- the same typed-procedure trace path already recorded
      as `state/workers.json[slot]["opsLog"]`. Issue 63: a real Operator
      session that made no mutation never writes this file at all
      (``xtop-operator.tcl``'s ``atcs_log_op`` only appends on a successful
      mutation) -- so an ABSENT ops.jsonl is treated exactly like a
      PRESENT-BUT-EMPTY one, and only when `before.dump`/`after.dump` are
      byte-identical (proof no design change actually happened): this
      composes an honest `no-fix` Contribution with a deterministic
      diagnosis (`_no_fix_diagnosis`) instead of refusing outright. When the
      dumps differ instead, an absent/empty ops.jsonl still refuses
      (`missing-input`) exactly as before -- a real change with no recorded
      trace is not a no-fix, it is untrusted.
    - ``summary.json`` (optional) -- ``{"xtopSetupWns", "xtopHoldWns",
      "diagnosis", "cones", "dependencies"}``, all optional; a numeric
      ``xtopSetupWns``/``xtopHoldWns`` becomes a known Measure, anything
      absent stays `unknown` (`contributions._predicted_measures`'s own
      default). ``diagnosis`` is required content (not a file name) for a
      `no-fix` slot -- `contributions.seal` refuses one without it. An
      explicit `summary.json` diagnosis always wins over the deterministic
      one computed here.

    Issue #64 Task 4: when ``ops.jsonl`` holds Task 3 toolkit lines (or
    ``tainted.json`` exists beside it), the slot is sealed by
    `_seal_xtop_session` / `contributions.seal_session` as an
    ``xtop-session`` (or session ``no-fix``) Contribution instead; the
    legacy typed-procedure trace and the empty/absent-trace no-fix path
    below are unchanged.

    Issue #64 Task 5: a slot that ran no session -- parked by the plan, or
    skipped by `operate-parked` (its `<root>/parked.json` receipt) -- seals a
    `parked` no-fix (`contributions.seal_parked`) and reads no dump; any
    Operator output in its root refuses (`parked-slot-ran`, exit 3).

    Both dumps missing, or one dump missing, is `missing-input` (exit 2) as
    before, matching "no subcommand reads files that no subcommand writes":
    every one of them is written by the Operator session `prepare-workers`
    itself set up for this exact slot and root.
    """
    (slot,) = args
    if slot not in workspaces.OPERATOR_SLOTS:
        raise InputError("invalid-input", f"slot must be one of {workspaces.TASK_IDS}, got {slot!r}")
    workspace = Path(workspace)
    workers_doc = _read_plain(_paths(workspace)["workers"])
    entry = workers_doc.get("workers", {}).get(slot)
    if not entry:
        raise InputError("missing-input", f"state/workers.json has no entry for slot {slot!r}")
    workspace_manifest = entry.get("workspaceManifest")
    work_package = entry.get("workPackage")
    if not workspace_manifest or not work_package:
        raise InputError(
            "invalid-input", f"state/workers.json entry for slot {slot!r} is missing workspaceManifest/workPackage"
        )
    base_ref = {
        "stateId": workspace_manifest.get("baseStateId"),
        "workspaceManifest": workspace_manifest,
        "workPackage": work_package,
    }

    root = Path(entry["root"])
    if not root.is_absolute():
        root = workspace / root
    receipt_path = root / "parked.json"
    plan_parked = workspaces.prepared_slot_parked(entry)
    if plan_parked or receipt_path.exists():
        # Issue #64 Task 5: this slot ran no session -- the plan parked it, or `operate-parked`
        # skipped its inadmissible request. Any Operator output in its root means something did
        # run there, and that is refused rather than sealed as a no-fix.
        ran = sorted(name for name in _PARKED_FORBIDDEN_OUTPUTS if (root / name).exists())
        ran += sorted(path.name for path in root.glob("xtop_log_*.txt"))
        if ran:
            raise core.AtcsError("parked-slot-ran", f"slot {slot!r} ran no session but holds Operator outputs {ran}")
        refusal = None
        if plan_parked:
            reason = work_package.get("problem")
        else:
            receipt = _read_declared(receipt_path, "parked-operate")
            if (receipt.get("taskId") != slot or receipt.get("workPackageId") != entry.get("workPackageId")
                    or receipt.get("revision") != workspace_manifest.get("revision")):
                raise core.AtcsError("stale-receipt", f"{receipt_path} belongs to another preparation of slot {slot!r}")
            reason = receipt.get("reason")
            # Visible at the join: the skipped active slot's result carries this refusal, so its
            # branch's `worker-result-admissible` verdict FAILs (both outcomes still collect).
            refusal = {"code": "inadmissible-request", "detail": reason}
        body = contributions.seal_parked(base_ref, reason, refusal=refusal)
        _canonical_write(workspace / "contributions" / f"{body['id']}.json", body)
        if workspace_manifest.get("xtopSeed"):
            body = core.stamp("contribution", {**{k: v for k, v in body.items() if k not in ("schema", "id")},
                "xtopSeed": workspace_manifest["xtopSeed"]})
            _canonical_write(workspace / "contributions" / f"{body['id']}.json", body)
        return _contribution_path(workspace, slot), body
    ops_log_path = Path(entry["opsLog"])
    if not ops_log_path.is_absolute():
        ops_log_path = workspace / ops_log_path
    before_dump = root / "before.dump"
    after_dump = root / "after.dump"
    for required_path, label in ((before_dump, "before.dump"), (after_dump, "after.dump")):
        if not required_path.is_file():
            raise InputError("missing-input", f"Operator output not found for slot {slot!r}: {label} at {required_path}")

    if workspace_manifest.get("xtopSeed"):
        common = _read_plain(workspace / "state/common-stage.json")
        if core.digest(contributions.parse_cell_dump(before_dump.read_text())) != common.get("cellStateDigest"):
            raise core.AtcsError("identity-mismatch", "session before.dump is not the prepared common R1")
    ops_log_exists = ops_log_path.is_file()
    operation_trace = _read_text(str(ops_log_path)) if ops_log_exists else ""
    tainted_path = ops_log_path.parent / "tainted.json"
    if contributions.is_session_log(operation_trace) or tainted_path.is_file():
        body = _seal_xtop_session(workspace, root, base_ref, before_dump, after_dump, ops_log_path,
                                  operation_trace, tainted_path)
        _canonical_write(workspace / "contributions" / f"{body['id']}.json", body)
        if workspace_manifest.get("xtopSeed"):
            body = core.stamp("contribution", {**{k: v for k, v in body.items() if k not in ("schema", "id")},
                "xtopSeed": workspace_manifest["xtopSeed"]})
            _canonical_write(workspace / "contributions" / f"{body['id']}.json", body)
        return _contribution_path(workspace, slot), body
    ops_trace_empty = not operation_trace.strip()
    no_fix_evidence = (not ops_log_exists) or ops_trace_empty
    dump_sha256 = None
    if no_fix_evidence:
        before_sha256 = core.file_sha256(before_dump)
        after_sha256 = core.file_sha256(after_dump)
        if before_sha256 != after_sha256:
            # A real change happened but left no trace -- still refuse, exactly as
            # for the pre-existing "ops.jsonl missing" case.
            raise InputError(
                "missing-input", f"Operator output not found for slot {slot!r}: ops.jsonl at {ops_log_path}"
            )
        dump_sha256 = before_sha256

    summary = _read_json_or_default(root / "summary.json", {})
    predicted = {}
    for key in ("xtopSetupWns", "xtopHoldWns"):
        value = summary.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            predicted[key] = core.known(value)

    diagnosis = summary.get("diagnosis")
    if no_fix_evidence and not (isinstance(diagnosis, str) and diagnosis.strip()):
        diagnosis = _no_fix_diagnosis(root, dump_sha256)

    result_refs = {
        "beforeDump": str(before_dump), "afterDump": str(after_dump), "script": None,
        "predicted": predicted, "diagnosis": diagnosis,
        "cones": summary.get("cones", []), "dependencies": summary.get("dependencies", []),
    }
    body = contributions.seal(base_ref, result_refs, operation_trace)
    if workspace_manifest.get("xtopSeed"):
        body = core.stamp("contribution", {**{k: v for k, v in body.items() if k not in ("schema", "id")},
            "xtopSeed": workspace_manifest["xtopSeed"]})
    _canonical_write(workspace / "contributions" / f"{body['id']}.json", body)
    return _contribution_path(workspace, slot), body


def _cmd_collect(workspace, args):
    """Aggregate whichever worker slots sealed a contribution for the CURRENT `state/workers.json` revision.

    Output matches `tools/read-atcs.py`'s `contribution-index` read envelope
    exactly: ``{"contributions": [<full contribution artifact>, ...],
    "pending": [{"slot": <slot>, "reason": <str>}, ...]}``. A slot with no
    `state/contribution-<slot>.json` yet is not a missing-input refusal here
    -- it is meaningful data (that worker's research is still in progress),
    reported in `pending` for `tc_pending_research_count` rather than
    blocking `collect` outright.

    Task 12c item 6 (no resurrected contributions): a slot's sealed
    contribution is only ever collected when its own `revision` (set by
    `contributions.seal` from the workspace-manifest it was sealed against)
    still matches `state/workers.json[slot]["workspaceManifest"]["revision"]`
    -- the CURRENT `prepare-workers` call for that slot. A slot whose
    `state/workers.json` entry is absent (its request was never admitted
    this batch) or whose contribution's revision no longer matches the
    current one (a leftover contribution from an earlier batch/work
    package, superseded by a new `prepare-workers` revision) is reported in
    `pending` with a `reason` -- its old contribution is never silently
    re-collected into a new batch.
    """
    del args
    workspace = Path(workspace)
    workers_doc = _read_json_or_default(_paths(workspace)["workers"], {"workers": {}})
    workers = workers_doc.get("workers", {}) or {}
    required_slots = workers_doc.get("requiredSlots", list(workspaces.TASK_IDS))
    if (not isinstance(required_slots, list) or not required_slots
            or any(slot not in workspaces.TASK_IDS for slot in required_slots)
            or len(set(required_slots)) != len(required_slots)):
        raise InputError("invalid-input", "workers.requiredSlots must name unique declared slots")

    collected = []
    pending = []
    for slot in required_slots:
        path = _contribution_path(workspace, slot)
        if not path.is_file():
            pending.append({"slot": slot, "reason": "no contribution sealed yet"})
            continue
        contribution = _read_declared(path, "contribution")
        entry = workers.get(slot)
        current_revision = (entry or {}).get("workspaceManifest", {}).get("revision")
        if entry is None:
            pending.append({"slot": slot, "reason": "no state/workers.json entry for this slot"})
            continue
        if contribution.get("revision") != current_revision:
            pending.append({
                "slot": slot,
                "reason": (
                    f"stale contribution revision {contribution.get('revision')!r} does not match "
                    f"current workspace revision {current_revision!r}"
                ),
            })
            continue
        collected.append(contribution)
    return _paths(workspace)["contributions_collected"], {"contributions": collected, "pending": pending}


def _read_admitted_plan(plan_path):
    """The raw `integration-plan` candidate from the SAME envelope file the integration-plan
    Reader admits (Task 12c item 4b), or `None` when that file does not exist yet.

    Envelope shape: ``{"plan": {...unstamped integration-plan fields...},
    "facts": {...a stamped composition-facts artifact, for the Reader's own
    validation...}}`` -- the exact shape `tools/read-atcs.py`'s
    `_read_integration_plan` already expects. Only `envelope["plan"]` is
    ever used here: this dispatcher independently re-reads
    `state/composition-facts.json` as its own source of truth for `facts`
    rather than trusting the envelope's embedded copy, so a stale copy
    baked into the envelope can never substitute for the real, current
    composition facts. Replaces the old, separate, unadmitted
    `integration-plan.json` / `resolutions.json` files -- `replay-prepare`,
    `compose-facts` (second pass) and `record-experience` all consume this
    one file, in this one shape, at this one fixed path.
    """
    target = Path(plan_path)
    if not target.is_file():
        return None
    envelope = _read_plain(plan_path)
    plan_raw = envelope.get("plan") if isinstance(envelope, dict) else None
    if not isinstance(plan_raw, dict):
        raise InputError("invalid-input", f"integration plan envelope at {plan_path} is missing 'plan'")
    return plan_raw


def _is_stale_base(candidate_base_state_id, current_base_state_id):
    """True when `candidate_base_state_id` no longer names the base this Campaign is
    actually building on right now (Minor, final review: one shared definition of
    "stale base", instead of `compose-facts`'s own plan-vs-working-state comparison
    and `replay-prepare`'s own base-state-vs-facts comparison each independently
    re-writing the same `!=` check). Deliberately returns only the yes/no answer, not
    a response: `compose-facts` treats a stale plan as "no plan yet" (Task 12c item
    4c's documented first-vs-second-pass semantics -- a real design choice, not an
    oversight to unify away) while `replay-prepare` treats a stale base as a hard
    refusal (`AtcsError("stale-base", ...)`, since proceeding would replay a real
    XTop batch against evidence that no longer matches this Campaign's own current
    state) -- each call site keeps its own response, sharing only the rule itself.
    """
    return candidate_base_state_id != current_base_state_id


def _cmd_compose_facts(workspace, args):
    """`baseStateId` comes from `state/working-state.json`'s own `id`, not a literal argv id (G1).

    Task 12c item 4c: `resolutions` come from the SAME admitted
    integration-plan envelope `replay-prepare`/`record-experience` read
    (`_read_admitted_plan`), never a separate `resolutions.json`. The first
    pass -- before the compose Workshop has produced a plan FOR THE CURRENT
    batch, so no *current* plan file exists yet -- has no resolutions
    (`composition.analyze`'s own `resolutions=[]` default; `unresolvedCount`
    then counts every conflict). The second pass -- after the Workshop's
    plan has been admitted -- reads that plan's own `resolutions` and
    applies them; *this* second-pass output (a lower `unresolvedCount`) is
    what feeds `composition-ready` and `replay-prepare`.

    Fix round 2 item 4: a plan file that physically exists at this fixed
    path is not necessarily a *current* one -- nothing deletes it between
    rounds, so a completed earlier round's own admitted plan can still be
    sitting there when a later round's first pass runs. Such a plan is
    treated exactly like one that does not exist yet (`resolutions=[]`),
    rather than having its stale decisions silently re-applied to a new
    batch, whenever either of two staleness signals fires: its own
    `baseStateId` no longer matches the CURRENT `state/working-state.json`
    (the round has moved on to a new base), or its own `batchId` already
    names a batch this campaign already reconciled -- `state/replay-
    request.json`'s own `batchId`, when that file exists, is exactly that
    "already consumed" batch's id, since `replay-prepare` only ever writes
    it from `plan.batchId` (never invented independently).
    """
    (plan_path,) = args
    workspace = Path(workspace)
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    plan_raw = _read_admitted_plan(plan_path)
    if plan_raw is not None:
        if _is_stale_base(plan_raw.get("baseStateId"), working_state["id"]):
            plan_raw = None  # stale: for a base this campaign has since moved on from
        else:
            replay_request_path = _paths(workspace)["replay_request"]
            if replay_request_path.is_file():
                existing_request = _read_declared(replay_request_path, "replay-request")
                if existing_request.get("batchId") == plan_raw.get("batchId"):
                    plan_raw = None  # stale: this exact batch has already been prepared/replayed
    resolutions = (plan_raw or {}).get("resolutions") or []
    # Issue #64 Task 4: blocker coverage ranks the recipe's xtop sessions -- the worst
    # failing check per scenario and mode of the current observation, when it is this
    # working state's own (an observation of another state names no blocker here).
    observation = _read_json_or_default(_paths(workspace)["observation"], {})
    observed_state = observation.get("designStateId") if isinstance(observation, dict) else None
    endpoints = (composition.worst_check_endpoints(observation)
                 if observed_state in (None, working_state["id"]) else {})
    body = composition.analyze(working_state["id"], collected["contributions"], resolutions,
                               worst_keys=sorted(endpoints), worst_endpoints=endpoints)
    return _paths(workspace)["composition_facts"], body


def _cmd_replay_prepare(workspace, args):
    """I3 (final review, XTop replay source): `xtop-replay.tcl` builds its own fresh
    XTop workspace from the batch's own base-state LEF/netlist/DEF -- the same shape
    `prepare-workers` builds a worker session's own startup from -- never
    `open_workspace` on an Innovus `.enc` restore script (confirmed by reading the
    pre-fix template: `open_workspace` opens a previously-saved *XTop* workspace, not
    an Innovus checkpoint, so that call could never actually have opened anything
    real). `techLef`/`cellLefGlob`/`design` come from the same `siteCapabilities`
    document `edaShell` already does -- no new argv input.

    I3 (final review): a replay run that itself fails outright (the `xtop` process
    exits non-zero, or its log reports an `ERROR`/`Fatal` line) is no longer silently
    swallowed -- its detail and log path are recorded at the non-declared
    `state/replay-receipts.json` side file's own `toolFailure` field, so `reconcile`'s
    caller (and a human reviewing the workspace) can tell "the tool itself never ran
    to completion" apart from "every step it did attempt is accounted for in
    `receipts.jsonl`". `reconcile` itself is unaffected: a step with no receipt at all
    still reports as `pending`, exactly as before.
    """
    if len(args) not in (3, 4):
        raise InputError("invalid-input", "usage: replay-prepare <workspace> <baseState> <plan> <site> [autoFinish]")
    base_state_path, plan_path, site_profile_path = args[:3]
    auto_finish = _auto_finish_arg(args[3]) if len(args) == 4 else None
    workspace = Path(workspace)
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    plan_raw = _read_admitted_plan(plan_path)
    if plan_raw is None:
        raise InputError("missing-input", f"declared input not found: {plan_path}")
    site_profile = _read_plain(site_profile_path)
    base_state = _read_declared(base_state_path, "design-state")
    if _is_stale_base(base_state["id"], facts.get("baseStateId")):
        raise core.AtcsError("stale-base", "base design-state does not match facts.baseStateId")
    if _is_recipe_batch(facts, plan_raw, collected):
        return _replay_prepare_recipe(workspace, base_state, facts, collected, plan_raw, site_profile, auto_finish)

    validated_plan = integration.validate_plan(plan_raw, facts)
    request = integration.prepare_replay(validated_plan, facts, collected["contributions"])

    batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
    output_root = workspace / "integrations" / batch_id
    # I12 (final review): batch ids must be unique -- `xtop-replay.tcl` is the one
    # file only THIS call ever writes (`presta`'s own `integrations/<batchId>/presta/`
    # subtree is a separate path this check never sees), so its presence is an honest
    # "this exact batch id already replayed for real" signal, never a false positive
    # from another subcommand's own write into the same batch's directory. A Workshop-
    # authored `batchId` (`plan.batchId`, never invented by this dispatcher) has no
    # freshness guarantee of its own; replaying the same id twice would silently mix
    # one generation's raw XTop evidence into what looks like a second, distinct one.
    if _replay_already_ran(output_root):
        raise core.AtcsError(
            "batch-id-reused",
            f"integrations/{batch_id}/xtop-replay.tcl already exists -- batch ids must be unique, "
            "this Pack never replays the same batch id a second time",
        )
    for key in ("design", "techLef", "cellLefGlob"):
        if not site_profile.get(key):
            raise InputError("invalid-input", f"site capabilities is missing {key!r}")
    netlist_path = workspace / base_state["netlist"]["path"]
    def_path = workspace / base_state["def"]["path"] if base_state.get("def") else None
    xtop_context = _verified_xtop_context(workspace, base_state["id"], site_profile)
    task = adapters.compile_xtop_replay_task(
        site_profile["design"], site_profile["techLef"], site_profile["cellLefGlob"],
        str(netlist_path), str(def_path) if def_path else "", request.get("steps", []), output_root,
        xtop_context,
    )
    Path(task["stepsPath"]).parent.mkdir(parents=True, exist_ok=True)
    Path(task["stepsPath"]).write_text(task["stepsText"], encoding="utf-8")
    main_tcl_path = output_root / "xtop-replay.tcl"
    main_tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = output_root / "xtop-replay.log"
    tool_failure = None
    try:
        adapters.run_tool(site_profile, ["xtop", "-f", str(main_tcl_path)], cwd=output_root, log_path=log_path)
    except adapters.AdapterToolError as exc:
        # A failing step is recorded and the replay continues; a run that dies
        # leaves its later steps receipt-less (pending) -- `reconcile` reports
        # that, it is not a `replay-prepare` refusal in its own right. I3 (final
        # review): the failure itself is no longer swallowed -- its detail and
        # log path are recorded below, never silently discarded.
        tool_failure = {"detail": exc.detail, "log": str(exc.log_path)}
    receipts = adapters.read_replay_receipts(task["receiptsLog"])
    receipts_body = {"receipts": receipts}
    if tool_failure is not None:
        receipts_body["toolFailure"] = tool_failure
    _canonical_write(_paths(workspace)["replay_receipts"], receipts_body)
    return _paths(workspace)["replay_request"], request


def _auto_finish_arg(value):
    """The optional `autoFinish` knob argv (`1`/`0`, `true`/`false`); `None` keeps the plan's."""
    text = str(value).strip().lower()
    if text in ("1", "1.0", "true"):
        return True
    if text in ("0", "0.0", "false"):
        return False
    raise InputError("invalid-input", f"autoFinish must be 0 or 1, got {value!r}")


def _replay_already_ran(output_root):
    """Whether `integrations/<batchId>/` already holds a replay: a legacy step replay's
    `xtop-replay.tcl`, or a recipe replay's merged-arm one. Only `replay-prepare` writes either."""
    return (output_root / "xtop-replay.tcl").is_file() or (output_root / "merged" / "xtop-replay.tcl").is_file()


def _is_recipe_batch(facts, plan_raw, collected):
    """A batch replays Task 4b's ranked recipe (Issue #64 Task 6) when `composition-facts`
    carries one and the plan selects no legacy `fix` Contribution (those keep the M5 step
    replay unchanged)."""
    if not isinstance(facts.get("recipe"), dict):
        return False
    selected = set(plan_raw.get("select") or []) if isinstance(plan_raw.get("select"), list) else set()
    return not any(contribution.get("kind") == "fix" and contribution.get("id") in selected
                   for contribution in collected.get("contributions") or [])


def _recipe_sessions(workspace, recipe, collected, base_state_id):
    """`{taskId: identity}` for every ranked recipe session: the slot's name prefix
    (`state/workers.json`), its sealed Contribution (id, revision, dump delta) and the domain the
    replay enters (#66 D6). The domain is the Contribution's ``effectiveDomain`` (the worker
    session's sealed ``domain.json``: instances, nets, regions, targetPins); only a Contribution
    without one falls back to the slot's admitted work package (``editDomain``, ``targetPins``).
    ``domainSource`` names which (``effectiveDomain`` or ``workPackage``). A slot missing its
    worker entry or Contribution is left out, so `integration.prepare_recipe_replay` refuses it
    (`invalid-recipe`)."""
    workers = (_read_plain(_paths(workspace)["workers"]).get("workers") or {})
    by_id = {contribution.get("id"): contribution for contribution in collected.get("contributions") or []}
    sessions = {}
    for ranked in recipe.get("sessions") or []:
        slot = ranked.get("taskId") if isinstance(ranked, dict) else None
        contribution = by_id.get(ranked.get("contribution")) if isinstance(ranked, dict) else None
        entry = workers.get(slot) if isinstance(slot, str) else None
        if contribution is None or not isinstance(entry, dict) or contribution.get("taskId") != slot:
            continue
        if _is_stale_base(contribution.get("baseStateId"), base_state_id):
            raise core.AtcsError("stale-base", f"recipe session {slot!r} was sealed against another base")
        effective = contribution.get("effectiveDomain")
        if isinstance(effective, dict):
            source = "effectiveDomain"
            edit_domain = {key: effective.get(key) or [] for key in ("instances", "nets", "regions")}
            target_pins = effective.get("targetPins") or []
        else:
            source = "workPackage"
            work_package = entry.get("workPackage") or {}
            edit_domain = work_package.get("editDomain") or {}
            target_pins = work_package.get("targetPins") or []
        sessions[slot] = {
            "contributionId": contribution["id"], "revision": contribution.get("revision"),
            "namePrefix": entry.get("namePrefix"), "editDomain": edit_domain, "targetPins": target_pins,
            "domainSource": source, "delta": contribution.get("delta"),
        }
    return sessions


def _run_replay_arms(site_profile, task):
    """Start both arms' XTop processes together and wait for both; `{arm: toolFailure|None}`.

    One arm failing never stops or fails the other (a failed control arm must not fail the
    merged arm); `reconcile` reads whatever each arm left behind.
    """
    def run(arm_task):
        try:
            adapters.run_tool(site_profile, arm_task["argv"], cwd=arm_task["root"], log_path=arm_task["logPath"])
        except adapters.AdapterToolError as exc:
            return {"detail": exc.detail, "log": str(exc.log_path)}
        except Exception as exc:  # noqa: BLE001 -- any failure is this arm's evidence, never the other's
            return {"detail": f"{type(exc).__name__}: {exc}", "log": str(arm_task["logPath"])}
        return None

    with ThreadPoolExecutor(max_workers=len(task["arms"])) as pool:
        futures = {arm: pool.submit(run, arm_task) for arm, arm_task in task["arms"].items()}
        return {arm: future.result() for arm, future in futures.items()}


def _replay_prepare_recipe(workspace, base_state, facts, collected, plan_raw, site_profile, auto_finish):
    """Issue #64 Task 6: replay the ranked recipe as two concurrent XTop arms (merged, control).

    Writes `integrations/<batchId>/{merged,control}/` (`adapters.compile_recipe_replay_task`),
    runs both through the Site wrapper at once, and records each arm's root and any tool
    failure in `state/replay-receipts.json` (`{"mode": "recipe", "arms": {...}}`). A tool
    failure is evidence, not a refusal: `reconcile` decides which arm, if any, is usable.
    """
    plan = dict(plan_raw)
    if auto_finish is not None:
        plan["autoFinish"] = auto_finish
    recipe = facts["recipe"]
    sessions = _recipe_sessions(workspace, recipe, collected, facts.get("baseStateId"))
    for key in ("design", "techLef", "cellLefGlob"):
        if not site_profile.get(key):
            raise InputError("invalid-input", f"site capabilities is missing {key!r}")
    xtop_context = _verified_xtop_context(workspace, base_state["id"], site_profile)
    request = integration.prepare_recipe_replay(
        plan, facts.get("baseStateId"), recipe, sessions,
        required_scenarios=xtop_context.get("requiredScenarios") or [],
        removable_fillers=xtop_context.get("removableFillers") or [],
    )
    batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
    output_root = workspace / "integrations" / batch_id
    if _replay_already_ran(output_root):
        raise core.AtcsError(
            "batch-id-reused",
            f"integrations/{batch_id}/ already holds a replay -- batch ids must be unique, "
            "this Pack never replays the same batch id a second time",
        )
    netlist_path = workspace / base_state["netlist"]["path"]
    def_path = workspace / base_state["def"]["path"] if base_state.get("def") else None
    task = adapters.compile_recipe_replay_task(
        site_profile["design"], site_profile["techLef"], site_profile["cellLefGlob"],
        str(netlist_path), str(def_path) if def_path else "", request, output_root, xtop_context,
    )
    for arm_task in task["arms"].values():
        Path(arm_task["root"]).mkdir(parents=True, exist_ok=True)
        Path(arm_task["recipePath"]).write_text(arm_task["recipeText"], encoding="utf-8")
        Path(arm_task["autoFixPath"]).write_text(arm_task["autoFixText"], encoding="utf-8")
        Path(arm_task["tclPath"]).write_text(arm_task["tcl"], encoding="utf-8")
    failures = _run_replay_arms(site_profile, task)
    arms = {}
    for arm, arm_task in task["arms"].items():
        arms[arm] = {"root": _relpath(arm_task["root"], workspace)}
        if failures.get(arm) is not None:
            arms[arm]["toolFailure"] = failures[arm]
    _canonical_write(_paths(workspace)["replay_receipts"], {"mode": "recipe", "arms": arms})
    return _paths(workspace)["replay_request"], request


def _cmd_reconcile(workspace, args):
    """Edit domains come from `state/workers.json`'s own validated `workPackage` (Task 12c item 2).

    Previously this took three positional `research/requests/work-package-
    w0N.json` argv paths and rebuilt `edit_domains` from whatever those raw,
    never-Reader-admitted files said -- a worker's own raw request file
    could be rewritten after `prepare-workers` already validated and sealed
    its edit domain into `state/workers.json`, silently widening or
    narrowing what `integration.reconcile`'s own out-of-scope check
    enforces. `edit_domains` is now built exclusively from
    `state/workers.json[slot]["workPackage"]["editDomain"]` -- the *same*
    validated package `prepare-workers` wrote (M2 `validate_work_package`'s
    own output) -- keyed by each collected contribution's own `taskId`; no
    `research/requests/work-package-*` file is read here at all any more.
    """
    del args
    workspace = Path(workspace)
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    receipts_doc = _read_plain(_paths(workspace)["replay_receipts"])
    if request.get("mode") == "recipe":
        # Issue #64 Task 6: both arms are read back fresh from disk (dumps, receipts,
        # summaries, the ECO pair and its bytes) and `reconcile_recipe` chooses.
        batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
        recorded = receipts_doc.get("arms") if isinstance(receipts_doc.get("arms"), dict) else {}
        arms = {}
        for arm in adapters.REPLAY_ARMS:
            evidence = adapters.read_replay_arm(workspace / "integrations" / batch_id / arm, arm, request, workspace)
            evidence["toolFailure"] = (recorded.get(arm) or {}).get("toolFailure")
            arms[arm] = evidence
        return _paths(workspace)["integration_state"], integration.reconcile_recipe(request, arms)
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    workers_doc = _read_plain(_paths(workspace)["workers"])
    workers = workers_doc.get("workers", {}) or {}

    edit_domains = {}
    for contribution in collected["contributions"]:
        entry = workers.get(contribution.get("taskId"))
        work_package = (entry or {}).get("workPackage")
        if work_package is not None:
            edit_domains[contribution["id"]] = work_package.get("editDomain", {})

    body = integration.reconcile(request, receipts_doc.get("receipts", []), edit_domains)
    return _paths(workspace)["integration_state"], body


def _cmd_presta(workspace, args):
    """Cheap PT pre-check plus RC-qualification evidence for the not-yet-implemented batch.

    Calls `integration.seal_batch` itself (against the already-reconciled
    `integration-state`) purely to read the candidate `merge-commit`'s own
    `newNets` -- the same computation `implement` performs and persists for
    real; `presta` never writes `state/merge-commit.json` itself, so a
    second, real `seal_batch` call in `implement` is not a duplicate write,
    only a duplicate (pure, side-effect-free) computation. Its own id is
    used as the `integrations/<batchId>/presta/` directory name (never a
    mutable `current` directory, per architecture Sec.13.4).

    Writes the base SPEF's net names to
    `integrations/<batchId>/presta/spef-net-names.txt`, **plain text, one
    name per line** (matching `tools/read-atcs.py`'s `precheck-evidence`
    reader, which parses that source with `.splitlines()`, never JSON), and
    passes that path to `verification.precheck_evidence(merge_commit,
    spef_net_names_path)` -- which only hashes it, never parses or embeds
    its content, so the Reader independently re-parses and re-hashes it.
    """
    base_state_path, scenarios_path, site_profile_path = args
    workspace = Path(workspace)
    base_state = _read_declared(base_state_path, "design-state")
    scenarios_contract = _load_scenarios_contract(scenarios_path)
    site_profile = _read_plain(site_profile_path)
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    integration_state = _read_declared(_paths(workspace)["integration_state"], "integration-state")
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    merge_commit = integration.seal_batch(integration_state, request, facts, collected["contributions"])

    scenario = next(iter(scenarios_contract))
    scenario_entry = scenarios_contract[scenario]
    corner = scenario_entry["corner"]
    spef_ref = base_state.get("spef", {}).get(corner)
    if not spef_ref:
        raise core.AtcsError("missing-input", f"base state has no SPEF for corner {corner!r}")

    # C4 (final review): the same optional library triple `_scenario_pt_inputs`
    # fills for observe/residual, threaded here too -- `pt-presta.tcl` now
    # actually links a cell library instead of failing `link_design` with none.
    inputs = {
        "design": base_state["top"], "netlist": str(workspace / base_state["netlist"]["path"]),
        "sdc": str(workspace / base_state["sdc"][0]["path"]) if base_state.get("sdc") else "",
        "spef": str(workspace / spef_ref["path"]),
        "libGlob": scenario_entry["libGlob"], "driverLibrary": scenario_entry["driverLibrary"],
        "originalDriverLibrary": scenario_entry["originalDriverLibrary"],
    }
    adapters.hash_library_glob(scenario_entry["libGlob"], label=f"{scenario} libGlob")
    batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
    report_root = workspace / "integrations" / batch_id / "presta"
    task = adapters.compile_pt_presta_task(scenario, inputs, str(report_root))
    tcl_path = report_root / scenario / "pt-presta.tcl"
    tcl_path.parent.mkdir(parents=True, exist_ok=True)
    tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = report_root / scenario / "pt.log"
    adapters.run_tool(site_profile, ["pt_shell", "-f", str(tcl_path)], cwd=tcl_path.parent, log_path=log_path)

    global_timing_path = Path(task["globalTiming"])
    if not global_timing_path.is_file():
        raise adapters.AdapterToolError("presta produced no global_timing.rpt", log_path)
    from atcs import reports  # local import: only presta needs the PT report parser
    predicted = reports.parse_global_timing(global_timing_path.read_text(encoding="utf-8"))

    # `tools/read-atcs.py`'s `precheck-evidence` reader parses this source
    # as plain text, one net name per line (`resolved.read_text(...)
    # .splitlines()`) -- never JSON. Written as an absolute-but-in-workspace
    # path: `verification.precheck_evidence` hashes whatever path string it
    # is given (no root-resolution of its own), so this must already be
    # openable regardless of this process's cwd; the Reader's own
    # `_safe_join` still accepts it (an absolute path already inside
    # `workspace` resolves and validates the same as a relative one).
    spef_net_names = adapters.parse_spef_net_names(_read_text(str(workspace / spef_ref["path"])))
    spef_net_names_path = report_root / "spef-net-names.txt"
    spef_net_names_path.parent.mkdir(parents=True, exist_ok=True)
    spef_net_names_path.write_text(
        "\n".join(sorted(spef_net_names)) + "\n" if spef_net_names else "", encoding="utf-8",
    )
    # `predicted` (the cheap PT-level WNS estimate) is not part of the
    # `precheck_evidence` artifact's own contract -- kept as a side file for
    # `evaluate`/debugging, never the declared output.
    #
    # Minor (final review): labelled explicitly as base-netlist-derived -- `task`
    # (compiled above) hands PT the *base* (pre-batch, pre-ECO) netlist
    # (`base_state["netlist"]`), never the pending candidate's own not-yet-
    # implemented one, since no post-fix netlist exists yet at this stage. A bare
    # `"predicted"` key could be mistaken for a genuine prediction of the batch's
    # own effect; `predictedBaseNetlistSetupWns`/`predictedBaseNetlistHoldWns`
    # names what this value actually is. No other reader consumes this field today
    # (`record-experience`'s own "predicted" comes from each contribution's own
    # submitted `predicted` measures, not from this side file).
    _canonical_write(report_root / "predicted.json", {
        "scenario": scenario, "basis": "base-netlist",
        "predictedBaseNetlistSetupWns": predicted.get("setup", {}).get("wns"),
        "predictedBaseNetlistHoldWns": predicted.get("hold", {}).get("wns"),
    })

    predictive = None
    if merge_commit.get("eco") is not None:
        # Issue #64 Task 6: a recipe batch's pre-check never gates it; it only states whether
        # it is predictive -- every new net known and qualified against the base SPEF.
        qualification = verification.presta_qualification(merge_commit.get("newNets"), spef_net_names)
        predictive = core.is_known(qualification["count"]) and core.value_of(qualification["count"]) == 0
    body = verification.precheck_evidence(merge_commit, str(spef_net_names_path), predictive=predictive)
    return _paths(workspace)["presta"], body


def _implement_body_from_outputs(merge_commit, design, outputs, workspace):
    """The exact `state/implement.json` shape `_cmd_implement` writes, built from an
    already-compiled ECO task's own `outputs` paths (re-hashed fresh, right now --
    never trusted from an earlier run)."""
    database_ref = {
        "path": _relpath(outputs["database"], workspace), "sha256": core.file_sha256(outputs["database"]),
        "datDigest": core.tree_digest(outputs["database"] + ".dat"),
    }
    netlist_ref = {"path": _relpath(outputs["netlist"], workspace), "sha256": core.file_sha256(outputs["netlist"])}
    def_ref = {"path": _relpath(outputs["def"], workspace), "sha256": core.file_sha256(outputs["def"])}
    return {
        "mergeCommitId": merge_commit["id"], "design": design, "parentStateId": merge_commit.get("parentStateId"),
        # Minor (final review): a real Integration Fix Session merge always occurs
        # post-route (`sta` used to hard-code this same literal for every candidate,
        # including an apr-run one at an earlier stage -- see that fix); recorded
        # explicitly here too, for symmetry with `_cmd_apr_run`'s own `stage` field.
        "stage": "postroute",
        "database": database_ref, "netlist": netlist_ref, "def": def_ref,
        "drcReport": {"path": _relpath(outputs["drc"], workspace), "sha256": core.file_sha256(outputs["drc"])},
        "connectivityReport": {
            "path": _relpath(outputs["connectivity"], workspace), "sha256": core.file_sha256(outputs["connectivity"]),
        },
    }


def _cmd_implement(workspace, args):
    """C2 (final review, stale re-implement overwrites adopted DB): two independent
    refusals guard against silently overwriting an already-implemented (and possibly
    already-adopted) candidate's own on-disk database.

    1. **`stale-base`** — the sealed merge commit's own recorded
       `parentStateId` must equal the CURRENT `state/working-state.json`'s
       `id` (`current_state`, this call's own first argv arg). `adopt`
       rewrites `state/working-state.json` every time it accepts a
       candidate, but `state/integration-state.json`/`composition-facts.json`/
       `replay-request.json` (what `integration.seal_batch` reseals from) are
       only ever refreshed by a fresh compose/replay round; calling
       `implement` again with no fresh round in between reseals the exact
       same merge commit (a pure function of those unchanged inputs),
       including its stale `parentStateId` -- naming a batch built against a
       state the campaign has already moved past.
    2. **`write-once`** — `implementations/<mergeId>/merge-commit.json` (the
       completion marker only a prior, successful `implement` call for this
       EXACT merge commit id ever writes) must not already exist. Even a
       merge commit whose `parentStateId` legitimately still matches the
       current working state (a plain retry) must never re-run the ECO into
       a directory another generation may already be relying on as
       immutable evidence.

    Both checks run, and both refusal paths leave `state/merge-commit.json`/
    `implementations/<mergeId>/merge-commit.json` untouched -- refusing
    `implement` must never leave partial or misleading bookkeeping behind.

    N2 (final fix batch C): the completion marker (and `state/merge-commit.
    json`) are now written only AFTER the ECO's own outputs are verified
    present below -- matching `_cmd_apr_run`'s own write-once convention
    (its `apr-run-complete.json` marker is likewise written only at the very
    end of a successful run). Before this fix, both were written BEFORE
    `run_tool` ran at all, so a run that failed partway through (the wrapper
    crashed, or simply produced no output) still left the marker in place;
    a legitimate retry of the exact same merge commit was then wrongly
    refused `write-once` even though nothing had ever actually succeeded.
    When a PRIOR attempt's own `output_root` already exists (no completion
    marker in it -- guaranteed by the write-once check just above, which
    would have refused otherwise), it is renamed aside to
    `implementations/<mergeId>-attempt-<n>/` before this attempt starts,
    preserving that partial evidence for debugging rather than silently
    overwriting or discarding it in place; a fresh `output_root` is then
    used for this attempt.

    Final review minor (item 2, crash window): `main()` only writes the declared
    `state/implement.json` output AFTER this handler returns (`core.write_artifact`,
    outside this function entirely) -- but this function itself already wrote the
    write-once marker (`merge_commit_marker`) and `state/merge-commit.json` a few
    lines earlier, once the ECO's own outputs were verified present. A crash in that
    exact window leaves a fully verified, already-completed implementation with
    `state/implement.json` either missing, or still naming an earlier candidate.
    When the marker already exists, this function now recompiles the SAME
    deterministic ECO task from the sealed merge commit (never re-running it) and,
    if this merge id's own outputs are still verified present on disk AND
    `state/implement.json` does not already record this exact candidate, rewrites
    `state/implement.json` from those verified outputs instead of refusing. A
    `state/implement.json` that already matches this candidate is a plain retry of
    an already-fully-recorded implement -- that one still refuses `write-once`,
    exactly as before.
    """
    current_state_path, site_profile_path = args
    workspace = Path(workspace)
    current_state = _read_declared(current_state_path, "design-state")
    site_profile = _read_plain(site_profile_path)
    if (workspace / "state/lead-final.json").is_file():
        final = _read_plain(workspace / "state/lead-final.json")
        merge_commit = _read_declared(_paths(workspace)["merge_commit"], "merge-commit")
        if final.get("mergeCommitId") != merge_commit["id"]:
            raise core.AtcsError("identity-mismatch", "lead final does not identify this merge commit")
    else:
        integration_state = _read_declared(_paths(workspace)["integration_state"], "integration-state")
        request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
        facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
        collected = _read_plain(_paths(workspace)["contributions_collected"])

        merge_commit = integration.seal_batch(integration_state, request, facts, collected["contributions"])

    if merge_commit.get("parentStateId") != current_state.get("id"):
        raise core.AtcsError(
            "stale-base",
            f"merge commit parentStateId {merge_commit.get('parentStateId')!r} does not match the "
            f"current working state {current_state.get('id')!r} -- compose/replay a fresh batch "
            "against the current working state before implementing again",
        )

    design = current_state["top"]
    current_db = workspace / current_state["database"]["path"]

    merge_id = adapters.validate_path_segment(merge_commit["id"], "merge-commit.id")
    output_root = workspace / "implementations" / merge_id
    merge_commit_marker = output_root / "merge-commit.json"
    if merge_commit_marker.is_file():
        # Crash-window recovery (final review minor, item 2): recompile the same
        # deterministic task (no side effects, never runs the tool) so the exact
        # outputs a genuine prior success would have produced can be re-verified.
        recovery_task = adapters.compile_innovus_eco_task(merge_commit, str(current_db), design, str(output_root),
                                                          eco_root=workspace)
        recovery_outputs = recovery_task["outputs"]
        outputs_verified = all(Path(path).is_file() for path in recovery_outputs.values())
        if outputs_verified:
            recovered_body = _implement_body_from_outputs(merge_commit, design, recovery_outputs, workspace)
            existing_implement = _read_json_or_default(_paths(workspace)["implement"], {})
            if existing_implement != recovered_body:
                return _paths(workspace)["implement"], recovered_body
        raise core.AtcsError(
            "write-once",
            f"implementations/{merge_id}/ has already been implemented ({merge_commit_marker} exists) "
            "-- a merge commit's implementation output is never overwritten",
        )

    # N2 (final fix batch C): `output_root / "eco.tcl"` is written ONLY by this
    # function (right below, from the compiled task -- before `run_tool` even
    # runs) and by nothing else, so its presence is the precise signal that a
    # PRIOR `implement` attempt for this exact merge id already started here
    # and did not complete (write-once, checked above, guarantees no completion
    # marker is in it either way -- this could only be a failed attempt, never
    # an adopted one). Preserve that partial evidence, moved aside, rather than
    # overwriting or discarding it in place, then run this attempt into a fresh
    # `output_root`.
    if (output_root / "eco.tcl").is_file() or (output_root / "innovus-eco.tcl").is_file():
        attempt = 1
        while (output_root.parent / f"{merge_id}-attempt-{attempt}").exists():
            attempt += 1
        output_root.rename(output_root.parent / f"{merge_id}-attempt-{attempt}")

    task = adapters.compile_innovus_eco_task(merge_commit, str(current_db), design, str(output_root),
                                             eco_root=workspace)

    if task.get("ecoCopies"):
        # Issue #64 Task 6: the chosen `write_design_changes -keep_route` pair, copied into
        # this implementation only if its bytes are still exactly what the batch sealed.
        for copy in task["ecoCopies"]:
            source = Path(copy["from"])
            if source.is_symlink() or not source.is_file() or core.file_sha256(source) != copy["sha256"]:
                raise core.AtcsError(
                    "identity-mismatch",
                    f"ECO {copy['role']} file {source} is missing or differs from the sha256 the batch sealed",
                )
            target = Path(copy["to"])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            if core.file_sha256(target) != copy["sha256"]:
                raise core.AtcsError("identity-mismatch", f"ECO {copy['role']} copy {target} differs from its source")
    else:
        eco_path = Path(task["ecoPath"])
        eco_path.parent.mkdir(parents=True, exist_ok=True)
        eco_path.write_text(task["ecoText"], encoding="utf-8")
    main_tcl_path = output_root / "innovus-eco.tcl"
    main_tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = output_root / "innovus-eco.log"
    adapters.run_tool(
        site_profile, task["command"] + [str(main_tcl_path), "-log", str(log_path), "-overwrite", "-64", "-nowin"],
        cwd=output_root, log_path=log_path,
    )

    outputs = task["outputs"]
    for name, path in outputs.items():
        if not Path(path).is_file():
            raise adapters.AdapterToolError(f"expected Innovus ECO output missing: {name}={path}", log_path)

    body = _implement_body_from_outputs(merge_commit, design, outputs, workspace)

    # N2: written only now that the ECO's own outputs are verified present above --
    # never before `run_tool` ran, so a failed attempt never leaves a marker a
    # retry would be wrongly refused write-once against.
    _canonical_write(_paths(workspace)["merge_commit"], merge_commit)
    _canonical_write(merge_commit_marker, merge_commit)

    return _paths(workspace)["implement"], body


def _load_starrc_corner_templates(corners_path):
    """`{corner: {"path": <templatePath>, "text": <content>, "sha256": <hash>}}` from
    `corners.json`'s `{"corners": {corner: templatePath}}` (I1, final review).

    Each `templatePath` is a Site-provided, read-only StarRC command-file template
    (the same per-corner file the old `xtop-timing-closure` Pack's Site profile
    names as `starrc[].template`, e.g. `SIGNOFF/STARRC/cworst_T.cmd`) -- this Pack
    never ships or assumes one fixed shared template for every corner. Raises
    `InputError("invalid-input", ...)` when `corners` is missing, empty or not a
    `{corner: path}` mapping, and `InputError("missing-input", ...)` when a named
    template file cannot actually be read.
    """
    corners_doc = _read_plain(corners_path)
    corners = corners_doc.get("corners")
    if not isinstance(corners, dict) or not corners:
        raise InputError("invalid-input", "corners must map at least one StarRC corner to a template path")
    templates = {}
    for corner, template_path in corners.items():
        adapters.validate_path_segment(corner, "corners entry")
        if not isinstance(template_path, str) or not template_path:
            raise InputError("invalid-input", f"corners[{corner!r}] must be a non-empty template path")
        try:
            text = Path(template_path).read_text(encoding="utf-8")
        except OSError as exc:
            raise InputError("missing-input", f"cannot read StarRC template for corner {corner!r}: {exc}") from exc
        templates[corner] = {"path": template_path, "text": text, "sha256": core.file_sha256(Path(template_path))}
    return templates


def _cmd_extract(workspace, args):
    """I4 (final review, identity by hashing at use): `inputDefSha256` is the hash of the
    DEF file this call actually reads (right here, right now), verified equal to
    `implement.json`'s own recorded `def.sha256` -- never that recorded value copied
    through unchecked. A DEF that changed on disk between `implement` and `extract`
    (however unlikely in the normal flow) must be caught here, at the moment StarRC is
    about to read it, not left for a downstream consumer to trust blindly.

    I1 (final review, StarRC templates): `corners` used to be a bare list of corner
    NAMES, compiled against this Pack's own single shipped fallback `starrc.cmd`
    template regardless of corner -- real Foundation StarRC corners (e.g.
    `cworst_T`/`cbest`) each need their own qualified command-file template
    (`STAR_MODE`, layer stack, etc. genuinely differ per corner). `corners.json` now
    maps `{corner: templatePath}` (`_load_starrc_corner_templates`, hashed); each
    corner's own template text is threaded into `adapters.compile_starrc_task` as
    `template_text`, and the template's own identity is recorded in this call's
    declared output (`spef_out[corner]["template"]`) for provenance.
    """
    corners_path, site_profile_path = args
    workspace = Path(workspace)
    templates = _load_starrc_corner_templates(corners_path)
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])
    merge_id = adapters.validate_path_segment(implement.get("mergeCommitId"), "implement.mergeCommitId")

    def_path = workspace / implement["def"]["path"]
    def_sha256 = core.file_sha256(def_path)
    if def_sha256 != implement["def"]["sha256"]:
        raise core.AtcsError(
            "identity-mismatch", f"DEF at {def_path} no longer matches implement.json's recorded sha256",
        )

    # Issue 63: the Site's `edarun` wrapper (`edaShell`) forwards no LD_LIBRARY_PATH of its
    # own, so a bare StarXtract invocation fails `error while loading shared libraries:
    # libtbb.so.12` -- resolved once per call (declared `starrcHome` override, else probed
    # through the Site's own edaShell) and failed closed here, before StarXtract ever runs,
    # rather than letting every corner repeat the same doomed invocation.
    declared_toolkit = site_profile.get("starrcHome") if isinstance(site_profile, dict) else None
    starrc_toolkit = Path(declared_toolkit) if declared_toolkit else adapters.discover_starrc_toolkit(site_profile)
    starrc_env = adapters.starrc_shell_env(starrc_toolkit) if starrc_toolkit else []
    if not starrc_toolkit or not starrc_env:
        raise core.AtcsError(
            "missing-input",
            "StarRC toolkit root cannot be resolved: declare starrcHome in the site profile, or "
            "have StarXtract on PATH (via edaShell) under a toolkit holding linux64_starrc/lib",
        )

    output_root = workspace / "implementations" / merge_id
    spef_out = {}
    for corner, template in templates.items():
        task = adapters.compile_starrc_task(
            implement["design"], corner, str(def_path), str(output_root), template_text=template["text"]
        )
        cmd_path = Path(task["cmdPath"])
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text(task["cmdText"], encoding="utf-8")
        Path(task["workDir"]).mkdir(parents=True, exist_ok=True)
        log_path = Path(task["cmdPath"]).with_suffix(".log")
        adapters.run_tool(site_profile, task["command"], cwd=cmd_path.parent, log_path=log_path, shell_env=starrc_env)
        spef_path = Path(task["spefPath"])
        if not spef_path.is_file():
            raise adapters.AdapterToolError(f"StarRC produced no SPEF for corner {corner!r}", log_path)
        spef_out[corner] = {
            "path": _relpath(spef_path, workspace), "sha256": core.file_sha256(spef_path),
            "inputDefSha256": def_sha256, "estimated": False,
            "template": {"path": template["path"], "sha256": template["sha256"]},
        }
    return _paths(workspace)["extract"], {"spef": spef_out}


def _merge_commit_provenance(workspace, implement):
    """Whether `implement`'s own candidate id is a real Integration Fix Session merge
    commit's id, or a prepared APR stage task's id -- decided by comparing ids, never
    by which state file merely happens to exist on disk (Task 12c item 5).

    `_cmd_implement` always writes `state/merge-commit.json` as a side
    effect; `_cmd_apr_run` never does. The bug this fixes: `_cmd_apr_run`
    also never *removes* a `state/merge-commit.json` left over from an
    earlier real batch -- so once any batch has ever been composed for this
    campaign, that file keeps existing on disk for every later generation,
    including a later `apr-run` candidate that composed no batch at all.
    Deciding provenance from mere file existence (the old rule) would then
    misattribute that later APR candidate to the *stale* earlier batch.

    This instead compares `implement["mergeCommitId"]` against the actual
    `id` recorded in `state/merge-commit.json` (a real batch) and, failing
    that, against `state/apr-task.json`'s own `taskId` (a prepared APR
    stage) -- both are written by whichever call actually produced this
    exact candidate, so only one of them can ever match `implement`'s own
    id by construction. Returns `"merge"` or `"apr"`; raises
    `InputError("missing-input", ...)` when neither matches -- a candidate
    id that names neither a real merge commit nor a prepared APR task is
    not something this dispatcher can honestly attribute a provenance to.
    """
    candidate_id = implement.get("mergeCommitId")
    merge_commit_path = _paths(workspace)["merge_commit"]
    if merge_commit_path.is_file():
        merge_commit = _read_declared(merge_commit_path, "merge-commit")
        if merge_commit.get("id") == candidate_id:
            return "merge"
    apr_task_path = _paths(workspace)["apr_task"]
    if apr_task_path.is_file():
        apr_task = _read_plain(apr_task_path)
        if apr_task.get("taskId") == candidate_id:
            return "apr"
    raise InputError(
        "missing-input",
        f"cannot establish provenance for candidate {candidate_id!r}: it matches neither "
        "state/merge-commit.json's own id nor state/apr-task.json's own taskId",
    )


def _load_merge_commit_like(workspace, implement, provenance=None):
    """Return the sealed `merge-commit` `implement` was built from, or a synthetic stand-in for an APR-run candidate.

    See `_merge_commit_provenance` for how "which one" is decided (by id,
    never by file existence). The synthetic stand-in carries `operations: []`
    (an APR stage intervention never changes netlist topology or PG
    structures, so `verification.plan_checks` adds no extra functional/pg
    checks for it, correctly).

    `provenance` lets a caller that already computed it (e.g.
    `_cmd_record_experience`, which needs it up front to pick its reason
    source) pass that same value straight through instead of this function
    re-deriving it a second time (Fix round 1 item 3) -- re-reading
    `state/merge-commit.json`/`state/apr-task.json` twice for one call would
    be pure waste, since the answer cannot change between the two reads
    within a single subcommand invocation. Defaults to `None`, in which
    case this recomputes it itself (every other caller here has no
    precomputed value to offer).
    """
    if provenance is None:
        provenance = _merge_commit_provenance(workspace, implement)
    if provenance == "merge":
        return _read_declared(_paths(workspace)["merge_commit"], "merge-commit")
    if not implement.get("parentStateId"):
        raise InputError("missing-input", f"declared input not found: {_paths(workspace)['merge_commit']}")
    return {"id": implement.get("mergeCommitId"), "parentStateId": implement["parentStateId"], "operations": []}


STA_RECHECK_BOUND = 200


def _bounded_parent_violator_recheck(
    workspace, prior_observation, scenario_inputs_by_scenario, site_profile, report_root, pba=False,
):
    """I5 (final review, fixed count): re-query, on the CANDIDATE's own netlist/SPEF/SDC
    (`scenario_inputs_by_scenario`, the exact per-scenario inputs the real STA loop
    above just used), up to `STA_RECHECK_BOUND` of the PARENT's own worst-known-slack
    violating checks (`state.violating_check_keys` on `prior_observation`) -- so
    `evaluate`'s `fixedCheckCount`/`missingPriorCheckCount` never mistake "this
    generation's own top-N-worst-path STA no longer happened to report this check" for
    a genuine `missingPrior`: a parent violator that has dropped out of the worst-N
    listing precisely because it is now FIXED must still be recognized as fixed.

    N4 (final fix batch C): each check key's own `mode` (`"<scenario>|<mode>|
    <endpoint>"`) is carried into its `pt-query.tcl` target -- a hold check
    recheck must never be queried with PT's own `-delay_type` default (`max`,
    a setup check's own delay arc), which would silently recheck the wrong
    slack. `pba` (default `False`) is threaded straight through to
    `adapters.compile_pt_query_task`; `_cmd_sta` passes its own
    `query_spec["precision"] == "pba"`, so this recheck always runs at the
    same precision the candidate's own STA loop just used.

    Returns `(recheck, complete, notes)`: `recheck` is `{checkKey: Measure}` (slack
    only -- `state.compare_checks`'s own `recheck` contract, no `violated` fact);
    `complete` is `True` only when every one of the parent's own violating checks was
    within the bound AND every scenario's targeted query and report parse actually
    produced a value for it; `notes` names every reason a specific check (or the whole
    recheck) could not be completed, for provenance (not part of any binding shape).
    """
    if prior_observation is None:
        return {}, False, ["no prior observation recorded for the parent state -- recheck skipped"]

    violator_keys = state.violating_check_keys(prior_observation)
    bounded_keys = _bounded_remaining_checks(prior_observation, violator_keys, STA_RECHECK_BOUND)

    notes = []
    if len(bounded_keys) < len(violator_keys):
        notes.append(
            f"{len(violator_keys) - len(bounded_keys)} parent violator(s) exceeded the recheck "
            f"bound ({STA_RECHECK_BOUND})"
        )

    checks = prior_observation.get("checks", {}) or {}
    by_scenario = {}
    for key in bounded_keys:
        parts = key.split("|", 2)
        if len(parts) != 3:
            notes.append(f"{key}: malformed check key")
            continue
        scenario, mode, key_endpoint = parts
        entry = checks.get(key) or {}
        startpoint = entry.get("startpoint")
        if not isinstance(startpoint, str) or not startpoint:
            notes.append(f"{key}: no startpoint recorded in the parent observation")
            continue
        if scenario not in scenario_inputs_by_scenario:
            notes.append(f"{key}: scenario {scenario!r} is not one of this generation's own required scenarios")
            continue
        if mode not in ("setup", "hold"):
            notes.append(f"{key}: unrecognized mode {mode!r}")
            continue
        # The check key's own third component may itself carry a
        # "@<path group>" suffix (atcs.reports.parse_path_report, a reserved PT
        # path group such as **async_default**) -- that suffixed form is never a
        # real PT pin name, so the entry's own recorded literal endpoint
        # (`"endpoint"`, PT's own pin name) is used for the actual query
        # whenever it is present, falling back to the check key's own
        # component only for an older-shaped entry that never recorded one.
        endpoint = entry.get("endpoint") if isinstance(entry.get("endpoint"), str) else key_endpoint
        by_scenario.setdefault(scenario, []).append(
            {"checkKey": key, "startpoint": startpoint, "endpoint": endpoint, "mode": mode}
        )

    recheck = {}
    for scenario, targets in sorted(by_scenario.items()):
        inputs = scenario_inputs_by_scenario[scenario]
        scenario_report_root = report_root / scenario
        try:
            task = adapters.compile_pt_query_task(inputs, str(scenario_report_root), targets, pba=pba)
        except core.AtcsError as exc:
            notes.append(f"{scenario}: {exc.detail}")
            continue
        tcl_path = scenario_report_root / "pt-query.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(task["tcl"], encoding="utf-8")
        log_path = scenario_report_root / "pt.log"
        try:
            adapters.run_tool(site_profile, ["pt_shell", "-f", str(tcl_path)], cwd=scenario_report_root, log_path=log_path)
        except adapters.AdapterToolError as exc:
            notes.append(f"{scenario}: pt-query failed: {exc.detail}")
            continue
        for target in targets:
            report_path = Path(task["reports"][target["checkKey"]])
            if not report_path.is_file():
                notes.append(f"{target['checkKey']}: pt-query produced no report at {report_path}")
                continue
            recheck[target["checkKey"]] = adapters.parse_query_slack(report_path.read_text(encoding="utf-8"))

    complete = len(bounded_keys) == len(violator_keys) and all(key in recheck for key in bounded_keys)
    return recheck, complete, notes


def _cmd_sta(workspace, args):
    """Fix round 2 item 2 (controller decision, one SDC source): the SDC this candidate is
    timed against comes from `base_state` (the design state actually being timed, `state/
    working-state.json`) via `_verified_state_sdc_path`, never a separate Site-fixed
    `analysisContract/sdc.json` copy that could silently diverge from the SDC the state
    itself was built from -- the `sdc` argv arg is gone; `observe`/`residual` already read
    SDC this same way (`_scenario_pt_inputs`).

    C5 (final review, wrong-generation comparison): the candidate's own
    `design-state` (built from the just-implemented database/netlist/DEF and
    this call's own fresh extraction, `parentId = base_state["id"]`) is now
    built *before* the per-scenario STA loop runs, and every scenario's
    `state.capture` call labels its `observation-set` with that candidate's
    own stamped id (`design_state["id"]`) -- never `base_state["id"]` (the
    *parent* state's id), which is what this call used to (incorrectly)
    stamp every observation with. Labeling STA's own fresh observations with
    the wrong generation's id is exactly what let `evaluate` believe it was
    comparing a candidate against its own immediate prior evidence when the
    ids never actually distinguished the two generations at all. This call's
    own declared output (`state/sta.json`) is additionally archived
    verbatim to `implementations/<mergeId>/sta.json`, so a later `evaluate`
    (or any other consumer) can always recover exactly the STA receipts a
    given candidate was evaluated against, independent of whatever
    `state/sta.json` currently holds for a *later* generation.

    I4 (final review, identity by hashing at use): the candidate's own
    `design-state` re-hashes the database/netlist/every scenario's SPEF
    fresh, from the exact files this call is about to hand PT (`state.
    design_state`'s own `core.file_sha256` calls) -- this call verifies
    those fresh hashes still agree with `implement.json`'s/`extract.json`'s
    own recorded identities (`AtcsError("identity-mismatch", ...)` otherwise)
    and uses the FRESH values, not the recorded ones, in every scenario's own
    `sta_receipts[...]["inputs"]` -- so `finalIdentityErrorCount` is bound to
    the netlist/SPEF STA truly read, at the moment it read them, never to an
    earlier claim about them that may since have gone stale.

    I10 (final review): `maxPaths` now comes from the Strategy the same way
    `observe`'s does (`_apply_max_paths_cap`), instead of `sta` taking its
    whole `query_spec` verbatim from the static `analysisContract/
    query-spec.json` with no Run-level upper bound at all -- a Site/Workshop
    document could otherwise request an arbitrarily expensive final STA that
    no Strategy knob could rein in. The clamp decision is recorded at
    `implementations/<mergeId>/sta-max-paths.json` (the same non-declared
    side-file convention `observe` uses, just under this candidate's own
    archive directory instead of a shared `research/` path, since `sta` -
    unlike `observe` - already has one real merge id to scope it to).

    C4 (final review, per-scenario library identity): reads `analysisContract/
    scenarios.json` (`_load_scenarios_contract`) in place of the old bare
    `scenario-corners.json`, so PT actually links each scenario's own
    qualified corner library (`libGlob`/`driverLibrary`/`originalDriverLibrary`,
    filled the same way `_scenario_pt_inputs` fills them for `observe`/
    `residual`) instead of running with none at all. Each scenario's fresh
    library-file hashes (`adapters.hash_library_glob`, computed right before
    that scenario's PT task launches) are recorded in
    `sta_receipts[scenario]["inputs"]["libraries"]` -- a library-identity leg
    `verification.assemble` now requires present (alongside netlist/SPEF)
    before `finalIdentityErrorCount` can be a known count.

    N1 (final fix batch C, round-2 prior observation): once every scenario's
    STA has run, a SINGLE combined observation covering all required scenarios
    (the same shape `_cmd_observe` itself captures) is persisted, write-once, at
    `observations/<candidateStateId>.json` -- before this fix, `sta` only ever
    captured per-scenario mini-observations into `sta_receipts[...]
    ["observation"]`, never written to `observations/`, so a SECOND
    implementation round with no fresh `observe` call in between could never
    find this generation's own prior via `_find_prior_observation_for_state`;
    `evaluate`'s comparison fell back to "no prior observation" every time,
    even though this candidate's own STA already gathered everything a real
    prior observation needs.
    """
    query_spec_path, scenarios_path, base_design_state_path, site_profile_path, max_paths_raw = args
    workspace = Path(workspace)
    query_spec = dict(_read_plain(query_spec_path))
    scenarios_contract = _load_scenarios_contract(scenarios_path)
    required_scenarios = _required_scenarios_for_contract(query_spec, scenarios_contract)
    scenario_corners = _derive_scenario_corners(scenarios_contract)
    base_state = _read_declared(base_design_state_path, "design-state")
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])
    extract = _read_plain(_paths(workspace)["extract"])
    merge_id = adapters.validate_path_segment(implement.get("mergeCommitId"), "implement.mergeCommitId")
    query_spec = _apply_max_paths_cap(
        query_spec, max_paths_raw, workspace / "implementations" / merge_id / "sta-max-paths.json"
    )

    sdc_path = _verified_state_sdc_path(workspace, base_state)
    sdc_list = [entry["path"] for entry in (base_state.get("sdc") or [])]

    # Built BEFORE the STA loop (C5): every scenario's `state.capture` call
    # below labels its observation with this candidate's own id, never the
    # parent `base_state`'s.
    #
    # Minor (final review): `stage` comes from `implement.json`'s own recorded
    # value -- an apr-run candidate at an earlier stage (place/cts/route) used to
    # be mislabeled "postroute" unconditionally, the same literal a real
    # Integration Fix Session merge (always post-route) also uses. Both
    # `_cmd_implement` and `_cmd_apr_run` now record their own accurate `stage`;
    # `.get(..., "postroute")` only covers an `implement.json` written before this
    # fix (never a live gap, since both writers now always populate it).
    manifest = adapters.build_design_state_manifest(
        top=implement["design"], stage=implement.get("stage", "postroute"),
        database_enc=implement["database"]["path"], database_dat=implement["database"]["path"] + ".dat",
        netlist=implement["netlist"]["path"], def_path=implement["def"]["path"],
        spef_by_corner={corner: ref["path"] for corner, ref in extract["spef"].items()},
        sdc_list=sdc_list, scenario_corners=scenario_corners, tools=base_state.get("tools"),
        parent_id=base_state["id"], root=str(workspace),
    )
    design_state = state.design_state(manifest)
    # I4 (final review, identity by hashing at use): `state.design_state` just
    # re-hashed the netlist at the exact path this call is about to hand PT,
    # fresh, right now -- not copied from `implement.json`'s own recorded
    # value (computed back when `implement` finished). Verifying the two
    # agree, once, here, and then using the FRESH value below for every
    # scenario's own STA receipt is what actually binds `finalIdentityErrorCount`
    # to the netlist STA truly read, rather than to a stale claim about it.
    netlist_sha256 = design_state["netlist"]["sha256"]
    if netlist_sha256 != implement["netlist"]["sha256"]:
        raise core.AtcsError(
            "identity-mismatch",
            f"netlist at {workspace / implement['netlist']['path']} no longer matches "
            "implement.json's recorded sha256",
        )
    # I4: the candidate's OWN design-state (`sta` just built it, above) is
    # what `evaluate` will later compare its receipts against -- verify here
    # that its own database identity (also hashed fresh, by `state.design_state`,
    # from the exact `.enc`/`.enc.dat` bytes `implement` produced) still
    # agrees with `implement.json`'s own recorded database identity.
    if (design_state["database"]["sha256"] != implement["database"]["sha256"]
            or design_state["database"]["datDigest"] != implement["database"]["datDigest"]):
        raise core.AtcsError(
            "identity-mismatch",
            f"database at {workspace / implement['database']['path']} no longer matches "
            "implement.json's recorded identity",
        )

    report_root = workspace / "implementations" / merge_id / "sta"
    sta_receipts = {}
    sta_sources = {}
    scenario_inputs_by_scenario = {}
    # N1 (final fix batch C): every scenario's own report paths, collected as the
    # loop below runs, so a SINGLE combined observation covering all
    # required scenarios (mirroring `_cmd_observe`'s own `source_refs` shape) can
    # be captured and persisted once the loop finishes -- see the write below.
    combined_scenario_source_refs = {}
    for scenario in required_scenarios:
        corner = scenario_corners[scenario]
        spef_ref = extract["spef"].get(corner)
        if not spef_ref:
            raise InputError("invalid-input", f"extract has no SPEF for corner {corner!r}")
        # I4: same defense-in-depth for this scenario's own SPEF -- `design_state`
        # already re-hashed it fresh, from the exact file this scenario's PT
        # task is about to read.
        fresh_spef_entry = design_state["spef"].get(corner)
        if not fresh_spef_entry or fresh_spef_entry["sha256"] != spef_ref["sha256"]:
            raise core.AtcsError(
                "identity-mismatch",
                f"spef for corner {corner!r} at {workspace / spef_ref['path']} no longer matches "
                "extract.json's recorded sha256",
            )
        spef_sha256 = fresh_spef_entry["sha256"]
        sta_sources[scenario] = {"path": spef_ref["path"], "sha256": spef_sha256}
        scenario_entry = scenarios_contract[scenario]
        inputs = {
            "design": implement["design"], "netlist": str(workspace / implement["netlist"]["path"]),
            "sdc": str(sdc_path), "spef": str(workspace / spef_ref["path"]),
            "libGlob": scenario_entry["libGlob"], "driverLibrary": scenario_entry["driverLibrary"],
            "originalDriverLibrary": scenario_entry["originalDriverLibrary"],
        }
        # C4 (final review): hashed fresh, right here, right before this scenario's
        # PT task launches -- the same "identity by hashing at use" discipline I4
        # applies to netlist/SPEF, now extended to the library set.
        library_files = adapters.hash_library_glob(scenario_entry["libGlob"], label=f"{scenario} libGlob")
        scenario_inputs_by_scenario[scenario] = inputs
        task = adapters.compile_pt_scenario_task(scenario, inputs, str(report_root), query_spec)
        scenario_dir = report_root / scenario
        tcl_path = scenario_dir / "pt-scenario.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(task["tcl"], encoding="utf-8")
        log_path = scenario_dir / "pt.log"
        adapters.run_tool(site_profile, task["command"] + [str(tcl_path)], cwd=scenario_dir, log_path=log_path)
        for name, report_path in task["reports"].items():
            if not Path(report_path).is_file():
                raise adapters.AdapterToolError(f"expected PT report missing: {report_path}", log_path)

        scenario_source_ref = {
            "globalTiming": task["reports"]["global_timing.rpt"], "setupPaths": task["reports"]["setup.rpt"],
            "holdPaths": task["reports"]["hold.rpt"], "checkTiming": task["reports"]["check_timing.rpt"],
        }
        combined_scenario_source_refs[scenario] = scenario_source_ref
        source_refs = {
            # C5: the candidate's OWN state id, never base_state["id"] (the parent).
            "designStateId": design_state["id"],
            "scenarios": {scenario: scenario_source_ref},
        }
        one_scenario_query_spec = dict(query_spec)
        one_scenario_query_spec["requiredScenarios"] = [scenario]
        observation = state.capture(source_refs, one_scenario_query_spec)
        sta_receipts[scenario] = {
            "corner": corner,
            # I4: the fresh, at-use hashes, not implement.json's/extract.json's
            # own recorded copies (verified equal to them just above). C4:
            # "libraries" is this scenario's own fresh library-file identity
            # (never present before this fix, since no library was ever hashed
            # or threaded through PT at all).
            "inputs": {
                "netlistSha256": netlist_sha256, "spefSha256": spef_sha256, "libraries": library_files,
            },
            "observation": observation,
        }

    _canonical_write(workspace / "implementations" / merge_id / "design-state.json", design_state)

    # N1 (final fix batch C): a combined, candidate-labelled observation covering
    # every required-scenario entry -- the same shape `_cmd_observe` itself
    # captures and persists (`{"designStateId", "scenarios": {...}}` through
    # `state.capture`) -- is captured here and persisted, write-once, at
    # `observations/<candidateStateId>.json`. Before this fix, `sta` only ever
    # captured per-scenario mini-observations into `sta_receipts[...]
    # ["observation"]` (never written to `observations/`), so a SECOND
    # implementation round with no fresh `observe` call in between could never
    # find this generation's own prior via `_find_prior_observation_for_state`
    # -- `evaluate`'s comparison fell back to "no prior observation", which is
    # honest but avoidable: this candidate's own STA already gathered
    # everything a real prior observation needs. Write-once (checked by the
    # candidate's own state id, which is content-derived -- the same file
    # would never legitimately need overwriting) so a retried `sta` for the
    # same candidate never clobbers this generation's own persisted evidence.
    combined_observation = state.capture(
        {"designStateId": design_state["id"], "scenarios": combined_scenario_source_refs}, query_spec,
    )
    combined_observation_path = workspace / "observations" / f"{design_state['id']}.json"
    if not combined_observation_path.is_file():
        _canonical_write(combined_observation_path, combined_observation)

    # Called exactly once here: extraction (`extract.json`, already read
    # above) and all required scenarios' STA (the loop above) have both
    # just completed for this implementation. `sta_sources` is one
    # `{"path","sha256"}` ref per required scenario -- the SPEF that
    # scenario's STA actually read (`atcs.refresh.record_refresh`'s own
    # binding shape: a dict keyed by the analysis contract's required scenarios).
    merge_commit = _load_merge_commit_like(workspace, implement)
    from atcs import refresh  # local import: keeps this dispatcher loadable if this module is ever absent
    refresh.record_refresh(
        str(_paths(workspace)["refresh_ledger"]), merge_commit["id"], design_state["id"],
        sta_sources, required_scenarios,
    )

    # I5 (final review, fixed count): the PARENT's own persisted observation (the one
    # whose designStateId equals base_state["id"], the same lookup evaluate itself
    # uses via parent_state_id) names which checks were violating before this
    # implementation -- recheck up to STA_RECHECK_BOUND of them, by worst known slack,
    # on the candidate's own fresh netlist/SPEF/SDC (the exact per-scenario inputs the
    # STA loop above just used), and feed the result forward so evaluate can pass it
    # to compare_checks as `recheck` instead of leaving every no-longer-top-N-worst
    # check to default to `missingPrior`.
    parent_observation = _find_prior_observation_for_state(workspace, base_state["id"])
    recheck, recheck_complete, recheck_notes = _bounded_parent_violator_recheck(
        workspace, parent_observation, scenario_inputs_by_scenario, site_profile,
        workspace / "implementations" / merge_id / "recheck", pba=(query_spec.get("precision") == "pba"),
    )

    body = {
        "designStateId": design_state["id"], "database": design_state["database"], "sta": sta_receipts,
        "recheck": recheck, "recheckComplete": recheck_complete,
    }
    if recheck_notes:
        body["recheckNotes"] = recheck_notes
    # C5: archive this exact sta.json body under the candidate's own
    # implementations/<mergeId>/ directory, so a later evaluate (or any
    # other consumer) can always recover the STA receipts a given
    # candidate was evaluated against, independent of state/sta.json's
    # current (possibly later-generation) contents.
    _canonical_write(workspace / "implementations" / merge_id / "sta.json", body)
    return _paths(workspace)["sta"], body


def _cmd_physical(workspace, args):
    """Baseline mode now runs Innovus itself; candidate mode reads reports from
    `state/implement.json` (G3).

    There is no fixed, literal `state/candidate-verify-drc.rpt`/
    `...-connectivity.rpt` path a Harness output could ever bind (each
    implementation writes its reports under its own `implementations/<mergeId>/`
    or `apr/<stage>/<taskId>/` directory) -- `mode == "candidate"` therefore
    takes only `<mode>` and resolves+re-hashes `state/implement.json`'s own
    `drcReport`/`connectivityReport` `{"path","sha256"}` refs instead
    (`implement`/`apr-run` both write that shape).

    I13 (final review, baseline physical reports): `mode == "baseline"` used
    to take two Site-authored, argv-bound `.rpt` TEXT files verbatim -- an
    administrator-composed document this Pack could never itself verify was
    produced with the same limits/template a real candidate's own
    `verify_drc -limit 1000000`/`verifyConnectivity ... -error 1000000` run
    is held to (`innovus-eco.tcl`/`apr-stage.tcl`'s own convention). This Pack
    now compiles and runs its OWN `innovus-export.tcl` task
    (`adapters.compile_innovus_export_task`) against the Campaign baseline's
    own staged database (`state/baseline.json` -- always the ORIGINAL
    baseline, per `verification.assemble`'s own docstring, never
    `state/working-state.json`, which `adopt` may since have rewritten),
    with the identical `-limit`/`-error` values `innovus-eco.tcl` uses, so a
    later `evaluate` compares the candidate's physical evidence against a
    same-methodology baseline, not an externally-supplied document of
    unknown provenance. `mode == "baseline"` now takes `<siteProfile>` in
    place of the two rpt paths.
    """
    workspace = Path(workspace)
    if len(args) == 1:
        (mode,) = args
        if mode != "candidate":
            raise InputError("invalid-input", f"a single-argument physical call must be mode 'candidate', got {mode!r}")
        implement = _read_plain(_paths(workspace)["implement"])
        drc_ref = implement.get("drcReport")
        connectivity_ref = implement.get("connectivityReport")
        if not drc_ref or not connectivity_ref:
            raise InputError("invalid-input", "state/implement.json is missing drcReport/connectivityReport")
        drc_path = workspace / drc_ref["path"]
        connectivity_path = workspace / connectivity_ref["path"]
        if core.file_sha256(drc_path) != drc_ref.get("sha256"):
            raise core.AtcsError("identity-mismatch", f"drc report sha256 mismatch at {drc_path}")
        if core.file_sha256(connectivity_path) != connectivity_ref.get("sha256"):
            raise core.AtcsError("identity-mismatch", f"connectivity report sha256 mismatch at {connectivity_path}")
    else:
        site_profile_path, mode = args
        if mode != "baseline":
            raise InputError("invalid-input", f"a two-argument physical call must be mode 'baseline', got {mode!r}")
        site_profile = _read_plain(site_profile_path)
        baseline = _read_declared(_paths(workspace)["baseline"], "design-state")
        current_db_path = workspace / baseline["database"]["path"]
        if core.file_sha256(current_db_path) != baseline["database"]["sha256"]:
            raise core.AtcsError(
                "identity-mismatch", f"baseline database at {current_db_path} no longer matches state/baseline.json"
            )
        output_root = workspace / "baseline" / "physical"
        export_task = adapters.compile_innovus_export_task(str(current_db_path), baseline["top"], str(output_root))
        tcl_path = output_root / "innovus-export.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(export_task["tcl"], encoding="utf-8")
        log_path = output_root / "innovus-export.log"
        adapters.run_tool(
            site_profile,
            export_task["command"] + [str(tcl_path), "-log", str(log_path), "-overwrite", "-64", "-nowin"],
            cwd=output_root, log_path=log_path,
        )
        # Only the DRC/connectivity reports are consumed here (this mode's whole job);
        # `compile_innovus_export_task` also names `def`/`netlist` outputs, but nothing
        # this mode returns needs them, so their existence is not required.
        for name in ("drc", "connectivity"):
            path = export_task["outputs"][name]
            if not Path(path).is_file():
                raise adapters.AdapterToolError(f"expected baseline physical output missing: {name}={path}", log_path)
        drc_path = export_task["outputs"]["drc"]
        connectivity_path = export_task["outputs"]["connectivity"]
    drc_text = _read_text(drc_path)
    connectivity_text = _read_text(connectivity_path)
    body = {"drc": drc_text, "connectivity": connectivity_text}
    key = "baseline_physical" if mode == "baseline" else "physical"
    return _paths(workspace)[key], body


def _find_prior_observation_for_state(workspace, target_state_id):
    """The persisted `observation-set` whose own `designStateId` equals `target_state_id`,
    or `None` when nothing on disk was ever captured for that exact state id (C5, final
    review: `evaluate` must never diff a candidate's STA against a differently-labeled
    generation's observation just because it happens to be the current `state/
    observation.json`).

    Checked in order: the current `state/observation.json`, then `state/
    observation-prev.json` (G19's one-step-back copy), then every immutable
    original `observe` itself wrote at `observations/<id>.json` (also G19) --
    whichever exists and actually carries this exact `designStateId`. A
    document that fails schema/id verification is skipped (never raises):
    an unrelated or corrupt file under `observations/` must not abort
    `evaluate`, only fail to count as a match.
    """
    if not target_state_id:
        return None
    workspace = Path(workspace)
    candidates = []
    for key in ("observation", "observation_prev"):
        path = _paths(workspace)[key]
        if path.is_file():
            candidates.append(path)
    observations_dir = workspace / "observations"
    if observations_dir.is_dir():
        candidates.extend(sorted(observations_dir.glob("*.json")))
    for path in candidates:
        try:
            doc = _read_declared(path, "observation-set")
        except InputError:
            continue
        if doc.get("designStateId") == target_state_id:
            return doc
    return None


def _baseline_unconstrained_counts(workspace):
    """I6 (final review, unconstrained coverage): each required scenario's own
    `unconstrained`-endpoint Measure from the Campaign BASELINE's own observation --
    never an intermediate parent's, so a candidate several generations deep is always
    judged against the true Campaign starting point, the same "never a per-candidate
    parent snapshot" rule `verification`'s own module docstring already states for
    `baseline_physical`.

    `state/baseline.json` is written exactly once, by `_cmd_baseline`, and is never
    rewritten by `adopt` (unlike `state/working-state.json`) -- its own `id` therefore
    always names the Campaign's real starting design-state. Returns `{}` (never
    `None`) when that baseline state or its own observation cannot be located, so
    `verification.assemble` fails closed on every required scenario's own comparison
    rather than silently skipping the check the way passing `None` itself would (see
    `verification._unconstrained_regressions`'s own docstring for that distinction).
    """
    baseline_path = _paths(workspace)["baseline"]
    if not baseline_path.is_file():
        return {}
    try:
        baseline_state = _read_declared(baseline_path, "design-state")
    except InputError:
        return {}
    baseline_observation = _find_prior_observation_for_state(workspace, baseline_state.get("id"))
    if baseline_observation is None:
        return {}
    scenarios = baseline_observation.get("scenarios", {}) or {}
    return {
        scenario: entry.get("unconstrained")
        for scenario, entry in scenarios.items()
        if isinstance(entry, dict) and "unconstrained" in entry
    }


def _cmd_evaluate(workspace, args):
    """`policy` is now the stamped `state/policy.json` `_cmd_policy` writes (G4).

    C5 (final review): the prior observation `verification.assemble` diffs
    the candidate's fresh STA against is looked up by id
    (`_find_prior_observation_for_state`, keyed on the merge commit's own
    `parentStateId`) rather than blindly reading whatever `state/
    observation.json` currently holds -- which, after a second
    implementation round with no fresh `observe` in between, may still be
    labeled with an *earlier* generation's state id, not this candidate's
    actual parent. When no persisted observation actually matches, `None`
    is passed through to `assemble`, which reports the comparison as
    `unknown` rather than silently diffing against the wrong generation.
    """
    (policy_path,) = args
    workspace = Path(workspace)
    policy = _read_declared(policy_path, "policy")
    sta = _read_plain(_paths(workspace)["sta"])
    implement = _read_plain(_paths(workspace)["implement"])
    merge_commit = _load_merge_commit_like(workspace, implement)
    extract = _read_plain(_paths(workspace)["extract"])
    physical = _read_plain(_paths(workspace)["physical"])
    baseline_physical = _read_plain(_paths(workspace)["baseline_physical"])

    plan = verification.plan_checks(merge_commit, policy)
    prior_observation = _find_prior_observation_for_state(workspace, plan.get("parentStateId"))
    receipts = {
        "designStateId": sta["designStateId"], "database": sta["database"],
        "netlist": implement["netlist"], "def": implement["def"], "spef": extract["spef"],
        "sta": sta["sta"], "physical": physical,
        # I5 (final review): `sta`'s own bounded parent-violator recheck, already
        # captured -- never a fresh query this call would have to launch itself.
        "recheck": sta.get("recheck") or {},
    }
    if not sta.get("recheckComplete", False):
        receipts["recheckIncomplete"] = True
        recheck_notes = sta.get("recheckNotes") or []
        if recheck_notes:
            receipts["recheckIncompleteReason"] = "; ".join(recheck_notes)
    # I6 (final review): the baseline's own check_timing-derived unconstrained-endpoint
    # counts, already captured by observe-baseline -- never a fresh query this call
    # would have to launch itself.
    baseline_unconstrained = _baseline_unconstrained_counts(workspace)
    body = verification.assemble(plan, receipts, prior_observation, baseline_physical, baseline_unconstrained)
    return _paths(workspace)["evaluation"], body


def _cmd_adopt(workspace, args):
    """Publish `evaluation` and return the `{acceptanceRecord, refreshLedger}` envelope.

    T13 fix-round interface (per the controller's message): the declared
    output is no longer the bare `acceptance-record` artifact but an
    envelope naming, by workspace-relative path, the acceptance-record this
    call just sealed (canonical store: `accepted/<id>.json`) and the
    refresh ledger `sta` maintains (`state/refresh-ledger.json`) -- both
    paths, never embedded content, so a Reader loads and independently
    schema/id-verifies each companion itself.

    G1/G4/G7: `expected_base` comes from `state/working-state.json`'s own
    `id`, not a literal argv id; `policy` is the stamped `state/policy.json`.
    Whenever `adoption.publish`'s own `decision` is not `"refused"` -- i.e.
    the `working` pointer really did move (`adoption.py`'s own docstring:
    every refusal path returns `"refused"` instead) -- `state/working-state.json`
    is rewritten with the adopted candidate's own design-state, copied
    verbatim from the immutable `implementations/<candidateId>/design-state.json`
    `sta` already wrote, and re-verified (schema + digest) on the way in.

    I9 (final review, adopt consistency): when the working pointer moved but
    that copy cannot actually be completed -- `pointersAfter.working` names
    no `candidateId` at all, or `implementations/<candidateId>/design-state.json`
    does not exist -- this raises `AtcsError("adopt-inconsistent", ...)`
    (exit 3) rather than silently leaving `state/working-state.json` behind
    the pointers document it is supposed to mirror. `adoption.publish` has,
    by this point, already durably recorded the pointer move (`pointers.json`
    and this call's own `accepted/<id>.json`); this refusal at least surfaces
    the resulting inconsistency loudly instead of letting every later
    subcommand silently re-base on a stale `working-state.json`.
    """
    (policy_path,) = args
    workspace = Path(workspace)
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    evaluation = _read_declared(_paths(workspace)["evaluation"], "evaluation")
    policy = _read_declared(policy_path, "policy")
    record = adoption.publish(evaluation, working_state["id"], str(_paths(workspace)["pointers"]), policy)
    acceptance_record_path = workspace / "accepted" / f"{record['id']}.json"
    _canonical_write(acceptance_record_path, record)

    if record.get("decision") != "refused":
        working_pointer = (record.get("pointersAfter") or {}).get("working") or {}
        candidate_id = working_pointer.get("candidateId")
        if not candidate_id:
            raise core.AtcsError(
                "adopt-inconsistent",
                "the working pointer moved but pointersAfter.working names no candidateId -- "
                "state/working-state.json cannot be advanced to match",
            )
        candidate_id = adapters.validate_path_segment(candidate_id, "pointersAfter.working.candidateId")
        candidate_state_path = workspace / "implementations" / candidate_id / "design-state.json"
        if not candidate_state_path.is_file():
            raise core.AtcsError(
                "adopt-inconsistent",
                f"the working pointer moved to candidate {candidate_id!r} but {candidate_state_path} "
                "does not exist -- state/working-state.json cannot be advanced to match",
            )
        candidate_design_state = _read_declared(candidate_state_path, "design-state")
        _canonical_write(_paths(workspace)["working_state"], candidate_design_state)

    envelope = {
        "acceptanceRecord": _relpath(acceptance_record_path, workspace),
        "refreshLedger": _relpath(_paths(workspace)["refresh_ledger"], workspace),
    }
    return _paths(workspace)["accepted"], envelope


RESIDUAL_QUERY_BOUND = 20


def _unknown_evidence(reason):
    """`{field: unknown(reason)}` for every `residual.EVIDENCE_FIELDS` -- a whole check's
    evidence when its targeted PT query or report parse could not be completed at all."""
    return {field: core.unknown(reason) for field in residual_module.EVIDENCE_FIELDS}


def _failing_checks_from_observation(observation):
    """Check keys with a known, negative `slack` in `observation["checks"]` (Task 12c item 1b).

    Used only when `state/evaluation.json` does not exist yet -- there is no
    real `check-comparison` to draw `remaining` from, so "remaining failing
    checks" is instead read directly off the current observation itself: a
    check whose slack is not known is a coverage gap, not a confirmed
    failure, and is excluded (the same rule `atcs.residual.extract` applies
    to `evaluation.comparison.remaining` entries with unknown current
    slack).
    """
    checks = observation.get("checks", {}) or {}
    failing = []
    for key, entry in checks.items():
        slack = entry.get("slack") if isinstance(entry, dict) else None
        if core.is_known(slack) and core.value_of(slack) < 0:
            failing.append(key)
    return sorted(failing)


def _bounded_remaining_checks(observation, remaining_keys, limit):
    """The `limit` worst (most negative known slack) entries of `remaining_keys`.

    A `remaining` key whose current slack is not known contributes no
    residual case anyway (`atcs.residual.extract`'s own coverage rule), so
    it is simply never selected here -- this bound only ever trims which of
    the *confirmed*-failing checks get a PT query, never which ones
    `residual.extract` itself considers.
    """
    checks = observation.get("checks", {}) or {}
    scored = []
    for key in remaining_keys:
        entry = checks.get(key)
        slack = entry.get("slack") if isinstance(entry, dict) else None
        if core.is_known(slack):
            scored.append((core.value_of(slack), key))
    scored.sort(key=lambda pair: pair[0])
    return [key for _, key in scored[:limit]]


def _collect_residual_evidence(workspace, working_state, scenarios_contract, site_profile, observation, remaining_keys):
    """Populate `observation["checkDetails"]` for up to `RESIDUAL_QUERY_BOUND` remaining
    failing checks (Task 12c item 1a) -- the earlier-APR route needs
    `residual-case.evidence` to actually be populated, or
    `lifecycle.compile_intervention` can never compile a real intervention.

    Groups the bounded, worst-slack checks by scenario (parsed from each
    check key's own `"<scenario>|<mode>|<endpoint>"` structure), compiles
    and runs one `pt-query.tcl` task per scenario (`adapters.
    compile_pt_query_task`) against the *working* design-state's own
    recorded netlist/SDC/SPEF (`_scenario_pt_inputs`, re-verified by
    sha256 -- never a model-supplied path, matching `_cmd_observe`'s own
    item-3 fix), and parses each target's own report with `adapters.
    parse_path_detail`. A check whose query or parse could not be
    completed -- a missing/unsafe startpoint, a scenario input that failed
    identity verification, a PT run failure, or a missing report -- is left
    `unknown` with a reason (`_unknown_evidence`), never guessed; that
    reason is also folded into the returned `notes` list, a side field of
    `state/residual-cases.json` (`queryNotes`), not part of
    `atcs.residual`'s own artifact shape.

    N4 (final fix batch C): each check key's own `mode` is carried into its
    `pt-query.tcl` target, exactly like `_bounded_parent_violator_recheck`'s
    own recheck queries -- a hold check must never be queried with PT's own
    `-delay_type` default (a setup check's own delay arc). The query runs at
    `observation`'s own `precision` (the same precision that observation's
    checks were themselves captured at).

    Returns `(check_details, notes)`.
    """
    pba = observation.get("precision") == "pba"
    checks = observation.get("checks", {}) or {}
    bounded_keys = _bounded_remaining_checks(observation, remaining_keys, RESIDUAL_QUERY_BOUND)
    check_details = {}
    notes = []
    if not bounded_keys:
        return check_details, notes

    by_scenario = {}
    for key in bounded_keys:
        parts = key.split("|", 2)
        if len(parts) != 3:
            reason = f"{key}: malformed check key"
            notes.append(reason)
            check_details[key] = _unknown_evidence(reason)
            continue
        scenario, mode, key_endpoint = parts
        entry = checks.get(key) or {}
        startpoint = entry.get("startpoint")
        if not isinstance(startpoint, str) or not startpoint:
            reason = f"{key}: no startpoint recorded in observation"
            notes.append(reason)
            check_details[key] = _unknown_evidence(reason)
            continue
        if mode not in ("setup", "hold"):
            reason = f"{key}: unrecognized mode {mode!r}"
            notes.append(reason)
            check_details[key] = _unknown_evidence(reason)
            continue
        # The check key's own third component may itself carry a
        # "@<path group>" suffix (atcs.reports.parse_path_report, a reserved PT
        # path group such as **async_default**) -- never a real PT pin name -- so
        # the entry's own recorded literal endpoint (`"endpoint"`, PT's own
        # pin name) is used for the actual query whenever present, falling
        # back to the check key's own component only for an older-shaped
        # entry that never recorded one.
        endpoint = entry.get("endpoint") if isinstance(entry.get("endpoint"), str) else key_endpoint
        by_scenario.setdefault(scenario, []).append(
            {"checkKey": key, "startpoint": startpoint, "endpoint": endpoint, "mode": mode}
        )

    # I12 (final review): one fresh, write-once generation directory for this whole
    # call (every scenario queried below shares it) -- a later `residual` call (the
    # "at every evaluation" cadence FABRIC.md G18 already describes) must never
    # silently overwrite this generation's own raw PT reports. Computed only once
    # `by_scenario` is known non-empty, so a call with nothing to query still creates
    # no directory at all (unchanged from before).
    residual_generation_root = (
        _next_evidence_generation_dir(workspace / "research" / "residual") if by_scenario else None
    )

    for scenario, targets in sorted(by_scenario.items()):
        try:
            inputs = _scenario_pt_inputs(workspace, working_state, scenarios_contract, scenario)
            report_root = residual_generation_root / scenario
            task = adapters.compile_pt_query_task(inputs, str(report_root), targets, pba=pba)
        except (InputError, core.AtcsError) as exc:
            reason = f"{scenario}: {exc.detail}"
            notes.append(reason)
            for target in targets:
                check_details[target["checkKey"]] = _unknown_evidence(reason)
            continue

        tcl_path = report_root / "pt-query.tcl"
        tcl_path.parent.mkdir(parents=True, exist_ok=True)
        tcl_path.write_text(task["tcl"], encoding="utf-8")
        log_path = report_root / "pt.log"
        try:
            adapters.run_tool(site_profile, ["pt_shell", "-f", str(tcl_path)], cwd=report_root, log_path=log_path)
        except adapters.AdapterToolError as exc:
            reason = f"{scenario}: pt-query failed: {exc.detail}"
            notes.append(reason)
            for target in targets:
                check_details[target["checkKey"]] = _unknown_evidence(reason)
            continue

        for target in targets:
            report_path = Path(task["reports"][target["checkKey"]])
            if not report_path.is_file():
                reason = f"{target['checkKey']}: pt-query produced no report at {report_path}"
                notes.append(reason)
                check_details[target["checkKey"]] = _unknown_evidence(reason)
                continue
            check_details[target["checkKey"]] = adapters.parse_path_detail(report_path.read_text(encoding="utf-8"))

    return check_details, notes


def _residual_candidate_state(workspace, evaluation):
    """The EVALUATED candidate's own design-state -- never `state/working-state.json`,
    which may still be the PARENT state for a refused (non-adopted) candidate, since
    `adopt` only ever rewrites it when the `working` pointer actually moves (Fix round 2
    item 1, Important).

    `sta` writes this exact file at `implementations/<mergeCommitId>/design-state.json`
    (`_cmd_sta`) and stamps that same design-state's own `id` into `evaluation["stateId"]`
    (`verification.assemble`'s own `receipts["designStateId"]` passthrough). This reads
    `state/implement.json`'s own `mergeCommitId` to find the file (the "verified entry
    files" this candidate's own pipeline already wrote), then confirms the loaded state's
    `id` actually equals `evaluation["stateId"]` before trusting it -- a candidate whose
    own state cannot be located this way is never silently approximated by a different
    state.

    Returns `(design_state, None)` on success, or `(None, reason)` when the candidate's
    own state cannot be located or verified; the caller then leaves every queried check's
    evidence `unknown` with that `reason`, never falling back to a different (and wrong)
    state.
    """
    candidate_state_id = evaluation.get("stateId")
    implement = _read_json_or_default(_paths(workspace)["implement"], {})
    merge_id = implement.get("mergeCommitId")
    if not candidate_state_id or not merge_id:
        return None, "evaluated candidate's own stateId/mergeCommitId is not recorded"
    try:
        merge_id_segment = adapters.validate_path_segment(merge_id, "implement.mergeCommitId")
    except core.AtcsError as exc:
        return None, f"invalid mergeCommitId: {exc.detail}"
    design_state_path = workspace / "implementations" / merge_id_segment / "design-state.json"
    try:
        candidate_state = _read_declared(design_state_path, "design-state")
    except InputError as exc:
        return None, f"candidate design-state at {design_state_path} could not be read: {exc.detail}"
    if candidate_state.get("id") != candidate_state_id:
        return None, (
            f"candidate design-state at {design_state_path} has id {candidate_state.get('id')!r}, "
            f"expected evaluation.stateId {candidate_state_id!r}"
        )
    return candidate_state, None


def _cmd_residual(workspace, args):
    """Fill residual evidence via a bounded, evaluated-candidate-scoped PT query, then extract residual cases.

    Task 12c item 1a: for up to `RESIDUAL_QUERY_BOUND` of the evaluated
    candidate's still-`remaining` failing checks (see
    `_collect_residual_evidence`), this compiles and runs the targeted
    `pt-query.tcl` path-detail query through the PT wrapper (`site_profile`
    -- the same Site-fixed `siteCapabilities`/`siteProfile` document every
    other PT-launching subcommand takes) and passes the resulting
    `observation["checkDetails"]` to `residual.extract` -- previously this
    field was never populated at all, so every evidence field was always
    `unknown` and `lifecycle.compile_intervention` could never compile a
    real setting.

    Item 1b: when `state/evaluation.json` does not exist yet (no candidate
    has ever been implemented and evaluated for this campaign), the
    "remaining failing checks" are instead derived directly from
    `state/observation.json` -- every check whose own `slack` Measure is
    known and negative (`_failing_checks_from_observation`) -- wrapped in
    the minimal `{"comparison": {"remaining": [...]}}` shape
    `residual.extract` itself needs (it only ever reads `evaluation
    ["comparison"]["remaining"]`). This lets the earlier-APR route be
    chosen straight from the baseline (SPEC Constraint 3), before any
    Compose/Implement cycle has ever run. This case's own PT queries run
    against `state/working-state.json` (the baseline itself, since no
    candidate has displaced it yet).

    Fix round 2 item 1: once an evaluation DOES exist, the queries instead
    run against the EVALUATED candidate's own design-state
    (`_residual_candidate_state`) -- never `state/working-state.json`,
    which is still the *parent* state for a refused (non-adopted)
    candidate. When that candidate state cannot be located/verified, every
    bounded check's evidence is `unknown` with the reason (never a
    fall-back to the wrong state).

    Item 1c is unchanged: if, after (a), no residual case yields a single
    setting, `lifecycle.compile_intervention` (called by `apr-prepare`)
    still raises `AtcsError("no-intervention")` (exit 3) -- this subcommand
    never manufactures a setting to avoid that refusal.

    N1 (final fix batch C): `evaluation.comparison.remaining` is `None`
    (never a present-but-empty `[]`) when `evaluate` had no prior observation
    to diff against (`verification.assemble`'s own "no prior" case). This is
    "unknown", never "nothing is failing": rather than crash `residual.
    extract`'s own `for key in remaining_keys` on a bare `None`, this falls
    back to deriving "remaining failing checks" directly from the candidate's
    own combined observation -- the exact rule `_failing_checks_from_
    observation` already applies below when no evaluation exists at all.
    """
    scenarios_path, site_profile_path = args
    workspace = Path(workspace)
    scenarios_contract = _load_scenarios_contract(scenarios_path)
    site_profile = _read_plain(site_profile_path)
    readiness = _read_declared(_paths(workspace)["readiness"], "input-readiness")
    exp = _read_json_or_default(_paths(workspace)["experience"], {"schema": "atcs.experience/1", "entries": []})

    evaluation_path = _paths(workspace)["evaluation"]
    if evaluation_path.is_file():
        evaluation = _read_declared(evaluation_path, "evaluation")
        sta = _read_plain(_paths(workspace)["sta"])
        combined_checks, combined_scenarios, sources = {}, {}, []
        precision = None
        for entry in sta.get("sta", {}).values():
            observation_entry = entry.get("observation", {})
            combined_checks.update(observation_entry.get("checks", {}))
            combined_scenarios.update(observation_entry.get("scenarios", {}))
            sources.extend(observation_entry.get("sources", []))
            if precision is None:
                precision = observation_entry.get("precision")
        base_observation = {
            "designStateId": sta.get("designStateId"), "precision": precision,
            "scenarios": combined_scenarios, "checks": combined_checks,
            "missingScenarios": [], "coverage": {"complete": True, "reasons": []}, "sources": sources,
        }
        remaining_keys = evaluation.get("comparison", {}).get("remaining")
        if remaining_keys is None:
            # N1 (final fix batch C): `comparison.remaining` is `None` when `evaluate`
            # had no prior observation to diff against (`verification.assemble`'s own
            # "no prior" case, which reports every comparison list as `None` -- never a
            # present-but-empty `[]` -- see that module's own docstring). This is
            # "unknown", never "nothing is failing": fall back to deriving "remaining
            # failing checks" directly from the candidate's own combined observation
            # (the exact rule `_failing_checks_from_observation` already applies below
            # when no evaluation exists at all) instead of crashing `residual.extract`'s
            # own `for key in remaining_keys` on a bare `None`, or silently treating the
            # unknown comparison as "zero residual cases".
            remaining_keys = _failing_checks_from_observation(base_observation)
            evaluation = dict(evaluation)
            evaluation["comparison"] = dict(evaluation.get("comparison") or {})
            evaluation["comparison"]["remaining"] = remaining_keys
        pt_state, pt_state_failure = _residual_candidate_state(workspace, evaluation)
    else:
        base_observation = _read_declared(_paths(workspace)["observation"], "observation-set")
        remaining_keys = _failing_checks_from_observation(base_observation)
        evaluation = {"comparison": {"remaining": remaining_keys}}
        pt_state = _read_declared(_paths(workspace)["working_state"], "design-state")
        pt_state_failure = None

    if pt_state is not None:
        check_details, notes = _collect_residual_evidence(
            workspace, pt_state, scenarios_contract, site_profile, base_observation, remaining_keys,
        )
    else:
        bounded_keys = _bounded_remaining_checks(base_observation, remaining_keys, RESIDUAL_QUERY_BOUND)
        check_details = {key: _unknown_evidence(pt_state_failure) for key in bounded_keys}
        notes = [pt_state_failure] if bounded_keys else []

    observation_for_extract = dict(base_observation)
    observation_for_extract["checkDetails"] = check_details

    batch_fail_reasons = _evaluated_batch_fail_reasons(workspace) if evaluation_path.is_file() else None
    cases = residual_module.extract(evaluation, observation_for_extract, exp, readiness,
                                    fail_reasons=batch_fail_reasons)
    body = {"cases": cases, "queryNotes": notes}
    if batch_fail_reasons is not None:
        body["batchFailReasons"] = batch_fail_reasons
    return _paths(workspace)["residual_cases"], body


def _evaluated_batch_fail_reasons(workspace):
    """The evaluated recipe batch's sealed post-auto-finish fail reasons, or None.

    Read from `state/merge-commit.json` only when it is the candidate `state/implement.json`
    names; ``{mergeCommitId, arm, setup?, hold?}``.
    """
    implement = _read_json_or_default(_paths(workspace)["implement"], {})
    path = _paths(workspace)["merge_commit"]
    if not implement.get("mergeCommitId") or not path.is_file():
        return None
    merge_commit = _read_declared(path, "merge-commit")
    reasons = merge_commit.get("failReasons")
    if merge_commit.get("id") != implement["mergeCommitId"] or not isinstance(reasons, dict):
        return None
    return {"mergeCommitId": merge_commit["id"], **reasons}


def _cmd_apr_prepare(workspace, args):
    """Compile a bounded APR stage intervention/task (full-flow only, via `lifecycle`).

    Fix round 1 (Task 14 G1): `stage` is no longer an argv value -- it comes
    from `state/apr-task.json`'s own producer, the next-investment
    Workshop's `next-decision` document, at its fixed contract path
    (`NEXT_DECISION_REL_PATH`). `next-decision` is a Workshop-authored
    request, never a `core.stamp`-ed artifact (see
    `.superpowers/sdd/global-context.md`'s "Shared data model" row for it,
    and `tools/read-atcs.py`'s own `_read_next_decision`, which likewise
    never digest-checks it, only structurally validates it) -- this
    dispatcher applies the same two structural checks the Reader's own
    `_collect_next_decision_problems` would report as a Judge-visible
    problem count: `action` must be `"earlier-apr"` and `stage` must be one
    of `APR_STAGES`. Either failing is `InputError("invalid-input", ...)`
    (exit 2) -- a malformed/mismatched declared input, not a module refusal.

    Adds a `taskId` field (recomputed identically to `lifecycle.stage_task`'s
    own internal digest via the shared `lifecycle.task_id_for` helper -- the
    same value baked into `task["outputs"]`' own `apr/<stage>/<id>/` paths)
    and the resolved `stage` itself onto the returned body: `apr-run` (G24)
    needs both -- the stable id to build the output directory it will run
    the stage task in and stamp as the resulting candidate's own
    `mergeCommitId`, and `stage` because it no longer takes that as an argv
    value either -- `lifecycle.stage_task` itself returns only
    `{"tcl","inputs","outputs"}` (M11's own module docstring: neither shape
    is a stamped artifact), so both are computed/carried here rather than by
    changing that module's public return shape. Declared output is now the
    single fixed `state/apr-task.json` (never `apr/<stage>/task.json`, which
    cannot be one fixed literal path across four possible stages).

    C2 (final review): `parent_state_id` (`state/working-state.json`'s own
    current `id`) is threaded into both `lifecycle.stage_task` and this
    call's own `taskId` recomputation, so a stage compiled against one
    working state can never collide (on id, hence on output directory) with
    the same intervention compiled again later against a DIFFERENT working
    state -- see `lifecycle.task_id_for`'s own docstring.
    """
    del args
    workspace = Path(workspace)
    next_decision = _read_plain(workspace / NEXT_DECISION_REL_PATH)
    action = next_decision.get("action")
    if action != "earlier-apr":
        raise InputError(
            "invalid-input", f"next-decision action must be 'earlier-apr' for apr-prepare, got {action!r}"
        )
    stage = next_decision.get("stage")
    if stage not in APR_STAGES:
        raise InputError("invalid-input", f"next-decision stage must be one of {APR_STAGES}, got {stage!r}")
    adapters.validate_path_segment(stage, "stage")  # whitelisted above; validated too, for defense in depth

    residual_doc = _read_plain(_paths(workspace)["residual_cases"])
    readiness = _read_declared(_paths(workspace)["readiness"], "input-readiness")
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    intervention = lifecycle.compile_intervention(residual_doc.get("cases", []), stage, readiness)
    task = lifecycle.stage_task(
        stage, readiness, intervention, ".", working_state["top"], parent_state_id=working_state["id"],
    )
    task_id = lifecycle.task_id_for(
        stage, intervention["hookTcl"], intervention["readbackTcl"], parent_state_id=working_state["id"],
    )
    body = dict(task)
    body["taskId"] = task_id
    body["stage"] = stage
    return _paths(workspace)["apr_task"], body


def _parent_min_wns(workspace, state_id):
    """`min(setup, hold)` WNS recorded for design-state `state_id`, or `unknown`.

    Fix round 1 (item 2): `predicted`/`measured` are deltas against the
    *parent* state's own min WNS, so that parent's own generation must be
    looked up by id -- this Pack keeps no per-generation observation
    archive, so the lookup is against whichever fixed state file actually
    recorded that id's min WNS at the moment it became significant:
    `state/policy.json`'s own `baselineStateId`/`baselineMinWns` (verified
    via `_read_declared`) when `state_id` is the Campaign's declared
    baseline, else `state/pointers.json`'s own pointer values (`working`/
    `best`/`delivery`, current or historical via `history`'s `previous`/
    `new` entries -- `adoption.publish` stamps every one of these with
    `minWns` at accept time; `pointers.json` itself is verified via
    `_read_declared`). Absent from both, or `state_id` falsy, -> `unknown`
    with a reason naming why -- never fabricated.
    """
    if not state_id:
        return core.unknown("no parent state id recorded")
    policy_path = _paths(workspace)["policy"]
    if policy_path.is_file():
        policy = _read_declared(policy_path, "policy")
        if policy.get("baselineStateId") == state_id:
            value = policy.get("baselineMinWns")
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return core.known(value)
    pointers_path = _paths(workspace)["pointers"]
    if pointers_path.is_file():
        pointers = _read_declared(pointers_path, "pointers")
        candidates = [pointers.get(key) for key in ("working", "best", "delivery")]
        for entry in pointers.get("history") or []:
            candidates.append(entry.get("previous"))
            candidates.append(entry.get("new"))
        for value in candidates:
            if isinstance(value, dict) and value.get("stateId") == state_id:
                min_wns = value.get("minWns")
                if isinstance(min_wns, (int, float)) and not isinstance(min_wns, bool):
                    return core.known(min_wns)
    return core.unknown(f"no recorded min WNS for parent state {state_id!r}")


def _selected_predicted_min_wns(collected, merge_commit):
    """Best known predicted `min(setup, hold)` WNS among the candidate's own
    *selected* contributions (`merge_commit["contributions"]` -- absent/empty
    for an `apr-run` candidate, which has none, per `_load_merge_commit_like`),
    plus which validation level ("xtop"/"presta") it came from ("unknown" if
    mixed across contributions, or absent).

    Each contribution's own already-computed `validationLevel`
    (`contributions._predicted_measures`'s own presta-over-xtop precedence)
    decides which pair of predicted keys that one contribution contributes
    from -- this function never re-derives that precedence itself.
    """
    choice = merge_commit.get("choice") if isinstance(merge_commit.get("choice"), dict) else None
    if choice is not None:
        # Issue #64 Task 6: a recipe batch's prediction is its chosen arm's own XTop summary.
        prediction = ((merge_commit.get("arms") or {}).get(choice.get("arm")) or {}).get("prediction") or {}
        if "unknown" in prediction:
            return core.unknown(f"chosen {choice.get('arm')} arm prediction unknown: {prediction['unknown']}"), "unknown"
        values = [prediction.get(key) for key in ("worstSetupWns", "worstHoldWns")]
        if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in values):
            return core.known(min(values)), "xtop"
        return core.unknown(f"chosen {choice.get('arm')} arm has no worst setup/hold prediction"), "unknown"
    selected_ids = {entry.get("id") for entry in (merge_commit.get("contributions") or [])}
    contributions_by_id = {c.get("id"): c for c in collected.get("contributions", [])}
    per_contribution = []
    for contribution_id in selected_ids:
        contribution = contributions_by_id.get(contribution_id)
        if not contribution or contribution.get("kind") != "fix" or not contribution.get("admissible"):
            continue
        validation_level = contribution.get("validationLevel")
        if validation_level == "presta":
            keys = ("prestaSetupWns", "prestaHoldWns")
        elif validation_level == "xtop":
            keys = ("xtopSetupWns", "xtopHoldWns")
        else:
            continue
        predicted = contribution.get("predicted", {})
        values = [core.value_of(predicted[key]) for key in keys if core.is_known(predicted.get(key))]
        if values:
            per_contribution.append((min(values), validation_level))
    if not per_contribution:
        return core.unknown("no selected contribution reported a predicted WNS"), "unknown"
    best_value = min(value for value, _ in per_contribution)
    models = {model for _, model in per_contribution}
    return core.known(best_value), (models.pop() if len(models) == 1 else "unknown")


def _cmd_record_experience(workspace, args):
    """Compose lineage/decision/outcome from state files -- no `research/requests/experience-*` inputs (G5).

    Fix round 1 (item 4, Task 14 G2) + Task 12c item 5: `<reasonSource>` is
    read only when `implement`'s own candidate id is actually a real
    Integration Fix Session merge commit's id (`_merge_commit_provenance`
    == `"merge"`) -- decided by comparing ids, never by whether
    `state/merge-commit.json` merely happens to exist on disk (a stale copy
    from an earlier batch persists across a later `apr-run` candidate,
    since `apr-run` never deletes it). Otherwise (provenance `"apr"`) the
    reason comes instead from the next-investment Workshop's own
    `next-decision`, at its fixed contract path (`NEXT_DECISION_REL_PATH`),
    never a stale integration plan. `<reasonSource>` is now the SAME
    integration-plan envelope file `replay-prepare`/`compose-facts` read
    (Task 12c item 4b: `{"plan": {..., "reason": ...}, "facts": {...}}` --
    see `_read_admitted_plan`) -- this dispatcher unwraps `envelope["plan"]`
    itself rather than calling `_read_admitted_plan` (which additionally
    tolerates a missing file for the compose-facts first-pass case that
    does not apply here: a real merge batch always has an admitted plan by
    the time it reaches `record-experience`). Either way the reason
    document's own `reason` field must be a non-empty string, or this
    refuses (`InputError("missing-input", ...)`, exit 2) rather than ever
    writing a blank hypothesis (item 1).

    `decisionId` is the accepted candidate's own resulting design-state id
    (`evaluation["stateId"]`) -- unique per accepted candidate, so a replay
    of the same accepted evaluation can never silently re-record. `action`
    is `state/implement.json`'s own `mergeCommitId` (the merge commit, or
    the APR task id for an `apr-run` candidate). `conditions.precision`
    comes from any scenario in `state/sta.json`; if none carries one, this
    refuses (`InputError("missing-input", ...)`, exit 2) rather than ever
    recording `null` (item 1). `conditions.predictionModel` is
    `_selected_predicted_min_wns`'s own model ("xtop"/"presta"/"unknown").

    `predicted`/`measured` are now **deltas against the parent state's own
    min(setup, hold) WNS** (`_parent_min_wns`, item 2 -- a controller
    decision on the risk that an absolute WNS pair cannot itself express
    "helped"/"hurt"/"neutral" the way `experience._verdict` interprets
    `measured`'s sign): `measured` = the candidate's own final
    `min(finalSetupWns, finalHoldWns)` minus the parent's min WNS;
    `predicted` = `_selected_predicted_min_wns`'s own best known value minus
    that *same* parent min WNS. Any missing input on either side of either
    subtraction -> that whole Measure `unknown`, naming every contributing
    reason -- never a delta computed from a partially-known pair.
    """
    (reason_source_path,) = args
    workspace = Path(workspace)
    implement = _read_plain(_paths(workspace)["implement"])
    provenance = _merge_commit_provenance(workspace, implement)
    if provenance == "merge":
        envelope = _read_plain(reason_source_path)
        plan_raw = envelope.get("plan") if isinstance(envelope, dict) else None
        reason_doc = plan_raw if isinstance(plan_raw, dict) else {}
        # Minor (final review): `<reasonSource>` used to be trusted as "the plan this
        # merge commit was sealed from" purely by convention -- nothing actually
        # verified that. `state/replay-request.json` is the one artifact this exact
        # candidate's own seal_batch call was built from (`_cmd_replay_prepare`'s
        # declared output, `request.batchId` a direct passthrough of `plan.batchId`);
        # a `reasonSource` naming a different batch (a stale envelope still sitting on
        # disk from an earlier round) must never silently supply this candidate's
        # recorded hypothesis.
        replay_request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
        if reason_doc.get("batchId") != replay_request.get("batchId"):
            raise core.AtcsError(
                "identity-mismatch",
                f"reasonSource plan.batchId {reason_doc.get('batchId')!r} does not match "
                f"state/replay-request.json's own batchId {replay_request.get('batchId')!r} -- "
                "this is not the plan the sealed merge commit was actually produced from",
            )
    else:
        # No Integration Fix Session batch produced this candidate (an
        # apr-run candidate) -- the "why" lives in the next-investment
        # Workshop's own next-decision instead.
        reason_doc = _read_plain(workspace / NEXT_DECISION_REL_PATH)
    reason = reason_doc.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise InputError("missing-input", "reason source has no non-empty 'reason' string")
    hypothesis = reason

    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")
    evaluation = _read_declared(_paths(workspace)["evaluation"], "evaluation")
    collected = _read_json_or_default(_paths(workspace)["contributions_collected"], {"contributions": []})
    sta = _read_json_or_default(_paths(workspace)["sta"], {})
    # Fix round 1 item 3: reuse the provenance already computed above rather
    # than making `_load_merge_commit_like` re-derive it from disk again.
    merge_commit = _load_merge_commit_like(workspace, implement, provenance)

    precision = None
    for entry in sta.get("sta", {}).values():
        candidate_precision = entry.get("observation", {}).get("precision")
        if candidate_precision is not None:
            precision = candidate_precision
            break
    if precision is None:
        raise InputError("missing-input", "no scenario in state/sta.json carries a precision")

    parent_min = _parent_min_wns(workspace, implement.get("parentStateId"))

    setup_wns = evaluation.get("finalSetupWns")
    hold_wns = evaluation.get("finalHoldWns")
    if core.is_known(setup_wns) and core.is_known(hold_wns):
        candidate_min = core.known(min(core.value_of(setup_wns), core.value_of(hold_wns)))
    else:
        candidate_min = core.unknown("evaluation final WNS not fully known")

    if core.is_known(candidate_min) and core.is_known(parent_min):
        measured_measure = core.known(core.value_of(candidate_min) - core.value_of(parent_min))
    else:
        reasons = []
        if not core.is_known(candidate_min):
            reasons.append(candidate_min["unknown"])
        if not core.is_known(parent_min):
            reasons.append(parent_min["unknown"])
        measured_measure = core.unknown("; ".join(reasons))

    predicted_min, prediction_model = _selected_predicted_min_wns(collected, merge_commit)
    if core.is_known(predicted_min) and core.is_known(parent_min):
        predicted_measure = core.known(core.value_of(predicted_min) - core.value_of(parent_min))
    else:
        reasons = []
        if not core.is_known(predicted_min):
            reasons.append(predicted_min["unknown"])
        if not core.is_known(parent_min):
            reasons.append(parent_min["unknown"])
        predicted_measure = core.unknown("; ".join(reasons))

    lineage = {
        "decisionId": evaluation.get("stateId") or working_state["id"],
        "conditions": {
            "stage": working_state.get("stage"), "scenario": "*", "precision": precision,
            "toolVersion": core.canonical(working_state.get("tools", {})).decode("utf-8"),
            "predictionModel": prediction_model,
        },
    }
    decision = {"hypothesis": hypothesis, "action": implement.get("mergeCommitId"), "predicted": predicted_measure}
    outcome = {"measured": measured_measure}

    body = experience.record(str(_paths(workspace)["experience"]), lineage, decision, outcome)
    return _paths(workspace)["experience"], body


def _baseline_min_wns(observation, required_scenarios):
    """`min(setup, hold)` WNS across the policy's scenarios, or `None` if incomplete.

    Mirrors `verification.assemble`'s own fail-closed "final WNS" rule
    (module docstring step 3) at the *baseline*, before any candidate
    exists -- every required scenario must be present and carry a known
    `wns` Measure for both modes, or the whole thing is incomplete (`None`),
    never a partial minimum. The WNS is PT's global timing summary, so a path
    list capped at maxPaths (`complete.<mode>` False) does not affect it.
    """
    scenarios = observation.get("scenarios", {})
    missing = set(observation.get("missingScenarios", []))
    values = []
    for scenario in required_scenarios:
        if scenario in missing or scenario not in scenarios:
            return None
        entry = scenarios[scenario]
        for mode in ("setup", "hold"):
            wns = entry.get(mode, {}).get("wns")
            if not core.is_known(wns):
                return None
            values.append(core.value_of(wns))
    return min(values) if values else None


def _cmd_policy(workspace, args):
    """Compose the run-time acceptance policy (G4): static Site fields + Goal + campaign run-time facts.

    `<analysisContractDir>` is a fixed Site-bound directory; only its
    `policy.json`'s static fields (`allowDegradedWorking`, `degradeLimitNs`,
    `maxNewConstraintFailures`) are copied through -- a static Site document
    refusing to set any run-time or Goal field (`goal`, `baselineStateId`,
    `baselineMinWns`, `campaignRoot`) is `AtcsError("invalid-policy", ...)`,
    since letting it set its own acceptance bar/permissions is exactly what
    the SPEC forbids (M7's own guard order already refuses a `publish` whose
    policy tries to relax a check; this refuses the attempt at the source
    instead). `<targetSetupNs>`/`<targetHoldNs>` are this Pack's two Goal
    parameters (`{from: goal}`), forming `goal = {"setup", "hold"}`.
    `baselineStateId`/`baselineMinWns` are read back from the *original*
    `state/baseline.json` and its own baseline `state/observation.json`
    (never `state/working-state.json`, which `adopt` may since have
    rewritten) -- exactly the fixed anchor `adoption.publish`'s
    degraded-working gate needs for the whole campaign. `evaluate`/`adopt`
    read the result at the fixed path `state/policy.json`.

    C4 (final review, per-scenario library identity): `scenarioCorners`/
    `requiredScenarios` are now DERIVED from `<analysisContractDir>/
    scenarios.json` (`_load_scenarios_contract`/`_derive_scenario_corners`)
    -- the single source every PT-launching subcommand's corner lookup also
    reads -- instead of the static `policy.json`'s own independent copy,
    which could silently diverge from it. A static `policy.json` MAY still
    carry `scenarioCorners`/`requiredScenarios` for documentation purposes,
    but if it does, either must exactly agree with the derived value or this
    call refuses (`AtcsError("invalid-policy", ...)`) -- never silently
    prefers one over the other.
    """
    analysis_contract_dir, target_setup_raw, target_hold_raw = args
    workspace = Path(workspace)
    contract_dir = Path(analysis_contract_dir)
    static_policy = _read_plain(contract_dir / "policy.json")

    run_time_keys = ("goal", "baselineStateId", "baselineMinWns", "campaignRoot")
    forbidden = sorted(key for key in run_time_keys if key in static_policy)
    if forbidden:
        raise core.AtcsError("invalid-policy", f"static policy file may not set {forbidden}")

    scenarios_contract = _load_scenarios_contract(contract_dir / "scenarios.json")
    scenario_corners = _derive_scenario_corners(scenarios_contract)
    required_scenarios = list(scenarios_contract)
    if "scenarioCorners" in static_policy and static_policy["scenarioCorners"] != scenario_corners:
        raise core.AtcsError(
            "invalid-policy",
            "static policy.json's scenarioCorners disagrees with the one derived from scenarios.json",
        )
    if ("requiredScenarios" in static_policy
            and sorted(static_policy["requiredScenarios"]) != sorted(required_scenarios)):
        raise core.AtcsError(
            "invalid-policy",
            "static policy.json's requiredScenarios disagrees with the one derived from scenarios.json",
        )

    try:
        target_setup = float(target_setup_raw)
        target_hold = float(target_hold_raw)
    except (TypeError, ValueError):
        raise InputError("invalid-input", "targetSetupNs/targetHoldNs must be numbers")

    baseline = _read_declared(_paths(workspace)["baseline"], "design-state")
    baseline_observation = _read_declared(_paths(workspace)["observation"], "observation-set")
    if baseline_observation.get("designStateId") != baseline["id"]:
        raise core.AtcsError("stale-base", "baseline observation is not bound to the baseline design-state")
    baseline_min_wns = _baseline_min_wns(baseline_observation, required_scenarios)
    if baseline_min_wns is None:
        raise core.AtcsError(
            "missing-input", "baseline observation does not cover every required scenario's setup/hold WNS"
        )

    body = {
        "allowDegradedWorking": bool(static_policy.get("allowDegradedWorking", False)),
        "degradeLimitNs": static_policy.get("degradeLimitNs", 0.0),
        "maxNewConstraintFailures": static_policy.get("maxNewConstraintFailures", 0),
        "scenarioCorners": scenario_corners,
        "requiredScenarios": required_scenarios,
        "goal": {"setup": target_setup, "hold": target_hold},
        "baselineStateId": baseline["id"],
        "baselineMinWns": baseline_min_wns,
        "campaignRoot": str(workspace),
    }
    return _paths(workspace)["policy"], core.stamp("policy", body)


def _cmd_apr_run(workspace, args):
    """Run a prepared APR stage task through the Innovus wrapper and seal an `implement`-shaped candidate (G24).

    Fix round 1 (Task 14 G1): `stage` is no longer an argv value here either
    -- everything needed comes from the fixed `state/apr-task.json`
    `apr-prepare` already wrote (including the `taskId` it stamps and the
    `stage` it resolved from `next-decision`). Runs `task["tcl"]` -- which
    only restores the predecessor checkpoint, applies the compiled
    intervention, runs the stage command and saves `./DBS/<stage>.enc`
    under `apr/<stage>/<taskId>/` (see `flow/templates/apr-stage.tcl`,
    frozen: it never exports DEF/netlist or runs verify_drc/
    verifyConnectivity itself) -- through the Site's Innovus wrapper with
    `cwd=<workspace>` (matching `lifecycle.stage_task`'s own baked-in
    `workspace_root="."` convention), then a second, non-ECO Innovus
    export/physical-evidence batch (`adapters.compile_innovus_export_task`)
    over the stage's own freshly saved database, into the *same*
    `apr/<stage>/<taskId>/` directory.

    Writes `state/implement.json` in the exact shape `_cmd_implement`
    writes: `mergeCommitId` is the APR task's own id (no real Integration
    Fix Session merge commit exists for a pure stage intervention) and
    `parentStateId` is `state/working-state.json`'s own id -- so
    `extract`/`sta`/`physical`(candidate)/`evaluate`/`adopt`/
    `record-experience` all follow unchanged (`evaluate`/`sta` read the
    missing `state/merge-commit.json` back via `_load_merge_commit_like`).

    C2 (final review, write-once): `apr/<stage>/<taskId>/` is write-once,
    guarded by a completion marker (`apr-run-complete.json`) this function
    itself writes only after a full, successful run -- refuses
    `AtcsError("write-once", ...)` (exit 3) rather than ever re-running the
    stage/export batches into a directory a prior run already completed.

    I8 (final review, whole-flow integrity): before running anything, this
    call recompiles the SAME stage task `apr-prepare` compiled (`lifecycle.
    compile_intervention` + `lifecycle.stage_task`, from the current
    `residual_cases`/`readiness`/`working_state` on disk -- the identical
    inputs `apr-prepare` itself reads) and refuses
    (`AtcsError("identity-mismatch", ...)`) unless the freshly recompiled
    Tcl is byte-identical to `state/apr-task.json`'s own recorded `tcl`. A
    `state/apr-task.json` that was tampered with, or whose upstream
    residual-case/readiness/working-state inputs have since changed, must
    never be trusted blindly -- only a task whose text this call can
    independently reproduce, right now, from the same recorded recipe, is
    actually run.
    """
    (site_profile_path,) = args
    workspace = Path(workspace)
    site_profile = _read_plain(site_profile_path)
    task = _read_plain(_paths(workspace)["apr_task"])
    for key in ("tcl", "taskId", "stage"):
        if not task.get(key):
            raise InputError("invalid-input", f"apr task is missing {key!r}")
    stage = task["stage"]
    if stage not in APR_STAGES:
        raise InputError("invalid-input", f"apr task stage must be one of {APR_STAGES}, got {stage!r}")
    task_id = adapters.validate_path_segment(task["taskId"], "apr task.taskId")
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")

    # I8: recompile from the same recorded recipe and refuse on any mismatch --
    # done before any output directory is even created.
    residual_doc = _read_plain(_paths(workspace)["residual_cases"])
    readiness = _read_declared(_paths(workspace)["readiness"], "input-readiness")
    recompiled_intervention = lifecycle.compile_intervention(residual_doc.get("cases", []), stage, readiness)
    recompiled_task = lifecycle.stage_task(
        stage, readiness, recompiled_intervention, ".", working_state["top"], parent_state_id=working_state["id"],
    )
    recompiled_task_id = lifecycle.task_id_for(
        stage, recompiled_intervention["hookTcl"], recompiled_intervention["readbackTcl"],
        parent_state_id=working_state["id"],
    )
    if recompiled_task_id != task_id or recompiled_task["tcl"] != task["tcl"]:
        raise core.AtcsError(
            "identity-mismatch",
            "recompiling the apr task from its recorded recipe (residual cases, readiness, working "
            "state) does not reproduce state/apr-task.json's own tcl/taskId -- the recorded task is "
            "stale or was tampered with",
        )

    output_root = workspace / "apr" / stage / task_id
    # C2 (final review, write-once): `apr-run-complete.json` is a completion
    # marker only THIS function writes, at the very end of a successful run
    # -- checking it here (never the raw stage/export outputs, which this
    # Pack's own tests legitimately pre-seed to fake a no-op EDA wrapper's
    # effect) is what actually distinguishes "this exact APR task id was
    # already run" from "the tool is about to produce these files for the
    # first time".
    apr_run_marker = output_root / "apr-run-complete.json"
    if apr_run_marker.is_file():
        raise core.AtcsError(
            "write-once",
            f"apr/{stage}/{task_id}/ has already been run ({apr_run_marker} exists) -- an APR stage "
            "task's implementation output is never overwritten",
        )
    output_root.mkdir(parents=True, exist_ok=True)
    stage_tcl_path = output_root / "apr-stage.tcl"
    stage_tcl_path.write_text(task["tcl"], encoding="utf-8")
    stage_log_path = output_root / "apr-stage.log"
    adapters.run_tool(
        site_profile,
        ["innovus", "-batch", "-files", str(stage_tcl_path), "-log", str(stage_log_path),
         "-overwrite", "-64", "-nowin"],
        cwd=workspace, log_path=stage_log_path,
    )

    stage_db = output_root / "DBS" / f"{stage}.enc"
    if not stage_db.is_file():
        raise adapters.AdapterToolError(f"APR stage produced no database: {stage_db}", stage_log_path)

    export_task = adapters.compile_innovus_export_task(str(stage_db), working_state["top"], str(output_root))
    export_tcl_path = output_root / "innovus-export.tcl"
    export_tcl_path.write_text(export_task["tcl"], encoding="utf-8")
    export_log_path = output_root / "innovus-export.log"
    adapters.run_tool(
        site_profile,
        export_task["command"] + [str(export_tcl_path), "-log", str(export_log_path), "-overwrite", "-64", "-nowin"],
        cwd=output_root, log_path=export_log_path,
    )
    for name, path in export_task["outputs"].items():
        if not Path(path).is_file():
            raise adapters.AdapterToolError(f"expected APR export output missing: {name}={path}", export_log_path)

    database_ref = {
        "path": _relpath(stage_db, workspace), "sha256": core.file_sha256(stage_db),
        "datDigest": core.tree_digest(str(stage_db) + ".dat"),
    }
    netlist_ref = {
        "path": _relpath(export_task["outputs"]["netlist"], workspace),
        "sha256": core.file_sha256(export_task["outputs"]["netlist"]),
    }
    def_ref = {
        "path": _relpath(export_task["outputs"]["def"], workspace),
        "sha256": core.file_sha256(export_task["outputs"]["def"]),
    }
    body = {
        "mergeCommitId": task_id, "design": working_state["top"], "parentStateId": working_state["id"],
        # Minor (final review): the resolved APR stage (place/cts/route/postroute),
        # never hard-coded -- `sta` reads this back instead of assuming "postroute"
        # for every candidate regardless of provenance.
        "stage": stage,
        "database": database_ref, "netlist": netlist_ref, "def": def_ref,
        "drcReport": {
            "path": _relpath(export_task["outputs"]["drc"], workspace),
            "sha256": core.file_sha256(export_task["outputs"]["drc"]),
        },
        "connectivityReport": {
            "path": _relpath(export_task["outputs"]["connectivity"], workspace),
            "sha256": core.file_sha256(export_task["outputs"]["connectivity"]),
        },
    }
    _canonical_write(apr_run_marker, {"stage": stage, "taskId": task_id, "parentStateId": working_state["id"]})
    return _paths(workspace)["implement"], body


DEPLOYED_FLOW_ROOTS = ("atcs_cli.py", "atcs", "templates")
"""I8 (final review, whole-flow integrity): exactly what `contract.yml`'s
`workspace.copy` stages into every Campaign workspace's own `flow/` tree -- never
`flow/tests/`, which this Pack's own tests exercise but which is never deployed."""


def _flow_digest_entries(flow_dir):
    """`[{"path","size","sha256"}]`, sorted, over `DEPLOYED_FLOW_ROOTS` only.

    Mirrors `atcs.core.tree_digest`'s own algorithm (same entry shape, same
    canonical-JSON-then-sha256 final step) but combines the THREE deployed
    roots into one flat list rather than walking a single directory -- a
    plain `tree_digest(flow_dir)` would incorrectly fold in `flow/tests/`
    (never deployed to a real Campaign workspace) and any other file this
    Pack's own repository keeps beside the deployed tree.
    """
    flow_dir = Path(flow_dir)
    entries = []
    cli_path = flow_dir / "atcs_cli.py"
    if not cli_path.is_file():
        raise core.AtcsError("missing-input", f"not a file: {cli_path}")
    entries.append({"path": "atcs_cli.py", "size": cli_path.stat().st_size, "sha256": core.file_sha256(cli_path)})
    for rel_root in ("atcs", "templates"):
        root = flow_dir / rel_root
        if not root.is_dir():
            raise core.AtcsError("missing-input", f"not a directory: {root}")
        for current, dirnames, filenames in os.walk(root):
            dirnames[:] = [name for name in dirnames if name != "__pycache__"]
            dirnames.sort()
            for name in sorted(filenames):
                if name.endswith((".pyc", ".pyo")):
                    continue
                full = Path(current) / name
                rel = full.relative_to(flow_dir).as_posix()
                entries.append({"path": rel, "size": full.stat().st_size, "sha256": core.file_sha256(full)})
    entries.sort(key=lambda entry: entry["path"])
    return entries


def flow_digest(flow_dir):
    """Deterministic full (64 hex char) sha256 over `_flow_digest_entries(flow_dir)`.

    I8 (final review): the value `atcs_cli.py flow-digest` prints, and the value a
    Site's own wrapper should pin instead of (or in addition to) hashing
    `flow/atcs_cli.py` alone (`sites/linglong-atcs28/README.md`'s "Installing the
    wrapper" step) -- a modified helper module (`atcs/*.py`) or template
    (`templates/*.tcl`) is just as real a compromise of the deployed Pack as a
    modified dispatcher, and pinning only `atcs_cli.py` would miss it entirely.
    """
    return hashlib.sha256(core.canonical(_flow_digest_entries(flow_dir))).hexdigest()



# Issue #66: common native R1, six private trials, then one owner-directed integration session.
# The external physical design-state remains the parent of the exported cumulative ECO.
def _native_task(workspace, base, site, root, context, body, prefix):
    root.mkdir(parents=True, exist_ok=True)
    task = adapters.compile_xtop_operator_task(
        {"namePrefix": prefix}, site["design"], site["techLef"], site["cellLefGlob"],
        str(workspace / base["netlist"]["path"]), str(workspace / base["def"]["path"]), root, context)
    path = root / "native-stage.tcl"
    path.write_text(task["tcl"] + "\n" + body, encoding="utf-8")
    adapters.run_tool(site, ["xtop", "-f", str(path)], cwd=root, log_path=root / "native-stage.log")


def _native_analysis_tcl(directory, summary_top_n=10000, detail_top_n=1000):
    return f"""
file mkdir "{adapters.tcl_quote(str(directory))}"
foreach check {{setup hold}} {{
    redirect -file [file join "{adapters.tcl_quote(str(directory))}" "$check.rpt"] [list summarize_gba_violations -exclude_path -$check -with_distribution -with_top_n {int(summary_top_n)}]
    analyze_${{check}}_path_violations -top {int(detail_top_n)} -detail_info -output_dir "{adapters.tcl_quote(str(directory))}" -prefix $check
    set endpoints {{}}
    foreach_in_collection pin [get_${{check}}_gba_violated_pins -exclude_path -endpoint_only] {{
        lappend endpoints [get_attribute $pin full_name]
    }}
    set fh [open [file join "{adapters.tcl_quote(str(directory))}" "$check-endpoints.json"] w]
    puts $fh [atcs_jarr [lsort -unique $endpoints]]
    close $fh
}}
"""


def _eco_pair(workspace, root, prefix):
    pair = {}
    for role in ("netlist", "physical"):
        files = list(root.glob(f"{prefix}_{role}_*.txt"))
        if len(files) != 1 or not files[0].is_file():
            raise core.AtcsError("missing-input", f"final ECO needs exactly one {role} script in {root}")
        pair[role] = {"path": _relpath(files[0], workspace), "sha256": core.file_sha256(files[0])}
    return pair


def _native_measurements(workspace, report_dir):
    """Actual native summarize reports as fixed setup/hold metrics plus hashed raw refs."""
    result = {}
    for mode in ("setup", "hold"):
        path = Path(report_dir) / f"{mode}.rpt"
        text = path.read_text(encoding="utf-8")
        section = contributions.parse_gain_summary(text).get(mode)
        total = (section or {}).get("total") or {}
        if not all(key in total for key in ("worst", "tns", "count")):
            raise core.AtcsError("native-result-unreadable", f"{path} has no readable native {mode} total WNS/TNS/count")
        result[mode] = {
            "wnsNs": total["worst"], "tnsNs": total["tns"], "violations": total["count"],
            "report": {"path": _relpath(path, workspace), "sha256": core.file_sha256(path)},
        }
    return result


def _resident_input_identity(workspace, common):
    baseline = _read_declared(_paths(workspace)["baseline"], "design-state")
    context = _read_declared(_paths(workspace)["xtop_context"], "xtop-context")
    return {
        "baselineStateId": baseline["id"], "nativeContextId": context["id"],
        "commonStateId": common["stateId"], "worklistId": common["worklistId"],
    }


def _cmd_common_autofix(workspace, args):
    site_path, *rest = args
    summary_top_n, detail_top_n = 10000, 1000
    if rest:
        try:
            summary_top_n = detail_top_n = int(rest[0])
        except (TypeError, ValueError) as exc:
            raise InputError("invalid-input", "native report path breadth must be an integer") from exc
        if not 1000 <= detail_top_n <= 100000:
            raise InputError("invalid-input", "native report path breadth must be 1000..100000")
    workspace = Path(workspace)
    base = _read_declared(_paths(workspace)["working_state"], "design-state")
    site = _read_plain(site_path)
    output = workspace / "state/common-stage.json"
    if output.exists():
        _verified_xtop_context(workspace, base["id"], site)
        return output, _read_plain(output)  # safe retry never runs the initial fix twice
    root = workspace / "research/observe/common-r1"
    if root.exists():
        raise core.AtcsError("incomplete-common-stage", "common R1 started without its completion record; inspect its native log before retry")
    context = _verified_xtop_context(workspace, base["id"], site)
    clock_path = workspace / "state/method-clock.json"
    clock = _read_json_or_default(clock_path, {"startedAt": time.time()})
    # This Pack's default and matched experiment are 120 min; the Runtime's frozen budget remains
    # the hard fence. Reserve the same 30 min for implementation/referee in both arms.
    clock.setdefault("experimentDeadline", clock["startedAt"] + 90 * 60)
    _canonical_write(clock_path, clock)
    before, residual = root / "initial-analysis", root / "residual-analysis"
    fixes = integration.auto_fix_tcl(integration.DEFAULT_SETUP_MARGIN, integration.DEFAULT_HOLD_MARGIN)
    body = (_native_analysis_tcl(before, summary_top_n, detail_top_n) + "\n".join(fixes)
            + "\n" + _native_analysis_tcl(residual, summary_top_n, detail_top_n))
    body += f"""
atcs_write_cell_dump "{adapters.tcl_quote(str(root / 'r1.dump'))}"
file mkdir "{adapters.tcl_quote(str(root / 'eco'))}"
write_design_changes -format INNOVUS -eco_file_prefix atcs_common -output_dir "{adapters.tcl_quote(str(root / 'eco'))}" -keep_route
save_workspace -as "{adapters.tcl_quote(str(root / 'r1-workspace'))}"
exit 0
"""
    _native_task(workspace, base, site, root, context, body, "atcs_common_auto_")
    eco = _eco_pair(workspace, root / "eco", "atcs_common")
    summaries = {check: (residual / f"{check}.rpt").read_text() for check in ("setup", "hold")}
    endpoints = {check: _read_plain(residual / f"{check}-endpoints.json") for check in ("setup", "hold")}
    prior_checks = _read_json_or_default(_paths(workspace)["observation"], {}).get("checks") or {}
    native_checks = {}
    for mode, text in summaries.items():
        for scenario, endpoint, slack in contributions._top_n_rows(text).get(mode) or []:
            key = core.check_key(scenario, mode, endpoint)
            native_checks[key] = {"endpoint": endpoint, "slack": core.known(slack),
                "startpoint": (prior_checks.get(key) or {}).get("startpoint"),
                "startpointSource": "external R0 PrimeTime context; verify in native R1 before mutation"}

    # Semantic identities compare independently-produced R1s. Raw saved-workspace hashes remain
    # arm-specific: XTop metadata can contain paths/times. Include physical ECO, not only cell masters.
    semantic_eco = {role: [line.strip() for line in (workspace / ref["path"]).read_text()
        .replace(str(workspace), "${WORKSPACE}").splitlines() if line.strip() and not line.lstrip().startswith("#")]
        for role, ref in eco.items()}
    if any(endpoints.values()) and not native_checks:
        raise core.AtcsError("native-residual-unreadable", "XTop reports violated endpoints but no native endpoint/slack rows could be parsed; retain residual-analysis/*.rpt")
    state_id = core.digest({"parent": base["id"], "cells": contributions.parse_cell_dump((root / "r1.dump").read_text()), "eco": semantic_eco})
    worklist_id = core.digest({"checks": {k: {"endpoint": v["endpoint"], "slack": v["slack"]} for k, v in native_checks.items()}, "endpoints": endpoints})
    seed_path = root / "r1-workspace"
    if not seed_path.is_dir():
        raise core.AtcsError("missing-input", "XTop did not save the common R1 workspace")
    return output, {"parentStateId": base["id"], "stateId": state_id, "worklistId": worklist_id,
        "seed": {"path": _relpath(seed_path, workspace), "digest": core.tree_digest(seed_path)},
        "summaries": summaries, "endpoints": endpoints, "nativeChecks": native_checks, "eco": eco,
        "analysisBoard": _relpath(residual, workspace), "analysisTopPaths": detail_top_n,
        "cellStateDigest": core.digest(contributions.parse_cell_dump((root / "r1.dump").read_text())),
        "autoFixCommands": fixes, "startedAt": clock["startedAt"], "completedAt": time.time(),
        "experimentDeadline": clock["experimentDeadline"], "predictionOnly": True}


def _cmd_resident_common_autofix(workspace, args):
    """The existing native analysis/common R1 without the legacy matched-deadline assumption."""
    path, body = _cmd_common_autofix(workspace, args)
    if body.get("schema") == "atcs.common-stage/1":
        _read_declared(path, "common-stage")
        return path, body
    body = dict(body)
    body.pop("experimentDeadline", None)
    root = Path(workspace) / "research" / "observe" / "common-r1"
    body["measurements"] = {
        "before": _native_measurements(workspace, root / "initial-analysis"),
        "after": _native_measurements(workspace, root / "residual-analysis"),
    }
    body["nativeLog"] = {
        "path": _relpath(root / "native-stage.log", workspace),
        "sha256": core.file_sha256(root / "native-stage.log"),
    }
    return path, core.stamp("common-stage", body)


def _cmd_auto_fix_reference(workspace, args):
    """Matched ordinary AutoFix from common R1 until native timing reports cease changing."""
    if len(args) != 3:
        raise InputError("missing-input", "auto-fix-reference needs Site and the Run's setup/hold Goal targets")
    site_path, setup_target_raw, hold_target_raw = args
    try:
        setup_target, hold_target = float(setup_target_raw), float(hold_target_raw)
    except (TypeError, ValueError) as exc:
        raise InputError("invalid-input", "auto-fix-reference Goal targets must be numeric") from exc
    if not all(math.isfinite(value) for value in (setup_target, hold_target)):
        raise InputError("invalid-input", "auto-fix-reference Goal targets must be finite")
    workspace = Path(workspace)
    output = workspace / "state" / "autofix-reference.json"
    common = _read_declared(workspace / "state" / "common-stage.json", "common-stage")
    base = _read_declared(_paths(workspace)["working_state"], "design-state")
    site = _read_plain(site_path)
    context = _verified_xtop_context(workspace, base["id"], site)
    seed = context.get("seed") or {}
    expected_seed = common.get("seed") or {}
    expected_seed_path = (workspace / expected_seed.get("path", "")).resolve()
    if (Path(seed.get("path", "")).resolve(), seed.get("digest")) != (
            expected_seed_path, expected_seed.get("digest")):
        raise core.AtcsError("identity-mismatch", "ordinary AutoFix is not bound to the verified common R1 seed")
    if output.is_file():
        existing = _read_declared(output, "autofix-reference")
        if existing.get("inputIdentity") != _resident_input_identity(workspace, common):
            raise core.AtcsError("stale-base", "ordinary AutoFix reference belongs to another input/R1")
        return output, existing
    root = workspace / "research" / "control" / "autofix-reference"
    if root.exists():
        raise core.AtcsError("incomplete-autofix-reference", "ordinary AutoFix started without a sealed result; inspect its native trace")
    before = root / "before"
    fixes = integration.auto_fix_tcl(integration.DEFAULT_SETUP_MARGIN, integration.DEFAULT_HOLD_MARGIN)
    top_n = int(common.get("analysisTopPaths", 10000))
    body = _native_analysis_tcl(before, top_n, top_n)
    body += f"\nset ::ATCS_REFERENCE_SETUP_TARGET {{{setup_target}}}\n"
    body += f"set ::ATCS_REFERENCE_HOLD_TARGET {{{hold_target}}}\n"
    body += "set fixes [list " + " ".join('"' + adapters.tcl_quote(command) + '"' for command in fixes) + "]\n"
    body += adapters.load_template("xtop-autofix-reference.tcl")
    body += "\nexit 0\n"
    _native_task(workspace, base, site, root, context, body, "atcs_autofix_reference_")
    loaded_dump = root / "loaded-r1.dump"
    if not loaded_dump.is_file():
        raise core.AtcsError("missing-input", "ordinary AutoFix did not capture its loaded common R1 state")
    loaded_cells = contributions.parse_cell_dump(loaded_dump.read_text(encoding="utf-8"))
    loaded_cell_digest = core.digest(loaded_cells)
    if loaded_cell_digest != common.get("cellStateDigest"):
        raise core.AtcsError(
            "identity-mismatch", "ordinary AutoFix loaded state differs from common R1 cell-state identity")
    terminal = _read_plain(root / "control-result.json")
    if terminal.get("complete") is not True or terminal.get("stopped") not in (
            "goal", "no-improvement", "oscillation", "regression", "mixed-no-improvement"):
        raise core.AtcsError("incomplete-autofix-reference", "ordinary AutoFix has no honest terminal reason")
    best = root / "best"
    eco = _eco_pair(workspace, best / "eco", "atcs_autofix_reference")
    checkpoint = best / "workspace"
    if not checkpoint.is_dir():
        raise core.AtcsError("missing-input", "ordinary AutoFix did not export its selected workspace")
    before_measurements = _native_measurements(workspace, before)
    best_measurements = _native_measurements(workspace, best)
    compact = lambda measured: {mode: {key: measured[mode][key] for key in ("violations", "wnsNs", "tnsNs")}
                                for mode in ("setup", "hold")}
    if terminal.get("initialMetrics") != compact(before_measurements):
        raise core.AtcsError("identity-mismatch", "ordinary AutoFix initial metrics differ from its same-R1 before reports")
    if terminal.get("bestMetrics") != compact(best_measurements):
        raise core.AtcsError("identity-mismatch", "ordinary AutoFix selected metrics differ from its retained best reports")
    result = {
        "inputIdentity": _resident_input_identity(workspace, common),
        "loadedR1": {
            "cellStateDigest": loaded_cell_digest,
            "dump": {"path": _relpath(loaded_dump, workspace), "sha256": core.file_sha256(loaded_dump)},
            "seed": {"path": expected_seed["path"], "digest": expected_seed["digest"]},
        },
        "goal": {"setupWnsNs": setup_target, "holdWnsNs": hold_target},
        "measurements": {"before": before_measurements, "after": best_measurements},
        "artifacts": {
            "logicalEco": eco["netlist"], "physicalEco": eco["physical"],
            "checkpoint": {"path": _relpath(checkpoint, workspace), "digest": core.tree_digest(checkpoint)},
            "nativeTrace": {"path": _relpath(root / "native-stage.log", workspace),
                            "sha256": core.file_sha256(root / "native-stage.log")},
        },
        "autoFixCommands": fixes, "stopReason": terminal["stopped"], "bestRound": terminal.get("bestRound"),
        "rounds": terminal.get("rounds") or [],
        "predictionOnly": True,
    }
    return output, core.stamp("autofix-reference", result)


def _cmd_engineering_result(workspace, args):
    """Normal-work fallback: never fabricate the outsourced result; only preserve an existing one."""
    target_setup, target_hold = args
    for name, value in (("target setup", target_setup), ("target hold", target_hold)):
        try:
            parsed = float(value)
        except (TypeError, ValueError) as exc:
            raise InputError("invalid-input", f"{name} must be numeric") from exc
        if parsed != 0.0:
            raise InputError("invalid-input", f"{name} must be 0.0 for current native evidence")
    path = Path(workspace) / "state" / "engineering-result.json"
    if not path.is_file():
        raise core.AtcsError("engineering-required", "fix-timing requires resident delivery; no result exists to validate")
    result = _read_plain(path)
    if result.get("schema") != "atcs.engineering-result/1":
        raise core.AtcsError("invalid-input", "engineering result has the wrong schema")
    return path, result


def _lead_native_pins(workspace, targets):
    """Keep native pin endpoints; resolve ports through the Pack's existing Reader authority."""
    pins = {target.split("|", 2)[2] for target in targets}
    ports = sorted(pin for pin in pins if "/" not in pin)
    if not ports:
        return pins, []
    reader_path = _FLOW_DIR.parent / "tools/read-atcs.py"
    if not reader_path.is_file():
        reader_path = Path(workspace) / "hima-readers/atcs-readiness/read-atcs.py"
    if not reader_path.is_file():
        raise core.AtcsError("missing-input", "prepare-lead needs the installed atcs-readiness Reader to resolve native ports")
    spec = importlib.util.spec_from_file_location("atcs_lead_reader", reader_path)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    answer = reader.resolve_endpoints(workspace, ports)
    resolved = {row["endpoint"]: row for row in answer["resolved"]}
    unresolved = {row["endpoint"]: row["unresolved"] for row in answer["unresolved"]}
    modules = reader._netlist_index_cache[str(reader._safe_join(workspace, answer["netlist"]["path"], "design-state.netlist"))]
    drivers = []
    for port in ports:
        row, reason = resolved.get(port), unresolved.get(port)
        if row is None and "primary port" in (reason or ""):
            row, reason = reader._net_driver(modules, answer["top"], reader._endpoint_part(port), [])
        if row is None or not row.get("pin"):
            raise core.AtcsError("invalid-work-package", f"native endpoint {port!r} needs a driving cell/output pin: {reason}")
        pins.remove(port)
        pins.add(f"{row['instance']}/{row['pin']}")
        drivers.append(row["instance"])
    return pins, drivers


def _cmd_prepare_lead(workspace, args):
    (site_path,) = args
    workspace = Path(workspace)
    base = _read_declared(_paths(workspace)["working_state"], "design-state")
    site = _read_plain(site_path)
    context = _verified_xtop_context(workspace, base["id"], site)
    common = _read_plain(workspace / "state/common-stage.json")
    ready = workspace / "state/lead-brief.json"
    if ready.is_file():
        brief = _read_plain(ready)
        if (brief.get("commonStateId"), brief.get("worklistId")) != (common["stateId"], common["worklistId"]):
            raise core.AtcsError("stale-base", "prepared lead belongs to another R1")
        return ready, brief
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    plan = _read_admitted_plan(workspace / "research/requests/integration-plan.json")
    if not isinstance(plan, dict) or plan.get("baseStateId") != base["id"]:
        raise core.AtcsError("stale-base", "Timing Lead briefing belongs to another external state")
    report = workspace / "research/fix-strategy-risk.md"
    if not report.is_file() or not report.read_text().strip():
        raise core.AtcsError("missing-input", "plan must write one concise research/fix-strategy-risk.md")
    facts = composition.analyze(base["id"], collected["contributions"], resolutions=plan.get("resolutions") or [])
    recipe = facts.get("recipe") or {"sessions": [], "excluded": []}
    if isinstance(plan.get("select"), list):
        order = {cid: index for index, cid in enumerate(plan["select"])}
        recipe = {**recipe, "sessions": sorted(recipe["sessions"], key=lambda r: order.get(r["contribution"], len(order)))}
    sessions = _recipe_sessions(workspace, recipe, collected, base["id"])
    request = integration.prepare_recipe_replay({**plan, "autoFinish": False}, base["id"], recipe, sessions,
        required_scenarios=context["requiredScenarios"], removable_fillers=context["removableFillers"])
    _canonical_write(_paths(workspace)["composition_facts"], facts)
    _canonical_write(_paths(workspace)["replay_request"], request)
    slot_policy = _read_plain(_paths(workspace)["worker_slots"])
    control = slot_policy["workerSlots"] == 0
    brief = {"control": control, "commonStateId": common["stateId"], "worklistId": common["worklistId"],
        "strategyRisk": {"path": _relpath(report, workspace), "sha256": core.file_sha256(report)},
        "planSha256": core.file_sha256(workspace / "research/requests/integration-plan.json"),
        "contributions": [c["id"] for c in collected["contributions"]], "replayRequestId": request["id"],
        "experimentDeadline": common["experimentDeadline"], "finalAutoFinish": False}
    if control:
        root = workspace / "integrations" / adapters.validate_path_segment(plan["batchId"], "batchId") / "control"
        if root.exists():
            raise core.AtcsError("write-once", "strong control already started; inspect it rather than repeat effects")
        commands = integration.auto_fix_tcl(integration.DEFAULT_SETUP_MARGIN, integration.DEFAULT_HOLD_MARGIN)
        body = f"set deadline {int(common['experimentDeadline'])}\nset fixes [list " + " ".join('"' + adapters.tcl_quote(c) + '"' for c in commands) + "]\n"
        body += adapters.load_template("xtop-repeat-control.tcl")
        _native_task(workspace, base, site, root, context, body, "atcs_control_auto_")
        brief["controlRoot"] = _relpath(root, workspace)
        brief["eco"] = _eco_pair(workspace, root / "eco_output", "atcs_control_auto_eco")
    else:
        workers = _read_plain(_paths(workspace)["workers"])
        active = [e["workPackage"] for e in workers["workers"].values() if not workspaces.is_parked(e["workPackage"])]
        if not active:
            raise core.AtcsError("missing-input", "treatment has no active work packages for lead scope")
        # The retained lead fixes the common residual, including paths no trial
        # seat covered. These are native R1 checks, not model-supplied scope.
        native_targets = set(common.get("nativeChecks") or [])
        native_pins, native_drivers = _lead_native_pins(workspace, native_targets)
        package = {k: v for k, v in active[0].items() if k not in ("schema", "id")}
        package.update(taskId="lead", problem="Owner-directed integration and additional residual ECO",
            targets=sorted(native_targets | {t for p in active for t in p["targets"]}),
            targetPins=sorted(native_pins | {t for p in active for t in p.get("targetPins") or []}),
            scope={"commands": list(workspaces.MUTATE_COMMANDS), "maxMutations": workspaces.SCOPE_MAX_MUTATIONS})
        domains = [p["editDomain"] for p in active] + [{"instances": native_drivers}]
        dropped = {"instances": [], "nets": []}
        for contribution in collected["contributions"]:
            effective = contribution.get("effectiveDomain")
            if not isinstance(effective, dict):
                continue
            domain = {"regions": effective.get("regions") or []}
            for key in ("instances", "nets"):
                # Same literal-name boundary as recipe replay. Keep the raw sealed native
                # evidence intact; omit unsupported derived targets, never broaden authority.
                domain[key], omitted = integration._derived_names(effective.get(key) or [], f"lead effectiveDomain.{key}")
                dropped[key].extend(omitted)
            domains.append(domain)
        brief["derivedDomainDropped"] = {key: sorted(set(names)) for key, names in dropped.items()}
        package["editDomain"] = {key: list(dict.fromkeys(value for d in domains for value in d.get(key) or []))
                                  for key in ("instances", "nets")}
        package["editDomain"]["regions"] = [list(box) for box in dict.fromkeys(tuple(box) for d in domains for box in d.get("regions") or [])]
        package = workspaces.validate_work_package(package, base, site)
        seeded_base = {**base, "xtopSeed": {"stateId": common["stateId"], "worklistId": common["worklistId"], **common["seed"]}}
        manifest = workspaces.prepare(package, workspace, seeded_base)
        root = workspace / manifest["root"]
        task = adapters.compile_xtop_operator_task(manifest, site["design"], site["techLef"], site["cellLefGlob"],
            str(workspace / base["netlist"]["path"]), str(workspace / base["def"]["path"]), root, context)
        operator_path = root / "operator.tcl"
        operator_path.write_text(task["tcl"])
        analysis = adapters.compile_xtop_analysis_manual_task(manifest, package["editDomain"], operator_path,
            root / "ops.jsonl", target_pins=package["targetPins"], max_mutations=package["scope"]["maxMutations"],
            observe="fast", local_topology=True)
        replay = adapters.load_template("xtop-replay.tcl").split('\natcs_write_cell_dump [file join $env(DUMP_DIR) 000.dump]')[0]
        replay_env = {"RECIPE_TCL": str(root / "recipe.tcl"), "AUTO_FIX_TCL": str(root / "auto-fix.tcl"),
            "AUTO_PREFIX": manifest["namePrefix"], "RECEIPTS_LOG": str(root / "receipts.jsonl"),
            "DUMP_DIR": str(root / "dumps"), "PREDICT_DIR": str(root / "predict"),
            "ARM_RESULT": str(root / "arm-result.json"), "FAIL_REASON_TOP_N": "20"}
        (root / "recipe.tcl").write_text(adapters._recipe_tcl(request))
        (root / "auto-fix.tcl").write_text("")
        startup = analysis["tcl"] + '\natcs_dump_cells before.dump\n' + adapters.env_preamble(replay_env)
        startup += '\nset ::ATCS_ARM merged\n' + replay
        replay_budget = sum(1 for step in request["steps"] if step.get("skip") is None and step.get("tcl"))
        startup += f"\nset ::ATCS_MAX_MUTATIONS {workspaces.SCOPE_MAX_MUTATIONS + replay_budget}\n"
        # Retain the lead's union domain. Replay temporarily enters each Contribution's domain;
        # restore it afterwards without opening another XTop process or running AutoFinish.
        startup += """
set lead_domain [list $::EDIT_DOMAIN_INSTANCES $::EDIT_DOMAIN_NETS $::EDIT_DOMAIN_PINS $::EDIT_DOMAIN_REGIONS]
source $env(RECIPE_TCL)
lassign $lead_domain ::EDIT_DOMAIN_INSTANCES ::EDIT_DOMAIN_NETS ::EDIT_DOMAIN_PINS ::EDIT_DOMAIN_REGIONS
set ::EDIT_DOMAIN_LOCAL 1
set ::env(NAME_PREFIX) $env(AUTO_PREFIX)
set_parameter eco_new_object_prefix "$env(NAME_PREFIX)eco"
set ::atcs_plan_sha256 ""
# Bootstrap replay belongs to the sealed Contributions, not the lead child's own mutation allowance.
# Sequence/undo stack and logs stay intact; Host independently counts the lead's interactive sends.
set ::atcs_mutations 0
set ::ATCS_MAX_MUTATIONS 600
set ::atcs_session_instances [atcs_replay_protected]
set ::atcs_session_nets {}
foreach seq $::atcs_kept {
    if {[dict exists $::atcs_op($seq) nets]} {
        set ::atcs_session_nets [lsort -unique [concat $::atcs_session_nets [dict get $::atcs_op($seq) nets]]]
    }
}
atcs_ref
puts "ATCS:lead:replay-complete:$::atcs_replay_applied applied, $::atcs_replay_skipped skipped; owner-directed manual ECO next"
"""
        manual_path = root / "xtop-analysis-manual.tcl"
        manual_path.write_text(startup)
        workers["workers"]["lead"] = {"workPackageId": package["id"], "manifestId": manifest["id"],
            "root": manifest["root"], "namePrefix": manifest["namePrefix"], "workPackage": package,
            "workspaceManifest": manifest, "sessionTcl": str(manual_path), "opsLog": str(root / "ops.jsonl"),
            "sessionTclSha256": core.file_sha256(manual_path),
            "preparedReplay": {name: core.file_sha256(root / name) for name in ("recipe.tcl", "auto-fix.tcl")}}
        _canonical_write(_paths(workspace)["workers"], workers)
        brief["leadRoot"] = manifest["root"]
        brief["namePrefix"] = manifest["namePrefix"]
        brief["scope"] = package["scope"]
        brief["targetPins"] = package["targetPins"]
    return workspace / "state/lead-brief.json", brief


def _cmd_finalize_lead(workspace, args):
    del args
    workspace = Path(workspace)
    brief = _read_plain(workspace / "state/lead-brief.json")
    base = _read_declared(_paths(workspace)["working_state"], "design-state")
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    common = _read_plain(workspace / "state/common-stage.json")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    credited, replay_results, lead_contribution = [], [], None
    if brief["control"]:
        eco = brief["eco"]
        root = workspace / brief["controlRoot"]
        terminal = _read_plain(root / "control-result.json")
        if terminal.get("complete") is not True:
            raise core.AtcsError("incomplete-control", "strong control did not export a complete final result")
    else:
        root = workspace / brief["leadRoot"]
        path, lead_contribution = _cmd_capture_contribution(workspace, ["lead"])
        _canonical_write(path, lead_contribution)
        if not lead_contribution.get("admissible"):
            raise core.AtcsError("unsafe-lead", str(lead_contribution.get("refusals")))
        eco = _eco_pair(workspace, root / "eco_output", _read_plain(_paths(workspace)["workers"])["workers"]["lead"]["namePrefix"] + "eco")
        kept_commands = lead_contribution.get("commands") or []
        kept = {command["seq"] for command in kept_commands}
        receipts_path = root / "receipts.jsonl"
        replay_results = [json.loads(line) for line in receipts_path.read_text().splitlines() if line.strip()] if receipts_path.is_file() else []
        for receipt in replay_results:
            command = next((c for c in kept_commands if c["seq"] == receipt.get("seq")), None)
            overwritten = bool(command and any(set(command.get("instances") or []) & set(c.get("instances") or [])
                for c in kept_commands if c["seq"] > command["seq"]))
            receipt["survives"] = receipt.get("status") == "applied" and receipt.get("seq") in kept and not overwritten
        credited_slots = {r["slot"] for r in replay_results if r["survives"]}
        credited = [{"id": c["id"], "revision": c.get("revision")} for c in collected["contributions"] if c["taskId"] in credited_slots]
        credited.append({"id": lead_contribution["id"], "revision": lead_contribution["revision"]})
    for ref in eco.values():
        if core.file_sha256(workspace / ref["path"]) != ref["sha256"]:
            raise core.AtcsError("identity-mismatch", "final Timing Lead ECO changed before sealing")
    body = {"parentStateId": base["id"], "batchId": request["batchId"], "contributions": credited,
        "operations": [], "innovusEcoTcl": "", "sourceMap": {}, "newNets": None,
        "newNetsUnknown": "cumulative native ECO; final Innovus connectivity is authoritative", "eco": eco,
        "commonStateId": common["stateId"], "worklistId": common["worklistId"],
        "choice": {"arm": "control" if brief["control"] else "merged", "reason": "Owner final candidate; direct physical referee"},
        "autoFinish": False, "replayResults": replay_results,
        "leadContributionId": lead_contribution["id"] if lead_contribution else None,
        "integratorAuthoredCommands": [c["seq"] for c in (lead_contribution or {}).get("commands") or []
            if c["seq"] not in {r.get("seq") for r in replay_results}],
        "manualValue": "unmeasured", "manualValueReason": "compare fresh matched refreshed referees"}
    merge = core.stamp("merge-commit", body)
    _canonical_write(_paths(workspace)["merge_commit"], merge)
    return workspace / "state/lead-final.json", {"mergeCommitId": merge["id"], "eco": eco,
        "control": brief["control"], "finalAutoFinish": False, "finalizedAt": time.time()}


SUBCOMMANDS = {
    "common-autofix": _cmd_common_autofix,
    "resident-common-autofix": _cmd_resident_common_autofix,
    "auto-fix-reference": _cmd_auto_fix_reference,
    "engineering-result": _cmd_engineering_result,
    "prepare-lead": _cmd_prepare_lead,
    "finalize-lead": _cmd_finalize_lead,
    "bind-inputs": _cmd_bind_inputs,
    "bind-resident-inputs": _cmd_bind_resident_inputs,
    "prepare-native-context": _cmd_prepare_native_context,
    "baseline": _cmd_baseline,
    "observe": _cmd_observe,
    "risk": _cmd_risk,
    "prepare-workers": _cmd_prepare_workers,
    "worker-slots": _cmd_worker_slots,
    "operate-parked": _cmd_operate_parked,
    "capture-contribution": _cmd_capture_contribution,
    "collect": _cmd_collect,
    "compose-facts": _cmd_compose_facts,
    "replay-prepare": _cmd_replay_prepare,
    "reconcile": _cmd_reconcile,
    "presta": _cmd_presta,
    "implement": _cmd_implement,
    "extract": _cmd_extract,
    "sta": _cmd_sta,
    "physical": _cmd_physical,
    "evaluate": _cmd_evaluate,
    "adopt": _cmd_adopt,
    "residual": _cmd_residual,
    "apr-prepare": _cmd_apr_prepare,
    "apr-run": _cmd_apr_run,
    "record-experience": _cmd_record_experience,
    "policy": _cmd_policy,
}


def _fail(code, detail, exit_code, extra=None):
    payload = {"code": code, "detail": detail}
    if extra:
        payload.update(extra)
    sys.stderr.write(json.dumps(payload, sort_keys=True) + "\n")
    return exit_code


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return _fail("missing-input", "usage: atcs_cli.py <subcommand> <workspace> [args]", 2)
    # I8 (final review): `flow-digest` is a Site-admin diagnostic, not a Campaign
    # subcommand -- it takes no workspace and writes no declared output, only prints
    # a deterministic digest of the deployed flow/ tree this file itself lives in
    # (or, given one positional arg, an explicit override path).
    if argv[0] == "flow-digest":
        flow_dir = argv[1] if len(argv) > 1 else Path(__file__).resolve().parent
        try:
            print(flow_digest(flow_dir))
        except core.AtcsError as exc:
            return _fail(exc.code, exc.detail, 3)
        return 0
    if len(argv) < 2:
        return _fail("missing-input", "usage: atcs_cli.py <subcommand> <workspace> [args]", 2)
    subcommand, workspace, *rest = argv
    # Minor (final review, final fix batch C): resolve `workspace` to an
    # absolute path before any handler ever sees it -- a relative argv value
    # would otherwise leave every path this call writes (declared outputs,
    # `_relpath`-computed refs a LATER, separately-invoked subcommand must
    # resolve the exact same way) dependent on this one process's transient
    # cwd, never a guaranteed-stable identity for the Campaign workspace.
    # `os.path.abspath` (join-with-cwd-then-normalize), never `Path.resolve()`
    # -- `resolve()` also follows symlinks, which would silently rewrite a
    # workspace path a caller passed deliberately (e.g. `/tmp/...` on a host
    # where `/tmp` is itself a symlink) into a different, if equivalent,
    # string than the one it was actually given.
    workspace = os.path.abspath(workspace)
    handler = SUBCOMMANDS.get(subcommand)
    if handler is None:
        return _fail("missing-input", f"unknown subcommand: {subcommand!r}", 2)

    try:
        output_path, body = handler(workspace, rest)
    except InputError as exc:
        return _fail(exc.code, exc.detail, 2)
    except core.AtcsError as exc:
        return _fail(exc.code, exc.detail, 3)
    except adapters.AdapterToolError as exc:
        return _fail("tool-failed", exc.detail, 4, extra={"log": exc.log_path})
    except (OSError, KeyError, TypeError, ValueError) as exc:
        # Minor (final review): a handler that lets one of these four escape
        # (an unreadable file it did not already wrap as `InputError`, or a
        # declared input whose shape it assumed but did not actually
        # validate) is still a malformed/unreadable DECLARED INPUT, never a
        # module refusal and never a raw traceback on stderr at exit 1 --
        # this Pack's own fail-closed rule for Site/Workshop-supplied
        # evidence applies here too, at the dispatcher's own outermost
        # boundary.
        return _fail("malformed-input", f"{type(exc).__name__}: {exc}", 2)

    core.write_artifact(output_path, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
