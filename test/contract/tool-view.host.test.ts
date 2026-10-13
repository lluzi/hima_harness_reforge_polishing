// Live tool view plan task 2: the `/tool-view` routes through a real subprocess Host. A local Site
// declares a toolView pointing at a fake page this test serves; the Host opens it (no process, since
// it is local) and publishes a localhost URL. No SSH is ever spawned — the Site is local, and the
// local group's no-ssh guard fails the run if one is attempted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import type { ToolViewStatus } from '@hima/harness';

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port')));
    });
  });
}

async function writeToolViewSite(sitesDir: string, name: string, workspaceRoot: string, port: number): Promise<void> {
  await mkdir(sitesDir, { recursive: true });
  await writeFile(path.join(sitesDir, `${name}.permit.yml`), ['allowedReadRoots: []', 'allowedWriteRoots: []', 'allowedWrappers: []', 'forbidden: []', ''].join('\n'));
  await writeFile(path.join(sitesDir, `${name}.yml`), [
    `name: ${name}`, 'kind: local', `workspaceRoot: ${workspaceRoot}`, `permit: ./${name}.permit.yml`,
    'capacity:', '  cores: 8', '  memoryGiB: 16', '  parallelJobs: 1', '  licences: {}',
    'toolView:', '  kind: xpra-html5', `  port: ${port}`, '  label: MAGE', '',
  ].join('\n'));
}

test('/tool-view reports stopped, then opens a local Site to a ready localhost URL', async () => {
  const h = await createHimaHome();
  const page = http.createServer((_req, res) => { res.statusCode = 200; res.end('fake tool page'); });
  try {
    const port = await freeLoopbackPort();
    await new Promise<void>((resolve) => page.listen(port, '127.0.0.1', resolve));
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeToolViewSite(sitesDir, 'local-tool', h.workspace, port);
    const host = await bootHimaHost(h);
    try {
      const cookie = await openSession(host);
      const sid = await createLiveSession(host, cookie, h.workspace);

      const before = await api(host, cookie, `/hima/api/tool-view?sessionId=${encodeURIComponent(sid)}&site=local-tool`);
      const beforeBody = await before.json() as ToolViewStatus;
      assert.equal(before.status, 200, JSON.stringify(beforeBody));
      assert.equal(beforeBody.state, 'stopped', JSON.stringify(beforeBody));

      const opened = await api(host, cookie, '/hima/api/tool-view', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, action: 'open', site: 'local-tool' }),
      });
      const openedBody = await opened.json() as ToolViewStatus;
      assert.equal(opened.status, 200, JSON.stringify(openedBody));
      assert.equal(openedBody.state, 'ready', JSON.stringify(openedBody));
      const ready = openedBody as Extract<ToolViewStatus, { state: 'ready' }>;
      assert.equal(ready.local, true);
      assert.equal(ready.label, 'MAGE');
      assert.ok(ready.url.startsWith(`http://localhost:${port}/`), ready.url);

      // Missing session is refused exactly as /libinsight refuses one.
      const noSession = await api(host, cookie, '/hima/api/tool-view?site=local-tool');
      assert.ok(noSession.status === 401 || noSession.status === 403, String(noSession.status));

      // An unknown Site is unavailable, answered 200 — never a spawn, never a fault.
      const unknown = await api(host, cookie, '/hima/api/tool-view', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, action: 'open', site: 'no-such-site' }),
      });
      const unknownBody = await unknown.json() as ToolViewStatus;
      assert.equal(unknown.status, 200, JSON.stringify(unknownBody));
      assert.equal(unknownBody.state, 'unavailable', JSON.stringify(unknownBody));
    } finally {
      assert.equal(await host.stop(), 0, host.stderr());
    }
  } finally { page.close(); await h.dispose(); }
});
