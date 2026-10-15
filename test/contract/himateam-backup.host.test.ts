import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { archive108 } from './support/issue108-backup-fixture.ts';
import { nativeArchive108 } from './support/issue108-native-fixture.ts';
const lib=process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const load=()=>import(pathToFileURL(path.join(lib,'run-backup.js')).href) as Promise<Record<string,any>>;

test('reminting an empty material directory never blesses a lost Run artifact as a complete cold backup',
  { timeout: 90_000, skip: process.env.HIMA_108_MATERIAL_LOSS_TEST !== '1' }, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'hima-108-lost-material-')));
  const home = path.join(root, 'source'), backupDirectory = path.join(root, 'refused-backup');
  const gate = await import(pathToFileURL(path.join(lib, 'local-database.js')).href);
  let identity: string | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let workerClosed = false, successful = false;
  try {
    assert.ok(process.env.HIMA_POSTGRES_RUNTIME && process.env.HIMA_U9_HARNESS_ROOT
      && process.env.HIMA_U9_DISTRIBUTION && process.env.HIMA_U9_DISTRIBUTION_MANIFEST
      && process.env.HIMA_TEST_LINEAGE_DIR, 'Use only the pinned private test runtime and frozen program');
    const { fileURLToPath } = await import('node:url');
    const spawned = spawn(process.execPath, [fileURLToPath(new URL('./support/issue108-lost-material-worker.ts', import.meta.url)),
      home, process.env.HIMA_U9_HARNESS_ROOT], { env: process.env, stdio: ['ignore','pipe','pipe','ipc'] });
    child = spawned;
    spawned.stdout!.resume(); let stderr = '';
    spawned.stderr!.on('data', bytes => { stderr = (stderr + String(bytes)).slice(-4000); });
    const ended = new Promise<number | null>(resolve => spawned.once('close', resolve));
    const receipt = await new Promise<any>((resolve, reject) => {
      spawned.once('message', resolve); spawned.once('error', reject);
      spawned.once('exit', code => reject(new Error(`Original worker exited ${code}: ${stderr}`)));
    });
    assert.equal(await ended, 0, stderr); workerClosed = true; identity = receipt.identity;
    assert.ok(identity, 'The closed original worker must identify its private lineage');
    const materialRoot = receipt.retained as string, file = receipt.file as string;
    assert.equal(materialRoot, path.join(home, 'hima/run-assets/dbos'));
    await rm(materialRoot, { recursive: true });
    assert.equal(await gate.resolveRetainedMaterialsDirectory({ home }), materialRoot);
    const reminted = await readFile(file).then(() => true, () => false); assert.equal(reminted, false);
    const backup = await load();
    await assert.rejects(backup.createColdBackup({ home, destination: backupDirectory,
      runtimeDirectory: process.env.HIMA_POSTGRES_RUNTIME!, distribution: {
        root: process.env.HIMA_U9_DISTRIBUTION!, manifestFile: process.env.HIMA_U9_DISTRIBUTION_MANIFEST!,
        harnessRoot: process.env.HIMA_U9_HARNESS_ROOT! } }), /missing referenced material/);
    await assert.rejects(readFile(path.join(backupDirectory, 'manifest.json')), { code: 'ENOENT' });
    successful = true;
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>(resolve => child!.once('close', () => resolve()));
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    if (successful) {
      assert.equal(workerClosed, true, 'Only a closed original worker can release its private Home');
      const postmaster = await lstat(path.join(home, 'hima/database/data/postmaster.pid')).then(() => true, error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      });
      assert.equal(postmaster, false, 'Preserve the original Home while its PostgreSQL closure is unknown');
      if (identity) await rm(path.join(gate.localLineageDirectory(), identity), { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    } else {
      process.stderr.write(`Issue108 material-loss failure Home retained for owned resource inspection: ${root}\n`);
    }
  }
});

test('R108-02 restored member recovery consumes the original lineage-bound lease without rewriting identity or cwd',async()=>{
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'hima-108-native-')));
  const previous=process.env.HIMA_TEST_LINEAGE_DIR,context=process.env.NODE_TEST_CONTEXT;
  process.env.HIMA_TEST_LINEAGE_DIR=path.join(root,'lineages');process.env.NODE_TEST_CONTEXT??='issue108-fs';
  try {
    const local=await import(pathToFileURL(path.join(lib,'oar-local-member.js')).href);
    assert.equal(local.retainedMemberRootProtocol,'hima-native-original-roots/1');
    const f=await nativeArchive108(root,local),backup=await load();
    const gate=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
    assert.equal(gate.localLineageDirectory(),path.join(root,'lineages'));
    const {OarLocalMemberRuntime}=await import(pathToFileURL(path.join(lib,'oar-local-member.js')).href);
    const options=(home:string)=>({home,nodeExecutable:process.execPath,runnerModule:'/unused/runner.js',assets:{oarModule:'/unused/oar.js',nodeExecutable:process.execPath,opencodeCommand:'/unused/opencode',opencodeVersion:'unused'}});
    assert.deepEqual(await new OarLocalMemberRuntime(options(f.source)).recover(f.sessionKey),f.lease);
    const before=await f.originalBytes(),home=path.join(root,'restored');await backup.restoreColdBackup({backup:f.backup,newHome:home});
    await assert.rejects(new OarLocalMemberRuntime(options(home)).recover(f.sessionKey),/held/);
    assert.equal(await readFile(path.join(home,'hima/oar-members',f.sessionKey,'lease.json'),'utf8'),f.leaseBytes);
    await f.arrangeQualifiedResolverState(backup,gate,home);await rm(path.join(home,'hima/restore-hold.json'));
    const recovered=await new OarLocalMemberRuntime(options(home)).recover(f.sessionKey);
    assert.deepEqual(recovered,f.lease);assert.deepEqual(await f.originalBytes(),before);
    assert.equal(recovered.workDirectory,f.lease.workDirectory,'DB/native predecessor cwd must stay the original absolute path');
    const checkpoint=local.verifyLocalNativeCheckpoint(recovered.controlDirectory,f.checkpoint);
    assert.equal(checkpoint.sha256,f.checkpoint.sha256);assert.equal(checkpoint.origin.cwd,f.lease.workDirectory);
    const receiptFile=path.join(home,'hima/restore-lineage.json'),receipt=await readFile(receiptFile,'utf8');
    for(const mutate of [
      (value:any)=>{value.epoch++;},(value:any)=>{value.manifest='f'.repeat(64);},
      (value:any)=>{delete value.memberRoots;},(value:any)=>{value.memberRoots[f.sessionKey].root=path.join(root,'unrelated','hima/oar-members',f.sessionKey);},
    ]) {
      const value=JSON.parse(receipt);mutate(value);await writeFile(receiptFile,JSON.stringify(value));
      await assert.rejects(new OarLocalMemberRuntime(options(home)).recover(f.sessionKey),/held|offline|binding|lineage material/);
      await writeFile(receiptFile,receipt);
    }
    await writeFile(path.join(f.memberRoot,'control/config.json'),'changed original config');
    await assert.rejects(new OarLocalMemberRuntime(options(home)).recover(f.sessionKey),/original lease\/config bytes differ/);
    assert.equal(await readFile(path.join(f.memberRoot,'control/config.json'),'utf8'),'changed original config','Resolver must not overwrite a conflicting original');
    await writeFile(path.join(f.memberRoot,'control/config.json'),f.configurationBytes);
    // An arranged resolver state is not qualification proof. The actual qualifier must
    // keep a synthetic archive without original DB effect/closure authority held.
    await writeFile(path.join(home,'hima/restore-hold.json'),'{}');
    await assert.rejects(backup.qualifyHeldRestore({newHome:home,retiredBackup:f.backup,harnessRoot:'/unused'}),/matching original effect\/closure authority/);
    assert.equal(await readFile(path.join(home,'hima/restore-hold.json'),'utf8'),'{}');
  }finally{if(previous===undefined)delete process.env.HIMA_TEST_LINEAGE_DIR;else process.env.HIMA_TEST_LINEAGE_DIR=previous;
    if(context===undefined)delete process.env.NODE_TEST_CONTEXT;else process.env.NODE_TEST_CONTEXT=context;await rm(root,{recursive:true,force:true});}
});

test('R108-03 DB-only maintenance reads existing credentials while ordinary worker setup rejects a missing model key',async()=>{
  const backup=await load();
  const hindsight=await import(pathToFileURL(path.join(lib,'hindsight-configuration.js')).href);
  const saved=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith('HIMA_HINDSIGHT_')));
  for(const key of Object.keys(saved))delete process.env[key];
  const home=await mkdtemp(path.join(tmpdir(),'hima-108-db-reader-'));
  try {
    await mkdir(path.join(home,'hima/database'),{recursive:true});
    const credentials=path.join(home,'hima/database/hindsight-credentials.json'),bytes=JSON.stringify({password:'d'.repeat(64)});
    await writeFile(credentials,bytes,{mode:0o600});
    const maintenance=(application:{host:string;port:number})=>hindsight.resolveHindsightMaintenanceConfiguration(
      ()=>backup.readColdHindsightConnection({home,application}));
    await assert.rejects(hindsight.resolveHindsightServiceEnvironment({}, {}, async()=>({
      baseUrl:'https://api.deepseek.com/anthropic',model:'deepseek-flash',provider:'anthropic-messages'})),/API key|credential/);
    const configuration=await maintenance({host:'127.0.0.1',port:55432});const url=new URL(configuration.databaseUrl);
    assert.equal(url.pathname,'/hima_hindsight');assert.equal(url.port,'55432');
    assert.equal(await readFile(credentials,'utf8'),bytes);
    assert.deepEqual(Object.keys(configuration),['databaseUrl'],'no provider/model/key should enter the maintenance configuration');
    await assert.rejects(maintenance({host:'remote.invalid',port:55432}),/original private Hindsight connection/);
    await assert.rejects(hindsight.resolveHindsightMaintenanceConfiguration(async()=>({host:'127.0.0.1',port:55432,user:'hima_hindsight',password:'d'.repeat(64),database:'hima_application'})),/original private Hindsight database/);
    await rm(credentials);await assert.rejects(maintenance({host:'127.0.0.1',port:55432}),/credentials are missing/);
    await assert.rejects(readFile(credentials),{code:'ENOENT'});
  }finally{Object.assign(process.env,saved);await rm(home,{recursive:true,force:true});}
});

test('cold /2 verifies actual service bytes and restores all Home bytes held without starting Host',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hima-108-bytes-'));
  try {
    const fixture=await archive108(root,2),backup=await load();
    const archive=await backup.inspectColdBackup(fixture.backup);assert.equal(archive.manifest.format,'hima-cold-backup/2');
    const restored=await backup.restoreColdBackup({backup:fixture.backup,newHome:path.join(root,'restored')});
    assert.equal(restored.state,'held');
    assert.equal(await readFile(path.join(restored.home,'hima/materials/revision.txt'),'utf8'),'actual revision bytes');
    assert.deepEqual(JSON.parse(await readFile(path.join(restored.home,'sessions/native.json'),'utf8')),{id:'native-session',context:'retained context'});
    const authority=JSON.parse(await readFile(path.join(restored.home,'hima/database/backup-authority.json'),'utf8'));
    assert.equal(authority.application.team_memory_events[0].event.action,'disable');
    assert.equal(authority.application.team_messages[0].envelope.text,'human correction');
    const {assertHomeExecutionAllowed}=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
    await assert.rejects(assertHomeExecutionAllowed({home:restored.home}),/held|offline/);
    assert.equal((await backup.inspectColdBackup(fixture.backup)).manifestSha256,archive.manifestSha256);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cold /2 rejects wrong cut, stale generation, missing stop, interrupted/empty export and changed bytes',async()=>{
  const backup=await load();
  const mutations:Record<string,(f:Awaited<ReturnType<typeof archive108>>)=>Promise<void>>={
    'wrong cut':async f=>{f.exported.export.cutId='other-cut';await f.publish();},
    'stale generation':async f=>{f.stopped.generation='new-generation';await f.publish();},
    'missing stop':async f=>{f.cut.services.pop();await f.publish();},
    'interrupted export':async f=>{f.exported.state='failed';await f.publish();},
    'empty export':async f=>{f.exported.export.bytes=0;await f.publish();},
    'unfenced':async f=>{f.authority.application.host_exit[0]!.finalizing=false;await f.publish();},
    'newer Host':async f=>{f.cut.host={...f.cut.host,processIdentity:'another-host'};await f.publish();},
    'modified export re-inventoried':async f=>{await writeFile(path.join(f.payload,'hima/team-service-exports/generation-108/data.zip'),'changed export');await f.publish();},
    'missing export':async f=>{await rm(path.join(f.payload,'hima/team-service-exports/generation-108/data.zip'));await f.publish();},
    'cut completed after cluster shutdown':async f=>{f.cut.completedAt='2026-10-14T10:05:00.000Z';await f.publish();},
    'missing authority table':async f=>{delete (f.authority.application as Record<string,unknown>).team_memory_events;await f.publish();},
    'empty service proof':async f=>{f.cut.services=[];await f.publish();},
    'unsupported format':async f=>{f.manifest.format='hima-cold-backup/3';await f.publish();},
    'modified bytes':async f=>{await writeFile(path.join(f.payload,'hima/materials/revision.txt'),'changed input');},
  };
  for(const [name,mutate]of Object.entries(mutations)) {
    const root=await mkdtemp(path.join(tmpdir(),'hima-108-refuse-'));
    try{const fixture=await archive108(root,2);await mutate(fixture);await assert.rejects(backup.inspectColdBackup(fixture.backup),/Cold backup:/,name);}
    finally{await rm(root,{recursive:true,force:true});}
  }
});

test('a rejected maintenance attempt invalidates an older cut before any database or exporter access',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hima-108-interrupted-'));
  try {
    await mkdir(path.join(root,'hima/database'),{recursive:true});
    const cut=path.join(root,'hima/database/maintenance-cut.json');await writeFile(cut,'old cut');
    const unavailable=async():Promise<never>=>{throw new Error('A rejected boundary must not reach a service or database');};
    const backup=await load();
    await assert.rejects(backup.prepareColdMaintenanceCut({home:root,status:async()=>({ready:false,agents:['working-member'],runs:[]}),
      serviceDatabase:unavailable,services:{status:unavailable,export:unavailable,stop:unavailable}}),/fenced Host boundary/);
    await assert.rejects(readFile(cut),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cold /2 accepts an authoritative never-started service status without inventing an export',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hima-108-unused-'));
  try {
    const fixture=await archive108(root,2,true),backup=await load();
    const archive=await backup.inspectColdBackup(fixture.backup);assert.equal(archive.manifest.format,'hima-cold-backup/2');
    assert.equal(archive.manifest.maintenanceCut!.services[0]!.diagnostic?.code,'not-started');
    assert.equal(archive.manifest.maintenanceCut!.services.some((receipt:{export?:unknown})=>receipt.export!==undefined),false);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('I-scheduled real Hindsight/PG cut blocks late DML and exports stopped data without restarting a worker',
  {timeout:process.env.HIMA_108_FULL_ARCHIVE==='1'?550_000:240_000,skip:process.env.HIMA_108_REAL_SERVICE!=='1'},async(t)=>{
  const {spawn}=await import('node:child_process');const {fileURLToPath}=await import('node:url');
  const harnessRoot=process.env.HIMA_U9_HARNESS_ROOT!;
  const workerHarnessRoot=process.env.HIMA_108_WORKER_HARNESS_ROOT??harnessRoot;
  assert.ok(harnessRoot&&process.env.HIMA_POSTGRES_RUNTIME&&process.env.HIMA_TEAM_RUNTIME&&process.env.HIMA_TEST_LINEAGE_DIR,'I must supply built source, fixed same-platform PG/Team identities and the canonical runner private lineage directory');
  const executable=await import(pathToFileURL(path.join(lib,'durable-runtime.js')).href);
  assert.equal(executable.executableApplicationVersion(await executable.installedExecutableManifest(workerHarnessRoot)),
    executable.executableApplicationVersion(await executable.installedExecutableManifest(harnessRoot)),
    'The development worker and frozen reader must contain the exact same executable program');
  const gate=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
  assert.equal(path.resolve(gate.localLineageDirectory()),path.resolve(process.env.HIMA_TEST_LINEAGE_DIR!),'Never use a real user lineage authority');
  const root=await mkdtemp(path.join(process.env.HIMA_108_EVIDENCE_ROOT??tmpdir(),'hima-108-real-'));
  const home=path.join(root,'source'),target=path.join(root,'restored');let child:ReturnType<typeof spawn>|undefined,identity:string|undefined;
  let stderr='',primaryFailure:unknown;
  let passed=false,archivePassed=process.env.HIMA_108_FULL_ARCHIVE!=='1',cutId:string|undefined;
  let finalArchive:{backup:string;manifestSha256:string;zipSha256:string;zipBytes:number}|undefined;
  try {
    child=spawn(process.execPath,[fileURLToPath(new URL('./support/issue108-service-cut-worker.ts',import.meta.url)),home,workerHarnessRoot],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
    child.stdout!.resume();child.stderr!.on('data',bytes=>{stderr+=String(bytes);});
    const ended=new Promise<number|null>(resolve=>child!.once('close',resolve));
    const receipt=await new Promise<any>((resolve,reject)=>{child!.once('message',resolve);child!.once('error',reject);child!.once('exit',code=>reject(new Error(`cut worker exited ${code}: ${stderr}`)));});
    assert.equal(await ended,0,stderr);identity=receipt.identity;cutId=receipt.cutId;assert.equal(receipt.blockedWriter,true);assert.ok(receipt.serviceBytes>0);
    const authority=JSON.parse(await readFile(path.join(home,'hima/database/backup-authority.json'),'utf8'));
    const cut=JSON.parse(await readFile(path.join(home,'hima/database/maintenance-cut.json'),'utf8'));
    assert.equal(cut.identity,authority.identity);assert.deepEqual(cut.host,authority.host);
    assert.equal(cut.cutId,receipt.cutId);assert.equal(receipt.offlineWorkerNotStarted,true);assert.ok(receipt.zip.banksRows>=1);
    assert.equal(authority.application.team_versions.length,2);assert.equal(authority.application.team_memory_events[0].event.event,'disabled');
    assert.equal(authority.application.runs.length,0);assert.equal(authority.application.effects.length,0);
    await t.test('whole /2 final retirement and qualification against the exact retained distribution',
      {skip:process.env.HIMA_108_FULL_ARCHIVE!=='1'},async()=>{
    assert.ok(process.env.HIMA_U9_DISTRIBUTION&&process.env.HIMA_U9_DISTRIBUTION_MANIFEST,'A complete frozen current same-platform distribution is required for this distinct claim');
    const backup=await load();
    const archive=await backup.retireSource({home,targetHome:target,destination:path.join(root,'final'),runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME!,
      distribution:{root:process.env.HIMA_U9_DISTRIBUTION!,manifestFile:process.env.HIMA_U9_DISTRIBUTION_MANIFEST!,harnessRoot}});
    assert.equal(archive.manifest.format,'hima-cold-backup/2');assert.equal(archive.manifest.authority.application.team_versions!.length,2);
    const before=JSON.stringify(archive.manifest.authority.application);
    const nativeSession=await readFile(path.join(home,'sessions/native.json'),'utf8');
    await rm(home,{recursive:true});
    const held=await backup.restoreColdBackup({backup:archive.backup,newHome:target});assert.equal(held.state,'held');
    assert.ok(await readFile(path.join(target,'hima/restore-hold.json')),'The imported Home stays held until qualification');
    const qualified=await backup.qualifyHeldRestore({newHome:target,retiredBackup:archive.backup,harnessRoot});assert.equal(qualified.state,'qualified');
    assert.equal(await readFile(path.join(target,'sessions/native.json'),'utf8'),nativeSession);
    const exportFile=archive.manifest.maintenanceCut!.services.find((receipt:{operation?:string})=>receipt.operation==='export')!.export!.file;
    const zip=await readFile(exportFile);
    assert.ok(zip.byteLength>0,'Prior service-export references remain resolvable at their original material-only paths');
    assert.equal(JSON.stringify(JSON.parse(await readFile(path.join(target,'hima/database/backup-authority.json'),'utf8')).application),before);
    assert.equal(JSON.parse(await readFile(path.join(target,'hima/database/backup-authority.json'),'utf8')).application.team_memory_events[0].event.event,'disabled');
    finalArchive={backup:archive.backup,manifestSha256:archive.manifestSha256,zipSha256:createHash('sha256').update(zip).digest('hex'),zipBytes:zip.byteLength};
    archivePassed=true;
    });
    assert.equal(archivePassed,true,'The distinct whole-archive subtest failed; preserve its evidence');passed=true;
  }catch(error){
    primaryFailure=error;
    await writeFile(path.join(root,'worker-failure.json'),JSON.stringify({message:error instanceof Error?error.message:String(error),stderr:stderr.slice(-12000)},null,2),{mode:0o600});
    throw error;
  }finally {
    if(child&&child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child!.once('close',resolve));child.kill('SIGTERM');await closed;}
    // Preserve an interrupted private PG fixture rather than deleting live state. I reconciles
    // only this test's named Home before removal; never signal arbitrary persisted PIDs.
    const {lstat}=await import('node:fs/promises');
    const pgLive=await lstat(path.join(home,'hima/database/data/postmaster.pid')).catch(()=>undefined);
    if(pgLive&&!primaryFailure)throw new Error(`Issue108 private failure Home retained for owned resource reconciliation: ${root}`);
    const {localLineageDirectory}=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
    const credentials=await readFile(path.join(home,'hima/database/credentials.json'),'utf8').catch(()=>undefined);
    identity??=credentials?JSON.parse(credentials).identity:undefined;
    if(!passed) {
      if(identity) {
        const lineage=await readFile(path.join(localLineageDirectory(),identity,'lineage.json')).catch(()=>undefined);
        if(lineage)await writeFile(path.join(root,'failure-lineage-evidence.json'),lineage,{mode:0o600});
      }
      process.stderr.write(`Issue108 private stopped failure fixture retained for inspection: ${root}\n`);
    }else if(process.env.HIMA_108_KEEP_PROOF==='1'&&finalArchive) {
      await writeFile(path.join(root,'retained-success.json'),JSON.stringify({scope:'whole /2 backend and actual service cut; no real member',
        sourceHome:home,restoredHome:target,identity,cutId,...finalArchive},null,2),{mode:0o600});
      process.stderr.write(`Issue108 verified private /2 fixture retained for inspection: ${root}\n`);
    }else {
      if(identity)await rm(path.join(localLineageDirectory(),identity),{recursive:true,force:true});
      await rm(root,{recursive:true,force:true});
    }
  }
});
