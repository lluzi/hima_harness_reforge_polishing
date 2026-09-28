# Issue 63: the ATCS Live graph draws in lanes

Reported during the Issue 63 ATCS acceptance (App 0.3.0-trial.33): Campaign tab → Campaign → Live
drew the `agentic-timing-closure-system` reference graph (106 nodes, 143 edges) as one horizontal
line with the labels piled on top of each other.

## Root cause

`canvas-layout.ts:computeRow` put every node on row 0 unless it was a hung FAIL/UNDETERMINED target
or an auto-detected fork branch. Rule 1 ranks are longest-path; ATCS has many nodes sharing a rank,
and several chains that the entry never reaches through a forward edge (`diagnose…` is entered only
by revisit edges, `research-worker-02…` by team dispatch, `apr-prepare` by a revisit), so they were
parked at rank 0.5 beside the entry. Result on the base build (75b98acb): 12 node pairs on identical
pixels, and long FAIL edges drawn as straight lines through the spine. The renderer also truncated
labels to 12 characters at an assumed 6.5 px each, which really drew about 90 px, wider than
the 90-unit pitch.

## Change (existing module, same seam)

The Live canvas still calls `sceneInputs` + `layoutCanvas` on `method.reference` with the `RunView`
overlay. Nothing else computes a position, and there is no new dependency or second graph model.

- `computeRank`: an unanchored chain (not reachable from the entry by forward edges) is pulled
  as late as its successors allow. Anchored nodes keep rule 1's rank exactly.
- `computeRow`: lane allocation. Nodes are placed by rank and declaration order. Each node takes
  the first row, going down from its inherited lane, where its glyph plus two label lines meets no
  node already placed. A hung node keeps its source's home lane. A fork branch gets one full lane
  (was 0.6 row, which overlapped labels).
- `routeEdges`: a forward edge whose own line would cross another node's glyph or label, or climb
  steeper than it runs, is redrawn orthogonally. Its vertical runs sit 20.5 units from the column
  centre: it leaves on the right of the source's column and enters on the left of the target's, so
  an edge leaving rank r and one entering rank r + 0.5 stay apart. Its horizontal run takes the free
  track that costs least, where crossing any label, the edge's own source and target included, costs
  heavily. An edge that is already clear keeps its original path.
- `revisitLevels`: revisit arcs nest by span above the top lane. The lanes move down only when
  more than one nesting level exists.
- `placeChips`: an outcome chip takes the first spot on or near its own path that meets no other
  chip, glyph or label. When no spot is free it falls back to rule 4's place. That happens once
  across the shipped Packs (`library-intelligence`, `qualification-gate -> blocked`), which the base
  build also overlapped.
- `FabricNode`: the label budget is 11 characters (7 px each). The full id and caption stay in the
  hover `<title>`.
- `ConfigurationPage` mini graph: its band reaches the scene top when arcs nest.

Pack files and Runtime semantics are unchanged. The L3 state copies the shipped Pack to a temporary
local variant. Only Site-facing wrappers change; `graph.yml` is byte-identical.

## Evidence

Build: Node 24.20.0, `pnpm run build` from this branch's source. Desktop runs used the Catsights
display (1920×1200, online), one Electron suite at a time, in the foreground.

| Check | Base 75b98acb | This branch |
| --- | --- | --- |
| L1 `canvas-layout.test.ts` (39 cases): ATCS footprints disjoint, worker lanes parallel, arcs nest, chips clear; every shipped Pack: footprints disjoint and no forward edge through a glyph | RED before the change: 5 new cases fail (ATCS overlap, worker lanes, ATCS and custom-cell edge through a glyph, arc nesting); the chip case was written later and failed against the intermediate build | 39/39 pass |
| L3 state 8, both themes: glyph / label overlaps on screen across all 106 nodes, opening scale | 13 / 80 overlaps at 0.6 | 0 / 0 at 0.6, 4 lanes |
| L3 states 1–7 (`campaign-workspace.desktop.test.ts`) | 1L and 3D time out at session bootstrap | Final run: 7/8 pass; 6L times out at "conversation is ready". Over five runs of this file, each of states 1–4 and 6 both passed and timed out at a session-bootstrap wait (`open-workbench` enabled / "conversation is ready"), before any Hima assertion. States 5, 7 and 8 passed every time |
| `campaign-graph.desktop.test.ts` | fails 2/2 at line 162 (`campaign-graph` read before it mounts) | Same line-162 failure. It passes the earlier `pnr-foundry` label check once the budget is 11 characters |
| `check:boundary`, `check:seams`, harness `tsc` build | pass | pass |
| Full `test:local` (691 cases, 0 Electron, 0 SSH) | `pack.test.ts:199` fails (expects Harness 0.1.0, package is 0.1.2) | 690/691; the same `pack.test.ts:199` failure. `lib/` was rebuilt partway through this run for the review fixes; the only layout-dependent file, `canvas-layout.test.ts`, was rerun afterwards: 39/39 |
| root `typecheck` | 16 errors in untouched files (`channel.ts`, `errors.ts`, `trial-package.test.ts`, …) | same 16; none in changed files |

Screenshots (1280×800 window, dock pane widened to 765 px):

- `before/atcs-graph-open-{light,dark}.png`: the base build at its 0.6 opening scale, one row of
  overlapping glyphs and labels.
- `after/atcs-graph-open-{light,dark}.png`: this branch. The input/baseline lane, the diagnose→plan
  lane and the worker lane each sit on their own row; the long FAIL routes run on tracks.
- `before|after/atcs-graph-fit-{light,dark}.png`: `canvas-fit` overview. The graph is still about
  70 ranks long (6460 units), so the fitted overview is a thin outline with labels hidden, as
  rule 10 intends. It is read at the opening scale with pan and zoom.

## Independent review

One Opus 5.5 (high) review of the diff found no correctness defect in the rank, lane or arc logic.
It confirmed that forward edges keep strictly increasing rank in every shipped Pack, that output is
deterministic, and that ATCS lays out in about 14 ms. Fixed after the review:

- Unrelated routes shared a vertical line; there are now 0 in ATCS, custom-cell and aes.
- An open loop counted the arc headroom twice.
- The router did not count the edge's own labels; label crossings in ATCS went from 47 to 40.
- Two overstated claims (this note and one code comment).

## Not covered

- The fitted overview does not get narrower: the longest forward path is inherently about 70 ranks.
  Wrapping or a top-to-bottom mode would be a separate product decision.
- The canvas opens centred on the current node, which leaves the left half empty at the entry.
  That is existing follow behaviour and is unchanged.
- Revisit arcs from a lower lane rise through the lanes above. The arcs are dashed and nested but
  are not routed around nodes: in ATCS they pass over 14 glyphs.
- Routed edges still cross 40 labels in ATCS: 33 are the edge's own source or target label, where a
  track below has to pass it; 7 are other nodes' labels, in the tight `route-*` FAIL staircase.
  The tests check glyphs, not labels, for edges.
- Existing, not addressed: an open loop frame can cover main-graph lanes (6 nodes in `aes-tsmc28-dtco`
  with `probe-loop` open; the base build had 7), because lanes ignore frames. The third label line
  ("awaiting Agent", a log tail) is not included in the layout's footprint.
- Small-graph changes no test pins: a revisit badge with no room above its arc sits on the arc apex
  (y 12, was 20). An outcome chip whose rule 4 place overlaps its source glyph moves up. In a fork
  with 3 or more branches, the outer branch edges draw as orthogonal steps.
- No real model or Site was used (L4/L5 not run). The L3 Run is owned under replay and never
  begins a node.
