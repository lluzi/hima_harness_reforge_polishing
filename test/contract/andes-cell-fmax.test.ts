// The andes-cell-fmax Pack and its demo Site eda_cluster_ctu_01: load and stage, Pack check against
// the committed Site, graph shape (a propose fork of two resident agents, the AndesCell agent, a
// verify fork of two resident agents, each fork into a judge join), the strip view and the reports
// folder, argv bindings, the resident capability, the generated knowledge, the Pack's deterministic
// steps end to end, and the Site toolchain's own unit suite.
//
// The Site's design data for openc910 is installed per Site and never in git: every test here runs
// the Site tools on the synthetic fixture bundle (CTU_OPENC910_DATA), and the Pack's generated
// knowledge (design-notes.md, knowledge/charts/) is written into a temporary copy of the Pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, himaChart, loadPack, loadSite, packStageOf } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packId = 'andes-cell-fmax';
const packDir = path.join(repoRoot, 'packs', packId);
const siteDir = path.join(repoRoot, 'sites/eda_cluster_ctu_01');
const edaRoot = path.join(siteDir, 'mock-eda');
const fixture = path.join(edaRoot, 'tests/fixtures/openc910-mini');
const HARNESS_ARGV = new Set(['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN']);
const CLAIM = 'Every EDA result in this Pack is replayed by mock tools on a demo Site (mock EDA) from measured flow data;';
const SHOWN = 'These are results on the demo Site eda_cluster_ctu_01, not signoff and not silicon.';
const KNOWLEDGE_CHARTS = ['flow-stages', 'high-value-families', 'library-vt', 'path-groups', 'reference-summary', 'stage-breakdown', 'worst-paths']
  .map((name) => `${name}.chart.json`);
const toolEnv = { ...process.env, CTU_OPENC910_DATA: fixture, CTU_MOCK_TIME_SCALE: '0' };

const AGENTS = [
  ['himatime-agent', 'himatimeRequirements', 'andes-requirements'],
  ['qualib-agent', 'qualibRequirements', 'andes-requirements'],
  ['andescell-agent', 'generationPlan', 'andes-plan'],
  ['himatime-verify', 'himatimeVerify', 'andes-verify'],
  ['qualib-screen', 'qualibScreen', 'andes-verify'],
] as const;

/** Write the Pack's generated knowledge from the Site's tools on the fixture bundle into `dir`. */
function generateKnowledge(dir: string): void {
  const run = spawnSync('python3', [path.join(packDir, 'flow/knowledge_charts.py'), edaRoot, dir], { encoding: 'utf8', env: toolEnv });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
}

/** A temporary packs folder holding this Pack with its generated knowledge, as a Site install has it. */
async function installedPack(): Promise<{ readonly packsDir: string; readonly done: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'andes-pack-'));
  await cp(packDir, path.join(root, packId), { recursive: true, filter: (s) => !s.includes('__pycache__') });
  generateKnowledge(path.join(root, packId, 'knowledge'));
  return { packsDir: root, done: () => rm(root, { recursive: true, force: true }) };
}

/** ns to ps as the Pack rounds it (3 decimals). */
const ps = (ns: number) => Math.round(ns * 1e6) / 1e3;
const fixtureJson = async (rel: string) => JSON.parse(await readFile(path.join(fixture, rel), 'utf8'));

test('the Pack loads at stage compiled with plain words, a results table, a reports folder and five resident agents', async () => {
  const { packsDir, done } = await installedPack();
  try {
    const pack = loadPack(packsDir, packId);
    assert.equal(pack.contract.version, '0.4.0');
    assert.equal(pack.graph.version, pack.contract.version);
    assert.equal(packStageOf(packsDir, packId)?.stage, 'compiled');
    assert.deepEqual(pack.contract.reports, { dir: 'reports' });
    assert.deepEqual(pack.contract.tools.map((t) => t.id), ['bind-inputs', 'reference-build', 'load-timing', 'himatime-agent', 'qualib-agent',
      'andescell-agent', 'generate-cells', 'himatime-verify', 'qualib-screen', 'new-library-build', 'compare-round']);
    for (const tool of pack.contract.tools) {
      assert.ok((pack.contract.workspace.copy ?? []).includes(path.relative('flow', tool.file)), `${tool.id} file is copied`);
      assert.ok(existsSync(path.join(packDir, tool.file)));
    }
    for (const [id, produces, reader] of AGENTS) {
      const tool = pack.contract.tools.find((t) => t.id === id)!;
      assert.equal(tool.outsourcing?.role, 'resident-engineering-agent');
      assert.equal(tool.outsourcing?.produces, produces);
      assert.equal(tool.outsourcing?.artifactPrefix, `reports/${id}`);
      assert.equal(pack.contract.outputs.find((o) => o.name === produces)?.reader, reader);
      for (const file of tool.outsourcing!.knowledge) assert.ok(existsSync(path.join(packDir, 'knowledge', file)), `${id} knowledge ${file}`);
      assert.match(tool.description ?? '', /andes_cli\.py draft <campaign>/, `${id} drafts its delivery from the tool's own output`);
    }
    const shown: string[] = [];
    for (const node of pack.graph.nodes) {
      assert.ok(node.label && node.label.length <= 40, `${node.id} has a plain label`);
      assert.ok(node.about && node.about.length <= 240, `${node.id} has a one-line about`);
      assert.doesNotMatch(`${node.label} ${node.about}`, /\b(arm|campaign|judge|gen)\b/i, `${node.id} words are chip-designer words`);
      shown.push(node.label!, node.about!);
    }
    for (const entry of pack.graph.autopilot) if ('from' in entry) { assert.ok(entry.label && entry.about, 'every segment has words'); shown.push(entry.label!, entry.about!); }
    for (const station of pack.graph.view!.stations) shown.push(station.label, station.about ?? '', ...station.checklist.map((line) => line.label));
    shown.push(pack.contract.title, ...Object.values(pack.contract.words).map((w) => w.label));
    for (const text of shown) {
      assert.doesNotMatch(text, /mock|model/i, `the App never shows "mock" or "model": ${text}`);
      assert.doesNotMatch(text, /fmax|aes_cipher/i, `no Fmax and no old design: ${text}`);
    }
    assert.equal(pack.contract.results?.headline?.type, 'timing_gain_pct');
    assert.deepEqual(pack.contract.results?.columns.map((c) => c.reader), ['andes-reference', 'andes-round']);
    assert.deepEqual(pack.contract.results?.rows.map((r) => r.type), ['design_wns_ps', 'design_tns_ns', 'design_nvp', 'design_density_pct',
      'new_cell_instances', 'new_cell_pct']);
    assert.equal(pack.contract.words.target_timing_gain_pct?.label, 'Worst-slack gain, % of clock, at least');
    assert.equal(pack.contract.goal?.target_timing_gain_pct?.default, 1, 'one round meets the default Goal');
    const next = pack.graph.nodes.find((n) => n.id === 'next-round');
    assert.ok(next?.kind === 'explore');
    assert.equal(next.parameters.converge?.generationLimit, 2, 'one round expected, a second as a safety margin');
    assert.equal(next.parameters.converge?.read, 'bestWns');
  } finally { await done(); }
});

test('the graph proposes in a fork, plans with the AndesCell agent, verifies in a fork and loops through the owner', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const out = (from: string) => pack.graph.edges.filter((e) => e.from === from);
  const node = (id: string) => pack.graph.nodes.find((n) => n.id === id);
  assert.deepEqual(out('read-timing').map((e) => e.to).sort(), ['himatime-agent', 'qualib-agent']);
  assert.ok(out('read-timing').every((e) => e.outcome === undefined));
  assert.deepEqual(out('himatime-agent').map((e) => e.to), ['requirements-joined']);
  assert.deepEqual(out('qualib-agent').map((e) => e.to), ['requirements-joined']);
  assert.equal(node('requirements-joined')?.kind, 'judge');
  assert.deepEqual(out('requirements-joined').map((e) => [e.to, e.outcome]), [['andescell-agent', 'PASS'], ['blocked', 'FAIL'], ['blocked', 'UNDETERMINED']]);
  assert.deepEqual(out('andescell-agent').map((e) => e.to), ['generate-cells']);
  assert.deepEqual(out('generate-cells').map((e) => e.to).sort(), ['himatime-verify', 'qualib-screen']);
  const join = node('cells-verified');
  assert.ok(join?.kind === 'judge');
  assert.equal(join.label, 'Cell-level gain confirmed');
  assert.deepEqual(join.parameters.rules, ['cells-gain-positive', 'cells-screened']);
  assert.deepEqual(out('cells-verified').map((e) => [e.to, e.outcome]), [['new-library-build', 'PASS'], ['blocked', 'FAIL'], ['blocked', 'UNDETERMINED']]);
  assert.deepEqual(out('next-round'), [{ from: 'next-round', to: 'load-timing', revisit: true }]);
  assert.ok(pack.graph.autopilot.every((entry) => !('fork' in entry)));
  assert.deepEqual(pack.graph.autopilot.map((entry) => 'from' in entry ? [entry.from, entry.until] : []), [
    [['bind-inputs'], ['himatime-agent', 'qualib-agent', 'blocked']],
    [['requirements-joined'], ['andescell-agent', 'blocked']],
    [['generate-cells'], ['himatime-verify', 'qualib-screen', 'blocked']],
    [['cells-verified'], ['next-round', 'blocked']],
  ]);
  const judge = node('judge-round');
  assert.ok(judge?.kind === 'judge');
  assert.equal(judge.label, 'Clean build and timing goal');
  assert.deepEqual(judge.parameters.rules, ['round-valid', 'timing-goal']);
});

test('the strip places every node once: RTL2GDS on top, the HimaTime and Qualib agents side by side, AndesCell below', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const view = pack.graph.view!;
  assert.deepEqual(view.stations.map((s) => [s.id, s.label, s.row]), [
    ['rtl2gds', 'RTL2GDS flow', 0], ['himatime', 'HimaTime agent', 1], ['qualib', 'Qualib agent', 1], ['andescell', 'AndesCell agent', 2]]);
  assert.deepEqual(view.hidden, ['blocked']);
  const lines = Object.fromEntries(view.stations.map((s) => [s.id, s.checklist.map((line) => line.label)]));
  assert.deepEqual(lines, {
    rtl2gds: ['Check tools and design', 'Reference build', 'Reference build finished', 'Load into HimaTime', 'Cell-level gain confirmed',
      'Rebuild with custom cells', 'Compare with the reference', 'Next round'],
    himatime: ['Rank the arcs, write requirements', 'Check new cells (cell-level gain)'],
    qualib: ['Check the library, write requirements', 'Screen kept cells'],
    andescell: ['Both requirement lists ready', 'Plan the arcs', 'Generate the cells'],
  });
  assert.deepEqual(view.stations[0]!.checklist.filter((line) => line.rounds === 'first').map((line) => line.label), ['Check tools and design', 'Reference build', 'Reference build finished']);
  const placed = [...view.stations.flatMap((s) => s.checklist.flatMap((line) => line.nodes)), ...view.hidden].sort();
  assert.deepEqual(placed, pack.graph.nodes.map((n) => n.id).sort(), 'every node in exactly one place');
  const station = (id: string) => view.stations.find((s) => s.checklist.some((line) => line.nodes.includes(id)))!.id;
  const crossing = [...new Set(pack.graph.edges.filter((e) => e.to !== 'blocked' && e.from !== 'blocked' && station(e.from) !== station(e.to))
    .map((e) => `${station(e.from)}>${station(e.to)}`))];
  assert.deepEqual(crossing.sort(), ['andescell>himatime', 'andescell>qualib', 'himatime>andescell', 'himatime>rtl2gds', 'qualib>andescell', 'qualib>rtl2gds', 'rtl2gds>himatime', 'rtl2gds>qualib']);
});

test('a strip that puts a node in two stations is refused where the author reads it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'andes-view-'));
  try {
    await cp(packDir, path.join(root, packId), { recursive: true, filter: (s) => !s.includes('__pycache__') });
    const graphFile = path.join(root, packId, 'graph.yml');
    const text = await readFile(graphFile, 'utf8');
    await writeFile(graphFile, text.replace('nodes: [himatime-verify] }', 'nodes: [himatime-verify, generate-cells] }'));
    assert.throws(() => loadPack(root, packId), /"generate-cells" is in station "himatime" and in station "andescell"|"generate-cells" is in station "andescell" and in station "himatime"/);
    await writeFile(graphFile, text.replace('  hidden: [blocked]\n', ''));
    assert.throws(() => loadPack(root, packId), /node "blocked" is in no station and not hidden/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('every ${NAME} in a tool argv is bound by the contract or the harness', () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const bound = new Map<string, Record<string, unknown>>();
  for (const node of pack.graph.nodes) if (node.kind === 'act' && node.parameters.tool) bound.set(node.parameters.tool, node.parameters.arguments);
  for (const tool of pack.contract.tools) {
    for (const word of tool.argv) for (const m of word.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) assert.ok(tool.inputs.includes(m[1]!), `${tool.id}: ${m[1]}`);
    for (const name of tool.inputs) if (!HARNESS_ARGV.has(name)) assert.ok(Object.hasOwn(bound.get(tool.id) ?? {}, name), `${tool.id} input ${name} is bound`);
  }
});

test('the committed Site and Permit fit the Pack with its generated knowledge; the claim boundary is the Pack\'s', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'andes-site-'));
  const { packsDir, done } = await installedPack();
  try {
    const sitesDir = path.join(root, 'sites');
    await mkdir(sitesDir, { recursive: true });
    await writeFile(path.join(sitesDir, 'eda_cluster_ctu_01.yml'), await readFile(path.join(siteDir, 'site.yml'), 'utf8'));
    await writeFile(path.join(sitesDir, 'permit.yml'), await readFile(path.join(siteDir, 'permit.yml'), 'utf8'));
    const site = loadSite(sitesDir, 'eda_cluster_ctu_01');
    assert.equal(site.kind, 'ssh');
    assert.deepEqual(site.permitRules.allowedWriteRoots, ['/data/eda/project/hima_harness/ctu-runs']);
    const fit = checkPack(loadPack(packsDir, packId), site);
    assert.equal(fit.fit, true, fit.errors.join('\n'));
    // Without its generated knowledge the Pack does not fit: the design notes are a Site install's.
    await rm(path.join(packsDir, packId, 'knowledge/design-notes.md'));
    assert.equal(checkPack(loadPack(packsDir, packId), site).fit, false);
  } finally { await rm(root, { recursive: true, force: true }); await done(); }
  const cli = await readFile(path.join(packDir, 'flow/andes_cli.py'), 'utf8');
  assert.ok(cli.includes(CLAIM.slice(0, 60)));
  assert.ok((await readFile(path.join(packDir, 'knowledge/evidence-and-claims.md'), 'utf8')).includes(CLAIM));
});

test('the resident capability runs OpenCode in the sandbox with the Site toolchain first on PATH', async () => {
  const capability = JSON.parse(await readFile(path.join(siteDir, 'engineering-capabilities-ctu01.json'), 'utf8'));
  const site = await readFile(path.join(siteDir, 'site.yml'), 'utf8');
  const admin = '/data/eda/project/hima_harness/operator-admin/resident-engineering-ctu01';
  assert.deepEqual(capability.wrapper.argv, [`${admin}/resident-engineering-wrapper.py`, '--capability', `${admin}/engineering-capabilities-ctu01.json`]);
  assert.ok(site.includes(`engineeringCapabilities: ${admin}/engineering-capabilities-ctu01.json`));
  assert.equal(capability.native.model, 'deepseek/deepseek-flash');
  assert.equal(capability.native.version, '1.18.34');
  assert.equal(capability.sandbox.kind, 'podman');
  assert.ok(capability.sandbox.readOnlyRoots.includes('/data/eda/project/hima_harness/ctu01-eda'));
  assert.equal(capability.environment.toolPaths[0], '/data/eda/project/hima_harness/ctu01-eda/bin');
  assert.equal(capability.environment.set.EMPYREAN_LICENSE_MODE, 'old', 'the wrapper launch line tests it');
});

test('the generated knowledge: hima-chart/1 files from the tools and design notes that name them, never committed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'andes-knowledge-'));
  try {
    generateKnowledge(dir);
    assert.deepEqual((await readdir(path.join(dir, 'charts'))).sort(), KNOWLEDGE_CHARTS);
    const charts: Record<string, ReturnType<typeof himaChart.parse>> = {};
    for (const name of KNOWLEDGE_CHARTS) {
      const text = await readFile(path.join(dir, 'charts', name), 'utf8');
      assert.doesNotMatch(text, /mock|model/i, name);
      charts[name] = himaChart.parse(JSON.parse(text));
    }
    // The numbers are the fixture's, through the tools: route, path group reg2reg.
    const pr = await fixtureJson('pr/pr.json');
    const route = pr.reference.route;
    const summary = charts['reference-summary.chart.json']!;
    assert.equal(summary.kind, 'metrics');
    assert.deepEqual(summary.categories.slice(0, 3), ['reg2reg worst slack', 'reg2reg TNS', 'reg2reg violating paths']);
    assert.deepEqual(summary.series[0]!.values.slice(0, 3), [ps(route.wns_ns.reg2reg), route.tns_ns.reg2reg, route.nvp.reg2reg]);
    assert.deepEqual(charts['flow-stages.chart.json']!.categories, ['prePlace', 'place_opt', 'CTS', 'route']);
    assert.deepEqual(charts['flow-stages.chart.json']!.series[0]!.values,
      ['prePlace', 'place', 'cts', 'route'].map((s) => ps(pr.reference[s].wns_ns.reg2reg)));
    assert.equal(charts['worst-paths.chart.json']!.series[0]!.values[0], ps(route.wns_ns.reg2reg));
    assert.equal(charts['path-groups.chart.json']!.categories[0], 'reg2reg worst slack');
    assert.ok(charts['stage-breakdown.chart.json']!.categories.includes('SRAM access'));
    const vt = charts['library-vt.chart.json']!;
    assert.deepEqual(vt.series.map((s) => s.name), ['ULVT', 'LVT', 'SVT']);
    assert.ok(vt.categories.every((c) => c.length <= 24));
    const hv = await fixtureJson('himatime/high_value.json');
    assert.equal(charts['high-value-families.chart.json']!.series[0]!.values[0], hv.families[0][1]);
    const notes = await readFile(path.join(dir, 'design-notes.md'), 'utf8');
    for (const name of KNOWLEDGE_CHARTS) assert.ok(notes.includes(`charts/${name}`), `design-notes.md names charts/${name}`);
    assert.match(notes, /hima_chart/);
    assert.match(notes, /end of route/);
    assert.ok(notes.includes(`**${Math.round(1000 * route.wns_ns.reg2reg)} ps**`), 'the worst slack at route, in ps');
    assert.doesNotMatch(notes, /\$[a-z_]+|mock|model|\bFmax\b/, 'every field filled, plain words');
  } finally { await rm(dir, { recursive: true, force: true }); }
  // Generated per Site, never in git: the template is tracked, the notes and charts are ignored.
  assert.ok(existsSync(path.join(packDir, 'knowledge/design-notes.template.md')));
  for (const rel of ['knowledge/design-notes.md', 'knowledge/charts/reference-summary.chart.json']) {
    const ignored = spawnSync('git', ['check-ignore', '-q', path.join('packs', packId, rel)], { cwd: repoRoot });
    assert.equal(ignored.status, 0, `${rel} is git-ignored`);
  }
});

// ---- the Pack's deterministic steps, one round, the agents' deliveries drafted from the tools

interface Step { readonly status: number | null; readonly stdout: string; readonly stderr: string }

function py(argv: readonly string[]): Step {
  return spawnSync('python3', [...argv], { encoding: 'utf8', env: toolEnv });
}

test('one round of the Pack\'s steps on the fixture: drafts from the tools pass, typed numbers are refused, the round is read at route', async () => {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'andes-round-'));
  try {
    await mkdir(path.join(ws, 'flow'), { recursive: true });
    await cp(path.join(packDir, 'flow/andes_cli.py'), path.join(ws, 'flow/andes_cli.py'));
    const cli = (...args: string[]) => { const r = py([path.join(ws, 'flow/andes_cli.py'), ...args]); assert.equal(r.status, 0, `${args.join(' ')}\n${r.stdout}\n${r.stderr}`); return r.stdout; };
    const reader = (name: string, report: string, extra: string[] = []) => {
      const out = path.join(ws, `out-${name}-${Math.random().toString(36).slice(2)}.json`);
      const r = py([path.join(packDir, 'tools', name), path.join(ws, 'state', report), out, ...extra]);
      return { r, values: r.status === 0 ? Object.fromEntries(JSON.parse(readFileSync(out, 'utf8')).values.map((v: any) => [v.type, v.value])) : undefined };
    };
    const deliver = async (kind: string, file: string, doc: any, k = 1) => {
      doc.summary = doc.summary || `Round ${k}: the stand-in delivery, drafted from the tool's own output.`;
      if ('reason' in doc) doc.reason = doc.reason || 'Every arc both lists allow, at the Site\'s AndesCell settings.';
      await mkdir(path.dirname(path.join(ws, doc.report)), { recursive: true });
      await writeFile(path.join(ws, doc.report), `# ${kind}\n`);
      await writeFile(path.join(ws, 'state', file), JSON.stringify(doc, null, 2));
    };
    cli('bind', ws, edaRoot, fixture, 'n7-ulvt');
    cli('reference', ws, '20');
    cli('timing', ws);
    const ref = reader('read-reference.py', 'reference.json');
    const pr = await fixtureJson('pr/pr.json');
    const refWns = ps(pr.reference.route.wns_ns.reg2reg);
    assert.deepEqual(ref.values, { reference_valid: 1, design_wns_ps: refWns, design_tns_ns: pr.reference.route.tns_ns.reg2reg,
      design_nvp: pr.reference.route.nvp.reg2reg, design_density_pct: pr.reference.route.density_pct, new_cell_instances: 0, new_cell_pct: 0 });
    assert.equal(reader('read-timing.py', 'timing.json').values?.timing_high_value_cells, (await fixtureJson('himatime/high_value.json')).listed_cells);

    // ----- propose: a typed arc is refused; the drafts pass
    const ht = JSON.parse(cli('draft', ws, 'himatime'));
    const merged = (await fixtureJson('himatime/arc_list.json')).arcs.length;
    assert.equal(ht.arcs.length, merged, 'the draft lists every merged what-if arc');
    await deliver('himatime', 'himatime-requirements.json', { ...ht, arcs: [...ht.arcs, { cell: 'NOPE1X', from: 'A', to: 'Z', edge: 'rise', rankedBy: ['TNS'], tnsGainNs: 1, wnsGainNs: 0 }] });
    assert.match(reader('read-requirements.py', 'himatime-requirements.json', [ws]).r.stderr, /1 arc\(s\) are not in HimaTime's merged what-if list: NOPE1X_A_Z_rise/);
    await deliver('himatime', 'himatime-requirements.json', { ...ht, arcs: ht.arcs.map((a: any, i: number) => i === 0 ? { ...a, tnsGainNs: a.tnsGainNs + 0.5 } : a) });
    assert.match(reader('read-requirements.py', 'himatime-requirements.json', [ws]).r.stderr, /tnsGainNs must be HimaTime's best what-if gain/);
    await deliver('himatime', 'himatime-requirements.json', ht);
    assert.deepEqual(reader('read-requirements.py', 'himatime-requirements.json', [ws]).values, { requirements_valid: 1, requirements_count: merged });
    const ql = JSON.parse(cli('draft', ws, 'qualib'));
    await deliver('qualib', 'qualib-requirements.json', { ...ql, constraints: { ...ql.constraints, inputCapMaxRatio: 2 } });
    assert.match(reader('read-requirements.py', 'qualib-requirements.json', [ws]).r.stderr, /constraints\.inputCapMaxRatio must be 1\.3/);
    await deliver('qualib', 'qualib-requirements.json', ql);
    assert.equal(reader('read-requirements.py', 'qualib-requirements.json', [ws]).values?.requirements_valid, 1);

    // ----- plan, generate
    const plan = JSON.parse(cli('draft', ws, 'andescell'));
    await deliver('andescell', 'generation-plan.json', { ...plan, settings: { iterations: 10, scale: 0.9 } });
    assert.match(reader('read-plan.py', 'generation-plan.json', [ws]).r.stderr, /settings must be \{"iterations": 50, "scale": 0.9\}/);
    await deliver('andescell', 'generation-plan.json', plan);
    assert.deepEqual(reader('read-plan.py', 'generation-plan.json', [ws]).values, { plan_valid: 1, plan_arcs: merged });
    cli('generate', ws);
    const results = await fixtureJson('andescell/results.json');
    const gen = JSON.parse(await readFile(path.join(ws, 'state/generation.json'), 'utf8'));
    assert.deepEqual([gen.requested, gen.generated, gen.failed], [results.requested_arcs, results.generated, results.failed]);

    // ----- verify: a typed kept count is refused; the drafts pass and both branches state the tools' numbers
    const check = JSON.parse(cli('draft', ws, 'himatime-verify'));
    await deliver('himatime-verify', 'himatime-verify.json', { ...check, kept: check.kept + 1 });
    assert.match(reader('read-verify.py', 'himatime-verify.json', [ws]).r.stderr, /kept must be \d+ \(himatime verify\)/);
    await deliver('himatime-verify', 'himatime-verify.json', check);
    const screen = JSON.parse(cli('draft', ws, 'qualib-screen'));
    await deliver('qualib-screen', 'qualib-screen.json', screen);
    const kept = results.delivered.length;
    for (const file of ['himatime-verify.json', 'qualib-screen.json']) {
      assert.deepEqual(reader('read-verify.py', file, [ws]).values, { verify_delivery_valid: 1, cells_kept: kept, cells_passed_screen: kept }, file);
    }

    // ----- rebuild and compare at route
    cli('build', ws, '20');
    cli('compare', ws);
    const round = reader('read-round.py', 'round.json').values!;
    const newWns = ps(pr.custom_model.stages.route.wns_ns.reg2reg);
    const period = JSON.parse(await readFile(path.join(ws, 'state/reference.json'), 'utf8')).clockPeriodNs;
    const gain = Math.round(10000 * (newWns - refWns) / 1000 / period) / 100;
    assert.equal(round.round_valid, 1);
    assert.equal(round.timing_gain_pct, gain);
    assert.equal(round.best_gain_pct, gain);
    assert.equal(round.round_improved, 1);
    assert.equal(round.best_wns_ps, newWns);
    assert.equal(round.design_wns_ps, newWns);
    assert.equal(round.new_cell_instances, pr.custom_model.stages.route.power.custom_cells);
    const md = await readFile(path.join(ws, 'reports/compare-round/r1/round-1.md'), 'utf8');
    assert.ok(md.includes(SHOWN) && md.includes('end of route'), md);
    const summaryMd = await readFile(path.join(ws, 'derived/summary.md'), 'utf8');
    assert.ok(summaryMd.includes(`Claim boundary: ${CLAIM}`), summaryMd);

    // ----- every chart a person sees: hima-chart/1, the tools' numbers, no "mock" or "model"
    const charts: Record<string, string[]> = {
      'reference-build': ['summary', 'path-groups', 'flow-stages', 'timing'], 'load-timing': ['stage-breakdown'],
      'himatime-agent': ['funnel', 'proposal'], 'qualib-agent': ['proposal'], 'generate-cells': ['generation'],
      'himatime-verify': ['cell-check', 'top-cells'], 'qualib-screen': ['screen'],
      'compare-round': ['comparison', 'flow-stages', 'path-groups', 'worst-paths'],
    };
    const read = async (step: string, name: string) => {
      const text = await readFile(path.join(ws, 'reports', step, 'r1', `${name}.chart.json`), 'utf8');
      assert.doesNotMatch(text, /mock|model|\bFmax\b/, `${step}/${name}`);
      return himaChart.parse(JSON.parse(text));
    };
    for (const [step, names] of Object.entries(charts)) for (const name of names) await read(step, name);
    for (const rel of ['compare-round/r1/round-1.md', 'reference-build/r1/flow_summary.rpt', 'new-library-build/r1/route.summary.rpt']) {
      assert.doesNotMatch(await readFile(path.join(ws, 'reports', rel), 'utf8'), /mock|model/i, rel);
    }
    const comparison = await read('compare-round', 'comparison');
    assert.equal(comparison.kind, 'metrics');
    assert.deepEqual(comparison.series.map((s) => s.values[0]), [refWns, newWns]);
    assert.deepEqual(comparison.series.map((s) => s.values.at(-1)), [0, gain], 'the timing gain row, % of the clock');
    const funnel = await read('himatime-agent', 'funnel');
    assert.deepEqual(funnel.series[0]!.values.slice(-2), [merged, merged]);
    const generation = await read('generate-cells', 'generation');
    assert.deepEqual(generation.series[0]!.values.slice(0, 4), [results.requested_arcs, results.generated, results.failed, 50]);
    const cellCheck = await read('himatime-verify', 'cell-check');
    assert.equal(cellCheck.series[0]!.values.reduce((a, b) => (a ?? 0) + (b ?? 0), 0), kept);
    const worst = await read('compare-round', 'worst-paths');
    assert.deepEqual(worst.series[1]!.values, pr.custom_model.stages.route.worst_paths.slice(0, 8).map((p: any) => ps(p.slack_ns)));
    assert.deepEqual(worst.series[0]!.values, pr.custom_model.stages.route.worst_paths.slice(0, 8).map((p: any) => ps(p.reference_slack_ns)));
  } finally { await rm(ws, { recursive: true, force: true }); }
});

test('the Site toolchain unit suites pass (python3 -m unittest)', () => {
  for (const file of ['test_mock_eda.py', 'test_openc910.py']) {
    const run = spawnSync('python3', ['-m', 'unittest', `sites/eda_cluster_ctu_01/mock-eda/tests/${file}`], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, `${file}\n${run.stdout}\n${run.stderr}`);
  }
});
