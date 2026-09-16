# Task 9 — L3 acceptance: seven Campaign workspace states, both themes, Catsights

Source SHA (worktree base, before this task's own commit): `47a25f25a043941f2e1d71108d837003b9be58e1`
Display: Catsights (confirmed online via `system_profiler SPDisplaysDataType` — `Online: Yes`, 1920×1200 — before any window test ran)
Window: 1280×800; dock pane dragged to 760 px per state via the docking kit's own splitter (see "Dock pane" below)

## Command

```
HIMA_UI_ARTIFACTS=/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-16/campaign-workspace \
  pnpm run test:desktop --files test/contract/campaign-workspace.desktop.test.ts
```

Final run: **7 passed, 0 failed, 0 skipped** (`test/contract/campaign-workspace.desktop.test.ts`), 14 window boots, ~205 s total.

```
HIMA_NODE=$HOME/.local/node24/bin/node   # this repo needs Node ≥24; the shell's default was 22.14
pnpm run test:desktop --files test/contract/campaign-graph.desktop.test.ts test/contract/unified-workbench.test.ts test/contract/growth-assets.desktop.test.ts
```

Result: **7 passed, 0 failed, 0 skipped** (the three routed files, item A/B/C — see below).

## Per-state result

| # | State | Light | Dark | Screenshots |
| - | --- | --- | --- | --- |
| 1 | Configuration page empty (no Pack, no Site) | pass | pass | `config-empty-light.png`, `config-empty-dark.png` |
| 2 | Configuration page ready | pass | pass | `config-ready-light.png`, `config-ready-dark.png` |
| 3 | Running with a node card open | pass | pass | `running-node-card-light.png`, `running-node-card-dark.png` |
| 4 | Waiting with the attention strip | pass | pass | `waiting-attention-light.png`, `waiting-attention-dark.png` |
| 5 | Ended with the Goal seal | pass | pass | `ended-goal-light.png`, `ended-goal-dark.png` |
| 6 | Side Talk non-owner | pass | pass | `side-talk-light.png`, `side-talk-dark.png` |
| 7 | Fifty-one node graph fitted to width | pass | pass | `graph-51-node-light.png`, `graph-51-node-dark.png` |

All 14 screenshots exist and were reviewed (`Read`) for rendering defects; the two found were fixed (below) and the file re-run to confirm.

## Dock pane (760 px)

No existing seam sizes the split between the chat column and the Hima sidebar (`display-placement.desktop.test.ts` and `desktop.test.ts` size the *window*, never a split inside it). The boundary is the docking kit's own splitter (a `.pI_x6G_handle` `col-resize` handle discovered by DOM inspection), dragged with real CDP `Input.dispatchMouseEvent` sequences (`widenDockPane`/`dragSplitterOnce` in the test file). Measured result: **765 px** on every state, every theme (window 1280 px, so the chat column keeps ~515 px). Each session holds its own docking surface (`SidebarRightState.bySession`), so the drag runs again after switching to a different session's tab (state 6's Side Talk) or reports short and is retried once if a still-settling slide-open transition was caught mid-flight (state 6 needed the retry once).

**State 7 is the one exception.** `FabricCanvas` fits-to-width **exactly once** per Run, at mount (`fittedFor.current !== runId` in `FabricCanvas.tsx`), and that fit is clamped to a **minimum scale of 0.6** by deliberate design ("labels must be visible the moment the canvas opens"). A 51-node reference graph therefore always *opens* readable, at exactly the 0.6 floor, regardless of pane width — dock width never controls whether it opens above or below the label-hidden line. Reaching "scale < 0.6, labels hidden" is the *next*, ordinary step past that: three clicks of the canvas's own `canvas-zoom-out` control, then `canvas-locate` to recentre on the current node (recentring after zoom in a fixed direction otherwise drifts the whole scene toward a corner). The dock pane is still widened to the usual 760 px for this state; the zoom-out is what produces the sub-0.6 scale, not the pane width.

## Screenshots

| File | State | Theme |
| --- | --- | --- |
| `config-empty-light.png` / `-dark.png` | 1 | light / dark |
| `config-ready-light.png` / `-dark.png` | 2 | light / dark |
| `running-node-card-light.png` / `-dark.png` | 3 | light / dark |
| `waiting-attention-light.png` / `-dark.png` | 4 | light / dark |
| `ended-goal-light.png` / `-dark.png` | 5 | light / dark |
| `side-talk-light.png` / `-dark.png` | 6 | light / dark |
| `graph-51-node-light.png` / `-dark.png` | 7 | light / dark |

## Routed items (A, B, C)

**A — `campaign-graph.desktop.test.ts`** clicked a hardcoded `node-pnr-foundry`, off-window at the follow scale (x≈3393). Changed to read `campaign-graph`'s own `current` state and click `node-<current>` (kept in view by the follow rule), asserting `data-hima-state-selected="true"` and that `campaign-node-card` opens with `state.node` equal to that id. Ran in isolation: pass. (Ran once alongside two other heavy desktop files it timed out on an unrelated later step — a Side Talk reply race, reproduced with my changes fully reverted too — confirmed pre-existing/environmental, not this file's own subject; passes cleanly alone and in the final combined run.)

**B — unowned legacy Run had no Continue/Stop.** `view.run.control === undefined` (the default `HIMA_TEST_LEGACY_AUTO_DRIVE` path) carries no `context.method`/reference graph at all (`executionContext`, `fabric.ts` — a genuine HimaFabric fact, not a UI gap: an unowned Run's execution context is computed nowhere near the pack's reference graph). So `FabricCanvas` — and its attention strip — never mounts for such a Run; the fix therefore landed in **`CampaignTab.tsx`**'s graph-less fallback (`scene === undefined` branch), not `FabricCanvas.tsx`:
- `resume`/`cancel` buttons, using the same `runControls` words and the same `showsResume`/`showsCancel` gating the transcript's own tool-receipt card (`HimaRunCard.tsx`'s `RunControls`) uses for an unowned Run, driving the same `actOnRun` route through the same `acting` object `CampaignTab` already threads to `FabricCanvas`.
- A `campaign-attention` region (kind `waiting`) showing the last blocker's own `reason` — read directly off `view.blockers`, which (unlike `context.method`) is a plain fact on the view regardless of ownership.
- A `campaign-goal` region showing the ended-status seal (`sealSaid`) once such a Run ends, for the same reason.
- The generic "reading the reference graph" placeholder line is suppressed whenever the blocker or seal line already explains the state, to avoid saying "historical automatic Run; explicit safe ownership migration is required" twice on screen.

`unified-workbench.test.ts`'s "preparation retries preserve drafts…" sub-test (the one this item targeted) now passes; the full file: 5/5 pass.

**C — `growth-assets.desktop.test.ts`** waited on the Evidence-only `run-growth` region without switching to the Evidence view first. Added `driver.click('studio-evidence')` before the wait. Passes.

## What states 3, 4, 6 actually needed (a correction to the plan)

`campaign-graph`, `campaign-node-card` and the *drawn* attention strip/Goal seal are all `FabricCanvas`-only, and `FabricCanvas` only ever mounts for an **owned** Run (`context.method` requires `run.control !== undefined`). States 3 and 6 therefore boot a fresh home (`localHome`, the same fixture `growth.ts`'s and `revision.ts`'s own fixtures build on) with a one-line scripted reply ("Keep this conversation as the Campaign Agent." → "Campaign Agent conversation is ready.") and `HIMA_TEST_LEGACY_AUTO_DRIVE=0`, establishing a genuine conversational owner before confirming the shipped Pack — not the file's own default (unowned) path every other state uses.

State 4 stays on the *default* (unowned) path deliberately: it is the direct proof of item B's fix, using the same `failures: 1` fixture `unified-workbench.test.ts`'s own retry case uses to reach a real HimaFabric `waiting` with a genuine blocker record.

## What was fixed after viewing the screenshots

Per the task's instruction to view every screenshot and fix real rendering defects:

1. **Redundant explanation text** (states 4 and 5, both themes): the graph-less fallback showed the blocker/seal line *and* the generic "historical automatic Run; explicit safe ownership migration is required" line together, saying the same thing twice. Fixed in `CampaignTab.tsx`: the generic line is now suppressed whenever a more specific blocker or seal line is already shown.
2. **State 7's composition after zooming out**: three `canvas-zoom-out` clicks (needed to cross the 0.6 floor) drift the scene toward a corner, since zoom keeps whatever point was under the (synthetic) cursor fixed rather than the whole scene centred. Added a `canvas-locate` click afterward, the same control a person would reach for, recentring on the current node before the screenshot.

No `fabric.ts` (HimaFabric semantics) or `canvas-layout.ts` (layout algorithm) changes were made or considered necessary; both fixes are client-only (`CampaignTab.tsx`) or test-only (the zoom+locate sequence).

## Everything captured; nothing skipped

All seven states, both themes, are real renders with passing assertions — no state was faked, stubbed, or captured only partially. The one deliberate departure from the blanket "760 px dock pane" instruction is state 7's zoom sequence, explained above and driven by `FabricCanvas`'s own 0.6-scale opening floor, not by an inability to reach the state.

## Unrelated, pre-existing observation

`agent-execution.desktop.test.ts`'s only test ("native selected conversation runs one explicit Job…") times out waiting for a scripted reply ("Replay: the local Job has started…") on this machine, both with and without every change in this task (`git stash` of `CampaignTab.tsx` reproduces the identical failure on the unmodified file) — confirmed pre-existing and unrelated to this task's own changes, not investigated further here.

## Build and typecheck

`pnpm run build` and `pnpm run typecheck` both pass clean (Node 24, `$HOME/.local/node24/bin`; the shell's default Node was 22.14, below this repo's `>=24` requirement — `HIMA_NODE`/`PATH` set explicitly for every command in this task).
