// PLS-29: Site discovery is a bounded, non-Campaign observation that produces the same Site/Permit
// files the rest of Hima already reads. This suite never opens SSH; the fake channel proves the
// closed probe vocabulary independently from a remote machine.
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverSshSite, discoverSiteFacts, siteDiscoveryProbes, discoveryIsStale, loadSite, saveDiscoveredSite, siteSaveIdentity } from '@hima/harness';
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
  const facts = await discoverSiteFacts(channel, ['genus']);
  assert.deepEqual(seen, [...siteDiscoveryProbes.map((probe) => [...probe]), ['which', 'genus']]);
  assert.equal(facts.find((fact) => fact.probe.join(' ') === 'which genus')?.code, 1, 'a missing tool is an explicit fact, not a fallback shell command');
  assert.ok(seen.every(([verb]) => !['rm', 'mkdir', 'tee', 'cp', 'sh', 'bash', 'sudo'].includes(verb!)), 'discovery contains neither writes nor an unbounded shell');
});

test('discovery derives real capacity while bounding free parallel work to five Jobs', async () => {
  const channel: Channel = {
    siteName: 'lab-a', realpath: async (p) => p, absent: async () => true, readFile: async () => new Uint8Array(),
    exec: async (argv): Promise<ExecResult> => {
      const key = argv.join(' ');
      const stdout = key === 'getconf _NPROCESSORS_ONLN' ? '32\n'
        : key === 'cat -- /proc/meminfo' ? 'MemTotal:       125829120 kB\nMemFree: 1 kB\n'
          : key === 'uname -s' ? 'Linux\n' : key === 'tmux -V' ? 'tmux 3.4\n' : '';
      return { code: 0, stdout: Buffer.from(stdout), stderr: '' };
    },
  };
  const discovered = await discoverSshSite(request, () => channel);
  assert.deepEqual(discovered.site.capacity, { cores: 32, memoryGiB: 120, parallelJobs: 5, licences: {} });
});

test('a saved draft is an ordinary loadable Site whose derived discovery cache is redacted', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    const saved = saveDiscoveredSite(sitesDir, result());
    assert.equal(saved.name, request.name);
    assert.deepEqual(saved.permitRules.allowedWriteRoots, ['/work/hima']);
    const policy = await readFile(path.join(sitesDir, 'lab-a.yml'), 'utf8');
    const observation = await readFile(path.join(sitesDir, 'lab-a.discovery.json'), 'utf8');
    assert.doesNotMatch(policy, /discovery|never-save-me|password=/, 'derived discovery does not become administrator policy');
    assert.doesNotMatch(observation, /never-save-me/, 'a credential-shaped discovery value does not reach the cache');
    assert.match(observation, /password=\[redacted\]/);
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

test('legacy inline discovery remains readable when no derived cache exists', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    const permitFile = path.join(sitesDir, 'legacy.permit.yml');
    const siteFile = path.join(sitesDir, 'legacy.yml');
    await writeFile(permitFile, 'allowedReadRoots: []\nallowedWriteRoots: []\nallowedWrappers: []\nforbidden: [deletions]\n');
    await writeFile(siteFile, [
      'name: legacy', 'kind: ssh', 'workspaceRoot: /legacy', 'permit: ./legacy.permit.yml',
      'bindings: {}', 'ssh:', '  destination: owner@legacy.example.com',
      'discovery:', '  observedAt: "2026-09-14T00:00:00.000Z"', `  inputFingerprint: ${'b'.repeat(64)}`,
      '  facts: []', '  unknowns: []', '  stale: false',
      'capacity:', '  cores: 1', '  memoryGiB: 1', '  parallelJobs: 1', '  licences: {}', '',
    ].join('\n'));
    assert.equal(loadSite(sitesDir, 'legacy').discovery?.inputFingerprint, 'b'.repeat(64));
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});

test('rediscovery preserves reviewed Site policy and Permit bytes, and rejects stale or unknown-policy previews', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    saveDiscoveredSite(sitesDir, result());
    const siteFile = path.join(sitesDir, 'lab-a.yml');
    const permitFile = path.join(sitesDir, 'owner-controlled.permit.yml');
    const permitBytes = '# the Site owner owns these bytes\nallowedReadRoots:\n  - /pdk\nallowedWriteRoots:\n  - /work/hima\nallowedWrappers:\n  - genus\nforbidden:\n  - deletions\n';
    await writeFile(permitFile, permitBytes);
    await writeFile(siteFile, [
      'name: lab-a', 'kind: ssh', 'workspaceRoot: /owner/workspace', 'permit: ./owner-controlled.permit.yml',
      'bindings:', '  designRoot: /owner/design', '  workspaceRoot: /owner/workspace',
      'ssh:', '  destination: owner@lab.example.com', 'capacity:', '  cores: 24', '  memoryGiB: 96', '  parallelJobs: 3', '  licences:', '    Genus: 0', '    PrimeTime: 2', '',
    ].join('\n'));

    const preview = siteSaveIdentity(sitesDir, 'lab-a');
    const siteBytes = await readFile(siteFile, 'utf8');
    const draft = result();
    const rediscovered = {
      ...draft,
      site: {
        ...draft.site,
        workspaceRoot: '/unreviewed/workspace',
        bindings: { unreviewed: '/unreviewed' },
        capacity: { cores: 1, memoryGiB: 1, parallelJobs: 1, licences: { Genus: 9 } },
        permit: './unreviewed.permit.yml',
        ssh: { destination: 'owner@lab.example.com', jumps: [], controlPersistSeconds: 60 },
      },
      permit: { allowedReadRoots: ['/unreviewed'], allowedWriteRoots: ['/unreviewed'], allowedWrappers: ['rm'], forbidden: [] },
    };
    const saved = saveDiscoveredSite(sitesDir, rediscovered, preview);

    assert.equal(saved.workspaceRoot, '/owner/workspace');
    assert.deepEqual(saved.bindings, { designRoot: '/owner/design', workspaceRoot: '/owner/workspace' });
    assert.deepEqual(saved.capacity, { cores: 24, memoryGiB: 96, parallelJobs: 3, licences: { Genus: 0, PrimeTime: 2 } });
    assert.equal(saved.permit, './owner-controlled.permit.yml');
    assert.equal(saved.discovery?.observedAt, draft.site.discovery.observedAt);
    assert.equal(await readFile(siteFile, 'utf8'), siteBytes, 'rediscovery never rewrites owner-reviewed Site bytes');
    assert.equal(await readFile(permitFile, 'utf8'), permitBytes, 'rediscovery never rewrites owner-reviewed Permit bytes');

    const changedTarget = result();
    assert.throws(() => saveDiscoveredSite(sitesDir, changedTarget, siteSaveIdentity(sitesDir, 'lab-a')), /target conflicts/);

    await writeFile(siteFile, `${await readFile(siteFile, 'utf8')}# a concurrent policy edit\n`);
    assert.equal(loadSite(sitesDir, 'lab-a').discovery, undefined, 'a cache bound to older policy bytes is not projected as current discovery');
    assert.throws(() => saveDiscoveredSite(sitesDir, result(), preview), /Site discovery preview is stale/);

    await writeFile(siteFile, (await readFile(siteFile, 'utf8')).replace(
      'capacity:\n  cores: 24', 'capacity:\n  unrecognizedPolicy: true\n  cores: 24',
    ));
    assert.throws(() => saveDiscoveredSite(sitesDir, result()), /unrecognizedPolicy/);
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});

test('a first discovery refuses to overwrite an orphan Permit', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    const orphan = path.join(sitesDir, 'lab-a.permit.yml');
    const bytes = '# owner material before Site creation\nallowedReadRoots: []\nallowedWriteRoots: []\nallowedWrappers: []\nforbidden: []\n';
    await writeFile(orphan, bytes);
    assert.throws(() => saveDiscoveredSite(sitesDir, result()), /Permit .*appeared|already exists/);
    assert.equal(await readFile(orphan, 'utf8'), bytes);

    await rm(orphan);
    const ownerFile = path.join(sitesDir, 'administrator.permit.yml');
    await writeFile(ownerFile, bytes);
    await symlink(ownerFile, orphan);
    assert.throws(() => saveDiscoveredSite(sitesDir, result()), /Permit .*appeared|already exists/);
    assert.equal(await readFile(ownerFile, 'utf8'), bytes, 'a Permit symlink collision is not followed or replaced');
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});

test('unknown and symlinked discovery-cache collisions are preserved', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    saveDiscoveredSite(sitesDir, result());
    const cache = path.join(sitesDir, 'lab-a.discovery.json');
    const unknown = '{"owner":"not-hima"}\n';
    await rm(cache);
    await writeFile(cache, unknown);
    assert.equal(loadSite(sitesDir, 'lab-a').discovery, undefined, 'an unknown cache is unavailable rather than trusted');
    assert.throws(() => saveDiscoveredSite(sitesDir, result(), siteSaveIdentity(sitesDir, 'lab-a')), /discovery cache collision/);
    assert.equal(await readFile(cache, 'utf8'), unknown);

    await rm(cache);
    const ownerFile = path.join(sitesDir, 'owner-observation.json');
    await writeFile(ownerFile, unknown);
    await symlink(ownerFile, cache);
    assert.equal(loadSite(sitesDir, 'lab-a').discovery, undefined, 'a symlinked cache is unavailable rather than followed');
    assert.throws(() => saveDiscoveredSite(sitesDir, result(), siteSaveIdentity(sitesDir, 'lab-a')), /discovery cache collision/);
    assert.equal(await readFile(ownerFile, 'utf8'), unknown);
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});

test('a Site and Permit published after a new-Site preview are never clobbered', async () => {
  const sitesDir = await mkdtemp(path.join(tmpdir(), 'hima-discovery-'));
  try {
    const preview = siteSaveIdentity(sitesDir, 'lab-a');
    const permitFile = path.join(sitesDir, 'lab-a.permit.yml');
    const siteFile = path.join(sitesDir, 'lab-a.yml');
    const permitBytes = 'allowedReadRoots: [/admin]\nallowedWriteRoots: []\nallowedWrappers: []\nforbidden: [deletions]\n';
    const siteBytes = [
      'name: lab-a', 'kind: ssh', 'workspaceRoot: /admin', 'permit: ./lab-a.permit.yml',
      'bindings: {}', 'ssh:', '  destination: admin@other.example.com',
      'capacity:', '  cores: 2', '  memoryGiB: 4', '  parallelJobs: 1', '  licences: {}', '',
    ].join('\n');
    await writeFile(permitFile, permitBytes);
    await writeFile(siteFile, siteBytes);

    assert.throws(() => saveDiscoveredSite(sitesDir, result(), preview), /preview is stale/);
    assert.equal(await readFile(siteFile, 'utf8'), siteBytes);
    assert.equal(await readFile(permitFile, 'utf8'), permitBytes);
  } finally { await rm(sitesDir, { recursive: true, force: true }); }
});
