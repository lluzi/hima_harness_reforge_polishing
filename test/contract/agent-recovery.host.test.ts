// PLS-19: real Host restarts and local Jobs; deterministic protocol calls, no model or Electron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localHome, waitUntil } from './support/fabric.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { timingProbePackId } from './support/pack.ts';
import { tmuxHasSession } from './support/tmux.ts';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import type { InProcessHost } from './support/boot-inprocess.ts';
import type { LocalHome } from './support/fabric.ts';
import { repoRoot } from './support/dsh-home.ts';
import { himaProfileDir, prepareHimaHome } from '../../packages/desktop/src/hima-home.ts';
import { importLegacyLedger, launchJob, type RunRecord, type LedgerRecord } from '@hima/harness';

/** A domain-19 history: Run digest and real workspace.json, but no WorkspaceRecord.packDigest. */
async function historicalPreparedRun(host: InProcessHost, home: LocalHome, options: { missingRunDigest?: boolean; timeBoxMs?: number } = {}) {
  const owner = await createRootAgent(host.ctx, home.h.workspace);
  const prepared = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
  assert.equal(prepared.kind, 'ran');
  if (prepared.kind !== 'ran') throw new Error('fixture could not prepare');
  const begun = await host.ctx.hima.executionAction({ runId: prepared.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'fixture-begin', action: 'begin', nodeId: prepared.run.currentNode });
  await host.ctx.hima.executionAction({ runId: prepared.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'fixture-work', action: 'work', executionId: begun.receipt?.executionId });
  await waitUntil('the historical fixture has a real closed predecessor Job', () => host.ctx.hima.executionContext(prepared.run.id).executions[0]?.phase === 'ready');
  const completed = await host.ctx.hima.executionAction({ runId: prepared.run.id, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 2, requestId: 'fixture-complete', action: 'complete', executionId: begun.receipt?.executionId });
  assert.equal(completed.kind, 'accepted');
  const source = completed.context.run;
  const original = host.ctx.hima.ledger.records({ runId: source.id, type: 'workspace' }).find((record) => record.type === 'workspace');
  assert.ok(original?.type === 'workspace');
  const run = await host.ctx.hima.ledger.createRun({
    campaignId: source.campaignId, siteId: source.siteId, status: 'running', packId: source.packId,
    ...(options.missingRunDigest ? {} : { packDigest: source.packDigest }),
    goal: source.goal, strategy: source.strategy, firstStrategy: source.firstStrategy,
    generation: source.generation, currentNode: source.currentNode,
    budget: { ...source.budget!, timeBoxMs: options.timeBoxMs ?? 60_000 },
    meters: source.meters,
  });
  const { id: _id, type: _type, runId: _runId, siteId: _siteId, seq: _seq, at: _at, writer: _writer, packDigest: _digest, ...workspace } = original;
  const legacyWorkspace = await host.ctx.hima.ledger.appendWorkspace(run.id, workspace);
  for (const record of host.ctx.hima.ledger.records({ runId: source.id })) {
    const { id: _id, type: _type, runId: _runId, siteId: _siteId, seq: _seq, at: _at, writer: _writer, ...data } = record;
    if (record.type === 'job') await host.ctx.hima.ledger.appendJob(run.id, data as Omit<typeof record, 'id' | 'type' | 'runId' | 'siteId' | 'seq' | 'at' | 'writer'>);
    if (record.type === 'node') await host.ctx.hima.ledger.appendNode(run.id, data as Omit<typeof record, 'id' | 'type' | 'runId' | 'siteId' | 'seq' | 'at' | 'writer'>);
  }
  return { run, legacyWorkspace, workspace: prepared.workspace, nodeCount: host.ctx.hima.ledger.records({ runId: run.id, type: 'node' }).length,
    sourceOwnedRunId: source.id, waitNode: host.ctx.hima.executionContext(source.id).nodes.find((node) => node.kind === 'wait')! };
}

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

test('production preparation refuses an unowned Run before any Job or Run is created', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    await assert.rejects(host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, generationLimit: 1 }), /live conversation|owner/);
    assert.equal(host.ctx.hima.ledger.runs().length, 0);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('a historical waiting Run observes its existing Job after restart without treating waiting as cancellation', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  let host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const legacy = await historicalPreparedRun(host, home);
    runId = legacy.run.id;
    const release = path.join(legacy.workspace, 'release-passive');
    const script = path.join(legacy.workspace, 'passive.sh');
    await writeFile(script, `while [ ! -f '${release}' ]; do sleep 0.05; done\n`);
    const launched = await launchJob({ ledger: host.ctx.hima.ledger, sitesDir: path.join(home.h.home, 'hima/sites') }, { run: runId, site: 'local', workspace: legacy.workspace, argv: ['sh', script], name: 'historical-passive', nodeId: 'synthesize', attempt: 2 });
    assert.equal(launched.kind, 'launched');
    if (launched.kind !== 'launched') return;
    const session = launched.record.job.session;
    await host.ctx.hima.ledger.appendNode(runId, { nodeId: 'synthesize', kind: 'act', state: 'running', attempt: 2, jobSession: session });
    await host.ctx.hima.ledger.advanceRun(runId, { status: 'waiting', currentNode: 'synthesize' });
    await host.dispose();
    host = await bootInProcess(home.h);
    await host.ctx.hima.reconciled;
    assert.equal(tmuxHasSession(session), true, 'historical waiting grants no stop request');
    await writeFile(release, 'finish');
    await waitUntil('the original Job is collected while historical waiting stays unchanged', () => host.ctx.hima.ledger.records({ runId: runId!, type: 'node' }).some((record) => record.type === 'node' && record.jobSession === session && record.state === 'done'), 10_000);
    assert.equal(host.ctx.hima.ledger.run(runId)?.status, 'waiting');
    assert.equal(host.ctx.hima.ledger.run(runId)?.control, undefined);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).some((record) => record.type === 'job' && record.event === 'killed'), false);
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});

test('an interrupted completion remains fenced even when its prior Job has a successful exit', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  let host = await bootInProcess(home.h);
  try {
    const fixture = await historicalPreparedRun(host, home);
    const run = host.ctx.hima.ledger.run(fixture.sourceOwnedRunId)!;
    const control = run.control!;
    const execution = Object.values(control.executions)[0]!;
    assert.ok(execution.intent);
    await host.ctx.hima.ledger.advanceRun(run.id, { control: { ...control,
      executions: { [execution.id]: { ...execution, phase: 'uncertain', reason: 'completion admitted; recording its decision and route' } },
      requests: { ...control.requests, 'fixture-complete': { ...control.requests['fixture-complete']!, state: 'admitted' } },
    } });
    const nodesBefore = host.ctx.hima.ledger.records({ runId: run.id, type: 'node' }).length;
    await host.dispose();
    host = await bootInProcess(home.h);
    await host.ctx.hima.reconciled;
    const recovered = host.ctx.hima.executionContext(run.id);
    assert.equal(recovered.executions[0]?.phase, 'uncertain', 'a successful previous Job does not establish whether routing committed');
    assert.equal(recovered.run.control?.requests['fixture-complete']?.state, 'uncertain');
    assert.equal(recovered.run.currentNode, run.currentNode);
    assert.equal(host.ctx.hima.ledger.records({ runId: run.id, type: 'node' }).length, nodesBefore);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('adoption refuses missing method identity, changed input metadata and an interrupted boundary without a confirmed Job', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const missing = await historicalPreparedRun(host, home, { missingRunDigest: true });
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const request = { actor: String(owner.id), expectedEpoch: 0, expectedRevision: 0, requestId: 'refuse-adoption', action: 'adopt' as const };
    const refused = await host.ctx.hima.executionAction({ ...request, runId: missing.run.id });
    assert.equal(refused.kind, 'refused');
    assert.match(refused.reason ?? '', /original Run method digest is missing/);
    const changed = await historicalPreparedRun(host, home);
    const file = path.join(changed.workspace, 'workspace.json');
    const content = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...content, design: 'another-design' }));
    const mismatch = await host.ctx.hima.executionAction({ ...request, runId: changed.run.id });
    assert.equal(mismatch.kind, 'refused');
    assert.match(mismatch.reason ?? '', /workspace\/input metadata|input bindings/);
    await writeFile(file, JSON.stringify(content));
    await host.ctx.hima.ledger.appendNode(changed.run.id, { nodeId: changed.run.currentNode!, kind: 'act', attempt: 1, state: 'blocked', reason: 'Host interrupted while starting tool; no launch receipt' });
    const uncertain = await host.ctx.hima.executionAction({ ...request, runId: changed.run.id });
    assert.equal(uncertain.kind, 'refused');
    assert.match(uncertain.reason ?? '', /absence of a launch receipt cannot prove no effect/);
    assert.equal(host.ctx.hima.ledger.run(missing.run.id)?.control, undefined);
    assert.equal(host.ctx.hima.ledger.run(changed.run.id)?.control, undefined);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('adoption carries an open historical human wait once and new pauses continue to spend the original time box', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  const host = await bootInProcess(home.h);
  try {
    const legacy = await historicalPreparedRun(host, home, { timeBoxMs: 2000 });
    const runId = legacy.run.id;
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    await waitUntil('old active work has spent part of the box', () => Date.now() - Date.parse(legacy.run.createdAt) >= 250, 1000, 25);
    const blocker = await host.ctx.hima.ledger.appendBlocker(runId, { nodeId: legacy.run.currentNode!, attempts: 1, reason: 'human input is required at the verified boundary' });
    await host.ctx.hima.ledger.appendNode(runId, { nodeId: legacy.waitNode.id, kind: 'wait', state: 'blocked', attempt: 1, reason: 'waiting for the engineer' });
    await host.ctx.hima.ledger.advanceRun(runId, { status: 'waiting', currentNode: legacy.waitNode.id });
    await waitUntil('the old human wait has duration', () => Date.now() - Date.parse(blocker.at) >= 250, 1000, 25);
    const request = { runId, actor: String(owner.id), expectedEpoch: 0, expectedRevision: 0, requestId: 'adopt-budget', action: 'adopt' as const };
    const adopted = await host.ctx.hima.executionAction(request);
    assert.equal(adopted.kind, 'accepted', adopted.reason);
    const offset = adopted.context.run.control?.adoption?.legacyWaitedMs;
    assert.ok(offset !== undefined && offset >= 250);
    assert.equal(adopted.context.run.createdAt, legacy.run.createdAt);
    assert.deepEqual(adopted.context.run.budget, legacy.run.budget);
    assert.equal(adopted.context.run.meters?.jobsLaunched, legacy.run.meters?.jobsLaunched);
    const deadline = Date.parse(legacy.run.createdAt) + 2000 + offset;
    await waitUntil('the original time box expires while the newly owned Run stays paused', () => Date.now() >= deadline + 5, 3000, 25);
    const continued = await host.ctx.hima.executionAction({ ...request, expectedEpoch: 1, expectedRevision: 1, requestId: 'continue-expired', action: 'continue', origin: 'human' });
    assert.equal(continued.kind, 'refused');
    await waitUntil('the adopted Run ends at its carried deadline without an Agent action', () => host.ctx.hima.executionContext(runId).run.status === 'ended-budget-exhausted', 5000);
    const ended = host.ctx.hima.executionContext(runId).run;
    assert.equal(ended.meters?.endedBy, 'time-box');
    assert.equal(ended.control?.adoption?.legacyWaitedMs, offset, 'new pauses never enlarge the carried historical offset');
    assert.deepEqual(ended.budget, legacy.run.budget);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('historical Runs keep their node boundary on restart and explicit adoption verifies v19 metadata without inventing history', async (t) => {
  const home = await localHome(t);
  assert.ok(home);
  let host = await bootInProcess(home.h);
  try {
    const legacy = await historicalPreparedRun(host, home);
    await host.dispose();
    const persisted = JSON.parse(await readFile(path.join(home.h.home, 'storages/hima_ledger.json'), 'utf8')) as { unit: { name: string; version: number }; global: null; tables: { runs: Record<string, RunRecord>; records: Record<string, LedgerRecord> } };
    persisted.unit.version = 19;
    persisted.tables.runs = { [legacy.run.id]: persisted.tables.runs[legacy.run.id]! };
    persisted.tables.records = Object.fromEntries(Object.entries(persisted.tables.records).filter(([, record]) => record.runId === legacy.run.id));
    const sourceFile = path.join(home.h.home, 'offline-v19.json');
    const original = `${JSON.stringify(persisted, null, 2)}\n`;
    await writeFile(sourceFile, original);
    const target = path.join(home.h.home, 'imported-home');
    const receipt = await importLegacyLedger({ sourceFile, home: target });
    assert.equal(receipt.ownership, 'unchanged-unowned');
    await prepareHimaHome({ home: target, root: repoRoot });
    await cp(path.join(home.h.home, 'hima'), path.join(target, 'hima'), { recursive: true });
    const importedHome = { ...home.h, home: target, profileDir: himaProfileDir(target), env: { ...home.h.env, DSH_HOME: target, DSH_AGENTS_HOME: path.join(target, 'agents') } };
    host = await bootInProcess(importedHome);
    await host.ctx.hima.reconciled;
    const held = host.ctx.hima.ledger.run(legacy.run.id)!;
    assert.equal(held.status, 'running');
    assert.equal(held.currentNode, legacy.run.currentNode);
    assert.equal(held.control, undefined);
    assert.equal(host.ctx.hima.ledger.records({ runId: held.id, type: 'node' }).length, legacy.nodeCount, 'restart does not invent a historical blocker or launch');
    assert.equal((await host.ctx.hima.resumeRun(held.id, 'operator')).kind, 'unresumable');
    const metadataPath = path.join(legacy.workspace, 'workspace.json');
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    delete metadata.pack.digest;
    await writeFile(metadataPath, JSON.stringify(metadata));
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const request = { runId: held.id, actor: String(owner.id), expectedEpoch: 0, expectedRevision: 0, requestId: 'adopt-v19', action: 'adopt' as const };
    const adopted = await host.ctx.hima.executionAction(request);
    assert.equal(adopted.kind, 'accepted', adopted.reason);
    assert.equal(adopted.context.run.control?.owner, String(owner.id));
    assert.deepEqual(adopted.context.run.control?.paused, ['*']);
    assert.deepEqual(adopted.context.available, []);
    assert.deepEqual(adopted.context.run.goal, legacy.run.goal);
    assert.deepEqual(adopted.context.run.budget, legacy.run.budget);
    assert.deepEqual(adopted.context.run.strategy, legacy.run.strategy);
    assert.equal(adopted.context.run.generation, legacy.run.generation);
    assert.equal(adopted.context.run.meters?.jobsLaunched, legacy.run.meters?.jobsLaunched);
    assert.equal(adopted.context.run.meters?.attempts, legacy.run.meters?.attempts);
    assert.deepEqual(host.ctx.hima.ledger.records({ runId: held.id, type: 'workspace' }), [legacy.legacyWorkspace], 'old workspace record stays byte-for-byte factual');
    assert.equal((await host.ctx.hima.executionAction(request)).kind, 'duplicate');
    const resumed = await host.ctx.hima.executionAction({ ...request, expectedEpoch: 1, expectedRevision: 1, requestId: 'continue-adopted', action: 'continue' });
    assert.equal(resumed.kind, 'accepted');
    const begun = await host.ctx.hima.executionAction({ ...request, expectedEpoch: 1, expectedRevision: 2, requestId: 'begin-adopted', action: 'begin', nodeId: held.currentNode });
    assert.equal(begun.kind, 'accepted');
    const worked = await host.ctx.hima.executionAction({ ...request, expectedEpoch: 1, expectedRevision: 3, requestId: 'work-adopted', action: 'work', executionId: begun.receipt?.executionId });
    assert.equal(worked.kind, 'accepted');
    assert.equal(worked.reason, undefined, 'new execution accepts verified historical WorkspaceRecord identity');
    assert.equal(await readFile(sourceFile, 'utf8'), original, 'the imported v19 source is unchanged');
    await host.ctx.hima.cancelRun(held.id);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('an interrupted admitted request stays uncertain after restart and does not free its Site or replay', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0.01 });
  assert.ok(home);
  let host = await bootInProcess(home.h);
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    const runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'begin-uncertain', action: 'begin', nodeId: started.run.currentNode });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    const run = begun.context.run;
    const execution = run.control!.executions[executionId]!;
    const session = `hima-uncertain-${randomUUID()}`;
    // Persist the exact on-disk crash boundary: admission + launch intent, no actual launch receipt.
    await host.ctx.hima.ledger.advanceRun(runId, { control: { ...run.control!, revision: 2,
      executions: { [executionId]: { ...execution, phase: 'working', intent: {
        runId, siteId: 'local', nodeId: execution.nodeId, attempt: execution.attempt,
        job: { session, workspace: started.workspace, name: 'unknown', startedAt: new Date().toISOString(), wire: 'interrupted launch; no response was received' },
      } } },
      requests: { ...run.control!.requests, 'unconfirmed-work': { digest: 'a'.repeat(64), actor: String(owner.id), epoch: 1, revision: 1, at: new Date().toISOString(), state: 'admitted', receipt: { requestId: 'unconfirmed-work', action: 'work', executionId } } },
    } });
    await host.dispose();
    host = await bootInProcess(home.h);
    const outcomes = await host.ctx.hima.reconciled;
    assert.equal(outcomes.find((item) => item.runId === runId)?.found, 'uncertain');
    const context = host.ctx.hima.executionContext(runId);
    assert.equal(context.executions[0]?.phase, 'uncertain');
    assert.equal(context.run.control?.requests['unconfirmed-work']?.state, 'uncertain');
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
    assert.equal((await host.ctx.hima.cancelRun(runId)).kind, 'not-stopped', 'an unconfirmed launch cannot be advertised as stopped');
    const nextOwner = await createRootAgent(host.ctx, home.h.workspace);
    const next = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(nextOwner.id) });
    assert.equal(next.kind, 'ran');
    if (next.kind !== 'ran') return;
    const nextBegin = await host.ctx.hima.executionAction({ runId: next.run.id, actor: String(nextOwner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'next-begin', action: 'begin', nodeId: next.run.currentNode });
    const answer = await host.ctx.hima.executionAction({ runId: next.run.id, actor: String(nextOwner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'next-work', action: 'work', executionId: nextBegin.receipt?.executionId });
    assert.match(answer.reason ?? '', /unresolved launch/);
    assert.equal(host.ctx.hima.ledger.records({ runId: next.run.id, type: 'job' }).length, 0);
  } finally { await host.dispose(); await home.h.dispose(); }
});

test('a restarted Host observes the exact Job after its launch receipt was lost and never chooses the next node', async (t) => {
  const home = await localHome(t, { sleepSeconds: 4 });
  assert.ok(home);
  let host = await bootInProcess(home.h);
  let runId: string | undefined;
  try {
    const owner = await createRootAgent(host.ctx, home.h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2 }, ownerSessionId: String(owner.id) });
    assert.equal(started.kind, 'ran');
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    const begun = await host.ctx.hima.executionAction({ runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 0, requestId: 'begin-recover', action: 'begin', nodeId: started.run.currentNode });
    const executionId = begun.receipt?.executionId;
    assert.ok(executionId);
    const work = { runId, actor: String(owner.id), expectedEpoch: 1, expectedRevision: 1, requestId: 'work-lost-receipt', action: 'work' as const, executionId };
    // Inject only the post-launch storage failure. Intent, Host, actual Job and reopened Ledger are real.
    const appendJob = host.ctx.hima.ledger.appendJob.bind(host.ctx.hima.ledger);
    host.ctx.hima.ledger.appendJob = async (...args) => {
      if (args[1].event === 'launched') throw new Error('test storage failure after actual launch');
      return appendJob(...args);
    };
    const admitted = await host.ctx.hima.executionAction(work);
    host.ctx.hima.ledger.appendJob = appendJob;
    assert.equal(admitted.kind, 'accepted');
    const execution = admitted.context.executions.find((item) => item.id === executionId)!;
    assert.ok(execution.intent);
    assert.equal(execution.phase, 'uncertain');
    assert.equal(tmuxHasSession(execution.intent.job.session), true);
    assert.equal(host.ctx.hima.ledger.records({ runId, type: 'job' }).length, 0);
    await host.dispose();
    host = await bootInProcess(home.h);
    await host.ctx.hima.reconciled;
    assert.equal(host.ctx.get('agents')?.list().length, 0, 'recovery creates no hidden Agent');
    await waitUntil('the second Host records the existing Job result', () => host.ctx.hima.executionContext(runId!).executions.some((item) => item.id === executionId && item.phase === 'ready'), 10_000);
    const context = host.ctx.hima.executionContext(runId);
    assert.equal(context.run.currentNode, started.run.currentNode);
    assert.equal(context.run.control?.owner, String(owner.id));
    assert.equal(context.run.control?.requests['work-lost-receipt']?.state, 'done');
    const launches = host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((item) => item.type === 'job' && item.event === 'launched');
    assert.equal(launches.length, 1);
    assert.equal(context.run.meters?.jobsLaunched, 1, 'a launch whose receipt was lost still spends one Job from the Campaign');
    assert.equal(launches[0]?.type === 'job' && launches[0].job.session, execution.intent.job.session);
    assert.equal((await host.ctx.hima.executionAction(work)).kind, 'refused', 'offline owner cannot start more work');
    assert.equal((await host.ctx.hima.cancelRun(runId)).kind, 'cancelled', 'query and cancellation remain available with no model online');
  } finally {
    if (runId) await host.ctx.hima.cancelRun(runId);
    await host.dispose(); await home.h.dispose();
  }
});
