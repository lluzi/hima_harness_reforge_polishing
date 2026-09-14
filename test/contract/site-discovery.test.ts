// PLS-29: Site discovery is a bounded, non-Campaign observation that produces the same Site/Permit
// files the rest of Hima already reads. This suite never opens SSH; the fake channel proves the
// closed probe vocabulary independently from a remote machine.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverSiteFacts, siteDiscoveryProbes, discoveryIsStale, loadSite, saveDiscoveredSite } from '@hima/harness';
import type { Channel, ExecResult, SiteDiscoveryResult } from '@hima/harness';

const request = {
  name: 'lab-a',
  ssh: { destination: 'engineer@lab.example.com', jumps: [], controlPersistSeconds: 60 },
  hints: { workspaceRoot: '/work/hima', allowedReadRoots: ['/work'], allowedWriteRoots: ['/work/hima'], allowedWrappers: ['make'] },
};

function result(name = 'lab-a'): SiteDiscoveryResult {
  return {
    site: {
      name, kind: 'ssh', workspaceRoot: '/work/hima', permit: `./${name}.permit.yml`, bindings: {}, ssh: request.ssh,
      capacity: { cores: 1, memoryGiB: 1, parallelJobs: 1, licences: {} },
      discovery: {
        observedAt: '2026-09-14T00:00:00.000Z',
        inputFingerprint: 'a'.repeat(64), stale: false,
        facts: [{ probe: ['uname', '-s'], code: 0, stdout: 'Linux password=never-save-me' }],
        unknowns: ['licence utility was not identified; no licence claim was made'],
      },
    },
    permit: { allowedReadRoots: ['/work'], allowedWriteRoots: ['/work/hima'], allowedWrappers: ['make'], forbidden: ['deletions'] },
    unknowns: [], conflicts: [],
  };
}

test('discovery executes exactly the fixed safe probe list and keeps missing commands as answers', async () => {
  const seen: string[][] = [];
  const channel: Channel = {
    siteName: 'fake', realpath: async (p) => p, absent: async () => true, readFile: async () => new Uint8Array(),
    exec: async (argv): Promise<ExecResult> => {
      seen.push([...argv]);
      return { code: argv[0] === 'which' && argv[1] === 'genus' ? 1 : 0, stdout: Buffer.from(argv.join(' ')), stderr: '' };
    },
  };
  const facts = await discoverSiteFacts(channel);
  assert.deepEqual(seen, siteDiscoveryProbes.map((probe) => [...probe]));
  assert.equal(facts.find((fact) => fact.probe.join(' ') === 'which genus')?.code, 1, 'a missing tool is an explicit fact, not a fallback shell command');
  assert.ok(seen.every(([verb]) => !['rm', 'mkdir', 'tee', 'cp', 'sh', 'bash', 'sudo'].includes(verb!)), 'discovery contains neither writes nor an unbounded shell');
});

test('a saved draft is an ordinary loadable Site, redacts credential-shaped remote output, and stale input is visible', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    const saved = saveDiscoveredSite(sitesDir, result());
    assert.equal(saved.name, request.name);
    assert.deepEqual(saved.permitRules.allowedWriteRoots, ['/work/hima']);
    const text = await readFile(path.join(sitesDir, 'lab-a.yml'), 'utf8');
    assert.doesNotMatch(text, /never-save-me/, 'a credential-shaped discovery value does not reach the profile');
    assert.match(text, /password=\[redacted\]/);
    assert.equal(discoveryIsStale(saved, request), true, 'a profile with a different observed input fingerprint cannot claim current readiness');
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});

test('a second Site requires its own named profile and cannot be silently satisfied by the first Site file', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    saveDiscoveredSite(sitesDir, result('lab-a'));
    assert.throws(() => loadSite(sitesDir, 'lab-b'), /unknown site "lab-b"/);
    saveDiscoveredSite(sitesDir, result('lab-b'));
    assert.equal(loadSite(sitesDir, 'lab-b').file, path.join(sitesDir, 'lab-b.yml'));
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});
