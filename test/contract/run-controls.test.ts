// PLS-06: simultaneous user actions at the real Host service boundary, with actual local Jobs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { himaCommand } from './support/command.ts';
import { jobRecords, killSessions, localFabric, recordsOf, sessionsOf } from './support/fabric.ts';
import { packsDirOf, timingProbePackId } from './support/pack.ts';
import { tmuxHasSession } from './support/tmux.ts';

test('simultaneous resumes clear one blocker once and launch only one replacement Job', async (t) => {
  const local = await localFabric(t, { failures: 1, sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  let runId: string | undefined;
  try {
    const started = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --generations 1 --retries 1 --time-box 0.5`);
    runId = started.runId!;
    assert.equal(started.kind, 'error', 'the real failed Job is reported as a blocked command');
    assert.equal(host.ctx.hima.ledger.run(runId)?.status, 'waiting');
    const blocker = recordsOf(host, runId).find((r) => r.type === 'blocker');
    assert.ok(blocker, 'the failed real Job requires one human decision');
    const answers = await Promise.all([
      host.ctx.hima.resumeRun(runId, 'first-face'),
      host.ctx.hima.resumeRun(runId, 'second-face'),
    ]);
    t.diagnostic(JSON.stringify(answers.map((a) => ({ kind: a.kind, status: a.run.status }))));
    const resumed = recordsOf(host, runId).filter((r) => r.type === 'resumed');
    assert.equal(resumed.length, 1, 'one action clears this blocker, even when two faces resume together');
    assert.equal(resumed[0]?.clears, blocker.id);
    assert.equal(jobRecords(host, runId).filter((r) => r.event === 'launched').length, 2, 'the original failed Job and exactly one retry');
    assert.equal(host.ctx.hima.ledger.run(runId)?.status, 'ended-budget-exhausted');
  } finally {
    if (runId) killSessions(sessionsOf(host, runId));
    await dispose();
  }
});

test('a cancel crossing a resume leaves a terminal Run and no live Job', async (t) => {
  const local = await localFabric(t, { failures: 1, sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  let runId: string | undefined;
  try {
    const started = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --generations 1 --retries 1 --time-box 0.5`);
    runId = started.runId!;
    assert.equal(host.ctx.hima.ledger.run(runId)?.status, 'waiting');
    await Promise.all([host.ctx.hima.resumeRun(runId, 'resuming-face'), host.ctx.hima.cancelRun(runId)]);
    assert.equal(host.ctx.hima.ledger.run(runId)?.status, 'cancelled');
    for (const session of sessionsOf(host, runId)) assert.equal(tmuxHasSession(session), false, 'a crossed action leaves no Job running');
    const before = recordsOf(host, runId);
    assert.equal((await host.ctx.hima.resumeRun(runId, 'late-face')).kind, 'not-waiting');
    assert.equal((await host.ctx.hima.cancelRun(runId)).kind, 'ended');
    assert.deepEqual(recordsOf(host, runId), before, 'later actions cannot resurrect or rewrite the terminal Run');
  } finally {
    if (runId) killSessions(sessionsOf(host, runId));
    await dispose();
  }
});

test('a failed resume admission does not prevent a later corrected request', async (t) => {
  const local = await localFabric(t, { failures: 1, sleepSeconds: 0 });
  if (!local) return;
  const { h, host, dispose } = local;
  let runId: string | undefined;
  const pack = path.join(packsDirOf(h), timingProbePackId);
  try {
    const started = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --generations 1 --retries 1 --time-box 0.5`);
    runId = started.runId!;
    const before = recordsOf(host, runId);
    await rename(pack, `${pack}.held`);
    try {
      await assert.rejects(() => host.ctx.hima.resumeRun(runId!, 'missing-pack'), /pack/i);
      assert.deepEqual(recordsOf(host, runId), before, 'failed validation changes no history');
    } finally { await rename(`${pack}.held`, pack); }
    assert.equal((await host.ctx.hima.resumeRun(runId, 'corrected-face')).kind, 'resumed');
    assert.equal(recordsOf(host, runId).filter((r) => r.type === 'resumed').length, 1);
  } finally {
    if (runId) killSessions(sessionsOf(host, runId));
    await dispose();
  }
});
