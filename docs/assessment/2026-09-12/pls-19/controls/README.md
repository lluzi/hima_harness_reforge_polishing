# PLS-19 cancel, retry and hard deadlines

2026-09-12. Bounded implementation on `codex/pls19-controls`, based on `9614b78650382c0d580350638b84e456a4bf219d`. Source bytes are fixed by [source-hashes.json](source-hashes.json). The parent integration owns Workshop file/knowledge operations and the UI; this slice does not claim whole PLS-19 completion.

## Behavior

- `executionAction(cancel)` checks a live Host session, owner epoch, revision and request digest before persisting the request and a Run-wide stop fence. An Agent must own the Run. A human in another live authorized UI session may request emergency cancellation without transferring ownership. Identical requests retain their receipt; different contents under the same request ID are refused.
- Cancellation responds after admission. Actual stop I/O uses a distinct stop key in the existing control-queue map; short admission and result-publication writes retain the Run key. A delayed stop cannot hold duplicate receipts or refusal of new work. Direct trusted service cancellation uses the same fence and stop path. Existing command/tool/HTTP legacy stop entrypoints already refuse owned-Run bypasses.
- Existing Job cancellation and reconciliation establish the stop. `control.stop` and its request distinguish requested, confirmed and uncertain effects. A launch whose actual effect is unknown remains uncertain and prevents new admission; it is not reported cancelled or budget-ended.
- A failed attempt retains its node. Retry allowance exhaustion pauses that node and exposes no replacement attempt; Fabric does not route it to a Pack wait. Human Continue durably admits its identity before recording the matching blocker clearance and refreshing that node's existing retry allowance. Agent Continue cannot grant this clearance; another node's Continue cannot refresh it. Goal, initial clock, generation, budget and total attempts remain intact. Actual Pack wait clearance still requires subsequent explicit Agent completion.
- Owned Runs receive an abortable deadline task in the existing Job observer tracker, including after restart/adoption. It shares the existing time-box calculation. Paused/offline time keeps counting, no Job is launched at expiry, and all actual open Jobs go through the existing stop machinery before a time-box ending. Host disposal aborts the timer and drains the same tracker.

## Verification

[Final controls](final-controls.log): **8 passed, 0 failed, 0 skipped**, 24.216 s, 10 in-process Host boots. Includes a long local Job, human emergency/no transfer, duplicate/digest refusal, both cancel-launch admission orders, finite renewed retries, scoped clearance, paused deadline, Agent-offline Host restart, long-Job deadline, unknown launch and delayed stop-I/O responsiveness.

[Related regression](final-related.log): **18 passed, 0 failed, 0 skipped**, 65.271 s, 23 in-process Host boots. Retains node completion evidence, fork/Loop behavior, Pack wait, explicit ownership adoption, incomplete-completion fence, unknown launch reservation and lost-launch-receipt recovery. The adopted-deadline assertion now verifies automatic budget ending and unchanged historical wait allowance; stale revision checks remain enforced.

[Build](final-build.log), [full typecheck](final-typecheck.log), [seams](seams.log), [boundary](boundary.log), and source/test/docs whitespace checks passed. Raw `.log` outputs retain the test runner's original whitespace and are excluded from whitespace lint. The agreed test-only Workshop type import now resolves through `@hima/harness`; no source implementation was changed to accommodate the test compiler. [Runtime](runtime.log) records Node/pnpm versions. The worktree used its own frozen install and the existing polishing pnpm store.

Final Host runs used `HIMA_TEST_LEGACY_AUTO_DRIVE=0 HIMA_TEST_SILENT_AGENT=1 pnpm --config.verifyDepsBeforeRun=false test:local --files ...` against a fresh build. Each invocation used isolated local storage/processes and its SSH sentinel. Both final runs recorded **0 Electron boots and 0 SSH subprocesses**. No external model, real EDA, real Site/SSH, desktop or full-suite test was run; these are not passes.

## Preserved falsifying evidence

- [cancel-red.log](cancel-red.log): other-session human cancellation incorrectly refused.
- [retry-red.log](retry-red.log): failed node remained available after spending its allowance.
- [deadline-red.log](deadline-red.log): paused and restarted/offline Runs never ended without another Agent call.
- [uncertain-red.log](uncertain-red.log): unknown launch had no durable uncertain stop result at the deadline.
- [pending-stop-red.log](pending-stop-red.log): delayed stop I/O held the business admission queue.
- [related.log](related.log): 17/18 passed; the prior adopted-deadline assertion expected passive admission refusal, before idle deadline enforcement made the revision advance automatically.
- [typecheck.log](typecheck.log): retained initial test type diagnostics before tuple narrowing and the public Workshop type import correction.

[All recorded test runs](test-runs.json) retain individual counts, elapsed time and Host starts, including red/green iterations; final timing is one sample, not a performance percentile. No test failure was hidden by rerunning an unchanged expectation.

## Review and rollback

Changes remain within Fabric, recovery, existing budget math, Ledger's optional control/receipt fields and a two-line owned-Job deadline hook. No new service, storage backend, model driver or graph engine was introduced. Read-only observation and the existing incomplete-completion fence retain their authority; parent-owned readonly Workshop dispatch must remain outside mutation fences during integration. Revert this bounded commit to restore the prior behavior; any persisted optional stop/request records must still be treated as facts when assessing already-running work.
