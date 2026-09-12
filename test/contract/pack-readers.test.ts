// Ticket #61: a reader is a pack tool, and what it produces is validated against the pack's own
// declared semantics before it becomes an observation.
//
// Until this ticket a reader was harness code with a fixed vocabulary: eight value types, one unit
// each, four TypeScript readers. A pack could *declare* a reader of its own (#57) and could not run
// one. Here it can: `readers/<id>.yml` names a script in the pack's tools folder and the command
// line to run it by, the harness ships that script into the campaign workspace under the Permit,
// launches it as a Job like any other, reads the JSON it wrote back through the Permit, and holds
// every value in it against the semantics the pack and the bundle declare between them.
//
// Driven through the desktop shell in driver mode (D42, ADR-0004), which is the one seam: the
// Campaign is started from the page's own start form, and what is asserted is what the card shows,
// what the run view carries, and what the audit says the Site was asked to run. The one test here
// that does not use that seam is the last, whose whole subject is the words of `/hima pack check` —
// a chat command, which is the one thing `bootInProcess` is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { bootDriver, fillForm as fillTheForm, runIdOnTheList, theOneRunId, waitForKnobs, type BootedDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import {
  candidateCountType,
  candidateSlackType,
  candidatesRuleId,
  installPack,
  installPackReader,
  MINED_SLACK_MODE,
  MINED_SLACK_NS,
  MINED_SLACK_SCOPE,
  MINED_TOP_N,
  packReaderBundledGraph,
  packReaderFile,
  packReaderId,
  packReaderScript,
  packSemanticsYaml,
  packsDirOf,
} from './support/pack.ts';
import type { LedgerRecord, RemoteCommand, RunView } from '@hima/harness';

/** The form this file fills, beside the pack it chooses first and the knob the pack declares. */
const FORM = {
  'start-site': 'local',
  'start-target': '2.0',
  'start-time-box': '5',
  'start-retries': '2',
  'start-generations': '1',
} as const;

const fillForm = (d: BootedDriver, changes: Readonly<Record<string, string>> = {}): Promise<void> => fillTheForm(d, FORM, changes);

/** The first twelve characters of a hash, which is how much of it a card shows. */
const shortSha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** Choose the variant on the start form and wait for the page to have re-read its knobs. */
async function choosePack(d: BootedDriver, pack: string): Promise<void> {
  const chose = await d.fill('start-pack', pack);
  assert.ok(chose.ok, `fill start-pack: ${JSON.stringify(chose)}`);
  await waitForKnobs(d, pack);
}

/**
 * Start the Campaign the form is filled for, and see that it really started.
 *
 * A start the host refuses leaves the page where it was with the reason in `start-error`, and a
 * start that took navigates to the card. Waiting on the card alone would spend the whole wait on a
 * refusal and then report the wrong thing, so the two are waited on together and a refusal is
 * reported in the words the page shows it in.
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
    // The form's own region is gone: the page moved to the card, which is what a start that took does.
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
async function recordsOfRun(d: BootedDriver, runId: string): Promise<readonly LedgerRecord[]> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), `/hima/api/runs/${encodeURIComponent(runId)}/records`);
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return (JSON.parse(text) as { records: LedgerRecord[] }).records;
}

/** Everything the host asked the Site to run, as the audit route answers it. */
async function auditOf(d: BootedDriver): Promise<readonly RemoteCommand[]> {
  const host = await d.host();
  assert.ok(host.ok, JSON.stringify(host));
  const answered = await api(host, await d.cookie(), '/hima/api/audit');
  const text = await answered.text();
  assert.equal(answered.status, 200, text);
  return (JSON.parse(text) as { commands: RemoteCommand[] }).commands;
}

test('a pack reads its own output with a script of its own: the script is shipped and launched under the permit, its values are validated against the pack\'s semantics, and the card names the reader, its file and its hash', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0 });
  if (!d) return;
  try {
    const pack = await installPackReader(packsDirOf(d.home), 'pack-reader-probe');
    await start(d, pack);

    const status = await d.wait('run-status', 'ended', 180_000);
    assert.ok(status.ok, `wait run-status: ${JSON.stringify(status)}`);
    assert.equal(status.state.status, 'ended-goal-not-met', `the graph ran out of edges at its judge node: ${JSON.stringify(status)}`);

    // What a person sees of the reading: which reader read it, that it was this pack's own script,
    // and the hash of the very bytes that were shipped and run.
    const observed = await d.read('run-observation');
    assert.ok(observed.ok, JSON.stringify(observed));
    assert.equal(observed.state.count, '1', `one reading, by the pack's own reader: ${observed.text}`);
    assert.ok(
      observed.text.includes(`read by ${packReaderId}@1 · pack script ${packReaderFile} sha256 ${shortSha(packReaderScript)}`),
      `the card says the reader, that it is a pack script, which file and its hash: ${observed.text}`,
    );
    // The rows themselves, each as one row: the type, the number and the unit together, so that no
    // assertion here can be satisfied by a hash, a byte count or a timestamp that happens to hold
    // the same digits. The second row carries the qualifiers the pack's semantics declare for it,
    // which is what a person reads to know which analysis pass and which path group a slack is of.
    assert.match(
      observed.text,
      new RegExp(`${candidateCountType}\\s*${String(MINED_TOP_N)}\\s*count`),
      `the count as one row — type, number, unit: ${observed.text}`,
    );
    assert.match(
      observed.text,
      new RegExp(`${candidateSlackType} \\(${MINED_SLACK_MODE}, ${MINED_SLACK_SCOPE}\\)\\s*${String(MINED_SLACK_NS)}\\s*ns`),
      `and the slack under the qualifiers its declaration binds: ${observed.text}`,
    );

    const runId = await theOneRunId(d);
    const view = await runOverTheRoute(d, runId);
    const reading = view.observations[0];
    assert.ok(reading, `the run carries the reading: ${JSON.stringify(view.observations)}`);
    assert.deepEqual(
      reading.reader,
      {
        id: packReaderId,
        version: '1',
        reportKind: 'standin-candidates',
        emits: [candidateCountType, candidateSlackType],
        file: packReaderFile,
        sha256: createHash('sha256').update(packReaderScript).digest('hex'),
      },
      `the record carries the declaration and the script it ran, by path and by hash: ${JSON.stringify(reading.reader)}`,
    );
    assert.deepEqual(
      reading.values,
      [
        { type: candidateCountType, unit: 'count', value: MINED_TOP_N },
        { type: candidateSlackType, unit: 'ns', value: MINED_SLACK_NS, mode: MINED_SLACK_MODE, scope: MINED_SLACK_SCOPE },
      ],
      `the values are the script's own, in the types, units and qualifiers the pack's semantics declare: ${JSON.stringify(reading.values)}`,
    );

    // And the verdict the pack's own rule reached over the pack's own value type.
    assert.deepEqual(
      view.verdicts.map((v) => `${v.ruleId}=${v.outcome}`),
      [`${candidatesRuleId}=PASS`],
      `the pack-local rule ruled on the pack-local value: ${JSON.stringify(view.verdicts)}`,
    );

    // Every remote command the reader caused, as the Site received it: the script was shipped with a
    // `tee`, and it was launched with `sh` in a tmux session like any other Job.
    const commands = await auditOf(d);
    const shipped = commands.filter((c) => c.argv[0] === 'tee').map((c) => c.argv[c.argv.length - 1]!);
    const shippedAt = shipped.find((p) => p.endsWith(`/hima-readers/${packReaderId}/${path.basename(packReaderFile)}`));
    assert.ok(shippedAt, `the reader's script was written into the workspace by a \`tee\`: ${JSON.stringify(shipped)}`);
    const launched = commands.find((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session' && c.wire.includes(shippedAt));
    assert.ok(launched, `and launched in a tmux session: ${JSON.stringify(commands.map((c) => c.wire))}`);
    assert.match(launched.wire, /'sh'/, `under the wrapper its declaration names: ${launched.wire}`);
    assert.ok(
      launched.wire.includes(reading.path),
      `with the report the permit resolved on its command line: ${launched.wire}`,
    );

    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a reader whose output adds a type it does not declare, one whose output misses a type it does declare, and one that drops a qualifier its semantics bind are each a refusal on the card, the node blocked and the run waiting', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0 });
  if (!d) return;
  try {
    // The script writes a second value of a type the bundle's semantics do declare and this reader
    // does not. A reading holding something its own record does not mention is a claim nothing
    // downstream could account for: the record would say the reader emits a candidate count, and a
    // verdict would be citing a cell area that came from nowhere.
    const adds = await installPackReader(packsDirOf(d.home), 'pack-reader-adds', {
      script: packReaderScript.replace('{ "values": [ ', '{ "values": [ { "type": "cell_area", "unit": "um2", "value": 1 }, '),
    });
    await start(d, adds);
    const waiting = await d.wait('run-status', 'waiting', 180_000);
    assert.ok(waiting.ok, `wait run-status: ${JSON.stringify(waiting)}`);

    // What a person reading the page sees on the node that failed, before the run id is read off the
    // list page — which is where a person reads it, and which is not the card.
    const path1 = await d.read('run-nodes');
    assert.ok(path1.ok, JSON.stringify(path1));
    assert.equal(path1.state['read-candidates'], 'blocked', `the path table marks the observing node blocked: ${JSON.stringify(path1.state)}`);
    assert.ok(path1.text.includes('which it does not declare in `emits`'), `and says why: ${path1.text}`);

    // And the drawer a person actually reads a refusal in, which the node table only says there was
    // one of. Read here, while the card is still what the window is showing: the run id below is
    // taken off the list page, which is not the card.
    const addedDrawer = await d.read('run-refusal');
    assert.ok(addedDrawer.ok, JSON.stringify(addedDrawer));
    assert.equal(addedDrawer.state.count, '1', `one refusal on the card: ${addedDrawer.text}`);

    const addedId = await theOneRunId(d);
    const added = await runOverTheRoute(d, addedId);
    assert.deepEqual(added.observations, [], 'nothing was appended: a reading is refused whole or written whole');
    assert.equal(added.refusals.length, 1, `one refusal record, in the validator's words: ${JSON.stringify(added.refusals)}`);
    assert.match(
      added.refusals[0]!.reason,
      /reader "count-candidates" emitted the value type "cell_area", which it does not declare in `emits`; it declares "candidate_count"/,
      `the refusal names the reader, the type and what disagreed: ${added.refusals[0]!.reason}`,
    );
    assert.equal(
      added.nodes.find((n) => n.nodeId === 'read-candidates')?.state,
      'blocked',
      `the observing node is blocked: ${JSON.stringify(added.nodes)}`,
    );
    assert.ok(addedDrawer.text.includes(added.refusals[0]!.reason), `and the card's drawer says what the record says: ${addedDrawer.text}`);

    // The other direction, on a second campaign: a declaration promising a type the script does not
    // write. A missing value read as an absent one would send the judge UNDETERMINED with nothing
    // anywhere saying a promise had been broken.
    const misses = await installPackReader(packsDirOf(d.home), 'pack-reader-misses', {
      emits: [candidateCountType, candidateSlackType, 'route_factor'],
      semantics: `${packSemanticsYaml}  route_factor: { unit: count }\n`,
    });
    await start(d, misses);
    const stillWaiting = await d.wait('run-status', 'waiting', 180_000);
    assert.ok(stillWaiting.ok, `wait run-status: ${JSON.stringify(stillWaiting)}`);

    const missedDrawer = await d.read('run-refusal');
    assert.ok(missedDrawer.ok, JSON.stringify(missedDrawer));
    const missed = await runOverTheRoute(d, await runIdOnTheList(d, misses));
    assert.deepEqual(missed.observations, [], 'again nothing was appended');
    assert.match(
      missed.refusals.at(-1)?.reason ?? '',
      /reader "count-candidates" declares it emits "route_factor" and its output misses it; it produced "candidate_count", "candidate_slack"/,
      `the refusal says what was promised and what came back: ${JSON.stringify(missed.refusals)}`,
    );
    assert.ok(missedDrawer.text.includes(missed.refusals.at(-1)!.reason), `and the card's drawer says it too: ${missedDrawer.text}`);

    // And the third way one reading can disagree with what a pack declared: a value of a type whose
    // declaration binds a path group, written without one. A slack that does not say which paths it
    // is over is a number no rule can select on and no person can check.
    const unqualified = await installPackReader(packsDirOf(d.home), 'pack-reader-unqualified', {
      script: packReaderScript.replace(`, "scope": "${MINED_SLACK_SCOPE}"`, ''),
    });
    await start(d, unqualified);
    const waitingAgain = await d.wait('run-status', 'waiting', 180_000);
    assert.ok(waitingAgain.ok, `wait run-status: ${JSON.stringify(waitingAgain)}`);

    const droppedDrawer = await d.read('run-refusal');
    assert.ok(droppedDrawer.ok, JSON.stringify(droppedDrawer));
    const dropped = await runOverTheRoute(d, await runIdOnTheList(d, unqualified));
    assert.deepEqual(dropped.observations, [], 'and nothing was appended for it either');
    assert.match(
      dropped.refusals.at(-1)?.reason ?? '',
      new RegExp(`reader "count-candidates" read ${candidateSlackType} and it carries no scope, and the semantics declare it is one of "all", "${MINED_SLACK_SCOPE}"`),
      `the refusal names the reader, the type and the qualifier it dropped: ${JSON.stringify(dropped.refusals)}`,
    );
    assert.ok(droppedDrawer.text.includes(dropped.refusals.at(-1)!.reason), `and so does the card: ${droppedDrawer.text}`);

    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a value carrying a key nothing declares, and one whose number is a string, are refused by the one gate before anything is stored: a refusal on the card, the node blocked, and nothing appended', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0 });
  if (!d) return;
  try {
    // The shape of a value is decided **at the gate**, in one place, for both the readers this
    // bundle ships and the scripts a pack runs — the controller's ruling for this pass. What a pack
    // script writes is checked for being a document at all before this and then handed to that gate
    // whole, so an unknown key or a number that is not one arrives there rather than being stopped
    // earlier in words of its own. Two defects, because they are two different silences: a key
    // nothing declares is a reader saying something this ledger has no way to read back, and a value
    // of `"8"` where a number belongs is a record every rule that selects on it would then compare a
    // string against.
    const unknownKey = await installPackReader(packsDirOf(d.home), 'pack-reader-unknown-key', {
      script: packReaderScript.replace('"unit": "count", "value": %s', '"unit": "count", "units": "count", "value": %s'),
    });
    await start(d, unknownKey);
    const waiting = await d.wait('run-status', 'waiting', 180_000);
    assert.ok(waiting.ok, `wait run-status: ${JSON.stringify(waiting)}`);

    const keyDrawer = await d.read('run-refusal');
    assert.ok(keyDrawer.ok, JSON.stringify(keyDrawer));
    assert.equal(keyDrawer.state.count, '1', `one refusal on the card: ${keyDrawer.text}`);

    const keyed = await runOverTheRoute(d, await theOneRunId(d));
    assert.deepEqual(keyed.observations, [], 'nothing was appended: a value nothing could read back is no reading');
    assert.equal(keyed.refusals.length, 1, `one refusal record: ${JSON.stringify(keyed.refusals)}`);
    assert.match(
      keyed.refusals[0]!.reason,
      new RegExp(`reader "${packReaderId}" produced something that is not a value: value 1 \\(of type "${candidateCountType}"\\)`),
      `the refusal names the reader and which value of its output: ${keyed.refusals[0]!.reason}`,
    );
    assert.match(keyed.refusals[0]!.reason, /units/, `and the key nothing declares: ${keyed.refusals[0]!.reason}`);
    assert.equal(
      keyed.nodes.find((n) => n.nodeId === 'read-candidates')?.state,
      'blocked',
      `the observing node is blocked: ${JSON.stringify(keyed.nodes)}`,
    );
    assert.ok(keyDrawer.text.includes(keyed.refusals[0]!.reason), `and the card's drawer says what the record says: ${keyDrawer.text}`);

    // The other defect, on a second campaign: the count written as a string.
    const stringValue = await installPackReader(packsDirOf(d.home), 'pack-reader-string-value', {
      script: packReaderScript.replace('"unit": "count", "value": %s', '"unit": "count", "value": "%s"'),
    });
    await start(d, stringValue);
    const stillWaiting = await d.wait('run-status', 'waiting', 180_000);
    assert.ok(stillWaiting.ok, `wait run-status: ${JSON.stringify(stillWaiting)}`);

    const stringDrawer = await d.read('run-refusal');
    assert.ok(stringDrawer.ok, JSON.stringify(stringDrawer));
    const stringed = await runOverTheRoute(d, await runIdOnTheList(d, stringValue));
    assert.deepEqual(stringed.observations, [], 'and nothing was appended for it either');
    assert.match(
      stringed.refusals.at(-1)?.reason ?? '',
      new RegExp(`reader "${packReaderId}" produced something that is not a value: value 1 \\(of type "${candidateCountType}"\\) value: `),
      `the refusal names the reader, the value and the field of it that is not what it must be: ${JSON.stringify(stringed.refusals)}`,
    );
    // And the node itself, asserted here as it is for the unknown key above: the two defects reach
    // the same unconditional refused-to-blocked branch, and a subcase that only read the refusal
    // record would be proving the gate's words while the branch they are supposed to have taken
    // stayed unasserted.
    assert.equal(
      stringed.nodes.find((n) => n.nodeId === 'read-candidates')?.state,
      'blocked',
      `the observing node is blocked for this defect too: ${JSON.stringify(stringed.nodes)}`,
    );
    assert.ok(stringDrawer.text.includes(stringed.refusals.at(-1)!.reason), `and so does the card: ${stringDrawer.text}`);

    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a reader script that exits non-zero is a failed attempt of the observing node: it retries within the allowance and then becomes a hard blocker the run waits at', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0 });
  if (!d) return;
  try {
    // A script that cannot do its job. A reader Job is a Job: a non-zero exit spends the node's
    // Retry allowance exactly as a tool's does, which is what makes a broken reader script something
    // a person repairs in the pack folder rather than a Campaign that dies at the first attempt.
    const pack = await installPackReader(packsDirOf(d.home), 'pack-reader-fails', {
      script: '#!/bin/sh\n# A reader that cannot read: the failure a pack author repairs in their own folder.\necho "[count-candidates] this script is broken" >&2\nexit 2\n',
    });
    // An allowance of two, so the node retries once and is a hard blocker at the second failure
    // rather than at the fourth: this test is about the allowance being spent, not about how long.
    await start(d, pack, { 'start-retries': '2' });
    const waiting = await d.wait('run-status', 'waiting', 180_000);
    assert.ok(waiting.ok, `wait run-status: ${JSON.stringify(waiting)}`);

    // What a person reads first, on the card they are already looking at: the tail of what the
    // script said. Read before the run id, which is taken off the list page and so leaves the card.
    const tail = await d.read('run-blocker-tail');
    assert.ok(tail.ok, JSON.stringify(tail));
    assert.ok(tail.text.includes('this script is broken'), `the script's own words: ${tail.text}`);

    const view = await runOverTheRoute(d, await theOneRunId(d));
    const states = view.nodes.filter((n) => n.nodeId === 'read-candidates').map((n) => n.state);
    assert.deepEqual(states, ['blocked'], `the node ends blocked: ${JSON.stringify(view.nodes)}`);
    // The whole path it took, which the run view folds to the latest state: the first failure was a
    // retry and the second spent the allowance.
    const transitions = (await recordsOfRun(d, view.run.id)).filter((r) => r.type === 'node' && r.nodeId === 'read-candidates');
    assert.deepEqual(
      transitions.map((r) => (r.type === 'node' ? r.state : '')),
      ['running', 'running', 'retrying', 'running', 'running', 'blocked'],
      `entered and launched, retried, entered and launched again, and blocked: ${JSON.stringify(transitions)}`,
    );
    assert.equal(view.blockers.length, 1, `and the spent allowance is a blocker record: ${JSON.stringify(view.blockers)}`);
    const blocker = view.blockers[0]!;
    assert.equal(blocker.nodeId, 'read-candidates', JSON.stringify(blocker));
    assert.equal(blocker.attempts, 2, `two attempts: the first, and the one the allowance granted: ${JSON.stringify(blocker)}`);
    assert.equal(blocker.lastExitCode, 2, `carrying what the script exited with: ${JSON.stringify(blocker)}`);
    assert.match(blocker.reason, /reader-count-candidates|read-candidates/, `and naming the job that failed: ${blocker.reason}`);
    // The mining stage's Job, and then one reader Job per attempt, each in a session of its own and
    // each named for the reader it runs rather than for the node — which is what tells a person
    // looking at the Site's tmux sessions what is in one.
    assert.deepEqual(
      view.jobs.filter((j) => j.event === 'launched').map((j) => j.job.name),
      ['mine', `reader-${packReaderId}`, `reader-${packReaderId}`],
      `the stage, then one reader job per attempt: ${JSON.stringify(view.jobs.map((j) => j.job.name))}`,
    );
    // The pack's wait node is where a hard blocker leaves the Run, so a person has somewhere to act.
    assert.equal(view.run.currentNode, 'blocked', `routed to the pack's wait node: ${JSON.stringify(view.run)}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});

test('a pack that declares a bundled value type in a unit of its own has its bundled reader\'s reading held against its own semantics, and the reading is refused at the observing node', async (t) => {
  const d = await bootDriver(t, { home: 'hima', sleepSeconds: 0 });
  if (!d) return;
  try {
    // A pack's own `semantics.yml` resolves ahead of the bundle's — that is what D46 means for a
    // vocabulary — and a pack may therefore say that a name the bundle also declares means something
    // else in its method. What it may not do is have a reading of that name taken against the
    // bundle's declaration and appended as though the pack had never spoken: a rule of this pack
    // comparing a cell area in counts against a number a reader read in square microns is a verdict
    // about nothing, reached quietly.
    //
    // So this variant declares `cell_area` in counts, walks to a node that reads a synthesis report
    // with the reader **this bundle ships**, and the reading is refused in the validator's own words.
    const pack = await installPackReader(packsDirOf(d.home), 'pack-reader-redeclares', {
      emits: [candidateCountType, 'cell_area'],
      semantics: `values:\n  ${candidateCountType}: { unit: count }\n  cell_area: { unit: count }\n`,
      graph: packReaderBundledGraph,
    });
    await start(d, pack);
    const waiting = await d.wait('run-status', 'waiting', 240_000);
    assert.ok(waiting.ok, `wait run-status: ${JSON.stringify(waiting)}`);

    const view = await runOverTheRoute(d, await theOneRunId(d));
    assert.deepEqual(view.observations, [], 'nothing was appended: the pack\'s own declaration decided, and it refused this reading');
    assert.equal(view.refusals.length, 1, `one refusal record: ${JSON.stringify(view.refusals)}`);
    assert.match(
      view.refusals[0]!.reason,
      /reader "dc-qor-report" read cell_area in "um2", and the semantics declare it is measured in "count"/,
      `the refusal is the validator's, naming the reader, the type and the two units: ${view.refusals[0]!.reason}`,
    );
    assert.equal(
      view.nodes.find((n) => n.nodeId === 'read-qor')?.state,
      'blocked',
      `the observing node is blocked: ${JSON.stringify(view.nodes)}`,
    );
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});
