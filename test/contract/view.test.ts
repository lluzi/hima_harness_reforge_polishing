// Ticket #7: the result view in the workbench. One Hima-owned remote interface under `/hima/api/`
// on the host web server, and the Hima browser module the web profile discovers and serves.
// Asserted on the REAL web profile booted as a subprocess: HTTP answers and served bundles only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHimaHome, harnessPackageDir, type HimaHome } from './support/dsh-home.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, openSession, postObserve } from './support/hima-api.ts';
import { writeLocalSite, writeSampleReport, writeSiteWithDirPermit } from './support/site.ts';
import { requireOpene902Fixture } from './support/opene902-fixtures.ts';
// The view shapes are the bundle's own contract, not this file's opinion of it: retyping them here
// would let the host's answer drift from what the browser module reads without a test noticing.
import type { HimaErrorBody, RecordView, RecordsView, RunView } from '@hima/harness';

/** One answer, read once: the status is asserted against the body the response actually carried. */
async function answer<T>(res: Response, expected: number): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, expected, text);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/, 'every Hima answer is JSON');
  return JSON.parse(text) as T;
}

interface Workbench { readonly h: HimaHome; readonly host: BootedHost; readonly cookie: string; dispose(): Promise<void> }

/** The real web profile, booted with the local site installed and a session already open. */
async function bootedWorkbench(extraReadRoots: readonly string[] = []): Promise<Workbench> {
  const h = await createHimaHome();
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, ...extraReadRoots] });
  const host = await bootHimaHost(h);
  const cookie = await openSession(host);
  return {
    h, host, cookie,
    dispose: async () => {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
      await h.dispose();
    },
  };
}

test('the Hima namespace answers a run round-trip over HTTP: observe, judge, and every citation resolved to the observation it was read from', async (t) => {
  const fixture = await requireOpene902Fixture(t, 'postroute.summary.gz');
  if (fixture === undefined) return;
  const wb = await bootedWorkbench([path.dirname(fixture)]);
  try {
    const created = await postObserve(wb.host, wb.cookie, {
      site: 'local',
      path: fixture,
      reader: 'innovus-timing-summary',
      judge: ['setup-wns-all-nonnegative', 'setup-wns-reg2reg-nonnegative'],
    });
    const view = await answer<RunView>(created, 200);
    assert.match(view.run.id, /^run-[0-9a-f-]+$/, 'the operation created a run');
    assert.equal(view.run.siteId, 'local');

    // The same run, read back through the read operation, is the same view.
    const fetched = await api(wb.host, wb.cookie, `/hima/api/runs/${view.run.id}`);
    assert.deepEqual(await answer<RunView>(fetched, 200), view, 'the run reads back exactly as the observe operation reported it');

    assert.equal(view.observations.length, 1, 'one observation to cite');
    const observation = view.observations[0]!;
    assert.equal(observation.path, fixture, 'the observation carries the declared path');
    assert.match(observation.contentSha256, /^[0-9a-f]{64}$/, 'and its content hash');
    assert.deepEqual(
      observation.reader,
      { id: 'innovus-timing-summary', version: '1', reportKind: 'innovus-optdesign-summary', emits: ['setup_wns', 'setup_tns', 'hold_wns', 'hold_tns', 'placement_density', 'clock_period'] },
      'and the reader that read it, with the report kind it accepts and the semantics it emits',
    );
    assert.ok(!Number.isNaN(Date.parse(observation.at)), 'and the time it was appended');
    assert.deepEqual(view.refusals, [], 'nothing was refused');

    assert.equal(view.verdicts.length, 2, 'one verdict per rule asked for');
    const all = view.verdicts.find((v) => v.ruleId === 'setup-wns-all-nonnegative');
    assert.ok(all, 'the all-paths rule was judged');
    assert.equal(all.outcome, 'FAIL', 'setup WNS over all paths is -0.073 ns');
    assert.equal(all.ruleVersion, '1', 'the verdict names the rule version it applied');
    assert.deepEqual(all.valuesAsRead, [{ type: 'setup_wns', value: -0.073, unit: 'ns', mode: 'setup', scope: 'all' }]);
    assert.deepEqual(
      all.cites,
      [{ recordId: observation.recordId, observation }],
      'the citation is resolved to the whole observation: declared path, content hash, reader, and time',
    );
    const r2r = view.verdicts.find((v) => v.ruleId === 'setup-wns-reg2reg-nonnegative');
    assert.ok(r2r);
    assert.equal(r2r.outcome, 'PASS', 'setup WNS reg2reg is 0.002 ns');
    assert.deepEqual(r2r.cites.map((c) => c.recordId), [observation.recordId]);

    // Records by run: the ledger's own records, in sequence, optionally of one type.
    const every = await answer<RecordsView>(await api(wb.host, wb.cookie, `/hima/api/runs/${view.run.id}/records`), 200);
    assert.deepEqual(every.records.map((r) => r.type), ['observation', 'verdict', 'verdict'], 'in ledger sequence order');
    const filtered = await answer<RecordsView>(await api(wb.host, wb.cookie, `/hima/api/runs/${view.run.id}/records?type=verdict`), 200);
    assert.deepEqual(filtered.records.map((r) => r.type), ['verdict', 'verdict']);

    // Records by ID: the third ledger read #3 asks for, through the host like the other two. The
    // record ids the ledger mints carry a `#`, so the route has to survive percent-encoding.
    for (const wanted of every.records) {
      const one = await answer<RecordView>(await api(wb.host, wb.cookie, `/hima/api/records/${encodeURIComponent(wanted.id)}`), 200);
      assert.deepEqual(one.record, wanted, `record ${wanted.id} reads back by id exactly as the run listing holds it`);
    }
  } finally { await wb.dispose(); }
});

test('a refused read is reported as a refusal in the run view, never as an empty pass', async () => {
  const wb = await bootedWorkbench();
  try {
    const view = await answer<RunView>(await postObserve(wb.host, wb.cookie, { site: 'local', path: '/etc/hosts' }), 200);
    assert.deepEqual(view.observations, [], 'nothing was observed');
    assert.deepEqual(view.verdicts, [], 'and nothing was judged');
    assert.equal(view.refusals.length, 1, 'the refusal is what the run holds');
    assert.match(view.refusals[0]!.reason, /outside the permitted read roots/);
  } finally { await wb.dispose(); }
});

test('a remote error reaches the caller as a coded JSON error, never as an empty answer', async () => {
  const wb = await bootedWorkbench();
  try {
    const sample = await writeSampleReport(wb.h);

    const notFound = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/runs/run-does-not-exist'), 404);
    assert.equal(notFound.error.code, 'hima/run-not-found');
    assert.match(notFound.error.message, /run-does-not-exist/, 'the message names the run that was asked for');

    const badlyEncoded = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/runs/%zz'), 400);
    assert.equal(badlyEncoded.error.code, 'hima/bad-request', 'a run id that is not validly percent-encoded is a bad request, never an uncaught URIError');

    const badType = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/runs/run-does-not-exist/records?type=nonsense'), 400);
    assert.equal(badType.error.code, 'hima/bad-request', 'a malformed query is malformed whatever it names');

    const noSite = await answer<HimaErrorBody>(await postObserve(wb.host, wb.cookie, { path: sample.rel }), 400);
    assert.equal(noSite.error.code, 'hima/bad-request');

    const unknownSite = await answer<HimaErrorBody>(await postObserve(wb.host, wb.cookie, { site: 'no-such-site', path: sample.rel }), 400);
    assert.equal(unknownSite.error.code, 'hima/bad-request', 'a site name with no site file is the caller\'s mistake');
    assert.match(unknownSite.error.message, /no-such-site/, 'the message names the site that was asked for');

    const unknownRule = await answer<HimaErrorBody>(await postObserve(wb.host, wb.cookie, { site: 'local', path: sample.rel, judge: ['no-such-rule'] }), 400);
    assert.equal(unknownRule.error.code, 'hima/bad-request', 'an unknown rule is an error, never a silent pass');
    assert.match(unknownRule.error.message, /no-such-rule/);

    const noRecord = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/records/no-such-record'), 404);
    assert.equal(noRecord.error.code, 'hima/record-not-found', 'a record id the ledger does not hold has its own code');
    assert.match(noRecord.error.message, /no-such-record/, 'the message names the record that was asked for');

    const nowhere = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/nowhere'), 404);
    assert.equal(nowhere.error.code, 'hima/bad-request');

    const wrongMethod = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/observe'), 405);
    assert.equal(wrongMethod.error.code, 'hima/bad-request');
  } finally { await wb.dispose(); }
});

test('a fault that is not the caller\'s doing — a misconfigured site the caller could not have known about — reaches them as 500 hima/internal, never relabelled as their mistake', async () => {
  const wb = await bootedWorkbench();
  try {
    const sample = await writeSampleReport(wb.h);
    // The site exists (so this is not "unknown site"), but its declared permit path is a directory:
    // `loadSite` throws a plain `EISDIR` Error reading it, well past the caller-fault case this
    // namespace recognises explicitly. That fault is ours, not something naming a different site or
    // fixing the request body could have avoided.
    const site = await writeSiteWithDirPermit(wb.h);

    const res = await postObserve(wb.host, wb.cookie, { site: site.name, path: sample.rel });
    const body = await answer<HimaErrorBody>(res, 500);
    assert.equal(body.error.code, 'hima/internal', 'a fault in the site config the caller did not write is ours, not a bad request');
    // The code is the contract; the raw error text is not. Node's EISDIR message carries the absolute
    // path of the permit inside the isolated home, and a 500 body reaches whoever made the request.
    assert.ok(!body.error.message.includes(wb.h.home), `the 500 body leaks a host path: ${body.error.message}`);
    assert.doesNotMatch(body.error.message, /EISDIR/, 'nor the raw errno text it came from');
    assert.match(body.error.message, /\/hima\/api\/observe/, 'it still names the route that failed');
  } finally { await wb.dispose(); }
});

test("every /hima/api route sits behind the web app's own session cookie", async () => {
  const wb = await bootedWorkbench();
  try {
    for (const target of ['/hima/api/runs/run-x', '/hima/api/runs/run-x/records', '/hima/api/records/record-x', '/hima/api/observe']) {
      const res = await fetch(new URL(target, wb.host.url));
      const refused = await answer<HimaErrorBody>(res, 401);
      assert.equal(refused.error.code, 'hima/not-authorized', `${target} is refused without the session cookie`);
    }
    // The cookie is what opens them: the same read reaches the handler and gets its coded answer.
    const withCookie = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/runs/run-x'), 404);
    assert.equal(withCookie.error.code, 'hima/run-not-found');
  } finally { await wb.dispose(); }
});

test('the Hima browser module is in the served boot graph and its bundle is served as a client-module envelope', async () => {
  const wb = await bootedWorkbench();
  try {
    const index = await api(wb.host, wb.cookie, '/');
    assert.equal(index.status, 200, 'the web app serves its index with the session cookie');
    const html = await index.text();
    const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(html);
    assert.ok(boot, 'the index carries the client-module boot graph');
    const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
    const hima = graph.entries.find((e) => e.id === '@hima/harness');
    assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);

    const bundle = await api(wb.host, wb.cookie, hima.url);
    assert.equal(bundle.status, 200, 'and the host serves its bundle');
    assert.match(bundle.headers.get('content-type') ?? '', /javascript/);
    const source = await bundle.text();
    assert.match(source, /window\.__ModuleLoader__\.load\(\{/, 'served as the client-module registration envelope');
    assert.match(source, /require\("react/, 'React comes from the shell module table, never bundled');

    // Run the served bundle the way the shell runs it: the envelope registers one factory, the
    // factory is materialized with a require bound to the baseline modules, and the module's own
    // `apply` contributes into a recording slot registry. No browser and no DOM are involved.
    const loaded: { id: string; factory: (req: (spec: string) => unknown) => Record<string, unknown> }[] = [];
    new Function('window', source)({ __ModuleLoader__: { load: (r: unknown) => loaded.push(r as never) } });
    assert.equal(loaded.length, 1, 'executing the bundle registers exactly one factory');
    assert.equal(loaded[0]!.id, '@hima/harness', 'registered under the Hima package id');

    const baseline = createRequire(path.join(harnessPackageDir, 'package.json'));
    const moduleExports = loaded[0]!.factory((spec) => baseline(spec)) as {
      name: string;
      inject: string[];
      apply(ctx: {
        effect(callback: () => (() => void)): unknown;
        sidebarRight: { openTab(kind: string): void };
        sidebarRightTabs: { register(definition: unknown): () => void };
        layout: { toggleSidebar(): void };
        slots: { inject(name: string, callback: () => unknown): unknown; register(declaration: { name: string; key?: string; id?: string }, component: unknown): unknown };
      }): void;
    };
    assert.deepEqual(moduleExports.inject, ['slots', 'sidebarRight', 'sidebarRightTabs', 'layout', 'sessions', 'conversation'], 'the module declares its existing native UI services');
    const registered: { name: string; key?: string; id?: string }[] = [];
    let component: unknown;
    moduleExports.apply({
      effect: (callback) => callback(),
      sidebarRight: { openTab: () => undefined },
      sidebarRightTabs: { register: () => () => undefined },
      layout: { toggleSidebar: () => undefined },
      slots: {
        inject: (name, cb) => { assert.ok(['tool.call.toolview', 'sidebar.footer.action', 'sidebar.right.pane.tab', 'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'].includes(name), 'only existing native presentation slots are extended'); return cb(); },
        register: (declaration, c) => { registered.push({ name: declaration.name, ...('key' in declaration ? { key: declaration.key } : {}), ...('id' in declaration ? { id: declaration.id } : {}) }); component = c; return () => undefined; },
      },
    });
    // Both keys, because both Hima tools answer with a Run and one card renders a Run (#16); which
    // keys and no others is asserted in `view-run.test.ts`, where the card's own contract lives.
    assert.deepEqual(
      registered,
      [{ name: 'sidebar.right.pane.tab', key: '@hima/harness/workbench' }, { name: 'sidebar.footer.action', id: 'hima-workbench' }, { name: 'sidebar.brand.mark' }, { name: 'conversation.hero.brand.mark' }, { name: 'sidebar.brand.name' }, { name: 'tool.call.toolview', key: 'hima_observe' }, { name: 'tool.call.toolview', key: 'hima_run' }, { name: 'tool.call.toolview', key: 'hima_context' }, { name: 'tool.call.toolview', key: 'hima_execute' }, { name: 'tool.call.toolview', key: 'hima_author' }],
      'the workbench link and the two existing tool views use their declared slots',
    );
    assert.equal(typeof component, 'function', 'with a component to render it');

    assert.doesNotMatch(wb.host.stderr(), /plugin tree failed to load|failed to import|host preparation failed/i, 'no plugin failed to activate');
  } finally { await wb.dispose(); }
});
