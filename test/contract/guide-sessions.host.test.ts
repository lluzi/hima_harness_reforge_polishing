import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareCampaignSession } from '@hima/harness';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { timingProbePackId } from './support/pack.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('Guide creates one deterministic independent root and retry keeps the Guide live', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const host = await bootInProcess(home);
  try {
    const guide = await createRootAgent(host.ctx, home.workspace);
    const [first, retry] = await Promise.all([
      prepareCampaignSession(host.ctx, { guideSessionId: String(guide.id), proposalId: 'proposal-1' }),
      prepareCampaignSession(host.ctx, { guideSessionId: String(guide.id), proposalId: 'proposal-1' }),
    ]);
    assert.equal(first.created, true); assert.equal(retry.created, true); assert.equal(first.sessionId, retry.sessionId);
    const repeated = await prepareCampaignSession(host.ctx, { guideSessionId: String(guide.id), proposalId: 'proposal-1' });
    assert.equal(repeated.created, false); assert.equal(repeated.sessionId, first.sessionId);
    assert.equal(first.parentSessionId, undefined);
    assert.equal(host.ctx.get('agents')!.get(guide.id)?.status, 'idle');
    assert.equal(host.ctx.get('agents')!.isOwnedBy(first.sessionId as never, guide), false);
    assert.equal(host.ctx.get('agents')!.get(first.sessionId as never)!.session.deriveMessages().length, 0);
  } finally { await host.dispose(); }
});

test('Guide restart adopts the same independent task with its effective tools', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  let guideId: string; let taskId: string; let model: { provider: string; model: string };
  let host = await bootInProcess(home);
  try {
    const guide = await createRootAgent(host.ctx, home.workspace);
    guideId = String(guide.id); model = { provider: guide.options.provider!, model: guide.options.model! };
    const task = await prepareCampaignSession(host.ctx, { guideSessionId: guideId, proposalId: 'proposal-restart' });
    taskId = task.sessionId;
  } finally { await host.dispose(); }
  host = await bootInProcess(home);
  try {
    const guide = await resumeTestAgent(host.ctx, guideId!, model!);
    try {
      const task = await prepareCampaignSession(host.ctx, { guideSessionId: guideId!, proposalId: 'proposal-restart' });
      assert.equal(task.created, false); assert.equal(task.sessionId, taskId);
      assert.deepEqual(task.effectiveModel, model);
      assert.equal(host.ctx.get('agents')!.get(taskId! as never)?.session.header.parentSession, undefined);
    } finally { await guide.dispose(); }
  } finally { await host.dispose(); }
});

test('Guide task stays attached to the Guide registered native Workspace across restart', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 }); assert.ok(home);
  let guideId: string; let taskId: string; let workspaceId: string;
  let host = await bootHimaHost(home.h);
  try {
    const cookie = await openSession(host);
    const createWorkspace = async (rpcId: string) => {
      const response = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } } }) });
      const answer = await response.json() as { result?: { ok?: boolean; value?: { workspace?: { workspaceId?: string; sessionIds?: string[] } } } };
      assert.equal(answer.result?.ok, true, JSON.stringify(answer));
      assert.ok(answer.result?.value?.workspace?.workspaceId);
      return answer.result!.value!.workspace!;
    };
    const workspace = await createWorkspace('guide-workspace-create');
    workspaceId = workspace.workspaceId!;
    const session = await api(host, cookie, '/api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'guide-session-create', method: 'session/create', payload: { args: { request: { workspaceId } } } }) });
    const sessionAnswer = await session.json() as { result?: { ok?: boolean; value?: { sessionId?: string } } };
    assert.equal(sessionAnswer.result?.ok, true, JSON.stringify(sessionAnswer));
    guideId = sessionAnswer.result!.value!.sessionId!; assert.ok(guideId);
    const choices = await (await api(host, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`)).json() as {
      proposal: { id: string; goal: Record<string, number>; strategy: Record<string, string | number> } };
    const started = await api(host, cookie, '/hima/api/runs/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sessionId: guideId, proposalId: choices.proposal.id, pack: timingProbePackId, site: 'local', goal: choices.proposal.goal, strategy: choices.proposal.strategy,
    }) });
    const startedBody = await started.json() as { run?: { control?: { owner?: string; guideSessionId?: string } } };
    assert.equal(started.status, 200, JSON.stringify(startedBody));
    taskId = startedBody.run?.control?.owner!; assert.ok(taskId, JSON.stringify(startedBody));
    assert.equal(startedBody.run?.control?.guideSessionId, guideId);
    const after = await createWorkspace('guide-workspace-read-after-start');
    assert.deepEqual(new Set(after.sessionIds?.map(String)), new Set([guideId, taskId]));
  } finally { assert.equal(await host.stop(), 0, host.stderr()); }

  host = await bootHimaHost(home.h);
  try {
    const cookie = await openSession(host);
    const response = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'guide-workspace-after-restart', method: 'workspace/create', payload: { args: { request: { path: home.h.workspace } } } }) });
    const answer = await response.json() as { result?: { ok?: boolean; value?: { workspace?: { workspaceId?: string; sessionIds?: string[] } } } };
    assert.equal(answer.result?.ok, true, JSON.stringify(answer));
    assert.equal(answer.result?.value?.workspace?.workspaceId, workspaceId);
    assert.deepEqual(new Set(answer.result?.value?.workspace?.sessionIds?.map(String)), new Set([guideId!, taskId!]));
    const {waitUntil}=await import('./support/fabric.ts');
    let recovered=await api(host,cookie,`/hima/api/runs?sessionId=${encodeURIComponent(taskId!)}`);
    await waitUntil('Host startup reopens its recorded owner: '+host.stderr(),async()=>{recovered=await api(host,cookie,`/hima/api/runs?sessionId=${encodeURIComponent(taskId!)}`);return recovered.status===200;},5000);
    assert.equal(recovered.status,200,'Host startup reopens the recorded owner without recreating a Run');
    const recoveredBody=await recovered.json() as {runs:{id:string}[]};assert.equal(recoveredBody.runs.length,1);

  } finally { assert.equal(await host.stop(), 0, host.stderr()); await home.h.dispose(); }
});

test('a terminal Campaign boundary reaches its original Guide once without changing Run ownership',async t=>{
  const {writeMomentScenario}=await import('./support/moments.ts');
  const {writeReplayOverlay}=await import('../../packages/desktop/src/hima-home.ts');
  const {repoRoot}=await import('./support/dsh-home.ts');
  const {appendFile}=await import('node:fs/promises');const path=(await import('node:path')).default;
  const {QUIET_TITLE_ROW}=await import('./support/pipeline.ts');const {waitUntil}=await import('./support/fabric.ts');
  const h=await localHome(t,{sleepSeconds:0});assert.ok(h);
  const replay=await writeMomentScenario(h.h,'notice',path.join(repoRoot,'test/fixtures/delegation'));
  await writeReplayOverlay(h.h.home,{file:replay.file,overrideFile:replay.override,childFiles:replay.children});
  await appendFile(path.join(h.h.profileDir,'cordis.patch.yml'),QUIET_TITLE_ROW);
  process.env.HIMA_TEST_SILENT_AGENT='0';const host=await bootInProcess(h.h);
  try {
    const guide=await createRootAgent(host.ctx,h.h.workspace),owner=await createRootAgent(host.ctx,h.h.workspace);
    const started=await host.ctx.hima.startRun({pack:timingProbePackId,site:'local',goal:{target_period_ns:2},ownerSessionId:String(owner.id),guideSessionId:String(guide.id)});assert.equal(started.kind,'ran');if(started.kind!=='ran')return;
    const runId=started.run.id;const c=host.ctx.hima.executionContext(runId).run.control!;
    const req={runId,actor:String(guide.id),origin:'human' as const,action:'cancel' as const,requestId:'human-guide-stop',expectedEpoch:c.epoch,expectedRevision:c.revision};
    assert.equal((await host.ctx.hima.executionAction(req)).kind,'accepted');
    await waitUntil('terminal facts reach original Guide',()=>JSON.stringify(guide.session.deriveMessages()).includes('Hima Guide boundary'));
    await guide.whenIdle();await owner.whenIdle();
    assert.equal(host.ctx.hima.ledger.run(runId)?.status,'cancelled');
    assert.equal(host.ctx.hima.ledger.run(runId)?.control?.owner,String(owner.id));
    const before=guide.session.deriveMessages().length;
    await host.ctx.hima.executionAction(req);await guide.whenIdle();
    assert.equal(guide.session.deriveMessages().length,before,'repeated control does not repeat the Guide notice');
    assert.equal(host.ctx.hima.ledger.runs().length,1);
  }finally{process.env.HIMA_TEST_SILENT_AGENT='1';await host.dispose();await h.h.dispose();}
});
