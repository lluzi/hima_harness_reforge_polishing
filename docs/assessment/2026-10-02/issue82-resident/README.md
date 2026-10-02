# Issue #82 implementation and acceptance

Spec: [Resident Engineering Agent](../../../specs/resident-engineering-agent/README.md).
Authoring baseline: `e762789a6b28a8f8b694e9740e1b776507e5073f`.
Branch: `codex/issue82-opencode-design`.

## Current result

HimaHarness 0.2.2 exposes task-local Resident Engineering Agent execution through the existing
`hima_execute`/Fabric/Job/Channel/Reader path. ATCS 0.3.0 declares one complete `fix-timing` outsourced
node. Site implementation uses the existing rootless Podman EDA image and OpenCode 1.18.34 ACP with
`deepseek/deepseek-flash`; no DSH migration, registered Harness component or long-lived task service.

Implementation and cheap integration checks are recorded below. Actual Hima owner/OpenCode/XTop
acceptance has not started. This document does not claim timing gain or a deployed product.

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

## Field admission and remaining proof

Use the existing `live-site` group for `resident-engineering.live.test.ts`; it needs both real SSH
and model access and is never included in local checks. `HIMA_ISSUE82_LIVE=1` explicitly selects it.
Credentials are inherited only as environment/native authentication, never literal command arguments,
task material or reports. A six-hour outer Runtime timebox is a closing guard, not a winner criterion.

Before selecting it, freeze the source, actual native executable/image, Pack, flow, Site/Permit,
wrapper, capability and retained native input hashes; verify no conflicting XTop/QuaLib or manual
session. Deploy only the new owned paths. The verified retained native context candidate is in
`sites/linglong-atcs28/inputs/nativeTimingContext-v1.json`; its production target is not deployed yet.

The real model must form the complete engineering delegation. Preserve actual owner/native events,
scripts, raw before/after reports, selected state, residuals, collateral, all input identities and
ordinary AutoFix comparison. A valid best-effort delivery may finish with Goal false; tie/negative/
unknown effects remain honest. Model prose, CLI presence and protocol fixtures are not engineering
value. Release preserves engineering materials and confirms owned process/container quiescence.

Native authentication is a same-uid client trust boundary: the exact read-only auth mount avoids
copying credentials into task materials but is not proof against a hostile shell reading that mount.
The sandbox protects original inputs/shared libraries/foreign workspaces from writes and narrows Run
material reads to the exact Campaign. Retain this limitation in actual field evidence.

## Rollback

Stop and reconcile the new owned task first, retaining partial/unknown evidence. Restore the previous
Harness and explicitly installed ATCS 0.2.10 method for new tasks; do not reset a user checkout, replace
an active Run's saved method, remove existing manual sessions, or delete delivered engineering files.
