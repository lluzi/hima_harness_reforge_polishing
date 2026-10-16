// #109 L2 identity only: real Host/private PG. Native/model/GUI qualification is
// separate; this caller never turns a fixed manifest into a business PASS.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { specHost } from './support/issue107/host.ts';
import { createPresetRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';

const runtime = await import(new URL('../../packages/harness/lib/durable-runtime.js',import.meta.url).href) as typeof import('../../packages/harness/lib/types/durable-runtime.js');
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
test('current Host, frozen Team Run and invocation share the installed executable and dependency cohort', {timeout:90_000}, async t=>{
  const f=await specHost();t.after(()=>f.dispose());
  const task=await f.start('release-current-combination'),durable=f.host.ctx.hima.durable,store=durable.store;
  const run=await store.run(task.currentRunId),invocations=await store.flowInvocations(task.currentRunId);
  assert.equal(invocations.length,1);assert.equal(task.readiness.ready,false,'No real model runs in this identity contract');
  const manifest=await runtime.installedExecutableManifest();
  assert.equal(runtime.executableApplicationVersion(manifest),durable.applicationVersion,'Host must freeze the actual installed bytes');
  assert.equal(store.applicationVersion,durable.applicationVersion);
  assert.equal(run.applicationVersion,durable.applicationVersion);
  assert.equal(run.opening.applicationVersion,durable.applicationVersion);
  const identity=invocations[0]!.identity;
  assert.equal(identity.applicationVersion,durable.applicationVersion);
  assert.ok('source' in identity && identity.source.kind==='team');
  if(!('source' in identity)||identity.source.kind!=='team')throw Error('Expected an actual independent Team invocation');
  assert.equal(identity.source.taskId,task.taskId);assert.deepEqual(identity.source.team,task.team);
  const dependencies:Record<string,{version:string;sha256:string}>={};
  for(const [name,at,expected] of [
    ['dsh','node_modules/@deepseek-ai/dsh/package.json','0.2.0-rc.2'],
    ['dsh-agent','node_modules/@deepseek-ai/dsh-agent/package.json','0.2.0-rc.2'],
    ['dbos-sdk','packages/harness/node_modules/@dbos-inc/dbos-sdk/package.json','5.2.11'],
    ['datasource','packages/harness/node_modules/@dbos-inc/node-pg-datasource/package.json','5.2.11'],
    ['pg','packages/harness/node_modules/pg/package.json','8.16.3'],
  ] as const) {
    const bytes=await readFile(path.join(repoRoot,at));const version=JSON.parse(bytes.toString('utf8')).version;
    assert.equal(version,expected,'Fixed installed dependency '+name);dependencies[name]={version,sha256:sha(bytes)};
  }
  const before=await store.listTeamTasks(task.projectId,task.team.teamId);
  await assert.rejects(store.openTeamTask({projectId:task.projectId,requestId:'release-wrong-version',requestSha256:'0'.repeat(64),task,
    opening:{...run.opening,applicationVersion:'hima-'+'0'.repeat(64)}}),/frozen.*executable identity/i);
  assert.deepEqual(await store.listTeamTasks(task.projectId,task.team.teamId),before,'A mismatched build cannot open an additional task');
  const evidence=process.env.HIMA_109_RELEASE_EVIDENCE;
  if(evidence){
    await mkdir(evidence,{recursive:true});
    await writeFile(path.join(evidence,'host-identity.json'),JSON.stringify({applicationVersion:durable.applicationVersion,
      executableFiles:manifest.files,adapters:manifest.adapters,dependencies,platform:process.platform+'-'+process.arch,node:process.version,
      taskId:task.taskId,runId:run.runId,identity,model:'not-run (unconfigured fixture)',
      scope:'Development Host/PG identity only; no installed App/Linux/native-model/EDA qualification.'},null,2)+'\n');
  }
});

test('same member keeps authorized personal memory after a saved runtime/model change for a new Task', {timeout:90_000},async t=>{
  const f=await specHost();t.after(()=>f.dispose());
  const first=await f.start('release-member-continuity-first'),memberId=f.saved.definition.leaderMemberId;
  const feedback=await f.memory(first,'feedback',{requestId:'continuity-fact',target:{kind:'member',memberId},text:'Retain source links in my handoffs.',reason:'Human continuity fixture'});
  const adopted=await f.memory(first,'adopt',{requestId:'continuity-adopt',memoryId:feedback.record.memoryId,expectedVersion:feedback.record.version,
    expectedRevision:feedback.tip.revision,supersedesEventId:feedback.tip.eventId,action:'adopted',reason:'Explicit fixture adoption'});
  const oldMember=f.saved.definition.members.find((member:any)=>member.id===memberId);
  const changed={...f.saved.definition,members:f.saved.definition.members.map((member:any)=>member.id===memberId?
    {...member,runtime:member.runtime==='pi'?'opencode':'pi',modelRef:'release-unconfigured-next'}:member)};
  const saved=await f.operation({action:'save',teamId:first.team.teamId,definition:changed,expectedVersion:1});
  const next=await f.operation({action:'startTask',teamId:saved.teamId,request:{requestId:'continuity-new-runtime',teamId:saved.teamId,expectedVersion:2,
    goal:'Read previously authorized personal experience in a fresh task.',input:{},deadlineAt:new Date(Date.now()+60_000).toISOString(),closure:'No model configured.'}});
  assert.equal(next.readiness.ready,false);assert.notEqual(next.taskId,first.taskId);assert.equal(next.team.version,2);
  assert.notEqual(saved.definition.members.find((member:any)=>member.id===memberId).runtime,oldMember.runtime);
  const {waitUntil}=await import('./support/fabric.ts');
  await waitUntil('new runtime configuration invocation',async()=>(await f.host.ctx.hima.durable.store.flowInvocations(next.currentRunId)).length===1,10_000,25);
  const member=await f.member(next,'continuity-next-member');
  assert.equal(member.issued.grant.memberId,memberId);
  const status=await member.call({action:'memory-status',request:{page:{limit:10}}});
  const retained=status.records.find((view:any)=>view.record.memoryId===feedback.record.memoryId);
  assert.equal(retained.tip.eventId,adopted.tip.eventId);assert.equal(retained.tip.state,'adopted');
  assert.equal(retained.record.scope.memberId,memberId);assert.equal(retained.record.sourceTaskId,first.taskId);
  assert.equal(retained.record.text,feedback.record.text);
});

// Cheap preflight of the exact normal metadata path needed before the admitted L4 Home.
test('normal native workspace and Guide creation preserve an explicit Desktop session title without a model turn', {timeout:90_000},async t=>{
  const f=await specHost();t.after(()=>f.dispose());
  const workspace=f.host.ctx.get('workspaceController' as never) as {create(request:{path:string}):Promise<unknown>}|undefined;
  assert.ok(workspace);await workspace.create({path:f.home.workspace});
  const guide=await createPresetRootAgent(f.host.ctx,f.home.workspace,'hima-moment');
  const sessions=f.host.ctx.get('sessionController' as never) as {rename(request:{sessionId:string;title:string}):Promise<{title:string}>}|undefined;
  assert.ok(sessions);
  const title='Issue 109 functional composition';
  assert.equal((await sessions.rename({sessionId:String(guide.id),title})).title,title);
  assert.notEqual(String(guide.id),f.sessionId);
});

import { appendFile as residualAppendFile, readdir as residualReadDirectory } from 'node:fs/promises';
import { commandTaskAdapter as residualCommandAdapter, teamDefinition as residualTeamDefinition } from '@hima/harness';
import { bootInProcess as residualBoot, createRootAgent as residualRoot, sayAsUser as residualSay,
  saidByModel as residualModelText } from './support/boot-inprocess.ts';
import { createHimaHome as residualHome } from './support/dsh-home.ts';
import { writeLocalSite as residualSite } from './support/site.ts';
import { writeMomentFixture as residualReplay } from './support/moments.ts';
import { QUIET_TITLE_ROW as residualQuietTitle } from './support/pipeline.ts';
import { waitUntil as residualWait } from './support/fabric.ts';
import { TeamMessageScriptTransport as ResidualScriptTransport } from './support/team-message-script.ts';
import { writeReplayOverlay as residualReplayOverlay } from '../../packages/desktop/src/hima-home.ts';

// One coherent failure-isolation/independent-conversation scene. Team execution
// and message endpoints are real managed command/script processes, not SDKs.
test('missing optional Team service and busy Team preserve real Guide replies; ordinary result/activity updates never broadcast', {timeout:120_000}, async t=>{
  const home=await residualHome();
  const previous={runtime:process.env.HIMA_TEAM_RUNTIME,silent:process.env.HIMA_TEST_SILENT_AGENT,drive:process.env.HIMA_TEST_LEGACY_AUTO_DRIVE};
  let host:Awaited<ReturnType<typeof residualBoot>>|undefined,task:any,guideId='',closed=false;
  const jobs=new Map<string,{directory:string;busy:string;release:string}>();
  const calls:Array<{memberId:string;messageId:string}>=[];
  try {
    // Explicitly absent optional assets; do not touch shared installed runtime bytes.
    delete process.env.HIMA_TEAM_RUNTIME;delete home.env.HIMA_TEAM_RUNTIME;
    process.env.HIMA_TEST_SILENT_AGENT=home.env.HIMA_TEST_SILENT_AGENT='0';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE=home.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
    await residualSite(home,{parallelJobs:1,allowedReadRoots:[home.workspace],allowedWriteRoots:[home.workspace],allowedWrappers:['/bin/sh']});
    const replay=await residualReplay(home,'one-turn');
    const replyTexts=['RESIDUAL_SERVICE_REPLY_13','RESIDUAL_BUSY_REPLY_17'];
    await writeFile(replay.override,JSON.stringify(replyTexts.map(text=>({kind:'chunks',chunks:[
      {type:'block-start',index:0,blockType:'text'},
      {type:'block-end',index:0,block:{type:'text',text}},
      {type:'finish',reason:{kind:'stop'}}]}))));
    await residualReplayOverlay(home.home,{file:replay.file,overrideFile:replay.override});
    await residualAppendFile(path.join(home.profileDir,'cordis.patch.yml'),residualQuietTitle);
    host=await residualBoot(home);const service=host.ctx.hima,store=service.durable.store;
    await service.reconciled;
    const guide=await residualRoot(host.ctx,home.workspace);guideId=String(guide.id);
    const op=(request:unknown)=>service.teamOperation(guideId,request,'human') as Promise<any>;
    const failed=await service.teamRuntimeOperation({action:'start',serviceId:'hindsight'}) as any;
    assert.equal(failed.receipt.state,'unavailable');assert.equal(failed.receipt.diagnostic.code,'missing-assets');
    assert.equal(failed.receipt.owned.quiescent,true);
    // A real user turn passes through the original Guide and actual replay provider;
    // neither the expected reply nor a synthetic assistant message is injected into its history.
    await residualSay(guide,'What is six plus seven?');
    assert.deepEqual(residualModelText(guide),[replyTexts[0]],'Guide must actually answer after optional service failure');
    const sourceDefinition=residualTeamDefinition.parse({schema:'hima-team-definition/1',title:'Bounded residual isolation',
      members:['lead','peer'].map(id=>({id,role:id,runtime:'opencode',modelRef:'controlled-command-only',skills:[],instructions:'Wait for the test-owned release file and return measured command output.',toolRefs:[],knowledgeRefs:[]})),
      leaderMemberId:'lead',collaboration:'Retain the same owner while independent work proceeds.',
      delivery:{description:'Controlled process output',output:{version:'residual-answer/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}}}});
    const saved=await op({action:'save',definition:sourceDefinition,expectedVersion:null});
    // Existing external-effect adapter substitutes only the expensive native/model
    // endpoint. Actual Site/Job/admission/result/closure/DBOS are unchanged.
    service.teamExecutor={readiness:async()=>({ready:true,missing:[]}),resolve:async context=>{
      const memberId=context.task.memberId;
      assert.equal(memberId,'lead','No ordinary activity or Guide question may dispatch the inactive peer');
      const directory=path.join(home.workspace,'residual-'+sha(context.request.identity.effectId).slice(0,16));
      await mkdir(directory,{recursive:true});
      const busy=path.join(directory,'busy'),release=path.join(directory,'release'),script=path.join(directory,'work.sh');
      jobs.set(memberId,{directory,busy,release});
      await writeFile(script,'printf "%s\\n" "$$" > busy\nwhile [ ! -f release ]; do sleep 0.05; done\nprintf \'{"answer":"measured-command-output"}\' > answer.json\n');
      return residualCommandAdapter({sitesDir:path.join(home.home,'hima/sites'),siteId:'local',workspace:directory,name:'controlled-'+memberId,
        argv:['/bin/sh',script],collect:async(_site,_job,request)=>({schemaVersion:request.contract.output.version,
          value:JSON.parse(await readFile(path.join(directory,'answer.json'),'utf8')),artifacts:[],diagnostics:[]})});
    }};
    const receiveDirectory=path.join(home.workspace,'actual-message-receipts');await mkdir(receiveDirectory);
    const transport=new ResidualScriptTransport(receiveDirectory);
    service.teamTransport={deliver:async(message,delivery)=>{
      calls.push({memberId:delivery.recipientMemberId,messageId:message.messageId});return transport.deliver(message,delivery);
    },observeDelivery:delivery=>transport.observeDelivery(delivery)};
    const opening={action:'startTask',teamId:saved.teamId,request:{requestId:'residual-busy-team',teamId:saved.teamId,expectedVersion:1,
      goal:'Keep the original leader busy while Guide answers an unrelated question.',input:{},
      deadlineAt:new Date(Date.now()+90_000).toISOString(),closure:'The actual local command closes; no provider/network model.'}};
    // Invoke Guide's actual public tool, so this is Guide-origin Team opening;
    // do not replace this with the human op helper and call that Guide delegation.
    const openedByGuide=await host.ctx.tools.execute({agent:guide,name:'hima_team',arguments:{request:opening},
      callId:'residual-guide-start-team' as never,signal:AbortSignal.timeout(15_000)});
    assert.notEqual(openedByGuide.isError,true,JSON.stringify(openedByGuide.content));
    const answer=openedByGuide.content.filter((block:any)=>block.type==='text').map((block:any)=>block.text).join('\n');
    task=JSON.parse(answer);
    assert.ok(task.taskId&&task.currentRunId,'Actual public tool must return its opened task identity');
    const actualOpening=(await store.run(task.currentRunId)).opening.data as unknown as {actor:{kind:string;actorId:string}};
    assert.equal(actualOpening.actor.kind,'guide');assert.equal(actualOpening.actor.actorId,guideId);
    const ref={teamId:saved.teamId,taskId:task.taskId};
    const read=()=>op({action:'readTask',...ref});
    const busy=async(memberId:string)=>{
      const job=jobs.get(memberId);if(!job)return false;
      try{const pid=Number((await readFile(job.busy,'utf8')).trim());assert.ok(Number.isSafeInteger(pid)&&pid>1);process.kill(pid,0);return true;}catch{return false;}
    };
    await residualWait('actual leader command busy',()=>busy('lead'),15_000,25);
    const leader=(await store.flowInvocations(task.currentRunId)).find(row=>{
      const context=row.context as any;return context.flow.tasks[context.taskId]?.memberId==='lead';
    });assert.ok(leader);
    const original=await store.run(task.currentRunId);
    assert.equal(original.owner,'member:lead');assert.notEqual(original.owner,guideId,'Guide remains independent from Team execution owner');
    const invocations=await store.flowInvocations(task.currentRunId);assert.equal(invocations.length,1);
    const beforeReplies=residualModelText(guide).length;
    await residualSay(guide,'What is eight plus nine?');
    assert.deepEqual(residualModelText(guide).slice(beforeReplies),[replyTexts[1]],'Same Guide must answer a second question while original Team command remains busy');
    assert.equal(await busy('lead'),true);
    assert.equal((await store.run(task.currentRunId)).owner,original.owner);
    assert.equal((await read()).currentRunId,task.currentRunId);
    assert.equal(calls.length,0);assert.deepEqual(await residualReadDirectory(receiveDirectory),[]);
    const activityBefore=await op({action:'read-activity',...ref,request:{page:{limit:100}}});
    assert.ok(activityBefore.records.some((row:any)=>row.kind==='work'),'Actual running work must be visible without sending it to peers');
    const messagesBefore=await op({action:'read-messages',...ref,request:{page:{limit:100}}});
    assert.equal(messagesBefore.messages.length,0);
    assert.equal(calls.length,0,'ordinary work projection and Guide replies must request no member receive');
    const asked=await op({action:'ask',...ref,request:{requestId:'residual-only-lead-question',recipientMemberIds:['lead'],text:'Please observe this one directed question.'}});
    assert.deepEqual(asked.message.recipientMemberIds,['lead']);assert.equal(asked.deliveries.length,1);
    assert.equal(asked.deliveries[0].state,'accepted');assert.equal(asked.deliveries[0].received.target.memberId,'lead');
    assert.deepEqual(calls,[{memberId:'lead',messageId:asked.message.messageId}]);
    const receivedFiles=await residualReadDirectory(receiveDirectory);assert.equal(receivedFiles.length,1);
    const actual=JSON.parse(await readFile(path.join(receiveDirectory,receivedFiles[0]!), 'utf8'));
    assert.equal(actual.input.source.messageId,asked.message.messageId);assert.equal(actual.receipt.received.target.effectId,leader.identity.effectId);
    assert.equal((await store.run(task.currentRunId)).owner,original.owner);assert.equal(await busy('lead'),true);
    await writeFile(jobs.get('lead')!.release,'actual leader release');
    await residualWait('normal Team result and physical closure',async()=>{const current=await read();return current.execution.state==='succeeded'&&current.execution.resourceState==='closed';},20_000,25);
    const activity=await op({action:'read-activity',...ref,request:{page:{limit:100}}});
    assert.ok(activity.records.some((row:any)=>row.kind==='result'&&row.effectId===leader.identity.effectId),'Actual persisted command result appears as ordinary activity');
    const messagesAfter=await op({action:'read-messages',...ref,request:{page:{limit:100}}});
    assert.equal(messagesAfter.messages.length,1);assert.equal(messagesAfter.messages[0].messageId,asked.message.messageId);
    assert.equal(calls.length,1,'final ordinary result and closure must not broadcast additional receive');
    assert.equal((await store.flowInvocations(task.currentRunId)).length,invocations.length,'Guide questions/record reads cannot add Team work');
    const evidence=process.env.HIMA_109_RELEASE_EVIDENCE;
    if(evidence){await mkdir(evidence,{recursive:true});await writeFile(path.join(evidence,'residual-isolation.json'),JSON.stringify({
      scope:'L2 real Host/PG/DBOS + actual controlled command/script processes + replay Guide; zero product-provider calls, no SDK/GUI claim',
      applicationVersion:store.applicationVersion,serviceFailure:failed.receipt,guideId,replies:residualModelText(guide),taskId:task.taskId,
      runId:task.currentRunId,owner:original.owner,leaderEffectId:leader.identity.effectId,inactivePeerDispatched:jobs.has('peer'),
      activity,calls,actualReceipt:actual,terminal:await read()},null,2));}
  } finally {
    try {
      if(host&&task){const service=host.ctx.hima;let current=await service.teamOperation(guideId,{action:'readTask',teamId:task.team.teamId,taskId:task.taskId},'human') as any;
        if(current.execution.resourceState!=='closed'){
          await service.teamOperation(guideId,{action:'control',teamId:task.team.teamId,taskId:task.taskId,request:{requestId:'residual-cleanup',action:'cancel',expectedEpoch:current.execution.epoch,expectedRevision:current.execution.revision}},'human');
          await residualWait('test-owned Team cancellation closes original commands',async()=>{current=await service.teamOperation(guideId,{action:'readTask',teamId:task.team.teamId,taskId:task.taskId},'human');return current.execution.resourceState==='closed';},20_000,25);
        }
      }
    } finally {
      try{if(host){const service=host.ctx.hima as unknown as {resourcesClosing?:Promise<void>};await host.dispose();assert.ok(service.resourcesClosing);await service.resourcesClosing;}closed=true;}
      finally{
        for(const [name,value] of [['HIMA_TEAM_RUNTIME',previous.runtime],['HIMA_TEST_SILENT_AGENT',previous.silent],['HIMA_TEST_LEGACY_AUTO_DRIVE',previous.drive]] as const)
          if(value===undefined)delete process.env[name];else process.env[name]=value;
        if(closed)await home.dispose();else t.diagnostic('Unconfirmed closure: retain test Home '+home.home);
      }
    }
  }
});
