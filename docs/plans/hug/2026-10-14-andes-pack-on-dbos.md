# Porting `andes-cell-fmax` + `eda_cluster_ctu_01` onto HUG-DBOS

Investigation only, no commits. Source branch `demo/andes-openc910` (worktree
`.hima-tmp/worktrees/andes-ui`). Target `HUG-DBOS` (`.hima-tmp/worktrees/hug-dbos`),
`harnessVersion = '0.3.0'` (packs.ts:841). Pack scratch-copied to
`.hima-tmp/worktrees/hug-port/packs/andes-cell-fmax`; load/compile/checkPack run against the
**built** harness `packages/harness/lib/index.js` with Node 24
(`/Users/lluzi/.local/node24/bin/node`).

## Commit-safety boundary (verified first)

- `grep -rIl <foundry-prefix pattern>` hits exactly one pack file:
  `packs/andes-cell-fmax/knowledge/design-notes.md` — **git-ignored** on demo
  (`git check-ignore` confirms) and generated from real OpenC910 data. Keep it ignored; never commit.
- Site `mock-eda/bin/*` and `mock-eda/lib/ctu_mock/*` (10 files) are tracked and **clean**.
  `mock-eda/share/designs/openc910/**` is fully git-ignored (0 tracked). site.yml/permit.yml/
  engineering-capabilities-ctu01.json are clean. The CLIs honour `CTU_OPENC910_DATA`
  (ctu_mock/openc910.py:48) so a dry route can point at a synthetic bundle, not the real one.

---

## Q1 — Does the Pack load/compile on HUG-DBOS?  VERDICT: NO as-is; YES after 3 mechanical edits.

`loadPack` → `loadPackFrom` (packs.ts:1947). The Pack has no versioned `flow:` graph, so it takes
the legacy path: `packGraph.parse(graph.yml)` then `compileLegacyFlow(graph, contract, …)`
(packs.ts:1961,1981; flow-compiler.ts:309). Running the real loader surfaced refusals in order:

1. **contract.yml top-level keys `reports` and `results`** — `ZodError unrecognized_keys`.
   `packContract` (packs.ts:721, strictObject) has neither key, and nothing in the harness reads
   `contract.reports` or `contract.results` any more (grep: no consumers; no HUG-DBOS pack declares
   them). Both concepts were dropped from the contract.
2. **every graph node carries `label:` + `about:`**, and **every `autopilot` segment carries
   `label:` + `about:`** — `unrecognized_keys` ×22 nodes + ×4 segments. `packNode`
   (packs.ts:978; act/judge/explore/wait strictObjects) and `segmentAutopilot` (packs.ts:1043,
   only `from`/`until`) accept no such fields.
3. **inline `view:` block inside graph.yml** uses `stations[].row` and top-level `hidden:` —
   `unrecognized_keys`. The HUG-DBOS view model is a **separate `view.yml`** (`packFiles.view`,
   packs.ts:75; read at 1962) validated by `packView` (packs.ts:1066): stations have
   `id/label/about/checklist/team` and the view has `title/stations/edges/metrics` — **no `row`,
   no `hidden`**. (MAGE ships `packs/mage-scribe-placement/view.yml`, not inline.)

After removing `reports:`/`results:` from the contract, the node/autopilot `label:`/`about:` lines,
and the inline `view:` block, the Pack **loads and compiles cleanly**:
`flow.source = legacy`, 22 tasks, block kinds `{sequence:29, task:22, choice:6, parallel:2,
repeat:1}`. `validatePack` (fork-shape, explore, outsourcing, readers/semantics, charts, rules,
minimumHarnessVersion 0.2.2 ≤ 0.3.0) passes. `design-notes.md` being absent does **not** block load
(top-level `knowledge:` is advisory; no `knowledgeManifest` declared) — but it is needed at runtime
for the Guide's first conversation, so it must still be regenerated on the host.

## Q2 — hima-flow/1 constructs used, and DBOS support.  VERDICT: all used constructs supported.

The legacy graph uses: `act`/`judge`/`explore`/`wait` nodes; **two forks** (`read-timing` →
`himatime-agent` ∥ `qualib-agent` join `requirements-joined`; `generate-cells` → `himatime-verify`
∥ `qualib-screen` join `cells-verified`); a **revisit loop** (`next-round` → `load-timing`);
`explore` with `chooser: andes-next`, `bind`, `converge {read:bestWns,…}`; six `observes` Reader
act-nodes; judges with `rules`/`bind`; charts (`*.chart.json`); the (now-moved) `reports.dir` and
`results`; and the inline `view:`.

`compileLegacyFlow`/`lowerLegacyFlow` (flow-compiler.ts:309–465) lowers all of these into
`hima-flow-ir/1`:
- **Forks → `FlowParallel`.** flow-compiler.ts:397–417 detects an act node with >1 outgoing edges,
  builds a `parallel` block with one `required` branch per edge and a join. Confirmed empirically:
  compiled IR has `@read-timing/parallel` (branches himatime-agent, qualib-agent) and
  `@generate-cells/parallel` (himatime-verify, qualib-screen). Fork legality is enforced by
  `forkFrom`/`validateForkShape` (packs.ts:2686,2782): branches must be act-only and converge into
  one judge — the andes forks match exactly (single resident act per branch, judge join).
- **Revisit → `FlowRepeat`** with a `strategy` carry (flow-compiler.ts:422–433). Confirmed:
  `@andes-cell-fmax/repeat`, entry `next-round`.
- **explore/judge → `FlowChoice`** (flow-compiler.ts:384–395); `converge`/`chooser`/`bind` ride in
  the task's `legacy` blob to the explore adapter.

**Two resident engineering tasks in parallel — SUPPORTED.** At runtime the DBOS flow workflow runs a
`parallel` block by starting every branch as a child workflow *before* joining:
flow-workflow.ts:331–345 (`startWorkflow` per branch, then `Promise.all(getResult())`; comment
"All branches have been started before any is joined: actual execution overlaps"). Each branch task
whose contract tool has `outsourcing` resolves to `residentEngineeringTaskAdapter`
(durable-task-adapters.ts:139–151). So the himatime-agent ∥ qualib-agent fork runs two resident ACP
sessions concurrently; the join waits for both. This is the same shape the MAGE Pack exercises
serially — the andes forks add genuine concurrency, which the parallel block already provides.

## Q3 — Readers under DBOS retained-copy delivery.  VERDICT: NOT broken on current HUG-DBOS.

Two reader families:
- **Report-only readers** `read-reference.py`, `read-timing.py`, `read-round.py`
  (`argv: [${READER}, ${REPORT}, ${OUT}]`) open only `${REPORT}`. Safe anywhere.
- **Workspace-reconstructing readers** `read-requirements.py`, `read-plan.py`, `read-verify.py`
  (`argv: […, ${REPORT}, ${OUT}, ${WORKSPACE}]`) **hard-assert** the report path equals the
  campaign path: e.g. read-verify.py:35 `if realpath(report_path) != realpath(join(workspace,
  "state", name)): raise`; read-requirements.py:28–29; read-plan.py:22. They then import
  `<workspace>/flow/andes_cli.py` and call `cli.validate_*` which re-reads `<workspace>/state/*.json`.

This is exactly the custom-cell-fmax read-recipe.py failure mode — **but it was fixed**. The current
adapter version is `hima-task-effect/2` (task-effects.ts:20). durable-task-adapters.ts:204 sets
`report = join(product.workspace, outputPath(declared, bindings))` and 221 binds **`${REPORT}` to
that real workspace path** and `${WORKSPACE}` to the workspace (comment 218–220: "`${REPORT}` is the
output the contract pointed at, where it lies … the retained copy stays the identity record").
So `${REPORT}` = `<workspace>/state/<name>.json` and the equality asserts **pass**. The retained copy
(retainBytes, :184) is only the tamper-identity record; collection re-checks the bytes didn't change
(:235–236). The custom-cell failure was pre-/2 (trial.46).

Crucially the resident delivery is materialized **to that same workspace output path**:
engineering-executor.ts:225–226 `producedPath = join(workspace, outputPath(produced, bindings))`,
handed to the resident as `constraints.output.path` (:233). So both `${REPORT}` and the validator's
`<workspace>/state/<name>.json` resolve to the delivered file. MAGE's read-mage.py uses the same
pattern (reads the `${REPORT}` delivery slot, uses `${WORKSPACE}` only for `flow/` — read-mage.py:356),
and it runs on DBOS today.

Residual risk (verify in a dry run, do **not** pre-emptively edit the readers): the asserts and the
`cli.validate_*(workspace, …)` re-read assume the delivery is physically present at
`<workspace>/state/*.json` at Reader time. Confirmed by code; must be reproduced live.

## Q4 — Site `eda_cluster_ctu_01` on HUG-DBOS.  VERDICT: Site files fit; remote wrapper must be refreshed.

- **Schema + fit: PASS.** `loadSite` parses site.yml (`kind: ssh`, `bindings`, `ssh`, `capacity`)
  and permit.yml with no error, and `checkPack(pack, site)` returns **`fit: true`, `errors: []`,
  `licences: []`** (capacity.licences `{}`, Pack declares no licences).
- **Capability JSON matches the schema exactly.** `engineering-capabilities-ctu01.json`
  (`schema hima-resident-engineering-capability/1`, `protocol hima-resident-engineering/1`) has the
  exact top-level key set `engineeringCapability` requires (engineering-executor.ts:24): schema,
  protocol, wrapper, native, sandbox(podman), environment{inherit,set,toolPaths,credentialReadPaths},
  delivery{candidate}, stopGraceSeconds. No missing/extra keys.
- **Resident wrapper is a REMOTE artifact**, not in the Site folder: permit allowedWrappers +
  capability `wrapper.argv[0]` =
  `/data/eda/project/hima_harness/operator-admin/resident-engineering-ctu01/resident-engineering-wrapper.py`.
  The repo's reference template is `sites/linglong-atcs28/templates/resident-engineering-wrapper.py`.
  **The demo vs HUG-DBOS template differs substantially** (`diff` is large): HUG-DBOS adds the
  signed-`state.json` **`activity`** display (richer `action_phrase`/`command_phrase`;
  engineeringStateBody.activity, engineering-executor.ts; consumed by resident-activity.ts
  `noteResidentActivity`), a **delivery/release re-affirmation** block that reconfirms the candidate
  digest without replaying engineering (wrapper lines ~1294–1317 — important for DBOS
  retained-delivery/release correctness), reply-text capture, and the `artifactPrefix` delivery
  instruction. The capability JSON itself is compatible, but the operator must **deploy the current
  HUG-DBOS wrapper template to the CTU host** (an `activity`-less old wrapper would still start — the
  field is optional — but would miss live activity and the release reaffirmation).

## Q5 — Dry-route test infrastructure.  VERDICT: demo has a PRE-DBOS dry test; a new DBOS dry route is needed.

- Demo branch ships `test/contract/andes-cell-fmax-dry-path.host.test.ts` (+ `andes-cell-fmax.test.ts`,
  support `andes-cell-fmax-0.2-graph.yml`, fixtures `cellfmax-dry-path/`). It drives the **retired**
  in-process Host (`bootInProcess`, `executionAction`, owner/autopilot model), runs the Site mock-EDA
  CLIs with `CTU_MOCK_TIME_SCALE=0`, and stands in only the model boundary with
  `sites/linglong-atcs28/tests/fixtures/acp-standin.py` (sandbox `none`, `HIMA_RESIDENT_TESTING=1`).
  It does **not** exercise the DBOS flow-workflow and will not port directly.
- The DBOS pattern to copy is **MAGE**: `test/contract/mage-scribe-placement-durable.host.test.ts`
  spawns `support/mage-resident-durable-worker.ts` (real Host + Postgres + durable runtime), with
  stand-ins only at `test/fixtures/mage-resident-dry/{prepare.py (36 lines), acp.py (373 lines)}`,
  asserts `productModelCalls == 0`, `readerJobs == engineeringJobs`, and `rounds`/`tasks` for both a
  `converge` and a `conflict` mode.

A DBOS andes dry route would need:
1. `test/contract/andes-cell-fmax-durable.host.test.ts` + a `andes-resident-durable-worker.ts`
   modeled on the MAGE worker (boot Host, install Pack, prepare Home, run to completion, emit proof).
2. An andes `prepare.py` that writes the Site inputs and a **synthetic** OpenC910 bundle pointed at
   by `CTU_OPENC910_DATA` (never the git-ignored real bundle), plus a **`none`-sandbox** test
   capability variant (`engineeringCapability` sandbox union supports `{kind:'none', testOnly:true}`).
3. An andes `acp.py` resident stand-in covering the **5 resident roles** (himatime-agent,
   qualib-agent, andescell-agent, himatime-verify, qualib-screen), drafting each delivery from
   `andes_cli.py draft` output (the Readers hold deliveries against the tools' own answer), in
   converge and conflict variants.
4. Proof assertions adapted: the two parallel forks each start before their join; one round meets the
   default +1 % Goal (so a `converge` run is ~1 round); `readerJobs == engineeringJobs`;
   `productModelCalls == 0`.

---

## Required changes — exact list

Pack `packs/andes-cell-fmax` (compile blockers, all verified):
1. contract.yml: delete top-level `reports:` and `results:` blocks. (Re-express product numbers as
   `view.yml` `metrics:` if the top line is wanted; no harness consumer otherwise.)
2. graph.yml: delete `label:`/`about:` from every node and every `autopilot` segment.
3. graph.yml: delete the inline `view:` block; recreate it as a sibling `view.yml` in the HUG-DBOS
   `packView` shape (stations `id/label/about/checklist/team`; optional `edges`/`metrics`; **no
   `row`, no `hidden`** — fold `hidden:[blocked]` by simply omitting the wait node from stations).
4. Regenerate `knowledge/design-notes.md` on the host (git-ignored; not a compile blocker but needed
   for the Guide). Readers: **no change** (Q3) — leave the path asserts; verify them live.

Site `sites/eda_cluster_ctu_01`: **no file changes** for schema/fit. Operationally: deploy the
current HUG-DBOS `resident-engineering-wrapper.py` template to the CTU host at the permit-declared
path.

Harness: **no change required** for compile/fit/parallel/reader delivery. (New work is additive test
infra only — Q5.)

## Risks

- **R1 (low, must verify live):** the three workspace-reconstructing readers + their
  `cli.validate_*` re-reads depend on the resident delivery sitting at `<workspace>/state/*.json`
  when the Reader runs. Code confirms it (hima-task-effect/2 + engineering-executor producedPath);
  a DBOS dry route is the proof.
- **R2 (medium, operational):** stale remote wrapper. An old wrapper missing the delivery/release
  reaffirmation (wrapper ~1294–1317) risks an immutable transient refusal on release under DBOS.
  Refresh the wrapper before any live Run.
- **R3 (low):** `results:` removal drops the Pack's product results table unless migrated to
  `view.yml metrics:`; purely a presentation gap, not execution.
- **R4 (process):** real OpenC910 bundle and `design-notes.md` stay git-ignored; the dry route must
  ship a synthetic `CTU_OPENC910_DATA` bundle. Never commit either.
- **R5 (low):** autopilot segments still parse and are kept on the `graph` projection, but the DBOS
  route drives the compiled IR, not `autopilotOf`; the segments are display/compat only — harmless,
  but confirm the Live view renders from `view.yml`, not the removed inline view.
