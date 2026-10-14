// #105 T20 L2: actual Host process SIGKILL, same Home/private PG,
// production DBOS registry/Store/TaskEffects/Oar port, controlled ordinary Node IO.
// Registered serial recovery contract.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { startLocalDatabase } from '@hima/harness';

function hostProcess(h: HimaHome, mode: 'seed' | 'recover') {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./support/himateam-recovery-worker.ts', import.meta.url)),
    h.home, h.workspace, h.profileDir, mode], { cwd: process.cwd(),
    env: { ...h.env, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? 'child-v8',
      HIMA_TEST_SILENT_AGENT: '1', HIMA_TEST_LEGACY_AUTO_DRIVE: '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let stderr = '';
  child.stdout!.resume(); child.stderr!.on('data', bytes => { stderr += String(bytes); });
  const messages: any[] = [], waiters: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = [];
  const ended = new Promise<void>(resolve => child.once('close', () => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`Host ${mode} exited: ${stderr}`));
    resolve();
  }));
  child.on('message', message => { const waiter = waiters.shift(); if (waiter) waiter.resolve(message); else messages.push(message); });
  const next = async (): Promise<any> => {
    if (messages.length) return messages.shift();
    if (child.exitCode !== null || child.signalCode !== null) throw Error(`Host ${mode} exited: ${stderr}`);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject }; waiters.push(waiter);
      const timer = setTimeout(() => {
        const i = waiters.indexOf(waiter); if (i >= 0) waiters.splice(i, 1);
        reject(Error(`Host ${mode} IPC timed out: ${stderr}`));
      }, 75000);
      waiter.resolve = value => { clearTimeout(timer); resolve(value); };
      waiter.reject = error => { clearTimeout(timer); reject(error); };
    });
  };
  return { child, ended, next, stderr: () => stderr,
    async crash() { assert.equal(child.kill('SIGKILL'), true); await ended; assert.equal(child.signalCode, 'SIGKILL'); },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) { await ended; return; }
      child.send({ action: 'close' });
      let result = await next();
      while (result.stage !== 'closed') result = await next();
      assert.equal(result.pgClosed, true);
      await ended; assert.equal(child.exitCode, 0, stderr);
    } };
}

test('T20 actual Host kill after committed delegated result cold-recovers original result once', { timeout: 180000 }, async t => {
  const h = await createHimaHome({desktopShaped:true});
  let first: ReturnType<typeof hostProcess> | undefined, reopened: ReturnType<typeof hostProcess> | undefined;
  const children: ChildProcess[] = [];
  let closureProved = false;
  let primaryFailure:unknown;
  try {
    first = hostProcess(h, 'seed'); children.push(first.child);
    const before = await first.next();
    assert.equal(before.stage, 'child-committed-before-successor');
    assert.equal(before.pid, first.child.pid, 'kill the actual process containing the Hima Host');
    const boundary = before.boundary;
    const clusterBefore = JSON.parse(await readFile(path.join(h.home, 'hima/database/credentials.json'), 'utf8'));
    await first.crash();
    reopened = hostProcess(h, 'recover'); children.push(reopened.child);
    const after = await reopened.next();
    assert.equal(after.stage, 'recovered'); assert.equal(after.pid, reopened.child.pid);
    assert.notEqual(after.pid, before.pid);
    assert.deepEqual(after.boundary, boundary);
    assert.equal(after.inputEvents.filter((row: any) => row.effectId === boundary.childResult.identity.effectId).length, 1);
    assert.equal(after.inputEvents.filter((row: any) => row.effectId === after.successor.effectId).length, 1);
    const clusterAfter = JSON.parse(await readFile(path.join(h.home, 'hima/database/credentials.json'), 'utf8'));
    assert.equal(clusterAfter.identity, clusterBefore.identity, 'same authoritative private cluster');
    assert.equal(clusterAfter.port, clusterBefore.port);
    await reopened.close(); closureProved = true;
    t.diagnostic(JSON.stringify({ level: 'L2-controlled-ordinary-Node', hostBoots: 2,
      hostKilledBy: 'SIGKILL', runId: boundary.runId, taskId: boundary.taskId,
      childEffectId: boundary.childResult.identity.effectId, successorEffectId: after.successor.effectId,
      engineeringInputs: 2, resultInputs: 1, qualification: 'L4 Pi/OpenCode SDK/model remains unrun' }));
  } catch(error) {primaryFailure=error;await writeFile(path.join(h.home,'t20-failure.txt'),String(error)+'\n'+[first?.stderr(),reopened?.stderr()].filter(Boolean).join('\n'),{mode:0o600});throw error;} finally {
    // Ask each live test-owned Host to run its actual Local/runtime/PG closer.
    // Never broad-kill or delete a Home with unknown native/PG resources.
    for (const worker of [reopened, first]) if (worker && worker.child.exitCode === null && worker.child.signalCode === null)
      await worker.close();
    if (!closureProved) {
      // Host failure can leave its exact PG alive. Product lifecycle validates
      // original Home/OS birth/SQL cluster authority before any owned PG stop.
      const db = await startLocalDatabase({ home: h.home });
      await db.stop();
      // No Home deletion after failed worker native cleanup; preserve evidence.
      if (children.some(child => child.exitCode !== 0 && child.signalCode !== 'SIGKILL'))
        throw new AggregateError([primaryFailure,new Error([first?.stderr(),reopened?.stderr()].filter(Boolean).join('\n'))],`Retained ${h.home}: worker failed before proving native closure`);
      // Deliberate seed crash is safe only after its committed-boundary message,
      // which proves original/child native closure. Recovery failure stays retained.
      if (reopened && reopened.child.exitCode !== 0) throw new AggregateError([primaryFailure,new Error(reopened.stderr())],`Retained ${h.home}: recovered native closure unproved`);
    }
    await h.dispose();
  }
});
