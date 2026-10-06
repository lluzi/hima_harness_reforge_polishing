// #41 task 4: Site discovery gets a route and a tool, and the running Job's log tail becomes
// readable to any viewer of a Run's canvas, not only to the execution's owner. Real subprocess Host
// (for the routes) and a real in-process Host (for the hima_site tool), local files and tmux only.
// No SSH is ever spawned — a stand-in Channel answers every discovery probe from a fixed table
// (`HIMA_TEST_DISCOVERY_STANDIN`), and `test/README.md`'s sentinel fails this run if one is attempted.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { installPack, packsDirOf, writePackVariant } from './support/pack.ts';
import { writeLocalSite, type LocalSite } from './support/site.ts';
import { writeStandinFlow, type StandinFlow } from './support/standin-flow.ts';
import { discoverSshSite, loadSite, nodeLogTail, saveDiscoveredSite, SiteUnreadableError, type Channel } from '@hima/harness';
import type { JobDeps, SiteHeadView } from '@hima/harness';

process.env.HIMA_TEST_SILENT_AGENT = '1';

const discoveryRequirementsPackId = 'discovery-requirements-probe';

async function installDiscoveryRequirementsPack(h: HimaHome): Promise<void> {
  await installPack(h);
  await writePackVariant(packsDirOf(h), discoveryRequirementsPackId, [[
    'environment:\n  wrappers:\n    - make',
    'environment:\n  wrappers:\n    - make\n  commands:\n    - make',
  ]]);
}

interface Fixture { readonly h: HimaHome; readonly host: BootedHost; readonly cookie: string; readonly site: LocalSite; readonly flow: StandinFlow }

/** A local home with a stand-in flow, a local Site, and a booted web profile — everything cases 1,
 *  2 and 4 need. `pack` installs the shipped pack by default; case 4 installs `installLogTailPack`
 *  instead. `sleepSeconds` keeps the one real local Job running long enough for a concurrent poll to
 *  catch it mid-flight (case 4). */
async function bootedFixture(t: TestContext, opts: { sleepSeconds?: number; pack?: (h: HimaHome) => Promise<void> } = {}): Promise<Fixture | undefined> {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, { sleepSeconds: opts.sleepSeconds ?? 4 });
  if (!flow) { await h.dispose(); return undefined; }
  await (opts.pack ?? installPack)(h);
  const site = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root], allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  const host = await bootHimaHost(h);
  const cookie = await openSession(host);
  return { h, host, cookie, site, flow };
}

async function teardown(f: Pick<Fixture, 'h' | 'host'>): Promise<void> {
  assert.equal(await f.host.stop(), 0, f.host.stderr());
  await f.h.dispose();
}

test('Case 1: GET /hima/api/sites lists the installed local Site as ready', async (t) => {
  const f = await bootedFixture(t);
  if (!f) return;
  try {
    const res = await api(f.host, f.cookie, '/hima/api/sites');
    const body = await res.json() as { sites: SiteHeadView[] };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.sites.length, 1, JSON.stringify(body));
    const [local] = body.sites;
    assert.equal(local!.name, 'local');
    assert.equal(local!.kind, 'local');
    assert.equal(local!.readiness, 'ready');
    assert.equal(local!.capacity.cores, 8);
    assert.equal(local!.capacity.parallelJobs, 1);
    assert.equal(local!.observedAt, undefined, 'a local Site is never discovered');
  } finally { await teardown(f); }
});

test('Case 2: POST /hima/api/sites/discover saves a redacted lab-a Site and Permit through a stand-in Channel, and a bad sessionId is refused', async (t) => {
  const table = {
    'uname -s': { code: 0, stdout: 'Linux password=never-save-me' },
    'which tmux': { code: 0, stdout: '/usr/bin/tmux\n' },
  };
  const tableFile = path.join(os.tmpdir(), `hima-discovery-standin-${randomUUID()}.json`);
  await writeFile(tableFile, JSON.stringify(table));
  process.env.HIMA_TEST_DISCOVERY_STANDIN = tableFile;
  try {
    const f = await bootedFixture(t);
    if (!f) return;
    try {
      const sessionId = await createLiveSession(f.host, f.cookie, f.h.workspace);
      const res = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId, name: 'lab-a',
          ssh: { destination: 'engineer@lab.example.com' },
          hints: { workspaceRoot: '/work/hima', allowedReadRoots: ['/work'], allowedWriteRoots: ['/work/hima'] },
          save: true,
        }),
      });
      const body = await res.json() as { result: unknown; saved?: SiteHeadView };
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.ok(body.saved, JSON.stringify(body));
      assert.equal(body.saved!.name, 'lab-a');
      assert.equal(body.saved!.kind, 'ssh');
      assert.equal(body.saved!.readiness, 'ready');
      assert.ok(body.saved!.observedAt);

      const siteText = await readFile(path.join(f.site.sitesDir, 'lab-a.yml'), 'utf8');
      assert.doesNotMatch(siteText, /never-save-me/, 'a credential-shaped discovery value does not reach the saved file');
      assert.doesNotMatch(siteText, /discovery:/);
      const discoveryText = await readFile(path.join(f.site.sitesDir, 'lab-a.discovery.json'), 'utf8');
      assert.doesNotMatch(discoveryText, /never-save-me/);
      assert.match(discoveryText, /password=\[redacted\]/);
      const permitText = await readFile(path.join(f.site.sitesDir, 'lab-a.permit.yml'), 'utf8');
      assert.match(permitText, /allowedWriteRoots/);

      const bad = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: 'not-a-live-session', name: 'lab-b', ssh: { destination: 'engineer@lab-b.example.com' } }),
      });
      assert.equal(bad.status, 400, await bad.text());
    } finally { await teardown(f); }
  } finally {
    delete process.env.HIMA_TEST_DISCOVERY_STANDIN;
    await rm(tableFile, { force: true });
  }
});

test('Case 2b (bug 2 fix): POST /hima/api/sites/discover with no ssh rediscovers an already-saved ssh Site\'s own destination and permitted roots, previews before writing, and only a second save:true call persists it', async (t) => {
  const table = {
    'uname -s': { code: 0, stdout: 'Linux' },
    'which tmux': { code: 0, stdout: '/usr/bin/tmux\n' },
    'which make': { code: 0, stdout: '/usr/bin/make\n' },
  };
  const tableFile = path.join(os.tmpdir(), `hima-discovery-standin-${randomUUID()}.json`);
  await writeFile(tableFile, JSON.stringify(table));
  process.env.HIMA_TEST_DISCOVERY_STANDIN = tableFile;
  try {
    const f = await bootedFixture(t, { pack: installDiscoveryRequirementsPack });
    if (!f) return;
    try {
      const sessionId = await createLiveSession(f.host, f.cookie, f.h.workspace);
      // First save is exactly Case 2's own flow: a brand-new Site names its own destination.
      const first = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId, name: 'lab-a', ssh: { destination: 'engineer@lab.example.com' },
          hints: { workspaceRoot: '/work/hima', allowedReadRoots: ['/work'], allowedWriteRoots: ['/work/hima'] },
          save: true,
        }),
      });
      assert.equal(first.status, 200, await first.text());
      const richWrappers = ['make', ...Array.from({ length: 32 }, (_, index) => `/opt/eda/wrappers/tool-${index + 1}`)];
      const richReadRoots = Array.from({ length: 9 }, (_, index) => `/work/reference-${String(index + 1)}`);
      const savedSiteFile = path.join(f.site.sitesDir, 'lab-a.yml');
      await writeFile(savedSiteFile, (await readFile(savedSiteFile, 'utf8')).replace(
        'bindings: {}', 'bindings:\n  designRoot: /work/reference-1/design\n  workspaceRoot: /work/hima').replace(
        'licences: {}', 'licences:\n    Design-Compiler: 0'));
      await writeFile(path.join(f.site.sitesDir, 'lab-a.permit.yml'), [
        'allowedReadRoots:', ...richReadRoots.map((root) => `  - ${root}`),
        'allowedWriteRoots:', '  - /work/hima',
        'allowedWrappers:', ...richWrappers.map(wrapper => `  - ${wrapper}`),
        'forbidden:', '  - deletions', '',
      ].join('\n'));

      const permitFile = path.join(f.site.sitesDir, 'lab-a.permit.yml');
      const permitBefore = await readFile(permitFile, 'utf8');

      // A rediscover of that same saved Site (Configuration page's "Rediscover" button): the body
      // names only `name`, and the route must reuse the Site's own destination and permitted roots
      // exactly as `hima_site rediscover` already does for HimaGuide's tool call, and must answer a
      // preview — nothing written — while `save` is left false.
      const preview = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, name: 'lab-a', pack: discoveryRequirementsPackId }),
      });
      const previewBody = await preview.json() as { result: { site: { ssh?: { destination: string }; bindings: Record<string, string>; capacity: { licences: Record<string, number> } }; permit: { allowedReadRoots: string[]; allowedWriteRoots: string[] } }; saved?: unknown; reviewId?: string };
      assert.equal(preview.status, 200, JSON.stringify(previewBody));
      assert.equal(previewBody.result.site.ssh?.destination, 'engineer@lab.example.com', 'the saved Site\'s own destination is reused, never asked again');
      assert.equal(previewBody.saved, undefined, 'a preview (save left false) writes nothing');
      assert.ok(previewBody.reviewId, 'a browser preview receives a Host-held identity for these exact reviewed facts');
      assert.deepEqual(previewBody.result.permit.allowedReadRoots, richReadRoots,
        'rediscovery preserves a reviewed rich Permit instead of rejecting its saved roots');
      assert.deepEqual(previewBody.result.permit.allowedWriteRoots, ['/work/hima']);
      assert.deepEqual(previewBody.result.site.bindings,
        { designRoot: '/work/reference-1/design', workspaceRoot: '/work/hima' },
        'rediscovery retains the saved Site bindings instead of replacing them with an empty map');
      assert.deepEqual((previewBody.result.permit as { allowedWrappers?: string[] }).allowedWrappers, richWrappers, 'all 33 reviewed wrappers survive rediscovery and the duplicate Pack hint is deduplicated');
      assert.deepEqual(previewBody.result.site.capacity.licences, { 'Design-Compiler': 0 }, 'a Pack request cannot increase the administrator licence reservation during rediscovery');
      assert.ok((previewBody.result as { site: { discovery?: { facts: { probe: string[]; code: number }[] } } }).site.discovery?.facts.some((fact) => fact.code === 0 && fact.probe.join(' ') === 'which make'), 'the selected Pack command is actually probed');
      assert.equal(await readFile(permitFile, 'utf8'), permitBefore, 'preview cannot change the reviewed Permit');
      const beforeSaveMtime = (await stat(path.join(f.site.sitesDir, 'lab-a.yml'))).mtimeMs;

      // Make any second discovery fail. Save must persist the Host-held preview above, not rerun
      // probes and write facts the person never reviewed.
      await writeFile(tableFile, JSON.stringify({ connect: { fail: 'the Site changed after review' } }));
      const saved = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, name: 'lab-a', reviewId: previewBody.reviewId, save: true }),
      });
      const savedBody = await saved.json() as { saved?: SiteHeadView };
      assert.equal(saved.status, 200, JSON.stringify(savedBody));
      assert.ok(savedBody.saved, JSON.stringify(savedBody));
      assert.equal(savedBody.saved!.name, 'lab-a');
      assert.deepEqual(loadSite(f.site.sitesDir, 'lab-a').bindings,
        { designRoot: '/work/reference-1/design', workspaceRoot: '/work/hima' });
      assert.ok((await stat(path.join(f.site.sitesDir, 'lab-a.yml'))).mtimeMs >= beforeSaveMtime, 'the reviewed rediscovery actually replaced the saved Site file');

      assert.equal(await readFile(permitFile, 'utf8'), permitBefore, 'saving discovery facts preserves exact Permit bytes');

      const replay = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, name: 'lab-a', reviewId: previewBody.reviewId, save: true }),
      });
      assert.equal(replay.status, 400, 'a reviewed draft is consumed once and cannot be replayed');

      await writeFile(tableFile, JSON.stringify(table));
      const nextPreview = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, name: 'lab-a' }),
      });
      const nextBody = await nextPreview.json() as { reviewId: string };
      assert.equal(nextPreview.status, 200);
      const changedSite = `${await readFile(savedSiteFile, 'utf8')}# administrator changed the reviewed bytes\n`;
      await writeFile(savedSiteFile, changedSite);
      const staleSave = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, name: 'lab-a', reviewId: nextBody.reviewId, save: true }),
      });
      assert.equal(staleSave.status, 409, await staleSave.text());
      assert.equal(await readFile(savedSiteFile, 'utf8'), changedSite, 'a stale preview never overwrites a later administrator change');

      // A rediscover naming a Site this Host has never saved is still the caller's own mistake, not
      // an unexplained 500 — the same 400/"ssh" contract Case 7 already holds a brand-new Site to.
      const unknown = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, name: 'lab-never-saved' }),
      });
      const unknownBody = await unknown.json() as { error?: { code: string; message: string } };
      assert.equal(unknown.status, 400, JSON.stringify(unknownBody));
      assert.equal(unknownBody.error?.code, 'hima/bad-request', JSON.stringify(unknownBody));
      assert.match(unknownBody.error?.message ?? '', /ssh/);
    } finally { await teardown(f); }
  } finally {
    delete process.env.HIMA_TEST_DISCOVERY_STANDIN;
    await rm(tableFile, { force: true });
  }
});

test('Case 3: hima_site list lists every saved Site through the tool, without any SSH ever spawned', async () => {
  const h = await createHimaHome();
  try {
    await writeLocalSite(h);
    const sitesDir = path.join(h.home, 'hima/sites');
    await mkdir(sitesDir, { recursive: true });
    const fakeChannel: Channel = {
      siteName: 'lab-a',
      readFile: () => { throw new Error('not used by discovery'); },
      realpath: (p: string) => Promise.resolve(p),
      absent: () => Promise.resolve(true),
      exec: (argv: readonly string[]) => Promise.resolve({ code: argv[0] === 'which' ? 1 : 0, stdout: Buffer.from(argv.join(' ')), stderr: '' }),
    };
    const discovered = await discoverSshSite(
      { name: 'lab-a', ssh: { destination: 'engineer@lab.example.com', jumps: [] }, hints: {} },
      () => fakeChannel,
    );
    saveDiscoveredSite(sitesDir, discovered);

    const host = await bootInProcess(h);
    try {
      const result = await host.ctx.tools.execute({ callId: 'site-list' as never, name: 'hima_site', arguments: { action: 'list' }, signal: AbortSignal.timeout(20_000) }) as { content?: readonly { type: string; text?: string }[] };
      const text = result.content?.find((item) => item.type === 'text')?.text ?? '{}';
      const body = JSON.parse(text) as { sites: SiteHeadView[] };
      assert.deepEqual(body.sites.map((s) => s.name).sort(), ['lab-a', 'local']);
      assert.equal(body.sites.find((s) => s.name === 'lab-a')?.readiness, 'ready');
      assert.equal(body.sites.find((s) => s.name === 'local')?.readiness, 'ready');
    } finally { await host.dispose(); }
  } finally { await h.dispose(); }
});

// Final whole-branch review, H11: split into two named tests. The original Case 5 asserted two
// unrelated facts in one test body — a Job the Site cannot yet produce a log for never faults, and a
// revision that invalidates a node's running record removes it from what `nodeLogTail` sees as
// current — so a failure of either half left the other half's own name off the failing test.
test('Case 5a: a running node whose log the Site cannot produce yet answers 200 with the session and an empty tail, never a 500 (#41 task 4 review, blocking)', async () => {
  const h = await createHimaHome();
  try {
    const site = await writeLocalSite(h);
    const host = await bootInProcess(h);
    try {
      const deps: JobDeps = { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir };
      const run = await host.ctx.hima.ledger.createRun({ campaignId: 'log-tail-silent-job', siteId: 'local', status: 'running' });
      // A launch this ledger records but that never actually ran on the Site: the session's log
      // file was never created, so `tail` finds nothing there — the exact window the blocking review
      // item named (the ledger's own `running` append, before the wrapper ever redirects anything),
      // reproduced without needing to win a real race against a real Job.
      const session = `hima-${randomUUID()}-never-started`;
      await host.ctx.hima.ledger.appendJob(run.id, {
        event: 'launched',
        job: { session, workspace: h.workspace, name: 'synthesize', startedAt: new Date().toISOString(), wire: 'echo', pid: 1 },
        nodeId: 'synthesize',
      });
      await host.ctx.hima.ledger.appendNode(run.id, { nodeId: 'synthesize', kind: 'act', state: 'running', attempt: 1, jobSession: session });
      const found = await nodeLogTail(deps, { run: run.id, nodeId: 'synthesize', lines: 5 });
      assert.equal(found.session, session, JSON.stringify(found));
      assert.deepEqual(found.lines, []);
      assert.equal(found.truncated, false);
    } finally { await host.dispose(); }
  } finally { await h.dispose(); }
});

test('Case 5b: a revision that invalidates a node\'s running record removes it from what nodeLogTail sees as current (#41 task 4 review round 3, item 1)', async () => {
  const h = await createHimaHome();
  try {
    const site = await writeLocalSite(h);
    const host = await bootInProcess(h);
    try {
      const deps: JobDeps = { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir };
      const run = await host.ctx.hima.ledger.createRun({ campaignId: 'log-tail-revision', siteId: 'local', status: 'running' });
      const session = `hima-${randomUUID()}-never-started`;
      await host.ctx.hima.ledger.appendJob(run.id, {
        event: 'launched',
        job: { session, workspace: h.workspace, name: 'synthesize', startedAt: new Date().toISOString(), wire: 'echo', pid: 1 },
        nodeId: 'synthesize',
      });
      const nodeRecord = await host.ctx.hima.ledger.appendNode(run.id, { nodeId: 'synthesize', kind: 'act', state: 'running', attempt: 1, jobSession: session });
      // A revision that invalidates this node's own running record (#41 task 4 review round 3, item
      // 1) removes it from what `nodeLogTail` sees as this node's *current* latest fact: `currentRecordsIn`
      // must run over the Run's whole record set — including the `revision` record itself — before
      // narrowing to node records, or the invalidation is never seen at all.
      const sha = 'a'.repeat(64);
      await host.ctx.hima.ledger.appendRevision(run.id, {
        revisionId: 'rev-1', version: 1, event: 'applied',
        proposalDigest: sha, methodIdentity: sha, sourceIdentity: sha, inputIdentity: sha, environmentIdentity: sha,
        changedNodes: ['synthesize'], affectedNodes: ['synthesize'], invalidates: [nodeRecord.id],
      });
      const afterRevision = await nodeLogTail(deps, { run: run.id, nodeId: 'synthesize', lines: 5 });
      assert.equal(afterRevision.session, undefined, JSON.stringify(afterRevision));
      assert.deepEqual(afterRevision.lines, []);
    } finally { await host.dispose(); }
  } finally { await h.dispose(); }
});

test('Case 6: POST /hima/api/sites/discover answers 503 hima/site-unreadable when the Site cannot be reached, and writes no file', async (t) => {
  const table = { connect: { fail: 'ssh: connect to host lab.example.com port 22: Connection refused' } };
  const tableFile = path.join(os.tmpdir(), `hima-discovery-standin-${randomUUID()}.json`);
  await writeFile(tableFile, JSON.stringify(table));
  process.env.HIMA_TEST_DISCOVERY_STANDIN = tableFile;
  try {
    const f = await bootedFixture(t);
    if (!f) return;
    try {
      const sessionId = await createLiveSession(f.host, f.cookie, f.h.workspace);
      const res = await api(f.host, f.cookie, '/hima/api/sites/discover', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, name: 'lab-unreachable', ssh: { destination: 'engineer@lab.example.com' }, save: true }),
      });
      const body = await res.json() as { error?: { code: string; message: string } };
      assert.equal(res.status, 503, JSON.stringify(body));
      assert.equal(body.error?.code, 'hima/site-unreadable', JSON.stringify(body));
      assert.match(body.error?.message ?? '', /Connection refused/);
      await assert.rejects(readFile(path.join(f.site.sitesDir, 'lab-unreachable.yml'), 'utf8'), /ENOENT/, 'a Site that could not be reached is never saved');
    } finally { await teardown(f); }
  } finally {
    delete process.env.HIMA_TEST_DISCOVERY_STANDIN;
    await rm(tableFile, { force: true });
  }
});

test("Case 7: POST /hima/api/sites/discover with no ssh answers 400 naming \"ssh\", not a 500 (#41 task 4 review round 3, minor 2)", async (t) => {
  const f = await bootedFixture(t);
  if (!f) return;
  try {
    const sessionId = await createLiveSession(f.host, f.cookie, f.h.workspace);
    const res = await api(f.host, f.cookie, '/hima/api/sites/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, name: 'x' }),
    });
    const body = await res.json() as { error?: { code: string; message: string } };
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(body.error?.code, 'hima/bad-request', JSON.stringify(body));
    assert.match(body.error?.message ?? '', /ssh/);
  } finally { await teardown(f); }
});

test('Case 8: a Site that cannot be asked for its log still reaches nodeLogTail as SiteUnreadableError, not a swallowed empty answer (#41 task 4 review round 3, minor 4)', async () => {
  const h = await createHimaHome();
  const savedPath = process.env.PATH;
  try {
    const site = await writeLocalSite(h);
    const host = await bootInProcess(h);
    try {
      const deps: JobDeps = { ledger: host.ctx.hima.ledger, sitesDir: site.sitesDir };
      const run = await host.ctx.hima.ledger.createRun({ campaignId: 'log-tail-unreadable', siteId: 'local', status: 'running' });
      const session = `hima-${randomUUID()}-unreadable`;
      await host.ctx.hima.ledger.appendJob(run.id, {
        event: 'launched',
        job: { session, workspace: h.workspace, name: 'synthesize', startedAt: new Date().toISOString(), wire: 'echo', pid: 1 },
        nodeId: 'synthesize',
      });
      await host.ctx.hima.ledger.appendNode(run.id, { nodeId: 'synthesize', kind: 'act', state: 'running', attempt: 1, jobSession: session });
      // No cheap `deps.channel` injection point exists on `JobDeps`/`jobTail` today (#41 task 4
      // review round 3, minor 4) — `nodeLogTail` reaches a real `LocalChannel` through
      // `loadSite`/`channelFor`, both hardcoded. The cheapest real fault this domain-level call can
      // hit is the one `jobs-unreadable.test.ts` already uses for the same channel and the same
      // reason: a PATH with no `tail` on it makes the spawn itself fail (ENOENT), which
      // `LocalChannel.exec` turns into `SiteUnreadableError` — not a shell exiting non-zero (a plain
      // `Error`, already covered by Case 5), but the channel failing to run anything at all.
      const emptyBin = await mkdtemp(path.join(os.tmpdir(), 'hima-no-tail-'));
      process.env.PATH = emptyBin;
      try {
        await assert.rejects(
          nodeLogTail(deps, { run: run.id, nodeId: 'synthesize', lines: 5 }),
          (err: unknown) => err instanceof SiteUnreadableError,
        );
      } finally {
        // H11: `process.env.PATH = savedPath` with `savedPath` typed `string | undefined` coerces to
        // the literal string `"undefined"` when `savedPath` actually is `undefined` — Node's
        // `process.env` setter stringifies its value rather than deleting the key — which would leave
        // every test that runs after this one in the same process with a `PATH` of `"undefined"`
        // instead of the one the shell handed this process. `savedPath` is never actually undefined
        // on any real invocation, but the fallback is what makes that true by contract rather than by
        // accident.
        process.env.PATH = savedPath ?? '';
        await rm(emptyBin, { recursive: true, force: true });
      }
    } finally { await host.dispose(); }
  } finally { await h.dispose(); }
});
