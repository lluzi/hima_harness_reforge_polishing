import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { repoRoot } from './support/dsh-home.ts';

test('analysis handoff verifies actual point-to-netlist identity and solves a known six-cell fixture without accepting changed bytes', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aes-analysis-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  const netlist = 'module aes_cipher_top (a,z);\n' + Array.from({ length: 6 }, (_, i) => `INV U${i + 1} (.I(n${i}), .ZN(n${i + 1}));`).join('\n') + '\nendmodule\n';
  const timing = '  Startpoint: launch\n  Endpoint: capture\n  Path Group: clk\n' + Array.from({ length: 6 }, (_, i) => `  U${i + 1}/ZN (INV) 0.1 0.1 r`).join('\n');
  await writeFile(path.join(root, 'netlist.v'), netlist);
  await writeFile(path.join(root, 'timing.rpt'), timing);
  const bind = async (report: string) => {
    const manifest = JSON.stringify({ format: 'aes-probe/1', toolExit: 0, evidence: { 'timing.rpt': { path: 'timing.rpt', sha256: sha(report) }, 'netlist.v': { path: 'netlist.v', sha256: sha(netlist) } } });
    await writeFile(path.join(root, 'manifest.json'), manifest);
    await writeFile(path.join(root, 'evidence.json'), JSON.stringify({ status: 'passed', observed: { methodBeforeTest: '0'.repeat(64), methodDigest: '0'.repeat(64) }, runs: [{ run: { id: 'synthetic-analysis-fixture', siteId: 'fixture', packId: 'aes-tsmc28-dtco', status: 'ended-goal-met', packDigest: '0'.repeat(64) },
      records: [{ type: 'observation', id: 'synthetic-analysis-fixture#000001', runId: 'synthetic-analysis-fixture', siteId: 'fixture', reader: { id: 'aes-probe-reading', version: '1', reportKind: 'aes-probe/1', sha256: '0'.repeat(64) }, generation: 1, contentSha256: sha(manifest) }] }] }));
  };
  await bind(timing);
  const args = [path.join(repoRoot, 'scripts/aes-probe-handoff.py'), '--evidence', path.join(root, 'evidence.json'),
    '--manifest', path.join(root, 'manifest.json'), '--flow', root, '--sample-out', path.join(root, 'sample.json'),
    '--oracle-out', path.join(root, 'oracle.json'), '--max-paths', '4', '--max-candidates', '8'];
  const result = spawnSync('python3', args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const oracle = JSON.parse(await readFile(path.join(root, 'oracle.json'), 'utf8'));
  assert.equal(oracle.bestScore, 6, 'two disjoint three-cell motifs cover all six fixture cells');
  const sample = JSON.parse(await readFile(path.join(root, 'sample.json'), 'utf8'));
  assert.equal(sample.paths[0].points.length, 6);
  assert.equal(sample.source.observation, 'synthetic-analysis-fixture#000001');
  const changed = timing.replace('U3/ZN', 'U99/ZN');
  await writeFile(path.join(root, 'timing.rpt'), changed);
  const tampered = spawnSync('python3', args, { encoding: 'utf8' });
  assert.notEqual(tampered.status, 0); assert.match(tampered.stderr, /hash mismatch/);
  await bind(changed);
  const foreignObject = spawnSync('python3', args, { encoding: 'utf8' });
  assert.notEqual(foreignObject.status, 0); assert.match(foreignObject.stderr, /does not match the netlist instance\/pin/);
  const saved = JSON.parse(await readFile(path.join(root, 'evidence.json'), 'utf8'));
  for (const mutate of [
    (doc: typeof saved) => { doc.runs[0].run.packId = 'unrelated-pack'; },
    (doc: typeof saved) => { doc.runs[0].records[0].runId = 'another-run'; },
    (doc: typeof saved) => { doc.runs[0].records[0].reader.reportKind = 'unrelated-report'; },
    (doc: typeof saved) => { doc.observed.methodDigest = '1'.repeat(64); },
  ]) {
    const doc = structuredClone(saved); mutate(doc);
    await writeFile(path.join(root, 'evidence.json'), JSON.stringify(doc));
    const invalidIdentity = spawnSync('python3', args, { encoding: 'utf8' });
    assert.notEqual(invalidIdentity.status, 0); assert.match(invalidIdentity.stderr, /identity does not match the validated probe/);
  }
});
