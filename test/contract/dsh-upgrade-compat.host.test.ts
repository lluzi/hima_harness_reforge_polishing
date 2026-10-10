// P02: released-session compatibility on an actual isolated Host; no model turn.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeSessionMemoryEvidence, prepareCampaignSession } from '@hima/harness';
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
