// #105 pure compiler/schema qualification; no Host, model, native member or Site execution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { compileTeamFlow, freezeTeamDelegation, compileLegacyFlow } from '@hima/harness';
import { teamDelegationRequest, teamDelegationInput, flowSourceVersion,
  type TeamDelegationRequest, type CompiledFlow } from '@hima/harness';
import { loadPack } from '@hima/harness';
const { packContract, packGraph } = await import(new URL('../../packages/harness/lib/packs.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/packs.js');
import { taskSchemaDraft, taskSource, validateTaskInput, type TaskSource } from '@hima/harness';
import type { TeamDefinition } from '@hima/harness';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([,child])=>child!==undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
const output = { version: 'report/1', schema: { $schema: taskSchemaDraft, type: 'object',
  properties: { report: { type: 'string' } }, required: ['report'], additionalProperties: false } };
function fixture() {
  const definition: TeamDefinition = { schema: 'hima-team-definition/1', title: 'Engineering',
    members: ['lead', 'tester'].map(id => ({ id, role: id, runtime: 'pi', modelRef: 'baseline', skills: [],
      instructions: '', toolRefs: [], knowledgeRefs: [] })), leaderMemberId: 'lead', collaboration: '',
    delivery: { description: 'Deliver verified report', output } };
  const sha256 = createHash('sha256').update(canonical(definition)).digest('hex');
  const source: Extract<TaskSource, { kind: 'team' }> = { kind: 'team', projectId: 'project-one', taskId: 'task-one',
    team: { teamId: 'engineering', version: 3, sha256 } };
  const request: TeamDelegationRequest = { requestId: 'independent-test', memberId: 'tester', goal: 'Verify change',
    input: { revision: 'abc' }, output, dependsOn: [], deadlineAt: '2026-10-14T00:00:00Z' };
  return { definition, source, request, base: compileTeamFlow(source, definition) };
}

test('delegation freezes member assignment and its local contract through the same Team IR', () => {
  const { definition, request, base, source } = fixture();
  const child = freezeTeamDelegation(base, definition, 'leader-effect', request);
  const task = child.flow.tasks[child.flow.entry]!;
  assert.equal(task.memberId, 'tester'); assert.equal(task.tool, 'resident/team-member');
  assert.notEqual(task.id, base.entry); assert.equal(child.flow.source, 'team');
  assert.deepEqual(child.flow.taskSource, source); assert.deepEqual(child.flow.method, base.method);
  assert.equal(child.flow.packId, undefined); assert.equal(child.flow.packSha256, undefined);
  assert.deepEqual(task.contract.output, output);
  assert.deepEqual(task.inputs, { goal: { source: 'runInput', path: ['goal'] }, input: { source: 'runInput', path: ['input'] },
    closure: { source: 'runInput', path: ['closure'] } });
  const input = teamDelegationInput(child.request);
  assert.deepEqual(input.input, request.input); assert.equal(input.goal, request.goal);
  assert.match(input.closure, /Verify change/); assert.match(input.closure, /report\/1/);
  validateTaskInput(task.contract.input, input, child.flow.localSchemas);
  assert.ok(Object.isFrozen(child.request.input)); assert.ok(Object.isFrozen(child.flow.tasks));
  assert.deepEqual(freezeTeamDelegation(base, definition, 'leader-effect', request), child);
});

test('original member JSON and compiled resident IR preserve the pre-human shape exactly', () => {
  const { definition, request, base, source } = fixture();
  const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
  assert.equal(JSON.stringify(teamDelegationRequest.parse(request)), JSON.stringify(request));
  const delegationId = `delegation-${digest([source, base.method, 'leader-effect', request.requestId])}`;
  // Derive the original single resident task's expected IR independently of delegation freezing.
  const { irSha256: _baseDigest, ...original } = base;
  const resident = { ...base.tasks.leader!, id: delegationId,
    contract: { input: base.tasks.leader!.contract.input, output }, memberId: 'tester' };
  const data = { ...original, entry: delegationId,
    blocks: { [delegationId]: { kind: 'task', id: delegationId, taskId: delegationId } },
    tasks: { [delegationId]: resident }, taskSource:taskSource.parse(source), dependencies: { [delegationId]: [] } };
  const flow = { ...data, irSha256: digest(data) };
  const expected = { delegationId, parentEffectId: 'leader-effect', request, flow };
  const actual = freezeTeamDelegation(base, definition, 'leader-effect', request);
  assert.equal(JSON.stringify(actual), JSON.stringify({ ...expected, sha256: digest(expected) }));
});

test('formal human delegation freezes the original Team contract without a member assignment', () => {
  const { definition, request, base, source } = fixture();
  const { memberId: _memberId, ...business } = request;
  const human = teamDelegationRequest.parse({ ...business, target: 'human' });
  const child = freezeTeamDelegation(base, definition, 'leader-effect', human);
  const task = child.flow.tasks[child.flow.entry]!;
  assert.equal(task.tool, 'builtin/human-wait');
  assert.equal(Object.hasOwn(task, 'memberId'), false);
  assert.equal(Object.hasOwn(child.request, 'memberId'), false);
  assert.deepEqual(task.contract, { input: base.tasks.leader!.contract.input, output });
  assert.deepEqual(task.inputs, base.tasks.leader!.inputs);
  assert.deepEqual(child.flow.taskSource, source); assert.deepEqual(child.flow.method, base.method);
  assert.equal(child.flow.source, 'team'); assert.deepEqual(child.flow.toolIds, ['builtin/human-wait']);
  validateTaskInput(task.contract.input, teamDelegationInput(human), child.flow.localSchemas);
  assert.deepEqual(freezeTeamDelegation(base, definition, 'leader-effect', human), child);
  const member = freezeTeamDelegation(base, definition, 'leader-effect', request);
  assert.equal(child.delegationId, member.delegationId); assert.notEqual(child.sha256, member.sha256);
  assert.throws(() => freezeTeamDelegation(base, { ...definition, collaboration: 'changed' }, 'leader-effect', human), /exact saved definition/);
  assert.throws(() => freezeTeamDelegation({ ...base, irSha256: 'a'.repeat(64) }, definition, 'leader-effect', human), /exact frozen original/);
});

test('human target cannot mix with a member or unknown/caller-owned delegation fields', () => {
  const { request } = fixture();
  const { memberId: _memberId, ...business } = request;
  for (const candidate of [{ ...request, target: 'human' }, { ...business, target: 'member' },
    { ...request, target: 'member' }, { ...business, target: 'robot' }, business,
    ...['principalId', 'effectId', 'generation', 'revision'].map(key => ({ ...business, target: 'human', [key]: 'caller' }))]) {
    assert.equal(teamDelegationRequest.safeParse(candidate).success, false, JSON.stringify(candidate));
  }
});

test('identity is unique across parent/request/source and a conflicting payload preserves the identity but changes the digest', () => {
  const { definition, request, base, source } = fixture();
  const first = freezeTeamDelegation(base, definition, 'parent-one', request);
  for (const candidate of [freezeTeamDelegation(base, definition, 'parent-two', request),
    freezeTeamDelegation(base, definition, 'parent-one', { ...request, requestId: 'second' }),
    freezeTeamDelegation(compileTeamFlow({ ...source, taskId: 'other-task' }, definition), definition, 'parent-one', request)]) {
    assert.notEqual(candidate.delegationId, first.delegationId); assert.notEqual(candidate.flow.entry, first.flow.entry);
  }
  const conflict = freezeTeamDelegation(base, definition, 'parent-one', { ...request, goal: 'Different goal' });
  assert.equal(conflict.delegationId, first.delegationId); assert.notEqual(conflict.sha256, first.sha256);
  assert.throws(() => freezeTeamDelegation(base, definition, 'parent-one', { ...request, dependsOn: [first.delegationId] }), /depend on itself/);
});

test('wrong definition/member/version/digest and invalid output schema cannot become frozen child work', () => {
  const { definition, request, base } = fixture();
  assert.throws(() => freezeTeamDelegation(base, { ...definition, collaboration: 'changed' }, 'parent', request), /exact saved definition/);
  assert.throws(() => freezeTeamDelegation(base, definition, 'parent', { ...request, memberId: 'absent' }), /not in the frozen Team/);
  for (const changed of [{ ...base, version: '4' }, { ...base, method: { ...base.method!, sha256: 'a'.repeat(64) } },
    { ...base, irSha256: 'a'.repeat(64) }, { ...base, tasks: { ...base.tasks, leader: { ...base.tasks.leader!, memberId: 'tester' } } }]) {
    assert.throws(() => freezeTeamDelegation(changed as CompiledFlow, definition, 'parent', request), /exact frozen original/);
  }
  assert.throws(() => freezeTeamDelegation(base, definition, 'parent', { ...request,
    output: { version: 'bad', schema: { $schema: taskSchemaDraft, type: 'nonsense' } } }), /schema/);
  assert.throws(() => teamDelegationRequest.parse({ ...request, generation: 3 }), /Unrecognized key/);
  assert.throws(() => teamDelegationRequest.parse({ ...request, dependsOn: ['same', 'same'] }), /unique/);
  assert.throws(() => teamDelegationRequest.parse({ ...request, deadlineAt: 'tomorrow' }), /ISO datetime/);
});

async function packFixture(t: import('node:test').TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'hima-team-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'example'); await mkdir(dir);
  const contract = { id: 'example', version: '1', title: 'Team delegation', inputs: [{ name: 'design' }],
    environment: { wrappers: [] }, workspace: { copy: [] } };
  const graph = { schema: flowSourceVersion, id: 'example', version: '1', flow: { kind: 'task', id: 'team-work',
    tool: 'resident/team-delegate', contract: { input: { version: '1', schema: { $schema: taskSchemaDraft, type: 'object' } }, output }, inputs: {} } };
  const declaration = { id: 'engineering-call', nodeId: 'team-work', team: fixture().source.team };
  await writeFile(path.join(dir, 'graph.yml'), stringify(graph));
  const writeContract = (value: unknown) => writeFile(path.join(dir, 'contract.yml'), stringify(value));
  return { dir, contract, graph, declaration, writeContract };
}

test('Pack reusable Team declarations annotate the selected task and reject ambiguous/missing node identities', async t => {
  const { dir, contract, declaration, writeContract } = await packFixture(t);
  await writeContract({ ...contract, teamDelegations: [declaration] });
  const pack = loadPack(path.dirname(dir), 'example');
  assert.deepEqual(pack.flow!.tasks['team-work']!.teamDelegation, declaration);
  assert.deepEqual(pack.contract.agentTeams, []);
  for (const teamDelegations of [[declaration, declaration], [{ ...declaration, nodeId: 'absent' }],
    [{ ...declaration, team: { ...declaration.team, nativeSessionId: 'untrusted' } }]]) {
    await writeContract({ ...contract, teamDelegations });
    assert.throws(() => loadPack(path.dirname(dir), 'example'), /unique|unknown task|Unrecognized key/);
  }
  await writeContract(contract);
  assert.throws(() => loadPack(path.dirname(dir), 'example'), /declare tool resident\/team-delegate/);
});

test('ordinary versioned Packs preserve omission and require an explicit Team delegation tool choice', async t => {
  const { dir, contract, graph, declaration, writeContract } = await packFixture(t);
  await writeFile(path.join(dir, 'graph.yml'), stringify({ ...graph, flow: { ...graph.flow, tool: 'builtin/human-wait' } }));
  await writeContract(contract);
  const ordinary = loadPack(path.dirname(dir), 'example');
  assert.equal(ordinary.contract.teamDelegations, undefined);
  assert.equal(ordinary.flow!.tasks['team-work']!.teamDelegation, undefined);
  await writeContract({ ...contract, teamDelegations: [declaration] });
  assert.throws(() => loadPack(path.dirname(dir), 'example'), /must select tool resident\/team-delegate/);
});


test('retained legacy Agent Team recipes compile unchanged and new Team calls require an explicit versioned Flow', async () => {
  const archive = path.join(process.cwd(), 'packs/agentic-timing-closure-system/legacy/0.2.10');
  const contract = packContract.parse(parse(await readFile(path.join(archive, 'contract.yml'), 'utf8')));
  const graph = packGraph.parse(parse(await readFile(path.join(archive, 'graph.yml'), 'utf8')));
  assert.ok(contract.agentTeams.length > 0); assert.equal(contract.teamDelegations, undefined);
  const flow = compileLegacyFlow(graph, contract, 'a'.repeat(64));
  assert.equal(flow.source, 'legacy');
  assert.ok(Object.values(flow.tasks).every(task => task.teamDelegation === undefined));
  const stored = flow.compatibility as { contract: { agentTeams: unknown } };
  assert.deepEqual(stored.contract.agentTeams, contract.agentTeams);
  assert.throws(() => compileLegacyFlow(graph, { ...contract,
    teamDelegations: [{ id: 'call', nodeId: graph.entry, team: fixture().source.team }] }, 'a'.repeat(64)), /versioned Flow/);
});

test('delegation input is stable when persistence reorders output schema object keys',()=>{
  const {request}=fixture();
  const reordered={...request,output:{...request.output,schema:Object.fromEntries(Object.entries(request.output.schema).reverse())}};
  assert.deepEqual(reordered.output,request.output);
  assert.deepEqual(teamDelegationInput(reordered),teamDelegationInput(request),'JSON object order cannot change the retained business input');
});
