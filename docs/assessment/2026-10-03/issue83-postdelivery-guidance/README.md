# Issue #83: owner completion after engineering delivery

Read-only field evidence identifies a handoff failure, not a stale UI or failed
native wake. r5 Run `run-662bd46e-bcd5-4fec-8eab-0ba9c255f845` remained at
`fix-timing`, with a Reader-verified ready execution and released engineering
session. The owner never submitted node completion. Its premature attempt to
begin the future autopilot node received a refusal telling it the Harness takes
those turns, without naming its pending manual completion. It then released the
session and yielded, expecting autopilot. The reference route had never advanced.

The existing generic action seam now explains that verified delivery makes the
execution ready; release retains artifacts and cleans up resources; the owner
must explicitly complete that execution before successor autopilot can run. A
premature future-autopilot request names the current ready manual act execution.
Normal and reconciled release receipts include a completion next action only
when current verified ready state and Run/control fences permit that guidance.
Paused/ended/stopped delivery still collects facts but does not recommend a
business completion. Successful Reader repair clears the stale current rejection
reason, preserving the original rejected receipt and artifacts.

No node is automatically completed, no control/ownership semantics change, and
no new controller is introduced. The engineering tool description states the
same boundary. Pack-specific policies are absent. ATCS0.3.3 from89f8f4a9 remains
unchanged; this generic fix must be paired with that frozen product-only method
for any next candidate. Revert this commit to restore the prior generic behavior.

Evidence is retained in `.hima-tmp/issue83-r5-stall/`:

- `read-only-state.json` and `diagnosis.md`: actual control/receipt/record facts;
  owner tool calls and public responses confirm the sequence. No live write,
  message, completion injection, restart or engineering job was performed by DL.
- `red.log`: the public Host reproduces the misleading future-node refusal.
- `repair-red.log`: successful repair retains the stale rejection reason.
- `green-rerun.log`: exact public Host delivery -> premature begin -> release ->
  explicit complete sequence passes and reaches the declared autopilot/ending.
- `review-red.log`: independent-review counterexamples cover paused delivery
  guidance and a successful reconciled-wrapper release missing the next action.
  Their corresponding fixed checks are in `review-green.log`:4/4 PASS, including
  cancelled cleanup and same-session repaired delivery. Finding-only review
  confirms both gaps closed with no remaining actionable finding.
- Build passed. An initial local causal run exhausted its60s fixture budget before
  engineering start while concurrent validation was still running; it never
  reached the changed seam. That failure is preserved in `green.log`. Sequential
  rerun passed without increasing the fixture budget.
- The initial nearest suite recorded36/37 passes with zero SSH/Electron; one
  self-driving-fork fixture timed out before its author request. Failure and
  cleanup warning remain in `nearest-tests.log`; it is not reported as a pass.
  The failed fork case subsequently passed1/1 on its own unchanged-budget retry
  in `autopilot-rerun.log`; unaffected36 prior passes were not rerun.
  Optional whole-project typecheck
  was interrupted to serialize validation, not passed; previous baseline errors
  are not cleared by this work.

DL uses user-selected Astra/high. One fresh Sol/high review found the two bounded
fence/reconciliation guidance gaps; their direct failing tests preceded fixes.
Finding-only recheck and exact final test counts are retained with the review
note. Applied child runtime settings remain unverified; requests/tokens/cost are
unmeasured. Product model/commercial EDA calls for this slice are zero.

Current field evidence is developer-informed operator validation, not cognitively
isolated acceptance. App exit alone does not establish a terminal Run or remote
quiescence. DRI/FL retain responsibility for ordinary user Stop and cleanup;
packaging stays on hold until that receipt. No internal completion command is
passed to FL as a rescue. Future operator instructions contain only the normal
user task, entry, declared environment/permissions and visible outcome.
