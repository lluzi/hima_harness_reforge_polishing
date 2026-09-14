// PLS-30: offline PDF/current-knowledge indexing and source-linked Ledger use. No model, Desktop,
// network or EDA process is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { copyFile, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { installPack, packsDirOf, timingProbePackId } from './support/pack.ts';
import { localHome } from './support/fabric.ts';
import { clearCurrentKnowledge, importCurrentKnowledge, indexKnowledgeDocument, listCurrentKnowledge,
  packDigestOf, readCurrentKnowledge, recordDocumentKnowledgeRead, searchCurrentKnowledge } from '@hima/harness';

// These cases prove the visible Campaign-owner path, never the legacy automatic fixture mode.
process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';

const fixture = path.join(repoRoot, 'test/fixtures/knowledge/eda-clock-guide.pdf');

test('a PDF is indexed offline into bounded page-cited excerpts and search reads the exact excerpt', async () => {
  const indexed = await indexKnowledgeDocument({ file: fixture, scope: 'fixture', source: 'current', title: 'EDA Timing Preparation Guide', version: '1' });
  assert.equal(indexed.document.mediaType, 'application/pdf');
  assert.ok(indexed.chunks.length > 0);
  assert.ok(indexed.chunks.every((chunk) => chunk.page === 1 && chunk.text.length <= 2_400));
  const h = await createHimaHome();
  try {
    const root = path.join(h.home, 'hima/current-knowledge');
    const imported = await importCurrentKnowledge({ root, scope: 'workspace-a', file: fixture, title: 'EDA Timing Preparation Guide', version: '1' });
    assert.equal((await stat(imported.document.sourcePath)).isFile(), true, 'the durable identity names the source after atomic publication');
    const hits = await searchCurrentKnowledge(root, 'workspace-a', 'custom cell adopted final routed database');
    assert.ok(hits.length > 0);
    assert.equal(hits[0]?.document.id, imported.document.id);
    assert.equal(hits[0]?.page, 1);
    assert.match(hits[0]?.snippet ?? '', /effective instance/);
    const read = await readCurrentKnowledge(root, 'workspace-a', imported.document.id, hits[0]!.id);
    assert.equal(read.sha256, hits[0]?.sha256);
    assert.deepEqual(await listCurrentKnowledge(root, 'workspace-b'), [], 'another workspace cannot see this current document');
  } finally { await h.dispose(); }
});

test('current knowledge rejects symlink ancestors and index/source tampering before list, read or clear', async () => {
  const h = await createHimaHome();
  try {
    const root = path.join(h.home, 'hima/current-knowledge');
    const source = path.join(h.home, 'guide.txt');
    await writeFile(source, 'clock uncertainty comes from the actual routed database');
    const imported = await importCurrentKnowledge({ root, scope: 'isolated', file: source });
    const indexAt = path.join(path.dirname(imported.document.sourcePath), 'index.json');
    await writeFile(indexAt, '{ damaged derived cache');
    assert.equal((await listCurrentKnowledge(root, 'isolated'))[0]?.id, imported.document.id,
      'a damaged derived index is rebuilt from the owned source and independent metadata');
    assert.match(await readFile(indexAt, 'utf8'), /hima-knowledge-index\/1/);
    const sourceText = await readFile(imported.document.sourcePath, 'utf8');
    await writeFile(imported.document.sourcePath, `${sourceText} changed after indexing`);
    await assert.rejects(() => listCurrentKnowledge(root, 'isolated'), /source bytes do not match/);

    const scopeDir = path.dirname(path.dirname(imported.document.sourcePath));
    const outside = path.join(h.home, 'outside');
    await mkdir(outside);
    await rm(imported.document.sourcePath);
    await symlink(source, imported.document.sourcePath);
    await assert.rejects(() => readCurrentKnowledge(root, 'isolated', imported.document.id, `${imported.document.id}:0`), /symbolic link/);
    await rm(scopeDir, { recursive: true, force: true });
    await symlink(outside, scopeDir);
    await assert.rejects(() => clearCurrentKnowledge(root, 'isolated', imported.document.id), /symbolic link/);
  } finally { await h.dispose(); }
});

test('Campaign-attached document evidence is bound to one owner execution and its reviewed proposal scope', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const other = await createRootAgent(host.ctx, home.h.workspace);
    let serial = 0;
    const invoke = async (agent: typeof owner, args: Record<string, unknown>) => host.ctx.tools.execute({
      name: 'hima_knowledge', arguments: args, agent, callId: `bound-knowledge-${++serial}` as never, signal: AbortSignal.timeout(20_000),
    });
    const product = async (name: 'hima_prepare' | 'hima_run', args: Record<string, unknown>) => host.ctx.tools.execute({
      name, arguments: args, agent: owner, callId: `bound-product-${++serial}` as never, signal: AbortSignal.timeout(20_000),
    });
    const source = path.join(home.h.workspace, 'guide.pdf');
    await copyFile(fixture, source);
    const prepared = await product('hima_prepare', { pack: timingProbePackId, site: 'local' });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const proposal = JSON.parse(prepared.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.equal(proposal.ready, true);
    const importedAnswer = await invoke(owner, { action: 'import', source: 'current', scope: proposal.id, file: source });
    assert.equal(importedAnswer.isError, false, JSON.stringify(importedAnswer));
    const imported = JSON.parse(importedAnswer.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    const searchedAnswer = await invoke(owner, { action: 'search', source: 'current', scope: proposal.id, query: 'final routed database' });
    const searched = JSON.parse(searchedAnswer.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    const started = await product('hima_run', { proposalId: proposal.id, pack: timingProbePackId, site: 'local', goal: proposal.goal, strategy: proposal.strategy });
    assert.equal(started.isError, false, JSON.stringify(started));
    const run = JSON.parse(started.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.equal(run.kind, 'ran', JSON.stringify(run));
    const control = host.ctx.hima.ledger.run(run.runId)!.control!;
    const begun = await host.ctx.hima.executionAction({ runId: run.runId, actor: String(owner.id), expectedEpoch: control.epoch,
      expectedRevision: control.revision, requestId: 'knowledge-begin', action: 'begin', nodeId: host.ctx.hima.ledger.run(run.runId)!.currentNode });
    assert.equal(begun.kind, 'accepted');
    const execution = begun.context.executions.find((item) => item.id === begun.receipt?.executionId)!;
    const readArgs = { action: 'read', source: 'current', scope: proposal.id, run: run.runId,
      documentId: imported.document.id, chunkId: searched.hits[0].id };
    const read = await invoke(owner, readArgs);
    assert.equal(read.isError, false, JSON.stringify(read));
    const record = host.ctx.hima.ledger.records({ runId: run.runId, type: 'knowledge' }).find((item) => item.type === 'knowledge');
    assert.ok(record?.type === 'knowledge');
    assert.equal(record.attempt, execution.attempt);
    assert.equal(record.generation, execution.generation);
    assert.equal(record.nodeId, execution.nodeId);
    assert.ok(record.conditions?.some((condition) => /current Campaign conclusions still require current execution evidence/.test(condition)));
    const nonowner = await invoke(other, readArgs);
    assert.equal(nonowner.isError, true);
    assert.match(JSON.stringify(nonowner.content), /owning Campaign Agent/);
    const crossScope = await invoke(owner, { ...readArgs, scope: '0'.repeat(64) });
    assert.equal(crossScope.isError, true);
    assert.match(JSON.stringify(crossScope.content), /full, current HimaGuide Campaign proposal token/);
    await host.ctx.hima.ledger.advanceRun(run.runId, { status: 'ended-goal-met' });
    const ended = await invoke(owner, readArgs);
    assert.equal(ended.isError, true);
    assert.match(JSON.stringify(ended.content), /active writable Campaign/);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('current knowledge survives Host restart, records the excerpt that reached a Campaign, clears explicitly, and never changes the Pack digest', async () => {
  const h = await createHimaHome();
  const root = path.join(h.home, 'hima/current-knowledge');
  await installPack(h);
  const before = packDigestOf(path.join(packsDirOf(h), timingProbePackId));
  const imported = await importCurrentKnowledge({ root, scope: 'campaign-proposal', file: fixture, title: 'EDA Timing Preparation Guide', version: '1' });
  assert.equal(packDigestOf(path.join(packsDirOf(h), timingProbePackId)), before);
  let host = await bootInProcess(h);
  try {
    const run = await host.ctx.hima.ledger.createRun({ campaignId: 'knowledge-fixture', siteId: 'local', packId: timingProbePackId, status: 'running' });
    const [hit] = await searchCurrentKnowledge(root, 'campaign-proposal', 'clock uncertainty baseline custom-cell arm');
    assert.ok(hit);
    const record = await recordDocumentKnowledgeRead({ ledger: host.ctx.hima.ledger, packsDir: packsDirOf(h), runId: run.id,
      nodeId: 'prepare', attempt: 1, sessionId: 'session-current-knowledge', workshop: 'analysis', root, hit: hit!, origin: 'current' });
    assert.equal(record.origin, 'current');
    assert.equal(record.documentId, imported.document.id);
    assert.equal(record.chunkId, hit?.id);
    assert.equal(record.page, 1);
    assert.equal(record.sourceMaterialSha256, imported.document.sha256);
  } finally { await host.dispose(); }

  host = await bootInProcess(h);
  try {
    assert.deepEqual((await listCurrentKnowledge(root, 'campaign-proposal')).map((item) => item.id), [imported.document.id]);
    assert.equal(await clearCurrentKnowledge(root, 'campaign-proposal', imported.document.id), true);
    assert.deepEqual(await listCurrentKnowledge(root, 'campaign-proposal'), []);
    assert.equal(await clearCurrentKnowledge(root, 'campaign-proposal', imported.document.id), false);
    assert.equal(packDigestOf(path.join(packsDirOf(h), timingProbePackId)), before);
  } finally { await host.dispose(); await h.dispose(); }
});

test('HimaGuide reaches current knowledge through one bounded product tool without treating search as evidence', async () => {
  const h = await createHimaHome();
  await installPack(h);
  await installPack(h, 'custom-cell-fmax-dtco');
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    let serial = 0;
    const call = async (args: Record<string, unknown>) => {
      const answer = await host.ctx.tools.execute({ name: 'hima_knowledge', arguments: args, agent,
        callId: `knowledge-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
      assert.equal(answer.isError, false, JSON.stringify(answer));
      return JSON.parse(answer.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    };
    assert.ok(host.ctx.tools.schemas().some((schema) => schema.name === 'hima_knowledge'));
    const prepared = await host.ctx.tools.execute({ name: 'hima_prepare', arguments: { pack: timingProbePackId }, agent,
      callId: `knowledge-prepare-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const scope = JSON.parse(prepared.content.filter((item) => item.type === 'text').map((item) => item.text).join('')).id;
    const workspaceFixture = path.join(h.workspace, 'guide.pdf');
    await copyFile(fixture, workspaceFixture);
    const forgedScope = await host.ctx.tools.execute({ name: 'hima_knowledge', arguments: { action: 'import', source: 'current', scope: 'a'.repeat(64), file: workspaceFixture }, agent,
      callId: `knowledge-forged-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    assert.equal(forgedScope.isError, true);
    assert.match(JSON.stringify(forgedScope.content), /full, current HimaGuide Campaign proposal token/);
    const imported = await call({ action: 'import', source: 'current', scope, file: workspaceFixture,
      title: 'EDA Timing Preparation Guide', version: '1' });
    const outsideWorkspace = await host.ctx.tools.execute({ name: 'hima_knowledge', arguments: { action: 'import', source: 'current', scope, file: fixture }, agent,
      callId: `knowledge-outside-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    assert.equal(outsideWorkspace.isError, true);
    assert.match(JSON.stringify(outsideWorkspace.content), /limited to this Agent workspace/);
    const preparedAgain = await host.ctx.tools.execute({ name: 'hima_prepare', arguments: { pack: timingProbePackId }, agent,
      callId: `knowledge-prepare-again-${++serial}` as never, signal: AbortSignal.timeout(20_000) });
    const refreshed = JSON.parse(preparedAgain.content.filter((item) => item.type === 'text').map((item) => item.text).join('')) as Record<string, any>;
    assert.equal(refreshed.knowledge.currentDocuments, 1);
    const searched = await call({ action: 'search', source: 'current', scope, query: 'final routed database' });
    assert.ok(searched.hits.length > 0);
    assert.equal(searched.hits[0].text, undefined, 'search exposes a bounded preview, not the source excerpt');
    assert.ok(searched.hits[0].snippet.length <= 360);
    const read = await call({ action: 'read', source: 'current', scope,
      documentId: imported.document.id, chunkId: searched.hits[0].id });
    assert.match(read.text, /routed database/i);
    assert.ok(read.text.length <= 2_400);
    const packSearch = await call({ action: 'search', source: 'pack', pack: 'custom-cell-fmax-dtco', query: 'matched physical' });
    assert.ok(packSearch.hits.length > 0);
    const packRead = await call({ action: 'read', source: 'pack', pack: 'custom-cell-fmax-dtco',
      documentId: packSearch.hits[0].documentId, chunkId: packSearch.hits[0].id });
    assert.match(packRead.text, /matched physical/i);
    assert.equal(host.ctx.hima.ledger.runs().length, 0,
      'a read outside a Campaign remains session knowledge and does not invent a Campaign');
  } finally { await host.dispose(); await h.dispose(); }
});
