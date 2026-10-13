// Live tool view plan task 1: a Site may declare `toolView` (today: an xpra HTML5 display). This
// slice is the declaration alone — schema, strict-save key lists, the `Site`/`SiteHeadView` types —
// never a Host process or a route. No SSH is spawned by anything here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { createServer } from 'node:net';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { controlPathFor, createToolView, loadSite, siteSaveIdentity, toolViewUrl } from '@hima/harness';
import type { Site, SiteHeadView, ToolViewStatus } from '@hima/harness';

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

/** Write a minimal ssh Site declaring a toolView, so the forward path can be exercised without any
 *  real connection (the injected spawn stands in for ssh). */
async function writeSshSiteFile(sitesDir: string, name: string, destination: string, extra: readonly string[] = []): Promise<void> {
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
    'kind: ssh',
    'workspaceRoot: /work',
    `permit: ./${name}.permit.yml`,
    'ssh:',
    `  destination: ${destination}`,
    '  jumps: []',
    '  controlPersistSeconds: 60',
    'capacity:',
    '  cores: 8',
    '  memoryGiB: 16',
    '  parallelJobs: 1',
    '  licences: {}',
    ...extra,
    '',
  ].join('\n'));
}

/** A free loopback port nobody is holding right now (the same race a local xpra would win a moment
 *  later); used to point a local Site's toolView at a listener this test controls. */
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

/** A stand-in ssh child: it never runs ssh, it reads the `-L` forward it was asked for and either
 *  answers on that local port (a healthy forward) or prints to stderr and exits (a refused one). The
 *  local tests inject this in place of `child_process.spawn`, which the no-ssh guard forbids. */
class FakeSshChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killSignal: NodeJS.Signals | number | undefined;
  private server?: http.Server;
  constructor(serve: { local: number } | undefined, fail: { code: number; stderr: string } | undefined) {
    super();
    if (fail) {
      setImmediate(() => { this.stderr.emit('data', Buffer.from(`${fail.stderr}\n`)); this.exitCode = fail.code; this.emit('exit', fail.code, null); });
    } else if (serve) {
      this.server = http.createServer((_req, res) => { res.statusCode = 200; res.end('xpra'); });
      this.server.listen(serve.local, '127.0.0.1');
    }
  }
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killSignal = signal ?? 'SIGTERM';
    if (this.exitCode === null && this.signalCode === null) {
      this.signalCode = (typeof signal === 'string' ? signal : 'SIGTERM');
      const server = this.server;
      setImmediate(() => { server?.close(); this.emit('exit', null, this.signalCode); });
    }
    return true;
  }
}

interface FakeSpawn {
  readonly spawn: (command: string, args: readonly string[]) => FakeSshChild;
  readonly calls: { command: string; args: readonly string[] }[];
  readonly children: FakeSshChild[];
}

/** `fail` makes every spawned child exit with that code and stderr; otherwise the child answers on
 *  the `-L` local port it was given, so the forward reads as ready. */
function fakeSpawn(fail?: { code: number; stderr: string }): FakeSpawn {
  const calls: { command: string; args: readonly string[] }[] = [];
  const children: FakeSshChild[] = [];
  const spawn = (command: string, args: readonly string[]): FakeSshChild => {
    calls.push({ command, args: [...args] });
    const forward = args.find((_a, i) => args[i - 1] === '-L');
    const local = forward ? Number(forward.split(':')[1]) : undefined;
    const child = new FakeSshChild(fail ? undefined : local === undefined ? undefined : { local }, fail);
    children.push(child);
    return child;
  };
  return { spawn, calls, children };
}

const ready = (status: ToolViewStatus): Extract<ToolViewStatus, { state: 'ready' }> => {
  assert.equal(status.state, 'ready', JSON.stringify(status));
  return status as Extract<ToolViewStatus, { state: 'ready' }>;
};

test('toolViewUrl publishes the xpra HTML5 client on localhost with the fixed query', () => {
  assert.equal(
    toolViewUrl('xpra-html5', 14501),
    'http://localhost:14501/?keyboard=true&floating_menu=false&autohide=true&sound=false&clipboard=false&printing=false&file_transfer=false&sharing=true&steal=false&reconnect=true&remote_logging=false&keyboard_layout=us',
  );
});

test('a local Site is ready once its declared port answers, with no ssh', async () => {
  const h = await createHimaHome();
  const server = http.createServer((_req, res) => { res.statusCode = 200; res.end('ok'); });
  try {
    const port = await freeLoopbackPort();
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'local-tool', h.workspace, ['toolView:', '  kind: xpra-html5', `  port: ${port}`, '  label: MAGE']);
    const spawn = fakeSpawn();
    const view = createToolView({ sitesDir, home: h.home, spawn: spawn.spawn as never, readyTimeoutMs: 5000 });
    const opened = ready(await view.open('local-tool'));
    assert.equal(opened.local, true);
    assert.equal(opened.url, toolViewUrl('xpra-html5', port));
    assert.equal(opened.label, 'MAGE');
    assert.equal(ready(await view.status('local-tool')).url, opened.url);
    assert.equal(spawn.calls.length, 0, 'a local Site needs no process');
    await view.stop();
  } finally { server.close(); await h.dispose(); }
});

test('a local Site with nothing listening fails after the ready timeout, naming the port', async () => {
  const h = await createHimaHome();
  try {
    const port = await freeLoopbackPort();
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'dead-tool', h.workspace, ['toolView:', '  kind: xpra-html5', `  port: ${port}`]);
    const view = createToolView({ sitesDir, home: h.home, spawn: fakeSpawn().spawn as never, readyTimeoutMs: 500 });
    const status = await view.open('dead-tool');
    assert.equal(status.state, 'failed', JSON.stringify(status));
    assert.match((status as Extract<ToolViewStatus, { state: 'failed' }>).reason, new RegExp(String(port)));
    await view.stop();
  } finally { await h.dispose(); }
});

test('an ssh Site opens one long-lived forward with the Site\'s ControlMaster options, and stop kills it', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSshSiteFile(sitesDir, 'ssh-tool', 'tester@tool-host.invalid', ['toolView:', '  kind: xpra-html5', '  port: 14500', '  label: MAGE']);
    const site: Site = loadSite(sitesDir, 'ssh-tool');
    const spawn = fakeSpawn();
    const view = createToolView({ sitesDir, home: h.home, spawn: spawn.spawn as never, readyTimeoutMs: 5000 });
    const opened = ready(await view.open('ssh-tool'));
    assert.equal(opened.local, false);
    assert.equal(spawn.calls.length, 1, JSON.stringify(spawn.calls));
    const { command, args } = spawn.calls[0]!;
    assert.equal(command, 'ssh');
    assert.ok(args.includes('-N'), args.join(' '));
    assert.ok(args.includes('ExitOnForwardFailure=yes'), args.join(' '));
    assert.ok(args.includes(`ControlPath=${controlPathFor(site)}`), args.join(' '));
    assert.ok(args.includes('tester@tool-host.invalid'), args.join(' '));
    const forward = args[args.indexOf('-L') + 1]!;
    assert.match(forward, /^127\.0\.0\.1:\d+:127\.0\.0\.1:14500$/, forward);
    const local = Number(forward.split(':')[1]);
    assert.equal(opened.url, toolViewUrl('xpra-html5', local));

    await view.stop('ssh-tool');
    assert.equal(spawn.children[0]!.killSignal, 'SIGTERM', 'stop signals the forward');
    assert.equal((await view.status('ssh-tool')).state, 'stopped');
  } finally { await h.dispose(); }
});

test('an ssh forward that exits reports failed with the child\'s own stderr', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSshSiteFile(sitesDir, 'denied-tool', 'tester@tool-host.invalid', ['toolView:', '  kind: xpra-html5', '  port: 14500']);
    const spawn = fakeSpawn({ code: 255, stderr: 'Permission denied' });
    const view = createToolView({ sitesDir, home: h.home, spawn: spawn.spawn as never, readyTimeoutMs: 5000 });
    const status = await view.open('denied-tool');
    assert.equal(status.state, 'failed', JSON.stringify(status));
    const failed = status as Extract<ToolViewStatus, { state: 'failed' }>;
    assert.match(failed.reason, /Permission denied|exited/);
    assert.match(failed.log, /Permission denied/);
    await view.stop();
  } finally { await h.dispose(); }
});

test('an unknown Site and a Site without toolView are unavailable, and nothing is spawned', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'plain', h.workspace);
    const spawn = fakeSpawn();
    const view = createToolView({ sitesDir, home: h.home, spawn: spawn.spawn as never });
    assert.equal((await view.status('plain')).state, 'unavailable');
    assert.equal((await view.open('plain')).state, 'unavailable');
    assert.equal((await view.status('no-such-site')).state, 'unavailable');
    assert.equal((await view.open('no-such-site')).state, 'unavailable');
    assert.equal(spawn.calls.length, 0, 'unavailable never spawns');
  } finally { await h.dispose(); }
});

test('the forward\'s local port is remembered, so the frame origin stays stable across Host restarts', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSshSiteFile(sitesDir, 'ssh-tool', 'tester@tool-host.invalid', ['toolView:', '  kind: xpra-html5', '  port: 14500']);
    const first = createToolView({ sitesDir, home: h.home, spawn: fakeSpawn().spawn as never, readyTimeoutMs: 5000 });
    const firstUrl = ready(await first.open('ssh-tool')).url;
    await first.stop();
    const second = createToolView({ sitesDir, home: h.home, spawn: fakeSpawn().spawn as never, readyTimeoutMs: 5000 });
    const secondUrl = ready(await second.open('ssh-tool')).url;
    assert.equal(secondUrl, firstUrl, 'the same local port is preferred');
    await second.stop();
  } finally { await h.dispose(); }
});

test('the committed linglong-mage Site declares the MAGE tool view on port 14500', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await mkdir(sitesDir, { recursive: true });
    await writeFile(path.join(sitesDir, 'linglong-mage.yml'), await readFile(path.join(repoRoot, 'sites/linglong-mage/site.yml')));
    await writeFile(path.join(sitesDir, 'permit.yml'), await readFile(path.join(repoRoot, 'sites/linglong-mage/permit.yml')));
    const site = loadSite(sitesDir, 'linglong-mage');
    assert.deepEqual(site.toolView, { kind: 'xpra-html5', port: 14500, label: 'MAGE' });
  } finally { await h.dispose(); }
});

test('the strict save path keeps a Site that declares a labelled toolView', async () => {
  const h = await createHimaHome();
  try {
    const sitesDir = path.join(h.home, 'hima/sites');
    await writeSiteFile(sitesDir, 'keep-tool', h.workspace, ['toolView:', '  kind: xpra-html5', '  port: 14500', '  label: MAGE']);
    const identity = siteSaveIdentity(sitesDir, 'keep-tool');
    assert.equal(identity.kind, 'existing');
    // The round-trip proves 'label' survives the strict key list: drop it and this Site is refused.
    assert.deepEqual(loadSite(sitesDir, 'keep-tool').toolView, { kind: 'xpra-html5', port: 14500, label: 'MAGE' });
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
