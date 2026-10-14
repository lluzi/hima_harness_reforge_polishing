import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// Pure owned-source contracts. Does not qualify PG, DBOS replay, native members or UI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindTeamHumanRequest, validateTeamHumanResponse, delegateFlowTask, waitFlowDelegation,
  resumeTeamFlow, type TeamHumanResponse, type TeamFlowStore, type TeamDelegationAdmission } from '@hima/harness';
import { compileTeamFlow, freezeTeamDelegation } from '@hima/harness';
const { jsonDigest } = await import(new URL('../../packages/harness/lib/run-store.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/run-store.js');
import type { DurableRuntime } from '../../packages/harness/lib/types/durable-runtime.js';
import type { TeamDefinition } from '@hima/harness';
import { createTaskResult, type TaskResult } from '@hima/harness';
const { durableRunHasTeamWork } = await import(new URL('../../packages/harness/lib/host-exit.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/host-exit.js');
import type { RunStore } from '../../packages/harness/lib/types/run-store.js';

const output = { version: 'answer/1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'], additionalProperties: false } };
const identity = { requestId: 'approval-one', taskId: 'task-one', runId: 'run-one', effectId: 'human-effect', generation: 2, revision: 3,
  principalId: 'operator-one', expiresAt: '2026-10-14T00:00:00Z' };
const request = bindTeamHumanRequest({ ...identity, text: 'Approve engineering handoff?', output });
const response: TeamHumanResponse = { requestId: identity.requestId, binding: request.binding,
  output: { schemaVersion: output.version, value: { approved: true }, artifacts: [], diagnostics: [] } };

test('schema-valid human answer preserves its original content and authority tuple', () => {
  assert.deepEqual(validateTeamHumanResponse(request, response, 'operator-one', Date.parse('2026-10-13T20:00:00Z')), response.output);
  for (const field of ['requestId', 'taskId', 'runId', 'effectId', 'principalId', 'contentDigest', 'schemaDigest', 'expiresAt'] as const)
    assert.throws(() => validateTeamHumanResponse(request, { ...response, binding: { ...response.binding, [field]: 'different' } }, 'operator-one', 0), /binding/);
  for (const field of ['generation', 'revision'] as const)
    assert.throws(() => validateTeamHumanResponse(request, { ...response, binding: { ...response.binding, [field]: 8 } }, 'operator-one', 0), /binding/);
  assert.throws(() => validateTeamHumanResponse(request, response, 'impostor', 0), /authenticated operator/);
  assert.throws(() => validateTeamHumanResponse(request, response, 'operator-one', Date.parse(identity.expiresAt)), /expired/);
  assert.throws(() => validateTeamHumanResponse(request, { ...response, output: { ...response.output, value: { approved: 'yes' } } }, 'operator-one', 0), /boolean/);
  assert.throws(() => validateTeamHumanResponse({ ...request, text: 'Different decision' }, response, 'operator-one', 0), /content or schema/);
  assert.throws(() => validateTeamHumanResponse({ ...request, output: { version: 'changed', schema: {} } }, response, 'operator-one', 0), /content or schema/);
});

function fixture() {
  const definition: TeamDefinition = { schema: 'hima-team-definition/1', title: 'Team',
    members: ['lead', 'reviewer'].map(id => ({ id, role: id, runtime: id === 'lead' ? 'pi' : 'opencode', modelRef: 'default', skills: [], instructions: '', toolRefs: [], knowledgeRefs: [] })),
    leaderMemberId: 'lead', collaboration: '', delivery: { description: 'Answer', output } };
  const flow = compileTeamFlow({ kind: 'team', projectId: 'project', taskId: 'task-one', team: { teamId: 'team', version: 1, sha256: jsonDigest(definition) } }, definition);
  const delegationRequest = { requestId: 'review-one', memberId: 'reviewer', goal: 'Verify handoff', input: {}, output, dependsOn: [], deadlineAt: '2026-10-14T00:00:00Z' };
  const delegation = freezeTeamDelegation(flow, definition, 'parent-effect', delegationRequest);
  const accepted: TeamDelegationAdmission = { runId: 'run-one', owner: 'member:lead', epoch: 0, revision: 0,
    actor: { kind: 'human', actorId: 'operator-one', projectId: 'project' }, parentEffectId: 'parent-effect', delegation };
  return { definition, flow, delegationRequest, accepted };
}

test('rejected durable acceptance cannot schedule a delegation; accepted receipt is nonblocking', async () => {
  const { definition, flow, delegationRequest, accepted } = fixture();
  const events: string[] = [];
  const runtime = { applicationVersion: 'version', store: {
    run: async () => ({ applicationVersion: 'version', deadlineAt: delegationRequest.deadlineAt, opening: { data: { definition } } }),
    readTeamExecutionBinding: async () => ({ deadlineAt: delegationRequest.deadlineAt }),
    flowInvocations: async () => [{ identity: { effectId: 'parent-effect' }, context: { flow } }],
  }, startWorkflow: async (_name: string, workflowID: string) => { events.push('scheduled'); return { workflowID, getResult: async () => { throw new Error('Must not wait for child result'); } }; } } as unknown as DurableRuntime;
  const port = { acceptDelegation: async () => { events.push('accepted'); return accepted; } } as unknown as TeamFlowStore;
  const input = { runId: 'run-one', parentEffectId: 'parent-effect', actor: accepted.actor, owner: accepted.owner, epoch: 0, revision: 0, request: delegationRequest };
  const receipt = await delegateFlowTask(runtime, input, port);
  assert.equal(receipt.delegationId, accepted.delegation.delegationId); assert.deepEqual(events, ['accepted', 'scheduled']);
  events.length = 0;
  await assert.rejects(delegateFlowTask(runtime, input, { ...port, acceptDelegation: async () => { throw new Error('Stale grant'); } }), /Stale grant/);
  assert.deepEqual(events, []);
  await assert.rejects(delegateFlowTask(runtime, { ...input, request: { ...delegationRequest, deadlineAt: '2026-10-15T00:00:00Z' } }, port), /cannot extend/);
  assert.deepEqual(events, []);
});

test('handoff consumes original committed result only after proved closure, ignoring late replacement', async () => {
  const { accepted } = fixture();
  const task = Object.values(accepted.delegation.flow.tasks)[0]!;
  const result = createTaskResult({ runId: 'run-one', taskId: task.id, effectId: 'child-effect',
    inputSha256: jsonDigest({}), irSha256: accepted.delegation.flow.irSha256, applicationVersion: 'version', adapterVersion: 'hima-task-effect/2',
    source: accepted.delegation.flow.taskSource!, method: accepted.delegation.flow.method! }, task.contract,
    { schemaVersion: output.version, value: { approved: true }, artifacts: [], diagnostics: [] });
  let persisted: TaskResult | null = result, released = false;
  const runtime = { store: { flowFact: async () => ({ state: 'succeeded', committed: { [task.id]: result } }),
    effectSnapshot: async () => ({ result: persisted, resourcesReleased: released }) } } as unknown as DurableRuntime;
  const port = { readDelegations: async () => [accepted] } as unknown as TeamFlowStore;
  const read = () => waitFlowDelegation(runtime, 'run-one', accepted.delegation.delegationId, port);
  assert.equal((await read()).state, 'waiting');
  released = true; assert.deepEqual(await read(), { state: 'succeeded', result });
  persisted = { ...result, value: { approved: false } }; assert.equal((await read()).state, 'waiting');
  persisted = null; assert.equal((await read()).state, 'waiting');
  await assert.rejects(waitFlowDelegation(runtime, 'run-one', 'unaccepted', port), /accepted delegation/);
});

test('resume cannot schedule a successor that silently extends the original deadline', async () => {
  const calls: string[] = [];
  const runtime = { applicationVersion: 'version', store: { run: async (id: string) => ({ applicationVersion: 'version',
    deadlineAt: id === 'old' ? '2026-10-14T00:00:00Z' : '2026-10-15T00:00:00Z' }) },
    startWorkflow: async () => { calls.push('scheduled'); } } as unknown as DurableRuntime;
  await assert.rejects(resumeTeamFlow(runtime, { taskId: 'task', runId: 'old', requestId: 'resume-one', actor: { kind: 'human', actorId: 'human', projectId: 'project' }, expectedEpoch: 1, expectedRevision: 0 },
    { acceptTeamContinuation: async () => ({ previousRunId: 'old', currentRunId: 'new' }) }), /cannot silently extend/);
  assert.deepEqual(calls, []);
});

test('explicit continuation uses the retained successor definition and stable workflow identity', async () => {
  const { definition, flow, accepted } = fixture();
  const start = { runId: 'new', flow, runInput: { goal: 'Continue retained task', input: {}, closure: 'Return answer' }, goal: {}, strategy: {} };
  const ids: string[] = [];
  const deadlineAt=new Date(Date.now()+60000).toISOString();
  const runtime = { applicationVersion: 'version', store: {
    run: async (runId:string) => ({ runId,applicationVersion: 'version', deadlineAt, revision: 0, opening: { data: { source:flow.taskSource,definition, start } } }),
    readTeamTask:async(projectId:string,teamId:string,taskId:string)=>{assert.equal(projectId,flow.taskSource!.projectId);assert.equal(teamId,'team');assert.equal(taskId,'task-one');return {currentRunId:'new'};},
    acceptedTeamSuccessorStartAllowed:async(previousRunId:string,currentRunId:string)=>{assert.equal(previousRunId,'old');assert.equal(currentRunId,'new');return true;},
    hostExit:async()=>undefined,
    putFlowFact: async () => start,
  }, startWorkflow: async (_name: string, workflowID: string) => { ids.push(workflowID); return { workflowID }; } } as unknown as DurableRuntime;
  const input = { taskId: 'task-one', runId: 'old', requestId: 'resume', actor: accepted.actor, expectedEpoch: 0, expectedRevision: 0 };
  const port = { acceptTeamContinuation: async () => ({ previousRunId: 'old', currentRunId: 'new' }) };
  const first = await resumeTeamFlow(runtime, input, port), second = await resumeTeamFlow(runtime, input, port);
  assert.deepEqual(first, second); assert.equal(first.currentRunId, 'new');
  assert.equal(ids.length,4,'two retries observe the same deadline and root workflows');
  assert.equal(ids[0], ids[2]); assert.equal(ids[1], ids[3]);
  definition.collaboration = 'Changed after freeze';
  await assert.rejects(resumeTeamFlow(runtime, input, port), /definition/);
});

test('exit classification includes Pack delegates and actual Team invocations, preserving ordinary Pack jobs', async () => {
  const { flow } = fixture();
  let opening: unknown = { source: { kind: 'pack' }, start: { flow: { source: 'flow', tasks: { call: { teamDelegation: { id: 'delegate' } } } } } };
  let invocations: unknown[] = [];
  const store = { run: async () => ({ opening: { data: opening } }), flowInvocations: async () => invocations } as unknown as RunStore;
  assert.equal(await durableRunHasTeamWork(store, 'pack-run'), true);
  opening = { source: { kind: 'pack' }, start: { flow: { source: 'flow', tasks: {} } } };
  assert.equal(await durableRunHasTeamWork(store, 'pack-run'), false);
  invocations = [{ context: { flow } }]; assert.equal(await durableRunHasTeamWork(store, 'pack-run'), true);
});

test('pinned DBOS error replay preserves narrowly classified Team wait errors without their prototype',async()=>{
  const require=createRequire(new URL('../../packages/harness/package.json',import.meta.url));
  const codec=await import(pathToFileURL(path.join(path.dirname(require.resolve('@dbos-inc/dbos-sdk')),'serialization.js')).href) as {
    serializeResError(error:Error,serializer:undefined,format:'native'):Promise<{serializedValue:string;serialization:string}>;
    deserializeResError(value:string,format:string,serializer:undefined):Promise<Error>;
  };
  const {TeamError}=await import(new URL('../../packages/harness/lib/team-contract.js',import.meta.url).href) as typeof import('../../packages/harness/lib/types/team-contract.js');
  const {isRetryableTeamContinuationError}=await import(new URL('../../packages/harness/lib/flow-workflow.js',import.meta.url).href) as typeof import('../../packages/harness/lib/types/flow-workflow.js');
  for(const code of ['hima/team-conflict','hima/team-not-ready','hima/not-authorized'] as const){
    const original=new TeamError(code,'Original bounded waiting reason');
    const stored=await codec.serializeResError(original,undefined,'native');
    const revived=await codec.deserializeResError(stored.serializedValue,stored.serialization,undefined);
    assert.ok(revived instanceof Error);assert.equal(revived instanceof TeamError,false);
    assert.ok(isRetryableTeamContinuationError(revived));assert.equal(revived.code,code);assert.equal(revived.message,original.message);
  }
  for(const error of [new Error('Original bounded waiting reason'),{name:'TeamError',code:'hima/team-invalid',message:'Other failure'},
    {name:'OtherError',code:'hima/team-conflict',message:'Other failure'},{name:'TeamError',code:'hima/team-conflict',message:1},null,[]])
    assert.equal(isRetryableTeamContinuationError(error),false);
});
