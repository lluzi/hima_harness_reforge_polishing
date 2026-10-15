// #106 L4: actual Pi/OpenCode members develop one authorized private Issue,
// independently review its exact commit and deliver one Host-bound GitHub PR.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { himaSkillsDir, memberGitEnvironment, teamDefinition, type TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';

process.env.HIMA_TEST_SILENT_AGENT='1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
const command=promisify(execFile);
const githubEnvironment={...process.env};
for(const name of Object.keys(githubEnvironment))if(name.startsWith('GIT_'))delete githubEnvironment[name];
delete githubEnvironment.NODE_OPTIONS;
delete githubEnvironment.NODE_TEST_CONTEXT;
const testEnvironment={...memberGitEnvironment,PATH:'/Users/lluzi/.local/node24/bin:/usr/bin:/bin',NODE_OPTIONS:''};
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

test('mixed Pi/OpenCode Team fixes real Issue #1, independently reviews the commit and opens one PR',{
  timeout:570_000,skip:!process.env.DEEPSEEK_API_KEY?'Requires authorized shared DeepSeek credential':false,
},async()=>{
  const startedAt=Date.now(),home=await createHimaHome({desktopShaped:true});
  Object.assign(home.env,{DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com/anthropic',
    DEEPSEEK_MODEL:process.env.DEEPSEEK_MODEL??'deepseek-flash',DEEPSEEK_API:process.env.DEEPSEEK_API??'anthropic-messages'});
  const evidence=path.join(process.env.HIMA_TEAM_EVIDENCE??path.resolve('.scratch/himateam-issue97/issue106-live'),
    'mixed-issue-1-'+new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(evidence,{recursive:true});
  const host=await bootInProcess(home),service=host.ctx.hima,store=service.durable.store;
  let sessionId='',task:{teamId:string;taskId:string;currentRunId:string}|undefined,complete=false,closed=false,originalFailure:unknown;
  try {
    await service.reconciled;
    const baselineDirectory=path.resolve('../../himateam-issue106/seed');
    const baselineHead=(await command('/usr/bin/git',['-C',baselineDirectory,'rev-parse','HEAD'],
      {encoding:'utf8',timeout:10000,env:memberGitEnvironment})).stdout.trim();
    assert.equal(baselineHead,binding.baseCommit,'the RED fixture must be the frozen Issue base');
    const baseline=await command('/Users/lluzi/.local/node24/bin/npm',['test'],{cwd:baselineDirectory,encoding:'utf8',timeout:20000,env:testEnvironment})
      .then(result=>({failed:false,output:`${result.stdout}\n${result.stderr}`}),(error:Error&{stdout?:string;stderr?:string})=>({failed:true,output:`${error.stdout??''}\n${error.stderr??''}`}));
    await writeFile(path.join(evidence,'baseline-red.json'),JSON.stringify({head:baselineHead,failed:baseline.failed,
      output:baseline.output.slice(0,4000)}));
    assert.equal(baseline.failed,true,'Issue base must reproduce the failing CRLF case');
    assert.match(baseline.output,/CRLF|not ok|fail/i);
    sessionId=String((await createRootAgent(host.ctx,home.workspace)).id);
    const deadlineAt=new Date(Date.now()+500_000).toISOString();
    const developerGoal=`Fix ${binding.issueUrl} from base ${binding.baseCommit}. Call native member_context GitHub status then checkout, with request containing only action. If checkout HEAD is the base, run npm test for actual RED, make the smallest CRLF correction preserving LF and TypeError, commit, run npm test for GREEN, and Host push-task-branch. If checkout HEAD is already the remote task-branch commit with this exact fix, inspect its diff and run npm test GREEN; reuse that commit without another write. Return the actual HEAD and pass/fail/skip. Final response must be a single raw JSON object with first character { and last character }; no Markdown, code fence or prose: {"schemaVersion":"software-build/1","value":{"headCommit":"ACTUAL_HEAD","tests":"ACTUAL_PASS_FAIL_SKIP"},"artifacts":[],"diagnostics":[]}.`;
    const buildRequest={requestId:'issue1-build',memberId:'developer',goal:developerGoal,input:binding,
      output:buildOutput,dependsOn:[],deadlineAt};
    const reviewerGoal=`Independently review the exact committed fix for ${binding.issueUrl}. Call native member_context GitHub status then checkout, with request containing only action. In ONLY your returned worktree, compare git rev-parse HEAD with input.headCommit, run npm test, and inspect git diff ${binding.baseCommit}..HEAD -- src/checklist.mjs. Those are the complete review checks. Do not inspect any other workspace, Host credential, Keychain or system process; do not invoke gh, edit, commit or push. Final response must be a single raw JSON object with first character { and last character }; no Markdown, code fence or prose: {"schemaVersion":"software-review/1","value":{"headCommit":"ACTUAL_HEAD","tests":"ACTUAL_PASS_FAIL_SKIP","review":"PASS or actionable finding with reason"},"artifacts":[],"diagnostics":[]}.`;
    const leaderInstructions=`You are the frozen Pi lead. On ORIGINAL input without Host childResults, call native member_context {"action":"delegate","request":${JSON.stringify(buildRequest)}}. Unwrap {ok,value}, keep value.delegationId, then call {"action":"wait","request":{"requestId":"issue1-wait-build","delegationIds":[that delegationId]}}. If wait returns yield-accepted, stop this turn without a completion JSON; Host will close the original native family. On SUCCESSOR input inspect Host childResults[0].result. If its outputSchemaVersion is software-build/1, use its checked value.headCommit to delegate reviewer with requestId issue1-review, memberId reviewer, goal ${JSON.stringify(reviewerGoal)}, input {headCommit:that exact child result SHA}, output ${JSON.stringify(reviewOutput)}, dependsOn [], deadlineAt ${JSON.stringify(deadlineAt)}; then wait with requestId issue1-wait-review and the new delegationId. On a later SUCCESSOR with software-review/1, require review value.headCommit to equal the checked developer commit; if review has a finding, report it without creating a PR. Otherwise call native member_context github checkout {} to read your own worktree, then github open-pr with testsCommit and reviewCommit both equal to the reviewed SHA, tests/review from the reviewer value, remaining "none". Unwrap the Host PR URL and return ONLY a single raw JSON object with first character { and last character }; no Markdown or code fence: {"schemaVersion":"hima-software-delivery/1","value":{"repository":${JSON.stringify(binding.repository)},"issueUrl":${JSON.stringify(binding.issueUrl)},"pullRequestUrl":"HOST_URL","headCommit":"REVIEWED_SHA","tests":"REVIEWER_TESTS","review":"REVIEWER_REVIEW","remaining":"none"},"artifacts":[],"diagnostics":[]}. Never invent a GitHub receipt or repeat an accepted delegation.`;
    const template=teamDefinition.parse(JSON.parse(await readFile(path.join(himaSkillsDir(),'hima-team-software','team.json'),'utf8')));
    const definition:TeamDefinition={...template,members:template.members.map(member=>member.id==='lead'?{...member,instructions:leaderInstructions}
      :member.id==='developer'?{...member,instructions:'Own only your private task worktree. '+developerGoal}
      :{...member,instructions:'Independent, read-only review of the exact developer head. '+reviewerGoal})};
    const team=await service.teamOperation(sessionId,{action:'save',definition,expectedVersion:null}) as {teamId:string;version:number};
    const opened=await service.teamOperation(sessionId,{action:'startTask',teamId:team.teamId,request:{
      requestId:'issue1-software-delivery',teamId:team.teamId,expectedVersion:team.version,
      goal:'Deliver a tested and independently reviewed PR for the frozen GitHub Issue. Follow the leader stage instructions and original deadline.',
      input:binding,deadlineAt,closure:'One exact-head PR after independent review; otherwise retain an honest blocker.'}},'human') as {
        taskId:string;currentRunId:string;readiness:{ready:boolean;missing:string[]}};
    task={teamId:team.teamId,taskId:opened.taskId,currentRunId:opened.currentRunId};
    await writeFile(path.join(evidence,'opening.json'),JSON.stringify({task,readiness:opened.readiness,deadlineAt,baseline:binding.baseCommit}));
    assert.equal(opened.readiness.ready,true,JSON.stringify(opened.readiness));
    let view:any;
    await waitUntil('terminal software Team task',async()=>{view=await service.teamOperation(sessionId,{action:'readTask',teamId:team.teamId,taskId:opened.taskId});
      if(/Invalid initial delivery JSON|observation journal bound exceeded|Member IPC disconnected/.test(view.execution?.reason??''))
        throw Error(`Native member failed before Team completion: ${view.execution.reason}`);
      return ['succeeded','failed','cancelled'].includes(view.execution?.state);},Math.max(1,Date.parse(deadlineAt)-Date.now()));
    assert.equal(view.execution.state,'succeeded',JSON.stringify({state:view.execution.state,reason:view.execution.reason}));
    assert.equal(view.execution.resourceState,'closed');
    const final=view.execution.tasks.find((row:any)=>row.result?.outputSchemaVersion==='hima-software-delivery/1')?.result;
    assert.ok(final,'checked software delivery result required');
    const value=final.value as {repository:string;issueUrl:string;pullRequestUrl:string;headCommit:string;tests:string;review:string;remaining:string};
    assert.equal(value.repository,binding.repository);assert.equal(value.issueUrl,binding.issueUrl);
    assert.match(value.headCommit,/^[a-f0-9]{40}$/);assert.match(value.pullRequestUrl,/^https:\/\/github\.com\/lluzi\/himateam_test\/pull\/\d+$/);
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
    const reviewProfile=path.join(reviewerLease.controlDirectory,'software-github.sb');
    assert.match(await readFile(reviewProfile,'utf8'),/deny file-read\*/);
    const green=(await command('/usr/bin/sandbox-exec',['-f',reviewProfile,'/Users/lluzi/.local/node24/bin/npm','test'],
      {cwd:reviewerCheckout,encoding:'utf8',timeout:20000,env:{...testEnvironment,
        HOME:path.join(reviewerLease.controlDirectory,'native'),TMPDIR:path.join(reviewerLease.controlDirectory,'native/tmp')}})).stdout;
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
    const members=allInvocations.map(role).filter(Boolean);
    await writeFile(path.join(evidence,'delivery.json'),JSON.stringify({task,deadlineAt,remoteHead:remote,pr:{url:pr.url,state:pr.state,headRefOid:pr.headRefOid},
      memberInvocations:members,developerEffectId:developer.identity.effectId,reviewerEffectId:reviewer.identity.effectId,
      reviewerCheckout,reviewedHead,reviewDiff,green:green.slice(0,4000),delivery:value,resourceState:view.execution.resourceState,elapsedMs:Date.now()-startedAt,
      productModelRequests:'unmeasured',productTokens:'unmeasured'},null,2));
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
    if(complete&&closed)await home.dispose();
    if(cleanupError){await writeFile(path.join(evidence,'cleanup-unconfirmed.json'),JSON.stringify({task,originalFailure:originalFailure instanceof Error?originalFailure.name:undefined,cleanup:concise(cleanupError)}));
      if(!originalFailure)throw cleanupError;}
  }
});
