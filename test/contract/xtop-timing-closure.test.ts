import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPack, checkPack, packStage, loadSite } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'xtop-timing-closure';

test('the XTop closure Pack loads, fits its declared execution surface and passes its cheap data-contract tests', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const local = await writeLocalSite(h, {
    allowedWrappers: ['/usr/bin/python3'],
    bindings: {
      inputInnovusDatabase: path.join(h.workspace, 'input.enc.dat'),
      siteProfile: path.join(h.workspace, 'site-profile.json'),
      sourceManifest: path.join(h.workspace, 'source-manifest.sha256'),
      workspaceRoot: h.workspace,
    },
    licences: { Innovus: 1, StarRC: 1, PrimeTime: 1, XTop: 1 },
  });
  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(packStage(packDir).stage, 'compiled');
  assert.equal(pack.graph.nodes.length, 28);
  assert.equal(pack.graph.edges.length, 28);
  const check = checkPack(pack, loadSite(local.sitesDir, local.name));
  assert.equal(check.fit, true, check.errors.join('\n'));

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});
