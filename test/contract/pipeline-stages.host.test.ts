// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { bootInProcess, createRootAgent, saidByModel, sayAsUser, toolCalls, toolResults, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { localHome } from './support/fabric.ts';
import { packsDirOf, timingProbePackId, writePackFiles, writePackVariant } from './support/pack.ts';
import { authoredPackFolder, authoredPackId, changedBetween, committedRecord, digestTrees, replayStage, sectionsOf } from './support/pipeline.ts';
import { HIMA_FABRIC_SECTIONS, HIMA_KNOWLEDGE_FILES, HIMA_PACK_ANATOMY_FILE, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, himaSkillsDir, loadPack, packDigestOf, packStageOf, packVersionFile, pipelineFiles, runIdPattern } from '@hima/harness';
import type { HimaHome as _Home } from './support/dsh-home.ts';


/** The six knowledge reads a stage makes, as `toolCalls` reports them, in the order the bodies list
 *  them. The same list `skills.test.ts` holds the first two stages to: what a stage reads before it
 *  writes is one fact about the pipeline, and the fabric stage reads exactly what they do. */
const knowledgeReads = HIMA_KNOWLEDGE_FILES.map((file) => `read ${path.join(himaSkillsDir(), 'knowledge', file)}`);


/** The seventh reference file the fabric stage reads, beside the six: the skeleton of every file
 *  kind a pack folder holds. Read where the six are, against the same resource base. */
const anatomyRead = `read ${path.join(himaSkillsDir(), 'knowledge', HIMA_PACK_ANATOMY_FILE)}`;


/** The four files of the pack installed beside the folder being authored, read by the relative path
 *  the fabric body names — `../<the other pack id>/…` against the session's own working directory,
 *  which is the pack folder. A whole contract and a whole graph somebody meant, for shape. */
const siblingReads = ['PACK.md', 'contract.yml', 'graph.yml', 'tools/synth.sh']
  .map((file) => `read ../${timingProbePackId}/${file}`);


/**
 * The bundle's own data files the fabric body **mandates** before it writes: the semantics, and the
 * file of every rule and chooser the spec names by an id rather than describing as the pack's own.
 *
 * Spelled as the model spells it — `<the skill's base directory>../<file>`, unnormalised — because
 * that is the string the read tool was given, and the body names those paths relative to the base
 * dsh hands the session. This spec names two judge rules by id and no chooser: its one chooser is
 * the pack's own, and the stage writes that file rather than naming a shipped one.
 */
const bundleReads = ['semantics.yml', 'rules/setup-wns-all-nonnegative.yml', 'rules/clock-period-at-most.yml']
  .map((file) => `read ${himaSkillsDir()}../${file}`);


/** What the author answers the fabric stage's one review question with, in their own words. */
const REVIEW_ANSWER = 'approved — keep it';


/**
 * The Goal and the Strategy this author states to the test stage, and what the committed transcript's
 * `hima_run` call therefore asks for.
 *
 * The stage's body gives its numbers exactly two sources — the author's own message, or the spec's
 * `Goal template` recommending one — and the committed spec recommends no target, so the message is
 * where both of these come from. The transcript states the same two, and `TEST_ASKS` is what the
 * Run's own row is then held to: a fixture whose message and whose tool call disagreed would show a
 * stage inventing a number and call it a stage following its body.
 */
const TEST_ASKS = { goal: { target_period_ns: 2 }, strategy: { periodNs: 2.2 } } as const;


/** How an author writes one of those numbers: a clock period is stated with a decimal place, so `2`
 *  is typed `2.0`. The one thing the message spells differently from the object it is derived from. */
const asAuthorWrites = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));


/** The values of one of those maps, as a person states them in a sentence. */
const stated = (values: Readonly<Record<string, number>>): string =>
  Object.entries(values).map(([name, value]) => `${name}=${asAuthorWrites(value)}`).join(', ');


/**
 * The author's message, **derived from `TEST_ASKS` and not spelled again beside it**.
 *
 * One source, because these two are one claim: the message is what the stage is given, the
 * transcript's `hima_run` call is what the stage did with it, and the Run's own row is held against
 * `TEST_ASKS` below. Spelled twice, a message edited without its transcript would leave this suite
 * green while showing a stage asking for numbers nobody stated — the very thing the body's rule and
 * these assertions exist to catch. Derived, that edit changes what the assertions compare against
 * and the committed transcript then disagrees with them, loudly.
 */
const TEST_INVOCATION = `/hima-test ${authoredPackId} on site local; the goal is ${stated(TEST_ASKS.goal)}, and start the strategy at ${stated(TEST_ASKS.strategy)}`;


/** The review question the stage puts to the author, as the committed transcript states it. Asserted
 *  verbatim, because the claim is not "the stage mentioned the script" but "the stage put the script
 *  it wrote to the author before it finished, in the words its body requires". */
const REVIEW_ASK = 'Review tools/synth.sh:';



/**
 * A pack folder the committed grill and spec transcripts left at `specified`.
 *
 * The records come out of those transcripts rather than being written again here, for the reason
 * `committedRecord` exists: two spellings of one intent record is two intents, and the day somebody
 * corrects one the fabric stage would be compiling from the other.
 */
async function specifiedFolder(h: _Home, flowRoot: string, id: string = authoredPackId): Promise<string> {
  const dir = await authoredPackFolder(h, id);
  await writeFile(path.join(dir, pipelineFiles.intent), await committedRecord('grill', pipelineFiles.intent, flowRoot));
  await writeFile(path.join(dir, pipelineFiles.spec), await committedRecord('spec', pipelineFiles.spec, flowRoot));
  return dir;
}


/** One stage run in the pack folder, on a host booted for it alone. `replayStage` was already called
 *  for the scenario; this is the boot, the session, and the messages a person sends. */
async function runStage(h: _Home, packDir: string, said: readonly string[]): Promise<{ calls: string[]; texts: string[]; failures: string[] }> {
  const host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, packDir);
    for (const line of said) await sayAsUser(agent, line);
    return {
      calls: toolCalls(agent).map((c) => `${c.name}${c.args.file_path === undefined ? '' : ` ${String(c.args.file_path)}`}`),
      texts: saidByModel(agent),
      failures: toolResults(agent).filter((r) => r.failed).map((r) => r.text),
    };
  } finally {
    await host.dispose();
  }
}


/**
 * The files the fabric stage writes into the folder, which is what a Campaign of this pack runs.
 *
 * Listed here, by hand, so that the digest below is computed from a statement this test makes and
 * not from the routine under test.
 */
const COMPILED_FILES = ['contract.yml', 'graph.yml', 'choosers/over-constraining-push.yml', 'knowledge/push-method.md', 'tools/synth.sh'] as const;


/**
 * The digest of a folder as the rule states it, computed here: sha256 over `"<path> <sha256>\n"` for
 * each of the named files, sorted by path.
 *
 * Deliberately not `packDigestOf`. An expectation computed with the implementation under test agrees
 * with that implementation whatever it does — which is exactly how an enumeration that followed a
 * link or swallowed a hidden file would have gone on agreeing with itself.
 *
 * @param dir - the folder.
 * @param files - the files it is expected to hold, by path relative to it.
 * @returns the digest the rule gives.
 */
async function digestStatedHere(dir: string, files: readonly string[]): Promise<string> {
  const pairs = await Promise.all([...files].sort().map(async (at) =>
    [at, createHash('sha256').update(await readFile(path.join(dir, at))).digest('hex')] as const));
  return createHash('sha256').update(pairs.map(([at, sha]) => `${at} ${sha}\n`).join('')).digest('hex');
}


/** `/hima pack check` on the authored folder, through a host booted for that one question. */
async function packCheck(h: _Home, id: string = authoredPackId): Promise<{ kind: string; text: string }> {
  const host = await bootInProcess(h);
  try {
    return await himaCommand(host, h.workspace, `/hima pack check ${id} --site local`, 20_000);
  } finally {
    await host.dispose();
  }
}


test('through a booted host with the replay stand-in: /hima-fabric reads every source its body names before it writes, compiles the spec into a pack that loads and fits, and records the author\'s review in their own words', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  try {
    const packDir = await specifiedFolder(h, home.flow.root);
    // Everything a stage must not touch: the Golden Flow where it lies, the home's workspace, and
    // every other pack installed beside the one being authored.
    const outside = [home.flow.root, h.workspace, packsDirOf(h)];
    const before = await digestTrees(outside, packDir);
    assert.ok(before.size > 5, `the digest read the trees rather than nothing: ${String(before.size)} files`);

    await replayStage(h, 'fabric');
    const ran = await runStage(h, packDir, [
      `/hima-fabric ${authoredPackId} on site local`,
      REVIEW_ANSWER,
    ]);

    // The stage read before it wrote — the spec, the record it points back at, the Golden Flow where
    // it lies, all six knowledge files, the skeleton of every file kind a pack folder holds, the
    // four files of the pack installed beside this one, and the bundle's own semantics with the file
    // of each rule this spec names by id — then wrote only inside this folder, put its one script to
    // the author, and checked its own work with the harness's own verb rather than declaring the
    // folder done. Every one of those reads is a source its body names as an authority
    // for a shape; the list is the whole of that authority, and a stage that wrote without them is
    // a stage that got its shapes from somewhere this body forbids.
    assert.deepEqual(ran.calls, [
      'read SPEC.md',
      'read INTENT.md',
      `read ${path.join(home.flow.root, 'Makefile')}`,
      ...knowledgeReads,
      anatomyRead,
      ...siblingReads,
      ...bundleReads,
      'write contract.yml',
      'write graph.yml',
      'write choosers/over-constraining-push.yml',
      'write knowledge/push-method.md',
      'write tools/synth.sh',
      'write FABRIC.md',
      'hima_pack_check',
    ], `the calls the stage made, in order: ${JSON.stringify(ran.calls)}`);
    assert.deepEqual(ran.failures, [], `nothing the stage did was refused: ${JSON.stringify(ran.failures)}`);

    // The review is a turn that ends: the stage asked, the author answered in a message of their own,
    // and only then was the record written. A stage that wrote the record first would have recorded a
    // verdict nobody had given.
    assert.ok(ran.texts.some((said) => said.includes(REVIEW_ASK)),
      `the stage put the script it wrote to the author: ${JSON.stringify(ran.texts)}`);

    // The folder is a pack: it loads, which is the same question `compiled` asks.
    const pack = loadPack(packsDirOf(h), authoredPackId);
    assert.equal(pack.contract.id, authoredPackId, 'the contract declares the folder it is in');
    assert.equal(pack.graph.entry, 'synthesize', 'and the graph starts at the node that runs the tool');

    const checked = await packCheck(h);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, new RegExp(`^pack ${authoredPackId}@1 on site local: fit\\b`), checked.text);
    assert.match(checked.text, /^stage: compiled \(INTENT\.md, SPEC\.md, contract\.yml, graph\.yml, FABRIC\.md validate\); next: tested — TEST\.md, written by \/hima-test$/m, checked.text);
    assert.match(checked.text, /^ {2}over-constraining-push@1 chooses at next-period: found in the pack$/m,
      `the chooser the stage wrote is the pack's own, and the check says which file answered: ${checked.text}`);

    const record = await readFile(path.join(packDir, pipelineFiles.fabric), 'utf8');
    assert.deepEqual(sectionsOf(record), [...HIMA_FABRIC_SECTIONS], 'the fabric record holds exactly the three sections, in order');
    // Nothing the spec asked for is missing from this folder: the spec names one knowledge file and
    // one tool, the flow shows that tool's command line, and every rule and reader it names is one
    // the bundle ships under that id. A gap list that named something anyway would be a record
    // claiming the stage could not do what it has just done.
    const gaps = record.slice(record.indexOf('## Gaps'), record.indexOf('## Reviews'));
    assert.equal(gaps.replace('## Gaps', '').trim(), 'none', `the gap list says none: ${gaps}`);
    const reviews = record.slice(record.indexOf('## Reviews'));
    assert.ok(reviews.includes('tools/synth.sh'), `the review line names the script: ${reviews}`);
    assert.ok(reviews.includes(REVIEW_ANSWER), `and holds the author's verdict in their own words: ${reviews}`);

    assert.deepEqual(changedBetween(before, await digestTrees(outside, packDir)), [],
      'the fabric stage wrote nothing outside the pack folder, and copied no file of the Golden Flow into it');
  } finally {
    await h.dispose();
  }
});


test('through a booted host with the replay stand-in: /hima-fabric refuses a spec that contradicts itself, naming the section and quoting the line, and writes nothing at all', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  try {
    const packDir = await authoredPackFolder(h, 'contradicted-probe');
    await writeFile(path.join(packDir, pipelineFiles.intent), await committedRecord('grill', pipelineFiles.intent, home.flow.root));
    // A spec with every section, each saying something, and one value read by a judge rule and by a
    // chooser that its own Semantics section does not declare. It parses, it validates as a record,
    // and it cannot be compiled into anything a Campaign could run.
    await writeFile(path.join(packDir, pipelineFiles.spec), contradictorySpec(home.flow.root));

    const before = await digestTrees([packDir], path.join(packDir, 'nothing-is-skipped'));
    assert.equal(before.size, 2, `the folder holds the two records and nothing else: ${[...before.keys()].join(', ')}`);

    await replayStage(h, 'contradiction');
    const ran = await runStage(h, packDir, [`/hima-fabric contradicted-probe on site local`]);

    assert.deepEqual(ran.calls.filter((c) => c.startsWith('write') || c.startsWith('edit')), [],
      `the stage wrote nothing: ${JSON.stringify(ran.calls)}`);
    const said = ran.texts.at(-1) ?? '';
    assert.equal(said.split('\n')[0], 'SPEC.md does not compile:', `the refusal's first line is the one its body requires: ${said}`);
    assert.match(said, /^Judge rules, line \d+: "[^"]+" — /m, `a finding names the section, the line and the line itself: ${said}`);
    assert.ok(said.includes('candidateCount'), `and the value nothing declares: ${said}`);

    assert.deepEqual(changedBetween(before, await digestTrees([packDir], path.join(packDir, 'nothing-is-skipped'))), [],
      'the folder is byte for byte what it was: a refusal writes nothing');

    // And the folder is where it was on the ladder, which is the other half of "nothing happened".
    assert.equal(packStageOf(packsDirOf(h), 'contradicted-probe')!.stage, 'specified', 'the folder did not move up the ladder');
  } finally {
    await h.dispose();
  }
});


/** A spec that validates as a record and contradicts itself: a value a judge rule and a chooser read
 *  that the Semantics section does not declare. Written here rather than committed as a fixture,
 *  because it is the *input* this test varies and not the model's side of a session. */
function contradictorySpec(flowRoot: string): string {
  const bodies: Readonly<Record<string, string>> = {
    'Goal template': `The primary target is a clock period in ns, named on the Run. The flow is at ${flowRoot}.`,
    Constraints: 'One constraint: the setup slack the verification report states, in ns.',
    'Run contract': 'Inputs: where the flow lies, which design is run, where campaign workspaces are made.',
    Semantics: '- `setupSlackNs` — ns — how far the worst path is from meeting the period asked for.',
    'Judge rules': 'A generation continues when the setup slack is not negative.\nIt is blocked when the report is missing.\nA generation continues when the report states a `candidateCount` above zero.',
    Choosers: 'One chooser, over the values above.\nOn a met constraint the next period is one step tighter.\nOn a violation the next period is the period asked plus `candidateCount`.',
    Endings: 'Goal met; converged; and the flow refusing to run at all.',
    Workshops: 'None for this pack.',
    Knowledge: '- `push-method.md` — why this pack pushes the period the way it does.',
  };
  return HIMA_SPEC_SECTIONS.map((section) => `## ${section}\n\n${bodies[section]!}\n`).join('\n');
}


/** One question asked of a host booted for it alone, and the host disposed however it is answered. */
async function withHost<T>(h: _Home, ask: (host: InProcessHost) => Promise<T>): Promise<T> {
  const host = await bootInProcess(h);
  try {
    return await ask(host);
  } finally {
    await host.dispose();
  }
}


/** Every tmux session the Runs in this home launched: what the test ends, however it ends. */
const sessionsIn = (host: InProcessHost): string[] =>
  host.ctx.hima.ledger.runs().flatMap((r) => host.ctx.hima.ledger.records({ runId: r.id }))
    .flatMap((r) => (r.type === 'job' && r.event === 'launched' ? [r.job.session] : []));


test('through a booted host with the replay stand-in: /hima-test runs the compiled pack as a run marked a test and writes the record from what that run recorded, /hima-release seals the folder, and a file changed afterwards is named by the check and refused by a campaign', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  const started: string[] = [];
  try {
    const packDir = await specifiedFolder(h, home.flow.root);
    await replayStage(h, 'fabric');
    await runStage(h, packDir, [`/hima-fabric ${authoredPackId} on site local`, REVIEW_ANSWER]);
    assert.equal(packStageOf(packsDirOf(h), authoredPackId)!.stage, 'compiled', 'the fabric stage left a folder the test stage can run');

    // -------------------------------------------------------------------------------------------
    // The test stage: a real Campaign on the stand-in, marked a test run, and the record written
    // from what that Run recorded rather than from what the stage expected.
    // -------------------------------------------------------------------------------------------
    // What this folder hashes to, stated by this test rather than computed by the routine the row
    // and the seal are about.
    const digestAsTested = await digestStatedHere(packDir, COMPILED_FILES);
    assert.equal(packDigestOf(packDir), digestAsTested,
      'the digest the harness takes of this folder is the one the rule gives over the files the fabric stage wrote');
    await replayStage(h, 'test');
    const ran = await runStage(h, packDir, [TEST_INVOCATION]);
    // The two facts its body says are not `hima_status`'s to give it — the Golden Flow the Site is
    // checked against, and what the flow itself said — are read before the campaign is started: the
    // intent record for the pointer, and the flow where that pointer says it lies.
    assert.deepEqual(
      ran.calls,
      ['hima_pack_check', 'read SPEC.md', 'read INTENT.md', `read ${path.join(home.flow.root, 'Makefile')}`, 'hima_run', 'hima_status', 'write TEST.md', 'hima_pack_check'],
      `the stage checked the folder, read what only the record and the flow can tell it, started the campaign, read it back and wrote one file: ${JSON.stringify(ran.calls)}`,
    );
    assert.deepEqual(ran.failures, [], `nothing the stage did was refused: ${JSON.stringify(ran.failures)}`);

    const record = await readFile(path.join(packDir, pipelineFiles.test), 'utf8');
    assert.deepEqual(sectionsOf(record), [...HIMA_TEST_SECTIONS], 'the test record holds exactly the seven sections, in order');
    const runSection = record.slice(record.indexOf('## Run'), record.indexOf('## Ending'));
    const named = new RegExp(`^run: (${runIdPattern.source})$`, 'm').exec(runSection);
    assert.ok(named, `the Run section holds the one line the rung rests on: ${runSection}`);
    const runId = named[1]!;

    const { row, status, sessions } = await withHost(h, async (host) => ({
      row: host.ctx.hima.ledger.run(runId),
      status: await himaCommand(host, h.workspace, `/hima status ${runId}`, 20_000),
      sessions: sessionsIn(host),
    }));
    started.push(...sessions);
    assert.ok(row, `the ledger holds the Run the record names: ${runId}`);
    assert.equal(row.purpose, 'test', 'the stage marked its own Run a test run, which is what the record rests on');
    assert.equal(row.packId, authoredPackId, 'and it ran this pack');
    assert.equal(row.packDigest, digestAsTested, 'and the row records the very files the folder held when it started');
    // Where the Run's numbers came from. The message states them and the transcript's own `hima_run`
    // call states the same, so the row holding exactly those is the fixture showing a stage that took
    // its Goal from its author — which is the one thing the body forbids it to decide for itself.
    assert.deepEqual(row.goal, TEST_ASKS.goal, 'the Run asked for the Goal the author\'s message stated, and for nothing else');
    assert.deepEqual(row.firstStrategy, TEST_ASKS.strategy, 'and started at the Strategy that message asked for');
    assert.equal(row.status, 'ended-converged', `the stand-in converged: ${String(row.status)}`);
    assert.match(status.text, new RegExp(`^run ${runId} of campaign \\S+ on site local: ended-converged, test run`, 'm'),
      `/hima status says what this Run is for before anything else about it: ${status.text}`);

    const ending = record.slice(record.indexOf('## Ending'), record.indexOf('## Generations'));
    assert.ok(ending.includes('ended-converged'), `the Ending section states the status the Run ended with: ${ending}`);
    assert.ok(ending.includes('declares'), `and whether it is an ending this pack declares: ${ending}`);

    // The three claims of the record the harness reads back, held against the very records the Run
    // wrote. The fixture *states* them — it is a hand-written transcript — and what is asserted here
    // is that the ledger says the same, which is the whole difference between a record and a story.
    const sectionOf = (name: string): string => {
      const at = record.indexOf(`## ${name}`);
      const next = record.indexOf('\n## ', at + 1);
      return record.slice(at, next < 0 ? record.length : next);
    };
    assert.match(sectionOf('Ending'), new RegExp(`^status: ${String(row.status)}$`, 'm'),
      `the Ending section states the ledger's own word for how this Run ended: ${sectionOf('Ending')}`);
    const { codeRecords, refusals } = await withHost(h, (host) => Promise.resolve({
      codeRecords: host.ctx.hima.ledger.records({ runId }).filter((r) => (r.type as string) === 'code'),
      refusals: host.ctx.hima.ledger.records({ runId }).filter((r) => r.type === 'refusal'),
    }));
    assert.deepEqual(codeRecords, [], 'this Run generated no code, which is what the record says');
    assert.deepEqual(refusals, [], 'and refused nothing, which is what the record says');
    assert.equal(sectionOf('Code').trim(), '## Code\n\nnone', `the Code section says exactly none: ${sectionOf('Code')}`);
    assert.equal(sectionOf('Refusals').trim(), '## Refusals\n\nnone', `the Refusals section says exactly none: ${sectionOf('Refusals')}`);

    const tested = await packCheck(h);
    assert.equal(tested.kind, 'success', tested.text);
    assert.match(tested.text, /^stage: tested \(INTENT\.md, SPEC\.md, contract\.yml, graph\.yml, FABRIC\.md, TEST\.md validate\); next: released — VERSION\.yml, written by \/hima-release$/m, tested.text);
    assert.match(tested.text, new RegExp(`^test record: run ${runId}, ended ended-converged, files as tested$`, 'm'),
      `the check says the record is evidence this ledger can vouch for: ${tested.text}`);

    // A record whose prose was rewritten after the test: the `run:` line is still that Run's and
    // every file of the folder still hashes as it did, so nothing but the binding below would notice
    // that the record now says the Campaign ended some other way.
    const testAt = path.join(packDir, pipelineFiles.test);
    await writeFile(testAt, record.replace('status: ended-converged', 'status: ended-goal-met'));
    const rewritten = await packCheck(h);
    assert.equal(rewritten.kind, 'error', rewritten.text);
    assert.match(
      rewritten.text,
      new RegExp(`^stage: compiled \\([^)]+\\); next: tested — TEST\\.md, written by /hima-test; test record's Ending says status: ended-goal-met and run ${runId} ended ended-converged$`, 'm'),
      rewritten.text,
    );
    await writeFile(testAt, record);
    assert.match((await packCheck(h)).text, /^stage: tested \(/m, 'and the folder is tested again the moment the record says what the Run did');

    // A script edited after the test stage is a pack nobody has tested, and the check says so at the
    // rung the folder really stands on. Restoring the byte exactly puts it back, because the digest
    // is over the bytes and not over the clock.
    const scriptAt = path.join(packDir, 'tools/synth.sh');
    const script = await readFile(scriptAt, 'utf8');
    await writeFile(scriptAt, `${script}# one line a person added after the test stage\n`);
    const changed = await packCheck(h);
    assert.equal(changed.kind, 'error', changed.text);
    assert.match(changed.text, /^stage: compiled \([^)]+\); next: tested — TEST\.md, written by \/hima-test; test record names run \S+, which ran files that no longer match this folder: re-run the test stage$/m, changed.text);
    await writeFile(scriptAt, script);
    assert.match((await packCheck(h)).text, /^stage: tested \(/m, 'and the folder is tested again the moment the file is what it was');

    // -------------------------------------------------------------------------------------------
    // The release stage: the seal, and what a change to a sealed folder does.
    // -------------------------------------------------------------------------------------------
    // PLS-13: this real Run's TEST record must still verify after customer knowledge is archived.
    const customerReport = path.join(packDir, 'run-assets', runId, 'customer-report.md');
    await mkdir(path.dirname(customerReport), { recursive: true });
    await writeFile(customerReport, '# Private customer research\nA negative result worth retaining.\n');
    assert.equal(packDigestOf(packDir), digestAsTested);
    assert.match((await packCheck(h)).text, /^test record: run .+, ended ended-converged, files as tested$/m);
    await replayStage(h, 'release');
    const sealing = await runStage(h, packDir, [`/hima-release ${authoredPackId}`]);
    assert.deepEqual(sealing.calls, ['hima_pack_check', 'hima_pack_release'],
      `the stage checked the folder and sealed it, and wrote nothing by hand: ${JSON.stringify(sealing.calls)}`);
    assert.deepEqual(sealing.failures, [], `nothing the stage did was refused: ${JSON.stringify(sealing.failures)}`);

    const sealAt = path.join(packDir, pipelineFiles.version);
    const seal = packVersionFile.parse(parse(await readFile(sealAt, 'utf8')));
    assert.equal(seal.pack, authoredPackId, 'the seal names the pack it is in');
    assert.equal(seal.methodDigest, digestAsTested, 'the release states the same method identity as its actual test Run');
    assert.equal(seal.version, loadPack(packsDirOf(h), authoredPackId).contract.version, 'and the version its contract declares, which is what a release seals');
    assert.deepEqual(seal.test, { record: pipelineFiles.test, run: runId }, 'and the test record it rests on, with the Run that wrote it');
    // Every regular file of the folder but the seal itself, with the hash the harness computed —
    // the pipeline's own records included, because a person installing this pack reads them too.
    // Every file the folder holds, listed here rather than read back out of the hasher: the four
    // records the pipeline wrote and the five files the fabric stage compiled, and nothing else.
    const sealedFiles = [pipelineFiles.intent, pipelineFiles.spec, pipelineFiles.fabric, pipelineFiles.test, ...COMPILED_FILES];
    assert.deepEqual(Object.keys(seal.files).sort(), [...sealedFiles].sort(),
      'the seal covers every file of the folder but itself, and nothing that is not in it');
    for (const [at, sha] of Object.entries(seal.files)) {
      assert.equal(sha, createHash('sha256').update(await readFile(path.join(packDir, at))).digest('hex'), `the seal's hash of ${at} is that file's`);
    }

    const released = await packCheck(h);
    assert.equal(released.kind, 'success', released.text);
    assert.match(released.text, /^stage: released \([^)]+, VERSION\.yml validate\); nothing after it: this is the top of the ladder$/m, released.text);

    // The seal's own `test.run` changed by hand: no listed hash moves, because the hashes cover the
    // folder's files and not the seal's own bytes, so this is the one edit only the two halves of
    // the evidence being held against each other can catch.
    const sealText = await readFile(sealAt, 'utf8');
    const otherRun = `run-${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`;
    await writeFile(sealAt, sealText.replace(runId, otherRun));
    const misnamed = await packCheck(h);
    assert.equal(misnamed.kind, 'error', misnamed.text);
    assert.match(misnamed.text, new RegExp(`^ {2}- VERSION\\.yml is there and names run ${otherRun} as the test it rests on, and TEST\\.md names run ${runId}$`, 'm'), misnamed.text);
    await writeFile(sealAt, sealText);
    assert.match((await packCheck(h)).text, /^stage: released \(/m, 'and the folder is released again the moment the seal names the run its record does');

    // A file changed under a seal: the check names the file, and a Campaign refuses the pack before
    // anything is sent to a Site, which is what a release is for.
    await writeFile(scriptAt, `${script}# a line added after the release\n`);
    const tampered = await packCheck(h);
    assert.equal(tampered.kind, 'error', tampered.text);
    assert.match(tampered.text, /^ {2}- VERSION\.yml is there and tools\/synth\.sh no longer hashes to it$/m, tampered.text);
    const refused = await withHost(h, (host) => himaCommand(host, h.workspace, `/hima run ${authoredPackId} --site local --goal target_period_ns=2 --generations 1`, 30_000));
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /VERSION\.yml is there and tools\/synth\.sh no longer hashes to it/, `no campaign starts on a pack that changed under its seal: ${refused.text}`);
    assert.equal(refused.runId, undefined, 'and no Run was opened at all');
    await writeFile(scriptAt, script);

    // And a `--test` a person spelled with a value: refused in words, rather than starting a
    // Campaign marked in a way they never asked for and never saw.
    const withValue = await withHost(h, (host) => himaCommand(host, h.workspace, `/hima run ${authoredPackId} --site local --goal target_period_ns=2 --test false`, 20_000));
    assert.equal(withValue.kind, 'error', withValue.text);
    assert.match(withValue.text, /^unexpected argument "false"$/m, withValue.text);
    assert.equal(withValue.runId, undefined, 'and no Run was opened');
    const attached = await withHost(h, (host) => himaCommand(host, h.workspace, `/hima run ${authoredPackId} --site local --goal target_period_ns=2 --test=false`, 20_000));
    assert.equal(attached.kind, 'error', attached.text);
    assert.match(attached.text, /^unknown option "--test=false"$/m, attached.text);
    assert.equal(attached.runId, undefined, 'and no Run was opened for that spelling either');

    // A file *added* is the same fault from the other side: a rule nobody signed runs in every
    // Campaign of this pack.
    const addedAt = path.join(packDir, 'rules/added-after-the-seal.yml');
    await writePackFiles(packDir, { 'rules/added-after-the-seal.yml': 'id: added-after-the-seal\n' });
    const added = await packCheck(h);
    assert.equal(added.kind, 'error', added.text);
    assert.match(added.text, /^ {2}- VERSION\.yml is there and rules\/added-after-the-seal\.yml is not listed in it$/m, added.text);
    await rm(addedAt);
    assert.match((await packCheck(h)).text, /^stage: released \(/m, 'and the folder is released again the moment the folder is what it was');

    // And the verb refuses a folder that has not been tested, in words naming the rung it stands on.
    await writePackVariant(packsDirOf(h), 'untested-probe', [], []);
    await writePackFiles(path.join(packsDirOf(h), 'untested-probe'), {
      'INTENT.md': await committedRecord('grill', pipelineFiles.intent, home.flow.root),
      'SPEC.md': await committedRecord('spec', pipelineFiles.spec, home.flow.root),
      'FABRIC.md': `## Files written\n\ncopied in by hand\n\n## Gaps\n\nnone\n\n## Reviews\n\nnone\n`,
    });
    const refusedRelease = await withHost(h, (host) => himaCommand(host, h.workspace, '/hima pack release untested-probe', 20_000));
    assert.equal(refusedRelease.kind, 'error', refusedRelease.text);
    assert.equal(
      refusedRelease.text,
      'pack untested-probe stands at compiled and a release seals a tested pack; next: tested — TEST.md, written by /hima-test',
      refusedRelease.text,
    );
    assert.ok(!existsSync(path.join(packsDirOf(h), 'untested-probe', pipelineFiles.version)), 'and nothing was sealed');
  } finally {
    if (started.length > 0) {
      const { killSessions } = await import('./support/fabric.ts');
      killSessions(started);
    }
    await h.dispose();
  }
});
