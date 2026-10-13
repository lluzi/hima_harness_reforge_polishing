// @hima-seam agent wrapped
// Normal frozen mage-script-placement Pack, actual Host/PG/wrapper/Reader. Only the MAGE native
// executable and the resident Engineer ACP are stand-ins (test/fixtures/mage-script-dry/
// {prepare.py,acp.py}), exactly as the mage-scribe-placement Pack's own durable dry route does.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access,realpath,cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bootInProcess,createRootAgent,type InProcessHost} from './boot-inprocess.ts';
import type {StartRunResult} from '@hima/harness';
import {prepareHimaHome,himaHomeSources} from '../../../packages/desktop/src/hima-home.ts';
import {repoRoot} from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify}=require('yaml');
const home=await realpath(process.argv[2]!),mode=process.argv[3]??'converge';
const startedAt=Date.now(),packId='mage-script-placement';
const fixture=path.join(repoRoot,'test/fixtures/mage-script-dry');
const packageDir=process.env.HIMA_U8_DRY_PACKAGE??path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {createDurableViewReaders}=await load('durable-views');
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const inputRoot=path.join(workspace,'inputs'),admin=path.join(workspace,'admin');
for(const dir of [workspace,admin,sitesDir])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
const prepared=spawnSync('python3',[path.join(fixture,'prepare.py'),inputRoot],{encoding:'utf8'});
assert.equal(prepared.status,0,prepared.stderr);
const [manifestPath,siteCapabilitiesPath]=prepared.stdout.trim().split('\n');
assert.ok(manifestPath&&siteCapabilitiesPath,prepared.stdout);
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp.py'),capability=path.join(admin,'capability.json');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.0.0',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:[],set:{MAGE_SCRIPT_DRY_CASE:mode},toolPaths:[],credentialReadPaths:[]},
 delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({
 allowedReadRoots:[workspace,path.join(repoRoot,'sites/linglong-atcs28/templates'),fixture,path.join(repoRoot,'packs',packId,'flow')],
 allowedWriteRoots:[workspace],
 allowedWrappers:['python3','/usr/bin/python3',wrapper],forbidden:['services','network','downloads','deletions','licences']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',
 bindings:{workspaceRoot:workspace,mageCaseManifest:manifestPath,siteCapabilities:siteCapabilitiesPath,engineeringCapabilities:capability},
 // parallelJobs:2, not 1: each resident task's retained engineering job stays alive (holding one
 // job slot) until its own release() completes right after its result is collected, but collecting
 // that result itself launches a second, concurrent job -- the output's own Reader
 // (reader-mage-script-candidate). With parallelJobs:1 that Reader job is refused with reason
 // site-capacity and the whole repeat stalls forever on round 1.
 capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{mage:1}}}));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';process.env.HIMA_RESIDENT_TESTING='1';
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const preparedHome=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:preparedHome.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any,readers:any,runId:string|undefined,currentAwait='startup';
try {
 host=await bounded('boot Host',bootInProcess(h,{withWebApp:true}),45000);const service=host.ctx.hima,runtime=service.durable;
 readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const owner=await createRootAgent(host.ctx,workspace);
 const opening=await bounded<StartRunResult>('public startRun',service.startRun({pack:packId,site:'local',test:true,
  goal:{target_dropped_count:0,max_target_distance_um:100,max_order_deviation_lr:2,max_order_deviation_tb:1,max_priority_move_um:200},
  strategy:{incumbentComparison:'retained'},
  ownerSessionId:String(owner.id),timeBoxMs:1800000}),15000);
 assert.ok(opening.kind==='ran'||opening.kind==='preparing',JSON.stringify(opening));runId=opening.run.id;assert.ok(runId);
 await until('run ended',async()=>{const view=await readers.readRunView(runId);return !!view&&String(view.run.status).startsWith('ended');});
 const view=await readers.readRunView(runId);
 const resultTasks=view.tasks.filter((task:any)=>task.current&&task.result);
 const tasksById=new Map<string,any>(resultTasks.map((task:any)=>[task.taskId,task]));
 for(const taskId of ['prepare-case','measure-incumbent','evaluate-placement','deliver'])assert.ok(tasksById.has(taskId),`missing task ${taskId}`);
 for(const task of resultTasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 const rounds=resultTasks.filter((task:any)=>task.taskId==='decide-round').length;
 const expectedTasks=2+rounds*2+2;
 assert.equal(resultTasks.length,expectedTasks,`expected ${expectedTasks} task executions for ${rounds} round(s); got ${resultTasks.length}`);
 // Every resident task's committed Reader observation must be clean (C1): the Reader fails closed
 // on refusal, so a dry route that admits a delivery must carry mage_candidate_error_count == 0 on
 // every reader-mage-script-candidate reading. A broken Reader would otherwise slip through unnoticed.
 const dirtyReaders:any[]=[];
 let readerReadingsSeen=0;
 for(const task of resultTasks){
  let value=task.result?.value;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{value=undefined;}}
  const observations=Array.isArray(value?.observations)?value.observations:[];
  for(const observation of observations){
   const values=Array.isArray(observation?.values)?observation.values:[];
   for(const fact of values){
    if(fact?.type==='mage_candidate_error_count'){
     readerReadingsSeen+=1;
     if(fact.value!==0)dirtyReaders.push({taskId:task.taskId,value:fact.value});
    }
   }
  }
 }
 assert.ok(readerReadingsSeen>=rounds,`expected at least ${rounds} reader readings; saw ${readerReadingsSeen}`);
 assert.equal(dirtyReaders.length,0,`every reader-mage-script-candidate reading must report error_count 0: ${JSON.stringify(dirtyReaders)}`);
 const deliver=tasksById.get('deliver');
 const deliverValue=deliver.result.value;
 const records=await readers.readRunRecords(runId,'job'),launched=records.filter((record:any)=>record.event==='launched');
 const engineeringJobs=launched.filter((record:any)=>record.job.name==='engineering-engineer-script').length;
 const readerJobs=launched.filter((record:any)=>record.job.name==='reader-mage-script-candidate').length;
 // `resultTasks` is not round-ordered; the one decide-round execution whose own route is "stop"
 // (there is exactly one per Run) is this Run's final decision.
 const decideRoundTasks=resultTasks.filter((task:any)=>task.taskId==='decide-round');
 const finalDecision=decideRoundTasks.map((task:any)=>task.result.value).find((value:any)=>value.route==='stop');
 const proof={mode,runId,tasks:resultTasks.length,rounds,readerJobs,engineeringJobs,productModelCalls:0,
  goalState:view.run.goalState,goalMet:deliverValue.goalMet,proofLevel:deliverValue.proofLevel,
  journalEntries:Number(finalDecision?.journalEntries??NaN),elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry',`mage-script-${mode}-proof.json`),JSON.stringify({...proof,rules:deliverValue.rules},null,2));
 console.log('mage-script dry phase: '+JSON.stringify(proof));
 process.send?.({ok:true,...proof});
} catch(error){
 const proof:any={mode,runId,lastAwait:currentAwait,error:String(error),elapsedMs:Date.now()-startedAt};
 if(runId&&host) {
  const runtime=host.ctx.hima.durable;
  const diagnostic=async(label:string,read:()=>Promise<any>)=>{try{return await bounded('diagnostic '+label,read(),2000,false);}catch(error){return {unavailable:String(error)};}};
  const facts=await Promise.allSettled([
   diagnostic('view',async()=>{const view=await readers.readRunView(runId);return view&&{status:view.run.status,goalState:view.run.goalState,
    tasks:view.tasks.map((task:any)=>({taskId:task.taskId,current:task.current,state:task.projection?.state,reason:task.projection?.reason,result:task.result?{value:task.result.value}:null}))};}),
   diagnostic('delivery',()=>runtime.store.orderedFlowFacts(runId,'delivery-diagnostic:')),
  ]);
  proof.facts=facts.map(result=>result.status==='fulfilled'?result.value:{unavailable:String(result.reason)});
 }
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry',`mage-script-${mode}-${runId??'startup'}-failure.json`),JSON.stringify(proof,null,2));
 process.send?.({ok:false,...proof,stack:(error as Error).stack});process.exitCode=1;
}
finally{if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
function exists(file:string){return access(file).then(()=>true,()=>false);}
async function until(label:string,probe:()=>Promise<boolean>){
 console.log('mage-script dry await: '+label);const end=Math.min(Date.now()+180000,startedAt+1700000);
 while(Date.now()<end){if(await bounded(label,probe(),Math.min(5000,Math.max(1,end-Date.now())),false)){console.log('mage-script dry done: '+label);return;}await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error(`Proof deadline: ${label}`);
}
async function bounded<T>(label:string,read:Promise<T>,milliseconds=15000,announce=true):Promise<T>{
 currentAwait=label;if(announce)console.log('mage-script dry await: '+label);let timer:ReturnType<typeof setTimeout>|undefined;
 try {const value=await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Await exceeded ${milliseconds}ms: ${label}`)),milliseconds);})]);if(announce)console.log('mage-script dry done: '+label);return value;}
 finally{if(timer)clearTimeout(timer);}
}
void exists;
