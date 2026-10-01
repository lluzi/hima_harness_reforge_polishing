# Codex–Claude coordination baton

Use this protocol when Codex coordinates implementation/integration and Claude independently operates or
tests HimaHarness. It is a context boundary, not another controller. Product authority remains in the
repository, Runtime/Ledger and retained evidence.

## Roles

- **Human:** owns product goals, business trade-offs and authority expansion.
- **Codex coordinator/integrator:** owns the current frontier, lowest-seam diagnosis, shared-branch
  integration, implementation review, candidate identities/freeze, test admission, regression tests and
  consumption of Claude handoffs.
- **Claude operator/tester:** owns human-like product use, one admitted Campaign/Run, real EDA interaction,
  exact checkpoints and the smallest authorized Pack/Site fix. It does not redesign Harness architecture.
- **HimaHarness agents:** execute only the role, inputs, tools, budget and recipient declared by their Pack
  task. Their transcript is product evidence, not the Codex–Claude coordination channel.

One mutable surface has one owner. Codex owns integration; Claude owns its tester worktree and the one live
GUI/EDA session. Never run overlapping HimaHarness, Catsights, XTop, QuaLib or licence actions.

## The baton

Each workstream has exactly one short JSON baton outside chat history. The launch message gives its absolute
path. Replace it atomically when the frontier changes; archive the previous bytes rather than extending the
file into a diary.

Required fields:

```json
{
  "schema": "hima.coordination-baton/1",
  "workstream": "issue-66-atcs09",
  "revision": 1,
  "updatedAt": "ISO-8601",
  "objective": "one sentence",
  "phase": "integrate|qualify|test|handoff|done|paused",
  "authorities": {"issue": "URL", "branch": "name", "sha": "40-hex"},
  "candidate": {"pack": "id@version", "wrapper": "path", "digests": {}},
  "frontier": {"proved": [], "next": "one cheapest falsifier", "blockedBy": []},
  "ownership": {"codex": [], "claude": [], "human": []},
  "activeExecution": {"campaignId": null, "runId": null, "processes": "none|named"},
  "evidence": ["absolute path or URL"],
  "nonGoals": [],
  "handoff": {"targetRole": "codex|claude", "requestedOutput": "one sentence"}
}
```

The baton carries current facts and pointers only. Large logs, reports, transcripts, source excerpts and old
decisions stay at their evidence paths. A summary never grants permission, resumes a paused Run or overrides
newer Ledger/Git/tool state.

## Starting or replacing a session

1. Read `AGENTS.md`, this protocol and the one baton named in the launch message.
2. Read only the issue/spec and evidence paths named by the baton. Verify the Git SHA, candidate identities,
   live process/licence state and any active Run before acting.
3. Reply once with `BATON_ACK <workstream> r<revision> <role> <sha> <next>`; a mismatch is a blocker.
4. Execute only `frontier.next`. Use the cheapest falsifier and update the baton only when the milestone,
   blocker, identity or ownership changes.

Do not paste the previous chat or ask a new session to reconstruct it. Keep the old session read-only as
historical evidence.

Keep each complete coherent task in one main session: environment qualification, one single-seat model L4,
or the full matched effectiveness experiment through referee. Large evidence stays in files; independent
subtasks receive fresh bounded packages with the fixed model verified before use. Session boundaries follow
completed tasks, not token thresholds.

If the main session shows stale-role or candidate reasoning, retain a checkpoint and try one compact. Only
if corruption remains, write the baton and roll to a fresh same-model session at the nearest safe boundary;
resume the same current Run without duplicate effects. Historical unrelated Runs remain evidence only.

A named product-goal DRI provides minimal direction. Notify it only for drift from the fair method objective,
Pack-first architecture, complete-task continuity, honest evidence/verdict, or a material scope/success change.
Routine fixes, reviews, publication and test progression stay with the development/testing team.

## Handshake

Chat carries only wake-up markers:

- `BATON_READY <absolute-baton-path>` — start or resume from the named baton.
- `CLAUDE_CHECKPOINT_READY <workstream> <absolute-checkpoint-path>` — Codex must decide or integrate.
- `CLAUDE_HANDOFF_READY <workstream> <absolute-report-path>` — Claude is done or honestly terminal.
- `CODEX_HANDOFF_CONSUMED <workstream> <phase> <sha-or-no-change>` — evidence was verified and consumed.

Write checkpoint/report evidence before its marker. Duplicate markers are harmless because workstream,
revision and identities are checked again. Ordinary healthy progress stays in files; status chatter does not
grow either agent's context.

## Controlled development phases

Use the Matt Pocock skills as phase boundaries, not as permanent prompt payload:

1. `grill-with-docs` when a proposed capability or acceptance rule is still ambiguous; write decisions back
   to the named backlog/spec document.
2. `to-spec` after product choices are settled; produce code ownership, interfaces, dependencies, staged tests
   and parallel slices against the current architecture.
3. `implement` only from the accepted spec; move the next dependency frontier, commit/push evidence, and stop
   at the spec's honest terminal boundary.

Start each phase from the baton and the named document. Do not carry the full grilling or implementation chat
into the next phase.

For long-horizon self-improvement, repeat one bounded learning loop:

`retained failure → lowest-seam reproduction → Pack/Site/generic-Harness ownership → cheap regression → smallest fix → frozen qualification → baton update`.

Promote every expensive failure into a cheaper regression. Learned facts enter versioned Pack knowledge or
tests only after evidence; a live Agent never rewrites its own authority, acceptance rule or architecture.

## Completion

A coordination turn ends only with one of: a pushed integration SHA, a qualified frozen candidate, a retained
test result, an actionable blocker with its cheapest next probe, or an explicit human decision request. Close
every bounded HimaHarness/EDA test normally and verify zero residual process before handing over.
