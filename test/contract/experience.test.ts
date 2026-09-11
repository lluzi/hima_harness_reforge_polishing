// Ticket #30: HimaExperience. When a Run ends for any reason, the fabric writes the Campaign's
// technical report — one Markdown file people read and one JSON file machines read — under the
// Campaign workspace on the Site beside the results, with a hash of each on an `experience` record.
//
// PLS-07 retains this one report-open path through the desktop shell in driver mode (D42, ADR-0004), which is the one seam every
// step-3 test boots through: the Campaign is started over the routes with the session the shell
// established, the report is read off the Site where the Site actually put it, and the section a
// person reads is read off the window's own page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { api } from './support/hima-api.ts';
import { timingProbePackId } from './support/pack.ts';
import type { ExperienceJson, LedgerRecord, RunView } from '@hima/harness';

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
  const d = await bootDriver(t, { home: 'hima' });
  if (!d) return;
  try {
    const host = await d.host();
    assert.ok(host.ok, JSON.stringify(host));
    const cookie = await d.cookie();

    // 2.07 ns is tighter than the stand-in closes at (2.20), so the first generation misses and the
    // chooser backs off; the second closes and meets the 2.30 ns goal.
    const view = await startRun(host, cookie, { goal: { target_period_ns: 2.30 }, strategy: { periodNs: 2.07 } });
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

    // And the window shows it on the ended Run.
    const opened = await d.open(`/hima/?run=${encodeURIComponent(runId)}`);
    assert.ok(opened.ok, JSON.stringify(opened));
    const shown = await d.read('run-experience');
    assert.ok(shown.ok, JSON.stringify(shown));
    assert.equal(shown.state.source, 'ledger-preview');
    assert.equal(shown.state['recorded-file-sha256'], experience.markdown.sha256);
    assert.match(shown.text, /current preview from recorded facts, not the saved file/);
    assert.match(shown.text, /Research result and evidence limits/);
    assert.equal(shown.state.sha256, experience.markdown.sha256, JSON.stringify(shown.state));
    assert.equal(shown.state['written-at'], experience.writtenAt, JSON.stringify(shown.state));
    const heading = markdown.split('\n')[0]!.replace(/^#\s*/, '');
    assert.ok(shown.text.includes(heading), `the window renders the report itself: ${shown.text}`);
    assert.deepEqual(d.unexpectedStdout(), []);
  } finally {
    await d.dispose();
  }
});
