// Ticket #21: a licence is one of the Site's slots, taken and counted exactly as a Job slot is.
//
// A Site declares how many of each licence it has (`capacity.licences`); a pack's contract declares
// how many of each a Job of one of its tools holds (`tools[].licences`). A launch that would take
// more of a licence than the Site declares waits for one, with the same `waiting-for-slot` record,
// the same run-view flag and the same wake-up the parallel job cap uses — one cap, whose slots are
// the Site's parallel Job count and each of its declared licences. What every Job held is on its
// `launched` record, and what a Run spent is on its meters.
//
// A licence the Site does not declare, or declares none of, is caught before a Campaign exists:
// `/hima pack check` says unfit naming it, and `/hima run` answers the same, because a Run that
// launched such a Job could only wait for a slot that will never come free.
//
// Local site and the stand-in flow only; the reference site is #31. Both seams: the booted host and
// its routes for what a person sees of a Run, and the in-process host for the two command faces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  jobRecords,
  killSessions,
  localFabric,
  localHome,
  nodeRecords,
  ONE_GENERATION,
  runOf,
  sessionsOf,
} from './support/fabric.ts';
import { bootHimaHost, type BootedHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import type { NodeRecord, RunView } from '@hima/harness';

/** The line the shipped contract gives its Design Compiler tool, and what a variant makes of it: one
 *  seat of a licence the local site can be told to declare however many of. */
const shippedLicenceLine = '    licences:\n      Design-Compiler: 1';
const variantLicenceLine = '    licences:\n      synopsys: 1';

/** The shipped pack again, holding one `synopsys` seat instead of the Design Compiler one. */
async function writeSynopsysPack(packsDir: string, id: string): Promise<string> {
  const varied = await writePackVariant(packsDir, id, [[shippedLicenceLine, variantLicenceLine]]);
  assert.match(varied, /^ {6}synopsys: 1$/m, 'the shipped contract is the one being varied');
  return varied;
}

test('a licence bounds a launch the way the job cap does: a second run waits for the one seat the site declares, on a site with a free job slot', async (t) => {
  // Two job slots and one licence seat, so what holds the second Run back is unambiguously the
  // licence and not the parallel Job count. Six seconds of stand-in synthesis, so the wait is real,
  // and a two-minute box so a Run queued behind a licence nothing enforced ends on its own rather
  // than on this command's timeout.
  const home = await localHome(t, { sleepSeconds: 6, parallelJobs: 2, licences: { synopsys: 1 } });
  if (!home) return;
  const { h } = home;
  let host: BootedHost | undefined;
  let sessions: string[] = [];
  /** What the host exited with, taken in `finally` and held against 0 after it. Asserting it inside
   *  the `finally` would mask a failure in the body: a host that exits non-zero while an assertion
   *  above it has already thrown replaces that failure with its own. */
  let hostExit: number | null | undefined;
  try {
    await writeSynopsysPack(packsDirOf(h), 'licence-probe');
    host = await bootHimaHost(h);
    const cookie = await openSession(host);
    const start = (): Promise<Response> => api(host!, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: 'licence-probe', site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, timeBox: 2, generations: 1 }),
      headers: { 'content-type': 'application/json' },
    });

    const first = start();
    // Long enough that the first Run has certainly prepared its workspace and taken the seat, and
    // far short of the six seconds it then holds it for.
    await new Promise((r) => setTimeout(r, 2_000));
    const second = start();
    const views = await Promise.all([first, second].map(async (p) => {
      const answered = await p;
      const text = await answered.text();
      assert.equal(answered.status, 200, text);
      return JSON.parse(text) as RunView;
    }));
    sessions = views.flatMap((v) => v.jobs.filter((j) => j.event === 'launched').map((j) => j.job.session));

    for (const view of views) {
      assert.equal(view.run.status, 'ended-budget-exhausted', 'both runs completed the one generation they were allowed');
      assert.deepEqual(view.run.budget?.licences, { synopsys: 1 }, 'each under the licence counts the site declares');
      assert.equal(view.run.budget?.jobCap, 2, 'and under a job cap that was never what held either of them');
    }

    // What each Job held is on its own `launched` record, from the pack's contract.
    for (const view of views) {
      const launched = view.jobs.filter((j) => j.event === 'launched');
      assert.equal(launched.length, 1, `one job per run: ${JSON.stringify(launched.map((j) => j.job.session))}`);
      assert.deepEqual(launched[0]!.licences, { synopsys: 1 }, 'the launched record carries what the job holds');
    }

    // Which one waited is read from the node records — the whole path, one record per transition —
    // rather than from the run view's one-entry-per-node, which carries the state each node is in now.
    const paths = await Promise.all(views.map(async (view) => {
      const answered = await api(host!, cookie, `/hima/api/runs/${view.run.id}/records?type=node`);
      const text = await answered.text();
      assert.equal(answered.status, 200, text);
      return (JSON.parse(text) as { records: NodeRecord[] }).records;
    }));
    const queuedAt = paths.findIndex((records) => records.some((r) => r.state === 'waiting-for-slot'));
    assert.equal(
      paths.filter((records) => records.some((r) => r.state === 'waiting-for-slot')).length,
      1,
      'exactly one of the two waited for the seat; the other had it',
    );
    const waitedRecord = paths[queuedAt]!.find((r) => r.state === 'waiting-for-slot')!;
    t.diagnostic(`the queued run waited: ${waitedRecord.reason ?? ''}`);
    assert.match(waitedRecord.reason ?? '', /licence of "synopsys"/, JSON.stringify(waitedRecord));
    assert.doesNotMatch(waitedRecord.reason ?? '', /against a cap of/, `the job cap is not what held it: ${waitedRecord.reason ?? ''}`);
    assert.deepEqual(
      paths[queuedAt]!.filter((r) => r.nodeId === 'synthesize').map((r) => r.state),
      ['waiting-for-slot', 'running', 'done'],
      'it waited, then launched, then finished: waiting for a licence is not a failed attempt',
    );
    assert.equal(waitedRecord.attempt, 1, 'and it is still the node\'s first attempt');

    // The run view says the node waited, after the fact — the same flag the job cap sets, because
    // this is the same wait.
    const queuedView = views[queuedAt]!;
    const held = views[1 - queuedAt]!;
    assert.equal(queuedView.nodes.find((n) => n.nodeId === 'synthesize')!.waitedForSlot, true, 'the run view says it waited for a slot');
    assert.equal(
      held.nodes.find((n) => n.nodeId === 'synthesize')!.waitedForSlot,
      undefined,
      'the run that had the seat never waited, and says so by omission',
    );

    // And the seat really was exclusive: the queued Run's Job did not start until the other's had
    // ended, though the Site had a second job slot free the whole time.
    const releasedAt = held.jobs.find((j) => j.event === 'finished')!.at;
    const launchedAt = queuedView.jobs.find((j) => j.event === 'launched')!.at;
    t.diagnostic(`the seat was released at ${releasedAt} and the queued run launched at ${launchedAt}`);
    assert.ok(
      Date.parse(launchedAt) >= Date.parse(releasedAt),
      `the queued run launched at ${launchedAt}, before the seat was released at ${releasedAt}`,
    );

    // And what each Run spent of the licence is on its meters: one seat for the whole of its Job.
    for (const view of views) {
      const spent = view.run.meters?.licenceMs?.synopsys;
      t.diagnostic(`run ${view.run.id} held synopsys for ${String(spent)} ms of ${String(view.run.meters?.elapsedMs)} ms elapsed`);
      assert.ok((spent ?? 0) >= 5_000, `the meters carry the licence its job held: ${JSON.stringify(view.run.meters)}`);
      assert.ok((spent ?? 0) <= (view.run.meters?.elapsedMs ?? 0), `and no more than the run has been open: ${JSON.stringify(view.run.meters)}`);
    }
  } finally {
    killSessions(sessions);
    if (host) hostExit = await host.stop();
    await h.dispose();
  }
  assert.equal(hostExit, 0, `host exited ${String(hostExit)}\n${host?.stderr() ?? ''}`);
});

test('a pack whose tool holds a licence the site does not declare is unfit, and the run is refused before anything is launched', async (t) => {
  // The site declares no licence at all — the local site's own default is what a machine with no
  // seats to budget looks like. Caught where every other thing a Site cannot host is caught: before
  // a workspace, a seat and two and a half minutes of Design Compiler.
  const local = await localFabric(t, { licences: {} });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writeSynopsysPack(packsDirOf(h), 'wants-synopsys');
    const checked = await himaCommand(host, h.workspace, '/hima pack check wants-synopsys --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /^pack wants-synopsys@2 on site local: unfit\b/, checked.text);
    assert.match(checked.text, /tool "synth" holds 1 of "synopsys": site local does not declare it; add it under capacity\.licences:/, checked.text);

    const ran = await himaCommand(host, h.workspace, '/hima run wants-synopsys --site local --goal target_period_ns=2.0 --set periodNs=2.0', siteCommandTimeoutMs);
    for (const line of ran.text.split('\n')) t.diagnostic(line);
    assert.equal(ran.kind, 'error', ran.text);
    assert.match(ran.text, /^pack wants-synopsys@2 on site local: unfit\b/, ran.text);
    assert.match(ran.text, /site local does not declare it/, ran.text);
    assert.deepEqual(
      host.ctx.hima.ledger.runs().flatMap((r) => sessionsOf(host, r.id)),
      [],
      'nothing was launched: an unfit pack is refused before a Run is opened at all',
    );
  } finally {
    await dispose();
  }
});

test('a site that declares none of a licence can never host a tool that holds it, and says so rather than letting a run wait for ever', async (t) => {
  // The reference site's own Innovus line: an uncounted node-locked tool has no seats to budget, so
  // nothing may be reserved. A Run of a pack that reserved one would sit in `waiting-for-slot` until
  // its time box ran out, which is a slow way of saying what the check can say at once.
  const local = await localFabric(t, { licences: { synopsys: 0 } });
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    await writeSynopsysPack(packsDirOf(h), 'reserves-none');
    const checked = await himaCommand(host, h.workspace, '/hima pack check reserves-none --site local');
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'error', checked.text);
    assert.match(checked.text, /^pack reserves-none@2 on site local: unfit\b/, checked.text);
    assert.match(
      checked.text,
      /tool "synth" holds 1 of "synopsys": site local declares 0 of it, so a job of this tool could never launch there/,
      checked.text,
    );
  } finally {
    await dispose();
  }
});

test('the shipped pack declares the seat its Design Compiler tool holds, and the local site declares one to give it', async (t) => {
  // The pack the repository ships, on the site the suite proves everything else on: the licence a
  // synthesis holds is now part of the contract, and a check that did not know about it would say
  // this pack no longer fits anywhere.
  const local = await localFabric(t);
  if (!local) return;
  const { h, host, dispose } = local;
  try {
    const checked = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site local`);
    for (const line of checked.text.split('\n')) t.diagnostic(line);
    assert.equal(checked.kind, 'success', checked.text);
    assert.match(checked.text, /^pack opene902-timing-probe@2 on site local: fit\b/, checked.text);
    assert.match(checked.text, /^ {2}synth holds 1 of "Design-Compiler": site local declares 1$/m, checked.text);

    // And what a person is told about a Run of it: the seats the Site declared, and the licence its
    // one Job held, on the same status the run ends with.
    const ran = await himaCommand(host, h.workspace, `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.0 --set periodNs=2.0 ${ONE_GENERATION}`, siteCommandTimeoutMs);
    for (const line of ran.text.split('\n')) t.diagnostic(line);
    assert.equal(ran.kind, 'success', ran.text);
    const runId = ran.runId!;
    killSessions(sessionsOf(host, runId));
    assert.match(ran.text, /^ {2}budget: .*at most 1 generation, .*licences Design-Compiler 1$/m, ran.text);
    assert.match(ran.text, /^ {4}Design-Compiler 0 seats of 1 declared, held for \d[\d.]* (?:ms|s|min)$/m, ran.text);
    assert.match(ran.text, /^ {4}ended by the generation limit$/m, ran.text);
    assert.match(ran.text, /^ {4}synthesize \(act\): done, attempt 1, session \S+ holding Design-Compiler 1$/m, ran.text);

    const launched = jobRecords(host, runId).filter((r) => r.event === 'launched');
    assert.equal(launched.length, 1, 'one job');
    assert.deepEqual(launched[0]!.licences, { 'Design-Compiler': 1 }, 'which held the seat the contract declares');
    assert.deepEqual(
      nodeRecords(host, runId).filter((r) => r.state === 'waiting-for-slot'),
      [],
      'and nothing waited: the site declares as many seats as it has job slots',
    );
    const meters = runOf(host, runId).meters;
    assert.ok((meters?.licenceMs?.['Design-Compiler'] ?? 0) > 0, `the run's meters carry what it held: ${JSON.stringify(meters)}`);
  } finally {
    await dispose();
  }
});
