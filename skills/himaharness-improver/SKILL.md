---
name: himaharness-improver
description: "Coordinate repeated HimaHarness product-improvement cycles with a Claude Code human-like tester: dispatch concrete trials, monitor the same persistent Campaign, consume evidence handoffs, reproduce and fix defects on main, publish tested Pack/App upgrades, and send the next trial. Use for HimaHarness trial coordination, tester monitoring, blocker integration, or autonomous fix-release-retest loops. Do not use for ordinary one-off repository edits."
---

# HimaHarness Improver

Run one evidence-carrying loop:

`release -> tester task -> human-like trial -> handoff -> reproduce -> smallest fix -> release -> next trial`

The tester is the existing Claude Desktop Code session. You are the main-line
integrator. Keep those roles separate.

## Recover before acting

Compaction summaries, contact output, tool output and chat recollections are not
the workflow authority. At every invocation:

1. Read `/Users/lluzi/code/hima_harness_reforge_polishing/AGENTS.md` and its
   required product, discipline, model and testing documents.
2. Run `scripts/cycle_state.py show`. If a cycle exists, reconcile it with Git,
   GitHub Release, the automation definition and the exact Claude session.
3. Read the active tester manual and the latest report/checkpoint named by the
   state. Read large raw evidence only for a disputed fact.
4. Inspect the Claude session through Computer Use. Treat only a direct chat
   message, the cycle state, versioned repository bytes, published release
   metadata and retained evidence as authority.
5. Resume the recorded cycle. Never infer a new Campaign from a new turn or a
   compacted conversation.

If no cycle exists, initialize it before contacting Claude. See
[references/coordination-protocol.md](references/coordination-protocol.md).

## Prepare a tester task

Make the task executable by a second-tier model:

- identify one released Pack/App, main SHA, digest, manual, Site profile and
  fixed Goal;
- name the prior Runs that remain immutable;
- assign one dedicated tester worktree and branch;
- state the first cheap gate, the conditions for spending model/EDA budget, and
  the exact final verdict vocabulary;
- define one persistent Campaign per Pack version and forbid duplicate Campaigns
  caused by chat/session endings;
- write a user-journey task, not a list of internal functions to call;
- put expected actions, assertions, evidence paths, limits and report location
  in the manual rather than relying on this conversation.

Write the cycle state, then activate the Claude skill through the actual Claude
Code slash-command path:

1. Send `/himaharness-human-like-tester` as its own direct user chat message.
2. Wait for `HIMA_TESTER_SKILL_ACTIVE: <cycle id>` and verify a fresh tester
   checkpoint exists. Ordinary prose saying the skill was read is insufficient.
3. Send the English `HIMA_TEST_TASK_V1` envelope with the absolute manual path
   and released identities. State that it is an explicit user-authorized
   instruction.

If the slash command is unknown, stop dispatch and repair the Claude skill
installation; do not fall back to pasting the skill body into chat. This visible
handshake prevents contact or compact output from masquerading as the task.

## Monitor without competing

Claude alone operates HimaHarness and Catsights. Do not start another
HimaHarness UI session or mutate its Run.

Maintain one heartbeat automation, normally every 15 minutes while a trial is
active. On each check:

- active and healthy: remain quiet;
- idle with unfinished work: ask Claude to inspect and continue the recorded
  persistent Run;
- `CODEX_HANDOFF_READY: <absolute path>`: read the handoff immediately;
- explicit decision request: preserve the question and bring only the decision
  to the user;
- completed terminal result: verify evidence and close or start the next cycle.

Do not poll raw logs repeatedly. Use the Claude status, immutable report and
targeted evidence named by the report.

Every heartbeat also runs `cycle_state.py show`. A valid new
`tester-handoff.json` is an actionable handoff even when Claude failed to print
the marker. Consume it immediately, then tell Claude that the chat marker was
missing. The file fallback prevents a lost assistant message from stalling the
loop; the marker remains required because it makes the handoff visible to a
human reviewer.

## Integrate a tester handoff

Never merge Claude's branch blindly.

1. Verify the handoff cycle ID, Pack digest, Campaign/Run, report path, branch,
   commit and status with `scripts/cycle_state.py consume-handoff`.
2. Build one deterministic, seconds-scale red loop for the exact symptom.
3. Run it on the released pre-fix commit and on Claude's fix commit.
4. Review the diff against current architecture and scope. Reject unrelated
   cleanup, manual evidence rewriting, hot patches and changes to historical Runs.
5. Cherry-pick or reimplement only the smallest proven fix.
6. Run the regression, relevant Pack subset, seal/installation checks and only
   the next justified test tier.
7. Commit, immediately push, and verify the remote SHA.
8. If method bytes changed, increment the Pack version, generate `TEST.md` and
   `VERSION.yml` through the native release path, publish the GitHub release and
   verify the asset digest. Never hand-edit a release seal.
9. Update the tester manual and cycle state, then send the next exact identity
   to the same Claude session.
10. **Close the relay.** When the user authorized continued fix-release-retest,
    the integration turn is complete only after the next cycle has its manual,
    worktree, state, heartbeat prompt, visible tester-skill handshake and direct
    task envelope. Keep the current cycle actionable until all six exist. A
    `COMPLETE` cycle whose note says `pending`, `next`, `awaiting release` or
    equivalent is a coordination failure: the heartbeat treats it as an
    immediate continuation handoff, not healthy idle state.

Negative scientific results do not trigger a product fix. Fix infrastructure
defects, false facts, broken contracts and unusable UX; let the Campaign's
methodology handle valid negative EDA outcomes.

## Close or escalate

Close a cycle only from retained terminal evidence. For an authorized continuous
test loop, close it together with the dispatched successor described above.
Pause and ask the user only
for a product-definition decision, an irreversible/destructive action, missing
licensed external resources, or a contradiction that cannot be resolved from
the declared authority.

Leave user-owned `tmp/` untouched. Preserve every historical Campaign and its
failed evidence. Report facts, interpretation and unverified scope separately.
