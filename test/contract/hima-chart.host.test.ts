// `hima_chart` (strip demo v3, 2026-10-10): the Guide and the Campaign owner show a chart in the chat
// by naming a file a tool or a Pack wrote — a Run report `<reports dir>/<node>/r<k>/<name>.chart.json`
// or an installed Pack's `knowledge/charts/<name>.chart.json` — and the Host reads it, holds it to
// `himaChart` and answers `HimaChartAnswer`. The model never passes a number. A local Site and local
// files only: the Runs are seeded straight into the Ledger with a prepared workspace and an owner, and
// the charts are small fixture files this test writes, so what is under test is the tool, not a Pack.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { HIMA_CHART_SCHEMA, himaChart, himaRuntimeContext, packDigestOf, type HimaChartAnswer } from '@hima/harness';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { installPack, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const reportsPackId = 'chart-reports-probe';

/** A small proposal chart, as a Pack step would write it: two series over three cell families. */
const proposalChart = {
  schema: HIMA_CHART_SCHEMA, title: 'Why these cells: timing', kind: 'bar', unit: '%',
  categories: ['XNOR3', 'BUF', 'NAND2'],
  series: [
    { name: 'Share of worst path', values: [31.5, 22, 6.25], role: 'baseline' },
    { name: 'Est. recovery', values: [9, 6.5, null], role: 'proposed' },
  ],
  highlight: ['XNOR3', 'BUF'], better: 'higher', source: 'HimaTime report_timing, round 1 worst path',
};
/** A Pack knowledge chart: one series. */
const fo4Chart = {
  schema: HIMA_CHART_SCHEMA, title: 'Stock FO4 against AndesCell typical', unit: 'ps',
  categories: ['XNOR3', 'BUF'], series: [{ name: 'Stock FO4', values: [24, 15] }], source: 'Qualib library analysis',
};

interface Fixture {
  readonly host: InProcessHost;
  readonly workspace: string;
  readonly outside: string;
  readonly packsDir: string;
  readonly sitesDir: string;
  readonly owner: Agent;
  readonly guide: Agent;
  /** Seed one Run of the reports Pack, prepared in `workspace`, owned by `owner` (or someone else). */
  readonly seed: (owner?: string) => Promise<string>;
  readonly call: (agent: Agent, args: Record<string, unknown>) => Promise<{ readonly isError: boolean; readonly text: string }>;
}

async function fixture(t: TestContext): Promise<Fixture> {
  const h = await createHimaHome();
  let host: InProcessHost | undefined;
  t.after(async () => { await host?.dispose(); await h.dispose(); });
  const base = await realpath(h.workspace);
  const workspace = path.join(base, 'campaign-charts');
  const outside = path.join(base, 'outside');
  await mkdir(workspace, { recursive: true });
  await mkdir(outside, { recursive: true });
  const site = await writeLocalSite(h, { allowedReadRoots: [base], allowedWriteRoots: [base] });
  await installPack(h);
  // The shipped timing probe ships two knowledge charts here, one of them not a valid chart.
  const probeCharts = path.join(packsDirOf(h), timingProbePackId, 'knowledge', 'charts');
  await mkdir(probeCharts, { recursive: true });
  await writeFile(path.join(probeCharts, 'library-fo4.chart.json'), `${JSON.stringify(fo4Chart, null, 2)}\n`);
  await writeFile(path.join(probeCharts, 'broken.chart.json'), JSON.stringify({ ...fo4Chart, series: [{ name: 'Stock FO4', values: [24] }] }));
  await writePackVariant(packsDirOf(h), reportsPackId, [['title: opene902 timing probe', 'title: opene902 timing probe\nreports: { dir: reports }']]);
  host = await bootInProcess(h);
  const ledger = host.ctx.hima.ledger;
  const owner = await createRootAgent(host.ctx, h.workspace);
  const guide = await createRootAgent(host.ctx, h.workspace);
  const seed = async (who: string = String(owner.id)): Promise<string> => {
    const run = await ledger.createRun({ campaignId: 'charts', siteId: 'local', status: 'waiting', packId: reportsPackId,
      packDigest: packDigestOf(path.join(packsDirOf(h), reportsPackId)),
      control: { mode: 'agent', owner: who, guideSessionId: who === String(owner.id) ? String(guide.id) : `${who}-guide`,
        epoch: 1, revision: 0, paused: [], executions: {}, requests: {} } });
    await ledger.appendWorkspace(run.id, { event: 'prepared', campaignId: 'charts', packId: reportsPackId, packVersion: '2',
      workspace, flowRoot: workspace, containerName: 'hima-charts', copied: [], preparedAt: new Date().toISOString() });
    return run.id;
  };
  let serial = 0;
  const call = async (agent: Agent, args: Record<string, unknown>) => {
    const result = await host!.ctx.tools.execute({ name: 'hima_chart', arguments: args, callId: `chart-${String(++serial)}` as never, agent, signal: AbortSignal.timeout(10_000) });
    return { isError: result.isError, text: result.content.filter((item) => item.type === 'text').map((item) => item.text).join('') };
  };
  return { host, workspace, outside, packsDir: packsDirOf(h), sitesDir: site.sitesDir, owner, guide, seed, call };
}

async function put(root: string, relative: string, content: string): Promise<string> {
  const at = path.join(root, relative);
  await mkdir(path.dirname(at), { recursive: true });
  await writeFile(at, content);
  return content;
}

const sha256 = (text: string): string => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

test('a Run chart: the owner and the Guide get the validated chart, its source with the bytes\' SHA-256, and the note', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed();
  const bytes = await put(f.workspace, 'reports/synthesize/r1/proposal.chart.json', `${JSON.stringify(proposalChart, null, 2)}\n`);
  for (const agent of [f.owner, f.guide]) {
    const shown = await f.call(agent, { runId, path: 'reports/synthesize/r1/proposal.chart.json', note: 'XNOR3 and BUF carry over half of the worst path.' });
    assert.equal(shown.isError, false, shown.text);
    const answer = JSON.parse(shown.text) as HimaChartAnswer;
    assert.deepEqual(answer.source, { kind: 'run', runId, path: 'reports/synthesize/r1/proposal.chart.json', sha256: sha256(bytes) });
    assert.equal(answer.note, 'XNOR3 and BUF carry over half of the worst path.');
    assert.deepEqual(answer.chart, himaChart.parse(proposalChart));
    assert.deepEqual(answer.chart.series[1]!.values, [9, 6.5, null], 'the numbers are the file\'s own');
  }
  // Each role is told about the tool in its own context: the owner for hand-back and Pack charts, the
  // Guide for Pack knowledge and Run charts.
  const roleOf = async (agent: Agent): Promise<string> => ((await f.host.ctx.systemPrompt.assemble({ agent } as never)) as unknown as
    { contexts: Array<{ name: string; text: string }> }).contexts.find((item) => item.name === 'hima:inventory')?.text ?? '';
  assert.match(await roleOf(f.owner), /Role: Campaign owner\..*Show charts with hima_chart: the chart files a hand-back names \(hima_chart \{runId, path\}\) and those the Pack's owner instructions name/s);
  assert.match(await roleOf(f.guide), /Role: HimaGuide\..*When you explain a design or method from Pack knowledge, show the Pack charts that support it with hima_chart \{pack, file\}/s);
  // No note is no note key.
  const bare = JSON.parse((await f.call(f.owner, { runId, path: 'reports/synthesize/r1/proposal.chart.json' })).text) as HimaChartAnswer;
  assert.equal('note' in bare, false);
});

test('a Pack chart needs no Run: an installed Pack\'s knowledge/charts file is read from the installed Pack', async (t) => {
  const f = await fixture(t);
  const shown = await f.call(f.guide, { pack: timingProbePackId, file: 'charts/library-fo4.chart.json', note: 'Stock XNOR3 is the slowest family.' });
  assert.equal(shown.isError, false, shown.text);
  const answer = JSON.parse(shown.text) as HimaChartAnswer;
  assert.deepEqual(answer.source, { kind: 'pack', pack: timingProbePackId, file: 'charts/library-fo4.chart.json', sha256: sha256(`${JSON.stringify(fo4Chart, null, 2)}\n`) });
  assert.deepEqual(answer.chart, himaChart.parse(fo4Chart));
  assert.equal(answer.chart.series[0]!.role, 'neutral', 'schema defaults are filled in');
  // The inventory every root turn carries names the Pack's charts, so the Guide knows what to show.
  const inventory = himaRuntimeContext(f.host.ctx.hima.ledger, f.packsDir, f.sitesDir);
  assert.match(inventory, new RegExp(`^Pack charts \\(show one with hima_chart \\{pack, file\\}\\): .*${timingProbePackId}: charts/broken\\.chart\\.json, charts/library-fo4\\.chart\\.json\\.$`, 'm'));
  assert.doesNotMatch(inventory, /knowledge\/charts/);
});

test('a missing chart is a plain error, for a Run report and for a Pack file and Pack', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed();
  const missingRun = await f.call(f.owner, { runId, path: 'reports/synthesize/r1/absent.chart.json' });
  assert.deepEqual(missingRun, { isError: true, text: missingRun.text });
  assert.match(missingRun.text, /There is no chart at reports\/synthesize\/r1\/absent\.chart\.json in this Run's reports\./);
  const missingFile = await f.call(f.guide, { pack: timingProbePackId, file: 'charts/absent.chart.json' });
  assert.equal(missingFile.isError, true);
  assert.match(missingFile.text, new RegExp(`The Pack ${timingProbePackId} has no chart knowledge/charts/absent\\.chart\\.json\\.`));
  const missingPack = await f.call(f.guide, { pack: 'not-installed', file: 'charts/library-fo4.chart.json' });
  assert.equal(missingPack.isError, true);
  assert.match(missingPack.text, /The Pack not-installed is not installed on this computer\./);
});

test('an invalid chart is a plain error naming what is wrong; the model cannot pass numbers in', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed();
  await put(f.workspace, 'reports/synthesize/r1/notjson.chart.json', '{"schema": "hima-chart/1", ');
  await put(f.workspace, 'reports/synthesize/r1/wrong.chart.json', JSON.stringify({ ...proposalChart, highlight: ['MUX2'] }));
  await put(f.workspace, 'reports/synthesize/r1/other.chart.json', JSON.stringify({ ...proposalChart, schema: 'hima-chart/2' }));
  const notJson = await f.call(f.owner, { runId, path: 'reports/synthesize/r1/notjson.chart.json' });
  assert.equal(notJson.isError, true);
  assert.match(notJson.text, /reports\/synthesize\/r1\/notjson\.chart\.json is not a chart: it is not readable JSON\./);
  const wrong = await f.call(f.owner, { runId, path: 'reports/synthesize/r1/wrong.chart.json' });
  assert.equal(wrong.isError, true);
  assert.match(wrong.text, /is not a valid hima-chart\/1 chart: highlight names "MUX2", which is not a category/);
  const other = await f.call(f.owner, { runId, path: 'reports/synthesize/r1/other.chart.json' });
  assert.equal(other.isError, true);
  assert.match(other.text, /is not a valid hima-chart\/1 chart: schema /);
  const broken = await f.call(f.guide, { pack: timingProbePackId, file: 'charts/broken.chart.json' });
  assert.equal(broken.isError, true);
  assert.match(broken.text, new RegExp(`knowledge/charts/broken\\.chart\\.json of Pack ${timingProbePackId} is not a valid hima-chart/1 chart: series\\.0\\.values has 1 values for 2 categories`));
  // Numbers the model types are not an address: the tool takes no chart body at all.
  const typed = await f.call(f.owner, { chart: proposalChart });
  assert.equal(typed.isError, true);
  const both = await f.call(f.owner, { runId, path: 'reports/synthesize/r1/wrong.chart.json', pack: timingProbePackId, file: 'charts/library-fo4.chart.json' });
  assert.equal(both.isError, true);
  assert.match(both.text, /Name one chart: either a Run report \(runId and path\) or a Pack file \(pack and file\)\./);
  const long = await f.call(f.guide, { pack: timingProbePackId, file: 'charts/library-fo4.chart.json', note: 'x'.repeat(201) });
  assert.equal(long.isError, true);
  assert.match(long.text, /The note is 201 characters; keep it to one line of at most 200\./);
});

test('a path outside the rules is refused: not a chart file, not a report path, a way out, a link out of the workspace', async (t) => {
  const f = await fixture(t);
  const runId = await f.seed();
  await put(f.workspace, 'reports/synthesize/r1/timing.rpt', 'slack (VIOLATED) -0.012\n');
  await put(f.outside, 'secret.chart.json', JSON.stringify(proposalChart));
  await mkdir(path.join(f.workspace, 'reports/synthesize/r1'), { recursive: true });
  await symlink(path.join(f.outside, 'secret.chart.json'), path.join(f.workspace, 'reports/synthesize/r1/escape.chart.json'));
  for (const bad of ['reports/synthesize/r1/timing.rpt', 'reports/synthesize/r1/proposal.json', '../outside/secret.chart.json', '/etc/x.chart.json',
    'reports/synthesize/r1/../r1/x.chart.json', 'reports/Synthesize/r1/x.chart.json', 'reports/synthesize/1/x.chart.json',
    'reports/synthesize/r1/sub/x.chart.json', 'other/synthesize/r1/x.chart.json', 'reports/synthesize/r1/.chart.json']) {
    const refused = await f.call(f.owner, { runId, path: bad });
    assert.equal(refused.isError, true, bad);
    assert.match(refused.text, /is not a Run chart path; a Run chart is reports\/<node>\/r<round>\/<name>\.chart\.json/, `${bad}: ${refused.text}`);
  }
  const escape = await f.call(f.owner, { runId, path: 'reports/synthesize/r1/escape.chart.json' });
  assert.equal(escape.isError, true);
  assert.match(escape.text, /resolves outside this Run's Campaign workspace/);
  for (const bad of ['library-fo4.chart.json', 'charts/library-fo4.json', 'charts/../charts/library-fo4.chart.json', '../knowledge/charts/library-fo4.chart.json', 'charts/sub/x.chart.json']) {
    const refused = await f.call(f.guide, { pack: timingProbePackId, file: bad });
    assert.equal(refused.isError, true, bad);
    assert.match(refused.text, /is not a Pack chart file; a Pack chart is charts\/<name>\.chart\.json in the Pack's knowledge folder\./, `${bad}: ${refused.text}`);
  }
});

test('no run access: a conversation that neither owns nor guides the Run reads none of its charts; its Pack charts stay readable', async (t) => {
  const f = await fixture(t);
  const foreign = await f.seed('someone-else');
  await put(f.workspace, 'reports/synthesize/r1/proposal.chart.json', JSON.stringify(proposalChart));
  for (const agent of [f.owner, f.guide]) {
    const denied = await f.call(agent, { runId: foreign, path: 'reports/synthesize/r1/proposal.chart.json' });
    assert.equal(denied.isError, true);
    assert.match(denied.text, /not linked to the current project/);
    assert.doesNotMatch(denied.text, /XNOR3/);
  }
  const unknown = await f.call(f.owner, { runId: 'run-does-not-exist', path: 'reports/synthesize/r1/proposal.chart.json' });
  assert.equal(unknown.isError, true);
  const pack = await f.call(f.owner, { pack: timingProbePackId, file: 'charts/library-fo4.chart.json' });
  assert.equal(pack.isError, false, pack.text);
});
