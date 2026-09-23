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
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await home.h.dispose(); }
});
