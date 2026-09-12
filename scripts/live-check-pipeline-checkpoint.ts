// Opt-in L4 continuation of the failed, pre-Run installed authoring checkpoint.
// The original evidence is never rewritten. Only its original model session can author changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, loadPack, packDigestOf, packStage, packVersionFile, pipelineFiles, resolveChooser, resolveRule, runIdPattern } from '@hima/harness';
import { bootInProcess, injectedSkills, resumeTestAgent, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import type { HimaHome } from '../test/contract/support/dsh-home.ts';
import { changedBetween, digestTrees, sectionsOf } from '../test/contract/support/pipeline.ts';
import { guardInstalled, runLive, sha256, within, type LiveCheck } from './live-check-workshop.ts';

const packId = 'authored-numeric';
const chooserClaim = 'the authored chooser declares Goal completion and the bounded fallback limit';
const firstSkills = ['hima-grill', 'hima-spec', 'hima-fabric'];
interface Parent {
  check: string; status: string; passed: boolean; startedAt: string; finishedAt: string;
  costs: { hosts: number; nativeSessionsCreated: number; modelSessions: number; modelRequestSteps: number; userMessages: number };
  observed: {
    sourceSha: string; privateRoot: string; installedBundle: string; installedBuildHashes: Record<string, string>;
    packFolder: string; authoredFiles: Record<string, string>; methodBeforeTest: { digest: string; intentSha256: string; specSha256: string };
    input: { path: string; sha256: string; numbers: number[]; limit: number };
    approvedBusiness: { facts: string; sha256: string; goal: { minimum: number }; initialStrategy: { limit: number }; generationLimit: number; timeBoxMs: number };
    allowedReadRoots: string[]; allowedWriteRoot: string; deniedTools: unknown[];
  };
  agents: { id: string; session: string; cwd: string; skills: string[]; toolCalls: ReturnType<typeof toolCalls> }[];
  runs: unknown[]; checks: { claim: string; passed: boolean }[];
}

/** Accept only the failed pre-Run checkpoint whose sole failed oracle was the chooser. */
export function parseParent(value: unknown): Parent {
  assert.ok(value && typeof value === 'object', 'parent evidence must be an object');
  const p = value as Parent;
  assert.ok(p.check === 'live-check-pipeline' && p.status === 'failed' && p.passed === false, 'parent must be the failed original authoring check');
  assert.ok(Array.isArray(p.runs) && p.runs.length === 0, 'parent must have no Run');
  assert.ok(Array.isArray(p.checks), 'parent checks missing');
  assert.deepEqual(p.checks.filter((c) => !c.passed).map((c) => c.claim), [chooserClaim], 'parent has failures beyond the chooser oracle');
  for (const claim of ['grill waited for author answers before recording intent', 'spec added only SPEC.md', 'Pack stage reached compiled',
    'compiled method preserves the approved Workshop argv and output roots', 'compiled parameter declarations and LIMIT binding preserve the approved contract',
    'actual graph routes the approved success through Explore and fallback through the bounded revisit', 'ordered Judge rules encode numeric validity and the actual Run Goal']) {
    assert.ok(p.checks.some((c) => c.claim === claim && c.passed), `parent did not establish: ${claim}`);
  }
  assert.ok(p.observed && p.costs && Array.isArray(p.agents), 'parent provenance missing');
  for (const count of Object.values(p.costs).filter((v) => typeof v === 'number')) assert.ok(Number.isSafeInteger(count) && count >= 0, 'invalid parent cost');
  for (const key of ['hosts', 'nativeSessionsCreated', 'modelSessions', 'modelRequestSteps', 'userMessages'] as const) assert.ok(Number.isSafeInteger(p.costs[key]) && p.costs[key] >= 0, `missing parent cost ${key}`);
  const o = p.observed;
  for (const at of [o.privateRoot, o.installedBundle, o.packFolder, o.input?.path]) assert.ok(typeof at === 'string' && path.isAbsolute(at), 'parent paths must be absolute');
  assert.ok(/^\/private\/tmp\/hima-l4-[^/]+$/.test(o.privateRoot), 'parent must be a retained private live-check root');
  assert.ok(o.authoredFiles && Object.keys(o.authoredFiles).length > 0 && o.installedBuildHashes && Object.keys(o.installedBuildHashes).length > 0, 'parent hash manifests missing');
  assert.ok(o.methodBeforeTest && /^[a-f0-9]{64}$/.test(o.methodBeforeTest.digest), 'parent method digest missing');
  assert.ok(o.approvedBusiness && sha256(o.approvedBusiness.facts) === o.approvedBusiness.sha256, 'parent business contract hash mismatch');
  assert.ok(Array.isArray(o.input.numbers) && o.input.numbers.length > 0 && o.input.numbers.every((n) => Number.isSafeInteger(n) && n >= 0), 'parent input must be actual nonnegative integers');
  assert.ok(Number.isSafeInteger(o.input.limit) && o.input.limit >= 0 && o.input.limit <= 100, 'invalid initial limit');
  assert.deepEqual({ goal: o.approvedBusiness.goal, strategy: o.approvedBusiness.initialStrategy, generations: o.approvedBusiness.generationLimit, timeBox: o.approvedBusiness.timeBoxMs },
    { goal: { minimum: 1 }, strategy: { limit: o.input.limit }, generations: 1, timeBox: 480_000 }, 'parent approved business differs from this bounded continuation');
  const authors = p.agents.filter((agent) => agent.cwd === o.packFolder);
  assert.ok(authors.length === 1 && authors[0]!.id === authors[0]!.session && firstSkills.every((skill) => authors[0]!.skills.includes(skill)), 'parent must identify one original three-stage author');
  assert.ok(Array.isArray(authors[0]!.toolCalls) && authors[0]!.toolCalls.length > 0, 'parent author tool history missing');
  assert.ok(Array.isArray(o.allowedReadRoots) && o.allowedWriteRoot === o.packFolder && Array.isArray(o.deniedTools), 'parent installed guard provenance missing');
  return p;
}

/** All original paths are read-only here. Host startup, even keylessly, uses a separate copy. */
export async function inspectCheckpoint(parentPath: string) {
  const bytes = readFileSync(parentPath);
  const parent = parseParent(JSON.parse(bytes.toString('utf8')));
  const o = parent.observed;
  const folder = realpathSync(o.packFolder);
  const home = path.resolve(folder, '../../..');
  assert.ok(within(home, realpathSync(o.privateRoot)) && folder === path.join(home, 'hima/packs', packId), 'unexpected checkpoint home or Pack');
  const bundle = realpathSync(o.installedBundle);
  assert.equal(bundle, path.join(home, 'profiles/hima/node_modules/@hima/harness'), 'original installed bundle moved');
  const actualBuild = new Map([...(await digestTrees([bundle], path.join(bundle, 'node_modules')))].map(([at, hash]) => [path.relative(bundle, at), hash]));
  assert.deepEqual(changedBetween(new Map(Object.entries(o.installedBuildHashes)), actualBuild), [], 'original installed bundle hashes changed');
  const files = await digestTrees([folder], folder + '.excluded');
  assert.deepEqual(changedBetween(new Map(Object.entries(o.authoredFiles)), files), [], 'original authored file hashes changed');
  assert.equal(packDigestOf(folder), o.methodBeforeTest.digest, 'original method digest changed');
  assert.equal(sha256(readFileSync(path.join(folder, pipelineFiles.intent))), o.methodBeforeTest.intentSha256, 'original INTENT changed');
  assert.equal(sha256(readFileSync(path.join(folder, pipelineFiles.spec))), o.methodBeforeTest.specSha256, 'original SPEC changed');
  for (const [file, sections] of [[pipelineFiles.intent, HIMA_INTENT_SECTIONS], [pipelineFiles.spec, HIMA_SPEC_SECTIONS], [pipelineFiles.fabric, HIMA_FABRIC_SECTIONS]] as const) {
    assert.deepEqual(sectionsOf(readFileSync(path.join(folder, file), 'utf8')), sections, `${file} sections differ`);
  }
  assert.equal(packStage(folder).stage, 'compiled', 'checkpoint is no longer pre-test compiled');
  const flow = path.join(home, 'numeric-flow');
  assert.equal(realpathSync(o.input.path), path.join(flow, 'numbers.txt'), 'original input path moved');
  assert.equal(sha256(readFileSync(o.input.path)), o.input.sha256, 'original input hash changed');
  assert.equal(readFileSync(o.input.path, 'utf8'), o.input.numbers.join('\n') + '\n', 'input bytes disagree with parent numbers');
  assert.equal(readFileSync(path.join(home, 'cordis.patch.yml'), 'utf8'), '- id: session-title-llm\n  disabled: true\n', 'original native model overlay changed');
  const pack = loadPack(path.dirname(folder), packId);
  const judge = pack.graph.nodes.find((node) => node.kind === 'judge')!;
  const explore = pack.graph.nodes.find((node) => node.kind === 'explore')!;
  assert.ok(judge?.kind === 'judge' && explore?.kind === 'explore' && explore.parameters.chooser, 'checkpoint lacks its Judge/Explore');
  const constraint = resolveRule(pack, judge.parameters.rules[0]!, 'the reading').rule;
  const goal = resolveRule(pack, judge.parameters.rules[1]!, 'the reading').rule;
  const { chooser, origin } = resolveChooser(pack, explore.parameters.chooser, 'the reading');
  assert.ok(origin === 'pack' && Object.values(chooser.reads).some((read) => read.type === 'numeric_sum' && read.unit === 'count')
    && chooser.decide.length === 2 && chooser.decide[0]?.when.constraint === 'PASS' && chooser.decide[0]?.when.goal === 'PASS' && chooser.decide[0]?.goalMet === true
    && chooser.decide[1]?.when.constraint === 'PASS' && (chooser.decide[1]?.when.goal === 'FAIL' || chooser.decide[1]?.when.goal === undefined)
    && chooser.parameter?.unit === 'count' && chooser.decide[1]?.next?.limit === chooser.parameter.name && explore.parameters.bind[chooser.parameter.name] === 0,
  'chooser does not implement ordered Goal completion and bounded fallback');
  // With a present numeric observation and bound Goal, the second ordered clause is reached only
  // after Goal PASS did not match. This does not equate omitted goal with FAIL on unknown data.
  const output = pack.contract.outputs.find((item) => item.name === pack.contract.workshops[0]?.produces);
  assert.ok(output?.reader, 'authored Workshop reader missing');
  const reader = parse(readFileSync(path.join(folder, 'readers', `${output.reader}.yml`), 'utf8')) as { file: string; argv: string[] };
  assert.deepEqual(reader.argv, ['sh', '${READER}', '${REPORT}', '${OUT}'], 'reader argv is outside the admitted direct-check interface');
  const readerScript = realpathSync(path.join(folder, reader.file));
  assert.ok(within(readerScript, path.join(folder, 'tools')) && files.has(readerScript), 'reader must be an original authored tool');
  return { parent, parentPath: path.resolve(parentPath), parentSha256: sha256(bytes), home, folder, bundle, flow, files, readerScript, pack, judge, explore, constraint, goal, chooser,
    author: parent.agents.find((agent) => agent.cwd === folder)!, numbers: o.input.numbers, limit: o.input.limit };
}

/** Run only a copied script against private fixtures, with no inherited model or user environment. */
export function probeReader(script: string, parentDirectory: string) {
  const directory = mkdtempSync(path.join(parentDirectory, 'reader-check-'));
  const copied = path.join(directory, 'reader.sh'); cpSync(script, copied);
  const cases = [
    { name: 'single', input: '7\n', expected: 7 }, { name: 'zero', input: '0\n', expected: 0 },
    { name: 'multiple-lines', input: '1\n2\n' }, { name: 'multiple-tokens', input: '1 2\n' },
    { name: 'empty', input: '' }, { name: 'text', input: 'invalid\n' }, { name: 'negative', input: '-1\n' },
    { name: 'missing', input: undefined }, { name: 'unreadable', input: '9\n' },
  ].map(({ name, input, expected }) => {
    const report = path.join(directory, `${name}.txt`); const out = path.join(directory, `${name}.json`);
    if (input !== undefined) writeFileSync(report, input);
    if (name === 'unreadable') chmodSync(report, 0);
    const result = spawnSync('/bin/sh', [copied, report, out], { cwd: directory, env: { PATH: '/usr/bin:/bin', HOME: directory, TMPDIR: directory, LC_ALL: 'C' }, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 });
    if (name === 'unreadable') chmodSync(report, 0o600);
    const text = existsSync(out) ? readFileSync(out, 'utf8') : null;
    let values: { type?: string; unit?: string; value?: unknown }[] = [];
    let validDocument = false;
    try { const parsed: unknown = JSON.parse(text ?? 'null'); if (parsed && typeof parsed === 'object' && 'values' in parsed && Array.isArray(parsed.values)) { values = parsed.values; validDocument = true; } } catch { /* A failed reader makes no numeric claim. */ }
    const numeric = values.filter((value) => typeof value.value === 'number');
    const passed = expected === undefined ? numeric.length === 0 && !result.error
      : result.status === 0 && validDocument && numeric.length === 1 && numeric[0]!.type === 'numeric_sum' && numeric[0]!.unit === 'count' && numeric[0]!.value === expected;
    return { name, input: input ?? null, expected: expected ?? 'no numeric claim', status: result.status, stdout: result.stdout, stderr: result.stderr, error: result.error?.message ?? null, document: text, passed };
  });
  return { originalScript: script, sha256: sha256(readFileSync(script)), directory, childEnvironment: ['PATH=/usr/bin:/bin', 'HOME=private probe', 'TMPDIR=private probe', 'LC_ALL=C'], cases, passed: cases.every((item) => item.passed) };
}

function retainedHome(home: string): HimaHome {
  return { home, profileDir: path.join(home, 'profiles/hima'), workspace: path.join(home, 'workspace'),
    env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: path.join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
    dispose: async () => { /* This is a retained checkpoint, never a disposable home. */ } };
}

/** Keyless native API validation operates on a copy, because boot/resume may persist metadata. */
export async function preflightOnly(parentPath: string, out: string): Promise<void> {
  assert.ok(!existsSync(out), 'use a fresh preflight output directory');
  const checkpoint = await inspectCheckpoint(parentPath);
  mkdirSync(out, { recursive: true });
  const temporary = realpathSync(mkdtempSync('/tmp/hima-checkpoint-preflight-'));
  const before = await digestTrees([checkpoint.home], path.join(checkpoint.bundle, 'node_modules'));
  const copiedHome = path.join(temporary, 'home');
  cpSync(checkpoint.home, copiedHome, { recursive: true, verbatimSymlinks: true });
  const saved = { TMPDIR: process.env.TMPDIR, TMUX_TMPDIR: process.env.TMUX_TMPDIR, TMUX: process.env.TMUX };
  process.env.TMPDIR = temporary; process.env.TMUX_TMPDIR = temporary; delete process.env.TMUX;
  let requests = 0;
  let evidence: Record<string, unknown> | undefined;
  const host = await bootInProcess(retainedHome(copiedHome));
  host.ctx.on('agent/request', () => { requests++; throw new Error('keyless checkpoint preflight forbids every model request'); });
  try {
    assert.equal(host.ctx.hima.ledger.runs().length, 0, 'retained checkpoint already has a Run');
    const handle = await resumeTestAgent(host.ctx, checkpoint.author.id);
    try {
      assert.equal(String(handle.agent.id), checkpoint.author.id, 'native resume changed Agent identity');
      assert.equal(handle.agent.session.header.cwd, checkpoint.folder, 'persisted author cwd changed');
      assert.deepEqual(injectedSkills(handle.agent), checkpoint.author.skills, 'persisted original stage skills changed');
      assert.deepEqual(toolCalls(handle.agent), checkpoint.author.toolCalls, 'persisted original tool history changed');
      const reader = probeReader(checkpoint.readerScript, temporary);
      assert.equal(requests, 0, 'preflight made a model request');
      evidence = { check: 'pipeline-checkpoint-preflight', passed: true, parentPath: checkpoint.parentPath, parentSha256: checkpoint.parentSha256,
        originalHome: checkpoint.home, copiedHome, hosts: 1, modelRequests: requests, originalAuthor: checkpoint.author.id, skills: injectedSkills(handle.agent), originalMethodDigest: checkpoint.parent.observed.methodBeforeTest.digest,
        reader, readerCorrectionRequired: !reader.passed, scope: 'Read-only original checkpoint; native boot/resume and reader execution used private copies. A reproduced reader defect is a finding, not L4 acceptance.' };
    } finally { await handle.dispose(); }
  } finally {
    await host.dispose();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    assert.deepEqual(changedBetween(before, await digestTrees([checkpoint.home], path.join(checkpoint.bundle, 'node_modules'))), [], 'preflight changed original checkpoint files');
    rmSync(copiedHome, { recursive: true, force: true });
  }
  writeFileSync(path.join(out, 'evidence.json'), JSON.stringify({ ...evidence, originalFilesUnchanged: true, copyRemovedAfterValidation: true }, null, 2) + '\n');
}

async function continueCheckpoint(check: LiveCheck, parentPath: string): Promise<void> {
  const checkpoint = await inspectCheckpoint(parentPath);
  const { parent, folder, home, bundle, flow, readerScript, judge, explore, constraint, goal, numbers, limit } = checkpoint;
  const h = retainedHome(home); check.home = h;
  check.observed.parent = { path: checkpoint.parentPath, sha256: checkpoint.parentSha256, sourceSha: parent.observed.sourceSha, costs: parent.costs,
    originalAuthor: checkpoint.author.id, methodDigest: parent.observed.methodBeforeTest.digest, authoredFiles: parent.observed.authoredFiles,
    originalGuard: { reads: parent.observed.allowedReadRoots, writes: parent.observed.allowedWriteRoot, denied: parent.observed.deniedTools },
    scope: 'First three author stages remain the linked failed parent evidence. Full Golden Flow/other-Pack protection below starts at continuation; no whole-prior-phase tree snapshot was recorded.' };
  check.observed.input = parent.observed.input;
  check.observed.installedBundle = bundle; check.observed.installedBuildHashes = parent.observed.installedBuildHashes;
  check.observed.packFolder = folder;
  const untouched = [flow, path.dirname(folder), bundle];
  const before = await digestTrees(untouched, folder);
  check.observed.continuationBaseline = Object.fromEntries(before);
  const intent = readFileSync(path.join(folder, pipelineFiles.intent), 'utf8');
  const spec = readFileSync(path.join(folder, pipelineFiles.spec), 'utf8');
  const beforeReader = probeReader(readerScript, check.temporary);
  check.observed.readerBefore = beforeReader;
  process.chdir(h.workspace);
  check.observed.hostBootAttempts = 1;
  const host = await bootInProcess(h); check.attach(host);
  check.require('original retained Host has no existing Run', host.ctx.hima.ledger.runs().length === 0, host.ctx.hima.ledger.runs());
  const handle = await resumeTestAgent(host.ctx, checkpoint.author.id);
  const author = check.trackResumed(handle.agent);
  // Hold this exact handle across every stage and turn; disposing between stages can lose ownership.
  try {
    check.require('native resume retained exact original Agent session and Pack workspace', String(author.id) === checkpoint.author.id && String(author.session.id) === checkpoint.author.session && author.session.header.cwd === folder, { id: author.id, session: author.session.id, cwd: author.session.header.cwd });
    check.require('native persisted session retained all original stage injections and tool history', JSON.stringify(injectedSkills(author)) === JSON.stringify(checkpoint.author.skills) && JSON.stringify(toolCalls(author)) === JSON.stringify(checkpoint.author.toolCalls), { skills: injectedSkills(author), originalToolCalls: checkpoint.author.toolCalls.length, resumedToolCalls: toolCalls(author).length });
    guardInstalled(check, host, [bundle, path.dirname(folder), flow, h.workspace], folder);
    let phase: 'review' | 'test' | 'release' = 'review';
    host.ctx.tools.guard((execution) => {
      if (execution.agent && String(execution.agent.id) !== checkpoint.author.id) return 'checkpoint continuation permits only the original author';
      const args = execution.arguments as { file_path?: string; path?: string; action?: string; pack?: string; site?: string; test?: boolean; timeBox?: number; generations?: number; retries?: number; goal?: Record<string, unknown>; strategy?: Record<string, unknown> };
      if (['hima_author', 'hima_run', 'hima_execute', 'hima_observe', 'hima_resume', 'hima_pack_release'].includes(execution.name) && phase === 'review') return 'finish the reader review before creating or executing any Run';
      if (execution.name === 'hima_author') return 'checkpoint already has its original author; no replacement author';
      if (execution.name === 'hima_observe') return 'checkpoint observations must be produced by the owned declared observe node';
      if (execution.name === 'hima_resume') return 'checkpoint must retain its original one-generation test budget and current execution';
      if (execution.name === 'hima_pack_release' && (phase !== 'release' || args.pack !== packId)) return 'release only this verified authored Pack after its test';
      if (execution.name === 'hima_run') {
        if (phase !== 'test' || host.ctx.hima.ledger.runs().length > 0) return 'checkpoint permits exactly one test Run';
        if (args.pack !== packId || args.site !== 'local' || args.test === false || args.timeBox !== 8 || args.generations !== 1 || args.retries !== 2
          || !args.goal || Object.keys(args.goal).length !== 1 || Number(args.goal.minimum) !== 1
          || !args.strategy || Object.keys(args.strategy).length !== 1 || Number(args.strategy.limit) !== limit) return 'use the original approved Pack Site Goal strategy and exact 8-minute/1-generation/2-retry test budget';
      }
      if (['write', 'edit'].includes(execution.name)) {
        const at = path.resolve(folder, args.file_path ?? args.path ?? '');
        const allowed = phase === 'review' ? [readerScript, path.join(folder, pipelineFiles.fabric)] : phase === 'test' ? [path.join(folder, pipelineFiles.test)] : [];
        if (!allowed.includes(at)) return `checkpoint ${phase} stage does not authorize this file change`;
      }
      return undefined;
    });
    const record = (filename: string, sections: readonly string[]) => {
      const at = path.join(folder, filename); check.require(`real author wrote ${filename}`, existsSync(at), at);
      const text = readFileSync(at, 'utf8'); check.require(`${filename} has its required sections`, JSON.stringify(sectionsOf(text)) === JSON.stringify(sections), sectionsOf(text)); return text;
    };
    const stage = (expected: string) => check.require(`Pack stage reached ${expected}`, packStage(folder).stage === expected, packStage(folder));
    if (!beforeReader.passed) {
      await check.say(author, `/hima-fabric ${packId}. Continue this exact compiled method before its first test Run. Concrete author review of your reader ${path.relative(folder, readerScript)}: ${JSON.stringify(beforeReader.cases.filter((item) => !item.passed))}. This private, sanitized invocation used your exact script hash ${beforeReader.sha256}. The approved contract requires exactly one nonnegative integer; multiple values cannot be concatenated into a numeric claim. I approve correcting only this reader script and recording the review/correction in FABRIC.md. Read your actual reader, fix this reproduced defect, check valid single integer and malformed/missing/unreadable handling, and call hima_pack_check. Keep INTENT, SPEC, contract, graph, rules, chooser, knowledge and preparation unchanged. No Run yet. Runtime experiment code still belongs to the Workshop.`);
      const correctionDelta = changedBetween(checkpoint.files, await digestTrees([folder], folder + '.excluded'));
      check.require('pre-Run model correction changed only the reader and FABRIC record', correctionDelta.length === 2 && [readerScript, path.join(folder, pipelineFiles.fabric)].every((at) => correctionDelta.includes(`${at} (rewritten)`)), correctionDelta);
      record(pipelineFiles.fabric, HIMA_FABRIC_SECTIONS);
    }
    const afterReader = probeReader(readerScript, check.temporary); check.observed.readerAfter = afterReader;
    check.require('actual corrected reader accepts a single integer and makes no malformed missing or unreadable numeric claim', afterReader.passed, afterReader);
    check.require('reader review created no Run and preserved compiled stage', host.ctx.hima.ledger.runs().length === 0 && packStage(folder).stage === 'compiled', host.ctx.hima.ledger.runs());
    const methodBeforeTest = packDigestOf(folder);
    check.observed.methodCorrection = { parentDigest: parent.observed.methodBeforeTest.digest, correctedDigest: methodBeforeTest, beforeReaderSha256: beforeReader.sha256, afterReaderSha256: afterReader.sha256, filesBefore: parent.observed.authoredFiles, filesAfter: Object.fromEntries(await digestTrees([folder], folder + '.excluded')) };
    const testCallStart = toolCalls(author).length;
    phase = 'test';
    await check.say(author, `/hima-test ${packId} on site local; goal minimum=1, strategy limit=${limit}, generations=1, retries=2, timeBox=8. You are this test Run's execution owner. Keep the same native conversation. Create exactly one Run; freeze the corrected current method. The Run requires actual Workshop read/knowledge/write/code, asynchronous work, reader and ordered Judge, then explicit Explore completion with decision goal-met and actual current observation/verdict cites after both rules PASS. A terminal Judge alone is insufficient. Use the installed skill's hima_context/hima_execute protocol until terminal, then write TEST.md from true records. All method files are immutable during testing. Do not recreate the author or repeat earlier authoring stages.`);
    for (let round = 0; round < 7 && packStage(folder).stage !== 'tested'; round++) {
      const runs = host.ctx.hima.ledger.runs();
      if (runs.some((run) => run.status === 'waiting' || (run.status?.startsWith('ended-') === true && run.status !== 'ended-goal-met'))) break;
      await check.say(author, 'Continue the same /hima-test stage and existing Run. Read hima_context and actual execution phases; complete only ready work, explicitly select successors, and wait for a still-running Job notification. Once current constraint and Goal both PASS, complete the declared Explore with explicit goal-met and actual observation/verdict cites. On terminal status write TEST.md from hima_status records and call hima_pack_check. Keep the same owner, original budget and immutable method; no replacement Run.');
    }
    const testText = record(pipelineFiles.test, HIMA_TEST_SECTIONS);
    const named = new RegExp(`^run: (${runIdPattern.source})$`, 'm').exec(testText);
    const row = named ? host.ctx.hima.ledger.run(named[1]!) : undefined;
    check.require('TEST.md names the actual owned Goal-met test Run', !!row && row.packId === packId && row.purpose === 'test' && row.status === 'ended-goal-met' && row.control?.owner === String(author.id) && /^status: ended-goal-met$/m.test(testText), row ?? null);
    check.require('one Run retained the original one-generation budget Goal cutoff and owner', host.ctx.hima.ledger.runs().length === 1 && row?.budget?.timeBoxMs === 480_000 && row.budget.generationLimit === 1 && row.budget.retryAllowance === 2 && row.generation === 1 && row.goal?.minimum === 1 && row.firstStrategy?.limit === limit && row.strategy?.limit === limit && row.control?.epoch === 1, row ?? null);
    check.require('test froze and executed the corrected model-authored method', row?.packDigest === methodBeforeTest && packDigestOf(folder) === methodBeforeTest, { parent: parent.observed.methodBeforeTest.digest, before: methodBeforeTest, run: row?.packDigest, after: packDigestOf(folder) });
    const records = host.ctx.hima.ledger.records({ runId: row!.id });
    const workspace = records.findLast((r) => r.type === 'workspace');
    check.require('Run workspace holds corrected method and unchanged measured input', workspace?.type === 'workspace' && workspace.packDigest === methodBeforeTest
      && sha256(readFileSync(path.join(workspace.workspace, 'flow/numbers.txt'))) === parent.observed.input.sha256
      && sha256(readFileSync(path.join(workspace.workspace, 'flow/measured.txt'))) === parent.observed.input.sha256, workspace);
    const expected = numbers.filter((n) => n > limit).reduce((sum, n) => sum + n, 0);
    const current = records.filter((r) => r.generation === 1 && r.loopId === undefined && (!('branchId' in r) || r.branchId === undefined));
    const observation = current.findLast((r) => r.type === 'observation' && r.values.some((value) => value.type === 'numeric_sum' && value.unit === 'count' && value.value === expected));
    check.require('authored reader measured the independent actual-input strict-bound sum', observation?.type === 'observation', { expected, initialLimit: limit, observations: current.filter((r) => r.type === 'observation') });
    assert.ok(observation?.type === 'observation');
    check.require('observation identifies the corrected reader bytes', observation.reader.sha256 === afterReader.sha256, observation.reader);
    const outputBytes = readFileSync(observation.path);
    check.require('actual output contains the exact independent sum with matching observed hash', outputBytes.toString('utf8').trim() === String(expected) && sha256(outputBytes) === observation.contentSha256, { path: observation.path, expected, actual: outputBytes.toString('utf8'), observedSha256: observation.contentSha256, actualSha256: sha256(outputBytes) });
    const constraintVerdict = current.findLast((r) => r.type === 'verdict' && r.ruleId === constraint.id && r.ruleVersion === constraint.version);
    const goalVerdict = current.findLast((r) => r.type === 'verdict' && r.ruleId === goal.id && r.ruleVersion === goal.version);
    assert.ok(constraintVerdict?.type === 'verdict' && goalVerdict?.type === 'verdict', 'current ordered Judge verdicts missing');
    check.require('actual current constraint and bound Goal PASS cite the verified observation', constraintVerdict.outcome === 'PASS' && goalVerdict.outcome === 'PASS' && goalVerdict.boundParameters?.minimum === 1 && constraintVerdict.cites.includes(observation.id) && goalVerdict.cites.includes(observation.id), { constraintVerdict, goalVerdict });
    const decision = current.findLast((r) => r.type === 'decision' && r.nodeId === explore.id);
    check.require('original owner completed Explore goal-met with actual current observation and both verdicts', decision?.type === 'decision' && 'goalMet' in decision.chosen && decision.chosen.goalMet && decision.agent?.sessionId === String(author.id) && row!.control?.executions[decision.agent.executionId]?.phase === 'completed' && [observation.id, constraintVerdict.id, goalVerdict.id].every((id) => decision.cites.includes(id)) && current.some((r) => r.type === 'node' && r.nodeId === judge.id && r.state === 'done' && r.seq < decision.seq), decision);
    check.observed.currentSuccess = { expected, initialLimit: limit, observation, constraintVerdict, goalVerdict, decision };
    const codes = records.filter((r) => r.type === 'code');
    check.observed.code = codes.map((r) => ({ record: r, content: readFileSync(r.path, 'utf8'), actualSha256: sha256(readFileSync(r.path)) }));
    check.require('original model generated Workshop code whose actual bytes match recorded hashes', codes.length > 0 && codes.every((r) => r.sessionId === String(author.id) && sha256(readFileSync(r.path)) === r.sha256), check.observed.code);
    const testCalls = toolCalls(author).slice(testCallStart);
    check.require('original author test used all controlled owned Workshop actions', ['begin', 'read', 'knowledge', 'write', 'work', 'complete'].every((action) => testCalls.some((call) => call.name === 'hima_execute' && call.args.action === action)), testCalls);
    stage('tested');
    phase = 'release';
    const releaseCallStart = toolCalls(author).length;
    await check.say(author, `/hima-release ${packId}`);
    const releaseCalls = toolCalls(author).slice(releaseCallStart);
    check.require('release used actual release tool without handwritten files', releaseCalls.some((call) => call.name === 'hima_pack_release') && !releaseCalls.some((call) => ['write', 'edit'].includes(call.name)), releaseCalls);
    const seal = packVersionFile.parse(parse(readFileSync(path.join(folder, pipelineFiles.version), 'utf8')));
    check.require('release seal names the exact Run and corrected method with actual file hashes', seal.test.run === row!.id && seal.methodDigest === methodBeforeTest && packDigestOf(folder) === methodBeforeTest && Object.entries(seal.files).every(([at, hash]) => sha256(readFileSync(path.join(folder, at))) === hash), seal);
    stage('released');
    check.require('all five skills are in the same original persisted session', [...firstSkills, 'hima-test', 'hima-release'].every((name) => injectedSkills(author).includes(name)), injectedSkills(author));
    check.require('original INTENT and SPEC survived correction test and release', readFileSync(path.join(folder, pipelineFiles.intent), 'utf8') === intent && readFileSync(path.join(folder, pipelineFiles.spec), 'utf8') === spec, { intentSha256: sha256(intent), specSha256: sha256(spec) });
    const changed = changedBetween(before, await digestTrees(untouched, folder));
    check.require('Golden Flow other Packs and installed bundle stayed unchanged throughout continuation', changed.length === 0, changed);
    check.require('continuation used only original native model session and no separate moment', check.agents.length === 1 && check.resumedSessions.size === 1 && check.requestSessions.size === 1 && check.requestSessions.has(checkpoint.author.id) && records.every((r) => r.type !== 'session'), { resumed: [...check.resumedSessions], model: [...check.requestSessions] });
    check.require('parent failed evidence remains byte-for-byte unchanged', sha256(readFileSync(parentPath)) === checkpoint.parentSha256, checkpoint.parentSha256);
    check.observed.finalPackFiles = Object.fromEntries(await digestTrees([folder], folder + '.excluded'));
  } finally {
    check.observed.finalContinuationFiles = Object.fromEntries(await digestTrees([folder], folder + '.excluded'));
    check.observed.protectedContinuationDelta = changedBetween(before, await digestTrees(untouched, folder));
    check.observed.parentStillUnchanged = sha256(readFileSync(parentPath)) === checkpoint.parentSha256;
    check.observed.costAccounting = { parent: parent.costs, continuation: { hosts: 1, nativeSessionsCreated: 0, nativeSessionsResumed: check.resumedSessions.size, modelRequestSteps: check.steps, userMessages: check.turns },
      aggregate: { hosts: parent.costs.hosts + 1, nativeSessionsCreated: parent.costs.nativeSessionsCreated, modelSessions: 1, modelRequestSteps: parent.costs.modelRequestSteps + check.steps, userMessages: parent.costs.userMessages + check.turns }, apiRequests: 'unmeasured; request steps exclude adapter retries', tokens: 'unmeasured' };
    check.checkpoint();
    await handle.dispose();
  }
}

export function checkpointArguments(args: string[]) {
  const parentIndex = args.indexOf('--parent');
  assert.ok(parentIndex >= 0 && args[parentIndex + 1] && !args[parentIndex + 1]!.startsWith('--'), '--parent <original-evidence.json> is required');
  const parentPath = path.resolve(args[parentIndex + 1]!);
  const remaining = args.filter((_, i) => i !== parentIndex && i !== parentIndex + 1);
  const preflight = remaining.includes('--preflight-only');
  return { parentPath, preflight, remaining: remaining.filter((arg) => arg !== '--preflight-only') };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('usage: node scripts/live-check-pipeline-checkpoint.ts --parent <original-evidence.json> --out <fresh-directory> [--preflight-only | --timeout-ms 720000 --max-turns 12 --max-steps 100]\nPreflight uses no credential or model and boots only a copy. Live continuation requires the inherited DEEPSEEK_API_KEY; never pass credentials as arguments. Live limits are at most 12 minutes, 12 user turns, 100 model request steps. The single product Run retains generations=1, retries=2, timeBox=8.\n');
  } else {
    const args = checkpointArguments(process.argv.slice(2));
    if (args.preflight) {
      assert.ok(args.remaining.length === 2 && args.remaining[0] === '--out' && args.remaining[1], 'preflight requires only --parent, --out and --preflight-only');
      await preflightOnly(args.parentPath, path.resolve(args.remaining[1]));
      process.stdout.write('checkpoint preflight PASS; inspect reader findings before live continuation\n');
    } else {
      process.argv.splice(2, process.argv.length - 2, ...args.remaining);
      await runLive('live-check-pipeline-checkpoint', 12, (check) => continueCheckpoint(check, args.parentPath));
    }
  }
}
