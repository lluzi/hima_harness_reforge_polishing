# Issue83 — resident turn-end feedback to the Campaign owner

FL observed native `waiting` at 02:05:57Z and 02:15:19Z while the owner remained silent until normal
product chat prompts. A public Host regression using the production local wrapper and deterministic
native protocol fixture reproduced the gap: state.json reached waiting, but no owner inbox turn
arrived without a status call or human prompt. The bounded five-second assertion failed.

Ordinary Jobs already attach execution observers and notify the owner. Resident start returned after
binding its long-lived wrapper Job, without observing its native turn boundaries. Recovery similarly
only confirmed wrapper liveness. Wrapper exit is not equivalent to a native turn finishing.

## Minimal correction

`fabric.ts:observeResidentEngineering` uses the existing abortable `trackExecutionTask` and Host
`notify`/native `agent.followup` seam. Start and recovery of a live resident Job attach one observer
per execution. It reads the existing task-bound signed state through Site/Channel permissions.
Waiting/failed boundaries prompt the current owner to inspect engineering status and decide the
same-task next action. Repeated unchanged states do not repeatedly wake that owner. The notification
is a hint, not delivery, Reader acceptance, Goal success or authority to replay work.

The observer checks Host stop, Run/stop/execution state before and after Site I/O, and stops for
settlement, supersession or actual native stop/release. It can inform a paused owner without changing
pause or granting work. Host recovery may send the current fact again; it does not replay a request.
Read failures remain logged as observation unavailable, not invented native success.

One scoped independent review found that exiting on native `delivered` was premature: a Pack Reader
can reject while the execution remains working. A new public regression reproduced the lost wake
after same-task format repair, and the exit now follows Host settlement or actual stop/release.
No new scheduler, controller, ledger schema, UI or Pack-specific behavior was introduced.

## Evidence and limits

Evidence lives in `.hima-tmp/issue83-owner-wake/` in the actual worktree: original `red.log`, focused
public tests, `reader-red.log`, final build/regression/typecheck logs and finding-only review update.
An initial direct test setup used a noncanonical temporary path and failed capability identity before
launch; it was corrected to the same canonical private TMPDIR discipline as the local runner, and is
not counted as the reproduced lifecycle defect.

Final nearest regression: **32 pass / 0 fail / 0 skip**, 73.475 seconds, 42 in-process Hosts,
0 subprocess Hosts, 0 Electron and 0 SSH attempts. Independent finding-only review has no unresolved
scoped finding. Both package typechecks pass; the final test-project diagnostics match all 16
baseline locations/codes, with no additions.

Checks cover initial and subsequent native waiting, unchanged/running-state silence, paused facts,
non-owner isolation, unsafe handoff refusal, Reader-rejected repair, Host restart without task replay,
and nearby resident/control/recovery contracts. No real model, SSH, commercial EDA or window is used.
Development uses user-selected Astra/High; review explicitly requests Sol/High through the subagent
API, with exact reviewer runtime metadata independently unavailable. Full test-project typecheck
retains the documented 16 baseline errors; package build/typechecks pass.

The successful field Run and original `ended-goal-not-met`/unknown collateral facts remain unchanged.
This fix has not yet been exercised in a new normal GUI task. It must be combined with the separate
proven delivery-contract and artifact-access corrections into the next usable candidate; do not
repeat Timing engineering just to qualify this notification seam. Rollback base: `f0102d4a`.
