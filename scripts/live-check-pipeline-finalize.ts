// Finalize one already successful numeric Run. No method authoring or execution is admitted.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { HIMA_TEST_SECTIONS, packDigestOf, packStage, packVersionFile, pipelineFiles } from '@hima/harness';
import { bootInProcess, injectedSkills, resumeTestAgent, toolCalls, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { changedBetween, digestTrees, sectionsOf } from '../test/contract/support/pipeline.ts';
import { guardInstalled, runLive, sha256, within, type LiveCheck } from './live-check-workshop.ts';
import { parseParent, probeReader, retainedHome, verifyCompletedNumericRun } from './live-check-pipeline-checkpoint.ts';

type Costs = { hosts: number; nativeSessionsCreated: number; modelRequestSteps: number; userMessages: number };
export type RecordedRun = { run: ReturnType<InProcessHost['ctx']['hima']['ledger']['runs']>[number]; records: ReturnType<InProcessHost['ctx']['hima']['ledger']['records']> };
/** Compare scientific values; object property enumeration order is not a Run fact. */
export function sameScientificFacts(actual: { runs: readonly unknown[]; records: readonly unknown[] }, expected: { runs: readonly unknown[]; records: readonly unknown[] }): boolean {
  return isDeepStrictEqual(actual, expected);
}
export type Continuation = {
  check: string; status: string; costs: Costs; checks: { claim: string; passed: boolean }[]; runs: RecordedRun[];
  agents: { id: string; session: string; cwd: string; options: { provider: string; model: string }; skills: string[]; toolCalls: ReturnType<typeof toolCalls> }[];
  observed: {
    packFolder: string; installedBundle: string; installedBuildHashes: Record<string, string>; input: ReturnType<typeof parseParent>['observed']['input'];
    parent: { path: string; sha256: string }; priorAttempt: { path: string; sha256: string; providerRequests: number };
    methodCorrection: { parentDigest: string; correctedDigest: string; afterReaderSha256: string };
    readerAfter: { originalScript: string; passed: boolean }; finalContinuationFiles: Record<string, string>; protectedContinuationDelta: string[]; parentStillUnchanged: boolean;
  };
};
export interface RuntimeUpgrade {
  kind: 'hima-installed-runtime-upgrade'; sourceSha: string; bundle: string; backupBundle: string;
  oldHashes: Record<string, string>; newHashes: Record<string, string>;
  protectedRoots: string[]; protectedBefore: Record<string, string>; protectedAfter: Record<string, string>;
}

export async function bundleHashes(bundle: string) {
  return new Map([...(await digestTrees([bundle], path.join(bundle, 'node_modules')))].map(([file, hash]) => [path.relative(bundle, file), hash]));
}
export async function verifyRuntimeUpgrade(upgrade: RuntimeUpgrade, home: string, oldHashes: Record<string, string>) {
  assert.equal(upgrade.kind, 'hima-installed-runtime-upgrade');
  assert.match(upgrade.sourceSha, /^[a-f0-9]{40}$/, 'runtime source SHA missing');
  assert.equal(realpathSync(upgrade.bundle), path.join(home, 'profiles/hima/node_modules/@hima/harness'));
  assert.notEqual(realpathSync(upgrade.backupBundle), realpathSync(upgrade.bundle), 'old bundle must be preserved separately');
  assert.deepEqual(changedBetween(new Map(Object.entries(oldHashes)), new Map(Object.entries(upgrade.oldHashes))), [], 'runtime upgrade old hashes differ from original installed proof');
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.oldHashes)), await bundleHashes(upgrade.backupBundle)), [], 'preserved old bundle differs from its manifest');
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.newHashes)), await bundleHashes(upgrade.bundle)), [], 'installed runtime differs from upgrade manifest');
  const required = ['hima', 'sessions', 'storages', 'workspace', 'numeric-flow'].map((at) => path.join(home, at));
  assert.ok(required.every((at) => upgrade.protectedRoots.includes(at)) && upgrade.protectedRoots.every((at) => within(existsSync(at) ? realpathSync(at) : path.resolve(at), home)), 'upgrade must protect Pack, native sessions, ledger, workspace and original input');
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.protectedBefore)), new Map(Object.entries(upgrade.protectedAfter))), [], 'runtime upgrade modified protected data');
  assert.deepEqual(changedBetween(new Map(Object.entries(upgrade.protectedAfter)), await digestTrees(upgrade.protectedRoots, home + '.excluded')), [], 'protected data changed since runtime upgrade');
}

/** Only the two key-line separators may move; all other report bytes stay the same. */
export function sameTestClaims(before: string, after: string): boolean {
  const normalize = (text: string) => text.replace(/^(run: run-[0-9a-f-]+|status: ended-goal-met)(?:[ \t]*—[ \t]*|[ \t]*\n(?:[ \t]*\n)*[ \t]*(?:—[ \t]*)?)/gm, '$1\n\n');
  return normalize(before) === normalize(after);
}

export function finalizationDenial(name: string, input: unknown, folder: string, before: string, phase: 'repair' | 'release'): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'finalization requires structured tool arguments';
  const args = input as Record<string, unknown>;
  if (name.startsWith('hima_') && !['hima_pack_check', 'hima_status', 'hima_context', 'hima_pack_release'].includes(name)) return 'finalization forbids Run creation, execution and method changes';
  if (name === 'hima_pack_release' && (phase !== 'release' || args.pack !== 'authored-numeric')) return 'release only the verified authored Pack after TEST validates';
  if (name === 'write' || name === 'edit') {
    const at = path.resolve(folder, String(args.file_path ?? args.path ?? ''));
    if (phase !== 'repair' || at !== path.join(folder, pipelineFiles.test)) return 'finalization permits ordinary edits only to TEST.md';
    let proposed: string;
    if (name === 'write') { if (typeof args.content !== 'string') return 'TEST write requires content'; proposed = args.content; }
    else {
      if (typeof args.old_string !== 'string' || typeof args.new_string !== 'string') return 'TEST edit requires explicit old_string and new_string';
      const current = readFileSync(at, 'utf8');
      proposed = args.replace_all === true ? current.replaceAll(args.old_string, args.new_string) : current.replace(args.old_string, args.new_string);
    }
    if (!sameTestClaims(before, proposed)) return 'only TEST line formatting is authorized; preserve every factual/prose token';
  }
  return undefined;
}

async function inspectFinalization(fromPath: string, runtimePath: string) {
  const fromBytes = readFileSync(fromPath); const from = JSON.parse(fromBytes.toString('utf8')) as Continuation;
  assert.ok(from.check === 'live-check-pipeline-checkpoint' && from.status === 'failed' && from.runs.length === 1, 'finalization requires the completed-Run continuation evidence');
  assert.ok(from.observed.readerAfter.passed && from.observed.protectedContinuationDelta.length === 0 && from.observed.parentStillUnchanged, 'prior continuation did not preserve method provenance');
  for (const claim of ['pre-Run model correction changed only the reader and FABRIC record', 'actual corrected reader accepts a single integer and makes no malformed missing or unreadable numeric claim']) assert.ok(from.checks.some((check) => check.claim === claim && check.passed), `prior evidence did not establish ${claim}`);
  const parentBytes = readFileSync(from.observed.parent.path); assert.equal(sha256(parentBytes), from.observed.parent.sha256, 'original parent evidence changed');
  const parent = parseParent(JSON.parse(parentBytes.toString('utf8')));
  const priorBytes = readFileSync(from.observed.priorAttempt.path); assert.equal(sha256(priorBytes), from.observed.priorAttempt.sha256, 'first failed attempt evidence changed');
  const prior = JSON.parse(priorBytes.toString('utf8')) as { observed: { parent: { sha256: string } }; costs: Costs };
  assert.equal(prior.observed.parent.sha256, from.observed.parent.sha256, 'attempt chain differs');
  const folder = realpathSync(from.observed.packFolder); const home = path.resolve(folder, '../../..');
  assert.equal(folder, parent.observed.packFolder);
  assert.deepEqual(changedBetween(new Map(Object.entries(from.observed.finalContinuationFiles)), await digestTrees([folder], folder + '.excluded')), [], 'Pack changed after completed-Run checkpoint');
  assert.equal(packDigestOf(folder), from.observed.methodCorrection.correctedDigest, 'corrected method changed');
  assert.equal(sha256(readFileSync(parent.observed.input.path)), parent.observed.input.sha256, 'original input changed');
  assert.deepEqual(from.observed.input, parent.observed.input);
  assert.equal(from.observed.methodCorrection.parentDigest, parent.observed.methodBeforeTest.digest);
  const author = parent.agents.find((agent) => agent.cwd === folder)!;
  assert.ok(from.agents.length === 1 && from.agents[0]!.id === author.id && from.agents[0]!.session === author.session);
  assert.deepEqual(from.agents[0]!.options, author.options);
  assert.ok(from.runs[0]!.run.status === 'ended-goal-met' && from.runs[0]!.run.control?.owner === author.id, 'source Run is not the original owner Goal-met result');
  assert.ok(!existsSync(path.join(folder, pipelineFiles.version)), 'Pack is already released');
  const runtimeBytes = readFileSync(runtimePath); const upgrade = JSON.parse(runtimeBytes.toString('utf8')) as RuntimeUpgrade;
  await verifyRuntimeUpgrade(upgrade, home, from.observed.installedBuildHashes);
  return { from, fromPath: path.resolve(fromPath), fromSha256: sha256(fromBytes), parent, prior, author, folder, home, upgrade,
    runtimePath: path.resolve(runtimePath), runtimeSha256: sha256(runtimeBytes), beforeTest: readFileSync(path.join(folder, pipelineFiles.test), 'utf8'), runId: from.runs[0]!.run.id };
}

function verifyHeldRun(check: Pick<LiveCheck, 'require' | 'observed'>, host: InProcessHost, author: Parameters<typeof toolCalls>[0], held: Awaited<ReturnType<typeof inspectFinalization>>) {
  assert.deepEqual(host.ctx.hima.ledger.runs(), held.from.runs.map((entry) => entry.run), 'actual Run identity/budget/status changed');
  assert.deepEqual(host.ctx.hima.ledger.records({ runId: held.runId }), held.from.runs[0]!.records, 'actual scientific records changed');
  assert.deepEqual(toolCalls(author), held.from.agents[0]!.toolCalls, 'persisted author tools differ from completed-Run evidence');
  assert.deepEqual(injectedSkills(author), held.from.agents[0]!.skills, 'persisted author stages differ from completed-Run evidence');
  assert.equal(String(author.id), held.author.id); assert.equal(author.session.header.cwd, held.folder);
  const result = verifyCompletedNumericRun(check, host, author, held.folder, held.runId, { input: held.parent.observed.input,
    methodDigest: held.from.observed.methodCorrection.correctedDigest, readerSha256: held.from.observed.methodCorrection.afterReaderSha256 });
  const calls = toolCalls(author);
  check.require('original author used controlled read knowledge code work and completion', ['begin', 'read', 'knowledge', 'write', 'work', 'complete'].every((action) => calls.some((call) => call.name === 'hima_execute' && call.args.run === held.runId && call.args.action === action)), calls.filter((call) => call.name === 'hima_execute'));
  return result;
}

async function finalize(check: LiveCheck, fromPath: string, runtimePath: string) {
  const held = await inspectFinalization(fromPath, runtimePath); const { from, folder, home, author: original } = held;
  check.home = retainedHome(home); process.chdir(check.home.workspace);
  check.observed.provenance = { completedAttempt: { path: held.fromPath, sha256: held.fromSha256 }, original: from.observed.parent, failedFirstAttempt: from.observed.priorAttempt,
    runtimeUpgrade: { path: held.runtimePath, sha256: held.runtimeSha256, sourceSha: held.upgrade.sourceSha, bundle: held.upgrade.bundle, backupBundle: held.upgrade.backupBundle } };
  check.observed.beforeTest = held.beforeTest;
  const before = await digestTrees([path.join(home, 'hima/packs'), path.join(home, 'numeric-flow'), path.join(home, 'workspace'), held.upgrade.bundle], home + '.excluded');
  const host = await bootInProcess(check.home); check.attach(host);
  const handle = await resumeTestAgent(host.ctx, original.id, original.options); const author = check.trackResumed(handle.agent);
  try {
    verifyHeldRun(check, host, author, held);
    const reader = probeReader(from.observed.readerAfter.originalScript, check.temporary); check.observed.reader = reader;
    check.require('current corrected reader still passes all nine direct cases', reader.passed && reader.sha256 === from.observed.methodCorrection.afterReaderSha256, reader);
    guardInstalled(check, host, [held.upgrade.bundle, path.dirname(folder), path.join(home, 'numeric-flow'), check.home.workspace], folder);
    let phase: 'repair' | 'release' = 'repair';
    host.ctx.tools.guard((execution) => execution.agent && String(execution.agent.id) !== original.id ? 'only the original author can finalize' : finalizationDenial(execution.name, execution.arguments, folder, held.beforeTest, phase));
    const start = toolCalls(author).length;
    await check.say(author, `/hima-test authored-numeric. FINALIZATION ONLY for existing Run ${held.runId}, already ended-goal-met under its original budget; create or execute no Run. Your preceding turn wrote TEST.md but timed out before pack check. Repair only its two key-line formats, preserving every factual/prose token: put exactly "run: ${held.runId}" on its own line and move its existing Goal/Strategy explanation to the following paragraph; put exactly "status: ended-goal-met" on its own line and move its existing ending explanation to the following paragraph. Do not append any explanation, punctuation, backticks or quotes to either key line. Leave all method files and scientific data unchanged. Read TEST.md, edit those line breaks, call hima_pack_check for authored-numeric and finish this turn. No new experiment, Run, code or observation is authorized.`);
    for (let round = 0; round < 2 && packStage(folder).stage !== 'tested'; round++) await check.say(author, `Finish only the existing TEST.md line formatting and hima_pack_check. The Run remains ${held.runId}, ended-goal-met. Preserve all existing factual text in following paragraphs. Do not rerun or execute anything.`);
    const test = readFileSync(path.join(folder, pipelineFiles.test), 'utf8');
    check.require('model repaired only TEST formatting with standalone exact identity and status', sameTestClaims(held.beforeTest, test)
      && test.split('\n').filter((line) => line.startsWith('run:')).length === 1 && test.split('\n').includes(`run: ${held.runId}`)
      && test.split('\n').filter((line) => line.startsWith('status:')).length === 1 && test.split('\n').includes('status: ended-goal-met'), test);
    check.require('TEST has required sections and actual tested stage', JSON.stringify(sectionsOf(test)) === JSON.stringify(HIMA_TEST_SECTIONS) && packStage(folder).stage === 'tested', packStage(folder));
    const repairCalls = toolCalls(author).slice(start);
    check.require('original model edited TEST and invoked actual pack check', repairCalls.some((call) => ['write', 'edit'].includes(call.name)) && repairCalls.some((call) => call.name === 'hima_pack_check'), repairCalls);
    phase = 'release'; const releaseStart = toolCalls(author).length;
    await check.say(author, '/hima-release authored-numeric. Seal the already-tested existing Run only. Do not edit TEST or method files, create a Run, or execute any research node.');
    const releaseCalls = toolCalls(author).slice(releaseStart);
    check.require('original model invoked native release without handwritten artifacts', releaseCalls.some((call) => call.name === 'hima_pack_release') && !releaseCalls.some((call) => ['write', 'edit'].includes(call.name)), releaseCalls);
    const seal = packVersionFile.parse(parse(readFileSync(path.join(folder, pipelineFiles.version), 'utf8')));
    check.require('actual release seal covers exact original Run corrected method and file bytes', seal.test.run === held.runId && seal.methodDigest === from.observed.methodCorrection.correctedDigest
      && packDigestOf(folder) === seal.methodDigest && Object.entries(seal.files).every(([file, hash]) => sha256(readFileSync(path.join(folder, file))) === hash) && packStage(folder).stage === 'released', seal);
    check.require('all five stage skills remain in the exact original native conversation', ['hima-grill', 'hima-spec', 'hima-fabric', 'hima-test', 'hima-release'].every((skill) => injectedSkills(author).includes(skill)) && check.requestSessions.size === 1 && check.requestSessions.has(original.id), injectedSkills(author));
    check.require('no Run creation execution budget reset or scientific record changed during finalization', sameScientificFacts({ runs: host.ctx.hima.ledger.runs(), records: host.ctx.hima.ledger.records({ runId: held.runId }) },
      { runs: from.runs.map((entry) => entry.run), records: from.runs[0]!.records }), host.ctx.hima.ledger.runs());
    const delta = changedBetween(before, await digestTrees([path.join(home, 'hima/packs'), path.join(home, 'numeric-flow'), path.join(home, 'workspace'), held.upgrade.bundle], home + '.excluded'));
    check.require('finalization changed only TEST formatting and the native VERSION seal', JSON.stringify(delta) === JSON.stringify([`${path.join(folder, pipelineFiles.test)} (rewritten)`, `${path.join(folder, pipelineFiles.version)} (new)`].sort()), delta);
    check.observed.seal = seal; check.observed.finalTest = test;
    check.require('all prior evidence and the explicit runtime upgrade manifest remain unchanged', sha256(readFileSync(held.fromPath)) === held.fromSha256
      && sha256(readFileSync(from.observed.parent.path)) === from.observed.parent.sha256 && sha256(readFileSync(from.observed.priorAttempt.path)) === from.observed.priorAttempt.sha256
      && sha256(readFileSync(held.runtimePath)) === held.runtimeSha256, check.observed.provenance);
  } finally {
    check.observed.originalEvidenceUnchanged = sha256(readFileSync(held.fromPath)) === held.fromSha256 && sha256(readFileSync(from.observed.parent.path)) === from.observed.parent.sha256 && sha256(readFileSync(from.observed.priorAttempt.path)) === from.observed.priorAttempt.sha256;
    check.observed.costAccounting = { original: held.parent.costs, failedFirstAttempt: held.prior.costs, scientificContinuation: from.costs,
      finalization: { hosts: 1, nativeSessionsCreated: 0, nativeSessionsResumed: 1, modelRequestSteps: check.steps, userMessages: check.turns },
      aggregate: { hosts: held.parent.costs.hosts + held.prior.costs.hosts + from.costs.hosts + 1, nativeSessionsCreated: held.parent.costs.nativeSessionsCreated,
        modelRequestSteps: held.parent.costs.modelRequestSteps + held.prior.costs.modelRequestSteps + from.costs.modelRequestSteps + check.steps,
        userMessages: held.parent.costs.userMessages + held.prior.costs.userMessages + from.costs.userMessages + check.turns }, failedFirstAttemptProviderRequests: 0, providerRequests: 'otherwise unmeasured; request events are not API request counts' };
    check.checkpoint(); // Host owns handle disposal after cancellation and evidence collection.
  }
}

async function preflight(fromPath: string, runtimePath: string, out: string) {
  assert.ok(!existsSync(out), 'use a fresh preflight output directory');
  const held = await inspectFinalization(fromPath, runtimePath); mkdirSync(out, { recursive: true });
  const temporary = realpathSync(mkdtempSync('/tmp/hima-final-preflight-')); const copied = path.join(temporary, 'home');
  cpSync(held.home, copied, { recursive: true, verbatimSymlinks: true });
  process.env.TMPDIR = temporary; process.env.TMUX_TMPDIR = temporary; delete process.env.TMUX;
  const checks: { claim: string; passed: boolean; saw: unknown }[] = [];
  const check = { observed: {} as Record<string, unknown>, require(claim: string, passed: boolean, saw: unknown) { checks.push({ claim, passed, saw }); assert.ok(passed, claim); } };
  const host = await bootInProcess(retainedHome(copied)); let requests = 0;
  host.ctx.on('agent/request', () => { requests++; throw new Error('finalization preflight forbids model requests'); });
  const handle = await resumeTestAgent(host.ctx, held.author.id, held.author.options);
  try {
    verifyHeldRun(check, host, handle.agent, held);
    const reader = probeReader(held.from.observed.readerAfter.originalScript, temporary); check.observed.reader = reader;
    check.require('current corrected reader passes all nine direct cases with the recorded hash', reader.passed && reader.sha256 === held.from.observed.methodCorrection.afterReaderSha256, reader);
    assert.equal(requests, 0);
  } finally { await handle.dispose(); await host.dispose(); rmSync(copied, { recursive: true, force: true }); }
  await verifyRuntimeUpgrade(held.upgrade, held.home, held.from.observed.installedBuildHashes);
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({ check: 'pipeline-finalization-preflight', passed: true, hosts: 1, providerRequests: 0,
    from: { path: held.fromPath, sha256: held.fromSha256 }, runtime: { path: held.runtimePath, sha256: held.runtimeSha256 }, checks, observed: check.observed, originalProtectedFilesUnchanged: true }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help')) process.stdout.write('usage: node scripts/live-check-pipeline-finalize.ts --from <continuation-2/evidence.json> --runtime-manifest <runtime-upgrade.json> --out <fresh-directory> [--preflight-only | --timeout-ms 300000 --max-turns 4 --max-steps 30]\n');
  else {
    const args = process.argv.slice(2); const take = (flag: string) => { const at = args.indexOf(flag); assert.ok(at >= 0 && args[at + 1] && !args[at + 1]!.startsWith('--'), `${flag} requires a path`); return path.resolve(args.splice(at, 2)[1]!); };
    const from = take('--from'); const runtime = take('--runtime-manifest'); const preview = args.indexOf('--preflight-only');
    if (preview >= 0) { args.splice(preview, 1); const out = take('--out'); assert.equal(args.length, 0); await preflight(from, runtime, out); process.stdout.write('finalization preflight PASS; no model turn, Run execution or original file edit\n'); }
    else { process.argv.splice(2, process.argv.length - 2, ...args); await runLive('live-check-pipeline-finalize', 4, (check) => finalize(check, from, runtime)); }
  }
}
