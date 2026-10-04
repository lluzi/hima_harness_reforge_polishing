// @hima-seam agent wrapped
// Actual private-package Host, local PG and normal Pack facade; no product model requests.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access, realpath, cp } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bootInProcess, createRootAgent } from './boot-inprocess.ts';
import { prepareHimaHome, himaHomeSources } from '../../../packages/desktop/src/hima-home.ts';
import { repoRoot } from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify,parse}=require('yaml');
const home=await realpath(process.argv[2]!);const mode=process.argv[3]??'normal';
const packageDir=process.env.HIMA_U6_FACADE_PACKAGE??path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {loadPack,checkPack}=await load('packs');const {loadSite}=await load('sites');
const {newCampaignProposalId,startRun,readExecutionContext,executionAction,controlDurableRun,recoverDurablePreparations}=await load('fabric');
const workspace=path.join(home,'workspace'),sitesDir=path.join(home,'hima/sites'),packsDir=path.join(home,'hima/packs'),packDir=path.join(packsDir,'facade-fixture');
const fresh=!(await exists(path.join(home,'accepted.json')));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
if(fresh){
  for(const dir of [workspace,sitesDir,path.join(packDir,'flow')])await mkdir(dir,{recursive:true});
  const script=`import json,pathlib,sys\ni,o,w=sys.argv[1:4]\nx=json.loads(pathlib.Path(i).read_text())\np=pathlib.Path(w)\np.joinpath('program-calls').open('a').write('original\\n')\npathlib.Path(o).write_text(json.dumps({'schemaVersion':'1','value':{'strict':x['strict'],'period':x['period'],'goalMet':x['period']<=x['target']},'artifacts':[],'diagnostics':[]}))\n`;
  await writeFile(path.join(packDir,'flow/produce.py'),script);
  await writeFile(path.join(packDir,'contract.yml'),stringify({id:'facade-fixture',version:'1',title:'Frozen normal facade method',inputs:[{name:'workspaceRoot'}],outputs:[],words:{periodNs:{label:'Period',unit:'ns'}},goal:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:1}},strategy:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:2}},tools:[{id:'produce',file:'flow/produce.py',inputs:['FLOW','TASK_INPUT','TASK_OUTPUT','WORKSPACE'],argv:['/usr/bin/python3','${FLOW}/produce.py','${TASK_INPUT}','${TASK_OUTPUT}','${WORKSPACE}']}],environment:{wrappers:['/usr/bin/python3']},workspace:{source:'pack',copy:['produce.py']}}));
  const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties:{strict:{type:'boolean'},period:{type:'number'},target:{type:'number'}},required:['strict','period','target']}};
  const output={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties:{strict:{type:'boolean'},period:{type:'number'},goalMet:{type:'boolean'}},required:['strict','period','goalMet']}};
  await writeFile(path.join(packDir,'graph.yml'),stringify({schema:'hima-flow/1',id:'facade-fixture',version:'1',flow:{kind:'task',id:'produce',tool:'produce',contract:{input:schema,output},inputs:{strict:{source:'literal',value:false},period:{source:'strategy',path:['periodNs']},target:{source:'goal',path:['periodNs']}}}}));
  await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,packDir],allowedWriteRoots:[workspace],allowedWrappers:['/usr/bin/python3','sh'],forbidden:['services','licences','network','deletions','downloads']}));
  await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{}}}));
}
if(mode==='pause-offline') {
  // The original Host is dead. A local control Host opens the same authoritative DB without starting preparation.
  const {startLocalDatabase}=await load('local-database'),{startDurableRuntime,installedExecutableManifest}=await load('durable-runtime');
  const {preparationWorkflowDefinitions}=await load('fabric'),{flowWorkflowDefinitions}=await load('flow-workflow');
  const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
  const runtime=await startDurableRuntime({database,manifest:await installedExecutableManifest(packageDir),workflows:[...preparationWorkflowDefinitions({sitesDir}),...flowWorkflowDefinitions({resolveAdapter:async()=>{throw new Error('No business task is admitted by this control Host');}})]});
  try {const accepted=JSON.parse(await readFile(path.join(home,'accepted.json'),'utf8'));
    await controlDurableRun({durable:runtime} as any,{runId:accepted.runId,commandId:'hold-original-preparation',action:'pause',origin:'human',owner:accepted.owner,epoch:accepted.epoch,revision:accepted.revision});
    await assert.rejects(access(accepted.workspace),/ENOENT/);process.send!({ok:true,stage:'paused-offline'});
  }finally{await runtime.stop();await database.stop();}
  process.exit(0);
}
if(mode==='recover-revision-crash') {
 const state=JSON.parse(await readFile(path.join(home,'revision-replay.json'),'utf8')),{LocalChannel}=await load('channel'),originalExec=LocalChannel.prototype.exec;
 LocalChannel.prototype.exec=async function(argv:any,execOptions:any){const result=await originalExec.call(this,argv,execOptions);if(argv[0]==='tee'&&argv.at(-1)===state.source){const {appendFile}=await import('node:fs/promises');await appendFile(path.join(home,'revision-source-writes.jsonl'),JSON.stringify({path:state.source})+'\n');}return result;};
}
const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const prepared=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:prepared.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any;
try{
 host=await bootInProcess(h);
 const service=host.ctx.hima,runtime=service.durable;
 const dependencies={ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()};
 const send=(value:any)=>process.send!(value);
 process.on('message',async(value:any)=>{try{
   if(value.action==='close'){await host.dispose();process.exit(0);}
   if(value.action==='pause') {const accepted=JSON.parse(await readFile(path.join(home,'accepted.json'),'utf8'));const run=await runtime.store.run(accepted.runId);await controlDurableRun(dependencies,{runId:run.runId,commandId:'hold-original-preparation',action:'pause',owner:run.owner,epoch:run.epoch,revision:run.revision});send({stage:'paused',runId:run.runId});}
 }catch(error){send({stage:'error',error:String(error)});}});
 if(mode==='shared'||mode==='shared-preparation-recovery'||mode==='shared-revision-crash') {
   const {sharedRevisionProof}=await import('./durable-fabric-shared.ts');
   send(await sharedRevisionProof({faultAfterAcceptance:mode!=='shared',crashAfterAcceptance:mode==='shared-revision-crash',host,runtime,dependencies,load,home,workspace,packsDir,sitesDir,require,createRootAgent,untilComplete}));
 }else if(mode==='recover-revision-crash'){
   const {sharedRevisionReplayProof}=await import('./durable-fabric-shared.ts');send(await sharedRevisionReplayProof({host,runtime,dependencies,load,home,require,untilComplete,repoRoot}));
 }else if(mode==='recover-partial-cancel') {
   const accepted=JSON.parse(await readFile(path.join(home,'accepted.json'),'utf8'));let context=await readExecutionContext(dependencies,accepted.runId);
   for(let i=0;i<100&&context.durable.preparation===null;i++){await new Promise(resolve=>setTimeout(resolve,25));context=await readExecutionContext(dependencies,accepted.runId);}
   const current=await runtime.store.run(accepted.runId);await controlDurableRun(dependencies,{runId:accepted.runId,commandId:'cancel-replayed-partial-copy',action:'cancel',origin:'human',owner:current.owner,epoch:current.epoch,revision:current.revision});
   for(let i=0;i<100;i++){context=await readExecutionContext(dependencies,accepted.runId);if(context.run.stopState?.state==='unknown')break;await new Promise(resolve=>setTimeout(resolve,25));}
   assert.equal(context.run.stopState?.closed,false,JSON.stringify(context.run));assert.equal(context.run.stopState?.state,'unknown');await access(accepted.workspace);await assert.rejects(access(path.join(accepted.workspace,'workspace.json')),/ENOENT/);send({ok:true,closed:false,partialWorkPreserved:true});
 }else if(mode==='recover-paused'||mode==='recover-held-stage') {
   const accepted=JSON.parse(await readFile(path.join(home,'accepted.json'),'utf8')),run=await runtime.store.run(accepted.runId);
   // Original persisted request can be held before its interrupted preparation workflow exists.
   if(!run.hold)await controlDurableRun(dependencies,{runId:run.runId,commandId:'hold-original-preparation',action:'pause',owner:run.owner,epoch:run.epoch,revision:run.revision});
   await new Promise(resolve=>setTimeout(resolve,250));
   await assert.rejects(access(accepted.workspace),/ENOENT/);
   const held=await readExecutionContext(dependencies,run.runId);assert.equal(held.run.control.paused[0],'*');assert.equal(held.engine,'dbos/5.2.11');assert.equal(held.durable.preparation,null);
   if(mode==='recover-held-stage'){send({stage:'held-recovered'});await new Promise(()=>{});}
   const current=await runtime.store.run(run.runId);
   await controlDurableRun(dependencies,{runId:run.runId,commandId:'continue-original-preparation',action:'continue',origin:'human',owner:current.owner,epoch:current.epoch,revision:current.revision});
   const completed=await untilComplete(dependencies,run.runId);
   assert.equal(completed.run.control.owner,accepted.owner);assert.equal((await runtime.store.run(run.runId)).deadlineAt,accepted.deadlineAt);
   assert.equal(await readFile(path.join(accepted.workspace,'program-calls'),'utf8'),'original\n');
   send({ok:true,runId:run.runId,pausePreventedWrites:true,originalDeadline:accepted.deadlineAt});
 }else{
   const owner=await createRootAgent(host.ctx,workspace),actor=String(owner.id),ordinary=await createRootAgent(host.ctx,workspace);
   const pack=loadPack(packsDir,'facade-fixture'),site=loadSite(sitesDir,'local'),proposalId=newCampaignProposalId(pack,site);
   assert.equal(checkPack(pack,site).fit,true,JSON.stringify(checkPack(pack,site)));
   const request={pack:pack.id,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:actor,guideSessionId:String(ordinary.id),proposalId};
   if(mode==='occupied-cancel'||mode==='partial-preparation-cancel'||mode==='partial-preparation-intent') {
     const create=runtime.store.createRun.bind(runtime.store);
     runtime.store.createRun=async(opening:any)=>{const run=await create(opening);if(mode==='occupied-cancel'){const into=opening.data.product.workspace;await mkdir(into,{recursive:true});await writeFile(path.join(into,'customer-file.txt'),'preserve original');}else{const admission=runtime.store.assertEffectAdmission.bind(runtime.store);let writes=0;runtime.store.assertEffectAdmission=async(request:any,permit:any)=>{if(request.effectId===`hima-prepare-effect:${run.runId}`&&++writes===2){if(mode==='partial-preparation-intent'){await writeFile(path.join(home,'accepted.json'),JSON.stringify({runId:run.runId,workspace:run.opening.data.product.workspace,owner:actor}));send({stage:'partial-written'});await new Promise(()=>{});}throw new Error('injected interruption after the first preparation write');}return admission(request,permit);};}return run;};
     const first=await service.startRun(request),runId=first.run.id;
     let context=await readExecutionContext(dependencies,runId);
     for(let i=0;i<100&&context.durable.preparation===null;i++){await new Promise(resolve=>setTimeout(resolve,25));context=await readExecutionContext(dependencies,runId);}
     assert.equal(context.durable.preparation.kind,'occupied',JSON.stringify(context.durable.preparation));
     const cancelled=await executionAction(dependencies,{runId,requestId:'cancel-without-preparation-writes',action:'cancel',actor,expectedEpoch:context.run.control.epoch,expectedRevision:context.run.control.revision});
     assert.equal(cancelled.kind,'accepted',JSON.stringify(cancelled));
     for(let i=0;i<100;i++){context=await readExecutionContext(dependencies,runId);if(context.run.stopState?.closed||mode==='partial-preparation-cancel'&&context.run.stopState?.state==='unknown')break;await new Promise(resolve=>setTimeout(resolve,25));}
     if(mode==='occupied-cancel'){
       assert.equal(context.run.stopState?.closed,true,JSON.stringify({run:context.run,preparation:context.durable.preparation,resources:context.durable.resources}));
       assert.equal(await readFile(path.join(first.workspace,'customer-file.txt'),'utf8'),'preserve original');
       send({ok:true,runId,closed:true,customerFilePreserved:true});
     }else{
       await access(first.workspace);await assert.rejects(access(path.join(first.workspace,'workspace.json')),/ENOENT/);
       assert.equal(context.run.stopState?.closed,false);assert.equal(context.run.stopState?.state,'unknown',JSON.stringify(context.run));
       send({ok:true,runId,closed:false,partialWorkPreserved:true});
     }
   }else if(mode==='intent') {
     // Crash at actual PG opening commit, before DBOS workflow creation or any Site write.
     const create=runtime.store.createRun.bind(runtime.store);
     runtime.store.createRun=async(opening:any)=>{const run=await create(opening);await writeFile(path.join(home,'accepted.json'),JSON.stringify({runId:run.runId,workspace:run.opening.data.product.workspace,owner:actor,deadlineAt:run.deadlineAt,epoch:run.epoch,revision:run.revision}));send({stage:'persisted-intent',runId:run.runId});await new Promise(()=>{});return run;};
     await service.startRun(request);
   }else {
     await assert.rejects(startRun({...dependencies,durable:undefined},request),/durable runtime is unavailable/);
     assert.equal(service.ledger.runs().length,0);
     service.ledger.projectDurableFact=async()=>{throw new Error('injected delayed history projection');};
     const first=await service.startRun(request),runId=first.run.id;assert.equal(first.run.engine,'dbos/5.2.11');
     const committed=await runtime.store.run(runId);await writeFile(path.join(home,'accepted.json'),JSON.stringify({runId,workspace:committed.opening.data.product.workspace,owner:actor,deadlineAt:committed.deadlineAt,epoch:committed.epoch,revision:committed.revision}));
     const completed=await untilComplete(dependencies,runId);assert.equal(completed.engine,'dbos/5.2.11');assert.equal(completed.run.status,'ended-goal-not-met');assert.equal(completed.run.goalState,'not-met');
     assert.equal(completed.durable.tasks[0].result.value.strict,false);assert.equal(completed.durable.tasks[0].result.value.period,2);assert.equal(completed.durable.tasks[0].result.value.goalMet,false);
     const method=committed.opening.data.product.method;
     const raw=async(agent:any,id:string)=>host.ctx.tools.execute({callId:id,name:'bash',arguments:{command:'printf facade-side-talk',description:'Bounded raw shell authority proof'},agent,signal:AbortSignal.timeout(2000)});
     const denied=async(agent:any,id:string)=>{try{const result=await raw(agent,id);assert.equal(result.isError,true,JSON.stringify(result));assert.match(JSON.stringify(result),/retained Campaign|raw shell|terminal access/i);}catch(error){assert.match(String(error),/retained Campaign|raw shell|terminal access/i);}};
     await denied(owner,'pg-owner-raw-shell');
     const ordinaryResult=await raw(ordinary,'ordinary-side-talk-shell');assert.equal(ordinaryResult.isError,false,JSON.stringify(ordinaryResult));assert.match(JSON.stringify(ordinaryResult),/facade-side-talk/);
     const role=async(agent:any)=>{const assembly=await host.ctx.systemPrompt.assemble({agent,scope:agent});return JSON.parse(assembly.contexts.find((item:any)=>item.name==='hima:inventory').text);};
     assert.equal((await role(owner)).role,'execution-owner');assert.equal((await role(owner)).source,'hima-postgresql');

     // A duplicate confirmed proposal still finds the original Run despite a changed installed method/default.
     await writeFile(path.join(packDir,'flow/produce.py'),'raise Exception("current installed method must never execute")\n');
     const text=await readFile(path.join(packDir,'contract.yml'),'utf8');await writeFile(path.join(packDir,'contract.yml'),text.replace('default: 2','default: 3'));
     const again=await service.startRun(request);assert.equal(again.run.id,runId);assert.equal(again.workspace,first.workspace);assert.equal((await runtime.store.runs()).length,1);
     assert.equal((await runtime.store.run(runId)).deadlineAt,committed.deadlineAt);assert.equal((await readExecutionContext(dependencies,runId)).method.digest,method.packDigest);
     assert.equal(await readFile(path.join(first.workspace,'program-calls'),'utf8'),'original\n');
     const epoch=completed.run.control.epoch,revision=completed.run.control.revision;
     const pause={runId,requestId:'facade-pause',action:'pause',actor,expectedEpoch:epoch,expectedRevision:revision};
     const paused=await executionAction(dependencies,pause);assert.equal(paused.kind,'accepted');assert.equal(paused.context.run.control.paused[0],'*');
     assert.equal((await executionAction(dependencies,pause)).kind,'duplicate');
     const stale=await executionAction(dependencies,{...pause,requestId:'stale-facade-pause'});assert.equal(stale.kind,'refused');assert.match(stale.reason,/stale/);
     assert.equal((await executionAction(dependencies,{...pause,action:'begin',requestId:'old-dispatch'})).kind,'unsupported');
     const wrong=await executionAction(dependencies,{...pause,actor:String(ordinary.id),expectedEpoch:paused.context.run.control.epoch,requestId:'wrong-owner',origin:'agent'});assert.equal(wrong.kind,'refused');assert.match(wrong.reason,/stale/);
     const emergency=await executionAction(dependencies,{...pause,actor:String(ordinary.id),origin:'human',expectedEpoch:paused.context.run.control.epoch,requestId:'human-guide-emergency'});assert.equal(emergency.kind,'accepted',emergency.reason);assert.equal(emergency.context.run.control.owner,actor);assert.equal(emergency.context.holds[0].source,'human');
     const agentClear=await executionAction(dependencies,{...pause,action:'continue',expectedEpoch:emergency.context.run.control.epoch,requestId:'agent-cannot-clear-human'});assert.equal(agentClear.kind,'refused');assert.match(agentClear.reason,/human/);
     const guideClear=await executionAction(dependencies,{...pause,actor:String(ordinary.id),origin:'human',action:'continue',expectedEpoch:emergency.context.run.control.epoch,requestId:'human-guide-continue'});assert.equal(guideClear.kind,'accepted',guideClear.reason);assert.equal(guideClear.context.run.control.owner,actor);
     const nextOwner=await createRootAgent(host.ctx,workspace),nextActor=String(nextOwner.id);
     const handed=await executionAction(dependencies,{...pause,action:'handoff',targetOwner:nextActor,expectedEpoch:guideClear.context.run.control.epoch,requestId:'explicit-handoff'});
     assert.equal(handed.kind,'accepted');assert.equal(handed.context.run.control.owner,nextActor);
     await denied(owner,'former-owner-raw-shell');await denied(nextOwner,'new-owner-raw-shell');
     assert.equal((await role(owner)).role,'former-owner');assert.equal((await role(nextOwner)).role,'execution-owner');

     const departed=await executionAction(dependencies,{...pause,expectedEpoch:handed.context.run.control.epoch,requestId:'departed-owner'});assert.equal(departed.kind,'refused');assert.match(departed.reason,/stale/);
     const newOwner=await executionAction(dependencies,{...pause,actor:nextActor,expectedEpoch:handed.context.run.control.epoch,requestId:'new-owner-pause'});assert.equal(newOwner.kind,'accepted');

     // Query authority directly even if history projection has no durable Run row.
     assert.equal(service.ledger.run(runId),undefined);assert.equal((await readExecutionContext(dependencies,runId)).run.control.epoch,newOwner.context.run.control.epoch);
     for(const scenario of ['goal-order','goal-unknown']) {
       const methodDir=path.join(packsDir,scenario);await mkdir(path.join(methodDir,'flow'),{recursive:true});
       const base=parse(await readFile(path.join(method.retainedPackDir,'contract.yml'),'utf8'));base.id=scenario;
       await writeFile(path.join(methodDir,'flow/produce.py'),await readFile(path.join(method.retainedPackDir,'flow/produce.py')));
       const graph=parse(await readFile(path.join(method.retainedPackDir,'graph.yml'),'utf8')),earlier=structuredClone(graph.flow);earlier.id='z-earlier';earlier.inputs.period={source:'literal',value:0.5};
       const terminal=structuredClone(graph.flow);terminal.id='a-deliver';
       if(scenario==='goal-unknown') {
         await writeFile(path.join(methodDir,'flow/deliver.py'),`import json,pathlib,sys\npathlib.Path(sys.argv[1]).write_text(json.dumps({'schemaVersion':'1','value':{'summary':'Original report does not establish Goal'},'artifacts':[],'diagnostics':[]}))\n`);
         base.workspace.copy.push('deliver.py');base.tools.push({id:'deliver',file:'flow/deliver.py',inputs:['FLOW','TASK_OUTPUT'],argv:['/usr/bin/python3','${FLOW}/deliver.py','${TASK_OUTPUT}']});terminal.tool='deliver';terminal.inputs={};
         terminal.contract.input={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false}};
         terminal.contract.output={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{summary:{type:'string'}},required:['summary'],additionalProperties:false}};
       }
       await writeFile(path.join(methodDir,'contract.yml'),stringify(base));await writeFile(path.join(methodDir,'graph.yml'),stringify({schema:'hima-flow/1',id:scenario,version:'1',flow:{kind:'sequence',id:'ordered-business',steps:[earlier,terminal]}}));
       const methodPack=loadPack(packsDir,scenario),token=newCampaignProposalId(methodPack,site);
       const accepted=await service.startRun({pack:scenario,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:nextActor,proposalId:token});assert.notEqual(accepted.kind,'unfit',JSON.stringify(accepted));
       const final=await untilComplete(dependencies,accepted.run.id),facts=await runtime.store.flowFact(accepted.run.id,'outcome:0');
       assert.equal(facts.committed['z-earlier'].value.goalMet,true);assert.equal(facts.terminal.taskId,'a-deliver');assert.equal(facts.terminal.effectId,facts.committed['a-deliver'].identity.effectId);
       assert.equal(final.run.goalState,scenario==='goal-order'?'not-met':'unknown');assert.notEqual(final.run.status,'ended-goal-met');
       if(scenario==='goal-order')assert.equal(facts.committed['a-deliver'].value.goalMet,false);
     }
     // Supported legacy declaration goes through the same normal Fabric start and durable interpreter.
     const legacyDir=path.join(packsDir,'legacy-facade');for(const part of ['flow','tools','readers','rules','choosers'])await mkdir(path.join(legacyDir,part),{recursive:true});
     await writeFile(path.join(legacyDir,'flow/produce.py'),`import pathlib,json,sys\np=pathlib.Path(sys.argv[1]);p.joinpath('legacy-program-calls').open('a').write('original\\n')\np.joinpath('report.json').write_text(json.dumps({'values':[{'type':'setup_wns','unit':'ns','mode':'setup','scope':'all','value':0.1},{'type':'clock_period','unit':'ns','value':float(sys.argv[2])}]}))\n`);
     await writeFile(path.join(legacyDir,'tools/read.py'),`import pathlib,json,sys\nr,o,w=sys.argv[1:4];pathlib.Path(w).joinpath('legacy-reader-calls').open('a').write('original\\n');pathlib.Path(o).write_text(json.dumps(json.loads(pathlib.Path(r).read_text())))\n`);
     await writeFile(path.join(legacyDir,'readers/fixture.yml'),stringify({id:'fixture',version:'1',reportKind:'fixture',emits:['setup_wns','clock_period'],file:'tools/read.py',argv:['/usr/bin/python3','${READER}','${REPORT}','${OUT}','${WORKSPACE}']}));
     await writeFile(path.join(legacyDir,'rules/constraint.yml'),stringify({id:'constraint',version:'1',title:'Measured setup',requires:[{type:'setup_wns',mode:'setup',scope:'all'}],subject:{type:'setup_wns',mode:'setup',scope:'all'},predicate:{op:'gte',threshold:0,unit:'ns'}}));
     await writeFile(path.join(legacyDir,'rules/goal.yml'),stringify({id:'goal',version:'1',title:'Declared period Goal',parameter:{name:'periodNs',unit:'ns'},requires:[{type:'clock_period'}],subject:{type:'clock_period'},predicate:{op:'lte',threshold:{parameter:'periodNs'},unit:'ns'}}));
     await writeFile(path.join(legacyDir,'choosers/fixture.yml'),stringify({id:'fixture',version:'1',title:'Actual period improvement',parameter:{name:'stepNs',unit:'ns'},reads:{period:{type:'clock_period',unit:'ns'}},decide:[{when:{constraint:'PASS',goal:'PASS'},goalMet:true},{when:{constraint:'PASS',goal:'FAIL'},next:{periodNs:{sum:['period',{neg:'stepNs'}]}}}]}));
     await writeFile(path.join(legacyDir,'contract.yml'),stringify({id:'legacy-facade',version:'1',title:'Legacy method through durable Fabric',inputs:[{name:'workspaceRoot'}],outputs:[{name:'timing',path:'report.json',reader:'fixture',description:'Measured timing'}],words:{periodNs:{label:'Period',unit:'ns'}},goal:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:1}},strategy:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:2}},tools:[{id:'produce',file:'flow/produce.py',inputs:['FLOW','WORKSPACE','PERIOD'],argv:['/usr/bin/python3','${FLOW}/produce.py','${WORKSPACE}','${PERIOD}']}],environment:{wrappers:['/usr/bin/python3']},workspace:{source:'pack',copy:['produce.py']}}));
     await writeFile(path.join(legacyDir,'graph.yml'),stringify({id:'legacy-facade',version:'1',entry:'produce',nodes:[{id:'produce',kind:'act',parameters:{tool:'produce',arguments:{PERIOD:{from:'strategy',name:'periodNs'}}}},{id:'read',kind:'act',parameters:{observes:'timing'}},{id:'judge',kind:'judge',parameters:{rules:['constraint','goal'],bind:{periodNs:{from:'goal',name:'periodNs'}}}},{id:'choose',kind:'explore',parameters:{chooser:'fixture',bind:{stepNs:0.25},growth:true}}],edges:[{from:'produce',to:'read'},{from:'read',to:'judge'},{from:'judge',to:'choose',outcome:'PASS'},{from:'choose',to:'produce',revisit:true}]}));
     const legacyPack=loadPack(packsDir,'legacy-facade');assert.equal(legacyPack.flow.source,'legacy');assert.equal(checkPack(legacyPack,site).fit,true,JSON.stringify(checkPack(legacyPack,site)));
     const legacyToken=newCampaignProposalId(legacyPack,site),legacy=await service.startRun({pack:'legacy-facade',site:'local',goal:{periodNs:1},ownerSessionId:nextActor,proposalId:legacyToken,generationLimit:1});
     const legacyFinal=await untilComplete(dependencies,legacy.run.id),legacyFacts=await runtime.store.flowFact(legacy.run.id,'outcome:0');
     assert.equal(legacyFinal.run.goalState,'not-met');assert.equal(legacyFacts.committed.read.value.observations[0].values[0].value,0.1);assert.deepEqual(legacyFacts.committed.judge.value.verdicts.map((row:any)=>row.outcome),['PASS','FAIL']);assert.equal(legacyFacts.committed.choose.value.goalMet,false);
     assert.equal(await readFile(path.join(legacy.workspace,'legacy-program-calls'),'utf8'),'original\n');assert.equal(await readFile(path.join(legacy.workspace,'legacy-reader-calls'),'utf8'),'original\n');
     const growArgs={run:legacy.run.id,action:'grow',nodeId:'choose',executionId:legacyFacts.committed.choose.identity.effectId,
       expectedEpoch:legacyFinal.run.control.epoch,expectedRevision:legacyFinal.run.control.revision,requestId:'normal-business-growth',proposal:{
       impactNodes:['produce','read','judge','choose'],expectedChanges:['Measure one declared diagnostic point and return its sourced report to the original method'],
       nodes:[{id:'diagnostic-produce',kind:'act',parameters:{tool:'produce',arguments:{PERIOD:0.5}}},{id:'diagnostic-read',kind:'act',parameters:{observes:'timing'}}],
       edges:[{from:'diagnostic-produce',to:'diagnostic-read'},{from:'diagnostic-read',to:'choose'}],requiredOutputs:['timing'],endCondition:'The actual diagnostic Reader report is committed',returnNode:'choose',optional:true}};
     const growTool=await host.ctx.tools.execute({name:'hima_execute',arguments:growArgs,agent:nextOwner,callId:'normal-grow-tool',signal:AbortSignal.timeout(10000)});assert.equal(growTool.isError,false,JSON.stringify(growTool));assert.equal(growTool.value.kind,'accepted',JSON.stringify(growTool));
     const grown=await untilComplete(dependencies,legacy.run.id),grownFacts=await runtime.store.flowFact(legacy.run.id,'outcome:1');
     assert.equal(grown.run.goalState,'met');assert.equal(grownFacts.committed['diagnostic-read'].value.observations[0].values[1].value,0.5);assert.equal(grownFacts.committed.read.identity.effectId,legacyFacts.committed.read.identity.effectId,'Existing baseline Reader result is reused');assert.equal(legacyFacts.committed.choose.value.goalMet,false,'Original decision/history remains false');
     const growAgain=await host.ctx.tools.execute({name:'hima_execute',arguments:growArgs,agent:nextOwner,callId:'normal-grow-tool-retry',signal:AbortSignal.timeout(10000)});assert.equal(growAgain.isError,false,JSON.stringify(growAgain));assert.equal(growAgain.value.kind,'duplicate',JSON.stringify(growAgain));
     const originalGrowth=await runtime.store.flowFact(legacy.run.id,'facade-command:normal-business-growth');
     const aliasedArgs={...growArgs,expectedRevision:grown.run.control.revision,executionId:grownFacts.committed.choose.identity.effectId,requestId:'same-proposal-new-request',proposal:{...growArgs.proposal,proposalId:originalGrowth.command.change.evidence.proposal.proposalId}};
     const aliased=await host.ctx.tools.execute({name:'hima_execute',arguments:aliasedArgs,agent:nextOwner,callId:'same-proposal-new-request-tool',signal:AbortSignal.timeout(10000)});assert.equal(aliased.isError,false,JSON.stringify(aliased));assert.equal(aliased.value.kind,'duplicate',JSON.stringify(aliased));
     const different=structuredClone(aliasedArgs);different.requestId='same-proposal-changed-intent';const changedProposalNode=different.proposal.nodes[0];assert.ok(changedProposalNode?.parameters.arguments);changedProposalNode.parameters.arguments.PERIOD=0.25;
     const conflicting=await host.ctx.tools.execute({name:'hima_execute',arguments:different,agent:nextOwner,callId:'same-proposal-changed-intent-tool',signal:AbortSignal.timeout(10000)});assert.equal(conflicting.isError,false,JSON.stringify(conflicting));assert.equal(conflicting.value.kind,'refused');assert.match(conflicting.value.reason,/proposal identity.*different business intent/);
     assert.equal(await readFile(path.join(legacy.workspace,'legacy-program-calls'),'utf8'),'original\noriginal\n');assert.equal(await readFile(path.join(legacy.workspace,'legacy-reader-calls'),'utf8'),'original\noriginal\n');

     for(const boundary of ['submit-in-flight','running','result-committed']) {
       const optionalId=`optional-facade-${boundary}`,optionalDir=path.join(packsDir,optionalId);await cp(legacyDir,optionalDir,{recursive:true});
       const optionalContract=parse(await readFile(path.join(optionalDir,'contract.yml'),'utf8'));optionalContract.id=optionalId;await writeFile(path.join(optionalDir,'contract.yml'),stringify(optionalContract));
       const optionalGraph=parse(await readFile(path.join(optionalDir,'graph.yml'),'utf8'));optionalGraph.id=optionalId;await writeFile(path.join(optionalDir,'graph.yml'),stringify(optionalGraph));
       const optionalScript=await readFile(path.join(optionalDir,'flow/produce.py'),'utf8');await writeFile(path.join(optionalDir,'flow/produce.py'),optionalScript.replace('p=pathlib.Path(sys.argv[1]);',`import time\np=pathlib.Path(sys.argv[1])\nif float(sys.argv[2])<1:\n p.joinpath('diagnostic-running').write_text('actual process running')\n${boundary==='result-committed'?'':' while True: time.sleep(0.05)\n'}`));
       const optionalPack=loadPack(packsDir,optionalId),optionalRun=await service.startRun({pack:optionalId,site:'local',goal:{periodNs:1},ownerSessionId:nextActor,generationLimit:1,proposalId:newCampaignProposalId(optionalPack,site)});const optionalView=await untilComplete(dependencies,optionalRun.run.id),optionalOriginal=await runtime.store.flowFact(optionalRun.run.id,'outcome:0');
       let signalBoundary!: (identity:any)=>void,releaseBoundary!:()=>void,held=false;
       const reached=new Promise<any>(resolve=>{signalBoundary=resolve;}),release=new Promise<void>(resolve=>{releaseBoundary=resolve;});
       const actualDispatch=runtime.store.claimEffectDispatch.bind(runtime.store),actualRecord=runtime.store.recordEffectFact.bind(runtime.store),actualCommit=runtime.store.commitResult.bind(runtime.store);
       runtime.store.claimEffectDispatch=async(admission:any,permit:any,dispatchId:string,inputSha:string)=>{
         const result=await actualDispatch(admission,permit,dispatchId,inputSha),effect=await runtime.store.effect(admission.effectId);
         if(boundary==='submit-in-flight'&&!held&&result&&effect?.identity.runId===optionalRun.run.id&&effect.identity.taskId==='diagnostic-produce'&&dispatchId==='submit'){held=true;signalBoundary(effect.identity);await release;}
         return result;
       };
       runtime.store.recordEffectFact=async(identity:any,phase:string,value:any)=>{
         const result=await actualRecord(identity,phase,value);
         if(boundary==='running'&&!held&&identity.runId===optionalRun.run.id&&identity.taskId==='diagnostic-produce'&&phase==='submitted'){
           const until=Date.now()+5000;while(!await exists(path.join(optionalRun.workspace,'diagnostic-running'))){if(Date.now()>until)throw new Error('Actual diagnostic process did not reach running sentinel');await new Promise(resolve=>setTimeout(resolve,20));}
           held=true;signalBoundary(identity);await release;
         }
         return result;
       };
       runtime.store.commitResult=async(result:any)=>{const committed=await actualCommit(result);if(boundary==='result-committed'&&!held&&result.identity.runId===optionalRun.run.id&&result.identity.taskId==='diagnostic-produce'){held=true;signalBoundary(result.identity);await release;}return committed;};
       try {
         const optionalArgs={...growArgs,run:optionalRun.run.id,executionId:optionalOriginal.committed.choose.identity.effectId,expectedEpoch:optionalView.run.control.epoch,expectedRevision:optionalView.run.control.revision,requestId:'normal-optional-growth',proposal:{...growArgs.proposal,proposalId:'normal-optional-fragment'}};
         const optionalGrow=await host.ctx.tools.execute({name:'hima_execute',arguments:optionalArgs,agent:nextOwner,callId:`normal-optional-grow-${boundary}`,signal:AbortSignal.timeout(10000)});assert.equal(optionalGrow.value.kind,'accepted',JSON.stringify(optionalGrow));
         const diagnostic=await Promise.race([reached,new Promise((_,reject)=>setTimeout(()=>reject(new Error(`Optional diagnostic did not reach ${boundary}`)),10000))]);
         const optionalCurrent=await readExecutionContext(dependencies,optionalRun.run.id);
         assert.equal(await runtime.store.effectDispatchExists(diagnostic,'submit'),true);
         assert.equal(await exists(path.join(optionalRun.workspace,'diagnostic-running')),boundary!=='submit-in-flight','Boundary distinguishes an admitted send from an actual running process');
         const producer=(await runtime.store.flowInvocations(optionalRun.run.id)).find((inv:any)=>inv.identity.taskId==='choose'&&inv.version===1);
         const abandoned=await host.ctx.tools.execute({name:'hima_execute',arguments:{run:optionalRun.run.id,action:'grow',expectedEpoch:optionalCurrent.run.control.epoch,expectedRevision:optionalCurrent.run.control.revision,requestId:'normal-optional-abandon',proposalId:'normal-optional-fragment',executionId:producer.identity.effectId,growthDisposition:'abandoned',rationale:`Stop only this optional diagnostic at ${boundary}`},agent:nextOwner,callId:`normal-optional-abandon-${boundary}`,signal:AbortSignal.timeout(10000)});assert.equal(abandoned.value.kind,'accepted',JSON.stringify(abandoned));
         const beforeRelease=await readExecutionContext(dependencies,optionalRun.run.id);releaseBoundary();
         const optionalFinal=await untilComplete(dependencies,optionalRun.run.id),optionalOutcome=await runtime.store.flowFact(optionalRun.run.id,'outcome:1');
         const diagnosticCapture={boundary,diagnostic,abandoned,beforeRelease,final:optionalFinal,immutableOutcome:optionalOutcome,invocations:await runtime.store.flowInvocations(optionalRun.run.id),effectFacts:await runtime.store.orderedExternalEffectFacts(diagnostic)};
         const evidenceDir=path.join(repoRoot,'.hima-tmp/dbos-migration/u6-facade/optional-boundaries');await mkdir(evidenceDir,{recursive:true});await writeFile(path.join(evidenceDir,`${boundary}-${optionalRun.run.id}.json`),JSON.stringify(diagnosticCapture,null,2));
         assert.equal(optionalFinal.durable.run.cancelled,false);assert.equal(optionalFinal.run.goalState,'not-met',JSON.stringify(diagnosticCapture));
         assert.ok(Object.values(optionalOutcome.extensionResults).some((value:any)=>value.status==='abandoned'));assert.equal(optionalOutcome.committed.read.identity.effectId,optionalOriginal.committed.read.identity.effectId);assert.equal((await runtime.store.effectResources(diagnostic.effectId)).every((lease:any)=>lease.released),true,'Original optional Job actually closed before return');
       }finally {releaseBoundary();runtime.store.claimEffectDispatch=actualDispatch;runtime.store.recordEffectFact=actualRecord;runtime.store.commitResult=actualCommit;}
     }
     const codeDir=path.join(packsDir,'code-facade');await cp(path.join(repoRoot,'test/fixtures/pipeline/workshop'),codeDir,{recursive:true});
     const codeContract=parse(await readFile(path.join(codeDir,'contract.yml'),'utf8'));codeContract.id='code-facade';codeContract.goal={expectedSum:{type:'number',unit:'count',min:0,max:1000,default:42}};codeContract.words.expectedSum={label:'Expected sum',unit:'count'};codeContract.inputs=codeContract.inputs.filter((input:any)=>!['design','flowRoot'].includes(input.name));codeContract.workspace={source:'pack',copy:['numbers.txt']};
     await mkdir(path.join(codeDir,'flow'),{recursive:true});await writeFile(path.join(codeDir,'flow/numbers.txt'),'3\n7\n11\n');await writeFile(path.join(codeDir,'contract.yml'),stringify(codeContract));
     const codeGraph=parse(await readFile(path.join(codeDir,'graph.yml'),'utf8'));codeGraph.id='code-facade';codeGraph.nodes.find((node:any)=>node.id==='judge').parameters.bind={expectedSum:{from:'goal',name:'expectedSum'}};
     const sumRule=parse(await readFile(path.join(codeDir,'rules/sum-valid.yml'),'utf8'));sumRule.parameter={name:'expectedSum',unit:'count'};sumRule.predicate.threshold={parameter:'expectedSum'};await writeFile(path.join(codeDir,'rules/sum-valid.yml'),stringify(sumRule));await writeFile(path.join(codeDir,'graph.yml'),stringify(codeGraph));
     const codePack=loadPack(packsDir,'code-facade');assert.equal(checkPack(codePack,site).fit,true,JSON.stringify(checkPack(codePack,site)));
     let modelGate:any,releaseGate:any,gateHit=false;const modelBlocked=new Promise(resolve=>{modelGate=resolve;}),neverPrompt=new Promise<void>(resolve=>{releaseGate=resolve;});
     const actualAdmission=runtime.store.assertEffectAdmission.bind(runtime.store);
     runtime.store.assertEffectAdmission=async(admission:any,permit:any)=>{
       const effect=await runtime.store.effect(admission.effectId);
       if(!gateHit&&effect?.identity.taskId==='analyze') {const intent=await runtime.store.externalEffectFact(effect.identity,'prompt:initial:intent');if(intent){gateHit=true;modelGate({identity:effect.identity,sessionId:intent.sessionId});await neverPrompt;}}
       return actualAdmission(admission,permit);
     };
     const codeStarted=await service.startRun({pack:'code-facade',site:'local',goal:{expectedSum:42},ownerSessionId:nextActor,proposalId:newCampaignProposalId(codePack,site)});
     const initial:any=await Promise.race([modelBlocked,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Original native Workshop did not reach its actual pre-model admission boundary')),10000))]);
     const nativeChild=host.ctx.get('agents').get(initial.sessionId);assert.ok(nativeChild,'The Source writer is a real native Workshop session');
     const oldCode=`set -eu\n. "$1/helper.sh"\nmkdir -p "$2/research/analysis"\nawk -v scale="$3" '{sum+=$1} END {print sum*scale}' "$2/flow/numbers.txt" > "$2/research/analysis/result.txt"\n`;
     const written=await host.ctx.tools.execute({name:'hima_workshop_write',arguments:{path:'entry.sh',content:oldCode},agent:nativeChild,callId:'actual-original-code-seed',signal:AbortSignal.timeout(10000)});assert.equal(written.isError,false,JSON.stringify(written));assert.equal(written.value.wrote,true,JSON.stringify(written));
     const helperContent=': original approved helper\n',helperWritten=await host.ctx.tools.execute({name:'hima_workshop_write',arguments:{path:'helper.sh',content:helperContent},agent:nativeChild,callId:'actual-original-helper-seed',signal:AbortSignal.timeout(10000)});assert.equal(helperWritten.isError,false,JSON.stringify(helperWritten));assert.equal(helperWritten.value.wrote,true,JSON.stringify(helperWritten));
     const currentCode=await readExecutionContext(dependencies,codeStarted.run.id),newCode=oldCode.replace('sum*scale}', 'sum*scale+1}');
     const revisionArgs={run:codeStarted.run.id,action:'revise',executionId:initial.identity.effectId,expectedEpoch:currentCode.run.control.epoch,expectedRevision:currentCode.run.control.revision,requestId:'actual-legacy-code-revision',revision:{revisionId:'approved-algorithm-v2',reason:'Apply the reviewed algorithm byte change in the original Workshop scope',changedNodes:['analyze'],changes:[{nodeId:'analyze',scope:'workshop',path:'entry.sh',content:newCode}]}};
     const codeRevised=await host.ctx.tools.execute({name:'hima_execute',arguments:revisionArgs,agent:nextOwner,callId:'normal-code-revision-tool',signal:AbortSignal.timeout(10000)});assert.equal(codeRevised.isError,false,JSON.stringify(codeRevised));assert.equal(codeRevised.value.kind,'accepted',JSON.stringify(codeRevised));releaseGate();
     const codeFinal=await untilComplete(dependencies,codeStarted.run.id),codeFacts=await runtime.store.flowFact(codeStarted.run.id,'outcome:1');
     assert.equal(codeFacts.committed['read-analysis'].value.observations[0].values[0].value,43);assert.equal(await readFile(written.value.path,'utf8'),oldCode,'Original authored code is never overwritten');
     const preserved=await runtime.store.flowFact(codeStarted.run.id,'prepared-revision:actual-legacy-code-revision');assert.ok(preserved.assets.length);assert.equal(await readFile(preserved.assets[0].beforeVersionPath,'utf8'),oldCode);assert.equal(await readFile(preserved.assets[0].afterVersionPath,'utf8'),newCode);
     assert.equal(await runtime.store.externalEffectFact(initial.identity,'prompt:initial:result'),undefined,'No product model request completed or supplied the original code');
     const codeAgain=await host.ctx.tools.execute({name:'hima_execute',arguments:revisionArgs,agent:nextOwner,callId:'normal-code-revision-retry',signal:AbortSignal.timeout(10000)});assert.equal(codeAgain.isError,false,JSON.stringify(codeAgain));assert.equal(codeAgain.value.kind,'duplicate',JSON.stringify(codeAgain));
     const firstApproved=codeFacts.committed.analyze,secondEntry=newCode.replace('sum*scale+1}', 'sum*scale+2}');
     async function successiveFacadeRevision(previous:any,requestId:string,file:string,content:string,revision:number){
       const context=await readExecutionContext(dependencies,codeStarted.run.id),response=await host.ctx.tools.execute({name:'hima_execute',arguments:{run:codeStarted.run.id,action:'revise',executionId:previous.identity.effectId,expectedEpoch:context.run.control.epoch,expectedRevision:context.run.control.revision,requestId,revision:{revisionId:requestId,reason:'Preserve verified program provenance across the reviewed file edit',changedNodes:['analyze'],changes:[{nodeId:'analyze',scope:'workshop',path:file,content}]}},agent:nextOwner,callId:requestId,signal:AbortSignal.timeout(10000)});assert.equal(response.isError,false,JSON.stringify(response));assert.equal(response.value.kind,'accepted',JSON.stringify(response));await untilComplete(dependencies,codeStarted.run.id);const outcome=await runtime.store.flowFact(codeStarted.run.id,'outcome:'+revision);assert.ok(outcome?.committed.analyze,JSON.stringify(outcome));return outcome;
     }
     const secondApproved=await successiveFacadeRevision(firstApproved,'approved-algorithm-v3','entry.sh',secondEntry,2);
     assert.equal(secondApproved.committed['read-analysis'].value.observations[0].values[0].value,44);
     const secondSources=await runtime.store.listExternalEffectFacts(secondApproved.committed.analyze.identity,'revision-source:');assert.equal(secondSources['revision-source:helper.sh'].nodeId,'analyze');assert.equal(await readFile(secondSources['revision-source:helper.sh'].retainedPath,'utf8'),helperContent);
     const helperApproved=await successiveFacadeRevision(secondApproved.committed.analyze,'approved-helper-v4','helper.sh','printf helper-revised > "$2/helper-revised"\n',3);
     assert.equal(helperApproved.committed['read-analysis'].value.observations[0].values[0].value,44);assert.equal(await readFile(path.join(codeStarted.workspace,'helper-revised'),'utf8'),'helper-revised');assert.equal(Object.keys(await runtime.store.listExternalEffectFacts(helperApproved.committed.analyze.identity,'session:')).length,0,'Helper-only edit reuses verified retained entry without native reauthoring');assert.equal(await readFile(helperWritten.value.path,'utf8'),helperContent,'Original helper version remains immutable');
     runtime.store.assertEffectAdmission=actualAdmission;
     let incompatibleCallbacks=0;const originalHistory=await runtime.store.run(runId),originalHistoryOutcome=await runtime.store.flowFact(runId,'outcome:0');
     await recoverDurablePreparations({...runtime,applicationVersion:'hima-different-executable-qualification',startWorkflow:async()=>{incompatibleCallbacks++;throw new Error('Historical executable callback must not be scheduled');}});
     assert.equal(incompatibleCallbacks,0,'Completed old executable history never rejects current recovery through a restart callback');assert.equal((await runtime.store.run(runId)).applicationVersion,originalHistory.applicationVersion);assert.deepEqual(await runtime.store.flowFact(runId,'outcome:0'),originalHistoryOutcome);
     assert.equal((await service.resumeRun(runId,'anonymous-legacy-resume')).kind,'unresumable');
     const cancellation=await service.cancelRun(runId);assert.ok(['stopping','cancelled'].includes(cancellation.kind),JSON.stringify(cancellation));
     if(cancellation.kind==='cancelled')assert.equal(cancellation.run.stopState.closed,true,'Normal cancel reports stopped only with actual closure proof');
     const stopDeadline=Date.now()+5000;let stopped=await readExecutionContext(dependencies,runId);while(!stopped.run.stopState?.closed){if(Date.now()>stopDeadline)throw new Error('Normal Host cancellation did not obtain its original closed task/resource proof');await new Promise(resolve=>setTimeout(resolve,30));stopped=await readExecutionContext(dependencies,runId);}assert.equal(stopped.run.status,'cancelled');
     send({ok:true,runId,goalMet:false,originalProgramCalls:1,duplicateSingleRun:true,staleOwnerRefused:true});
   }
 }
}catch(error){process.send?.({stage:'error',error:String(error),stack:(error as Error).stack});await host?.dispose().catch(()=>undefined);process.exitCode=1;}
async function exists(at:string){try{await access(at);return true;}catch{return false;}}
async function untilComplete(deps:any,runId:string){const until=Date.now()+20000;for(;;){const view=await readExecutionContext(deps,runId);if(view.durable.workflow?.status==='SUCCESS')return view;if(view.durable.workflow?.status==='ERROR')throw new Error(JSON.stringify({runId,state:view.durable.workflow.status,error:String(view.durable.workflow.error),tasks:view.durable.tasks.map((task:any)=>({taskId:task.identity.taskId,version:task.version,state:task.state})),revisionPreparation:view.durable.revisionPreparation&&{status:view.durable.revisionPreparation.status,error:String(view.durable.revisionPreparation.error)}}));if(Date.now()>until)throw new Error('Facade completion timeout: '+JSON.stringify({runId,status:view.run.status,tasks:view.durable.tasks.map((task:any)=>({taskId:task.identity.taskId,version:task.version,state:task.state})),revisionPreparation:view.durable.revisionPreparation&&{status:view.durable.revisionPreparation.status,error:String(view.durable.revisionPreparation.error)}}));await new Promise(resolve=>setTimeout(resolve,50));}}
