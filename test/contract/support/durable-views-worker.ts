// @hima-seam agent wrapped
// Actual private-package Host, local PG and normal Pack facade; no product model requests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access, realpath, cp, rename, rm } from 'node:fs/promises';
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
  let script=`import json,pathlib,sys\ni,o,w=sys.argv[1:4]\nx=json.loads(pathlib.Path(i).read_text())\np=pathlib.Path(w)\np.joinpath('program-calls').open('a').write('original\\n')\np.joinpath('delivery.txt').write_text('verified task delivery')\np.joinpath('package.bin').write_bytes(bytes([0,255,1,128,10]))\nv={'strict':x['strict'],'period':x['period']}\nif x['target']!=0.5:v['goalMet']=x['period']<=x['target']\npathlib.Path(o).write_text(json.dumps({'schemaVersion':'1','value':v,'artifacts':[{'name':'delivery','path':'delivery.txt','mediaType':'text/plain'},{'name':'arbitrary-binary','path':'package.bin','mediaType':'application/octet-stream'}],'diagnostics':[]}))\n`;
  if(mode==='delivery-revision')script=script.replace("write_text('verified task delivery')","write_text('verified task delivery '+str(x['period']))");
  if(mode==='delivery-generated-rename')script=script.replace("'artifacts':[{'name':'delivery','path':'delivery.txt','mediaType':'text/plain'},{'name':'arbitrary-binary','path':'package.bin','mediaType':'application/octet-stream'}]","'artifacts':[]").replace("v={'strict':", "p.joinpath('hima-experience').symlink_to(p.parent.parent/'refused-report',target_is_directory=True)\nv={'strict':");
  if(mode==='exit-projection')script=script.replace("p=pathlib.Path(w)\n","p=pathlib.Path(w)\nif x['period']==7:sys.exit(7)\n");
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
  if(mode==='exit-projection') {
    const owner=await createRootAgent(host.ctx,workspace);
    const {createDurableViewReaders}=await load('durable-views'),readers=createDurableViewReaders(dependencies);
    const url=host.ctx.connection.authenticatedUrl(`http://127.0.0.1:${host.ctx.webServer.port}`);
    const first=await fetch(url,{redirect:'manual'}),cookie=first.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
    const get=async(route:string)=>{
      const response=await fetch(new URL(`/hima/api${route}${route.includes('?')?'&':'?'}sessionId=${encodeURIComponent(String(owner.id))}`,url),{headers:{cookie}});
      assert.equal(response.status,200,await response.clone().text());return response.json() as Promise<any>;
    };
    const record=runtime.store.recordEffectFact.bind(runtime.store);
    const observed=[];
    for(const [label,period,expected] of [['known',7,7],['ready',2,0],['historical',7,undefined]] as const) {
      // Emulate the old writer's exact failure fact shape; retain its real original Job receipt
      // and text (including exit 7) to prove that readers never parse a historical reason.
      runtime.store.recordEffectFact=async(identity:any,phase:string,value:any)=>{
        if(label==='historical'&&phase==='executor-failure'){const {exitCode:_exit,...legacy}=value;return record(identity,phase,legacy);}
        return record(identity,phase,value);
      };
      const opened=await service.startRun({pack:'facade-fixture',site:'local',goal:{periodNs:1},strategy:{periodNs:period},ownerSessionId:String(owner.id)});
      const runId=opened.run.id;let effects:any[]=[];
      for(let i=0;i<200;i++) {
        effects=(await runtime.store.flowPhysicalFacts(runId)).effects.filter((effect:any)=>effect.identity.taskId==='produce');
        const task=(await runtime.store.flowProjection(runId)).tasks.find((item:any)=>item.identity.taskId==='produce');
        if(effects.length&&(await runtime.store.effectSnapshot(effects[0].identity)).resourcesReleased&&task?.state.state===(label==='ready'?'succeeded':'failed'))break;
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      assert.equal(effects.length,1,'one original command effect');const identity=effects[0].identity;
      const snapshot=await runtime.store.effectSnapshot(identity);assert.equal(snapshot.resourcesReleased,true);
      const submitted=await runtime.store.effectFact(identity.effectId,'submitted');assert.ok(submitted);
      const failure=await runtime.store.effectFact(identity.effectId,'executor-failure');
      if(label==='ready'){assert.equal(failure,undefined);assert.ok(await runtime.store.effectFact(identity.effectId,'executor-ready'));}
      else {assert.ok(failure);assert.equal(failure.exitCode,expected,'stored observed exit metadata');assert.deepEqual(failure.receipt,submitted);assert.equal('exitCode' in failure.receipt,false,'receipt remains strict JobIdentity');assert.match(failure.reason,/exited 7/);}
      const records=await readers.readRunRecords(runId,'job');
      const finished=records.filter((item:any)=>item.event==='finished');assert.equal(finished.length,1);
      assert.equal(finished[0].exitCode,expected,'PG Job record retains only observed numeric exit');assert.deepEqual(finished[0].job,submitted);
      const detail=await get(`/runs/${runId}`),publicRecords=await get(`/runs/${runId}/records?type=job`),context=await get(`/runs/${runId}/context`);
      assert.equal(detail.jobs.find((item:any)=>item.event==='finished').exitCode,expected,'public Run Job view');
      assert.equal(publicRecords.records.find((item:any)=>item.event==='finished').exitCode,expected,'public Job history');
      assert.equal(context.tasks.find((item:any)=>item.identity?.effectId===identity.effectId).projection.state,label==='ready'?'succeeded':'failed','public context retains task outcome independently of numeric exit');
      observed.push({label,exitCode:expected??null,session:submitted.session});
    }
    runtime.store.recordEffectFact=record;
    process.send!({ok:true,observed,productModelCalls:0});
  } else if(mode==='delivery-generated-restart') {
    const expected=JSON.parse(await readFile(path.join(home,'accepted.json'),'utf8'));
    const {createDurableViewReaders}=await load('durable-views'),readers=createDurableViewReaders(dependencies);
    let facts:any[]=[];
    for(let i=0;i<200;i++){facts=await readers.readRunRecords(expected.runId);if(facts.some(record=>record.type==='archive'&&record.delivery==='complete'))break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(facts.filter(record=>record.type==='archive'&&record.delivery==='complete').length,1,JSON.stringify(facts));
    assert.equal(facts.filter(record=>record.type==='experience').length,0,'refused Site report does not invent an ExperienceRecord');
    const archive=await readers.readRunAssets(expected.runId);assert.equal(archive.kind,'read');
    assert.equal(await readFile(archive.manifestPath,'utf8'),expected.manifest,'recovery retains exact generated publication');
    assert.equal((await readFile(path.join(expected.workspace,'program-calls'),'utf8')).trim(),'original','completed no-artifact Task is not rerun');
    process.send!({ok:true,generatedPublicationRecovery:true,noTaskRerun:true});
  } else if(mode==='delivery-generated-rename') {
    // The Site owner refuses reports through its existing Permit: this link resolves outside
    // allowedWriteRoots while the ordinary Task workspace stays writable.
    const refused=path.join(home,'refused-report');await mkdir(refused);
    const {default:fs}=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),originalRename=fs.promises.rename;
    fs.promises.rename=async(from:any,to:any)=>{await originalRename(from,to);if(String(from).includes('.stage-')&&String(to).includes('/run-assets/')){
      const manifest=await readFile(path.join(String(to),'manifest.json'),'utf8'),parsed=JSON.parse(manifest),id=parsed.runId;
      assert.deepEqual(parsed.materials.map((item:any)=>item.source),['generated:experience-markdown','generated:experience-json']);
      const view=await runtime.store.flowProjection(id);assert.equal(view.tasks.find((task:any)=>task.result&&task.valid).result.artifacts.length,0);
      assert.equal((await runtime.store.orderedFlowFacts(id,'delivery:experience')).length,0);
      assert.equal((await runtime.store.orderedFlowFacts(id,'delivery-io:closed:')).length,0,'crash barrier precedes IO receipt');
      const current=await runtime.store.run(id),taskWorkspace=current.opening.data.product.workspace;
      await writeFile(path.join(home,'accepted.json'),JSON.stringify({runId:id,manifest,workspace:taskWorkspace}));
      process.send!({ok:true,publishedBeforeIOReceipt:true,reportRefused:true,noArtifacts:true});await new Promise(()=>{});
    }};syncBuiltinESMExports();
    const owner=await createRootAgent(host.ctx,workspace);
    await service.startRun({pack:'facade-fixture',site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:String(owner.id)});
    await new Promise(()=>{});
  } else if(mode==='delivery-restart'||mode==='delivery-reject-restart') {
    const saved=JSON.parse(await readFile(path.join(home,'accepted.json'),'utf8'));
    const {createDurableViewReaders}=await load('durable-views');const readers=createDurableViewReaders(dependencies);
    for(const expected of saved.runs) {
      if(mode==='delivery-reject-restart'&&expected.goalState==='unknown') {
        const archiveDir=path.join(packDir,'run-assets',expected.runId),manifestPath=path.join(archiveDir,'manifest.json');
        const original=JSON.parse(expected.manifest),artifact=original.materials.find((item:any)=>item.source.endsWith(':arbitrary-binary'));
        for(const [index,variant] of ['wrong','missing','extra'].entries()) {
          const candidate=JSON.parse(expected.manifest);
          if(variant==='wrong')candidate.materials.find((item:any)=>item.path===artifact.path).source='task-artifact:wrong-original-identity';
          if(variant==='missing')candidate.materials=candidate.materials.filter((item:any)=>item.path!==artifact.path);
          if(variant==='extra'){candidate.materials.push({...artifact,path:'materials/extra.dat',source:'task-artifact:extra-original-identity'});await cp(path.join(archiveDir,artifact.path),path.join(archiveDir,'materials/extra.dat'));}
          await writeFile(manifestPath,JSON.stringify(candidate,null,2)+'\n');
          const refused=await readers.finalizeDelivery(expected.runId,0,1000+index);assert.equal(refused.complete,false,`published ${variant} source set must be refused`);
          assert.equal((await readers.readRunRecords(expected.runId,'archive')).filter((record:any)=>record.delivery==='complete').length,0);
        }
        await writeFile(manifestPath,JSON.stringify(original,null,2)+'\n');await rm(path.join(archiveDir,'materials/extra.dat'),{force:true});
      }

      for(let i=0;i<200;i++){if((await readers.readRunAssets(expected.runId)).kind==='read')break;await new Promise(resolve=>setTimeout(resolve,50));}
      if(saved.interrupted){assert.equal((await readFile(path.join(expected.workspace,'program-calls'),'utf8')).trim(),'original','workflow replay does not reexecute completed Task');await rename(expected.workspace,expected.workspace+'-offline');}
      const report=await readers.readExperience(expected.runId);assert.equal(report.kind,'read',JSON.stringify(report));assert.equal(report.json.goalState,expected.goalState);
      const archive=await readers.readRunAssets(expected.runId);assert.equal(archive.kind,'read');assert.deepEqual(archive.manifest,JSON.parse(expected.manifest));
      assert.equal(createHash('sha256').update(await readFile(archive.manifestPath)).digest('hex'),expected.manifestSha,'restart preserves the exact published manifest bytes');
      assert.equal(report.record.json.sha256,expected.reportSha);const bytes=await readers.readTaskArtifact(expected.runId,expected.effectId,'arbitrary-binary');assert.deepEqual([...bytes.bytes],[0,255,1,128,10]);
      const facts=await readers.readRunRecords(expected.runId);assert.equal(facts.filter((record:any)=>record.type==='archive'&&record.delivery==='complete').length,1);
      assert.equal(facts.filter((record:any)=>record.type==='experience').length,1);
    }
    process.send!({ok:true,restarted:true,archiveFallback:true,identitiesStable:true});
  } else {
  let deliveryWriteEntered=false,releaseDeliveryWrite=()=>{};
  if(mode==='delivery-drain') {
    const {LocalChannel}=await load('channel'),exec=LocalChannel.prototype.exec;
    const barrier=new Promise<void>(resolve=>{releaseDeliveryWrite=resolve;unblock=resolve;});
    LocalChannel.prototype.exec=async function(argv:any,options:any){if(!deliveryWriteEntered&&argv[0]==='tee'&&argv.some((value:any)=>String(value).includes('/hima-experience/'))){deliveryWriteEntered=true;await barrier;}return exec.call(this,argv,options);};
  }
  const owner=await createRootAgent(host.ctx,workspace),guide=await createRootAgent(host.ctx,workspace),otherPath=path.join(home,'foreign');await mkdir(otherPath);const foreign=await createRootAgent(host.ctx,otherPath);
  const pack=loadPack(packsDir,'facade-fixture'),site=loadSite(sitesDir,'local');
  const createRun=runtime.store.createRun.bind(runtime.store);runtime.store.createRun=async(opening:any)=>{const run=await createRun(opening);await controlDurableRun(dependencies,{runId:run.runId,commandId:'initial-view-hold',action:'pause',owner:run.owner,epoch:run.epoch,revision:run.revision,origin:'human'});return runtime.store.run(run.runId);};
  let nativeRetainedPath:string|undefined,nativeOriginalBytes:Buffer|undefined;
  if(mode.startsWith('delivery-native-')) {
    const commit=runtime.store.commitResult.bind(runtime.store);let captured=false;
    runtime.store.commitResult=async(result:any)=>{if(!captured){captured=true;const {createHash}=await import('node:crypto'),bytes=await readFile(path.join(packDir,'flow/produce.py')),sha256=createHash('sha256').update(bytes).digest('hex'),retainedPath=path.join(home,'hima/run-assets/dbos',result.identity.runId,sha256);await mkdir(path.dirname(retainedPath),{recursive:true});await writeFile(retainedPath,bytes);
      await runtime.store.recordExternalEffectFact(result.identity,'code:delivery-source',{nodeId:result.identity.taskId,attempt:1,sessionId:String(owner.id),workshop:'source',path:path.join(packDir,'flow/produce.py'),sha256,bytes:bytes.length,language:'python',retainedPath});nativeRetainedPath=retainedPath;nativeOriginalBytes=bytes;if(mode==='delivery-native-changed'){const changed=Buffer.from(bytes);changed[0]=changed[0]!^1;await writeFile(retainedPath,changed);}}return commit(result);};
  }
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
  if(mode==='delivery-unavailable') {
    const {createDurableViewReaders}=await load('durable-views'),readers=createDurableViewReaders(dependencies);
    let archive:any;for(let i=0;i<200;i++){archive=await readers.readRunAssets(runId);if(archive.kind==='read')break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(archive.kind,'read','transport fault starts only after real automatic archive completion');
    const task=view.tasks.find((item:any)=>item.result),artifact=task.result.artifacts.find((item:any)=>item.name==='arbitrary-binary');
    const taskRoot=(await runtime.store.run(runId)).opening.data.product.workspace,taskFile=path.join(taskRoot,artifact.path);
    const route=`/runs/${runId}/assets?effect=${encodeURIComponent(task.identity.effectId)}&artifact=arbitrary-binary&format=download`;
    const target={kind:'task-artifact',runId,effectId:task.identity.effectId,name:artifact.name};
    const inspect=async(agent:any,address=target)=>host.ctx.tools.execute({callId:`unavailable-${String(agent.id)}`,name:'hima_inspect',arguments:{requestId:'unavailable-artifact',target:address},agent,signal:AbortSignal.timeout(5000)});
    // A positively present damaged file must still refuse even with a completed archive.
    await writeFile(taskFile,Buffer.from([0,254,1,128,10]));assert.equal((await get(route)).status,409);assert.equal((await inspect(guide)).isError,true);
    await writeFile(taskFile,Buffer.from([0,255,1,128,10]));
    const {LocalChannel}=await load('channel'),{SiteUnreadableError}=await load('errors'),originalExec=LocalChannel.prototype.exec;
    const failedCalls:string[][]=[];
    LocalChannel.prototype.exec=async function(argv:any,options:any){
      const at=String(argv.at(-1));if(at===taskRoot||at.startsWith(taskRoot+path.sep)){
        failedCalls.push([...argv]);
        throw new SiteUnreadableError('local','fixture transport stopped answering after completed delivery');
      }return originalExec.call(this,argv,options);
    };
    try {
      assert.equal((await get(route,String(foreign.id))).status,403);assert.equal((await inspect(foreign)).isError,true);
      const download=await get(route);assert.equal(download.status,200,await download.clone().text());
      assert.deepEqual([...new Uint8Array(await download.arrayBuffer())],[0,255,1,128,10],'HTTP serves exact archived binary');
      for(const agent of [owner,guide]){const answer=await inspect(agent);assert.notEqual(answer.isError,true,JSON.stringify(answer));const facts=JSON.parse(answer.content.find((item:any)=>item.type==='text').text).facts;assert.equal(facts.ref.sha256,artifact.sha256);assert.equal(facts.ref.bytes,5);assert.equal(facts.text,undefined);}
      assert.equal((await inspect(guide,{...target,effectId:'foreign-effect'})).isError,true);
      // The retained reader starts with the Campaign-root symlink check; its throw prevents
      // later read commands. Fallback then throws at -e before it can ask the -L alternative.
      assert.ok(failedCalls.some(argv=>argv[0]==='test'&&argv[1]==='-L'&&argv[2]===taskRoot),'retained reader failed at its real Campaign-root check');
      assert.ok(failedCalls.some(argv=>argv[0]==='test'&&argv[1]==='-e'&&argv[2]===taskFile),'fallback existence probe failed at the original artifact');
      console.log('Transport fault calls:',JSON.stringify(failedCalls.map(argv=>[...argv.slice(0,-1),argv.at(-1)===taskRoot?'Campaign-root':artifact.path])));
    } finally {LocalChannel.prototype.exec=originalExec;}
    assert.equal((await readFile(path.join(taskRoot,'program-calls'),'utf8')).trim(),'original');
    process.send!({ok:true,completedArchive:true,transportUnknown:true,binaryHttp:true,publicInspect:true,changedPresentDenied:true,foreignDenied:true,transportFaultCalls:failedCalls.length});
  } else if(mode==='delivery-revision') {
    const {createDurableViewReaders}=await load('durable-views');const readers=createDurableViewReaders(dependencies);
    for(let i=0;i<200&&(await readers.readRunAssets(runId)).kind!=='read';i++)await new Promise(resolve=>setTimeout(resolve,50));
    const original=await readers.readExperience(runId);assert.equal(original.kind,'read');assert.equal(original.json.goalState,'not-met');
    const current=await runtime.store.run(runId),task=view.tasks.find((item:any)=>item.result);
    await controlDurableRun(dependencies,{runId,commandId:'delivery-revision',action:'revise',owner:current.owner,epoch:current.epoch,revision:current.revision,origin:'human',change:{taskId:'produce',effectId:task.identity.effectId,input:{strict:false,period:0.75,target:1},evidence:{reason:'Verify the supported revised result after completed delivery'}}});
    for(let i=0;i<200;i++){const outcome=await runtime.store.flowFact(runId,'outcome:1');if(outcome?.state==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,50));}
    let revised:any;for(let i=0;i<200;i++){revised=await readers.readExperience(runId);if(revised.kind==='read'&&revised.json.goalState==='met')break;await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(revised.kind,'read');assert.equal(revised.json.goalState,'met','current reader must serve revision 1 rather than original Goal-false report');
    assert.notEqual(revised.record.json.sha256,original.record.json.sha256);const old=await readers.readExperience(runId,0);assert.equal(old.kind,'read');assert.equal(old.record.json.sha256,original.record.json.sha256);assert.equal(old.json.goalState,'not-met');
    assert.equal(revised.json.revision,1);assert.equal(old.json.revision??0,0);
    const outcome=await runtime.store.fact((await runtime.store.orderedFlowFacts(runId,'outcome:')).find((item:any)=>item.name==='outcome:1').source.factId);assert.equal(revised.json.writtenAt,outcome.at);
    const oldHttp=await get(`/runs/${runId}/experience?revision=0`);assert.equal(oldHttp.status,200);assert.equal((await oldHttp.json() as any).report.goalState,'not-met');
    const currentHttp=await get(`/runs/${runId}/experience`);assert.equal(currentHttp.status,200);assert.equal((await currentHttp.json() as any).report.goalState,'met');
    const {readGuideContext}=await load('guide-context');const guideReport=await readGuideContext({ctx:host.ctx,ledger:service.ledger,...readers},{sessionId:String(guide.id),requestId:'historical-report',target:{kind:'report',reportRef:original.record.id,version:String(original.record.seq),sha256:original.record.json.sha256}});assert.ok(guideReport.facts,'exact original Guide target still reads revision 0');
    const oldEffect=task.identity.effectId,originalWorkspace=(await runtime.store.run(runId)).opening.data.product.workspace;
    for(let i=0;i<200&&(await readers.readRunAssets(runId)).kind!=='read';i++)await new Promise(resolve=>setTimeout(resolve,50));
    await rename(originalWorkspace,originalWorkspace+'-offline');assert.equal((await readers.readExperience(runId,0)).record.json.sha256,original.record.json.sha256);
    const oldArtifact=await readers.readTaskArtifact(runId,oldEffect,'delivery');assert.equal(oldArtifact.text,'verified task delivery 2');
    const oldArchive=await get(`/runs/${runId}/assets?revision=0`);assert.equal(oldArchive.status,200);
    process.send!({ok:true,currentRevision:1,oldHashPreserved:true,historicalGuide:true,olderArtifactFallback:true,terminalTimestamp:true});
  } else if(mode.startsWith('delivery-native-')) {
    const {createDurableViewReaders}=await load('durable-views');const readers=createDurableViewReaders(dependencies);
    if(mode==='delivery-native-changed') {
      let failed:any;for(let i=0;i<160;i++){failed=await readers.readRunView(runId);if(failed.archive?.delivery==='failed')break;await new Promise(resolve=>setTimeout(resolve,50));}
      assert.equal(failed.archive?.delivery,'failed');assert.match(failed.archive.reason,/hash changed/);assert.ok(failed.tasks.some((task:any)=>task.result&&task.projection.state==='succeeded'));assert.notEqual((await readers.readRunAssets(runId)).kind,'read');
      assert.ok(nativeRetainedPath&&nativeOriginalBytes);await writeFile(nativeRetainedPath,nativeOriginalBytes);
    }
    let archive:any;for(let i=0;i<160;i++){archive=await readers.readRunAssets(runId);const current=await readers.readRunView(runId);if(archive.kind==='read'||mode!=='delivery-native-changed'&&current.archive?.delivery==='failed'){assert.equal(archive.kind,'read',JSON.stringify(current.archive));break;}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(archive.kind,'read');assert.ok(archive.manifest.materials.some((material:any)=>material.type==='code'));
    const records=await readers.readRunRecords(runId,'code'),code=records[0],{readDurableSourceBytes}=await load('durable-views'),root=path.join(home,'hima/run-assets/dbos');assert.deepEqual(await readDurableSourceBytes(root,runId,code),nativeOriginalBytes);
    // L1 byte identity only: this descriptor exercises the observation hash field, not DomainReader meaning.
    assert.deepEqual(await readDurableSourceBytes(root,runId,{type:'observation',runId,bytes:code.bytes,retainedPath:code.retainedPath,contentSha256:code.sha256}),nativeOriginalBytes);
    await assert.rejects(readDurableSourceBytes(root,'foreign-run',{...code,runId:'foreign-run'}),/trusted Run/);
    const changed=Buffer.from(nativeOriginalBytes!);changed[0]=changed[0]!^1;await writeFile(code.retainedPath,changed);await assert.rejects(readDurableSourceBytes(root,runId,code),/hash changed/);await writeFile(code.retainedPath,nativeOriginalBytes!);
    process.send!({ok:true,nativeRetainedCode:true,observationByteIdentity:true,sourceHash:true});
  } else if(mode==='delivery-drain') {
    for(let i=0;i<200&&!deliveryWriteEntered;i++)await new Promise(resolve=>setTimeout(resolve,25));assert.equal(deliveryWriteEntered,true,'actual report writer reached file publication barrier');
    const beforeExit=await service.prepareExit({requestId:'delivery-drain',mode:'drain'});
    assert.equal(beforeExit.ready,false,'drain must not report ready while report/archive file IO is in progress');
    assert.notEqual(beforeExit.runs.find((run:any)=>run.runId===runId)?.state,'ready');
    releaseDeliveryWrite();await service.cancelExit('delivery-drain');
    for(let i=0;i<200;i++){const current=await service.exitStatus();if(current.runs.find((run:any)=>run.runId===runId)?.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,25));}
    assert.equal((await service.exitStatus()).runs.find((run:any)=>run.runId===runId)?.state,'ready');
    process.send!({ok:true,actualFileIOBarrier:true,drainWaitsForPublication:true});
  } else {
  if(mode==='delivery-red'){const experience=await service.readExperience(runId);assert.equal(experience.kind,'read','completed DBOS Run must automatically deliver its report');process.send?.({ok:true});process.exit(0);}
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
  if(['delivery','delivery-interrupted','delivery-rename-interrupted','delivery-rename-wrong'].includes(mode)) {
    const {createDurableViewReaders}=await load('durable-views');const readers=createDurableViewReaders(dependencies);
    const complete=async(id:string)=>{for(let i=0;i<200;i++){const result=await readers.readRunAssets(id);if(result.kind==='read')return result;const diagnostics=await runtime.store.orderedFlowFacts(id,'delivery-diagnostic:');const invalid=diagnostics.find((item:any)=>/Invalid call|recorded when/.test(item.value.diagnostic??''));if(invalid)throw new Error(invalid.value.diagnostic);await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Automatic archive was not completed: '+JSON.stringify({archive:(await readers.readRunView(id)).archive,report:await readers.readExperience(id),diagnostics:(await runtime.store.orderedFlowFacts(id,'delivery-diagnostic:')).map((fact:any)=>fact.value)}));};
    const falseArchive=await complete(runId);const falseReport=await readers.readExperience(runId);assert.equal(falseReport.kind,'read');assert.equal(falseReport.json.goalState,'not-met');
    assert.ok(falseReport.json.tasks.some((task:any)=>task.result.value.goalMet===false));
    runtime.store.createRun=createRun;
    let interruption=0;const put=runtime.store.putFlowFact.bind(runtime.store);
    const checkpointPublished=async(id:string,directory:string)=>{
      const manifestBytes=await readFile(path.join(directory,'manifest.json')),manifest=JSON.parse(manifestBytes.toString('utf8'));
      const artifact=manifest.materials.find((item:any)=>item.source.endsWith(':arbitrary-binary'));
      const report=manifest.materials.find((item:any)=>item.path==='experience.json');
      const workspace=path.dirname(path.dirname(manifest.materials.find((item:any)=>item.path==='experience.md').source.slice(5)));
      const firstArtifact=falseArchive.manifest.materials.find((item:any)=>item.source.endsWith(':arbitrary-binary'));
      const firstPath=path.dirname(path.dirname(falseArchive.manifest.materials.find((item:any)=>item.path==='experience.md').source.slice(5)));
      const runs=[{runId,goalState:'not-met',manifest:JSON.stringify(falseArchive.manifest),manifestSha:createHash('sha256').update(await readFile(falseArchive.manifestPath)).digest('hex'),reportSha:falseReport.record.json.sha256,effectId:firstArtifact.source.slice('task-artifact:'.length,-':arbitrary-binary'.length),workspace:firstPath},
        {runId:id,goalState:'unknown',manifest:JSON.stringify(manifest),manifestSha:createHash('sha256').update(manifestBytes).digest('hex'),reportSha:report.sha256,effectId:artifact.source.slice('task-artifact:'.length,-':arbitrary-binary'.length),workspace}];
      await writeFile(path.join(home,'accepted.json'),JSON.stringify({runs,interrupted:true}));
      if(mode==='delivery-rename-wrong'){const changed=JSON.parse(JSON.stringify(manifest));changed.materials.find((item:any)=>item.path===artifact.path).source='task-artifact:wrong-original-identity';await writeFile(path.join(directory,'manifest.json'),JSON.stringify(changed,null,2)+'\n');}
      process.send!({ok:true,interrupted:true,publishedBeforePGComplete:true,beforeIOReceipt:mode.startsWith('delivery-rename')});await new Promise(()=>{});
    };
    if(mode.startsWith('delivery-rename')) {
      const {default:fs}=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),originalRename=fs.promises.rename;
      fs.promises.rename=async(from:any,to:any)=>{await originalRename(from,to);if(String(from).includes('.stage-')&&String(to).includes('/run-assets/')&&!String(to).endsWith(runId))await checkpointPublished(path.basename(String(to)),String(to));};syncBuiltinESMExports();
    }
    runtime.store.putFlowFact=async(id:string,name:string,value:any)=>{
      if(id!==runId&&name==='delivery:archive:complete'&&mode==='delivery-interrupted')await checkpointPublished(id,value.directory);
      if(id!==runId&&name==='delivery:archive:complete'&&interruption++<2)throw new Error('fixture interrupted after atomic archive publication');return put(id,name,value);
    };
    const unknown=await service.startRun({pack:pack.id,site:'local',goal:{periodNs:0.5},strategy:{periodNs:2},ownerSessionId:String(owner.id),guideSessionId:String(guide.id),proposalId:newCampaignProposalId(pack,site)});
    const unknownArchive=await complete(unknown.run.id);assert.ok(interruption>=3,'automatic finalization recovered publication interruption');assert.ok((await readers.readRunRecords(unknown.run.id,'archive')).some((record:any)=>record.delivery==='failed'&&record.reason.includes('fixture interrupted')),'interrupted publication exposes actionable failed delivery');runtime.store.putFlowFact=put;
    const unknownReport=await readers.readExperience(unknown.run.id);assert.equal(unknownReport.kind,'read');assert.equal(unknownReport.json.goalState,'unknown');assert.match(unknownReport.markdown,/Goal assessment is UNKNOWN/);
    assert.equal(service.ledger.run(unknown.run.id),undefined,'archive is independent of delayed Ledger history');
    const {LocalChannel}=await load('channel'),originalExec=LocalChannel.prototype.exec;let changedFile:string|undefined;
    LocalChannel.prototype.exec=async function(argv:any,options:any){const answer=await originalExec.call(this,argv,options);const target=String(argv.at(-1));if(!changedFile&&argv[0]==='tee'&&target.includes('/hima-experience/')&&target.endsWith('.json')){const reportingRun=path.basename(target,'.json'),source=(await runtime.store.flowProjection(reportingRun)).tasks.find((task:any)=>task.result&&task.valid),artifact=source.result.artifacts.find((item:any)=>item.name==='delivery');changedFile=path.join(path.dirname(path.dirname(target)),artifact.path);await writeFile(changedFile,'bytes changed before archive');}return answer;};
    const changed=await service.startRun({pack:pack.id,site:'local',goal:{periodNs:1},strategy:{periodNs:2},ownerSessionId:String(owner.id),guideSessionId:String(guide.id),proposalId:newCampaignProposalId(pack,site)});
    let failedView:any;for(let i=0;i<200;i++){failedView=await readers.readRunView(changed.run.id);if(failedView.archive?.delivery==='failed')break;await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(failedView.archive?.delivery,'failed',JSON.stringify({changedFile,changedRun:changed.run.id,initialRun:runId,unknownRun:unknown.run.id,archive:failedView.archive}));assert.match(failedView.archive.reason,/Task artifact|bytes changed/);assert.ok(failedView.tasks.some((task:any)=>task.result&&task.projection.state==='succeeded'),'delivery failure retains technical result');assert.notEqual((await readers.readRunAssets(changed.run.id)).kind,'read','changed bytes do not claim archived success');
    LocalChannel.prototype.exec=originalExec;assert.ok(changedFile);await writeFile(changedFile,'verified task delivery');const changedArchive=await complete(changed.run.id);
    const runs=[];
    for(const [id,goalState,archive] of [[runId,'not-met',falseArchive],[unknown.run.id,'unknown',unknownArchive],[changed.run.id,'not-met',changedArchive]] as const) {
      const report=await readers.readExperience(id);assert.equal(report.kind,'read');const current=await readers.readRunView(id);const task=current.tasks.find((task:any)=>task.result);
      assert.equal((await readers.readRunAssets(id)).kind,'read');assert.equal((await readers.finalizeDelivery(id)).complete,true);
      assert.equal((await readers.readExperience(id)).record.json.sha256,report.record.json.sha256);
      assert.ok(archive.manifest.materials.some((material:any)=>material.source.endsWith(':arbitrary-binary')));
      const original=(await runtime.store.run(id)).opening.data.product.workspace;
      assert.equal((await readFile(path.join(original,'program-calls'),'utf8')).trim(),'original','delivery recovery does not execute engineering Task twice');
      await rename(original,original+'-offline');
      const fallback=await readers.readTaskArtifact(id,task.identity.effectId,'arbitrary-binary');assert.deepEqual([...fallback.bytes],[0,255,1,128,10]);assert.equal((await readers.readExperience(id)).kind,'read');
      const download=await get(`/runs/${id}/assets?effect=${encodeURIComponent(task.identity.effectId)}&artifact=arbitrary-binary&format=download`);assert.equal(download.status,200);assert.deepEqual([...new Uint8Array(await download.arrayBuffer())],[0,255,1,128,10]);
      runs.push({runId:id,goalState,manifest:JSON.stringify(archive.manifest),manifestSha:createHash('sha256').update(await readFile(archive.manifestPath)).digest('hex'),reportSha:report.record.json.sha256,effectId:task.identity.effectId});
    }
    await writeFile(path.join(home,'accepted.json'),JSON.stringify({runs}));
    process.send!({ok:true,automaticReport:true,unknownGoal:true,falseGoal:true,binaryArchive:true,publicationRecovery:true,changedBeforeArchive:true,archiveFallback:true,delayedProjector:true});
  } else {
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
  }
  }
  }
} catch(error) {process.send!({ok:false,error:String(error),stack:(error as Error).stack});process.exitCode=1;}
finally {unblock();unblockCommit();resumeHistory();await host?.dispose();}
function exists(at:string){return access(at).then(()=>true,()=>false);}
