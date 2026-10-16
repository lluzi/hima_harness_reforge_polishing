import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dbosHome, cleanDbosHome } from './support/dbos-process.ts';

test('Guide reads exact committed repeat artifacts while the next round runs and after it commits', { timeout: 90_000 }, async t => {
  const home = await dbosHome();
  const child = spawn(process.execPath, [fileURLToPath(new URL('./support/durable-views-worker.ts', import.meta.url)), home, 'guide-artifact-rounds'],
    { env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '';
  let observed: any;
  child.stdout!.on('data', value => { output += String(value); });
  child.stderr!.on('data', value => { output += String(value); });
  child.on('message', value => { observed = value; });
  const ended = new Promise<void>(resolve => child.once('close', () => resolve()));
  const result = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => code === 0 && observed?.ok ? resolve() : reject(new Error(JSON.stringify(observed) + '\n' + output)));
    t.signal.addEventListener('abort', () => reject(new Error('Guide rounds worker exceeded the test budget\n' + output)), { once: true });
  });
  try {
    await result;
    for (const field of ['statusAddresses', 'aCommittedBRunning', 'bothAfterCommit', 'boundedInspect', 'wrongIdentityProjectAndHashDenied', 'readOnly']) {
      assert.equal(observed[field], true, field);
    }
    assert.notEqual(observed.aEffect, observed.bEffect);
    assert.notEqual(observed.aSha, observed.bSha);
    assert.equal(observed.productModelCalls, 0);
    t.diagnostic(JSON.stringify(observed));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      try { await ended; } finally { clearTimeout(timer); }
    }
    await cleanDbosHome(home);
  }
});
