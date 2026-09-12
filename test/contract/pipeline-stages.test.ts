// @hima-seam skills direct
// Ticket #64: the pack authoring pipeline's last three stages — fabric compiles the spec, test runs
// the compiled pack and writes the record from what the Run recorded, release seals the folder with
// hashes the harness computed.
//
// **The seam.** These run through `bootInProcess` + `sayAsUser`, as `skills.test.ts` does and for the
// same reason: a stage is a *person's own message* to the root agent, and the one composer a person
// types into is the web app's, which the driver has no control for (ADR-0004 marks Hima's own
// controls and nothing else). So what a person's message does to a session is asked of the host, and
// the one place any test makes such a message is `sayAsUser`. One session per boot, because replay's
// cursor does not go back to the start.
//
// The window is still the seam for the one thing that *is* a person clicking: the start form's marks
// and the Run a click of it starts. That half boots the shell in driver mode on the very home the
// stages authored in.
//
// **What each test is about.**
//
// *Fabric compiles, and refuses a contradiction.* From a folder the committed grill and spec
// transcripts left at `specified`, the fabric stage reads every source its body names an authority
// for a shape — the spec, the record it points back at, the Golden Flow, the six knowledge files,
// the skeleton of every file kind a pack folder holds, and the pack installed beside this one —
// writes the pack's own files, puts the script it wrote to the author, and records their verdict in
// their words. Nothing the spec asked for is missing, so the gap list says `none`. A spec whose judge
// rule reads a value its own Semantics does not declare is refused naming the section and quoting the
// line, and nothing at all is written.
//
// *Test writes the record, and the record is evidence.* The stage starts a Campaign marked a test
// run, reads the Run back and writes `TEST.md` from it. The run row carries the digest of the folder
// it ran, so editing a script afterwards puts the folder back at `compiled` until the stage runs
// again — which is what "re-entering a stage after a change retests" means.
//
// *Release seals, and a change is refused.* `VERSION.yml` covers every file with the hash this
// harness computed; editing one, or adding one, makes the check name that file and makes a Campaign
// refuse the pack before anything is sent to a Site.
//
// Nothing here needs an API key and nothing here may have one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { bootInProcess, createRootAgent, saidByModel, sayAsUser, toolCalls, toolResults, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { localHome } from './support/fabric.ts';
import { bootDriver, fillForm, type BootedDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { packsDirOf, timingProbePackId, writePackFiles, writePackVariant } from './support/pack.ts';
import { authoredPackFolder, authoredPackId, changedBetween, committedRecord, digestTrees, GRILL_ANSWERS, GRILL_RESOLUTION, replayStage, replayStages, sectionsOf } from './support/pipeline.ts';
import {
  HIMA_FABRIC_SECTIONS,
  HIMA_INTENT_SECTIONS,
  HIMA_KNOWLEDGE_FILES,
  HIMA_PACK_ANATOMY_FILE,
  HIMA_SPEC_SECTIONS,
  HIMA_TEST_SECTIONS,
  himaSkillsDir,
  loadPack,
  packDigestOf,
  packStageOf,
  packVersionFile,
  pipelineFiles,
  runIdPattern,
  type RunView,
} from '@hima/harness';
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

/** That Run over the route, with the session the shell established. */
async function runOverTheRoute(d: BootedDriver, runId: string): Promise<RunView> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return JSON.parse(text) as RunView;
}

/** The newest Run the ledger holds, read off the page's own run list — which is where a person reads
 *  it, and which is newest first. `theOneRunId` cannot answer here: this home already holds the Run
 *  that tested the pack, which is what made it releasable in the first place. */
async function newestRunId(d: BootedDriver): Promise<string> {
  const listed = await d.open('/hima/');
  assert.ok(listed.ok, JSON.stringify(listed));
  const runs = await d.read('runs');
  assert.ok(runs.ok, JSON.stringify(runs));
  const found = new RegExp(runIdPattern.source).exec(runs.text);
  assert.ok(found, `the run list names a Run: ${runs.text}`);
  return found[0];
}

/** The start form filled for the authored pack, in the order a person moves down it. */
const authoredForm = {
  'start-pack': authoredPackId,
  'start-site': 'local',
  'start-target': '2.3',
  'start-knob-periodNs': '2.2',
  'start-time-box': '5',
  'start-retries': '2',
  'start-generations': '1',
} as const;

/**
 * A released `authored-probe` in this home, built without the model: the shipped pack under that id,
 * the pipeline's three records, one real Run marked a test, the record that names it, and the seal.
 *
 * The stages themselves are the tests above; what this test is about is the *form*, so the folder is
 * brought to `released` the shortest honest way — the Run is a real Campaign on the stand-in and the
 * seal is written by the real verb, because a test record the ledger cannot vouch for would not let
 * the release happen at all.
 *
 * @returns the run id of the test Run, so the caller can end the session it launched.
 */
async function releasedFolder(h: _Home, flowRoot: string): Promise<{ runId: string; sessions: string[] }> {
  const packsDir = packsDirOf(h);
  await writePackVariant(packsDir, authoredPackId, [], []);
  const dir = path.join(packsDir, authoredPackId);
  await writePackFiles(dir, {
    'INTENT.md': await committedRecord('grill', pipelineFiles.intent, flowRoot),
    'SPEC.md': await committedRecord('spec', pipelineFiles.spec, flowRoot),
    'FABRIC.md': '## Files written\n\nthe pack this folder holds\n\n## Gaps\n\nnone\n\n## Reviews\n\nnone\n',
  });
  return withHost(h, async (host) => {
    const ran = await himaCommand(host, h.workspace, `/hima run ${authoredPackId} --site local --goal target_period_ns=2.3 --set periodNs=2.2 --test --generations 1`, 60_000);
    assert.equal(ran.kind, 'success', ran.text);
    const runId = ran.runId;
    assert.ok(runId, `the test Run was started and named: ${ran.text}`);
    // The record the test stage would have written, as far as the harness reads it: the Run, the
    // status that Run ended with, and the two sections whose emptiness this Run's own records bear
    // out. Written by hand here because this test is about the *form* and not about the stage, and
    // a record whose three bound lines did not hold would not let the release happen at all.
    const row = host.ctx.hima.ledger.run(runId)!;
    const bound: Readonly<Record<string, string>> = {
      Run: `run: ${runId}`,
      Ending: `status: ${String(row.status)}`,
      Code: 'none',
      Refusals: 'none',
    };
    await writeFile(path.join(dir, pipelineFiles.test), HIMA_TEST_SECTIONS
      .map((section) => `## ${section}\n\n${bound[section] ?? 'what this run recorded'}\n`).join('\n'));
    const sealed = await himaCommand(host, h.workspace, `/hima pack release ${authoredPackId}`, 20_000);
    assert.equal(sealed.kind, 'success', sealed.text);
    assert.match(sealed.text, new RegExp(`^released pack ${authoredPackId}@1 at `), sealed.text);
    return { runId, sessions: sessionsIn(host) };
  });
}

test('through the window on a home the pipeline authored in: the start form offers a released pack plain and a pack still being authored marked, and a run started from the form is a campaign of the first and a test run of the second', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  const started: string[] = [];
  try {
    const built = await releasedFolder(h, home.flow.root);
    started.push(...built.sessions);

    // ------------------------------------------------------------------------------------------
    // Released: offered plain, and a Run of it is an ordinary Campaign.
    // ------------------------------------------------------------------------------------------
    const released = await bootDriver(t, { existing: h });
    if (!released) return;
    try {
      const opened = await released.open('/hima/');
      assert.ok(opened.ok, JSON.stringify(opened));
      const form = await released.read('start');
      assert.ok(form.ok, `the workbench page carries the start form: ${JSON.stringify(form)}`);
      assert.equal(form.state.packs, '2', `both folders installed here are on offer: ${JSON.stringify(form)}`);
      assert.ok(form.text.includes(authoredPackId), `the released pack is on the form: ${form.text}`);
      assert.ok(!form.text.includes('test pack'), `and nothing on it is marked a pack somebody is still authoring: ${form.text}`);

      await fillForm(released, authoredForm);
      const clicked = await released.click('start');
      assert.ok(clicked.ok, JSON.stringify(clicked));
      const status = await released.wait('run-status', 'ended', 120_000);
      assert.ok(status.ok, JSON.stringify(status));
      const view = await runOverTheRoute(released, await newestRunId(released));
      assert.equal(view.run.packId, authoredPackId, 'the pack the form named');
      assert.equal(view.run.purpose, 'campaign', 'a Run of a released pack is an ordinary Campaign, and the card says nothing about a test');
      assert.ok(!status.text.includes('test run'), `and the card carries no mark: ${status.text}`);
    } finally {
      await released.dispose();
    }

    // ------------------------------------------------------------------------------------------
    // The same folder with its seal taken off: a pack in the pipeline and unreleased, marked on the
    // form and marked on its Run.
    // ------------------------------------------------------------------------------------------
    await rm(path.join(packsDirOf(h), authoredPackId, pipelineFiles.version));
    const unreleased = await bootDriver(t, { existing: h });
    if (!unreleased) return;
    try {
      const opened = await unreleased.open('/hima/');
      assert.ok(opened.ok, JSON.stringify(opened));
      const form = await unreleased.read('start');
      assert.ok(form.ok, JSON.stringify(form));
      assert.ok(form.text.includes(`${authoredPackId} — test pack (tested)`),
        `the form marks a pack the pipeline is still carrying its author through, and says which rung it is on: ${form.text}`);

      await fillForm(unreleased, authoredForm);
      const clicked = await unreleased.click('start');
      assert.ok(clicked.ok, JSON.stringify(clicked));
      const status = await unreleased.wait('run-status', 'ended', 120_000);
      assert.ok(status.ok, JSON.stringify(status));
      assert.ok(status.text.includes('test run'), `and the card marks the Run it started: ${status.text}`);
      const view = await runOverTheRoute(unreleased, await newestRunId(unreleased));
      const listed = await unreleased.read('runs');
      assert.ok(listed.ok, JSON.stringify(listed));
      assert.equal(view.run.purpose, 'test', 'a Run of a pack still being authored is a test run, whether or not anybody said so');
      assert.ok(listed.text.includes('test run'), `and the run list marks it too: ${listed.text}`);
    } finally {
      await unreleased.dispose();
    }
  } finally {
    if (started.length > 0) {
      const { killSessions } = await import('./support/fabric.ts');
      killSessions(started);
    }
    await h.dispose();
  }
});

/** The start form filled for the shipped probe, which is the readable pack in the test below. */
const probeForm = {
  'start-pack': timingProbePackId,
  'start-site': 'local',
  'start-target': '2.3',
  'start-knob-periodNs': '2.2',
  'start-time-box': '5',
  'start-retries': '2',
  'start-generations': '1',
} as const;

test('through the window on a home holding one folder nothing can read: the form offers both packs, marks the unreadable one with the path that refused it, will not let it be chosen, and the readable one still starts', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  try {
    const packsDir = packsDirOf(h);
    // A second installed folder, the shipped probe again but for one thing: a link out of the pack
    // under a hidden name. The one reading of a pack folder refuses that folder whole, naming the
    // path (#64), so **nothing** about it can be answered — its rung least of all. What this test is
    // about is that one such folder is one bad option and not a start form nobody can use: the
    // page's own list is built by asking every installed folder its stage, and a question that
    // raised took the whole page down with it.
    const badId = 'unreadable-probe';
    await writePackVariant(packsDir, badId, []);
    const link = path.join(packsDir, badId, '.state');
    await symlink(h.workspace, link);

    const driver = await bootDriver(t, { existing: h });
    if (!driver) return;
    try {
      const opened = await driver.open('/hima/');
      assert.ok(opened.ok, JSON.stringify(opened));
      const form = await driver.read('start');
      assert.ok(form.ok, `the page is still a page, and it still carries the start form: ${JSON.stringify(form)}`);
      assert.equal(form.state.packs, '2', `both installed folders are on offer: ${JSON.stringify(form)}`);
      assert.ok(form.text.includes(`${badId} — unreadable: `),
        `the folder nothing can read is offered marked, and marked with why: ${form.text}`);
      assert.ok(form.text.includes(link), `and the mark names the path that refused it: ${form.text}`);
      assert.ok(!form.text.includes(`${timingProbePackId} — `),
        `while the folder that reads is offered plain: ${form.text}`);

      // "Cannot be started" is the option itself, as a person's browser receives it: a disabled
      // `<option>` is one nobody can choose. Read off the page the route serves, with the shell's own
      // session, because that is the page.
      const host = await driver.host();
      assert.ok(host.ok, JSON.stringify(host));
      const cookie = await driver.cookie();
      const page = await (await api(host, cookie, '/hima/')).text();
      assert.match(page, new RegExp(`<option value="${badId}" disabled>`), `the unreadable pack's option cannot be chosen: ${page}`);
      assert.doesNotMatch(page, new RegExp(`<option value="${timingProbePackId}"[^>]*disabled`), `and the readable one can: ${page}`);

      // And the route the form submits to refuses it in the same words the check and `/hima run` use,
      // so a request made any other way is refused too rather than starting a Campaign of a folder
      // nobody can read.
      const refused = await api(host, cookie, '/hima/api/runs', {
        method: 'POST',
        body: JSON.stringify({ pack: badId, site: 'local', goal: { target_period_ns: 2.3 } }),
        headers: { 'content-type': 'application/json' },
      });
      const said = await refused.text();
      assert.ok(refused.status >= 400, `starting the unreadable folder is refused: ${String(refused.status)} ${said}`);
      assert.ok(said.includes(link), `naming the path that refused the folder: ${said}`);

      // The readable pack is unaffected: a Campaign of it starts from the form and ends.
      await fillForm(driver, probeForm);
      const clicked = await driver.click('start');
      assert.ok(clicked.ok, JSON.stringify(clicked));
      const status = await driver.wait('run-status', 'ended', 120_000);
      assert.ok(status.ok, JSON.stringify(status));
      const view = await runOverTheRoute(driver, await newestRunId(driver));
      assert.equal(view.run.packId, timingProbePackId, 'the pack the form named is the one that ran');
    } finally {
      await driver.dispose();
    }
  } finally {
    await h.dispose();
  }
});

test('through the window on a home where every installed folder is unreadable: the form still offers the one there is, marked and unchoosable, and the start control starts nothing', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  try {
    // The home the fabric tests make installs the shipped probe and nothing else, so making *that*
    // folder unreadable is the whole inventory unreadable — which is the case the test above cannot
    // reach, because it always has a good pack beside the bad one. The arrangement is the same one:
    // a link out of the pack under a hidden name, which the one reading of a pack folder refuses
    // whole, naming the path (#64).
    const link = path.join(packsDirOf(h), timingProbePackId, '.state');
    await symlink(h.workspace, link);

    const driver = await bootDriver(t, { existing: h });
    if (!driver) return;
    try {
      const opened = await driver.open('/hima/');
      assert.ok(opened.ok, JSON.stringify(opened));
      const form = await driver.read('start');
      assert.ok(form.ok, `the page is still a page, and it still carries the start form: ${JSON.stringify(form)}`);
      assert.equal(form.state.packs, '1', `the one installed folder is still on offer: ${JSON.stringify(form)}`);
      assert.ok(form.text.includes(`${timingProbePackId} — unreadable: `),
        `and it is offered marked, and marked with why, with no readable pack anywhere to compose the marks for: ${form.text}`);
      assert.ok(form.text.includes(link), `and the mark names the path that refused it: ${form.text}`);

      const host = await driver.host();
      assert.ok(host.ok, JSON.stringify(host));
      const cookie = await driver.cookie();
      const page = await (await api(host, cookie, '/hima/')).text();
      assert.match(page, new RegExp(`<option value="${timingProbePackId}" disabled>`),
        `the only option cannot be chosen: ${page}`);
      assert.doesNotMatch(page, /<option[^>]* selected>/, `and nothing is selected by default, because nothing here can be started: ${page}`);

      // What a person can actually do with that form: fill everything under the pack and press the
      // one button. No Campaign is started, and the page says why rather than sitting there.
      await fillForm(driver, {
        'start-site': 'local',
        'start-target': '2.3',
        'start-time-box': '5',
        'start-retries': '2',
        'start-generations': '1',
      });
      const clicked = await driver.click('start');
      assert.ok(clicked.ok, JSON.stringify(clicked));
      const refused = await driver.wait('start-error', 'pack', 30_000);
      assert.ok(refused.ok, `the start was refused in words on the form: ${JSON.stringify(refused)}`);
      const runs = await driver.read('runs');
      assert.ok(runs.ok, JSON.stringify(runs));
      assert.equal(runs.state.count, '0', `and nothing was started: ${JSON.stringify(runs)}`);
    } finally {
      await driver.dispose();
    }
  } finally {
    await h.dispose();
  }
});

test('through a booted host with the replay stand-in: the whole pipeline runs grill to release in one recorded session, and the pack it produced then runs from the start form', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const h = home.h;
  const started: string[] = [];
  try {
    const packDir = await authoredPackFolder(h);
    const outside = [home.flow.root, h.workspace, packsDirOf(h)];
    const before = await digestTrees(outside, packDir);

    // One boot, one session, five stages: the per-stage transcripts concatenated into one script,
    // because that is what the pipeline is — a person carried through five stages in one chat, in
    // one folder — and five sessions would be five of something else.
    await replayStages(h, ['grill', 'spec', 'fabric', 'test', 'release']);
    const ran = await runStage(h, packDir, [
      `/hima-grill I want to know the tightest clock period this flow closes at; the flow is at ${home.flow.root}`,
      GRILL_ANSWERS,
      GRILL_RESOLUTION,
      '/hima-spec',
      `/hima-fabric ${authoredPackId} on site local`,
      REVIEW_ANSWER,
      TEST_INVOCATION,
      `/hima-release ${authoredPackId}`,
    ]);
    assert.deepEqual(ran.failures, [], `nothing any stage did was refused: ${JSON.stringify(ran.failures)}`);
    assert.deepEqual(
      ran.calls.filter((c) => c.startsWith('hima_')),
      ['hima_pack_check', 'hima_pack_check', 'hima_run', 'hima_status', 'hima_pack_check', 'hima_pack_check', 'hima_pack_release'],
      `the stages computed nothing themselves: every hash, digest and ledger question went through a verb of the harness's: ${JSON.stringify(ran.calls)}`,
    );

    // Every record the pipeline writes is in the folder, and the folder stands at the top of the
    // ladder — which is the whole claim this test makes.
    for (const file of Object.values(pipelineFiles)) {
      assert.ok(existsSync(path.join(packDir, file)), `the pipeline wrote ${file}`);
    }
    const sections = {
      [pipelineFiles.intent]: HIMA_INTENT_SECTIONS,
      [pipelineFiles.spec]: HIMA_SPEC_SECTIONS,
      [pipelineFiles.fabric]: HIMA_FABRIC_SECTIONS,
      [pipelineFiles.test]: HIMA_TEST_SECTIONS,
    };
    for (const [file, declared] of Object.entries(sections)) {
      assert.deepEqual(sectionsOf(await readFile(path.join(packDir, file), 'utf8')), [...declared], `${file} holds exactly its own sections, in order`);
    }
    const checked = await packCheck(h);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^stage: released \([^)]+\); nothing after it: this is the top of the ladder$/m, checked.text);
    assert.match(checked.text, new RegExp(`^pack ${authoredPackId}@1 on site local: fit\\b`), checked.text);

    const { sessions } = await withHost(h, (host) => Promise.resolve({ sessions: sessionsIn(host) }));
    started.push(...sessions);

    // Nothing outside the pack folder was written by any of the five — the Golden Flow least of all,
    // which every stage read where it lies. The Campaign the test stage ran wrote into the home's
    // workspace, so that tree is not in this comparison; the flow and the other installed packs are.
    assert.deepEqual(changedBetween(before, await digestTrees([home.flow.root, packsDirOf(h)], packDir)), [],
      'five stages wrote nothing outside the pack folder, and copied no file of the Golden Flow into it');

    // ------------------------------------------------------------------------------------------
    // And the pack it produced is one a person can start a Campaign of, from the form, by clicking.
    // ------------------------------------------------------------------------------------------
    const d = await bootDriver(t, { existing: h });
    if (!d) return;
    try {
      const opened = await d.open('/hima/');
      assert.ok(opened.ok, JSON.stringify(opened));
      const form = await d.read('start');
      assert.ok(form.ok, JSON.stringify(form));
      assert.ok(form.text.includes(authoredPackId), `the authored pack is on the form: ${form.text}`);
      assert.ok(!form.text.includes('test pack'), `and offered plain, because the pipeline released it: ${form.text}`);

      await fillForm(d, authoredForm);
      const clicked = await d.click('start');
      assert.ok(clicked.ok, JSON.stringify(clicked));
      const status = await d.wait('run-status', 'ended', 120_000);
      assert.ok(status.ok, JSON.stringify(status));
      const view = await runOverTheRoute(d, await newestRunId(d));
      assert.equal(view.run.packId, authoredPackId, 'the Campaign runs the pack the pipeline authored');
      assert.equal(view.run.purpose, 'campaign', 'and it is an ordinary Campaign, because the pack is released');
      assert.ok(view.run.status?.startsWith('ended-'), `and it ended: ${String(view.run.status)}`);
      assert.deepEqual(d.unexpectedStdout(), []);
    } finally {
      await d.dispose();
    }
  } finally {
    if (started.length > 0) {
      const { killSessions } = await import('./support/fabric.ts');
      killSessions(started);
    }
    await h.dispose();
  }
});
