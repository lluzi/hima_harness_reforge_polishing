# U4 effect core

Scope: the domain-neutral external execution and result handoff part of U4. Native Workshop/Team
producer integration is a separate U4 work package. Normal product routing and control orchestration
remain U6; this record does not qualify those later paths or the complete migration.

Base: `91649ade0236bad515f4c05f356a96a8fb7a8993`. Development: fresh GPT-6.1 Sol / high,
one implementation worker, no recursive delegation. Product model calls, SSH, EDA and GUI: zero.
Developer token/account usage and aggregate local Job count were not measured.

## Existing responsibility and interface

`launchJob` and `claimSlot` use synchronous Ledger Run/session/capacity facts. Reusing that
authority for DBOS Runs would preserve two execution authorities. `jobs.ts` now exposes the same
Permit/Channel/tmux/process-group operations through retained-identity leaves; historical callers
keep their existing Ledger operations. `stageEngineeringTask` extracts the existing immutable
wrapper preparation, preserving the native protocol and original Reader/materialization semantics.

`task-effects.ts` is the task boundary, not a scheduler. `executeTaskEffect(store, request, adapter)`
returns the finite task projection and normalized immutable result. A direct datasource
`effectSnapshot` freezes each invocation's branching decisions, preserving DBOS operation order
after crashes. External I/O uses `taskEffectStep`; task collection composes Reader/child operations
outside that Step. Direct datasource result/outbox commits are never nested inside an I/O Step.

Raw native receipt journal operations are limited to callback recovery. They use the same immutable
fact/outbox SQL helper as datasource facts, under `native:` names. The workflow uses a receipted
snapshot to branch; actual submits and messages use uncached current admission. Native child guards
can recover the original unique PG grant after Host reopen, without a callback registry.
An uncached dispatch receipt distinguishes a retained native intent from an actual admitted send;
an intent rejected under pause can continue under fresh authority, while an admitted send must
always reconnect its original child/session.

Native callbacks can prepare an original child effect, claim/release its resource lease and
reserve short immutable scope facts through raw application transactions. These wrappers share
the existing datasource SQL and tables. `externalEffectTransaction` exposes only current Run,
PG-ordered native facts and a record function. Its callback cannot call another Store transaction,
acquire a lease or perform long I/O while holding the Run lock. Site leases acquire the Site
advisory lock before the Run lock; actual dispatch rechecks current admission afterward.

`reserveExternalResearchWrite` preserves `budget.ts`'s existing Campaign write budget for native
writers. It reads the frozen Run budget (defaults 256 attempted writes and 4 MiB), aggregates across
every native effect in that Run and counts refused calls. The Host reserves once at the actual
session/tool-call boundary before grammar/path checks and supplies the real content digest;
directory/file mutation callbacks do not charge again. Identical replay returns the original
receipt without charging, while changed scope/digest/bytes refuses. These are the existing research
write limits, not a new AI-round quota, and callers cannot raise the frozen limits.

Site leases count actual owned Job/licence claims across workflows. Uncertain dispatch/release
retains the claim. A verified delivery is retained independently of closure and remains readable.
Only confirmed closure permits consumer result commit. Nonzero Jobs become failed after closing
their real resources; missing effect evidence remains waiting and cannot resend.
Committed, failed or released effects reject new business callbacks; truthful late receipts and
original cleanup/read/reconcile remain available.

## Producer and Reader handoff

The declared command path requires explicit `TASK_OUTPUT`, or an explicitly registered existing
Reader/native adapter. `TASK_INPUT` is optional and contains canonical immutable business JSON.
Scalar argv operands bind exact declared input names; Runtime bindings remain Host-owned.
Constructing an adapter is read-only; private input/protocol files are staged after retained
identity and current admission, followed by another admission at actual dispatch.

Raw `TASK_OUTPUT` contains `schemaVersion`, business `value`, artifact declarations
`{name,path,mediaType?}` and sourced diagnostics. The Host verifies real bytes, computes hashes,
retains immutable files and supplies Run/task/effect identity. Producers do not invent platform
IDs or claimed artifact hashes. The existing resident wrapper keeps its original signed manifest
protocol; adaptation supplies the common task envelope around that established delivery.

Resident engineering automatically snapshots the original waiting native task, materializes its
delivery, invokes its existing Reader, retains accepted output, requests resource release and
confirms native ownership plus the actual wrapper process group. It then commits the result without
owner `complete`. Reader repair recollects the same native task. Native business messages have
stable IDs and current admission; there is no fixed platform round quota. A lost wrapper may use
only its retained fixed cleanup mode and stable cleanup Job, never another engineering prompt.

## Evidence

Private fresh compilation uses the repository TypeScript compiler and emits only under
`.hima-tmp/dbos-migration/u4/lib`. The pinned local PostgreSQL runtime is
`.hima-tmp/dbos-migration/u2/runtime-final`; Node is `/Users/lluzi/.local/node24/bin/node`.

Core test command:

```sh
HIMA_POSTGRES_RUNTIME="$PWD/.hima-tmp/dbos-migration/u2/runtime-final" \
HIMA_DBOS_TEST_LIB="$PWD/.hima-tmp/dbos-migration/u4/lib" \
/Users/lluzi/.local/node24/bin/node --test test/contract/task-effects.host.test.ts
```

`task-effects-test.log` retains the latest exact pass/fail output under the U4 evidence directory.
The five test cases cover:

- Real `loadPack -> declared argv -> local Job -> raw business output -> verified artifacts`.
  Lost launch ACK, repeated original receipt, unknown effect with no resend, independent retained
  delivery/release, conflict rejection, Reader repair and pause/owner admission counterexamples.
- Two real registered DBOS workflows, one command and one program, competing for one Site licence.
  The actual submit callback observes at most one PG claim and real Job wall-clock intervals do not
  overlap. This proves program process recovery; it does not qualify a live model inside a program.
- Real resident wrapper, deterministic ACP stand-in, actual Reader Jobs, five repair messages in
  one original native session, stale owner-message rejection and automatic result handoff. A
  separate registered DBOS resident workflow composes actual Reader child operations. Timing Goal
  remains false/UNKNOWN in accepted business output; task success does not invent Timing signoff.
- SIGKILL after `prepared` and after `submitted` datasource facts, reopening the same registered
  workflow with one original Job and result. These are real DBOS replay tests, not plain callbacks.
- Persisted human pause between prepared-intent crash and reopen, zero actual effects until a
  valid continue command, then the same original invocation.

Raw native journal, enumeration and original child grant lookup also run inside a registered DBOS
submit Step, proving there is no nested datasource transaction. Changed immutable receipt content
is refused while identical replay emits one fact.
An A-to-B-to-A Code fixture retains all three writes in PG outbox sequence, including after history
projection acknowledges them. Exact fact-ID reads remain available after acknowledgement. Raw
callback leases contend with ordinary Job claims, competing callback scope reservations have one
writer, a preceding pause prevents the business callback, and original cleanup can close its
never-dispatched reservation under that hold.

Latest core result: **5/5 PASS, 17.40 s**, with fresh private compilation. No worker, wrapper or
native fixture process remained from this suite after normal cleanup.
The final raw authority/dispatch lookup subset passed **1/1, 3.16 s** with the newest source in
`raw-authority-final-test.log`; full source type checking also passed.
The subsequent native research-budget preservation subset passed **1/1, 3.01 s** in
`research-budget-test.log`: default positive admission inside an actual DBOS Step, exact replay,
same-length changed-content refusal, two native effects racing a shared attempt cap, independent
byte-cap equality/overrun, and continued charging of refused attempts. No actual file mutation
is inferred from a budget reservation.

Nearest U3 regression command selects `dbos-runtime.host.test.ts` and `dbos-commit.host.test.ts`.
The retained `dbos-regression-test.log` records 6/6 passing tests (9.40 s before the final admission
hardening): application commit/checkpoint crash, projection/ack crash, identity/control mismatch,
rollback and Home isolation, PG interruption and original-version reopen, and startup ownership.
The directly affected final admission/PG-recovery subset then passed **2/2, 5.99 s** in
`dbos-admission-final-test.log` with the terminal callback fence.

## Limits and integration obligations

The retained ACP fixture qualifies native protocol/lifecycle mechanics, not real OpenCode/model
behavior or EDA results. Full Workshop/Team producers belong to the native U4 package. U6 must
consume these adapters through the fixed DBOS task/control workflows and bind current Run input,
owner, deadline, Site and Permit facts; U7 must show retained artifacts and unresolved closure.
The old Ledger dispatcher must never be connected as a DBOS Run fallback. Normal product route,
desktop operations, live model/remote Site and final business acceptance remain unqualified here.

No Git mutation or shared dependency installation was performed by this worker. Parent owns the
shared build, test manifest, integration review, commit/push and remote SHA verification.

## Scoped review corrections

F1 and F3 from `.hima-tmp/dbos-migration/u4-core-review/result.md` were reproduced from the retained
real PG/native probes and corrected in the existing effect/lease boundary.

- A known resident failure records its original failure receipt before cleanup, so a subsequent
  signed `released`/`stopped` state cannot turn the failure into delivery success or hide it while
  wrapper closure is pending. The failed release receives the same durable cleanup claim callback
  as successful release. It uses the original Job/native identity without requiring a delivery
  manifest, confirms signed native quiescence and actual process-group closure, releases the lease
  and records terminal failure without a TaskResult. Both a live original wrapper and an already
  gone wrapper with the one fixed reconciliation Job are covered.
- Capacity and held licence counts use own-property numeric lookup. An undeclared inherited name
  such as `constructor` refuses; the same name explicitly declared as a numeric feature is admitted,
  counted across claims and denied when exhausted. Existing identifier grammar is unchanged.

Focused private regressions: **3/3 PASS, 6.24 s**, retained in `review-fixes-test.log`. The resident
cases launch a real wrapper and a retained ACP fixture with a deterministic first-prompt error,
prove original resource closure and failure idempotence, and execute a following real Job using
the freed Site licence. Source L0 and diff check passed. Parent owns the final combined core and
DBOS regressions and the one delta review of these fixes.
