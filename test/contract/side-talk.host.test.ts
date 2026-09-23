// PLS-32: a real Host keeps one Campaign owner while another live session continues ordinary work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';
import path from 'node:path';
import { executionAction as performExecutionAction } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('a Side Talk can read and code during one owner Run, but only a safe handoff changes its owner epoch', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const sideTalk = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({
      pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id),
    });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    const runId = started.run.id;

    const begin = await host.ctx.hima.executionAction({
      runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0,
      requestId: 'owner-begin', action: 'begin', nodeId: started.run.currentNode,
    });
    assert.equal(begin.kind, 'accepted', begin.reason);
    const executionId = begin.receipt?.executionId;
    assert.ok(executionId);
    const work = await host.ctx.hima.executionAction({
      runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1,
      requestId: 'owner-work', action: 'work', executionId,
    });
    assert.equal(work.kind, 'accepted', work.reason);

    await waitUntil('the owner Job is actually in flight', () =>
      host.ctx.hima.executionContext(runId).executions.some((execution) => execution.id === executionId && execution.phase === 'working'), 8_000);
    const beforeSideTalk = host.ctx.hima.executionContext(runId).run.control!;
    const coding = await host.ctx.tools.execute({
      callId: 'side-talk-coding' as never, name: 'write',
      arguments: { file_path: 'side-talk-note.txt', content: 'ordinary Side Talk coding remains available' },
      agent: sideTalk, signal: AbortSignal.timeout(30_000),
    });
    assert.equal(coding.isError, false, JSON.stringify(coding));
    const reading = await host.ctx.tools.execute({
      callId: 'side-talk-context' as never, name: 'hima_context', arguments: { run: runId },
      agent: sideTalk, signal: AbortSignal.timeout(30_000),
    });
    assert.equal(reading.isError, false, JSON.stringify(reading));
    const sideTalkContext = JSON.parse(reading.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as {
      run: { control: { owner: string; epoch: number; revision: number } };
    };
    const viewed = host.ctx.hima.executionContext(runId);
    assert.equal(sideTalkContext.run.control.owner, String(owner.id));
    assert.equal(sideTalkContext.run.control.epoch, beforeSideTalk.epoch);
    assert.equal(sideTalkContext.run.control.revision, beforeSideTalk.revision);
    assert.equal(viewed.run.control?.owner, String(owner.id), 'reading from Side Talk never rebinds the persistent Run');
    assert.equal(viewed.run.control?.epoch, beforeSideTalk.epoch);
    assert.equal(viewed.run.control?.revision, beforeSideTalk.revision);
    assert.ok(viewed.executions.some((execution) => execution.id === executionId && execution.phase === 'working'));
    const stolen = await host.ctx.hima.executionAction({
      runId, actor: String(sideTalk.id), expectedEpoch: beforeSideTalk.epoch, expectedRevision: beforeSideTalk.revision,
      requestId: 'side-talk-begin', action: 'begin', nodeId: started.run.currentNode,
    });
    assert.equal(stolen.kind, 'refused');
    assert.match(stolen.reason ?? '', /owner or owner epoch is stale/);
    assert.equal(host.ctx.hima.ledger.runs().length, 1, 'two conversations do not create or replace the Campaign Run');

    // A Side Talk is not allowed to begin node work, but a human using it may pause the Campaign
    // immediately.  The durable owner and epoch stay with A; only an explicit safe handoff changes
    // them.
    const pauseContext = host.ctx.hima.executionContext(runId).run.control!;
    const paused = await host.ctx.hima.executionAction({
      runId, actor: String(sideTalk.id), origin: 'human', expectedEpoch: pauseContext.epoch, expectedRevision: pauseContext.revision,
      requestId: 'side-talk-pause', action: 'pause',
    });
    assert.equal(paused.kind, 'accepted', paused.reason);
    assert.equal(paused.context.run.control?.owner, String(owner.id));
    assert.equal(paused.context.run.control?.epoch, pauseContext.epoch);
    assert.deepEqual(paused.context.run.control?.paused, ['*']);

    await waitUntil('the owner Job settles at a handoff boundary', () =>
      host.ctx.hima.executionContext(runId).executions.some((execution) => execution.id === executionId && execution.phase === 'ready'), 8_000);
    const boundary = host.ctx.hima.executionContext(runId).run.control!;
    const notifications: Array<{ owner: string; detail?: string }> = [];
    const handoff = await performExecutionAction({ ledger: host.ctx.hima.ledger, judge: host.ctx.hima.judge,
      sitesDir: path.join(home.h.home, 'hima/sites'), packsDir: path.join(home.h.home, 'hima/packs'), host: host.ctx,
      notify: (notified, _run, _execution, detail) => {
        notifications.push({ owner: notified, ...(detail === undefined ? {} : { detail }) });
        return { status: 'queued', message: 'Campaign Agent notification queued.' };
      } }, {
      runId, actor: String(owner.id), expectedEpoch: boundary.epoch, expectedRevision: boundary.revision,
      requestId: 'safe-handoff', action: 'handoff', targetOwner: String(sideTalk.id),
    });
    assert.equal(handoff.kind, 'accepted', handoff.reason);
    assert.equal(handoff.context.run.control?.owner, String(sideTalk.id));
    assert.equal(handoff.context.run.control?.epoch, boundary.epoch + 1);
    assert.equal(handoff.notification?.status, 'queued');
    assert.deepEqual(notifications.map((item) => item.owner), [String(sideTalk.id)], 'Host notification follows the durable handoff owner');
    assert.match(notifications[0]?.detail ?? '', /handed to this conversation.*prior owner is fenced/i);
    const staleOwner = await host.ctx.hima.executionAction({
      runId, actor: String(owner.id), expectedEpoch: boundary.epoch, expectedRevision: boundary.revision,
      requestId: 'stale-owner-continue', action: 'continue',
    });
    assert.equal(staleOwner.kind, 'refused');
    assert.match(staleOwner.reason ?? '', /owner or owner epoch is stale/);
    const successor = handoff.context.run.control!;
    const resumed = await host.ctx.hima.executionAction({
      runId, actor: String(sideTalk.id), expectedEpoch: successor.epoch, expectedRevision: successor.revision,
      requestId: 'successor-continue', action: 'continue', origin: 'human',
    });
    assert.equal(resumed.kind, 'accepted', resumed.reason);
  } finally {
    await host.dispose();
    await home.h.dispose();
  }
});
