// @hima-seam agent wrapped
// @hima-seam tools direct
// PLS-18: one native conversational owner performs the business work; this file audits facts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Agent } from '@deepseek-ai/dsh-agent';
import {
  loadPack,
  packDigestOf,
  packStage,
  readArchivedMaterial,
  readRunAssets,
  type CodeRecord,
  type JobRecord,
  type LedgerRecord,
  type NodeRecord,
  type RunRecord,
} from '@hima/harness';
import YAML from 'yaml';
import { himaProfileDir, prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';
import {
  bootInProcess,
  createRootAgent,
  readPersistedSession,
  toolCalls,
  toolResults,
  type InProcessHost,
} from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const PACK_ID = 'aes-tsmc28-dtco';
const SITE_ID = 'linglong-aes';
const EXPECTED_MODEL = 'deepseek-v4-flash';
const REMOTE_HOST = 'luzi@192.168.50.41';
const REMOTE_ROOT = '/data/eda/project/hima_harness/polishing-inputs';
const SSH_OPTIONS = ['BatchMode=yes', 'ConnectTimeout=8', 'ControlPath=none'] as const;
const FIRST_TIME_BOX_MS = 90 * 60_000;
const SECOND_TIME_BOX_MS = 5 * 60_000;
const HARNESS_TIME_BOX_MS = 100 * 60_000;
const FIRST_RETRY_ALLOWANCE = 2;
const GENERATION_LIMIT = 1;
const ATTEMPT_LIMIT = 120;
const CLOSING_RESERVE_MS = 60_000;
const MAX_PRODUCT_REQUEST_STEPS = 600;
const MAX_USER_TURNS = 120;
const DESTINATION_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;

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
] as const;

interface StagingManifest {
  schema: number;
  status: string;
  host: string;
  sshOptions: string[];
  sourceFlow: string;
  sourceInputs: string;
  destinationName: string;
  destination: string;
  files: Record<string, string>;
  inventorySha256: string;
}

type ArchiveRecord = Extract<LedgerRecord, { type: 'archive' }>;

interface PilotCheckpoint {
  schema: 1;
  status: 'first-campaign-passed-ready-for-ui';
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

const sameKeys = (left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): boolean =>
  JSON.stringify(Object.keys(left ?? {}).sort()) === JSON.stringify(Object.keys(right ?? {}).sort());

const rawArgs = process.argv.slice(2);
const usage = [
  'usage:',
  '  node scripts/live-check-dtco-pilot.ts --preflight-only --staging <staging.json>',
  '  node scripts/live-check-dtco-pilot.ts --out <fresh-directory> --staging <staging.json>',
  `    [--timeout-ms ${HARNESS_TIME_BOX_MS} --max-turns ${MAX_USER_TURNS} --max-steps ${MAX_PRODUCT_REQUEST_STEPS}]`,
  '  node scripts/live-check-dtco-pilot.ts --audit-followup <pilot-checkpoint.json> --out <fresh-directory>',
  '',
  'The live form requires DEEPSEEK_API_KEY in the inherited environment.',
].join('\n');

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  process.stdout.write(`${usage}\n`);
  process.exit(0);
}

async function auditUiFollowup(checkpointPath: string, outArgument: string): Promise<void> {
  const out = path.resolve(outArgument);
  if (existsSync(out)) throw new Error('the audit evidence directory already exists');
  mkdirSync(out, { recursive: true });
  let host: InProcessHost | undefined;
  try {
    const checkpointFile = realpathSync(path.resolve(checkpointPath));
    const checkpoint = JSON.parse(readFileSync(checkpointFile, 'utf8')) as PilotCheckpoint;
    assert.equal(checkpoint.schema, 1);
    assert.equal(checkpoint.status, 'first-campaign-passed-ready-for-ui');
    assert.equal(checkpoint.pack.id, PACK_ID);
    assert.equal(checkpoint.pack.version, '4');
    assert.equal(checkpoint.site, SITE_ID);
    assert.equal(packDigestOf(path.join(repoRoot, 'packs', PACK_ID)), checkpoint.pack.digest);
    const retainedRoot = realpathSync(path.join(repoRoot, '.hima-tmp/pilot-release/homes'));
    const retainedHome = realpathSync(checkpoint.home);
    assert.ok(retainedHome.startsWith(`${retainedRoot}${path.sep}`), 'checkpoint Home is outside the retained pilot root');
    const home: HimaHome = {
      home: retainedHome,
      profileDir: himaProfileDir(retainedHome),
      workspace: path.join(retainedHome, 'workspace'),
      env: {
        ...process.env,
        DSH_HOME: retainedHome,
        DSH_AGENTS_HOME: path.join(retainedHome, 'agents'),
        DSH_TELEMETRY_DISABLED: '1',
      },
      dispose: async () => undefined,
    };
    host = await bootInProcess(home);
    const first = host.ctx.hima.ledger.run(checkpoint.firstRun);
    assert.ok(first && isTerminal(first.status), 'first Campaign is absent or no longer terminal');
    assert.equal(first.packDigest, checkpoint.pack.digest);
    const firstRecords = host.ctx.hima.ledger.records({ runId: checkpoint.firstRun });
    assert.equal(sha256(Buffer.from(JSON.stringify(firstRecords))), checkpoint.recordsSha256);
    const firstArchive = await readRunAssets(experienceDeps(host, home), checkpoint.firstRun);
    assert.equal(firstArchive.kind, 'read', 'first archive is unreadable');
    if (firstArchive.kind !== 'read') throw new Error('first archive is unreadable');
    assert.equal(firstArchive.manifestPath, checkpoint.archive.manifest);
    assert.equal(sha256(readFileSync(firstArchive.manifestPath)), checkpoint.archive.manifestSha256);

    const matching = host.ctx.hima.ledger.runs().filter((run) =>
      run.id !== checkpoint.firstRun
        && run.packId === PACK_ID
        && run.siteId === SITE_ID
        && run.packDigest === checkpoint.pack.digest
        && Date.parse(run.createdAt) >= Date.parse(first.createdAt));
    assert.equal(matching.length, 1, 'expected exactly one UI-created history follow-up');
    const second = matching[0]!;
    assert.equal(second.status, 'cancelled');
    assert.ok(second.control?.owner, 'UI follow-up has no conversational owner');
    assert.ok(sameKeys(second.goal, first.goal));
    assert.deepEqual(second.goal, checkpoint.goal);
    assert.equal(second.budget?.timeBoxMs, SECOND_TIME_BOX_MS);
    assert.equal(second.budget?.generationLimit, GENERATION_LIMIT);
    assert.equal(second.budget?.closingReserveMs, CLOSING_RESERVE_MS);
    assert.equal(second.budget?.attemptLimit, ATTEMPT_LIMIT);
    const secondRecords = host.ctx.hima.ledger.records({ runId: second.id });
    assert.ok(!secondRecords.some((record) =>
      ['job', 'node', 'observation', 'verdict', 'code', 'growth', 'revision'].includes(record.type)),
    'history follow-up contains experiment work');
    assert.ok(secondRecords.some((record) => record.type === 'cancel'), 'history follow-up has no actual cancel record');
    assert.ok(Object.values(second.control.requests).every((request) => request.actor === second.control?.owner),
      'a second owner wrote a follow-up Run action');
    const analysis = secondRecords.findLast((record) => record.type === 'analysis');
    assert.ok(analysis?.type === 'analysis', 'history follow-up has no analysis');
    if (analysis?.type !== 'analysis') throw new Error('history follow-up has no analysis');
    const analysisText = JSON.stringify(analysis.analysis);
    assert.equal(analysis.sessionId, second.control.owner);
    assert.equal(analysis.analysis.claims.length, 0);
    assert.ok(analysis.analysis.limitations.length > 0 && analysis.analysis.nextExperiments.length > 0);
    assert.ok(analysisText.includes(checkpoint.firstRun));
    assert.ok(analysisText.includes(checkpoint.archive.manifestSha256));

    const persisted = await readPersistedSession(host.ctx, second.control.owner, (agent) => ({
      calls: toolCalls(agent),
      results: toolResults(agent),
    }));
    const calls = persisted.calls as Array<{ name?: string; args?: Record<string, unknown> }>;
    const manifestRead = calls.findIndex((call) => call.name === 'read'
      && (call.args?.file_path === checkpoint.archive.manifest || call.args?.path === checkpoint.archive.manifest));
    const experienceRead = calls.findIndex((call) => call.name === 'read'
      && (call.args?.file_path === checkpoint.archive.experience || call.args?.path === checkpoint.archive.experience));
    const pause = calls.findIndex((call) => call.name === 'hima_execute'
      && call.args?.run === second.id && call.args?.action === 'pause');
    const analyzed = calls.findIndex((call) => call.name === 'hima_execute'
      && call.args?.run === second.id && call.args?.action === 'analyze');
    const cancelled = calls.findIndex((call) => call.name === 'hima_execute'
      && call.args?.run === second.id && call.args?.action === 'cancel');
    assert.ok(manifestRead >= 0 && experienceRead >= 0, 'UI Agent did not read both source archive files');
    assert.equal(persisted.calls.length, persisted.results.length, 'persisted tool calls/results are not one-to-one');
    assert.ok(persisted.results[manifestRead]?.failed === false
      && persisted.results[manifestRead]?.text.includes(checkpoint.firstRun),
    'source manifest read did not return successful source bytes');
    assert.ok(persisted.results[experienceRead]?.failed === false
      && persisted.results[experienceRead]?.text.includes(checkpoint.firstRun),
    'source experience read did not return successful source bytes');
    assert.ok(pause >= 0
      && manifestRead > pause
      && experienceRead > pause
      && analyzed > manifestRead
      && analyzed > experienceRead
      && cancelled > analyzed,
      'UI Agent call order did not establish pause/read/analyze/cancel');
    const secondArchive = await readRunAssets(experienceDeps(host, home), second.id);
    assert.equal(secondArchive.kind, 'read', 'history follow-up archive is unreadable');
    if (secondArchive.kind !== 'read') throw new Error('history follow-up archive is unreadable');
    const secondArchiveRecord = completeArchiveRecord(secondRecords);
    assert.equal(secondArchiveRecord?.manifestSha256, sha256(readFileSync(secondArchive.manifestPath)));

    const beforeRestart = {
      first: sha256(Buffer.from(JSON.stringify(firstRecords))),
      second: sha256(Buffer.from(JSON.stringify(secondRecords))),
      firstManifest: completeArchiveRecord(firstRecords)?.manifestSha256,
      secondManifest: secondArchiveRecord?.manifestSha256,
    };
    await host.dispose();
    host = await bootInProcess(home);
    const restartedFirstRecords = host.ctx.hima.ledger.records({ runId: checkpoint.firstRun });
    const restartedSecondRecords = host.ctx.hima.ledger.records({ runId: second.id });
    assert.equal(sha256(Buffer.from(JSON.stringify(restartedFirstRecords))), beforeRestart.first);
    assert.equal(sha256(Buffer.from(JSON.stringify(restartedSecondRecords))), beforeRestart.second);
    assert.equal(completeArchiveRecord(restartedFirstRecords)?.manifestSha256, beforeRestart.firstManifest);
    assert.equal(completeArchiveRecord(restartedSecondRecords)?.manifestSha256, beforeRestart.secondManifest);
    const afterFirstArchive = await readRunAssets(experienceDeps(host, home), checkpoint.firstRun);
    assert.equal(afterFirstArchive.kind, 'read');
    assert.equal((await readRunAssets(experienceDeps(host, home), second.id)).kind, 'read');
    if (afterFirstArchive.kind !== 'read') throw new Error('first archive is unreadable after restart');
    assert.equal(sha256(readFileSync(afterFirstArchive.manifestPath)), checkpoint.archive.manifestSha256);
    assert.equal(packDigestOf(path.join(repoRoot, 'packs', PACK_ID)), checkpoint.pack.digest);
    assert.equal(packDigestOf(path.join(home.home, 'hima/packs', PACK_ID)), checkpoint.pack.digest);

    const evidence = {
      status: 'passed',
      scope: 'offline audit of the separate UI-created follow-up; zero model requests and zero EDA jobs',
      checkpoint: checkpointFile,
      home: retainedHome,
      firstRun: checkpoint.firstRun,
      secondRun: second.id,
      secondOwner: second.control.owner,
      historyReads: { manifest: checkpoint.archive.manifest, experience: checkpoint.archive.experience },
      actionOrder: { pause, manifestRead, experienceRead, analyzed, cancelled },
      successfulHistoryReadResults: {
        manifest: persisted.results[manifestRead]?.failed === false,
        experience: persisted.results[experienceRead]?.failed === false,
      },
      records: beforeRestart,
      sourceIdentityBeforeAfter: {
        methodDigest: checkpoint.pack.digest,
        firstManifestSha256: checkpoint.archive.manifestSha256,
      },
      restart: 'equal bytes and readable archives',
    };
    writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    writeFileSync(path.join(out, 'README.md'), '# PLS-18 UI follow-up audit\n\nPASS — the separate UI-owned history study read the first archive, recorded bounded no-claims analysis, launched zero Jobs, cancelled, archived, and survived restart with equal records.\n');
    process.stdout.write(`live-check-dtco-pilot audit: PASS; evidence ${out}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify({ status: 'failed', failure: message }, null, 2)}\n`);
    writeFileSync(path.join(out, 'README.md'), `# PLS-18 UI follow-up audit\n\nFAIL — ${message}\n`);
    throw error;
  } finally {
    await host?.dispose();
  }
}

const auditIndex = rawArgs.indexOf('--audit-followup');
if (auditIndex >= 0) {
  const checkpoint = rawArgs[auditIndex + 1];
  const outIndex = rawArgs.indexOf('--out');
  const out = outIndex < 0 ? undefined : rawArgs[outIndex + 1];
  if (!checkpoint || checkpoint.startsWith('--') || !out || out.startsWith('--')
      || rawArgs.length !== 4 || outIndex < 0) throw new Error(usage);
  await auditUiFollowup(checkpoint, out);
  process.exit(0);
}

const stagingFlags = rawArgs.flatMap((arg, index) => arg === '--staging' ? [index] : []);
if (stagingFlags.length !== 1) throw new Error(usage);
const stagingIndex = stagingFlags[0]!;
const stagingArgument = rawArgs[stagingIndex + 1];
if (!stagingArgument || stagingArgument.startsWith('--')) throw new Error(usage);
const preflightOnly = rawArgs.includes('--preflight-only');
const forwardedArgs = rawArgs.filter((_arg, index) => index !== stagingIndex && index !== stagingIndex + 1);
if (preflightOnly) {
  if (forwardedArgs.length !== 1 || forwardedArgs[0] !== '--preflight-only') throw new Error(usage);
} else if (forwardedArgs.includes('--preflight-only')) {
  throw new Error(usage);
} else {
  const outIndex = forwardedArgs.indexOf('--out');
  if (outIndex < 0 || !forwardedArgs[outIndex + 1] || forwardedArgs[outIndex + 1]!.startsWith('--')) throw new Error(usage);
}

const stagingPath = realpathSync(path.resolve(stagingArgument));
assert.ok(lstatSync(stagingPath).isFile() && !lstatSync(stagingPath).isSymbolicLink(), 'staging manifest must be a plain file');
const staging = JSON.parse(readFileSync(stagingPath, 'utf8')) as StagingManifest;
assert.ok(DESTINATION_NAME.test(staging.destinationName), 'staging destination name is invalid');

const preparationScript = path.join(repoRoot, 'scripts/prepare-dtco-pilot.py');
const localPreflight = JSON.parse(execFileSync('/usr/bin/python3', [
  preparationScript,
  '--preflight-only',
  '--destination',
  staging.destinationName,
], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000 })) as { manifest: StagingManifest };
assert.deepEqual(staging, localPreflight.manifest, 'staging manifest does not match the current fixed local inputs');

const packSource = path.join(repoRoot, 'packs', PACK_ID);
const siteSource = path.join(repoRoot, `sites/${SITE_ID}/site.yml`);
const sourcePack = loadPack(path.join(repoRoot, 'packs'), PACK_ID);
const sourceStage = packStage(packSource);
const sourceDigest = packDigestOf(packSource);
const sourceSite = YAML.parse(readFileSync(siteSource, 'utf8')) as Record<string, unknown>;
assert.equal(sourcePack.contract.version, '4', 'PLS-18 requires the reviewed v4 Pack');
assert.equal(sourceStage.stage, 'released', 'PLS-18 requires the sealed v4 release');
assert.equal(staging.host, REMOTE_HOST);
assert.deepEqual(staging.sshOptions, [...SSH_OPTIONS]);
assert.equal(staging.destination, `${REMOTE_ROOT}/${staging.destinationName}`);
assert.ok(Object.keys(staging.files).length > 1, 'staging inventory is empty');
assert.match(staging.inventorySha256, /^[0-9a-f]{64}$/);
assert.equal(sourceSite.kind, 'ssh');
assert.equal((sourceSite.ssh as { destination?: string } | undefined)?.destination, REMOTE_HOST);

const declared = {
  pack: {
    id: PACK_ID,
    version: sourcePack.contract.version,
    digest: sourceDigest,
    stage: sourceStage.stage,
  },
  staging: {
    path: stagingPath,
    sha256: sha256(readFileSync(stagingPath)),
    destination: staging.destination,
    fileCount: Object.keys(staging.files).length,
    inventorySha256: staging.inventorySha256,
  },
  approvedLimits: {
    firstCampaignMs: FIRST_TIME_BOX_MS,
    closingReserveMs: CLOSING_RESERVE_MS,
    generationLimit: GENERATION_LIMIT,
    retryAllowance: FIRST_RETRY_ALLOWANCE,
    attemptLimit: ATTEMPT_LIMIT,
    secondCampaignMaxMs: SECOND_TIME_BOX_MS,
    harnessWallMs: HARNESS_TIME_BOX_MS,
    maxProductRequestSteps: MAX_PRODUCT_REQUEST_STEPS,
    maxUserTurns: MAX_USER_TURNS,
  },
};

if (preflightOnly) {
  process.stdout.write(`${JSON.stringify({
    status: 'preflight-passed',
    scope: 'static local inspection only; no SSH, Host, model, EDA, or desktop',
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
    if (host.ctx.hima.executionContext(runId).executions.some((execution) => execution.phase === 'working')) continue;
    await check.say(owner, prompt);
  }
  throw new Error(`continuation budget exhausted before Run ${runId} reached a terminal state`);
}

function completeArchiveRecord(records: LedgerRecord[]): ArchiveRecord | undefined {
  return records.findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'complete');
}

await runLive('live-check-dtco-pilot', MAX_USER_TURNS, async (check: LiveCheck) => {
  const remoteVerification = JSON.parse(execFileSync('/usr/bin/python3', [
    preparationScript,
    '--verify-only',
    '--manifest',
    stagingPath,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 180_000 })) as Record<string, unknown>;
  check.require('staged source was re-inventoried locally and remotely before live work',
    remoteVerification.status === 'verified'
      && remoteVerification.destination === staging.destination
      && remoteVerification.inventorySha256 === staging.inventorySha256,
    remoteVerification);

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
  cpSync(packSource, installedPack, { recursive: true });
  const sites = path.join(home.home, 'hima/sites');
  mkdirSync(sites, { recursive: true });
  const liveSite = {
    ...sourceSite,
    bindings: {
      ...(sourceSite.bindings as Record<string, unknown>),
      flowRoot: staging.destination,
    },
    capacity: {
      cores: 8,
      memoryGiB: 16,
      parallelJobs: 1,
      licences: {
        'Design-Compiler': 1,
        'Library-Compiler': 1,
        Innovus: 1,
      },
    },
  };
  writeFileSync(path.join(sites, `${SITE_ID}.yml`), YAML.stringify(liveSite));
  cpSync(path.join(repoRoot, `sites/${SITE_ID}/permit.yml`), path.join(sites, 'permit.yml'));
  writeFileSync(homePatchFile(home.home), '- id: session-title-llm\n  disabled: true\n');

  process.chdir(home.workspace);
  let host = await bootInProcess(home);
  check.attach(host);
  const bundle = realpathSync(path.join(home.profileDir, 'node_modules/@hima/harness'));
  guardInstalled(check, host, [bundle, packsDirOf(home), home.workspace], installedPack);
  host.ctx.tools.guard((execution) => {
    if (execution.name === 'write' || execution.name === 'edit') {
      return 'PLS-18 writes generated research code only through controlled hima_execute write';
    }
    if (['hima_author', 'hima_pack_release'].includes(execution.name)) {
      return 'PLS-18 uses the fixed installed release and does not author or publish a method';
    }
    return undefined;
  });

  const initialRunIds = new Set(host.ctx.hima.ledger.runs().map((run) => run.id));
  const owner = check.track(await createRootAgent(host.ctx, home.workspace));
  const ownerId = String(owner.id);
  check.require('the native owner uses the configured DeepSeek V4 Flash model',
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
      && run.siteId === SITE_ID
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

  const firstPrompt = [
    `/hima-run ${PACK_ID} on ${SITE_ID} with Goal target_period_ns=0.5, strategy periodNs=0.5 algorithmRevision=0, generations=1, retries=2, timeBox=90.`,
    'You are the only execution owner. Use only hima_context and hima_execute for business actions. Do not start another Run, edit the method, use shell, open another Agent/model, or auto-drive the graph.',
    'Complete the full reference method from actual facts: the probe loop; all six mining branches and all six selection Workshops; merge; generate; layout; predicted characterization; Library Compiler; foundry and custom Design Compiler; adoption; paired foundry/generated PNR; verification; comparison; final Judge; and next-research.',
    'For each selection Workshop use recommend, read every declared route/raw/source input and current Pack knowledge, then write a self-contained data-dependent entry.py through hima_execute. Run those exact recorded bytes and preserve all failures and retries.',
    'Treat learned characterization as predicted, Site tool outputs as executed tool evidence, and post-route values as measured only where the readers say so. Never turn asked, derived, predicted, missing, failed, or unknown values into measurements or success.',
    'At next-research add exactly one optional growth proposal named independent-comparison-review. Use review-comparison (act observes record_compare) then review-verdict (judge rules full-evidence-valid and clock-period-at-most with target_period_ns bound from Goal); route every PASS/FAIL/UNDETERMINED result back to next-research. Set requiredOutputs=[record_compare], returnNode=next-research, impactNodes=[next-research], and explain that the expected change is an independent consistency re-read. Omit method, parent, inputThroughSeq and explicit input hashes so Harness binds current identities. Execute both nodes and record returned growth evidence. This is not a new PNR experiment.',
    'After the branch returns, call hima_execute analyze on next-research with current-record citations, limitations, and discriminating next experiments. Then complete next-research truthfully. Goal-met requires both final rules to PASS. If physical constraints fail, submit the declared next strategy and let the one-generation bound produce an evidence-backed negative/budget ending. Do not cancel a complete negative merely to rename it.',
    'The Pack reserves 60 seconds for closing and permits at most 120 attempts. The first Campaign has a 90-minute total limit; the enclosing live harness has 100 minutes, 600 product request steps and 120 user turns. These are upper limits, not a promise that the model or tools will finish.',
    'When a Job is asynchronous, yield and let its native tool notification report settlement. Continue from the current context only; never repeat a launch with a new request identity.',
  ].join('\n');
  await check.say(owner, firstPrompt);

  let created = ownedRuns();
  check.require('the owner opened exactly one first Campaign', created.length === 1, created);
  const firstId = created[0]!.id;
  const first = host.ctx.hima.ledger.run(firstId)!;
  check.require('the first Campaign admitted the exact Pack, Site, Goal, strategy, and approved budget',
    (first.purpose ?? 'campaign') === 'campaign'
      && first.packDigest === sourceDigest
      && first.goal?.target_period_ns === 0.5
      && first.firstStrategy?.periodNs === 0.5
      && first.firstStrategy?.algorithmRevision === 0
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

  const endedFirst = await continueUntilTerminal(
    check,
    host,
    owner,
    firstId,
    [
      `Continue only existing Run ${firstId} from the latest public context.`,
      'Act on ready nodes in the full reference method, await native Job notifications, preserve failures and raw facts, complete the independent comparison growth branch, record source-linked analysis, and finish/archive truthfully. Do not create a Run or change the method.',
    ].join('\n'),
    100,
  );
  check.require('the first Campaign reached a terminal state', isTerminal(endedFirst?.status), endedFirst ?? null);

  const firstRun = host.ctx.hima.ledger.run(firstId)!;
  const firstContext = host.ctx.hima.executionContext(firstId);
  const firstRecords = host.ctx.hima.ledger.records({ runId: firstId });
  const doneNodes = new Set(firstRecords
    .filter((record): record is NodeRecord => record.type === 'node' && record.state === 'done')
    .map((record) => record.nodeId));
  const missingNodes = requiredReferenceNodes.filter((node) => !doneNodes.has(node));
  check.require('the first Campaign completed every required reference stage', missingNodes.length === 0, { missingNodes, doneNodes: [...doneNodes] });

  const unsettledExecutions = firstContext.executions.filter((execution) =>
    execution.phase === 'begun' || execution.phase === 'working' || execution.phase === 'ready' || execution.phase === 'uncertain');
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
  const boundedNegativeEnding = firstRun.status === 'ended-budget-exhausted'
    && finalJudge?.result?.outcome === 'FAIL'
    && finalDecision?.type === 'decision'
    && 'strategy' in finalDecision.chosen;
  check.require('the first ending is a complete supported result rather than an arbitrary terminal status',
    positiveEnding || boundedNegativeEnding,
    { status: firstRun.status, finalJudge, finalDecision });

  const growth = firstRecords.filter((record) => record.type === 'growth');
  const proposedGrowth = growth.find((record) => record.event === 'proposed' && record.proposalId === 'independent-comparison-review');
  const returnedGrowth = growth.findLast((record) => record.event === 'returned' && record.proposalId === 'independent-comparison-review');
  const proposal = proposedGrowth?.type === 'growth' ? proposedGrowth.proposal as {
    nodes?: Array<{ id?: string }>;
    returnNode?: string;
    requiredOutputs?: string[];
    optional?: boolean;
  } | undefined : undefined;
  const proposalNodes = new Set(proposal?.nodes?.map((node) => node.id));
  check.require('one optional comparison/Judge growth branch returned to next-research with evidence',
    proposal?.returnNode === 'next-research'
      && proposal?.optional === true
      && proposal?.requiredOutputs?.includes('record_compare') === true
      && proposalNodes.has('review-comparison')
      && proposalNodes.has('review-verdict')
      && doneNodes.has('review-comparison')
      && doneNodes.has('review-verdict')
      && (returnedGrowth?.evidence?.length ?? 0) >= 3,
    growth);

  const returnedSeq = returnedGrowth?.seq ?? Number.MAX_SAFE_INTEGER;
  const firstAnalysis = firstRecords.findLast((record) => record.type === 'analysis'
    && record.nodeId === 'next-research'
    && record.sessionId === ownerId
    && record.seq > returnedSeq);
  check.require('the owner recorded bounded source-linked analysis after the growth return',
    firstAnalysis?.type === 'analysis'
      && firstAnalysis.analysis.claims.length > 0
      && firstAnalysis.analysis.limitations.length > 0
      && firstAnalysis.analysis.nextExperiments.length > 0,
    firstRecords.filter((record) => record.type === 'analysis'));

  const valueTypes = new Set(firstRecords.flatMap((record) => record.type === 'observation'
    ? record.values.map((value) => value.type)
    : []));
  const missingValueTypes = requiredValueTypes.filter((type) => !valueTypes.has(type));
  check.require('the archived result keeps distinct probe, predicted, adoption, verification, and matched physical facts',
    missingValueTypes.length === 0,
    { missingValueTypes, valueTypes: [...valueTypes] });

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

  const firstManifestPath = firstArchive.manifestPath;
  const firstExperiencePath = path.join(firstArchive.directory, 'experience.json');
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
    schema: 1,
    status: 'first-campaign-passed-ready-for-ui',
    home: home.home,
    firstRun: firstId,
    firstOwner: ownerId,
    pack: { id: PACK_ID, version: sourcePack.contract.version, digest: sourceDigest },
    site: SITE_ID,
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
    outcome: 'first-campaign-passed-ready-for-ui; PLS-18/PLS-26 final acceptance remains pending',
  };
});
