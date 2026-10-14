// #105 L2 application-PG authority only. The unavailable fixture model prevents
// native execution. No checkpoint, closure proof, released lease or DBOS kernel is mocked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileTeamFlow, freezeTeamDelegation, teamDelegationInput,
  type ActorGrant, type CompiledFlow, type TaskIdentity, type TeamDefinition, type JsonValue,
  type TeamDelegationRequest } from '@hima/harness';
import type { TeamDelegationAdmission, TeamFlowStore } from '../../packages/harness/lib/types/flow-workflow.js';
import type { FlowInvocationRecord } from '../../packages/harness/lib/types/run-store.js';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { waitUntil } from './support/fabric.ts';
import { teamFixture } from './support/himateam.ts';

const { jsonDigest } = await import(new URL('../../packages/harness/lib/run-store.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/run-store.js');

// Root owns these exact RunStore transactions; this type does not supply an implementation.
type DelegationAuthority = {
  acceptTeamDelegation: TeamFlowStore['acceptDelegation'];
  readTeamDelegations: TeamFlowStore['readDelegations'];
  teamDelegationGate: TeamFlowStore['delegationGate'];
  bindTeamDelegationEffect: TeamFlowStore['bindDelegationEffect'];
};

test('real Host/PG authenticates frozen Team delegation and fences waiting work', { timeout: 120000 }, async t => {
  const previous = { silent: process.env.HIMA_TEST_SILENT_AGENT, drive: process.env.HIMA_TEST_LEGACY_AUTO_DRIVE };
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  let home: Awaited<ReturnType<typeof createHimaHome>> | undefined;
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  t.after(async () => {
    try { await host?.dispose(); } finally {
      try { await home?.dispose(); } finally {
        for (const [key, value] of [['HIMA_TEST_SILENT_AGENT', previous.silent], ['HIMA_TEST_LEGACY_AUTO_DRIVE', previous.drive]] as const) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    }
  });
  home = await createHimaHome(); host = await bootInProcess(home);
  const ctx = host.ctx, guide = await createRootAgent(ctx, home.workspace), sessionId = String(guide.id);
  const definition: TeamDefinition = { ...teamFixture, members: [...teamFixture.members,
    { ...teamFixture.members[0]!, id: 'peer', role: 'Independent peer' }] };
  const saved = await ctx.hima.teamOperation(sessionId, { action: 'save', definition, expectedVersion: null }) as { teamId: string };
  const store = ctx.hima.durable.store;
  const authority = store as typeof store & DelegationAuthority;
  for (const name of ['acceptTeamDelegation', 'readTeamDelegations', 'teamDelegationGate', 'bindTeamDelegationEffect'] as const)
    assert.equal(typeof authority[name], 'function', `Root must integrate real RunStore.${name}`);

  async function opening(label: string) {
    const deadlineAt = new Date(Date.now() + 600000).toISOString();
    const task = await ctx.hima.teamOperation(sessionId, { action: 'startTask', teamId: saved.teamId,
      request: { requestId: `pg-${label}`, teamId: saved.teamId, expectedVersion: 1,
        goal: 'Check delegation authority without native execution', input: {}, deadlineAt,
        closure: 'Retain authorization and waiting facts; no model execution.' } }) as {
          projectId: string; taskId: string; currentRunId: string; readiness: { ready: boolean };
        };
    assert.equal(task.readiness.ready, false, 'fixture-model must be unavailable before a native member can run');
    await waitUntil('actual persisted original leader invocation', async () =>
      (await store.flowInvocations(task.currentRunId)).length === 1, 10000, 25);
    const invocation = (await store.flowInvocations(task.currentRunId))[0]!;
    const flow = (invocation.context as unknown as { flow: CompiledFlow }).flow;
    assert.equal(flow.tasks[invocation.identity.taskId]?.memberId, 'lead');
    const run = await store.run(task.currentRunId);
    // Real PG intent only; the unavailable model has not prepared or submitted native work.
    await store.prepareEffect(invocation.identity, { kind: 'unstarted-authority-fixture',
      input: (invocation.context as unknown as { input: JsonValue }).input });
    const grant: ActorGrant = { grantId: `delegate-${label}`, actorId: 'lead', memberId: 'lead',
      projectId: task.projectId, teamId: saved.teamId, taskId: task.taskId, runId: task.currentRunId,
      effectId: invocation.identity.effectId, generation: run.epoch, capabilities: ['read-task', 'delegate'],
      expiresAt: deadlineAt, revokedAt: null };
    const issued = await store.issueTeamGrant(grant);
    const request: TeamDelegationRequest = { requestId: `child-${label}`, memberId: 'peer',
      goal: 'Produce an independently checked answer', input: { observation: 'original' },
      output: definition.delivery.output, dependsOn: [], deadlineAt };
    const admission: TeamDelegationAdmission = { runId: run.runId, owner: run.owner,
      epoch: run.epoch, revision: run.revision, actor: { kind: 'member', grant: issued.grant },
      parentEffectId: invocation.identity.effectId,
      delegation: freezeTeamDelegation(flow, definition, invocation.identity.effectId, request) };
    const candidate = (change: Partial<TeamDelegationRequest>): TeamDelegationAdmission => ({ ...admission,
      delegation: freezeTeamDelegation(flow, definition, invocation.identity.effectId, { ...request, ...change }) });
    return { task, run, invocation, flow, grant: issued.grant, request, admission, candidate };
  }

  const primary = await opening('authority');
  const { admission, candidate, grant, invocation, flow, run } = primary;
  const [accepted, replay] = await Promise.all([
    authority.acceptTeamDelegation(admission), authority.acceptTeamDelegation(admission),
  ]);
  assert.deepEqual(accepted, admission);
  assert.deepEqual(replay, accepted, 'concurrent identical requests retain one acceptance');
  assert.deepEqual(await authority.readTeamDelegations(run.runId), [accepted]);
  assert.deepEqual(await authority.acceptTeamDelegation(admission), accepted, 'persisted replay retains its original identity');
  await assert.rejects(authority.acceptTeamDelegation(candidate({ goal: 'Different same-request body' })),
    /different|conflict|reused|immutable/i);

  // A second simultaneous request ID is shared by two different bodies: one wins,
  // one conflicts; the database cannot retain two accepted payloads for that ID.
  const competing = await Promise.allSettled([
    authority.acceptTeamDelegation(candidate({ requestId: 'competing-child', input: { choice: 'alpha' } })),
    authority.acceptTeamDelegation(candidate({ requestId: 'competing-child', input: { choice: 'beta' } })),
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await authority.readTeamDelegations(run.runId)).length, 2);

  const rejected = async (label: string, value: TeamDelegationAdmission) => {
    const before = await authority.readTeamDelegations(run.runId);
    await assert.rejects(authority.acceptTeamDelegation(value), label);
    assert.deepEqual(await authority.readTeamDelegations(run.runId), before, `${label} cannot change durable accepted work`);
  };
  const fresh = () => candidate({ requestId: 'rejected-child' });
  const noDelegate = await store.issueTeamGrant({ ...grant, grantId: 'read-only-leader', capabilities: ['read-task'] });
  await rejected('current grant without delegate', { ...fresh(), actor: { kind: 'member', grant: noDelegate.grant } });
  await rejected('adding delegate to a persisted read-only grant', { ...fresh(), actor: { kind: 'member',
    grant: { ...noDelegate.grant, capabilities: ['read-task', 'delegate'] } } });
  for (const [label, forged] of [
    ['unknown grant', { ...grant, grantId: 'never-issued' }],
    ['different member', { ...grant, memberId: 'peer', actorId: 'peer' }],
    ['different effect', { ...grant, effectId: 'unrelated-effect' }],
    ['different project', { ...grant, projectId: 'other-project' }],
    ['retired generation', { ...grant, generation: grant.generation + 1 }],
  ] as const) await rejected(label, { ...fresh(), actor: { kind: 'member', grant: forged } });
  const human = { kind: 'human' as const, actorId: await store.operatorIdentity(), projectId: primary.task.projectId };
  await rejected('forged human operator', { ...fresh(), actor: { ...human, actorId: 'not-the-host-operator' } });
  await rejected('human outside project', { ...fresh(), actor: { ...human, projectId: 'other-project' } });
  for (const [label, stamp] of [
    ['wrong owner', { owner: 'unrelated-owner' }], ['stale epoch', { epoch: run.epoch + 1 }],
    ['stale revision', { revision: run.revision + 1 }],
  ] as const) await rejected(label, { ...fresh(), ...stamp });
  await rejected('unknown parent', { ...fresh(), parentEffectId: 'unknown-parent' });
  const foreign = await opening('foreign-parent');
  await rejected('parent from another task', { ...fresh(), parentEffectId: foreign.invocation.identity.effectId });
  await rejected('unknown dependency', candidate({ requestId: 'unknown-dependency', dependsOn: ['never-accepted'] }));
  await rejected('effect identity cannot be a delegation dependency', candidate({ requestId: 'parent-dependency', dependsOn: [invocation.identity.effectId] }));
  await rejected('deadline cannot exceed original Run', candidate({ requestId: 'overlong-child',
    deadlineAt: new Date(Date.parse(run.deadlineAt) + 1).toISOString() }));
  await rejected('already expired child', candidate({ requestId: 'expired-child', deadlineAt: new Date(Date.now() - 1).toISOString() }));

  // Rehashing caller-supplied content cannot turn an altered immutable child into
  // original Host authority. Compile a consistent wrong source too, not just a bad hash.
  const rehash = (value: TeamDelegationAdmission['delegation']) => {
    const { sha256: _old, ...body } = value; return { ...body, sha256: jsonDigest(body) };
  };
  const bad = fresh();
  await rejected('self dependency', { ...bad, delegation: rehash({ ...bad.delegation,
    request: { ...bad.delegation.request, dependsOn: [bad.delegation.delegationId] } }) });
  await rejected('caller-selected child member', { ...bad, delegation: rehash({ ...bad.delegation,
    flow: { ...bad.delegation.flow, tasks: { ...bad.delegation.flow.tasks,
      [bad.delegation.flow.entry]: { ...bad.delegation.flow.tasks[bad.delegation.flow.entry]!, memberId: 'lead' } } } }) });
  await rejected('caller-selected child IR', { ...bad, delegation: rehash({ ...bad.delegation,
    flow: { ...bad.delegation.flow, irSha256: 'f'.repeat(64) } }) });
  assert.equal(flow.taskSource?.kind, 'team');
  if (flow.taskSource?.kind !== 'team') throw new Error('Expected actual Team source');
  const wrongSource = { ...flow.taskSource, projectId: 'other-project' };
  await rejected('consistent child compiled for another project', { ...bad,
    delegation: freezeTeamDelegation(compileTeamFlow(wrongSource, definition), definition, admission.parentEffectId, bad.delegation.request) });
  const changedDefinition = { ...definition, collaboration: 'Changed frozen business instructions' };
  const changedSource = { ...flow.taskSource, team: { ...flow.taskSource.team, sha256: jsonDigest(changedDefinition) } };
  await rejected('consistent child compiled from changed saved definition', { ...bad,
    delegation: freezeTeamDelegation(compileTeamFlow(changedSource, changedDefinition), changedDefinition, admission.parentEffectId, bad.delegation.request) });

  const waiting = await authority.teamDelegationGate(run.runId, accepted.delegation.delegationId);
  assert.equal(waiting.state, 'waiting', 'unavailable context/native closure cannot imply released capacity');
  assert.ok(waiting.reason, 'waiting must retain an honest reason');
  assert.equal((await store.effectResources(invocation.identity.effectId)).length, 0,
    'absence of a reservation is not a saved-context/native yield proof');
  const childInput = teamDelegationInput(accepted.delegation.request), childTaskId = accepted.delegation.flow.entry;
  const path = invocation.context as unknown as { iterations: unknown[]; branches: unknown[]; extensions: unknown[] };
  const childIdentity: TaskIdentity = { ...invocation.identity, taskId: childTaskId,
    inputSha256: jsonDigest(childInput), irSha256: accepted.delegation.flow.irSha256,
    effectId: `hima-effect:${jsonDigest([run.runId, accepted.delegation.flow.irSha256, childTaskId,
      path.iterations, path.branches, path.extensions, admission.revision, jsonDigest(childInput)])}` };
  assert.ok('source' in childIdentity);
  if (!('source' in childIdentity)) throw new Error('Expected Team child identity');
  for (const forged of [
    { ...childIdentity, irSha256: 'f'.repeat(64) },
    { ...childIdentity, source: wrongSource },
    { ...childIdentity, taskId: flow.entry },
    { ...childIdentity, runId: foreign.run.runId },
  ]) await assert.rejects(authority.bindTeamDelegationEffect(accepted, forged));
  await assert.rejects(authority.bindTeamDelegationEffect({ ...accepted, parentEffectId: foreign.invocation.identity.effectId }, childIdentity));
  assert.equal((await authority.teamDelegationGate(run.runId, accepted.delegation.delegationId)).state, 'waiting');

  await store.revokeTeamGrant(grant.grantId);
  await rejected('explicitly revoked current member', candidate({ requestId: 'after-revoke' }));
  assert.notEqual((await authority.teamDelegationGate(run.runId, accepted.delegation.delegationId)).state, 'ready',
    'queued accepted child cannot become dispatchable after explicit grant revocation');
  assert.deepEqual((await authority.readTeamDelegations(run.runId)).find(row =>
    row.delegation.delegationId === accepted.delegation.delegationId), accepted, 'revocation preserves original acceptance history');

  const cancelledAcceptance = await authority.acceptTeamDelegation(foreign.admission);
  await store.command({ runId: foreign.run.runId, commandId: 'cancel-queued-child', action: 'cancel',
    owner: foreign.run.owner, epoch: foreign.run.epoch, revision: foreign.run.revision, origin: 'human', actor: human.actorId });
  assert.notEqual((await authority.teamDelegationGate(foreign.run.runId, cancelledAcceptance.delegation.delegationId)).state, 'ready');
  await assert.rejects(authority.acceptTeamDelegation(foreign.candidate({ requestId: 'after-cancel' })));

  // A generous Run deadline is retained; only this child's original bound deadline expires.
  const deadline = await opening('bound-deadline');
  const expiresAt = new Date(Date.now() + 1000).toISOString();
  const short = await authority.acceptTeamDelegation(deadline.candidate({ deadlineAt: expiresAt }));
  assert.equal((await authority.teamDelegationGate(deadline.run.runId, short.delegation.delegationId)).state, 'waiting');
  await waitUntil('accepted child original bound expiry', async () => Date.now() >= Date.parse(expiresAt), 2500, 25);
  assert.notEqual((await authority.teamDelegationGate(deadline.run.runId, short.delegation.delegationId)).state, 'ready');
  assert.equal((await store.run(deadline.run.runId)).deadlineAt, deadline.run.deadlineAt);

  // Separate generic stop monotonicity falsifier, not an explanation of #104's
  // unclassified Guide timeout. This is a registered, genuinely unstarted effect:
  // confirmFlowStopped derives its own unstarted fact; no physical proof is invented.
  const stopped = await opening('unstarted-stop');
  const original: FlowInvocationRecord = stopped.invocation;
  const existingEffect = await store.effect(original.identity.effectId);
  if (!existingEffect) await store.prepareEffect(original.identity, { test: 'registered-unstarted-stop' });
  assert.equal(await store.effectDispatchExists(original.identity, 'submit'), false);
  assert.equal((await store.effectResources(original.identity.effectId)).length, 0);
  await store.confirmFlowStopped(original.identity);
  const stopFact = await store.flowFact(stopped.run.runId, `stopped:${original.identity.effectId}`);
  assert.ok(stopFact);
  const acquired = await store.reserveEffectResources(original.identity,
    { siteId: 'local-unstarted-stop', jobs: 1, licences: {} }, { jobs: 1, licences: {} });
  try { assert.equal(acquired, false, 'first resource reservation cannot revive a confirmed stopped effect'); }
  finally {
    if (acquired) {
      assert.equal(await store.effectDispatchExists(original.identity, 'submit'), false);
      await store.releaseEffectResources(original.identity, { closed: true, unstarted: true });
    }
  }
  assert.deepEqual(await store.effectResources(original.identity.effectId), [], 'stopped effect must acquire no new lease');
  assert.deepEqual(await store.flowFact(stopped.run.runId, `stopped:${original.identity.effectId}`), stopFact);
});
