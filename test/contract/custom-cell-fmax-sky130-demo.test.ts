import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPack, loadPack, loadSite } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';

const packId = 'custom-cell-fmax-sky130-demo';
const packsDir = path.join(repoRoot, 'packs');
const packDir = path.join(packsDir, packId);
const siteDir = path.join(repoRoot, 'sites/linglong-sky130-cells');

// Names the harness binds into any tool's argv itself; every other declared input needs a node binding.
const HARNESS_ARGV = new Set(['WORKSPACE', 'FLOW_ROOT', 'DESIGN', 'CAMPAIGN']);

test('the demo Pack loads and declares the matched-arm custom-cell round', () => {
  const pack = loadPack(packsDir, packId);
  assert.equal(pack.contract.id, packId);
  assert.equal(pack.graph.version, pack.contract.version, 'graph and contract versions must match');
  assert.equal(pack.graph.entry, 'bind-inputs');
  assert.deepEqual(pack.contract.tools.map((t) => t.id), ['bind-inputs', 'baseline', 'engineer', 'characterize', 'arm-custom', 'arm-control', 'compare-round']);
  for (const tool of pack.contract.tools) assert.deepEqual(tool.licences, {}, `${tool.id} holds no licence`);
  // A source: pack workspace copies each entry from the Pack's own flow/ directory.
  assert.equal(pack.contract.workspace.source, 'pack');
  for (const entry of pack.contract.workspace.copy ?? []) assert.ok(existsSync(path.join(packDir, 'flow', entry)), `flow/${entry} must exist in the Pack`);
  for (const tool of pack.contract.tools) {
    assert.ok(tool.file.startsWith('flow/'), `${tool.id} file lives under flow/`);
    assert.ok((pack.contract.workspace.copy ?? []).includes(path.relative('flow', tool.file)), `${tool.id} file is copied into the workspace`);
  }
  const engineer = pack.contract.tools.find((t) => t.id === 'engineer')!;
  assert.equal(engineer.outsourcing?.produces, 'roundRecipe');
  assert.equal(engineer.outsourcing?.artifactPrefix, 'cells');
  assert.deepEqual(engineer.outsourcing?.reads, ['inputsState', 'baselineState', 'lessons', 'best']);
  // The engineer's result is accepted only through its Reader (the Pack validator).
  assert.equal(pack.contract.outputs.find((o) => o.name === 'roundRecipe')?.reader, 'cellfmax-recipe');
  assert.equal(pack.contract.budget.timeBoxMs, 28_800_000);
  assert.equal(pack.contract.goal.target_fmax_gain_pct?.default, 5);
});

test('the graph measures the library, forks two measured arms into a judge join and loops through an owner decision', () => {
  const pack = loadPack(packsDir, packId);
  const out = (from: string) => pack.graph.edges.filter((e) => e.from === from);
  // HimaHarness characterizes the engineer's cells before any arm runs; the arms fork from that step.
  assert.deepEqual(out('engineer').map((e) => e.to), ['characterize']);
  assert.deepEqual(out('characterize').map((e) => e.to).sort(), ['arm-control', 'arm-custom']);
  assert.ok(out('characterize').every((e) => e.outcome === undefined), 'the fork edges are unlabelled');
  const join = pack.graph.nodes.find((n) => n.id === 'arms-joined');
  assert.equal(join?.kind, 'judge');
  const next = pack.graph.nodes.find((n) => n.id === 'next-round');
  assert.equal(next?.kind, 'explore');
  assert.deepEqual(out('next-round'), [{ from: 'next-round', to: 'engineer', revisit: true }]);
  const judge = pack.graph.nodes.find((n) => n.id === 'judge-round');
  assert.ok(judge?.kind === 'judge');
  // First rule is the constraint, second the goal; only these two gate goal-met.
  assert.deepEqual(judge.parameters.rules, ['comparison-valid', 'fmax-goal']);
  if (next?.kind === 'explore') assert.equal(next.parameters.converge?.generationLimit, 4);
});

test('every ${NAME} in a tool argv is bound by the contract or the harness', () => {
  const pack = loadPack(packsDir, packId);
  const bound = new Map<string, Record<string, unknown>>();
  for (const node of pack.graph.nodes) if (node.kind === 'act' && node.parameters.tool) bound.set(node.parameters.tool, node.parameters.arguments);
  for (const tool of pack.contract.tools) {
    const declared = new Set(tool.inputs);
    for (const word of tool.argv) for (const m of word.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      assert.ok(declared.has(m[1]!), `tool ${tool.id} argv uses \${${m[1]}} without declaring it`);
    }
    for (const name of tool.inputs) {
      if (HARNESS_ARGV.has(name)) continue;
      assert.ok(Object.hasOwn(bound.get(tool.id) ?? {}, name), `tool ${tool.id} input ${name} is bound by no graph node argument`);
    }
  }
});

test('the committed SKY130 Site and Permit fit the Pack; a Permit without python3 is refused', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cellfmax-site-'));
  try {
    const sitesDir = path.join(root, 'sites');
    await mkdir(sitesDir, { recursive: true });
    await writeFile(path.join(sitesDir, 'linglong-sky130-cells.yml'), await readFile(path.join(siteDir, 'site.yml'), 'utf8'));
    const permit = await readFile(path.join(siteDir, 'permit.yml'), 'utf8');
    await writeFile(path.join(sitesDir, 'permit.yml'), permit);
    const site = loadSite(sitesDir, 'linglong-sky130-cells');
    assert.equal(site.kind, 'ssh');
    assert.ok(site.permitRules.allowedWriteRoots.every((r) => !r.includes('celluzi')), 'celluzi is never a write root');
    const pack = loadPack(packsDir, packId);
    const fit = checkPack(pack, site);
    assert.equal(fit.fit, true, fit.errors.join('\n'));

    await writeFile(path.join(sitesDir, 'permit.yml'), permit.replace('  - /usr/bin/python3\n', '').replace('  - python3\n', ''));
    const refused = checkPack(pack, loadSite(sitesDir, 'linglong-sky130-cells'));
    assert.equal(refused.fit, false);
    assert.match(refused.errors.join('\n'), /python3/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the resident capability points at the installed v2 wrapper and the no-entrypoint image', async () => {
  const capability = JSON.parse(await readFile(path.join(siteDir, 'engineering-capabilities-sky130.json'), 'utf8'));
  const site = await readFile(path.join(siteDir, 'site.yml'), 'utf8');
  const installed = '/data/eda/project/hima_harness/operator-admin/resident-engineering-v2/engineering-capabilities-sky130.json';
  assert.deepEqual(capability.wrapper.argv.slice(1), ['--capability', installed]);
  assert.ok(site.includes(`engineeringCapabilities: ${installed}`));
  assert.equal(capability.native.model, 'deepseek/deepseek-flash');
  assert.ok(site.includes(`containerImage: ${capability.sandbox.image}`), 'arms and the engineer share one image identity');
  assert.ok(!JSON.stringify(capability).includes('tsmc28'), 'no TSMC28 roots in the SKY130 sandbox');
});

test('the Pack tool, Reader and characterizer unit suites pass (python3 -m unittest)', () => {
  for (const suite of ['test/contract/support/cellfmax_cli_test.py', 'test/contract/support/cellfmax_char_test.py']) {
    const run = spawnSync('python3', ['-m', 'unittest', suite], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, `${suite}\n${run.stdout}\n${run.stderr}`);
  }
});
