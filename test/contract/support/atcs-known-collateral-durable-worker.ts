// @hima-seam agent wrapped
// Normal frozen ATCS Pack through the public startRun → DBOS route, actual Host/PG/wrapper/Reader, as
// atcs-resident-durable-worker.ts. Only the vendor/model engineer is a stand-in: acp-known-collateral.py
// (acp.py with hashed collateral fail-reason tables instead of UNKNOWN). Timing clears; the selected
// state has one more transition finding than common R1.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,access,realpath,cp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bootInProcess,createRootAgent} from './boot-inprocess.ts';
import type {StartRunResult,ReadExperienceResult} from '@hima/harness';
import {prepareHimaHome,himaHomeSources} from '../../../packages/desktop/src/hima-home.ts';
import {repoRoot} from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify}=require('yaml');
const home=await realpath(process.argv[2]!),startedAt=Date.now(),packId='agentic-timing-closure-system';
const fixture=path.join(repoRoot,'test/fixtures/atcs-resident-dry'),packageDir=path.join(repoRoot,'packages/harness');
const {createDurableViewReaders}=await import(pathToFileURL(path.join(packageDir,'lib/durable-views.js')).href);
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const inputRoot=path.join(workspace,'inputs'),admin=path.join(workspace,'admin');
for(const dir of [workspace,admin,sitesDir])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
const preparedInputs=spawnSync('python3',[path.join(fixture,'prepare.py'),inputRoot],{encoding:'utf8'});
assert.equal(preparedInputs.status,0,preparedInputs.stderr);
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp-known-collateral.py'),capability=path.join(admin,'capability.json'),gate=path.join(admin,'initial-prompt-gate'),prompts=path.join(admin,'prompts.jsonl');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:[],set:{ATCS_DRY_CASE:'clear',ATCS_DRY_GATE:gate,ATCS_DRY_PROMPTS:prompts},toolPaths:[],credentialReadPaths:[]},
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
let host:any,runId:string|undefined;
const exists=(file:string)=>access(file).then(()=>true,()=>false);
async function until(label:string,probe:()=>Promise<boolean>){
 const end=Date.now()+75000;
 while(Date.now()<end){if(await probe())return;await new Promise(resolve=>setTimeout(resolve,50));}
 throw new Error(`Proof deadline: ${label}`);
}
try {
 host=await bootInProcess(h);const service=host.ctx.hima,runtime=service.durable;
 const readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const owner=await createRootAgent(host.ctx,workspace);
 const opening:StartRunResult=await service.startRun({pack:packId,site:'local',test:true,goal:{target_setup_wns_ns:0,target_hold_wns_ns:0},strategy:{nativeReportPaths:10000},ownerSessionId:String(owner.id),timeBoxMs:1800000});
 assert.ok(opening.kind==='ran'||opening.kind==='preparing',JSON.stringify(opening));runId=opening.run.id;
 await until('native engineering evidence written',()=>exists(gate+'.ready'));
 await writeFile(gate,'release initial native prompt\n');
 let view:any;
 await until('five ATCS tasks complete',async()=>{view=await readers.readRunView(runId);return view.tasks.filter((task:any)=>task.result).length===5&&String(view.run.status).startsWith('ended');});
 const tasks=view.tasks.filter((task:any)=>task.current&&task.result);
 for(const task of tasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 const evaluation=tasks.find((task:any)=>task.taskId==='evaluate-timing').result.value,final=tasks.find((task:any)=>task.taskId==='deliver');
 const report=await readFile(path.join(opening.workspace!,'delivery/REPORT.md'),'utf8');
 await until('automatic report/archive delivery',async()=>(await readers.readRunAssets(runId)).kind==='read');
 const experience:ReadExperienceResult=await service.readExperience(runId);
 process.send?.({ok:true,runId,goalState:view.run.goalState,status:view.run.status,goalMet:final.result.value.goalMet,
  evaluationGoalMet:evaluation.goalMet,timing:evaluation.timing,collateral:final.result.value.collateral,
  reportGoalLine:/Goal met: (true|false)/.exec(report)?.[0],reportCollateral:report.slice(report.indexOf('Collateral')),
  experience:experience.kind,productModelCalls:0,elapsedMs:Date.now()-startedAt});
} catch(error){
 let facts:unknown;
 if(runId&&host)facts=await host.ctx.hima.readExecutionContext(runId).then((context:any)=>({status:context.run.status,outcome:context.durable?.outcome&&{state:context.durable.outcome.state,reason:context.durable.outcome.reason},
  tasks:context.durable?.tasks?.map((task:any)=>({id:task.identity.taskId,state:task.state}))})).catch((cause:unknown)=>String(cause));
 process.send?.({ok:false,runId,error:String(error),stack:(error as Error).stack,facts,elapsedMs:Date.now()-startedAt});process.exitCode=1;
}
finally{await writeFile(gate,'cleanup release\n').catch(()=>{});if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
