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

test('an unfinished candidate manifest cannot be verified or mistaken for a releasable App', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'hima-incomplete-candidate-'));
  try {
    const app = path.join(output, 'HimaHarness.app');
    await writeFile(path.join(output, 'trial-manifest.json'), JSON.stringify({ format: 2, status: 'building', files: {} }));
    const checked = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-trial.mjs'), '--verify', app], {
      cwd: repoRoot, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(checked.status, 1);
    assert.match(checked.stderr, /candidate validation has not finished/);
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
    const missingTiming = check();
    assert.equal(missingTiming.status, 1);
    assert.match(missingTiming.stderr, /timing Pack xtop-timing-closure is missing contract\.yml/);
    const timing = path.join(packs, 'xtop-timing-closure');
    for (const file of ['contract.yml', 'graph.yml', 'knowledge/manifest.yml',
      'flow/closure.py', 'flow/templates/apply-eco.tcl', 'tools/read-output.py']) {
      await mkdir(path.dirname(path.join(timing, file)), { recursive: true });
      await writeFile(path.join(timing, file), file === 'contract.yml'
        ? 'id: xtop-timing-closure\nversion: "1.0.7"\n'
        : file === 'graph.yml' ? 'id: xtop-timing-closure\nversion: "1.0.7"\nentry: export\n' : '# fixture\n');
    }
    await writeFile(path.join(timing, 'graph.yml'), 'id: xtop-timing-closure\nversion: "1.0.6"\nentry: export\n');
    const wrongVersion = check();
    assert.equal(wrongVersion.status, 1);
    assert.match(wrongVersion.stderr, /versions differ/);
    await writeFile(path.join(timing, 'graph.yml'), 'id: xtop-timing-closure\nversion: "1.0.7"\nentry: export\n');
    const missingDemo = check();
    assert.equal(missingDemo.status, 1);
    assert.match(missingDemo.stderr, /local demo Pack opene902-timing-probe is missing contract\.yml/);
    const demo = path.join(packs, 'opene902-timing-probe');
    await mkdir(path.join(demo, 'tools'), { recursive: true });
    await writeFile(path.join(demo, 'contract.yml'), 'id: opene902-timing-probe\n');
    await writeFile(path.join(demo, 'graph.yml'), 'id: opene902-timing-probe\n');
    await writeFile(path.join(demo, 'tools/synth.sh'), '# local demo fixture\n');
    await writeFile(path.join(demo, 'contract.yml'), 'id: unrelated-probe\nversion: "2"\n');
    await writeFile(path.join(demo, 'graph.yml'), 'id: unrelated-probe\nversion: "2"\n');
    const wrongDemo = check();
    assert.equal(wrongDemo.status, 1);
    assert.match(wrongDemo.stderr, /local demo Pack contract\/graph identity differs/);
    await writeFile(path.join(demo, 'contract.yml'), 'id: opene902-timing-probe\nversion: "2"\n');
    await writeFile(path.join(demo, 'graph.yml'), 'id: opene902-timing-probe\nversion: "2"\n');
    const complete = check();
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(complete.stdout, /checked custom-cell-fmax-dtco, xtop-timing-closure and opene902-timing-probe assets/);
  } finally { await (await import('node:fs/promises')).rm(output, { recursive: true, force: true }); }
});
