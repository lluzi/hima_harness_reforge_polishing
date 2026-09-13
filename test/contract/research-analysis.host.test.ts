// L2: actual conversational ownership and Ledger analysis; local Jobs, zero product model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import type { ExecutionActionRequest } from '@hima/harness';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('only the actual owner can record source-linked research analysis; retries and false numeric claims preserve facts', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 }); assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const other = await createRootAgent(host.ctx, home.h.workspace);
    const start = await host.ctx.hima.startRun({ pack: 'opene902-timing-probe', site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(start.kind, 'ran'); if (start.kind !== 'ran') return;
    runId = start.run.id;
    let count = 0;
    const request = (args: Partial<ExecutionActionRequest>): ExecutionActionRequest => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return { runId: runId!, actor: String(owner.id), action: 'begin', expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `analysis-check-${++count}`, ...args };
    };
    for (let node = 0; node < 2; node++) {
      const begun = await host.ctx.hima.executionAction(request({ nodeId: host.ctx.hima.ledger.run(runId)!.currentNode }));
      const executionId = begun.receipt?.executionId; assert.ok(executionId);
      assert.equal((await host.ctx.hima.executionAction(request({ action: 'work', executionId }))).kind, 'accepted');
      await waitUntil('actual local node work is ready', () => host.ctx.hima.executionContext(runId!).executions.some(execution => execution.id === executionId && execution.phase === 'ready'));
      assert.equal((await host.ctx.hima.executionAction(request({ action: 'complete', executionId }))).kind, 'accepted');
    }
    const observations = host.ctx.hima.ledger.records({ runId, type: 'observation' });
    assert.equal(observations.length, 1);
    const source = observations[0]!; assert.equal(source.type, 'observation'); if (source.type !== 'observation') return;
    const analysis = { question: 'What should the next bounded trial discriminate?', hypotheses: ['The next strategy may improve setup timing.'],
      comparisons: ['The proposed trial should keep the same input.'], limitations: ['No new trial has executed.'], nextExperiments: ['Change one declared strategy knob and remeasure.'],
      claims: [{ text: 'This source describes the current local timing fixture.', cites: [source.id], measurements: [] }] };
    const ask = request({ action: 'analyze', nodeId: host.ctx.hima.ledger.run(runId)!.currentNode, analysis });
    assert.equal((await host.ctx.hima.executionAction({ ...ask, actor: String(other.id) })).kind, 'refused');
    assert.equal((await host.ctx.hima.executionAction({ ...ask, analysis: { ...analysis, claims: [{ text: 'Invented.', cites: ['missing-record'], measurements: [] }] } })).kind, 'refused');
    assert.equal((await host.ctx.hima.executionAction({ ...ask, analysis: { ...analysis, claims: [{ text: 'False numeric value.', cites: [source.id], measurements: [{ recordId: source.id, field: 'clock_period', value: -1000, unit: 'ns' }] }] } })).kind, 'refused');
    const accepted = await host.ctx.hima.executionAction(ask);
    assert.equal(accepted.kind, 'accepted', JSON.stringify(accepted));
    assert.equal((await host.ctx.hima.executionAction(ask)).kind, 'duplicate');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'analysis' }).length, 1);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId, type: 'observation' }), observations);
    const identity = 'a'.repeat(64);
    await host.ctx.hima.ledger.appendRevision(runId, { revisionId: 'invalidate-analysis-source', version: 1, event: 'applied',
      proposalDigest: identity, methodIdentity: identity, sourceIdentity: identity, inputIdentity: identity,
      environmentIdentity: identity, changedNodes: ['synthesize'], affectedNodes: ['synthesize', 'read-qor'],
      invalidates: [source.id], reuses: [] });
    const stale = await host.ctx.hima.executionAction(request({ action: 'analyze', nodeId: host.ctx.hima.ledger.run(runId)!.currentNode,
      analysis: { ...analysis, claims: [{ text: 'This superseded observation is current.', cites: [source.id], measurements: [] }] } }));
    assert.equal(stale.kind, 'refused');
    assert.match(stale.reason ?? '', /invalidated by an applied revision/);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'analysis' }).length, 1, 'the earlier analysis remains history; no stale-current analysis is appended');
  } finally { if (runId) await host.ctx.hima.cancelRun(runId); await host.dispose(); await home.h.dispose(); }
});
