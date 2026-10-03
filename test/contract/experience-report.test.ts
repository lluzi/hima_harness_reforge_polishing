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
    goal: { target_period_ns: 2.3 }, generation: 1 }, observations: [observation], verdicts, nodes, generations: [generation], jobs: [], code: [], knowledge: [], refusals: [], blockers: [], cancels: [], resumes: [],
    decision: { recordId: 'decision-1', at, nodeId: 'explore', chooser: 'fixture', chooserOrigin: 'pack', chosen: { goalMet: true }, rationale: {}, cites: ['constraint', 'goal', observation.recordId] } };
}

function projected(view: RunView) { return experienceReport(view, at).json.research; }

test('model interpretation cannot turn missing citations or contradictory numbers into report facts', () => {
  const view = fixture();
  const analysis = { recordId: 'analysis-1', at, sessionId: 'owner', nodeId: 'explore', question: 'Can the measured period support this next experiment?',
    hypotheses: ['A different selection algorithm may reduce overlap.'], limitations: ['One finite design sample only.'],
    comparisons: ['Same declared design; tool version has not been probed.'], nextExperiments: ['Hold the input fixed and compare two algorithms.'],
    claims: [{ text: 'The model claims a period of 1 ns.', cites: ['observation-1'], measurements: [{ recordId: 'observation-1', field: 'clock_period', value: 1, unit: 'ns' }] },
      { text: 'A nonexistent trial improved the result.', cites: ['invented'], measurements: [] }],
  };
  const report = experienceReport({ ...view, analyses: [analysis] }, at);
  assert.match(report.markdown, /Unverified model interpretation/);
  assert.match(report.markdown, /invented/);
  assert.match(report.markdown, /does not match/);
  assert.equal(report.json.research.trials[0]?.observation?.values[0]?.value, 2.3);
  assert.match(report.markdown, /Hold the input fixed/);
});

test('analysis whose source is later invalidated remains visible only as historical interpretation', () => {
  const view = fixture();
  const analysis = { recordId: 'analysis-before-revision', at, sessionId: 'owner', nodeId: 'explore',
    question: 'What did the earlier observation suggest?', hypotheses: ['The earlier path may explain the result.'],
    comparisons: ['Compare with a rerun after revision.'], limitations: ['The source was later invalidated.'],
    nextExperiments: ['Use the revised path and measure again.'], claims: [{ text: 'The earlier period was 2.3 ns.', cites: ['observation-1'],
      measurements: [{ recordId: 'observation-1', field: 'clock_period', value: 2.3, unit: 'ns' }] }] };
  const report = experienceReport({ ...view, analyses: [analysis], revisions: [{ revisionId: 'revision-1', version: 1,
    recordId: 'revision-record-1', changedNodes: ['observe'], affectedNodes: ['observe', 'judge'],
    invalidatedRecordIds: ['observation-1'], reusedRecordIds: [] }] }, at);
  assert.match(report.markdown, /Citation observation-1 was invalidated by an applied revision/);
  assert.match(report.markdown, /historical observation observation-1/);
  assert.match(report.markdown, /Unverified model interpretation: The earlier period was 2.3 ns/);
});

test('a goal claim requires completed cited evidence; requested period is not a measured Fmax', () => {
  const view = fixture();
  const report = experienceReport(view, at);
  assert.equal(report.json.schema, 'hima-experience/4');
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


function mixedSourceChecks(extra: 'FAIL' | 'UNDETERMINED' = 'UNDETERMINED'): RunView {
  const input: ObservationView = { ...observed('input-reading'), generation: 1, path: '/campaign/inputs.json',
    reader: { id: 'inputs', version: '1', reportKind: 'inputs', emits: ['input_ready'] },
    values: [{ type: 'input_ready', value: 0, unit: 'count' }] };
  const collateral = extra === 'FAIL' ? { type: 'collateral_count', value: 2, unit: 'count' }
    : { type: 'collateral_count', value: null, unit: 'count', unknownReason: 'Global collateral is unmeasured' };
  const after: ObservationView = { ...observed('result-reading'), generation: 1, path: '/campaign/result.json', contentSha256: 'b'.repeat(64),
    reader: { id: 'result', version: '1', reportKind: 'result', emits: ['native_margin', 'collateral_count'] },
    values: [{ type: 'native_margin', value: 0, unit: 'ns' }, collateral] };
  const verdicts: VerdictView[] = [
    { recordId: 'input', at, ruleId: 'input-ready', ruleVersion: '1', outcome: 'PASS', valuesAsRead: input.values, cites: [{ recordId: input.recordId, observation: input }] },
    { recordId: 'goal', at, ruleId: 'native-goal', ruleVersion: '1', outcome: 'PASS', valuesAsRead: [after.values[0]!], cites: [{ recordId: after.recordId, observation: after }] },
    { recordId: 'collateral', at, ruleId: 'collateral-check', ruleVersion: '1', outcome: extra, reason: extra === 'FAIL' ? 'Known collateral regression' : 'Global collateral is unmeasured', valuesAsRead: [collateral], cites: [{ recordId: after.recordId, observation: after }] },
  ];
  const view = fixture();
  const nodes = [node('inputs', 'act'), node('input-judge', 'judge'), node('result', 'act'), node('result-judge', 'judge')];
  return { ...view, run: { ...view.run, siteId: 'declared-site', goal: { target_native_margin: 0 }, status: 'ended-goal-not-met' },
    observations: [input, after], verdicts, nodes, decision: null,
    generations: [{ generation: 1, strategy: {}, observation: after, nodes, verdicts: verdicts.map(v => ({ ruleId: v.ruleId, outcome: v.outcome, recordId: v.recordId, cites: v.cites.map(c => c.recordId) })), wallMs: 10, state: 'done' }] };
}

test('same-trial multiple sources retain known checks beside UNKNOWN without unrelated demo claims', () => {
  const view = mixedSourceChecks();
  const report = experienceReport(view, at);
  assert.equal(report.json.research.conclusion, 'goal-not-established');
  assert.equal(report.json.research.trials[0]?.status, 'undetermined');
  assert.equal(report.json.ending.status, 'ended-goal-not-met', 'projection preserves the historical ending');
  assert.match(report.markdown, /native-goal.*PASS/);
  assert.match(report.markdown, /collateral-check.*UNDETERMINED/);
  assert.match(report.markdown, /Global collateral is unmeasured/);
  assert.doesNotMatch(report.markdown, /simulated synthesis|Reported clock periods|measured Fmax/);
  const stale = { ...view, observations: [view.observations[0]!, { ...view.observations[1]!, contentSha256: 'c'.repeat(64) }] };
  assert.equal(projected(stale).conclusion, 'insufficient-evidence', 'changed source bytes cannot borrow a previous verdict');
});

test('recorded required decision scope can establish a narrow goal without erasing broader failures or unknowns', () => {
  for (const extra of ['FAIL', 'UNDETERMINED'] as const) {
    const view = mixedSourceChecks(extra);
    const scoped: RunView = { ...view, run: { ...view.run, status: 'ended-goal-met' }, decision: {
      recordId: 'scoped-decision', at, nodeId: 'finish', chooser: 'fixture', chooserOrigin: 'pack', chosen: { goalMet: true }, rationale: {},
      requiredVerdictIds: ['input', 'goal'], cites: ['input', 'goal', 'collateral', 'input-reading', 'result-reading'],
    } };
    const report = experienceReport(scoped, at);
    assert.equal(report.json.research.conclusion, 'goal-supported');
    assert.match(report.json.research.summary, /Other.*checks/);
    assert.match(report.markdown, new RegExp(`collateral-check.*${extra}`));
    assert.notEqual(projected({ ...scoped, decision: { ...scoped.decision!, requiredVerdictIds: ['invented'] } }).conclusion, 'goal-supported');
    const { requiredVerdictIds: _scope, ...legacy } = scoped.decision!;
    assert.notEqual(projected({ ...scoped, decision: legacy }).conclusion, 'goal-supported', 'older reports do not acquire an invented narrow scope');
  }
});
