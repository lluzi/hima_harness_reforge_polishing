import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { prepareHimaHome, himaHomeSources } from '../../packages/desktop/src/hima-home.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';

const packageDir = path.join(repoRoot, 'packages/harness');
const require = createRequire(path.join(packageDir, 'package.json'));
const { DBOS } = require('@dbos-inc/dbos-sdk');
const { Pool } = require('pg');
const { startDurableRuntime } = await import(pathToFileURL(path.join(packageDir, 'lib/durable-runtime.js')).href);
const { startLocalDatabase } = await import(pathToFileURL(path.join(packageDir, 'lib/local-database.js')).href);
const { default: Hima } = await import(pathToFileURL(path.join(packageDir, 'lib/index.js')).href);

test('relocated Harness package with literal # and % prepares the Home offline', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hima-relocated-'));
  const relocated = path.join(root, 'Trials#1%literal', 'harness');
  try {
    await mkdir(relocated, { recursive: true });
    for (const asset of ['lib', 'package.json', 'cordis.patch.yml', 'skills', 'rules', 'choosers', 'presets', 'semantics.yml']) {
      await cp(path.join(packageDir, asset), path.join(relocated, asset), { recursive: true, verbatimSymlinks: true });
    }
    // Development dependency links belong to the source tree. Retain that read-only dependency
    // directory while relocating the actual Harness bytes; this is not a closed native bundle test.
    await symlink(path.join(packageDir, 'node_modules'), path.join(relocated, 'node_modules'), 'dir');
    const moduleUrl = pathToFileURL(path.join(relocated, 'lib/local-database.js')).href;
    assert.match(moduleUrl, /Trials%231%25literal/);
    const gate = await import(moduleUrl);
    assert.equal(typeof gate.assertHomeExecutionAllowed, 'function');
    const sources = { ...himaHomeSources(repoRoot), harnessPackage: relocated, presets: path.join(relocated, 'presets') };
    const home = path.join(root, 'home');
    const result = await prepareHimaHome({ home, sources });
    assert.equal(result.home, home);
    assert.equal(await realpath(path.join(result.profileDir, 'node_modules/@hima/harness')), relocated);
    assert.equal(existsSync(path.join(home, 'hima/sites')), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const fault of ['sdk', 'sdk-before', 'application', 'system'] as const) {
  test(`original Host finalizer with real durable resources retries a one-time ${fault} failure and closes real resources`, { timeout: 60000 }, async () => {
    const home = await createHimaHome();
    const database = await startLocalDatabase({ home: home.home, runtimeDirectory: process.env.HIMA_POSTGRES_RUNTIME });
    const resourcePools = new Set<any>();
    const originalQuery = Pool.prototype.query;
    Pool.prototype.query = function (this: any, ...args: any[]) { resourcePools.add(this); return originalQuery.apply(this, args); };
    let durable: any;
    try { durable = await startDurableRuntime({ database, manifest: { files: { fixture: 'a'.repeat(64) }, adapters: { fixture: '1' } } }); }
    finally { Pool.prototype.query = originalQuery; }
    const service: any = {
      durable, reconciled: Promise.resolve([]), ctx: { get: () => undefined },
      exitStatus() { return this.finalExitStatus ? Promise.resolve(this.finalExitStatus) : Promise.resolve({ requestId: `retry-${fault}`, mode: 'stop-jobs', ready: true }); },
      async closeHostResources() {
        const first = durable.stop();
        assert.equal(durable.stop(), first, 'durable callers coalesce the original in-flight attempt');
        const attempt = (async () => { await first; await database.stop(); })();
        this.resourcesClosing = attempt; return attempt;
      },
      finishExit: Hima.prototype.finishExit,
    };
    const originalShutdown = DBOS.shutdown;
    const originalEnd = Pool.prototype.end;
    const calls = { sdk: 0, application: 0, system: 0 };
    const pools = new Map<string, any>();
    let failed = false;
    try {
      await service.reconciled;
      await durable.store.acceptHostExit({ requestId: `retry-${fault}`, mode: 'stop-jobs' });
      const state = await service.exitStatus();
      assert.equal(state.ready, true);
      const application = service.durable.store;
      // A retry must never re-read a closed consumer, accept another exit, or launch physical cleanup.
      service.prepareExit = async () => { throw new Error('exit preparation repeated'); };
      service.durable.startWorkflow = async () => { throw new Error('physical Job stop repeated'); };
      DBOS.shutdown = async (...args: any[]) => {
        calls.sdk++;
        if (fault === 'sdk-before' && !failed) { failed = true; throw new Error('one-time sdk closure failure before shutdown'); }
        if (fault === 'sdk' && !failed) { await originalShutdown.apply(DBOS, args); failed = true; throw new Error('one-time sdk closure failure'); }
        return originalShutdown.apply(DBOS, args);
      };
      Pool.prototype.end = async function (this: any, ...args: any[]) {
        const kind = this.options.database === 'hima_application' && this.options.statement_timeout === 5000 ? 'application' : this.options.database === 'hima_dbos_system' ? 'system' : undefined;
        if (kind) {
          pools.set(kind, this); calls[kind]++;
          if (fault === kind && !failed) { failed = true; throw new Error(`one-time ${kind} closure failure`); }
        }
        return originalEnd.apply(this, args);
      };
      // Two callers share one in-flight durable shutdown, including its failure.
      const first = service.finishExit(state.requestId);
      const second = service.finishExit(state.requestId);
      const rejected = await Promise.allSettled([first, second]);
      assert.equal(rejected[0].status, 'rejected');
      assert.equal(rejected[1].status, 'rejected');
      assert.equal(failed, true);
      assert.equal((await service.exitStatus()).finalized, false);
      await assert.rejects(startDurableRuntime({ database, manifest: { files: { fixture: 'a'.repeat(64) }, adapters: { fixture: '1' } } }), /already owns/, 'failure retains original runtime ownership');
      await assert.rejects(service.finishExit('different-original-request'), /stale/);
      const result = await service.finishExit(state.requestId);
      assert.equal(result.requestId, state.requestId);
      assert.equal(result.ready, true); assert.equal(result.finalized, true);
      assert.equal(service.durable.store, application, 'no replacement application consumer');
      assert.deepEqual(calls, { sdk: fault.startsWith('sdk') ? 2 : 1, application: fault === 'application' ? 2 : 1, system: fault === 'system' ? 2 : 1 });
      for (const pool of pools.values()) assert.equal(pool.ended, true);
      assert.equal(DBOS.isInitialized(), false);
      assert.equal(existsSync(path.join(home.home, 'hima/database/data/postmaster.pid')), false);
      assert.equal(existsSync(path.join(home.home, 'hima/database/host-owner')), false);
      const counts = { ...calls };
      assert.equal((await service.finishExit(state.requestId)).finalized, true);
      await service.durable.stop();
      assert.deepEqual(calls, counts, 'completed stages are never run twice');
    } finally {
      DBOS.shutdown = originalShutdown; Pool.prototype.end = originalEnd;
      // RED cleanup must also release real owned resources when the old implementation caches rejection.
      await durable.stop().catch(() => undefined);
      await originalShutdown.call(DBOS, { deregister: true, workflowCompletionTimeoutMS: 1000 });
      await durable.store.close().catch(() => undefined);
      for (const pool of resourcePools) if (!pool.ended) await originalEnd.call(pool);
      await database.stop();
      await home.dispose();
    }
  });
}
