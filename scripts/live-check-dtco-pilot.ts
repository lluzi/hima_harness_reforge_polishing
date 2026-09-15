// @hima-seam agent wrapped
// @hima-seam tools direct
// PLS-35: one native conversational owner performs the held-out L5 Campaign; this file audits facts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Agent } from '@deepseek-ai/dsh-agent';
import {
  loadPack,
  discoverSshSite,
  installPackMethod,
  packDigestOf,
  saveDiscoveredSite,
  readArchivedMaterial,
  readRunAssets,
  currentRecordsIn,
  type CodeRecord,
  type JobRecord,
  type LedgerRecord,
  type NodeRecord,
  type RunRecord,
} from '@hima/harness';
import { himaProfileDir, prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import {
  bootInProcess,
  createRootAgent,
  type InProcessHost,
} from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const PACK_ID = 'custom-cell-fmax-dtco';
const EXPECTED_MODEL = 'deepseek-flash';
const FIRST_TIME_BOX_MS = 60 * 60_000;
const HARNESS_TIME_BOX_MS = 100 * 60_000;
const FIRST_RETRY_ALLOWANCE = 3;
const GENERATION_LIMIT = 1;
const ATTEMPT_LIMIT = 120;
const CLOSING_RESERVE_MS = 60_000;
const MAX_PRODUCT_REQUEST_STEPS = 600;
const MAX_USER_TURNS = 120;
const SITE_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SAFE_REMOTE_PATH = /^\/[A-Za-z0-9._/+*-]+$/;

const routes = [
  'timing-criticality',
  'timing-context',
  'structure-frequency',
  'structure-compaction',
  'mapper-compatibility',
  'functional-diversity',
] as const;

const requiredReferenceNodes = [
  'probe',
  'synthesize',
  'read-probe',
  'judge',
  'next-period',
  'mine-start',
  ...routes.flatMap((route) => [`mine-${route}`, `select-${route}`, `read-select-${route}`]),
  'merge-join',
  'merge',
  'read-merge',
  'generate',
  'read-generate',
  'layout',
  'read-layout',
  'characterize',
  'read-characterize',
  'compile',
  'read-compile',
  'foundry-synth',
  'read-foundry-synth',
  'custom-synth',
  'read-custom-synth',
  'adoption',
  'read-adoption',
  'pnr-foundry',
  'read-pnr-foundry',
  'pnr-generated',
  'read-pnr-generated',
  'verify',
  'read-verify',
  'compare',
  'read-compare',
  'final-judge',
  'next-research',
] as const;

const requiredValueTypes = [
  'clock_period',
  'setup_wns',
  'cell_area',
  'candidate_count',
  'selected_count',
  'generated_cell_count',
  'abstract_cell_count',
  'predicted_cell_count',
  'lc_accepted',
  'library_visible',
  'adopted_instance_count',
  'pnr_completed',
  'verification_error_count',
  'full_constraint_failures',
  'matched_conditions',
  'foundry_setup_wns',
  'setup_wns_delta',
  'foundry_fmax_mhz',
  'generated_fmax_mhz',
  'fmax_delta_mhz',
  'fmax_improved',
] as const;

interface L5SiteProfile {
  schema: 1;
  site: {
    name: string;
    ssh: { destination: string; jumps: string[]; controlPersistSeconds: number };
    workspaceRoot: string;
    allowedReadRoots: string[];
    allowedWriteRoots: string[];
    allowedWrappers: string[];
    toolCommands: string[];
    bindings: Record<string, string>;
    capacity: { cores: number; memoryGiB: number; parallelJobs: number; licences: Record<string, number> };
  };
  heldOut: { rtlPath: string; sha256: string; source: string; selectedBeforePackTests: boolean };
}

type ArchiveRecord = Extract<LedgerRecord, { type: 'archive' }>;

interface PilotCheckpoint {
  schema: 3;
  status: 'positive-held-out-l5-passed-ready-for-release-review';
  home: string;
  firstRun: string;
  firstOwner: string;
  pack: { id: string; version: string; digest: string };
  site: string;
  goal: Record<string, number>;
  archive: {
    directory: string;
    manifest: string;
    manifestSha256: string;
    experience: string;
  };
  recordsSha256: string;
}

const isTerminal = (status: string | undefined): boolean =>
  status?.startsWith('ended-') === true || status === 'cancelled';

const isActive = (status: string | undefined): boolean =>
  status === 'running' || status === 'waiting';

const jsonOf = (result: { content?: readonly { type: string; text?: string }[] }): Record<string, any> =>
  JSON.parse(result.content?.find((item) => item.type === 'text')?.text ?? '{}') as Record<string, any>;

const rawArgs = process.argv.slice(2);
const usage = [
  'usage:',
  '  node scripts/live-check-dtco-pilot.ts --preflight-only --site-profile <private-site.json>',
  '  node scripts/live-check-dtco-pilot.ts --out <fresh-directory> --site-profile <private-site.json>',
  `    [--timeout-ms ${HARNESS_TIME_BOX_MS} --max-turns ${MAX_USER_TURNS} --max-steps ${MAX_PRODUCT_REQUEST_STEPS}]`,
  '',
  'The live form requires DEEPSEEK_API_KEY in the inherited environment.',
].join('\n');

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

const profileFlags = rawArgs.flatMap((arg, index) => arg === '--site-profile' ? [index] : []);
if (profileFlags.length !== 1) throw new Error(usage);
const profileIndex = profileFlags[0]!;
const profileArgument = rawArgs[profileIndex + 1];
if (!profileArgument || profileArgument.startsWith('--')) throw new Error(usage);
const preflightOnly = rawArgs.includes('--preflight-only');
const forwardedArgs = rawArgs.filter((_arg, index) => index !== profileIndex && index !== profileIndex + 1);
if (preflightOnly) {
  if (forwardedArgs.length !== 1 || forwardedArgs[0] !== '--preflight-only') throw new Error(usage);
} else if (forwardedArgs.includes('--preflight-only')) {
  throw new Error(usage);
} else {
  const outIndex = forwardedArgs.indexOf('--out');
  if (outIndex < 0 || !forwardedArgs[outIndex + 1] || forwardedArgs[outIndex + 1]!.startsWith('--')) throw new Error(usage);
}

const profilePath = realpathSync(path.resolve(profileArgument));
assert.ok(lstatSync(profilePath).isFile() && !lstatSync(profilePath).isSymbolicLink(), 'Site profile must be a plain file');
const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as L5SiteProfile;
assert.equal(profile.schema, 1, 'unsupported private Site profile');
assert.match(profile.site.name, SITE_NAME, 'invalid Site name');
assert.match(profile.site.ssh.destination, /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+(?::[0-9]{1,5})?$/, 'invalid SSH destination');
assert.ok(profile.heldOut.selectedBeforePackTests, 'held-out design must have been selected before Pack tests');
assert.match(profile.heldOut.sha256, /^[0-9a-f]{64}$/, 'held-out RTL identity must be SHA-256');
assert.match(profile.heldOut.rtlPath, SAFE_REMOTE_PATH, 'held-out RTL path is not a safe absolute path');
for (const value of [profile.site.workspaceRoot, ...profile.site.allowedReadRoots, ...profile.site.allowedWriteRoots,
  ...Object.values(profile.site.bindings).filter((value) => value.startsWith('/'))]) {
  assert.match(value, SAFE_REMOTE_PATH, `unsafe Site path: ${value}`);
}
assert.deepEqual(Object.keys(profile.site.bindings).sort(), [
  'constraints', 'designRoot', 'designTop', 'foundryLibrary', 'physicalInputs', 'rtlGlob', 'toolStack', 'workspaceRoot',
].sort(), 'private Site profile must bind exactly the portable Pack inputs');
assert.equal(profile.site.bindings.rtlGlob, profile.heldOut.rtlPath, 'held-out identity must name the bound RTL');
assert.equal(profile.site.bindings.workspaceRoot, profile.site.workspaceRoot, 'Site and binding workspace roots differ');
assert.ok(profile.site.allowedReadRoots.some((root) => profile.heldOut.rtlPath.startsWith(`${root}/`)), 'held-out RTL is outside allowed read roots');
assert.ok(profile.site.allowedWriteRoots.includes(profile.site.workspaceRoot), 'Campaign workspace root is not writable');
assert.ok(profile.site.toolCommands.includes('eda'), 'Site discovery must probe the Pack-required eda command');
assert.ok(profile.site.allowedWrappers.includes('/usr/bin/python3') && profile.site.allowedWrappers.includes('/usr/local/bin/eda'),
  'portable Pack requires the exact Python and EDA wrappers');
assert.equal(profile.site.capacity.parallelJobs, 1, 'the single L5 Campaign must reserve one Site job at a time');
for (const licence of ['Design-Compiler', 'Library-Compiler', 'Innovus']) {
  assert.equal(profile.site.capacity.licences[licence], 1, `the L5 Site must reserve one ${licence} seat`);
}

const packSource = path.join(repoRoot, 'packs', PACK_ID);
const sourcePack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
const sourceDigest = packDigestOf(packSource);
assert.equal(sourcePack.contract.version, '1', 'PLS-35 requires the portable v1 Pack');
assert.equal(sourcePack.contract.status, 'development', 'PLS-35 must preserve the Pack author-declared status');

const declared = {
  pack: {
    id: PACK_ID,
    version: sourcePack.contract.version,
    digest: sourceDigest,
    stage: sourcePack.contract.status,
  },
  siteProfile: {
    sha256: sha256(readFileSync(profilePath)),
    site: profile.site.name,
    heldOutSource: profile.heldOut.source,
    heldOutRtlSha256: profile.heldOut.sha256,
  },
  approvedLimits: {
    firstCampaignMs: FIRST_TIME_BOX_MS,
    closingReserveMs: CLOSING_RESERVE_MS,
    generationLimit: GENERATION_LIMIT,
    retryAllowance: FIRST_RETRY_ALLOWANCE,
    attemptLimit: ATTEMPT_LIMIT,
    harnessWallMs: HARNESS_TIME_BOX_MS,
    maxProductRequestSteps: MAX_PRODUCT_REQUEST_STEPS,
    maxUserTurns: MAX_USER_TURNS,
  },
};

if (preflightOnly) {
  process.stdout.write(`${JSON.stringify({
    status: 'preflight-passed',
    scope: 'static private-profile and Pack inspection only; no SSH, Host, model, EDA, or desktop',
    ...declared,
  }, null, 2)}\n`);
  process.exit(0);
}

process.argv = [process.argv[0]!, process.argv[1]!, ...forwardedArgs];

function experienceDeps(host: InProcessHost, home: HimaHome) {
  return {
    ledger: host.ctx.hima.ledger,
    packsDir: path.join(home.home, 'hima/packs'),
    sitesDir: path.join(home.home, 'hima/sites'),
  };
}

async function continueUntilTerminal(
  check: LiveCheck,
  host: InProcessHost,
  owner: Agent,
  runId: string,
  prompt: string,
  maximumMessages: number,
): Promise<RunRecord | undefined> {
  let previousState = '';
  let unchangedContinuations = 0;
  for (let message = 0; message < maximumMessages; message += 1) {
    let run = host.ctx.hima.ledger.run(runId);
    if (!run || isTerminal(run.status)) return run;
    if (run.control?.stop !== undefined) {
      await check.until(
        `Run ${runId} stop settles`,
        () => isTerminal(host.ctx.hima.ledger.run(runId)?.status),
        Math.max(1, check.deadline - Date.now() - 5_000),
      );
      return host.ctx.hima.ledger.run(runId);
    }
    await check.until(
      `Run ${runId} has no working execution`,
      () => !host.ctx.hima.executionContext(runId).executions.some((execution) => execution.phase === 'working'),
      Math.max(1, check.deadline - Date.now() - 5_000),
    );
    await check.wait(owner.whenIdle());
    run = host.ctx.hima.ledger.run(runId);
    if (!run || isTerminal(run.status)) return run;
    const current = host.ctx.hima.executionContext(runId);
    if (current.executions.some((execution) => execution.phase === 'working')) continue;
    const state = JSON.stringify({ status: run.status, node: run.currentNode, generation: run.generation,
      paused: run.control?.paused, available: current.available,
      executions: current.executions.map(e => ({ id: e.id, phase: e.phase, result: e.result })),
    });
    unchangedContinuations = state === previousState ? unchangedContinuations + 1 : 0;
    previousState = state;
    if (unchangedContinuations >= 3) {
      check.observed.stalled = { run: runId, node: run.currentNode, unchangedContinuations, context: current };
      check.checkpoint();
      throw new Error(`Run ${runId} made no execution progress across three completed continuations; preserve the failure and stop further model requests`);
    }
    if (run.status === 'waiting' && current.nodes.some(node => node.id === run.currentNode && node.kind === 'wait')) {
      check.observed.humanWait = { run: run.id, node: run.currentNode, status: run.status };
      check.checkpoint();
      throw new Error(`Run ${runId} reached Pack wait node ${run.currentNode}; stop without repeating model continuations that cannot supply human clearance`);
    }
    await check.say(owner, prompt);
  }
  throw new Error(`continuation budget exhausted before Run ${runId} reached a terminal state`);
}

function completeArchiveRecord(records: LedgerRecord[]): ArchiveRecord | undefined {
  return records.findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'complete');
}

await runLive('live-check-dtco-pilot', MAX_USER_TURNS, async (check: LiveCheck) => {
  const sshArguments = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ControlPath=none'];
  if (profile.site.ssh.jumps.length > 0) sshArguments.push('-J', profile.site.ssh.jumps.join(','));
  const remoteIdentity = execFileSync('ssh', [
    ...sshArguments,
    profile.site.ssh.destination,
    `sha256sum -- ${profile.heldOut.rtlPath}`,
  ], { encoding: 'utf8', timeout: 30_000 }).trim().split(/\s+/)[0];
  check.require('held-out RTL identity was re-read from the Site before the only L5 Campaign',
    remoteIdentity === profile.heldOut.sha256,
    { source: profile.heldOut.source, selectedBeforePackTests: profile.heldOut.selectedBeforePackTests,
      rtlSha256: remoteIdentity });

  const persistentHomes = path.join(repoRoot, '.hima-tmp/pilot-release/homes');
  mkdirSync(persistentHomes, { recursive: true, mode: 0o700 });
  const previousTmpdir = process.env.TMPDIR;
  let home: HimaHome;
  try {
    // createHimaHome uses os.tmpdir(). Point only its allocation at a retained repo-private parent.
    // LiveCheck's TMUX_TMPDIR remains its own private temporary server.
    process.env.TMPDIR = persistentHomes;
    home = await createHimaHome();
  } finally {
    if (previousTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmpdir;
  }
  check.home = home;
  await prepareHimaHome({ home: home.home, bundleMode: 'installed' });
  const installedPack = path.join(packsDirOf(home), PACK_ID);
  const installation = installPackMethod({ from: packSource, to: installedPack });
  check.require('the clean Home explicitly installed the exact portable Pack',
    installation.changed && installation.digest === sourceDigest,
    { changed: installation.changed, digest: installation.digest });
  const sites = path.join(home.home, 'hima/sites');
  const discovery = await discoverSshSite({
    name: profile.site.name,
    ssh: profile.site.ssh,
    hints: {
      workspaceRoot: profile.site.workspaceRoot,
      allowedReadRoots: profile.site.allowedReadRoots,
      allowedWriteRoots: profile.site.allowedWriteRoots,
      allowedWrappers: profile.site.allowedWrappers,
      toolCommands: profile.site.toolCommands,
    },
  });
  check.require('bounded SSH discovery found the Site and every Pack-required command',
    discovery.unknowns.length === 0 && discovery.conflicts.length === 0
      && discovery.site.discovery.facts.some((fact) => fact.probe[0] === 'which' && fact.probe[1] === 'eda' && fact.code === 0),
    { unknowns: discovery.unknowns, conflicts: discovery.conflicts,
      probes: discovery.site.discovery.facts.map((fact) => ({ probe: fact.probe, code: fact.code })) });
  const savedSite = saveDiscoveredSite(sites, {
    ...discovery,
    site: {
      ...discovery.site,
      bindings: profile.site.bindings,
      capacity: profile.site.capacity,
    },
  });
  check.require('the discovered Site was saved with the portable Pack bindings and deletion redline',
    savedSite.name === profile.site.name
      && savedSite.discovery?.stale === false
      && savedSite.permitRules.forbidden.includes('deletions')
      && Object.keys(savedSite.bindings).length === 8,
    { name: savedSite.name, discovery: savedSite.discovery?.observedAt,
      bindings: Object.keys(savedSite.bindings).sort(), forbidden: savedSite.permitRules.forbidden });
  writeFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');

  process.chdir(home.workspace);
  let host = await bootInProcess(home);
  check.attach(host);
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  guardInstalled(check, host, [bundle, packsDirOf(home), home.workspace], installedPack, check.temporary);
  host.ctx.tools.guard((execution) => {
    if (execution.name === 'write' || execution.name === 'edit') {
      return 'PLS-35 writes generated research code only through controlled hima_execute write';
    }
    if (['hima_author', 'hima_pack_release'].includes(execution.name)) {
      return 'PLS-35 uses the fixed installed method and does not author or publish it';
    }
    return undefined;
  });

  const initialRunIds = new Set(host.ctx.hima.ledger.runs().map((run) => run.id));
  const owner = check.track(await createRootAgent(host.ctx, home.workspace));
  const ownerId = String(owner.id);
  check.require('the native owner uses the configured DeepSeek-V4.1-Flash model',
    owner.options.model === EXPECTED_MODEL,
    owner.options);
  check.observed.pilot = declared;
  check.observed.realEdaRequested = true;
  check.observed.owner = ownerId;
  check.observed.persistentHome = home.home;
  check.observed.executionSurface = 'headless real Host; retained for separate same-home desktop review';
  check.observed.hostBoots = 1;

  const ownedRuns = () => host.ctx.hima.ledger.runs().filter((run) =>
    !initialRunIds.has(run.id)
      && run.packId === PACK_ID
      && run.siteId === profile.site.name
      && run.control?.owner === ownerId);

  check.beforeDispose(async () => {
    const active = ownedRuns().filter((run) => isActive(run.status));
    check.observed.preCleanupRuns = active.map((run) => ({
      run,
      records: host.ctx.hima.ledger.records({ runId: run.id }),
    }));
    const cleanup: unknown[] = [];
    for (const run of active) {
      try {
        cleanup.push({ id: run.id, result: await host.ctx.hima.cancelRun(run.id) });
      } catch (error) {
        cleanup.push({ id: run.id, error: check.clean(String(error)) });
      }
    }
    const unsettled = ownedRuns().filter((run) => isActive(run.status));
    check.observed.ownedRunCleanup = cleanup;
    check.observed.postCleanupRuns = ownedRuns().map((run) => ({
      run,
      records: host.ctx.hima.ledger.records({ runId: run.id }),
    }));
    check.check('cleanup targets only this owner and records actual Run settlement before Host disposal',
      unsettled.length === 0,
      { active: active.map((run) => run.id), cleanup, unsettled: unsettled.map((run) => run.id) });
    if (unsettled.length > 0) throw new Error('owned Runs did not settle before Host disposal');
  });

  const preparedResult = await host.ctx.tools.execute({
    callId: 'pls35-prepare' as never,
    name: 'hima_prepare',
    arguments: { pack: PACK_ID, site: profile.site.name },
    agent: owner,
    signal: AbortSignal.timeout(30_000),
  });
  const prepared = jsonOf(preparedResult);
  check.require('HimaGuide prepared a complete proposal without creating a Run',
    preparedResult.isError !== true && prepared.ready === true && prepared.pack?.id === PACK_ID
      && prepared.site?.name === profile.site.name && prepared.unknowns?.length === 0
      && ownedRuns().length === 0,
    { ready: prepared.ready, pack: prepared.pack?.id, site: prepared.site?.name,
      inputs: prepared.inputs, unknowns: prepared.unknowns, runs: ownedRuns().length });
  const confirmedResult = await host.ctx.tools.execute({
    callId: 'pls35-confirm' as never,
    name: 'hima_run',
    arguments: { proposalId: prepared.id, pack: PACK_ID, site: profile.site.name,
      goal: prepared.goal, strategy: prepared.strategy },
    agent: owner,
    signal: AbortSignal.timeout(30_000),
  });
  const confirmed = jsonOf(confirmedResult);
  check.require('one confirmation created one Campaign and one persistent Run',
    confirmedResult.isError !== true && confirmed.kind === 'ran' && typeof confirmed.runId === 'string'
      && ownedRuns().length === 1,
    { kind: confirmed.kind, runId: confirmed.runId, campaignId: confirmed.campaignId,
      createdRuns: ownedRuns().map((run) => run.id) });

  const firstPrompt = [
    `Execute only the already confirmed Campaign Run ${confirmed.runId}.`,
    'You are the only execution owner. Use only hima_context and hima_execute for business actions. Do not start another Run, edit the method, use shell, open another Agent/model, or auto-drive the graph.',
    'Complete the full reference method from actual facts: the probe loop; all six mining branches and all six selection Workshops; merge; generate; layout; predicted characterization; Library Compiler; foundry and custom Design Compiler; adoption; paired foundry/generated PNR; verification; comparison; final Judge; and next-research.',
    'For each selection Workshop use recommend; read research_<route>, raw_<route>, source_<route>, selectionTemplate and the declared Pack knowledge before writing. The raw read may be bounded in chat; the executed program receives the complete file. Copy the exact template and implement only a deterministic, data-dependent choose(candidates, route) over the actual generation_requests. The declared candidate schema puts route facts under candidate["discovery_evidence"] and the interface under candidate["generator_contract"]["interface"]; do not invent shorter aliases. For this bounded L5 return at most one strongest buildable candidate per route: rank route-specific evidence first, then prefer fewer inputs, then use candidate_id only as a deterministic tie break. Never embed candidate ids and never add a weaker candidate just to fill the Pack maximum. Write entry.py through hima_execute, run those exact recorded bytes, and preserve every failure and retry.',
    'Treat learned characterization as predicted, Site tool outputs as executed tool evidence, and post-route values as measured only where the readers say so. Never turn asked, derived, predicted, missing, failed, or unknown values into measurements or success.',
    'At next-research, record source-linked analysis with current record citations, limitations, and discriminating next experiments, then complete truthfully. Goal-met requires every final rule to PASS, including an actual routed custom Cell instance and strictly higher Fmax in the generated arm. Never convert a negative result into success.',
    'A node in retrying state has only recorded a failed attempt; Fabric does not launch a hidden automatic retry. Read the failed Job log once, diagnose it, and either begin one fresh admitted attempt or stop truthfully. Never poll the same completed failure while waiting for a nonexistent retry.',
    'The Pack reserves 60 seconds for closing, permits at most 120 attempts, and has a 60-minute Campaign limit. The enclosing live harness has 100 minutes, 600 product request steps and 120 user turns. These are upper limits, not a promise that the model or tools will finish.',
    'When a Job is asynchronous, yield and let its native tool notification report settlement. Continue from the current context only; never repeat a launch with a new request identity.',
  ].join('\n');
  let created = ownedRuns();
  check.require('the owner opened exactly one first Campaign', created.length === 1, created);
  const firstId = created[0]!.id;
  check.require('the confirmed Run identity is the only owner Run', firstId === confirmed.runId, { firstId, confirmed: confirmed.runId });
  const first = host.ctx.hima.ledger.run(firstId)!;
  check.require('the first Campaign admitted the exact Pack, Site, Goal, strategy, and approved budget',
    (first.purpose ?? 'campaign') === 'campaign'
      && first.packDigest === sourceDigest
      && first.goal?.target_period_ns === 0.5
      && first.firstStrategy?.periodNs === 0.5
      && first.firstStrategy?.algorithmRevision === 0
      && first.firstStrategy?.floorplanUtilization === 0.5
      && first.budget?.timeBoxMs === FIRST_TIME_BOX_MS
      && first.budget?.closingReserveMs === CLOSING_RESERVE_MS
      && first.budget?.attemptLimit === ATTEMPT_LIMIT
      && first.budget?.generationLimit === GENERATION_LIMIT
      && first.budget?.retryAllowance === FIRST_RETRY_ALLOWANCE
      && first.budget?.jobCap === 1
      && first.budget?.licences?.['Design-Compiler'] === 1
      && first.budget?.licences?.['Library-Compiler'] === 1
      && first.budget?.licences?.Innovus === 1,
    first);

  // Validate every non-executing admission fact before the owner can launch the first Site Job.
  // The prior L5 attempt exposed why this ordering matters: a harness-side expectation mismatch
  // must fail before any expensive work begins, not while a valid Job is already running.
  await check.say(owner, firstPrompt);

  const endedFirst = await continueUntilTerminal(
    check,
    host,
    owner,
    firstId,
    [
      `Continue only existing Run ${firstId} from the latest public context.`,
      'Act on ready nodes in the full reference method, await native Job notifications, preserve failures and raw facts, record source-linked analysis at next-research, and finish/archive truthfully. Do not create a Run or change the method.',
    ].join('\n'),
    100,
  );
  check.require('the first Campaign reached a terminal state', isTerminal(endedFirst?.status), endedFirst ?? null);

  const firstRun = host.ctx.hima.ledger.run(firstId)!;
  const firstContext = host.ctx.hima.executionContext(firstId);
  const firstRecords = host.ctx.hima.ledger.records({ runId: firstId });
  const doneNodes = new Set(currentRecordsIn(firstRecords)
    .filter((record): record is NodeRecord => record.type === 'node' && record.state === 'done')
    .map((record) => record.nodeId));
  const missingNodes = requiredReferenceNodes.filter((node) => !doneNodes.has(node));
  check.require('the first Campaign completed every required reference stage', missingNodes.length === 0, { missingNodes, doneNodes: [...doneNodes] });

  const unsettledExecutions = firstContext.executions.filter((execution) => execution.supersededBy === undefined
    && (execution.phase === 'begun' || execution.phase === 'working' || execution.phase === 'ready' || execution.phase === 'uncertain'));
  const launchedJobs = firstRecords.filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
  const openJobs = launchedJobs.filter((launch) => !firstRecords.some((record) =>
    record.type === 'job'
      && record.seq > launch.seq
      && record.job.session === launch.job.session
      && (record.event === 'finished' || record.event === 'killed')));
  check.require('the complete first Campaign has no unsettled execution or unaccounted Job',
    unsettledExecutions.length === 0 && openJobs.length === 0,
    { unsettledExecutions, openJobs });

  const finalJudge = firstContext.executions.findLast((execution) => execution.nodeId === 'final-judge');
  const finalDecision = firstRecords.findLast((record) => record.type === 'decision' && record.nodeId === 'next-research');
  const positiveEnding = firstRun.status === 'ended-goal-met'
    && finalJudge?.result?.outcome === 'PASS'
    && finalDecision?.type === 'decision'
    && 'goalMet' in finalDecision.chosen;
  check.require('the held-out Campaign ended goal-met through the complete final Judge',
    positiveEnding,
    { status: firstRun.status, finalJudge, finalDecision });

  const firstAnalysis = firstRecords.findLast((record) => record.type === 'analysis'
    && record.nodeId === 'next-research'
    && record.sessionId === ownerId);
  check.require('the owner recorded bounded source-linked analysis of the held-out result',
    firstAnalysis?.type === 'analysis'
      && firstAnalysis.analysis.claims.length > 0
      && firstAnalysis.analysis.limitations.length > 0
      && firstAnalysis.analysis.nextExperiments.length > 0
      && firstAnalysis.analysis.claims.every((claim) => claim.cites.length > 0
        && claim.cites.every((cite) => firstRecords.some((record) => record.id === cite))),
    firstRecords.filter((record) => record.type === 'analysis'));

  const valueTypes = new Set(currentRecordsIn(firstRecords).flatMap((record) => record.type === 'observation'
    ? record.values.map((value) => value.type)
    : []));
  const missingValueTypes = requiredValueTypes.filter((type) => !valueTypes.has(type));
  check.require('the archived result keeps distinct probe, predicted, adoption, verification, and matched physical facts',
    missingValueTypes.length === 0,
    { missingValueTypes, valueTypes: [...valueTypes] });
  const comparison = currentRecordsIn(firstRecords).findLast((record) =>
    record.type === 'observation' && record.reader.id === 'read-compare');
  const comparisonValues = new Map(comparison?.type === 'observation'
    ? comparison.values.map((value) => [value.type, value.value]) : []);
  const foundryFmax = comparisonValues.get('foundry_fmax_mhz');
  const generatedFmax = comparisonValues.get('generated_fmax_mhz');
  check.require('the final matched comparison proves routed adoption and strictly higher custom-arm Fmax',
    comparison?.type === 'observation'
      && comparisonValues.get('adopted_instance_count')! > 0
      && comparisonValues.get('full_constraint_failures') === 0
      && comparisonValues.get('matched_conditions') === 1
      && comparisonValues.get('fmax_improved') === 1
      && typeof foundryFmax === 'number' && typeof generatedFmax === 'number'
      && generatedFmax > foundryFmax,
    { comparisonRecord: comparison?.id, adoptedInstances: comparisonValues.get('adopted_instance_count'),
      matchedConditions: comparisonValues.get('matched_conditions'), foundryFmax, generatedFmax,
      delta: comparisonValues.get('fmax_delta_mhz') });

  const selectorNodes = routes.map((route) => `select-${route}`);
  const codeRecords = firstRecords.filter((record): record is CodeRecord => record.type === 'code');
  const templateSha256 = sha256(readFileSync(path.join(packSource, 'flow/selection-template.py')));
  const selectorCode = selectorNodes.map((nodeId) => ({
    nodeId,
    records: codeRecords.filter((record) => record.nodeId === nodeId),
  }));
  check.require('the same model owner supplied executed non-template code for all six selectors',
    selectorCode.every(({ nodeId, records }) => records.some((code) =>
      code.sessionId === ownerId
        && code.sha256 !== templateSha256
        && launchedJobs.some((job) => job.nodeId === nodeId
          && job.workshop?.entry.path === code.path
          && job.workshop.entry.sha256 === code.sha256))),
    selectorCode);
  check.require('no separate research model session was opened inside the Campaign',
    firstRecords.every((record) => record.type !== 'session') && check.requestSessions.size === 1,
    { sessionRecords: firstRecords.filter((record) => record.type === 'session'), requestSessions: [...check.requestSessions] });

  const firstArchive = await readRunAssets(experienceDeps(host, home), firstId);
  check.require('the first technical report and Pack-local archive are readable and hash-bound',
    firstArchive.kind === 'read',
    firstArchive);
  if (firstArchive.kind !== 'read') throw new Error('first archive is unavailable');
  const firstArchiveRecord = completeArchiveRecord(firstRecords);
  check.require('the first archive manifest matches the completed Ledger record',
    firstArchiveRecord?.type === 'archive'
      && firstArchiveRecord.manifestSha256 === sha256(readFileSync(firstArchive.manifestPath))
      && firstArchiveRecord.manifestSha256 === sha256(readFileSync(path.join(firstArchive.directory, 'manifest.json'))),
    firstArchiveRecord ?? null);

  const requiredArchivedRecords = firstRecords.filter((record) =>
    record.type === 'observation' || record.type === 'code' || record.type === 'knowledge');
  const materialByRecord = new Map(firstArchive.manifest.materials.map((material) => [material.recordId, material]));
  const missingMaterials = requiredArchivedRecords.filter((record) => !materialByRecord.has(record.id));
  check.require('the first archive contains every observation, generated code file, and knowledge read',
    missingMaterials.length === 0
      && firstArchive.manifest.materials.some((material) => material.path === 'experience.md')
      && firstArchive.manifest.materials.some((material) => material.path === 'experience.json'),
    { missingMaterials, materialCount: firstArchive.manifest.materials.length });
  const unreadableMaterials: unknown[] = [];
  for (const material of firstArchive.manifest.materials) {
    const read = await readArchivedMaterial(experienceDeps(host, home), firstId, material.path);
    if (read.kind !== 'read') unreadableMaterials.push({ material, read });
  }
  check.require('every first archive material passes an actual byte/hash read', unreadableMaterials.length === 0, unreadableMaterials);
  check.require('the source and installed method digest remained unchanged through the full Campaign',
    packDigestOf(packSource) === sourceDigest && packDigestOf(installedPack) === sourceDigest,
    { source: packDigestOf(packSource), installed: packDigestOf(installedPack), expected: sourceDigest });

  const selectorInputs = path.join(check.out, 'selector-inputs');
  mkdirSync(selectorInputs, { recursive: false, mode: 0o700 });
  const copyHeldMaterial = async (record: LedgerRecord, name: string): Promise<string> => {
    const material = materialByRecord.get(record.id);
    assert.ok(material, `missing archived material for ${record.id}`);
    const held = await readArchivedMaterial(experienceDeps(host, home), firstId, material.path);
    assert.equal(held.kind, 'read');
    if (held.kind !== 'read') throw new Error('selector input is not readable');
    const target = path.join(selectorInputs, name);
    writeFileSync(target, held.text, { mode: 0o600 });
    return target;
  };
  const auditSelectors = [];
  for (const route of routes) {
    const nodeId = `select-${route}`;
    const suffix = route.replaceAll('-', '_');
    const launch = launchedJobs.findLast(job => job.nodeId === nodeId && firstRecords.some(record =>
      record.type === 'job' && record.event === 'finished' && record.exitCode === 0
        && record.job.session === job.job.session));
    assert.ok(launch?.workshop, `no successful actual selector launch for ${route}`);
    const code = codeRecords.findLast(record => record.path === launch.workshop!.entry.path
      && record.sha256 === launch.workshop!.entry.sha256 && record.sessionId === ownerId);
    const rawRead = firstRecords.findLast(record => record.type === 'knowledge' && record.origin === 'input'
      && record.file === `raw_${suffix}` && record.nodeId === nodeId && record.sessionId === ownerId
      && (record.exposedBytes ?? 0) > 0 && record.seq < launch.seq);
    const sourceRead = firstRecords.findLast(record => record.type === 'knowledge' && record.origin === 'input'
      && record.file === `source_${suffix}` && record.nodeId === nodeId && record.sessionId === ownerId
      && (record.exposedBytes ?? 0) > 0 && record.seq < launch.seq);
    const selection = firstRecords.findLast(record => record.type === 'observation'
      && record.reader.id === `read-select-${route}` && record.seq > launch.seq);
    check.require(`the ${route} selector has actual source reads before its recorded execution`,
      !!code && rawRead?.type === 'knowledge' && sourceRead?.type === 'knowledge'
        && selection?.type === 'observation', { code, rawRead, sourceRead, selection, launch });
    if (!code || rawRead?.type !== 'knowledge' || sourceRead?.type !== 'knowledge'
      || selection?.type !== 'observation') throw new Error('selector provenance is incomplete');
    // A chat read may expose a prefix. The actual program consumes the complete input;
    // select its separately held full capture while retaining the model-read provenance above.
    const fullRaw = firstRecords.findLast(record => record.type === 'knowledge' && record.origin === 'input'
      && record.file === `raw_${suffix}` && record.nodeId === nodeId && record.seq < launch.seq
      && record.sha256 === (rawRead.sourceMaterialSha256 ?? rawRead.sha256)
      && record.bytes === (rawRead.sourceMaterialBytes ?? rawRead.bytes));
    assert.ok(fullRaw?.type === 'knowledge', `complete raw input not retained for ${route}`);
    const codeFile = await copyHeldMaterial(code, `${suffix}.py`);
    const rawFile = await copyHeldMaterial(fullRaw, `${suffix}-raw.json`);
    const selectionFile = await copyHeldMaterial(selection, `${suffix}-selected.json`);
    auditSelectors.push({ route: suffix, code: codeFile, codeSha256: code.sha256,
      raw: rawFile, rawSha256: sha256(readFileSync(rawFile)), selection: selectionFile,
      selectionSha256: selection.contentSha256, codeRecord: code.id,
      rawReadRecord: rawRead.id, sourceReadRecord: sourceRead.id, selectionRecord: selection.id,
      jobSession: launch.job.session });
  }
  const selectorManifest = path.join(selectorInputs, 'manifest.json');
  const subsetEvidence = path.join(check.out, 'selector-subsets.json');
  writeFileSync(selectorManifest, JSON.stringify({ template: path.join(packSource, 'flow/selection-template.py'),
    templateSha256, selectors: auditSelectors }, null, 2) + '\n', { mode: 0o600 });
  const auditorFile = path.join(repoRoot, 'scripts/audit-dtco-pilot-selectors.py');
  const auditorSha256 = sha256(readFileSync(auditorFile));
  execFileSync('/usr/bin/python3', [auditorFile,
    selectorManifest, subsetEvidence], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const subsetAudit = JSON.parse(readFileSync(subsetEvidence, 'utf8')) as { status?: string; auditorSha256?: string };
  check.require('the selector audit identifies the exact launched auditor bytes',
    subsetAudit.auditorSha256 === auditorSha256 && sha256(readFileSync(auditorFile)) === auditorSha256,
    { expected: auditorSha256, reported: subsetAudit.auditorSha256 });
  check.require('unchanged executed selectors reproduce results and respond to withheld candidates',
    subsetAudit.status === 'passed', subsetAudit);
  check.observed.selectorAudit = { path: subsetEvidence, sha256: sha256(readFileSync(subsetEvidence)), auditorSha256,
    scope: 'finite input-dependence check; no new model, EDA, optimality or PPA claim' };

  const firstManifestPath = firstArchive.manifestPath;
  const firstExperiencePath = path.join(firstArchive.directory, 'experience.md');
  const firstManifestSha256 = firstArchiveRecord?.type === 'archive' ? firstArchiveRecord.manifestSha256 : undefined;
  assert.ok(firstManifestSha256);
  const beforeRestart = sha256(Buffer.from(JSON.stringify(firstRecords)));
  await host.dispose();
  host = await bootInProcess(home);
  check.attach(host);
  check.observed.hostBoots = 2;
  const restartedFirst = host.ctx.hima.ledger.run(firstId);
  const restartedFirstRecords = host.ctx.hima.ledger.records({ runId: firstId });
  const restartedFirstArchive = await readRunAssets(experienceDeps(host, home), firstId);
  check.require('restart re-read preserves the first terminal Run, records, and archive identity',
    restartedFirst?.status === firstRun.status
      && sha256(Buffer.from(JSON.stringify(restartedFirstRecords))) === beforeRestart
      && restartedFirstArchive.kind === 'read'
      && completeArchiveRecord(restartedFirstRecords)?.manifestSha256 === firstManifestSha256,
    {
      first: restartedFirst,
      firstArchive: restartedFirstArchive,
    });
  check.require('restart finds no active owned Run and the source/installed method remains exact',
    ownedRuns().every((run) => isTerminal(run.status))
      && packDigestOf(packSource) === sourceDigest
      && packDigestOf(installedPack) === sourceDigest,
    { runs: ownedRuns(), sourceDigest: packDigestOf(packSource), installedDigest: packDigestOf(installedPack) });

  const checkpoint: PilotCheckpoint = {
    schema: 3,
    status: 'positive-held-out-l5-passed-ready-for-release-review',
    home: home.home,
    firstRun: firstId,
    firstOwner: ownerId,
    pack: { id: PACK_ID, version: sourcePack.contract.version, digest: sourceDigest },
    site: profile.site.name,
    goal: { target_period_ns: 0.5 },
    archive: {
      directory: firstArchive.directory,
      manifest: firstManifestPath,
      manifestSha256: firstManifestSha256,
      experience: firstExperiencePath,
    },
    recordsSha256: beforeRestart,
  };
  const checkpointPath = path.join(home.home, 'pilot-checkpoint.json');
  writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  check.observed.runs = {
    first: firstRun,
    firstRecordCount: firstRecords.length,
    firstArchive: {
      directory: firstArchive.directory,
      manifestSha256: firstManifestSha256,
      materials: firstArchive.manifest.materials.length,
    },
    restartRecordsSha256: beforeRestart,
    checkpoint: checkpointPath,
    outcome: 'positive-held-out-l5-passed-ready-for-release-review',
  };
});
