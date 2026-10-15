// #107 L2 composition. Real Host/PG/current grants. External recall below is an
// explicitly hostile selection fixture: filtering evidence, NOT Chinese retrieval.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTeamMemoryContext, type MemoryView, type MemorySourceReader, type TeamMemoryPorts } from '@hima/harness';
import { specHost, cas, feedbackSource } from './support/issue107/host.ts';
import { publicFixture } from './support/issue107/fixture.mjs';

test('correction persists before notification, needs adoption, filters old/disabled versions and preserves fresh-task isolation', { timeout: 120_000 }, async t => {
  const f = await specHost(); t.after(() => f.dispose());
  const task = await f.start('correction-first', { goal: 'Mechanism fixture only', audience: 'Test operator', acceptance: ['Versioned facts'] });
  const ref = { projectId: task.projectId, teamId: f.saved.teamId, taskId: task.taskId };
  const human = { kind: 'human' as const, projectId: ref.projectId, actorId: await f.host.ctx.hima.durable.store.operatorIdentity() };
  const sourceReader: MemorySourceReader = { verify: async (actor, scope, sources) =>
    (await f.host.ctx.hima.durable.store.memorySources(actor, scope, sources)).map(row => row.source) };
  const store = f.host.ctx.hima.durable.store, memory = store.teamMemory(sourceReader);
  const initial = await f.memory(task, 'feedback', { requestId: 'mechanism-old', target: { kind: 'team' },
    text: '机制夹具：样例接口预算为 37 ns。', conditions: ['仅机制测试'], reason: 'Independent authored test value' }) as MemoryView;
  const claim = await memory.claimRetention(human, ref, initial.index.operationId, initial.index.revision); assert.ok(claim);
  const old = await f.memory(task, 'adopt', { requestId: 'mechanism-adopt-v1', ...cas(initial), action: 'adopted',
    reason: 'Explicit test adoption', evidenceRefs: [feedbackSource(initial)] }) as MemoryView;
  const member = await f.member(task, 'correction-active-reader');
  const replacementText = '机制夹具：样例接口预算更正为 23 ns。';
  const corrected = await f.memory(task, 'correct', { requestId: 'mechanism-correct-v2', ...cas(old), text: replacementText,
    conditions: ['仅机制测试'], reason: 'Human correction before notification', sources: [feedbackSource(initial)] }) as MemoryView;
  assert.equal(corrected.record.version, 2); assert.equal(corrected.tip.state, 'candidate'); assert.equal(corrected.index.state, 'pending');
  const persisted = await f.memory(task, 'status', { page: { limit: 20 } });
  assert.equal(persisted.records[0].record.sha256, corrected.record.sha256, 'Host reads persisted replacement before any notification');
  await assert.rejects(f.memory(task, 'adopt', { requestId: 'late-old-adoption', ...cas(old), action: 'adopted',
    reason: 'Stale old request', evidenceRefs: [feedbackSource(initial)] }), /changed|current version/i);
  const notification = await f.operation({ action: 'send-message', teamId: ref.teamId, taskId: ref.taskId,
    request: { requestId: 'versioned-correction-notice', recipientMemberIds: ['lead'], stagedAttachmentIds: [],
      text: `Correction ${corrected.record.memoryId} version ${corrected.record.version} is saved as candidate. Query current applicability before revising.` } });
  assert.ok(notification.message.messageId);
  assert.ok(notification.deliveries.every((delivery: any) => delivery.state !== 'accepted'), 'No native model is running; a saved notice is not a native receipt');
  const events = await member.call({ action: 'memory-corrections', request: { cursor: 0, limit: 20 } });
  assert.ok(events.events.some((event: any) => event.eventId === corrected.tip.eventId), 'Authorized active invocation sees the committed correction channel');
  const late = await memory.recordRetention(claim.operationId, claim.revision,
    { state: 'confirmed', nativeStatus: 'completed', confirmedAt: new Date().toISOString() });
  assert.equal(late.version, 1); assert.equal((await memory.record(human, ref, initial.record.memoryId)).tip.state, 'candidate');

  const documents = [initial.index.documentId, corrected.index.documentId];
  // Only the network response is substituted. All records, sources, versions,
  // adoption decisions and grant checks remain actual Host/application PG state.
  const ports: TeamMemoryPorts = { store: memory, sourceReader, hindsight: {
    connection: () => ({ origin: 'http://issue107-retrieval-fixture.invalid', apiKey: 'fixture', generation: 'fixture' }),
    fetch: async input => { assert.match(String(input), /\/memories\/recall$/); return Response.json({ results:
      documents.map(document_id => ({ document_id, text: 'Untrusted selection says 999 ns', type: 'experience', memory_type: 'experience' })) }); },
  } };
  const actor = { kind: 'member' as const, grant: member.issued.grant };
  const context = () => readTeamMemoryContext(ports, actor, ref, { query: '接口预算' });
  assert.deepEqual((await context()).records, [], 'Neither old corrected v1 nor unadopted v2 is applicable');
  const adopted = await f.memory(task, 'adopt', { requestId: 'mechanism-adopt-v2', ...cas(corrected), action: 'adopted',
    reason: 'Explicit current-version adoption', evidenceRefs: [feedbackSource(corrected)], conditions: ['当前任务机制夹具'] }) as MemoryView;
  const applied = (await context()).records;
  assert.equal(applied.length, 1); assert.equal(applied[0]!.record.text, replacementText);
  assert.equal(applied[0]!.record.version, 2); assert.equal(applied[0]!.tip.eventId, adopted.tip.eventId);
  assert.deepEqual(applied[0]!.appliedConditions, ['当前任务机制夹具']);
  assert.equal(applied[0]!.retrieval.excerpt, 'Untrusted selection says 999 ns', 'Retrieval prose is not authoritative record text');

  const task2Input = { request: (await publicFixture('task2'))[0]!.text };
  const next = await f.start('correction-independent-next', task2Input);
  assert.notEqual(next.taskId, task.taskId); assert.notEqual(next.currentRunId, task.currentRunId);
  const nextMember = await f.member(next, 'correction-next-reader');
  const opening = await nextMember.call({ action: 'readTask' });
  assert.equal(JSON.stringify(opening.input).includes(replacementText), false, 'No old transcript, rule or spec injected in task input');
  const unavailable = await nextMember.call({ action: 'query-memory', request: { query: '本项目接口预算有哪些已采纳纠正？' } });
  assert.deepEqual(unavailable.records, [], 'No native Hindsight here; cannot claim a successful second-task recall');
  assert.ok(unavailable.diagnostics.length > 0);
  const nextRef = { ...ref, taskId: next.taskId };
  const recalled = await readTeamMemoryContext(ports, { kind: 'member', grant: nextMember.issued.grant }, nextRef, { query: '接口预算' });
  assert.equal(recalled.records[0]?.record.text, replacementText, 'Mechanism-only selection can read authorized same-Team feedback source across Tasks');
  await f.memory(task, 'adopt', { requestId: 'mechanism-disable', ...cas(adopted), action: 'disabled', reason: 'Withdraw rule' });
  assert.deepEqual((await context()).records, []);
  assert.deepEqual((await readTeamMemoryContext(ports, { kind: 'member', grant: nextMember.issued.grant }, nextRef, { query: '接口预算' })).records, []);
  await f.memory(task, 'feedback', { requestId: 'private-do-not-copy', target: { kind: 'member', memberId: 'lead' }, text: 'Only the original lead knows this private test observation.', reason: 'Clone isolation fixture' });
  const cloned = await f.operation({ action: 'clone', teamId: ref.teamId, title: 'No private experience copied' });
  const cloneTask = await f.start('correction-cloned-next', {}, cloned.teamId);
  const cloneMember = await f.member(cloneTask, 'correction-clone-reader');
  assert.deepEqual((await cloneMember.call({ action: 'memory-status', request: { page: { limit: 20 } } })).records, []);
  await store.revokeTeamGrant(nextMember.issued.grant.grantId);
  await assert.rejects(nextMember.call({ action: 'query-memory', request: { query: '接口预算' } }), /revoked|expired/i);
});

test('late retention callback after real Host exit fence cannot create an invocation or wake a stopped task', { timeout: 90_000 }, async t => {
  const f = await specHost(); t.after(() => f.dispose());
  const task = await f.start('index-exit-task');
  const view = await f.memory(task, 'feedback', { requestId: 'index-before-exit', target: { kind: 'team' }, text: '退出补写机制夹具。', reason: 'Preserve before exit' }) as MemoryView;
  const store = f.host.ctx.hima.durable.store;
  const human = { kind: 'human' as const, projectId: task.projectId, actorId: await store.operatorIdentity() };
  const ref = { projectId: task.projectId, teamId: task.team.teamId, taskId: task.taskId };
  const sourceReader: MemorySourceReader = { verify: async (actor, scope, sources) => (await store.memorySources(actor, scope, sources)).map(row => row.source) };
  const memory = store.teamMemory(sourceReader);
  const claim = await memory.claimRetention(human, ref, view.index.operationId, view.index.revision); assert.ok(claim);
  await f.host.ctx.hima.prepareExit({ requestId: 'spec-index-exit', mode: 'stop-jobs' });
  const before = await store.flowInvocations(task.currentRunId), run = await store.run(task.currentRunId);
  assert.match(run.hold ?? '', /exit|stopp/i);
  const result = await memory.recordRetention(claim.operationId, claim.revision, { state: 'confirmed', nativeStatus: 'completed', confirmedAt: new Date().toISOString() });
  assert.equal(result.state, 'confirmed');
  assert.deepEqual(await store.flowInvocations(task.currentRunId), before, 'Index callback does not enqueue a successor');
  const after = await store.run(task.currentRunId); assert.equal(after.epoch, run.epoch); assert.equal(after.hold, run.hold);
  for (const row of before) {
    const prepared = await store.effect(row.identity.effectId);
    if (prepared) assert.deepEqual(await store.listExternalEffectFacts(prepared.identity, 'oar:local-birth:'), {}, 'No native launch after retention completion');
  }
});
