// @hima-seam agent wrapped
// Actual private-package Host, local PG and normal Pack facade; no product model requests.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access, realpath, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bootInProcess, createRootAgent } from './boot-inprocess.ts';
import { prepareHimaHome, himaHomeSources } from '../../../packages/desktop/src/hima-home.ts';
import { repoRoot } from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify,parse}=require('yaml');
const home=await realpath(process.argv[2]!);const mode=process.argv[3]??'normal';
const packageDir=process.env.HIMA_U7_LIFECYCLE_PACKAGE??path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {loadPack,checkPack}=await load('packs');const {loadSite}=await load('sites');
const {newCampaignProposalId,startRun,readExecutionContext,executionAction,controlDurableRun,recoverDurablePreparations}=await load('fabric');
const workspace=path.join(home,'workspace'),sitesDir=path.join(home,'hima/sites'),packsDir=path.join(home,'hima/packs'),packDir=path.join(packsDir,'facade-fixture');
const fresh=!(await exists(path.join(home,'accepted.json')));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
if(fresh){
  for(const dir of [workspace,sitesDir,path.join(packDir,'flow')])await mkdir(dir,{recursive:true});
  const script=`import json,pathlib,sys\ni,o,w=sys.argv[1:4]\nx=json.loads(pathlib.Path(i).read_text())\np=pathlib.Path(w)\np.joinpath('program-calls').open('a').write('original\\n')\nimport time;time.sleep(2)\np.joinpath('delivery.txt').write_text('verified task delivery')\nv={'strict':x['strict'],'period':x['period']}\nif x['target']!=0.5:v['goalMet']=x['period']<=x['target']\npathlib.Path(o).write_text(json.dumps({'schemaVersion':'1','value':v,'artifacts':[{'name':'delivery','path':'delivery.txt','mediaType':'text/plain'}],'diagnostics':[]}))\n`;
  await writeFile(path.join(packDir,'flow/produce.py'),script);
  await writeFile(path.join(packDir,'contract.yml'),stringify({id:'facade-fixture',version:'1',title:'Frozen normal facade method',inputs:[{name:'workspaceRoot'}],outputs:[],words:{periodNs:{label:'Period',unit:'ns'}},goal:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:1}},strategy:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:2}},tools:[{id:'produce',file:'flow/produce.py',inputs:['FLOW','TASK_INPUT','TASK_OUTPUT','WORKSPACE'],argv:['/usr/bin/python3','${FLOW}/produce.py','${TASK_INPUT}','${TASK_OUTPUT}','${WORKSPACE}']}],environment:{wrappers:['/usr/bin/python3']},workspace:{source:'pack',copy:['produce.py']}}));
  const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties:{strict:{type:'boolean'},period:{type:'number'},target:{type:'number'}},required:['strict','period','target']}};
  const output={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties:{strict:{type:'boolean'},period:{type:'number'},goalMet:{type:'boolean'}},required:['strict','period']}};
  await writeFile(path.join(packDir,'graph.yml'),stringify({schema:'hima-flow/1',id:'facade-fixture',version:'1',flow:{kind:'sequence',id:'sequence',steps:['produce','successor'].map(id=>({kind:'task',id,tool:'produce',contract:{input:schema,output},inputs:{strict:{source:'literal',value:false},period:{source:'strategy',path:['periodNs']},target:{source:'goal',path:['periodNs']}}}))}}));
  await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,packDir],allowedWriteRoots:[workspace],allowedWrappers:['/usr/bin/python3','sh'],forbidden:['services','licences','network','deletions','downloads']}));
  await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{}}}));
}

const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const prepared=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:prepared.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any;
const until=async(predicate:()=>Promise<boolean>)=>{const deadline=Date.now()+20000;while(!await predicate()){if(Date.now()>deadline)throw new Error('Lifecycle boundary wait timed out');await new Promise(resolve=>setTimeout(resolve,30));}};
try {
 host=await bootInProcess(h);const service=host.ctx.hima;await service.reconciled;const store=service.durable.store;
 if(mode==='race'||mode==='race-microseconds'||mode==='stop-authority') {
  const opening={runId:'callback-race',inputSha256:'b'.repeat(64),applicationVersion:service.durable.applicationVersion,owner:'race-owner',deadlineAt:new Date(Date.now()+60000).toISOString(),data:{}};
  await store.createRun(opening);
  const {compileFlow}=await load('flow-compiler');const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
  const frozen=compileFlow({schema:'hima-flow/1',id:'callback-fixture',version:'1',flow:{kind:'task',id:'race',tool:'callback',inputs:{},contract:{input:schema,output:schema}}},{packSha256:'c'.repeat(64)});
  const identity={runId:opening.runId,taskId:'race',effectId:'race-effect',inputSha256:opening.inputSha256,packSha256:'c'.repeat(64),irSha256:frozen.irSha256,applicationVersion:opening.applicationVersion,adapterVersion:'1'};
  await store.prepareEffect(identity,{kind:'test-callback'});
  await store.recordFlowInvocation({identity,version:0,branches:[],context:{flow:frozen,taskId:'race',iterations:[],branches:[],extensions:[]},consumedEffects:[],consumedVersions:[]});
  await store.reserveEffectResources(identity,{siteId:'@callback-fixture',jobs:0,licences:{}},{jobs:0,licences:{}});
  const admission={runId:opening.runId,effectId:identity.effectId,owner:opening.owner,epoch:0,revision:0};
  if(mode==='stop-authority') {
    await store.claimEffectDispatch(admission,async()=>true,'submit',identity.inputSha256);
    await store.acceptHostExit({requestId:'stop-authority-original',mode:'stop-jobs'});
    let entered!:()=>void,release!:()=>void;const inside=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
    const stop=store.claimEffectCleanup(identity,async()=>{entered();await gate;return true;},'stop:first',identity.inputSha256,'stop-authority-original');
    await inside;
    let replaced=false;const replacement=store.acceptHostExit({requestId:'stop-authority-keep',mode:'keep-jobs',expectedRequestId:'stop-authority-original'}).then(()=>{replaced=true;});
    await new Promise(resolve=>setTimeout(resolve,80));
    const crossedAdmission=replaced;release();assert.equal(await stop,true);await replacement;
    assert.equal(crossedAdmission,false,'replacement waits for original stop admission holding the Host lifecycle lock');
    assert.equal(await store.claimEffectCleanup(identity,async()=>true,'stop:first',identity.inputSha256,'stop-authority-original'),false,'already-dispatched original stop receipt is preserved after replacement');
    await assert.rejects(store.claimEffectCleanup(identity,async()=>true,'stop:second',identity.inputSha256,'stop-authority-original'),/exit.*(stale|active)|stop.*request/i);
    let cancelled=false;assert.equal(await store.withHostExitStopBoundary('stop-authority-original',()=>{cancelled=true;}),false);assert.equal(cancelled,false);
    await store.releaseHostExit('stop-authority-keep');
    await store.acceptHostExit({requestId:'stop-authority-cancel',mode:'stop-jobs'});await store.releaseHostExit('stop-authority-cancel');
    await assert.rejects(store.claimEffectCleanup(identity,async()=>true,'stop:after-cancel',identity.inputSha256,'stop-authority-cancel'),/exit.*(stale|active)|stop.*request/i);
    assert.equal(await store.claimEffectCleanup(identity,async()=>true,'stop:deadline',identity.inputSha256),true,'ordinary deadline cleanup remains independent of App exit authority');
    process.send?.({ok:true,mode});
  } else {
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const dispatch=store.claimEffectDispatch(admission,async()=>{enter();await gate;return true;},'submit',identity.inputSha256);
  await entered;let accepted=false;
  const exit=store.acceptHostExit({requestId:'callback-race-exit',mode:'drain'}).then(()=>{accepted=true;});
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(accepted,false,'accepted exit waits for the actual admission callback transaction');
  release();assert.equal(await dispatch,true);await exit;
  if(mode==='race-microseconds') {
    // A real pre-fence submit and accepted exit can occupy the same millisecond.
    // pg converts timestamptz to JS Date unless the query retains its SQL text.
    const {Pool}=require('pg');
    const credentials=JSON.parse(await readFile(path.join(home,'hima/database/credentials.json'),'utf8'));
    const pool=new Pool({host:'127.0.0.1',port:credentials.port,user:credentials.user,password:credentials.password,database:'hima_application'});
    try {
      await pool.query("UPDATE hima.effect_dispatches SET started_at='2026-10-10 12:00:00.000600+00' WHERE effect_id=$1 AND dispatch_id='submit'",[identity.effectId]);
      await pool.query("UPDATE hima.host_exit_requests SET accepted_at='2026-10-10 12:00:00.000800+00' WHERE request_id='callback-race-exit'");
    } finally {await pool.end();}
  }
  await assert.rejects(store.claimEffectDispatch(admission,async()=>true,'next-message',identity.inputSha256),/closing/);
  await assert.rejects(store.assertEffectAdmission(admission,async()=>true),/closing/);
  await assert.rejects(store.externalEffectTransaction(identity,{admission,permit:async()=>true},async()=>true),/closing/);
  await store.releaseEffectResources(identity,{closed:true,callbackReturned:true});
  assert.equal((await service.exitStatus()).ready,false,'producer process closure alone cannot hide its pending Reader collection');
  const collector={...identity,taskId:'collect',effectId:'race-collector'};
  await store.bindDerivedEffect(identity,collector,{purpose:'collect'});await store.prepareEffect(collector,{kind:'collection-callback'});
  const current=await store.run(opening.runId);await store.command({runId:opening.runId,commandId:'reader-human-hold',action:'pause',owner:current.owner,epoch:current.epoch,revision:current.revision,origin:'human'});
  const held=await store.run(opening.runId),collectAdmission={...admission,effectId:collector.effectId,epoch:held.epoch,revision:held.revision};
  let reading!:()=>void,endRead!:()=>void;const readEntered=new Promise<void>(resolve=>reading=resolve),readGate=new Promise<void>(resolve=>endRead=resolve);
  const read=store.readHostExitBoundary(async()=>{reading();await readGate;return true;});await readEntered;
  let collected=false;const collection=store.claimEffectDispatch(collectAdmission,async()=>true,'submit',collector.inputSha256).then((value:boolean)=>{collected=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,80));assert.equal(collected,false,'readiness boundary serializes even the permitted original Reader callback');
  endRead();await read;assert.equal(await collection,true,'drain admits only necessary collection of the original pre-fence submit, preserving human hold');
  assert.equal((await store.run(opening.runId)).holdSource,'human');
  await store.reserveEffectResources(collector,{siteId:'@callback-fixture',jobs:0,licences:{}},{jobs:0,licences:{}});await store.releaseEffectResources(collector,{closed:true,callbackReturned:true});
  const output={schema:'hima-task-result/1',identity,outputSchemaVersion:'1',value:{callbackReturned:true},artifacts:[],diagnostics:[]};await store.recordEffectFact(identity,'validated-result',output);await store.commitResult(output);
  const late={...collector,effectId:'race-late-collector'};await store.bindDerivedEffect(identity,late,{purpose:'collect'});await store.prepareEffect(late,{kind:'collection-callback'});
  await assert.rejects(store.claimEffectDispatch({...collectAdmission,effectId:late.effectId},async()=>true,'submit',late.inputSha256),/closing/,'a completed parent cannot admit a new Reader after exit readiness');
  await store.releaseHostExit('callback-race-exit');
  }
 }
 if(mode==='race-microseconds') {process.send?.({ok:true,mode});}
 else if(mode!=='stop-authority') {
 const owner=await createRootAgent(host.ctx,workspace),actor=String(owner.id);
 const pack=loadPack(packsDir,'facade-fixture'),site=loadSite(sitesDir,'local');
 if(mode==='prepare'||mode==='prepare-intent') {
  const customer=path.join(workspace,'customer-owned.bin'),bytes=Buffer.from([0,255,1,2,3]);await writeFile(customer,bytes);
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>enter=resolve),gate=new Promise<void>(resolve=>release=resolve);
  const actual=store.assertEffectAdmission.bind(store);let intercepted=false;
  store.assertEffectAdmission=async(admission:any,permit:any)=>{if(admission.effectId.startsWith('hima-prepare-effect:')&&!intercepted){intercepted=true;enter();await gate;}return actual(admission,permit);};
  if(mode==='prepare-intent'){store.assertEffectAdmission=actual;const record=store.recordExternalEffectFact.bind(store);store.recordExternalEffectFact=async(identity:any,phase:string,fact:any)=>{await record(identity,phase,fact);if(phase==='preparation-write-intent'&&!intercepted){intercepted=true;enter();await gate;}};}
  const opened=await service.startRun({pack:pack.id,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:actor,proposalId:newCampaignProposalId(pack,site)});
  assert.ok(opened.kind==='preparing'||opened.kind==='ran');const runId=opened.run.id;
  await entered;const deadline=(await store.run(runId)).deadlineAt;
  const exit=await service.prepareExit({requestId:'preparation-exit',mode:'drain'});assert.equal(exit.ready,mode==='prepare','unadmitted write can exit; retained write intent without completion must remain unknown');
  if(mode==='prepare-intent')assert.equal(exit.runs.find((row:any)=>row.runId===runId).state,'uncertain');
  release();await new Promise(resolve=>setTimeout(resolve,200));
  if(mode==='prepare-intent')await until(async()=> (await service.exitStatus()).ready);
  await host.dispose();host=await bootInProcess(h);await host.ctx.hima.reconciled;
  const reopened=host.ctx.hima.durable.store;assert.equal((await reopened.run(runId)).deadlineAt,deadline);assert.equal(await reopened.hostExit(),undefined);
  try {await until(async()=> (await reopened.flowProjection(runId)).tasks.some((task:any)=>task.identity.taskId==='produce'&&task.result));}
  catch(error){throw new Error('Original preparation did not resume: '+JSON.stringify(await reopened.flowFact(runId,'preparation')),{cause:error});}
  assert.deepEqual(await readFile(customer),bytes);assert.equal((await reopened.flowPhysicalFacts(runId)).effects.filter((effect:any)=>effect.identity.taskId==='hima.prepare').length,1);
  process.send?.({ok:true,mode,runId,deadline,preparation:await reopened.flowFact(runId,'preparation')});
 } else {
 const opened=await service.startRun({pack:pack.id,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:actor,proposalId:newCampaignProposalId(pack,site)});
 assert.ok(opened.kind==='ran'||opened.kind==='preparing',JSON.stringify(opened));const runId=opened.run.id;
 await until(async()=> (await store.flowPhysicalFacts(runId)).effects.some((effect:any)=>effect.identity.taskId==='produce'&&effect.dispatches.some((dispatch:any)=>dispatch.dispatchId==='submit')));
 const run=await store.run(runId),facts=await store.flowPhysicalFacts(runId),original=facts.effects.find((effect:any)=>effect.identity.taskId==='produce'&&effect.dispatches.some((dispatch:any)=>dispatch.dispatchId==='submit'));
 await store.command({runId,commandId:'lifecycle-human-pause',action:'pause',owner:actor,epoch:run.epoch,revision:run.revision,origin:'human'});
 const request={requestId:'actual-exit',mode:mode==='keep'?'keep-jobs':mode.startsWith('stop')?'stop-jobs':'drain'};
 if(mode==='stop-failure')await rename(path.join(sitesDir,'local.yml'),path.join(sitesDir,'local.held'));
 const status=await service.prepareExit(request);assert.equal(status.runs.some((row:any)=>row.runId===runId),true);assert.equal(status.ready,mode==='keep');
 if(!status.ready&&mode==='drain')await assert.rejects(service.finishExit(request.requestId),/not reached/,'a running original process must not trigger resource finalization');
 await assert.rejects(service.prepareExit({...request,mode:request.mode==='drain'?'keep-jobs':'drain'}),/identity/);
 await assert.rejects(service.cancelExit('wrong-request'),/stale/);
 await assert.rejects(store.createRun({...run.opening,runId:'forbidden-successor'}),/closing/);
 if(mode==='stop-failure') {
  await until(async()=>!(await store.hostExit()));
  const failed=await service.exitStatus();assert.equal(failed.ready,false);assert.equal(failed.runs.find((row:any)=>row.runId===runId).state,'uncertain');
  assert.equal((await store.run(runId)).holdSource,'human');await rename(path.join(sitesDir,'local.held'),path.join(sitesDir,'local.yml'));
 } else if(mode==='stop') {
  await until(async()=> (await service.exitStatus()).ready);
  assert.ok((await store.flowPhysicalFacts(runId)).resources.filter((resource:any)=>resource.effectId===original.identity.effectId).every((resource:any)=>resource.released));
 } else if(mode==='drain'||mode==='race') {
  await until(async()=> (await service.exitStatus()).ready);
  await until(async()=> (await store.flowProjection(runId)).tasks.some((task:any)=>task.identity.taskId==='produce'&&task.result));
  assert.equal((await store.flowProjection(runId)).tasks.filter((task:any)=>task.result).length,1);
  assert.equal((await store.flowPhysicalFacts(runId)).effects.filter((effect:any)=>['produce','successor'].includes(effect.identity.taskId)&&effect.dispatches.some((dispatch:any)=>dispatch.dispatchId==='submit')).length,1);
 }
 const before=await store.flowPhysicalFacts(runId);const deadline=(await store.run(runId)).deadlineAt;
 await host.dispose();host=await bootInProcess(h);await host.ctx.hima.reconciled;
 const reopened=host.ctx.hima.durable.store;assert.equal(await reopened.hostExit(),undefined);
 assert.equal((await reopened.run(runId)).holdSource,'human');assert.equal((await reopened.run(runId)).cancelled,false);assert.equal((await reopened.run(runId)).deadlineAt,deadline);
 const after=await reopened.flowPhysicalFacts(runId);assert.ok(after.effects.some((effect:any)=>effect.identity.effectId===original.identity.effectId));
 if(mode==='keep')assert.equal(after.resources.filter((resource:any)=>!resource.released).length,before.resources.filter((resource:any)=>!resource.released).length);
 process.send?.({ok:true,mode,runId,originalEffect:original.identity.effectId,deadline,before,after});
 }
 }
} catch(error) {process.send?.({ok:false,error:String(error),stack:(error as Error).stack});process.exitCode=1;}
finally {await host?.dispose();}
async function exists(file:string){try{await access(file);return true;}catch{return false;}}
