// The andes-cell-fmax Pack and its demo Site eda_cluster_ctu_01: load and stage, Pack check against
// the committed Site, graph shape (a propose fork of two resident agents, the AndesCell agent, a
// verify fork of two resident agents, each fork into a judge join), the strip view and the reports
// folder, argv bindings, the resident capability, and the mock EDA toolchain's own unit suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, loadPack, loadSite, packStageOf } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packId = 'andes-cell-fmax';
const packsDir = path.join(repoRoot, 'packs');
const packDir = path.join(packsDir, packId);
const siteDir = path.join(repoRoot, 'sites/eda_cluster_ctu_01');
const HARNESS_ARGV = new Set(['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN']);
const CLAIM = 'Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); not signoff, not silicon.';

const AGENTS = [
  ['himatime-agent', 'himatimeRequirements', 'andes-requirements'],
  ['qualib-agent', 'qualibRequirements', 'andes-requirements'],
  ['andescell-agent', 'generationPlan', 'andes-plan'],
  ['himatime-verify', 'himatimeVerify', 'andes-verify'],
  ['qualib-screen', 'qualibScreen', 'andes-verify'],
] as const;

test('the Pack loads at stage compiled with plain words, a results table, a reports folder and five resident agents', () => {
  const pack = loadPack(packsDir, packId);
  assert.equal(pack.contract.version, '0.2.0');
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
    // An agent's deliveries land beside the Pack tools' reports, under its own node id.
    assert.equal(tool.outsourcing?.artifactPrefix, `reports/${id}`);
    assert.equal(pack.contract.outputs.find((o) => o.name === produces)?.reader, reader);
    for (const file of tool.outsourcing!.knowledge) assert.ok(existsSync(path.join(packDir, 'knowledge', file)), `${id} knowledge ${file}`);
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
  for (const text of shown) assert.doesNotMatch(text, /mock/i, `the App never shows "mock": ${text}`);
  assert.equal(pack.contract.results?.headline?.type, 'fmax_gain_pct');
  assert.deepEqual(pack.contract.results?.columns.map((c) => c.reader), ['andes-reference', 'andes-round']);
  assert.equal(pack.contract.words.target_fmax_gain_pct?.label, 'Fmax gain over the reference build, at least');
  assert.equal(pack.contract.goal?.target_fmax_gain_pct?.default, 5);
});

test('the graph proposes in a fork, chooses with the AndesCell agent, verifies in a fork and loops through the owner', () => {
  const pack = loadPack(packsDir, packId);
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
  assert.deepEqual(out('himatime-verify').map((e) => e.to), ['cells-verified']);
  assert.deepEqual(out('qualib-screen').map((e) => e.to), ['cells-verified']);
  const join = node('cells-verified');
  assert.ok(join?.kind === 'judge');
  assert.deepEqual(join.parameters.rules, ['local-gain-positive', 'cells-screened']);
  assert.deepEqual(out('cells-verified').map((e) => [e.to, e.outcome]), [['new-library-build', 'PASS'], ['blocked', 'FAIL'], ['blocked', 'UNDETERMINED']]);
  assert.deepEqual(out('next-round'), [{ from: 'next-round', to: 'load-timing', revisit: true }]);
  // Resident tasks are the owner's: no autopilot entry names a fork, and every segment stops where one starts.
  assert.ok(pack.graph.autopilot.every((entry) => !('fork' in entry)));
  assert.deepEqual(pack.graph.autopilot.map((entry) => 'from' in entry ? [entry.from, entry.until] : []), [
    [['bind-inputs'], ['himatime-agent', 'qualib-agent', 'blocked']],
    [['requirements-joined'], ['andescell-agent', 'blocked']],
    [['generate-cells'], ['himatime-verify', 'qualib-screen', 'blocked']],
    [['cells-verified'], ['next-round', 'blocked']],
  ]);
  const judge = node('judge-round');
  assert.ok(judge?.kind === 'judge');
  assert.deepEqual(judge.parameters.rules, ['round-valid', 'fmax-goal']);
});

test('the strip places every node once: RTL2GDS on top, the HimaTime and Qualib agents side by side, AndesCell below', () => {
  const pack = loadPack(packsDir, packId);
  const view = pack.graph.view!;
  assert.deepEqual(view.stations.map((s) => [s.id, s.label, s.row]), [
    ['rtl2gds', 'RTL2GDS flow', 0], ['himatime', 'HimaTime agent', 1], ['qualib', 'Qualib agent', 1], ['andescell', 'AndesCell agent', 2]]);
  assert.deepEqual(view.hidden, ['blocked']);
  const lines = Object.fromEntries(view.stations.map((s) => [s.id, s.checklist.map((line) => line.label)]));
  assert.deepEqual(lines, {
    rtl2gds: ['Check tools and design', 'Reference build', 'Reference timing clean', 'Load into HimaTime', 'Local gain confirmed',
      'Rebuild with new cells', 'Compare with the reference', 'Next round'],
    himatime: ['Find the bottleneck, write requirements', 'Verify new cells (local gain)'],
    qualib: ['Check the library, write requirements', 'Screen new cells'],
    andescell: ['Both requirement lists ready', 'Choose the cells', 'Generate the cells'],
  });
  assert.deepEqual(view.stations[0]!.checklist.filter((line) => line.rounds === 'first').map((line) => line.label), ['Check tools and design', 'Reference build', 'Reference timing clean']);
  const placed = [...view.stations.flatMap((s) => s.checklist.flatMap((line) => line.nodes)), ...view.hidden].sort();
  assert.deepEqual(placed, pack.graph.nodes.map((n) => n.id).sort(), 'every node in exactly one place');
  const station = (id: string) => view.stations.find((s) => s.checklist.some((line) => line.nodes.includes(id)))!.id;
  // The edges the strip draws: split, merge, back to both agents, back to RTL2GDS.
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
  const pack = loadPack(packsDir, packId);
  const bound = new Map<string, Record<string, unknown>>();
  for (const node of pack.graph.nodes) if (node.kind === 'act' && node.parameters.tool) bound.set(node.parameters.tool, node.parameters.arguments);
  for (const tool of pack.contract.tools) {
    for (const word of tool.argv) for (const m of word.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) assert.ok(tool.inputs.includes(m[1]!), `${tool.id}: ${m[1]}`);
    for (const name of tool.inputs) if (!HARNESS_ARGV.has(name)) assert.ok(Object.hasOwn(bound.get(tool.id) ?? {}, name), `${tool.id} input ${name} is bound`);
  }
});

test('the committed Site and Permit fit the Pack; the claim boundary is the Pack\'s', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'andes-site-'));
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
  } finally { await rm(root, { recursive: true, force: true }); }
  const cli = await readFile(path.join(packDir, 'flow/andes_cli.py'), 'utf8');
  assert.ok(cli.includes(CLAIM.slice(0, 60)));
  assert.ok((await readFile(path.join(packDir, 'knowledge/evidence-and-claims.md'), 'utf8')).includes(CLAIM));
});

test('the resident capability runs OpenCode in the sandbox with the mock toolchain first on PATH', async () => {
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

test('the mock EDA toolchain unit suite passes (python3 -m unittest)', () => {
  const run = spawnSync('python3', ['-m', 'unittest', 'sites/eda_cluster_ctu_01/mock-eda/tests/test_mock_eda.py'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
