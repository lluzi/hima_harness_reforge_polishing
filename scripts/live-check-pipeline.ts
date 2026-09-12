// Bounded installed-consumer L4. Only the real model authors Pack and pipeline record files.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, loadPack, packDigestOf, packStage, packVersionFile, pipelineFiles, runIdPattern } from '@hima/harness';
import { bootInProcess, createRootAgent, injectedSkills, toolCalls } from '../test/contract/support/boot-inprocess.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { changedBetween, digestTrees, sectionsOf } from '../test/contract/support/pipeline.ts';
import { guardInstalled, numericHome, runLive, sha256, type LiveCheck } from './live-check-workshop.ts';

const packId = 'authored-numeric';
await runLive('live-check-pipeline', 24, async (check: LiveCheck) => {
  const { h, flow, bundle, numbers, limit } = await numericHome(check);
  check.observed.hostBootAttempts = 1;
  const host = await bootInProcess(h); check.attach(host);
  const chat = check.track(await createRootAgent(host.ctx, h.workspace));
  const result = await host.ctx.tools.execute({ name: 'hima_author', arguments: { pack: packId, create: true }, agent: chat, callId: 'live-author-open' as never, signal: AbortSignal.timeout(20_000) });
  if (result.isError) throw new Error('hima_author refused to create the native Pack session');
  const opened = (result as unknown as { value: { sessionId: string; folder: string } }).value;
  const author = check.track(host.ctx.agents.get(opened.sessionId as never)!);
  check.require('hima_author created a real Pack workspace session', !!author && author.session.header.cwd === opened.folder, opened);
  const folder = opened.folder;
  guardInstalled(check, host, [bundle, packsDirOf(h), flow, h.workspace], folder);
  check.observed.packFolder = folder;
  const untouched = [flow, packsDirOf(h)];
  const before = await digestTrees(untouched, folder);
  const stage = (expected: string) => {
    const actual = packStage(folder);
    check.require(`Pack stage reached ${expected}`, actual.stage === expected, actual);
  };
  const record = (filename: string, sections: readonly string[]) => {
    const at = path.join(folder, filename);
    check.require(`real author wrote ${filename}`, existsSync(at), at);
    const content = readFileSync(at, 'utf8');
    check.require(`${filename} has its required sections`, JSON.stringify(sectionsOf(content)) === JSON.stringify(sections), sectionsOf(content));
    return content;
  };
  const facts = [
    'This is a tiny numeric-analysis method, with no EDA or licences. Each generation has one nonnegative integer per line as actual input.',
    `The Golden Flow is ${flow}; inspect README.md and prepare.sh there. Preparation is sh prepare.sh <flow-directory> in the private workspace copy; it produces measured.txt from numbers.txt.`,
    `Strategy limit has unit count, bounds 0..100 and default ${limit}; Workshop scalar LIMIT binds from strategy limit. Goal minimum has unit count, bounds 0..10000, default 1; this test explicitly requests minimum=1.`,
    'Analysis sums only actual measured values strictly greater than LIMIT. The sum itself is the output; equality to LIMIT is excluded. The minimum is only the acceptance bound, not the output to fabricate.',
    'Compile one preparation tool, one real Workshop act node, one observing act node, one Judge, and the required hard-blocker wait. This is a one-generation method without a chooser or revisit. Declare its actual terminal ending; budget/blocked endings remain facts, not successful analysis.',
    'The Workshop reads the declared measured output, has one declared knowledge file explaining the exact sum, generates its own script during the test Run, and produces result.txt via a declared custom reader. The reader emits numeric_sum in count; the Judge requires numeric_sum >= goal minimum.',
    'Workshop entry argv can be sh ${ENTRY} ${WORKSPACE} ${LIMIT}; the generated script reads $1/flow/measured.txt and writes the integer alone to $1/result.txt. Use a private research directory for generated code. No delay is needed in this authoring test.',
    'Keep Golden Flow read-only. The Pack copies only needed flow inputs/scripts into its workspace. Runtime script creation belongs to the Workshop, not to method authoring. Knowledge unrelated to this numerical business should be marked inapplicable.',
  ].join('\n');

  await check.say(author, `/hima-grill I want a new ${packId} Pack that analyzes measured numeric inputs with an AI-written script and verifies the output. The Golden Flow is ${flow}. Ask the business questions before authoring.`);
  check.require('grill waited for author answers before recording intent', !existsSync(path.join(folder, pipelineFiles.intent)), toolCalls(author));
  await check.say(author, `Author answers and complete approved business contract:\n${facts}\nThese resolve the data, Goal, strategy, ending and Workshop semantics. Read the actual Golden Flow and write INTENT.md when sufficient.`);
  if (!existsSync(path.join(folder, pipelineFiles.intent))) await check.say(author, `The author confirms the stated contract and recommends no further scope. ${facts}\nRecord the confirmed answers in INTENT.md; if a concrete contradiction remains, stop and identify it.`);
  const intent = record(pipelineFiles.intent, HIMA_INTENT_SECTIONS);
  const beforeSpec = await digestTrees([folder], folder + '.excluded');
  await check.say(author, '/hima-spec');
  record(pipelineFiles.spec, HIMA_SPEC_SECTIONS);
  const specDelta = changedBetween(beforeSpec, await digestTrees([folder], folder + '.excluded'));
  check.require('spec added only SPEC.md', specDelta.length === 1 && specDelta[0] === `${path.join(folder, pipelineFiles.spec)} (new)`, specDelta);
  stage('specified');

  await check.say(author, `/hima-fabric ${packId} on site local. Compile the approved tiny numeric method, including its real Workshop, graph, reader and Judge. Use installed skill anatomy and reference Pack files for schema. Read the Golden Flow in place. Put generated tool/reader scripts to the author for review.`);
  // These are bounded author approvals, not a fixture or fixed model-phrase matcher.
  for (let round = 0; round < 3 && packStage(folder).stage !== 'compiled'; round++) {
    await check.say(author, `Author review: I approve the generated numeric prepare and reader scripts described above if their effects stay in the private Campaign workspace and implement the approved contract. Keep INTENT.md and SPEC.md unchanged. Finish the declared files, ask hima_pack_check, correct only actual compilation errors, and record completed reviews in FABRIC.md. If a business contradiction remains, stop.`);
  }
  record(pipelineFiles.fabric, HIMA_FABRIC_SECTIONS);
  stage('compiled');
  const pack = loadPack(packsDirOf(h), packId);
  check.require('model authored a real Workshop with graph and reader', pack.contract.workshops.length === 1 && pack.graph.nodes.some((node) => node.kind === 'act' && 'workshop' in node.parameters) && pack.contract.outputs.some((output) => output.reader !== undefined), { contract: pack.contract, graph: pack.graph });
  const methodBeforeTest = packDigestOf(folder);
  check.observed.authoredFiles = Object.fromEntries(await digestTrees([folder], folder + '.excluded'));

  const testCallStart = toolCalls(author).length;
  await check.say(author, `/hima-test ${packId} on site local; goal minimum=1, strategy limit=${limit}, generations=1, retries=2, timeBox=8. You are this test Run's execution owner. Keep the same native conversation. The Run requires actual Workshop read/knowledge/write/code, asynchronous work, reader and Judge. Use the installed skill's hima_context/hima_execute protocol until terminal, then write TEST.md from the true records. The declared method files are immutable during testing.`);
  for (let round = 0; round < 5 && packStage(folder).stage !== 'tested'; round++) {
    const runs = host.ctx.hima.ledger.runs().filter((run) => run.packId === packId);
    if (runs.some((run) => run.status === 'waiting')) break;
    await check.say(author, `Continue the same /hima-test stage and its existing Run. Read hima_context and actual execution phases; complete only ready work, explicitly select successors, and wait for a still-running Job's notification. On terminal status write TEST.md from hima_status records and call hima_pack_check. Keep the same owner and immutable method; create no replacement Run.`);
  }
  const testText = record(pipelineFiles.test, HIMA_TEST_SECTIONS);
  const named = new RegExp(`^run: (${runIdPattern.source})$`, 'm').exec(testText);
  const row = named ? host.ctx.hima.ledger.run(named[1]!) : undefined;
  check.require('TEST.md names the actual owned terminal test Run', !!row && row.purpose === 'test' && row.status?.startsWith('ended-') === true && row.control?.owner === String(author.id), row ?? null);
  check.require('test executed the current immutable model-authored method', row?.packDigest === methodBeforeTest && packDigestOf(folder) === methodBeforeTest, { testedDigest: row?.packDigest, before: methodBeforeTest, after: packDigestOf(folder) });
  const runs = host.ctx.hima.ledger.runs().filter((run) => run.packId === packId);
  check.require('one authored method test Run', runs.length === 1, runs.map((run) => run.id));
  const records = host.ctx.hima.ledger.records({ runId: row!.id });
  const expected = numbers.filter((n) => n > limit).reduce((sum, n) => sum + n, 0);
  check.require('authored reader produced the independently calculated actual sum', records.some((r) => r.type === 'observation' && r.values.some((value) => value.type === 'numeric_sum' && value.value === expected)), { expected, observations: records.filter((r) => r.type === 'observation') });
  const codes = records.filter((r) => r.type === 'code');
  check.observed.code = codes.map((r) => ({ record: r, content: readFileSync(r.path, 'utf8'), actualSha256: sha256(readFileSync(r.path)) }));
  check.require('model-generated Workshop code has actual matching hashes', codes.length > 0 && codes.every((r) => sha256(readFileSync(r.path)) === r.sha256), check.observed.code);
  const testCalls = toolCalls(author).slice(testCallStart);
  check.require('author test used explicit owned execution and controlled code', ['begin', 'read', 'knowledge', 'write', 'work', 'complete'].every((action) => testCalls.some((call) => call.name === 'hima_execute' && call.args.action === action)), testCalls);
  stage('tested');

  const releaseCallStart = toolCalls(author).length;
  await check.say(author, `/hima-release ${packId}`);
  const releaseCalls = toolCalls(author).slice(releaseCallStart);
  check.require('release used the actual release tool without handwritten files', releaseCalls.some((call) => call.name === 'hima_pack_release') && !releaseCalls.some((call) => ['write', 'edit'].includes(call.name)), releaseCalls);
  const seal = packVersionFile.parse(parse(readFileSync(path.join(folder, pipelineFiles.version), 'utf8')));
  check.require('release seal names the true test Run', seal.test.run === row!.id, seal);
  stage('released');
  check.require('all five actual skills were injected into the author session', ['hima-grill', 'hima-spec', 'hima-fabric', 'hima-test', 'hima-release'].every((name) => injectedSkills(author).includes(name)), injectedSkills(author));
  check.require('the original model-authored intent survived', readFileSync(path.join(folder, pipelineFiles.intent), 'utf8') === intent, sha256(intent));
  const changed = changedBetween(before, await digestTrees(untouched, folder));
  check.require('Golden Flow and other Packs stayed unchanged', changed.length === 0, changed);
  check.require('authoring and execution used one model session without a separate moment', check.requestSessions.size === 1 && records.every((r) => r.type !== 'session'), { modelSessions: [...check.requestSessions], momentRecords: records.filter((r) => r.type === 'session') });
  check.observed.finalPackFiles = Object.fromEntries(await digestTrees([folder], folder + '.excluded'));
});
