// Ordinary Node IO only; production Local runtime owns birth, receive and closure proof.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
let config;
const pending = new Map();
function request(action, value) {
  const id = randomUUID();
  const file = path.join(config.controlDirectory, 'native/requests', id + '.json');
  fs.writeFileSync(file, JSON.stringify({ id, action, request: value }), { mode: 0o600, flag: 'wx' });
  return new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      const reply = path.join(config.controlDirectory, 'replies', id + '.json');
      if (!fs.existsSync(reply)) return;
      clearInterval(poll); pending.delete(id);
      const answer = JSON.parse(fs.readFileSync(reply, 'utf8'));
      if (!answer.ok) reject(Error(answer.error)); else resolve(answer.value);
    }, 25);
    pending.set(id, poll);
  });
}
process.send({ type: 'ready' });
process.on('message', message => {
  if (message.type === 'config') {
    config = message.config;
    const data = path.join(config.controlDirectory, 'native/data');
    if (config.continuity) {
      if (config.workDirectory !== config.continuity.checkpoint.origin.cwd) throw Error('Changed continuation cwd');
      if (fs.readFileSync(path.join(data, 'context.txt'), 'utf8') !== 'human-ui-original-context\n') throw Error('Missing closed original context');
    } else fs.writeFileSync(path.join(data, 'context.txt'), 'human-ui-original-context\n');
    process.send({ type: 'created', payload: { runtime: config.prepared.runtime,
      nativeSession: config.continuity?.checkpoint.origin.nativeSession ?? 'node-human-' + config.prepared.sessionKey } });
  }
  if (message.type === 'input') void (async () => {
    process.send({ type: 'received', payload: { inputId: message.id, evidence: 'ordinary-node-actual-ipc' } });
    if (config.continuity) {
      if (!message.input.includes('human-ui-approved')) throw Error('Successor did not receive checked human result');
      process.send({ type: 'terminal', payload: { inputId: message.id, outcome: { kind: 'completed' } } });
      process.send({ type: 'finished', inputId: message.id, text: JSON.stringify({ schemaVersion: config.outputSchemaVersion,
        value: { answer: 'successor-consumed-human-ui-approved' }, artifacts: [], diagnostics: [] }) });
      return;
    }
    // A new Run in the same task must not reuse the predecessor's immutable human request identity.
    const requestId = 'human-ui-decision-' + config.prepared.identity.runId;
    const child = await request('ask-human', { requestId,
      goal: 'Approve the measured human UI answer.', input: {}, dependsOn: [], deadlineAt: config.prepared.deadlineAt,
      output: { version: 'human-answer/1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
        properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false } } });
    await request('wait', { requestId: 'human-ui-wait', delegationIds: [child.delegationId] });
  })().catch(error => process.send({ type: 'failure', reason: String(error) }));
  // Yield/stop intentionally ignored: original production Local closure observes and closes this owned process.
});
setInterval(() => {}, 1000);
