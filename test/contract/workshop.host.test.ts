// PLS-20: migrated unchanged assertions to the real Host/local seam.
// Replay is a mechanism stand-in; no Electron, real model or SSH is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { bootInProcess, breakHostLogOn, hostLog, readPersistedSession, systemPromptOf, toolResults } from './support/boot-inprocess.ts';
import { himaCommand } from './support/command.ts';
import { writeLocalSite } from './support/site.ts';
import { writeStandinFlow } from './support/standin-flow.ts';
import { createHimaHome } from './support/dsh-home.ts';
import { localHome } from './support/fabric.ts';
import { replayMomentScenario } from './support/moments.ts';
import { installPack, installWorkshopPack, packReaderId, packsDirOf, workshopDirectory, workshopEntry, workshopGraph, workshopId, type WorkshopVariation } from './support/pack.ts';
import { attemptOfSession, remoteCommands } from '@hima/harness';
import type { SessionRecord } from '@hima/harness';


/** What the Job of this workshop is called on the Site. */
const JOB_NAME = `workshop-${workshopId}`;


test('in process over the same home: a write that landed and verified but that the ledger would not record is named in the tool\'s answer, in the host log and in the node the run blocks at', async (t) => {
  // What the write tool promises is not "nothing landed" — a channel can fail with bytes on the disk
  // — it is that **no landed byte goes unrecorded**: a `code` record when the harness verified what
  // is there, a refusal naming the path when it could not, and, when the ledger itself will not take
  // the record, the path named in the three places that are left. The harness removes nothing on a
  // Site, ever, so the bytes stay where they landed and what this promise becomes is that a person
  // is told where they are: the tool's own answer to the model, the host log at the moment of the
  // failure — the operator's channel, and the only one that still works when the ledger is what
  // failed — and the node the Run then blocks at.
  //
  // Driven at the one object that can have that failure and through the only seam that reaches it:
  // the ledger this host and the drive it starts share. A store that is full, a domain that refuses
  // its write — the ways an append fails are all of that shape, and none of them can be reached by
  // anything a pack, a model or a Site says, because every field of a `code` record is settled from
  // values that were validated before the moment opened.
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  await replayMomentScenario(home.h, 'writes');
  const pack = await installWorkshopPack(packsDirOf(home.h));
  const host = await bootInProcess(home.h);
  const ledgerSaid = 'this ledger store will not take another record';
  try {
    const ledger = host.ctx.hima.ledger;
    (ledger as unknown as { appendCode: () => Promise<never> }).appendCode = () => Promise.reject(new Error(ledgerSaid));

    // One attempt, so the one moment the scenario holds is the whole of the run.
    const ran = await himaCommand(
      host,
      home.h.workspace,
      `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 1 --time-box 10 --generations 1`,
      300_000,
    );
    const runId = ran.runId;
    assert.ok(runId, `the answer names the run: ${ran.text}`);
    assert.equal(ran.kind, 'error', `the attempt failed, having written nothing it could record: ${ran.text}`);

    // Nothing was recorded, and — deliberately — no refusal either: the ledger is the thing that just
    // failed, so a second append is not where this promise is kept. It is kept by the bytes.
    assert.equal(ledger.records({ runId, type: 'code' }).length, 0, 'no code record was written');
    assert.equal(ledger.records({ runId, type: 'refusal' }).length, 0, 'and no refusal record either');

    const prepared = ledger.records({ runId, type: 'workspace' }).at(-1);
    assert.ok(prepared?.type === 'workspace', `the campaign workspace was prepared: ${JSON.stringify(prepared)}`);
    const at = path.join(await realpath(prepared.workspace), workshopDirectory, workshopEntry);

    // The bytes are still there, and nothing tried to take them away: the harness removes nothing on
    // a Site. One `tee` towards that path and no second command about it at all.
    const landed = await stat(at);
    assert.ok(landed.isFile(), `the file the moment wrote is still on the site: ${at}`);
    const sent = remoteCommands().filter((c) => c.argv.at(-1) === at);
    assert.deepEqual(sent.map((c) => c.argv[0]), ['tee'], `written and left alone: ${JSON.stringify(sent.map((c) => c.argv.join(' ')))}`);

    // The host log, at the moment of the failure. This is the operator's channel and the reason it is
    // written at all: the ledger is the thing that just failed, so the one place that could otherwise
    // have said where the bytes are is the one place that cannot be asked to.
    const logged = hostLog(host).filter((line) => line.includes(at));
    assert.equal(logged.length, 1, `one line about that path: ${JSON.stringify(hostLog(host).slice(-5))}`);
    assert.equal(
      logged[0],
      `hima: workshop ${workshopId} landed ${at} and the ledger would not record it: ${ledgerSaid}`,
      `naming the workshop, the path and the ledger's own words: ${logged[0]!}`,
    );

    // What the model was told, off its own session: the write did not stand, and why.
    const opened = ledger.records({ runId, type: 'session' })
      .find((r): r is SessionRecord => r.type === 'session' && r.event === 'opened');
    assert.ok(opened, 'the moment opened');
    const answered = await readPersistedSession(host.ctx, opened.sessionId, (agent) => toolResults(agent));
    const wrote = JSON.parse(answered.at(-1)!.text) as Record<string, unknown>;
    assert.equal(wrote.wrote, false, `the write answered that it did not stand: ${JSON.stringify(wrote)}`);
    assert.ok(String(wrote.reason).includes(at), `naming the path: ${JSON.stringify(wrote.reason)}`);
    assert.ok(String(wrote.reason).includes(ledgerSaid), `and the ledger's own words: ${JSON.stringify(wrote.reason)}`);

    // And the node the Run blocks at, once the moment has closed: a byte on the Site this Run cannot
    // account for is a person's to look at, and a retry would only write another one. A Hard blocker
    // and not a failed attempt, and it names the path rather than the ordinary "wrote no <entry>".
    const blocked = ledger.records({ runId, type: 'node' })
      .findLast((r) => r.type === 'node' && r.nodeId === workshopId && r.state === 'blocked');
    assert.ok(blocked?.type === 'node', `the node blocked: ${JSON.stringify(blocked)}`);
    assert.ok(blocked.reason?.includes(at), `naming the path the bytes are at: ${JSON.stringify(blocked.reason)}`);
    assert.ok(blocked.reason?.includes(ledgerSaid), `and why they could not be recorded: ${JSON.stringify(blocked.reason)}`);
  } finally {
    await host.dispose();
    await home.h.dispose();
  }
});


test('in process over the same home: a host log that throws where the landed byte is reported stops neither the tool\'s answer nor the fault the node blocks on', async (t) => {
  // The ordering the failure above depends on. Three tellings, and the third of them — the host log
  // — is a callback this module does not own: `FabricDeps.log` is the booted host's `ctx.logger.info`
  // and a logger has its own ways to fail. Called before the fault box was set, a throwing one took
  // the whole path with it: the model got a thrown tool result instead of `{ wrote: false, reason }`,
  // `fault.why` stayed unset, and the turn then read the ordinary "wrote no <entry>" failure and
  // spent a retry — a second moment writing a second unrecorded file beside the first.
  //
  // So the order is the rule: **the fault first**, then the answer, then the log inside its own try.
  // The log is best effort by nature; the fault is not, and nothing best effort may stand in front of
  // it. A log that throws is reported in the answer's reason, where the model reads it, and swallowed.
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  await replayMomentScenario(home.h, 'writes');
  const pack = await installWorkshopPack(packsDirOf(home.h));
  const host = await bootInProcess(home.h);
  const ledgerSaid = 'this ledger store will not take another record';
  const logSaid = 'this log exporter has nowhere to put that line';
  try {
    const ledger = host.ctx.hima.ledger;
    (ledger as unknown as { appendCode: () => Promise<never> }).appendCode = () => Promise.reject(new Error(ledgerSaid));
    breakHostLogOn(host, 'and the ledger would not record it', logSaid);

    const ran = await himaCommand(
      host,
      home.h.workspace,
      `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 1 --time-box 10 --generations 1`,
      300_000,
    );
    const runId = ran.runId;
    assert.ok(runId, `the answer names the run: ${ran.text}`);
    assert.equal(ran.kind, 'error', `the attempt failed: ${ran.text}`);

    const prepared = ledger.records({ runId, type: 'workspace' }).at(-1);
    assert.ok(prepared?.type === 'workspace', `the campaign workspace was prepared: ${JSON.stringify(prepared)}`);
    const at = path.join(await realpath(prepared.workspace), workshopDirectory, workshopEntry);

    // **The fault stood**, which is the whole of this test: the node blocks on the bytes it cannot
    // account for, and not on the ordinary "wrote no miner.sh" of a moment that wrote nothing.
    const blocked = ledger.records({ runId, type: 'node' })
      .findLast((r) => r.type === 'node' && r.nodeId === workshopId && r.state === 'blocked');
    assert.ok(blocked?.type === 'node', `the node blocked: ${JSON.stringify(blocked)}`);
    assert.ok(blocked.reason?.includes(at), `naming the path the bytes are at: ${JSON.stringify(blocked.reason)}`);
    assert.ok(blocked.reason?.includes(ledgerSaid), `and why they could not be recorded: ${JSON.stringify(blocked.reason)}`);

    // And the model's own answer came back as an answer rather than as a thrown tool, carrying both
    // failures: the one that matters and the one that happened while reporting it.
    const opened = ledger.records({ runId, type: 'session' })
      .find((r): r is SessionRecord => r.type === 'session' && r.event === 'opened');
    assert.ok(opened, 'the moment opened');
    const answered = await readPersistedSession(host.ctx, opened.sessionId, (agent) => toolResults(agent));
    const wrote = JSON.parse(answered.at(-1)!.text) as Record<string, unknown>;
    assert.equal(wrote.wrote, false, `the write answered that it did not stand: ${JSON.stringify(wrote)}`);
    assert.ok(String(wrote.reason).includes(at), `naming the path: ${JSON.stringify(wrote.reason)}`);
    assert.ok(String(wrote.reason).includes(ledgerSaid), `the ledger's own words: ${JSON.stringify(wrote.reason)}`);
    assert.ok(String(wrote.reason).includes(logSaid), `and the log's, since that is where they were going: ${JSON.stringify(wrote.reason)}`);

    // Exactly one moment: the fault stopped the node rather than spending the allowance on a second
    // one, which is what an unset fault box did.
    assert.equal(
      ledger.records({ runId, type: 'session' }).filter((r) => r.type === 'session' && r.event === 'opened').length,
      1,
      'one moment, not a retry that would land a second unrecorded file',
    );
  } finally {
    await host.dispose();
    await home.h.dispose();
  }
});


test('a workshop declaration this harness will not run is refused before a campaign exists, naming the field', async (t) => {
  const home = await createHimaHome();
  const flow = await writeStandinFlow(t, home);
  if (!flow) { await home.dispose(); return; }
  await installPack(home);
  await writeLocalSite(home, {
    allowedReadRoots: [home.workspace, flow.root],
    allowedWriteRoots: [home.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: home.workspace },
  });
  const h = await bootInProcess(home);
  try {
    const packsDir = packsDirOf(home);
    const good = await installWorkshopPack(packsDir, 'workshop-check-ok');
    const said = await himaCommand(h, home.workspace, `/hima pack check ${good} --site local`);
    assert.ok(
      said.text.includes(`${workshopId} — sh, writes ${workshopDirectory}/${workshopEntry}, produces candidates (read by ${packReaderId})`),
      `pack check prints the workshops line: ${said.text}`,
    );
    assert.ok(said.text.includes('workshops:'), `under its own heading: ${said.text}`);

    // Every way a declaration can be one no campaign of this pack could run, each refused with the
    // field it is wrong about in the sentence.
    const refusals: readonly (readonly [string, WorkshopVariation, RegExp])[] = [
      ['workshop-check-no-reader', { produces: 'synthesisLog' }, /produces "synthesisLog", which declares no reader/],
      ['workshop-check-wrapper', { argv: ['bash', '${ENTRY}'] }, /runs "bash", which environment\.wrappers does not declare/],
      ['workshop-check-climb', { directory: '../out' }, /the directory .{0,2}\.\.\/out.{0,2} names .{0,2}\.\..{0,2}, which is not a plain path segment/],
      ['workshop-check-flow', { directory: 'flow' }, /names the directory .{0,2}flow.{0,2}, and .{0,2}flow.{0,2} is the campaign workspace's own/],
      // The other directory the workspace anatomy owns: a workshop put there would have the model
      // writing over the scripts this pack's own readers are shipped as.
      ['workshop-check-readers', { directory: 'hima-readers' }, /names the directory .{0,2}hima-readers.{0,2}, and .{0,2}hima-readers.{0,2} is the campaign workspace's own/],
      ['workshop-check-knowledge', { knowledge: ['nowhere.md'] }, /knowledge file "nowhere\.md", which/],
      // A wrapper the contract *does* declare and the Site's own Permit refuses. Nothing at load can
      // catch this one — the contract is consistent with itself — so it is the case that says the
      // check really asks the Permit rather than only re-reading the contract.
      ['workshop-check-permit', { wrappers: ['tclsh'], argv: ['tclsh', '${ENTRY}'] }, /workshop "mine": "tclsh" is not an allowed wrapper of site local/],
      // A seat of a licence this Site does not declare: a job of this workshop could never launch
      // there, and saying so before a campaign exists is the whole of what the check is for.
      ['workshop-check-licence', { licences: { 'Some-Licence': 1 } }, /workshop "mine" holds 1 of "Some-Licence": site local does not declare it/],
      // The wrapper is a literal word or it is nothing: `checkPack` reads `argv[0]` as it stands and
      // the launch runs the word it substituted, so a placeholder there would be two different words.
      ['workshop-check-placeholder', { argv: ['${ENTRY}', '${WORKSPACE}'] }, /the first word of a workshop's argv is the wrapper itself/],
      // And a placeholder *inside* the first word is the same fault: the check judges `runner-${ENTRY}`
      // and the launch runs `runner-/…/miner.sh`, which are two different wrappers.
      ['workshop-check-wrapper-inside', { argv: ['runner-${ENTRY}', '${ENTRY}'] }, /the first word of a workshop's argv is the wrapper itself/],
      // **The command line is the wrapper, then the entry as its first operand, then the rest.** A
      // declaration that never names `${ENTRY}` launches something else while the launch record says
      // the entry's own hash is what ran; one that names it twice runs it as its own argument; and
      // one that names it anywhere but second hands the wrapper some other word to act on first,
      // which is the shape `sh -c '<program>' <entry>` has — an inline program the ledger holds no
      // record of, with the verified file as its `$0`. Position is what refuses that shape, and a
      // count alone cannot: the last of these passes the count.
      ['workshop-check-no-entry', { argv: ['sh', '-c', 'exit 0'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      ['workshop-check-entry-twice', { argv: ['sh', '${ENTRY}', '${ENTRY}'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      ['workshop-check-entry-late', { argv: ['sh', '${WORKSPACE}', '${ENTRY}'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      ['workshop-check-entry-inline', { argv: ['sh', '-c', 'exit 0', '${ENTRY}'] }, /a workshop's command line is the wrapper, then the entry as its first operand \(argv\[1\] is exactly \$\{ENTRY\}\), then the rest/],
      // **A name the harness binds itself, declared as this workshop's own.** `inputs` are the names
      // the *node* supplies, and a declaration listing one of the six the harness computes is a pack
      // asking for a value it will never be given — or, worse, asking to be given one instead of the
      // harness's, which is what the node-argument rule below refuses from the other side.
      // (A schema issue rather than a loader sentence, so the check prints it as the JSON zod made:
      // the quotes around the name come back escaped, and the pattern allows either spelling.)
      ['workshop-check-input-reserved', { inputs: ['WORKSHOP'] }, /declares the input \\?"WORKSHOP\\?", which the harness binds itself for a workshop/],
      // And the same class from the node's side: an argument bound at the act node under one of the
      // six. Left to run, `ENTRY: '-c'` would make `sh ${ENTRY} …` launch as `sh -c …` — an inline
      // program — while the launch record still carried the verified entry's path and hash.
      [
        'workshop-check-node-binds-entry',
        { graph: (id: string) => workshopGraph(id).replace(`      workshop: ${workshopId}`, `      workshop: ${workshopId}\n      arguments:\n        ENTRY: '-c'`) },
        /node "mine" binds "ENTRY", which the harness binds itself for a workshop/,
      ],
    ];
    for (const [id, vary, expected] of refusals) {
      await installWorkshopPack(packsDir, id, vary);
      const answer = await himaCommand(h, home.workspace, `/hima pack check ${id} --site local`);
      assert.match(answer.text, expected, `pack ${id} is refused naming the field: ${answer.text}`);
    }
  } finally {
    await h.dispose();
    await home.dispose();
  }
});


test('at the ledger object: a job whose launch record names its attempt is that attempt, whether or not a node record ever named its session', async (t) => {
  // The durable half of the launch-gap fix, proved where it is actually decided (#62, fix 2).
  //
  // A launch and the node record that names its session are two appends, the launch first. A host
  // that died between them left an attempt no node record could name, and `attemptOfSession` — which
  // is what a second process numbers its `reconciled` and `done` records with — then fell through to
  // `attemptOf`, one past the highest number any record carries, and settled an attempt-1 Job as
  // attempt 2. The launch record is where the attempt is actually in hand, so that is where it is now
  // written down and where it is now read from.
  //
  // Driven at the ledger rather than by racing a real restart into a window one append wide: the
  // driver test above takes the host away as close to that window as a poll can get and asserts what
  // survives it, which is the durable half; this is the reading itself, on a ledger holding exactly
  // the record such a host leaves behind. A session no node record names is the gap, stated rather
  // than raced for.
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  await replayMomentScenario(home.h, 'writes');
  const pack = await installWorkshopPack(packsDirOf(home.h));
  const host = await bootInProcess(home.h);
  try {
    const ran = await himaCommand(
      host,
      home.h.workspace,
      `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 3 --time-box 10 --generations 1`,
      300_000,
    );
    const runId = ran.runId;
    assert.ok(runId, `the answer names the run: ${ran.text}`);
    const ledger = host.ctx.hima.ledger;

    // The Run this is asked of: one attempt at the workshop node, with its own launch and its own
    // node records. Everything the node has said is attempt 1, so `attemptOf` — the last fall-back —
    // would answer 2 for anything it cannot place, which is what makes the two readings below
    // distinguishable at all.
    const nodes = ledger.records({ runId, type: 'node' }).filter((r) => r.type === 'node' && r.nodeId === workshopId);
    assert.ok(nodes.length > 0, `the workshop node took its turn: ${JSON.stringify(nodes.map((r) => r.type === 'node' ? r.state : ''))}`);
    assert.ok(nodes.every((r) => r.type === 'node' && r.attempt === 1), `all of it at attempt 1: ${JSON.stringify(nodes.map((r) => r.type === 'node' ? r.attempt : 0))}`);

    const job = (session: string) => ({
      session,
      pid: 4242,
      workspace: home.h.workspace,
      name: JOB_NAME,
      startedAt: new Date().toISOString(),
      wire: `tmux new-session -d -s ${session}`,
    });

    // The record a host that died in the gap leaves behind: a launch of this node's Job, carrying the
    // attempt it was launched for, and no node record anywhere naming its session.
    const inTheGap = 'hima-workshop-gap-1';
    await ledger.appendJob(runId, { event: 'launched', attempt: 1, nodeId: workshopId, job: job(inTheGap) });
    assert.ok(
      !ledger.records({ runId, type: 'node' }).some((r) => r.type === 'node' && r.jobSession === inTheGap),
      'no node record names that session, which is the gap itself',
    );
    assert.equal(attemptOfSession(ledger, runId, workshopId, inTheGap), 1,
      'the launch record says which attempt its job belongs to, and that is the answer');

    // And the fall-back the doc comment promises, for the ledgers written before this field existed:
    // the same launch with no `attempt` on it is placed by the node records, and a session none of
    // them names falls through to `attemptOf` — one past the highest, which is 2 here. That is the
    // wrong answer for a real gap, and it is exactly why the launch is read first.
    const legacy = 'hima-workshop-gap-2';
    await ledger.appendJob(runId, { event: 'launched', nodeId: workshopId, job: job(legacy) });
    assert.equal(attemptOfSession(ledger, runId, workshopId, legacy), 2,
      'a launch record with no attempt on it falls back to the node records, and then to one past the highest');
  } finally {
    await host.dispose();
    await home.h.dispose();
  }
});


test('in process over the same home: the moment of a retry is given the reason the attempt before it failed and the tail of that attempt\'s log', async (t) => {
  // What the live check of 2026-09-12 found. A real model wrote an honest miner, the job exited 1
  // because nothing on the flow said what to count, and the retry opened with the same instructions
  // as the first attempt — so it could only guess at the same thing again. A retry is now composed
  // with what the attempt before it did, read off that attempt's own node record and its job's log.
  //
  // At the in-process seam and not through the window, because what is asserted is the *system
  // prompt* of a session that is over, which is read off the persisted session through dsh's own
  // agent registry (`readPersistedSession`) — and the host that holds it has to be one this process
  // can reach.
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const scenario = await replayMomentScenario(home.h, 'failing');
  assert.equal(scenario.children.length, 3, `the scenario carries a child log per moment after the first: ${JSON.stringify(scenario.children)}`);
  const pack = await installWorkshopPack(packsDirOf(home.h));
  const host = await bootInProcess(home.h);
  try {
    const ran = await himaCommand(
      host,
      home.h.workspace,
      `/hima run ${pack} --site local --goal target_period_ns=2.0 --set periodNs=2.0 --retries 3 --time-box 10 --generations 1`,
      300_000,
    );
    for (const line of ran.text.split('\n')) t.diagnostic(line);
    assert.equal(ran.kind, 'error', `three failing attempts block the node: ${ran.text}`);
    const runId = ran.runId;
    assert.ok(runId, `the answer names the run: ${ran.text}`);

    const sessions = host.ctx.hima.ledger.records({ runId, type: 'session' })
      .filter((r): r is SessionRecord => r.type === 'session' && r.event === 'opened');
    assert.deepEqual(sessions.map((r) => r.attempt), [1, 2, 3], `three moments, one per attempt: ${JSON.stringify(sessions.map((r) => r.attempt))}`);

    const first = await readPersistedSession(host.ctx, sessions[0]!.sessionId, systemPromptOf);
    assert.ok(first, 'the first moment\'s own instructions were recorded on its session');
    assert.ok(!first.includes('What the previous attempt did:'), `attempt 1 has no attempt before it: ${first.slice(0, 400)}`);

    const retry = await readPersistedSession(host.ctx, sessions[1]!.sessionId, systemPromptOf);
    assert.ok(retry, 'the second moment\'s instructions were recorded on its session');
    assert.ok(retry.includes('What the previous attempt did:'), `the retry is told what happened before it: ${retry}`);
    assert.ok(/attempt 1: .*exited 3/.test(retry), `naming the attempt and what its job exited with: ${retry}`);
    assert.ok(retry.includes('the mining stage found no netlist to read'), `and holding that job's own last line: ${retry}`);
  } finally {
    await host.dispose();
    await home.h.dispose();
  }
});
