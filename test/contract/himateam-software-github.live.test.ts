// #106 L4 read-only preflight: actual Pi/model/MCP obtains one authorized Issue checkout.
// The mixed development/review and all remote writes have separate acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { memberGitEnvironment, type TeamDefinition } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
const git = promisify(execFile);
const binding = { repository: 'lluzi/himateam_test', issueNumber: 1,
  issueUrl: 'https://github.com/lluzi/himateam_test/issues/1',
  baseCommit: 'd6fccb90243bc93240e8057f345665b9d5e0ec68', taskBranch: 'codex/issue-1-read-preflight' };
const output = { version: 'software-preflight/1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object', properties: { issueUrl: { type: 'string' }, baseCommit: { type: 'string' }, worktreeHead: { type: 'string' } },
  required: ['issueUrl', 'baseCommit', 'worktreeHead'], additionalProperties: false } };
const waitUntil = async (probe: () => Promise<boolean>, ms: number): Promise<void> => {
  const until = Date.now() + ms;
  for (;;) { if (await probe()) return; if (Date.now() >= until) throw Error('Actual software preflight did not settle within the original budget');
    await new Promise(resolve => setTimeout(resolve, 500)); }
};

test('actual Pi member obtains the frozen private Issue checkout through Host without a remote write', {
  timeout: 180_000, skip: !process.env.DEEPSEEK_API_KEY ? 'Requires authorized shared DeepSeek credential' : false,
}, async () => {
  const home = await createHimaHome();
  Object.assign(home.env, { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/anthropic',
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
    DEEPSEEK_API: process.env.DEEPSEEK_API ?? 'anthropic-messages' });
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.resolve('.scratch/himateam-issue97/issue106-live'),
    'read-preflight-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(evidence, { recursive: true });
  const host = await bootInProcess(home), service = host.ctx.hima, store = service.durable.store;
  let task: {teamId:string;taskId:string;currentRunId:string}|undefined,sessionId='',complete=false,closed=false,originalFailure:unknown;
  try {
    await service.reconciled;
    sessionId=String((await createRootAgent(host.ctx,home.workspace)).id);
    const definition:TeamDefinition={...teamFixture,title:'Authorized GitHub read preflight',
      members:[{...teamFixture.members[0]!,id:'lead',role:'Read-only preflight',runtime:'pi',modelRef:'default',
        skills:[],toolRefs:['hima-member-context','hima-github-pr'],
        instructions:'Invoke native member_context exactly once with {"action":"github","request":{"action":"checkout"}}. Host already owns the frozen repository and Issue binding; add no other request fields. Do not edit, push or open a PR. Return only the exact requested TaskToolOutput JSON.'}],
      delivery:{description:'Exact read-only checkout identity',output}};
    const team=await service.teamOperation(sessionId,{action:'save',definition,expectedVersion:null}) as {teamId:string;version:number};
    const deadlineAt=new Date(Date.now()+150_000).toISOString();
    const opened=await service.teamOperation(sessionId,{action:'startTask',teamId:team.teamId,request:{
      requestId:'issue-1-read-preflight',teamId:team.teamId,expectedVersion:team.version,
      goal:'Call the native member_context MCP tool exactly once with arguments {"action":"github","request":{"action":"checkout"}}. Do not put repository, issueUrl, issueNumber, baseCommit or taskBranch in the request: Host reads the frozen task input. Unwrap the response {ok,value}; copy value.headCommit to worktreeHead, and copy issueUrl/baseCommit from the frozen task input. Do not change files or write GitHub. Return ONLY one TaskToolOutput JSON object: {"schemaVersion":"software-preflight/1","value":{"issueUrl":"https://github.com/lluzi/himateam_test/issues/1","baseCommit":"d6fccb90243bc93240e8057f345665b9d5e0ec68","worktreeHead":"d6fccb90243bc93240e8057f345665b9d5e0ec68"},"artifacts":[],"diagnostics":[]}. No markdown or prose.',
      input:binding,deadlineAt,closure:'Report the exact checkout; no repository mutation.'}},'human') as {
        taskId:string;currentRunId:string;readiness:{ready:boolean;missing:string[]}};
    task={...opened,teamId:team.teamId};
    await writeFile(path.join(evidence,'opening.json'),JSON.stringify({taskId:opened.taskId,runId:opened.currentRunId,readiness:opened.readiness}));
    assert.equal(opened.readiness.ready,true,JSON.stringify(opened.readiness));
    const current=task;
    let view:any;
    try {
      await waitUntil(async()=>{view=await service.teamOperation(sessionId,{action:'readTask',teamId:current.teamId,taskId:current.taskId});
        return ['succeeded','failed','cancelled'].includes(view.execution?.state);},145_000);
    } catch(error) {
      const invocations=await store.flowInvocations(current.currentRunId).catch(()=>[]);
      await writeFile(path.join(evidence,'timeout-boundary.json'),JSON.stringify({
        taskId:current.taskId,runId:current.currentRunId,state:view?.execution?.state,reason:view?.execution?.reason,
        resourceState:view?.execution?.resourceState,invocationCount:invocations.length,
        taskStates:view?.execution?.tasks?.map((row:any)=>({state:row.state,reason:row.reason}))}));
      throw error;
    }
    assert.equal(view.execution.state,'succeeded',JSON.stringify({state:view.execution.state,reason:view.execution.reason}));
    const result=view.execution.tasks.find((row:any)=>row.result)?.result;
    assert.ok(result,'actual checked Team result is required');
    assert.equal(result.outputSchemaVersion,'software-preflight/1');
    assert.equal(result.value.issueUrl,binding.issueUrl);
    assert.equal(result.value.baseCommit,binding.baseCommit);
    assert.equal(result.value.worktreeHead,binding.baseCommit);
    const invocations=await store.flowInvocations(current.currentRunId);
    assert.equal(invocations.length,1);
    const lease=await store.effectFact(invocations[0]!.identity.effectId,'native:oar:local-lease') as {workDirectory:string;controlDirectory:string}|undefined;
    assert.ok(lease?.workDirectory);
    const checkout=path.join(lease.workDirectory,'software/task');
    const profile=path.join(lease.controlDirectory,'software-github.sb');
    assert.match(await readFile(profile,'utf8'),/deny file-read\*/);
    const privateHomeReadable=await git('/usr/bin/sandbox-exec',['-f',profile,'/bin/ls',path.join(process.env.HOME??'', '.config/gh')],
      {encoding:'utf8',timeout:10000}).then(()=>true,()=>false);
    assert.equal(privateHomeReadable,false,'member sandbox must deny Host GitHub credential directory');
    const checkoutReadable=await git('/usr/bin/sandbox-exec',['-f',profile,'/bin/ls',checkout],
      {encoding:'utf8',timeout:10000}).then(()=>true,()=>false);
    assert.equal(checkoutReadable,true,'member sandbox must admit its own checkout');
    const directProtectedPush=await git('/usr/bin/sandbox-exec',['-f',profile,'/usr/bin/git','-C',checkout,
      'push','--dry-run','origin','HEAD:refs/heads/main'],{encoding:'utf8',timeout:15000,
      env:{HOME:process.env.HOME,PATH:'/usr/bin:/bin:/opt/homebrew/bin',GIT_TERMINAL_PROMPT:'0'}})
      .then(()=>true,()=>false);
    assert.equal(directProtectedPush,false,'member shell cannot authenticate a direct main push');
    const head=(await git('/usr/bin/git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8',timeout:10000,env:memberGitEnvironment})).stdout.trim();
    assert.equal(head,binding.baseCommit);
    const replies=Object.values(await store.listExternalEffectFacts(invocations[0]!.identity,'oar:tool-reply:')) as any[];
    assert.ok(replies.some(row=>row.ok===true&&row.value?.worktree===checkout&&row.value?.headCommit===binding.baseCommit),
      'actual native member_context response includes the Host-created checkout');
    await writeFile(path.join(evidence,'read-preflight.json'),JSON.stringify({taskId:current.taskId,runId:current.currentRunId,
      issueUrl:binding.issueUrl,baseCommit:binding.baseCommit,worktree:checkout,head,toolReplies:replies.length,
      resourceState:view.execution.resourceState,productModelRequests:'unmeasured'}));
    assert.equal(view.execution.resourceState,'closed');
    complete=true;
  } catch(error) {
    originalFailure=error;
    try {
      const clean=(value:string)=>value.replaceAll(process.env.DEEPSEEK_API_KEY??'__no_key__','[redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g,'[redacted]').slice(0,800);
      const invocations=task?await store.flowInvocations(task.currentRunId):[];
      const effects=[];
      for(const row of invocations) {
        const observed=Object.values(await store.listExternalEffectFacts(row.identity,'oar:observation:')) as any[];
        const replies=Object.values(await store.listExternalEffectFacts(row.identity,'oar:tool-reply:')) as any[];
        const stderr=observed.filter(item=>item.kind==='raw'&&item.payload?.channel==='untrusted_stderr')
          .map(item=>clean(String(item.payload.text??''))).slice(-8);
        effects.push({effectId:row.identity.effectId,stderr,observations:observed.map(item=>({kind:item.kind,seq:item.seq,
          ...(item.kind==='finished'||item.kind==='terminal'?{payloadPreview:clean(JSON.stringify(item.payload))}:{})})),
          toolReplies:replies.map(item=>({ok:item.ok,state:item.value?.state,error:item.error?clean(String(item.error)):undefined}))});
      }
      await writeFile(path.join(evidence,'failure-boundary.json'),JSON.stringify({name:error instanceof Error?error.name:'Unknown',
        message:error instanceof Error?clean(error.message):'Unknown failure',taskId:task?.taskId,runId:task?.currentRunId,effects}),{mode:0o600});
    } catch {}
    throw error;
  } finally {
    let cleanupError:unknown;
    try {
      if(task&&!complete&&sessionId) {
        const view=await service.teamOperation(sessionId,{action:'readTask',teamId:task.teamId,taskId:task.taskId}) as any;
        if(view.execution?.resourceState!=='closed') {
          await service.teamOperation(sessionId,{action:'control',teamId:task.teamId,taskId:task.taskId,request:{
            requestId:'cleanup-read-preflight',action:'cancel',expectedEpoch:view.execution.epoch,expectedRevision:view.execution.revision}},'human');
          await waitUntil(async()=>((await service.teamOperation(sessionId,{action:'readTask',teamId:task!.teamId,taskId:task!.taskId}) as any).execution.resourceState==='closed'),20_000);
        }
      }
    } catch(error) {cleanupError=error;}
    try {
      await host.dispose();
      const closer=(service as unknown as {resourcesClosing?:Promise<void>}).resourcesClosing;
      if(!closer)throw Error('Host did not publish its original resource-closure promise');
      await closer;closed=true;
    } catch(error) {cleanupError??=error;}
    if(complete&&closed)await home.dispose();
    if(cleanupError) {
      await writeFile(path.join(evidence,'cleanup-unconfirmed.json'),JSON.stringify({
        taskId:task?.taskId,originalFailure:originalFailure instanceof Error?originalFailure.name:undefined,
        cleanupError:cleanupError instanceof Error?cleanupError.message:String(cleanupError)}));
      if(!originalFailure)throw cleanupError;
    }
  }
});
