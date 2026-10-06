// @hima-seam reader CLI
// Synthetic finite data only: this proves the Pack reader's public file contract, not AES research.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { repoRoot } from './support/dsh-home.ts';

const reader = path.join(repoRoot, 'packs/aes-timing-research/tools/read-selection.py');

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aes-selection-reader-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = path.join(root, 'selection.json');
  const sample = {
    schema: 'aes-path-motifs/1', budget: 2,
    paths: [
      { id: 'p1', points: [{ instance: 'u1', master: 'M1', sourceLine: 1 }] }, { id: 'p2', points: [{ instance: 'u1', master: 'M1', sourceLine: 2 }] },
      { id: 'p3', points: [{ instance: 'u1', master: 'M1', sourceLine: 30 }, { instance: 'u2', master: 'M2', sourceLine: 31 }] }, { id: 'p4', points: [{ instance: 'u3', master: 'M3', sourceLine: 4 }] },
      { id: 'p5', points: [{ instance: 'u2', master: 'M2', sourceLine: 5 }] }, { id: 'p6', points: [{ instance: 'u3', master: 'M3', sourceLine: 6 }] },
    ],
    candidates: [
      { id: 'a', cells: ['u1'], masters: ['M1'], occurrences: [{ path: 'p1', begin: 0, sourceLines: [1] }, { path: 'p2', begin: 0, sourceLines: [2] }] },
      { id: 'b', cells: ['u1', 'u2'], masters: ['M1', 'M2'], occurrences: [{ path: 'p3', begin: 0, sourceLines: [30, 31] }] },
      { id: 'c', cells: ['u3'], masters: ['M3'], occurrences: [{ path: 'p4', begin: 0, sourceLines: [4] }] },
    ],
  };
  const samplePath = path.join(root, 'sample.json');
  await writeFile(samplePath, JSON.stringify(sample));
  return { report, sample, samplePath, out: path.join(root, 'read.json'), digest: createHash('sha256').update(await readFile(samplePath)).digest('hex') };
}

test('selection reader derives score and physical-cell conflict from the parent sample rather than model fields', async (t) => {
  const f = await fixture(t);
  await writeFile(f.report, JSON.stringify({ sampleSha256: f.digest, selected: ['a', 'b'] }));
  const result = spawnSync('/usr/bin/python3', [reader, f.report, f.out], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(f.out, 'utf8')).values, [
    { type: 'selection_score', unit: 'count', value: 4 },
    { type: 'selected_count', unit: 'count', value: 2 },
    { type: 'conflict_count', unit: 'count', value: 1 },
  ]);
});

for (const selection of [
  { sampleSha256: 'wrong', selected: [] },
  { sampleSha256: '', selected: ['a', 'a'] },
  { sampleSha256: '', selected: ['missing'] },
  { sampleSha256: '', selected: ['a', 'b', 'c'] },
  { sampleSha256: '', selected: [], inventedScore: 999 },
]) {
  test(`selection reader refuses structural input ${JSON.stringify(selection)}`, async (t) => {
    const f = await fixture(t);
    const value = { ...selection, sampleSha256: selection.sampleSha256 || f.digest };
    await writeFile(f.report, JSON.stringify(value));
    const result = spawnSync('/usr/bin/python3', [reader, f.report, f.out], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    await assert.rejects(readFile(f.out), { code: 'ENOENT' });
  });
}


test('distinct physical cells may share a master, but occurrence indexing and ordered provenance must match exactly', async (t) => {
  const f = await fixture(t);
  f.sample.candidates[1]!.masters = ['M1', 'M1'];
  f.sample.paths[2]!.points[1]!.master = 'M1';
  await writeFile(f.samplePath, JSON.stringify(f.sample));
  const digest = createHash('sha256').update(await readFile(f.samplePath)).digest('hex');
  await writeFile(f.report, JSON.stringify({ sampleSha256: digest, selected: ['b'] }));
  const valid = spawnSync('/usr/bin/python3', [reader, f.report, f.out], { encoding: 'utf8' });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(await readFile(f.out, 'utf8')).values[0].value, 2);
  for (const [i, occurrence] of [
    { path: 'p3', begin: 1, sourceLines: [30, 31] },
    { path: 'p3', begin: 0, sourceLines: [31, 30] },
    { path: 'p3', begin: 0, sourceLines: [30] },
  ].entries()) {
    const changed = structuredClone(f.sample);
    changed.candidates[1]!.occurrences = [occurrence];
    await writeFile(f.samplePath, JSON.stringify(changed));
    const hash = createHash('sha256').update(await readFile(f.samplePath)).digest('hex');
    await writeFile(f.report, JSON.stringify({ sampleSha256: hash, selected: ['b'] }));
    const output = f.out + '.bad-' + i;
    const invalid = spawnSync('/usr/bin/python3', [reader, f.report, output], { encoding: 'utf8' });
    assert.notEqual(invalid.status, 0); await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});
