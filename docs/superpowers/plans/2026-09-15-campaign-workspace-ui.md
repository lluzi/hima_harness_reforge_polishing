# Campaign Workspace UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement [GitHub #41](https://github.com/lluzi/hima_harness_reforge_polishing/issues/41) — the spec at `docs/specs/campaign-workspace-ui/spec.md`: the HimaFabric canvas as the Live view, the Campaign file and Configuration page, Campaign identity in the shell's own slots, and one visual system with a 12 px floor.

**Architecture:** Everything stays a projection inside the existing DeepSeek Harness shell and the existing `@hima/harness` client bundle (React 18, esbuild into the dsh client-module envelope; React and the dsh client libraries are externals). The Host gains a Campaign-file route, Preparation overrides, a Site discovery surface and a bounded Job log tail, all under `/hima/api`. One new pure module, `canvas-layout.ts`, turns a reference graph plus execution facts into a positioned scene, so fork, loop, growth and revision layouts are testable without a window. No new service, no second graph engine, no Campaign management object (Q63), no Permit bypass (ADR-0009).

**Tech Stack:** TypeScript 5.9 (Node 24 type stripping in tests), React 18 via `createElement`/JSX (`tsconfig.client.json`, `jsx: react-jsx`), zod 4, `yaml`, Node's own test runner (`node --test`) through `scripts/run-contract-tests.mjs`, the real in-process/subprocess dsh Host (`test/contract/support/boot-host.ts`, `boot-inprocess.ts`), the Electron driver (`support/driver.ts`) on the Catsights display.

## Global Constraints

Copied from the spec; every task's requirements implicitly include these.

- Read `CONTEXT.md` (glossary) and `docs/agents/polishing-discipline.md` before editing. Use the glossary's words: Campaign, Run, Job, Site, HimaPack, HimaGuide, HimaFabric, Campaign Agent, Side Talk, Campaign Preparation, Goal, 参考运行图 (reference graph), 执行轨迹 (execution trace).
- Pack-agnostic: every form on the canvas belongs to HimaFabric's vocabulary (node kinds `act|judge|explore|wait`; outcomes `PASS|FAIL|UNDETERMINED|goal-met|converged|generation-limit`; the revisit edge; loops opened by `explore.opens`; fork = act with ≥2 unlabelled outgoing edges, join = judge with ≥2 incoming; growth = `GrowthGraph` attached at `parentNode`/`returnNode`; revisions = `changedNodes`/`affectedNodes`). Every *word* (goal label, unit, knob names, node captions) comes from the Pack. Never special-case a pack id.
- Type scale, exact: display 20 px (the seal only), title 16, body 14, label 13, eyebrow 12 with letter-spacing. **Nothing below 12 px; nothing a person reads below 13 px.** Mono only for raw output and hashes. Tabular figures wherever digits align. Space on a 4 px base; 16 px pane gutter.
- Three trust surfaces: **paper** for verified facts, **soft tint** for live Agent work, **dark glass** for raw output in both themes. State is encoded as shape **and** colour together. Palette: one green, one live orange, one amber, one red, one accent, one neutral. Warm-biased neutrals. WCAG AA in both themes. Both themes from one token set with the shell's `--dsw-alias-*` aliases as the first source and Hima fallbacks second.
- Icons: an inline SVG glyph set. **No unicode characters as icons** (`✓ ◉ ◇ × ○ ＋ → ↗`), **no imported icon font, no inline `style={{…}}` in client components.** Host system font stack.
- Motion: only the running node pulses; a traversed edge lights once; the revisit arc pulses once when a generation opens; the elapsed figure ticks. `prefers-reduced-motion` and a stale snapshot stop everything.
- Layout numbers from the approved mockup (`docs/specs/campaign-workspace-ui/mockup/hima-campaign-mockup.html`, images under `docs/specs/campaign-workspace-ui/images/`): masthead 66 px, view switch 36 px, attention strip 32 px, node pitch 90 px, branch row 96 px, node card about 384 × 300, labels hide below 60 % zoom.
- Every region and control keeps the desktop driver marker contract: `data-hima-region="<name>"` with `data-hima-state-<key>="<value>"` attributes, `data-hima-control="<name>"` on clickable/fillable controls. Existing tests read them through `d.read(region)` / `d.click(control)` / `d.fill(control, value)` (`test/contract/support/driver.ts`).
- Ownership: the owner session (`view.run.control.owner === sessionId`) sees business controls (Continue, node-scoped Pause/Continue). A non-owner (Side Talk) sees who owns the Run, one "Open Campaign Agent" way there, and only human-origin emergency Pause and Stop under a confirmed overflow. Continue is hidden from non-owners. Navigation is never control (Q49).
- "Ask HimaGuide" places a draft in the composer; **nothing is ever sent on the person's behalf.**
- The Ledger's proposal id remains the only confirmed fact; the Campaign file is a workspace draft. Readiness is HimaFabric's own Preparation computed on the file's contents; invalidation follows the proposal facts identity (`campaignProposalFactsIdentity`).
- Test discipline (`docs/testing-strategy.md`, `test/README.md`): every new test file is listed in `test/contract-groups.json` (`local` for L1/L2, `desktop` for Electron). Run the narrowest files first: `pnpm run build` once after source changes, then `pnpm run test:local --files <paths>`; `pnpm run typecheck` before every commit; `pnpm run check:seams` if you import any `@deepseek-ai/*` package (add the `// @hima-seam <name> direct|wrapped` marker). Report pass, fail, skip and not-run separately; a skipped desktop test is not a pass.
- Commit to the current branch (`main`) after each task with the attribution line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; push immediately and verify the remote SHA (`AGENTS.md`). Use `git -c core.hooksPath=/dev/null commit` only if the pre-commit hook is not installed anyway; run typecheck yourself in that case.
- Do not modify anything under `packs/`, `sites/`, `profiles/` or `docs/` other than the files this plan names.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/harness/src/client/workbench-style.ts` | The one token sheet (`HIMA_STYLE`) and every class rule Hima's client renders. Tokens between `/* HIMA CLIENT TOKENS BEGIN */` and `/* HIMA CLIENT TOKENS END */`. |
| `packages/harness/src/client/glyphs.tsx` | The inline SVG glyph set (`Glyph`). |
| `packages/harness/src/canvas-layout.ts` | Pure scene layout: reference graph + facts → positioned nodes, edges, frames, goal. No DOM, no Node imports. |
| `packages/harness/src/campaign-file.ts` | `hima-campaign/1` schema, parse/serialize, read/write under a session workspace, overrides derivation. |
| `packages/harness/src/client/scene.ts` | Adapter: `RunView` + `ExecutionContext` + reference graph → `LayoutGraph` + `LayoutFacts` + captions. |
| `packages/harness/src/client/CampaignTab.tsx` | The Campaign tab: masthead, view switch, Live/Generations/Evidence/Report views. |
| `packages/harness/src/client/Masthead.tsx` | The one-line masthead. |
| `packages/harness/src/client/FabricCanvas.tsx` | SVG canvas renderer: scene, zoom/pan/fit/follow, attention strip, goal roundel, controls, legend. |
| `packages/harness/src/client/FabricNode.tsx` | One node's form, state glyph, caption, marks. |
| `packages/harness/src/client/NodeCard.tsx` | The anchored node card with kind-specific tabs and owner controls. |
| `packages/harness/src/client/ConfigurationPage.tsx` | The Campaign file rendered as a document; in-place editing; readiness; confirm. |
| `packages/harness/src/client/PackOwnerPanel.tsx` | The existing Pack owner panel moved out of `HimaWorkbench.tsx`, unchanged in behaviour, restyled. |
| `packages/harness/src/client/SettingsSection.tsx` | HimaHarness settings section: Packs, Sites, current knowledge. |
| `packages/harness/src/client/owned-run.ts` | `useOwnedRun(sessionId)`: which Run this session owns, polled. Shared by chip, tab title, tab body. |
| `packages/harness/src/client/HimaWorkbench.tsx` | Slot root only: picks Configuration page or Campaign tab; owns Run selection. |
| `packages/harness/src/client/HimaRunCard.tsx` | Tool receipt in the transcript (compact) plus the shared row/section components, restyled with classes. |
| `packages/harness/src/client/api.ts` | Client fetchers for the new routes. |
| `packages/harness/src/client/index.ts` | Slot registrations (integrator-owned). |
| `packages/harness/src/remote.ts`, `index.ts`, `tools.ts`, `paths.ts`, `fabric.ts`, `sites.ts`, `workbench.ts` | Host: routes, operations, tools, overrides (integrator-owned). |
| `test/contract/client-style.test.ts` | Contract: token floor, no unicode icons, no inline styles. |
| `test/contract/canvas-layout.test.ts` | L1: layout fixtures. |
| `test/contract/campaign-file.host.test.ts` | L2: file round-trip, overrides, readiness invalidation, start from file, tools. |
| `test/contract/site-surface.host.test.ts` | L2: Site discovery route/tool against a stand-in, log tail route. |
| `test/contract/campaign-workspace.desktop.test.ts` | L3: seven acceptance states, light and dark, screenshots. |

---

### Task 1: Token sheet, glyph set and the floor contract test

**Files:**
- Modify: `packages/harness/src/client/workbench-style.ts` (rewrite; export `HIMA_STYLE`, keep `STUDIO_STYLE` as a deprecated alias `export const STUDIO_STYLE = HIMA_STYLE;` until Task 5 removes the last import)
- Create: `packages/harness/src/client/glyphs.tsx`
- Modify: `packages/harness/src/client/HimaWorkbench.tsx`, `packages/harness/src/client/HimaRunCard.tsx`, `packages/harness/src/client/index.ts` (replace every unicode icon character with `<Glyph>`; nothing else)
- Create: `test/contract/client-style.test.ts`
- Modify: `test/contract-groups.json` (add the test to `local`)

**Interfaces:**
- Produces: `export const HIMA_STYLE: string` — the whole sheet; class names all prefixed `hima-`. Root mounts carry `className="hima-root"` (tokens are declared on `.hima-root`, so the sheet works inside any slot without touching `:root`).
- Produces: `export type GlyphName = 'check' | 'dot' | 'ring' | 'hourglass' | 'retry' | 'square' | 'bar' | 'diamond' | 'circle' | 'octagon' | 'locate' | 'zoom-in' | 'zoom-out' | 'close' | 'arrow-right' | 'warning'` and `export function Glyph(props: { name: GlyphName; size?: number; className?: string }): ReactElement` — inline `<svg viewBox="0 0 16 16" aria-hidden="true">`, `stroke="currentColor"`, `fill="none"` (the `check`, `dot`, `square` filled variants use `fill="currentColor"`), default size 16.

Token sheet contents (exact values; add class rules for later tasks in later tasks, always through these tokens):

```css
/* HIMA CLIENT TOKENS BEGIN */
.hima-root{
  color-scheme:light dark;
  --hima-font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;
  --hima-font-mono:"SF Mono","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --hima-fs-display:20px; --hima-fs-title:16px; --hima-fs-body:14px; --hima-fs-label:13px; --hima-fs-eyebrow:12px;
  --hima-lh-tight:1.25; --hima-lh-body:1.5; --hima-track:.06em;
  --hima-sp-1:4px; --hima-sp-2:8px; --hima-sp-3:12px; --hima-sp-4:16px; --hima-sp-5:20px; --hima-sp-6:24px; --hima-sp-8:32px;
  --hima-r-s:4px; --hima-r-m:8px; --hima-r-l:12px;
  --hima-paper:var(--dsw-alias-background-primary,#fbfaf7);
  --hima-soft:var(--dsw-alias-fill-secondary,#f3f1ec);
  --hima-glass:#17161a; --hima-glass-ink:#d9d4c8; --hima-glass-line:#ffffff1f;
  --hima-line:var(--dsw-alias-border-l2,#e3dfd6); --hima-line-strong:#00000029;
  --hima-ink:var(--dsw-alias-label-primary,#232120); --hima-ink-2:var(--dsw-alias-label-secondary,#615c55); --hima-ink-3:var(--dsw-alias-label-tertiary,#8a847b);
  --hima-on-solid:#ffffff;
  --hima-good:var(--dsw-alias-state-success-primary,#2f7a45); --hima-live:#b8532f; --hima-warn:var(--dsw-alias-state-warn-primary,#8e620d);
  --hima-bad:var(--dsw-alias-state-error-primary,#ad3f36); --hima-accent:#4f5fd8; --hima-neutral:#8a847b;
  --hima-shadow:0 1px 2px rgba(20,18,15,.06),0 10px 28px rgba(20,18,15,.08);
  color:var(--hima-ink);font-family:var(--hima-font-ui);font-size:var(--hima-fs-body);line-height:var(--hima-lh-body);font-variant-numeric:tabular-nums;
}
@media (prefers-color-scheme:dark){.hima-root{
  --hima-paper:var(--dsw-alias-background-primary,#1c1b1c);--hima-soft:var(--dsw-alias-fill-secondary,#252422);
  --hima-line:var(--dsw-alias-border-l2,#3a3733);--hima-line-strong:#ffffff29;
  --hima-ink:var(--dsw-alias-label-primary,#ece8e0);--hima-ink-2:var(--dsw-alias-label-secondary,#b5afa4);--hima-ink-3:var(--dsw-alias-label-tertiary,#8f8a80);
  --hima-on-solid:#1c1b1c;
  --hima-good:var(--dsw-alias-state-success-primary,#8fcb9c);--hima-live:#e59a7a;--hima-warn:var(--dsw-alias-state-warn-primary,#dcb45f);
  --hima-bad:var(--dsw-alias-state-error-primary,#e38f87);--hima-accent:#a3abff;--hima-neutral:#8f8a80;
  --hima-shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);
}}
:root[data-theme="dark"] .hima-root{ /* the same dark block, repeated verbatim, so an explicit shell theme wins */ }
/* HIMA CLIENT TOKENS END */
```

Rules that must survive from the current sheet (rename, do not drop): `.hima-entry` (sidebar footer button), `.hima-brand`, `.hima-button`, `.hima-primary`, `.hima-icon-button`, focus ring, `.hima-notice`, `.hima-empty`, `.hima-detail`, `.hima-report`, `.hima-evidence`, `.hima-activity` (dark glass), the pack-owner form fields. Every `font-size:` in the sheet must be `var(--hima-fs-<step>)`. Delete every 9/10/11 px rule.

- [ ] **Step 1: Write the failing contract test**

`test/contract/client-style.test.ts`:

```ts
// Contract: the client token sheet keeps the 12 px floor, and the client renders no unicode icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { HIMA_STYLE } from '../../packages/harness/src/client/workbench-style.ts';

const BEGIN = '/* HIMA CLIENT TOKENS BEGIN */';
const END = '/* HIMA CLIENT TOKENS END */';
const clientDir = path.resolve(import.meta.dirname, '../../packages/harness/src/client');
const clientFiles = () => readdirSync(clientDir).filter((name) => /\.tsx?$/.test(name)).map((name) => path.join(clientDir, name));

test('the token sheet states a scale of five steps and nothing below 12 px', () => {
  const begins = HIMA_STYLE.indexOf(BEGIN), ends = HIMA_STYLE.indexOf(END);
  assert.ok(begins >= 0 && ends > begins, 'the sheet opens with one delimited token block');
  const tokens = HIMA_STYLE.slice(begins, ends);
  const steps = Object.fromEntries([...tokens.matchAll(/--hima-fs-([a-z]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(steps, { display: 20, title: 16, body: 14, label: 13, eyebrow: 12 });
  for (const [declaration, size] of HIMA_STYLE.matchAll(/font-size:\s*([^;}]+)/g)) {
    assert.match(size!.trim(), /^var\(--hima-fs-[a-z]+\)$/, `every size is a step of the scale: ${declaration}`);
  }
  assert.doesNotMatch(HIMA_STYLE, /\b(9|10|11)px/, 'no size under the floor by any route');
});

test('the client draws icons as inline SVG, never as unicode characters', () => {
  for (const file of clientFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const glyph of ['✓', '◉', '◇', '×', '○', '＋', '→', '↗', '←']) {
      assert.ok(!text.includes(glyph), `${path.basename(file)} uses ${glyph} as an icon`);
    }
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Add `"test/contract/client-style.test.ts"` to the `local` array in `test/contract-groups.json`, then:

```bash
pnpm run test:local --files test/contract/client-style.test.ts
```
Expected: FAIL (`HIMA_STYLE` is not exported; unicode glyphs present).

- [ ] **Step 3: Write the sheet and the glyph set**

Rewrite `workbench-style.ts` with the token block above and every rule through tokens. Create `glyphs.tsx` with the 16 glyphs (simple 16×16 paths; e.g. `check`: `M3.5 8.5l3 3 6-6`; `hourglass`: `M4 2h8M4 14h8M5 2c0 4 6 4 6 8M11 2c0 4-6 4-6 8`; `retry`: `M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3`; `locate`: crosshair; `zoom-in`/`zoom-out`: circle + handle ± bar; `close`: two diagonals; `warning`: triangle + bar + dot). Replace the unicode icons in `HimaWorkbench.tsx` (`stateGlyph`, `＋ New Campaign`, `→`, `✓`), `HimaRunCard.tsx` and `index.ts` with `<Glyph name=…/>` (map: done/ended-goal-met→`check`, running→`dot`, waiting family→`diamond`, blocked/cancelled family→`square`, else `circle`). Keep the desktop marker attributes exactly as they are.

- [ ] **Step 4: Run test, typecheck, build**

```bash
pnpm run build && pnpm run typecheck && pnpm run test:local --files test/contract/client-style.test.ts
```
Expected: PASS, `2 pass`.

- [ ] **Step 5: Commit and push**

```bash
git add packages/harness/src/client test/contract/client-style.test.ts test/contract-groups.json
git commit -m "feat(ui): one client token sheet with a 12 px floor and an inline glyph set"
git push && git rev-parse HEAD && git rev-parse origin/main
```

---

### Task 2: Canvas layout as a pure function

**Files:**
- Create: `packages/harness/src/canvas-layout.ts`
- Create: `test/contract/canvas-layout.test.ts`
- Modify: `test/contract-groups.json` (add to `local`), `packages/harness/src/index.ts` (add `export { layoutCanvas, fitToWidth, labelsVisibleAt, PITCH, ROW, NODE } from './canvas-layout.js'; export type { CanvasScene, LayoutGraph, LayoutFacts, PlacedNode, PlacedEdge, Frame, NodeVisualState } from './canvas-layout.js';`)

**Interfaces (Produces — later tasks depend on these exact names):**

```ts
export type NodeKind = 'act' | 'judge' | 'explore' | 'wait';
export type NodeVisualState = 'pending' | 'available' | 'running' | 'waiting-for-slot' | 'retrying' | 'blocked' | 'cancelled' | 'done' | 'reconciled';
export interface LayoutNode { readonly id: string; readonly kind: NodeKind; readonly caption?: string }
export interface LayoutEdge { readonly from: string; readonly to: string; readonly outcome?: string; readonly revisit?: true }
export interface LayoutSubgraph { readonly entry: string; readonly nodes: readonly LayoutNode[]; readonly edges: readonly LayoutEdge[] }
export interface LayoutGraph extends LayoutSubgraph { readonly loops?: Readonly<Record<string, LayoutSubgraph>>; readonly opens?: Readonly<Record<string, string>> /* explore node id → loop name */ }
export interface LayoutFacts {
  readonly states?: Readonly<Record<string, NodeVisualState>>;   // Ledger node state per node id (last transition)
  readonly available?: readonly string[];                        // ExecutionContext.available
  readonly currentNode?: string; readonly generation?: number;   // run row
  readonly progress?: Readonly<Record<string, number>>;          // 0..1 when known
  readonly waitedForSlot?: readonly string[];
  readonly openLoop?: { readonly id: string; readonly generation: number };
  readonly fork?: { readonly node: string; readonly join: string; readonly branches: readonly { readonly id: string; readonly nodes: readonly string[] }[] };
  readonly growths?: readonly { readonly proposalId: string; readonly parentNode: string; readonly returnNode: string; readonly graph: LayoutSubgraph }[];
  readonly revisions?: readonly { readonly changedNodes: readonly string[]; readonly affectedNodes: readonly string[] }[];
}
export interface PlacedNode { readonly id: string; readonly kind: NodeKind; readonly x: number; readonly y: number; readonly rank: number; readonly row: number; readonly state: NodeVisualState; readonly caption?: string; readonly current: boolean; readonly progress?: number; readonly waitedForSlot: boolean; readonly revised?: 'changed' | 'affected'; readonly frame?: string }
export interface PlacedEdge { readonly from: string; readonly to: string; readonly kind: 'dependency' | 'outcome' | 'revisit' | 'return'; readonly outcome?: string; readonly lit: boolean; readonly path: string; readonly chip?: { readonly x: number; readonly y: number; readonly text: string }; readonly badge?: { readonly x: number; readonly y: number; readonly count: number } }
export interface Frame { readonly id: string; readonly kind: 'loop' | 'growth'; readonly label: string; readonly anchor: string; readonly open: boolean; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface CanvasScene { readonly width: number; readonly height: number; readonly nodes: readonly PlacedNode[]; readonly edges: readonly PlacedEdge[]; readonly frames: readonly Frame[]; readonly goal: { readonly x: number; readonly y: number } }
export const PITCH = 90, ROW = 96, NODE = 36, X0 = 64, PAD_Y = 72;
export function layoutCanvas(graph: LayoutGraph, facts?: LayoutFacts): CanvasScene;
export function fitToWidth(scene: CanvasScene, viewport: { width: number; height: number }): { scale: number; tx: number; ty: number };
export const labelsVisibleAt = (scale: number): boolean => scale >= 0.6;
```

Layout rules (deterministic; the tests below assert them):
1. **Rank**: `rank(entry) = 0`; for every other node, `rank = 1 + max(rank of predecessors)` over non-revisit edges of the same subgraph (Kahn order; ties by declaration order). `x = X0 + rank * PITCH`.
2. **Row**: spine row 0. A node whose only incoming edges are outcome-labelled `FAIL` or `UNDETERMINED` sits at `row = +1` and `rank = rank(source) + 0.5`. Fork branches (`facts.fork` or, absent facts, an act with ≥2 unlabelled outgoing edges): branch `i` of `n` gets `row = (i - (n - 1) / 2) * 0.6` for every node between the fork and its join; the join returns to row 0. `y = PAD_Y + row * ROW` after shifting so `min row` maps to `PAD_Y`.
3. **State**: `facts.states[id]` wins; else `available.includes(id)` → `available`; else `pending`. `current = id === currentNode`.
4. **Edges**: dependency `M sx+18 sy L tx-18 ty`; outcome edge carries `chip = { x: (sx+tx)/2, y: sy - 24, text: outcome }` (vertical edges: `x = tx - NODE/2 - 12`, `y = sy + 62`); FAIL/UNDETERMINED to a row +1 node: cubic `M sx+18 sy C sx+22 sy, tx ty-30, tx ty-18` with the chip under the target's caption (`y = ty + 34`). Revisit edge: `kind: 'revisit'`, an arc above the spine `M sx sy-18 C sx sy-90, tx tx? ...` (any arc that stays above `PAD_Y - 40`), `badge = { x: (sx+tx)/2, y: PAD_Y - 52, count: facts.generation ?? 1 }`. Growth return edge: `kind: 'return'`, dashed by the renderer.
5. **Lit**: `lit = state(from) === 'done' || state(from) === 'reconciled'`; a revisit edge is lit when `generation > 1`.
6. **Loops**: for every explore node that opens a loop, a `Frame { kind: 'loop', anchor: exploreId, open: facts.openLoop?.id === loopName }`. Closed: a collapsed frame `width = 120, height = 28` hung at `x = node.x + PITCH/2, y = node.y + ROW*0.55`, label `<loop name> · <n> nodes`. Open: the loop's nodes are laid out by the same rules inside the frame (`frame: loopName` on each), the frame spans them with 24 px padding, and the spine below the explore node shifts down by the frame's height + 24.
7. **Growth**: each accepted growth is a `Frame { kind: 'growth', anchor: parentNode, open: true }` laid out below `parentNode` starting at `rank(parentNode) + 0.5`, row +1.2, with a dashed return edge to `returnNode`.
8. **Revisions**: `revised = 'changed'` for every node in any `changedNodes`, else `'affected'` for `affectedNodes`.
9. **Goal**: `goal = { x: X0 + (maxRank + 1) * PITCH, y: spine y }`; `width = goal.x + 96`; `height = (maxRow - minRow + 1) * ROW + 2 * PAD_Y` (plus open frame heights).
10. `fitToWidth`: `scale = min(1, (viewport.width - 32) / scene.width)`; `tx = 16`, `ty = max(16, (viewport.height - scene.height * scale) / 2)`.

- [ ] **Step 1: Write the failing tests** (`test/contract/canvas-layout.test.ts`)

```ts
// L1: the canvas layout is a pure function of the reference graph, execution facts and Run view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutCanvas, fitToWidth, labelsVisibleAt, PITCH, ROW, X0, PAD_Y } from '@hima/harness';
import type { LayoutGraph } from '@hima/harness';

const node = (id: string, kind: 'act' | 'judge' | 'explore' | 'wait' = 'act') => ({ id, kind });
const linear: LayoutGraph = { entry: 'prepare', nodes: [node('prepare'), node('analyze'), node('check', 'judge'), node('select', 'explore')],
  edges: [{ from: 'prepare', to: 'analyze' }, { from: 'analyze', to: 'check' }, { from: 'check', to: 'select', outcome: 'PASS' }, { from: 'select', to: 'analyze', revisit: true }] };

test('a linear graph ranks along one spine at the mockup pitch and ends in a Goal roundel', () => {
  const scene = layoutCanvas(linear);
  assert.deepEqual(scene.nodes.map((n) => [n.id, n.rank, n.row, n.state]), [['prepare', 0, 0, 'pending'], ['analyze', 1, 0, 'pending'], ['check', 2, 0, 'pending'], ['select', 3, 0, 'pending']]);
  assert.equal(scene.nodes[1]!.x, X0 + PITCH);
  assert.equal(scene.nodes[1]!.y, PAD_Y);
  assert.equal(scene.goal.x, X0 + 4 * PITCH);
  assert.equal(scene.edges.find((e) => e.outcome === 'PASS')?.chip?.text, 'PASS');
});

test('the revisit edge is one arc above the spine carrying the generation count, lit from generation two', () => {
  const first = layoutCanvas(linear, { generation: 1 });
  const third = layoutCanvas(linear, { generation: 3, states: { prepare: 'done', analyze: 'running' }, currentNode: 'analyze', progress: { analyze: 0.62 } });
  const arc = (scene: ReturnType<typeof layoutCanvas>) => scene.edges.find((e) => e.kind === 'revisit')!;
  assert.equal(arc(first).badge?.count, 1); assert.equal(arc(first).lit, false);
  assert.equal(arc(third).badge?.count, 3); assert.equal(arc(third).lit, true);
  assert.ok(arc(third).badge!.y < PAD_Y - 18, 'the badge sits above the spine');
  assert.equal(third.edges.find((e) => e.from === 'prepare')!.lit, true, 'a traversed edge lights once its source is done');
  assert.equal(third.nodes.find((n) => n.id === 'analyze')!.current, true);
  assert.equal(third.nodes.find((n) => n.id === 'analyze')!.progress, 0.62);
});

test('a FAIL outcome to a wait node hangs the node one row down at a half rank', () => {
  const graph: LayoutGraph = { entry: 'a', nodes: [node('a'), node('j', 'judge'), node('blocked', 'wait'), node('b')],
    edges: [{ from: 'a', to: 'j' }, { from: 'j', to: 'b', outcome: 'PASS' }, { from: 'j', to: 'blocked', outcome: 'FAIL' }] };
  const scene = layoutCanvas(graph, { states: { blocked: 'blocked' } });
  const wait = scene.nodes.find((n) => n.id === 'blocked')!;
  assert.equal(wait.rank, 1.5); assert.equal(wait.row, 1); assert.equal(wait.state, 'blocked');
  assert.equal(scene.nodes.find((n) => n.id === 'b')!.row, 0);
  assert.equal(scene.height, 2 * ROW + 2 * PAD_Y);
});

test('a fork fans into symmetric branch rows that meet at their join', () => {
  const graph: LayoutGraph = { entry: 'impl', nodes: [node('impl'), node('route-a'), node('route-b'), node('sign-off', 'judge')],
    edges: [{ from: 'impl', to: 'route-a' }, { from: 'impl', to: 'route-b' }, { from: 'route-a', to: 'sign-off' }, { from: 'route-b', to: 'sign-off' }] };
  const scene = layoutCanvas(graph, { fork: { node: 'impl', join: 'sign-off', branches: [{ id: 'a', nodes: ['route-a'] }, { id: 'b', nodes: ['route-b'] }] } });
  const rows = Object.fromEntries(scene.nodes.map((n) => [n.id, n.row]));
  assert.equal(rows['route-a'], -0.3); assert.equal(rows['route-b'], 0.3); assert.equal(rows['sign-off'], 0); assert.equal(rows.impl, 0);
  assert.equal(scene.nodes.find((n) => n.id === 'route-a')!.rank, scene.nodes.find((n) => n.id === 'route-b')!.rank);
});

test('a drill-down loop is a collapsed frame under its explore node until the Run is inside it', () => {
  const graph: LayoutGraph = { entry: 'a', nodes: [node('a'), node('dig', 'explore')], edges: [{ from: 'a', to: 'dig' }], opens: { dig: 'deeper' },
    loops: { deeper: { entry: 'd1', nodes: [node('d1'), node('d2', 'judge')], edges: [{ from: 'd1', to: 'd2' }, { from: 'd2', to: 'd1', revisit: true }] } } };
  const closed = layoutCanvas(graph);
  assert.deepEqual(closed.frames.map((f) => [f.kind, f.anchor, f.open]), [['loop', 'dig', false]]);
  assert.equal(closed.nodes.length, 2, 'a closed loop draws none of its nodes');
  const open = layoutCanvas(graph, { openLoop: { id: 'deeper', generation: 2 } });
  assert.equal(open.frames[0]!.open, true);
  assert.deepEqual(open.nodes.filter((n) => n.frame === 'deeper').map((n) => n.id), ['d1', 'd2']);
  assert.ok(open.height > closed.height);
});

test('accepted growth is a frame attached at its parent node with a dashed return edge', () => {
  const scene = layoutCanvas(linear, { growths: [{ proposalId: 'g1', parentNode: 'select', returnNode: 'analyze', graph: { entry: 'x1', nodes: [node('x1'), node('x2', 'judge')], edges: [{ from: 'x1', to: 'x2' }] } }] });
  const frame = scene.frames.find((f) => f.kind === 'growth')!;
  assert.equal(frame.anchor, 'select'); assert.equal(frame.open, true);
  assert.ok(scene.nodes.some((n) => n.id === 'x1' && n.frame === 'g1' && n.row > 0));
  assert.equal(scene.edges.find((e) => e.kind === 'return')?.to, 'analyze');
});

test('an applied revision marks changed nodes and hatches affected ones', () => {
  const scene = layoutCanvas(linear, { revisions: [{ changedNodes: ['analyze'], affectedNodes: ['analyze', 'check', 'select'] }] });
  assert.deepEqual(scene.nodes.map((n) => [n.id, n.revised]), [['prepare', undefined], ['analyze', 'changed'], ['check', 'affected'], ['select', 'affected']]);
});

test('a fifty-one node graph fits to width and hides labels below sixty percent', () => {
  const ids = Array.from({ length: 51 }, (_, i) => `n${i}`);
  const graph: LayoutGraph = { entry: 'n0', nodes: ids.map((id) => node(id)), edges: ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id })) };
  const scene = layoutCanvas(graph);
  assert.equal(scene.width, X0 + 51 * PITCH + 96);
  const fit = fitToWidth(scene, { width: 760, height: 618 });
  assert.ok(fit.scale < 0.6 && fit.scale > 0);
  assert.equal(labelsVisibleAt(fit.scale), false); assert.equal(labelsVisibleAt(0.6), true);
  assert.equal(fitToWidth(layoutCanvas(linear), { width: 760, height: 618 }).scale, 1);
});
```

- [ ] **Step 2: Run to verify failure** — add the file to `local` in `test/contract-groups.json`; `pnpm run build && pnpm run test:local --files test/contract/canvas-layout.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `canvas-layout.ts`** following rules 1–10; export from `index.ts`.
- [ ] **Step 4: `pnpm run build && pnpm run typecheck && pnpm run test:local --files test/contract/canvas-layout.test.ts`** → 8 pass.
- [ ] **Step 5: Commit** `feat(canvas): lay out the HimaFabric scene as a pure function` and push.

---

### Task 3: The Campaign file, Preparation overrides and starting from the file (Host)

**Files:**
- Create: `packages/harness/src/campaign-file.ts`
- Modify: `packages/harness/src/paths.ts` (`export const HIMA_CAMPAIGN_FILE_PATH = \`${HIMA_API_PREFIX}/campaign\`;`), `packages/harness/src/workbench.ts` (`PreparationView` gains `budget` and `goalDeclared`), `packages/harness/src/fabric.ts` (`campaignProposalFactsIdentity`, `newCampaignProposalId`, `sameCampaignProposalFacts` callers, `startRun` input overrides), `packages/harness/src/remote.ts` (routes + `RemoteOperations`), `packages/harness/src/index.ts` (`preparation(pack, site, overrides)`, ops wiring, exports), `packages/harness/src/tools.ts` (`hima_prepare` file argument; `hima_run` applies the file)
- Create: `test/contract/campaign-file.host.test.ts`; modify `test/contract-groups.json` (`local`)

**Interfaces:**

```ts
// campaign-file.ts
export const CAMPAIGN_FILE_RELATIVE = 'hima/campaign.yml';
export const CAMPAIGN_SCHEMA = 'hima-campaign/1';
export const campaignFileSchema = z.strictObject({
  schema: z.literal('hima-campaign/1'),
  name: z.string().trim().min(1).max(120).optional(),
  pack: z.strictObject({ id: z.string().min(1), version: z.string().min(1).optional() }).optional(),
  site: z.union([
    z.strictObject({ name: z.string().min(1) }),
    z.strictObject({ ssh: z.strictObject({ destination: z.string().min(1), jumps: z.array(z.string().min(1)).default([]) }),
      hints: z.strictObject({ workspaceRoot: z.string().optional(), allowedReadRoots: z.array(z.string()).default([]), allowedWriteRoots: z.array(z.string()).default([]), allowedWrappers: z.array(z.string()).default([]), toolCommands: z.array(z.string()).default([]) }).default({}) }),
  ]).optional(),
  inputs: z.record(z.string(), z.string()).default({}),
  goal: z.record(z.string(), z.number()).default({}),
  strategy: z.record(z.string(), z.union([z.number(), z.string().min(1)])).default({}),
  budget: z.strictObject({ timeBoxMinutes: z.number().positive().optional(), retries: z.number().int().nonnegative().optional(), generations: z.number().int().positive().optional() }).default({}),
  knowledge: z.array(z.string()).default([]),
  notes: z.string().default(''),
});
export type CampaignFile = z.infer<typeof campaignFileSchema>;
export function emptyCampaignFile(): CampaignFile;
export function parseCampaignFile(text: string): CampaignFile;           // throws Error with one sentence naming the field
export function serializeCampaignFile(file: CampaignFile): string;      // YAML, keys in schema order, a leading comment line "# HimaHarness Campaign — edited by the person and by HimaGuide"
export function readCampaignFile(workspace: string): { readonly file: CampaignFile; readonly text: string; readonly mtimeMs: number } | undefined;
export function writeCampaignFile(workspace: string, file: CampaignFile): { readonly text: string; readonly mtimeMs: number }; // mkdir -p hima/, atomic rename
export interface PreparationOverrides { readonly goal?: Readonly<Record<string, number>>; readonly strategy?: Readonly<Record<string, number | string>>; readonly inputs?: Readonly<Record<string, string>>; readonly budget?: CampaignFile['budget'] }
export const overridesOf = (file: CampaignFile): PreparationOverrides;
export const changedFields = (before: CampaignFile, after: CampaignFile): string[]; // dotted paths, e.g. ['goal.clock_period', 'inputs.design']

// workbench.ts — PreparationView additions
readonly goalDeclared: Readonly<Record<string, { label: string; unit?: string; min?: number; max?: number; precision?: number }>>;
readonly budget: { readonly timeBoxMinutes: { value: number; source: 'file' | 'pack' | 'harness' }; readonly retries: { value: number; source: 'file' | 'pack' | 'harness' }; readonly generations: { value: number; source: 'file' | 'pack' | 'harness' }; readonly jobCap?: number; readonly licences?: Readonly<Record<string, number>> };
readonly inputs: readonly { name; description; value?; ready; source?: 'file' | 'site' }[];   // extend the existing row

// remote.ts
export interface CampaignFileView { readonly exists: boolean; readonly file: CampaignFile; readonly text: string; readonly mtimeMs?: number; readonly preparation?: Pick<StartChoices, 'goal' | 'strategy' | 'words' | 'check' | 'preparation' | 'proposal'> }
RemoteOperations.sessionWorkspace?(sessionId: string): string | undefined;   // the session's cwd, as tools.ts resolves it (agent.session.header.cwd ?? agent.meta.cwd)
RemoteOperations.startPreparation(packId, siteName, overrides?: PreparationOverrides)
// Routes: GET  /hima/api/campaign?session=<id>  → CampaignFileView (404 hima/bad-request when the session is not live; exists:false with emptyCampaignFile() when no file)
//         PUT  /hima/api/campaign  body { sessionId, file }  → CampaignFileView after write (400 on schema error, message = the sentence)
//         POST /hima/api/runs/start body may carry { fromCampaignFile: true, sessionId } — the route reads the session's file, applies overridesOf(file) to preparation and to the start request (inputs, budget), and checks proposalId against that preparation.
// StartRunRequest (fabric.ts) gains `readonly inputs?: Readonly<Record<string, string>>` — merged over the Site's bindings in memory before checkPack/boundInputs; the Permit is untouched (every overridden path still passes decideRead).
```

Identity: `campaignProposalFactsIdentity(pack, site, overrides?)` includes `goal: overrides.goal ?? {}` (no defaults), `strategy: defaults merged with overrides`, `inputs` bound with the merged bindings, and `budget` overrides. `newCampaignProposalId(pack, site, overrides?)`; `proposalMatchesCurrentFacts(proposalId, pack, site, overrides)`. Readiness (`preparation()`): `ready = check.fit && siteReadiness === 'ready' && missingCommands.length === 0 && every declared goal parameter is present in overrides.goal and within its declared bounds`. A missing goal adds the unknown `Goal <label> is not set.` (label from `packWords`). **A goal is never filled from a default.**

Tools: `hima_prepare` gains `file?: boolean` (default true): when the Agent workspace has `hima/campaign.yml` whose `pack.id` equals `pack`, apply `overridesOf(file)`; `hima_run` applies the same file the same way when it exists (so the confirmation compares like with like). Both report `campaignFile: { path, applied: true|false }` in their JSON.

- [ ] **Step 1: Write the failing L2 test** (`test/contract/campaign-file.host.test.ts`; prior art `preparation.host.test.ts`, `start-form.test.ts`, `side-talk.host.test.ts`). Use `bootInProcess(h, { withWebApp: true })` + `createRootAgent(host.ctx, h.workspace)` for a session with a workspace (check `grep -n withWebApp test/contract/*.ts` for how the web app's URL is reached in-process; if no prior art reaches HTTP in-process, use `bootHimaHost` for the routes and drive `host.ctx.hima` in-process for the tools). Cases, each an independent expected value:
  1. `GET /hima/api/campaign?session=<id>` on a fresh workspace → `exists:false`, `file.schema === 'hima-campaign/1'`, `file.inputs` `{}`.
  2. `PUT` a file `{ schema, pack: { id: timingProbePackId }, site: { name: 'local' } }` (no goal) → `preparation.proposal.ready === false` and `unknowns` contains a sentence ending `is not set.` naming the goal label from the pack's words; `budget.timeBoxMinutes.source === 'pack'`.
  3. `PUT` with `goal: { target_period_ns: 2.3 }` → `ready === true`; the proposal id's facts part (first 64 hex) differs from case 2's.
  4. Write `hima/campaign.yml` on disk by hand (the HimaGuide path) with `inputs: { design: '/from/guide' }` → `GET` shows `mtimeMs` newer and `inputs` row `design` with `value '/from/guide'`, `source 'file'`.
  5. `POST /hima/api/runs/start` with `{ fromCampaignFile: true, sessionId, pack, site, proposalId }` → 200, `run.goal.target_period_ns === 2.3`; the Ledger's workspace record binds `design` to `/from/guide` (read `/hima/api/runs/<id>/records?type=workspace` or the in-process ledger).
  6. Editing `goal` in the file after confirming → a second start with the old `proposalId` → 400 (facts changed).
  7. `hima_prepare` via `host.ctx.tools.execute` as the agent whose cwd holds the file → JSON `campaignFile.applied === true` and `goal.target_period_ns === 2.3`; with `file: false` → `applied === false` and `ready === false`.
- [ ] **Step 2: Run to verify failure**: `pnpm run build && pnpm run test:local --files test/contract/campaign-file.host.test.ts` → FAIL (404 route).
- [ ] **Step 3: Implement** `campaign-file.ts`, the routes, overrides, identity, `StartRunRequest.inputs`, the tools. Keep `startPreparation(packId, siteName)` calls without overrides behaving exactly as before for the legacy page and `/start-options`.
- [ ] **Step 4: Run** the new file plus the neighbours that share the seam: `pnpm run test:local --files test/contract/campaign-file.host.test.ts test/contract/preparation.host.test.ts test/contract/start-form.test.ts test/contract/input-admission.host.test.ts test/contract/run-controls.test.ts` → all pass; `pnpm run typecheck`.
- [ ] **Step 5: Commit** `feat(host): the Campaign file is the unified configuration and prepares with overrides` and push.

---

### Task 4: Site discovery surface and the Job log tail (Host)

**Files:**
- Modify: `packages/harness/src/sites.ts` (`discoverSshSite(input, channelFor?)`), `packages/harness/src/remote.ts` (routes, ops), `packages/harness/src/index.ts` (ops wiring, stand-in), `packages/harness/src/tools.ts` (`hima_site`), `packages/harness/src/paths.ts` (`HIMA_SITES_PATH`, `siteDiscoverPath`, `runLogTailPath(runId)`)
- Create: `test/contract/site-surface.host.test.ts`; modify `test/contract-groups.json` (`local`)

**Interfaces:**

```ts
// sites.ts
export async function discoverSshSite(input: SiteDiscoveryRequest, channelFor: (name: string, ssh: SiteDiscoveryRequest['ssh']) => Channel = (n, s) => new SshChannel(n, s)): Promise<SiteDiscoveryResult>;
// remote.ts
export interface SiteHeadView { readonly name: string; readonly kind: 'local' | 'ssh'; readonly readiness: 'ready' | 'needs-discovery' | 'stale'; readonly capacity: { cores: number; memoryGiB: number; parallelJobs: number; licences: Readonly<Record<string, number>> }; readonly observedAt?: string }
export interface SiteDiscoverBody { readonly sessionId: string; readonly name: string; readonly ssh: { destination: string; jumps?: string[] }; readonly hints?: SiteDiscoveryRequest['hints']; readonly save?: boolean }
export interface LogTailView { readonly nodeId: string; readonly session?: string; readonly lines: readonly string[]; readonly at: string; readonly truncated: boolean }
RemoteOperations.sites?(): SiteHeadView[];
RemoteOperations.discoverSite?(request: Omit<SiteDiscoverBody, 'sessionId'>): Promise<{ result: SiteDiscoveryResult; saved?: SiteHeadView }>;
RemoteOperations.jobLogTail?(runId: string, nodeId: string, lines: number): Promise<LogTailView>;
// Routes: GET /hima/api/sites → { sites: SiteHeadView[] }
//         POST /hima/api/sites/discover (SiteDiscoverBody; sessionId must validate) → { result, saved? }; SSH failure → 503 hima/site-unreadable
//         GET /hima/api/runs/<id>/log-tail?node=<id>&lines=<n≤100, default 1> → LogTailView (the running execution's jobSession for that node; lines [] and session undefined when no Job is open)
// tools.ts: hima_site { action: 'list' | 'discover' | 'rediscover', name?, destination?, jumps?, hints?, save? } — discover/rediscover call the same operation; results are JSON like hima_prepare. Description states it creates no Run, workspace, Job or Ledger row and never stores credentials.
```

Stand-in: when `process.env.HIMA_TEST_DISCOVERY_STANDIN` names a JSON file `{ "<verb> <arg>": { "code": 0, "stdout": "…" } }`, the Host's `discoverSite` uses a `Channel` answering from that table instead of `SshChannel` (default unchanged). The variable is test-only, like `HIMA_TEST_SILENT_AGENT`; the no-SSH sentinel must still report `SSH subprocess attempts: 0`.

- [ ] **Step 1: Failing test** `site-surface.host.test.ts` (prior art `site-discovery.test.ts`, `node-jobs.host.test.ts` for a Run with an open Job through `localHome`): (1) `GET /hima/api/sites` on `localHome` → one `local` site, `readiness 'ready'`; (2) `POST /hima/api/sites/discover` with the stand-in env set and `save: true` → `saved.readiness === 'ready'`, a `lab-a.yml` and `lab-a.permit.yml` exist under the sites dir, and the stand-in stdout containing `password=never` is redacted in the file; a bad `sessionId` → 400; (3) `hima_site list` via `tools.execute` lists both sites; (4) start a Run on the stand-in flow, begin+work its first node as the owner, then `GET …/log-tail?node=<current>&lines=1` → `lines.length === 1` and `session` equals the execution's `jobSession`; before any Job → `lines: []`.
- [ ] **Step 2: Verify failure**, **Step 3: Implement**, **Step 4: Run** `--files test/contract/site-surface.host.test.ts test/contract/site-discovery.test.ts test/contract/node-jobs.host.test.ts` + typecheck + `pnpm run check:seams`.
- [ ] **Step 5: Commit** `feat(host): Site discovery gets a route and a tool; the running Job's log tail is readable` and push.

---

### Task 5: The Campaign tab — masthead, canvas, nodes, edges, frames, goal, attention

**Files:**
- Create: `packages/harness/src/client/scene.ts`, `CampaignTab.tsx`, `Masthead.tsx`, `FabricCanvas.tsx`, `FabricNode.tsx`
- Modify: `packages/harness/src/client/HimaWorkbench.tsx` (delete `RunSummary`, `CampaignGraph`, `JobActivity`, `EvidenceTrail` and the stacked Live sections; render `CampaignTab` for a selected Run; keep the run picker, `studio-new`, `studio-pack-owner`, `StartRunForm` and `PackOwnerPanel` until Tasks 7/8), `workbench-style.ts` (rules), `card-labels.ts` (add `nodeCaption`, `goalSaid`, `sealSaid` projections — pure; **do not add colour strings**)
- Modify: `test/contract/client-style.test.ts` (no change needed unless helpers move)

**Interfaces:**
- Consumes: `layoutCanvas`, `fitToWidth`, `labelsVisibleAt` (Task 2); `fetchRun`, `fetchExecutionContext`, `fetchStartChoices` (existing `api.ts`); `fetchLogTail(runId, nodeId, lines?, signal?)` — add to `api.ts` now over `runLogTailPath` (Task 4).
- Produces:
  - `scene.ts`: `export function sceneInputs(reference: PreparationView['referenceGraph'] | ExecutionContext['method']['reference'], view?: RunView, context?: ExecutionContext): { graph: LayoutGraph; facts: LayoutFacts }`. Captions from HimaFabric facts: act → `parameters.tool` name, else `workshop`, else the latest observed output name; judge → `${rules.length} rules`; explore → chooser name, `opens <loop>`, or `growth`; wait → `parameters.blocker`.
  - `card-labels.ts`: `export function goalSaid(goal: Record<string, number> | undefined, words: RunWords | undefined): string` (e.g. `clock period ≤ 2.30 ns` using the pack's `words`; raw names when no words); `export function sealSaid(status: RunStatus, endedBy: RunMeters['endedBy'] | undefined): { title: string; reason: string }` reusing `runStatusLabel`/`endedByLabel`.
  - `CampaignTab` props: `{ sessionId: string; runId: string; view: RunView | undefined; context: ExecutionContext | undefined; stale: boolean; readAt?: number; openOwner(id: string): void; openFiles(): void; refresh(): void }`.
  - Markers (exact): root `data-hima-region="campaign"` state `run`, `status`, `owner` (`owner|side-talk`); `campaign-masthead` state `status`, `current`, `generation`; view switch controls `studio-live|studio-generations|studio-evidence|studio-report`; `campaign-graph` state `nodes`, `current`, `scale` (two decimals), `stale`; each node `<g data-hima-region="campaign-node-<id>" data-hima-state-kind data-hima-state-state data-hima-state-current data-hima-control="node-<id>">`; `campaign-attention` state `kind` (`waiting|fence`) with control `open-owner`; `campaign-goal` state `status`; controls `canvas-locate`, `canvas-zoom-in`, `canvas-zoom-out`; `campaign-stale` banner region with state `at` when stale.

Behaviour:
- Masthead (66 px): Campaign name (`view.run.campaignId` until the file name arrives via Task 7's `name` — accept `name?: string`), status seal word (`runStatusLabel`), current node id, generation `gen N`, elapsed (ticks once per second only while `status === 'running'` and not stale and not reduced-motion), budget standing phrase from `meterRows`.
- View switch (36 px): Live, Generations, Evidence, Report. Generations = `GenerationsTable`; Evidence = `MaterialSection` + `ArchiveSection` + verdict/observation rows; Report = `ExperienceSection` (all existing components; restyle in Task 6).
- Canvas: one `<svg>` sized to the container; `viewBox` from the scene; `transform` group for zoom/pan. Fit to width on first scene; then follow the running node (keep it inside the viewport with a 300 ms eased translate unless reduced motion). Wheel zoom around the cursor (0.4–2.0), drag pan, pinch (ctrl+wheel). Labels `visibility: hidden` when `!labelsVisibleAt(scale)`; frame labels always shown.
- Node forms per kind: act rounded rect 36×36 r6; judge diamond; explore circle with a small chooser mark; wait octagon. State glyphs per spec (pending hollow; available hollow with accent stroke; running ringed dot with pulse + determinate bar under the node when `progress` known; waiting-for-slot hourglass, no pulse; retrying ring + curved arrow; blocked square + bar + badge; cancelled faded square + bar; done filled + check; reconciled ring with a dashed segment). Marks: revised `changed` = small accent tick at top-right, `affected` = hatch fill; `waitedForSlot` on a done node = tiny hourglass at bottom-right. Under the running node one line: the last log line from `fetchLogTail(runId, currentNode, 1)` polled every 2 s (mono, eyebrow size 12 px allowed since it is raw output; keep ≥12).
- Edges: hairline + arrowhead marker; outcome chips 13 px; the revisit arc dashed accent with the generation badge; branch rows labelled by branch id near the fork; loop chips/frames; growth dashed frames + dashed return edge. Lit edges use `--hima-good`; unlit `--hima-line-strong`. A newly lit edge animates `stroke-dashoffset` once (class `hima-edge-lit`), not on re-render (track lit ids in a ref).
- Goal roundel at `scene.goal`: dashed hollow with `goalSaid` while running/waiting; on `ended-*` the seal: filled, display 20 px word (`sealSaid.title`) and the reason line (`sealSaid.reason`, e.g. "ended: time box exhausted").
- Attention strip (32 px, full canvas width, above the svg): when `status === 'waiting'` — the latest blocker's full `reason` (never truncated; wraps to a second line if needed) and a link `open-owner` → `openOwner(control.owner)` (label "Open Campaign Agent"); when `context.budget.phase !== 'active'` or `context.reason` — the same strip in neutral with the fence reason. Only one strip; waiting wins.
- Stale: `stale === true` → `data-hima-state-stale="true"`, all animation classes off, banner `campaign-stale` "Showing the last read at HH:MM:SS; the Host could not be reached."
- Non-owner: masthead shows "Owned by Campaign Agent <short id>" + `open-owner`; no business controls here (Task 6 adds emergency controls to the card footer and the Diagnostics sheet).

- [ ] **Step 1: TDD at L1 for the projections**: add to `test/contract/view.test.ts`? No — add a small pure test file is not in the plan; instead extend `test/contract/canvas-layout.test.ts` with one `sceneInputs` case: from a `RunView`-shaped fixture with `nodes: [{nodeId:'a', state:'done'}, {nodeId:'b', state:'running'}]`, `run.currentNode 'b'`, `run.generation 2`, `context.available ['c']` → `facts.states {a:'done', b:'running'}`, `available ['c']`, `currentNode 'b'`, `generation 2`; and `goalSaid({ target_period_ns: 2.3 }, { goal: { target_period_ns: { label: 'clock period', unit: 'ns' } } } as never)` → `'clock period 2.3 ns'`. Run: fails (no module).
- [ ] **Step 2: Implement** the five files and the style rules; wire `CampaignTab` into `HimaWorkbench.tsx` for the Live view; remove the four stacked sections.
- [ ] **Step 3: Verify**: `pnpm run build && pnpm run typecheck && pnpm run test:local --files test/contract/canvas-layout.test.ts test/contract/client-style.test.ts`. Then the cheapest real window: `pnpm run test:desktop --files test/contract/campaign-graph.desktop.test.ts` — it waits on `campaign-graph` `data-hima-state-nodes>=48`; keep that state attribute. Report pass/skip honestly (Catsights must be online).
- [ ] **Step 4: Commit** `feat(ui): the Live view is the HimaFabric canvas` and push.

---

### Task 6: The node card, kind-specific tabs, owner controls, restyled views and compact tool receipts

**Files:**
- Create: `packages/harness/src/client/NodeCard.tsx`
- Modify: `packages/harness/src/client/FabricCanvas.tsx` (hover tooltip, click → card, Escape closes, one at a time, card clamped to the canvas), `HimaRunCard.tsx` (remove every `style={{…}}` and the `CSSProperties` constants; classes instead; the transcript receipt becomes two lines + "Open Campaign" link), `HimaWorkbench.tsx` (remove `JobActivity`), `workbench-style.ts`, `api.ts` (`fetchLogTail` already added), `card-labels.ts` (add `jobFolded(view, nodeId): { launched?: string; finished?: string; exit?: number; licences?: Record<string, number> }`, `absentSaid(what: string): string` → e.g. `No observation has been recorded for this node yet.`)
- Modify: `test/contract/client-style.test.ts` — add:

```ts
test('client components carry no inline styles', () => {
  for (const file of clientFiles()) assert.ok(!readFileSync(file, 'utf8').includes('style={{'), `${path.basename(file)} sets an inline style`);
});
```

**Interfaces:**
- `NodeCard` props: `{ node: PlacedNode; view: RunView; context?: ExecutionContext; runId: string; sessionId: string; owner: boolean; anchor: { x: number; y: number }; canvas: { width: number; height: number }; onClose(): void; openFiles(): void; acting: Acting }` (reuse `useRunActions` from `HimaRunCard.tsx` for `controlRun` with `nodeId`).
- Tabs by kind (exact labels): act → Facts, Job, Code, Knowledge, Evidence; judge → Rules, Verdicts, Evidence; explore → Decision, Strategy, Generations; wait → Blocker, Clearance. Default tab: the first. Facts: resolved inputs (from `context.method.contract.inputs` + workspace bindings) and the latest observation values with units (`view.observations` for the node, `words`). Job: `jobFolded`; on the running node a live log on dark glass polling `fetchLogTail(runId, nodeId, 40)` every 2 s (`.hima-activity`). Code: `view.code` rows for the node, each a button `open-code-<recordId>` → `openFiles()`. Knowledge: `view.knowledge` rows. Evidence: verdict rows citing this node's observations. Rules: the judge's rule ids in order (`context.nodes` judge parameters). Verdicts: `VerdictRow` for the node. Decision: `DecisionRow` when `view.decision` belongs to the node. Strategy: current `view.run.strategy` in words. Generations: `GenerationsTable` filtered to this loop. Blocker: the latest `BlockerView` for the node with `logTail` on dark glass. Clearance: `view.cancels`/resumed facts — who cleared it (`resumeRun` `who`). Every absent fact renders `absentSaid(...)` as one sentence; never an empty tab, never JSON.
- Footer (owner only): `node-pause` / `node-continue` (node-scoped via `controlRun(view, sessionId, action, node.id)`), each confirming with its consequence sentence in a `<details>`-free inline confirm (`node-pause-confirm`): "Jobs already running will continue; no new work starts at ‹node›." Non-owner: footer shows "Owned by Campaign Agent" and, under a `<details data-hima-region="emergency">` summary "Emergency", `run-pause` and `run-stop` (human-origin, `controlRun(..., 'pause')` / `actOnRun(runId, 'cancel')`) each with a confirm step; **no Continue**.
- Markers: `campaign-node-card` state `node`, `tab`; controls `node-card-tab-<facts|job|code|knowledge|evidence|rules|verdicts|decision|strategy|generations|blocker|clearance>`, `node-card-close`, `node-pause`, `node-continue`, `run-pause`, `run-stop`, `open-code-<recordId>`.
- Tool receipt (`HimaRunCard` when mounted in `tool.call.toolview`): line 1 `<tool name> · <run status word> · <current node>`, line 2 one sentence (the notice or the refusal message), a button `open-run` → `openRun(runId)`. Keep `data-hima-region="run-status"` and `run-error`, `run-refusal`, `run-cancel`, `resume`, `cancel` controls that existing tests read (`grep -n "run-status\|run-refusal\|run-cancel\|'resume'\|'cancel'" test/contract/*.ts`); the sections those tests read (`run-workshop`, `run-meters`, `run-decision`, `run-nodes`, `run-loops`, `run-branches`, `run-generations`, `run-experience`, `run-material`, `run-observation`, `run-blocker-tail`, `workspace-record`) stay available under a `<details data-hima-control="receipt-details">` opened by default in tests via `d.click`… — simpler: keep them rendered but collapsed under `<details open>` so existing `d.read` calls still find them.

- [ ] **Step 1: Failing tests**: the inline-style contract test above (fails on `HimaRunCard.tsx`); add L1 cases to `canvas-layout.test.ts` for `jobFolded` (launched/finished pair from a `jobs` fixture) and `absentSaid('observation')`.
- [ ] **Step 2: Implement** the card, restyle `HimaRunCard.tsx`, compact receipt.
- [ ] **Step 3: Verify** `pnpm run build && pnpm run typecheck && pnpm run test:local --files test/contract/client-style.test.ts test/contract/canvas-layout.test.ts test/contract/view.test.ts test/contract/view-run.test.ts test/contract/run-controls.test.ts`; then `pnpm run test:desktop --files test/contract/agent-execution.desktop.test.ts` (reads the receipt markers) — report pass/skip.
- [ ] **Step 4: Commit** `feat(ui): node cards anchored to the canvas; tool receipts compact; no inline styles` and push.

---

### Task 7: The Configuration page

**Files:**
- Create: `packages/harness/src/client/ConfigurationPage.tsx`, `packages/harness/src/client/PackOwnerPanel.tsx` (move the existing `PackOwnerPanel` verbatim, then restyle with classes)
- Modify: `packages/harness/src/client/api.ts` (`fetchCampaignFile(sessionId)`, `saveCampaignFile(sessionId, file)`, `fetchSites()`, `discoverSite(body)`, `startCampaign` already exists — pass `{ fromCampaignFile: true, sessionId, pack, site, proposalId }`), `HimaWorkbench.tsx` (delete `StartRunForm`, `studio-new`, the run `<select>`'s "new" path; when the session owns no Run and none is selected → `ConfigurationPage`; when a Run is selected → `CampaignTab`; a run picker remains as a plain `<select data-hima-control="studio-run">` in the masthead corner for non-owner browsing), `workbench-style.ts`
- Modify desktop tests that filled the old form (`test/contract/unified-workbench.test.ts` `fillStart`, `campaign-graph.desktop.test.ts`, `growth-assets.desktop.test.ts`, `revision-assets.desktop.test.ts`, `agent-execution.desktop.test.ts`, `pack-owner.desktop.test.ts`): replace `studio-new` + `studio-pack`/`studio-site`/`studio-target`/`studio-knob-*`/`studio-timeBox`/`studio-retries`/`studio-generations`/`studio-start` with the Configuration controls below; put a shared `fillConfiguration(d, browser, { pack, site, goal, knobs?, budget? })` helper in `test/contract/support/driver.ts` next to `fillForm`.

**Interfaces:**
- `ConfigurationPage` props: `{ sessionId: string; askGuide(text: string): void; pickFolder?: () => Promise<string | null>; onStarted(view: RunView): void; openPackOwner?: () => void }`.
- Polling: `fetchCampaignFile` every 3 s; when `mtimeMs` advances and the text differs from the last text the person saw, compute `changedFields(before, after)` and mark those fields (`data-hima-state-changed="true"`, class `hima-changed`, eyebrow "HimaGuide · new") until the person focuses them. The person's edits save on blur/Enter through `saveCampaignFile`; a save conflict (file changed since read) re-reads and marks.
- Sections in this order, each `data-hima-region="config-<name>"`: `name` (control `config-name`); `pack` (select `config-pack` over `start-options.packs` with marks/unchoosable; shows title, id, version, author status from `proposal.pack`; mini reference graph = `layoutCanvas(referenceGraph)` rendered at 50 px tall hollow; empty → buttons `config-install-pack` (native folder picker via `pickFolder` when provided, else opens the Pack owner panel) and `config-ask-pack` → `askGuide('What is a HimaPack and which one should I install for …?')`); `site` (select `config-site`; readiness + capacity from `proposal.site`/`fetchSites`; `needs-discovery|stale` → `config-discover` → `askGuide('Discover the Site ‹name› with hima_site and tell me what you find.')`; no site → SSH destination field `config-site-ssh`, hints textarea `config-site-hints`, and `config-discover`); `inputs` (one row per `proposal.inputs`: description, value, state `bound by HimaGuide · new | bound by Site | unbound`, control `config-input-<name>`; unbound → `config-ask-<name>` → `askGuide('Bind the input ‹name›: ‹description›.')`); `goal` (one field per `goalDeclared` with label, unit, range, precision; control `config-goal-<name>`; never prefilled); `strategy` (one field per knob: number or `<select>` for choices; empty = Pack default; control `config-knob-<name>`); `budget` (`config-budget-timeBoxMinutes|retries|generations` each with its `source` word; job cap and licence seats read-only from `proposal.budget.jobCap`/`licences`); `knowledge` (list `file.knowledge`, add via `config-knowledge-add` → `pickFolder` when provided else a path field; count from `proposal.knowledge.currentDocuments`); `readiness` (`data-hima-state-ready`, `unknowns` as sentences each with `config-ask-unknown-<i>` → `askGuide(sentence)`; one button `config-confirm` disabled unless `proposal.ready`; label "Confirm and start Campaign"; on success → `onStarted(view)`).
- Root: `data-hima-region="configuration"` state `ready`, `pack`, `site`, `changed` (count).
- After confirming, `HimaWorkbench` selects the new Run and renders `CampaignTab` in place (no view switch); the canvas's first scene is the same reference graph the mini graph showed.

- [ ] **Step 1: Failing test**: extend `campaign-file.host.test.ts`? No — the page is L3. Write the driver helper and update `unified-workbench.test.ts`'s second test (`conversation draft, native files and verified reports share one workspace with a real Run`) to use `fillConfiguration`, then run it: `pnpm run test:desktop --files test/contract/unified-workbench.test.ts` → FAIL (controls missing).
- [ ] **Step 2: Implement** the page, the fetchers, the routing in `HimaWorkbench.tsx`; delete `StartRunForm`; update the listed desktop tests.
- [ ] **Step 3: Verify** `pnpm run build && pnpm run typecheck && pnpm run test:local --files test/contract/client-style.test.ts test/contract/campaign-file.host.test.ts`; `pnpm run test:desktop --files test/contract/unified-workbench.test.ts test/contract/campaign-graph.desktop.test.ts test/contract/pack-owner.desktop.test.ts` — report pass/skip.
- [ ] **Step 4: Commit** `feat(ui): the Configuration page renders the Campaign file` and push.

---

### Task 8: Shell integration — Campaign chip, tab title, Diagnostics sheet, settings section, HimaGuide drafts

**Files:**
- Create: `packages/harness/src/client/owned-run.ts`, `SettingsSection.tsx`, `Diagnostics.tsx`, `CampaignChip.tsx`
- Modify: `packages/harness/src/client/index.ts` (widen `Registration`; register `conversation.session.header.actions`, `sidebar.right.pane.tab.title`, `sidebar.right.tab.menu.item`, `settings.section`; a `draftToComposer` helper; `inject` gains `'uiWorkspace'` for the native folder picker if the service is optional — check `ctx.uiWorkspace` at runtime and pass `pickFolder` only when present), `HimaWorkbench.tsx` (accept `askGuide`, `pickFolder`), `workbench-style.ts`
- Modify: `test/contract/campaign-workspace.desktop.test.ts` is Task 9; this task adds no new test file but must keep `pnpm run test:desktop --files test/contract/unified-workbench.test.ts` passing.

**Interfaces:**
- `useOwnedRun(sessionId: string): { run?: RunHeadView; readAt?: number; error?: string }` — polls `fetchRuns` every 5 s; picks the newest Run whose `control.owner === sessionId` and whose status is `running` or `waiting`, else the newest ended one owned by the session within the last hour, else none.
- `CampaignChip` (registered on `conversation.session.header.actions`, list slot, scope session — read how the shell's jobs plugin registers there: `grep -o 'conversation.session.header.actions[^}]*' node_modules/.pnpm/@deepseek-ai+dsh-client-ui-jobs*/node_modules/@deepseek-ai/dsh-client-ui-jobs/lib/client.js`): renders nothing when `useOwnedRun` finds none (Side Talk), else a chip `data-hima-region="campaign-chip"` state `status`, `current`, `waiting` with the state glyph, status word, current node; click → `openRun(run.id)`; `waiting` adds a badge.
- Tab title (`sidebar.right.pane.tab.title`, key `WORKBENCH_ID`): `Campaign · ‹current›` with the running glyph while running; `Campaign · configure` when the session owns no Run; `Campaign · waiting` badge when waiting. Read `useTabInfo` from the slot hook context (the shell passes `title: true`).
- Tab menu item (`sidebar.right.tab.menu.item`): "Diagnostics" (`data-hima-control="open-diagnostics"`) → opens `Diagnostics` as a sheet inside the tab body (`data-hima-region="campaign-diagnostics"`): Run id, owner session, epoch, revision, meters (`meterRows`), last Ledger read time, the exact shell line of the current Job if any, and for non-owners the emergency Pause/Stop (same handlers as Task 6). Escape or `diagnostics-close` closes it. The Diagnostics open state lives in `HimaWorkbench` (menu item calls an injected `openDiagnostics()` that sets a store flag; simplest: a module-level `EventTarget` in `owned-run.ts`: `export const campaignEvents = new EventTarget();` and the tab body listens for `'diagnostics'`).
- Settings section (`settings.section`, `id: 'hima'`, `order: 40`, `label: () => 'HimaHarness'`): `SettingsSection` with `data-hima-region="hima-settings"`: Packs (from `fetchStartChoices()` `packs`/`marks`/`cannotStart`; `PackOwnerPanel` with `pickFolder` for `owner-location` when available — keep the `owner-*` controls the pack-owner test uses); Sites (`fetchSites()` rows with readiness; `site-rediscover-<name>` → `discoverSite({ …saved ssh…, save: true })`; no credentials ever displayed); current knowledge count line.
- `draftToComposer(text)`: the session-scoped slot components receive the shell's `inputActions` prop when the `uiSession` provider lists it (`props: ["inputActions"]`); verify by logging the props of `HimaWorkbench` once in the browser (`test:desktop` run with `inspectWindow`), then implement `askGuide = (text) => inputActions.setDraft(text)`. If the prop is not delivered to this slot, fall back to `document.querySelector('[contenteditable="true"]')?.focus(); document.execCommand('insertText', false, text)`. Never call `submit`.

- [ ] **Step 1: Failing test**: add to `test/contract/unified-workbench.test.ts` first test a wait on `[data-hima-region="campaign-chip"]` existing in the owner session after the Run starts and *not* existing in the Side Talk session (in `campaign-graph.desktop.test.ts` where the Side Talk is opened); run → FAIL.
- [ ] **Step 2: Implement.** **Step 3: Verify** `pnpm run build && pnpm run typecheck && pnpm run check:seams && pnpm run test:local --files test/contract/client-style.test.ts && pnpm run test:desktop --files test/contract/unified-workbench.test.ts test/contract/campaign-graph.desktop.test.ts`.
- [ ] **Step 4: Commit** `feat(ui): Campaign identity in the session header, tab title, tab menu and settings` and push.

---

### Task 9: L3 acceptance — seven states, both themes, screenshots on Catsights

**Files:**
- Create: `test/contract/campaign-workspace.desktop.test.ts`; modify `test/contract-groups.json` (`desktop`)
- Create (artefacts, committed): `docs/assessment/2026-09-15/campaign-workspace/README.md` + `<state>-<theme>.png` for the states that rendered.

**Interfaces:** consumes every marker named in Tasks 5–8.

States (window 1280 × 800, dock pane at 760 px: set the split through the shell's layout store — find how `display-placement.desktop.test.ts` or `desktop.test.ts` size panes; if no seam exists, assert the pane is ≥ 600 px and note it): (1) Configuration page empty (no Pack, no Site) — `config-pack` shows `config-install-pack` and `config-ask-pack`; (2) Configuration page ready — after `fillConfiguration`, `configuration` state `ready=true`; (3) running with a node card open — start, wait for `campaign-graph` `current`, click `node-<current>`, `campaign-node-card` state `node`; (4) waiting with the attention strip — a stand-in flow that blocks (`localHome(t, { blocked: true })` or whichever option `support/standin-flow.ts` offers; check `grep -n "waiting\|blocked" test/contract/support/standin-flow.ts`) → `campaign-attention` `kind=waiting`, strip text equals the blocker `reason` from `/hima/api/runs/<id>`; (5) ended with the Goal seal — `localHome` default meets the goal → `campaign-goal` `status=ended-goal-met` and the seal text contains `runStatusLabel['ended-goal-met'].said`; (6) Side Talk non-owner — open a second session (as `campaign-graph.desktop.test.ts` does), open the Campaign tab, assert no `campaign-chip`, `campaign` state `owner=side-talk`, `open-owner` present, no `node-continue`; (7) fifty-one node graph fitted — install the `custom-cell-fmax-dtco` pack (48+ nodes, as `campaign-graph.desktop.test.ts` does) → `campaign-graph` `scale < 0.6` and labels hidden (`getComputedStyle` visibility). Each state captured light and dark via two `bootDriver` runs (`theme: 'light' | 'dark'`) with `HIMA_UI_ARTIFACTS` set to the assessment directory; screenshots are the acceptance artefacts.

- [ ] **Step 1: Write the test** (skeleton from `unified-workbench.test.ts`: `bootDriver`, `inspectWindow`, `prepareSession`, `capture`, `finish`). **Step 2: Run** `HIMA_UI_ARTIFACTS=docs/assessment/2026-09-15/campaign-workspace pnpm run test:desktop --files test/contract/campaign-workspace.desktop.test.ts` — Catsights must be online; otherwise the test skips and the report says so. **Step 3:** Write the README listing each state, pass/fail/skip, the source SHA and the command. **Step 4: Commit** `test(desktop): seven Campaign workspace acceptance states in both themes` and push.

---

## Self-review notes

- Spec coverage: stories 1–35 → Tasks 2, 5, 6; 36–47 → Task 8 (chip, title, menu, reload keeps Run via `useOwnedRun`), 43/44 → Task 6 confirm sentences; 48–49 → Task 5 views; 50–71 → Tasks 3, 7; 72–75 → Task 8 settings; 76–81 → Task 1; 82 → Task 2; 83 → every task's markers; 84 → Task 3 tests; 85 → Task 1 test; 86 → file ownership table; 87 → Task 9.
- Deviation recorded for the user: the spec's "Desktop shell" row asks for an IPC message for the Campaign tab shortcut and native pickers exposed to the client. `packages/desktop/src/main.ts` deliberately gives the renderer **no preload bridge and no IPC** (its `webPreferences` comment), and the shell already exposes a native folder picker through `ctx.uiWorkspace.pickDirectory()` (used by Task 8). The plan therefore keeps the `CmdOrCtrl+2` accelerator on the stable `open-workbench` control and uses the shell's picker; no desktop-shell task. If the user wants the IPC route, it is a separate decision against the desktop fence.
- Names used consistently: `HIMA_STYLE`, `Glyph`, `layoutCanvas`, `fitToWidth`, `labelsVisibleAt`, `sceneInputs`, `CampaignTab`, `FabricCanvas`, `FabricNode`, `NodeCard`, `ConfigurationPage`, `PackOwnerPanel`, `SettingsSection`, `useOwnedRun`, `campaignFileSchema`, `overridesOf`, `changedFields`, `fetchCampaignFile`, `saveCampaignFile`, `fetchSites`, `discoverSite`, `fetchLogTail`, `runLogTailPath`, `HIMA_CAMPAIGN_FILE_PATH`, `goalSaid`, `sealSaid`, `jobFolded`, `absentSaid`.
