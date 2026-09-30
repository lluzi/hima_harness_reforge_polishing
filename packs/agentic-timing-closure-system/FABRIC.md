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
- `graph.yml` — 106 nodes (60 act, 36 judge, 9 explore, 1 wait), 143 edges, 9 revisit edges.
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
- `test/contract/agentic-timing-closure-system.test.ts` — node/edge count assertion only (Issue
  #64 Task 5: 132 nodes, 172 edges).

2026-09-29 reshape (ADR-0016, Pack 0.2.0 generation shape): the file list above is Task 14's
history. The graph now has 81 nodes and 103 edges (from 136/178): the in-loop owner decisions
(`decide-next`, `read-next-decision`, `check-next-decision`, `check-continue`, the `route-*` Judges
and `revisit-*` Explores, the earlier-APR detour and the observation-request Workshop) are gone with
their readers, rules, outputs and the chooser `atcs-revisit`; `rules/composition-checked.yml` is new.

How the reference graph expresses SPEC behaviour 1–9 (current):

- Inputs and baseline (autopilot segment `bind-inputs` .. `plan`): `bind-inputs` → `inputs-ready`
  (FAIL/UNDETERMINED → wait, the honest end) → `baseline` → `observe-baseline` → `policy` →
  `physical-baseline` → `risk` → `residual` → `read-refresh-budget` → `refresh-budget` (the Goal cap;
  FAIL/UNDETERMINED → wait, the honest end) → `bind-worker-slots` → the owner's `plan`.
- Plan (owner Workshop `plan-campaign`) → `request-admissible`, `request-checked` (FAIL/UNDETERMINED →
  the owner's decision) → `prepare-workers`, which forks six self-driving branches, one per slot
  w01..w06 (the branch author's Workshop → request reading → operate: the Operator's XTop session
  working from the embedded request inside its own scope, or the `operate-parked` no-op → capture →
  result reading), joined at `check-worker-results` (every outcome collects).
- Merge (autopilot segment `check-worker-results` .. `compose`): `collect` → `compose-facts` → the
  owner's `compose` Workshop; then (autopilot segment `read-integration-plan` .. `decide`)
  `request-admissible` → the admitted composition facts → `composition-ready`, `composition-checked`
  → `replay-prepare` → `reconcile` → replay mismatch and scope (identity and domain integrity) →
  `presta`, read as advice.
- One refresh: `implement` → `extract` → `sta` → `physical` → `evaluate` → `adopt` → the acceptance
  reading → `observe-working` (the automatic re-observation of the working state) → risk, residual,
  `record-experience` → a fresh final-evaluation reading → `check-generation`
  (`final-evidence-ready-identity`, setup Goal, hold Goal; every outcome goes to the decision).
- Decision: `decide` (Explore, chooser `atcs-goal-met`) — continue: the next generation from the
  working state, entering at `read-refresh-budget`; stop: the honest end, goal not met. A goal-met
  choice is refused unless every gate verdict passed.
- Every in-loop Judge labels PASS, FAIL and UNDETERMINED; only the input and refresh-budget gates
  reach `wait-for-person`. Everything else a Reader finds is advice in its problems file.
- There is no `converge` block; the Run's budget ending is the Runtime's.

## Gaps

2026-09-27 bounded integration: `atcs-worker-01` reuses the frozen Issue #52 Team seam.
The current research path runs only w01 through adopted Researcher/Reviewer results, one typed sizing
Operator, Contribution Reader and collect. w02/w03 and three-worker optimization are deferred under
the coordinator's executable-convergence scope. ATCS-02 required no Runtime changes: the exact
Researcher result is a retained dependency and the existing Workshop output remains the action authority.
Local Host/Tcl fixtures prove the mechanism; commercial qualification remains a separate gate.

2026-09-28 Issue #64 Task 4: the worker Teams are version 4 in Harness scope mode. The Reviewer
approves `{scope: {commands, maxMutations}, planSha256}` within the recipe (the eleven `xtop-operator`
mutations, cap 120); the Operator runs the expert loop of `knowledge/xtop-expert-operator.md`. Work
packages carry `scope` (Tcl-side budget = the recipe cap; the Reviewer's budget is the Host's),
`targetPins`, `observe` and `editDomain.regions`, for slots w01..w06.

2026-09-28 Issue #64 Task 5: the ATCS workers run as six fork branches. `prepare-workers` forks into
`research-worker-NN → read-worker-request-NN → operate-worker-NN → capture-worker-NN →
read-worker-result-NN` for NN = 01..06, and the branches join at the judge `check-worker-results`,
which leads to `collect` on PASS and on FAIL. Each branch is a pure act chain holding one Site Job at a
time and reading and writing its own paths; Teams 04..06 are Team 01 with the slot number changed.
Proving tests: `test/contract/agentic-timing-closure-system.test.ts` ("ATCS forks six worker
branches: slot w01's Team runs its expert session, parked slots pass as no-ops, and the join collects
every slot" drives the real fork in the in-process Host, from `prepare-workers` to `collect`; the Pack
test asserts the fork shape with `forkFrom`), `test/contract/fork-interactive-team.host.test.ts`
(concurrent interactive Team branches) and `flow/tests/test_worker_slots.py`. The campaign plan is
blockers first: the campaign-plan Reader counts every instance two active slots claim (edit domain or
target-pin owner) and every edit-domain net two active slots name, every worst setup or hold check of a required scenario (read from
`state/observation.json` with `composition.worst_check_endpoints`, required scenarios from
`state/policy.json`) that no active slot covers by `composition.covers` -- the one rule the recipe's
`blockerCoverage` also uses: the check key in `targets` (a top-level port), or the key's or PT's raw
endpoint in `targetPins` -- an observation of another design-state, and every active
slot above the `workerSlots` Strategy knob (1..6, default 6), which `bind-worker-slots` stamps into
`state/worker-slots.json` on every way into the plan. A parked slot's package is exactly `{taskId,
baseStateId, parked: true, problem}`; its branch still runs: `prepare-workers` gives it a workspace but
no session, its operate node is the `xtop-operator` tool's batch path (`mode: hybrid`, `operate-parked`),
which opens no XTop session, and `capture-contribution` seals a `parked` no-fix. `operate-parked` also
skips an active slot whose worker request is inadmissible (the branch holds no Judge), and refuses any
other active slot. `collect` requires all six slots. The join judges `tc_worker_refusal_count` (new,
emitted by every worker-result Reader). Delegation shares follow Task 2b (Researcher and Reviewer 10
min, Operator 20 min).

Every tool and reader `contract.yml` names is held in this folder (tools run `flow/atcs_cli.py` or
the Site's XTop Operator wrapper; readers run `tools/read-atcs.py`). None of the gaps below is
closed by a hidden loop or background process.

Schema limits and how the graph expresses them:

- G1 Resolved by Issue #64 Task 5 (six parallel branches, above). A join upstream of every Explore
  node makes `loadPack`'s `exploreAfter` require each Explore's own two-rule Judge to follow a fresh
  unbranched reading directly, so the Pack re-reads before each routing Judge that follows another
  Judge: `nextDecision` before `route-observe`..`route-implement` and `finalEvaluation` before
  `gm-identity`..`goal-met-gate` (12 `reread-*` act nodes). The runtime check (`exploreEvidence`) was
  already satisfied without them; the rule is stricter than the runtime, and a generic Harness change
  that keeps "fresh reading" across a Judge chain would remove them. A batch still waits for every
  slot (`requiredSlots` is all six). History: worker slots ran sequentially, and every round ran all
  three before `collect`; the original limitation below is retained as source history: a batch
  can never seal while a slot is still researching, the opposite of SPEC Constraint 7's dynamic
  batching (`pending` is non-empty only for a skipped or stale slot), and a slot with nothing worth
  fixing still costs an XTop Operator session to end as a no-fix. A variant forking the three slot
  chains was refused by `loadPack` (`exploreAfter`: every path from a join to an Explore needs a
  fresh reading and a two-rule Judge with no single-rule Judge after it); a branch holds act nodes
  only, so the per-slot `request-admissible` gate cannot sit in it. Concurrent interactive branches:
  proven (#64 Task 2) for the owner-driven Run by
  `test/contract/fork-interactive-team.host.test.ts` ("two fork branches each hold an interactive
  Job driven by their own Team at once, and the join waits for both captures"; and "under a Site cap
  of one, ..."): two branches of `workshop -> reader -> interactive tool (Team) -> capture tool` open
  their interactive Jobs at the same moment, each Team's delegations stay on its own execution, the
  join judge becomes available only after both captures, and the Site Job cap holds (an open at the
  cap is refused, not queued). The one Harness change was attribution: interactive launches now carry
  their execution's `branchId`. The legacy auto-drive `driveBranch` path remains unexercised for
  Workshops and interactive nodes; ATCS runs owner-driven.
- G2 A branch holds no Judge, so an inadmissible worker request (its Reader reading is not 0) is
  skipped by the owner with the `operate-parked` no-op and seals a `parked` no-fix naming why. That
  no-fix carries the refusal `inadmissible-request`, so the skip shows at the join as that branch's
  `worker-result-admissible` FAIL (the join still collects). There is no per-slot revise loop, so the
  slot contributes nothing this round until a later research revisit re-plans it. `prepare-workers`
  removes an earlier skip receipt (`parked.json`) from every root it (re)prepares, since `prepare`
  reuses the root of an identical package. Known limitation: a parked branch still runs its research
  Workshop (a trivial parked request) and a few seconds of batch no-op; removing that cost needs a
  Harness feature that skips a fork branch, not built here (with `workerSlots` defaulting to 6,
  parking is rare). #64 Track B: a refused active request is no longer a reason to park.
  The owner reads `workerRequestNNProblems` and revises `research-worker-NN`; the Harness revision
  reruns that branch from its Workshop in the same generation while the other branches keep their
  place (no Explore can stand inside a branch, and none is needed: an Explore retry would spend a
  generation, which is how live02 ran out). The worker purposes and the `xtop-operator` description
  say so; the ATCS contract test drives it for slot w02 (refused at 2 problems, revised, re-read at 0,
  generation unchanged, no decision record). A parked slot costs no model, Team, XTop session or
  licence: `xtop-operator` declares its `xtop: 1` seat as `interactive.licences` (a generic Harness
  field, #64 Track B), so the batch no-op holds none; the ATCS contract test runs the real
  declaration and finds no Team member, no interactive Job and no licence for w02..w06, and xtop 1 on
  w01's session. What a parked branch still runs is three short Site Jobs (its trivial Workshop, the
  no-op and the capture); removing those needs the Harness fork-branch skip named above.
- G38 (Issue #64 Track B, ported from #63's dry path, main d1471985) A batch decision on a stale XTop
  context is refused with "observe first". After a physical refresh is adopted,
  `state/xtop-context.json` still names the pre-refresh state and only `observe` rebinds it, so
  `prepare-workers` (reached by `research`) and `replay-prepare` and the recipe replay (reached by
  `compose` and `revise`) exit 3 `stale-base`. The next-decision Reader counts `research`/`compose`/
  `revise` on such a context with "observe first: the XTop context is bound to <old>, the working
  state is <new>" (a context that does not verify is counted too); the refusal revisits
  `decide-next`, whose purpose now says to observe first, and `observe` rebinds the context. No graph
  growth. No context at all is left to those tools (a Site without `xtopContext`). Proving tests:
  `test_cli_state.StaleXtopContextAfterAdoptTest` (the real stages through adopt, prepare-workers
  exit 3, then the Reader's refusal) and three `NextDecisionReaderTest` cases.
- G39 (Issue #64 Track B, ported from #63 slice 1 fix, gap 3, probe items 1-2 and review 2 I2)
  Examples as declared knowledge. Every model-written document has one admitted example in
  `knowledge/example-*.md` (observation request, the six-slot campaign plan (six active clusters since G46),
  worker requests for an active slot, an active slot with no safe move and a parked slot, the
  integration plan with one conflict resolution, the next decision), declared in `contract.yml`
  (16 knowledge files) and in the knowledge list of the Workshop that writes it; the purposes name
  it and keep their checklists and self-check snippets, and no longer inline the JSON.
  `flow/tests/test_workshop_examples.py` fills each from a fixture workspace and reads it through
  its Reader at 0 problems; the live02 plan reads 41 and, corrected along its 41 lines into the
  example's shape, 0 (`Live02ToExampleShapeTest`). No safe move: an active slot's request may state
  `noSafeAction` with an empty `sessionPlan` (the worker-request Reader counts a blank reason, a
  non-empty plan, or `noSafeAction` on a parked slot); the Team then reviews no move -- the
  Researcher proposes none, the Reviewer approves only `atcs_undo` with a budget of 1, and the
  Operator reads, dumps and closes with `stopReason` `no-safe-action`, so the capture seals an
  honest no-fix. Unlike #63, the slot still opens one short XTop session: routing past the Team
  needs a Judge inside the branch (refused by `loadPack`) or a change to `operate-parked` (flow,
  pinned by the wrapper's flow digest). Every Team's reviewer template caps its reply: exactly one
  JSON object, every field named with its form, `evidenceRefs` as record-id strings, at most three
  limitations under 200 characters, no nested object except `scope`, and an example reply last
  (the #63 probe's admitted answer breaks the caps).
- G40 (Issue #64 Track B, live class C28; Harness main 5604abb9 ported) `budget.minimumGenerations: 3`.
  Live02 was created with a generation limit of 2 and ended at it with no refresh. Every Explore
  revisit spends a generation, so the default two refreshes need at least three: generation 1 holds
  the baseline and the first decision, and each refresh its own research batch generation. The
  Harness refuses a Run created below the floor, naming both numbers; a kit or Guide that creates the
  #64 Campaign with 2 generations must now ask for 3 or more.
- G41 (Issue #64 Track B, readiness before the treatment Campaign) What the expert Operator is told
  matches the session it gets. `flow/tests/test_expert_operator_readiness.py` renders a slot's session
  Tcl (`xtop-operator.tcl` + `xtop-analysis-manual.tcl`) and requires every `atcs_*` name in
  `knowledge/xtop-expert-operator.md` and in each worker Team's Operator `taskTemplate` to be a
  procedure of it; the typed procedures ending in `plan_sha256` to be exactly the contract's
  `interactive.commands.mutate`, each ending in `planSha256`; and both texts to name every interactive
  command, `planSha256`, the loop, both ladders and the fail-reason moves. It found the knowledge
  naming no `planSha256` and the six templates omitting `atcs_move_cell` (fixed; no flow byte changed).
  `test/contract/atcs-expert-operator.host.test.ts` drives the same session through the Team seam
  (scope of three: three admitted, the fourth refused by the Host, the undo logged against its trial,
  an out-of-domain object refused by the toolkit, the sealed command log without the undone trial),
  and `test/contract/atcs-dry-path.host.test.ts` (group `atcs-dry`) runs the 0.2.0 graph from
  `bind-inputs` with six concurrent sessions, two refreshes and the third refused, no model and no EDA.
- G42 (Issue #64 Track B, real-model probe) Researcher turn budget. The ported
  `scripts/probe-atcs-workshops.ts` (0.2.0 inputs derived from the retained PR03 Run by the Pack's own
  code) admitted every Workshop document 3/3, but two of three Researcher turns ended `max-tokens` at
  `maxTokensPerTurn` 8000 (8598 output tokens, 7190 reasoning): the Host read no completed reply and the
  Reviewer never ran. Every worker Team's Researcher now has 16000 (`flow/tests/test_team_turn_budget.py`);
  the rerun admitted Researcher and Reviewer 3/3, each Reviewer scope passing the Host's creation checks.
- G43 (Issue #64 treatment attempt 1, #63 C13 and live finding #250 ported) A size move names a
  library master of the cell's own function. Attempt 1's w01 Operator sized its register to
  `SDGCNQOPTMC D12BWP30P140` (two `atcs_candidates` columns joined) and XTop refused it twice as an
  invalid library cell, two approved mutations spent; w03 sized `SDFCNQARD1BWP35P140` to
  `SDFCNQD2BWP35P140`, a flop without the asynchronous reset, and undid it. Both requests' size entries
  named no master and read 0 (Ledger #144, #254). For each `atcs_size_cell` entry of an active slot's
  `sessionPlan` the worker-request Reader counts an object outside `editDomain.instances` (merge
  integrity) and, since the worker/aggregation principle (G45; first committed as counts in 3b851486,
  turned to advice in the next commit), writes as `Advice`, never counted: a missing `toMaster`; a name that is not one plain token; the current master; a name that is no
  `cell (NAME)` of the Liberty files the sealed `state/xtop-context.json` lists (re-hashed as read;
  the first scenario's); a function change under the Site's `cellNominalSizingPattern` (the name up
  to the drive digits); and an unreadable or other-state context. The drive and the VT may change
  (both ladders size or VT-swap with `atcs_size_cell`), which is wider than #63's same-VT rule.
  `read-atcs.py masters WORKSPACE INSTANCES OUT` lists each leaf cell's master and its function's
  library cells; the six research purposes, the worker-request example and the expert knowledge say
  the cells are the Liberty files' `cell (NAME)` groups, not a table in `xtop-context.json`, and the
  six Operator templates say a master is one token and "invalid library cell" means read
  `atcs_candidates` again. Proving tests: `flow/tests/test_t01_regressions.py` `SizeMoveMasterTest`
  on the retained w01 and w03 requests (RED on 12950dac: no advice, no command) and
  `SizeMoveGuidanceTest`; the dry path sizes to a named master.
- G44 (Issue #64, #63 C23 45257f24/5e95d542 and C22 e00d06cb ported, as advice) Leaf-cell edit
  domains and the Pack's endpoint resolver. The six-slot plan Reader never read the netlist, so a plan
  naming a module instance (live02's `swerv_dma_ctrl`), a port, a bare leaf or an absent path as an
  edit-domain cell reached the Operator with no word to the Workshop. Under the worker/aggregation
  principle below, the plan Reader (each active slot) and the worker-request Reader share
  `_edit_domain_problems`, whose findings are `Advice`: written to the sidecar after the counted
  problems ("Advice (N, not counted ...)"), never counted, never failing `request-admissible`. The
  worker-request Reader's earlier hierarchical-name count (T63) is advice now too. An empty domain gets
  no advice: target pins are toolkit domain pins. The netlist parser is #63's statement parser (multi-line instantiations,
  comments, no line cap), and `read-atcs.py resolve-instances WORKSPACE ENDPOINTS OUT` resolves PT
  endpoints (bus spellings, flattened escaped names, a net to its driver, a whole check key by its
  endpoint part). `knowledge/endpoint-resolution.md` (17 knowledge files) gives the shipped copy
  `hima-readers/atcs-readiness/read-atcs.py` and says to pass the endpoint, not the check key; the
  plan checklist and the six worker purposes point at it, and each advice line names it. The live02
  plan still reads 41, with 10 advice lines (stand-in netlist). Proving tests:
  `flow/tests/test_endpoint_resolution.py` (RED: 11 errors, 3 failures) and
  `test_t01_regressions.LeafCellEditDomainTest` on the retained attempt-1 plan (RED: no advice
  existed).
- G45 The worker/aggregation principle (user design decision, 2026-09-29, Issue #64 before treatment
  attempt 2). The parallel worker stage is exploratory and divergent; over-restricting it cramps the
  design space. Quality is guaranteed downstream, by the aggregation (composition facts, the ranked
  recipe replayed from the common base, reconcile, the plain auto-fix control arm, pre-STA) and by
  refreshed PrimeTime, the sole arbiter of convergence, not by upstream refusals. A worker request or a
  plan is refused only for what breaks identity or merge integrity: an unparseable document, a
  `baseState`/`planSha256`/prepared-package mismatch, an action outside the slot's edit domain or two
  active slots claiming one instance or net, and whatever the Site Permit or the wrapper forbids.
  Everything the Operator and XTop find out for themselves (a master outside the library, a function
  change, a name XTop has no cell for, a parked seat while checks are uncovered) is `Advice` in the
  sidecar. The Reviewer sharpens the plan and records concerns; its scope is no bottleneck.

- G46 (Issue #64 treatment attempt 1, plan coverage; guidance and advice under G45) Fill the seats.
  Attempt 1's plan took only each required scenario's single worst check as a blocker, made 3
  clusters and parked w04..w06 although `workerSlots` was 6 and the observation held disjoint
  violating checks (the dma FIFO and dmi sync flops, `lsu_axi_arvalid`, `sb_axi_wdata[0]`); its
  stated reason was that the first generation has no batch fail reasons. The plan purpose now says to
  fill every seat up to `workerSlots` while any violating check of a required scenario is uncovered,
  taking the next worst checks in leaf cells no other active slot claims, and that missing fail reasons
  are no reason to park; its self-check snippet prints advice for a parked seat. The example plan
  holds six active clusters, worst first, with the parked shape in its text. The plan Reader writes one
  `Advice` per parked seat up to `workerSlots` naming the worst uncovered check, never a counted
  problem (G45). The dry path's plan builds the parked shape itself. Proving tests:
  `test_t01_regressions.ParkedSeatTest` on the retained plan (RED: no advice) and
  `test_workshop_examples.PlanCampaignExampleTest` (the six-cluster example admitted with no advice;
  RED: the one-active example parked five seats).
- G47 (Issue #64 treatment attempt 1, the Operator loop; G45) An undo is never a stop, and the Reviewer
  is no bottleneck. Attempt 1's w03 (Ledger #258, #271, #321; `flow/tests/live_fixtures/t01-w03-team-results.json`):
  the Researcher's falsifier said "atcs_undo and stop this cluster", the Reviewer approved 15 mutations,
  and the Operator sized `SDFCNQARD1BWP35P140` to `SDFCNQD2BWP35P140`, undid it (correctly: the new
  master drops the reset) and stopped with `no-candidate-gains` and 13 mutations unspent (its context
  also ran out before the close). The knowledge and the six Operator templates now say: try freely inside
  your domain, manual moves and targeted fixes alike (a targeted fix after the undoable manual moves, since
  XTop commits it), there is no wrong attempt, only an unmeasured one; after an undo try the next rung;
  stop only when every rung the scope allows was tried without gain, the budget is spent or the blockers
  are clear. The Researcher gives the next rung with each falsifier and never says to stop after one undo.
  The Reviewer sharpens the plan and records concerns: scope.commands defaults to every command of the
  candidate's scope, `maxMutations` to 50 (never below 3; the recipe cap stays 120), and it refuses only a
  request that is not for its slot's edit domain. The plan and worker examples list every toolkit
  mutation, the plan checklist's default. Proving tests: `test_t01_regressions.OperatorLoopTest` (RED: 13
  failures).
- G48 (Issue #64, #63 C06 ea3993f3 and C05 9737b28f ported; the downstream half of G45) The first
  composition pass never reads an integration plan, and a wild session flows to the replay. C06
  applied to 0.2.0: `compose-facts` (the first-pass node, also the `revisit-revise` target) read
  `research/requests/integration-plan.json`, so a refused generation-2 plan with malformed resolutions
  still on disk made generation 3's first pass exit 3. The first pass now runs a tool whose plan
  argument names a file nothing writes; the new `compose-facts-admitted` tool, reached only through
  `check-integration-plan` PASS, reads the admitted plan (no graph growth; the node's tool changed).
  C05 was already counted by this Reader (a resolution for a no-fix Contribution names no current
  conflict); its test is added, green on arrival. `flow/tests/test_wild_contribution_flow.py` runs a
  domain-clean wild session (a trial that hurt its target, undone, then a master of another function
  the plan never named) through capture, compose and replay without an upstream refusal: the
  composition keeps every session with its predicted value and marks a shared-instance command
  skipped, naming its holder; `reconcile` records the session that did not reproduce (the skipped
  command, `deltaMatches: false`, a `replayMismatch` warning) and chooses the arm on XTop's prediction.
  The value findings (`no-predicted-gain`, `breaks-target-check`, `breaks-opposite-check`) are
  advisories since the 2026-09-30 replay-aggregator decision (see Reviews, ATCS-09). Proving tests: `ComposeFactsSecondPassTest.test_a_refused_plan_with_malformed_resolutions_is_not_applied`
  (RED: exit 3), `IntegrationPlanExampleTest.test_a_resolution_for_a_no_fix_contribution_is_counted`,
  `test_wild_contribution_flow.py` (green on arrival).
- G49 (Issue #64 treatment attempt 1, retry slot hygiene; Site side, no flow change) Every Operator
  attempt should start in a fresh slot. `prepare-workers` (`workspaces.prepare`) picks a slot's round
  directory `workspaces/<slot>/r<N>` once per plan and bakes it into `state/workers.json` and the session
  Tcl; the interactive argv is `<wrapper> <workspace> <slot>` with no attempt, and the v12 wrapper and
  its verifier read `r<N>` from that record. So every retry of one plan lands in the same `r<N>`: slot
  w02's retries met attempt 1's XTop workspaces and 44 hard-linked `.exclusive.cdslck*` files
  (`flow/tests/live_fixtures/t01-w02-stale-locks-list.txt`); the verifier refused attempts 2 and 5 and
  attempt 4's XTop stopped at `save_workspace` ("Directory exists"). Neither the Pack nor the Harness can
  pass an attempt number without a flow or Harness change, so the fix is the Site's: the `atcs-v13`
  wrapper template runs `sites/linglong-atcs28/fresh-worker-slot.py` (pinned) before the verifier, moving
  every entry of `r<N>` except the three prepared files into `r<N>.attempt-<k>/` (nothing deleted). Installed
  and qualified on 2026-09-29 (`operator-admin/atcs-v13/`, wrapper sha `9f54c9cd...`): the Pack's
  `xtop-operator` binding and the Permit name v13 (`sites/linglong-atcs28/README.md`). Under v13 a close the Harness
  records as `process-survived` still needed a person to end the wrapper's process and container (a v12
  limitation that v13 kept; see G43's and attempt 1's D-T01-3); v14 ends it (G51). Proving tests: `sites/linglong-atcs28/test_verify_worker_startup.py`
  `RetrySlotTest` on the retained listing (RED: 5 of 6; the sixth characterizes the reuse and the refusal).
- G50 (Issue #64 treatment Run run-9a5f197a, D-T01-1; **known limitation, not fixed in 0.2.0**)
  `atcs_paths <check> <N> <end points>` fails in the Operator's PBA session: it hands XTop
  `get_paths -delay_type max|min -end_points ...` as the path argument of
  `analyze_<check>_path_violations`, and real XTop answers "Error: In PBA mode, only path collections
  can be accepted. Please check if the given path collection is valid." (w01 record #185,
  `xtop_log_1.txt:405-408`; w03 `xtop_log_1.txt:166-169`). `atcs_paths` with no end points still reads
  the top paths, and `atcs_gain` reads endpoint slack. The fix belongs to
  `flow/templates/xtop-operator.tcl`, which the atcs-v12 wrapper's flow digest (`a4736851...`) pins, so
  it needs a new wrapper release and its requalification, not a byte change under v12.
  `flow/tests/test_xtop_toolkit.py` `PbaEndPointPathsKnownLimitationTest` pins the exact message, and
  its `expectedFailure` test turns into an unexpected success once the fix lands.
- G51 (Issue #64 treatment attempt 2, D-T02-2; Site side, no flow change) Every close ends the container.
  v13 ran `podman run` in the foreground, so its HUP/TERM trap could fire only after podman returned. XTop
  is the container's PID 1 and ignores TERM, so every Harness close (hangup, then TERM to the Job's process
  group) left the container and its XTop running: w01 and w02 became `process-survived` blockers, and a person
  ran `podman stop` (SIGKILL after 20 s). The `atcs-v14` wrapper (`sites/linglong-atcs28/atcs-xtop-operator-v14.sh`)
  runs the container in the background and waits on it. HUP, TERM, INT and EOF on stdin all run one close:
  `podman stop -t 20` in its own session (so the Harness's group TERM cannot cut it short), then `podman rm`
  if needed, then a check that no process of the container's pid namespace and not the recorded XTop pid
  remains, and only then exit 0 (exit 5 if something remains). The container name and XTop pid are written
  to `<slot>/session.json`, which the next attempt's slot step retires with the rest. Installed and
  qualified on 2026-09-29 (`operator-admin/atcs-v14/`, wrapper sha `2f4ced1a...`): the stdin-EOF close and
  the SIGTERM close each end a real XTop session in about 21 s with exit 0 and no container or XTop process
  left. The Harness's own close watcher, replayed under tmux on a zero-EDA stand-in, reads `gone terminate`
  at 20.6 s, inside its 25 s window; the same replay on v13's bytes reads `survived`. Proving tests:
  `sites/linglong-atcs28/test_verify_worker_startup.py` `WrapperCloseV14Test`, and the Site qualification
  (`sites/linglong-atcs28/README.md`).
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
  Issue #64 Task 6: a recipe batch (merged or control arm, auto-fix included) seals its new nets only
  when every added instance is accounted for, else `newNets: null` with `newNetsUnknown`; its
  pre-check records `predictive: false` whenever a new net is unknown or unqualified and never
  gates (`presta-model-qualified` reads `tc_presta_gate_net_count`, 0 for a recipe batch), so the
  batch proceeds to `implement` and refreshed PrimeTime judges it.
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
- G23 (Tasks 15, 17) The XTop Operator runs an active slot only interactively (since Issue #64 Task 5
  the tool is `hybrid`: its batch path is the Pack's `operate-parked` no-op, never XTop; since #64
  Track B the `xtop: 1` seat is declared as `interactive.licences`, so that no-op holds no licence and
  only the Operator's session does); its settlement in a real Run is unproven.
  A stranded worker Team (a required member ended without a result) settles its operate execution
  `failed` whatever the tool mode (Harness fix "settle stranded Team executions regardless of tool
  mode", `test/contract/delegation-team-settlement.host.test.ts`); the owner begins the node again
  for fresh Team identities (`knowledge/agent-team.md`). Task 15's Site wrapper (`sites/linglong-atcs28/atcs-xtop-operator.sh`, contract
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
- G35 (Issue #64 final review, decision 5) Worker Team members get only a condensed copy of the
  expert knowledge, in their `taskTemplate`: a Pack Agent Team member declares `inputs` (recorded Run
  outputs read through `hima_delegation_input`) but has no knowledge list, and
  `workshop.ts:knowledgeForWorkshop` serves only a Workshop's declared `knowledge`. So the
  Researcher, Reviewer and Operator cannot read `knowledge/xtop-expert-operator.md` itself; the
  slot's research Workshop (`research-worker-NN`) reads it and writes the request they work from.
  Closing the gap needs a generic Harness seam for declaring Pack knowledge on a Team member.
- G36 (Issue #64 Track B, ported from #63 slice 2 and its Goal fix) The physical-refresh cap is
  the Goal value `max_physical_refreshes` (count, 1..4, default 2 -- the two refreshes of the #64
  deal, integer), admitted once when the Run is created, so no next-strategy decision or revision
  can raise it. Live02 spent both generations on two `revisit-research` decisions with zero
  refreshes: the generation limit bounds revisits, not refreshes. The reader `atcs-refresh-budget`
  on output `workingState` (the anchor; the ledger does not exist before the first refresh and the
  Harness blocks on a missing report) emits `tc_refreshes_completed` from `state/refresh-ledger.json`:
  known(0) with no ledger and no STA receipt or archive, the verified entry count otherwise, unknown
  for a lost, corrupt or tampered ledger. `read-refresh-budget -> check-refresh-budget` sits between
  `check-presta-model` PASS and `implement`, `read-refresh-budget-apr -> check-refresh-budget-apr`
  before `apr-prepare`; `revisit-implement` and `revisit-earlier-apr` enter at the reading (a Judge
  takes the latest reading Run-wide, so each gate reads afresh). FAIL and UNDETERMINED stop at
  `wait-for-person`, whose clearance ends the Run. Graph now 136 nodes / 178 edges; proving tests
  `flow/tests/test_refresh_budget.py` and the ATCS contract test.
- G37 (Issue #64 Track B, ported from #63 slice 3 gap 1) Itemized refusals. Live02's plan was refused
  at 41 problems and the owner saw only the count. Every request kind of `tools/read-atcs.py` returns
  one problem string per counted problem (`problems()`), each starting with its field and slot and,
  where a format is required, stating it; `main()` writes them beside the document as
  `<document>.problems.txt` before OUT (the refusal reason when a companion's identity does not
  verify). Ten outputs `<output>Problems` (observation request, campaign plan, worker requests
  w01..w06, integration plan, next decision) declare those files with no reader; each producing
  Workshop reads its own, and `evaluate-next-investment` also reads the campaign-plan and
  integration-plan ones, whose FAILs route to it. A document of the wrong shape, a worker request
  for another slot, and an edit-domain instance or target pin the base netlist does not hold are
  now counted problems instead of Reader exceptions (which re-read the same bytes until a Hard
  blocker parked the Run); fail-closed identity (`baseState`, `facts`) stays a refusal. Proving
  tests: `flow/tests/test_request_problems.py` (the live02 plan bytes, `flow/tests/live_fixtures/`,
  itemized at exactly 41) and the ATCS contract test.

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
  - **Pending re-review**: this FABRIC.md's own G27-G33 and the four batches' combined diff have not
    yet had a second reviewer pass since batch C landed.
- 2026-09-29 reshape (ADR-0016, #64): the generation is plan → six self-driving branches → merge →
  one refresh → evaluate → automatic re-observation → one owner decision. The Reviewer is optional
  advice, the Operator is materialized from the admitted request with every field embedded in its
  task, an Operator-requested close settles its node done, and capture reads exactly the dump names
  the Operator template states (`before.dump`, `after.dump`). No re-review loop by direction; the gate
  is the green Pack suite, the contract tests and the dry path's measured wall time.
- 2026-09-30 ATCS-09 (#66, parent #64; tickets #67-#75): six-seat batch manual ECO plus the complete
  Global Auto-Finish, against the complete Global Auto-Finish alone. D1 cluster seating
  (`read-atcs.py seat-clusters`, cluster shape as Reader advice; #68), D2 in-session local-topology edit
  domain and D3 `atcs_point` with the `reads.jsonl` read log and `atcs_export_changes limitations`
  (#67), D4 batch Contribution seal (`effectiveDomain`, per-command gain and blockers, `aggregateGain`;
  #71), D5 composition by blocker coverage then aggregate gain (#72), D6 replay and reconcile on the
  effective domain with `appliedCommands`, `skippedCommands`, `protectedCount` and the `manualValue`
  tie record (#73). Superseding user decision (2026-09-30, #64, branch `atcs09/R`): replay is an
  aggregator, not a second methodology judge. Every sealed Contribution of a completed private
  session enters ranked replay; the seal refuses only a tainted session (`tainted`; T06 repairs,
  branch `atcs09/P`), and records `trace-mismatch`, `out-of-scope`, `no-predicted-gain`,
  `breaks-target-check`, `breaks-opposite-check`, `missing-gain-line` and `missing-export` as
  batch-net `advisories`; composition keeps the ranking, has no `domain-collision` exclusion (an
  overlapping command is skipped by itself, `shared-instance`/`depends-on-skipped`) and still
  excludes `base-dump-mismatch`; replay attempts every command in rank order under its own catch and
  records each skipped one with its reason (the legacy step replay continues past a failing step
  too); reconcile makes an arm unsafe only for corrupt evidence and records a replay delta mismatch,
  a missing session dump and an out-of-domain replay change as `warnings`
  (`replayMismatch`, `replayDeltaMissing`, `outOfDomain`). Applied instances are `set_dont_touch`
  protected, then the four-pass Global Auto-Finish runs byte-for-byte unchanged. The typed command
  surface and the Site Permit bound what executes; the refreshed Innovus/StarRC/PrimeTime result plus
  DRC/connectivity judges quality. The dry path proves it on a planted overlap (both batches ranked,
  the later sizing of the shared buffer skipped with its reason). D7 the Operator prompt and budgets (#74: `atcs-worker-NN`
  version 6 risk-assesses every target, works the cluster point to point hardest first, keeps every
  measured gain, undoes every regression at once and hands over one batch; share 40 min, 4
  follow-ups, 12000 tokens a turn; `SCOPE_MAX_MUTATIONS` and `reviewedAction.maxMutations` 600; the
  author's turn 48000 tokens and reads only its package, residual cases and the worker-request
  example), D8 the `workerSlots 0` control arm (#69), D9 `budget.minimumGenerations` 1 for the
  one-generation, one-refresh experiment (#74; kits and brief outside the Pack). The Harness seams
  H1 (reviewed-scope cap 600) and H2 (recipe Operator share honoured; output-less turn follow-up) are
  #70 and are required by D7's bounds. The gate is the green Pack suite and the ATCS contract test at
  the merged head; the dry-path derived-domain fixture (#75), the wrapper v16 re-pin and the live
  T05 / C-full record follow on #64.
