// P02: released-session compatibility on an actual isolated Host; no model turn.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeSessionMemoryEvidence, prepareCampaignSession, readWorkMemorySummary, writeWorkMemorySummary } from '@hima/harness';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { homePatchFile } from '../../packages/desktop/src/hima-home.ts';
import { constants, zstdCompressSync } from 'node:zlib';
import { bootInProcess, createRootAgent, resumeTestAgent } from './support/boot-inprocess.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { retainTitleOnly, retainUserText } from './support/p02/native-history.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';

test('native metadata alone cannot qualify a conversation summary', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const host = await bootInProcess(home);
  try {
    const guide = await createRootAgent(host.ctx, home.workspace);
    retainTitleOnly(host.ctx, guide);
    await assert.rejects(() => nativeSessionMemoryEvidence(host.ctx, { sessionId: String(guide.id), workspaceRef: home.workspace }), /no replayed transcript text/);
  } finally { await host.dispose(); }
});

test('retained native history survives restart with independent Guide and owner and an unchanged prefix identity', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  let host = await bootInProcess(home);
  try {
    const guide = await createRootAgent(host.ctx, home.workspace);
    const guideId = String(guide.id);
    const model = { provider: guide.options.provider!, model: guide.options.model! };
    retainUserText(guide, 'Retain the measured baseline; this is source material, not an accepted outcome.');
    const before = await nativeSessionMemoryEvidence(host.ctx, { sessionId: guideId, workspaceRef: home.workspace });
    const owner = await prepareCampaignSession(host.ctx, { guideSessionId: guideId, proposalId: 'p02-compat' });
    assert.equal(owner.parentSessionId, undefined);
    assert.equal(host.ctx.get('agents')!.get(owner.sessionId as never)!.session.deriveMessages().length, 0);
    await assert.rejects(() => nativeSessionMemoryEvidence(host.ctx, { sessionId: owner.sessionId, workspaceRef: home.workspace }), /no replayed transcript text/);
    await host.dispose(); host = await bootInProcess(home);
    const resumed = await resumeTestAgent(host.ctx, guideId, model);
    try {
      const after = await nativeSessionMemoryEvidence(host.ctx, { sessionId: guideId, workspaceRef: home.workspace, throughSeq: before.capturedThroughSeq });
      assert.equal(after.headerIdentity, before.headerIdentity);
      assert.equal(after.transcriptIdentity, before.transcriptIdentity);
      assert.ok(after.currentThroughSeq >= before.currentThroughSeq, 'resume may append native lifecycle events without rewriting the captured prefix');
      assert.match(JSON.stringify(resumed.agent.session.deriveMessages()), /measured baseline/);
      const reopened = await prepareCampaignSession(host.ctx, { guideSessionId: guideId, proposalId: 'p02-compat' });
      assert.equal(reopened.sessionId, owner.sessionId); assert.equal(reopened.created, false);
      assert.equal(reopened.parentSessionId, undefined);
      await assert.rejects(() => nativeSessionMemoryEvidence(host.ctx, { sessionId: guideId, workspaceRef: home.workspace, parentSessionId: owner.sessionId }), /lineage/);
      await assert.rejects(() => nativeSessionMemoryEvidence(host.ctx, { sessionId: guideId, workspaceRef: home.workspace, throughSeq: after.currentThroughSeq + 1 }), /does not retain/);
    } finally { await resumed.dispose(); }
  } finally { await host.dispose(); }
});

test('the retained DSH file attachment seam stores exact bytes across Host restart and refuses forged integrity', async (t) => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  let host = await bootInProcess(home);
  type Ref = { attachmentId: string; name: string; bytes: number };
  type Store = { saveFile(input: { data: Uint8Array; name: string }): Promise<Ref>; readFileStream(ref: Ref): AsyncIterable<Uint8Array> };
  const store = () => host.ctx.get('attachments' as never) as unknown as Store;
  const read = async (ref: Ref) => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of store().readFileStream(ref)) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  try {
    const bytes = Buffer.from('Product discussion source\nMeasured result: 17\n');
    const receipt = await store().saveFile({ data: bytes, name: 'discussion.txt' });
    assert.equal(receipt.bytes, bytes.length); assert.equal(receipt.name, 'discussion.txt');
    assert.deepEqual(await read(receipt), bytes);
    await host.dispose(); host = await bootInProcess(home);
    assert.deepEqual(await read(receipt), bytes);
    await assert.rejects(() => read({ ...receipt, bytes: receipt.bytes + 1 }), /byte|size|integrity|invalid|mismatch/i);
  } finally { await host.dispose(); }
});

// A producer may use the model's user role without claiming human authority.
test('Hima-owned messages retain their producer and bounded notice accounts', async () => {
  const { createHimaNotice, createHimaPrompt } = await import('../../packages/harness/src/hima-messages.ts');
  const text = 'Run r reached paused state.\nNo extra budget is granted.';
  const notice = createHimaNotice(text, '  A verified Run boundary\n' + 'x'.repeat(180));
  assert.equal(notice.role, 'user');
  assert.equal(notice.source.kind, 'plugin:hima');
  assert.equal(notice.source.form, 'notice');
  assert.ok(notice.source.summary.length <= 120);
  assert.ok(notice.source.summary.length > 0);
  assert.doesNotMatch(notice.source.summary, /[\r\n]/);
  assert.deepEqual(notice.content, [{ type: 'text', text }]);
  assert.ok(Object.isFrozen(notice.source));
  assert.throws(() => createHimaNotice(text, '\n \r'), /nonempty/i);
  const prompt = createHimaPrompt('A model task, not an event account.');
  assert.deepEqual(prompt.source, { kind: 'plugin:hima' });
  assert.equal(prompt.role, 'user');
});

test('released V3 native history migrates without attributing Hima context to a human or refreshing an old summary', async t => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const workspace = await realpath(home.workspace);
  const fixture = await readFile(new URL('../fixtures/dsh-upgrade/v3-history.jsonl', import.meta.url), 'utf8');
  const rows = fixture.trimEnd().split('\n').map(line => JSON.parse(line));
  const header = { ...rows[0], cwd: workspace };
  const events = rows.slice(1);
  const project = '--' + workspace.replace(/^\/+/, '').replace(/[\/\\]/g, '-') + '--';
  const directory = path.join(home.home, 'sessions', project, header.id);
  await mkdir(directory, { recursive: true });
  const oldFile = path.join(directory, 'session.v3.jsonl.zstd');
  const original = [JSON.stringify(header), ...events.map(event => JSON.stringify(event))].join('\n') + '\n';
  // Native storage owns one independent header frame, followed by event frames.
  const zstd = (text: string) => zstdCompressSync(Buffer.from(text), { params: { [constants.ZSTD_c_checksumFlag]: 1 } });
  const originalBytes = Buffer.concat([zstd(JSON.stringify(header) + '\n'), zstd(events.map(event => JSON.stringify(event)).join('\n') + '\n')]);
  await writeFile(oldFile, originalBytes);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  // The sealed V3 fixture represents the source available to a pre-upgrade writer.
  const oldEvidence: Awaited<ReturnType<typeof nativeSessionMemoryEvidence>> = { sessionId: header.id, workspaceRef: workspace,
    headerIdentity: hash({ id: header.id, createdAt: header.createdAt, cwd: workspace, parentSession: undefined, version: 3 }),
    transcriptIdentity: hash(events), surfaceAvailability: 'unavailable' as const, capturedFromSeq: 0,
    capturedThroughSeq: events.at(-1).seq, transcriptCoverage: 'retained-prefix' as const, currentThroughSeq: events.at(-1).seq };
  const host = await bootInProcess(home);
  let resumed: Awaited<ReturnType<typeof resumeTestAgent>> | undefined;
  try {
    const selection = host.ctx.get('agentDefaultModel')!.currentSelection();
    resumed = await resumeTestAgent(host.ctx, header.id, { provider: selection.provider, model: selection.model });
    const messages = resumed.agent.session.deriveMessages();
    const notice = messages.find(message => message.source.kind === 'plugin:hima');
    assert.ok(notice, 'the actual native migration owns the historical producer conversion');
    assert.deepEqual(notice.content, events.find(event => event.type === 'user/message' && event.data.source.kind === 'plugin' && event.data.source.plugin === 'hima').data.content);
    assert.equal(messages.filter(message => message.role === 'user' && message.source.kind === 'user').length, 1);
    const tool = messages.find(message => message.role === 'tool');
    assert.ok(tool);
    const originalTool = events.find(event => event.type === 'tool/result').data.message;
    assert.equal(tool.id, originalTool.id);
    assert.equal(tool.toolCallId, originalTool.source.callId);
    assert.equal(tool.source.callId, originalTool.source.callId);
    assert.deepEqual(tool.content, originalTool.content[0].content);
    const after = await nativeSessionMemoryEvidence(host.ctx, { sessionId: header.id, workspaceRef: workspace, throughSeq: oldEvidence.capturedThroughSeq });
    assert.notEqual(after.headerIdentity, oldEvidence.headerIdentity);
    assert.notEqual(after.transcriptIdentity, oldEvidence.transcriptIdentity);
    assert.deepEqual(await readFile(oldFile), originalBytes, 'the immutable original V3 generation remains intact');
    const { workspaceRef: _workspace, currentThroughSeq: _current, ...historicalSource } = oldEvidence;
    const summary = { schema: 'hima-work-memory/1', scope: { kind: 'session' as const, workspaceRef: workspace, sessionId: header.id },
      subject: 'Historical decision', decisions: ['Retain the measured source.'], openQuestions: [], todo: [], references: [], sources: [],
      nativeSources: [historicalSource], generatedAt: new Date(events.at(-1).time + 1).toISOString(), modelGenerated: true };
    // Seed the historical summary through its public writer with the declared old-source boundary.
    await writeWorkMemorySummary(host.ctx.hima.ledger, workspace, summary, async request => {
      assert.equal(request.sessionId, header.id); assert.equal(request.throughSeq, oldEvidence.capturedThroughSeq);
      return oldEvidence;
    });
    const retained = await readWorkMemorySummary(host.ctx.hima.ledger, workspace, summary.scope, request => nativeSessionMemoryEvidence(host.ctx, request));
    assert.equal(retained.kind, 'stale', JSON.stringify(retained));
    if (retained.kind === 'stale') assert.match(retained.reason, /changed/);
  } finally { await resumed?.dispose(); await host.dispose(); }
});

test('new native boot keeps the strict optional-entry gate and restores ownership after rejection', async t => {
  const home = await createHimaHome(); t.after(() => home.dispose());
  const before = { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED };
  const patch = homePatchFile(home.home);
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'p02-optional-missing', name: './p02-missing-plugin.mjs' }] }]));
  let unexpected: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  try { await assert.rejects(async () => { unexpected = await bootInProcess(home); }, /Hima strict startup.*|p02-missing-plugin/s); }
  finally { await unexpected?.dispose(); }
  assert.deepEqual({ DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME, DSH_TELEMETRY_DISABLED: process.env.DSH_TELEMETRY_DISABLED }, before);
  // The exact optional import is allowed only when explicitly disabled.
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'p02-optional-missing', name: './p02-missing-plugin.mjs', disabled: true }] }]));
  const recovered = await bootInProcess(home);
  try { assert.ok(recovered.ctx.hima, 'subsequent real Host activation owns the intact Hima bundle'); }
  finally { await recovered.dispose(); }
});
