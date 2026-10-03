import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchHimaHost, type SpawnedHost } from '../../packages/desktop/src/host-launch.ts';
import { startLocalDatabase } from '@hima/harness';
import { localHome, waitUntil, sessionsOf } from './support/fabric.ts';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';
import { createHimaHome, dshBin, recordTestBoot } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('a missing native database runtime fails actual Host startup instead of serving a usable App', async () => {
  const home = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  try {
    await assert.rejects(async () => {
      host = await bootHimaHost({ ...home, env: { ...home.env, HIMA_POSTGRES_RUNTIME: path.join(home.home, 'absent-runtime') } });
    }, /native runtime is missing|exited before startup|exited.*startup/);
    assert.equal(existsSync(path.join(home.home, 'hima/database')), false);
  } finally { await host?.stop().catch(() => undefined); await home.dispose(); }
});

test('a failed storage-domain startup closes the database it already created', async () => {
  const home = await createHimaHome();
  await mkdir(path.join(home.home, 'storages'), { recursive: true });
  const ledger = path.join(home.home, 'storages/hima_ledger.json');
  const invalid = '{"unit":';
  await writeFile(ledger, invalid);
  let host: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  try {
    await assert.rejects(async () => { host = await bootHimaHost(home); }, /exited|plugin tree|JSON/);
    assert.equal(await readFile(ledger, 'utf8'), invalid);
    assert.equal(existsSync(path.join(home.home, 'hima/database/data/postmaster.pid')), false);
    assert.equal(existsSync(path.join(home.home, 'hima/database/host-owner')), false);
  } finally {
    await host?.stop().catch(() => undefined);
    if (existsSync(path.join(home.home, 'hima/database/data/postmaster.pid'))) {
      const database = await startLocalDatabase({ home: home.home });
      await database.stop();
    }
    await home.dispose();
  }
});

test('Host database stays in the authoritative Home when Site definitions are configured elsewhere, and stops on disposal', async t => {
  const home = await localHome(t); assert.ok(home);
  const externalSites = path.join(home.h.workspace, 'external-site-definitions');
  await mkdir(externalSites, { recursive: true });
  await writeFile(path.join(home.h.home, 'cordis.patch.yml'), `- id: hima\n  config:\n    sitesDir: ${JSON.stringify(externalSites)}\n    packsDir: ${JSON.stringify(path.join(home.h.home, 'hima/packs'))}\n    knowledgeDir: ${JSON.stringify(path.join(home.h.home, 'hima/knowledge/current'))}\n`);
  const host = await bootInProcess(home.h);
  try {
    assert.ok(await stat(path.join(home.h.home, 'hima/database/data/PG_VERSION')));
    await assert.rejects(stat(path.join(home.h.workspace, 'database')), { code: 'ENOENT' });
  } finally { await host.dispose(); }
  await assert.rejects(stat(path.join(home.h.home, 'hima/database/data/postmaster.pid')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(home.h.home, 'hima/database/host-owner')), { code: 'ENOENT' });
  await home.h.dispose();
});

test('a PostgreSQL outage cannot confirm Host shutdown or release a forged process identity', async () => {
  const home = await createHimaHome();
  const host = await bootHimaHost(home);
  const data = path.join(home.home, 'hima/database/data');
  const pidFile = path.join(data, 'postmaster.pid');
  const runtime = process.env.HIMA_POSTGRES_RUNTIME;
  assert.ok(runtime, 'native PostgreSQL runtime must be installed for this Host integration test');
  try {
    const port = (await readFile(pidFile, 'utf8')).split('\n')[3];
    // Stop only the cluster this private Home's actual Host just created. The forged PID is written
    // after a clean PG stop, so fault injection never changes a live postmaster's own PID file.
    const stopped = spawnSync(path.join(runtime, 'bin/pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { encoding: 'utf8' });
    assert.equal(stopped.status, 0, stopped.stderr);
    await writeFile(pidFile, `${process.pid}\n${data}\n0\n${port}\n\n127.0.0.1\n\nready\n`);
    await assert.rejects(host.stop(), /resource shutdown unconfirmed/);
    // The pinned datasource can terminate the Host on an idle connection error before its
    // disposer runs. Neither that failure nor the missing receipt confirms resource closure.
    assert.notEqual(host.child.exitCode, 0);
    assert.match(host.stderr(), /terminating connection|connection terminated|connection.*closed/i);
    assert.equal(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`), false);
    process.kill(process.pid, 0);
    assert.ok(await stat(path.join(home.home, 'hima/database/host-owner')), 'unconfirmed resource closure retained ownership');
  } finally {
    await host.stop().catch(() => undefined);
    await rm(pidFile, { force: true });
    await home.dispose();
  }
});

test('normal actual Host shutdown flushes its success receipt after PostgreSQL has stopped', async () => {
  const home = await createHimaHome();
  const host = await bootHimaHost(home);
  try {
    assert.equal(await host.stop(), 0);
    assert.ok(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`));
    await assert.rejects(stat(path.join(home.home, 'hima/database/data/postmaster.pid')), { code: 'ENOENT' });
    await assert.rejects(stat(path.join(home.home, 'hima/database/host-owner')), { code: 'ENOENT' });
  } finally { await host.stop().catch(() => undefined); await home.dispose(); }
});

test('vendor five-second forced zero exit cannot confirm an actual Host whose PostgreSQL shutdown is still pending', async () => {
  const home = await createHimaHome();
  const host = await bootHimaHost(home);
  const data = path.join(home.home, 'hima/database/data');
  const pidFile = path.join(data, 'postmaster.pid');
  const lines = (await readFile(pidFile, 'utf8')).split('\n');
  const pid = Number(lines[0]);
  assert.equal(lines[1], data);
  const runtime = process.env.HIMA_POSTGRES_RUNTIME;
  assert.ok(runtime);
  const credentials = JSON.parse(await readFile(path.join(home.home, 'hima/database/credentials.json'), 'utf8')) as { port: number; user: string; password: string };
  const holder = spawn(path.join(runtime, 'bin/psql'), ['-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'], {
    env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(credentials.port), PGUSER: credentials.user,
      PGPASSWORD: credentials.password, PGDATABASE: 'postgres', PGCONNECT_TIMEOUT: '3' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const holderClosed = new Promise<number | null>(resolve => holder.once('close', resolve));
  try {
    // Hold a real application-owned identity-table lock. Authentication succeeds; the shutdown
    // SELECT stays pending beyond the vendor's five-second deadline, rather than failing its
    // three-second connection timeout. No SDK/private table or production fault flag is involved.
    const locked = new Promise<void>((resolve, reject) => {
      let output = '';
      holder.stdout.on('data', value => { output += String(value); if (output.includes('identity-lock-held')) resolve(); });
      holder.once('error', reject);
      holder.once('exit', code => reject(new Error(`private identity lock holder exited ${code} before confirmation`)));
    });
    holder.stdin.write('BEGIN; LOCK TABLE public.hima_cluster_identity IN ACCESS EXCLUSIVE MODE;\n\\echo identity-lock-held\n');
    await locked;
    await assert.rejects(host.stop(), /resource shutdown unconfirmed/);
    assert.equal(host.child.exitCode, 0, 'the real vendor deadline forced zero exit during disposal');
    assert.equal(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`), false);
    assert.equal(host.stderr().split('\n').includes(`hima: resource shutdown unconfirmed; pid=${host.child.pid}`), false, 'disposer remained pending; it did not report failure before forced exit');
    process.kill(pid, 0);
    assert.ok(await stat(path.join(home.home, 'hima/database/host-owner')));
  } finally {
    holder.stdin.end('ROLLBACK;\n');
    assert.equal(await holderClosed, 0, 'the owned identity transaction was released normally');
    await host.stop().catch(() => undefined);
    const stopped = spawnSync(path.join(runtime, 'bin/pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { encoding: 'utf8' });
    assert.equal(stopped.status, 0, stopped.stderr);
    await home.dispose();
  }
});

test('an actual Host stopped before readiness requires a resource receipt even when the vendor forces zero exit', async () => {
  const home = await createHimaHome();
  const runtime = process.env.HIMA_POSTGRES_RUNTIME; assert.ok(runtime);
  const seeded = await startLocalDatabase({ home: home.home });
  const identity = seeded.identity; await seeded.stop();
  const faultRuntime = path.join(home.home, 'startup-delay-runtime');
  await cp(runtime, faultRuntime, { recursive: true, dereference: false, verbatimSymlinks: true });
  await rename(path.join(faultRuntime, 'bin/pg_ctl'), path.join(faultRuntime, 'bin/pg_ctl-real'));
  const marker = path.join(home.home, 'pg-start-wrapper.pid');
  const wrapper = `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nimport {writeFileSync} from 'node:fs';\nimport path from 'node:path';\nconst result=spawnSync(path.join(import.meta.dirname,'pg_ctl-real'),process.argv.slice(2),{stdio:'inherit'});\nif(result.status!==0)process.exit(result.status??1);\nif(process.argv.at(-1)==='start'){writeFileSync(${JSON.stringify(marker)},String(process.pid));setTimeout(()=>process.exit(0),8000);}else process.exit(0);\n`;
  await writeFile(path.join(faultRuntime, 'bin/pg_ctl'), wrapper, { mode: 0o755 });
  const manifestFile = path.join(faultRuntime, 'postgres-runtime.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { files: Record<string, string> };
  manifest.files['bin/pg_ctl-real'] = manifest.files['bin/pg_ctl']!;
  manifest.files['bin/pg_ctl'] = createHash('sha256').update(wrapper).digest('hex');
  await writeFile(manifestFile, JSON.stringify(manifest));
  let lifecycle: SpawnedHost | undefined;
  recordTestBoot('host-process');
  const launching = launchHimaHost({ dshEntry: dshBin, node: process.execPath, cwd: home.workspace,
    env: { ...home.env, HIMA_POSTGRES_RUNTIME: faultRuntime }, profile: 'hima',
    onSpawn: (_child, spawned) => { lifecycle = spawned; } });
  const failed = assert.rejects(launching, /exited before startup/);
  try {
    await waitUntil('the booting Host starts its original PostgreSQL before readiness', () => existsSync(marker));
    assert.ok(lifecycle);
    const pidFile = path.join(home.home, 'hima/database/data/postmaster.pid');
    const pid = Number((await readFile(pidFile, 'utf8')).split('\n')[0]);
    await assert.rejects(lifecycle.stop(), /resource shutdown unconfirmed/);
    await failed;
    assert.equal(lifecycle.child.exitCode, 0, 'vendor forced zero while database startup disposal was pending');
    process.kill(pid, 0);
    assert.ok(await stat(path.join(home.home, 'hima/database/host-owner')));
  } finally {
    if (lifecycle && lifecycle.child.exitCode === null && lifecycle.child.signalCode === null) {
      lifecycle.child.kill('SIGKILL');
    }
    await failed;
    if (existsSync(marker)) {
      const wrapperPid = Number(await readFile(marker, 'utf8'));
      await waitUntil('the owned delayed pg_ctl wrapper exits', () => {
        try { process.kill(wrapperPid, 0); return false; } catch { return true; }
      }, 12_000);
    }
    const reclaimed = await startLocalDatabase({ home: home.home, runtimeDirectory: faultRuntime });
    assert.equal(reclaimed.identity, identity); await reclaimed.stop();
    await home.dispose();
  }
});

test('App exit drains the original Job, fences new work, and reopens without cancelling the Campaign or clearing human hold', async t => {
  const home = await localHome(t, { sleepSeconds: 0.4 }); assert.ok(home);
  let host = await bootInProcess(home.h);
  let runId: string | undefined; let resumed: Awaited<ReturnType<typeof resumeTestAgent>> | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: actor });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return; runId=started.run.id;
    let serial=0;
    const act = (action: 'begin'|'work'|'complete'|'pause', nodeId?: string, executionId?: string, origin: 'agent'|'human'='agent') => {
      const control=host.ctx.hima.executionContext(runId!).run.control!;
      return host.ctx.hima.executionAction({ runId:runId!,actor,action,nodeId,executionId,origin,
        expectedEpoch:control.epoch,expectedRevision:control.revision,requestId:`lifecycle-${++serial}` });
    };
    const begun=await act('begin',started.run.currentNode); assert.equal(begun.kind,'accepted');
    assert.equal((await act('work',undefined,begun.receipt!.executionId)).kind,'accepted');
    assert.equal((await act('pause',started.run.currentNode,undefined,'human')).kind,'accepted');
    const pending=await host.ctx.hima.prepareExit({mode:'drain',requestId:'exit-fixture'});
    assert.equal(pending.ready,false);
    const denied=await act('begin','read-qor'); assert.equal(denied.kind,'refused'); assert.match(denied.reason!,/exit|closing/i);
    await assert.rejects(host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor}),/exit|closing/i);
    await waitUntil('the same Job reaches its durable exit boundary',()=>host.ctx.hima.exitStatus().ready);
    const settled=host.ctx.hima.exitStatus(); assert.equal(settled.runs[0]?.runId,runId);
    assert.equal(sessionsOf(host,runId).length,1);
    assert.notEqual(host.ctx.hima.ledger.run(runId)?.status,'cancelled');
    await host.dispose(); host=await bootInProcess(home.h); await host.ctx.hima.reconciled;
    resumed=await resumeTestAgent(host.ctx,actor);
    assert.deepEqual(host.ctx.hima.executionContext(runId).run.control?.paused,[started.run.currentNode]);
    assert.equal(sessionsOf(host,runId).length,1);
    assert.notEqual(host.ctx.hima.ledger.run(runId)?.status,'cancelled');
  } finally { if(runId)await host.ctx.hima.cancelRun(runId); await resumed?.dispose();await host.dispose();await home.h.dispose(); }
});

test('a failed Stop jobs request releases only its App exit fence and leaves original Job facts inspectable', async t => {
  const home=await localHome(t,{sleepSeconds:60});assert.ok(home);
  const host=await bootInProcess(home.h);let original:string|undefined, successor:string|undefined;
  const site=path.join(home.h.home,'hima/sites/local.yml');const held=`${site}.temporarily-unavailable`;
  let moved=false;
  try {
    const owner=await createRootAgent(host.ctx,home.h.workspace);const actor=String(owner.id);
    const first=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor});
    assert.equal(first.kind,'ran');if(first.kind!=='ran')return;original=first.run.id;
    const control=()=>host.ctx.hima.executionContext(original!).run.control!;
    const begun=await host.ctx.hima.executionAction({runId:original,actor,action:'begin',nodeId:first.run.currentNode,requestId:'exit-failure-begin',expectedEpoch:control().epoch,expectedRevision:control().revision});
    assert.equal(begun.kind,'accepted');
    assert.equal((await host.ctx.hima.executionAction({runId:original,actor,action:'work',executionId:begun.receipt!.executionId,requestId:'exit-failure-work',expectedEpoch:control().epoch,expectedRevision:control().revision})).kind,'accepted');
    assert.equal(sessionsOf(host,original).length,1);
    await rename(site,held);moved=true;
    await assert.rejects(host.ctx.hima.prepareExit({mode:'stop-jobs',requestId:'exit-failed-kill'}));
    assert.equal(host.ctx.hima.exitStatus().requestId,undefined,'failed exit does not leave an in-memory closing request');
    const receipt=control().requests['exit:exit-failed-kill'];
    assert.ok(receipt&&receipt.receipt.action==='host-exit'&&(receipt.receipt.data as {releasedAt?:string})?.releasedAt,'the original control journal records release; human holds are independent');
    assert.equal(sessionsOf(host,original).length,1,'the Job identity was not deleted to make exit appear clean');
    await rename(held,site);moved=false;
    const again=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:actor});
    assert.equal(again.kind,'ran','original admission was restored');if(again.kind==='ran')successor=again.run.id;
  }finally{
    if(moved)await rename(held,site);
    if(original)await host.ctx.hima.cancelRun(original);
    if(successor)await host.ctx.hima.cancelRun(successor);
    await host.dispose();await home.h.dispose();
  }
});
