# Agentic Timing Closure System — handoff

Current integration scope (2026-09-27): one bounded post-route sizing worker uses the frozen #52
Agent Team seam. The existing Workshop plan remains reader-backed; Researcher results travel as
retained dependencies without Runtime projection. See
[bounded integration evidence](../../assessment/2026-09-27/atcs-bounded-integration.md) and
the Pack's `knowledge/agent-team.md`. The current graph routes w01 directly to collect; imported
w02/w03 definitions remain parked. Three-worker optimization and real-tool qualification are pending.

> **Polishing integration baseline (2026-09-27):** imported onto
> `main@fda5493ff699742d934a54aa487ac4b3c0cfe6ec` from the fixed source
> `claude/himapack-development-c56369@a9b2e8812baac73b8a6f5e0eb861e67e15b85270`.
> The source branch and its 79 development commits remain historical evidence; current `main` and
> `docs/specs/atcs-delivery-v1/` are the integration authority.

Entry point for an agent taking over the HimaPack `agentic-timing-closure-system` (ATCS): what it is, where
each part lives, the invariants an adaptation must keep, and the test-and-acceptance workflow on a real Hima
Harness. How it was built, and why it looks the way it does: [DEVELOPMENT_HISTORY.md](DEVELOPMENT_HISTORY.md).

## What it is and where it stands

ATCS closes setup/hold timing on a routed Innovus design. It does not do what the frozen B_lazy Pack
(`packs/xtop-timing-closure`) does, which is one global auto-fix per generation. Instead it:

1. splits the residual problem into bounded work packages;
2. has up to three workers research and edit in private XTop sessions;
3. seals each worker's real edits as an ECO **contribution**;
4. merges complementary contributions semantically;
5. replays the merged set in one integration session;
6. implements it once through Innovus, StarRC and PrimeTime;
7. adopts the result only on complete, same-candidate evidence.

When local ECO stops paying, it can instead choose an earlier APR stage, but only in full-flow scope.

**Status (2026-09-26):**
- **Stage:** `compiled`. `loadPack` accepts it, and `checkPack` is fit against the local Site and
  `sites/linglong-atcs28`.
- **Tests:** the Python suite passes (821 tests, 13 skipped), the Harness contract test passes, and the Pack's parsers were
  run read-only against real linglong reports.
- **Not yet done:** no real EDA job has run, no Campaign has been started, and no `TEST.md` or `VERSION.yml`
  exists.
- **Scope of the final review's verdict:** the code is ready for a bounded, GBA, post-route-only real-tool
  qualification. It is **not** qualified for full-flow APR or for XTop worker research quality.

**Branch:** `claude/himapack-development-c56369` (code complete at `d57ba92`, 79 commits on `main@dce8475`).

## Read before changing anything

1. `packs/agentic-timing-closure-system/SPEC.md` is the authority for business behaviour: Goal, Constraints,
   Run contract, `tc_*` Semantics, Judge rules, Choosers, Endings and Workshops. `INTENT.md` holds the
   confirmed author decisions and the Golden Flow.
2. `packs/agentic-timing-closure-system/FABRIC.md` records what was compiled, **every known gap (G1–G34)**
   and the review history. Read the Gaps before promising any behaviour.
3. `docs/package-development/THE_DEVELOPMENT_OF_HIMA_PACK.md` gives the general Pack rules, and
   `.superpowers/sdd/pack-mechanics.md` gives the Harness schema with `packs.ts` line numbers. The second
   is gitignored scratch and may be absent; regenerate it from `packages/harness/src/packs.ts` and
   `packages/harness/skills/knowledge/pack-anatomy.md`.
4. The user's source design documents live outside the repo:
   - `/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/`: `HIMAPACK_SPEC.md`,
     `AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`, `EDA_SERVER_TOOLS_AND_EVIDENCE_GUIDE.zh-CN.md`,
     `HIMAPACK_DEVELOPMENT_SPEC.zh-CN.md`, `OPERATOR_EXECUTION_AND_APR_PLAYBOOK.zh-CN.md`.

## Map

| Path | Responsibility |
| --- | --- |
| `packs/agentic-timing-closure-system/contract.yml` | Inputs (`designStateManifest`, `analysisContract`, `siteCapabilities`, `workspaceRoot`), 35 declared outputs (most with Readers), tools and exact argv, 5 Workshop families (worker ×3), licences, budget (24 h), Goal `target_setup_wns_ns`/`target_hold_wns_ns` (max 0.0), Strategy `maxPaths` |
| `graph.yml` | Reference graph: 106 nodes, 143 edges. Judges route on `rules[0]` only, so compound predicates are chained Judges |
| `rules/`, `choosers/` | 23 single-predicate rules (SPEC ids plus `-part` splits and `next-action-*` routing); `atcs-goal-met`, `atcs-revisit` |
| `semantics.yml`, `readers/`, `tools/read-atcs.py` | 26 `tc_*` value types. 17 Reader declarations, all backed by one fail-closed script that re-verifies schema, id digest and source sha256. The envelope shapes are listed in its top comment |
| `flow/atcs/core.py` | Canonical digest, stamped artifacts, `Measure` (`{"value"}` or `{"unknown": reason}`), `AtcsError`, `require` |
| `flow/atcs/reports.py`, `state.py` | M1: PT report parsers, design state, input readiness (full-flow vs post-route-only), observation capture, check comparison |
| `flow/atcs/workspaces.py` | M2: work-package validation, private idempotent worker workspaces |
| `flow/atcs/contributions.py` | M3: seals trace + native before/after dumps + scope into a contribution |
| `flow/atcs/composition.py` | M4: duplicates, conflicts, interactions, stale base, order |
| `flow/atcs/integration.py` | M5: plan validation, idempotent replay, reconciliation, merge commit, XTop/Innovus ECO Tcl |
| `flow/atcs/verification.py` | M6: check plan, PT pre-check qualification, final evaluation with the per-scenario identity chain |
| `flow/atcs/adoption.py` | M7: CAS publish into working, best and delivery pointers |
| `flow/atcs/experience.py`, `residual.py`, `refresh.py` | M8 experience ledger, residual cases, physical-refresh ledger |
| `flow/atcs/lifecycle.py` | Residual case → Innovus stage intervention and APR stage task (full-flow only) |
| `flow/atcs/adapters.py`, `flow/templates/` | Tool-task compilers, path-detail and SPEF parsers, PT/StarRC/Innovus/XTop Tcl |
| `flow/atcs_cli.py` | The one entry every tool node runs: `python3 ${WORKSPACE}/flow/atcs_cli.py <subcommand> …`. Its docstring holds the authoritative argv table, output-path table and exit codes (0 ok, 2 input, 3 refusal, 4 tool failure) |
| `flow/tests/` | Python suite (stdlib `unittest`). `fixtures.py` synthesizes real report grammar |
| `knowledge/*.md` | 10 method notes, each with Source / Applies when / Changes this decision / Counterexample. Tool commands are marked *documented*, not *qualified* |
| `sites/linglong-atcs28/` | Site (`site.yml`, `permit.yml`), admin XTop wrapper template, input templates under `inputs/`, admin README |
| `test/contract/agentic-timing-closure-system.test.ts` | Harness contract test: load, fit, `/hima pack check` via in-process Host, the Python suite, and forbidden-path scan |
| `scripts/atcs-corpus-preflight.py` | Read-only real-report parser check over SSH; writes no report content locally |
| `docs/assessment/2026-09-26/atcs-qualification/corpus-preflight.md` | Corpus results: paths, sha256, outcomes, fixes |
| `docs/package-development/agentic-timing-closure-system/b-lazy-freeze.md` | Frozen B_lazy baseline identity for the comparison |
| `docs/superpowers/plans/2026-09-26-agentic-timing-closure-system.md` | Original implementation plan (Tasks 1–18). Superseded in detail by review decisions (see history) |

## How a Campaign moves

Node ids come from `graph.yml`.

**Start.** Every run begins with the same prefix:

```text
bind-inputs → check-inputs → baseline (stages DB/netlist/DEF/SPEF/SDC into workspace/baseline/)
  → observe-baseline → policy (runtime acceptance policy, Goal from the Run)
  → physical-baseline (this Pack's own DRC/connectivity) → risk-baseline → residual-baseline
  → decide-next (Workshop: next-decision) → read/check → route-<action>
```

**Routes out of decide-next.** Each `tc_next_action` code has one route:

| Route | What it runs |
| --- | --- |
| `observe` | diagnose Workshop → admitted observation request → PT query |
| `research` | plan Workshop → admitted campaign plan (3 work packages) → prepare-workers → for w01..w03 **sequentially**: worker Workshop → admitted request → XTop Operator (interactive) → capture-contribution |
| `compose` | collect → compose-facts → compose Workshop → admitted integration plan → compose-facts (second pass) → composition-ready → replay-prepare (XTop batch replay) → reconcile → replay-consistent → presta → presta-model-qualified |
| `implement` | Innovus ECO → StarRC extract → full STA (+ bounded recheck) → physical → evaluate → coverage / identity / constraints / setup / hold Judges → adopt → artifact-ready → residual → record-experience → decide-next |
| `earlier-apr` | full-flow only: apr-prepare → apr-run → joins the implement chain at extract |
| `goal-met` | re-read acceptance and evaluation → all seven final rules → close |
| `wait` | the single `wait-for-person` node |

**Termination.**
- **Goal-met** needs coverage, identity, zero constraint failures, zero unknowns, setup goal, hold goal and
  artifact-ready, all on the same candidate's readings in the same Generation.
- **Budget exhaustion** is the Runtime's own ending.
- **Wait** needs a stated blocker.

## Invariants every adaptation keeps

- **Fail closed.** Missing, truncated, duplicated, non-finite, or identity-mismatched evidence becomes
  `unknown` or an `AtcsError` refusal. It never becomes 0 or PASS.
  - Counts are 0 only when the data proves zero.
  - PT's own `VIOLATED` verdict outranks a displayed `-0.00`.
  - A WNS that contradicts the violation count is unknown.
- **Admitted bytes.** A tool consumes a model-written file only if it is the exact document a Reader
  admitted: one campaign plan (`candidate.workPackages`) and one integration plan. Edit domains come from
  `state/workers.json`, PT inputs from the verified working state, and the policy from `policy` (Site
  static terms, Goal from the Run, run-time baseline fields).
- **Design-state ids.** Every state id is an M1 design-state id: `baseStateId`, `parentStateId`,
  `expected_base`, pointers and `evaluation.stateId`. The merge-commit or APR-task id is provenance only.
  Each candidate's observations are labelled with its own state id and archived under `observations/<id>.json`.
- **Write-once originals.** `implementations/<id>/`, `apr/<stage>/<id>/`, `integrations/<batchId>/` and
  `research/{observe,residual}/<scenario>/g<N>/` are never overwritten. A failed implement attempt is moved
  aside, and a completed one refuses re-implementation. Declared outputs are fixed `state/*.json` entry
  files that reference those originals by path and sha256.
- **Harness unchanged.** Business behaviour lives in the Pack. Anything the schema cannot express is recorded
  as a FABRIC gap, never patched into `packages/**` or hidden in a background process.
- **No customer or PDK content in git.** Fixtures are synthetic; real reports are read over SSH, read-only.
- **B_lazy frozen.** `packs/xtop-timing-closure` and `sites/linglong-swerv28` are read-only references.

## Verify locally

`.claude/worktrees/…` is a git worktree; run from its root. Node 24 is required.

```bash
python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests
```

```bash
export PATH="$HOME/.local/node24/bin:$PATH" && pnpm run build && node scripts/run-contract-tests.mjs local --files test/contract/agentic-timing-closure-system.test.ts
```

```bash
pnpm run check:boundary
```

All three must be green after any change. Update the contract test's node/edge counts (106/143) when
`graph.yml` changes.

## Adapting to another design or Site

Most adaptation is **Site-side data**. Pack-side edits are rarely needed.

1. **Site inputs.** Copy `sites/linglong-atcs28/inputs/` and fill them in for the new design. Shapes are in
   `contract.yml` input descriptions and the Site README.
   - `designStateManifest.json`: top, stage, `.enc` plus a matching `.enc.dat` (name = enc + `.dat`),
     netlist, DEF, per-corner SPEF, SDC, libraries, scenarios, and an optional `lifecycle` index. Without a
     complete lifecycle index the scope is post-route-only.
   - `analysisContract/scenarios.json`: per scenario `name, corner, libGlob, driverLibrary,
     originalDriverLibrary`. This is the single source of corners and PT libraries.
   - `analysisContract/corners.json`: `{corners: {corner: StarRC command template path}}`.
   - `analysisContract/query-spec.json`: `precision: gba` for first tests, plus `nworst`.
   - `analysisContract/policy.json`: static terms only (`allowDegradedWorking`, `degradeLimitNs`,
     `maxNewConstraintFailures`).
   - `analysisContract/recheck.json` = `{}`.
   - `siteCapabilities.json`: `edaShell`, `design`, `techLef`, `cellLefGlob`, `pgVerification`, plus
     `xtopContext` (scenario Liberty globs, site map, removable fillers and ECO parameters).
2. **Site files.** Create `sites/<new-site>/site.yml` (bindings, `workspaceRoot`, ssh, `parallelJobs`, one
   licence each for `innovus`/`primetime`/`starrc`/`xtop`) and `permit.yml` (read roots covering every
   input and LEF root; the write root is the Campaign workspace only; the declared wrappers).
3. **Scenario portability (G33 closed in ATCS-05).** Scenario names come from `scenarios.json`; the
   query, derived policy, PT tasks, evaluation and refresh ledger must all name that exact set. A new
   Site supplies its own names and corner/library mappings without changing Pack business code.
4. **Done when:**
   - `checkPack` is fit against the new Site;
   - `/hima pack check agentic-timing-closure-system --site <new-site>` succeeds in a Host;
   - the Python suite and the contract test are green (add the new Site to the test if it should stay
     covered).

## Test-and-acceptance workflow on a real Hima Harness

Run the levels in order. Each level must be green before the next one starts: cheap evidence before
licensed time. Ask the user before every commercial job.

**Before level 1, the administrator:**
- creates `/data/eda/project/hima_harness/{atcs-inputs,atcs-runs,operator-admin/atcs-v2}`;
- installs the Site inputs into `atcs-inputs/`;
- sets `/data/eda/env/empyrean-license-mode` to `old`, which XTop needs (coordinate: it affects the
  shared server);
- fills in the v2 wrapper's image digest, `atcs_cli.py` hash and complete `flow-digest`;
- after ATCS-03 integrates the v2 wrapper path into `contract.yml`, fills the v2 environment evidence,
  generates the binding with `scripts/generate-xtop-operator-binding.mjs`, and sets
  `interactiveBindingsFile`.

The Site README has the full procedure.

1. **L0–L2 local.** Run the three commands above. *Done when* all are green on the exact commit being
   deployed.
2. **Real-input preflight.** Run `scripts/atcs-corpus-preflight.py` against the new design's reports, if
   the design changed. *Done when* every refusal is either fixed with a synthetic fixture or documented as
   a correct fail-closed outcome in a corpus-preflight record.
3. **L4 tool qualification.** Run one bounded job each in a fresh `atcs-runs/qual-*` directory:
   - PT query/presta on the baseline;
   - StarRC on one exported DEF;
   - Innovus restore → two-op ECO → export → instance→master readback;
   - the XTop Operator session: read, mutate, save and close allowed; source/exec denied.

   *Done when* each job's command, exit code, artifacts and hashes are recorded in
   `docs/assessment/<date>/atcs-qualification/tools.md`.
4. **L5 bounded Campaign.** Use `packages/harness/skills/hima-test/SKILL.md`:
   - `hima_pack_check`, then `hima_run` with `test: true`, `site: linglong-atcs28`,
     Goal `target_setup_wns_ns=0.0` and `target_hold_wns_ns=0.0`, and Strategy defaults;
   - drive it with `hima_context`/`hima_execute` as the visible Campaign owner;
   - for a desktop user journey, use the `himaharness-human-like-tester` skill (Catsights, one Electron
     suite at a time).

   First-acceptance target (from the development spec): on one real base state, two complementary worker
   contributions, one shared-precondition revision, and one joint implementation plus full refresh that
   the Judges accept or honestly refuse. *Done when* the Run is terminal with a declared ending.
5. **Record and compare.** Write `TEST.md` from `hima_status` only (sections Site, Run, Ending,
   Generations, Code, Refusals, Disagreements). Record the B_lazy same-oracle comparison separately,
   against the identity in `b-lazy-freeze.md`. A mechanical pass is not a speed-up claim while G1
   (sequential slots) stands.
6. **Release.** Run `/hima-release`, which calls `hima_pack_release`; it generates `VERSION.yml`. Nobody
   hand-writes it. *Done when* the digest reads back, install/upgrade preview is valid, stale review is
   refused, and rollback is verified.

## Known limits that shape a first test

These are from FABRIC; the Gaps section is authoritative.

- **G1:** worker slots run sequentially, and every round runs all three before `collect`. This is not the
  SPEC's dynamic batching, and it costs an XTop session even for a no-fix slot.
- **G2:** a refused worker request skips its slot; there is no per-slot revise loop.
- **G3:** there is a single wait node.
- **G5:** `maxPaths` resets to its default on each revisit.
- **G17, G29:** full-flow APR runs end to end in tests, but the Foundation stage pre-steps (CTS spec,
  `FF/procs.tcl`) are unverified. Use post-route-only scope for the first test.
- **G19:** presta always finds a batch's new nets unqualified against the base SPEF, so insertion batches
  reach implement only by an explicit decision.
- **G23, G34:** the XTop Operator is interactive-only and unproven in a real Run. ATCS-04 now gives
  worker and replay the same hash-bound timing library, current PT timing data and legality/ECO settings,
  but the v2 wrapper path still needs ATCS-03 contract integration and L4 qualification before worker
  research can be judged.
- **G25:** the Goal cannot demand a positive margin. PT reports a clean mode as `No violations found`,
  which parses as 0.0.
- **G33:** code-side closed; Site-defined scenario sets are local-tested, while real alternate-Site
  qualification remains future evidence.
