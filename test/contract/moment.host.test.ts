// @hima-seam tools direct
// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { openSession } from './support/hima-api.ts';
import { writeReplayOverlay } from '../../packages/desktop/src/hima-home.ts';
import { localHome } from './support/fabric.ts';
import { api } from './support/hima-api.ts';
import { scanForSecret, writeMomentFixture } from './support/moments.ts';
import { timingProbePackId } from './support/pack.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { HIMA_MOMENT_PRESET, SHELL_TOOL, openMoment as openMomentDirectly, type HimaErrorBody, type MomentAnswer, type RecordsView, type RunView, type SessionRecord } from '@hima/harness';


/** The model the profile selects, which the stand-in's catalog answers for (D9). */
const MODEL = 'deepseek-flash';


/** What the committed one-turn transcript makes the model say. */
const ANSWER = 'READY';


/** The tools a moment must not be able to reach, by the names dsh registers them under. */
const FORBIDDEN = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'skill', 'web_search', 'web_fetch', 'hima_observe', 'hima_run', 'hima_resume', 'hima_cancel'];


/** How long a test waits for something inside the window to become true. */
const waitTimeoutMs = 90_000;


/**
 * Start one generation of the shipped pack on the local Site, the way the workbench starts one.
 *
 * The Strategy is stated knob by knob in the pack's own names (#58), and stated rather than left to
 * the pack's declared default, because these tests were written against a Run set to 2.0 ns and a
 * moment's subject is the model session and not what the flow synthesized at: a Strategy this file
 * does not say is one a later edit of the pack's contract could move under it.
 */
const startRun = (host: { url: string }, cookie: string): Promise<Response> =>
  api(host, cookie, '/hima/api/runs', {
    method: 'POST',
    body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 1 }),
    headers: { 'content-type': 'application/json' },
  });


/** Open a moment on the Run's current node through the fenced route. */
const openMoment = (host: { url: string }, cookie: string, runId: string, instructions: string): Promise<Response> =>
  api(host, cookie, `/hima/api/runs/${runId}/moment`, {
    method: 'POST',
    body: JSON.stringify({ instructions }),
    headers: { 'content-type': 'application/json' },
  });


/**
 * One answer of the namespace, read once.
 *
 * A `Response` body can be consumed exactly once, so an assertion whose message reads the body has
 * already spent it by the time the assertion passes. Every read here goes through this: the text is
 * taken first, the status is asserted against it, and the JSON is parsed from the text that was
 * read — so a failure says what the route actually answered and a pass leaves the body alone.
 */
async function answer<T>(answered: Response, status: number, what: string): Promise<T> {
  const text = await answered.text();
  assert.equal(answered.status, status, `${what}: ${String(answered.status)} ${text}`);
  return JSON.parse(text) as T;
}


/** This Run's `session` records, oldest first, as the records route lists them. */
async function sessionRecordsOf(host: { url: string }, cookie: string, runId: string): Promise<SessionRecord[]> {
  const body = await answer<RecordsView>(await api(host, cookie, `/hima/api/runs/${runId}/records?type=session`), 200, 'the records route answered');
  return body.records.filter((r): r is SessionRecord => r.type === 'session');
}


/** Poll until something is true, or fail saying what never happened. */
async function until(what: string, ready: () => boolean | Promise<boolean>, timeoutMs = waitTimeoutMs): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await ready()) return;
    if (Date.now() >= deadline) throw new Error(`waited ${String(timeoutMs)} ms and ${what} never happened`);
    await new Promise((r) => setTimeout(r, 200));
  }
}


test('through the Host with the replay stand-in: a moment opens on a stand-in node, the replayed turn answers, and the ledger holds the pair that brackets it', async (t) => {
  // The home is seeded here rather than by the boot, because the scenario the stand-in replays has
  // to be inside it before the host that replays it starts.
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const fixture = await writeMomentFixture(home.h, 'one-turn');
  let d: BootedHost | undefined;
  try {
    d = await bootMomentHost(home.h, { file: fixture.file, overrideFile: fixture.override });
    if (!d) return;
    const host = d;
    assert.ok(host.url, JSON.stringify(host));
    const cookie = await openSession(d);

    // The preset a moment is composed from is in the home the product prepared, not in the test's
    // hand: what isolates a moment is shipped with the bundle.
    assert.ok(existsSync(path.join(home.h.home, '.agent-presets', HIMA_MOMENT_PRESET, 'agent.cordis.yml')),
      `the ${HIMA_MOMENT_PRESET} preset is installed in the home: ${home.h.home}`);

    // A Run driven to its end on the stand-in flow, so there is a node to open a moment at.
    const view = await answer<RunView>(await startRun(host, cookie), 200, 'the run started');
    const runId = view.run.id;
    assert.ok(view.run.currentNode, `the run stands at a node: ${JSON.stringify(view.run)}`);

    const moment = await answer<MomentAnswer>(await openMoment(host, cookie, runId, `Answer with exactly the word ${ANSWER}.`), 200, 'the moment route answered');

    assert.equal(moment.text, ANSWER, `the replayed turn is what the model said: ${JSON.stringify(moment)}`);
    assert.equal(moment.model, MODEL, 'the model is the profile default, read off the session');
    assert.ok(moment.sessionId.startsWith('session-'), `the answer names dsh's own session: ${moment.sessionId}`);
    // The whole of criterion two, on dsh's own answer about that session's scope.
    const reached: readonly string[] = moment.tools;
    for (const name of FORBIDDEN) assert.ok(!reached.includes(name), `${name} is not in a moment's reach: ${JSON.stringify(reached)}`);
    assert.deepEqual(reached, [], `the session reached no tool at all: ${JSON.stringify(reached)}`);

    const records = await sessionRecordsOf(host, cookie, runId);
    assert.equal(records.length, 2, `one moment, one pair of records: ${JSON.stringify(records.map((r) => r.event))}`);
    const [opened, closed] = records as [SessionRecord, SessionRecord];
    assert.equal(opened.event, 'opened');
    assert.equal(closed.event, 'closed');
    assert.equal(closed.outcome, 'completed', 'the moment closed having done what it was opened for');
    assert.equal(opened.outcome, undefined, 'an opened moment claims no outcome it cannot know yet');
    assert.equal(closed.tools, undefined, 'what a session could reach is written where it was composed');
    for (const record of records) {
      assert.equal(record.preset, HIMA_MOMENT_PRESET, 'the pair names the purpose the session was composed for');
      assert.equal(record.sessionId, moment.sessionId, 'the pair names the session the route answered with');
      assert.equal(record.model, MODEL, 'the pair names the model that answered');
      assert.equal(record.nodeId, view.run.currentNode, 'the pair names the node the moment happened at');
      assert.equal(record.attempt, 1, 'the first moment at that node');
      assert.equal(record.generation, 1, 'the pair carries the Generation the Run was in');
      assert.equal(record.writer, 'executor', 'a moment is the executor\'s record, never a person\'s');
    }
    assert.deepEqual(opened.tools, [], 'the opened record carries the list dsh reports for that session');
  } finally {
    if (d) await d.stop();
    await home.h.dispose();
  }
});


test('through the Host with the replay stand-in: a moment on a Run that has ended leaves the Generation rows the card and the report were written from exactly as they were', async (t) => {
  // A moment is not a turn of the Campaign's Loop, and a Campaign's wall times are the numbers its
  // own technical report was written from (#30). A `session` record folded into the Generation the
  // Run happened to be standing in would stretch that Generation's wall time by however long a model
  // took — after the report had already been written from the earlier number — and the committed
  // report and the live card would then disagree about the same Campaign. That is the one thing the
  // `experience` exclusion in `generationsOf` exists to prevent, and a moment needs the same one.
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const fixture = await writeMomentFixture(home.h, 'one-turn');
  let d: BootedHost | undefined;
  try {
    d = await bootMomentHost(home.h, { file: fixture.file, overrideFile: fixture.override });
    if (!d) return;
    const host = d;
    assert.ok(host.url, JSON.stringify(host));
    const cookie = await openSession(d);

    const started = await answer<RunView>(await startRun(host, cookie), 200, 'the run started');
    const runId = started.run.id;
    // The whole subject: a Run that is over, whose rows are final. A Run still moving measures its
    // current Generation against the instant each view was composed, and two reads of it differ
    // whatever this test does.
    assert.notEqual(started.run.status, 'running', `the run has ended, so its generation rows are final: ${JSON.stringify(started.run)}`);

    const before = await answer<RunView>(await api(host, cookie, `/hima/api/runs/${runId}`), 200, 'the run view before the moment');
    assert.ok(before.generations.length > 0, `the run has generations to fold: ${JSON.stringify(before.generations)}`);
    const standing = before.generations[before.generations.length - 1]!;

    // A gap wide enough that a fold which counted the pair below could not be mistaken for one that
    // did not: every `session` record this moment writes is stamped at least this long after the last
    // record the Campaign itself wrote.
    await new Promise((r) => setTimeout(r, 500));

    await answer<MomentAnswer>(await openMoment(host, cookie, runId, `Answer with exactly the word ${ANSWER}.`), 200, 'the moment route answered');

    // The records are there and they carry that very Generation — so the fold had something to be
    // tempted by, and this assertion is not passing because nothing was written.
    const sessions = await sessionRecordsOf(host, cookie, runId);
    assert.equal(sessions.length, 2, `the moment wrote its pair: ${JSON.stringify(sessions.map((r) => r.event))}`);
    for (const record of sessions) {
      assert.equal(record.generation, standing.generation, `stamped with the generation the ended run stands in: ${JSON.stringify(record)}`);
    }

    const after = await answer<RunView>(await api(host, cookie, `/hima/api/runs/${runId}`), 200, 'the run view after the moment');
    assert.deepEqual(after.generations, before.generations,
      `the rows a report was written from are the rows the card still shows: ${JSON.stringify({ before: before.generations, after: after.generations })}`);
  } finally {
    if (d) await d.stop();
    await home.h.dispose();
  }
});


test('through the Host with the replay stand-in: a host taken away mid-moment leaves one open record, the next host closes it interrupted exactly once, and the node takes another moment that completes', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const hang = await writeMomentFixture(home.h, 'hang-then-answer');
  const answering = await writeMomentFixture(home.h, 'hang-then-answer', 'after-restart.override.json');
  let hung: BootedHost | undefined;
  let second: BootedHost | undefined;
  try {
    hung = await bootMomentHost(home.h, { file: hang.file, overrideFile: hang.override });
    if (!hung) return;
    const host = hung;
    assert.ok(host.url, JSON.stringify(host));
    const cookie = await openSession(hung);

    const view = await answer<RunView>(await startRun(host, cookie), 200, 'the run started');
    const runId = view.run.id;
    const nodeId = view.run.currentNode;

    // The request is left in flight on purpose: its model call never returns. What says the moment
    // is really open is the file replay writes before it begins to wait.
    const hanging = openMoment(host, cookie, runId, 'Answer with exactly the word READY.');
    hanging.catch(() => undefined);
    await until('the hanging model call announced itself', () => existsSync(hang.readyFile));

    const midway = await sessionRecordsOf(host, cookie, runId);
    assert.equal(midway.length, 1, `one moment, open: ${JSON.stringify(midway.map((r) => r.event))}`);
    assert.equal(midway[0]!.event, 'opened');
    const interruptedSession = midway[0]!.sessionId;

    // The window goes away mid-turn, which is the whole subject: the dsh session goes with it.
    await hung.stop();
    await hanging.catch(() => undefined);

    // A second shell on the same home, with a stand-in that answers.
    second = await bootMomentHost(home.h, { file: answering.file, overrideFile: answering.override });
    assert.ok(second, 'the second boot answered');
    const later = second;
    assert.ok(later.url, JSON.stringify(later));
    const laterCookie = await openSession(second);

    await until('the second host closed the interrupted moment', async () => (await sessionRecordsOf(later, laterCookie, runId)).length >= 2);
    const reconciled = await sessionRecordsOf(later, laterCookie, runId);
    assert.equal(reconciled.length, 2, `exactly one close for the one open, and never a second: ${JSON.stringify(reconciled.map((r) => r.event))}`);
    assert.equal(reconciled[1]!.event, 'closed');
    assert.equal(reconciled[1]!.outcome, 'interrupted', 'the close says what really became of that session');
    assert.equal(reconciled[1]!.sessionId, interruptedSession, 'the close names the session that was open');
    assert.equal(reconciled[1]!.nodeId, nodeId, 'and the node it was open at');

    // The same node takes another moment, which runs to its end.
    const moment = await answer<MomentAnswer>(await openMoment(later, laterCookie, runId, 'Answer with exactly the word READY.'), 200, 'the second moment answered');
    assert.equal(moment.text, ANSWER, `the second host's model answered: ${JSON.stringify(moment)}`);
    assert.notEqual(moment.sessionId, interruptedSession, 'a second moment is a second session');

    const whole = await sessionRecordsOf(later, laterCookie, runId);
    assert.deepEqual(whole.map((r) => `${r.event}${r.outcome === undefined ? '' : `:${r.outcome}`}`),
      ['opened', 'closed:interrupted', 'opened', 'closed:completed'],
      `the run reads open, closed, open, closed: ${JSON.stringify(whole)}`);
    assert.deepEqual(whole.map((r) => r.sessionId), [interruptedSession, interruptedSession, moment.sessionId, moment.sessionId],
      'each pair shares its session');
    assert.equal(whole[2]!.attempt, 2, 'the moment opened after the interrupted one is the next attempt at that node');
    assert.equal(whole[0]!.attempt, 1, 'and the interrupted one was the first');
  } finally {
    if (second) await second.stop();
    if (hung) await hung.stop();
    await home.h.dispose();
  }
});


// The scan's own fail-closed property, which no booted run can show: a regular file whose bytes
// cannot be read is reported rather than passed over. Everything this product says about a key
// resting in no file it wrote is said through an empty `holding`, and an empty `holding` means
// nothing if a file the scan could not open simply left the evidence without a trace.
test('the scan reports a regular file it could not read, rather than passing over it', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads a file whose mode forbids everyone, so there is no unreadable file to make');
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'hima-scan-'));
  // Made up here and nowhere else, exactly as the key test above makes one up.
  const needle = `hima-fake-${randomUUID()}`;
  const readable = path.join(root, 'readable.txt');
  const shut = path.join(root, 'shut.txt');
  await writeFile(readable, 'nothing of interest here\n');
  await writeFile(shut, `${needle}\n`);
  await chmod(shut, 0o000);
  try {
    const scan = await scanForSecret([root], needle);
    assert.deepEqual(scan.files.map((f) => f.path), [readable], `the scan read what it could: ${JSON.stringify(scan.files)}`);
    assert.deepEqual(scan.unreadable.map((f) => f.path), [shut], `and reports what it could not: ${JSON.stringify(scan.unreadable)}`);
    assert.match(scan.unreadable[0]?.error ?? '', /EACCES/, `with the error that stopped it: ${JSON.stringify(scan.unreadable)}`);
    // The file holds the needle, and `holding` is empty: that is the whole point. A caller that asks
    // only whether `holding` is empty is told a run is clean by a scan that never looked, which is
    // why every caller of this now asks `unreadable` as well.
    assert.deepEqual(scan.holding, [], `it claims nothing about bytes it never saw: ${JSON.stringify(scan.holding)}`);
  } finally {
    await chmod(shut, 0o600);
    await rm(root, { recursive: true, force: true });
  }
});


// The same property one level up, where the hole is bigger: a *directory* the scan cannot open hides
// every file beneath it, and a walk that returned quietly from it would report an empty `holding`
// over a subtree nobody looked at. The asymmetry this asserts is the whole of the scan's evidence
// policy — a read that failed is reported, and the one thing passed over is an entry that is not a
// file at all.
test('the scan reports a directory it could not open, and passes over a link pointing at nothing', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('root reads a directory whose mode forbids everyone, so there is no unreadable directory to make');
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'hima-scan-'));
  const needle = `hima-fake-${randomUUID()}`;
  const readable = path.join(root, 'readable.txt');
  const shutDir = path.join(root, 'shut-dir');
  const hidden = path.join(shutDir, 'hidden.txt');
  const dangling = path.join(root, 'dangling');
  await writeFile(readable, 'nothing of interest here\n');
  await mkdir(shutDir);
  await writeFile(hidden, `${needle}\n`);
  await symlink(path.join(root, 'nothing-is-here'), dangling);
  await chmod(shutDir, 0o000);
  try {
    const scan = await scanForSecret([root], needle);
    assert.deepEqual(scan.files.map((f) => f.path), [readable], `the scan read what it could: ${JSON.stringify(scan.files)}`);
    assert.deepEqual(scan.unreadable.map((f) => f.path), [shutDir], `and reports the directory it could not open: ${JSON.stringify(scan.unreadable)}`);
    assert.match(scan.unreadable[0]?.error ?? '', /EACCES/, `with the error that stopped it: ${JSON.stringify(scan.unreadable)}`);
    // The dangling link is the one thing that may be passed over: it is not a file with bytes in it,
    // so its absence from `files` takes no evidence away, and a home is allowed to hold one.
    assert.ok(!scan.unreadable.some((f) => f.path === dangling), `a link pointing at nothing is not a hole in the evidence: ${JSON.stringify(scan.unreadable)}`);
    assert.deepEqual(scan.holding, [], `it claims nothing about bytes it never saw: ${JSON.stringify(scan.holding)}`);
  } finally {
    await chmod(shutDir, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});


test('the moment route refuses what it cannot do, in the namespace\'s own words', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const fixture = await writeMomentFixture(home.h, 'one-turn');
  let d: BootedHost | undefined;
  try {
    d = await bootMomentHost(home.h, { file: fixture.file, overrideFile: fixture.override });
    if (!d) return;
    const host = d;
    assert.ok(host.url, JSON.stringify(host));
    const cookie = await openSession(d);

    const missing = await answer<HimaErrorBody>(await openMoment(host, cookie, 'run-nope', 'anything'), 404, 'a run this ledger does not hold');
    assert.equal(missing.error.code, 'hima/run-not-found');

    // And it stays 404 when the body is wrong as well: the Run is looked for before the body is read,
    // as in every other route of this namespace, so a caller holding a stale Run id is told the one
    // thing that is actually true of its request rather than being sent to fix a body that would not
    // have helped.
    const alsoBad = await answer<HimaErrorBody>(await api(host, cookie, '/hima/api/runs/run-nope/moment', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    }), 404, 'a run this ledger does not hold, asked with a body that is wrong too');
    assert.equal(alsoBad.error.code, 'hima/run-not-found');

    const runId = (await answer<RunView>(await startRun(host, cookie), 200, 'the run started')).run.id;

    const empty = await answer<HimaErrorBody>(await api(host, cookie, `/hima/api/runs/${runId}/moment`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    }), 400, 'a body with no instructions');
    assert.equal(empty.error.code, 'hima/bad-request');

    const wrongVerb = await answer<HimaErrorBody>(await api(host, cookie, `/hima/api/runs/${runId}/moment`), 405, 'a read of a route that answers POST');
    assert.equal(wrongVerb.error.code, 'hima/bad-request');

    // Nothing was opened by any of the three: a refused request writes no record.
    assert.deepEqual(await sessionRecordsOf(host, cookie, runId), [], 'a refusal opens no session');
  } finally {
    if (d) await d.stop();
    await home.h.dispose();
  }
});


test('through the Host with a model that refuses: the turn answers nothing, the moment closes failed, and the route says why', async (t) => {
  const home = await localHome(t, { sleepSeconds: 1 });
  if (!home) return;
  const fixture = await writeMomentFixture(home.h, 'refused');
  let d: BootedHost | undefined;
  try {
    d = await bootMomentHost(home.h, { file: fixture.file, overrideFile: fixture.override });
    if (!d) return;
    const host = d;
    assert.ok(host.url, JSON.stringify(host));
    const cookie = await openSession(d);

    const view = await answer<RunView>(await startRun(host, cookie), 200, 'the run started');
    const runId = view.run.id;

    // A model route that answers nothing is neither the caller's mistake nor a fault inside this
    // harness — it is the third machine in this namespace that can fail to answer — so it has its
    // own code and its own status, and the message is the route's own words about it.
    const refused = await answer<HimaErrorBody>(
      await openMoment(host, cookie, runId, `Answer with exactly the word ${ANSWER}.`),
      502, 'a model that refused the request');
    assert.equal(refused.error.code, 'hima/moment-failed');
    assert.match(refused.error.message, /the model answered nothing in session session-/, `it names the session that answered nothing: ${refused.error.message}`);
    assert.match(refused.error.message, /the recorded model route refused this request/, `and carries the route's own words: ${refused.error.message}`);

    // The ledger says a session opened and how it ended, which is the whole point of writing the
    // pair rather than only recording success.
    const records = await sessionRecordsOf(host, cookie, runId);
    assert.deepEqual(records.map((r) => `${r.event}${r.outcome === undefined ? '' : `:${r.outcome}`}`), ['opened', 'closed:failed'],
      `a moment that answered nothing is still a moment that happened: ${JSON.stringify(records)}`);
    assert.equal(records[0]!.sessionId, records[1]!.sessionId, 'and the pair is one session');
    assert.deepEqual(records[0]!.tools, [], 'which reached no tool either');
  } finally {
    if (d) await d.stop();
    await home.h.dispose();
  }
});


/**
 * A tool shaped exactly like a real shell tool, and named like one.
 *
 * Given to `openMoment` by a caller that has every right to call it — the function is exported, and
 * #62's act node is meant to hand it the pack's own tools. What makes it refusable is its *name*,
 * which is the only thing the refusal reads: it is decided before anything is composed, so a body
 * that could never run is the honest thing to put here.
 */
const shellShaped = defineTool({
  name: SHELL_TOOL,
  description: 'Shaped like a shell tool and named like one, so that a moment refusing it is refusing the name and not the implementation.',
  parameters: { command: { type: 'string', required: true, description: 'Anything at all; this is never reached.' } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { said: { type: 'string', required: true } } },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  execute: () => { throw new Error('a moment that refuses this tool by name never composes a session that could run it'); },
});


// D48's own invariant, asserted where a moment is made rather than left to the one route that makes
// one today. `momentOnCurrentNode` passes no tools, so the emptiness the tests above assert is a fact
// about that route; `openMoment` is exported and takes whatever tools a caller hands it, and #62's
// act node will hand it the pack's. A caller reaching for `write`, `edit` or `bash` is reaching past
// what a Model moment is, and the answer has to be the same whichever caller it is — so it is the
// request that is refused, before a session exists for the authoring guard to have an opinion about.
test('a moment refuses a governed tool name by construction: no session is composed and no record is written', async () => {
  const h = await createHimaHome();
  let host: InProcessHost | undefined;
  try {
    host = await bootInProcess(h);
    const ledger = host.ctx.hima.ledger;
    // A real Run on a real ledger, so that the ledger below is one an `opened` record could actually
    // land on: `appendSession` refuses a Run it does not hold, and an assertion that leaned on that
    // would be satisfied by the wrong refusal.
    const runId = (await ledger.createRun({ campaignId: `campaign-${randomUUID()}`, siteId: 'local' })).id;
    await assert.rejects(
      () => openMomentDirectly({ ledger, ctx: host!.ctx }, {
        runId,
        nodeId: 'a-node',
        attempt: 1,
        preset: HIMA_MOMENT_PRESET,
        instructions: 'Answer with one word.',
        tools: [shellShaped],
      }),
      (err: unknown) => {
        const said = err instanceof Error ? err.message : String(err);
        assert.match(said, /a Model moment has no shell and no host filesystem/, `the refusal says what a moment is: ${said}`);
        assert.match(said, /D48/, `and cites the decision it enforces: ${said}`);
        assert.match(said, new RegExp(`"${SHELL_TOOL}"`), `and names the tool it was handed: ${said}`);
        return true;
      },
      'a moment handed a governed tool name is refused',
    );

    // Nothing was composed, so nothing is on the ledger: the refusal is ahead of the `opened` record
    // and ahead of the session that record would name. Asked over every Run this ledger holds as well
    // as the one the request named, so "no session record" means no session record anywhere.
    const sessions = [...ledger.runs().map((r) => r.id), runId]
      .flatMap((id) => ledger.records({ runId: id, type: 'session' }));
    assert.deepEqual(sessions, [], `a refused request opens nothing and records nothing: ${JSON.stringify(sessions)}`);
  } finally {
    if (host) await host.dispose();
    await h.dispose();
  }
});

async function bootMomentHost(home: Parameters<typeof bootHimaHost>[0], replay: Parameters<typeof writeReplayOverlay>[1]): Promise<BootedHost> {
  await writeReplayOverlay(home.home, replay);
  return bootHimaHost(home);
}
