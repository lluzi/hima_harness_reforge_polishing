import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commandTaskAdapter, loadSite } from '@hima/harness';
import { bootInProcess,createRootAgent,createPresetRootAgent } from './support/boot-inprocess.ts';
import { localHome,waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';

process.env.HIMA_TEST_SILENT_AGENT='1';process.env.HIMA_TEST_LEGACY_AUTO_DRIVE='0';
test('independent Team activation uses real Host/PG/DBOS effect and replay retains one result',async t=>{
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);
  const host=await bootInProcess(home.h);try {
  const guide=await createRootAgent(host.ctx,home.h.workspace),sessionId=String(guide.id);
  const created=await host.ctx.hima.teamOperation(sessionId,{action:'save',definition:teamFixture,expectedVersion:null}) as any;
  const sitesDir=path.join(home.h.home,'hima/sites'),site=loadSite(sitesDir,'local'),workspace=path.join(site.workspaceRoot,'team-script');await mkdir(workspace,{recursive:true});
  const script=path.join(workspace,'answer.sh');await writeFile(script,'printf \'{"answer":"fixture-only fact 42"}\' > answer.json\nprintf \'submitted\\n\' >> submissions.txt\n');
  host.ctx.hima.teamExecutor={readiness:async()=>({ready:true,missing:[]}),resolve:async()=>commandTaskAdapter({sitesDir,siteId:'local',workspace,name:'Team model substitute',argv:['/bin/sh',script],collect:async(_site,_job,request)=>({schemaVersion:request.contract.output.version,value:JSON.parse(await readFile(path.join(workspace,'answer.json'),'utf8')),artifacts:[],diagnostics:[{code:'fixture',source:'test-script',message:'Mechanism only; no OAR or model qualification.'}]})})};
  const request={requestId:'script-opening',teamId:created.teamId,expectedVersion:1,goal:'Read the fixture answer',input:{},deadlineAt:new Date(Date.now()+45000).toISOString(),closure:'Return the answer and close the process.'};
  const started=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:created.teamId,request}) as any;
  const run=await host.ctx.hima.durable.store.run(started.currentRunId),data=run.opening.data as any;
  assert.equal(data.source.kind,'team');assert.equal(Object.hasOwn(data.start.flow,'packId'),false);assert.equal(Object.hasOwn(data.start.flow,'packSha256'),false);
  await waitUntil('Team result is committed',async()=>!!(await host.ctx.hima.durable.store.flowProjection(run.runId)).tasks.some((task:any)=>task.result),30000,25);
  const state=await host.ctx.hima.teamOperation(sessionId,{action:'readTask',teamId:created.teamId,taskId:started.taskId}) as any;
  const memberWork=await host.ctx.hima.teamOperation(sessionId,{action:'read-member-work',teamId:created.teamId,taskId:started.taskId,request:{memberId:'lead',page:{limit:1}}}) as any;
  assert.match(memberWork.records[0].result?.text??'',/fixture-only fact 42/);assert.match(memberWork.records[0].result?.sha256??'',/^[a-f0-9]{64}$/);
  const task=state.execution.tasks[0];assert.equal(task.result.schema,'hima-task-result/2');assert.deepEqual(task.result.value,{answer:'fixture-only fact 42'});
  assert.equal(Object.hasOwn(task.result.identity,'packSha256'),false);
  const updated=await host.ctx.hima.teamOperation(sessionId,{action:'save',teamId:created.teamId,definition:{...teamFixture,title:'Updated team'},expectedVersion:1}) as any;
  assert.equal(updated.version,2);
  const {tasks:listed}=await host.ctx.hima.teamOperation(sessionId,{action:'listTasks',teamId:created.teamId}) as {tasks:any[]};
  assert.equal(listed.length,1);assert.equal(listed[0].taskId,started.taskId);assert.equal(listed[0].team.version,1);
  assert.deepEqual(listed[0].execution.tasks[0].result.value,{answer:'fixture-only fact 42'});

  const repeated=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:created.teamId,request}) as any;assert.equal(repeated.taskId,started.taskId);assert.equal(repeated.currentRunId,started.currentRunId);
  await assert.rejects(host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:created.teamId,request:{...request,goal:'Different'}}),/different frozen content/);
  assert.equal(await readFile(path.join(workspace,'submissions.txt'),'utf8'),'submitted\n');
  const status=await host.ctx.hima.prepareExit({requestId:'team-exit',mode:'keep-jobs'});assert.ok(status);
  const exited=await host.ctx.hima.durable.store.run(run.runId);
  assert.equal(exited.hold,null,'already completed Team work needs no new active exit hold');
  const retained=await host.ctx.hima.teamOperation(sessionId,{action:'readTask',teamId:created.teamId,taskId:started.taskId}) as any;
  assert.deepEqual(retained.execution.tasks[0].result.value,{answer:'fixture-only fact 42'});
  assert.equal(await readFile(path.join(workspace,'submissions.txt'),'utf8'),'submitted\n','exit cannot replay completed Team work');
  } finally {await host.dispose();await home.h.dispose();}
});

test('Host-issued member access rejects forged scope, retired generation and revocation',async t=>{
  const home=await localHome(t,{sleepSeconds:0});assert.ok(home);const host=await bootInProcess(home.h,{withWebApp:true});
  try {
    const guide=await createPresetRootAgent(host.ctx,home.h.workspace,'standard'),sessionId=String(guide.id);
    const created=await host.ctx.hima.teamOperation(sessionId,{action:'save',definition:{...teamFixture,members:[...teamFixture.members,{...teamFixture.members[0],id:'peer',role:'Peer'}]},expectedVersion:null}) as any;
    const request={requestId:'waiting-opening',teamId:created.teamId,expectedVersion:1,goal:'Wait for qualified executor',input:{},deadlineAt:new Date(Date.now()+30000).toISOString(),closure:'Close this member.'};
    const task=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:created.teamId,request}) as any;
    assert.equal(task.readiness.ready,false);
    await waitUntil('frozen member invocation',async()=>(await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks.length===1,10000,25);
    const invocation=(await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks[0] as any;
    const grant={grantId:'grant-a',actorId:'lead',projectId:task.projectId,teamId:created.teamId,taskId:task.taskId,memberId:'lead',runId:task.currentRunId,effectId:invocation.identity.effectId,generation:0,capabilities:['read-task' as const],expiresAt:request.deadlineAt,revokedAt:null};
    await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({...grant,grantId:'past-deadline',expiresAt:new Date(Date.now()-1).toISOString()}),/deadline/);
    await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({...grant,grantId:'expanded-deadline',expiresAt:new Date(Date.now()+600000).toISOString()}),/deadline/);
    await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({...grant,grantId:'wrong-member',actorId:'peer',memberId:'peer'}),/exact.*member|assigned.*member/);
    const issued=await host.ctx.hima.durable.store.issueTeamGrant(grant);
    const context=await host.ctx.hima.memberTeamContext(issued.token,{action:'readTask'}) as any;
    assert.equal(context.actor.kind,'member');assert.equal(context.task.taskId,task.taskId);
    assert.deepEqual(context.artifactIdentity,{runId:task.currentRunId,taskId:invocation.identity.taskId,effectId:invocation.identity.effectId});
    assert.notEqual(context.artifactIdentity.taskId,context.task.taskId,'artifact identity uses the execution node, not the containing team task');
    // Explicit retained-event fixture tests projection text, not native runtime provenance.
    await host.ctx.hima.durable.store.prepareEffect(invocation.identity,{fixture:'retained projection only'});
    await host.ctx.hima.durable.store.recordExternalEffectFact(invocation.identity,'oar:observation:fixture:0',{schema:'hima-oar-observation/1',sessionKey:'fixture',generation:0,memberId:'lead',nativeSession:'fixture-native',streamGeneration:'fixture',seq:0,time:new Date().toISOString(),kind:'received',payload:{inputId:'fixture'}});
    const retained=await host.ctx.hima.teamOperation(sessionId,{action:'read-member-work',teamId:created.teamId,taskId:task.taskId,request:{memberId:'lead',page:{limit:10}}}) as any;
    assert.equal(retained.trace.state,'retained');assert.ok(retained.records.some((row:any)=>row.kind==='transcript'));
    assert.ok(retained.records.every((row:any)=>!row.text.includes('Native transcript has not been observed')));
    const base=`http://127.0.0.1:${(host.ctx.get('webServer' as never) as unknown as {port:number}).port}`;
    const memberRequest=(token:string,body:unknown,extra:Record<string,string>={})=>fetch(base+'/hima/api/member/task',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,...extra},body:JSON.stringify(body)});
    assert.equal((await memberRequest(issued.token,{action:'readTask'})).status,200,'real member-only route accepts its current capability without a human cookie');
    assert.equal((await memberRequest('forged',{action:'readTask'})).status,403);
    assert.equal((await memberRequest(issued.token,{action:'readTask',projectId:'other'})).status,400);
    assert.equal((await memberRequest(issued.token,{action:'readTask'},{origin:base})).status,403);
    assert.equal((await fetch(base+'/hima/api/teams',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+issued.token},body:JSON.stringify({sessionId,request:{action:'list'}})})).status,401,'member credential never authenticates browser/admin routes');

    await assert.rejects(host.ctx.hima.memberTeamContext('forged',{action:'readTask'}),/Unknown member/);
    await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'readTask',projectId:'other',actor:{kind:'human'}}));
    await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({...grant,grantId:'forged-effect',effectId:'unrelated'}),/exact Host member/);
    await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({...grant,grantId:'forged-project',projectId:'other'}),/does not match/);
    await host.ctx.hima.durable.store.revokeTeamGrant(grant.grantId);
    await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'readTask'}),/revoked/);
    // Operator revocation permanently fences that Run. A separate original Task
    // proves generation retirement without reissuing authority into it.
    const nextRequest={...request,requestId:'waiting-generation-opening',goal:'Wait for a separate generation',deadlineAt:new Date(Date.now()+30000).toISOString()};
    const nextTask=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:created.teamId,request:nextRequest}) as any;
    await waitUntil('second frozen member invocation',async()=>(await host.ctx.hima.durable.store.flowProjection(nextTask.currentRunId)).tasks.length===1,10000,25);
    const nextInvocation=(await host.ctx.hima.durable.store.flowProjection(nextTask.currentRunId)).tasks[0] as any;
    const second=await host.ctx.hima.durable.store.issueTeamGrant({...grant,grantId:'grant-b',projectId:nextTask.projectId,taskId:nextTask.taskId,runId:nextTask.currentRunId,effectId:nextInvocation.identity.effectId,expiresAt:nextRequest.deadlineAt});
    assert.equal((await host.ctx.hima.memberTeamContext(second.token,{action:'readTask'}) as any).task.taskId,nextTask.taskId);
    const nextRun=await host.ctx.hima.durable.store.run(nextTask.currentRunId);
    const handle=await host.ctx.hima.teamOperation(sessionId,{action:'control',teamId:created.teamId,taskId:nextTask.taskId,request:{requestId:'generation-change',action:'pause',expectedEpoch:nextRun.epoch,expectedRevision:nextRun.revision}},'human');assert.ok(handle);
    await assert.rejects(host.ctx.hima.memberTeamContext(second.token,{action:'readTask'}),/generation|held/);
    await host.ctx.hima.prepareExit({requestId:'waiting-exit',mode:'keep-jobs'});
  } finally {await host.dispose();await home.h.dispose();}
});
