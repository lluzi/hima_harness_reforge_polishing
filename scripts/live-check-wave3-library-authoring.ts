// Bounded Wave 3 authoring qualification: native Guide -> native author -> local Host TEST.
// It deliberately never starts QuaLib, edarun, Desktop or a production Library analysis.
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parse } from 'yaml';
import { applyPackTransfer, installPackMethod, loadPack, packDigestOf, packStage, pipelineFiles, previewPackTransfer, recoverPackMethod, resolveChooser, resolveRule } from '@hima/harness';
import { bootInProcess, createRootAgent, injectedSkills, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import { createHimaHome, repoRoot } from '../test/contract/support/dsh-home.ts';
import { installPack, packsDirOf } from '../test/contract/support/pack.ts';
import { writeLocalSite } from '../test/contract/support/site.ts';
import { guardInstalled, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';
import { prepareHimaHome, homePatchFile } from '../packages/desktop/src/hima-home.ts';

const packId = 'library-authoring-qualification';
const source = path.join(repoRoot, 'test/fixtures/wave3-library-authoring');

function sourceFiles(root: string) {
  return ['SOP.md', 'qualification-requirements.md', 'report-requirements.md'].map((name) => {
    const at = path.join(root, name); const bytes = readFileSync(at);
    return { name, at, sha256: sha256(bytes), bytes: bytes.byteLength };
  });
}

async function completeStage(check: LiveCheck, author: Awaited<ReturnType<typeof createRootAgent>>, folder: string, command: string, expected: string, reminder: string) {
  await check.say(author, command);
  for (let i = 0; i < 4 && packStage(folder).stage !== expected; i += 1) {
    await check.say(author, reminder);
  }
  const actual = packStage(folder);
  check.require(`author reached ${expected}`, actual.stage === expected, actual);
}

function testRunFromRecord(host: Awaited<ReturnType<typeof bootInProcess>>, folder: string) {
  const text = readFileSync(path.join(folder, pipelineFiles.test), 'utf8');
  const named = /^run: (run-[0-9a-f-]+)$/m.exec(text)?.[1];
  return named === undefined ? undefined : host.ctx.hima.ledger.run(named);
}

await runLive('live-check-wave3-library-authoring', 32, async (check: LiveCheck) => {
  const h = await createHimaHome(); check.home = h;
  await prepareHimaHome({ home: h.home, bundleMode: 'installed' });
  await installPack(h);
  const bundle = path.join(h.profileDir, 'node_modules/@hima/harness');
  const sourcesRoot = path.join(h.workspace, 'library-authoring-source');
  cpSync(source, sourcesRoot, { recursive: true });
  const flow = path.join(sourcesRoot, 'flow');
  await writeLocalSite(h, { allowedReadRoots: [h.workspace, flow], allowedWriteRoots: [h.workspace], allowedWrappers: ['sh', 'python3'], licences: {}, bindings: { flowRoot: flow, design: 'library-authoring-qualification', workspaceRoot: h.workspace } });
  writeFileSync(homePatchFile(h.home), '- id: session-title-llm\n  disabled: true\n');
  process.chdir(h.workspace);
  const host = await bootInProcess(h); check.attach(host);
  const guide = check.track(await createRootAgent(host.ctx, h.workspace));
  const opened = await host.ctx.tools.execute({ name: 'hima_author', arguments: {
    pack: packId, create: true, handoff: {
      goal: 'Author a bounded Library Insight authoring-qualification Pack without commercial EDA.',
      sourcePaths: ['library-authoring-source/SOP.md', 'library-authoring-source/qualification-requirements.md', 'library-authoring-source/report-requirements.md'],
      inputGaps: ['Native QuaLib and production Library facts are deliberately out of scope for this authoring qualification.'],
    },
  }, agent: guide, callId: 'wave3-author-open' as never, signal: AbortSignal.timeout(20_000) });
  if (opened.isError) throw new Error(`Guide handoff refused: ${JSON.stringify(opened)}`);
  const value = (opened as unknown as { value: { folder: string; sessionId: string; handoffMessageId?: string } }).value;
  const author = check.track(host.ctx.agents.get(value.sessionId as never)!);
  guardInstalled(check, host, [bundle, packsDirOf(h), flow, h.workspace], value.folder);
  check.require('Guide stayed separate from the native author session', !!author && String(author.id) !== String(guide.id) && author.session.header.cwd === value.folder, { guide: guide.id, author: value });
  check.require('Guide delivered a source-hashed handoff from the new SOP, not the Wave 2 Pack', Boolean(value.handoffMessageId) && sourceFiles(sourcesRoot).every((file) => JSON.stringify(author.inbox.nextStep).includes(file.sha256)) && !JSON.stringify(author.inbox.nextStep).includes('packs/library-intelligence'), { handoff: author.inbox.nextStep, sources: sourceFiles(sourcesRoot) });

  const answer = [
    'Use the three handed-off source files as the authority. The local Golden Flow is the adjacent flow directory named in SOP.md.',
    'The Pack must state that it only checks a local authoring-qualification input: it does not invoke Liberty, QuaLib, edarun, production Library facts, E1--E4 requalification, or customer data.',
    'One generation runs the Golden Flow command, declares its reader-backed output exactly as `libraryContract`, emits library_contract_ready=1 count only after all required identity/schema/provenance/unknown fields validate, then judges it with two ordered rules: constraint library-contract-nonnegative >=0 count, then goal library-contract-goal >= bound goal 1 count. Only PASS/PASS may explicitly complete Explore/decide as goalMet and end the Run; FAIL or unknown goes to declared wait/refusal. Invalid or absent input must have no success value.',
    'The contract must have exactly one strategy knob: inputFixture as a one-option choice/default library-input.json; analyze binds INPUT_FIXTURE from it. PASS/PASS chooses goalMet, never a next strategy. Use Site local, one generation, one retry and a short time box. Keep the flow outside the Pack and do not claim commercial qualification.',
  ].join('\n');
  await check.say(author, `/hima-grill I want a new ${packId} Pack. ${answer}\nAsk the required business questions before writing INTENT.md.`);
  await check.say(author, `Author answers:\n${answer}\nThe author approves this bounded scope; write INTENT.md after reading the source files and Golden Flow.`);
  await check.say(author, '/hima-grill recommended. The author explicitly accepts the flow\'s two-command generation, the envelope `schema` field, the three stated endings, one generation/one retry/300 s/no licence budget, and every listed malformed or missing-field counterexample. Write INTENT.md now; do not infer any commercial Library fact.');
  await completeStage(check, author, value.folder, '/hima-spec', 'specified', 'Read INTENT.md and the Golden Flow. Write only SPEC.md with the nine required sections; use the local source contract and do not add EDA or commercial claims.');
  await completeStage(check, author, value.folder, `/hima-fabric ${packId} on site local`, 'compiled', 'Compile only the source-approved local Library authoring-qualification method. Read the flow in place, review every Pack-local script with the author, run hima_pack_check, and fix only actual Pack-local errors.');
  const compiled = loadPack(packsDirOf(h), packId);
  const judge = compiled.graph.nodes.find((node) => node.id === 'judge');
  const decide = compiled.graph.nodes.find((node) => node.id === 'decide');
  const ruleRefs = judge?.kind === 'judge' ? judge.parameters.rules : undefined;
  const chooserRef = decide?.kind === 'explore' ? decide.parameters.chooser : undefined;
  const inputFixture = compiled.contract.strategy.inputFixture;
  const analyze = compiled.graph.nodes.find((node) => node.id === 'analyze');
  const inputBinding = analyze?.kind === 'act' ? analyze.parameters.arguments?.INPUT_FIXTURE : undefined;
  const constraint = ruleRefs?.[0] === undefined ? undefined : resolveRule(compiled, ruleRefs[0], 'the reading').rule;
  const goal = ruleRefs?.[1] === undefined ? undefined : resolveRule(compiled, ruleRefs[1], 'the reading').rule;
  const chooser = chooserRef === undefined ? undefined : resolveChooser(compiled, chooserRef, 'the reading').chooser;
  check.require('compiled Pack resolves ordered constraint/goal rules and PASS/PASS Explore goalMet semantics',
    Object.keys(compiled.contract.strategy).length === 1 && inputFixture?.type === 'choice'
      && inputFixture.options.length === 1 && inputFixture.options[0] === 'library-input.json' && inputFixture.default === 'library-input.json'
      && typeof inputBinding === 'object' && inputBinding !== null
      && inputBinding.from === 'strategy' && inputBinding.name === 'inputFixture'
      && ruleRefs?.length === 2 && ruleRefs[0] === 'library-contract-nonnegative' && ruleRefs[1] === 'library-contract-goal'
      && constraint?.predicate.op === 'gte' && constraint.predicate.threshold === 0
      && goal?.predicate.op === 'gte' && typeof goal.predicate.threshold === 'object' && 'parameter' in goal.predicate.threshold
      && chooser?.decide[0]?.when.constraint === 'PASS' && chooser.decide[0]?.when.goal === 'PASS' && chooser.decide[0]?.goalMet === true,
    { inputFixture, inputBinding, analyze, ruleRefs, constraint, goal, chooser, decide });
  await completeStage(check, author, value.folder, `/hima-test ${packId} on site local; goal library_contract_ready=1, generations=1, retries=1, timeBox=60`, 'tested', 'Continue the same TEST Run only. Read current Host context, execute ready nodes through the explicit Explore/decide goalMet completion, wait for the terminal Run, then rewrite TEST.md from hima_status. Do not create a replacement Run or invent evidence.');
  for (let i = 0; i < 3 && !testRunFromRecord(host, value.folder)?.status?.startsWith('ended-'); i += 1) {
    await check.say(author, 'TEST.md names a non-terminal Run and cannot be TEST evidence. Continue the same Run through the declared Explore/decide outcome; do not create another Run. Once terminal, rewrite TEST.md from that same Run, then run hima_pack_check.');
  }
  const testedRun = testRunFromRecord(host, value.folder);
  check.require('TEST record names one terminal Run at a declared non-budget ending', !!testedRun && testedRun.status?.startsWith('ended-') === true
    && testedRun.meters?.endedBy !== 'generation-limit', testedRun);
  await completeStage(check, author, value.folder, `/hima-release ${packId}`, 'released', 'Release only through hima_pack_release. Do not handwrite VERSION.yml; report the sealed TEST Run and current integrity limit.');

  const folder = value.folder;
  const pack = loadPack(packsDirOf(h), packId);
  const runLine = /^run: (run-[0-9a-f-]+)$/m.exec(readFileSync(path.join(folder, pipelineFiles.test), 'utf8'));
  const run = runLine ? host.ctx.hima.ledger.run(runLine[1]!) : undefined;
  const records = run ? host.ctx.hima.ledger.records({ runId: run.id }) : [];
  check.require('TEST is a real local Host Run with Job, Reader and Judge evidence', !!run && run.purpose === 'test' && run.packDigest === packDigestOf(folder)
    && records.some((r) => r.type === 'job' && r.event === 'launched') && records.some((r) => r.type === 'observation') && records.some((r) => r.type === 'verdict'), { run, records });
  check.require('author used all five human-invocable stages and a release tool', ['hima-grill', 'hima-spec', 'hima-fabric', 'hima-test', 'hima-release'].every((name) => injectedSkills(author).includes(name)) && toolCalls(author).some((call) => call.name === 'hima_pack_release'), { skills: injectedSkills(author), calls: toolCalls(author) });
  const executionHeads = [
    ...pack.contract.environment.wrappers,
    ...pack.contract.tools.flatMap((tool) => tool.argv),
    ...pack.contract.workshops.flatMap((workshop) => workshop.argv),
  ];
  check.require('new Pack declares bounded scope without a commercial execution dependency', /authoring-qualification/i.test(readFileSync(path.join(folder, pipelineFiles.intent), 'utf8'))
    && executionHeads.every((word) => !/^(?:edarun|qualib)$/i.test(word))
    && pack.contract.workshops.every((workshop) => Object.keys(workshop.licences).length === 0), { executionHeads, workshops: pack.contract.workshops });
  const readerId = pack.contract.outputs.find((output) => output.name === 'libraryContract')?.reader;
  const reader = readerId ? parse(readFileSync(path.join(folder, 'readers', `${readerId}.yml`), 'utf8')) as { file?: string; argv?: string[] } : undefined;
  const malformed = path.join(h.workspace, 'malformed-library-insight.json'); const refusal = path.join(h.workspace, 'malformed-reader-output.json');
  writeFileSync(malformed, '{}\n');
  const argv = reader?.argv?.map((item) => item.replace('${READER}', path.join(folder, reader.file ?? '')).replace('${REPORT}', malformed).replace('${OUT}', refusal));
  const readerRun = argv?.[0] ? spawnSync(argv[0], argv.slice(1), { cwd: h.workspace, encoding: 'utf8', timeout: 10_000 }) : undefined;
  const refusalBytes = existsSync(refusal) ? readFileSync(refusal, 'utf8') : '';
  const refusalReading = refusalBytes ? JSON.parse(refusalBytes) as { values?: Array<{ type?: string; value?: unknown; unknownReason?: string }> } : {};
  const malformedValue = refusalReading.values?.find((entry) => entry.type === 'library_contract_ready');
  check.require('author-generated Reader refuses or marks a malformed required-field report unknown without a success value', !!readerRun
    && (readerRun.status !== 0 || (malformedValue?.value == null && Boolean(malformedValue?.unknownReason))), { reader, readerRun, refusalReading });

  const installed = path.join(h.home, 'installed', packId);
  const install = previewPackTransfer({ from: folder, to: installed, mode: 'install' });
  applyPackTransfer({ from: folder, to: installed, mode: 'install', reviewSha256: install.reviewSha256 });
  const asset = path.join(installed, 'run-assets/customer-note.txt'); mkdirSync(path.dirname(asset), { recursive: true }); writeFileSync(asset, 'customer bytes stay local\n');
  const upgrade = previewPackTransfer({ from: folder, to: installed, mode: 'upgrade' });
  applyPackTransfer({ from: folder, to: installed, mode: 'upgrade', reviewSha256: upgrade.reviewSha256 });
  check.require('previewed install and idempotent upgrade preserve customer asset bytes', readFileSync(asset, 'utf8') === 'customer bytes stay local\n' && install.methodDigest === upgrade.methodDigest, { install, upgrade, assetSha256: sha256(readFileSync(asset)) });
  const staleTo = path.join(h.home, 'stale', packId); const stale = previewPackTransfer({ from: folder, to: staleTo, mode: 'install' });
  const intent = path.join(folder, pipelineFiles.intent); const before = readFileSync(intent, 'utf8'); writeFileSync(intent, `${before}\n`);
  assert.throws(() => applyPackTransfer({ from: folder, to: staleTo, mode: 'install', reviewSha256: stale.reviewSha256 }), /changed|review|no longer hashes/);
  writeFileSync(intent, before);
  check.require('stale review is rejected before destination write and restored method still seals', !existsSync(staleTo) && packStage(folder).stage === 'released', { staleTo, stage: packStage(folder) });
  const oldDigest = packDigestOf(installed); const candidate = path.join(h.home, 'upgrade-candidate', packId);
  cpSync(folder, candidate, { recursive: true });
  rmSync(path.join(candidate, pipelineFiles.version));
  const candidateContract = path.join(candidate, 'contract.yml');
  writeFileSync(candidateContract, readFileSync(candidateContract, 'utf8').replace(/version:\s*['\"]?([^'\"\n]+)['\"]?/, 'version: "2"'));
  chmodSync(path.join(installed, 'tools'), 0o500);
  try {
    assert.throws(() => installPackMethod({ from: candidate, to: installed }), /EACCES|EPERM/);
    assert.throws(() => loadPack(path.dirname(installed), packId), /interrupted method update/);
  } finally { chmodSync(path.join(installed, 'tools'), 0o700); }
  const rolledBack = recoverPackMethod({ to: installed, action: 'rollback' });
  check.require('interrupted upgrade rolls back to the verified old method and preserves customer bytes', rolledBack.digest === oldDigest && packDigestOf(installed) === oldDigest && readFileSync(asset, 'utf8') === 'customer bytes stay local\n', { rolledBack, oldDigest, asset });
});
