import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { appendFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [home,mode,workspaceInput,counter,harnessRootInput]=process.argv.slice(2) as [string,string,string,string,string];
await mkdir(workspaceInput,{recursive:true,mode:0o700});
const workspace=await realpath(workspaceInput);
const harnessRoot=await realpath(harnessRootInput);
const dependencyRoot=mode.startsWith('version-')&&process.env.HIMA_DBOS_TEST_LIB
  ? await realpath(path.dirname(process.env.HIMA_DBOS_TEST_LIB)) : harnessRoot;
const require=createRequire(path.join(dependencyRoot,'package.json'));
const {DBOS}=await import(pathToFileURL(require.resolve('@dbos-inc/dbos-sdk')).href);
const load=async(name:string)=>import(pathToFileURL(path.join(dependencyRoot,'lib',`${name}.js`)).href);
const {startLocalDatabase,resolveRetainedMaterialsDirectory}=await load('local-database');
const {readDurableSourceBytes}=await load('durable-views');
const {startDurableRuntime,installedExecutableManifest}=await load('durable-runtime');
const {prepareRetainedJob,launchRetainedJob,retainedJobState,retainedJobResourcesClosed}=await load('jobs');
const {loadSite}=await load('sites');
const {jsonDigest}=await load('run-store');
const {compileFlow}=await load('flow-compiler');
// Version-history backup seam: real SDK workflow states and application terminal facts.
if(mode.startsWith('version-')) {
  await mkdir(path.join(home,'hima/run-assets/dbos'),{recursive:true,mode:0o700});
  const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
  let runtime:any;
  try {
    runtime=await startDurableRuntime({database,manifest:await installedExecutableManifest(harnessRoot),workflows:[{name:'u9-version-history',async execute(runtime:any,input:any){
      if(input.pending)await DBOS.sleep(86_400_000);
      await runtime.store.putFlowFact(input.runId,'outcome:0',{state:'succeeded',outputs:{}});
      return {finished:true};
    }}]});
    const runId=mode==='version-B'?'version-B':'version-A',input={runId,pending:mode==='version-pending'};
    await runtime.store.createRun({runId,inputSha256:jsonDigest(input),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:input});
    let status;
    if(mode!=='version-unfinished') {
      const workflow=await runtime.startWorkflow('u9-version-history',`workflow-${runId}`,input);
      if(input.pending) { do {status=await workflow.getStatus();await new Promise(resolve=>setTimeout(resolve,20));}while(!['PENDING','ENQUEUED','DELAYED'].includes(status?.status)); }
      else {await workflow.getResult();status=await workflow.getStatus();assert.equal(status.status,'SUCCESS');}
    }
    process.send!({stage:mode,version:runtime.applicationVersion,status});
    await new Promise<void>(resolve=>process.once('message',()=>resolve()));
  } finally {await runtime?.stop();await database.stop();}
  process.disconnect();
  process.exit(0); // A stopped pending SDK timer must not keep this disposable proof Host alive.
} else {
const sitesDir=path.join(home,'hima/sites');
await mkdir(sitesDir,{recursive:true,mode:0o700});await mkdir(workspace,{recursive:true,mode:0o700});
await mkdir(path.join(home,'hima/run-assets/dbos'),{recursive:true,mode:0o700});
await writeFile(path.join(sitesDir,'local.permit.yml'),JSON.stringify({allowedReadRoots:[workspace],allowedWriteRoots:[workspace],allowedWrappers:['sh'],forbidden:[]}));
await writeFile(path.join(sitesDir,'local.yml'),JSON.stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{}}}));
const site=loadSite(sitesDir,'local');
const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
const runtime=await startDurableRuntime({database,manifest:await installedExecutableManifest(harnessRoot),workflows:[{name:'u9-cold-choice',async execute(runtime:any,input:any){
  async function job(letter:string) {
    const identity={runId:'run-u9',taskId:`job-${letter}`,effectId:`effect-${letter}`,inputSha256:jsonDigest(input),packSha256:'c'.repeat(64),irSha256:'d'.repeat(64),applicationVersion:runtime.applicationVersion,adapterVersion:'u9-fixture/1'};
    const argv=['sh','-c',`printf '${letter}\\n' >> '${counter}'; printf '${letter} retained\\n' > result-${letter}.txt`];
    const prepared=await DBOS.runStep(async()=>prepareRetainedJob('run-u9',workspace,argv,`job-${letter}`,`hima-u9-${letter}-${path.basename(workspace).replace(/[^A-Za-z0-9_-]/g,'')}`,new Date().toISOString()),{name:`freeze-job-${letter}`});
    await runtime.store.prepareEffect(identity,{preparedJob:prepared,argv});
    const receipt=await DBOS.runStep(async()=>{
      const held=await launchRetainedJob(site,'run-u9',argv,prepared,async()=>{});
      let state=await retainedJobState(site,held);
      while(state.state==='running'||!await retainedJobResourcesClosed(site,held)){await new Promise(resolve=>setTimeout(resolve,20));state=await retainedJobState(site,held);}
      assert.equal(state.state,'finished');assert.equal(state.exitCode,0);
      const bytes=await readFile(path.join(workspace,`result-${letter}.txt`));
      return {job:held,sha256:jsonDigest(bytes.toString())};
    },{name:`original-job-${letter}`,retriesAllowed:false});
    await runtime.store.recordExternalEffectFact(identity,'submitted',receipt.job);
    await runtime.store.recordExternalEffectFact(identity,'release-closed',{job:receipt.job,closed:true});
    await runtime.commitResult({schema:'hima-task-result/1',identity,outputSchemaVersion:'1',value:{letter},artifacts:[],diagnostics:[]});
    return receipt;
  }
  await job('A');
  const sources=await DBOS.runStep(async()=>{
    const root=await resolveRetainedMaterialsDirectory({home}),dir=path.join(root,'run-u9');await mkdir(dir,{recursive:true,mode:0o700});const sources=[];
    for(const type of ['observation','code','knowledge']) {
      const bytes=Buffer.from(`original ${type} bytes`),sha=createHash('sha256').update(bytes).digest('hex'),retainedPath=path.join(dir,sha);
      await writeFile(retainedPath,bytes,{mode:0o600});
      sources.push({type,runId:'run-u9',bytes:bytes.length,retainedPath,...(type==='observation'?{contentSha256:sha}:{sha256:sha})});
    }
    return sources;
  },{name:'retain-original-native-material',retriesAllowed:false});
  for(const source of sources)await runtime.store.ensureFlowFact('run-u9',`source-${source.type}`,async()=>source);
  await DBOS.setEvent('choice',{decisionId:'decision-D',stage:'after-A'});
  assert.equal(await DBOS.recv('decision'),'D');
  await runtime.store.ensureFlowFact('run-u9','decision-D',async()=>({decisionId:'decision-D',value:'D'}));
  await job('B');await DBOS.setEvent('done',{stage:'after-B'});return {finished:true};
}},{name:'u9-later-original-task',async execute(runtime:any,input:any){
  const record=await DBOS.runStep(async()=>{
    await appendFile(counter,'C\n');
    const root=await resolveRetainedMaterialsDirectory({home}),bytes=Buffer.from('later native task bytes'),sha=createHash('sha256').update(bytes).digest('hex');
    await mkdir(path.join(root,input.runId),{recursive:true,mode:0o700});const retainedPath=path.join(root,input.runId,sha);await writeFile(retainedPath,bytes,{mode:0o600});
    const record={type:'code',runId:input.runId,bytes:bytes.length,retainedPath,sha256:sha};
    assert.equal((await readDurableSourceBytes(root,input.runId,record)).toString(),'later native task bytes');return record;
  },{name:'later-original-task-effect',retriesAllowed:false});
  await runtime.store.ensureFlowFact(input.runId,'later-source',async()=>record);return record;
}}]});
const input={workspace,version:'u9-cold-fixture/1'};
if(mode==='A') {
  await runtime.store.createRun({runId:'run-u9',inputSha256:jsonDigest(input),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:input});
  await runtime.store.createRun({runId:'human-held',inputSha256:jsonDigest({held:true}),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:{held:true}});
  const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
  const task=(id:string)=>({kind:'task',id,tool:'local-job',inputs:{},contract:{input:schema,output:schema}});
  const flow=compileFlow({schema:'hima-flow/1',id:'branch-hold-fixture',version:'1',flow:{kind:'parallel',id:'original-parallel',branches:{held:{flow:task('original-held-task'),required:true},other:{flow:task('other-task'),required:true}},results:{}}},{packSha256:'c'.repeat(64)});
  await runtime.store.ensureFlowFact('human-held','definition',async()=>({flow}));
  await runtime.store.command({runId:'human-held',commandId:'human-branch-pause',action:'pause',origin:'human',owner:'owner',epoch:0,revision:0,scope:{taskId:'original-held-task'}});
  await runtime.store.command({runId:'human-held',commandId:'human-pause',action:'pause',origin:'human',owner:'owner',epoch:(await runtime.store.run('human-held')).epoch,revision:0});
  assert.equal((await runtime.store.run('human-held')).holdSource,'human');assert.equal((await runtime.store.branchControls('human-held'))[0].holdSource,'human');
  const started=await runtime.startWorkflow('u9-cold-choice','workflow-u9-original',input);
  await Promise.race([DBOS.getEvent('workflow-u9-original','choice'),started.getResult().then(()=>{throw new Error('original choice was skipped');})]);process.send!({stage:'after-A',version:runtime.applicationVersion});
} else if(mode==='B') {
  await DBOS.send('workflow-u9-original','D','decision','decision-D');
  assert.deepEqual(await DBOS.retrieveWorkflow('workflow-u9-original').getResult(),{finished:true});process.send!({stage:'after-B',version:runtime.applicationVersion});
} else if(mode==='control-only') {
  const before=await runtime.store.run('human-held');
  const after=await runtime.store.command({runId:'human-held',commandId:'later-database-only-control',action:'pause',origin:'human',owner:'owner',epoch:before.epoch,revision:before.revision});
  process.send!({stage:'database-only-control',beforeEpoch:before.epoch,afterEpoch:after.epoch,commandId:'later-database-only-control'});
} else {
  const status=await DBOS.getWorkflowStatus('workflow-u9-original');
  assert.equal(status.status,'SUCCESS');assert.equal(status.applicationVersion,runtime.applicationVersion);
  assert.deepEqual((await runtime.store.result('effect-A')).value,{letter:'A'});assert.deepEqual((await runtime.store.result('effect-B')).value,{letter:'B'});
  assert.ok((await runtime.store.run('human-held')).hold);
  assert.equal((await runtime.store.run('human-held')).holdSource,'human');const branchControls=await runtime.store.branchControls('human-held');assert.equal(branchControls[0].holdSource,'human');
  assert.equal(await readFile(counter,'utf8'),mode==='recover-again'?'A\nB\nC\n':'A\nB\n');
  const root=await resolveRetainedMaterialsDirectory({home});
  for(const type of ['observation','code','knowledge']) {
    const record=await runtime.store.flowFact('run-u9',`source-${type}`);
    assert.equal((await readDurableSourceBytes(root,'run-u9',record)).toString(),`original ${type} bytes`);
    await assert.rejects(readDurableSourceBytes(path.dirname(root),'run-u9',record),/trusted Run/);
    await assert.rejects(readDurableSourceBytes(root,'run-u9',{...record,...(type==='observation'?{contentSha256:'f'.repeat(64)}:{sha256:'f'.repeat(64)})}),/identity/);
  }
  const laterInput={runId:'run-u9-later'};
  await runtime.store.createRun({runId:laterInput.runId,inputSha256:jsonDigest(laterInput),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:laterInput});
  const later=await runtime.startWorkflow('u9-later-original-task','workflow-u9-later-original',laterInput);await later.getResult();
  assert.equal(await readFile(counter,'utf8'),'A\nB\nC\n');
  const reread=await runtime.startWorkflow('u9-later-original-task','workflow-u9-later-original',laterInput);await reread.getResult();assert.equal(await readFile(counter,'utf8'),'A\nB\nC\n');
  process.send!({stage:'recovered-original',status,held:await runtime.store.run('human-held'),branchControls,later:await later.getStatus()});
}
await new Promise<void>(resolve=>process.once('message',()=>resolve()));
await runtime.stop();await database.stop();process.disconnect();

}
