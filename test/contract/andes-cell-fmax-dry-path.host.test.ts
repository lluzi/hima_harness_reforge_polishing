// The andes-cell-fmax Pack's whole graph below the GUI, with no model and the mock EDA run locally,
// as an L2 Host test. One round reads
//
//   bind-inputs -> reference-build -> read-reference -> check-reference
//               -> load-timing -> read-timing                               (autopilot; opens the fork)
//   himatime-agent || qualib-agent                                          (owner: two resident tasks at once)
//   requirements-joined -> generate-cells -> screen-cells -> verify-cells
//               -> new-library-build -> compare-round -> read-round -> check-round
//               -> read-round-goal -> judge-round                           (autopilot)
//   next-round                                                              (owner decision; revisits load-timing)
//
// Every tool node is the Pack's own `flow/andes_cli.py` launched as a Job by the real in-process
// Host, calling the Site's mock EDA CLIs (sites/eda_cluster_ctu_01/mock-eda/bin) with
// CTU_MOCK_TIME_SCALE=0; every Reader and Judge is the Pack's own. The owner acts only at the two
// agent nodes and at next-round, through `executionAction` exactly as `hima_execute` does.
//
// What stands in, and only at the model boundary: both resident agents are the ACP stand-in
// `sites/linglong-atcs28/tests/fixtures/acp-standin.py` behind the production resident wrapper
// (sandbox `none`, HIMA_RESIDENT_TESTING=1). The stand-in delivers STANDIN_RESULT_SOURCE and the
// STANDIN_ARTIFACT_SOURCE_ROOT tree when its prompt is answered, so this test stages one agent's
// requirements before starting that agent's task, then the other's; both tasks stay open together.
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

/** One agent's requirements for round k: the result bytes and its analysis.md support file. */
function requirements(agent: Agent, k: number, families: readonly string[], { analysis = `# ${agent} round ${k}\n\nStand-in analysis.\n` } = {}): Delivery {
  const report = `requirements/${agent}/r${k}/analysis.md`;
  const doc = {
    schema: 'hima-andes-requirements/1', agent, round: k,
    summary: `Round ${k}: the worst paths need faster ${families.join(' and ')} cells.`,
    requirements: families.map((family, i) => ({ family, purpose: `faster ${family} on the worst paths`,
      target: 'cell delay -30 % at fanout 4', evidence: `stage breakdown of round ${k}`, priority: i + 1 })),
    report,
  };
  return { result: `${JSON.stringify(doc, null, 2)}\n`, support: { [report]: analysis } };
}

interface Home { readonly h: HimaHome; readonly resultSource: string; readonly supportRoot: string }

async function prepareHome(t: TestContext): Promise<Home> {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  await cp(path.join(repoRoot, 'packs', packId), path.join(packsDirOf(h), packId), { recursive: true, filter: (s) => !s.includes('__pycache__') });
  const wrapper = path.join(repoRoot, 'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
  const native = path.join(repoRoot, 'sites/linglong-atcs28/tests/fixtures/acp-standin.py');
  const admin = path.join(h.workspace, 'resident-admin');
  await mkdir(admin, { recursive: true });
  const resultSource = path.join(admin, 'requirements.json');
  const supportRoot = path.join(admin, 'support');
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
      mockEdaRoot: mockRoot, designRoot: path.join(mockRoot, 'share/designs/aes_cipher_top'), stockLibrary: 'std9t_svt',
      engineeringCapabilities: capability, workspaceRoot: h.workspace,
    },
  });
  return { h, resultSource, supportRoot };
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
  /** The fork is open and both agent nodes are the owner's to begin. */
  const reachFork = async (timeoutMs = 90_000) => {
    const there = () => run().fork !== undefined && ['himatime-agent', 'qualib-agent'].every((id) => context().available.includes(id));
    try { await waitUntil('the agent fork opens', there, timeoutMs, 250); } catch (error) { assert.fail(`${(error as Error).message}: ${failure('fork')}`); }
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
  const startAgent = async (agent: Agent, k: number, delivery: Delivery) => {
    const nodeId = `${agent}-agent`;
    await stage(home, delivery);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', `${nodeId} begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    const start = await act('engineering', { executionId, engineering: { operation: 'start', goal: `Round ${k}: ${agent} cell requirements for aes_cipher_top. DELIVER_BEST_EFFORT` } });
    assert.equal((start.data as any)?.status, 'started', JSON.stringify(start).slice(0, 3000));
    const taskId = (start.data as any).taskId as string;
    await waitUntil(`${agent} round ${k} turn answered`, async () => (await nativeState(taskId))?.phase === 'waiting', 20_000, 100);
    return { agent, nodeId, executionId, taskId };
  };
  type Started = Awaited<ReturnType<typeof startAgent>>;
  /** Collect a Reader-verified delivery (optionally repairing a refused one first), release, complete. */
  const finishAgent = async (task: Started, k: number, repair?: Delivery) => {
    let rejectedReason: string | undefined;
    if (repair !== undefined) {
      const first = await act('engineering', { executionId: task.executionId, engineering: { operation: 'delivery' } });
      assert.equal((first.data as any)?.status, 'reader-rejected', JSON.stringify(first).slice(0, 3000));
      const readerJob = records().findLast((rec: any) => rec.type === 'job' && rec.event === 'finished' && rec.job.name === 'reader-andes-requirements') as any;
      assert.ok(readerJob, 'the requirements Reader ran as a Job');
      rejectedReason = await readFile(path.join(readerJob.job.workspace, `${readerJob.job.session}.log`), 'utf8');
      await stage(home, repair);
      const message = await act('engineering', { executionId: task.executionId, requestId: `repair-${task.agent}-${k}`,
        engineering: { operation: 'message', message: 'Repair the refused requirements. DELIVER_BEST_EFFORT' } });
      assert.equal((message.data as any)?.status, 'accepted', JSON.stringify(message));
      await waitUntil(`${task.agent} round ${k} repair turn`, async () => {
        const s = await nativeState(task.taskId); return s?.phase === 'waiting' && s.detail?.completedRequestId === `repair-${task.agent}-${k}`;
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

/** One round: both agents run at once, then the autopilot generates, screens, verifies, rebuilds and compares. */
async function round(r: RunDriver, home: Home, k: number, himatime: Delivery, qualib: Delivery, qualibRepair?: Delivery) {
  await r.reachFork();
  assert.equal(r.run().currentNode, 'requirements-joined', 'inside the fork the Run stands at the join');
  const ht = await r.startAgent('himatime', k, himatime);
  const ql = await r.startAgent('qualib', k, qualib);
  // Two resident tasks are open at the same moment, one per branch.
  assert.equal(r.phaseOf(ht.executionId), 'working');
  assert.equal(r.phaseOf(ql.executionId), 'working');
  const executions = r.run().control!.executions;
  assert.deepEqual([executions[ht.executionId]!.branchId, executions[ql.executionId]!.branchId], ['himatime-agent', 'qualib-agent']);
  // Collect in the opposite order to the starts: the branches are independent.
  const qualibDone = await r.finishAgent(ql, k, qualibRepair);
  assert.ok(r.run().fork !== undefined, 'one finished branch keeps the fork open');
  await r.finishAgent(ht, k);
  await r.reach('next-round');
  for (const [agent, branch] of [['himatime', 'himatime-agent'], ['qualib', 'qualib-agent']] as const) {
    assert.equal(r.latestValues('andes-requirements', branch).requirements_valid, 1, `${agent} requirements read on its own branch`);
  }
  void home;
  return { ht, ql, qualibRejected: qualibDone.rejectedReason };
}

const HEAD = ['bind-inputs', 'reference-build', 'read-reference', 'check-reference', 'load-timing', 'read-timing'];
const TAIL = ['requirements-joined', 'generate-cells', 'screen-cells', 'verify-cells', 'new-library-build', 'compare-round', 'read-round', 'check-round', 'read-round-goal', 'judge-round'];

test('andes dry path: two agents per round, three rounds to a 5 % Fmax gain, goal-met', async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const r = await openRun(host, home, { target_fmax_gain_pct: 5 });
    // ----- the autopilot runs the reference build and the HimaTime load, then opens the agent fork
    await r.reachFork();
    assert.deepEqual(r.doneNodes(), HEAD, 'reference build and timing drive themselves');
    assert.deepEqual(r.latestValues('andes-reference'), { reference_valid: 1, design_fmax_mhz: 957.67, design_wns_ns: -0.0442,
      design_tns_ns: -3.213, design_area_um2: 41200, new_cell_instances: 0, route_drc_errors: 0 });
    assert.deepEqual(r.verdicts('reference-valid'), ['PASS']);
    assert.equal(r.latestValues('andes-timing').timing_fmax_mhz, 957.67);
    const inputs = JSON.parse(await readFile(path.join(r.workspace, 'state/inputs.json'), 'utf8'));
    assert.deepEqual(Object.keys(inputs.tools).sort(), ['andescell', 'himatime', 'qualib', 'sapr', 'xtop']);
    assert.match(inputs.tools.xtop.version, /XTop timing ECO .*mock/);

    // ----- round 1: XNOR3 and BUF; the Qualib agent's first delivery names a family AndesCell cannot build
    const r1 = await round(r, home, 1, requirements('himatime', 1, ['XNOR3', 'BUF', 'XOR2']), requirements('qualib', 1, ['FULLADDER', 'XNOR3']),
      requirements('qualib', 1, ['XNOR3', 'BUF', 'MUX2I']));
    assert.match(r1.qualibRejected ?? '', /qualib requirements refused: .*family 'FULLADDER' is not an AndesCell family/, r1.qualibRejected);
    for (const node of TAIL) assert.ok(r.doneNodes().includes(node), `${node} drove itself in round 1`);
    assert.deepEqual(r.verdicts('requirements-valid'), ['PASS', 'PASS'], 'the join judged each branch PASS');
    const gen1 = JSON.parse(await readFile(path.join(r.workspace, 'state/generation.json'), 'utf8'));
    assert.deepEqual(gen1.selected, ['XNOR3', 'BUF']);
    const screen1 = JSON.parse(await readFile(path.join(r.workspace, 'state/screen.json'), 'utf8'));
    assert.deepEqual(screen1.failed.sort(), ['ANDES_BUF_XF8_R1', 'ANDES_XNOR3_XF4_R1']);
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
    const timing2 = JSON.parse(await readFile(path.join(r.workspace, 'state/timing.json'), 'utf8'));
    assert.equal(timing2.source, 'round 1 new-library build');
    const gen2 = JSON.parse(await readFile(path.join(r.workspace, 'state/generation.json'), 'utf8'));
    assert.deepEqual(gen2.selected, ['XOR2', 'MUX2I']);
    assert.ok(gen2.skipped.some((s: any) => s.family === 'XNOR3' && /already generated/.test(s.reason)), 'a delivered family is not generated again');
    assert.equal(r.latestValues('andes-round').fmax_gain_pct, 3.4);
    const next2 = await r.decide('next-strategy');
    assert.equal(next2.done.kind, 'accepted', `next-strategy: ${next2.done.reason}`);

    // ----- round 3: AOI21 and OAI21 reach the Goal
    await round(r, home, 3, requirements('himatime', 3, ['AOI21', 'OAI21']), requirements('qualib', 3, ['OAI21', 'AOI21', 'NOR2']));
    const f3 = r.latestValues('andes-round');
    assert.equal(f3.fmax_gain_pct, 5.2);
    assert.equal(f3.best_gain_pct, 5.2);
    assert.equal(f3.design_fmax_mhz, 1007.46);
    assert.ok((f3.design_wns_ns ?? -1) > 0, 'timing met at 1.000 ns');
    assert.deepEqual(r.verdicts('fmax-goal'), ['FAIL', 'FAIL', 'PASS']);
    assert.deepEqual(r.verdicts('requirements-valid'), Array(6).fill('PASS'), 'two branches a round, three rounds');
    const end = await r.decide('goal-met');
    assert.equal(end.done.kind, 'accepted', `goal-met: ${end.done.reason}`);
    assert.equal(r.run().status, 'ended-goal-met', r.failure('goal-met'));

    const summary = await readFile(path.join(r.workspace, 'derived/summary.md'), 'utf8');
    assert.ok(summary.includes(`Claim boundary: ${CLAIM}`), summary);
    assert.match(summary, /\| 3 \| AOI21, OAI21 \| 1007\.46 \| 5\.20 % \|/);
    const record = JSON.parse(await readFile(path.join(r.workspace, 'state/round.json'), 'utf8'));
    assert.equal(record.claimBoundary, CLAIM);
    assert.deepEqual(record.cumulativeFamilies, ['AOI21', 'BUF', 'MUX2I', 'OAI21', 'XNOR3', 'XOR2']);
    for (const agent of ['himatime', 'qualib']) {
      for (const k of [1, 2, 3]) assert.ok((await readFile(path.join(r.workspace, `requirements/${agent}/r${k}/analysis.md`), 'utf8')).length > 0);
    }
    t.diagnostic(`gains 2.50 / 3.40 / 5.20 %; run ${r.runId} ended ${r.run().status}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
