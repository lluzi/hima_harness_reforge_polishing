// PLS-35: offline audit of one completed positive held-out L5 Campaign.
// It opens the retained Hima Home, starts no model, and launches no Site Job.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  currentRecordsIn,
  packDigestOf,
  readArchivedMaterial,
  readRunAssets,
  type CodeRecord,
  type JobRecord,
  type LedgerRecord,
  type NodeRecord,
} from '@hima/harness';
import { himaProfileDir } from '../packages/desktop/src/hima-home.ts';
import { bootInProcess, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { repoRoot, type HimaHome } from '../test/contract/support/dsh-home.ts';
import { sha256 } from './live-check-workshop.ts';

const PACK_ID = 'custom-cell-fmax-dtco';
const PACK_VERSION = '1';
const EXPECTED_MODEL = 'deepseek-flash';
const routes = [
  'timing-criticality', 'timing-context', 'structure-frequency',
  'structure-compaction', 'mapper-compatibility', 'functional-diversity',
] as const;
type ArchiveRecord = Extract<LedgerRecord, { type: 'archive' }>;
type KnowledgeRecord = Extract<LedgerRecord, { type: 'knowledge' }>;
const requiredReferenceNodes = [
  'bind-inputs', 'probe', 'synthesize', 'read-probe', 'judge', 'next-period', 'mine-start',
  ...routes.flatMap((route) => [`mine-${route}`, `select-${route}`, `read-select-${route}`]),
  'merge-join', 'research-candidates', 'read-research-selection', 'merge', 'read-merge', 'generate', 'read-generate', 'layout', 'read-layout',
  'characterize', 'read-characterize', 'compile', 'read-compile', 'foundry-synth',
  'read-foundry-synth', 'custom-synth', 'read-custom-synth', 'adoption', 'read-adoption', 'adoption-gate',
  'pnr-foundry', 'read-pnr-foundry', 'pnr-generated', 'read-pnr-generated', 'verify',
  'read-verify', 'compare', 'read-compare', 'final-judge', 'next-research',
] as const;
const requiredValueTypes = [
  'clock_period', 'setup_wns', 'reg2reg_wns', 'reg2reg_path_count', 'cell_area', 'candidate_count', 'research_hypothesis_count', 'selected_count',
  'generated_cell_count', 'abstract_cell_count', 'predicted_cell_count', 'lc_accepted',
  'library_visible', 'adopted_instance_count', 'pnr_completed', 'verification_error_count',
  'cell_checker_diagnostic_count', 'comparison_valid',
  'full_constraint_failures', 'matched_conditions', 'foundry_setup_wns', 'setup_wns_delta',
  'foundry_fmax_mhz', 'generated_fmax_mhz', 'fmax_delta_mhz', 'fmax_improved',
] as const;

interface LiveEvidence {
  check?: string;
  status?: string;
  passed?: boolean;
  observed?: {
    owner?: string;
    persistentHome?: string;
    pilot?: { siteProfile?: { site?: string; heldOutRtlSha256?: string; heldOutSource?: string } };
  };
  runs?: Array<{ run?: Record<string, any>; records?: LedgerRecord[] }>;
  agents?: Array<{ id?: string; session?: string; options?: { model?: string } }>;
  checks?: Array<{ claim?: string; passed?: boolean }>;
}

const usage = 'usage: node scripts/audit-completed-dtco-pilot.ts --evidence <l5-evidence.json> --out <fresh-directory>';
function argument(args: string[], flag: string): string {
  const positions = args.flatMap((value, index) => value === flag ? [index] : []);
  assert.equal(positions.length, 1, usage);
  const value = args[positions[0]! + 1];
  assert.ok(value && !value.startsWith('--'), `${flag} requires a path`);
  return value;
}
const completeArchive = (records: LedgerRecord[]): ArchiveRecord | undefined =>
  records.findLast((record): record is ArchiveRecord => record.type === 'archive' && record.delivery === 'complete');
const experienceDeps = (host: InProcessHost, home: HimaHome) => ({
  ledger: host.ctx.hima.ledger,
  packsDir: path.join(home.home, 'hima/packs'),
  sitesDir: path.join(home.home, 'hima/sites'),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(`${usage}\n`); return; }
  assert.equal(args.length, 4, usage);
  const sourceFile = realpathSync(path.resolve(argument(args, '--evidence')));
  const out = path.resolve(argument(args, '--out'));
  assert.ok(lstatSync(sourceFile).isFile() && !lstatSync(sourceFile).isSymbolicLink(), 'L5 evidence must be a plain file');
  assert.ok(!existsSync(out), 'audit output must be a fresh directory');
  mkdirSync(out, { recursive: true, mode: 0o700 });
  const sourceBytes = readFileSync(sourceFile);
  const sourceSha256 = sha256(sourceBytes);
  const source = JSON.parse(sourceBytes.toString('utf8')) as LiveEvidence;
  assert.equal(source.check, 'live-check-dtco-pilot');
  assert.equal(source.status, 'passed', 'L5 live check did not pass');
  assert.equal(source.passed, true, 'L5 live check did not pass');
  assert.ok(source.checks?.length && source.checks.every((check) => check.passed === true), 'L5 contains a failed factual check');
  const site = source.observed?.pilot?.siteProfile?.site;
  const heldOutSha256 = source.observed?.pilot?.siteProfile?.heldOutRtlSha256;
  assert.ok(site && heldOutSha256?.match(/^[0-9a-f]{64}$/), 'L5 omits held-out Site/input identity');
  const retainedRoot = realpathSync(path.join(repoRoot, '.hima-tmp/pilot-release/homes'));
  const retainedHome = realpathSync(source.observed?.persistentHome ?? '');
  assert.ok(retainedHome.startsWith(`${retainedRoot}${path.sep}`), 'retained Home is outside the private pilot root');
  const runRows = source.runs?.filter((row) => row.run?.packId === PACK_ID && row.run?.siteId === site) ?? [];
  assert.equal(runRows.length, 1, 'evidence must contain exactly one held-out Campaign Run');
  const runId = String(runRows[0]!.run!.id);
  const originalRecords = runRows[0]!.records;
  assert.ok(originalRecords, 'evidence omits held-out Run records');
  const home: HimaHome = {
    home: retainedHome,
    profileDir: himaProfileDir(retainedHome),
    workspace: path.join(retainedHome, 'workspace'),
    env: { ...process.env, DSH_HOME: retainedHome, DSH_AGENTS_HOME: path.join(retainedHome, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
    dispose: async () => undefined,
  };
  const sourcePack = path.join(repoRoot, 'packs', PACK_ID);
  const installedPack = path.join(retainedHome, 'hima/packs', PACK_ID);
  const sourceDigest = packDigestOf(sourcePack);
  const installedDigest = packDigestOf(installedPack);
  assert.equal(installedDigest, sourceDigest, 'installed L5 Pack differs from current fixed method');
  const ledgerFile = realpathSync(path.join(retainedHome, 'storages/hima_ledger.json'));
  const ledgerBefore = sha256(readFileSync(ledgerFile));
  const checks: Array<{ claim: string; passed: true; saw: unknown }> = [];
  const pass = (claim: string, condition: unknown, saw: unknown): void => {
    assert.ok(condition, claim); checks.push({ claim, passed: true, saw });
  };
  const savedSilent = process.env.HIMA_TEST_SILENT_AGENT;
  const savedLegacy = process.env.HIMA_TEST_LEGACY_AUTO_DRIVE;
  process.env.HIMA_TEST_SILENT_AGENT = '1';
  process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
  let host: InProcessHost | undefined;
  let modelRequests = 0;
  try {
    host = await bootInProcess(home);
    host.ctx.on('agent/request', () => { modelRequests += 1; throw new Error('PLS-35 offline audit forbids model requests'); });
    const run = host.ctx.hima.ledger.run(runId);
    assert.ok(run, 'retained L5 Run is absent');
    const records = host.ctx.hima.ledger.records({ runId });
    pass('live evidence links the exact immutable retained Run and records',
      JSON.stringify(runRows[0]!.run) === JSON.stringify(run) && JSON.stringify(originalRecords) === JSON.stringify(records),
      { runId, recordsSha256: sha256(Buffer.from(JSON.stringify(records))) });
    const owner = run.control?.owner;
    const ownerEvidence = source.agents?.find((agent) => agent.id === owner || agent.session === owner);
    pass('one DeepSeek-V4.1-Flash owner completed one held-out Campaign on the exact Pack and Site',
      run.status === 'ended-goal-met' && run.packId === PACK_ID && run.packDigest === sourceDigest
        && run.siteId === site && run.goal?.target_period_ns === 0.5
        && run.firstStrategy?.periodNs === 0.5 && run.firstStrategy?.floorplanUtilization === 0.25
        && run.firstStrategy?.algorithmRevision === 0 && owner === source.observed?.owner
        && ownerEvidence?.options?.model === EXPECTED_MODEL,
      { runId, status: run.status, owner, model: ownerEvidence?.options?.model, site, packDigest: run.packDigest });

    const current = currentRecordsIn(records);
    const done = new Set(current.filter((record): record is NodeRecord => record.type === 'node' && record.state === 'done').map((record) => record.nodeId));
    const missing = requiredReferenceNodes.filter((node) => !done.has(node));
    const executions = Object.values(run.control?.executions ?? {});
    const unsettled = executions.filter((execution) => ['begun', 'working', 'ready', 'uncertain'].includes(execution.phase));
    const launched = records.filter((record): record is JobRecord => record.type === 'job' && record.event === 'launched');
    const openJobs = launched.filter((launch) => !records.some((record) => record.type === 'job' && record.seq > launch.seq
      && record.job.session === launch.job.session && (record.event === 'finished' || record.event === 'killed')));
    pass('every reference node completed with no unsettled execution or Job', missing.length === 0 && unsettled.length === 0 && openJobs.length === 0,
      { requiredNodes: requiredReferenceNodes.length, missing, executions: executions.length, launchedJobs: launched.length, unsettled, openJobs });
    const finalJudge = executions.findLast((execution) => execution.nodeId === 'final-judge');
    const finalDecision = records.findLast((record) => record.type === 'decision' && record.nodeId === 'next-research');
    pass('the terminal status is justified by the complete final Judge and goal-met decision',
      finalJudge?.result?.outcome === 'PASS' && finalDecision?.type === 'decision' && 'goalMet' in finalDecision.chosen,
      { finalJudge: finalJudge?.result, finalDecision: finalDecision?.id });

    const observations = current.filter((record) => record.type === 'observation');
    const valueTypes = new Set(observations.flatMap((record) => record.values.map((value) => value.type)));
    const missingTypes = requiredValueTypes.filter((type) => !valueTypes.has(type));
    const comparison = observations.findLast((record) => record.reader.id === 'read-compare');
    const values = new Map(comparison?.values.map((value) => [value.type, value.value]));
    const foundryFmax = values.get('foundry_fmax_mhz');
    const generatedFmax = values.get('generated_fmax_mhz');
    pass('reader facts prove an apple-to-apple routed custom-Cell Fmax improvement',
      missingTypes.length === 0 && values.get('matched_conditions') === 1
        && values.get('comparison_valid') === 1 && Number(values.get('adopted_instance_count')) > 0
        && values.get('fmax_improved') === 1 && typeof foundryFmax === 'number'
        && typeof generatedFmax === 'number' && generatedFmax > foundryFmax,
      { comparisonRecord: comparison?.id, missingTypes, matched: values.get('matched_conditions'),
        adoptedInstances: values.get('adopted_instance_count'), comparisonValid: values.get('comparison_valid'),
        disclosedPhysicalFindings: values.get('full_constraint_failures'), foundryFmax, generatedFmax,
        delta: values.get('fmax_delta_mhz') });
    const analysis = records.findLast((record) => record.type === 'analysis' && record.nodeId === 'next-research');
    pass('the owner archived source-linked conclusions, limitations and next experiments',
      analysis?.type === 'analysis' && analysis.sessionId === owner && analysis.analysis.claims.length > 0
        && analysis.analysis.limitations.length > 0 && analysis.analysis.nextExperiments.length > 0
        && analysis.analysis.claims.every((claim) => claim.cites.length > 0
          && claim.cites.every((cite) => records.some((record) => record.id === cite))),
      analysis?.type === 'analysis' ? { id: analysis.id, claims: analysis.analysis.claims.length,
        limitations: analysis.analysis.limitations.length, nextExperiments: analysis.analysis.nextExperiments.length } : analysis);

    const archive = await readRunAssets(experienceDeps(host, home), runId);
    pass('the technical report and Pack-local archive are readable', archive.kind === 'read', archive);
    if (archive.kind !== 'read') throw new Error('terminal archive is unavailable');
    const archiveRecord = completeArchive(records);
    const byRecord = new Map(archive.manifest.materials.map((material) => [material.recordId, material]));
    const requiredArchived = records.filter((record) => ['observation', 'code', 'knowledge'].includes(record.type));
    const missingMaterials = requiredArchived.filter((record) => !byRecord.has(record.id));
    const unreadable: unknown[] = [];
    for (const material of archive.manifest.materials) {
      const read = await readArchivedMaterial(experienceDeps(host, home), runId, material.path);
      if (read.kind !== 'read') unreadable.push({ path: material.path, result: read });
    }
    pass('archive identity and every required material remain byte-readable',
      archiveRecord?.manifestSha256 === sha256(readFileSync(archive.manifestPath)) && missingMaterials.length === 0 && unreadable.length === 0,
      { manifestSha256: archiveRecord?.manifestSha256, materials: archive.manifest.materials.length,
        missing: missingMaterials.map((record) => record.id), unreadable });

    const copyMaterial = async (record: LedgerRecord, name: string): Promise<string> => {
      const material = byRecord.get(record.id); assert.ok(material, `archive omits ${record.id}`);
      const read = await readArchivedMaterial(experienceDeps(host!, home), runId, material.path);
      assert.equal(read.kind, 'read'); if (read.kind !== 'read') throw new Error(`cannot read ${record.id}`);
      const target = path.join(out, name); writeFileSync(target, read.text, { mode: 0o600 }); return target;
    };
    assert.ok(comparison, 'final comparison observation is absent');
    const comparisonSource = await copyMaterial(comparison, 'comparison-stage.json');
    const stage = JSON.parse(readFileSync(comparisonSource, 'utf8')) as { status?: string; facts?: Record<string, any>; inputs?: unknown[] };
    pass('the retained comparison stage records matched conditions, physical adoption and the same positive Fmax ordering',
      stage.status === 'passed' && stage.facts?.matched_conditions === true
        && stage.facts?.comparison_valid === true && stage.facts?.adopted_instance_count > 0
        && stage.facts?.fmax_improved === true && stage.facts?.generated_fmax_mhz > stage.facts?.foundry_fmax_mhz
        && Array.isArray(stage.inputs) && stage.inputs.length > 20,
      { sourceSha256: sha256(readFileSync(comparisonSource)), status: stage.status,
        matched: stage.facts?.matched_conditions, adoptedInstances: stage.facts?.adopted_instance_count,
        foundryFmax: stage.facts?.foundry_fmax_mhz, generatedFmax: stage.facts?.generated_fmax_mhz,
        inputEvidence: stage.inputs?.length });

    const codeRecords = records.filter((record): record is CodeRecord => record.type === 'code');
    const knowledge = records.filter((record): record is KnowledgeRecord => record.type === 'knowledge');
    const selectorInputs = path.join(out, 'research-inputs'); mkdirSync(selectorInputs, { mode: 0o700 });
    const researchLaunch = launched.findLast((job) => job.nodeId === 'research-candidates' && job.workshop && records.some((record) =>
      record.type === 'job' && record.event === 'finished' && record.exitCode === 0 && record.job.session === job.job.session));
    assert.ok(researchLaunch?.workshop, 'no successful AI research Job');
    const researchCode = codeRecords.findLast((record) => record.nodeId === 'research-candidates' && record.sessionId === owner
      && record.path === researchLaunch.workshop!.entry.path && record.sha256 === researchLaunch.workshop!.entry.sha256);
    const researchObservation = observations.findLast((record) => record.reader.id === 'read-ai-research-selection');
    assert.ok(researchCode && researchObservation, 'AI research code/output provenance is incomplete');
    const codeFile = await copyMaterial(researchCode, path.join('research-inputs', 'entry.py'));
    const researchFile = await copyMaterial(researchObservation, path.join('research-inputs', 'research.json'));
    const sources: Record<string, { raw: string; rawSha256: string }> = {};
    for (const route of routes) {
      const suffix = route.replaceAll('-', '_');
      const raw = knowledge.findLast((record) => record.origin === 'input' && record.file === `raw_${suffix}`
        && record.nodeId === 'research-candidates' && record.bytes > 0 && record.seq < researchLaunch.seq);
      assert.ok(raw, `AI research raw input is incomplete for ${route}`);
      const rawFile = await copyMaterial(raw, path.join('research-inputs', `${suffix}-raw.json`));
      sources[suffix] = { raw: rawFile, rawSha256: sha256(readFileSync(rawFile)) };
    }
    const manifest = path.join(selectorInputs, 'manifest.json');
    writeFileSync(manifest, `${JSON.stringify({ code: codeFile, codeSha256: researchCode.sha256,
      research: researchFile, researchSha256: researchObservation.contentSha256, maxCells: 32, sources }, null, 2)}\n`, { mode: 0o600 });
    const subsetEvidence = path.join(out, 'ai-research-audit.json');
    const selectorAuditor = path.join(repoRoot, 'scripts/audit-dtco-ai-research.py');
    execFileSync('/usr/bin/python3', [selectorAuditor, manifest, subsetEvidence], { timeout: 30_000, maxBuffer: 1024 * 1024 });
    const subset = JSON.parse(readFileSync(subsetEvidence, 'utf8')) as { status?: string; auditorSha256?: string };
    pass('the exact owner-written research bytes and selections remain source-hash bound in offline audit',
      subset.status === 'passed' && subset.auditorSha256 === sha256(readFileSync(selectorAuditor)),
      { evidenceSha256: sha256(readFileSync(subsetEvidence)), auditorSha256: subset.auditorSha256 });

    const recordsSha256 = sha256(Buffer.from(JSON.stringify(records)));
    await host.dispose(); host = await bootInProcess(home);
    host.ctx.on('agent/request', () => { modelRequests += 1; throw new Error('PLS-35 restart audit forbids model requests'); });
    const restarted = host.ctx.hima.ledger.run(runId);
    const restartedRecords = host.ctx.hima.ledger.records({ runId });
    pass('restart preserves the terminal Run, record bytes, archive and method identity',
      restarted?.status === 'ended-goal-met' && sha256(Buffer.from(JSON.stringify(restartedRecords))) === recordsSha256
        && completeArchive(restartedRecords)?.manifestSha256 === archiveRecord?.manifestSha256
        && packDigestOf(sourcePack) === sourceDigest && packDigestOf(installedPack) === installedDigest,
      { status: restarted?.status, recordsSha256, archiveManifestSha256: archiveRecord?.manifestSha256,
        sourceDigest, installedDigest });
    pass('offline audit made zero model requests and started no new Site Job',
      modelRequests === 0 && restartedRecords.filter((record) => record.type === 'job').length === records.filter((record) => record.type === 'job').length,
      { modelRequests, jobs: records.filter((record) => record.type === 'job').length });
    await host.dispose(); host = undefined;
    assert.equal(sha256(readFileSync(sourceFile)), sourceSha256, 'source L5 evidence changed during audit');
    assert.equal(sha256(readFileSync(ledgerFile)), ledgerBefore, 'retained Ledger changed during audit');
    const audit = {
      schema: 1, check: 'audit-completed-dtco-pilot', status: 'passed', passed: true,
      scope: 'offline audit of one positive held-out L5 Campaign; zero model requests and zero new Site Jobs',
      sourceEvidence: { path: sourceFile, sha256: sourceSha256 },
      heldOut: { source: source.observed?.pilot?.siteProfile?.heldOutSource, rtlSha256: heldOutSha256 },
      run: { id: runId, owner, site, status: run.status, recordsSha256 },
      method: { id: PACK_ID, version: PACK_VERSION, digest: sourceDigest },
      archive: { directory: archive.directory, manifest: archive.manifestPath,
        manifestSha256: archiveRecord?.manifestSha256, materials: archive.manifest.materials.length },
      positiveResult: { adoptedInstances: stage.facts?.adopted_instance_count,
        foundryFmaxMhz: stage.facts?.foundry_fmax_mhz, generatedFmaxMhz: stage.facts?.generated_fmax_mhz,
        deltaMhz: stage.facts?.fmax_delta_mhz },
      offline: { modelRequests, newSiteJobs: 0 }, checks,
    };
    const evidencePath = path.join(out, 'evidence.json');
    writeFileSync(evidencePath, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(path.join(out, 'README.md'), '# PLS-35 completed Campaign audit\n\nPASS — one positive held-out L5 Campaign, its routed custom-Cell adoption, matched comparison, Fmax ordering, algorithms, archive and restart identity passed offline review. No model or Site Job was started by this audit.\n');
    process.stdout.write(`completed DTCO pilot audit: PASS; evidence ${evidencePath}\n`);
  } catch (error) {
    const failure = error instanceof Error ? error.stack ?? error.message : String(error);
    writeFileSync(path.join(out, 'evidence.json'), `${JSON.stringify({ schema: 1, check: 'audit-completed-dtco-pilot', status: 'failed', passed: false,
      sourceEvidence: { path: sourceFile, sha256: sourceSha256 }, failure }, null, 2)}\n`, { mode: 0o600 });
    throw error;
  } finally {
    await host?.dispose();
    if (savedSilent === undefined) delete process.env.HIMA_TEST_SILENT_AGENT; else process.env.HIMA_TEST_SILENT_AGENT = savedSilent;
    if (savedLegacy === undefined) delete process.env.HIMA_TEST_LEGACY_AUTO_DRIVE; else process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = savedLegacy;
  }
}

await main();
