// #41 task 3: the Campaign file (`hima/campaign.yml`) is the unified configuration — a route reads
// and writes it, Preparation accepts its overrides, readiness never fills a Goal from a default, the
// start route can confirm straight from it, and both hima_* tools apply it. Real Host (a subprocess
// for the HTTP routes, an in-process host for the tools) and local files only; no model, Desktop or
// SSH is started.
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { installPack, packsDirOf, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
// The generator directly, beside the test wrapper: an input override of `design` (#41 task 3) must
// name a design the stand-in flow can actually build, or `prepareWorkspace`'s copy of `build/${design}`
// and `sources/${design}` has nothing to copy. A second call onto the same root adds a second design's
// directories beside the site's own bound one, so an override has something real to point at.
import { writeStandinFlow as generateStandinDesign } from '../../packages/desktop/src/local-site.ts';
import { loadSite } from '@hima/harness';
import { waitUntil } from './support/fabric.ts';
import { CAMPAIGN_SCHEMA, writeCampaignFile } from '@hima/harness';

const { resolveDurableTaskAdapter } = await import(new URL('../../packages/harness/lib/durable-task-adapters.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/durable-task-adapters.js');
const { reconnectRetainedJob } = await import(new URL('../../packages/harness/lib/jobs.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/jobs.js');

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

/** A pack variant of the shipped timing probe that declares its own Budget time box, so a case can
 *  tell "this preparation's number came from the Pack" apart from "from this Harness's own default"
 *  without every other suite's fixture having to know this pack declares one. Otherwise identical:
 *  same inputs, same declared Goal and words, same graph. */
const campaignFilePackId = 'campaign-file-probe';

async function installCampaignFilePack(h: HimaHome): Promise<void> {
  await installPack(h);
  await writePackVariant(packsDirOf(h), campaignFilePackId, [["version: '2'", "version: '2'\nbudget:\n  timeBoxMs: 300000"]]);
}

interface Fixture { readonly h: HimaHome; readonly host: BootedHost; readonly cookie: string; readonly sessionId: string; readonly flowRoot: string }

/** A second design's own `build/`/`sources/`/`flows/` directories, generated onto an existing flow
 *  root beside the Site's own bound design (#41 task 3): a `design` input override must name
 *  something `prepareWorkspace`'s copy can actually find, so a test of that override generates one. */
async function addOverrideDesign(flowRoot: string, design: string): Promise<void> {
  await generateStandinDesign({ root: flowRoot, design });
}

/** A real subprocess Host, with the shipped Pack (varied for a declared Budget) and a local Site
 *  installed, and one live session whose Agent stands in the isolated home's own workspace — reached
 *  through dsh's own public `session/create` Host RPC, so this fixture needs no Electron window and
 *  no native folder picker to give a session a real, live cwd. */
async function bootedFixture(t: TestContext): Promise<Fixture> {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, {});
  assert.ok(flow, 'the stand-in flow is written');
  await installCampaignFilePack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow!.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace },
  });
  const host = await bootHimaHost(h);
  const cookie = await openSession(host);
  const sessionId = await createLiveSession(host, cookie, h.workspace);
  return { h, host, cookie, sessionId, flowRoot: flow!.root };
}

async function teardown(f: Pick<Fixture, 'h' | 'host'>): Promise<void> {
  assert.equal(await f.host.stop(), 0, f.host.stderr());
  await f.h.dispose();
}

const campaignPath = '/hima/api/campaign';

function putCampaign(f: Fixture, file: Record<string, unknown>): Promise<Response> {
  return api(f.host, f.cookie, campaignPath, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: f.sessionId, file }),
  });
}

function getCampaign(f: Fixture): Promise<Response> {
  return api(f.host, f.cookie, `${campaignPath}?session=${encodeURIComponent(f.sessionId)}`);
}

/** The proposal token's own recomputable facts prefix (the first `.`-separated segment): what two
 *  preparations of different facts must differ on, and what a stale confirmation is compared by. */
const factsOf = (proposalId: string): string => proposalId.split('.')[0]!;

test('Case 1: a fresh workspace has no Campaign file yet, and the route answers the empty document', async (t) => {
  const f = await bootedFixture(t);
  try {
    const res = await getCampaign(f);
    const view = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(view));
    assert.equal(view.exists, false);
    assert.equal(view.file.schema, 'hima-campaign/1');
    assert.deepEqual(view.file.inputs, {});
  } finally { await teardown(f); }
});

test('Case 2: PUT with a Pack and Site but no Goal is not ready, and names the missing Goal by its own label', async (t) => {
  const f = await bootedFixture(t);
  try {
    const res = await putCampaign(f, { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' } });
    const view = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(view));
    const proposal = view.preparation.proposal;
    assert.equal(proposal.ready, false, JSON.stringify(proposal));
    assert.ok(proposal.unknowns.some((line: string) => /clock period at most is not set\.$/.test(line)), JSON.stringify(proposal.unknowns));
    assert.equal(proposal.budget.timeBoxMinutes.source, 'pack', JSON.stringify(proposal.budget));
  } finally { await teardown(f); }
});

test('Case 3: PUT with a Goal is ready, and its proposal facts differ from a preparation with no Goal', async (t) => {
  const f = await bootedFixture(t);
  try {
    const withoutGoal = await (await putCampaign(f, { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' } })).json() as any;
    const withGoal = await (await putCampaign(f, { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, goal: { target_period_ns: 2.3 } })).json() as any;
    assert.equal(withGoal.preparation.proposal.ready, true, JSON.stringify(withGoal.preparation.proposal));
    assert.notEqual(factsOf(withGoal.preparation.proposal.id), factsOf(withoutGoal.preparation.proposal.id));
  } finally { await teardown(f); }
});

test('Case 4: a hand-written Campaign file on disk (the HimaGuide path) is picked up fresh, newer and with its input override applied', async (t) => {
  const f = await bootedFixture(t);
  try {
    await addOverrideDesign(f.flowRoot, 'guide');
    const before = await (await putCampaign(f, { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, goal: { target_period_ns: 2.3 } })).json() as any;
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeCampaignFile(f.h.workspace, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      inputs: { design: 'guide' }, goal: { target_period_ns: 2.3 }, strategy: {}, budget: {}, knowledge: [], notes: '',
    });
    const after = await (await getCampaign(f)).json() as any;
    assert.ok(after.mtimeMs > before.mtimeMs, `${String(after.mtimeMs)} should be newer than ${String(before.mtimeMs)}`);
    const designRow = after.preparation.proposal.inputs.find((row: any) => row.name === 'design');
    assert.ok(designRow, JSON.stringify(after.preparation.proposal.inputs));
    assert.equal(designRow.value, 'guide');
    assert.equal(designRow.source, 'file');
  } finally { await teardown(f); }
});

test('Case 5: POST /hima/api/runs/start confirms straight from the Campaign file, and the workspace record binds the overridden input', async (t) => {
  const f = await bootedFixture(t);
  try {
    await addOverrideDesign(f.flowRoot, 'guide');
    const prepared = await (await putCampaign(f, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      inputs: { design: 'guide' }, goal: { target_period_ns: 2.3 },
    })).json() as any;
    assert.equal(prepared.preparation.proposal.ready, true, JSON.stringify(prepared.preparation.proposal));
    const proposalId = prepared.preparation.proposal.id;
    const res = await api(f.host, f.cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromCampaignFile: true, sessionId: f.sessionId, pack: campaignFilePackId, site: 'local', proposalId }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.run.goal.target_period_ns, 2.3, JSON.stringify(body.run.goal));
    assert.equal(body.run.engine, 'dbos/5.2.11');
    let view: any;
    await waitUntil('the public prepared workspace binding', async () => {
      const response = await api(f.host, f.cookie, `/hima/api/runs/${body.run.id}?sessionId=${f.sessionId}`);
      assert.equal(response.status, 200);
      view = await response.json();
      return view.workspace?.bindings?.design === 'guide';
    }, 30_000, 25);
    assert.equal(view.workspace.bindings.design, 'guide');
    assert.notEqual(view.run.control?.owner, f.sessionId);
    assert.equal(view.run.control?.guideSessionId, f.sessionId);
    const records = await (await api(f.host, f.cookie, `/hima/api/runs/${body.run.id}/records?type=workspace&sessionId=${f.sessionId}`)).json() as any;
    const workspaceRecord = (records.records ?? records).find((r: any) => r.type === 'workspace');
    assert.ok(workspaceRecord, JSON.stringify(records));
    assert.equal(workspaceRecord.design, 'guide');
  } finally { await teardown(f); }
});

test('Case 6: editing the Goal after confirming refuses a second start with the now-stale proposalId', async (t) => {
  const f = await bootedFixture(t);
  try {
    const prepared = await (await putCampaign(f, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, goal: { target_period_ns: 2.3 },
    })).json() as any;
    const proposalId = prepared.preparation.proposal.id;
    assert.equal(prepared.preparation.proposal.ready, true, JSON.stringify(prepared.preparation.proposal));
    await putCampaign(f, { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, goal: { target_period_ns: 2.5 } });
    const res = await api(f.host, f.cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromCampaignFile: true, sessionId: f.sessionId, pack: campaignFilePackId, site: 'local', proposalId }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 400, JSON.stringify(body));
  } finally { await teardown(f); }
});

// Case 7 exercises the tools rather than the routes: an in-process host (no web app, no subprocess)
// with a real conversational Agent standing in the isolated home's own workspace.

interface ToolResult { readonly isError: boolean; readonly content: readonly { readonly type: string; readonly text?: string }[] }
const jsonOf = (result: ToolResult): Record<string, any> =>
  JSON.parse(result.content.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;

async function preparedContext(host: InProcessHost, runId: string) {
  await waitUntil('the public durable preparation fact', async () => {
    const context = await host.ctx.hima.readExecutionContext(runId);
    return ['prepared', 'reused'].includes(context.durable?.preparation?.kind ?? '');
  }, 30_000, 25);
  return host.ctx.hima.readExecutionContext(runId);
}

test('Case 7: hima_prepare applies this Agent workspace\'s own Campaign file by default, and can be told not to', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, {});
  assert.ok(flow, 'the stand-in flow is written');
  await installCampaignFilePack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow!.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace },
  });
  const host: InProcessHost = await bootInProcess(h);
  try {
    // A Goal the Pack's own legacy default (2.3, `legacyPeriodGoal`) does not already answer, so
    // `file: false` genuinely ignoring the file is visible in the numbers this call answers rather
    // than only in its own `campaignFile.applied` flag.
    writeCampaignFile(h.workspace, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      inputs: {}, goal: { target_period_ns: 3.1 }, strategy: {}, budget: {}, knowledge: [], notes: '',
    });
    const agent = await createRootAgent(host.ctx, h.workspace);
    const applied = await host.ctx.tools.execute({
      callId: 'prepare-file' as never, name: 'hima_prepare', arguments: { pack: campaignFilePackId, site: 'local' },
      agent, signal: AbortSignal.timeout(20_000),
    });
    assert.equal(applied.isError, false, JSON.stringify(applied));
    const appliedJson = jsonOf(applied as unknown as ToolResult);
    assert.equal(appliedJson.campaignFile?.applied, true, JSON.stringify(appliedJson));
    assert.equal(appliedJson.goal?.target_period_ns, 3.1, JSON.stringify(appliedJson));
    assert.equal(appliedJson.ready, true, JSON.stringify(appliedJson));

    // Ruling (review item 5): readiness strictness is gated on `overrides !== undefined`, which is
    // the plan's own requirement, not an implementation shortcut. `file: false` never reads the file
    // at all, so `overrides` is `undefined` here exactly as it is for every caller that predates this
    // task and never named a Campaign file — the legacy workbench page, `/hima/api/start-options`,
    // every `hima_prepare` call with no matching file. Legacy preparation without a file keeps the
    // Pack's own defaults (`legacyPeriodGoal.default`, 2.3) and never asks about a Goal at all;
    // strictness — every declared Goal parameter explicit, never defaulted — applies whenever
    // overrides are actually supplied, which `file: false` deliberately opts out of.
    const notApplied = await host.ctx.tools.execute({
      callId: 'prepare-nofile' as never, name: 'hima_prepare', arguments: { pack: campaignFilePackId, site: 'local', file: false },
      agent, signal: AbortSignal.timeout(20_000),
    });
    assert.equal(notApplied.isError, false, JSON.stringify(notApplied));
    const notAppliedJson = jsonOf(notApplied as unknown as ToolResult);
    assert.equal(notAppliedJson.campaignFile?.applied, false, JSON.stringify(notAppliedJson));
    assert.equal(notAppliedJson.goal?.target_period_ns, 2.3, JSON.stringify(notAppliedJson));
    assert.equal(notAppliedJson.ready, true, JSON.stringify(notAppliedJson));
  } finally { await host.dispose(); await h.dispose(); }
});

// Review item CRITICAL 1: `hima_run` must confirm a file that sets a Strategy knob away from its
// default and a Budget override, neither of which the tool's own arguments carry (Strategy may be
// omitted once it already matches the reviewed proposal; a confirmed Campaign refuses Budget args
// outright) — so `startRunOnce`'s own defence-in-depth staleness recheck must recompute the exact
// facts identity the file's overrides minted, and the file's own Strategy/Budget must still reach the
// actual Run.
test('Case 8: hima_run confirms a file that sets a Strategy knob and a Budget override, with no strategy/budget args', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, {});
  assert.ok(flow, 'the stand-in flow is written');
  await installCampaignFilePack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow!.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace },
  });
  const host: InProcessHost = await bootInProcess(h);
  try {
    // periodNs's declared default is 2.30 (min 0.5, max 10); 3.5 is away from it. The Pack itself
    // declares budget.timeBoxMs: 300000 (installCampaignFilePack); the file's own 1.5 minutes
    // (90000 ms) must win over that Pack default, matching the 'file' > 'pack' > 'harness' order.
    writeCampaignFile(h.workspace, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      inputs: {}, goal: { target_period_ns: 2.3 }, strategy: { periodNs: 3.5 },
      budget: { timeBoxMinutes: 1.5 }, knowledge: [], notes: '',
    });
    const agent = await createRootAgent(host.ctx, h.workspace);
    const prepared = jsonOf(await host.ctx.tools.execute({
      callId: 'prepare-budget' as never, name: 'hima_prepare', arguments: { pack: campaignFilePackId, site: 'local' },
      agent, signal: AbortSignal.timeout(20_000),
    }) as unknown as ToolResult);
    assert.equal(prepared.ready, true, JSON.stringify(prepared));
    assert.equal(prepared.strategy?.periodNs, 3.5, JSON.stringify(prepared));

    const started = await host.ctx.tools.execute({
      callId: 'run-from-file' as never, name: 'hima_run',
      arguments: { proposalId: prepared.id, pack: campaignFilePackId, site: 'local', goal: { target_period_ns: 2.3 } },
      agent, signal: AbortSignal.timeout(20_000),
    });
    assert.equal(started.isError, false, JSON.stringify(started));
    const startedJson = jsonOf(started as unknown as ToolResult);
    assert.equal(startedJson.kind, 'preparing', JSON.stringify(startedJson));
    assert.equal(startedJson.strategy?.periodNs, 3.5, JSON.stringify(startedJson));
    const context = await preparedContext(host, startedJson.runId as string);
    const run = context.run;
    assert.notEqual(run.control?.owner, String(agent.id), 'the Guide remains distinct from the Campaign owner');
    assert.equal(run.control?.guideSessionId, String(agent.id));
    assert.equal(run!.budget!.timeBoxMs, 90_000, JSON.stringify(run!.budget));
  } finally { await host.dispose(); await h.dispose(); }
});

// #64 D-T02-1: the person asked for a 150-minute time box and six generations in the conversation,
// the Guide's proposal showed them, and the confirmed Run was created with the Pack's own time box.
// With no Campaign file in the workspace, the budget the person asked for is part of the reviewed
// proposal (hima_prepare) and the confirmation of that exact proposal (hima_run) creates the Run
// with exactly that budget; confirming without it, or with another, is a different proposal.
test('Case 8b: a time box and generation limit asked for in the conversation reach the proposal and the confirmed Run exactly', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, {});
  assert.ok(flow, 'the stand-in flow is written');
  await installCampaignFilePack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow!.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace },
  });
  const host: InProcessHost = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, h.workspace);
    const call = (callId: string, name: string, args: Record<string, unknown>) => host.ctx.tools.execute({
      callId: callId as never, name, arguments: args, agent, signal: AbortSignal.timeout(20_000) }) as unknown as Promise<ToolResult>;
    const budget = { timeBoxMinutes: 150, generations: 6 };
    const preparedResult = await call('prepare-asked-budget', 'hima_prepare', { pack: campaignFilePackId, site: 'local', budget });
    assert.equal(preparedResult.isError, false, JSON.stringify(preparedResult));
    const prepared = jsonOf(preparedResult);
    assert.equal(prepared.ready, true, JSON.stringify(prepared));
    assert.equal(prepared.campaignFile?.applied, false, 'no Campaign file is in this workspace');
    assert.deepEqual(prepared.budget?.timeBoxMinutes, { value: 150, source: 'request' }, JSON.stringify(prepared.budget));
    assert.deepEqual(prepared.budget?.generations, { value: 6, source: 'request' }, JSON.stringify(prepared.budget));

    // Confirming that proposal without the budget it was reviewed with is not that proposal.
    const without = await call('run-without-budget', 'hima_run', { proposalId: prepared.id, pack: campaignFilePackId, site: 'local',
      goal: prepared.goal });
    assert.equal(without.isError, true, JSON.stringify(without));
    assert.match(JSON.stringify(without.content), /Campaign preparation changed|budget/i);
    assert.equal((await host.ctx.hima.durable.store.runs()).length, 0, 'no Run was created by a confirmation of another budget');

    const started = await call('run-asked-budget', 'hima_run', { proposalId: prepared.id, pack: campaignFilePackId, site: 'local',
      goal: prepared.goal, budget });
    assert.equal(started.isError, false, JSON.stringify(started));
    const startedJson = jsonOf(started);
    assert.equal(startedJson.kind, 'preparing', JSON.stringify(startedJson));
    const context = await preparedContext(host, startedJson.runId as string);
    const run = context.run;
    assert.notEqual(run.control?.owner, String(agent.id), 'the Guide remains distinct from the Campaign owner');
    assert.equal(run.control?.guideSessionId, String(agent.id));
    assert.equal(run!.budget!.timeBoxMs, 150 * 60_000, JSON.stringify(run!.budget));
    assert.equal(run!.budget!.generationLimit, 6, JSON.stringify(run!.budget));
  } finally { await host.dispose(); await h.dispose(); }
});

// Review item IMPORTANT 2: a malformed file on disk (bad YAML content or a value the schema
// refuses) is the caller's own mistake, not this Host's fault — it must answer 400 with the one
// sentence naming the field, never 500.
test('Case 9: a malformed Campaign file on disk answers 400 naming the field, not 500', async (t) => {
  const f = await bootedFixture(t);
  try {
    mkdirSync(path.join(f.h.workspace, 'hima'), { recursive: true });
    writeFileSync(path.join(f.h.workspace, 'hima', 'campaign.yml'), 'schema: hima-campaign/1\ngoal: [oops]\n', 'utf8');
    const res = await getCampaign(f);
    const body = await res.json() as any;
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(body.error?.message ?? '', /goal/i, JSON.stringify(body));
  } finally { await teardown(f); }
});

test('Case 10: starting fromCampaignFile against a malformed file answers 400, not 500', async (t) => {
  const f = await bootedFixture(t);
  try {
    mkdirSync(path.join(f.h.workspace, 'hima'), { recursive: true });
    writeFileSync(path.join(f.h.workspace, 'hima', 'campaign.yml'), 'schema: hima-campaign/1\ngoal: [oops]\n', 'utf8');
    const res = await api(f.host, f.cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromCampaignFile: true, sessionId: f.sessionId, pack: campaignFilePackId, site: 'local', proposalId: 'irrelevant.deadbeef.deadbeef' }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(body.error?.message ?? '', /goal/i, JSON.stringify(body));
  } finally { await teardown(f); }
});

// Review item MINOR (f): the PUT 400 sentence, and the not-live-session 404.
test('Case 11: PUT with a value the schema refuses answers 400 with the sentence naming the field', async (t) => {
  const f = await bootedFixture(t);
  try {
    const res = await putCampaign(f, { schema: CAMPAIGN_SCHEMA, goal: 'not-an-object' });
    const body = await res.json() as any;
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(body.error?.message ?? '', /goal/i, JSON.stringify(body));
  } finally { await teardown(f); }
});

test('Case 12: a session id this Host does not carry answers 404 on GET', async (t) => {
  const f = await bootedFixture(t);
  try {
    const res = await api(f.host, f.cookie, '/hima/api/campaign?session=not-a-live-session');
    const body = await res.json() as any;
    assert.equal(res.status, 404, JSON.stringify(body));
  } finally { await teardown(f); }
});

// #41 task 7 review: the save-conflict re-read. A PUT names the mtime it last read
// (`expectedMtimeMs`); a file that changed on disk since — HimaGuide's own edit, in this case,
// exactly like Case 4's hand-written file — answers 409 naming the code and carrying the file
// exactly as it now stands, so the caller reconciles without a second round trip to re-read it.
test('Case 13: a PUT racing another writer 409s naming the current file, and the same PUT with the fresh mtime then saves', async (t) => {
  const f = await bootedFixture(t);
  try {
    const before = await (await putCampaign(f, { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' } })).json() as any;
    await new Promise((resolve) => setTimeout(resolve, 20));
    writeCampaignFile(f.h.workspace, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      inputs: {}, goal: { target_period_ns: 2.3 }, strategy: {}, budget: {}, knowledge: [], notes: '',
    });
    const stalePut = () => api(f.host, f.cookie, campaignPath, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: f.sessionId,
        file: { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, name: 'from the person' },
        expectedMtimeMs: before.mtimeMs,
      }),
    });
    const stale = await stalePut();
    const staleBody = await stale.json() as any;
    assert.equal(stale.status, 409, JSON.stringify(staleBody));
    assert.equal(staleBody.error.code, 'hima/campaign-file-changed', JSON.stringify(staleBody));
    assert.match(staleBody.error.message, /changed since it was last read/);
    assert.equal(staleBody.error.current.file.goal.target_period_ns, 2.3, JSON.stringify(staleBody.error.current));
    const fresh = await api(f.host, f.cookie, campaignPath, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: f.sessionId,
        file: { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, name: 'from the person', goal: { target_period_ns: 2.3 } },
        expectedMtimeMs: staleBody.error.current.mtimeMs,
      }),
    });
    const freshBody = await fresh.json() as any;
    assert.equal(fresh.status, 200, JSON.stringify(freshBody));
    assert.equal(freshBody.file.name, 'from the person', JSON.stringify(freshBody));
  } finally { await teardown(f); }
});

// Final whole-branch review, H1: `Hima.preparation`'s own `overrideUnknowns` validated a file's Goal
// and its input names but never its Strategy or its Budget, so a file naming an unknown Strategy
// knob, a Strategy value outside the knob's own declared bounds, or a Budget value outside the same
// bounds `startRun` itself checks read `ready: true` here and were refused only once a Run was
// actually attempted — for `budget.generations`, past `startRun`'s own re-check and into the ledger,
// since nothing between here and there ever looked at it again.
test('Case 14: a file naming an unknown Strategy knob, an out-of-range Strategy value or an out-of-range Budget value is not ready, and names the offending knob or argument', async (t) => {
  const f = await bootedFixture(t);
  try {
    const unknownKnob = await (await putCampaign(f, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      goal: { target_period_ns: 2.3 }, strategy: { nope: 1 },
    })).json() as any;
    assert.equal(unknownKnob.preparation.proposal.ready, false, JSON.stringify(unknownKnob.preparation.proposal));
    assert.ok(unknownKnob.preparation.proposal.unknowns.some((line: string) => /unknown strategy knob "nope"/.test(line)), JSON.stringify(unknownKnob.preparation.proposal.unknowns));

    // periodNs's declared bounds are 0.5 through 10 (Case 8); 9999 is well outside them.
    const outOfRangeKnob = await (await putCampaign(f, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      goal: { target_period_ns: 2.3 }, strategy: { periodNs: 9999 },
    })).json() as any;
    assert.equal(outOfRangeKnob.preparation.proposal.ready, false, JSON.stringify(outOfRangeKnob.preparation.proposal));
    assert.ok(outOfRangeKnob.preparation.proposal.unknowns.some((line: string) => /invalid strategy knob "periodNs"/.test(line)), JSON.stringify(outOfRangeKnob.preparation.proposal.unknowns));

    // The table in `run-arguments.ts` bounds `generations` at 1000; a million is refused the same way
    // `startRun` itself would refuse it, but here, before any Run exists.
    const hugeGenerations = await (await putCampaign(f, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      goal: { target_period_ns: 2.3 }, budget: { generations: 1_000_000 },
    })).json() as any;
    assert.equal(hugeGenerations.preparation.proposal.ready, false, JSON.stringify(hugeGenerations.preparation.proposal));
    assert.ok(hugeGenerations.preparation.proposal.unknowns.some((line: string) => /invalid budget\.generations/.test(line)), JSON.stringify(hugeGenerations.preparation.proposal.unknowns));
  } finally { await teardown(f); }
});

test('Case 15: hima_prepare agrees with the route: an unknown Strategy knob and an out-of-range Budget override are both not ready', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, {});
  assert.ok(flow, 'the stand-in flow is written');
  await installCampaignFilePack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow!.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace },
  });
  const host: InProcessHost = await bootInProcess(h);
  try {
    writeCampaignFile(h.workspace, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' },
      inputs: {}, goal: { target_period_ns: 2.3 }, strategy: { nope: 1 },
      budget: { generations: 1_000_000 }, knowledge: [], notes: '',
    });
    const agent = await createRootAgent(host.ctx, h.workspace);
    const prepared = await host.ctx.tools.execute({
      callId: 'prepare-invalid-overrides' as never, name: 'hima_prepare', arguments: { pack: campaignFilePackId, site: 'local' },
      agent, signal: AbortSignal.timeout(20_000),
    });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const preparedJson = jsonOf(prepared as unknown as ToolResult);
    assert.equal(preparedJson.ready, false, JSON.stringify(preparedJson));
    assert.ok(preparedJson.unknowns.some((line: string) => /unknown strategy knob "nope"/.test(line)), JSON.stringify(preparedJson.unknowns));
    assert.ok(preparedJson.unknowns.some((line: string) => /invalid budget\.generations/.test(line)), JSON.stringify(preparedJson.unknowns));
  } finally { await host.dispose(); await h.dispose(); }
});

// Final whole-branch review, H9: a malformed file on disk must not throw out of `hima_prepare` or
// `hima_run` — it is reported as `campaignFile: { applied: false, error: <sentence> }` and the call
// proceeds exactly as `file: false` would, with no overrides applied.
test('Case 16: a malformed Campaign file does not throw out of hima_prepare or hima_run; both report the sentence and proceed without overrides', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, {});
  assert.ok(flow, 'the stand-in flow is written');
  await installCampaignFilePack(h);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, flow!.root],
    allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace },
  });
  const host: InProcessHost = await bootInProcess(h);
  try {
    mkdirSync(path.join(h.workspace, 'hima'), { recursive: true });
    writeFileSync(path.join(h.workspace, 'hima', 'campaign.yml'), 'schema: hima-campaign/1\ngoal: [oops]\n', 'utf8');
    const agent = await createRootAgent(host.ctx, h.workspace);

    const prepared = await host.ctx.tools.execute({
      callId: 'prepare-malformed' as never, name: 'hima_prepare', arguments: { pack: campaignFilePackId, site: 'local' },
      agent, signal: AbortSignal.timeout(20_000),
    });
    assert.equal(prepared.isError, false, JSON.stringify(prepared));
    const preparedJson = jsonOf(prepared as unknown as ToolResult);
    assert.equal(preparedJson.campaignFile?.applied, false, JSON.stringify(preparedJson));
    assert.match(preparedJson.campaignFile?.error ?? '', /goal/i, JSON.stringify(preparedJson));
    // No overrides applied (the same as `file: false`): the Pack's own declared Goal default fills in
    // and readiness never asks about a Goal at all.
    assert.equal(preparedJson.ready, true, JSON.stringify(preparedJson));
    assert.equal(preparedJson.goal?.target_period_ns, 2.3, JSON.stringify(preparedJson));

    const started = await host.ctx.tools.execute({
      callId: 'run-malformed' as never, name: 'hima_run', arguments: {
        proposalId: preparedJson.id, pack: campaignFilePackId, site: 'local',
        goal: preparedJson.goal, strategy: preparedJson.strategy,
      }, agent, signal: AbortSignal.timeout(20_000),
    });
    assert.equal(started.isError, false, JSON.stringify(started));
    const startedJson = jsonOf(started as unknown as ToolResult);
    assert.equal(startedJson.campaignFile?.applied, false, JSON.stringify(startedJson));
    assert.match(startedJson.campaignFile?.error ?? '', /goal/i, JSON.stringify(startedJson));
    assert.equal(startedJson.kind, 'preparing', JSON.stringify(startedJson));
    const context = await preparedContext(host, startedJson.runId as string);
    assert.equal(context.run.goal?.target_period_ns, 2.3);
    assert.notEqual(context.run.control?.owner, String(agent.id));
    assert.equal(context.run.control?.guideSessionId, String(agent.id));
  } finally { await host.dispose(); await h.dispose(); }
});

// Final whole-branch review, H11 (spec seam 2): readiness invalidation on each field. Changing the
// Strategy, an input binding, the Budget, the Site file, or the Pack's own bytes must each change the
// proposal's facts part (the first `.`-separated segment `factsOf` reads) — the identity two distinct
// preparations are told apart by, and what a stale confirmation is compared against.
test('Case 17: changing Strategy, an input binding, Budget, the Site file or the Pack\'s own bytes each changes the proposal\'s facts part', async (t) => {
  const f = await bootedFixture(t);
  try {
    await addOverrideDesign(f.flowRoot, 'guide');
    const base = { schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, goal: { target_period_ns: 2.3 } };
    const baseline = await (await putCampaign(f, base)).json() as any;
    assert.equal(baseline.preparation.proposal.ready, true, JSON.stringify(baseline.preparation.proposal));
    const baseFacts = factsOf(baseline.preparation.proposal.id);

    const strategyChanged = await (await putCampaign(f, { ...base, strategy: { periodNs: 3.5 } })).json() as any;
    assert.notEqual(factsOf(strategyChanged.preparation.proposal.id), baseFacts, 'a Strategy override changes the facts part');

    const inputChanged = await (await putCampaign(f, { ...base, inputs: { design: 'guide' } })).json() as any;
    assert.notEqual(factsOf(inputChanged.preparation.proposal.id), baseFacts, 'an input binding override changes the facts part');

    const budgetChanged = await (await putCampaign(f, { ...base, budget: { generations: 3 } })).json() as any;
    assert.notEqual(factsOf(budgetChanged.preparation.proposal.id), baseFacts, 'a Budget override changes the facts part');

    // The Site file itself, read fresh at every preparation (`identityOf(site)`,
    // `campaignProposalFactsIdentity`), not only its bindings: a capacity change is a fact about the
    // Site even though it binds no input this Pack declares.
    await writeLocalSite(f.h, {
      allowedReadRoots: [f.h.workspace, f.flowRoot], allowedWriteRoots: [f.h.workspace],
      bindings: { flowRoot: f.flowRoot, design: 'fixture', workspaceRoot: f.h.workspace },
      parallelJobs: 2,
    });
    const siteChanged = await (await putCampaign(f, base)).json() as any;
    assert.notEqual(factsOf(siteChanged.preparation.proposal.id), baseFacts, 'a changed Site file changes the facts part');

    // Restored before the next case, which isolates one field at a time exactly as every case above
    // does.
    await writeLocalSite(f.h, {
      allowedReadRoots: [f.h.workspace, f.flowRoot], allowedWriteRoots: [f.h.workspace],
      bindings: { flowRoot: f.flowRoot, design: 'fixture', workspaceRoot: f.h.workspace },
    });

    // The Pack's own bytes (`pack.folder.digest(packDigestExcludes)`): an appended YAML comment
    // changes nothing this Pack declares — the parsed contract is byte-for-byte the same shape — only
    // the folder's own digest.
    const contractPath = path.join(packsDirOf(f.h), campaignFilePackId, 'contract.yml');
    appendFileSync(contractPath, '\n# a harmless comment (final whole-branch review, H11)\n', 'utf8');
    const packChanged = await (await putCampaign(f, base)).json() as any;
    assert.notEqual(factsOf(packChanged.preparation.proposal.id), baseFacts, 'a changed Pack digest changes the facts part');
  } finally { await teardown(f); }
});

// Final whole-branch review, H7: a Campaign-file start must not silently substitute the body's own
// Site for the file's, and must not silently discard a body-supplied Goal or Strategy in favour of
// the file's own — both are refused with a sentence.
test('Case 18: a Campaign-file start refuses a body Site that disagrees with the file\'s, and a body Goal or Strategy', async (t) => {
  const f = await bootedFixture(t);
  try {
    const prepared = await (await putCampaign(f, {
      schema: CAMPAIGN_SCHEMA, pack: { id: campaignFilePackId }, site: { name: 'local' }, goal: { target_period_ns: 2.3 },
    })).json() as any;
    assert.equal(prepared.preparation.proposal.ready, true, JSON.stringify(prepared.preparation.proposal));
    const proposalId = prepared.preparation.proposal.id;

    const wrongSite = await api(f.host, f.cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromCampaignFile: true, sessionId: f.sessionId, pack: campaignFilePackId, site: 'not-local', proposalId }),
    });
    const wrongSiteBody = await wrongSite.json() as any;
    assert.equal(wrongSite.status, 400, JSON.stringify(wrongSiteBody));
    assert.match(wrongSiteBody.error?.message ?? '', /different Site/, JSON.stringify(wrongSiteBody));

    const bodyGoal = await api(f.host, f.cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromCampaignFile: true, sessionId: f.sessionId, pack: campaignFilePackId, site: 'local', proposalId, goal: { target_period_ns: 5 } }),
    });
    const bodyGoalBody = await bodyGoal.json() as any;
    assert.equal(bodyGoal.status, 400, JSON.stringify(bodyGoalBody));
    assert.match(bodyGoalBody.error?.message ?? '', /own Goal and Strategy/, JSON.stringify(bodyGoalBody));

    const bodyStrategy = await api(f.host, f.cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromCampaignFile: true, sessionId: f.sessionId, pack: campaignFilePackId, site: 'local', proposalId, strategy: { periodNs: 3 } }),
    });
    const bodyStrategyBody = await bodyStrategy.json() as any;
    assert.equal(bodyStrategy.status, 400, JSON.stringify(bodyStrategyBody));
    assert.match(bodyStrategyBody.error?.message ?? '', /own Goal and Strategy/, JSON.stringify(bodyStrategyBody));
  } finally { await teardown(f); }
});

// Final whole-branch review, H10: an unknown top-level field of the PUT body is named, the same way
// `/packs/transfer` already names one of its own.
test('Case 19: PUT with an unknown top-level body field answers 400 naming it', async (t) => {
  const f = await bootedFixture(t);
  try {
    const res = await api(f.host, f.cookie, campaignPath, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: f.sessionId, file: { schema: CAMPAIGN_SCHEMA }, bogus: true }),
    });
    const body = await res.json() as any;
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(body.error?.message ?? '', /unknown Campaign file field/, JSON.stringify(body));
  } finally { await teardown(f); }
});

// #64 ATCS-08 D-C01-1: the control Run's preparation recorded the Campaign file's
// `inputInnovusDatabase` override (workspace record, workspace.json), but its first Job was built
// from the Site file re-read at execution time and staged the Site's own default instead. The
// recorded Run input bindings are the one source of every Job's inputs.
test('Case 20: a Campaign-file input override reaches the automatic Job\'s command line, and its original prepared command is refused after a real input revision', async (t) => {
  const h = await createHimaHome();
  const flow = await writeStandinFlow(t, h, { sleepSeconds: 0.01 });
  assert.ok(flow, 'the stand-in flow is written');
  await installPack(h);
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow!.root], allowedWriteRoots: [h.workspace],
    bindings: { flowRoot: flow!.root, design: flow!.design, workspaceRoot: h.workspace } });
  await generateStandinDesign({ root: flow!.root, design: 'guide', sleepSeconds: 30 });
  assert.notEqual(flow!.design, 'guide');
  const host = await bootInProcess(h);
  const runIds: string[] = [];
  try {
    const guide = await createRootAgent(host.ctx, h.workspace);
    writeCampaignFile(h.workspace, {
      schema: CAMPAIGN_SCHEMA, pack: { id: 'opene902-timing-probe' }, site: { name: 'local' },
      inputs: { design: 'guide' }, goal: { target_period_ns: 2 }, strategy: {}, budget: {}, knowledge: [], notes: '',
    });
    const invoke = async (name: string, arguments_: Record<string, unknown>) => {
      const answer = await host.ctx.tools.execute({ name, callId: `input-${crypto.randomUUID()}` as never,
        arguments: arguments_, agent: guide, signal: AbortSignal.timeout(20_000) });
      assert.equal(answer.isError, false, JSON.stringify(answer));
      return jsonOf(answer as unknown as ToolResult);
    };
    const proposal = await invoke('hima_prepare', { pack: 'opene902-timing-probe', site: 'local' });
    assert.equal(proposal.ready, true, JSON.stringify(proposal));
    const started = await invoke('hima_run', { pack: 'opene902-timing-probe', site: 'local', proposalId: proposal.id,
      goal: proposal.goal, strategy: proposal.strategy });
    assert.equal(started.kind, 'preparing', JSON.stringify(started));
    const runId = started.runId as string;
    runIds.push(runId);
    const context = await preparedContext(host, runId);
    assert.notEqual(context.run.control?.owner, String(guide.id));
    assert.equal(context.run.control?.guideSessionId, String(guide.id));
    assert.equal(context.durable?.preparation?.kind === 'prepared' ? context.durable.preparation.file.design : undefined, 'guide');
    let launched: any;
    await waitUntil('the original automatic Pack command Job', async () => {
      for (const effect of (await host.ctx.hima.durable.store.flowPhysicalFacts(runId)).effects) {
        const receipt = await host.ctx.hima.durable.store.effectFact(effect.identity.effectId, 'submitted') as any;
        if (receipt?.wire?.includes('DESIGN=guide')) launched = receipt;
      }
      return launched !== undefined;
    }, 30_000, 25);
    const wire = launched.wire;
    assert.match(wire, /DESIGN=guide(\s|'|$)/, `the Job's command line carries the Campaign file's design: ${wire}`);
    assert.doesNotMatch(wire, new RegExp(`DESIGN=${flow!.design}(\\s|'|$)`), 'never the Site file own design');

    // Keep the actual first Job's seat until the second original automatic invocation has
    // prepared its command. Revising that invocation changes current inputs through DBOS;
    // the old command's actual launch callback must refuse before spawning its Job.
    const secondProposal = await invoke('hima_prepare', { pack: 'opene902-timing-probe', site: 'local' });
    const second = await invoke('hima_run', { pack: 'opene902-timing-probe', site: 'local', proposalId: secondProposal.id,
      goal: secondProposal.goal, strategy: secondProposal.strategy });
    assert.equal(second.kind, 'preparing');
    runIds.push(second.runId);
    await preparedContext(host, second.runId);
    const runtime = host.ctx.hima.durable;
    let invocation: any; let preparedJob: any;
    await waitUntil('the second original prepared command awaiting the occupied Site seat', async () => {
      invocation = (await runtime.store.flowInvocations(second.runId)).find(item => item.identity.taskId === 'synthesize');
      if (!invocation) return false;
      preparedJob = await runtime.store.effectFact(invocation.identity.effectId, 'prepared');
      return preparedJob !== undefined && preparedJob !== null;
    }, 30_000, 25);
    assert.equal(await runtime.store.effectFact(invocation.identity.effectId, 'submitted'), undefined);
    const original = invocation.context;
    const authority = await runtime.store.run(second.runId);
    const request = { identity: invocation.identity, input: original.input,
      contract: original.flow.tasks[original.taskId].contract, localSchemas: original.flow.localSchemas,
      admission: { runId: second.runId, effectId: invocation.identity.effectId, owner: authority.owner,
        epoch: authority.epoch, revision: authority.revision } };
    const adapter = await resolveDurableTaskAdapter({ runtime, flow: original.flow, task: original.flow.tasks[original.taskId], request,
      invocation: { iterations: original.iterations, branches: original.branches, extensions: original.extensions, revision: invocation.version },
      committed: original.committed, extensionResults: original.extensionResults, namedResults: original.namedResults,
      bindings: { runInput: original.runInput, goal: original.goal, strategy: original.strategy, carry: original.carry } },
      { ctx: host.ctx, sitesDir: path.join(h.home, 'hima/sites'), retainedMaterialsDir: path.join(h.home, 'hima/run-assets/dbos') });
    assert.ok('submit' in adapter, 'the same original automatic command adapter is materialized');
    if (!('submit' in adapter)) throw new Error('original command adapter unavailable');
    assert.match(preparedJob.wire, /DESIGN=guide(\s|'|$)/);
    assert.match(preparedJob.wire, /CLOCK_PERIOD_NS=2.3(\s|'|$)/);
    const changedInput = { ...original.input, PERIOD_NS: 3.5 };
    assert.notDeepEqual(changedInput, original.input);
    await runtime.store.command({ runId: second.runId, commandId: `input-revision-${crypto.randomUUID()}`, action: 'revise',
      owner: authority.owner, epoch: authority.epoch, revision: authority.revision,
      change: { taskId: original.taskId, effectId: invocation.identity.effectId, input: changedInput,
        evidence: { reason: 'The reviewed Strategy changes the command input; the old prepared invocation must not launch' } } });
    assert.equal((await runtime.store.run(second.runId)).revision, authority.revision + 1);
    let actualCallbackCalls = 0;
    await assert.rejects(adapter.submit(preparedJob, async () => {
      actualCallbackCalls++;
      if (!await runtime.store.claimEffectDispatch(request.admission, () => adapter.permit(preparedJob, 'submit'),
        'submit', request.identity.inputSha256)) throw new Error('Original dispatch is already retained');
    }), /stale|superseded|current|revision|admission/i);
    assert.equal(actualCallbackCalls, 1, 'the stale input refusal reached the actual command launch boundary');
    assert.equal(await runtime.store.effectFact(invocation.identity.effectId, 'submitted'), undefined);
    const recovered = await reconnectRetainedJob(loadSite(path.join(h.home, 'hima/sites'), 'local'), preparedJob);
    assert.equal(recovered.pid, undefined, 'zero physical Job launched for the superseded input invocation');
    assert.equal(spawnSync('tmux', ['has-session', '-t', `=${preparedJob.session}`], { timeout: 5000 }).status, 1,
      'the original wrong-input command has no actual tmux Job session');
  } finally {
    try {
      for (const runId of runIds) {
        const effects = (await host.ctx.hima.durable.store.flowPhysicalFacts(runId)).effects;
        const sessions = new Set<string>();
        for (const effect of effects) {
          const receipt = await host.ctx.hima.durable.store.effectFact(effect.identity.effectId, 'submitted') as { session?: string } | undefined;
          if (receipt?.session) sessions.add(receipt.session);
        }
        try {
          await host.ctx.hima.cancelRun(runId);
          await waitUntil('the cancelled Run has actual resource closure proof', async () => {
            const context = await host.ctx.hima.readExecutionContext(runId);
            return (context.run as typeof context.run & { stopState?: { closed: boolean } }).stopState?.closed === true;
          }, 30_000, 25);
          for (const session of sessions) assert.equal(spawnSync('tmux', ['has-session', '-t', `=${session}`], { timeout: 5000 }).status, 1,
            'the original submitted Job session is physically absent before Host disposal');
        } finally {
          // A failed closure assertion remains a failure. Emergency cleanup is scoped to
          // the actual PG-recorded Jobs of this fixture, never historical Ledger sessions.
          for (const session of sessions) spawnSync('tmux', ['kill-session', '-t', `=${session}`], { timeout: 5000 });
        }
      }
    } finally { await host.dispose(); await h.dispose(); }
  }
});
