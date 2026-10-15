// #106: the shipped software team method is reachable through the product Host,
// and its editable definition is accepted by the same Team contract as saved teams.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HIMA_SKILL_PROVIDER, himaSkillsDir, teamDefinition, type ActorGrant } from '@hima/harness';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { waitUntil } from './support/fabric.ts';

test('software team method loads on a real Host and its mixed-runtime definition is saveable', async () => {
  const home = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  try {
    host = await bootInProcess(home);
    const listed = await host.ctx.skills.list({ cwd: home.workspace });
    const candidate = listed.find(item => item.provider === HIMA_SKILL_PROVIDER && item.name === 'hima-team-software');
    assert.ok(candidate, 'the software method is bundled on the Host');
    assert.deepEqual(candidate.invocation, { modelInvocable: false, userInvocable: true });
    const skill = await host.ctx.skills.get('hima-team-software', { cwd: home.workspace });
    assert.ok(skill);
    assert.ok(skill.content.includes('## Develop and review'));
    assert.ok(skill.content.includes('exact head SHA'));
    const definition = teamDefinition.parse(JSON.parse(await readFile(path.join(himaSkillsDir(), 'hima-team-software', 'team.json'), 'utf8')));
    assert.equal(definition.leaderMemberId, 'lead');
    assert.deepEqual(new Set(definition.members.map(member => member.runtime)), new Set(['pi', 'opencode']));
    assert.ok(definition.members.some(member => member.id === 'developer'));
    assert.ok(definition.members.some(member => member.id === 'reviewer'));
    assert.equal(definition.delivery.output.version, 'hima-software-delivery/1');
  } finally {
    await host?.dispose();
    await home.dispose();
  }
});

test('real Host grants GitHub writes only to the human-opened exact Team task and frozen role', {timeout:60000}, async t => {
  const home=await createHimaHome();const host=await bootInProcess(home);
  t.after(async()=>{await host.dispose();await home.dispose();});
  const guide=await createRootAgent(host.ctx,home.workspace),sessionId=String(guide.id);
  const template=teamDefinition.parse(JSON.parse(await readFile(path.join(himaSkillsDir(),'hima-team-software','team.json'),'utf8')));
  const definition={...template,members:template.members.map(member=>({...member,modelRef:'unavailable-fixture'}))};
  const saved=await host.ctx.hima.teamOperation(sessionId,{action:'save',definition,expectedVersion:null}) as {teamId:string};
  const binding={repository:'lluzi/himateam_test',issueNumber:1,issueUrl:'https://github.com/lluzi/himateam_test/issues/1',
    baseCommit:'a'.repeat(40),taskBranch:'codex/issue-1'};
  const opening={requestId:'software-scope',teamId:saved.teamId,expectedVersion:1,goal:'Fix the authorized Issue',input:binding,
    deadlineAt:new Date(Date.now()+120000).toISOString(),closure:'One reviewed PR or an honest blocker'};
  await assert.rejects(host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:saved.teamId,request:opening}),/authenticated human/);
  await assert.rejects(host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:saved.teamId,request:{...opening,input:{...binding,issueUrl:'https://github.com/lluzi/himateam_test/issues/2'}}},'human'),/exact GitHub repository/);
  const task=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:saved.teamId,request:opening},'human') as {projectId:string;taskId:string;currentRunId:string;readiness:{ready:boolean}};
  assert.equal(task.readiness.ready,false,'unconfigured fixture model cannot start native work');
  const store=host.ctx.hima.durable.store;
  await waitUntil('software task leader invocation',async()=>(await store.flowInvocations(task.currentRunId)).length===1,10000,25);
  const invocation=(await store.flowInvocations(task.currentRunId))[0]!;
  await store.prepareEffect(invocation.identity,{kind:'software-boundary-fixture',input:(invocation.context as {input:unknown}).input as never});
  const run=await store.run(task.currentRunId);
  const grant:ActorGrant={grantId:'github-lead',actorId:'lead',memberId:'lead',projectId:task.projectId,teamId:saved.teamId,
    taskId:task.taskId,runId:run.runId,effectId:invocation.identity.effectId,generation:run.epoch,
    capabilities:['read-task','github-pr'],expiresAt:opening.deadlineAt,revokedAt:null};
  const issued=await store.issueTeamGrant(grant);
  await assert.rejects(store.issueTeamGrant({...grant,grantId:'forged-push',capabilities:['read-task','github-push']}),/frozen member role/);
  await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'github',request:{action:'merge'}}),/Invalid option|invalid_union|merge/);
  await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'github',request:{action:'push-task-branch'}}),/current capability/);
  await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'github',request:{action:'open-pr',testsCommit:binding.baseCommit,reviewCommit:binding.baseCommit,tests:'pass',review:'reviewed',remaining:'none'}}),/matching retained local lease/);
  const ref={teamId:saved.teamId,taskId:task.taskId};
  const supplement=await host.ctx.hima.teamOperation(sessionId,{action:'send-message',...ref,request:{
    requestId:'software-human-supplement',recipientMemberIds:['lead'],
    text:'Keep the original Issue and PR; clarify the CRLF regression test.',stagedAttachmentIds:[]}},'human') as {message:{sender:{kind:string}}};
  assert.equal(supplement.message.sender.kind,'human');
  const current=await store.run(task.currentRunId);
  await host.ctx.hima.teamOperation(sessionId,{action:'control',...ref,request:{
    requestId:'software-human-pause',action:'pause',expectedEpoch:current.epoch,expectedRevision:current.revision}},'human');
  const paused=await store.run(task.currentRunId);
  await assert.rejects(host.ctx.hima.teamOperation(sessionId,{action:'control',...ref,request:{
    requestId:'software-stale-continue',action:'continue',expectedEpoch:paused.epoch,
    expectedRevision:paused.revision}},'human'),/explicit resume/);
  const resumed=await host.ctx.hima.teamOperation(sessionId,{action:'control',...ref,request:{
    requestId:'software-human-resume',action:'resume',expectedRunId:task.currentRunId,
    expectedEpoch:paused.epoch,expectedRevision:paused.revision}},'human') as {taskId:string;input:unknown;runIds:string[];currentRunId:string};
  assert.equal(resumed.taskId,task.taskId);
  assert.deepEqual(resumed.input,binding,'human controls retain the original GitHub binding');
  assert.equal(resumed.runIds[0],task.currentRunId,'resume preserves the original task lineage');
  assert.notEqual(resumed.currentRunId,task.currentRunId,'a prepared Team effect needs a fresh Run');
  await store.revokeTeamGrant(grant.grantId);
  await assert.rejects(host.ctx.hima.memberTeamContext(issued.token,{action:'github',request:{action:'status'}}),/revoked|expired|generation/);
  const dormant=await host.ctx.hima.teamOperation(sessionId,{action:'startTask',teamId:saved.teamId,
    request:{...opening,requestId:'software-dormant'}},'human') as {taskId:string;currentRunId:string;readiness:{ready:boolean}};
  assert.equal(dormant.readiness.ready,false);
  await waitUntil('unprepared software leader invocation',async()=>(await store.flowInvocations(dormant.currentRunId)).length===1,10000,25);
  const dormantInvocation=(await store.flowInvocations(dormant.currentRunId))[0]!;
  assert.equal(await store.effect(dormantInvocation.identity.effectId),undefined);
  const dormantRun=await store.run(dormant.currentRunId);
  await host.ctx.hima.teamOperation(sessionId,{action:'control',teamId:saved.teamId,taskId:dormant.taskId,request:{
    requestId:'dormant-pause',action:'pause',expectedEpoch:dormantRun.epoch,expectedRevision:dormantRun.revision}},'human');
  const dormantPaused=await store.run(dormant.currentRunId);
  await assert.rejects(store.prepareEffect(dormantInvocation.identity,{kind:'late-team-effect'}),/Held or cancelled Team Run/);
  assert.equal(await store.effect(dormantInvocation.identity.effectId),undefined,'pause cannot materialize a late effect');
  const dormantView=await host.ctx.hima.teamOperation(sessionId,{action:'readTask',teamId:saved.teamId,
    taskId:dormant.taskId},'human') as {allowedActions:string[];resumeGate:{allowed:boolean}};
  assert.ok(!dormantView.allowedActions.includes('continue'),'a paused Team never reuses its original generation');
  assert.equal(dormantView.resumeGate.allowed,true);
  await assert.rejects(host.ctx.hima.teamOperation(sessionId,{action:'control',teamId:saved.teamId,taskId:dormant.taskId,request:{
    requestId:'dormant-continue',action:'continue',expectedEpoch:dormantPaused.epoch,
    expectedRevision:dormantPaused.revision}},'human'),/explicit resume/);
  const dormantResumed=await host.ctx.hima.teamOperation(sessionId,{action:'control',teamId:saved.teamId,taskId:dormant.taskId,request:{
    requestId:'dormant-resume',action:'resume',expectedRunId:dormant.currentRunId,
    expectedEpoch:dormantPaused.epoch,expectedRevision:dormantPaused.revision}},'human') as {currentRunId:string;runIds:string[]};
  assert.notEqual(dormantResumed.currentRunId,dormant.currentRunId);
  assert.deepEqual(dormantResumed.runIds,[dormant.currentRunId,dormantResumed.currentRunId]);
  await assert.rejects(store.prepareEffect(dormantInvocation.identity,{kind:'late-team-effect'}),/Held or cancelled Team Run|current task Run/);
  assert.equal(await store.effect(dormantInvocation.identity.effectId),undefined,'predecessor cannot materialize after a new Run');
});
