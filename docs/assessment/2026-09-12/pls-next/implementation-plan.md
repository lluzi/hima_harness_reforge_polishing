# PLS-21 / 22 / 13 → 19 implementation

Status: delivered implementation and acceptance. Full local passed 377/377 on source `93afd76`; the separate installed-author read-only audit passed 11/11. The original finalization JSON property-order failure is preserved. This file retains the original admission and design audit; current evidence and limits are in [batch acceptance](README.md).

Baseline: `4d8bc8c9b1e1f1205eb7725ac14ee89386cdd3f2`, clean and equal to GitHub main at admission. Source snapshots remain read-only. Work branches and isolated builds live under polishing. Every commit is pushed and its remote SHA checked.

## Work ownership

| Task | Primary owner / modules | Integration seam |
| --- | --- | --- |
| PLS-21 #24 | Input agent: Pack declarations, run arguments, parameter substitution, Permit, forms | One Goal/Strategy validation path; shared tools/index hunks reviewed on integration |
| PLS-22 #25 | Authoring agent: authoring sessions, skills/knowledge, installed bundle, authoring tools | Native dsh session/workspace, existing Pack check/test/release; no custom editor |
| PLS-13 #14 | Assets agent: pack-folder, release, local seeding, method identity | One method file set, frozen method resolver used by Run/recovery |
| PLS-19 #22 | Root after PLS-21 verification: Fabric, node operations, durable control, Jobs, recovery, native conversation | Same conversational Agent owns explicit business actions; infrastructure tracks admitted work |

Separate worktrees prevent concurrent edits/builds from invalidating another task's tests. Shared hunks are integrated sequentially. Electron and live model checks are coordinated; local Host tests use private homes and tmux sockets.

## PLS-19 interface audit

The baseline starts automatic execution at `fabric.startRun → drive`, `fabric.resumeRun → drive`, and `recovery.reconcileRunningRun/reconcileFork → drive`. `driveOn` chooses subsequent nodes, repeats retries, routes decisions, opens Loops and drives fork branches. `node-turns.launchAndWait` shares Job admission and waiting for tool, reader and Workshop work; Workshop currently opens a separate model moment. Production tools, commands and HTTP delegate to these operations. Native UI start posts to `/hima/api/runs/start`.

The implementation must fence every old drive entry. Automatic legacy behavior may remain only as an explicitly isolated regression fixture. New production Runs prepare context without starting a business node. Historical automatic Runs remain readable and collect existing Job facts; explicit migration must prove the original method/input identity and a safe boundary before binding an owner. A missing identity is a refusal, never permission to use today's installed method.

The real dsh tool execution context exposes the calling `Agent`, whose id is its durable session id. That is the owner source; the model does not choose an owner in tool arguments. Native session selection only changes viewing. Explicit owner handoff advances an epoch and leaves a receipt. Long work must return its identity before completion; a background fact collector may observe/stop existing Jobs but may not choose or start a new business node.

Durable control belongs in the existing Ledger. Required facts are owner/epoch, control revision, request id and argument digest, execution identity (node, generation, Loop, branch, attempt, method/input/code versions), pause scopes, and operation receipts. Admission and control mutations share a short per-Run serialization boundary; a Job's whole lifetime is never held inside it. Repeated requests return their prior receipt; changed contents or stale versions fail before side effects. Uncertain launches are reconciled by identity or blocked, never launched again speculatively.

Pack strategy advice remains available; exploration decisions and next-node requests belong to the conversational Agent. Completion verifies actual Job/reader/Judge facts and required artifacts. PLS-10/11 growth and revision are explicit unsupported operations until delivered; this task introduces no competing revision engine.

## Agreed validation seams

Existing specs and `docs/testing-strategy.md` already accept these seams: actual Pack/argument functions, real in-process/subprocess dsh Host, Hima tools/commands/fenced HTTP, private local Jobs/files, existing Electron driver, and bounded DeepSeek V4 Flash checks. No additional seam approval is required.

Each task first preserves the cheapest failing counterexample, then implements and rechecks it. Build/typecheck and relevant local subsets run during development. A fixed integrated build receives the complete local suite once, plus necessary L3 paths and small L4 model checks for changed authoring/execution tools. Replay is mechanism evidence; local stand-in is not real EDA or DTCO improvement. Exact attempts, failures, duration and resource counts accompany delivery.

Independent Standards and Spec reviewers inspect a fixed implementation tree after integration. Findings are corrected and affected checks repeated before tasks are marked delivered. Real DTCO and human value acceptance remain later tasks.

## Delivery state

PLS-21/22/13 were integrated before PLS-19. The production path now binds the actual conversational Agent and requires explicit node actions; admission, asynchronous Job facts, controls, recovery and native authoring use the existing modules described above. No second execution or graph service was added.

The focused integrated local set passed 60/60 and the final native conversation/control desktop path passed 1/1. The Workshop DeepSeek V4 Flash check passed 19/19 with current numeric observations, fixed Goal, in-flight pause and explicit continuation. The installed author continued the original session and scientific Run through reader repair, TEST formatting and native release, but its original record-invariance check failed because JSON property ordering changed at cold decode. The separate corrected read-only audit passed 11/11, verifying the unchanged scientific records, actual seal, allowed file delta and remaining tail without another model turn or Run. The complete local candidate passed 377/377 in 1195.578s (47 subprocess and 357 in-process Hosts, zero Electron/SSH). The subsequent comparator-only change passed its four-case integrated subset in 3.262s; the current 378-case full suite was not rerun. See [batch acceptance](README.md) for raw logs, failures, installation hashes and exact limits.

Independent core Standards/Spec and subsequent delta reviews closed their actionable findings; the generic-workspace reader and finalizer tooling received separate review. The original v19 offline importer remains strict while the current v20 reader accepts absent design already written by generic Packs.

Both final gates passed. The completed PLS count is 12/26 (01–07, 13, 19, 20, 21, 22). The dependency frontier is PLS-23 #26, PLS-24 #27, PLS-10 #11 and PLS-14 #15; this batch does not start them. Formal EDA/DTCO and human acceptance remain PLS-23/25/18/26.
