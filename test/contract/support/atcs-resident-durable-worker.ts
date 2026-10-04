// @hima-seam agent wrapped
// Normal frozen ATCS Pack, actual Host/PG/wrapper/Reader. Only vendor/model calls are stand-ins.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access,realpath,cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bootInProcess,createRootAgent,type InProcessHost} from './boot-inprocess.ts';
import type {StartRunResult,ReadExperienceResult} from '@hima/harness';
import {prepareHimaHome,himaHomeSources} from '../../../packages/desktop/src/hima-home.ts';
import {repoRoot} from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify}=require('yaml');
const home=await realpath(process.argv[2]!),mode=process.argv[3]??'clear';
const startedAt=Date.now(),packId='agentic-timing-closure-system';
const fixture=path.join(repoRoot,'test/fixtures/atcs-resident-dry');
const packageDir=process.env.HIMA_U8_DRY_PACKAGE??path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
type ToolAnswer=Awaited<ReturnType<InProcessHost['ctx']['tools']['execute']>>;
const {createDurableViewReaders}=await load('durable-views');
const {readFlow}=await load('flow-workflow');
const {DBOS}=await import(pathToFileURL(require.resolve('@dbos-inc/dbos-sdk')).href);
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const inputRoot=path.join(workspace,'inputs'),admin=path.join(workspace,'admin');
for(const dir of [workspace,admin,sitesDir])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
const preparedInputs=spawnSync('python3',[path.join(fixture,'prepare.py'),inputRoot],{encoding:'utf8'});
assert.equal(preparedInputs.status,0,preparedInputs.stderr);
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp.py'),capability=path.join(admin,'capability.json'),gate=path.join(admin,'initial-prompt-gate'),prompts=path.join(admin,'prompts.jsonl');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:[],set:{ATCS_DRY_CASE:mode,ATCS_DRY_GATE:gate,ATCS_DRY_PROMPTS:prompts},toolPaths:[],credentialReadPaths:[]},
 delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,path.join(repoRoot,'sites/linglong-atcs28/templates'),fixture],allowedWriteRoots:[workspace],
 allowedWrappers:['python3','/usr/bin/python3',wrapper],forbidden:['services','network','downloads','deletions','licences']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',
 bindings:{workspaceRoot:workspace,designStateManifest:path.join(inputRoot,'manifest.json'),nativeTimingContext:path.join(inputRoot,'native.json'),siteCapabilities:path.join(inputRoot,'site.json'),engineeringCapabilities:capability},
 capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{xtop:1}}}));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';process.env.HIMA_RESIDENT_TESTING='1';
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const prepared=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:prepared.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any,readers:any,runId:string|undefined,messageWorkflowId:string|undefined,currentAwait='startup';
try {
 host=await bounded('boot Host',bootInProcess(h,{withWebApp:true}),45000);const service=host.ctx.hima,runtime=service.durable;
 readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const owner=await createRootAgent(host.ctx,workspace),foreign=await createRootAgent(host.ctx,workspace);
 const opening=await bounded<StartRunResult>('public startRun',service.startRun({pack:packId,site:'local',test:true,goal:{target_setup_wns_ns:0,target_hold_wns_ns:0},strategy:{nativeReportPaths:10000},ownerSessionId:String(owner.id),timeBoxMs:1800000}),15000);
 assert.ok(opening.kind==='ran'||opening.kind==='preparing',JSON.stringify(opening));runId=opening.run.id;assert.ok(runId);
 const campaign=opening.workspace;
 assert.ok(campaign);
 await until('first native engineering prompt',()=>exists(gate+'.ready'));
 console.log('U8 phase: actual preparation and native candidate ready');
 const gateProof=JSON.parse(await readFile(gate+'.ready','utf8'));
 assert.equal(gateProof.loadedCellStateDigest,gateProof.commonCellStateDigest);
 assert.equal(gateProof.task.runId,runId);assert.equal(gateProof.task.nodeId,'fix-timing');
 let view=await readers.readRunView(runId);
 const engineering=view.tasks.find((task:any)=>task.taskId==='fix-timing');assert.ok(engineering?.identity);
 const effectId=engineering.identity.effectId;
 const control=view.run.control;
 const request={run:runId,action:'engineering',requestId:'resident-business-message',executionId:effectId,
 expectedEpoch:control.epoch,expectedRevision:control.revision,engineering:{operation:'message',message:'Preserve the selected engineering checkpoint and explain the honest remaining timing and uncertainty in delivery.'}};
 const call=async(args:any,agent=owner)=>{
  const answer=await bounded<ToolAnswer>(`public hima_execute ${args.requestId}`,host.ctx.tools.execute({callId:`u8-${Date.now()}`,name:'hima_execute',arguments:args,agent,signal:AbortSignal.timeout(10000)}),15000);
  assert.notEqual(answer.isError,true,JSON.stringify(answer));return JSON.parse(answer.content.find((part):part is Extract<ToolAnswer['content'][number],{type:'text'}>=>part.type==='text')!.text);
 };
 const accepted=await call(request);messageWorkflowId=accepted.data?.workflowId;assert.equal(accepted.kind,'accepted',JSON.stringify(accepted));assert.equal(accepted.data.state,'accepted');
 const duplicate=await call(request);assert.equal(duplicate.data.workflowId,accepted.data.workflowId);
 const stale=await call({...request,requestId:'resident-stale-message'},foreign);assert.equal(stale.kind,'refused',JSON.stringify(stale));
 await writeFile(gate,'release initial native prompt\n');
 await until('durable native message recorded',async()=>!!await runtime.store.flowFact(runId,`task-message-result:${request.requestId}`));
 console.log('U8 phase: original durable business message recorded');
 console.log('U8 await: duplicate public recorded request');
 const recorded=await call(request);assert.equal(recorded.data.state,'recorded');assert.equal(recorded.data.workflowId,accepted.data.workflowId);
 console.log('U8 phase: duplicate public request returned original recorded result');
 await until('five ATCS tasks complete',async()=>{view=await readers.readRunView(runId);return view.tasks.filter((task:any)=>task.result).length===5&&String(view.run.status).startsWith('ended');});
 const tasks=view.tasks.filter((task:any)=>task.current&&task.result);
 assert.deepEqual(tasks.map((task:any)=>task.taskId).sort(),['prepare-inputs','prepare-baseline','fix-timing','evaluate-timing','deliver'].sort());
 for(const task of tasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 const final=tasks.find((task:any)=>task.taskId==='deliver');assert.equal(final.result.value.goalMet,mode==='clear');
 assert.equal(view.run.goalState,mode==='clear'?'met':'not-met');
 assert.equal(final.result.value.collateral.unknown.value,4,'broader UNKNOWN stays explicit');
 for(const filename of ['readiness','baseline','xtop-context','common-stage'])assert.ok(await exists(path.join(campaign,'state',filename+'.json')));
 assert.equal(await exists(path.join(campaign,'state/autofix-reference.json')),false);
 const promptRows=(await readFile(prompts,'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(promptRows.filter(row=>row.initial).length,1);assert.equal(promptRows.length,2);
 const records=await readers.readRunRecords(runId,'job'),launched=records.filter((record:any)=>record.event==='launched');
 assert.equal(launched.filter((record:any)=>record.job.name==='engineering-fix-timing').length,1,JSON.stringify(launched));
 assert.equal(launched.filter((record:any)=>record.job.name==='reader-atcs-engineering-result').length,1,JSON.stringify(launched));
 const businessProof={mode,runId,tasks:5,goalState:view.run.goalState,broaderUnknown:4,readerJobs:1,engineeringJobs:1,messageIdentity:true,elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry',mode+'-business-proof.json'),JSON.stringify(businessProof,null,2));
 console.log('U8 phase: '+JSON.stringify(businessProof));
 const url=host.ctx.connection.authenticatedUrl(`http://127.0.0.1:${host.ctx.webServer.port}`);
 const auth=await bounded('HTTP authentication',fetch(url,{redirect:'manual'})),cookie=auth.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
 for(const name of ['final-report','engineering-package']){
  const artifact=final.result.artifacts.find((ref:any)=>ref.name===name);assert.ok(artifact);
  const answer=await bounded<ToolAnswer>(`public hima_inspect ${name}`,host.ctx.tools.execute({callId:`inspect-${name}`,name:'hima_inspect',arguments:{requestId:`inspect-${name}`,target:{kind:'task-artifact',runId,effectId:final.identity.effectId,name}},agent:owner,signal:AbortSignal.timeout(10000)}),15000);
  assert.notEqual(answer.isError,true,JSON.stringify(answer));const value=JSON.parse(answer.content.find((part):part is Extract<ToolAnswer['content'][number],{type:'text'}>=>part.type==='text')!.text);assert.equal(value.facts.ref.sha256,artifact.sha256);
  const download:Response=await bounded<Response>(`HTTP artifact download ${name}`,fetch(new URL(`/hima/api/runs/${runId}/assets?effect=${encodeURIComponent(final.identity.effectId)}&artifact=${encodeURIComponent(name)}&format=download&sessionId=${encodeURIComponent(String(owner.id))}`,url),{headers:{cookie}}));
  assert.equal(download.status,200,await download.clone().text());const bytes=Buffer.from(await bounded(`HTTP artifact bytes ${name}`,download.arrayBuffer()));assert.equal(value.facts.ref.bytes,bytes.length);assert.equal(createHash('sha256').update(bytes).digest('hex'),artifact.sha256);
  if(name==='engineering-package')assert.equal(value.facts.text,undefined,'binary package exposes metadata rather than invented text');
  if(name==='final-report'){assert.equal(value.facts.text,bytes.toString('utf8'));assert.equal(value.facts.truncated,false);assert.match(bytes.toString('utf8'),new RegExp(`Goal met: ${mode==='clear'}`));}
  else {
   const target=path.join(admin,'download.tar.gz'),unpacked=path.join(admin,'downloaded-engineering');await writeFile(target,bytes);await mkdir(unpacked);
   const extracted=spawnSync('tar',['-xzf',target,'-C',unpacked],{encoding:'utf8'});assert.equal(extracted.status,0,extracted.stderr);
   const report=JSON.parse(await readFile(path.join(campaign,'state/engineering-result.json'),'utf8'));
   const files=[`${report.selected.checkpoint.path}/design.data`,...report.artifacts.scripts.map((ref:any)=>ref.path),...report.artifacts.nativeTrace.map((ref:any)=>ref.path),
    report.artifacts.logicalEco.path,report.artifacts.physicalEco.path,...['before','after'].flatMap(phase=>['setup','hold'].map(check=>report.measurements[phase][check].report.path))];
   for(const required of files)assert.deepEqual(await readFile(path.join(unpacked,required)),await readFile(path.join(campaign,required)),`Downloaded package reconstructs ${required}`);
  }
 }
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry',mode+'-task-delivery-proof.json'),JSON.stringify({...businessProof,publicInspect:true,publicDownloads:2,downloadedPackageReconstructed:true,elapsedMs:Date.now()-startedAt},null,2));
 await until('automatic report/archive delivery',async()=>{if((await readers.readRunAssets(runId)).kind==='read')return true;const diagnostics=await runtime.store.orderedFlowFacts(runId,'delivery-diagnostic:');if(diagnostics.length)throw new Error('Automatic delivery refused: '+JSON.stringify(diagnostics.at(-1).value));return false;});
 assert.equal((await bounded<ReadExperienceResult>('automatic experience read',service.readExperience(runId))).kind,'read');
 process.send?.({ok:true,mode,runId,hostStarts:1,privatePostgres:1,productModelCalls:0,sshCalls:0,edaCalls:0,tasks:5,goalState:view.run.goalState,broaderUnknown:4,readerJobs:1,engineeringJobs:1,messageIdentity:true,elapsedMs:Date.now()-startedAt});
} catch(error){
 const proof:any={mode,runId,lastAwait:currentAwait,error:String(error),elapsedMs:Date.now()-startedAt};
 if(runId&&host) {
  const runtime=host.ctx.hima.durable;
  const diagnostic=async(label:string,read:()=>Promise<any>)=>{try{return await bounded('diagnostic '+label,read(),2000,false);}catch(error){return {unavailable:String(error)};}};
  const facts=await Promise.allSettled([
   diagnostic('flow',async()=>{const flow=await readFlow(runtime,runId);return {run:{runId:flow.run.runId,owner:flow.run.owner,epoch:flow.run.epoch,revision:flow.run.revision,deadlineAt:flow.run.deadlineAt,cancelled:flow.run.cancelled,hold:flow.run.hold},
    tasks:flow.tasks.map((task:any)=>({identity:task.identity,state:task.state,valid:task.valid,result:task.result?{goalMet:task.result.value?.goalMet,artifacts:task.result.artifacts}:null})),
    workflow:flow.workflow&&{status:flow.workflow.status,error:flow.workflow.error},resources:flow.resources.map((lease:any)=>({effectId:lease.effectId,released:lease.released,claim:lease.claim})),
    effects:flow.effects.map((effect:any)=>({identity:effect.identity,phase:effect.phase,dispatches:effect.dispatches})),stopped:flow.stopped};}),
   diagnostic('message',async()=>{const workflow=messageWorkflowId?await DBOS.getWorkflowStatus(messageWorkflowId):null;return {workflow:workflow&&{status:workflow.status,error:workflow.error,outputPresent:workflow.output!==undefined},result:await runtime.store.flowFact(runId,'task-message-result:resident-business-message')};}),
   diagnostic('delivery',()=>runtime.store.orderedFlowFacts(runId,'delivery-diagnostic:')),
  ]);
  proof.facts=facts.map(result=>result.status==='fulfilled'?result.value:{unavailable:String(result.reason)});
  const run=await diagnostic('opening workspace',()=>runtime.store.run(runId));
  const campaign=run.opening?.data?.product?.workspace;
  if(typeof campaign==='string') {
   const {readdir}=await import('node:fs/promises');
   proof.logs={};for(const name of await readdir(campaign).catch(()=>[]))if(/^hima-effect-.*\.log$/.test(name))proof.logs[name]=(await readFile(path.join(campaign,name),'utf8').catch(error=>String(error))).slice(-12000);
  }
 }
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry',`${mode}-${runId??'startup'}-failure.json`),JSON.stringify(proof,null,2).replace(/([?&]token=)[^\s&]+/g,'$1[redacted]'));
 process.send?.({ok:false,...proof,stack:(error as Error).stack});process.exitCode=1;
}
finally{await writeFile(gate,'cleanup release\n').catch(()=>{});if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
function exists(file:string){return access(file).then(()=>true,()=>false);}
async function until(label:string,probe:()=>Promise<boolean>){
 console.log('U8 await: '+label);const end=Math.min(Date.now()+60000,startedAt+75000);
 while(Date.now()<end){if(await bounded(label,probe(),Math.min(5000,end-Date.now()),false)){console.log('U8 done: '+label);return;}await new Promise(resolve=>setTimeout(resolve,50));}
 throw new Error(`Proof deadline: ${label}`);
}
async function bounded<T>(label:string,read:Promise<T>,milliseconds=15000,announce=true):Promise<T>{
 currentAwait=label;if(announce)console.log('U8 await: '+label);let timer:ReturnType<typeof setTimeout>|undefined;
 try {const value=await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Await exceeded ${milliseconds}ms: ${label}`)),milliseconds);})]);if(announce)console.log('U8 done: '+label);return value;}
 finally{if(timer)clearTimeout(timer);}
}
