# HimaHarness next-stage human-like trial 31

Invoke `/himaharness-human-like-tester` first and require
`HIMA_TESTER_SKILL_ACTIVE: hima-trial-31` before following this manual.

This is an independent, user-authorized human-like acceptance of the released
HimaHarness App. Use Claude Code Desktop with **Sonnet 5** and **Medium** effort.
Claude is the only HimaHarness operator. Do not delegate UI operation to another
agent, do not open Catsights from another session, and do not create a second
Campaign because a Claude turn ends.

## Fixed identities and preserved evidence

| Item | Identity |
| --- | --- |
| App release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/v0.3.0-trial.18` |
| Release source | `d39fc4ce757d4a25a26bde803aa85bea69b090ba` |
| App ZIP SHA-256 | `f2f85706731dfe59d359eb2be8771573ffea7eb42ad9a1847517b10876f11569` |
| Release manifest SHA-256 | `c53aa6f1d8a1e71a4922637df8e11fc2e23622c77663402ce1e5873cf5e43068` |
| Local extracted kit | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/next-stage-release/trial18` |
| Tester worktree | `/Users/lluzi/code/hima_harness_agent_trial_fix_v31` |
| Tester branch | `agent/hima-trial-bugfix-v31` |
| Report | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.18/Agent Trial Report v31.md` |

Trial 13 through trial 30, including paused Run
`run-07f4fca4-4c9a-4568-a373-73075fd65201`, are immutable historical evidence.
Never open, resume, migrate, copy, repair or delete their Home, Campaign, Run,
workspace or reports. The local release kit starts a new isolated `Trial Data`
and `Trial Workspace` beside the App.

The release contains development methods `custom-cell-fmax-dtco@5.2.12` and
`xtop-timing-closure@1.0.7`, plus a local stand-in timing probe. They are not
independently sealed Pack releases and this trial must not describe them as
such. Current `main` contains later development work; do not substitute those
bytes into this released App.

## Budget and escalation order

This trial is deliberately bounded. Use no more than eight short product-model
turns before a deterministic defect or terminal verdict. Start with L3 desktop
behavior and the packaged local stand-in. Do not run SSH, XTop, QuaLib, DC,
Innovus, StarRC, PrimeTime or a full DTCO/Timing Closure Campaign. Do not switch
the Empyrean license. If the UI path proves that a later L4 check is needed,
record the exact proposed check and stop; Codex will schedule it separately.

Use the first cheap gate that can falsify the release:

1. Verify the fixed ZIP/manifest identities from release metadata or retained
   local verification. Verify the local App bundle with `codesign --verify
   --deep --strict`. Do not repackage or modify it.
2. Read `COMPUTER-USE-START.md` as a new user would. Record whether every file
   it tells the user to follow is actually present in the delivered kit.
3. Confirm no active HimaHarness window owns this new Home. An old archived dsh
   listener is not authority for this trial and must not be killed or reused.
4. Start the released App only through the provided
   `launch-hima-trial.command`. Keep its terminal open. Bind Computer Use to the
   new `HimaHarness` window on Catsights.

If any identity is wrong, the bundle fails verification, the isolated Home is
not new, or the App cannot start, preserve evidence and hand off `BLOCKED`.

## Human journey

Use visible controls and Chinese conversation. Take a screenshot after each
numbered checkpoint. Shell/API/source inspection may explain a preserved UI
symptom but cannot replace the click/type path.

### A. First-use clarity and Pack understanding

1. From Start, identify the two peer work modes: Campaign and Data Insight.
   Opening Data Insight must not create a Campaign or Run.
2. Ask HimaGuide in Chinese:

   `我是第一次使用 HimaHarness。请用工程师能理解的语言说明 Campaign、Data Insight，以及当前安装的 DTCO 和 Timing Closure 方法分别解决什么问题；也请明确哪些能力仍未通过真实 EDA 验证。`

3. Verify that the reply distinguishes product capability, installed
   development methods, and unverified business claims. Internal protocol names
   alone are not an adequate user explanation.
4. Open Pack details for both methods. Verify that method purpose, major graph
   stages, required Site/input conditions and development/unsealed status are
   visible or discoverable without reading repository YAML.

Checkpoint: screenshot Start/modes, Guide reply, and each Pack explanation.

### B. Data Insight empty state before retained data exists

1. Open Data Insight from the visible product UI before any Campaign exists.
   The released App does not bundle a pre-installed Library report. Verify that
   the panel honestly shows no retained candidate and asks for an exact report
   or observation reference instead of inventing one.
2. Verify that browsing the empty panel creates no Campaign, Job, analysis or
   model call. Do not paste a fabricated record identity and do not treat a
   repository test fixture as a shipped product result.
3. Return to HimaGuide and confirm the conversation is still usable and has not
   become the owner of a Run.

Checkpoint: screenshot the Data Insight empty state and the unchanged Guide.

### C. One local stand-in Campaign and independent task context

1. Use Campaign Preparation with the bundled local stand-in timing probe. Do
   not select either commercial EDA method for execution.
2. Review the proposed Pack, Site, inputs, Goal and explicit stand-in evidence
   class. Confirm the proposal once. Repeated clicks or navigation must not
   create a duplicate Campaign.
3. Verify that execution opens an independent Campaign conversation while the
   Guide remains separately usable. Record Campaign ID, Run ID, owner session,
   workspace, current node and current Job if one exists.
4. In Guide, ask a normal Chinese status question while the local Run advances.
   Verify Guide reports sourced status without taking ownership.
5. Open the running graph. Pan or zoom once, select the current node, then
   inspect its status, inputs/outputs, retained evidence and available actions.
6. If the UI offers a child/delegated task in this local fixture, open its own
   session and inspect the task, actual context sources, transcript/tool events
   and candidate result. Do not create a child merely to satisfy this step when
   the packaged scenario does not offer one; record `not reached` with the
   visible reason.
7. If the completed local Run exposes a retained report or observation, use its
   visible **Open in Data Insight** path and inspect the exact source identity,
   provenance, missing fields and evidence class. If this stand-in produces no
   inspectable record, record `not reached`; do not inject the repository's
   synthetic Library test fixture into the released Home.

Checkpoint: screenshot the proposal, independent Guide/Campaign identities,
graph overview, zoomed selected node, child session if present, and any retained
Data Insight record actually produced by this Run.

### D. Memory, recovery and control honesty

1. Save a short sourced Work Memory note that names this stand-in Run. Verify it
   remains visibly scoped and is not presented as current Run truth.
2. Exercise one non-destructive navigation/reopen path. Re-open the same Run;
   do not create a new one. Verify retained transcript/evidence and current
   authoritative state remain distinguishable.
3. If the local Run is still active, request Pause through the UI. Record
   separately: request accepted, current Job disposition, and Run advancement
   stopped. Resume only the same local stand-in Run once. Never perform this on
   trial30.
4. Inspect the interactive EDA/Operator surface if visible. Production mutation
   must be unavailable or explicitly unqualified; a local Tcl/tmux fixture must
   not be described as XTop qualification.

Checkpoint: screenshot saved memory, reopened same Run, pause/resume receipts
when applicable, and the Operator qualification boundary.

## Defect handling

Classify each finding as product defect, environment blocker, valid negative
result, incomplete, or success. One unconfirmed occurrence is not deterministic.
For a reproducible product defect:

1. preserve the UI screenshot, exact action, Ledger/Run identity and relevant log;
2. use only the assigned v31 worktree and branch;
3. create a seconds-scale red test on the released behavior;
4. make the smallest change in the existing module, run the affected low-cost
   subset, commit and push only the tester branch;
5. do not merge/rebase/reset/push `main`, change a released method in place, or
   create a release/tag.

Do not fix a valid negative result or an intentionally blocked production EDA
surface. Report it honestly.

## Report and handoff

The report must lead with one verdict:

- `COMPLETE`: all reached L3 assertions passed; list every untested L4/L5 claim.
- `BLOCKED`: a reproducible product/environment blocker prevents the journey.
- `DECISION`: an actual product decision is required before safe continuation.

Include fixed identities, timestamps, model/effort, all product-model turns,
screenshots, Campaign/Run/owner/workspace, checkpoints, facts versus
interpretation, every defect and repro, fix commit/remote SHA if any, tests,
rollback and untested scope. Explicitly state whether the release's own start
guide referenced a missing file.

Write the final checkpoint and run:

```bash
python3 /Users/lluzi/code/hima_harness_reforge_polishing/skills/himaharness-human-like-tester/scripts/tester_state.py handoff \
  --cycle-id hima-trial-31 \
  --status COMPLETE_OR_BLOCKED_OR_DECISION \
  --report "/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.18/Agent Trial Report v31.md" \
  --summary "one factual sentence" \
  --fix-commit OPTIONAL_FIX_SHA
```

Replace the status token with the actual accepted value. Then send exactly:

`CODEX_HANDOFF_READY: /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.18/Agent Trial Report v31.md`

Stop after the marker and wait for Codex.
