import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type Serializable } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../../../packages/harness/', import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
export function flowProcess(home: string, mode: string, extra: Record<string,string> = {}) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), home, mode], { env: { ...process.env, ...extra }, stdio: ['ignore','pipe','pipe','ipc'] });
  let stderr = ''; child.stderr!.on('data', value => { stderr += String(value); });
  const queue: any[] = [], waiters: Array<{resolve:(value:any)=>void;reject:(error:Error)=>void}> = [];
  child.on('message', message => { const waiter = waiters.shift(); if (waiter) waiter.resolve(message); else queue.push(message); });
  const ended = new Promise<void>(resolve => child.once('close', () => { for (const waiter of waiters.splice(0)) waiter.reject(new Error(`Flow worker exited: ${stderr}`)); resolve(); }));
  return { child, ended, stderr: () => stderr,
    async next(): Promise<any> { if (queue.length) return queue.shift(); if(child.exitCode!==null||child.signalCode!==null)throw new Error(stderr);
      return new Promise((resolve,reject) => { const waiter={resolve,reject};waiters.push(waiter);const timer=setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(new Error(`Flow worker timeout: ${stderr}`));},60000);
        waiter.resolve=value=>{clearTimeout(timer);resolve(value);};waiter.reject=error=>{clearTimeout(timer);reject(error);}; }); },
    send(value: Serializable) { child.send(value); },
    async kill() { child.kill('SIGKILL');await ended; },
    async close() { if(child.exitCode!==null||child.signalCode!==null){await ended;return;}child.send({action:'close'});const timer=setTimeout(()=>child.kill('SIGKILL'),5000);try{await ended;}finally{clearTimeout(timer);} }
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
async function main() {
  const workerStarted=Date.now();
  const [home,mode] = process.argv.slice(2); if(!home)throw new Error('Private Home required');
  const trace=async(stage:string)=>{if(process.env.HIMA_FLOW_TRACE_FILE)await appendFile(process.env.HIMA_FLOW_TRACE_FILE,JSON.stringify({pid:process.pid,mode,stage,at:new Date().toISOString(),elapsedMs:Date.now()-workerStarted})+'\n');};
  await trace('worker-start');
  const lib = process.env.HIMA_U6_TEST_LIB ?? path.join(root,'lib');
  const load = (name: string) => import(pathToFileURL(path.join(lib,`${name}.js`)).href);
  const {DBOS} = await import(pathToFileURL(require.resolve('@dbos-inc/dbos-sdk')).href);
  const {startLocalDatabase} = await load('local-database');
  const {startDurableRuntime} = await load('durable-runtime');
  const {jsonDigest} = await load('run-store');
  const {compileFlow,compileLegacyFlow,compileLegacyGrowth} = await load('flow-compiler');
  const {commandTaskAdapter, taskEffectStep,executeTaskEffect} = await load('task-effects');
  const {stringify} = require('yaml');
  await trace('database-start');
  const database = await startLocalDatabase({home,runtimeDirectory:process.env.HIMA_POSTGRES_RUNTIME});
  await trace('database-ready');
  const sitesDir=path.join(home,'sites'),workspace=path.join(home,'workspace');
  await mkdir(sitesDir,{recursive:true});await mkdir(workspace,{recursive:true});
  await writeFile(path.join(sitesDir,'local.permit.yml'),stringify({allowedReadRoots:[workspace],allowedWriteRoots:[workspace],allowedWrappers:[process.execPath],forbidden:['services','licences','network','deletions','downloads']}));
  await writeFile(path.join(sitesDir,'local.yml'),stringify({name:'local',kind:'local',workspaceRoot:workspace,permit:'./local.permit.yml',bindings:{workspaceRoot:workspace},capacity:{cores:4,memoryGiB:1,parallelJobs:mode==='reader-pending'?1:8,licences:{}}}));
  const executableFiles=['flow-workflow','flow-compiler','flow-definition','run-store','run-store-migrations','task-effects','task-contract','durable-runtime'];
  const files=Object.fromEntries(await Promise.all(executableFiles.map(async name=>[name,createHash('sha256').update(await readFile(path.join(lib,`${name}.js`))).digest('hex')])));
  const manifest={files,adapters:{'task-effect':'hima-task-effect/2'}};
  const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
  const task=(id:string,inputs:any={},output:any=schema)=>({kind:'task',id,tool:'local-job',inputs,contract:{input:schema,output}});
  const seq=(id:string,...steps:any[])=>({kind:'sequence',id,steps});
  const from=(taskId:string,...parts:string[])=>({source:'committedOutput',taskId,path:parts});
  const literal=(value:any)=>({source:'literal',value});
  const decisionSchema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{route:{type:'string',enum:['again','stop']}},required:['route']}};
  const flow=(value:any,extensions:any[]=[])=>compileFlow({schema:'hima-flow/1',id:'fixture',version:'1',flow:value,extensions},{packSha256:'a'.repeat(64)});
  const methods:any={
    message:flow(task('message-task',{delay:literal(12000)})),
    overlap:flow({kind:'parallel',id:'p',branches:{a:{flow:task('a',{n:literal(11),delay:literal(400)}),required:true},b:{flow:task('b',{n:literal(29),delay:literal(400)}),required:true}},results:{a:{output:{taskId:'a',path:[]},required:true},b:{output:{taskId:'b',path:[]},required:true}}}),
    pause:flow({kind:'parallel',id:'p',branches:{a:{flow:seq('a-chain',task('a',{delay:literal(300)}),task('a-next',{value:from('a','n')})),required:true},b:{flow:task('b',{delay:literal(200)}),required:true}},results:{}}),
    required:flow({kind:'parallel',id:'p',branches:{a:{flow:task('a',{fail:literal(true)}),required:true},b:{flow:task('b'),required:false}},results:{}}),
    optional:flow({kind:'parallel',id:'p',branches:{a:{flow:task('a',{n:literal(17)}),required:true},b:{flow:task('b',{fail:literal(true)}),required:false}},results:{a:{output:{taskId:'a',path:[]},required:true},b:{output:{taskId:'b',path:[]},required:false}}}),
    choice:flow(seq('s',task('decide',{route:literal('again')},decisionSchema),{kind:'choice',id:'choose',select:{taskId:'decide',path:['route']},cases:{again:task('selected'),stop:task('unselected')}})),
    repeat:flow({kind:'repeat',id:'repeat',body:task('iteration',{n:{source:'carry',path:['n']}},decisionSchema),carry:{n:{initial:literal(0),next:{taskId:'iteration',path:['n']}}},stop:{output:{taskId:'iteration',path:['route']},equals:'stop'},maxIterations:3,budget:'original-run'}),
    extension:flow(seq('s',task('producer'),task('consumer',{returned:{source:'extensionResult',slotId:'extra',path:['n']}})),[{id:'extra',afterTask:'producer',fragmentPath:['fragment'],returnTo:'consumer'}]),
    cancel:flow(task('long',{delay:literal(30000)})),
    unknown:flow(task('unknown')),
    human:flow({...task('human'),tool:'builtin/human-wait'}),
    deadline:flow(seq('s',task('first',{delay:literal(180)}),task('forbidden'))),
    'closing-budget':flow(seq('closing-sequence',task('work',{delay:literal(2000)}),
      {...task('delivery',{n:from('work','n')}),budget:'closing'},task('forbidden'))),
    'closing-hard':flow({...task('cached'),budget:'closing'}),
    revise:flow(seq('s',{kind:'parallel',id:'p',branches:{a:{flow:task('a',{n:literal(1)}),required:true},b:{flow:task('b',{delay:literal(700)}),required:true}},results:{}},task('consumer',{a:from('a','n'),b:from('b','n')}))),
    cached:flow(task('cached')),
    'pending-ready':flow(task('await-ready')),
    'materialization':flow(task('materialization',{delay:literal(3000)})),
    'materialization-cleanup':flow(task('materialization',{delay:literal(30000)})),
    'hard-blocked':flow(task('blocked-hard',{delay:literal(30000)})),
    'failed-revise':flow(task('fails-once',{fail:literal(true)})),
    'multi-fields':flow({kind:'repeat',id:'fields-loop',body:seq('fields-body',{kind:'parallel',id:'fields-parallel',branches:{a:{flow:task('patch-a',{scale:{source:'carry',path:['scale']},delay:literal(800)}),required:true},b:{flow:task('patch-b',{scale:{source:'carry',path:['scale']},delay:literal(800)}),required:true},c:{flow:task('unchanged',{delay:literal(1000)}),required:true}},results:{}},task('patch-choice',{a:from('patch-a','scale'),b:from('patch-b','scale')},decisionSchema)),carry:{scale:{initial:literal(1),next:{taskId:'patch-choice',path:['scale']}}},stop:{output:{taskId:'patch-choice',path:['route']},equals:'stop'},maxIterations:3,budget:'original-run'}),
    'repeat-terminal':flow({kind:'repeat',id:'terminal-repeat',body:seq('terminal-body',task('terminal-decision',{},decisionSchema),task('terminal-deliver')),carry:{},stop:{output:{taskId:'terminal-decision',path:['route']},equals:'stop'},maxIterations:1,budget:'original-run'}),
    'closure-race':flow(task('closure')),
    'cleanup-race':flow(task('cleanup-race',{delay:literal(30000)})),
    'reader-pending':flow(task('reader-parent')),
    'revision-hold':flow(task('held-revision',{n:literal(1),delay:literal(30000)})),
    attempts:flow(seq('attempt-sequence',task('one'),task('two'))),
    frontier:flow({kind:'repeat',id:'frontier-loop',body:{kind:'parallel',id:'frontier-parallel',branches:{a:{flow:task('frontier-a',{n:{source:'carry',path:['n']}},decisionSchema),required:true},b:{flow:task('frontier-b',{n:{source:'carry',path:['n']},delay:literal(800)}),required:true}},results:{}},carry:{n:{initial:literal(0),next:{taskId:'frontier-a',path:['n']}}},stop:{output:{taskId:'frontier-a',path:['route']},equals:'stop'},maxIterations:5,budget:'original-run'}),
    'fragment-revise':flow(seq('fragment-sequence',task('producer',{n:literal(1)}),task('consumer',{returned:{source:'extensionResult',slotId:'extra',path:['n']}}),{...task('response',{n:from('consumer','n')}),tool:'builtin/human-wait'}),[{id:'extra',afterTask:'producer',fragmentPath:['fragment'],returnTo:'consumer'}]),
  };
  const optionalGraph={id:'optional-fixture',version:'1',entry:'optional-producer',nodes:[{id:'optional-producer',kind:'explore',parameters:{chooser:'fixture',bind:{},growth:true}}],edges:[],loops:{},autopilot:[]};
  const optionalContract={id:'optional-fixture',version:'1',strategy:{},inputs:[],outputs:[{name:'metric',path:'metric.json',reader:'fixture'}],tools:[{id:'local-job',file:'local.js',inputs:['fail','delay'],argv:[process.execPath]}],workshops:[],agentTeams:[]};
  const optionalBase=compileLegacyFlow(optionalGraph,optionalContract,'a'.repeat(64));
  const optionalProposal=(fail:boolean)=>({proposalId:'optional-proposal',method:{id:'optional-fixture',version:'1',digest:'a'.repeat(64)},parent:{nodeId:'optional-producer',generation:1},inputThroughSeq:1,inputs:[{recordId:'source',contentIdentity:'a'.repeat(64)}],impactNodes:['optional-producer'],expectedChanges:['Optional bounded diagnostic'],nodes:[{id:'optional-tool',kind:'act',parameters:{tool:'local-job',arguments:{fail:fail?1:0,delay:fail?0:30000}}},{id:'optional-read',kind:'act',parameters:{observes:'metric',arguments:{}}}],edges:[{from:'optional-tool',to:'optional-read'},{from:'optional-read',to:'optional-producer'}],requiredOutputs:['metric'],endCondition:'Diagnostic returns or honestly stops',returnNode:'optional-producer',optional:true});
  const optionalFragment=compileLegacyGrowth({id:'optional-fixture',graph:optionalGraph,contract:optionalContract,flow:optionalBase,folder:{digest:()=>optionalBase.packSha256}},optionalProposal(mode==='optional-failed'));
  methods['optional-failed']=optionalBase;methods['optional-abandoned']=optionalBase;methods['optional-cancelled']=optionalBase;
  let gateOnce=false;let cleanupObservations=0;
  let messagePreparationBlocked=false,messagePreparationObserved=false;
  const resolveAdapter=async(context:any)=>{
    if(messagePreparationBlocked&&DBOS.workflowID?.startsWith('hima-message:')) {
      messagePreparationObserved=true;
      const reason={code:'adapter-materialization',source:'fixture-adapter',message:'Restore the original message adapter assets'};
      if(mode==='message-unavailable')throw new TaskAdapterMaterializationError(reason);
      return {pending:true,state:'waiting',reason};
    }
    if(context.task.id==='materialization'&&(await taskEffectStep('fixture.materialization-availability',async()=>({unavailable:await exists(path.join(home,'materialization-unavailable'))}))).unavailable) {
      const diagnostic={code:'adapter-materialization',source:'fixture-adapter',message:'Restore the original retained adapter binding'};
      throw new TaskAdapterMaterializationError(diagnostic);
    }
    if(context.task.id==='await-ready'&&!await exists(path.join(home,'ready-gate')))return {pending:true,state:'waiting',reason:{code:'preparation-pending',message:'Accepted preparation is not yet ready',source:'fixture-preparation'}};
    const dir=path.join(workspace,context.request.identity.effectId.replaceAll(':','-'));
    await taskEffectStep('fixture.private-task-directory',()=>mkdir(dir,{recursive:true}));
    const script=`const fs=require('fs');const path=require('path');const dir=process.argv[1];const input=JSON.parse(fs.readFileSync(path.join(dir,'input.json'),'utf8'));const task=process.argv[2];const output=process.argv[3];fs.appendFileSync(path.join(${JSON.stringify(home)},'effects'),JSON.stringify({task,input,at:Date.now(),phase:'start'})+'\\n');setTimeout(()=>{fs.writeFileSync(path.join(dir,'output.json'),output);fs.appendFileSync(path.join(${JSON.stringify(home)},'effects'),JSON.stringify({task,input,at:Date.now(),phase:'end'})+'\\n');process.exit(input.fail?7:0)},task==='frontier-a'&&input.n===2?30000:input.delay||0);`;
    let value:any={n:context.request.input.n??42};
    if(context.task.id==='optional-producer')value={route:'stop',strategy:{},goalMet:false,extension:optionalFragment};
    if(context.task.tool==='builtin/legacy-growth-resume')value={...context.request.input.priorDecision,diagnosticStatus:context.request.input.diagnostic?.status??'none'};
    if(context.task.tool==='builtin/legacy-growth-result')value={proposalId:'optional-proposal',requiredOutputs:{metric:{observations:[]}}};
    if(context.task.id==='patch-a'||context.task.id==='patch-b')value={scale:context.request.input.scale};
    if(context.task.id==='patch-choice')value={scale:context.request.input.newScale??context.request.input.a+1,route:context.invocation.iterations[0].iteration===0?'again':'stop'};
    if(context.task.id==='decide')value={route:'again'};
    if(context.task.id==='terminal-decision')value={route:'stop',goalMet:true};
    if(context.task.id==='terminal-deliver')value={goalMet:false};
    if(context.task.id==='frontier-a')value={n:context.request.input.n+1,route:context.request.input.n>=5?'stop':'again'};
    if(context.task.id==='iteration')value={n:context.request.input.n+1,route:context.request.input.n>=1?'stop':'again'};
    if(context.task.id==='producer')value={n:context.request.input.n??1,fragment:{flow:task('diagnostic',{n:literal(9)}),return:{taskId:'diagnostic',path:[]}}};
    if(context.task.id==='consumer')value={n:context.request.input.returned??context.request.input.a};
    const adapter=commandTaskAdapter({sitesDir,siteId:'local',workspace:dir,argv:[process.execPath,'-e',script,dir,context.task.id,JSON.stringify(value)],name:context.task.id,
      stage:async()=>{await mkdir(dir,{recursive:true});await appendFile(path.join(home,'stages'),JSON.stringify({task:context.task.id,input:context.request.input})+'\n');await writeFile(path.join(dir,'input.json'),JSON.stringify(context.request.input));},
      collect:async()=>taskEffectStep('fixture.read-original-output',async()=>({schemaVersion:context.request.contract.output.version,value:JSON.parse(await readFile(path.join(dir,'output.json'),'utf8')),artifacts:[],diagnostics:[]}))});
    if(context.task.id==='message-task') {
      adapter.message=async(_prepared:any,id:string,input:any,before:()=>Promise<void>)=>{await before();await appendFile(path.join(home,'messages'),JSON.stringify({id,input})+'\n');throw new Error('Fixture lost native ACK');};
      adapter.reconcileMessage=async(_prepared:any,id:string,input:any)=>await exists(path.join(home,'message-ack'))?{id,input,accepted:true}:undefined;
    }
    if(context.task.id==='held-revision'&&context.invocation.revision===0){const stop=adapter.stop;adapter.stop=async(prepared:any,receipt:any,before:any)=>await exists(path.join(home,'original-close-gate'))?stop!(prepared,receipt,before):{closed:false,reason:'Original task stop acknowledgement is unknown; reconcile original identity'};}
    if(context.task.id==='reader-parent'){
      adapter.collect=async(_prepared:any,_receipt:any,request:any)=>{
        const childDir=path.join(workspace,'reader-child');await taskEffectStep('fixture.reader-private-directory',()=>mkdir(childDir,{recursive:true}));
        const childInput={n:42};const childIdentity={...request.identity,taskId:'reader-child',effectId:`${request.identity.effectId}:reader`,inputSha256:jsonDigest(childInput)};
        await store.bindDerivedEffect(request.identity,childIdentity,{purpose:'collect'});
        const childRequest={...request,identity:childIdentity,input:childInput,admission:{...request.admission,effectId:childIdentity.effectId}};
        const childScript=`const fs=require('fs');const path=require('path');fs.appendFileSync(path.join(${JSON.stringify(home)},'effects'),JSON.stringify({task:'reader-child',phase:'start',at:Date.now(),input:{n:42}})+'\\n');setTimeout(()=>{fs.writeFileSync(path.join(process.argv[1],'output.json'),JSON.stringify({n:42}));fs.appendFileSync(path.join(${JSON.stringify(home)},'effects'),JSON.stringify({task:'reader-child',phase:'end',at:Date.now(),input:{n:42}})+'\\n')},1500)`;
        const reader=commandTaskAdapter({sitesDir,siteId:'local',workspace:childDir,argv:[process.execPath,'-e',childScript,childDir],name:'reader-child',collect:async()=>taskEffectStep('fixture.reader-result',async()=>({schemaVersion:'1',value:JSON.parse(await readFile(path.join(childDir,'output.json'),'utf8')),artifacts:[],diagnostics:[]}))});
        const collected=await executeTaskEffect(store,childRequest,reader);
        if(collected.state==='running'||collected.state==='waiting')return {pending:true,state:collected.state,reason:collected.reason};
        if(collected.state==='failed')throw new Error(collected.reason.message);
        return {schemaVersion:'1',value:collected.result.value,artifacts:[],diagnostics:[]};
      };
    }
    if(context.task.id==='cleanup-race'){
      const stop=adapter.stop;
      adapter.stop=async(prepared:any,receipt:any,before:any)=>{
        const closed=await stop!(prepared,receipt,before);if(!closed.closed)return closed;
        const observation=++cleanupObservations;
        const deadline=Date.now()+8000;while(cleanupObservations<2){if(Date.now()>deadline)throw new Error('Two original cleanup workflows did not reach closure barrier');await new Promise(resolve=>setTimeout(resolve,20));}
        return {...closed,proof:{...closed.proof,observation}};
      };
    }
    if(context.task.id==='closure'){
      adapter.settledResources=undefined;
      const release=adapter.release,stop=adapter.stop;
      adapter.release=async(prepared:any,receipt:any,before:any)=>{const closed=await release(prepared,receipt,before);if(closed.closed){process.send!({stage:'before-main-release'});while(!await exists(path.join(home,'dispatch-gate')))await new Promise(resolve=>setTimeout(resolve,20));return {...closed,proof:{...closed.proof,observation:'main'}};}return closed;};
      adapter.stop=async(prepared:any,receipt:any,before:any)=>{const closed=await stop!(prepared,receipt,before);return closed.closed?{...closed,proof:{...closed.proof,observation:'control'}}:closed;};
    }
    if(context.task.id==='unknown')return {...adapter,reconcile:async()=>({state:'unknown',reason:'Original external identity is unknown'}),stop:undefined};
    if(context.task.id==='blocked-hard'){const submit=adapter.submit;adapter.submit=async(prepared:any,before:any)=>{const receipt=await submit(prepared,before);process.send!({stage:'main-submit-blocked'});while(!await exists(path.join(home,'dispatch-gate')))await new Promise(resolve=>setTimeout(resolve,20));return receipt;};}
    if(context.task.id==='cached'&&!gateOnce){gateOnce=true;const submit=adapter.submit;adapter.submit=async(prepared:any,before:any)=>{
      await runtime.store.assertEffectAdmission(context.request.admission,()=>adapter.permit(prepared,'submit'));
      process.send!({stage:'cached-admission',effect:context.request.identity.effectId,deadline:(await runtime.store.run(context.request.identity.runId)).deadlineAt});
      while(!await exists(path.join(home,'dispatch-gate')))await new Promise(resolve=>setTimeout(resolve,20));
      return submit(prepared,before);
    };}
    return adapter;
  };
  const {flowWorkflowDefinitions,startFlow,controlFlow,messageFlowTask,readFlow,TaskAdapterMaterializationError}=await load('flow-workflow');
  let retainedProducerCalls=0;
  const retainedWorkflow={name:'fixture.retained-materialization',async execute(runtime:any,input:any){
    let metadata:any;
    for(let index=0;index<12;index++){
      metadata=await runtime.store.ensureFlowFact(input.runId,'retained-fixture',async()=>{retainedProducerCalls++;return JSON.parse(await readFile(path.join(home,'retained-source.json'),'utf8'));});
      assert.equal(metadata.state,'available',JSON.stringify(metadata));
      const fact=await runtime.store.fact(metadata.factId);assert.equal(jsonDigest(fact.payload.value),metadata.digest);
      assert.equal(fact.payload.value.body,'retained bytes '.repeat(10000));
      if(index===0&&mode==='retained-fact-kill'){process.send!({stage:'retained-fact-seeded',metadata});await new Promise(()=>{});}
    }
    return metadata;
  }};
  await trace('runtime-start');
  const runtime=await startDurableRuntime({database,manifest,workflows:[...flowWorkflowDefinitions({resolveAdapter}),retainedWorkflow]});
  await trace('runtime-ready');
  const store=runtime.store;
  if(mode?.startsWith('crash-')){
    const prefix={choice:'choice:',repeat:'repeat:',extension:'fragment:'}[mode.slice(6) as 'choice'|'repeat'|'extension'];
    const original=runtime.store.putFlowFact.bind(runtime.store);let injected=false;
    runtime.store.putFlowFact=async(runId:string,name:string,value:any)=>{
      const result=await original(runId,name,value);
      if(!injected&&name.startsWith(prefix)){injected=true;process.send!({stage:'committed-decision',name,value});await new Promise(()=>{});}
      return result;
    };
  }
  const send=(value:any)=>process.send!(value);
  const open=async(id:string,method:string,budget:any={},deadlineMs=15000)=>{
    const opening={runId:id,inputSha256:'b'.repeat(64),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:new Date(Date.now()+deadlineMs).toISOString(),data:{budget}};
    await store.createRun(opening);
    const start={runId:id,flow:methods[method],runInput:{},goal:{},strategy:{}};
    return {handle:await startFlow(runtime,start),start,opening};
  };
  const command=async(runId:string,action:string,extra:any={})=>{const run=await store.run(runId);return(await controlFlow(runtime,{runId,commandId:`${action}-${jsonDigest(extra)}`,action,owner:run.owner,epoch:run.epoch,revision:run.revision,...extra})).getResult();};
  const rows=async()=>{try{return(await readFile(path.join(home,'effects'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{return[];}};
  const until=async(test:()=>Promise<boolean>)=>{const deadline=Date.now()+12000;while(!await test()){if(Date.now()>deadline)throw new Error('Scenario wait timed out');await new Promise(resolve=>setTimeout(resolve,40));}};
  const messages: Array<(value:any)=>void> = [];
  process.on('message',async(value:any)=>{try{
    if(value.action==='close'){await runtime.stop();await database.stop();process.exit(0);}
    if(value.action==='control'){send({stage:'control',result:await command(value.runId,value.operation,value.extra??{})});}
    if(value.action==='gate')await writeFile(path.join(home,'dispatch-gate'),'resume');
    if(value.action==='status')send({stage:'status',view:await readFlow(runtime,value.runId),rows:await rows()});
    for(const callback of messages)callback(value);
  }catch(error){send({stage:'error',error:String(error)});}});
  if(mode?.startsWith('message')) {
    await open('message','message',{},30000);
    await until(async()=>(await rows()).some((row:any)=>row.task==='message-task'&&row.phase==='start'));
    const invocation=(await store.flowInvocations('message'))[0],run=await store.run('message');
    const input={runId:'message',effectId:invocation.identity.effectId,requestId:'business-message',owner:run.owner,epoch:run.epoch,revision:run.revision,message:'Inspect the original timing path'};
    messagePreparationBlocked=mode!=='message';
    const handle=await messageFlowTask(runtime,input);
    if(messagePreparationBlocked) {
      await until(async()=>messagePreparationObserved);
      assert.equal(await exists(path.join(home,'messages')),false,'pending preparation cannot dispatch a message');
      if(mode==='message-pending-cancel') {
        await command('message','cancel');
        const result=await handle.getResult();assert.equal(result.state,'waiting');
        assert.deepEqual(await store.flowFact('message','task-message-result:business-message'),result);
        assert.deepEqual(await(await messageFlowTask(runtime,input)).getResult(),result);
        assert.equal(await exists(path.join(home,'messages')),false,'cancelled preparation never dispatches');
        send({ok:true,result,externalMessages:0});return;
      }
      messagePreparationBlocked=false;
      // Bound the red proof too: the old fixed-ID workflow has already terminated here.
      const restored=await messageFlowTask(runtime,input);assert.equal(restored.workflowID,handle.workflowID);
      const outcome=await Promise.race([until(()=>exists(path.join(home,'messages'))).then(()=>undefined),handle.getResult()]);
      assert.equal(outcome,undefined,'restoration keeps the original workflow live until native dispatch');
    }
    await until(()=>exists(path.join(home,'messages')));
    const duplicate=await messageFlowTask(runtime,input);assert.equal(duplicate.workflowID,handle.workflowID);
    await assert.rejects(messageFlowTask(runtime,{...input,message:'different contents'}),/different|identity/);
    await assert.rejects(messageFlowTask(runtime,{...input,requestId:'stale-message',owner:'former-owner'}),/stale/);
    await writeFile(path.join(home,'message-ack'),'native ACK is now queryable');
    const result=await handle.getResult();assert.equal(result.state,'completed');assert.equal(result.value.input,input.message);
    assert.equal((await readFile(path.join(home,'messages'),'utf8')).trim().split('\n').length,1,'lost ACK and duplicate API never resend the message');
    assert.deepEqual(await store.flowFact('message','task-message-result:business-message'),result);
    await command('message','cancel');
    assert.deepEqual(await(await messageFlowTask(runtime,input)).getResult(),result,'identical retry reads the original completed message even after cancellation');
    send({ok:true,result,externalMessages:1});
  }else if(mode==='flows'){
    for(const scenario of ['overlap','required','optional','choice','repeat','extension','repeat-terminal']){
      const {handle}=await open(scenario,scenario);const result:any=await handle.getResult();
      assert.equal(result.state,scenario==='required'?'failed':'succeeded',JSON.stringify(result));
      if(scenario==='overlap'){const values=await rows();const a=values.filter((r:any)=>r.task==='a'),b=values.filter((r:any)=>r.task==='b');assert.ok(a[0].at<b[1].at&&b[0].at<a[1].at,'Independent Jobs must actually overlap');}
      if(scenario==='repeat-terminal'){assert.equal(result.terminal.taskId,'terminal-deliver');assert.equal(result.terminal.effectId,result.committed['terminal-deliver'].identity.effectId);assert.equal(result.committed[result.terminal.taskId].value.goalMet,false);}
      if(scenario==='overlap'){assert.equal(result.terminal,null);assert.deepEqual(result.namedResults,{a:{n:11},b:{n:29}});}
      if(scenario==='optional')assert.deepEqual(result.namedResults,{a:{n:17}});
      if(scenario==='choice'){assert.ok(result.committed.selected);assert.equal(result.committed.unselected,undefined);}
      if(scenario==='repeat'){assert.equal(result.committed.iteration.value.n,2);assert.equal((await rows()).filter((r:any)=>r.task==='iteration'&&r.phase==='start').length,2);}
      if(scenario==='extension'){assert.equal(result.committed.consumer.value.n,9);assert.equal(result.committed.producer.value.n,1);assert.deepEqual(result.extensionResults.extra,{n:9});}
      send({stage:'scenario',scenario,result});
    }
    send({ok:true,scenario:'flows'});
  }else if(mode==='retained-fact'||mode==='retained-fact-kill'||mode==='retained-fact-recover'){
    const runId='retained-fact';
    if(mode!=='retained-fact-recover'){
      await store.createRun({runId,inputSha256:'b'.repeat(64),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:new Date(Date.now()+20000).toISOString(),data:{budget:{}}});
      if(mode==='retained-fact'){
        const unavailable=await store.ensureFlowFact(runId,'retained-fixture',async()=>JSON.parse(await readFile(path.join(home,'retained-source.json'),'utf8')));
        assert.equal(unavailable.state,'unavailable');assert.equal(await store.flowFact(runId,'retained-fixture'),null);
        await assert.rejects(store.ensureFlowFact('missing-run','retained-fixture',async()=>({wrong:true})),/Unknown DBOS Run/);
      }
      await writeFile(path.join(home,'retained-source.json'),JSON.stringify({body:'retained bytes '.repeat(10000)}));
    }
    const handle=mode==='retained-fact-recover'?DBOS.retrieveWorkflow('fixture-retained-fact'):await runtime.startWorkflow('fixture.retained-materialization','fixture-retained-fact',{runId});
    const metadata=await handle.getResult();
    assert.equal(retainedProducerCalls,mode==='retained-fact-recover'?0:1,'Frozen source producer must run once, including replay after source disappears');
    const {Pool}=require('pg'),application=new Pool(database.application),system=new Pool(database.system);
    try {
      // SDK clears completed datasource checkpoints; the system step receipts are retained.
      const receipts=(await system.query("SELECT count(*)::int AS count,max(octet_length(output::text))::int AS maximum FROM dbos.operation_outputs WHERE workflow_uuid='fixture-retained-fact' AND function_name='hima.ensureFlowFact'")).rows[0];
      assert.equal(receipts.count,12);assert.ok(receipts.maximum<1024,JSON.stringify(receipts));
      const facts=(await application.query("SELECT count(*)::int AS count FROM hima.flow_facts WHERE run_id=$1 AND name='retained-fixture'",[runId])).rows[0];assert.equal(facts.count,1);
      send({ok:true,metadata,producerCalls:retainedProducerCalls,receipts});
    }finally{await application.end();await system.end();}
  }else if(mode==='idle-receipts'){
    const opening={runId:'idle-receipts',inputSha256:'b'.repeat(64),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:new Date(Date.now()+7200000).toISOString(),data:{budget:{}}};
    await store.createRun(opening);await command('idle-receipts','pause');
    await startFlow(runtime,{runId:'idle-receipts',flow:methods.human,runInput:{},goal:{},strategy:{}});
    await until(async()=>(await store.flowInvocations('idle-receipts')).length===1);
    await new Promise(resolve=>setTimeout(resolve,8000));
    const {Pool}=require('pg'),system=new Pool(database.system),application=new Pool(database.application);
    try {
      const systemRows=Number((await system.query('SELECT count(*) FROM dbos.operation_outputs')).rows[0].count);
      const applicationRows=Number((await application.query('SELECT count(*) FROM dbos.transaction_completion')).rows[0].count);
      const watchdogOpeningCopies=Number((await application.query("SELECT count(*) FROM dbos.transaction_completion WHERE workflow_id LIKE 'hima-deadline:%' AND output::text LIKE '%opening%'")).rows[0].count);
      send({stage:'idle-sample',systemRows,applicationRows,watchdogOpeningCopies,deadline:opening.deadlineAt});
      assert.equal(watchdogOpeningCopies,0,'Idle watchdog must not receipt immutable Run opening');
      assert.ok(systemRows+applicationRows<=85,`Eight-second held Run created ${systemRows+applicationRows} durable receipts`);
      send({stage:'idle-bounded'});
    }finally{await system.end();await application.end();}
  }else if(mode==='idle-recover'){
    await trace('read-recovered-flow');
    const view=await readFlow(runtime,'idle-receipts');await trace('recovered-flow-read');
    assert.ok(['PENDING','ENQUEUED'].includes(view.workflow.status));assert.equal((await rows()).length,0);
    await until(async()=>(await readFlow(runtime,'idle-receipts')).workflow.status==='PENDING');
    await trace('recovered-flow-pending');
    const startupMs=Date.now()-workerStarted;assert.ok(startupMs<5000,`Host recovery took ${startupMs}ms`);send({stage:'idle-reopened',startupMs,deadline:view.run.deadlineAt});
    const continuedAt=Date.now();await command('idle-receipts','continue');
    const invocation=(await store.flowInvocations('idle-receipts'))[0];
    await until(async()=>Boolean(await store.effect(invocation.identity.effectId)));
    const continueWakeMs=Date.now()-continuedAt;assert.ok(continueWakeMs<7000,`Held task resume took ${continueWakeMs}ms`);
    await command('idle-receipts','respond',{response:{effectId:invocation.identity.effectId,output:{schemaVersion:'1',value:{confirmed:true},artifacts:[],diagnostics:[]}}});
    const result:any=await DBOS.retrieveWorkflow(view.workflow.workflowID).getResult();assert.equal(result.state,'succeeded');
    send({ok:true,deadline:view.run.deadlineAt,startupMs,continueWakeMs,result});
  }else if(mode==='materialization-kill'){
    const {opening}=await open('materialization-restart','materialization',{},20000);
    await until(async()=>(await rows()).some((row:any)=>row.phase==='start'));
    await writeFile(path.join(home,'materialization-unavailable'),'binding temporarily unavailable');
    await until(async()=>(await store.flowProjection('materialization-restart')).tasks.some((task:any)=>task.state.diagnostic?.code==='adapter-materialization'));
    const original=(await store.flowInvocations('materialization-restart'))[0];send({stage:'materialization-held',effectId:original.identity.effectId,deadline:opening.deadlineAt});
  }else if(mode==='materialization-recover'){
    const view=await readFlow(runtime,'materialization-restart');await command('materialization-restart','continue');
    const result:any=await DBOS.retrieveWorkflow(view.workflow.workflowID).getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));
    assert.equal((await rows()).filter((row:any)=>row.phase==='start').length,1);assert.equal((await store.flowInvocations('materialization-restart')).length,1);
    send({ok:true,deadline:view.run.deadlineAt,effectId:result.committed.materialization.identity.effectId});
  }else if(mode==='materialization'||mode==='materialization-cleanup'){
    const {handle,opening}=await open(mode,mode,{},20000);
    await until(async()=>(await rows()).some((row:any)=>row.phase==='start'));
    const original=(await store.flowInvocations(mode))[0];
    await writeFile(path.join(home,'materialization-unavailable'),'binding temporarily unavailable');
    if(mode==='materialization'){
      await until(async()=>{const view=await readFlow(runtime,mode);assert.notEqual(view.workflow.status,'ERROR','Recoverable resolver error permanently killed original workflow');return view.tasks.some((task:any)=>task.state.diagnostic?.code==='adapter-materialization');});
      const held=await readFlow(runtime,mode);assert.equal(held.tasks[0].state.state,'waiting');
      await unlink(path.join(home,'materialization-unavailable'));
      await command(mode,'continue');
      const result:any=await handle.getResult();assert.equal(result.state,'succeeded');assert.equal(result.committed.materialization.identity.effectId,original.identity.effectId);
    }else{
      const run=await store.run(mode);const control=await controlFlow(runtime,{runId:mode,commandId:'cancel-materialization',action:'cancel',owner:run.owner,epoch:run.epoch,revision:run.revision});
      await until(async()=>(await store.run(mode)).cancelled);
      await new Promise(resolve=>setTimeout(resolve,600));
      const {Pool}=require('pg'),system=new Pool(database.system);
      try{assert.equal(Number((await system.query("SELECT count(*) FROM dbos.workflow_status WHERE status='ERROR'")).rows[0].count),0,'Recoverable cleanup resolver error permanently killed cleanup');}finally{await system.end();}
      assert.ok((await store.effectResources(original.identity.effectId)).some((lease:any)=>!lease.released));
      await unlink(path.join(home,'materialization-unavailable'));
      const stopped:any=await control.getResult();assert.equal(stopped.cleanup[0].closed,true);assert.equal((await handle.getResult()).state,'cancelled');
      assert.equal((await store.effectResources(original.identity.effectId)).every((lease:any)=>lease.released),true);
    }
    assert.equal((await rows()).filter((row:any)=>row.phase==='start').length,1,'Original submitted Job must never be resent');
    assert.equal((await store.run(mode)).deadlineAt,opening.deadlineAt);assert.equal((await store.flowInvocations(mode)).length,1);
    send({ok:true,original,deadline:opening.deadlineAt});
  }else if(mode==='pause'){
    const {handle}=await open('pause','pause');await until(async()=>(await rows()).some((r:any)=>r.task==='a'&&r.phase==='start'));
    const before=await store.run('pause');const response=await command('pause','pause',{scope:{taskId:'a'}});assert.equal(response.run.epoch,before.epoch);
    await until(async()=>(await rows()).some((r:any)=>r.task==='b'&&r.phase==='end'));await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal((await rows()).some((r:any)=>r.task==='a-next'),false);send({stage:'paused',view:await readFlow(runtime,'pause')});
    await command('pause','continue',{scope:{taskId:'a'}});const result:any=await handle.getResult();assert.equal(result.state,'succeeded');send({ok:true,result,rows:await rows()});
  }else if(mode==='cancel'||mode==='unknown'){
    const scenario=mode;const {handle}=await open(scenario,scenario,{},scenario==='unknown'?2500:15000);
    await until(async()=>(await rows()).some((r:any)=>r.phase==='start'));
    const control:any=await command(scenario,'cancel');assert.equal(control.cleanup.length,1);
    assert.equal(control.cleanup[0].closed,scenario!=='unknown');const result:any=await handle.getResult();
    assert.equal(result.state,scenario==='unknown'?'waiting':'cancelled');assert.equal((await store.effectResources()).filter((r:any)=>!r.released).length,scenario==='unknown'?1:0);
    send({ok:true,result,control,rows:await rows()});
  }else if(mode==='human'){
    const {handle}=await open('human','human');await until(async()=>(await store.flowInvocations('human')).length===1);
    const invocation=(await store.flowInvocations('human'))[0];await command('human','respond',{response:{effectId:invocation.identity.effectId,output:{schemaVersion:'1',value:{confirmed:true},artifacts:[],diagnostics:[]}}});
    const result:any=await handle.getResult();assert.equal(result.committed.human.value.confirmed,true);assert.equal((await rows()).length,0);send({ok:true,result});
  }else if(mode==='revise'){
    const {handle}=await open('revise','revise');await until(async()=>(await rows()).some((r:any)=>r.task==='a'&&r.phase==='end'));
    const b=(await store.flowInvocations('revise')).find((r:any)=>r.identity.taskId==='b');assert.ok(b);
    const derived={...b.identity,taskId:'b:proof-child',effectId:`${b.identity.effectId}:proof-child`};await store.bindDerivedEffect(b.identity,derived);await store.prepareExternalEffect(derived,{kind:'authority-proof'});
    const oldRun=await store.run('revise');const changed:any=await command('revise','revise',{change:{taskId:'a',input:{n:2},evidence:{reason:'Changed actual task input'}}});
    assert.equal(changed.run.epoch,oldRun.epoch);assert.equal(changed.run.deadlineAt,oldRun.deadlineAt);
    await store.assertEffectAdmission({runId:'revise',effectId:b.identity.effectId,owner:oldRun.owner,epoch:oldRun.epoch,revision:oldRun.revision},async()=>true);
    await store.assertEffectAdmission({runId:'revise',effectId:derived.effectId,owner:oldRun.owner,epoch:oldRun.epoch,revision:oldRun.revision},async()=>true);
    await assert.rejects(store.bindDerivedEffect(b.identity,{...derived,inputSha256:'c'.repeat(64)}),/different input/);
    const revised:any=await DBOS.retrieveWorkflow(changed.workflowId).getResult();assert.equal(revised.state,'succeeded',JSON.stringify(revised));assert.equal(revised.committed.a.value.n,2);
    const calls=await rows();assert.equal(calls.filter((r:any)=>r.task==='b'&&r.phase==='start').length,1);assert.equal(calls.filter((r:any)=>r.task==='a'&&r.phase==='start').length,2);
    const prior:any=await handle.getResult();assert.equal(prior.state,'superseded');send({ok:true,prior,revised,calls});
  }else if(mode==='human-hold'){
    await open('human-hold','pause',{},20000);await until(async()=>(await rows()).some((r:any)=>r.task==='a'&&r.phase==='start'));await command('human-hold','pause',{scope:{taskId:'a'},origin:'human'});await command('human-hold','pause',{scope:{taskId:'a'},origin:'agent'});await assert.rejects(command('human-hold','continue',{scope:{taskId:'a'},origin:'agent'}),/human/);send({stage:'human-held'});
  }else if(mode==='human-hold-recover'){
    await assert.rejects(command('human-hold','continue',{scope:{taskId:'a'},origin:'agent'}),/human/);await command('human-hold','continue',{origin:'human'});await new Promise(resolve=>setTimeout(resolve,300));assert.equal((await rows()).some((r:any)=>r.task==='a-next'),false);await command('human-hold','continue',{scope:{taskId:'a'},origin:'human'});
    const view=await readFlow(runtime,'human-hold');const result:any=await DBOS.retrieveWorkflow(view.workflow.workflowID).getResult();assert.equal(result.state,'succeeded');await command('human-hold','pause',{origin:'agent'});await command('human-hold','continue',{origin:'agent'});send({ok:true,result});
  }else if(mode==='pending-ready'){
    const {handle}=await open('pending-ready','pending-ready');await until(async()=>(await store.flowProjection('pending-ready')).tasks.some((t:any)=>t.state.state==='waiting'));
    assert.equal((await store.effectResources()).length,0);assert.equal((await rows()).length,0);await writeFile(path.join(home,'ready-gate'),'ready');const result:any=await handle.getResult();assert.equal(result.state,'succeeded');assert.equal((await rows()).filter((r:any)=>r.phase==='start').length,1);send({ok:true,result});
  }else if(mode==='hard-blocked'){
    const {handle,opening}=await open('hard-blocked','hard-blocked',{},1800);await until(async()=>Boolean(await store.flowFact('hard-blocked','hard-deadline-closure:0')));
    assert.equal((await store.run('hard-blocked')).deadlineAt,opening.deadlineAt);assert.ok((await store.effectResources()).every((r:any)=>r.released));send({stage:'hard-closed',opening});await writeFile(path.join(home,'dispatch-gate'),'return original receipt');const result:any=await handle.getResult();assert.notEqual(result.state,'succeeded');send({ok:true,result});
  }else if(mode==='watch-lifecycle'){
    const {handle}=await open('watch-lifecycle','choice',{},60000);assert.equal((await handle.getResult()).state,'succeeded');const watch=await (await load('flow-workflow')).scheduleFlowDeadline(runtime,'watch-lifecycle');const settled:any=await watch.getResult();assert.equal(settled.closed,true);assert.equal(settled.completedBeforeDeadline,true);
    const old=(await store.flowInvocations('watch-lifecycle')).find((r:any)=>r.identity.taskId==='selected');const changed:any=await command('watch-lifecycle','revise',{change:{taskId:'selected',effectId:old.identity.effectId,input:{},evidence:{reason:'New occurrence retains original deadline'}}});assert.equal((await DBOS.retrieveWorkflow(changed.workflowId).getResult()).state,'succeeded');assert.equal((await (await (await load('flow-workflow')).scheduleFlowDeadline(runtime,'watch-lifecycle')).getResult()).closed,true);send({ok:true,settled});
  }else if(mode==='failed-revise'){
    const {handle,opening}=await open('failed-revise','failed-revise',{attemptLimit:2});assert.equal((await handle.getResult()).state,'failed');await command('failed-revise','pause',{origin:'human'});
    const old=(await store.flowInvocations('failed-revise'))[0];const revised:any=await command('failed-revise','revise',{change:{taskId:'fails-once',effectId:old.identity.effectId,input:{fail:false},evidence:{reason:'Explicit correction after real failed original'}}});await assert.rejects(command('failed-revise','continue',{origin:'agent'}),/human/);assert.equal((await rows()).filter((r:any)=>r.phase==='start').length,1);await command('failed-revise','continue',{origin:'human'});
    const result:any=await DBOS.retrieveWorkflow(revised.workflowId).getResult();assert.equal(result.state,'succeeded');const authority=await store.flowAuthority('failed-revise');assert.equal(authority.dispatchedEffects.length,2);assert.equal(authority.run.deadlineAt,opening.deadlineAt);send({ok:true,result});
  }else if(mode==='multi-fields'){
    const {handle}=await open('multi-fields','multi-fields');await until(async()=>(await rows()).filter((r:any)=>r.phase==='start'&&['patch-a','patch-b'].includes(r.task)).length===2);const records=await store.flowInvocations('multi-fields'),a=records.find((r:any)=>r.identity.taskId==='patch-a'),b=records.find((r:any)=>r.identity.taskId==='patch-b');
    const changed:any=await command('multi-fields','revise',{change:{taskId:'patch-a',effectId:a.identity.effectId,input:{scale:1,delay:800},additionalEffects:[{taskId:'patch-b',effectId:b.identity.effectId}],inputPatches:[{taskId:'patch-a',fields:{scale:3}},{taskId:'patch-b',fields:{scale:3}},{taskId:'patch-choice',fields:{newScale:4}}],evidence:{reason:'Finite selected-iteration shared input patches'}}});
    const result:any=await DBOS.retrieveWorkflow(changed.workflowId).getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));const calls=await rows(),starts=calls.filter((r:any)=>r.phase==='start');for(const id of ['patch-a','patch-b']){assert.equal(starts.filter((r:any)=>r.task===id&&r.input.scale===3).length,1);assert.equal(starts.filter((r:any)=>r.task===id&&r.input.scale===4).length,1);}assert.equal(starts.filter((r:any)=>r.task==='unchanged').length,2);assert.equal(result.committed['patch-choice'].value.scale,5);assert.equal((await handle.getResult()).state,'superseded');send({ok:true,result,calls});
  }else if(mode?.startsWith('optional-')){
    const {handle}=await open(mode,mode);if(mode!=='optional-failed'){
      await until(async()=>(await rows()).some((r:any)=>r.task==='optional-tool'&&r.phase==='start'));
      const producer=(await store.flowInvocations(mode)).find((r:any)=>r.identity.taskId==='optional-producer');
      const controlled:any=await command(mode,'cancel',{scope:{extension:{producerEffectId:producer.identity.effectId,slotId:'@optional-producer/growth'}},disposition:mode.slice(9),rationale:'Owner stops only optional diagnostic'});
      assert.ok(controlled.cleanup.every((r:any)=>r.closed));assert.equal((await store.run(mode)).cancelled,false);
    }
    const result:any=await handle.getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(result.committed['optional-producer'].value.goalMet,false);assert.equal(result.committed['@optional-producer/growth-resume'].value.diagnosticStatus,mode.slice(9));
    assert.equal(result.extensionResults['@optional-producer/growth'].status,mode.slice(9));assert.equal((await store.effectResources()).filter((r:any)=>!r.released).length,0);send({ok:true,result});
  }else if(mode==='reader-pending'){
    const {handle}=await open('reader-pending','reader-pending');await until(async()=>(await rows()).some((r:any)=>r.task==='reader-child'&&r.phase==='start'));
    await new Promise(resolve=>setTimeout(resolve,500));const view=await readFlow(runtime,'reader-pending');const taskView=view.tasks.find((t:any)=>t.identity.taskId==='reader-parent');assert.equal(taskView.state.state,'running');assert.doesNotMatch(taskView.state.reason??'',/unknown|rejected/);
    const running=(await store.pendingFacts('reader-pending')).filter((f:any)=>f.kind==='flow-state');assert.ok(running.length<=3,JSON.stringify(running));
    const result:any=await handle.getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal((await rows()).filter((r:any)=>r.task==='reader-child'&&r.phase==='start').length,1);send({ok:true,result,running,view});
  }else if(mode==='revision-hold'){
    const {handle,start}=await open('revision-hold','revision-hold',{},15000);await until(async()=>(await rows()).some((r:any)=>r.phase==='start'));
    const old=(await store.flowInvocations('revision-hold'))[0],run=await store.run('revision-hold');
    const control=await controlFlow(runtime,{runId:run.runId,commandId:'revise-held',action:'revise',owner:run.owner,epoch:run.epoch,revision:run.revision,change:{taskId:'held-revision',effectId:old.identity.effectId,input:{n:2,delay:0},evidence:{reason:'Capacity remains available but old affected tree is unknown'}}});
    await until(async()=>(await store.run('revision-hold')).revision===1);
    const next=await startFlow(runtime,start);await new Promise(resolve=>setTimeout(resolve,600));
    assert.equal((await rows()).filter((r:any)=>r.phase==='start').length,1);const staged=(await readFile(path.join(home,'stages'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));assert.equal(staged.filter((r:any)=>r.input.n===2).length,0);
    assert.ok((await store.effectResources()).some((r:any)=>!r.released));send({stage:'held-replacement',view:await readFlow(runtime,'revision-hold')});
    await writeFile(path.join(home,'original-close-gate'),'prove genuine original stop');const accepted:any=await control.getResult();assert.ok(accepted.cleanup.every((r:any)=>r.closed));
    const result:any=await next.getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(result.committed['held-revision'].value.n,2);assert.equal((await rows()).filter((r:any)=>r.phase==='start').length,2);assert.equal((await handle.getResult()).state,'superseded');send({ok:true,result,accepted});
  }else if(mode==='cleanup-race'){
    const {handle}=await open(mode,mode,{},20000);await until(async()=>(await rows()).some((row:any)=>row.phase==='start'));
    const original=(await store.flowInvocations(mode))[0];
    await assert.rejects(store.confirmFlowStopped(original.identity),/closure is unproved/);
    const stopped:any=await command(mode,'cancel');assert.equal(stopped.cleanup[0].closed,true);assert.equal((await handle.getResult()).state,'cancelled');
    assert.equal((await DBOS.listWorkflows({status:'ERROR'})).length,0,'Physical closure must not hide failed concurrent cleanup workflows');
    await assert.rejects(store.confirmFlowStopped({...original.identity,inputSha256:'c'.repeat(64)}),/different input/);
    await assert.rejects(store.confirmFlowStopped({...original.identity,effectId:'other-original-effect'}),/different input/);
    const confirmed:any=await store.confirmFlowStopped(original.identity);const lease=(await store.effectResources(original.identity.effectId))[0];assert.deepEqual(confirmed.proof,lease.proof);
    assert.equal(cleanupObservations,2);assert.equal((await rows()).filter((row:any)=>row.phase==='start').length,1);
    const facts=await store.pendingFacts(mode);assert.equal(facts.filter((fact:any)=>fact.kind==='resources-released').length,1);
    assert.equal(facts.filter((fact:any)=>fact.kind==='flow-fact'&&fact.payload.name===`stopped:${original.identity.effectId}`).length,1);
    for(const pending of ['never-dispatched','claimed-without-proof']){
      const runId=`cleanup-${pending}`,run=await store.createRun({runId,inputSha256:'b'.repeat(64),applicationVersion:runtime.applicationVersion,owner:'owner',deadlineAt:new Date(Date.now()+20000).toISOString(),data:{budget:{}}});
      const identity={...original.identity,runId,effectId:`fixture-${pending}`};
      await store.recordFlowInvocation({...original,identity,context:{...original.context,runId}});
      if(pending==='never-dispatched'){
        const safe:any=await store.confirmFlowStopped(identity);assert.equal(safe.closed,true);assert.equal(safe.proof.unstarted,true);
      }else{
        await store.prepareEffect(identity,{original:true});
        assert.equal(await store.claimEffectDispatch({runId,effectId:identity.effectId,owner:run.owner,epoch:run.epoch,revision:run.revision},async()=>true,'submit',identity.inputSha256),true);
        await assert.rejects(store.confirmFlowStopped(identity),/closure is unproved/);
        assert.equal(await store.flowFact(runId,`stopped:${identity.effectId}`),null,'Claimed external unknown must never acquire a false stop receipt');
      }
    }
    send({ok:true,original,stopped,cleanupObservations});
  }else if(mode==='closure-race'){
    const {handle}=await open('closure-race','closure-race');const result:any=await handle.getResult();assert.equal(result.state,'cancelled');assert.equal(result.committed.closure.value.n,42);
    const leases=await store.effectResources();assert.equal(leases.length,1);assert.equal(leases[0].proof.observation,'control');const facts=await store.pendingFacts('closure-race');assert.equal(facts.filter((f:any)=>f.kind==='resources-released').length,1);
    await assert.rejects(store.releaseEffectResources({...result.committed.closure.identity,inputSha256:'c'.repeat(64)},{closed:true}),/different input/);send({ok:true,result,leases});
  }else if(mode==='frontier'){
    const {handle,opening}=await open('frontier','frontier',{},20000);await until(async()=>(await rows()).some((r:any)=>r.task==='frontier-a'&&r.input.n===2&&r.phase==='start'));
    const selected=(await store.flowInvocations('frontier')).find((r:any)=>r.identity.taskId==='frontier-a'&&(r.context as any).iterations[0].iteration===2);assert.ok(selected);
    await assert.rejects(command('frontier','revise',{change:{taskId:'frontier-a',input:{n:10},evidence:{reason:'Ambiguous without current effect'}}}),/effectId/);
    const changed:any=await command('frontier','revise',{change:{taskId:'frontier-a',effectId:selected.identity.effectId,input:{n:10},evidence:{reason:'Revise current occurrence with original carried prefix'}}});
    const result:any=await DBOS.retrieveWorkflow(changed.workflowId).getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(result.committed['frontier-a'].value.n,11);assert.equal(result.committed['frontier-b'].value.n,2);
    assert.equal((await store.run('frontier')).deadlineAt,opening.deadlineAt);const calls=await rows(),starts=calls.filter((r:any)=>r.phase==='start');
    for(const n of [0,1])assert.equal(starts.filter((r:any)=>r.task==='frontier-a'&&r.input.n===n).length,1);
    for(const n of [0,1,2])assert.equal(starts.filter((r:any)=>r.task==='frontier-b'&&r.input.n===n).length,1);
    assert.equal(starts.filter((r:any)=>r.task==='frontier-a'&&r.input.n===10).length,1);
    const revised=(await store.flowInvocations('frontier')).filter((r:any)=>r.identity.taskId==='frontier-a'&&r.version===1);assert.equal(revised.length,1);assert.equal((revised[0].context as any).iterations[0].iteration,2);
    assert.equal((await handle.getResult()).state,'superseded');send({ok:true,result,calls,selected});
  }else if(mode==='handoff'){
    const {handle}=await open('handoff','cancel');await until(async()=>(await rows()).some((r:any)=>r.phase==='start'));
    const original=(await store.flowInvocations('handoff'))[0],before=await store.run('handoff');
    const fixed={runId:'handoff',commandId:'once',action:'handoff',owner:before.owner,epoch:before.epoch,revision:before.revision,nextOwner:'next-owner'};
    const one:any=await(await controlFlow(runtime,fixed)).getResult();assert.equal(one.run.owner,'next-owner');assert.deepEqual(await(await controlFlow(runtime,fixed)).getResult(),one);
    await assert.rejects((await controlFlow(runtime,{...fixed,nextOwner:'wrong-owner'})).getResult(),/different input/);
    await assert.rejects(store.assertEffectAdmission({runId:'handoff',effectId:original.identity.effectId,owner:before.owner,epoch:before.epoch,revision:before.revision},async()=>true),/current owner/);
    await store.assertEffectAdmission({runId:'handoff',effectId:original.identity.effectId,owner:'next-owner',epoch:one.run.epoch,revision:one.run.revision},async()=>true);
    const control:any=await command('handoff','cancel');assert.equal(control.notificationOwner,'next-owner');assert.equal(control.cleanup[0].closed,true);assert.equal((await handle.getResult()).state,'cancelled');send({ok:true,control});
  }else if(mode==='attempts'){
    const {handle}=await open('attempts','attempts',{attemptLimit:1});const result:any=await handle.getResult();assert.equal(result.state,'waiting');assert.match(result.reason,/attempt budget/);const calls=await rows();assert.equal(calls.filter((r:any)=>r.phase==='start').length,1);assert.equal(calls.some((r:any)=>r.task==='two'),false);send({ok:true,result,calls});
  }else if(mode==='fragment-revise'){
    const {handle}=await open('fragment-revise','fragment-revise');await until(async()=>(await store.flowInvocations('fragment-revise')).some((r:any)=>r.identity.taskId==='response'));
    const changed:any=await command('fragment-revise','revise',{change:{taskId:'producer',input:{n:2},evidence:{reason:'Producer input changed; same frozen fragment now has a fresh invocation'}}});
    await until(async()=>(await store.flowInvocations('fragment-revise')).some((r:any)=>r.identity.taskId==='response'&&r.version===1));
    const response=(await store.flowInvocations('fragment-revise')).find((r:any)=>r.identity.taskId==='response'&&r.version===1);
    await command('fragment-revise','respond',{response:{effectId:response.identity.effectId,output:{schemaVersion:'1',value:{accepted:true},artifacts:[],diagnostics:[]}}});
    const result:any=await DBOS.retrieveWorkflow(changed.workflowId).getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));assert.equal(result.committed.producer.value.n,2);
    const calls=await rows();for(const id of ['producer','diagnostic','consumer'])assert.equal(calls.filter((r:any)=>r.task===id&&r.phase==='start').length,2,id);assert.equal((await handle.getResult()).state,'superseded');send({ok:true,result,calls});
  }else if(mode==='closing-budget'){
    const {handle,opening}=await open('closing-budget','closing-budget',{closingReserveMs:13500,attemptLimit:1},15000);
    const result:any=await handle.getResult(),calls=await rows(),authority=await store.flowAuthority('closing-budget');
    assert.equal(result.committed.delivery.value.n,42,JSON.stringify(result));
    assert.equal(result.state,'waiting');
    assert.equal(calls.filter((row:any)=>row.phase==='start').length,2);
    assert.equal(calls.some((row:any)=>row.task==='forbidden'),false);
    const delivery=calls.find((row:any)=>row.task==='delivery'&&row.phase==='start');
    assert.ok(delivery.at>=Date.parse(opening.deadlineAt)-13500,'delivery actually starts inside the original reserve');
    assert.equal(authority.dispatchedEffects.length,1,'closing delivery does not consume another experiment attempt');
    assert.equal(authority.run.deadlineAt,opening.deadlineAt);send({ok:true,result,calls});
  }else if(mode==='closing-hard'){
    const {handle,opening}=await open('closing-hard','closing-hard',{closingReserveMs:7000},8000);
    const timer=setTimeout(()=>void writeFile(path.join(home,'dispatch-gate'),'resume'),Math.max(0,Date.parse(opening.deadlineAt)-Date.now()+100));
    try{const result:any=await handle.getResult();assert.notEqual(result.state,'succeeded');assert.equal((await rows()).length,0,'closing task cannot submit after the original hard deadline');assert.equal((await store.run('closing-hard')).deadlineAt,opening.deadlineAt);send({ok:true,result});}finally{clearTimeout(timer);}
  }else if(mode==='deadline'){
    const {handle,opening}=await open('deadline','deadline',{closingReserveMs:700},1000);const result:any=await handle.getResult();
    assert.equal(result.state,'waiting');assert.equal((await rows()).some((r:any)=>r.task==='forbidden'),false);assert.equal((await store.run('deadline')).deadlineAt,opening.deadlineAt);send({ok:true,result,opening});
  }else if(mode?.startsWith('crash-')){
    const scenario=mode.slice(6);await open(`crash-${scenario}`,scenario,{},20000);
  }else if(mode?.startsWith('recover-')){
    const scenario=mode.slice(8),runId=`crash-${scenario}`;const view=await readFlow(runtime,runId);assert.ok(view.workflow);
    const result:any=await DBOS.retrieveWorkflow(view.workflow.workflowID).getResult();assert.equal(result.state,'succeeded',JSON.stringify(result));
    const calls=await rows(),starts=calls.filter((row:any)=>row.phase==='start');
    if(scenario==='choice'){assert.equal(starts.filter((row:any)=>row.task==='decide').length,1);assert.equal(starts.filter((row:any)=>row.task==='selected').length,1);assert.equal(starts.filter((row:any)=>row.task==='unselected').length,0);}
    if(scenario==='repeat'){assert.equal(starts.filter((row:any)=>row.task==='iteration').length,2);assert.equal(result.committed.iteration.value.n,2);}
    if(scenario==='extension'){for(const taskId of ['producer','diagnostic','consumer'])assert.equal(starts.filter((row:any)=>row.task===taskId).length,1);assert.equal(result.committed.consumer.value.n,9);}
    send({ok:true,result,calls,view});
  }else if(mode==='cached'){
    await open('cached','cached',{},15000);
  }else if(mode==='cached-recover'){
    const run=await store.run('cached');send({stage:'reopened',view:await readFlow(runtime,'cached'),deadline:run.deadlineAt});
    await writeFile(path.join(home,'dispatch-gate'),'continue original callback');
    await new Promise(resolve=>setTimeout(resolve,600));send({stage:'held',rows:await rows(),view:await readFlow(runtime,'cached')});
  }else throw new Error(`Unknown fixture mode ${mode}`);
}
async function exists(file: string): Promise<boolean> { try { await readFile(file);return true; } catch { return false; } }
