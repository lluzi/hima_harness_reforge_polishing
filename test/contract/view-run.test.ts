// Ticket #16: the workbench. A Run's whole path, read through the Hima namespace and rendered by the
// HimaGuide card.
//
// Everything here is asserted at the one agreed seam: the real web profile booted as a subprocess,
// reached over HTTP with the web app's own session cookie, and the browser module asserted on the
// bundle the host actually serves. The Site is the local one and the flow is the generated stand-in;
// the reference site is #17.
//
// What each test is for:
//   - the run view carries the whole path of a Run started over HTTP — nodes, jobs, decision, meters,
//     goal, budget — and the records route narrows to every record type step 2 added;
//   - a cancel over HTTP stops a Job that is still sleeping, and the request, the observed stop and
//     the Run's ending are the ones #14 defined; a resume over HTTP clears the blocker #15 wrote;
//   - a cancel or a resume of a Run whose status cannot take it is 409 `hima/run-not-in-state`;
//   - every route is refused without the session cookie;
//   - the served bundle claims the tool-view key of both Hima tools and carries the rendering of
//     every Run status and every node state a person can be shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHimaHome, harnessPackageDir, type HimaHome } from './support/dsh-home.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, openSession, postObserve } from './support/hima-api.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
import { installPack, timingProbePackId } from './support/pack.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
// tmux itself, asked by the one module that owns that question for this suite.
import { tmuxHasSession } from './support/tmux.ts';
// The view shapes are the bundle's own contract, not this file's opinion of it.
import type { HimaErrorBody, RecordsView, RunView } from '@hima/harness';

/** One answer, read once: the status is asserted against the body the response actually carried. */
async function answer<T>(res: Response, expected: number): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, expected, text);
  return JSON.parse(text) as T;
}

interface Workbench {
  readonly h: HimaHome;
  readonly host: BootedHost;
  readonly cookie: string;
  /** Every tmux session this workbench's Runs launched, so a test cleans up after itself. */
  readonly sessions: Set<string>;
  dispose(): Promise<void>;
}

/** A local home with the shipped pack, the stand-in flow, the local site, and a booted web profile. */
async function bootedWorkbench(
  t: import('node:test').TestContext,
  opts: { sleepSeconds?: number; failures?: number } = {},
): Promise<Workbench | undefined> {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, { sleepSeconds: opts.sleepSeconds ?? 1, failures: opts.failures ?? 0 });
  if (!flow) { await h.dispose(); return undefined; }
  await installPack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
  });
  const host = await bootHimaHost(h);
  const cookie = await openSession(host);
  const sessions = new Set<string>();
  return {
    h, host, cookie, sessions,
    dispose: async () => {
      // Every session came out of this home's own ledger through the run view: never one this test
      // did not start.
      for (const s of sessions) spawnSync('tmux', ['kill-session', '-t', `=${s}`], { timeout: 15_000 });
      const code = await host.stop();
      await h.dispose();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    },
  };
}

/**
 * Start a Campaign through the route the workbench starts one through.
 *
 * One generation unless the caller says otherwise: this suite is about what the run view carries and
 * what the page renders, and the shipped pack's own loop (#25) would have every one of these tests
 * reading three generations' records where it means to read one. What a Loop does is `loop.test.ts`.
 */
const startRun = (wb: Workbench, body: Record<string, unknown>): Promise<Response> =>
  api(wb.host, wb.cookie, '/hima/api/runs', {
    method: 'POST',
    body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1, ...body }),
    headers: { 'content-type': 'application/json' },
  });

/** The Run as the workbench reads it. */
const readRun = async (wb: Workbench, runId: string): Promise<RunView> =>
  answer<RunView>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}`), 200);

/** The Run's records of one type, as the records route lists them. */
const readRecords = async (wb: Workbench, runId: string, type: string): Promise<RecordsView['records']> =>
  (await answer<RecordsView>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/records?type=${type}`), 200)).records;

/** Remember every session a view says was launched, so the test can stop what it started. */
function remember(wb: Workbench, view: RunView): RunView {
  for (const job of view.jobs) if (job.event === 'launched') wb.sessions.add(job.job.session);
  return view;
}

/** Poll the run view until it says something, or fail saying what never happened. */
async function untilView(wb: Workbench, runId: string, what: string, ready: (v: RunView) => boolean, timeoutMs = 60_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = remember(wb, await readRun(wb, runId));
    if (ready(view)) return view;
    if (Date.now() >= deadline) throw new Error(`waited ${timeoutMs} ms and ${what} never happened: ${JSON.stringify(view.run)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('the run view carries the whole path of a run started over HTTP: nodes, jobs, decision, meters, goal and budget', async (t) => {
  const wb = await bootedWorkbench(t);
  if (!wb) return;
  try {
    const view = remember(wb, await answer<RunView>(await startRun(wb, {}), 200));

    // The run row: what the Run is for, what it was allowed, and what it spent.
    assert.equal(view.run.status, 'ended-budget-exhausted', 'the one generation it was allowed ran to its end');
    assert.equal(view.run.packId, timingProbePackId, 'the view says which pack the run runs');
    assert.deepEqual(view.run.goal, { target_period_ns: 2.0 }, 'the goal is on the view, immutable since it was opened');
    assert.ok(Number(view.run.strategy?.periodNs ?? 0) > 0, `and the strategy it now stands at: ${JSON.stringify(view.run.strategy)}`);
    assert.equal(view.run.budget?.jobCap, 1, 'the budget carries the cap the site declared');
    assert.equal(view.run.budget?.retryAllowance, 3, 'and the default retry allowance');
    assert.ok((view.run.budget?.timeBoxMs ?? 0) > 0, 'and a time box');
    assert.ok((view.run.meters?.elapsedMs ?? -1) >= 0, `the meters carry the elapsed time: ${JSON.stringify(view.run.meters)}`);
    assert.equal(view.run.meters?.jobsLaunched, 1, 'one job launched');
    // The run-wide meter counts every node turn, not the retry allowance's per-node attempts: this
    // graph took four turns and none of them was tried twice, which the node rows below say.
    assert.equal(view.run.meters?.attempts, 4, 'one turn at each of the four nodes it reached');
    assert.equal(view.run.meters?.endedBy, 'generation-limit', 'and the meter that ended it is the generation it was allowed');

    // The path: one entry per node, in the order the Run reached them, each with the state it is in.
    assert.deepEqual(
      view.nodes.map((n) => [n.nodeId, n.kind, n.state, n.attempt]),
      [['synthesize', 'act', 'done', 1], ['read-qor', 'act', 'done', 1], ['judge', 'judge', 'done', 1], ['next-period', 'explore', 'done', 1]],
      'the whole path, in graph order, with every node settled',
    );
    const synthesize = view.nodes.find((n) => n.nodeId === 'synthesize')!;
    assert.ok(synthesize.jobSession, 'the act node names the job session it waited on');
    assert.equal(synthesize.waitedForSlot, undefined, 'nothing queued behind a full site');

    // The Jobs: identity, events and exit.
    assert.deepEqual(view.jobs.map((j) => j.event), ['launched', 'finished'], 'one job, launched and finished');
    const finished = view.jobs.find((j) => j.event === 'finished')!;
    assert.equal(finished.exitCode, 0, 'which exited zero');
    assert.equal(finished.nodeId, 'synthesize', 'and says which node launched it');
    assert.equal(finished.job.session, synthesize.jobSession, 'the same session the node named');

    // What was read, and what was concluded about it.
    assert.equal(view.observations.length, 1, 'one observation: the generation\'s qor report');
    assert.equal(view.verdicts.length, 2, 'judged by both of the pack\'s rules');
    assert.ok(view.verdicts.every((v) => v.cites.every((c) => c.observation !== null)), 'every verdict citation resolved to the observation it was read from');

    // The decision, and every record it cited, all inside the one view the browser reads.
    const decision = view.decision;
    assert.ok(decision, 'the explore node decided');
    assert.equal(decision.nodeId, 'next-period');
    assert.equal(decision.chooser, 'over-constraining-push');
    assert.ok('strategy' in decision.chosen, `this generation missed its goal, so the chooser chose a next strategy: ${JSON.stringify(decision.chosen)}`);
    assert.equal(view.run.strategy?.periodNs, 2.0, 'the row still stands at the strategy it ran: the next generation it would have opened was not allowed');
    assert.equal(decision.chosen.strategy.periodNs, 2.15, 'and the strategy it would have tried is on the decision');
    assert.ok(Object.keys(decision.rationale).length > 0, 'with the named numbers it chose from');
    const known = new Set([...view.observations.map((o) => o.recordId), ...view.verdicts.map((v) => v.recordId)]);
    assert.deepEqual(decision.cites.filter((id) => !known.has(id)), [], `every id the decision cites is a record this same view carries: ${JSON.stringify(decision.cites)}`);

    assert.deepEqual(view.blockers, [], 'nothing blocked');
    assert.deepEqual(view.cancels, [], 'and nobody asked it to stop');

    // The records route lists the whole path — one record per transition — and narrows to each type.
    const nodes = await readRecords(wb, view.run.id, 'node');
    assert.deepEqual(
      nodes.map((r) => [(r as { nodeId: string }).nodeId, (r as { state: string }).state]),
      [
        ['synthesize', 'running'], ['synthesize', 'done'],
        ['read-qor', 'running'], ['read-qor', 'done'],
        ['judge', 'running'], ['judge', 'done'],
        ['next-period', 'running'], ['next-period', 'done'],
      ],
      'every transition, in sequence, rather than the one entry per node the run view carries',
    );
    assert.equal((await readRecords(wb, view.run.id, 'decision')).length, 1);
    assert.equal((await readRecords(wb, view.run.id, 'workspace')).length, 1);
    assert.equal((await readRecords(wb, view.run.id, 'job')).length, 2);
    assert.deepEqual(await readRecords(wb, view.run.id, 'blocker'), []);
    assert.deepEqual(await readRecords(wb, view.run.id, 'cancel'), []);
    assert.deepEqual(await readRecords(wb, view.run.id, 'resumed'), []);
    for (const line of [`run ${view.run.id}`, ...view.nodes.map((n) => `  ${n.nodeId}: ${n.state}`)]) t.diagnostic(line);
  } finally { await wb.dispose(); }
});

test('over HTTP a person resumes a blocked run and cancels the job it launched: the blocker, the request, the observed stop, and a 409 on a run whose status cannot take either', async (t) => {
  // One stand-in generation fails on purpose with no retry allowance, so the Run blocks and the route
  // answers with the run id and the workspace the next generation will run in. The workspace's own
  // copy of the flow is then told to sleep, so the Job the resume launches is still running when the
  // cancel arrives — which is the only state a cancel has anything to stop.
  const wb = await bootedWorkbench(t, { failures: 1 });
  if (!wb) return;
  try {
    const blocked = remember(wb, await answer<RunView>(await startRun(wb, { retries: 0 }), 200));
    const runId = blocked.run.id;
    assert.equal(blocked.run.status, 'waiting', 'a spent allowance leaves the run waiting for a person');
    assert.equal(blocked.run.currentNode, 'blocked', 'at the pack\'s wait node');
    assert.equal(blocked.blockers.length, 1, 'and the view carries the blocker to clear');
    const blocker = blocked.blockers[0]!;
    assert.equal(blocker.nodeId, 'synthesize');
    assert.equal(blocker.attempts, 1, 'an allowance of zero is one attempt');
    assert.ok(blocker.lastExitCode !== undefined && blocker.lastExitCode !== 0, `with the exit the job gave: ${JSON.stringify(blocker)}`);
    assert.ok(blocker.logTail, 'and the tail of that job\'s own log, so nobody has to log in to the site to read it');
    assert.ok(blocked.nodes.some((n) => n.nodeId === 'synthesize' && n.state === 'blocked' && n.reason), 'the blocked node says why, in words');

    // The workspace the next generation runs in, read the way the browser would: off the records
    // route. Its copy of the flow is this Campaign's own, so slowing it down slows nothing else.
    const workspaces = await readRecords(wb, runId, 'workspace');
    const workspace = (workspaces[0] as { workspace: string }).workspace;
    const makefile = path.join(workspace, 'flow', 'Makefile');
    const text = await readFile(makefile, 'utf8');
    assert.match(text, /^STANDIN_SLEEP \?= 1$/m, 'the campaign\'s own copy of the stand-in flow');
    await writeFile(makefile, text.replace(/^STANDIN_SLEEP \?= 1$/m, 'STANDIN_SLEEP ?= 40'));

    // The resume drives the Run again and blocks until it stops; the cancel below is what stops it.
    const resuming = api(wb.host, wb.cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' });
    const running = await untilView(wb, runId, 'the resumed run launched a job and said which session it waits on', (v) =>
      v.nodes.some((n) => n.state === 'running' && n.jobSession !== undefined));
    const session = running.nodes.find((n) => n.state === 'running' && n.jobSession !== undefined)!.jobSession!;
    assert.ok(tmuxHasSession(session), 'the job is really on the site');

    const cancelled = remember(wb, await answer<RunView>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/cancel`, { method: 'POST' }), 200));
    assert.equal(cancelled.run.status, 'cancelled', 'the run ends the way the person asked');
    assert.equal(cancelled.run.meters?.endedBy, 'cancel', 'and says what ended it');
    assert.ok((cancelled.run.meters?.waitedMs ?? 0) > 0, `having waited on a person before it: ${JSON.stringify(cancelled.run.meters)}`);
    assert.deepEqual(
      cancelled.cancels.map((c) => [c.nodeId, c.jobSession]),
      [['synthesize', session]],
      `the request a person made is a record of its own: ${JSON.stringify(cancelled.cancels)}`,
    );
    assert.ok(cancelled.jobs.some((j) => j.event === 'killed' && j.job.session === session), `and the observed stop another: ${JSON.stringify(cancelled.jobs)}`);
    assert.ok(cancelled.nodes.some((n) => n.nodeId === 'synthesize' && n.state === 'cancelled'), JSON.stringify(cancelled.nodes));
    assert.ok(!tmuxHasSession(session), 'the site itself says the job is gone');

    // The resume that was still waiting on that Job answers with the run a person ended, not an error.
    const carried = remember(wb, await answer<RunView>(await resuming, 200));
    assert.equal(carried.run.status, 'cancelled', 'the resume carrying the run answers with the ending it was given');

    // The person's two actions, each a record the records route narrows to.
    const resumed = await readRecords(wb, runId, 'resumed');
    assert.equal(resumed.length, 1, JSON.stringify(resumed));
    assert.equal((resumed[0] as { writer: string }).writer, 'person');
    assert.equal((resumed[0] as { who: string }).who, 'workbench', 'a request through the web app\'s own fence is the workbench, never a name a caller chose');
    assert.equal((resumed[0] as { nodeId: string }).nodeId, 'synthesize');
    assert.equal((await readRecords(wb, runId, 'cancel')).length, 1);
    assert.equal((await readRecords(wb, runId, 'blocker')).length, 1, 'a cleared blocker stays on the record: it happened');

    // A cancel of a Run that already ended is the clear answer and writes nothing; a resume of one is
    // the caller asking for something this Run's status cannot give.
    const again = await answer<RunView>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/cancel`, { method: 'POST' }), 200);
    assert.deepEqual(again, cancelled, 'the second cancel wrote nothing at all');
    const refused = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' }), 409);
    assert.equal(refused.error.code, 'hima/run-not-in-state', 'a run whose status cannot take a resume is a conflict, not a malformed request');
    assert.match(refused.error.message, /this run is cancelled, and only a waiting run can be resumed; nothing was written/, refused.error.message);
  } finally { await wb.dispose(); }
});

test('a run HimaFabric never started cannot be cancelled, and says so with 409 hima/run-not-in-state', async (t) => {
  const wb = await bootedWorkbench(t);
  if (!wb) return;
  try {
    // An observation's own Probe-campaign Run: it exists, it has records, and it has no fabric state.
    const sample = await writeSampleReport(wb.h);
    const probe = await answer<RunView>(await postObserve(wb.host, wb.cookie, { site: 'local', path: sample.rel }), 200);
    assert.equal(probe.run.status, undefined, 'a probe run has no status at all');

    const refused = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, `/hima/api/runs/${probe.run.id}/cancel`, { method: 'POST' }), 409);
    assert.equal(refused.error.code, 'hima/run-not-in-state');
    assert.match(refused.error.message, /has no fabric state: HimaFabric never started it, so there is nothing to cancel/, refused.error.message);
    assert.deepEqual(await readRecords(wb, probe.run.id, 'cancel'), [], 'and nothing was written');

    // The route's other conflict, `409 hima/run-not-stopped`, is held by reading `cancelOperation`
    // in `remote.ts` and not asserted here: it needs a `kill-session` that tmux ignores for the whole
    // of the harness's bounded wait, which is a Site state nothing at this seam can ask for (see
    // `support/tmux.ts`, which says the same thing about the state it does put back by hand).

    // A run the ledger does not hold is still 404, not a conflict: there is no state to be in.
    const missing = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, '/hima/api/runs/run-nope/cancel', { method: 'POST' }), 404);
    assert.equal(missing.error.code, 'hima/run-not-found');
  } finally { await wb.dispose(); }
});

test('every route the workbench uses, and the workbench page itself, sit behind the web app\'s own session cookie', async (t) => {
  const wb = await bootedWorkbench(t);
  if (!wb) return;
  try {
    const targets: readonly (readonly [string, RequestInit])[] = [
      ['/hima/api/runs/run-x', {}],
      ['/hima/api/runs/run-x/records?type=node', {}],
      ['/hima/api/records/record-x', {}],
      ['/hima/api/runs', { method: 'POST', body: '{}' }],
      ['/hima/api/runs/run-x/cancel', { method: 'POST' }],
      ['/hima/api/runs/run-x/resume', { method: 'POST' }],
    ];
    for (const [target, init] of targets) {
      const res = await fetch(new URL(target, wb.host.url), init);
      const refused: HimaErrorBody = await answer(res, 401);
      assert.equal(refused.error.code, 'hima/not-authorized', `${target} is refused without the session cookie`);
    }

    // The page is behind the same fence, and says so as a page: it is a document a browser loads,
    // so its refusal is HTML rather than the routes' JSON error body.
    const page = await fetch(new URL('/hima/', wb.host.url));
    const pageBody = await page.text();
    assert.equal(page.status, 401, `/hima/ is refused without the session cookie: ${pageBody}`);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8', pageBody);
    assert.match(pageBody, /no browser session/, pageBody);
  } finally { await wb.dispose(); }
});

test('the served HimaGuide bundle claims the tool-view key of both Hima tools and carries the rendering of every run status and node state', async (t) => {
  const wb = await bootedWorkbench(t);
  if (!wb) return;
  try {
    const index = await api(wb.host, wb.cookie, '/');
    const html = await index.text();
    const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(html);
    assert.ok(boot, 'the index carries the client-module boot graph');
    const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
    const hima = graph.entries.find((e) => e.id === '@hima/harness');
    assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);
    const source = await (await api(wb.host, wb.cookie, hima.url)).text();

    // Run the served bundle the way the shell runs it, and see which keys it claims.
    const loaded: { id: string; factory: (req: (spec: string) => unknown) => Record<string, unknown> }[] = [];
    new Function('window', source)({ __ModuleLoader__: { load: (r: unknown) => loaded.push(r as never) } });
    const baseline = createRequire(path.join(harnessPackageDir, 'package.json'));
    const moduleExports = loaded[0]!.factory((spec) => baseline(spec)) as {
      apply(ctx: {
        effect(callback: () => (() => void)): unknown;
        sidebarRight: { openTab(kind: string): void };
        sidebarRightTabs: { register(definition: unknown): () => void };
        layout: { toggleSidebar(): void };
        slots: { inject(name: string, callback: () => unknown): unknown; register(declaration: { name: string; key?: string; id?: string }, component: unknown): unknown };
      }): void;
    };
    const registered: { name: string; key?: string; id?: string }[] = [];
    moduleExports.apply({
      effect: (callback) => callback(),
      sidebarRight: { openTab: () => undefined },
      sidebarRightTabs: { register: () => () => undefined },
      layout: { toggleSidebar: () => undefined },
      slots: {
        inject: (name, cb) => { assert.ok(['tool.call.toolview', 'sidebar.footer.action', 'sidebar.right.pane.tab', 'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'].includes(name), 'only existing native presentation slots are extended'); return cb(); },
        register: (declaration) => { registered.push({ name: declaration.name, ...('key' in declaration ? { key: declaration.key } : {}), ...('id' in declaration ? { id: declaration.id } : {}) }); return () => undefined; },
      },
    });
    assert.deepEqual(
      registered.filter((r) => r.name === 'tool.call.toolview').map((r) => r.key).sort(),
      ['hima_author', 'hima_observe', 'hima_run'],
      'the card renders a run wherever a Hima tool reported one, and claims no other key',
    );

    // The card is what a person sees a Run's path in, so the bundle carries every state it can be in.
    //
    // Only the distinctive spellings are asked for. A minified bundle of a React component is full of
    // ordinary English, so `source.includes('running')`, `'done'`, `'goal'` or `'exit'` would be
    // satisfied by a word this card never rendered — an assertion that cannot fail is worse than no
    // assertion, because it reads as coverage. What is left cannot be reached by accident.
    for (const status of ['cancelled', 'ended-goal-met', 'ended-goal-not-met', 'ended-converged', 'ended-budget-exhausted']) {
      assert.ok(source.includes(status), `the module renders the run status "${status}"`);
    }
    for (const state of ['pending', 'retrying', 'blocked', 'cancelled', 'waiting-for-slot', 'reconciled']) {
      assert.ok(source.includes(state), `the module renders the node state "${state}"`);
    }
    for (const piece of ['attempt', 'blocker', 'decision', 'elapsed']) {
      assert.ok(source.includes(piece), `the module labels the ${piece} it shows`);
    }
    assert.doesNotMatch(wb.host.stderr(), /plugin tree failed to load|failed to import|host preparation failed/i, 'no plugin failed to activate');
  } finally { await wb.dispose(); }
});
