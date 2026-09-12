// Ticket #62: the workshop — the one act node where the AI writes a script and the fabric runs it.
//
// A workshop is the one model moment that enters the fabric. #59 built the moment (one isolated
// session, the pair of `session` records, no shell and no filesystem by construction) and left its
// `tools` parameter for this ticket; #61 built the way a script of the pack's is shipped to a Site,
// launched as a Job under the Permit and read back through a declared reader. Here the two meet: an
// act node declares a workshop, the fabric opens the moment with three tools that go through
// HimaShell, records every write as a `code` record, runs what was written as a Job like any other,
// and the node after it observes the output through the declared reader. The harness learns nothing
// about what is written.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam, with the
// model replaced by dsh's keyless replay adapter over the committed transcripts under
// `test/fixtures/workshop/`. Nothing here needs an API key and nothing here may have one.
//
// The properties, in the order they are asserted below:
//
//  1. **It writes and it runs.** The moment opens with exactly the three tools, the code record's
//     hash is the hash of the file that is really on the Site, the Job ran, and the node after it
//     observed what the script produced.
//  2. **A write outside the directory is refused, recorded and never sent.** Three spellings that
//     leave it — a climb, an absolute path, a climb through a subdirectory — and the flow copy and
//     the report are byte for byte what they were.
//  3. **A code record is one version of one file.** The same path written twice in one moment is two
//     records and one file: the Job runs the later bytes and the card counts one.
//  4. **A verified write the ledger will not record is said where the bytes are** — the tool's
//     answer, the host log and the node the Run blocks at, the bytes left where they landed — so no
//     landed byte goes unrecorded; and the fault is set before the log, so a logger that throws
//     takes neither the answer nor the block with it.
//  5. **A script that fails spends the Retry allowance.** Three attempts, three moments, three Jobs
//     that exit 3, then a Hard blocker carrying the script's own last line; a resume opens a fourth.
//  6. **A host taken away mid-moment reconciles to one chain** — and while that Run waits at the
//     workshop node, the public moment route stands off it.
//  7. **A host taken away mid-Job picks that Job up**, and opens no second moment.
//  8. **A workshop root that resolves anywhere but to itself blocks the node**, records the refusal
//     and opens no moment.
//  9. **A declaration that cannot be run is refused before a Campaign exists**, naming the field.
// 10. **A host taken away in the launch gap settles the same attempt**, and the reading behind that
//     is asserted at the ledger object.
// 11. **A retry's moment is given the attempt before it**: the reason and the log tail.
// 12. The boundary and the seams hold, which is `boundary.test.ts`'s and `check:seams`'s to say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver, fillForm as fillTheForm, runIdOnTheList, theOneRunId, waitForKnobs, type BootedDriver } from './support/driver.ts';
import { bootInProcess, breakHostLogOn, hostLog, readPersistedSession, systemPromptOf, toolResults } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { api } from './support/hima-api.ts';
import { localHome } from './support/fabric.ts';
import { replayMomentScenario, writeMomentScenario } from './support/moments.ts';
import {
  candidateCountType,
  candidateSlackType,
  installPack,
  installWorkshopPack,
  MINED_TOP_N,
  packReaderId,
  packsDirOf,
  workshopDirectory,
  workshopEntry,
  workshopGraph,
  workshopId,
  workshopKnowledgeFile,
  workshopKnowledgeMarker,
  workshopLanguage,
  type WorkshopVariation,
} from './support/pack.ts';
import { attemptOfSession, remoteCommands } from '@hima/harness';
import type { AuditView, CodeRecord, JobRecord, LedgerRecord, NodeRecord, RemoteCommand, RunView, SessionRecord } from '@hima/harness';

/** The three tools a workshop's moment is given, in the order dsh reports them for its scope. */
const WORKSHOP_TOOLS = ['hima_workshop_write', 'hima_workshop_read', 'hima_workshop_knowledge'];

/** What the Job of this workshop is called on the Site. */
const JOB_NAME = `workshop-${workshopId}`;

/** The form this file fills, beside the pack it chooses first and the knob that pack declares. */
const FORM = {
  'start-site': 'local',
  'start-target': '2.0',
  // Stated rather than left to the pack's declared default, as the moment tests state theirs: a
  // Strategy this file does not say is one a later edit of the shipped contract could move under it.
  'start-knob-periodNs': '2.0',
  'start-time-box': '10',
  'start-retries': '3',
  'start-generations': '1',
} as const;

const fillForm = (d: BootedDriver, changes: Readonly<Record<string, string>> = {}): Promise<void> => fillTheForm(d, FORM, changes);

/** The first twelve characters of a hash, which is how much of it a card shows. */
const shortSha = (text: string): string => text.slice(0, 12);

/** Choose the variant on the start form and wait for the page to have re-read its knobs. */
async function choosePack(d: BootedDriver, pack: string): Promise<void> {
  const chose = await d.fill('start-pack', pack);
  assert.ok(chose.ok, `fill start-pack: ${JSON.stringify(chose)}`);
  await waitForKnobs(d, pack);
}

/**
 * Start the Campaign the form is filled for, and see that it really started.
 *
 * A start the host refuses leaves the page where it was with the reason in `start-error`, and a start
 * that took navigates to the card. Waiting on the card alone would spend the whole wait on a refusal
 * and then report the wrong thing, so the two are waited on together.
 */
async function start(d: BootedDriver, pack: string, changes: Readonly<Record<string, string>> = {}): Promise<void> {
  const opened = await d.open('/hima/');
  assert.ok(opened.ok, JSON.stringify(opened));
  await choosePack(d, pack);
  await fillForm(d, changes);
  const clicked = await d.click('start');
  assert.ok(clicked.ok, JSON.stringify(clicked));
  const deadline = Date.now() + 30_000;
  for (;;) {
    const refusal = await d.read('start-error');
    if (!refusal.ok) return;
    if (refusal.text !== '') assert.fail(`the start form refused to start a campaign of ${pack}: ${refusal.text}`);
    assert.ok(Date.now() < deadline, `the start of ${pack} neither took nor said why within 30 s`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** That Run over the route, with the session the shell established. */
async function runOverTheRoute(d: BootedDriver, runId: string): Promise<RunView> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return JSON.parse(text) as RunView;
}

/** Every record of one Run, as the records route answers it. */
async function recordsOfRun(d: BootedDriver, runId: string, type?: string): Promise<readonly LedgerRecord[]> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}/records${type === undefined ? '' : `?type=${type}`}`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return (JSON.parse(text) as { records: LedgerRecord[] }).records;
}

/** Everything the host asked the Site to run, as the audit route answers it — with `windowFilled`,
 *  which is what says whether the rolling window is the whole history or only the end of it. */
async function auditOf(d: BootedDriver): Promise<AuditView> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), '/hima/api/audit');
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return JSON.parse(text) as AuditView;
}

/** The Hima browser module the host serves: the card's second mount (ADR-0004), as a driver gets it. */
async function servedClientModule(d: BootedDriver): Promise<string> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const cookie = await d.cookie();
  const index = await (await api(host, cookie, '/')).text();
  const boot = /globalThis\["__DSH_BOOT__"\] = ([\s\S]*?)<\/script>/.exec(index);
  assert.ok(boot, 'the index carries the client-module boot graph');
  const graph = JSON.parse(boot[1]!) as { entries: { id: string; url: string }[] };
  const hima = graph.entries.find((e) => e.id === '@hima/harness');
  assert.ok(hima, `the Hima module is in the boot graph; it holds ${graph.entries.map((e) => e.id).join(', ')}`);
  return (await api(host, cookie, hima.url)).text();
}

/** Poll until something is true, or fail saying what never happened. */
async function until(what: string, ready: () => boolean | Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (Date.now() >= deadline) throw new Error(`waited ${String(timeoutMs)} ms and ${what} never happened`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Where this Run's Campaign workspace is on the local Site, once it has been prepared: the
 *  `workspace` record's own answer, which is where every path this pack names is joined under. */
async function workspaceOf(d: BootedDriver, runId: string): Promise<string> {
  let found: string | undefined;
  await until('the campaign workspace was prepared', async () => {
    const records = await recordsOfRun(d, runId, 'workspace');
    const prepared = records.find((r) => r.type === 'workspace');
    if (prepared?.type !== 'workspace') return false;
    found = prepared.workspace;
    return true;
  }, 120_000);
  return found!;
}

/** The sha256 of a file as it actually is on the local Site, and how big it is. */
async function onTheSite(at: string): Promise<{ readonly sha256: string; readonly bytes: number }> {
  const bytes = await readFile(at);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: (await stat(at)).size };
}

test('through the shell with the replay stand-in: a workshop node opens a moment with three tools, the model writes a script into its own directory, the fabric runs it as a job, and the node after it observes what it produced', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'writes');
  let d: BootedDriver | undefined;
  try {
    d = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    if (!d) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(d, pack);

    const status = await d.wait('run-status', 'ended', 240_000);
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-goal-not-met', `the graph ran out of edges at its judge node: ${JSON.stringify(status)}`);

    const runId = await theOneRunId(d);
    const view = await runOverTheRoute(d, runId);

    // The pair that brackets the moment, and what dsh itself says that session could reach.
    const sessions = (await recordsOfRun(d, runId, 'session')).filter((r): r is SessionRecord => r.type === 'session');
    assert.equal(sessions.length, 2, `one moment, one pair of records: ${JSON.stringify(sessions.map((r) => r.event))}`);
    const [opened, closed] = sessions as [SessionRecord, SessionRecord];
    assert.equal(opened.event, 'opened');
    assert.deepEqual(opened.tools, WORKSHOP_TOOLS, `the moment reached exactly the workshop's three tools: ${JSON.stringify(opened.tools)}`);
    assert.equal(closed.outcome, 'completed', 'the moment closed having written what it was opened for');
    // What makes this node readable as a workshop off the ledger alone: the `opened` record says which
    // workshop it was opened for and which file of it the fabric runs. No pack folder is opened to
    // compose the view below, which is what lets it survive a pack a person has since edited.
    assert.deepEqual(opened.workshop, { id: workshopId, entry: workshopEntry, entryPath: path.join(await realpath(await workspaceOf(d, runId)), workshopDirectory, workshopEntry) },
      `the opened record carries the workshop it was opened for, and the absolute path of the file that runs: ${JSON.stringify(opened.workshop)}`);
    assert.equal(closed.workshop, undefined, 'and the closed record carries none: it is written where the moment is composed');
    for (const record of sessions) {
      assert.equal(record.nodeId, workshopId, 'the pair names the node the workshop is at');
      assert.equal(record.attempt, 1, 'the first attempt at that node');
    }

    // The code record, held against the file that is really on the Site — at exactly the path the
    // declaration names under the workspace and nowhere that merely ends in it.
    const code = (await recordsOfRun(d, runId, 'code')).filter((r): r is CodeRecord => r.type === 'code');
    assert.equal(code.length, 1, `one file written, one code record: ${JSON.stringify(code)}`);
    const wrote = code[0]!;
    const workspace = await realpath(await workspaceOf(d, runId));
    assert.equal(wrote.path, path.join(workspace, workshopDirectory, workshopEntry),
      `the file is the workshop's entry at the declared directory under the campaign workspace: ${wrote.path}`);
    const real = await onTheSite(wrote.path);
    assert.equal(wrote.sha256, real.sha256, 'the record hashes the bytes that are really on the site');
    assert.equal(wrote.bytes, real.bytes, 'and says how many of them there are');
    assert.equal(wrote.language, workshopLanguage, 'in the word the declaration carries for every file of this workshop');
    assert.equal(wrote.workshop, workshopId, 'named by the workshop it was written in');
    assert.equal(wrote.sessionId, opened.sessionId, 'and by the session that wrote it');
    assert.equal(wrote.attempt, 1);
    assert.equal(wrote.nodeId, workshopId);

    // The Job the fabric ran it as, and what it exited with.
    const jobs = view.jobs.filter((j) => j.job.name === JOB_NAME);
    assert.equal(jobs.length, 2, `one launch and one ending for the workshop's job: ${JSON.stringify(view.jobs.map((j) => `${j.job.name}:${j.event}`))}`);
    assert.equal(jobs[0]!.event, 'launched');
    assert.equal(jobs[1]!.exitCode, 0, `the script the model wrote exited 0: ${JSON.stringify(jobs[1])}`);

    // And what that launch is tied to: the entry it ran, the hash it was verified to have against the
    // code record immediately before it started, and the attempt it belongs to. This is the record a
    // host that never launched the Job numbers its own records from, and the one that says which bytes
    // the wrapper was handed.
    const launched = (await recordsOfRun(d, runId, 'job'))
      .filter((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.job.name === JOB_NAME);
    assert.equal(launched.length, 1, `one launch record: ${JSON.stringify(launched.map((r) => r.event))}`);
    assert.deepEqual(launched[0]!.workshop, { id: workshopId, entry: { path: wrote.path, sha256: real.sha256 } },
      `the launch names the entry the wrapper was given: ${JSON.stringify(launched[0]!.workshop)}`);
    assert.equal(launched[0]!.attempt, 1, 'and the attempt it belongs to');

    // And the reading the node after it took, through the reader the output declares.
    const reading = view.observations.at(-1);
    assert.ok(reading, `the run carries a reading: ${JSON.stringify(view.observations)}`);
    assert.equal(reading.reader.id, packReaderId, 'taken by the reader the produced output declares');
    const count = reading.values.find((v) => v.type === candidateCountType);
    assert.ok(count, `the reading holds the count the script wrote: ${JSON.stringify(reading.values)}`);
    assert.equal(count.value, MINED_TOP_N, 'which is the number the model\'s own script printed');
    assert.ok(reading.values.some((v) => v.type === candidateSlackType), `and everything else that reader emits: ${JSON.stringify(reading.values)}`);

    // The node is done, and the workshop view says so.
    const node = view.nodes.find((n) => n.nodeId === workshopId);
    assert.ok(node, `the path holds the workshop node: ${JSON.stringify(view.nodes.map((n) => n.nodeId))}`);
    assert.equal(node.state, 'done');
    assert.ok(view.workshop, `the run view carries the workshop of the node it stands at: ${JSON.stringify(view.workshop)}`);
    assert.equal(view.workshop.workshop, workshopId);
    assert.equal(view.workshop.entry, workshopEntry);
    assert.equal(view.workshop.files, 1);
    assert.equal(view.code.length, 1, `the run view serves every code record: ${JSON.stringify(view.code)}`);
    assert.equal(view.code[0]!.sha256, real.sha256);

    // The audit: the bytes travelled on standard input into the workshop directory, and the launch
    // named the entry the declaration says runs.
    const audit = await auditOf(d);
    const teed = audit.commands.filter((c) => c.argv[0] === 'tee' && c.argv.at(-1)?.endsWith(path.join(workshopDirectory, workshopEntry)) === true);
    assert.equal(teed.length, 1, `one tee into the workshop directory: ${JSON.stringify(audit.commands.map((c) => c.argv.join(' ')))}`);
    assert.ok(
      audit.commands.some((c) => c.wire.includes(workshopEntry) && c.wire.includes('tmux')),
      `and a launch of what was written: ${JSON.stringify(audit.commands.map((c) => c.wire).slice(-6))}`,
    );

    // What a person sees of it on the card. The run list was opened to read the Run's id, so the card
    // is opened again by its own path — which is how a person comes back to a Campaign too.
    const card = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const shown = await d.read('run-workshop');
    assert.ok(shown.ok, `the card shows the workshop: ${JSON.stringify(shown)}`);
    assert.equal(shown.state.state, 'done', `the workshop's own state: ${JSON.stringify(shown.state)}`);
    assert.ok(shown.text.includes(`workshop ${workshopId}: done`), `the standing line says which workshop and where it stands: ${shown.text}`);
    assert.ok(shown.text.includes('1 file'), `and how many files it wrote: ${shown.text}`);
    assert.ok(shown.text.includes(shortSha(real.sha256)), `the code row carries the hash: ${shown.text}`);
    assert.ok(shown.text.includes(workshopEntry), `and the file: ${shown.text}`);
    assert.ok(shown.text.includes(workshopLanguage), `and the language the declaration names: ${shown.text}`);

    // And the card's **second mount**, which is the one a person reads in the chat (ADR-0004: a card
    // change lands in both).
    //
    // **This is the seam the suite has for that mount, and this is what it does not prove.** The Chat
    // card is a React component the browser bundle carries; the suite reaches it in one way — it
    // fetches the module the host serves and reads it (`view-run.test.ts` does the same, running the
    // bundle to see which tool-view keys it claims and then searching it for every run status and node
    // state it must render). So what follows proves that the workshop section's words and its region
    // marker are *in the shipped bundle*. It does not prove they are mounted: a `WorkshopSection`
    // left in the file and never rendered would still be found here. Nothing in this repository
    // renders that component — there is no DOM, no renderer and no component test — and inventing one
    // for this ticket would be a second seam for the card, which ADR-0004 exists to prevent. The
    // strings asked for are the distinctive ones a minified React bundle cannot satisfy by accident.
    // A rendering seam for the Chat mount is worth a ticket of its own; until then the Workbench
    // mount's own assertions above are what hold the section's behaviour, and both mounts are
    // composed from the one view and the one label table, which is what makes that hold for both.
    const module = await servedClientModule(d);
    assert.ok(module.includes('run-workshop'), 'the browser module carries the workshop region the page carries');
    for (const said of ['nothing written yet', 'no entry', 'workshop ']) {
      assert.ok(module.includes(said), `and the words the workshop section is composed of: "${said}"`);
    }

    // And what `/hima status` prints of it, on a host of its own over the same ledger: a person at a
    // terminal and a person at the window read one sentence about one workshop.
    const stopped = await d.quit();
    assert.ok(stopped.ok, JSON.stringify(stopped));
    await d.exit();
    const inProcess = await bootInProcess(home.h);
    try {
      const said = await himaCommand(inProcess, home.h.workspace, `/hima status ${runId}`);
      assert.ok(said.text.includes(`workshop ${workshopId}: done`), `/hima status prints the workshop line: ${said.text}`);

      // What the moment's other two tools actually answered, read off the session dsh persisted —
      // the one place a tool's answer survives the turn that made it. Without this the fixture could
      // call both tools, both could answer `read: false`, and the hard-coded write after them would
      // still carry the test.
      const answered = await readPersistedSession(inProcess.ctx, opened.sessionId, (agent) => toolResults(agent));
      assert.equal(answered.length, 3, `one result per tool call the transcript makes: ${JSON.stringify(answered.map((r) => r.text.slice(0, 40)))}`);
      assert.ok(answered.every((r) => !r.failed), `none of the three failed: ${JSON.stringify(answered)}`);
      const [knowledge, read] = answered.map((r) => JSON.parse(r.text) as Record<string, unknown>) as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
      assert.equal(knowledge.file, workshopKnowledgeFile, `the knowledge tool answered the file it was asked for: ${JSON.stringify(knowledge)}`);
      assert.ok(String(knowledge.text).includes(workshopKnowledgeMarker), `with the pack's own sentence about where the count comes from: ${JSON.stringify(knowledge.text)}`);
      const report = await onTheSite(path.join(workspace, 'flow/results', home.flow.design, 'syn/report/qor.rpt'));
      assert.equal(read.output, 'qorReport', `the read tool answered the output it was asked for: ${JSON.stringify(read)}`);
      assert.equal(read.bytes, report.bytes, 'with the report\'s own size');
      // Stated and not left to be inferred: the read tool says `truncated` both ways round, because
      // the fact is about the answer the model is holding and a missing key is a thing to reason
      // about rather than a thing to read. A report of a few hundred bytes is not cut.
      assert.equal(read.truncated, false, `and nothing was cut: ${JSON.stringify(read)}`);
    } finally {
      await inProcess.dispose();
    }
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
  }
});

test('through the shell with the replay stand-in: a replayed write that leaves the workshop directory is refused, recorded and never sent, and the good write that follows it lands', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'refused');
  let d: BootedDriver | undefined;
  try {
    d = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    if (!d) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(d, pack);

    // What the three refused writes are aimed at, as they stand before the moment that aims at them:
    // the campaign's own copy of the golden flow and the report the workshop is allowed to *read*,
    // both read as soon as the workspace exists.
    const runId = await runIdOnTheList(d, pack);
    const workspace = await realpath(await workspaceOf(d, runId));
    const makefile = path.join(workspace, 'flow/Makefile');
    const reportPath = path.join(workspace, 'flow/results', home.flow.design, 'syn/report/qor.rpt');
    const before = await onTheSite(makefile);
    // The report is written by the node *before* the workshop, so it is waited for rather than
    // assumed: waited for whole, because a digest taken while the stand-in was still printing it
    // would be a digest of half a file. The moment that aims at it opens only after that node has
    // settled, so this reading is taken before the write that is refused is ever asked for.
    await until('the synthesis wrote the report this workshop may read', async () => {
      try {
        return (await readFile(reportPath, 'utf8')).includes('Cell Area:');
      } catch {
        return false;
      }
    }, 240_000);
    const reportBefore = await onTheSite(reportPath);

    const back = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(back.ok, JSON.stringify(back));
    const status = await d.wait('run-status', 'ended', 240_000);
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-goal-not-met', `the good write still carried the campaign to its end: ${JSON.stringify(status)}`);

    const view = await runOverTheRoute(d, runId);

    const refusals = view.refusals;
    assert.equal(refusals.length, 3, `three writes refused, in the order they were asked: ${JSON.stringify(refusals)}`);
    assert.equal(refusals[0]!.path, '../../flow/Makefile', 'the record names the path as the model asked for it');
    // The second write aimed at the report by the absolute path the instructions gave the model, which
    // the transcript pulled out of them: asserting it *equals* the declared report's own decided path
    // is what says the fixture aimed where it meant to, rather than at some other absolute path.
    assert.equal(refusals[1]!.path, reportPath, `the second was the report this workshop may read, by its own path: ${refusals[1]!.path}`);
    assert.equal(refusals[2]!.path, 'sub/../miner.sh', 'and the third climbed through a subdirectory');
    for (const refusal of refusals) assert.ok(refusal.reason !== '', `each says why: ${JSON.stringify(refusal)}`);

    // Nothing landed, and nothing was even sent: the audit holds no `tee` to any of the three.
    assert.deepEqual(await onTheSite(makefile), before, 'the flow copy\'s makefile is byte for byte what it was');
    assert.deepEqual(await onTheSite(reportPath), reportBefore, 'and so is the report the second write aimed at');
    const audit = await auditOf(d);
    // The audit is a rolling window, so "no such command was sent" is only a claim about the whole
    // history while the window has never been full. A campaign this short fills nothing, and asserting
    // that is what makes the absence below evidence rather than an artefact of eviction.
    assert.equal(audit.windowFilled, false, 'the audit window never filled, so what it holds is the whole history');
    for (const aimed of ['Makefile', 'qor.rpt']) {
      assert.ok(
        !audit.commands.some((c) => c.argv[0] === 'tee' && c.argv.some((w) => w.includes(aimed))),
        `no tee was sent towards ${aimed}: ${JSON.stringify(audit.commands.filter((c) => c.argv[0] === 'tee').map((c) => c.argv.join(' ')))}`,
      );
    }
    const teed = audit.commands.filter((c) => c.argv[0] === 'tee' && c.argv.at(-1)?.endsWith(workshopEntry) === true);
    assert.equal(teed.length, 1, `exactly one tee, and it is the good write: ${JSON.stringify(teed.map((c) => c.argv.join(' ')))}`);

    // And the good write is the only code record, at exactly the declared path: a refusal writes none.
    assert.equal(view.code.length, 1, `one file landed: ${JSON.stringify(view.code)}`);
    assert.equal(view.code[0]!.path, path.join(workspace, workshopDirectory, workshopEntry));
    assert.ok(view.observations.at(-1)?.values.some((v) => v.type === candidateCountType), 'and the campaign observed what that script produced');
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
  }
});

test('through the shell with the replay stand-in: a second write to a path this attempt already recorded is a second version of that file — both records stand, the job runs the later bytes, and the card counts one file', async (t) => {
  // A code record is one **version** of one file (#62, fix 2). A model that writes its entry, thinks
  // again and writes it over is doing the ordinary thing, and the rule that follows from it is what
  // this asserts: the second write is not refused, it lands and is recorded like the first, the
  // launch runs the bytes the *later* record hashes, and the count a person reads is of files rather
  // than of records — two records at one path are one file with a history, not two files.
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'rewrites');
  let d: BootedDriver | undefined;
  try {
    d = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    if (!d) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(d, pack);

    const status = await d.wait('run-status', 'ended', 240_000);
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-goal-not-met', `the corrected script carried the campaign to its end: ${JSON.stringify(status)}`);

    const runId = await theOneRunId(d);
    const view = await runOverTheRoute(d, runId);
    const workspace = await realpath(await workspaceOf(d, runId));
    const at = path.join(workspace, workshopDirectory, workshopEntry);

    // Two records at one path, in the order they were written, with different bytes behind them.
    const code = (await recordsOfRun(d, runId, 'code')).filter((r): r is CodeRecord => r.type === 'code');
    assert.equal(code.length, 2, `each write is recorded: ${JSON.stringify(code.map((r) => r.sha256.slice(0, 8)))}`);
    assert.deepEqual(code.map((r) => r.path), [at, at], 'both at the entry the declaration names');
    assert.notEqual(code[0]!.sha256, code[1]!.sha256, 'and each hashes its own version of it');
    assert.ok(code.every((r) => r.attempt === 1 && r.sessionId === code[0]!.sessionId), `one attempt, one moment: ${JSON.stringify(code.map((r) => `${String(r.attempt)}/${r.sessionId}`))}`);

    // What is on the Site is the later version, and the launch says that is what ran.
    const real = await onTheSite(at);
    assert.equal(code[1]!.sha256, real.sha256, 'the later record is the bytes that are really there');
    assert.notEqual(code[0]!.sha256, real.sha256, 'and the earlier one is a version that no longer is');
    const launched = (await recordsOfRun(d, runId, 'job'))
      .filter((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.job.name === JOB_NAME);
    assert.equal(launched.length, 1, `one job: ${JSON.stringify(launched.map((r) => r.event))}`);
    assert.deepEqual(launched[0]!.workshop, { id: workshopId, entry: { path: at, sha256: real.sha256 } },
      `the launch names the version it ran: ${JSON.stringify(launched[0]!.workshop)}`);
    // And the number the reader read is the one the *second* version prints, which is the evidence
    // that the bytes the launch record names are the bytes that actually executed.
    const count = view.observations.at(-1)?.values.find((v) => v.type === candidateCountType);
    assert.ok(count, `the run carries the reading: ${JSON.stringify(view.observations.at(-1))}`);
    assert.equal(count.value, MINED_TOP_N, 'which is the count the corrected script prints, not the first version\'s');

    // One file, two versions: the count is of distinct paths this attempt wrote.
    assert.ok(view.workshop, `the run view carries the workshop: ${JSON.stringify(view.workshop)}`);
    assert.equal(view.workshop.files, 1, `two records at one path are one file: ${JSON.stringify(view.workshop)}`);
    assert.equal(view.code.length, 2, 'while the run view still serves every version, which is where the history is read');

    const card = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const shown = await d.read('run-workshop');
    assert.ok(shown.ok, `the card shows the workshop: ${JSON.stringify(shown)}`);
    assert.equal(shown.state.files, '1', `the card counts one file: ${JSON.stringify(shown.state)}`);
    assert.ok(shown.text.includes('1 file'), `and says so in the standing line: ${shown.text}`);
    assert.ok(shown.text.includes(shortSha(real.sha256)), `the row carries the version that is there: ${shown.text}`);
    // One row per file and not per record: the card is about what this attempt wrote, and the
    // superseded version is read on the records route with everything else that happened.
    assert.ok(!shown.text.includes(shortSha(code[0]!.sha256)), `and not the version it replaced: ${shown.text}`);
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
  }
});


test('through the shell with the replay stand-in: a script that exits non-zero spends the retry allowance, blocks the node with the log tail, and a resume opens a fresh moment', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'failing');
  assert.equal(scenario.children.length, 3, `the scenario carries a child log per moment after the first: ${JSON.stringify(scenario.children)}`);
  let d: BootedDriver | undefined;
  try {
    d = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override, children: scenario.children } } });
    if (!d) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(d, pack);

    const waiting = await d.wait('run-status', 'waiting', 300_000);
    assert.ok(waiting.ok, `wait run-status: ${JSON.stringify(waiting)}`);

    const runId = await theOneRunId(d);
    const view = await runOverTheRoute(d, runId);

    const sessions = (await recordsOfRun(d, runId, 'session')).filter((r): r is SessionRecord => r.type === 'session');
    assert.deepEqual(sessions.map((r) => r.attempt), [1, 1, 2, 2, 3, 3], `three moments, one per attempt: ${JSON.stringify(sessions.map((r) => `${r.event}@${String(r.attempt)}`))}`);
    const code = (await recordsOfRun(d, runId, 'code')).filter((r): r is CodeRecord => r.type === 'code');
    assert.deepEqual(code.map((r) => r.attempt), [1, 2, 3], `and one script written per attempt: ${JSON.stringify(code.map((r) => r.attempt))}`);

    const jobs = view.jobs.filter((j) => j.job.name === JOB_NAME);
    assert.equal(jobs.filter((j) => j.event === 'launched').length, 3, `three jobs, one per attempt: ${JSON.stringify(jobs.map((j) => j.event))}`);
    assert.ok(jobs.filter((j) => j.exitCode !== undefined).every((j) => j.exitCode === 3), `each exited 3: ${JSON.stringify(jobs.map((j) => j.exitCode))}`);

    const workshopNodes = (await recordsOfRun(d, runId, 'node')).filter((r) => r.type === 'node' && r.nodeId === workshopId);
    assert.equal(workshopNodes.filter((r) => r.type === 'node' && r.state === 'retrying').length, 2, `two of the three attempts retried: ${JSON.stringify(workshopNodes.map((r) => r.type === 'node' ? r.state : ''))}`);

    const blocker = view.blockers.at(-1);
    assert.ok(blocker, `the run carries a hard blocker: ${JSON.stringify(view.blockers)}`);
    assert.equal(blocker.nodeId, workshopId);
    assert.equal(blocker.attempts, 3);
    assert.equal(blocker.lastExitCode, 3);
    assert.ok(blocker.logTail?.includes('the mining stage found no netlist to read'), `the tail holds the script's own last line: ${JSON.stringify(blocker.logTail)}`);

    // Back to the card, which reading the Run's id off the list navigated away from.
    const back = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(back.ok, JSON.stringify(back));
    const shown = await d.read('run-workshop');
    assert.ok(shown.ok, JSON.stringify(shown));
    assert.equal(shown.state.state, 'blocked', `the card's workshop line says blocked: ${JSON.stringify(shown.state)}`);
    assert.ok(shown.text.includes(`workshop ${workshopId}: blocked`), `in the words a person reads: ${shown.text}`);

    // Resume from the window's own control: a fourth moment opens, the good script runs, and the
    // campaign reaches its end.
    const resumed = await d.click('resume');
    assert.ok(resumed.ok, JSON.stringify(resumed));
    const ended = await d.wait('run-status', 'ended', 240_000);
    assert.ok(ended.ok, `wait run-status after the resume: ${JSON.stringify(ended)}`);

    const afterwards = (await recordsOfRun(d, runId, 'session')).filter((r): r is SessionRecord => r.type === 'session');
    assert.equal(afterwards.length, 8, `a fourth moment opened and closed: ${JSON.stringify(afterwards.map((r) => `${r.event}@${String(r.attempt)}`))}`);
    assert.equal(afterwards.at(-1)!.attempt, 4, 'numbered as the next attempt at that node');
    assert.equal(afterwards.at(-1)!.outcome, 'completed');
    const later = await runOverTheRoute(d, runId);
    assert.ok(later.observations.at(-1)?.values.some((v) => v.type === candidateCountType), `the fourth attempt's script produced what the reader reads: ${JSON.stringify(later.observations.at(-1))}`);
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
  }
});

test('through the shell with the replay stand-in: a host taken away while the moment is open leaves one open record, the next host closes it interrupted and blocks the node, and a resume opens a fresh moment', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const hanging = await writeMomentScenario(home.h, 'hangs');
  const answering = await writeMomentScenario(home.h, 'writes');
  let hung: BootedDriver | undefined;
  let second: BootedDriver | undefined;
  try {
    hung = await bootDriver(t, { existing: home.h, model: { replay: { file: hanging.file, override: hanging.override } } });
    if (!hung) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(hung, pack);

    // What says the moment is really open is the file replay writes before it begins to wait.
    await until('the hanging model call announced itself', async () => {
      try {
        await stat(hanging.readyFile);
        return true;
      } catch {
        return false;
      }
    }, 240_000);
    const runId = await runIdOnTheList(hung, pack);

    const stopped = await hung.quit();
    assert.ok(stopped.ok, JSON.stringify(stopped));
    await hung.exit();

    second = await bootDriver(t, { existing: home.h, model: { replay: { file: answering.file, override: answering.override } } });
    assert.ok(second, 'the second boot answered');

    await until('the second host closed the interrupted moment and blocked the node', async () =>
      (await recordsOfRun(second!, runId, 'session')).length >= 2);
    const sessions = (await recordsOfRun(second, runId, 'session')).filter((r): r is SessionRecord => r.type === 'session');
    assert.deepEqual(sessions.map((r) => `${r.event}${r.outcome === undefined ? '' : `:${r.outcome}`}`), ['opened', 'closed:interrupted'],
      `exactly one close for the one open: ${JSON.stringify(sessions)}`);

    await until('the run was handed to a person', async () => (await runOverTheRoute(second!, runId)).run.status === 'waiting');
    const view = await runOverTheRoute(second, runId);
    const node = view.nodes.find((n) => n.nodeId === workshopId);
    assert.ok(node, JSON.stringify(view.nodes));
    assert.equal(node.state, 'blocked', `the reconciliation blocked the node: ${JSON.stringify(node)}`);
    assert.ok(node.reason?.includes('no job of that node open on the site'), `with the reconciliation's own reason: ${JSON.stringify(node.reason)}`);

    // The card of that Run on the second host, which is where a person clears a blocker from.
    const card = await second.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const standing = await second.read('run-workshop');
    assert.ok(standing.ok, JSON.stringify(standing));
    assert.equal(standing.state.state, 'blocked', `the card says where the interrupted workshop stands: ${JSON.stringify(standing.state)}`);
    assert.equal(standing.state.files, '0', 'and that the interrupted moment wrote nothing');

    // The window the public moment route must stand out of (#62), and the one a restart leaves open:
    // this Run is **waiting**, not running, and it is waiting at the workshop node itself — the
    // reconciliation blocked that node without moving the Run off it. The next attempt there is the
    // resume's to open, numbered by the node; a moment opened here would take that number first and
    // the node's sessions would stop being one pair per attempt. Refused with a code of its own, read
    // off the ledger alone: the latest opened session at the node the Run stands on carries a
    // workshop block, which is the fact that says the node's moments are the fabric's.
    const host = await second.host();
    assert.ok(host.ok, JSON.stringify(host));
    const standOff = await api(host, await second.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}/moment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'say anything' }),
    });
    const standOffText = await standOff.text();
    assert.equal(standOff.status, 409, `a moment on a run waiting at its workshop node is refused: ${standOffText}`);
    const standOffBody = JSON.parse(standOffText) as { error: { code: string; message: string } };
    assert.equal(standOffBody.error.code, 'hima/workshop-node', standOffText);
    assert.ok(standOffBody.error.message.includes(workshopId), `naming the node and the workshop it opens: ${standOffBody.error.message}`);
    assert.equal((await recordsOfRun(second, runId, 'session')).length, 2, 'and nothing was opened: still the one interrupted pair');

    const resumed = await second.click('resume');
    assert.ok(resumed.ok, JSON.stringify(resumed));
    const ended = await second.wait('run-status', 'ended', 240_000);
    assert.ok(ended.ok, `wait run-status after the resume: ${JSON.stringify(ended)}`);

    const whole = (await recordsOfRun(second, runId, 'session')).filter((r): r is SessionRecord => r.type === 'session');
    assert.deepEqual(whole.map((r) => `${r.event}${r.outcome === undefined ? '' : `:${r.outcome}`}`),
      ['opened', 'closed:interrupted', 'opened', 'closed:completed'],
      `one chain: open, closed, open, closed, and no second close for the first open: ${JSON.stringify(whole)}`);
    assert.deepEqual(whole.map((r) => r.attempt), [1, 1, 2, 2],
      `and the moment after the resume is the node's second attempt, not its first again: ${JSON.stringify(whole.map((r) => r.attempt))}`);
    assert.notEqual(whole[2]!.sessionId, whole[0]!.sessionId, 'a second moment is a second session');
    const later = await runOverTheRoute(second, runId);
    assert.equal(later.nodes.find((n) => n.nodeId === workshopId)?.state, 'done', 'and the node ends done');
    assert.equal(later.code.length, 1, `one script, written once: ${JSON.stringify(later.code)}`);
  } finally {
    if (second) await second.dispose();
    if (hung) await hung.dispose();
    await home.h.dispose();
  }
});

test('through the shell with the replay stand-in: a host taken away while the workshop\'s job runs is picked up by the next host, with no second moment and no second code record', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'slow');
  let first: BootedDriver | undefined;
  let second: BootedDriver | undefined;
  try {
    first = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    if (!first) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(first, pack);
    const runId = await runIdOnTheList(first, pack);

    // The Job is launched once the moment has closed and the script is on the Site: what says so is
    // the launch record naming this workshop's job.
    await until('the workshop\'s job was launched', async () =>
      (await runOverTheRoute(first!, runId)).jobs.some((j) => j.job.name === JOB_NAME && j.event === 'launched'), 240_000);
    const midway = await runOverTheRoute(first, runId);
    const sessionsBefore = (await recordsOfRun(first, runId, 'session')).length;
    assert.equal(sessionsBefore, 2, `the moment is over before the job starts: ${String(sessionsBefore)}`);
    assert.equal(midway.code.length, 1, `and the one script is on record: ${JSON.stringify(midway.code)}`);

    // The one window in which a workshop node is a thing a person watches: the moment has closed, the
    // script is on the Site, and its job is still running. What the card says here is the whole of
    // what #62 puts in front of a person.
    assert.equal(midway.workshop?.state, 'running', `the run view says the workshop's job is running: ${JSON.stringify(midway.workshop)}`);
    assert.equal(midway.workshop?.files, 1);
    const card = await first.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(card.ok, JSON.stringify(card));
    const shown = await first.read('run-workshop');
    assert.ok(shown.ok, JSON.stringify(shown));
    assert.equal(shown.state.state, 'running', `and so does the card: ${JSON.stringify(shown.state)}`);
    assert.ok(shown.text.includes(`workshop ${workshopId}: running`), `in the words a person reads: ${shown.text}`);
    assert.ok(shown.text.includes(midway.code[0]!.path), `with the file that was written: ${shown.text}`);
    assert.ok(shown.text.includes(shortSha(midway.code[0]!.sha256)), `and the hash to hold it against: ${shown.text}`);

    // And the one window in which the public moment route can be asked about a Run somebody is
    // driving. It refuses: the drive opens its own moments at this node, numbered by the node's own
    // attempt, and a moment opened here beside it would take the number the next retry is about to
    // take — leaving the node's session records no longer one pair per attempt.
    const host = await first.host();
    assert.ok(host.ok, JSON.stringify(host));
    const refused = await api(host, await first.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}/moment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'say anything' }),
    });
    const refusedText = await refused.text();
    assert.equal(refused.status, 409, `a moment on a running run is refused: ${refusedText}`);
    assert.equal((JSON.parse(refusedText) as { error: { code: string } }).error.code, 'hima/run-running', refusedText);
    assert.equal((await recordsOfRun(first, runId, 'session')).length, sessionsBefore, 'and nothing was opened: no second pair of session records');

    const stopped = await first.quit();
    assert.ok(stopped.ok, JSON.stringify(stopped));
    await first.exit();

    second = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    assert.ok(second, 'the second boot answered');
    const reopened = await second.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(reopened.ok, JSON.stringify(reopened));
    const ended = await second.wait('run-status', 'ended', 300_000);
    assert.ok(ended.ok, `wait run-status: ${JSON.stringify(ended)}`);

    const view = await runOverTheRoute(second, runId);
    assert.equal((await recordsOfRun(second, runId, 'session')).length, sessionsBefore, 'the second host opened no moment of its own');
    assert.equal(view.code.length, 1, `and wrote no second code record: ${JSON.stringify(view.code)}`);
    assert.equal(view.jobs.filter((j) => j.job.name === JOB_NAME && j.event === 'launched').length, 1, 'the job it picked up is the one that was already running');
    assert.ok(view.nodes.some((n) => n.nodeId === workshopId && n.state === 'done'), `the node the second host settled: ${JSON.stringify(view.nodes)}`);
    assert.ok(view.observations.at(-1)?.values.some((v) => v.type === candidateCountType), 'and the campaign observed what that job produced');
  } finally {
    if (second) await second.dispose();
    if (first) await first.dispose();
    await home.h.dispose();
  }
});

test('through the shell with the replay stand-in: a workshop directory that resolves anywhere but to itself blocks the node, records the refusal and opens no moment', async (t) => {
  // The **resolved** root rule, driven rather than declared (#62, fix 2). The declaration here is
  // spotless — `alias` is a plain segment, it is neither `flow` nor `hima-readers`, and every
  // load-time check passes it — and the refusal happens on the Site, after the `mkdir`, because the
  // directory that is really there resolves somewhere else. Without this the load-time cases would
  // pass with the resolved comparison deleted.
  //
  // The link is planted by the Job at the node **before** the workshop — the stand-in flow's `synth`
  // recipe makes it at the Campaign workspace root when the flow was generated with a plant to make
  // (`plantsLink`, `packages/desktop/src/local-site.ts`). That is a Job of the Campaign's own doing
  // exactly what a script a model wrote could do, which is the honest way for a link to be there; and
  // because the graph runs `synthesize` before this node, it is there by the time the workshop opens
  // without anything in this test racing anything. The first pass of this test planted it from here
  // inside a five-second sleep, which was a window and not a proof.
  //
  // The link points at the workspace's own `flow`. The reason it still binds the **resolved-root**
  // rule and not the one beside it is the order the two are asked in and the words each writes: the
  // exact comparison comes first and says "resolves to …, which is not itself", which is what is
  // asserted here; with that comparison taken out, the second rule answers with a different sentence
  // and this test fails on it (the mutation is in the report).
  const home = await localHome(t, { sleepSeconds: 0, plantsLink: { name: 'alias', to: 'flow' } });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'writes');
  let d: BootedDriver | undefined;
  try {
    d = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    if (!d) return;
    const pack = await installWorkshopPack(packsDirOf(home.h), 'workshop-alias', { directory: 'alias' });
    await start(d, pack);

    const waiting = await d.wait('run-status', 'waiting', 300_000);
    assert.ok(waiting.ok, `wait run-status: ${JSON.stringify(waiting)}`);
    const runId = await theOneRunId(d);

    // The workspace as the Site really has it, the directory that was declared, and what the Job
    // before the workshop left in its place.
    const workspace = await realpath(await workspaceOf(d, runId));
    const declared = path.join(workspace, 'alias');
    const elsewhere = path.join(workspace, 'flow');
    assert.equal(await realpath(declared), elsewhere, `the job before the workshop planted the link: ${declared}`);

    // The node blocked, naming both paths: what was declared, and what it turned out to be.
    const view = await runOverTheRoute(d, runId);
    const node = view.nodes.find((n) => n.nodeId === workshopId);
    assert.ok(node, `the path holds the workshop node: ${JSON.stringify(view.nodes.map((n) => n.nodeId))}`);
    assert.equal(node.state, 'blocked', `the node blocked rather than opening a moment somewhere else: ${JSON.stringify(node)}`);
    assert.ok(
      node.reason?.includes(`the workshop directory ${declared} resolves to ${elsewhere}, which is not itself`),
      `saying what the declared directory really is: ${JSON.stringify(node.reason)}`,
    );

    // The refusal record, which is where a person reads what the Site was asked for.
    const refusals = view.refusals;
    assert.equal(refusals.length, 1, `one refusal, about the directory: ${JSON.stringify(refusals)}`);
    assert.ok(refusals[0]!.path.endsWith(`${path.sep}alias`), `naming the path as it was asked for: ${refusals[0]!.path}`);
    assert.ok(refusals[0]!.reason.includes(declared) && refusals[0]!.reason.includes(elsewhere),
      `and both paths in the reason: ${refusals[0]!.reason}`);

    // And **no moment opened**: the resolution is held before a model is composed, so nothing was
    // asked of one and nothing was written anywhere.
    assert.equal((await recordsOfRun(d, runId, 'session')).length, 0, 'no session record: no moment was opened at all');
    assert.equal(view.code.length, 0, 'and nothing was written');
    const audit = await auditOf(d);
    assert.equal(audit.windowFilled, false, 'the audit window never filled, so what it holds is the whole history');
    // Neither into the directory as it was declared nor into the one it really is — the second of
    // those is the damage the rule exists to prevent, since what the link points at is the copy of
    // the golden flow this generation is about to build in.
    assert.ok(
      !audit.commands.some((c) => c.argv[0] === 'tee' && [`${declared}${path.sep}`, `${elsewhere}${path.sep}`].some((root) => c.argv.at(-1)?.startsWith(root) === true)),
      `and no write was sent into it: ${JSON.stringify(audit.commands.filter((c) => c.argv[0] === 'tee').map((c) => c.argv.join(' ')))}`,
    );
  } finally {
    if (d) await d.dispose();
    await home.h.dispose();
  }
});

test('through the shell with the replay stand-in: a host taken away in the gap between the workshop\'s launch record and the node record that names it settles the same attempt, not the next one', async (t) => {
  // The gap #62's first pass left open. A launch and the node record carrying its session are two
  // writes, the launch first; a host that died between them left an attempt no node record could
  // name, and recovery — reading the node records alone — numbered the attempt-1 moment, its code
  // record and its Job as attempt 2. The launch now carries the attempt itself.
  //
  // **What this test proves, exactly.** That a real host, taken away as close to that window as a
  // poll can get, writes a launch record carrying `attempt: 1`, and that the *next* host picks that
  // Job up and settles it as attempt 1 — one moment, one code record, one `reconciled`, one `done`.
  // What it does not prove is the reading that makes the launch record authoritative: the interval
  // being raced for is one ledger append, shorter than a poll's round trip, so the node record has in
  // practice already landed by the time the host goes (the diagnostic below says which side it was
  // on) and the fall-back would answer 1 as well. That reading is proved on a ledger holding exactly
  // the record such a host leaves behind, in "a job whose launch record names its attempt" below.
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await writeMomentScenario(home.h, 'slow');
  let first: BootedDriver | undefined;
  let second: BootedDriver | undefined;
  try {
    first = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    if (!first) return;
    const pack = await installWorkshopPack(packsDirOf(home.h));
    await start(first, pack);
    const runId = await runIdOnTheList(first, pack);

    // Polled with no wait at all, unlike every other wait in this file: what is being raced for is
    // the interval between two ledger appends, and a poll that slept would never be inside it.
    let session: string | undefined;
    let nodeRecordThere = true;
    await until('the workshop\'s job was launched', async () => {
      const records = await recordsOfRun(first!, runId);
      const launched = records.find((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.job.name === JOB_NAME);
      if (!launched) return false;
      session = launched.job.session;
      nodeRecordThere = records.some((r) => r.type === 'node' && r.jobSession === session);
      return true;
    }, 240_000);
    assert.ok(session, 'the launch record names the session it launched');
    t.diagnostic(`the node record naming ${session} had ${nodeRecordThere ? 'already' : 'not yet'} landed when the host was taken away`);

    // The durable fact recovery reads first, whichever side of the gap this run landed on: the launch
    // record itself says which attempt its Job belongs to. This is the half a real restart can be
    // asked for — that the field is really written, by a real launch, before the host goes away.
    const launchRecord = (await recordsOfRun(first, runId, 'job'))
      .find((r): r is JobRecord => r.type === 'job' && r.event === 'launched' && r.job.name === JOB_NAME);
    assert.equal(launchRecord?.attempt, 1, `the launch record carries the attempt it belongs to: ${JSON.stringify(launchRecord)}`);

    const stopped = await first.quit();
    assert.ok(stopped.ok, JSON.stringify(stopped));
    await first.exit();

    second = await bootDriver(t, { existing: home.h, model: { replay: { file: scenario.file, override: scenario.override } } });
    assert.ok(second, 'the second boot answered');
    const reopened = await second.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(reopened.ok, JSON.stringify(reopened));
    const ended = await second.wait('run-status', 'ended', 300_000);
    assert.ok(ended.ok, `wait run-status: ${JSON.stringify(ended)}`);

    // One turn, one attempt: everything the recovery wrote for this Job is numbered as the attempt
    // the moment, the code record and the launch all belong to.
    const nodes = (await recordsOfRun(second, runId, 'node')).filter((r): r is NodeRecord => r.type === 'node' && r.nodeId === workshopId);
    const reconciled = nodes.filter((r) => r.state === 'reconciled');
    assert.equal(reconciled.length, 1, `the second host reconciled the job it found, once: ${JSON.stringify(nodes.map((r) => `${r.state}@${String(r.attempt)}`))}`);
    assert.equal(reconciled[0]!.attempt, 1, 'and numbered it the attempt the job was launched for');
    const done = nodes.filter((r) => r.state === 'done');
    assert.equal(done.length, 1, `and settled the node once: ${JSON.stringify(nodes.map((r) => `${r.state}@${String(r.attempt)}`))}`);
    assert.equal(done[0]!.attempt, 1, 'as that same attempt');
    const view = await runOverTheRoute(second, runId);
    assert.equal(view.code.length, 1, `one script, written once: ${JSON.stringify(view.code)}`);
    assert.equal((await recordsOfRun(second, runId, 'session')).length, 2, 'and the second host opened no moment of its own');
  } finally {
    if (second) await second.dispose();
    if (first) await first.dispose();
    await home.h.dispose();
  }
});
