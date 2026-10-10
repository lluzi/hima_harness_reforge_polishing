// The andes-cell-fmax Pack's whole graph below the GUI, with no model and the mock EDA run locally,
// as an L2 Host test. One round reads
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
// together. The verify deliveries carry the numbers this test reads from the same mock tools an
// agent would run, because the Reader holds them against the tools' own answer.
//
// Every number below is a mock-EDA model number of the demo Site; not signoff, not silicon.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { ExecutionActionRequest, LedgerRecord } from '@hima/harness';
import { repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, hostLog, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { packsDirOf } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'andes-cell-fmax';
const mockRoot = path.join(repoRoot, 'sites/eda_cluster_ctu_01/mock-eda');
const CLAIM = 'Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); not signoff, not silicon.';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_RESIDENT_TESTING = '1';
// A local Job runs in a tmux session whose environment is the tmux server's: set the mock pacing
// before this file starts its own private tmux server, which every Job of this file inherits.
process.env.CTU_MOCK_TIME_SCALE = '0';
const tmuxDir = mkdtempSync(path.join(process.env.TMUX_TMPDIR ?? '/tmp', 'ac-'));
process.env.TMUX_TMPDIR = tmuxDir;
process.on('exit', () => { spawnSync('tmux', ['-S', path.join(tmuxDir, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore' }); });

type Agent = 'himatime' | 'qualib';
interface Delivery { readonly result: string; readonly support: Record<string, string> }

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** One agent's requirements for round k: the result bytes and its analysis.md support file. */
function requirements(agent: Agent, k: number, families: readonly string[], { analysis = `# ${agent} round ${k}\n\nStand-in analysis.\n` } = {}): Delivery {
  const report = `reports/${agent}-agent/r${k}/analysis.md`;
  return { result: json({
    schema: 'hima-andes-requirements/1', agent, round: k,
    summary: `Round ${k}: the worst paths need faster ${families.join(' and ')} cells.`,
    requirements: families.map((family, i) => ({ family, purpose: `faster ${family} on the worst paths`,
      target: 'cell delay -30 % at fanout 4', evidence: `stage breakdown of round ${k}`, priority: i + 1 })),
    report,
  }), support: { [report]: analysis, [`reports/${agent}-agent/r${k}/${agent === 'himatime' ? 'stage_breakdown.rpt' : 'library_analysis.rpt'}`]: `stand-in ${agent} tool report, round ${k}\n` } };
}

/** Run one mock EDA CLI of the Site (no pacing) and return its stdout. */
function mockTool(name: string, ...argv: string[]): string {
  const run = spawnSync(path.join(mockRoot, 'bin', name), argv, { encoding: 'utf8', env: { ...process.env, CTU_MOCK_TIME_SCALE: '0' } });
  assert.equal(run.status, 0, `${name} ${argv.join(' ')}: ${run.stderr}`);
  return run.stdout;
}

const readState = async (workspace: string, name: string) => JSON.parse(await readFile(path.join(workspace, 'state', name), 'utf8'));

/** The AndesCell agent's plan, as its playbook says: the requested new families with the most
 *  HimaTime estimated recovery, at most two; every other requested one skipped with a reason. */
async function plan(workspace: string, k: number): Promise<Delivery & { readonly families: string[] }> {
  const timing = await readState(workspace, 'timing.json');
  const library = await readState(workspace, 'library.json');
  const recovery = new Map<string, number>(timing.stageBreakdown.map((r: any) => [r.family, r.estRecoveryNs]));
  const requested: string[] = [];
  for (const agent of ['himatime', 'qualib']) {
    for (const r of (await readState(workspace, `${agent}-requirements.json`)).requirements) if (!requested.includes(r.family)) requested.push(r.family);
  }
  const candidates = requested.filter((f) => !library.families.includes(f)).sort((a, b) => (recovery.get(b) ?? 0) - (recovery.get(a) ?? 0));
  const families = candidates.slice(0, 2);
  const report = `reports/andescell-agent/r${k}/analysis.md`;
  return { families, result: json({
    schema: 'hima-andes-plan/1', agent: 'andescell', round: k,
    summary: `Round ${k}: ${families.join(' and ')} have the most estimated recovery of the requested families.`,
    families: families.map((family) => ({ family, reason: `estimated recovery ${String(recovery.get(family))} ns, among the highest requested`, estRecoveryNs: recovery.get(family) })),
    skipped: candidates.slice(2).map((family) => ({ family, reason: `lower estimated recovery (${String(recovery.get(family) ?? 0)} ns)` })),
    report,
  }), support: { [report]: `# AndesCell round ${k}\n\nStand-in choice: ${families.join(', ')}.\n`, [`reports/andescell-agent/r${k}/dry_run.rpt`]: 'stand-in dry run\n' } };
}

/** The two verify deliveries of round k, from the same tools an agent runs (HimaTime verify, Qualib screen). */
async function verifyDeliveries(workspace: string, k: number, scratch: string, { gainOffsetPs = 0 } = {}) {
  const timing = await readState(workspace, 'timing.json');
  const generation = await readState(workspace, 'generation.json');
  const cells = path.join(workspace, generation.dir);
  const db = path.join(workspace, timing.buildDir);
  const hv = path.join(scratch, `hv-r${k}-${String(gainOffsetPs)}`), qs = path.join(scratch, `qs-r${k}`);
  await rm(hv, { recursive: true, force: true }); await rm(qs, { recursive: true, force: true });
  mockTool('himatime', 'verify', '--cells', cells, '--db', db, '--paths', '8', '--out', hv, '--quiet');
  mockTool('qualib', 'screen', '--cells', cells, '--out', qs, '--quiet');
  const v = JSON.parse(await readFile(path.join(hv, 'verify.json'), 'utf8'));
  const s = JSON.parse(await readFile(path.join(qs, 'screen.json'), 'utf8'));
  const ht = `reports/himatime-verify/r${k}`, ql = `reports/qualib-screen/r${k}`;
  // A refused delivery's support stays published, so its repair names a fresh analysis file.
  const analysis = gainOffsetPs === 0 ? 'analysis.md' : 'analysis-0.md';
  const timingDelivery: Delivery = { result: json({
    schema: 'hima-andes-cell-timing/1', agent: 'himatime', round: k,
    summary: `Round ${k}: the worst path ${String(v.local.worstPath)} is ${String(v.local.localGainPs)} ps faster with the new cells.`,
    worstPath: v.local.worstPath, localGainPs: v.local.localGainPs + gainOffsetPs,
    paths: v.local.paths.map((p: any) => ({ id: p.id, beforePs: p.beforePs, afterPs: p.afterPs, gainPs: p.gainPs })),
    cells: v.cells.map((c: any) => ({ name: c.name, fo4Ps: c.fo4DelayPs, stockCell: c.stockCell, stockFo4Ps: c.stockFo4DelayPs })),
    report: `${ht}/${analysis}`,
  }), support: { [`${ht}/${analysis}`]: `# HimaTime verify round ${k}\n`, [`${ht}/verify.rpt`]: await readFile(path.join(hv, 'verify.rpt'), 'utf8') } };
  const screenDelivery: Delivery = { result: json({
    schema: 'hima-andes-cell-screen/1', agent: 'qualib', round: k,
    summary: `Round ${k}: ${String(s.passed.length)} of ${String(s.cells.length)} new cells pass the screen.`,
    cells: s.cells.map((c: any) => ({ name: c.name, status: c.status, reasons: c.reasons })),
    report: `${ql}/analysis.md`,
  }), support: { [`${ql}/analysis.md`]: `# Qualib screen round ${k}\n`, [`${ql}/cell_screen.rpt`]: await readFile(path.join(qs, 'cell_screen.rpt'), 'utf8') } };
  return { timing: timingDelivery, screen: screenDelivery, localGainPs: v.local.localGainPs as number, worstPath: v.local.worstPath as string, passed: s.passed.length as number };
}

interface Home { readonly h: HimaHome; readonly resultSource: string; readonly supportRoot: string; readonly scratch: string }

async function prepareHome(t: TestContext): Promise<Home> {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  await cp(path.join(repoRoot, 'packs', packId), path.join(packsDirOf(h), packId), { recursive: true, filter: (s) => !s.includes('__pycache__') });
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
      edaRoot: mockRoot, designRoot: path.join(mockRoot, 'share/designs/aes_cipher_top'), stockLibrary: 'std9t_svt',
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
    const start = await act('engineering', { executionId, engineering: { operation: 'start', goal: `Round ${k}: ${nodeId} for aes_cipher_top. DELIVER_BEST_EFFORT` } });
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

interface RoundRepairs { readonly qualib?: Delivery; readonly verifyGainOffsetPs?: number }

/** One round: propose (two agents at once), choose (the AndesCell agent), generate, verify (two
 *  agents at once), then the autopilot rebuilds and compares. */
async function round(r: RunDriver, home: Home, k: number, himatime: Delivery, qualib: Delivery, repairs: RoundRepairs = {}) {
  // ----- propose: both agents at once, collected in the opposite order to the starts
  await r.reachFork(['himatime-agent', 'qualib-agent']);
  assert.equal(r.run().currentNode, 'requirements-joined', 'inside the propose fork the Run stands at the join');
  const ht = await r.startAgent('himatime-agent', k, himatime);
  const ql = await r.startAgent('qualib-agent', k, qualib);
  assert.equal(r.phaseOf(ht.executionId), 'working');
  assert.equal(r.phaseOf(ql.executionId), 'working');
  const executions = r.run().control!.executions;
  assert.deepEqual([executions[ht.executionId]!.branchId, executions[ql.executionId]!.branchId], ['himatime-agent', 'qualib-agent']);
  const qualibDone = await r.finishAgent(ql, k, repairs.qualib === undefined ? undefined : { delivery: repairs.qualib, reader: 'andes-requirements' });
  assert.ok(r.run().fork !== undefined, 'one finished branch keeps the fork open');
  await r.finishAgent(ht, k);
  for (const branch of ['himatime-agent', 'qualib-agent']) assert.equal(r.latestValues('andes-requirements', branch).requirements_valid, 1, `${branch} read on its own branch`);

  // ----- choose: the join drives itself and hands the AndesCell agent to the owner
  await r.reach('andescell-agent');
  const chosen = await plan(r.workspace, k);
  const ac = await r.startAgent('andescell-agent', k, chosen);
  await r.finishAgent(ac, k);
  assert.deepEqual(r.latestValues('andes-plan'), { plan_valid: 1, plan_families: chosen.families.length, plan_follows_ranking: 1 });

  // ----- generate (autopilot), then verify: both agents at once
  await r.reachFork(['himatime-verify', 'qualib-screen']);
  assert.equal(r.run().currentNode, 'cells-verified', 'inside the verify fork the Run stands at its join');
  const generation = await readState(r.workspace, 'generation.json');
  assert.deepEqual(generation.selected, chosen.families, 'AndesCell built exactly the plan\'s families');
  const checks = await verifyDeliveries(r.workspace, k, home.scratch);
  const wrong = repairs.verifyGainOffsetPs === undefined ? undefined : await verifyDeliveries(r.workspace, k, home.scratch, { gainOffsetPs: repairs.verifyGainOffsetPs });
  const hv = await r.startAgent('himatime-verify', k, wrong?.timing ?? checks.timing);
  const qs = await r.startAgent('qualib-screen', k, checks.screen);
  assert.deepEqual([r.run().control!.executions[hv.executionId]!.branchId, r.run().control!.executions[qs.executionId]!.branchId], ['himatime-verify', 'qualib-screen']);
  await r.finishAgent(qs, k);
  const verifyDone = await r.finishAgent(hv, k, wrong === undefined ? undefined : { delivery: checks.timing, reader: 'andes-verify' });
  for (const branch of ['himatime-verify', 'qualib-screen']) {
    const values = r.latestValues('andes-verify', branch);
    assert.deepEqual([values.verify_delivery_valid, values.local_gain_ps, values.cells_passed_screen], [1, checks.localGainPs, checks.passed], `${branch}: the tools' numbers`);
  }
  await r.reach('next-round');
  return { ht, ql, ac, chosen, checks, qualibRejected: qualibDone.rejectedReason, verifyRejected: verifyDone.rejectedReason };
}

const HEAD = ['bind-inputs', 'reference-build', 'read-reference', 'check-reference', 'load-timing', 'read-timing'];
const TAIL = ['requirements-joined', 'andescell-agent', 'generate-cells', 'himatime-verify', 'qualib-screen', 'cells-verified', 'new-library-build',
  'compare-round', 'read-round', 'check-round', 'read-round-goal', 'judge-round'];

test('andes dry path: propose, choose, generate, verify and rebuild each round, three rounds to a 5 % Fmax gain, goal-met', async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const r = await openRun(host, home, { target_fmax_gain_pct: 5 });
    // ----- the autopilot runs the reference build and the HimaTime load, then opens the propose fork
    await r.reachFork(['himatime-agent', 'qualib-agent']);
    assert.deepEqual(r.doneNodes(), HEAD, 'reference build and timing drive themselves');
    assert.deepEqual(r.latestValues('andes-reference'), { reference_valid: 1, design_fmax_mhz: 957.67, design_wns_ns: -0.0442,
      design_tns_ns: -3.213, design_area_um2: 41200, new_cell_instances: 0, route_drc_errors: 0 });
    assert.deepEqual(r.verdicts('reference-valid'), ['PASS']);
    assert.equal(r.latestValues('andes-timing').timing_fmax_mhz, 957.67);
    const inputs = JSON.parse(await readFile(path.join(r.workspace, 'state/inputs.json'), 'utf8'));
    assert.deepEqual(Object.keys(inputs.tools).sort(), ['andescell', 'himatime', 'qualib', 'sapr', 'xtop']);
    assert.match(inputs.tools.xtop.version, /XTop timing ECO \(xtop\) version /);

    // ----- round 1: XNOR3 and BUF; the Qualib agent's first list names a family AndesCell cannot
    // build, and the HimaTime agent's first verification types a local gain HimaTime did not report
    const r1 = await round(r, home, 1, requirements('himatime', 1, ['XNOR3', 'BUF', 'XOR2']), requirements('qualib', 1, ['FULLADDER', 'XNOR3']),
      { qualib: requirements('qualib', 1, ['XNOR3', 'BUF', 'MUX2I']), verifyGainOffsetPs: 12 });
    assert.match(r1.qualibRejected ?? '', /qualib requirements refused: .*family 'FULLADDER' is not an AndesCell family/, r1.qualibRejected);
    assert.match(r1.verifyRejected ?? '', /himatime-verify refused: .*localGainPs must be HimaTime's gain on the worst path, 168\.48 ps/, r1.verifyRejected);
    for (const node of TAIL) assert.ok(r.doneNodes().includes(node), `${node} ran in round 1`);
    assert.deepEqual(r.verdicts('requirements-valid'), ['PASS', 'PASS'], 'the propose join judged each branch PASS');
    assert.deepEqual(r1.chosen.families, ['XNOR3', 'BUF']);
    assert.deepEqual([r1.checks.worstPath, r1.checks.localGainPs], ['A1', 168.48], 'HimaTime: the worst path is 168.48 ps faster with the new cells');
    assert.deepEqual(r.verdicts('local-gain-positive'), ['PASS', 'PASS'], 'the verify join judged each branch');
    assert.deepEqual(r.verdicts('cells-screened'), ['PASS', 'PASS']);
    const screen1 = await readState(r.workspace, 'qualib-screen.json');
    assert.deepEqual(screen1.cells.filter((c: any) => c.status === 'FAIL').map((c: any) => c.name).sort(), ['ANDES_BUF_XF8_R1', 'ANDES_XNOR3_XF4_R1']);
    const build1 = await readState(r.workspace, 'round-build.json');
    assert.ok(build1.acceptedCells.every((c: string) => !c.includes('_XF')), 'the rebuild uses only cells that passed the screen');
    const f1 = r.latestValues('andes-round');
    assert.equal(f1.round_valid, 1);
    assert.equal(f1.fmax_gain_pct, 2.5);
    assert.equal(f1.design_fmax_mhz, 981.64);
    assert.ok((f1.new_cell_instances ?? 0) > 0);
    assert.deepEqual(r.verdicts('cells-used'), ['PASS']);
    assert.deepEqual(r.verdicts('round-improved'), ['PASS']);
    assert.deepEqual(r.verdicts('fmax-goal'), ['FAIL']);
    const next1 = await r.decide('next-strategy');
    assert.equal(next1.done.kind, 'accepted', `next-strategy: ${next1.done.reason}`);
    assert.equal(next1.advice?.chosen?.strategy?.roundRevision, 1, JSON.stringify(next1.advice));

    // ----- round 2: HimaTime starts from the round-1 build; XOR2 and MUX2I
    const r2 = await round(r, home, 2, requirements('himatime', 2, ['XOR2', 'MUX2I', 'XNOR3']), requirements('qualib', 2, ['MUX2I', 'XOR2']));
    assert.notEqual(r2.ht.taskId, r1.ht.taskId, 'the revisit opened new resident tasks');
    const timing2 = await readState(r.workspace, 'timing.json');
    assert.equal(timing2.source, 'round 1 new-library build');
    assert.deepEqual(r2.chosen.families, ['XOR2', 'MUX2I']);
    assert.equal(r2.checks.worstPath, 'B1');
    assert.ok(r2.checks.localGainPs > 0);
    assert.equal(r.latestValues('andes-round').fmax_gain_pct, 3.4);
    const next2 = await r.decide('next-strategy');
    assert.equal(next2.done.kind, 'accepted', `next-strategy: ${next2.done.reason}`);

    // ----- round 3: AOI21 and OAI21 reach the Goal
    const r3 = await round(r, home, 3, requirements('himatime', 3, ['AOI21', 'OAI21']), requirements('qualib', 3, ['OAI21', 'AOI21', 'NOR2']));
    assert.deepEqual(r3.chosen.families, ['AOI21', 'OAI21']);
    assert.equal(r3.checks.worstPath, 'C1');
    assert.ok(r3.checks.localGainPs > 0);
    const f3 = r.latestValues('andes-round');
    assert.equal(f3.fmax_gain_pct, 5.2);
    assert.equal(f3.best_gain_pct, 5.2);
    assert.equal(f3.design_fmax_mhz, 1007.46);
    assert.ok((f3.design_wns_ns ?? -1) > 0, 'timing met at 1.000 ns');
    assert.deepEqual(r.verdicts('fmax-goal'), ['FAIL', 'FAIL', 'PASS']);
    assert.deepEqual(r.verdicts('requirements-valid'), Array(6).fill('PASS'), 'two branches a round, three rounds');
    assert.deepEqual(r.verdicts('local-gain-positive'), Array(6).fill('PASS'));
    const end = await r.decide('goal-met');
    assert.equal(end.done.kind, 'accepted', `goal-met: ${end.done.reason}`);
    assert.equal(r.run().status, 'ended-goal-met', r.failure('goal-met'));

    const summary = await readFile(path.join(r.workspace, 'derived/summary.md'), 'utf8');
    assert.ok(summary.includes(`Claim boundary: ${CLAIM}`), summary);
    assert.match(summary, /\| 3 \| AOI21, OAI21 \| 1007\.46 \| 5\.20 % \|/);
    const record = await readState(r.workspace, 'round.json');
    assert.equal(record.claimBoundary, CLAIM);
    assert.deepEqual(record.cumulativeFamilies, ['AOI21', 'BUF', 'MUX2I', 'OAI21', 'XNOR3', 'XOR2']);
    assert.equal(record.localGainPs, r3.checks.localGainPs);

    // ----- every tool and agent left its reports at reports/<node>/r<k>/
    const report = (rel: string) => readFile(path.join(r.workspace, 'reports', rel), 'utf8');
    assert.match(await report('bind-inputs/r1/tools.rpt'), /AndesCell families/);
    for (const name of ['report_qor.rpt', 'postroute_timing.rpt', 'area.rpt', 'route_drc.rpt']) assert.ok((await report(`reference-build/r1/${name}`)).length > 0, name);
    assert.match(await report('reference-build/r1/postroute_timing.rpt'), /\(VIOLATED\)/);
    for (const k of [1, 2, 3]) {
      assert.match(await report(`load-timing/r${k}/report_timing.rpt`), /slack \(VIOLATED\)/);
      assert.match(await report(`load-timing/r${k}/stage_breakdown.rpt`), /Stage breakdown by cell family/);
      for (const node of ['himatime-agent', 'qualib-agent', 'andescell-agent', 'himatime-verify', 'qualib-screen']) {
        assert.ok((await report(`${node}/r${k}/analysis.md`)).length > 0, `${node} r${k} analysis`);
      }
      assert.ok((await report(`himatime-agent/r${k}/stage_breakdown.rpt`)).length > 0);
      assert.ok((await report(`qualib-agent/r${k}/library_analysis.rpt`)).length > 0);
      assert.match(await report(`generate-cells/r${k}/generation.rpt`), /AndesCell generation report/);
      assert.match(await report(`himatime-verify/r${k}/verify.rpt`), /Local gain on the worst path/);
      assert.match(await report(`qualib-screen/r${k}/cell_screen.rpt`), /cell\(s\) pass the screen/);
      assert.match(await report(`compare-round/r${k}/round-${k}.md`), new RegExp(`# Round ${k}:`));
      for (const name of ['report_qor.rpt', 'postroute_timing.rpt', 'area.rpt', 'route_drc.rpt', 'report_timing.rpt']) assert.ok((await report(`new-library-build/r${k}/${name}`)).length > 0, `rebuild r${k} ${name}`);
    }
    assert.match(await report('new-library-build/r3/report_timing.rpt'), /slack \(MET\)/);
    for (const rel of ['load-timing/r1/report_timing.rpt', 'reference-build/r1/report_qor.rpt', 'generate-cells/r1/generation.rpt', 'himatime-verify/r1/verify.rpt']) {
      assert.doesNotMatch(await report(rel), /mock/i, `${rel} reads as a tool report`);
    }
    t.diagnostic(`gains 2.50 / 3.40 / 5.20 %; local gains ${String(r1.checks.localGainPs)} / ${String(r2.checks.localGainPs)} / ${String(r3.checks.localGainPs)} ps; run ${r.runId} ended ${r.run().status}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
