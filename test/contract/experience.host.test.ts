// PLS-07 L2: original report content/hash/restart cases through the real Host and local files.
// Window-only assertions remain in experience.test.ts; see the assessment mapping.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootHimaHost } from './support/boot-host.ts';
import type { HimaHome } from './support/dsh-home.ts';
import { killSessions, localFabric, localHome, sessionsOf } from './support/fabric.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { api, openSession } from './support/hima-api.ts';
import { installOverConstraining, packsDirOf, timingProbePackId } from './support/pack.ts';
import { reportBlocks } from '@hima/harness';
import type { ExperienceAnswer, ExperienceJson, HimaErrorBody, JobRecord, LedgerRecord, RunView } from '@hima/harness';

/** Existing production launcher and session handshake, without a window or driver emulator. */
async function bootReportHost(t: TestContext, opts: { existing?: HimaHome; sleepSeconds?: number; failures?: number } = {}) {
  const local = opts.existing === undefined ? await localHome(t, { sleepSeconds: opts.sleepSeconds ?? 0.01, failures: opts.failures ?? 0 }) : { h: opts.existing };
  if (!local) return undefined;
  const host = await bootHimaHost(local.h);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    assert.equal(await host.stop(), 0, host.stderr());
  };
  return { home: local.h, host, cookie: await openSession(host), close,
    dispose: async () => { await close(); if (opts.existing === undefined) await local.h.dispose(); } };
}

async function latestRunId(host: { readonly url: string }, cookie: string): Promise<string> {
  let id: string | undefined;
  await until('a Run appeared on the Host list', async () => {
    const answer = await api(host, cookie, '/hima/');
    assert.equal(answer.status, 200);
    id = /run-[0-9a-f-]+/.exec(await answer.text())?.[0];
    return id !== undefined;
  });
  return id!;
}

/** Poll until something the routes say is true, or fail saying what never happened. */
async function until(what: string, probe: () => Promise<boolean>, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() >= deadline) throw new Error(`${what} did not happen within ${String(timeoutMs)} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** The hash the record claims, computed the way the harness computes it: over the file's bytes. */
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Every record of one Run, exactly as the ledger holds it, over the route the window reads. */
async function recordsOf(host: { readonly url: string }, cookie: string, runId: string): Promise<LedgerRecord[]> {
  const answer = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/records`);
  const text = await answer.text();
  assert.equal(answer.status, 200, text);
  return (JSON.parse(text) as { readonly records: LedgerRecord[] }).records;
}

/** Start a Campaign over the route that answers when the Run has stopped, and hand back the Run it
 *  left behind — which for every ending here is a Run that has its report. */
async function startRun(host: { readonly url: string }, cookie: string, body: Readonly<Record<string, unknown>>): Promise<RunView> {
  const started = await api(host, cookie, '/hima/api/runs', {
    method: 'POST',
    body: JSON.stringify({ pack: timingProbePackId, site: 'local', ...body }),
    headers: { 'content-type': 'application/json' },
  });
  const text = await started.text();
  assert.equal(started.status, 200, text);
  return JSON.parse(text) as RunView;
}

/**
 * The whole report of an ended Run, read off the Site itself and held against the record.
 *
 * Read where the record says it is — this suite's Site is this machine, so the Site's own path is a
 * path the test can open — because the record pointing at what is actually there is half of what an
 * experience record is for.
 */
async function reportOf(view: RunView): Promise<{ readonly markdown: string; readonly json: ExperienceJson }> {
  const experience = view.experience;
  assert.ok(experience, `the ended run carries its experience: ${JSON.stringify(view.run)}`);
  const markdown = await readFile(experience.markdown.path);
  const json = await readFile(experience.json.path);
  assert.equal(sha256(markdown), experience.markdown.sha256, 'the markdown on the site is the one the record hashed');
  assert.equal(markdown.byteLength, experience.markdown.bytes, 'and the size the record states');
  assert.equal(sha256(json), experience.json.sha256, 'the json on the site is the one the record hashed');
  assert.equal(json.byteLength, experience.json.bytes, 'and the size the record states');
  return { markdown: markdown.toString('utf8'), json: JSON.parse(json.toString('utf8')) as ExperienceJson };
}

test('a Campaign that met its goal leaves both report files on the site, with their hashes on the ledger and every number the card showed in the json', async (t) => {
  const d = await bootReportHost(t, {});
  if (!d) return;
  try {
    const { host, cookie } = d;

    // 2.35 ns meets setup but misses the 2.30 ns goal; the shipped method steps to 2.30,
    // where both setup and goal pass. Two generations still exercise the report rows.
    const view = await startRun(host, cookie, { goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.35 } });
    assert.equal(view.run.status, 'ended-goal-met', JSON.stringify(view.run));
    const runId = view.run.id;

    const experience = view.experience;
    assert.ok(experience, `the ended run carries its experience: ${JSON.stringify(view.run)}`);
    // Under the Campaign workspace, beside the results, and named for the Run (D44, D19). Resolved,
    // because a Permit decides a write on the path the Site really has and records that one.
    const under = path.join(await realpath(d.home.workspace), view.run.campaignId, 'hima-experience');
    assert.equal(experience.markdown.path, path.join(under, `${runId}.md`), JSON.stringify(experience));
    assert.equal(experience.json.path, path.join(under, `${runId}.json`), JSON.stringify(experience));

    const { markdown, json } = await reportOf(view);

    // The record on the ledger says the same two files, and says it once.
    const records = await recordsOf(host, cookie, runId);
    const written = records.filter((r) => r.type === 'experience');
    assert.equal(written.length, 1, `one experience record and no more: ${JSON.stringify(written)}`);
    assert.deepEqual(
      { markdown: written[0]!.markdown, json: written[0]!.json, writtenAt: written[0]!.writtenAt },
      { markdown: experience.markdown, json: experience.json, writtenAt: experience.writtenAt },
      'the run view carries the record, not a second account of it',
    );

    // The machine's file reproduces every number the card's generations table showed.
    assert.deepEqual(json.generations, view.generations, 'the json is the card\'s own generations, row for row');
    assert.equal(json.runId, runId);
    assert.equal(json.campaignId, view.run.campaignId);
    assert.equal(json.site, 'local');
    assert.equal(json.pack.id, timingProbePackId);
    assert.ok(json.pack.version !== '', `the pack version the campaign ran: ${JSON.stringify(json.pack)}`);
    assert.deepEqual(json.goal, { target_period_ns: 2.30 });
    assert.deepEqual(json.budget, view.run.budget);
    assert.deepEqual(json.meters, view.run.meters);
    assert.equal(json.ending.status, 'ended-goal-met');
    assert.equal(json.ending.reason, 'goal met', JSON.stringify(json.ending));
    assert.deepEqual(json.path, view.nodes, 'the path it took to get there');

    // The person's file names the pack and version, the site and the run id, and has one row per
    // generation.
    assert.ok(markdown.startsWith('# '), `the markdown opens with its heading: ${markdown.slice(0, 80)}`);
    assert.ok(markdown.includes(`${json.pack.id}@${json.pack.version}`), `it names the pack and version: ${markdown}`);
    assert.ok(markdown.includes('| site | local |'), `it names the site in its own row of the facts: ${markdown}`);
    assert.ok(markdown.includes(runId), 'it names the run id');
    for (const row of view.generations) {
      // The generation's own row of the report's table, holding what it asked the flow for — the
      // whole Strategy, in the pack's own words (#58) — and the clock period it measured, in the
      // card's own column.
      assert.ok(
        markdown.includes(`| ${String(row.generation)} | clock period ${String(row.strategy.periodNs)} ns → ${String(row.observedPeriodNs)} |`),
        `one row per generation, generation ${String(row.generation)}: ${markdown}`,
      );
    }

    assert.equal(json.schema, 'hima-experience/2');
    if (json.schema !== 'hima-experience/2') throw new Error('new reports use schema 2');
    assert.equal(json.research.conclusion, 'goal-supported');
    assert.ok(json.research.trials.every((trial) => trial.status === 'judged'));
    assert.equal(json.research.environment.toolVersions, 'not recorded');
  } finally {
    await d.dispose();
  }
});

test('a Campaign that stopped learning writes the convergence rule into both files as the reason it ended', async (t) => {
  const d = await bootReportHost(t, {});
  if (!d) return;
  try {
    const { host, cookie } = d;

    // 2.00 ns is tighter than this flow can ever close at. The pack varied onto
    // `over-constraining-push` (#54), because the reference pack's own chooser reaches no ending on a
    // stand-in that reports no margin for a met period: the first generation misses by 0.20, which
    // states that the design closes at 2.20, so the exploration asks for one step less — 2.15 — and
    // asks for the same 2.15 again, which is a move of nothing and what this pack calls converged.
    const honest = await installOverConstraining(packsDirOf(d.home), 'over-constraining-probe');
    const view = await startRun(host, cookie, { pack: honest, goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } });
    assert.equal(view.run.status, 'ended-converged', JSON.stringify(view.run));
    const { markdown, json } = await reportOf(view);

    assert.equal(json.ending.status, 'ended-converged');
    assert.equal(json.ending.endedBy, undefined, 'no meter ended it: the exploration did');
    assert.equal(
      json.ending.reason,
      'converged: period moved by less than 0.05 over 1 generation, at 2.15 then 2.15',
      'the reason is the decision, whole, in the words the card says it in',
    );
    assert.equal(json.generations.length, 3, 'three generations to say so');
    assert.ok(markdown.includes(`ended — converged: ${json.ending.reason}.`), `the person's file says it on its first line: ${markdown}`);
  } finally {
    await d.dispose();
  }
});

test('a Campaign a Budget meter ended names that meter in its report, whichever meter it was', async (t) => {
  const d = await bootReportHost(t, {});
  if (!d) return;
  try {
    const { host, cookie } = d;

    // The generation limit: the same unreachable goal, allowed two generations instead of six, so a
    // meter and not the exploration is what ends the Campaign.
    const limited = await startRun(host, cookie, { goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, generations: 2 });
    assert.equal(limited.run.status, 'ended-budget-exhausted', JSON.stringify(limited.run));
    const limitedReport = await reportOf(limited);
    assert.equal(limitedReport.json.ending.endedBy, 'generation-limit');
    assert.equal(limitedReport.json.ending.reason, 'the generation limit ran out');
    assert.equal(limitedReport.json.generations.length, 2, 'and the two generations it did open');
    assert.ok(
      limitedReport.markdown.includes('ended — budget exhausted: the generation limit ran out.'),
      `the person's file names the meter: ${limitedReport.markdown}`,
    );

    // The time box: a box of 60 ms, which is spent before the first node takes its turn. The
    // Campaign has its workspace and no generation's worth of records, and is still a Campaign whose
    // experience says what became of it.
    const boxed = await startRun(host, cookie, { goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, timeBox: 0.001 });
    assert.equal(boxed.run.status, 'ended-budget-exhausted', JSON.stringify(boxed.run));
    const boxedReport = await reportOf(boxed);
    assert.equal(boxedReport.json.ending.endedBy, 'time-box');
    assert.equal(boxedReport.json.ending.reason, 'the time box ran out');
    assert.equal(boxedReport.json.budget?.timeBoxMs, 60, JSON.stringify(boxedReport.json.budget));
    assert.ok(
      boxedReport.markdown.includes('ended — budget exhausted: the time box ran out.'),
      `and so does this one: ${boxedReport.markdown}`,
    );
  } finally {
    await d.dispose();
  }
});

/** How long each stand-in synthesis sleeps in the cancel test: long enough to stop one mid-Job. */
const CANCELLED_SYNTH_SECONDS = 10;

test('a Campaign a person stopped writes its report at the cancel, with what was observed to stop as the reason', async (t) => {
  const d = await bootReportHost(t, { sleepSeconds: CANCELLED_SYNTH_SECONDS });
  if (!d) return;
  let sessions: string[] = [];
  try {
    const { host, cookie } = d;

    // Started and not awaited: this route answers when the Run stops, and the whole subject here is
    // stopping it while its first generation is still sleeping on the Site.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await latestRunId(host, cookie);
    await until('the campaign launched its first synthesis', async () => {
      const records = await recordsOf(host, cookie, runId);
      sessions = records.filter((r) => r.type === 'job' && r.event === 'launched').map((r) => (r as JobRecord).job.session);
      return sessions.length > 0;
    });

    const cancelled = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    const cancelledText = await cancelled.text();
    assert.equal(cancelled.status, 200, cancelledText);
    const view = JSON.parse(cancelledText) as RunView;
    assert.equal(view.run.status, 'cancelled', cancelledText);
    await starting.catch(() => undefined);

    const { markdown, json } = await reportOf(view);
    assert.equal(json.ending.status, 'cancelled');
    assert.equal(json.ending.endedBy, 'cancel');
    assert.equal(json.ending.reason, `the kill was observed: tmux session ${sessions[0]!} is gone`, JSON.stringify(json.ending));
    assert.equal(json.cancels.length, 1, 'the request a person made is in the report');
    // One report and one record, though two faces reached this ending at once: the drive holding the
    // Job stopped where it stood, and the cancel wrote the ending.
    const records = await recordsOf(host, cookie, runId);
    assert.equal(records.filter((r) => r.type === 'experience').length, 1, 'one experience record and no more');
    assert.ok(markdown.includes('## The cancels'), `and the person's file has it in a section of its own: ${markdown}`);
    assert.ok(markdown.includes(json.ending.reason), 'saying what was observed to stop');
  } finally {
    killSessions(sessions);
    await d.dispose();
  }
});

test('a second host on the same home re-serves the report it finds rather than writing a second one', async (t) => {
  const first = await bootReportHost(t, {});
  if (!first) return;
  let second: Awaited<ReturnType<typeof bootReportHost>>;
  try {
    const { host, cookie } = first;

    const view = await startRun(host, cookie, { goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.35 } });
    assert.equal(view.run.status, 'ended-goal-met', JSON.stringify(view.run));
    const runId = view.run.id;
    const experience = view.experience;
    assert.ok(experience, `the first host wrote the report: ${JSON.stringify(view.run)}`);
    // When the file was last written, to the millisecond: a report written a second time would move
    // this, whatever it wrote.
    const written = (await stat(experience.markdown.path)).mtimeMs;

    // The window goes away, and with it the host that wrote the report. A second shell on the same
    // home reconciles every Run it finds — including this one, which is over.
    await first.close();

    second = await bootReportHost(t, { existing: first.home });
    assert.ok(second, 'the second boot answered');
    const later = second.host;
    const laterCookie = second.cookie;

    // The same record, and only one of it.
    const records = await recordsOf(later, laterCookie, runId);
    const written2 = records.filter((r) => r.type === 'experience');
    assert.equal(written2.length, 1, `one experience record and no more: ${JSON.stringify(written2)}`);
    assert.equal((await stat(experience.markdown.path)).mtimeMs, written, 'the file on the site was not written again');

    // And the route answers with the very files the first host wrote, read back off the Site and
    // held against the hashes it recorded.
    const answered = await api(later, laterCookie, `/hima/api/runs/${encodeURIComponent(runId)}/experience`);
    const answeredText = await answered.text();
    assert.equal(answered.status, 200, answeredText);
    const served = JSON.parse(answeredText) as ExperienceAnswer;
    assert.deepEqual(served.experience, experience, 'the same record, hashes and all');
    assert.equal(sha256(Buffer.from(served.markdown, 'utf8')), experience.markdown.sha256, 'and the file it read back is the one that hash is of');
    assert.equal(served.report.runId, runId);
    assert.equal(served.report.writtenAt, experience.writtenAt, 'the report still states the instant the first host wrote it');
  } finally {
    if (second) await second.dispose();
    await first.dispose();
  }
});

test('the report is served as markdown to a session that has one, refused to a caller with none, refused outright once the file has changed under it, and answered as a site fault once the file is gone', async (t) => {
  const d = await bootReportHost(t, {});
  if (!d) return;
  try {
    const { host, cookie } = d;

    const view = await startRun(host, cookie, { goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.35 } });
    assert.equal(view.run.status, 'ended-goal-met', JSON.stringify(view.run));
    const runId = view.run.id;
    const experience = view.experience;
    assert.ok(experience, `the ended run carries its experience: ${JSON.stringify(view.run)}`);
    const target = `/hima/api/runs/${encodeURIComponent(runId)}/experience.md`;

    // The document itself, as a document.
    const served = await api(host, cookie, target);
    const markdown = await served.text();
    assert.equal(served.status, 200, markdown);
    assert.equal(served.headers.get('content-type'), 'text/markdown; charset=utf-8', markdown);
    assert.equal(sha256(Buffer.from(markdown, 'utf8')), experience.markdown.sha256, 'the file the site holds, byte for byte');

    // Behind the same fence as every other route (ADR-0002).
    const refused = await fetch(new URL(target, host.url));
    const refusedText = await refused.text();
    assert.equal(refused.status, 401, refusedText);
    assert.equal((JSON.parse(refusedText) as HimaErrorBody).error.code, 'hima/not-authorized', refusedText);

    // Somebody edits the report on the Site. It is no longer the file the Campaign wrote, so it is
    // not served as one — by either route, and with both hashes named.
    const changed = `${markdown}\nsomebody wrote this line afterwards\n`;
    await writeFile(experience.markdown.path, changed, 'utf8');
    const found = sha256(Buffer.from(changed, 'utf8'));
    for (const route of [target, `/hima/api/runs/${encodeURIComponent(runId)}/experience`]) {
      const answered = await api(host, cookie, route);
      const text = await answered.text();
      assert.equal(answered.status, 409, text);
      const body = JSON.parse(text) as HimaErrorBody;
      assert.equal(body.error.code, 'hima/experience-changed', text);
      assert.ok(body.error.message.includes(found), `it names what the file hashes to now: ${text}`);
      assert.ok(body.error.message.includes(experience.markdown.sha256), `and what the record has: ${text}`);
    }

    // The Host page labels a recomposed preview even when the saved file no longer verifies.
    const page = await api(host, cookie, `/hima/?run=${encodeURIComponent(runId)}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /current preview from recorded facts, not the saved file/);
    assert.match(html, /data-hima-state-source="ledger-preview"/);

    // A file the Site will not give up at all — this one is gone — is not a report that changed:
    // nobody read it, so nobody knows what it says. That is a fact about a machine, and it is
    // answered the way every Site fault in this namespace is (#18), never as evidence that moved.
    await rm(experience.markdown.path);
    for (const route of [target, `/hima/api/runs/${encodeURIComponent(runId)}/experience`]) {
      const answered = await api(host, cookie, route);
      const text = await answered.text();
      assert.equal(answered.status, 503, text);
      const body = JSON.parse(text) as HimaErrorBody;
      assert.equal(body.error.code, 'hima/site-unreadable', text);
      assert.ok(body.error.message.includes(experience.markdown.path), `naming the file the site would not give up: ${text}`);
    }
  } finally {
    await d.dispose();
  }
});

test('a run whose ending stood while the site refused the report is finished by the next host, which writes it from records that have not moved', async (t) => {
  const first = await bootReportHost(t, {});
  if (!first) return;
  let second: Awaited<ReturnType<typeof bootReportHost>>;
  let inTheWay: string | undefined;
  try {
    const { host, cookie } = first;

    // Started and not awaited: the ending is going to be answered with a fault, and the subject here
    // is what the ledger holds afterwards.
    const starting = api(host, cookie, '/hima/api/runs', {
      method: 'POST',
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.35 } }),
      headers: { 'content-type': 'application/json' },
    });
    starting.catch(() => undefined);
    const runId = await latestRunId(host, cookie);

    // Once the Campaign has its workspace, something is put where the report's own directory goes —
    // a plain file of that name, which `mkdir` will not make a directory of. The flow goes on writing
    // inside `flow/` and the Campaign runs to its own ending; only the report cannot be written.
    // That is a Site that will not take it, which is what a host dying between the ending and the
    // report leaves behind.
    let workspace: string | undefined;
    await until('the campaign prepared its workspace', async () => {
      workspace = (await recordsOf(host, cookie, runId)).find((r) => r.type === 'workspace')?.workspace;
      return workspace !== undefined;
    });
    assert.ok(workspace, 'the campaign workspace is on record');
    inTheWay = path.join(workspace, 'hima-experience');
    await writeFile(inTheWay, 'not a directory\n', 'utf8');

    await until('the campaign reached its ending', async () => {
      const answered = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}`);
      return (JSON.parse(await answered.text()) as RunView).run.status === 'ended-goal-met';
    });
    await starting.catch(() => undefined);

    // The ending stands, and the report is owed.
    const withoutReport = JSON.parse(await (await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}`)).text()) as RunView;
    assert.equal(withoutReport.run.status, 'ended-goal-met', JSON.stringify(withoutReport.run));
    assert.equal(withoutReport.experience, undefined, 'nothing claims a report the site would not take');
    const owed = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/experience`);
    const owedText = await owed.text();
    assert.equal(owed.status, 404, owedText);
    assert.equal((JSON.parse(owedText) as HimaErrorBody).error.code, 'hima/record-not-found', owedText);

    // The way is clear again, and the next host writes what the last one owed.
    await rm(inTheWay);
    inTheWay = undefined;
    await first.close();

    second = await bootReportHost(t, { existing: first.home });
    assert.ok(second, 'the second boot answered');
    const later = second.host;
    const laterCookie = second.cookie;

    await until('the second host wrote the report it found owed', async () => {
      const answered = await api(later, laterCookie, `/hima/api/runs/${encodeURIComponent(runId)}`);
      return (JSON.parse(await answered.text()) as RunView).experience !== undefined;
    });
    const view = JSON.parse(await (await api(later, laterCookie, `/hima/api/runs/${encodeURIComponent(runId)}`)).text()) as RunView;
    const { json } = await reportOf(view);
    assert.equal(json.runId, runId);
    assert.equal(json.ending.status, 'ended-goal-met', 'the ending the first host wrote, said by the report the second one wrote');
    assert.deepEqual(json.generations, view.generations, 'from records that could not have moved');
  } finally {
    // Whatever was put in the report's way goes, whatever happened here.
    if (inTheWay !== undefined) await rm(inTheWay).catch(() => undefined);
    if (second) await second.dispose();
    await first.dispose();
  }
});

test('/hima status names the report\'s two files on a Campaign that has ended', async (t) => {
  // The one thing `bootInProcess` is for: the words of a chat command. The Campaign itself is the
  // shipped pack against the stand-in, run to its own ending through `/hima run`.
  const local = await localFabric(t, { sleepSeconds: 1 });
  if (!local) return;
  const { h, host, dispose } = local;
  let sessions: string[] = [];
  try {
    const started = await himaCommand(
      host,
      h.workspace,
      `/hima run ${timingProbePackId} --site local --goal target_period_ns=2.30 --set periodNs=2.35`,
      siteCommandTimeoutMs,
    );
    const runId = started.runId;
    assert.ok(runId, started.text);
    sessions = sessionsOf(host, runId);

    const status = await himaCommand(host, h.workspace, `/hima status ${runId}`);
    assert.equal(status.kind, 'success', status.text);
    const written = /^ {2}experience: written at (\S+)$/m.exec(status.text);
    assert.ok(written, `it says when the report was written: ${status.text}`);
    assert.match(
      status.text,
      new RegExp(`^ {4}markdown: \\S+/hima-experience/${runId}\\.md · sha256 [0-9a-f]{64} · \\d+ bytes$`, 'm'),
      `and where the person's file is, with its hash: ${status.text}`,
    );
    assert.match(
      status.text,
      new RegExp(`^ {4}json: \\S+/hima-experience/${runId}\\.json · sha256 [0-9a-f]{64} · \\d+ bytes$`, 'm'),
      `and the machine's: ${status.text}`,
    );
  } finally {
    killSessions(sessions);
    await dispose();
  }
});

test('a Campaign stopped while it waited on a person carries its Hard blocker into the report, log tail and all', async (t) => {
  // A flow that fails more times than the allowance: the first generation blocks, the Run waits for
  // a person, and the person stops it instead of clearing it. The report is written at that ending,
  // and a Hard blocker is the one thing in it that is neither a number nor a sentence — it is the
  // last lines the Job itself wrote, quoted whole.
  const d = await bootReportHost(t, { failures: 4 });
  if (!d) return;
  try {
    const { host, cookie } = d;

    const blocked = await startRun(host, cookie, { goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 1 });
    const runId = blocked.run.id;
    assert.equal(blocked.run.status, 'waiting', JSON.stringify(blocked.run));
    assert.equal(blocked.experience, undefined, 'a run that is waiting has not ended, and has no report');

    const cancelled = await api(host, cookie, `/hima/api/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' });
    const cancelledText = await cancelled.text();
    assert.equal(cancelled.status, 200, cancelledText);
    const view = JSON.parse(cancelledText) as RunView;
    assert.equal(view.run.status, 'cancelled', cancelledText);

    const { markdown, json } = await reportOf(view);
    assert.equal(json.blockers.length, 1, `the blocker it waited on is in the machine's file: ${JSON.stringify(json.blockers)}`);
    const blocker = json.blockers[0]!;
    assert.ok(blocker.logTail, 'with the tail of the log the failed job wrote');
    // The stand-in lays its failure out the way a tool does, with an empty pair of lines in it, and
    // that is on purpose: a report that normalised the blank lines of its own document would edit
    // this tail on the way into the Markdown, and the two files would then say different things.
    assert.match(blocker.logTail, /\n\n\n/, `the tail has an empty pair of lines in it: ${JSON.stringify(blocker.logTail)}`);
    assert.ok(markdown.includes('## The blockers'), `and the person's file has it in a section of its own: ${markdown}`);
    assert.ok(markdown.includes(blocker.reason), 'saying why the node gave up');
    // The tail is quoted whole, in a fence longer than any run of backticks inside it, and the
    // report's own reader hands it back as one block of exactly those lines.
    const fenced = reportBlocks(markdown).filter((b) => b.kind === 'code');
    assert.equal(fenced.length, 1, `one fenced block, the log tail: ${JSON.stringify(fenced)}`);
    const only = fenced[0]!;
    assert.equal(only.kind === 'code' ? only.text : '', blocker.logTail, 'byte for byte what the job wrote');
    assert.equal(json.ending.status, 'cancelled');
    assert.equal(json.ending.endedBy, 'cancel');
  } finally {
    await d.dispose();
  }
});
