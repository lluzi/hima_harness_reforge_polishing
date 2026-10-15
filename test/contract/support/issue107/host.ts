// #107 composition support. Real Host and private PG; no fake Fabric/RunStore.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { himaSkillsDir, teamDefinition, type ActorGrant, type MemoryView, type TeamTaskView } from '@hima/harness';
import { bootInProcess, createRootAgent } from '../boot-inprocess.ts';
import { createHimaHome } from '../dsh-home.ts';
import { waitUntil } from '../fabric.ts';

export async function specDefinition() {
  return teamDefinition.parse(JSON.parse(await readFile(path.join(himaSkillsDir(), 'hima-team-spec/team.json'), 'utf8')));
}
export const cas = (view: MemoryView) => ({ memoryId: view.record.memoryId, expectedVersion: view.record.version,
  expectedRevision: view.tip.revision, supersedesEventId: view.tip.eventId });
export const feedbackSource = (view: MemoryView) => ({ kind: 'feedback' as const, eventId: view.tip.eventId, sha256: view.record.sha256 });

export async function specHost() {
  const home = await createHimaHome();
  let host: Awaited<ReturnType<typeof bootInProcess>>;
  try { host = await bootInProcess(home, { withWebApp: true }); }
  catch (error) { await home.dispose(); throw error; }
  const dispose = async () => {
    const retiring = host.ctx.hima as unknown as { resourcesClosing?: Promise<void> };
    await host.dispose();
    if (!retiring.resourcesClosing) throw new Error('Original Host resource closer was not published');
    await retiring.resourcesClosing;
    await home.dispose();
  };
  try {
    const owner = await createRootAgent(host.ctx, home.workspace), sessionId = String(owner.id);
    const operation = (request: unknown) => host.ctx.hima.teamOperation(sessionId, request, 'human') as Promise<any>;
    const template = await specDefinition();
    const saved = await operation({ action: 'save', expectedVersion: null,
      definition: { ...template, members: template.members.map(member => ({ ...member, modelRef: 'issue107-unconfigured' })) } });
    const start = async (requestId: string, input: object = {}, teamId = saved.teamId) => {
      const task = await operation({ action: 'startTask', teamId, request: { requestId, teamId, expectedVersion: 1,
        goal: 'Research supplied product materials within declared evidence.', input,
        deadlineAt: new Date(Date.now() + 240_000).toISOString(), closure: 'Retain evidence; unconfigured models prevent native execution.' } }) as TeamTaskView;
      assert.equal(task.readiness.ready, false, 'This L2 test must never start a native member or model');
      await waitUntil('persisted leader invocation', async () => (await host.ctx.hima.durable.store.flowInvocations(task.currentRunId)).length === 1, 10_000, 25);
      return task;
    };
    const stage = async (task: TeamTaskView, name: string, bytes: Uint8Array, requestId: string) => {
      const receipt = await host.ctx.get('fileUploads')!.uploadStream({ sessionId: owner.id,
        data: (async function* () { yield bytes; })(), name });
      return operation({ action: 'stage-attachment', teamId: task.team.teamId, taskId: task.taskId,
        request: { requestId, receiptId: receipt.receiptId } });
    };
    const member = async (task: TeamTaskView, grantId: string) => {
      const store = host.ctx.hima.durable.store;
      const invocation = (await store.flowInvocations(task.currentRunId))[0]!;
      const frozen = await operation({ action: 'read', teamId: task.team.teamId, version: task.team.version });
      const memberId: string = frozen.definition.leaderMemberId;
      const run = await store.run(task.currentRunId);
      const grant: ActorGrant = { grantId, actorId: memberId, memberId, projectId: task.projectId,
        teamId: task.team.teamId, taskId: task.taskId, runId: task.currentRunId, effectId: invocation.identity.effectId,
        generation: run.epoch, capabilities: ['read-task', 'read-material', 'query-memory'], expiresAt: task.deadlineAt, revokedAt: null };
      const issued = await store.issueTeamGrant(grant);
      return { issued, call: (request: unknown) => host.ctx.hima.memberTeamContext(issued.token, request) as Promise<any> };
    };
    return { home, host, owner, sessionId, operation, saved, start, stage, member,
      memory: (task: TeamTaskView, action: 'feedback'|'correct'|'adopt'|'query'|'status'|'corrections', request: unknown) =>
        host.ctx.hima.workMemory(sessionId, { teamId: task.team.teamId, taskId: task.taskId, action, request }, 'person') as Promise<any>,
      dispose };
  } catch (error) {
    try { await dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Spec Host setup and physical cleanup both failed'); }
    throw error;
  }
}
