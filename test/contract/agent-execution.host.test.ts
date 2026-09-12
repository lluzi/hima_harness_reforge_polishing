// PLS-19: real Host and private local Jobs, no model replay or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

test('a conversational owner prepares a Run without executing its first business node', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const agent = await createRootAgent(host.ctx, home.h.workspace);
    const result = await host.ctx.hima.startRun({
      pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 },
      generationLimit: 1, ownerSessionId: String(agent.id),
    });
    assert.equal(result.kind, 'ran');
    if (result.kind !== 'ran') return;
    assert.equal(result.run.status, 'running');
    assert.equal(result.run.control?.owner, String(agent.id));
    assert.equal(result.run.control?.revision, 0);
    assert.equal(host.ctx.hima.ledger.records({ runId: result.run.id, type: 'job' }).length, 0);
    assert.equal(host.ctx.hima.ledger.records({ runId: result.run.id, type: 'node' }).length, 0);
    const stopped = await host.ctx.hima.cancelRun(result.run.id);
    assert.equal(stopped.kind, 'cancelled');
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('pause and an explicit handoff fence old owners without changing Goal or budget', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const next = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    const base = { runId: started.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0 };
    const paused = await host.ctx.hima.executionAction({ ...base, requestId: 'pause-one', action: 'pause', nodeId: started.run.currentNode });
    assert.equal(paused.kind, 'accepted');
    assert.deepEqual(paused.context.available, []);
    const blocked = await host.ctx.hima.executionAction({ ...base, expectedRevision: 1, requestId: 'blocked-begin', action: 'begin', nodeId: started.run.currentNode });
    assert.equal(blocked.kind, 'refused');
    const handed = await host.ctx.hima.executionAction({ ...base, expectedRevision: 1, requestId: 'handoff-one', action: 'handoff', targetOwner: String(next.id) });
    assert.equal(handed.kind, 'accepted');
    assert.equal(handed.context.run.control?.owner, String(next.id));
    assert.equal(handed.context.run.control?.epoch, 2);
    assert.deepEqual(handed.context.run.goal, started.run.goal);
    assert.deepEqual(handed.context.run.budget, started.run.budget);
    const old = await host.ctx.hima.executionAction({ ...base, requestId: 'pause-one', action: 'pause', nodeId: started.run.currentNode });
    assert.equal(old.kind, 'refused');
    const unsupported = await host.ctx.hima.executionAction({ ...base, actor: String(next.id), expectedEpoch: 2, expectedRevision: 2, requestId: 'revision-not-shipped', action: 'revise' });
    assert.equal(unsupported.kind, 'unsupported');
    assert.equal(unsupported.context.run.control?.revision, 2);
    await host.ctx.hima.cancelRun(started.run.id);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('node admission is owned, versioned and idempotent before any Job exists', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const other = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    const request = { runId: started.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'claim-one', action: 'begin' as const, nodeId: started.run.currentNode! };
    const refused = await host.ctx.hima.executionAction({ ...request, actor: String(other.id) });
    assert.equal(refused.kind, 'refused');
    assert.equal(host.ctx.hima.ledger.run(started.run.id)?.control?.revision, 0);
    const [first, duplicate] = await Promise.all([host.ctx.hima.executionAction(request), host.ctx.hima.executionAction(request)]);
    assert.equal(first.kind, 'accepted');
    assert.equal(duplicate.kind, 'duplicate');
    assert.equal(duplicate.receipt?.executionId, first.receipt?.executionId);
    assert.equal(first.context.run.control?.revision, 1);
    const changed = await host.ctx.hima.executionAction({ ...request, nodeId: 'not-the-node' });
    assert.equal(changed.kind, 'refused');
    const stale = await host.ctx.hima.executionAction({ ...request, requestId: 'stale-claim' });
    assert.equal(stale.kind, 'refused');
    assert.equal(host.ctx.hima.ledger.records({ runId: started.run.id, type: 'job' }).length, 0);
    assert.equal(Object.keys(host.ctx.hima.ledger.run(started.run.id)?.control?.executions ?? {}).length, 1);
    await host.ctx.hima.cancelRun(started.run.id);
  } finally { await host.dispose(); await home.h.dispose(); }
});
