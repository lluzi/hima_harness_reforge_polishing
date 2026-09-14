// @hima-seam agent wrapped
// @hima-seam tools direct
// PLS-18: compose the completed formal L5 negative with the separate actual-model L4 growth proof.
// This auditor is offline: it reads one terminal retained Home, never advances a Run, and forbids model requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  currentRecordsIn,
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
import { himaProfileDir } from '../packages/desktop/src/hima-home.ts';
import {
  bootInProcess,
  readPersistedSession,
  toolCalls,
  toolResults,
  type InProcessHost,
} from '../test/contract/support/boot-inprocess.ts';
import { repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { sha256 } from './live-check-workshop.ts';

const PACK_ID = 'aes-tsmc28-dtco';
const PACK_VERSION = '5';
const SITE_ID = 'linglong-aes';
const EXPECTED_MODEL = 'deepseek-v4-flash';
const RUN_ID = 'run-6077b417-daf5-4db3-a1f4-72420fc5d15d';
const FIRST_TIME_BOX_MS = 90 * 60_000;
const CLOSING_RESERVE_MS = 60_000;
const FIRST_RETRY_ALLOWANCE = 2;
const GENERATION_LIMIT = 1;
const ATTEMPT_LIMIT = 120;

const routes = [
  'timing-criticality',
  'timing-context',
  'structure-frequency',
  'structure-compaction',
  'mapper-compatibility',
  'functional-diversity',
] as const;

const requiredReferenceNodes = [
  'probe', 'synthesize', 'read-probe', 'judge', 'next-period', 'mine-start',
  ...routes.flatMap((route) => [`mine-${route}`, `select-${route}`, `read-select-${route}`]),
  'merge-join', 'merge', 'read-merge', 'generate', 'read-generate', 'layout', 'read-layout',
  'characterize', 'read-characterize', 'compile', 'read-compile', 'foundry-synth',
  'read-foundry-synth', 'custom-synth', 'read-custom-synth', 'adoption', 'read-adoption',
  'pnr-foundry', 'read-pnr-foundry', 'pnr-generated', 'read-pnr-generated', 'verify',
  'read-verify', 'compare', 'read-compare', 'final-judge', 'next-research',
] as const;

const requiredValueTypes = [
  'clock_period', 'setup_wns', 'cell_area', 'candidate_count', 'selected_count',
  'generated_cell_count', 'abstract_cell_count', 'predicted_cell_count', 'lc_accepted',
  'library_visible', 'adopted_instance_count', 'pnr_completed', 'verification_error_count',
  'full_constraint_failures', 'matched_conditions', 'foundry_setup_wns', 'setup_wns_delta',
] as const;

type ArchiveRecord = Extract<LedgerRecord, { type: 'archive' }>;
type KnowledgeRecord = Extract<LedgerRecord, { type: 'knowledge' }>;

interface OriginalEvidence {
  check?: string;
  status?: string;
  passed?: boolean;
  failure?: string;
  checks?: Array<{ claim?: string; passed?: boolean }>;
  observed?: { persistentHome?: string; owner?: string };
  runs?: Array<{ run?: RunRecord; records?: LedgerRecord[] }>;
  agents?: Array<{
    id?: string;
    session?: string;
    options?: { provider?: string; model?: string };
    toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
    toolResults?: Array<{ failed: boolean; text: string }>;
  }>;
  toolSequence?: Array<{
    name?: string;
    agent?: string;
    args?: Record<string, unknown>;
    result?: { content?: Array<{ type?: string; text?: string }> };
  }>;
}

interface GrowthEvidence {
  check?: string;
  status?: string;
  passed?: boolean;
  checks?: Array<{ claim?: string; passed?: boolean }>;
  costs?: { modelSessions?: number; modelRequestSteps?: number };
  observed?: { readyParentCheck?: boolean; realEdaRequested?: boolean; runId?: string };
  runs?: Array<{ run?: RunRecord; records?: LedgerRecord[] }>;
  agents?: Array<{ id?: string; options?: { model?: string } }>;
  toolSequence?: Array<{
    name?: string;
    args?: { run?: string; action?: string; executionId?: string };
    result?: { content?: Array<{ type?: string; text?: string }> };
  }>;
}

const usage = 'usage: node scripts/audit-completed-dtco-pilot.ts --audit-completed <original-evidence.json> --growth-evidence <l4-evidence.json> --out <fresh-directory>';

function requiredArgument(args: string[], flag: string): string {
  const indexes = args.flatMap((arg, index) => arg === flag ? [index] : []);
  assert.equal(indexes.length, 1, usage);
  const value = args[indexes[0]! + 1];
  assert.ok(value && !value.startsWith('--'), `${flag} requires a path`);
  return value;
}

function completeArchiveRecord(records: LedgerRecord[]): ArchiveRecord | undefined {
  return records.findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'complete');
}

function experienceDeps(host: InProcessHost, home: HimaHome) {
  return {
    ledger: host.ctx.hima.ledger,
    packsDir: path.join(home.home, 'hima/packs'),
    sitesDir: path.join(home.home, 'hima/sites'),
  };
}

function parsedRefusal(text: string | undefined): { kind?: string; reason?: string } | undefined {
  if (!text) return undefined;
  try { return JSON.parse(text) as { kind?: string; reason?: string }; } catch { return undefined; }
}

function parsedToolResult(entry: NonNullable<OriginalEvidence['toolSequence']>[number]): {
  kind?: string;
  receipt?: { action?: string; executionId?: string; data?: { sha256?: string; path?: string } };
  existing?: { receipt?: { action?: string; executionId?: string; data?: { sha256?: string; path?: string } } };
} | undefined {
  const text = entry.result?.content?.find((item) => item.type === 'text')?.text;
  if (!text) return undefined;
  try {
    return JSON.parse(text) as {
      kind?: string;
      receipt?: { action?: string; executionId?: string; data?: { sha256?: string; path?: string } };
      existing?: { receipt?: { action?: string; executionId?: string; data?: { sha256?: string; path?: string } } };
    };
  } catch { return undefined; }
}

function acceptedReceipt(entry: NonNullable<OriginalEvidence['toolSequence']>[number]) {
  const result = parsedToolResult(entry);
  if (result?.kind !== 'accepted' && result?.kind !== 'duplicate') return undefined;
  return result.receipt ?? result.existing?.receipt;
}

function stringsAtKey(value: unknown, key: string, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) stringsAtKey(item, key, found);
  } else if (value !== null && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) {
      if (name === key && typeof item === 'string') found.add(item);
      stringsAtKey(item, key, found);
    }
  }
  return found;
}

function validateGrowthEvidence(growth: GrowthEvidence): {
  runId: string;
  returnedRecord: string;
  parentExecution: string;
  fenceCallIndex: number;
  modelRequestSteps: number;
} {
  assert.equal(growth.check, 'live-check-growth-assets');
  assert.equal(growth.status, 'passed', 'separate L4 growth evidence is not complete');
  assert.equal(growth.passed, true, 'separate L4 growth evidence did not pass');
  assert.equal(growth.observed?.readyParentCheck, true, 'L4 did not exercise the ready-parent fence');
  assert.equal(growth.observed?.realEdaRequested, false, 'L4 growth proof requested EDA');
  assert.equal(growth.costs?.modelSessions, 1, 'L4 must have one actual model session');
  assert.ok((growth.costs?.modelRequestSteps ?? 0) > 0, 'L4 has no actual model request');
  assert.equal(growth.agents?.length, 1, 'L4 must have one conversational owner');
  assert.equal(growth.agents?.[0]?.options?.model, EXPECTED_MODEL, 'L4 used the wrong model');
  assert.ok((growth.checks?.length ?? 0) > 1 && growth.checks?.every((check) => check.passed === true),
    'L4 does not contain a complete passing check set');

  const runId = growth.observed?.runId;
  assert.ok(runId, 'L4 has no target Run identity');
  const held = growth.runs?.find((entry) => entry.run?.id === runId);
  assert.ok(held?.run && held.records, 'L4 target Run is absent from evidence');
  assert.equal(held.run.status, 'ended-goal-met', 'L4 target Run is not complete');
  assert.equal(held.run.siteId, 'local', 'L4 growth proof is not the declared local no-EDA study');
  assert.equal(held.run.control?.owner, growth.agents?.[0]?.id, 'L4 Run owner differs from its model owner');
  const records = held.records;
  const returned = records.findLast((record) => record.type === 'growth' && record.event === 'returned');
  assert.ok(returned?.type === 'growth' && (returned.evidence?.length ?? 0) >= 3,
    'L4 added branch did not return with evidence');
  const accepted = records.find((record) => record.type === 'growth' && record.event === 'accepted');
  assert.ok(accepted?.type === 'growth', 'L4 has no accepted growth branch');
  const parent = Object.values(held.run.control?.executions ?? {}).find((execution) =>
    execution.nodeId === 'refine' && execution.generation === accepted.generation && execution.phase === 'completed');
  assert.ok(parent, 'L4 final parent is not the execution admitted before growth');
  assert.ok(Object.values(held.run.control?.requests ?? {}).some((request) =>
    request.receipt.action === 'begin' && request.receipt.executionId === parent.id
      && Date.parse(request.at) < Date.parse(accepted.at)),
  'L4 parent execution was not admitted before growth');
  const fenceCallIndex = growth.toolSequence?.findIndex((entry) => {
    if (entry.name !== 'hima_execute' || entry.args?.run !== runId || entry.args.action !== 'complete'
        || entry.args.executionId !== parent.id) return false;
    return entry.result?.content?.some((item) => {
      const refusal = item.type === 'text' ? parsedRefusal(item.text) : undefined;
      return refusal?.kind === 'refused' && /active growth branch must return/.test(refusal.reason ?? '');
    }) === true;
  }) ?? -1;
  assert.ok(fenceCallIndex >= 0, 'L4 has no actual active-branch parent-fence refusal');
  const edaPattern = /\b(dc_shell|innovus|lc_shell|genus|icc2_shell)\b/i;
  assert.ok(records.filter((record): record is JobRecord => record.type === 'job')
    .every((record) => !edaPattern.test(record.job.wire ?? '')), 'L4 contains an EDA command');
  return {
    runId,
    returnedRecord: returned.id,
    parentExecution: parent.id,
    fenceCallIndex,
    modelRequestSteps: growth.costs!.modelRequestSteps!,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  assert.equal(args.length, 6, usage);
  const originalFile = realpathSync(path.resolve(requiredArgument(args, '--audit-completed')));
  const growthFile = realpathSync(path.resolve(requiredArgument(args, '--growth-evidence')));
  const out = path.resolve(requiredArgument(args, '--out'));
  assert.ok(lstatSync(originalFile).isFile() && !lstatSync(originalFile).isSymbolicLink(), 'original evidence must be a plain file');
  assert.ok(lstatSync(growthFile).isFile() && !lstatSync(growthFile).isSymbolicLink(), 'growth evidence must be a plain file');
  assert.ok(!existsSync(out), 'the audit evidence directory already exists');
  mkdirSync(out, { recursive: true, mode: 0o700 });

  const originalSha256 = sha256(readFileSync(originalFile));
  const growthSha256 = sha256(readFileSync(growthFile));
  const auditSourceFile = realpathSync(path.join(repoRoot, 'scripts/audit-completed-dtco-pilot.ts'));
  const auditSourceSha256 = sha256(readFileSync(auditSourceFile));
  const original = JSON.parse(readFileSync(originalFile, 'utf8')) as OriginalEvidence;
  const growth = JSON.parse(readFileSync(growthFile, 'utf8')) as GrowthEvidence;
  const growthProof = validateGrowthEvidence(growth);
  assert.equal(original.check, 'live-check-dtco-pilot');
  assert.equal(original.status, 'failed');
  assert.equal(original.passed, false);
  assert.match(original.failure ?? '', /one optional comparison\/Judge growth branch returned/);
  const failedChecks = original.checks?.filter((check) => check.passed !== true) ?? [];
  assert.deepEqual(failedChecks.map((check) => check.claim),
    ['one optional comparison/Judge growth branch returned to next-research with evidence'],
  'the original live check did not fail solely at its optional growth gate');

  const retainedRoot = realpathSync(path.join(repoRoot, '.hima-tmp/pilot-release/homes'));
  const retainedHome = realpathSync(original.observed?.persistentHome ?? '');
  assert.ok(retainedHome.startsWith(`${retainedRoot}${path.sep}`), 'original Home is outside the retained pilot root');
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
  const ledgerFile = realpathSync(path.join(retainedHome, 'storages/hima_ledger.json'));
  const ledgerBefore = sha256(readFileSync(ledgerFile));
  const installedPack = path.join(retainedHome, 'hima/packs', PACK_ID);
  const sourcePack = path.join(repoRoot, 'packs', PACK_ID);
  const installedDigestBefore = packDigestOf(installedPack);
  const sourceDigestBefore = packDigestOf(sourcePack);
  assert.equal(sourceDigestBefore, installedDigestBefore, 'source and installed method already differ');
  assert.equal(packStage(sourcePack).stage, 'released', 'source Pack is no longer released');
  assert.equal(packStage(installedPack).stage, 'released', 'installed pilot Pack is no longer released');

  const savedSilent = process.env.HIMA_TEST_SILENT_AGENT;
  const savedLegacy = process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  let host: InProcessHost | undefined;
  let modelRequests = 0;
  const checks: Array<{ claim: string; passed: true; saw: unknown }> = [];
  const pass = (claim: string, condition: unknown, saw: unknown): void => {
    assert.ok(condition, claim);
    checks.push({ claim, passed: true, saw });
  };
  try {
    host = await bootInProcess(home);
    host.ctx.on('agent/request', () => {
      modelRequests += 1;
      throw new Error('completed pilot audit forbids every model request');
    });
    const run = host.ctx.hima.ledger.run(RUN_ID);
    assert.ok(run, 'completed pilot Run is absent');
    const records = host.ctx.hima.ledger.records({ runId: RUN_ID });
    const originalHeld = original.runs?.find((entry) => entry.run?.id === RUN_ID);
    assert.ok(originalHeld?.run && originalHeld.records, 'original evidence omits the retained Run');
    assert.deepEqual(originalHeld.run, run, 'retained terminal Run differs from the original evidence');
    assert.deepEqual(originalHeld.records, records, 'retained terminal records differ from the original evidence');
    pass('original evidence links the exact retained terminal Run and records', true,
      { runId: run.id, recordsSha256: sha256(Buffer.from(JSON.stringify(records))) });
    const ownerId = run.control?.owner;
    pass('the terminal negative retained the exact Pack, Site, Goal, strategy, owner, and approved budget',
      run.status === 'ended-budget-exhausted' && run.packId === PACK_ID && run.siteId === SITE_ID
        && run.packDigest === sourceDigestBefore && run.goal?.target_period_ns === 0.5
        && run.firstStrategy?.periodNs === 0.5 && run.firstStrategy?.algorithmRevision === 0
        && run.firstStrategy?.floorplanUtilization === 0.5 && run.budget?.timeBoxMs === FIRST_TIME_BOX_MS
        && run.budget?.closingReserveMs === CLOSING_RESERVE_MS && run.budget?.attemptLimit === ATTEMPT_LIMIT
        && run.budget?.generationLimit === GENERATION_LIMIT && run.budget?.retryAllowance === FIRST_RETRY_ALLOWANCE
        && run.budget?.jobCap === 1 && run.budget?.licences?.['Design-Compiler'] === 1
        && run.budget?.licences?.['Library-Compiler'] === 1 && run.budget?.licences?.Innovus === 1
        && ownerId === original.observed?.owner,
    { runId: run.id, status: run.status, owner: ownerId, packDigest: run.packDigest });
    assert.ok(ownerId, 'terminal Run has no owner');

    const current = currentRecordsIn(records);
    const doneNodes = new Set(current.filter((record): record is NodeRecord => record.type === 'node' && record.state === 'done')
      .map((record) => record.nodeId));
    const missingNodes = requiredReferenceNodes.filter((node) => !doneNodes.has(node));
    pass('the terminal negative completed every required reference stage', missingNodes.length === 0,
      { required: requiredReferenceNodes.length, done: doneNodes.size, missingNodes });
    const executions = Object.values(run.control?.executions ?? {});
    const unsettled = executions.filter((execution) => ['begun', 'working', 'ready', 'uncertain'].includes(execution.phase));
    const launchedJobs = records.filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
    const openJobs = launchedJobs.filter((launch) => !records.some((record) => record.type === 'job'
      && record.seq > launch.seq && record.job.session === launch.job.session
      && (record.event === 'finished' || record.event === 'killed')));
    pass('the terminal negative has no unsettled execution or unaccounted Job', unsettled.length === 0 && openJobs.length === 0,
      { executions: executions.length, launchedJobs: launchedJobs.length, unsettled, openJobs });
    const finalJudge = executions.findLast((execution) => execution.nodeId === 'final-judge');
    const finalDecision = records.findLast((record) => record.type === 'decision' && record.nodeId === 'next-research');
    pass('the terminal status is a supported complete negative', finalJudge?.result?.outcome === 'FAIL'
      && finalDecision?.type === 'decision' && 'strategy' in finalDecision.chosen,
    { status: run.status, finalJudge: finalJudge?.result, finalDecision: finalDecision?.id });

    const growthRecords = records.filter((record) => record.type === 'growth');
    pass('the original Run growth remains explicitly rejected', growthRecords.length > 0
      && growthRecords.every((record) => record.event === 'proposed' || record.event === 'rejected')
      && growthRecords.some((record) => record.event === 'rejected')
      && !growthRecords.some((record) => record.event === 'accepted' || record.event === 'returned'),
    growthRecords.map((record) => ({ id: record.id, event: record.event, proposalId: record.proposalId, reason: record.reason })));
    const analysis = records.findLast((record) => record.type === 'analysis' && record.nodeId === 'next-research');
    pass('the owner recorded bounded source-linked analysis', analysis?.type === 'analysis'
      && analysis.sessionId === ownerId && analysis.analysis.claims.length > 0
      && analysis.analysis.limitations.length > 0 && analysis.analysis.nextExperiments.length > 0
      && analysis.analysis.claims.every((claim) => claim.cites.length > 0
        && claim.cites.every((cite) => records.some((record) => record.id === cite))),
    analysis?.type === 'analysis' ? { id: analysis.id, claims: analysis.analysis.claims.length,
      limitations: analysis.analysis.limitations.length, nextExperiments: analysis.analysis.nextExperiments.length } : analysis);
    const valueTypes = new Set(current.flatMap((record) => record.type === 'observation'
      ? record.values.map((value) => value.type) : []));
    const missingValueTypes = requiredValueTypes.filter((type) => !valueTypes.has(type));
    pass('probe, predicted, adoption, verification, and matched physical facts remain distinct',
      missingValueTypes.length === 0, { missingValueTypes, valueTypes: [...valueTypes] });

    const persisted = await readPersistedSession(host.ctx, ownerId, (agent) => ({
      calls: toolCalls(agent), results: toolResults(agent), options: agent.options,
    }));
    const originalAgent = original.agents?.find((agent) => agent.id === ownerId || agent.session === ownerId);
    pass('the actual owner persisted the exact model, one-to-one tool calls, and results captured by the original evidence',
      persisted.calls.length === persisted.results.length && originalAgent?.options?.model === EXPECTED_MODEL
        && JSON.stringify(persisted.calls) === JSON.stringify(originalAgent.toolCalls)
        && JSON.stringify(persisted.results) === JSON.stringify(originalAgent.toolResults),
    { ownerId, recordedModel: originalAgent?.options?.model,
      readOnlyResumeOptions: persisted.options, calls: persisted.calls.length, results: persisted.results.length,
      callsSha256: sha256(Buffer.from(JSON.stringify(persisted.calls))),
      resultsSha256: sha256(Buffer.from(JSON.stringify(persisted.results))) });
    const completeToolSequence = original.toolSequence ?? [];
    pass('the original evidence retained the complete owner tool call/result sequence beyond the compacted session tail',
      completeToolSequence.length > persisted.calls.length
        && completeToolSequence.every((entry) => entry.name !== 'hima_execute' || entry.agent === ownerId),
    { completeCallsAndResults: completeToolSequence.length, persistedTailCallsAndResults: persisted.calls.length });

    const archive = await readRunAssets(experienceDeps(host, home), RUN_ID);
    pass('the technical report and Pack-local archive are readable', archive.kind === 'read', archive);
    if (archive.kind !== 'read') throw new Error('terminal archive is unavailable');
    const archiveRecord = completeArchiveRecord(records);
    pass('the archive manifest matches the complete Ledger record', archiveRecord?.manifestSha256 === sha256(readFileSync(archive.manifestPath))
      && archiveRecord?.manifestSha256 === sha256(readFileSync(path.join(archive.directory, 'manifest.json'))),
    { archiveRecord: archiveRecord?.id, manifest: archive.manifestPath, manifestSha256: archiveRecord?.manifestSha256 });
    const requiredArchived = records.filter((record) => ['observation', 'code', 'knowledge'].includes(record.type));
    const materialByRecord = new Map(archive.manifest.materials.map((material) => [material.recordId, material]));
    const missingMaterials = requiredArchived.filter((record) => !materialByRecord.has(record.id));
    const unreadableMaterials: unknown[] = [];
    for (const material of archive.manifest.materials) {
      const read = await readArchivedMaterial(experienceDeps(host, home), RUN_ID, material.path);
      if (read.kind !== 'read') unreadableMaterials.push({ material: material.path, read });
    }
    pass('the archive contains and byte/hash-validates every material', missingMaterials.length === 0
      && archive.manifest.materials.some((material) => material.path === 'experience.md')
      && archive.manifest.materials.some((material) => material.path === 'experience.json')
      && unreadableMaterials.length === 0,
    { materialCount: archive.manifest.materials.length, missingMaterials: missingMaterials.map((record) => record.id), unreadableMaterials });

    const selectorInputs = path.join(out, 'selector-inputs');
    mkdirSync(selectorInputs, { recursive: false, mode: 0o700 });
    const copyHeldMaterial = async (record: LedgerRecord, name: string): Promise<string> => {
      const material = materialByRecord.get(record.id);
      assert.ok(material, `missing archived material for ${record.id}`);
      const held = await readArchivedMaterial(experienceDeps(host!, home), RUN_ID, material.path);
      assert.equal(held.kind, 'read');
      if (held.kind !== 'read') throw new Error('selector material is unreadable');
      const target = path.join(selectorInputs, name);
      writeFileSync(target, held.text, { mode: 0o600 });
      return target;
    };
    const codeRecords = records.filter((record): record is CodeRecord => record.type === 'code');
    const templateSha256 = sha256(readFileSync(path.join(sourcePack, 'flow/selection-template.py')));
    const selectors = [];
    for (const route of routes) {
      const nodeId = `select-${route}`;
      const suffix = route.replaceAll('-', '_');
      const launch = launchedJobs.findLast((job) => job.nodeId === nodeId && records.some((record) =>
        record.type === 'job' && record.event === 'finished' && record.exitCode === 0
          && record.job.session === job.job.session));
      assert.ok(launch?.workshop, `no successful actual selector launch for ${route}`);
      const code = codeRecords.findLast((record) => record.path === launch.workshop!.entry.path
        && record.sha256 === launch.workshop!.entry.sha256 && record.sessionId === ownerId);
      const rawInput: KnowledgeRecord | undefined = records.findLast((record): record is KnowledgeRecord =>
        record.type === 'knowledge' && record.origin === 'input'
        && record.file === `raw_${suffix}` && record.nodeId === nodeId && record.sessionId === ownerId
        && record.bytes > 0 && record.seq < launch.seq);
      const sourceRead: KnowledgeRecord | undefined = records.findLast((record): record is KnowledgeRecord =>
        record.type === 'knowledge' && record.origin === 'input'
        && record.file === `source_${suffix}` && record.nodeId === nodeId && record.sessionId === ownerId
        && record.bytes > 0 && record.seq < launch.seq);
      const researchView: KnowledgeRecord | undefined = records.findLast((record): record is KnowledgeRecord =>
        record.type === 'knowledge' && record.origin === 'input'
        && record.file === `research_${suffix}` && record.nodeId === nodeId && record.sessionId === ownerId
        && record.bytes > 0 && record.exposedBytes === record.bytes && record.seq < launch.seq);
      const selection = records.findLast((record) => record.type === 'observation'
        && record.reader.id === `read-select-${route}` && record.seq > launch.seq);
      assert.ok(code && rawInput?.type === 'knowledge' && sourceRead?.type === 'knowledge'
        && researchView?.type === 'knowledge'
        && selection?.type === 'observation', `selector provenance is incomplete for ${route}`);
      const execution = executions.find((candidate) => candidate.nodeId === nodeId
        && candidate.jobSession === launch.job.session);
      assert.ok(execution, `no retained execution owns the actual selector Job for ${route}`);
      const viewReadCall = completeToolSequence.findIndex((entry) => entry.name === 'hima_execute'
        && entry.agent === ownerId && entry.args?.run === RUN_ID && entry.args.action === 'read'
        && entry.args.executionId === execution.id && entry.args.output === `research_${suffix}`
        && parsedToolResult(entry)?.kind === 'accepted');
      const writeCall = completeToolSequence.findIndex((entry) => {
        const receipt = acceptedReceipt(entry);
        return entry.name === 'hima_execute' && entry.agent === ownerId && entry.args?.run === RUN_ID
          && entry.args.action === 'write' && entry.args.executionId === execution.id
          && receipt?.action === 'write' && receipt.executionId === execution.id
          && receipt.data?.sha256 === code.sha256 && receipt.data.path === code.path;
      });
      const workCall = completeToolSequence.findIndex((entry, index) => {
        const receipt = acceptedReceipt(entry);
        return index > writeCall && entry.name === 'hima_execute' && entry.agent === ownerId
          && entry.args?.run === RUN_ID && entry.args.action === 'work'
          && entry.args.executionId === execution.id && receipt?.action === 'work'
          && receipt.executionId === execution.id;
      });
      assert.ok(viewReadCall >= 0 && writeCall > viewReadCall && workCall > writeCall,
        `complete owner history does not prove accepted ${route} research read, exact write, then accepted work`);
      const codeFile = await copyHeldMaterial(code, `${suffix}.py`);
      const rawFile = await copyHeldMaterial(rawInput, `${suffix}-raw.json`);
      const sourceFile = await copyHeldMaterial(sourceRead, `${suffix}-source.json`);
      const researchFile = await copyHeldMaterial(researchView, `${suffix}-research.json`);
      const selectionFile = await copyHeldMaterial(selection, `${suffix}-selected.json`);
      const rawDocument = JSON.parse(readFileSync(rawFile, 'utf8')) as {
        generation_requests?: Array<{ candidate_id?: string; generator_contract?: { interface?: unknown } }>;
      };
      const researchDocument = JSON.parse(readFileSync(researchFile, 'utf8')) as {
        sourceSha256?: string;
        minerCodeSha256?: string;
        route?: string;
        candidates?: Array<{ candidate_id?: string; interface?: unknown }>;
      };
      const sourceDocument = JSON.parse(readFileSync(sourceFile, 'utf8')) as unknown;
      assert.equal(researchDocument.sourceSha256, rawInput.sha256,
        `${route} research view does not hash-link its full raw source capture`);
      assert.equal(researchDocument.route, suffix, `${route} research view names a different route`);
      assert.ok(researchDocument.minerCodeSha256
        && stringsAtKey(sourceDocument, 'codeSha256').has(researchDocument.minerCodeSha256),
      `${route} research view does not bind the source-held mining program identity`);
      const rawByCandidate = new Map((rawDocument.generation_requests ?? [])
        .map((candidate) => [candidate.candidate_id, candidate]));
      assert.deepEqual(researchDocument.candidates?.map((candidate) => candidate.candidate_id),
        [...rawByCandidate.keys()], `${route} research view changes the raw candidate identities`);
      for (const candidate of researchDocument.candidates ?? []) {
        assert.deepEqual(candidate.interface, rawByCandidate.get(candidate.candidate_id)?.generator_contract?.interface,
          `${route} research view changes candidate interface evidence`);
      }
      selectors.push({ route: suffix, code: codeFile, codeSha256: code.sha256, raw: rawFile,
        rawSha256: sha256(readFileSync(rawFile)), source: sourceFile,
        sourceSha256: sha256(readFileSync(sourceFile)), research: researchFile,
        researchSha256: sha256(readFileSync(researchFile)), selection: selectionFile,
        selectionSha256: selection.contentSha256, codeRecord: code.id, rawInputRecord: rawInput.id,
        rawInputScope: 'sourceCapture', sourceInputRecord: sourceRead.id, sourceInputScope: 'sourceCapture',
        researchViewRecord: researchView.id, researchViewScope: 'modelRead', selectionRecord: selection.id,
        jobSession: launch.job.session, ownerResearchReadCall: viewReadCall,
        ownerWriteCall: writeCall, ownerWorkCall: workCall });
    }
    const selectorManifest = path.join(selectorInputs, 'manifest.json');
    const subsetEvidence = path.join(out, 'selector-subsets.json');
    writeFileSync(selectorManifest, `${JSON.stringify({ template: path.join(sourcePack, 'flow/selection-template.py'),
      templateSha256, selectors }, null, 2)}\n`, { mode: 0o600 });
    const auditor = path.join(repoRoot, 'scripts/audit-dtco-pilot-selectors.py');
    const auditorSha256 = sha256(readFileSync(auditor));
    execFileSync('/usr/bin/python3', [auditor, selectorManifest, subsetEvidence],
      { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const subsetAudit = JSON.parse(readFileSync(subsetEvidence, 'utf8')) as {
      status?: string;
      auditorSha256?: string;
      results?: Array<{ route?: string; originalSelection?: string[] }>;
    };
    const emptySelections = subsetAudit.results?.filter((result) => result.originalSelection?.length === 0)
      .map((result) => result.route) ?? [];
    pass('the exact executed selector inputs and owner-written code pass the finite counterfactual audit',
      subsetAudit.status === 'passed' && subsetAudit.auditorSha256 === auditorSha256
        && sha256(readFileSync(auditor)) === auditorSha256
        && JSON.stringify(emptySelections) === JSON.stringify([
          'timing_criticality', 'timing_context', 'structure_frequency',
        ]),
    { path: subsetEvidence, sha256: sha256(readFileSync(subsetEvidence)), auditorSha256, selectors: selectors.length,
      emptySelections,
      scope: 'finite input-dependence check; the first three empty selections are preserved algorithm-schema defects, not no-opportunity or quality conclusions; no new model, EDA, optimality or PPA claim' });

    const recordsSha256 = sha256(Buffer.from(JSON.stringify(records)));
    await host.dispose();
    host = await bootInProcess(home);
    host.ctx.on('agent/request', () => {
      modelRequests += 1;
      throw new Error('completed pilot restart audit forbids every model request');
    });
    const restartedRun = host.ctx.hima.ledger.run(RUN_ID);
    const restartedRecords = host.ctx.hima.ledger.records({ runId: RUN_ID });
    const restartedArchive = await readRunAssets(experienceDeps(host, home), RUN_ID);
    pass('restart preserves terminal Run, record bytes, archive identity, and method bytes',
      restartedRun?.status === run.status
        && sha256(Buffer.from(JSON.stringify(restartedRecords))) === recordsSha256
        && restartedArchive.kind === 'read'
        && completeArchiveRecord(restartedRecords)?.manifestSha256 === archiveRecord?.manifestSha256
        && packDigestOf(sourcePack) === sourceDigestBefore && packDigestOf(installedPack) === installedDigestBefore,
    { runStatus: restartedRun?.status, recordsSha256, archiveManifestSha256: archiveRecord?.manifestSha256,
      sourceDigest: sourceDigestBefore, installedDigest: installedDigestBefore });
    pass('offline audit made zero model requests and did not start or change any Job', modelRequests === 0
      && restartedRecords.filter((record) => record.type === 'job').length === records.filter((record) => record.type === 'job').length,
    { modelRequests, jobsBefore: records.filter((record) => record.type === 'job').length,
      jobsAfter: restartedRecords.filter((record) => record.type === 'job').length });

    await host.dispose();
    host = undefined;
    assert.equal(sha256(readFileSync(originalFile)), originalSha256, 'original evidence changed during audit');
    assert.equal(sha256(readFileSync(growthFile)), growthSha256, 'growth evidence changed during audit');
    assert.equal(sha256(readFileSync(ledgerFile)), ledgerBefore, 'retained Ledger changed during audit');
    assert.equal(packDigestOf(sourcePack), sourceDigestBefore, 'source Pack changed during audit');
    assert.equal(packDigestOf(installedPack), installedDigestBefore, 'installed pilot Pack changed during audit');
    assert.equal(sha256(readFileSync(auditSourceFile)), auditSourceSha256, 'completed pilot auditor changed during audit');

    const evidencePath = path.join(out, 'evidence.json');
    const checkpointPath = path.join(out, 'pilot-checkpoint.json');
    const evidence = {
      schema: 1,
      check: 'audit-completed-dtco-pilot',
      status: 'passed',
      passed: true,
      auditor: { path: auditSourceFile, sha256: auditSourceSha256 },
      scope: 'offline composition of the completed formal L5 negative and separate actual-model L4 growth proof; zero model requests and zero new EDA jobs',
      originalEvidence: { path: originalFile, sha256: originalSha256, status: 'failed', soleFailure: failedChecks[0]?.claim },
      originalRunGrowth: 'rejected',
      provenanceLimitation: 'The full raw/source files were captured as declared execution inputs but were not all fully exposed in chat. The owner read each full normalized research view before writing; every view hash-links the raw capture and preserves candidate identities/interfaces. The exact recorded program then consumed the full raw file, and the offline subset audit re-executed those bytes. This does not claim full raw/source chat reads.',
      algorithmLimitation: 'The first three executed selectors returned empty because of preserved algorithm/schema defects. They do not support a no-opportunity or research-quality conclusion. Later corrected selectors and their feedback remain separate recorded facts.',
      growthEvidence: { scope: 'separate-L4', path: growthFile, sha256: growthSha256, ...growthProof },
      home: retainedHome,
      run: { id: RUN_ID, owner: ownerId, status: run.status, recordsSha256 },
      archive: { directory: archive.directory, manifest: archive.manifestPath,
        manifestSha256: archiveRecord?.manifestSha256, experience: path.join(archive.directory, 'experience.md'),
        materials: archive.manifest.materials.length },
      method: { id: PACK_ID, version: PACK_VERSION, digest: sourceDigestBefore },
      offline: { hostBoots: 2, modelRequests, newEdaJobs: 0 },
      checks,
      checkpoint: checkpointPath,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    const evidenceSha256 = sha256(readFileSync(evidencePath));
    const checkpoint = {
      schema: 2,
      status: 'first-campaign-audited-ready-for-ui',
      home: retainedHome,
      firstRun: RUN_ID,
      firstOwner: ownerId,
      pack: { id: PACK_ID, version: PACK_VERSION, digest: sourceDigestBefore },
      site: SITE_ID,
      goal: { target_period_ns: 0.5 },
      archive: { directory: archive.directory, manifest: archive.manifestPath,
        manifestSha256: archiveRecord?.manifestSha256, experience: path.join(archive.directory, 'experience.md') },
      recordsSha256,
      sourceEvidence: { path: originalFile, sha256: originalSha256 },
      audit: { evidence: evidencePath, sha256: evidenceSha256 },
      growthValidation: { scope: 'separate-L4', path: growthFile, sha256: growthSha256,
        originalRunGrowth: 'rejected' },
    };
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(path.join(out, 'README.md'), '# PLS-18 completed Campaign audit\n\nPASS — the immutable complete L5 negative and a separate actual-model L4 growth proof compose to a schema-2 checkpoint for the same-Pack UI follow-up. The original Run growth remains rejected. This audit made zero model requests and started zero EDA Jobs.\n');
    process.stdout.write(`completed DTCO pilot audit: PASS; checkpoint ${checkpointPath}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify({
      schema: 1, check: 'audit-completed-dtco-pilot', status: 'failed', passed: false,
      originalEvidence: { path: originalFile, sha256: originalSha256 },
      growthEvidence: { path: growthFile, sha256: growthSha256 }, failure: message,
    }, null, 2)}\n`, { mode: 0o600 });
    throw error;
  } finally {
    await host?.dispose();
    if (savedSilent === undefined) delete process.env.HIMA_TEST_SILENT_AGENT;
    else process.env.HIMA_TEST_SILENT_AGENT = savedSilent;
    if (savedLegacy === undefined) delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
    else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = savedLegacy;
  }
}

await main();
