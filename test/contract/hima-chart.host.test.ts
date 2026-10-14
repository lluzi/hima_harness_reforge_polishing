// `hima_chart` on the Host: read one chart file a tool or a Pack wrote, hold it to the `hima-chart/1`
// schema, and answer it — a Run report chart through the same bounded, permit-checked Site read the
// Reports face uses, or a chart an installed Pack ships under `knowledge/charts/`. A run chart is
// scoped to the project the way `hima_context` is; a Pack chart is not. The chart bytes are read on a
// real local Site (run charts) and a real installed Pack folder (Pack charts); the durable Run facts
// are the same faithful stand-in `run-reports.host.test.ts` uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, cp, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChartAnswer, RunReports, ChartFileError } from '@hima/harness';
import { writeLocalSite } from '../../packages/desktop/src/local-site.ts';

// The run-side tools register `hima_chart`. Import the built module for its value and take its types
// from the separate declaration tree (`lib/types`), the way the other durable host tests do.
const { himaTools } = await import(new URL('../../packages/harness/lib/tools.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/tools.js');

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const VALID = '{"schema":"hima-chart/1","title":"Fmax by corner","categories":["ss","tt","ff"],"series":[{"name":"after","values":[1.1,1.2,1.3]}],"unit":"GHz","source":"synth report r2"}';

function readersOf(workspace: string) {
  return {
    readRun: async () => ({ id: 'run-x', siteId: 'local' }),
    readRunWorkspace: async () => workspace,
    executionContext: async () => ({ method: { id: 'p', version: '1', digest: 'd', dir: 'p', contract: { reports: { dir: 'reports' } }, reference: { nodes: [{ id: 'synth', kind: 'act' }] } } }),
  };
}

/** A local Site with a Campaign workspace holding `reports/synth/r2/<name>.chart.json`. */
async function runFixture(chartBody: string, name = 'fmax.chart.json'): Promise<{ root: string; reports: RunReports; path: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-chart-run-'));
  const sitesDir = path.join(root, 'sites');
  const workspace = path.join(root, 'ws', 'campaign-x');
  await mkdir(path.join(workspace, 'reports/synth/r2'), { recursive: true });
  await writeLocalSite({ sitesDir, workspaceRoot: path.join(root, 'ws'), allowedReadRoots: [path.join(root, 'ws')] });
  await writeFile(path.join(workspace, 'reports/synth/r2', name), chartBody);
  const reports = new RunReports(() => ({ readers: readersOf(workspace), sitesDir }) as never);
  return { root, reports, path: `reports/synth/r2/${name}` };
}

/** An installed Pack folder that ships a chart under `knowledge/charts/`. */
async function packFixture(chartBody: string): Promise<{ root: string; packsDir: string; pack: string; file: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-chart-pack-'));
  const packsDir = path.join(root, 'packs');
  const pack = 'opene902-timing-probe';
  await cp(path.join(repoRoot, 'packs', pack), path.join(packsDir, pack), { recursive: true });
  await mkdir(path.join(packsDir, pack, 'knowledge/charts'), { recursive: true });
  await writeFile(path.join(packsDir, pack, 'knowledge/charts/area.chart.json'), chartBody);
  return { root, packsDir, pack, file: 'charts/area.chart.json' };
}

test('reads a valid Run chart through the Reports reader', async () => {
  const fx = await runFixture(VALID);
  try {
    const answer = await readChartAnswer({ reports: fx.reports, packsDir: '' }, { runId: 'run-x', path: fx.path });
    assert.equal(answer.chart.title, 'Fmax by corner');
    assert.deepEqual(answer.chart.categories, ['ss', 'tt', 'ff']);
    assert.equal(answer.source.kind, 'run');
    assert.ok('sha256' in answer.source && /^[0-9a-f]{64}$/.test(answer.source.sha256));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('refuses an invalid Run chart, naming the reason', async () => {
  const fx = await runFixture('{"schema":"hima-chart/1","title":"x"}');
  try {
    await assert.rejects(() => readChartAnswer({ reports: fx.reports, packsDir: '' }, { runId: 'run-x', path: fx.path }),
      (error: unknown) => error instanceof ChartFileError && /not a valid hima-chart\/1 chart/.test(error.message));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('refuses a Run chart that is not readable JSON, naming the reason', async () => {
  const fx = await runFixture('{ this is not json');
  try {
    await assert.rejects(() => readChartAnswer({ reports: fx.reports, packsDir: '' }, { runId: 'run-x', path: fx.path }),
      (error: unknown) => error instanceof ChartFileError && /not readable JSON/.test(error.message));
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('reads a Pack chart from its knowledge/charts folder', async () => {
  const fx = await packFixture(VALID);
  try {
    const answer = await readChartAnswer({ reports: new RunReports(() => ({ readers: {}, sitesDir: '' }) as never), packsDir: fx.packsDir }, { pack: fx.pack, file: fx.file });
    assert.equal(answer.chart.title, 'Fmax by corner');
    assert.equal(answer.source.kind, 'pack');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('the hima_chart tool scopes a Run chart to the project, a Pack chart not', async () => {
  const fx = await packFixture(VALID);
  try {
    const tools = himaTools({ packsDir: fx.packsDir, sitesDir: '' } as never, undefined, undefined, undefined, undefined, undefined, undefined);
    const chart = tools.find((tool: { name: string }) => tool.name === 'hima_chart');
    assert.ok(chart, 'hima_chart tool is registered');
    // A Run chart is read as this conversation, so with no live project conversation it is refused
    // before any Site read — exactly as hima_context and hima_execute are.
    await assert.rejects(() => chart!.execute({ runId: 'run-x', path: 'reports/synth/r2/fmax.chart.json' }, { agent: undefined } as never),
      (error: unknown) => error instanceof Error && /live project conversation/.test(error.message));
    // A Pack chart ships with the installed Pack; it needs no project conversation.
    const answer = await chart!.execute({ pack: fx.pack, file: fx.file }, { agent: undefined } as never);
    assert.equal((answer as { source: { kind: string } }).source.kind, 'pack');
  } finally { await rm(fx.root, { recursive: true, force: true }); }
});

test('I3: a conversation in another project cannot read a Run chart, but may still read a Pack chart', async () => {
  const fx = await packFixture(VALID);
  const projectA = await mkdtemp(path.join(os.tmpdir(), 'hima-proj-a-'));
  const projectB = await mkdtemp(path.join(os.tmpdir(), 'hima-proj-b-'));
  try {
    // run-x belongs to session-a's project (projectA). The caller is session-b, whose project is
    // projectB, so `assertRunProject` refuses the Run chart before any Site read.
    const deps = {
      packsDir: fx.packsDir, sitesDir: '',
      ledger: { run: (id: string) => id === 'run-x' ? { id, control: { owner: 'session-a' } } : undefined },
      projectOfRun: async () => realpath(projectA),
    };
    const tools = himaTools(deps as never, undefined, undefined, undefined, undefined, undefined, undefined);
    const chart = tools.find((tool: { name: string }) => tool.name === 'hima_chart')!;
    const agentB = { id: 'session-b', session: { header: { cwd: projectB } } };
    await assert.rejects(() => chart.execute({ runId: 'run-x', path: 'reports/synth/r2/fmax.chart.json' }, { agent: agentB } as never),
      (error: unknown) => error instanceof Error && /not linked to the current project/.test(error.message));
    // The same cross-project caller may still read a Pack chart (Pack charts are global by design).
    const answer = await chart.execute({ pack: fx.pack, file: fx.file }, { agent: agentB } as never);
    assert.equal((answer as { source: { kind: string } }).source.kind, 'pack');
  } finally { await rm(fx.root, { recursive: true, force: true }); await rm(projectA, { recursive: true, force: true }); await rm(projectB, { recursive: true, force: true }); }
});

test('M4: a chart with duplicate categories or duplicate series names is refused, naming the reason', async () => {
  const dupCategories = '{"schema":"hima-chart/1","title":"x","categories":["ss","ss"],"series":[{"name":"after","values":[1,2]}],"source":"r"}';
  const fxCat = await runFixture(dupCategories);
  try {
    await assert.rejects(() => readChartAnswer({ reports: fxCat.reports, packsDir: '' }, { runId: 'run-x', path: fxCat.path }),
      (error: unknown) => error instanceof ChartFileError && /categories must be unique/.test(error.message));
  } finally { await rm(fxCat.root, { recursive: true, force: true }); }
  const dupSeries = '{"schema":"hima-chart/1","title":"x","categories":["ss","tt"],"series":[{"name":"a","values":[1,2]},{"name":"a","values":[3,4]}],"source":"r"}';
  const fxSeries = await runFixture(dupSeries);
  try {
    await assert.rejects(() => readChartAnswer({ reports: fxSeries.reports, packsDir: '' }, { runId: 'run-x', path: fxSeries.path }),
      (error: unknown) => error instanceof ChartFileError && /series names must be unique/.test(error.message));
  } finally { await rm(fxSeries.root, { recursive: true, force: true }); }
});
