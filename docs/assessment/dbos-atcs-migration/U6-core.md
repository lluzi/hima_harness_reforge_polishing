# U6 finite interpreter, control and recovery core

Status: bounded core implemented and privately verified. This is not full U6 product integration,
U7 faces, U8 ATCS, U9 distribution/restore, or U10 acceptance. Root owns those gates, combined review,
canonical build and Git. Base verified before edits: `cba50cdd61fb496c0b765f10186ba6557f959306`.

Authority: the accepted migration plan U6/KTD2/KTD4–KTD7/KTD9, product definition, polishing discipline,
model/testing policies, and `.hima-tmp/dbos-migration/handoff/u6-core-packet.md`. Execution used ce-work
return-to-caller. Assigned development model/effort: GPT-6.1 Sol/high; no recursive workers. Serving
identity/token usage not independently measured. Product model/commercial EDA calls: zero.

## Implemented boundaries

- Finite registered `hima.flow`, `.block`, `.task`, `.control`, `.cleanup`, `.deadline` workflows
  execute frozen CompiledFlow data. Sequence, committed enum choice, real concurrent named parallel,
  original-budget repeat carry/stop, and compiler-frozen extensions share this interpreter.
- Stable effect identity includes Run, method, iteration, actual branch and extension path, occurrence
  revision and resolved input. Resolver materializes domain adapters and cannot choose next nodes.
  Task execution remains workflow composition; datasource calls are never wrapped in a Step.
- `extensionResult` binds exact slot/path at the declared consumer. Legacy growth lowers one explicit
  continuation with `priorDecision` and optional `diagnostic`; choice/repeat selectors consume the
  NEW continuation result. The producer and base method stay immutable. Compiled legacy fragments
  are re-derived from their retained proposal and frozen reference method, not trusted by claimed SHA.
- Optional legacy failed/abandoned/cancelled fragments retain honest outcomes and partial results,
  close actual original resources, and return to the continuation without fabricated required output.
  Existing cancel scopes may name the exact producer/extension slot without cancelling the parent.
- Commands have stable IDs, current owner/epoch/revision and immutable origin/actor provenance.
  Human/unknown pause cannot be downgraded or cleared by Agent continue; clearing another scope
  leaves it intact. Branch controls do not change all sibling native grants. Handoff fences old sends.
- Revision selects an actual current effect. Ambiguous task-only references refuse. Actual consumed
  data/control/carry/extension facts determine invalidated occurrences. Existing valid logical paths
  and effects are retained; new root replay reaches the frontier using their original handles. Finite
  additional current roots and object-input field patches are one command, restricted to the selected
  iteration; later carry comes from committed results. No arbitrary historical rewind.
- Raw actual-effect admission includes recorded/derived membership, original deadline and budget,
  human/branch/extension controls, and closure of the original affected tree before replacement writes.
  Explicit `bindDerivedEffect` relations carry authority; string prefixes do not.
- Command/program leases release only after their actual original group closes, before potentially
  delayed/rejected collection. Result acceptance remains independent. Native/resident scopes retain
  live resources until actual closure. Concurrent valid closure observations retain the first proof
  and one release, while identity/claim mismatch still refuses.
- Known running execution/collection uses `running`; typed pending collection/preparation does not
  become schema rejection, terminal output, fake adapter or new Job slot. Unchanged projection facts
  are not re-emitted every poll. Genuine Reader/schema rejection remains distinct.
- Independent control/cleanup uses original identities and stable cleanup claims while main awaits
  an external callback. Unknown closure stays held. Original hard watchdog also acts while main is
  blocked, finishes promptly after terminal flow plus closed resources, and uses the same absolute
  deadline for a later revision. Closing forbids new experiments; admitted work/collection may settle
  until the original hard boundary. No child receives a fresh attempt/time budget.
- Read-only projection exposes explicit terminal Task/effect identity, occurrence validity/path,
  current control, original leases, dispatch records and stop proofs. Parallel-only completion does
  not manufacture a single Goal source. Ledger does not select work.

## Public seams for integration

`flowWorkflowDefinitions({resolveAdapter})`, `startFlow(runtime, FlowStart)`,
`controlFlow(runtime, DurableCommand)`, `scheduleFlowDeadline(runtime, runId)`, and `readFlow`.
`startFlow` consumes an already-created Run; owner/deadline/budget come from PG. Resolver receives
frozen task/request, actual occurrence path/version, committed/named/extension values and
`bindings` (Run input, Goal, original Strategy, explicit current carry). It may return typed pending.

Raw callback Store seams: `currentFlowAuthority`, `assertEffectAdmission`, `bindDerivedEffect`,
`derivedEffects`, `runsForOwner`. Read-only physical facts include preparation and derived effects,
not only interpreter task rows. Product control ACK must distinguish accepted command from pending
physical cleanup; historical receipt owner is not current notification permission.

## Verification evidence

Evidence root: `.hima-tmp/dbos-migration/u6-core/`. All builds stayed there, using Node 24 and the
pinned private PG runtime in `u2/runtime-final`. Each test creates its own Home/processes and closes
only those resources. No shared lib/dependency/Git mutation by this worker.

| Check | Result | Retained evidence |
| --- | --- | --- |
| Private TypeScript dependency build | PASS, zero diagnostics | `tsc-core.log`, `tsconfig.json` |
| Real PG/DBOS/Job interpreter/control matrix | **27/27 PASS**, 149.39 s, zero skip | `final-host.log` |
| Compiler/task-contract checks | **30/30 PASS**, 4.86 s, zero skip | `final-contracts.log` |
| Owned whitespace/diff check | PASS | return transcript |
| Exact owned source SHA256 | captured after freeze | `source-sha256.json` |

Exact commands:

```sh
node_modules/.bin/tsc -p .hima-tmp/dbos-migration/u6-core/tsconfig.json
HIMA_POSTGRES_RUNTIME=$PWD/.hima-tmp/dbos-migration/u2/runtime-final \
HIMA_U6_TEST_LIB=$PWD/.hima-tmp/dbos-migration/u6-core/build \
/Users/lluzi/.local/node24/bin/node --test --test-concurrency=1 \
  test/contract/dbos-flow.host.test.ts test/contract/dbos-control.host.test.ts
HIMA_U6_TEST_LIB=$PWD/.hima-tmp/dbos-migration/u6-core/build \
/Users/lluzi/.local/node24/bin/node --import ./.hima-tmp/dbos-migration/u6-core/private-loader.mjs \
  --test test/contract/flow-compiler.test.ts test/contract/task-contract.test.ts
```

The actual Job matrix proves interval overlap, branch pause plus sibling completion, required failure
vs optional success, choice/repeat/fragment commit crash recovery, explicit return, cached admission
kill/pause/zero sends/one continue send, physical cancel, honest unknown, old-owner send refusal,
first closure proof under concurrent release, human scoped hold across restart, original deadline and
shared attempts, active sibling/derived admission during revision, current repeat carry preservation,
unknown old tree hold despite spare capacity, capacity-one Reader, no running/rejection churn,
optional negative returns, pending preparation without a slot, finite shared input patches and future
carry, explicit failed invocation correction without refund, and watchdog lifecycle/blocked main.

Pre-change evidence: `red-extension.log` rejects the required extension binding on committed U5;
`red-fragment-revision.log` proves the original closure omitted the frozen diagnostic consumer;
`red-closure-race.log` proves concurrent valid closure rejected the later observation and stranded
verified delivery. Existing `task-effects`, DBOS runtime/commit, flow-compiler, task-contract and
agent-controls/growth specs/tests were inspected. Initial real run was 7/8 (missing human
`validated-result` fact); corrected through the existing U4 handoff protocol. Early contract failures
also exposed brittle author-example extraction/tool-file expectations; fixture now selects the actual
schema and declared tool files. All final owned checks pass. Larger live/UI/EDA/model and distribution
checks were intentionally not run within this packet.

## Owned paths and residual gates

Source: `flow-workflow.ts`, `flow-definition.ts`, `flow-compiler.ts`, `task-contract.ts`, `run-store.ts`,
`run-store-migrations.ts`; root-authorized `task-effects.ts` stop/pending/physical-closure seams.
Tests: `dbos-flow.host.test.ts`, `dbos-control.host.test.ts`, `support/flow-workflow-worker.ts`, and
`flow-compiler.test.ts`. Task-contract tests were used unchanged. This assessment and private evidence
are worker-owned. `durable-runtime.ts` required no edit. Shared index/facade/Host/native adapters and
existing broad test migration remained with their assigned owners.

Root must validate combined native/domain/facade behavior and canonical artifacts against this frozen
source, then review, commit/push and verify remote SHA. Local/remote delivery is not claimed here.
The core tests use real command leaves for optional return; the bridge owns actual domain chooser,
native same-session repair/Operator/resident proofs. Accepted stop request never proves physical stop;
missing original proof or preparation stays explicit. SDK replay still requires frozen executable bytes;
no hot old-Run conversion was implemented.

Considered and not built: expression DSL, strict/free mode, another scheduler/controller, speculative
external resend, per-child budgets, blanket repeat rewind, old begin/work/complete turn engine,
Autopilot kicks, time-box credits for human wait, DB outage fallback, arbitrary historical rewind, or
new generic policy/role stores. These either contradict the accepted migration or have no necessary
consumer in this bounded core. Existing explicit revision replaces unproven automatic effect retry.
