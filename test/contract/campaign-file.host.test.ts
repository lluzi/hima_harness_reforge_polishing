// #41 task 3: the Campaign file (`hima/campaign.yml`) is the unified configuration — a route reads
// and writes it, Preparation accepts its overrides, readiness never fills a Goal from a default, the
// start route can confirm straight from it, and both hima_* tools apply it. Real Host (a subprocess
// for the HTTP routes, an in-process host for the tools) and local files only; no model, Desktop or
// SSH is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
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
import { CAMPAIGN_SCHEMA, writeCampaignFile } from '@hima/harness';

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
    assert.equal(body.workspace?.design, 'guide', JSON.stringify(body.workspace));
    const records = await (await api(f.host, f.cookie, `/hima/api/runs/${body.run.id}/records?type=workspace`)).json() as any;
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
    assert.equal(startedJson.kind, 'ran', JSON.stringify(startedJson));
    assert.equal(startedJson.strategy?.periodNs, 3.5, JSON.stringify(startedJson));
    const run = host.ctx.hima.ledger.run(startedJson.runId as string);
    assert.ok(run, 'the run exists in the ledger');
    assert.equal(run!.budget!.timeBoxMs, 90_000, JSON.stringify(run!.budget));
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
