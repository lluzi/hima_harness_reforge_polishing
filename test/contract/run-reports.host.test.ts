// The Reports face's wire (strip demo, 2026-10-10): `GET /hima/api/runs/<id>/reports` lists the tool
// reports a Run's Pack leaves at `<campaign workspace>/<contract.reports.dir>/<node>/r<k>/<file>` on the
// Run's Site, and `GET .../reports/file?path=` reads one, bounded and text only. A local Site and local
// files only: the Run is seeded straight into the Ledger with a prepared workspace, and the reports are
// files this test writes, so what is under test is the listing and the read, not a Pack's tools.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { clearRemoteCommands, packDigestOf, remoteCommands, ReportPathError, reportListLimit, reportReadLimit, RunReports,
  type RunReportsView, type RunReportText } from '@hima/harness';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { installPack, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_SILENT_AGENT = '1';

const reportsPackId = 'reports-probe';

interface Fixture {
  readonly h: HimaHome;
  readonly host: InProcessHost;
  readonly sitesDir: string;
  /** The Campaign workspace, as the Site resolves it. */
  readonly workspace: string;
  /** A readable directory outside the workspace, inside the Permit's read roots. */
  readonly outside: string;
  readonly reports: (ttlMs?: number) => RunReports;
  /** Seed one Run of `pack`, prepared in `workspace`. */
  readonly seed: (pack: string) => Promise<string>;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const h = await createHimaHome();
  let host: InProcessHost | undefined;
  t.after(async () => { await host?.dispose(); await h.dispose(); });
  const base = await realpath(h.workspace);
  const workspace = path.join(base, 'campaign-reports');
  const outside = path.join(base, 'outside');
  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });
  const site = await writeLocalSite(h, { allowedReadRoots: [base], allowedWriteRoots: [base] });
  await installPack(h);
  // The shipped timing probe (graph order: synthesize, read-qor, judge, next-period, blocked) with a
  // reports folder declared; the shipped probe itself declares none.
  await writePackVariant(packsDirOf(h), reportsPackId, [['title: opene902 timing probe', 'title: opene902 timing probe\nreports: { dir: reports }']]);
  host = await bootInProcess(h);
  const ledger = host!.ctx.hima.ledger;
  const seed = async (pack: string): Promise<string> => {
    const run = await ledger.createRun({ campaignId: `reports-${pack}`, siteId: 'local', status: 'running', packId: pack,
      packDigest: packDigestOf(path.join(packsDirOf(h), pack)) });
    await ledger.appendWorkspace(run.id, { event: 'prepared', campaignId: `reports-${pack}`, packId: pack, packVersion: '2',
      workspace, flowRoot: workspace, containerName: 'hima-reports', copied: [], preparedAt: new Date().toISOString() });
    return run.id;
  };
  const reports = (ttlMs?: number) => new RunReports(() => ({ ledger, sitesDir: site.sitesDir, packsDir: packsDirOf(h) }), ttlMs);
  return { h, host: host!, sitesDir: site.sitesDir, workspace, outside, reports, seed };
}

async function put(root: string, relative: string, content: string | Uint8Array): Promise<void> {
  const at = path.join(root, relative);
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, content);
}

test('the listing holds regular files at <dir>/<node>/r<k>/<file>, newest round first, then graph order, then name', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed(reportsPackId);
  const w = f.workspace;
  await put(w, 'reports/judge/r1/verdict.txt', 'PASS\n');
  await put(w, 'reports/synthesize/r1/report_qor.rpt', 'QoR round 1\n');
  await put(w, 'reports/read-qor/r2/qor.md', '# QoR\n');
  await put(w, 'reports/synthesize/r2/timing.rpt', 'slack (VIOLATED) -0.044\n');
  await put(w, 'reports/synthesize/r2/area.rpt', 'area 41200\n');
  await put(w, 'reports/aaa-not-a-node/r2/extra.rpt', 'x\n');
  // None of these is a report: a file at the wrong depth, a round folder that is not r<k>, a name
  // outside the allowed characters, an upper-case node, and a link (even one to a file inside).
  await put(w, 'reports/README.md', 'about\n');
  await put(w, 'reports/synthesize/r2/deeper/nested.rpt', 'x\n');
  await put(w, 'reports/synthesize/round2/x.rpt', 'x\n');
  await put(w, 'reports/synthesize/r2/bad name.rpt', 'x\n');
  await put(w, 'reports/Upper-Case/r2/x.rpt', 'x\n');
  await put(f.outside, 'secret.txt', 'outside\n');
  await symlink(path.join(f.outside, 'secret.txt'), path.join(w, 'reports/synthesize/r2/link.rpt'));
  clearRemoteCommands();
  const view = await f.reports().list(runId);
  assert.equal(view.error, undefined, JSON.stringify(view));
  assert.equal(view.dir, 'reports');
  assert.deepEqual(view.files.map((file) => file.path), [
    'reports/synthesize/r2/area.rpt', 'reports/synthesize/r2/timing.rpt', 'reports/read-qor/r2/qor.md', 'reports/aaa-not-a-node/r2/extra.rpt',
    'reports/synthesize/r1/report_qor.rpt', 'reports/judge/r1/verdict.txt',
  ]);
  const timing = view.files[1]!;
  assert.deepEqual({ node: timing.node, round: timing.round, name: timing.name, bytes: timing.bytes },
    { node: 'synthesize', round: 2, name: 'timing.rpt', bytes: Buffer.byteLength('slack (VIOLATED) -0.044\n') });
  assert.ok(!Number.isNaN(Date.parse(view.at)));
  // The listing is the channel's own audited commands: one bounded find, then the sizes.
  const verbs = remoteCommands().map((command) => command.argv.join(' '));
  assert.ok(verbs.some((line) => line.endsWith('-mindepth 3 -maxdepth 3 -type f -print0')), verbs.join('\n'));
  assert.ok(verbs.some((line) => line.startsWith('wc -c --')), verbs.join('\n'));
});

test('the listing is reused for a few seconds per Run, so polling viewers cost one listing', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed(reportsPackId);
  await put(f.workspace, 'reports/synthesize/r1/a.rpt', 'a\n');
  const cached = f.reports();
  const first = await cached.list(runId);
  await put(f.workspace, 'reports/synthesize/r1/b.rpt', 'b\n');
  assert.equal(await cached.list(runId), first, 'within the window the same answer is reused');
  assert.equal((await f.reports(0).list(runId)).files.length, 2, 'a fresh listing sees the new file');
});

test('a Pack that declares no reports answers no files and no dir; a reports folder not there yet answers no files and no error', async (t) => {
  const f = await fixture(t);
  const undeclared = await f.seed(timingProbePackId);
  await put(f.workspace, 'reports/synthesize/r1/a.rpt', 'a\n');
  const none = await f.reports().list(undeclared);
  assert.deepEqual({ ...none, at: undefined }, { files: [], at: undefined });
  await assert.rejects(f.reports().read(undeclared, 'reports/synthesize/r1/a.rpt'), (error: unknown) => error instanceof ReportPathError && error.missing);

  await rm(path.join(f.workspace, 'reports'), { recursive: true });
  const declared = await f.seed(reportsPackId);
  const empty = await f.reports().list(declared);
  assert.deepEqual({ dir: empty.dir, files: empty.files, error: empty.error }, { dir: 'reports', files: [], error: undefined });
});

test('a Site that cannot be asked is an error sentence in the listing, not a failed request', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed(reportsPackId);
  await put(f.workspace, 'reports/synthesize/r1/a.rpt', 'a\n');
  const saved = process.env.PATH;
  const emptyBin = await mkdtemp(path.join(os.tmpdir(), 'hima-no-find-'));
  process.env.PATH = emptyBin;
  let view: RunReportsView;
  try { view = await f.reports().list(runId); } finally { process.env.PATH = saved ?? ''; await rm(emptyBin, { recursive: true, force: true }); }
  assert.deepEqual(view.files, []);
  assert.equal(view.dir, 'reports');
  assert.equal(view.error, 'The Site local could not be reached, so the reports cannot be listed right now.');
});

test('a report reads as bounded text; a long one is truncated; a binary one, a bad shape, a way out and a missing file are refused', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed(reportsPackId);
  const reports = f.reports();
  await put(f.workspace, 'reports/synthesize/r1/timing.rpt', 'Startpoint: key_r[3]\nslack (VIOLATED) -0.044\n');
  const text = await reports.read(runId, 'reports/synthesize/r1/timing.rpt');
  assert.deepEqual(text, { path: 'reports/synthesize/r1/timing.rpt', text: 'Startpoint: key_r[3]\nslack (VIOLATED) -0.044\n', truncated: false } satisfies RunReportText);

  // Longer than the bound, with a multi-byte character straddling it: the cut never yields a fault.
  const long = `${'a'.repeat(reportReadLimit - 1)}é${'b'.repeat(4096)}`;
  await put(f.workspace, 'reports/synthesize/r1/long.rpt', long);
  const cut = await reports.read(runId, 'reports/synthesize/r1/long.rpt');
  assert.equal(cut.truncated, true);
  assert.equal(cut.text, 'a'.repeat(reportReadLimit - 1));

  await put(f.workspace, 'reports/synthesize/r1/layout.gds', new Uint8Array([0x00, 0x02, 0x00, 0x00, 0x06, 0x00]));
  const refused = (missing: boolean) => (error: unknown) => error instanceof ReportPathError && error.missing === missing;
  await assert.rejects(reports.read(runId, 'reports/synthesize/r1/layout.gds'), refused(false));

  for (const bad of ['../outside/secret.txt', '/etc/hosts', 'reports/synthesize/r1/..', 'reports/synthesize/r1/.', 'reports/../reports/synthesize/r1/timing.rpt',
    'reports/Synthesize/r1/timing.rpt', 'reports/synthesize/1/timing.rpt', 'reports/synthesize/r1/sub/timing.rpt', 'other/synthesize/r1/timing.rpt', 'reports/synthesize/r1/bad name']) {
    await assert.rejects(reports.read(runId, bad), refused(false), bad);
  }
  // Well shaped, but a link that resolves outside the Campaign workspace (still inside the read roots).
  await put(f.outside, 'secret.txt', 'outside\n');
  await symlink(path.join(f.outside, 'secret.txt'), path.join(f.workspace, 'reports/synthesize/r1/escape.rpt'));
  await assert.rejects(reports.read(runId, 'reports/synthesize/r1/escape.rpt'), refused(false));
  await assert.rejects(reports.read(runId, 'reports/synthesize/r1/absent.rpt'), refused(true));
});

test(`the listing keeps at most ${reportListLimit} files, dropping the oldest rounds`, async (t) => {
  const f = await fixture(t);
  const runId = await f.seed(reportsPackId);
  for (let round = 1; round <= 6; round += 1) {
    for (let i = 0; i < 100; i += 1) await put(f.workspace, `reports/synthesize/r${round}/f${String(i).padStart(3, '0')}.rpt`, 'x\n');
  }
  const view = await f.reports().list(runId);
  assert.equal(view.files.length, reportListLimit);
  assert.equal(view.files[0]!.round, 6);
  assert.equal(view.files.at(-1)!.round, 2, 'round 1 is the one left out');
});

test('the routes: any viewer lists and reads; a bad path is a coded 400, a missing report or Run a coded 404', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const base = await realpath(h.workspace);
  const workspace = path.join(base, 'campaign-route');
  await mkdir(workspace, { recursive: true });
  await writeLocalSite(h, { allowedReadRoots: [base], allowedWriteRoots: [base] });
  await installPack(h);
  await writePackVariant(packsDirOf(h), reportsPackId, [['title: opene902 timing probe', 'title: opene902 timing probe\nreports: { dir: reports }']]);
  await put(workspace, 'reports/read-qor/r1/qor.md', '# QoR\nFmax 957.67 MHz\n');
  const seeded = await bootInProcess(h);
  let runId: string;
  try {
    const run = await seeded.ctx.hima.ledger.createRun({ campaignId: 'reports-route', siteId: 'local', status: 'running', packId: reportsPackId,
      packDigest: packDigestOf(path.join(packsDirOf(h), reportsPackId)) });
    await seeded.ctx.hima.ledger.appendWorkspace(run.id, { event: 'prepared', campaignId: 'reports-route', packId: reportsPackId, packVersion: '2',
      workspace, flowRoot: workspace, containerName: 'hima-reports', copied: [], preparedAt: new Date().toISOString() });
    runId = run.id;
  } finally { await seeded.dispose(); }
  const host = await bootHimaHost(h);
  try {
    const cookie = await openSession(host);
    const call = async (target: string) => { const res = await api(host, cookie, target); return { status: res.status, body: await res.json() as any }; };
    const listed = await call(`/hima/api/runs/${runId}/reports`);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.dir, 'reports');
    assert.deepEqual(listed.body.files.map((file: any) => [file.node, file.round, file.name, file.path, file.bytes]),
      [['read-qor', 1, 'qor.md', 'reports/read-qor/r1/qor.md', Buffer.byteLength('# QoR\nFmax 957.67 MHz\n')]]);
    const read = await call(`/hima/api/runs/${runId}/reports/file?${new URLSearchParams({ path: 'reports/read-qor/r1/qor.md' })}`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.deepEqual(read.body, { path: 'reports/read-qor/r1/qor.md', text: '# QoR\nFmax 957.67 MHz\n', truncated: false });
    const bad = await call(`/hima/api/runs/${runId}/reports/file?${new URLSearchParams({ path: '../../etc/hosts' })}`);
    assert.deepEqual([bad.status, bad.body.error?.code], [400, 'hima/bad-request'], JSON.stringify(bad.body));
    const noPath = await call(`/hima/api/runs/${runId}/reports/file`);
    assert.deepEqual([noPath.status, noPath.body.error?.code], [400, 'hima/bad-request'], JSON.stringify(noPath.body));
    const missing = await call(`/hima/api/runs/${runId}/reports/file?${new URLSearchParams({ path: 'reports/read-qor/r1/none.md' })}`);
    assert.deepEqual([missing.status, missing.body.error?.code], [404, 'hima/not-found'], JSON.stringify(missing.body));
    const noRun = await call('/hima/api/runs/run-does-not-exist/reports');
    assert.deepEqual([noRun.status, noRun.body.error?.code], [404, 'hima/run-not-found'], JSON.stringify(noRun.body));
  } finally {
    assert.equal(await host.stop(), 0, host.stderr());
  }
});
