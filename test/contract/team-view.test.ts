// The team view (view.yml): a Pack's display-only stations folded with a Run's task records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPack, teamViewState } from '@hima/harness';
import type { RunView } from '@hima/harness';

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
const run = (tasks: DurableTaskView[], status = 'running'): Pick<RunView, 'run' | 'tasks'> =>
  ({ run: { id: 'run-t', status, goal: { target_dropped_count: 18 } }, tasks } as unknown as Pick<RunView, 'run' | 'tasks'>);
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
