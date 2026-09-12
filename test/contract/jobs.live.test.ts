// L4 Site: real remote tmux Jobs (make -v) in UUID-named test workspaces.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import { createHimaHome, type HimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand, localCommandTimeoutMs, siteCommandTimeoutMs } from './support/command.ts';
import { installReferenceSite } from './support/site.ts';
import { clearRemoteCommands, controlPathFor, loadSite, quote, remoteCommands } from '@hima/harness';
import type { JobRecord, LedgerRecord, RemoteCommand } from '@hima/harness';

import { requireLiveSite, ownControlPath } from './support/live-site.ts';

requireLiveSite();

const destination = 'luzi@192.168.50.41';
/** The campaign workspace root the reference permit allows writes under. Nothing else is touched. */
const campaignRoot = '/data/eda/project/hima_harness';
/** The site's own Design Zoo: readable, and squarely outside every write root. The refusal case. */
const designZoo = '/data/eda/project/design_zoo';

/** The test's own judgement of what a job-plumbing verb is, kept apart from the channel's list on
 *  purpose: the audit test holds what was actually sent against this, not against the implementation's
 *  own idea of itself. */
const jobPlumbingVerbs = new Set(['tmux', 'test', 'tail', 'cat', 'realpath']);
/** The test's own POSIX single-quoting, reimplemented independently of `channel.ts`'s `quote`. */
const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** Is the LAN site reachable from here at all? BatchMode so a prompt can never hang the suite. */
function probeSite(): string | false {
  const probe = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, 'true'], { encoding: 'utf8', timeout: 20_000 });
  if (probe.status === 0) return false;
  return `the reference site ${destination} is not reachable from here (it is LAN-only): ssh exited ${probe.status ?? 'on a signal'}`;
}

/**
 * Run one command on the reference site with the test's own ssh, outside the harness entirely.
 *
 * The scaffolding a test needs is the test's own business: HimaChannel admits neither `mkdir` nor
 * `rm`, and it must not start admitting them because a test wanted a directory. BatchMode so a
 * prompt can never hang the suite, and the caller quotes what it passes.
 */
function onTheSite(command: string): void {
  const ran = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, command], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(ran.status, 0, `the test's own ssh could not run "${command}" on ${destination}: ${ran.stderr ?? ''}`);
}

/**
 * Put at the channel's control path what a SIGKILLed ssh master leaves behind: the path exists and
 * nothing is listening on it. ssh then says "ControlSocket ... already exists, disabling
 * multiplexing", runs the command unmultiplexed, and leaves the path exactly as it found it — so
 * every later command pays for its own connection until something removes the file.
 */
async function plantStaleControlSocket(controlPath: string): Promise<void> {
  ownControlPath(controlPath);
  await rm(controlPath, { force: true });
  await writeFile(controlPath, 'not a socket: what a killed master leaves behind');
  assert.ok(!(await stat(controlPath)).isSocket(), 'the stale path is in place and is not a socket');
}

/** The job records of a run, in sequence order. */
const jobRecords = (host: InProcessHost, runId: string): JobRecord[] =>
  host.ctx.hima.ledger.records({ runId, type: 'job' }).filter((r): r is JobRecord => r.type === 'job');

const recordsOf = (host: InProcessHost, runId: string): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });

/** The session name of the one job a run launched, read from the ledger rather than scraped from
 *  the command's text: the record is what the next command is given. */
function launchedSession(host: InProcessHost, runId: string): string {
  const launched = jobRecords(host, runId).filter((r) => r.event === 'launched');
  assert.equal(launched.length, 1, `exactly one launched job record in ${runId}: ${JSON.stringify(launched)}`);
  return launched[0]!.job.session;
}

/** Ask for status until the job is no longer running, or give up. Returns the last answer. */
async function statusUntilSettled(host: InProcessHost, h: HimaHome, runId: string, session: string, timeoutMs = 60_000, commandTimeoutMs = localCommandTimeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const answer = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`, commandTimeoutMs);
    if (!/^running\b/.test(answer.text) || Date.now() >= deadline) return answer;
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Every command the channel asked the reference site to run in the tests below, oldest first.
const sentToTheSite: RemoteCommand[] = [];
function collectRemoteCommands(): readonly RemoteCommand[] {
  const seen = remoteCommands();
  sentToTheSite.push(...seen);
  return seen;
}

describe('jobs on the reference site', { skip: probeSite() }, () => {
  test('a job runs in a workspace the test creates under the campaign root, and its exit code comes back', async () => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    const workspace = `${campaignRoot}/hima-test-${randomUUID()}`;
    // Everything this test writes lives under this one directory, which it creates and removes with
    // its own ssh: the harness's channel does not make or unmake paths on a Site, and a test is not
    // a reason to let it.
    assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'the workspace is the test\'s own, under the campaign root');
    onTheSite(`mkdir -p -- ${posixQuote(workspace)}`);
    // Two nested guards: the inner one always disposes the host, and the outer one always takes the
    // test's own workspace back down on the site, even if the host's disposal itself fails.
    try {
      const host = await bootInProcess(h);
      clearRemoteCommands();
      try {
        // `make` is one of the permit's allowed wrappers; `-v` only prints its version, so the job is
        // real, cheap, and writes nothing of its own.
        const launched = await himaCommand(host, h.workspace, `/hima job launch linglong ${workspace} --name makever -- make -v`, siteCommandTimeoutMs);
        assert.equal(launched.kind, 'success', launched.text);
        const runId = launched.runId!;
        const session = launchedSession(host, runId);
        const identity = jobRecords(host, runId)[0]!.job;
        assert.equal(identity.workspace, workspace, 'the job runs in the workspace the permit resolved');
        assert.ok(identity.pid !== undefined && identity.pid > 0, `the launch read the pane pid on the site: ${JSON.stringify(identity)}`);

        const settled = await statusUntilSettled(host, h, runId, session, 60_000, siteCommandTimeoutMs);
        assert.equal(settled.kind, 'success', settled.text);
        assert.match(settled.text, /^finished\b/, settled.text);
        assert.match(settled.text, /exit 0\b/, settled.text);

        const tailed = await himaCommand(host, h.workspace, `/hima job tail ${runId} ${session} --lines 20`, siteCommandTimeoutMs);
        assert.equal(tailed.kind, 'success', tailed.text);
        assert.match(tailed.text, /GNU Make/, `the tail carries the job's own output from the site: ${tailed.text}`);

        const records = jobRecords(host, runId);
        assert.deepEqual(records.map((r) => r.event), ['launched', 'finished']);
        assert.equal(records[1]!.exitCode, 0);
        assert.equal(records[0]!.siteId, 'linglong');

        // Killing a job that has already ended is an answer over SSH too, not an exception, and it
        // writes nothing: only a kill that actually stopped something records a killed event.
        const killed = await himaCommand(host, h.workspace, `/hima job kill ${runId} ${session}`, siteCommandTimeoutMs);
        assert.equal(killed.kind, 'success', killed.text);
        assert.match(killed.text, /already gone/, killed.text);
        assert.equal(jobRecords(host, runId).length, 2, 'nothing was stopped, so nothing was recorded');
      } finally {
        collectRemoteCommands();
        await host.dispose();
      }
    } finally {
      // Remove only what this test created, inside the one write root the permit allows.
      assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'nothing but the test\'s own workspace is ever removed');
      onTheSite(`rm -rf -- ${posixQuote(workspace)}`);
      await h.dispose();
    }
  });

  test('a stale control socket is cleared without the job plumbing being sent a second time', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    const controlPath = ownControlPath(controlPathFor(loadSite(sitesDir, 'linglong')));
    const workspace = `${campaignRoot}/hima-test-${randomUUID()}`;
    assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'the workspace is the test\'s own, under the campaign root');
    onTheSite(`mkdir -p -- ${posixQuote(workspace)}`);
    try {
      const host = await bootInProcess(h);
      clearRemoteCommands();
      try {
        await plantStaleControlSocket(controlPath);
        const launched = await himaCommand(host, h.workspace, `/hima job launch linglong ${workspace} --name stale -- make -v`, siteCommandTimeoutMs);
        assert.equal(launched.kind, 'success', launched.text);
        const runId = launched.runId!;
        const session = launchedSession(host, runId);
        assert.equal(
          remoteCommands().filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session').length,
          1,
          'the job was started once and once only, whatever the connection did',
        );
        const settled = await statusUntilSettled(host, h, runId, session, 60_000, siteCommandTimeoutMs);
        assert.match(settled.text, /^finished\b/, settled.text);

        // Now the stale socket is put where the *job plumbing* meets it first: `status` asks
        // `test -f` about the exit file before anything else, and `test` is the channel's own
        // plumbing, not a read-only probe. ssh has already run that command by the time it says the
        // socket is stale, so sending it again is a second run of it on the site — harmless for a
        // `test`, a second launch for a `tmux new-session`. Only a read-only probe is worth resending.
        await plantStaleControlSocket(controlPath);
        const before = remoteCommands().length;
        const again = await himaCommand(host, h.workspace, `/hima job status ${runId} ${session}`, siteCommandTimeoutMs);
        assert.equal(again.kind, 'success', again.text);
        const during = remoteCommands().slice(before);
        assert.equal(
          during.filter((c) => c.argv[0] === 'test').length,
          1,
          `the plumbing that met the stale socket was sent once: ${JSON.stringify(during.map((c) => c.argv))}`,
        );
        assert.ok((await stat(controlPath)).isSocket(), 'the stale file was removed all the same, so the warm connection came back');
      } finally {
        collectRemoteCommands();
        await host.dispose();
      }
    } finally {
      assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'nothing but the test\'s own workspace is ever removed');
      onTheSite(`rm -rf -- ${posixQuote(workspace)}`);
      await h.dispose();
    }
  });

  test('a launch into the site\'s Design Zoo is refused on the real permit before any job command is sent', async () => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const refused = await himaCommand(host, h.workspace, `/hima job launch linglong ${designZoo} -- make -v`, siteCommandTimeoutMs);
      assert.equal(refused.kind, 'error', refused.text);
      assert.match(refused.text, /outside the permitted write roots/, refused.text);
      const runId = refused.runId!;
      assert.equal(recordsOf(host, runId).length, 1);
      assert.equal(recordsOf(host, runId)[0]!.type, 'refusal');
      assert.equal(jobRecords(host, runId).length, 0);
      const ran = collectRemoteCommands();
      assert.ok(ran.length > 0, 'the permit decision resolved the workspace on the site');
      assert.deepEqual(
        ran.filter((c) => c.argv[0] === 'tmux'),
        [],
        `no job command was sent: ${JSON.stringify(ran)}`,
      );
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('every command the site was asked to run was job plumbing, sent on the wire it decided on, and inside the campaign root', (t) => {
    assert.ok(sentToTheSite.length > 0, 'the tests above ran commands on the site');
    for (const { argv } of sentToTheSite) t.diagnostic(`asked the site to run: ${argv.join(' ')}`);
    for (const { argv, wire } of sentToTheSite) {
      const verb = argv[0] ?? '';
      assert.ok(jobPlumbingVerbs.has(verb), `not a job-plumbing verb: ${JSON.stringify(argv)}`);
      assert.equal(wire, argv.map(quote).join(' '), `the wire is not every argv word independently quoted: ${JSON.stringify({ argv, wire })}`);
      // Nothing this suite asks the site to run names a path outside the campaign root, and nothing
      // it can run would create or remove one: the channel admits no verb that makes or unmakes a path.
      for (const word of argv.slice(1)) {
        if (!word.startsWith('/data/')) continue;
        const allowed = word === campaignRoot || word.startsWith(`${campaignRoot}/`) || word === designZoo;
        assert.ok(allowed, `a path neither under the campaign root nor the one refusal case reached the wire: ${JSON.stringify(argv)}`);
      }
    }
    // The user command never reaches the wire on its own: it is the shell line tmux is given to run.
    const launches = sentToTheSite.filter((c) => c.argv[0] === 'tmux' && c.argv[1] === 'new-session');
    assert.ok(launches.length > 0, 'jobs were launched on the site');
    for (const launch of launches) {
      const script = launch.argv.at(-1)!;
      assert.match(script, /^'make' '-v' > '/, `the only user command launched is the permitted one: ${script}`);
    }
    const verbs = [...new Set(sentToTheSite.map((c) => c.argv[0]))].sort();
    assert.deepEqual(verbs, ['cat', 'realpath', 'tail', 'test', 'tmux'], 'the whole command set this ticket runs on a Site');
  });
});
