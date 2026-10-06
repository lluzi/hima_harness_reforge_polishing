// @hima-seam agent wrapped
// The libinsight-analysis Pack through the actual Host/PG/resident wrapper/Reader. Only the native
// ACP engineer is a stand-in (it runs the Pack's verified example script); no model is called.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,realpath,cp,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {bootInProcess,createRootAgent} from './boot-inprocess.ts';
import type {StartRunResult} from '@hima/harness';
import {prepareHimaHome,himaHomeSources} from '../../../packages/desktop/src/hima-home.ts';
import {repoRoot} from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify}=require('yaml');
const home=await realpath(process.argv[2]!),mode=process.argv[3]??'clean';
const startedAt=Date.now(),packId='libinsight-analysis',requestId=mode==='repair'?'req-20261005130000-repair':'req-20261005130000-clean1';
const fixture=path.join(repoRoot,'test/fixtures/libinsight-resident-dry');
const packTests=path.join(repoRoot,'packs',packId,'flow/tests');
const packageDir=path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {createDurableViewReaders}=await load('durable-views');
const workspace=path.join(home,'workspace'),packsDir=path.join(home,'hima/packs'),sitesDir=path.join(home,'hima/sites');
const admin=path.join(workspace,'admin'),requests=path.join(workspace,'requests'),library=path.join(workspace,'library');
const corpus=path.join(workspace,'corpus'),modeFile=path.join(admin,'empyrean-license-mode');
const evidence=path.join(repoRoot,'.hima-tmp/libinsight-r1');
for(const dir of [workspace,admin,requests,path.join(corpus,'saed14'),sitesDir,evidence])await mkdir(dir,{recursive:true});
await cp(path.join(repoRoot,'packs',packId),path.join(packsDir,packId),{recursive:true,filter:p=>!p.includes('__pycache__')});
// Synthetic facts in the extractor's exact shape; facts mode needs no licence, so the mode stays XTop.
const facts=path.join(corpus,'saed14','synthetic_saed14rvt_tt.json.gz');
const made=spawnSync('python3',['-c',`import sys;sys.path.insert(0,${JSON.stringify(packTests)});import synthetic;synthetic.write_facts(${JSON.stringify(facts)})`],{encoding:'utf8'});
assert.equal(made.status,0,made.stderr);
await writeFile(modeFile,'old\n');
const requestFile=path.join(requests,`${requestId}.json`);
const question='How does SAED14 inverter cell_rise delay scale with drive strength at one fixed load?';
await writeFile(requestFile,JSON.stringify({schema:'hima-libinsight-request/1',requestId,question,sources:[facts],buildsOn:[],createdAt:'2026-10-05T13:00:00Z'}));
const wrapper=path.join(repoRoot,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
const native=path.join(fixture,'acp.py'),capability=path.join(admin,'capability.json'),prompts=path.join(admin,'prompts.jsonl');
await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',
 wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},
 sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},
 environment:{inherit:[],set:{LIA_DRY_CASE:mode,LIA_DRY_PROMPTS:prompts},toolPaths:[],credentialReadPaths:[]},
 delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,path.join(repoRoot,'sites/linglong-atcs28/templates'),fixture],allowedWriteRoots:[workspace],
 allowedWrappers:['python3','/usr/bin/python3',wrapper],forbidden:['services','network','downloads','deletions','licences']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:path.join(workspace,'campaigns'),permit:'./local.permit.yml',
 bindings:{workspaceRoot:path.join(workspace,'campaigns'),analysisRequest:path.join(requests,'unset.json'),analysisRequests:requests,analysisLibrary:library,
  factsCorpus:corpus,engineeringCapabilities:capability,licenceModeFile:modeFile,sourceReadRoots:workspace},
 capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{'QuaLib-2026-new-59099':1}}}));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';process.env.HIMA_RESIDENT_TESTING='1';
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const prepared=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:prepared.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any,runId:string|undefined;
try {
 host=await bounded('boot Host',bootInProcess(h,{withWebApp:false}),45000);const service=host.ctx.hima,runtime=service.durable;
 const readers=createDurableViewReaders({ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()});
 const owner=await createRootAgent(host.ctx,workspace);
 // The Host's path: write the request file, then prepare/start with the per-Run input override.
 const overrides={inputs:{analysisRequest:requestFile}};
 const opening=await bounded<StartRunResult>('public startRun',service.startRun({pack:packId,site:'local',test:true,goal:{admitted_analyses:1},inputs:overrides.inputs,overrides,ownerSessionId:String(owner.id),timeBoxMs:900000}),15000);
 assert.ok(opening.kind==='ran'||opening.kind==='preparing',JSON.stringify(opening));runId=opening.run.id;assert.ok(runId);
 const campaign=opening.workspace;assert.ok(campaign);
 let view:any;
 await until('four tasks complete',async()=>{view=await readers.readRunView(runId);return view.tasks.filter((task:any)=>task.result).length===4&&String(view.run.status).startsWith('ended');});
 const tasks=view.tasks.filter((task:any)=>task.current&&task.result);
 assert.deepEqual(tasks.map((task:any)=>task.taskId).sort(),['admit-analysis','custom-analysis','deliver','prepare-request']);
 for(const task of tasks)assert.equal(task.projection.state,'succeeded',JSON.stringify(task.projection));
 const byId=(id:string)=>tasks.find((task:any)=>task.taskId===id);
 assert.equal(byId('prepare-request').result.value.requestId,requestId);
 assert.equal(byId('prepare-request').result.value.question,question);
 const observation=byId('custom-analysis').result.value.observations[0];
 assert.equal(observation.outputName,'analysisResult');
 assert.equal(observation.values.find((value:any)=>value.type==='li_analysis_error_count').value,0);
 assert.equal(observation.values.find((value:any)=>value.type==='li_analysis_plot_count').value,5);
 const admission=byId('admit-analysis').result.value;
 assert.equal(admission.admitted,true);assert.equal(admission.reused,false);
 const target=path.join(library,'saed14-inv-drive-delay','v1');assert.equal(admission.path,target);
 assert.deepEqual((await readdir(target)).sort(),['admission.json','analysis','analysis-result.json']);
 assert.deepEqual(await readdir(path.join(target,'analysis')),['inv_drive_delay.py']);
 const retained=await readFile(observation.retainedPath);
 assert.equal(createHash('sha256').update(retained).digest('hex'),observation.contentSha256,'Host retained the exact Reader input bytes');
 assert.deepEqual(await readFile(path.join(target,'analysis-result.json')),retained,'admitted result is the Reader-accepted bytes');
 const final=byId('deliver');assert.equal(final.result.value.goalMet,true);assert.equal(view.run.goalState,'met');
 assert.ok(final.result.artifacts.some((ref:any)=>ref.name==='final-report'));
 const report=await readFile(path.join(campaign,'delivery/REPORT.md'),'utf8');assert.match(report,/Admitted: saed14-inv-drive-delay@1/);
 const promptRows=(await readFile(prompts,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const records=await readers.readRunRecords(runId,'job'),launched=records.filter((record:any)=>record.event==='launched');
 const engineeringJobs=launched.filter((record:any)=>record.job.name==='engineering-custom-analysis').length;
 const readerJobs=launched.filter((record:any)=>record.job.name==='reader-libinsight-analysis').length;
 assert.equal(engineeringJobs,1,JSON.stringify(launched.map((record:any)=>record.job.name)));
 if(mode==='repair'){
  assert.equal(readerJobs,2,'one rejected and one accepted Reader');
  assert.equal(promptRows.length,2);assert.equal(promptRows[1].readerRejected,true);
  assert.match(String(promptRows[1].problems),/^REJECTED delivery [0-9a-f]{64}\n- code\.main\.sha256 0{64} is not sha256\(code\.main\.text\)/);
 } else {assert.equal(readerJobs,1);assert.equal(promptRows.length,1);}
 const proof={ok:true,mode,runId,tasks:4,readerJobs,engineeringJobs,prompts:promptRows.length,admitted:target,goalState:view.run.goalState,productModelCalls:0,sshCalls:0,elapsedMs:Date.now()-startedAt};
 await writeFile(path.join(evidence,`${mode}-proof.json`),JSON.stringify(proof,null,2));
 process.send?.(proof);
} catch(error){
 const proof:any={ok:false,mode,runId,error:String(error),stack:(error as Error).stack,elapsedMs:Date.now()-startedAt};
 const campaignsDir=path.join(workspace,'campaigns');
 proof.logs={};
 for(const name of await readdir(campaignsDir).catch(()=>[] as string[])){
  const dir=path.join(campaignsDir,name);
  for(const file of await readdir(dir).catch(()=>[] as string[]))if(/^hima-effect-.*\.log$/.test(file))proof.logs[`${name}/${file}`]=(await readFile(path.join(dir,file),'utf8').catch(e=>String(e))).slice(-6000);
 }
 if(runId&&host)proof.view=await host.ctx.hima.durable.store.run(runId).then((run:any)=>({cancelled:run.cancelled,hold:run.hold})).catch((e:any)=>String(e));
 await writeFile(path.join(evidence,`${mode}-failure.json`),JSON.stringify(proof,null,2).replace(/([?&]token=)[^\s&]+/g,'$1[redacted]'));
 process.send?.(proof);process.exitCode=1;
}
finally{if(runId)await host?.ctx.hima.cancelRun(runId).catch(()=>{});await host?.dispose();}
async function until(label:string,probe:()=>Promise<boolean>){
 const end=Math.min(Date.now()+70000,startedAt+85000);
 while(Date.now()<end){if(await bounded(label,probe(),Math.min(5000,Math.max(1,end-Date.now())))) return;await new Promise(resolve=>setTimeout(resolve,100));}
 throw new Error(`Proof deadline: ${label}`);
}
async function bounded<T>(label:string,read:Promise<T>,milliseconds=15000):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([read,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Await exceeded ${milliseconds}ms: ${label}`)),milliseconds);})]);}
 finally{if(timer)clearTimeout(timer);}
}
