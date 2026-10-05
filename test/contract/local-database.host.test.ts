import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { startLocalDatabase } from '../../packages/harness/src/local-database.ts';
import { launchHimaHost, stopChild } from '../../packages/desktop/src/host-launch.ts';

const runtimeDirectory = process.env.HIMA_POSTGRES_RUNTIME;
if (!runtimeDirectory) throw new Error('Set HIMA_POSTGRES_RUNTIME to the pinned native PostgreSQL runtime for this process test');
async function sql(database: Awaited<ReturnType<typeof startLocalDatabase>>, query: string): Promise<string> {
  const connection = database.application;
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(runtimeDirectory!, 'bin/psql'), ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
      env: { ...process.env, PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user,
        PGPASSWORD: connection.password, PGDATABASE: connection.database }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = ''; let err = '';
    child.stdout.on('data', value => { out += String(value); }); child.stderr.on('data', value => { err += String(value); });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(out.trim()) : reject(new Error(err)));
    child.stdin.end(query);
  });
}

test('private local PostgreSQL persists both database identity and application data across orderly close/reopen', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-lifecycle-'));
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  try {
    database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
    const identity = database.identity;
    assert.notEqual(database.application.database, database.system.database);
    assert.equal(database.application.host, '127.0.0.1');
    assert.equal((await stat(path.join(home, 'hima/database'))).mode & 0o777, 0o700);
    await sql(database, 'CREATE TABLE retained(value text); INSERT INTO retained VALUES (\'same-data\');');
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /owned|Host/i);
    await database.stop();
    database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
    assert.equal(database.identity, identity);
    assert.equal(await sql(database, 'SELECT value FROM retained;'), 'same-data');
    assert.match(await readFile(path.join(home, 'hima/database/data/pg_hba.conf'), 'utf8'), /scram-sha-256/);
    assert.equal((await stat(path.join(home, 'hima/database/credentials.json'))).mode & 0o777, 0o600);
    assert.equal((await readFile(path.join(home, 'hima/database/server.log'), 'utf8')).includes(database.application.password), false);
    const denied = spawnSync(path.join(runtimeDirectory!, 'bin/psql'), ['-X', '-c', 'SELECT 1'], {
      env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(database.application.port), PGUSER: database.application.user,
        PGDATABASE: database.application.database, PGPASSWORD: 'wrong-password' }, encoding: 'utf8',
    });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stderr, /password authentication failed/);
    const argv = spawnSync('/bin/ps', ['-ax', '-o', 'command='], { encoding: 'utf8' }).stdout;
    assert.equal(argv.includes(database.application.password), false);
  } finally { await database?.stop(); await rm(home, { recursive: true, force: true }); }
});

test('a crashed Host is replaced while its verified original PostgreSQL process and data are adopted', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-crash-'));
  const entry = fileURLToPath(new URL('../../packages/harness/src/local-database.ts', import.meta.url));
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { startLocalDatabase } from ${JSON.stringify(new URL(`file://${entry}`).href)};
    const database = await startLocalDatabase({ home: ${JSON.stringify(home)}, runtimeDirectory: ${JSON.stringify(runtimeDirectory)} });
    process.send({ identity: database.identity });
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  const ended = new Promise(resolve => child.once('close', resolve));
  assert.ok(child.stderr);
  let stderr = ''; child.stderr.on('data', value => { stderr += String(value); });
  try {
    const identity = await new Promise<string>((resolve, reject) => {
      child.once('message', message => resolve((message as { identity: string }).identity));
      child.once('exit', () => reject(new Error(`Host ended before database initialization: ${stderr}`)));
      child.once('error', reject);
    });
    const pidFile = path.join(home, 'hima/database/data/postmaster.pid');
    const originalPid = (await readFile(pidFile, 'utf8')).split('\n')[0];
    child.kill('SIGKILL'); await ended;
    database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
    assert.equal(database.identity, identity);
    assert.equal((await readFile(pidFile, 'utf8')).split('\n')[0], originalPid);
    assert.equal(await sql(database, 'SELECT 42;'), '42');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await ended; }
    await database?.stop();
    // A failed adoption retains the original cluster for diagnosis rather than deleting live data.
    if (database) await rm(home, { recursive: true, force: true });
  }
});

test('restored credentials reject public permissions and symlinks while preserving the cluster for safe reopen', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-restored-credentials-'));
  const credentials = path.join(home, 'hima/database/credentials.json');
  const restored = `${credentials}.restored`;
  const version = path.join(home, 'hima/database/data/PG_VERSION');
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  try {
    database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
    const identity = database.identity;
    await sql(database, "CREATE TABLE restored(value text); INSERT INTO restored VALUES ('retained');");
    await database.stop(); database = undefined;
    const originalDigest = createHash('sha256').update(await readFile(credentials)).digest('hex');
    const originalVersion = await readFile(version, 'utf8');
    await chmod(credentials, 0o644);
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /credentials.*unsafe/);
    assert.equal((await lstat(credentials)).mode & 0o777, 0o644, 'unsafe restored permissions are preserved for diagnosis');
    assert.equal(createHash('sha256').update(await readFile(credentials)).digest('hex'), originalDigest);
    assert.equal(await readFile(version, 'utf8'), originalVersion);
    assert.equal(await lstat(path.join(home, 'hima/database/data/postmaster.pid')).catch(() => undefined), undefined);
    await chmod(credentials, 0o600);
    await rename(credentials, restored); await symlink(restored, credentials);
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /credentials.*unsafe/);
    assert.equal((await lstat(credentials)).isSymbolicLink(), true, 'the unsafe symlink is preserved');
    assert.equal(createHash('sha256').update(await readFile(restored)).digest('hex'), originalDigest);
    assert.equal(await readFile(version, 'utf8'), originalVersion);
    await rm(credentials); await rename(restored, credentials);
    database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
    assert.equal(database.identity, identity);
    assert.equal(await sql(database, 'SELECT value FROM restored;'), 'retained');
  } finally { await database?.stop(); await rm(home, { recursive: true, force: true }); }
});

for (const reclaim of [false, true]) test(`two independent Hosts racing to ${reclaim ? 'reclaim' : 'claim'} one Home leave exactly one live owner`, { timeout: 60_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-claim-race-'));
  const entry = new URL('../../packages/harness/src/local-database.ts', import.meta.url).href;
  const workers: ReturnType<typeof spawn>[] = [];
  const closed = new Map<ReturnType<typeof spawn>, Promise<number | null>>();
  const worker = () => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `
      import { startLocalDatabase } from ${JSON.stringify(entry)};
      let database;
      process.on('message', async message => {
        if (message === 'start') {
          try {
            database = await startLocalDatabase({ home: ${JSON.stringify(home)}, runtimeDirectory: ${JSON.stringify(runtimeDirectory)} });
            process.send({ owned: true, identity: database.identity });
          } catch (error) { process.send({ owned: false, reason: error.message }); process.disconnect(); }
        } else if (message === 'stop') { await database.stop(); process.disconnect(); }
      });
      process.send({ waiting: true });
    `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout!.resume(); child.stderr!.resume(); workers.push(child);
    closed.set(child, new Promise(resolve => child.once('close', resolve)));
    return child;
  };
  const message = (child: ReturnType<typeof spawn>) => new Promise<{ waiting?: boolean; owned?: boolean; identity?: string; reason?: string }>((resolve, reject) => {
    child.once('message', value => resolve(value as { waiting?: boolean; owned?: boolean; identity?: string; reason?: string }));
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`claimant ended ${code} before its next lifecycle result`)));
  });
  let winner: ReturnType<typeof spawn> | undefined;
  let safelyClosed = false;
  try {
    let originalIdentity: string | undefined;
    let originalPid: string | undefined;
    if (reclaim) {
      const prior = worker(); await message(prior);
      const initialized = message(prior); prior.send('start');
      const outcome = await initialized; assert.equal(outcome.owned, true); originalIdentity = outcome.identity;
      originalPid = (await readFile(path.join(home, 'hima/database/data/postmaster.pid'), 'utf8')).split('\n')[0];
      prior.kill('SIGKILL'); await closed.get(prior);
    }
    const left = worker(); const right = worker();
    await Promise.all([message(left), message(right)]);
    const outcomes = Promise.all([message(left), message(right)]);
    left.send('start'); right.send('start');
    const answers = await outcomes;
    assert.equal(answers.filter(answer => answer.owned).length, 1, JSON.stringify(answers));
    const index = answers.findIndex(answer => answer.owned); winner = [left, right][index]!;
    const loser = [left, right][1 - index]!;
    assert.equal(await closed.get(loser), 0);
    const owner = JSON.parse(await readFile(path.join(home, 'hima/database/host-owner/owner.json'), 'utf8')) as { pid: number };
    assert.equal(owner.pid, winner.pid, 'the rejected claimant must not remove or replace the winning owner lock');
    process.kill(winner.pid!, 0);
    if (reclaim) {
      assert.equal(answers[index]!.identity, originalIdentity);
      assert.equal((await readFile(path.join(home, 'hima/database/data/postmaster.pid'), 'utf8')).split('\n')[0], originalPid);
    }
    winner.send('stop'); assert.equal(await closed.get(winner), 0); safelyClosed = true;
    await assert.rejects(stat(path.join(home, 'hima/database/host-owner')), { code: 'ENOENT' });
    await assert.rejects(stat(path.join(home, 'hima/database/data/postmaster.pid')), { code: 'ENOENT' });
  } finally {
    for (const child of workers) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed.get(child);
    }
    if (!safelyClosed) {
      // Reconcile only this case's original cluster after its two claimants have exited.
      const retained = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
      await retained.stop();
    }
    await rm(home, { recursive: true, force: true });
  }
});

test('an occupied original loopback port blocks reopening without stopping its unrelated listener', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-port-'));
  const database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
  await database.stop();
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(database.application.port, '127.0.0.1', resolve); });
  try {
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /occupied/);
    assert.equal(server.listening, true);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(home, { recursive: true, force: true }); }
});

test('interrupted initialization is retained and never passed off as a usable cluster', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-init-'));
  const interrupted = path.join(home, 'hima/database/data-initializing');
  await mkdir(interrupted, { recursive: true });
  await writeFile(path.join(interrupted, 'incomplete'), 'original interrupted bytes');
  try {
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /initialization was interrupted/);
    assert.equal(await readFile(path.join(interrupted, 'incomplete'), 'utf8'), 'original interrupted bytes');
    await assert.rejects(stat(path.join(home, 'hima/database/data/PG_VERSION')), { code: 'ENOENT' });
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('an unusable private Home reports its filesystem failure without initializing a database', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-home-'));
  await writeFile(path.join(home, 'hima'), 'existing non-directory');
  try {
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /ENOTDIR|EEXIST/);
    assert.equal(await readFile(path.join(home, 'hima'), 'utf8'), 'existing non-directory');
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('Host shutdown timeout preserves the owned process and reports unconfirmed shutdown', async () => {
  const child = spawn(process.execPath, ['--eval', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000);"]);
  const ended = new Promise(resolve => child.once('close', resolve));
  try {
    await new Promise<void>(resolve => child.stdout.once('data', () => resolve()));
    await assert.rejects(stopChild(child, 100), /shutdown was not confirmed/);
    assert.equal(child.exitCode, null);
    assert.equal(child.signalCode, null);
    process.kill(child.pid!, 0);
  } finally { child.kill('SIGKILL'); await ended; }
});

test('an unconfirmed database shutdown cannot become a successful App exit merely because the Host process exited zero', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'hima-host-stop-receipt-'));
  const entry = path.join(folder, 'host.mjs');
  await writeFile(entry, `import {createServer} from 'node:http';
    const server=createServer((request,response)=>{response.writeHead(401);response.end();});
    server.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=contract'));
    process.on('SIGTERM',()=>{console.error('hima: resource shutdown unconfirmed; pid='+process.pid);server.close(()=>process.exit(0));});
  `);
  const host = await launchHimaHost({ dshEntry: entry, node: process.execPath, cwd: folder, env: process.env, profile: 'hima' });
  try { await assert.rejects(host.stop(), /resource shutdown unconfirmed/); }
  finally { if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL'); await rm(folder, { recursive: true, force: true }); }
});

test('a zero Host exit without a positive resource-shutdown receipt remains unconfirmed', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'hima-host-no-receipt-'));
  const entry = path.join(folder, 'host.mjs');
  await writeFile(entry, `import {createServer} from 'node:http';
    const server=createServer((request,response)=>{response.writeHead(401);response.end();});
    server.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=contract'));
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `);
  const host = await launchHimaHost({ dshEntry: entry, node: process.execPath, cwd: folder, env: process.env, profile: 'hima' });
  try { await assert.rejects(host.stop(), /resource shutdown unconfirmed/); }
  finally { if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL'); await rm(folder, { recursive: true, force: true }); }
});

// Actual positive native finalization is covered by host-lifecycle.host.test.ts's
// normal-Host and delayed-disposal cases. A raw receipt cannot replace that protocol.
test('a raw positive receipt cannot confirm shutdown without native finalization', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'hima-host-positive-receipt-'));
  const entry = path.join(folder, 'host.mjs');
  await writeFile(entry, `import {createServer} from 'node:http';
    const server=createServer((request,response)=>{response.writeHead(401);response.end();});
    server.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>process.stderr.write('hima: resource shutdown confirmed; pid='+process.pid+'\\n',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=contract')));
    process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `);
  const host = await launchHimaHost({ dshEntry: entry, node: process.execPath, cwd: folder, env: process.env, profile: 'hima' });
  try {
    await assert.rejects(host.stop(), /resource shutdown unconfirmed/);
    assert.ok(host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${host.child.pid}`), 'a real flushed raw receipt was present');
    assert.equal(host.child.exitCode, null, 'failed finalization does not signal the original Host');
    assert.equal(host.child.signalCode, null);
    process.kill(host.child.pid!, 0);
  }
  finally { if (host.child.exitCode === null && host.child.signalCode === null) host.child.kill('SIGKILL'); await rm(folder, { recursive: true, force: true }); }
});

// This provider qualifies the launcher protocol only. Actual DBOS/PG ownership stays
// covered by host-lifecycle.host.test.ts; the child owns each protocol transition.
async function nativeExitProvider(behavior: 'ready' | 'never' | 'late' | 'replaced' | 'wrong-finalization', accepted = false) {
  const folder = await mkdtemp(path.join(tmpdir(), 'hima-native-exit-'));
  const entry = path.join(folder, 'fake.mjs'), eventsFile = path.join(folder, 'events.json');
  await writeFile(entry, `import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';
    const behavior=${JSON.stringify(behavior)},events=[],record=event=>{events.push(event);writeFileSync(${JSON.stringify(eventsFile)},JSON.stringify(events));};
    let state=${accepted ? "{requestId:'original-drain',mode:'drain',ready:false}" : '{ready:false}'},reads=0,finalized=false;
    const server=createServer(async(req,res)=>{
      if(req.url!=='/hima/api/lifecycle/exit'){res.writeHead(401);res.end('{}');return;}
      if(req.headers['x-hima-desktop-control']!==process.env.HIMA_DESKTOP_CONTROL_TOKEN){res.writeHead(403);res.end('{}');return;}
      const answer=()=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(state));};
      if(req.method==='POST'){
        let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);record({kind:'post',...body});
        if(body.mode==='finish-exit'){
          if(!state.ready||body.requestId!==state.requestId){res.writeHead(409);res.end('{}');return;}
          finalized=true;state={...state,finalized:true};
          if(behavior==='wrong-finalization')state={...state,requestId:'different-request'};
        }else if(!state.requestId){state={requestId:body.requestId,mode:body.mode,ready:false};}
        else {res.writeHead(409);res.end('{}');return;}
        answer();return;
      }
      if(state.requestId){reads++;if(behavior!=='never'&&behavior!=='late'&&reads>=2)state={...state,ready:true};
        if(behavior==='replaced'&&reads>=2)state={requestId:'different-request',mode:'stop-jobs',ready:true};}
      record({kind:'get',...state});
      if(behavior==='late'&&state.requestId){setTimeout(()=>{state={...state,ready:true};answer();},250);return;}
      answer();
    });
    process.on('SIGTERM',()=>{record({kind:'signal',finalized,...state});
      if(!finalized){server.close(()=>process.exit(2));return;}
      process.stderr.write('hima: resource shutdown confirmed; pid='+process.pid+'\\n',()=>server.close(()=>process.exit(0)));
    });
    server.listen(Number(process.argv[process.argv.indexOf('--port')+1]),'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=fake'));
  `);
  const host = await launchHimaHost({ dshEntry: entry, node: process.execPath, cwd: folder, env: { ...process.env, DSH_HOME: folder }, profile: 'hima' });
  return { host, events: async () => JSON.parse(await readFile(eventsFile, 'utf8')) as {kind:string;requestId?:string;mode?:string;ready?:boolean;finalized?:boolean}[],
    dispose: async () => { if(host.child.exitCode===null&&host.child.signalCode===null){const closed=new Promise(resolve=>host.child.once('close',resolve));host.child.kill('SIGKILL');await closed;}await rm(folder,{recursive:true,force:true}); } };
}

test('native stop awaits the original accepted exit boundary before finalization and normal signal', async () => {
  for (const accepted of [false, true]) {
    const fixture = await nativeExitProvider('ready', accepted);
    try {
      assert.equal(await fixture.host.stop(2000), 0);
      const events = await fixture.events(), posts = events.filter(event => event.kind === 'post');
      const requestId = accepted ? 'original-drain' : posts[0]!.requestId;
      assert.ok(requestId);
      assert.deepEqual(posts.map(event => event.mode), accepted ? ['finish-exit'] : ['keep-jobs','finish-exit']);
      assert.ok(posts.every(event => event.requestId === requestId), 'accepted exit identity is never replaced');
      const boundary = events.findIndex(event => event.kind === 'get' && event.ready === true);
      const finish = events.findIndex(event => event.mode === 'finish-exit');
      assert.ok(boundary >= 0 && boundary < finish, 'finalization follows observed actual readiness');
      assert.equal(events.at(-1)!.kind, 'signal');
      assert.equal(events.at(-1)!.finalized, true);
      assert.equal(events.at(-1)!.mode, accepted ? 'drain' : 'keep-jobs');
      assert.ok(fixture.host.stderr().split('\n').includes(`hima: resource shutdown confirmed; pid=${fixture.host.child.pid}`));
    } finally { await fixture.dispose(); }
  }
});

test('native stop grace expires without signaling or replacing an exit that never becomes ready', async () => {
  const fixture = await nativeExitProvider('never', true);
  try {
    const started = performance.now();
    await assert.rejects(fixture.host.stop(180), /resource shutdown unconfirmed/);
    assert.ok(performance.now() - started >= 150, 'stop waits for its caller grace rather than immediately refusing');
    const events = await fixture.events();
    assert.ok(events.length >= 2);
    assert.ok(events.every(event => event.kind === 'get' && event.requestId === 'original-drain' && event.mode === 'drain'));
    assert.equal(fixture.host.child.exitCode, null); assert.equal(fixture.host.child.signalCode, null);
    assert.equal(fixture.host.stderr().includes('resource shutdown confirmed'), false);
  } finally { await fixture.dispose(); }
});

test('native stop cannot finalize or signal from readiness returned after its caller grace', async () => {
  const fixture = await nativeExitProvider('late', true);
  try {
    await assert.rejects(fixture.host.stop(100), /resource shutdown unconfirmed/);
    assert.ok((await fixture.events()).every(event => event.kind === 'get'));
    assert.equal(fixture.host.child.exitCode, null); assert.equal(fixture.host.child.signalCode, null);
  } finally { await fixture.dispose(); }
});

test('native stop refuses a changed accepted request or mismatching finalization identity', async () => {
  for (const behavior of ['replaced', 'wrong-finalization'] as const) {
    const fixture = await nativeExitProvider(behavior, true);
    try {
      await assert.rejects(fixture.host.stop(2000), /resource shutdown unconfirmed/);
      const events = await fixture.events();
      assert.equal(events.some(event => event.kind === 'signal'), false);
      assert.ok(events.filter(event => event.kind === 'post').every(event => event.requestId === 'original-drain' && event.mode === 'finish-exit'));
      if (behavior === 'replaced') assert.equal(events.some(event => event.kind === 'post'), false);
      assert.equal(fixture.host.child.exitCode, null); assert.equal(fixture.host.child.signalCode, null);
    } finally { await fixture.dispose(); }
  }
});

test('a Host stopped before readiness cannot confirm resources from a zero exit without a receipt', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'hima-host-boot-stop-'));
  const entry = path.join(folder, 'host.mjs');
  await writeFile(entry, `process.on('SIGTERM',()=>process.exit(0)); console.log('booting'); setInterval(()=>{},1000);`);
  let stop: (() => Promise<number | null>) | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let ready!: () => void;
  const readyToStop = new Promise<void>(resolve => { ready = resolve; });
  const launching = launchHimaHost({ dshEntry: entry, node: process.execPath, cwd: folder, env: process.env,
    profile: 'hima', timeoutMs: 1000, onSpawn: (spawned, lifecycle) => {
      child = spawned;
      stop = lifecycle ? () => lifecycle.stop() : () => stopChild(spawned);
      spawned.stdout!.once('data', () => ready());
    } });
  const failed = assert.rejects(launching, /exited before startup|readiness/);
  try {
    await readyToStop;
    await assert.rejects(stop!(), /resource shutdown unconfirmed/);
    await failed;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await failed;
    await rm(folder, { recursive: true, force: true });
  }
});

test('a native runtime moved to a directory containing spaces initializes and closes a real cluster', async () => {
  const container = await mkdtemp(path.join(tmpdir(), 'hima-pg-relocation-'));
  const staged = path.join(container, 'staged'); const moved = path.join(container, 'moved native distribution');
  await cp(runtimeDirectory!, staged, { recursive: true, dereference: false, verbatimSymlinks: true });
  await rename(staged, moved);
  const home = path.join(container, 'home');
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  try {
    database = await startLocalDatabase({ home, runtimeDirectory: moved });
    const authenticated = spawnSync(path.join(moved, 'bin/psql'), ['-X', '-A', '-t', '-c', 'SELECT 123'], {
      env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(database.application.port), PGUSER: database.application.user,
        PGDATABASE: database.application.database, PGPASSWORD: database.application.password }, encoding: 'utf8',
    });
    assert.equal(authenticated.status, 0, authenticated.stderr);
    assert.equal(authenticated.stdout.trim(), '123');
  } finally { await database?.stop(); await rm(container, { recursive: true, force: true }); }
});

async function timeoutRuntime(directory: string, delayedAction: 'start' | 'stop'): Promise<string> {
  const runtime = path.join(directory, 'fault-runtime');
  await cp(runtimeDirectory!, runtime, { recursive: true, dereference: false, verbatimSymlinks: true });
  await rename(path.join(runtime, 'bin/pg_ctl'), path.join(runtime, 'bin/pg_ctl-real'));
  const wrapper = `#!${process.execPath}\nimport {spawnSync} from 'node:child_process';\nimport path from 'node:path';\nconst result=spawnSync(path.join(import.meta.dirname,'pg_ctl-real'),process.argv.slice(2),{stdio:'inherit'});\nif(result.status!==0)process.exit(result.status??1);\nif(process.argv.at(-1)===${JSON.stringify(delayedAction)})setTimeout(()=>process.exit(0),5000);else process.exit(0);\n`;
  await writeFile(path.join(runtime, 'bin/pg_ctl'), wrapper, { mode: 0o755 });
  const manifestFile = path.join(runtime, 'postgres-runtime.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { files: Record<string, string> };
  manifest.files['bin/pg_ctl-real'] = manifest.files['bin/pg_ctl']!;
  manifest.files['bin/pg_ctl'] = createHash('sha256').update(wrapper).digest('hex');
  await writeFile(manifestFile, JSON.stringify(manifest));
  return runtime;
}

test('a timed-out startup is reconciled to the original live database after the failed Host exits', async () => {
  const container = await mkdtemp(path.join(tmpdir(), 'hima-pg-timeout-'));
  const home = path.join(container, 'home');
  const seeded = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
  const identity = seeded.identity; await seeded.stop();
  const faultRuntime = await timeoutRuntime(container, 'start');
  const entry = new URL('../../packages/harness/src/local-database.ts', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import { startLocalDatabase } from ${JSON.stringify(entry)};
    try { await startLocalDatabase({ home: ${JSON.stringify(home)}, runtimeDirectory: ${JSON.stringify(faultRuntime)}, timeoutMs: 1000 }); process.exitCode=2; }
    catch(error) { console.log(error.message); }
  `]);
  let output = ''; child.stdout.on('data', value => { output += String(value); });
  let database: Awaited<ReturnType<typeof startLocalDatabase>> | undefined;
  try {
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 0);
    assert.match(output, /timed out/);
    const pidFile = path.join(home, 'hima/database/data/postmaster.pid');
    const originalPid = (await readFile(pidFile, 'utf8')).split('\n')[0];
    database = await startLocalDatabase({ home, runtimeDirectory: faultRuntime });
    assert.equal(database.identity, identity);
    assert.equal((await readFile(pidFile, 'utf8')).split('\n')[0], originalPid);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await database?.stop();
    if (database) await rm(container, { recursive: true, force: true });
  }
});

test('stop timeout retains the Host owner until a subsequent identity check confirms the original database stopped', async () => {
  const container = await mkdtemp(path.join(tmpdir(), 'hima-pg-stop-timeout-'));
  const home = path.join(container, 'home');
  const seeded = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }); await seeded.stop();
  const faultRuntime = await timeoutRuntime(container, 'stop');
  const database = await startLocalDatabase({ home, runtimeDirectory: faultRuntime, timeoutMs: 1000 });
  try {
    await assert.rejects(database.stop(), /timed out/);
    assert.ok(await stat(path.join(home, 'hima/database/host-owner')));
    await database.stop();
    await assert.rejects(stat(path.join(home, 'hima/database/host-owner')), { code: 'ENOENT' });
  } finally { await database.stop(); await rm(container, { recursive: true, force: true }); }
});

test('a forged postmaster PID never authorizes killing an unrelated process', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-pg-pid-'));
  const database = await startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! });
  await database.stop();
  const pidFile = path.join(home, 'hima/database/data/postmaster.pid');
  try {
    await writeFile(pidFile, `${process.pid}\n${path.join(home, 'hima/database/data')}\n0\n${database.application.port}\n\n127.0.0.1\n\nready\n`);
    await assert.rejects(startLocalDatabase({ home, runtimeDirectory: runtimeDirectory! }), /identity|PID|process/i);
    assert.equal(await readFile(pidFile, 'utf8').then(text => text.split('\n')[0]), String(process.pid));
  } finally { await rm(home, { recursive: true, force: true }); }
});
