// L4 field acceptance for Issue #82. This file is selected explicitly only after the candidate is
// frozen and deployed; an ordinary live-site run skips it before making even a read-only SSH probe.
//
// The Host setup binds one standard-preset product Agent to one real ATCS Run. The test waits for the
// Pack's deterministic/autopilot prefix to reach fix-timing, then speaks to the owner as a user. The
// owner, rather than this file, forms the resident engineering goal/context and drives start, normal
// same-task follow-up, status, delivery, release and node completion through public Hima tools.
// No ECO answer, design object, native command sequence, result document or tool-call script lives here.
//
// Explicit invocation after the root coordinator's frozen-candidate GO:
//   HIMA_ISSUE82_LIVE=1 HIMA_LIVE_EVIDENCE_DIR=<absolute durable directory> \
//   DEEPSEEK_API_KEY=... node scripts/run-contract-tests.mjs live-site \
//     --files test/contract/resident-engineering.live.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { appendFile, cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadPack, packDigestExcludes, type LedgerRecord } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createPresetRootAgent, saidByModel, sayAsUser, toolCalls } from './support/boot-inprocess.ts';
import { freePort } from './support/boot-host.ts';
import { waitUntil } from './support/fabric.ts';
import { requireLiveSite } from './support/live-site.ts';
import { QUIET_TITLE_ROW } from './support/pipeline.ts';
import { homePatchFile } from '../../packages/desktop/src/hima-home.ts';

requireLiveSite();

const PACK_ID = 'agentic-timing-closure-system';
const PACK_VERSION = '0.3.0';
const SITE_NAME = 'linglong-atcs28';
const SITE_DIR = path.join(repoRoot, 'sites', SITE_NAME);
const DESTINATION = 'luzi@192.168.50.41';
const RUN_TIME_BOX_MS = 6 * 60 * 60_000;
const TEST_TIMEOUT_MS = 7 * 60 * 60_000;
const POLL_INTERVAL_MS = 5 * 60_000;
const MAX_OWNER_POLLS = 64;
const PRESET = 'standard';
const LIVE_SWITCH = 'HIMA_ISSUE82_LIVE';
const KEY_VARIABLE = 'DEEPSEEK_API_KEY';
const EVIDENCE_VARIABLE = 'HIMA_LIVE_EVIDENCE_DIR';

const remoteFiles = {
  capability: '/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-v1.json',
  wrapper: '/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/resident-engineering-wrapper.py',
  nativeContext: '/data/eda/project/hima_harness/atcs-inputs/nativeTimingContext-v1.json',
} as const;

const localFiles = {
  capability: path.join(SITE_DIR, 'engineering-capabilities-v1.json'),
  wrapper: path.join(SITE_DIR, 'templates/resident-engineering-wrapper.py'),
  nativeContext: path.join(SITE_DIR, 'inputs/nativeTimingContext-v1.json'),
} as const;

const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const terminal = (status: string): boolean => status.startsWith('ended-') || status === 'cancelled';
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function ssh(command: string, timeout = 120_000): { status: number | null; stdout: Buffer; stderr: string } {
  const ran = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=8', DESTINATION, command], { encoding: null, timeout, maxBuffer: 256 * 1024 * 1024 });
  return { status: ran.status, stdout: ran.stdout ?? Buffer.alloc(0), stderr: ran.stderr?.toString('utf8') ?? '' };
}

function remoteBytes(file: string, timeout = 120_000): Buffer {
  const read = ssh(`cat -- ${posixQuote(file)}`, timeout);
  assert.equal(read.status, 0, `could not read retained field evidence ${file}: ${read.stderr}`);
  return read.stdout;
}

function remoteText(file: string, timeout = 120_000): string {
  return remoteBytes(file, timeout).toString('utf8');
}

function probeReason(): string | false {
  if (process.env[LIVE_SWITCH] !== '1') return `${LIVE_SWITCH}=1 was not supplied; Issue #82 field acceptance was not selected and was not run`;
  if (!process.env[KEY_VARIABLE]?.trim()) return `${KEY_VARIABLE} is absent; the standard Hima owner is a real product model`;
  const evidenceBase = process.env[EVIDENCE_VARIABLE];
  if (!evidenceBase || !path.isAbsolute(evidenceBase)) return `${EVIDENCE_VARIABLE} must be an absolute durable output directory`;
  if (process.env.HIMA_TEST_TMPDIR && path.resolve(evidenceBase).startsWith(`${path.resolve(process.env.HIMA_TEST_TMPDIR)}${path.sep}`)) {
    return `${EVIDENCE_VARIABLE} must survive the test runner's temporary-directory cleanup`;
  }
  const reached = ssh('true', 20_000);
  return reached.status === 0 ? false : `production Site ${DESTINATION} is not reachable (ssh exited ${String(reached.status)})`;
}

type EngineeringCall = {
  readonly run?: unknown;
  readonly action?: unknown;
  readonly requestId?: unknown;
  readonly executionId?: unknown;
  readonly engineering?: { readonly operation?: unknown; readonly goal?: unknown; readonly context?: unknown; readonly message?: unknown };
};

const engineeringCalls = (owner: any): EngineeringCall[] => toolCalls(owner)
  .filter((call) => call.name === 'hima_execute' && call.args.action === 'engineering')
  .map((call) => call.args as EngineeringCall);

function assertNoBusyStatus(calls: readonly EngineeringCall[], turn: string): void {
  const statuses = calls.filter((call) => call.engineering?.operation === 'status');
  assert.ok(statuses.length <= 1,
    `${turn} busy-polled ${statuses.length} resident status snapshots instead of yielding: ${JSON.stringify(calls)}`);
}

function engineeringReceipts(host: any, runId: string): any[] {
  const run = host.ctx.hima.ledger.run(runId);
  return Object.values(run?.control?.requests ?? {}).map((request: any) => request.receipt)
    .filter((receipt: any) => receipt.action === 'engineering');
}

function operationStatus(host: any, runId: string, operation: string): any | undefined {
  return engineeringReceipts(host, runId).findLast((receipt) => receipt.data?.operation === operation)?.data;
}

function scrubText(text: string, key: string): string {
  return text.split(key).join('[REDACTED-DEEPSEEK-KEY]');
}

async function writeScrubbed(file: string, value: unknown, key: string): Promise<void> {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, scrubText(text, key));
}

test('Issue #82 field acceptance: one standard Hima owner delegates complete XTop engineering to one production OpenCode task and retains its honest result',
  { skip: probeReason(), timeout: TEST_TIMEOUT_MS }, async (t) => {
  const key = process.env[KEY_VARIABLE]!;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const evidenceDir = path.join(process.env[EVIDENCE_VARIABLE]!, `issue82-resident-${stamp}`);
  await mkdir(evidenceDir, { recursive: false });
  t.diagnostic(`durable Issue #82 field evidence: ${evidenceDir}`);

  const evidence: Record<string, unknown> = {
    schema: 'hima.issue82-resident-field-evidence/1',
    startedAt: new Date().toISOString(),
    acceptance: 'real standard Hima owner -> production Site resident wrapper -> OpenCode 1.18.34 -> XTop',
    outerRunTimeBoxMs: RUN_TIME_BOX_MS,
    scoring: 'repair effect only; elapsed time, model calls, and cost are recorded but do not decide the result',
    limitations: ['XTop result is not PrimeTime or final physical signoff', 'no Innovus, StarRC, or fresh PrimeTime is required by this route'],
  };

  // Frozen-candidate and Site preflight. These checks are read-only and precede every model/EDA effect.
  const source = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(source.status, 0, source.stderr);
  evidence.sourceCommit = source.stdout.trim();
  const sourceStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(sourceStatus.status, 0, sourceStatus.stderr);
  assert.equal(sourceStatus.stdout, '', `the field candidate is not frozen in a clean checkout:\n${sourceStatus.stdout}`);
  const expectedHashes = Object.fromEntries(Object.entries(localFiles).map(([name, file]) => [name, sha256(readFileSync(file))]));
  const remoteHashProbe = ssh(Object.entries(remoteFiles).map(([name, file]) =>
    `printf '${name} '; sha256sum -- ${posixQuote(file)}; stat -c '${name}-mode %a' -- ${posixQuote(file)}`).join('; '));
  assert.equal(remoteHashProbe.status, 0, `the frozen Site candidate is not deployed: ${remoteHashProbe.stderr}`);
  const remoteIdentity = remoteHashProbe.stdout.toString('utf8');
  for (const [name, digest] of Object.entries(expectedHashes)) {
    assert.match(remoteIdentity, new RegExp(`^${name} ${digest}  `, 'm'), `${name} is not the frozen local byte identity`);
  }
  assert.match(remoteIdentity, /^wrapper-mode 555$/m, 'the production resident wrapper is not mode 0555');
  evidence.deployedFiles = { local: localFiles, remote: remoteFiles, sha256: expectedHashes, probe: remoteIdentity.trim().split('\n') };

  const capability = JSON.parse(readFileSync(localFiles.capability, 'utf8'));
  assert.equal(capability.native.executable, '/home/luzi/.opencode/bin/opencode');
  assert.equal(capability.native.version, '1.18.34');
  assert.equal(capability.native.model, 'deepseek/deepseek-flash');
  assert.equal(capability.sandbox.image, '7d651dc8f1ab7d423b9d61be83fc3f5d608996ed7b91fa6588c3ed16daccfd54');
  const runtimeProbe = ssh([
    `${posixQuote(capability.native.executable)} --version`,
    `${posixQuote(capability.sandbox.executable)} image inspect --format '{{.Id}}' ${posixQuote(capability.sandbox.image)}`,
    `printf 'license-mode '; cat /data/eda/env/empyrean-license-mode`,
    `printf 'active-xtop-or-qualib\\n'; pgrep -af '[i]cexplorer-xtop_exe|[q]ualib_exe' || true`,
  ].join('; '));
  assert.equal(runtimeProbe.status, 0, runtimeProbe.stderr);
  const runtimeIdentity = runtimeProbe.stdout.toString('utf8');
  assert.match(runtimeIdentity, /^1\.18\.34$/m);
  assert.match(runtimeIdentity, /7d651dc8f1ab7d423b9d61be83fc3f5d608996ed7b91fa6588c3ed16daccfd54/);
  assert.match(runtimeIdentity, /^license-mode old$/m);
  const activeSection = runtimeIdentity.split('active-xtop-or-qualib\n')[1]?.trim() ?? '';
  assert.equal(activeSection, '', `another XTop or QuaLib client is active; no field Run was started:\n${activeSection}`);
  evidence.runtimePreflight = runtimeIdentity.trim().split('\n');

  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  const home = await createHimaHome();
  const packsDir = path.join(home.home, 'hima/packs');
  const sitesDir = path.join(home.home, 'hima/sites');
  await mkdir(packsDir, { recursive: true });
  await mkdir(sitesDir, { recursive: true });
  await cp(path.join(repoRoot, 'packs', PACK_ID), path.join(packsDir, PACK_ID), { recursive: true,
    filter: (sourcePath) => !sourcePath.includes('__pycache__') });
  await cp(path.join(SITE_DIR, 'site.yml'), path.join(sitesDir, `${SITE_NAME}.yml`));
  await cp(path.join(SITE_DIR, 'permit.yml'), path.join(sitesDir, 'permit.yml'));
  await appendFile(homePatchFile(home.home), QUIET_TITLE_ROW);
  await appendFile(homePatchFile(home.home), `\n- id: hima\n  config:\n    sitesDir: ${JSON.stringify(sitesDir)}\n    packsDir: ${JSON.stringify(packsDir)}\n    knowledgeDir: ${JSON.stringify(path.join(home.home, 'hima/knowledge/current'))}\n`);
  const homeOverlay = readFileSync(homePatchFile(home.home), 'utf8');
  assert.doesNotMatch(homeOverlay, /HimaHarness model stand-in|llm-replay|dsh-llm-replay/,
    'the field owner Home must retain the real DeepSeek provider rather than a replay overlay');

  const installedPack = loadPack(packsDir, PACK_ID);
  assert.equal(installedPack.contract.version, PACK_VERSION);
  evidence.pack = { id: installedPack.id, version: installedPack.contract.version,
    digest: installedPack.folder.digest(packDigestExcludes), status: installedPack.contract.status };
  const host = await bootInProcess(home, { withWebApp: true, webPort: await freePort() });
  let runId: string | undefined;
  let workspace: string | undefined;
  let liveOwner: any;
  let liveTaskId: string | undefined;
  let liveExecutionId: string | undefined;
  let liveTaskDir: string | undefined;
  let released = false;
  try {
    const selection = host.ctx.get('agentDefaultModel').currentSelection();
    assert.equal(selection.provider, 'deepseek-official', 'the product owner uses the official DeepSeek provider');
    assert.equal(selection.model, 'deepseek-flash', 'the product owner route remains DeepSeek 4.1 Flash');
    const owner = await createPresetRootAgent(host.ctx, home.workspace, PRESET);
    liveOwner = owner;
    const ownerId = String(owner.id);
    assert.equal(owner.session.header.agentPreset, PRESET);
    evidence.owner = { sessionId: ownerId, preset: owner.session.header.agentPreset, route: selection };

    const started = await host.ctx.hima.startRun({ pack: PACK_ID, site: SITE_NAME, ownerSessionId: ownerId,
      goal: { target_setup_wns_ns: 0, target_hold_wns_ns: 0 }, strategy: { nativeReportPaths: 10000 },
      timeBoxMs: RUN_TIME_BOX_MS, generationLimit: 1, retryAllowance: 3 } as never);
    assert.equal(started.kind, 'ran', JSON.stringify(started));
    if (started.kind !== 'ran') return;
    runId = started.run.id;
    workspace = started.workspace;
    evidence.run = { runId, campaignId: started.run.campaignId, workspace, site: SITE_NAME,
      packDigest: started.run.packDigest, goal: started.run.goal, strategy: started.run.strategy, budget: started.run.budget };
    await writeScrubbed(path.join(evidenceDir, 'evidence.partial.json'), evidence, key);

    await waitUntil('ATCS retained-input/common-R1/matched-AutoFix prefix reaches fix-timing', () => {
      const current = host.ctx.hima.ledger.run(runId!);
      const context = host.ctx.hima.executionContext(runId!);
      return context.available.includes('fix-timing') || terminal(current?.status ?? '') || current?.currentNode === 'wait-for-person';
    }, RUN_TIME_BOX_MS - 60 * 60_000, 2_000);
    const atEngineering = host.ctx.hima.executionContext(runId);
    assert.ok(atEngineering.available.includes('fix-timing'), JSON.stringify({ run: atEngineering.run,
      reason: atEngineering.reason, available: atEngineering.available }));

    const initialPrompt = [
      `Own and finish Hima Run ${runId}, which has reached the complete fix-timing engineering work in ${PACK_ID}@${PACK_VERSION} on the production ${SITE_NAME} Site.`,
      'Use the current Pack method, retained Run evidence and fixed Site identities as authority. Give the resident engineer the whole XTop timing-repair task, including enough goal and context to independently research the design, write and run its own analysis and repair code, measure alternatives, preserve or restore the best actual state, and deliver reproducible engineering material.',
      'The business result is the honest best actual setup/hold repair effect against the matched ordinary AutoFix from the same common R1. Keep design, constraints, libraries and scenarios fixed. A best-effort delivery with residual violations or a tie is valid when the evidence says so; do not turn it into a success claim. XTop evidence is not PrimeTime or final physical signoff.',
      'Keep ownership through normal communication with that same engineering task, verified delivery, resource release, and the Pack\'s honest bounded ending. Do not ask me for stepwise repair choices, and do not create a second task to replace uncertain work.',
    ].join('\n');
    await sayAsUser(owner, initialPrompt);

    let calls = engineeringCalls(owner);
    assertNoBusyStatus(calls, 'the initial owner turn');
    const starts = calls.filter((call) => call.engineering?.operation === 'start');
    const boundStarts = starts.filter((call) => typeof call.executionId === 'string');
    assert.equal(boundStarts.length, 1, `the real owner must effect exactly one execution-bound resident start: ${JSON.stringify(calls)}`);
    const ownerStart = boundStarts[0]!;
    assert.equal(ownerStart.run, runId);
    assert.equal(typeof ownerStart.executionId, 'string');
    assert.equal(typeof ownerStart.engineering?.goal, 'string');
    assert.equal(typeof ownerStart.engineering?.context, 'string');
    assert.ok(String(ownerStart.engineering?.goal).length >= 40, 'the owner formed a substantive engineering goal');
    assert.ok(String(ownerStart.engineering?.context).length >= 80, 'the owner formed substantive engineering context');
    const startReceipt = operationStatus(host, runId, 'start');
    assert.equal(startReceipt?.status, 'started', JSON.stringify(startReceipt));
    const taskId = startReceipt.taskId as string;
    const executionId = String(ownerStart.executionId);
    liveTaskId = taskId;
    liveExecutionId = executionId;
    evidence.residentTask = { taskId, executionId, start: startReceipt, ownerStart,
      unboundStartAttempts: starts.filter((call) => typeof call.executionId !== 'string') };

    const taskDir = path.posix.join(workspace, '.hima-engineering', taskId);
    liveTaskDir = taskDir;
    const taskEnvelope = JSON.parse(remoteText(path.posix.join(taskDir, 'task.json')));
    assert.equal(taskEnvelope.runId, runId);
    assert.equal(taskEnvelope.executionId, executionId);
    assert.equal(taskEnvelope.actor, ownerId);
    assert.deepEqual(taskEnvelope.inputs.map((item: any) => item.name),
      ['inputReadiness', 'baselineState', 'nativeContext', 'commonStage', 'autoFixReference']);
    assert.equal(taskEnvelope.knowledge.length, 3);
    assert.deepEqual(taskEnvelope.task.method, { id: PACK_ID, version: PACK_VERSION, digest: started.run.packDigest });
    evidence.taskEnvelope = taskEnvelope;

    const clarification = [
      'One priority clarification for the same engineering task: pursue any reasonable supported XTop technique that the actual evidence motivates, compare candidates on actual timing effect, and retain the best measured state even if the final Goal stays false.',
      'Please convey this as a normal follow-up in the existing task and continue owning that same Run. Do not start a replacement task and do not treat elapsed time, call count or cost as the result.',
    ].join('\n');
    const beforeClarification = calls.length;
    await sayAsUser(owner, clarification);
    calls = engineeringCalls(owner);
    assertNoBusyStatus(calls.slice(beforeClarification), 'the clarification owner turn');
    const messages = calls.filter((call) => call.engineering?.operation === 'message');
    assert.ok(messages.length >= 1, `the owner did not continue the same task by message: ${JSON.stringify(calls)}`);
    assert.ok(messages.every((call) => call.run === runId && call.executionId === executionId));
    evidence.ownerCallsAfterClarification = calls;
    evidence.engineeringReceiptsAfterClarification = engineeringReceipts(host, runId);
    await writeScrubbed(path.join(evidenceDir, 'evidence.partial.json'), evidence, key);

    for (let poll = 0; poll < MAX_OWNER_POLLS; poll += 1) {
      const current: any = host.ctx.hima.ledger.run(runId)!;
      const context = host.ctx.hima.executionContext(runId);
      const release = operationStatus(host, runId, 'release');
      if (release?.status === 'released'
          && (terminal(current.status) || current.currentNode === 'wait-for-person')) {
        released = true;
        break;
      }
      const receipts = engineeringReceipts(host, runId);
      const unknown = receipts.find((receipt) => receipt.data?.status === 'unknown' || receipt.state === 'uncertain');
      assert.equal(unknown, undefined, `an engineering effect is unknown; it is preserved and will not be replayed: ${JSON.stringify(unknown)}`);
      if (current.control?.stop?.status === 'uncertain') {
        assert.fail(`the Run controller has an uncertain stop and continuation is forbidden: ${JSON.stringify(current.control.stop)}`);
      }
      await delay(POLL_INTERVAL_MS);
      const beforeFollowup = engineeringCalls(owner).length;
      await sayAsUser(owner, [
        `Continue owning the same Hima Run ${runId} and its existing resident engineering task.`,
        'First inspect the durable Run and native task feedback. If work remains in progress, report that fact without starting replacement work. If a complete delivery is available, collect and verify it, release that same task, complete its node, and let the Pack reach its honest bounded result. If an operation is unknown, preserve it and report the uncertainty rather than replaying it.',
      ].join('\n'));
      assertNoBusyStatus(engineeringCalls(owner).slice(beforeFollowup), `owner follow-up ${poll + 1}`);
    }

    const finalRun = host.ctx.hima.ledger.run(runId)!;
    const finalContext = host.ctx.hima.executionContext(runId);
    const receipts = engineeringReceipts(host, runId);
    calls = engineeringCalls(owner);
    const operations = calls.map((call) => call.engineering?.operation).filter((operation): operation is string => typeof operation === 'string');
    for (const operation of ['start', 'message', 'status', 'delivery', 'release']) {
      assert.ok(operations.includes(operation), `the normal owner lifecycle never invoked engineering ${operation}: ${JSON.stringify(operations)}`);
    }
    const effectBoundCalls = calls.filter((call) => typeof call.executionId === 'string');
    assert.equal(effectBoundCalls.filter((call) => call.engineering?.operation === 'start').length, 1);
    const unboundNonStartCalls = calls.filter((call) => typeof call.executionId !== 'string'
      && call.engineering?.operation !== 'start');
    assert.deepEqual(unboundNonStartCalls, [],
      `only a malformed start may be unbound to an execution: ${JSON.stringify(unboundNonStartCalls)}`);
    assert.ok(effectBoundCalls.every((call) => call.run === runId && call.executionId === executionId),
      `every execution-bound resident operation must retain one Run/execution identity: ${JSON.stringify(calls)}`);
    const startEffects = receipts.filter((receipt) => receipt.data?.operation === 'start'
      && ['admitted', 'started', 'unknown'].includes(receipt.data?.status));
    assert.equal(startEffects.length, 1,
      `one and only one resident start effect may be admitted: ${JSON.stringify(receipts)}`);
    const delivery = operationStatus(host, runId, 'delivery');
    const release = operationStatus(host, runId, 'release');
    const acceptedMessageReceipts = receipts.filter((receipt) => receipt.data?.operation === 'message' && receipt.data?.status === 'accepted');
    assert.ok(acceptedMessageReceipts.length >= 1, `no same-task message has a durable accepted receipt: ${JSON.stringify(receipts)}`);
    assert.equal(delivery?.status, 'verified', JSON.stringify(delivery));
    assert.equal(release?.status, 'released', JSON.stringify(release));
    released = true;

    const resultPath = path.posix.join(workspace, 'state/engineering-result.json');
    const result = JSON.parse(remoteText(resultPath));
    assert.equal(result.schema, 'atcs.engineering-result/1');
    assert.equal(result.task.taskId, taskId);
    assert.equal(result.task.runId, runId);
    assert.equal(result.task.executionId, executionId);
    evidence.finishedAt = new Date().toISOString();
    evidence.outcome = {
      runStatus: finalRun.status, currentNode: finalRun.currentNode, contextReason: finalContext.reason,
      delivery, release, bestEffort: result.bestEffort, noOp: result.noOp, stopReason: result.stopReason,
      before: result.measurements?.before, after: result.measurements?.after,
      remaining: result.remaining, regressed: result.regressed, blocked: result.blocked, unknown: result.unknown,
    };
    evidence.ownerOperations = operations;
    evidence.engineeringReceipts = receipts;
    const effectComparisons = host.ctx.hima.ledger.records({ runId, type: 'observation' })
      .flatMap((record: any) => (record.values ?? []).filter((value: any) => value.type === 'tc_engineering_effect_vs_autofix')
        .map((value: any) => ({ recordId: record.id, reader: record.reader, value })));
    assert.ok(effectComparisons.length >= 1, 'the verified Reader emitted no resident-vs-matched-AutoFix effect comparison');
    evidence.effectComparison = effectComparisons.at(-1);
    const ownerEvents = (owner.session as any).snapshotEvents() as any[];
    const modelEvents = ownerEvents.filter((event) => event.type === 'assistant/message' && event.data?.usage !== undefined);
    assert.ok(modelEvents.length >= 1, 'the standard owner made at least one actual model request');
    evidence.ownerModelUsage = {
      requests: modelEvents.length,
      totals: modelEvents.reduce((sum: Record<string, number>, event: any) => {
        for (const [name, value] of Object.entries(event.data.usage ?? {})) {
          if (typeof value === 'number') sum[name] = (sum[name] ?? 0) + value;
        }
        return sum;
      }, {}),
    };

    const manifestPath = path.posix.join(taskDir, 'delivery/manifest.json');
    const manifest = JSON.parse(remoteText(manifestPath));
    assert.equal(manifest.taskId, taskId);
    assert.equal(manifest.runId, runId);
    assert.equal(manifest.executionId, executionId);
    evidence.deliveryManifest = manifest;

    const eventNamesRead = ssh(`find ${posixQuote(path.posix.join(taskDir, 'events'))} -maxdepth 1 -type f -printf '%f\\n' | sort`);
    assert.equal(eventNamesRead.status, 0, eventNamesRead.stderr);
    const wrapperEvents = eventNamesRead.stdout.toString('utf8').trim().split('\n').filter(Boolean)
      .map((name) => JSON.parse(remoteText(path.posix.join(taskDir, 'events', name))));
    const acceptedMessageIds = new Set(acceptedMessageReceipts.map((receipt) => receipt.requestId));
    const completedMessageEvents = wrapperEvents.filter((event) => event.kind === 'input'
      && event.status === 'completed' && acceptedMessageIds.has(event.requestId));
    assert.ok(completedMessageEvents.length >= 1,
      `the accepted same-task message has no separate retained completion event: ${JSON.stringify(wrapperEvents)}`);
    evidence.wrapperEvents = wrapperEvents;

    await writeScrubbed(path.join(evidenceDir, 'evidence.json'), evidence, key);
    await writeScrubbed(path.join(evidenceDir, 'owner-session.json'), ownerEvents, key);
    await writeScrubbed(path.join(evidenceDir, 'owner-visible-replies.json'), saidByModel(owner), key);
    await writeScrubbed(path.join(evidenceDir, 'run-ledger.json'), host.ctx.hima.ledger.records({ runId }) as LedgerRecord[], key);
    await writeScrubbed(path.join(evidenceDir, 'task-envelope.json'), taskEnvelope, key);
    await writeScrubbed(path.join(evidenceDir, 'delivery-manifest.json'), manifest, key);
    await writeScrubbed(path.join(evidenceDir, 'engineering-result.json'), result, key);
    for (const relative of ['state/common-stage.json', 'state/autofix-reference.json']) {
      await writeScrubbed(path.join(evidenceDir, relative), remoteText(path.posix.join(workspace, relative)), key);
    }
    await writeScrubbed(path.join(evidenceDir, 'opencode/session-events.jsonl'),
      remoteText(path.posix.join(taskDir, 'native/session-events.jsonl'), 10 * 60_000), key);
    await writeScrubbed(path.join(evidenceDir, 'opencode/stderr.log'),
      remoteText(path.posix.join(taskDir, 'native/stderr.log')), key);
    await writeScrubbed(path.join(evidenceDir, 'opencode/state.json'),
      remoteText(path.posix.join(taskDir, 'state.json')), key);

    for (const artifact of manifest.artifacts as { path: string; sha256: string; kind: string }[]) {
      assert.ok(!path.posix.isAbsolute(artifact.path) && !artifact.path.split('/').includes('..'), `unsafe artifact path ${artifact.path}`);
      const sourcePath = path.posix.join(taskDir, manifest.artifactRoot, artifact.path);
      const bytes = remoteBytes(sourcePath, 10 * 60_000);
      assert.equal(sha256(bytes), artifact.sha256, `retained artifact digest changed: ${artifact.path}`);
      assert.equal(bytes.includes(Buffer.from(key)), false, `delivery artifact unexpectedly contains the product API key: ${artifact.path}`);
      const destination = path.join(evidenceDir, 'delivery-artifacts', ...artifact.path.split('/'));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
    }

    const tree = ssh(`find ${posixQuote(workspace)} -xdev -type f -printf '%P\\t%s\\n' | sort`, 10 * 60_000);
    assert.equal(tree.status, 0, tree.stderr);
    await writeScrubbed(path.join(evidenceDir, 'remote-file-inventory.tsv'), tree.stdout.toString('utf8'), key);
    t.diagnostic(`Run ${runId} ended at ${finalRun.status}/${finalRun.currentNode}; resident outcome ${String(manifest.outcome)}; artifacts retained at ${workspace} and ${evidenceDir}`);
  } finally {
    if (runId) {
      evidence.finalSnapshot = {
        run: host.ctx.hima.ledger.run(runId),
        context: host.ctx.hima.executionContext(runId),
        records: host.ctx.hima.ledger.records({ runId }),
        ownerCalls: liveOwner === undefined ? [] : toolCalls(liveOwner),
        ownerReplies: liveOwner === undefined ? [] : saidByModel(liveOwner),
        ownerEvents: liveOwner?.session?.snapshotEvents?.() ?? [],
        resident: { taskId: liveTaskId, executionId: liveExecutionId, taskDir: liveTaskDir },
      };
      if (liveTaskDir && liveTaskId) {
        try { evidence.nativeStateBeforeCleanup = JSON.parse(remoteText(path.posix.join(liveTaskDir, 'state.json'))); }
        catch (error) { evidence.nativeStateBeforeCleanup = { unavailable: (error as Error).message }; }
      }
      await writeScrubbed(path.join(evidenceDir, 'evidence.partial.json'), evidence, key);
    }
    if (runId && !released) {
      const stopped = await host.ctx.hima.cancelRun(runId).catch((error: Error) => ({ status: 'uncertain', detail: error.message }));
      evidence.cleanup = { kind: 'single controller cancel of this test-owned Run only', result: stopped };
      await writeScrubbed(path.join(evidenceDir, 'evidence.partial.json'), evidence, key);
    }
    await host.dispose();
    await home.dispose();
  }
});
