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

test('I1: a still-preparing Run (no status yet) opens the pane; every ended status is refused', () => {
  const now = Date.now();
  // A DBOS Run that `hima_run` returned while preparing has no status on its first read
  // (`durableRunView` yields undefined). It must still open the pane — before the fix it did not.
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: undefined, at: now, now, opened: false }), true, 'a preparing Run (undefined status) is treated as just started');
  for (const status of ['ended-goal-met', 'ended-goal-not-met', 'ended-converged', 'ended-budget-exhausted', 'cancelled']) {
    assert.equal(shouldAutoOpen({ toolName: 'hima_run', status, at: now, now, opened: false }), false, `${status} is an ended Run and never opens`);
  }
});

test('I1: fires exactly once across a preparing→running transition for the same fresh receipt', () => {
  const now = Date.now();
  const runId = `run-auto-open-prepare-${String(Math.random())}`;
  // First read: preparing (no status). The receipt decides to open and claims the Run.
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: undefined, at: now, now, opened: autoOpened(runId) }), true);
  assert.equal(claimAutoOpen(runId), true, 'the preparing read is the one that opens');
  // The status later resolves to running; the effect re-evaluates but the claim already holds.
  assert.equal(shouldAutoOpen({ toolName: 'hima_run', status: 'running', at: now, now, opened: autoOpened(runId) }), false, 'already opened: the status transition does not reopen');
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
