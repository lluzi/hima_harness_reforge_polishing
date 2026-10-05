import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import type { PathResolver } from '../../packages/harness/lib/types/shell.js';
import type { Site } from '../../packages/harness/lib/types/sites.js';

const { decideRead } = await import(new URL('../../packages/harness/lib/shell.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/shell.js');
const { LocalChannel } = await import(new URL('../../packages/harness/lib/channel.js', import.meta.url).href) as typeof import('../../packages/harness/lib/types/channel.js');

function site(allowedReadRoots: string[], workspaceRoot = '/work'): Site {
  return {
    name: 'read-permit', kind: 'local', workspaceRoot, permit: 'fixture.permit.yml',
    bindings: {}, capacity: { cores: 1, memoryGiB: 1, parallelJobs: 1, licences: {} },
    file: 'fixture.site.yml', permitFile: 'fixture.permit.yml', permitSha256: 'fixture',
    permitRules: { allowedReadRoots, allowedWriteRoots: [], allowedWrappers: [], forbidden: [] },
  };
}

function resolver(paths: Record<string, string>, calls: string[]): PathResolver {
  return {
    async realpath(requested) {
      calls.push(requested);
      const real = paths[requested];
      if (real === undefined) throw new Error('unresolvable fixture path');
      return real;
    },
    async absent() { throw new Error('reads must not probe absence'); },
  };
}

test('reading a real artifact under the last of 25 resolvable roots uses at most two realpath calls', async (t) => {
  const temporary = await mkdtemp(path.join(process.env.HIMA_TEST_TMPDIR ?? '/tmp', 'read-permit-cost-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const base = await realpath(temporary);
  const roots = Array.from({ length: 25 }, (_, i) => path.join(base, `root-${i}`));
  await Promise.all(roots.map((root) => mkdir(root)));
  const artifact = path.join(roots[24]!, 'artifact');
  await writeFile(artifact, 'retained engineering artifact');
  const channel = new LocalChannel();
  const calls: string[] = [];
  const on: PathResolver = {
    async realpath(requested) { calls.push(requested); return channel.realpath(requested); },
    absent: (requested) => channel.absent(requested),
  };
  assert.deepEqual(await decideRead(site(roots), artifact, on), { ok: true, absPath: artifact });
  assert.ok(calls.length <= 2, `expected at most 2 fresh realpath calls; observed ${calls.length}`);
});

test('normalized literal root hints avoid unrelated resolutions', async () => {
  const calls: string[] = [];
  const on = resolver({ '/data/file': '/data/file', '/unrelated': '/unrelated', '/data/./': '/data' }, calls);
  assert.deepEqual(await decideRead(site(['/unrelated', '/data/./']), '/data/file', on), { ok: true, absPath: '/data/file' });
  assert.equal(calls.length, 2);
});

test('a misleading literal root cannot approve a file, but a resolved alias root can', async () => {
  for (const roots of [['/data'], ['/alias', '/data']]) {
    const calls: string[] = [];
    const on = resolver({ '/data/file': '/data/file', '/data': '/elsewhere', '/alias': '/data' }, calls);
    const decision = await decideRead(site(roots), '/data/file', on);
    assert.equal(decision.ok, roots.includes('/alias'));
    if (decision.ok) assert.equal(decision.absPath, '/data/file');
  }
});

test('missing preferred roots fall through to aliases and path-prefix siblings remain refused', async () => {
  const calls: string[] = [];
  const on = resolver({ '/data/file': '/data/file', '/alias': '/data', '/data-sibling/file': '/data-sibling/file' }, calls);
  assert.equal((await decideRead(site(['/data', '/alias']), '/data/file', on)).ok, true);
  assert.equal((await decideRead(site(['/alias']), '/data-sibling/file', on)).ok, false);
  assert.equal((await decideRead(site([]), '/data/file', on)).ok, false);
  assert.equal((await decideRead(site(['/alias']), '/missing', on)).ok, false);
});

test('LocalChannel authorizes alias roots and in-root links, refuses escapes, and resolves roots freshly', async (t) => {
  const temporary = await mkdtemp(path.join(process.env.HIMA_TEST_TMPDIR ?? '/tmp', 'read-permit-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const base = await realpath(temporary);
  const allowed = path.join(base, 'allowed');
  const outside = path.join(base, 'outside');
  const alias = path.join(base, 'alias');
  await mkdir(allowed);
  await mkdir(outside);
  const artifact = path.join(allowed, 'artifact');
  const secret = path.join(outside, 'secret');
  await writeFile(artifact, 'artifact');
  await writeFile(secret, 'secret');
  await symlink(allowed, alias);
  await symlink(artifact, path.join(allowed, 'inside-link'));
  await symlink(secret, path.join(allowed, 'escape'));
  const channel = new LocalChannel();
  const permit = site([alias], allowed);
  assert.deepEqual(await decideRead(permit, artifact, channel), { ok: true, absPath: artifact });
  assert.deepEqual(await decideRead(permit, 'inside-link', channel), { ok: true, absPath: artifact });
  assert.equal((await decideRead(permit, 'escape', channel)).ok, false);
  await unlink(alias);
  await symlink(outside, alias);
  assert.equal((await decideRead(permit, artifact, channel)).ok, false, 'retargeted alias is not cached');
  assert.deepEqual(await decideRead(permit, secret, channel), { ok: true, absPath: secret });
});
