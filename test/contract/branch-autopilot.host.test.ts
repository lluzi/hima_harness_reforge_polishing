// @hima-seam llm-replay direct
// ADR-0018: existing self-driving behavior now uses the sole DBOS execution authority.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { loadPack } from '@hima/harness';
import { defaults, packId, writePack } from './support/branch-declaration.ts';
test('native stop closes original resources; Team dependencies and sibling occurrence revision preserve actual native authority', { timeout:90000 }, async () => {
  const { mkdir, writeFile, realpath, readFile, rm, symlink }=await import('node:fs/promises');
  const path=(await import('node:path')).default;
  const {pathToFileURL}=await import('node:url');
  const {stringify}=await import('yaml');
  const {createHimaHome,repoRoot}=await import('./support/dsh-home.ts');
  const {bootInProcess,createPresetRootAgent}=await import('./support/boot-inprocess.ts');
  const {writeMomentFixture,appendReplaySession}=await import('./support/moments.ts');
  const {writeReplayOverlay,homePatchFile}=await import('../../packages/desktop/src/hima-home.ts');
  const lib=process.env.HIMA_DBOS_TEST_LIB??path.join(repoRoot,'packages/harness/lib');
  const at=(file:string)=>import(pathToFileURL(path.join(lib,file+'.js')).href);
  const {workshopTaskAdapter,teamTaskAdapter}=await at('native-task-adapters');
  const {executeTaskEffect,taskEffectAdapterVersion,commandTaskAdapter}=await at('task-effects');
  const {jsonDigest}=await at('run-store');
  const {delegationChildSessionId}=await at('delegation');
  const made=await createHimaHome(),h={...made,workspace:await realpath(made.workspace)};
  if(process.env.HIMA_DBOS_TEST_PACKAGE) {const link=path.join(h.profileDir,'node_modules/@hima/harness');await rm(link,{recursive:true,force:true});await symlink(process.env.HIMA_DBOS_TEST_PACKAGE,link,'dir');}
  let host:any,unlock=()=>{},releaseNativeSibling=()=>{};
  try {
    process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
    const sitesDir=path.join(h.home,'hima/sites'),workshopAbs=path.join(h.workspace,'research');
    await mkdir(sitesDir,{recursive:true});await mkdir(workshopAbs);
    await writeFile(path.join(sitesDir,'native.permit.yml'),stringify({allowedReadRoots:[h.workspace],allowedWriteRoots:[h.workspace],allowedWrappers:['/bin/sh'],forbidden:['services','licences','network','deletions','downloads']}));
    await writeFile(path.join(sitesDir,'native.yml'),stringify({name:'native',kind:'local',workspaceRoot:h.workspace,permit:'./native.permit.yml',bindings:{workspaceRoot:h.workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:2,licences:{fixture:1}}}));
    const say=(text:string)=>({kind:'chunks',chunks:[{type:'block-start',index:0,blockType:'text'},{type:'block-end',index:0,block:{type:'text',text}},{type:'finish',reason:{kind:'stop'}}]});
    const script=`printf 'original\\n' >> '${h.workspace}/stop-program-calls'\nsleep 60\n`;
    let scenario={...await writeMomentFixture(h,'one-turn'),children:[] as readonly string[]};
    await writeFile(scenario.override,JSON.stringify([{kind:'chunks',chunks:[{type:'block-start',index:0,blockType:'tool-call'},{type:'block-end',index:0,block:{type:'tool-call',id:'write-stop-source',name:'hima_workshop_write',arguments:JSON.stringify({path:'entry.sh',content:script})}},{type:'finish',reason:{kind:'tool-calls'}}]},say('Original program written.') ]));
    scenario=await appendReplaySession(scenario,'stop-team',[say('{"schema":"stop-member/1","goalMet":false}') as any]);
    scenario=await appendReplaySession(scenario,'settlement',[say('Wrong schema prose that the actual member must repair.') as any,say('{"schema":"aggregate/1","decision":"accept","goalMet":false}') as any]);
    for(let n=0;n<7;n++)scenario=await appendReplaySession(scenario,`aggregate-${n}`,n===3?[say('Initial terminal schema prose.') as any,say('Still invalid after the one schema feedback.') as any]:[say('{"schema":"aggregate/1","decision":"accept","goalMet":false}') as any]);
    await writeReplayOverlay(h.home,{file:scenario.file,overrideFile:scenario.override,childFiles:scenario.children});
    await import('node:fs/promises').then(({appendFile})=>appendFile(homePatchFile(h.home),`\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sitesDir)}\n    packsDir: ${JSON.stringify(path.join(h.home,'hima/packs'))}\n    knowledgeDir: ${JSON.stringify(path.join(h.home,'hima/knowledge/current'))}\n`));
    host=await bootInProcess(h,{withWebApp:true});
    const parent=await createPresetRootAgent(host.ctx,h.workspace,'standard'),store=host.ctx.hima.durable.store;
    const schema={version:'1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object'}};
    const run=await store.createRun({runId:'bridge-stop',inputSha256:jsonDigest({}),applicationVersion:host.ctx.hima.durable.applicationVersion,owner:String(parent.id),deadlineAt:'2099-01-01T00:00:00.000Z',data:{input:{}}});
    const request={input:{},contract:{input:schema,output:schema},identity:{runId:run.runId,taskId:'workshop',effectId:'bridge-stop-workshop',inputSha256:jsonDigest({}),packSha256:'1'.repeat(64),irSha256:'2'.repeat(64),applicationVersion:run.applicationVersion,adapterVersion:taskEffectAdapterVersion},admission:{runId:run.runId,effectId:'bridge-stop-workshop',owner:run.owner,epoch:run.epoch,revision:run.revision}};
    const adapter=workshopTaskAdapter({ctx:host.ctx,store,request,sitesDir,siteId:'native',workspace:h.workspace,scope:{runId:run.runId,nodeId:'workshop',attempt:1,declaration:{id:'stop',purpose:'Write one long original Job',directory:'research',entry:'entry.sh',language:'sh',inputs:[],reads:[],knowledge:[],produces:'unused',argv:[],licences:{fixture:1}},workshopAbs,reads:[],knowledge:[]},instructions:'Write entry.sh using the granted Workshop tool.',prompt:'Write the original program.',retainedMaterialsDir:path.join(h.home,'retained'),argv:['/bin/sh',path.join(workshopAbs,'entry.sh')],collectProgram:async()=>{throw new Error('A stopped original program cannot deliver a business result');}});
    const pending=await executeTaskEffect(store,request,adapter);assert.ok(['waiting','running'].includes(pending.state),JSON.stringify(pending));
    const programFacts=await store.listExternalEffectFacts(request.identity,'program:');const program=(Object.values(programFacts)[0] as any).identity;
    const prepared=await store.effectFact(program.effectId,'prepared');assert.ok(prepared.session);
    assert.ok((await store.effectResources(program.effectId)).some((lease:any)=>!lease.released));
    const closed=await adapter.stop(await store.effectFact(request.identity.effectId,'prepared'),undefined,(id:string,input:any)=>store.claimEffectCleanup(request.identity,async()=>true,'test-stop:'+id,jsonDigest(input)));
    assert.equal(closed.closed,true,JSON.stringify(closed));assert.ok((await store.effectResources(program.effectId)).every((lease:any)=>lease.released));
    assert.equal(await readFile(path.join(h.workspace,'stop-program-calls'),'utf8'),'original\n');assert.equal(await store.result(program.effectId),undefined);
    const teamReq={...request,identity:{...request.identity,taskId:'team',effectId:'bridge-stop-team'},admission:{...request.admission,effectId:'bridge-stop-team'}};
    const contract:any={delegationId:'original-stop-member',parentSessionId:String(parent.id),role:'reviewer',task:'Return stop-member/1 JSON.',inputRefs:[],workspaceRef:h.workspace,runRef:{runId:run.runId,expectedEpoch:0,expectedRevision:0},nodeRef:'team',allowedTools:[],budgetShare:{maxElapsedMs:60000,maxFollowups:0,maxTokensPerTurn:16000},dependencyIds:[],recipient:{kind:'parent',sessionId:String(parent.id)},status:'requested'};
    const sourceFile=path.join(h.workspace,'source.sh');await writeFile(sourceFile,'exit 0\n');
    const sourceReq={...request,identity:{...request.identity,taskId:'source',effectId:'bridge-stop-source'},admission:{...request.admission,effectId:'bridge-stop-source'}};
    const sourceAdapter=commandTaskAdapter({sitesDir,siteId:'native',workspace:h.workspace,name:'source',argv:['/bin/sh',sourceFile],collect:async()=>({schemaVersion:'1',value:{source:'real-local-job'},artifacts:[],diagnostics:[]})});
    let sourceAnswer;for(let n=0;n<100;n++){sourceAnswer=await executeTaskEffect(store,sourceReq,sourceAdapter);if(sourceAnswer.state==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(sourceAnswer.state,'succeeded');
    contract.allowedTools=['hima_delegation_input'];contract.inputRefs=[`hima-fact:${jsonDigest(['task-result',sourceReq.identity.effectId])}`];
    const childId=delegationChildSessionId(String(parent.id),contract.delegationId);let blocked=false;
    const gate=new Promise<void>(resolve=>unlock=resolve);
    host.ctx.on('agent/request',async({agent}:any,next:any)=>{if(String(agent.id)===childId){blocked=true;await gate;}return next();});
    const team=teamTaskAdapter({ctx:host.ctx,store,request:teamReq,sitesDir,siteId:'native',workspace:h.workspace,members:[{contract}],permit:async()=>true,collectMembers:async()=>({schemaVersion:'1',value:{goalMet:false},artifacts:[],diagnostics:[]})});
    const teamPending=await executeTaskEffect(store,teamReq,team);assert.ok(['waiting','running'].includes(teamPending.state),JSON.stringify(teamPending));
    for(let n=0;n<100&&!blocked;n++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(blocked,true,JSON.stringify({teamPending,facts:await store.listExternalEffectFacts(teamReq.identity,'child:')}));
    const cleanup=(id:string,input:any)=>store.claimEffectCleanup(teamReq.identity,async()=>true,'test-stop:'+id,jsonDigest(input));
    const uncertain=await team.stop(await store.effectFact(teamReq.identity.effectId,'prepared'),undefined,cleanup);
    assert.equal(uncertain.closed,false,'An accepted interrupt does not assert quiescence while the actual request is held');
    unlock();for(let n=0;n<100&&host.ctx.get('agents').get(childId)?.status!=='idle';n++)await new Promise(resolve=>setTimeout(resolve,10));
    const final=await team.stop(await store.effectFact(teamReq.identity.effectId,'prepared'),undefined,cleanup);assert.equal(final.closed,true,JSON.stringify(final));
    // Run the real legacy Team resolver through the Host's finite DBOS registry. Two analysts
    // start while one is held; the dependent reviewer receives their committed source facts.
    const {loadPack}=await at('packs'),{loadSite}=await at('sites'),{startFlow}=await at('flow-workflow');
    const packDir=path.join(h.home,'hima/packs/aggregate-fixture');await mkdir(path.join(packDir,'tools'),{recursive:true});
    const finish='printf done > "$1/aggregate-finished"\n';await writeFile(path.join(packDir,'tools/finish.sh'),finish);await writeFile(path.join(h.workspace,'finish.sh'),finish);
    await writeFile(path.join(h.workspace,'source.txt'),'real retained Reader source\n');
    const member=(id:string,dependencyRoles:string[]=[],optional=false)=>({id,role:id==='one'?'analyst':id==='two'?'researcher':id==='review'?'reviewer':'coding',taskTemplate:'Inspect the exact input and return aggregate/1 JSON.',node:'team-work',inputs:['source'],allowedTools:['hima_delegation_input'],scopePolicy:'declared-inputs-only',budgetShare:{maxElapsedMs:60000,maxFollowups:optional?0:1,maxTokensPerTurn:16000},dependencyRoles,resultSchema:{id:'aggregate/1',required:['decision','goalMet']},recipient:'run-owner',ownerAdoption:'required',identity:'one-child-per-role-per-execution',followup:optional?'forbidden':'reuse-same-child',cancellation:'request-stop-preserve-unknown',terminal:['completed','cancelled','uncertain','refused'],refusalConditions:['Source is unavailable'],...(optional?{optional:true}:{})});
    await writeFile(path.join(packDir,'contract.yml'),stringify({id:'aggregate-fixture',version:'1',title:'Existing Team recipe',strategy:{mode:{type:'choice',options:['fixture'],default:'fixture'}},inputs:[{name:'workspaceRoot'}],outputs:[{name:'source',path:'source.txt',reader:'raw',description:'Source bytes'}],environment:{wrappers:['/bin/sh']},workspace:{copy:[]},tools:[{id:'finish',file:'tools/finish.sh',inputs:['WORKSPACE'],argv:['/bin/sh','${WORKSPACE}/finish.sh','${WORKSPACE}']}],agentTeams:[{id:'aggregate',version:'1',triggerNode:'team-work',members:[member('one'),member('two'),member('review',['one','two']),member('advisory',[],true)]}]}));
    await writeFile(path.join(packDir,'graph.yml'),stringify({id:'aggregate-fixture',version:'1',entry:'read-source',nodes:[{id:'read-source',kind:'act',parameters:{observes:'source'}},{id:'team-work',kind:'act',parameters:{tool:'finish'}}],edges:[{from:'read-source',to:'team-work'}]}));
    const pack=loadPack(path.dirname(packDir),'aggregate-fixture'),site=loadSite(sitesDir,'native'),flow=pack.flow;
    const teamRun=await store.createRun({runId:'aggregate-recipe',inputSha256:jsonDigest({}),applicationVersion:run.applicationVersion,owner:String(parent.id),deadlineAt:'2099-01-01T00:00:00.000Z',data:{budget:{generationLimit:1},product:{campaignId:'aggregate-campaign',siteId:'native',siteDigest:jsonDigest(site),workspace:h.workspace,bindings:{workspaceRoot:h.workspace},method:{packId:pack.id,packDigest:flow.packSha256,retainedPackDir:packDir},parentSessionId:String(parent.id),modelSelection:{provider:parent.options.provider,model:parent.options.model}}}});
    let firstBlocked=false,secondStarted=false,releaseFirst=()=>{};const firstGate=new Promise<void>(resolve=>releaseFirst=resolve);
    host.ctx.on('agent/request',async({agent}:any,next:any)=>{const grant=await store.nativeSessionEffect(String(agent.id));const recipe=(grant?.fact as any)?.effective?.recipe;if(recipe?.teamId==='aggregate') {if(recipe.memberId==='one'){firstBlocked=true;await firstGate;}if(recipe.memberId==='two'){secondStarted=true;releaseFirst();}}return next();});
    const teamHandle=await startFlow(host.ctx.hima.durable,{runId:teamRun.runId,flow,runInput:{},goal:{},strategy:{}});
    let teamTimer:any;const teamOutcome:any=await Promise.race([teamHandle.getResult(),new Promise((_,reject)=>{teamTimer=setTimeout(async()=>{releaseFirst();reject(new Error('Aggregate Team did not deliver: '+JSON.stringify(await store.flowProjection(teamRun.runId))));},20000);})]);clearTimeout(teamTimer);
    assert.equal(teamOutcome.state,'succeeded',JSON.stringify(teamOutcome));assert.equal(firstBlocked,true);assert.equal(secondStarted,true);
    assert.deepEqual(Object.keys(teamOutcome.committed['team-work'].value.members).sort(),['one','review','two']);
    assert.equal(teamOutcome.committed['team-work'].value.members.review.value.goalMet,false);assert.equal(await readFile(path.join(h.workspace,'aggregate-finished'),'utf8'),'done');
    const effect=teamOutcome.committed['team-work'].identity;
    const reviewer=await store.externalEffectFact(effect,'member-options:review');assert.equal(reviewer.contract.dependencyIds.length,2);assert.equal(reviewer.contract.inputRefs.length,3);
    assert.ok(reviewer.contract.inputRefs.includes(teamOutcome.committed['team-work'].value.members.one.factId));assert.ok(reviewer.contract.inputRefs.includes(teamOutcome.committed['team-work'].value.members.two.factId));
    assert.equal(await store.externalEffectFact(effect,'member-options:advisory'),undefined);
    const repairedMembers=[];
    for(const memberId of ['one','two']) {const options=await store.externalEffectFact(effect,`member-options:${memberId}`),child=delegationChildSessionId(options.contract.parentSessionId,options.contract.delegationId),bound=await store.nativeSessionEffect(child),messages=await store.listExternalEffectFacts(bound.identity,'message:');if(Object.keys(messages).some(key=>key.endsWith(':intent')))repairedMembers.push({child,messages});}
    assert.equal(repairedMembers.length,1,'One actual malformed eligible member receives its own bounded feedback');
    const repairedMember=repairedMembers[0];assert.ok(repairedMember);
    assert.equal(Object.keys(repairedMember.messages).filter(key=>key.endsWith(':intent')).length,1);
    const repairedLog=await host.ctx.get('sessionQuery').readSession(repairedMember.child);assert.equal(repairedLog.events.filter((event:any)=>event.type==='turn/start').length,2);
    // Actual native sibling occurrence: revise another fork branch while the original native
    // request is held. Its derived grant remains usable by the real native tool/prompt path.
    const siblingDir=path.join(h.home,'hima/packs/sibling-fixture');await mkdir(path.join(siblingDir,'tools'),{recursive:true});
    const otherScript='printf "%s\\n" "$2" >> "$1/sibling-other-calls"\n';await writeFile(path.join(siblingDir,'tools/other.sh'),otherScript);await writeFile(path.join(h.workspace,'sibling-other.sh'),otherScript);
    await writeFile(path.join(siblingDir,'tools/finish.sh'),finish);
    const siblingMember={...member('one'),node:'native-work'};
    await writeFile(path.join(siblingDir,'contract.yml'),stringify({id:'sibling-fixture',version:'1',title:'Occurrence native sibling',strategy:{mode:{type:'choice',options:['fixture'],default:'fixture'}},inputs:[{name:'workspaceRoot'}],outputs:[{name:'source',path:'source.txt',reader:'raw',description:'Retained source'}],environment:{wrappers:['/bin/sh']},workspace:{copy:[]},tools:[{id:'finish',file:'tools/finish.sh',inputs:['WORKSPACE'],argv:['/bin/sh','${WORKSPACE}/finish.sh','${WORKSPACE}']},{id:'other',file:'tools/other.sh',inputs:['WORKSPACE','WORD'],argv:['/bin/sh','${WORKSPACE}/sibling-other.sh','${WORKSPACE}','${WORD}']}],agentTeams:[{id:'sibling',version:'1',triggerNode:'native-work',members:[siblingMember]}]}));
    await writeFile(path.join(siblingDir,'graph.yml'),stringify({id:'sibling-fixture',version:'1',entry:'read-source',nodes:[{id:'read-source',kind:'act',parameters:{observes:'source'}},{id:'native-work',kind:'act',parameters:{tool:'finish'}},{id:'other-work',kind:'act',parameters:{tool:'other',arguments:{WORD:'original'}}},{id:'join',kind:'judge',parameters:{rules:['setup-wns-all-nonnegative']}},{id:'end',kind:'act',parameters:{tool:'finish'}}],edges:[{from:'read-source',to:'native-work'},{from:'read-source',to:'other-work'},{from:'native-work',to:'join'},{from:'other-work',to:'join'},{from:'join',to:'end',outcome:'PASS'},{from:'join',to:'end',outcome:'FAIL'},{from:'join',to:'end',outcome:'UNDETERMINED'}]}));
    const siblingPack=loadPack(path.dirname(siblingDir),'sibling-fixture'),siblingFlow=siblingPack.flow;
    const siblingRun=await store.createRun({...teamRun.opening,runId:'native-sibling-revision',data:{budget:{generationLimit:1},product:{...teamRun.opening.data.product,campaignId:'sibling-campaign',method:{packId:siblingPack.id,packDigest:siblingFlow.packSha256,retainedPackDir:siblingDir}}}});
    let siblingEntered=false,siblingId='',releaseSibling=()=>{};const siblingGate=new Promise<void>(resolve=>{releaseSibling=resolve;releaseNativeSibling=resolve;});
    host.ctx.on('agent/request',async({agent}:any,next:any)=>{const grant=await store.nativeSessionEffect(String(agent.id));if((grant?.fact as any)?.effective?.recipe?.teamId==='sibling'){siblingEntered=true;siblingId=String(agent.id);await siblingGate;}return next();});
    const originalSiblingHandle=await startFlow(host.ctx.hima.durable,{runId:siblingRun.runId,flow:siblingFlow,runInput:{},goal:{},strategy:{mode:'fixture'}});
    let priorOther:any,priorNative:any;
    for(let n=0;n<300;n++){const rows=await store.flowInvocations(siblingRun.runId);priorOther=rows.find((row:any)=>row.identity.taskId==='other-work');priorNative=rows.find((row:any)=>row.identity.taskId==='native-work');if(siblingEntered&&priorOther&&await store.result(priorOther.identity.effectId))break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(siblingEntered,true);assert.ok(priorOther);assert.ok(priorNative);assert.equal(priorNative.version,0);
    const originalOptions=await store.externalEffectFact(priorNative.identity,'member-options:one'),originalChild=originalOptions.contract.delegationId;
    const {controlFlow}=await at('flow-workflow'),{nativeDelegationPolicy}=await at('native-task-adapters');
    const control=await controlFlow(host.ctx.hima.durable,{runId:siblingRun.runId,commandId:'revise-independent-other',action:'revise',owner:String(parent.id),epoch:0,revision:0,change:{taskId:'other-work',effectId:priorOther.identity.effectId,input:{WORD:'revised'},evidence:{reason:'Bounded different branch input correction'}}});
    const receipt=await control.getResult();assert.equal(receipt.run.revision,1);
    const currentPolicy=await nativeDelegationPolicy(store,siblingId);assert.equal(currentPolicy.writesAllowed,true,JSON.stringify(currentPolicy));assert.equal(currentPolicy.admittedAuthority.revision,0,'A valid independent occurrence retains its admitted version');
    const siblingAgent=host.ctx.get('agents').get(siblingId);assert.ok(siblingAgent);
    const sourceRef=originalOptions.contract.inputRefs[0];
    const actualInput=await host.ctx.tools.execute({agent:siblingAgent,name:'hima_delegation_input',callId:'actual-sibling-after-revision-input',arguments:{runId:siblingRun.runId,recordId:sourceRef,path:'/value'},signal:new AbortController().signal});
    assert.equal(actualInput.isError,false,JSON.stringify(actualInput));assert.match(JSON.stringify(actualInput),/hima-postgresql/);assert.match(JSON.stringify(actualInput),new RegExp(sourceRef));assert.doesNotMatch(JSON.stringify(actualInput),/hima\/delegation-refused|authority is stale|superseded by revision/);
    const kept=(await store.flowInvocations(siblingRun.runId)).filter((row:any)=>row.identity.taskId==='native-work');assert.equal(kept.length,1);assert.equal(kept[0].identity.effectId,priorNative.identity.effectId);
    releaseSibling();
    let siblingTimer:any;const finalSibling:any=await Promise.race([(await startFlow(host.ctx.hima.durable,{runId:siblingRun.runId,flow:siblingFlow,runInput:{},goal:{},strategy:{mode:'fixture'}})).getResult(),new Promise((_,reject)=>{siblingTimer=setTimeout(async()=>reject(new Error('Native sibling revision did not finish: '+JSON.stringify(await store.flowProjection(siblingRun.runId)))),20000);})]);clearTimeout(siblingTimer);
    assert.equal(finalSibling.state,'succeeded',JSON.stringify(finalSibling));assert.equal(finalSibling.committed['native-work'].identity.effectId,priorNative.identity.effectId);assert.notEqual(finalSibling.committed['other-work'].identity.effectId,priorOther.identity.effectId);
    assert.equal((await store.flowInvocations(siblingRun.runId)).filter((row:any)=>row.identity.taskId==='native-work').length,1);
    assert.equal((await store.externalEffectFact(priorNative.identity,'member-options:one')).contract.delegationId,originalChild);
    const nativeLog=await host.ctx.get('sessionQuery').readSession(siblingId);assert.equal(nativeLog.events.filter((event:any)=>event.type==='turn/start').length,1,'The same original child runs one prompt');
    assert.equal(await readFile(path.join(h.workspace,'sibling-other-calls'),'utf8'),'original\nrevised\n');
    assert.equal((await originalSiblingHandle.getResult()).state,'superseded');
    const refusedRun=await store.createRun({...teamRun.opening,runId:'aggregate-schema-terminal'});
    const refusedHandle=await startFlow(host.ctx.hima.durable,{runId:refusedRun.runId,flow,runInput:{},goal:{},strategy:{mode:'fixture'}});let refusedTimer:any;
    const refused:any=await Promise.race([refusedHandle.getResult(),new Promise((_,reject)=>{refusedTimer=setTimeout(()=>reject(new Error('Repeated invalid Team schema did not reach terminal refusal')),15000);})]);clearTimeout(refusedTimer);
    assert.equal(refused.state,'failed',JSON.stringify(refused));assert.match(refused.reason,/one schema repair|allowance/);
    const refusedTask=(await store.flowInvocations(refusedRun.runId)).find((row:any)=>row.identity.taskId==='team-work');assert.equal(await store.result(refusedTask.identity.effectId),undefined);
    const terminal=await store.externalEffectFact(refusedTask.identity,'aggregate-terminal');assert.ok(terminal);

  } finally {unlock();releaseNativeSibling();await host?.dispose();await rm(h.home,{recursive:true,force:true});}
});

for(const scenarioName of ['program-corrected','identical-refused','missing-output-refused','allowance-refused','fallback-total-two','fallback-default-three','max-tokens-corrected','schema-program-schema'])test(`normal Workshop automatic repair: ${scenarioName}`,{timeout:60000},async()=>{
 const {mkdir,writeFile,readFile,rm,symlink,realpath,appendFile}=await import('node:fs/promises'),path=(await import('node:path')).default,{pathToFileURL}=await import('node:url'),{stringify}=await import('yaml');
 const {createHimaHome,repoRoot}=await import('./support/dsh-home.ts'),{bootInProcess,createPresetRootAgent}=await import('./support/boot-inprocess.ts'),{writeMomentFixture}=await import('./support/moments.ts'),{writeReplayOverlay,homePatchFile}=await import('../../packages/desktop/src/hima-home.ts');
 const lib=process.env.HIMA_DBOS_TEST_LIB??path.join(repoRoot,'packages/harness/lib'),at=(name:string)=>import(pathToFileURL(path.join(lib,name+'.js')).href);
 const {loadPack}=await at('packs'),{loadSite}=await at('sites'),{jsonDigest}=await at('run-store'),{startFlow}=await at('flow-workflow');
 const made=await createHimaHome(),h={...made,workspace:await realpath(made.workspace)};let host:any;
 try {
  process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
  if(process.env.HIMA_DBOS_TEST_PACKAGE){const link=path.join(h.profileDir,'node_modules/@hima/harness');await rm(link,{recursive:true,force:true});await symlink(process.env.HIMA_DBOS_TEST_PACKAGE,link,'dir');}
  const sitesDir=path.join(h.home,'hima/sites'),packsDir=path.join(h.home,'hima/packs'),dir=path.join(packsDir,'automatic-workshop');await mkdir(sitesDir,{recursive:true});await mkdir(dir,{recursive:true});
  await writeFile(path.join(sitesDir,'repair.permit.yml'),stringify({allowedReadRoots:[h.workspace,dir],allowedWriteRoots:[h.workspace],allowedWrappers:['/bin/sh'],forbidden:['services','licences','network','deletions','downloads']}));
  await writeFile(path.join(sitesDir,'repair.yml'),stringify({name:'repair',kind:'local',workspaceRoot:h.workspace,permit:'./repair.permit.yml',bindings:{workspaceRoot:h.workspace},capacity:{cores:2,memoryGiB:1,parallelJobs:1,licences:{}}}));
  await writeFile(path.join(dir,'contract.yml'),stringify({id:'automatic-workshop',version:'1',title:'Automatic program repair',strategy:{mode:{type:'choice',options:['fixture'],default:'fixture'}},inputs:[{name:'workspaceRoot'}],outputs:[{name:'result',path:'result.txt',reader:'raw',description:'Actual program result'}],environment:{wrappers:['/bin/sh']},workspace:{copy:[]},workshops:[{id:'analysis',purpose:'Write the declared result',directory:'analysis',entry:'entry.sh',language:'sh',inputs:[],reads:[],knowledge:[],produces:'result',argv:['/bin/sh','${ENTRY}','${WORKSPACE}'],licences:{}}]}));
  await writeFile(path.join(dir,'graph.yml'),stringify({id:'automatic-workshop',version:'1',entry:'analyze',nodes:[{id:'analyze',kind:'act',parameters:{workshop:'analysis'}}],edges:[]}));
  const say=(text:string)=>({kind:'chunks',chunks:[{type:'block-start',index:0,blockType:'text'},{type:'block-end',index:0,block:{type:'text',text}},{type:'finish',reason:{kind:'stop'}}]}),write=(content:string,id:string)=>({kind:'chunks',chunks:[{type:'block-start',index:0,blockType:'tool-call'},{type:'block-end',index:0,block:{type:'tool-call',id,name:'hima_workshop_write',arguments:JSON.stringify({path:'entry.sh',content})}},{type:'finish',reason:{kind:'tool-calls'}}]});
  const bad=(revision=0)=>`# source revision ${revision}\nprintf 'bad\\n' >> "$1/calls"\necho ORIGINAL_PROGRAM_ERROR >&2\nexit 4\n`,good='printf "good\\n" >> "$1/calls"\nprintf "delivered-42\\n" > "$1/result.txt"\n';
  const programCount=scenarioName==='allowance-refused'?4:scenarioName==='fallback-total-two'?2:scenarioName==='fallback-default-three'?3:undefined;
  const entries=scenarioName==='program-corrected'?[write(bad(),'initial-bad'),say('Bad program authored.'),write(good,'corrected-good'),say('Corrected entry authored.')]
   :scenarioName==='identical-refused'?[write(bad(),'initial-bad'),say('Bad program authored.'),write(bad(),'identical-bad'),say('Same unchanged entry authored.')]
   :scenarioName==='missing-output-refused'?[write('printf "bad\\n" >> "$1/calls"\necho MISSING_OUTPUT_PROGRAM >&2\nexit 0\n','missing-initial'),say('Exited zero without output.'),write('printf "bad\\n" >> "$1/calls"\necho MISSING_OUTPUT_PROGRAM >&2\nexit 0\n','missing-identical'),say('Identical missing-output entry.')]:programCount?Array.from({length:programCount},(_,index)=>[write(bad(index),`distinct-bad-${index}`),say(`Revision ${index} authored.`)]).flat()
   :scenarioName==='max-tokens-corrected'?[{kind:'chunks',chunks:[{type:'block-start',index:0,blockType:'reasoning'},{type:'block-end',index:0,block:{type:'reasoning',text:'No complete output yet'}},{type:'finish',reason:{kind:'max-tokens'}}]},write(good,'after-max-tokens'),say('Sourced entry authored.')]
   :[say('Initial prose contains no entry.'),write(bad(),'after-first-schema'),say('Bad program authored.'),say('The program needs another correction, no entry written.'),write(good,'after-second-schema'),say('Corrected entry authored.')];
  const fixture=await writeMomentFixture(h,'one-turn');await writeFile(fixture.override,JSON.stringify(entries));await writeReplayOverlay(h.home,{file:fixture.file,overrideFile:fixture.override,childFiles:[]});
  await appendFile(homePatchFile(h.home),`\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home,'hima/knowledge/current'))}\n`);
  host=await bootInProcess(h,{withWebApp:true});const parent=await createPresetRootAgent(host.ctx,h.workspace,'standard'),pack=loadPack(packsDir,'automatic-workshop'),site=loadSite(sitesDir,'repair'),runtime=host.ctx.hima.durable;
  const run=await runtime.store.createRun({runId:'automatic-'+scenarioName,inputSha256:jsonDigest({}),applicationVersion:runtime.applicationVersion,owner:String(parent.id),deadlineAt:new Date(Date.now()+45000).toISOString(),data:{budget:{generationLimit:1,...(scenarioName==='fallback-default-three'?{}:{retryAllowance:scenarioName==='fallback-total-two'?2:scenarioName==='allowance-refused'||scenarioName==='schema-program-schema'?4:3})},product:{campaignId:scenarioName,siteId:site.name,siteDigest:jsonDigest(site),workspace:h.workspace,bindings:{workspaceRoot:h.workspace},method:{packId:pack.id,packDigest:pack.flow.packSha256,retainedPackDir:dir},parentSessionId:String(parent.id),modelSelection:{provider:parent.options.provider,model:parent.options.model}}}});
  const handle=await startFlow(runtime,{runId:run.runId,flow:pack.flow,runInput:{},goal:{},strategy:{mode:'fixture'}});let timer:any;
  const outcome:any=await Promise.race([handle.getResult(),new Promise((_,reject)=>{timer=setTimeout(async()=>reject(new Error('Automatic repair did not settle: '+JSON.stringify(await runtime.store.flowProjection(run.runId)))),25000);})]);clearTimeout(timer);
  const invocation=(await runtime.store.flowInvocations(run.runId)).find((row:any)=>row.identity.taskId==='analyze'),plans=await runtime.store.listExternalEffectFacts(invocation.identity,'auto-repair:plan:'),programs=await runtime.store.listExternalEffectFacts(invocation.identity,'program:');
  const ids=Object.values(plans).map((value:any)=>value.id);assert.equal(new Set(ids).size,ids.length);assert.ok(ids.length<=3,'All repair categories share the original allowance');
  if(['identical-refused','missing-output-refused','allowance-refused','fallback-total-two','fallback-default-three'].includes(scenarioName)){assert.equal(outcome.state,'failed',JSON.stringify(outcome));assert.match(outcome.reason,/identical|allowance is exhausted/);assert.equal(await runtime.store.result(invocation.identity.effectId),undefined);}
  else {assert.equal(outcome.state,'succeeded',JSON.stringify(outcome));assert.equal(await readFile(path.join(h.workspace,'result.txt'),'utf8'),'delivered-42\n');}
  assert.equal(Object.keys(programs).length,scenarioName==='program-corrected'||scenarioName==='schema-program-schema'?2:programCount??1);
  const called=await readFile(path.join(h.workspace,'calls'),'utf8');assert.equal(called,scenarioName==='program-corrected'||scenarioName==='schema-program-schema'?'bad\ngood\n':programCount?'bad\n'.repeat(programCount):['identical-refused','missing-output-refused'].includes(scenarioName)?'bad\n':'good\n');
  assert.equal(ids.length,scenarioName==='schema-program-schema'?3:programCount?programCount-1:1);
  if(scenarioName==='program-corrected'||scenarioName==='identical-refused')assert.match(JSON.stringify(plans),/ORIGINAL_PROGRAM_ERROR/,'Feedback carries the original failed Job log');
  const prepared=await runtime.store.effectFact(invocation.identity.effectId,'prepared'),log=await host.ctx.get('sessionQuery').readSession(prepared.sessionId);assert.equal(log.events.filter((event:any)=>event.type==='turn/start').length,ids.length+1,'Same original author, one native turn per feedback');
  if(scenarioName==='max-tokens-corrected')assert.equal(log.events.find((event:any)=>event.type==='turn/end').data.reason.kind,'max-tokens');
 } finally {await host?.dispose();await rm(h.home,{recursive:true,force:true});}
});

test('an autopilot declaration is held at load: a wait inside a segment, an unlabelled UNDETERMINED and a non-fork are refused', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'hima-legacy-declaration-'));
  try {
  const tclsh = await realpath('/usr/bin/tclsh');
  const cases: readonly [string, (graph: Record<string, any>) => void, RegExp][] = [
    ['a segment through a wait node', (graph) => {
      graph.nodes.push({ id: 'hold', kind: 'wait', parameters: { blocker: 'person' } });
      graph.edges = graph.edges.filter((edge: any) => !(edge.from === 'judge' && edge.outcome === 'FAIL'));
      graph.edges.push({ from: 'judge', to: 'hold', outcome: 'FAIL' });
      graph.autopilot.push({ from: ['judge'], until: ['finish'] });
    }, /reaches wait node "hold" without stopping there/],
    ['a segment judge with no UNDETERMINED edge', (graph) => {
      graph.edges = graph.edges.filter((edge: any) => !(edge.from === 'judge' && edge.outcome === 'UNDETERMINED'));
      graph.autopilot.push({ from: ['judge'], until: ['finish'] });
    }, /judge "judge" with no UNDETERMINED edge/],
    ['a fork declaration on a node that draws no fork', (graph) => { graph.autopilot = [{ fork: 'judge' }]; }, /draws no fork/],
    ['a segment reaching into a fork branch', (graph) => { graph.autopilot.push({ from: ['read-plan-a'], until: ['judge'] }); }, /branch node of the fork/],
  ];
  for (const [what, graphEdit, refusal] of cases) {
    const packsDir = path.join(home, `refusal-${cases.findIndex((item) => item[0] === what)}`);
    await writePack(packsDir, tclsh, { ...defaults, graphEdit });
    assert.throws(() => loadPack(packsDir, packId), refusal, what);
  }
  // And the declaration itself is data a person reads in graph.yml.
  const packsDir = path.join(home, 'accepted');
  const dir = await writePack(packsDir, tclsh, defaults);
  assert.deepEqual(parse(await readFile(path.join(dir, 'graph.yml'), 'utf8')).autopilot, [{ fork: 'start', revisions: 1, author: { maxElapsedMs: 30_000, maxFollowups: 3 } }]);
  assert.equal(loadPack(packsDir, packId).graph.autopilot.length, 1);
  } finally { await rm(home, { recursive: true, force: true }); }
});
