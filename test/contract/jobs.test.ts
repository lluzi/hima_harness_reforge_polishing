// Local detached Jobs, permissions and channel plumbing. Real Site cases are in jobs.live.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHimaHome } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';
// tmux itself, asked by the one module that owns that question for this suite.
import { channelFor, clearRemoteCommands, jobPlumbing, loadSite, remoteCommands } from '@hima/harness';

/** The test's own judgement of what a job-plumbing verb is, kept apart from the channel's list on
 *  purpose: the audit test holds what was actually sent against this, not against the implementation's
 *  own idea of itself. */
const jobPlumbingVerbs = new Set(['tmux', 'test', 'tail', 'cat', 'wc', 'realpath']);

test('the job plumbing the channel admits is exactly the plumbing the job operations run', () => {
  // The same rule step 1 set for the read-only probes: an allowlist wider than the channel's own use
  // is permission granted on a customer's Site ahead of any caller needing it. The list below is the
  // whole vocabulary the reference-site audit test observes being sent, and no more.
  assert.deepEqual([...jobPlumbing].sort(), ['cat', 'tail', 'test', 'tmux', 'wc'], "the channel's job list is exactly the verbs the job operations run");
  for (const verb of jobPlumbing) {
    assert.ok(jobPlumbingVerbs.has(verb), `the channel admits ${verb}, which this test does not judge to be job plumbing`);
  }
});

test('the channel runs its own verbs and refuses everything else, on a local site as on a remote one', async () => {
  const h = await createHimaHome();
  try {
    const { sitesDir } = await writeLocalSite(h);
    const channel = channelFor(loadSite(sitesDir, 'local'));
    clearRemoteCommands();
    // Harmless, which is the point: they are refused for not being the channel's own verbs, not for
    // being dangerous. The permit governs the user's command; this governs the channel itself.
    await assert.rejects(() => channel.exec(['echo', 'hima']), /refusing to run "echo"/);
    await assert.rejects(() => channel.exec(['curl', 'https://example.com']), /refusing to run "curl"/);
    // The process probe (#64 D-T02-4) is `kill -s 0 -- -<group>` and only that: no shape of it can signal.
    for (const argv of [['kill', '-s', 'TERM', '--', '-4242'], ['kill', '-9', '-4242'], ['kill', '-s', '0', '--', '4242'],
      ['kill', '-s', '0', '--', '-1', '-4242'], ['kill', '-s', '0', '--', '-0']]) {
      await assert.rejects(() => channel.exec(argv), /the process probe is only "kill -s 0 -- -<process group>"/, JSON.stringify(argv));
    }
    // The process table read is one fixed, read-only shape; no caller chooses its options.
    for (const argv of [['ps'], ['ps', '-A'], ['ps', '-A', '-o', 'pgid=,stat=,args='], ['ps', '-ef'], ['ps', '-A', '-o', 'pgid=,stat=', '-p', '1']]) {
      await assert.rejects(() => channel.exec(argv), /the process table read is only "ps -A -o pgid=,stat="/, JSON.stringify(argv));
    }
    assert.deepEqual(remoteCommands(), [], 'a refused command is never run');
    const table = await channel.exec(['ps', '-A', '-o', 'pgid=,stat=']);
    assert.equal(table.code, 0);
    assert.match(Buffer.from(table.stdout).toString('utf8'), /^\s*\d+\s+\S+\s*$/m, 'every row is a process group and a state (macOS pads the state column)');
    const gone = await channel.exec(['kill', '-s', '0', '--', '-2147483000']);
    assert.equal(gone.code, 1, 'a group with no process answers no, and nothing was signalled');
  } finally {
    await h.dispose();
  }
});
