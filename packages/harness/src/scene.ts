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
import type { LayoutEdge, LayoutFacts, LayoutGraph, LayoutNode, LayoutSubgraph, NodeVisualState } from './canvas-layout.js';
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

/** A node with declared parameters carries a caption; a bare one (no parameters at all) carries none. */
function layoutNode(node: BareNode | PackNode): LayoutNode {
  if (!('parameters' in node)) return { id: node.id, kind: node.kind as LayoutNode['kind'] };
  const caption = nodeCaption(node);
  return caption === undefined ? { id: node.id, kind: node.kind } : { id: node.id, kind: node.kind, caption };
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

  if (view === undefined) return { graph, facts: {} };

  const states: Record<string, NodeVisualState> = {};
  const waitedForSlot: string[] = [];
  for (const node of view.nodes) {
    states[node.nodeId] = node.state;
    if (node.waitedForSlot === true) waitedForSlot.push(node.nodeId);
  }
  const revisions = (view.revisions ?? []).map((revision) => ({ changedNodes: revision.changedNodes, affectedNodes: revision.affectedNodes }));
  const growths = growthsOf(context, graph);
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
  return { graph, facts };
}
