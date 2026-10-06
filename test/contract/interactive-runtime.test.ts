import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listInteractiveSessions, parseInteractiveRecord, type InteractiveBinding } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const digest = (letter: string): string => letter.repeat(64);
const binding: InteractiveBinding = {
  id: 'fixture-binding', packId: 'fixture-pack', packDigest: digest('a'), nodeId: 'manual', toolId: 'fixture-repl',
  source: { kind: 'trusted-test-fixture', id: 'fixture-binding' },
  adapter: { id: 'fixture-repl', version: '1', digest: digest('b'), completionProtocol: 'versioned-marker', allowsMultiline: false },
  environment: { id: 'isolated-test-fixture', digest: digest('c') }, mutation: 'qualified',
  limits: { startupWaitMs: 1_000, callWaitMaxMs: 1_000, commandMaxMs: 5_000, sessionMaxMs: 30_000, idleMaxMs: 10_000 },
};

const execution = { id: 'execution-1', nodeId: 'manual', kind: 'act' as const, generation: 1, attempt: 1,
  methodDigest: digest('a'), inputDigest: digest('d'), phase: 'begun' as const };

test('interactive session projection recognizes a finished Job without inventing command completion', () => {
  const runId = 'normal-close-run', toolSessionId = 'normal-close-session';
  const address = { runId, toolSessionId, executionId: execution.id, nodeId: 'manual', actor: 'operator',
    ownerEpoch: 1, controlRevision: 0, requestId: 'close-request', operationDigest: digest('a'),
    callerDigest: digest('b'), at: '2026-09-27T13:20:35.000Z' };
  const protocol = (data: object) => ({ type: 'interactive', runId, payload: parseInteractiveRecord({ ...address, ...data }) });
  const opening = [
    protocol({ event: 'open-intent', jobSession: toolSessionId, transcriptPath: '/fixture/transcript.log',
      exitPath: '/fixture/session.exit', sessionDeadlineAt: '2026-09-27T14:20:35.000Z' }),
    protocol({ event: 'opened', jobSession: toolSessionId, readiness: 'ready', qualification: {
      bindingDigest: digest('c'), adapter: binding.adapter, environment: binding.environment,
      mutation: 'qualified', testOnly: true } }),
    protocol({ event: 'input-intent', commandId: 'close-1', inputDigest: digest('d'), requestDigest: digest('b'),
      protocolToken: 'T'.repeat(32), inputBytes: 1, submit: true, effect: 'close', cursorBefore: 0,
      commandDeadlineAt: '2026-09-27T13:30:35.000Z' }),
    protocol({ event: 'input-sent', commandId: 'close-1', inputDigest: digest('d') }),
  ];
  const completed = protocol({ event: 'command-completed', commandId: 'close-1', inputDigest: digest('d'), cursorAfter: 123 });
  const finished = { type: 'job', runId, event: 'finished', job: { session: toolSessionId }, exitCode: 0 };
  const project = (records: object[]) => listInteractiveSessions({
    records: (query: { type: string }) => records.filter((record) => (record as { type: string }).type === query.type),
  } as never, runId)[0]!;
  assert.equal(project([...opening, completed]).status, 'ready', 'a close command receipt alone does not prove process exit');
  assert.equal(project([...opening, completed, { ...finished, job: { session: 'other-session' } }]).status, 'ready');
  const rows = [...opening, completed, finished];
  const before = JSON.stringify(rows);
  const closed = project(rows);
  assert.equal(closed.status, 'closed', 'same-session finished Job proves process exit without an interactive closed event');
  assert.equal(closed.activeCommand, undefined);
  assert.equal(closed.lastCursor, 123);
  assert.equal(JSON.stringify(rows), before, 'projection does not modify historical records');
  const interrupted = project([...opening, { ...finished, exitCode: 1 }]);
  assert.equal(interrupted.status, 'closed', 'process exit is independent of business success');
  assert.equal(interrupted.activeCommand?.state, 'sent', 'process exit does not manufacture a command completion receipt');
});

