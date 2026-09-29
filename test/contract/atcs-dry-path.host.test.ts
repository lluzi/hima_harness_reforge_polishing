// Issue #64 Track B: the ATCS Pack's 0.2.0 reference path below the GUI, with no model and no EDA,
// as L2 Host tests. One booted Host drives the real graph from `bind-inputs` as the Run's owner:
// every tool node is the Pack's own `flow/atcs_cli.py` launched as a Job, every Reader and Judge is
// the Pack's own, `prepare-workers` forks the six worker branches (research -> request -> operate ->
// capture -> result) joined at `check-worker-results`, each generation's Contributions are composed
// into one recipe replay (every kept command, then auto-finish) and ONE physical refresh, and the
// Run ends by its generation limit after the two refreshes of the #64 deal. It is then sealed
// through `/hima-test` and `/hima-release` on this home's installed copy of the Pack. A second Run
// shows the third refresh refused at the refresh-budget gate.
//
// What stands in, and only at the Site/tool/model boundary:
// - EDA: the Site's `edaShell` is `test/fixtures/atcs-dry-path/eda-standin.py`, which answers
//   `innovus`, `StarXtract`, `pt_shell` and `xtop` batch commands by writing the reports the Pack
//   reads back (the Pack's own `flow/tests/fixtures.py` generators) and logs every command. An XTop
//   batch (each arm of the recipe replay) is the Pack's own rendered `xtop-replay.tcl` under `tclsh`
//   over the in-memory XTop of `xtop-standin.tcl`.
// - XTop Operator: `test/fixtures/atcs-dry-path/atcs-dry-repl.tcl` under `tclsh`, called as the
//   qualified wrapper is (`<workspace> <slot>`) and bound through the qualified interactive seam: it
//   sources the session Tcl `prepare-workers` rendered for the slot -- the Pack's real typed `atcs_*`
//   toolkit, with its edit domain, mutation budget, reference, gain and undo -- over the same
//   in-memory XTop.
// - Model: every Workshop's code is a fixture under `workshops/` (the Pack's own knowledge
//   `example-*.md` documents with their values changed for this Campaign), written by the owner through
//   `write`; every Team member's result is one synthetic JSON object appended through the Ledger's
//   production handoff shape, and each Operator's commands are this test's script; `/hima-test` and
//   `/hima-release` replay a transcript this test writes from the ended Run. The home's model route
//   is dsh's keyless replay adapter throughout.
//
// - Site faults of treatment attempt 2 (#64 D-T02-2/-4), in the first drive: the Site's `tmux
//   run-shell` answers nothing (a stand-in `tmux` first on PATH, as tmux 3.4 did), and in generation
//   2 one slot's session outlives the Harness close -- a member of its process group ignores hangup
//   and TERM past the declared close grace and ends by itself a few seconds later, as a container
//   still being stopped does. That slot's node is retried in a fresh session and the batch goes on.
//
// No timing, extraction, physical or QoR claim is made by any number below.
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
const SLOTS = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'] as const;
type Slot = typeof SLOTS[number];
const nn = (slot: Slot) => slot.slice(1);
const blockOf = (slot: Slot) => `u_${'abcdef'[SLOTS.indexOf(slot)]}`;
// The #64 deal: two physical refreshes, the Goal value `max_physical_refreshes` fixed when the Run is
// created. Every Explore revisit spends a generation, so two refreshes need three generations.
const REFRESH_CAP = 2;
const GOAL = { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: REFRESH_CAP };
// Six sessions at once: the Site's job cap and XTop seats both allow six interactive Jobs.
const PARALLEL_JOBS = 6;
const XTOP_SEATS = 6;
// The worker batches, one per generation after the baseline's: generation 2 runs all six slots
// active, generation 3 parks two, and a fourth (only under a generation limit of 4) parks five.
const PARKED_BY_BATCH: readonly (readonly Slot[])[] = [[], ['w05', 'w06'], ['w02', 'w03', 'w04', 'w05', 'w06']];
// Generation 2's slot whose first session outlives the Harness close, the declared close grace it
// outlives, and how long its lingering process-group member lives after the session starts.
const SURVIVOR: Slot = 'w02';
const SURVIVOR_GRACE_MS = 4_000;
const SURVIVOR_LINGER_S = 12;
// The reviewer's approved scope for every active slot: sizing and undo, three mutations.
const SCOPE = { commands: ['atcs_size_cell', 'atcs_undo'], maxMutations: 3 };

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
async function prepareHome(t: TestContext, teamExecutions: number, siteFaults = false): Promise<Home> {
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
  if (siteFaults) {
    // The Site's tmux 3.4 printed nothing for `run-shell` (#64 D-T02-4): so does this one, for the whole drive.
    const { chmod } = await import('node:fs/promises');
    const { spawnSync } = await import('node:child_process');
    const realTmux = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(realTmux, 'tmux is on PATH');
    const standins = path.join(h.home, 'silent-run-shell'); await mkdir(standins, { recursive: true });
    await writeFile(path.join(standins, 'tmux'), ['#!/bin/sh', 'for word in "$@"; do [ "$word" = run-shell ] && exit 0; done',
      `exec '${realTmux.replaceAll("'", "'\\''")}' "$@"`, ''].join('\n'));
    await chmod(path.join(standins, 'tmux'), 0o755);
    const priorPath = process.env.PATH;
    process.env.PATH = `${standins}${path.delimiter}${priorPath ?? ''}`;
    t.after(() => { process.env.PATH = priorPath; });
    assert.equal(spawnSync('tmux', ['start-server', ';', 'run-shell', 'echo alive'], { encoding: 'utf8' }).stdout, '', 'run-shell answers nothing');
  }
  const standinLog = path.join(site, 'eda-standin.log');
  await writeFile(path.join(site, 'eda-standin.json'), JSON.stringify({
    fixturesDir: path.join(repoRoot, 'packs', packId, 'flow/tests'), log: standinLog }));
  await writeFile(standinLog, '');

  // The scratch copy of the Pack this home runs, differing from the repository only at the XTop
  // Operator's interactive session: `tclsh` and the dry REPL in place of the Site's qualified XTop
  // wrapper, called with the wrapper's own arguments. The batch path (operate-parked) and the
  // interactive licence declaration are the Pack's own.
  const packsDir = path.join(h.home, 'hima/packs');
  const variant = path.join(packsDir, packId);
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true,
    filter: (src) => !src.includes('__pycache__') });
  const contract = parse(await readFile(path.join(variant, 'contract.yml'), 'utf8')) as any;
  const wrapper = await realpath('/usr/bin/tclsh');
  contract.environment.wrappers = [wrapper, 'python3', '/usr/bin/python3'];
  contract.budget.closingReserveMs = 1000;
  contract.workspace.copy.push('atcs-dry-repl.tcl', 'xtop-standin.tcl');
  const tool = contract.tools.find((item: any) => item.id === 'xtop-operator');
  assert.deepEqual(tool.interactive.argv.slice(1), ['${WORKSPACE}', '${SLOT}'], 'the qualified wrapper is called <workspace> <slot>');
  tool.interactive.argv = [wrapper, '${WORKSPACE}/flow/atcs-dry-repl.tcl', '${WORKSPACE}', '${SLOT}'];
  // A short declared close grace, so the lingering session below outlives it within seconds.
  if (siteFaults) tool.interactive.closeGraceMs = SURVIVOR_GRACE_MS;
  assert.deepEqual(tool.interactive.licences, { xtop: 1 }, 'the xtop seat is the interactive session\'s');
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  assert.equal(graph.entry, 'bind-inputs', 'the dry path starts where the reference graph starts');
  for (const file of ['atcs-dry-repl.tcl', 'xtop-standin.tcl']) await cp(path.join(fixture, file), path.join(variant, 'flow', file));

  const siteFiles = await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, path.dirname(wrapper)], allowedWriteRoots: [h.workspace],
    allowedWrappers: [wrapper, 'python3', '/usr/bin/python3'], parallelJobs: PARALLEL_JOBS,
    licences: { xtop: XTOP_SEATS, innovus: 1, primetime: 1, starrc: 1 },
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
  // `notice` scenario's, repeated for every Team member of every Team execution this drive runs.
  const replay = await writeMomentScenario(h, 'notice', path.join(repoRoot, 'test/fixtures/delegation'));
  const notices = JSON.parse(await readFile(replay.override, 'utf8')) as unknown[];
  await writeFile(replay.override, JSON.stringify(Array.from({ length: teamExecutions * 3 }, () => notices).flat()));
  await writeReplayOverlay(h.home, { file: replay.file, overrideFile: replay.override, childFiles: replay.children });
  assert.match(await readFile(homePatchFile(h.home), 'utf8'), /- id: llm-deepseek\n  disabled: true\n/, 'the drive runs on the replay adapter');
  return { h, packsDir, variant, site, standinLog };
}

/** The workshop code this dry path replays, with the example document and other values inlined. */
async function workshopCode(file: string, substitutions: Record<string, string> = {}): Promise<string> {
  let code = await readFile(path.join(fixture, 'workshops', file), 'utf8');
  for (const [from, to] of Object.entries(substitutions)) code = code.replaceAll(from, to);
  assert.doesNotMatch(code, /__(EXAMPLE|SCENARIOS|PARKED|SLOT)(_JSON)?__/, `${file} has no unfilled placeholder`);
  return code;
}

/** The first fenced JSON document of the Pack's knowledge `example-<name>.md`, as the Workshops read it. */
const example = async (variant: string, name: string): Promise<string> => {
  const text = await readFile(path.join(variant, 'knowledge', `example-${name}.md`), 'utf8');
  const block = /```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(block, `knowledge/example-${name}.md holds a fenced json document`);
  return JSON.stringify(JSON.parse(block[1]!), null, 2);
};

/**
 * The next-investment decisions the dry path replays, all `observe`: first on the baseline, then on
 * each adopted candidate. After an adopt the XTop context `observe` binds is still the parent's, so
 * `research`/`compose`/`revise` are refused "observe first" by the Reader (G38); observe rebinds it.
 */
async function decisions(variant: string): Promise<{ observe: string; reobserve: string }> {
  const observe = await example(variant, 'next-decision');
  const reobserve = JSON.stringify({ ...JSON.parse(observe),
    question: 'which setup paths remain on the adopted candidate before another batch?',
    targets: ['func_ssg_rcworst|setup|u_a/reg0/I'],
    reason: 'the refreshed candidate is adopted but still fails setup on every block; observe the adopted state before researching again',
    falsifier: 'if the adopted state shows no remaining setup path, stop and decide on the evidence at hand' }, null, 2);
  return { observe, reobserve };
}

interface Session {
  readonly slot: Slot;
  readonly executionId: string;
  readonly planHash: string;
  readonly operatorId: string;
  toolSessionId?: string;
  readonly receipts: string[];
}

interface Batch {
  readonly generation: number;
  readonly parked: readonly Slot[];
  readonly active: readonly Slot[];
  readonly executions: Map<Slot, string>;
  concurrentOpen: number;
  readySessions: number;
  gate?: string;
}

interface Drive {
  readonly runId: string;
  readonly workspace: string;
  readonly owner: string;
  readonly ownerAgent: Awaited<ReturnType<typeof createRootAgent>>;
  readonly stops: string[];
  readonly batches: Batch[];
  readonly delegations: number;
  readonly pausedRefusal: string | undefined;
  /** The generation-2 slot whose session outlived the Harness close, as recorded; absent without site faults. */
  readonly survivor?: { readonly close: any; readonly retried: string; readonly retryOpen: any };
}

/**
 * Drive one Run through the reference path as its conversational owner. Generation 1 is the
 * baseline and the owner's first decision; each later generation is one worker batch. With
 * generation limit 3 the owner's revisit at the end of generation 3 is refused by the limit and the
 * Run ends; with limit 4 generation 4's batch stops at the refresh-budget gate, on `wait-for-person`.
 */
async function drive(host: InProcessHost, home: Home, generationLimit: number, log: string[], siteFaults = false): Promise<Drive> {
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
    await waitUntil(`${nodeId} settles`, () => context().executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)), 120_000, 25);
    const settled = context().executions.find(e => e.id === executionId)!;
    if (settled.phase !== 'ready') {
      const jobLog = settled.intent?.job?.workspace && settled.jobSession
        ? await readFile(path.join(settled.intent.job.workspace, `${settled.jobSession}.log`), 'utf8').catch(() => '') : '';
      const blocked = records().findLast(r => r.type === 'node' && r.nodeId === nodeId && r.state === 'blocked');
      const refusal = records().findLast(r => r.type === 'refusal');
      log.push(`STOP ${nodeId}: ${settled.phase}`);
      // A tool failure names its captured EDA log: its tail says what the stand-in refused.
      const toolLog = /"log": "([^"]+)"/.exec(jobLog)?.[1];
      const toolTail = toolLog ? (await readFile(toolLog, 'utf8').catch(e => String(e))).slice(-3000) : '';
      assert.fail(`${nodeId} ${settled.phase}: ${jobLog}\n${toolTail}\n${JSON.stringify({ result: settled.result,
        blockedReason: (blocked as any)?.reason, refusal })}`);
    }
  };
  const verdictsOf = (nodeId: string, executionSeq: number) => {
    const done = records().findLast(r => r.type === 'node' && r.nodeId === nodeId && r.state === 'done') as any;
    const rules = records().filter(r => r.type === 'verdict' && r.seq >= executionSeq).map(r => `${(r as any).ruleId}=${(r as any).outcome}`);
    return done?.kind === 'judge' ? [`${String(done.outcome)}: ${rules.join(', ')}`] : [];
  };
  const where = () => context().run.fork ? 'fork' : context().run.currentNode ?? context().run.status;
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
    log.push(`${nodeId}${verdicts.length ? ` [${verdicts.join(', ')}]` : ''} -> ${where()}`);
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

  // Team seam: per active slot, one Team execution of atcs-worker-NN (version 4, scope mode): the
  // Researcher's and Reviewer's synthetic results adopted through the production handoff shape, the
  // Reviewer approving SCOPE, and one Operator session on the dry REPL driving the real toolkit.
  let delegations = 0;
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
  const teamReady = async (slot: Slot, executionId: string): Promise<Session> => {
    const planBytes = await readFile(path.join(workspace, `research/requests/worker-request-${slot}.json`));
    const planHash = createHash('sha256').update(planBytes).digest('hex');
    const create = (memberId: string) => host.ctx.hima.delegate({ runId, actor, action: 'create', requestId: `create-${memberId}-${executionId}`,
      expectedEpoch: control().epoch, expectedRevision: control().revision,
      recipe: { teamId: `atcs-worker-${nn(slot)}`, version: '4', memberId, executionId } } as never) as Promise<any>;
    const researcher = await create('researcher'); assert.equal(researcher.status, 'created', JSON.stringify(researcher)); delegations += 1;
    // The Researcher reads the slot's own admitted request: its one input ref is that reading.
    const reading = records().findLast(r => r.type === 'observation' && r.reader.id === `atcs-worker-request-${nn(slot)}`);
    assert.ok(reading?.type === 'observation');
    assert.deepEqual(researcher.effectiveContract.inputRefs, [reading.id], `${slot}'s Researcher reads its own request`);
    assert.equal(reading.contentSha256, planHash, `${slot}'s plan hash is the admitted request's content hash`);
    await resultAndAdopt(researcher, { schema: 'atcs-worker-research/1', hypotheses: [`upsizing ${blockOf(slot)}/reg0 shortens its setup path`],
      evidenceRefs: researcher.effectiveContract.inputRefs, limitations: ['replayed; no model'] });
    const reviewer = await create('reviewer'); assert.equal(reviewer.status, 'created', JSON.stringify(reviewer)); delegations += 1;
    await resultAndAdopt(reviewer, { schema: 'atcs-worker-review/2', planSha256: planHash, scope: SCOPE,
      evidenceRefs: reviewer.effectiveContract.inputRefs, limitations: ['replayed; no model'] });
    const operator = await create('operator'); assert.equal(operator.status, 'created', JSON.stringify(operator)); delegations += 1;
    return { slot, executionId, planHash, operatorId: operator.receipt.childSessionId, receipts: [] };
  };
  const interactive = (session: Session, body: any) => host.ctx.hima.interactive(session.operatorId, { runId,
    executionId: session.executionId, nodeId: `operate-worker-${nn(session.slot)}`, ownerEpoch: control().epoch,
    controlRevision: control().revision, ...body }) as Promise<any>;
  const send = async (session: Session, name: string, args: any, id: string) => {
    const value = await interactive(session, { action: 'input', requestId: id, commandId: id,
      toolSessionId: session.toolSessionId, command: { name, args }, waitMs: 5000 });
    assert.equal(value.status, 'completed', `${session.slot} ${name}: ${JSON.stringify(value)}`);
    if (SCOPE.commands.includes(name)) session.receipts.push(id);
    return value;
  };
  /** One active slot's expert loop on its block: reference, (w01: a trial without gain, undone), the kept sizing, close. */
  const expertLoop = async (session: Session, generation: number) => {
    const root = path.join(workspace, JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8')).workers[session.slot].root);
    const block = blockOf(session.slot);
    const tag = `${session.slot}-g${generation}`;
    await send(session, 'atcs_dump_cells', { path: path.join(root, 'before.dump') }, `before-${tag}`);
    await send(session, 'atcs_ref', {}, `ref-${tag}`);
    const master = /(\w+)\s+reg0\s*\(/.exec((await readFile(path.join(root, 'before.dump'), 'utf8')).split('\n')
      .filter(line => line.startsWith(`${block}/reg0 `)).map(line => `${line.split(' ')[1]} reg0 (`)[0]!)![1]!;
    if (session.slot === 'w01' && generation === 2) {
      await send(session, 'atcs_size_cell', { instance: `${block}/reg1`, toMaster: 'BUFFD2BWP', planSha256: session.planHash }, `trial-${tag}`);
      const gain = await send(session, 'atcs_gain', { check: 'setup', topN: 5 }, `trial-gain-${tag}`);
      assert.match(JSON.stringify(gain), /D_TNS/, 'the trial reads its gain against the session reference');
      await send(session, 'atcs_undo', { planSha256: session.planHash }, `undo-${tag}`);
    }
    const toMaster = ({ BUFFD1BWP: 'BUFFD2BWP', BUFFD2BWP: 'BUFFD4BWP', BUFFD4BWP: 'BUFFD8BWP' } as Record<string, string>)[master]!;
    await send(session, 'atcs_size_cell', { instance: `${block}/reg0`, toMaster, planSha256: session.planHash }, `size-${tag}`);
    await send(session, 'atcs_gain', { check: 'setup', topN: 5 }, `gain-${tag}`);
    await send(session, 'atcs_dump_cells', { path: path.join(root, 'after.dump') }, `after-${tag}`);
    await send(session, 'atcs_export_changes', {}, `export-${tag}`);
    await send(session, 'atcs_close', {}, `close-${tag}`);
    await waitUntil(`${session.slot}'s Operator session is ready`, () => control().executions[session.executionId]?.phase === 'ready', 30_000, 25);
  };

  const { observe, reobserve } = await decisions(home.variant);
  const nextDecision = (json: string) => workshopCode('next-decision.py', { __EXAMPLE_JSON__: json });
  const campaignExample = await example(home.variant, 'campaign-plan');
  const requestExample = await example(home.variant, 'worker-request');
  const code = {
    diagnose: await workshopCode('diagnose.py', { __SCENARIOS_JSON__: JSON.stringify(SCENARIOS) }),
    plan: (parked: readonly Slot[]) => workshopCode('plan.py', { __EXAMPLE_JSON__: campaignExample, __PARKED_JSON__: JSON.stringify(parked) }),
    research: (slot: Slot) => workshopCode('research-worker.py', { __EXAMPLE_JSON__: requestExample, __SLOT__: slot }),
    compose: await workshopCode('compose.py'),
  };

  // Generation 1: bind, baseline, the owner's first decision on the baseline itself.
  for (const nodeId of ['bind-inputs', 'read-readiness', 'check-inputs', 'baseline', 'observe-baseline', 'policy',
    'physical-baseline', 'risk-baseline', 'residual-baseline']) await step(nodeId);
  await step('decide-next', await nextDecision(observe));
  for (const nodeId of ['read-next-decision', 'check-next-decision', 'check-continue', 'reread-next-decision-observe', 'route-observe']) await step(nodeId);
  await revisit('revisit-observe');

  let pausedRefusal: string | undefined;
  let survivor: Drive['survivor'];
  const batches: Batch[] = [];
  /** One worker batch: observe, plan, the six-branch fork and its join, compose, replay, the refresh gate. */
  const batch = async (parked: readonly Slot[]) => {
    const generation = context().run.generation ?? 0;
    const active = SLOTS.filter(slot => !parked.includes(slot));
    const current: Batch = { generation, parked, active, executions: new Map(), concurrentOpen: 0, readySessions: 0 };
    batches.push(current);
    await step('diagnose', code.diagnose);
    for (const nodeId of ['read-observation-request', 'check-observation-request', 'observe-query', 'risk-query', 'bind-worker-slots']) await step(nodeId);
    await step('plan', await code.plan(parked));
    for (const nodeId of ['read-campaign-plan', 'check-campaign-plan', 'prepare-workers']) await step(nodeId);
    assert.deepEqual([...context().available].sort(), SLOTS.map(slot => `research-worker-${nn(slot)}`), 'the fork opens six branches');
    for (const slot of SLOTS) {
      await step(`research-worker-${nn(slot)}`, await code.research(slot));
      await step(`read-worker-request-${nn(slot)}`);
    }
    // A parked slot's operate node is the Pack's batch no-op: no Team, no session, no licence.
    for (const slot of parked) current.executions.set(slot, await step(`operate-worker-${nn(slot)}`));
    // Every active slot's Team, then every Operator session opened at once.
    const sessions: Session[] = [];
    for (const slot of active) {
      available(`operate-worker-${nn(slot)}`);
      const begun = await act('begin', { nodeId: `operate-worker-${nn(slot)}` }); assert.equal(begun.kind, 'accepted', JSON.stringify(begun));
      current.executions.set(slot, begun.receipt!.executionId!);
      sessions.push(await teamReady(slot, begun.receipt!.executionId!));
    }
    const survivorSession = siteFaults && generation === 2 ? sessions.find(session => session.slot === SURVIVOR) : undefined;
    if (survivorSession) await writeFile(path.join(workspace, 'workspaces', SURVIVOR, 'linger-once'), `${SURVIVOR_LINGER_S}\n`);
    // Each open is admitted against the control revision the previous one moved, so they are sent in
    // turn; none of the sessions has received a command, let alone closed, until all are open.
    for (const session of sessions) {
      const opened = await interactive(session, { action: 'open', requestId: `open-${session.executionId}` });
      if (opened.status !== 'opened') {
        const earlier = sessions.slice(0, sessions.indexOf(session)).map(other => ({ slot: other.slot,
          execution: control().executions[other.executionId], interactive: records().filter(r => r.type === 'interactive'
            && JSON.stringify(r).includes(other.executionId)).map(r => JSON.stringify((r as any).payload).slice(0, 3000)) }));
        const logs = await Promise.all(sessions.slice(0, sessions.indexOf(session)).map(async other => {
          const job = control().executions[other.executionId]?.jobSession;
          const found = job ? (await readdir(workspace, { recursive: true })).filter(name => String(name).includes(job)) : [];
          return Promise.all(found.map(async name => `${name}:\n${(await readFile(path.join(workspace, String(name)), 'utf8').catch(e => String(e))).slice(-4000)}`));
        }));
        const transcript = await readFile(path.join(workspace, 'workspaces/w01/r1/xtop_log_1.txt'), 'utf8').catch(e => String(e));
        assert.fail(`${session.slot}: ${JSON.stringify(opened).slice(0, 600)}\n${JSON.stringify(earlier, null, 1).slice(0, 12000)}\nLOGS ${JSON.stringify(logs)}\nTRANSCRIPT ${transcript.slice(-3000)}`);
      }
      session.toolSessionId = opened.session.toolSessionId;
    }
    // Every active slot's interactive Job is launched and none has finished: they are open at once.
    const sessionJobs = () => records().filter(r => r.type === 'job' && r.generation === generation && (r as any).licences !== undefined
      && sessions.some(session => (r as any).nodeId === `operate-worker-${nn(session.slot)}`));
    const launched = sessionJobs().filter(r => (r as any).event === 'launched');
    const settledJobs = records().filter(r => r.type === 'job' && (r as any).event !== 'launched' && r.generation === generation
      && sessions.some(session => (r as any).nodeId === `operate-worker-${nn(session.slot)}`));
    current.concurrentOpen = settledJobs.length === 0 ? launched.length : 0;
    // Each session's REPL has run the slot's rendered toolkit up to its ready line, before any command.
    await waitUntil('every session printed its ready line', async () => {
      const texts = await Promise.all(sessions.map(async session => readFile(path.join(workspace,
        JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8')).workers[session.slot].root, 'xtop_log_1.txt'), 'utf8').catch(() => '')));
      return texts.every(text => text.includes('HIMA:hima-tcl-line-v1:1:READY'));
    }, 30_000, 50);
    current.readySessions = sessions.length;
    log.push(`generation ${generation}: ${sessions.length} Operator sessions open at once (${active.join(', ')}); parked ${parked.join(', ') || 'none'}`);
    for (let session of sessions) {
      if (session === survivorSession) {
        // Attempt 2's w01/w02: the Operator dumps and then closes its session through the Harness. A
        // member of the Job's process group outlives the close's hangup and TERM, so the close is
        // recorded `process-survived` and the node holds its slot. The member ends by itself; the
        // Job's end settles the attempt, and the node is retried in a fresh session through the
        // retry guard, which asks the process group itself (never tmux run-shell, silent here).
        const root = path.join(workspace, JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8')).workers[session.slot].root);
        await send(session, 'atcs_dump_cells', { path: path.join(root, 'before-survivor.dump') }, `before-survivor-${session.slot}`);
        const close = await interactive(session, { action: 'close', requestId: `close-survivor-${session.slot}`, toolSessionId: session.toolSessionId });
        assert.equal(close.status, 'process-survived', `${session.slot}'s lingering session outlives the declared close grace: ${JSON.stringify(close)}`);
        await waitUntil(`${session.slot}'s first attempt settles once its lingering process ends`,
          () => ['failed', 'ready'].includes(control().executions[session.executionId]?.phase ?? ''), (SURVIVOR_LINGER_S + 30) * 1000, 100);
        const first = control().executions[session.executionId]!;
        assert.equal(first.phase, 'failed', JSON.stringify(first));
        log.push(`operate-worker-${nn(session.slot)} attempt ${first.attempt}: close process-survived, then its process group ended; ${first.result?.kind}`);
        if (first.result?.kind === 'hard-blocker') {
          // With this drive's retry allowance of one, the failed attempt is a Hard blocker: a person
          // continues the node once its process group is gone, as the tester did in attempt 2. The
          // settlement writes the attempt and then the node's hold; the person acts on what they see
          // once both are there, so the continue is not sent against a revision about to move.
          await waitUntil(`the Hard blocker holds operate-worker-${nn(session.slot)}`,
            () => control().paused.includes(`operate-worker-${nn(session.slot)}`), 10_000, 25);
          const continued = await act('continue', { nodeId: `operate-worker-${nn(session.slot)}`, origin: 'human' });
          assert.equal(continued.kind, 'accepted', `a person continues the node once its survivor is gone: ${continued.reason}`);
          log.push(`operate-worker-${nn(session.slot)}: continued by a person (${continued.reason ?? 'accepted'})`);
        }
        available(`operate-worker-${nn(session.slot)}`);
        const again = await act('begin', { nodeId: `operate-worker-${nn(session.slot)}` }); assert.equal(again.kind, 'accepted', JSON.stringify(again));
        current.executions.set(session.slot, again.receipt!.executionId!);
        const retry = await teamReady(session.slot, again.receipt!.executionId!);
        const retryOpen = await interactive(retry, { action: 'open', requestId: `open-${retry.executionId}` });
        assert.equal(retryOpen.status, 'opened', `the retry opens once the survivor is gone: ${JSON.stringify(retryOpen)}`);
        retry.toolSessionId = retryOpen.session.toolSessionId;
        survivor = { close, retried: again.receipt!.executionId!, retryOpen };
        session = retry;
      }
      await expertLoop(session, generation);
      await resultAndAdopt({ effectiveContract: { delegationId: runDelegations((host.ctx.hima as any).deps(), runId)
        .find(row => row.childSessionId === session.operatorId)!.delegationId } }, {
        schema: 'atcs-worker-session/1', planSha256: session.planHash, mutationReceipts: session.receipts,
        stopReason: 'no-candidate-gains', limitations: ['synthetic Tcl; no commercial qualification'] });
      const completed = await act('complete', { executionId: session.executionId });
      assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
      log.push(`operate-worker-${nn(session.slot)} (Team: researcher, reviewer, operator; ${session.receipts.length} mutations) -> ${where()}`);
    }
    for (const slot of SLOTS) {
      await step(`capture-worker-${nn(slot)}`);
      if (pausedRefusal === undefined) {
        // Recovery without a duplicate effect: a person pauses the Campaign here and continues it.
        const paused = await act('pause', { origin: 'human' }); assert.equal(paused.kind, 'accepted', paused.reason);
        const blocked = await act('begin', { nodeId: `read-worker-result-${nn(slot)}` });
        assert.equal(blocked.kind, 'refused', 'no node begins while the Campaign is paused');
        pausedRefusal = blocked.reason;
        const continued = await act('continue', { origin: 'human' }); assert.equal(continued.kind, 'accepted', continued.reason);
        log.push(`pause/continue after capture-worker-${nn(slot)} (begin refused while paused: ${blocked.reason})`);
      }
      await step(`read-worker-result-${nn(slot)}`);
    }
    for (const nodeId of ['check-worker-results', 'collect', 'read-contribution-index', 'compose-facts', 'read-composition-facts']) await step(nodeId);
    await step('compose', code.compose);
    for (const nodeId of ['read-integration-plan', 'check-integration-plan', 'compose-facts-admitted', 'read-composition-facts-admitted',
      'check-composition', 'replay-prepare', 'reconcile', 'read-integration-state', 'check-replay-mismatch', 'check-replay-scope',
      'presta', 'read-precheck', 'check-presta-model', 'read-refresh-budget', 'check-refresh-budget']) await step(nodeId);
    current.gate = context().run.currentNode ?? context().run.status;
  };
  /** One refresh: the one implement/extract/sta chain, evidence, adoption, residual and the next decision. */
  const refresh = async () => {
    for (const nodeId of ['implement', 'extract', 'sta', 'physical-candidate', 'evaluate', 'read-final-evaluation', 'check-final-coverage',
      'check-final-identity', 'check-constraint-failures', 'check-constraint-unknowns', 'check-setup-goal', 'adopt', 'read-acceptance',
      'check-artifact-ready', 'residual', 'record-experience']) await step(nodeId);
    await step('decide-next', await nextDecision(reobserve));
    for (const nodeId of ['read-next-decision', 'check-next-decision', 'check-continue', 'reread-next-decision-observe', 'route-observe']) await step(nodeId);
    await revisit('revisit-observe');
  };
  for (const parked of PARKED_BY_BATCH.slice(0, generationLimit - 1)) {
    await batch(parked);
    if (batches.at(-1)!.gate !== 'implement') break;
    await refresh();
    if (String(context().run.status).startsWith('ended-')) break;
  }
  return { runId, workspace, owner: actor, ownerAgent: owner, stops: log, batches, delegations, pausedRefusal, ...(survivor === undefined ? {} : { survivor }) };
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

/** Every JSON line of a file, or none when it is absent. */
const jsonLines = async (file: string): Promise<any[]> => (await readFile(file, 'utf8').catch(() => ''))
  .split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

test('ATCS 0.2.0 dry path: six parallel worker branches, two refreshes, ended by the generation limit, sealed by /hima-test and /hima-release', async (t) => {
  // Team executions: six active slots in generation 2, the survivor slot's retry, and four in generation 3.
  const home = await prepareHome(t, 11, true);
  const log: string[] = [];
  const started = Date.now();
  const host = await bootInProcess(home.h);
  let ended = false;
  let result: Drive | undefined;
  t.after(async () => { if (!ended && result) await host.ctx.hima.cancelRun(result.runId).catch(() => undefined); await host.dispose().catch(() => undefined); await home.h.dispose(); });
  try { result = await drive(host, home, 3, log, true); }
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
  const [second, third] = result.batches;
  assert.ok(second && third && result.batches.length === 2, `${row}: two worker batches, in generations 2 and 3`);
  assert.deepEqual(result.batches.map(b => b.generation), [2, 3]);

  // 1. Plans: both generations' six-slot campaign plans are admitted; generation 3's parks w05 and w06.
  assert.deepEqual(observed('atcs-campaign-plan', 'tc_request_invalid_count'), [0, 0], `${row}: both campaign plans are admitted`);
  for (const slot of SLOTS) {
    assert.deepEqual(observed(`atcs-worker-request-${nn(slot)}`, 'tc_request_invalid_count'), [0, 0], `${row}: ${slot}'s requests are admitted`);
  }

  // 2. Six branches at once: generation 2's six Operator sessions, one per branch, were all open at
  //    the same moment under the Site's cap of six Jobs and six XTop seats, each holding one seat.
  assert.equal(second.concurrentOpen, 6, `${row}: six interactive stand-in sessions open at once`);
  assert.equal(second.readySessions, 6);
  const operateJobs = records.filter(r => r.type === 'job' && (r as any).event === 'launched' && (r as any).nodeId?.startsWith('operate-worker-'));
  const secondJobs = operateJobs.filter(r => r.generation === 2) as any[];
  assert.deepEqual(secondJobs.map(r => [r.nodeId, r.branchId, r.licences ?? null]).sort(),
    [...SLOTS, SURVIVOR].sort().map(slot => [`operate-worker-${nn(slot)}`, `research-worker-${nn(slot)}`, { xtop: 1 }]),
    `${row}: each branch's session holds one xtop seat, and the survivor slot's retry holds its own`);

  // 2b. Site faults of attempt 2: the survivor slot's close was recorded process-survived with one
  //     blocker naming its group, the group ended by itself, and the retry opened through the retry
  //     guard with the Site's run-shell answering nothing; no liveness question went through run-shell.
  const survivor = result.survivor;
  assert.ok(survivor, `${row}: the survivor slot ran`);
  const survived = records.filter(r => r.type === 'interactive' && r.event === 'process-survived') as any[];
  assert.equal(survived.length, 1, `${row}: exactly one close was process-survived`);
  assert.equal(survived[0].payload.pid, survivor.close.pid);
  assert.equal(records.filter(r => r.type === 'blocker' && (r as any).nodeId === `operate-worker-${nn(SURVIVOR)}`
    && (r as any).reason.includes(`process group ${survivor.close.pid}`)).length, 1, `${row}: the survivor is one visible blocker on its node, naming its process group`);
  // Its Job is recorded stopped once, and only after the person's continue found its group gone.
  const survivorEnds = records.filter(r => r.type === 'job' && (r as any).event !== 'launched' && (r as any).job.session === survived[0].toolSessionId) as any[];
  assert.deepEqual(survivorEnds.map(r => r.event), ['killed'], `${row}: the survivor's Job is recorded stopped once`);
  assert.ok(survivorEnds[0].seq > survived[0].seq, `${row}: recorded stopped only after its group was observed gone`);
  assert.equal(survivor.retryOpen.status, 'opened');
  const { remoteCommands } = await import('@hima/harness');
  assert.deepEqual(remoteCommands().filter(command => /run-shell/.test(command.wire)), [], `${row}: no Site question went through tmux run-shell`);
  assert.equal(records.filter(r => r.type === 'interactive' && /Host restarted/.test(JSON.stringify((r as any).payload))).length, 0,
    `${row}: no record says the Host restarted: it never did`);

  // 3. Parked slots: generation 3's w05/w06 created no Team member, no interactive session and no licence claim.
  assert.equal(third.concurrentOpen, 4, `${row}: generation 3 opens the four active slots' sessions at once`);
  const delegationRows = runDelegations((host.ctx.hima as any).deps(), runId);
  for (const slot of ['w05', 'w06'] as const) {
    const executionId: string = third.executions.get(slot)!;
    assert.equal(delegationRows.filter(r => JSON.stringify(r).includes(executionId)).length, 0, `${row}: parked ${slot} has no Team member`);
    const branchJobs = operateJobs.filter(r => r.generation === 3 && (r as any).branchId === `research-worker-${nn(slot)}`) as any[];
    assert.deepEqual(branchJobs.map(r => r.licences ?? null), [null], `${row}: parked ${slot}'s operate node is one batch no-op with no licence`);
    const workers = JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8'));
    assert.equal(workers.workers[slot].parked, true);
    const receipt = JSON.parse(await readFile(path.join(workspace, workers.workers[slot].root, 'parked.json'), 'utf8'));
    assert.equal(receipt.taskId, slot, `${row}: parked ${slot}'s no-op left its receipt`);
  }
  assert.equal(result.delegations, 33, `${row}: three Team members for each of eleven active slot executions (the survivor slot's retry included)`);
  assert.equal(delegationRows.length, 33, `${row}: the Run holds exactly those thirty-three Team children`);

  // 4. Refreshes: two implement/extract/sta chains, two ledger entries, the gate read 0 then 1 before them.
  for (const nodeId of ['implement', 'extract', 'sta']) assert.equal(jobsOf(nodeId).length, 2, `${row}: ${nodeId} ran twice`);
  const refreshLedger = JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8'));
  assert.equal(refreshLedger.entries.length, 2, `${row}: the refresh ledger holds two refreshes`);
  assert.deepEqual(observed('atcs-refresh-budget', 'tc_refreshes_completed'), [0, 1], `${row}: the gate read 0 and then 1 completed refreshes`);
  assert.deepEqual(observed('atcs-acceptance-record', 'tc_refresh_count'), [1, 2], `${row}: the acceptance records count one and then two refreshes`);
  assert.equal(run.goal?.max_physical_refreshes, REFRESH_CAP, 'the refresh cap is the Goal value the Run was created with');

  // 5. The replay: every generation's recipe replays every kept command -- w01's undone trial is not
  //    in it -- and then the auto-finish step, in the merged arm, from the common base.
  const batchDirs = (await readdir(path.join(workspace, 'integrations'))).sort();
  assert.equal(batchDirs.length, 2, `${row}: one replay batch per generation`);
  for (const [index, batchId] of batchDirs.entries()) {
    const active: readonly Slot[] = result.batches[index]!.active;
    const merged = path.join(workspace, 'integrations', batchId, 'merged');
    const recipe = await readFile(path.join(merged, 'recipe.tcl'), 'utf8');
    const replayed = [...recipe.matchAll(/atcs_replay_step \{[^}]+\} 0 \{atcs_size_cell \{(\S+)\} \{(\S+)\}/g)].map(m => m[1]!);
    assert.deepEqual(replayed.sort(), active.map(slot => `${blockOf(slot)}/reg0`).sort(),
      `${row}: ${batchId} replays each active session's one kept sizing, and no undone trial`);
    const receipts = await jsonLines(path.join(merged, 'receipts.jsonl'));
    assert.deepEqual(receipts.map(r => r.status), active.map(() => 'applied'), `${row}: ${batchId}: every kept command applied`);
    const armResult = JSON.parse(await readFile(path.join(merged, 'arm-result.json'), 'utf8'));
    const autoFix = await readFile(path.join(merged, 'auto-fix.tcl'), 'utf8');
    assert.ok(autoFix.trim().split('\n').length >= 1, `${row}: ${batchId} carries auto-finish lines`);
    assert.deepEqual(armResult.autoFix.map((entry: any) => [entry.command, entry.code]),
      autoFix.trim().split('\n').map(line => [line, 0]), `${row}: ${batchId}: every auto-finish line ran after the recipe`);
    assert.equal(armResult.complete, true);
  }
  const lastState = JSON.parse(await readFile(path.join(workspace, 'state/integration-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(lastState.autoDelta?.mastersChanged ?? {}).sort(),
    ['u_e/reg0', 'u_f/reg0'], `${row}: generation 3's auto-finish sized the two parked slots' blocks`);
  const kept = await jsonLines(path.join(workspace, 'workspaces/w01', (await readdir(path.join(workspace, 'workspaces/w01'))).sort()[0]!, 'ops.jsonl'));
  assert.deepEqual(kept.map(line => [line.cmd, line.status]), [['size_cell', 'kept'], ['undo', 'kept'], ['size_cell', 'kept']],
    `${row}: w01's session log holds the trial, its undo and the kept sizing`);

  // 6. Budget: generation limit 3, refresh cap 2; the revisit at the end of generation 3 is refused by the limit.
  assert.equal(run.budget?.generationLimit, 3);
  assert.equal(run.generation, 3);
  assert.equal(run.status, 'ended-budget-exhausted', `${row}: ${JSON.stringify(run.meters)}`);
  assert.equal((run.meters as any)?.endedBy, 'generation-limit', JSON.stringify(run.meters));

  // 7. Recovery: the pause refused a begin, and continuing duplicated no Job or Contribution.
  assert.ok(result.pausedRefusal, 'the paused Campaign refused a new node');
  for (const nodeId of ['capture-worker-01', 'read-worker-result-01', 'collect']) assert.equal(jobsOf(nodeId).length, 2, `${row}: ${nodeId} launched once per generation`);

  // 8. Zero EDA: every command the stand-in answered, and only those four tools.
  const standin = await jsonLines(home.standinLog);
  assert.deepEqual([...new Set(standin.map(entry => entry.tool))].sort(), ['StarXtract', 'innovus', 'pt_shell', 'xtop'],
    `${row}: the stand-in answered innovus, StarRC, PrimeTime and the XTop replay batch, and nothing else`);

  // 9. Ending and sealing.
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
  // Zero model: the owner conversation that drove every node made no tool call of a model's, and
  // every turn it had is the replayed notice acknowledgement, one per Team member.
  const noticeText = 'I acknowledge the retained facts. I will not start another task.';
  assert.deepEqual(toolCalls(result.ownerAgent), [], 'the owner never produced a model tool call');
  // Whatever turns the delegation layer gives the owner (fewer than one per Team member here: it
  // does not wake the owner for each of thirty children), every one is the replayed acknowledgement.
  let heard = -1;
  await waitUntil('the owner is quiet', () => { const now = saidByModel(result!.ownerAgent).length; const quiet = now === heard; heard = now; return quiet; }, 60_000, 2000);
  const turns = saidByModel(result.ownerAgent);
  log.push(`owner notice turns: ${turns.length} for ${result.delegations} Team members`);
  assert.ok(turns.length >= 1 && turns.length <= result.delegations, `owner turns: ${turns.length}`);
  assert.deepEqual(turns, Array(turns.length).fill(noticeText), 'every owner turn is the replay transcript\'s notice acknowledgement');
  ended = true;
  await host.dispose();

  const generations = [...new Set(records.filter(r => r.type === 'node').map(r => r.generation))].sort();
  const testRecord = [
    '# Test record', '',
    '## Site', '',
    'Run on site `local`. `edaShell` is the dry-path stand-in (test/fixtures/atcs-dry-path/eda-standin.py): no Innovus,',
    'StarRC, PrimeTime or XTop ran. The XTop Operator sessions and the replay run the Pack\'s own Tcl under tclsh.', '',
    '## Run', '',
    `run: ${runId}`, '',
    `Goal: target_setup_wns_ns = 0, target_hold_wns_ns = 0. Generation limit 3; refresh cap ${REFRESH_CAP}.`, '',
    '## Ending', '',
    `status: ${run.status}`, '',
    'Ended by the generation limit when the owner chose to observe again at the end of generation 3.', '',
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
  assert.deepEqual(tested.said, [`TEST.md records run ${runId}, ended ${run.status}.`]);
  assert.deepEqual(released.said, ['Sealed.']);
  log.push(`elapsed ${Math.round((Date.now() - started) / 1000)} s`);
  if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(process.env.HIMA_ATCS_DRY_LOG, log.join('\n') + '\n');
});

test('ATCS 0.2.0 dry path: with generation limit 4 the third refresh is refused at the refresh-budget gate, and clearing the wait ends the Run', async (t) => {
  // Team executions: six, four and then one active slot.
  const home = await prepareHome(t, 11);
  const log: string[] = [];
  const host = await bootInProcess(home.h);
  let result: Drive | undefined;
  t.after(async () => { if (result) await host.ctx.hima.cancelRun(result.runId).catch(() => undefined); await host.dispose().catch(() => undefined); await home.h.dispose(); });
  try { result = await drive(host, home, 4, log); }
  finally { if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(`${process.env.HIMA_ATCS_DRY_LOG}.limit4`, log.join('\n') + '\n'); }
  const { runId, workspace } = result;
  const ledger = host.ctx.hima.ledger;
  const pack = loadPack(home.packsDir, packId);
  const row = `row: source ${packId}@${pack.contract.version}, Pack digest ${pack.folder.digest(packDigestExcludes)}, Site local stand-in`;
  const records = () => ledger.records({ runId });
  const run = ledger.run(runId)!;
  assert.equal(run.budget?.generationLimit, 4);
  assert.equal(run.generation, 4);
  assert.equal(run.currentNode, 'wait-for-person', `${row}: ${JSON.stringify({ status: run.status, currentNode: run.currentNode })}`);
  const gate = records().filter(r => r.type === 'node' && r.nodeId === 'check-refresh-budget' && r.state === 'done') as any[];
  assert.deepEqual(gate.map(r => [r.generation, r.outcome]), [[2, 'PASS'], [3, 'PASS'], [4, 'FAIL']],
    `${row}: the gate passed two refreshes and refused the third`);
  const verdict = records().findLast(r => r.type === 'verdict' && (r as any).ruleId === 'refresh-budget') as any;
  assert.equal(verdict.outcome, 'FAIL');
  assert.deepEqual(verdict.valuesAsRead.map((v: any) => [v.type, v.value]), [['tc_refreshes_completed', 2]]);
  assert.equal(run.goal?.max_physical_refreshes, REFRESH_CAP);
  const refreshLedger = JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8'));
  assert.equal(refreshLedger.entries.length, 2, `${row}: no third refresh ran`);
  const sessions = new Set(records().filter(r => r.type === 'node' && r.nodeId === 'implement').map(r => (r as any).jobSession).filter(Boolean));
  assert.equal(sessions.size, 2, `${row}: implement launched twice in four generations`);

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
  if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(`${process.env.HIMA_ATCS_DRY_LOG}.limit4`, log.join('\n') + '\n');
  assert.match(String(ended.status), /^ended-(budget-exhausted|goal-not-met)$/, `${row}: clearing the wait ended the Run: ${String(ended.status)}`);
  assert.equal(JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8')).entries.length, 2);
});
