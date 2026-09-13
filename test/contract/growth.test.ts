// PLS-10 L1: the public Pack growth validator, with expectations stated independently of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPack, packDigestOf, validateGrowthGraph, type GrowthProposal } from '@hima/harness';
import { shippedPacksDir, timingProbePackId } from './support/pack.ts';

async function growthPack() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-growth-l1-'));
  const id = 'growth-l1';
  const dir = path.join(root, id);
  await cp(path.join(shippedPacksDir, timingProbePackId), dir, { recursive: true });
  for (const file of ['contract.yml', 'graph.yml']) {
    const at = path.join(dir, file);
    await writeFile(at, (await readFile(at, 'utf8')).replace(`id: ${timingProbePackId}`, `id: ${id}`));
  }
  const graph = path.join(dir, 'graph.yml');
  await writeFile(graph, (await readFile(graph, 'utf8')).replace(
    'chooser: over-constraining-push',
    'chooser: over-constraining-push\n      growth: true',
  ));
  return { root, pack: loadPack(root, id), digest: packDigestOf(dir) };
}

function proposal(pack: Awaited<ReturnType<typeof growthPack>>['pack'], digest: string): GrowthProposal {
  return {
    proposalId: 'mine-critical-cell',
    method: { id: pack.id, version: pack.contract.version, digest },
    parent: { nodeId: 'next-period', generation: 1 },
    inputThroughSeq: 8,
    inputs: [{ recordId: 'record-8', contentIdentity: 'a'.repeat(64) }],
    impactNodes: ['synthesize', 'read-qor', 'judge', 'next-period'],
    expectedChanges: ['mine one critical path candidate without changing the reference method'],
    nodes: [
      { id: 'growth-synthesize', kind: 'act', parameters: { tool: 'synth', arguments: { PERIOD_NS: 2.2 } } },
      { id: 'growth-read', kind: 'act', parameters: { observes: 'qorReport', arguments: {} } },
      { id: 'growth-judge', kind: 'judge', parameters: { rules: ['setup-wns-all-nonnegative'], bind: {} } },
    ],
    edges: [
      { from: 'growth-synthesize', to: 'growth-read' },
      { from: 'growth-read', to: 'growth-judge' },
      { from: 'growth-judge', to: 'next-period', outcome: 'PASS' },
      { from: 'growth-judge', to: 'next-period', outcome: 'FAIL' },
      { from: 'growth-judge', to: 'next-period', outcome: 'UNDETERMINED' },
    ],
    requiredOutputs: ['qorReport'],
    endCondition: 'the added observation and its verdict are recorded',
    returnNode: 'next-period',
    optional: true,
  };
}

test('one declared top-level growth point accepts an additive acyclic branch and leaves the reference graph byte-identical', async () => {
  const fixture = await growthPack();
  try {
    const before = await readFile(path.join(fixture.pack.dir, 'graph.yml'), 'utf8');
    const result = validateGrowthGraph(fixture.pack, proposal(fixture.pack, fixture.digest));
    assert.equal(result.ok, true, JSON.stringify(result));
    if (!result.ok) return;
    assert.equal(result.graph.graph.entry, 'growth-synthesize');
    assert.deepEqual(result.graph.graph.nodes.map((node) => node.id), ['growth-synthesize', 'growth-read', 'growth-judge']);
    assert.equal(await readFile(path.join(fixture.pack.dir, 'graph.yml'), 'utf8'), before);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

test('growth rejects reference rewrites, duplicate ids, cycles, missing return/output and nested shapes before acceptance', async () => {
  const fixture = await growthPack();
  try {
    const base = proposal(fixture.pack, fixture.digest);
    const cases: [string, GrowthProposal][] = [
      ['already belongs to the reference graph', { ...base, nodes: [{ ...base.nodes[0]!, id: 'synthesize' }] }],
      ['may only leave added nodes', { ...base, edges: [{ from: 'next-period', to: 'growth-synthesize' }] }],
      ['cycle', { ...base, edges: [...base.edges, { from: 'growth-read', to: 'growth-synthesize' }] }],
      ['return to its declared parent', { ...base, returnNode: 'judge' }],
      ['required output', { ...base, requiredOutputs: ['missingOutput'] }],
      ['nested', { ...base, nodes: [{ id: 'nested', kind: 'explore', parameters: { opens: 'detail', bind: {} } }] }],
    ];
    for (const [reason, candidate] of cases) {
      const result = validateGrowthGraph(fixture.pack, candidate);
      assert.equal(result.ok, false, `${reason}: ${JSON.stringify(result)}`);
      if (!result.ok) assert.match(result.reason, new RegExp(reason));
    }
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
