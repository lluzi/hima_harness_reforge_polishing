// The custom-cell-fmax-sky130-demo Pack's whole graph below the GUI, with no model and no EDA, as an
// L2 Host test. One round reads
//
//   bind-inputs -> baseline -> read-baseline -> check-baseline            (autopilot)
//   engineer                                                              (owner: resident task)
//   arm-custom -> read-arm-custom  ||  arm-control -> read-arm-control    (fork drives itself)
//   arms-joined -> compare-round -> read-round -> check-round
//               -> read-round-goal -> judge-round                         (autopilot)
//   next-round                                                            (owner decision)
//
// and every tool node is the Pack's own `flow/cellfmax_cli.py` launched as a Job by the real
// in-process Host, every Reader and Judge is the Pack's own. The owner acts only at `engineer` and
// `next-round`, through `executionAction` exactly as `hima_execute` does.
//
// What stands in, and only at the Site/tool/model boundary:
// - EDA: `test/fixtures/cellfmax-dry-path/bin/podman`, first on the Host's PATH (set before the
//   Host boots and before this file's private tmux server starts, because a local Job's environment
//   is the tmux server's). It answers `image inspect` with the image id the Site binds, and an ORFS
//   `run` by writing the metric files, final netlist and top-paths report the Pack reads, with a WNS
//   fixed by how many custom cells the run may use (see the stand-in's docstring).
// - ORFS checkout: `test/fixtures/cellfmax-dry-path/orfs` (Makefile, aes config and SDC, sky130hd
//   config with a DONT_USE_CELLS block, a minimal Liberty), copied into the home; empty celluzi and
//   bool2cmos roots.
// - Resident engineer: the ACP stand-in `sites/linglong-atcs28/tests/fixtures/acp-standin.py` behind
//   the production resident wrapper (sandbox `none`, HIMA_RESIDENT_TESTING=1). Its result bytes and
//   support files come from STANDIN_RESULT_SOURCE / STANDIN_ARTIFACT_SOURCE_ROOT, which this test
//   rewrites before each round with a hima-cellfmax-round-recipe/1 and its cells/r<k>/ files.
//
// No timing, cell, Fmax or silicon claim is made by any number below.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { ExecutionActionRequest, LedgerRecord } from '@hima/harness';
import { repoRoot, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, hostLog, type InProcessHost } from './support/boot-inprocess.ts';
import { localHome, waitUntil } from './support/fabric.ts';
import { packsDirOf } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'custom-cell-fmax-sky130-demo';
const fixture = path.join(repoRoot, 'test/fixtures/cellfmax-dry-path');
const IMAGE_ID = 'c8e8a7a41e3da6fc9a14c8b4b3303df836ffe24b03d9a96fc91c8c1e76827667';
const CLAIM_BOUNDARY = 'Custom-cell timing is modelled from foundry tables (estimate_lib, derate stated per cell), not '
  + 'characterized. Layouts marked drc-lvs-clean passed KLayout DRC and Netgen LVS. Results are '
  + 'open-source ORFS timing on SKY130 under these models; not signoff, not silicon.';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_RESIDENT_TESTING = '1';
// The Pack's tools call `podman` by name. A local Job runs in a tmux session whose environment is
// the tmux server's, so the stand-in goes first on PATH before this file starts its own private tmux
// server (a fresh TMUX_TMPDIR under the runner's), which every Job of this file then inherits.
process.env.PATH = `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`;
const tmuxDir = mkdtempSync(path.join(process.env.TMUX_TMPDIR ?? '/tmp', 'cf-'));
process.env.TMUX_TMPDIR = tmuxDir;
// Every stand-in podman call is logged here; fixed for the file because the tmux server's environment is.
const podmanLog = path.join(tmuxDir, 'podman-calls.jsonl');
process.env.CELLFMAX_PODMAN_LOG = podmanLog;
process.on('exit', () => { spawnSync('tmux', ['-S', path.join(tmuxDir, `tmux-${process.getuid!()}`, 'default'), 'kill-server'], { stdio: 'ignore' }); });

// Hand-computed Fmax: 1000 / (3.6 - WNS), rounded to 4 places as the Pack does.
const fmax = (wns: number) => Math.round(1e4 * 1000 / (3.6 - wns)) / 1e4;
const gainPct = (custom: number, control: number) => Math.round(1e4 * 100 * (custom / control - 1)) / 1e4;
const STOCK = fmax(-0.249301); // 259.7874 MHz
const ONE_CELL = fmax(-0.10); // 270.2703 MHz
const TWO_CELLS = fmax(0.0); // 277.7778 MHz

// ---------------------------------------------------------------------------------------------
// Cell and recipe material the resident stand-in delivers.
// ---------------------------------------------------------------------------------------------

interface Cell { readonly name: string; readonly origin: string; readonly inputs: readonly string[] }

const cellLib = (cell: Cell) => [
  `    cell (${cell.name}) {`,
  '        area : 10.0;',
  '        pg_pin ("VGND") { pg_type : "primary_ground"; voltage_name : "VGND"; }',
  '        pg_pin ("VNB") { pg_type : "nwell"; voltage_name : "VNB"; }',
  '        pg_pin ("VPB") { pg_type : "pwell"; voltage_name : "VPB"; }',
  '        pg_pin ("VPWR") { pg_type : "primary_power"; voltage_name : "VPWR"; }',
  ...cell.inputs.map((pin) => `        pin ("${pin}") { direction : "input"; capacitance : 0.002; }`),
  `        pin ("Y") { direction : "output"; function : "(!${cell.inputs.join('&!')})"; timing () { related_pin : "A"; } }`,
  '    }', ''].join('\n');
const cellLef = (cell: Cell) => [
  `MACRO ${cell.name}`, '  CLASS CORE ;', '  SIZE 3.22 BY 2.72 ;',
  ...['VPWR:POWER', 'VGND:GROUND', 'Y:SIGNAL', ...cell.inputs.map((pin) => `${pin}:SIGNAL`), 'VPB:POWER', 'VNB:GROUND']
    .flatMap((entry) => { const [pin, use] = entry.split(':'); return [`  PIN ${pin}`, `    USE ${use} ;`, `  END ${pin}`]; }),
  `END ${cell.name}`, ''].join('\n');
const cellFiles = (cell: Cell): Record<string, string> => ({
  sp: `.subckt ${cell.name} ${cell.inputs.join(' ')} Y VPWR VGND\n.ends\n`, gds: `GDSII ${cell.name}\n`, lef: cellLef(cell), lib: cellLib(cell),
});
const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');

interface Round {
  /** The recipe bytes the stand-in returns as its result (state/round-recipe.json). */
  readonly recipe: string;
  /** Support files the stand-in returns, by Campaign-relative path (all under cells/r<k>/). */
  readonly support: Record<string, string>;
}

/**
 * One round's delivery: every new cell's files under cells/r<k>/, the cumulative custom.lib/lef of
 * all cells under cells/r<k>/, findings, usage guide, one datasheet per new cell. Cells of earlier
 * rounds keep their own origin's paths and bytes (byte-identical to best.json).
 */
function roundDelivery(k: number, cells: readonly Cell[], { omitUsage = false, claimGainPct = 4.5 } = {}): Round {
  const prefix = `cells/r${k}`;
  const support: Record<string, string> = {};
  const recipeCells = cells.map((cell) => {
    const files = Object.fromEntries(Object.keys(cellFiles(cell)).map((key) => [key, `cells/${cell.origin}/${cell.name}.${key}`]));
    const bytes = cellFiles(cell);
    if (cell.origin === `r${k}`) for (const key of Object.keys(files)) support[files[key]!] = bytes[key]!;
    return {
      name: cell.name, outputs: ['Y'], origin: cell.origin, function: `Y=!(${cell.inputs.join('|')})`, layout: 'drc-lvs-clean',
      timingModel: { method: 'estimate_lib', base: 'sky130_fd_sc_hd__nor3_1', derate: { rise: 0.6 }, reason: 'two parallel PMOS fingers in the pull-up' },
      files, sha256: Object.fromEntries(Object.keys(files).map((key) => [key, sha(bytes[key]!)])),
    };
  });
  support[`${prefix}/custom.lib`] = `library (cellfmax_custom_r${k}) {\n${cells.map(cellLib).join('')}}\n`;
  support[`${prefix}/custom.lef`] = cells.map(cellLef).join('\n');
  support[`${prefix}/findings.md`] = `# Round ${k} findings\n\nStand-in findings.\n`;
  if (!omitUsage) support[`${prefix}/usage-guide.md`] = `# Round ${k} usage\n\nStand-in usage guide.\n`;
  const fresh = cells.filter((cell) => cell.origin === `r${k}`);
  for (const cell of fresh) support[`${prefix}/datasheets/${cell.name}.md`] = `# ${cell.name}\n\nStand-in datasheet.\n`;
  const recipe = {
    schema: 'hima-cellfmax-round-recipe/1', round: k, periodNs: 3.6, synthesis: { method: 'orfs-abc' },
    library: { lib: `${prefix}/custom.lib`, lef: `${prefix}/custom.lef`, cells: recipeCells },
    hypothesis: `round ${k}: faster pull-up cells on the rise-critical cones`,
    report: { findings: `${prefix}/findings.md`, datasheets: fresh.map((cell) => `${prefix}/datasheets/${cell.name}.md`), usage: `${prefix}/usage-guide.md` },
    agentClaim: { customFmaxMhz: 270.0, controlFmaxMhz: 259.8, gainPct: claimGainPct, runs: [] }, evidence: [],
  };
  return { recipe: `${JSON.stringify(recipe, null, 2)}\n`, support };
}

// ---------------------------------------------------------------------------------------------
// The home: the Pack, the local Site with the stand-in bindings, the resident capability.
// ---------------------------------------------------------------------------------------------

interface Home {
  readonly h: HimaHome;
  readonly resultSource: string;
  readonly supportRoot: string;
  readonly podmanLog: string;
}

async function prepareHome(t: TestContext): Promise<Home> {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  await cp(path.join(repoRoot, 'packs', packId), path.join(packsDirOf(h), packId), {
    recursive: true, filter: (source) => !source.includes('__pycache__') });
  const inputs = path.join(h.workspace, 'site-inputs');
  await cp(path.join(fixture, 'orfs'), path.join(inputs, 'orfs'), { recursive: true });
  await mkdir(path.join(inputs, 'celluzi'), { recursive: true });
  await mkdir(path.join(inputs, 'bool2cmos'), { recursive: true });
  const wrapper = path.join(repoRoot, 'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
  const native = path.join(repoRoot, 'sites/linglong-atcs28/tests/fixtures/acp-standin.py');
  const admin = path.join(h.workspace, 'resident-admin');
  await mkdir(admin, { recursive: true });
  const resultSource = path.join(admin, 'round-recipe.json');
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
    allowedReadRoots: [h.workspace, path.dirname(wrapper), path.dirname(native)],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['/usr/bin/python3', wrapper], parallelJobs: 3,
    bindings: {
      orfsRoot: path.join(inputs, 'orfs'), celluziRoot: path.join(inputs, 'celluzi'), designConfig: 'designs/sky130hd/aes/config.mk',
      containerImage: IMAGE_ID, bool2cmosRoot: path.join(inputs, 'bool2cmos'), engineeringCapabilities: capability, workspaceRoot: h.workspace,
    },
  });
  await writeFile(podmanLog, '');
  return { h, resultSource, supportRoot, podmanLog };
}

/** Put one round's delivery where the resident stand-in reads it on its next native turn. */
async function stageDelivery(home: Home, round: Round): Promise<void> {
  await writeFile(home.resultSource, round.recipe);
  await rm(home.supportRoot, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(round.support)) {
    await mkdir(path.dirname(path.join(home.supportRoot, rel)), { recursive: true });
    await writeFile(path.join(home.supportRoot, rel), text);
  }
}

// ---------------------------------------------------------------------------------------------
// The owner, acting through executionAction as hima_execute does.
// ---------------------------------------------------------------------------------------------

type Values = Record<string, number | null>;

async function openRun(host: InProcessHost, home: Home, goal: Record<string, number>) {
  const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', goal, ownerSessionId: actor });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
  const runId = started.run.id; const workspace = started.workspace;
  let sequence = 0;
  const context = () => host.ctx.hima.executionContext(runId);
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const run = () => host.ctx.hima.ledger.run(runId)!;
  /** An execution's phase from the Ledger row (cheap), not from a full executionContext. */
  const phaseOf = (executionId: string) => control().executions[executionId]?.phase;
  const records = (): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) =>
    host.ctx.hima.executionAction({ runId, actor, origin: 'agent', action, expectedEpoch: control().epoch,
      expectedRevision: control().revision, requestId: `cellfmax-${++sequence}`, ...fields });
  const failure = (what: string) => JSON.stringify({ what, status: run().status, currentNode: run().currentNode, fork: run().fork,
    available: context().available, reason: context().reason,
    blocked: records().filter((r) => r.type === 'node' && (r.state === 'blocked' || r.state === 'cancelled')).slice(-4),
    refusal: records().findLast((r) => r.type === 'refusal') }).slice(0, 6000) + `\n${timeline()}`
    + `\nHOST LOG TAIL:\n${hostLog(host).slice(-25).join('\n')}\nPROCESSES:\n${spawnSync('/bin/ps', ['-axo', 'pid,etime,command'], { encoding: 'utf8' }).stdout.split('\n').filter((l) => /tmux|podman|cellfmax|read-|python3/.test(l)).slice(0, 30).join('\n')}`;
  const reach = async (nodeId: string, timeoutMs = 90_000) => {
    // The cheap Ledger row first: a full executionContext per look would compete with the Host's own drive.
    const there = () => (run().fork === undefined && run().currentNode === nodeId && context().available.includes(nodeId))
      || String(run().status).startsWith('ended-');
    try { await waitUntil(`the Run reaches ${nodeId}`, there, timeoutMs, 250); }
    catch (error) { assert.fail(`${(error as Error).message}: ${failure(nodeId)}`); }
    assert.ok(context().available.includes(nodeId), failure(nodeId));
  };
  /** The node ids completed so far, in order (what the autopilot and the owner moved through). */
  const doneNodes = () => records().filter((r) => r.type === 'node' && r.state === 'done').map((r) => (r as any).nodeId as string);
  /** The latest observation's values of a Reader, as typed facts. */
  const latestValues = (reader: string): Values => {
    const found = records().findLast((r) => r.type === 'observation' && (r as any).reader.id === reader) as any;
    assert.ok(found, `an observation by ${reader}`);
    return Object.fromEntries(found.values.map((v: any) => [v.type, v.value ?? null]));
  };
  const verdicts = (ruleId: string) => records().filter((r) => r.type === 'verdict' && (r as any).ruleId === ruleId).map((r) => (r as any).outcome as string);
  const taskDirOf = (taskId: string) => path.join(workspace, '.hima-engineering', taskId);
  const nativeState = async (taskId: string) => {
    try { return JSON.parse(await readFile(path.join(taskDirOf(taskId), 'state.json'), 'utf8')); } catch { return undefined; }
  };

  /** One resident engineering round: start, collect a Reader-verified delivery, release, complete. */
  const engineer = async (k: number, round: Round, repair?: Round) => {
    await reach('engineer');
    await stageDelivery(home, round);
    const begin = await act('begin', { nodeId: 'engineer' }); assert.equal(begin.kind, 'accepted', `engineer begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    const start = await act('engineering', { executionId, engineering: { operation: 'start',
      goal: `Round ${k} of custom-cell work on aes/sky130hd. DELIVER_BEST_EFFORT` } });
    assert.equal(start.kind, 'accepted', JSON.stringify(start));
    const data = start.data as any;
    assert.equal(data.status, 'started', JSON.stringify(start));
    const taskId = data.taskId as string;
    await waitUntil(`round ${k} native turn waits with its candidate`, async () => (await nativeState(taskId))?.phase === 'waiting', 20_000, 100);
    let rejected: any; let rejectedReason: string | undefined;
    if (repair !== undefined) {
      const first = await act('engineering', { executionId, engineering: { operation: 'delivery' } });
      rejected = first.data;
      assert.equal(rejected?.status, 'reader-rejected', JSON.stringify(first));
      // The Reader's refusal text is its Job log (the Host keeps it beside the Job's exit file).
      const readerJob = records().findLast((rec: any) => rec.type === 'job' && rec.event === 'finished' && rec.job.name === 'reader-cellfmax-recipe') as any;
      assert.ok(readerJob, 'the recipe Reader ran as a Job');
      rejectedReason = await readFile(path.join(readerJob.job.workspace, `${readerJob.job.session}.log`), 'utf8');
      await stageDelivery(home, repair);
      const message = await act('engineering', { executionId, requestId: `repair-${k}`, engineering: { operation: 'message', message: 'Repair the refused recipe. DELIVER_BEST_EFFORT' } });
      assert.equal((message.data as any)?.status, 'accepted', JSON.stringify(message));
      await waitUntil(`round ${k} repair turn completes`, async () => {
        const state = await nativeState(taskId); return state?.phase === 'waiting' && state.detail?.completedRequestId === `repair-${k}`;
      }, 20_000, 100);
    }
    const delivery = await act('engineering', { executionId, engineering: { operation: 'delivery' } });
    assert.equal((delivery.data as any)?.status, 'verified', JSON.stringify(delivery).slice(0, 4000));
    const release = await act('engineering', { executionId, engineering: { operation: 'release' } });
    assert.equal((release.data as any)?.status, 'released', JSON.stringify(release).slice(0, 2000));
    const done = await act('complete', { executionId }); assert.equal(done.kind, 'accepted', `engineer complete: ${done.reason}`);
    // Completing the engineer opens the fork; record its branches before they drive themselves to the join.
    const forkBranches = Object.keys(run().fork?.branches ?? {}).sort();
    const envelope = JSON.parse(await readFile(path.join(taskDirOf(taskId), 'task.json'), 'utf8'));
    return { executionId, taskId, envelope, delivery: delivery.data as any, rejected, rejectedReason, forkBranches };
  };

  /** The owner's decision at next-round, citing exactly the evidence the Harness names. */
  const decide = async (decision: 'next-strategy' | 'goal-met' | 'converged') => {
    await reach('next-round');
    const begin = await act('begin', { nodeId: 'next-round' }); assert.equal(begin.kind, 'accepted', `next-round begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    assert.notEqual((await act('work', { executionId })).kind, 'refused');
    await waitUntil('next-round settles', () => ['ready', 'failed'].includes(phaseOf(executionId) ?? ''), 30_000, 100);
    const advice = (await act('recommend', { executionId })).data as any;
    const cites = context().cite?.find((item) => item.nodeId === 'next-round')?.cites ?? [];
    const done = await act('complete', { nodeId: 'next-round', executionId, decision, cites: [...cites],
      ...(decision === 'next-strategy' ? { strategy: { engineeringRevision: 1 } } : {}),
      rationale: `Dry-path owner decision: ${decision} on the cited round verdicts.` });
    return { done, advice };
  };

  /** Each node/job record with its offset from the Run's first record, for the time budget. */
  const timeline = () => {
    const all = records(); const t0 = Date.parse(all[0]!.at);
    return all.filter((r) => r.type === 'node' || r.type === 'job')
      .map((r: any) => `${((Date.parse(r.at) - t0) / 1000).toFixed(1)}s ${r.type} ${r.nodeId ?? r.job?.name ?? ''} ${r.state ?? r.event ?? ''}`).join('\n');
  };

  return { owner, runId, workspace, context, run, records, act, reach, doneNodes, latestValues, verdicts, engineer, decide, failure, timeline, phaseOf };
}

const AUTOPILOT_HEAD = ['bind-inputs', 'baseline', 'read-baseline', 'check-baseline'];
const ROUND_TAIL = ['arms-joined', 'compare-round', 'read-round', 'check-round', 'read-round-goal', 'judge-round'];
const ARMS = ['arm-custom', 'read-arm-custom', 'arm-control', 'read-arm-control'];

const NOR3: Cell = { name: 'NOR3_PU2', origin: 'r1', inputs: ['A', 'B', 'C'] };
const NAND2: Cell = { name: 'NAND2_PD2', origin: 'r2', inputs: ['A', 'B'] };

// Group `cellfmax-dry` (on demand, not `local`): on this Mac a Run of either scenario intermittently
// stalls in a fork round with the next launch never recorded (2 of ~10 runs, both files at the same
// moment; no tmux process of this file alive). Not yet diagnosed; recorded in the customer-demo README.
// One scenario per Node process. With both in one process the second Run's fork intermittently
// stalled with a branch never launched (4 of ~8 runs; 0 of 4 alone): the first Host is disposed while
// its drive is still settling and both Hosts share this file's tmux server. Production runs one Host
// per process, so the converged scenario runs from its own file (…-converge.host.test.ts), which sets
// CELLFMAX_DRY_ONLY=converged before importing this one.
const only = process.env.CELLFMAX_DRY_ONLY ?? 'goal-met';

test('cellfmax dry path: two rounds drive the whole graph and end goal-met at a 5 % matched gain', { skip: only !== 'goal-met' }, async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const r = await openRun(host, home, { target_fmax_gain_pct: 5 });
    // ----- the autopilot drives the head and stops at the owner's engineer point
    await r.reach('engineer');
    assert.deepEqual(r.doneNodes(), AUTOPILOT_HEAD, 'bind, baseline and its Reader/Judge drive themselves');
    const inputs = JSON.parse(await readFile(path.join(r.workspace, 'state/inputs.json'), 'utf8'));
    assert.equal(inputs.containerImageId, IMAGE_ID);
    assert.deepEqual(inputs.platformDontUse.length, 4);
    const baseline = r.latestValues('cellfmax-baseline');
    assert.deepEqual(baseline, { baseline_valid: 1, baseline_fmax_mhz: STOCK, baseline_wns_ns: -0.249301, baseline_drc: 0 });
    assert.deepEqual(r.verdicts('baseline-valid'), ['PASS']);

    // ----- round 1, with a Reader-rejected first delivery (no usage guide) repaired in the same task
    const round1 = roundDelivery(1, [NOR3], { claimGainPct: 4.5 });
    const broken = roundDelivery(1, [NOR3], { omitUsage: true, claimGainPct: 4.5 });
    const e1 = await r.engineer(1, broken, round1);
    assert.equal(e1.rejected.status, 'reader-rejected');
    assert.match(e1.rejectedReason ?? '', /round recipe refused: recipe file 'cells\/r1\/usage-guide\.md' does not exist/,
      `the cellfmax-recipe Reader names the missing usage guide: ${e1.rejectedReason}`);
    assert.equal(r.latestValues('cellfmax-recipe').recipe_valid, 1);
    for (const rel of Object.keys(round1.support)) {
      assert.equal(await readFile(path.join(r.workspace, rel), 'utf8'), round1.support[rel], `${rel} materialized in the Campaign`);
    }
    assert.equal(await readFile(path.join(r.workspace, 'state/round-recipe.json'), 'utf8'), round1.recipe, 'the result lands at the produces path');
    assert.deepEqual(e1.forkBranches, ['arm-control', 'arm-custom'], 'completing the engineer opened the two-arm fork');
    await r.reach('next-round');
    const doneR1 = r.doneNodes();
    for (const node of [...ARMS, ...ROUND_TAIL]) assert.ok(doneR1.includes(node), `${node} drove itself in round 1: ${doneR1.join(' ')}`);
    const arms = JSON.parse(await readFile(path.join(r.workspace, 'state/arm-custom.json'), 'utf8'));
    assert.deepEqual(arms.customInstances, { NOR3_PU2: 7 });
    const control = JSON.parse(await readFile(path.join(r.workspace, 'state/arm-control.json'), 'utf8'));
    assert.equal(control.customInstanceTotal, 0, 'the control arm ran with the custom cell in dont-use');
    const g1 = gainPct(ONE_CELL, STOCK);
    const facts1 = r.latestValues('cellfmax-round');
    assert.equal(facts1.comparison_valid, 1);
    assert.equal(facts1.round_improved, 1);
    assert.equal(facts1.custom_adopted, 7);
    assert.equal(facts1.round_gain_pct, g1);
    assert.ok(Math.abs(g1 - 4.035) < 0.001, `round 1 gain ${g1}`);
    assert.equal(facts1.best_custom_fmax_mhz, ONE_CELL);
    assert.equal(facts1.control_matches_baseline, 1);
    assert.equal(facts1.agent_claim_gain_pct, 4.5);
    assert.deepEqual(r.verdicts('comparison-valid'), ['PASS']);
    assert.deepEqual(r.verdicts('fmax-goal'), ['FAIL']);
    assert.deepEqual(r.verdicts('cells-adopted'), ['PASS']);
    assert.deepEqual(r.verdicts('round-improved'), ['PASS']);
    const best1 = JSON.parse(await readFile(path.join(r.workspace, 'state/best.json'), 'utf8'));
    assert.equal(best1.round, 1);

    // ----- the owner asks for another engineering round
    const next = await r.decide('next-strategy');
    assert.equal(next.done.kind, 'accepted', `next-strategy: ${next.done.reason}`);
    assert.equal(next.advice?.chosen?.strategy?.engineeringRevision, 1, JSON.stringify(next.advice));

    // ----- round 2: a new task; the round-1 cell kept byte-identical, a second cell added
    const round2 = roundDelivery(2, [NOR3, NAND2], { claimGainPct: 7 });
    const e2 = await r.engineer(2, round2);
    assert.notEqual(e2.taskId, e1.taskId, 'the revisit opened a new resident task');
    assert.notEqual(e2.executionId, e1.executionId, 'the revisit is a new execution');
    const digest = (envelope: any, name: string) => envelope.inputs.find((item: any) => item.name === name)?.sha256;
    for (const name of ['lessons', 'best']) {
      assert.ok(digest(e1.envelope, name) && digest(e2.envelope, name), `${name} is a task input`);
      assert.notEqual(digest(e2.envelope, name), digest(e1.envelope, name), `round 2 reads the ${name} round 1 wrote`);
    }
    assert.equal(digest(e2.envelope, 'baselineState'), digest(e1.envelope, 'baselineState'));
    await r.reach('next-round');
    const g2 = gainPct(TWO_CELLS, STOCK);
    const facts2 = r.latestValues('cellfmax-round');
    assert.equal(facts2.comparison_valid, 1);
    assert.equal(facts2.round_improved, 1);
    assert.equal(facts2.custom_adopted, 14);
    assert.equal(facts2.round_gain_pct, g2);
    assert.equal(facts2.best_gain_pct, g2);
    assert.ok(g2 >= 5, `round 2 gain ${g2}`);
    assert.deepEqual(r.verdicts('fmax-goal'), ['FAIL', 'PASS']);

    const end = await r.decide('goal-met');
    assert.equal(end.done.kind, 'accepted', `goal-met: ${end.done.reason}`);
    assert.equal(r.run().status, 'ended-goal-met', r.failure('goal-met'));
    const summary = await readFile(path.join(r.workspace, 'derived/summary.md'), 'utf8');
    assert.ok(summary.includes(`Claim boundary: ${CLAIM_BOUNDARY}`), summary);
    assert.match(summary, /\| 2 \| 3\.6 \| orfs-abc \| 277\.78 \| 259\.79 \|/);
    const lessons = JSON.parse(await readFile(path.join(r.workspace, 'state/lessons.json'), 'utf8'));
    assert.deepEqual(lessons.rounds.map((round: any) => [round.round, round.roundGainPct, round.roundImproved]), [[1, g1, true], [2, g2, true]]);
    // Every EDA call went to the stand-in through the Jobs' PATH: one image check, three ORFS runs a
    // round pair (baseline, then custom and control each round) and one cell image per new cell.
    const calls = (await readFile(home.podmanLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[]);
    const variants = calls.filter((argv) => argv[0] === 'run' && argv.some((w) => w.includes('orfs_arm.sh')))
      .map((argv) => argv.find((w) => w.startsWith('CELLFMAX_VARIANT='))).sort();
    assert.deepEqual(variants, ['CELLFMAX_VARIANT=base', 'CELLFMAX_VARIANT=control', 'CELLFMAX_VARIANT=control', 'CELLFMAX_VARIANT=custom', 'CELLFMAX_VARIANT=custom']);
    assert.equal(calls.filter((argv) => argv[0] === 'image').length, 1);
    assert.equal(calls.filter((argv) => argv[0] === 'run' && argv.some((w) => w.includes('klayout'))).length, 2, 'one KLayout image per new cell');
    t.diagnostic(`round gains ${g1} % then ${g2} %; run ${r.runId} ended ${r.run().status}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});

test('cellfmax dry path: rounds that add nothing end converged on the owner\'s decision', { skip: only !== 'converged' }, async (t) => {
  const home = await prepareHome(t);
  const host = await bootInProcess(home.h);
  try {
    const r = await openRun(host, home, { target_fmax_gain_pct: 5 });
    const recommendations: unknown[] = [];
    for (let k = 1; k <= 4; k += 1) {
      const inert: Cell = { name: `NOR3_SLOW_R${k}`, origin: `r${k}`, inputs: ['A', 'B', 'C'] };
      await r.engineer(k, roundDelivery(k, [inert], { claimGainPct: 3 }));
      await r.reach('next-round');
      const facts = r.latestValues('cellfmax-round');
      assert.equal(facts.comparison_valid, 1, `round ${k}`);
      assert.equal(facts.custom_adopted, 0, `round ${k}`);
      assert.equal(facts.round_improved, 0, `round ${k}`);
      assert.equal(facts.round_gain_pct, 0, `round ${k}`);
      assert.equal(facts.best_custom_fmax_mhz, STOCK, `round ${k}: the best custom Fmax never moves`);
      // Ask the chooser first, then decide what it allows.
      const begin = await r.act('begin', { nodeId: 'next-round' }); assert.equal(begin.kind, 'accepted', begin.reason);
      const executionId = begin.receipt!.executionId!;
      assert.notEqual((await r.act('work', { executionId })).kind, 'refused');
      await waitUntil('next-round settles', () => r.phaseOf(executionId) === 'ready', 30_000, 100);
      const advice = (await r.act('recommend', { executionId })).data as any;
      recommendations.push({ round: k, chosen: advice?.chosen });
      const cites = r.context().cite?.find((item) => item.nodeId === 'next-round')?.cites ?? [];
      const converged = advice?.chosen !== undefined && 'converged' in advice.chosen;
      if (!converged && k === 2) {
        // Two flat rounds are not yet the Pack's convergence (generations: 2 needs two earlier ones).
        const early = await r.act('complete', { nodeId: 'next-round', executionId, cites: [...cites], decision: 'converged',
          rationale: 'Trying to stop after two flat rounds.' });
        assert.equal(early.kind, 'refused');
        assert.match(early.reason ?? '', /do not verify the Pack declared convergence/);
      }
      const done = await r.act('complete', { nodeId: 'next-round', executionId, cites: [...cites],
        decision: converged ? 'converged' : 'next-strategy', ...(converged ? {} : { strategy: { engineeringRevision: 1 } }),
        rationale: converged ? 'The best custom Fmax has not moved; the Pack convergence holds.' : 'No gain yet; one more engineering round.' });
      assert.equal(done.kind, 'accepted', `round ${k} decision: ${done.reason}`);
      if (converged) {
        assert.equal(r.run().status, 'ended-converged', r.failure('converged'));
        t.diagnostic(`converged after round ${k}; recommendations ${JSON.stringify(recommendations)}`);
        assert.equal(k, 3, `the chooser recommends converged after round ${k}, expected after round 3: ${JSON.stringify(recommendations)}`);
        return;
      }
    }
    assert.fail(`never converged: ${JSON.stringify(recommendations)}; ${r.failure('converged')}`);
  } finally {
    await host.dispose(); await home.h.dispose();
  }
});
