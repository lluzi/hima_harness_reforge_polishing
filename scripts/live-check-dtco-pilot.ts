// @hima-seam agent wrapped
// @hima-seam tools direct
// Wave 4 / PLS-35: one bounded native held-out L5 Campaign. A valid positive or negative
// matched result is terminal; infrastructure or evidence failure is not.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Agent } from '@deepseek-ai/dsh-agent';
import {
  loadPack,
  discoverSshSite,
  installPackMethod,
  nativeSessionMemoryEvidence,
  packDigestOf,
  readNativeSessionContext,
  saveDiscoveredSite,
  readArchivedMaterial,
  readRunAssets,
  runDelegations,
  currentRecordsIn,
  valueMeasurementReceipt,
  type CodeRecord,
  type DelegationRecord,
  type JobRecord,
  type LedgerRecord,
  type NodeRecord,
  type RunRecord,
} from '@hima/harness';
import { himaHomeSources, himaProfileDir, prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import {
  bootInProcess,
  createRootAgent,
  resumeTestAgent,
  toolCalls,
  type InProcessHost,
} from '../test/contract/support/boot-inprocess.ts';
import {
  himaCommand,
  modelCommandTimeoutMs,
  modelCompactionWithOneRetry,
} from '../test/contract/support/command.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const PACK_ID = 'custom-cell-fmax-dtco';
const EXPECTED_MODEL = 'deepseek-flash';
const FIRST_TIME_BOX_MS = 360 * 60_000;
const HARNESS_TIME_BOX_MS = 420 * 60_000;
const FIRST_RETRY_ALLOWANCE = 3;
const GENERATION_LIMIT = 4;
const ATTEMPT_LIMIT = 480;
const CLOSING_RESERVE_MS = 900_000;
const MAX_PRODUCT_REQUEST_STEPS = 1800;
const MAX_USER_TURNS = 240;
const SITE_NAME = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const SAFE_REMOTE_PATH = /^\/[A-Za-z0-9._/+*-]+$/;
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)))
    : item);

const routes = [
  'timing-criticality',
  'timing-context',
  'structure-frequency',
  'structure-compaction',
  'mapper-compatibility',
  'functional-diversity',
] as const;

const requiredReferenceNodes = [
  'bind-inputs',
  'evaluation-baseline',
  'read-evaluation-baseline',
  ...routes.flatMap((route) => [`mine-${route}`, `select-${route}`]),
  'merge-join',
  'research-candidates',
  'read-research-selection',
  'function-local-evaluation',
  'read-function-local-evaluation',
  'function-local-gate',
  'merge',
  'read-merge',
  'generate',
  'read-generate',
  'layout',
  'read-layout',
  'characterize',
  'read-characterize',
  'calibration-gate',
  'design-mapping-timing-evaluation',
  'read-design-mapping-timing-evaluation',
  'portfolio-gate',
  'freeze-cumulative-library',
  'read-cumulative-library',
  'compile',
  'read-compile',
  'foundry-synth',
  'read-foundry-synth',
  'custom-synth',
  'read-custom-synth',
  'adoption',
  'read-adoption',
  'adoption-gate',
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
  'candidate_count',
  'research_hypothesis_count',
  'selected_count',
  'generated_cell_count',
  'abstract_cell_count',
  'layout_refused_count',
  'predicted_cell_count',
  'lc_accepted',
  'library_visible',
  'adopted_instance_count',
  'adopted_candidate_count',
  'pnr_completed',
  'clock_tree_cell_count',
  'verification_error_count',
  'cell_checker_diagnostic_count',
  'comparison_valid',
  'full_constraint_failures',
  'matched_conditions',
  'foundry_setup_wns',
  'setup_wns_delta',
  'foundry_fmax_mhz',
  'generated_fmax_mhz',
  'fmax_delta_mhz',
  'fmax_improvement_pct',
  'fmax_improved',
  'retained_candidate_count',
  'theoretical_gain_upper_pct',
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
  heldOut: {
    designTop: string;
    source: string;
    selectionReason: string;
    sourceInventory: Array<{ path: string; sha256: string }>;
    sourceInventorySha256: string;
  };
}

type ArchiveRecord = Extract<LedgerRecord, { type: 'archive' }>;

interface PilotCheckpoint {
  schema: 4;
  status: 'positive-held-out-l5-passed-ready-for-release-review' | 'held-out-l5-terminal-negative';
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
  '  node scripts/live-check-dtco-pilot.ts --preflight-only --app <HimaHarness.app> --site-profile <private-site.json>',
  '  node scripts/live-check-dtco-pilot.ts --out <fresh-directory> --app <HimaHarness.app> --site-profile <private-site.json>',
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
const appFlags = rawArgs.flatMap((arg, index) => arg === '--app' ? [index] : []);
if (appFlags.length !== 1) throw new Error(usage);
const appIndex = appFlags[0]!;
const appArgument = rawArgs[appIndex + 1];
if (!appArgument || appArgument.startsWith('--')) throw new Error(usage);
const preflightOnly = rawArgs.includes('--preflight-only');
const forwardedArgs = rawArgs.filter((_arg, index) => index !== profileIndex && index !== profileIndex + 1
  && index !== appIndex && index !== appIndex + 1);
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
assert.match(profile.heldOut.designTop, /^[A-Za-z_][A-Za-z0-9_$]*$/, 'held-out top is invalid');
assert.ok(profile.heldOut.source.trim().length > 0, 'held-out source is required');
assert.ok(profile.heldOut.selectionReason.trim().length > 0, 'held-out selection reason is required');
assert.ok(profile.heldOut.sourceInventory.length > 0, 'held-out source inventory is empty');
assert.match(profile.heldOut.sourceInventorySha256, /^[0-9a-f]{64}$/, 'held-out inventory identity must be SHA-256');
for (const item of profile.heldOut.sourceInventory) {
  assert.match(item.path, SAFE_REMOTE_PATH, 'held-out RTL path is not a safe absolute path');
  assert.match(item.sha256, /^[0-9a-f]{64}$/, 'held-out RTL identity must be SHA-256');
}
for (const value of [profile.site.workspaceRoot, ...profile.site.allowedReadRoots, ...profile.site.allowedWriteRoots,
  ...Object.values(profile.site.bindings).filter((value) => value.startsWith('/'))]) {
  assert.match(value, SAFE_REMOTE_PATH, `unsafe Site path: ${value}`);
}
assert.deepEqual(Object.keys(profile.site.bindings).sort(), [
  'constraints', 'designRoot', 'designTop', 'foundryLibrary', 'physicalInputs', 'rtlGlob', 'toolStack', 'workspaceRoot',
].sort(), 'private Site profile must bind exactly the portable Pack inputs');
assert.equal(profile.site.bindings.designTop, profile.heldOut.designTop, 'held-out top differs from the Site binding');
const boundDesignRoot = profile.site.bindings.designRoot!;
const boundRtlGlob = profile.site.bindings.rtlGlob!;
assert.ok(profile.heldOut.sourceInventory.every(item => item.path.startsWith(`${boundDesignRoot}/`)),
  'every RTL identity must be inside the bound designRoot');
assert.ok(profile.heldOut.sourceInventory.every(item => boundRtlGlob === item.path
    || (boundRtlGlob.includes('*') && path.posix.dirname(item.path) === path.posix.dirname(boundRtlGlob))),
  'every RTL identity must belong to the bound RTL set');
assert.equal(profile.site.bindings.workspaceRoot, profile.site.workspaceRoot, 'Site and binding workspace roots differ');
assert.ok(profile.heldOut.sourceInventory.every(item => profile.site.allowedReadRoots.some((root) => item.path.startsWith(`${root}/`))),
  'held-out RTL is outside allowed read roots');
assert.ok(profile.site.allowedWriteRoots.includes(profile.site.workspaceRoot), 'Campaign workspace root is not writable');
assert.ok(profile.site.toolCommands.includes('eda'), 'Site discovery must probe the Pack-required eda command');
assert.ok(profile.site.allowedWrappers.includes('/usr/bin/python3') && profile.site.allowedWrappers.includes('/usr/local/bin/eda'),
  'portable Pack requires the exact Python and EDA wrappers');
assert.equal(profile.site.capacity.parallelJobs, 5, 'the L5 Site must expose the reviewed five-job cap');
for (const licence of ['Design-Compiler', 'Library-Compiler', 'Innovus']) {
  assert.equal(profile.site.capacity.licences[licence], 1, `the L5 Site must reserve one ${licence} seat`);
}

const app = realpathSync(path.resolve(appArgument));
assert.ok(lstatSync(app).isDirectory() && app.endsWith('.app'), 'Wave 4 App candidate must be one real .app directory');
const appRoot = realpathSync(path.join(app, 'Contents/Resources/app'));
const appManifestPath = realpathSync(path.join(path.dirname(app), 'trial-manifest.json'));
const appManifest = JSON.parse(readFileSync(appManifestPath, 'utf8')) as Record<string, any>;
assert.equal(appManifest.status, 'structurally-verified trial candidate', 'Wave 4 App candidate is not structurally verified');
assert.equal(appManifest.source?.dirty, false, 'Wave 4 App candidate was built from dirty source');
assert.match(appManifest.source?.sha ?? '', /^[0-9a-f]{40}$/, 'Wave 4 App candidate source SHA is invalid');
const changedProductInputs = execFileSync('git', ['diff', '--name-only', `${appManifest.source.sha}..HEAD`, '--',
  'packages', 'profiles', 'packs', 'package.json', 'pnpm-lock.yaml'], { cwd: repoRoot, encoding: 'utf8' }).trim();
assert.equal(changedProductInputs, '', 'Wave 4 App product inputs changed after this candidate was built');
const packSource = path.join(appRoot, 'packs', PACK_ID);
const sourcePack = loadPack(path.join(appRoot, 'packs'), PACK_ID);
const sourceDigest = packDigestOf(packSource);
assert.equal(sourcePack.contract.version, '5.2.20', 'Wave 4 requires the repaired sealed portable Pack');
assert.equal(sourcePack.contract.status, 'development', 'PLS-35 must preserve the Pack author-declared status');
assert.deepEqual(appManifest.runtimeInputs?.trialPack,
  { id: PACK_ID, version: sourcePack.contract.version, methodDigest: sourceDigest,
    testRun: 'run-f5047181-83cd-4d40-aae7-baaac2750eb0' },
  'Wave 4 App manifest differs from its bundled sealed Pack');

const declared = {
  app: { path: app, version: appManifest.version, artifactDigest: appManifest.artifactDigest,
    manifestSha256: sha256(readFileSync(appManifestPath)), sourceSha: appManifest.source.sha },
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
    heldOutDesignTop: profile.heldOut.designTop,
    heldOutSelectionReason: profile.heldOut.selectionReason,
    heldOutSourceFiles: profile.heldOut.sourceInventory.length,
    heldOutRtlSha256: profile.heldOut.sourceInventorySha256,
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
  const remoteInventoryText = execFileSync('ssh', [
    ...sshArguments,
    profile.site.ssh.destination,
    `sha256sum -- ${profile.heldOut.sourceInventory.map(item => item.path).join(' ')}`,
  ], { encoding: 'utf8', timeout: 30_000 }).trim();
  const remoteInventory = remoteInventoryText.split('\n').filter(Boolean).map(line => {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/); assert.ok(match, `invalid remote sha256sum row: ${line}`);
    return { path: match[2]!, sha256: match[1]! };
  }).sort((left, right) => left.path.localeCompare(right.path));
  const declaredInventory = [...profile.heldOut.sourceInventory].sort((left, right) => left.path.localeCompare(right.path));
  const remoteInventorySha256 = sha256(Buffer.from(canonical(remoteInventory)));
  check.require('held-out RTL inventory was re-read from the Site before the only L5 Campaign',
    canonical(remoteInventory) === canonical(declaredInventory)
      && remoteInventorySha256 === profile.heldOut.sourceInventorySha256,
    { source: profile.heldOut.source, designTop: profile.heldOut.designTop,
      selectionReason: profile.heldOut.selectionReason, sourceFiles: remoteInventory.length,
      rtlSha256: remoteInventorySha256 });

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
  await prepareHimaHome({ home: home.home, bundleMode: 'installed', sources: himaHomeSources(appRoot) });
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
  const guide = check.track(await createRootAgent(host.ctx, home.workspace));
  const guideId = String(guide.id);
  check.require('the independent Guide uses the configured DeepSeek-V4.1-Flash model',
    guide.options.model === EXPECTED_MODEL, guide.options);
  const owner = check.track(await createRootAgent(host.ctx, home.workspace));
  const ownerId = String(owner.id);
  check.require('the native owner uses the configured DeepSeek-V4.1-Flash model',
    owner.options.model === EXPECTED_MODEL,
    owner.options);
  check.observed.pilot = declared;
  check.observed.realEdaRequested = true;
  check.observed.guide = guideId;
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
    agent: guide,
    signal: AbortSignal.timeout(30_000),
  });
  const prepared = jsonOf(preparedResult);
  check.require('HimaGuide prepared a complete proposal without creating a Run',
    preparedResult.isError !== true && prepared.ready === true && prepared.pack?.id === PACK_ID
      && prepared.site?.name === profile.site.name && prepared.unknowns?.length === 0
      && ownedRuns().length === 0,
    { ready: prepared.ready, pack: prepared.pack?.id, site: prepared.site?.name,
      inputs: prepared.inputs, unknowns: prepared.unknowns, runs: ownedRuns().length });
  const confirmed = await host.ctx.hima.startRun({ proposalId: prepared.id, pack: PACK_ID, site: profile.site.name,
    goal: prepared.goal, strategy: prepared.strategy, ownerSessionId: ownerId, guideSessionId: guideId,
    notifyOwnerOnOpen: false, timeBoxMs: FIRST_TIME_BOX_MS, generationLimit: GENERATION_LIMIT,
    retryAllowance: FIRST_RETRY_ALLOWANCE });
  check.require('one confirmation created one Campaign and one persistent Run',
    confirmed.kind === 'ran' && typeof (confirmed.kind === 'ran' ? confirmed.run.id : undefined) === 'string'
      && ownedRuns().length === 1,
    { kind: confirmed.kind, runId: confirmed.kind === 'ran' ? confirmed.run.id : undefined,
      campaignId: confirmed.kind === 'ran' ? confirmed.run.campaignId : undefined,
      createdRuns: ownedRuns().map((run) => run.id) });
  if (confirmed.kind !== 'ran') throw new Error('Wave 4 Campaign was not created');
  check.require('Guide and Campaign owner are distinct durable sessions',
    guideId !== ownerId && confirmed.run.control?.guideSessionId === guideId && confirmed.run.control?.owner === ownerId,
    confirmed.run.control);

  // Wave 4 uses the actual owner session as the memory carrier.  The summary is deliberately
  // compacted before any Site work, then made stale by the current control record; it is never
  // treated as permission to continue the Campaign.
  await check.say(owner, [
    `This is a bounded recovery preflight for already-confirmed Run ${confirmed.run.id}.`,
    'Do not call tools, delegate, change the Run, or start work. Reply once that a saved summary is not control authority and that Run, Job, hold, budget, and adopted child facts must be re-read after recovery.',
    `Context padding: ${'The saved summary is not control authority. '.repeat(350)}`,
  ].join('\n'));
  const nativeBeforeCompact = await nativeSessionMemoryEvidence(host.ctx, { sessionId: ownerId, workspaceRef: home.workspace });
  const sessionSources = await host.ctx.hima.workMemory(ownerId, { action: 'sources' }) as any;
  const savedSessionMemory = await host.ctx.hima.workMemory(ownerId, { action: 'save', summary: {
    subject: 'Wave 4 owner preflight checkpoint',
    decisions: ['The owner must re-read live Run, Job, hold, budget, and delegation receipts after recovery.'],
    openQuestions: [],
    todo: ['Do not use this summary as authority to launch or repeat work.'],
    references: [],
    sources: [],
    nativeSources: sessionSources.nativeSources,
  } }) as any;
  check.require('the owner saved a native-session work-memory checkpoint before compaction',
    savedSessionMemory.kind === 'current' && savedSessionMemory.summary?.modelGenerated === false,
    savedSessionMemory);
  const compactionRecovery = await modelCompactionWithOneRetry(
    () => himaCommand(
      host, home.workspace, '/compact', modelCommandTimeoutMs, owner,
    ),
  );
  const { attempts: compactionAttempts, disposition: compactionDisposition } = compactionRecovery;
  const compact = compactionAttempts.at(-1)!;
  const preservedPrefix = await nativeSessionMemoryEvidence(host.ctx, {
    sessionId: ownerId,
    workspaceRef: home.workspace,
    throughSeq: nativeBeforeCompact.capturedThroughSeq,
  });
  const compactedOwnerContext = await readNativeSessionContext(host.ctx, { sessionId: ownerId, targetSessionId: ownerId });
  const staleSessionMemory = await host.ctx.hima.workMemory(ownerId, { action: 'read' }) as any;
  const publishedCompaction = /compacted-summary/.test(JSON.stringify(compactedOwnerContext.context));
  check.require('owner compaction publishes a summary after at most one closed summary-stage retry and preserves recovery authority',
    compactionDisposition === 'compacted'
      && preservedPrefix.transcriptIdentity === nativeBeforeCompact.transcriptIdentity
      && staleSessionMemory.kind === 'stale'
      && publishedCompaction,
    { compact, compactionAttempts, compactionDisposition, prefixIdentity: preservedPrefix.transcriptIdentity,
      context: compactedOwnerContext.context, staleSessionMemory });

  const campaignMemorySources = await host.ctx.hima.workMemory(ownerId, { action: 'sources', runId: confirmed.run.id }) as any;
  const savedCampaignMemory = await host.ctx.hima.workMemory(ownerId, { action: 'save', runId: confirmed.run.id, summary: {
    subject: 'Wave 4 Campaign before delegated review',
    decisions: ['No child candidate or saved summary can replace current owner/control authority.'],
    openQuestions: [],
    todo: ['Re-read current control and the exact adopted Reviewer receipt before Site work.'],
    references: campaignMemorySources.references,
    sources: campaignMemorySources.sources,
    nativeSources: [],
  } }) as any;
  let recoveryControl = host.ctx.hima.executionContext(confirmed.run.id).run.control!;
  const recoveryPause = await host.ctx.hima.executionAction({
    runId: confirmed.run.id,
    actor: guideId,
    origin: 'human',
    action: 'pause',
    requestId: 'wave4-memory-pause',
    expectedEpoch: recoveryControl.epoch,
    expectedRevision: recoveryControl.revision,
  });
  const staleCampaignMemory = await host.ctx.hima.workMemory(ownerId, { action: 'read', runId: confirmed.run.id }) as any;
  recoveryControl = host.ctx.hima.executionContext(confirmed.run.id).run.control!;
  const recoveryContinue = await host.ctx.hima.executionAction({
    runId: confirmed.run.id,
    actor: guideId,
    origin: 'human',
    action: 'continue',
    requestId: 'wave4-memory-continue',
    expectedEpoch: recoveryControl.epoch,
    expectedRevision: recoveryControl.revision,
  });
  check.require('Campaign work memory becomes stale on a newer human hold and recovery re-reads the live control receipt',
    savedCampaignMemory.kind === 'current'
      && recoveryPause.kind === 'accepted'
      && staleCampaignMemory.kind === 'stale'
      && /control changed/.test(String(staleCampaignMemory.reason))
      && recoveryContinue.kind === 'accepted',
    { savedCampaignMemory, pause: recoveryPause, staleCampaignMemory, continue: recoveryContinue });

  // The team is intentionally bounded to Pack-method review before the owner can launch a Site
  // Job.  Its candidate outputs become usable only through the recorded Reviewer adoption below.
  let delegationSequence = 0;
  const researchReadScope = path.join(home.workspace, 'delegations/wave4-pack-research');
  mkdirSync(researchReadScope, { recursive: true, mode: 0o700 });
  const researchTemplateSource = path.join(installedPack, 'flow/research-template.py');
  const researchTemplateCopy = path.join(researchReadScope, 'research-template.py');
  copyFileSync(researchTemplateSource, researchTemplateCopy);
  check.require('the Research child source scope contains the exact installed sealed method bytes',
    sha256(readFileSync(researchTemplateCopy)) === sha256(readFileSync(researchTemplateSource)),
    { source: researchTemplateSource, copy: researchTemplateCopy,
      sha256: sha256(readFileSync(researchTemplateCopy)) });
  const delegate = (body: Record<string, unknown>) => {
    const control = host.ctx.hima.executionContext(confirmed.run.id).run.control!;
    return host.ctx.hima.delegate({ runId: confirmed.run.id, actor: ownerId,
      expectedEpoch: control.epoch, expectedRevision: control.revision, ...body } as never, AbortSignal.timeout(90_000)) as Promise<any>;
  };
  const research = await delegate({ action: 'create', requestId: 'wave4-create-research', contract: {
    delegationId: 'wave4-pack-research', role: 'researcher',
    task: `Use the read tool to inspect exactly ${researchTemplateCopy}. Return a concise candidate note stating what the hash-equal sealed template permits and one limitation. Do not write, execute EDA, alter the Pack, or claim any value result.`,
    inputRefs: [], allowedTools: ['read'], readScope: { root: researchReadScope },
    budgetShare: { maxElapsedMs: 75_000, maxFollowups: 1, maxTokensPerTurn: 2200 },
    dependencyIds: [], recipient: { kind: 'run-owner', sessionId: ownerId },
  } });
  check.require('a bounded Research child was created with an effective read-only Pack-method tool grant',
    research.status === 'created' && research.effectiveContract?.tools.includes('read')
      && research.effectiveContract?.readScope?.root === researchReadScope
      && research.effectiveContract?.writeScope === undefined
      && typeof research.receipt?.childSessionId === 'string',
    research);
  if (research.status !== 'created' || typeof research.receipt?.childSessionId !== 'string') throw new Error('Wave 4 Research child is unavailable');
  const researchSessionId = research.receipt.childSessionId;
  const researchAgent = check.track(host.ctx.get('agents')!.get(researchSessionId as never)!);
  await check.wait(researchAgent.whenIdle());
  const researchEvents = researchAgent.session.snapshotEvents();
  const exactReadCall = researchEvents.find(event => {
    const data = event.data as { name?: unknown; callId?: unknown; arguments?: unknown } | undefined;
    if (event.type !== 'tool/call' || data?.name !== 'read' || typeof data.arguments !== 'string') return false;
    try { return (JSON.parse(data.arguments) as { file_path?: unknown }).file_path === researchTemplateCopy; }
    catch { return false; }
  });
  const exactReadCallId = (exactReadCall?.data as { callId?: unknown } | undefined)?.callId;
  const exactReadResult = researchEvents.find(event => {
    if (event.type !== 'tool/result' || typeof exactReadCallId !== 'string') return false;
    const content = (event.data as { message?: { content?: unknown } } | undefined)?.message?.content;
    return Array.isArray(content) && content.some(block => block && typeof block === 'object'
      && (block as { type?: unknown }).type === 'tool-result'
      && (block as { toolCallId?: unknown }).toolCallId === exactReadCallId
      && (block as { isError?: unknown }).isError !== true);
  });
  check.require('the Research child successfully read the exact hash-equal private copy before returning a candidate',
    exactReadCall !== undefined && exactReadResult !== undefined
      && sha256(readFileSync(researchTemplateCopy)) === sha256(readFileSync(researchTemplateSource)),
    { exactReadCall, exactReadResult, researchTemplateCopy,
      sha256: sha256(readFileSync(researchTemplateCopy)), events: researchEvents });
  const resultOf = async (delegationId: string, childSessionId: string) => {
    let result = await delegate({ action: 'result', requestId: `wave4-result-${delegationId}-${++delegationSequence}`, delegationId });
    if (result.status !== 'candidate') {
      const follow = await delegate({ action: 'followup', requestId: `wave4-finish-${delegationId}-${++delegationSequence}`,
        delegationId, text: 'Return one concise candidate result now from only the retained granted facts; keep every limitation explicit.' });
      check.require(`the ${delegationId} child received one bounded completion follow-up when needed`, follow.status === 'accepted', { result, follow });
      const resumed = host.ctx.get('agents')!.get(childSessionId as never); if (resumed) await check.wait(resumed.whenIdle());
      result = await delegate({ action: 'result', requestId: `wave4-result-${delegationId}-${++delegationSequence}`, delegationId });
    }
    return result;
  };
  const researchResult = await resultOf('wave4-pack-research', researchSessionId);
  check.require('the Research output remains candidate-only before owner adoption', researchResult.status === 'candidate', researchResult);
  const researchRecord = host.ctx.hima.ledger.records({ runId: confirmed.run.id }).findLast((record): record is DelegationRecord =>
    record.type === 'delegation' && record.delegationId === 'wave4-pack-research' && record.event === 'result-observed');
  assert.ok(researchRecord, 'Research candidate receipt is absent');

  const reviewer = await delegate({ action: 'create', requestId: 'wave4-create-reviewer', contract: {
    delegationId: 'wave4-independent-review', role: 'reviewer',
    task: 'Independently use hima_delegation_input to read the exact Research candidate receipt. Check that it names a sealed source, remains read-only, and makes no Fmax/value claim. Return a candidate review with any limitation; do not adopt it.',
    inputRefs: [researchRecord.id], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 75_000, maxFollowups: 1, maxTokensPerTurn: 2200 },
    dependencyIds: ['wave4-pack-research'], recipient: { kind: 'run-owner', sessionId: ownerId },
  } });
  check.require('an independent Reviewer child was created from the exact Research candidate receipt',
    reviewer.status === 'created' && reviewer.receipt?.childSessionId !== researchSessionId
      && reviewer.effectiveContract?.tools.includes('hima_delegation_input'), reviewer);
  if (reviewer.status !== 'created' || typeof reviewer.receipt?.childSessionId !== 'string') throw new Error('Wave 4 Reviewer child is unavailable');
  const reviewerSessionId = reviewer.receipt.childSessionId;
  const reviewerAgent = check.track(host.ctx.get('agents')!.get(reviewerSessionId as never)!);
  await check.wait(reviewerAgent.whenIdle());
  const reviewerResult = await resultOf('wave4-independent-review', reviewerSessionId);
  check.require('the independent Reviewer result remains candidate-only until explicit owner adoption', reviewerResult.status === 'candidate', reviewerResult);
  const reviewerRecord = host.ctx.hima.ledger.records({ runId: confirmed.run.id }).findLast((record): record is DelegationRecord =>
    record.type === 'delegation' && record.delegationId === 'wave4-independent-review' && record.event === 'result-observed');
  assert.ok(reviewerRecord, 'Reviewer candidate receipt is absent');
  const adoption = await delegate({ action: 'adopt', requestId: 'wave4-adopt-independent-review', delegationId: 'wave4-independent-review' });
  const team = runDelegations((host.ctx.hima as unknown as { deps(): any }).deps(), confirmed.run.id);
  const allocatedChildBudgetMs = team.reduce((sum, row) => sum + row.effective.budgetShare.maxElapsedMs, 0);
  const retainedChildTranscripts = await Promise.all(team.map(row => readNativeSessionContext(host.ctx, {
    sessionId: ownerId, targetSessionId: row.childSessionId, parentSessionId: ownerId,
  }, host.ctx.hima.ledger)));
  check.require('the persistent owner explicitly adopts the exact Reviewer candidate and the two-child team stays inside one Run budget',
    adoption.status === 'accepted' && adoption.resultRecordId === reviewerRecord.id
      && team.length === 2 && allocatedChildBudgetMs <= confirmed.run.budget!.timeBoxMs
      && retainedChildTranscripts.every(view => view.events.length > 0),
    { adoption, team, allocatedChildBudgetMs, parentBudgetMs: confirmed.run.budget?.timeBoxMs, retainedChildTranscripts });
  check.observed.collaboration = { research, researchResult, researchRecordId: researchRecord.id,
    reviewer, reviewerResult, reviewerRecordId: reviewerRecord.id, adoption, team, allocatedChildBudgetMs,
    parentBudgetMs: confirmed.run.budget?.timeBoxMs, retainedChildTranscripts };
  check.observed.workMemory = { savedSessionMemory, compact, compactionAttempts, compactionDisposition,
    staleSessionMemory, savedCampaignMemory,
    staleCampaignMemory, pause: recoveryPause.receipt, continue: recoveryContinue.receipt };
  await check.say(guide, `Inspect current Run ${confirmed.run.id} and its adopted child result. Explain the held-out source identity, distinct owner, current control state, unknown value result, and next admitted action. Do not execute, delegate, change ownership, or start another task.`);
  check.require('the independent Guide remains responsive and uses sourced read-only Hima context after team adoption',
    toolCalls(guide).some(call => ['hima_inspect', 'hima_context', 'hima_status'].includes(call.name))
      && host.ctx.hima.ledger.run(confirmed.run.id)?.control?.owner === ownerId,
    { calls: toolCalls(guide), owner: host.ctx.hima.ledger.run(confirmed.run.id)?.control?.owner });

  const firstPrompt = [
    `Execute only the already confirmed Campaign Run ${confirmed.run.id}.`,
    'You are the only execution owner. Use only hima_context and hima_execute for business actions. Do not start another Run, edit the method, use shell, open another Agent/model, or auto-drive the graph.',
    'At every Explore node, use the Pack recommendation and complete the recommendation exactly; do not invent a replacement numeric Strategy. Convergence is an evidence-backed ending, not a quota for extra samples. Never relax period above the 0.5 ns Goal merely to obtain another observation.',
    'Complete the full reference method from actual facts. Generation one mines the pressured DC graph. If the matched routed gain is below 5%, next-research revisits the same mining nodes; later generations mine the prior generated final routed netlist and its expanded reg2reg timing-path report, preserve the strongest actually adopted candidates, introduce new candidates into the remaining common-library slots, and repeat one DC/APR pair. Stop only at the 5% Goal, honest convergence, generation limit, budget, or a real blocker.',
    'At research-candidates use recommend. Read every compact research_<route> projection, probe, researchTemplate and full-mining-method.md; read a full raw/source artifact when a research question needs it. Copy the exact researchTemplate and implement only research(candidates, context). Candidates expose source_phase, current/remaining gain, per-path delay, timing-family coverage, endpoint families, Boolean interface/equivalence, occurrence, implementation route and prior adoption feedback. Use at least three collaborative lenses, including timing-graph family coverage and theoretical gain upper bounds. Fill min(context["max_new_cells"], len(candidates)); retained adopted Cells already occupy the other active-library slots. Order new selections best-first. Do not rank a method as winner or create method-specific EDA arms. Candidate ids may be deterministic tie breakers but must never be embedded. Write entry.py through hima_execute, run those exact recorded bytes, and preserve every failure and retry.',
    'Treat learned characterization as predicted, Site tool outputs as executed tool evidence, and post-route values as measured only where the readers say so. Never turn asked, derived, predicted, missing, failed, or unknown values into measurements or success.',
    'Keep setup, hold, route-DRC, connectivity and cell-checker diagnostic findings in the final analysis. comparison_valid proves matched final-database evidence, not physical signoff cleanliness; do not hide or rename disclosed physical findings.',
    'At next-research, record source-linked analysis with current record citations, limitations, and discriminating next experiments. The Pack research Goal remains 5%, so a smaller positive gain should continue while budget and convergence permit. The separate Wave 4 closure contract will classify the final valid comparison as PASS for any strictly positive Fmax change or TERMINAL_NEGATIVE for zero/negative change; do not rewrite either result.',
    'A node in retrying state has only recorded a failed attempt; Fabric does not launch a hidden automatic retry. Read the failed Job log once, diagnose it, and either begin one fresh admitted attempt or stop truthfully. Never poll the same completed failure while waiting for a nonexistent retry.',
    'The Pack reserves 15 minutes for closing, permits at most 480 attempts, four generations, and has a 6-hour Campaign limit. The enclosing live harness has 7 hours, 1800 product request steps and 240 user turns. These are upper limits, not a promise that the model or tools will finish.',
    'When a Job is asynchronous, yield and let its native tool notification report settlement. Continue from the current context only; never repeat a launch with a new request identity.',
  ].join('\n');
  let created = ownedRuns();
  check.require('the owner opened exactly one first Campaign', created.length === 1, created);
  const firstId = created[0]!.id;
  check.require('the confirmed Run identity is the only owner Run', firstId === confirmed.run.id, { firstId, confirmed: confirmed.run.id });
  const first = host.ctx.hima.ledger.run(firstId)!;
  check.require('the first Campaign admitted the exact Pack, Site, Goal, strategy, and approved budget',
    (first.purpose ?? 'campaign') === 'campaign'
      && first.packDigest === sourceDigest
      && first.goal?.target_period_ns === 0.5
      && first.goal?.target_fmax_improvement_pct === 5
      && first.firstStrategy?.periodNs === 0.5
      && first.firstStrategy?.algorithmRevision === 0
      && first.firstStrategy?.floorplanUtilization === 0.25
      && first.budget?.timeBoxMs === FIRST_TIME_BOX_MS
      && first.budget?.closingReserveMs === CLOSING_RESERVE_MS
      && first.budget?.attemptLimit === ATTEMPT_LIMIT
      && first.budget?.generationLimit === GENERATION_LIMIT
      && first.budget?.retryAllowance === FIRST_RETRY_ALLOWANCE
      && first.budget?.jobCap === 5
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
      'Act on ready nodes in the full current reference method, await native Job notifications, preserve failures and raw facts, record source-linked analysis at next-research, and finish/archive truthfully. At every Explore node use and complete the Pack recommendation exactly. Do not create a Run or change the method.',
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
  const baselineJobs = launchedJobs.filter((record) => record.nodeId === 'evaluation-baseline');
  const baselineObservation = firstRecords.findLast((record) => record.type === 'observation'
    && record.reader.id === 'read-evaluation-baseline');
  check.require('one held-out baseline mapping established the source-linked 0.5 ns research substrate',
    baselineJobs.length === 1 && baselineObservation?.type === 'observation'
      && baselineObservation.values.some(value => value.type === 'proxy_worst_reg2reg_delay_indicator')
      && firstRun.firstStrategy?.periodNs === 0.5,
    { baselineJobs: baselineJobs.map((job) => job.id), baselineObservation,
      firstStrategy: firstRun.firstStrategy, finalStrategy: firstRun.strategy });
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
  check.require('the held-out Campaign reached its final Judge and recorded the Pack decision before terminal settlement',
    finalJudge?.result !== undefined && finalDecision?.type === 'decision',
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
  const gainPct = comparisonValues.get('fmax_improvement_pct');
  const numericFoundryFmax = typeof foundryFmax === 'number' ? foundryFmax : Number.NaN;
  const numericGeneratedFmax = typeof generatedFmax === 'number' ? generatedFmax : Number.NaN;
  const numericGainPct = typeof gainPct === 'number' ? gainPct : Number.NaN;
  const validMatchedResult = comparison?.type === 'observation'
    && Number(comparisonValues.get('adopted_instance_count')) > 0
    && comparisonValues.get('pnr_completed') === 1
    && comparisonValues.get('comparison_valid') === 1
    && comparisonValues.get('matched_conditions') === 1
    && Number.isFinite(numericFoundryFmax) && Number.isFinite(numericGeneratedFmax)
    && Number.isFinite(numericGainPct);
  const positiveResult = validMatchedResult && numericGeneratedFmax > numericFoundryFmax && numericGainPct > 0;
  const terminalDisposition = positiveResult ? 'PASS' : 'TERMINAL_NEGATIVE';
  check.require('the final matched comparison proves completed routes, non-zero final-DB adoption and same-DB timing',
    validMatchedResult,
    { comparisonRecord: comparison?.id, adoptedInstances: comparisonValues.get('adopted_instance_count'),
      matchedConditions: comparisonValues.get('matched_conditions'), comparisonValid: comparisonValues.get('comparison_valid'),
      disclosedPhysicalFindings: comparisonValues.get('full_constraint_failures'), foundryFmax, generatedFmax,
      delta: comparisonValues.get('fmax_delta_mhz'), gainPct, terminalDisposition });
  check.require('the terminal disposition follows the frozen strictly-positive Wave 4 threshold without changing Pack facts',
    terminalDisposition === 'PASS'
      ? comparisonValues.get('fmax_improved') === 1 && numericGeneratedFmax > numericFoundryFmax
      : comparisonValues.get('fmax_improved') === 0 && numericGeneratedFmax <= numericFoundryFmax,
    { terminalDisposition, foundryFmax, generatedFmax, gainPct,
      packGoalOutcome: finalJudge?.result?.outcome, runStatus: firstRun.status });

  const codeRecords = firstRecords.filter((record): record is CodeRecord => record.type === 'code');
  const templateSha256 = sha256(readFileSync(path.join(packSource, 'flow/research-template.py')));
  const researchLaunch = launchedJobs.findLast((job) => job.nodeId === 'research-candidates' && job.workshop
    && firstRecords.some((record) => record.type === 'job' && record.event === 'finished' && record.exitCode === 0
      && record.job.session === job.job.session));
  const researchCode = codeRecords.findLast((code) => code.nodeId === 'research-candidates'
    && code.sessionId === ownerId && code.path === researchLaunch?.workshop?.entry.path
    && code.sha256 === researchLaunch?.workshop?.entry.sha256);
  check.require('the same model owner supplied one executed non-template cross-route research algorithm',
    researchLaunch?.workshop !== undefined && researchCode !== undefined && researchCode.sha256 !== templateSha256,
    { researchLaunch, researchCode, templateSha256 });
  check.require('the Campaign research algorithm is authored by the one persistent Run owner',
    researchCode?.sessionId === ownerId,
    { researchCode: researchCode?.id, sessionId: researchCode?.sessionId, ownerId });

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

  const selectorInputs = path.join(check.out, 'research-inputs');
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
  if (!researchCode || !researchLaunch?.workshop) throw new Error('AI research provenance is incomplete');
  const researchObservation = firstRecords.findLast(record => record.type === 'observation'
    && record.reader.id === 'read-ai-research-selection' && record.seq > researchLaunch.seq);
  const compactReads = routes.map((route) => firstRecords.findLast(record => record.type === 'knowledge'
    && record.origin === 'input' && record.file === `research_${route.replaceAll('-', '_')}`
    && record.nodeId === 'research-candidates' && record.sessionId === ownerId
    && (record.exposedBytes ?? 0) > 0 && record.seq < researchLaunch.seq));
  check.require('the research model read every compact route view before its recorded execution',
    researchObservation?.type === 'observation' && compactReads.every(record => record?.type === 'knowledge'),
    { researchObservation, compactReads });
  if (researchObservation?.type !== 'observation') throw new Error('AI research observation is incomplete');
  const codeFile = await copyHeldMaterial(researchCode, 'entry.py');
  const researchFile = await copyHeldMaterial(researchObservation, 'research.json');
  const auditSources: Record<string, { raw: string; rawSha256: string }> = {};
  for (const route of routes) {
    const suffix = route.replaceAll('-', '_');
    const raw = firstRecords.findLast(record => record.type === 'knowledge' && record.origin === 'input'
      && record.file === `raw_${suffix}` && record.nodeId === 'research-candidates' && record.seq < researchLaunch.seq);
    assert.ok(raw?.type === 'knowledge', `complete research raw input not retained for ${route}`);
    const rawFile = await copyHeldMaterial(raw, `${suffix}-raw.json`);
    auditSources[suffix] = { raw: rawFile, rawSha256: sha256(readFileSync(rawFile)) };
  }
  const selectorManifest = path.join(selectorInputs, 'manifest.json');
  const subsetEvidence = path.join(check.out, 'ai-research-audit.json');
  writeFileSync(selectorManifest, JSON.stringify({ code: codeFile, codeSha256: researchCode.sha256,
    research: researchFile, researchSha256: researchObservation.contentSha256,
    maxCells: 50, sources: auditSources }, null, 2) + '\n', { mode: 0o600 });
  const auditorFile = path.join(repoRoot, 'scripts/audit-dtco-ai-research.py');
  const auditorSha256 = sha256(readFileSync(auditorFile));
  execFileSync('/usr/bin/python3', [auditorFile,
    selectorManifest, subsetEvidence], { timeout: 30_000, maxBuffer: 1024 * 1024 });
  const subsetAudit = JSON.parse(readFileSync(subsetEvidence, 'utf8')) as { status?: string; auditorSha256?: string };
  check.require('the AI research audit identifies the exact launched auditor bytes',
    subsetAudit.auditorSha256 === auditorSha256 && sha256(readFileSync(auditorFile)) === auditorSha256,
    { expected: auditorSha256, reported: subsetAudit.auditorSha256 });
  check.require('the retained AI algorithm, hypotheses and selections are source-hash bound',
    subsetAudit.status === 'passed', subsetAudit);
  check.observed.researchAudit = { path: subsetEvidence, sha256: sha256(readFileSync(subsetEvidence)), auditorSha256,
    scope: 'retained code/source/selection check; no new model, EDA, optimality or PPA claim' };

  const firstManifestPath = firstArchive.manifestPath;
  const firstExperiencePath = path.join(firstArchive.directory, 'experience.md');
  const firstManifestSha256 = firstArchiveRecord?.type === 'archive' ? firstArchiveRecord.manifestSha256 : undefined;
  assert.ok(firstManifestSha256);
  const beforeRestart = sha256(Buffer.from(canonical(firstRecords)));
  await host.dispose();
  host = await bootInProcess(home);
  check.attach(host);
  check.observed.hostBoots = 2;
  const ownerResume = await resumeTestAgent(host.ctx, ownerId, {
    provider: owner.options.provider!,
    model: owner.options.model!,
  });
  check.trackResumed(ownerResume.agent);
  const resumedOwnerContext = await readNativeSessionContext(host.ctx, { sessionId: ownerId, targetSessionId: ownerId });
  const resumedOwnerPrefix = await nativeSessionMemoryEvidence(host.ctx, {
    sessionId: ownerId, workspaceRef: home.workspace, throughSeq: nativeBeforeCompact.capturedThroughSeq,
  });
  const restartedCampaignMemory = await host.ctx.hima.workMemory(ownerId, { action: 'read', runId: firstId }) as any;
  const restartedChildTranscripts = await Promise.all(team.map(row => readNativeSessionContext(host.ctx, {
    sessionId: ownerId, targetSessionId: row.childSessionId, parentSessionId: ownerId,
  }, host.ctx.hima.ledger)));
  check.require('reopened owner and child transcripts retain compaction while Work Memory re-reads terminal Run authority',
    /compacted-summary/.test(JSON.stringify(resumedOwnerContext.context))
      && resumedOwnerPrefix.transcriptIdentity === nativeBeforeCompact.transcriptIdentity
      && restartedCampaignMemory.kind === 'stale'
      && restartedCampaignMemory.authority?.[0]?.status === firstRun.status
      && restartedChildTranscripts.every(view => view.events.length > 0),
    { compactionDisposition, resumedOwnerPrefix: resumedOwnerPrefix.transcriptIdentity,
      resumedOwnerContext: resumedOwnerContext.context, restartedCampaignMemory, restartedChildTranscripts });
  check.observed.recovery = { resumedOwner: ownerId, resumedOwnerContext: resumedOwnerContext.context,
    resumedOwnerPrefix, compactionDisposition, restartedCampaignMemory, restartedChildTranscripts };
  const restartedFirst = host.ctx.hima.ledger.run(firstId);
  const restartedFirstRecords = host.ctx.hima.ledger.records({ runId: firstId });
  const restartedFirstArchive = await readRunAssets(experienceDeps(host, home), firstId);
  check.require('restart re-read preserves the first terminal Run, records, and archive identity',
    restartedFirst?.status === firstRun.status
      && sha256(Buffer.from(canonical(restartedFirstRecords))) === beforeRestart
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

  const dispositionStatus: PilotCheckpoint['status'] = terminalDisposition === 'PASS'
    ? 'positive-held-out-l5-passed-ready-for-release-review'
    : 'held-out-l5-terminal-negative';
  const measurement = valueMeasurementReceipt(firstRun, firstRecords);
  check.require('the final value receipt is bound to the terminal Run and keeps unavailable human/model usage unmeasured',
    measurement.final && measurement.runId === firstId && measurement.jobs.unsettledSessionIds.length === 0
      && measurement.model.requests.status === 'unmeasured'
      && measurement.human.businessDecisionTime.status === 'unmeasured',
    measurement);
  const checkpoint: PilotCheckpoint = {
    schema: 4,
    status: dispositionStatus,
    home: home.home,
    firstRun: firstId,
    firstOwner: ownerId,
    pack: { id: PACK_ID, version: sourcePack.contract.version, digest: sourceDigest },
    site: profile.site.name,
    goal: { target_period_ns: 0.5, target_fmax_improvement_pct: 5 },
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
    outcome: dispositionStatus,
    terminalDisposition,
    matchedResult: { foundryFmaxMhz: foundryFmax, generatedFmaxMhz: generatedFmax,
      deltaMhz: comparisonValues.get('fmax_delta_mhz'), gainPct,
      adoptedInstances: comparisonValues.get('adopted_instance_count') },
    valueMeasurement: measurement,
  };
});
