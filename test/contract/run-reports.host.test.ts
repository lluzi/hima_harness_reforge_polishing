// The Host's reader of a Run's tool reports (`contract.reports.dir`), on a real local Site with real
// files on disk. The durable Run facts the reader needs — the Run, its Campaign workspace, and its
// frozen method's reports folder and node order — are the three lookups the DBOS rewire points at
// (`readRun`, `readRunRecords(runId,'workspace')`, `executionContext(runId).method`); here they come
// from a faithful stand-in so the subject is the listing, the read and the path safety, not a
// Postgres boot. The real durable readers are proved in `durable-views.host.test.ts`, and a real
// AndesCell Run end to end in the `atcs-dry` group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listRunReports, readRunReport, ReportPathError } from '@hima/harness';
import { writeLocalSite } from '../../packages/desktop/src/local-site.ts';

/** A stand-in for the durable readers `RunReports` needs: the three lookups the DBOS rewire points at. */
function readersOf(workspace: string, reportsDir: string | undefined, nodeOrder: readonly string[]) {
  return {
    readRun: async () => ({ id: 'run-x', siteId: 'local' }),
    readRunRecords: async (_runId: string, type?: string) =>
      type === 'workspace' || type === undefined ? [{ type: 'workspace', workspace }] : [],
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
