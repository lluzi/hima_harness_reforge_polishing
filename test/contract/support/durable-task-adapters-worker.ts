import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, cp, realpath, utimes,chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.join(root, 'packages/harness/lib');
const at=(file:string)=>import(pathToFileURL(path.join(lib,file+'.js')).href);
const require=createRequire(path.join(root,'packages/harness/package.json'));
const {stringify}=require('yaml');
const {resolveDurableTaskAdapter}=await at('durable-task-adapters');
const {flowWorkflowDefinitions,startFlow,controlFlow}=await at('flow-workflow');
const {compileLegacyGrowth}=await at('flow-compiler');
const {startLocalDatabase}=await at('local-database');
const {startDurableRuntime}=await at('durable-runtime');
const {loadPack}=await at('packs');
const {loadSite}=await at('sites');
const {jsonDigest}=await at('run-store');
const {executeTaskEffect,taskEffectAdapterVersion}=await at('task-effects');
const {judgeReading}=await at('judge');
const home=await realpath(process.argv[2]!),workspace=path.join(home,'workspace'),sitesDir=path.join(home,'sites'),packsDir=path.join(home,'packs'),packDir=path.join(packsDir,'bridge-fixture'),frozen=path.join(home,'frozen','bridge-fixture');
for(const dir of [workspace,sitesDir,path.join(packDir,'tools'),path.join(packDir,'readers'),path.join(packDir,'rules'),path.join(packDir,'choosers')])await mkdir(dir,{recursive:true});
const producer=path.join(workspace,'produce.py');
await writeFile(producer,`import pathlib,json,sys\np=pathlib.Path(sys.argv[1]);source=json.loads(pathlib.Path(sys.argv[2]).read_text())\n(p/'program-calls').open('a').write('original\\n')\n(p/'report.json').write_text(json.dumps({'values':[{'type':'setup_wns','unit':'ns','mode':'setup','scope':'all','value':source['slack']}, {'type':'clock_period','unit':'ns','value':source['period']}]}))\n`);
await writeFile(path.join(packDir,'tools/produce.py'),await readFile(producer));
const reader=`import pathlib,json,sys\nreport,out,workspace=sys.argv[1:4]\np=pathlib.Path(workspace)\np.joinpath('reader-calls').open('a').write('original\\n')\npathlib.Path(out).write_text(json.dumps(json.loads(pathlib.Path(report).read_text())))\n`;
await writeFile(path.join(packDir,'tools/read.py'),reader);
await writeFile(path.join(packDir,'readers/fixture.yml'),stringify({id:'fixture',version:'1',reportKind:'fixture',emits:['setup_wns','clock_period'],file:'tools/read.py',argv:['/usr/bin/python3','${READER}','${REPORT}','${OUT}','${WORKSPACE}']}));
for(const [id,type,scope,threshold] of [['constraint','setup_wns','all',0],['goal','clock_period','clock',1]] as const)await writeFile(path.join(packDir,`rules/${id}.yml`),stringify({id,version:'1',title:id,...(id==='goal'?{parameter:{name:'periodNs',unit:'ns'}}:{}),requires:[{type,...(id==='goal'?{}:{mode:'setup',scope})}],subject:{type,...(id==='goal'?{}:{mode:'setup',scope})},predicate:{op:id==='goal'?'lte':'gte',threshold:id==='goal'?{parameter:'periodNs'}:threshold,unit:'ns'}}));
await writeFile(path.join(packDir,'choosers/fixture.yml'),stringify({id:'fixture',version:'1',title:'Actual period improvement',parameter:{name:'stepNs',unit:'ns'},reads:{period:{type:'clock_period',unit:'ns'}},decide:[{when:{constraint:'PASS',goal:'PASS'},goalMet:true},{when:{constraint:'PASS',goal:'FAIL'},next:{periodNs:{sum:['period',{neg:'stepNs'}]}}}]}));
const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
await writeFile(path.join(packDir,'contract.yml'),stringify({id:'bridge-fixture',version:'1',title:'Bridge fixture',inputs:[{name:'workspaceRoot'},{name:'SOURCE'}],outputs:[{name:'timing',path:'report.json',reader:'fixture',description:'Measured timing'}],goal:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:1}},strategy:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:2}},tools:[{id:'produce',file:'tools/produce.py',inputs:['SOURCE','WORKSPACE'],argv:['/usr/bin/python3',producer,'${WORKSPACE}','${SOURCE}'],licences:{fixture:1}}],environment:{wrappers:['/usr/bin/python3']},workspace:{copy:[]}}));
await writeFile(path.join(packDir,'graph.yml'),stringify({id:'bridge-fixture',version:'1',entry:'produce',nodes:[{id:'produce',kind:'act',parameters:{tool:'produce',arguments:{SOURCE:{from:'input',name:'SOURCE'}}}},{id:'read',kind:'act',parameters:{observes:'timing'}},{id:'judge',kind:'judge',parameters:{rules:['constraint','goal'],bind:{periodNs:{from:'goal',name:'periodNs'}}}},{id:'choose',kind:'explore',parameters:{chooser:'fixture',bind:{stepNs:0.25},growth:true}}],edges:[{from:'produce',to:'read'},{from:'read',to:'judge'},{from:'judge',to:'choose',outcome:'PASS'},{from:'choose',to:'produce',revisit:true}]}));
await mkdir(path.dirname(frozen),{recursive:true});await cp(packDir,frozen,{recursive:true});
await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,frozen],allowedWriteRoots:[workspace],allowedWrappers:['/usr/bin/python3'],forbidden:['services','licences','network','deletions','downloads']}));
await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{fixture:1}}}));
const pack=loadPack(path.dirname(frozen),'bridge-fixture'),site=loadSite(sitesDir,'local'),flow=pack.flow;
// The installed/latest Pack is deliberately changed after the original frozen Run preparation.
await writeFile(path.join(packDir,'tools/read.py'),'raise Exception("wrong installed Reader")\n');
await writeFile(path.join(packDir,'rules/goal.yml'),stringify({id:'goal',version:'2',title:'Wrong latest goal',requires:[{type:'clock_period',}],subject:{type:'clock_period',},predicate:{op:'lte',threshold:99,unit:'ns'}}));
const input={SOURCE:path.join(workspace,'source.json')};await writeFile(input.SOURCE,JSON.stringify({slack:0.1,period:2}));
const deps={ctx:{} as any,sitesDir,retainedMaterialsDir:path.join(home,'retained')};
const database=await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
let runtime:any;
let growthFragment:any;
try {
 runtime=await startDurableRuntime({database,manifest:{files:{bridge:'6'.repeat(64)},adapters:{bridge:taskEffectAdapterVersion}},workflows:flowWorkflowDefinitions({resolveAdapter:(context:any)=>resolveDurableTaskAdapter(context,deps)})});
 const run=await runtime.store.createRun({runId:'bridge-negative',inputSha256:jsonDigest(input),applicationVersion:runtime.applicationVersion,owner:'original-parent',deadlineAt:'2099-01-01T00:00:00.000Z',data:{product:{campaignId:'bridge-campaign',siteId:'local',siteDigest:jsonDigest(site),workspace,bindings:{workspaceRoot:workspace},method:{packId:pack.id,packDigest:flow.packSha256,retainedPackDir:frozen},parentSessionId:'original-parent',modelSelection:{provider:'replay',model:'fixture'}},budget:{generationLimit:1}}});
 const handle=await startFlow(runtime,{runId:run.runId,flow,runInput:input,goal:{periodNs:1},strategy:{periodNs:2}});
 let timer:any; const finished:any=await Promise.race([handle.getResult(),new Promise((_,reject)=>{timer=setTimeout(async()=>reject(new Error('Flow timed out: '+JSON.stringify(await runtime.store.flowProjection(run.runId)))),20000);})]);clearTimeout(timer);assert.equal(finished.state,'succeeded',JSON.stringify(finished));
 const read=finished.committed.read.value.observations[0],judge=finished.committed.judge.value,choice=finished.committed.choose.value;
 assert.equal(read.values[0].value,0.1);assert.equal(read.values[1].value,2);assert.ok(read.retainedPath);
 assert.equal(judge.outcome,'PASS');assert.deepEqual(judge.verdicts.map((row:any)=>row.outcome),['PASS','FAIL']);assert.deepEqual(judge.verdicts[1].cites,[read.id]);
 assert.equal(choice.goalMet,false);assert.equal(choice.route,'stop');assert.equal(choice.outcome,'generation-limit');assert.equal(choice.strategy.periodNs,1.75);
 assert.equal(choice.chooserOrigin,'pack');assert.ok(choice.cites.includes(read.id));assert.equal(await readFile(path.join(workspace,'program-calls'),'utf8'),'original\n');assert.equal(await readFile(path.join(workspace,'reader-calls'),'utf8'),'original\n');
 const again=await (await startFlow(runtime,{runId:run.runId,flow,runInput:input,goal:{periodNs:1},strategy:{periodNs:2}})).getResult();assert.deepEqual(again,finished);
 // Characterize immutable Pack I/O separately from actual mutable admission.
 const pollContext={runtime,flow,task:flow.tasks.read,request:{identity:finished.committed.read.identity,admission:{runId:run.runId,effectId:finished.committed.read.identity.effectId,owner:run.owner,epoch:run.epoch,revision:0},input:{},contract:flow.tasks.read.contract},invocation:{iterations:[],branches:[],extensions:[],revision:0},committed:finished.committed,extensionResults:{},namedResults:{},bindings:{runInput:input,goal:{},strategy:{periodNs:2},carry:{}}};
 const syncFs=(await import('node:fs')).default,{syncBuiltinESMExports}=await import('node:module'),saved={open:syncFs.openSync,read:syncFs.readFileSync,close:syncFs.closeSync},opened=new Map<number,string>(),packReads:number[]=[],methodReads:number[]=[];let reads=0,hydrations=0;const methodFactId=`hima-fact:${jsonDigest(['flow-fact',run.runId,'product-method:'+flow.packSha256])}`,savedFact=runtime.store.fact.bind(runtime.store);runtime.store.fact=async(id:string)=>{if(id===methodFactId)hydrations++;return savedFact(id);};
 syncFs.openSync=((file:any,...args:any[])=>{const fd=(saved.open as any)(file,...args);opened.set(fd,String(file));return fd;}) as any;syncFs.readFileSync=((file:any,...args:any[])=>{if(String(opened.get(file)??file).startsWith(frozen+'/'))reads++;return (saved.read as any)(file,...args);}) as any;syncFs.closeSync=((fd:number)=>{opened.delete(fd);return saved.close(fd);}) as any;syncBuiltinESMExports();
 try{for(let i=0;i<3;i++){const before=reads,priorHydrations=hydrations;await resolveDurableTaskAdapter(pollContext,deps);packReads.push(reads-before);methodReads.push(hydrations-priorHydrations);}}finally{syncFs.openSync=saved.open;syncFs.readFileSync=saved.read;syncFs.closeSync=saved.close;syncBuiltinESMExports();runtime.store.fact=savedFact;}
 const methodFact=await runtime.store.fact(`hima-fact:${jsonDigest(['flow-fact',run.runId,'product-method:'+flow.packSha256])}`);console.error('Frozen method snapshot',JSON.stringify({factId:methodFact.factId,packSha256:flow.packSha256,jsonBytes:Buffer.byteLength(JSON.stringify(methodFact.payload.value)),files:methodFact.payload.value.files.length}));
 console.error('Immutable Pack reads per readonly materialization:',JSON.stringify(packReads));console.error('Cold frozen method fact hydrations:',JSON.stringify(methodReads));assert.deepEqual(methodReads,[1,0,0],'Parsed Pack stays in this effect lifetime rather than decoding and parsing each poll');assert.deepEqual(packReads,[0,0,0],'Reconciliation reuses verified parsed Pack, without reopening complete folder');
 const goalRule={id:'goal',version:'1',title:'Goal',requires:[{type:'clock_period',}],subject:{type:'clock_period',},predicate:{op:'lte',threshold:1,unit:'ns'}};
 const unknown=judgeReading(run.runId,goalRule,[{...read,values:[{type:'clock_period',unit:'ns',value:null,unknownReason:'Report did not state period'}]}]);assert.equal(unknown.outcome,'UNDETERMINED');assert.match(unknown.reason,/Report did not state period/);
 // The original chooser result stays negative; an actual frozen diagnostic fragment returns
 // newly read evidence to the compiler-generated continuation and changes only its new decision.
 const diagnosticSource=path.join(workspace,'diagnostic-source.json');await writeFile(diagnosticSource,JSON.stringify({slack:0.2,period:0.5}));
 growthFragment=compileLegacyGrowth(pack,{proposalId:'bounded-diagnostic',method:{id:pack.id,version:pack.contract.version,digest:flow.packSha256},parent:{nodeId:'choose',generation:1},inputThroughSeq:0,inputs:[{recordId:read.id,contentIdentity:read.contentSha256}],impactNodes:['choose'],expectedChanges:['Read the separately produced diagnostic timing'],nodes:[{id:'diagnose',kind:'act',parameters:{tool:'produce',arguments:{SOURCE:diagnosticSource}}},{id:'read-diagnostic',kind:'act',parameters:{observes:'timing'}}],edges:[{from:'diagnose',to:'read-diagnostic'},{from:'read-diagnostic',to:'choose'}],requiredOutputs:['timing'],endCondition:'Read the diagnostic before returning',returnNode:'choose',optional:false});
 const growthControl=await controlFlow(runtime,{runId:run.runId,commandId:'accept-frozen-diagnostic-input',action:'revise',owner:run.owner,epoch:run.epoch,revision:run.revision,change:{taskId:'choose',effectId:finished.committed.choose.identity.effectId,input:{extension:growthFragment},evidence:{acceptedProposal:growthFragment.proposalId}}});
 const growthReceipt=await growthControl.getResult();assert.equal(growthReceipt.run.revision,1);
 const growth=await (await startFlow(runtime,{runId:run.runId,flow,runInput:input,goal:{periodNs:1},strategy:{periodNs:2}})).getResult();assert.equal(growth.state,'succeeded',JSON.stringify(growth));
 assert.equal(growth.committed.choose.value.goalMet,false);assert.ok(growth.committed.choose.value.extension);
 assert.notEqual(growth.committed.choose.identity.effectId,finished.committed.choose.identity.effectId);
 assert.equal((await runtime.store.result(finished.committed.choose.identity.effectId)).value.goalMet,false);
 const resumed=growth.committed['@choose/growth-resume'];assert.equal(resumed.value.goalMet,true);assert.equal(resumed.value.outcome,'goal-met');assert.equal(resumed.value.route,'stop');
 assert.deepEqual(resumed.value.verdicts.map((row:any)=>row.outcome),['PASS','PASS']);
 assert.equal(growth.extensionResults['@choose/growth'].requiredOutputs.timing.observations[0].values[1].value,0.5);
 assert.equal((await runtime.store.result(growth.committed.choose.identity.effectId)).value.goalMet,false);
 assert.equal(await readFile(path.join(workspace,'program-calls'),'utf8'),'original\noriginal\n');
 assert.equal(await readFile(path.join(workspace,'reader-calls'),'utf8'),'original\noriginal\n');
 // Optional failed diagnostic returns no fabricated evidence; the real domain continuation
 // records a new unchanged ordinary chooser decision and leaves the original output immutable.
 const failedFragment=compileLegacyGrowth(pack,{proposalId:'optional-failed-diagnostic',method:{id:pack.id,version:pack.contract.version,digest:flow.packSha256},parent:{nodeId:'choose',generation:1},inputThroughSeq:0,inputs:[{recordId:read.id,contentIdentity:read.contentSha256}],impactNodes:['choose'],expectedChanges:['Try one optional actual diagnostic'],nodes:[{id:'failed-diagnose',kind:'act',parameters:{tool:'produce',arguments:{SOURCE:path.join(workspace,'absent-diagnostic.json')}}},{id:'failed-read',kind:'act',parameters:{observes:'timing'}}],edges:[{from:'failed-diagnose',to:'failed-read'},{from:'failed-read',to:'choose'}],requiredOutputs:['timing'],endCondition:'Return honest optional failure',returnNode:'choose',optional:true});
 const failedControl=await controlFlow(runtime,{runId:run.runId,commandId:'accept-optional-failed-input',action:'revise',owner:run.owner,epoch:run.epoch,revision:1,change:{taskId:'choose',effectId:growth.committed.choose.identity.effectId,input:{extension:failedFragment},evidence:{acceptedProposal:failedFragment.proposalId}}});await failedControl.getResult();
 const optionalOutcome=await (await startFlow(runtime,{runId:run.runId,flow,runInput:input,goal:{periodNs:1},strategy:{periodNs:2}})).getResult();assert.equal(optionalOutcome.state,'succeeded',JSON.stringify(optionalOutcome));
 const optionalProducer=optionalOutcome.committed.choose,optionalResume=optionalOutcome.committed['@choose/growth-resume'];
 assert.equal(optionalOutcome.extensionResults['@choose/growth'].status,'failed');assert.equal(optionalOutcome.extensionResults['@choose/growth'].requiredOutputs,undefined);
 assert.equal(optionalResume.value.optionalDiagnostic.status,'failed');assert.equal(optionalResume.value.goalMet,optionalProducer.value.goalMet);assert.equal(optionalResume.value.route,optionalProducer.value.route);assert.deepEqual(optionalResume.value.strategy,optionalProducer.value.strategy);assert.notEqual(optionalResume.identity.effectId,optionalProducer.identity.effectId);
 assert.equal((await runtime.store.result(finished.committed.choose.identity.effectId)).value.goalMet,false);assert.equal((await runtime.store.run(run.runId)).cancelled,false);
 // Already accepted Workshop entry revisions use actual retained programs, not another model.
 const workshopDir=path.join(home,'frozen/workshop-fixture');for(const dir of ['tools','readers'])await mkdir(path.join(workshopDir,dir),{recursive:true});
 await writeFile(path.join(workshopDir,'tools/read.py'),reader.replace('import pathlib,json,sys','import pathlib,json,sys,time').replace('report,out,workspace=sys.argv[1:4]','report,out,workspace=sys.argv[1:4]\ntime.sleep(1)'));
 await writeFile(path.join(workshopDir,'readers/fixture.yml'),await readFile(path.join(frozen,'readers/fixture.yml')));
 await writeFile(path.join(workshopDir,'contract.yml'),stringify({id:'workshop-fixture',version:'1',title:'Approved program',inputs:[{name:'workspaceRoot'}],outputs:[{name:'timing',path:'workshop-report.json',reader:'fixture',description:'Original timed result'}],strategy:{mode:{type:'choice',options:['fixture'],default:'fixture'}},environment:{wrappers:['/bin/sh','/usr/bin/python3']},workspace:{copy:[]},workshops:[{id:'analysis',purpose:'Produce the declared report',directory:'analysis',entry:'entry.sh',language:'sh',inputs:[],reads:[],knowledge:[],produces:'timing',argv:['/bin/sh','${ENTRY}','${WORKSPACE}'],licences:{}}]}));
 await writeFile(path.join(workshopDir,'graph.yml'),stringify({id:'workshop-fixture',version:'1',entry:'analyze',nodes:[{id:'analyze',kind:'act',parameters:{workshop:'analysis'}}],edges:[]}));
 await writeFile(path.join(sitesDir,'workshop.permit.yml'),stringify({allowedReadRoots:[workspace,workshopDir],allowedWriteRoots:[workspace],allowedWrappers:['/bin/sh','/usr/bin/python3'],forbidden:['services','licences','network','deletions','downloads']}));
 await writeFile(path.join(sitesDir,'workshop.yml'),stringify({name:'workshop',kind:'local',workspaceRoot:workspace,permit:'./workshop.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:1,licences:{}}}));
 const workshopPack=loadPack(path.dirname(workshopDir),'workshop-fixture'),workshopSite=loadSite(sitesDir,'workshop'),workshopFlow=workshopPack.flow;
 const digest=(text:string)=>createHash('sha256').update(text).digest('hex'),report=path.join(workspace,'workshop-report.json');
 const originalReport=await readFile(path.join(workspace,'report.json'));
 async function approvedRun(id:string,entry:string,helper?:string,pendingReady=false) {
  await writeFile(report,originalReport);await utimes(report,new Date('2000-01-01'),new Date('2000-01-01'));
  const run=await runtime.store.createRun({runId:id,inputSha256:jsonDigest({}),applicationVersion:runtime.applicationVersion,owner:'original-parent',deadlineAt:'2099-01-01T00:00:00.000Z',data:{budget:{generationLimit:1},product:{campaignId:id,siteId:'workshop',siteDigest:jsonDigest(workshopSite),workspace,bindings:{workspaceRoot:workspace},method:{packId:workshopPack.id,packDigest:workshopFlow.packSha256,retainedPackDir:workshopDir},parentSessionId:'original-parent',modelSelection:{provider:'replay',model:'fixture'}}}});
  await runtime.store.command({runId:id,commandId:'hold-before-author',action:'pause',owner:run.owner,epoch:0,revision:0});
  await startFlow(runtime,{runId:id,flow:workshopFlow,runInput:{},goal:{},strategy:{mode:'fixture'}});
  let original:any;for(let n=0;n<300;n++){original=(await runtime.store.flowInvocations(id))[0];if(original)break;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(original);
  const revisionId='seed-'+id,changes=[];
  for(const [logicalPath,content] of [['entry.sh',entry],...(helper?[['helper.sh',helper]]:[])] as [string,string][]) {
    const source=path.join(workspace,id+'-'+logicalPath+'-original');await writeFile(source,'exit 0\n');
    changes.push({nodeId:'analyze',scope:'workshop',logicalPath,sourcePath:source,beforeSha256:digest('exit 0\n'),content});
  }
  const {applyWorkspaceRevision}=await at('workspace');
  // Trusted fixture preparation uses the real retention/verifier; no public evidence.assets
  // alone is granted authority and no fake native author/tool receipt is recorded.
  const assets=await applyWorkspaceRevision(workshopSite,workspace,revisionId,changes,{retainOnly:true,beforeWrite:async()=>{}});
  const commandId='approve-source',selected={flowSha256:workshopFlow.irSha256,taskId:'analyze',iterations:[],branches:[],extensions:(original.context as any).extensions??[]},requestDigest=jsonDigest({id,changes}),assetReadyFact='prepared-revision:'+commandId;
  const evidence={kind:'legacy-revision',commandId,assetReadyFact,workflowId:'fixture-prepared-revision:'+id,proposal:{changedNodes:['analyze']},assets};
  const command={runId:id,commandId,action:'revise',owner:run.owner,epoch:1,revision:0,change:{taskId:'analyze',effectId:original.identity.effectId,input:{},evidence}};
  await runtime.store.putFlowFact(id,'facade-command:'+commandId,{requestDigest,command,revision:{revisionId,changes,assets,branches:[],selected}});
  await (await controlFlow(runtime,command)).getResult();
  const publishReady=()=>runtime.store.putFlowFact(id,assetReadyFact,{commandDigest:jsonDigest(command),requestDigest,taskId:'analyze',effectId:original.identity.effectId,selected,assetsDigest:jsonDigest(assets),assets,revision:1});
  if(!pendingReady)await publishReady();
  await (await controlFlow(runtime,{runId:id,commandId:'run-approved-source',action:'continue',owner:run.owner,epoch:1,revision:1})).getResult();
  return {run,publishReady,handle:await startFlow(runtime,{runId:id,flow:workshopFlow,runInput:{},goal:{},strategy:{mode:'fixture'}})};
 }
 const stale=await approvedRun('approved-stale','exit 0\n');let staleTask:any;
 for(let n=0;n<300;n++){staleTask=(await runtime.store.flowProjection(stale.run.runId)).tasks.find((row:any)=>row.version===1);if(staleTask?.state?.reason?.includes('older than its entry'))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.match(staleTask.state.reason,/older than its entry/);assert.equal(staleTask.result,null);
 assert.equal((await runtime.store.derivedEffects(staleTask.identity)).filter((row:any)=>row.purpose==='collect').length,0,'Stale output never becomes a Reader Job');
 await (await controlFlow(runtime,{runId:stale.run.runId,commandId:'end-stale',action:'cancel',owner:'original-parent',epoch:2,revision:1})).getResult();
 const positive=await approvedRun('approved-touch','/bin/sh "$(dirname "$0")/helper.sh" "$1"\n','touch "$1/workshop-report.json"\n',true);
 let waitingAsset:any;for(let n=0;n<300;n++){waitingAsset=(await runtime.store.flowProjection(positive.run.runId)).tasks.find((row:any)=>row.version===1);if(waitingAsset?.state?.state==='waiting'&&String(waitingAsset.state.reason).includes('revision source bytes'))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.match(waitingAsset.state.reason,/revision source bytes/);assert.equal(await runtime.store.effect(waitingAsset.identity.effectId),undefined,'Pending source preparation reserves no Job/effect slot');
 await positive.publishReady();
 let liveReader:any,approvedTask:any;
 for(let n=0;n<300;n++){approvedTask=(await runtime.store.flowProjection(positive.run.runId)).tasks.find((row:any)=>row.version===1);if(approvedTask&&await runtime.store.effect(approvedTask.identity.effectId)){const readers=(await runtime.store.derivedEffects(approvedTask.identity)).filter((row:any)=>row.purpose==='collect');liveReader=readers[0];if(liveReader&&await runtime.store.effectFact(liveReader.identity.effectId,'submitted')&&approvedTask.state?.state==='running')break;}await new Promise(resolve=>setTimeout(resolve,10));}
 assert.ok(liveReader,'Capacity-one finished program leaves room for its actual Reader');assert.equal(approvedTask.state.state,'running');assert.doesNotMatch(String(approvedTask.state.reason),/Repair|reader-rejected/);
 const delivered=await positive.handle.getResult();assert.equal(delivered.state,'succeeded',JSON.stringify(delivered));
 const approved=delivered.committed.analyze;assert.equal(await readFile(approved.value.observations[0].retainedPath,'utf8'),originalReport.toString());
 assert.equal(Object.keys(approved.value.approvedProgram.sources).length,2);assert.equal(Object.keys(await runtime.store.listExternalEffectFacts(approved.identity,'session:')).length,0,'Approved program creates no native authoring session');
 assert.equal((await runtime.store.effectResources()).filter((lease:any)=>lease.effectId===approved.identity.effectId||lease.effectId===liveReader.identity.effectId).every((lease:any)=>lease.released),true);
 async function reviseApproved(previous:any,changes:[string,string][]) {
  const current=await runtime.store.run(positive.run.runId),original=(await runtime.store.flowInvocations(current.runId)).find((row:any)=>row.identity.effectId===previous.identity.effectId),revisionId='successive-'+String(current.revision+1),commandId=revisionId;
  const sources=await runtime.store.listExternalEffectFacts(previous.identity,'revision-source:');
  const edits=changes.map(([logicalPath,content])=>{const source=sources['revision-source:'+logicalPath];assert.ok(source,'Current selected source is retained');return {nodeId:'analyze',scope:'workshop',logicalPath,sourcePath:source.path,beforeSha256:source.sha256??source.asset.afterSha256,content};});
  const {applyWorkspaceRevision}=await at('workspace'),assets=await applyWorkspaceRevision(workshopSite,workspace,revisionId,edits,{retainOnly:true,beforeWrite:async()=>{}}),selected={flowSha256:workshopFlow.irSha256,taskId:'analyze',iterations:original.context.iterations,branches:original.context.branches,extensions:original.context.extensions??[]},requestDigest=jsonDigest(edits),assetReadyFact='prepared-revision:'+commandId;
  const evidence={kind:'legacy-revision',commandId,assetReadyFact,workflowId:'fixture-'+commandId,proposal:{changedNodes:['analyze']},assets},command={runId:current.runId,commandId,action:'revise',owner:current.owner,epoch:current.epoch,revision:current.revision,change:{taskId:'analyze',effectId:previous.identity.effectId,input:{},evidence}};
  await runtime.store.putFlowFact(current.runId,'facade-command:'+commandId,{requestDigest,command,revision:{revisionId,changes:edits,assets,branches:[],selected}});
  await runtime.store.putFlowFact(current.runId,assetReadyFact,{commandDigest:jsonDigest(command),requestDigest,taskId:'analyze',effectId:previous.identity.effectId,selected,assetsDigest:jsonDigest(assets),assets,revision:current.revision+1});await (await controlFlow(runtime,command)).getResult();
  const result=await (await startFlow(runtime,{runId:current.runId,flow:workshopFlow,runInput:{},goal:{},strategy:{mode:'fixture'}})).getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));return result.committed.analyze;
 }
 const approvedSecond=await reviseApproved(approved,[['entry.sh','# approved revision two\n/bin/sh "$(dirname "$0")/helper.sh" "$1"\n']]);
 const preservedHelper=(await runtime.store.listExternalEffectFacts(approvedSecond.identity,'revision-source:'))['revision-source:helper.sh'];assert.equal(preservedHelper.nodeId,'analyze');assert.equal(preservedHelper.sha256,digest('touch "$1/workshop-report.json"\n'));assert.equal(await readFile(preservedHelper.path,'utf8'),'touch "$1/workshop-report.json"\n');
 const approvedThird=await reviseApproved(approvedSecond,[['entry.sh','# approved revision three\n/bin/sh "$(dirname "$0")/helper.sh" "$1"\n']]);assert.equal(Object.keys(approvedThird.value.approvedProgram.sources).length,2);
 const helperRevision=await reviseApproved(approvedThird,[['helper.sh','touch "$1/workshop-report.json"\nprintf helper-revised > "$1/helper-revised"\n']]);assert.equal(await readFile(path.join(workspace,'helper-revised'),'utf8'),'helper-revised');assert.equal(Object.keys(await runtime.store.listExternalEffectFacts(helperRevision.identity,'session:')).length,0,'Accepted helper edit reuses complete approved retained entry without native reauthoring');
 const canceled=await approvedRun('approved-reader-cancel','touch "$1/workshop-report.json"\n');let canceledTask:any,canceledReader:any,canceledJob:any;
 const {retainedJobState,retainedJobResourcesClosed}=await at('jobs');
 for(let n=0;n<300;n++){canceledTask=(await runtime.store.flowProjection(canceled.run.runId)).tasks.find((row:any)=>row.version===1);if(canceledTask&&await runtime.store.effect(canceledTask.identity.effectId)){canceledReader=(await runtime.store.derivedEffects(canceledTask.identity)).find((row:any)=>row.purpose==='collect');if(canceledReader){canceledJob=await runtime.store.effectFact(canceledReader.identity.effectId,'submitted');if(canceledJob&&(await retainedJobState(workshopSite,canceledJob)).state==='running')break;}}await new Promise(resolve=>setTimeout(resolve,10));}
 assert.ok(canceledJob,'Original slow Reader really runs before cancellation');assert.equal((await retainedJobState(workshopSite,canceledJob)).state,'running');
 const canceledControl=await (await controlFlow(runtime,{runId:canceled.run.runId,commandId:'cancel-original-reader-tree',action:'cancel',owner:'original-parent',epoch:2,revision:1})).getResult();
 assert.ok(canceledControl.cleanup.every((entry:any)=>entry.closed),JSON.stringify(canceledControl));
 assert.equal(await retainedJobResourcesClosed(workshopSite,canceledJob),true,'Cancel proves the original child Reader Job/group stopped');
 assert.equal((await runtime.store.effectResources(canceledReader.identity.effectId)).every((lease:any)=>lease.released),true);
 assert.equal(await runtime.store.result(canceledTask.identity.effectId),undefined,'Cancellation commits no invented delivery');
 // Full ordinary resident task: initial signed native delivery is genuinely Reader-negative.
 // Feedback uses the same ACP/native task; its corrected delivery alone is recollected.
 process.env.HIMA_RESIDENT_TESTING='1';
 const residentDir=path.join(home,'frozen/resident-fixture');for(const dir of ['tools','readers','knowledge'])await mkdir(path.join(residentDir,dir),{recursive:true});
 const wrapper=path.join(root,'sites/linglong-atcs28/templates/resident-engineering-wrapper.py'),native=path.join(workspace,'resident-standin.py'),capability=path.join(workspace,'resident-capability.json');
 await writeFile(native,(await readFile(path.join(root,'sites/linglong-atcs28/tests/fixtures/acp-standin.py'),'utf8')).replace('if "FIX_DELIVERY" in text:', 'if "FIX_DELIVERY" in text or "Correct the rejected delivery/document" in text:'));
 await chmod(native,0o755);
 await writeFile(capability,JSON.stringify({schema:'hima-resident-engineering-capability/1',protocol:'hima-resident-engineering/1',wrapper:{argv:[wrapper,'--capability',capability]},native:{executable:native,version:'1.18.34',argv:[],model:'deepseek/deepseek-flash',protocolVersion:1},sandbox:{kind:'none',testOnly:true,privateWorkspace:'workspace',privateHome:'home'},environment:{inherit:[],set:{},toolPaths:[],credentialReadPaths:[]},delivery:{candidate:'resident-delivery.json'},stopGraceSeconds:1}));
 await writeFile(path.join(residentDir,'tools/reference.py'),'# Frozen reference method, no standalone execution\n');
 await writeFile(path.join(residentDir,'knowledge/method.md'),'Preserve the original engineering task and repair rejected delivery.\n');
 await writeFile(path.join(residentDir,'tools/read.py'),`import pathlib,json,sys\nreport,out,workspace=sys.argv[1:4]\nv=json.loads(pathlib.Path(report).read_text());p=pathlib.Path(workspace)\np.joinpath('resident-reader-calls').open('a').write(v['value']+'\\n')\nif v.get('schema')!='fixture-result/1' or v.get('value')!='native':raise SystemExit('actual fixture Reader rejects negative initial delivery')\npathlib.Path(out).write_text(json.dumps({'values':[{'type':'resident_result','value':1,'unit':'count'}]}))\n`);
 await writeFile(path.join(residentDir,'readers/resident.yml'),stringify({id:'resident',version:'1',reportKind:'fixture-result',emits:['resident_result'],file:'tools/read.py',argv:['/usr/bin/python3','${READER}','${REPORT}','${OUT}','${WORKSPACE}']}));
 await writeFile(path.join(residentDir,'semantics.yml'),stringify({values:{resident_result:{unit:'count',description:'Actual fixture Reader validated delivered result'}}}));
 await writeFile(path.join(residentDir,'contract.yml'),stringify({id:'resident-fixture',version:'1',title:'Same resident repair',strategy:{mode:{type:'choice',options:['fixture'],default:'fixture'}},inputs:[{name:'workspaceRoot'}],outputs:[{name:'baseline',path:'source.json',reader:'raw',description:'Immutable original baseline input'},{name:'result',path:'engineering/result.json',reader:'resident',description:'Actual delivery'}],environment:{wrappers:['/usr/bin/python3']},workspace:{copy:[]},knowledge:[{file:'method.md',purpose:'Original engineering constraints'}],tools:[{id:'engineering',file:'tools/reference.py',description:'DELIVER_BAD_RESULT',inputs:[],argv:['/usr/bin/python3',path.join(residentDir,'tools/reference.py')],licences:{},outsourcing:{role:'resident-engineering-agent',reads:['baseline'],knowledge:['method.md'],produces:'result',artifactPrefix:'engineering'}}]}));
 await writeFile(path.join(residentDir,'graph.yml'),stringify({id:'resident-fixture',version:'1',entry:'engineering',nodes:[{id:'engineering',kind:'act',parameters:{tool:'engineering'}}],edges:[]}));
 await writeFile(path.join(sitesDir,'resident.permit.yml'),stringify({allowedReadRoots:[workspace,residentDir,path.dirname(wrapper)],allowedWriteRoots:[workspace],allowedWrappers:[wrapper,'/usr/bin/python3'],forbidden:['services','licences','network','deletions','downloads']}));
 await writeFile(path.join(sitesDir,'resident.yml'),stringify({name:'resident',kind:'local',workspaceRoot:workspace,permit:'./resident.permit.yml',bindings:{workspaceRoot:workspace,engineeringCapabilities:capability},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{}}}));
 const residentPack=loadPack(path.dirname(residentDir),'resident-fixture'),residentSite=loadSite(sitesDir,'resident');
 const residentRun=await runtime.store.createRun({runId:'resident-auto-reader',inputSha256:jsonDigest({}),applicationVersion:runtime.applicationVersion,owner:'original-parent',deadlineAt:new Date(Date.now()+30000).toISOString(),data:{budget:{generationLimit:1,retryAllowance:0},product:{campaignId:'resident-auto',siteId:'resident',siteDigest:jsonDigest(residentSite),workspace,bindings:{workspaceRoot:workspace,engineeringCapabilities:capability},method:{packId:residentPack.id,packDigest:residentPack.flow.packSha256,retainedPackDir:residentDir},parentSessionId:'original-parent',modelSelection:{provider:'fixture',model:'native'}}}});
 const residentOutcome=await (await startFlow(runtime,{runId:residentRun.runId,flow:residentPack.flow,runInput:{},goal:{},strategy:{mode:'fixture'}})).getResult();
 if(residentOutcome.state!=='succeeded'){const task=(await runtime.store.flowInvocations(residentRun.runId))[0];const prepared=await runtime.store.effectFact(task.identity.effectId,'prepared');const diagnostic={};for(const [label,file] of [['state',path.join(prepared.plan.taskDir,'state.json')],['stderr',path.join(prepared.plan.taskDir,'native/stderr.log')],['joblog',path.join(workspace,prepared.job.session+'.log')]] as const){(diagnostic as any)[label]=await readFile(file,'utf8').catch(()=>'(absent)');}console.error('Resident qualification failure',JSON.stringify({diagnostic,outcome:residentOutcome,projection:await runtime.store.flowProjection(residentRun.runId),facts:await runtime.store.effectSnapshot(task.identity),feedback:await runtime.store.listExternalEffectFacts(task.identity,'delivery-repair:')}));}
 assert.equal(residentOutcome.state,'succeeded',JSON.stringify(residentOutcome));
 const engineeringResult=residentOutcome.committed.engineering,preparedResident=await runtime.store.effectFact(engineeringResult.identity.effectId,'prepared');
 const deliveryFeedback=await runtime.store.listExternalEffectFacts(engineeringResult.identity,'delivery-repair:');assert.equal(Object.keys(deliveryFeedback).length,1,'Once per rejected signed delivery, not a global round cap');
 assert.equal(await readFile(path.join(workspace,'resident-reader-calls'),'utf8'),'bad\nnative\n');
 const requestDir=path.join(preparedResident.plan.taskDir,'requests');const files=await import('node:fs/promises').then(({readdir})=>readdir(requestDir));const requests=await Promise.all(files.map(async(file:string)=>JSON.parse(await readFile(path.join(requestDir,file),'utf8'))));assert.equal(requests.filter((body:any)=>body.requestId.startsWith('auto-delivery-')&&body.operation==='message').length,1);
 const nativeRecords=(await readFile(path.join(preparedResident.plan.taskDir,'native/session-events.jsonl'),'utf8')).trim().split('\n').map((line:string)=>JSON.parse(line));assert.equal(nativeRecords.filter((record:any)=>record.message?.method==='session/new').length,1);assert.equal(nativeRecords.filter((record:any)=>record.message?.method==='session/prompt').length,2,'One original prompt and its one same-task correction');
 assert.equal(JSON.parse(await readFile(path.join(preparedResident.plan.taskDir,'state.json'),'utf8')).sessionId,'native-session-1');
 // The cached method never caches today's Site or actual send admission.
 const originalSiteBytes=await readFile(path.join(sitesDir,'local.yml')),rawSite=require('yaml').parse(originalSiteBytes.toString());await writeFile(path.join(sitesDir,'local.yml'),stringify({...rawSite,capacity:{...rawSite.capacity,cores:rawSite.capacity.cores+1}}));
 const siteChanged=await resolveDurableTaskAdapter(pollContext,deps).catch((error:any)=>error);assert.match(String(siteChanged.message),/Original Site identity changed/);
 await writeFile(path.join(sitesDir,'local.yml'),originalSiteBytes);const warmed=await resolveDurableTaskAdapter(pollContext,deps);await writeFile(path.join(sitesDir,'local.yml'),stringify({...rawSite,capacity:{...rawSite.capacity,cores:rawSite.capacity.cores+1}}));await assert.rejects(warmed.permit({},'submit'),/Original Site identity changed/);await writeFile(path.join(sitesDir,'local.yml'),originalSiteBytes);
 // A corrupt frozen method fails before any task staging or another Job.
 await writeFile(path.join(frozen,'tools/read.py'),'changed original bytes\n');
 const context={runtime,flow,task:flow.tasks.read,request:{identity:finished.committed.read.identity,admission:{runId:run.runId,effectId:finished.committed.read.identity.effectId,owner:run.owner,epoch:run.epoch,revision:run.revision},input:{},contract:flow.tasks.read.contract},invocation:{iterations:[],branches:[],revision:0},committed:finished.committed,extensionResults:{},namedResults:{},bindings:{runInput:input,goal:{},strategy:{periodNs:2},carry:{}}};
 const cached=await resolveDurableTaskAdapter(context,deps);assert.equal('pending' in cached,false);await assert.rejects(cached.permit({},'submit'),/retained method bytes differ/);
 process.send!({ok:true,goalMet:false,originalJobCalls:2,readerCalls:2});
 await new Promise<void>(resolve=>process.once('message',message=>{if((message as any).action==='close')resolve();}));
} finally {await runtime?.stop();await database.stop();process.disconnect?.();}
