// The live check for the pack authoring pipeline (#63, #64): five real stages, with the owner's own
// key, through the product.
//
// Everything about a stage that the contract suite can prove, it proves against dsh's keyless replay
// adapter: the session is real, the loop is real, the skill injection is real, the `read` and `write`
// tools are real and the sandbox holding them to the pack folder is real — the model's words are
// recorded. What no keyless run can prove is that a *model* does what a skill body asks: that
// `/hima-grill` makes it interview rather than improvise a record, that `/hima-spec` writes the nine
// sections into one file and touches nothing else, that `/hima-fabric` compiles a spec a model wrote
// into a pack that actually loads and fits, that `/hima-test` starts a campaign and writes the record
// from what that campaign recorded, and that `/hima-release` seals the folder with a verb rather than
// typing hashes. That is what this script is, and it is why D48 asks for one before any merge that
// touches a skill: a skill body is instructions a model follows with real file tools on a person's
// machine, and a body nobody has run is a guess.
//
// It is D24's shape — a record beside the run, every claim a check with its own predicate, a failed
// check writing the record and exiting non-zero — and it is the smallest such run there can be: one
// isolated home, one stand-in flow lying where a Golden Flow lies, one scratch pack folder, one turn
// per stage — with the author's review of a script the fabric stage wrote answered by this script —
// and a scan of everything the run wrote.
//
// **The seam is the booted host, not the shell.** The desktop driver marks Hima's own controls
// (ADR-0004) and has none for the web app's composer, so a person's `/hima-grill` message cannot be
// typed through it. `bootInProcess` is the same host the window's chat runs, and `sayAsUser` sends
// the message the way a person sends one. No replay overlay is written, so the host composes the
// product's own DeepSeek adapter and the key below is the only reason a turn can answer at all.
//
// **The key.** It comes from the environment this script is launched with and from nowhere else.
// This product writes no key, reads none from a file of its own, and puts none in a record: what the
// record carries is the key's *shape* — its length and its first four characters. Run without a key,
// this refuses in words, says where a key comes from, and exits non-zero without booting anything.
//
// Run it as:
//   DEEPSEEK_API_KEY=… node scripts/live-check-pipeline.ts [--out <dir>]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { bootInProcess, createRootAgent, injectedSkills, sayAsUser, saidByModel, toolCalls, type InProcessHost } from '../test/contract/support/boot-inprocess.ts';
import { repoRoot } from '../test/contract/support/dsh-home.ts';
import { localHome } from '../test/contract/support/fabric.ts';
import { cell } from '../test/contract/support/markdown.ts';
import { scanForSecret } from '../test/contract/support/moments.ts';
import { authoredPackFolder, authoredPackId, changedBetween, committedRecord, digestTrees, sectionsOf } from '../test/contract/support/pipeline.ts';
import { himaCommand } from '../test/contract/support/command.ts';
import { packsDirOf } from '../test/contract/support/pack.ts';
import { HIMA_FABRIC_SECTIONS, HIMA_INTENT_SECTIONS, HIMA_SPEC_SECTIONS, HIMA_TEST_SECTIONS, loadPack, packDigestOf, packStage, packVersionFile, pipelineFiles, runIdPattern } from '@hima/harness';
import { parse } from 'yaml';

/** The environment variable dsh's own DeepSeek adapter reads a key from; this script reads the same one. */
const KEY_VARIABLE = 'DEEPSEEK_API_KEY';

/** What the author says to the grill stage: a business in plain language, and where the flow lies. */
const businessStatement = (flowRoot: string): string => [
  '/hima-grill I want a pack that finds the tightest clock period this flow will close at.',
  'I run the flow by hand today and I read the setup slack out of its verification report.',
  `The Golden Flow is at ${flowRoot}; its Makefile takes the period as a command-line variable.`,
].join(' ');

/** What the author says to the spec stage. A person types the name and nothing else. */
const SPEC_INVOCATION = '/hima-spec';

/** The Goal this author states for the test Run, and the only place the stage may get one from.
 *
 *  The test stage's body forbids it a number of its own: a Goal value comes from the author's message
 *  or from the spec's `Goal template` recommending one, and where neither states one the stage asks
 *  and starts nothing. The spec a real model writes at the stage before this one recommends no
 *  target — the first live run of this check proved it, by going off to look for a number and
 *  spending a Site's licensed time on the one it picked — so this message states it, which is what an
 *  author does. 2.0 ns is below the period the stand-in actually closes at, so the Campaign converges
 *  rather than meeting its goal, which is the ending the checks below expect.
 */
const TEST_GOAL = { target_period_ns: 2.0 } as const;

/** What the author says to the three stages #64 built. Each names the pack folder it is standing in,
 *  the two that need a Site name the one this home wrote, and the one that spends that Site's time
 *  states what it is to ask for. */
const FABRIC_INVOCATION = `/hima-fabric ${authoredPackId} on site local`;
const TEST_INVOCATION = `/hima-test ${authoredPackId} on site local; the goal is target_period_ns=2.0`;
const RELEASE_INVOCATION = `/hima-release ${authoredPackId}`;

/** What this script answers the fabric stage's review of a script it wrote. The stage puts every
 *  script it wrote to the author one at a time, and an unanswered question would leave the stage
 *  waiting rather than finishing — so the review is answered, and the record carries the answer. */
const REVIEW_ANSWER = 'approved — keep it';

/** How many reviews this script will answer before it stops. A stage writes a handful of scripts at
 *  most; a run that asked for a hundred is a stage in a loop, and this check says so rather than
 *  paying for a hundred turns. */
const REVIEW_ROUNDS = 8;

const usage = [
  'usage: DEEPSEEK_API_KEY=… node scripts/live-check-pipeline.ts [--out <dir>]',
  '',
  '  --out   the directory the record is written into. Default docs/validation/ in this repository.',
].join('\n');

// ---------------------------------------------------------------------------------------------
// The refusal, before anything at all is prepared.
// ---------------------------------------------------------------------------------------------

const key = process.env[KEY_VARIABLE];
if (key === undefined || key.trim() === '') {
  process.stderr.write([
    `live-check-pipeline: there is no ${KEY_VARIABLE} in this environment, and this check is one of the two things in HimaHarness that needs one.`,
    '',
    'A DeepSeek key reaches this product through DeepSeek Harness\'s own three doors, and through no door of this harness\'s:',
    `  - the launching environment: ${KEY_VARIABLE} exported in the shell that starts the harness, which is what this check wants;`,
    '  - dsh\'s own credentials store, $DSH_HOME/.credentials.yaml, which the window\'s Models page writes and nothing here does;',
    '  - an env file dsh loads, $DSH_HOME/.env or the invoking directory\'s.',
    '',
    'HimaHarness writes none of those files, reads a key by no other path, and puts no key in any record it writes.',
    'Nothing was prepared and nothing was booted. Export a key and run this again:',
    `  ${KEY_VARIABLE}=… node scripts/live-check-pipeline.ts`,
    '',
  ].join('\n'));
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(`${usage}\n`); process.exit(0); }
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
};
for (const given of argv) {
  if (given.startsWith('--') && given !== '--out') { process.stderr.write(`live-check-pipeline: unknown option ${given}\n${usage}\n`); process.exit(2); }
}
const outDir = path.resolve(option('--out') ?? path.join(repoRoot, 'docs/validation'));

const startedAt = new Date();
const stamp = startedAt.toISOString().slice(0, 10);
const base = `${stamp}-live-check-pipeline`;
const jsonAt = path.join(outDir, `${base}.json`);
const markdownAt = path.join(outDir, `${base}.md`);

// Beside the key check and not beside the write, because of what this script spends: by the time a
// record could be written, two real turns have been paid for with the owner's key, and a refusal at
// that point would throw them away rather than prevent them.
if (existsSync(jsonAt) || existsSync(markdownAt)) {
  process.stderr.write(`live-check-pipeline: ${base}.{md,json} already exists in ${outDir}; move the earlier record aside first\n`);
  process.exit(2);
}

// ---------------------------------------------------------------------------------------------
// The record.
// ---------------------------------------------------------------------------------------------

/** One claim this run makes, with the predicate it was judged by and what was actually seen. */
interface Check {
  readonly claim: string;
  readonly predicate: string;
  readonly saw: string;
  readonly passed: boolean;
}

const checks: Check[] = [];
const check = (claim: string, predicate: string, saw: string, passed: boolean): boolean => {
  checks.push({ claim, predicate, saw, passed });
  return passed;
};

/** The key's shape, which is what a record may carry: never the key. */
const keyShape = `${String(key.length)} characters, beginning "${key.slice(0, 4)}"`;

/** A skip is not available to a script: what a contract test skips on, this reports as a refusal. */
const noSkip = {
  skip: (reason?: string) => {
    throw new Error(`this check needs what a contract test needs, and this machine has not got it: ${reason ?? 'no reason given'}`);
  },
} as unknown as TestContext;

interface Observed {
  flowRoot?: string;
  packFolder?: string;
  grillSaid?: string[];
  grillTools?: string[];
  specSaid?: string[];
  specTools?: string[];
  specSections?: string[];
  /** Every change under the pack folder the spec stage made; one new `SPEC.md` and nothing else. */
  packFolderDelta?: string[];
  stage?: string;
  fabricSaid?: string[];
  fabricTools?: string[];
  fabricSections?: string[];
  /** Every file the fabric stage left in the pack folder, which is the pack it compiled. */
  fabricWrote?: string[];
  reviewsAnswered?: number;
  packCheck?: string;
  testSaid?: string[];
  testTools?: string[];
  testSections?: string[];
  /** The Run the test record names, and what the ledger says it was. */
  testRun?: { id: string | null; purpose: string | null; status: string | null; goal: unknown; digestMatches: boolean };
  releaseSaid?: string[];
  releaseTools?: string[];
  /** The seal, as the release wrote it: never the hashes themselves, which are a hundred lines. */
  version?: { pack: string; version: string; run: string; files: number } | null;
  stages?: Record<string, string>;
  changed?: string[];
  /** Every change under the Golden Flow and the other installed packs across the whole run. */
  changedByEveryStage?: string[];
  scanned?: number;
  holding?: readonly string[];
  unreadable?: readonly string[];
}
const observed: Observed = {};
let refusal: string | undefined;

/**
 * How many separate numbered questions a stage's answer holds.
 *
 * The emphasis marks are in the pattern because a real model writes them: the first live grill turn
 * answered with `**1.** …` and this check counted zero, which said the stage had improvised when it
 * had done exactly what its body asks. A list is a number and a stop, however the Markdown around it
 * is dressed.
 */
const numberedQuestions = (said: string): number => [...said.matchAll(/^\s*(?:[*_]{1,2}\s*)?\d+\s*[*_]{0,2}\s*[.)]\s*[*_]{0,2}\s*\S/gm)].length;

async function run(): Promise<void> {
  const home = await localHome(noSkip, { sleepSeconds: 1 });
  if (!home) throw new Error('the local stand-in flow could not be written');
  const h = home.h;
  const packFolder = await authoredPackFolder(h);
  observed.flowRoot = home.flow.root;
  observed.packFolder = packFolder;
  // Everything a stage must not touch: the Golden Flow where it lies, the workspace, and every other
  // pack installed beside the one being authored.
  const outside = [home.flow.root, h.workspace, packsDirOf(h)];
  const before = await digestTrees(outside, packFolder);
  // And the same question for the whole run, over the two trees a *campaign* does not write into:
  // the test stage runs a real Campaign, which prepares a workspace under the home's workspace root,
  // so that tree is the one place this run legitimately writes outside the pack folder.
  const untouchable = [home.flow.root, packsDirOf(h)];
  const untouchableBefore = await digestTrees(untouchable, packFolder);

  let host: InProcessHost | undefined;
  try {
    // **No replay overlay**: this boot composes the product's own DeepSeek adapter, and the key in
    // this process's environment is the only reason a turn can answer at all.
    host = await bootInProcess(h);

    // ---- The grill stage: it must ask, and it must not act. -----------------------------------
    const grilling = await createRootAgent(host.ctx, packFolder);
    await sayAsUser(grilling, businessStatement(home.flow.root));
    const grillSaid = saidByModel(grilling);
    observed.grillSaid = grillSaid;
    observed.grillTools = toolCalls(grilling).map((c) => `${c.name} ${String(c.args.file_path ?? '')}`.trim());

    check('the person\'s own message injected the grill skill', 'the session holds a skill-invocation for hima-grill',
      JSON.stringify(injectedSkills(grilling)), injectedSkills(grilling).includes('hima-grill'));
    const answered = grillSaid.join('\n\n');
    check('the grill stage answered at all', 'the model said something', `${String(answered.length)} characters`, answered.trim() !== '');
    check('the grill stage asked rather than improvised', 'the answer holds at least two numbered questions',
      `${String(numberedQuestions(answered))} numbered lines`, numberedQuestions(answered) >= 2);
    // The pack folder itself, with nothing excluded: `${packFolder}.none` is a sibling path, so it
    // is neither the folder nor under it, and every file the stage wrote counts.
    const wroteNothing = await digestTrees([packFolder], `${packFolder}.none`);
    check('the grill stage wrote no record before the author had answered', 'the pack folder is still empty',
      JSON.stringify([...wroteNothing.keys()]), wroteNothing.size === 0);

    // ---- The intent record, from the committed transcript, so the spec stage has one to read. ---
    // Written here rather than by a second grill turn: what this check is for is the *spec* stage's
    // own behaviour, and a record improvised by a second real turn would make every assertion below
    // depend on what that turn happened to say.
    const record = await committedRecord('grill', pipelineFiles.intent, home.flow.root);
    await mkdir(packFolder, { recursive: true });
    await writeFile(path.join(packFolder, pipelineFiles.intent), record);
    // The pack folder as it stands the instant before the spec stage runs. `${packFolder}.none` is a
    // sibling path, so it is neither the folder nor under it and nothing is excluded: every file in
    // the folder is in this digest, and the only acceptable delta afterwards is one new `SPEC.md`.
    // A check that asked only "is SPEC.md there" would pass a stage that also wrote four scratch
    // files, a `notes.md` and a copy of the flow beside it.
    const packFolderBefore = await digestTrees([packFolder], `${packFolder}.none`);

    // ---- The spec stage: one file, nine sections, nothing else. --------------------------------
    const specifying = await createRootAgent(host.ctx, packFolder);
    await sayAsUser(specifying, SPEC_INVOCATION);
    observed.specSaid = saidByModel(specifying);
    observed.specTools = toolCalls(specifying).map((c) => `${c.name} ${String(c.args.file_path ?? '')}`.trim());

    check('the person\'s own message injected the spec skill', 'the session holds a skill-invocation for hima-spec',
      JSON.stringify(injectedSkills(specifying)), injectedSkills(specifying).includes('hima-spec'));

    const specAt = path.join(packFolder, pipelineFiles.spec);
    const wroteSpec = existsSync(specAt);
    check('the spec stage wrote the pack spec', `${pipelineFiles.spec} is in the pack folder`, specAt, wroteSpec);
    if (wroteSpec) {
      const sections = sectionsOf(await readFile(specAt, 'utf8'));
      observed.specSections = sections;
      // The ordered list, compared whole. "Exactly these sections, in this order, and no other
      // heading" is what the body requires and what `packStage` validates, so a check that looked
      // only for missing names would pass a spec the ladder then refuses.
      check('the pack spec holds exactly the nine sections, in order', HIMA_SPEC_SECTIONS.join(', '),
        JSON.stringify(sections), JSON.stringify(sections) === JSON.stringify([...HIMA_SPEC_SECTIONS]));
    }

    // What the spec stage left in the pack folder, against what was in it a moment before.
    const packFolderDelta = changedBetween(packFolderBefore, await digestTrees([packFolder], `${packFolder}.none`));
    observed.packFolderDelta = packFolderDelta;
    check('the spec stage wrote one file in the pack folder and touched nothing else in it',
      `the only change under the pack folder is a new ${pipelineFiles.spec}`,
      JSON.stringify(packFolderDelta), packFolderDelta.length === 1 && packFolderDelta[0] === `${specAt} (new)`);

    const stage = packStage(packFolder);
    observed.stage = `${stage.stage}${stage.issue === undefined ? '' : ` (${stage.issue})`}`;
    check('the folder stands at specified', 'packStage says specified', observed.stage, stage.stage === 'specified');

    const changed = changedBetween(before, await digestTrees(outside, packFolder));
    observed.changed = changed;
    check('neither stage wrote outside the pack folder', 'no file under the Golden Flow, the workspace or the other packs changed',
      JSON.stringify(changed), changed.length === 0);
    check('the intent record is exactly the one written into the folder', `${pipelineFiles.intent} is unchanged`,
      `${String((await readFile(path.join(packFolder, pipelineFiles.intent), 'utf8')).length)} characters`,
      (await readFile(path.join(packFolder, pipelineFiles.intent), 'utf8')) === record);
    check('the intent record still holds its five sections', HIMA_INTENT_SECTIONS.join(', '),
      JSON.stringify(sectionsOf(record)), HIMA_INTENT_SECTIONS.every((s) => sectionsOf(record).includes(s)));

    // ---- The fabric stage: compile the spec a model just wrote into a pack that runs. -----------
    // The spec this compiles is the *model's own*, not a committed one: what no keyless run can ask
    // is whether a spec a model wrote is a spec the next stage can compile, and that is the whole
    // reason this stage is here rather than in the contract suite.
    const fabricating = await createRootAgent(host.ctx, packFolder);
    await sayAsUser(fabricating, FABRIC_INVOCATION);
    // The body puts every script it wrote to the author, one at a time. An unanswered question leaves
    // the stage waiting for a person, so this script is the person: it answers while the stage is
    // still asking, and stops when it stops asking or when the rounds run out.
    let reviews = 0;
    for (; reviews < REVIEW_ROUNDS; reviews += 1) {
      const last = saidByModel(fabricating).at(-1) ?? '';
      if (!/Review\s+\S+:/.test(last)) break;
      await sayAsUser(fabricating, REVIEW_ANSWER);
    }
    observed.reviewsAnswered = reviews;
    observed.fabricSaid = saidByModel(fabricating);
    observed.fabricTools = toolCalls(fabricating).map((c) => `${c.name} ${String(c.args.file_path ?? '')}`.trim());
    check('the person\'s own message injected the fabric skill', 'the session holds a skill-invocation for hima-fabric',
      JSON.stringify(injectedSkills(fabricating)), injectedSkills(fabricating).includes('hima-fabric'));
    check('the fabric stage answered the author\'s review rather than waiting for one it never asked for',
      `at most ${String(REVIEW_ROUNDS)} reviews were put to the author`, String(reviews), reviews < REVIEW_ROUNDS);
    // What it wrote, as files: the pack it compiled.
    observed.fabricWrote = [...(await digestTrees([packFolder], `${packFolder}.none`)).keys()].map((at) => path.relative(packFolder, at)).sort();
    // The one question that matters about a compilation: does the thing that runs packs accept it?
    let loaded: string;
    try {
      const pack = loadPack(packsDirOf(h), authoredPackId);
      loaded = `${pack.contract.id}@${pack.contract.version}, ${String(pack.contract.tools.length)} tool(s), ${String(pack.graph.nodes.length)} node(s)`;
      check('the pack the fabric stage wrote loads', 'loadPack accepts the folder', loaded, true);
    } catch (err) {
      check('the pack the fabric stage wrote loads', 'loadPack accepts the folder', (err as Error).message, false);
    }
    const fabricRecordAt = path.join(packFolder, pipelineFiles.fabric);
    const wroteFabricRecord = existsSync(fabricRecordAt);
    check('the fabric stage wrote the fabric record', `${pipelineFiles.fabric} is in the pack folder`, fabricRecordAt, wroteFabricRecord);
    if (wroteFabricRecord) {
      const sections = sectionsOf(await readFile(fabricRecordAt, 'utf8'));
      observed.fabricSections = sections;
      check('the fabric record holds exactly its three sections, in order', HIMA_FABRIC_SECTIONS.join(', '),
        JSON.stringify(sections), JSON.stringify(sections) === JSON.stringify([...HIMA_FABRIC_SECTIONS]));
    }
    const compiled = packStage(packFolder);
    check('the folder stands at compiled', 'packStage says compiled',
      `${compiled.stage}${compiled.issue === undefined ? '' : ` (${compiled.issue})`}`, compiled.stage === 'compiled');
    const fits = await himaCommand(host, h.workspace, `/hima pack check ${authoredPackId} --site local`, 30_000);
    observed.packCheck = fits.text;
    check('the site can host the pack the fabric stage wrote', '/hima pack check answers fit', fits.text.split('\n')[0] ?? '', fits.kind === 'success');

    // ---- The test stage: a real campaign, marked a test run, and the record written from it. ----
    const testing = await createRootAgent(host.ctx, packFolder);
    await sayAsUser(testing, TEST_INVOCATION);
    observed.testSaid = saidByModel(testing);
    observed.testTools = toolCalls(testing).map((c) => `${c.name} ${String(c.args.file_path ?? '')}`.trim());
    check('the person\'s own message injected the test skill', 'the session holds a skill-invocation for hima-test',
      JSON.stringify(injectedSkills(testing)), injectedSkills(testing).includes('hima-test'));
    const testRecordAt = path.join(packFolder, pipelineFiles.test);
    const wroteTestRecord = existsSync(testRecordAt);
    check('the test stage wrote the test record', `${pipelineFiles.test} is in the pack folder`, testRecordAt, wroteTestRecord);
    if (wroteTestRecord) {
      const text = await readFile(testRecordAt, 'utf8');
      const sections = sectionsOf(text);
      observed.testSections = sections;
      check('the test record holds exactly its seven sections, in order', HIMA_TEST_SECTIONS.join(', '),
        JSON.stringify(sections), JSON.stringify(sections) === JSON.stringify([...HIMA_TEST_SECTIONS]));
      const named = new RegExp(`^run: (${runIdPattern.source})$`, 'm').exec(text);
      const row = named === null ? undefined : host.ctx.hima.ledger.run(named[1]!);
      observed.testRun = {
        id: named?.[1] ?? null,
        purpose: row?.purpose ?? null,
        status: row?.status ?? null,
        goal: row?.goal ?? null,
        // The fact the whole test rung rests on: the Run ran the files this folder holds now.
        digestMatches: row?.packDigest !== undefined && row.packDigest === packDigestOf(packFolder),
      };
      check('the test record names a run this ledger holds', 'the `run:` line names a run in the HimaLedger',
        JSON.stringify({ id: observed.testRun.id, held: row !== undefined }), row !== undefined);
      check('the run the test record names was marked a test run', 'its purpose is `test`', String(row?.purpose), row?.purpose === 'test');
      check('the run the test record names ended', 'its status begins `ended-`', String(row?.status), row?.status?.startsWith('ended-') === true);
      check('the run the test record names ran the files this folder now holds', 'its packDigest is the folder\'s digest',
        String(observed.testRun.digestMatches), observed.testRun.digestMatches);
      // The one claim about where the Run's numbers came from. A Goal the stage chose for itself is a
      // Site's licensed time spent on a target nobody set, and the record would then say this pack was
      // tested against something the author never asked for — so what the message stated and what the
      // ledger holds are held to be the same thing, value for value.
      const askedFor = JSON.stringify(observed.testRun.goal);
      check('the run the test record names asked for the Goal the author stated', `its goal is ${JSON.stringify(TEST_GOAL)}, from the message and from nowhere else`,
        askedFor, askedFor === JSON.stringify(TEST_GOAL));
    }
    const tested = packStage(packFolder);
    check('the folder stands at tested', 'packStage says tested',
      `${tested.stage}${tested.issue === undefined ? '' : ` (${tested.issue})`}`, tested.stage === 'tested');

    // ---- The release stage: the seal, written by a verb and never by hand. ----------------------
    const releasing = await createRootAgent(host.ctx, packFolder);
    await sayAsUser(releasing, RELEASE_INVOCATION);
    observed.releaseSaid = saidByModel(releasing);
    observed.releaseTools = toolCalls(releasing).map((c) => `${c.name} ${String(c.args.file_path ?? '')}`.trim());
    check('the person\'s own message injected the release skill', 'the session holds a skill-invocation for hima-release',
      JSON.stringify(injectedSkills(releasing)), injectedSkills(releasing).includes('hima-release'));
    // The one property of this stage worth a check of its own: it wrote nothing itself. A version
    // file a model typed would carry hashes nothing computed, which is the whole of what a release
    // is worth — so a `write` or an `edit` anywhere in that session is a failure whatever the file says.
    const wroteByHand = (observed.releaseTools ?? []).filter((c) => c.startsWith('write') || c.startsWith('edit'));
    check('the release stage wrote nothing by hand', 'no write and no edit in the release session', JSON.stringify(wroteByHand), wroteByHand.length === 0);
    const sealAt = path.join(packFolder, pipelineFiles.version);
    const sealed = existsSync(sealAt);
    check('the release stage sealed the folder', `${pipelineFiles.version} is in the pack folder`, sealAt, sealed);
    if (sealed) {
      const parsed = packVersionFile.safeParse(parse(await readFile(sealAt, 'utf8')));
      observed.version = parsed.success
        ? { pack: parsed.data.pack, version: parsed.data.version, run: parsed.data.test.run, files: Object.keys(parsed.data.files).length }
        : null;
      check('the seal reads as a version file', 'VERSION.yml parses against the schema the check holds it to',
        parsed.success ? JSON.stringify(observed.version) : parsed.error.issues.map((i) => i.message).join('; '), parsed.success);
    }
    const released = packStage(packFolder);
    check('the folder stands at released', 'packStage says released',
      `${released.stage}${released.issue === undefined ? '' : ` (${released.issue})`}`, released.stage === 'released');
    observed.stages = { afterSpec: observed.stage ?? '—', afterFabric: compiled.stage, afterTest: tested.stage, afterRelease: released.stage };

    // And the whole run held to the one tree nothing here may write: the Golden Flow where it lies,
    // and every other pack installed beside this one. The home's workspace is left out on purpose —
    // the test stage ran a real campaign, which prepares a workspace there.
    const changedByEveryStage = changedBetween(untouchableBefore, await digestTrees(untouchable, packFolder));
    observed.changedByEveryStage = changedByEveryStage;
    check('no stage wrote into the Golden Flow or into another pack', 'no file under either changed across the whole run',
      JSON.stringify(changedByEveryStage), changedByEveryStage.length === 0);
  } finally {
    if (host) await host.dispose();
  }

  // Everything is flushed once the host is gone; only then is the home read.
  const scan = await scanForSecret([h.home, h.workspace], key!);
  observed.scanned = scan.files.length;
  observed.holding = scan.holding;
  observed.unreadable = scan.unreadable.map((file) => `${file.path} (${file.error})`);
  // What proves the scan looked where the run wrote is not a count — an in-process host leaves a few
  // dozen files behind, a driven window a hundred — but that the two records in the pack folder are
  // among the files read: `INTENT.md`, which this script seeded so that the spec stage had one to
  // read, and `SPEC.md`, which the model wrote with its own `write` tool. The second is the one
  // place a key could have been copied into by the model's own hand; the first is where this script
  // put the words the model was working from, and both lie where the stages worked.
  const records = Object.values(pipelineFiles).map((name) => path.join(packFolder, name)).filter((at) => existsSync(at));
  const recordsRead = records.filter((at) => scan.files.some((file) => file.path === at));
  check('the scan read the home rather than nothing', 'every record the pipeline left in the pack folder is among the files read',
    `${String(scan.files.length)} files, records read: ${JSON.stringify(recordsRead)}`,
    scan.files.length > 0 && records.length >= 2 && recordsRead.length === records.length);
  // Asked before the claim it qualifies: a regular file the scan could not open is a hole in "no
  // file holds the key" exactly the size of that file, and this run may not report PASS over one.
  check('the scan read every file it found', 'no file under the home was unreadable', JSON.stringify(observed.unreadable), scan.unreadable.length === 0);
  check('the key reached no file the run wrote', 'no file under the home holds the key', JSON.stringify(scan.holding), scan.holding.length === 0);
  const envFiles = scan.credentialFiles.filter((at) => path.basename(at) === '.env');
  check('the harness wrote no env file', 'no .env exists under the home', JSON.stringify(envFiles), envFiles.length === 0);

  await h.dispose();
}

function markdown(): string {
  const failed = checks.filter((c) => !c.passed);
  const lines = [
    `# Live check: the pack authoring pipeline, ${stamp}`,
    '',
    `Five real stages through the product, with a key from the launching environment (${keyShape}).`,
    `HimaHarness on DeepSeek Harness 0.1.5-alpha.1 (Node ${process.version}), on the booted host with **no replay overlay**: the host composed its own DeepSeek adapter.`,
    '',
    `**${failed.length === 0 && refusal === undefined ? 'PASS' : 'FAIL'}** — ${String(checks.filter((c) => c.passed).length)} of ${String(checks.length)} checks passed.`,
    ...(refusal === undefined ? [] : ['', `The run did not finish: ${refusal}`]),
    '',
    '## What ran',
    '',
    `- Golden Flow at \`${observed.flowRoot ?? '—'}\`, read where it lies.`,
    `- Pack folder \`${observed.packFolder ?? '—'}\` (\`${authoredPackId}\`), the session's own working directory.`,
    `- Tools the grill stage called: ${JSON.stringify(observed.grillTools ?? [])}.`,
    `- Tools the spec stage called: ${JSON.stringify(observed.specTools ?? [])}.`,
    `- Tools the fabric stage called: ${JSON.stringify(observed.fabricTools ?? [])}, with ${String(observed.reviewsAnswered ?? 0)} review(s) answered \`${REVIEW_ANSWER}\`.`,
    `- Tools the test stage called: ${JSON.stringify(observed.testTools ?? [])}.`,
    `- Tools the release stage called: ${JSON.stringify(observed.releaseTools ?? [])}.`,
    `- The folder's stage after the spec stage: \`${observed.stage ?? '—'}\`; the whole ladder: ${JSON.stringify(observed.stages ?? {})}.`,
    `- Files changed outside the pack folder by the first two stages: ${JSON.stringify(observed.changed ?? [])}.`,
    `- Files changed under the Golden Flow or another pack, across the whole run: ${JSON.stringify(observed.changedByEveryStage ?? [])}.`,
    '',
    '## The pack the fabric stage compiled',
    '',
    '```json',
    JSON.stringify(observed.fabricWrote ?? [], null, 2),
    '```',
    '',
    '```',
    observed.packCheck ?? '—',
    '```',
    '',
    '## The run the test record names',
    '',
    '```json',
    JSON.stringify(observed.testRun ?? null, null, 2),
    '```',
    '',
    '## The seal the release stage asked for',
    '',
    '```json',
    JSON.stringify(observed.version ?? null, null, 2),
    '```',
    '',
    '## What the grill stage said',
    '',
    '```',
    (observed.grillSaid ?? []).join('\n\n'),
    '```',
    '',
    '## What the spec stage said',
    '',
    '```',
    (observed.specSaid ?? []).join('\n\n'),
    '```',
    '',
    '## What the fabric stage said',
    '',
    '```',
    (observed.fabricSaid ?? []).join('\n\n'),
    '```',
    '',
    '## What the test stage said',
    '',
    '```',
    (observed.testSaid ?? []).join('\n\n'),
    '```',
    '',
    '## What the release stage said',
    '',
    '```',
    (observed.releaseSaid ?? []).join('\n\n'),
    '```',
    '',
    '## The sections each stage wrote',
    '',
    '```json',
    JSON.stringify({
      [pipelineFiles.spec]: observed.specSections ?? [],
      [pipelineFiles.fabric]: observed.fabricSections ?? [],
      [pipelineFiles.test]: observed.testSections ?? [],
    }, null, 2),
    '```',
    '',
    '## The home, read afterwards',
    '',
    `- ${String(observed.scanned ?? 0)} files read under \`$DSH_HOME\` and the workspace.`,
    `- Files that could not be read: ${JSON.stringify(observed.unreadable ?? [])}.`,
    `- Files holding the key: ${JSON.stringify(observed.holding ?? [])}.`,
    '',
    'The key came from the launching environment. HimaHarness writes no credentials file and no env file, reads a key by no path of its own, and no record above carries one.',
    '',
    '## Checks',
    '',
    '| Claim | Predicate | Saw | |',
    '|---|---|---|---|',
    ...checks.map((c) => `| ${c.claim} | ${cell(c.predicate)} | ${cell(c.saw)} | ${c.passed ? 'PASS' : '**FAIL**'} |`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

try {
  await run();
} catch (err) {
  refusal = err instanceof Error ? err.message : String(err);
  check('the check ran to its end', 'no refusal on the way', refusal, false);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(jsonAt, `${JSON.stringify({
  check: 'live-check-pipeline',
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  node: process.version,
  keyShape,
  flowRoot: observed.flowRoot ?? null,
  packFolder: observed.packFolder ?? null,
  grill: { said: observed.grillSaid ?? [], tools: observed.grillTools ?? [] },
  spec: { said: observed.specSaid ?? [], tools: observed.specTools ?? [], sections: observed.specSections ?? [] },
  fabric: {
    said: observed.fabricSaid ?? [],
    tools: observed.fabricTools ?? [],
    sections: observed.fabricSections ?? [],
    wrote: observed.fabricWrote ?? [],
    reviewsAnswered: observed.reviewsAnswered ?? 0,
    packCheck: observed.packCheck ?? null,
  },
  test: { said: observed.testSaid ?? [], tools: observed.testTools ?? [], sections: observed.testSections ?? [], run: observed.testRun ?? null },
  release: { said: observed.releaseSaid ?? [], tools: observed.releaseTools ?? [], version: observed.version ?? null },
  stage: observed.stage ?? null,
  stages: observed.stages ?? null,
  changedOutsideThePackFolder: observed.changed ?? [],
  changedUnderTheFlowOrAnotherPack: observed.changedByEveryStage ?? [],
  home: { filesRead: observed.scanned ?? 0, unreadable: observed.unreadable ?? [], holdingTheKey: observed.holding ?? [] },
  refusal: refusal ?? null,
  checks,
  passed: refusal === undefined && checks.every((c) => c.passed),
}, null, 2)}\n`);
writeFileSync(markdownAt, markdown());
process.stdout.write(`${markdown()}\nrecord: ${jsonAt}\n`);
process.exit(refusal === undefined && checks.every((c) => c.passed) ? 0 : 1);
