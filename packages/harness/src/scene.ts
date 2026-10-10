// The Campaign tab's own adapter: turns a HimaFabric reference graph plus a `RunView` and an
// `ExecutionContext` into `canvas-layout.ts`'s inputs — a `LayoutGraph` and its `LayoutFacts`. This
// is the one seam between what the Host answers and what `FabricCanvas` draws: nothing here computes
// a coordinate (`layoutCanvas` alone does that), and nothing here special-cases a Pack — every word
// on a node comes from `nodeCaption` (`./card-labels.ts`), which reads the node's own declared
// parameters and nothing else.
//
// A pure host-side module, like `canvas-layout.ts` beside it — not a client file. Task 5 first placed
// this under `client/`, which meant its own value import of `nodeCaption` could not resolve under
// Node's own module loader (only esbuild's client bundle resolves a `.js`-suffixed relative import to
// a sibling `.ts` file the way `moduleResolution: NodeNext` expects), so testing `sceneInputs` at L1
// needed a `tsconfig.json` `"files"` entry to force it through the host build too. Moving the file
// here removes that entirely: it is compiled and exported exactly like `canvas-layout.ts`, and the
// client (`client/CampaignTab.tsx`) imports it as `'../scene.js'`.
//
// `reference` takes either shape a caller may hold: the full `PackGraph` `ExecutionContext.method`
// carries once a Run has started (loops, `opens`, every node's own parameters), or the smaller
// `PreparationView.referenceGraph` a proposal answers before one has (no loops, no parameters, so no
// captions — a scene of bare shapes is still a scene). The two are told apart by `'loops' in
// reference`, which is true of every `PackGraph` (`loops` always present, even empty) and false of
// `PreparationView.referenceGraph` (which never declares the field at all).
import type { GroupMember, LayoutEdge, LayoutFacts, LayoutGraph, LayoutNode, LayoutSubgraph, NodeVisualState } from './canvas-layout.js';
import { nodeCaption } from './card-labels.js';
import type { ExecutionContext } from './fabric.js';
import type { PackEdge, PackGraph, PackNode } from './packs.js';
import type { RunView } from './remote.js';
import type { PreparationView } from './workbench.js';

/** The smaller shape a proposal answers before a Run exists: plain ids and kinds, no parameters. */
type BareGraph = PreparationView['referenceGraph'];
type BareNode = BareGraph['nodes'][number];
type BareEdge = BareGraph['edges'][number];

const isFullGraph = (reference: BareGraph | PackGraph): reference is PackGraph => 'loops' in reference;

/** The Pack's own display words for a node, when it declared any (`label`, `about`). */
const wordsOf = (node: BareNode | PackNode): Pick<LayoutNode, 'label' | 'about'> => {
  const words = node as { readonly label?: string; readonly about?: string };
  return { ...(words.label === undefined ? {} : { label: words.label }), ...(words.about === undefined ? {} : { about: words.about }) };
};

/** A node with declared parameters carries a caption; a bare one (no parameters at all) carries none.
 *  Either carries the Pack's own display words when it declared them. */
function layoutNode(node: BareNode | PackNode): LayoutNode {
  if (!('parameters' in node)) return { id: node.id, kind: node.kind as LayoutNode['kind'], ...wordsOf(node) };
  const caption = nodeCaption(node);
  return caption === undefined ? { id: node.id, kind: node.kind, ...wordsOf(node) } : { id: node.id, kind: node.kind, caption, ...wordsOf(node) };
}

/** The contract tools an AI agent works through (`outsourcing`), by id. */
type ContractTools = NonNullable<ExecutionContext['method']>['contract']['tools'];
const aiToolsOf = (tools: ContractTools | undefined): ReadonlySet<string> =>
  new Set((tools ?? []).filter((tool) => tool.outsourcing !== undefined).map((tool) => tool.id));

/** Marks every act node whose tool is one an AI agent works through: same square, its own look. */
function withAiMarks(nodes: readonly LayoutNode[], packNodes: readonly PackNode[], aiTools: ReadonlySet<string>): readonly LayoutNode[] {
  if (aiTools.size === 0) return nodes;
  const ai = new Set(packNodes.filter((node) => node.kind === 'act' && node.parameters.tool !== undefined && aiTools.has(node.parameters.tool)).map((node) => node.id));
  return ai.size === 0 ? nodes : nodes.map((node) => (ai.has(node.id) ? { ...node, ai: true as const } : node));
}

/** One merged step: a labelled autopilot segment's nodes, drawn as one node with a checklist. */
interface SegmentGroup { readonly id: string; readonly label: string; readonly about?: string; readonly members: readonly string[] }

/**
 * Every labelled segment of the graph's autopilot, as one merged step. A segment's nodes are those
 * the Harness's own `segmentNodes` (`packs.ts`, host-only) walks: every node reachable from `from`
 * along non-revisit edges, never crossing an `until` node and never past a fork node (an act node
 * with two or more unlabelled edges out — a fork's own declaration drives its branches). A segment
 * with no `label` stays as it was, node by node; a fork entry is never merged; a node an earlier
 * group already holds is never held twice.
 */
function segmentGroups(reference: PackGraph): readonly SegmentGroup[] {
  const byId = new Map(reference.nodes.map((node) => [node.id, node]));
  const isFork = (node: PackNode) => node.kind === 'act' && reference.edges.filter((edge) => edge.from === node.id && edge.outcome === undefined).length >= 2;
  const claimed = new Set<string>();
  const groups: SegmentGroup[] = [];
  for (const declared of reference.autopilot ?? []) {
    if ('fork' in declared || declared.label === undefined) continue;
    const until = new Set(declared.until);
    const members: string[] = [];
    const seen = new Set<string>();
    const walk: string[] = [...declared.from];
    for (let at = walk.shift(); at !== undefined; at = walk.shift()) {
      if (seen.has(at) || until.has(at)) continue;
      seen.add(at);
      const node = byId.get(at);
      if (node === undefined) continue;
      if (!claimed.has(at)) members.push(at);
      if (isFork(node)) continue;
      for (const edge of reference.edges) if (edge.from === at && edge.revisit !== true) walk.push(edge.to);
    }
    if (members.length === 0) continue;
    for (const id of members) claimed.add(id);
    groups.push({ id: `seg:${members[0]!}`, label: declared.label, ...(declared.about === undefined ? {} : { about: declared.about }), members });
  }
  return groups;
}

/** A merged step's own state, folded from its members': running while any runs, done once all are,
 *  blocked when any failed, otherwise waiting (available when the Run may begin a member next). */
function foldState(states: readonly NodeVisualState[]): NodeVisualState {
  if (states.some((state) => state === 'running' || state === 'retrying' || state === 'waiting-for-slot')) return 'running';
  if (states.length > 0 && states.every((state) => state === 'done' || state === 'reconciled')) return 'done';
  if (states.some((state) => state === 'blocked' || state === 'cancelled')) return 'blocked';
  return states.some((state) => state === 'available') ? 'available' : 'pending';
}

/**
 * The graph and facts with every labelled segment collapsed into its one merged node: the members
 * leave the node list (the group takes the first member's place), an edge inside the group is
 * dropped, an edge crossing its boundary is redrawn to or from the group, and every fact naming a
 * member names the group instead. The group's checklist lists its members, in segment order, with
 * their own words and states.
 */
function collapseSegments(graph: LayoutGraph, facts: LayoutFacts, groups: readonly SegmentGroup[], packNodes: readonly PackNode[]): { graph: LayoutGraph; facts: LayoutFacts } {
  if (groups.length === 0) return { graph, facts };
  const groupOf = new Map<string, SegmentGroup>();
  for (const group of groups) for (const id of group.members) groupOf.set(id, group);
  const to = (id: string) => groupOf.get(id)?.id ?? id;
  const stateOf = (id: string): NodeVisualState => facts.states?.[id] ?? (facts.available?.includes(id) ? 'available' : 'pending');
  const byId = new Map(packNodes.map((node) => [node.id, node]));

  const states: Record<string, NodeVisualState> = {};
  for (const [id, state] of Object.entries(facts.states ?? {})) if (!groupOf.has(id)) states[id] = state;
  const nodes: LayoutNode[] = [];
  for (const node of graph.nodes) {
    const group = groupOf.get(node.id);
    if (group === undefined) { nodes.push(node); continue; }
    if (group.members[0] !== node.id) continue;
    const members: GroupMember[] = group.members.map((id) => {
      const words = byId.get(id) === undefined ? {} : wordsOf(byId.get(id)!);
      return { id, ...words, state: stateOf(id) };
    });
    states[group.id] = foldState(members.map((member) => member.state));
    nodes.push({ id: group.id, kind: 'act', label: group.label, ...(group.about === undefined ? {} : { about: group.about }), members });
  }
  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = to(edge.from), target = to(edge.to);
    if (from === target && (groupOf.has(edge.from) || groupOf.has(edge.to))) continue;
    const key = `${from}>${target}>${edge.outcome ?? ''}>${edge.revisit === true ? 'r' : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(from === edge.from && target === edge.to ? edge : { ...edge, from, to: target });
  }
  // A wait node is drawn on a graph with merged steps only once the Run has been there: until then
  // the blocked path is implied, and its edges would only cut across the checklists.
  const unvisited = new Set(nodes.filter((node) => node.kind === 'wait' && states[node.id] === undefined && facts.currentNode !== node.id).map((node) => node.id));
  if (unvisited.size > 0) {
    nodes.splice(0, nodes.length, ...nodes.filter((node) => !unvisited.has(node.id)));
    edges.splice(0, edges.length, ...edges.filter((edge) => !unvisited.has(edge.from) && !unvisited.has(edge.to)));
  }
  const unique = (ids: readonly string[]) => [...new Set(ids.map(to))];
  const opens = graph.opens === undefined ? undefined : Object.fromEntries(Object.entries(graph.opens).map(([id, loop]) => [to(id), loop]));
  const collapsed: LayoutGraph = { ...graph, entry: to(graph.entry), nodes, edges, ...(opens === undefined ? {} : { opens }) };
  const next: LayoutFacts = {
    ...facts,
    states,
    ...(facts.available === undefined ? {} : { available: unique(facts.available) }),
    ...(facts.currentNode === undefined ? {} : { currentNode: to(facts.currentNode) }),
    ...(facts.waitedForSlot === undefined ? {} : { waitedForSlot: unique(facts.waitedForSlot) }),
    ...(facts.fork === undefined ? {} : { fork: { node: to(facts.fork.node), join: to(facts.fork.join), branches: facts.fork.branches.map((branch) => ({ id: branch.id, nodes: unique(branch.nodes) })) } }),
    ...(facts.growths === undefined ? {} : { growths: facts.growths.map((growth) => ({ ...growth, parentNode: to(growth.parentNode), returnNode: to(growth.returnNode) })) }),
    ...(facts.revisions === undefined ? {} : { revisions: facts.revisions.map((revision) => ({ changedNodes: unique(revision.changedNodes), affectedNodes: unique(revision.affectedNodes) })) }),
  };
  return { graph: collapsed, facts: next };
}

const layoutEdge = (edge: BareEdge | PackEdge): LayoutEdge => ({
  from: edge.from, to: edge.to,
  ...(edge.outcome === undefined ? {} : { outcome: edge.outcome }),
  ...(edge.revisit === true ? { revisit: true as const } : {}),
});

const layoutSubgraph = (entry: string, nodes: readonly (BareNode | PackNode)[], edges: readonly (BareEdge | PackEdge)[]): LayoutSubgraph =>
  ({ entry, nodes: nodes.map(layoutNode), edges: edges.map(layoutEdge) });

/** Every explore node that opens a Loop, by its own id — `PackGraph` states this on the node's own
 *  parameters (`opens`), not as a graph-level table, so this module builds the table `LayoutGraph`
 *  wants once rather than asking every reader to walk the nodes again. */
function opensOf(nodes: readonly PackNode[]): Record<string, string> {
  const opens: Record<string, string> = {};
  for (const node of nodes) if (node.kind === 'explore' && node.parameters.opens !== undefined) opens[node.id] = node.parameters.opens;
  return opens;
}

/** Every node id the reference graph or one of its Loops already names — what tells `growthsOf`
 *  which of `ExecutionContext.nodes` are the growth's own added nodes rather than the method's. */
function referenceIds(graph: LayoutGraph): Set<string> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  for (const loop of Object.values(graph.loops ?? {})) for (const node of loop.nodes) ids.add(node.id);
  return ids;
}

/**
 * The latest accepted growth's own added nodes, in the order `ExecutionContext.nodes` lists them,
 * chained into a straight line of edges — and only the latest one, never every accepted growth at
 * once.
 *
 * `ExecutionContext` carries no edge of its own for a growth's interior, and no attribution of which
 * added node belongs to which growth when more than one has been accepted on this Run: it answers
 * `entry`/`parentNode`/`returnNode` per `GrowthView`, and a single flat `nodes` list of every node
 * added by *any* accepted growth. Giving every accepted growth that same flat list — this module's
 * first attempt — drew every growth's frame around the same nodes, which is worse than drawing one
 * frame correctly. HimaFabric drives one growth at a time (`activeGrowth`), so the added nodes belong
 * to the *latest* accepted growth; this draws that one and only that one, leaving an earlier accepted
 * growth undrawn until the Host attributes nodes per growth (a change outside this module's own file).
 */
function growthsOf(context: ExecutionContext | undefined, graph: LayoutGraph): NonNullable<LayoutFacts['growths']> {
  if (context?.growths === undefined || context.nodes === undefined) return [];
  const accepted = context.growths.filter((growth) => growth.event === 'accepted' && growth.parentNode !== undefined && growth.returnNode !== undefined);
  if (accepted.length === 0) return [];
  const latest = accepted[accepted.length - 1]!;
  const known = referenceIds(graph);
  const added = context.nodes.filter((node) => !known.has(node.id));
  if (added.length === 0) return [];
  const edges: LayoutEdge[] = [];
  for (let i = 0; i < added.length - 1; i += 1) edges.push({ from: added[i]!.id, to: added[i + 1]!.id });
  const subgraph: LayoutSubgraph = { entry: latest.entry ?? added[0]!.id, nodes: added.map(layoutNode), edges };
  return [{ proposalId: latest.proposalId, parentNode: latest.parentNode!, returnNode: latest.returnNode!, graph: subgraph }];
}

/**
 * The fork the Run is standing inside, while it is standing inside one, as `layoutCanvas`'s own
 * `facts.fork` wants it: which node branched, which judge node the branches converge into, and every
 * branch's own id with every node it actually ran — not only where each branch stands right now.
 *
 * `view.run.fork` (the ledger's `RunFork`) answers only the second of those: `branches` is keyed by
 * branch id and holds each branch's *current* node, not its whole chain. The chain already exists,
 * folded once, on `GenerationView.branches` (`BranchView.nodes`, every `NodeView` the fold walked for
 * that branch) — the same rows the Evidence view's generations table already reads. The fork Run.fork
 * names is always the latest generation's, so that generation's own `branches` are the ones this
 * reads; a Run that forked in an earlier, now-closed generation carries no `run.fork` at all and this
 * returns `undefined`, exactly as `layoutCanvas`'s own "absent facts.fork" (auto-detect) path expects.
 */
function forkOf(view: RunView): LayoutFacts['fork'] {
  const fork = view.run.fork;
  if (fork === undefined) return undefined;
  const branches = (view.generations.at(-1)?.branches ?? []).map((branch) => ({ id: branch.id, nodes: branch.nodes.map((node) => node.nodeId) }));
  if (branches.length === 0) return undefined;
  return { node: fork.from, join: fork.join, branches };
}

/**
 * The mockup's own placement for a branch's name: not a separate label floating near the fork's
 * incoming edge, but riding the branch's own first node's second caption line — "the branch id sits
 * under the branch's first node name". A node the branch's own reference graph already captions
 * (a tool, a chooser) keeps that caption and appends the branch id (`‹caption› · ‹id›`); a bare node
 * (no caption of its own) gets `branch ‹id›` instead, so a fork branch is never unlabelled. Every
 * other node keeps its own caption untouched.
 */
function withBranchCaptions(nodes: readonly LayoutNode[], fork: LayoutFacts['fork']): readonly LayoutNode[] {
  if (fork === undefined) return nodes;
  const headBranch = new Map<string, string>();
  for (const branch of fork.branches) {
    const head = branch.nodes[0];
    if (head !== undefined && !headBranch.has(head)) headBranch.set(head, branch.id);
  }
  if (headBranch.size === 0) return nodes;
  return nodes.map((node) => {
    const branchId = headBranch.get(node.id);
    if (branchId === undefined) return node;
    return { ...node, caption: node.caption === undefined ? `branch ${branchId}` : `${node.caption} · ${branchId}` };
  });
}

/**
 * Outcome chips only where one visible check node branches. An edge into a wait node (the blocked
 * path is what the wait node's own shape says) and an edge leaving a merged step (its check is
 * inside it) carry no chip, and the parallel edges such a pair draws as one line become one edge:
 * the one that still says whether its target hangs (any edge but FAIL/UNDETERMINED, else FAIL).
 */
function quietOutcomes(scene: { graph: LayoutGraph; facts: LayoutFacts }): { graph: LayoutGraph; facts: LayoutFacts } {
  const { graph } = scene;
  const kindOf = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const merged = new Set(graph.nodes.filter((node) => node.members !== undefined).map((node) => node.id));
  const quiet = (edge: LayoutEdge) => edge.outcome !== undefined && edge.revisit !== true && (kindOf.get(edge.to) === 'wait' || merged.has(edge.from));
  if (!graph.edges.some(quiet)) return scene;
  const hangs = (edge: LayoutEdge) => edge.outcome === 'FAIL' || edge.outcome === 'UNDETERMINED';
  const edges: LayoutEdge[] = [];
  const kept = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!quiet(edge)) { edges.push(edge); continue; }
    const key = `${edge.from}>${edge.to}`;
    const at = kept.get(key);
    const chipless: LayoutEdge = { ...edge, chipless: true };
    if (at === undefined) { kept.set(key, edges.length); edges.push(chipless); continue; }
    if (hangs(edges[at]!) && !hangs(edge)) edges[at] = chipless;
  }
  return { graph: { ...graph, edges }, facts: scene.facts };
}

/**
 * The one adapter this module exists for: a HimaFabric reference graph, plus what a `RunView` and an
 * `ExecutionContext` know so far, turned into `layoutCanvas`'s own two inputs.
 *
 * `view`/`context` are both optional so a caller with only a proposal's bare graph — before any Run
 * exists — still gets a scene of pending nodes on one spine, exactly as `layoutCanvas(graph)` alone
 * does.
 */
export function sceneInputs(
  reference: BareGraph | PackGraph,
  view?: RunView,
  context?: ExecutionContext,
): { readonly graph: LayoutGraph; readonly facts: LayoutFacts } {
  const graph: LayoutGraph = isFullGraph(reference)
    ? {
        entry: reference.entry,
        nodes: reference.nodes.map(layoutNode),
        edges: reference.edges.map(layoutEdge),
        loops: Object.fromEntries(Object.entries(reference.loops).map(([name, loop]) => [name, layoutSubgraph(loop.entry, loop.nodes, loop.edges)])),
        opens: opensOf(reference.nodes),
      }
    : { entry: reference.entry, nodes: reference.nodes.map(layoutNode), edges: reference.edges.map(layoutEdge) };

  // Two Pack words for the canvas (#andes asks 4 and 5): an AI node keeps its square with its own
  // look, and a labelled autopilot segment is one merged step with a checklist.
  const packNodes = isFullGraph(reference) ? reference.nodes : [];
  const marked: LayoutGraph = { ...graph, nodes: withAiMarks(graph.nodes, packNodes, aiToolsOf(context?.method?.contract.tools)) };
  const groups = isFullGraph(reference) ? segmentGroups(reference) : [];

  if (view === undefined) return quietOutcomes(collapseSegments(marked, {}, groups, packNodes));

  const states: Record<string, NodeVisualState> = {};
  const waitedForSlot: string[] = [];
  for (const node of view.nodes) {
    states[node.nodeId] = node.state;
    if (node.waitedForSlot === true) waitedForSlot.push(node.nodeId);
  }
  const revisions = (view.revisions ?? []).map((revision) => ({ changedNodes: revision.changedNodes, affectedNodes: revision.affectedNodes }));
  const growths = growthsOf(context, marked);
  const fork = forkOf(view);

  const facts: LayoutFacts = {
    states,
    ...(context === undefined ? {} : { available: context.available }),
    ...(view.run.currentNode === undefined ? {} : { currentNode: view.run.currentNode }),
    ...(view.run.generation === undefined ? {} : { generation: view.run.generation }),
    ...(waitedForSlot.length === 0 ? {} : { waitedForSlot }),
    ...(view.run.loop === undefined ? {} : { openLoop: { id: view.run.loop.name, generation: view.run.loop.generation } }),
    ...(fork === undefined ? {} : { fork }),
    ...(growths.length === 0 ? {} : { growths }),
    ...(revisions.length === 0 ? {} : { revisions }),
  };
  const labelledGraph: LayoutGraph = fork === undefined ? marked : { ...marked, nodes: withBranchCaptions(marked.nodes, fork) };
  return quietOutcomes(collapseSegments(labelledGraph, facts, groups, packNodes));
}
