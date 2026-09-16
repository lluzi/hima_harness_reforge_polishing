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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { killSessions } from './support/fabric.ts';
import { installPack, packsDirOf, writePackVariant } from './support/pack.ts';
import { writeLocalSite, type LocalSite } from './support/site.ts';
import { writeStandinFlow, type StandinFlow } from './support/standin-flow.ts';
import { discoverSshSite, nodeLogTail, saveDiscoveredSite, type Channel } from '@hima/harness';
import type { JobDeps, LogTailView, RunView, SiteHeadView } from '@hima/harness';

process.env.HIMA_TEST_SILENT_AGENT = '1';

/**
 * A pack variant of the shipped timing probe whose `synth` tool carries make's own `-w` flag beside
 * its ordinary arguments (#41 task 4): `-w` makes make print "Entering directory" to its own stdout
 * the instant it starts, before the stand-in's sleep — the shipped tool's Makefile writes its own
 * diagnostics into a file under the flow, never to the Job's own captured output, so a case 4
 * verifying the *content* of a live tail needs a Job that writes something of its own. `-w` changes
 * nothing about what `synth` does; it only asks make to say where it is doing it.
 */
const logTailPackId = 'log-tail-probe';
async function installLogTailPack(h: HimaHome): Promise<void> {
  await installPack(h);
  await writePackVariant(packsDirOf(h), logTailPackId, [['EDA_CONTAINER_NAME=hima-${CAMPAIGN}', 'EDA_CONTAINER_NAME=hima-${CAMPAIGN}\n      - -w']]);
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
      assert.match(siteText, /password=\[redacted\]/);
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

test('Case 4: GET /hima/api/runs/<id>/log-tail reads the currently running node without owning an execution, and answers empty for a node with no Job open', async (t) => {
  const f = await bootedFixture(t, { sleepSeconds: 5, pack: installLogTailPack });
  if (!f) return;
  const sessions = new Set<string>();
  try {
    const startPromise = api(f.host, f.cookie, '/hima/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pack: logTailPackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
    });
    // Attached immediately so an early assertion failure below (which abandons awaiting this
    // request) never surfaces as a separate unhandled rejection once teardown stops the host out
    // from under it; the real result is still read through `await startPromise` further down.
    startPromise.catch(() => undefined);
    // The ledger creates the Run row before the auto-drive's first Job finishes; find its id while
    // that first generation is still under way.
    let runId: string | undefined;
    {
      const deadline = Date.now() + 20_000;
      while (runId === undefined) {
        const list = await (await api(f.host, f.cookie, '/hima/api/runs')).json() as { runs: { id: string }[] };
        if (list.runs.length > 0) runId = list.runs[0]!.id;
        else if (Date.now() > deadline) throw new Error('the run never appeared in the ledger');
        else await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    // Poll the one node that ever launches a Job until its record says running with a session and
    // the Job has actually written something to its log: a session appears the instant tmux starts
    // it, before `make` has produced a single line.
    let tail: LogTailView | undefined;
    {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const res = await api(f.host, f.cookie, `/hima/api/runs/${runId}/log-tail?node=synthesize&lines=1`);
        const body = await res.json() as LogTailView;
        assert.equal(res.status, 200, JSON.stringify(body));
        if (body.session !== undefined && body.lines.length > 0) { tail = body; break; }
        if (Date.now() > deadline) throw new Error(`the synthesize node never reported a running Job with log content: ${JSON.stringify(body)}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.equal(tail!.nodeId, 'synthesize');
    assert.equal(tail!.lines.length, 1, JSON.stringify(tail));
    assert.ok(tail!.session);

    // A node that never launches a Job (judge only evaluates rules) has none open, before or after.
    const noJob = await (await api(f.host, f.cookie, `/hima/api/runs/${runId}/log-tail?node=judge`)).json() as LogTailView;
    assert.deepEqual(noJob.lines, []);
    assert.equal(noJob.session, undefined);
    assert.equal(noJob.truncated, false);

    // Let the auto-drive finish and confirm the read-tail session was the very Job it launched.
    const finalRes = await startPromise;
    const finalView = await finalRes.json() as RunView;
    assert.equal(finalRes.status, 200, JSON.stringify(finalView));
    for (const job of finalView.jobs) if (job.event === 'launched') sessions.add(job.job.session);
    assert.ok(sessions.has(tail!.session!), `the log-tail session ${tail!.session} is one of this run's own launched Jobs: ${[...sessions].join(', ')}`);

    // A missing run answers 404; an out-of-range lines value is a caller mistake, not a fault.
    const missing = await api(f.host, f.cookie, '/hima/api/runs/run-does-not-exist/log-tail?node=synthesize');
    assert.equal(missing.status, 404);
    const tooMany = await api(f.host, f.cookie, `/hima/api/runs/${runId}/log-tail?node=synthesize&lines=101`);
    assert.equal(tooMany.status, 400);
  } finally {
    killSessions([...sessions]);
    await teardown(f);
  }
});

test('Case 5: a running node whose log the Site cannot produce yet answers 200 with the session and an empty tail, never a 500 (#41 task 4 review, blocking)', async () => {
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
