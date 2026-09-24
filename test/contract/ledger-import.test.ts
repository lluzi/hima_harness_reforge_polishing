// L2: a real Host writes the legacy-shaped fixture; an explicit offline copy preserves its facts
// in another real Host. The old home still fails the storage gate. No desktop or model is needed.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { importLegacyLedger, type LedgerRecord, type RunRecord } from '@hima/harness';
import { createHimaHome, repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
import { himaProfileDir, prepareHimaHome } from '../../packages/desktop/src/hima-home.ts';

const execute = promisify(execFile);
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const storedAt = (home: string): string => path.join(home, 'storages/hima_ledger.json');
interface Snapshot {
  unit: { name: string; version: number };
  global: null;
  tables: { runs: Record<string, RunRecord>; records: Record<string, LedgerRecord> };
}
let temporary: string;
let oldHome: HimaHome;
let snapshot: Snapshot;
let v28Snapshot: Snapshot;
let sourceFile: string;
let original: Buffer;
let runId: string;

/** Project lineage was introduced by v28.  A historical fixture is a projection of current facts
 * onto the source version's actual vocabulary, never a current row with only its version relabelled. */
function beforeProjectLineage(current: Snapshot, version: 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27): Snapshot {
  const historical = structuredClone(current);
  historical.unit.version = version;
  for (const run of Object.values(historical.tables.runs)) delete run.projectSessionId;
  return historical;
}

before(async () => {
  temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'hima-import-')));
  oldHome = await createHimaHome();
  await writeLocalSite(oldHome);
  const report = await writeSampleReport(oldHome);
  const host = await bootInProcess(oldHome);
  try {
    const first = await himaCommand(host, oldHome.workspace, `/hima observe local ${report.rel}`);
    assert.equal(first.kind, 'success', first.text);
    assert.ok(first.runId);
    runId = first.runId;
    const second = await himaCommand(host, oldHome.workspace, `/hima observe local ${report.rel} --run ${runId}`);
    assert.equal(second.kind, 'success', second.text);
    // A second real Run keeps cross-Run corruption distinguishable from an unknown id.
    await host.ctx.hima.ledger.createRun({ campaignId: 'import-empty-history', siteId: 'local' });
    assert.equal(host.ctx.hima.ledger.records({ runId }).length, 2);
  } finally { await host.dispose(); }
  const current = JSON.parse(await readFile(storedAt(oldHome.home), 'utf8')) as Snapshot;
  assert.equal(current.unit.version, 29);
  v28Snapshot=structuredClone(current);v28Snapshot.unit.version=28;
  assert.ok(Object.values(current.tables.runs).every((run) => run.control === undefined));
  // v19 ad84d2f wrote these same observation/Run shapes. Only its storage stamp differs, exactly
  // as ledger-version.test.ts generates the prior-version fixture from real persisted facts. The
  // current Probe's projectSessionId is v28 lineage, so the source projection explicitly omits it.
  snapshot = beforeProjectLineage(current, 19);
  original = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`);
  sourceFile = path.join(temporary, 'offline-v19.json');
  await writeFile(sourceFile, original);
  await writeFile(storedAt(oldHome.home), original);
});
after(async () => {
  await oldHome?.dispose();
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test('offline v21 to v27 polishing facts import into the current domain without rewriting source bytes', async () => {
  for (const version of [21, 22, 23, 24, 25, 26, 27]) {
    const document = { ...snapshot, unit: { name: 'hima_ledger', version } };
    const bytes = Buffer.from(JSON.stringify(document));
    const source = path.join(temporary, `polishing-v${version}.json`);
    const targetHome = path.join(temporary, `polishing-v${version}-imported`);
    await writeFile(source, bytes);
    const receipt = await importLegacyLedger({ sourceFile: source, home: targetHome });
    assert.equal(receipt.source.version, version);
    const imported = JSON.parse(await readFile(storedAt(targetHome), 'utf8'));
    assert.equal(imported.unit.version, 29);
    assert.deepEqual(imported.tables, document.tables);
    assert.deepEqual(await readFile(source), bytes);
  }
});

test('v28 import preserves actual project lineage and refuses a v29 delegation discriminator', async () => {
  const source=path.join(temporary,'v28-project.json');const bytes=Buffer.from(JSON.stringify(v28Snapshot));
  await writeFile(source,bytes);const target=await freshDestination('v28');
  const receipt=await importLegacyLedger({sourceFile:source,home:target});
  assert.equal(receipt.source.version,28);assert.equal(receipt.target.version,29);
  assert.deepEqual(JSON.parse(await readFile(storedAt(target),'utf8')).tables,v28Snapshot.tables);
  assert.deepEqual(await readFile(source),bytes);
  const corrupt=structuredClone(v28Snapshot);const [key,row]=Object.entries(corrupt.tables.records)[0]!;
  corrupt.tables.records[key]={...row,type:'delegation'} as unknown as LedgerRecord;
  const bad=path.join(temporary,'v28-forward-record.json');await writeFile(bad,JSON.stringify(corrupt));
  await assert.rejects(importLegacyLedger({sourceFile:bad,home:await freshDestination('v28-reject')}));
});

async function freshDestination(label: string): Promise<string> {
  const parent = await mkdtemp(path.join(temporary, `${label}-`));
  return path.join(parent, 'home');
}
async function unchangedRefusal(bytes: string | Buffer, expected: RegExp): Promise<void> {
  const home = await freshDestination('refused');
  const source = path.join(path.dirname(home), 'source.json');
  await writeFile(source, bytes);
  const before = await readFile(source);
  await assert.rejects(importLegacyLedger({ sourceFile: source, home }), expected);
  assert.deepEqual(await readFile(source), before);
  await assert.rejects(stat(home), { code: 'ENOENT' });
  assert.deepEqual(await readdir(path.dirname(home)), ['source.json'], 'validation creates no staging or target');
}

test('explicit offline CLI imports v19 facts and a source hash receipt into a new empty home, read unchanged by a real Host', async () => {
  const home = await freshDestination('readback');
  await mkdir(home); // Both a pre-created empty home and an absent one are supported.
  const { stdout, stderr } = await execute(process.execPath, [
    path.join(repoRoot, 'packages/desktop/lib/hima-home.js'), '--import-ledger', sourceFile, '--home', home,
  ], { cwd: repoRoot, timeout: 15_000 });
  assert.equal(stderr, '');
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.source.sha256, hash(original));
  assert.equal(receipt.source.bytes, original.length);
  assert.equal(receipt.source.version, 19);
  assert.equal(receipt.target.version, 29);
  assert.equal(receipt.runs, 2);
  assert.equal(receipt.records, 2);
  assert.equal(receipt.ownership, 'unchanged-unowned');
  assert.deepEqual(JSON.parse(await readFile(path.join(home, 'ledger-import/receipt.json'), 'utf8')), receipt);
  assert.deepEqual(await readFile(path.join(home, receipt.source.backup)), original);
  const importedBytes = await readFile(storedAt(home));
  assert.equal(hash(importedBytes), receipt.target.sha256);
  const imported = JSON.parse(importedBytes.toString()) as Snapshot;
  assert.deepEqual(imported.tables, snapshot.tables);
  assert.equal(imported.unit.version, 29);
  assert.deepEqual((await readdir(home)).sort(), ['ledger-import', 'storages'], 'the offline command did not start or prepare a Host');
  const workspace = path.join(home, 'workspace');
  await mkdir(workspace);
  await prepareHimaHome({ home, root: repoRoot });
  const freshHome: HimaHome = {
    home, workspace, profileDir: himaProfileDir(home),
    env: { ...oldHome.env, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'agents') },
    dispose: async () => {},
  };
  const host = await bootInProcess(freshHome);
  try {
    await host.ctx.hima.reconciled;
    assert.deepEqual(Object.fromEntries(host.ctx.hima.ledger.runs().map((run) => [run.id, run])), snapshot.tables.runs);
    for (const record of Object.values(snapshot.tables.records)) assert.deepEqual(host.ctx.hima.ledger.record(record.id), record);
    assert.ok(host.ctx.hima.ledger.records({ runId }).every((record) => record.type === 'observation'));
  } finally { await host.dispose(); }
  assert.deepEqual(await readFile(sourceFile), original);
  assert.deepEqual(await readFile(storedAt(oldHome.home)), original);
});

test('opening the original v19 home still fails the version gate without rewriting it', async () => {
  await assert.rejects(bootInProcess(oldHome), /version-mismatch|stored version 19 != expected 29/);
  assert.deepEqual(await readFile(storedAt(oldHome.home)), original);
});

test('an explicit v20 snapshot is copied into an empty v21 home while its source stays byte-for-byte intact', async () => {
  const source = path.join(temporary, 'offline-v20.json');
  const v20 = { ...structuredClone(snapshot), unit: { name: 'hima_ledger', version: 20 } };
  const bytes = Buffer.from(`${JSON.stringify(v20, null, 2)}\n`);
  await writeFile(source, bytes);
  const home = await freshDestination('v20-readback');
  const receipt = await importLegacyLedger({ sourceFile: source, home });
  assert.equal(receipt.source.version, 20);
  assert.equal(receipt.target.version, 29);
  assert.deepEqual(await readFile(source), bytes);
  const copied = JSON.parse(await readFile(storedAt(home), 'utf8')) as Snapshot;
  assert.equal(copied.unit.version, 29);
  assert.deepEqual(copied.tables, v20.tables);
});

test('importing an owned v20 Run preserves its recorded owner and reports that ownership truthfully', async () => {
  const source = path.join(temporary, 'offline-owned-v20.json');
  const v20 = { ...structuredClone(snapshot), unit: { name: 'hima_ledger', version: 20 } };
  v20.tables.runs[runId]!.control = { mode: 'agent', owner: 'session-recorded-owner', epoch: 1, revision: 0,
    paused: [], requests: {}, executions: {} };
  const bytes = Buffer.from(`${JSON.stringify(v20, null, 2)}\n`);
  await writeFile(source, bytes);
  const home = await freshDestination('owned-v20-readback');
  const receipt = await importLegacyLedger({ sourceFile: source, home });
  assert.equal(receipt.ownership, 'unchanged-owned');
  const copied = JSON.parse(await readFile(storedAt(home), 'utf8')) as Snapshot;
  assert.deepEqual(copied.tables.runs[runId]!.control, v20.tables.runs[runId]!.control);
  assert.deepEqual(await readFile(source), bytes);
});

test('v20 import rejects bad workspace ownership and missing or cross-Run evidence citations before staging a home', async () => {
  const base = { ...structuredClone(snapshot), unit: { name: 'hima_ledger', version: 20 } };
  const run = base.tables.runs[runId]!;
  const observation = Object.values(base.tables.records)[0]!;
  const other = Object.values(base.tables.runs).find((candidate) => candidate.id !== runId)!;
  const otherId = `${other.id}#${String(other.nextSeq).padStart(6, '0')}`;
  base.tables.records[otherId] = { ...observation, id: otherId, runId: other.id, siteId: other.siteId, seq: other.nextSeq } as LedgerRecord;
  other.nextSeq += 1;
  const append = (record: Record<string, unknown>) => {
    const changed = structuredClone(base);
    const next = changed.tables.runs[runId]!.nextSeq;
    const id = `${runId}#${String(next).padStart(6, '0')}`;
    changed.tables.runs[runId]!.nextSeq += 1;
    changed.tables.records[id] = { ...record, id, runId, siteId: run.siteId, seq: next, at: observation.at, writer: 'executor' } as LedgerRecord;
    return changed;
  };
  const workspace = append({ type: 'workspace', event: 'prepared', campaignId: 'another-campaign', packId: 'fixture', packVersion: '1', packDigest: 'a'.repeat(64), workspace: '/workspace', flowRoot: '/flow', containerName: 'fixture', copied: [], preparedAt: observation.at });
  await unchangedRefusal(JSON.stringify(workspace), /Campaign linkage/);
  for (const cites of [['missing-record'], [otherId]]) {
    const verdict = append({ type: 'verdict', outcome: 'PASS', ruleId: 'fixture-rule', ruleVersion: '1', cites, valuesAsRead: [] });
    await unchangedRefusal(JSON.stringify(verdict), /evidence linkage/);
  }
});

test('wrong formats, future controls and unknown fields cannot be silently dropped during import', async () => {
  await unchangedRefusal('{broken', /JSON/);
  await unchangedRefusal(Buffer.from([0xff]), /encoded data/);
  for (const change of [
    (s: any) => { s.unit.version = 99; },
    (s: any) => { s.unit.version = 18; },
    (s: any) => { s.unit.name = 'foreign'; },
    (s: any) => { s.unit.future = true; },
    (s: any) => { s.tables.future = {}; },
    (s: any) => { s.global = {}; },
    (s: any) => { s.tables.runs[runId].control = { mode: 'agent', owner: 'forged', epoch: 1, revision: 0, paused: [], requests: {}, executions: {} }; },
    (s: any) => { s.tables.runs[runId].future = 'keep me'; },
    (s: any) => { Object.values<any>(s.tables.records)[0].reader.future = 'keep me'; },
    (s: any) => { Object.values<any>(s.tables.records)[0].agent = { sessionId: 'forged', executionId: 'forged' }; },
  ]) {
    const changed = structuredClone(snapshot);
    change(changed);
    await unchangedRefusal(JSON.stringify(changed), /Invalid|Unrecognized|unsupported/);
  }
  for (const version of [20, 27] as const) {
    const future = beforeProjectLineage(snapshot, version);
    future.tables.runs[runId]!.projectSessionId = 'future-project-session';
    await unchangedRefusal(JSON.stringify(future), /Guide\/project lineage requires source v28/);
  }
});

test('Run keys, record identity, site linkage and nextSeq cannot corrupt imported history', async () => {
  for (const change of [
    (s: Snapshot) => { s.tables.runs[runId]!.id = 'another'; },
    (s: Snapshot) => { Object.values(s.tables.records)[0]!.runId = 'missing'; },
    (s: Snapshot) => { Object.values(s.tables.records)[0]!.siteId = 'another'; },
    (s: Snapshot) => { Object.values(s.tables.records)[0]!.seq = 2; },
    (s: Snapshot) => { Object.values(s.tables.records)[0]!.id = 'another'; },
    (s: Snapshot) => { s.tables.runs[runId]!.nextSeq = 2; },
  ]) {
    const changed = structuredClone(snapshot);
    change(changed);
    await unchangedRefusal(JSON.stringify(changed), /invalid imported/);
  }
  // A real append reserves nextSeq first: a prior failed write can leave a gap. Preserve it.
  const withGap = structuredClone(snapshot);
  withGap.tables.runs[runId]!.nextSeq += 1;
  const home = await freshDestination('gap');
  const source = path.join(path.dirname(home), 'gap.json');
  await writeFile(source, JSON.stringify(withGap));
  await importLegacyLedger({ sourceFile: source, home });
  assert.deepEqual(JSON.parse(await readFile(storedAt(home), 'utf8')).tables, withGap.tables);
});

test('v20-only Job, workspace and decision facts are refused even with a v19 header', async () => {
  const old = Object.values(snapshot.tables.records)[0]!;
  const base = { id: old.id, runId: old.runId, siteId: old.siteId, seq: old.seq, at: old.at, writer: old.writer };
  for (const record of [
    { ...base, type: 'job', event: 'launched', job: { session: 'unknown-launch', workspace: '/offline', name: 'job', startedAt: old.at, wire: 'true' } },
    { ...base, type: 'workspace', event: 'prepared', campaignId: snapshot.tables.runs[runId]!.campaignId,
      packId: 'legacy', packVersion: '1', packDigest: 'a'.repeat(64), workspace: '/offline', flowRoot: '/flow',
      design: 'test', containerName: 'container', copied: [], preparedAt: old.at },
    { ...base, type: 'decision', nodeId: 'explore', chooser: 'legacy', chooserOrigin: 'pack',
      chosen: { goalMet: true }, rationale: {}, cites: [], agent: { sessionId: 'forged', executionId: 'forged' } },
  ]) {
    const changed = { ...snapshot, tables: { ...snapshot.tables, records: { ...snapshot.tables.records, [old.id]: record } } };
    await unchangedRefusal(JSON.stringify(changed), /Invalid|Unrecognized|unsupported/);
  }
});

test('symlink files, symlink ancestors, occupied targets and source-containing targets are refused unchanged', async () => {
  const home = await freshDestination('paths');
  const base = path.dirname(home);
  const sourceLink = path.join(base, 'linked-source.json');
  await symlink(sourceFile, sourceLink);
  await assert.rejects(importLegacyLedger({ sourceFile: sourceLink, home }), /symlink/);
  const sourceParentLink = path.join(base, 'source-parent');
  await symlink(temporary, sourceParentLink);
  await assert.rejects(importLegacyLedger({ sourceFile: path.join(sourceParentLink, 'offline-v19.json'), home }), /symlink/);
  const elsewhere = path.join(base, 'elsewhere');
  await mkdir(elsewhere);
  await symlink(elsewhere, home);
  await assert.rejects(importLegacyLedger({ sourceFile, home }), /symlink/);
  await assert.rejects(importLegacyLedger({ sourceFile, home: path.join(home, 'child') }), /symlink/);
  assert.deepEqual(await readdir(elsewhere), []);
  await rm(home);
  await mkdir(home);
  await writeFile(path.join(home, 'user.txt'), 'do not touch');
  await assert.rejects(importLegacyLedger({ sourceFile, home }), /new empty home/);
  assert.equal(await readFile(path.join(home, 'user.txt'), 'utf8'), 'do not touch');
  assert.deepEqual(await readdir(home), ['user.txt']);
  await assert.rejects(importLegacyLedger({ sourceFile, home: temporary }), /source must be outside/);
  await assert.rejects(importLegacyLedger({ sourceFile: base, home }), /regular offline/);
  assert.deepEqual(await readFile(sourceFile), original);
});

test('mid-write failure and process death cannot publish a partial import or alter the source', async () => {
  const home = await freshDestination('interrupted');
  const source = path.join(path.dirname(home), 'large.json');
  const changed = structuredClone(snapshot);
  const first = Object.values(changed.tables.records)[0]!;
  assert.equal(first.type, 'observation');
  if (first.type === 'observation') first.reader.version = 'x'.repeat(2 * 1024 * 1024);
  await writeFile(source, JSON.stringify(changed));
  const before = await readFile(source);
  // Observe persistent filesystem state, not delivery of a named fs.watch notification. The
  // staging name can disappear before a look, but successful publication leaves the final home.
  // Keep only this private child alive so either observed state permits an actual SIGKILL.
  const child = spawn(process.execPath, ['--input-type=module', '--eval',
    'const hold = setInterval(() => {}, 1000); await import((await import("node:url")).pathToFileURL(process.argv[1]).href); if (process.exitCode) clearInterval(hold);',
    path.join(repoRoot, 'packages/desktop/lib/hima-home.js'), '--import-ledger', source, '--home', home,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += String(chunk); });
  child.stderr.on('data', (chunk) => { diagnostics += String(chunk); });
  let spawnError: Error | undefined;
  const closed = new Promise<NodeJS.Signals | null>((resolve) => {
    child.once('error', (error) => { spawnError = error; resolve(null); });
    child.once('close', (_code, signal) => resolve(signal));
  });
  try {
    const deadline = Date.now() + 15_000;
    let files: string[] = [];
    let sawImportOutput = false;
    while (Date.now() < deadline && child.exitCode === null && child.signalCode === null && spawnError === undefined) {
      files = await readdir(path.dirname(home));
      sawImportOutput = files.some((name) => name.startsWith('.hima-ledger-import-') || name === path.basename(home));
      if (sawImportOutput) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ifError(spawnError);
    assert.ok(sawImportOutput, `import output absent; files=${JSON.stringify(files)}; child=${diagnostics}`);
    child.kill('SIGKILL');
    assert.equal(await closed, 'SIGKILL');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
  const published = await stat(home).then((found) => {
    assert.ok(found.isDirectory());
    return true;
  }, (error: NodeJS.ErrnoException) => {
    assert.equal(error.code, 'ENOENT');
    return false;
  });
  if (published) {
    // The rename may win the race. Every file and every source fact must then be present; an
    // existing directory, a parseable Ledger alone, or an unverified receipt is not a pass.
    const imported = await readFile(storedAt(home));
    assert.deepEqual(JSON.parse(imported.toString()), { ...changed, unit: { name: 'hima_ledger', version: 29 } });
    assert.deepEqual(await readFile(path.join(home, 'ledger-import/source-v19.json')), before);
    const receipt = JSON.parse(await readFile(path.join(home, 'ledger-import/receipt.json'), 'utf8'));
    assert.match(receipt.importedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(receipt, {
      format: 'hima-ledger-import-v1',
      source: { path: source, version: 19, sha256: hash(before), bytes: before.length, backup: 'ledger-import/source-v19.json' },
      target: { version: 29, sha256: hash(imported), file: 'storages/hima_ledger.json' },
      importedAt: receipt.importedAt, runs: Object.keys(changed.tables.runs).length,
      records: Object.keys(changed.tables.records).length, ownership: 'unchanged-unowned',
    });
    assert.deepEqual((await readdir(home)).sort(), ['ledger-import', 'storages']);
  }
  assert.deepEqual(await readFile(source), before);
  // A real OS file-size limit returns EFBIG from the backup write. The caught-failure path must
  // clean only its own staging. A separate absent target proves that path even if publication won
  // the kill race, while preserving the earlier run's complete home or unpublished remnants.
  const writeErrorHome = path.join(path.dirname(home), 'write-error-home');
  const held = (await readdir(path.dirname(home))).sort();
  await assert.rejects(execute('/bin/sh', ['-c', 'ulimit -f 1; exec "$@"', 'import-test', process.execPath,
    path.join(repoRoot, 'packages/desktop/lib/hima-home.js'), '--import-ledger', source, '--home', writeErrorHome,
  ], { timeout: 15_000 }), /EFBIG/);
  assert.deepEqual((await readdir(path.dirname(home))).sort(), held);
  await assert.rejects(stat(writeErrorHome), { code: 'ENOENT' });
  assert.deepEqual(await readFile(source), before);
});

test('the offline CLI requires both explicit paths and never defaults to DSH_HOME', async () => {
  const home = await freshDestination('args');
  await assert.rejects(execute(process.execPath, [path.join(repoRoot, 'packages/desktop/lib/hima-home.js'), '--import-ledger', sourceFile], {
    env: { ...process.env, DSH_HOME: home }, timeout: 15_000,
  }), /usage: node/);
  await assert.rejects(stat(home), { code: 'ENOENT' });
});

test('two simultaneous imports cannot replace the first complete destination', async () => {
  const home = await freshDestination('concurrent');
  const results = await Promise.allSettled([
    importLegacyLedger({ sourceFile, home }), importLegacyLedger({ sourceFile, home }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.deepEqual(JSON.parse(await readFile(storedAt(home), 'utf8')).tables, snapshot.tables);
  assert.deepEqual(await readFile(path.join(home, 'ledger-import/source-v19.json')), original);
  assert.deepEqual(await readdir(path.dirname(home)), ['home']);
});
