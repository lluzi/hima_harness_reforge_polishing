# Initial HimaTeam frontier qualification

This record covers implementation of [#98](https://github.com/lluzi/hima_harness_reforge_polishing/issues/98) and current-version compatibility work for [#99](https://github.com/lluzi/hima_harness_reforge_polishing/issues/99). Both issues were closed after `40590a3e8fc571b238ea31baff4252d664127d63` was pushed and its remote SHA verified (791 local tests: 787 pass, 0 fail, 4 skip); #99 affected Desktop compatibility passed 6/6 without skips. It does not qualify OAR/Pi/OpenCode member activation or a real business workflow.

The inherited code baseline is `d458ec761899a83200b7264f8e19272df6965c88`; the approved documentation baseline is `138bde2ff78d4328a1267fd6c15b4afbe412f844`. The integrator owns contracts, Host/PG/DBOS wiring, browser API and test registration. Coding workers used GPT-6.1 Sol/medium in fresh independent worktrees; coordinator and independent reviewers used Sol/high. Development token/call attribution was not measured. Product model, SSH and EDA calls were zero in these mechanism tests.

## Implemented minimum

- Immutable project-bound Team definitions with CAS versions, stable member identities, clone/export and strict admission.
- Host-resolved Human/Guide actors, persistent human identity across browser sessions, and member-only capability checks bound to exact project/task/run/effect/member/generation/expiry/revocation.
- Team-source Run opening through the existing Fabric/DBOS interpreter, a frozen definition and absolute deadline, replay identity, and task-result/2. Legacy Pack identity/result/1 and compiled digest remain covered by existing fixtures.
- Host-driven task list, frozen-version re-entry, controls and resource/stop-intent projection. A definition update does not change an existing task.
- Original-effect stopping across all App exit modes, retained exit hold on reopening, ordinary stop retry for cancelled Team resources, and truthful unknown closure. Post-exit continuation remains unavailable until #105.

The production executor port remains unavailable until native member activation is qualified. The script executor exists only in tests; successful script delivery is mechanism evidence.

## DSH decision

Reject `@deepseek-ai/dsh@0.2.0-rc.2` for this candidate. Actual isolated installation succeeded, but the actual Harness source typecheck failed at five legacy `source: {kind: 'plugin', plugin: 'hima'}` producers after the upstream message-source ABI change. No candidate Host, historical migration or Desktop qualification is claimed.

Retain DSH `0.1.5-alpha.1`, Cordis `4.0.2`, Schemastery `3.18.2` and DBOS `5.2.11` with the existing pnpm lock. The rejected npm cohort's exact versions, tarball URLs and sha512 integrity are retained in [dsh-rc2-cohort.json](dsh-rc2-cohort.json). No upstream Team scheduler was added.

The current-version fix accepts semantic transcript evidence only from actual model-facing text slots, including V3 nested tool-result text and V4 tool-role content. Metadata-only titles, paths, names and arguments cannot invent a conversation. Exact historical prefix hashes and watermarks are preserved; missing, corrupt or mismatched evidence remains unavailable.

## Evidence boundaries

The development baton at `.scratch/himateam-issue97/development-baton.json` points to exact command logs and pinned review patches. Local tests use real isolated Host, PostgreSQL, DBOS, HTTP, native session storage and retained command processes. Model execution is the declared script/text dependency substitute. After transfer to the integration checkout, the targeted contracts passed 48/48 without skips. The actual Playwright Electron Team scenario passed 1/1 without skips against the same candidate source: save/clone/export, retained opening draft, waiting readiness, pause/continue/cancel, reload and frozen-v1 rediscovery after saving v2. Existing Desktop/Window compatibility also passed 6/6 (70.287 seconds) on the retained DSH cohort. Test Electron/Host/PostgreSQL PIDs all exited before Home deletion. An isolated painted window used showInactive; no exclusive display was required and the existing Andes App was preserved. Hidden-window input had changed DOM values without delivering React state changes, so that failed test setup is not claimed as product evidence. A test's model substitute does not prove runtime or business effectiveness.

#100 asset qualification remains in its independent worktree. Native macOS Hindsight/authenticated readiness/admin backup and PostgreSQL vector/trigram assets were exercised; Linux asset downloads and Podman CLI/helper inspection are not Linux install or sandbox qualification. Machine/member image closure, permitted network destinations, native Linux execution and clean install are still open. #101–#109 have not been started ahead of their actual blocked-by prerequisites.

No main merge, release package, issue closure, native member readiness or business acceptance is claimed by this record. Unknown or cancelled original effects are never revived by rollback or replay.

## Running the optional Desktop qualification

Build the checkout, then supply a Playwright operator runtime if it is not locally installed:

```sh
HIMA_PLAYWRIGHT_MODULE=/absolute/path/to/playwright-core \
HIMA_POSTGRES_RUNTIME=/absolute/path/to/pinned/postgres \
node scripts/run-contract-tests.mjs desktop --files test/contract/himateam-definition.desktop.test.ts
```

Playwright is test tooling, not a shipped product dependency. The test owns a separate Home, userData directory, database and ports. It captures only its own App renderer. No product model or native member executor is exercised. Evidence is retained below `.scratch/p01-playwright`, including sanitized request titles, screenshot and actual process cleanup.

## Mandatory regression findings

The first integration pre-push on `c0e03dcd648a9ae3684f7ccb1247b1f4112f1c24` ran all 789 local tests: 783 pass, 2 fail, 4 skip (2197.462 seconds; 61 subprocess and 364 in-process Host boots; zero Electron/SSH). The hook prevented synchronization. Both failures are preserved: Team inline presentation styles violated the client style contract; an immediately reopened installed Host tried to create a Pack Run before recovering its previous exit fence.

The style declarations moved unchanged into the existing token sheet (3/3 style contracts). A real Host/PG counterexample distinguished the startup race from recovery failure: the same start was rejected before recovery and accepted after it. New business entry points now await recovery and recheck current closing state; the current-lifetime PG fence/finalization checks stay intact. The selected skills and reopening cases passed after the fix; related exit contracts passed 9/9. The finalization race case now asserts that closing admission is refused and that stale finalization retains readable PostgreSQL evidence. These focused results do not replace the next commit's mandatory pre-push run.
