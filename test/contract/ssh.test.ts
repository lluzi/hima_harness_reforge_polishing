// Local reference-Site configuration and channel allowlist checks; no SSH is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { installReferenceSite, writeReferenceSiteVariant } from './support/site.ts';
import { controlPathFor, jobPlumbing, loadSite, readOnlyProbes, workspacePlumbing } from '@hima/harness';

const destination = 'luzi@192.168.50.41';
/** The test's own judgement of what a read-only probe is, kept apart from the channel's list on
 *  purpose: the last test holds both against it. */
const readOnlyVerbs = new Set(['cat', 'realpath', 'readlink', 'stat', 'ls', 'test', 'true', 'uname', 'getconf', 'which']);

const changesTheSite =
  /^(rm|rmdir|mv|cp|dd|tee|touch|mkdir|ln|chmod|chown|chgrp|truncate|shred|systemctl|service|kill|killall|pkill|reboot|shutdown|mount|umount|apt|apt-get|dnf|yum|pip|npm|git|wget|curl|scp|rsync|sudo|su|tmux|innovus|dc_shell|make)$/;


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

test('HimaChannel admits exactly the bounded read-only probes used by observation and Site discovery', () => {
  // An allowlist wider than the channel's own use is a promise nobody is keeping: every verb on it
  // is a verb some future caller may run on a customer's Site without anyone deciding to allow it.
  // `cat` and `realpath` are what this harness runs; when a caller needs another, it goes on the list
  // with the caller, not ahead of it.
  assert.deepEqual([...readOnlyProbes].sort(), ['cat', 'getconf', 'realpath', 'uname', 'which'], "the channel's allowlist is exactly the fixed observation and discovery verbs it runs");
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
