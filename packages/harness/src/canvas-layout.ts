// Turns a HimaFabric reference graph (`packGraph`, plus a loop's or a growth's own subgraph) and the
// execution facts a Run has accumulated into a positioned SVG scene: where every node, edge, frame
// and the Goal roundel sit, in the pixel units the mockup fixed (node pitch 90, branch row 96, node
// diameter 36). It is a pure function — same graph and facts in, same scene out — so fork, loop,
// growth and revision layouts are testable without a window, a renderer, or the client bundle this
// module is also compiled into. No DOM, no Node built-ins, no import from another Hima module: this
// file is the seam between the reference graph's shape and the two things that draw it, `test/contract/
// canvas-layout.test.ts` and the client canvas a later task adds.
//
// The ten layout rules below (numbered as the plan's task brief numbers them) are the only source of
// truth for a coordinate; nothing here special-cases a Pack, a node id, or an outcome word beyond the
// vocabulary CONTEXT.md already fixes (`PASS`, `FAIL`, `UNDETERMINED`, the revisit edge, a loop's
// `opens`, a growth's `parentNode`/`returnNode`, a revision's `changedNodes`/`affectedNodes`).

/** HimaFabric's four node kinds (CONTEXT.md; `packGraph`'s own `PackNode.kind`). */
export type NodeKind = 'act' | 'judge' | 'explore' | 'wait';

/** Every state the Ledger's own node transitions can leave a node in, plus `pending` for a node the
 * Ledger has not touched yet and `available` for one `ExecutionContext.available` already names. */
export type NodeVisualState =
  | 'pending' | 'available' | 'running' | 'waiting-for-slot' | 'retrying' | 'blocked' | 'cancelled' | 'done' | 'reconciled';

/** One node of a reference graph or a loop's/growth's own subgraph, stripped to what layout needs. */
export interface LayoutNode { readonly id: string; readonly kind: NodeKind; readonly caption?: string }

/** One edge. `revisit: true` marks the one edge kind rank (rule 1) is computed without; `outcome`
 * carries the Judge word (`PASS` | `FAIL` | `UNDETERMINED`, or a Pack's own converged/generation-limit
 * word) that a chip renders. */
export interface LayoutEdge { readonly from: string; readonly to: string; readonly outcome?: string; readonly revisit?: true }

/** A self-contained graph: a loop body or a growth's proposed graph, laid out by the same rules 1–2
 * as the top-level reference graph, then hung under the node that owns it (rules 6–7). */
export interface LayoutSubgraph { readonly entry: string; readonly nodes: readonly LayoutNode[]; readonly edges: readonly LayoutEdge[] }

/** The reference graph itself: a `LayoutSubgraph` plus every loop an explore node can drill into
 * (`loops`, keyed by loop name) and which explore node opens which loop (`opens`, explore id → loop
 * name), mirroring `packGraph`'s own `loops` and a node's `parameters.opens`. */
export interface LayoutGraph extends LayoutSubgraph {
  readonly loops?: Readonly<Record<string, LayoutSubgraph>>;
  readonly opens?: Readonly<Record<string, string>>;
}

/** Everything the execution trace can add on top of the reference graph's fixed shape: the Ledger's
 * per-node state, `ExecutionContext.available`, the run row's current node and generation, a fork's
 * branches, an open loop, accepted growths and applied revisions. All optional — `layoutCanvas(graph)`
 * alone must still produce a scene, one where every node is `pending` and sits on the one spine. */
export interface LayoutFacts {
  readonly states?: Readonly<Record<string, NodeVisualState>>;
  readonly available?: readonly string[];
  readonly currentNode?: string;
  readonly generation?: number;
  readonly progress?: Readonly<Record<string, number>>;
  readonly waitedForSlot?: readonly string[];
  readonly openLoop?: { readonly id: string; readonly generation: number };
  readonly fork?: { readonly node: string; readonly join: string; readonly branches: readonly { readonly id: string; readonly nodes: readonly string[] }[] };
  readonly growths?: readonly { readonly proposalId: string; readonly parentNode: string; readonly returnNode: string; readonly graph: LayoutSubgraph }[];
  readonly revisions?: readonly { readonly changedNodes: readonly string[]; readonly affectedNodes: readonly string[] }[];
}

/** One node, positioned. `rank`/`row` are the layout coordinates rules 1–2 compute (rank can be
 * fractional for a hung wait node or a fork branch member); `x`/`y` are the pixel position they imply.
 * `frame` names the loop or growth (its id — the loop name, or the growth's `proposalId`) a node was
 * laid out inside, absent for a node on the main spine. */
export interface PlacedNode {
  readonly id: string; readonly kind: NodeKind; readonly x: number; readonly y: number;
  readonly rank: number; readonly row: number; readonly state: NodeVisualState;
  readonly caption?: string; readonly current: boolean; readonly progress?: number;
  readonly waitedForSlot: boolean; readonly revised?: 'changed' | 'affected'; readonly frame?: string;
}

/** One edge, positioned. `path` is a ready-to-render SVG path `d` string; `chip` is an outcome word
 * (or, for the FAIL/UNDETERMINED-to-a-hung-node case, the same word placed under the target); `badge`
 * is the revisit arc's generation count. `kind: 'return'` is a growth's dashed edge back to its
 * `returnNode` — the dashing itself is the renderer's job (rule 4), not this module's. */
export interface PlacedEdge {
  readonly from: string; readonly to: string; readonly kind: 'dependency' | 'outcome' | 'revisit' | 'return';
  readonly outcome?: string; readonly lit: boolean; readonly path: string;
  readonly chip?: { readonly x: number; readonly y: number; readonly text: string };
  readonly badge?: { readonly x: number; readonly y: number; readonly count: number };
}

/** A loop (collapsed or open) or a growth (always open), as a box on the canvas. `anchor` is the node
 * it hangs from (the explore node for a loop, `parentNode` for a growth); `id` is the same string a
 * `PlacedNode.frame` inside it carries (the loop name, or the growth's `proposalId`). */
export interface Frame {
  readonly id: string; readonly kind: 'loop' | 'growth'; readonly label: string; readonly anchor: string;
  readonly open: boolean; readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}

/** The whole scene: everything an SVG canvas needs to draw one Run's HimaFabric, and nothing it would
 * have to compute itself. */
export interface CanvasScene {
  readonly width: number; readonly height: number; readonly nodes: readonly PlacedNode[];
  readonly edges: readonly PlacedEdge[]; readonly frames: readonly Frame[]; readonly goal: { readonly x: number; readonly y: number };
}

/** The mockup's fixed pixel units (`docs/specs/campaign-workspace-ui/mockup/hima-campaign-mockup.html`):
 * the horizontal distance between two ranks, the vertical distance between two rows, a node's
 * diameter, the left margin before rank 0, and the top margin above row 0. */
export const PITCH = 90, ROW = 96, NODE = 36, X0 = 64, PAD_Y = 72;

// ---------------------------------------------------------------------------------------------------
// Rule 1 (rank) and rule 2 (row), shared by the top-level reference graph and every loop's or growth's
// own subgraph — "laid out by the same rules" (rules 6–7) means this pair of functions, run again on
// the nested subgraph's own nodes and edges.

/** A node that hangs one row down at a half rank (rule 2) — two cases, both places a node the main
 * spine's own Kahn walk would otherwise never reach in a sensible place:
 *
 * - whose only (non-revisit) incoming edges are all outcome `FAIL` or `UNDETERMINED`; or
 * - that has *no* non-revisit incoming edge at all, and is not the entry — a node HimaFabric reaches
 *   only through its own dynamic routing (a Hard blocker's `wait` node, routed to by the engine
 *   itself rather than a static edge a pack author drew) and never through a graph edge. Without this
 *   case such a node has no predecessor at all, so the ordinary Kahn pass (rule 1) gives it rank 0 —
 *   the entry node's own rank — and the two land on the same pixels.
 *
 * `entry` is excluded explicitly (rather than by the vacuous truth of `every` on an empty incoming
 * list, which the first case alone used to rely on): the entry has no incoming edge either, and is
 * never hung.
 */
function hangNodeIds(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], entry: string): Set<string> {
  const incomingByTarget = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    if (edge.revisit) continue;
    const list = incomingByTarget.get(edge.to) ?? [];
    list.push(edge);
    incomingByTarget.set(edge.to, list);
  }
  const hang = new Set<string>();
  for (const node of nodes) {
    if (node.id === entry) continue;
    const incoming = incomingByTarget.get(node.id) ?? [];
    if (incoming.length === 0 || incoming.every((edge) => edge.outcome === 'FAIL' || edge.outcome === 'UNDETERMINED')) hang.add(node.id);
  }
  return hang;
}

/** Rule 1: `rank(entry) = 0`; every other (non-hung) node is `1 + max(rank of predecessors)` over
 * non-revisit edges, by Kahn order (ties by declaration order, which is what seeds and grows the
 * ready queue below). A hung node (rule 2) takes a half step instead of a full one — `rank(source) +
 * 0.5` over its own FAIL/UNDETERMINED incoming edges — but it is a full member of this same Kahn pass:
 * it still counts as a predecessor for whatever comes after it, so its fractional rank propagates to
 * its own successors exactly like any other node's integer rank does (finding 1). Only `computeRow`
 * treats a hung node specially by excluding it from the row-0 spine — this pass never excludes it. */
function computeRank(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], hang: ReadonlySet<string>): Map<string, number> {
  const ids = nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const relevant = edges.filter((edge) => !edge.revisit && idSet.has(edge.from) && idSet.has(edge.to));
  const predecessors = new Map<string, string[]>(ids.map((id) => [id, []]));
  const successors = new Map<string, LayoutEdge[]>();
  for (const edge of relevant) {
    predecessors.get(edge.to)!.push(edge.from);
    const list = successors.get(edge.from) ?? [];
    list.push(edge);
    successors.set(edge.from, list);
  }
  const indegree = new Map(ids.map((id) => [id, predecessors.get(id)!.length]));
  const rank = new Map<string, number>();
  const queue = ids.filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const predecessorRanks = predecessors.get(id)!.map((from) => rank.get(from) ?? 0);
    const base = predecessorRanks.length > 0 ? Math.max(...predecessorRanks) : 0;
    // A hung node (rule 2) never takes the normal `+1` step: it sits at its source's rank plus a half
    // step, and — critically — that fractional rank still feeds every successor's own `1 + max(...)`
    // below. A hung node stays out of the *row* pass (it is never a member of `mainIds`-style row-0
    // spine placement — see `computeRow`), but it must stay IN this rank pass, or its own successors
    // lose their only predecessor and silently collapse to whatever rank their next real predecessor
    // (or none at all) gives them.
    rank.set(id, hang.has(id) ? base + 0.5 : predecessorRanks.length > 0 ? base + 1 : 0);
    for (const edge of successors.get(id) ?? []) {
      const remaining = (indegree.get(edge.to) ?? 0) - 1;
      indegree.set(edge.to, remaining);
      if (remaining === 0) queue.push(edge.to);
    }
  }
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0); // a cycle among non-revisit edges: not a well-formed reference graph, but never left rankless
  return rank;
}

/** Rule 2's fork case, absent `facts.fork`: "an act with ≥2 unlabelled outgoing edges" is the fork;
 * each of its outgoing edges opens a branch that runs single-file until it reaches a judge with ≥2
 * incoming edges (the join CONTEXT.md and the plan's Global Constraints both name). Not exercised by
 * a fixture in this task's test file — every fork test supplies `facts.fork` — but rule 2 asks for it
 * unconditionally, so a Pack whose Run view never sends `facts.fork` still gets a fanned-out fork. */
function autoDetectForkBranches(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): { id: string; nodes: string[] }[] | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const candidate of nodes) {
    if (candidate.kind !== 'act') continue;
    const outgoing = edges.filter((edge) => edge.from === candidate.id && !edge.revisit && edge.outcome === undefined);
    if (outgoing.length < 2) continue;
    const chains: string[][] = [];
    let joinId: string | undefined;
    for (const first of outgoing) {
      const chain: string[] = [];
      let cursor: string | undefined = first.to;
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const incoming = edges.filter((edge) => edge.to === cursor && !edge.revisit);
        if (incoming.length >= 2 && byId.get(cursor)?.kind === 'judge') { joinId = cursor; break; }
        chain.push(cursor);
        const onward = edges.filter((edge) => edge.from === cursor && !edge.revisit);
        cursor = onward.length === 1 ? onward[0]!.to : undefined;
      }
      chains.push(chain);
    }
    if (joinId !== undefined) return chains.map((chainNodes, i) => ({ id: String(i), nodes: chainNodes }));
  }
  return undefined;
}

/** Rule 2's row: 0 on the spine; 1 for a hung node; for a fork's branch `i` of `n`,
 * `(i - (n - 1) / 2) * 0.6` for every node the branch lists — the fork and its join are never listed,
 * so they keep row 0 ("the join returns to row 0"). */
function computeRow(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], hang: ReadonlySet<string>, fork: LayoutFacts['fork'] | undefined): Map<string, number> {
  const row = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  for (const id of hang) row.set(id, 1);
  const branches = fork?.branches ?? autoDetectForkBranches(nodes, edges);
  if (branches) {
    const n = branches.length;
    branches.forEach((branch, i) => {
      const r = (i - (n - 1) / 2) * 0.6;
      for (const id of branch.nodes) row.set(id, r);
    });
  }
  return row;
}

// ---------------------------------------------------------------------------------------------------
// Rule 4 (edge paths and chips) and rule 5 (lit).

/** Samples a cubic bezier's `y(t)` across `t ∈ [0, 1]` and returns the smallest value reached — the
 * highest point the arc draws, since SVG's y-axis grows downward. `t = 0.5` is always sampled, which
 * is exact (not an approximation) for every arc this module draws: each one is symmetric end-to-end
 * (`y0 === y3`, `y1 === y2`, the same-row case) or close enough to it that a 100-step scan is well
 * past the precision anything downstream of the badge's `y` needs. Used by the revisit arc's badge
 * (rule 4, finding 3): the badge sits 34px above whatever the actual control points draw, rather than
 * a fixed offset from the top-level spine that put a loop's or growth's own revisit badge miles above
 * its own arc. */
function bezierApexY(y0: number, y1: number, y2: number, y3: number): number {
  let apex = Math.min(y0, y3);
  for (let i = 1; i < 100; i++) {
    const t = i / 100;
    const mt = 1 - t;
    const y = mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
    if (y < apex) apex = y;
  }
  return apex;
}

/** Rule 4's edge forms, plus rule 5's lit rule (`state(from)` done/reconciled, except a revisit edge
 * which lights from `generation > 1` instead). The FAIL/UNDETERMINED-to-a-hung-node case is selected
 * by `isHungTarget` — the caller's own `hangNodeIds` membership test for `edge.to` — rather than the
 * geometric `ty > sy` this module used to check (finding 6): a hung node is defined by its edges'
 * outcomes, not by where rows happened to place it, and the two can disagree once a fork or a shifted
 * loop is involved.
 *
 * The rule 4 text also describes a "vertical" chip placement (`sx === tx`) for a same-rank outcome
 * edge; that branch is deleted (finding 6) rather than kept dead. Rank strictly increases by at least
 * 0.5 along every non-revisit edge (rule 1 and the hung-node half-step above), so an outcome edge's
 * source and target never land at the same x — the branch could never trigger and was never covered
 * by a test.
 *
 * The revisit arc's and the FAIL/UNDETERMINED cubic's exact control points are this module's own
 * choice — the brief gives the FAIL cubic's control points but the revisit arc's only constraint
 * ("any arc that stays above `PAD_Y - 40`", tested via the badge's `y`), so the arc below mirrors the
 * FAIL cubic's shape: two control points pulling the curve straight up from each endpoint before the
 * far ends bow into it. */
function classifyEdge(
  edge: LayoutEdge, sx: number, sy: number, tx: number, ty: number,
  generation: number | undefined, litFromSource: boolean, isHungTarget: boolean,
): PlacedEdge {
  if (edge.revisit) {
    const count = generation ?? 1;
    const c1y = sy - 90;
    const c2y = ty - 90;
    const apex = bezierApexY(sy - 18, c1y, c2y, ty - 18);
    // 34px above the apex is right for a loop's or a growth's own revisit arc, which sits well down
    // the canvas — but on the main spine (`PAD_Y = 72`, so the arc's own endpoints are already close
    // to the top) that same 34px overshoots above y = 0 and off the canvas entirely. Below 12px there
    // is no longer room for the badge, so fall back to the brief's own fixed spine offset (`PAD_Y -
    // 52`), which sits safely inside the scene for every spine-level arc; a subgraph's own arc is far
    // enough down that `apex - 34` never needs the fallback.
    const badgeY = apex - 34 >= 12 ? apex - 34 : PAD_Y - 52;
    return {
      from: edge.from, to: edge.to, kind: 'revisit', lit: count > 1,
      path: `M ${sx} ${sy - 18} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty - 18}`,
      badge: { x: (sx + tx) / 2, y: badgeY, count },
    };
  }
  if ((edge.outcome === 'FAIL' || edge.outcome === 'UNDETERMINED') && isHungTarget) {
    const outcome = edge.outcome;
    return {
      from: edge.from, to: edge.to, kind: 'outcome', outcome, lit: litFromSource,
      path: `M ${sx + 18} ${sy} C ${sx + 22} ${sy}, ${tx} ${ty - 30}, ${tx} ${ty - 18}`,
      chip: { x: tx, y: ty + 34, text: outcome },
    };
  }
  if (edge.outcome !== undefined) {
    const outcome = edge.outcome;
    return {
      from: edge.from, to: edge.to, kind: 'outcome', outcome, lit: litFromSource,
      path: `M ${sx + 18} ${sy} L ${tx - 18} ${ty}`,
      chip: { x: (sx + tx) / 2, y: sy - 24, text: outcome },
    };
  }
  return { from: edge.from, to: edge.to, kind: 'dependency', lit: litFromSource, path: `M ${sx + 18} ${sy} L ${tx - 18} ${ty}` };
}

/** The bounding box of a set of node centres, padded 24px past each node's own half-width — rule 6's
 * "the frame spans them with 24 px padding", reused for a growth's frame (rule 7 does not restate the
 * figure, but a growth frame is "laid out below `parentNode`" the same way an open loop's is).
 *
 * An empty subgraph (finding 4) has no centres to bound — `Math.min`/`Math.max` of an empty spread is
 * `Infinity`/`-Infinity`, which would otherwise poison every downstream width/height computation. It
 * instead collapses to the same fixed 120×28 box a closed loop uses, hung at the caller's `anchor`
 * (the position the subgraph's own base rank/row would have placed its first node at). */
function boundingFrame(
  points: readonly { x: number; y: number }[],
  anchor: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: anchor.x, y: anchor.y, width: 120, height: 28 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - NODE / 2 - 24;
  const maxX = Math.max(...xs) + NODE / 2 + 24;
  const minY = Math.min(...ys) - NODE / 2 - 24;
  const maxY = Math.max(...ys) + NODE / 2 + 24;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The one pure function this module exists for: a HimaFabric reference graph plus what the execution
 * trace knows so far, turned into a fully positioned scene. Rules 1–2 place the main spine; rule 3
 * reads each node's state; rules 4–5 place and light every edge; rule 6 hangs a Frame under every
 * explore node that opens a loop, drawing its nodes only once the Run is inside it; rule 7 hangs an
 * accepted growth's Frame under its parent node; rule 8 marks a revision's nodes; rule 9 places the
 * Goal and sizes the scene, including the extra height an open loop or a growth adds below the spine. */
export function layoutCanvas(graph: LayoutGraph, facts?: LayoutFacts): CanvasScene {
  const hang = hangNodeIds(graph.nodes, graph.edges, graph.entry);
  const rankMap = computeRank(graph.nodes, graph.edges, hang);
  const rowMap = computeRow(graph.nodes, graph.edges, hang, facts?.fork);

  const rows = graph.nodes.map((node) => rowMap.get(node.id) ?? 0);
  const minRow = rows.length > 0 ? Math.min(...rows) : 0;
  const maxRow = rows.length > 0 ? Math.max(...rows) : 0;
  const ranks = graph.nodes.map((node) => rankMap.get(node.id) ?? 0);
  const maxRank = ranks.length > 0 ? Math.max(...ranks) : 0;

  // Rule 3.
  const stateOf = (id: string): NodeVisualState => facts?.states?.[id] ?? (facts?.available?.includes(id) ? 'available' : 'pending');
  const litOf = (id: string) => stateOf(id) === 'done' || stateOf(id) === 'reconciled';
  const waitedForSlotOf = (id: string) => facts?.waitedForSlot?.includes(id) ?? false;
  // Rule 8.
  const revisedOf = (id: string): 'changed' | 'affected' | undefined => {
    const revisions = facts?.revisions;
    if (!revisions) return undefined;
    if (revisions.some((revision) => revision.changedNodes.includes(id))) return 'changed';
    if (revisions.some((revision) => revision.affectedNodes.includes(id))) return 'affected';
    return undefined;
  };

  const pass1X = new Map(graph.nodes.map((node) => [node.id, X0 + (rankMap.get(node.id) ?? 0) * PITCH]));
  const pass1Y = new Map(graph.nodes.map((node) => [node.id, PAD_Y + ((rowMap.get(node.id) ?? 0) - minRow) * ROW]));

  // Rule 6: every explore node that opens a loop, processed low rank to high rank so an earlier
  // open loop's height is already known when a later one's anchor position is computed — "the spine
  // below the explore node shifts down by the frame's height + 24" applies to every node after it,
  // an open loop included.
  const openExplore: { id: string; loopName: string }[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'explore') continue;
    const loopName = graph.opens?.[node.id];
    if (loopName !== undefined) openExplore.push({ id: node.id, loopName });
  }
  openExplore.sort((a, b) => (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0));

  const loopFrames: Frame[] = [];
  const loopNodes: PlacedNode[] = [];
  const loopEdges: PlacedEdge[] = [];
  const loopShift: { exploreRank: number; extra: number }[] = [];
  const shiftBefore = (rank: number) => loopShift.filter((entry) => entry.exploreRank < rank).reduce((sum, entry) => sum + entry.extra, 0);

  /** Rules 6–7's shared body (finding 5): a loop's or a growth's own subgraph, laid out by rules 1–2
   * exactly as the top-level reference graph is (same `hangNodeIds`/`computeRank`/`computeRow`), then
   * hung at `baseRank`/`baseRow` — the anchor node's own rank/row plus the fixed 0.5-rank/1.2-row
   * offset both rules give. Sharing this one function is what makes findings 1–3 apply equally inside
   * a loop or a growth instead of only on the main spine: a hung node inside a subgraph still
   * propagates its rank (finding 1, via `computeRank`), the subgraph's own revisit badge follows its
   * own arc (finding 3, via `classifyEdge`'s apex computation) instead of the top-level spine's, and
   * every node here is shifted by whatever earlier open loop already pushed the spine down by (finding
   * 7, via `shiftBefore`) instead of drifting from the main spine's own y. */
  function placeSubgraph(subgraph: LayoutSubgraph, baseRank: number, baseRow: number, frameId: string, generation: number | undefined) {
    const localHang = hangNodeIds(subgraph.nodes, subgraph.edges, subgraph.entry);
    const localRank = computeRank(subgraph.nodes, subgraph.edges, localHang);
    const localRow = computeRow(subgraph.nodes, subgraph.edges, localHang, undefined);
    const rankOf = (id: string) => baseRank + (localRank.get(id) ?? 0);
    const rowOf = (id: string) => baseRow + (localRow.get(id) ?? 0);
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of subgraph.nodes) {
      positions.set(node.id, {
        x: X0 + rankOf(node.id) * PITCH,
        y: PAD_Y + (rowOf(node.id) - minRow) * ROW + shiftBefore(rankOf(node.id)),
      });
    }
    const anchor = { x: X0 + baseRank * PITCH, y: PAD_Y + (baseRow - minRow) * ROW + shiftBefore(baseRank) };
    const box = boundingFrame([...positions.values()], anchor);
    const nodes: PlacedNode[] = subgraph.nodes.map((node) => {
      const p = positions.get(node.id)!;
      return {
        id: node.id, kind: node.kind, x: p.x, y: p.y, rank: rankOf(node.id), row: rowOf(node.id),
        state: stateOf(node.id), caption: node.caption, current: node.id === facts?.currentNode,
        progress: facts?.progress?.[node.id], waitedForSlot: waitedForSlotOf(node.id), revised: revisedOf(node.id),
        frame: frameId,
      };
    });
    const edges: PlacedEdge[] = subgraph.edges.map((edge) => {
      const from = positions.get(edge.from)!;
      const to = positions.get(edge.to)!;
      return classifyEdge(edge, from.x, from.y, to.x, to.y, generation, litOf(edge.from), localHang.has(edge.to));
    });
    return { positions, box, nodes, edges };
  }

  for (const { id: exploreId, loopName } of openExplore) {
    const loop = graph.loops?.[loopName];
    if (!loop) continue;
    const exploreRank = rankMap.get(exploreId) ?? 0;
    const exploreX = pass1X.get(exploreId)!;
    const exploreY = pass1Y.get(exploreId)! + shiftBefore(exploreRank);
    const isOpen = facts?.openLoop?.id === loopName;
    const label = `${loopName} · ${loop.nodes.length} nodes`;

    if (!isOpen) {
      loopFrames.push({
        id: loopName, kind: 'loop', label, anchor: exploreId, open: false,
        x: exploreX + PITCH / 2, y: exploreY + ROW * 0.55, width: 120, height: 28,
      });
      continue;
    }

    const baseRank = exploreRank + 0.5;
    const baseRow = (rowMap.get(exploreId) ?? 0) + 1.2;
    // A loop's own revisit edge lights from its own generation counter (`facts.openLoop.generation`),
    // not the run row's `facts.generation` — the two count different things once the Run is inside it.
    const placed = placeSubgraph(loop, baseRank, baseRow, loopName, facts?.openLoop?.generation);
    loopFrames.push({ id: loopName, kind: 'loop', label, anchor: exploreId, open: true, ...placed.box });
    loopShift.push({ exploreRank, extra: placed.box.height + 24 });
    loopNodes.push(...placed.nodes);
    loopEdges.push(...placed.edges);
  }

  const mainNodes: PlacedNode[] = graph.nodes.map((node) => {
    const rank = rankMap.get(node.id) ?? 0;
    const row = rowMap.get(node.id) ?? 0;
    const x = pass1X.get(node.id)!;
    const y = pass1Y.get(node.id)! + shiftBefore(rank);
    return {
      id: node.id, kind: node.kind, x, y, rank, row, state: stateOf(node.id), caption: node.caption,
      current: node.id === facts?.currentNode, progress: facts?.progress?.[node.id],
      waitedForSlot: waitedForSlotOf(node.id), revised: revisedOf(node.id),
    };
  });
  const finalPosition = new Map(mainNodes.map((node) => [node.id, { x: node.x, y: node.y }]));

  const mainEdges: PlacedEdge[] = graph.edges.map((edge) => {
    const from = finalPosition.get(edge.from) ?? { x: pass1X.get(edge.from) ?? X0, y: pass1Y.get(edge.from) ?? PAD_Y };
    const to = finalPosition.get(edge.to) ?? { x: pass1X.get(edge.to) ?? X0, y: pass1Y.get(edge.to) ?? PAD_Y };
    return classifyEdge(edge, from.x, from.y, to.x, to.y, facts?.generation, litOf(edge.from), hang.has(edge.to));
  });

  // Rule 7: each accepted growth, laid out below its parent node the same way an open loop is below
  // its explore node, then a dashed edge back from the growth's own exit node (the one with no
  // outgoing edge inside it) to `returnNode`.
  const growthFrames: Frame[] = [];
  const growthNodes: PlacedNode[] = [];
  const growthEdges: PlacedEdge[] = [];
  for (const growth of facts?.growths ?? []) {
    const parentRank = rankMap.get(growth.parentNode) ?? 0;
    const parentRow = rowMap.get(growth.parentNode) ?? 0;
    const baseRank = parentRank + 0.5;
    const baseRow = parentRow + 1.2;
    const placed = placeSubgraph(growth.graph, baseRank, baseRow, growth.proposalId, facts?.generation);
    growthFrames.push({ id: growth.proposalId, kind: 'growth', label: growth.proposalId, anchor: growth.parentNode, open: true, ...placed.box });
    growthNodes.push(...placed.nodes);
    growthEdges.push(...placed.edges);

    const hasOutgoing = new Set(growth.graph.edges.filter((edge) => !edge.revisit).map((edge) => edge.from));
    const exit = growth.graph.nodes.find((node) => !hasOutgoing.has(node.id)) ?? growth.graph.nodes[growth.graph.nodes.length - 1];
    const returnTarget = finalPosition.get(growth.returnNode) ?? { x: pass1X.get(growth.returnNode) ?? X0, y: pass1Y.get(growth.returnNode) ?? PAD_Y };
    if (exit) {
      const from = placed.positions.get(exit.id)!;
      growthEdges.push({
        from: exit.id, to: growth.returnNode, kind: 'return', lit: litOf(exit.id),
        path: `M ${from.x} ${from.y} C ${from.x} ${from.y - 40}, ${returnTarget.x} ${returnTarget.y + 40}, ${returnTarget.x} ${returnTarget.y}`,
      });
    }
  }

  // Rule 9.
  const goal = { x: X0 + (maxRank + 1) * PITCH, y: PAD_Y - minRow * ROW + shiftBefore(maxRank + 1) };
  const allFrames = [...loopFrames, ...growthFrames];
  const allNodes = [...mainNodes, ...loopNodes, ...growthNodes];
  // Finding 2: the Goal roundel's own column (`goal.x + 96`) is only ever wide enough for the main
  // spine. An open loop or an accepted growth can lay nodes out to the right of it (a loop or growth
  // body is its own little rank-1-plus fan-out, not bounded by the top-level `maxRank`), so the scene
  // must also stretch to contain every frame's own box and every node's own pixels — never just the
  // Goal's column — or an open frame gets clipped by the canvas the renderer draws into.
  const width = Math.max(
    goal.x + 96,
    ...allFrames.map((frame) => frame.x + frame.width + 24),
    ...allNodes.map((node) => node.x + NODE / 2 + 24),
  );
  const openFrameExtra = loopShift.reduce((sum, entry) => sum + entry.extra, 0) + growthFrames.reduce((sum, frame) => sum + frame.height + 24, 0);
  const height = (maxRow - minRow + 1) * ROW + 2 * PAD_Y + openFrameExtra;

  return {
    width, height, goal,
    nodes: allNodes,
    edges: [...mainEdges, ...loopEdges, ...growthEdges],
    frames: allFrames,
  };
}

/** Rule 10: fit the scene's width into a viewport, centring it vertically (never above 16px from the
 * top) and never scaling up past 1. */
export function fitToWidth(scene: CanvasScene, viewport: { width: number; height: number }): { scale: number; tx: number; ty: number } {
  const scale = Math.min(1, (viewport.width - 32) / scene.width);
  return { scale, tx: 16, ty: Math.max(16, (viewport.height - scene.height * scale) / 2) };
}

/** The mockup's floor for reading a node's caption or an edge's chip: below 60% zoom, a label is
 * dropped rather than drawn too small to read (the Global Constraints' 12px/13px type floor). */
export const labelsVisibleAt = (scale: number): boolean => scale >= 0.6;
