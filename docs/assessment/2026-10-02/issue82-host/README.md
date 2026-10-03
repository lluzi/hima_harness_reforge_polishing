# Issue #82 generic Resident Engineering Host evidence

Baseline: `e762789a6b28a8f8b694e9740e1b776507e5073f` on
`codex/issue82-opencode-design`. Development allocation was the user override
GPT-5.6 Sol/high, with no recursive delegation. No live model or EDA tool was
started by this slice.

## Implemented seam

The tested public seam is the actual in-process Host tool call
`host.ctx.tools.execute({name: "hima_execute", agent, ...})`. A normal act tool
may opt in with `outsourcing: {role, reads, knowledge, produces}`. The same
controlled execution then accepts `engineering` operations
`start/message/status/cancel/delivery/release`; ordinary `work` and engineering
are exclusive. The Site binding remains one file pointer,
`bindings.engineeringCapabilities`.

The Host uses the existing execution admission queue, owner epoch, control
revision, request receipts, Site capacity and licence claim, launch intent,
ordinary Job, Channel/Permit writes, Job process-group stop, Pack Reader, and
Ledger observation. It adds no task registry, service, daemon, state entity, or
second business owner. Task-local protocol files are retained after release.

## Red evidence and corrections

- The first schema test failed because the strict Pack tool schema did not know
  `outsourcing`; the new declaration and reference validation made it green.
- The first public delivery returned Reader `pending`; delivery now settles the
  already-launched Reader Job before accepting evidence.
- A deliberately dead wrapper produced `unknown`; an identical retry returned
  the durable duplicate and launched no second Job.
- Immediate cancellation after a fast start exposed request-file ordering; the
  Host now waits for the wrapper's native-session state before publishing a
  session-dependent operation while `status` remains immediately readable.
- The first repair attempt inherited a retained artifact's read-only mode when
  copied to the Pack output; the Host now reads the retained bytes and writes
  them through Permit-checked `tee`, then hashes the landed bytes.
- Capacity review found task files were written before a slot claim and tool
  licence seats were omitted. Materialization now occurs at the persisted
  pre-dispatch boundary, an at-cap answer leaves no task files, a fresh request
  succeeds after the slot frees, and the engineering Job carries the declared
  tool licences.
- Reader rejection originally left a latest-only delivery. The filesystem
  contract now retains immutable request-scoped manifests and artifact bytes;
  the same native session can receive `FIX_DELIVERY`, publish a second delivery,
  pass the Reader, release, and complete without replaying the Run.

## Verification log

All commands used Node 24 with `/opt/homebrew/bin` retained in `PATH` so the
real local Job mechanism used tmux.

```text
pnpm run build
PASS: harness TypeScript build, client bundle, desktop TypeScript build

pnpm run test:local --files test/contract/resident-engineering.host.test.ts
PASS: 8 tests, 0 failures, 0 skipped
PASS: 6 real in-process Host boots, 0 Host subprocess, 0 Electron, 0 SSH
elapsed: 12.174 s (includes immutable rejected-artifact retention and
same-session delivery repair)

pnpm run test:local --files \
  test/contract/resident-engineering.host.test.ts \
  test/contract/conversation-execution.host.test.ts \
  test/contract/agent-execution.host.test.ts \
  test/contract/agent-controls.host.test.ts \
  test/contract/pack.test.ts \
  test/contract/product-context.host.test.ts \
  test/contract/node-jobs.host.test.ts
PASS: 104 tests, 0 failures, 0 skipped
PASS: 102 in-process Host boots, 1 Host subprocess, 0 Electron, 0 SSH
elapsed: 106.863 s
```

`pnpm run typecheck` reached the test project after both package typechecks. It
remains non-green because of existing `erasableSyntaxOnly` failures in
`channel.ts`, `errors.ts`, `guide-context.ts`, `guide-sessions.ts`, and
`workspace.ts`, existing direct-lib declaration failures in
`trial-package.test.ts`, plus concurrent ATCS test typing. The Issue #82 Host
source builds successfully and `resident-engineering.host.test.ts` has no
reported type error.

## Live owner invocation recipe (not run here)

The live acceptance must use the existing product Agent path, not scripted
engineering operations:

1. Install the current Harness, new ATCS Pack and production Site capability,
   then boot the standard in-process profile with
   `bootInProcess(home, {withWebApp: true})`.
2. Create the normal Guide/owner conversation through the product start path;
   use the confirmed Campaign proposal and `hima.startRun` ownership handoff.
3. Call `sayAsUser` once with the actual Fix Timing business goal and constraints.
   Let the true owning Hima Agent inspect its current method/context and form the
   `hima_execute engineering start` delegation itself.
4. Preserve its actual tool calls, task envelope, native protocol events,
   Reader observations, scripts, before/after reports and residual facts. Do not
   prewrite an ECO, model delegation, result, or repair instruction.

Presence of `DEEPSEEK_API_KEY` is not execution evidence. The production run
must still prove the real Site/OpenCode/XTop path separately from this L2 Host
mechanism.

## Independent-review crash recovery correction

The P0/P1 review at baseline `241f324a` found that ACP starts in a separate
session from the wrapper Job. Killing or losing the wrapper could therefore
leave the native process/container and reparented descendants alive while
generic Run recovery treated the wrapper exit as ordinary tool completion.

The correction keeps the same task and existing Job/Channel/Ledger authority:

- the wrapper retains signed native PID start identity, PGID, optional Podman
  CID and exact descendant PID identities;
- the Host recognizes resident executions during restart and never calls the
  ordinary `observeExecution` settlement path for a dead wrapper;
- public status/cancel/release and Run cancellation may launch one fixed
  same-task `--reconcile` Job through the existing Site capacity, Permit,
  launch-intent and Job records;
- reconciliation starts no ACP session, consumes no business request and
  replays no prompt/action; it exits successfully only after signed
  `owned.quiescent=true` and stopped state facts exist;
- missing, partial or mismatched ownership remains `unknown`, leaves the Run
  and execution fenced, and permits no business retry;
- a wrapper killed before runtime/ownership creation has a separate signed
  never-started quiescence fact; partial creation remains unknown.

Red evidence included: public status after SIGKILL originally wrote a request
that nobody consumed; restart attempted ordinary Job settlement; normal cancel
could race before retained PID identity or runtime creation; the strict Host
schema initially rejected new descendant/CID facts. Each was reproduced at the
public Host seam with the production wrapper and deterministic ACP stand-in.

Final focused evidence:

```text
pnpm run build
PASS

pnpm run test:local --files test/contract/resident-engineering.host.test.ts
PASS: 12 tests, 0 failures, 0 skipped
PASS: 11 in-process Host boots, 0 Host subprocess, 0 Electron, 0 SSH
elapsed: 25.602 s

pnpm run test:local --files \
  test/contract/agent-recovery.host.test.ts \
  test/contract/agent-controls.host.test.ts \
  test/contract/node-jobs.host.test.ts \
  test/contract/conversation-execution.host.test.ts
PASS: 34 tests, 0 failures, 0 skipped
PASS: 48 in-process Host boots, 1 Host subprocess, 0 Electron, 0 SSH
elapsed: 84.271 s
```

The recovery tests kill the actual wrapper while its native root and detached
descendant remain alive, then prove public status cleanup, public Run cancel,
release fencing, signed unknown behavior with missing identity, and restart
without ordinary settlement or retry. No live API, model, EDA, SSH, or desktop
window was used.

## Delta-review identity and verified-progress correction

The follow-up review at `6031512f` found two narrower crash windows.

First, the Host originally added `capabilitySha256` only to the final `started`
receipt. A Host loss after actual Job launch and before that update left a
durable admitted start without the identity required by bounded reconciliation.
The admitted receipt now carries protocol, capability hash, complete signed task
envelope hash, method digest and input digest before the existing launch intent
or any Site process dispatch. Reconciliation independently re-reads and hashes
the task envelope and refuses a changed Site, capability or task/material
identity.

Second, status cleanup previously changed a Reader-verified `ready` execution to
`uncertain`; release then changed it to `failed`. Confirmed native cleanup now
preserves `ready` only when a durable delivery receipt says `verified`. The
Reader observation, materialized artifact hash and settled result remain
unchanged through crash status, release and normal node completion. An execution
without verified delivery remains uncertain/failed as before.

Deterministic public Host tests now cover:

- an injected Host persistence failure after the real wrapper/native launch but
  before the final start receipt, followed by restart and same-task cleanup;
- valid Reader delivery, wrapper SIGKILL, status reconciliation, release and
  completion with unchanged output/observation identities and no retry.

```text
pnpm run build
PASS

pnpm run test:local --files test/contract/resident-engineering.host.test.ts
PASS: 14 tests, 0 failures, 0 skipped
PASS: 14 in-process Host boots, 0 Host subprocess, 0 Electron, 0 SSH
elapsed: 28.410 s

pnpm run test:local --files \
  test/contract/agent-recovery.host.test.ts \
  test/contract/agent-controls.host.test.ts
PASS: 21 tests, 0 failures, 0 skipped
PASS: 33 in-process Host boots, 0 Host subprocess, 0 Electron, 0 SSH
elapsed: 56.863 s
```

This delta also used no live API, model, EDA, SSH or desktop window.
