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
M7/M11 output. Because a Harness `outputs[]` entry must be one **fixed,
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
| 2 | `baseline` | manifest | `state.design_state` | `state/baseline.json` (also seeds `state/working-state.json`) |
| 3 | `policy` | analysisContractDir, targetSetupNs(`{from: goal}`), targetHoldNs(`{from: goal}`) | reads `<analysisContractDir>/policy.json` + `state/baseline.json` + `state/observation.json` | `state/policy.json` (stamped) |
| 4 | `observe` | querySpec, siteProfile, scenarioCorners(Site-fixed `analysisContract/scenario-corners.json` -- see "Task 12c fix round" below), maxPaths(`{from: strategy}`, an upper cap -- see "Fix round 1" below) | `_scenario_pt_inputs` (x4, built from `state/working-state.json`, re-verified by sha256) then `adapters.compile_pt_scenario_tasks` + `run_tool` (x4) then `state.capture` | `state/observation.json` (also `state/observation-prev.json`, `observations/<id>.json` and `research/observe/max-paths.json`) |
| 5 | `risk` | priorObservation(`state/observation-prev.json`), currentObservation(`state/observation.json`), recheck | `state.compare_checks` (self-compares on the campaign's first observation, when `priorObservation` does not exist yet) | `state/risk.json` |
| 6 | `prepare-workers` | baseState(`state/working-state.json`), siteCapabilities, edaProfile, campaignPlan(the ONE admitted envelope `{"candidate":{"workPackages":{"w01"..,"w02"..,"w03"..},"reason"},"baseState":..,"siteCapabilities":..}`; reads `candidate.workPackages`, refuses `ambiguous-plan` if a top-level `workPackages` key is also present -- see "Task 12c fix round" below) | `workspaces.validate_work_package` + `workspaces.prepare` (x3) + `adapters.compile_xtop_operator_task`/`compile_xtop_analysis_manual_task` (x3, materialized into each worker's own root) | `state/workers.json` (now embeds each slot's full `workPackage`/`workspaceManifest`) |
| 7 | `capture-contribution` | slot | `contributions.seal` (base_ref/result_refs composed from `state/workers.json[slot]` and the slot's own workspace root -- see `_cmd_capture_contribution`'s docstring for the exact `before.dump`/`after.dump`/`ops.jsonl`/`summary.json` file names) | `state/contribution-<slot>.json` (one of 3 literal names) |
| 8 | `collect` | (none) | reads whichever `contribution-w0N.json` exist AND still matches `state/workers.json[slot]`'s current revision (`contribution-index` read envelope: `{"contributions","pending":[{"slot","reason"}]}` -- see "Task 12c fix round" below) | `state/contributions-collected.json` |
| 9 | `compose-facts` | plan(the SAME admitted integration-plan envelope row 10 reads; absent on the first pass -- see "Task 12c fix round" below) | `composition.analyze` (`baseStateId` from `state/working-state.json`; `resolutions` from the admitted plan, `[]` on the first pass) | `state/composition-facts.json` |
| 10 | `replay-prepare` | baseState(`state/working-state.json`), plan(the admitted integration-plan envelope `{"plan":...,"facts":...}` -- see "Task 12c fix round" below), siteProfile | `integration.validate_plan` + `integration.prepare_replay` then `adapters.compile_xtop_replay_task` + `run_tool` (best-effort) | `state/replay-request.json` |
| 11 | `reconcile` | (none -- edit domains come from `state/workers.json`, see "Task 12c fix round" below) | `integration.reconcile` | `state/integration-state.json` |
| 12 | `presta` | baseState(`state/working-state.json`), scenarioCorners, siteProfile | `integration.seal_batch` (read-only re-derivation, for `newNets`) + `adapters.compile_pt_presta_task` + `run_tool`, `verification.precheck_evidence` | `state/presta.json` (the stamped `precheckEvidence` artifact) |
| 13 | `implement` | currentDesignState(`state/working-state.json`), siteProfile | `integration.seal_batch` then `adapters.compile_innovus_eco_task` + `run_tool` | `state/implement.json` |
| 14 | `extract` | corners, siteProfile | `adapters.compile_starrc_task` + `run_tool` (per corner) | `state/extract.json` |
| 15 | `sta` | querySpec, scenarioCorners, baseDesignState(`state/working-state.json`), siteProfile | `_verified_state_sdc_path` (SDC from `baseDesignState`'s own recorded `sdc[0]`, sha256-verified -- no separate `sdc` argv any more, see "Fix round 2" below) + `adapters.compile_pt_scenario_task` + `run_tool` (per scenario), `state.design_state`, `state.capture`, `refresh.record_refresh` (once, on completion) | `state/sta.json` (also appends `state/refresh-ledger.json`) |
| 16 | `physical` | (candidate) mode only; (baseline) drcReport, connectivityReport, mode | (I/O packaging only; candidate mode reads+re-hashes `state/implement.json`'s `drcReport`/`connectivityReport`) | `state/baseline-physical.json` or `state/physical.json` |
| 17 | `evaluate` | policy(`state/policy.json`) | `verification.plan_checks` + `verification.assemble` | `state/evaluation.json` |
| 18 | `adopt` | policy(`state/policy.json`) | `adoption.publish` (`expectedBase` from `state/working-state.json`; rewrites `state/working-state.json` whenever `working` moves) | `accepted/latest.json` (envelope: `{"acceptanceRecord","refreshLedger"}` paths) |
| 19 | `residual` | scenarioCorners(Site-fixed, same file row 4 reads), siteProfile -- see "Task 12c fix round"/"Fix round 2" below | `_residual_candidate_state` (the EVALUATED candidate's own `implementations/<mergeId>/design-state.json` once `state/evaluation.json` exists, never `state/working-state.json`, which may still be the parent for a refused candidate; the working state itself before any evaluation) + `_scenario_pt_inputs` + `adapters.compile_pt_query_task` + `run_tool` (per scenario, bounded to `RESIDUAL_QUERY_BOUND` worst checks) + `adapters.parse_path_detail` then `residual.extract` | `state/residual-cases.json` (also `queryNotes`, a side field) |
| 20 | `apr-prepare` | (none -- see "Fix round 1" below) | reads `research/requests/next-decision.json` then `lifecycle.compile_intervention` + `lifecycle.stage_task` | `state/apr-task.json` (one fixed literal path for every stage; carries `taskId` and `stage`) |
| 21 | `apr-run` | siteProfile | reads `state/apr-task.json` then `run_tool` (stage batch) + `adapters.compile_innovus_export_task` + `run_tool` (export batch) | `state/implement.json` (same shape `implement` writes) |
| 22 | `record-experience` | reasonSource(the SAME admitted integration-plan envelope row 10 reads -- only actually read when `_merge_commit_provenance` says `"merge"`; see "Task 12c fix round" below) | `experience.record` (lineage/decision/outcome composed from `state/working-state.json`, `state/implement.json`, `state/evaluation.json`, `state/contributions-collected.json`, `state/merge-commit.json`/`state/apr-task.json` (provenance), `state/sta.json`, `state/policy.json`/`state/pointers.json`) | `state/experience.json` |

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
      (`workspaces.request_invalid_count`) across all three packages plus
      structural problems (missing `workPackages`/a slot/`reason`).
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
   `_scenario_pt_inputs`. **`contract.yml`'s `sta` tool argv still names
   `${ANALYSIS_CONTRACT}/sdc.json`** -- removing that one argv entry is
   outside this fix round's authorized file scope (`atcs_cli.py`,
   `tools/read-atcs.py`, their tests, `FABRIC.md` numbering only); see this
   task's report for the exact change Task 14 must apply.

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
  `verification.REQUIRED_SCENARIOS` entry -- the SPEF ref that scenario's
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

import json
import os
import sys
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
        "risk": state_dir / "risk.json",
        "experience": state_dir / "experience.json",
        "workers": state_dir / "workers.json",
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


def _cmd_baseline(workspace, args):
    """Build the baseline `design-state` and seed `state/working-state.json` from it verbatim.

    `state/working-state.json` is the one fixed, literal-path entry file
    every later subcommand that used to take `state/baseline.json` as its
    base (`prepare-workers`, `compose-facts`, `replay-prepare`, `presta`,
    `implement`, `sta`, `adopt`) reads instead (G1/G7) -- `adopt` rewrites it
    with the adopted candidate's own design-state whenever the `working`
    pointer moves (see `_cmd_adopt`), so a second implementation round
    re-bases on the *adopted* state, never the original baseline again.
    """
    (manifest_path,) = args
    manifest = _read_plain(manifest_path)
    body = state.design_state(manifest)
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


def _scenario_pt_inputs(workspace, working_state, scenario_corners, scenario):
    """One scenario's `{"design","netlist","sdc","spef"}` PT inputs, built from the *working*
    design-state's own recorded files -- never a model-supplied path (Task 12c item 3).

    `working_state` is an already schema/id-verified `design-state` artifact
    (`_read_declared`); this function additionally re-verifies, by sha256,
    that the netlist/SDC/SPEF files it is about to hand to PT still match
    the bytes that `design_state` recorded -- the same defense-in-depth
    `tools/read-atcs.py`'s `_verify_design_state_refs` applies on the Reader
    side. `scenario_corners` is the Site-fixed `{scenario: corner}` map
    (`analysisContract/scenario-corners.json` -- the *same* fixed document
    `sta`/`presta` already read; never `state/policy.json`, which does not
    exist yet at `observe-baseline` time -- see this function's callers'
    own docstrings and this task's report for why). Raises
    `InputError("invalid-input", ...)` for a scenario missing from
    `scenario_corners`, `AtcsError("missing-input", ...)` for a working
    state missing the named corner's SPEF or any SDC entry, and
    `AtcsError("identity-mismatch", ...)` when a referenced file's current
    sha256 no longer matches the working state's own recorded one.
    """
    corner = scenario_corners.get(scenario)
    if not corner:
        raise InputError("invalid-input", f"scenario corners is missing {scenario!r}")
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

    return {
        "design": working_state["top"], "netlist": str(netlist_path),
        "sdc": str(sdc_path), "spef": str(spef_path),
    }


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
    `scenario_corners` map (`analysisContract/scenario-corners.json` -- the
    model never writes it, and it is already available before `observe-
    baseline` runs, unlike `state/policy.json`, which this call cannot use
    for the corner map since `policy` itself runs immediately *after*
    `observe-baseline` in `graph.yml`). The model's own observation request
    (`query_spec`) only ever chose *what* to query (precision, required
    scenarios, path breadth); it never supplied a file path.

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
    query_spec_path, site_profile_path, scenario_corners_path, max_paths_raw = args
    query_spec = dict(_read_plain(query_spec_path))
    site_profile = _read_plain(site_profile_path)
    scenario_corners = _read_plain(scenario_corners_path)
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

    workspace = Path(workspace)
    _canonical_write(
        workspace / "research" / "observe" / "max-paths.json",
        {"cap": cap, "requested": requested, "used": effective, "clamped": clamped},
    )
    working_state = _read_declared(_paths(workspace)["working_state"], "design-state")

    report_root = workspace / "research" / "observe"
    scenario_inputs = {
        scenario: _scenario_pt_inputs(workspace, working_state, scenario_corners, scenario)
        for scenario in adapters.REQUIRED_SCENARIOS
    }
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

    index = {}
    for slot in workspaces.TASK_IDS:
        raw = work_packages.get(slot)
        if not isinstance(raw, dict):
            raise InputError("invalid-input", f"campaign plan workPackages is missing slot {slot!r}")
        validated = workspaces.validate_work_package(raw, base_state, site_capabilities)
        manifest = workspaces.prepare(validated, str(workspace), base_state)

        # `manifest["root"]` is workspace-relative (`atcs.workspaces.prepare`'s own
        # convention: "workspaces/<taskId>/r<rev>/"); join it against `workspace`
        # before writing anything, or this dispatcher's own subprocess cwd (never
        # guaranteed to be the campaign workspace) silently decides where these
        # session files land instead (pre-existing Task 12 bug, fixed here).
        session_dir = workspace / manifest["root"]
        ops_log_path = session_dir / "ops.jsonl"
        operator_task = adapters.compile_xtop_operator_task(
            manifest, eda_profile["design"], eda_profile["techLef"], eda_profile["cellLefGlob"],
            str(netlist_path), str(def_path) if def_path else "", str(session_dir),
        )
        operator_tcl_path = Path(operator_task["tclPath"])
        operator_tcl_path.parent.mkdir(parents=True, exist_ok=True)
        operator_tcl_path.write_text(operator_task["tcl"], encoding="utf-8")

        analysis_task = adapters.compile_xtop_analysis_manual_task(
            manifest, validated.get("editDomain", {}), operator_tcl_path, ops_log_path,
        )
        analysis_tcl_path = session_dir / "xtop-analysis-manual.tcl"
        analysis_tcl_path.write_text(analysis_task["tcl"], encoding="utf-8")

        index[slot] = {
            "workPackageId": validated["id"], "manifestId": manifest["id"], "root": manifest["root"],
            "namePrefix": manifest["namePrefix"], "sessionTcl": str(analysis_tcl_path), "opsLog": str(ops_log_path),
            # G2: the full stamped artifacts, not just their ids -- `capture-contribution
            # <slot>` composes `base_ref` from these directly, so it needs no argv path
            # of its own beyond the slot name.
            "workPackage": validated, "workspaceManifest": manifest,
        }
    return _paths(workspace)["workers"], {"workers": index}


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
      edits, at exactly these two fixed names.
    - ``ops.jsonl`` -- the same typed-procedure trace path already recorded
      as `state/workers.json[slot]["opsLog"]`.
    - ``summary.json`` (optional) -- ``{"xtopSetupWns", "xtopHoldWns",
      "diagnosis", "cones", "dependencies"}``, all optional; a numeric
      ``xtopSetupWns``/``xtopHoldWns`` becomes a known Measure, anything
      absent stays `unknown` (`contributions._predicted_measures`'s own
      default). ``diagnosis`` is required content (not a file name) for a
      `no-fix` slot -- `contributions.seal` refuses one without it.

    All three required files missing is `missing-input` (exit 2), matching
    "no subcommand reads files that no subcommand writes": every one of
    them is written by the Operator session `prepare-workers` itself set up
    for this exact slot and root.
    """
    (slot,) = args
    if slot not in workspaces.TASK_IDS:
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
    ops_log_path = Path(entry["opsLog"])
    if not ops_log_path.is_absolute():
        ops_log_path = workspace / ops_log_path
    before_dump = root / "before.dump"
    after_dump = root / "after.dump"
    for required_path, label in ((before_dump, "before.dump"), (after_dump, "after.dump"), (ops_log_path, "ops.jsonl")):
        if not required_path.is_file():
            raise InputError("missing-input", f"Operator output not found for slot {slot!r}: {label} at {required_path}")

    summary = _read_json_or_default(root / "summary.json", {})
    predicted = {}
    for key in ("xtopSetupWns", "xtopHoldWns"):
        value = summary.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            predicted[key] = core.known(value)

    result_refs = {
        "beforeDump": str(before_dump), "afterDump": str(after_dump), "script": None,
        "predicted": predicted, "diagnosis": summary.get("diagnosis"),
        "cones": summary.get("cones", []), "dependencies": summary.get("dependencies", []),
    }
    operation_trace = _read_text(str(ops_log_path))
    body = contributions.seal(base_ref, result_refs, operation_trace)
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

    collected = []
    pending = []
    for slot in workspaces.TASK_IDS:
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
        if plan_raw.get("baseStateId") != working_state["id"]:
            plan_raw = None  # stale: for a base this campaign has since moved on from
        else:
            replay_request_path = _paths(workspace)["replay_request"]
            if replay_request_path.is_file():
                existing_request = _read_declared(replay_request_path, "replay-request")
                if existing_request.get("batchId") == plan_raw.get("batchId"):
                    plan_raw = None  # stale: this exact batch has already been prepared/replayed
    resolutions = (plan_raw or {}).get("resolutions") or []
    body = composition.analyze(working_state["id"], collected["contributions"], resolutions)
    return _paths(workspace)["composition_facts"], body


def _cmd_replay_prepare(workspace, args):
    base_state_path, plan_path, site_profile_path = args
    workspace = Path(workspace)
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    plan_raw = _read_admitted_plan(plan_path)
    if plan_raw is None:
        raise InputError("missing-input", f"declared input not found: {plan_path}")
    site_profile = _read_plain(site_profile_path)
    base_state = _read_declared(base_state_path, "design-state")
    if base_state["id"] != facts.get("baseStateId"):
        raise core.AtcsError("stale-base", "base design-state does not match facts.baseStateId")

    validated_plan = integration.validate_plan(plan_raw, facts)
    request = integration.prepare_replay(validated_plan, facts, collected["contributions"])

    batch_id = adapters.validate_path_segment(request.get("batchId"), "replay-request.batchId")
    output_root = workspace / "integrations" / batch_id
    current_db = workspace / base_state["database"]["path"]
    task = adapters.compile_xtop_replay_task(str(current_db), base_state["top"], request.get("steps", []), output_root)
    Path(task["stepsPath"]).parent.mkdir(parents=True, exist_ok=True)
    Path(task["stepsPath"]).write_text(task["stepsText"], encoding="utf-8")
    main_tcl_path = output_root / "xtop-replay.tcl"
    main_tcl_path.write_text(task["tcl"], encoding="utf-8")
    log_path = output_root / "xtop-replay.log"
    try:
        adapters.run_tool(site_profile, ["xtop", "-f", str(main_tcl_path)], cwd=output_root, log_path=log_path)
    except adapters.AdapterToolError:
        # A step failure stops the batch (architecture Sec.8.4): later steps
        # simply stay receipt-less (pending) -- `reconcile` reports that, it
        # is not a `replay-prepare` refusal in its own right.
        pass
    receipts = adapters.read_replay_receipts(task["receiptsLog"])
    _canonical_write(_paths(workspace)["replay_receipts"], {"receipts": receipts})
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
    base_state_path, scenario_corners_path, site_profile_path = args
    workspace = Path(workspace)
    base_state = _read_declared(base_state_path, "design-state")
    scenario_corners = _read_plain(scenario_corners_path)
    site_profile = _read_plain(site_profile_path)
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    integration_state = _read_declared(_paths(workspace)["integration_state"], "integration-state")
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])
    merge_commit = integration.seal_batch(integration_state, request, facts, collected["contributions"])

    scenario = adapters.REQUIRED_SCENARIOS[0]
    corner = scenario_corners.get(scenario)
    if not corner:
        raise InputError("invalid-input", f"scenario corners is missing {scenario!r}")
    spef_ref = base_state.get("spef", {}).get(corner)
    if not spef_ref:
        raise core.AtcsError("missing-input", f"base state has no SPEF for corner {corner!r}")

    inputs = {
        "design": base_state["top"], "netlist": str(workspace / base_state["netlist"]["path"]),
        "sdc": str(workspace / base_state["sdc"][0]["path"]) if base_state.get("sdc") else "",
        "spef": str(workspace / spef_ref["path"]),
    }
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
    _canonical_write(report_root / "predicted.json", {"scenario": scenario, "predicted": predicted})

    body = verification.precheck_evidence(merge_commit, str(spef_net_names_path))
    return _paths(workspace)["presta"], body


def _cmd_implement(workspace, args):
    current_state_path, site_profile_path = args
    workspace = Path(workspace)
    current_state = _read_declared(current_state_path, "design-state")
    site_profile = _read_plain(site_profile_path)
    integration_state = _read_declared(_paths(workspace)["integration_state"], "integration-state")
    request = _read_declared(_paths(workspace)["replay_request"], "replay-request")
    facts = _read_declared(_paths(workspace)["composition_facts"], "composition-facts")
    collected = _read_plain(_paths(workspace)["contributions_collected"])

    merge_commit = integration.seal_batch(integration_state, request, facts, collected["contributions"])
    merge_id = adapters.validate_path_segment(merge_commit["id"], "merge-commit.id")
    _canonical_write(_paths(workspace)["merge_commit"], merge_commit)
    _canonical_write(workspace / "implementations" / merge_id / "merge-commit.json", merge_commit)

    design = current_state["top"]
    current_db = workspace / current_state["database"]["path"]
    output_root = workspace / "implementations" / merge_id
    task = adapters.compile_innovus_eco_task(merge_commit, str(current_db), design, str(output_root))

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

    database_ref = {
        "path": _relpath(outputs["database"], workspace), "sha256": core.file_sha256(outputs["database"]),
        "datDigest": core.tree_digest(outputs["database"] + ".dat"),
    }
    netlist_ref = {"path": _relpath(outputs["netlist"], workspace), "sha256": core.file_sha256(outputs["netlist"])}
    def_ref = {"path": _relpath(outputs["def"], workspace), "sha256": core.file_sha256(outputs["def"])}

    body = {
        "mergeCommitId": merge_commit["id"], "design": design, "parentStateId": merge_commit.get("parentStateId"),
        "database": database_ref, "netlist": netlist_ref, "def": def_ref,
        "drcReport": {"path": _relpath(outputs["drc"], workspace), "sha256": core.file_sha256(outputs["drc"])},
        "connectivityReport": {
            "path": _relpath(outputs["connectivity"], workspace), "sha256": core.file_sha256(outputs["connectivity"]),
        },
    }
    return _paths(workspace)["implement"], body


def _cmd_extract(workspace, args):
    corners_path, site_profile_path = args
    workspace = Path(workspace)
    corners_doc = _read_plain(corners_path)
    corners = corners_doc.get("corners", [])
    if not corners:
        raise InputError("invalid-input", "corners must name at least one StarRC corner")
    for corner in corners:
        adapters.validate_path_segment(corner, "corners entry")
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])
    merge_id = adapters.validate_path_segment(implement.get("mergeCommitId"), "implement.mergeCommitId")

    def_path = workspace / implement["def"]["path"]
    output_root = workspace / "implementations" / merge_id
    spef_out = {}
    for corner in corners:
        task = adapters.compile_starrc_task(implement["design"], corner, str(def_path), str(output_root))
        cmd_path = Path(task["cmdPath"])
        cmd_path.parent.mkdir(parents=True, exist_ok=True)
        cmd_path.write_text(task["cmdText"], encoding="utf-8")
        Path(task["workDir"]).mkdir(parents=True, exist_ok=True)
        log_path = Path(task["cmdPath"]).with_suffix(".log")
        adapters.run_tool(site_profile, task["command"], cwd=cmd_path.parent, log_path=log_path)
        spef_path = Path(task["spefPath"])
        if not spef_path.is_file():
            raise adapters.AdapterToolError(f"StarRC produced no SPEF for corner {corner!r}", log_path)
        spef_out[corner] = {
            "path": _relpath(spef_path, workspace), "sha256": core.file_sha256(spef_path),
            "inputDefSha256": implement["def"]["sha256"], "estimated": False,
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


def _cmd_sta(workspace, args):
    """Fix round 2 item 2 (controller decision, one SDC source): the SDC this candidate is
    timed against comes from `base_state` (the design state actually being timed, `state/
    working-state.json`) via `_verified_state_sdc_path`, never a separate Site-fixed
    `analysisContract/sdc.json` copy that could silently diverge from the SDC the state
    itself was built from -- the `sdc` argv arg is gone; `observe`/`residual` already read
    SDC this same way (`_scenario_pt_inputs`).
    """
    query_spec_path, scenario_corners_path, base_design_state_path, site_profile_path = args
    workspace = Path(workspace)
    query_spec = _read_plain(query_spec_path)
    scenario_corners = _read_plain(scenario_corners_path)
    base_state = _read_declared(base_design_state_path, "design-state")
    site_profile = _read_plain(site_profile_path)
    implement = _read_plain(_paths(workspace)["implement"])
    extract = _read_plain(_paths(workspace)["extract"])
    merge_id = adapters.validate_path_segment(implement.get("mergeCommitId"), "implement.mergeCommitId")

    for scenario in adapters.REQUIRED_SCENARIOS:
        if scenario not in scenario_corners:
            raise InputError("invalid-input", f"scenario corners is missing {scenario!r}")

    sdc_path = _verified_state_sdc_path(workspace, base_state)
    sdc_list = [entry["path"] for entry in (base_state.get("sdc") or [])]

    report_root = workspace / "implementations" / merge_id / "sta"
    sta_receipts = {}
    sta_sources = {}
    for scenario in adapters.REQUIRED_SCENARIOS:
        corner = scenario_corners[scenario]
        spef_ref = extract["spef"].get(corner)
        if not spef_ref:
            raise InputError("invalid-input", f"extract has no SPEF for corner {corner!r}")
        sta_sources[scenario] = {"path": spef_ref["path"], "sha256": spef_ref["sha256"]}
        inputs = {
            "design": implement["design"], "netlist": str(workspace / implement["netlist"]["path"]),
            "sdc": str(sdc_path), "spef": str(workspace / spef_ref["path"]),
        }
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

        source_refs = {
            "designStateId": base_state["id"],
            "scenarios": {scenario: {
                "globalTiming": task["reports"]["global_timing.rpt"], "setupPaths": task["reports"]["setup.rpt"],
                "holdPaths": task["reports"]["hold.rpt"], "checkTiming": task["reports"]["check_timing.rpt"],
            }},
        }
        one_scenario_query_spec = dict(query_spec)
        one_scenario_query_spec["requiredScenarios"] = [scenario]
        observation = state.capture(source_refs, one_scenario_query_spec)
        sta_receipts[scenario] = {
            "corner": corner,
            "inputs": {"netlistSha256": implement["netlist"]["sha256"], "spefSha256": spef_ref["sha256"]},
            "observation": observation,
        }

    manifest = adapters.build_design_state_manifest(
        top=implement["design"], stage="postroute",
        database_enc=implement["database"]["path"], database_dat=implement["database"]["path"] + ".dat",
        netlist=implement["netlist"]["path"], def_path=implement["def"]["path"],
        spef_by_corner={corner: ref["path"] for corner, ref in extract["spef"].items()},
        sdc_list=sdc_list, scenario_corners=scenario_corners, tools=base_state.get("tools"),
        parent_id=base_state["id"], root=str(workspace),
    )
    design_state = state.design_state(manifest)
    _canonical_write(workspace / "implementations" / merge_id / "design-state.json", design_state)

    # Called exactly once here: extraction (`extract.json`, already read
    # above) and all `REQUIRED_SCENARIOS`' STA (the loop above) have both
    # just completed for this implementation. `sta_sources` is one
    # `{"path","sha256"}` ref per required scenario -- the SPEF that
    # scenario's STA actually read (`atcs.refresh.record_refresh`'s own
    # binding shape: a dict keyed by `verification.REQUIRED_SCENARIOS`).
    merge_commit = _load_merge_commit_like(workspace, implement)
    from atcs import refresh  # local import: keeps this dispatcher loadable if this module is ever absent
    refresh.record_refresh(str(_paths(workspace)["refresh_ledger"]), merge_commit["id"], design_state["id"], sta_sources)

    body = {
        "designStateId": design_state["id"], "database": design_state["database"], "sta": sta_receipts,
    }
    return _paths(workspace)["sta"], body


def _cmd_physical(workspace, args):
    """Baseline mode takes report paths via argv; candidate mode reads them from `state/implement.json` (G3).

    There is no fixed, literal `state/candidate-verify-drc.rpt`/
    `...-connectivity.rpt` path a Harness output could ever bind (each
    implementation writes its reports under its own `implementations/<mergeId>/`
    or `apr/<stage>/<taskId>/` directory) -- `mode == "candidate"` therefore
    takes only `<mode>` and resolves+re-hashes `state/implement.json`'s own
    `drcReport`/`connectivityReport` `{"path","sha256"}` refs instead
    (`implement`/`apr-run` both write that shape). `mode == "baseline"`
    is unchanged: the campaign baseline's own physical export has no such
    per-id state file to read from, so its two report paths stay argv-bound.
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
        drc_path, connectivity_path, mode = args
        if mode != "baseline":
            raise InputError("invalid-input", f"a three-argument physical call must be mode 'baseline', got {mode!r}")
    drc_text = _read_text(drc_path)
    connectivity_text = _read_text(connectivity_path)
    body = {"drc": drc_text, "connectivity": connectivity_text}
    key = "baseline_physical" if mode == "baseline" else "physical"
    return _paths(workspace)[key], body


def _cmd_evaluate(workspace, args):
    """`policy` is now the stamped `state/policy.json` `_cmd_policy` writes (G4)."""
    (policy_path,) = args
    workspace = Path(workspace)
    policy = _read_declared(policy_path, "policy")
    sta = _read_plain(_paths(workspace)["sta"])
    implement = _read_plain(_paths(workspace)["implement"])
    merge_commit = _load_merge_commit_like(workspace, implement)
    extract = _read_plain(_paths(workspace)["extract"])
    physical = _read_plain(_paths(workspace)["physical"])
    baseline_physical = _read_plain(_paths(workspace)["baseline_physical"])
    prior_observation = _read_declared(_paths(workspace)["observation"], "observation-set")

    plan = verification.plan_checks(merge_commit, policy)
    receipts = {
        "designStateId": sta["designStateId"], "database": sta["database"],
        "netlist": implement["netlist"], "def": implement["def"], "spef": extract["spef"],
        "sta": sta["sta"], "physical": physical,
    }
    body = verification.assemble(plan, receipts, prior_observation, baseline_physical)
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
        if candidate_id:
            candidate_id = adapters.validate_path_segment(candidate_id, "pointersAfter.working.candidateId")
            candidate_state_path = workspace / "implementations" / candidate_id / "design-state.json"
            if candidate_state_path.is_file():
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


def _collect_residual_evidence(workspace, working_state, scenario_corners, site_profile, observation, remaining_keys):
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

    Returns `(check_details, notes)`.
    """
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
        scenario, _mode, endpoint = parts
        entry = checks.get(key) or {}
        startpoint = entry.get("startpoint")
        if not isinstance(startpoint, str) or not startpoint:
            reason = f"{key}: no startpoint recorded in observation"
            notes.append(reason)
            check_details[key] = _unknown_evidence(reason)
            continue
        by_scenario.setdefault(scenario, []).append({"checkKey": key, "startpoint": startpoint, "endpoint": endpoint})

    for scenario, targets in sorted(by_scenario.items()):
        try:
            inputs = _scenario_pt_inputs(workspace, working_state, scenario_corners, scenario)
            report_root = workspace / "research" / "residual" / scenario
            task = adapters.compile_pt_query_task(inputs, str(report_root), targets)
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
    """
    scenario_corners_path, site_profile_path = args
    workspace = Path(workspace)
    scenario_corners = _read_plain(scenario_corners_path)
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
        remaining_keys = evaluation.get("comparison", {}).get("remaining", [])
        pt_state, pt_state_failure = _residual_candidate_state(workspace, evaluation)
    else:
        base_observation = _read_declared(_paths(workspace)["observation"], "observation-set")
        remaining_keys = _failing_checks_from_observation(base_observation)
        evaluation = {"comparison": {"remaining": remaining_keys}}
        pt_state = _read_declared(_paths(workspace)["working_state"], "design-state")
        pt_state_failure = None

    if pt_state is not None:
        check_details, notes = _collect_residual_evidence(
            workspace, pt_state, scenario_corners, site_profile, base_observation, remaining_keys,
        )
    else:
        bounded_keys = _bounded_remaining_checks(base_observation, remaining_keys, RESIDUAL_QUERY_BOUND)
        check_details = {key: _unknown_evidence(pt_state_failure) for key in bounded_keys}
        notes = [pt_state_failure] if bounded_keys else []

    observation_for_extract = dict(base_observation)
    observation_for_extract["checkDetails"] = check_details

    cases = residual_module.extract(evaluation, observation_for_extract, exp, readiness)
    return _paths(workspace)["residual_cases"], {"cases": cases, "queryNotes": notes}


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
    own internal digest -- `core.digest({"stage","hookTcl","readbackTcl"})`,
    the same value baked into `task["outputs"]`' own `apr/<stage>/<id>/`
    paths) and the resolved `stage` itself onto the returned body:
    `apr-run` (G24) needs both -- the stable id to build the output
    directory it will run the stage task in and stamp as the resulting
    candidate's own `mergeCommitId`, and `stage` because it no longer takes
    that as an argv value either -- `lifecycle.stage_task` itself returns
    only `{"tcl","inputs","outputs"}` (M11's own module docstring: neither
    shape is a stamped artifact), so both are computed/carried here rather
    than by changing that module's public return shape. Declared output is
    now the single fixed `state/apr-task.json` (never `apr/<stage>/task.json`,
    which cannot be one fixed literal path across four possible stages).
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
    intervention = lifecycle.compile_intervention(residual_doc.get("cases", []), stage, readiness)
    task = lifecycle.stage_task(stage, readiness, intervention, ".")
    task_id = core.digest({"stage": stage, "hookTcl": intervention["hookTcl"], "readbackTcl": intervention["readbackTcl"]})
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


def _baseline_min_wns(observation):
    """`min(setup, hold)` WNS across every `adapters.REQUIRED_SCENARIOS` entry, or `None` if incomplete.

    Mirrors `verification.assemble`'s own fail-closed "final WNS" rule
    (module docstring step 3) at the *baseline*, before any candidate
    exists -- every required scenario must be present, `complete` for both
    modes, and carry a known `wns` Measure, or the whole thing is
    incomplete (`None`), never a partial minimum.
    """
    scenarios = observation.get("scenarios", {})
    missing = set(observation.get("missingScenarios", []))
    values = []
    for scenario in adapters.REQUIRED_SCENARIOS:
        if scenario in missing or scenario not in scenarios:
            return None
        entry = scenarios[scenario]
        complete = entry.get("complete", {})
        for mode in ("setup", "hold"):
            if not complete.get(mode):
                return None
            wns = entry.get(mode, {}).get("wns")
            if not core.is_known(wns):
                return None
            values.append(core.value_of(wns))
    return min(values) if values else None


def _cmd_policy(workspace, args):
    """Compose the run-time acceptance policy (G4): static Site fields + Goal + campaign run-time facts.

    `<analysisContractDir>` is a fixed Site-bound directory; only its
    `policy.json`'s static fields (`allowDegradedWorking`, `degradeLimitNs`,
    `maxNewConstraintFailures`, `scenarioCorners`, `requiredScenarios`) are
    copied through -- a static Site document refusing to set any run-time or
    Goal field (`goal`, `baselineStateId`, `baselineMinWns`, `campaignRoot`)
    is `AtcsError("invalid-policy", ...)`, since letting it set its own
    acceptance bar/permissions is exactly what the SPEC forbids (M7's own
    guard order already refuses a `publish` whose policy tries to relax a
    check; this refuses the attempt at the source instead). `<targetSetupNs>`/
    `<targetHoldNs>` are this Pack's two Goal parameters (`{from: goal}`),
    forming `goal = {"setup", "hold"}`. `baselineStateId`/`baselineMinWns`
    are read back from the *original* `state/baseline.json` and its own
    baseline `state/observation.json` (never `state/working-state.json`,
    which `adopt` may since have rewritten) -- exactly the fixed anchor
    `adoption.publish`'s degraded-working gate needs for the whole campaign.
    `evaluate`/`adopt` read the result at the fixed path `state/policy.json`.
    """
    analysis_contract_dir, target_setup_raw, target_hold_raw = args
    workspace = Path(workspace)
    static_policy = _read_plain(Path(analysis_contract_dir) / "policy.json")

    run_time_keys = ("goal", "baselineStateId", "baselineMinWns", "campaignRoot")
    forbidden = sorted(key for key in run_time_keys if key in static_policy)
    if forbidden:
        raise core.AtcsError("invalid-policy", f"static policy file may not set {forbidden}")

    try:
        target_setup = float(target_setup_raw)
        target_hold = float(target_hold_raw)
    except (TypeError, ValueError):
        raise InputError("invalid-input", "targetSetupNs/targetHoldNs must be numbers")

    baseline = _read_declared(_paths(workspace)["baseline"], "design-state")
    baseline_observation = _read_declared(_paths(workspace)["observation"], "observation-set")
    if baseline_observation.get("designStateId") != baseline["id"]:
        raise core.AtcsError("stale-base", "baseline observation is not bound to the baseline design-state")
    baseline_min_wns = _baseline_min_wns(baseline_observation)
    if baseline_min_wns is None:
        raise core.AtcsError(
            "missing-input", "baseline observation does not cover every required scenario's setup/hold WNS"
        )

    body = {
        "allowDegradedWorking": bool(static_policy.get("allowDegradedWorking", False)),
        "degradeLimitNs": static_policy.get("degradeLimitNs", 0.0),
        "maxNewConstraintFailures": static_policy.get("maxNewConstraintFailures", 0),
        "scenarioCorners": static_policy.get("scenarioCorners", {}),
        "requiredScenarios": static_policy.get("requiredScenarios", list(adapters.REQUIRED_SCENARIOS)),
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

    output_root = workspace / "apr" / stage / task_id
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
    return _paths(workspace)["implement"], body


SUBCOMMANDS = {
    "bind-inputs": _cmd_bind_inputs,
    "baseline": _cmd_baseline,
    "observe": _cmd_observe,
    "risk": _cmd_risk,
    "prepare-workers": _cmd_prepare_workers,
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
    if len(argv) < 2:
        return _fail("missing-input", "usage: atcs_cli.py <subcommand> <workspace> [args]", 2)
    subcommand, workspace, *rest = argv
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

    core.write_artifact(output_path, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
