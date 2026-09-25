import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import {
  applyPackTransfer, installPackMethod, loadPack, packDigestOf, packStage,
  previewPackTransfer, recoverPackMethod,
} from '@hima/harness';

const args = process.argv.slice(2);
const evidenceAt = args.indexOf('--evidence');
if (evidenceAt < 0 || !args[evidenceAt + 1] || args.length !== 2) {
  throw new Error('usage: node scripts/verify-wave3-library-authoring.ts --evidence <attempt evidence.json>');
}

const evidenceFile = realpathSync(path.resolve(args[evidenceAt + 1]!));
const evidence = JSON.parse(readFileSync(evidenceFile, 'utf8')) as any;
assert.equal(evidence.status, 'failed', 'the retained live attempt must preserve its post-release false-negative');
const packDir = realpathSync(evidence.observed?.allowedWriteRoot);
const privateRoot = realpathSync(evidence.observed?.privateRoot);
assert.ok(packDir.startsWith(`${privateRoot}${path.sep}`), 'retained Pack must belong to the exact private live-check root');

const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
const digest = packDigestOf(packDir);
const stage = packStage(packDir);
assert.equal(stage.stage, 'released', JSON.stringify(stage));

const versionBytes = readFileSync(path.join(packDir, 'VERSION.yml'));
const testBytes = readFileSync(path.join(packDir, 'TEST.md'));
const version = parse(versionBytes.toString('utf8')) as any;
assert.equal(version.methodDigest, digest);
const runId = version.test?.run as string;
const runEntry = (evidence.runs as any[]).find((entry) => entry.run?.id === runId);
assert.ok(runEntry, `sealed TEST Run ${runId} is absent from retained evidence`);
assert.equal(runEntry.run.purpose, 'test');
assert.equal(runEntry.run.status, 'ended-goal-met');
assert.equal(runEntry.run.packDigest, digest);
assert.match(testBytes.toString('utf8'), new RegExp(`^run: ${runId}$`, 'm'));
assert.match(testBytes.toString('utf8'), /^status: ended-goal-met$/m);
const records = runEntry.records as any[];
const launched = records.filter((record) => record.type === 'job' && record.event === 'launched');
const finished = records.filter((record) => record.type === 'job' && record.event === 'finished');
assert.ok(launched.length > 0, 'real TEST Run must launch a Job');
assert.equal(finished.length, launched.length);
assert.ok(finished.every((record) => record.exitCode === 0));
assert.ok(records.some((record) => record.type === 'observation'));
assert.ok(records.some((record) => record.type === 'verdict' && record.outcome === 'PASS'));
assert.ok(records.some((record) => record.type === 'decision' && record.chosen?.goalMet === true));

const pack = loadPack(path.dirname(packDir), path.basename(packDir));
const wrappers = [...pack.contract.environment.wrappers].sort();
assert.deepEqual(wrappers, ['python3', 'sh']);
assert.ok(pack.contract.tools.every((tool) => !/qualib|edarun|eda/i.test(`${tool.id} ${tool.argv.join(' ')}`)));
assert.ok(pack.contract.workshops.every((workshop) => workshop.argv[0] === 'sh'
  && Object.keys(workshop.licences).length === 0));
assert.match(readFileSync(path.join(packDir, 'INTENT.md'), 'utf8'), /authoring-qualification/i);

const readerId = pack.contract.outputs.find((output) => output.name === 'libraryContract')?.reader;
assert.ok(readerId, 'libraryContract must name its Pack Reader');
const reader = parse(readFileSync(path.join(packDir, 'readers', `${readerId}.yml`), 'utf8')) as { file: string; argv: string[] };

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const runtimeRoot = path.join(repoRoot, '.hima-tmp', 'wave3-library-authoring-finalize', 'attempt10');
assert.equal(existsSync(runtimeRoot), false, `${runtimeRoot} already exists; finalization is single-use`);
mkdirSync(runtimeRoot, { recursive: true });

const malformed = path.join(runtimeRoot, 'malformed.json');
const malformedOut = path.join(runtimeRoot, 'malformed-reader-output.json');
writeFileSync(malformed, '{}\n');
const readerArgv = reader.argv.map((arg) => arg
  .replace('${READER}', path.join(packDir, reader.file))
  .replace('${REPORT}', malformed)
  .replace('${OUT}', malformedOut));
const readerResult = spawnSync(readerArgv[0]!, readerArgv.slice(1), { cwd: runtimeRoot, encoding: 'utf8', timeout: 10_000 });
const malformedBytes = existsSync(malformedOut) ? readFileSync(malformedOut, 'utf8') : '';
const malformedReading = malformedBytes ? JSON.parse(malformedBytes) as { values?: Array<{ type?: string; value?: unknown; unknownReason?: string }> } : {};
const malformedValue = malformedReading.values?.find((entry) => entry.type === 'library_contract_ready');
assert.ok(readerResult.status !== 0 || (malformedValue?.value == null && Boolean(malformedValue?.unknownReason)));

const packId = pack.contract.id;
const installed = path.join(runtimeRoot, 'installed', packId);
const installReview = previewPackTransfer({ from: packDir, to: installed, mode: 'install' });
applyPackTransfer({ from: packDir, to: installed, mode: 'install', reviewSha256: installReview.reviewSha256 });
const customerAsset = path.join(installed, 'run-assets', 'customer-note.bin');
mkdirSync(path.dirname(customerAsset), { recursive: true });
const customerBytes = Buffer.from('customer bytes stay local\n\0wave3', 'utf8');
writeFileSync(customerAsset, customerBytes);
const upgradeReview = previewPackTransfer({ from: packDir, to: installed, mode: 'upgrade' });
applyPackTransfer({ from: packDir, to: installed, mode: 'upgrade', reviewSha256: upgradeReview.reviewSha256 });
assert.equal(packDigestOf(installed), digest);
assert.deepEqual(readFileSync(customerAsset), customerBytes);

const staleTo = path.join(runtimeRoot, 'stale', packId);
const staleReview = previewPackTransfer({ from: packDir, to: staleTo, mode: 'install' });
const intentFile = path.join(packDir, 'INTENT.md');
const intentBytes = readFileSync(intentFile);
try {
  writeFileSync(intentFile, Buffer.concat([intentBytes, Buffer.from('\n')]));
  assert.throws(() => applyPackTransfer({ from: packDir, to: staleTo, mode: 'install', reviewSha256: staleReview.reviewSha256 }), /changed|review|no longer hashes/);
} finally {
  writeFileSync(intentFile, intentBytes);
}
assert.equal(existsSync(staleTo), false);
assert.equal(packStage(packDir).stage, 'released');

const candidate = path.join(runtimeRoot, 'candidate', packId);
cpSync(packDir, candidate, { recursive: true });
rmSync(path.join(candidate, 'VERSION.yml'));
for (const name of ['contract.yml', 'graph.yml']) {
  const at = path.join(candidate, name);
  writeFileSync(at, readFileSync(at, 'utf8').replace(/^version:\s*.+$/m, 'version: "2"'));
}
const oldDigest = packDigestOf(installed);
const locked = path.join(installed, 'tools');
chmodSync(locked, 0o500);
try {
  assert.throws(() => installPackMethod({ from: candidate, to: installed }), /EACCES|EPERM/);
  assert.throws(() => loadPack(path.dirname(installed), packId), /interrupted method update/);
} finally {
  chmodSync(locked, 0o700);
}
const rolledBack = recoverPackMethod({ to: installed, action: 'rollback' });
assert.equal(rolledBack.digest, oldDigest);
assert.equal(packDigestOf(installed), oldDigest);
assert.deepEqual(readFileSync(customerAsset), customerBytes);
assert.equal(packStage(installed).stage, 'released');

const verification = {
  schema: 'hima.wave3-library-authoring-verification/1',
  recordedAt: new Date().toISOString(),
  sourceEvidence: { path: evidenceFile, sha256: sha256(readFileSync(evidenceFile)) },
  pack: { id: packId, version: pack.contract.version, digest, stage, path: packDir },
  test: { runId, status: runEntry.run.status, jobsLaunched: launched.length, jobsFinishedExit0: finished.length,
    records: records.length, testSha256: sha256(testBytes), versionSha256: sha256(versionBytes) },
  scope: { wrappers, toolCount: pack.contract.tools.length, workshopCount: pack.contract.workshops.length,
    licences: pack.contract.workshops.flatMap((workshop) => Object.keys(workshop.licences)), commercialEdaExecuted: false },
  negativeReader: { exitCode: readerResult.status, value: malformedValue?.value ?? null,
    unknownReason: malformedValue?.unknownReason, successValueEmitted: typeof malformedValue?.value === 'number' },
  transfer: { installReviewSha256: installReview.reviewSha256, upgradeReviewSha256: upgradeReview.reviewSha256,
    staleReviewSha256: staleReview.reviewSha256, staleDestinationCreated: existsSync(staleTo) },
  rollback: { oldDigest, recoveredDigest: rolledBack.digest, customerAssetSha256: sha256(customerBytes), customerAssetPreserved: true },
  claims: { issue60: 'PASS', libraryE1E4Requalified: false, productionLibraryFact: false },
};
const output = path.join(path.dirname(evidenceFile), 'verification.json');
writeFileSync(output, `${JSON.stringify(verification, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({ status: 'PASS', output, digest, runId }, null, 2)}\n`);
