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
//
// Behaviour change (intended): `hangNodeIds` counts only non-revisit edges as "incoming" (rule 1 is
// itself computed without the revisit edge), so a node whose *only* incoming edge is a revisit edge
// counts as having zero incoming edges and is hung exactly like a node with no incoming edge at all.
// A node reached only through a revisit — the loop-back edge is what routes to it, never a forward
// edge a pack author drew — is exactly the case rule 2's hung-node placement exists for.

/** HimaFabric's four node kinds (CONTEXT.md; `packGraph`'s own `PackNode.kind`). */
export type NodeKind = 'act' | 'judge' | 'explore' | 'wait';

/** Every state the Ledger's own node transitions can leave a node in, plus `pending` for a node the
 * Ledger has not touched yet and `available` for one `ExecutionContext.available` already names. */
export type NodeVisualState =
  | 'pending' | 'available' | 'running' | 'waiting-for-slot' | 'retrying' | 'blocked' | 'cancelled' | 'done' | 'reconciled';

/** One step of a merged node's checklist: a member node, the words a person reads for it, and where
 * it stands. Listed in the segment's own order. */
export interface GroupMember { readonly id: string; readonly label?: string; readonly about?: string; readonly state: NodeVisualState }

/** One node of a reference graph or a loop's/growth's own subgraph, stripped to what layout needs.
 * `label`/`about` are the Pack's own display words (the id stays the identity); `members` makes it a
 * merged step whose checklist is drawn under its label; `ai` marks an act node whose tool an AI agent
 * works through. The last two add text lines under the node, so the layout reserves room for them. */
export interface LayoutNode {
  readonly id: string; readonly kind: NodeKind; readonly caption?: string;
  readonly label?: string; readonly about?: string;
  readonly members?: readonly GroupMember[]; readonly ai?: true;
}

/** One edge. `revisit: true` marks the one edge kind rank (rule 1) is computed without; `outcome`
 * carries the Judge word (`PASS` | `FAIL` | `UNDETERMINED`, or a Pack's own converged/generation-limit
 * word) that a chip renders. */
export interface LayoutEdge {
  readonly from: string; readonly to: string; readonly outcome?: string; readonly revisit?: true;
  /** Draw no outcome chip on this edge (its outcome still decides hanging): a path to a wait node,
   *  or one leaving a merged step, where the word would only repeat what the shape already says. */
  readonly chipless?: true;
}

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
  readonly caption?: string; readonly current: boolean;
  readonly waitedForSlot: boolean; readonly revised?: 'changed' | 'affected'; readonly frame?: string;
  readonly label?: string; readonly about?: string; readonly members?: readonly GroupMember[]; readonly ai?: true;
  /** Laid out at the wide pitch of a graph with merged steps: its label and extra lines may run wider. */
  readonly wide?: true;
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
  /** The horizontal distance between two ranks: `PITCH`, or `WIDE_PITCH` for a graph with merged steps. */
  readonly pitch: number;
  readonly edges: readonly PlacedEdge[]; readonly frames: readonly Frame[]; readonly goal: { readonly x: number; readonly y: number };
}

/** The mockup's fixed pixel units (`docs/specs/campaign-workspace-ui/mockup/hima-campaign-mockup.html`):
 * the horizontal distance between two ranks, the vertical distance between two rows, a node's
 * diameter, the left margin before rank 0, and the top margin above row 0. */
export const PITCH = 90, ROW = 96, NODE = 36, X0 = 64, PAD_Y = 72;
/** A graph with merged steps reads in full words: its ranks stand this far apart, so a label runs to
 *  two lines of about 24 characters and a checklist line to about 30 (`WIDE_LABEL_HALF_W` and
 *  `WIDE_EXTRA_HALF_W` each side). */
export const WIDE_PITCH = 200;
const WIDE_LABEL_HALF_W = 82, WIDE_EXTRA_HALF_W = 105;

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
function computeRank(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], hang: ReadonlySet<string>, entry: string): Map<string, number> {
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
  pullUnanchored(queue, relevant, entry, hang, rank);
  return rank;
}

/** #63: a node the entry cannot reach through forward edges — a chain HimaFabric enters only through
 * a revisit edge or its own dispatch (a team worker, an earlier-APR detour) — has no forward
 * predecessor to rank it from, so rule 1 alone parks the whole chain at the entry's own column however
 * far downstream it rejoins, and every edge out of it spans the canvas. Such a node instead sits as
 * late as its successors allow: one rank before its nearest successor (a half rank before a hung
 * one), walked in reverse Kahn order so a whole unanchored chain slides up against the join it feeds.
 * A node the entry reaches keeps rule 1's rank exactly, and a pulled node never moves left of it. */
function pullUnanchored(order: readonly string[], edges: readonly LayoutEdge[], entry: string, hang: ReadonlySet<string>, rank: Map<string, number>): void {
  const successors = new Map<string, string[]>();
  for (const edge of edges) successors.set(edge.from, [...(successors.get(edge.from) ?? []), edge.to]);
  const anchored = new Set<string>([entry]);
  for (const id of order) if (anchored.has(id)) for (const to of successors.get(id) ?? []) anchored.add(to);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const next = successors.get(id) ?? [];
    if (anchored.has(id) || next.length === 0) continue;
    const latest = Math.min(...next.map((to) => (rank.get(to) ?? 0) - (hang.has(to) ? 0.5 : 1)));
    if (latest > (rank.get(id) ?? 0)) rank.set(id, latest);
  }
}

/** Rule 2's fork case, absent `facts.fork`: "an act with ≥2 unlabelled outgoing edges" is the fork;
 * each of its outgoing edges opens a branch that runs single-file until it reaches a judge with ≥2
 * incoming edges (the join CONTEXT.md and the plan's Global Constraints both name). Not exercised by
 * a fixture in this task's test file — every fork test supplies `facts.fork` — but rule 2 asks for it
 * unconditionally, so a Pack whose Run view never sends `facts.fork` still gets a fanned-out fork. */
function autoDetectForkBranches(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[]): { node: string; branches: { id: string; nodes: string[] }[] } | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const candidate of nodes) {
    if (candidate.kind !== 'act') continue;
    const outgoing = edges.filter((edge) => edge.from === candidate.id && !edge.revisit && edge.outcome === undefined);
    if (outgoing.length < 2) continue;
    const chains: string[][] = [];
    // C19: a branch's own id is the head node it starts at — the first node HimaFabric actually
    // enters on that branch — rather than an arbitrary declaration-order index, so a Run's own
    // `run.fork`/`GenerationView.branches` (real branch ids, `scene.ts`'s own `forkOf`) and this
    // auto-detected fallback agree on what a branch is called whenever the two happen to describe
    // the same fork.
    const heads: string[] = [];
    let joinId: string | undefined;
    for (const first of outgoing) {
      heads.push(first.to);
      const chain: string[] = [];
      let cursor: string | undefined = first.to;
      const seen = new Set<string>();
      while (cursor !== undefined && !seen.has(cursor)) {
        seen.add(cursor);
        const incoming = edges.filter((edge) => edge.to === cursor && !edge.revisit);
        // A merged step can be the join: its first member is the judge the branches converge into.
        if (incoming.length >= 2 && (byId.get(cursor)?.kind === 'judge' || byId.get(cursor)?.members !== undefined)) { joinId = cursor; break; }
        chain.push(cursor);
        const onward = edges.filter((edge) => edge.from === cursor && !edge.revisit);
        cursor = onward.length === 1 ? onward[0]!.to : undefined;
      }
      chains.push(chain);
    }
    if (joinId !== undefined) return { node: candidate.id, branches: chains.map((chainNodes, i) => ({ id: heads[i]!, nodes: chainNodes })) };
  }
  return undefined;
}

/** A node's footprint around its centre, in scene units: the 36-unit glyph plus the id and caption
 * lines `FabricNode` draws under it (13 px text on baselines `NODE / 2 + 20` and `+ 35`), each line
 * truncated to the `PITCH - 8` label budget. Two nodes whose footprints meet overlap on screen. */
const FOOT_HALF_W = (PITCH - 8) / 2, FOOT_TOP = NODE / 2, FOOT_BOTTOM = NODE / 2 + 39;

/** The extra lines some nodes draw below those two: one per member of a merged step's checklist, and
 * two (the agent's latest action and its counters) for an AI node. Each is `EXTRA_LINE` tall, and
 * reads wider than the label budget (`EXTRA_HALF_W` each side, about 22 characters of 12 px text). */
export const EXTRA_LINE = 15;
const EXTRA_HALF_W = 70;
const labelHalfOf = (wide: boolean | undefined): number => (wide === true ? WIDE_LABEL_HALF_W : FOOT_HALF_W);
const extraHalfOf = (wide: boolean | undefined): number => (wide === true ? WIDE_EXTRA_HALF_W : EXTRA_HALF_W);
const extraOf = (n: Pick<LayoutNode, 'members' | 'ai'>): number => ((n.members?.length ?? 0) + (n.ai === true ? 2 : 0)) * EXTRA_LINE;
const footBottomOf = (n: Pick<LayoutNode, 'members' | 'ai'>): number => FOOT_BOTTOM + extraOf(n);

/**
 * Each lane's own y, top to bottom: `ROW` apart as rule 2 spaces them, stretched further wherever a
 * node's extra lines (a merged step's checklist, an AI node's activity) would reach a node in a lower
 * lane within their width — that lane, and every lane under it, moves down until it clears them. A
 * graph with no extra lines keeps exactly `top + (row - minRow) * ROW`.
 */
function rowYs(nodes: readonly LayoutNode[], rank: ReadonlyMap<string, number>, row: ReadonlyMap<string, number>, minRow: number, top: number, pitch = PITCH, wide = false): Map<number, number> {
  const lanes = [...new Set(nodes.map((node) => row.get(node.id) ?? 0))].sort((a, b) => a - b);
  const ys = new Map<number, number>();
  let previous: number | undefined;
  for (const lane of lanes) {
    let y = previous === undefined ? top + (lane - minRow) * ROW : ys.get(previous)! + (lane - previous) * ROW;
    for (const owner of nodes) {
      const extra = extraOf(owner);
      const ownerLane = row.get(owner.id) ?? 0;
      if (extra === 0 || ownerLane >= lane) continue;
      const ownerX = (rank.get(owner.id) ?? 0) * pitch;
      const reaches = nodes.some((other) => (row.get(other.id) ?? 0) === lane && Math.abs((rank.get(other.id) ?? 0) * pitch - ownerX) < extraHalfOf(wide) + labelHalfOf(wide));
      if (reaches) y = Math.max(y, ys.get(ownerLane)! + FOOT_TOP + FOOT_BOTTOM + extra);
    }
    ys.set(lane, y);
    previous = lane;
  }
  return ys;
}

/** Rule 2's row (#63: lanes). Every node takes the first row, from its preferred row downward, where
 * its footprint meets no node already placed; nodes are placed by rank, then declaration order.
 *
 * - The preferred row continues the lowest home row among the node's forward predecessors (the entry
 *   and any node without one prefer row 0), so a chain stays in its lane and a join returns to the
 *   highest lane it gathers.
 * - A hung node (FAIL/UNDETERMINED-only or dynamically routed, `hangNodeIds`) keeps its source's home:
 *   it lands a row down because its half-rank neighbour already holds that row, and whatever follows
 *   it returns to the lane it detoured from.
 * - A fork's branch `i` of `n` prefers the fork's own row `+ (i - (n - 1) / 2)` — one full lane per
 *   branch, symmetric about the fork, so parallel branches never share a lane; the join returns to
 *   the fork's row.
 *
 * Only a real collision moves a node: a linear graph stays on row 0, and a node at a half rank never
 * shares a row with a neighbour half a pitch away, since their labels would run into each other. */
function computeRow(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], hang: ReadonlySet<string>, rank: ReadonlyMap<string, number>, fork: LayoutFacts['fork'] | undefined, pitch = PITCH): Map<string, number> {
  const detected = fork === undefined ? autoDetectForkBranches(nodes, edges) : { node: fork.node, branches: fork.branches };
  const branchOffset = new Map<string, number>();
  const n = detected?.branches.length ?? 0;
  // A graph with merged steps keeps the room below its spine for their checklists, so a fork's
  // lanes all open above it instead: branch i at lane -(i + 1). Every other graph fans symmetrically.
  const above = nodes.some((node) => node.members !== undefined);
  const wide = above;
  // Above the spine, the first branch in the graph's own order takes the lane nearest it.
  const position = new Map(nodes.map((node, i) => [node.id, i]));
  const lanes = detected === undefined ? [] : above
    ? [...detected.branches].sort((a, b) => (position.get(a.nodes[0] ?? '') ?? 0) - (position.get(b.nodes[0] ?? '') ?? 0))
    : detected.branches;
  lanes.forEach((branch, i) => { for (const id of branch.nodes) branchOffset.set(id, above ? -(i + 1) : i - (n - 1) / 2); });

  const ids = new Set(nodes.map((node) => node.id));
  const predecessors = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.revisit || !ids.has(edge.from) || !ids.has(edge.to)) continue;
    predecessors.set(edge.to, [...(predecessors.get(edge.to) ?? []), edge.from]);
  }
  const declared = new Map(nodes.map((node, i) => [node.id, i]));
  const order = [...nodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0) || declared.get(a.id)! - declared.get(b.id)!);

  const row = new Map<string, number>();
  const home = new Map<string, number>();
  const placed: { x: number; y: number; extra: number }[] = [];
  // Lanes are chosen from the glyph-and-label footprints alone, so a checklist or an AI node's
  // activity lines never bend the spine or a fork's lanes: `rowYs` opens the room they need below
  // their own row instead. Only two such blocks side by side on one row cannot be stretched apart,
  // so they still take separate lanes.
  const free = (x: number, y: number, extra: number) => placed.every((p) =>
    (Math.abs(p.x - x) >= 2 * labelHalfOf(wide) || Math.abs(p.y - y) >= (FOOT_TOP + FOOT_BOTTOM) / ROW)
    && !(extra > 0 && p.extra > 0 && p.y === y && Math.abs(p.x - x) < 2 * extraHalfOf(wide)));
  for (const node of order) {
    const x = (rank.get(node.id) ?? 0) * pitch;
    const homes = (predecessors.get(node.id) ?? []).map((from) => home.get(from)).filter((h): h is number => h !== undefined);
    const inherited = homes.length > 0 ? Math.min(...homes) : 0;
    const offset = branchOffset.get(node.id);
    const forkRow = offset === undefined || detected === undefined ? undefined : (row.get(detected.node) ?? 0) + offset;
    let r = forkRow ?? inherited;
    const extra = extraOf(node);
    while (!free(x, r, extra)) r += 1;
    row.set(node.id, r);
    placed.push({ x, y: r, extra });
    home.set(node.id, forkRow !== undefined ? (home.get(detected!.node) ?? 0) : hang.has(node.id) ? inherited : r);
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

/** The highest point (smallest y) of a cubic whose two control points share one height `c` — the form
 * every revisit arc takes — found exactly rather than sampled: with `c1 = c2 = c` the curve is `y(t) =
 * y0 (1-t)^3 + 3c t (1-t) + y3 t^3`, whose turning points are the roots in (0, 1) of `(y3 - y0) t^2 +
 * 2 (y0 - c) t + (c - y0) = 0`. */
function arcApexY(y0: number, c: number, y3: number): number {
  const at = (t: number) => y0 * (1 - t) ** 3 + 3 * c * t * (1 - t) + y3 * t ** 3;
  const a = y3 - y0, b = 2 * (y0 - c), k = c - y0;
  const roots = Math.abs(a) < 1e-9 ? (Math.abs(b) < 1e-9 ? [] : [-k / b])
    : (b * b - 4 * a * k < 0 ? [] : [(-b - Math.sqrt(b * b - 4 * a * k)) / (2 * a), (-b + Math.sqrt(b * b - 4 * a * k)) / (2 * a)]);
  return Math.min(y0, y3, ...roots.filter((t) => t > 0 && t < 1).map(at));
}

/** #64: the shared control height that makes a revisit arc from `y0` to `y3` peak exactly at `apex`
 * (never above it). Two endpoints on the top lane give `c = apex`'s own old fixed lift, as before; an
 * endpoint several lanes down — a back-edge leaving a staircase of Judges, or a lane under a wide
 * fork — pulls its control points higher so that its apex still clears the top lane instead of
 * cutting through the lanes above it. The apex falls as `c` falls, so a bisection between a height
 * that stays below `apex` (`c = apex`: the curve is a weighted mean of `y0`, `c` and `y3`) and one
 * that reaches it (the symmetric closed form, exact at `t = 0.5`) converges on it, keeping the side
 * whose apex never rises past `apex`. */
function arcControlFor(y0: number, y3: number, apex: number): number {
  let reaches = (8 * apex - y0 - y3) / 6, clear = apex;
  for (let i = 0; i < 60; i++) {
    const mid = (reaches + clear) / 2;
    if (arcApexY(y0, mid, y3) >= apex) clear = mid; else reaches = mid;
  }
  return clear;
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
  generation: number | undefined, litFromSource: boolean, isHungTarget: boolean, arcApex?: number,
): PlacedEdge {
  if (edge.revisit) {
    const count = generation ?? 1;
    // #63: `arcApex` is the height this arc peaks at above the lanes (one per nesting level,
    // `revisitLevels`), so nested arcs never share a curve. #64: both control points are solved for
    // that apex from the arc's own endpoints, so an arc from a node in a lower lane still clears the
    // top lane rather than peaking short of it.
    const shared = arcApex === undefined ? undefined : arcControlFor(sy - 18, ty - 18, arcApex);
    const c1y = shared ?? sy - 90;
    const c2y = shared ?? ty - 90;
    const apex = bezierApexY(sy - 18, c1y, c2y, ty - 18);
    // 34px above the apex is right for a loop's or a growth's own revisit arc, which sits well down
    // the canvas — but on the main spine (`PAD_Y = 72`, so the arc's own endpoints are already close
    // to the top) that same 34px overshoots above y = 0 and off the canvas entirely. Below 12px there
    // is no longer room for the badge, so fall back to the brief's own fixed spine offset (`PAD_Y -
    // 52`), which sits safely inside the scene for every spine-level arc; a subgraph's own arc is far
    // enough down that `apex - 34` never needs the fallback. #63: the fallback is the arc's own apex
    // (never above 12px) rather than one fixed height, so nested arcs each carry their own badge.
    const badgeY = apex - 34 >= 12 ? apex - 34 : Math.max(12, apex);
    return {
      from: edge.from, to: edge.to, kind: 'revisit', lit: count > 1,
      path: `M ${sx} ${sy - 18} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty - 18}`,
      badge: { x: (sx + tx) / 2, y: badgeY, count },
    };
  }
  // #63: the curve drops into the hung target from above, so it is kept for a target in a lower lane;
  // a hung target the lanes placed level with or above its source takes the ordinary form below.
  if ((edge.outcome === 'FAIL' || edge.outcome === 'UNDETERMINED') && isHungTarget && ty > sy) {
    const outcome = edge.outcome;
    return {
      from: edge.from, to: edge.to, kind: 'outcome', outcome, lit: litFromSource,
      path: `M ${sx + 18} ${sy} C ${sx + 22} ${sy}, ${tx} ${ty - 30}, ${tx} ${ty - 18}`,
      // #63: on the curve's own midpoint (t = 0.5 of the cubic above), not under the target, where
      // it covered the target's own id and caption.
      ...(edge.chipless === true ? {} : { chip: { x: (sx + tx) / 2 + 10.5, y: (sy + ty) / 2 - 13.5, text: outcome } }),
    };
  }
  if (edge.outcome !== undefined) {
    const outcome = edge.outcome;
    return {
      from: edge.from, to: edge.to, kind: 'outcome', outcome, lit: litFromSource,
      path: `M ${sx + 18} ${sy} L ${tx - 18} ${ty}`,
      ...(edge.chipless === true ? {} : { chip: { x: (sx + tx) / 2, y: sy - 24, text: outcome } }),
    };
  }
  return { from: edge.from, to: edge.to, kind: 'dependency', lit: litFromSource, path: `M ${sx + 18} ${sy} L ${tx - 18} ${ty}` };
}

// ---------------------------------------------------------------------------------------------------
// #63: back-edge nesting and forward-edge routing, so a large graph's edges stay readable.

/** How far above the top lane a level-0 revisit arc's control points sit (the mockup's own 90 from a
 * node's centre, i.e. 72 above its top edge), and how much higher each nesting level lifts it. An arc
 * between two top-lane nodes peaks three quarters of that lift above the lane (`arcApexAbove`); an arc
 * from lower lanes is solved to peak at the same height (`arcControlFor`). */
const ARC_LIFT = 72, ARC_STEP = 16;
const arcApexAbove = (top: number, level: number) => top - 0.75 * (ARC_LIFT + ARC_STEP * level);

/** Each revisit edge's nesting level: 0 for an arc whose span meets no narrower arc, else one more
 * than the highest narrower arc inside or overlapping its span (an equal span counts as narrower when
 * declared earlier), so wider arcs rise over narrower ones instead of drawing on the same curve. #64:
 * an arc that only overlaps another (neither contains the other) takes its own level too — two arcs
 * that peak at one height draw their flat tops along one line wherever those tops overlap. */
function revisitLevels(edges: readonly LayoutEdge[], rankOf: (id: string) => number): Map<LayoutEdge, number> {
  const arcs = edges.filter((edge) => edge.revisit).map((edge, i) => {
    const a = rankOf(edge.from), b = rankOf(edge.to);
    return { edge, i, lo: Math.min(a, b), hi: Math.max(a, b) };
  });
  arcs.sort((p, q) => (p.hi - p.lo) - (q.hi - q.lo) || p.i - q.i);
  const level = new Map<LayoutEdge, number>();
  arcs.forEach((arc, k) => {
    const inner = arcs.slice(0, k).filter((other) => (other.lo >= arc.lo && other.hi <= arc.hi) || (other.lo < arc.hi && arc.lo < other.hi))
      .map((other) => level.get(other.edge)! + 1);
    level.set(arc.edge, inner.length > 0 ? Math.max(...inner) : 0);
  });
  return level;
}

/** How far from a node's centre a routed edge's vertical run sits: just past the glyph's own 18-unit
 * half-width and its 2-unit margin. An edge leaves its source on the right of that column and enters
 * its target on the left of that one, so a run leaving rank r and one entering rank r + 0.5 (45 units
 * on) keep 4 units apart instead of drawing as one line. */
const CORRIDOR = NODE / 2 + 2.5;
/** The spacing between two routed edges' horizontal runs. */
const TRACK = 6;

/** Points along an M/L/Q/C path this module wrote, 24 per segment: the places a chip may ride. */
function samplePath(d: string): { x: number; y: number }[] {
  const tokens = d.match(/[MLQC]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let i = 0, command = '', x = 0, y = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLQC]/.test(tokens[i]!)) command = tokens[i++]!;
    const controls: { x: number; y: number }[] = [];
    const count = command === 'C' ? 3 : command === 'Q' ? 2 : 1;
    for (let k = 0; k < count; k++) controls.push({ x: num(), y: num() });
    const end = controls[controls.length - 1]!;
    if (command !== 'M') {
      for (let step = 1; step <= 24; step++) {
        const t = step / 24, m = 1 - t;
        if (command === 'L') points.push({ x: x + (end.x - x) * t, y: y + (end.y - y) * t });
        else if (command === 'Q') points.push({ x: m * m * x + 2 * m * t * controls[0]!.x + t * t * end.x, y: m * m * y + 2 * m * t * controls[0]!.y + t * t * end.y });
        else points.push({ x: m * m * m * x + 3 * m * m * t * controls[0]!.x + 3 * m * t * t * controls[1]!.x + t * t * t * end.x,
          y: m * m * m * y + 3 * m * m * t * controls[0]!.y + 3 * m * t * t * controls[1]!.y + t * t * t * end.y });
      }
    }
    x = end.x; y = end.y;
  }
  return points;
}

type Point = { readonly x: number; readonly y: number };
type Box = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };

/** A node's glyph (with a 2-unit margin) and its label lines, as open boxes. */
const glyphBox = (n: Point): Box => ({ left: n.x - NODE / 2 - 2, right: n.x + NODE / 2 + 2, top: n.y - NODE / 2 - 2, bottom: n.y + NODE / 2 + 2 });
const labelBox = (n: Point & { readonly wide?: true }): Box => ({ left: n.x - labelHalfOf(n.wide), right: n.x + labelHalfOf(n.wide), top: n.y + NODE / 2, bottom: n.y + FOOT_BOTTOM });
/** A node's label box, plus the wider box of its extra lines when it draws any. */
const footBoxes = (n: PlacedNode): Box[] => {
  const extra = extraOf(n);
  return extra === 0 ? [labelBox(n)] : [labelBox(n), { left: n.x - extraHalfOf(n.wide), right: n.x + extraHalfOf(n.wide), top: n.y + FOOT_BOTTOM, bottom: n.y + FOOT_BOTTOM + extra }];
};

/** Whether the straight segment `a`–`b` passes through the inside of `box` (Liang–Barsky clipping). */
function segmentMeets(a: Point, b: Point, box: Box): boolean {
  let enter = 0, leave = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x - box.left], [dx, box.right - a.x], [-dy, a.y - box.top], [dy, box.bottom - a.y]] as const) {
    if (p === 0) { if (q <= 0) return false; continue; }
    const r = q / p;
    if (p < 0) enter = Math.max(enter, r); else leave = Math.min(leave, r);
  }
  return enter < leave;
}

/** #64: an M/L/Q/C path this module wrote, as straight chords: a line is its own chord, and a curve
 * is cut into chords at most 4 units long. Testing chords against a box is exact for a line however
 * long it runs, where a fixed number of samples per segment steps right over a glyph's corner (a
 * 1000-unit FAIL edge sampled 24 times steps 45 units, wider than the 40-unit glyph box). */
function pathChords(d: string): [Point, Point][] {
  const tokens = d.match(/[MLQC]|-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) ?? [];
  const chords: [Point, Point][] = [];
  let i = 0, command = '', cur: Point = { x: 0, y: 0 };
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/[MLQC]/.test(tokens[i]!)) command = tokens[i++]!;
    const count = command === 'C' ? 3 : command === 'Q' ? 2 : 1;
    const controls: Point[] = [];
    for (let k = 0; k < count; k++) controls.push({ x: num(), y: num() });
    const end = controls[controls.length - 1]!;
    if (command === 'L') chords.push([cur, end]);
    else if (command !== 'M') {
      const polygon = [cur, ...controls];
      const length = polygon.slice(1).reduce((sum, p, k) => sum + Math.hypot(p.x - polygon[k]!.x, p.y - polygon[k]!.y), 0);
      const steps = Math.max(8, Math.ceil(length / 4));
      let prev = cur;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps, m = 1 - t;
        const next = command === 'Q'
          ? { x: m * m * cur.x + 2 * m * t * controls[0]!.x + t * t * end.x, y: m * m * cur.y + 2 * m * t * controls[0]!.y + t * t * end.y }
          : { x: m * m * m * cur.x + 3 * m * m * t * controls[0]!.x + 3 * m * t * t * controls[1]!.x + t * t * t * end.x,
            y: m * m * m * cur.y + 3 * m * m * t * controls[0]!.y + 3 * m * t * t * controls[1]!.y + t * t * t * end.y };
        chords.push([prev, next]);
        prev = next;
      }
    }
    cur = end;
  }
  return chords;
}

/** An orthogonal polyline with its corners rounded, as an SVG path. */
function roundedPath(points: readonly { x: number; y: number }[]): string {
  const kept = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y)
    .filter((p, i, all) => i === 0 || i === all.length - 1 || !((all[i - 1]!.x === p.x && p.x === all[i + 1]!.x) || (all[i - 1]!.y === p.y && p.y === all[i + 1]!.y)));
  let d = `M ${kept[0]!.x} ${kept[0]!.y}`;
  for (let i = 1; i < kept.length; i++) {
    const p = kept[i]!, next = kept[i + 1];
    if (next === undefined) { d += ` L ${p.x} ${p.y}`; break; }
    const prev = kept[i - 1]!;
    const r = Math.min(6, Math.hypot(p.x - prev.x, p.y - prev.y) / 2, Math.hypot(next.x - p.x, next.y - p.y) / 2);
    const inX = Math.sign(p.x - prev.x), inY = Math.sign(p.y - prev.y), outX = Math.sign(next.x - p.x), outY = Math.sign(next.y - p.y);
    d += ` L ${p.x - inX * r} ${p.y - inY * r} Q ${p.x} ${p.y} ${p.x + outX * r} ${p.y + outY * r}`;
  }
  return d;
}

/** A forward edge whose own straight line or curve would cross another node's glyph or label, or
 * whose straight line climbs steeper than it runs, is redrawn orthogonally instead: out of its source into the corridor just past it, along the free
 * horizontal track nearest its two ends, and into the corridor just before its target. Vertical runs
 * sit in corridors, which no glyph reaches; the track avoids every glyph, prefers to avoid labels,
 * and keeps `TRACK` apart from an earlier routed edge's run over the same stretch. An edge whose own
 * line is already clear keeps it, so a small graph draws exactly as it did. Returns the lowest y a
 * track took, for the scene's height. */
function routeEdges(edges: PlacedEdge[], nodes: readonly PlacedNode[]): number {
  const at = new Map(nodes.map((n) => [n.id, n]));
  const runs: { from: number; to: number; y: number }[] = [];
  let lowest = -Infinity;
  if (nodes.length === 0) return lowest;
  const top = Math.min(...nodes.map((n) => n.y)) - NODE / 2 - 3 * TRACK;
  const bottom = Math.max(...nodes.map((n) => n.y + footBottomOf(n))) + 16 * TRACK;
  edges.forEach((edge, index) => {
    if (edge.kind !== 'dependency' && edge.kind !== 'outcome') return;
    const s = at.get(edge.from), t = at.get(edge.to);
    if (!s || !t || t.x <= s.x) return;
    const others = nodes.filter((n) => n !== s && n !== t);
    const steep = /^M [^A-Z]+ L [^A-Z]+$/.test(edge.path) && Math.abs(t.y - s.y) > t.x - s.x - NODE;
    const boxes = others.flatMap((n) => [glyphBox(n), ...footBoxes(n)]);
    if (!steep && !pathChords(edge.path).some(([a, b]) => boxes.some((box) => segmentMeets(a, b, box)))) return;
    const xa = s.x + CORRIDOR, xb = Math.max(xa, t.x - CORRIDOR);
    const crossing = others.filter((n) => n.x + FOOT_HALF_W > xa && n.x - FOOT_HALF_W < xb);
    let best: { y: number; cost: number } | undefined;
    for (let y = top; y <= bottom; y += TRACK) {
      if (crossing.some((n) => Math.abs(y - n.y) < NODE / 2 + 2 && n.x + NODE / 2 + 2 > xa && n.x - NODE / 2 - 2 < xb)) continue;
      if (runs.some((run) => run.from < xb + CORRIDOR && xa - CORRIDOR < run.to && Math.abs(run.y - y) < TRACK)) continue;
      const labels = crossing.filter((n) => y > n.y + NODE / 2 && y < n.y + footBottomOf(n)).length
        // The vertical runs are counted against every label they cross, the edge's own source and
        // target included: a track above the source leaves it clear of its own id and caption.
        + nodes.filter((n) => ([[xa, s.y], [xb, t.y]] as const).some(([x, end]) => Math.abs(x - n.x) < FOOT_HALF_W && Math.min(end, y) < n.y + footBottomOf(n) && Math.max(end, y) > n.y + NODE / 2)).length;
      const cost = Math.abs(y - s.y) + Math.abs(y - t.y) + 4 * ROW * labels;
      if (best === undefined || cost < best.cost) best = { y, cost };
    }
    if (best === undefined) return;
    const y = best.y;
    runs.push({ from: xa, to: xb, y });
    lowest = Math.max(lowest, y);
    edges[index] = { ...edge, path: roundedPath([{ x: s.x + NODE / 2, y: s.y }, { x: xa, y: s.y }, { x: xa, y }, { x: xb, y }, { x: xb, y: t.y }, { x: t.x - NODE / 2, y: t.y }]) };
  });
  placeChips(edges, nodes);
  return lowest;
}

/** A chip's own pill, as `FabricCanvas` draws it: `text.length * 6.5 + 16` wide, 18 tall. */
const chipBox = (chip: { x: number; y: number; text: string }) => {
  const half = (chip.text.length * 6.5 + 16) / 2;
  return { left: chip.x - half, right: chip.x + half, top: chip.y - 9, bottom: chip.y + 9 };
};

/** Every outcome chip clear of every other chip and of every node's glyph and labels. A straight
 * edge's chip keeps rule 4's own place over its midpoint; a curved or routed edge's chip rides its
 * own path from the source end and takes the first point where its pill meets nothing already
 * there (or, when none is free, rule 4's own place). */
function placeChips(edges: PlacedEdge[], nodes: readonly PlacedNode[]): void {
  const meets = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const blocked: Box[] = nodes.flatMap((n) => [
    { left: n.x - NODE / 2, right: n.x + NODE / 2, top: n.y - NODE / 2, bottom: n.y + NODE / 2 },
    ...footBoxes(n),
  ]);
  const straight = (edge: PlacedEdge) => /^M [^A-Z]+ L [^A-Z]+$/.test(edge.path);
  // A straight edge's chip first tries rule 4's own place over its midpoint, then stacks above it (a
  // Judge whose PASS and FAIL both reach one node shares that midpoint); a curved or routed edge's
  // chip rides its own path from the source end. Either takes the first spot its pill meets nothing
  // already placed, and keeps rule 4's own place only when no spot is free.
  const place = (index: number) => {
    const edge = edges[index]!;
    const chip = edge.chip!;
    const along = samplePath(edge.path).filter((_, i, all) => i >= all.length * 0.15).map((p) => ({ ...chip, x: p.x, y: p.y }));
    // Where the path itself is crowded (a staircase of FAIL detours), the pill may sit a little off
    // its line, near the path's own midpoint, rather than on another chip or node.
    const middle = along[Math.floor(along.length / 2)] ?? chip;
    // A short hop between two close nodes (a Judge whose FAIL and UNDETERMINED both reach a wait just
    // below it) leaves no free spot on the path itself, so the search widens a little further out.
    const near = [0, 14, -14, 28, -28, 42, -42, 56, -56, 70, -70].flatMap((dy) => [0, 24, -24, 48, -48, 72, -72, 96, -96].map((dx) => ({ ...chip, x: middle.x + dx, y: middle.y + dy })));
    const candidates = (straight(edge) ? [0, 1, 2, 3].map((k) => ({ ...chip, y: chip.y - 20 * k })).concat(along) : along).concat(near);
    const placed = candidates.find((candidate) => !blocked.some((box) => meets(chipBox(candidate), box))) ?? chip;
    blocked.push(chipBox(placed));
    edges[index] = { ...edge, chip: placed };
  };
  edges.forEach((edge, index) => { if (edge.chip !== undefined && straight(edge)) place(index); });
  edges.forEach((edge, index) => { if (edge.chip !== undefined && !straight(edge)) place(index); });
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

/** The display words and extra lines a placed node carries over from its `LayoutNode`, only when set. */
const wordsOf = (node: LayoutNode): Pick<PlacedNode, 'label' | 'about' | 'members' | 'ai'> => ({
  ...(node.label === undefined ? {} : { label: node.label }),
  ...(node.about === undefined ? {} : { about: node.about }),
  ...(node.members === undefined ? {} : { members: node.members }),
  ...(node.ai === true ? { ai: true as const } : {}),
});

/** The one pure function this module exists for: a HimaFabric reference graph plus what the execution
 * trace knows so far, turned into a fully positioned scene. Rules 1–2 place the main spine; rule 3
 * reads each node's state; rules 4–5 place and light every edge; rule 6 hangs a Frame under every
 * explore node that opens a loop, drawing its nodes only once the Run is inside it; rule 7 hangs an
 * accepted growth's Frame under its parent node; rule 8 marks a revision's nodes; rule 9 places the
 * Goal and sizes the scene, including the extra height an open loop or a growth adds below the spine. */
export function layoutCanvas(graph: LayoutGraph, facts?: LayoutFacts): CanvasScene {
  const hang = hangNodeIds(graph.nodes, graph.edges, graph.entry);
  const rankMap = computeRank(graph.nodes, graph.edges, hang, graph.entry);
  const checklists = graph.nodes.some((node) => node.members !== undefined);
  const pitch = checklists ? WIDE_PITCH : PITCH;
  const rowMap = computeRow(graph.nodes, graph.edges, hang, rankMap, facts?.fork, pitch);
  // With merged steps on the spine, a wait node (drawn only once the Run has been there) stands
  // apart past the Goal, one lane below the spine, rather than hanging among the checklists.
  if (checklists) {
    const spineRanks = graph.nodes.filter((node) => node.kind !== 'wait').map((node) => rankMap.get(node.id) ?? 0);
    const spineMax = spineRanks.length > 0 ? Math.max(...spineRanks) : 0;
    graph.nodes.filter((node) => node.kind === 'wait').forEach((node, i) => { rankMap.set(node.id, spineMax + 2 + i); rowMap.set(node.id, 1); });
  }

  const rows = graph.nodes.map((node) => rowMap.get(node.id) ?? 0);
  const minRow = rows.length > 0 ? Math.min(...rows) : 0;
  const maxRow = rows.length > 0 ? Math.max(...rows) : 0;
  const ranks = graph.nodes.filter((node) => !checklists || node.kind !== 'wait').map((node) => rankMap.get(node.id) ?? 0);
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

  // #63: nested revisit arcs rise above the level-0 arc's own height, so the lanes move down by the
  // extra rise (a cubic's apex sits three quarters of the way to its control points) and the highest
  // arc still stays on the canvas. A graph with at most one level of arcs keeps its lanes where they
  // were (only a badge with no room above its arc now sits on the arc's own apex).
  const mainLevels = revisitLevels(graph.edges, (id) => rankMap.get(id) ?? 0);
  const topExtra = 0.75 * ARC_STEP * Math.max(0, ...mainLevels.values());
  const pass1X = new Map(graph.nodes.map((node) => [node.id, X0 + (rankMap.get(node.id) ?? 0) * pitch]));
  const laneY = rowYs(graph.nodes, rankMap, rowMap, minRow, PAD_Y + topExtra, pitch, checklists);
  if (checklists) {
    // The lanes above a checklist spine stand evenly apart, at the widest gap any of them needs.
    const upper = [...laneY.keys()].filter((lane) => lane <= 0).sort((a, b) => a - b);
    if (upper.length > 1) {
      let step = 0;
      for (let i = 1; i < upper.length; i++) step = Math.max(step, (laneY.get(upper[i]!)! - laneY.get(upper[i - 1]!)!) / (upper[i]! - upper[i - 1]!));
      const before = laneY.get(upper.at(-1)!)!;
      for (const lane of upper) laneY.set(lane, laneY.get(upper[0]!)! + (lane - upper[0]!) * step);
      const delta = laneY.get(upper.at(-1)!)! - before;
      for (const lane of [...laneY.keys()]) if (lane > 0) laneY.set(lane, laneY.get(lane)! + delta);
    }
  }
  /** How far the lanes down to `row` were stretched for extra lines (0 for a graph without any). */
  const stretchAt = (row: number): number => {
    let stretch = 0;
    for (const [lane, y] of laneY) if (lane <= row) stretch = y - (PAD_Y + topExtra + (lane - minRow) * ROW);
    return stretch;
  };
  const pass1Y = new Map(graph.nodes.map((node) => [node.id, laneY.get(rowMap.get(node.id) ?? 0)!]));

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
    const localRank = computeRank(subgraph.nodes, subgraph.edges, localHang, subgraph.entry);
    const localRow = computeRow(subgraph.nodes, subgraph.edges, localHang, localRank, undefined);
    const rankOf = (id: string) => baseRank + (localRank.get(id) ?? 0);
    const rowOf = (id: string) => baseRow + (localRow.get(id) ?? 0);
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of subgraph.nodes) {
      positions.set(node.id, {
        x: X0 + rankOf(node.id) * PITCH,
        y: PAD_Y + topExtra + (rowOf(node.id) - minRow) * ROW + shiftBefore(rankOf(node.id)),
      });
    }
    const anchor = { x: X0 + baseRank * PITCH, y: PAD_Y + topExtra + (baseRow - minRow) * ROW + shiftBefore(baseRank) };
    const box = boundingFrame([...positions.values()], anchor);
    const nodes: PlacedNode[] = subgraph.nodes.map((node) => {
      const p = positions.get(node.id)!;
      return {
        id: node.id, kind: node.kind, x: p.x, y: p.y, rank: rankOf(node.id), row: rowOf(node.id),
        state: stateOf(node.id), caption: node.caption, current: node.id === facts?.currentNode,
        waitedForSlot: waitedForSlotOf(node.id), revised: revisedOf(node.id),
        frame: frameId, ...wordsOf(node),
      };
    });
    const localLevels = revisitLevels(subgraph.edges, (id) => localRank.get(id) ?? 0);
    const localTop = Math.min(...[...positions.values()].map((p) => p.y)) - NODE / 2;
    const edges: PlacedEdge[] = subgraph.edges.map((edge) => {
      const from = positions.get(edge.from)!;
      const to = positions.get(edge.to)!;
      const level = localLevels.get(edge);
      return classifyEdge(edge, from.x, from.y, to.x, to.y, generation, litOf(edge.from), localHang.has(edge.to),
        level === undefined ? undefined : arcApexAbove(localTop, level));
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
    // The spine must clear the open frame's own bottom edge, not just grow by the frame's height: the
    // frame hangs 1.2 rows below its anchor explore node, which can already sit several rows above the
    // spine's own deepest row (`maxRow`), so `placed.box.height + 24` alone under-shifts and the spine
    // lands inside the frame (verified on a shipped Pack whose entry explore node opens a loop). The
    // needed shift is the frame's own bottom (`box.y + box.height`, plus the same 24px
    // clearance) measured against where the spine's own deepest row would otherwise sit
    // (`PAD_Y + (maxRow - minRow) * ROW`) — clamped to never go negative, since a frame that already
    // sits above the spine's own bottom needs no extra shift at all.
    const spineBottom = PAD_Y + topExtra + (maxRow - minRow) * ROW + stretchAt(maxRow);
    const frameBottom = placed.box.y + placed.box.height + 24;
    const extra = Math.max(0, frameBottom - spineBottom);
    loopShift.push({ exploreRank, extra });
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
      current: node.id === facts?.currentNode,
      waitedForSlot: waitedForSlotOf(node.id), revised: revisedOf(node.id), ...wordsOf(node),
      ...(checklists ? { wide: true as const } : {}),
    };
  });
  const finalPosition = new Map(mainNodes.map((node) => [node.id, { x: node.x, y: node.y }]));

  const mainTop = mainNodes.length > 0 ? Math.min(...mainNodes.map((node) => node.y)) - NODE / 2 : PAD_Y - NODE / 2;
  const mainEdges: PlacedEdge[] = graph.edges.map((edge) => {
    const from = finalPosition.get(edge.from) ?? { x: pass1X.get(edge.from) ?? X0, y: pass1Y.get(edge.from) ?? PAD_Y };
    const to = finalPosition.get(edge.to) ?? { x: pass1X.get(edge.to) ?? X0, y: pass1Y.get(edge.to) ?? PAD_Y };
    const level = mainLevels.get(edge);
    const placed = classifyEdge(edge, from.x, from.y, to.x, to.y, facts?.generation, litOf(edge.from), hang.has(edge.to),
      level === undefined ? undefined : arcApexAbove(mainTop, level));
    // Lanes above a checklist spine: an edge up into a lane leaves its source's top and turns into
    // the target's side; an edge down out of a lane leaves its source's side and drops into the
    // target's top. Neither runs below the spine, where the checklists are.
    if (!checklists) return placed;
    if (placed.kind === 'revisit') {
      // Over every lane and round the left: up from the source's top to a track above the highest
      // lane, back across, down left of the target and into its left side — clear of the fork's
      // edges rising from the target's top, and of every lane between.
      const apex = Math.max(12, mainTop - 40);
      const left = to.x - NODE / 2 - 22;
      return { ...placed, path: roundedPath([{ x: from.x, y: from.y - NODE / 2 }, { x: from.x, y: apex }, { x: left, y: apex }, { x: left, y: to.y }, { x: to.x - NODE / 2, y: to.y }]),
        ...(placed.badge === undefined ? {} : { badge: { ...placed.badge, x: (from.x + left) / 2, y: apex } }) };
    }
    if (from.y === to.y || to.x <= from.x) return placed;
    const kindOf = (id: string) => graph.nodes.find((node) => node.id === id)?.kind;
    if (kindOf(edge.to) === 'wait') return placed;
    const path = to.y < from.y
      ? roundedPath([{ x: from.x + 10, y: from.y - NODE / 2 }, { x: from.x + 10, y: to.y }, { x: to.x - NODE / 2, y: to.y }])
      : roundedPath([{ x: from.x + NODE / 2, y: from.y }, { x: to.x, y: from.y }, { x: to.x, y: to.y - NODE / 2 }]);
    return { ...placed, path };
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
  // 1.5 pitches past the last main-spine rank, not 1: a full pitch left no room between the last
  // node's own caption and the Goal's own label — "next-period" running straight into "clock period
  // at m…" (PLS design review) — and a node's caption already reads to the right of its own shape,
  // so the roundel needs the extra half-pitch of clearance a bare node-to-node gap does not.
  // At the wide pitch one full rank already clears the last node's own words.
  const goal = { x: X0 + maxRank * pitch + (checklists ? pitch : 1.5 * PITCH), y: PAD_Y + topExtra - minRow * ROW + stretchAt(0) + shiftBefore(maxRank + 1) };
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
  const allEdges = [...mainEdges, ...loopEdges, ...growthEdges];
  const lowestTrack = routeEdges(allEdges, allNodes);
  // The lowest node's own labels still need their room below it, and a routed edge's track can run
  // below the lowest node — the scene keeps a margin past whichever reaches further.
  // A merged step's checklist or an AI node's activity lines can reach below the lowest row's margin.
  const height = Math.max((maxRow - minRow + 1) * ROW + 2 * PAD_Y + openFrameExtra + topExtra + stretchAt(maxRow), lowestTrack + PAD_Y,
    ...allNodes.map((node) => node.y + footBottomOf(node) + 16));

  return {
    width, height, goal, pitch,
    nodes: allNodes,
    edges: allEdges,
    frames: allFrames,
  };
}

/** Where a scene sits at a given scale: centred (both axes) when it fits inside the viewport at that
 * scale, else pinned toward the 16px left gutter (top clamped to never go negative). Shared by
 * `fitToWidth` and any caller that clamps `fitToWidth`'s own scale after the fact (`canvas-fit`'s
 * 0.15 floor, below) — a clamped scale must still resolve `tx`/`ty` by this same rule, not by the
 * offsets `fitToWidth` computed for its own, larger, unclamped scale.
 *
 * The left gutter is a ceiling on `tx`, not a fixed value: `fitToWidth`'s own scale is always chosen
 * so the fitted scene already clears a full 32px of gutter (`scene.width * scale <= viewport.width -
 * 32`), so `tx` never needs to go below 16 there. A scale some caller clamped *up* past what
 * `fitToWidth` would have chosen (`canvas-fit`'s floor, when the natural fit is narrower than 0.15
 * allows) can land the fitted scene wider than the viewport by a few px — flat 16px would then push
 * the far edge (the Goal roundel, past every node's own right margin) off the visible canvas. `tx` is
 * pulled in below 16, however far it takes, to keep that edge on-screen instead. */
export function centerAt(scene: CanvasScene, viewport: { width: number; height: number }, scale: number): { tx: number; ty: number } {
  const fitted = scene.width * scale;
  const tx = fitted < viewport.width ? (viewport.width - fitted) / 2 : Math.min(16, viewport.width - fitted);
  return { tx, ty: Math.max(16, (viewport.height - scene.height * scale) / 2) };
}

/** Rule 10: fit the scene's width into a viewport, centring it vertically (never above 16px from the
 * top) and never scaling up past 1. C12: a scene narrower than the viewport at its own fitted scale
 * (`scene.width * scale < viewport.width`) is also centred horizontally, rather than left flush
 * against the 16px gutter — the gutter is a floor for a scene that fills or overflows the viewport,
 * not a fixed left margin for one that does not. */
export function fitToWidth(scene: CanvasScene, viewport: { width: number; height: number }): { scale: number; tx: number; ty: number } {
  const scale = Math.min(1, (viewport.width - 32) / scene.width);
  return { scale, ...centerAt(scene, viewport, scale) };
}

/** The mockup's floor for reading a node's caption or an edge's chip: below 60% zoom, a label is
 * dropped rather than drawn too small to read (the Global Constraints' 12px/13px type floor). */
export const labelsVisibleAt = (scale: number): boolean => scale >= 0.6;
