// Private real DBOS/PG/Job process fixture. No product model, SSH, EDA or GUI is invoked.
import assert from 'node:assert/strict';
import { appendFile, chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const require=createRequire(path.join(root,'packages/harness/package.json'));
const {stringify}=require('yaml');
const {DBOS}=await import(pathToFileURL(require.resolve('@dbos-inc/dbos-sdk')).href);
const lib=process.env.HIMA_DBOS_TEST_LIB??path.join(root,'packages/harness/lib');
const moduleAt=(file:string)=>import(pathToFileURL(path.join(lib,file+'.js')).href);
const {startLocalDatabase}=await moduleAt('local-database');
const {startDurableRuntime}=await moduleAt('durable-runtime');
const {jsonDigest}=await moduleAt('run-store');
const {loadPack,toolArgv}=await moduleAt('packs');
const {loadSite}=await moduleAt('sites');
const {executeTaskEffect,sendTaskEffectMessage,declaredCommandTaskAdapter,commandTaskAdapter,residentEngineeringTaskAdapter,taskEffectAdapterVersion,collectTaskProducerOutput}=await moduleAt('task-effects');
const {stopRetainedJob}=await moduleAt('jobs');
const [homeArgument,requestedMode]=process.argv.slice(2);if(!homeArgument||!requestedMode)throw new Error('Private task effect Home and mode required');
const mode=requestedMode;
const home=await realpath(homeArgument);
process.env.HIMA_RESIDENT_TESTING='1';
const workspace=path.join(home,'work'),sitesDir=path.join(home,'sites'),packDir=path.join(home,'packs','effect-fixture');
await mkdir(workspace,{recursive:true});await mkdir(sitesDir,{recursive:true});await mkdir(path.join(packDir,'tools'),{recursive:true});await mkdir(path.join(packDir,'knowledge'),{recursive:true});
const wrapper=path.join(root,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
let native=path.join(root,'sites/linglong-atcs28/tests/fixtures/acp-standin.py');
if(mode.startsWith('resident-failure')) {
 const retained=await readFile(native,'utf8');
 const failure=`def complete_prompt(request_id, text):\n    if "FAIL_PROMPT" in text:\n        send({"jsonrpc":"2.0", "id":request_id, "error":{"code":-32000,"message":"deterministic failed native prompt"}})\n        return\n`;
 native=path.join(workspace,'acp-failure-fixture.py');
 await writeFile(native,retained.replace('def complete_prompt(request_id, text):\n',failure));await chmod(native,0o755);
}
const capabilityPath=path.join(workspace,'engineering-capability.json');
await writeFile(capabilityPath,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capabilityPath]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},environment:{inherit:[],set:{},toolPaths:[],credentialReadPaths:[]},delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
const permit={allowedReadRoots:[workspace,packDir,path.dirname(wrapper),path.dirname(native)],allowedWriteRoots:[workspace],allowedWrappers:['/bin/sh','/usr/bin/python3',wrapper],forbidden:['services','licences','network','deletions','downloads']};
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify(permit));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{engineeringCapabilities:capabilityPath},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{fixture:1}}}));
const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
const contract={input:schema,output:schema};
const script=path.join(packDir,'tools','produce.py');
await writeFile(script,`import json,pathlib,sys,time\nsource,out,marker=sys.argv[1:4]\nvalue=json.loads(pathlib.Path(source).read_text())\nwith pathlib.Path(marker).open('a') as f:f.write('once\\n')\nstarted=time.time_ns()\ntime.sleep(value.get('sleep',0))\npathlib.Path(out).write_text(json.dumps({'schemaVersion':'1','value':{'answer':42},'artifacts':[{'name':'source','path':'input-report.txt'}],'diagnostics':[]}))\npathlib.Path(marker+'.events').write_text(json.dumps([started,time.time_ns()]))\n`);
await writeFile(path.join(workspace,'input-report.txt'),'immutable real producer evidence\n');
await writeFile(path.join(packDir,'knowledge','method.md'),'# Retained native method\n');
const tools=[{id:'produce',file:'tools/produce.py',inputs:['TASK_INPUT','TASK_OUTPUT','MARKER'],argv:['/usr/bin/python3',script,'${TASK_INPUT}','${TASK_OUTPUT}','${MARKER}'],licences:{fixture:1}},
 {id:'engineering',file:'tools/produce.py',inputs:[],argv:['/usr/bin/python3',script],licences:{fixture:1},outsourcing:{role:'resident-engineering-agent',reads:['inputReport'],knowledge:['method.md'],produces:'result',artifactPrefix:'engineering'}}];
await writeFile(path.join(packDir,'contract.yml'),stringify({id:'effect-fixture',version:'1',title:'Effect fixture',inputs:[{name:'workspaceRoot'}],outputs:[{name:'inputReport',path:'input-report.txt',reader:'fixture',description:'Retained input'},{name:'result',path:'result.json',reader:'fixture',description:'Reader checked result'}],tools,environment:{wrappers:['/usr/bin/python3']},workspace:{copy:[]},knowledge:[{file:'method.md',purpose:'Retained native playbook'}]}));
await writeFile(path.join(packDir,'graph.yml'),stringify({schema:'hima-flow/1',id:'effect-fixture',version:'1',flow:{kind:'task',id:'produce',tool:'produce',inputs:{},contract}}));
const pack=loadPack(path.join(home,'packs'),'effect-fixture'),site=loadSite(sitesDir,'local');
const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
const manifest={files:{'u4-fixture':'4'.repeat(64)},adapters:{'task-effects':taskEffectAdapterVersion}};
let runtime:any;
const requestFor=(run:any,input:any,task='produce')=>({identity:{runId:run.runId,taskId:task,effectId:`effect-${run.runId}`,inputSha256:jsonDigest(input),packSha256:pack.flow.packSha256,irSha256:pack.flow.irSha256,applicationVersion:run.applicationVersion,adapterVersion:taskEffectAdapterVersion},admission:{runId:run.runId,effectId:`effect-${run.runId}`,owner:run.owner,epoch:run.epoch,revision:run.revision},input,contract});
const commandAdapter=async(request:any,flags:any={})=>{
 const base=await declaredCommandTaskAdapter({request,tool:pack.contract.tools[0],sitesDir,siteId:'local',workspace,platform:{MARKER:path.join(workspace,`calls-${request.identity.runId}`)},kind:flags.program?'program':'command'});
 return {...base,
  // This fixture withholds all early physical-closure proof, so verified output must remain
  // retained behind the final release boundary and cannot free a competing licence.
  settledResources:flags.releaseUnknown?undefined:base.settledResources,
  async submit(prepared:any,before:any){if(flags.unknown){await before();throw new Error('Fixture launch outcome has no reliable evidence');}const result=await base.submit(prepared,async()=>{await before();const held=await store.effectResources();assert.ok(held.filter((lease:any)=>!lease.released).reduce((sum:number,lease:any)=>sum+(lease.claim.licences.fixture??0),0)<=1,'Actual callback sees at most one retained licence holder');});if(flags.nativeJournal)await nativeFixtureJournal(request,result);if(flags.lostAck)throw new Error('Fixture lost actual launch acknowledgement');return result;},
  async collect(prepared:any,receipt:any,req:any){const result=await base.collect(prepared,receipt,req);if(flags.readerReject&&!await exists(path.join(workspace,'reader-fixed')))throw new Error('Real Reader fixture rejects retained result until repaired');return result;},
  async release(prepared:any,receipt:any,before:any){if(flags.releaseUnknown&&!await exists(path.join(workspace,'release-confirmed')))return {closed:false,reason:'Fixture retained real Job release is unknown'};return base.release(prepared,receipt,before);},
 };
};
async function nativeFixtureJournal(request:any,result:any) {
 assert.equal(await store.effectDispatchExists(request.identity,'submit'),true);
 const write={callId:'native-tool-default',sessionId:'native-budget-session',nodeId:request.identity.taskId,attempt:1,scope:'workshop',workshop:'fixture',path:'program.py',requestedBytes:4,contentSha256:createHash('sha256').update('ABCD').digest('hex')};
 const reservation=await store.reserveExternalResearchWrite(request.identity,write);
 assert.equal(reservation.allowed,true);assert.equal(reservation.usedWriteAttempts,1);assert.equal(reservation.usedBytes,4);
 assert.deepEqual(await store.reserveExternalResearchWrite(request.identity,write),reservation);
 await assert.rejects(store.reserveExternalResearchWrite(request.identity,{...write,contentSha256:createHash('sha256').update('DCBA').digest('hex')}),/different scope, content digest or bytes/);
 const budgetFact=await store.fact(reservation.recordId);assert.equal(budgetFact.payload.fact.limitWriteAttempts,256);assert.equal(budgetFact.payload.fact.limitBytes,4*1024*1024);
 await store.recordExternalEffectFact(request.identity,'receipt',result);
 await store.recordExternalEffectFact(request.identity,'receipt',result);
 assert.deepEqual(await store.externalEffectFact(request.identity,'receipt'),result);
 const grant={effective:{childSessionId:'native-child-'+request.identity.runId}};
 await store.recordExternalEffectFact(request.identity,'child:fixture:intent',grant);
 assert.deepEqual(await store.nativeSessionEffect(grant.effective.childSessionId),{identity:request.identity,fact:grant});
 assert.deepEqual((await store.listExternalEffectFacts(request.identity,'child:'))['child:fixture:intent'],grant);
 for(const [id,bytes] of [['z','A'],['a','B'],['m','A']])await store.recordExternalEffectFact(request.identity,'code:'+id,{bytes});
 const ordered=await store.orderedExternalEffectFacts(request.identity,'code:');
 assert.deepEqual(ordered.map((fact:any)=>fact.phase),['code:z','code:a','code:m']);
 assert.deepEqual(ordered.map((fact:any)=>fact.fact.bytes),['A','B','A']);
 assert.ok(ordered.every((fact:any,index:number)=>index===0||fact.seq>ordered[index-1].seq));
 await assert.rejects(store.recordExternalEffectFact(request.identity,'receipt',{wrong:true}),/different input/);
 const identities=['a','b'].map(key=>({...request.identity,taskId:'raw-authority-'+key,effectId:request.identity.effectId+':raw-authority:'+key}));
 for(const identity of identities)await store.prepareExternalEffect(identity,{scope:'raw-interactive-authority-fixture'});
 assert.equal(await store.effectDispatchExists(identities[0],'never-sent'),false);
 const claimed=await Promise.all(identities.map(identity=>store.reserveExternalEffectResources(identity,{siteId:'local',jobs:1,licences:{}},{jobs:2,licences:{fixture:1}})));
 assert.equal(claimed.filter(Boolean).length,1,'Raw callback leases share the ordinary actual Site Job cap');
 const winner=identities[claimed.findIndex(Boolean)],admission={...request.admission,effectId:winner.effectId};
 const writers=await Promise.allSettled(['first','second'].map(actor=>store.externalEffectTransaction(winner,{admission,permit:async()=>true},async(_run:any,facts:any,record:any)=>{
  if(facts.writer)throw new Error('Original interactive scope already has one writer');
  await record('writer',{actor});return actor;
 })));
 assert.equal(writers.filter(result=>result.status==='fulfilled').length,1,'Competing actual callback fact reservations have one writer');
 await store.recordExternalEffectFact(request.identity,'authority-fixture',{winner});
}
async function exists(file:string){try{await readFile(file);return true;}catch{return false;}}
function residentAdapter(run:any,req:any,goal:string){
 const engineeringIdentity={run:{id:run.runId,control:{owner:'owner',epoch:0,revision:0},packDigest:pack.flow.packSha256,goal:{}},execution:{id:`engineering-${run.runId}`,nodeId:'engineering',kind:'act',attempt:1},site,pack,workspace,bindings:{},outsourcing:pack.contract.tools[1].outsourcing,licences:{fixture:1},tool:pack.contract.tools[1],boundInputs:{},siteIdentityMatches:true};
 return residentEngineeringTaskAdapter({sitesDir,siteId:'local',identity:engineeringIdentity,start:{operation:'start',goal},collect:realReader});
}
runtime=await startDurableRuntime({database,manifest,workflows:[{name:'u4-task',async execute(rt:any,input:any){
 const run=await rt.store.run(input.runId),request=requestFor(run,input.value);
 const adapter=await commandAdapter(request,input.flags);
 for(let poll=0;poll<100;poll++) {
  const outcome=await executeTaskEffect(rt.store,request,adapter);
  if(outcome.state!=='waiting'&&outcome.state!=='running')return outcome;
  if((await rt.store.run(input.runId)).hold) {
    await DBOS.setEvent('paused-before-send',{calls:await exists(path.join(workspace,'calls-crash'))});
    await DBOS.recv('continue');
    request.admission.epoch=(await rt.store.run(input.runId)).epoch;
  }
  await DBOS.sleep(20);
 }
 throw new Error(`Original Job did not produce a consumable result: ${JSON.stringify(await rt.store.effectSnapshot(request.identity))}`);
}},{name:'u4-resident',async execute(rt:any,input:any){
 const run=await rt.store.run(input.runId),request=requestFor(run,input.value,'engineering'),adapter=residentAdapter(run,request,input.value.goal);
 for(let poll=0;poll<100;poll++){
  const outcome=await executeTaskEffect(rt.store,request,adapter);if(outcome.state!=='waiting'&&outcome.state!=='running')return outcome;await DBOS.sleep(20);
 }
 throw new Error('Resident native delivery did not auto hand off');
}}]});
const store=runtime.store;
let finishing:Promise<void>|undefined;
async function finish(){return finishing??=(async()=>{
 for(const lease of await store.effectResources()) {
  const prepared=await store.effectFact(lease.effectId,'prepared');if(prepared){const job=(prepared as any).job??prepared;await stopRetainedJob(site,job).catch(()=>undefined);}
 }
 await runtime.stop();await database.stop();
})();}
let closeResolve:()=>void;const closed=new Promise<void>(resolve=>{closeResolve=resolve;});
process.on('message',async(message:any)=>{if(message.action==='pause'){await store.command({runId:'crash',commandId:'pause',action:'pause',owner:'owner',epoch:0,revision:0});process.send!({stage:'paused'});}if(message.action==='close'){await finish();closeResolve();}});
process.on('uncaughtException',error=>{console.error(error);void finish().finally(()=>process.exit(1));});
async function open(id:string,input:any){return store.createRun({runId:id,inputSha256:jsonDigest(input),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:{input}});}
async function waitCommand(req:any,adapter:any){let out;for(let n=0;n<100;n++){out=await executeTaskEffect(store,req,adapter);if((out.state!=='waiting'&&out.state!=='running')||out.reason.code==='reader-rejected'||out.retainedResult)return out;if(DBOS.isInWorkflow())await DBOS.sleep(20);else await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(JSON.stringify(out));}
async function realReader(identity:any,delivery:any,materialized:any,req:any){
 const readerScript=path.join(workspace,'reader.py'),out=path.join(workspace,'reader.json'),marker=path.join(workspace,'reader-calls');
 await writeFile(readerScript,`import json,pathlib,sys\nv=json.loads(pathlib.Path(sys.argv[1]).read_text())\nwith pathlib.Path(sys.argv[3]).open('a') as f:f.write('reader\\n')\nif v.get('schema')!='fixture-result/1' or v.get('value') not in ['native','repaired']:raise SystemExit('Reader rejects result; repair same native task')\npathlib.Path(sys.argv[2]).write_text(json.dumps({'schemaVersion':'1','value':{'goalMet':False,'evidence':'UNKNOWN'},'artifacts':[{'name':'result','path':'result.json'}],'diagnostics':[{'code':'timing','message':'Fixture delivery is not Timing signoff','source':'fixture-reader'}]}))\n`);
 const input={reportSha256:materialized.sha256},childRun=await store.run(req.identity.runId);
 const childReq={...req,identity:{...req.identity,taskId:`${req.identity.taskId}-reader`,effectId:`${req.identity.effectId}-reader-${materialized.sha256}`,inputSha256:jsonDigest(input)},admission:{...req.admission,effectId:`${req.identity.effectId}-reader-${materialized.sha256}`},input};
 const adapter=commandTaskAdapter({sitesDir,siteId:'local',workspace,name:'reader',argv:['/usr/bin/python3',readerScript,materialized.path,out,marker],collect:async(site:any,_job:any,request:any)=>collectTaskProducerOutput(site,workspace,out,request)});
 const result=await waitCommand(childReq,adapter);if(result.state!=='succeeded')throw new Error(result.reason.message);
 const parsed=JSON.parse(await readFile(materialized.path,'utf8'));
 return {schemaVersion:'1',value:{goalMet:false,evidence:'UNKNOWN',nativeValue:parsed.value},artifacts:delivery.artifacts.map((item:any)=>({runId:req.identity.runId,taskId:req.identity.taskId,effectId:req.identity.effectId,name:item.path,path:path.posix.join('.hima-engineering',delivery.taskId,delivery.artifactRoot,item.path),sha256:item.sha256})),diagnostics:[{code:'reader',message:'Real fixture Reader accepted preserved delivery',source:'fixture-reader'}]};
}
if(mode==='matrix') {
 // Real loadPack -> exact argv -> local Job -> raw business output -> immutable artifacts.
 const run=await open('abi',{}),req=requestFor(run,{}),adapter=await commandAdapter(req);
 assert.deepEqual(toolArgv(pack.contract.tools[0],{TASK_INPUT:'i',TASK_OUTPUT:'o',MARKER:'m'}),['/usr/bin/python3',script,'i','o','m']);
 await assert.rejects(declaredCommandTaskAdapter({request:req,tool:{...pack.contract.tools[0],inputs:[]},sitesDir,siteId:'local',workspace,platform:{}}),/TASK_OUTPUT/);
 const abi=await waitCommand(req,adapter);assert.equal(abi.state,'succeeded',JSON.stringify(abi));assert.deepEqual(abi.result.value,{answer:42});assert.equal(abi.result.artifacts[0].runId,'abi');assert.equal(await readFile(path.join(workspace,abi.result.artifacts[0].path),'utf8'),'immutable real producer evidence\n');
 await assert.rejects(store.assertEffectAdmission(req.admission,async()=>true),/terminal or released/);
 await assert.rejects(store.claimEffectDispatch(req.admission,async()=>true,'late-business',jsonDigest({late:true})),/terminal or released/);
 // Truthful late native receipts remain retainable; cleanup/read/reconcile are unaffected.
 await store.recordExternalEffectFact(req.identity,'late-receipt',{closed:true});assert.deepEqual(await store.externalEffectFact(req.identity,'late-receipt'),{closed:true});
 // Lost launch ACK and completed Job receipt both reconnect exactly one original session.
 const lostRun=await open('lost',{}),lostReq=requestFor(lostRun,{}),lostAdapter=await commandAdapter(lostReq,{lostAck:true});
 const lost=await waitCommand(lostReq,lostAdapter);assert.equal(lost.state,'succeeded');assert.equal(await readFile(path.join(workspace,'calls-lost'),'utf8'),'once\n');assert.deepEqual(await executeTaskEffect(store,lostReq,lostAdapter),lost);
 // Unknown release keeps readable verified result and blocks a competing workflow licence.
 const retainedRun=await open('retained',{}),retainedReq=requestFor(retainedRun,{}),retainedAdapter=await commandAdapter(retainedReq,{releaseUnknown:true});
 const retained=await waitCommand(retainedReq,retainedAdapter);assert.equal(retained.state,'waiting');assert.ok(retained.retainedResult);assert.equal((await store.effectResources(retainedReq.identity.effectId))[0].released,false);
 await assert.rejects(store.commitResult(retained.retainedResult),/not confirmed released/);
 assert.equal(await readFile(path.join(workspace,retained.retainedResult.artifacts[0].path),'utf8'),'immutable real producer evidence\n');
 const competitorRun=await open('competing',{}),competitorReq=requestFor(competitorRun,{}),competitor=await commandAdapter(competitorReq);
 assert.equal((await executeTaskEffect(store,competitorReq,competitor)).reason.code,'site-capacity');assert.equal(await exists(path.join(workspace,'calls-competing')),false);
 await writeFile(path.join(workspace,'release-confirmed'),'confirmed');assert.equal((await waitCommand(retainedReq,retainedAdapter)).state,'succeeded');assert.equal((await waitCommand(competitorReq,competitor)).state,'succeeded');
 await assert.rejects(store.commitResult({...abi.result,value:{forged:true}}),/retained verified delivery/);
 // Reader rejection is repaired at the same result boundary; no producer repeat.
 const repairRun=await open('repair',{}),repairReq=requestFor(repairRun,{}),repairAdapter=await commandAdapter(repairReq,{readerReject:true});
 assert.equal((await waitCommand(repairReq,repairAdapter)).reason.code,'reader-rejected');await writeFile(path.join(workspace,'reader-fixed'),'fixed');assert.equal((await waitCommand(repairReq,repairAdapter)).state,'succeeded');assert.equal(await readFile(path.join(workspace,'calls-repair'),'utf8'),'once\n');
 // Actual callback pause/owner fencing; adapter construction never creates task I/O files.
 const pauseRun=await open('pause',{}),pauseReq=requestFor(pauseRun,{}),pauseAdapter=await commandAdapter(pauseReq);
 await store.prepareEffect(pauseReq.identity,{kind:'command',version:taskEffectAdapterVersion,input:{}});
 await store.command({runId:'pause',commandId:'pause',action:'pause',owner:'owner',epoch:0,revision:0});
 const paused=await executeTaskEffect(store,pauseReq,pauseAdapter);assert.equal(paused.state,'waiting');assert.equal(await exists(path.join(workspace,'calls-pause')),false);
 await store.command({runId:'pause',commandId:'resume',action:'continue',owner:'owner',epoch:1,revision:0});
 assert.equal((await executeTaskEffect(store,pauseReq,pauseAdapter)).state,'waiting');assert.equal(await exists(path.join(workspace,'calls-pause')),false);
 pauseReq.admission.epoch=2;assert.equal((await waitCommand(pauseReq,pauseAdapter)).state,'succeeded');
 const journalRun=await open('journal',{}),journalHandle=await runtime.startWorkflow('u4-task','u4-journal',{runId:journalRun.runId,value:{},flags:{nativeJournal:true}});
 assert.equal((await journalHandle.getResult()).state,'succeeded');const journalFacts=await store.pendingFacts('journal');assert.equal(journalFacts.filter((fact:any)=>fact.payload.phase==='native:receipt').length,1);await store.projectFacts(async()=>{},'journal');assert.equal((await store.pendingFacts('journal')).length,0);const retainedFact=await store.fact(journalFacts[0].factId);assert.equal(retainedFact.factId,journalFacts[0].factId);assert.deepEqual(retainedFact.payload,journalFacts[0].payload);assert.deepEqual((await store.orderedExternalEffectFacts(requestFor(journalRun,{}).identity,'code:')).map((fact:any)=>fact.fact.bytes),['A','B','A']);
 const winner=(await store.externalEffectFact(requestFor(journalRun,{}).identity,'authority-fixture')).winner;await store.command({runId:'journal',commandId:'pause-authority',action:'pause',owner:'owner',epoch:0,revision:0});let refusedCallbackCalls=0;await assert.rejects(store.externalEffectTransaction(winner,{admission:{runId:'journal',effectId:winner.effectId,owner:'owner',epoch:0,revision:0},permit:async()=>true},async()=>{refusedCallbackCalls++;}),/blocked/);assert.equal(refusedCallbackCalls,0);await store.externalEffectTransaction(winner,{permit:async()=>true},async(_run:any,_facts:any,record:any)=>record('cleanup',{neverDispatched:true}));await store.releaseExternalEffectResources(winner,{neverDispatched:true});assert.equal((await store.effectResources(winner.effectId))[0].released,true);
 const concurrentInput={sleep:0.15};await open('parallel-a',concurrentInput);await open('parallel-b',concurrentInput);
 const handles=await Promise.all(['a','b'].map(key=>runtime.startWorkflow('u4-task',`u4-parallel-${key}`,{runId:`parallel-${key}`,value:concurrentInput,flags:{program:key==='b'}})));
 for(const handle of handles)assert.equal((await handle.getResult()).state,'succeeded');
 const a=JSON.parse(await readFile(path.join(workspace,'calls-parallel-a.events'),'utf8')),b=JSON.parse(await readFile(path.join(workspace,'calls-parallel-b.events'),'utf8'));
 assert.ok(a[1]<=b[0]||b[1]<=a[0],'Two actual workflows cannot overlap physical Jobs holding the same licence: '+JSON.stringify({a,b}));
 // The established research-write cap is shared by all native effects, not one counter per agent.
 const budgetRun=await store.createRun({runId:'research-shared',inputSha256:jsonDigest({}),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:{budget:{researchWriteAttempts:1,researchWriteBytes:100}}});
 const budgetIds=['a','b'].map(key=>({...requestFor(budgetRun,{}).identity,effectId:'research-effect-'+key,taskId:'research-task-'+key}));
 for(const identity of budgetIds)await store.prepareExternalEffect(identity,{kind:'native-budget-fixture'});
 const write=(sessionId:string,callId:string,bytes:string)=>({callId,sessionId,nodeId:'workshop',attempt:1,scope:'workshop',workshop:'fixture',path:'program.py',requestedBytes:Buffer.byteLength(bytes),contentSha256:createHash('sha256').update(bytes).digest('hex')});
 const writes=budgetIds.map((_identity:any,index:number)=>write('research-session-'+index,'same-tool-call','ABCD'));
 const reservations=await Promise.all(budgetIds.map((identity:any,index:number)=>store.reserveExternalResearchWrite(identity,writes[index])));
 assert.equal(reservations.filter((receipt:any)=>receipt.allowed).length,1);assert.deepEqual(reservations.map((receipt:any)=>receipt.usedWriteAttempts).sort(),[1,2]);
 for(let index=0;index<2;index++)assert.deepEqual(await store.reserveExternalResearchWrite(budgetIds[index],writes[index]),reservations[index]);
 const denied=await store.reserveExternalResearchWrite(budgetIds[0],write('research-session-0','third-tool-call','X'));assert.equal(denied.allowed,false);assert.equal(denied.usedWriteAttempts,3);assert.equal(denied.usedBytes,9);
 await assert.rejects(store.reserveExternalResearchWrite(budgetIds[0],{...writes[0],path:'changed.py'}),/different scope, content digest or bytes/);
 const bytesRun=await store.createRun({runId:'research-bytes',inputSha256:jsonDigest({}),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:'2099-01-01T00:00:00.000Z',data:{budget:{researchWriteAttempts:10,researchWriteBytes:3}}}),bytesId=requestFor(bytesRun,{}).identity;
 await store.prepareExternalEffect(bytesId,{kind:'native-budget-fixture'});
 assert.equal((await store.reserveExternalResearchWrite(bytesId,write('byte-session','first','ABC'))).allowed,true);
 const byteDenied=await store.reserveExternalResearchWrite(bytesId,write('byte-session','second','D'));assert.equal(byteDenied.allowed,false);assert.equal(byteDenied.usedBytes,4);assert.equal(byteDenied.usedWriteAttempts,2);
 assert.equal((await store.reserveExternalResearchWrite(bytesId,write('byte-session','third',''))).usedWriteAttempts,3);
 const failedRun=await open('failed',{}),failedReq=requestFor(failedRun,{}),failedAdapter=commandTaskAdapter({sitesDir,siteId:'local',workspace,name:'known-failure',licences:{fixture:1},argv:['/bin/sh','-c','exit 2'],collect:async()=>{throw new Error('A failed Job cannot produce a business result');}});
 const failed=await waitCommand(failedReq,failedAdapter);assert.equal(failed.state,'failed');assert.equal((await store.effectResources(failedReq.identity.effectId))[0].released,true);assert.equal((await executeTaskEffect(store,failedReq,failedAdapter)).state,'failed');assert.equal(await store.result(failedReq.identity.effectId),undefined);
 await assert.rejects(store.assertEffectAdmission(failedReq.admission,async()=>true),/terminal or released/);
 const unknownRun=await open('unknown',{}),unknownReq=requestFor(unknownRun,{}),unknownAdapter=await commandAdapter(unknownReq,{unknown:true});
 for(let attempt=0;attempt<3;attempt++)assert.equal((await executeTaskEffect(store,unknownReq,unknownAdapter)).state,'waiting');assert.equal(await exists(path.join(workspace,'calls-unknown')),false);assert.equal((await store.effectResources(unknownReq.identity.effectId))[0].released,false);
 process.send!({ok:true,scenario:'command-matrix',calls:4});
} else if(mode==='resource-prototypes') {
 const run=await open('resource-prototypes',{}),base=requestFor(run,{}).identity;
 const identity=(name:string)=>({...base,taskId:name,effectId:`prototype-${name}`});
 const ids=['inherited','plain-holder','explicit','contender'].map(identity);
 for(const id of ids)await store.prepareExternalEffect(id,{fixture:'licence-own-properties'});
 assert.equal(await store.reserveExternalEffectResources(ids[0],{siteId:'prototype-site',jobs:0,licences:{constructor:1}},{jobs:1,licences:{}}),false,'An inherited capacity property is not a declared licence');
 assert.equal(await store.reserveExternalEffectResources(ids[1],{siteId:'prototype-site',jobs:0,licences:{}},{jobs:1,licences:{constructor:1}}),true);
 assert.equal(await store.reserveExternalEffectResources(ids[2],{siteId:'prototype-site',jobs:0,licences:{constructor:1}},{jobs:1,licences:{constructor:1}}),true,'A held map with no own constructor contributes zero seats');
 assert.equal(await store.reserveExternalEffectResources(ids[3],{siteId:'prototype-site',jobs:0,licences:{constructor:1}},{jobs:1,licences:{constructor:1}}),false,'An explicitly declared inherited-name licence is still counted and exhausted');
 await store.releaseExternalEffectResources(ids[2],{neverDispatched:true});
 assert.equal(await store.reserveExternalEffectResources(ids[3],{siteId:'prototype-site',jobs:0,licences:{constructor:1}},{jobs:1,licences:{constructor:1}}),true);
 for(const id of [ids[1],ids[3]])await store.releaseExternalEffectResources(id,{neverDispatched:true});
 process.send!({ok:true,scenario:'resource-prototypes'});
} else if(mode.startsWith('resident-failure')) {
 const input={goal:'FAIL_PROMPT'},run=await open('resident-failure',input),req=requestFor(run,input,'engineering'),adapter=residentAdapter(run,req,input.goal);
 // Hold the observation only, so this test can exercise either live or already-gone wrapper.
 const heldAdapter={...adapter,reconcile:async(prepared:any,receipt:any)=>{
  const observed=await adapter.reconcile(prepared,receipt);
  return observed.state==='failed'?{state:'running',reason:'Fixture awaits original failed native state'}:observed;
 }};
 await executeTaskEffect(store,req,heldAdapter);
 const prepared=await store.effectFact(req.identity.effectId,'prepared'),stateAt=path.join(prepared.plan.taskDir,'state.json');
 let state:any;
 for(let n=0;n<100;n++){try{state=JSON.parse(await readFile(stateAt,'utf8'));}catch{}if(state?.phase==='failed')break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(state?.phase,'failed','Real ACP prompt error must produce signed failed state');
 if(mode==='resident-failure-gone') {
  const submitted=await store.effectFact(req.identity.effectId,'submitted');
  const rows=execFileSync('ps',['-axo','pid,ppid,command'],{encoding:'utf8'}).split('\n');
  const child=rows.map(row=>/^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(row)).find(row=>row&&Number(row[2])===submitted.pid&&row[3]!.includes(wrapper)&&row[3]!.includes(prepared.plan.taskDir));
  assert.ok(child,'Find only this fixture original wrapper beneath its retained pane PID');
  process.kill(Number(child[1]),'SIGKILL');
  for(let n=0;n<100;n++){try{await readFile(path.join(workspace,`${submitted.session}.exit`));break;}catch{}await new Promise(resolve=>setTimeout(resolve,20));}
 }
 let outcome:any;
 for(let n=0;n<100;n++){outcome=await executeTaskEffect(store,req,adapter);if(outcome.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(outcome.state,'failed',JSON.stringify(outcome));assert.equal(await store.result(req.identity.effectId),undefined,'Known native failure must not invent a success result');
 assert.equal((await store.effectResources(req.identity.effectId))[0].released,true);assert.equal((await executeTaskEffect(store,req,adapter)).state,'failed');
 if(mode==='resident-failure-gone')assert.equal(await store.effectDispatchExists(req.identity,'cleanup:engineering-reconcile'),true,'Already-gone original wrapper uses one durable cleanup dispatch');
 const following=await open('after-failure',{}),followingReq=requestFor(following,{}),followingAdapter=await commandAdapter(followingReq);
 assert.equal((await waitCommand(followingReq,followingAdapter)).state,'succeeded','The original Site licence becomes reusable after confirmed failed-task closure');
 process.send!({ok:true,scenario:mode,terminal:'failed',leaseReleased:true});
} else if(mode==='resident') {
 const input={goal:'DELIVER_BAD_RESULT'},run=await open('resident',input),req=requestFor(run,input,'engineering');
 const adapter=residentAdapter(run,req,input.goal);
 let outcome:any;
 for(let n=0;n<100;n++){outcome=await executeTaskEffect(store,req,adapter);if(outcome.reason?.code==='reader-rejected')break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.equal(outcome.reason?.code,'reader-rejected',JSON.stringify(outcome));
 const prepared=await store.effectFact(req.identity.effectId,'prepared'),stateAt=path.join((prepared as any).plan.taskDir,'state.json');
 const firstSession=JSON.parse(await readFile(stateAt,'utf8')).sessionId;
 // Multiple messages all stay inside the same real ACP/native session. No platform round cap.
 for(let round=0;round<5;round++) {
  const response=await sendTaskEffectMessage(store,req,adapter,`repair-${round}`,'FIX_DELIVERY');assert.equal(response.state,'completed');
  for(let n=0;n<100;n++){const state=JSON.parse(await readFile(stateAt,'utf8'));if(state.phase==='waiting'&&state.detail?.completedRequestId===`repair-${round}`)break;await new Promise(resolve=>setTimeout(resolve,20));}
 }
 await store.command({runId:run.runId,commandId:'handoff',action:'handoff',owner:'owner',epoch:0,revision:0,nextOwner:'successor'});
 const stale=await sendTaskEffectMessage(store,req,adapter,'stale-owner','FIX_DELIVERY');assert.equal(stale.state,'waiting');assert.equal(await exists(path.join((prepared as any).plan.taskDir,'requests','stale-owner.json')),false);
 await store.command({runId:run.runId,commandId:'continue-after-handoff',action:'continue',owner:'successor',epoch:1,revision:0});
 assert.equal((await sendTaskEffectMessage(store,req,adapter,'stale-after-continue','FIX_DELIVERY')).state,'waiting');assert.equal(await exists(path.join((prepared as any).plan.taskDir,'requests','stale-after-continue.json')),false);
 req.admission.owner='successor';req.admission.epoch=2;
 for(let n=0;n<100;n++){outcome=await executeTaskEffect(store,req,adapter);if(outcome.state==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.equal(outcome.state,'succeeded',JSON.stringify(outcome));assert.equal(outcome.result.value.nativeValue,'native');assert.equal(JSON.parse(await readFile(stateAt,'utf8')).sessionId,firstSession);
 assert.equal((await store.effectResources(req.identity.effectId))[0].released,true);assert.equal((await store.pendingFacts(run.runId)).filter((fact:any)=>fact.kind==='task-result'&&fact.payload.identity.effectId===req.identity.effectId).length,1);
 for(const artifact of outcome.result.artifacts)assert.equal(createHash('sha256').update(await readFile(path.join(workspace,artifact.path))).digest('hex'),artifact.sha256);
 assert.equal((await executeTaskEffect(store,req,adapter)).state,'succeeded');
 const workflowInput={goal:'DELIVER_RESULT'},workflowRun=await open('resident-workflow',workflowInput);
 const handle=await runtime.startWorkflow('u4-resident','u4-resident-workflow',{runId:workflowRun.runId,value:workflowInput});
 const durableResult=await handle.getResult();assert.equal(durableResult.state,'succeeded');assert.equal(durableResult.result.value.nativeValue,'native');
 process.send!({ok:true,scenario:'resident-auto-handoff',nativeSession:firstSession,ownerCompleteCalls:0,repairRounds:5,readerCalls:(await readFile(path.join(workspace,'reader-calls'),'utf8')).trim().split('\n').length});
} else {
 const run=await open('crash',{});
 if(mode.startsWith('crash-')) {
  const target=mode==='crash-prepared'?'prepared':'submitted';
  const record=store.recordEffectFact.bind(store);
  store.recordEffectFact=async(identity:any,phase:string,fact:any)=>{await record(identity,phase,fact);if(phase===target){process.send!({stage:target});await new Promise(()=>{});}};
  void runtime.startWorkflow('u4-task','u4-workflow',{runId:'crash',value:{},flags:{}});
 } else {
  if(mode==='recover-held') {
    assert.deepEqual(await DBOS.getEvent('u4-workflow','paused-before-send'),{calls:false});assert.equal(await exists(path.join(workspace,'calls-crash')),false);
    await store.command({runId:'crash',commandId:'continue',action:'continue',owner:'owner',epoch:1,revision:0});await DBOS.send('u4-workflow','continue','continue','continue-once');
  }
  const result=await DBOS.retrieveWorkflow('u4-workflow').getResult();assert.equal(result.state,'succeeded');
  assert.equal(await readFile(path.join(workspace,'calls-crash'),'utf8'),'once\n');assert.equal((await store.pendingFacts('crash')).filter((fact:any)=>fact.kind==='task-result').length,1);
  process.send!({ok:true,scenario:'crash-replay',facts:(await store.pendingFacts('crash')).map((fact:any)=>fact.kind)});
 }
}
await closed;
process.disconnect();
