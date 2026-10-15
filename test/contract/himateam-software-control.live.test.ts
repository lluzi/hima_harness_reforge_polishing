// #106 L4: a human supplement and explicit pause/resume preserve one PR identity.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { type TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT='1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
const command=promisify(execFile);
const binding={repository:'lluzi/himateam_test',issueNumber:1,issueUrl:'https://github.com/lluzi/himateam_test/issues/1',
  baseCommit:'d6fccb90243bc93240e8057f345665b9d5e0ec68',taskBranch:'codex/issue-1-himateam'};
const head='3ce544bc10186a69a7c8e2d6077988fc46a4c899';
const supplement='Keep the existing PR open; preserve the CRLF regression test and do not merge or release.';
const output={version:'software-control/1',schema:{$schema:'https://json-schema.org/draft/2020-12/schema',
  type:'object',properties:{pullRequestUrl:{type:'string'},headCommit:{type:'string'},supplement:{type:'string'}},
  required:['pullRequestUrl','headCommit','supplement'],additionalProperties:false}};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(probe:()=>Promise<boolean>,ms:number):Promise<void>{const until=Date.now()+ms;
  for(;;){if(await probe())return;if(Date.now()>=until)throw Error('software control task did not reach terminal state');await pause(500);}}

test('human supplement and explicit pause/resume close old native work and reuse one PR',{
  timeout:360_000,skip:!process.env.DEEPSEEK_API_KEY?'Requires authorized shared DeepSeek credential':false,
},async()=>{
  const home=await createHimaHome({desktopShaped:true});
  Object.assign(home.env,{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic',
    DEEPSEEK_MODEL:process.env.DEEPSEEK_MODEL??'deepseek-flash',
    DEEPSEEK_API:process.env.DEEPSEEK_API??'anthropic-messages'});
  const evidence=path.join(process.env.HIMA_TEAM_EVIDENCE??path.resolve('.scratch/himateam-issue97/issue106-live'),
    'human-control-'+new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(evidence,{recursive:true});
  const host=await bootInProcess(home),service=host.ctx.hima,store=service.durable.store;
  let sessionId='',task:{teamId:string;taskId:string;currentRunId:string}|undefined,success=false,closed=false,originalFailure:unknown;
  try{
    await service.reconciled;
    sessionId=String((await createRootAgent(host.ctx,home.workspace)).id);
    const deadlineAt=new Date(Date.now()+300_000).toISOString();
    const instructions=`Verify the frozen Issue's existing reviewed PR after a human interruption. Call member_context read-messages {"page":{"limit":10}} and copy the actual human message text. Then call member_context GitHub checkout with request {"action":"checkout"}; confirm HEAD ${head}. Call member_context GitHub open-pr with testsCommit and reviewCommit ${head}, tests "2 pass, 0 fail, 0 skip", review "PASS: independent exact-head review and CRLF regression test already retained", remaining "none". Host must reuse the PR. Do not merge, release, tag, delete or push. Return only raw JSON, without a code fence: {"schemaVersion":"software-control/1","value":{"pullRequestUrl":"HOST_PR_URL","headCommit":"${head}","supplement":"ACTUAL_HUMAN_MESSAGE_TEXT"},"artifacts":[],"diagnostics":[]}.`;
    const definition:TeamDefinition={...teamFixture,title:'Human-controlled existing PR reuse',leaderMemberId:'lead',
      members:[{...teamFixture.members[0]!,id:'lead',runtime:'pi',modelRef:'default',role:'PR reuse lead',skills:[],
        toolRefs:['hima-member-context','hima-github-pr'],instructions}],
      delivery:{description:'Existing exact-head PR after human control',output}};
    const team=await service.teamOperation(sessionId,{action:'save',definition,expectedVersion:null},'human') as {teamId:string;version:number};
    const opened=await service.teamOperation(sessionId,{action:'startTask',teamId:team.teamId,request:{
      requestId:'issue1-human-control',teamId:team.teamId,expectedVersion:team.version,
      goal:'Wait for the human supplement and continue signal; then reuse the existing PR. '+instructions,
      input:binding,deadlineAt,closure:'One existing PR; no merge or release.'}},'human') as {
        taskId:string;currentRunId:string;readiness:{ready:boolean;missing:string[]}};
    task={teamId:team.teamId,taskId:opened.taskId,currentRunId:opened.currentRunId};
    assert.equal(opened.readiness.ready,true,JSON.stringify(opened.readiness));
    let nativeEffectId='';
    await waitUntil(async()=>{const invocations=await store.flowInvocations(opened.currentRunId);
      const first=invocations[0];if(!first)return false;
      const births=await store.listExternalEffectFacts(first.identity,'oar:local-birth:');
      if(!Object.keys(births).length)return false;nativeEffectId=first.identity.effectId;return true;},30_000);
    const initial=await store.run(opened.currentRunId);
    await service.teamOperation(sessionId,{action:'control',teamId:team.teamId,taskId:opened.taskId,request:{
      requestId:'issue1-pause-for-human',action:'pause',expectedEpoch:initial.epoch,expectedRevision:initial.revision}},'human');
    const paused=await store.run(opened.currentRunId);
    assert.equal(paused.epoch,initial.epoch+1,'pause must advance the original Run authority');
    assert.ok(paused.hold,'pause must retain an actual hold');
    await assert.rejects(service.teamOperation(sessionId,{action:'control',teamId:team.teamId,taskId:opened.taskId,request:{
      requestId:'issue1-invalid-same-run-continue',action:'continue',expectedEpoch:paused.epoch,
      expectedRevision:paused.revision}},'human'),/explicit resume/);
    const sent=await service.teamOperation(sessionId,{action:'send-message',teamId:team.teamId,taskId:opened.taskId,request:{
      requestId:'issue1-human-supplement',recipientMemberIds:['lead'],text:supplement,stagedAttachmentIds:[]}},'human') as {
        message:{messageId:string;sender:{kind:string}}};
    assert.equal(sent.message.sender.kind,'human');
    const resumedView=await service.teamOperation(sessionId,{action:'control',teamId:team.teamId,taskId:opened.taskId,request:{
      requestId:'issue1-resume-after-human',action:'resume',expectedRunId:opened.currentRunId,
      expectedEpoch:paused.epoch,expectedRevision:paused.revision}},'human') as {
        taskId:string;currentRunId:string;runIds:string[];input:unknown;deadlineAt:string};
    assert.equal(resumedView.taskId,opened.taskId);
    assert.notEqual(resumedView.currentRunId,opened.currentRunId,'closed native work needs a new Run');
    assert.deepEqual(resumedView.runIds,[opened.currentRunId,resumedView.currentRunId]);
    assert.deepEqual(resumedView.input,binding);
    assert.equal(resumedView.deadlineAt,deadlineAt);
    const resumed=await store.run(resumedView.currentRunId);
    assert.equal(resumed.epoch,0);assert.equal(resumed.hold,null);
    assert.equal(resumed.deadlineAt,initial.deadlineAt,'human recovery preserves the original deadline');
    assert.ok(await store.flowFact(initial.runId,`stopped:${nativeEffectId}`),'explicit resume closes the old effect');
    const oldResources=await store.effectResources(nativeEffectId);
    assert.ok(oldResources.length>0&&oldResources.every(resource=>resource.released),'old physical leases must be released');
    await writeFile(path.join(evidence,'control.json'),JSON.stringify({task,supplementMessageId:sent.message.messageId,
      nativeEffectId,originalEpoch:initial.epoch,pausedEpoch:paused.epoch,resumedRunId:resumed.runId,deadlineAt}));
    let view:any;
    await waitUntil(async()=>{view=await service.teamOperation(sessionId,{action:'readTask',teamId:team.teamId,taskId:opened.taskId});
      return ['succeeded','failed','cancelled'].includes(view.execution?.state);},Math.max(1,Date.parse(deadlineAt)-Date.now()));
    assert.equal(view.execution.state,'succeeded',JSON.stringify({state:view.execution.state,reason:view.execution.reason}));
    assert.equal(view.execution.resourceState,'closed');
    const result=view.execution.tasks.find((row:any)=>row.result?.outputSchemaVersion==='software-control/1')?.result;
    assert.ok(result,'checked controlled delivery required');
    assert.equal(result.value.headCommit,head);assert.equal(result.value.supplement,supplement);
    assert.equal(result.value.pullRequestUrl,'https://github.com/lluzi/himateam_test/pull/2');
    assert.equal(view.taskId,opened.taskId);assert.deepEqual(view.input,binding);
    const invocations=(await Promise.all(view.runIds.map((runId:string)=>store.flowInvocations(runId)))).flat();
    const actualReplies=[] as any[];
    for(const invocation of invocations)actualReplies.push(...Object.values(await store.listExternalEffectFacts(invocation.identity,'oar:tool-reply:')));
    const readReceipt=actualReplies.find(reply=>reply.ok===true&&reply.value?.messages?.some((message:any)=>
      message.messageId===sent.message.messageId&&message.text===supplement));
    assert.ok(readReceipt,'the native member must actually read the human supplement');
    const reuseReceipt=actualReplies.find(reply=>reply.ok===true&&reply.value?.state==='existing'&&
      reply.value?.url==='https://github.com/lluzi/himateam_test/pull/2'&&reply.value?.headCommit===head);
    assert.ok(reuseReceipt,'Host must report exact existing PR reuse to this member');
    const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
    const prs=JSON.parse((await command('gh',['pr','list','--repo',binding.repository,'--state','all','--json',
      'number,state,url,headRefOid'],{encoding:'utf8',timeout:15000,env})).stdout) as Array<{number:number;state:string;url:string;headRefOid:string}>;
    assert.deepEqual(prs.map(pr=>pr.number),[2],'interrupted/restarted delivery created no second PR');
    assert.equal(prs[0]!.headRefOid,head);assert.equal(prs[0]!.state,'OPEN');
    await writeFile(path.join(evidence,'delivery.json'),JSON.stringify({task,supplementMessageId:sent.message.messageId,
      nativeEffectId,originalEpoch:initial.epoch,pausedEpoch:paused.epoch,resumedRunId:resumed.runId,
      readReceipt:true,reuseReceipt:true,result:result.value,pr:prs[0],resourceState:view.execution.resourceState},null,2));
    success=true;
  }catch(error){
    originalFailure=error;
    try{const view=task&&sessionId?await service.teamOperation(sessionId,{action:'readTask',teamId:task.teamId,taskId:task.taskId}) as any:undefined;
      const runs=view?.runIds??[];const invocations=(await Promise.all(runs.map((runId:string)=>store.flowInvocations(runId)))).flat();
      await writeFile(path.join(evidence,'failure-boundary.json'),JSON.stringify({error:error instanceof Error?error.message:String(error),
        task,state:view?.execution?.state,reason:view?.execution?.reason,resourceState:view?.execution?.resourceState,
        effectIds:invocations.map(row=>row.identity.effectId)},null,2),{mode:0o600});}
    catch{}
    throw error;
  }finally{
    let cleanupError:unknown;
    try{if(task&&!success&&sessionId){const view=await service.teamOperation(sessionId,{action:'readTask',teamId:task.teamId,taskId:task.taskId}) as any;
      if(view.execution?.resourceState!=='closed')await service.teamOperation(sessionId,{action:'control',teamId:task.teamId,taskId:task.taskId,request:{
        requestId:'cleanup-issue1-human-control',action:'cancel',expectedRunId:view.currentRunId,
        expectedEpoch:view.execution.epoch,expectedRevision:view.execution.revision}},'human');}}
    catch(error){cleanupError=error;}
    try{await host.dispose();const closer=(service as unknown as {resourcesClosing?:Promise<void>}).resourcesClosing;
      if(!closer)throw Error('Host original resource closer unavailable');await closer;closed=true;}
    catch(error){cleanupError??=error;}
    if(success&&closed)await home.dispose();
    if(cleanupError){await writeFile(path.join(evidence,'cleanup-unconfirmed.json'),JSON.stringify({message:String(cleanupError)}));
      if(!originalFailure)throw cleanupError;}
  }
});
