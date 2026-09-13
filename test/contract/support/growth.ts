// Real Host growth fixture reused by L2, native-window and bounded live-model checks.
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { packDigestOf, type ExecutionActionRequest, type ExecutionContext, type GrowthProposal, type LedgerRecord } from '@hima/harness';
import { bootInProcess, createRootAgent } from './boot-inprocess.ts';
import { killSessions, localHome, recordsOf, sessionsOf, waitUntil } from './fabric.ts';
import { packsDirOf, writePackVariant } from './pack.ts';

export function identity(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item !== null && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, stable(field)]))
      : item;
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export async function prepared(t: TestContext, timeBoxMs = 120_000, attemptLimit?: number, closingReserveMs = 0, targetPeriodNs = 2) {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const pack = 'growth-host';
  await writePackVariant(packsDirOf(home.h), pack, attemptLimit === undefined && closingReserveMs === 0 ? [] : [['words:', `budget:\n  closingReserveMs: ${closingReserveMs}\n  attemptLimit: ${String(attemptLimit ?? 1000)}\nwords:`]], [['chooser: over-constraining-push', 'chooser: over-constraining-push\n      growth: true']]);
  const referenceDigest = packDigestOf(`${packsDirOf(home.h)}/${pack}`);
  const host = await bootInProcess(home.h);
  const agent = await createRootAgent(host.ctx, home.h.workspace);
  const started = await host.ctx.hima.startRun({ pack, site: 'local', ownerSessionId: String(agent.id), goal: { target_period_ns: targetPeriodNs }, strategy: { periodNs: 2.3 }, generationLimit: 2, timeBoxMs });
  assert.equal(started.kind, 'ran', JSON.stringify(started));
  if (started.kind !== 'ran') throw new Error('unreachable');
  const runId = started.run.id;
  let sequence = 0;
  const context = (): ExecutionContext => host.ctx.hima.executionContext(runId);
  const call = (fields: Omit<ExecutionActionRequest, 'runId' | 'actor' | 'expectedEpoch' | 'expectedRevision' | 'requestId'>, requestId = `growth-${++sequence}`) => {
    const control = context().run.control!;
    return host.ctx.hima.executionAction({ runId, actor: String(agent.id), expectedEpoch: control.epoch, expectedRevision: control.revision, requestId, ...fields });
  };
  const node = async (nodeId: string) => {
    const begun = await call({ action: 'begin', nodeId });
    assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
    const executionId = begun.receipt?.executionId!;
    assert.equal((await call({ action: 'work', executionId })).kind, 'accepted');
    await waitUntil(`${nodeId} ready`, () => context().executions.some((execution) => execution.id === executionId && ['ready', 'failed'].includes(execution.phase)), 20_000, 20);
    const execution = context().executions.find((item) => item.id === executionId)!;
    assert.equal(execution.phase, 'ready', JSON.stringify(execution));
    const complete = await call({ action: 'complete', executionId });
    assert.equal(complete.kind, 'accepted', JSON.stringify(complete));
  };
  const reachGrowth = async () => { for (const id of ['synthesize', 'read-qor', 'judge']) await node(id); assert.deepEqual(context().available, ['next-period']); };
  const proposal = (proposalId = 'critical-cell-probe'): GrowthProposal => {
    const run = context().run;
    let facts: LedgerRecord[] = recordsOf(host, runId).filter((record) =>
      (record.type === 'observation' || record.type === 'verdict') && record.generation === run.generation && record.loopId === undefined);
    if (facts.length === 0) facts = recordsOf(host, runId).filter((record) => record.type === 'workspace');
    return {
      proposalId,
      method: { id: pack, version: '2', digest: run.packDigest! },
      parent: { nodeId: 'next-period', generation: run.generation! }, inputThroughSeq: run.nextSeq - 1,
      inputs: facts.map((record) => ({ recordId: record.id, contentIdentity: identity(record) })),
      impactNodes: ['synthesize', 'read-qor', 'judge', 'next-period'],
      expectedChanges: ['measure one additional synthesis point before the reference chooser runs'],
      nodes: [
        { id: 'growth-synthesize', kind: 'act', parameters: { tool: 'synth', arguments: { PERIOD_NS: { from: 'strategy', name: 'periodNs' } } } },
        { id: 'growth-read', kind: 'act', parameters: { observes: 'qorReport', arguments: {} } },
        { id: 'growth-judge', kind: 'judge', parameters: { rules: ['setup-wns-all-nonnegative', 'clock-period-at-most'], bind: { target_period_ns: { from: 'goal', name: 'target_period_ns' } } } },
      ],
      edges: [
        { from: 'growth-synthesize', to: 'growth-read' }, { from: 'growth-read', to: 'growth-judge' },
        { from: 'growth-judge', to: 'next-period', outcome: 'PASS' }, { from: 'growth-judge', to: 'next-period', outcome: 'FAIL' },
        { from: 'growth-judge', to: 'next-period', outcome: 'UNDETERMINED' },
      ],
      requiredOutputs: ['qorReport'], endCondition: 'current observation and both verdicts are recorded', returnNode: 'next-period', optional: true,
    };
  };
  return { home, host, agent, pack, runId, referenceDigest, context, call, node, reachGrowth, proposal };
}

export async function dispose(fixture: Awaited<ReturnType<typeof prepared>>) {
  try { await fixture.host.ctx.hima.cancelRun(fixture.runId); }
  finally { killSessions(sessionsOf(fixture.host, fixture.runId)); await fixture.host.dispose(); await fixture.home.h.dispose(); }
}

