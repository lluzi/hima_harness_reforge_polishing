# Issue #52 final acceptance — trial.32 Attempt 3 continuation

This continuation fixes the exact Harness admission defect retained by Attempt 3. It resumes the
same Campaign/Run after a normal App restart; it must not create another Campaign, Run, baseline
pipeline or plan. The Pack, Site, binding, Goal and method bytes are unchanged.

## Exact identities

- App: `0.3.0-trial.32`; source `440db5f569088c62879e04f93cbe36c66bfc395a`;
  artifact digest `3e061e7a02f68e767ed01c13cf490c928b214a39485d459405bd7d1c19406614`;
  manifest SHA-256 `ef475bba7b2c5596260ca1e88225e76690f252de981f377231a15e1177e292c5`.
- Continuation kit:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial32`.
- Continuation receipt: `attempt3-continuation-kit.json`; SHA-256
  `83c78e71e1aa70facd7f19f9aaf3e9a08b2b4bd8024698c840cf6f79ee8707ba`.
- No-commercial preflight SHA-256:
  `7a2bd2e08a915f986fea78479cf3086b5963f67684c48cdc4d770b54a834a340`.
- Pack: sealed `xtop-timing-closure@1.0.15`, digest
  `dac4e1b9b60661de50a4863da4dfa177afff25563f28aa26b7c21d03b368e910`.
- Binding: `linglong-swerv28:xtop-operator-v2:dac4e1b9b60661de`, unchanged.
- Same Campaign: visible suffix `3480c1` (retained full Campaign identity
  `xtop-timing-closure-20260927-013900-3600`).
- Same Run: `run-b6855f97-9c8d-4c32-9ad0-a3af693480c1`.
- Same owner: `Campaign Agent 6e9eeb`.
- Retained boundary: `run-xtop-fix`, execution
  `execution-f358b861-eee6-489f-bcea-8798f1e55ee2`, epoch 1, revision 44,
  `paused: ["run-xtop-fix"]`, no Job, no child and no XTop seat.
- New report:
  `/Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Final Acceptance Report Attempt 3 Continuation.md`.

## What changed

No Pack, Tcl, Site, binding, Goal, plan or Run fact changed. HimaHarness `0.1.2` now normalizes the
owner-facing production Operator request `{role:"operator", nodeId, executionId}` into the full
Host-owned contract. The Host:

- requires the exact execution id;
- maps `nodeId` to canonical `nodeRef`;
- fixes the grant to `hima_interactive` and the recipient to the current owner;
- bounds elapsed time to the actual remaining Run budget;
- rejects conflicting aliases, wrong execution, scopes, tool widening, malformed/unsupported budget;
- keeps complete legacy `nodeRef` contracts compatible;
- returns the same retained child on an identical retry instead of spawning a duplicate.

This exact raw Attempt-3 request is covered by the real-Host regression. Pack `1.0.15` and its
production qualification remain valid because neither method nor binding bytes changed.

## Continuation procedure

Claude Code Desktop remains the sole human-like operator and uses Computer Use only.

1. Verify the continuation receipt, App manifest and current preflight hashes.
2. In the visible trial.31 App, confirm the exact Run is parked at the retained boundary with no
   Job/child/seat. Quit that App through its normal menu; do not cancel the Run.
3. Launch only:
   `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial32/launch-attempt3-continuation.command`.
   The launcher refuses while the exact trial.31 process is still running and reuses its Trial Data
   and Trial Workspace.
4. Verify visible App version `0.3.0-trial.32` and recover the same Guide, Campaign, Run, owner,
   execution history, baseline evidence and seven-action plan. Any duplicate object is `FAIL`.
5. Inspect Agent Team and Job tabs: both must still show no child and no XTop Job before continue.
6. Use the visible continue control once for `run-xtop-fix`. Distinguish request receipt, actual
   `paused: []` state and still-absent Job.
7. Send one narrow follow-up to the existing owner: create exactly one `role=operator` child for
   execution `execution-f358b861-eee6-489f-bcea-8798f1e55ee2` through `hima_delegate`; no direct
   owner interactive open, no new Run/Job and no alternative batch path.
8. Confirm the Operator child is created once, production-qualified and receives only
   `hima_interactive` plus the retained named command catalog. Open its own session and inspect its
   effective context and transcript.
9. Let the child complete open, identity, setup/hold summaries, one bounded fix from the retained
   plan, save, typed close and session close. Retain ACK/DONE or truthful FAIL receipts.
10. The owner reads the exact candidate result and explicitly adopts it before completing
    `run-xtop-fix`. Continue the existing graph through Innovus, fresh StarRC/PT, comparison,
    evidence gate and the one-generation ending.
11. Complete the still-open acceptance rows: visible pause/continue, recovery without duplicate,
    report and source evidence, one loaded-data Data Insight interaction, Guide/report/Insight
    agreement, truthful ending and limitations.

Do not rerun baseline, create another child after a successful create, edit installed bytes, use raw
shell/Tcl, delete residue, or touch Attempts 1–2. A new deterministic refusal is `BLOCKED`, not a
reason to retry repeatedly.

## Final handoff

Write the new continuation report and checkpoint/handoff. Preserve the original Attempt 3 BLOCKED
report unchanged. Send:

```text
CLAUDE_HANDOFF_READY: hima-issue52-final-1 /Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Final Acceptance Report Attempt 3 Continuation.md
```
