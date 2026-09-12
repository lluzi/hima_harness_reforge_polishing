// PLS-19 controls: real Host, isolated local Jobs, no external model or desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { findOnPath } from './support/tmux.ts';
import { localHome, waitUntil, sessionsOf } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('a human in another live conversation can promptly cancel a long Job without taking ownership', async (t) => {
  const home = await localHome(t, { sleepSeconds: 15 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const other = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'begin-long', action: 'begin', nodeId: started.run.currentNode });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    assert.equal((await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'work-long', action: 'work', executionId })).kind, 'accepted');
    const request = { runId, actor: String(other.id), expectedEpoch: 1, expectedRevision: 2, requestId: 'human-stop', action: 'cancel' as const };
    assert.equal((await host.ctx.hima.executionAction({ ...request, origin: 'agent' })).kind, 'refused');
    const before = Date.now();
    const accepted = await host.ctx.hima.executionAction({ ...request, origin: 'human' });
    assert.equal(accepted.kind, 'accepted');
    assert.ok(Date.now() - before < 1500, 'control receipt returns without waiting for the long Job');
    assert.equal(accepted.receipt?.requestId, 'human-stop');
    assert.equal(accepted.context.run.control?.requests['human-stop']?.state, 'admitted');
    assert.equal(accepted.context.run.control?.owner, String(owner.id));
    assert.equal(accepted.context.run.control?.epoch, 1);
    assert.deepEqual(accepted.context.run.control?.paused, ['*']);
    const duplicate = await host.ctx.hima.executionAction({ ...request, origin: 'human' });
    assert.equal(duplicate.kind, 'duplicate');
    assert.equal((await host.ctx.hima.executionAction({ ...request, origin: 'human', nodeId: started.run.currentNode })).kind, 'refused');
    await waitUntil('the actual Job stop and its final request receipt are recorded', () => {
      const current = host.ctx.hima.executionContext(runId!).run;
      return current.status === 'cancelled' && current.control?.requests['human-stop']?.state === 'done';
    }, 8000);
    const run = host.ctx.hima.executionContext(runId).run;
    assert.equal(run.control?.requests['human-stop']?.state, 'done');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'cancel' }).length, 1);
    assert.equal(sessionsOf(host, runId).length, 1);
    const stop = host.ctx.hima.ledger.records({ runId, type: 'job' }).find((record) => record.type === 'job' && record.event === 'killed');
    assert.ok(stop, 'cancelled is supported by an actual killed Job record');
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('retry allowance blocks the failed node until its human owner clears that node', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01, failures: 9 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, retryAllowance: 2, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let counter = 0;
    const act = (action: 'begin' | 'work' | 'continue', executionId?: string, origin: 'agent' | 'human' = 'agent', nodeId = started.run.currentNode) => {
      const control = host.ctx.hima.executionContext(runId!).run.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), action, executionId, nodeId, origin, expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `retry-${++counter}` });
    };
    for (let attempt = 1; attempt <= 2; attempt++) {
      const begun = await act('begin');
      assert.equal(begun.kind, 'accepted');
      const executionId = begun.receipt?.executionId;
      assert.ok(executionId);
      assert.equal((await act('work', executionId)).kind, 'accepted');
      await waitUntil('the failed attempt is recorded', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'failed'), 8000);
    }
    assert.equal(sessionsOf(host, runId).length, 2);
    const blocked = host.ctx.hima.executionContext(runId);
    assert.equal(blocked.run.currentNode, started.run.currentNode, 'a failure does not make a business move into Pack wait');
    assert.deepEqual(blocked.available, []);
    assert.equal((await act('begin')).kind, 'refused');
    const anotherNode = blocked.nodes.find((node) => node.id !== started.run.currentNode);
    assert.ok(anotherNode);
    assert.equal((await act('continue', undefined, 'human', anotherNode.id)).kind, 'accepted');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'resumed' }).length, 0, 'continuing a different scope grants no retry allowance');
    assert.equal((await act('begin')).kind, 'refused');
    assert.equal((await act('continue')).kind, 'refused', 'the Agent cannot manufacture human clearance');
    assert.equal((await act('continue', undefined, 'human')).kind, 'accepted');
    const afterClearance = host.ctx.hima.executionContext(runId).run;
    assert.equal(afterClearance.createdAt, started.run.createdAt);
    assert.deepEqual(afterClearance.budget, started.run.budget);
    assert.deepEqual(afterClearance.goal, started.run.goal);
    assert.equal(afterClearance.generation, started.run.generation);
    const third = await act('begin');
    assert.equal(third.kind, 'accepted');
    assert.equal(third.context.executions.find((execution) => execution.id === third.receipt?.executionId)?.attempt, 3);
    assert.equal(third.context.run.meters?.attempts, 3, 'human clearance never refunds total attempts');
    for (const attempt of [third, undefined]) {
      const next = attempt ?? await act('begin');
      assert.equal(next.kind, 'accepted');
      const executionId = next.receipt?.executionId;
      assert.ok(executionId);
      assert.equal((await act('work', executionId)).kind, 'accepted');
      await waitUntil('the new allowance records its failed attempt', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'failed'), 8000);
    }
    assert.equal(sessionsOf(host, runId).length, 4);
    assert.equal((await act('begin')).kind, 'refused', 'human clearance grants the same finite allowance');
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

for (const restart of [false, true]) test(`the total time box expires while paused${restart ? ' with the Agent offline after Host restart' : ' without any next Agent action'}`, async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  let host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, timeBoxMs: 1400, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const paused = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'pause-deadline', action: 'pause' });
    assert.equal(paused.kind, 'accepted');
    if (restart) {
      await host.dispose();
      host = await bootInProcess(home.h);
      await host.ctx.hima.reconciled;
      assert.equal(host.ctx.get('agents')?.list().length, 0);
    }
    await waitUntil('the hard time box ends the idle Run', () => host.ctx.hima.executionContext(runId!).run.status === 'ended-budget-exhausted', 6000);
    const expired = host.ctx.hima.executionContext(runId).run;
    assert.equal(expired.meters?.endedBy, 'time-box');
    assert.equal(expired.control?.owner, String(owner.id));
    assert.equal(expired.createdAt, started.run.createdAt);
    assert.deepEqual(expired.budget, started.run.budget);
    assert.equal(sessionsOf(host, runId).length, 0);
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('cancel and launch use the same admission order and a stale cancel cannot kill unacknowledged work', async (t) => {
  for (const cancelFirst of [true, false]) {
    const home = await localHome(t, { sleepSeconds: 12 });
    assert.ok(home);
    const host = await bootInProcess(home.h);
    let runId: string | undefined;
    try {
      const owner = await createRootAgent(host.ctx, home.h.workspace);
      const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
      assert.equal(started.kind, 'ran');
      if (started.kind !== 'ran') return;
      runId = started.run.id;
      const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'race-begin', action: 'begin', nodeId: started.run.currentNode });
      const work = { runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'race-work', action: 'work' as const, executionId: begun.receipt?.executionId };
      const cancel = { runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'race-stop', action: 'cancel' as const };
      const [first, second] = await Promise.all((cancelFirst ? [cancel, work] : [work, cancel]).map((request) => host.ctx.hima.executionAction(request)));
      assert.ok(first); assert.ok(second);
      assert.equal(first.kind, 'accepted');
      assert.equal(second.kind, 'refused');
      assert.equal(sessionsOf(host, runId).length, cancelFirst ? 0 : 1);
      if (!cancelFirst) {
        assert.equal(host.ctx.hima.ledger.records({ runId, type: 'cancel' }).length, 0, 'the stale cancellation produces no stop');
        assert.equal((await host.ctx.hima.executionAction({ ...cancel, expectedRevision: 2 })).kind, 'accepted');
      }
      await waitUntil('the admitted stop settles', () => host.ctx.hima.executionContext(runId!).run.status === 'cancelled', 8000);
      assert.equal(sessionsOf(host, runId).length, cancelFirst ? 0 : 1);
    } finally {
      if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
      await host.dispose(); await home.h.dispose();
    }
  }
});

test('hard deadline stops an existing long Job and records the time box as the cause', async (t) => {
  const home = await localHome(t, { sleepSeconds: 12 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, timeBoxMs: 1800, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'deadline-begin', action: 'begin', nodeId: started.run.currentNode });
    assert.equal((await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'deadline-work', action: 'work', executionId: begun.receipt?.executionId })).kind, 'accepted');
    await waitUntil('deadline records the actual stop', () => host.ctx.hima.executionContext(runId!).run.status === 'ended-budget-exhausted', 8000);
    assert.equal(sessionsOf(host, runId).length, 1);
    assert.equal(host.ctx.hima.executionContext(runId).run.meters?.endedBy, 'time-box');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'killed').length, 1);
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('an unknown launch remains fenced and truthfully uncertain when the hard deadline arrives', async (t) => {
  const home = await localHome(t, { sleepSeconds: 8 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  const savedPath = process.env.PATH!;
  const realTmux = findOnPath('tmux', savedPath);
  assert.ok(realTmux);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, timeBoxMs: 1500, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'unknown-begin', action: 'begin', nodeId: started.run.currentNode });
    const bin = path.join(home.h.home, 'lost-launch-bin');
    const launched = path.join(home.h.home, 'launch-was-dispatched');
    const quoted = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'";
    await mkdir(bin);
    // The real tmux server starts the private Job, but the acknowledgement is lost and subsequent
    // probes are unreadable. A caught pre-dispatch storage exception cannot simulate this state.
    await writeFile(path.join(bin, 'tmux'), `#!/bin/sh
if [ "$1" = new-session ]; then
  ${quoted(realTmux)} "$@" > ${quoted(launched)} || exit $?
  echo 'private test lost launch acknowledgement' >&2
  exit 75
fi
if [ "$1" = has-session ] && [ -f ${quoted(launched)} ]; then
  echo 'private test cannot reach the launched session' >&2
  exit 75
fi
exec ${quoted(realTmux)} "$@"
`, { mode: 0o755 });
    process.env.PATH = `${bin}:${savedPath}`;
    const work = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'unknown-work', action: 'work', executionId: begun.receipt?.executionId });
    assert.equal(work.kind, 'accepted');
    assert.equal(work.context.executions[0]?.phase, 'uncertain');
    assert.ok(existsSync(launched));
    const intent = work.context.executions[0]!.intent!;
    assert.ok(intent);
    execFileSync(realTmux, ['has-session', '-t', `=${intent.job.session}`], { env: { ...process.env, PATH: savedPath } });
    await waitUntil('the deadline exposes its unconfirmed stop', () => host.ctx.hima.executionContext(runId!).run.control?.stop?.status === 'uncertain', 6000);
    const context = host.ctx.hima.executionContext(runId);
    assert.notEqual(context.run.status, 'cancelled');
    assert.notEqual(context.run.status, 'ended-budget-exhausted');
    assert.equal(context.executions[0]?.phase, 'uncertain');
    assert.deepEqual(context.executions[0]?.intent, intent, 'a dispatched but unreadable launch keeps its durable identity');
    assert.equal(context.run.control?.stop?.reason, 'budget');
    assert.equal(sessionsOf(host, runId).length, 0, 'the lost receipt is not invented');
    const control = context.run.control!;
    const retry = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: 'unknown-retry', action: 'begin', nodeId: started.run.currentNode });
    assert.equal(retry.kind, 'refused');
  } finally {
    process.env.PATH = savedPath;
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('pending stop I/O does not hold the conversational admission path', async (t) => {
  const home = await localHome(t, { sleepSeconds: 12 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const appendCancel = host.ctx.hima.ledger.appendCancel.bind(host.ctx.hima.ledger);
  let stopping = false;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'pending-begin', action: 'begin', nodeId: started.run.currentNode });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    assert.equal((await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'pending-work', action: 'work', executionId })).kind, 'accepted');
    // Only delay the stop's record I/O; the Host, queue, original Job and eventual kill are real.
    host.ctx.hima.ledger.appendCancel = async (...args) => { stopping = true; await gate; return appendCancel(...args); };
    const request = { runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 2, requestId: 'pending-stop', action: 'cancel' as const };
    assert.equal((await host.ctx.hima.executionAction(request)).kind, 'accepted');
    await waitUntil('the asynchronous stop reaches its delayed I/O', () => stopping, 3000);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const [duplicate, denied] = await Promise.race([
        Promise.all([host.ctx.hima.executionAction(request), host.ctx.hima.executionAction({ ...request, expectedRevision: 3, requestId: 'pending-denied-work', action: 'work', executionId })]),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('pending stop I/O held the business admission queue')), 1000); }),
      ]);
      assert.equal(duplicate.kind, 'duplicate');
      assert.equal(denied.kind, 'refused');
      assert.match(denied.reason ?? '', /stop request/);
      assert.equal(host.ctx.hima.executionContext(runId).run.control?.requests['pending-stop']?.state, 'admitted');
    } finally { clearTimeout(timer); release(); }
    await waitUntil('the released stop confirms its original Job', () => host.ctx.hima.executionContext(runId!).run.status === 'cancelled', 8000);
  } finally {
    release(); host.ctx.hima.ledger.appendCancel = appendCancel;
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});
