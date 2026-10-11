// The andes-cell-fmax Pack's whole graph below the GUI, with no model and the mock EDA run locally,
// as an L2 Host test. One round (the default +1 % Goal is met in it) reads
//
//   bind-inputs -> reference-build -> read-reference -> check-reference
//               -> load-timing -> read-timing                               (autopilot; opens the propose fork)
//   himatime-agent || qualib-agent                                          (owner: two resident tasks at once)
//   requirements-joined                                                     (autopilot; hands back)
//   andescell-agent                                                         (owner: one resident task, the plan)
//   generate-cells                                                          (autopilot; opens the verify fork)
//   himatime-verify || qualib-screen                                        (owner: two resident tasks at once)
//   cells-verified -> new-library-build -> compare-round -> read-round -> check-round
//               -> read-round-goal -> judge-round                           (autopilot)
//   next-round                                                              (owner decision; revisits load-timing)
//
// Every tool node is the Pack's own `flow/andes_cli.py` launched as a Job by the real in-process
// Host, calling the Site's mock EDA CLIs (sites/eda_cluster_ctu_01/mock-eda/bin) with
// CTU_MOCK_TIME_SCALE=0; every Reader and Judge is the Pack's own. The owner acts only at the five
// agent nodes and at next-round, through `executionAction` exactly as `hima_execute` does.
//
// What stands in, and only at the model boundary: every resident agent is the ACP stand-in
// `sites/linglong-atcs28/tests/fixtures/acp-standin.py` behind the production resident wrapper
// (sandbox `none`, HIMA_RESIDENT_TESTING=1). The stand-in delivers STANDIN_RESULT_SOURCE and the
// STANDIN_ARTIFACT_SOURCE_ROOT tree when its prompt is answered, so this test stages one agent's
// delivery before starting that agent's task, then the other's; a fork's two tasks stay open
// together. Every delivery is drafted, as the agents' playbooks say, from the Site tools' own output
// (`andes_cli.py draft`), because the Readers hold them against the tools' own answer.
//
// The design data is the Site toolchain's synthetic fixture bundle (CTU_OPENC910_DATA); the real data
// is never needed. Every number below is the fixture's, through the tools; not signoff, not silicon.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { himaChart, type ExecutionActionRequest, type LedgerRecord } from '@hima/harness';
import { repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, hostLog, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { packsDirOf } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'andes-cell-fmax';
const mockRoot = path.join(repoRoot, 'sites/eda_cluster_ctu_01/mock-eda');
const fixture = path.join(mockRoot, 'tests/fixtures/openc910-mini');
const CLAIM = 'Every EDA result in this Pack is replayed by mock tools on a demo Site (mock EDA) from measured flow data;';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_RESIDENT_TESTING = '1';
// A local Job runs in a tmux session whose environment is the tmux server's: set the tool pacing and
// the design data (the synthetic fixture bundle, never the real data) before this file starts its own
// private tmux server, which every Job of this file inherits.
process.env.CTU_MOCK_TIME_SCALE = '0';
process.env.CTU_OPENC910_DATA = fixture;
const tmuxDir = mkdtempSync(path.join(process.env.TMUX_TMPDIR ?? '/tmp', 'ac-'));
process.env.TMUX_TMPDIR = tmuxDir;
process.on('exit', () => { spawnSync('tmux', ['-S', path.join(tmuxDir, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore' }); });

interface Delivery { readonly result: string; readonly support: Record<string, string> }

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const fixtureJson = async (rel: string) => JSON.parse(await readFile(path.join(fixture, rel), 'utf8'));
/** ns to ps as the Pack rounds it (3 decimals). */
const ps = (ns: number) => Math.round(ns * 1e6) / 1e3;

/** Run one Site tool (no pacing, the fixture bundle) and return its stdout. */
function siteTool(name: string, ...argv: string[]): string {
  const run = spawnSync(path.join(mockRoot, 'bin', name), argv, { encoding: 'utf8', env: process.env });
  assert.equal(run.status, 0, `${name} ${argv.join(' ')}: ${run.stderr}`);
  return run.stdout;
}

const readState = async (workspace: string, name: string) => JSON.parse(await readFile(path.join(workspace, 'state', name), 'utf8'));

/** An agent's delivery as its playbook makes it: the Pack's draft from the tool's own output, the
 *  agent's summary, its analysis and the tool reports it ran, as support. `edit` changes the drafted
 *  file to stage a delivery the Reader must refuse. */
async function drafted(workspace: string, kind: string, k: number, node: string, scratch: string,
  { edit, analysis = 'analysis.md' }: { readonly edit?: (doc: any) => void; readonly analysis?: string } = {}): Promise<Delivery> {
  const timing = await readState(workspace, 'timing.json');
  const db = path.join(workspace, timing.buildDir);
  const dir = path.join(scratch, `${node}-r${String(k)}-${analysis}`);
  await rm(dir, { recursive: true, force: true });
  const support: Record<string, string> = {};
  const keep = async (file: string) => { support[`reports/${node}/r${String(k)}/${path.basename(file)}`] = await readFile(file, 'utf8'); };
  let toolJson: string | undefined;
  if (kind === 'himatime') {
    siteTool('himatime', 'highvalue', '--db', db, '--out', path.join(dir, 'hv'), '--quiet');
    siteTool('himatime', 'whatif', '--db', db, '--scale', '0.9', '--out', path.join(dir, 'hw'), '--quiet');
    toolJson = path.join(dir, 'hw/whatif.json');
    await keep(path.join(dir, 'hv/high_value_cells.rpt'));
  } else if (kind === 'qualib') {
    siteTool('himatime', 'whatif', '--db', db, '--scale', '0.9', '--out', path.join(dir, 'hw'), '--quiet');
    siteTool('qualib', 'analyze', '--db', db, '--arcs', path.join(dir, 'hw/whatif.json'), '--out', path.join(dir, 'ql'), '--quiet');
    toolJson = path.join(dir, 'ql/library_analysis.json');
    await keep(path.join(dir, 'ql/library_analysis.rpt'));
  } else if (kind === 'himatime-verify' || kind === 'qualib-screen') {
    const generation = await readState(workspace, 'generation.json');
    siteTool('himatime', 'verify', '--cells', path.join(workspace, generation.dir), '--db', db, '--out', path.join(dir, 'hv'), '--quiet');
    if (kind === 'himatime-verify') { toolJson = path.join(dir, 'hv/verify.json'); await keep(path.join(dir, 'hv/verify.rpt')); }
    else {
      siteTool('qualib', 'screen', '--cells', path.join(dir, 'hv/kept'), '--out', path.join(dir, 'qs'), '--quiet');
      toolJson = path.join(dir, 'qs/screen.json'); await keep(path.join(dir, 'qs/cell_screen.rpt'));
    }
  }
  const run = spawnSync('python3', [path.join(workspace, 'flow/andes_cli.py'), 'draft', workspace, kind, ...(toolJson ? [toolJson] : [])],
    { encoding: 'utf8', env: process.env });
  assert.equal(run.status, 0, `draft ${kind}: ${run.stderr}`);
  const doc = JSON.parse(run.stdout);
  doc.summary = `Round ${String(k)}: the stand-in ${kind} delivery, drafted from the tool's own output.`;
  if ('reason' in doc) doc.reason = 'Every arc both lists allow, at the Site\'s AndesCell settings.';
  doc.report = `reports/${node}/r${String(k)}/${analysis}`;
  edit?.(doc);
  support[doc.report] = `# ${node} round ${String(k)}\n\nStand-in analysis.\n`;
  return { result: json(doc), support };
}

interface Home { readonly h: HimaHome; readonly resultSource: string; readonly supportRoot: string; readonly scratch: string }

async function prepareHome(t: TestContext): Promise<Home> {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  await cp(path.join(repoRoot, 'packs', packId), path.join(packsDirOf(h), packId), { recursive: true, filter: (s) => !s.includes('__pycache__') });
  // The Pack's generated knowledge, written by its generator from the Site's tools (on the fixture).
  const knowledge = spawnSync('python3', [path.join(repoRoot, 'packs', packId, 'flow/knowledge_charts.py'), mockRoot,
    path.join(packsDirOf(h), packId, 'knowledge')], { encoding: 'utf8', env: process.env });
  assert.equal(knowledge.status, 0, knowledge.stderr);
  const wrapper = path.join(repoRoot, 'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
  const native = path.join(repoRoot, 'sites/linglong-atcs28/tests/fixtures/acp-standin.py');
  const admin = path.join(h.workspace, 'resident-admin');
  await mkdir(admin, { recursive: true });
  const resultSource = path.join(admin, 'delivery.json');
  const supportRoot = path.join(admin, 'support');
  const scratch = path.join(admin, 'tools');
  const capability = path.join(admin, 'engineering-capabilities-v1.json');
  await writeFile(capability, `${JSON.stringify({
    schema: 'hima-resident-engineering-capability/1', protocol: 'hima-resident-engineering/1',
    wrapper: { argv: [wrapper, '--capability', capability] },
    native: { executable: native, version: '1.18.34', argv: [], model: 'deepseek/deepseek-flash', protocolVersion: 1 },
    sandbox: { kind: 'none', testOnly: true, privateWorkspace: 'workspace', privateHome: 'home' },
    environment: { inherit: [], set: {
      STANDIN_DESCENDANT_PID: path.join(admin, 'descendant.pid'), STANDIN_PERMISSION_RESPONSE: path.join(admin, 'permission-response.json'),
      STANDIN_RESULT_SOURCE: resultSource, STANDIN_ARTIFACT_SOURCE_ROOT: supportRoot,
    }, toolPaths: [], credentialReadPaths: [] },
    delivery: { candidate: 'resident-delivery.json' }, stopGraceSeconds: 1,
  }, null, 2)}\n`);
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, mockRoot, path.dirname(wrapper), path.dirname(native)],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3', wrapper], parallelJobs: 3,
    bindings: {
      edaRoot: mockRoot, designRoot: fixture, stockLibrary: 'n7-ulvt',
      engineeringCapabilities: capability, workspaceRoot: h.workspace,
    },
  });
  return { h, resultSource, supportRoot, scratch };
}

/** Put one agent's delivery where the resident stand-in reads it on its next answered prompt. */
async function stage(home: Home, delivery: Delivery): Promise<void> {
  await writeFile(home.resultSource, delivery.result);
  await rm(home.supportRoot, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(delivery.support)) {
    await mkdir(path.dirname(path.join(home.supportRoot, rel)), { recursive: true });
    await writeFile(path.join(home.supportRoot, rel), text);
  }
}

type Values = Record<string, number | null>;

async function openRun(host: InProcessHost, home: Home, goal: Record<string, number>) {
  const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', goal, ownerSessionId: actor });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
  const runId = started.run.id; const workspace = started.workspace;
  let sequence = 0;
  const context = () => host.ctx.hima.executionContext(runId);
  const run = () => host.ctx.hima.ledger.run(runId)!;
  const control = () => run().control!;
  const phaseOf = (executionId: string) => control().executions[executionId]?.phase;
  const records = (): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) =>
    host.ctx.hima.executionAction({ runId, actor, origin: 'agent', action, expectedEpoch: control().epoch,
      expectedRevision: control().revision, requestId: `andes-${++sequence}`, ...fields });
  const timeline = () => {
    const all = records(); const t0 = Date.parse(all[0]!.at);
    return all.filter((r) => r.type === 'node' || r.type === 'job')
      .map((r: any) => `${((Date.parse(r.at) - t0) / 1000).toFixed(1)}s ${r.type} ${r.nodeId ?? r.job?.name ?? ''} ${r.state ?? r.event ?? ''}${r.branchId ? ` [${r.branchId}]` : ''}`).join('\n');
  };
  const failure = (what: string) => JSON.stringify({ what, status: run().status, currentNode: run().currentNode, fork: run().fork,
    available: context().available, reason: context().reason,
    blocked: records().filter((r) => r.type === 'node' && (r.state === 'blocked' || r.state === 'cancelled')).slice(-4),
    refusal: records().findLast((r) => r.type === 'refusal') }).slice(0, 6000) + `\n${timeline()}\nHOST LOG TAIL:\n${hostLog(host).slice(-25).join('\n')}`;
  /** The Run stands at one unforked node (or has ended). */
  const reach = async (nodeId: string, timeoutMs = 90_000) => {
    const there = () => (run().fork === undefined && run().currentNode === nodeId && context().available.includes(nodeId)) || String(run().status).startsWith('ended-');
    try { await waitUntil(`the Run reaches ${nodeId}`, there, timeoutMs, 250); } catch (error) { assert.fail(`${(error as Error).message}: ${failure(nodeId)}`); }
    assert.ok(context().available.includes(nodeId), failure(nodeId));
  };
  /** A fork is open and both of its agent nodes are the owner's to begin. */
  const reachFork = async (branches: readonly [string, string], timeoutMs = 90_000) => {
    const there = () => run().fork !== undefined && branches.every((id) => context().available.includes(id));
    try { await waitUntil(`the fork to ${branches.join(' and ')} opens`, there, timeoutMs, 250); } catch (error) { assert.fail(`${(error as Error).message}: ${failure('fork')}`); }
  };
  const doneNodes = () => records().filter((r) => r.type === 'node' && r.state === 'done').map((r) => (r as any).nodeId as string);
  const latestValues = (reader: string, branchId?: string): Values => {
    const found = records().findLast((r) => r.type === 'observation' && (r as any).reader.id === reader && (branchId === undefined || (r as any).branchId === branchId)) as any;
    assert.ok(found, `an observation by ${reader}${branchId ? ` in ${branchId}` : ''}`);
    return Object.fromEntries(found.values.map((v: any) => [v.type, v.value ?? null]));
  };
  const verdicts = (ruleId: string) => records().filter((r) => r.type === 'verdict' && (r as any).ruleId === ruleId).map((r) => (r as any).outcome as string);
  const nativeState = async (taskId: string) => {
    try { return JSON.parse(await readFile(path.join(workspace, '.hima-engineering', taskId, 'state.json'), 'utf8')); } catch { return undefined; }
  };

  /** Begin one agent node and start its resident task on the staged delivery; wait for its answered turn. */
  const startAgent = async (nodeId: string, k: number, delivery: Delivery) => {
    await stage(home, delivery);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', `${nodeId} begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    const start = await act('engineering', { executionId, engineering: { operation: 'start', goal: `Round ${k}: ${nodeId} for openc910. DELIVER_BEST_EFFORT` } });
    assert.equal((start.data as any)?.status, 'started', JSON.stringify(start).slice(0, 3000));
    const taskId = (start.data as any).taskId as string;
    await waitUntil(`${nodeId} round ${k} turn answered`, async () => (await nativeState(taskId))?.phase === 'waiting', 20_000, 100);
    return { nodeId, executionId, taskId };
  };
  type Started = Awaited<ReturnType<typeof startAgent>>;
  /** Collect a Reader-verified delivery (optionally repairing a refused one first), release, complete. */
  const finishAgent = async (task: Started, k: number, repair?: { readonly delivery: Delivery; readonly reader: string }) => {
    let rejectedReason: string | undefined;
    if (repair !== undefined) {
      const first = await act('engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
      assert.equal((first.data as any)?.status, 'reader-rejected', JSON.stringify(first).slice(0, 3000));
      const readerJob = records().findLast((rec: any) => rec.type === 'job' && rec.event === 'finished' && rec.job.name === `reader-${repair.reader}`) as any;
      assert.ok(readerJob, `the ${repair.reader} Reader ran as a Job`);
      rejectedReason = await readFile(path.join(readerJob.job.workspace, `${readerJob.job.session}.log`), 'utf8');
      await stage(home, repair.delivery);
      const message = await act('engineering', { executionId: task.executionId, requestId: `repair-${task.nodeId}-${k}`,
        engineering: { operation: 'message', message: 'Repair the refused delivery. DELIVER_BEST_EFFORT' } });
      assert.equal((message.data as any)?.status, 'accepted', JSON.stringify(message));
      await waitUntil(`${task.nodeId} round ${k} repair turn`, async () => {
        const s = await nativeState(task.taskId); return s?.phase === 'waiting' && s.detail?.completedRequestId === `repair-${task.nodeId}-${k}`;
      }, 20_000, 100);
    }
    const delivery = await act('engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
    assert.equal((delivery.data as any)?.status, 'verified', JSON.stringify(delivery).slice(0, 4000));
    const release = await act('engineering', { executionId: task.executionId, engineering: { operation: 'release' } });
    assert.equal((release.data as any)?.status, 'released', JSON.stringify(release).slice(0, 2000));
    const done = await act('complete', { executionId: task.executionId }); assert.equal(done.kind, 'accepted', `${task.nodeId} complete: ${done.reason}`);
    return { rejectedReason };
  };
  /** The owner's decision at next-round, citing exactly the evidence the Harness names. */
  const decide = async (decision: 'next-strategy' | 'goal-met') => {
    await reach('next-round');
    const begin = await act('begin', { nodeId: 'next-round' }); assert.equal(begin.kind, 'accepted', `next-round begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    assert.notEqual((await act('work', { executionId })).kind, 'refused');
    await waitUntil('next-round settles', () => ['ready', 'failed'].includes(phaseOf(executionId) ?? ''), 30_000, 100);
    const advice = (await act('recommend', { executionId })).data as any;
    const cites = context().cite?.find((item) => item.nodeId === 'next-round')?.cites ?? [];
    const done = await act('complete', { nodeId: 'next-round', executionId, decision, cites: [...cites],
      ...(decision === 'next-strategy' ? { strategy: { roundRevision: 1 } } : {}),
      rationale: `Dry-path owner decision: ${decision} on the cited round verdicts.` });
    return { done, advice };
  };
  return { runId, workspace, context, run, records, act, reach, reachFork, doneNodes, latestValues, verdicts, startAgent, finishAgent, decide, failure, timeline, phaseOf };
}

type RunDriver = Awaited<ReturnType<typeof openRun>>;

/** One round: propose (two agents at once), plan (the AndesCell agent), generate, verify (two
 *  agents at once), then the autopilot rebuilds and compares. The Qualib agent's first list names a
 *  cell Qualib did not analyse, and the HimaTime agent's first check types a kept count HimaTime did
 *  not report: both are refused by their Reader and repaired in the same task. */
async function round(r: RunDriver, home: Home, k: number) {
  // ----- propose: both agents at once, collected in the opposite order to the starts
  await r.reachFork(['himatime-agent', 'qualib-agent']);
  assert.equal(r.run().currentNode, 'requirements-joined', 'inside the propose fork the Run stands at the join');
  const himatime = await drafted(r.workspace, 'himatime', k, 'himatime-agent', home.scratch);
  const qualibWrong = await drafted(r.workspace, 'qualib', k, 'qualib-agent', home.scratch, { edit: (doc) => { doc.cells = [...doc.cells, 'NOPE9X']; } });
  const qualib = await drafted(r.workspace, 'qualib', k, 'qualib-agent', home.scratch, { analysis: 'analysis-2.md' });
  const ht = await r.startAgent('himatime-agent', k, himatime);
  const ql = await r.startAgent('qualib-agent', k, qualibWrong);
  assert.equal(r.phaseOf(ht.executionId), 'working');
  assert.equal(r.phaseOf(ql.executionId), 'working');
  const executions = r.run().control!.executions;
  assert.deepEqual([executions[ht.executionId]!.branchId, executions[ql.executionId]!.branchId], ['himatime-agent', 'qualib-agent']);
  const qualibDone = await r.finishAgent(ql, k, { delivery: qualib, reader: 'andes-requirements' });
  assert.ok(r.run().fork !== undefined, 'one finished branch keeps the fork open');
  await r.finishAgent(ht, k);
  for (const branch of ['himatime-agent', 'qualib-agent']) assert.equal(r.latestValues('andes-requirements', branch).requirements_valid, 1, `${branch} read on its own branch`);

  // ----- plan: the join drives itself and hands the AndesCell agent to the owner
  await r.reach('andescell-agent');
  const plan = await drafted(r.workspace, 'andescell', k, 'andescell-agent', home.scratch);
  const planned = JSON.parse(plan.result).arcs.length as number;
  const ac = await r.startAgent('andescell-agent', k, plan);
  await r.finishAgent(ac, k);
  assert.deepEqual(r.latestValues('andes-plan'), { plan_valid: 1, plan_arcs: planned });

  // ----- generate (autopilot), then verify: both agents at once
  await r.reachFork(['himatime-verify', 'qualib-screen']);
  assert.equal(r.run().currentNode, 'cells-verified', 'inside the verify fork the Run stands at its join');
  const generation = await readState(r.workspace, 'generation.json');
  assert.equal(generation.requested, planned, 'AndesCell generated exactly the plan\'s arcs');
  const checkWrong = await drafted(r.workspace, 'himatime-verify', k, 'himatime-verify', home.scratch, { edit: (doc) => { doc.kept += 1; } });
  const check = await drafted(r.workspace, 'himatime-verify', k, 'himatime-verify', home.scratch, { analysis: 'analysis-2.md' });
  const screen = await drafted(r.workspace, 'qualib-screen', k, 'qualib-screen', home.scratch);
  const hv = await r.startAgent('himatime-verify', k, checkWrong);
  const qs = await r.startAgent('qualib-screen', k, screen);
  assert.deepEqual([r.run().control!.executions[hv.executionId]!.branchId, r.run().control!.executions[qs.executionId]!.branchId], ['himatime-verify', 'qualib-screen']);
  await r.finishAgent(qs, k);
  const verifyDone = await r.finishAgent(hv, k, { delivery: check, reader: 'andes-verify' });
  const kept = JSON.parse(check.result).kept as number;
  const passed = JSON.parse(screen.result).cells.filter((c: any) => c.status === 'PASS').length as number;
  for (const branch of ['himatime-verify', 'qualib-screen']) {
    const values = r.latestValues('andes-verify', branch);
    assert.deepEqual([values.verify_delivery_valid, values.cells_kept, values.cells_passed_screen], [1, kept, passed], `${branch}: the tools' numbers`);
  }
  await r.reach('next-round');
  return { planned, kept, passed, qualibRejected: qualibDone.rejectedReason, verifyRejected: verifyDone.rejectedReason };
}

const HEAD = ['bind-inputs', 'reference-build', 'read-reference', 'check-reference', 'load-timing', 'read-timing'];
const TAIL = ['requirements-joined', 'andescell-agent', 'generate-cells', 'himatime-verify', 'qualib-screen', 'cells-verified', 'new-library-build',
  'compare-round', 'read-round', 'check-round', 'read-round-goal', 'judge-round'];

test('andes dry path: propose, plan, generate, verify and rebuild in one round to the +1 % timing Goal at route, with a chart from every step', async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const pr = await fixtureJson('pr/pr.json');
    const results = await fixtureJson('andescell/results.json');
    const r = await openRun(host, home, { target_timing_gain_pct: 1 });
    // ----- the autopilot runs the reference build and the HimaTime load, then opens the propose fork
    await r.reachFork(['himatime-agent', 'qualib-agent']);
    assert.deepEqual(r.doneNodes(), HEAD, 'reference build and timing drive themselves');
    const ref = pr.reference.route;
    assert.deepEqual(r.latestValues('andes-reference'), { reference_valid: 1, design_wns_ps: ps(ref.wns_ns.reg2reg), design_tns_ns: ref.tns_ns.reg2reg,
      design_nvp: ref.nvp.reg2reg, design_density_pct: ref.density_pct, new_cell_instances: 0, new_cell_pct: 0 });
    assert.deepEqual(r.verdicts('reference-valid'), ['PASS']);
    assert.equal(r.latestValues('andes-timing').timing_wns_ps, ps(ref.wns_ns.reg2reg));
    const inputs = JSON.parse(await readFile(path.join(r.workspace, 'state/inputs.json'), 'utf8'));
    assert.deepEqual(Object.keys(inputs.tools).sort(), ['andescell', 'himatime', 'qualib', 'sapr', 'xtop']);
    assert.match(inputs.tools.xtop.version, /XTop timing ECO \(xtop\) version /);
    assert.equal(inputs.design, 'openc910');

    // ----- round 1, with a refused Qualib list and a refused HimaTime check, each repaired in its task
    const r1 = await round(r, home, 1);
    assert.match(r1.qualibRejected ?? '', /qualib requirements refused: .*1 cell\(s\) are not cells of Qualib's analysis of the what-if arcs: NOPE9X/, r1.qualibRejected);
    assert.match(r1.verifyRejected ?? '', /himatime-verify refused: .*kept must be \d+ \(himatime verify\)/, r1.verifyRejected);
    for (const node of TAIL) assert.ok(r.doneNodes().includes(node), `${node} ran in round 1`);
    assert.deepEqual(r.verdicts('requirements-valid'), ['PASS', 'PASS'], 'the propose join judged each branch PASS');
    assert.equal(r1.planned, (await fixtureJson('himatime/arc_list.json')).arcs.length, 'the plan takes every arc both lists allow');
    assert.equal(r1.kept, results.delivered.length, 'HimaTime keeps the cells with a positive cell-level gain');
    assert.deepEqual(r.verdicts('cells-gain-positive'), ['PASS', 'PASS'], 'the verify join judged each branch');
    assert.deepEqual(r.verdicts('cells-screened'), ['PASS', 'PASS']);
    const build1 = await readState(r.workspace, 'round-build.json');
    assert.equal(build1.acceptedCells.length, r1.passed, 'the rebuild uses the kept and screened cells');
    const custom = pr.custom_model.stages.route;
    const period = (await readState(r.workspace, 'reference.json')).clockPeriodNs;
    const gain = Math.round(10000 * (custom.wns_ns.reg2reg - ref.wns_ns.reg2reg) / period) / 100;
    const f1 = r.latestValues('andes-round');
    assert.deepEqual(f1, { round_valid: 1, timing_gain_pct: gain, best_gain_pct: gain, round_improved: 1, best_wns_ps: ps(custom.wns_ns.reg2reg),
      design_wns_ps: ps(custom.wns_ns.reg2reg), design_tns_ns: custom.tns_ns.reg2reg, design_nvp: custom.nvp.reg2reg, design_density_pct: custom.density_pct,
      new_cell_instances: custom.power.custom_cells, new_cell_pct: custom.power.custom_cells_pct });
    assert.ok(gain >= 1, 'the fixture meets the +1 % Goal');
    assert.deepEqual(r.verdicts('cells-used'), ['PASS']);
    assert.deepEqual(r.verdicts('round-improved'), ['PASS']);
    assert.deepEqual(r.verdicts('timing-goal'), ['PASS'], 'one round meets the +1 % Goal');
    const end = await r.decide('goal-met');
    assert.equal(end.done.kind, 'accepted', `goal-met: ${end.done.reason}`);
    assert.equal(end.advice?.chosen?.goalMet, true, JSON.stringify(end.advice));
    assert.equal(r.run().status, 'ended-goal-met', r.failure('goal-met'));

    const summary = await readFile(path.join(r.workspace, 'derived/summary.md'), 'utf8');
    assert.ok(summary.includes(`Claim boundary: ${CLAIM}`), summary);
    const record = await readState(r.workspace, 'round.json');
    assert.ok(record.claimBoundary.startsWith(CLAIM));
    assert.equal(record.cellsKept, r1.kept);

    // ----- every tool and agent node of the round left a human-readable report at reports/<node>/r1/
    const report = (rel: string) => readFile(path.join(r.workspace, 'reports', rel), 'utf8');
    const STEPS = ['bind-inputs', 'reference-build', 'load-timing', 'himatime-agent', 'qualib-agent', 'andescell-agent', 'generate-cells',
      'himatime-verify', 'qualib-screen', 'new-library-build', 'compare-round'];
    for (const node of STEPS) {
      const files = await readdir(path.join(r.workspace, 'reports', node, 'r1'));
      assert.ok(files.some((name) => /\.(rpt|md|tarpt)$/.test(name)), `${node} r1 has a report: ${files.join(', ')}`);
    }
    assert.match(await report('bind-inputs/r1/tools.rpt'), /openc910 \(stock libraries n7-ulvt; full flow to route, path group reg2reg\)/);
    for (const name of ['route.summary.rpt', 'route_reg2reg.tarpt', 'cts.summary.rpt', 'flow_summary.rpt']) assert.ok((await report(`reference-build/r1/${name}`)).length > 0, name);
    assert.ok((await report('load-timing/r1/stage_breakdown.rpt')).length > 0);
    for (const node of ['himatime-agent', 'andescell-agent', 'qualib-screen']) assert.ok((await report(`${node}/r1/analysis.md`)).length > 0, `${node} r1 analysis`);
    for (const rel of ['qualib-agent/r1/analysis-2.md', 'himatime-verify/r1/analysis-2.md', 'himatime-agent/r1/high_value_cells.rpt',
      'qualib-agent/r1/library_analysis.rpt', 'himatime-verify/r1/verify.rpt', 'qualib-screen/r1/cell_screen.rpt', 'generate-cells/r1/generation.rpt']) {
      assert.ok((await report(rel)).length > 0, rel);
    }
    assert.match(await report('compare-round/r1/round-1.md'), /# Round 1:/);
    assert.match(await report('compare-round/r1/round-1.md'), /These are results on the demo Site eda_cluster_ctu_01, not signoff and not silicon\./);
    for (const name of ['route.summary.rpt', 'flow_summary.rpt', 'report_timing.rpt']) assert.ok((await report(`new-library-build/r1/${name}`)).length > 0, `rebuild r1 ${name}`);
    for (const rel of ['bind-inputs/r1/tools.rpt', 'load-timing/r1/report_timing.rpt', 'reference-build/r1/route.summary.rpt', 'generate-cells/r1/generation.rpt',
      'compare-round/r1/round-1.md', 'new-library-build/r1/route.summary.rpt']) {
      assert.doesNotMatch(await report(rel), /mock|model/i, `${rel} reads as a tool report`);
    }

    // ----- the charts: hima-chart/1 files written by the Pack's steps and Readers from the tools' own numbers
    const chartOf = async (rel: string) => {
      const text = await report(rel);
      assert.doesNotMatch(text, /mock|model|\bFmax\b/, `${rel} reads as plain words`);
      return himaChart.parse(JSON.parse(text));
    };
    const refSummary = await chartOf('reference-build/r1/summary.chart.json');
    assert.equal(refSummary.kind, 'metrics');
    assert.deepEqual(refSummary.series[0]!.values.slice(0, 3), [ps(ref.wns_ns.reg2reg), ref.tns_ns.reg2reg, ref.nvp.reg2reg]);
    const groups = await chartOf('reference-build/r1/path-groups.chart.json');
    assert.equal(groups.kind, 'metrics');
    assert.deepEqual(groups.categories.slice(0, 3), ['reg2reg worst slack', 'reg2reg TNS', 'reg2reg violating']);
    const refStages = await chartOf('reference-build/r1/flow-stages.chart.json');
    assert.deepEqual(refStages.categories, ['prePlace', 'place_opt', 'CTS', 'route']);
    assert.equal(refStages.series[0]!.values.at(-1), ps(ref.wns_ns.reg2reg));
    assert.equal((await chartOf('reference-build/r1/timing.chart.json')).series[0]!.values[0], ps(ref.wns_ns.reg2reg));
    assert.ok((await chartOf('load-timing/r1/stage-breakdown.chart.json')).categories.includes('SRAM access'));
    const funnel = await chartOf('himatime-agent/r1/funnel.chart.json');
    assert.equal(funnel.series[0]!.values[0], (await fixtureJson('himatime/high_value.json')).design_cells);
    assert.match((await chartOf('himatime-agent/r1/proposal.chart.json')).title, /^Why these arcs/);
    assert.deepEqual((await chartOf('qualib-agent/r1/proposal.chart.json')).series.map((x) => x.name), ['ULVT', 'LVT', 'SVT']);
    assert.deepEqual((await chartOf('generate-cells/r1/generation.chart.json')).series[0]!.values.slice(0, 3), [results.requested_arcs, results.generated, results.failed]);
    assert.match((await chartOf('himatime-verify/r1/cell-check.chart.json')).subtitle ?? '', new RegExp(`^${String(r1.kept)} of ${String(results.generated)} `));
    assert.equal((await chartOf('himatime-verify/r1/top-cells.chart.json')).kind, 'metrics');
    assert.equal((await chartOf('qualib-screen/r1/screen.chart.json')).series[0]!.values[1], r1.passed);
    const compare = await chartOf('compare-round/r1/comparison.chart.json');
    assert.equal(compare.kind, 'metrics');
    assert.equal(compare.categories.at(-1), 'Timing gain');
    assert.deepEqual(compare.series.map((x) => [x.name, x.role]), [['Reference build', 'baseline'], ['Round 1 custom cells', 'measured']]);
    assert.deepEqual(compare.series.map((x) => x.values[0]), [ps(ref.wns_ns.reg2reg), ps(custom.wns_ns.reg2reg)]);
    assert.deepEqual(compare.series.map((x) => x.values.at(-1)), [0, gain]);
    assert.equal((await chartOf('compare-round/r1/flow-stages.chart.json')).series.length, 2);
    assert.equal((await chartOf('compare-round/r1/path-groups.chart.json')).series.length, 2);
    const worst = await chartOf('compare-round/r1/worst-paths.chart.json');
    assert.deepEqual(worst.series[1]!.values, custom.worst_paths.slice(0, 8).map((p: any) => ps(p.slack_ns)));
    t.diagnostic(`gain ${String(gain)} % of the clock; kept ${String(r1.kept)}; run ${r.runId} ended ${r.run().status}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
