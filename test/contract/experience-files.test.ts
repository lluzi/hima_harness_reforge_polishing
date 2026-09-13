// L2: real Host storage and public report I/O, with explicitly seeded historical/write-boundary data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { localHome } from './support/fabric.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { writeLocalSite } from './support/site.ts';
import { installPack, packsDirOf, timingProbePackId } from './support/pack.ts';
import { readArchivedMaterial, readExperience, writeExperience, writeRunAssets, readRunAssets, EXPERIENCE_DIR } from '@hima/harness';
import type { ExperienceJson, ExperienceAnswer, RunAssetManifest, RunView } from '@hima/harness';

const hash = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const h = await createHimaHome();
  const { sitesDir } = await writeLocalSite(h, { allowedReadRoots: [h.workspace], allowedWriteRoots: [h.workspace] });
  const host = await bootInProcess(h);
  const ledger = host.ctx.hima.ledger;
  const run = await ledger.createRun({ campaignId: 'historical-fixture', siteId: 'local', status: 'cancelled', packId: 'recorded-method' });
  const deps = { ledger, sitesDir, packsDir: packsDirOf(h) };
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await host.dispose(); } };
  return { h, host, run, deps, close };
}

test('two actual observations of an overwritten report retain both byte versions for final archive', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 }); assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', ownerSessionId: String(owner.id), goal: { target_period_ns: 2 } });
    assert.equal(started.kind, 'ran'); if (started.kind !== 'ran') return;
    const at = path.join(home.h.workspace, 'changing-input.txt');
    const observations = [];
    for (const text of ['first actual bytes\n', 'second actual bytes\n']) {
      await writeFile(at, text);
      const result = await host.ctx.hima.observe({ site: 'local', run: started.run.id, path: at, reader: 'raw' });
      assert.equal(result.kind, 'observed'); if (result.kind !== 'observed') throw new Error('observation refused');
      observations.push({ record: result.record, text });
    }
    await host.ctx.hima.cancelRun(started.run.id);
    const deps = { ledger: host.ctx.hima.ledger, sitesDir: path.join(home.h.home, 'hima/sites'), packsDir: packsDirOf(home.h) };
    const archive = await readRunAssets(deps, started.run.id);
    assert.equal(archive.kind, 'read', JSON.stringify(archive)); if (archive.kind !== 'read') return;
    for (const { record, text } of observations) {
      const material = archive.manifest.materials.find(item => item.recordId === record.id); assert.ok(material);
      const result = await readArchivedMaterial(deps, started.run.id, material.path);
      assert.equal(result.kind, 'read'); if (result.kind === 'read') assert.equal(result.text, text);
    }
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('an ended Run without a workspace explains why no report is deliverable through projection and read API', async () => {
  const f = await fixture();
  try {
    const written = await writeExperience(f.deps, f.run.id);
    assert.equal(written.kind, 'nothing');
    assert.match(written.kind === 'nothing' ? written.why : '', /no campaign workspace/);
    const read = await readExperience(f.deps, f.run.id);
    assert.equal(read.kind, 'none');
    assert.match(read.kind === 'none' ? read.why ?? '' : '', /no Campaign workspace/);
    assert.equal(f.deps.ledger.records({ runId: f.run.id, type: 'experience' }).length, 0);
    await f.close();
    const next = await bootHimaHost(f.h);
    try {
      const cookie = await openSession(next);
      const view = await (await api(next, cookie, `/hima/api/runs/${f.run.id}`)).json() as RunView;
      assert.equal(view.experience, undefined);
      assert.match(view.experienceUnavailable ?? '', /No report file can be delivered/);
      const response = await api(next, cookie, `/hima/api/runs/${f.run.id}/experience`);
      assert.equal(response.status, 404);
      assert.match(await response.text(), /no Campaign workspace/);
      const page = await api(next, cookie, `/hima/?run=${f.run.id}`);
      assert.match(await page.text(), /data-hima-state-source="not-written"/);
    } finally { assert.equal(await next.stop(), 0, next.stderr()); }
  } finally { await f.close(); await f.h.dispose(); }
});

test('an ended Run publishes verified local copies only under its installed Pack, is idempotent, and refuses tampering', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    const run = await f.deps.ledger.createRun({ campaignId: 'archive-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const first = await writeRunAssets(f.deps, run.id);
    assert.equal(first.kind, 'written', first.kind === 'failed' ? first.why : '');
    if (first.kind !== 'written') throw new Error(JSON.stringify(first));
    assert.match(first.directory, new RegExp(`hima/packs/${timingProbePackId}/run-assets/${run.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    assert.equal(first.manifest.delivery, 'complete');
    assert.deepEqual(first.manifest.materials.map((m) => m.path), ['experience.md', 'experience.json']);
    assert.equal(f.deps.ledger.records({ runId: run.id, type: 'archive' }).at(-1)?.type, 'archive');
    const completed = f.deps.ledger.records({ runId: run.id, type: 'archive' }).at(-1);
    assert.ok(completed?.type === 'archive' && completed.delivery === 'complete');
    const read = await readRunAssets(f.deps, run.id);
    assert.equal(read.kind, 'read');
    const manifestBytes = await readFile(first.manifestPath, 'utf8');
    const forged = JSON.parse(manifestBytes) as { campaignId: string };
    forged.campaignId = 'forged-campaign';
    await writeFile(first.manifestPath, `${JSON.stringify(forged)}\n`);
    assert.equal((await readRunAssets(f.deps, run.id)).kind, 'unreadable', 'a self-consistent manifest is not accepted without its exact Ledger completion hash');
    await writeFile(first.manifestPath, manifestBytes);
    assert.equal((await writeRunAssets(f.deps, run.id)).kind, 'already');
    const archivedJson = path.join(first.directory, 'experience.json');
    const originalJson = await readFile(archivedJson);
    const outsideJson = path.join(f.h.home, 'outside-experience.json');
    await writeFile(outsideJson, originalJson);
    await rm(archivedJson);
    await symlink(outsideJson, archivedJson, 'file');
    assert.equal((await readRunAssets(f.deps, run.id)).kind, 'unreadable', 'a same-byte leaf symlink is never accepted as archived evidence');
    await rm(archivedJson);
    await writeFile(archivedJson, originalJson);
    await writeFile(path.join(first.directory, 'experience.md'), 'tampered');
    const tampered = await readRunAssets(f.deps, run.id);
    assert.equal(tampered.kind, 'changed');
    const retry = await writeRunAssets(f.deps, run.id);
    assert.equal(retry.kind, 'failed');
    await f.deps.ledger.appendArchive(run.id, { delivery: 'complete', directory: `${first.directory}-forged`,
      manifestSha256: hash(manifestBytes), materials: [...first.manifest.materials] });
    const redirected = await readRunAssets(f.deps, run.id);
    assert.equal(redirected.kind, 'unreadable', 'a completion record cannot redirect the archive identity to another directory');
    assert.match(redirected.kind === 'unreadable' ? redirected.why : '', /directory/);
  } finally { await f.close(); await f.h.dispose(); }
});

test('archive publication refuses a symlinked run-assets ancestor without writing through it', async () => {
  const f = await fixture();
  try {
    const installed = await installPack(f.h);
    const outside = path.join(f.h.home, 'outside-assets');
    await mkdir(outside);
    await symlink(outside, path.join(installed.dir, 'run-assets'), 'dir');
    const run = await f.deps.ledger.createRun({ campaignId: 'linked-archive-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const written = await writeRunAssets(f.deps, run.id);
    assert.equal(written.kind, 'failed');
    assert.match(written.kind === 'failed' ? written.why : '', /symlink/);
    assert.deepEqual(await readdir(outside), []);
    assert.equal(f.deps.ledger.records({ runId: run.id, type: 'archive' }).some((record) => record.type === 'archive' && record.delivery === 'complete'), false);
  } finally { await f.close(); await f.h.dispose(); }
});

test('goal support, measured-negative ending, budget ending and cancellation each receive a verified local delivery', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    for (const status of ['ended-goal-met', 'ended-goal-not-met', 'ended-budget-exhausted', 'cancelled'] as const) {
      const run = await f.deps.ledger.createRun({ campaignId: `ending-${status}`, siteId: 'local', status, packId: timingProbePackId });
      const written = await writeRunAssets(f.deps, run.id);
      assert.equal(written.kind, 'written', `${status}: ${written.kind === 'failed' ? written.why : written.kind}`);
      const read = await readRunAssets(f.deps, run.id);
      assert.equal(read.kind, 'read', `${status}: ${JSON.stringify(read)}`);
      if (read.kind === 'read') assert.equal(read.manifest.runId, run.id);
    }
  } finally { await f.close(); await f.h.dispose(); }
});

test('an ended Run archives byte-identified code under a safe name and reads it offline after the Site source is gone', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    const run = await f.deps.ledger.createRun({ campaignId: 'code-archive-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const source = path.join(f.h.workspace, 'research/analysis/core.py');
    const content = 'def score(slack):\n    return slack >= 0\n';
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, content);
    const code = await f.deps.ledger.appendCode(run.id, {
      nodeId: 'analyze', attempt: 1, sessionId: 'session-archive-code', workshop: 'analysis',
      path: source, sha256: hash(content), bytes: Buffer.byteLength(content), language: 'python',
    });
    const observationSource = path.join(f.h.workspace, 'reports/final.rpt');
    const observationContent = 'WNS -0.073\n';
    await mkdir(path.dirname(observationSource), { recursive: true });
    await writeFile(observationSource, observationContent);
    const observation = await f.deps.ledger.appendObservation(run.id, {
      path: observationSource, contentSha256: hash(observationContent), bytes: Buffer.byteLength(observationContent),
      reader: { id: 'archive-identity', version: '1', reportKind: 'fixture', emits: [] }, values: [],
    });

    const written = await writeRunAssets(f.deps, run.id);
    assert.equal(written.kind, 'written', written.kind === 'failed' ? written.why : '');
    if (written.kind !== 'written') throw new Error(JSON.stringify(written));
    const archivedCode = written.manifest.materials.find((material) => material.recordId === code.id);
    const archivedObservation = written.manifest.materials.find((material) => material.recordId === observation.id);
    assert.ok(archivedCode, 'the manifest identifies the archived code by its ledger record');
    assert.ok(archivedObservation, 'the manifest identifies the archived observation by its ledger record');
    assert.doesNotMatch(archivedCode.path, /#/);
    assert.equal((await readRunAssets(f.deps, run.id)).kind, 'read');

    await rm(source);
    await rm(observationSource);
    const offline = await f.host.ctx.hima.readMaterial(run.id, code.id);
    assert.equal(offline.kind, 'read', JSON.stringify(offline));
    if (offline.kind === 'read') assert.equal(offline.text, content);
    const offlineObservation = await readArchivedMaterial(f.deps, run.id, archivedObservation.path);
    assert.equal(offlineObservation.kind, 'read', JSON.stringify(offlineObservation));
    if (offlineObservation.kind === 'read') assert.equal(offlineObservation.text, observationContent);

    const outsideMaterials = path.join(f.h.home, 'outside-materials');
    await mkdir(outsideMaterials);
    await writeFile(path.join(outsideMaterials, path.basename(archivedCode.path)), content);
    await writeFile(path.join(outsideMaterials, path.basename(archivedObservation.path)), observationContent);
    await rm(path.join(written.directory, 'materials'), { recursive: true });
    await symlink(outsideMaterials, path.join(written.directory, 'materials'), 'dir');
    assert.equal((await readRunAssets(f.deps, run.id)).kind, 'unreadable', 'same-byte materials reached through a linked ancestor are not archive evidence');
  } finally { await f.close(); await f.h.dispose(); }
});

test('missing recorded code or observation bytes leave an explicit failed delivery and no completion', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    const codeRun = await f.deps.ledger.createRun({ campaignId: 'missing-code-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const codePath = path.join(f.h.workspace, 'lost-code.py');
    const codeText = 'print(1)\n';
    await writeFile(codePath, codeText);
    await f.deps.ledger.appendCode(codeRun.id, { nodeId: 'analyze', attempt: 1, sessionId: 'lost-code-session', workshop: 'analysis',
      path: codePath, sha256: hash(codeText), bytes: Buffer.byteLength(codeText), language: 'python' });
    await rm(codePath);
    const missingCode = await writeRunAssets(f.deps, codeRun.id);
    assert.equal(missingCode.kind, 'failed');
    assert.match(missingCode.kind === 'failed' ? missingCode.why : '', /required code material/);

    const observationRun = await f.deps.ledger.createRun({ campaignId: 'missing-observation-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const reportPath = path.join(f.h.workspace, 'lost-report.rpt');
    const reportText = 'WNS -0.1\n';
    await writeFile(reportPath, reportText);
    await f.deps.ledger.appendObservation(observationRun.id, { path: reportPath, contentSha256: hash(reportText), bytes: Buffer.byteLength(reportText),
      reader: { id: 'archive-identity', version: '1', reportKind: 'fixture', emits: [] }, values: [] });
    await rm(reportPath);
    const missingObservation = await writeRunAssets(f.deps, observationRun.id);
    assert.equal(missingObservation.kind, 'failed');
    assert.match(missingObservation.kind === 'failed' ? missingObservation.why : '', /required observation/);

    for (const run of [codeRun, observationRun]) {
      const records = f.deps.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive');
      const last = records.at(-1);
      assert.equal(last?.type === 'archive' ? last.delivery : undefined, 'failed');
      assert.equal(records.some((record) => record.delivery === 'complete'), false);
    }
  } finally { await f.close(); await f.h.dispose(); }
});

test('recorded byte counts remain part of report, code and observation identity', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    const wrongReport = await f.deps.ledger.createRun({ campaignId: 'wrong-report-size', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const writtenAt = '2026-09-13T00:00:00.000Z';
    const markdown = '# report\n';
    const json = JSON.stringify({ schema: 'hima-experience/1', runId: wrongReport.id, campaignId: wrongReport.campaignId,
      pack: { id: timingProbePackId, version: 'not recorded' }, site: 'local', ending: { status: 'cancelled', reason: 'fixture' },
      generations: [], path: [], blockers: [], cancels: [], writtenAt });
    const mdPath = path.join(f.h.workspace, 'wrong-size.md');
    const jsonPath = path.join(f.h.workspace, 'wrong-size.json');
    await writeFile(mdPath, markdown); await writeFile(jsonPath, json);
    await f.deps.ledger.appendExperience(wrongReport.id, { writtenAt,
      markdown: { path: mdPath, sha256: hash(markdown), bytes: Buffer.byteLength(markdown) + 1 },
      json: { path: jsonPath, sha256: hash(json), bytes: Buffer.byteLength(json) } });
    assert.equal((await readExperience(f.deps, wrongReport.id)).kind, 'unreadable');
    assert.equal((await writeRunAssets(f.deps, wrongReport.id)).kind, 'failed');

    const wrongCode = await f.deps.ledger.createRun({ campaignId: 'wrong-code-size', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const codePath = path.join(f.h.workspace, 'wrong-size.py');
    const code = 'print(1)\n';
    await writeFile(codePath, code);
    await f.deps.ledger.appendCode(wrongCode.id, { nodeId: 'analyze', attempt: 1, sessionId: 'wrong-size-code', workshop: 'analysis',
      path: codePath, sha256: hash(code), bytes: Buffer.byteLength(code) + 1, language: 'python' });
    assert.equal((await writeRunAssets(f.deps, wrongCode.id)).kind, 'failed');

    const wrongObservation = await f.deps.ledger.createRun({ campaignId: 'wrong-observation-size', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const observationPath = path.join(f.h.workspace, 'wrong-size.rpt');
    const observation = 'WNS -0.2\n';
    await writeFile(observationPath, observation);
    await f.deps.ledger.appendObservation(wrongObservation.id, { path: observationPath, contentSha256: hash(observation), bytes: Buffer.byteLength(observation) + 1,
      reader: { id: 'archive-identity', version: '1', reportKind: 'fixture', emits: [] }, values: [] });
    assert.equal((await writeRunAssets(f.deps, wrongObservation.id)).kind, 'failed');
  } finally { await f.close(); await f.h.dispose(); }
});

test('a failure before publication keeps one stable reservation and a retry publishes exactly once', async () => {
  const f = await fixture();
  let packDir = '';
  try {
    packDir = (await installPack(f.h)).dir;
    const run = await f.deps.ledger.createRun({ campaignId: 'pending-retry-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    await chmod(packDir, 0o555);
    const interrupted = await writeRunAssets(f.deps, run.id);
    assert.equal(interrupted.kind, 'failed');
    const before = f.deps.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive');
    assert.deepEqual(before.map((record) => record.delivery), ['pending', 'failed']);
    assert.equal(before.some((record) => record.delivery === 'complete'), false, 'failure before rename cannot claim completion');

    await chmod(packDir, 0o755);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const retried = await writeRunAssets(f.deps, run.id);
    assert.equal(retried.kind, 'written', retried.kind === 'failed' ? retried.why : '');
    const after = f.deps.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive');
    assert.equal(after.filter((record) => record.delivery === 'pending').length, 1, 'retry reuses the authoritative reservation');
    assert.equal(after.filter((record) => record.delivery === 'complete').length, 1, 'one publication produces one completion');
    assert.equal((await writeRunAssets(f.deps, run.id)).kind, 'already');
    assert.equal(f.deps.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive' && record.delivery === 'complete').length, 1);
  } finally {
    if (packDir !== '') await chmod(packDir, 0o755).catch(() => undefined);
    await f.close(); await f.h.dispose();
  }
});

test('concurrent delivery calls publish one directory and one completion record', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    const run = await f.deps.ledger.createRun({ campaignId: 'concurrent-archive-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const results = await Promise.all([writeRunAssets(f.deps, run.id), writeRunAssets(f.deps, run.id)]);
    assert.deepEqual(results.map((result) => result.kind).sort(), ['already', 'written']);
    const records = f.deps.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive');
    assert.equal(records.filter((record) => record.delivery === 'pending').length, 1);
    assert.equal(records.filter((record) => record.delivery === 'complete').length, 1);
  } finally { await f.close(); await f.h.dispose(); }
});

test('restart completes an exact reserved directory published before the prior Host could append completion', async () => {
  const f = await fixture();
  let packDir = '';
  try {
    packDir = (await installPack(f.h)).dir;
    const run = await f.deps.ledger.createRun({ campaignId: 'published-before-completion', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const writtenAt = '2026-09-13T00:00:00.000Z';
    const markdown = '# Original Site report\n';
    const document: ExperienceJson = { schema: 'hima-experience/1', runId: run.id, campaignId: run.campaignId,
      pack: { id: timingProbePackId, version: 'not recorded' }, site: 'local', ending: { status: 'cancelled', reason: 'cancelled fixture' },
      generations: [], path: [], blockers: [], cancels: [], writtenAt };
    const json = JSON.stringify(document);
    const mdPath = path.join(f.h.workspace, 'reserved-original.md');
    const jsonPath = path.join(f.h.workspace, 'reserved-original.json');
    await writeFile(mdPath, markdown); await writeFile(jsonPath, json);
    await f.deps.ledger.appendExperience(run.id, { writtenAt,
      markdown: { path: mdPath, sha256: hash(markdown), bytes: Buffer.byteLength(markdown) },
      json: { path: jsonPath, sha256: hash(json), bytes: Buffer.byteLength(json) } });

    await chmod(packDir, 0o555);
    assert.equal((await writeRunAssets(f.deps, run.id)).kind, 'failed');
    await chmod(packDir, 0o755);
    const pending = f.deps.ledger.records({ runId: run.id, type: 'archive' }).find((record) => record.type === 'archive' && record.delivery === 'pending');
    assert.ok(pending?.type === 'archive' && pending.delivery === 'pending');
    const manifest: RunAssetManifest = {
      schema: 'hima-run-assets/1', runId: run.id, campaignId: run.campaignId, siteId: run.siteId,
      pack: { id: timingProbePackId, version: 'not recorded' }, createdAt: writtenAt, delivery: 'complete',
      materials: [...pending.materials],
    };
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    assert.equal(hash(manifestBytes), pending.manifestSha256, 'published bytes are the exact pre-rename reservation');
    await mkdir(pending.directory, { recursive: true });
    await writeFile(path.join(pending.directory, 'experience.md'), markdown);
    await writeFile(path.join(pending.directory, 'experience.json'), json);
    await writeFile(path.join(pending.directory, 'manifest.json'), manifestBytes);

    await f.close();
    const next = await bootInProcess(f.h);
    try {
      await next.ctx.hima.reconciled;
      const records = next.ctx.hima.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive');
      assert.equal(records.filter((record) => record.delivery === 'complete').length, 1);
      const deps = { ledger: next.ctx.hima.ledger, sitesDir: f.deps.sitesDir, packsDir: f.deps.packsDir };
      assert.equal((await readRunAssets(deps, run.id)).kind, 'read');
      assert.equal((await writeRunAssets(deps, run.id)).kind, 'already');
      assert.equal(next.ctx.hima.ledger.records({ runId: run.id, type: 'archive' }).filter((record) => record.type === 'archive' && record.delivery === 'complete').length, 1);
    } finally { await next.dispose(); }
  } finally {
    if (packDir !== '') await chmod(packDir, 0o755).catch(() => undefined);
    await f.close(); await f.h.dispose();
  }
});

test('a pending hash cannot bless a published directory with another Run, Pack, version, Site or method identity', async () => {
  const f = await fixture();
  try {
    const installed = await installPack(f.h);
    for (const mismatch of ['campaign', 'site', 'pack', 'version', 'method'] as const) {
      const packDigest = mismatch === 'method' ? 'a'.repeat(64) : undefined;
      const run = await f.deps.ledger.createRun({ campaignId: `identity-${mismatch}`, siteId: 'local', status: 'cancelled', packId: timingProbePackId, ...(packDigest === undefined ? {} : { packDigest }) });
      const directory = path.join(installed.dir, 'run-assets', run.id);
      await mkdir(directory, { recursive: true });
      const report = 'report\n';
      const json = '{}\n';
      const manifest: RunAssetManifest = {
        schema: 'hima-run-assets/1', runId: run.id,
        campaignId: mismatch === 'campaign' ? 'another-campaign' : run.campaignId,
        siteId: mismatch === 'site' ? 'other-site' : run.siteId,
        pack: { id: mismatch === 'pack' ? 'another-pack' : timingProbePackId, version: mismatch === 'version' ? 'forged-version' : 'not recorded' },
        ...(packDigest === undefined ? {} : { methodDigest: mismatch === 'method' ? 'b'.repeat(64) : packDigest }),
        createdAt: run.createdAt, delivery: 'complete',
        materials: [
          { path: 'experience.md', source: 'generated:experience-markdown', type: 'experience', sha256: hash(report), bytes: Buffer.byteLength(report), required: true },
          { path: 'experience.json', source: 'generated:experience-json', type: 'experience', sha256: hash(json), bytes: Buffer.byteLength(json), required: true },
        ],
      };
      await writeFile(path.join(directory, 'experience.md'), report);
      await writeFile(path.join(directory, 'experience.json'), json);
      const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(path.join(directory, 'manifest.json'), manifestBytes);
      await f.deps.ledger.appendArchive(run.id, { delivery: 'pending', directory, manifestSha256: hash(manifestBytes), materials: [...manifest.materials] });

      const attempted = await writeRunAssets(f.deps, run.id);
      assert.equal(attempted.kind, 'failed', mismatch);
      assert.equal(f.deps.ledger.records({ runId: run.id, type: 'archive' }).some((record) => record.type === 'archive' && record.delivery === 'complete'), false, mismatch);
    }
  } finally { await f.close(); await f.h.dispose(); }
});

test('a listed optional material must be verified unless its absence is explicitly explained', async () => {
  const f = await fixture();
  try {
    const installed = await installPack(f.h);
    const run = await f.deps.ledger.createRun({ campaignId: 'optional-material-fixture', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    const directory = path.join(installed.dir, 'run-assets', run.id);
    await mkdir(directory, { recursive: true });
    const report = 'report\n';
    const json = '{}\n';
    await writeFile(path.join(directory, 'experience.md'), report);
    await writeFile(path.join(directory, 'experience.json'), json);
    const manifest: RunAssetManifest = {
      schema: 'hima-run-assets/1', runId: run.id, campaignId: run.campaignId, siteId: run.siteId,
      pack: { id: timingProbePackId, version: 'not recorded' }, createdAt: run.createdAt, delivery: 'complete',
      materials: [
        { path: 'experience.md', source: 'generated:experience-markdown', type: 'experience', sha256: hash(report), bytes: Buffer.byteLength(report), required: true },
        { path: 'experience.json', source: 'generated:experience-json', type: 'experience', sha256: hash(json), bytes: Buffer.byteLength(json), required: true },
        { path: 'materials/optional.txt', source: 'code:/lost/optional.txt', type: 'code', recordId: 'lost-record', sha256: hash('missing'), bytes: 7, required: false },
      ],
    };
    const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(path.join(directory, 'manifest.json'), manifestBytes);
    await f.deps.ledger.appendArchive(run.id, { delivery: 'pending', directory, manifestSha256: hash(manifestBytes), materials: [...manifest.materials] });

    const attempted = await writeRunAssets(f.deps, run.id);
    assert.equal(attempted.kind, 'failed', 'optional inventory entries cannot silently escape verification');
    assert.equal(f.deps.ledger.records({ runId: run.id, type: 'archive' }).some((record) => record.type === 'archive' && record.delivery === 'complete'), false);
  } finally { await f.close(); await f.h.dispose(); }
});

test('schema 1 saved bytes and hashes survive a new renderer, repeat read, write request and restarted Host', async () => {
  const f = await fixture();
  try {
    const writtenAt = '2026-09-01T12:00:00.000Z';
    const old: ExperienceJson = { schema: 'hima-experience/1', runId: f.run.id, campaignId: f.run.campaignId,
      pack: { id: 'recorded-method', version: 'historical' }, site: 'local', ending: { status: 'cancelled', reason: 'original wording' },
      generations: [], path: [], blockers: [], cancels: [], writtenAt };
    // An independently authored v1 file fixture, deliberately unlike the current renderer's text.
    const markdown = '# Preserved schema 1 report\n\nOriginal wording.\n';
    // The Site owner chose compact JSON bytes. They parse to the same document as the current
    // renderer, but the Experience record hashes these exact bytes and the Pack archive must copy
    // that evidence rather than silently minting a reformatted replacement.
    const json = JSON.stringify(old);
    const mdPath = path.join(f.h.workspace, 'historical.md');
    const jsonPath = path.join(f.h.workspace, 'historical.json');
    await writeFile(mdPath, markdown); await writeFile(jsonPath, json);
    const record = await f.deps.ledger.appendExperience(f.run.id, { writtenAt,
      markdown: { path: mdPath, sha256: hash(markdown), bytes: Buffer.byteLength(markdown) },
      json: { path: jsonPath, sha256: hash(json), bytes: Buffer.byteLength(json) } });
    const times = [(await stat(mdPath)).mtimeMs, (await stat(jsonPath)).mtimeMs];
    for (let i = 0; i < 2; i++) {
      const read = await readExperience(f.deps, f.run.id);
      assert.equal(read.kind, 'read');
      if (read.kind !== 'read') throw new Error(JSON.stringify(read));
      assert.equal(read.markdown, markdown); assert.deepEqual(read.json, old);
    }
    await mkdir(path.join(f.deps.packsDir, 'recorded-method'), { recursive: true });
    const archived = await writeRunAssets(f.deps, f.run.id);
    assert.equal(archived.kind, 'written', archived.kind === 'failed' ? archived.why : '');
    if (archived.kind !== 'written') throw new Error(JSON.stringify(archived));
    assert.deepEqual(await readFile(path.join(archived.directory, 'experience.json')), Buffer.from(json), 'the Pack keeps the exact Site bytes named by the Experience hash');
    assert.equal(archived.manifest.materials.find((file) => file.path === 'experience.json')?.sha256, record.json.sha256);
    assert.equal((await writeExperience(f.deps, f.run.id)).kind, 'already');
    await f.close();
    const next = await bootHimaHost(f.h);
    try {
      const response = await api(next, await openSession(next), `/hima/api/runs/${f.run.id}/experience`);
      assert.equal(response.status, 200);
      const read = await response.json() as ExperienceAnswer;
      assert.equal(read.markdown, markdown); assert.deepEqual(read.report, old);
      assert.equal(read.experience.json.sha256, record.json.sha256);
      assert.deepEqual([(await stat(mdPath)).mtimeMs, (await stat(jsonPath)).mtimeMs], times);
      assert.equal(await readFile(jsonPath, 'utf8'), json);
    } finally { assert.equal(await next.stop(), 0, next.stderr()); }
  } finally { await f.close(); await f.h.dispose(); }
});

test('failure between the two report writes leaves no record; the next Host completes and verifies both files', async () => {
  const f = await fixture();
  try {
    await f.deps.ledger.appendWorkspace(f.run.id, { event: 'prepared', campaignId: f.run.campaignId, packId: 'recorded-method', packVersion: 'fixture',
      workspace: f.h.workspace, flowRoot: '/declared/flow', design: 'declared-design', containerName: 'declared-container', copied: [], preparedAt: f.run.createdAt });
    const dir = path.join(f.h.workspace, EXPERIENCE_DIR);
    await mkdir(dir);
    const jsonPath = path.join(dir, `${f.run.id}.json`);
    await mkdir(jsonPath); // tee can write Markdown, then refuses the directory occupying JSON.
    await assert.rejects(() => writeExperience(f.deps, f.run.id), /tee|write/);
    assert.ok((await readFile(path.join(dir, `${f.run.id}.md`), 'utf8')).startsWith('# Campaign'));
    assert.equal(f.deps.ledger.records({ runId: f.run.id, type: 'experience' }).length, 0);
    assert.equal((await readExperience(f.deps, f.run.id)).kind, 'none');
    await rm(jsonPath, { recursive: true });
    await f.close();
    const next = await bootHimaHost(f.h);
    try {
      const cookie = await openSession(next);
      let result: Response | undefined;
      for (let i = 0; i < 50; i++) {
        result = await api(next, cookie, `/hima/api/runs/${f.run.id}/experience`);
        if (result.status === 200) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(result?.status, 200);
      const read = await result!.json() as ExperienceAnswer;
      assert.equal(read.report.schema, 'hima-experience/4');
      if (read.report.schema !== 'hima-experience/4') throw new Error('newly recovered report uses schema 4');
      assert.equal(read.report.research.environment.declaredDesign, 'declared-design');
      assert.equal(read.report.research.environment.toolVersions, 'not recorded');
      assert.equal(hash(read.markdown), read.experience.markdown.sha256);
      assert.equal(hash(await readFile(jsonPath, 'utf8')), read.experience.json.sha256);
      const records = await api(next, cookie, `/hima/api/runs/${f.run.id}/records?type=experience`);
      assert.equal((await records.json() as { records: unknown[] }).records.length, 1);
    } finally { assert.equal(await next.stop(), 0, next.stderr()); }
  } finally { await f.close(); await f.h.dispose(); }
});

test('a Site report write failure still preserves local Run facts in the installed Pack', async () => {
  const f = await fixture();
  try {
    await installPack(f.h);
    const run = await f.deps.ledger.createRun({ campaignId: 'site-report-failure', siteId: 'local', status: 'cancelled', packId: timingProbePackId });
    await f.deps.ledger.appendWorkspace(run.id, { event: 'prepared', campaignId: run.campaignId, packId: timingProbePackId, packVersion: '2',
      workspace: f.h.workspace, flowRoot: '/declared/flow', design: 'declared-design', containerName: 'declared-container', copied: [], preparedAt: run.createdAt });
    const dir = path.join(f.h.workspace, EXPERIENCE_DIR);
    await mkdir(dir);
    await mkdir(path.join(dir, `${run.id}.json`));

    await assert.rejects(() => writeExperience(f.deps, run.id), /tee|write/);
    assert.equal(f.deps.ledger.records({ runId: run.id, type: 'experience' }).length, 0, 'the partial Site report is not claimed complete');
    const archive = await readRunAssets(f.deps, run.id);
    assert.equal(archive.kind, 'read', JSON.stringify(archive));
    if (archive.kind === 'read') {
      assert.equal(archive.manifest.campaignId, run.campaignId);
      assert.deepEqual(archive.manifest.materials.map((material) => material.path), ['experience.md', 'experience.json']);
    }
  } finally { await f.close(); await f.h.dispose(); }
});
