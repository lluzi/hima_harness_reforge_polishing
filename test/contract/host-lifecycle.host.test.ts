import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdir, readFile, rename, rm, stat, writeFile, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { launchHimaHost, stopChild, type SpawnedHost } from '../../packages/desktop/src/host-launch.ts';
import { startLocalDatabase } from '@hima/harness';
import { localHome, waitUntil, sessionsOf } from './support/fabric.ts';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';
import { dshBin, recordTestBoot } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('a missing native database runtime fails actual Host startup instead of serving a usable App', async () => {
  const home = await nativeLifecycleHome();
  let host: Awaited<ReturnType<typeof bootHimaHost>> | undefined;
  try {
    await assert.rejects(async () => {
      host = await bootHimaHost({ ...home, env: { ...home.env, HIMA_POSTGRES_RUNTIME: path.join(home.home, 'absent-runtime') } });
    }, /native runtime is missing|exited before startup|exited.*startup/);
    assert.equal(existsSync(path.join(home.home, 'hima/database')), false);
  } finally { await host?.stop().catch(() => undefined); await home.dispose(); }
});

test('a failed storage-domain startup closes the database it already created', async () => {
  const home = await nativeLifecycleHome();
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
  const home = await nativeLifecycleHome();
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
  const home = await nativeLifecycleHome();
  const host = await bootHimaHost(home);
  try {
    assert.equal(await host.stop(), 0);
    assert.ok(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`));
    await assert.rejects(stat(path.join(home.home, 'hima/database/data/postmaster.pid')), { code: 'ENOENT' });
    await assert.rejects(stat(path.join(home.home, 'hima/database/host-owner')), { code: 'ENOENT' });
  } finally { await host.stop().catch(() => undefined); await home.dispose(); }
});

test('vendor five-second forced zero exit cannot confirm an actual Host whose PostgreSQL shutdown is still pending', async () => {
  const home = await nativeLifecycleHome();
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
    // This negative deliberately exercises an unprepared raw native signal, not the normal
    // pre-finalizing stop protocol. Wait for its ONE signal's actual forced close first.
    const ended=new Promise<void>(resolve=>host.child.once('close',()=>resolve()));
    host.child.kill('SIGTERM');await ended;
    await assert.rejects(host.stop(), /resource shutdown unconfirmed/);
    assert.equal(host.child.exitCode, 0, 'the real vendor deadline forced zero exit during disposal');
    assert.equal(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`), false);
    // A still-open owned client can produce an explicit refusal before the vendor deadline.
    // Either that refusal or a pending closer is unconfirmed; neither proves PostgreSQL stopped.
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
  const home = await nativeLifecycleHome();
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

async function durableLifecycleScenario(mode:string):Promise<void> {
  const {dbosHome,cleanDbosHome}=await import('./support/dbos-process.ts');
  const {fileURLToPath}=await import('node:url');
  const home=await dbosHome();
  const child=spawn(process.execPath,[fileURLToPath(new URL('./support/durable-lifecycle-worker.ts',import.meta.url)),home,mode],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout!.on('data',value=>output+=String(value));child.stderr!.on('data',value=>output+=String(value));
  const result=new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error(output));});});
  try {const receipt=await result;assert.equal(receipt.ok,true,JSON.stringify(receipt)+'\n'+output);}
  finally {if(child.exitCode===null){const timer=setTimeout(()=>child.kill('SIGKILL'),8000);try{await new Promise(resolve=>child.once('exit',resolve));}finally{clearTimeout(timer);}}await cleanDbosHome(home);}
}
test('App exit drains the original durable Job, fences new work, and reopens preserving human hold',{timeout:90000},()=>durableLifecycleScenario('drain'));
test('a failed durable Stop jobs request releases only its App exit fence and preserves original physical facts',{timeout:90000},()=>durableLifecycleScenario('stop-failure'));
test('Keep jobs exit and reopen retain the original durable resource identity and deadline',{timeout:90000},()=>durableLifecycleScenario('keep'));

test('Accepted exit serializes with the real PG callback admission transaction',{timeout:90000},()=>durableLifecycleScenario('race'));

test('Stop jobs closes the original durable process without cancelling the Run or clearing human hold',{timeout:90000},()=>durableLifecycleScenario('stop'));

test('Exit before preparation admission reopens the original workflow and preserves customer bytes',{timeout:90000},()=>durableLifecycleScenario('prepare'));

test('Admitted preparation intent without copy completion stays unknown during drain',{timeout:90000},()=>durableLifecycleScenario('prepare-intent'));

async function nativeLifecycleHome():Promise<import('./support/dsh-home.ts').HimaHome>{
  const {createEmptyHome,repoRoot}=await import('./support/dsh-home.ts');
  const {prepareHimaHome,himaHomeSources}=await import('../../packages/desktop/src/hima-home.ts');
  const h=await createEmptyHome();const packageDir=process.env.HIMA_U7_LIFECYCLE_PACKAGE;
  const home=await realpath(h.home),workspace=await realpath(h.workspace);
  const prepared=await prepareHimaHome({home,root:repoRoot,...(packageDir?{sources:{...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')}}:{})});
  return {...h,home,workspace,profileDir:prepared.profileDir,env:{...h.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents')}};
}

test('native finalization closes owned resources before a delayed whole-tree disposal',{timeout:90000},async()=>{
  const home=await nativeLifecycleHome();let host:Awaited<ReturnType<typeof bootHimaHost>>|undefined;
  const plugin=path.join(home.home,'native-disposal-delay.mjs');
  const pidFile=path.join(home.home,'hima/database/data/postmaster.pid'),owner=path.join(home.home,'hima/database/host-owner');
  try {
    await writeFile(plugin,`import {existsSync} from 'node:fs';
export const name='native-disposal-delay';export const inject=['hima'];
export function apply(ctx){ctx.effect(()=>async()=>{process.stderr.write('fixture: native-disposal-start pg='+existsSync(${JSON.stringify(pidFile)})+' owner='+existsSync(${JSON.stringify(owner)})+'\\n');ctx.hima.reconciled=Promise.all([ctx.hima.reconciled,new Promise(resolve=>setTimeout(resolve,6500))]).then(()=>[]);await ctx.hima.reconciled;});}
`);
    const {createRequire}=await import('node:module');const {repoRoot}=await import('./support/dsh-home.ts');const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));const {stringify}=require('yaml');
    await writeFile(path.join(home.home,'cordis.patch.yml'),stringify([{insert:[{id:'native-disposal-delay',name:plugin}]}]));
    host=await bootHimaHost(home);
    assert.equal(await (process.env.HIMA_U7_REPRO_RAW_STOP==='1'?stopChild(host.child):host.stop()),0);
    const lines=host.stderr().split('\n');const receipt=`hima: resource shutdown confirmed; pid=${host.child.pid}`;
    assert.equal(lines.filter(line=>line===receipt).length,1,'one idempotent closer emits one receipt; '+host.stderr());
    assert.ok(lines.indexOf(receipt)<lines.indexOf('fixture: native-disposal-start pg=false owner=false'),'owned closure precedes SIGTERM and unrelated native disposal');
    assert.equal(existsSync(pidFile),false);assert.equal(existsSync(owner),false);
  } finally {
    await host?.stop().catch(()=>undefined);
    if(host&&host.child.exitCode===null&&host.child.signalCode===null)await stopChild(host.child);
    if(existsSync(pidFile)){const database=await startLocalDatabase({home:home.home});await database.stop();}
    await home.dispose();
  }
});

test('native capability is lifecycle-only and exit mode replacement/finalization preserves exact identity',{timeout:90000},async()=>{
  const home=await nativeLifecycleHome();const {randomBytes}=await import('node:crypto');const token=randomBytes(32).toString('hex');home.env.HIMA_DESKTOP_CONTROL_TOKEN=token;
  const host=await bootHimaHost(home);
  const origin=new URL(host.url).origin;
  const request=async(body?:object,headers:Record<string,string>={},route='/hima/api/lifecycle/exit')=>fetch(new URL(route,origin),{method:body?'POST':'GET',headers:{'x-hima-desktop-control':token,'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
  try {
    assert.ok((await request(undefined,{'x-hima-desktop-control':''})).status>=400);
    assert.ok((await request(undefined,{'x-hima-desktop-control':'f'.repeat(64)})).status>=400);
    assert.ok((await request(undefined,{origin:'https://unrelated.invalid'})).status>=400);
    assert.ok((await request(undefined,{},'/hima/api/runs')).status>=400,'capability never replaces browser authority on other routes');
    const a=await request({requestId:'native-modal-a',mode:'drain'});assert.equal(a.status,200);assert.equal((await a.json() as any).requestId,'native-modal-a');
    assert.ok((await request({requestId:'wrong-finalize',mode:'finish-exit'})).status>=400);
    const b={requestId:'native-modal-b',mode:'keep-jobs',expectedRequestId:'native-modal-a'};
    const changed=await request(b);assert.equal(changed.status,200);assert.equal((await changed.json() as any).mode,'keep-jobs');
    assert.equal((await request(b)).status,200,'same replacement identity is idempotent');
    assert.ok((await request({...b,mode:'stop-jobs'})).status>=400,'request identity cannot change its mode');
    assert.ok((await request({requestId:'native-modal-c',mode:'drain',expectedRequestId:'native-modal-a'})).status>=400);
    assert.ok((await request({requestId:'native-modal-a',mode:'cancel-exit'})).status>=400);
    assert.equal((await (await request()).json() as any).requestId,'native-modal-b');
    const finish=await request({requestId:'native-modal-b',mode:'finish-exit'});assert.equal(finish.status,200);assert.equal((await finish.json() as any).finalized,true);
    const repeat=await request({requestId:'native-modal-b',mode:'finish-exit'});assert.equal(repeat.status,200);assert.equal((await repeat.json() as any).finalized,true);
    assert.ok((await request({requestId:'native-modal-b',mode:'cancel-exit'})).status>=400);
    assert.ok((await request({requestId:'native-modal-c',mode:'drain',expectedRequestId:'native-modal-b'})).status>=400);
    assert.equal(await host.stop(),0);
    assert.equal(host.stderr().split('\n').filter(line=>line===`hima: resource shutdown confirmed; pid=${host.child.pid}`).length,1);
  } finally {await host.stop().catch(()=>undefined);await home.dispose();}
});


test('native stop sends no signal while owned resources are unproved and repeats the same finalizer',{timeout:90000},async()=>{
  const home=await nativeLifecycleHome(),runtime=process.env.HIMA_POSTGRES_RUNTIME;assert.ok(runtime);
  const {randomBytes}=await import('node:crypto');const token=randomBytes(32).toString('hex');home.env.HIMA_DESKTOP_CONTROL_TOKEN=token;
  const marker=path.join(home.home,'native-signal-marker'),plugin=path.join(home.home,'native-signal-marker.mjs');
  await writeFile(plugin,`import {writeFileSync} from 'node:fs';export const name='native-signal-marker';export function apply(ctx){ctx.effect(()=>()=>writeFileSync(${JSON.stringify(marker)},'native disposal began'));}`);
  const {createRequire}=await import('node:module');const {repoRoot}=await import('./support/dsh-home.ts');const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));const {stringify}=require('yaml');
  await writeFile(path.join(home.home,'cordis.patch.yml'),stringify([{insert:[{id:'native-signal-marker',name:plugin}]}]));
  const host=await launchHimaHost({dshEntry:dshBin,node:process.execPath,cwd:home.workspace,env:home.env,profile:'hima'});
  const pidFile=path.join(home.home,'hima/database/data/postmaster.pid'),ownerFile=path.join(home.home,'hima/database/host-owner');
  const originalPid=(await readFile(pidFile,'utf8')).split('\n')[0]!,originalOwner=await readFile(path.join(ownerFile,'owner.json'),'utf8');
  const credentials=JSON.parse(await readFile(path.join(home.home,'hima/database/credentials.json'),'utf8'));
  const holder=spawn(path.join(runtime,'bin/psql'),['-X','-A','-t','-q','-v','ON_ERROR_STOP=1'],{env:{...process.env,PGHOST:'127.0.0.1',PGPORT:String(credentials.port),PGUSER:credentials.user,PGPASSWORD:credentials.password,PGDATABASE:'postgres'},stdio:['pipe','pipe','pipe']});
  const closed=new Promise(resolve=>holder.once('close',resolve));let released=false;
  const request=async(body?:object)=>fetch(new URL('/hima/api/lifecycle/exit',host.origin),{method:body?'POST':'GET',headers:{'x-hima-desktop-control':token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  try {
    const locked=new Promise<void>((resolve,reject)=>{let output='';holder.stdout.on('data',chunk=>{output+=String(chunk);if(output.includes('finalize-lock-held'))resolve();});holder.once('error',reject);holder.once('exit',code=>reject(new Error(`lock holder exited ${code}`)));});
    holder.stdin.write('BEGIN; LOCK TABLE public.hima_cluster_identity IN ACCESS EXCLUSIVE MODE;\n\\echo finalize-lock-held\n');await locked;
    await assert.rejects(host.stop(5000),/resource shutdown unconfirmed/);
    assert.equal(host.child.exitCode,null);assert.equal(host.child.signalCode,null);assert.equal(existsSync(marker),false,'native disposal cannot begin without owned resource proof');
    assert.equal((await readFile(pidFile,'utf8')).split('\n')[0],originalPid);process.kill(Number(originalPid),0);
    assert.equal(await readFile(path.join(ownerFile,'owner.json'),'utf8'),originalOwner,'the original writer lock remains held after refusal');
    assert.equal(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`),false);
    const state=await (await request()).json() as any;assert.ok(state.requestId);assert.equal(state.mode,'keep-jobs');assert.equal(state.finalized,false);
    assert.equal(state.ready,false,'an actual failed resource close remains unconfirmed');
    assert.ok((await request({requestId:'wrong-partial',mode:'finish-exit'})).status>=400,'a different request cannot retry the original finalizer');
    assert.ok((await request({requestId:state.requestId,mode:'cancel-exit'})).status>=400,'half-closed resources cannot be reopened by cancelling');
    assert.ok((await request({requestId:'replace-partial',mode:'drain',expectedRequestId:state.requestId})).status>=400);
    holder.stdin.end('ROLLBACK;\n');released=true;assert.equal(await closed,0);
    const afterRelease=await (await request()).json() as any;
    assert.equal(afterRelease.requestId,state.requestId);assert.equal(afterRelease.ready,false);assert.equal(afterRelease.finalized,false);
    assert.equal(await host.stop(),0);
    assert.equal(host.stderr().split('\n').filter(line=>line===`hima: resource shutdown confirmed; pid=${host.child.pid}`).length,1);
    assert.equal(existsSync(marker),true);
    assert.equal(existsSync(pidFile),false);assert.equal(existsSync(ownerFile),false);
  } finally {
    if(!released){holder.stdin.end('ROLLBACK;\n');await closed;}
    await host.stop().catch(()=>undefined);
    if(host.child.exitCode===null&&host.child.signalCode===null)await stopChild(host.child);
    await home.dispose();
  }
});

for(const disposition of ['keep-jobs','cancel','stop-jobs'] as const) {
  test(`a delayed App stop worker respects ${disposition} disposition before further jobs or Agents`,async()=>{
    const {default:Hima}=await import('@hima/harness');
    let active:any,release!:()=>void,entered!:()=>void,finished!:()=>void;
    const firstPending=new Promise<void>(resolve=>release=resolve),firstEntered=new Promise<void>(resolve=>entered=resolve),agentsFinished=new Promise<void>(resolve=>finished=resolve);
    const stopped:string[]=[],cancelled:string[]=[],warnings:string[]=[];
    const invocation=(effectId:string)=>({identity:{effectId}});
    const store:any={
      acceptHostExit:async(request:any)=>{active=request;},hostExit:async()=>active,
      releaseHostExit:async()=>{active=undefined;},runs:async()=>[{runId:'exit-run'}],
      flowInvocations:async()=>[invocation('first'),invocation('second')],derivedEffects:async()=>[],
      flowPhysicalFacts:async()=>({effects:['first','second'].map(effectId=>({identity:{effectId},dispatches:[{dispatchId:'submit'}]}))}),
      withHostExitStopBoundary:async(requestId:string,work:()=>void)=>{if(active?.requestId!==requestId||active.mode!=='stop-jobs')return false;work();return true;},
    };
    const service:any={reconciled:Promise.resolve(),durable:{store,startWorkflow:async(_name:string,_id:string,input:any)=>{
      stopped.push(input.invocation.identity.effectId);
      return {getResult:async()=>{if(stopped.length===1){entered();await firstPending;}return {closed:true};}};
    }},ctx:{get:()=>({list:()=>[{cancel:()=>{cancelled.push('agent');finished();}}]}),logger:{warn:(value:string)=>warnings.push(value)}},exitStatus:async()=>({requestId:active?.requestId,mode:active?.mode}),cancelExit:undefined};
    service.cancelExit=(id:string)=>Hima.prototype.cancelExit.call(service,id);
    await Hima.prototype.prepareExit.call(service,{requestId:'stop-original',mode:'stop-jobs'});
    await firstEntered;
    if(disposition==='keep-jobs')await Hima.prototype.prepareExit.call(service,{requestId:'keep-replacement',mode:'keep-jobs',expectedRequestId:'stop-original'});
    if(disposition==='cancel')await service.cancelExit('stop-original');
    release();
    if(disposition==='stop-jobs')await agentsFinished;
    else await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(stopped,disposition==='stop-jobs'?['first','second']:['first'],'only dispatches admitted under the current exit choice may continue');
    assert.deepEqual(cancelled,disposition==='stop-jobs'?['agent']:[]);
    assert.deepEqual(warnings,[]);
  });
}

test('original App stop admission is fenced by replacement and cancellation at the Host lock',{timeout:90000},async()=>{await durableLifecycleScenario('stop-authority');});
