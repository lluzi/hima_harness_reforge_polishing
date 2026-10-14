// The Host's reader of a Run's tool reports (`contract.reports.dir`), on a real local Site with real
// files on disk. The durable Run facts the reader needs — the Run, its Campaign workspace, and its
// frozen method's reports folder and node order — are the three lookups the DBOS rewire points at
// (`readRun`, `readRunRecords(runId,'workspace')`, `executionContext(runId).method`); here they come
// from a faithful stand-in so the subject is the listing, the read and the path safety, not a
// Postgres boot. The real durable readers are proved in `durable-views.host.test.ts`, and a real
// AndesCell Run end to end in the `atcs-dry` group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { listRunReports, readRunReport, ReportPathError, LocalChannel } from '@hima/harness';
import { writeLocalSite } from '../../packages/desktop/src/local-site.ts';

/** A stand-in for the durable readers `RunReports` needs: the three lookups the DBOS rewire points at. */
function readersOf(workspace: string, reportsDir: string | undefined, nodeOrder: readonly string[]) {
  return {
    readRun: async () => ({ id: 'run-x', siteId: 'local' }),
    readRunWorkspace: async () => workspace,
    executionContext: async () => ({
      method: { id: 'p', version: '1', digest: 'd', dir: 'p', contract: reportsDir === undefined ? {} : { reports: { dir: reportsDir } },
        reference: { nodes: nodeOrder.map((id) => ({ id, kind: 'act' })) } },
    }),
  };
}

/** A temp tree holding a Sites dir and one Campaign workspace with reports under it. */
async function fixture(): Promise<{ root: string; sitesDir: string; workspace: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-reports-'));
  const sitesDir = path.join(root, 'sites');
  const workspace = path.join(root, 'ws', 'campaign-x');
  await mkdir(workspace, { recursive: true });
  await writeLocalSite({ sitesDir, workspaceRoot: path.join(root, 'ws'), allowedReadRoots: [path.join(root, 'ws')] });
  const write = async (rel: string, body: string) => { const abs = path.join(workspace, rel); await mkdir(path.dirname(abs), { recursive: true }); await writeFile(abs, body); };
  await write('reports/synth/r1/timing.rpt', 'round one synth timing\n');
  await write('reports/synth/r2/timing.rpt', 'round two synth timing\n');
  await write('reports/place/r1/area.rpt', 'round one place area\n');
  await write('reports/synth/r2/fmax.chart.json', '{"schema":"hima-chart/1"}\n');
  return { root, sitesDir, workspace };
}

test('lists a Run\'s reports grouped by node and round, newest round first, with sizes', async () => {
  const fx = await fixture();
  try {
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    const view = await listRunReports(deps as never, 'run-x');
    assert.equal(view.error, undefined, view.error);
    assert.equal(view.dir, 'reports');
    // Newest round first (r2 before r1), then the method's node order (synth before place), then
    // file name ascending within a node/round (fmax.chart.json before timing.rpt).
    assert.deepEqual(view.files.map((f) => f.path), [
      'reports/synth/r2/fmax.chart.json',
      'reports/synth/r2/timing.rpt',
      'reports/synth/r1/timing.rpt',
      'reports/place/r1/area.rpt',
    ]);
    for (const file of view.files) assert.ok(file.bytes > 0, `${file.path} has a size`);
    assert.equal(view.files[0]!.node, 'synth');
    assert.equal(view.files[0]!.round, 2);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('reads one report\'s bounded text', async () => {
  const fx = await fixture();
  try {
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    const read = await readRunReport(deps as never, 'run-x', 'reports/synth/r1/timing.rpt');
    assert.equal(read.text, 'round one synth timing\n');
    assert.equal(read.truncated, false);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('a report longer than the bound comes back truncated and cut to the bound', async () => {
  const fx = await fixture();
  try {
    const big = 'x'.repeat(256 * 1024 + 50);
    await writeFile(path.join(fx.workspace, 'reports/synth/r1/timing.rpt'), big);
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    const read = await readRunReport(deps as never, 'run-x', 'reports/synth/r1/timing.rpt');
    assert.equal(read.truncated, true);
    assert.equal(read.text.length, 256 * 1024);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('a path outside the reports folder is refused with ReportPathError', async () => {
  const fx = await fixture();
  try {
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    await assert.rejects(() => readRunReport(deps as never, 'run-x', 'other/synth/r1/timing.rpt'),
      (error: unknown) => error instanceof ReportPathError && !error.missing && /not a report path/.test(error.message));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('a `..` path is refused with ReportPathError before any read', async () => {
  const fx = await fixture();
  try {
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    await assert.rejects(() => readRunReport(deps as never, 'run-x', 'reports/synth/../../../etc/passwd'),
      (error: unknown) => error instanceof ReportPathError);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('a Run whose Pack declares no reports folder lists empty, not an error', async () => {
  const fx = await fixture();
  try {
    const deps = { readers: readersOf(fx.workspace, undefined, ['synth', 'place']), sitesDir: fx.sitesDir };
    const view = await listRunReports(deps as never, 'run-x');
    assert.deepEqual(view.files, []);
    assert.equal(view.error, undefined);
    assert.equal(view.dir, undefined);
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

// I3: the confinement surface — the realpath `inside` check and the channel's exact `find`/`head`
// admissions — exercised directly, so a later refactor that drops `inside(...)` or the `-type f`/`-P`
// flags fails here instead of passing silently. The `..` shape above is refused by the regex alone,
// so these use real symlinks and non-regular files on the local Site fixture.

test('I3: a report that is a symlink to a file OUTSIDE the project folder is refused by the inside check', async () => {
  const fx = await fixture();
  try {
    // The link target is inside the Site's allowed read root (root/ws) but outside the campaign
    // workspace (root/ws/campaign-x), so the Permit admits the path and only `inside(real, ws)` can
    // refuse it — the exact check a refactor might drop.
    await writeFile(path.join(fx.root, 'ws', 'secret.txt'), 'not in the project folder\n');
    await symlink(path.join(fx.root, 'ws', 'secret.txt'), path.join(fx.workspace, 'reports/synth/r1/leak.rpt'));
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    await assert.rejects(() => readRunReport(deps as never, 'run-x', 'reports/synth/r1/leak.rpt'),
      (error: unknown) => error instanceof ReportPathError && /outside this Run's project folder/.test(error.message));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('I3: a report whose PARENT directory is a symlink out of the project folder is refused', async () => {
  const fx = await fixture();
  try {
    // The whole r-directory is a symlink to a sibling under the read root but outside the workspace.
    await mkdir(path.join(fx.root, 'ws', 'elsewhere'), { recursive: true });
    await writeFile(path.join(fx.root, 'ws', 'elsewhere', 'timing.rpt'), 'elsewhere\n');
    await mkdir(path.join(fx.workspace, 'reports/place'), { recursive: true });
    await symlink(path.join(fx.root, 'ws', 'elsewhere'), path.join(fx.workspace, 'reports/place/r9'));
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    await assert.rejects(() => readRunReport(deps as never, 'run-x', 'reports/place/r9/timing.rpt'),
      (error: unknown) => error instanceof ReportPathError && /outside this Run's project folder/.test(error.message));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('I3: a FIFO (non-regular file) is refused as not a file, and never hangs the bounded read', async () => {
  const fx = await fixture();
  try {
    execFileSync('mkfifo', [path.join(fx.workspace, 'reports/synth/r1/pipe.rpt')]);
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    // `test -f` rejects the FIFO before any `head`, so the read returns at once rather than blocking.
    await assert.rejects(() => readRunReport(deps as never, 'run-x', 'reports/synth/r1/pipe.rpt'),
      (error: unknown) => error instanceof ReportPathError && /is not a file/.test(error.message));
    // A FIFO is not a regular file, so `find -type f` never lists it either.
    const view = await listRunReports(deps as never, 'run-x');
    assert.ok(!view.files.some((f) => f.name === 'pipe.rpt'), 'a FIFO is not listed');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('I3: a binary (NUL-bearing) report is refused as not text', async () => {
  const fx = await fixture();
  try {
    await writeFile(path.join(fx.workspace, 'reports/synth/r1/timing.rpt'), Buffer.from([0x41, 0x00, 0x42]));
    const deps = { readers: readersOf(fx.workspace, 'reports', ['synth', 'place']), sitesDir: fx.sitesDir };
    await assert.rejects(() => readRunReport(deps as never, 'run-x', 'reports/synth/r1/timing.rpt'),
      (error: unknown) => error instanceof ReportPathError && /binary file/.test(error.message));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('I3: the channel admits exactly the report listing and read shapes, and refuses near-misses', async () => {
  const fx = await fixture();
  try {
    const channel = new LocalChannel('local');
    const root = path.join(fx.workspace, 'reports');
    const file = path.join(fx.workspace, 'reports/synth/r1/timing.rpt');
    // Accepted: the exact listing and the bounded read.
    assert.equal((await channel.exec(['find', root, '-mindepth', '3', '-maxdepth', '3', '-type', 'f', '-print0'])).code, 0);
    assert.equal((await channel.exec(['head', '-c', '1024', '--', file])).code, 0);
    // Refused near-misses: link-following find, a caller predicate, a zero/relative/`--`-less head.
    for (const argv of [
      ['find', '-L', root, '-mindepth', '3', '-maxdepth', '3', '-type', 'f', '-print0'],
      ['find', root, '-mindepth', '3', '-maxdepth', '3', '-exec', 'cat', '{}', ';'],
      ['head', '-c', '0', '--', file],
      ['head', '-c', '1', '--', 'relative/path'],
      ['head', '-c', '10', file],
    ]) {
      await assert.rejects(() => channel.exec(argv), (error: unknown) => error instanceof Error && /only|admitted/.test(error.message), argv.join(' '));
    }
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});
