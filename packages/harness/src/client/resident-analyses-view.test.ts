import assert from 'node:assert/strict';
import test from 'node:test';

const subject: typeof import('./resident-analyses-view.js') = await import(`./resident-analyses-view.${'ts'}`);
const { analysisFinished, analysisState, admittedAnalysisRefs, rememberDetail } = subject;
type Detail = Parameters<typeof rememberDetail>[2];

test('an analysis is settled once its Run ends, its task settles, or the Host knows nothing more', () => {
  assert.equal(analysisFinished({}), true, 'no status and no task never polls forever');
  for (const status of ['ended-goal-met', 'ended-goal-not-met', 'ended-converged', 'ended-budget-exhausted', 'cancelled'] as const) assert.equal(analysisFinished({ status }), true, status);
  for (const state of ['succeeded', 'failed', 'cancelled']) assert.equal(analysisFinished({ status: 'running', task: { state } }), true, state);
  assert.equal(analysisFinished({ status: 'running' }), false);
  assert.equal(analysisFinished({ status: 'waiting', task: { state: 'waiting', reason: 'needs a person' } }), false);
  assert.equal(analysisFinished({ task: { state: 'pending' } }), false);
  assert.equal(analysisState({ status: 'ended-goal-met', task: { state: 'running' } }), 'ended-goal-met');
  assert.equal(analysisState({ status: 'running', task: { state: 'pending' } }), 'pending');
  assert.equal(analysisState({}), 'unknown');
});

test('only admitted analyses can be built on, each once', () => {
  const sha = 'a'.repeat(64);
  assert.deepEqual(admittedAnalysisRefs([
    { analysis: { id: 'spread', version: 2, admitted: true, resultSha256: sha } },
    { analysis: { id: 'draft', version: 1, admitted: false, notAdmittedReason: 'admission has not finished', resultSha256: sha } },
    { analysis: { admitted: true, resultSha256: sha } },
    { analysis: { id: 'spread', version: 2, admitted: true, resultSha256: sha } },
    { analysis: { id: 'spread', version: 1, admitted: true, resultSha256: sha } },
    {},
  ]), ['spread@2', 'spread@1']);
});

test('the detail cache keeps the newest results by hash', () => {
  const cache = new Map<string, Detail>();
  const detail = (runId: string): Detail => ({ runId, admission: { admitted: true } });
  rememberDetail(cache, 'h1', detail('r1'), 2);
  rememberDetail(cache, 'h2', detail('r2'), 2);
  rememberDetail(cache, 'h1', detail('r1b'), 2);
  rememberDetail(cache, 'h3', detail('r3'), 2);
  assert.deepEqual([...cache.keys()], ['h1', 'h3']);
  assert.equal(cache.get('h1')?.runId, 'r1b');
});
