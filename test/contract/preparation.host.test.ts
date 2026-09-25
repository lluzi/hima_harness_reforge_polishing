// PLS-31: real Host preparation and Agent tools, with local declarations only. No model, Desktop,
// SSH or EDA tool is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHimaHome } from './support/dsh-home.ts';
import { createRootAgent } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import { installPack, timingProbePackId } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { localFabric } from './support/fabric.ts';
import { applyPackTransfer, clearRemoteCommands, loadPack, packOverview, previewPackTransfer, remoteCommands } from '@hima/harness';
import path from 'node:path';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const jsonOf = (result: { content?: readonly { type: string; text?: string }[] }): Record<string, any> =>
  JSON.parse(result.content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;
const textOf = (result: { content?: readonly { type: string; text?: string }[] }): string =>
  result.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n') ?? '';

test('an explicit reviewed install puts one transparent Pack into an empty product home', async () => {
  const h = await createHimaHome();
  try {
    const from = path.join(process.cwd(), 'packs/custom-cell-fmax-dtco');
    const to = path.join(h.home, 'hima/packs/custom-cell-fmax-dtco');
    const review = previewPackTransfer({ from, to, mode: 'install' });
    assert.ok(review.files.some((file) => file.path === 'contract.yml'));
    assert.ok(review.files.some((file) => file.path === 'knowledge/manifest.yml'));
    applyPackTransfer({ from, to, mode: 'install', reviewSha256: review.reviewSha256 });
    const installed = loadPack(path.dirname(to), 'custom-cell-fmax-dtco');
    assert.equal(packOverview(installed).status?.normalized, 'development');
  } finally { await h.dispose(); }
});

test('start choices do not invent a Pack or Site selection and a concrete selection returns a non-creating proposal', async () => {
  const h = await createHimaHome();
  let host = await bootHimaHost(h);
  try {
    const cookie = await openSession(host);
    const empty = await (await api(host, cookie, '/hima/api/start-options')).json() as Record<string, unknown>;
    assert.deepEqual(empty.packs, []);
    assert.deepEqual(empty.sites, []);
    assert.equal(empty.pack, undefined);
    assert.equal(empty.site, undefined);
  } finally { assert.equal(await host.stop(), 0, host.stderr()); }

  await installPack(h);
  await writeLocalSite(h, { bindings: { flowRoot: h.workspace, design: 'fixture', workspaceRoot: h.workspace }, allowedReadRoots: [h.workspace], allowedWriteRoots: [h.workspace] });
  host = await bootHimaHost(h);
  try {
    const cookie = await openSession(host);
    const choices = await (await api(host, cookie, '/hima/api/start-options')).json() as Record<string, unknown>;
    assert.equal(choices.pack, undefined, 'an installed Pack is an option, not inferred user intent');
    assert.equal(choices.site, undefined, 'a saved Site is an option, not inferred user intent');
    const sessionId = await createLiveSession(host, cookie, h.workspace);
    const selected = await (await api(host, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`)).json() as any;
    assert.equal(selected.proposal.ready, true, JSON.stringify(selected));
    assert.match(selected.proposal.id, /^[a-f0-9]{64}\.[a-f0-9]{32}\.[a-f0-9]{64}$/);
    assert.equal(selected.proposal.pack.id, timingProbePackId);
    assert.ok(selected.proposal.referenceGraph.nodes.length > 0);
    assert.deepEqual((await (await api(host, cookie, `/hima/api/runs?sessionId=${sessionId}`)).json() as { runs: unknown[] }).runs, []);
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await h.dispose(); }
});

test('HimaGuide preparation creates no facts, stale confirmation is refused, and one proposal creates one persistent Run', async (t) => {
  const local = await localFabric(t, { sleepSeconds: 0 });
  if (!local) return;
  const { h, host, flow } = local;
  const siteOptions = { bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace }, allowedReadRoots: [h.workspace, flow.root], allowedWriteRoots: [h.workspace] };
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    clearRemoteCommands();
    const bypass = await host.ctx.tools.execute({ callId: 'unprepared-start' as never, name: 'hima_run', arguments: {
      pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.3 }, strategy: { periodNs: 2.3 },
    }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(bypass.isError, true, JSON.stringify(bypass));
    assert.match(textOf(bypass), /confirm the current Campaign proposal/);
    assert.deepEqual(host.ctx.hima.ledger.runs(), []);
    const preparedAnswer = await host.ctx.tools.execute({ callId: 'prepare-1' as never, name: 'hima_prepare', arguments: { pack: timingProbePackId, site: 'local' }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(preparedAnswer.isError, false, JSON.stringify(preparedAnswer));
    const prepared = jsonOf(preparedAnswer);
    assert.equal(prepared.ready, true, JSON.stringify(prepared));
    assert.deepEqual(host.ctx.hima.ledger.runs(), []);
    assert.deepEqual(remoteCommands(), []);

    await writeLocalSite(h, { ...siteOptions, bindings: { flowRoot: h.workspace, design: 'fixture' } });
    await assert.rejects(() => host.ctx.hima.startRun({ proposalId: prepared.id, pack: timingProbePackId, site: 'local',
      goal: prepared.goal, strategy: prepared.strategy, ownerSessionId: String(agent.id) }), /preparation changed after confirmation/,
    'Fabric rechecks proposal facts against the final Pack and Site snapshots');
    const stale = await host.ctx.tools.execute({ callId: 'stale-confirm' as never, name: 'hima_run', arguments: {
      proposalId: prepared.id, pack: timingProbePackId, site: 'local', goal: prepared.goal, strategy: prepared.strategy,
    }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(stale.isError, true, JSON.stringify(stale));
    assert.match(textOf(stale), /preparation changed|no longer ready/i);
    assert.deepEqual(host.ctx.hima.ledger.runs(), []);

    await writeLocalSite(h, siteOptions);
    const fresh = jsonOf(await host.ctx.tools.execute({ callId: 'prepare-2' as never, name: 'hima_prepare', arguments: { pack: timingProbePackId, site: 'local' }, agent, signal: AbortSignal.timeout(20_000) }));
    const changedGoal = await host.ctx.tools.execute({ callId: 'changed-goal' as never, name: 'hima_run', arguments: {
      proposalId: fresh.id, pack: timingProbePackId, site: 'local', goal: { ...fresh.goal, target_period_ns: 2 }, strategy: fresh.strategy,
    }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(changedGoal.isError, true, JSON.stringify(changedGoal));
    assert.match(textOf(changedGoal), /differs from the reviewed Campaign proposal/);
    const changedBudget = await host.ctx.tools.execute({ callId: 'changed-budget' as never, name: 'hima_run', arguments: {
      proposalId: fresh.id, pack: timingProbePackId, site: 'local', goal: fresh.goal, strategy: fresh.strategy, generations: 1,
    }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(changedBudget.isError, true, JSON.stringify(changedBudget));
    assert.match(textOf(changedBudget), /reviewed Pack budget/);
    const stripped = await host.ctx.tools.execute({ callId: 'stripped-proposal' as never, name: 'hima_run', arguments: {
      proposalId: fresh.id.split('.')[0], pack: timingProbePackId, site: 'local', goal: fresh.goal, strategy: fresh.strategy,
    }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(stripped.isError, true, JSON.stringify(stripped));
    const [facts, _nonce, signature] = fresh.id.split('.');
    const forged = await host.ctx.tools.execute({ callId: 'forged-proposal' as never, name: 'hima_run', arguments: {
      proposalId: `${facts}.${'0'.repeat(32)}.${signature}`, pack: timingProbePackId, site: 'local', goal: fresh.goal, strategy: fresh.strategy,
    }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(forged.isError, true, JSON.stringify(forged));
    const start = () => host.ctx.tools.execute({ callId: `confirm-${crypto.randomUUID()}` as never, name: 'hima_run', arguments: {
      proposalId: fresh.id, pack: timingProbePackId, site: 'local', goal: fresh.goal, strategy: fresh.strategy,
    }, agent, signal: AbortSignal.timeout(20_000) });
    const first = jsonOf(await start());
    assert.match(first.runId, /^run-/);
    const assigned = host.ctx.hima.ledger.run(first.runId)!.control!;
    assert.notEqual(assigned.owner, String(agent.id), 'Guide remains independent from the execution owner');
    assert.equal(assigned.guideSessionId, String(agent.id));
    const paused = await host.ctx.hima.executionAction({ runId: first.runId, actor: String(agent.id), origin: 'human',
      expectedEpoch: assigned.epoch, expectedRevision: assigned.revision, requestId: 'guide-human-pause', action: 'pause' });
    assert.equal(paused.kind, 'accepted');
    const continuation = { runId: first.runId, actor: String(agent.id), expectedEpoch: assigned.epoch,
      expectedRevision: paused.context.run.control!.revision, requestId: 'guide-human-continue', action: 'continue' as const };
    assert.equal((await host.ctx.hima.executionAction({ ...continuation, origin: 'agent' })).kind, 'refused');
    const continued = await host.ctx.hima.executionAction({ ...continuation, origin: 'human' });
    assert.equal(continued.kind, 'accepted');
    assert.equal(continued.context.run.control?.owner, assigned.owner);
    const secondAnswer = await start();
    assert.equal(secondAnswer.isError, false, textOf(secondAnswer));
    const second = jsonOf(secondAnswer);
    assert.equal(second.runId, first.runId);
    assert.equal(host.ctx.hima.ledger.runs().length, 1);
    assert.equal(host.ctx.hima.ledger.runs()[0]?.proposalId, fresh.id);
    const nextProposal = jsonOf(await host.ctx.tools.execute({ callId: 'prepare-next-campaign' as never, name: 'hima_prepare',
      arguments: { pack: timingProbePackId, site: 'local' }, agent, signal: AbortSignal.timeout(20_000) }));
    assert.notEqual(nextProposal.id, fresh.id, 'a new preparation can create a later independent Campaign');
    assert.equal(nextProposal.id.split('.')[0], fresh.id.split('.')[0], 'unchanged preparation facts retain their identity');
    const next = jsonOf(await host.ctx.tools.execute({ callId: 'confirm-next-campaign' as never, name: 'hima_run', arguments: {
      proposalId: nextProposal.id, pack: timingProbePackId, site: 'local', goal: nextProposal.goal, strategy: nextProposal.strategy,
    }, agent, signal: AbortSignal.timeout(20_000) }));
    assert.notEqual(next.runId, first.runId);
    assert.equal(host.ctx.hima.ledger.runs().length, 2);
  } finally { await local.dispose(); }
});
