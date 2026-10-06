// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootInProcess, createRootAgent, saidByModel, sayAsUser, toolCalls, toolResults } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { localHome } from './support/fabric.ts';
import { packsDirOf, timingProbePackId, writePackFiles, writePackVariant } from './support/pack.ts';
import { authoredPackFolder, authoredPackId, changedBetween, committedRecord, digestTrees, replayStage, sectionsOf } from './support/pipeline.ts';
import { HIMA_FABRIC_SECTIONS, HIMA_KNOWLEDGE_FILES, HIMA_PACK_ANATOMY_FILE, HIMA_SPEC_SECTIONS, himaSkillsDir, loadPack, packDigestOf, packStageOf, pipelineFiles } from '@hima/harness';
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
    assert.equal(pack.flow!.source, 'legacy');
    assert.equal(pack.flow!.packSha256, packDigestOf(packDir));
    assert.ok(Object.isFrozen(pack.flow), 'normal author compilation provides the immutable execution IR');

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


test('normal author-stage Pack check accepts versioned flow and names a broken input before execution', async t => {
  const home = await localHome(t);
  if (!home) return;
  const { h } = home;
  try {
    await writePackVariant(packsDirOf(h), authoredPackId, [], []);
    const dir = path.join(packsDirOf(h), authoredPackId);
    const original = loadPack(packsDirOf(h), authoredPackId);
    const schema = { version: '1', schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } };
    const graph = {
      schema: 'hima-flow/1', id: authoredPackId, version: original.contract.version,
      flow: { kind: 'sequence', id: 'method', steps: [
        { kind: 'task', id: 'measure', tool: 'synth', inputs: { target: { source: 'goal', path: ['target_period_ns'] } }, contract: { input: schema, output: schema } },
        { kind: 'task', id: 'deliver', tool: 'synth', inputs: { value: { source: 'committedOutput', taskId: 'measure', path: [] } }, contract: { input: schema, output: schema } },
      ] },
    };
    await writePackFiles(dir, {
      'INTENT.md': await committedRecord('grill', pipelineFiles.intent, home.flow.root),
      'SPEC.md': await committedRecord('spec', pipelineFiles.spec, home.flow.root),
      'FABRIC.md': '## Files written\n\ncontract.yml, graph.yml\n\n## Gaps\n\nnone\n\n## Reviews\n\napproved\n',
      'graph.yml': JSON.stringify(graph),
    });
    // The old reference graph inferred Goal names; the versioned graph declares each source.
    const contractFile = path.join(dir, 'contract.yml');
    await writeFile(contractFile, `${await readFile(contractFile, 'utf8')}\ngoal:\n  target_period_ns: {type: number, unit: ns, min: 0.5, max: 10, default: 2}\n`);
    const compiled = loadPack(packsDirOf(h), authoredPackId);
    assert.equal(compiled.flow!.source, 'flow');
    const checked = await packCheck(h);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^stage: compiled \(/m);
    graph.flow.steps[1]!.inputs.value!.taskId = 'missing';
    await writePackFiles(dir, { 'graph.yml': JSON.stringify(graph) });
    const refused = await packCheck(h);
    assert.equal(refused.kind, 'error', refused.text);
    assert.match(refused.text, /inputs\/value.*unknown task missing/);
  } finally { await h.dispose(); }
});
