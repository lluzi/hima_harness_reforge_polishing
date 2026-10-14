// @hima-seam agent wrapped
// Normal frozen pixel-layout-optimization Pack, actual Host/PG/resident wrapper/Reader. Only the EDA
// tools and the resident engineer ACP are stand-ins (test/fixtures/pixel-dry/{prepare.py,acp.py}),
// exactly as the libinsight-analysis and mage-script-placement dry routes do. Proves the whole
// hima-flow/1 graph -- prepare-case -> judge-original -> map-design-space -> learn-sensitivities ->
// repeat(plan-round -> solve-and-judge -> decide-round) -> evaluate -> deliver -- runs on the real
// durable runtime with zero product-model calls, the real resident wrapper and the real pixel-plan
// Reader, ending goal-met.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,realpath,cp,readdir} from 'node:fs/promises';
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
const startedAt=Date.now(),packId='pixel-layout-optimization';
const fixture=path.join(repoRoot,'test/fixtures/pixel-dry');
const packFlow=path.join(repoRoot,'packs',packId,'flow');
const venvRoot=path.join(repoRoot,'.hima-tmp/pixel-dry-venv');
const packageDir=path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {createDurableViewReaders}=await load('durable-views');
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const inputRoot=path.join(workspace,'inputs'),admin=path.join(workspace,'admin');
const evidence=path.join(repoRoot,'.hima-tmp/pixel-dry');
for(const dir of [workspace,admin,inputRoot,sitesDir,evidence])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
// Build the synthetic case and the pinned numeric venv the num-* commands run in; prints the two
// Site-binding paths, one per line.
const prepared=spawnSync('python3',[path.join(fixture,'prepare.py'),inputRoot],{encoding:'utf8'});
assert.equal(prepared.status,0,prepared.stderr);
const [manifestPath,siteCapabilitiesPath]=prepared.stdout.trim().split('\n');
assert.ok(manifestPath&&siteCapabilitiesPath,prepared.stdout);
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp.py'),capability=path.join(admin,'capability.json');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.0.0',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:[],set:{},toolPaths:[],credentialReadPaths:[]},
 delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({
 allowedReadRoots:[workspace,path.join(repoRoot,'sites/linglong-atcs28/templates'),fixture,packFlow,venvRoot],
 allowedWriteRoots:[workspace],
 allowedWrappers:['python3','/usr/bin/python3',wrapper],forbidden:['services','network','downloads','deletions','licences']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',
 bindings:{workspaceRoot:workspace,pixelCaseManifest:manifestPath,siteCapabilities:siteCapabilitiesPath,engineeringCapabilities:capability},
 // parallelJobs:2, not 1: each resident task's retained engineering job stays alive (holding one
 // job slot) until its own release() completes right after its result is collected, but collecting
 // that result itself launches a second, concurrent job -- the output's own Reader (reader-pixel-plan).
 // With parallelJobs:1 that Reader job is refused with reason site-capacity and the repeat stalls
 // forever on round 1.
 capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{fpd:1}}}));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';process.env.HIMA_RESIDENT_TESTING='1';
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const preparedHome=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:preparedHome.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any,readers:any,runId:string|undefined;
try {
 host=await bounded('boot Host',bootInProcess(h,{withWebApp:false}),45000);const service=host.ctx.hima,runtime=service.durable;
 readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const owner=await createRootAgent(host.ctx,workspace);
 // Generous targets with the transmittance window widened (t_max_pct 100), exactly as the Pack's own
 // route test does for its goal-met case: a clean legal candidate meets outline and ratio in round 1.
 const opening=await bounded<StartRunResult>('public startRun',service.startRun({pack:packId,site:'local',test:true,
  goal:{outline_w_um:1000,outline_h_um:1000,ratio_target_pct:1000,load_allowance_pct:5,t_min_pct:0,t_max_pct:100,cst_ceiling_ff:0},
  strategy:{ratioDefinition:'broad',transmittanceBasis:'tiled',extraCsOverlap:'count',topologyMoves:'off',convergeBandPct:0.02},
  ownerSessionId:String(owner.id),timeBoxMs:1800000}),15000);
 assert.ok(opening.kind==='ran'||opening.kind==='preparing',JSON.stringify(opening));runId=opening.run.id;assert.ok(runId);
 const campaign=opening.workspace;
 await until('run ended',async()=>{const view=await readers.readRunView(runId);return !!view&&String(view.run.status).startsWith('ended');});
 const view=await readers.readRunView(runId);
 const resultTasks=view.tasks.filter((task:any)=>task.current&&task.result);
 const countById=(id:string)=>resultTasks.filter((task:any)=>task.taskId===id).length;
 for(const taskId of ['prepare-case','judge-original','map-design-space','learn-sensitivities','evaluate','deliver'])
  assert.equal(countById(taskId),1,`task ${taskId} must run exactly once`);
 for(const task of resultTasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 const rounds=countById('decide-round');
 assert.ok(rounds>=1,`expected at least one round; got ${rounds}`);
 assert.equal(countById('plan-round'),rounds,'one plan-round per round');
 assert.equal(countById('solve-and-judge'),rounds,'one solve-and-judge per round');
 const expectedTasks=6+rounds*3;
 assert.equal(resultTasks.length,expectedTasks,`expected ${expectedTasks} task executions for ${rounds} round(s); got ${resultTasks.length}`);
 // Every resident plan-round's committed Reader observation must be clean: the pixel-plan Reader
 // fails closed, so a dry route that admits a plan must carry pixel_plan_error_count == 0 on every
 // reading. A broken Reader would otherwise slip through unnoticed.
 const dirtyReaders:any[]=[];let readerReadingsSeen=0;
 for(const task of resultTasks){
  let value=task.result?.value;
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{value=undefined;}}
  const observations=Array.isArray(value?.observations)?value.observations:[];
  for(const observation of observations)for(const fact of (Array.isArray(observation?.values)?observation.values:[]))
   if(fact?.type==='pixel_plan_error_count'){readerReadingsSeen+=1;if(fact.value!==0)dirtyReaders.push({taskId:task.taskId,value:fact.value});}
 }
 assert.ok(readerReadingsSeen>=rounds,`expected at least ${rounds} reader readings; saw ${readerReadingsSeen}`);
 assert.equal(dirtyReaders.length,0,`every pixel-plan reading must report error_count 0: ${JSON.stringify(dirtyReaders)}`);
 const records=await readers.readRunRecords(runId,'job'),launched=records.filter((record:any)=>record.event==='launched');
 const engineeringJobs=launched.filter((record:any)=>record.job.name==='engineering-plan-round').length;
 const readerJobs=launched.filter((record:any)=>record.job.name==='reader-pixel-plan').length;
 assert.equal(engineeringJobs,rounds,'one resident engineering job per round');
 assert.equal(readerJobs,rounds,'one pixel-plan Reader job per round');
 const evaluateValue=resultTasks.find((task:any)=>task.taskId==='evaluate').result.value;
 const deliverValue=resultTasks.find((task:any)=>task.taskId==='deliver').result.value;
 assert.equal(evaluateValue.ending,'goal-met',JSON.stringify(evaluateValue));
 assert.equal(evaluateValue.goalMet,true,JSON.stringify(evaluateValue));
 assert.equal(deliverValue.ending,'goal-met',JSON.stringify(deliverValue));
 assert.equal(deliverValue.goalMet,true,JSON.stringify(deliverValue));
 assert.equal(view.run.goalState,'met',JSON.stringify(view.run.goalState));
 if(campaign){const report=await readFile(path.join(campaign,'delivery/REPORT.md'),'utf8').catch(()=>'');assert.match(report,/Goal met: \*\*True\*\*/);}
 const proof={ok:true,runId,tasks:resultTasks.length,rounds,readerJobs,engineeringJobs,productModelCalls:0,
  goalState:view.run.goalState,ending:deliverValue.ending,goalMet:deliverValue.goalMet,elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(evidence,'pixel-dry-proof.json'),JSON.stringify({...proof,rules:evaluateValue.rules},null,2));
 console.log('pixel dry phase: '+JSON.stringify(proof));
 process.send?.(proof);
} catch(error){
 const proof:any={ok:false,runId,error:String(error),stack:(error as Error).stack,elapsedMs:Date.now()-startedAt};
 const campaignsDir=path.join(workspace,'campaigns');proof.logs={};
 for(const name of await readdir(campaignsDir).catch(()=>[] as string[])){
  const dir=path.join(campaignsDir,name);
  for(const file of await readdir(dir).catch(()=>[] as string[]))if(/^hima-effect-.*\.log$/.test(file))proof.logs[`${name}/${file}`]=(await readFile(path.join(dir,file),'utf8').catch(e=>String(e))).slice(-6000);
 }
 if(runId&&host){try{const v=await readers.readRunView(runId);proof.view={status:v?.run?.status,goalState:v?.run?.goalState,
  tasks:v?.tasks?.map((task:any)=>({taskId:task.taskId,current:task.current,state:task.projection?.state,reason:task.projection?.reason}))};}catch(e){proof.view=String(e);}}
 await writeFile(path.join(evidence,`pixel-dry-${runId??'startup'}-failure.json`),JSON.stringify(proof,null,2));
 process.send?.(proof);process.exitCode=1;
}
finally{if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
async function until(label:string,probe:()=>Promise<boolean>){
 const end=Math.min(Date.now()+1500000,startedAt+1700000);
 while(Date.now()<end){if(await bounded(label,probe(),Math.min(5000,Math.max(1,end-Date.now())),false))return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error(`Proof deadline: ${label}`);
}
async function bounded<T>(label:string,read:Promise<T>,milliseconds=15000,announce=true):Promise<T>{
 if(announce)console.log('pixel dry await: '+label);let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Await exceeded ${milliseconds}ms: ${label}`)),milliseconds);})]);}
 finally{if(timer)clearTimeout(timer);}
}
