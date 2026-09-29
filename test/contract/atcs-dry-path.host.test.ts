// Issue #63: the ATCS Pack's 0.1.10 reference path below the GUI, with no model and no EDA, as one L2
// Host test. One booted Host drives the real graph from `bind-inputs` as the Run's owner: every tool
// node is the Pack's own `flow/atcs_cli.py` launched as a Job, every Reader and Judge is the Pack's
// own, and the Run ends `ended-budget-exhausted` by its generation limit. It is then sealed through
// `/hima-test` and `/hima-release` on this home's installed copy of the Pack.
//
// What stands in, and only at the Site/tool/model boundary:
// - EDA: the Site's `edaShell` is `test/fixtures/atcs-dry-path/eda-standin.py`, which answers
//   `innovus`, `StarXtract`, `pt_shell` and `xtop` batch commands by writing the reports the Pack
//   reads back (the Pack's own `flow/tests/fixtures.py` generators) and logs every command.
// - XTop Operator: `test/fixtures/atcs-dry-path/atcs-dry-repl.tcl` under `tclsh`, bound through the
//   qualified interactive seam exactly as `agentic-timing-closure-system.test.ts` binds its REPL.
// - Model: every Workshop's code is a fixture under `workshops/` (the Pack's own knowledge
//   `example-*.md` documents with their values changed for this Campaign), written by the owner through
//   `write`; every Team member's result is one synthetic JSON object appended through the Ledger's
//   production handoff shape; `/hima-test` and `/hima-release` replay a transcript this test writes
//   from the ended Run. The home's model route is dsh's keyless replay adapter throughout.
//
// Limits, stated rather than hidden: the Team here is `atcs-worker-01` only. `research-worker-02`
// has no incoming edge in graph.yml, so slots w02/w03 are unreachable on this graph; this test does
// not add one. No timing, extraction, physical or QoR claim is made by any number below.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appendFile, cp, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, HIMA_TEST_SECTIONS, checkTestRecord, interactiveCommandsDigest, loadPack,
  packDigestExcludes, packStage, retainRunMaterial, runDelegations, type ExecutionActionRequest,
} from '@hima/harness';
import { repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, sayAsUser, saidByModel, toolCalls, toolResults, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { writeMomentScenario } from './support/moments.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile, writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'agentic-timing-closure-system';
const fixture = path.join(repoRoot, 'test/fixtures/atcs-dry-path');
const SCENARIOS = ['func_ssg_rcworst', 'func_ffg_cbest'];
const MAX_PATHS = 1000;
// The Run's physical-refresh cap: the Goal value `max_physical_refreshes`, fixed when the Run is
// created, passed the way the WNS targets are.
const REFRESH_CAP = 1;
const GOAL = { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: REFRESH_CAP };

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';

interface Home {
  readonly h: HimaHome;
  readonly packsDir: string;
  readonly variant: string;
  readonly site: string;
  readonly standinLog: string;
}

/** The installed scratch copy of the Pack, the local Site, its synthetic inputs and the Team seam. */
async function prepareHome(t: TestContext): Promise<Home> {
  const prior = process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
  process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = 'atcs-dry';
  t.after(() => { if (prior === undefined) delete process.env.HIMA_TEST_INTERACTIVE_BINDING_ID;
    else process.env.HIMA_TEST_INTERACTIVE_BINDING_ID = prior; });
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };

  // Site inputs: the synthetic design, the Site-fixed analysis contract and siteCapabilities.
  const site = path.join(h.workspace, 'site-inputs');
  await cp(path.join(fixture, 'design'), path.join(site, 'design'), { recursive: true });
  await mkdir(path.join(site, 'starrc-toolkit/linux64_starrc/lib'), { recursive: true });
  const fill = async (from: string, to: string) => {
    const text = (await readFile(from, 'utf8')).replaceAll('${SITE}', site)
      .replaceAll('${STANDIN}', path.join(fixture, 'eda-standin.py'));
    await mkdir(path.dirname(to), { recursive: true }); await writeFile(to, text);
  };
  for (const file of await readdir(path.join(fixture, 'analysis'))) {
    await fill(path.join(fixture, 'analysis', file), path.join(site, 'analysis', file));
  }
  await fill(path.join(fixture, 'site/manifest.json'), path.join(site, 'manifest.json'));
  await fill(path.join(fixture, 'site/caps.json'), path.join(site, 'caps.json'));
  const standinLog = path.join(site, 'eda-standin.log');
  await writeFile(path.join(site, 'eda-standin.json'), JSON.stringify({
    fixturesDir: path.join(repoRoot, 'packs', packId, 'flow/tests'), log: standinLog }));
  await writeFile(standinLog, '');

  // The scratch copy of the Pack this home runs, differing from the repository only at the XTop
  // Operator: `tclsh` and the dry REPL in place of the Site's qualified XTop wrapper.
  const packsDir = path.join(h.home, 'hima/packs');
  const variant = path.join(packsDir, packId);
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true,
    filter: (src) => !src.includes('__pycache__') });
  const contract = parse(await readFile(path.join(variant, 'contract.yml'), 'utf8')) as any;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper, 'python3', '/usr/bin/python3'];
  contract.budget.closingReserveMs = 1000;
  contract.workspace.copy.push('atcs-dry-repl.tcl');
  const tool = contract.tools.find((item: any) => item.id === 'xtop-operator');
  tool.argv = [wrapper, '${WORKSPACE}/flow/atcs-dry-repl.tcl', '${WORKSPACE}', 'w01', 'u_a/reg0'];
  tool.interactive.argv = tool.argv;
  tool.licences = {};
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  assert.equal(graph.entry, 'bind-inputs', 'the dry path starts where the reference graph starts');
  await cp(path.join(fixture, 'atcs-dry-repl.tcl'), path.join(variant, 'flow/atcs-dry-repl.tcl'));

  const siteFiles = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper, 'python3', '/usr/bin/python3'], licences: { xtop: 1, innovus: 1, primetime: 1, starrc: 1 },
    bindings: { designStateManifest: path.join(site, 'manifest.json'), analysisContract: path.join(site, 'analysis'),
      siteCapabilities: path.join(site, 'caps.json'), workspaceRoot: h.workspace },
  });

  // The interactive binding the qualified Operator seam requires, for this variant's digest.
  const pack = loadPack(packsDir, packId);
  const digest = pack.folder.digest(packDigestExcludes);
  const admin = path.join(h.home, 'admin'); await mkdir(admin);
  const environmentFile = path.join(admin, 'environment.json');
  const environment = {
    schema: 'hima-interactive-environment/1', site: 'local', toolId: tool.id,
    pack: { id: packId, digest }, adapter: { id: 'hima-tcl-line-v1', digest: BUILTIN_TCL_ADAPTER_DIGEST },
    commandsDigest: interactiveCommandsDigest(pack.contract.tools.find(item => item.id === tool.id)!),
    wrapper: { path: wrapper, sha256: createHash('sha256').update(await readFile(wrapper)).digest('hex') },
    image: { reference: 'local/atcs-dry', digest: 'sha256:' + '0'.repeat(64) },
    sourceTemplate: { path: 'flow/templates/xtop-operator.tcl',
      sha256: createHash('sha256').update(await readFile(path.join(variant, 'flow/templates/xtop-operator.tcl'))).digest('hex') },
    confinement: { rootFilesystem: 'read-only', dataRoot: '/', dataMount: 'read-only',
      privateWriteRoot: h.workspace, network: 'host-localhost-licence-only', capabilities: 'dropped-all', noNewPrivileges: true },
    qualification: { status: 'passed', transcriptSha256: '1'.repeat(64), logicalEcoSha256: '2'.repeat(64),
      physicalEcoSha256: '3'.repeat(64), xtopReady: true, identityQuery: true, mutation: true, save: true,
      sourceWriteDenied: true, execWriteDenied: true, normalExit: true },
  };
  const environmentText = JSON.stringify(environment);
  await writeFile(environmentFile, environmentText);
  const bindingsFile = path.join(admin, 'bindings.json');
  await writeFile(bindingsFile, JSON.stringify({ schema: 'hima-interactive-bindings/1', bindings: [{
    id: 'atcs-dry', site: 'local', packDigest: digest, toolId: tool.id,
    adapter: 'hima-tcl-line-v1', adapterHash: BUILTIN_TCL_ADAPTER_DIGEST,
    commandsDigest: environment.commandsDigest, environment: { id: 'atcs-dry', file: environmentFile,
      sha256: createHash('sha256').update(environmentText).digest('hex') }, mutation: 'qualified',
  }] }));
  await appendFile(path.join(h.profileDir, 'cordis.patch.yml'), '\n- id: hima\n  config:\n    sitesDir: ' + JSON.stringify(siteFiles.sitesDir)
    + '\n    packsDir: ' + JSON.stringify(packsDir) + '\n    knowledgeDir: ' + JSON.stringify(path.join(h.home, 'hima/knowledge/current'))
    + '\n    interactiveBindingsFile: ' + JSON.stringify(bindingsFile) + '\n');
  // The model route for the whole drive: dsh's keyless replay adapter, never the DeepSeek provider.
  // The owner is told each time a Team result is retained; its one replayed answer is the delegation
  // `notice` scenario's, repeated for every Team member of up to four Team executions.
  const replay = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  const notices = JSON.parse(await readFile(replay.override, 'utf8')) as unknown[];
  await writeFile(replay.override, JSON.stringify(Array.from({ length: 4 }, () => notices).flat()));
  await writeReplayOverlay(h.home, { file: replay.file, overrideFile: replay.override, childFiles: replay.children });
  assert.match(await readFile(homePatchFile(h.home), 'utf8'), /- id: llm-deepseek\n  disabled: true\n/, 'the drive runs on the replay adapter');
  return { h, packsDir, variant, site, standinLog };
}

/** The workshop code this dry path replays, with the example document or scenario list inlined. */
async function workshopCode(file: string, substitutions: Record<string, string> = {}): Promise<string> {
  let code = await readFile(path.join(fixture, 'workshops', file), 'utf8');
  for (const [from, to] of Object.entries(substitutions)) code = code.replaceAll(from, to);
  assert.doesNotMatch(code, /__(EXAMPLE|SCENARIOS)_JSON__/, `${file} has no unfilled placeholder`);
  return code;
}

/** The one fenced JSON document of the Pack's knowledge `example-<name>.md`, as the Workshops read it. */
const example = async (variant: string, name: string): Promise<string> => {
  const text = await readFile(path.join(variant, 'knowledge', `example-${name}.md`), 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(block, `knowledge/example-${name}.md holds one fenced json document`);
  return JSON.stringify(JSON.parse(block[1]!), null, 2);
};

/**
 * The two next-investment decisions the dry path replays, both `observe`: first on the baseline, then
 * on the adopted candidate. After an adopt, `research` and `compose` cannot prepare a batch: the XTop
 * context `observe` binds to a design state is still the parent's, and `prepare-workers` and
 * `replay-prepare` refuse it `stale-base` (reported under Issue #63, not worked around here).
 */
async function decisions(variant: string): Promise<{ observe: string; reobserve: string }> {
  const observe = await example(variant, 'next-decision');
  const reobserve = JSON.stringify({ ...JSON.parse(observe),
    question: 'which setup paths remain on the adopted candidate before a second sizing batch?',
    targets: ['func_ssg_rcworst|setup|u_a/reg0/D'],
    reason: 'the refreshed candidate is adopted but still fails setup on u_a/reg0/D; observe the adopted state before researching again',
    falsifier: 'if the adopted state shows no remaining setup path, stop and decide on the evidence at hand' }, null, 2);
  return { observe, reobserve };
}

interface Drive {
  readonly runId: string;
  readonly workspace: string;
  readonly owner: string;
  readonly ownerAgent: Awaited<ReturnType<typeof createRootAgent>>;
  readonly stops: string[];
  readonly teamExecutions: string[];
  readonly delegations: number;
  readonly interactiveOpens: number;
  readonly pausedRefusal: string | undefined;
}

/**
 * Drive one Run through the reference path as its conversational owner. With generation limit 2 the
 * owner's second `revisit-observe` is refused by the limit and the Run ends; with limit 3 the third
 * generation's second batch stops at the refresh-budget gate, on `wait-for-person`.
 */
async function drive(host: InProcessHost, home: Home, generationLimit: number, log: string[]): Promise<Drive> {
  const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', test: true, goal: GOAL,
    strategy: { maxPaths: MAX_PATHS }, generationLimit, retryAllowance: 1, ownerSessionId: actor, timeBoxMs: 3_600_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
  const runId = started.run.id; const workspace = started.workspace;
  let sequence = 0;
  const context = () => host.ctx.hima.executionContext(runId);
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const records = () => host.ctx.hima.ledger.records({ runId });
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) =>
    host.ctx.hima.executionAction({ runId, actor, origin: 'agent', action, expectedEpoch: control().epoch,
      expectedRevision: control().revision, requestId: `dry-${++sequence}`, ...fields });
  const available = (nodeId: string) => assert.ok(context().available.includes(nodeId), `${nodeId} is available: ${JSON.stringify({
    available: context().available, status: context().run.status, currentNode: context().run.currentNode, reason: context().reason })}`);
  const settle = async (nodeId: string, executionId: string) => {
    await waitUntil(`${nodeId} settles`, () => context().executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)), 60_000, 25);
    const settled = context().executions.find(e => e.id === executionId)!;
    if (settled.phase !== 'ready') {
      const jobLog = settled.intent?.job?.workspace && settled.jobSession
        ? await readFile(path.join(settled.intent.job.workspace, `${settled.jobSession}.log`), 'utf8').catch(() => '') : '';
      const blocked = records().findLast(r => r.type === 'node' && r.nodeId === nodeId && r.state === 'blocked');
      const refusal = records().findLast(r => r.type === 'refusal');
      log.push(`STOP ${nodeId}: ${settled.phase}`);
      assert.fail(`${nodeId} ${settled.phase}: ${jobLog}\n${JSON.stringify({ result: settled.result,
        blockedReason: (blocked as any)?.reason, refusal })}`);
    }
  };
  const verdictsOf = (nodeId: string, executionSeq: number) => {
    const done = records().findLast(r => r.type === 'node' && r.nodeId === nodeId && r.state === 'done') as any;
    const rules = records().filter(r => r.type === 'verdict' && r.seq >= executionSeq).map(r => `${(r as any).ruleId}=${(r as any).outcome}`);
    return done?.kind === 'judge' ? [`${String(done.outcome)}: ${rules.join(', ')}`] : [];
  };
  /** begin, work (a Workshop first writes its replayed entry), settle, complete. */
  const step = async (nodeId: string, code?: string) => {
    available(nodeId);
    const before = host.ctx.hima.ledger.run(runId)!.nextSeq;
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', `${nodeId} begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    if (code !== undefined) {
      const wrote = await act('write', { executionId, path: 'entry.py', content: code });
      assert.equal(wrote.kind, 'accepted', `${nodeId} write: ${wrote.reason}`);
    }
    const worked = await act('work', { executionId }); assert.notEqual(worked.kind, 'refused', `${nodeId} work: ${worked.reason}`);
    await settle(nodeId, executionId);
    const done = await act('complete', { nodeId, executionId }); assert.equal(done.kind, 'accepted', `${nodeId} complete: ${done.reason}`);
    const verdicts = verdictsOf(nodeId, before);
    log.push(`${nodeId}${verdicts.length ? ` [${verdicts.join(', ')}]` : ''} -> ${context().run.currentNode ?? context().run.status}`);
    return executionId;
  };
  /** An Explore revisit: the owner's next-strategy decision citing this generation's evidence. */
  const revisit = async (nodeId: string) => {
    available(nodeId);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', `${nodeId} begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    assert.notEqual((await act('work', { executionId })).kind, 'refused');
    await settle(nodeId, executionId);
    const run = context().run;
    const cites = records().filter(r => (r.type === 'observation' || r.type === 'verdict') && r.generation === run.generation && r.loopId === undefined).map(r => r.id);
    const done = await act('complete', { nodeId, executionId, decision: 'next-strategy', strategy: { maxPaths: MAX_PATHS },
      rationale: 'Replayed owner decision: follow the admitted next-decision route with the same Strategy.', cites });
    assert.equal(done.kind, 'accepted', `${nodeId} complete: ${done.reason}`);
    log.push(`${nodeId} (explore, generation ${run.generation}) -> ${context().run.currentNode ?? ''} ${context().run.status}, generation ${context().run.generation}`);
  };

  // Team seam: one Team execution of atcs-worker-01, the three members' synthetic results adopted
  // through the production handoff shape, and one typed Operator session on the dry REPL.
  const teamExecutions: string[] = []; let delegations = 0; let interactiveOpens = 0;
  const operate = async () => {
    available('operate-worker-01');
    const planPath = path.join(workspace, 'research/requests/worker-request-w01.json');
    const planBytes = await readFile(planPath);
    const planHash = createHash('sha256').update(planBytes).digest('hex');
    const action = JSON.parse(planBytes.toString('utf8')).actions[0] as { instance: string; toMaster: string };
    const begin = await act('begin', { nodeId: 'operate-worker-01' }); assert.equal(begin.kind, 'accepted', JSON.stringify(begin));
    const executionId = begin.receipt!.executionId!; teamExecutions.push(executionId);
    const create = (memberId: string) => host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: `create-${memberId}-${executionId}`,
      expectedEpoch: control().epoch, expectedRevision: control().revision,
      recipe: { teamId: 'atcs-worker-01', version: '3', memberId, executionId } } as never) as Promise<any>;
    const resultAndAdopt = async (child: any, value: unknown) => {
      const id = child.effectiveContract.delegationId;
      const row = runDelegations((host.ctx.hima as any).deps(), runId).find(item => item.delegationId === id)!;
      const text = JSON.stringify(value);
      const record = await host.ctx.hima.ledger.appendDelegation(runId, { delegationId: id, parentSessionId: actor,
        childSessionId: row.childSessionId, requestId: 'result-' + id, requestDigest: 'a'.repeat(64),
        event: 'result-observed', payload: { candidate: true, source: 'native-live-session', handoff: {
          outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
          contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
          output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
          unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['replayed Team result; no model'] },
        } } });
      const adoption = await host.ctx.hima.delegate({ runId, actor, action: 'adopt', delegationId: id,
        resultRecordId: record.id, requestId: 'adopt-' + id,
        expectedEpoch: control().epoch, expectedRevision: control().revision } as never) as any;
      assert.equal(adoption.status, 'accepted', JSON.stringify(adoption));
    };
    const researcher = await create('researcher'); assert.equal(researcher.status, 'created', JSON.stringify(researcher)); delegations += 1;
    // The worker request's cited evidence is real: every input ref the Team contract hands the
    // researcher is a record this Run holds as current evidence.
    const refs: string[] = researcher.effectiveContract.inputRefs;
    const evidence = new Set((context().evidence ?? []).map(e => e.recordId));
    assert.ok(refs.length > 0 && refs.every(ref => evidence.has(ref) || records().some(r => r.id === ref)),
      `the researcher's input refs are real record ids: ${JSON.stringify({ refs, evidence: [...evidence] })}`);
    await resultAndAdopt(researcher, { schema: 'atcs-worker-research/1', hypotheses: ['upsizing u_a/reg0 shortens the setup path'],
      evidenceRefs: refs, limitations: ['replayed; no model'] });
    const reviewer = await create('reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer)); delegations += 1;
    await resultAndAdopt(reviewer, { schema: 'atcs-worker-review/1', planSha256: planHash, command: 'atcs_size_cell',
      arguments: action, evidenceRefs: reviewer.effectiveContract.inputRefs, limitations: ['replayed; no model'] });
    const operator = await create('operator'); assert.equal(operator.status, 'created', JSON.stringify(operator)); delegations += 1;
    const operatorId = operator.receipt.childSessionId;
    const interactive = (body: any) => host.ctx.hima.interactive(operatorId, { runId, executionId,
      nodeId: 'operate-worker-01', ownerEpoch: control().epoch, controlRevision: control().revision, ...body }) as Promise<any>;
    const opened = await interactive({ action: 'open', requestId: `open-${executionId}` }); assert.equal(opened.status, 'opened', JSON.stringify(opened));
    interactiveOpens += 1;
    const toolSessionId = opened.session.toolSessionId;
    const slotRoot = path.join(workspace, JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8')).workers.w01.root);
    const send = async (name: string, args: any, id: string) => {
      const value = await interactive({ action: 'input', requestId: id, commandId: id, toolSessionId, command: { name, args }, waitMs: 1000 });
      assert.equal(value.status, 'completed', JSON.stringify(value)); return value;
    };
    await send('atcs_dump_cells', { path: path.join(slotRoot, 'before.dump') }, `before-${executionId}`);
    await send('atcs_size_cell', { ...action, planSha256: planHash }, `mutation-${executionId}`);
    await send('atcs_dump_cells', { path: path.join(slotRoot, 'after.dump') }, `after-${executionId}`);
    await send('atcs_export_changes', {}, `export-${executionId}`);
    await send('atcs_close', {}, `exit-${executionId}`);
    await waitUntil('the dry Operator is ready', () => control().executions[executionId]?.phase === 'ready', 10_000, 25);
    await resultAndAdopt(operator, { schema: 'atcs-worker-receipts/1', planSha256: planHash, mutationReceipt: `mutation-${executionId}`,
      limitations: ['synthetic Tcl; no commercial qualification'] });
    const completed = await act('complete', { executionId });
    assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
    log.push(`operate-worker-01 (Team: researcher, reviewer, operator) -> ${context().run.currentNode}`);
  };

  const { observe, reobserve } = await decisions(home.variant);
  const nextDecision = (json: string) => workshopCode('next-decision.py', { __EXAMPLE_JSON__: json });
  const code = {
    diagnose: await workshopCode('diagnose.py', { __SCENARIOS_JSON__: JSON.stringify(SCENARIOS) }),
    plan: await workshopCode('plan.py', { __EXAMPLE_JSON__: await example(home.variant, 'campaign-plan') }),
    research: await workshopCode('research-worker-01.py', { __EXAMPLE_JSON__: await example(home.variant, 'worker-request') }),
    compose: await workshopCode('compose.py'),
  };

  // Generation 1: bind, baseline, the owner's first decision on the baseline itself.
  for (const nodeId of ['bind-inputs', 'read-readiness', 'check-inputs', 'baseline', 'observe-baseline', 'policy',
    'physical-baseline', 'risk-baseline', 'residual-baseline']) await step(nodeId);
  await step('decide-next', await nextDecision(observe));
  for (const nodeId of ['read-next-decision', 'check-next-decision', 'check-continue', 'route-observe']) await step(nodeId);
  await revisit('revisit-observe');

  // Generation 2: diagnose, observe, plan, one worker, compose, replay, pre-check, one refresh.
  let pausedRefusal: string | undefined;
  const batch = async (withObservation: boolean) => {
    if (withObservation) {
      await step('diagnose', code.diagnose);
      for (const nodeId of ['read-observation-request', 'check-observation-request', 'observe-query', 'risk-query']) await step(nodeId);
    }
    await step('plan', code.plan);
    for (const nodeId of ['read-campaign-plan', 'check-campaign-plan', 'prepare-workers']) await step(nodeId);
    await step('research-worker-01', code.research);
    for (const nodeId of ['read-worker-request-01', 'check-worker-request-01']) await step(nodeId);
    await operate();
    await step('capture-worker-01');
    if (pausedRefusal === undefined) {
      // Recovery without a duplicate effect: a person pauses the Campaign here and continues it.
      const paused = await act('pause', { origin: 'human' }); assert.equal(paused.kind, 'accepted', paused.reason);
      const blocked = await act('begin', { nodeId: 'read-worker-result-01' });
      assert.equal(blocked.kind, 'refused', 'no node begins while the Campaign is paused');
      pausedRefusal = blocked.reason;
      const continued = await act('continue', { origin: 'human' }); assert.equal(continued.kind, 'accepted', continued.reason);
      log.push(`pause/continue after capture-worker-01 (begin refused while paused: ${blocked.reason})`);
    }
    for (const nodeId of ['read-worker-result-01', 'collect', 'read-contribution-index', 'compose-facts', 'read-composition-facts']) await step(nodeId);
    await step('compose', code.compose);
    for (const nodeId of ['read-integration-plan', 'check-integration-plan', 'compose-facts-admitted', 'read-composition-facts-admitted',
      'check-composition', 'replay-prepare', 'reconcile', 'read-integration-state', 'check-replay-mismatch', 'check-replay-scope',
      'presta', 'read-precheck', 'check-presta-model', 'read-refresh-budget', 'check-refresh-budget']) await step(nodeId);
  };
  await batch(true);
  for (const nodeId of ['implement', 'extract', 'sta', 'physical-candidate', 'evaluate', 'read-final-evaluation', 'check-final-coverage',
    'check-final-identity', 'check-constraint-failures', 'check-constraint-unknowns', 'check-setup-goal', 'adopt', 'read-acceptance',
    'check-artifact-ready', 'residual', 'record-experience']) await step(nodeId);
  await step('decide-next', await nextDecision(reobserve));
  for (const nodeId of ['read-next-decision', 'check-next-decision', 'check-continue', 'route-observe']) await step(nodeId);
  await revisit('revisit-observe');
  if (generationLimit > 2) {
    // Generation 3: a second batch from the adopted state reaches the refresh-budget gate again.
    await batch(true);
  }
  return { runId, workspace, owner: actor, ownerAgent: owner, stops: log, teamExecutions, delegations, interactiveOpens, pausedRefusal };
}

/** One transcript entry: a tool call, or the closing text. The replay adapter's own chunk grammar. */
const toolCall = (id: string, name: string, args: unknown) => ({ kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
  { type: 'finish', reason: { kind: 'tool-calls' } }] });
const said = (text: string) => ({ kind: 'chunks', chunks: [
  { type: 'block-start', index: 0, blockType: 'text' },
  { type: 'block-end', index: 0, block: { type: 'text', text } },
  { type: 'finish', reason: { kind: 'stop' } }] });

/** Replay `entries` as the next boot's one stage session, in the pack folder, and return its calls. */
async function replaySession(h: HimaHome, name: string, entries: unknown[], packDir: string, line: string) {
  const override = path.join(h.home, `atcs-dry-${name}.override.json`);
  await writeFile(override, JSON.stringify(entries));
  const session = path.join(h.home, `atcs-dry-${name}.session.jsonl`);
  await writeFile(session, JSON.stringify({ version: 0, type: 'session', id: `session-atcs-dry-${name}`, createdAt: 0, cwd: '{{cwd}}' }) + '\n');
  await writeReplayOverlay(h.home, { file: session, overrideFile: override });
  await appendFile(homePatchFile(h.home), QUIET_TITLE_ROW);
  const patch = await readFile(homePatchFile(h.home), 'utf8');
  assert.match(patch, /- id: llm-deepseek\n  disabled: true\n/, 'the model route is the replay adapter, never DeepSeek');
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, packDir);
    await sayAsUser(agent, line);
    return { calls: toolCalls(agent), said: saidByModel(agent), failures: toolResults(agent).filter(r => r.failed).map(r => r.text) };
  } finally { await host.dispose(); }
}

test('ATCS dry path: bind-inputs to an ended-budget-exhausted Run with one worker and one refresh, sealed by /hima-test and /hima-release', async (t) => {
  const home = await prepareHome(t);
  const log: string[] = [];
  const started = Date.now();
  const host = await bootInProcess(home.h);
  let ended = false;
  let result: Drive | undefined;
  t.after(async () => { if (!ended && result) await host.ctx.hima.cancelRun(result.runId).catch(() => undefined); await host.dispose().catch(() => undefined); await home.h.dispose(); });
  try { result = await drive(host, home, 2, log); }
  finally { if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(process.env.HIMA_ATCS_DRY_LOG, log.join('\n') + '\n'); }
  const { runId, workspace } = result;
  const ledger = host.ctx.hima.ledger;
  const run = ledger.run(runId)!;
  const records = ledger.records({ runId });
  const pack = loadPack(home.packsDir, packId);
  const digest = pack.folder.digest(packDigestExcludes);
  const row = `row: source ${packId}@${pack.contract.version}, Pack digest ${digest}, Site local stand-in`;
  const observed = (readerId: string, type: string) => records.filter(r => r.type === 'observation' && (r as any).reader?.id === readerId)
    .flatMap(r => ((r as any).values ?? []).filter((v: any) => v.type === type).map((v: any) => v.value));
  const jobsOf = (nodeId: string) => {
    const sessions = new Set(records.filter(r => r.type === 'node' && r.nodeId === nodeId).map(r => (r as any).jobSession).filter(Boolean));
    return records.filter(r => r.type === 'job' && (r as any).event === 'launched' && sessions.has((r as any).job.session));
  };

  // 1. Plan schema: the replayed plan is admitted.
  assert.deepEqual(observed('atcs-campaign-plan', 'tc_request_invalid_count'), [0], `${row}: the campaign plan is admitted`);

  // 2. Worker: one Team execution, one Operator session, one Contribution.
  assert.equal(result.teamExecutions.length, 1, `${row}: one Team execution`);
  assert.equal(result.delegations, 3, `${row}: researcher, reviewer and operator, once each`);
  assert.equal(result.interactiveOpens, 1, `${row}: one Operator session`);
  const collected = JSON.parse(await readFile(path.join(workspace, 'state/contributions-collected.json'), 'utf8'));
  assert.equal(collected.contributions.length, 1, `${row}: one Contribution collected`);
  assert.deepEqual(collected.contributions[0].operations.map((op: any) => [op.instance, op.toMaster]), [['u_a/reg0', 'BUF2']]);

  // 3. Refresh: one implement/extract/sta chain, one ledger entry, and the budget reader's count.
  for (const nodeId of ['implement', 'extract', 'sta']) assert.equal(jobsOf(nodeId).length, 1, `${row}: ${nodeId} ran once`);
  const refreshLedger = JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8'));
  assert.equal(refreshLedger.entries.length, 1, `${row}: the refresh ledger holds one refresh`);
  assert.deepEqual(observed('atcs-refresh-budget', 'tc_refreshes_completed'), [0], `${row}: the gate read 0 completed refreshes before the one refresh`);
  assert.deepEqual(observed('atcs-acceptance-record', 'tc_refresh_count'), [1], `${row}: the acceptance record counts one refresh`);

  // 4. Budget separation: generation limit 2 and refresh cap 1; the revisit at the end of generation 2
  //    is refused by the generation limit, and the refresh count stays 1.
  assert.equal(run.budget?.generationLimit, 2);
  assert.equal(run.goal?.max_physical_refreshes, REFRESH_CAP, 'the refresh cap is the Goal value the Run was created with');
  assert.equal(run.generation, 2);
  assert.equal(run.status, 'ended-budget-exhausted', `${row}: ${JSON.stringify(run.meters)}`);
  assert.equal((run.meters as any)?.endedBy, 'generation-limit', JSON.stringify(run.meters));

  // 5. Recovery: the pause refused a begin, and continuing duplicated no Job, child or Contribution.
  assert.ok(result.pausedRefusal, 'the paused Campaign refused a new node');
  for (const nodeId of ['capture-worker-01', 'read-worker-result-01', 'collect']) assert.equal(jobsOf(nodeId).length, 1, `${row}: ${nodeId} launched once`);
  assert.equal(runDelegations((host.ctx.hima as any).deps(), runId).length, 3, `${row}: three Team children, no duplicate`);
  assert.equal((await readdir(path.join(workspace, 'contributions'))).length, 1, `${row}: one sealed Contribution file`);

  // 7 (part). Zero EDA: every command the stand-in answered, and only those four tools.
  const standin = (await readFile(home.standinLog, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual([...new Set(standin.map(entry => entry.tool))].sort(), ['StarXtract', 'innovus', 'pt_shell', 'xtop'],
    `${row}: the stand-in answered innovus, StarRC, PrimeTime and the XTop replay batch, and nothing else`);

  // 6. Ending and sealing.
  const retained = records.filter(r => r.type === 'observation' && (r as any).retainedPath);
  assert.ok(retained.length > 0);
  for (const r of retained as any[]) {
    assert.equal(createHash('sha256').update(await readFile(r.retainedPath)).digest('hex'), r.contentSha256, `retained ${r.path}`);
  }
  const ledgerBytes = await readFile(path.join(workspace, 'state/refresh-ledger.json'));
  const archived = await retainRunMaterial({ ledger, packsDir: home.packsDir }, runId, ledgerBytes,
    createHash('sha256').update(ledgerBytes).digest('hex'));
  assert.ok(archived, `${row}: the refresh ledger is archived with the Run`);
  const runBefore = JSON.stringify(ledger.run(runId));
  const recordsBefore = JSON.stringify(ledger.records({ runId }));
  const owned = records.filter(r => r.type === 'code') as any[];
  const refusals = records.filter(r => r.type === 'refusal');
  // 7 (part). Zero model: the owner conversation that drove every node made no tool call of a
  // model's, and every turn it had is the replayed notice acknowledgement, one per Team member.
  const noticeText = 'I acknowledge the retained facts. I will not start another task.';
  assert.deepEqual(toolCalls(result.ownerAgent), [], 'the owner never produced a model tool call');
  assert.deepEqual(saidByModel(result.ownerAgent), Array(result.delegations).fill(noticeText),
    'every owner turn is the replay transcript\'s notice acknowledgement');
  ended = true;
  await host.dispose();

  const generations = [...new Set(records.filter(r => r.type === 'node').map(r => r.generation))].sort();
  const testRecord = [
    '# Test record', '',
    '## Site', '',
    'Run on site `local`. `edaShell` is the dry-path stand-in (test/fixtures/atcs-dry-path/eda-standin.py): no Innovus,',
    'StarRC, PrimeTime or XTop ran. The XTop Operator is the synthetic Tcl REPL under tclsh.', '',
    '## Run', '',
    `run: ${runId}`, '',
    `Goal: target_setup_wns_ns = 0, target_hold_wns_ns = 0. Generation limit 2; refresh cap ${REFRESH_CAP}.`, '',
    '## Ending', '',
    `status: ${run.status}`, '',
    'Ended by the generation limit when the owner chose to observe again at the end of generation 2.', '',
    '## Generations', '',
    ...generations.map(g => `- Generation ${String(g)}: ${records.filter(r => r.type === 'node' && r.generation === g && (r as any).state === 'done').length} nodes completed.`), '',
    '## Code', '',
    ...(owned.length ? owned.map(r => `- ${r.path} sha256 ${r.sha256} (${r.id})`) : ['none']), '',
    '## Refusals', '',
    ...(refusals.length ? refusals.map(r => `- ${r.id}: ${(r as any).reason ?? ''}`) : ['none']), '',
    '## Disagreements', '',
    'none. Every node of the dry path completed on its first attempt.', '',
  ].join('\n');
  const tested = await replaySession(home.h, 'test', [
    toolCall('call-check', 'hima_pack_check', { pack: packId, site: 'local' }),
    toolCall('call-write', 'write', { file_path: 'TEST.md', content: testRecord }),
    toolCall('call-check-again', 'hima_pack_check', { pack: packId, site: 'local' }),
    said(`TEST.md records run ${runId}, ended ${run.status}.`),
  ], home.variant, `/hima-test ${packId} on site local; the run is ${runId}`);
  assert.deepEqual(tested.calls.map(c => c.name), ['hima_pack_check', 'write', 'hima_pack_check'], JSON.stringify(tested));
  assert.deepEqual(tested.failures, [], JSON.stringify(tested.failures));
  const sealHost = await bootInProcess(home.h);
  try {
    const sealedPack = loadPack(home.packsDir, packId);
    const check = checkTestRecord(sealedPack, sealHost.ctx.hima.ledger);
    assert.ok(check, 'the folder holds a test record naming one Run');
    assert.equal(check.error, undefined, `${row}: ${check.error}`);
    const text = await readFile(path.join(home.variant, 'TEST.md'), 'utf8');
    assert.match(text, new RegExp(`^status: ${run.status}$`, 'm'));
    for (const r of owned) assert.ok(text.includes(r.sha256), `TEST.md names code ${r.sha256}`);
    for (const r of refusals) assert.ok(text.includes(r.id), `TEST.md names refusal ${r.id}`);
    assert.deepEqual([...HIMA_TEST_SECTIONS], text.match(/^## (.+)$/gm)!.map(s => s.slice(3)));
  } finally { await sealHost.dispose(); }
  const released = await replaySession(home.h, 'release', [
    toolCall('call-release-check', 'hima_pack_check', { pack: packId, site: 'local' }),
    toolCall('call-release-seal', 'hima_pack_release', { pack: packId }),
    said('Sealed.'),
  ], home.variant, `/hima-release ${packId}`);
  assert.deepEqual(released.calls.map(c => c.name), ['hima_pack_check', 'hima_pack_release'], JSON.stringify(released));
  assert.deepEqual(released.failures, [], JSON.stringify(released.failures));
  assert.equal(packStage(home.variant).stage, 'released', `${row}: the scratch copy is sealed`);
  const version = parse(await readFile(path.join(home.variant, 'VERSION.yml'), 'utf8')) as any;
  assert.equal(version.test.run, runId);
  const after = await bootInProcess(home.h);
  try {
    // Field by field (a reloaded row keeps its values, not its key order).
    assert.deepEqual(JSON.parse(JSON.stringify(after.ctx.hima.ledger.run(runId))), JSON.parse(runBefore), 'sealing changed nothing about the ended Run');
    assert.deepEqual(JSON.parse(JSON.stringify(after.ctx.hima.ledger.records({ runId }))), JSON.parse(recordsBefore), 'sealing changed none of its records');
  } finally { await after.dispose(); }

  // 7 (rest). Zero model: the sealing sessions said exactly the transcript, and the drive's owner
  // conversation never produced a model turn.
  assert.deepEqual(tested.said, [`TEST.md records run ${runId}, ended ${run.status}.`]);
  assert.deepEqual(released.said, ['Sealed.']);
  log.push(`elapsed ${Math.round((Date.now() - started) / 1000)} s`);
  if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(process.env.HIMA_ATCS_DRY_LOG, log.join('\n') + '\n');
});

test('ATCS dry path: with generation limit 3 a second batch stops at the refresh-budget gate, and clearing the wait ends the Run', async (t) => {
  const home = await prepareHome(t);
  const log: string[] = [];
  const host = await bootInProcess(home.h);
  let result: Drive | undefined;
  t.after(async () => { if (result) await host.ctx.hima.cancelRun(result.runId).catch(() => undefined); await host.dispose().catch(() => undefined); await home.h.dispose(); });
  try { result = await drive(host, home, 3, log); }
  finally { if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(`${process.env.HIMA_ATCS_DRY_LOG}.limit3`, log.join('\n') + '\n'); }
  const { runId, workspace } = result;
  const ledger = host.ctx.hima.ledger;
  const pack = loadPack(home.packsDir, packId);
  const row = `row: source ${packId}@${pack.contract.version}, Pack digest ${pack.folder.digest(packDigestExcludes)}, Site local stand-in`;
  const records = () => ledger.records({ runId });
  const run = ledger.run(runId)!;
  assert.equal(run.budget?.generationLimit, 3);
  assert.equal(run.generation, 3);
  assert.equal(run.currentNode, 'wait-for-person', `${row}: ${JSON.stringify({ status: run.status, currentNode: run.currentNode })}`);
  const gate = records().filter(r => r.type === 'node' && r.nodeId === 'check-refresh-budget' && r.state === 'done') as any[];
  assert.deepEqual(gate.map(r => [r.generation, r.outcome]), [[2, 'PASS'], [3, 'FAIL']], `${row}: the gate passed the first refresh and refused the second`);
  const verdict = records().findLast(r => r.type === 'verdict' && (r as any).ruleId === 'refresh-budget') as any;
  assert.equal(verdict.outcome, 'FAIL');
  assert.deepEqual(verdict.valuesAsRead.map((v: any) => [v.type, v.value]), [['tc_refreshes_completed', 1]]);
  assert.equal(run.goal?.max_physical_refreshes, REFRESH_CAP);
  const refreshLedger = JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8'));
  assert.equal(refreshLedger.entries.length, 1, `${row}: no second refresh ran`);
  const sessions = new Set(records().filter(r => r.type === 'node' && r.nodeId === 'implement').map(r => (r as any).jobSession).filter(Boolean));
  assert.equal(sessions.size, 1, `${row}: implement launched once in three generations`);

  // Clearing the wait: a person clears the blocker, and the wait node has no outgoing edge.
  let sequence = 0;
  const control = () => ledger.run(runId)!.control!;
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) =>
    host.ctx.hima.executionAction({ runId, actor: result!.owner, origin: 'agent', action, expectedEpoch: control().epoch,
      expectedRevision: control().revision, requestId: `wait-${++sequence}`, ...fields });
  const begin = await act('begin', { nodeId: 'wait-for-person' }); assert.equal(begin.kind, 'accepted', begin.reason);
  const executionId = begin.receipt!.executionId!;
  const worked = await act('work', { executionId }); assert.notEqual(worked.kind, 'refused', worked.reason);
  await waitUntil('the wait node is ready', () => control().executions[executionId]?.phase === 'ready', 10_000, 25);
  const refused = await act('complete', { executionId });
  assert.equal(refused.kind, 'refused', 'the Agent cannot complete a wait a person has not cleared');
  const cleared = await act('continue', { origin: 'human', nodeId: 'wait-for-person' });
  assert.equal(cleared.kind, 'accepted', cleared.reason);
  const done = await act('complete', { executionId }); assert.equal(done.kind, 'accepted', done.reason);
  const ended = ledger.run(runId)!;
  log.push(`wait-for-person cleared by a person -> ${ended.status}`);
  if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(`${process.env.HIMA_ATCS_DRY_LOG}.limit3`, log.join('\n') + '\n');
  assert.match(String(ended.status), /^ended-/, `${row}: clearing the wait ended the Run: ${String(ended.status)}`);
  assert.equal(JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8')).entries.length, 1);
});
