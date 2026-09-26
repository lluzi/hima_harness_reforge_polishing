# Improver–Claude tester event handshake

This protocol coordinates one existing Claude tester session with the Codex task that owns the
HimaHarness main-line integration. It replaces scheduled polling. No timer, repeated model call or
status-only automation drives the relay.

## Durable authority

- Codex owns `.hima-tmp/improver-tester/cycle.json`.
- Claude owns `tester-checkpoint.json` and `tester-handoff.json` in the same directory.
- Files are the recovery and evidence authority. Chat markers are wake-up signals, not evidence.
- Every marker names the exact `cycleId`; neither side may start another Campaign merely because a
  chat message was delayed or duplicated.

## Dispatch handshake

1. Codex writes the cycle, release/manual identities and dedicated tester worktree.
2. Codex sends `/himaharness-human-like-tester` as a standalone Claude message.
3. Claude writes a fresh checkpoint and replies `HIMA_TESTER_SKILL_ACTIVE: <cycleId>`.
4. Codex sends `HIMA_TEST_TASK_V1` with the immutable identities and explicit authorization.
5. Claude starts or recovers only that task and writes meaningful checkpoints. Ordinary progress
   remains in the files; no scheduled Codex wake-up is required.

## Event-driven return handshake

When Claude needs a Codex decision or has a terminal handoff:

1. Finish writing `tester-checkpoint.json`; for a handoff, atomically write
   `tester-handoff.json` and the immutable report first.
2. Use the user-authorized Computer Use capability to foreground the currently open Codex app/task.
3. Send one user-visible message into that task:
   - decision/blocker: `CLAUDE_CHECKPOINT_READY: <cycleId> <absolute checkpoint path>`;
   - handoff: `CLAUDE_HANDOFF_READY: <cycleId> <absolute report path>`.
4. Do not paste evidence bodies, credentials or logs into Codex; the marker only wakes Codex to read
   the exact durable files.
5. Remain idle. Do not create another Campaign while awaiting acknowledgement.

On wake-up, Codex verifies and consumes the file. Codex then uses Computer Use to send into the same
Claude session:

`CODEX_HANDOFF_CONSUMED: <cycleId> <cycle phase> <main SHA or no-change>`

Claude records that acknowledgement in its next checkpoint before continuing. Duplicate markers are
idempotent because file identity and `cycleId` are checked again.

## Failure and recovery

- If Computer Use cannot reach the Codex task, Claude keeps the file authoritative, records
  `wakeSignal: unavailable` and shows the marker in its own chat. It does not retry on a timer.
- A blocking local filesystem watcher may be used for diagnosis while Codex is already active, but
  it is not a wake channel: subagent/file events do not reopen a completed Codex turn.
- The user may always wake Codex manually. On recovery Codex reads the three state files before any
  action.
- No heartbeat automation or fixed-interval model poll is allowed for this relay.
