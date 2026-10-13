// Live tool view plan task 1: a Site may declare `toolView` (today: an xpra HTML5 display). This
// slice is the declaration alone — schema, strict-save key lists, the `Site`/`SiteHeadView` types —
// never a Host process or a route. No SSH is spawned by anything here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { loadSite, siteSaveIdentity } from '@hima/harness';
import type { SiteHeadView } from '@hima/harness';

/** Write a minimal local Site file directly (bypassing `writeLocalSite`, which has no `toolView`
 *  parameter) so the test controls exactly what the Site declares. */
async function writeSiteFile(sitesDir: string, name: string, workspaceRoot: string, extra: readonly string[] = []): Promise<void> {
  await mkdir(sitesDir, { recursive: true });
  await writeFile(path.join(sitesDir, `${name}.permit.yml`), [
    'allowedReadRoots: []',
    'allowedWriteRoots: []',
    'allowedWrappers: []',
    'forbidden: []',
    '',
  ].join('\n'));
  await writeFile(path.join(sitesDir, `${name}.yml`), [
    `name: ${name}`,
    'kind: local',
    `workspaceRoot: ${workspaceRoot}`,
    `permit: ./${name}.permit.yml`,
    'capacity:',
    '  cores: 8',
    '  memoryGiB: 16',
    '  parallelJobs: 1',
    '  licences: {}',
    ...extra,
    '',
  ].join('\n'));
}

test('loadSite exposes a declared toolView, with its label as given', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'mage-site', h.workspace, [
      'toolView:',
      '  kind: xpra-html5',
      '  port: 14500',
      '  label: MAGE',
    ]);
    const site = loadSite(sitesDir, 'mage-site');
    assert.deepEqual(site.toolView, { kind: 'xpra-html5', port: 14500, label: 'MAGE' });
  } finally { await h.dispose(); }
});

test('a Site without toolView loads unchanged', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'plain-site', h.workspace);
    const site = loadSite(sitesDir, 'plain-site');
    assert.equal(site.toolView, undefined);
  } finally { await h.dispose(); }
});

test('the strict save path refuses an unrecognized toolView field', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'extra-field-site', h.workspace, [
      'toolView:',
      '  kind: xpra-html5',
      '  port: 14500',
      '  extra: 1',
    ]);
    assert.throws(() => siteSaveIdentity(sitesDir, 'extra-field-site'), /toolView/);
  } finally { await h.dispose(); }
});

test('the strict save path refuses an unknown toolView kind', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'bad-kind-site', h.workspace, [
      'toolView:',
      '  kind: vnc',
      '  port: 14500',
    ]);
    assert.throws(() => siteSaveIdentity(sitesDir, 'bad-kind-site'));
  } finally { await h.dispose(); }
});

test('GET /hima/api/sites carries toolView as {kind, label}, never the port, and defaults the label to "Tool"', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'mage-site', h.workspace, [
      'toolView:',
      '  kind: xpra-html5',
      '  port: 14500',
      '  label: MAGE',
    ]);
    await writeSiteFile(sitesDir, 'unlabeled-site', h.workspace, [
      'toolView:',
      '  kind: xpra-html5',
      '  port: 14600',
    ]);
    const host = await bootHimaHost(h);
    try {
      const cookie = await openSession(host);
      const res = await api(host, cookie, '/hima/api/sites');
      const body = await res.json() as { sites: SiteHeadView[] };
      assert.equal(res.status, 200, JSON.stringify(body));
      const labeled = body.sites.find((s) => s.name === 'mage-site');
      assert.deepEqual(labeled?.toolView, { kind: 'xpra-html5', label: 'MAGE' }, JSON.stringify(body));
      assert.equal((labeled as unknown as { toolView: { port?: number } }).toolView.port, undefined, 'the client never learns the Site\'s own port');
      const unlabeled = body.sites.find((s) => s.name === 'unlabeled-site');
      assert.deepEqual(unlabeled?.toolView, { kind: 'xpra-html5', label: 'Tool' }, JSON.stringify(body));
    } finally {
      assert.equal(await host.stop(), 0, host.stderr());
    }
  } finally { await h.dispose(); }
});
