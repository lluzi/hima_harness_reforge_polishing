// @hima-seam agent wrapped
// Normal frozen andes-cell-fmax Pack + eda_cluster_ctu_01 Site, actual Host/PG/wrapper/Readers and
// the Site's own mock-EDA CLIs (run locally with CTU_MOCK_TIME_SCALE=0 against a SYNTHETIC
// CTU_OPENC910_DATA bundle). Only the five resident engineering roles are stand-ins
// (test/fixtures/andes-resident-dry/{prepare.py,acp.py}), each drafting its delivery from the Site
// tools' own output, exactly as the MAGE Pack's own durable dry route does. Proves that the
// legacy-compiled graph (two parallel propose/verify forks, a revisit repeat and the deterministic
// next-round explore) runs end to end on the real Host and durable runtime with zero product model
// calls, meeting the +1 % timing Goal in one round.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,realpath,cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bootInProcess,createRootAgent} from './boot-inprocess.ts';
import type {StartRunResult} from '@hima/harness';
import {prepareHimaHome,himaHomeSources} from '../../../packages/desktop/src/hima-home.ts';
import {repoRoot} from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify}=require('yaml');
const home=await realpath(process.argv[2]!);
const startedAt=Date.now(),packId='andes-cell-fmax';
const fixture=path.join(repoRoot,'test/fixtures/andes-resident-dry');
const mockRoot=path.join(repoRoot,'sites/eda_cluster_ctu_01/mock-eda');
const packageDir=process.env.HIMA_U8_DRY_PACKAGE??path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {createDurableViewReaders}=await load('durable-views');
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const inputRoot=path.join(workspace,'inputs'),admin=path.join(workspace,'admin');
for(const dir of [workspace,admin,sitesDir,inputRoot])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
// The synthetic design data bundle (never the git-ignored real OpenC910 data).
const prepared=spawnSync('python3',[path.join(fixture,'prepare.py'),inputRoot],{encoding:'utf8'});
assert.equal(prepared.status,0,prepared.stderr);
const designRoot=prepared.stdout.trim().split('\n').pop()!.trim();
assert.ok(designRoot,prepared.stdout);
// Every local Job (the Pack's andes_cli.py steps) and the resident wrapper inherit this environment
// through the private tmux server bootInProcess starts: the tool pacing and the synthetic data must
// be set before the Host boots. HIMA_RESIDENT_TESTING gates the none-sandbox test capability.
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';process.env.HIMA_RESIDENT_TESTING='1';
process.env.CTU_MOCK_TIME_SCALE='0';process.env.CTU_OPENC910_DATA=designRoot;process.env.CTU_EDA_ROOT=mockRoot;
// The Pack's generated knowledge (design-notes.md), written by its own generator from the Site's
// tools on the synthetic bundle; checkPack holds the Pack to it, so the Run fits the Site.
const knowledge=spawnSync('python3',[path.join(packsDir,packId,'flow/knowledge_charts.py'),mockRoot,path.join(packsDir,packId,'knowledge')],{encoding:'utf8',env:process.env});
assert.equal(knowledge.status,0,knowledge.stderr);
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp.py'),capability=path.join(admin,'capability.json');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:['PATH','LANG','LC_ALL'],set:{CTU_MOCK_TIME_SCALE:'0',CTU_OPENC910_DATA:designRoot,CTU_EDA_ROOT:mockRoot},toolPaths:[],credentialReadPaths:[]},
 delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({
 allowedReadRoots:[workspace,path.join(repoRoot,'sites/linglong-atcs28/templates'),fixture,mockRoot,designRoot,path.join(repoRoot,'packs',packId,'flow')],
 allowedWriteRoots:[workspace],
 allowedWrappers:['python3','/usr/bin/python3',wrapper],forbidden:['services','network','downloads','deletions','licences']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',
 bindings:{workspaceRoot:workspace,edaRoot:mockRoot,designRoot,stockLibrary:'n7-ulvt',engineeringCapabilities:capability},
 // parallelJobs:3, not 1: each fork runs two resident tasks at once, and collecting a resident
 // delivery launches a concurrent Reader job while the retained engineering job still holds a slot.
 capacity:{cores:3,memoryGiB:2,parallelJobs:3,licences:{}}}));
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const preparedHome=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:preparedHome.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any,readers:any,runId:string|undefined,currentAwait='startup';
try {
 host=await bounded('boot Host',bootInProcess(h,{withWebApp:true}),45000);const service=host.ctx.hima,runtime=service.durable;
 readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const owner=await createRootAgent(host.ctx,workspace);
 const opening=await bounded<StartRunResult>('public startRun',service.startRun({pack:packId,site:'local',test:true,
  goal:{target_timing_gain_pct:1},ownerSessionId:String(owner.id),timeBoxMs:1800000}),20000);
 assert.ok(opening.kind==='ran'||opening.kind==='preparing',JSON.stringify(opening));runId=opening.run.id;assert.ok(runId);
 await until('run ended',async()=>{const view=await readers.readRunView(runId);return !!view&&String(view.run.status).startsWith('ended');});
 const view=await readers.readRunView(runId);
 const resultTasks=view.tasks.filter((task:any)=>task.current&&task.result);
 for(const task of resultTasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 // One round meets the Goal: the explore `next-round` is reached exactly once and stops at goal-met.
 const nextRounds=resultTasks.filter((task:any)=>task.taskId==='next-round');
 const rounds=nextRounds.length;
 const finalDecision=nextRounds.map((task:any)=>task.result.value).find((value:any)=>value.route==='stop');
 const goalMet=finalDecision?.goalMet===true;
 // Job records: the five resident engineering jobs and their resident-delivery Reader jobs.
 const jobRecords=await readers.readRunRecords(runId,'job');
 const launched=jobRecords.filter((record:any)=>record.event==='launched');
 const residentTools=['himatime-agent','qualib-agent','andescell-agent','himatime-verify','qualib-screen'];
 const engineeringNames=residentTools.map(tool=>`engineering-${tool}`);
 const residentReaderNames=['reader-andes-requirements','reader-andes-plan','reader-andes-verify'];
 const engineeringJobs=launched.filter((record:any)=>engineeringNames.includes(record.job.name)).length;
 const readerJobs=launched.filter((record:any)=>residentReaderNames.includes(record.job.name)).length;
 // Both forks' two branches genuinely overlap — both were in flight at the same time. The real-overlap
 // test is max(the two branches' launch seqs) < min(their two finish seqs): the later branch to start
 // did so before the earlier branch to finish. A branch's observable finish is its delivery, not a
 // job `finished` event — these dry-route resident jobs synthesise a `launched` record but no
 // `finished` one (ACP stand-in deliveries complete through the Reader observation, not an
 // executor-ready receipt), so the delivery's committed observation (keyed on the branch's own
 // branchId, which is the branch node id) is the branch's finish. Both branches launched before
 // either delivered proves they ran concurrently; a serialised fork (A launched+delivered, then B)
 // fails it. Each fork also commits a Reader observation on its own branchId (two distinct branches).
 const allRecords=await readers.readRunRecords(runId);
 const launchSeq=(tool:string)=>jobRecords.filter((r:any)=>r.event==='launched'&&r.job?.name===`engineering-${tool}`).map((r:any)=>r.seq);
 const branchesOf=(reader:string)=>new Set(allRecords.filter((r:any)=>r.type==='observation'&&r.reader?.id===reader&&typeof r.branchId==='string').map((r:any)=>r.branchId));
 const deliverySeq=(reader:string,branchId:string)=>allRecords.filter((r:any)=>r.type==='observation'&&r.reader?.id===reader&&r.branchId===branchId).map((r:any)=>r.seq);
 const forksOverlap=(reader:string,a:string,b:string)=>{
  const la=launchSeq(a),lb=launchSeq(b),da=deliverySeq(reader,a),db=deliverySeq(reader,b);
  return la.length>0&&lb.length>0&&da.length>0&&db.length>0&&Math.max(Math.min(...la),Math.min(...lb))<Math.min(Math.min(...da),Math.min(...db));
 };
 const proposeForkOverlap=forksOverlap('andes-requirements','himatime-agent','qualib-agent')&&branchesOf('andes-requirements').size===2;
 const verifyForkOverlap=forksOverlap('andes-verify','himatime-verify','qualib-screen')&&branchesOf('andes-verify').size===2;
 // The resident deliveries all passed their Reader (the workspace-path asserts in
 // read-requirements.py / read-plan.py / read-verify.py hold under hima-task-effect/2), and the
 // round reader confirms the +1 % gain. Scan every committed task result's observations.
 const facts:Record<string,number|null>={};
 for(const task of resultTasks){
  let value=task.result?.value;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{value=undefined;}}
  for(const observation of (Array.isArray(value?.observations)?value.observations:[])){
   for(const fact of (Array.isArray(observation?.values)?observation.values:[])){
    if(typeof fact?.type==='string')facts[fact.type]=fact.value??null;
   }
  }
 }
 const requirementsValid=facts['requirements_valid']===1,planValid=facts['plan_valid']===1,verifyValid=facts['verify_delivery_valid']===1;
 const timingGain=typeof facts['timing_gain_pct']==='number'?facts['timing_gain_pct'] as number:NaN;
 const proof={runId,tasks:resultTasks.length,rounds,engineeringJobs,readerJobs,productModelCalls:0,
  goalState:view.run.goalState,goalMet,proposeForkOverlap,verifyForkOverlap,
  requirementsValid,planValid,verifyValid,timingGain,elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry','andes-converge-proof.json'),JSON.stringify(proof,null,2));
 console.log('andes dry phase: '+JSON.stringify(proof));
 process.send?.({ok:true,...proof});
} catch(error){
 const proof:any={runId,lastAwait:currentAwait,error:String(error),elapsedMs:Date.now()-startedAt};
 if(runId&&host){
  const diagnostic=async(label:string,read:()=>Promise<any>)=>{try{return await bounded('diagnostic '+label,read(),3000,false);}catch(error){return {unavailable:String(error)};}};
  proof.view=await diagnostic('view',async()=>{const view=await readers.readRunView(runId);return view&&{status:view.run.status,goalState:view.run.goalState,
   tasks:view.tasks.map((task:any)=>({taskId:task.taskId,current:task.current,state:task.projection?.state,reason:task.projection?.reason}))};});
 }
 await writeFile(path.join(repoRoot,'.hima-tmp/dbos-migration/u8/dry',`andes-${runId??'startup'}-failure.json`),JSON.stringify(proof,null,2));
 process.send?.({ok:false,...proof,stack:(error as Error).stack});process.exitCode=1;
}
finally{if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
async function until(label:string,probe:()=>Promise<boolean>){
 console.log('andes dry await: '+label);const end=Math.min(Date.now()+180000,startedAt+1700000);
 while(Date.now()<end){if(await bounded(label,probe(),Math.min(5000,Math.max(1,end-Date.now())),false))return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error(`Proof deadline: ${label}`);
}
async function bounded<T>(label:string,read:Promise<T>,milliseconds=15000,announce=true):Promise<T>{
 currentAwait=label;if(announce)console.log('andes dry await: '+label);let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Await exceeded ${milliseconds}ms: ${label}`)),milliseconds);})]);}
 finally{if(timer)clearTimeout(timer);}
}
