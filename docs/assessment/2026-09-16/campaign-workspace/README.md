# Task 9 — L3 acceptance: seven Campaign workspace states, both themes, Catsights

Original source SHA: `47a25f25a043941f2e1d71108d837003b9be58e1`
First acceptance commit: `f73c34f52fed3e0b1c6ae27d39a11b84e51e2219`
**Design-review fix commit (this revision): see the report's own final SHA — `fix(ui): the canvas renders for every installed Pack's Run; the Goal seal and the attention strip appear; one toolbar row`. All 14 PNGs below are from this revision, not the first acceptance commit.**
Display: Catsights (confirmed online via `system_profiler SPDisplaysDataType` — `Online: Yes`, 1920×1200 — before any window test ran)
Window: 1280×800; dock pane dragged to 760 px per state via the docking kit's own splitter (see "Dock pane" below)

## Design review round (this revision)

Three defects the designer found in the first round's screenshots, all fixed:

1. **States 4 and 5 showed an empty pane — no graph, no strip, no seal.** Root cause: `executionContext` (`fabric.ts`) computes no `method`/reference graph at all for a Run with no `control` (the default, legacy auto-drive path), so `CampaignTab` had nothing to build a scene from. Fixed properly this time, not worked around: `CampaignTab.tsx` now fetches the *installed Pack's own* reference graph through `fetchStartChoices(packId)` (`proposal.referenceGraph`, which needs no Site) whenever `context?.method?.reference` is absent but `view.run.packId` is set — once per `(runId, packId)` pair, cached in state, never re-fetched on every 3 s poll. `sceneInputs(referenceGraph, view, context)` builds the scene from it exactly as it already did for an owned Run's fuller graph (`sceneInputs` already reads node states from `view.nodes`, unconditionally); `layoutCanvas` then renders through `FabricCanvas` completely normally — the *same* attention strip and Goal roundel every owned Run's Live view uses, not a second, parallel implementation. The `resume`/`cancel` controls moved from my first round's `CampaignTab.tsx` fallback into `FabricCanvas.tsx`'s own attention strip (their real home, now that the strip actually renders for these Runs), gated on `run?.control === undefined` — marker names unchanged. The fallback sentence now appears only when the fetch answers with no proposal at all (pack not installed): "The Pack ‹id› is not installed on this Host; the reference graph cannot be shown."
2. **The Goal roundel's label ran into the last node's own label** (`next-periodclock period at m…`, seen in the first round's `side-talk-dark.png`). Fixed in `canvas-layout.ts`: `goal.x = X0 + (maxRank + 1.5) * PITCH`, not `+ 1` — a half-pitch of extra clearance past the last main-spine node. Updated by hand and re-derived: `canvas-layout.test.ts`'s linear-graph test (`goal.x = X0 + 4.5 * PITCH`, was `4 * PITCH`), the 51-node width test (`X0 + 51.5 * PITCH + 96`, was `51 * PITCH + 96`), and the open-loop width test — whose two-node loop fixture no longer produces a wider *open* frame than the new, larger goal-based floor (both were forced to the identical `385`), so the fixture grew a third loop node (`d3`) to restore the test's own real claim ("an open loop widens the scene"): `closed.width = 385`, `open.width = 445`, hand-derived in the test's own comment. In `FabricCanvas.tsx`, the *running* Goal label truncates to 14 characters (was 18), full text still in `<title>`. Verified fixed: `running-node-card-*.png` and `side-talk-*.png` now show clean separation between the last node and the Goal.
3. **The pane opened with an empty toolbar row** (nothing in it but two right-aligned buttons) **above a second CAMPAIGN-picker row.** Merged into one 40 px row in `HimaWorkbench.tsx`: `CAMPAIGN` eyebrow, the picker, the refresh icon, `Start another Campaign`, then `Files & code` and `Pack & assets` restyled `.hima-icon-button` (compact) at the right — same markers (`studio-pack-owner`, `studio-run`, `studio-configure`), same visible text (`Files & code`'s own text is still what `markText('button', 'Files & code', …)` matches in the existing desktop suites — never replaced with an icon-only control text could no longer match). CSS: `.hima-studio-header` now carries the full row (`min-height: 40px`), `.hima-run-picker` removed (nothing referenced it once its markup merged in).

A residual, lesser tightness remains in the *ended* state's own seal: `sealSaid`'s longest status word ("ended — budget exhausted") is wider than the running Goal label ever gets (it is deliberately never truncated — "the seal keeps the 20 px status word", per the designer's own instruction), so on the shipped Pack's short main spine the seal's own text sits close to (not touching) the last node's shape in the `ended-goal-*.png` pair. Noted rather than further adjusted, since the designer's own formula (`+1.5`) is what was asked for and is what fixed the named defect (confirmed clean in `side-talk-*.png`/`running-node-card-*.png`); enlarging the margin further to cover the *longest possible* ended-status word as well is a separate, follow-on design call.

## Command

```
HIMA_UI_ARTIFACTS=/Users/lluzi/code/hima_harness_reforge_polishing/docs/assessment/2026-09-16/campaign-workspace \
  pnpm run test:desktop --files test/contract/campaign-workspace.desktop.test.ts
```

Final run (this revision, after the design-review fixes): **7 passed, 0 failed, 0 skipped** (`test/contract/campaign-workspace.desktop.test.ts`), 14 window boots. (One prior attempt in this same revision hit a flaky Side Talk session-creation timeout on state 6's dark theme alone — a UI-timing race in test setup, not a rendering defect — and passed cleanly on immediate re-run; the final, kept run is 7/7 with all 14 PNGs replaced.)

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

**B — unowned legacy Run had no Continue/Stop.** `view.run.control === undefined` (the default `HIMA_TEST_LEGACY_AUTO_DRIVE` path) carries no `context.method`/reference graph at all (`executionContext`, `fabric.ts` — a genuine HimaFabric fact, not a UI gap: an unowned Run's execution context is computed nowhere near the pack's reference graph). So `FabricCanvas` — and its attention strip — never mounted for such a Run.

*First round's fix* (superseded — see "Design review round" above): added a parallel `resume`/`cancel`/`campaign-attention`/`campaign-goal` implementation directly in `CampaignTab.tsx`'s graph-less fallback, since `FabricCanvas` was unreachable. Functionally correct (all seven states passed) but flagged by design review as producing an *empty pane* instead of the real graph for states 4 and 5.

*This revision's fix*: `CampaignTab.tsx` fetches the installed Pack's own reference graph (`fetchStartChoices`) whenever `context.method` is absent, so `FabricCanvas` mounts normally for an unowned Run too — the real attention strip and Goal roundel render, not a second implementation of them. `resume`/`cancel` moved into `FabricCanvas.tsx`'s own attention strip, gated on `run?.control === undefined`, using the same `runControls`/`showsResume`/`showsCancel` words the transcript's own tool-receipt card (`HimaRunCard.tsx`'s `RunControls`) already uses for an unowned Run, through the same `acting.act(...)` → `actOnRun` route. Marker names unchanged throughout both rounds.

`unified-workbench.test.ts`'s "preparation retries preserve drafts…" sub-test (the one this item targeted) passes in both rounds; the full file: 5/5 pass, confirmed again after this revision's changes.

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
