// The andes-cell-fmax Pack and its demo Site eda_cluster_ctu_01: load, Pack check against the
// committed Site, graph shape (two outsourced agents forked into a judge join), argv bindings, the
// resident capability, and the mock EDA toolchain's own unit suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, loadPack, loadSite } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packId = 'andes-cell-fmax';
const packsDir = path.join(repoRoot, 'packs');
const packDir = path.join(packsDir, packId);
const siteDir = path.join(repoRoot, 'sites/eda_cluster_ctu_01');
const HARNESS_ARGV = new Set(['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN']);
const CLAIM = 'Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); not signoff, not silicon.';

test('the Pack loads with plain words, a results table and two resident agents', () => {
  const pack = loadPack(packsDir, packId);
  assert.equal(pack.graph.version, pack.contract.version);
  assert.deepEqual(pack.contract.tools.map((t) => t.id), ['bind-inputs', 'reference-build', 'load-timing', 'himatime-agent', 'qualib-agent',
    'generate-cells', 'screen-cells', 'verify-cells', 'new-library-build', 'compare-round']);
  for (const tool of pack.contract.tools) {
    assert.ok((pack.contract.workspace.copy ?? []).includes(path.relative('flow', tool.file)), `${tool.id} file is copied`);
    assert.ok(existsSync(path.join(packDir, tool.file)));
  }
  for (const [id, produces, prefix] of [['himatime-agent', 'himatimeRequirements', 'requirements/himatime'], ['qualib-agent', 'qualibRequirements', 'requirements/qualib']] as const) {
    const tool = pack.contract.tools.find((t) => t.id === id)!;
    assert.equal(tool.outsourcing?.produces, produces);
    assert.equal(tool.outsourcing?.artifactPrefix, prefix);
    assert.equal(pack.contract.outputs.find((o) => o.name === produces)?.reader, 'andes-requirements');
  }
  for (const node of pack.graph.nodes) {
    assert.ok(node.label && node.label.length <= 40, `${node.id} has a plain label`);
    assert.ok(node.about && node.about.length <= 240, `${node.id} has a one-line about`);
    assert.doesNotMatch(`${node.label} ${node.about}`, /\b(arm|campaign|judge|gen)\b/i, `${node.id} words are chip-designer words`);
  }
  for (const entry of pack.graph.autopilot) if ('from' in entry) assert.ok(entry.label && entry.about, 'every segment has words');
  assert.equal(pack.contract.results?.headline?.type, 'fmax_gain_pct');
  assert.deepEqual(pack.contract.results?.columns.map((c) => c.reader), ['andes-reference', 'andes-round']);
  assert.equal(pack.contract.words.target_fmax_gain_pct?.label, 'Fmax gain over the reference build, at least');
  assert.equal(pack.contract.goal?.target_fmax_gain_pct?.default, 5);
});

test('the graph forks the two agents from the timing read into a judge join and loops through the owner', () => {
  const pack = loadPack(packsDir, packId);
  const out = (from: string) => pack.graph.edges.filter((e) => e.from === from);
  assert.deepEqual(out('read-timing').map((e) => e.to).sort(), ['himatime-agent', 'qualib-agent']);
  assert.ok(out('read-timing').every((e) => e.outcome === undefined));
  assert.deepEqual(out('himatime-agent').map((e) => e.to), ['requirements-joined']);
  assert.deepEqual(out('qualib-agent').map((e) => e.to), ['requirements-joined']);
  assert.equal(pack.graph.nodes.find((n) => n.id === 'requirements-joined')?.kind, 'judge');
  assert.deepEqual(out('next-round'), [{ from: 'next-round', to: 'load-timing', revisit: true }]);
  // Resident tasks are the owner's: no autopilot entry names the agent fork.
  assert.ok(pack.graph.autopilot.every((entry) => !('fork' in entry)));
  const judge = pack.graph.nodes.find((n) => n.id === 'judge-round');
  assert.ok(judge?.kind === 'judge');
  assert.deepEqual(judge.parameters.rules, ['round-valid', 'fmax-goal']);
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
  assert.ok(capability.sandbox.readOnlyRoots.includes('/data/eda/project/hima_harness/ctu-mock-eda'));
  assert.equal(capability.environment.toolPaths[0], '/data/eda/project/hima_harness/ctu-mock-eda/bin');
  assert.equal(capability.environment.set.EMPYREAN_LICENSE_MODE, 'old', 'the wrapper launch line tests it');
});

test('the mock EDA toolchain unit suite passes (python3 -m unittest)', () => {
  const run = spawnSync('python3', ['-m', 'unittest', 'sites/eda_cluster_ctu_01/mock-eda/tests/test_mock_eda.py'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
