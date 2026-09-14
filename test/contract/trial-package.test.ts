// L0/L2 release seam: inspect the product artifact without opening an Electron window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from './support/dsh-home.ts';

test('trial packager help is inert and its public verifier fails closed for an incomplete app', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-trial-'));
  try {
    const app = path.join(output, 'HimaHarness.app');
    await writeFile(path.join(output, 'note'), 'fixture');
    const help = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--help'], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /usage:/);
    const verified = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--verify', app], { cwd: repoRoot, encoding: 'utf8', timeout: 10_000 });
    assert.equal(verified.status, 1);
    assert.match(verified.stderr, /manifest missing/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});

test('trial packager refuses a candidate Pack with no contract or a manifest whose knowledge is absent', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-trial-pack-'));
  const packs = path.join(output, 'packs');
  const pack = path.join(packs, 'custom-cell-fmax-dtco');
  const check = () => spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--check-pack-assets', packs], {
    cwd: repoRoot, encoding: 'utf8', timeout: 10_000,
  });
  try {
    await mkdir(pack, { recursive: true });
    const missingContract = check();
    assert.equal(missingContract.status, 1);
    assert.match(missingContract.stderr, /missing required asset contract\.yml/);

    await mkdir(path.join(pack, 'knowledge'), { recursive: true });
    await writeFile(path.join(pack, 'contract.yml'), 'id: custom-cell-fmax-dtco\nknowledgeManifest: knowledge/manifest.yml\n');
    await writeFile(path.join(pack, 'graph.yml'), 'id: custom-cell-fmax-dtco\nentry: bind-inputs\n');
    await writeFile(path.join(pack, 'knowledge/manifest.yml'), [
      'schema: hima-pack-knowledge/1',
      'documents:',
      '  - id: portable-method',
      '    file: portable-method.md',
      '',
    ].join('\n'));
    const missingKnowledge = check();
    assert.equal(missingKnowledge.status, 1);
    assert.match(missingKnowledge.stderr, /names missing document portable-method\.md/);

    await writeFile(path.join(pack, 'knowledge/portable-method.md'), '# portable method\n');
    const complete = check();
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /checked custom-cell-fmax-dtco assets/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});
