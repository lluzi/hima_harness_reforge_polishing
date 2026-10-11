import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession, createLiveSession } from './support/hima-api.ts';
import { teamFixture } from './support/himateam.ts';

test('real Host workspace reads are bounded, source-bound and explicit about missing member trace', { timeout: 60000 }, async t => {
  const home = await createHimaHome(); const host = await bootHimaHost(home);
  t.after(async () => { await host.stop(); await home.dispose(); });
  const cookie = await openSession(host), sessionId = await createLiveSession(host, cookie, home.workspace);
  const call = async (request: unknown) => {
    const response = await api(host, cookie, '/hima/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, request }) });
    return { status: response.status, body: await response.json() as any };
  };
  const saved = await call({ action: 'save', definition: teamFixture, expectedVersion: null }); assert.equal(saved.status, 200);
  const opened = await call({ action: 'startTask', teamId: saved.body.teamId, request: { requestId: 'workspace-opening', teamId: saved.body.teamId, expectedVersion: 1, goal: 'Read retained work', input: {}, deadlineAt: new Date(Date.now() + 120000).toISOString(), closure: 'Preserve facts.' } }); assert.equal(opened.status, 200);
  const ref = { teamId: saved.body.teamId, taskId: opened.body.taskId };
  for (const action of ['read-activity', 'read-pending-requests', 'read-member-work']) {
    const extra = action === 'read-member-work' ? { memberId: 'lead' } : {};
    const response = await call({ action, ...ref, ...extra, page: { limit: 1 } }); assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.projectId, opened.body.projectId); assert.equal(response.body.taskId, opened.body.taskId);
    assert.equal(response.body.teamId, saved.body.teamId);
    if (action === 'read-pending-requests') assert.deepEqual(response.body.requests, [], 'unavailable runtime and autoapproved ACP are not pending human requests');
    if (action === 'read-member-work') { assert.equal(response.body.memberId, 'lead'); assert.ok(['missing', 'unavailable'].includes(response.body.trace.state)); assert.equal(response.body.records.filter((value: any) => value.kind === 'transcript').length, 0); }
    assert.equal((await call({ action, ...ref, ...extra, page: { limit: 101 } })).status, 400);
    assert.equal((await call({ action, ...ref, ...extra, page: { limit: 1, cursor: -1 } })).status, 400);
  }
  assert.equal((await call({ action: 'read-member-work', ...ref, memberId: 'foreign', page: { limit: 1 } })).status, 403);
});

import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { waitUntil } from './support/fabric.ts';

test('real member bearer binds question provenance and human reply, rejects altered grants and revoked or expired access', { timeout: 60000 }, async t => {
  const home = await createHimaHome(), host = await bootInProcess(home, { withWebApp: true });
  t.after(async () => { await host.dispose(); await home.dispose(); });
  const root = await createRootAgent(host.ctx, home.workspace), sessionId = String(root.id);
  const team = await host.ctx.hima.teamOperation(sessionId, { action: 'save', definition: teamFixture, expectedVersion: null }, 'human') as any;
  const opening = { requestId: 'member-question-opening', teamId: team.teamId, expectedVersion: 1, goal: 'Preserve actual member requests', input: {}, deadlineAt: new Date(Date.now() + 120000).toISOString(), closure: 'Retain source and pending facts.' };
  const task = await host.ctx.hima.teamOperation(sessionId, { action: 'startTask', teamId: team.teamId, request: opening }, 'human') as any;
  await waitUntil('actual member invocation for capability', async () => (await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks.length > 0, 10000, 25);
  const invocation = (await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks[0] as any;
  const grant = { grantId: 'message-grant', actorId: 'lead', projectId: task.projectId, teamId: team.teamId, taskId: task.taskId, memberId: 'lead', runId: task.currentRunId, effectId: invocation.identity.effectId, generation: 0, capabilities: ['read-task' as const, 'send-message' as const], expiresAt: opening.deadlineAt, revokedAt: null };
  const issued = await host.ctx.hima.durable.store.issueTeamGrant(grant);
  const base = `http://127.0.0.1:${(host.ctx.get('webServer' as never) as unknown as { port: number }).port}`;
  const member = async (token: string, request: unknown) => {
    const response = await fetch(base + '/hima/api/member/task', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(request) });
    return { status: response.status, body: await response.json() as any };
  };
  const question = { requestId: 'member-question', recipientMemberIds: ['lead'], text: 'Which evidence should I review?', stagedAttachmentIds: [], kind: 'question' };
  const sent = await member(issued.token, { action: 'send-message', request: question }); assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.body.message.sender, { kind: 'member', actorId: grant.actorId, memberId: 'lead', runId: task.currentRunId, effectId: grant.effectId, generation: 0 });
  const ref = { teamId: team.teamId, taskId: task.taskId };
  const humanRead = async (action: string, request: unknown) => host.ctx.hima.teamOperation(sessionId, { action, ...ref, request }, 'human') as Promise<any>;
  const pending = await humanRead('read-pending-requests', { page: { limit: 10 } });
  assert.equal(pending.requests.length, 1); assert.equal(pending.requests[0].messageId, sent.body.message.messageId); assert.equal(pending.requests[0].effectId, grant.effectId); assert.equal(pending.requests[0].generation, 0);
  const work = await member(issued.token, { action: 'read-member-work', request: { memberId: 'lead', page: { limit: 1 } } });
  assert.equal(work.status, 200); assert.equal(work.body.memberId, 'lead'); assert.equal(work.body.trace.state, 'missing'); assert.equal(work.body.records[0].source, 'retained'); assert.equal(work.body.records[0].effectId, grant.effectId);
  const reply = await humanRead('send-message', { requestId: 'human-reply', recipientMemberIds: ['lead'], text: 'Review only the retained source.', stagedAttachmentIds: [], replyToMessageId: sent.body.message.messageId });
  assert.equal(reply.message.sender.kind, 'human'); assert.deepEqual((await humanRead('read-pending-requests', { page: { limit: 10 } })).requests, []);
  for (const forged of [{ ...question, actor: { kind: 'human', actorId: 'forged' } }, { ...question, projectId: 'other' }, { ...question, effectId: 'wrong' }]) {
    const response = await member(issued.token, { action: 'send-message', request: forged }); assert.ok([400, 403].includes(response.status));
  }
  assert.equal((await member('forged', { action: 'send-message', request: question })).status, 403);
  await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'wrong-effect-grant', effectId: 'wrong' }));
  await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'wrong-generation-grant', generation: 2 }));
  await assert.rejects(host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'wrong-project-grant', projectId: 'other' }));
  const expiring = await host.ctx.hima.durable.store.issueTeamGrant({ ...grant, grantId: 'expired-message-grant', expiresAt: new Date(Date.now() + 500).toISOString() });
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal((await member(expiring.token, { action: 'send-message', request: { ...question, requestId: 'expired-send' } })).status, 403);
  await host.ctx.hima.durable.store.revokeTeamGrant(grant.grantId);
  assert.equal((await member(issued.token, { action: 'send-message', request: { ...question, requestId: 'revoked-send' } })).status, 403);
  assert.equal((await humanRead('read-messages', { page: { limit: 10 } })).messages.length, 2, 'rejected grants create no message facts');
});

test('paused historical work cannot become a fresh delivery and bounded member input is redacted explicitly', async t => {
  const home=await createHimaHome();const host=await bootInProcess(home);t.after(async()=>{await host.dispose();await home.dispose();});
  const owner=await createRootAgent(host.ctx,home.workspace),sessionId=String(owner.id);
  const op=(request:unknown)=>host.ctx.hima.teamOperation(sessionId,request,'human') as Promise<any>;
  const team=await op({action:'save',definition:teamFixture,expectedVersion:null});
  const task=await op({action:'startTask',teamId:team.teamId,request:{requestId:'review-boundaries',teamId:team.teamId,expectedVersion:1,goal:'Retain bounded input',input:{apiKey:'TEST_DUMMY_SECRET',sourcePath:'/private/dummy-file',notes:'Original source: /private/embedded-dummy-file'},deadlineAt:new Date(Date.now()+120000).toISOString(),closure:'Keep original scope'}});
  const ref={teamId:team.teamId,taskId:task.taskId};
  await waitUntil('actual member invocation',async()=>(await host.ctx.hima.durable.store.flowProjection(task.currentRunId)).tasks.length>0,10000,25);
  const work=await op({action:'read-member-work',...ref,request:{memberId:'lead',page:{limit:1}}});
  assert.equal(JSON.stringify(work).includes('TEST_DUMMY_SECRET'),false);
  assert.equal(JSON.stringify(work).includes('/private/dummy-file'),false);assert.equal(JSON.stringify(work).includes('/private/embedded-dummy-file'),false);
  assert.equal(work.records[0].redacted,true);assert.equal(work.records[0].truncated,false);
  const large=await op({action:'startTask',teamId:team.teamId,request:{requestId:'review-large-input',teamId:team.teamId,expectedVersion:1,goal:'Read a bounded excerpt',input:{body:'evidence '.repeat(700)},deadlineAt:new Date(Date.now()+120000).toISOString(),closure:'Retain original input'}});
  await waitUntil('large input invocation',async()=>(await host.ctx.hima.durable.store.flowProjection(large.currentRunId)).tasks.length>0,10000,25);
  const excerpt=await op({action:'read-member-work',teamId:team.teamId,taskId:large.taskId,request:{memberId:'lead',page:{limit:1}}});
  assert.equal(excerpt.records[0].truncated,true);assert.match(excerpt.records[0].text,/input excerpt truncated/);

  const initial=await host.ctx.hima.durable.store.run(task.currentRunId);
  await op({action:'control',...ref,request:{requestId:'review-pause',action:'pause',expectedEpoch:initial.epoch,expectedRevision:initial.revision}});
  const paused=await host.ctx.hima.durable.store.run(task.currentRunId);
  await op({action:'control',...ref,request:{requestId:'review-continue',action:'continue',expectedEpoch:paused.epoch,expectedRevision:paused.revision}});
  const sent=await op({action:'send-message',...ref,request:{requestId:'review-stale-send',recipientMemberIds:['lead'],text:'A new requirement',stagedAttachmentIds:[]}});
  const actor={kind:'human' as const,actorId:await host.ctx.hima.durable.store.operatorIdentity(),projectId:task.projectId};
  const claim=await host.ctx.hima.durable.store.teamMessages().claimDelivery(actor,{projectId:task.projectId,...ref},sent.deliveries[0].deliveryId,sent.deliveries[0].revision);
  assert.equal(claim,undefined,'an original generation cannot be relabeled as a newly observed native binding');
});
