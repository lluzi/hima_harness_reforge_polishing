// #107 L2. Actual provider, Team API, native uploads and member capability handlers.
// Two deliberately conflicting public demo originals; no evaluator answer injection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HIMA_PACK_SKILLS, HIMA_SKILL_PROVIDER, himaSkillsDir, validateTaskInput } from '@hima/harness';
import { specHost, specDefinition } from './support/issue107/host.ts';
import { publicFixture, sha256 } from './support/issue107/fixture.mjs';

test('functional spec method loads on the Host and saves the existing mixed-runtime Team schema', { timeout: 60_000 }, async t => {
  const f = await specHost(); t.after(() => f.dispose());
  const candidates = await f.host.ctx.skills.list({ cwd: f.home.workspace });
  const candidate = candidates.find(item => item.provider === HIMA_SKILL_PROVIDER && item.name === 'hima-team-spec');
  assert.ok(candidate, 'Apply the reviewed skills.ts registration patch in the integration batch');
  assert.deepEqual(candidate.invocation, { modelInvocable: false, userInvocable: true });
  const skill = await f.host.ctx.skills.get('hima-team-spec', { cwd: f.home.workspace }); assert.ok(skill);
  assert.ok(skill.content.includes('## 按来源研究'));
  const nativeSkill = await readFile(path.join(himaSkillsDir(), 'hima-team-spec/SKILL.md'), 'utf8');
  assert.doesNotMatch(nativeSkill.split('---', 3)[1] ?? '', /disable-model-invocation:\s*true/,
    'A selected native Pi Skill must appear in its model-visible catalog');
  assert.deepEqual([...HIMA_PACK_SKILLS], ['hima-grill', 'hima-spec', 'hima-fabric', 'hima-test', 'hima-release']);
  const pack = await f.host.ctx.skills.get('hima-spec', { cwd: f.home.workspace }); assert.ok(pack);
  const definition = await specDefinition();
  assert.deepEqual(new Set(definition.members.map(member => member.runtime)), new Set(['pi', 'opencode']));
  for (const member of definition.members) {
    assert.deepEqual(member.skills, ['hima-team-spec']); assert.deepEqual(member.toolRefs, ['hima-member-context']);
    assert.deepEqual(member.knowledgeRefs, [], 'No imaginary knowledge or role Skills');
  }
  const read = await f.operation({ action: 'read', teamId: f.saved.teamId });
  assert.equal(read.definition.delivery.output.version, 'hima-functional-spec/1');
  const example = { goal: 'Clarify missing inputs', audience: 'Developer', decision: 'insufficient-evidence',
    functionalSpec: { value: 'Avoid unsupported decisions', userBehavior: 'User supplies the missing original', inputsOutputs: 'Document in; sourced spec out',
      interfaces: 'Existing task material interface', exceptions: 'Unreadable original remains unknown', nonGoals: 'No unsupported technical capability claim' },
    sources: [], facts: [], conflicts: [], assumptions: [], openQuestions: ['Original missing'], acceptance: [{ id: 'missing-source', scenario: 'Original unavailable', expected: 'Show missing input and preserve task', sourceRefs: [] }],
    memoryRefs: [], remaining: ['Acquire source'] };
  assert.deepEqual(validateTaskInput(definition.delivery.output, example), example);
  const { exceptions: _missingException, ...missingBehavior } = example.functionalSpec;
  assert.throws(() => validateTaskInput(definition.delivery.output, { ...example, functionalSpec: missingBehavior }), /exceptions|schema|input/i,
    'A spec without error behavior is not a valid delivery');
  assert.throws(() => validateTaskInput(definition.delivery.output, { ...example, decision: 'signoff-pass' }), /decision|schema|input/i);

  const cloned = await f.operation({ action: 'clone', teamId: f.saved.teamId, title: 'Independent product research' });
  assert.notEqual(cloned.teamId, f.saved.teamId);
});

test('two conflicting originals are source-readable only after an atomic message; replay and concurrency keep one authorization', { timeout: 90_000 }, async t => {
  const f = await specHost(); t.after(() => f.dispose());
  const publicInputs = await publicFixture('task1');
  const task = await f.start('spec-source-task', { goal: 'Compare the two documents', audience: 'Product developers',
    materialRefs: [], acceptance: ['Preserve disagreements and source locators'] });
  const ref = { teamId: f.saved.teamId, taskId: task.taskId };
  const originals = publicInputs.filter(item => item.name.startsWith('document-'));
  const staged = await Promise.all(originals.map((item, index) => f.stage(task, item.name, item.bytes, `source-${index}`)));
  const member = await f.member(task, 'spec-reader');
  for (const stage of staged) await assert.rejects(member.call({ action: 'read-material', request: { stageId: stage.stageId } }), /not.*sent|unavailable|authorized/i);
  // Valid first stage followed by a nonexistent stage forces the message transaction to roll back.
  await assert.rejects(f.operation({ action: 'send-message', ...ref, request: { requestId: 'atomic-failure',
    recipientMemberIds: ['lead'], text: 'This message must roll back.', stagedAttachmentIds: [staged[0].stageId, 'missing-stage'] } }));
  for (const stage of staged) await assert.rejects(member.call({ action: 'read-material', request: { stageId: stage.stageId } }), /not.*sent|unavailable|authorized/i,
    'Failed send must leave no partial material authorization');
  const message = { requestId: 'atomic-success', recipientMemberIds: ['lead'], text: publicInputs[0]!.text,
    stagedAttachmentIds: staged.map(item => item.stageId) };
  const [first, replay] = await Promise.all([f.operation({ action: 'send-message', ...ref, request: message }), f.operation({ action: 'send-message', ...ref, request: message })]);
  assert.equal(first.message.messageId, replay.message.messageId);
  assert.deepEqual(first.message.materialRefs, replay.message.materialRefs);
  await assert.rejects(f.operation({ action: 'send-message', ...ref, request: { ...message, text: 'Changed request body' } }), /conflict|different|reused/i);
  const messages = await f.operation({ action: 'read-messages', ...ref, request: { page: { limit: 20 } } });
  assert.equal(messages.messages.filter((item: any) => item.requestId === 'atomic-success').length, 1);
  assert.equal(messages.messages.some((item: any) => item.requestId === 'atomic-failure'), false);
  const contested = { ...message, requestId: 'atomic-contested' };
  const outcomes = await Promise.allSettled([
    f.operation({ action: 'send-message', ...ref, request: { ...contested, text: 'Concurrent payload A' } }),
    f.operation({ action: 'send-message', ...ref, request: { ...contested, text: 'Concurrent payload B' } }),
  ]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(item => item.status === 'rejected').length, 1);
  const contestedPage = await f.operation({ action: 'read-messages', ...ref, request: { page: { limit: 20 } } });
  const committed = contestedPage.messages.filter((item: any) => item.requestId === contested.requestId);
  assert.equal(committed.length, 1); assert.ok(['Concurrent payload A', 'Concurrent payload B'].includes(committed[0].text));
  assert.deepEqual(committed[0].materialRefs, first.message.materialRefs, 'Concurrent conflict cannot partially change linked references');

  for (const [index, stage] of staged.entries()) {
    const material = await member.call({ action: 'read-material', request: { stageId: stage.stageId } });
    assert.equal(material.material.sha256, originals[index]!.identity.sha256); assert.equal(material.parser.status, 'parsed');
    assert.ok(material.parser.chunks.length);
    for (const chunk of material.parser.chunks) {
      const excerpt = await member.call({ action: 'read-excerpt', request: { stageId: stage.stageId, location: chunk.location } });
      assert.equal(excerpt.location, chunk.location); assert.equal(excerpt.sha256, sha256(excerpt.text));
      assert.ok(originals[index]!.text.includes(excerpt.text), 'Locator resolves to actual original content');
    }
    const bytes = await f.host.ctx.hima.teamMaterialBytes(f.sessionId, { ...ref, stageId: stage.stageId });
    const chunks: Uint8Array[] = []; for await (const chunk of bytes.stream) chunks.push(chunk);
    assert.equal(sha256(Buffer.concat(chunks)), originals[index]!.identity.sha256);
  }
  await f.host.ctx.hima.durable.store.revokeTeamGrant(member.issued.grant.grantId);
  await assert.rejects(member.call({ action: 'read-material', request: { stageId: staged[0].stageId } }), /revoked|expired/i);
});
