import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runIdForWorkbenchAddress, workbenchAddressKey, workbenchAddressOf } from '../../packages/harness/src/client/workbench-address.ts';

test('empty navigation is Campaign preparation but malformed or unknown addresses are explicit errors', () => {
  for (const value of [undefined, null, {}]) assert.deepEqual(workbenchAddressOf(value), { kind: 'campaign' });
  assert.deepEqual(workbenchAddressOf({ runId: 'run-a' }), { kind: 'campaign', runId: 'run-a' });
  for (const value of [{ runId: 3 }, { kind: 'campaign', runId: '' }, { kind: 'insight', reportRef: 2 }, { kind: 'child', parentSessionId: 'parent' }, { kind: 'unknown' }, []]) {
    assert.equal(workbenchAddressOf(value).kind, 'invalid', JSON.stringify(value));
    assert.equal((workbenchAddressOf(value) as { code: string }).code, 'hima/invalid-view-address');
  }
});

test('address keys are canonical tuples and mode switches carry no hidden execution identity', () => {
  assert.notEqual(workbenchAddressKey({ kind: 'campaign', runId: 'a:b' }), workbenchAddressKey({ kind: 'campaign', runId: 'a' }));
  assert.notEqual(workbenchAddressKey({ kind: 'insight', reportRef: 'a:b', scope: 'c' }), workbenchAddressKey({ kind: 'insight', reportRef: 'a', scope: 'b:c' }));
  const campaign = workbenchAddressOf({ kind: 'campaign', runId: 'run-a' });
  const insight = workbenchAddressOf({ kind: 'insight' });
  assert.deepEqual(insight, { kind: 'insight' });
  assert.equal(runIdForWorkbenchAddress(campaign), 'run-a');
  assert.equal(runIdForWorkbenchAddress(insight), undefined);
  assert.equal(runIdForWorkbenchAddress(workbenchAddressOf({ kind: 'child', parentSessionId: 'p', childSessionId: 'c' })), undefined);
});
