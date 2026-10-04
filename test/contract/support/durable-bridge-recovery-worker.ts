import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../../../',import.meta.url)),at=(name:string)=>import(pathToFileURL(path.join(process.env.HIMA_DBOS_TEST_LIB??path.join(root,'packages/harness/lib'),name+'.js')).href),require=createRequire(path.join(root,'packages/harness/package.json')),{stringify}=require('yaml');
const {startLocalDatabase}=await at('local-database'),{startDurableRuntime}=await at('durable-runtime'),{flowWorkflowDefinitions,startFlow}=await at('flow-workflow'),{resolveDurableTaskAdapter}=await at('durable-task-adapters'),{jsonDigest}=await at('run-store'),{taskEffectAdapterVersion}=await at('task-effects'),{loadPack}=await at('packs'),{loadSite}=await at('sites');
const home=await realpath(process.argv[2]!),mode=process.argv[3],workspace=path.join(home,'workspace'),sitesDir=path.join(home,'sites'),dir=path.join(home,'packs/recovery-method');
if(mode==='seed'){
 for(const folder of [workspace,sitesDir,path.join(dir,'tools')])await mkdir(folder,{recursive:true});
 await writeFile(path.join(workspace,'run.sh'),'printf "once\\n" >> "$1/calls"\n');await writeFile(path.join(dir,'tools/run.sh'),await readFile(path.join(workspace,'run.sh')));
 await writeFile(path.join(dir,'contract.yml'),stringify({id:'recovery-method',version:'1',title:'Actual bridge recovery',inputs:[{name:'workspaceRoot'}],outputs:[],strategy:{mode:{type:'choice',options:['fixture'],default:'fixture'}},environment:{wrappers:['/bin/sh']},workspace:{copy:[]},tools:[{id:'run',file:'tools/run.sh',inputs:['WORKSPACE'],argv:['/bin/sh','${WORKSPACE}/run.sh','${WORKSPACE}']}]}));
 await writeFile(path.join(dir,'graph.yml'),stringify({id:'recovery-method',version:'1',entry:'run',nodes:[{id:'run',kind:'act',parameters:{tool:'run'}}],edges:[]}));
 await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,dir],allowedWriteRoots:[workspace],allowedWrappers:['/bin/sh'],forbidden:['services','licences','network','deletions','downloads']}));await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:1,memoryGiB:1,parallelJobs:1,licences:{}}}));
 await writeFile(path.join(home,'flow.json'),JSON.stringify(loadPack(path.dirname(dir),'recovery-method').flow));
}
const flow=JSON.parse(await readFile(path.join(home,'flow.json'),'utf8')),database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});let runtime:any;
try{
 runtime=await startDurableRuntime({database,manifest:{files:{bridge:'6'.repeat(64)},adapters:{bridge:taskEffectAdapterVersion}},workflows:flowWorkflowDefinitions({resolveAdapter:async(context:any)=>{
  const adapter=await resolveDurableTaskAdapter(context,{ctx:{} as any,sitesDir,retainedMaterialsDir:path.join(home,'retained')});
  if(mode==='seed'){const fact=await runtime.store.fact(`hima-fact:${jsonDigest(['flow-fact','bridge-recovery','product-method:'+flow.packSha256])}`);process.send!({stage:'seeded',effectId:context.request.identity.effectId,factId:fact.factId,digest:jsonDigest(fact.payload.value),snapshotBytes:Buffer.byteLength(JSON.stringify(fact.payload.value))});await new Promise(()=>{});}
  return adapter;
 }})});
 if(mode==='seed'){const site=loadSite(sitesDir,'local');await runtime.store.createRun({runId:'bridge-recovery',inputSha256:jsonDigest({}),applicationVersion:runtime.applicationVersion,owner:'original-parent',deadlineAt:new Date(Date.now()+60000).toISOString(),data:{product:{campaignId:'recovery',siteId:'local',siteDigest:jsonDigest(site),workspace,bindings:{workspaceRoot:workspace},method:{packId:'recovery-method',packDigest:flow.packSha256,retainedPackDir:dir},parentSessionId:'original-parent',modelSelection:{provider:'fixture',model:'fixture'}},budget:{generationLimit:1}}});}
 const handle=await startFlow(runtime,{runId:'bridge-recovery',flow,runInput:{},goal:{},strategy:{mode:'fixture'}});
 if(mode==='recover'){
  let waiting:any;for(let n=0;n<400;n++){waiting=(await runtime.store.flowProjection('bridge-recovery')).tasks[0];if(waiting?.state?.diagnostic?.code==='adapter-materialization')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(waiting?.state?.diagnostic?.code,'adapter-materialization',JSON.stringify(waiting));assert.equal(await runtime.store.effectDispatchExists(waiting.identity,'submit'),false,'Unavailable current folder admits no actual business dispatch');process.send!({stage:'waiting',effectId:waiting.identity.effectId});
  await new Promise(resolve=>process.once('message',resolve));const result=await handle.getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(await readFile(path.join(workspace,'calls'),'utf8'),'once\n');process.send!({stage:'finished',effectId:result.committed.run.identity.effectId});
 }
 await new Promise(resolve=>process.once('message',resolve));
}finally{await runtime?.stop();await database.stop();process.disconnect?.();}
