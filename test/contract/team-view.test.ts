// The team view (view.yml): a Pack's display-only stations folded with a Run's task records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPack, residentActivityOf, runningTaskLabels, teamViewState } from '@hima/harness';
import type { PackContract, PackGraph, RunView } from '@hima/harness';

type DurableTaskView = NonNullable<RunView['tasks']>[number];
import { repoRoot } from './support/dsh-home.ts';

const packId = 'mage-scribe-placement';
const pack = loadPack(path.join(repoRoot, 'packs'), packId);
const round = ['engineer-place', 'review-litho-pie', 'review-metrology', 'review-alignment', 'review-wat', 'decide-round'];
const task = (taskId: string, state: string, iteration?: number, value?: unknown): DurableTaskView => ({
  taskId, projection: { state } as DurableTaskView['projection'], sourceFactIds: [],
  ...(iteration === undefined ? {} : { iterations: [{ repeatId: 'placement-rounds', iteration }] }),
  ...(value === undefined ? {} : { result: { value } as unknown as DurableTaskView['result'] }),
});
const run = (tasks: DurableTaskView[], status = 'running'): Pick<RunView, 'run' | 'tasks' | 'observations'> =>
  ({ run: { id: 'run-t', status, goal: { target_dropped_count: 18 } }, tasks, observations: [] } as unknown as Pick<RunView, 'run' | 'tasks' | 'observations'>);
const before = [task('prepare-case', 'succeeded'), task('measure-incumbent', 'succeeded', undefined, { metrics: { drops: { count: 27, lengthUm: 135113 } } })];

test('the MAGE Pack ships a team view: an Engineer, a four-member review team and a back edge for requests', () => {
  const view = pack.graph.view;
  assert.ok(view);
  assert.deepEqual(view.stations.map((s) => s.id), ['case', 'engineer', 'reviews', 'decide']);
  assert.deepEqual(view.stations[2]!.team?.map((m) => m.node), ['review-litho-pie', 'review-metrology', 'review-alignment', 'review-wat']);
  assert.ok(view.edges.some((e) => e.from === 'decide' && e.to === 'engineer' && e.back === true));
});

test('round 1, Engineer working: the Engineer station is active and AI, the edge into it is lit, members wait', () => {
  const state = teamViewState(pack.graph, pack.contract.tools, run([...before, task('engineer-place', 'running', 0)]))!;
  assert.equal(state.round, 1);
  const by = new Map(state.stations.map((s) => [s.id, s]));
  assert.equal(by.get('case')!.state, 'done');
  assert.equal(by.get('engineer')!.state, 'active');
  assert.equal(by.get('engineer')!.ai, true);
  assert.equal(by.get('engineer')!.activeNode, 'engineer-place');
  assert.deepEqual(by.get('reviews')!.team!.map((m) => [m.state, m.ai]), [['pending', true], ['pending', true], ['pending', true], ['pending', true]]);
  assert.deepEqual(state.edges.filter((e) => e.lit).map((e) => `${e.from}>${e.to}`), ['case>engineer']);
  assert.deepEqual(state.metrics.map((m) => [m.label, m.value]), [['today', '27 dropped']]);
});

test('round 2, second reviewer working: the round follows iterations, first-round lines hide, the best comes from the last decision', () => {
  const r1 = round.map((id) => task(id, 'succeeded', 0, id === 'decide-round' ? { best: { metrics: { drops: { count: 27, lengthUm: 135113 } } } }
    : { engineering: { summary: `${id} round 1` } }));
  const r2 = [task('engineer-place', 'succeeded', 1, { engineering: { summary: '13 dropped, 62,481 um' } }),
    task('review-litho-pie', 'succeeded', 1, { engineering: { summary: 'all targets placed' } }), task('review-metrology', 'running', 1)];
  const state = teamViewState(pack.graph, pack.contract.tools, run([...before, ...r1, ...r2]))!;
  assert.equal(state.round, 2);
  const by = new Map(state.stations.map((s) => [s.id, s]));
  assert.ok(by.get('case')!.lines.every((l) => l.state === 'hidden'));
  assert.equal(by.get('engineer')!.state, 'done');
  assert.equal(by.get('engineer')!.summary, '13 dropped, 62,481 um');
  assert.deepEqual(by.get('reviews')!.team!.map((m) => m.state), ['done', 'active', 'pending', 'pending']);
  assert.equal(by.get('reviews')!.team![0]!.summary, 'all targets placed');
  assert.equal(by.get('decide')!.state, 'waiting');
  assert.deepEqual(state.edges.filter((e) => e.lit).map((e) => `${e.from}>${e.to}`), ['engineer>reviews']);
  assert.deepEqual(state.metrics.map((m) => [m.label, m.value, m.goal]), [['today', '27 dropped', undefined], ['best', '27 dropped', '18 dropped'], ['length', '135,113 µm', undefined]]);
});

test('an ended Run lights nothing and works on nothing', () => {
  const state = teamViewState(pack.graph, pack.contract.tools, run([...before, task('engineer-place', 'running', 0)], 'ended-goal-met'))!;
  assert.ok(state.edges.every((e) => !e.lit));
  assert.ok(state.stations.every((s) => s.state !== 'active' && s.activeNode === undefined));
});

test('a view that names a node the graph does not have is refused, naming view.yml', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'team-view-'));
  try {
    cpSync(path.join(repoRoot, 'packs', packId), path.join(dir, packId), { recursive: true });
    writeFileSync(path.join(dir, packId, 'view.yml'), 'stations:\n  - id: a\n    label: A\n    checklist:\n      - { label: x, nodes: [no-such-node] }\n');
    assert.throws(() => loadPack(dir, packId), /view\.yml station "a" names "no-such-node"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('schema: the MAGE view parses as declared edges and node metrics, so the team layout is unchanged', () => {
  const view = pack.graph.view!;
  // `edges` is declared, so edges stand as written and the layout does not derive them.
  assert.equal(view.deriveEdges, false);
  // `hidden` defaults to an empty list; MAGE leaves nodes off the view without a coverage rule.
  assert.deepEqual(view.hidden, []);
  // Every MAGE metric reads a node's committed output, so each is a node metric.
  assert.deepEqual(view.metrics.map((m) => m.kind), ['node', 'node', 'node']);
});

test('a working agent carries its live activity; a malformed activity is dropped, never an error', () => {
  const activity = { toolCalls: 4, planDone: 1, planTotal: 3, latest: { kind: 'execute', title: 'python3 mage_placement_cli.py mage-round', at: '2026-10-13T08:00:00Z' } };
  assert.deepEqual(residentActivityOf(activity), activity);
  assert.equal(residentActivityOf({ toolCalls: -1, planDone: 0, planTotal: 0 }), undefined);
  assert.equal(residentActivityOf('busy'), undefined);
  assert.deepEqual(residentActivityOf({ toolCalls: 1, planDone: 0, planTotal: 0, latest: { kind: 7 } }), { toolCalls: 1, planDone: 0, planTotal: 0 });
  const working = { ...task('engineer-place', 'running', 0), activity };
  const state = teamViewState(pack.graph, pack.contract.tools, run([...before, working]))!;
  assert.deepEqual(state.stations.find((s) => s.id === 'engineer')!.activity, activity);
  const ended = teamViewState(pack.graph, pack.contract.tools, run([...before, working], 'ended-goal-met'))!;
  assert.equal(ended.stations.find((s) => s.id === 'engineer')!.activity, undefined);
});

// ---------------------------------------------------------------------------------------------------
// Slice A: rows/col/span, derived edges, fold and Reader metrics, over a small inline strip-style
// Pack (a fork out of RTL2GDS into two agents, a join at a decision, a revisit back edge). The view
// is built already-parsed (A0's `packView` transform output: `deriveEdges`, metric `kind`), like the
// demo strip test built its graph, so the fold is a pure function of the task records.
const stripGraph = {
  id: 'strip-fixture', version: '0.1.0', entry: 't1', loops: {}, autopilot: [],
  nodes: [
    { id: 't1', kind: 'act', parameters: {} }, { id: 't2', kind: 'act', parameters: {} },
    { id: 't3', kind: 'act', parameters: {} }, { id: 't4', kind: 'act', parameters: {} },
    { id: 't5', kind: 'act', parameters: {} }, { id: 't6', kind: 'act', parameters: {} },
    { id: 'agent-a', kind: 'act', parameters: { tool: 'ta' } }, { id: 'agent-b', kind: 'act', parameters: { tool: 'tb' } },
    { id: 'decide', kind: 'judge', parameters: {} }, { id: 'blocked', kind: 'wait', parameters: { blocker: 'x' } },
  ],
  edges: [
    { from: 't1', to: 't2' }, { from: 't2', to: 't3' },
    { from: 't3', to: 'agent-a' }, { from: 't3', to: 'agent-b' },
    { from: 'agent-a', to: 'decide' }, { from: 'agent-b', to: 'decide' },
    { from: 'decide', to: 't4', revisit: true }, { from: 'decide', to: 'blocked', outcome: 'FAIL' },
    { from: 't4', to: 't5' }, { from: 't5', to: 't6' },
  ],
  view: {
    deriveEdges: true, edges: [], hidden: ['blocked'],
    stations: [
      { id: 'rtl', label: 'RTL2GDS', row: 0, checklist: [
        { label: 'Check tools', nodes: ['t1'], rounds: 'first' }, { label: 'Reference build', nodes: ['t2'], rounds: 'first' },
        { label: 'Load timing', nodes: ['t3'], rounds: 'all' }, { label: 'Rebuild', nodes: ['t4'], rounds: 'all' },
        { label: 'Compare', nodes: ['t5'], rounds: 'all' }, { label: 'Next round', nodes: ['t6'], rounds: 'all' },
      ] },
      { id: 'himatime', label: 'HimaTime', row: 1, checklist: [{ label: 'Write requirements', nodes: ['agent-a'], rounds: 'all' }] },
      { id: 'qualib', label: 'Qualib', row: 1, checklist: [{ label: 'Check library', nodes: ['agent-b'], rounds: 'all' }] },
      { id: 'decide', label: 'Decide', row: 2, checklist: [{ label: 'Decide the round', nodes: ['decide'], rounds: 'all' }] },
    ],
    metrics: [
      { kind: 'reader', label: 'best', reader: 'andes-round', type: 'timing_gain_pct', unit: '%', digits: 2, pick: 'best', better: 'higher', sign: true, goal: 'target_gain', node: '', path: [] },
      { kind: 'reader', label: 'now', reader: 'andes-round', type: 'timing_gain_pct', unit: '%', digits: 2, pick: 'latest', sign: true, node: '', path: [] },
    ],
  },
} as unknown as PackGraph;
const stripTools = [{ id: 'ta', outsourcing: { kind: 'resident' } }, { id: 'tb', outsourcing: { kind: 'resident' } }] as unknown as PackContract['tools'];
const t = (taskId: string, state: string, iteration = 0, value?: unknown): DurableTaskView => ({
  taskId, projection: { state } as DurableTaskView['projection'], sourceFactIds: [], iterations: [{ repeatId: 'rounds', iteration }],
  ...(value === undefined ? {} : { result: { value } as unknown as DurableTaskView['result'] }),
});
type Obs = RunView['observations'][number];
const obs = (generation: number, value: number): Obs => ({ reader: { id: 'andes-round' }, generation, values: [{ type: 'timing_gain_pct', value, unit: '%' }] } as unknown as Obs);
const stripView = (tasks: DurableTaskView[], extra: { status?: string; goal?: Record<string, unknown>; observations?: Obs[] } = {}): Pick<RunView, 'run' | 'tasks' | 'observations'> =>
  ({ run: { id: 'run-s', status: extra.status ?? 'running', goal: extra.goal ?? {} }, tasks, observations: extra.observations ?? [] } as unknown as Pick<RunView, 'run' | 'tasks' | 'observations'>);
const stripState = (tasks: DurableTaskView[], extra?: Parameters<typeof stripView>[1]) => teamViewState(stripGraph, stripTools, stripView(tasks, extra))!;
const litOf = (s: ReturnType<typeof stripState>) => s.edges.filter((e) => e.lit).map((e) => `${e.from}>${e.to}`).sort();

test('A: stations take a row, a lone station spans both columns, a pair sits side by side', () => {
  const s = stripState([t('t1', 'running')]);
  assert.deepEqual(s.stations.map((x) => [x.id, x.row, x.col, x.span]),
    [['rtl', 0, 0, 2], ['himatime', 1, 0, 1], ['qualib', 1, 1, 1], ['decide', 2, 0, 2]]);
});

test('A: with no edges declared, station edges derive from the graph once per pair; a revisit is a back edge; hidden nodes draw none', () => {
  const s = stripState([t('t1', 'running')]);
  assert.deepEqual(s.edges.map((e) => [`${e.from}>${e.to}`, e.back]).sort(),
    [['decide>rtl', true], ['himatime>decide', false], ['qualib>decide', false], ['rtl>himatime', false], ['rtl>qualib', false]].sort());
  assert.ok(!s.edges.some((e) => e.from === 'blocked' || e.to === 'blocked'), 'the hidden node is on no edge');
});

test('A: round 1 with the fork active — both branch stations are active and both entry edges light', () => {
  const s = stripState([t('t1', 'succeeded'), t('t2', 'succeeded'), t('t3', 'succeeded'), t('agent-a', 'running'), t('agent-b', 'running')]);
  assert.equal(s.round, 1);
  const by = new Map(s.stations.map((x) => [x.id, x]));
  assert.equal(by.get('himatime')!.state, 'active');
  assert.equal(by.get('qualib')!.state, 'active');
  assert.equal(by.get('himatime')!.activeNode, 'agent-a');
  assert.deepEqual(litOf(s), ['rtl>himatime', 'rtl>qualib']);
});

test('A: round 2 hides the `rounds: first` lines; the round follows the task iteration', () => {
  const s = stripState([t('t3', 'running', 1)]);
  assert.equal(s.round, 2);
  const rtl = s.stations.find((x) => x.id === 'rtl')!;
  assert.deepEqual(rtl.lines.slice(0, 3).map((l) => [l.label, l.state]), [['Check tools', 'hidden'], ['Reference build', 'hidden'], ['Load timing', 'active']]);
});

test('A: a failed task fails its line and station', () => {
  const s = stripState([t('t1', 'succeeded'), t('t2', 'succeeded'), t('t3', 'succeeded'), t('agent-a', 'failed')]);
  const himatime = s.stations.find((x) => x.id === 'himatime')!;
  assert.equal(himatime.lines[0]!.state, 'failed');
  assert.equal(himatime.state, 'failed');
});

test('A: an ended Run lights nothing, works on nothing', () => {
  const s = stripState([t('t3', 'succeeded'), t('agent-a', 'running')], { status: 'ended-goal-met' });
  assert.deepEqual(litOf(s), []);
  assert.ok(s.stations.every((x) => x.state !== 'active' && x.activeNode === undefined));
  assert.ok(s.ended);
});

test('A: more than four shown lines fold their leading done run into one "N done" line', () => {
  const s = stripState([t('t1', 'succeeded'), t('t2', 'succeeded'), t('t3', 'succeeded'), t('t4', 'succeeded'), t('t5', 'running')]);
  const rtl = s.stations.find((x) => x.id === 'rtl')!;
  assert.equal(rtl.lines[0]!.folds, 4);
  assert.deepEqual(rtl.lines.slice(1, 4).map((l) => l.folded), [true, true, true]);
  const drawn = rtl.lines.filter((l) => l.state !== 'hidden' && l.folded !== true);
  assert.deepEqual(drawn.map((l) => [l.label, l.state, l.folds]), [['Check tools', 'done', 4], ['Compare', 'active', undefined], ['Next round', 'pending', undefined]]);
  // One done line does not fold.
  const one = stripState([t('t1', 'succeeded'), t('t3', 'running')]);
  assert.ok(one.stations.find((x) => x.id === 'rtl')!.lines.every((l) => l.folds === undefined));
});

// ---------------------------------------------------------------------------------------------------
// Slice D: `runningTaskLabels` names a DBOS head's running/waiting task(s) from the method's own node
// `label` (A0), what `run.currentNode` used to say — Masthead.tsx and HimaRunCard.tsx both read it.
const labelledNodes = [
  { id: 'agent-a', label: 'Write requirements' }, { id: 'agent-b', label: 'Check library' }, { id: 'decide' },
];

test('D: a parallel fork names every open branch, from the method\'s own node label', () => {
  const tasks = [t('t3', 'succeeded'), t('agent-a', 'running', 0), t('agent-b', 'waiting', 0)];
  assert.deepEqual(runningTaskLabels(tasks, labelledNodes), [
    { node: 'agent-a', label: 'Write requirements' }, { node: 'agent-b', label: 'Check library' },
  ]);
});

test('D: an unlabelled node falls back to its own id', () => {
  assert.deepEqual(runningTaskLabels([t('decide', 'running', 0)], labelledNodes), [{ node: 'decide', label: 'decide' }]);
});

test('D: a done, failed or pending task names nothing; neither does a historical or non-root-flow task', () => {
  assert.deepEqual(runningTaskLabels([t('agent-a', 'succeeded', 0), t('agent-b', 'failed', 0), t('decide', 'pending', 0)], labelledNodes), []);
  assert.deepEqual(runningTaskLabels([{ ...t('agent-a', 'running', 0), current: false }], labelledNodes), [], 'superseded by a later method revision');
  assert.deepEqual(runningTaskLabels([{ ...t('agent-a', 'running', 0), rootFlow: false }], labelledNodes), [], 'not the root flow');
});

test('D: no tasks and no nodes both answer with nothing, never throw', () => {
  assert.deepEqual(runningTaskLabels(undefined, undefined), []);
  assert.deepEqual(runningTaskLabels([], []), []);
});

test('A: a Reader metric reads the Run observations — best over rounds and the latest round — with its goal', () => {
  const s = stripState([t('t3', 'running', 2)], { goal: { target_gain: 1 }, observations: [obs(1, 0.8), obs(2, 1.3), obs(3, 1.1)] });
  assert.deepEqual(s.metrics, [
    { label: 'best', value: '+1.30 %', goal: '1.00 %', better: 'higher' },
    { label: 'now', value: '+1.10 %' },
  ]);
  // No reading yet: the metric is absent, not a blank.
  assert.deepEqual(stripState([t('t1', 'running')]).metrics, []);
});

test('M5: only a metric with sign:true gets a leading + ; an unsigned (absolute) metric does not', () => {
  // Same graph, but the metric reads an absolute value (e.g. Fmax) and declares no sign.
  const absolute = { ...stripGraph, view: { ...(stripGraph as { view: { metrics: unknown[] } }).view,
    metrics: [{ kind: 'reader', label: 'fmax', reader: 'andes-round', type: 'timing_gain_pct', unit: 'MHz', digits: 2, pick: 'latest', node: '', path: [] }] } } as unknown as PackGraph;
  const s = teamViewState(absolute, stripTools, stripView([t('t3', 'running', 2)], { observations: [obs(2, 1951.6)] }))!;
  assert.deepEqual(s.metrics, [{ label: 'fmax', value: '1951.60 MHz' }], 'no misleading + on an absolute metric');
});
