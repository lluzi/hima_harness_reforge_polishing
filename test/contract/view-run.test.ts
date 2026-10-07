// Ticket #16: the workbench. A Run's whole path, read through the Hima namespace and rendered by the
// HimaGuide card.
//
// Run reads, admission and human control use the actual web profile and browser session fence.
// The known-failure repair uses the actual owning Agent tool seam; it does not drive DBOS directly.
// Local stand-in Jobs keep business evidence and physical stop observable without model/SSH/EDA.
//
// Retained claims: task/result identity, goal and original budget, observations/verdicts and sourced
// decisions, physical Job counts, failed-task repair, real sleeping-Job cancellation, typed control
// denials, every records filter, no-cookie refusals, and the statuses in the actually served bundle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHimaHome, harnessPackageDir, type HimaHome } from './support/dsh-home.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession, postObserve } from './support/hima-api.ts';
import { writeLocalSite, writeSampleReport } from './support/site.ts';
import { installPack, timingProbePackId } from './support/pack.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
// tmux itself, asked by the one module that owns that question for this suite.
import { tmuxHasSession } from './support/tmux.ts';
// The view shapes are the bundle's own contract, not this file's opinion of it.
import type { HimaErrorBody, RecordsView, RunView, TaskIdentity, LogTailView } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

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
  readonly guide: string;
  readonly runs: Set<string>;
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
  const guide = await createLiveSession(host, cookie, h.workspace);
  const runs = new Set<string>();
  const wb: Workbench = {
    h, host, cookie, guide, runs,
    dispose: async () => {
      for (const runId of runs) {
        const context = await readRun(wb, runId);
        if (!context.run.stopState?.closed) await answer<{ run: RunView }>(await controlRun(wb, runId, 'cancel', 'fixture-close'), 200);
        const closed = await untilView(wb, runId, 'public physical resource closure', v => v.run.stopState?.closed === true, 30_000);
        for (const job of closed.jobs) if (job.event === 'launched') assert.equal(tmuxHasSession(job.job.session), false,
          'PG-projected submitted Job is physically absent before Host/Home disposal');
        console.info('fixture-resource-closure', JSON.stringify({ runId, stopState: closed.run.stopState, sessions: [...new Set(closed.jobs.map(j => j.job.session))], submittedSessionsAbsent: true }));
      }
      const code = await host.stop();
      await h.dispose();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    },
  };
  return wb;
}

/**
 * Start a Campaign through the route the workbench starts one through.
 *
 * One reviewed generation: this suite is about what the run view carries and
 * what the page renders, and the shipped pack's own loop (#25) would have every one of these tests
 * reading three generations' records where it means to read one. What a Loop does is `loop.test.ts`.
 */
async function startRun(wb: Workbench, body: Record<string, unknown>): Promise<RunView> {
  const campaign = await answer<{ preparation: { proposal: { id: string; ready: boolean } } }>(await api(wb.host, wb.cookie, `/hima/api/campaign?sessionId=${wb.guide}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: wb.guide, file: { schema: 'hima-campaign/1',
      pack: { id: timingProbePackId }, site: { name: 'local' }, goal: { target_period_ns: 2 }, strategy: { periodNs: 2 },
      budget: { generations: 1, ...(body.retries === undefined ? {} : { retries: body.retries }) } } }),
  }), 200);
  assert.equal(campaign.preparation.proposal.ready, true);
  const view = await answer<RunView>(await api(wb.host, wb.cookie, '/hima/api/runs/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fromCampaignFile: true, pack: timingProbePackId, site: 'local',
      proposalId: campaign.preparation.proposal.id, sessionId: wb.guide }),
  }), 200);
  wb.runs.add(view.run.id);
  assert.equal(view.run.engine, 'dbos/5.2.11');
  assert.equal(view.run.control?.guideSessionId, wb.guide);
  assert.notEqual(view.run.control?.owner, wb.guide);
  await untilView(wb, view.run.id, 'original prepared workspace', v => v.workspace !== undefined);
  return view;
}

async function controlRun(wb: Workbench, runId: string, action: string, requestId: string): Promise<Response> {
  const view = await readRun(wb, runId);
  return api(wb.host, wb.cookie, `/hima/api/runs/${runId}/control`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, requestId, sessionId: wb.guide, expectedEpoch: view.run.control!.epoch, expectedRevision: view.run.control!.revision }) });
}

/** The Run as the workbench reads it. */
const readRun = async (wb: Workbench, runId: string): Promise<RunView> =>
  answer<RunView>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}?sessionId=${wb.guide}`), 200);

/** The Run's records of one type, as the records route lists them. */
const readRecords = async (wb: Workbench, runId: string, type: string): Promise<RecordsView['records']> =>
  (await answer<RecordsView>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/records?type=${type}&sessionId=${wb.guide}`), 200)).records;

/** Poll the run view until it says something, or fail saying what never happened. */
async function untilView(wb: Workbench, runId: string, what: string, ready: (v: RunView) => boolean, timeoutMs = 60_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = await readRun(wb, runId);
    if (ready(view)) return view;
    if (Date.now() >= deadline) throw new Error(`waited ${timeoutMs} ms and ${what} never happened: ${JSON.stringify(view.run)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('the run view carries the whole path of a run started over HTTP: task results, jobs, decision evidence, goal and budget', async (t) => {
  const wb = await bootedWorkbench(t);
  if (!wb) return;
  try {
    const started = await startRun(wb, {});
    const view = await untilView(wb, started.run.id, 'terminal whole path', v => !!v.run.status?.startsWith('ended-'));

    assert.equal(view.run.status, 'ended-goal-not-met');
    assert.equal(view.run.goalState, 'not-met', 'a spent generation budget never promotes negative Timing evidence to Goal met');
    assert.equal(view.run.packId, timingProbePackId);
    assert.deepEqual(view.run.goal, { target_period_ns: 2 });
    assert.deepEqual(view.run.strategy, { periodNs: 2 }, 'the next hypothesis was not run after the original generation limit');
    assert.equal(view.run.budget?.jobCap, 1);
    assert.equal(view.run.budget?.retryAllowance, 3);
    assert.equal(view.run.budget?.generationLimit, 1);
    assert.ok((view.run.budget?.timeBoxMs ?? 0) > 0);
    assert.equal(Date.parse(view.run.deadlineAt!) - Date.parse(view.run.createdAt), view.run.budget!.timeBoxMs,
      'the public deadline retains the original total time box');
    const tasks = view.tasks!.filter(task => task.result);
    assert.deepEqual(tasks.map(task => task.taskId).sort(), ['judge', 'next-period', 'read-qor', 'synthesize']);
    for (const task of tasks) {
      assert.equal(task.projection.state, 'succeeded');
      assert.equal(task.identity?.runId, view.run.id);
      assert.deepEqual(task.result!.identity, task.identity);
      assert.ok(task.sourceFactIds.length > 0, 'each committed result carries original source facts');
    }
    const synthesize = tasks.find(task => task.taskId === 'synthesize')!;
    const synthValue = synthesize.result!.value as { job: { session: string }; completed: boolean };
    assert.equal(synthValue.completed, true);
    const launches = view.jobs.filter(job => job.event === 'launched');
    const finished = view.jobs.filter(job => job.event === 'finished');
    assert.ok(launches.some(job => job.nodeId === 'synthesize' && job.job.session === synthValue.job.session));
    for (const job of launches) {
      assert.ok(finished.some(result => result.job.session === job.job.session && result.exitCode === 0),
        'every physical submission, including original collection work, retains its successful exit');
      assert.equal(tmuxHasSession(job.job.session), false, 'terminal receipt has physically released its submitted Job');
    }
    assert.equal(view.valueMeasurement?.human.businessDecisionTime.status, 'unmeasured');
    assert.equal(view.valueMeasurement?.model.requests.status, 'unmeasured');
    assert.equal(view.observations.length, 1);
    assert.equal(view.verdicts.length, 2);
    assert.ok(view.verdicts.every(verdict => verdict.cites.every(citation => citation.observation !== null)));
    const decisionTask = tasks.find(task => task.taskId === 'next-period')!;
    const decision = decisionTask.result!.value as { chooser: string; chosen: { strategy: { periodNs: number } };
      rationale: Record<string, unknown>; cites: string[]; outcome: string; goalMet: boolean };
    assert.equal(decision.chooser, 'over-constraining-push');
    assert.equal(decision.outcome, 'generation-limit');
    assert.equal(decision.goalMet, false);
    assert.equal(decision.chosen.strategy.periodNs, 2.15);
    assert.ok(Object.keys(decision.rationale).length > 0);
    const evidence = new Set(tasks.filter(task => task.taskId === 'read-qor' || task.taskId === 'judge')
      .flatMap(task => task.sourceFactIds));
    assert.ok(decision.cites.length > 0, 'the decision must cite actual upstream observation or verdict evidence');
    for (const citation of decision.cites) assert.ok(evidence.has(citation), 'decision cites original committed results carried in this view');
    assert.deepEqual(view.blockers, []);
    assert.deepEqual(view.cancels, []);
    const all = (await answer<RecordsView>(await api(wb.host, wb.cookie,
      `/hima/api/runs/${view.run.id}/records?sessionId=${wb.guide}`), 200)).records;
    for (const type of ['node', 'decision', 'workspace', 'job', 'blocker', 'cancel', 'resumed', 'observation', 'verdict']) {
      assert.deepEqual(await readRecords(wb, view.run.id, type), all.filter(record => record.type === type),
        `the records route filters every retained record type exactly: ${type}`);
    }
    assert.equal(all.filter(record => record.type === 'workspace').length, 1);
    assert.equal(all.filter(record => record.type === 'job').length, view.jobs.length);
    console.info('whole-path-count-truth', JSON.stringify({ runId: view.run.id, committedTasks: tasks.map(task => task.taskId),
      physicalLaunches: launches.length, physicalFinished: finished.length, measurement: view.valueMeasurement?.jobs,
      observations: view.observations.length, verdicts: view.verdicts.length, decision, originalBudget: view.run.budget }));
    assert.equal(view.valueMeasurement?.jobs.launched.value, launches.length);
    assert.equal(view.valueMeasurement?.jobs.finished.value, finished.length);
    t.diagnostic(`Run ${view.run.id}: four committed business tasks, ${launches.length} physical Job submissions; original generation limit, Goal not met`);
  } finally { await wb.dispose(); }
});

test('a known failed and physically closed task is repaired through the owning Agent in the same Run with its original budget', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0, failures: 1 });
  assert.ok(local);
  const host = await bootInProcess(local.h, { withWebApp: true });
  let runId: string | undefined;
  type RepairContext = { run: RunView['run']; durable: { run: { deadlineAt: string }; outcome?: { state: string };
    tasks: { identity: TaskIdentity; state: { state: string }; valid: boolean; result?: unknown }[]; stopped: unknown } };
  const readContext = async () => await host.ctx.hima.readExecutionContext(runId!) as unknown as RepairContext;
  try {
    const guide = await createRootAgent(host.ctx, local.h.workspace);
    let serial = 0;
    const call = (name: string, args: object, agent = guide) => host.ctx.tools.execute({ name, arguments: args, agent,
      callId: `repair-${++serial}` as never, signal: AbortSignal.timeout(30_000) });
    const value = (result: Awaited<ReturnType<typeof call>>) => {
      assert.equal(result.isError, false, JSON.stringify(result));
      return JSON.parse(result.content.filter(item => item.type === 'text').map(item => item.text).join(''));
    };
    const budget = { generations: 1, retries: 0 };
    const proposal = value(await call('hima_prepare', { pack: timingProbePackId, site: 'local', budget }));
    const started = value(await call('hima_run', { pack: timingProbePackId, site: 'local', proposalId: proposal.id,
      goal: proposal.goal, strategy: proposal.strategy, budget }));
    runId = started.runId;
    await waitUntil('original known failed task', async () => (await readContext()).durable.tasks
      .some(task => task.state.state === 'failed'), 15_000, 25);
    const before = await readContext();
    const original = before.durable.tasks.find(task => task.state.state === 'failed')!;
    const submitted = await host.ctx.hima.durable.store.effectFact(original.identity.effectId, 'submitted') as { session: string; workspace: string };
    const failure = await host.ctx.hima.durable.store.effectFact(original.identity.effectId, 'executor-failure') as { exitCode: number };
    assert.notEqual(failure.exitCode, 0);
    assert.equal(tmuxHasSession(submitted.session), false, 'original failed Job is physically closed before explicit repair');
    assert.ok((await readFile(path.join(submitted.workspace, `${submitted.session}.log`), 'utf8')).length > 0,
      'the original failed Job log remains available');
    const invocation = (await host.ctx.hima.durable.store.flowInvocations(runId!)).find(item => item.identity.effectId === original.identity.effectId)!;
    const input = (invocation.context as { input: Record<string, unknown> }).input;
    const owner = host.ctx.get('agents')!.get(before.run.control!.owner as never)!;
    assert.ok(owner);
    assert.notEqual(String(owner.id), String(guide.id));
    const publicContext = value(await call('hima_context', { run: runId }, guide)) as { facts: RunView };
    const failedTask = publicContext.facts.tasks!.find(task => task.identity?.effectId === original.identity.effectId)!;
    assert.equal(failedTask.taskId, original.identity.taskId);
    assert.equal(failedTask.projection.state, 'failed');
    assert.ok('reason' in failedTask.projection);
    assert.match(failedTask.projection.reason.message, /Original Job .* exited [1-9]\d*; inspect its retained log/);
    const failedJob = publicContext.facts.jobs.find(job => job.event === 'finished' && job.job.session === submitted.session)!;
    assert.equal(failedJob.exitCode, failure.exitCode, 'the assigned Guide sees the original physical Job failure');
    assert.notEqual(failedJob.exitCode, 0);
    const connection = host.ctx.get('connection' as never) as unknown as { authenticatedUrl(url: string): string };
    const webServer = host.ctx.get('webServer' as never) as unknown as { port: number };
    const browser = { url: connection.authenticatedUrl(`http://127.0.0.1:${webServer.port}`) };
    const exchanged = await fetch(browser.url, { redirect: 'manual' });
    assert.equal(exchanged.status, 303);
    const cookie = exchanged.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const log = await answer<LogTailView>(await api(browser, cookie,
      `/hima/api/runs/${runId}/log-tail?sessionId=${guide.id}&node=${original.identity.taskId}&lines=100`), 200);
    assert.equal(log.session, submitted.session, 'public log read retains the original failed Job session');
    assert.match(log.lines.join('\n'), /\[stand-in\] Error: synthesis was told to fail this attempt/);
    assert.match(log.lines.join('\n'), /attempt\(s\) were left to fail; nothing was written/);
    console.info('public-failed-job-diagnosis', JSON.stringify({ runId, effectId: failedTask.identity!.effectId,
      guideSessionId: String(guide.id), session: log.session, exitCode: failedJob.exitCode,
      reason: failedTask.projection.reason, lines: log.lines }));
    const repaired = value(await call('hima_execute', { run: runId, action: 'revise', requestId: 'repair-known-failure',
      expectedEpoch: before.run.control!.epoch, expectedRevision: before.run.control!.revision,
      revision: { taskId: original.identity.taskId, effectId: original.identity.effectId, input,
        evidence: { reason: 'Explicit business repair after known failed and physically closed original Job',
          source: original.identity.effectId, originalExit: failure.exitCode } } }, owner));
    assert.equal(repaired.kind, 'accepted');
    await waitUntil('actual replacement invocation finishes in the same Run', async () => {
      const context = await readContext();
      return context.durable.outcome?.state === 'succeeded' && context.run.control!.revision === 1;
    }, 15_000, 25);
    const recovered = await readContext();
    assert.equal(recovered.run.id, before.run.id);
    assert.deepEqual(recovered.run.budget, before.run.budget);
    assert.equal(recovered.durable.run.deadlineAt, before.durable.run.deadlineAt);
    assert.ok(recovered.durable.tasks.some(task => task.identity.taskId === original.identity.taskId
      && task.identity.effectId !== original.identity.effectId && task.result));
    assert.ok(recovered.durable.tasks.some(task => task.identity.effectId === original.identity.effectId
      && !task.valid && task.state.state === 'failed'), 'the original failed evidence is retained');
    console.info('same-run-repair', JSON.stringify({ runId, originalEffect: original.identity.effectId,
      revision: recovered.run.control!.revision, outcome: recovered.durable.outcome?.state, originalBudgetPreserved: true,
      originalDeadlinePreserved: true, originalFailedEvidenceRetained: true }));
  } finally {
    try {
      if (runId) {
        const current = await readContext();
        const owner = host.ctx.get('agents')!.get(current.run.control!.owner as never)!;
        assert.ok(owner);
        const cancellation = await host.ctx.tools.execute({ name: 'hima_execute', callId: 'fixture-close-repaired' as never,
          agent: owner, signal: AbortSignal.timeout(30_000), arguments: { run: runId, action: 'cancel', requestId: 'fixture-close-repaired',
            expectedEpoch: current.run.control!.epoch, expectedRevision: current.run.control!.revision } });
        assert.equal(cancellation.isError, false, JSON.stringify(cancellation));
        const cancelled = JSON.parse(cancellation.content.filter(item => item.type === 'text').map(item => item.text).join(''));
        assert.equal(cancelled.kind, 'accepted', JSON.stringify(cancelled));
        try { await waitUntil('public actual resource closure after repaired Run', async () =>
          (await readContext()).run.stopState?.closed === true, 30_000, 25); }
        catch (error) {
          const context = await readContext();
          const physical = await host.ctx.hima.durable.store.flowPhysicalFacts(runId);
          console.info('unclosed-repaired-run', JSON.stringify({ runId, stopState: context.run.stopState,
            resources: physical.resources, tasks: context.durable.tasks.map(task => ({ identity: task.identity, state: task.state, valid: task.valid })),
            stopped: context.durable.stopped }));
          throw error;
        }
        const physical = await host.ctx.hima.durable.store.flowPhysicalFacts(runId);
        for (const effect of physical.effects) {
          const submitted = await host.ctx.hima.durable.store.effectFact(effect.identity.effectId, 'submitted') as { session?: string } | undefined;
          if (submitted?.session) assert.equal(tmuxHasSession(submitted.session), false);
        }
        console.info('fixture-resource-closure', JSON.stringify({ runId, publicClosed: true, pgSubmittedSessionsAbsent: true }));
      }
    } finally { await host.dispose(); await local.h.dispose(); }
  }
});

test('current human pause and continue preserve the Run, and cancellation physically stops its sleeping Job with typed invalid-state refusals', async (t) => {
  const wb = await bootedWorkbench(t, { sleepSeconds: 40 });
  assert.ok(wb);
  try {
    const started = await startRun(wb, {});
    const runId = started.run.id;
    const running = await untilView(wb, runId, 'a genuine sleeping physical Job', view => view.jobs.some(job => job.event === 'launched'));
    const session = running.jobs.find(job => job.event === 'launched')!.job.session;
    assert.equal(tmuxHasSession(session), true);
    const paused = (await answer<{ run: RunView }>(await controlRun(wb, runId, 'pause', 'human-pause'), 200)).run;
    assert.deepEqual(paused.run.control!.paused, ['*']);
    assert.equal(paused.run.control!.owner, started.run.control!.owner);
    const continued = (await answer<{ run: RunView }>(await controlRun(wb, runId, 'continue', 'human-continue'), 200)).run;
    assert.deepEqual(continued.run.control!.paused, []);
    assert.equal(continued.run.id, runId);
    assert.deepEqual(continued.run.budget, started.run.budget);
    assert.equal(continued.run.deadlineAt, started.run.deadlineAt, 'continuation grants no fresh time box');
    assert.equal(tmuxHasSession(session), true, 'the physical Job is still sleeping before cancellation');
    const accepted = await answer<{ run: RunView }>(await controlRun(wb, runId, 'cancel', 'human-cancel'), 200);
    assert.equal(accepted.run.run.id, runId, 'the accepted request is distinct from observed stop');
    const cancelled = await untilView(wb, runId, 'actual physical Job/resource closure', view => view.run.stopState?.closed === true);
    assert.equal(cancelled.run.status, 'cancelled');
    assert.deepEqual(cancelled.run.stopState, { state: 'closed', closed: true, unclosedResources: 0, effectsWithoutStopProof: 0 });
    assert.equal(tmuxHasSession(session), false, 'the actual Site says its originally submitted Job is absent');
    const context = await answer<{ run: { control: NonNullable<RunView['run']['control']> } }>(
      await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/context?sessionId=${wb.guide}`), 200);
    assert.equal(context.run.control.epoch, started.run.control!.epoch + 3, 'pause, continue and cancel each persist the current control identity');
    for (const action of ['continue', 'pause']) {
      const refused: HimaErrorBody = await answer<HimaErrorBody>(await controlRun(wb, runId, action, `after-cancel-${action}`), 409);
      assert.equal(refused.error.code, 'hima/run-not-in-state');
      assert.match(refused.error.message, /cancelled.*resumed/i);
    }
    const after = await answer<typeof context>(await api(wb.host, wb.cookie, `/hima/api/runs/${runId}/context?sessionId=${wb.guide}`), 200);
    assert.deepEqual(after.run.control, context.run.control, 'invalid-state requests preserve the accepted control identity');
  } finally { await wb.dispose(); }
});

test('a run HimaFabric never started cannot be cancelled, and says so with 409 hima/run-not-in-state', async (t) => {
  const wb = await bootedWorkbench(t);
  if (!wb) return;
  try {
    // An observation's own Probe-campaign Run: it exists, it has records, and it has no fabric state.
    const sample = await writeSampleReport(wb.h);
    const probe = await answer<RunView>(await postObserve(wb.host, wb.cookie, { site: 'local', path: sample.rel, sessionId: wb.guide }), 200);
    assert.equal(probe.run.status, undefined, 'a probe run has no status at all');

    const refused = await answer<HimaErrorBody>(await api(wb.host, wb.cookie, `/hima/api/runs/${probe.run.id}/cancel?sessionId=${wb.guide}`, { method: 'POST' }), 409);
    assert.equal(refused.error.code, 'hima/run-not-in-state');
    assert.match(refused.error.message, /has no fabric state: HimaFabric never started it, so there is nothing to cancel/, refused.error.message);
    assert.deepEqual(await readRecords(wb, probe.run.id, 'cancel'), [], 'and nothing was written');

    // The route's other conflict, `409 hima/run-not-stopped`, is held by reading `cancelOperation`
    // in `remote.ts` and not asserted here: it needs a `kill-session` that tmux ignores for the whole
    // of the harness's bounded wait, which is a Site state nothing at this seam can ask for (see
    // `support/tmux.ts`, which says the same thing about the state it does put back by hand).

  } finally { await wb.dispose(); }
});

test('normal project cancellation refuses an undisclosed Run before reading its context or writing records', async () => {
  const h = await createHimaHome();
  h.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  let host: BootedHost | undefined;
  try {
    host = await bootHimaHost(h);
    const cookie = await openSession(host);
    const sessionId = await createLiveSession(host, cookie, h.workspace);
    const runsPath = `/hima/api/runs?sessionId=${encodeURIComponent(sessionId)}`;
    const before = await answer<{ runs: unknown[] }>(await api(host, cookie, runsPath), 200);
    assert.deepEqual(before.runs, []);
    const ledgerPath = path.join(h.home, 'storages/hima_ledger.json');
    const ledgerBytes = async () => {
      try { return await readFile(ledgerPath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    };
    const beforeLedger = await ledgerBytes();
    for (const suffix of ['', `?sessionId=${encodeURIComponent(sessionId)}`]) {
      const refused: HimaErrorBody = await answer<HimaErrorBody>(await api(host, cookie, `/hima/api/runs/run-nope/cancel${suffix}`, { method: 'POST' }), 403);
      assert.equal(refused.error.code, 'hima/not-authorized');
      assert.doesNotMatch(refused.error.message, /run-nope|owner|epoch|revision/);
    }
    assert.deepEqual(await ledgerBytes(), beforeLedger, 'a refused cancellation changes no historical records');
    assert.deepEqual(await answer(await api(host, cookie, runsPath), 200), before, 'a refused cancellation creates no current Run');
  } finally {
    if (host) assert.equal(await host.stop(), 0, host.stderr());
    await h.dispose();
  }
});

test('every route the workbench uses sits behind the web app\'s own session cookie', async (t) => {
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
      ['/hima/api/runs/run-x/control', { method: 'POST', body: '{}' }],
    ];
    for (const [target, init] of targets) {
      const res = await fetch(new URL(target, wb.host.url), init);
      const refused: HimaErrorBody = await answer(res, 401);
      assert.equal(refused.error.code, 'hima/not-authorized', `${target} is refused without the session cookie`);
    }

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
        inject: (name, cb) => { assert.ok(['tool.call.toolview', 'sidebar.footer.action', 'sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'sidebar.right.tab.menu.item', 'conversation.session.header.actions', 'settings.section', 'sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark'].includes(name), 'only existing native presentation slots are extended'); return cb(); },
        register: (declaration) => { registered.push({ name: declaration.name, ...('key' in declaration ? { key: declaration.key } : {}), ...('id' in declaration ? { id: declaration.id } : {}) }); return () => undefined; },
      },
    });
    assert.deepEqual(
      registered.filter((r) => r.name === 'tool.call.toolview').map((r) => r.key).sort(),
      ['hima_author', 'hima_context', 'hima_execute', 'hima_insight_analysis', 'hima_observe', 'hima_run'],
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
    for (const state of ['pending', 'retrying', 'blocked', 'cancelled', 'waiting-for-slot', 'reconciled', 'succeeded', 'failed']) {
      assert.ok(source.includes(state), `the module renders the node state "${state}"`);
    }
    for (const piece of ['attempt', 'blocker', 'decision', 'elapsed']) {
      assert.ok(source.includes(piece), `the module labels the ${piece} it shows`);
    }
    assert.doesNotMatch(wb.host.stderr(), /plugin tree failed to load|failed to import|host preparation failed/i, 'no plugin failed to activate');
  } finally { await wb.dispose(); }
});
