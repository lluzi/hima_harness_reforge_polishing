// #109 opt-in L4: reuse the retained exact-head fix through normal Host ownership,
// real independent native review, native scoped memory adoption, and Host PR delivery.
// Copy to test/contract; run only after integrator admission and registration.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import path from 'node:path';
import { himaSkillsDir, memberGitEnvironment, teamDefinition, type TeamDefinition } from '@hima/harness';
import { bootInProcess, createPresetRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { requireYieldedNativeTurn } from './support/himateam-business-evidence.ts';

process.env.HIMA_TEST_SILENT_AGENT='1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
const command=promisify(execFile);
const githubEnvironment={...process.env};
for(const name of Object.keys(githubEnvironment))if(name.startsWith('GIT_'))delete githubEnvironment[name];
delete githubEnvironment.NODE_OPTIONS;
delete githubEnvironment.NODE_TEST_CONTEXT;
const testEnvironment={...memberGitEnvironment,PATH:'/Users/lluzi/.local/node24/bin:/usr/bin:/bin',NODE_OPTIONS:''};
const expectedHead='3ce544bc10186a69a7c8e2d6077988fc46a4c899';
const feedbackText='For this bounded GitHub delivery, test the exact retained commit in each private worktree, preserve independent review, and pass the same checked SHA to Host PR delivery. Memory remains advice and cannot alter permissions or acceptance.';
const sha=(text:string|Uint8Array)=>createHash('sha256').update(text).digest('hex');
const binding={repository:'lluzi/himateam_test',issueNumber:1,issueUrl:'https://github.com/lluzi/himateam_test/issues/1',
  baseCommit:'d6fccb90243bc93240e8057f345665b9d5e0ec68',taskBranch:'codex/issue-1-himateam'};
const schema='https://json-schema.org/draft/2020-12/schema';
const buildOutput={version:'software-build/1',schema:{$schema:schema,type:'object',properties:{headCommit:{type:'string',pattern:'^[a-f0-9]{40}$'},tests:{type:'string'}},required:['headCommit','tests'],additionalProperties:false}};
const reviewOutput={version:'software-review/1',schema:{$schema:schema,type:'object',properties:{headCommit:{type:'string',pattern:'^[a-f0-9]{40}$'},tests:{type:'string'},review:{type:'string'}},required:['headCommit','tests','review'],additionalProperties:false}};
const pause=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const waitUntil=async(what:string,probe:()=>boolean|Promise<boolean>,ms:number):Promise<void>=>{
  const until=Date.now()+ms;
  for(;;){if(await probe())return;if(Date.now()>=until)throw Error(`${what} did not occur within ${ms} ms`);await pause(500);}
};
const concise=(error:unknown)=>error instanceof Error?{name:error.name,message:error.message.slice(0,1200)}:{name:'Unknown',message:String(error).slice(0,1200)};

// A live caller must observe this current Host operation, not only an old PR URL.
function requireCurrentPrReceipt(request:any,reply:any,delivery:{pullRequestUrl:string;headCommit:string}):void {
  assert.equal(request.action,'github');assert.equal(request.request?.action,'open-pr');
  assert.equal(request.request.testsCommit,delivery.headCommit);assert.equal(request.request.reviewCommit,delivery.headCommit);
  assert.equal(reply?.ok,true);assert.equal(reply.value?.state,'existing');
  assert.equal(reply.value.url,delivery.pullRequestUrl);assert.equal(reply.value.headCommit,delivery.headCommit);
}
test('yielded native evidence refuses another effect, lease, session, input, stream or generation',async()=>{
  const {identity,lease,native,intent,accepted,closed,inputId}=JSON.parse(await readFile(new URL('../fixtures/himateam-yield-binding.json',import.meta.url),'utf8'));
  const row=(seq:number,kind:string,payload:any)=>({schema:'hima-oar-observation/1',seq,kind,sessionKey:lease.sessionKey,generation:lease.generation,memberId:lease.memberId,nativeSession:native.nativeSession,streamGeneration:native.streamGeneration,payload});
  // Real journals may start with stdout/stderr before the first credited OAR record.
  const rows=[row(0,'raw',{channel:'stderr',text:'startup diagnostic'}),{...row(1,'raw',{seq:0}),nativeRawSeq:0},row(2,'received',{inputId}),row(3,'control',{action:'yield_intent',requestId:intent.requestId,inputId}),row(4,'terminal',{inputId,received:true,outcome:{kind:'completed'},yieldRequestId:intent.requestId}),row(5,'control',{action:'raw_final',state:'complete',lastSeq:0})];
  assert.doesNotThrow(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,inputId,rows));
  for(const key of ['sessionKey','generation','memberId','streamGeneration','nativeSession'] as const){const wrong=structuredClone(rows);Object.assign(wrong[4]!,{[key]:key==='generation'?lease.generation+1:'another'});assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,inputId,wrong),key);}
  assert.throws(()=>requireYieldedNativeTurn({...identity,effectId:'other-effect'},lease,native,intent,accepted,closed,inputId,rows));
  assert.throws(()=>requireYieldedNativeTurn(identity,{...lease,controlDirectory:'/other/control'},native,intent,accepted,closed,inputId,rows));
  assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,'other-input',rows));
  assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,{ok:true,value:{state:'yield-accepted',waitId:'other-wait'}},closed,inputId,rows));
  assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,{...closed,absent:false},inputId,rows));
  const incomplete=structuredClone(rows);incomplete[5]!.payload.state='unconfirmed';assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,inputId,incomplete));
  const gap=structuredClone(rows);Object.assign(gap[1]!,{nativeRawSeq:2});assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,inputId,gap));
  const duplicate=structuredClone(rows);duplicate.push({...duplicate[5]!,seq:6});assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,inputId,duplicate),'duplicate raw_final is invalid');
  const late=structuredClone(rows);const [credited]=late.splice(1,1);late.push(credited!);late.forEach((entry,index)=>entry.seq=index);assert.throws(()=>requireYieldedNativeTurn(identity,lease,native,intent,accepted,closed,inputId,late),'credited raw cannot follow raw_final');
});
test('Host PR delivery evidence rejects historical status and mismatched current requests',()=>{
  const delivery={pullRequestUrl:'https://github.com/lluzi/himateam_test/pull/2',headCommit:expectedHead};
  const request={action:'github',request:{action:'open-pr',testsCommit:expectedHead,reviewCommit:expectedHead}};
  const reply={ok:true,value:{state:'existing',url:delivery.pullRequestUrl,headCommit:expectedHead}};
  assert.doesNotThrow(()=>requireCurrentPrReceipt(request,reply,delivery));
  assert.throws(()=>requireCurrentPrReceipt(request,{ok:true,value:{pullRequest:reply.value,remoteHead:expectedHead}},delivery));
  assert.throws(()=>requireCurrentPrReceipt({action:'github',request:{action:'status'}},reply,delivery));
  assert.throws(()=>requireCurrentPrReceipt(request,{...reply,value:{...reply.value,headCommit:'0'.repeat(40)}},delivery));
});

test('current mixed native Team delivers the retained GitHub fix and adopts scoped source-backed methods',{
  timeout:570_000,skip:process.env.HIMA_109_BUSINESS_ADMIT==='1'?false:'Requires exact current-candidate business admission and watched serial native window',
},async()=>{
  const configPath=process.env.HIMA_109_BUSINESS_CONFIG;
  assert.ok(configPath&&path.isAbsolute(configPath),'Admitted run requires a private absolute admission file');
  const admission=JSON.parse(await readFile(configPath,'utf8'));
  for(const field of ['sourceCommit','applicationVersion','candidateManifest','programVersions','originalEvidence','inputOracle','limits','hostSnapshot','cleanup','proofRoot'])
    assert.ok(admission[field],`Missing admission ${field}`);
  assert.ok(Date.parse(admission.expiresAt)>Date.now()+60_000,'Expired/insufficient admission window');
  assert.ok(process.env.DEEPSEEK_API_KEY,'Admitted credential must resolve through existing environment');
  assert.equal(process.env.DEEPSEEK_MODEL??'deepseek-flash','deepseek-flash','Keep the fixed product model');
  assert.match(admission.sourceCommit,/^[a-f0-9]{40}$/);assert.match(admission.applicationVersion,/^hima-[a-f0-9]{64}$/);
  assert.equal((await command('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8',env:memberGitEnvironment})).stdout.trim(),admission.sourceCommit);
  assert.ok(path.isAbsolute(admission.proofRoot));
  for(const field of ['wallMs','treeMiB','cpu','pids'])assert.ok(admission.limits[field],`Missing resource ${field}`);
  for(const field of ['ramMiB','diskMiB','swapMiB'])assert.notEqual(admission.hostSnapshot[field],undefined,`Missing snapshot ${field}`);
  assert.ok(admission.limits.wallMs<=500_000&&admission.limits.wallMs>60_000);
  assert.ok(Date.parse(admission.expiresAt)>Date.now()+admission.limits.wallMs+20_000,'Admission must cover task and cleanup');
  // Only reads before Host/native admission. Owner binding is checked by normal Host checkout later.
  const gh=async(args:string[])=>JSON.parse((await command('gh',args,{encoding:'utf8',timeout:15000,env:githubEnvironment})).stdout);
  const issue=await gh(['api',`repos/${binding.repository}/issues/${binding.issueNumber}`]);
  const beforePr=await gh(['pr','view','2','--repo',binding.repository,'--json','url,state,isDraft,headRefOid,headRefName,baseRefName']);
  assert.equal(issue.state,'open');assert.equal(issue.html_url,binding.issueUrl);
  assert.equal(beforePr.state,'OPEN');assert.equal(beforePr.headRefOid,expectedHead);
  assert.equal(beforePr.headRefName,binding.taskBranch);assert.equal(beforePr.baseRefName,'main');
  const startedAt=Date.now(),home=await createHimaHome({desktopShaped:true});
  Object.assign(home.env,{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic',
    DEEPSEEK_MODEL:process.env.DEEPSEEK_MODEL??'deepseek-flash',DEEPSEEK_API:process.env.DEEPSEEK_API??'anthropic-messages'});
  const evidence=path.join(admission.proofRoot,'business-'+new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(evidence,{recursive:true});
  await writeFile(path.join(evidence,'home.json'),JSON.stringify({home:home.home,workspace:home.workspace})+'\n',{mode:0o600});
  const host=await bootInProcess(home,{withWebApp:true}),service=host.ctx.hima,store=service.durable.store;
  let sessionId='',task:{teamId:string;taskId:string;currentRunId:string}|undefined,complete=false,closed=false,originalFailure:unknown;
  try {
    await service.reconciled;
    assert.equal(store.applicationVersion,admission.applicationVersion,'Built candidate must equal admitted identity');
    await writeFile(path.join(evidence,'admission.json'),JSON.stringify({admission,issue:{url:issue.html_url,title:issue.title,bodySha256:sha(issue.body??'')},beforePr,home:home.home,workspace:home.workspace},null,2),{mode:0o600});
    const workspaceController=host.ctx.get('workspaceController' as never) as {create(request:{path:string}):Promise<unknown>}|undefined;
    assert.ok(workspaceController,'Native workspace controller is required for the retained Desktop Home');
    await workspaceController.create({path:home.workspace});
    const guide=await createPresetRootAgent(host.ctx,home.workspace,'hima-moment');sessionId=String(guide.id);
    const guideLabel='Issue 109 functional composition';
    const sessionController=host.ctx.get('sessionController' as never) as {rename(request:{sessionId:string;title:string}):Promise<{title:string}>}|undefined;
    assert.ok(sessionController,'Native session controller is required for the retained Desktop Home');
    assert.equal((await sessionController.rename({sessionId,title:guideLabel})).title,guideLabel);
    const deadlineAt=new Date(Date.now()+admission.limits.wallMs).toISOString();
    const memoryInstruction=(memberId:string,target:object,text:string)=>`After your actual business checks pass, call native member_context {"action":"memory-status","request":{"page":{"limit":100}}}. Find the team-scoped human feedback whose record.text is ${JSON.stringify(feedbackText)}. If it is absent, report a blocker without inventing a source. Build source {kind:"feedback",eventId:feedback.tip.eventId,sha256:feedback.record.sha256}. Call propose-memory with request {requestId:"issue109-${memberId}-proposal",target:${JSON.stringify(target)},text:${JSON.stringify(text)},reason:"Technique verified against the exact retained GitHub head and human feedback",conditions:["This bounded exact-head GitHub delivery"],sources:[source]}. Unwrap the actual proposed MemoryView and call adopt-memory with request {requestId:"issue109-${memberId}-adopt",memoryId:proposed.record.memoryId,expectedVersion:proposed.record.version,expectedRevision:proposed.tip.revision,supersedesEventId:proposed.tip.eventId,action:"adopted",reason:"Source-backed technique checked during this business task",evidenceRefs:[source],conditions:["This bounded exact-head GitHub delivery"]}. Require actual state adopted. These actions are native member_context calls; never supply actor/grant fields, use human adoption, fabricate receipts or claim Hindsight indexing completion.`;
    const developerGoal=`Verify the retained fix for ${binding.issueUrl}. Call native member_context github status then checkout with request containing only action. Require checkout HEAD ${expectedHead}; any base/other head or ownership refusal is an honest blocker, never repair ownership. In ONLY your returned worktree run git rev-parse HEAD, npm test, and inspect git diff ${binding.baseCommit}..HEAD -- src/checklist.mjs. Do not edit, commit, push, merge, tag, release or delete. ${memoryInstruction('developer',{kind:'member',memberId:'developer'},'In my private worktree, test the exact retained commit and report its SHA before handing work to independent review.')} Return only raw TaskToolOutput JSON: {"schemaVersion":"software-build/1","value":{"headCommit":"ACTUAL_HEAD","tests":"ACTUAL_PASS_FAIL_SKIP"},"artifacts":[],"diagnostics":[]}.`;
    const buildRequest={requestId:'issue1-build',memberId:'developer',goal:developerGoal,input:binding,
      output:buildOutput,dependsOn:[],deadlineAt};
    const reviewerGoal=`Independently review the exact committed fix for ${binding.issueUrl}. Call native member_context GitHub status then checkout, with request containing only action. In ONLY your returned worktree, compare git rev-parse HEAD with input.headCommit, run npm test, and inspect git diff ${binding.baseCommit}..HEAD -- src/checklist.mjs. Those are the complete review checks. Do not inspect any other workspace, Host credential, Keychain or system process; do not invoke gh, edit, commit or push. Final response must be a single raw JSON object with first character { and last character }; no Markdown, code fence or prose: {"schemaVersion":"software-review/1","value":{"headCommit":"ACTUAL_HEAD","tests":"ACTUAL_PASS_FAIL_SKIP","review":"PASS or actionable finding with reason"},"artifacts":[],"diagnostics":[]}.`;
    const leaderInstructions=`You are the frozen Pi lead. On ORIGINAL input without Host childResults, call native member_context {"action":"delegate","request":${JSON.stringify(buildRequest)}}. Unwrap {ok,value}, keep value.delegationId, then call {"action":"wait","request":{"requestId":"issue1-wait-build","delegationIds":[that delegationId]}}. If wait returns yield-accepted, stop this turn without a completion JSON; Host will close the original native family. On SUCCESSOR input inspect Host childResults[0].result. If its outputSchemaVersion is software-build/1, use its checked value.headCommit to delegate reviewer with requestId issue1-review, memberId reviewer, goal ${JSON.stringify(reviewerGoal)}, input {headCommit:that exact child result SHA}, output ${JSON.stringify(reviewOutput)}, dependsOn [], deadlineAt ${JSON.stringify(deadlineAt)}; then wait with requestId issue1-wait-review and the new delegationId. On a later SUCCESSOR with software-review/1, require review value.headCommit to equal the checked developer commit; if review has a finding, report it without creating a PR. Otherwise ${memoryInstruction('lead',{kind:'team'},'Our team independently reviews and tests the same exact commit before Host PR delivery; source-backed memory cannot alter authority.')} Then call native member_context github checkout {} to read your own worktree, then github open-pr with testsCommit and reviewCommit both equal to the reviewed SHA, tests/review from the reviewer value, remaining "none". Unwrap the Host PR URL and return ONLY a single raw JSON object with first character { and last character }; no Markdown or code fence: {"schemaVersion":"hima-software-delivery/1","value":{"repository":${JSON.stringify(binding.repository)},"issueUrl":${JSON.stringify(binding.issueUrl)},"pullRequestUrl":"HOST_URL","headCommit":"REVIEWED_SHA","tests":"REVIEWER_TESTS","review":"REVIEWER_REVIEW","remaining":"none"},"artifacts":[],"diagnostics":[]}. Never invent a GitHub receipt or repeat an accepted delegation.`;
    const template=teamDefinition.parse(JSON.parse(await readFile(path.join(himaSkillsDir(),'hima-team-software','team.json'),'utf8')));
    const definition:TeamDefinition={...template,members:template.members.map(member=>member.id==='lead'?{...member,toolRefs:[...member.toolRefs,'hima-memory-adopt'],instructions:leaderInstructions}
      :member.id==='developer'?{...member,toolRefs:[...member.toolRefs.filter(ref=>ref!=='hima-github-push'),'hima-memory-adopt'],instructions:'Own only your private task worktree. '+developerGoal}
      :{...member,instructions:'Independent, read-only review of the exact developer head. '+reviewerGoal})};
    const team=await service.teamOperation(sessionId,{action:'save',definition,expectedVersion:null}) as {teamId:string;version:number};
    const opened=await service.teamOperation(sessionId,{action:'startTask',teamId:team.teamId,request:{
      requestId:'issue109-business-delivery',teamId:team.teamId,expectedVersion:team.version,
      goal:'Verify the retained exact-head fix, adopt source-backed personal/team methods via actual native tools, and deliver its tested independently reviewed PR through normal Host ownership. Never rerun historical development.',
      input:binding,deadlineAt,closure:'One exact-head PR after independent review; otherwise retain an honest blocker.'}},'human') as {
        taskId:string;currentRunId:string;readiness:{ready:boolean;missing:string[]}};
    task={teamId:team.teamId,taskId:opened.taskId,currentRunId:opened.currentRunId};
    const feedback=await service.workMemory(sessionId,{teamId:team.teamId,taskId:opened.taskId,action:'feedback',request:{requestId:'issue109-human-source',target:{kind:'team'},text:feedbackText,reason:'Human-authorized bounded exact-head review method source',conditions:['This bounded exact-head GitHub delivery']}},'person') as any;
    assert.equal(feedback.tip.actor.kind,'human');assert.equal(feedback.record.sha256,sha(feedbackText));
    const issueText=`Original GitHub Issue ${issue.html_url}\nTitle: ${issue.title}\nBody SHA256: ${sha(issue.body??'')}\n\n${issue.body??''}`;
    await writeFile(path.join(evidence,'opening.json'),JSON.stringify({task,readiness:opened.readiness,deadlineAt,baseline:binding.baseCommit}));
    assert.equal(opened.readiness.ready,true,JSON.stringify(opened.readiness));
    let view:any;
    await waitUntil('terminal software Team task',async()=>{view=await service.teamOperation(sessionId,{action:'readTask',teamId:team.teamId,taskId:opened.taskId});
      if(/Invalid initial delivery JSON|observation journal bound exceeded|Member IPC disconnected/.test(view.execution?.reason??''))
        throw Error(`Native member failed before Team completion: ${view.execution.reason}`);
      return ['failed','cancelled'].includes(view.execution?.state)||(view.execution?.state==='succeeded'&&view.execution?.resourceState==='closed');},Math.max(1,Date.parse(deadlineAt)-Date.now()));
    assert.equal(view.execution.state,'succeeded',JSON.stringify({state:view.execution.state,reason:view.execution.reason}));
    assert.equal(view.execution.resourceState,'closed');
    // Preserve the actual GitHub original as a source attachment after the task is
    // physically closed. This review/archive message must not create another model turn.
    const sourceBytes=Buffer.from(issueText,'utf8');
    const uploaded=await host.ctx.get('fileUploads')!.uploadStream({sessionId:guide.id,name:'issue-1-original.md',
      data:(async function*(){yield sourceBytes;})()});
    const issueMaterial=await service.teamOperation(sessionId,{action:'stage-attachment',teamId:team.teamId,taskId:opened.taskId,
      request:{requestId:'issue109-source-attachment',receiptId:uploaded.receiptId}},'human') as any;
    assert.equal(issueMaterial.material.sha256,sha(issueText));
    const issueMessage=await service.teamOperation(sessionId,{action:'send-message',teamId:team.teamId,taskId:opened.taskId,
      request:{requestId:'issue109-original-issue',recipientMemberIds:['lead'],text:'Original GitHub Issue retained for source review after checked delivery.',stagedAttachmentIds:[issueMaterial.stageId]}},'human');
    assert.ok((issueMessage as any).deliveries.every((delivery:any)=>delivery.state!=='accepted'),'post-delivery archive message is retained without waking a closed native family');
    await writeFile(path.join(evidence,'source.json'),JSON.stringify({feedback,issue:{url:issue.html_url,title:issue.title,body:issue.body,bodySha256:sha(issue.body??'')},issueMaterial,issueMessage},null,2),{mode:0o600});
    const final=view.execution.tasks.find((row:any)=>row.result?.outputSchemaVersion==='hima-software-delivery/1')?.result;
    assert.ok(final,'checked software delivery result required');
    const value=final.value as {repository:string;issueUrl:string;pullRequestUrl:string;headCommit:string;tests:string;review:string;remaining:string};
    assert.equal(value.repository,binding.repository);assert.equal(value.issueUrl,binding.issueUrl);
    assert.equal(value.headCommit,expectedHead);assert.match(value.pullRequestUrl,/^https:\/\/github\.com\/lluzi\/himateam_test\/pull\/\d+$/);
    const teamTasks=await store.listTeamTasks(view.projectId,team.teamId);
    const allRunIds=[...new Set(teamTasks.flatMap(row=>row.runIds))];
    const allInvocations=(await Promise.all(allRunIds.map(runId=>store.flowInvocations(runId)))).flat();
    const role=(row:any)=>(row.context as any).flow?.tasks?.[(row.context as any).taskId]?.memberId;
    const developer=allInvocations.find(row=>role(row)==='developer');
    const reviewer=allInvocations.find(row=>role(row)==='reviewer');
    assert.ok(developer&&reviewer,'both native member roles must be admitted');
    const developerResult=await store.result(developer.identity.effectId);
    const reviewerResult=await store.result(reviewer.identity.effectId);
    assert.equal(developerResult?.outputSchemaVersion,'software-build/1');
    assert.equal(reviewerResult?.outputSchemaVersion,'software-review/1');
    assert.equal((developerResult?.value as any)?.headCommit,value.headCommit);
    assert.equal((reviewerResult?.value as any)?.headCommit,value.headCommit);
    assert.match(String((reviewerResult?.value as any)?.review),/PASS/i);
    const developerLease=await store.effectFact(developer.identity.effectId,'native:oar:local-lease') as {workDirectory:string}|undefined;
    const reviewerLease=await store.effectFact(reviewer.identity.effectId,'native:oar:local-lease') as {workDirectory:string;controlDirectory:string}|undefined;
    assert.ok(developerLease?.workDirectory&&reviewerLease?.workDirectory);
    assert.notEqual(developerLease.workDirectory,reviewerLease.workDirectory,'reviewer must own a distinct native worktree');
    const reviewerCheckout=path.join(reviewerLease.workDirectory,'software/task');
    const reviewedHead=(await command('/usr/bin/git',['-C',reviewerCheckout,'rev-parse','HEAD'],
      {encoding:'utf8',timeout:10000,env:memberGitEnvironment})).stdout.trim();
    assert.equal(reviewedHead,value.headCommit,'reviewer actual worktree must contain the delivered commit');
    const green=(await command('/Users/lluzi/.local/node24/bin/npm',['test'],
      {cwd:reviewerCheckout,encoding:'utf8',timeout:20000,env:testEnvironment})).stdout;
    assert.match(green,/pass|ok/i,'independent rerun must report passing tests');
    const reviewDiff=(await command('/usr/bin/git',['-C',reviewerCheckout,'diff','--stat',`${binding.baseCommit}..HEAD`],
      {encoding:'utf8',timeout:10000,env:memberGitEnvironment})).stdout.trim();
    assert.match(reviewDiff,/src\/checklist\.mjs/,'the committed change must address the frozen Issue');
    const remote=JSON.parse((await command('gh',['api',`repos/${binding.repository}/git/ref/heads/${binding.taskBranch}`],
      {encoding:'utf8',timeout:15000,env:githubEnvironment})).stdout).object.sha as string;
    assert.equal(remote,value.headCommit,'actual remote task branch equals checked delivery');
    const pr=JSON.parse((await command('gh',['pr','view',value.pullRequestUrl,'--repo',binding.repository,'--json','url,state,headRefOid,baseRefName,body'],
      {encoding:'utf8',timeout:15000,env:githubEnvironment})).stdout) as {url:string;state:string;headRefOid:string;baseRefName:string;body:string};
    assert.equal(pr.state,'OPEN');assert.equal(pr.url,value.pullRequestUrl);assert.equal(pr.headRefOid,value.headCommit);assert.equal(pr.baseRefName,'main');
    assert.ok(pr.body.includes(value.headCommit));
    assert.ok(pr.body.includes(binding.issueUrl));
    assert.match(pr.body,/Tests \([a-f0-9]{40}\):.*2 pass.*0 fail/i);
    assert.match(pr.body,/Independent review \([a-f0-9]{40}\): PASS/i);
    const finalLead=allInvocations.find(row=>row.identity.effectId===final.identity.effectId);
    assert.ok(finalLead&&role(finalLead)==='lead','PR delivery must belong to this final native lead invocation');
    const leadLease=await store.effectFact(final.identity.effectId,'native:oar:local-lease') as {controlDirectory:string}|undefined;
    assert.ok(leadLease?.controlDirectory);
    const prReplies=Object.entries(await store.listExternalEffectFacts(final.identity,'oar:tool-reply:'))
      .filter(([,reply])=>(reply as any)?.ok===true&&(reply as any)?.value?.state==='existing'&&(reply as any)?.value?.url===value.pullRequestUrl&&(reply as any)?.value?.headCommit===value.headCommit);
    assert.ok(prReplies.length>0,'A current successful Host existing-PR delivery receipt is required');
    const [phase,reply]=prReplies[0]!;
    const match=/^oar:tool-reply:([0-9a-f-]{36})$/i.exec(phase);assert.ok(match,'Host receipt has a native request identity');
    const requestId=match[1]!;
    const prRequest=JSON.parse(await readFile(path.join(leadLease.controlDirectory,'native/requests',requestId+'.json'),'utf8'));
    assert.equal(prRequest.id,requestId);requireCurrentPrReceipt(prRequest,reply,value);
    const hostPrDelivery={identity:final.identity,requestId,request:prRequest,reply};
    const native=[];
    for(const invocation of allInvocations){
      const observations=Object.values(await store.listExternalEffectFacts(invocation.identity,'oar:observation:')) as any[];
      assert.ok(observations.some(row=>row.kind==='received'),'actual native input receipt required');
      const checkedResult=await store.result(invocation.identity.effectId);
      const lease=await store.effectFact(invocation.identity.effectId,'native:oar:local-lease') as any;
      let yieldedJournal:undefined|{sha256:string;observations:any[]};
      if(!observations.some(row=>row.kind==='terminal')){
        assert.equal(checkedResult,null,'Committed developer/reviewer/final result cannot use yielded-journal fallback');assert.equal(role(invocation),'lead');
        const intent=await store.effectFact(invocation.identity.effectId,'native:oar:yield-intent') as any;
        const accepted=Object.values(await store.listExternalEffectFacts(invocation.identity,'oar:tool-reply:')).find((reply:any)=>reply?.ok===true&&reply.value?.state==='yield-accepted'&&reply.value.waitId===intent?.waitId);
        const prepared=await store.effectFact(invocation.identity.effectId,'prepared') as any;assert.deepEqual(prepared.identity,invocation.identity);
        const bytes=await readFile(path.join(lease.controlDirectory,'journal.jsonl'));
        const rows=bytes.toString('utf8').trim().split('\n').map(line=>JSON.parse(line));
        requireYieldedNativeTurn(invocation.identity,lease,await store.effectFact(invocation.identity.effectId,'native:oar:native-session'),intent,accepted,
          await store.effectFact(invocation.identity.effectId,'native:oar:closed'),prepared.inputId,rows);
        yieldedJournal={sha256:sha(bytes),observations:rows.filter(row=>['received','terminal','control'].includes(row.kind))};
      }
      if(checkedResult)assert.ok(observations.some(row=>row.kind==='terminal'&&row.payload?.received===true&&row.payload?.outcome?.kind==='completed'&&observations.some(receive=>receive.kind==='received'&&receive.nativeSession===row.nativeSession&&receive.streamGeneration===row.streamGeneration&&receive.payload?.inputId===row.payload?.inputId)),'checked result must bind matching received/completed native turn');
      native.push({identity:invocation.identity,role:role(invocation),observations,
        lease,...(yieldedJournal?{yieldedJournal}:{})});
    }
    await writeFile(path.join(evidence,'native-raw.json'),JSON.stringify(native,null,2),{mode:0o600});
    // Observe existing PG tables read-only; never synthesize actors or write memory facts.
    const credential=JSON.parse(await readFile(path.join(home.home,'hima/database/credentials.json'),'utf8'));
    const {Client}=createRequire(path.join(repoRoot,'packages/harness/package.json'))('pg');
    const pg=new Client({host:'127.0.0.1',port:credential.port,user:credential.user,password:credential.password,database:'hima_application',options:'-c default_transaction_read_only=on -c statement_timeout=5000',application_name:'issue109-business-readonly'});
    let memoryRows:any[]=[];
    await pg.connect();
    try {
      assert.equal((await pg.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
      memoryRows=(await pg.query(`SELECT r.record,e.event FROM hima.team_memory_records r JOIN hima.team_memory_events e USING(memory_id,version) WHERE e.project_id=$1 AND e.team_id=$2 ORDER BY e.seq`,[view.projectId,team.teamId])).rows;
    }finally{await pg.end();}
    const source={kind:'feedback',eventId:feedback.tip.eventId,sha256:feedback.record.sha256};
    for(const [memberId,kind] of [['developer','member'],['lead','team']]){
      const proposed=memoryRows.find(row=>row.event.requestId===`issue109-${memberId}-proposal`);
      const adopted=memoryRows.find(row=>row.event.requestId===`issue109-${memberId}-adopt`);
      assert.ok(proposed&&adopted,`Actual ${memberId} proposal/adoption events required`);
      assert.equal(proposed.event.event,'proposed');assert.equal(proposed.record.kind,'experience');
      assert.equal(proposed.record.createdBy.kind,'member');assert.equal(proposed.record.createdBy.memberId,memberId);
      assert.equal(proposed.record.scope.kind,kind);assert.equal(proposed.record.scope.teamId,team.teamId);
      if(kind==='member')assert.equal(proposed.record.scope.memberId,memberId);
      assert.equal(adopted.event.actor.kind,'member');assert.equal(adopted.event.actor.memberId,memberId);
      assert.equal(adopted.event.state,'adopted');assert.equal(adopted.event.memoryId,proposed.record.memoryId);
      assert.equal(adopted.event.version,proposed.record.version);assert.equal(adopted.event.revision,proposed.event.revision+1);
      assert.equal(adopted.event.supersedesEventId,proposed.event.eventId);
      assert.deepEqual(proposed.record.sources,[source]);assert.deepEqual(adopted.event.evidenceRefs,[source]);
      assert.ok(allInvocations.some(row=>row.identity.effectId===adopted.event.actor.effectId&&row.identity.runId===adopted.event.actor.runId&&role(row)===memberId),'adoption actor must bind real native effect');
    }
    const status=await service.workMemory(sessionId,{teamId:team.teamId,taskId:opened.taskId,action:'status',request:{page:{limit:100}}},'person') as any;
    for(const id of ['issue109-developer-adopt','issue109-lead-adopt'])assert.ok(status.records.some((row:any)=>row.tip.requestId===id&&row.tip.state==='adopted'));
    await writeFile(path.join(evidence,'memory.json'),JSON.stringify({source,events:memoryRows,status,indexClaim:'Observed only; pending/unknown is not indexed retrieval qualification'},null,2),{mode:0o600});
    const members=allInvocations.map(role).filter(Boolean);
    await writeFile(path.join(evidence,'delivery.json'),JSON.stringify({task,deadlineAt,remoteHead:remote,pr:{url:pr.url,state:pr.state,headRefOid:pr.headRefOid},
      memberInvocations:members,developerEffectId:developer.identity.effectId,reviewerEffectId:reviewer.identity.effectId,
      reviewerCheckout,reviewedHead,reviewDiff,green:green.slice(0,4000),hostPrDelivery,delivery:value,resourceState:view.execution.resourceState,elapsedMs:Date.now()-startedAt,
      productModelRequests:'unmeasured',productTokens:'unmeasured'},null,2));
    await writeFile(path.join(evidence,'desktop-input.json'),JSON.stringify({schema:'hima.issue109.desktop-input/1',home:home.home,workspace:home.workspace,
      evidenceRoot:path.join(admission.proofRoot,'desktop'),expectedApplicationVersion:store.applicationVersion,
      expectedDesktopMainSha256:sha(await readFile(path.join(repoRoot,'packages/desktop/lib/main.js'))),expectedClientSha256:sha(await readFile(path.join(repoRoot,'packages/harness/lib/client.js'))),guide:{sessionId,label:guideLabel},
      task:{teamId:team.teamId,taskId:opened.taskId,currentRunId:view.currentRunId,memberId:'lead',resultEffectId:final.identity.effectId,
        materialSha256:issueMaterial.material.sha256,expectedExecutionState:'succeeded'},
      source:{stageId:issueMaterial.stageId,materialId:issueMaterial.material.materialId,messageId:(issueMessage as any).message.messageId,
        bodySha256:sha(issue.body??''),originalUrl:issue.html_url}},null,2)+'\n',{mode:0o600});
    complete=true;
  } catch(error) {
    originalFailure=error;
    try {
      const current=task&&sessionId?await service.teamOperation(sessionId,{action:'readTask',teamId:task.teamId,taskId:task.taskId}) as any:undefined;
      const teamTasks=task&&current?await store.listTeamTasks(current.projectId,task.teamId):[];
      const runIds=[...new Set(teamTasks.flatMap(row=>row.runIds))];
      const invocations=(await Promise.all(runIds.map(runId=>store.flowInvocations(runId)))).flat();
      const effects=[];
      for(const row of invocations){const observations=Object.values(await store.listExternalEffectFacts(row.identity,'oar:observation:')) as any[];
        const replies=Object.values(await store.listExternalEffectFacts(row.identity,'oar:tool-reply:')) as any[];
        effects.push({effectId:row.identity.effectId,taskId:row.identity.taskId,kinds:observations.map(item=>item.kind),
          toolReplies:replies.map(item=>({ok:item.ok,state:item.value?.state,error:item.error?String(item.error).slice(0,500):undefined}))});}
      await writeFile(path.join(evidence,'failure-boundary.json'),JSON.stringify({error:concise(error),task,
        state:current?.execution?.state,reason:current?.execution?.reason,resourceState:current?.execution?.resourceState,effects}),{mode:0o600});
    } catch {}
    throw error;
  } finally {
    let cleanupError:unknown;
    try {
      if(task&&!complete&&sessionId){let view=await service.teamOperation(sessionId,{action:'readTask',teamId:task.teamId,taskId:task.taskId}) as any;
        if(view.execution?.resourceState!=='closed'){
          await service.teamOperation(sessionId,{action:'control',teamId:task.teamId,taskId:task.taskId,request:{
            requestId:'cleanup-issue1-software',action:'cancel',expectedEpoch:view.execution.epoch,expectedRevision:view.execution.revision}},'human');
          await waitUntil('scoped Team cancellation closes resources',async()=>{view=await service.teamOperation(sessionId,{action:'readTask',teamId:task!.teamId,taskId:task!.taskId});return view.execution.resourceState==='closed';},20_000);
        }
      }
    } catch(error){cleanupError=error;}
    try{await host.dispose();
      const closer=(service as unknown as {resourcesClosing?:Promise<void>}).resourcesClosing;
      if(!closer)throw Error('Host did not publish its original resource-closure promise');
      await closer;closed=true;
    }catch(error){cleanupError??=error;}
    // Keep this normally closed Home/workspace for same-candidate Desktop retained-task painting.
    await writeFile(path.join(evidence,'cleanup.json'),JSON.stringify({task,complete,closed,home:home.home,workspace:home.workspace,retained:true,externalWatcher:admission.cleanup},null,2),{mode:0o600});
    if(cleanupError){await writeFile(path.join(evidence,'cleanup-unconfirmed.json'),JSON.stringify({task,originalFailure:originalFailure instanceof Error?originalFailure.name:undefined,cleanup:concise(cleanupError)}));
      if(!originalFailure)throw cleanupError;}
  }
});
