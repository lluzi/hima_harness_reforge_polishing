// PLS-30: offline PDF/current-knowledge indexing and source-linked Ledger use. No model, Desktop,
// network or EDA process is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { installPack, packsDirOf, timingProbePackId } from './support/pack.ts';
import { clearCurrentKnowledge, importCurrentKnowledge, indexKnowledgeDocument, listCurrentKnowledge,
  packDigestOf, readCurrentKnowledge, recordDocumentKnowledgeRead, searchCurrentKnowledge } from '@hima/harness';

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
    assert.match(hits[0]?.text ?? '', /effective instance/);
    const read = await readCurrentKnowledge(root, 'workspace-a', imported.document.id, hits[0]!.id);
    assert.equal(read.sha256, hits[0]?.sha256);
    assert.deepEqual(await listCurrentKnowledge(root, 'workspace-b'), [], 'another workspace cannot see this current document');
  } finally { await h.dispose(); }
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
      nodeId: 'prepare', attempt: 1, sessionId: 'session-current-knowledge', workshop: 'analysis', hit: hit!, origin: 'current' });
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
