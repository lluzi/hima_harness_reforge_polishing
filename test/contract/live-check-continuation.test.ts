import assert from 'node:assert/strict';
import test from 'node:test';
import { settledExecutionCompletionPrompt } from '../../scripts/live-check-continuation.ts';

test('a settled current execution receives an exact complete instruction', () => {
  const prompt = settledExecutionCompletionPrompt('run-1', 'freeze-cumulative-library', [{
    id: 'execution-freeze', nodeId: 'freeze-cumulative-library', phase: 'ready',
    result: { kind: 'settled' },
  }]);
  assert.match(prompt!, /action=complete/);
  assert.match(prompt!, /execution-freeze/);
  assert.doesNotMatch(prompt!, /action=work/);
});

test('working, unstarted, ambiguous, or non-current executions keep the normal prompt', () => {
  assert.equal(settledExecutionCompletionPrompt('run-1', 'freeze', [
    { id: 'working', nodeId: 'freeze', phase: 'working' },
  ]), undefined);
  assert.equal(settledExecutionCompletionPrompt('run-1', 'freeze', [
    { id: 'ready', nodeId: 'freeze', phase: 'ready' },
  ]), undefined);
  assert.equal(settledExecutionCompletionPrompt('run-1', 'freeze', [
    { id: 'other', nodeId: 'reader', phase: 'ready', result: { kind: 'settled' } },
  ]), undefined);
  assert.equal(settledExecutionCompletionPrompt('run-1', 'freeze', [
    { id: 'first', nodeId: 'freeze', phase: 'ready', result: { kind: 'settled' } },
    { id: 'second', nodeId: 'freeze', phase: 'ready', result: { kind: 'settled' } },
  ]), undefined);
});
