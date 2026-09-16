// L1: the canvas layout is a pure function of the reference graph, execution facts and Run view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutCanvas, fitToWidth, labelsVisibleAt, PITCH, ROW, X0, PAD_Y } from '@hima/harness';
import type { LayoutGraph } from '@hima/harness';
import { goalSaid, sceneInputs } from '@hima/harness';
import type { RunView } from '@hima/harness';
import type { ExecutionContext } from '@hima/harness';

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
  assert.ok(arc(third).badge!.y >= 12, 'the badge stays on-canvas even when the spine arc apex is above y = 0');
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

// --- Fix-report regression tests (code review findings 1-3) -------------------------------------

test('a FAIL-hung wait node still ranks the nodes after it', () => {
  const graph: LayoutGraph = {
    entry: 'a',
    nodes: [node('a'), node('j', 'judge'), node('w', 'wait'), node('recover'), node('done')],
    edges: [
      { from: 'a', to: 'j' },
      { from: 'j', to: 'w', outcome: 'FAIL' },
      { from: 'w', to: 'recover' },
      { from: 'recover', to: 'done' },
    ],
  };
  const scene = layoutCanvas(graph);
  const recover = scene.nodes.find((n) => n.id === 'recover')!;
  const done = scene.nodes.find((n) => n.id === 'done')!;
  assert.equal(recover.rank, 2.5);
  assert.equal(done.rank, 3.5);
  assert.equal(recover.row, 0);
  const seen = new Set<string>();
  for (const placed of scene.nodes) {
    const key = `${placed.x},${placed.y}`;
    assert.ok(!seen.has(key), `two nodes share the pixels at ${key}`);
    seen.add(key);
  }
});

const loopGraph: LayoutGraph = {
  entry: 'a', nodes: [node('a'), node('dig', 'explore')], edges: [{ from: 'a', to: 'dig' }], opens: { dig: 'deeper' },
  loops: { deeper: { entry: 'd1', nodes: [node('d1'), node('d2', 'judge')], edges: [{ from: 'd1', to: 'd2' }, { from: 'd2', to: 'd1', revisit: true }] } },
};

test('an open loop widens the scene to contain its frame', () => {
  const closed = layoutCanvas(loopGraph);
  const open = layoutCanvas(loopGraph, { openLoop: { id: 'deeper', generation: 2 } });
  const frame = open.frames.find((f) => f.kind === 'loop')!;
  assert.ok(open.width >= frame.x + frame.width);
  assert.ok(open.width > closed.width);
  // Pinned by hand from rules 1, 6 and 9 (X0 = 64, PITCH = 90, NODE = 36, PAD_Y = 72):
  //   Main graph is a (rank 0) -> dig (rank 1, explore), so maxRank = 1 and the goal-based floor is
  //   goal.x + 96 = X0 + (maxRank + 1) * PITCH + 96 = 64 + 2*90 + 96 = 340 for both scenes.
  //   Closed: the collapsed frame hangs at x = dig.x (154) + PITCH/2 (45) = 199, with the fixed 120px
  //     width rule 6 gives a closed loop, so frame.x + width + 24 = 199 + 120 + 24 = 343 - wider than
  //     the 340 floor, and wider than any node's own x + NODE/2 + 24 (dig: 154+18+24=196). closed.width
  //     = max(340, 343, 106, 196) = 343.
  //   Open: the loop's own d1 (rank 1.5, x = 199) and d2 (rank 2.5, x = 289) bound a frame from
  //     199-18-24=157 to 289+18+24=331 (width 174), so frame.x + width + 24 = 157 + 174 + 24 = 355,
  //     wider than the 340 floor and every node's own x + NODE/2 + 24 (<= 331). open.width = 355.
  assert.equal(closed.width, 343);
  assert.equal(open.width, 355);
});

test("a loop's own revisit badge sits on the loop's arc", () => {
  const open = layoutCanvas(loopGraph, { openLoop: { id: 'deeper', generation: 2 } });
  const arc = open.edges.find((e) => e.kind === 'revisit')!;
  const loopFrame = open.frames.find((f) => f.kind === 'loop')!;
  assert.ok(arc.badge!.y > PAD_Y, `badge.y ${arc.badge!.y} should sit below the top margin, on the loop's own arc`);
  assert.ok(arc.badge!.y < loopFrame.y + loopFrame.height, `badge.y ${arc.badge!.y} should sit within the loop frame's vertical extent`);
});

test('sceneInputs projects a RunView and ExecutionContext onto layout facts', () => {
  const reference: LayoutGraph = { entry: 'a', nodes: [node('a'), node('b'), node('route-x'), node('route-y')],
    edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'route-x' }, { from: 'a', to: 'route-y' }] };
  const view = {
    run: { currentNode: 'b', generation: 2, fork: { from: 'a', join: 'b', branches: { x: 'route-x', y: 'route-y' } } },
    nodes: [{ nodeId: 'a', state: 'done' }, { nodeId: 'b', state: 'running' }],
    generations: [{ branches: [{ id: 'x', nodes: [{ nodeId: 'route-x' }] }, { id: 'y', nodes: [{ nodeId: 'route-y' }] }] }],
  } as unknown as RunView;
  const context = { available: ['c'] } as unknown as ExecutionContext;
  const { facts, graph } = sceneInputs(reference, view, context);
  assert.deepEqual(facts.states, { a: 'done', b: 'running' });
  assert.deepEqual(facts.available, ['c']);
  assert.equal(facts.currentNode, 'b');
  assert.equal(facts.generation, 2);
  // A fork's branch id rides the caption of its own first (bare, no caption of its own) node.
  assert.deepEqual([graph.nodes.find((n) => n.id === 'route-x')?.caption, graph.nodes.find((n) => n.id === 'route-y')?.caption], ['branch x', 'branch y']);
});

test('goalSaid states a goal in the pack\'s own words, falling back to raw names with no words', () => {
  assert.equal(goalSaid({ target_period_ns: 2.3 }, { goal: { target_period_ns: { label: 'clock period', unit: 'ns' } } } as never), 'clock period 2.3 ns');
  assert.equal(goalSaid({ target_period_ns: 2.3 }, undefined), 'target_period_ns 2.3');
});

test('a node reached only by dynamic routing (no static incoming edge, not the entry) hangs at rank 0.5 rather than landing on the entry node', () => {
  const graph: LayoutGraph = {
    entry: 'a',
    nodes: [node('a'), node('b'), node('w', 'wait')],
    edges: [{ from: 'a', to: 'b' }, { from: 'w', to: 'b' }],
  };
  const scene = layoutCanvas(graph);
  const a = scene.nodes.find((n) => n.id === 'a')!;
  const w = scene.nodes.find((n) => n.id === 'w')!;
  const b = scene.nodes.find((n) => n.id === 'b')!;
  assert.equal(w.rank, 0.5);
  assert.equal(w.row, 1);
  assert.equal(b.rank, 1.5);
  const seen = new Set<string>();
  for (const placed of scene.nodes) {
    const key = `${placed.x},${placed.y}`;
    assert.ok(!seen.has(key), `two nodes share the pixels at ${key}`);
    seen.add(key);
  }
  assert.notEqual(`${a.x},${a.y}`, `${w.x},${w.y}`, 'the entry and the dynamically-routed node must not share pixels');
});

test('two nodes hung at the same rank stack onto rows 1 and 2, in declaration order, rather than sharing pixels', () => {
  const graph: LayoutGraph = {
    entry: 'a',
    nodes: [node('a'), node('b'), node('w1', 'wait'), node('w2', 'wait')],
    edges: [{ from: 'a', to: 'b' }, { from: 'w1', to: 'b' }, { from: 'w2', to: 'b' }],
  };
  const scene = layoutCanvas(graph);
  const w1 = scene.nodes.find((n) => n.id === 'w1')!;
  const w2 = scene.nodes.find((n) => n.id === 'w2')!;
  assert.equal(w1.rank, 0.5);
  assert.equal(w2.rank, 0.5);
  assert.equal(w1.row, 1);
  assert.equal(w2.row, 2);
  const seen = new Set<string>();
  for (const placed of scene.nodes) {
    const key = `${placed.x},${placed.y}`;
    assert.ok(!seen.has(key), `two nodes share the pixels at ${key}`);
    seen.add(key);
  }
});
