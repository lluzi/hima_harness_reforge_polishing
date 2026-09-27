# Issue #52 final acceptance — trial.32 Attempt 4

Attempt 4 is the final fresh GUI acceptance after Attempt 3 proved the complete product path up to a
real post-ECO StarRC Job but exhausted its active wall-clock budget during the long debug/restart
interval. Attempt 3 remains immutable `BLOCKED` evidence: its `extract-after` Job finished exit 0,
but `read-after-extraction` never ran and therefore no post-extraction artifact hash exists.

Attempt 4 changes no App, Pack, Site, binding, Goal or method byte. It removes only the accidental
debug-delay condition by using a fresh isolated Home/Workspace and a 180-minute wall-clock time box
with the same 30-minute closing reserve. It still permits one generation and one retry allowance.

## Exact identities

- App: `0.3.0-trial.32`; source `440db5f569088c62879e04f93cbe36c66bfc395a`;
  artifact digest `3e061e7a02f68e767ed01c13cf490c928b214a39485d459405bd7d1c19406614`;
  manifest SHA-256 `ef475bba7b2c5596260ca1e88225e76690f252de981f377231a15e1177e292c5`.
- Kit:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial32-attempt4`.
- Kit receipt: `acceptance-kit.json`.
- No-commercial preflight:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-preflight-issue52-trial32-attempt4/evidence.json`;
  SHA-256 `27d5c6454848bf597768aff1cb8e5dd46ece45ebc0e63265d90f4b3d4cb69999`.
- Pack: sealed `xtop-timing-closure@1.0.15`; digest
  `dac4e1b9b60661de50a4863da4dfa177afff25563f28aa26b7c21d03b368e910`.
- Site: `linglong-swerv28`; Permit SHA-256
  `8377213d08b6c8871d233146f5355b92d8b3c41dc9cef24aed4ddbf4a30e3108`.
- Operator binding: `linglong-swerv28:xtop-operator-v2:dac4e1b9b60661de`; binding-file SHA-256
  `76a5f500741969054aaa50ef6ac92a70d5590fdd1092cc09382d959a97334114`.
- Budget: one generation, `timeBoxMinutes: 180`, one retry allowance, one concurrent Job and one
  seat each for Innovus, StarRC, PrimeTime and XTop. The sealed Pack contract fixes
  `closingReserveMs: 1800000`; Fabric must copy that 30-minute reserve into the admitted Run.
- Final report:
  `/Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Final Acceptance Report Attempt 4.md`.

## Resource ladder

The no-model/no-Desktop/no-commercial-EDA preflight passed before this trial. It installed and
digested the exact Pack in a fresh Home, discovered the Site without unknowns or conflicts, verified
the Permit and production Operator binding, confirmed `mode=old` and no conflicting Empyrean client,
and started zero Host/model/Campaign/EDA work. Do not repeat lower-level parser, Pack-contract or
native qualification through the GUI.

## Procedure

Claude Code Desktop is the sole human-like operator. It uses only visible HimaHarness/Catsights GUI
controls and ordinary Guide/owner conversations. Codex prepares the kit and later reads retained
evidence; it does not operate HimaHarness concurrently.

1. Preserve Attempts 1–3. Quit every prior HimaHarness acceptance App normally; do not cancel or
   delete their Runs. Launch only:
   `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial32-attempt4/launch-hima-trial.command`.
   The launcher refuses while another HimaHarness App remains running, uses an atomic same-kit launch
   lock, and checks the manifest, preflight, Permit, binding, Campaign and installed Pack identities
   before opening the App.
2. Verify visible App `0.3.0-trial.32`, the fresh isolated workspace, receipt and preflight hashes.
3. Ask Guide, in ordinary user language, to explain the installed Timing ECO Pack, Site, required
   inputs, Goal and next action. Preparation must create no Run.
4. Confirm once. Verify exactly one fresh Campaign, one persistent Run and one owner distinct from
   Guide. The admitted budget must be exactly 180 minutes, `closingReserveMs: 1800000`, one
   generation and one retry allowance. Any different admitted reserve or budget is `FAIL`.
5. Inspect the Live Run graph, actual state, at least two node details, zoom/pan and evidence. Open a
   Side Talk/independent context without changing ownership.
6. Exercise one short pause/continue at a safe no-Job boundary. Record request receipt, actual
   `paused` state and Job state separately; continue immediately so the control test does not consume
   the active budget.
7. Drive the single reference generation. At `run-xtop-fix`, create exactly one production
   `role=operator` child for the exact begun execution. The child alone uses `hima_interactive` and
   the retained named typed catalog: open, identity, setup summary, hold summary, one bounded fix,
   save candidate, typed close and session close.
8. Inspect the child effective contract/transcript/result. The owner must explicitly adopt the
   candidate before completing the XTop node. Raw Tcl, unrestricted shell, owner-direct interactive
   open and batch fallback are forbidden.
9. Before every file-producing stage, inspect current elapsed time and budget standing. Start it only
   when enough active pre-reserve time remains to finish both the stage and its immediate reader/hash;
   otherwise stop at the previous reader-backed boundary. Never create another “Job exit 0, reader
   blocked” boundary. Continue through Innovus apply, `read-innovus`, fresh StarRC extraction,
   `read-after-extraction`, post-ECO PrimeTime, its readers/summaries, compare/retain and evidence
   gate. Every completed file-producing stage needs its reader hash before it counts as reached
   evidence. A negative timing result is valid; a missing reader/hash is not.
10. Reopen/switch once at a declared recovery boundary and verify the same Run, owner and child
    history return without repeating a node, Job, child or mutation.
11. Open the retained timing/iteration report and one cited source item. Make one Data Insight
    loaded-data selection without launching computation. Ask an independent Guide to explain the
    same narrowly shared retained facts and limitations.
12. Finish at the Pack's declared terminal/bounded state. Record exact Runtime status, current node,
    paused state, in-flight Job state and all unreached nodes; never translate an exit code or XTop
    estimate into timing closure.

Stop on the first deterministic product defect and preserve its evidence. Do not retry by creating a
second Campaign/Run/child, do not extend the goal, and do not run a second generation.

## PASS boundary and non-claims

All ten rows in the final component-integration authority must pass. In particular, the final
bounded evidence boundary includes a reader/hash for every claimed file-producing stage, and the
report/Data Insight/Guide agreement is limited to facts actually visible on all cited surfaces.

Regardless of verdict, explicitly claim none of the following unless the retained evidence really
establishes it: timing closure, positive PPA, ROI, DTCO benefit, verified post-ECO timing, or proof
that all 23 XTop-proposed solutions landed in Innovus.

## Final handoff

Write the report at the exact path above, preserve prior reports unchanged, and send:

```text
CLAUDE_HANDOFF_READY: hima-issue52-final-2 /Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Final Acceptance Report Attempt 4.md
```
