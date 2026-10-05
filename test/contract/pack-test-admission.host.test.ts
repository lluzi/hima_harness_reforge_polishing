// #60: a confirmed proposal may open the real TEST Run of an unreleased Pack, but may never
// relabel a sealed customer release.  Hold Fabric, the agent tool and the HTTP route to that one
// admission rule; no model, Desktop, SSH or EDA process is involved.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { himaCommand } from './support/command.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import { packsDirOf, timingProbePackId, versionFileFor, writePackFiles, writePackVariant } from './support/pack.ts';
import { HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS } from '@hima/harness';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const textOf = (result: { content?: readonly { type: string; text?: string }[] }): string =>
  result.content?.filter((item) => item.type === 'text').map((item) => item.text ?? '').join('\n') ?? '';
const jsonOf = (result: { content?: readonly { type: string; text?: string }[] }): Record<string, any> =>
  JSON.parse(result.content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;

async function prepare(host: Awaited<ReturnType<typeof bootInProcess>>, agent: Awaited<ReturnType<typeof createRootAgent>>, pack: string): Promise<Record<string, any>> {
  const result = await host.ctx.tools.execute({ name: 'hima_prepare', callId: `pack-test-admission-prepare-${pack}` as never,
    arguments: { pack, site: 'local' }, agent, signal: AbortSignal.timeout(20_000) });
  assert.equal(result.isError, false, JSON.stringify(result));
  const proposal = jsonOf(result);
  assert.equal(proposal.ready, true, JSON.stringify(proposal));
  return proposal;
}

/** Make a sealed sibling only for the negative admission edge.  Its stage data is valid but does
 * not claim a real local test: preparation checks method/Site fitness, whereas release itself
 * independently requires the named TEST Run to exist in the author's ledger. */
async function installSealedSibling(packsDir: string): Promise<string> {
  const id = 'sealed-test-admission';
  await writePackVariant(packsDir, id, [], []);
  const folder = path.join(packsDir, id);
  const record = (sections: readonly string[], run?: string): string => sections.map((section) =>
    `## ${section}\n\n${section === 'Run' ? `run: ${run}` : 'recorded by the authoring pipeline'}\n`).join('\n');
  const run = `run-${randomUUID()}`;
  await writePackFiles(folder, {
    'INTENT.md': record(HIMA_INTENT_SECTIONS),
    'SPEC.md': record(HIMA_SPEC_SECTIONS),
    'FABRIC.md': record(HIMA_FABRIC_SECTIONS),
    'TEST.md': record(HIMA_TEST_SECTIONS, run),
  });
  await writePackFiles(folder, { 'VERSION.yml': versionFileFor(folder, { pack: id, version: '2', run }) });
  return id;
}

test('confirmed Pack TEST admission is consistent across Fabric, hima_run and HTTP, while released Packs stay refused', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const { h } = home;
  const releasedPack = await installSealedSibling(packsDirOf(h));
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    const proposal = await prepare(host, agent, timingProbePackId);
    const direct = await host.ctx.hima.startRun({ ownerSessionId: String(agent.id), proposalId: proposal.id, pack: timingProbePackId, site: 'local',
      goal: proposal.goal, strategy: proposal.strategy, test: true });
    assert.ok(direct.kind === 'preparing' || direct.kind === 'ran', JSON.stringify(direct));
    if (direct.kind !== 'preparing' && direct.kind !== 'ran') throw new Error('Run admission failed');
    await waitUntil('the TEST Run is prepared', async () => {
      const context = await host.ctx.hima.readExecutionContext(direct.run.id);
      return ['prepared', 'reused'].includes(context.durable?.preparation?.kind ?? '');
    });
    assert.equal((await host.ctx.hima.readExecutionContext(direct.run.id)).run.purpose, 'test', 'Fabric preserves the confirmed TEST purpose in current facts');

    const prepared = await prepare(host, agent, timingProbePackId);
    const throughTool = await host.ctx.tools.execute({ name: 'hima_run', callId: 'pack-test-admission-run' as never,
      arguments: { proposalId: prepared.id, pack: timingProbePackId, site: 'local', goal: prepared.goal,
        strategy: prepared.strategy, test: true }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(throughTool.isError, false, textOf(throughTool));
    assert.equal((await host.ctx.hima.readExecutionContext(jsonOf(throughTool).runId)).run.purpose, 'test', 'hima_run reaches the same Fabric admission');

    const released = await prepare(host, agent, releasedPack);
    const releasedThroughTool = await host.ctx.tools.execute({ name: 'hima_run', callId: 'sealed-pack-test-admission-run' as never,
      arguments: { proposalId: released.id, pack: releasedPack, site: 'local', goal: released.goal,
        strategy: released.strategy, test: true }, agent, signal: AbortSignal.timeout(20_000) });
    assert.equal(releasedThroughTool.isError, true);
    assert.match(textOf(releasedThroughTool), /confirmed released product Campaign cannot be changed into a Pack test/);
    await assert.rejects(host.ctx.hima.startRun({ ownerSessionId: String(agent.id), proposalId: released.id, pack: releasedPack, site: 'local',
      goal: released.goal, strategy: released.strategy, test: true }), /confirmed released product Campaign cannot be changed into a Pack test/);
  } finally {
    await host.dispose();
  }

  const web = await bootHimaHost(h);
  try {
    const cookie = await openSession(web);
    const sessionId = await createLiveSession(web, cookie, h.workspace);
    const prepared = await (await api(web, cookie, `/hima/api/start-options?pack=${timingProbePackId}&site=local`)).json() as any;
    assert.equal(prepared.proposal.ready, true, JSON.stringify(prepared));
    const started = await api(web, cookie, '/hima/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sessionId, proposalId: prepared.proposal.id, pack: timingProbePackId, site: 'local', goal: prepared.proposal.goal,
      strategy: prepared.proposal.strategy, test: true,
    }) });
    assert.equal(started.status, 200, await started.clone().text());
    const body = await started.json() as any;
    assert.equal(body.run.purpose, 'test', 'HTTP reaches the same confirmed Pack TEST admission');

    const sealed = await (await api(web, cookie, `/hima/api/start-options?pack=${releasedPack}&site=local`)).json() as any;
    assert.equal(sealed.proposal.ready, true, JSON.stringify(sealed));
    const refused = await api(web, cookie, '/hima/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      sessionId, proposalId: sealed.proposal.id, pack: releasedPack, site: 'local', goal: sealed.proposal.goal,
      strategy: sealed.proposal.strategy, test: true,
    }) });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /confirmed released product Campaign cannot be changed into a Pack test/);
  } finally {
    assert.equal(await web.stop(), 0, web.stderr());
    await h.dispose();
  }
});

test('Pack check reads a normally ended DBOS TEST Run and refuses a false Ending before sealing', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  assert.ok(home);
  const { h } = home;
  const folder = path.join(packsDirOf(h), timingProbePackId);
  const record = (sections: readonly string[]): string => sections.map(section =>
    `## ${section}\n\nLocal stand-in mechanism evidence; no EDA or model claim.\n`).join('\n');
  await writePackFiles(folder, { 'INTENT.md': record(HIMA_INTENT_SECTIONS),
    'SPEC.md': record(HIMA_SPEC_SECTIONS), 'FABRIC.md': record(HIMA_FABRIC_SECTIONS) });
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined = await bootInProcess(h);
  try {
    const owner = await createRootAgent(host.ctx, h.workspace);
    const started = await host.ctx.hima.startRun({ pack: timingProbePackId, site: 'local',
      goal: { target_period_ns: 0.1 }, strategy: { periodNs: 2.2 }, generationLimit: 1,
      test: true, ownerSessionId: String(owner.id) });
    assert.ok(started.kind === 'preparing' || started.kind === 'ran', JSON.stringify(started));
    if (started.kind !== 'preparing' && started.kind !== 'ran') throw new Error('TEST Run admission failed');
    const runId = started.run.id;
    await waitUntil('the actual DBOS TEST Run ends', async () =>
      (await host!.ctx.hima.readExecutionContext(runId)).run.status?.startsWith('ended-') === true, 20_000, 25);
    const context = await host.ctx.hima.readExecutionContext(runId);
    assert.equal(context.run.purpose, 'test');
    assert.equal(context.run.status, 'ended-goal-not-met');
    assert.equal((context.run as typeof context.run & { goalState: string }).goalState, 'not-met');
    const testRecord = (ending: string): string => HIMA_TEST_SECTIONS.map(section =>
      `## ${section}\n\n${({ Run: `run: ${runId}`, Ending: `status: ${ending}`, Code: 'none', Refusals: 'none' } as Record<string, string>)[section] ?? 'Local stand-in mechanism test.'}\n`).join('\n');
    await writePackFiles(folder, { 'TEST.md': testRecord('ended-goal-not-met') });
    const checked = jsonOf(await host.ctx.tools.execute({ name: 'hima_pack_check',
      callId: 'dbos-test-pack-check' as never, arguments: { pack: timingProbePackId, site: 'local' },
      agent: owner, signal: AbortSignal.timeout(5000) }));
    assert.equal(checked.stage, 'tested', JSON.stringify(checked));
    assert.equal(checked.fit, true, JSON.stringify(checked));
    assert.match(checked.text, /ended ended-goal-not-met/);
    const command = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    assert.equal(command.kind, 'success', command.text);
    assert.match(command.text, /stage: tested/);
    // Reopening the same Home must read the retained PG facts, with no Run recreation.
    await host.dispose(); host = undefined;
    host = await bootInProcess(h);
    const author = await createRootAgent(host.ctx, h.workspace);
    const execute = async (name: string) => host!.ctx.tools.execute({ name,
      callId: `dbos-reopened-${name}` as never, arguments: name === 'hima_pack_check'
        ? { pack: timingProbePackId, site: 'local' } : { pack: timingProbePackId },
      agent: author, signal: AbortSignal.timeout(5000) });
    assert.equal(jsonOf(await execute('hima_pack_check')).stage, 'tested');
    await writePackFiles(folder, { 'TEST.md': testRecord('ended-goal-met') });
    const falseEnding = jsonOf(await execute('hima_pack_check'));
    assert.equal(falseEnding.stage, 'compiled');
    assert.equal(falseEnding.fit, false);
    assert.match(falseEnding.issue, /says status: ended-goal-met and run .* ended ended-goal-not-met/);
    const refused = await execute('hima_pack_release');
    assert.equal(jsonOf(refused).kind, 'refused', textOf(refused));
    assert.match(textOf(refused), /says status: ended-goal-met and run .* ended ended-goal-not-met/);
    await assert.rejects(access(path.join(folder, 'VERSION.yml')), /ENOENT/);
    await writePackFiles(folder, { 'TEST.md': testRecord('ended-goal-not-met') });
    const released = await execute('hima_pack_release');
    assert.equal(released.isError, false, textOf(released));
    assert.equal(jsonOf(released).kind, 'released', textOf(released));
    const sealed = jsonOf(await execute('hima_pack_check'));
    assert.equal(sealed.stage, 'released', JSON.stringify(sealed));
    assert.equal(sealed.fit, true, JSON.stringify(sealed));
    t.diagnostic(JSON.stringify({ runId, purpose: context.run.purpose, status: context.run.status,
      methodDigest: context.run.packDigest, engine: context.engine }));
  } finally { await host?.dispose(); await h.dispose(); }
});
