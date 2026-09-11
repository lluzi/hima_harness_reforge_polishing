// Ephemeral AC probe on the frozen build: real Host/HTTP/Jobs, no repository source changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localHome, killSessions } from '../../../../../test/contract/support/fabric.ts';
import { bootHimaHost } from '../../../../../test/contract/support/boot-host.ts';
import { api, openSession } from '../../../../../test/contract/support/hima-api.ts';
import { installFork, packsDirOf } from '../../../../../test/contract/support/pack.ts';
import { tmuxHasSession } from '../../../../../test/contract/support/tmux.ts';
import type { RunView } from '@hima/harness';

const evidence = path.dirname(new URL(import.meta.url).pathname);
const snapshot = (name: string, value: unknown) => writeFile(path.join(evidence, `${name}.json`), JSON.stringify(value, null, 2) + '\n');

test('one blocked branch remains visible beside a live peer; only that blocked branch runs after resume', async (t) => {
  const local = await localHome(t, { sleepSeconds: 3, failuresByTag: { b: 1 }, parallelJobs: 2, licences: { 'Design-Compiler': 2 } });
  assert.ok(local, 'local stand-in is available');
  const { h } = local;
  const pack = await installFork(packsDirOf(h), 'partial-fork-control-probe', 2.2);
  // The real stand-in checks failure AFTER sleep. Override only branch b's existing make variable
  // in this disposable installed Pack; successful branch retains 3 s. No fabricated ledger records.
  const contractPath = path.join(packsDirOf(h), pack, 'contract.yml');
  const before = await readFile(contractPath, 'utf8');
  assert.ok(before.includes('      - RESULT_TAG=b'));
  await writeFile(contractPath, before.replace('      - RESULT_TAG=b', '      - RESULT_TAG=b\n      - STANDIN_SLEEP=0'));
  const host = await bootHimaHost(h);
  const sessions = new Set<string>();
  try {
    const cookie = await openSession(host);
    const started = await api(host, cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pack, site: 'local', goal: { target_period_ns: 2.0 }, strategy: { periodNs: 2.0 }, retries: 1, timeBox: 1 }),
    });
    const opening = await started.json() as RunView;
    assert.equal(started.status, 200, JSON.stringify(opening));
    const runId = opening.run.id;
    const read = async () => {
      const response = await api(host, cookie, `/hima/api/runs/${runId}`);
      assert.equal(response.status, 200);
      const view = await response.json() as RunView;
      for (const job of view.jobs) if (job.event === 'launched') sessions.add(job.job.session);
      return view;
    };
    const until = async (condition: (view: RunView) => boolean, description: string) => {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const view = await read();
        if (condition(view)) return view;
        if (Date.now() >= deadline) { await snapshot('missed-interval', view); throw new Error(description); }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const partial = await until((view) => view.run.fork?.branches['synth-b']?.state === 'blocked' && view.run.fork?.branches.synthesize?.state === 'running', 'one branch never appeared blocked alongside its running peer');
    await snapshot('partial-run-view', partial);
    assert.equal(partial.run.status, 'running');
    assert.equal(partial.run.currentNode, 'judge');
    assert.equal(partial.blockers.at(-1)?.nodeId, 'synth-b');
    assert.match(partial.blockers.at(-1)?.logTail ?? '', /failing on purpose/);
    const live = partial.jobs.find((job) => job.branchId === 'synthesize' && job.event === 'launched');
    const failed = partial.jobs.find((job) => job.branchId === 'synth-b' && job.event === 'launched');
    assert.ok(live); assert.ok(failed);
    assert.equal(tmuxHasSession(live.job.session), true, 'the peer Job is actually running on the isolated Site');
    assert.equal(tmuxHasSession(failed.job.session), false, 'the blocked branch Job actually stopped');
    const page = await api(host, cookie, `/hima/?run=${runId}`);
    const html = await page.text();
    assert.equal(page.status, 200);
    await writeFile(path.join(evidence, 'partial-workbench.html'), html);
    const rows = Object.fromEntries([...html.matchAll(/<tr class="in-fork" data-hima-branch="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [m[1], m[2]]));
    assert.match(rows['synth-b'] ?? '', /blocked/);
    assert.match(rows.synthesize ?? '', /running/);
    assert.match(html, /data-hima-control="cancel"/);
    assert.ok(!html.includes('data-hima-control="resume"'), 'whole-Run resume is unavailable while the peer is still advancing');
    const early = await api(host, cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' });
    const earlyBody = await early.json();
    assert.equal(early.status, 409, JSON.stringify(earlyBody));
    await snapshot('early-resume-refusal', { status: early.status, body: earlyBody });
    const waiting = await until((view) => view.run.status === 'waiting', 'Run did not wait after its peer finished');
    await snapshot('waiting-run-view', waiting);
    assert.deepEqual(Object.fromEntries(Object.entries(waiting.run.fork!.branches).map(([id, branch]) => [id, branch.state])), { synthesize: 'done', 'synth-b': 'blocked' });
    const response = await api(host, cookie, `/hima/api/runs/${runId}/resume`, { method: 'POST' });
    const resumed = await response.json() as RunView;
    assert.equal(response.status, 200, JSON.stringify(resumed));
    await snapshot('resumed-run-view', resumed);
    assert.equal(resumed.run.status, 'ended-goal-not-met');
    assert.deepEqual(resumed.jobs.filter((job) => job.event === 'launched').map((job) => job.branchId), ['synthesize', 'synth-b', 'synth-b']);
    for (const job of resumed.jobs) if (job.event === 'launched') sessions.add(job.job.session);
    for (const session of sessions) assert.equal(tmuxHasSession(session), false);
    const records = await (await api(host, cookie, `/hima/api/runs/${runId}/records`)).json() as { records: { type: string; clears?: string }[] };
    const resumedRecords = records.records.filter((record) => record.type === 'resumed');
    assert.equal(resumedRecords.length, 1);
    const audit = await (await api(host, cookie, '/hima/api/audit')).json();
    await snapshot('audit', audit);
    await snapshot('summary', { baseline: 'ac2ed3a', runId, observedPartialState: partial.run.fork, livePeerSession: live.job.session, stoppedBranchSession: failed.job.session, earlyResumeStatus: early.status, finalState: resumed.run.status, launches: resumed.jobs.filter((job) => job.event === 'launched').map((job) => ({ branch: job.branchId, session: job.job.session })), resumes: resumedRecords.length, fixture: '3 s peer; existing STANDIN_SLEEP=0 override for failing branch b in disposable installed Pack', desktop: false, modelCalls: 0, remoteEdaJobs: 0 });
  } finally {
    killSessions([...sessions]);
    assert.equal(await host.stop(), 0, host.stderr());
    await h.dispose();
  }
});
