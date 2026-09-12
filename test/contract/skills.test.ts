// @hima-seam skills direct
// Ticket #63: the pack authoring pipeline's five skills, and the two stages that work end to end.
//
// **The seam.** These run through `bootInProcess` — the same host the window's chat runs, composed
// from the same profile, minus the web app layer. It is the one seam a *user message* reaches
// without a browser: the driver marks Hima's own controls (ADR-0004) and has none for the web app's
// composer, so a driver test could start a Campaign by clicking but could not type `/hima-grill`
// into a chat. What a person's message does to a session is therefore asked here, of the host, and
// `sayAsUser` in the support is the one place any test makes one.
//
// **Three properties.**
//
// *The five skills are on the host, from the bundle.* One provider, `hima`, five bundled candidates
// a person may invoke and the model may not choose for itself — a stage is a person's decision — each
// with a resource base the knowledge files resolve against.
//
// *The first two stages work.* Under dsh's keyless replay stand-in, `/hima-grill` typed the way a
// person types it injects the skill, the model reads the Golden Flow where it lies, and the pack
// intent record is written into the pack folder with the answers, the resolved ambiguity and the
// knowledge that was applied. `/hima-spec` then reads that record and the flow it points at, and
// writes the pack spec beside it. Nothing outside the pack folder is written by either, and no
// file of the Golden Flow is copied into it — which is read off a digest of every file under both,
// taken before and after, rather than off a spot check.
//
// *The folder has a stage.* `/hima pack check` on the authored folder says how far up the ladder it
// has come and what the next rung needs, before there is any contract to check at all.
//
// Nothing here needs an API key and nothing here may have one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type {} from '@deepseek-ai/dsh-skill';
import { bootInProcess, createRootAgent, injectedSkills, saidByModel, sayAsUser, toolCalls, toolResults, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { packsDirOf, timingProbePackId } from './support/pack.ts';
import { writeLocalSite } from './support/site.ts';
import { authoredPackFolder, authoredPackId, changedBetween, committedRecord, digestTrees, GRILL_ANSWERS, GRILL_RESOLUTION, replayStage, sectionsOf } from './support/pipeline.ts';
import {
  FILE_WRITING_TOOLS,
  HIMA_FABRIC_SECTIONS,
  HIMA_INTENT_SECTIONS,
  HIMA_KNOWLEDGE_FILES,
  HIMA_PACK_ANATOMY_FILE,
  HIMA_SKILLS,
  HIMA_SKILL_PROVIDER,
  HIMA_SPEC_SECTIONS,
  HIMA_TEST_SECTIONS,
  SHELL_TOOL,
  himaSkillsDir,
  installedPacks,
  packFiles,
  readingDocument,
  readSemanticsFile,
  semanticValue,
  validateReading,
} from '@hima/harness';


/**
 * The one place the author's words and the Golden Flow disagree, as the committed transcript states
 * it — and the author's own resolution, which is the third message a person sends.
 *
 * Written out here and asserted verbatim, because the claim under test is not "the record mentions a
 * disagreement" but "the disagreement was put to the author as its own question, the author settled
 * it, and what the record holds is what the author said". A loose match on a word like `pass` is
 * satisfied by `bypass`, which is the assertion the first review struck out.
 */
const DISPUTE = 'You said a pass proves the period is achievable; the flow states a slack of exactly zero whenever it meets the period it was asked for, so a pass states no margin at all.';

/**
 * Where a test Run's numbers come from, as `hima-test`'s body states it, and the question it asks
 * when neither source states one.
 *
 * Verbatim, and in the rules that do not bend, because the claim is not "the body mentions the
 * spec" but "the body forbids the stage a value of its own". A live run against the earlier body —
 * which said only that a value comes from the author "or, where they gave none, the ones the spec
 * itself recommends" — read the spec, found it recommended nothing, went looking through this
 * harness's fixtures and source for a number, chose one and spent a Site's licensed time on it. The
 * two sentences below are what closes that: the closed list of sources, and the words that make
 * asking the author the only other move.
 */
const GOAL_AUTHORITY = 'comes from the author\'s message or from the spec\'s `Goal template` recommending one, and from nowhere else';
const GOAL_QUESTION = 'The Goal template names <parameter> and recommends no value; what should this test Run ask for?';

/**
 * The other half of that same rule: what the stage does *while* it is asking.
 *
 * Held beside the question, because the question on its own is a question a stage could ask and then
 * go on to start a Run of its own numbers anyway — which is exactly what a real model did — so the
 * words that bind are "start no Run" and "stop until they answer", and a body that kept the question
 * and dropped those two would leave every other assertion here green.
 */
const GOAL_STARTS_NOTHING = 'ask for it, in these words, and start no Run';
const GOAL_WAITS = 'Then stop until they answer.';

/** The section of a skill body that holds what the stage will not do, whatever it finds. */
const HIMA_TEST_RULES_HEADING = '## Rules that do not bend';

/** A skill body with its line wrapping taken out, so a sentence can be held verbatim wherever the
 *  Markdown happened to break it. Only runs of whitespace collapse; nothing else is touched. */
const unwrapped = (body: string): string => body.replace(/\s+/g, ' ');

/**
 * The list of bullets that **opens** the named section of a skill body, one string per bullet, a
 * bullet's continuation lines folded into it.
 *
 * The opening run and not every bullet of the section, because the spec body walks two of its six
 * again further down that same section under headings of their own, in a list of three; a person
 * reading either body reads the list the section opens with as *the* list, and that is the one both
 * stages have to be stating.
 */
function openingBullets(body: string, heading: string): string[] {
  const from = body.indexOf(heading);
  assert.notEqual(from, -1, `the body carries the heading "${heading}"`);
  const section = body.slice(from + heading.length).split('\n## ')[0]!;
  const bullets: string[] = [];
  let started = false;
  for (const line of section.split('\n')) {
    if (line.startsWith('- ')) { bullets.push(line.slice(2).trim()); started = true; continue; }
    if (!started) continue;
    // An indented line continues the bullet above it; a blank line or an unindented one ends the list.
    if (line.startsWith('  ') && line.trim().length > 0) { bullets[bullets.length - 1] += ` ${line.trim()}`; continue; }
    break;
  }
  return bullets;
}

/**
 * The first sentence of each bullet.
 *
 * The fabric body's sixth runs on for five more lines saying why that contradiction is the one that
 * costs a workspace and a licence; what both bodies have to state in one voice is what the
 * contradiction *is*, and the first sentence is exactly that.
 */
const firstSentences = (bullets: readonly string[]): string[] =>
  bullets.map((bullet) => { const stop = bullet.indexOf('. '); return stop < 0 ? bullet : bullet.slice(0, stop + 1); });

/** The six knowledge reads a stage makes, as `toolCalls` reports them, in the order the bodies list. */
const knowledgeReads = HIMA_KNOWLEDGE_FILES.map((file) => `read ${path.join(himaSkillsDir(), 'knowledge', file)}`);

/**
 * The knowledge the grill record cites — which is deliberately not the list it reads.
 *
 * The body says to read all six and to cite the ones that bear on this business, *each with one line
 * on what it changed*, and then says in as many words: do not cite a file that changed nothing. A
 * record naming all six would be a record disagreeing with the skill it was written under, and the
 * line it would have to write against the sixth name is a line saying that file changed nothing —
 * which is the citation the body forbids. So the reading is proved by the six `read` calls, and the
 * citing is proved by this list.
 */
const APPLIED: readonly string[] = [
  'over-constrain-and-read-the-violation.md',
  'end-honestly-in-more-than-one-way.md',
  'assert-the-checker-options.md',
  'one-checker-per-session.md',
];

/** The knowledge the stage read and did not apply: read, and for that reason not cited. */
const READ_AND_NOT_APPLIED = HIMA_KNOWLEDGE_FILES.filter((file) => !APPLIED.includes(file));

test('on a booted host: the bundle registers the pipeline\'s five skills from one provider — a person\'s to invoke, never the model\'s to choose', async () => {
  const h = await createHimaHome();
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(h);
    const listed = await host.ctx.skills.list({ cwd: h.workspace });
    const mine = listed.filter((s) => s.provider === HIMA_SKILL_PROVIDER);
    assert.deepEqual(mine.map((s) => s.name).sort(), [...HIMA_SKILLS].sort(),
      `the five stages of the pipeline are on the host: ${listed.map((s) => `${s.name}@${s.provider}`).join(', ')}`);

    for (const summary of mine) {
      assert.equal(summary.source, 'bundled', `${summary.name} comes from the bundle`);
      assert.equal(summary.invocation.userInvocable, true, `${summary.name} is a person's to invoke`);
      assert.equal(summary.invocation.modelInvocable, false, `${summary.name} is never the model's to choose: a stage is a person's decision`);
      assert.deepEqual(summary.resourceBase, { kind: 'directory', path: himaSkillsDir() },
        `${summary.name} resolves its relative resources against the skills directory`);
      assert.ok(summary.description.trim().length > 0, `${summary.name} says what it is for`);
    }

    // Every body is loaded from disk through the registry, which is how a stage reaches the model.
    for (const name of HIMA_SKILLS) {
      const skill = await host.ctx.skills.get(name, { cwd: h.workspace });
      assert.ok(skill, `the registry loads ${name}`);
      assert.ok(skill.content.includes(`# ${name}`), `${name}'s body is its own SKILL.md: ${skill.content.slice(0, 120)}`);
    }

    // The three stages that read the authoring knowledge cite it by file name, and the files they
    // cite are where their resource base says they are. The last two stages cite none: a test run and
    // a release are held to the folder and the ledger, not to how a method should be shaped.
    for (const name of ['hima-grill', 'hima-spec', 'hima-fabric'] as const) {
      const body = (await host.ctx.skills.get(name, { cwd: h.workspace }))!.content;
      for (const file of HIMA_KNOWLEDGE_FILES) {
        assert.ok(body.includes(file), `${name} names the knowledge file ${file}`);
      }
    }
    // And the sections each of the two is required to write are the sections the pack folder's stage
    // is judged on. Two spellings of one list — the body the model follows, and the validator that
    // decides whether the record it wrote counts — would drift the first time either is corrected,
    // and the folder would then sit at a stage nobody could explain.
    const grill = (await host.ctx.skills.get('hima-grill', { cwd: h.workspace }))!.content;
    for (const section of HIMA_INTENT_SECTIONS) assert.ok(grill.includes(`\`## ${section}\``), `hima-grill's body names the ${section} section`);
    const spec = (await host.ctx.skills.get('hima-spec', { cwd: h.workspace }))!.content;
    for (const section of HIMA_SPEC_SECTIONS) assert.ok(spec.includes(`\`## ${section}\``), `hima-spec's body names the ${section} section`);
    const fabric = (await host.ctx.skills.get('hima-fabric', { cwd: h.workspace }))!.content;
    for (const section of HIMA_FABRIC_SECTIONS) assert.ok(fabric.includes(`\`## ${section}\``), `hima-fabric's body names the ${section} section`);
    const tested = (await host.ctx.skills.get('hima-test', { cwd: h.workspace }))!.content;
    for (const section of HIMA_TEST_SECTIONS) assert.ok(tested.includes(`\`## ${section}\``), `hima-test's body names the ${section} section`);
    // And each body states the rule its record is actually validated against, in those words: the
    // validator rejects an extra heading, a duplicate and a reordering, so a body that said only
    // "these sections" would be telling the model something weaker than what is enforced.
    for (const [name, body] of [['hima-grill', grill], ['hima-spec', spec], ['hima-fabric', fabric], ['hima-test', tested]] as const) {
      assert.ok(body.includes('exactly these sections, in this order, and no other heading'),
        `${name}'s body states the rule the record is validated against, in those words`);
    }
    // The three stages this ticket built compute nothing: a hash, a folder digest and a check against
    // the ledger are verbs this harness has, and a stage that worked one out itself would put a
    // number in a pack folder that nobody can check. Each body says so, and names the verb it calls.
    const release = (await host.ctx.skills.get('hima-release', { cwd: h.workspace }))!.content;
    for (const [name, body] of [['hima-fabric', fabric], ['hima-test', tested], ['hima-release', release]] as const) {
      assert.ok(body.includes('hima_pack_check'), `${name}'s body checks its own work with the harness's own verb`);
    }
    assert.ok(tested.includes('hima_run') && tested.includes('hima_status'),
      'hima-test starts the campaign and reads it back with the harness\'s own verbs, never from what it expected');
    // And the one thing the test stage may not do with the verb it calls: choose what the Run asks
    // for. A Campaign spends a Site's licensed time, so the numbers it spends it on have an author —
    // the person's own message, or the spec's `Goal template` recommending one — and the body says
    // that as a rule that does not bend, together with the words it asks with when neither states a
    // value. A stage left to fill a Goal parameter in for itself tests a pack nobody asked for, which
    // is what a real model did when the body only said where a value "may" come from.
    // Held against the body's own `Rules that do not bend` and not against the whole file: the Run
    // section describes what to pass, and a description is something a model weighs against what it
    // has found. A rule that does not bend is the section a body puts what it will not do into, and
    // that is where this belongs.
    const doNotBend = tested.slice(tested.indexOf(HIMA_TEST_RULES_HEADING));
    assert.ok(tested.includes(HIMA_TEST_RULES_HEADING), `hima-test's body has a ${HIMA_TEST_RULES_HEADING} section to hold this to`);
    assert.ok(unwrapped(doNotBend).includes(GOAL_AUTHORITY),
      `and it rules there that the Goal's values and the Strategy's overrides have exactly two sources: ${GOAL_AUTHORITY}`);
    assert.ok(unwrapped(doNotBend).includes(GOAL_QUESTION),
      `and gives the words it asks the author with when neither states one: ${GOAL_QUESTION}`);
    assert.ok(unwrapped(doNotBend).includes(GOAL_STARTS_NOTHING),
      `and rules that asking is all it does, starting nothing: ${GOAL_STARTS_NOTHING}`);
    assert.ok(unwrapped(doNotBend).includes(GOAL_WAITS),
      `and that it waits for the answer rather than carrying on without one: ${GOAL_WAITS}`);
    assert.ok(release.includes('hima_pack_release'), 'hima-release seals the folder with the harness\'s own verb');
    assert.ok(release.includes('You write nothing by hand'),
      'and says in as many words that it writes no hash itself, which is the whole of what a release is worth');

    // And in the order the fixtures read them in: the two lists are one list, so a body reordered
    // without the constant, or the other way about, is caught here rather than in a scenario whose
    // failure reads as a transcript problem.
    for (const [name, body] of [['hima-grill', grill], ['hima-spec', spec], ['hima-fabric', fabric]] as const) {
      const at = HIMA_KNOWLEDGE_FILES.map((file) => body.indexOf(file));
      assert.deepEqual([...at].sort((a, b) => a - b), at, `${name} lists the six knowledge files in the order HIMA_KNOWLEDGE_FILES declares them: ${JSON.stringify(at)}`);
    }

    for (const file of [...HIMA_KNOWLEDGE_FILES, HIMA_PACK_ANATOMY_FILE]) {
      const at = path.join(himaSkillsDir(), 'knowledge', file);
      assert.ok(existsSync(at), `the knowledge file is at the resource base: ${at}`);
      assert.ok((await readFile(at, 'utf8')).trim().length > 0, `and it says something: ${at}`);
    }

    // The six ways a spec can contradict itself are one list, and both stages hold a spec to it: the
    // fabric stage refuses a spec that fails one of them, and the spec stage rewrites its own draft
    // before it is written rather than handing on a file the next stage will refuse. Two lists would
    // drift the first time one of them was corrected, and a pack author would find out at the stage
    // that did not get the correction — so the spec body's six are read out of the fabric body's.
    //
    // Held as **one ordered list against the other**, and not by asking whether each of the fabric's
    // turns up somewhere in the spec: a spec body carrying five of the six in a different order, or
    // carrying a seventh of its own, satisfies "each is in there" and is still a second list.
    const refusedBy = firstSentences(openingBullets(fabric, '## Hold the spec against itself, and refuse a contradiction'));
    const heldBy = firstSentences(openingBullets(spec, '## Hold the spec against itself before you write it'));
    assert.equal(refusedBy.length, 6, `the fabric body lists six ways a spec contradicts itself: ${JSON.stringify(refusedBy)}`);
    assert.equal(heldBy.length, 6, `and the spec body holds its own draft against six: ${JSON.stringify(heldBy)}`);
    assert.deepEqual(heldBy, refusedBy,
      'hima-spec holds a draft against the very list hima-fabric refuses it by, item for item and in the same order');
    assert.ok(/\bsix\b/.test(spec.slice(spec.indexOf('## Hold the spec against itself'))),
      'and says how many there are, so a body that lost one says a number that is wrong');

    // The fabric stage's own two sources, named in its body where the model will look for them
    // (#64). The seventh file is the skeleton of every file kind a pack folder holds, and the pack
    // installed beside the folder being authored is the whole example; a body that told the model to
    // write a semantics file, a rule, a chooser or a reader declaration and named neither would be
    // telling it to guess, or to go looking through this harness's own source for the answer.
    assert.ok(fabric.includes(`knowledge/${HIMA_PACK_ANATOMY_FILE}`),
      `hima-fabric names the pack-anatomy reference by the path its resource base resolves: ${HIMA_PACK_ANATOMY_FILE}`);
    assert.ok(fabric.includes(`../${timingProbePackId}/`),
      `and the reference pack beside the folder by the relative path it is read at: ../${timingProbePackId}/`);
    // And the bundle's own three, relative to that same base directory — the shapes a rule and a
    // chooser are written in, and the list of ids a pack may name instead of writing a file.
    for (const at of ['../rules/', '../choosers/', '../semantics.yml']) {
      assert.ok(fabric.includes(at), `hima-fabric names the bundle's ${at}, relative to its resource base`);
      assert.ok(existsSync(path.join(himaSkillsDir(), at)), `and ${at} is really there, relative to that base: ${path.join(himaSkillsDir(), at)}`);
    }

    // The authoring guard holds exactly the tools that change what is at a path, plus the shell.
    // That list is read off the booted host rather than remembered, and this is where it is held to
    // one: a dsh release that registered a third file-writing tool would otherwise open a door in
    // the containment rule silently, and a suite that never asked would never notice.
    const takesAPath = host.ctx.tools.schemas()
      .filter((schema) => Object.hasOwn((schema.parameters as { properties?: object }).properties ?? {}, 'file_path'))
      .map((schema) => schema.name)
      .sort();
    assert.deepEqual(takesAPath, ['edit', 'read', 'read_image', 'write'],
      `every tool on this host that takes a file_path is one the guard has classified: ${takesAPath.join(', ')}`);
    assert.deepEqual([...FILE_WRITING_TOOLS].sort(), ['edit', 'write'],
      'and the ones that change what is at that path are the ones the guard holds to the pack folder');
    assert.ok(host.ctx.tools.schemas().some((schema) => schema.name === SHELL_TOOL),
      `the shell the guard refuses an authoring session is a tool this host really registers: ${SHELL_TOOL}`);

    // And none of the five says it is unbuilt any more: the last three were stubs until #64, and a
    // body still telling a person to wait for a ticket is a stage that would not run.
    for (const name of HIMA_SKILLS) {
      const body = (await host.ctx.skills.get(name, { cwd: h.workspace }))!.content;
      assert.ok(!body.includes('not built yet'), `${name} is a stage a person can actually run: ${body.slice(0, 200)}`);
    }
  } finally {
    if (host) await host.dispose();
    await h.dispose();
  }
});

test('through a booted host with the replay stand-in: /hima-grill writes the pack intent record in the pack folder and nothing outside it, /hima-spec writes the pack spec beside it, and pack check says the folder is specified', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  try {
    await grillThenSpec(home);
  } finally {
    await h.dispose();
  }
});

/** The two stages on one folder, so the home above is disposed however this ends. */
async function grillThenSpec(home: { h: HimaHome; flow: { root: string } }): Promise<void> {
  const h = home.h;
  const packDir = await authoredPackFolder(h);
  // Everything a stage must not touch: the Golden Flow where it lies, the home's workspace, and
  // every other pack installed beside the one being authored.
  const outside = [home.flow.root, h.workspace, packsDirOf(h)];
  const before = await digestTrees(outside, packDir);
  assert.ok(before.size > 5, `the digest read the trees rather than nothing: ${String(before.size)} files`);

  // ---------------------------------------------------------------------------------------------
  // Grill.
  // ---------------------------------------------------------------------------------------------
  await replayStage(h, 'grill');
  let host = await bootInProcess(h);
  try {
    // The session's working directory is the pack folder, which is what dsh's workspace-write
    // sandbox holds every write of this session to.
    const agent = await createRootAgent(host.ctx, packDir);
    await sayAsUser(agent, `/hima-grill I want to know the tightest clock period this flow closes at; the flow is at ${home.flow.root}`);
    await sayAsUser(agent, GRILL_ANSWERS);
    // The disagreement the stage found in the flow is put to the author as its own question, and
    // the author settles it in a message of their own. Neither side wins silently, which is the
    // whole of what "grilled" means here — so the question is a turn that ends, and the answer is a
    // person's message and not something the stage decided for itself.
    assert.ok(saidByModel(agent).some((said) => said.includes(DISPUTE)),
      `the stage asked the disagreement as its own question before writing anything: ${JSON.stringify(saidByModel(agent))}`);
    await sayAsUser(agent, GRILL_RESOLUTION);

    assert.deepEqual(injectedSkills(agent), ['hima-grill'],
      'the person\'s own message injected the grill skill into the session, once');
    assert.deepEqual(toolCalls(agent).map((c) => `${c.name} ${String(c.args.file_path)}`), [
      `read ${path.join(home.flow.root, 'Makefile')}`,
      ...knowledgeReads,
      'write INTENT.md',
    ], 'the flow was read where it lies, all six knowledge files were read before the record was written, and the only write was into the session\'s own folder');
  } finally {
    await host.dispose();
  }

  const intentAt = path.join(packDir, 'INTENT.md');
  assert.ok(existsSync(intentAt), `the grill stage wrote the pack intent record: ${intentAt}`);
  const intent = await readFile(intentAt, 'utf8');
  assert.deepEqual(sectionsOf(intent), [...HIMA_INTENT_SECTIONS], 'the record holds exactly the five sections, in order');
  assert.ok(intent.includes(home.flow.root), 'the Golden Flow section points at where the flow lies');
  const answersSection = intent.slice(intent.indexOf('## Answers'), intent.indexOf('## Ambiguities resolved'));
  assert.equal([...answersSection.matchAll(/^\d+\. /gm)].length, 3, `the three answers are there, numbered: ${answersSection}`);
  // The disagreement and its resolution, word for word. Not a substring another sentence could
  // satisfy: what is being asserted is that the record holds the dispute the stage raised and the
  // answer the author gave, and a record holding neither would match a looser pattern happily.
  const ambiguities = intent.slice(intent.indexOf('## Ambiguities resolved'), intent.indexOf('## Knowledge applied'));
  assert.ok(ambiguities.includes(DISPUTE), `the record holds the disagreement as it was put to the author: ${ambiguities}`);
  assert.ok(ambiguities.includes(GRILL_RESOLUTION), `and the author's own resolution, in the author's words: ${ambiguities}`);
  // What the record cites is what applied, and nothing else. The six reads asserted above are what
  // says the stage looked at every one of them; this is what says it wrote down only the ones that
  // shaped an answer, each with its one line — because a section that named a file and then said
  // that file changed nothing is the citation the body forbids in those words.
  const applied = intent.slice(intent.indexOf('## Knowledge applied'));
  const cited = HIMA_KNOWLEDGE_FILES.filter((file) => applied.includes(file));
  assert.deepEqual(cited, [...APPLIED],
    `the record cites the knowledge that shaped it, in the order it was read: ${applied}`);
  for (const file of READ_AND_NOT_APPLIED) {
    assert.ok(!applied.includes(file),
      `${file} was read and bore on nothing here, so the record does not cite it as if it had: ${applied}`);
  }
  assert.equal([...applied.matchAll(/^- `/gm)].length, APPLIED.length,
    `each file the record cites gets its own line on what it changed: ${applied}`);

  assert.deepEqual(changedBetween(before, await digestTrees(outside, packDir)), [],
    'the grill stage wrote nothing outside the pack folder, and copied no file of the Golden Flow into it');

  // ---------------------------------------------------------------------------------------------
  // Spec, on the same folder.
  // ---------------------------------------------------------------------------------------------
  await replayStage(h, 'spec');
  host = await bootInProcess(h);
  try {
    const agent = await createRootAgent(host.ctx, packDir);
    await sayAsUser(agent, '/hima-spec');
    assert.deepEqual(injectedSkills(agent), ['hima-spec'], 'the person\'s own message injected the spec skill');
    assert.deepEqual(toolCalls(agent).map((c) => `${c.name} ${String(c.args.file_path)}`), [
      'read INTENT.md',
      `read ${path.join(home.flow.root, 'Makefile')}`,
      ...knowledgeReads,
      'write SPEC.md',
    ], 'the spec stage read the record, then the flow at the pointers the record gives it, then all six knowledge files, and wrote one file');

    // The stage of the folder the two stages just authored, in the words `/hima pack check` says it
    // in — asked before there is any contract in the folder to check at all.
    const checked = await himaCommand(host, h.workspace, `/hima pack check ${authoredPackId} --site local`, 10_000, agent);
    assert.equal(checked.kind, 'error', `a folder with no contract cannot host a campaign yet: ${checked.text}`);
    assert.match(checked.text, /unfit — not compiled/, checked.text);
    assert.match(checked.text, /stage: specified \(INTENT\.md, SPEC\.md validate\)/, checked.text);
    assert.match(checked.text, /next: compiled — contract\.yml, graph\.yml and FABRIC\.md, written by \/hima-fabric/, checked.text);
    assert.ok(!checked.text.includes('unknown pack'), `and it is not answered as an unknown pack: ${checked.text}`);
  } finally {
    await host.dispose();
  }

  const specAt = path.join(packDir, 'SPEC.md');
  assert.ok(existsSync(specAt), `the spec stage wrote the pack spec: ${specAt}`);
  const spec = await readFile(specAt, 'utf8');
  assert.deepEqual(sectionsOf(spec), [...HIMA_SPEC_SECTIONS], 'the spec holds exactly the nine sections, in order');
  // Every one of the nine says which knowledge shaped it, `Knowledge` included. "Each section says
  // which knowledge file shaped it" is what the body requires, and a count that allowed six of them
  // to say nothing would be checking that the stage sometimes remembered.
  const written = spec.split(/^## /m).slice(1);
  const silent = written
    .filter((section) => !HIMA_KNOWLEDGE_FILES.some((file) => section.includes(file)))
    .map((section) => section.slice(0, section.indexOf('\n')).trim());
  assert.deepEqual(silent, [], `every section of the spec names the knowledge that shaped it; these name none: ${silent.join(', ')}`);

  assert.deepEqual(changedBetween(before, await digestTrees(outside, packDir)), [],
    'the spec stage wrote nothing outside the pack folder either');

  // A folder the pipeline is still authoring is not a pack the start form may offer: nothing in it
  // could start a Campaign, and a list that offered it would be a list of things that fail on click.
  assert.ok(!installedPacks(packsDirOf(h)).includes(authoredPackId),
    `the start form lists only folders holding a ${packFiles.contract}: ${installedPacks(packsDirOf(h)).join(', ')}`);
}

/**
 * The containment rule, at the seam a person reaches it through.
 *
 * **Why this is a guard and not a longer skill body.** Every body says the pack folder is the only
 * place a stage writes. The first review's word for that was containment by prose, and it was right:
 * instruction addressed to a model is a recommendation. dsh's own file sandbox is real enforcement
 * and is not this rule — `workspace-write` fences a session to its workspace root *plus the platform
 * temp areas*, which is what the mode promises tools that write temporary files, so a Golden Flow
 * lying under `os.tmpdir()` (which is where every isolated home in this suite lives, and where a
 * person's scratch checkout may well live too) is inside the sandbox and outside the pack folder.
 * `ctx.tools.guard` is where the rule goes instead: monotonic, synchronous, before the tool body,
 * and with no allow result, so nothing registered later can turn a denial back into permission.
 *
 * **Two halves, and the second is what makes the first mean anything.** The same committed
 * transcript is replayed twice on one home, against one flow, with one pair of calls — a `write`
 * aimed at the Golden Flow's own `Makefile`, and a `bash`. In the session standing in the pack
 * folder both are refused in the guard's words and the flow is byte for byte what it was. In a
 * session standing in the ordinary workspace both go through and the flow really is rewritten —
 * which is how this test says that the guard, and nothing else about the arrangement, is what
 * stopped them.
 */
test('through a booted host with the replay stand-in: an authoring session may not write outside its pack folder and has no shell, and the same two calls go through in an ordinary session', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  try {
    const makefile = path.join(home.flow.root, 'Makefile');
    const asWritten = await readFile(makefile, 'utf8');
    const packDir = await authoredPackFolder(h, 'escaping-probe');
    // The guard names the pack folder as it resolves it, and on this platform the temporary
    // directory every home is made under is itself a symlink — so a test comparing spellings would
    // be asserting on `/var` against `/private/var`.
    const folder = await realpath(packDir);
    const flowDigest = await digestTrees([home.flow.root], packDir);
    assert.ok(flowDigest.size > 1, `the digest read the Golden Flow rather than nothing: ${String(flowDigest.size)} files`);

    // ------------------------------------------------------------------------------------------
    // Standing in the pack folder: an authoring session.
    // ------------------------------------------------------------------------------------------
    await replayStage(h, 'escape');
    let host = await bootInProcess(h);
    try {
      const agent = await createRootAgent(host.ctx, packDir);
      await sayAsUser(agent, `/hima-grill Author a pack for this business; the flow is at ${home.flow.root}`);

      assert.deepEqual(toolCalls(agent).map((c) => c.name), ['read', 'write', 'bash'],
        'the model really did read the Golden Flow, aim a write at it and then reach for a shell, which is what makes the rest of this test mean anything');
      const refused = toolResults(agent);
      assert.equal(refused.length, 3, `all three calls were answered: ${JSON.stringify(refused)}`);
      assert.ok(!refused[0]!.failed, `the read of the flow where it lies is exactly what a stage is told to do, and it goes through: ${refused[0]!.text}`);
      assert.ok(refused[1]!.failed, `the write was answered as a failure: ${JSON.stringify(refused[1])}`);
      assert.ok(refused[1]!.text.includes(`a pack authoring session in ${folder} writes only inside the pack folder`),
        `in the guard's words, naming the pack folder: ${refused[1]!.text}`);
      assert.ok(refused[1]!.text.includes(makefile), `and the path it refused: ${refused[1]!.text}`);
      assert.ok(refused[1]!.text.includes('which is outside it'), `and why: ${refused[1]!.text}`);
      assert.ok(refused[2]!.failed, `the shell was answered as a failure too: ${JSON.stringify(refused[2])}`);
      assert.ok(refused[2]!.text.includes(`a pack authoring session in ${folder} has no shell`),
        `in the guard's words: ${refused[2]!.text}`);
    } finally {
      await host.dispose();
    }
    assert.equal(await readFile(makefile, 'utf8'), asWritten, 'and the Golden Flow is byte for byte what it was');
    assert.deepEqual(changedBetween(flowDigest, await digestTrees([home.flow.root], packDir)), [],
      'as is every other file under it');

    // ------------------------------------------------------------------------------------------
    // Standing in the ordinary workspace: the same two calls, untouched by this rule.
    // ------------------------------------------------------------------------------------------
    await replayStage(h, 'escape');
    host = await bootInProcess(h);
    try {
      const agent = await createRootAgent(host.ctx, h.workspace);
      await sayAsUser(agent, `/hima-grill Author a pack for this business; the flow is at ${home.flow.root}`);
      const allowed = toolResults(agent);
      assert.equal(allowed.length, 3, `all three calls were answered: ${JSON.stringify(allowed)}`);
      assert.ok(!allowed[1]!.failed, `the very write the pack folder refused goes through here: ${allowed[1]!.text}`);
      assert.ok(!allowed[2]!.failed, `and so does the shell: ${allowed[2]!.text}`);
    } finally {
      await host.dispose();
    }
    assert.notEqual(await readFile(makefile, 'utf8'), asWritten,
      'the flow really was rewritten from the ordinary session, which is what says the guard — and not the sandbox, the home\'s layout or the transcript — is what refused it in the pack folder');
  } finally {
    await h.dispose();
  }
});

/**
 * The target rule, at the seam a person reaches it through: what an authoring session may aim a
 * write at, judged as the tool received it.
 *
 * **Why the spelling is not normalised first.** A `..` beside a symlink names two different files
 * depending on who resolves it. `path.join` and `path.resolve` remove it *lexically*, before
 * anything has looked at the filesystem; the kernel removes it *after* following each link. For
 * `link/../escaped.md`, with `link` a symlink out of the pack folder, the two answers are
 * `<folder>/escaped.md` and a file outside the folder — and the split runs right through Node
 * itself, whose `fs.realpathSync` gives the first answer and whose `fs.realpathSync.native` gives
 * the second. A guard that normalises first is not deciding about the path the write takes; it is
 * agreeing with whichever resolver the tool beneath it happens to use, which is a fact about that
 * tool and not a rule. So the target is taken as the tool received it, a `.` or `..` segment
 * anywhere in it is refused by name — nothing an authoring stage writes needs one — and only then
 * is the deepest existing ancestor resolved.
 *
 * Six targets and a read in one session, because they are one rule: a new file at the top of the
 * folder goes through (creating it is the point of the stage), and the dangling link, the three
 * spellings that climb, and an `edit` aimed outside do not.
 */
test('through a booted host with the replay stand-in: an authoring session\'s target is judged as the tool received it — a new file inside the folder goes through, and a dot segment, a link out of the folder and an edit outside do not', async () => {
  const h = await createHimaHome();
  let host: InProcessHost | undefined;
  try {
    const packDir = await authoredPackFolder(h, 'target-probe');
    // The guard names the folder as it resolves it, and the temporary directory every home is made
    // under is itself a symlink on this platform.
    const folder = await realpath(packDir);
    const outsideDir = path.join(h.workspace, 'elsewhere');
    await mkdir(outsideDir, { recursive: true });
    const outsideFile = path.join(h.workspace, 'outside.md');
    await writeFile(outsideFile, 'the file an authoring session may not touch\n');
    // A link out of the pack folder, and a link inside it pointing at something that is not there.
    await symlink(outsideDir, path.join(packDir, 'link'));
    await symlink(path.join(outsideDir, 'not-there.md'), path.join(packDir, 'dangling.md'));
    await mkdir(path.join(packDir, 'sub'), { recursive: true });
    const before = await digestTrees([h.workspace], packDir);
    assert.ok(before.size > 0, `the digest read the workspace rather than nothing: ${String(before.size)} files`);

    await replayStage(h, 'targets');
    host = await bootInProcess(h);
    const agent = await createRootAgent(host.ctx, packDir);
    // Each path ends its line: the transcript reads both out of this message with a `(\S+)` capture,
    // and a full stop after the path would become part of the filename.
    await sayAsUser(agent, `/hima-grill Author a pack for this business, where the outside file is ${outsideFile}\nand the pack folder is ${packDir}\n`);

    assert.deepEqual(toolCalls(agent).map((c) => c.name), ['read', 'write', 'write', 'write', 'write', 'write', 'edit'],
      `the model really did aim all six writes and the edit, which is what makes the rest of this test mean anything: ${JSON.stringify(toolCalls(agent))}`);
    const answered = toolResults(agent);
    assert.equal(answered.length, 7, `every call was answered: ${JSON.stringify(answered)}`);
    const [readOutside, newFile, dangling, dotDot, throughLink, throughLinkAbsolute, editOutside] = answered;

    assert.ok(!readOutside!.failed, `reading outside the pack folder is what a stage is told to do, and it goes through: ${readOutside!.text}`);

    // A file that is not there yet is the ordinary case: creating it is the stage's whole job, and a
    // rule that could only allow files that already exist would allow nothing a stage does.
    assert.ok(!newFile!.failed, `a new file at the top of the pack folder goes through: ${newFile!.text}`);
    assert.equal(await readFile(path.join(packDir, 'NEW.md'), 'utf8'), 'A file of this pack that was not there before.\n');

    // A link inside the folder pointing at something that is not there is still a path, and a write
    // follows it to wherever it names.
    assert.ok(dangling!.failed, `the dangling link was refused: ${JSON.stringify(dangling)}`);
    assert.ok(dangling!.text.includes(`a pack authoring session in ${folder} writes only inside the pack folder`),
      `in the guard's words: ${dangling!.text}`);
    assert.ok(dangling!.text.includes('is present and does not resolve'), `and why: ${dangling!.text}`);

    for (const [what, refused] of [['a relative spelling', dotDot], ['a link out of the folder', throughLink], ['the same climb spelled absolutely', throughLinkAbsolute]] as const) {
      assert.ok(refused!.failed, `${what} that climbs was refused: ${JSON.stringify(refused)}`);
      assert.ok(refused!.text.includes(`a pack authoring session in ${folder} writes only inside the pack folder`),
        `${what}, in the guard's words: ${refused!.text}`);
      assert.ok(refused!.text.includes('names the segment ".."'),
        `${what} is refused by the segment itself, named: ${refused!.text}`);
    }

    assert.ok(editOutside!.failed, `the edit aimed outside the pack folder was refused: ${JSON.stringify(editOutside)}`);
    assert.ok(editOutside!.text.includes(`a pack authoring session in ${folder} writes only inside the pack folder`),
      `in the guard's words — the rule holds every tool that changes what is at a path, not only write: ${editOutside!.text}`);
    assert.ok(editOutside!.text.includes('which is outside it'), `and why: ${editOutside!.text}`);

    // And nothing landed where either reading of those spellings points. The digest is the claim in
    // full; `escaped.md` and `escaped-too.md` are where the climbs land for a resolver that follows
    // the link first, and `INTENT.md` is where they land for one that normalises first.
    for (const at of [
      path.join(outsideDir, 'escaped.md'), path.join(packDir, 'escaped.md'),
      path.join(h.workspace, 'escaped-too.md'), path.join(packDir, 'escaped-too.md'),
      path.join(packDir, 'INTENT.md'),
    ]) {
      assert.ok(!existsSync(at), `a refused write wrote nothing, under either reading of the spelling: ${at}`);
    }
    assert.deepEqual(changedBetween(before, await digestTrees([h.workspace], packDir)), [],
      'nothing outside the pack folder was written, and the file the edit aimed at is what it was');
  } finally {
    if (host) await host.dispose();
    await h.dispose();
  }
});

/**
 * The posture this rule takes when it cannot decide something, at the same seam.
 *
 * A containment rule is only as good as what it does when a path will not resolve, and the two paths
 * it resolves are answered differently *on purpose*:
 *
 * - **the packs directory**, when it is not there at all, leaves every session on the host untouched
 *   — no working directory can lie beneath a directory that does not exist, so there is nothing to
 *   decide and nothing to refuse. Any *other* way of failing to resolve it is the opposite: the
 *   host can no longer tell an authoring session from an ordinary one, and the governed tools stop
 *   in every session until it can.
 * - **the session's own working directory** has no such benign absence. A session whose own
 *   directory this harness cannot resolve to a directory is one it cannot place, and answering
 *   "elsewhere" for it is exactly the fail-open the rule exists to refuse.
 *
 * One booted host, one transcript, four sessions: the packs directory is changed underneath them
 * between sessions, which is also the truth of it — the guard resolves both paths at the moment of
 * the call, not at boot.
 */
test('through a booted host with the replay stand-in: an absent packs directory leaves a session untouched, and a packs directory or a working directory that will not resolve stops the governed tools', async () => {
  const h = await createHimaHome();
  try {
    const packsDir = packsDirOf(h);
    await rm(packsDir, { recursive: true, force: true });
    const outsideFile = path.join(h.workspace, 'outside.md');
    const asWritten = 'the file a session this rule says nothing about may rewrite\n';
    await writeFile(outsideFile, asWritten);
    const rewritten = 'Rewritten by a session this rule has nothing to say about.\n';

    // A message with no `/name` gesture in it: what is under test is where a session stands, which
    // is a fact about the session and not about the skill it is running.
    const said = `Please rewrite the outside file is ${outsideFile}\n`;
    /**
     * One case: a host booted on the home as it now stands, one session in `cwd`, the transcript
     * replayed. A boot apiece because replay's cursor does not go back to the start for a second
     * session, and every case here needs the transcript from its first entry.
     *
     * @param cwd - where the session stands.
     * @param afterOpen - what happens to the filesystem between the session opening and its turn,
     *                    which is the only way to ask about a working directory that was there when
     *                    the session was made and is not there when it writes.
     */
    const answers = async (cwd: string, afterOpen?: () => Promise<void>): Promise<{ failed: boolean; text: string }[]> => {
      await replayStage(h, 'posture');
      const host = await bootInProcess(h);
      try {
        const agent = await createRootAgent(host.ctx, cwd);
        if (afterOpen) await afterOpen();
        await sayAsUser(agent, said);
        const results = toolResults(agent);
        assert.equal(results.length, 2, `both calls of the transcript were answered in the session at ${cwd}: ${JSON.stringify(results)}`);
        assert.ok(!results[0]!.failed, `the read is not a governed tool and goes through wherever the session stands: ${results[0]!.text}`);
        return results;
      } finally {
        await host.dispose();
      }
    };

    // 1. No packs directory at all: nothing is an authoring session, and an ordinary session writes
    //    exactly as it did before this rule existed.
    const absent = await answers(h.workspace);
    assert.ok(!absent[1]!.failed, `with no packs directory there is no authoring session to be confused with: ${absent[1]!.text}`);
    assert.equal(await readFile(outsideFile, 'utf8'), rewritten, 'and the write really happened');

    // 2. A packs directory that is there and does not resolve — a link to somewhere nothing is. The
    //    host can no longer say which sessions are authoring sessions, so the governed tools stop in
    //    all of them, including this ordinary one.
    await mkdir(path.dirname(packsDir), { recursive: true });
    await symlink(path.join(h.home, 'hima/nowhere'), packsDir);
    const dangling = await answers(h.workspace);
    assert.ok(dangling[1]!.failed, `a packs directory that will not resolve stops the write: ${dangling[1]!.text}`);
    assert.ok(dangling[1]!.text.includes(packsDir), `naming the packs directory: ${dangling[1]!.text}`);
    assert.ok(dangling[1]!.text.includes('cannot be resolved'), `and saying that is what went wrong: ${dangling[1]!.text}`);
    await unlink(packsDir);

    // 3. A session whose working directory was removed after it opened. It cannot be placed, so it
    //    does not write — and the refusal names the directory rather than the file.
    const vanishing = path.join(packsDir, 'vanishing-probe');
    await mkdir(vanishing, { recursive: true });
    const gone = await answers(vanishing, () => rm(vanishing, { recursive: true, force: true }));
    assert.ok(gone[1]!.failed, `a session whose own directory is not there does not write: ${gone[1]!.text}`);
    assert.ok(gone[1]!.text.includes(`working directory ${vanishing}`),
      `and the refusal is about the working directory, named — not about a pack folder reconstructed out of a path that is not there: ${gone[1]!.text}`);

    // 4. An ordinary file where a pack folder would be, and a session standing below it. The path
    //    does not resolve for a reason that is not "nothing is there" — and a session inside no pack
    //    folder that cannot be placed is refused, not waved through.
    const notAFolder = path.join(packsDir, 'not-a-folder');
    await mkdir(packsDir, { recursive: true });
    await writeFile(notAFolder, 'a file where a pack folder would be\n');
    const beneath = await answers(path.join(notAFolder, 'inside'));
    assert.ok(beneath[1]!.failed, `a session standing below a file is not an authoring session and is not an ordinary one either: ${beneath[1]!.text}`);
    assert.ok(beneath[1]!.text.includes(`working directory ${path.join(notAFolder, 'inside')}`),
      `and the refusal is about the working directory, named: ${beneath[1]!.text}`);

    assert.equal(await readFile(outsideFile, 'utf8'), rewritten,
      'and the three refused sessions left the file exactly as the first one left it');
  } finally {
    await h.dispose();
  }
});

test('the intent record the live check authors its spec stage from is the one the contract suite runs the grill stage against', async (t) => {
  // `committedRecord` reads the record out of the committed transcript so the keyless run and the
  // live run author from one intent. It parses the transcript's own encoding, where the flow's path
  // is still a `{{fromRequest:…}}` placeholder — a raw `JSON.parse` of those arguments throws on the
  // pattern's backslash, which is a fault nothing in the suite would have met, because the live
  // check is the only caller and the live check needs a key.
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  try {
    const record = await committedRecord('grill', 'INTENT.md', home.flow.root);
    assert.deepEqual(sectionsOf(record), [...HIMA_INTENT_SECTIONS], 'the committed record holds exactly the five sections, in order');
    assert.ok(record.includes(home.flow.root), `with the Golden Flow's real path where the placeholder was: ${record.slice(0, 400)}`);
    assert.ok(!record.includes('{{fromRequest'), `and no placeholder left in it: ${record}`);
  } finally {
    await home.h.dispose();
  }
});

// ---------------------------------------------------------------------------------------------
// The seventh reference file: every skeleton in it is a file this harness accepts (#64).
// ---------------------------------------------------------------------------------------------

/**
 * The fenced blocks of `pack-anatomy.md`, by the file kind the `##` heading they stand under names.
 *
 * The file tells the fabric stage what the smallest accepted file of each kind looks like, so a
 * skeleton that has drifted from the schemas is a stage being told to write something the harness
 * refuses — which is exactly the shape of authority that is worse than none. Extracting by heading
 * rather than by position is what makes this hold as the file grows: a block nobody claimed is a
 * block nothing here parses, and a heading that lost its block is an empty list below.
 *
 * @param text - the whole reference file.
 * @returns for each `##` heading, the fenced blocks under it with the language each declares.
 */
function fencedBlocksByHeading(text: string): Map<string, { language: string; body: string }[]> {
  const sections = new Map<string, { language: string; body: string }[]>();
  let heading: string | undefined;
  let fence: { language: string; lines: string[] } | undefined;
  for (const line of text.split('\n')) {
    const opened = /^```(\w*)\s*$/.exec(line);
    if (fence === undefined && opened && heading !== undefined) {
      fence = { language: opened[1] ?? '', lines: [] };
      continue;
    }
    if (fence !== undefined) {
      if (line.trim() === '```') {
        sections.get(heading!)!.push({ language: fence.language, body: `${fence.lines.join('\n')}\n` });
        fence = undefined;
        continue;
      }
      fence.lines.push(line);
      continue;
    }
    const named = /^## (.+?)\s*$/.exec(line);
    if (named) { heading = named[1]!; sections.set(heading, []); }
  }
  assert.equal(fence, undefined, 'every fenced block in the reference file is closed');
  return sections;
}

/** The one block of one kind the file shows, by the heading that names that kind and the language it
 *  is fenced as. Asserted rather than searched for: a heading that stopped showing its skeleton is
 *  the failure this whole test exists to catch. */
function theBlock(
  blocks: Map<string, { language: string; body: string }[]>,
  headingStartsWith: string,
  language: string,
): string {
  const heading = [...blocks.keys()].find((name) => name.startsWith(headingStartsWith));
  assert.ok(heading !== undefined, `${HIMA_PACK_ANATOMY_FILE} holds a "## ${headingStartsWith}…" heading: ${[...blocks.keys()].join(' | ')}`);
  const found = blocks.get(heading)!.filter((block) => block.language === language);
  assert.equal(found.length, 1, `"## ${heading}" shows exactly one ${language} block, and it is the skeleton of that kind`);
  return found[0]!.body;
}

test('every skeleton in the pack anatomy reference is a file this harness accepts: assembled into a folder they load as a pack and fit the local site', async (t) => {
  // The authority a stage is told to write from, held to the very schemas the stage's work is judged
  // by. Nothing here is a second spelling of those schemas: the blocks are written into a real pack
  // folder and put through `loadPack` and `checkPack`, which is the same path `hima_pack_check`
  // takes — so a key renamed in `packs.ts` tomorrow fails here rather than going quietly stale in a
  // file a model reads and believes.
  const local = await localHome(t, { sleepSeconds: 1 });
  if (!local) return;
  const h = local.h;
  try {
    const blocks = fencedBlocksByHeading(await readFile(path.join(himaSkillsDir(), 'knowledge', HIMA_PACK_ANATOMY_FILE), 'utf8'));
    const contract = theBlock(blocks, '`contract.yml`', 'yaml');
    const graph = theBlock(blocks, '`graph.yml`', 'yaml');
    const semantics = theBlock(blocks, '`semantics.yml`', 'yaml');
    const rule = theBlock(blocks, '`rules/<id>.yml`', 'yaml');
    const chooser = theBlock(blocks, '`choosers/<id>.yml`', 'yaml');
    const readerHeading = '`readers/<id>.yml`';
    const reader = theBlock(blocks, readerHeading, 'yaml');
    const readerScript = theBlock(blocks, readerHeading, 'sh');
    const reading = theBlock(blocks, readerHeading, 'json');
    const knowledge = theBlock(blocks, '`knowledge/<file>.md`', 'markdown');

    // The ids the skeletons name each other by, read out of the blocks themselves rather than
    // repeated here: a file this test named for itself would pass while the reference file drifted.
    const id = (parse(contract) as { id: string }).id;
    const ruleId = (parse(rule) as { id: string }).id;
    const chooserId = (parse(chooser) as { id: string }).id;
    const readerDeclaration = parse(reader) as { id: string; file: string; emits: string[] };
    const knowledgeFile = (parse(contract) as { knowledge: { file: string }[] }).knowledge[0]!.file;
    const toolFile = (parse(contract) as { tools: { file: string }[] }).tools[0]!.file;

    const dir = path.join(packsDirOf(h), id);
    await mkdir(dir, { recursive: true });
    for (const [at, body] of [
      [packFiles.contract, contract],
      [packFiles.graph, graph],
      ['semantics.yml', semantics],
      [`rules/${ruleId}.yml`, rule],
      [`choosers/${chooserId}.yml`, chooser],
      [`readers/${readerDeclaration.id}.yml`, reader],
      [readerDeclaration.file, readerScript],
      [toolFile, '#!/bin/sh\n# The tool the contract declares, holding the command line it declares.\nexit 0\n'],
      [`knowledge/${knowledgeFile}`, knowledge],
    ] as const) {
      await mkdir(path.dirname(path.join(dir, at)), { recursive: true });
      await writeFile(path.join(dir, at), body);
    }

    // A Site that binds what this contract asks for and declares the seats its one tool holds. The
    // pack is the thing under test; a Site is what any customer's would be.
    await writeLocalSite(h, {
      allowedReadRoots: [h.workspace, local.flow.root],
      allowedWriteRoots: [h.workspace],
      bindings: { flowRoot: local.flow.root, subject: 'a-subject', workspaceRoot: h.workspace },
      licences: { 'measuring-seat': 1 },
    });

    const host = await bootInProcess(h);
    try {
      const checked = await himaCommand(host, h.workspace, `/hima pack check ${id} --site local`, 20_000);
      for (const line of checked.text.split('\n')) t.diagnostic(line);
      assert.equal(checked.kind, 'success', checked.text);
      assert.match(checked.text, new RegExp(`^pack ${id}@1 on site local: fit\\b`), checked.text);
    } finally {
      await host.dispose();
    }

    // And the document the shown script writes, put through the two schemas a pack script's output
    // meets at the one gate and then through the validator itself, against the shown reader and the
    // semantics as the folder now holds them. A skeleton whose document carried a qualifier the
    // semantics beside it does not declare would be a reader nothing of this harness would accept.
    const values = readingDocument.parse(JSON.parse(reading)).values.map((value) => semanticValue.parse(value));
    const declared = readSemanticsFile(path.join(dir, 'semantics.yml'))!.values;
    assert.deepEqual(validateReading({ id: readerDeclaration.id, emits: readerDeclaration.emits }, values, declared), [],
      'the reading document the reference file shows is one this harness would accept as an observation');
  } finally {
    await h.dispose();
  }
});
