// PLS-13: real files at the agreed installation/export seam; no model, Site, or desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedLocalSite, writeConvergingVariant } from '../../packages/desktop/src/local-site.ts';
import { exportPackMethod, installPackMethod, loadPack, loadRunPack, packDigestOf, releaseIssue, snapshotPackFolder } from '@hima/harness';
import { versionFileFor } from './support/pack.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packId = 'opene902-timing-probe';

async function methodFixture(t: import('node:test').TestContext): Promise<{ root: string; source: string; installed: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'pls13-method-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source', packId);
  const installed = path.join(root, 'installed', packId);
  await mkdir(path.dirname(source), { recursive: true });
  exportPackMethod({ from: path.join(checkout, 'packs', packId), to: source });
  installPackMethod({ from: source, to: installed });
  return { root, source, installed };
}

async function setVersion(source: string, version: string): Promise<void> {
  for (const file of ['contract.yml', 'graph.yml']) {
    const at = path.join(source, file);
    await writeFile(at, (await readFile(at, 'utf8')).replace(/^version: .+$/m, `version: '${version}'`));
  }
}

test('repeated local seeding preserves the installed Pack customer archive byte for byte', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'pls13-seed-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const seeded = await seedLocalSite({ home, checkout });
  const archives = [seeded.packDir, seeded.convergingPackDir].map((dir) => path.join(dir, 'run-assets/run-isolated-evidence/report.md'));
  const bytes = Buffer.from('# Customer research\nEvidence: a valid negative result.\n\u0000\xff', 'utf8');
  for (const archive of archives) {
    await mkdir(path.dirname(archive), { recursive: true });
    await writeFile(archive, bytes);
  }
  await seedLocalSite({ home, checkout });
  await seedLocalSite({ home, checkout });
  for (const archive of archives) {
    assert.deepEqual(await readFile(archive), bytes);
    assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  }
});

test('a real Host resumes the old Run against its original method after an installed version upgrade', async (t) => {
  const h = await createHimaHome();
  let runningHost: Awaited<ReturnType<typeof bootInProcess>> | undefined;
  t.after(async () => { await runningHost?.dispose(); await h.dispose(); });
  const source = path.join(h.home, 'source/packs/opene902-timing-probe');
  await mkdir(path.dirname(source), { recursive: true });
  exportPackMethod({ from: path.join(checkout, 'packs/opene902-timing-probe'), to: source });
  const graphFile = path.join(source, 'graph.yml');
  await writeFile(graphFile, (await readFile(graphFile, 'utf8')).replace('entry: synthesize', 'entry: blocked'));
  const seeded = await seedLocalSite({ home: h.home, checkout: path.join(h.home, 'source') });
  const digest = packDigestOf(seeded.packDir);
  const host = await bootInProcess(h);
  runningHost = host;
  const opened = await himaCommand(host, h.workspace, '/hima run opene902-timing-probe --site local --goal target_period_ns=2.0');
  assert.match(opened.text, /current node: blocked\n/, opened.text);
  assert.ok(opened.runId, opened.text);
  await writeFile(graphFile, (await readFile(graphFile, 'utf8')).replaceAll('blocked', 'blocked-new-version').replace("version: '2'", "version: '3'"));
  const contractFile = path.join(source, 'contract.yml');
  await writeFile(contractFile, (await readFile(contractFile, 'utf8')).replace("version: '2'", "version: '3'"));
  installPackMethod({ from: source, to: seeded.packDir });
  assert.notEqual(packDigestOf(seeded.packDir), digest);
  assert.equal(loadRunPack(path.dirname(seeded.packDir), 'opene902-timing-probe', digest).graph.entry, 'blocked');
  const resumed = await himaCommand(host, h.workspace, `/hima resume ${opened.runId}`);
  assert.match(resumed.text, /current node: blocked\n/, resumed.text);
  assert.equal(host.ctx.hima.ledger.run(opened.runId)?.packDigest, digest);
  const workspace = host.ctx.hima.ledger.records({ runId: opened.runId, type: 'workspace' }).find((row) => row.type === 'workspace');
  assert.equal(workspace?.type === 'workspace' ? workspace.packDigest : undefined, digest);
});

test('run assets leave method identity and legacy method-only seals unchanged, while a same-version method edit is refused', async (t) => {
  const { root, source, installed } = await methodFixture(t);
  const before = packDigestOf(installed);
  const run = 'run-11111111-1111-4111-8111-111111111111';
  await writeFile(path.join(source, 'TEST.md'), `## Run\n\nrun: ${run}\n`);
  await writeFile(path.join(source, 'VERSION.yml'), versionFileFor(source, { pack: packId, version: '2', run }));
  const asset = path.join(source, 'run-assets', run, 'private-algorithm.py');
  await mkdir(path.dirname(asset), { recursive: true });
  await writeFile(asset, 'customer-only algorithm\n');
  const folder = snapshotPackFolder(source);
  assert.equal(folder.has(`run-assets/${run}/private-algorithm.py`), false);
  assert.equal(packDigestOf(source), before);
  assert.equal(releaseIssue(folder, loadPack(path.dirname(source), packId).contract), undefined);
  await writeFile(path.join(source, 'VERSION.yml'), `${await readFile(path.join(source, 'VERSION.yml'), 'utf8')}methodDigest: '${before}'\n`);
  assert.equal(releaseIssue(snapshotPackFolder(source), loadPack(path.dirname(source), packId).contract), undefined);
  const shared = exportPackMethod({ from: source, to: path.join(root, 'share') });
  assert.equal(shared.files.some((file) => file.startsWith('run-assets/')), false);
  await assert.rejects(readFile(path.join(shared.dir, 'run-assets', run, 'private-algorithm.py')), { code: 'ENOENT' });
  assert.equal(packDigestOf(shared.dir), before);
  const variant = await writeConvergingVariant({ from: source, to: path.join(root, 'over-constraining-probe') });
  assert.equal(loadPack(root, variant.id).folder.has('VERSION.yml'), false, 'a changed method cannot retain the source release seal');
  await rm(path.join(source, 'VERSION.yml'));
  await writeFile(path.join(source, 'tools/synth.sh'), `${await readFile(path.join(source, 'tools/synth.sh'), 'utf8')}\n# a different method\n`);
  assert.notEqual(packDigestOf(source), before);
  assert.throws(() => installPackMethod({ from: source, to: installed }), /different method content.*new version/);
  assert.equal(packDigestOf(installed), before);
});

test('an interrupted upgrade leaves customer assets and the original method recoverable and refuses a partial installation', async (t) => {
  const { source, installed } = await methodFixture(t);
  const digest = packDigestOf(installed);
  const archive = path.join(installed, 'run-assets/run-real-write-failure/report.md');
  await mkdir(path.dirname(archive), { recursive: true });
  await writeFile(archive, 'historical customer result\n');
  await setVersion(source, '3');
  const toolsDir = path.join(installed, 'tools');
  await chmod(toolsDir, 0o500);
  try {
    assert.throws(() => installPackMethod({ from: source, to: installed }), /EACCES|EPERM/);
    assert.equal(await readFile(archive, 'utf8'), 'historical customer result\n');
    assert.throws(() => loadPack(path.dirname(installed), packId), /interrupted method update/);
    assert.throws(() => installPackMethod({ from: source, to: installed }), /interrupted method update/);
    assert.equal(loadRunPack(path.dirname(installed), packId, digest).contract.version, '2');
    assert.equal(JSON.parse(await readFile(path.join(installed, '.hima-method-update.json'), 'utf8')).previous.digest, digest);
  } finally {
    await chmod(toolsDir, 0o700);
  }
});

test('asset symlinks and parent-directory links refuse installation and method export without changing their targets', async (t) => {
  const { root, source, installed } = await methodFixture(t);
  const outside = path.join(root, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'secret.txt'), 'private bytes');
  await symlink(outside, path.join(installed, 'run-assets'), 'dir');
  assert.throws(() => installPackMethod({ from: source, to: installed }), /not a plain file/);
  assert.throws(() => exportPackMethod({ from: installed, to: path.join(root, 'share') }), /not a plain file/);
  await symlink(outside, path.join(root, 'linked-parent'), 'dir');
  assert.throws(() => installPackMethod({ from: source, to: path.join(root, 'linked-parent', packId) }), /cannot follow symlinks/);
  assert.throws(() => loadRunPack(path.dirname(installed), '../outside', 'a'.repeat(64)));
  assert.equal(await readFile(path.join(outside, 'secret.txt'), 'utf8'), 'private bytes');
});

test('legacy installations are adopted only by exact bytes and missing historical identity is never invented', async (t) => {
  const { root, source } = await methodFixture(t);
  const old = path.join(root, 'legacy', packId);
  await mkdir(path.dirname(old), { recursive: true });
  exportPackMethod({ from: source, to: old });
  await mkdir(path.join(old, 'run-assets/run-legacy'), { recursive: true });
  await writeFile(path.join(old, 'run-assets/run-legacy/report.md'), 'old report');
  assert.equal(installPackMethod({ from: source, to: old }).changed, false);
  assert.equal(await readFile(path.join(old, 'run-assets/run-legacy/report.md'), 'utf8'), 'old report');
  assert.throws(() => loadRunPack(path.dirname(old), packId, undefined), /no recorded method digest/);
  assert.throws(() => loadRunPack(path.dirname(old), packId, 'a'.repeat(64)), /no verified original snapshot/);
  await rm(path.join(old, '.hima-method-install.json'));
  await writeFile(path.join(old, 'customer.txt'), 'unowned');
  assert.throws(() => installPackMethod({ from: source, to: old }), /no verified method manifest.*differs/);
  assert.equal(await readFile(path.join(old, 'customer.txt'), 'utf8'), 'unowned');
});

test('a method-only export preserves executable method scripts', async (t) => {
  const { root, source } = await methodFixture(t);
  const script = path.join(source, 'tools/direct-check.sh');
  await writeFile(script, '#!/bin/sh\nprintf "method-script-ran\\n"\n');
  await chmod(script, 0o755);
  const shared = exportPackMethod({ from: source, to: path.join(root, 'share') });
  assert.equal(execFileSync(path.join(shared.dir, 'tools/direct-check.sh'), { encoding: 'utf8' }), 'method-script-ran\n');
});

test('installed Pack ownership refuses unknown files even inside installer metadata, and method-only sharing never copies them', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'pls13-unknown-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const seeded = await seedLocalSite({ home, checkout });
  const unknown = path.join(seeded.packDir, '.hima-method-history/customer-notes.txt');
  await writeFile(unknown, 'customer-owned note, not an installer snapshot');
  assert.throws(() => installPackMethod({ from: path.join(checkout, 'packs/opene902-timing-probe'), to: seeded.packDir }), /unknown|ownership|manifest/);
  assert.equal(await readFile(unknown, 'utf8'), 'customer-owned note, not an installer snapshot');
  await rm(unknown);
  const misplacedAssets = path.join(seeded.packDir, '.hima-method-history', packDigestOf(seeded.packDir), packId, 'run-assets');
  await mkdir(misplacedAssets);
  await writeFile(path.join(misplacedAssets, 'customer.txt'), 'not an installer-owned historical method file');
  assert.throws(() => installPackMethod({ from: path.join(checkout, 'packs/opene902-timing-probe'), to: seeded.packDir }), /unknown|ownership/);
  await rm(misplacedAssets, { recursive: true });
  const unknownDirectory = path.join(seeded.packDir, 'customer-empty-folder');
  await mkdir(unknownDirectory);
  assert.throws(() => installPackMethod({ from: path.join(checkout, 'packs/opene902-timing-probe'), to: seeded.packDir }), /unknown|ownership/);
  await rm(unknownDirectory, { recursive: true });
  const privateFile = path.join(seeded.packDir, 'private-customer-algorithm.py');
  await writeFile(privateFile, 'print("customer secret")\n');
  assert.throws(() => exportPackMethod({ from: seeded.packDir, to: path.join(home, 'share') }), /unknown|ownership|manifest/);
});
