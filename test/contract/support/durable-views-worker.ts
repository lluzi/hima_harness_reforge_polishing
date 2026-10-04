// @hima-seam agent wrapped
// Actual private-package Host, local PG and normal Pack facade; no product model requests.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, access, realpath, cp, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { bootInProcess, createRootAgent } from './boot-inprocess.ts';
import { prepareHimaHome, himaHomeSources } from '../../../packages/desktop/src/hima-home.ts';
import { repoRoot } from './dsh-home.ts';
const require=createRequire(path.join(repoRoot,'packages/harness/package.json'));
const {stringify,parse}=require('yaml');
const home=await realpath(process.argv[2]!);const mode=process.argv[3]??'normal';
const packageDir=process.env.HIMA_U7_VIEWS_PACKAGE??path.join(repoRoot,'packages/harness');
const load=(name:string)=>import(pathToFileURL(path.join(packageDir,'lib',`${name}.js`)).href);
const {loadPack,checkPack}=await load('packs');const {loadSite}=await load('sites');
const {newCampaignProposalId,startRun,readExecutionContext,executionAction,controlDurableRun,recoverDurablePreparations}=await load('fabric');
const workspace=path.join(home,'workspace'),sitesDir=path.join(home,'hima/sites'),packsDir=path.join(home,'hima/packs'),packDir=path.join(packsDir,'facade-fixture');
const fresh=!(await exists(path.join(home,'accepted.json')));
process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
if(fresh){
  for(const dir of [workspace,sitesDir,path.join(packDir,'flow')])await mkdir(dir,{recursive:true});
  const script=`import json,pathlib,sys\ni,o,w=sys.argv[1:4]\nx=json.loads(pathlib.Path(i).read_text())\np=pathlib.Path(w)\np.joinpath('program-calls').open('a').write('original\\n')\np.joinpath('delivery.txt').write_text('verified task delivery')\nv={'strict':x['strict'],'period':x['period']}\nif x['target']!=0.5:v['goalMet']=x['period']<=x['target']\npathlib.Path(o).write_text(json.dumps({'schemaVersion':'1','value':v,'artifacts':[{'name':'delivery','path':'delivery.txt','mediaType':'text/plain'}],'diagnostics':[]}))\n`;
  await writeFile(path.join(packDir,'flow/produce.py'),script);
  await writeFile(path.join(packDir,'contract.yml'),stringify({id:'facade-fixture',version:'1',title:'Frozen normal facade method',inputs:[{name:'workspaceRoot'}],outputs:[],words:{periodNs:{label:'Period',unit:'ns'}},goal:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:1}},strategy:{periodNs:{type:'number',unit:'ns',min:0.1,max:10,default:2}},tools:[{id:'produce',file:'flow/produce.py',inputs:['FLOW','TASK_INPUT','TASK_OUTPUT','WORKSPACE'],argv:['/usr/bin/python3','${FLOW}/produce.py','${TASK_INPUT}','${TASK_OUTPUT}','${WORKSPACE}']}],environment:{wrappers:['/usr/bin/python3']},workspace:{source:'pack',copy:['produce.py']}}));
  const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties:{strict:{type:'boolean'},period:{type:'number'},target:{type:'number'}},required:['strict','period','target']}};
  const output={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',additionalProperties:false,properties:{strict:{type:'boolean'},period:{type:'number'},goalMet:{type:'boolean'}},required:['strict','period']}};
  await writeFile(path.join(packDir,'graph.yml'),stringify({schema:'hima-flow/1',id:'facade-fixture',version:'1',flow:{kind:'task',id:'produce',tool:'produce',contract:{input:schema,output},inputs:{strict:{source:'literal',value:false},period:{source:'strategy',path:['periodNs']},target:{source:'goal',path:['periodNs']}}}}));
  await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace,packDir],allowedWriteRoots:[workspace],allowedWrappers:['/usr/bin/python3','sh'],forbidden:['services','licences','network','deletions','downloads']}));
  await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{}}}));
}

const sources={...himaHomeSources(repoRoot),harnessPackage:packageDir,presets:path.join(packageDir,'presets')};
const prepared=await prepareHimaHome({home,root:repoRoot,sources});
const h={home,workspace,profileDir:prepared.profileDir,env:{...process.env,DSH_HOME:home,DSH_AGENTS_HOME:path.join(home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
let host:any;let unblock=()=>{};let unblockCommit=()=>{};let resumeHistory=()=>{};
try {
  host=await bootInProcess(h,{withWebApp:true});
  const service=host.ctx.hima,runtime=service.durable;
  const project=service.ledger.projectDurableFact.bind(service.ledger),historyBarrier=new Promise<void>(resolve=>{resumeHistory=resolve;});
  service.ledger.projectDurableFact=async(...args:any[])=>{await historyBarrier;return project(...args);};
  const dependencies={ledger:service.ledger,judge:service.judge,sitesDir,packsDir,host:host.ctx,durable:runtime,durableModelSelection:host.ctx.get('agentDefaultModel').currentSelection()};
  const owner=await createRootAgent(host.ctx,workspace),guide=await createRootAgent(host.ctx,workspace),otherPath=path.join(home,'foreign');await mkdir(otherPath);const foreign=await createRootAgent(host.ctx,otherPath);
  const pack=loadPack(packsDir,'facade-fixture'),site=loadSite(sitesDir,'local');
  const createRun=runtime.store.createRun.bind(runtime.store);runtime.store.createRun=async(opening:any)=>{const run=await createRun(opening);await controlDurableRun(dependencies,{runId:run.runId,commandId:'initial-view-hold',action:'pause',owner:run.owner,epoch:run.epoch,revision:run.revision,origin:'human'});return runtime.store.run(run.runId);};
  const opening=await service.startRun({pack:pack.id,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:String(owner.id),guideSessionId:String(guide.id),proposalId:newCampaignProposalId(pack,site)});
  const runId=opening.run.id;
  assert.equal(service.ledger.run(runId),undefined,'projector stays delayed');
  const url=host.ctx.connection.authenticatedUrl(`http://127.0.0.1:${host.ctx.webServer.port}`);
  const first=await fetch(url,{redirect:'manual'}),cookie=first.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const get=async(route:string,sessionId=String(guide.id))=>fetch(new URL(`/hima/api${route}${route.includes('?')?'&':'?'}sessionId=${encodeURIComponent(sessionId)}`,url),{headers:{cookie}});
  let foreignSourceReads=0;const fact=runtime.store.fact.bind(runtime.store);runtime.store.fact=async(id:string)=>{foreignSourceReads++;return fact(id);};assert.equal((await get(`/runs/${runId}`,String(foreign.id))).status,403);runtime.store.fact=fact;assert.equal(foreignSourceReads,0,'foreign denial occurs before method/source reads');
  const detail=await get(`/runs/${runId}`);assert.equal(detail.status,200,await detail.clone().text());
  let view=await detail.json() as any;assert.equal(view.run.engine,'dbos/5.2.11');assert.equal(view.run.goalState,'unknown');assert.ok(view.tasks.length);assert.ok(view.run.historyPendingFacts>0,'history backlog is visible while current facts remain usable');
  const listed=await get('/runs');assert.equal(listed.status,200);assert.ok((await listed.json() as any).runs.some((item:any)=>item.id===runId));
  assert.equal((await get(`/runs/${runId}`,String(foreign.id))).status,403);
  const before=await runtime.store.sourceRevision(runId);
  const post=async(body:any)=>fetch(new URL(`/hima/api/runs/${runId}/control`,url),{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  const pause={sessionId:String(guide.id),action:'pause',requestId:'views-pause',expectedEpoch:view.run.control.epoch,expectedRevision:view.run.control.revision};
  const held=await post(pause);assert.equal(held.status,200,await held.clone().text());view=(await held.json() as any).run;
  assert.ok(view.run.control.paused.includes('*'));assert.ok(view.run.sourceRevision>before);
  const context=await get(`/runs/${runId}/context`);assert.equal(context.status,200);const facts=await context.json() as any;assert.deepEqual(facts.run.control.paused,view.run.control.paused);assert.equal('durable' in facts,false);
  const stale=await post({...pause,requestId:'views-stale',action:'continue'});assert.equal(stale.status,409,await stale.text());
  const watermark=await runtime.store.sourceRevision(runId);await runtime.store.projectFacts(async()=>{},runId);assert.equal(await runtime.store.sourceRevision(runId),watermark);
  let entered=false,released=false;let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;unblock=resolve;}),prepareEffect=runtime.store.prepareEffect.bind(runtime.store);
  runtime.store.prepareEffect=async(identity:any,intent:any)=>{if(identity.taskId==='produce'&&!released){entered=true;await barrier;}return prepareEffect(identity,intent);};
  const resume=await post({sessionId:String(guide.id),action:'continue',requestId:'views-continue',expectedEpoch:view.run.control.epoch,expectedRevision:view.run.control.revision});assert.equal(resume.status,200,await resume.clone().text());
  for(let i=0;i<120&&!entered;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(entered,true,'actual task reached pre-effect boundary');
  const pending=await get(`/runs/${runId}`);assert.equal(pending.status,200,await pending.clone().text());const pendingView=await pending.json() as any;assert.ok(pendingView.tasks.some((task:any)=>task.identity&&!task.result));released=true;release();
  for(let i=0;i<120;i++){const response=await get(`/runs/${runId}`);if(response.status!==200){const {createDurableViewReaders}=await load('durable-views');try{await createDurableViewReaders(dependencies).readRunView(runId);}catch(error){throw new Error('HTTP reader source failure: '+(error as Error).stack);}throw new Error('HTTP reader failed without reproducible source error: '+await response.text());}view=await response.json() as any;if(view.tasks.some((task:any)=>task.result)&&view.run.goalState==='not-met')break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.ok(view.tasks.some((task:any)=>task.result));assert.equal(view.run.goalState,'not-met');assert.ok(view.run.sourceRevision>watermark);assert.equal(service.ledger.run(runId),undefined);
  for(const name of ['hima_context','hima_status']) {
    const answer=await host.ctx.tools.execute({callId:`views-${name}`,name,arguments:{run:runId},agent:guide,signal:AbortSignal.timeout(10000)});
    assert.notEqual(answer.isError,true,JSON.stringify(answer));const value=JSON.parse(answer.content.find((item:any)=>item.type==='text').text);
    assert.ok(value.tasks.some((task:any)=>task.result));assert.equal(value.durable,undefined);assert.equal(value.facts?.durable,undefined);
    if(name==='hima_status')assert.equal(value.kind,'run');
  }
  const jobsResponse=await get(`/runs/${runId}/records?type=job`);assert.equal(jobsResponse.status,200);
  const jobs=(await jobsResponse.json() as any).records;assert.ok(jobs.some((record:any)=>record.event==='launched'));assert.ok(jobs.some((record:any)=>record.event==='finished'&&record.exitCode===0));assert.equal(new Set(jobs.map((record:any)=>record.job.session)).size,1);
  const logResponse=await get(`/runs/${runId}/log-tail?node=produce&lines=5`);assert.equal(logResponse.status,200,await logResponse.clone().text());assert.equal((await logResponse.json() as any).session,jobs[0].job.session);
  const taskArtifact=view.tasks.find((task:any)=>task.result).result.artifacts[0];assert.ok(taskArtifact);
  const taskRoute=`/runs/${runId}/assets?effect=${encodeURIComponent(taskArtifact.effectId)}&artifact=${encodeURIComponent(taskArtifact.name)}`;
  assert.equal((await get(taskRoute,String(foreign.id))).status,403);
  const artifactPreview=await get(taskRoute);assert.equal(artifactPreview.status,200,await artifactPreview.clone().text());assert.equal((await artifactPreview.json() as any).asset.text,'verified task delivery');
  const siteFile=path.join(sitesDir,'local.yml'),siteBytes=await readFile(siteFile,'utf8'),changedSite=parse(siteBytes);
  changedSite.capacity.parallelJobs+=1;await writeFile(siteFile,stringify(changedSite));assert.equal((await get(taskRoute)).status,200,'capacity-only Site upgrade preserves hash-verified artifact access');await writeFile(siteFile,siteBytes);
  const artifactDownload=await get(`${taskRoute}&format=download`);assert.equal(artifactDownload.status,200);assert.equal(await artifactDownload.text(),'verified task delivery');
  const taskRoot=(await runtime.store.run(runId)).opening.data.product.workspace,taskFile=path.join(taskRoot,taskArtifact.path);
  const inspectArtifact=async(agent:any,target:unknown)=>host.ctx.tools.execute({callId:`inspect-${String(agent.id)}`,name:'hima_inspect',
    arguments:{requestId:'artifact-inspect',target},agent,signal:AbortSignal.timeout(5000)});
  const artifactAddress={kind:'task-artifact',runId,effectId:taskArtifact.effectId,name:taskArtifact.name};
  for(const agent of [owner,guide]) {
    const inspected=await inspectArtifact(agent,artifactAddress);assert.notEqual(inspected.isError,true,JSON.stringify(inspected));
    const artifactView=JSON.parse(inspected.content.find((part:any)=>part.type==='text').text);
    assert.equal(artifactView.facts.text,'verified task delivery');assert.equal(artifactView.facts.ref.sha256,taskArtifact.sha256);
    assert.equal(artifactView.facts.truncated,false);assert.equal('bytes' in artifactView.facts,false);
  }
  assert.equal((await inspectArtifact(foreign,artifactAddress)).isError,true);
  assert.equal((await inspectArtifact(guide,{...artifactAddress,name:'unknown'})).isError,true);
  assert.equal((await inspectArtifact(guide,{...artifactAddress,effectId:'unrelated-effect'})).isError,true);
  assert.equal((await runtime.store.run(runId)).owner,String(owner.id),'inspection never changes ownership');
  await writeFile(taskFile,'changed delivery');assert.equal((await get(taskRoute)).status,409);
  assert.equal((await inspectArtifact(guide,artifactAddress)).isError,true,'Agent reads enforce the same retained hash');
  await writeFile(taskFile,'verified task delivery');
  assert.equal((await get(`/runs/${runId}/assets?effect=${encodeURIComponent(taskArtifact.effectId)}&artifact=${encodeURIComponent('../escape')}`)).status,409);
  const identity=view.tasks.find((task:any)=>task.result).identity;
  const {createHash}=await import('node:crypto');const bytes=Buffer.from('source evidence'),sha=createHash('sha256').update(bytes).digest('hex');
  const retained=path.join(home,'hima/run-assets/dbos',runId,sha);await mkdir(path.dirname(retained),{recursive:true});await writeFile(retained,bytes);
  await runtime.store.recordExternalEffectFact(identity,'code:views-source',{nodeId:identity.taskId,attempt:1,sessionId:String(owner.id),workshop:'source',path:path.join(workspace,'source.txt'),sha256:sha,bytes:bytes.length,language:'text',retainedPath:retained});
  const records=await (await get(`/runs/${runId}/records?type=code`)).json() as any;assert.equal(records.records.length,1);
  const material=await get(`/runs/${runId}/material/${encodeURIComponent(records.records[0].id)}`);assert.equal(material.status,200,await material.clone().text());assert.equal((await material.json() as any).text,'source evidence');
  await writeFile(retained,'tamper evidence');const changed=await get(`/runs/${runId}/material/${encodeURIComponent(records.records[0].id)}`);assert.equal(changed.status,409,await changed.text());
  const {createDurableViewReaders}=await load('durable-views');const readers=createDurableViewReaders(dependencies,{retainedMaterialsDir:path.join(home,'hima/run-assets/dbos')});
  const {readGuideContext}=await load('guide-context');const guideView=await readGuideContext({ctx:host.ctx,ledger:service.ledger,...readers},{sessionId:String(guide.id),requestId:'views-guide',target:{kind:'run',runId}});assert.equal(guideView.ownedRun,undefined);assert.ok(guideView.facts.tasks.some((task:any)=>task.result&&task.contract&&task.input));assert.equal('durable' in guideView.facts,false);assert.equal(guideView.sourceRevision,await runtime.store.sourceRevision(runId));
  assert.equal(await readers.assignedGuide(String(guide.id),String(owner.id)),true);assert.equal(await readers.assignedGuide(String(guide.id),String(owner.id),'unrelated-child'),false);
  let commitReached=false;const commitResult=runtime.store.commitResult.bind(runtime.store),commitBarrier=new Promise<void>(resolve=>{unblockCommit=resolve;});
  runtime.store.commitResult=async(result:any)=>{if(!commitReached&&result.identity.runId!==runId){commitReached=true;await commitBarrier;}return commitResult(result);};
  runtime.store.createRun=createRun;const unknown=await service.startRun({pack:pack.id,site:'local',goal:{periodNs:0.5},strategy:{periodNs:2},ownerSessionId:String(owner.id),guideSessionId:String(guide.id),proposalId:newCampaignProposalId(pack,site)});
  for(let i=0;i<160&&!commitReached;i++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(commitReached,true);
  const beforeCommit=await(await get(`/runs/${unknown.run.id}`)).json() as any;
  const retainedTask=beforeCommit.tasks.find((task:any)=>task.retainedResult);assert.ok(retainedTask?.retainedResult);assert.equal(retainedTask.result,undefined);assert.notEqual(retainedTask.projection.state,'succeeded');assert.equal(beforeCommit.run.goalState,'unknown');
  const retainedArtifact=retainedTask.retainedResult.artifacts[0];assert.ok(retainedArtifact);
  const retainedFile=await get(`/runs/${unknown.run.id}/assets?effect=${encodeURIComponent(retainedArtifact.effectId)}&artifact=${encodeURIComponent(retainedArtifact.name)}`);assert.equal(retainedFile.status,200);assert.equal((await retainedFile.json() as any).asset.text,'verified task delivery');
  unblockCommit();runtime.store.commitResult=commitResult;
  let unknownView:any;for(let i=0;i<160;i++){const response=await get(`/runs/${unknown.run.id}`);assert.equal(response.status,200,await response.clone().text());unknownView=await response.json();if(unknownView.run.status?.startsWith('ended-'))break;await new Promise(resolve=>setTimeout(resolve,50));}assert.ok(unknownView.tasks.some((task:any)=>task.projection.state==='succeeded'));assert.equal(unknownView.run.goalState,'unknown');assert.notEqual(unknownView.run.status,'ended-goal-met');
  // A real human-wait is actionable through the independent Guide, using the same PG control.
  const graphPath=path.join(packDir,'graph.yml'),graphBytes=await readFile(graphPath,'utf8');
  const humanGraph=parse(graphBytes);humanGraph.flow.tool='builtin/human-wait';
  humanGraph.flow={kind:'parallel',id:'response-scope',branches:{answer:{flow:humanGraph.flow,required:true}},results:{answer:{output:{taskId:'produce',path:[]},required:true}}};
  await writeFile(graphPath,stringify(humanGraph));
  const humanPack=loadPack(packsDir,pack.id), humanRequest={pack:pack.id,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:String(owner.id),guideSessionId:String(guide.id),proposalId:newCampaignProposalId(humanPack,site)};
  const human=await service.startRun(humanRequest);let humanView:any;
  for(let i=0;i<160;i++){const response=await get(`/runs/${human.run.id}`);assert.equal(response.status,200,await response.clone().text());humanView=await response.json();if(humanView.tasks.some((task:any)=>task.projection.reason?.code==='human-response'))break;await new Promise(resolve=>setTimeout(resolve,50));}
  const waiting=humanView.tasks.find((task:any)=>task.projection.reason?.code==='human-response');assert.ok(waiting?.identity&&waiting.contract);
  assert.equal(waiting.tool,'builtin/human-wait');
  for(const action of ['pause','continue']) {
    const response=await fetch(new URL(`/hima/api/runs/${human.run.id}/control`,url),{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({sessionId:String(guide.id),action,nodeId:waiting.taskId,requestId:`scope-${action}`,expectedEpoch:humanView.run.control.epoch,expectedRevision:humanView.run.control.revision})});
    assert.equal(response.status,200,await response.clone().text());humanView=(await response.json() as any).run;
    assert.equal(humanView.run.control.paused.includes(waiting.taskId),action==='pause');
    const context=await(await get(`/runs/${human.run.id}/context`)).json() as any;
    assert.equal(context.holds.some((hold:any)=>hold.scope===waiting.taskId&&hold.source==='human'),action==='pause');
    assert.equal(humanView.tasks.find((task:any)=>task.identity?.effectId===waiting.identity.effectId).tool,'builtin/human-wait');
  }

  const responseRequest=async(response:unknown,requestId:string,sessionId=String(guide.id))=>fetch(new URL(`/hima/api/runs/${human.run.id}/control`,url),{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({sessionId,action:'respond',requestId,expectedEpoch:humanView.run.control.epoch,expectedRevision:humanView.run.control.revision,response})});
  const respond=(value:unknown,requestId:string,sessionId=String(guide.id))=>responseRequest({effectId:waiting.identity.effectId,output:{schemaVersion:waiting.contract.output.version,value,artifacts:[],diagnostics:[]}},requestId,sessionId);
  const malformedRevision=await runtime.store.sourceRevision(human.run.id);
  for(const [index,response] of [undefined,
    {effectId:waiting.identity.effectId,output:{schemaVersion:waiting.contract.output.version,value:{strict:true,period:1},artifacts:[]}},
    {effectId:waiting.identity.effectId,output:{schemaVersion:waiting.contract.output.version,value:{strict:true,period:1},artifacts:[{name:'bad',path:'result.txt',sha256:'not-a-hash'}],diagnostics:[]}},
  ].entries()) {
    const malformed=await responseRequest(response,`malformed-response-${index}`);
    assert.equal(malformed.status,400,await malformed.clone().text());
    const error=await malformed.json() as any;assert.equal(error.error.code,'hima/bad-request');assert.match(error.error.message,/response/);
    assert.equal(await runtime.store.sourceRevision(human.run.id),malformedRevision,'bad envelopes create no control/result facts');
  }
  const deniedResponse=await respond({strict:true,period:1},'foreign-response',String(foreign.id));assert.equal(deniedResponse.status,403);
  const invalidResponse=await respond({unexpected:true},'invalid-response');assert.equal(invalidResponse.status,409,await invalidResponse.text());
  const acceptedResponse=await respond({strict:true,period:1},'valid-response');assert.equal(acceptedResponse.status,200,await acceptedResponse.clone().text());
  for(let i=0;i<160;i++){humanView=await(await get(`/runs/${human.run.id}`)).json();if(humanView.tasks.some((task:any)=>task.result))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.deepEqual(humanView.tasks.find((task:any)=>task.result).result.value,{strict:true,period:1});assert.equal(humanView.run.control.owner,String(owner.id));
  await writeFile(graphPath,graphBytes);
  const ownersBefore=host.ctx.get('agents').list().map((agent:any)=>String(agent.id));
  const duplicate=await service.startGuidedRun({...humanRequest,ownerSessionId:String(guide.id),guideSessionId:undefined});
  assert.equal(duplicate.run.id,human.run.id);assert.deepEqual(host.ctx.get('agents').list().map((agent:any)=>String(agent.id)),ownersBefore);
  await assert.rejects(service.startGuidedRun({...humanRequest,ownerSessionId:String(foreign.id),guideSessionId:undefined}),/another Guide/);
  const installed=path.join(packDir,'contract.yml');await writeFile(installed,(await readFile(installed,'utf8')).replace('Frozen normal facade method','Changed installed method').replace('label: Period','label: Changed period'));
  const frozenDir=(await runtime.store.run(runId)).opening.data.product.method.retainedPackDir;await rename(frozenDir,`${frozenDir}-removed`);
  const stable=await get(`/runs/${runId}`);assert.equal(stable.status,200);const originalView=await stable.json() as any;assert.equal(originalView.run.packVersion,'1');assert.equal(originalView.run.words.goal.periodNs.label,'Period');
  const {runPage}=await load('workbench');assert.match(runPage(unknownView),/ended · Goal unknown/);
  const historicPage=await fetch(new URL(`/hima/?run=${encodeURIComponent(unknown.run.id)}`,url),{headers:{cookie}});assert.equal(historicPage.status,200);assert.match(await historicPage.text(),/Open the native HimaHarness workspace/);
  const legacy=await service.ledger.createRun({campaignId:'legacy-history',siteId:'local',projectSessionId:String(owner.id)});const legacyView=await get(`/runs/${legacy.id}`);assert.equal(legacyView.status,200);const {runView}=await load('remote');assert.deepEqual(await legacyView.json(),runView(service.ledger,legacy));
  // Use the native persisted inbox without invoking a product model. Notification delivery is
  // independent from the deliberately delayed history sink, and durable receipts prevent repeats.
  const notices:any[]=[];
  for(const agent of [owner,guide])agent.followup=(message:any)=>{notices.push({recipient:String(agent.id),message});agent.inbox.append('next-turn',message);};
  process.env.HIMA_TEST_SILENT_AGENT='0';
  for(let i=0;i<160&&notices.length<6;i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(notices.length,6,'three terminal Runs notify owner and independent Guide once each');
  for(const [expectedRunId,goalState] of [[runId,'not-met'],[unknown.run.id,'unknown'],[human.run.id,'unknown']]) {
    for(const recipient of [String(owner.id),String(guide.id)]) {
      const delivered=notices.filter(notice=>notice.recipient===recipient&&JSON.stringify(notice.message).includes(`Hima PostgreSQL Run ${expectedRunId},`));
      assert.equal(delivered.length,1,`one notice for ${expectedRunId} to ${recipient}`);
      const text=delivered[0].message.content.find((part:any)=>part.type==='text').text as string;
      const boundary=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
      assert.equal(boundary.runId,expectedRunId);assert.equal(boundary.goalState,goalState);
      assert.equal(boundary.status,'ended-goal-not-met');
    }
  }
  assert.equal(service.ledger.run(runId),undefined,'notifications do not wait for history projection');
  await new Promise(resolve=>setTimeout(resolve,2200));assert.equal(notices.length,6,'unchanged boundaries and polling do not wake more model turns');
  process.env.HIMA_TEST_SILENT_AGENT='1';resumeHistory();
  for(let i=0;i<160&&!service.ledger.run(runId);i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(service.ledger.run(runId),'ordinary background projector resumes');
  assert.equal(service.ledger.run(runId).control,undefined,'history projection carries no legacy scheduler authority');
  const projected=service.ledger.records({runId,type:'interactive'});assert.equal(new Set(projected.map((record:any)=>record.requestId)).size,projected.length);
  process.send!({ok:true,runId,delayedProjector:true,foreignDenied:true,staleControlDenied:true,sourceWatermark:true,unknownGoal:true,frozenMethod:true,materialHash:true,guideOwnership:true,legacyReads:true,pendingInvocation:true});
} catch(error) {process.send!({ok:false,error:String(error),stack:(error as Error).stack});process.exitCode=1;}
finally {unblock();unblockCommit();resumeHistory();await host?.dispose();}
function exists(at:string){return access(at).then(()=>true,()=>false);}
