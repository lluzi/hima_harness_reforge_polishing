// PLS-19: real Host and private local Jobs; replay guards, no real model or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { findOnPath } from './support/tmux.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { writeMomentFixture } from './support/moments.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { timingProbePackId } from './support/pack.ts';

// These deterministic protocol calls do not ask an external model to react to Job notifications.
process.env.HIMA_TEST_SILENT_AGENT = '1';

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

test('the same Agent launches one node, pauses during its Job, validates completion and explicitly chooses the next node', async (t) => {
  const home = await localHome(t, { sleepSeconds: 2 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    let nextRequest = 0;
    const act = (action: 'begin' | 'work' | 'complete' | 'pause' | 'continue', executionId?: string, nodeId?: string) => {
      const control = host.ctx.hima.ledger.run(runId!)!.control!;
      return host.ctx.hima.executionAction({ runId: runId!, actor: String(owner.id), expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `act-${++nextRequest}`, action, executionId, nodeId });
    };
    const begun = await act('begin', undefined, started.run.currentNode);
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    assert.equal((await act('complete', executionId)).kind, 'refused', 'words cannot finish a node that ran no tool');
    const worked = await act('work', executionId);
    assert.equal(worked.kind, 'accepted');
    assert.equal(worked.context.executions.find((execution) => execution.id === executionId)?.phase, 'working');
    const paused = await act('pause');
    assert.equal(paused.kind, 'accepted');
    assert.deepEqual(paused.context.available, []);
    await waitUntil('the Job result is available while business advancement stays paused', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === executionId && execution.phase === 'ready'));
    assert.equal(host.ctx.hima.ledger.run(runId)?.currentNode, started.run.currentNode);
    assert.equal((await act('complete', executionId)).kind, 'refused');
    assert.equal((await act('continue')).kind, 'accepted');
    const complete = await act('complete', executionId);
    assert.equal(complete.kind, 'accepted');
    assert.notEqual(complete.context.run.currentNode, started.run.currentNode);
    const launches = () => host.ctx.hima.ledger.records({ runId: runId!, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched');
    assert.equal(launches().length, 1, 'completing a node does not launch its successor');
    const reading = await act('begin', undefined, complete.context.run.currentNode);
    const readId = reading.receipt?.executionId;
    assert.ok(readId);
    assert.equal((await act('work', readId)).kind, 'accepted');
    await waitUntil('the requested observation is ready', () => host.ctx.hima.executionContext(runId!).executions.some((execution) => execution.id === readId && execution.phase === 'ready'));
    assert.equal((await act('complete', readId)).kind, 'accepted');
    assert.equal(launches().length, 1);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'observation' }).length, 1);
  } finally {
    if (runId !== undefined) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
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


test('an owned Run refuses separate model moments while waiting, cancelled or budget-ended before opening any session', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  // A regression can only reach the local one-turn replay, never an external model.
  const replay = await writeMomentFixture(home.h, 'one-turn');
  await writeReplayOverlay(home.h.home, { file: replay.file, overrideFile: replay.override });
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    for (const status of ['waiting', 'cancelled', 'ended-budget-exhausted'] as const) {
      await host.ctx.hima.ledger.advanceRun(started.run.id, { status });
      const before = host.ctx.hima.ledger.records({ runId: started.run.id });
      const agents = host.ctx.get('agents')!.list().map((agent) => agent.id);
      await assert.rejects(host.ctx.hima.openMoment(started.run.id, 'inspect this node'), /controlled.*conversation|conversation.*controlled/i);
      assert.deepEqual(host.ctx.hima.ledger.records({ runId: started.run.id }), before, 'the refused request opens no model-moment session');
      assert.deepEqual(host.ctx.get('agents')!.list().map((agent) => agent.id), agents, 'the owner remains the only Agent');
    }
  } finally { await host.dispose(); await home.h.dispose(); }
});


for (const boundary of ['Site probe', 'intent persistence'] as const) test(`a delayed actual ${boundary} that crosses the Campaign deadline dispatches no Job and leaves no phantom Site reservation`, async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  let host = await bootInProcess(home.h);
  const savedPath = process.env.PATH!;
  const realTmux = findOnPath('tmux', savedPath);
  assert.ok(realTmux);
  const bin = path.join(home.h.home, 'delayed-site-bin');
  const entered = path.join(home.h.home, 'prelaunch-entered');
  const release = path.join(home.h.home, 'prelaunch-release');
  const dispatches = path.join(home.h.home, 'tmux-dispatches');
  const quoted = (word: string) => "'" + word.replaceAll("'", "'\\''") + "'";
  await fs.mkdir(bin);
  // Real process boundary: delay one actual name probe; log and pass through any launch command.
  await fs.writeFile(path.join(bin, 'tmux'), `#!/bin/sh
if [ "$1" = has-session ] && [ '${boundary}' = 'Site probe' ] && [ ! -f ${quoted(entered)} ]; then
  printf entered > ${quoted(entered)}
  while [ ! -f ${quoted(release)} ]; do sleep 0.02; done
fi
if [ "$1" = new-session ]; then printf '%s\\n' "$*" >> ${quoted(dispatches)}; fi
exec ${quoted(realTmux)} "$@"
`, { mode: 0o755 });
  let restoreDisk = () => {};
  let working: Promise<unknown> | undefined;
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const prepared = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id), timeBoxMs: 8000 });
    assert.equal(prepared.kind, 'ran');
    if (prepared.kind !== 'ran') return;
    runId = prepared.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'delayed-begin', action: 'begin', nodeId: prepared.run.currentNode });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    if (boundary === 'intent persistence') {
      // Only delay the external filesystem's real atomic replacement carrying the launch intent.
      // Ledger admission, serialization, write/fsync and recovery all retain their real semantics.
      const rename = fs.rename;
      let delayed = false;
      const interception = t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
        let hold = false;
        if (!delayed && String(args[1]) === path.join(home.h.home, 'storages/hima_ledger.json')) {
          const data = JSON.parse(await fs.readFile(args[0], 'utf8'));
          hold = data.tables?.runs?.[runId!]?.control?.executions?.[executionId]?.intent !== undefined;
        }
        await rename(...args);
        if (hold) {
          delayed = true;
          await fs.writeFile(entered, 'the actual intent replacement landed');
          await waitUntil('the test releases delayed filesystem I/O', () => existsSync(release), 10_000, 20);
        }
      });
      syncBuiltinESMExports();
      restoreDisk = () => { interception.mock.restore(); syncBuiltinESMExports(); };
    }
    process.env.PATH = `${bin}:${savedPath}`;
    const request = { runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'delayed-work', action: 'work' as const, executionId };
    let response: Awaited<ReturnType<typeof host.ctx.hima.executionAction>> | undefined;
    working = host.ctx.hima.executionAction(request).then((answer) => { response = answer; return answer; });
    await waitUntil('the actual prelaunch boundary is blocked or work answers', () => existsSync(entered) || response !== undefined, 6000, 20);
    assert.ok(existsSync(entered), `work never reached the intended external boundary: ${JSON.stringify({ kind: response?.kind, reason: response?.reason, state: response?.context.run.status })}`);
    const deadline = Date.parse(prepared.run.createdAt) + prepared.run.budget!.timeBoxMs!;
    assert.ok(Date.now() < deadline, 'the work reached the I/O boundary inside its admitted budget');
    await waitUntil('the original budget expires during prelaunch I/O', () => Date.now() > deadline + 30, 10_000, 20);
    await fs.writeFile(release, 'release');
    await working;
    restoreDisk();
    assert.equal(existsSync(dispatches), false, 'even a tmux new-session dispatch after the deadline is forbidden');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
    await waitUntil('the budget stop records a definite no-launch ending', () => host.ctx.hima.executionContext(runId!).run.status === 'ended-budget-exhausted', 4000);
    const ended = host.ctx.hima.executionContext(runId);
    assert.equal(ended.executions.find((execution) => execution.id === executionId)?.intent, undefined, 'a veto before dispatch must not reserve a phantom Site job');
    assert.equal(ended.run.control?.requests['delayed-work']?.state, 'done');
    assert.equal(ended.run.meters?.jobsLaunched ?? 0, 0);
    assert.equal((await host.ctx.hima.executionAction(request)).kind, 'duplicate', 'the known no-launch request is settled rather than replayed');
    await host.dispose();
    host = await bootInProcess(home.h);
    await host.ctx.hima.reconciled;
    assert.equal(existsSync(dispatches), false, 'restart does not automatically launch expired work');
    assert.equal(host.ctx.hima.executionContext(runId).executions.find((execution) => execution.id === executionId)?.intent, undefined);
    const nextOwner = await createRootAgent(host.ctx, home.h.workspace);
    const next = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(nextOwner.id) });
    assert.equal(next.kind, 'ran');
    if (next.kind !== 'ran') return;
    const nextBegin = await host.ctx.hima.executionAction({ runId: next.run.id, actor: String(nextOwner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'free-site-begin', action: 'begin', nodeId: next.run.currentNode });
    await host.ctx.hima.executionAction({ runId: next.run.id, actor: String(nextOwner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'free-site-work', action: 'work', executionId: nextBegin.receipt?.executionId });
    assert.equal(host.ctx.hima.ledger.records({ runId: next.run.id, type: 'job' }).filter((record) => record.type === 'job' && record.event === 'launched').length, 1, 'a later explicit Run can use the Site');
    await waitUntil('the later explicitly launched Job finishes before test cleanup', () => host.ctx.hima.executionContext(next.run.id).executions.some((execution) => execution.id === nextBegin.receipt?.executionId && execution.phase === 'ready'));
    await host.ctx.hima.cancelRun(next.run.id);
  } finally {
    await fs.writeFile(release, 'release');
    await working?.catch(() => undefined);
    restoreDisk(); process.env.PATH = savedPath;
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});


for (const status of ['waiting', 'cancelled'] as const) test(`production refuses a standalone moment on a historical ${status} Run before any session is composed`, async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const replay = await writeMomentFixture(home.h, 'one-turn');
  await writeReplayOverlay(home.h.home, { file: replay.file, overrideFile: replay.override });
  const host = await bootInProcess(home.h);
  const legacyFlag = process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const prepared = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(prepared.kind, 'ran');
    if (prepared.kind !== 'ran') return;
    await host.ctx.hima.ledger.advanceRun(prepared.run.id, { control: undefined, status });
    delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
    const run = host.ctx.hima.ledger.run(prepared.run.id);
    const records = host.ctx.hima.ledger.records({ runId: prepared.run.id });
    const agents = host.ctx.get('agents')!.list().map((agent) => agent.id);
    await assert.rejects(host.ctx.hima.openMoment(prepared.run.id, 'inspect the historical node'), /standalone historical model moments are unavailable/);
    assert.deepEqual(host.ctx.hima.ledger.run(prepared.run.id), run);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: prepared.run.id }), records, 'no opened or closed session can be recorded by this request');
    assert.deepEqual(host.ctx.get('agents')!.list().map((agent) => agent.id), agents, 'no second Agent is composed');
  } finally {
    if (legacyFlag === undefined) delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
    else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = legacyFlag;
    await host.dispose(); await home.h.dispose();
  }
});
