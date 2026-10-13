// Mechanism fixture only: no OAR/native model runtime, Host process or L4 qualification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OarMemberPort, OarObservation, OarPrepared } from '../../packages/harness/lib/types/oar-task-adapter.js';
import type { JsonValue, TaskToolOutput } from '../../packages/harness/lib/types/task-contract.js';
import type { TaskEffectRequest } from '../../packages/harness/lib/types/task-effects.js';
const lib = process.env.HIMA_DBOS_TEST_LIB ?? path.resolve('packages/harness/lib');
const { oarTaskAdapter } = await import(pathToFileURL(path.join(lib, 'oar-task-adapter.js')).href);
const { taskSchemaDraft } = await import(pathToFileURL(path.join(lib, 'task-contract.js')).href);
const request: TaskEffectRequest = {
  identity: { runId: 'run-one', taskId: 'task-one', effectId: 'effect-one', inputSha256: 'a'.repeat(64),
    packSha256: 'b'.repeat(64), irSha256: 'c'.repeat(64), applicationVersion: 'app-test', adapterVersion: 'hima-task-effect/2' },
  admission: { runId: 'run-one', effectId: 'effect-one', owner: 'owner', epoch: 3, revision: 1 },
  input: { question: 'inspect exact evidence' },
  contract: {
    input: { version: 'input/1', schema: { $schema: taskSchemaDraft, type: 'object' } },
    output: { version: 'output/1', schema: { $schema: taskSchemaDraft, type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } },
  },
};
const output: TaskToolOutput = { schemaVersion: 'output/1', value: { answer: 'measured' }, artifacts: [], diagnostics: [] };
function fixture(runtime: 'pi' | 'opencode' = 'pi') {
  const events: string[] = [];
  let observed: OarObservation = { state: 'unknown', reason: 'queue ACK alone proves no native receipt' };
  let messageReceived = false;
  let closing = false;
  const port: OarMemberPort = {
    async stage(prepared, fence) { await fence(); events.push(`stage:${prepared.sessionKey}`); },
    async submit(prepared, fence) { await fence(); events.push(`submit:${prepared.inputId}`); return { queued: true }; },
    async observe() { return observed; },
    async permit() { return true; },
    async close(_prepared, _receipt, fence) {
      if (!closing) return { closed: false, reason: 'original native process still held' };
      if (fence && !await fence('close-original', { sessionKey: _prepared.sessionKey })) return { closed: false, reason: 'cleanup fence denied' };
      return { closed: true, proof: { sessionKey: _prepared.sessionKey, closed: true } };
    },
    async send(_prepared, id, input, fence) { await fence(); events.push(`message:${id}`); if (!messageReceived) throw new Error('native reception unknown'); return { received: true, id, input }; },
    async observeMessage(_prepared, id, input) { return messageReceived ? { received: true, id, input } : undefined; },
  };
  const adapter = oarTaskAdapter({ member: { id: 'researcher', runtime, modelRef: `model-${runtime}`, role: 'research', skills: ['inspect'], instructions: 'Keep the complete context.', toolRefs: ['tools'], knowledgeRefs: [] },
    deadlineAt: '2026-12-01T00:00:00Z', projectId: 'project-one', port,
    resources: { siteId: 'site-one', jobs: 1, licences: {} }, capacity: { jobs: 2, licences: {} } });
  return { adapter, events, ready(value: TaskToolOutput = output) { observed = { state: 'ready', receipt: { nativeSession: 'same-native-session' }, output: value }; },
    running() { observed = { state: 'running', reason: 'native task accepted' }; },
    received() { messageReceived = true; }, closed() { closing = true; } };
}
for (const runtime of ['pi', 'opencode'] as const) test(`OAR ${runtime} preparation is pure and deterministic with frozen exact context`, async () => {
  const f = fixture(runtime), prepared = await f.adapter.prepare(request), again = await f.adapter.prepare(structuredClone(request));
  assert.deepEqual(prepared, again); assert.deepEqual(f.events, []);
  const fixed = prepared as unknown as OarPrepared;
  assert.equal(fixed.runtime, runtime); assert.equal(fixed.modelRef, `model-${runtime}`); assert.equal(fixed.generation, 3);
  assert.ok(fixed.prompt.includes('Keep the complete context.')); assert.ok(fixed.prompt.includes(JSON.stringify(request.input)));
  assert.ok(fixed.prompt.includes(JSON.stringify(request.contract.output))); assert.ok(fixed.prompt.includes('subagents'));
  const envelope=JSON.parse(fixed.prompt.split('TaskToolOutput envelope schema (JSON):\n')[1]!.split('\n')[0]!);
  const artifactIdentity=JSON.parse(fixed.prompt.split('Artifact identity: copy these three fields exactly into every artifact (JSON):\n')[1]!.split('\n')[0]!);
  assert.deepEqual(artifactIdentity,{runId:request.identity.runId,taskId:request.identity.taskId,effectId:request.identity.effectId});
  assert.deepEqual(envelope.required,['schemaVersion','value','artifacts','diagnostics']);
  assert.deepEqual(envelope.properties.artifacts.items.required,['runId','taskId','effectId','name','path','sha256']);
  assert.ok(fixed.prompt.includes(`Set schemaVersion to ${JSON.stringify(request.contract.output.version)}`));
  const other = await f.adapter.prepare({ ...request, identity: { ...request.identity, effectId: 'effect-two' }, admission: { ...request.admission, effectId: 'effect-two' } });
  assert.notEqual((other as unknown as OarPrepared).sessionKey, fixed.sessionKey);
});
test('OAR queue ACK remains unknown and actual stage/send use the supplied admission fences', async () => {
  const f = fixture(), p = await f.adapter.prepare(request);
  await assert.rejects(f.adapter.stage!(p, async () => { throw new Error('held'); }), /held/);
  await assert.rejects(f.adapter.submit(p, async () => { throw new Error('revoked'); }), /revoked/);
  assert.deepEqual(f.events, []);
  await f.adapter.stage!(p, async () => { f.events.push('stage-fenced'); });
  const receipt = await f.adapter.submit(p, async () => { f.events.push('submit-fenced'); });
  const tampered = { ...(p as Record<string, JsonValue>), sessionKey: 'another-session' };
  await assert.rejects(f.adapter.submit(tampered, async () => {}), /frozen effect identity/);
  assert.equal(f.events[0], 'stage-fenced'); assert.equal(f.events[2], 'submit-fenced');
  assert.equal((await f.adapter.reconcile(p, receipt)).state, 'unknown');
  f.running(); assert.equal((await f.adapter.reconcile(p, receipt)).state, 'running');
});
test('OAR exact output is collected only for original identity/input/generation and retained closure is independent', async () => {
  const f = fixture(), p = await f.adapter.prepare(request); f.ready();
  const observation = await f.adapter.reconcile(p, undefined); assert.equal(observation.state, 'ready');
  if (observation.state !== 'ready') throw new Error('fixture was not ready');
  const retained = observation.receipt;
  assert.deepEqual(await f.adapter.collect(p, retained, request), output);
  await assert.rejects(f.adapter.collect(p, retained, { ...request, admission: { ...request.admission, epoch: 4 } }), /generation/);
  await assert.rejects(f.adapter.collect(p, retained, { ...request, input: { question: 'different bytes' } }), /identity, input/);
  for (const key of ['generation', 'sessionKey', 'inputId', 'identity'] as const) {
    const altered = structuredClone(retained) as Record<string, JsonValue>;
    altered[key] = key === 'generation' ? 4 : key === 'identity' ? { ...request.identity, effectId: 'other' } : 'other';
    await assert.rejects(f.adapter.collect(p, altered, request), /another session\/input\/generation/);
  }
  assert.equal((await f.adapter.release(p, retained)).closed, false);
  f.closed(); let cleanup = false;
  assert.equal((await f.adapter.stop!(p, retained, async () => { cleanup = true; return true; })).closed, true); assert.equal(cleanup, true);
  f.ready({ ...output, value: { answer: 12 } });
  const malformed = await f.adapter.reconcile(p, undefined); if (malformed.state !== 'ready') throw new Error('fixture was not ready');
  await assert.rejects(f.adapter.collect(p, malformed.receipt, request), /output/);
});
test('OAR message ACK loss reconciles exact id/input without claiming queue-only reception', async () => {
  const f = fixture(), p = await f.adapter.prepare(request);
  await assert.rejects(f.adapter.message!(p, 'message-one', 'new evidence', async () => { throw new Error('stale'); }), /stale/);
  assert.deepEqual(f.events, []);
  await assert.rejects(f.adapter.message!(p, 'message-one', 'new evidence', async () => {}), /unknown/);
  assert.equal(await f.adapter.reconcileMessage!(p, 'message-one', 'new evidence'), undefined);
  f.received(); assert.deepEqual(await f.adapter.reconcileMessage!(p, 'message-one', 'new evidence'), { received: true, id: 'message-one', input: 'new evidence' });
  assert.equal(f.events.length, 1);
});
