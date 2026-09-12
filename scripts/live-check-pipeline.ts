// Bounded installed-consumer L4. Only the real model authors Pack and pipeline record files.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, loadPack, packDigestOf, packStage, packVersionFile, pipelineFiles, resolveChooser, resolveRule, runIdPattern } from '@hima/harness';
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
    'Compile one preparation tool, one real Workshop act node, one observing act node, one Judge, one explicit Explore node with a Pack-owned chooser, and the required hard-blocker wait. This Campaign permits exactly one generation; the reference method still declares its next-strategy revisit.',
    'The Judge has exactly two ordered rules: first the validity constraint numeric_sum >= 0 in count, then the Goal rule numeric_sum >= goal minimum in count. Its PASS edge goes to Explore; its FAIL edge goes to hard-blocker. A malformed or unreadable result has no successful numeric claim.',
    "The chooser reads numeric_sum. Its first clause on constraint PASS and goal PASS declares goalMet: true. On constraint PASS and goal FAIL it proposes next strategy limit=0 using a chooser parameter in count bound to 0 at the Explore node (the next expression names that parameter; bare numeric next expressions are not schema-valid). The Explore revisit goes back to preparation for that fallback, but this Run's original generation limit of 1 stops before any second generation. No convergence is declared. A valid/current Goal PASS ends through the owner's explicit goal-met Explore decision; it never routes success to a wait. Budget/blocked endings are failed test outcomes for this positive example.",
    'The Workshop reads the declared measured output, has one declared knowledge file explaining the exact sum, generates its own script during the test Run, and produces result.txt via a declared custom reader. The reader emits numeric_sum in count; the Judge requires numeric_sum >= goal minimum.',
    'Approved Workshop entry argv is exactly sh ${ENTRY} ${WORKSPACE} ${LIMIT}; the generated script reads $1/flow/measured.txt and writes the integer alone to $1/result.txt. Use a private research directory for generated code. No delay is needed in this authoring test.',
    "Knowledge explains the symbolic strict-bound sum and its exact input/output interface. A worked numeric claim needs an observed calculation over identified data; do not invent a sample total or bake this test's answer into method knowledge.",
    'Keep Golden Flow read-only. The Pack copies only needed flow inputs/scripts into its workspace. Runtime script creation belongs to the Workshop, not to method authoring. Knowledge unrelated to this numerical business should be marked inapplicable.',
  ].join('\n');

  check.observed.approvedBusiness = { facts, sha256: sha256(facts), goal: { minimum: 1 }, initialStrategy: { limit }, generationLimit: 1, timeBoxMs: 480_000 };

  await check.say(author, `/hima-grill I want a new ${packId} Pack that analyzes measured numeric inputs with an AI-written script and verifies the output. The Golden Flow is ${flow}. Ask the business questions before authoring.`);
  check.require('grill waited for author answers before recording intent', !existsSync(path.join(folder, pipelineFiles.intent)), toolCalls(author));
  await check.say(author, `Author answers and complete approved business contract:\n${facts}\nThese resolve the data, Goal, strategy, ending and Workshop semantics. Read the actual Golden Flow and write INTENT.md when sufficient.`);
  if (!existsSync(path.join(folder, pipelineFiles.intent))) await check.say(author, `The author confirms the stated contract and recommends no further scope. ${facts}\nRecord the confirmed answers in INTENT.md; if a concrete contradiction remains, stop and identify it.`);
  const intent = record(pipelineFiles.intent, HIMA_INTENT_SECTIONS);
  const beforeSpec = await digestTrees([folder], folder + '.excluded');
  await check.say(author, '/hima-spec');
  const spec = record(pipelineFiles.spec, HIMA_SPEC_SECTIONS);
  const specDelta = changedBetween(beforeSpec, await digestTrees([folder], folder + '.excluded'));
  check.require('spec added only SPEC.md', specDelta.length === 1 && specDelta[0] === `${path.join(folder, pipelineFiles.spec)} (new)`, specDelta);
  stage('specified');

  await check.say(author, `/hima-fabric ${packId} on site local. Compile the approved tiny numeric method, including its real Workshop, graph, reader, ordered constraint/Goal Judge and explicit Explore/chooser. Audit the actual argv and outcome edges against SPEC.md before FABRIC.md; a schema pass alone does not verify those semantics. Use installed skill anatomy and reference Pack files for schema. Read the Golden Flow in place. Put generated tool/reader scripts to the author for review.`);
  // These are bounded author approvals, not a fixture or fixed model-phrase matcher.
  for (let round = 0; round < 3 && packStage(folder).stage !== 'compiled'; round++) {
    await check.say(author, `Author review: I approve the generated numeric prepare and reader scripts described above if their effects stay in the private Campaign workspace and implement the approved contract. Keep INTENT.md and SPEC.md unchanged. Finish the declared files, ask hima_pack_check, correct only actual compilation errors, and record completed reviews in FABRIC.md. If a business contradiction remains, stop.`);
  }
  record(pipelineFiles.fabric, HIMA_FABRIC_SECTIONS);
  stage('compiled');
  const pack = loadPack(packsDirOf(h), packId);
  const methodBeforeTest = packDigestOf(folder);
  check.observed.authoredFiles = Object.fromEntries(await digestTrees([folder], folder + '.excluded'));
  check.observed.methodBeforeTest = { digest: methodBeforeTest, intentSha256: sha256(intent), specSha256: sha256(spec) };
  check.require('model authored a real Workshop with graph and reader', pack.contract.workshops.length === 1 && pack.graph.nodes.some((node) => node.kind === 'act' && 'workshop' in node.parameters) && pack.contract.outputs.some((output) => output.reader !== undefined), { contract: pack.contract, graph: pack.graph });
  const workshop = pack.contract.workshops[0]!;
  const producers = pack.graph.nodes.filter((node) => node.kind === 'act' && node.parameters.tool !== undefined);
  const analysis = pack.graph.nodes.find((node) => node.kind === 'act' && node.parameters.workshop === workshop.id);
  const reading = pack.graph.nodes.find((node) => node.kind === 'act' && node.parameters.observes === workshop.produces);
  const judges = pack.graph.nodes.filter((node) => node.kind === 'judge');
  const explorations = pack.graph.nodes.filter((node) => node.kind === 'explore');
  const waits = pack.graph.nodes.filter((node) => node.kind === 'wait');
  const judge = judges[0]; const explore = explorations[0];
  check.require('compiled method preserves the approved Workshop argv and output roots',
    JSON.stringify(workshop.argv) === JSON.stringify(['sh', '${ENTRY}', '${WORKSPACE}', '${LIMIT}'])
    && pack.contract.outputs.some((output) => output.name === workshop.produces && output.path === 'result.txt')
    && workshop.reads.some((name) => pack.contract.outputs.some((output) => output.name === name && output.path === 'flow/measured.txt')),
    { workshop, outputs: pack.contract.outputs });
  const minimum = pack.contract.goal?.minimum; const cutoff = pack.contract.strategy.limit;
  check.require('compiled parameter declarations and LIMIT binding preserve the approved contract',
    minimum?.type === 'number' && minimum.unit === 'count' && minimum.min === 0 && minimum.max === 10000 && minimum.default === 1
    && cutoff?.type === 'number' && cutoff.unit === 'count' && cutoff.min === 0 && cutoff.max === 100 && cutoff.default === limit
    && analysis?.kind === 'act' && JSON.stringify(analysis.parameters.arguments.LIMIT) === JSON.stringify({ from: 'strategy', name: 'limit' }),
    { goal: pack.contract.goal, strategy: pack.contract.strategy, analysis });
  const edgeTo = (from: string | undefined, outcome?: string) => pack.graph.edges.find((edge) => edge.from === from && edge.outcome === outcome)?.to;
  check.require('actual graph routes the approved success through Explore and fallback through the bounded revisit',
    pack.graph.nodes.length === 6 && producers.length === 1 && judges.length === 1 && explorations.length === 1 && waits.length === 1
    && judge?.parameters.rules.length === 2 && explore?.parameters.chooser !== undefined && explore.parameters.converge === undefined
    && pack.graph.entry === producers[0]?.id && edgeTo(producers[0]?.id) === analysis?.id && edgeTo(analysis?.id) === reading?.id
    && edgeTo(reading?.id) === judge.id && edgeTo(judge.id, 'PASS') === explore.id && edgeTo(judge.id, 'FAIL') === waits[0]?.id
    && pack.graph.edges.some((edge) => edge.from === explore.id && edge.to === producers[0]?.id && edge.revisit === true), pack.graph);
  const constraint = resolveRule(pack, judge!.parameters.rules[0]!, 'the reading').rule;
  const goal = resolveRule(pack, judge!.parameters.rules[1]!, 'the reading').rule;
  check.require('ordered Judge rules encode numeric validity and the actual Run Goal',
    constraint.subject.type === 'numeric_sum' && constraint.predicate.op === 'gte' && constraint.predicate.threshold === 0 && constraint.predicate.unit === 'count'
    && goal.subject.type === 'numeric_sum' && goal.predicate.op === 'gte' && goal.predicate.unit === 'count'
    && goal.parameter?.name === 'minimum' && typeof goal.predicate.threshold === 'object' && goal.predicate.threshold.parameter === 'minimum'
    && JSON.stringify(judge!.parameters.bind.minimum) === JSON.stringify({ from: 'goal', name: 'minimum' }), { constraint, goal, bind: judge!.parameters.bind });
  const { chooser, origin } = resolveChooser(pack, explore!.parameters.chooser!, 'the reading');
  check.require('the authored chooser declares Goal completion and the bounded fallback limit',
    origin === 'pack' && Object.values(chooser.reads).some((read) => read.type === 'numeric_sum' && read.unit === 'count')
    && chooser.decide[0]?.when.constraint === 'PASS' && chooser.decide[0]?.when.goal === 'PASS' && chooser.decide[0]?.goalMet === true
    && chooser.decide[1]?.when.constraint === 'PASS' && chooser.decide[1]?.when.goal === 'FAIL'
    && chooser.parameter?.unit === 'count' && chooser.decide[1]?.next?.limit === chooser.parameter.name && explore!.parameters.bind[chooser.parameter.name] === 0,
    { chooser, origin });
  check.require('compilation preserved the approved intent and specification', readFileSync(path.join(folder, pipelineFiles.intent), 'utf8') === intent
    && readFileSync(path.join(folder, pipelineFiles.spec), 'utf8') === spec, { intentSha256: sha256(intent), specSha256: sha256(spec) });
  check.observed.methodBeforeTest = { digest: methodBeforeTest, intentSha256: sha256(intent), specSha256: sha256(spec), graph: pack.graph, chooser };

  const testCallStart = toolCalls(author).length;
  await check.say(author, `/hima-test ${packId} on site local; goal minimum=1, strategy limit=${limit}, generations=1, retries=2, timeBox=8. You are this test Run's execution owner. Keep the same native conversation. The Run requires actual Workshop read/knowledge/write/code, asynchronous work, reader and ordered Judge, then explicit Explore completion with decision goal-met and actual current observation/verdict cites after both rules PASS. A terminal Judge alone is insufficient. Use the installed skill's hima_context/hima_execute protocol until terminal, then write TEST.md from the true records. The declared method files are immutable during testing.`);
  for (let round = 0; round < 5 && packStage(folder).stage !== 'tested'; round++) {
    const runs = host.ctx.hima.ledger.runs().filter((run) => run.packId === packId);
    if (runs.some((run) => run.status === 'waiting' || (run.status?.startsWith('ended-') === true && run.status !== 'ended-goal-met'))) break;
    await check.say(author, `Continue the same /hima-test stage and its existing Run. Read hima_context and actual execution phases; complete only ready work, explicitly select successors, and wait for a still-running Job's notification. After the current constraint and Goal both PASS, complete the declared Explore with an explicit goal-met decision and its actual cites. On terminal status write TEST.md from hima_status records and call hima_pack_check. Keep the same owner and immutable method; create no replacement Run.`);
  }
  const testText = record(pipelineFiles.test, HIMA_TEST_SECTIONS);
  const named = new RegExp(`^run: (${runIdPattern.source})$`, 'm').exec(testText);
  const row = named ? host.ctx.hima.ledger.run(named[1]!) : undefined;
  check.require('TEST.md names the actual owned Goal-met test Run', !!row && row.purpose === 'test' && row.status === 'ended-goal-met' && row.control?.owner === String(author.id), row ?? null);
  check.require('TEST.md reports the actual Goal-met ending', /^status: ended-goal-met$/m.test(testText), testText);
  check.require('the original one-generation budget, Goal, initial cutoff and owner were preserved', row?.budget?.timeBoxMs === 480_000
    && row.budget.generationLimit === 1 && row.budget.retryAllowance === 2 && row.generation === 1 && row.goal?.minimum === 1
    && row.firstStrategy?.limit === limit && row.strategy?.limit === limit && row.control?.epoch === 1, row ?? null);
  check.require('test executed the current immutable model-authored method', row?.packDigest === methodBeforeTest && packDigestOf(folder) === methodBeforeTest, { testedDigest: row?.packDigest, before: methodBeforeTest, after: packDigestOf(folder) });
  const runs = host.ctx.hima.ledger.runs().filter((run) => run.packId === packId);
  check.require('one authored method test Run', runs.length === 1, runs.map((run) => run.id));
  const records = host.ctx.hima.ledger.records({ runId: row!.id });
  const expected = numbers.filter((n) => n > limit).reduce((sum, n) => sum + n, 0);
  const observations = records.filter((r) => r.type === 'observation').filter((r) => r.generation === 1 && r.loopId === undefined && r.branchId === undefined);
  const observation = observations.findLast((r) => r.values.some((value) => value.type === 'numeric_sum' && value.unit === 'count' && value.value === expected));
  check.require('authored reader produced the full independently calculated sum above the initial cutoff', observation !== undefined, { expected, initialLimit: limit, observations });
  const outputBytes = readFileSync(observation!.path);
  check.require('the actual output file contains that exact sum and matches the observed content identity', outputBytes.toString('utf8').trim() === String(expected)
    && sha256(outputBytes) === observation!.contentSha256, { path: observation!.path, expected, actual: outputBytes.toString('utf8'), observedSha256: observation!.contentSha256, actualSha256: sha256(outputBytes) });
  const verdicts = records.filter((r) => r.type === 'verdict').filter((r) => r.generation === 1 && r.loopId === undefined && r.branchId === undefined);
  const constraintVerdict = verdicts.findLast((r) => r.ruleId === constraint.id && r.ruleVersion === constraint.version);
  const goalVerdict = verdicts.findLast((r) => r.ruleId === goal.id && r.ruleVersion === goal.version);
  check.require('actual current constraint and Goal PASS cite the independently verified observation',
    constraintVerdict?.outcome === 'PASS' && goalVerdict?.outcome === 'PASS' && goalVerdict.boundParameters?.minimum === 1
    && constraintVerdict.cites.includes(observation!.id) && goalVerdict.cites.includes(observation!.id), { constraintVerdict, goalVerdict });
  const decision = records.findLast((r) => r.type === 'decision' && r.generation === 1 && r.loopId === undefined && r.nodeId === explore!.id);
  check.require('the same owner made the current Goal-met Explore decision from its actual evidence', decision?.type === 'decision'
    && 'goalMet' in decision.chosen && decision.chosen.goalMet && decision.agent?.sessionId === String(author.id)
    && row!.control?.executions[decision.agent.executionId]?.phase === 'completed'
    && [observation!.id, constraintVerdict!.id, goalVerdict!.id].every((id) => decision.cites.includes(id))
    && records.some((r) => r.type === 'node' && r.nodeId === judge!.id && r.generation === 1 && r.state === 'done' && r.seq < decision.seq), decision);
  check.observed.currentSuccess = { expected, initialLimit: limit, observation, constraintVerdict, goalVerdict, decision };
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
  check.require('the original model-authored intent and specification survived', readFileSync(path.join(folder, pipelineFiles.intent), 'utf8') === intent
    && readFileSync(path.join(folder, pipelineFiles.spec), 'utf8') === spec, { intentSha256: sha256(intent), specSha256: sha256(spec) });
  const changed = changedBetween(before, await digestTrees(untouched, folder));
  check.require('Golden Flow and other Packs stayed unchanged', changed.length === 0, changed);
  check.require('authoring and execution used one model session without a separate moment', check.requestSessions.size === 1 && records.every((r) => r.type !== 'session'), { modelSessions: [...check.requestSessions], momentRecords: records.filter((r) => r.type === 'session') });
  check.observed.finalPackFiles = Object.fromEntries(await digestTrees([folder], folder + '.excluded'));
});
