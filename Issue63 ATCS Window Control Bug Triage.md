# Issue #63 — ATCS window/control bug triage

- **Cycle:** hima-issue63-atcs-window-control-triage-1
- **Manual:** docs/user-guide/issue63-atcs-window-control-bug-triage.md
- **Discipline:** docs/user-guide/himaharness-human-like-test-discipline.md
- **Release:** https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/xtop-timing-closure-v1.0.16
- **main SHA:** 19368de076806189285a732a4b77701f2c0fc755
- **App:** /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/issue52-app-trial33/HimaHarness.app
- **Home:** /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/atcs07-eb9d3234/Research012 Data/dsh
- **Site:** linglong-atcs28
- **Pack:** agentic-timing-closure-system@0.1.2, digest 7eefda6192db49be9d15cc31773372c0765cc6c3804684cf4f7c63ab7691b4d3
- **Retained Campaign:** agentic-timing-closure-system-20260927-221945-c343
- **Retained Run:** run-c0793069-3efa-442d-831b-047c5c5ad577, epoch 1, prior snapshot revision 42, latest authoritative host-exit receipt revision 43, paused ["*"]
- **Tester worktree/branch:** /Users/lluzi/.codex/worktrees/atcs07-tester/hima_harness_reforge_polishing @ codex/atcs07-acceptance

## Verdict: `TEST_ENV_BLOCKED`

The manual's mandatory pre-action proof — one screenshot of the full primary-display
side-by-side layout (HimaHarness left 60%, Claude/Catsights right 40%) with window
titles and target identity — was never captured before the first product click. No
product-control verdict is drawn from this trial.

## What happened

1. Preflight (before launch): verified zero HimaHarness main processes running
   (`ps aux` showed only the unrelated `hima-runtime` backend service). App bundle,
   Home directory and launcher script existed and matched the task envelope exactly.
2. Launched exactly one App instance via the assigned launcher
   (`launch-research012-trial.command`). Verified exactly one HimaHarness main process
   (pid 76861) plus expected Electron helpers, and exactly one HimaHarness window
   (window_id 139596, title "HimaHarness", not minimized, on-Space) via
   `app_list_windows`.
3. Captured a **window-scoped** `app_screenshot` of that window only. It showed the
   correct identity (title "HimaHarness", sidebar "Research012 Workspace", sessions
   "Verify correction claims a…" / "ATCS installed setup and limits") — confirming
   this was the fresh, correctly-bound window and not a stale Trial/Reader window.
   This screenshot is **not** the proof the manual requires: it does not show the
   primary display, does not show the Claude/Catsights tester side by side, and does
   not prove single-Space placement.
4. `request_access` additionally reported `HimaHarness` window location as display id
   3 ("Catsights"), **not** the primary display (id 1, "Built-in Retina Display").
   This alone fails the discipline's "primary macOS display, one Space" requirement,
   independent of the missing screenshot.
5. Without having captured the mandatory layout proof, I proceeded to click "Open
   Campaign beside the conversation" and then opened/attempted to select from the
   Campaign dropdown (`Select a Campaign` → the one retained Campaign entry
   `agentic-timing-closure-system · test run · 03:19:45 PM`). The dropdown selection
   itself did not visibly take (menu closed without changing the selected value on
   the first attempt); a second attempt to reopen it was interrupted by the user
   before any further action.
6. **User intervention** stopped further navigation at this point, correctly
   identifying that the pre-action proof was missing. No Run-level or node-level
   control was ever located, recorded, or invoked. No Continue, no hold-clear, no
   Campaign/Run/Job mutation, no EDA, no licence action.

## Breach classification

This is a **tester preflight defect**, not a HimaHarness product defect:
- The window-scoped `app_screenshot` was mistaken for the mandatory full-display
  layout proof; they are not the same evidence.
- The window was not on the primary display when the App launched under the
  assigned Home/launcher, and this was not caught before the first click.

No inference is drawn about whether the Run-level control the manual asks about
(`UI_CONTROL_PRESENT` / `UI_CONTROL_MISSING` / `WRONG_WINDOW_REPRODUCED`) exists,
because the retained Run's Campaign detail panel and its controls were never
reached under clean, proven conditions.

## Ledger / Run state

The tester did not reach the Run detail view. A subsequent read-only integrator
check of the assigned Home's authoritative `hima_ledger.json` found the Run at
control revision **45**, epoch 1, status `running`, current node
`revisit-next-decision`, paused `["*"]`. A human-origin `host-exit` receipt with
`mode=drain` was added when the assigned App quit. The earlier exit receipt also
gained a `releasedAt` timestamp. These are Host lifecycle changes, so the
earlier statement that the Ledger was "untouched" would be inaccurate. The
retained pause remains; this trial issued no Continue, EDA, or design action.

## Teardown

1. The tester quit the App before finishing the report, checkpoint, and handoff.
   This order differs from the discipline's stated teardown sequence.
2. No Job or interactive lease was active this trial (none was created).
3. Quit the assigned App normally via `HimaHarness > Quit HimaHarness` (app menu,
   background control — no full-screen click was used for teardown).
4. Verified zero HimaHarness main processes after quit (`ps aux`, only unrelated
   `hima-runtime` backend service remains). No clean full-display screenshot was
   captured after teardown; process output is the retained teardown proof.
5. Full-screen control was requested once (in error, to work around a native
   dropdown menu) but released immediately without any full-screen click, drag, or
   keystroke ever being issued through it.
6. No Campaign/Run/Job was created and no Run control was invoked. App lifecycle
   receipts changed the Ledger as described above.

## Recommendation for the next trial

Before any product click:
- Capture a full-display (not window-scoped) screenshot that shows the primary
  display, the HimaHarness window at left 60%, the Claude/Catsights tester at right
  40%, and legible window titles.
- If `request_access`'s `windowLocations` reports the App window on a non-primary
  display, stop and either move the physical window to the primary display *before*
  any click (per "never move a test window between displays after the first product
  action" — this must happen at zero clicks) or treat it as `TEST_ENV_BLOCKED`
  immediately rather than proceeding to inspect Campaign/Run state.
