import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueMeasurementReceipt, VALUE_MEASUREMENT_SCHEMA } from '@hima/harness';
import type { LedgerRecord, RunRecord } from '@hima/harness';

const at = '2026-09-25T00:00:00.000Z';
const later = '2026-09-25T00:00:01.000Z';
const job = { session: 'job-one', pid: 42, workspace: '/work/run', name: 'compile', startedAt: at, wire: 'dc_shell' };
const base = (seq: number) => ({ id: `record-${seq}`, runId: 'run-one', siteId: 'site-one', seq, at, writer: 'executor' as const, generation: 1 });

function run(changes: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-one', campaignId: 'campaign-one', siteId: 'site-one', createdAt: at, nextSeq: 5,
    status: 'ended-goal-not-met', meters: { elapsedMs: 1_000, waitedMs: 250, jobsLaunched: 1, attempts: 1, licenceMs: { PrimeTime: 2_000 } },
    control: { mode: 'agent', owner: 'owner', epoch: 1, revision: 1, paused: [], executions: {}, siteDigest: 'a'.repeat(64), requests: {
      review: { digest: 'b'.repeat(64), actor: 'guide', epoch: 1, revision: 0, at, state: 'done', origin: 'human', receipt: { requestId: 'review', action: 'continue' } },
      business: { digest: 'c'.repeat(64), actor: 'guide', epoch: 1, revision: 0, at, state: 'done', origin: 'human', receipt: { requestId: 'business', action: 'measure-value',
        data: { category: 'business-decision', startedAt: at, endedAt: later, evidenceRef: 'stopwatch:business-one' } } },
    } },
    ...changes,
  };
}

test('value receipt projects durable Job, seat and Model-moment facts without inventing human or token time', () => {
  const records: LedgerRecord[] = [
    { ...base(1), type: 'job', event: 'launched', job, nodeId: 'compile', licences: { PrimeTime: 2 }, attempt: 1 },
    { ...base(2), id: 'record-2', at: later, type: 'job', event: 'finished', job, nodeId: 'compile', exitCode: 0 },
    { ...base(3), id: 'record-3', type: 'session', event: 'opened', preset: 'hima-moment', sessionId: 'model-one', model: 'deepseek-flash', nodeId: 'review', attempt: 1, tools: [] },
    { ...base(4), id: 'record-4', at: later, type: 'session', event: 'closed', preset: 'hima-moment', sessionId: 'model-one', model: 'deepseek-flash', nodeId: 'review', attempt: 1, outcome: 'completed' },
  ];
  const receipt = valueMeasurementReceipt(run(), records);
  assert.equal(receipt.schema, VALUE_MEASUREMENT_SCHEMA);
  assert.equal(receipt.final, true);
  assert.equal(receipt.jobs.launched.value, 1);
  assert.equal(receipt.jobs.finished.value, 1);
  assert.deepEqual(receipt.commercialToolSeatTime.values, { PrimeTime: 2_000 });
  assert.equal(receipt.human.controlRequests.value, 2);
  assert.equal(receipt.human.observedWaitTime.status, 'measured');
  assert.deepEqual(receipt.human.businessDecisionTime, { status: 'measured', value: 1_000, unit: 'ms',
    sources: ['run.control.requests.business', 'stopwatch:business-one'], claimLimit: 'Explicit human stopwatch segments only; Campaign wall and wait time are excluded.' });
  assert.equal(receipt.human.environmentRecoveryTime.status, 'unmeasured');
  assert.equal(receipt.human.evidenceReviewTime.status, 'unmeasured');
  assert.equal(receipt.model.sessionsOpened.value, 1);
  assert.equal(receipt.model.requests.status, 'unmeasured');
  assert.equal(receipt.model.inputTokens.status, 'unmeasured');
  assert.match(receipt.claimLimits.join(' '), /Unmeasured is not zero/);
});

test('active licensed Jobs and open Model moments make the receipt partial, never final or zero', () => {
  const records: LedgerRecord[] = [
    { ...base(1), type: 'job', event: 'launched', job, nodeId: 'compile', licences: { PrimeTime: 2 }, attempt: 1 },
    { ...base(2), type: 'session', event: 'opened', preset: 'hima-moment', sessionId: 'model-open', model: 'deepseek-flash', nodeId: 'review', attempt: 1, tools: [] },
  ];
  const receipt = valueMeasurementReceipt(run({ status: 'running', nextSeq: 3, meters: { elapsedMs: 500, jobsLaunched: 1, attempts: 1 } }), records);
  assert.equal(receipt.final, false);
  assert.equal(receipt.commercialToolSeatTime.status, 'partial');
  assert.deepEqual(receipt.commercialToolSeatTime.values, {});
  assert.deepEqual(receipt.jobs.unsettledSessionIds, ['job-one']);
  assert.deepEqual(receipt.model.incompleteSessionIds, ['model-open']);
});

test('records from another Run and records beyond the snapshot are excluded', () => {
  const other = { ...base(1), id: 'other-job', runId: 'run-other', type: 'job' as const, event: 'launched' as const, job };
  const future = { ...base(5), id: 'future-job', type: 'job' as const, event: 'launched' as const, job };
  const receipt = valueMeasurementReceipt(run(), [other, future]);
  assert.equal(receipt.throughSeq, 4);
  assert.equal(receipt.jobs.launched.value, 0);
  assert.deepEqual(receipt.jobs.launched.sources, []);
});
