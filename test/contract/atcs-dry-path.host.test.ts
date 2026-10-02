// Issue #64, reshaped 2026-09-29 (ADR-0016): the ATCS Pack's 0.2.0 reference path below the GUI, with
// no model and no EDA, as L2 Host tests. A generation reads
//
//   plan -> six self-driving expert branches -> merge (compose, replay, reconcile, presta)
//        -> one refresh -> evaluate -> automatic re-observation -> ONE owner decision
//
// and the Pack declares everything between the owner's three points (the plan Workshop, the merge
// Workshop at the join, the decision) as `autopilot`. So the Run's owner here acts at `plan`,
// `compose` and `decide` and nowhere else: the Harness takes every other node turn itself, each
// branch's child Agent authors its research Workshop, and each active slot's Operator works from the
// request embedded in its task and is adopted as its schema-valid result arrives. Every tool node is
// the Pack's own `flow/atcs_cli.py` launched as a Job, every Reader and Judge is the Pack's own, each
// generation's Contributions are composed into one recipe replay (every kept command, then
// auto-finish) and ONE physical refresh, and the Run ends by its generation limit after the two
// refreshes of the #64 deal. It is then sealed through `/hima-test` and `/hima-release` on this
// home's installed copy of the Pack. A second Run shows a third generation refused at the refresh
// budget gate, the honest end.
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
// - Model: the owner's Workshop code is a fixture under `workshops/` (the Pack's own knowledge
//   `example-*.md` documents with their values changed for this Campaign), written through `write`;
//   each branch's child Agent is played by this test through the Ledger's production handoff shape
//   (`HIMA_TEST_AUTOPILOT_CHILD_RESULTS=ledger`): the research entry in generation 1 (generation 2
//   runs the retained code), and each Operator's session and result. `/hima-test` and `/hima-release`
//   replay a transcript this test writes from the ended Run. The home's model route is dsh's keyless
//   replay adapter throughout.
// - Site faults of treatment attempt 2 (#64 D-T02-2/-4), in the first drive: the Site's `tmux
//   run-shell` answers nothing (a stand-in `tmux` first on PATH, as tmux 3.4 did), and in generation
//   1 one slot's session outlives the Harness close -- a member of its process group ignores hangup
//   and TERM past the declared close grace and ends by itself a few seconds later, as a container
//   still being stopped does. The autopilot retries that slot's node in a fresh session and the batch
//   goes on, without a person.
//
// No timing, extraction, physical or QoR claim is made by any number below.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { appendFile, cp, mkdir, readFile, readdir, realpath, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
import {
  BUILTIN_TCL_ADAPTER_DIGEST, HIMA_TEST_SECTIONS, WORKSHOP_ENTRY_SCHEMA, checkTestRecord, interactiveCommandsDigest, loadPack,
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
const MAX_PATHS = 1000;
const SLOTS = ['w01', 'w02', 'w03', 'w04', 'w05', 'w06'] as const;
type Slot = typeof SLOTS[number];
const nn = (slot: Slot) => slot.slice(1);
const blockOf = (slot: Slot) => `u_${'abcdef'[SLOTS.indexOf(slot)]}`;
// The #64 deal: two physical refreshes, the Goal value `max_physical_refreshes` fixed when the Run is
// created. Every generation is one batch and one refresh, so two refreshes need two generations.
const REFRESH_CAP = 2;
const GOAL = { target_setup_wns_ns: 0, target_hold_wns_ns: 0, max_physical_refreshes: REFRESH_CAP };
// Six sessions at once: the Site's job cap and XTop seats both allow six interactive Jobs.
const PARALLEL_JOBS = 6;
const XTOP_SEATS = 6;
// The worker batches, one per generation: generation 1 runs all six slots active, generation 2 parks
// two, and a third (only under a generation limit of 3) never plans: its refresh-budget gate refuses.
const PARKED_BY_BATCH: readonly (readonly Slot[])[] = [[], ['w05', 'w06']];
// Generation 1's slot whose first session outlives the Harness close, the declared close grace it
// outlives, and how long its lingering process-group member lives after the session starts.
const SURVIVOR: Slot = 'w02';
const SURVIVOR_GRACE_MS = 4_000;
const SURVIVOR_LINGER_S = 12;
// The Operator's own nodes' turns are the Harness's: the owner acts only at these three.
const OWNER_NODES = ['plan', 'compose', 'decide'];
// #66 T4, the derived-domain fixture (design/top.v): a boundary buffer x_<left><right> joins each pair
// of neighbouring blocks, so a slot's session derives its block's two cells plus the boundary buffers
// one hop out, and two neighbours' derived domains share exactly the buffer between them.
const BOUNDARY = ['x_ab', 'x_bc', 'x_cd', 'x_de', 'x_ef'] as const;
const derivedDomain = (slot: Slot) => {
  const index = SLOTS.indexOf(slot);
  return [`${blockOf(slot)}/reg0`, `${blockOf(slot)}/reg1`, ...BOUNDARY.slice(Math.max(0, index - 1), index + 1)].sort();
};
// Generation 1's planted overlap: NEIGHBOUR and COLLIDER both size the boundary buffer they share,
// inside both derived domains. NEIGHBOUR keeps a two-step batch, so its aggregate gain ranks it above
// COLLIDER. Replay is an aggregator: both batches enter the recipe, and only COLLIDER's later sizing of
// SHARED is skipped (`shared-instance`), recorded with its reason, while its own block's sizing replays.
const NEIGHBOUR: Slot = 'w03';
const COLLIDER: Slot = 'w04';
const SHARED = 'x_cd';
// The four auto-finish commands as the attempt-4 seal (a5ded4fc) rendered them at the default margins
// (the Pack's flow/tests/test_effective_domain_replay.py ATTEMPT4_AUTO_FINISH), byte for byte.
const ATTEMPT4_AUTO_FINISH = [
  'fix_setup_gba_violations -methods size_cell -effort high -setup_target 0.0 -hold_margin 0.02',
  'fix_setup_gba_violations -methods insert_buffer -effort high -setup_target 0.0 -hold_margin 0.02',
  'fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0.0 -setup_margin 0.02',
  'fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin 0.02',
];

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
process.env.HIMA_TEST_AUTOPILOT_CHILD_RESULTS = 'ledger';
process.env.HIMA_RESIDENT_TESTING = '1';

const canonicalObject = (value: any): any => Array.isArray(value) ? value.map(canonicalObject)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalObject(value[key])]))
    : value;
const stampAtcs = (kind: string, value: Record<string, unknown>) => {
  const body = { ...value, schema: `atcs.${kind}/1` };
  const id = createHash('sha256').update(JSON.stringify(canonicalObject(body))).digest('hex').slice(0, 20);
  return { ...body, id };
};
const treeDigestForSingleFile = (name: string, bytes: Buffer) => createHash('sha256').update(JSON.stringify([{
  path: name, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length,
}])).digest('hex');

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
  // These production dry-path cases preserve the admitted 0.2.10 six-branch/physical-referee
  // method. The current Pack is 0.3.0; overlay the explicit immutable method snapshot instead of
  // weakening the old assertions to fit the new resident-engineering graph.
  await cp(path.join(variant, 'legacy/0.2.10/contract.yml'), path.join(variant, 'contract.yml'));
  await cp(path.join(variant, 'legacy/0.2.10/graph.yml'), path.join(variant, 'graph.yml'));
  await cp(path.join(variant, 'legacy/0.2.10/semantics.yml'), path.join(variant, 'semantics.yml'));
  for (const file of ['INTENT.md', 'SPEC.md', 'FABRIC.md']) {
    await cp(path.join(variant, `legacy/0.2.10/${file}`), path.join(variant, file));
  }
  await rm(path.join(variant, 'TEST.md'), { force: true });
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


interface Batch {
  readonly generation: number;
  readonly parked: readonly Slot[];
  readonly active: readonly Slot[];
  /** The operate execution each slot's branch settled with. */
  readonly executions: Map<Slot, string>;
  concurrentOpen: number;
  readySessions: number;
  /** When the fork opened and when the Run reached the join's owner point (compose). */
  forkOpenedAt?: number;
  joinedAt?: number;
  /** What the owner's merge read at the join, and the replay request the merge produced (#66 T4). */
  collected?: any;
  facts?: any;
  replayRequest?: any;
}

interface Drive {
  readonly runId: string;
  readonly workspace: string;
  readonly owner: string;
  readonly ownerAgent: Awaited<ReturnType<typeof createRootAgent>>;
  readonly stops: string[];
  readonly batches: Batch[];
  readonly pausedRefusal: string | undefined;
  /** The generation-1 slot whose session outlived the Harness close, as recorded; absent without site faults. */
  readonly survivor?: { readonly close: any; readonly retried: string; readonly retryOpen: any };
  /** Each Operator's rendered task and the request it works from, for the embedded-request check. */
  readonly operatorTasks: { readonly slot: Slot; readonly task: string; readonly request: any; readonly planSha256: string }[];
  /** Wall time of the drive itself, start to the Run's ending, in ms. */
  readonly driveMs: number;
}

/**
 * Drive one Run through the reference path as its conversational owner, who acts at `plan`,
 * `compose` and `decide` only, while this test plays each branch's child Agent. With generation
 * limit 2 the owner's continue at the end of generation 2 is refused by the limit and the Run ends;
 * with limit 3, generation 3 stops at the refresh-budget gate, on `wait-for-person`.
 */
async function drive(host: InProcessHost, home: Home, generationLimit: number, log: string[], siteFaults = false): Promise<Drive> {
  const began = Date.now();
  const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', test: true, goal: GOAL,
    strategy: { maxPaths: MAX_PATHS }, generationLimit, retryAllowance: 2, ownerSessionId: actor, timeBoxMs: 3_600_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
  const runId = started.run.id; const workspace = started.workspace;
  let sequence = 0;
  const context = () => host.ctx.hima.executionContext(runId);
  const control = () => host.ctx.hima.ledger.run(runId)!.control!;
  const run = () => host.ctx.hima.ledger.run(runId)!;
  const records = () => host.ctx.hima.ledger.records({ runId });
  const deps = () => (host.ctx.hima as any).deps();
  const act = (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) =>
    host.ctx.hima.executionAction({ runId, actor, origin: 'agent', action, expectedEpoch: control().epoch,
      expectedRevision: control().revision, requestId: `dry-${++sequence}`, ...fields });
  const human = async (action: ExecutionActionRequest['action'], fields: Partial<ExecutionActionRequest> = {}) => {
    for (let attempt = 0; ; attempt++) {
      const sent = await host.ctx.hima.executionAction({ runId, actor, origin: 'human', action, expectedEpoch: control().epoch,
        expectedRevision: control().revision, requestId: `dry-human-${++sequence}`, ...fields });
      if (sent.kind !== 'refused' || !/revision is stale/.test(sent.reason ?? '') || attempt >= 20) return sent;
    }
  };
  const failure = (what: string) => JSON.stringify({ what, status: run().status, currentNode: run().currentNode, fork: run().fork,
    paused: control().paused, reason: context().reason,
    blocked: records().filter((r) => r.type === 'node' && (r.state === 'blocked' || r.state === 'cancelled')).slice(-4),
    refusal: records().findLast((r) => r.type === 'refusal') }).slice(0, 6000);
  /** The Run reaches one of the owner's points. */
  const reach = async (nodeId: string, timeoutMs = 240_000) => {
    try { await waitUntil(`the Run reaches ${nodeId}`, () => context().available.includes(nodeId) || String(run().status).startsWith('ended-'), timeoutMs, 50); }
    catch (error) { assert.fail(`${(error as Error).message}: ${failure(nodeId)}`); }
    assert.ok(context().available.includes(nodeId), failure(nodeId));
  };
  /** The owner's turn at one node: begin, (a Workshop writes its entry,) work, settle, complete. */
  const step = async (nodeId: string, code?: string) => {
    await reach(nodeId);
    const begin = await act('begin', { nodeId }); assert.equal(begin.kind, 'accepted', `${nodeId} begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    if (code !== undefined) {
      const wrote = await act('write', { executionId, path: 'entry.py', content: code });
      assert.equal(wrote.kind, 'accepted', `${nodeId} write: ${wrote.reason}`);
    }
    const worked = await act('work', { executionId }); assert.notEqual(worked.kind, 'refused', `${nodeId} work: ${worked.reason}`);
    await waitUntil(`${nodeId} settles`, () => context().executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)), 120_000, 25);
    const settled = context().executions.find(e => e.id === executionId)!;
    assert.equal(settled.phase, 'ready', `${nodeId}: ${JSON.stringify(settled)}`);
    const done = await act('complete', { nodeId, executionId }); assert.equal(done.kind, 'accepted', `${nodeId} complete: ${done.reason}`);
    log.push(`owner: ${nodeId} -> ${run().fork ? 'fork' : run().currentNode ?? run().status}`);
  };
  /** The owner's one decision: continue with the next generation from the working state. */
  const decide = async () => {
    await reach('decide');
    const begin = await act('begin', { nodeId: 'decide' }); assert.equal(begin.kind, 'accepted', `decide begin: ${begin.reason}`);
    const executionId = begin.receipt!.executionId!;
    assert.notEqual((await act('work', { executionId })).kind, 'refused');
    await waitUntil('decide settles', () => context().executions.some(e => e.id === executionId && ['ready', 'failed'].includes(e.phase)), 30_000, 25);
    const cites = context().cite?.find((item) => item.nodeId === 'decide')?.cites ?? [];
    const generation = run().generation;
    const done = await act('complete', { nodeId: 'decide', executionId, decision: 'next-strategy', strategy: { maxPaths: MAX_PATHS }, cites: [...cites],
      rationale: 'Replayed owner decision: continue with the next generation from the working state.' });
    assert.equal(done.kind, 'accepted', `decide complete: ${done.reason}`);
    log.push(`owner: decide (generation ${generation}) -> ${run().currentNode ?? ''} ${run().status}, generation ${run().generation}`);
  };

  // The branch children this test plays: each branch's research author (generation 1) and each active
  // slot's Operator. Every result goes in through the production handoff shape.
  const answered = new Set<string>();
  const answer = async (delegationId: string, text: string) => {
    const row = runDelegations(deps(), runId).find((item) => item.delegationId === delegationId)!;
    await host.ctx.hima.ledger.appendDelegation(runId, { delegationId, parentSessionId: actor, childSessionId: row.childSessionId,
      requestId: `result-${delegationId}-${++sequence}`.slice(0, 160), requestDigest: 'a'.repeat(64), event: 'result-observed', payload: {
        candidate: true, source: 'native-live-session', handoff: {
          outputIdentity: createHash('sha256').update(JSON.stringify([{ type: 'text', text }])).digest('hex'),
          contract: { recordId: row.contractRecordId, requestDigest: row.requestDigest },
          output: { text, content: [{ type: 'text', text }], truncated: false }, completedTurn: { turn: 1, endSeq: 1 },
          unknowns: [], evidence: { artifactRefs: [], diffRefs: [], testRefs: [], limitations: ['replayed branch child; no model'] },
        } } });
  };
  const authorOf = async (slot: Slot) => {
    let id = '';
    await waitUntil(`research-worker-${nn(slot)}'s author is asked`, () => {
      const row = runDelegations(deps(), runId).find((item) => item.delegationId.startsWith(`autopilot-author-research-worker-${nn(slot)}-`)
        && !answered.has(item.delegationId) && item.state === 'accepted');
      if (row !== undefined) id = row.delegationId;
      return row !== undefined;
    }, 240_000, 25);
    answered.add(id);
    return id;
  };
  const operatorOf = async (slot: Slot) => {
    let found: ReturnType<typeof runDelegations>[number] | undefined;
    await waitUntil(`operate-worker-${nn(slot)}'s Operator is materialized`, () => {
      found = runDelegations(deps(), runId).find((row) => row.effective.recipe?.teamId === `atcs-worker-${nn(slot)}`
        && row.effective.recipe.memberId === 'operator' && row.state === 'accepted' && !answered.has(row.delegationId));
      return found !== undefined;
    }, 240_000, 25);
    answered.add(found!.delegationId);
    return found!;
  };
  type Operator = ReturnType<typeof runDelegations>[number];
  const interactive = (operator: Operator, body: any) => host.ctx.hima.interactive(operator.childSessionId, { runId,
    executionId: operator.effective.recipe!.executionId, nodeId: operator.contract.nodeRef, ownerEpoch: control().epoch,
    controlRevision: control().revision, ...body }) as Promise<any>;
  const send = async (operator: Operator, toolSessionId: string, name: string, args: any, id: string, receipts?: string[]) => {
    const value = await interactive(operator, { action: 'input', requestId: id, commandId: id, toolSessionId, command: { name, args }, waitMs: 5000 });
    assert.equal(value.status, 'completed', `${operator.contract.nodeRef} ${name}: ${JSON.stringify(value)}`);
    if (receipts !== undefined && ['atcs_size_cell', 'atcs_undo'].includes(name)) receipts.push(id);
    return value;
  };
  const rootOf = async (slot: Slot) => path.join(workspace, JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8')).workers[slot].root);
  const operatorTasks: Drive['operatorTasks'] = [];
  /**
   * One active slot's expert loop on its block: reference, a point read of its target, (w01: a trial
   * without gain, undone), the kept sizing, (generation 1: NEIGHBOUR a second step and a sizing of the
   * boundary buffer SHARED, COLLIDER a sizing of SHARED too, each inside its derived domain), a point
   * read again, close.
   */
  const expertLoop = async (slot: Slot, operator: Operator, toolSessionId: string, generation: number) => {
    const root = await rootOf(slot);
    const block = blockOf(slot);
    const tag = `${slot}-g${generation}`;
    const planSha256 = operator.effective.recipe!.inlinePayload!.planSha256;
    const receipts: string[] = [];
    await send(operator, toolSessionId, 'atcs_dump_cells', { path: path.join(root, 'before.dump') }, `before-${tag}`);
    await send(operator, toolSessionId, 'atcs_ref', {}, `ref-${tag}`);
    const target = `${block}/reg0/I`;
    await send(operator, toolSessionId, 'atcs_point', { check: 'setup', endPoints: target }, `point-${tag}`);
    const master = /(\w+)\s+reg0\s*\(/.exec((await readFile(path.join(root, 'before.dump'), 'utf8')).split('\n')
      .filter(line => line.startsWith(`${block}/reg0 `)).map(line => `${line.split(' ')[1]} reg0 (`)[0]!)![1]!;
    if (slot === 'w01' && generation === 1) {
      await send(operator, toolSessionId, 'atcs_size_cell', { instance: `${block}/reg1`, toMaster: 'BUFFD2BWP', planSha256 }, `trial-${tag}`, receipts);
      const gain = await send(operator, toolSessionId, 'atcs_gain', { check: 'setup', topN: 5 }, `trial-gain-${tag}`);
      assert.match(JSON.stringify(gain), /D_TNS/, 'the trial reads its gain against the session reference');
      await send(operator, toolSessionId, 'atcs_undo', { planSha256 }, `undo-${tag}`, receipts);
    }
    const toMaster = ({ BUFFD1BWP: 'BUFFD2BWP', BUFFD2BWP: 'BUFFD4BWP', BUFFD4BWP: 'BUFFD8BWP' } as Record<string, string>)[master]!;
    await send(operator, toolSessionId, 'atcs_size_cell', { instance: `${block}/reg0`, toMaster, planSha256 }, `size-${tag}`, receipts);
    if (generation === 1 && slot === NEIGHBOUR) {
      await send(operator, toolSessionId, 'atcs_point', { check: 'setup', endPoints: target }, `point-step-${tag}`);
      await send(operator, toolSessionId, 'atcs_size_cell', { instance: `${block}/reg0`, toMaster: ({ BUFFD2BWP: 'BUFFD4BWP' } as Record<string, string>)[toMaster]!, planSha256 }, `size-again-${tag}`, receipts);
      await send(operator, toolSessionId, 'atcs_size_cell', { instance: SHARED, toMaster: 'BUFFD4BWP', planSha256 }, `size-shared-${tag}`, receipts);
    }
    if (generation === 1 && slot === COLLIDER) {
      await send(operator, toolSessionId, 'atcs_size_cell', { instance: SHARED, toMaster: 'BUFFD2BWP', planSha256 }, `size-shared-${tag}`, receipts);
    }
    await send(operator, toolSessionId, 'atcs_point', { check: 'setup', endPoints: target }, `point-after-${tag}`);
    await send(operator, toolSessionId, 'atcs_gain', { check: 'setup', topN: 5 }, `gain-${tag}`);
    await send(operator, toolSessionId, 'atcs_dump_cells', { path: path.join(root, 'after.dump') }, `after-${tag}`);
    await send(operator, toolSessionId, 'atcs_export_changes', { limitations: '' }, `export-${tag}`);
    await send(operator, toolSessionId, 'atcs_close', {}, `close-${tag}`);
    await waitUntil(`${slot}'s Operator session is ready`, () => control().executions[operator.effective.recipe!.executionId]?.phase === 'ready', 30_000, 25);
    return { planSha256, receipts };
  };

  let pausedRefusal: string | undefined;
  let survivor: Drive['survivor'];
  const batches: Batch[] = [];
  const planExample = await example(home.variant, 'campaign-plan');
  const requestExample = await example(home.variant, 'worker-request');
  const code = {
    plan: (parked: readonly Slot[]) => workshopCode('plan.py', { __EXAMPLE_JSON__: planExample, __PARKED_JSON__: JSON.stringify(parked) }),
    research: (slot: Slot) => workshopCode('research-worker.py', { __EXAMPLE_JSON__: requestExample, __SLOT__: slot }),
    compose: await workshopCode('compose.py'),
  };

  /** One branch as its child Agents play it: the research author (generation 1 only), then the Operator. */
  const playSlot = async (current: Batch, slot: Slot) => {
    const generation = current.generation;
    if (generation === 1) {
      await answer(await authorOf(slot), JSON.stringify({ schema: WORKSHOP_ENTRY_SCHEMA, entry: await code.research(slot) }));
    }
    if (current.parked.includes(slot)) return;
    let operator = await operatorOf(slot);
    const request = JSON.parse(await readFile(path.join(workspace, `research/requests/worker-request-${slot}.json`), 'utf8'));
    operatorTasks.push({ slot, task: operator.contract.task, request, planSha256: operator.effective.recipe!.inlinePayload!.planSha256 });
    let opened = await interactive(operator, { action: 'open', requestId: `open-${operator.effective.recipe!.executionId}` });
    assert.equal(opened.status, 'opened', `${slot}: ${JSON.stringify(opened).slice(0, 800)}`);
    if (siteFaults && generation === 1 && slot === SURVIVOR) {
      // Attempt 2's w01/w02: the Operator dumps and then asks the Harness to close its session. A
      // member of the Job's process group outlives the close's hangup and TERM, so the close is
      // recorded `process-survived`; the member ends by itself, the Job's end settles the attempt as
      // failed, and the autopilot begins the node again with a fresh Team -- never a person.
      const root = await rootOf(slot);
      await send(operator, opened.session.toolSessionId, 'atcs_dump_cells', { path: path.join(root, 'before.dump') }, `before-survivor-${slot}`);
      const close = await interactive(operator, { action: 'close', requestId: `close-survivor-${slot}`, toolSessionId: opened.session.toolSessionId });
      assert.equal(close.status, 'process-survived', `${slot}'s lingering session outlives the declared close grace: ${JSON.stringify(close)}`);
      const first = operator.effective.recipe!.executionId;
      await waitUntil(`${slot}'s first attempt settles once its lingering process ends`,
        () => control().executions[first]?.phase === 'failed', (SURVIVOR_LINGER_S + 30) * 1000, 100);
      log.push(`operate-worker-${nn(slot)} attempt ${control().executions[first]!.attempt}: close process-survived, then its process group ended; ${control().executions[first]!.result?.kind}`);
      operator = await operatorOf(slot);
      const retryOpen = await interactive(operator, { action: 'open', requestId: `open-${operator.effective.recipe!.executionId}` });
      assert.equal(retryOpen.status, 'opened', `the retry opens once the survivor is gone: ${JSON.stringify(retryOpen)}`);
      survivor = { close, retried: operator.effective.recipe!.executionId, retryOpen };
      opened = retryOpen;
    }
    current.readySessions += 1;
    const played = await expertLoop(slot, operator, opened.session.toolSessionId, generation);
    await answer(operator.delegationId, JSON.stringify({ schema: 'atcs-worker-session/1', planSha256: played.planSha256,
      mutationReceipts: played.receipts, stopReason: 'no-candidate-gains', limitations: ['synthetic Tcl; no commercial qualification'] }));
    current.executions.set(slot, operator.effective.recipe!.executionId);
  };

  /** One generation: the owner's plan, six self-driving branches, the owner's merge, then the owner's decision. */
  const generationOf = async (parked: readonly Slot[]) => {
    await step('plan', await code.plan(parked));
    const generation = run().generation ?? 1;
    const current: Batch = { generation, parked, active: SLOTS.filter((slot) => !parked.includes(slot)), executions: new Map(),
      concurrentOpen: 0, readySessions: 0 };
    batches.push(current);
    await waitUntil('the fork opens', () => run().fork !== undefined, 120_000, 25);
    current.forkOpenedAt = Date.now();
    // The survivor slot's first session in generation 1 keeps a process-group member past the close.
    if (siteFaults && generation === 1) await writeFile(path.join(workspace, 'workspaces', SURVIVOR, 'linger-once'), `${SURVIVOR_LINGER_S}\n`);
    if (pausedRefusal === undefined) {
      // Recovery without a duplicate effect: a person pauses the Campaign while its branches run and
      // continues it; the paused Run admits no new node, and the autopilot carries on after.
      const paused = await human('pause'); assert.equal(paused.kind, 'accepted', paused.reason);
      const blocked = await act('begin', { nodeId: 'compose' });
      assert.equal(blocked.kind, 'refused', 'no node begins while the Campaign is paused');
      pausedRefusal = blocked.reason;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const continued = await human('continue'); assert.equal(continued.kind, 'accepted', continued.reason);
      log.push(`pause/continue while the branches run (begin refused while paused: ${blocked.reason})`);
    }
    const sessionsAtOnce = (async () => {
      // Every active slot's interactive Job launched and none finished: they are open at once.
      await waitUntil('every active session is open', () => records().filter((r) => r.type === 'job' && r.event === 'launched' && r.generation === generation
        && r.licences !== undefined && r.nodeId?.startsWith('operate-worker-')).length >= current.active.length, 240_000, 25).catch(() => undefined);
      const launched = records().filter((r) => r.type === 'job' && r.event === 'launched' && r.generation === generation && r.licences !== undefined && r.nodeId?.startsWith('operate-worker-'));
      const ended = records().filter((r) => r.type === 'job' && r.event !== 'launched' && r.generation === generation && r.nodeId?.startsWith('operate-worker-'));
      current.concurrentOpen = ended.length === 0 ? launched.length : 0;
    })();
    await Promise.all([...SLOTS.map((slot) => playSlot(current, slot)), sessionsAtOnce]);
    log.push(`generation ${generation}: ${current.readySessions} Operator sessions (${current.active.join(', ')}); parked ${parked.join(', ') || 'none'}; open at once ${current.concurrentOpen}`);
    await reach('compose');
    current.joinedAt = Date.now();
    log.push(`generation ${generation}: fork to the owner's merge in ${Math.round((current.joinedAt - current.forkOpenedAt!) / 1000)} s`);
    current.collected = JSON.parse(await readFile(path.join(workspace, 'state/contributions-collected.json'), 'utf8'));
    current.facts = JSON.parse(await readFile(path.join(workspace, 'state/composition-facts.json'), 'utf8'));
    await step('compose', code.compose);
    await reach('decide');
    current.replayRequest = JSON.parse(await readFile(path.join(workspace, 'state/replay-request.json'), 'utf8'));
    await decide();
  };
  for (const parked of PARKED_BY_BATCH.slice(0, generationLimit)) {
    await generationOf(parked);
    if (String(run().status).startsWith('ended-') || run().currentNode === 'wait-for-person') break;
  }
  if (generationLimit > PARKED_BY_BATCH.length) {
    await waitUntil('the third generation reaches the refresh-budget gate\'s honest end', () => run().currentNode === 'wait-for-person'
      && context().available.includes('wait-for-person'), 240_000, 50).catch(() => assert.fail(failure('wait-for-person')));
  }
  return { runId, workspace, owner: actor, ownerAgent: owner, stops: log, batches, pausedRefusal, operatorTasks,
    ...(survivor === undefined ? {} : { survivor }), driveMs: Date.now() - began };
}

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


/** Owner node turns per generation, as the control requests record them. */
function ownerTurnsByGeneration(host: InProcessHost, runId: string, owner: string): Map<number, string[]> {
  const control = host.ctx.hima.ledger.run(runId)!.control!;
  const turns = new Map<number, string[]>();
  for (const request of Object.values(control.requests)) {
    if (request.actor !== owner || request.origin === 'autopilot' || request.origin === 'human') continue;
    if (!['begin', 'work', 'write', 'complete'].includes(request.receipt.action)) continue;
    const execution = control.executions[request.receipt.executionId ?? ''];
    if (execution === undefined) continue;
    turns.set(execution.generation, [...(turns.get(execution.generation) ?? []), `${execution.nodeId}:${request.receipt.action}`]);
  }
  return turns;
}

test('ATCS 0.2.0 dry path: the owner acts at plan, merge and decision only; six self-driving branches, two refreshes, ended by the generation limit, sealed by /hima-test and /hima-release', async (t) => {
  // Owner notice turns: each branch child's native settlement wakes the owner with the replayed notice.
  const home = await prepareHome(t, 8, true);
  const log: string[] = [];
  const started = Date.now();
  const host = await bootInProcess(home.h);
  let ended = false;
  let result: Drive | undefined;
  t.after(async () => { if (!ended && result) await host.ctx.hima.cancelRun(result.runId).catch(() => undefined); await host.dispose().catch(() => undefined); await home.h.dispose(); });
  try { result = await drive(host, home, 2, log, true); }
  finally { if (process.env.HIMA_ATCS_DRY_LOG) await writeFile(process.env.HIMA_ATCS_DRY_LOG, log.join('\n') + '\n'); }
  log.push(`drive ${Math.round(result.driveMs / 1000)} s`);
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
  const [first, second] = result.batches;
  assert.ok(first && second && result.batches.length === 2, `${row}: two worker batches, in generations 1 and 2`);
  assert.deepEqual(result.batches.map(b => b.generation), [1, 2]);

  // 0. The owner acted at its three points and nowhere else; every other node turn was the Harness's.
  const byGeneration = ownerTurnsByGeneration(host, runId, result.owner);
  for (const [generation, turns] of byGeneration) {
    assert.deepEqual([...new Set(turns.map((turn) => turn.split(':')[0]))].sort(), [...OWNER_NODES].sort(),
      `${row}: generation ${generation}'s owner turns are at plan, compose and decide only: ${turns.join(', ')}`);
  }
  log.push(`owner node turns per generation: ${[...byGeneration].map(([g, turns]) => `g${g} ${turns.length} (${turns.join(' ')})`).join('; ')}`);
  const autopilotTurns = Object.values(run.control!.requests).filter((request) => request.origin === 'autopilot').length;
  log.push(`autopilot requests: ${autopilotTurns}`);
  assert.ok(autopilotTurns > 100, `${row}: the Harness took the node turns between the owner's points`);
  const notices = host.ctx.hima.autopilotNotices(runId);
  log.push(`owner notices: ${notices.length}`);
  assert.ok(notices.length >= 4 && notices.length <= 7, `${row}: the owner is told once per region it gets back: ${notices.length}`);
  assert.ok(notices.some((notice) => /Fork branches this generation: research-worker-01: read-worker-result-01 done; adopted Team result/.test(notice)),
    `${row}: the join summary carries each branch's adopted result and final reading: ${notices.join(' // ')}`);

  // 1. Plans: both generations' six-slot campaign plans are admitted; generation 2's parks w05 and w06.
  assert.deepEqual(observed('atcs-campaign-plan', 'tc_request_invalid_count'), [0, 0], `${row}: both campaign plans are admitted`);
  for (const slot of SLOTS) {
    assert.deepEqual(observed(`atcs-worker-request-${nn(slot)}`, 'tc_request_invalid_count'), [0, 0], `${row}: ${slot}'s requests are admitted`);
  }
  // Generation 1's research entries were each branch child's; generation 2 ran the retained code.
  const authors = runDelegations((host.ctx.hima as any).deps(), runId).filter((item) => item.delegationId.startsWith('autopilot-author-'));
  assert.equal(authors.length, 6, `${row}: one research author per branch, in generation 1 only`);
  for (const slot of SLOTS) {
    const code = records.filter((r) => r.type === 'code' && r.nodeId === `research-worker-${nn(slot)}`) as any[];
    assert.equal(code.length, 2, `${row}: ${slot}'s research entry ran in both generations`);
    assert.equal(code[0].sha256, code[1].sha256, `${row}: generation 2 ran ${slot}'s retained code`);
  }

  // 2. Six branches at once, and each Operator's task is its request (#64 M-T03-1).
  assert.equal(first.concurrentOpen, 6, `${row}: six interactive stand-in sessions open at once`);
  const operateJobs = records.filter(r => r.type === 'job' && (r as any).event === 'launched' && (r as any).nodeId?.startsWith('operate-worker-'));
  const firstJobs = operateJobs.filter(r => r.generation === 1) as any[];
  assert.deepEqual(firstJobs.map(r => [r.nodeId, r.branchId, r.licences ?? null]).sort(),
    [...SLOTS, SURVIVOR].sort().map(slot => [`operate-worker-${nn(slot)}`, `research-worker-${nn(slot)}`, { xtop: 1 }]),
    `${row}: each branch's session holds one xtop seat, and the survivor slot's retry holds its own`);
  for (const { slot, task, request, planSha256 } of result.operatorTasks) {
    const at = task.indexOf(`Exact input workerRequest${nn(slot)} `);
    assert.ok(at >= 0, `${row}: ${slot}'s Operator task embeds its request`);
    const embedded = JSON.parse(task.slice(task.indexOf('\n', at) + 1).split('\n')[0]!);
    assert.deepEqual(embedded.operatorBrief, request.operatorBrief, `${row}: ${slot}'s task carries the request's bounded brief, not its whole candidate`);
    assert.deepEqual(embedded.sessionPlan, request.sessionPlan, `${row}: ${slot}'s task carries the session plan`);
    for (const word of [...request.candidate.targetPins, ...request.candidate.editDomain.instances, 'before.dump', 'after.dump', planSha256,
      'atcs_size_cell', 'atcs_undo', 'atcs_dump_cells', 'atcs_close']) {
      assert.ok(task.includes(word), `${row}: ${slot}'s Operator task names ${word}`);
    }
  }

  // 2b. Site faults of attempt 2: the survivor slot's close was recorded process-survived with one
  //     blocker naming its group, the group ended by itself, and the autopilot retried the node in a
  //     fresh session through the retry guard, with the Site's run-shell answering nothing.
  const survivor = result.survivor;
  assert.ok(survivor, `${row}: the survivor slot ran`);
  const survived = records.filter(r => r.type === 'interactive' && r.event === 'process-survived') as any[];
  assert.equal(survived.length, 1, `${row}: exactly one close was process-survived`);
  assert.equal(survived[0].payload.pid, survivor.close.pid);
  assert.equal(survivor.retryOpen.status, 'opened');
  assert.equal(Object.values(run.control!.requests).filter((request) => request.origin === 'human'
    && request.receipt.action === 'continue' && (request.receipt.data as any)?.scope !== '*').length, 0,
    `${row}: no person cleared anything inside the branches`);
  const { remoteCommands } = await import('@hima/harness');
  assert.deepEqual(remoteCommands().filter(command => /run-shell/.test(command.wire)), [], `${row}: no Site question went through tmux run-shell`);

  // 3. Parked slots: generation 2's w05/w06 created no Team member, no interactive session and no licence claim.
  const delegationRows = runDelegations((host.ctx.hima as any).deps(), runId);
  for (const slot of ['w05', 'w06'] as const) {
    const branchJobs = operateJobs.filter(r => r.generation === 2 && (r as any).branchId === `research-worker-${nn(slot)}`) as any[];
    assert.deepEqual(branchJobs.map(r => r.licences ?? null), [null], `${row}: parked ${slot}'s operate node is one batch no-op with no licence`);
    const executions = Object.values(run.control!.executions).filter((execution) => execution.generation === 2 && execution.nodeId === `operate-worker-${nn(slot)}`);
    assert.equal(delegationRows.filter(r => executions.some((execution) => r.effective.recipe?.executionId === execution.id)).length, 0,
      `${row}: parked ${slot} has no Team member`);
    const workers = JSON.parse(await readFile(path.join(workspace, 'state/workers.json'), 'utf8'));
    assert.equal(workers.workers[slot].parked, true);
  }
  const operators = delegationRows.filter((item) => item.effective.recipe?.memberId === 'operator');
  assert.equal(operators.length, 11, `${row}: one Operator for each of eleven active slot executions (the survivor's retry included)`);
  assert.equal(operators.filter((item) => item.adoptedRecordId !== undefined).length, 10,
    `${row}: every Operator result was adopted as it arrived, all but the survivor's lost first attempt`);
  assert.equal(delegationRows.filter((item) => item.effective.recipe?.memberId === 'reviewer').length, 0, `${row}: the advisory Reviewer is never waited for`);

  // 4. Refreshes: two implement/extract/sta chains, two ledger entries, the gate read 0 then 1 before them.
  for (const nodeId of ['implement', 'extract', 'sta']) assert.equal(jobsOf(nodeId).length, 2, `${row}: ${nodeId} ran twice`);
  const refreshLedger = JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8'));
  assert.equal(refreshLedger.entries.length, 2, `${row}: the refresh ledger holds two refreshes`);
  assert.deepEqual(observed('atcs-refresh-budget', 'tc_refreshes_completed'), [0, 1], `${row}: the gate read 0 and then 1 completed refreshes`);
  assert.deepEqual(observed('atcs-acceptance-record', 'tc_refresh_count'), [1, 2], `${row}: the acceptance records count one and then two refreshes`);
  assert.equal(run.goal?.max_physical_refreshes, REFRESH_CAP, 'the refresh cap is the Goal value the Run was created with');
  // The working state was observed again after each refresh, inside the refresh chain.
  assert.equal(jobsOf('observe-working').length, 2, `${row}: the working state is re-observed after each refresh`);

  // 5a. #66 T4, batch Contributions over derived domains. Each of generation 1's six sessions derived
  //     its local topology in session (domain.json: its block's two cells and the boundary buffers
  //     one hop out) and logged its point reads (reads.jsonl), and each sealed batch carries that
  //     record as its effectiveDomain, with its target read. NEIGHBOUR and COLLIDER both sized SHARED,
  //     inside both derived domains: the planted overlap. Composition ranks NEIGHBOUR's two-step batch
  //     above COLLIDER's by aggregate gain and, replay being an aggregator, excludes neither: every
  //     batch enters the recipe, and only COLLIDER's later sizing of SHARED is marked skipped
  //     (`shared-instance`, naming NEIGHBOUR); the replay enters each batch's sealed effective domain.
  const sealedFirst = (first.collected.contributions as any[]).filter((item) => item.kind === 'xtop-session');
  assert.deepEqual(sealedFirst.map((item) => item.taskId).sort(), [...SLOTS], `${row}: generation 1 sealed six batches`);
  const sealedOf = (slot: Slot) => sealedFirst.find((item) => item.taskId === slot);
  for (const slot of SLOTS) {
    const sealed = sealedOf(slot); const target = `func_ssg_rcworst|setup|${blockOf(slot)}/reg0/I`;
    assert.equal(sealed.admissible, true, `${row}: ${slot}'s batch is admissible: ${JSON.stringify(sealed.refusals)}`);
    assert.equal(sealed.session.domainSource, 'domain.json', `${row}: ${slot}'s seal checked its session's domain.json`);
    assert.equal(sealed.effectiveDomain?.schema, 'atcs-local-domain/1', `${row}: ${slot}'s batch carries its effectiveDomain`);
    assert.deepEqual(sealed.effectiveDomain.planInstances, [`${blockOf(slot)}/reg0`, `${blockOf(slot)}/reg1`]);
    assert.deepEqual(sealed.effectiveDomain.instances, derivedDomain(slot), `${row}: ${slot}'s domain is derived one hop out`);
    assert.deepEqual([sealed.effectiveDomain.globalNets, sealed.effectiveDomain.unresolved, sealed.effectiveDomain.error], [[], [], undefined]);
    assert.equal(sealed.reads?.present, true, `${row}: ${slot}'s session logged its reads`);
    assert.ok(sealed.reads.byProc.atcs_point >= 2, `${row}: ${slot} read its target point to point before and after: ${JSON.stringify(sealed.reads.byProc)}`);
    assert.deepEqual(sealed.attempted, [target], `${row}: ${slot}'s target was read`);
    assert.deepEqual(sealed.limitations.filter((item: string) => item.startsWith('seal:')), [], `${row}: ${slot}'s seal records no gap`);
  }
  for (const slot of [NEIGHBOUR, COLLIDER]) {
    assert.ok(sealedOf(slot).commands.some((command: any) => command.args.instance === SHARED),
      `${row}: ${slot} kept a sizing of ${SHARED}, inside its derived domain`);
  }
  const recipeFirst = first.facts.recipe;
  assert.deepEqual(recipeFirst.excluded, [], `${row}: replay is an aggregator: no batch is excluded`);
  assert.deepEqual(recipeFirst.sessions.map((item: any) => item.taskId).sort(), [...SLOTS],
    `${row}: every batch, both overlapping ones included, is ranked for replay`);
  assert.ok(first.facts.considered.includes(sealedOf(COLLIDER).id), `${row}: the overlapping batch stays considered`);
  const neighbourRank = recipeFirst.sessions.find((item: any) => item.taskId === NEIGHBOUR);
  const colliderRank = recipeFirst.sessions.find((item: any) => item.taskId === COLLIDER);
  assert.ok(neighbourRank.rank < colliderRank.rank && neighbourRank.aggregateRankGain > colliderRank.aggregateRankGain,
    `${row}: ${NEIGHBOUR}'s two-step batch outranks ${COLLIDER}'s by aggregate gain: ${JSON.stringify([neighbourRank, colliderRank])}`);
  assert.deepEqual(colliderRank.commands.map((command: any) => [command.args.instance, command.skip,
    command.sharedWith?.map((other: any) => [other.instance, other.contribution])]),
  [[`${blockOf(COLLIDER)}/reg0`, null, undefined], [SHARED, 'shared-instance', [[SHARED, neighbourRank.contribution]]]],
  `${row}: only ${COLLIDER}'s later sizing of ${SHARED} is skipped, naming ${NEIGHBOUR}`);
  assert.equal(recipeFirst.skipCount, 1, `${row}: the planted overlap skips one command, never a batch`);

  // 5. The replay: every generation's recipe replays every kept command of every batch -- w01's undone
  //    trial is not in it, and COLLIDER's later sizing of SHARED is recorded skipped with its reason --
  //    inside each batch's sealed effective domain, protects what it applied, and then runs the
  //    attempt-4 auto-finish in both arms.
  const batchDirs = (await readdir(path.join(workspace, 'integrations'))).sort();
  assert.equal(batchDirs.length, 2, `${row}: one replay batch per generation`);
  for (const [index, batchId] of batchDirs.entries()) {
    const batch: Batch = result.batches[index]!;
    const kept: readonly Slot[] = batch.active;
    const expected: string[] = [...kept.flatMap((slot: Slot) => Array(batch.generation === 1 && slot === NEIGHBOUR ? 2 : 1).fill(`${blockOf(slot)}/reg0`)),
      ...(batch.generation === 1 ? [SHARED] : [])].sort();
    const merged = path.join(workspace, 'integrations', batchId, 'merged');
    const recipe = await readFile(path.join(merged, 'recipe.tcl'), 'utf8');
    const replayed = [...recipe.matchAll(/atcs_replay_step \{[^}]+\} 0 \{atcs_size_cell \{(\S+)\} \{(\S+)\}/g)].map(m => m[1]!);
    assert.deepEqual(replayed.sort(), expected, `${row}: ${batchId} replays each kept batch's kept sizings, and no undone trial`);
    const receipts = await jsonLines(path.join(merged, 'receipts.jsonl'));
    const skippedSteps = batch.replayRequest.steps.filter((step: any) => step.skip !== null);
    assert.deepEqual(skippedSteps.map((step: any) => [step.slot, step.args.instance, step.skip]),
      batch.generation === 1 ? [[COLLIDER, SHARED, 'shared-instance']] : [], `${row}: ${batchId}'s request skips only the overlapping command`);
    assert.deepEqual(receipts.filter(r => r.status === 'applied').length, expected.length, `${row}: ${batchId}: every other kept command applied`);
    assert.deepEqual(receipts.filter(r => r.status !== 'applied').map(r => [r.stepId, r.slot, r.status, r.attempted, r.reason]),
      skippedSteps.map((step: any) => [step.stepId, step.slot, 'skipped', false, 'recipe']),
      `${row}: ${batchId}: the overlapping command is recorded skipped with its reason and the replay continued`);
    // replay-prepare entered each kept batch's sealed effective domain, never the plan's package.
    assert.deepEqual(batch.replayRequest.sessions.map((item: any) => [item.slot, item.domainSource, item.domain.instances])
      .sort((a: any, b: any) => a[0].localeCompare(b[0])), kept.map((slot) => [slot, 'effectiveDomain', derivedDomain(slot)]),
    `${row}: ${batchId}'s replay request takes every session's domain from its sealed effectiveDomain`);
    const transcript = await readFile(path.join(merged, 'xtop_log_1.txt'), 'utf8');
    for (const slot of kept) {
      assert.ok(recipe.includes(`atcs_replay_session {${slot}} `) && recipe.includes(`{${derivedDomain(slot).join(' ')}}`),
        `${row}: ${batchId}'s recipe enters ${slot}'s derived domain`);
      assert.ok(transcript.includes(`ATCS:replay-domain:${slot}:${derivedDomain(slot).length} instances`), `${row}: ${batchId}'s replay entered ${slot}'s domain`);
    }
    const armResult = JSON.parse(await readFile(path.join(merged, 'arm-result.json'), 'utf8'));
    const control = JSON.parse(await readFile(path.join(workspace, 'integrations', batchId, 'control', 'arm-result.json'), 'utf8'));
    const autoFix = await readFile(path.join(merged, 'auto-fix.tcl'), 'utf8');
    assert.deepEqual(autoFix.trim().split('\n'), ATTEMPT4_AUTO_FINISH, `${row}: ${batchId}'s auto-finish is attempt 4's four commands, byte for byte`);
    for (const arm of [armResult, control]) {
      assert.deepEqual(arm.autoFix.map((entry: any) => [entry.command, entry.code]), ATTEMPT4_AUTO_FINISH.map(line => [line, 0]),
        `${row}: ${batchId}: each arm ran attempt 4's four auto-finish commands`);
      assert.equal(arm.complete, true);
    }
    assert.equal(armResult.appliedCommands, expected.length, `${row}: ${batchId}'s merged arm counts its applied commands`);
    assert.equal(armResult.skippedCommands, skippedSteps.length, `${row}: ${batchId}'s merged arm counts its skipped commands`);
    assert.ok(armResult.protectedCount >= 1, `${row}: ${batchId}'s merged arm protected the manual batch before auto-finish: ${armResult.protectedCount}`);
    assert.deepEqual([control.appliedCommands, control.protectedCount], [0, 0], `${row}: ${batchId}'s control arm ran auto-finish alone`);
  }
  const lastState = JSON.parse(await readFile(path.join(workspace, 'state/integration-state.json'), 'utf8'));
  assert.deepEqual(Object.keys(lastState.autoDelta?.mastersChanged ?? {}).sort(),
    ['u_e/reg0', 'u_f/reg0'], `${row}: generation 2's auto-finish sized the two parked slots' blocks`);
  const kept = await jsonLines(path.join(workspace, 'workspaces/w01', (await readdir(path.join(workspace, 'workspaces/w01'))).sort()[0]!, 'ops.jsonl'));
  assert.deepEqual(kept.map(line => [line.cmd, line.status]), [['size_cell', 'kept'], ['undo', 'kept'], ['size_cell', 'kept']],
    `${row}: w01's session log holds the trial, its undo and the kept sizing`);

  // 6. Budget: generation limit 2, refresh cap 2; the continue at the end of generation 2 is refused by the limit.
  assert.equal(run.budget?.generationLimit, 2);
  assert.equal(run.generation, 2);
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
  // Zero model: the owner conversation made no tool call of a model's, and every turn it had is the
  // replayed notice acknowledgement of a branch child's native settlement.
  const noticeText = 'I acknowledge the retained facts. I will not start another task.';
  assert.deepEqual(toolCalls(result.ownerAgent), [], 'the owner never produced a model tool call');
  let heard = -1;
  await waitUntil('the owner is quiet', () => { const now = saidByModel(result!.ownerAgent).length; const quiet = now === heard; heard = now; return quiet; }, 60_000, 2000);
  const turns = saidByModel(result.ownerAgent);
  log.push(`owner notice turns: ${turns.length} for ${delegationRows.length} branch children`);
  assert.ok(turns.length <= delegationRows.length, `owner turns: ${turns.length}`);
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
    `Goal: target_setup_wns_ns = 0, target_hold_wns_ns = 0. Generation limit 2; refresh cap ${REFRESH_CAP}.`, '',
    '## Ending', '',
    `status: ${run.status}`, '',
    'Ended by the generation limit when the owner chose to continue at the end of generation 2.', '',
    '## Generations', '',
    ...generations.map(g => `- Generation ${String(g)}: ${records.filter(r => r.type === 'node' && r.generation === g && (r as any).state === 'done').length} nodes completed.`), '',
    '## Code', '',
    ...(owned.length ? owned.map(r => `- ${r.path} sha256 ${r.sha256} (${r.id})`) : ['none']), '',
    '## Refusals', '',
    ...(refusals.length ? refusals.map(r => `- ${r.id}: ${(r as any).reason ?? ''}`) : ['none']), '',
    '## Disagreements', '',
    'none. The survivor slot\'s first attempt failed by its lingering process group and was retried by the autopilot.', '',
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

test('ATCS 0.2.0 dry path: with generation limit 3 the third generation is refused at its refresh-budget gate, the honest end a person clears', async (t) => {
  const home = await prepareHome(t, 8);
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
  assert.deepEqual(gate.map(r => [r.generation, r.outcome]), [[1, 'PASS'], [2, 'PASS'], [3, 'FAIL']],
    `${row}: the gate passed two refreshes and refused the third`);
  const verdict = records().findLast(r => r.type === 'verdict' && (r as any).ruleId === 'refresh-budget') as any;
  assert.equal(verdict.outcome, 'FAIL');
  assert.deepEqual(verdict.valuesAsRead.map((v: any) => [v.type, v.value]), [['tc_refreshes_completed', 2]]);
  assert.equal(records().filter((r) => r.type === 'node' && r.generation === 3 && r.nodeId === 'plan').length, 0, `${row}: the refused generation never plans`);
  const refreshLedger = JSON.parse(await readFile(path.join(workspace, 'state/refresh-ledger.json'), 'utf8'));
  assert.equal(refreshLedger.entries.length, 2, `${row}: no third refresh ran`);

  // The honest end: a person clears the wait, which has no outgoing edge.
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
  assert.match(String(ended.status), /^ended-(budget-exhausted|goal-not-met)$/, `${row}: clearing the wait ended the Run: ${String(ended.status)}`);
});

test('ATCS 0.2.0 timing-only contract: an analysisContract override is the Run\'s recorded binding, reaches observe-baseline\'s and policy\'s command lines, and stamps the relaxed physical terms', async (t) => {
  // #64 treatment attempt 3 (user decision 2026-09-29): the comparison is timing only, so the Campaign binds a
  // Site variant of the analysis contract whose policy.json tolerates new DRC/connectivity identities
  // (allowDegradedWorking true, maxNewConstraintFailures 1000000) and keeps degradeLimitNs 0. The Campaign file's
  // `inputs.analysisContract` reaches startRun as `inputs`; every Job must take it (D-C01-1), never the Site file's own.
  // Reshaped (ADR-0016): the baseline chain drives itself, so the Run is started and its own Jobs read.
  const home = await prepareHome(t, 0);
  const variantDir = path.join(home.site, 'analysis-timing-only');
  await cp(path.join(home.site, 'analysis'), variantDir, { recursive: true });
  const sitePolicy = JSON.parse(await readFile(path.join(home.site, 'analysis/policy.json'), 'utf8'));
  assert.deepEqual(sitePolicy, { allowDegradedWorking: false, degradeLimitNs: 0, maxNewConstraintFailures: 0 }, 'the Site contract gates on physical deltas');
  await writeFile(path.join(variantDir, 'policy.json'), JSON.stringify({ ...sitePolicy, allowDegradedWorking: true, maxNewConstraintFailures: 1000000 }));
  const host = await bootInProcess(home.h);
  let runId: string | undefined;
  t.after(async () => { if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined); await host.dispose().catch(() => undefined); await home.h.dispose(); });
  const owner = await createRootAgent(host.ctx, home.h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', test: true, goal: GOAL,
    strategy: { maxPaths: MAX_PATHS }, generationLimit: 3, retryAllowance: 1, ownerSessionId: actor, timeBoxMs: 3_600_000,
    inputs: { analysisContract: variantDir } });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') throw new Error('unreachable');
  runId = started.run.id; const workspace = started.workspace;
  const ledger = host.ctx.hima.ledger;
  const recorded = ledger.records({ runId, type: 'workspace' }).findLast(record => record.type === 'workspace') as any;
  assert.equal(recorded?.bindings?.analysisContract, variantDir, 'preparation recorded the override');
  await waitUntil('the self-driving baseline chain passes policy', () => ledger.records({ runId: runId! })
    .some((record) => record.type === 'node' && record.nodeId === 'policy' && record.state === 'done'), 240_000, 50);
  const records = ledger.records({ runId });
  const wireOf = (nodeId: string) => {
    const sessions = new Set(records.filter(r => r.type === 'node' && r.nodeId === nodeId).map(r => (r as any).jobSession).filter(Boolean));
    const launched = records.filter(r => r.type === 'job' && (r as any).event === 'launched' && sessions.has((r as any).job.session));
    assert.equal(launched.length, 1, `${nodeId} launched one Job`);
    return String((launched[0] as any).job.wire);
  };
  const siteContract = path.join(home.site, 'analysis');
  for (const nodeId of ['observe-baseline', 'policy']) {
    const wire = wireOf(nodeId);
    assert.ok(wire.includes(variantDir), `${nodeId}'s command line carries the timing-only contract: ${wire}`);
    assert.ok(!wire.includes(`${siteContract}/`) && !wire.includes(`${siteContract}'`) && !wire.includes(`${siteContract} `),
      `${nodeId}'s command line never names the Site file's own contract: ${wire}`);
  }
  const stamped = JSON.parse(await readFile(path.join(workspace, 'state/policy.json'), 'utf8'));
  assert.equal(stamped.allowDegradedWorking, true);
  assert.equal(stamped.maxNewConstraintFailures, 1000000);
  assert.equal(stamped.degradeLimitNs, 0);
  assert.deepEqual(stamped.goal, { setup: 0, hold: 0 }, 'the timing Goal is the Run\'s, unchanged');
});

test('ATCS 0.3 public Host delivers one production-adapter engineering result and ends honestly with Goal false', async (t) => {
  const local = await localHome(t, { sleepSeconds: 0, parallelJobs: 2 }); assert.ok(local);
  const h = { ...local.h, workspace: await realpath(local.h.workspace) };
  const packsDir = path.join(h.home, 'hima/packs');
  const variant = path.join(packsDir, packId);
  await cp(path.join(repoRoot, 'packs', packId), variant, { recursive: true,
    filter: (src) => !src.includes('__pycache__') });
  const graph = parse(await readFile(path.join(variant, 'graph.yml'), 'utf8')) as any;
  graph.entry = 'fix-timing';
  graph.autopilot = [{ from: ['read-engineering-result'], until: ['check-engineering-goal', 'wait-for-person'] }];
  await writeFile(path.join(variant, 'graph.yml'), stringify(graph));
  const contract = parse(await readFile(path.join(variant, 'contract.yml'), 'utf8')) as any;
  contract.budget.closingReserveMs = 1000;
  await writeFile(path.join(variant, 'contract.yml'), stringify(contract));

  const wrapper = path.join(repoRoot, 'sites/linglong-atcs28/templates/resident-engineering-wrapper.py');
  const native = path.join(repoRoot, 'sites/linglong-atcs28/tests/fixtures/acp-standin.py');
  const admin = path.join(h.workspace, 'resident-admin');
  await mkdir(admin, { recursive: true });
  const resultSource = path.join(admin, 'atcs-engineering-result.json');
  const capability = path.join(admin, 'engineering-capabilities-v1.json');
  await writeFile(capability, JSON.stringify({
    schema: 'hima-resident-engineering-capability/1', protocol: 'hima-resident-engineering/1',
    wrapper: { argv: [wrapper, '--capability', capability] },
    native: { executable: native, version: '1.18.34', argv: [], model: 'deepseek/deepseek-flash', protocolVersion: 1 },
    sandbox: { kind: 'none', testOnly: true, privateWorkspace: 'workspace', privateHome: 'home' },
    environment: { inherit: [], set: { STANDIN_RESULT_SOURCE: resultSource }, toolPaths: [], credentialReadPaths: [] },
    permissions: { autoApprove: ['read', 'edit', 'write', 'bash'], denyUnknown: true },
    delivery: { candidate: 'resident-delivery.json' }, stopGraceSeconds: 1,
  }));
  const dummy = path.join(h.workspace, 'declared-input.json');
  await writeFile(dummy, '{}\n');
  await writeLocalSite(h, {
    allowedReadRoots: [h.workspace, path.dirname(wrapper), path.dirname(native)],
    allowedWriteRoots: [h.workspace], allowedWrappers: ['python3', '/usr/bin/python3', wrapper],
    bindings: { designStateManifest: dummy, nativeTimingContext: dummy, siteCapabilities: dummy,
      workspaceRoot: h.workspace, engineeringCapabilities: capability },
    licences: { xtop: 1 }, parallelJobs: 2,
  });

  const host = await bootInProcess(h);
  let runId: string | undefined;
  t.after(async () => {
    if (runId) await host.ctx.hima.cancelRun(runId).catch(() => undefined);
    await host.dispose().catch(() => undefined); await h.dispose();
  });
  const owner = await createRootAgent(host.ctx, h.workspace); const actor = String(owner.id);
  const started = await host.ctx.hima.startRun({ pack: packId, site: 'local', test: true,
    goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0 },
    strategy: { nativeReportPaths: 10000 }, ownerSessionId: actor, timeBoxMs: 60_000 });
  assert.equal(started.kind, 'ran', JSON.stringify(started)); if (started.kind !== 'ran') return;
  runId = started.run.id; const workspace = started.workspace;

  const fileRef = async (rel: string, text: string) => {
    const bytes = Buffer.from(text);
    const full = path.join(workspace, rel); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, bytes);
    return { path: rel, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const metric = async (prefix: string, setupWns: number, setupTns: number, setupCount: number) => ({
    setup: { wnsNs: setupWns, tnsNs: setupTns, violations: setupCount,
      report: await fileRef(`engineering-fixture/${prefix}-setup.rpt`,
        `### setup summary ###\nScenario Count Worst TNS\n----------------\ntotal ${setupCount} ${setupWns} ${setupTns}\n`) },
    hold: { wnsNs: 0, tnsNs: 0, violations: 0,
      report: await fileRef(`engineering-fixture/${prefix}-hold.rpt`,
        '### hold summary ###\nScenario Count Worst TNS\n----------------\ntotal 0 0 0\n') },
  });
  const before = await metric('common', -0.10, -0.20, 1);
  const referenceAfter = await metric('autofix', -0.02, -0.02, 1);
  const residentAfter = await metric('resident', -0.05, -0.08, 1);
  const baseline = stampAtcs('design-state', { top: 'fixture' });
  const nativeContext = stampAtcs('xtop-context', { requiredScenarios: ['fixture'] });
  const readiness = stampAtcs('input-readiness', {
    missing: [], missingCount: { value: 0 }, scope: 'post-route-only',
    lifecycleAvailable: { value: 0 }, lifecycleMissing: ['init', 'place', 'cts', 'route', 'postroute'],
  });
  const common = stampAtcs('common-stage', {
    stateId: 'common-r1-state', worklistId: 'common-r1-worklist',
    measurements: { before, after: before },
  });
  const inputIdentity = {
    baselineStateId: baseline.id, nativeContextId: nativeContext.id,
    commonStateId: 'common-r1-state', worklistId: 'common-r1-worklist',
  };
  const reference = stampAtcs('autofix-reference', {
    inputIdentity, measurements: { before, after: referenceAfter },
  });
  await mkdir(path.join(workspace, 'state'), { recursive: true });
  await Promise.all([
    writeFile(path.join(workspace, 'state/readiness.json'), JSON.stringify(readiness)),
    writeFile(path.join(workspace, 'state/baseline.json'), JSON.stringify(baseline)),
    writeFile(path.join(workspace, 'state/xtop-context.json'), JSON.stringify(nativeContext)),
    writeFile(path.join(workspace, 'state/common-stage.json'), JSON.stringify(common)),
    writeFile(path.join(workspace, 'state/autofix-reference.json'), JSON.stringify(reference)),
  ]);
  const checkpointBytes = Buffer.from('selected native checkpoint\n');
  await mkdir(path.join(workspace, 'engineering-fixture/best-workspace'), { recursive: true });
  await writeFile(path.join(workspace, 'engineering-fixture/best-workspace/state'), checkpointBytes);
  const collateral = Object.fromEntries(await Promise.all(['transition', 'capacitance', 'fanout', 'legality'].map(async check =>
    [check, { violations: 0, report: await fileRef(`engineering-fixture/${check}.rpt`, `${check}: 0 violations\n`) }])));
  const resultBody = {
    kind: 'result',
    inputIdentity,
    selected: { stateId: 'resident-selected-state', checkpoint: {
      path: 'engineering-fixture/best-workspace', digest: treeDigestForSingleFile('state', checkpointBytes),
    } },
    measurements: { before, after: residentAfter }, collateral,
    artifacts: {
      scripts: [await fileRef('engineering-fixture/fix.tcl', '# native fixture repair script\n')],
      logicalEco: await fileRef('engineering-fixture/final_netlist_eco.txt', 'fixture logical ECO\n'),
      physicalEco: await fileRef('engineering-fixture/final_physical_eco.txt', 'fixture physical ECO\n'),
      reproduction: await fileRef('engineering-fixture/REPRODUCE.md', 'source fix.tcl\n'),
      nativeTrace: [await fileRef('engineering-fixture/native.log', 'native XTop fixture trace\n')],
    },
    remaining: [{ mode: 'setup', endpoint: 'fixture/U1/D', slackNs: -0.05 }],
    regressed: [], blocked: [], unknown: [],
    stopReason: 'residual remains after best measured state', bestEffort: true, noOp: false,
  };

  let serial = 0;
  const controlled = () => host.ctx.hima.ledger.run(runId!)!.control!;
  const call = async (args: Record<string, unknown>) => {
    const answer = await host.ctx.tools.execute({ callId: `atcs-resident-${++serial}` as never,
      name: 'hima_execute', arguments: args, agent: owner, signal: AbortSignal.timeout(30_000) });
    assert.equal(answer.isError, false, JSON.stringify(answer));
    return JSON.parse(answer.content.filter(item => item.type === 'text').map(item => item.text).join(''));
  };
  const execute = (requestId: string, action: string, extra: Record<string, unknown>) => call({
    run: runId, action, requestId, expectedEpoch: controlled().epoch, expectedRevision: controlled().revision, ...extra,
  });
  const begun = await execute('atcs-begin', 'begin', { nodeId: 'fix-timing' });
  const executionId = begun.receipt.executionId as string;
  const taskId = `resident-${createHash('sha256').update(JSON.stringify(canonicalObject({
    runId, executionId,
  }))).digest('hex').slice(0, 24)}`;
  const result = stampAtcs('engineering-result', {
    ...resultBody, task: { taskId, runId, executionId, nodeId: 'fix-timing' },
  });
  await writeFile(resultSource, JSON.stringify(result) + '\n');
  const engineering = await execute('atcs-start', 'engineering', {
    executionId, engineering: { operation: 'start', goal: 'DELIVER_BEST_EFFORT', context: 'Use the full ATCS resident playbook.' },
  });
  assert.equal(engineering.kind, 'accepted', JSON.stringify(engineering));
  assert.equal(engineering.data?.status, 'started', JSON.stringify(engineering));
  assert.equal(engineering.data.taskId, taskId);
  const taskDir = path.join(workspace, '.hima-engineering', taskId);
  await waitUntil('ATCS resident native candidate', async () => {
    try { return (await readFile(path.join(taskDir, 'workspace/resident-delivery.json'))).byteLength > 0; } catch { return false; }
  }, 10_000, 20);
  const delivered = await execute('atcs-delivery', 'engineering', { executionId, engineering: { operation: 'delivery' } });
  assert.equal(delivered.data.status, 'verified', JSON.stringify(delivered));
  assert.equal(delivered.data.outcome, 'best-effort');
  const released = await execute('atcs-release', 'engineering', { executionId, engineering: { operation: 'release' } });
  assert.equal(released.data.status, 'released');
  const completed = await execute('atcs-complete', 'complete', { executionId });
  assert.equal(completed.kind, 'accepted', JSON.stringify(completed));
  await waitUntil('ATCS route reaches the terminal Goal judge',
    () => host.ctx.hima.ledger.run(runId!)?.currentNode === 'check-engineering-goal', 30_000, 20);
  const goalBegin = await execute('atcs-goal-begin', 'begin', { nodeId: 'check-engineering-goal' });
  assert.equal(goalBegin.kind, 'accepted', JSON.stringify(goalBegin));
  const goalExecutionId = goalBegin.receipt.executionId as string;
  const goalWork = await execute('atcs-goal-work', 'work', { executionId: goalExecutionId });
  assert.notEqual(goalWork.kind, 'refused', JSON.stringify(goalWork));
  await waitUntil('ATCS terminal Goal judge is ready',
    () => controlled().executions[goalExecutionId]?.phase === 'ready', 10_000, 20);
  const goalComplete = await execute('atcs-goal-complete', 'complete', { executionId: goalExecutionId });
  assert.equal(goalComplete.kind, 'accepted', JSON.stringify(goalComplete));
  try {
    await waitUntil('ATCS best-effort route ends', () => String(host.ctx.hima.ledger.run(runId!)?.status).startsWith('ended-'), 30_000, 20);
  } catch (error) {
    throw new Error(`${(error as Error).message}: ${JSON.stringify({
      run: host.ctx.hima.ledger.run(runId!), records: host.ctx.hima.ledger.records({ runId }).slice(-20),
    })}`);
  }

  const records = host.ctx.hima.ledger.records({ runId });
  assert.ok(records.some(record => record.type === 'observation' && record.reader.id === 'atcs-engineering-result'));
  assert.ok(records.some(record => record.type === 'node' && record.nodeId === 'check-engineering-delivery'
    && record.state === 'done' && (record as any).outcome === 'PASS'));
  assert.ok(records.some(record => record.type === 'node' && record.nodeId === 'check-engineering-goal'
    && record.state === 'done' && (record as any).outcome === 'FAIL'));
  const jobs = records.filter(record => record.type === 'job' && record.event === 'launched') as any[];
  assert.equal(jobs.filter(record => record.job.name === 'engineering-fix-timing').length, 1,
    'the dry route launched one resident production adapter Job');
  assert.equal(jobs.filter(record => record.job.name === 'reader-atcs-engineering-result').length, 2,
    'delivery and graph consumption each used the real Pack Reader');
  for (const job of jobs) assert.doesNotMatch(String(job.job.wire), /pt_shell|innovus|StarXtract|starrc/i);
});
