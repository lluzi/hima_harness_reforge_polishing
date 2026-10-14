// L1: the workspace pane opens itself once per Run, only for the one receipt that actually starts a
// Run on HUG-DBOS (`hima_run`) — unlike `demo/andes-openc910`, `hima_execute` only controls an
// already-running Run and `hima_context` only reads facts, so neither opens the pane here. A stale or
// replayed receipt, an ended Run, or a Run already opened in this window must not reopen it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTO_OPEN_TOOLS, AUTO_OPEN_WINDOW_MS, autoOpened, claimAutoOpen, receiptTime, shouldAutoOpen, timeOf } from '../../packages/harness/src/client/run-auto-open.ts';

test('only hima_run may open the pane: hima_execute and hima_context never do, on HUG-DBOS', () => {
  assert.deepEqual([...AUTO_OPEN_TOOLS], ['hima_run']);
  const now = Date.now();
  for (const toolName of ['hima_execute', 'hima_context', 'hima_observe', undefined]) {
    assert.equal(shouldAutoOpen({ toolName, status: 'running', at: now, now, opened: false }), false, `${String(toolName)} must not open the pane`);
  }
});

test('a fresh hima_run receipt for a running Run opens the pane; an ended Run or one already opened does not', () => {
  const now = Date.now();
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'running', at: now, now, opened: false }), true);
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'waiting', at: now, now, opened: false }), true);
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'ended-goal-met', at: now, now, opened: false }), false, 'an ended Run never opens');
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'running', at: now, now, opened: true }), false, 'already opened this window: fires once per Run');
});

test('an old receipt from a re-rendered or replayed transcript does not reopen the pane', () => {
  const now = Date.now();
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'running', at: now - AUTO_OPEN_WINDOW_MS - 1, now, opened: false }), false);
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'running', at: now - AUTO_OPEN_WINDOW_MS + 1, now, opened: false }), true, 'just inside the window still opens');
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'running', at: undefined, now, opened: false }), false, 'no readable time: never opens');
});

test('receiptTime reads the receipt\'s own time fields; timeOf accepts seconds, ms and ISO strings', () => {
  assert.equal(timeOf(1_700_000_000), 1_700_000_000_000, 'a unix-seconds number is scaled to ms');
  assert.equal(timeOf(1_700_000_000_000), 1_700_000_000_000, 'an already-ms number is kept');
  assert.equal(timeOf('2023-11-14T22:13:20.000Z'), 1_700_000_000_000);
  assert.equal(timeOf('not a date'), undefined);
  assert.equal(receiptTime({ startedAt: '2023-11-14T22:13:20.000Z' }), 1_700_000_000_000);
  assert.equal(receiptTime({ endedAt: 1_700_000_000, startedAt: 1 }), 1_700_000_000_000, 'endedAt is read before startedAt');
  assert.equal(receiptTime({}), undefined);
});

test('claimAutoOpen marks a Run opened exactly once; a second claim for the same Run is refused', () => {
  const runId = `run-auto-open-${String(Math.random())}`;
  assert.equal(autoOpened(runId), false);
  assert.equal(claimAutoOpen(runId), true, 'the first claim wins');
  assert.equal(autoOpened(runId), true);
  assert.equal(claimAutoOpen(runId), false, 'already claimed: refused');
});
