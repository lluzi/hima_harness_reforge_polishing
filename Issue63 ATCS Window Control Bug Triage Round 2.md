# Issue #63 — ATCS window/control bug triage, round 2

**Verdict: `TEST_ENV_BLOCKED`**

## Assigned identities (verified before launch)

- cycle: `hima-issue63-atcs-window-control-triage-2`
- manual: `docs/user-guide/issue63-atcs-window-control-bug-triage.md`
- discipline: `docs/user-guide/himaharness-human-like-test-discipline.md`
- release: https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/xtop-timing-closure-v1.0.16 (confirmed via `gh release view`, tag exists, published)
- main SHA: `0e6e94d43832125aefcb684b59b57e038411f91a` (matches `git log -1` on polishing checkout at task time)
- App: `.hima-tmp/issue52-app-trial33/HimaHarness.app` (exists on disk)
- Home: `.hima-tmp/atcs07-eb9d3234/Research012 Data/dsh` (exists on disk)
- launcher: `.hima-tmp/atcs07-eb9d3234/launch-research012-trial.command` — inspected before running; exports `HIMA_USER_DATA`/`DSH_HOME` to exactly the assigned Home and execs exactly the assigned App binary
- Site: `linglong-atcs28`; pack `agentic-timing-closure-system@0.1.2`; digest `7eefda6192db49be9d15cc31773372c0765cc6c3804684cf4f7c63ab7691b4d3`
- retained Campaign: `agentic-timing-closure-system-20260927-221945-c343`
- retained Run: `run-c0793069-3efa-442d-831b-047c5c5ad577`; epoch 1; revision 45; paused `["*"]`
- tester worktree/branch: `/Users/lluzi/.codex/worktrees/atcs07-tester/hima_harness_reforge_polishing` @ `codex/atcs07-acceptance`

All identities in the `HIMA_TEST_TASK_V1` envelope reconciled cleanly against `cycle.json`, the manual, the discipline doc, the launcher script contents, and the GitHub release. No identity mismatch here.

## Process preflight

- Before launch: `ps aux | grep -i himaharness` showed **zero** processes for the assigned `HimaHarness.app`. (One unrelated process existed: `hima-runtime` from the separate read-only `himaharness` reference repo — not this App, not a prior trial's leftover.)
- Launched the exact launcher once. After launch: exactly **one** HimaHarness main process (pid 79241, `Contents/MacOS/HimaHarness`) plus the expected Electron helper processes (renderer/gpu/network utility), all with `--user-data-dir=.../Research012 Data` matching the assigned Home. Process preflight passed.

## Window/display preflight — where it failed

The physical display topology is **three** monitors, not the mandated two:

- `Built-in Retina Display` (primary) — Claude/Codex/System Settings/coding windows, as expected.
- `Catsights` (external, arranged to the left of primary in System Settings ▸ Displays, negative-x region, 1920×1200) — the display the discipline assigns as the sole HimaHarness surface.
- `AirPanel 16` (external, arranged to the right of primary) — **not accounted for by the two-display policy**. A full-screen capture of this display showed two overlapping Finder windows exposing prior-trial evidence artifacts (`exec-*.png` files under a `library-intelligence-platform` workspace) left over from an earlier round. No HimaHarness window was present there, but its mere existence as an unplanned third product-adjacent surface is itself a deviation from the fixed test surface the discipline requires.

More importantly, the assigned HimaHarness window could not be proven present on Catsights:

- `app_list_windows` (Accessibility API) reported exactly one HimaHarness window: `window_id 139800`, `is_main: true`, `is_minimized: false`, `is_off_space: false`, bounds `{x:-1427, y:274, w:1280, h:860}`. The negative x is consistent with Catsights' arranged position (left of primary), and an `app_screenshot` targeting that window_id successfully rendered its content (sidebar showing `Research012 Workspace`, `New Session`, prior sessions `Verify correction claims agai…` and `ATCS installed setup and limits`, and a `Campaign` nav entry — consistent with the assigned Home/kit).
- However, a **physical full-display screenshot of Catsights** (taken twice, before and after a `switch_display`/`auto` cycle) showed **no HimaHarness window pixels at all** — only the desktop wallpaper — despite the Catsights menu bar itself showing `HimaHarness  View  Edit` as the frontmost app on that display's active Space.
- This is a direct contradiction between what Accessibility reports (window present, unminimized, on-Space) and what the physical display renders (nothing). No product click was made while this was unresolved.

Per the manual: *"If this proof or window identity is ambiguous, use `TEST_ENV_BLOCKED` before navigation."* The mandatory pre-click artifact — "one pre-action Catsights screenshot showing the full HimaHarness window and visible target identity" — could not be captured. I stopped here rather than force a window move or any product interaction while the window's actual on-screen state was unverifiable, since a wrong-window/wrong-surface action here would itself become a tester defect and could not support a `UI_CONTROL_PRESENT` / `UI_CONTROL_MISSING` / `WRONG_WINDOW_REPRODUCED` verdict.

## Not reached

- No inspection of the retained Run's node-level/Run-level controls, ids, epoch/revision or paused-scope labels was performed (never advanced past window preflight).
- No product interaction of any kind occurred. Retained Campaign/Run/Ledger are untouched.

## Root cause (not yet determined)

Two live hypotheses for the Accessibility/physical-render mismatch, neither confirmed:
1. The HimaHarness window belongs to a different Mission Control Space on the Catsights display than the one the physical screenshot captured (per-display Spaces can diverge from the Accessibility `is_off_space` flag, which may only track cross-display placement).
2. A rendering/compositor issue specific to this App build or this external-display configuration is preventing the window from drawing content on Catsights even though the OS considers it open and focused there.

This needs the improver's diagnosis; it was not something a read-only preflight could safely resolve without risking a wrong-window click.

## Teardown

- Quit the assigned HimaHarness App normally (`Contents/MacOS/HimaHarness`, pid 79241) after this report/checkpoint were written.
- Verified zero HimaHarness main processes remained afterward for the assigned Home (see checkpoint / final process check in the handoff).
- Retained Campaign/Run/Ledger left untouched — no Continue, no mutation, no successor created.

## Integrator read-only postcheck after tester handoff (2026-09-28 UTC)

The last sentence above is too broad. A read-only check of the assigned Home's
`storages/hima_ledger.json` after normal App quit found the same Run at control
epoch **1**, revision **47** (the preflight assignment was revision 45), status
`running`, current node `revisit-next-decision`, and paused scope `["*"]`.
Launching/quitting the Host therefore changed control metadata. This postcheck
does not show a Continue, hold clear, EDA action, or design mutation, and the
tester stopped before any product click. The `TEST_ENV_BLOCKED` verdict is
unchanged. The original tester handoff hash anchors the pre-addendum report;
this dated integrator correction is recorded in a later commit.
