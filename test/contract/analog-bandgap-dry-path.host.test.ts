// The analog-bandgap Pack's whole graph below the GUI, with no model, real ngspice on the synthetic
// PDK and a stand-in layout tool, as an L2 Host test. Two rounds:
//
//   bind-inputs -> characterize -> read-tables -> check-tables                 (autopilot)
//   size-agent                                                                 (owner: one resident task)
//   simulate-pvt -> read-pvt -> check-pvt -> monte-carlo -> read-mc -> check-mc
//     -> layout -> read-layout -> check-layout -> simulate-post -> read-post -> check-post
//     -> record-round -> read-round -> judge-round                             (autopilot; a failing check goes straight to the record)
//   next-round                                                                 (owner decision; revisits size-agent)
//
// Round 1: the agent's first delivery types a measured VBG into the design and is refused by the
// design Reader, then repaired in the same task with the method's first cut; on the synthetic PDK that
// first cut sits at about 1.17 V, outside the 1.2 V +/- 2 % band, so the corner judge fails and the
// round is recorded unsigned. Round 2: the agent raises R2/R1 (a choice, drafted by the method); every
// line is met at every corner, Monte Carlo on ngspice is in band, the layout is clean, the post-layout
// stage meets every line, and the owner ends the Run with the Goal met.
//
// Every tool node is the Pack's own `flow/bg_cli.py` launched as a Job by the real in-process Host,
// calling ngspice; every Reader and Judge is the Pack's own. What stands in: each resident agent is the
// ACP stand-in behind the production resident wrapper (sandbox `none`), delivering a design drafted with
// the Pack's own `draft` command; and the Site's layout tool is `test/fixtures/analog-bandgap/standin-layout.py`,
// which checks nothing and returns the schematic cell as its "extraction" (the real tool is
// sites/analog_sim_01/layout/run_cell.sh). Synthetic PDK; not signoff, not silicon.
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

const packId = 'analog-bandgap';
const pdkRoot = path.join(repoRoot, 'test/fixtures/analog-pdks');
const standinLayout = path.join(repoRoot, 'test/fixtures/analog-bandgap/standin-layout.py');
const GOAL = { vbg_v: 1.2, vbg_tol_pct: 2, max_iq_ua: 8, max_isd_na: 2, max_tc_ppm: 100, min_pm_deg: 60, max_tstart_us: 100, min_psrr_db: 40 };
const SHEET = { vbgV: 1.2, vbgTolPct: 2, iqMaxUa: 8, isdMaxNa: 2, tcMaxPpm: 100, pmMinDeg: 60, tStartMaxUs: 100, psrrMinDb: 40 };

function findNgspice(): string | undefined {
  for (const candidate of [process.env.HIMA_NGSPICE, 'ngspice']) {
    if (!candidate) continue;
    const run = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (run.status === 0 && /ngspice-\d+/.test(run.stdout + run.stderr)) return candidate;
  }
  return undefined;
}
const ngspice = findNgspice();
const skip = ngspice === undefined ? 'no ngspice (set HIMA_NGSPICE or put ngspice on PATH)' : false;

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_RESIDENT_TESTING = '1';
const tmuxDir = mkdtempSync(path.join(process.env.TMUX_TMPDIR ?? '/tmp', 'bg-'));
process.env.TMUX_TMPDIR = tmuxDir;
process.on('exit', () => { spawnSync('tmux', ['-S', path.join(tmuxDir, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore' }); });

type Json = Record<string, any>;
interface Delivery { readonly result: string; readonly support: Record<string, string> }

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readState = async (workspace: string, name: string): Promise<Json> => JSON.parse(await readFile(path.join(workspace, 'state', name), 'utf8'));

/** The agent's delivery as its playbook makes it: the method's intent from the spec sheet (with the
 *  agent's choices), the Pack's sizes from that intent, the agent's words and its analysis. */
async function drafted(workspace: string, scratch: string, choices: Json | undefined,
  { edit, note = 'Stand-in analysis.', revision }: { readonly edit?: (doc: Json) => void; readonly note?: string; readonly revision?: number } = {}): Promise<Delivery> {
  await mkdir(scratch, { recursive: true });
  const stamp = `${String(Date.now())}-${String(Math.random()).slice(2, 8)}`;
  const sheet = path.join(scratch, `sheet-${stamp}.json`);
  await writeFile(sheet, json(choices ? { ...SHEET, choices } : SHEET));
  const cli = path.join(workspace, 'flow/bg_cli.py');
  const intent = spawnSync('python3', [cli, 'draft', workspace, 'intent', sheet], { encoding: 'utf8', cwd: workspace });
  assert.equal(intent.status, 0, `draft intent: ${intent.stderr}`);
  const intentFile = path.join(scratch, `intent-${stamp}.json`);
  await writeFile(intentFile, intent.stdout);
  const size = spawnSync('python3', [cli, 'draft', workspace, 'size', intentFile], { encoding: 'utf8', cwd: workspace });
  assert.equal(size.status, 0, `draft size: ${size.stderr}`);
  const doc = JSON.parse(size.stdout);
  doc.summary = 'The stand-in delivery, drafted with the Pack\'s own method from the spec sheet.';
  doc.reason = choices ? `The method with the choices ${JSON.stringify(choices)}.` : 'The method\'s first cut.';
  edit?.(doc);
  if (revision !== undefined) doc.report = doc.report.replace(/analysis\.md$/, `analysis-${String(revision)}.md`);
  return { result: json(doc), support: { [doc.report]: `# design\n\n${note}\n` } };
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
  const scratch = path.join(admin, 'drafts');
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
  const ngspiceDir = path.dirname(await realpath(spawnSync('which', [ngspice!], { encoding: 'utf8' }).stdout.trim() || ngspice!));
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, pdkRoot, ngspiceDir, path.dirname(standinLayout), path.dirname(wrapper), path.dirname(native)],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3', wrapper, standinLayout], parallelJobs: 2,
    bindings: {
      simulators: `ngspice=${ngspice!}`, pdkRoot, pdk: 'synth180', layoutTool: standinLayout,
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

async function openRun(host: InProcessHost, home: Home) {
  const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', goal: GOAL, ownerSessionId: actor });
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
      expectedRevision: control().revision, requestId: `bg-${++sequence}`, ...fields });
  const timeline = () => {
    const all = records(); const t0 = Date.parse(all[0]!.at);
    return all.filter((r) => r.type === 'node' || r.type === 'job')
      .map((r: any) => `${((Date.parse(r.at) - t0) / 1000).toFixed(1)}s ${r.type} ${r.nodeId ?? r.job?.name ?? ''} ${r.state ?? r.event ?? ''}`).join('\n');
  };
  const failure = (what: string) => JSON.stringify({ what, status: run().status, currentNode: run().currentNode,
    available: context().available, reason: context().reason,
    blocked: records().filter((r) => r.type === 'node' && (r.state === 'blocked' || r.state === 'cancelled')).slice(-4),
    refusal: records().findLast((r) => r.type === 'refusal') }).slice(0, 6000) + `\n${timeline()}\nHOST LOG TAIL:\n${hostLog(host).slice(-25).join('\n')}`;
  const reach = async (nodeId: string, timeoutMs = 120_000) => {
    const there = () => (run().currentNode === nodeId && context().available.includes(nodeId)) || String(run().status).startsWith('ended-');
    try { await waitUntil(`the Run reaches ${nodeId}`, there, timeoutMs, 250); } catch (error) { assert.fail(`${(error as Error).message}: ${failure(nodeId)}`); }
    assert.ok(context().available.includes(nodeId), failure(nodeId));
  };
  const doneNodes = () => records().filter((r) => r.type === 'node' && r.state === 'done').map((r) => (r as any).nodeId as string);
  const latestValues = (reader: string): Values => {
    const found = records().findLast((r) => r.type === 'observation' && (r as any).reader.id === reader) as any;
    assert.ok(found, `an observation by ${reader}`);
    return Object.fromEntries(found.values.map((v: any) => [v.type, v.value ?? null]));
  };
  const verdicts = (ruleId: string) => records().filter((r) => r.type === 'verdict' && (r as any).ruleId === ruleId).map((r) => (r as any).outcome as string);
  const nativeState = async (taskId: string) => {
    try { return JSON.parse(await readFile(path.join(workspace, '.hima-engineering', taskId, 'state.json'), 'utf8')); } catch { return undefined; }
  };

  /** One resident agent node: begin, start on the staged delivery, (repair a refused first delivery),
   *  collect the Reader-verified delivery, release, complete. */
  const agent = async (nodeId: string, k: number, first: Delivery, repair?: { readonly delivery: Delivery; readonly reader: string }) => {
    await reach(nodeId);
    await stage(home, first);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', `${nodeId} begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    const start = await act('engineering', { executionId, engineering: { operation: 'start', goal: `Round ${k}: ${nodeId}. DELIVER_BEST_EFFORT` } });
    assert.equal((start.data as any)?.status, 'started', JSON.stringify(start).slice(0, 3000));
    const taskId = (start.data as any).taskId as string;
    await waitUntil(`${nodeId} round ${k} turn answered`, async () => (await nativeState(taskId))?.phase === 'waiting', 20_000, 100);
    let rejectedReason: string | undefined;
    if (repair !== undefined) {
      const refused = await act('engineering', { executionId, engineering: { operation: 'delivery' } });
      assert.equal((refused.data as any)?.status, 'reader-rejected', JSON.stringify(refused.data).slice(0, 3000));
      const readerJob = records().findLast((rec: any) => rec.type === 'job' && rec.event === 'finished' && rec.job.name === `reader-${repair.reader}`) as any;
      assert.ok(readerJob, `the ${repair.reader} Reader ran as a Job`);
      rejectedReason = await readFile(path.join(readerJob.job.workspace, `${readerJob.job.session}.log`), 'utf8');
      await stage(home, repair.delivery);
      const message = await act('engineering', { executionId, requestId: `repair-${nodeId}-${k}`,
        engineering: { operation: 'message', message: 'Repair the refused delivery. DELIVER_BEST_EFFORT' } });
      assert.equal((message.data as any)?.status, 'accepted', JSON.stringify(message));
      await waitUntil(`${nodeId} round ${k} repair turn`, async () => {
        const s = await nativeState(taskId); return s?.phase === 'waiting' && s.detail?.completedRequestId === `repair-${nodeId}-${k}`;
      }, 20_000, 100);
    }
    const delivery = await act('engineering', { executionId, engineering: { operation: 'delivery' } });
    assert.equal((delivery.data as any)?.status, 'verified', JSON.stringify(delivery.data).slice(0, 4000));
    const release = await act('engineering', { executionId, engineering: { operation: 'release' } });
    assert.equal((release.data as any)?.status, 'released', JSON.stringify(release).slice(0, 2000));
    const done = await act('complete', { executionId }); assert.equal(done.kind, 'accepted', `${nodeId} complete: ${done.reason}`);
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
  return { runId, workspace, run, records, reach, doneNodes, latestValues, verdicts, agent, decide, failure };
}

test('analog bandgap dry path: a missed VBG, a refused delivery repaired, then signed off at every corner, in Monte Carlo and after layout', { skip }, async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const r = await openRun(host, home);
    await r.reach('size-agent');
    assert.deepEqual(r.doneNodes(), ['bind-inputs', 'characterize', 'read-tables', 'check-tables']);
    assert.deepEqual(r.verdicts('tables-valid'), ['PASS']);

    // ----- round 1: a typed VBG is refused; the repair is the method's first cut, which misses the band
    const typed = await drafted(r.workspace, home.scratch, undefined, { edit: (doc) => { doc.vbgV = 1.2; } });
    const firstCut = await drafted(r.workspace, home.scratch, undefined, { note: 'Repaired: the design carries choices only.', revision: 2 });
    const round1 = await r.agent('size-agent', 1, typed, { delivery: firstCut, reader: 'bg-design' });
    assert.match(round1.rejectedReason ?? '', /vbgV/, round1.rejectedReason);
    await r.reach('next-round', 600_000);
    assert.deepEqual(r.verdicts('meets-spec'), ['FAIL'], 'the first cut misses a line at some corner');
    const pvt1 = r.latestValues('bg-pvt');
    assert.equal(pvt1.meets_spec, 0);
    assert.ok((pvt1.vbg_min_v ?? 2) < 1.176, `VBG below the band: ${JSON.stringify(pvt1)}`);
    for (const skipped of ['monte-carlo', 'layout', 'simulate-post']) assert.ok(!r.doneNodes().includes(skipped), `${skipped} is skipped after a failed corner check`);
    assert.deepEqual([r.verdicts('round-valid'), r.verdicts('signed-off')], [['PASS'], ['FAIL']]);
    const next = await r.decide('next-strategy');
    assert.equal(next.done.kind, 'accepted', `next-strategy: ${next.done.reason}`);

    // ----- round 2: R2/R1 up; every stage passes and the round is signed off
    await r.agent('size-agent', 2, await drafted(r.workspace, home.scratch, { r2r1: 10.25 }, { note: 'Raised R2/R1: VBG into the band, TC within its line.' }));
    await r.reach('next-round', 900_000);
    assert.deepEqual(r.verdicts('meets-spec'), ['FAIL', 'PASS', 'PASS'], 'round 2 meets every line before and after layout');
    assert.deepEqual(r.verdicts('mc-in-band'), ['PASS']);
    assert.deepEqual(r.verdicts('layout-clean'), ['PASS']);
    assert.deepEqual(r.verdicts('signed-off'), ['FAIL', 'PASS']);
    const mc = r.latestValues('bg-mc');
    assert.ok((mc.mc_sigma_mv ?? 0) > 0, `Monte Carlo spreads: ${JSON.stringify(mc)}`);
    const round = await readState(r.workspace, 'round.json');
    assert.equal(round.signedOff, true, JSON.stringify(round));
    const layout = await readState(r.workspace, 'layout.json');
    assert.equal(layout.designSha256, (await readState(r.workspace, 'measure-post.json')).designSha256, 'the post-layout result is of the laid-out design');
    const end = await r.decide('goal-met');
    assert.equal(end.done.kind, 'accepted', `goal-met: ${end.done.reason}`);
    assert.equal(end.advice?.chosen?.goalMet, true, JSON.stringify(end.advice));
    assert.equal(r.run().status, 'ended-goal-met', r.failure('goal-met'));

    // ----- the record: lessons, summary, reports and charts
    const lessons = await readState(r.workspace, 'lessons.json');
    assert.deepEqual(lessons.rounds.map((x: Json) => [x.round, x.roundValid, x.signedOff]), [[1, true, false], [2, true, true]]);
    const summary = await readFile(path.join(r.workspace, 'derived/summary.md'), 'utf8');
    assert.match(summary, /not silicon/);
    for (const [node, k] of [['simulate-pvt', 1], ['simulate-pvt', 2], ['monte-carlo', 2], ['layout', 2], ['simulate-post', 2], ['record-round', 2]] as const) {
      const files = await readdir(path.join(r.workspace, 'reports', node, `r${String(k)}`));
      assert.ok(files.some((name) => /\.(rpt|md)$/.test(name)), `${node} r${String(k)} has a report: ${files.join(', ')}`);
    }
    for (const rel of ['size-agent/r1/analysis-2.md', 'size-agent/r2/analysis.md']) assert.ok((await readFile(path.join(r.workspace, 'reports', rel), 'utf8')).length > 0, rel);
    let charts = 0;
    for (const entry of await readdir(path.join(r.workspace, 'reports'), { recursive: true })) {
      if (!String(entry).endsWith('.chart.json')) continue;
      const parsed = himaChart.safeParse(JSON.parse(await readFile(path.join(r.workspace, 'reports', String(entry)), 'utf8')));
      assert.ok(parsed.success, `${String(entry)}: ${JSON.stringify(parsed.error?.issues ?? []).slice(0, 1500)}`);
      charts += 1;
    }
    assert.ok(charts >= 5, `charts: ${String(charts)}`);
    t.diagnostic(`round 1 VBG ${String(pvt1.vbg_min_v)} V; round 2 Monte Carlo sigma ${String(mc.mc_sigma_mv)} mV; run ${r.runId} ${r.run().status}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
