// Ticket #5: reach the reference Site over SSH. These tests talk to the real machine `linglong`,
// read-only, through the booted host. The site is LAN-only, so the whole file skips when it is out
// of reach. Every command the channel runs here is a read-only probe; the last test lists them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { bootInProcess, createRootAgent, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { installReferenceSite, writeReferenceSiteVariant } from './support/site.ts';
import { channelFor, controlPathFor, jobPlumbing, loadSite, readOnlyProbes, remoteCommands, clearRemoteCommands, quote, SshChannel, workspacePlumbing } from '@hima/harness';
import type { RemoteCommand } from '@hima/harness';

// The reference site, as `sites/linglong/site.yml` records it.
const destination = 'luzi@192.168.50.41';
const report = '/data/eda/project/design_zoo/pr/opene902/foundation/RPT/postroute.summary.gz';
// Readable by anyone on the site and far outside the permit's read roots: the refusal case.
const outsideThePermit = '/etc/passwd';

const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'test/fixtures/opene902.manifest.json'), 'utf8')) as {
  files: Record<string, string>;
};

/** The test's own judgement of what a read-only probe is, kept apart from the channel's list on
 *  purpose: the last test holds both against it. */
const readOnlyVerbs = new Set(['cat', 'realpath', 'readlink', 'stat', 'ls', 'test', 'true']);

/** The test's own POSIX single-quoting, reimplemented independently of `channel.ts`'s `quote` so a
 *  bug shared between the implementation and the check that verifies it cannot hide a regression. */
const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;
const changesTheSite =
  /^(rm|rmdir|mv|cp|dd|tee|touch|mkdir|ln|chmod|chown|chgrp|truncate|shred|systemctl|service|kill|killall|pkill|reboot|shutdown|mount|umount|apt|apt-get|dnf|yum|pip|npm|git|wget|curl|scp|rsync|sudo|su|tmux|innovus|dc_shell|make)$/;

/** Is the LAN site reachable from here at all? BatchMode so a prompt can never hang the suite. */
function probeSite(): string | false {
  const probe = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, 'true'], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  if (probe.status === 0) return false;
  return `the reference site ${destination} is not reachable from here (it is LAN-only): ssh exited ${probe.status ?? 'on a signal'}${probe.stderr ? `: ${probe.stderr.trim()}` : ''}`;
}

/** The size of a file on the site, straight from the site, so `bytes` is checked against the truth. */
function remoteSize(absPath: string): number {
  const out = execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, `stat -c %s -- '${absPath}'`], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return Number(out.trim());
}

// Every command the channel asked the site to run, accumulated across the tests below. Each entry
// carries both the argv the channel decided on and the exact wire string ssh received for it.
const sentToTheSite: RemoteCommand[] = [];
function collectRemoteCommands(): readonly RemoteCommand[] {
  const seen = remoteCommands();
  sentToTheSite.push(...seen);
  return seen;
}

/** Where the warm connection to the reference site lives, as the site file defines it. */
const socketOf = (sitesDir: string): string => controlPathFor(loadSite(sitesDir, 'linglong'));

/** One observation of a path on the reference site, over the real channel. */
function observeOverSsh(host: InProcessHost, workspace: string, absPath: string) {
  return himaCommand(host, workspace, `/hima observe linglong ${absPath}`, siteCommandTimeoutMs);
}

test('the committed reference site and permit record what the site owner agreed to', async () => {
  const h = await createHimaHome();
  try {
    const { sitesDir } = await installReferenceSite(h);
    const site = loadSite(sitesDir, 'linglong');
    assert.equal(site.kind, 'ssh');
    assert.equal(site.ssh?.destination, destination, 'the LAN destination, the only one that answers');
    assert.deepEqual(site.ssh?.jumps, [], 'a single hop: no bastion in front of this site');
    assert.equal(site.workspaceRoot, '/data/eda/project/hima_harness', 'campaign workspaces live under the site project tree');
    assert.equal(path.basename(site.permitFile), 'permit.yml', 'the site names where its permit is');
    assert.deepEqual(site.capacity, {
      cores: 32,
      memoryGiB: 117,
      parallelJobs: 1,
      licences: { 'Design-Compiler': 99, 'Library-Compiler': 99, PrimeTime: 99, Innovus_Impl_System: 0 },
    });
    assert.deepEqual(site.permitRules.allowedReadRoots, ['/data/eda/project'], 'reads under the project tree');
    assert.deepEqual(
      site.permitRules.allowedWriteRoots,
      ['/data/eda/project/hima_harness'],
      'the campaign workspace root and nothing else: a job writes its own workspace, never the site\'s results',
    );
    assert.deepEqual(
      site.permitRules.allowedWrappers,
      ['/usr/local/bin/eda', 'make'],
      'what a job\'s own command may be; the channel\'s own verbs (tmux, the workspace plumbing) are not on this list',
    );
    for (const rule of ['services', 'licence-servers', 'network-settings', 'dns', 'proxy', 'tailscale', 'deletions', 'moves-of-run-directories', 'repository-downloads']) {
      assert.ok(site.permitRules.forbidden.includes(rule), `the permit forbids ${rule}`);
    }
    // Lists that must never merge: the permit says what the site owner's own tools are and what a
    // Job's command may be; the channel's three lists are Hima's own plumbing, audited at the wire and
    // governed by the write roots rather than by this file. A wrapper appearing on any of them would
    // mean the permit had started describing Hima's internals — and worse, that a Job could be
    // launched with the arguments of its choosing under a verb the harness admits for its own writes.
    for (const wrapper of site.permitRules.allowedWrappers) {
      assert.ok(
        !readOnlyProbes.has(wrapper) && !jobPlumbing.has(wrapper) && !workspacePlumbing.has(wrapper),
        `the permit's wrapper "${wrapper}" is also one of the channel's own verbs: the permit's list and the channel's must stay distinct`,
      );
    }
  } finally {
    await h.dispose();
  }
});

test('a site file with a destination shaped like an ssh option is refused before any connection is attempted', async () => {
  // No site access needed for this one: loadSite fails on the file alone, before a channel exists.
  const h = await createHimaHome();
  try {
    const { sitesDir } = await installReferenceSite(h);
    const hostile = await writeReferenceSiteVariant(sitesDir, 'hostile-destination', [
      ['destination: luzi@192.168.50.41', 'destination: -oProxyCommand=touch /tmp/pwned'],
    ]);
    assert.match(hostile, /destination: -oProxyCommand=/, 'the reference site file is the one being varied');
    assert.throws(
      () => loadSite(sitesDir, 'hostile-destination'),
      /destination/i,
      'a destination shaped like an ssh option is rejected by the site schema, not handed to ssh',
    );
  } finally {
    await h.dispose();
  }
});

test('a jumps entry containing a comma is refused: it would smuggle an extra hop into -J', async () => {
  const h = await createHimaHome();
  try {
    const { sitesDir } = await installReferenceSite(h);
    const hostile = await writeReferenceSiteVariant(sitesDir, 'hostile-jump', [
      ['jumps: []', 'jumps: ["good@bastion.example.com,evil@evil.example.com"]'],
    ]);
    assert.match(hostile, /jumps: \["good@bastion/, 'the reference site file is the one being varied');
    assert.throws(
      () => loadSite(sitesDir, 'hostile-jump'),
      /jumps/i,
      'a jumps entry holding a comma is rejected before it can be joined into a -J chain',
    );
  } finally {
    await h.dispose();
  }
});

test('HimaChannel admits exactly the read-only probes it runs, and nothing more', () => {
  // An allowlist wider than the channel's own use is a promise nobody is keeping: every verb on it
  // is a verb some future caller may run on a customer's Site without anyone deciding to allow it.
  // `cat` and `realpath` are what this harness runs; when a caller needs another, it goes on the list
  // with the caller, not ahead of it.
  assert.deepEqual([...readOnlyProbes].sort(), ['cat', 'realpath'], "the channel's allowlist is exactly the verbs it runs");
  for (const verb of readOnlyProbes) {
    assert.doesNotMatch(verb, changesTheSite, `the channel's own allowlist admits ${verb}`);
    assert.ok(readOnlyVerbs.has(verb), `the channel's own allowlist admits ${verb}, which this test does not judge read-only`);
  }
});

test('two sites that differ only in how long the connection is kept warm get their own control socket', async () => {
  const h = await createHimaHome();
  try {
    const { sitesDir } = await installReferenceSite(h);
    // ControlPersist is a property of the master, not of the client that asks for it: two sites
    // sharing one socket would silently get whichever master happened to open first, and the second
    // site's declared persistence would never take effect.
    const longer = await writeReferenceSiteVariant(sitesDir, 'kept-warm-longer', [['controlPersistSeconds: 60', 'controlPersistSeconds: 600']]);
    assert.match(longer, /controlPersistSeconds: 600/, 'the reference site file is the one being varied');
    assert.notEqual(
      controlPathFor(loadSite(sitesDir, 'linglong')),
      controlPathFor(loadSite(sitesDir, 'kept-warm-longer')),
      'the control socket key covers everything that shapes the master, ControlPersist included',
    );
  } finally {
    await h.dispose();
  }
});

describe('the reference site over SSH', { skip: probeSite() }, () => {
  test('observing the real post-route summary over SSH records the same content hash as the local copy', async () => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const { kind, text, runId } = await observeOverSsh(host, h.workspace, report);
      assert.equal(kind, 'success', text);
      assert.ok(runId, 'the observation belongs to a run');
      const records = host.ctx.hima.ledger.records({ runId });
      assert.equal(records.length, 1);
      const rec = records[0]!;
      assert.equal(rec.type, 'observation');
      assert.equal(rec.siteId, 'linglong');
      assert.equal(rec.type === 'observation' ? rec.path : '', report);
      assert.equal(
        rec.type === 'observation' ? rec.contentSha256 : '',
        manifest.files['postroute.summary.gz'],
        'the bytes read over SSH hash to the same value as the local copy of the report',
      );
      assert.equal(rec.type === 'observation' ? rec.bytes : -1, remoteSize(report), 'the byte count matches the file on the site');

      const ran = collectRemoteCommands();
      assert.ok(
        ran.some((c) => c.argv[0] === 'cat' && c.argv.includes(report)),
        `the report was read with cat: ${JSON.stringify(ran)}`,
      );
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('a read outside the permit is refused before any read, and the refusal is recorded', async () => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const { kind, text, runId } = await observeOverSsh(host, h.workspace, outsideThePermit);
      assert.equal(kind, 'error', text);
      assert.match(text, /outside the permitted read roots/);
      assert.ok(runId, 'the refusal still belongs to a run');
      const records = host.ctx.hima.ledger.records({ runId });
      assert.equal(records.length, 1);
      assert.equal(records[0]!.type, 'refusal');
      assert.equal(records[0]!.writer, 'shell');
      assert.equal(host.ctx.hima.ledger.records({ runId, type: 'observation' }).length, 0, 'nothing was observed');

      const ran = collectRemoteCommands();
      assert.ok(ran.length > 0, 'the permit decision resolved the path on the site');
      assert.equal(
        ran.filter((c) => c.argv[0] === 'cat').length,
        0,
        `the file was never read: ${JSON.stringify(ran)}`,
      );
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('a path with a space and a quote reaches the site as one literal argument, not split by a shell', async () => {
    // Non-existent on purpose: nothing is written and no file needs to exist for this. The space
    // would split an unquoted word into two arguments, and the quote would end an unquoted quoting
    // context early; both would corrupt the path before it ever left this machine. If ssh received
    // exactly the string below, the site's own `realpath` echoes it back unchanged in its error.
    // Goes through the hima_observe tool, not the `/hima observe` command text: that command line is
    // itself split on whitespace with no quoting, which would mangle this path before HimaChannel ever
    // saw it — a different, harmless bug this test must route around, not exercise.
    const oddPath = "/data/eda/project/no such 'dir'/report.rpt";
    // The refusal reason is built from local strings (`shell.ts`, `channel.ts`) that already contain
    // `oddPath` verbatim, so `reason.includes(oddPath)` alone would pass even if the quoting that puts
    // it on the wire were deleted entirely — the local strings say nothing about what actually reached
    // the site. What can only be true if the wire was correct is what the SITE's own `realpath` echoes
    // back on stderr, so the reason must be checked for a signature only the remote diagnostic could
    // produce: the `realpath:` prefix (never emitted locally) immediately followed by an opening quote
    // and the unbroken `no such` phrase — "no" and "such" can only still be adjacent, joined by their
    // original space, if the whole path arrived as one argument.
    //
    // Observed by hand against this real site (`luzi@192.168.50.41`), sending the channel's exact argv
    // (`realpath -z -e -- <oddPath>`) quoted the same way `quote`/`posixQuote` quote it, GNU realpath's
    // diagnostic took TWO different forms across otherwise-identical runs (same wire, same process env,
    // a fresh control connection each time): `realpath: '/data/eda/project/no such \dir\\/report.rpt'`
    // (the whole path single-quoted, each embedded `'` rendered as one or two backslashes) on some runs,
    // and `realpath: "/data/eda/project/no such 'dir'/report.rpt"` (double-quoted, embedded `'` left
    // untouched) on others — with no difference in argv, wire, or LANG/LC_*/env (all unset in both) that
    // would explain the switch. That is evidently a property of this site's own coreutils/session, not
    // of the wire this harness sends, so the check below tolerates either quote character rather than
    // pinning one exact literal that real testing showed is not stable run to run.
    const remoteEchoesUnsplit = /realpath: ['"]\/data\/eda\/project\/no such/;
    // What the site says instead if the space in `oddPath` split it into separate argv words (the
    // regression this test exists to catch): GNU realpath reports each missing word on its own line, and
    // a short, quote-free word like `/data/eda/project/no` gets no surrounding quotes at all — observed
    // the same way, by hand, by sending the argv unquoted (`argv.join(' ')`, exactly what `channel.ts`
    // produces with `.map(quote)` deleted): `realpath: /data/eda/project/no: No such file or directory`.
    // "no" landing right against a quote or colon, with no " such" continuing the phrase, is the split.
    const wordSplitSignature = /realpath: ['"]?\/data\/eda\/project\/no['":]/;
    const h = await createHimaHome();
    await installReferenceSite(h);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const agent = await createRootAgent(host.ctx, h.workspace);
      const result = await host.ctx.tools.execute({
        callId: 'call-hima-observe-odd-path' as never,
        name: 'hima_observe',
        arguments: { site: 'linglong', path: oddPath },
        agent,
        signal: AbortSignal.timeout(60_000),
      });
      const value = (result as unknown as { value?: { kind: string; reason?: string } }).value;
      assert.ok(value, `the tool returns a value: ${JSON.stringify(result)}`);
      assert.equal(value.kind, 'refused', JSON.stringify(result));
      assert.match(
        value.reason ?? '',
        remoteEchoesUnsplit,
        `the refusal must contain the SITE's own echo of the whole path as one token, not just the local prefix that already knows it: ${value.reason}`,
      );
      assert.doesNotMatch(
        value.reason ?? '',
        wordSplitSignature,
        `the refusal names the truncated path a word-split would have produced — the space broke the argument in two: ${value.reason}`,
      );
      const ran = collectRemoteCommands();
      const resolved = ran.find((c) => c.argv[0] === 'realpath' && c.argv.includes(oddPath));
      assert.ok(resolved, `the odd path was the one resolved on the site: ${JSON.stringify(ran)}`);
      // Prove the wire, not just the argv the channel decided on: an independent re-implementation of
      // the POSIX single-quoting (not the `quote` under test) must reproduce exactly what was sent, and
      // that wire must carry `oddPath` as a single quoted token.
      assert.equal(
        resolved.wire,
        resolved.argv.map(posixQuote).join(' '),
        `the wire sent to ssh must equal every argv word independently quoted: ${JSON.stringify(resolved)}`,
      );
      assert.ok(
        resolved.wire.includes(posixQuote(oddPath)),
        `the wire must carry the odd path as one quoted token: ${resolved.wire}`,
      );
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('the control connection is reused, and after it drops the next observation re-establishes it', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const first = await observeOverSsh(host, h.workspace, report);
      assert.equal(first.kind, 'success', first.text);
      const opened = (await stat(socketOf(sitesDir))).ino;

      const second = await observeOverSsh(host, h.workspace, report);
      assert.equal(second.kind, 'success', second.text);
      assert.equal((await stat(socketOf(sitesDir))).ino, opened, 'the second observation reused the warm connection');

      await rm(socketOf(sitesDir), { force: true });
      const third = await observeOverSsh(host, h.workspace, report);
      assert.equal(third.kind, 'success', third.text);
      assert.notEqual(third.runId, first.runId, 'the third observation is its own run');
      assert.notEqual(
        (await stat(socketOf(sitesDir))).ino,
        opened,
        'a fresh connection took its place, with the caller none the wiser',
      );
      collectRemoteCommands();
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('a stale control socket left behind by a killed master is removed and the connection re-established', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    // What a SIGKILLed master leaves: the path exists but nothing is listening on it. ssh then says
    // "ControlSocket ... already exists, disabling multiplexing" and connects unmultiplexed, so every
    // later probe pays for a fresh connection and the warm channel never comes back on its own. A
    // live socket from an earlier test in this file may hold the path, so it goes first.
    await rm(socketOf(sitesDir), { force: true });
    await writeFile(socketOf(sitesDir), 'not a socket: what a killed master leaves behind');
    assert.ok(!(await stat(socketOf(sitesDir))).isSocket(), 'the stale path is in place and is not a socket');
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const observed = await observeOverSsh(host, h.workspace, report);
      assert.equal(observed.kind, 'success', observed.text);
      assert.ok((await stat(socketOf(sitesDir))).isSocket(), 'a real control socket took the stale file\'s place: multiplexing is back');
      collectRemoteCommands();
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('the channel refuses to run anything that is not a read-only probe', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    clearRemoteCommands();
    try {
      const channel = channelFor(loadSite(sitesDir, 'linglong'));
      assert.ok(channel instanceof SshChannel, 'an ssh site gets the SSH channel');
      // `echo` is harmless, which is the point: the guard rejects it for not being a read-only probe,
      // not for being dangerous, and nothing reaches the site.
      await assert.rejects(() => channel.exec(['echo', 'hima']), /read-only/);
      assert.deepEqual(collectRemoteCommands(), [], 'a refused command never reaches the site');
    } finally {
      await h.dispose();
    }
  });

  test('a site behind a bastion is reached through it, not around it', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    // The same site, declared behind a jump host that does not answer. TEST-NET-1 is reserved and
    // routed nowhere, so the only way this read can succeed is by ignoring the chain.
    const bastion = '192.0.2.1';
    const declared = await writeReferenceSiteVariant(sitesDir, 'behind-a-bastion', [['jumps: []', `jumps: [luzi@${bastion}]`]]);
    assert.match(declared, /jumps: \[luzi@/, 'the reference site file is the one being varied');
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const { kind, text } = await himaCommand(host, h.workspace, `/hima observe behind-a-bastion ${report}`, 120_000);
      // The first test in this file reads this very path on this very destination and succeeds; the
      // only difference here is the chain, so a failure to connect is the chain being honoured.
      assert.equal(kind, 'error', text);
      assert.match(text, /ssh exited 255/, 'the connection failed, at the bastion');
      assert.doesNotMatch(text, /outside the permitted read roots/, 'it failed connecting, not on the permit');
      collectRemoteCommands();
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('every command the channel asked the site to run was a read-only probe, sent on the wire it decided on', (t) => {
    assert.ok(sentToTheSite.length > 0, 'the tests above ran commands on the site');
    for (const { argv } of sentToTheSite) t.diagnostic(`asked the site to run: ${argv.join(' ')}`);
    for (const { argv, wire } of sentToTheSite) {
      const verb = argv[0] ?? '';
      assert.ok(readOnlyVerbs.has(verb), `not a read-only probe: ${JSON.stringify(argv)}`);
      assert.doesNotMatch(verb, changesTheSite, `changes the site: ${JSON.stringify(argv)}`);
      // The audit records the argv the channel decided on and the wire ssh actually received; this
      // ties them together so deleting the quoting step (`.map(quote)`) cannot pass unnoticed. Full
      // equality on the whole wire, not just a prefix check on the verb: `wire.startsWith(quote(verb))`
      // only looks at argv[0] — every recorded command here happens to be a bare-word verb like `cat`
      // or `realpath`, so it says nothing about whether `--` or the path that follows were quoted at
      // all. Equality against every argv word independently quoted is the only check a regression in
      // quoting any later word cannot survive.
      assert.equal(
        wire,
        argv.map(quote).join(' '),
        `the wire sent to ssh is not every argv word independently quoted: argv=${JSON.stringify(argv)} wire=${JSON.stringify(wire)}`,
      );
    }
    const verbs = [...new Set(sentToTheSite.map(({ argv }) => argv[0]))].sort();
    assert.deepEqual(verbs, ['cat', 'realpath'], 'the whole command set this ticket runs on a Site');
  });
});
