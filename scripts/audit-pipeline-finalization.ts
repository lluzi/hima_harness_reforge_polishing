// Read-only audit of the known property-order false failure. Never resumes original home writable.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { HIMA_TEST_SECTIONS, packDigestOf, packStage, packVersionFile, pipelineFiles } from '@hima/harness';
import { bootInProcess, injectedSkills, resumeTestAgent, toolCalls, toolResults } from '../test/contract/support/boot-inprocess.ts';
import { changedBetween, digestTrees, sectionsOf } from '../test/contract/support/pipeline.ts';
import { parseParent, retainedHome, verifyCompletedNumericRun } from './live-check-pipeline-checkpoint.ts';
import { bundleHashes, sameScientificFacts, sameTestClaims, type Continuation, type RecordedRun, type RuntimeUpgrade } from './live-check-pipeline-finalize.ts';
import { sha256, within } from './live-check-workshop.ts';

const orderingClaim = 'no Run creation execution budget reset or scientific record changed during finalization';
type Link = { path: string; sha256: string };
type FinalEvidence = {
  check: string; status: string; failure: string; runs: RecordedRun[]; agents: Continuation['agents']; checks: { claim: string; passed: boolean }[];
  costs: Continuation['costs'];
  observed: { beforeTest: string; originalEvidenceUnchanged: boolean; costAccounting: { aggregate: { hosts: number; nativeSessionsCreated: number; modelRequestSteps: number; userMessages: number } };
    provenance: { completedAttempt: Link; original: Link; failedFirstAttempt: Link; runtimeUpgrade: Link & { sourceSha: string } } };
  toolSequence: { name: string; agent: string; result: { isError?: boolean; value?: { kind?: string; run?: string; released?: string } } }[];
};

export async function auditFinalization(evidencePath: string, out: string) {
  assert.ok(!existsSync(out), 'use a fresh audit output directory');
  const startedAt = new Date().toISOString(); const bytes = readFileSync(evidencePath); const final = JSON.parse(bytes.toString('utf8')) as FinalEvidence;
  assert.ok(final.check === 'live-check-pipeline-finalize' && final.status === 'failed' && final.failure.includes(orderingClaim), 'audit accepts only the known finalization comparator failure');
  assert.deepEqual(final.checks.filter((check) => !check.passed).map((check) => check.claim), [orderingClaim], 'the failed run has an additional unresolved check');
  for (const claim of ['model repaired only TEST formatting with standalone exact identity and status', 'original model edited TEST and invoked actual pack check',
    'original model invoked native release without handwritten artifacts', 'actual release seal covers exact original Run corrected method and file bytes', 'all five stage skills remain in the exact original native conversation']) {
    assert.ok(final.checks.some((check) => check.claim === claim && check.passed), `finalization did not establish ${claim}`);
  }
  const links = [final.observed.provenance.completedAttempt, final.observed.provenance.original, final.observed.provenance.failedFirstAttempt, final.observed.provenance.runtimeUpgrade];
  const linked = links.map((link) => { const data = readFileSync(link.path); assert.equal(sha256(data), link.sha256, `linked evidence changed: ${link.path}`); return JSON.parse(data.toString('utf8')); });
  const completed = linked[0] as Continuation; const parent = parseParent(linked[1]);
  const first = linked[2] as { observed: { parent: Link } }; const upgrade = linked[3] as RuntimeUpgrade;
  assert.equal(completed.observed.parent.sha256, links[1]!.sha256); assert.equal(completed.observed.priorAttempt.sha256, links[2]!.sha256);
  assert.equal(first.observed.parent.sha256, links[1]!.sha256); assert.ok(final.observed.originalEvidenceUnchanged);
  assert.ok(final.runs.length === 1 && completed.runs.length === 1);
  const expected = { runs: completed.runs.map((entry) => entry.run), records: completed.runs[0]!.records };
  assert.ok(sameScientificFacts({ runs: final.runs.map((entry) => entry.run), records: final.runs[0]!.records }, expected), 'the failed comparison hid an actual scientific change');
  assert.notEqual(JSON.stringify(final.runs), JSON.stringify(completed.runs), 'this is not the diagnosed enumeration-order case');
  const folder = realpathSync(completed.observed.packFolder); const home = path.resolve(folder, '../../..');
  const owner = parent.agents.find((agent) => agent.cwd === folder)!; const runId = completed.runs[0]!.run.id;
  assert.equal(final.agents.length, 1); assert.equal(final.agents[0]!.id, owner.id); assert.equal(final.agents[0]!.session, owner.session);
  assert.deepEqual(final.agents[0]!.options, owner.options);

  // The installation transition stays explicit, including its preserved old bundle. Native session
  // logs/projection caches may have grown during finalization; scientific ledger bytes may not.
  assert.equal(upgrade.kind, 'hima-installed-runtime-upgrade'); assert.equal(upgrade.sourceSha, final.observed.provenance.runtimeUpgrade.sourceSha);
  assert.equal(realpathSync(upgrade.bundle), path.join(home, 'profiles/hima/node_modules/@hima/harness'));
  assert.deepEqual(changedBetween(new Map(Object.entries(completed.observed.installedBuildHashes)), new Map(Object.entries(upgrade.oldHashes))), []);
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.oldHashes)), await bundleHashes(upgrade.backupBundle)), []);
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.newHashes)), await bundleHashes(upgrade.bundle)), []);
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.protectedBefore)), new Map(Object.entries(upgrade.protectedAfter))), []);
  const stableRoots = ['hima', 'workspace', 'numeric-flow'].map((name) => path.join(home, name));
  assert.ok([...stableRoots, path.join(home, 'sessions'), path.join(home, 'storages')].every((root) => upgrade.protectedRoots.includes(root)));
  const baseline = new Map(Object.entries(upgrade.protectedAfter).filter(([file]) => stableRoots.some((root) => within(file, root))));
  for (const [file, hash] of Object.entries(upgrade.newHashes)) baseline.set(path.join(upgrade.bundle, file), hash);
  const treeDelta = changedBetween(baseline, await digestTrees([...stableRoots, upgrade.bundle], home + '.excluded'));
  assert.deepEqual(treeDelta, [`${path.join(folder, pipelineFiles.test)} (rewritten)`, `${path.join(folder, pipelineFiles.version)} (new)`].sort(), 'finalization changed more than TEST and VERSION');
  const ledgerPath = path.join(home, 'storages/hima_ledger.json'); const ledgerHash = sha256(readFileSync(ledgerPath));
  assert.equal(ledgerHash, upgrade.protectedAfter[ledgerPath], 'scientific ledger bytes changed during finalization');
  const test = readFileSync(path.join(folder, pipelineFiles.test), 'utf8');
  assert.equal(sha256(final.observed.beforeTest), upgrade.protectedAfter[path.join(folder, pipelineFiles.test)]);
  assert.ok(sameTestClaims(final.observed.beforeTest, test), 'TEST repair changed non-format bytes');
  assert.deepEqual(sectionsOf(test), HIMA_TEST_SECTIONS);
  assert.deepEqual(test.split('\n').filter((line) => line.startsWith('run:')), [`run: ${runId}`]);
  assert.deepEqual(test.split('\n').filter((line) => line.startsWith('status:')), ['status: ended-goal-met']);
  const seal = packVersionFile.parse(parse(readFileSync(path.join(folder, pipelineFiles.version), 'utf8')));
  assert.ok(seal.pack === 'authored-numeric' && seal.test.run === runId && seal.methodDigest === completed.observed.methodCorrection.correctedDigest);
  assert.equal(packDigestOf(folder), seal.methodDigest); assert.equal(packStage(folder).stage, 'released');
  for (const [file, hash] of Object.entries(seal.files)) assert.equal(sha256(readFileSync(path.join(folder, file))), hash, `seal file changed: ${file}`);
  assert.ok(final.toolSequence.some((entry) => entry.name === 'hima_pack_release' && entry.agent === owner.id && entry.result.isError === false
    && entry.result.value?.kind === 'released' && entry.result.value.run === runId && entry.result.value.released === seal.released), 'native release result does not support the seal');

  mkdirSync(out, { recursive: true });
  const originalBefore = await digestTrees([home], path.join(upgrade.bundle, 'node_modules'));
  const temporary = realpathSync(mkdtempSync('/tmp/hima-release-audit-')); const copied = path.join(temporary, 'home');
  cpSync(home, copied, { recursive: true, verbatimSymlinks: true });
  process.env.TMPDIR = temporary; process.env.TMUX_TMPDIR = temporary; delete process.env.TMUX;
  const checks: { claim: string; passed: boolean; saw: unknown }[] = [];
  const check = { observed: {} as Record<string, unknown>, require(claim: string, passed: boolean, saw: unknown) { checks.push({ claim, passed, saw }); assert.ok(passed, claim); } };
  const host = await bootInProcess(retainedHome(copied)); let requests = 0;
  host.ctx.on('agent/request', () => { requests++; throw new Error('post-finalization audit forbids model requests'); });
  const handle = await resumeTestAgent(host.ctx, owner.id, owner.options);
  try {
    const actual = { runs: host.ctx.hima.ledger.runs(), records: host.ctx.hima.ledger.records({ runId }) };
    check.require('actual current Run and scientific records match structurally', sameScientificFacts(actual, expected), { runId, recordCount: actual.records.length });
    verifyCompletedNumericRun(check, host, handle.agent, folder, runId, { input: parent.observed.input,
      methodDigest: completed.observed.methodCorrection.correctedDigest, readerSha256: completed.observed.methodCorrection.afterReaderSha256 });
    assert.deepEqual(toolCalls(handle.agent), final.agents[0]!.toolCalls, 'persisted tool history differs from actual finalization');
    assert.deepEqual(toolCalls(handle.agent).slice(0, completed.agents[0]!.toolCalls.length), completed.agents[0]!.toolCalls);
    assert.deepEqual(injectedSkills(handle.agent), final.agents[0]!.skills);
    assert.ok(['hima-grill', 'hima-spec', 'hima-fabric', 'hima-test', 'hima-release'].every((skill) => injectedSkills(handle.agent).includes(skill)));
    assert.equal(String(handle.agent.id), owner.id); assert.equal(handle.agent.session.header.cwd, folder);
    const tail = toolCalls(handle.agent).slice(completed.agents[0]!.toolCalls.length);
    assert.ok(tail.some((call) => call.name === 'edit') && tail.some((call) => call.name === 'hima_pack_check') && tail.some((call) => call.name === 'hima_pack_release'));
    assert.ok(tail.every((call) => !call.name.startsWith('hima_') || ['hima_pack_check', 'hima_status', 'hima_context', 'hima_pack_release'].includes(call.name)));
    assert.ok(tail.filter((call) => ['write', 'edit'].includes(call.name)).every((call) => call.args.file_path === path.join(folder, pipelineFiles.test)));
    const nativeRelease = toolResults(handle.agent).filter((result) => !result.failed).some((result) => { try { const value = JSON.parse(result.text); return value.kind === 'released' && value.run === runId && value.released === seal.released; } catch { return false; } });
    assert.ok(nativeRelease, 'persisted native tool results do not contain the actual release');
    assert.ok(actual.records.every((record) => record.type !== 'session'), 'a separate research Agent moment was opened');
    assert.equal(requests, 0);
    check.observed.nativeAuthor = { id: owner.id, skills: injectedSkills(handle.agent), toolCalls: toolCalls(handle.agent).length, finalizationCalls: tail, nativeRelease };
  } finally { await handle.dispose(); await host.dispose(); rmSync(copied, { recursive: true, force: true }); }
  assert.deepEqual(changedBetween(originalBefore, await digestTrees([home], path.join(upgrade.bundle, 'node_modules'))), [], 'read-only audit modified the original home');
  assert.equal(sha256(readFileSync(ledgerPath)), ledgerHash);
  assert.equal(sha256(readFileSync(evidencePath)), sha256(bytes));
  for (const link of links) assert.equal(sha256(readFileSync(link.path)), link.sha256);
  const prior = final.observed.costAccounting;
  const result = { check: 'pipeline-post-finalization-audit', status: 'passed', passed: true, startedAt, finishedAt: new Date().toISOString(),
    sourceFailure: { path: path.resolve(evidencePath), sha256: sha256(bytes), preservedStatus: 'failed', reason: 'order-sensitive serialization comparator; structural values are identical',
      originalRunKeys: Object.keys(completed.runs[0]!.run), reloadedRunKeys: Object.keys(final.runs[0]!.run) }, links, checks, observed: check.observed,
    seal, finalTestSha256: sha256(test), methodDigest: seal.methodDigest, allowedTreeDelta: treeDelta, ledgerBytes: { path: ledgerPath, sha256: ledgerHash, unchangedSinceRuntimeUpgrade: true },
    originalHomeUnchangedByAudit: true, priorCosts: prior, auditCosts: { hosts: 1, modelRequests: 0, providerRequests: 0, runExecutions: 0, fileEditsInOriginalHome: 0 },
    aggregateCostsIncludingAudit: { ...prior.aggregate, hosts: prior.aggregate.hosts + 1 } };
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) process.stdout.write('usage: node scripts/audit-pipeline-finalization.ts --from <failed-finalization/evidence.json> --out <fresh-audit-directory>\nRead-only original data; one private copied Host, no model or Run execution.\n');
  else {
    assert.ok(args.length === 4 && args[0] === '--from' && args[2] === '--out', 'use --from <evidence> --out <fresh-directory>');
    const deadline = setTimeout(() => { process.stderr.write('read-only audit deadline exceeded\n'); process.exit(124); }, 60_000);
    try { await auditFinalization(path.resolve(args[1]!), path.resolve(args[3]!)); process.stdout.write('post-finalization audit PASS; old failure preserved; no model or Run execution\n'); }
    finally { clearTimeout(deadline); }
  }
}
