import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { checkPack, loadPack, loadSite, packKnowledgeManifestOf, packOverview, searchPackKnowledge } from '@hima/harness';
import { repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';
import { createHimaHome } from './support/dsh-home.ts';

const packDir = path.join(repoRoot, 'packs/custom-cell-fmax-dtco');

const contractInputs = [
  'flowRoot', 'designRoot', 'rtlGlob', 'designTop', 'constraints',
  'foundryLibrary', 'physicalInputs', 'toolStack', 'workspaceRoot',
];

test('the portable Pack has no AES, process-node, or customer-flow binding and declares Site-owned production inputs', async () => {
  const contract = parse(await readFile(path.join(packDir, 'contract.yml'), 'utf8')) as {
    id: string; inputs: { name: string }[]; tools: { id: string; recommendedVersion?: string }[];
  };
  assert.equal(contract.id, 'custom-cell-fmax-dtco');
  assert.deepEqual(contract.inputs.map((item) => item.name), contractInputs);
  for (const id of ['synthesize', 'compile', 'pnr-foundry', 'pnr-generated', 'verify']) {
    assert.match(contract.tools.find((tool) => tool.id === id)?.recommendedVersion ?? '', /current Site-supported release/);
  }
  const files = await Promise.all([
    'INTENT.md', 'SPEC.md', 'FABRIC.md', 'TEST.md', 'contract.yml', 'graph.yml', 'semantics.yml',
    'flow/probe.py', 'flow/stages.py', 'flow/read-stage.py', 'knowledge/full-mining-method.md',
  ].map((file) => readFile(path.join(packDir, file), 'utf8')));
  assert.doesNotMatch(files.join('\n'), /aes_cipher_top|tsmc28|Golden Flow/i);
});

test('two different Site bindings fit the Pack and a missing production binding is named', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const bindings = Object.fromEntries(contractInputs.map((name) => [name, path.join(h.workspace, name)]));
  const site = await writeLocalSite(h, {
    bindings,
    allowedWrappers: ['/usr/bin/python3'],
    licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
  });
  const pack = loadPack(path.join(repoRoot, 'packs'), 'custom-cell-fmax-dtco');
  assert.equal(packOverview(pack).status?.normalized, 'development');
  assert.equal(packOverview(pack).minimumHarnessVersion, '0.1.0');
  assert.equal(packKnowledgeManifestOf(pack)?.documents.length, 2);
  const knowledge = await searchPackKnowledge(pack, 'matched comparison custom cell adoption');
  assert.ok(knowledge.length > 0);
  assert.equal(knowledge[0]?.document.source, 'pack');
  assert.deepEqual(checkPack(pack, loadSite(site.sitesDir, site.name)).errors, []);
  for (const designTop of ['held_out_control', 'held_out_datapath']) {
    const varied = { ...bindings, designTop };
    const variedSite = await writeLocalSite(h, {
      bindings: varied,
      allowedWrappers: ['/usr/bin/python3'],
      licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
    });
    assert.deepEqual(checkPack(pack, loadSite(variedSite.sitesDir, variedSite.name)).errors, []);
  }
  delete bindings.physicalInputs;
  const missing = await writeLocalSite(h, {
    bindings,
    allowedWrappers: ['/usr/bin/python3'],
    licences: { 'Design-Compiler': 1, 'Library-Compiler': 1, Innovus: 1 },
  });
  assert.match(checkPack(pack, loadSite(missing.sitesDir, missing.name)).errors.join('\n'), /physicalInputs/);
});

test('the probe identity accepts different tops and makes its data identity depend on current RTL', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'custom-cell-fmax-pack-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const makeBinding = async (top: string, rtl: string) => {
    const workspace = path.join(root, top);
    const flow = path.join(workspace, 'flow');
    await mkdir(flow, { recursive: true });
    const synth = await readFile(path.join(packDir, 'flow/synth.tcl'), 'utf8');
    await Promise.all([
      writeFile(path.join(flow, 'rtl.v'), rtl),
      writeFile(path.join(flow, 'foundry.db'), 'synthetic database\n'),
      writeFile(path.join(flow, 'constraints.tcl'), `create_clock -name site_clk -period 0.5 [get_ports clk]\n`),
      writeFile(path.join(flow, 'wrapper'), '#!/bin/sh\nexit 0\n'),
      writeFile(path.join(flow, 'synth.tcl'), synth),
      writeFile(path.join(flow, 'inputs.json'), JSON.stringify({
        designTop: top, rtlGlob: path.join(flow, 'rtl.v'), foundryDb: path.join(flow, 'foundry.db'),
        edaWrapper: path.join(flow, 'wrapper'), constraintsTcl: path.join(flow, 'constraints.tcl'), clockName: 'site_clk',
      })),
    ]);
    return spawnSync('/usr/bin/python3', [path.join(packDir, 'flow/probe.py'), '--workspace', workspace,
      '--period', '0.5', '--check-inputs'], { encoding: 'utf8' });
  };
  const first = await makeBinding('held_out_control', 'module held_out_control; endmodule\n');
  const second = await makeBinding('held_out_datapath', 'module held_out_datapath; wire changed; endmodule\n');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.notEqual(first.stdout, second.stdout, 'top and RTL bytes are held as distinct input identities');
});
