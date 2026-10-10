# Initial HimaTeam frontier qualification

This record covers implementation of [#98](https://github.com/lluzi/hima_harness_reforge_polishing/issues/98) and current-version compatibility work for [#99](https://github.com/lluzi/hima_harness_reforge_polishing/issues/99). Both issues remain open until the integration commit and mandatory pre-push checks are synchronized; #99 affected Desktop compatibility passed 6/6 without skips. It does not qualify OAR/Pi/OpenCode member activation or a real business workflow.

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
