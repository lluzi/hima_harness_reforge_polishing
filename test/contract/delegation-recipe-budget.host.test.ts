// @hima-seam llm-replay direct
// #66 H1, H2a (ATCS-09): what a Pack Agent Team recipe may declare for its Operator, and what the Host
// grants when it materializes that Operator.
//
// - H1: the reviewed-scope mutation cap a recipe may declare reaches 600 (a coordinated manual-ECO
//   batch is tens to hundreds of edits); 601 is still refused at load.
// - H2a: a recipe-materialized Operator gets the Team member's declared `budgetShare` (time,
//   follow-ups, tokens per turn), held only to the lane's unreserved time and the Run's time box. A
//   manually contracted Operator keeps the Host's own 20-minute, one-follow-up, 5000-token default.
//
// The fixture is the timing probe's interactive `synthesize` node with a request-scope Operator: the
// admitted plan carries its own scope, so the Operator is materialized with no Reviewer in front of it.
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse, stringify } from 'yaml';
import { createHash } from 'node:crypto';
import { BUILTIN_TCL_ADAPTER_DIGEST, interactiveCommandsDigest, loadPack, packDigestExcludes, retainRunMaterial } from '@hima/harness';
import type { ReplayEntry } from '@deepseek-ai/dsh-llm-replay';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { bootInProcess, createRootAgent } from './support/boot-inprocess.ts';
import { repoRoot } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { appendReplaySession, type MomentScenarioFixture } from './support/moments.ts';
import { timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

const packId = 'recipe-budget';
const MINUTE = 60_000;
/** The share the ATCS-09 Operator declares: about 40 minutes, four follow-ups, 12 000 tokens a turn. */
const operatorShare = { maxElapsedMs: 40 * MINUTE, maxFollowups: 4, maxTokensPerTurn: 12_000 };

const operatorMember = (maxMutations: number) => ({
  id: 'operator', role: 'operator', node: 'synthesize', taskTemplate: 'Operate the session inside the admitted plan\'s scope.',
  inputs: ['qorReport'], allowedTools: ['hima_interactive'], scopePolicy: 'site-qualified-interactive-only',
  budgetShare: operatorShare, dependencyRoles: [], resultSchema: { id: 'fixture-operator/1', required: ['schema'] },
  recipient: 'run-owner', ownerAdoption: 'required', identity: 'one-child-per-role-per-execution', followup: 'reuse-same-child',
  cancellation: 'request-stop-preserve-unknown', terminal: ['completed', 'cancelled', 'expired', 'uncertain', 'refused'],
  refusalConditions: ['missing-evidence'],
  reviewedAction: { mode: 'request-scope', planInput: 'qorReport', scopePath: ['scope'], commands: ['size_cell'],
    maxMutations, hostPlanHashArgument: 'planSha256' },
});

/** The timing probe with an interactive `synthesize` node and one request-scope Operator recipe. */
async function writeRecipePack(packsDir: string, wrapper: string, maxMutations: number): Promise<string> {
  await writePackVariant(packsDir, packId, [], [], timingProbePackId);
  const contractFile = path.join(packsDir, packId, 'contract.yml');
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  contract.environment.wrappers = [wrapper];
  contract.workspace.copy.push('interactive-repl.tcl');
  const tool = contract.tools.find((candidate: { id: string }) => candidate.id === 'synth');
  tool.licences = {};
  tool.argv = [wrapper, '${WORKSPACE}/flow/interactive-repl.tcl'];
  tool.interactive = { mode: 'interactive-only', adapter: 'hima-tcl-line-v1', argv: tool.argv, commands: {
    read: ['get_value'], mutate: ['size_cell'], save: ['save_state', 'close_session'],
  }, arguments: {
    get_value: [{ name: 'key', type: 'string' }],
    size_cell: [{ name: 'instance', type: 'string' }, { name: 'master', type: 'string' }, { name: 'planSha256', type: 'string' }],
    save_state: [{ name: 'file', type: 'string' }], close_session: [],
  } };
  contract.agentTeams = [{ id: 'budget-team', version: '1', triggerNode: 'synthesize', members: [operatorMember(maxMutations)] }];
  await writeFile(contractFile, stringify(contract));
  return contractFile;
}

/** The loaded Pack, or a failure naming exactly why it did not load. */
function loads(packsDir: string, label: string): ReturnType<typeof loadPack> {
  try { return loadPack(packsDir, packId); }
  catch (error) { assert.fail(`${label} does not load: ${(error as Error).message}`); }
}

test('H1: a Pack recipe may declare a reviewed-scope cap of 600 mutations; 601 is refused at load', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h } = local;
  t.after(() => h.dispose());
  const packsDir = path.join(h.home, 'hima/packs');
  const wrapper = await realpath('/usr/bin/tclsh');
  const contractFile = await writeRecipePack(packsDir, wrapper, 600);
  const loaded = loads(packsDir, 'a request-scope cap of 600');
  const reviewed = loaded.contract.agentTeams[0]!.members[0]!.reviewedAction;
  assert.equal(reviewed?.mode === 'request-scope' ? reviewed.maxMutations : undefined, 600, 'a request-scope cap of 600 loads');
  // The Reviewer-approved scope mode shares the same bound.
  const contract = parse(await readFile(contractFile, 'utf8')) as Record<string, any>;
  const reviewer = { ...operatorMember(600), id: 'reviewer', role: 'reviewer', inputs: ['qorReport'], allowedTools: ['hima_delegation_input'],
    scopePolicy: 'declared-inputs-only', budgetShare: { maxElapsedMs: 30_000, maxFollowups: 1 },
    resultSchema: { id: 'fixture-scope-review/1', required: ['schema', 'planSha256', 'scope'] }, reviewedAction: undefined };
  const scopeTeam = (maxMutations: number) => [{ id: 'budget-team', version: '1', triggerNode: 'synthesize', members: [reviewer,
    { ...operatorMember(maxMutations), dependencyRoles: ['reviewer'], reviewedAction: { mode: 'scope', fromRole: 'reviewer',
      planInput: 'qorReport', commands: ['size_cell'], maxMutations, hostPlanHashArgument: 'planSha256', planHashField: 'planSha256',
      scopeField: 'scope' } }] }];
  await writeFile(contractFile, stringify({ ...contract, agentTeams: scopeTeam(600) }));
  const scoped = loads(packsDir, 'a Reviewer-approved scope cap of 600').contract.agentTeams[0]!.members[1]!.reviewedAction;
  assert.equal(scoped?.mode === 'scope' ? scoped.maxMutations : undefined, 600, 'a Reviewer-approved scope cap of 600 loads');
  for (const [label, agentTeams] of [
    ['a request-scope cap of 601', [{ ...contract.agentTeams[0], members: [operatorMember(601)] }]],
    ['a Reviewer-approved scope cap of 601', scopeTeam(601)],
  ] as const) {
    await writeFile(contractFile, stringify({ ...contract, agentTeams }));
    assert.throws(() => loadPack(packsDir, packId), /maxMutations[\s\S]*(<=600|too big)/i, `${label} does not load`);
  }
});

test('H2a: a recipe-materialized Operator gets its Team member share, held only to the Run time box', async (t) => {
  const priorBinding = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'recipe-budget-fixture';
  t.after(() => { if (priorBinding === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = priorBinding; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local;
  let host: Awaited<ReturnType<typeof bootInProcess>> | undefined; const cleanup: string[] = [];
  t.after(async () => {
    for (const runId of cleanup) { try { await host?.ctx.hima.cancelRun(runId); } catch { /* ended */ } }
    await host?.dispose(); await h.dispose();
  });
  const packsDir = path.join(h.home, 'hima/packs');
  const wrapper = await realpath('/usr/bin/tclsh');
  // A cap within the pre-H1 bound, so this case reproduces on its own.
  await writeRecipePack(packsDir, wrapper, 150);
  const sourceTemplate = path.join(packsDir, packId, 'interactive-repl.tcl');
  await copyFile(path.join(repoRoot, 'test/fixtures/interactive-job/scope-repl.tcl'), sourceTemplate);
  await copyFile(sourceTemplate, path.join(flow.root, 'interactive-repl.tcl'));
  const installed = loadPack(packsDir, packId);
  const packDigest = installed.folder.digest(packDigestExcludes);
  const declaredTool = installed.contract.tools.find((candidate) => candidate.id === 'synth')!;
  const site = await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow.root, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace },
    licences: {}, parallelJobs: 1 });
  const adminDir = path.join(h.home, 'admin'); await mkdir(adminDir);
  const environmentFile = path.join(adminDir, 'environment.json');
  const environmentText = JSON.stringify({
    schema: 'hima-interactive-environment/1', site: 'local', toolId: 'synth', pack: { id: packId, digest: packDigest },
    adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST }, commandsDigest: interactiveCommandsDigest(declaredTool),
    wrapper: { path: wrapper, sha256: createHash('sha256').update(await readFile(wrapper)).digest('hex') },
    image: { reference: 'local/recipe-budget-test', digest: `sha256:${'0'.repeat(64)}` },
    sourceTemplate: { path: 'interactive-repl.tcl', sha256: createHash('sha256').update(await readFile(sourceTemplate)).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only', privateWriteRoot: await realpath(h.workspace),
      network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  });
  await writeFile(environmentFile, environmentText);
  const bindingsFile = path.join(adminDir, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{
    id: 'recipe-budget-fixture', site: 'local', packDigest, toolId: 'synth', adapter: 'hima-tcl-line-v1',
    adapterHash: BUILTIN_TCL_ADAPTER_DIGEST, commandsDigest: interactiveCommandsDigest(declaredTool),
    environment: { id: 'recipe-budget-env', file: environmentFile, sha256: createHash('sha256').update(environmentText).digest('hex') },
    mutation: 'qualified' }] }));
  // Every live session (Operators, and owners DSH tells about them) answers with a short text; the
  // answers are never read here. Replay binds sessions by first-call order, so each gets the same script.
  const say = (text: string): ReplayEntry => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] });
  const script = Array.from({ length: 6 }, () => say(JSON.stringify({ schema: 'fixture-operator/1' })));
  const replayDir = path.join(h.home, 'budget-replay'); await mkdir(replayDir, { recursive: true });
  const replayFile = path.join(replayDir, 'session.jsonl'); const replayOverride = path.join(replayDir, 'replay.override.json');
  await writeFile(replayFile, `${JSON.stringify({ version: 0, type: 'session', id: 'budget-first', createdAt: 0, cwd: '{{cwd}}' })}\n`);
  await writeFile(replayOverride, `${JSON.stringify(script)}\n`);
  let scenario: MomentScenarioFixture = { file: replayFile, override: replayOverride, readyFile: path.join(replayDir, 'unused'), children: [] };
  for (let n = 1; n <= 7; n++) scenario = await appendReplaySession(scenario, `budget-${n}`, script);
  await writeReplayOverlay(h.home, { file: scenario.file, overrideFile: scenario.override, childFiles: scenario.children });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  await appendFile(homePatchFile(h.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(site.sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(h.home, 'hima/knowledge/current'))}\n    interactiveBindingsFile: ${JSON.stringify(bindingsFile)}\n`);
  host = await bootInProcess(h);
  const booted = host;

  /** One Run with a begun `synthesize` execution and its admitted plan, whose own scope the Operator takes. */
  const runWith = async (timeBoxMs: number) => {
    const owner = await createRootAgent(booted.ctx, h.workspace); const actor = String(owner.id);
    const started = await booted.ctx.hima.startRun({ pack: packId, site: site.name, goal: { target_period_ns: 2 }, ownerSessionId: actor, timeBoxMs });
    assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
    const runId = started.run.id; cleanup.push(runId);
    const control = () => booted.ctx.hima.ledger.run(runId)!.control!;
    const plan = Buffer.from(`${JSON.stringify({ problem: 'synthetic setup path', scope: { commands: ['size_cell'], maxMutations: 120 } })}\n`);
    const planSha256 = createHash('sha256').update(plan).digest('hex');
    const retained = await retainRunMaterial({ ledger: booted.ctx.hima.ledger, packsDir }, runId, plan, planSha256); assert.ok(retained);
    await booted.ctx.hima.ledger.appendObservation(runId, { path: `flow/results/${flow.design}/syn/report/qor.rpt`,
      contentSha256: planSha256, retainedPath: retained, bytes: plan.byteLength,
      reader: { id: 'dc-qor-report', version: '1', reportKind: 'dc-qor', emits: ['clock_period'] }, values: [] });
    const begun = await booted.ctx.hima.executionAction({ runId, actor, action: 'begin', nodeId: 'synthesize', requestId: `begin-${runId}`,
      expectedEpoch: control().epoch, expectedRevision: control().revision });
    assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
    const delegate = (body: Record<string, unknown>) => booted.ctx.hima.delegate({ runId, actor,
      expectedEpoch: control().epoch, expectedRevision: control().revision, ...body } as never) as Promise<Record<string, any>>;
    return { runId, executionId: begun.receipt!.executionId!, delegate, planSha256 };
  };

  // A Run whose time box leaves room for the whole share: the Operator gets exactly what its member declares.
  const roomy = await runWith(180 * MINUTE);
  const operator = await roomy.delegate({ action: 'create', requestId: 'operator-roomy',
    recipe: { teamId: 'budget-team', version: '1', memberId: 'operator', executionId: roomy.executionId } });
  assert.equal(operator.status, 'created', JSON.stringify(operator));
  assert.deepEqual(operator.effectiveContract.recipe.inlinePayload.scope, { commands: ['size_cell'], maxMutations: 120 },
    'the admitted plan\'s own scope is the Operator\'s scope');
  assert.deepEqual(operator.effectiveContract.budgetShare, operatorShare,
    'the recipe Operator gets its Team member share: 40 minutes, 4 follow-ups, 12 000 tokens a turn');
  assert.equal(operator.effectiveContract.model.maxTokensPerTurn, operatorShare.maxTokensPerTurn, 'the child model is capped at the member share');
  await booted.ctx.hima.cancelRun(roomy.runId);

  // A Run whose time box is shorter than the share: the time box still bounds it, follow-ups and tokens stay the member's.
  const tight = await runWith(25 * MINUTE);
  const bounded = await tight.delegate({ action: 'create', requestId: 'operator-tight',
    recipe: { teamId: 'budget-team', version: '1', memberId: 'operator', executionId: tight.executionId } });
  assert.equal(bounded.status, 'created', JSON.stringify(bounded));
  const share = bounded.effectiveContract.budgetShare;
  assert.ok(share.maxElapsedMs < 25 * MINUTE && share.maxElapsedMs > 24 * MINUTE,
    `the share is held to the Run's remaining time box (25 min), got ${share.maxElapsedMs} ms`);
  assert.equal(share.maxFollowups, operatorShare.maxFollowups);
  assert.equal(share.maxTokensPerTurn, operatorShare.maxTokensPerTurn);
  await booted.ctx.hima.cancelRun(tight.runId);
  // A manually contracted Operator keeps the Host's own 1-follow-up, 5000-token default: interactive-eda.host.test.ts.
});
