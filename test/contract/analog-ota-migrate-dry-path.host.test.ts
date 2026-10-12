// The analog-ota-migrate Pack's whole graph below the GUI, with no model and real ngspice on the
// synthetic PDKs, as an L2 Host test. Two rounds:
//
//   bind-inputs -> characterize -> read-tables -> check-tables            (autopilot)
//   size-agent                                                            (owner: one resident task)
//   simulate-source -> read-source -> check-source                        (autopilot; PASS opens the migration)
//   migrate-agent                                                         (owner: one resident task)
//   simulate-target -> record-round -> read-round -> judge-round          (autopilot)
//   next-round                                                            (owner decision; revisits size-agent)
//
// Round 1: the sizing agent's first delivery types a measured gain into the intent and is refused by
// the design Reader, then repaired in the same task; the source meets the spec; the naive port misses
// it at 1.2 V and the chooser asks for another round. Round 2: the source is kept and the re-biased
// port meets every line, and the owner ends the Run with the Goal met.
//
// Every tool node is the Pack's own `flow/ota_cli.py` launched as a Job by the real in-process Host,
// calling ngspice; every Reader and Judge is the Pack's own. What stands in, and only at the model
// boundary: each resident agent is the ACP stand-in `sites/linglong-atcs28/tests/fixtures/acp-standin.py`
// behind the production resident wrapper (sandbox `none`, HIMA_RESIDENT_TESTING=1), delivering a
// design drafted with the Pack's own `draft` command, as the agents' playbooks say. Synthetic PDKs;
// not signoff, not silicon.
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

const packId = 'analog-ota-migrate';
const pdkRoot = path.join(repoRoot, 'test/fixtures/analog-pdks');
const GOAL = { min_gain_db: 60, min_gbw_mhz: 10, min_pm_deg: 60, max_power_uw: 200 };
// The intents of the analog-sim test: the source meets the spec, the re-biased port meets it at 1.2 V.
const SOURCE_INTENT = { ibiasUa: 10, i1Ua: 4, i6Ua: 50, ccPf: 0.6, rzKohm: 2.0,
  input: { gmId: 15, lUm: 0.5 }, load: { gmId: 10, lUm: 0.5 }, sink: { gmId: 10, lUm: 1.0 } };
const REBIASED_PORT = { ibiasUa: 10, i1Ua: 4, i6Ua: 50, ccPf: 0.8, rzKohm: 2.5,
  input: { gmId: 24, lUm: 0.36 }, load: { gmId: 12, lUm: 0.36 }, sink: { gmId: 22, lUm: 0.72 } };

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
const tmuxDir = mkdtempSync(path.join(process.env.TMUX_TMPDIR ?? '/tmp', 'ao-'));
process.env.TMUX_TMPDIR = tmuxDir;
process.on('exit', () => { spawnSync('tmux', ['-S', path.join(tmuxDir, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore' }); });

type Json = Record<string, any>;
interface Delivery { readonly result: string; readonly support: Record<string, string> }

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const readState = async (workspace: string, name: string): Promise<Json> => JSON.parse(await readFile(path.join(workspace, 'state', name), 'utf8'));

/** An agent's delivery as its playbook makes it: the Pack's own draft (from an intent file when
 *  given), the agent's summary and reason, and its analysis as support. `edit` stages a delivery the
 *  design Reader must refuse. */
async function drafted(workspace: string, scratch: string, kind: 'size' | 'keep' | 'migrate', intent?: Json,
  { edit, note = 'Stand-in analysis.', revision }: { readonly edit?: (doc: Json) => void; readonly note?: string; readonly revision?: number } = {}): Promise<Delivery> {
  const argv = [path.join(workspace, 'flow/ota_cli.py'), 'draft', workspace, kind];
  if (intent !== undefined) {
    await mkdir(scratch, { recursive: true });
    const file = path.join(scratch, `intent-${kind}-${String(Date.now())}.json`);
    await writeFile(file, json(intent));
    argv.push(file);
  }
  const run = spawnSync('python3', argv, { encoding: 'utf8', cwd: workspace });
  assert.equal(run.status, 0, `draft ${kind}: ${run.stderr}`);
  const doc = JSON.parse(run.stdout);
  doc.summary = `The stand-in ${kind} delivery, drafted with the Pack's own draft command.`;
  doc.reason = 'The gm/Id intent below, as the playbook says.';
  edit?.(doc);
  if (revision !== undefined) doc.report = doc.report.replace(/analysis\.md$/, `analysis-${String(revision)}.md`);
  return { result: json(doc), support: { [doc.report]: `# ${kind}\n\n${note}\n` } };
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
    allowedReadRoots: [h.workspace, pdkRoot, ngspiceDir, path.dirname(wrapper), path.dirname(native)],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3', wrapper], parallelJobs: 2,
    bindings: {
      simulators: `ngspice=${ngspice!}`, pdkRoot, sourcePdk: 'synth180', targetPdk: 'synth130',
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
      expectedRevision: control().revision, requestId: `ota-${++sequence}`, ...fields });
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

test('analog OTA dry path: size, simulate, migrate and re-bias over two rounds to the spec-sheet Goal, a refused delivery repaired', { skip }, async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const r = await openRun(host, home);
    // ----- the autopilot checks the simulator, builds the design curves and hands the sizing agent to the owner
    await r.reach('size-agent');
    assert.deepEqual(r.doneNodes(), ['bind-inputs', 'characterize', 'read-tables', 'check-tables']);
    assert.deepEqual(r.verdicts('tables-valid'), ['PASS']);
    assert.equal(r.latestValues('ota-tables').tables_curves, 20, 'two PDKs x two device types x five lengths');

    // ----- round 1: the sizing agent first types a measured gain into its intent; the Reader refuses it
    const typed = await drafted(r.workspace, home.scratch, 'size', SOURCE_INTENT, { edit: (doc) => { doc.intent.measuredGainDb = 95; } });
    const sized = await drafted(r.workspace, home.scratch, 'size', SOURCE_INTENT, { note: 'Repaired: the intent carries choices only.', revision: 2 });
    const size1 = await r.agent('size-agent', 1, typed, { delivery: sized, reader: 'ota-design' });
    assert.match(size1.rejectedReason ?? '', /intent has unknown field\(s\) measuredGainDb/, size1.rejectedReason);
    await r.reach('migrate-agent');
    assert.deepEqual(r.verdicts('source-meets-spec'), ['PASS'], 'the Pack measured the source itself and it meets the spec');
    const source = r.latestValues('ota-source');
    assert.equal(source.meets_spec, 1);
    assert.equal(source.saturated, 1);
    const measured = await readState(r.workspace, 'measure-source.json');
    assert.equal(source.gain_db, measured.worst.gainDb, 'the Reader states the simulator\'s worst corner');

    // ----- round 1: the naive gm/Id-preserving port misses the spec at 1.2 V
    await r.agent('migrate-agent', 1, await drafted(r.workspace, home.scratch, 'migrate'));
    await r.reach('next-round');
    // On the synthetic pair the naive port leaves a device out of saturation at 1.2 V: the round is not
    // a valid result, so its margin does not count and the best margin stays at the -100 floor.
    assert.deepEqual(r.verdicts('round-valid'), ['FAIL'], 'the naive port is not a valid result');
    const round1 = r.latestValues('ota-round');
    assert.equal(round1.round_valid, 0, JSON.stringify(round1));
    assert.equal(round1.best_margin_pct, -100, JSON.stringify(round1));
    const next = await r.decide('next-strategy');
    assert.equal(next.done.kind, 'accepted', `next-strategy: ${next.done.reason}`);
    assert.notEqual(next.advice?.chosen?.goalMet, true, JSON.stringify(next.advice));

    // ----- round 2: the source is kept, the re-biased port meets every line
    await r.agent('size-agent', 2, await drafted(r.workspace, home.scratch, 'keep'));
    await r.agent('migrate-agent', 2, await drafted(r.workspace, home.scratch, 'migrate', REBIASED_PORT, { note: 'Longer input pair and sinks, weaker inversion.' }));
    await r.reach('next-round');
    assert.deepEqual(r.verdicts('round-valid'), ['FAIL', 'PASS']);
    assert.equal(r.verdicts('target-margin').at(-1), 'PASS');
    const round2 = r.latestValues('ota-round');
    assert.equal(round2.round_valid, 1);
    assert.equal(round2.specs_met, 4);
    assert.ok((round2.target_margin_pct ?? -1) > 0, JSON.stringify(round2));
    assert.equal(round2.best_margin_pct, round2.target_margin_pct);
    const end = await r.decide('goal-met');
    assert.equal(end.done.kind, 'accepted', `goal-met: ${end.done.reason}`);
    assert.equal(end.advice?.chosen?.goalMet, true, JSON.stringify(end.advice));
    assert.equal(r.run().status, 'ended-goal-met', r.failure('goal-met'));

    // ----- the record: lessons, the summary and every step's human-readable report and charts
    const lessons = await readState(r.workspace, 'lessons.json');
    assert.deepEqual(lessons.rounds.map((x: Json) => [x.round, x.roundValid]), [[1, false], [2, true]]);
    const summary = await readFile(path.join(r.workspace, 'derived/summary.md'), 'utf8');
    assert.match(summary, /not silicon/);
    for (const node of ['bind-inputs', 'characterize', 'simulate-source', 'simulate-target', 'record-round']) {
      const files = await readdir(path.join(r.workspace, 'reports', node, 'r1'));
      assert.ok(files.some((name) => /\.(rpt|md)$/.test(name)), `${node} r1 has a report: ${files.join(', ')}`);
    }
    for (const rel of ['size-agent/r1/analysis-2.md', 'migrate-agent/r1/analysis.md', 'size-agent/r2/analysis.md', 'migrate-agent/r2/analysis.md']) {
      assert.ok((await readFile(path.join(r.workspace, 'reports', rel), 'utf8')).length > 0, rel);
    }
    let charts = 0;
    for (const entry of await readdir(path.join(r.workspace, 'reports'), { recursive: true })) {
      if (!String(entry).endsWith('.chart.json')) continue;
      himaChart.parse(JSON.parse(await readFile(path.join(r.workspace, 'reports', String(entry)), 'utf8')));
      charts += 1;
    }
    assert.ok(charts >= 4, `charts: ${String(charts)}`);
    t.diagnostic(`round 1 margin ${String(round1.target_margin_pct)} %, round 2 margin ${String(round2.target_margin_pct)} %; run ${r.runId} ${r.run().status}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
