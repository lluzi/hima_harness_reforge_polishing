// L1: public report projection, with independent evidence/counterexample fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experienceReport, reportBlocks } from '@hima/harness';
import type { RunView, GenerationView, ObservationView, VerdictView, NodeView } from '@hima/harness';

const at = '2026-09-11T00:00:00.000Z';
function observed(id = 'observation-1'): ObservationView {
  return { recordId: id, at, path: '/campaign/qor.rpt', contentSha256: 'a'.repeat(64), bytes: 100,
    reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor-report', emits: ['clock_period', 'setup_wns'] },
    values: [{ type: 'clock_period', value: 2.3, unit: 'ns' }, { type: 'setup_wns', value: 0, unit: 'ns', mode: 'setup', scope: 'all' }] };
}
function node(recordId: string, kind: NodeView['kind'], state: NodeView['state'] = 'done'): NodeView {
  return { recordId, at, nodeId: recordId, kind, state, attempt: 1, ...(kind === 'judge' ? { outcome: 'PASS' as const } : {}) };
}
function fixture(): RunView {
  const observation = observed();
  const verdicts: VerdictView[] = ['constraint', 'goal'].map((id) => ({ recordId: id, at, ruleId: id, ruleVersion: '1', outcome: 'PASS',
    valuesAsRead: observation.values, cites: [{ recordId: observation.recordId, observation }] }));
  const nodes = [node('observe-done', 'act'), node('judge-done', 'judge')];
  const generation: GenerationView = { generation: 1, strategy: { periodNs: 2.3 }, observedPeriodNs: 2.3, slackNs: 0, observation, nodes,
    verdicts: verdicts.map((v) => ({ ruleId: v.ruleId, outcome: v.outcome, recordId: v.recordId, cites: [observation.recordId] })),
    wallMs: 100, state: 'done', decision: 'goal met', decisionRecordId: 'decision-1' };
  return { run: { id: 'run-1', campaignId: 'campaign-1', siteId: 'local', createdAt: at, status: 'ended-goal-met', packId: 'timing', packVersion: 'fixture',
    goal: { target_period_ns: 2.3 }, generation: 1 }, observations: [observation], verdicts, nodes, generations: [generation], jobs: [], refusals: [], blockers: [], cancels: [],
    decision: { recordId: 'decision-1', at, nodeId: 'explore', chooser: 'fixture', chosen: { goalMet: true }, rationale: {}, cites: ['constraint', 'goal', observation.recordId] } };
}

function projected(view: RunView) { return experienceReport(view, at).json.research; }

test('a goal claim requires completed cited evidence; requested period is not a measured Fmax', () => {
  const view = fixture();
  const report = experienceReport(view, at);
  assert.equal(report.json.schema, 'hima-experience/2');
  assert.equal(report.json.research.conclusion, 'goal-supported');
  assert.equal(report.json.research.trials[0]?.constraintOutcome, 'PASS');
  assert.deepEqual(report.json.research.trials[0]?.observation?.values, view.observations[0]?.values);
  assert.deepEqual(report.json.research.trials[0]?.verdicts.map((v) => v.recordId), ['constraint', 'goal']);
  assert.match(report.markdown, /not measured Fmax/);
  assert.match(report.markdown, /not measurements/);
  assert.equal(report.json.research.environment.toolVersions, 'not recorded');
  assert.ok(reportBlocks(report.markdown).some((block) => block.kind === 'heading' && block.text === 'Research result and evidence limits'));
});

test('a successful experiment with a failed constraint is valid negative evidence, independent of convergence', () => {
  const view = fixture();
  const verdicts = view.verdicts.map((v) => ({ ...v, outcome: 'FAIL' as const }));
  const generation = { ...view.generations[0]!, nodes: [node('observe-done', 'act'), { ...node('judge-done', 'judge'), outcome: 'FAIL' as const }],
    verdicts: view.generations[0]!.verdicts.map((v) => ({ ...v, outcome: 'FAIL' as const })) };
  const research = projected({ ...view, run: { ...view.run, status: 'ended-converged' }, verdicts, generations: [generation], decision: null });
  assert.equal(research.conclusion, 'measured-negative');
  assert.equal(research.trials[0]?.status, 'judged');
  assert.equal(research.trials[0]?.constraintOutcome, 'FAIL');
  assert.match(research.summary, /only to the recorded trials/);
  assert.ok(research.limitations.some((line) => line.includes('does not prove an optimum')));
});

test('cancelled or failed execution cannot borrow an earlier completed judge from the same generation', () => {
  const view = fixture();
  for (const state of ['running', 'blocked', 'cancelled'] as const) {
    const generation = { ...view.generations[0]!, nodes: [...view.generations[0]!.nodes!, node('new-attempt', 'act', state)] };
    const research = projected({ ...view, run: { ...view.run, status: 'cancelled' }, generations: [generation] });
    assert.equal(research.conclusion, 'insufficient-evidence', state);
    assert.equal(research.trials[0]?.status, 'incomplete');
    assert.ok(research.trials[0]?.observation, 'partial data remains visible as history');
  }
});

test('missing, unresolved, stale and undetermined citations cannot establish a definite result', () => {
  const view = fixture();
  const variations: RunView[] = [
    { ...view, observations: [] },
    { ...view, verdicts: [] },
    { ...view, verdicts: view.verdicts.map((v) => ({ ...v, cites: [{ recordId: 'previous-observation', observation: observed('previous-observation') }] })) },
    { ...view, verdicts: view.verdicts.map((v) => ({ ...v, outcome: 'UNDETERMINED' as const, reason: 'required clock period absent' })) },
  ];
  for (const changed of variations) assert.equal(projected(changed).conclusion, 'insufficient-evidence');
  assert.equal(projected(variations[3]!).trials[0]?.status, 'undetermined');
});

test('budget truncation labels the next proposal unmeasured, but a strategy already entered is not labelled untested', () => {
  const view = fixture();
  const decision = { ...view.decision!, chosen: { strategy: { periodNs: 2.25 } } };
  const ended = { ...view, run: { ...view.run, status: 'ended-budget-exhausted' as const }, decision };
  assert.deepEqual(projected(ended).untestedNextStrategy, { periodNs: 2.25 });
  const second: GenerationView = { generation: 2, strategy: { periodNs: 2.25 }, nodes: [], verdicts: [], wallMs: 0, state: 'done' };
  const continued = { ...ended, run: { ...ended.run, generation: 2, status: 'cancelled' as const }, generations: [...view.generations, second] };
  assert.equal(projected(continued).untestedNextStrategy, undefined);
  assert.equal(projected(continued).trials[1]?.status, 'incomplete');
});

test('no trials, legacy rows without provenance and execution status alone leave the conclusion unknown', () => {
  const view = fixture();
  for (const status of ['ended-goal-met', 'ended-converged', 'ended-goal-not-met', 'ended-budget-exhausted', 'cancelled'] as const) {
    const empty = experienceReport({ ...view, run: { ...view.run, status }, generations: [], decision: null }, at);
    assert.equal(empty.json.ending.status, status);
    assert.equal(empty.json.research.conclusion, 'insufficient-evidence');
  }
  const { observation, nodes, decisionRecordId, ...legacy } = view.generations[0]!;
  assert.equal(projected({ ...view, generations: [legacy] }).conclusion, 'insufficient-evidence');
});

test('fork branches retain separate observations and partial branches do not inherit a completed peer', () => {
  const view = fixture();
  const generation = { ...view.generations[0]!, observation: undefined, observedPeriodNs: undefined, slackNs: undefined,
    join: { nodeId: 'join', outcome: 'FAIL' as const },
    branches: [
      { id: 'complete', nodes: [node('read', 'act')], jobs: [], state: 'done' as const, observation: view.observations[0], verdicts: view.generations[0]!.verdicts },
      { id: 'partial', nodes: [node('failed', 'act', 'blocked')], jobs: [], state: 'blocked' as const, verdicts: [] },
    ] };
  const research = projected({ ...view, run: { ...view.run, status: 'cancelled' }, generations: [generation], decision: null });
  assert.deepEqual(research.trials.map((trial) => [trial.branchId, trial.status]), [['complete', 'judged'], ['partial', 'incomplete']]);
  assert.equal(research.trials[1]?.observation, undefined);
  const unsupportedGoal = projected({ ...view, generations: [generation] });
  assert.notEqual(unsupportedGoal.conclusion, 'goal-supported', 'one completed branch cannot certify a goal while a required peer is incomplete');
});
