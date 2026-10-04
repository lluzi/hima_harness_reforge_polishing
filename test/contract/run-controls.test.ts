// U9: simultaneous controls at the real Host boundary. DBOS alone advances verified tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localFabric, waitUntil } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';
import { confirmAdmission, admissionStatus } from './support/u9-admission.ts';
import { tmuxHasSession } from './support/tmux.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

async function controlledRun(t: Parameters<typeof localFabric>[0]) {
  const local = await localFabric(t, { sleepSeconds: 2 });
  assert.ok(local);
  const admitted = await confirmAdmission(local.host, local.h, timingProbePackId, {
    goal: { target_period_ns: 2 }, budget: { generations: 1, retries: 1, timeBoxMinutes: 0.5 },
  });
  await waitUntil('the original real Job launches', async () => (await admissionStatus(local.host, admitted.guide, admitted.runId)).jobs.some((job: any) => job.event === 'launched'));
  const control = (await local.host.ctx.hima.readExecutionContext(admitted.runId)).run.control!;
  const pause = await local.host.ctx.hima.executionAction({ runId: admitted.runId, actor: control.owner, origin: 'agent',
    action: 'pause', requestId: 'initial-pause', expectedEpoch: control.epoch, expectedRevision: control.revision });
  assert.equal(pause.kind, 'accepted', JSON.stringify(pause));
  return { ...local, ...admitted, paused: pause.context.run.control! };
}

function continuation(local: Awaited<ReturnType<typeof controlledRun>>, requestId: string) {
  return { runId: local.runId, actor: local.paused.owner, origin: 'agent' as const, action: 'continue' as const,
    requestId, expectedEpoch: local.paused.epoch, expectedRevision: local.paused.revision };
}

test('simultaneous duplicate continuations clear one hold without relaunching the original Job', async t => {
  const local = await controlledRun(t);
  try {
    const request = continuation(local, 'same-continue');
    const answers = await Promise.all([local.host.ctx.hima.executionAction(request), local.host.ctx.hima.executionAction(request)]);
    assert.ok(answers.every(answer => ['accepted', 'duplicate'].includes(answer.kind)), JSON.stringify(answers));
    const context = await local.host.ctx.hima.readExecutionContext(local.runId);
    assert.deepEqual(context.run.control?.paused, []);
    assert.equal(context.durable?.controls.filter((control: any) => control.commandId === request.requestId).length, 1);
    const view = await admissionStatus(local.host, local.guide, local.runId);
    assert.equal(view.jobs.filter((job: any) => job.event === 'launched').length, 1, 'control never creates a second physical submit');
  } finally { await local.dispose(); }
});

test('a cancel crossing a continuation reaches proved closure and late control cannot resurrect the Run', async t => {
  const local = await controlledRun(t);
  try {
    const resume = continuation(local, 'crossed-continue');
    const cancel = { ...resume, requestId: 'crossed-cancel', action: 'cancel' as const, origin: 'human' as const };
    const answers = await Promise.all([local.host.ctx.hima.executionAction(resume), local.host.ctx.hima.executionAction(cancel)]);
    // If continue wins the epoch race, a human refreshes the current facts to issue their stop.
    if (answers[1].kind === 'refused') {
      const current = (await local.host.ctx.hima.readExecutionContext(local.runId)).run.control!;
      assert.equal((await local.host.ctx.hima.executionAction({ ...cancel, requestId: 'refreshed-cancel', expectedEpoch: current.epoch, expectedRevision: current.revision })).kind, 'accepted');
    } else assert.ok(['accepted', 'duplicate'].includes(answers[1].kind), JSON.stringify(answers));
    await waitUntil('the accepted cancellation proves original resource closure', async () => (await admissionStatus(local.host, local.guide, local.runId)).run.stopState?.closed === true);
    const context = await local.host.ctx.hima.readExecutionContext(local.runId);
    assert.equal(context.run.status, 'cancelled');
    const view = await admissionStatus(local.host, local.guide, local.runId);
    for (const job of view.jobs.filter((job: any) => job.event === 'launched')) assert.equal(tmuxHasSession(job.job.session), false);
    const current = context.run.control!;
    assert.equal((await local.host.ctx.hima.executionAction({ ...resume, requestId: 'late-continue', expectedEpoch: current.epoch, expectedRevision: current.revision })).kind, 'refused');
    assert.equal((await local.host.ctx.hima.readExecutionContext(local.runId)).run.status, 'cancelled');
  } finally { await local.dispose(); }
});

test('a refused stale control leaves facts unchanged and a corrected current request can continue', async t => {
  const local = await controlledRun(t);
  try {
    const before = await local.host.ctx.hima.readExecutionContext(local.runId);
    const request = continuation(local, 'corrected-continue');
    const wrongOwner = await local.host.ctx.hima.executionAction({ ...request, actor: String(local.guide.id), requestId: 'wrong-owner-continue' });
    assert.equal(wrongOwner.kind, 'refused');
    const denied = await local.host.ctx.hima.executionAction({ ...request, requestId: 'stale-continue', expectedEpoch: local.paused.epoch - 1 });
    assert.equal(denied.kind, 'refused');
    assert.match(denied.reason ?? '', /stale/);
    const after = await local.host.ctx.hima.readExecutionContext(local.runId);
    assert.deepEqual(after.durable?.controls, before.durable?.controls);
    assert.deepEqual(after.run.control, before.run.control);
    assert.equal((await local.host.ctx.hima.executionAction(request)).kind, 'accepted');
    const corrected = await local.host.ctx.hima.readExecutionContext(local.runId);
    assert.deepEqual(corrected.run.control?.paused, []);
    assert.equal(corrected.durable?.controls.filter((control: any) => control.commandId === request.requestId).length, 1);
  } finally { await local.dispose(); }
});
