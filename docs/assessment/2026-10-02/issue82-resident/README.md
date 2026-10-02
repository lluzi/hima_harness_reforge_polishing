# Issue #82 implementation and acceptance

Spec: [Resident Engineering Agent](../../../specs/resident-engineering-agent/README.md).
Authoring baseline: `e762789a6b28a8f8b694e9740e1b776507e5073f`.
Branch: `codex/issue82-opencode-design`.

## Current result

HimaHarness 0.2.2 exposes task-local Resident Engineering Agent execution through the existing
`hima_execute`/Fabric/Job/Channel/Reader path. Current ATCS 0.3.1 declares one complete `fix-timing` outsourced
node. Site implementation uses the existing rootless Podman EDA image and OpenCode 1.18.34 ACP with
`deepseek/deepseek-flash`; no DSH migration, registered Harness component or long-lived task service.

Implementation, the completed field attempt and the post-field integration repair are recorded below.
The actual Resident result beats the matched ordinary AutoFix in XTop, but the frozen live test is
still FAIL because its Host candidate did not materialize referenced support/checkpoint files. The
post-field Reader proof is not a new live end-to-end PASS.

## Superseding field result and human correction

Frozen candidate `2d2e9dc5` ran as Run `run-2ab21055-e5ae-4e6b-b5b6-e2cdcd13d10e`, task
`resident-2095ddfaf07b5653f962c081`. It ended best-effort: ordinary serial AutoFix had Setup 24
(WNS -0.0333 ns, TNS -0.1568 ns) and Hold 82 (WNS -0.1523 ns, TNS -4.5816 ns); Resident delivered
Setup 18 (WNS -0.0237 ns, TNS -0.0973 ns) and Hold 0 (WNS/TNS 0). Non-fixed overlaps were zero.
OpenCode used one persistent XTop process for the repair sequence and one final reopen to verify the
saved Hold-clean checkpoint. Setup Goal remained false; global transition/capacitance/fanout and final
physical signoff remain unknown.

The native delivery manifest `7ef2768d...c5ad` retains one result plus ECOs, scripts, reports, logs and
60 nested checkpoint files. The Pack self-Reader accepted the task-private result; the Campaign Reader
rejected because the old Host copied only the result JSON. Commit `76eeba8c` adds Pack-declared
`artifactPrefix`, full no-clobber preflight, Site-side hashing/copy and original Reader tree-digest
coverage. It is retained-artifact integration evidence only; the closed Run was not restarted.

The field candidate also used a transitional provider broker/task token and permission-kind projection.
The human correction explicitly rejects continuing either subsystem: OpenCode is already the trusted
engineering executor. Current code removes the broker/token/sanitized profile and kind policy, mounts
the Site's native OpenCode config/auth read-only, and allows normal permissions for the exact current
ACP session. This means the trusted OpenCode process/tools can read native auth; Hima only avoids
copying literal credentials into prompts, request frames, traces and results. The simplified candidate
has local deterministic coverage but has not been deployed or live-qualified.

## Current 0.3.1 release qualification

Release source `dcc4e906` deployed only the changed wrapper and capability bytes. The prior deployed
files are recoverable under
`/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/archive/20261002T171900Z-2d2e9dc5`.
Current identities are:

- Pack `agentic-timing-closure-system@0.3.1`, digest
  `4bc248ff1aa8a2a636c1cfbc42ce5dc03d73d9f50d6a5c5f9356b4ac8a833e73`;
- resident playbook SHA-256
  `8bf20932b00ea820d5c01c9ff204b5105c449c6afac6d55e8106680648b1a250`;
- wrapper SHA-256 `5c24d5d5651bfe0e0645111f254df9e51d46fefc055c62afc61f89ac2bf3d7b7`;
- capability SHA-256 `82d30597daf315170c4190fe5dd3c276ee53665269b3b9195036054e1d9a7000`.

Opt-in release qualification Run `run-76c3cb7c-b790-4e9c-85a5-0d5d943734d3` used real OpenCode
1.18.34 native config/auth and `deepseek/deepseek-flash`, normal shell/Python reads and private writes,
one same-session follow-up, current Host artifact materialization, the original
`atcs-engineering-result` Reader, and release with `owned.quiescent=true`. It started no XTop or
QuaLib. The qualification overlay changed only the temporary installed graph entry/autopilot so it
could enter `fix-timing` without rerunning common R1/AutoFix.

The task repackaged the old Run's actual 60-file checkpoint, ECOs, scripts, raw timing reports and two
legality reports retained in the original private workspace. The current Reader emitted error count 0,
effect-versus-AutoFix 1, Setup WNS -0.0237 ns and Hold WNS 0. This is proof that current native auth,
same-task lifecycle, Host staging and Reader integration accept the retained result. It is not a new
timing experiment; the engineering result remains Setup 18 / Hold 0, best-effort, with unchanged
unknown/global/signoff limits. Evidence is
`.hima-tmp/issue82-release-evidence/issue82-release-20261002T174344Z/evidence.json` (SHA-256
`d5e7e51903cf63ddf2d49825551807455ace374b180be18166608be65db62e42`).

The user's 2026-10-02 `/implement #82` instruction overrides the default development model policy
for this task: implementation and independent review workers use GPT-5.6 Sol/high, fresh bounded
contexts and no recursive delegation. The existing primary session coordinates integration.
Product inference remains DeepSeek 4.1 Flash. Development token counts are unavailable; no product
model calls or EDA runs are included in the cheap checks.

## Delivered slices

| Commit | Result | Focused evidence |
|---|---|---|
| `01fd4f7c` | Pack author instructions explain eligible nodes, complete tasks and verified returns | Existing author skill suite 9/9 |
| `90a556bd` | Generic controlled engineering operations, capacity/licence/ownership/recovery and Reader integration | [Host evidence](../issue82-host/README.md); Host 8/8, focused regression 104/104 |
| `f86b9de7` | Production Site ACP adapter, confined workspace, persistent session and verified delivery revisions | [Site deployment and qualification](../../../../sites/linglong-atcs28/README.md) |
| `4b6ca3cd` | ATCS 0.3.0 native input/common R1/ordinary AutoFix/outsourced task/Reader/Goal | Pack checks 3/3; native/Reader/legacy Python 13/13; new public Host dry path 1/1, terminal Goal false; old method preserved |
| `6dad071d` | Immediate durable message queue acknowledgement; separate actual completion/unknown facts | Protocol 13/13; Host 8/8; 5.5-second message acknowledged under one second; no restart replay |
| `07fe2c8e` | Opt-in real Site/model acceptance through an actual standard owning Hima Agent | Guard test: 1 SKIP, zero boots/SSH/model calls; not live acceptance |
| `54f63991` | Stabilize three inherited local tests exposed by the final broad run without changing product behavior | Affected files 17/17; delegation pair 2/2 across five additional runs; zero SSH/Electron |

Each slice was immediately pushed and its remote branch SHA compared with its local commit.
The 0.2.10 graph/contract/docs are retained explicitly for legacy regression; old Run snapshots and
physical-signoff semantics stay intact. New XTop-only delivery is a separate Pack result scope.

## Typecheck boundary

Both package builds/typechecks pass. The repository test-project typecheck has 16 existing errors:
9 `erasableSyntaxOnly` parameter-property diagnostics in unchanged Harness source and 7 direct-lib
missing-declaration/implicit-type diagnostics in `trial-package.test.ts`. The two newly introduced
ATCS test type errors were corrected.

The baseline was independently reproduced from a Git archive of `e762789a` source/tests/scripts,
with the same locked compiler/dependencies, baseline Harness build and shared package resolution.
It produced the same 16 diagnostics. The initial incomplete baseline fixture omitted package-local
dependencies/scripts and is retained as a failed setup probe, not baseline evidence. Logs are in
`.hima-tmp/issue82-baseline-build.log`, `.hima-tmp/issue82-baseline-typecheck.log` and
`.hima-tmp/issue82-typecheck.log` in the implementation worktree. No unrelated typing cleanup was
added to this feature. A non-green whole-repository typecheck remains an explicit limitation.

## Final local validation

The frozen `60e6e752` product candidate completed the full local group once: 778 tests, 775 passed,
3 failed, 0 skipped, 0 SSH attempts and 0 Electron launches in 1,897.924 seconds. The complete log is
`.hima-tmp/issue82-final-full-local.log`; it is retained as a failed suite and is not reported as a
pass.

All three failures were in unchanged tests and were independently traced to existing test-contract
defects already present at the `e762789a` authoring baseline:

- `branch-autopilot.host.test.ts` still expected a generic transport close to replace the typed
  `atcs_close` finalizer introduced by `f50988f8`. The test now proves premature close is refused,
  completes the declared finalizer, closes transport, and still reaches `done` without a retry.
- Both delegation-input tests assumed a continuable child must be synchronously visible in the native
  Agent registry as soon as the durable `created` receipt returns. They now wait for publication within
  the unchanged task deadline and then exercise the same registered tool.

After the test-only correction, the three affected files passed 17/17. The two former publication-race
files then passed 2/2 in five consecutive additional runs. `git diff --check` passes; the repository
typecheck still reports exactly the 16 baseline diagnostics above and no new error. These focused runs
do not relabel the original broad suite as passed and do not requalify unchanged product surfaces.

## Field admission and remaining proof

Use the existing `live-site` group for `resident-engineering.live.test.ts`; it needs both real SSH
and model access and is never included in local checks. `HIMA_ISSUE82_LIVE=1` explicitly selects it.
Credentials are inherited only as environment/native authentication, never literal command arguments,
task material or reports. A six-hour outer Runtime timebox is a closing guard, not a winner criterion.

Before a future rerun, freeze the source, actual native executable/image, Pack, flow, Site/Permit,
wrapper, capability and retained native input hashes; verify no conflicting XTop/QuaLib or manual
session. The frozen field candidate's three owned paths were deployed and later reconciled quiescent;
the post-field direct-auth/materialization bytes have not been deployed and need a new candidate identity.

The real model must form the complete engineering delegation. Preserve actual owner/native events,
scripts, raw before/after reports, selected state, residuals, collateral, all input identities and
ordinary AutoFix comparison. A valid best-effort delivery may finish with Goal false; tie/negative/
unknown effects remain honest. Model prose, CLI presence and protocol fixtures are not engineering
value. Release preserves engineering materials and confirms owned process/container quiescence.

The earlier broker/token credential section is historical evidence for the frozen field candidate,
not current product direction. Current code directly reuses native OpenCode configuration and auth,
keeps the task Podman/Campaign filesystem boundary, and applies no Hima-specific permission taxonomy.
No claim is made that the native credential is hidden from the trusted executor.

## Rollback

Stop and reconcile the new owned task first, retaining partial/unknown evidence. Restore the previous
Harness and explicitly installed ATCS 0.2.10 method for new tasks; do not reset a user checkout, replace
an active Run's saved method, remove existing manual sessions, or delete delivered engineering files.

## Scoped independent review and corrections

The initial Standards axis reported 2 documented-standard findings; the Spec axis reported 1 P0
and 3 P1 findings. The shared crash-recovery issue appears in both axes. Reports are retained at
`.hima-tmp/coordination/opencode-design/review-standards.md` and `review-spec.md` in the primary
polishing workspace, independently of the worktree. Only the findings' changed surfaces are reviewed
again; unchanged source and historical methods are not requalified.

- `0ba20af1`: raw XTop fail-reason parsing yields bounded positive blocker evidence, never global zero.
  Model counts/regression lists cannot authorize a Goal. Ordinary AutoFix uses the same Goal/residual
  comparison, retains its best actual state, handles regressions/oscillation/stagnation, allows positive
  satisfied setup margin to fund hold repair, and avoids a round when the initial state meets the Goal.
  Legacy expert/canvas tests load the explicit 0.2.10 snapshot. Focused Reader 11/11, comparator 10/10,
  expert Host 1/1, canvas 43/43 and new Pack public dry path 1/1 pass.
- `fef461fd`: public Host status/cancel/release and Run cancellation use the fixed wrapper reconciliation
  Job to collect actual owned PID-start/PGID/CID/descendant quiescence, without replay. Missing/partial
  identity remains unknown and fenced; recovery avoids ordinary tool settlement. Host 12/12 and
  affected recovery/control/Job/conversation 34/34 pass; no new typecheck errors.
- `06dadceb` historical candidate: directory-FD/no-follow artifact traversal blocks parent symlink and
  linked-file escape; its now-superseded task broker protected native model material; stopped facts are
  serialized across normal signal/reconcile. The broker claim is retained only to identify the field
  bytes and is not current product guidance.

Global transition/capacitance/fanout/legality all-clear is not proven by timing-fix fail-reason tables.
The Reader explicitly keeps that scope unknown. This can make the whole Goal/effect comparison
unknown despite measured setup/hold progress; best-effort engineering delivery remains valid.
There is no fabricated global collateral PASS or physical-signoff claim.

The first broad local validation was interrupted after reproducing six legacy ATCS fixture-loading
failures (651 seconds, 0 SSH, 0 Electron); its original output remains
`.hima-tmp/issue82-full-local.log`. It is not a completed or passed full suite. The later completed
full-local result and its three test-only corrections are recorded above. A later live model/EDA/remote
deployment is recorded in the superseding section; the current direct-auth/materialization candidate
itself has not been deployed or live-run.
