import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startLocalDatabase } from '../../packages/harness/src/local-database.ts';
import { launchHimaHost } from '../../packages/desktop/src/host-launch.ts';

test('held import refuses direct database and Desktop startup before runtime or dsh access', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-u9-held-'));
  await mkdir(path.join(home, 'hima'), { mode: 0o700 });
  await writeFile(path.join(home, 'hima/restore-hold.json'), JSON.stringify({format:'hima-restore-hold/1', reason:'final source retirement required'}), {mode:0o600});
  let spawned = false;
  try {
    await assert.rejects(startLocalDatabase({home,runtimeDirectory:'/missing-u9-runtime'}), /held.*offline|offline.*held/i);
    await assert.rejects(launchHimaHost({node:process.execPath,dshEntry:'/missing-u9-dsh',cwd:home,env:{...process.env,DSH_HOME:home},profile:'hima',onSpawn:()=>{spawned=true;}}), /held.*offline|offline.*held/i);
    assert.equal(spawned,false);
  } finally { await rm(home,{recursive:true,force:true}); }
});

// Full distribution identities come from the root's single canonical candidate build. A synthetic
// file list cannot turn this into a product completeness qualification.
test('cold cut A cannot resume after newer decision/Job B; final whole retired B preserves original IDs', {timeout:600_000,skip:!process.env.HIMA_U9_DISTRIBUTION}, async () => {
  const {spawn,spawnSync}=await import('node:child_process');
  const {appendFile,readFile,rename,stat}=await import('node:fs/promises');
  const {pathToFileURL,fileURLToPath}=await import('node:url');
  const harnessRoot=process.env.HIMA_U9_HARNESS_ROOT!;
  const lib=process.env.HIMA_DBOS_TEST_LIB ?? path.join(harnessRoot,'lib');
  const backup=await import(pathToFileURL(path.join(lib,'run-backup.js')).href);
  const gate=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
  const fixture=await mkdtemp(path.join(tmpdir(),'hima-u9-backup-'));
  const evidence=process.env.HIMA_U9_EVIDENCE_DIRECTORY;const startedAt=Date.now();let passed=false;
  if(evidence)await mkdir(evidence,{recursive:true,mode:0o700});
  const trace=async(stage:string,detail:Record<string,unknown>={})=>{const event={stage,elapsedMs:Date.now()-startedAt,...detail};if(evidence)await appendFile(path.join(evidence,'steps.jsonl'),JSON.stringify(event)+'\n',{mode:0o600});};
  await trace('fixture-created',{fixture});
  const source=path.join(fixture,'source'),target=path.join(fixture,'restored'),workspace=path.join(fixture,'workspace'),counter=path.join(fixture,'external-calls');
  const archiveA=path.join(fixture,'archive-A'),archiveB=path.join(fixture,'archive-B'),archiveC=path.join(fixture,'archive-C');
  const savedDisk=path.join(fixture,'saved-original-disk'),thirdHome=path.join(fixture,'third-home');
  const distribution={root:process.env.HIMA_U9_DISTRIBUTION!,manifestFile:process.env.HIMA_U9_DISTRIBUTION_MANIFEST!,harnessRoot};
  const runtimeDirectory=process.env.HIMA_POSTGRES_RUNTIME!;
  const workers:Array<ReturnType<typeof spawn>>=[];
  async function worker(home:string,mode:string):Promise<any> {
    const child=spawn(process.execPath,[fileURLToPath(new URL('./support/dbos-backup-worker.ts',import.meta.url)),home,mode,workspace,counter,harnessRoot],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
    workers.push(child);let err='';child.stdout!.resume();child.stderr!.on('data',value=>{err+=String(value);});
    const ended=new Promise<number|null>(resolve=>child.once('close',resolve));
    const result=await new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(new Error(`backup worker ${mode} ended ${code}: ${err}`)));});
    child.send('close');assert.equal(await ended,0,err);return result;
  }
  let identity:string|undefined;
  try {
    await trace('worker-A-start');
    const first=await worker(source,'A');await trace('worker-A-stopped',{applicationVersion:first.version});assert.equal(first.stage,'after-A');
    await trace('archive-A-start');
    const a=await backup.createColdBackup({home:source,destination:archiveA,runtimeDirectory,distribution});identity=a.manifest.identity;await trace('archive-A-complete',{manifestSha256:a.manifestSha256,roots:a.manifest.roots.length});
    assert.equal(a.manifest.applicationVersion,first.version);
    await trace('worker-B-start');await worker(source,'B');await trace('worker-B-stopped');assert.equal(await readFile(counter,'utf8'),'A\nB\n');
    await trace('archive-B-retirement-start');
    const b=await backup.retireSource({home:source,targetHome:target,destination:archiveB,runtimeDirectory,distribution});
    await trace('archive-B-retired',{manifestSha256:b.manifestSha256,roots:b.manifest.roots.length});
    assert.notEqual(a.manifestSha256,b.manifestSha256);
    const human=(archive:any)=>archive.manifest.authority.application.runs.find((row:any)=>row.run_id==='human-held');
    assert.deepEqual(human(a),human(b));assert.deepEqual(a.manifest.authority.application.flow_branch_controls,b.manifest.authority.application.flow_branch_controls);assert.equal(a.manifest.authority.application.flow_branch_controls[0].hold,'pause');assert.equal(a.manifest.authority.application.flow_branch_controls[0].hold_source,'human');assert.equal(human(a).hold_source,'human');assert.equal(human(b).hold_source,'human');
    await rm(source,{recursive:true});
    await rm(workspace,{recursive:true});
    await assert.rejects(stat(source),{code:'ENOENT'});await assert.rejects(stat(workspace),{code:'ENOENT'});
    await trace('original-Home-and-Job-workspace-absent');
    await trace('held-A-import-start');await backup.restoreColdBackup({backup:archiveA,newHome:target});await trace('held-A-imported');
    await assert.rejects(gate.assertHomeExecutionAllowed({home:target}),/held|offline/);
    await trace('old-A-qualification-start');await assert.rejects(backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveA,harnessRoot}),/final retirement/);await trace('old-A-remains-held');
    assert.equal(await readFile(counter,'utf8'),'A\nB\n');
    const originalJob=b.manifest.authority.application.effect_facts.find((row:any)=>row.effect_id==='effect-A'&&row.phase==='native:submitted').fact;
    assert.equal(spawnSync('tmux',['new-session','-d','-s',originalJob.session,'sleep 60'],{encoding:'utf8'}).status,0);
    try {
      await assert.rejects(backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveB,harnessRoot}),/session closure is unknown/);
      await assert.rejects(stat(workspace),{code:'ENOENT'});
      await assert.rejects(gate.assertHomeExecutionAllowed({home:target}),/held|offline/);
    } finally {spawnSync('tmux',['kill-session','-t',`=${originalJob.session}`]);}
    await trace('live-original-session-refused-before-missing-material-restoration');
    await trace('replace-with-B-start');const qualified=await backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveB,harnessRoot});assert.equal(qualified.state,'qualified');await trace('B-qualified',{epoch:qualified.epoch,previousHome:qualified.previousHome});
    assert.ok(qualified.previousHome);assert.equal((await stat(path.join(qualified.previousHome,'hima/restore-hold.json'))).isFile(),true);
    assert.equal(await gate.resolveRetainedMaterialsDirectory({home:target}),a.manifest.retainedMaterialsDir);
    // A same-final-manifest marker cannot bless damaged held PG bytes. Reimport this fixture's
    // exact final archive after its target Host has stopped, then damage one copied cluster leaf.
    await trace('same-B-corruption-test-start');await rm(target,{recursive:true});await backup.restoreColdBackup({backup:archiveB,newHome:target});
    const pidFile=path.join(workspace,`${originalJob.session}.pid`),logFile=path.join(workspace,`${originalJob.session}.log`);
    const originalPid=await readFile(pidFile),originalLog=await readFile(logFile);
    await writeFile(pidFile,String(process.pid));
    await assert.rejects(backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveB,harnessRoot}),/is live or its closure is unknown/);
    await assert.rejects(gate.assertHomeExecutionAllowed({home:target}),/held|offline/);await writeFile(pidFile,originalPid);
    await writeFile(logFile,'conflicting original log bytes');
    await assert.rejects(backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveB,harnessRoot}),/copied inventory differs/);
    assert.equal(await readFile(logFile,'utf8'),'conflicting original log bytes');
    await assert.rejects(gate.assertHomeExecutionAllowed({home:target}),/held|offline/);await writeFile(logFile,originalLog);
    await trace('live-original-PID-and-existing-hash-conflict-remain-held');
    await writeFile(path.join(target,'hima/database/data/PG_VERSION'),'999\n');
    const repaired=await backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveB,harnessRoot});
    assert.ok(repaired.previousHome);assert.equal((await readFile(path.join(target,'hima/database/data/PG_VERSION'),'utf8')).trim(),'16');
    assert.equal((await readFile(path.join(repaired.previousHome,'hima/database/data/PG_VERSION'),'utf8')).trim(),'999');
    assert.equal(await readFile(counter,'utf8'),'A\nB\n');await trace('same-B-damaged-home-replaced',{previousHome:repaired.previousHome});
    await trace('original-recovery-and-later-task-start');const resumed=await worker(target,'recover');assert.equal(resumed.stage,'recovered-original');assert.equal(resumed.held.hold,'pause');assert.equal(resumed.held.holdSource,'human');assert.equal(resumed.branchControls[0].holdSource,'human');assert.equal(resumed.later.workflowID,'workflow-u9-later-original');await trace('original-recovery-and-later-task-complete',{workflowId:resumed.status.workflowID,laterWorkflowId:resumed.later.workflowID,deadlineAt:resumed.held.deadlineAt,held:resumed.held.hold});
    assert.equal(await readFile(counter,'utf8'),'A\nB\nC\n');
    await assert.rejects(gate.startLocalDatabase({home:source,runtimeDirectory:'/missing-runtime'}),/retired/);
    await trace('second-clone-start');const clone=path.join(fixture,'second-clone');await backup.restoreColdBackup({backup:archiveB,newHome:clone});
    await assert.rejects(backup.qualifyHeldRestore({newHome:clone,retiredBackup:archiveB,harnessRoot}),/activated|final retirement/);await trace('second-clone-held');
    const {createHash}=await import('node:crypto');
    const {readdir}=await import('node:fs/promises');
    const retainedRoot=await gate.resolveRetainedMaterialsDirectory({home:target});
    async function treeDigest(root:string):Promise<string>{const hash=createHash('sha256');async function walk(at:string){for(const name of (await readdir(at)).sort()){const file=path.join(at,name),info=await stat(file);hash.update(path.relative(root,file));if(info.isDirectory())await walk(file);else hash.update(await readFile(file));}}await walk(root);return hash.digest('hex');}
    const materialBefore=await treeDigest(retainedRoot);
    await trace('database-only-control-start');const control=await worker(target,'control-only');assert.equal(control.stage,'database-only-control');assert.equal(control.afterEpoch,control.beforeEpoch+1);
    assert.equal(await treeDigest(retainedRoot),materialBefore,'Later database-only control changes no retained material');
    await trace('database-only-control-stopped',{commandId:control.commandId,retainedMaterialDigest:materialBefore});
    assert.equal(b.manifest.authority.application.commands.some((row:any)=>row.command_id===control.commandId),false);
    await trace('activated-target-loss-test-start');
    // Lost-mount fixture: move the actual complete stopped disk aside; do not reconstruct its
    // checkpoints. Old B at the original path still cannot establish the newer DB-only suffix.
    await rename(target,savedDisk);await backup.restoreColdBackup({backup:archiveB,newHome:target});
    await assert.rejects(backup.qualifyHeldRestore({newHome:target,retiredBackup:archiveB,harnessRoot}),/target already activated.*newer database records/);
    await assert.rejects(gate.assertHomeExecutionAllowed({home:target}),/held|offline/);
    assert.equal(await readFile(counter,'utf8'),'A\nB\nC\n');
    await trace('old-B-remains-held-after-target-loss',{counter:'A,B,C'});
    // Return the exact saved disk to its original absolute name, like restoring a lost mount.
    // Remove only this fixture's held old-B import; no PG or SDK state is synthesized or merged.
    await rm(target,{recursive:true});await rename(savedDisk,target);
    const consumed=await gate.readDatabaseLineage(identity);assert.ok(consumed.activated);
    await trace('fresh-retirement-C-start',{priorEpoch:consumed.epoch,fixtureOperation:'saved original disk returned to exact path'});
    const c=await backup.retireSource({home:target,targetHome:thirdHome,destination:archiveC,runtimeDirectory,distribution});
    const retiredAgain=await gate.readDatabaseLineage(identity);
    assert.equal(retiredAgain.epoch,consumed.epoch+1);assert.equal(retiredAgain.currentHome,await gate.canonicalHome(thirdHome));assert.equal(retiredAgain.activated,undefined);assert.equal(retiredAgain.retiredManifest,c.manifestSha256);
    assert.equal(human(c).hold_source,'human');assert.equal(human(c).deadline_at,human(b).deadline_at);
    assert.equal(c.manifest.authority.application.flow_branch_controls[0].hold_source,'human');
    assert.ok(c.manifest.authority.application.commands.some((row:any)=>row.command_id===control.commandId));
    await trace('fresh-retirement-C-complete',{epoch:retiredAgain.epoch,manifestSha256:c.manifestSha256,activationCleared:true});
    await backup.restoreColdBackup({backup:archiveC,newHome:thirdHome});
    const qualifiedC=await backup.qualifyHeldRestore({newHome:thirdHome,retiredBackup:archiveC,harnessRoot});assert.equal(qualifiedC.epoch,retiredAgain.epoch);
    await trace('third-home-C-qualified',{epoch:qualifiedC.epoch});
    const reopened=await worker(thirdHome,'recover-again');assert.equal(reopened.status.applicationVersion,first.version);assert.equal(reopened.held.holdSource,'human');assert.equal(reopened.branchControls[0].holdSource,'human');assert.equal(reopened.held.epoch,control.afterEpoch);assert.equal(reopened.held.deadlineAt,resumed.held.deadlineAt);
    assert.equal(await readFile(counter,'utf8'),'A\nB\nC\n');assert.equal(await treeDigest(retainedRoot),materialBefore);assert.ok((await gate.readDatabaseLineage(identity)).activated);
    await assert.rejects(gate.startLocalDatabase({home:target,runtimeDirectory:'/missing-runtime'}),/retired/);
    await trace('third-home-original-version-reopened',{workflowId:reopened.status.workflowID,counter:'A,B,C',holdSource:reopened.held.holdSource,epoch:qualifiedC.epoch});
    const summary={format:'hima-u9-backup-proof/1',distribution:distribution.root,applicationVersion:first.version,archiveA:a.manifestSha256,archiveB:b.manifestSha256,archiveC:c.manifestSha256,freshRetirementEpoch:retiredAgain.epoch,freshRetirementActivationCleared:true,fixtureOperation:'saved original stopped disk moved aside for loss and returned intact to exact original path',retainedMaterialsDir:retainedRoot,originalRunId:'run-u9',originalWorkflowId:'workflow-u9-original',originalEffects:['effect-A','effect-B'],laterWorkflowId:resumed.later.workflowID,humanHold:resumed.held.hold,humanHoldSource:resumed.held.holdSource,restoredBranchControls:reopened.branchControls,deadlineAt:resumed.held.deadlineAt,branchControls:b.manifest.authority.application.flow_branch_controls,results:b.manifest.authority.application.results.map((row:any)=>({effectId:row.effect_id,identity:row.result.identity,resultSha256:row.result_sha256})),counter:'A,B,C',databaseOnlyControl:control.commandId,retainedMaterialDigest:materialBefore};
    if(evidence)await writeFile(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n',{mode:0o600});
    await trace('all-backup-and-fresh-retirement-proofs-complete',summary);passed=true;
  } finally {
    await trace('owned-writer-cleanup-start');
    for(const child of workers)if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await ended;}
    for(const ownedHome of [source,target,savedDisk,thirdHome]) {
      const data=path.join(ownedHome,'hima/database/data');
      // These paths were uniquely created by this fixture, never a customer/source checkout Home.
      try {await stat(data);spawnSync(path.join(runtimeDirectory,'bin/pg_ctl'),['-D',data,'-m','fast','-w','stop'],{stdio:'ignore',timeout:10_000});await assert.rejects(stat(path.join(data,'postmaster.pid')),{code:'ENOENT'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      try {if(!identity)identity=JSON.parse(await readFile(path.join(ownedHome,'hima/database/credentials.json'),'utf8')).identity;}catch{}
    }
    await trace('owned-writers-stopped',{identity});
    if(!passed && process.env.HIMA_U9_KEEP_FAILED_FIXTURE==='1')await trace('failed-fixture-retained',{fixture});
    else {
      // Authority lives outside both Homes. Remove only this fixture's stopped, uniquely created record.
      if(identity)await rm(path.join(gate.localLineageDirectory(),identity),{recursive:true,force:true});
      await rm(fixture,{recursive:true,force:true});await trace('fixture-cleaned');
    }
  }
});

test('cold backup refuses a stopped PG while its original Host still lives, and partial archives stay unrecognized', {skip:!process.env.HIMA_DBOS_TEST_LIB||!process.env.HIMA_POSTGRES_RUNTIME}, async () => {
  const {pathToFileURL}=await import('node:url');
  const {readFile,symlink}=await import('node:fs/promises');
  const lib=process.env.HIMA_DBOS_TEST_LIB!;
  const backup=await import(pathToFileURL(path.join(lib,'run-backup.js')).href);
  const gate=await import(pathToFileURL(path.join(lib,'local-database.js')).href);
  const fixture=await mkdtemp(path.join(tmpdir(),'hima-u9-live-source-'));
  const home=path.join(fixture,'source'),destination=path.join(fixture,'archive');
  let identity:string|undefined;
  try {
    const database=await gate.startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME!});identity=database.identity;await database.stop();
    const authority=JSON.parse(await readFile(path.join(home,'hima/database/backup-authority.json'),'utf8'));
    assert.equal(authority.host.pid,process.pid);
    await assert.rejects(backup.createColdBackup({home,destination,runtimeDirectory:'/missing-runtime',distribution:{root:'/missing-distribution',manifestFile:'/missing-manifest',harnessRoot:'/missing-harness'}}),/source Host\/postmaster has not exited/);
    const alias=path.join(fixture,'home-alias');await symlink(home,alias,'dir');
    await assert.rejects(backup.createColdBackup({home,destination:path.join(alias,'unsafe-archive'),runtimeDirectory:'/missing-runtime',distribution:{root:'/missing-distribution',manifestFile:'/missing-manifest',harnessRoot:'/missing-harness'}}),/destination is inside the retained closure/);
    const partial=path.join(fixture,'archive.partial-retained');await mkdir(partial,{mode:0o700});await writeFile(path.join(partial,'unknown'),'interrupted data');
    await assert.rejects(backup.inspectColdBackup(partial),/partial archive/);assert.equal(await readFile(path.join(partial,'unknown'),'utf8'),'interrupted data');
  } finally {
    if(identity)await rm(path.join(gate.localLineageDirectory(),identity),{recursive:true,force:true});
    await rm(fixture,{recursive:true,force:true});
  }
});

test('qualified target consumes retirement under lineage claim before PG can open, and normal reopens retain admission', {skip:!process.env.HIMA_DBOS_TEST_LIB||!process.env.HIMA_POSTGRES_RUNTIME}, async () => {
  const {cp,readFile,realpath}=await import('node:fs/promises');const {createServer}=await import('node:net');const {pathToFileURL}=await import('node:url');
  const gate=await import(pathToFileURL(path.join(process.env.HIMA_DBOS_TEST_LIB!,'local-database.js')).href);
  const fixture=await realpath(await mkdtemp(path.join(tmpdir(),'hima-u9-activation-'))),source=path.join(fixture,'source'),target=path.join(fixture,'target');
  const runtimeDirectory=process.env.HIMA_POSTGRES_RUNTIME!;let identity:string|undefined;let database:any;const server=createServer();
  try {
    database=await gate.startLocalDatabase({home:source,runtimeDirectory});identity=database.identity;const port=database.application.port;await database.stop();database=undefined;
    await cp(source,target,{recursive:true,preserveTimestamps:true});
    // Lifecycle unit fixture of an already-qualified receipt. It does not create or qualify any
    // backup/distribution, and therefore supplies no archive completeness claim.
    const lineage=await gate.readDatabaseLineage(identity);const manifest='a'.repeat(64);
    await gate.writeDatabaseLineage({...lineage,currentHome:target,epoch:1,retiredHomes:[source],retiredManifest:manifest});
    await writeFile(path.join(target,'hima/restore-lineage.json'),JSON.stringify({identity,manifest,epoch:1,qualified:true}),{mode:0o600});
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    await assert.rejects(gate.startLocalDatabase({home:target,runtimeDirectory}),/occupied/);
    const consumed=await gate.readDatabaseLineage(identity);assert.equal(consumed.activated.home,target);assert.equal(consumed.activated.manifest,manifest);
    assert.equal(server.listening,true,'An unrelated listener is preserved while PG remains unopened');
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    database=await gate.startLocalDatabase({home:target,runtimeDirectory});assert.equal(database.identity,identity);await database.stop();database=undefined;
    database=await gate.startLocalDatabase({home:target,runtimeDirectory});assert.equal(database.identity,identity);await database.stop();database=undefined;
    assert.equal(JSON.parse(await readFile(path.join(target,'hima/restore-lineage.json'),'utf8')).manifest,manifest);
  } finally {
    if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));await database?.stop();
    if(identity)await rm(path.join(gate.localLineageDirectory(),identity),{recursive:true,force:true});await rm(fixture,{recursive:true,force:true});
  }
});

// This focused fixture uses actual private executable bytes, SDK and PG. Its compact inventory
// is a backup-module seam, not a native App distribution qualification.
test('terminal A history survives B backup and restore; pending A and unfinished A still require A', {timeout:180_000,skip:!process.env.HIMA_DBOS_TEST_LIB||!process.env.HIMA_POSTGRES_RUNTIME}, async () => {
  const {spawn,spawnSync}=await import('node:child_process');
  const {cp,readFile,readdir,realpath}=await import('node:fs/promises');
  const {createHash}=await import('node:crypto');
  const {pathToFileURL,fileURLToPath}=await import('node:url');
  const backup=await import(pathToFileURL(path.join(process.env.HIMA_DBOS_TEST_LIB!,'run-backup.js')).href);
  const gate=await import(pathToFileURL(path.join(process.env.HIMA_DBOS_TEST_LIB!,'local-database.js')).href);
  const fixture=await realpath(await mkdtemp(path.join(tmpdir(),'hima-u9-version-history-')));
  const runtimeDirectory=process.env.HIMA_POSTGRES_RUNTIME!,homes:string[]=[],identities=new Set<string>(),workers:any[]=[];
  const proofRoot=path.join(fixture,'executables'),harnessRoot=path.join(proofRoot,'B');
  const distribution={root:harnessRoot,manifestFile:path.join(proofRoot,'B-manifest.json'),harnessRoot};
  async function worker(home:string,mode:string,root:string) {
    const child=spawn(process.execPath,[fileURLToPath(new URL('./support/dbos-backup-worker.ts',import.meta.url)),home,mode,path.join(fixture,'workspace'),path.join(fixture,'counter'),root],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
    workers.push(child);let err='';child.stdout!.resume();child.stderr!.on('data',(chunk:any)=>err+=String(chunk));
    const ended=new Promise(resolve=>child.once('close',resolve));
    const value=await new Promise<any>((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',(code:any)=>reject(new Error(`version worker ${mode}: ${code}: ${err}`)));});
    child.send('close');assert.equal(await ended,0,err);return value;
  }
  try {
    // Build the two compact inventories from the actual installed test executable here, so a
    // fresh checkout needs only the normal compiled package and pinned PG runtime. The fixture
    // deliberately does not qualify a native App or a delivered Node/Electron distribution.
    const installedRoot=await realpath(path.dirname(process.env.HIMA_DBOS_TEST_LIB!));
    for(const version of ['A','B']) {
      const root=path.join(proofRoot,version);await mkdir(root,{recursive:true,mode:0o700});
      for(const item of ['lib','skills','rules','choosers','presets','package.json','semantics.yml','cordis.patch.yml'])await cp(path.join(installedRoot,item),path.join(root,item),{recursive:true});
      if(version==='B')await writeFile(path.join(root,'rules/u9-version-proof.txt'),'B executable fixture\n');
      const files:Record<string,string>={};
      async function inventory(relative=''):Promise<void> {
        for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
          const file=path.posix.join(relative,entry.name);
          if(entry.isDirectory())await inventory(file);
          else {assert.equal(entry.isFile(),true);files[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');}
        }
      }
      await inventory();
      await writeFile(path.join(proofRoot,`${version}-manifest.json`),JSON.stringify({format:2,status:'fixture',platform:`${process.platform}-${process.arch}`,runtimeInputs:{dbosVersion:'5.2.11',postgres:{version:gate.POSTGRES_VERSION},node:{version:process.version},electron:{fixture:'compact backup seam only'}},files}));
    }
    const home=path.join(fixture,'source'),target=path.join(fixture,'restored');homes.push(home,target);
    const a=await worker(home,'version-A',path.join(proofRoot,'A'));
    const b=await worker(home,'version-B',harnessRoot);assert.notEqual(a.version,b.version);
    const archived=await backup.retireSource({home,targetHome:target,destination:path.join(fixture,'final'),runtimeDirectory,distribution});identities.add(archived.manifest.identity);
    assert.equal(archived.manifest.applicationVersion,b.version);
    assert.deepEqual(archived.manifest.authority.application.runs.map((row:any)=>row.application_version).sort(),[a.version,b.version].sort());
    assert.deepEqual(archived.manifest.authority.system.workflow_status.map((row:any)=>[row.status,row.application_version]).sort(),[['SUCCESS',a.version],['SUCCESS',b.version]].sort());
    await rm(home,{recursive:true});await backup.restoreColdBackup({backup:archived.backup,newHome:target});
    assert.equal((await backup.qualifyHeldRestore({newHome:target,retiredBackup:archived.backup,harnessRoot})).state,'qualified');
    const database=await gate.startLocalDatabase({home:target,runtimeDirectory});
    const {createRequire}=await import('node:module');
    const {Pool}=createRequire(await realpath(path.join(process.env.HIMA_DBOS_TEST_LIB!,'../package.json')))('pg');
    const application=new Pool(database.application),system=new Pool(database.system);
    try {
      assert.equal(database.identity,archived.manifest.identity);
      assert.deepEqual((await application.query('SELECT application_version FROM hima.runs ORDER BY application_version')).rows.map((row:any)=>row.application_version),[a.version,b.version].sort());
      assert.deepEqual((await system.query('SELECT status,application_version FROM dbos.workflow_status ORDER BY application_version')).rows.map((row:any)=>[row.status,row.application_version]),[a.version,b.version].sort().map(version=>['SUCCESS',version]));
    } finally {await application.end();await system.end();await database.stop();}
    for(const mode of ['version-pending','version-unfinished']) {
      const pendingHome=path.join(fixture,mode);homes.push(pendingHome);await worker(pendingHome,mode,path.join(proofRoot,'A'));
      identities.add(JSON.parse(await readFile(path.join(pendingHome,'hima/database/credentials.json'),'utf8')).identity);
      await assert.rejects(backup.createColdBackup({home:pendingHome,destination:path.join(fixture,mode+'-archive'),runtimeDirectory,distribution}),/original executable applicationVersion differs/);
    }
  } finally {
    for(const child of workers)if(child.exitCode===null&&child.signalCode===null){const ended=new Promise(resolve=>child.once('close',resolve));child.kill('SIGKILL');await ended;}
    for(const home of homes) {
      spawnSync(path.join(runtimeDirectory,'bin/pg_ctl'),['-D',path.join(home,'hima/database/data'),'-m','fast','-w','stop'],{stdio:'ignore',timeout:10_000});
      try {identities.add(JSON.parse(await readFile(path.join(home,'hima/database/credentials.json'),'utf8')).identity);}catch{}
    }
    for(const identity of identities)await rm(path.join(gate.localLineageDirectory(),identity),{recursive:true,force:true});
    await rm(fixture,{recursive:true,force:true});
  }
});
