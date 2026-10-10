// L1: the strip (graph.yml `view`) is a pure function of the Pack graph and the Run's facts: rounds,
// checklist lines, station states, station edges, the lit edge and the AI flag, then its placement
// in a pane 300–440 px wide. The fixture is the AndesCell Pack 0.2 strip of STRIP-SPEC.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldedSaid, layoutStrip, stripFacts, stripState, wrapWords } from '../../packages/harness/src/strip-layout.ts';
import type { StripState } from '../../packages/harness/src/strip-layout.ts';
import { bestHeadline } from '../../packages/harness/src/client/results-view.ts';
import { claimAutoOpen, autoOpened, receiptTime, shouldAutoOpen } from '../../packages/harness/src/client/run-auto-open.ts';
import type { PackContract, PackGraph } from '@hima/harness';
import type { PackResults } from '../../packages/harness/src/packs.ts';
import type { RunView } from '@hima/harness';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const act = (id: string, tool?: string) => ({ id, kind: 'act' as const, parameters: tool === undefined ? {} : { tool } });
const judge = (id: string) => ({ id, kind: 'judge' as const, parameters: {} });
const edge = (from: string, to: string, extra: { outcome?: string; revisit?: boolean } = {}) => ({ from, to, ...extra });

/** The Pack 0.2 graph as STRIP-SPEC lays it out: one round, forks at the agents, a revisit to load-timing. */
const graph = {
  id: 'andes-cell-fmax', version: '0.2.0', entry: 'bind-inputs', loops: {}, autopilot: [],
  nodes: [
    act('bind-inputs'), act('reference-build'), act('read-reference'), judge('check-reference'),
    act('load-timing'), act('read-timing'),
    act('himatime-agent', 'himatime'), act('qualib-agent', 'qualib'),
    judge('requirements-joined'), act('andescell-agent', 'andescell'), act('generate-cells'),
    act('himatime-verify', 'himatime'), act('qualib-screen', 'qualib'),
    judge('cells-verified'), act('new-library-build'), act('compare-round'), act('read-round'), judge('check-round'),
    act('read-round-goal'), judge('judge-round'), { id: 'next-round', kind: 'explore' as const, parameters: {} },
    { id: 'blocked', kind: 'wait' as const, parameters: {} },
  ],
  edges: [
    edge('bind-inputs', 'reference-build'), edge('reference-build', 'read-reference'), edge('read-reference', 'check-reference'),
    edge('check-reference', 'load-timing', { outcome: 'PASS' }), edge('check-reference', 'blocked', { outcome: 'FAIL' }),
    edge('load-timing', 'read-timing'), edge('read-timing', 'himatime-agent'), edge('read-timing', 'qualib-agent'),
    edge('himatime-agent', 'requirements-joined'), edge('qualib-agent', 'requirements-joined'),
    edge('requirements-joined', 'andescell-agent', { outcome: 'PASS' }), edge('requirements-joined', 'blocked', { outcome: 'FAIL' }),
    edge('andescell-agent', 'generate-cells'), edge('generate-cells', 'himatime-verify'), edge('generate-cells', 'qualib-screen'),
    edge('himatime-verify', 'cells-verified'), edge('qualib-screen', 'cells-verified'),
    edge('cells-verified', 'new-library-build', { outcome: 'PASS' }), edge('cells-verified', 'blocked', { outcome: 'FAIL' }),
    edge('new-library-build', 'compare-round'), edge('compare-round', 'read-round'), edge('read-round', 'check-round'),
    edge('check-round', 'read-round-goal', { outcome: 'PASS' }), edge('read-round-goal', 'judge-round'), edge('judge-round', 'next-round'),
    edge('next-round', 'load-timing', { revisit: true }),
  ],
  view: {
    stations: [
      { id: 'rtl2gds', label: 'RTL2GDS flow', row: 0, checklist: [
        { label: 'Check tools and design', nodes: ['bind-inputs'], rounds: 'first' },
        { label: 'Reference build', nodes: ['reference-build'], rounds: 'first' },
        { label: 'Reference timing clean', nodes: ['read-reference', 'check-reference'], rounds: 'first' },
        { label: 'Load into HimaTime', nodes: ['load-timing', 'read-timing'], rounds: 'all' },
        { label: 'Local gain confirmed', nodes: ['cells-verified'], rounds: 'all' },
        { label: 'Rebuild with new cells', nodes: ['new-library-build'], rounds: 'all' },
        { label: 'Compare with the reference', nodes: ['compare-round', 'read-round', 'check-round', 'read-round-goal', 'judge-round'], rounds: 'all' },
        { label: 'Next round', nodes: ['next-round'], rounds: 'all' },
      ] },
      { id: 'himatime', label: 'HimaTime agent', row: 1, checklist: [
        { label: 'Find the bottleneck, write requirements', nodes: ['himatime-agent'], rounds: 'all' },
        { label: 'Verify new cells (local gain)', nodes: ['himatime-verify'], rounds: 'all' },
      ] },
      { id: 'qualib', label: 'Qualib agent', row: 1, checklist: [
        { label: 'Check the library, write requirements', nodes: ['qualib-agent'], rounds: 'all' },
        { label: 'Screen new cells', nodes: ['qualib-screen'], rounds: 'all' },
      ] },
      { id: 'andescell', label: 'AndesCell agent', row: 2, checklist: [
        { label: 'Both requirement lists ready', nodes: ['requirements-joined'], rounds: 'all' },
        { label: 'Choose the cells', nodes: ['andescell-agent'], rounds: 'all' },
        { label: 'Generate the cells', nodes: ['generate-cells'], rounds: 'all' },
      ] },
    ],
    hidden: ['blocked'],
  },
} as unknown as PackGraph;

const tools = [
  { id: 'himatime', outsourcing: { kind: 'resident' } }, { id: 'qualib', outsourcing: { kind: 'resident' } },
  { id: 'andescell', outsourcing: { kind: 'resident' } }, { id: 'rtl2gds' },
] as unknown as PackContract['tools'];

/** The order one round walks, branch nodes tagged with their branch. */
const ROUND = ['bind-inputs', 'reference-build', 'read-reference', 'check-reference', 'load-timing', 'read-timing',
  'himatime-agent', 'qualib-agent', 'requirements-joined', 'andescell-agent', 'generate-cells', 'himatime-verify', 'qualib-screen',
  'cells-verified', 'new-library-build', 'compare-round', 'read-round', 'check-round', 'read-round-goal', 'judge-round', 'next-round'];
const BRANCHED = new Set(['himatime-agent', 'qualib-agent', 'himatime-verify', 'qualib-screen']);

let clock = Date.parse('2026-10-10T12:00:00Z');
const tick = () => new Date(clock += 1000).toISOString();
const transition = (nodeId: string, state: string) => ({ recordId: `r-${nodeId}-${String(clock)}`, at: tick(), nodeId, kind: 'act', state, attempt: 1 });

/** A generation row: `done` nodes completed in this order, `running` ones begun. */
function generation(n: number, done: readonly string[], running: readonly string[] = []) {
  const all = [...done.map((id) => transition(id, 'done')), ...running.map((id) => transition(id, 'running'))];
  const branches = [...BRANCHED].map((id) => ({ id, nodes: all.filter((t) => t.nodeId === id), jobs: [], state: 'running', verdicts: [] })).filter((b) => b.nodes.length > 0);
  return { generation: n, nodes: all.filter((t) => !BRANCHED.has(t.nodeId)), branches, verdicts: [], wallMs: 0, state: 'running', strategy: {} };
}
const upTo = (id: string) => ROUND.slice(0, ROUND.indexOf(id));

function viewOf(input: { generation?: number; status?: string; currentNode?: string; fork?: Record<string, { currentNode: string; state: string }>; rows: ReturnType<typeof generation>[] }) {
  return {
    run: {
      id: 'run-1', campaignId: 'c', siteId: 's', createdAt: '2026-10-10T12:00:00Z', status: input.status ?? 'running',
      ...(input.generation === undefined ? {} : { generation: input.generation }),
      ...(input.currentNode === undefined ? {} : { currentNode: input.currentNode }),
      ...(input.fork === undefined ? {} : { fork: { from: 'read-timing', join: 'requirements-joined', branches: input.fork } }),
    },
    generations: input.rows, nodes: [],
  } as unknown as Pick<RunView, 'run' | 'generations' | 'nodes'>;
}

const state = (view: ReturnType<typeof viewOf>, g: PackGraph = graph) => stripState(g, tools, stripFacts(view));
const station = (s: StripState, id: string) => s.stations.find((x) => x.id === id)!;
const lines = (s: StripState, id: string) => station(s, id).lines.map((line) => [line.label, line.state]);
const lit = (s: StripState) => s.edges.filter((e) => e.lit).map((e) => `${e.from}>${e.to}`).sort();

test('station edges: crossing graph edges once per station pair, down to a later row, back along the source side; hidden nodes draw none', () => {
  const s = state(viewOf({ generation: 1, currentNode: 'bind-inputs', rows: [generation(1, [])] }));
  assert.deepEqual(s.edges.map((e) => [`${e.from}>${e.to}`, e.kind, e.side ?? '']), [
    ['rtl2gds>himatime', 'down', ''], ['rtl2gds>qualib', 'down', ''],
    ['himatime>andescell', 'down', ''], ['qualib>andescell', 'down', ''],
    ['andescell>himatime', 'back', 'left'], ['andescell>qualib', 'back', 'right'],
    ['himatime>rtl2gds', 'back', 'left'], ['qualib>rtl2gds', 'back', 'right'],
  ]);
  assert.ok(!s.edges.some((e) => e.from === 'blocked' || e.to === 'blocked'));
  assert.deepEqual(s.stations.map((x) => [x.id, x.row, x.col, x.span]), [['rtl2gds', 0, 0, 2], ['himatime', 1, 0, 1], ['qualib', 1, 1, 1], ['andescell', 2, 0, 2]]);
});

test('the AI flag marks every station holding an outsourced tool node, and names its current AI node', () => {
  const s = state(viewOf({ generation: 1, currentNode: 'requirements-joined', fork: { 'himatime-agent': { currentNode: 'himatime-agent', state: 'running' }, 'qualib-agent': { currentNode: 'qualib-agent', state: 'running' } },
    rows: [generation(1, upTo('himatime-agent'), ['himatime-agent', 'qualib-agent'])] }));
  assert.deepEqual(s.stations.map((x) => [x.id, x.ai]), [['rtl2gds', false], ['himatime', true], ['qualib', true], ['andescell', true]]);
  assert.equal(station(s, 'himatime').activeNode, 'himatime-agent');
  assert.equal(station(s, 'andescell').activeNode, undefined);
});

test('round 1 baseline: done, active and pending lines; the station working is active; nothing is lit yet', () => {
  const s = state(viewOf({ generation: 1, currentNode: 'reference-build', rows: [generation(1, ['bind-inputs'], ['reference-build'])] }));
  assert.equal(s.round, 1);
  assert.deepEqual(lines(s, 'rtl2gds').slice(0, 4), [['Check tools and design', 'done'], ['Reference build', 'active'], ['Reference timing clean', 'pending'], ['Load into HimaTime', 'pending']]);
  assert.equal(station(s, 'rtl2gds').state, 'active');
  assert.equal(station(s, 'himatime').state, 'waiting');
  assert.deepEqual(lit(s), []);
});

test('the propose fork: both agents are current (not the join the run row names) and both edges out of RTL2GDS light', () => {
  const s = state(viewOf({ generation: 1, currentNode: 'requirements-joined', fork: { 'himatime-agent': { currentNode: 'himatime-agent', state: 'running' }, 'qualib-agent': { currentNode: 'qualib-agent', state: 'running' } },
    rows: [generation(1, upTo('himatime-agent'), ['himatime-agent', 'qualib-agent'])] }));
  assert.deepEqual(s.stations.map((x) => [x.id, x.state]), [['rtl2gds', 'waiting'], ['himatime', 'active'], ['qualib', 'active'], ['andescell', 'waiting']]);
  assert.deepEqual(lit(s), ['rtl2gds>himatime', 'rtl2gds>qualib']);
  // A branch that reached the join stops being current; the other keeps its lit edge.
  const half = state(viewOf({ generation: 1, currentNode: 'requirements-joined', fork: { 'himatime-agent': { currentNode: 'requirements-joined', state: 'done' }, 'qualib-agent': { currentNode: 'qualib-agent', state: 'running' } },
    rows: [generation(1, [...upTo('himatime-agent'), 'himatime-agent'], ['qualib-agent'])] }));
  assert.deepEqual(lit(half), ['rtl2gds>qualib']);
  assert.equal(station(half, 'himatime').state, 'waiting', 'a half-done station waits for its later line');
});

test('the join: AndesCell is entered from both agents, so both edges into it light', () => {
  const s = state(viewOf({ generation: 1, currentNode: 'andescell-agent', rows: [generation(1, upTo('andescell-agent'), ['andescell-agent'])] }));
  assert.equal(station(s, 'andescell').state, 'active');
  assert.equal(station(s, 'andescell').activeNode, 'andescell-agent');
  assert.deepEqual(lines(s, 'andescell'), [['Both requirement lists ready', 'done'], ['Choose the cells', 'active'], ['Generate the cells', 'pending']]);
  assert.deepEqual(lit(s), ['himatime>andescell', 'qualib>andescell']);
});

test('verify: the back edges from AndesCell light, not the earlier edge from RTL2GDS into the same agents', () => {
  const s = state(viewOf({ generation: 1, currentNode: 'cells-verified', fork: { 'himatime-verify': { currentNode: 'himatime-verify', state: 'running' }, 'qualib-screen': { currentNode: 'qualib-screen', state: 'running' } },
    rows: [generation(1, upTo('himatime-verify'), ['himatime-verify', 'qualib-screen'])] }));
  assert.deepEqual(lit(s), ['andescell>himatime', 'andescell>qualib']);
  assert.deepEqual(lines(s, 'himatime'), [['Find the bottleneck, write requirements', 'done'], ['Verify new cells (local gain)', 'active']]);
  assert.equal(station(s, 'andescell').state, 'done');
});

test('rebuild: both back edges into RTL2GDS light while the rebuild and its checks run', () => {
  const rebuild = state(viewOf({ generation: 1, currentNode: 'new-library-build', rows: [generation(1, upTo('new-library-build'), ['new-library-build'])] }));
  assert.deepEqual(lit(rebuild), ['himatime>rtl2gds', 'qualib>rtl2gds']);
  assert.deepEqual(lines(rebuild, 'rtl2gds').slice(4, 6), [['Local gain confirmed', 'done'], ['Rebuild with new cells', 'active']]);
  const checks = state(viewOf({ generation: 1, currentNode: 'judge-round', rows: [generation(1, upTo('judge-round'), ['judge-round'])] }));
  assert.deepEqual(lit(checks), ['himatime>rtl2gds', 'qualib>rtl2gds']);
  assert.deepEqual(lines(checks, 'rtl2gds')[6], ['Compare with the reference', 'active']);
});

test('a revisit traversal opens round 2: first-round lines hide, every tick starts again, nothing is lit across the revisit', () => {
  const s = state(viewOf({ generation: 2, currentNode: 'load-timing', rows: [generation(1, ROUND), generation(2, [], ['load-timing'])] }));
  assert.equal(s.round, 2);
  assert.deepEqual(lines(s, 'rtl2gds'), [
    ['Check tools and design', 'hidden'], ['Reference build', 'hidden'], ['Reference timing clean', 'hidden'],
    ['Load into HimaTime', 'active'], ['Local gain confirmed', 'pending'], ['Rebuild with new cells', 'pending'],
    ['Compare with the reference', 'pending'], ['Next round', 'pending'],
  ]);
  assert.deepEqual(s.stations.map((x) => x.state), ['active', 'waiting', 'waiting', 'waiting']);
  assert.deepEqual(lit(s), []);
  // The end of round 1, before the revisit: every shown line of every station is done.
  const end = state(viewOf({ generation: 1, currentNode: 'next-round', rows: [generation(1, upTo('next-round'), ['next-round'])] }));
  assert.equal(end.round, 1);
  assert.deepEqual(end.stations.map((x) => x.state), ['active', 'done', 'done', 'done']);
});

test('`later` lines show from round 2 only, `first` lines in round 1 only', () => {
  const variant = structuredClone(graph) as PackGraph & { view: NonNullable<PackGraph['view']> };
  variant.view.stations[1]!.checklist.push({ label: 'Compare with last round', nodes: ['himatime-verify'], rounds: 'later' } as never);
  variant.view.stations[1]!.checklist[1]!.nodes = ['himatime-agent'];
  const one = state(viewOf({ generation: 1, currentNode: 'bind-inputs', rows: [generation(1, [])] }), variant);
  const two = state(viewOf({ generation: 2, currentNode: 'load-timing', rows: [generation(1, ROUND), generation(2, [], ['load-timing'])] }), variant);
  assert.equal(station(one, 'himatime').lines[2]!.state, 'hidden');
  assert.equal(station(two, 'himatime').lines[2]!.state, 'pending');
  assert.equal(station(one, 'rtl2gds').lines[0]!.state, 'active');
  assert.equal(station(two, 'rtl2gds').lines[0]!.state, 'hidden');
});

test('goal met: an ended Run works on nothing; every station of its last round is done', () => {
  const s = state(viewOf({ generation: 3, status: 'ended-goal-met', currentNode: 'next-round', rows: [generation(1, ROUND), generation(2, ROUND.slice(4)), generation(3, ROUND.slice(4))] }));
  assert.equal(s.round, 3);
  assert.deepEqual(s.stations.map((x) => x.state), ['done', 'done', 'done', 'done']);
  assert.deepEqual(lit(s), []);
});

test('a Run with no generation rows yet reads its node list as round 1', () => {
  const view = { run: { id: 'r', campaignId: 'c', siteId: 's', createdAt: '', status: 'running', currentNode: 'reference-build' }, generations: [],
    nodes: [transition('bind-inputs', 'done'), transition('reference-build', 'running')] } as unknown as Pick<RunView, 'run' | 'generations' | 'nodes'>;
  const facts = stripFacts(view);
  assert.equal(facts.round, 1);
  assert.deepEqual(facts.current, ['reference-build']);
  assert.equal(stripState(graph, tools, facts).stations[0]!.lines[0]!.state, 'done');
});

/** Every state the recording shows, for the placement checks. */
const SHOWN = () => [
  viewOf({ generation: 1, currentNode: 'reference-build', rows: [generation(1, ['bind-inputs'], ['reference-build'])] }),
  viewOf({ generation: 1, currentNode: 'requirements-joined', fork: { 'himatime-agent': { currentNode: 'himatime-agent', state: 'running' }, 'qualib-agent': { currentNode: 'qualib-agent', state: 'running' } }, rows: [generation(1, upTo('himatime-agent'), ['himatime-agent', 'qualib-agent'])] }),
  viewOf({ generation: 1, currentNode: 'andescell-agent', rows: [generation(1, upTo('andescell-agent'), ['andescell-agent'])] }),
  viewOf({ generation: 2, currentNode: 'cells-verified', fork: { 'himatime-verify': { currentNode: 'himatime-verify', state: 'running' }, 'qualib-screen': { currentNode: 'qualib-screen', state: 'running' } }, rows: [generation(1, ROUND), generation(2, upTo('himatime-verify').slice(4), ['himatime-verify', 'qualib-screen'])] }),
  viewOf({ generation: 2, currentNode: 'new-library-build', rows: [generation(1, ROUND), generation(2, upTo('new-library-build').slice(4), ['new-library-build'])] }),
  viewOf({ generation: 3, status: 'ended-goal-met', currentNode: 'next-round', rows: [generation(1, ROUND), generation(2, ROUND.slice(4)), generation(3, ROUND.slice(4))] }),
];

for (const width of [300, 320, 380, 440]) {
  test(`placement at ${String(width)} px: every box, line and lane inside the pane, rows side by side, back edges outside every station`, () => {
    for (const s of SHOWN().map((view) => state(view))) {
      const scene = layoutStrip(s, width);
      assert.equal(scene.width, width);
      for (const placed of scene.stations) {
        assert.ok(placed.left >= 0 && placed.left + placed.width <= width, `${placed.id} sits inside the pane`);
        assert.ok(placed.cx - 22 >= 0 && placed.cx + 22 <= width, `${placed.id}'s square and rings sit inside the pane`);
        for (const line of placed.placedLines) if (line.state !== 'hidden' && line.folded !== true) {
          const longest = Math.max(...line.text.map((text) => text.length));
          assert.ok(line.x >= placed.left && line.x + 15 + longest * 6.3 <= placed.left + placed.width + 0.5, `${placed.id} · ${line.label} fits its column`);
          assert.ok(line.text.length >= 1 && line.text.length <= 3);
        }
      }
      const [h, q] = [scene.stations.find((x) => x.id === 'himatime')!, scene.stations.find((x) => x.id === 'qualib')!];
      assert.equal(h.top, q.top);
      assert.ok(h.left + h.width < q.left, 'two stations on a row sit side by side without touching');
      const rtl = scene.stations.find((x) => x.id === 'rtl2gds')!, andes = scene.stations.find((x) => x.id === 'andescell')!;
      assert.ok(rtl.bottom < h.top && Math.max(h.bottom, q.bottom) < andes.top, 'rows do not overlap');
      const minLeft = Math.min(...scene.stations.map((x) => x.left)), maxRight = Math.max(...scene.stations.map((x) => x.left + x.width));
      for (const e of scene.edges) {
        const points = [...e.path.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
        assert.ok(points.every(([x, y]) => x >= 2 && x <= width - 2 && y >= 0 && y <= scene.height), `${e.from}>${e.to} stays inside the pane`);
        if (e.kind === 'back') {
          const xs = points.map(([x]) => x);
          const lane = e.side === 'left' ? Math.min(...xs) : Math.max(...xs);
          assert.ok(e.side === 'left' ? lane < minLeft : lane > maxRight, `${e.from}>${e.to} runs outside every station`);
        }
      }
      assert.ok(scene.height > andes.bottom);
      // The recording's pane body is about 380 x 690; below the header, masthead, tabs and top line
      // the strip has about 540 px, and it must show whole in every state.
      if (width >= 380) assert.ok(scene.height <= 520, `the strip fits the pane without scrolling (${String(scene.height)} px)`);
    }
  });
}

test('more than four shown lines: the leading run of done lines folds into one line that keeps the count', () => {
  const fork = layoutStrip(state(SHOWN()[1]!), 380).stations.find((x) => x.id === 'rtl2gds')!;
  const drawn = fork.placedLines.filter((line) => line.state !== 'hidden' && line.folded !== true);
  assert.equal(drawn[0]!.folds, 4);
  assert.match(drawn[0]!.text[0]!, /4 done$/);
  assert.deepEqual(drawn.slice(1).map((line) => [line.label, line.state]), [['Local gain confirmed', 'pending'], ['Rebuild with new cells', 'pending'], ['Compare with the reference', 'pending'], ['Next round', 'pending']]);
  const baseline = layoutStrip(state(SHOWN()[0]!), 380).stations.find((x) => x.id === 'rtl2gds')!;
  assert.ok(baseline.placedLines.every((line) => line.folds === undefined), 'one done line does not fold');
  const agents = layoutStrip(state(SHOWN()[3]!), 380).stations.find((x) => x.id === 'himatime')!;
  assert.ok(agents.placedLines.every((line) => line.folds === undefined), 'a station of two lines never folds');
  assert.equal(foldedSaid(['Check tools and design', 'Reference build', 'Reference timing clean', 'Load into HimaTime'], 60), 'Check tools and design … Load into HimaTime · 4 done');
  assert.equal(foldedSaid(['Check tools and design', 'Reference build', 'Reference timing clean', 'Load into HimaTime'], 30), 'Load into HimaTime · 4 done');
  assert.equal(foldedSaid(['a', 'b'], 9), '2 done');
});

test('wrapWords breaks between words into at most two lines and ellipsizes the rest', () => {
  assert.deepEqual(wrapWords('Find the bottleneck, write requirements', 20), ['Find the bottleneck,', 'write requirements']);
  assert.deepEqual(wrapWords('Short', 20), ['Short']);
  assert.equal(wrapWords('one two three four five six seven', 10).length, 2);
  assert.ok(wrapWords('one two three four five six seven', 10)[1]!.endsWith('…'));
});

test('the best headline over every round read, as the Results table prints it', () => {
  const results = { headline: { type: 'fmax_gain_pct', label: 'Fmax gain', unit: '%', better: 'higher', digits: 2 }, columns: [{ label: 'Reference', reader: 'ref' }, { label: 'Round', reader: 'round' }], rows: [{ type: 'fmax_gain_pct', label: 'Gain' }] } as unknown as PackResults;
  const reading = (generation: number, value: number) => ({ reader: { id: 'round' }, generation, values: [{ type: 'fmax_gain_pct', value }] });
  const view = { generations: [], observations: [reading(1, 2.5), reading(2, 3.4), reading(3, 3.1)] } as unknown as Pick<RunView, 'generations' | 'observations'>;
  assert.deepEqual(bestHeadline(results, view), { value: 3.4, display: '+3.40 %' });
  assert.equal(bestHeadline(results, { generations: [], observations: [] } as unknown as Pick<RunView, 'generations' | 'observations'>), undefined);
});

test('the pane opens for a Run started moments ago, once, and never for an old or ended one', () => {
  const now = Date.parse('2026-10-10T12:05:00Z');
  const base = { toolName: 'hima_run', status: 'running', now, opened: false };
  assert.equal(shouldAutoOpen({ ...base, at: now - 30_000 }), true);
  assert.equal(shouldAutoOpen({ ...base, at: now - 5 * 60_000 }), false, 'a replayed transcript of an older Run');
  assert.equal(shouldAutoOpen({ ...base, at: now - 30_000, opened: true }), false);
  assert.equal(shouldAutoOpen({ ...base, at: now - 30_000, status: 'ended-goal-met' }), false);
  assert.equal(shouldAutoOpen({ ...base, at: now - 30_000, toolName: 'hima_observe' }), false);
  assert.equal(shouldAutoOpen({ ...base, at: undefined }), false);
  assert.equal(receiptTime({ endedAt: '2026-10-10T12:04:30Z' }), Date.parse('2026-10-10T12:04:30Z'));
  assert.equal(receiptTime({ callId: 'x' }), undefined);
  assert.equal(autoOpened('run-auto-1'), false);
  assert.equal(claimAutoOpen('run-auto-1'), true);
  assert.equal(claimAutoOpen('run-auto-1'), false, 'one Run opens the pane once');
  assert.equal(autoOpened('run-auto-1'), true);
});

test('the shipped Pack 0.2 graph (a copy of packs/andes-cell-fmax/graph.yml) draws the same strip as the fixture', () => {
  const shipped = parse(readFileSync(new URL('./support/andes-cell-fmax-0.2-graph.yml', import.meta.url), 'utf8')) as PackGraph;
  const shippedTools = ['himatime-agent', 'qualib-agent', 'andescell-agent', 'himatime-verify', 'qualib-screen'].map((id) => ({ id, outsourcing: {} })) as unknown as PackContract['tools'];
  const views = [
    viewOf({ generation: 1, currentNode: 'reference-build', rows: [generation(1, ['bind-inputs'], ['reference-build'])] }),
    viewOf({ generation: 1, currentNode: 'requirements-joined', fork: { 'himatime-agent': { currentNode: 'himatime-agent', state: 'running' }, 'qualib-agent': { currentNode: 'qualib-agent', state: 'running' } }, rows: [generation(1, upTo('himatime-agent'), ['himatime-agent', 'qualib-agent'])] }),
    viewOf({ generation: 1, currentNode: 'cells-verified', fork: { 'himatime-verify': { currentNode: 'himatime-verify', state: 'running' }, 'qualib-screen': { currentNode: 'qualib-screen', state: 'running' } }, rows: [generation(1, upTo('himatime-verify'), ['himatime-verify', 'qualib-screen'])] }),
    viewOf({ generation: 2, currentNode: 'load-timing', rows: [generation(1, ROUND), generation(2, [], ['load-timing'])] }),
  ];
  for (const view of views) {
    const ours = stripState(graph, tools, stripFacts(view)), theirs = stripState(shipped, shippedTools, stripFacts(view));
    assert.deepEqual(theirs.stations.map((s) => [s.id, s.state, s.ai, s.lines.map((l) => [l.label, l.state])]), ours.stations.map((s) => [s.id, s.state, s.ai, s.lines.map((l) => [l.label, l.state])]));
    assert.deepEqual(theirs.edges, ours.edges);
  }
});
