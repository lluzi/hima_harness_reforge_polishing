// L4 Site: explicitly selected by scripts/run-contract-tests.mjs live-site.
// Copies the reference flow into a test-owned workspace, then removes only that workspace.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootInProcess, type InProcessHost } from './support/boot-inprocess.ts';
import { himaCommand, siteCommandTimeoutMs } from './support/command.ts';
import { installReferenceSite } from './support/site.ts';
import { installPack, timingProbePackId } from './support/pack.ts';
import { requireLiveSite } from './support/live-site.ts';
import { clearRemoteCommands, quote, remoteCommands } from '@hima/harness';
import type { LedgerRecord, RemoteCommand, WorkspaceRecord } from '@hima/harness';

requireLiveSite();

const destination = 'luzi@192.168.50.41';
/** The campaign workspace root the reference permit allows writes under. Nothing else is touched. */
const campaignRoot = '/data/eda/project/hima_harness';
/** The site's own Design Zoo: what the pack reads its flow from, and never writes. */
const designZoo = '/data/eda/project/design_zoo';
/** The baseline report the site produced for itself. A campaign that touched it would be the bug. */
const baselineQor = `${designZoo}/results/opene902/syn/report/qor.rpt`;
/** The one read root the reference permit allows; every read decision resolves it before deciding. */
const permitReadRoot = '/data/eda/project';

/** The test's own POSIX single-quoting, reimplemented independently of `channel.ts`'s `quote`. */
const posixQuote = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`;

/** Is the LAN site reachable from here at all? BatchMode so a prompt can never hang the suite. */
function probeSite(): string | false {
  const probe = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, 'true'], { encoding: 'utf8', timeout: 20_000 });
  if (probe.status === 0) return false;
  return `the reference site ${destination} is not reachable from here (it is LAN-only): ssh exited ${probe.status ?? 'on a signal'}`;
}

/**
 * Run one command on the reference site with the test's own ssh, outside the harness entirely, and
 * return what it printed. The scaffolding a test needs is the test's own business: the harness
 * removes nothing on a Site, and a test wanting its workspace back is not a reason to teach it how.
 */
function onTheSite(command: string, mustSucceed = true): string {
  const ran = spawnSync('ssh', ['-o', 'ControlPath=none', '-o', 'ControlMaster=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', destination, command], { encoding: 'utf8', timeout: 120_000 });
  if (mustSucceed) assert.equal(ran.status, 0, `the test's own ssh could not run "${command}" on ${destination}: ${ran.stderr ?? ''}`);
  return ran.stdout ?? '';
}

const recordsOf = (host: InProcessHost, runId: string): LedgerRecord[] => host.ctx.hima.ledger.records({ runId });

const workspaceRecords = (host: InProcessHost, runId: string): WorkspaceRecord[] =>
  recordsOf(host, runId).filter((r): r is WorkspaceRecord => r.type === 'workspace');

// Every command the channel asked the reference site to run in the tests below, oldest first.
const sentToTheSite: RemoteCommand[] = [];
function collectRemoteCommands(): readonly RemoteCommand[] {
  const seen = remoteCommands();
  sentToTheSite.push(...seen);
  return seen;
}

describe('preparing a campaign workspace on the reference site', { skip: probeSite() }, () => {
  test('the site\'s own flow is copied into a workspace under the campaign root, and the site\'s baseline results are not touched', async (t) => {
    const h = await createHimaHome();
    await installReferenceSite(h);
    await installPack(h);
    const campaign = `hima-test-${randomUUID()}`;
    const workspace = `${campaignRoot}/${campaign}`;
    assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'the workspace is the test\'s own, under the campaign root');
    // What the site produced for itself, before any of this. Nothing here may write it (D19).
    const baselineBefore = onTheSite(`stat -c %Y -- ${posixQuote(baselineQor)}`).trim();
    assert.match(baselineBefore, /^\d+$/, `the site's baseline report is there to be left alone: ${baselineBefore}`);
    try {
      const host = await bootInProcess(h);
      clearRemoteCommands();
      try {
        const checked = await himaCommand(host, h.workspace, `/hima pack check ${timingProbePackId} --site linglong`, siteCommandTimeoutMs);
        for (const line of checked.text.split('\n')) t.diagnostic(line);
        assert.equal(checked.kind, 'success', checked.text);
        assert.match(checked.text, /^pack opene902-timing-probe@1 on site linglong: fit\b/, checked.text);
        assert.match(checked.text, /^ {2}flowRoot = \/data\/eda\/project\/design_zoo$/m, checked.text);
        assert.match(checked.text, /^ {2}synth \(tools\/synth\.sh\): "make" is an allowed wrapper of site linglong$/m, checked.text);

        const prepared = await himaCommand(
          host,
          h.workspace,
          `/hima pack prepare ${timingProbePackId} --site linglong --campaign ${campaign}`,
          siteCommandTimeoutMs * 3,
        );
        assert.equal(prepared.kind, 'success', prepared.text);
        assert.match(prepared.text, new RegExp(`^prepared ${workspace} `), prepared.text);

        // The six pieces the run contract names, and nothing else, in the flow copy.
        const listed = onTheSite(`ls -1 -- ${posixQuote(`${workspace}/flow`)}`).trim().split('\n').sort();
        assert.deepEqual(listed, ['Makefile', 'build', 'flows', 'manifests', 'sources', 'tools'], `the flow copy holds what the contract named: ${listed.join(', ')}`);
        assert.equal(onTheSite(`test -d ${posixQuote(`${workspace}/flow/sources/opene902`)} && echo there`).trim(), 'there');
        assert.equal(onTheSite(`test -d ${posixQuote(`${workspace}/flow/build/opene902`)} && echo there`).trim(), 'there');
        // About 56 MB of it, which is the design's sources; a copy far off that is a copy of the
        // wrong thing, whichever way it is wrong.
        const kib = Number(onTheSite(`du -sk -- ${posixQuote(`${workspace}/flow`)}`).trim().split(/\s+/)[0]);
        assert.ok(kib > 40_000 && kib < 90_000, `the flow copy is about 56 MB; it is ${Math.round(kib / 1024)} MB`);

        const file = JSON.parse(onTheSite(`cat -- ${posixQuote(`${workspace}/workspace.json`)}`));
        assert.equal(file.campaign, campaign);
        assert.equal(file.site, 'linglong');
        assert.equal(file.design, 'opene902');
        assert.equal(file.flowRoot, designZoo);
        assert.equal(file.workspace, workspace);
        assert.equal(file.containerName, `hima-${campaign}`, 'the campaign\'s own container, so the flow copy is bound into it and not the site\'s');
        assert.deepEqual(file.copied, ['Makefile', 'flows', 'manifests', 'tools', 'build/opene902', 'sources/opene902']);

        const records = workspaceRecords(host, prepared.runId!);
        assert.deepEqual(records.map((r) => r.event), ['prepared']);
        assert.equal(records[0]!.siteId, 'linglong');
        assert.equal(records[0]!.workspace, workspace);
        assert.equal(records[0]!.containerName, `hima-${campaign}`);

        // The whole point, asserted against the site itself: the Design Zoo was read and not written.
        assert.equal(
          onTheSite(`stat -c %Y -- ${posixQuote(baselineQor)}`).trim(),
          baselineBefore,
          'the site\'s own opene902 qor report is exactly as it was: a campaign never writes the site\'s results',
        );

        // Preparing again finds it and copies nothing: 56 MB is not paid twice, and a generation's
        // results would not survive it being.
        const again = await himaCommand(
          host,
          h.workspace,
          `/hima pack prepare ${timingProbePackId} --site linglong --campaign ${campaign}`,
          siteCommandTimeoutMs,
        );
        assert.equal(again.kind, 'success', again.text);
        assert.match(again.text, /^already prepared: /, again.text);
        assert.deepEqual(workspaceRecords(host, again.runId!).map((r) => r.event), ['reused']);
      } finally {
        collectRemoteCommands();
        await host.dispose();
      }
    } finally {
      // Remove only what this test created, inside the one write root the permit allows. The harness
      // itself removes nothing on a Site; this is the test's own ssh, as in `jobs.test.ts`.
      assert.ok(workspace.startsWith(`${campaignRoot}/hima-test-`), 'nothing but the test\'s own workspace is ever removed');
      onTheSite(`rm -rf -- ${posixQuote(workspace)}`);
      await h.dispose();
    }
  });

  test('a campaign workspace outside the permit\'s write roots is refused before anything is created on the site', async () => {
    const h = await createHimaHome();
    const { sitesDir } = await installReferenceSite(h);
    await installPack(h);
    // The reference site file, varied in one place: it now binds the workspace root to the Design
    // Zoo itself — the exact mistake the write roots exist to catch.
    const varied = (await readFile(path.join(sitesDir, 'linglong.yml'), 'utf8'))
      .replace('name: linglong', 'name: misbound')
      .replace(`  workspaceRoot: ${campaignRoot}`, `  workspaceRoot: ${designZoo}`);
    assert.match(varied, new RegExp(`^ {2}workspaceRoot: ${designZoo}$`, 'm'), 'the reference site file is the one being varied');
    await writeFile(path.join(sitesDir, 'misbound.yml'), varied);
    const host = await bootInProcess(h);
    clearRemoteCommands();
    try {
      const refused = await himaCommand(
        host,
        h.workspace,
        `/hima pack prepare ${timingProbePackId} --site misbound --campaign hima-test-refused`,
        siteCommandTimeoutMs,
      );
      assert.equal(refused.kind, 'error', refused.text);
      assert.match(refused.text, /outside the permitted write roots/, refused.text);
      const records = recordsOf(host, refused.runId!);
      assert.equal(records.length, 1);
      assert.equal(records[0]!.type, 'refusal');
      assert.equal(records[0]!.writer, 'shell');
      const ran = collectRemoteCommands();
      assert.ok(ran.length > 0, 'the permit decision resolved the path on the site');
      assert.deepEqual(
        ran.filter((c) => c.argv[0] !== 'realpath'),
        [],
        `nothing but the resolution the decision needed was run: ${JSON.stringify(ran.map((c) => c.argv))}`,
      );
    } finally {
      await host.dispose();
      await h.dispose();
    }
  });

  test('every command the site was asked to run was a read or a write inside the campaign workspace, on the wire it decided on', (t) => {
    assert.ok(sentToTheSite.length > 0, 'the tests above ran commands on the site');
    for (const { argv } of sentToTheSite) t.diagnostic(`asked the site to run: ${argv.join(' ')}`);
    for (const { argv, wire } of sentToTheSite) {
      const verb = argv[0] ?? '';
      assert.ok(['realpath', 'cat', 'test', 'mkdir', 'cp', 'tee'].includes(verb), `not a verb this ticket runs on a site: ${JSON.stringify(argv)}`);
      assert.equal(wire, argv.map(quote).join(' '), `the wire is not every argv word independently quoted: ${JSON.stringify({ argv, wire })}`);
      for (const word of argv.slice(1)) {
        if (!word.startsWith('/data/')) continue;
        // The campaign root and what is under it (every write), the flow being read, and the permit's
        // own read root, which each read decision resolves before it allows anything.
        const allowed =
          word === campaignRoot || word.startsWith(`${campaignRoot}/`)
          || word === designZoo || word.startsWith(`${designZoo}/`)
          || word === permitReadRoot;
        assert.ok(allowed, `a path neither under the campaign root nor in the flow being read reached the wire: ${JSON.stringify(argv)}`);
      }
    }
    // A path under the Design Zoo appears only where a copy reads from it, never where one writes.
    for (const { argv } of sentToTheSite.filter((c) => c.argv[0] === 'mkdir' || c.argv[0] === 'tee')) {
      assert.ok(argv.at(-1)!.startsWith(`${campaignRoot}/hima-test-`), `a write outside the test's own workspace: ${JSON.stringify(argv)}`);
    }
    for (const { argv } of sentToTheSite.filter((c) => c.argv[0] === 'cp')) {
      assert.ok(argv.at(-2)!.startsWith(`${designZoo}/`), `a copy from somewhere other than the site's flow: ${JSON.stringify(argv)}`);
      assert.ok(argv.at(-1)!.startsWith(`${campaignRoot}/hima-test-`), `a copy into somewhere other than the test's own workspace: ${JSON.stringify(argv)}`);
    }
    assert.deepEqual(
      sentToTheSite.filter((c) => ['rm', 'mv', 'tmux'].includes(c.argv[0]!)),
      [],
      'this ticket removes nothing, moves nothing, and launches nothing on a Site',
    );
    const verbs = [...new Set(sentToTheSite.map((c) => c.argv[0]))].sort();
    // `test` is the write decision asking whether the first segment it is about to create is truly
    // nothing — a path that exists and does not resolve would be written through, at whatever it
    // points at.
    assert.deepEqual(verbs, ['cat', 'cp', 'mkdir', 'realpath', 'tee', 'test'], 'the whole command set this ticket runs on a Site');
  });
});

