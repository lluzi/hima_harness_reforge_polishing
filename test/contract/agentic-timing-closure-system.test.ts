import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cp, mkdir } from 'node:fs/promises';
import { loadPack, checkPack, loadSite, packStage, installPackMethod } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'agentic-timing-closure-system';
const atcsXtopOperatorWrapper = '/data/eda/project/hima_harness/operator-admin/atcs-v1/atcs-xtop-operator.sh';

test('the agentic timing closure system Pack loads, fits linglong-atcs28 and the local Site, and passes its Python contract tests', async (t) => {
  const h = await createHimaHome();
  t.after(() => h.dispose());
  const local = await writeLocalSite(h, {
    allowedWrappers: ['python3', '/usr/bin/python3', atcsXtopOperatorWrapper],
    bindings: {
      designStateManifest: path.join(h.workspace, 'designStateManifest.json'),
      analysisContract: path.join(h.workspace, 'analysisContract'),
      siteCapabilities: path.join(h.workspace, 'siteCapabilities.json'),
      workspaceRoot: h.workspace,
    },
    licences: { innovus: 1, primetime: 1, starrc: 1, xtop: 1 },
  });

  const packDir = path.join(repoRoot, 'packs', packId);
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(packStage(packDir).stage, 'compiled');
  assert.equal(pack.graph.nodes.length, 102);
  assert.equal(pack.graph.edges.length, 137);

  const localCheck = checkPack(pack, loadSite(local.sitesDir, local.name));
  assert.equal(localCheck.fit, true, localCheck.errors.join('\n'));

  // `sites/linglong-atcs28/{site.yml,permit.yml}` are administrator-facing policy templates, published
  // into a Harness home's `hima/sites/` as `<name>.yml` (with the Permit beside it) exactly the way a
  // customer's CAD publishes the reference `sites/linglong/` Site (see `README.md`); `loadSite` reads
  // that published shape, not the repository's own generic filenames, so this reproduces it.
  const atcs28SourceDir = path.join(repoRoot, 'sites/linglong-atcs28');
  const atcs28SitesDir = path.join(h.home, 'reference-sites');
  await mkdir(atcs28SitesDir, { recursive: true });
  await cp(path.join(atcs28SourceDir, 'site.yml'), path.join(atcs28SitesDir, 'linglong-atcs28.yml'));
  await cp(path.join(atcs28SourceDir, 'permit.yml'), path.join(atcs28SitesDir, 'permit.yml'));
  const atcs28Site = loadSite(atcs28SitesDir, 'linglong-atcs28');
  const atcs28Check = checkPack(pack, atcs28Site);
  assert.equal(atcs28Check.fit, true, atcs28Check.errors.join('\n'));

  // No tool or workshop argv may reference the frozen old pack's design-zoo Foundation root or its
  // own Site's workspace-root folder name -- this Pack's own argv is workspace-relative only
  // (`${WORKSPACE}`-bound), never a literal path into another Pack's Site.
  const forbidden = [/\/data\/eda\/project\/design_zoo/, /xtop-timing-closure-runs/];
  const argvWords: string[] = [];
  for (const tool of pack.contract.tools) {
    argvWords.push(...tool.argv);
    if (tool.interactive?.argv) argvWords.push(...tool.interactive.argv);
  }
  for (const workshop of pack.contract.workshops) argvWords.push(...workshop.argv);
  for (const word of argvWords) {
    for (const pattern of forbidden) assert.doesNotMatch(word, pattern, `argv word "${word}" references a forbidden path`);
  }

  installPackMethod({ from: packDir, to: path.join(h.home, 'hima/packs', packId) });
  const host = await bootInProcess(h);
  try {
    const throughHost = await himaCommand(host, h.workspace, `/hima pack check ${packId} --site local`);
    assert.equal(throughHost.kind, 'success', throughHost.text);
    assert.match(throughHost.text, /agentic-timing-closure-system@0\.1\.0.*fit/s);
  } finally { await host.dispose(); }

  const tests = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', path.join(packDir, 'flow/tests'), '-v'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(tests.status, 0, `${tests.stdout}\n${tests.stderr}`);
});
