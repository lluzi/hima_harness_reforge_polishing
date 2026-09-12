// L2: the real command's file selection and subprocess boundary, in a throwaway test tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from './support/dsh-home.ts';

async function entryFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'entry-'));
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  await mkdir(path.join(root, 'test/contract/support'), { recursive: true });
  for (const file of ['scripts/run-contract-tests.mjs', 'scripts/require-node.mjs', 'test/contract/support/no-ssh.mjs']) {
    await cp(path.join(repoRoot, file), path.join(root, file));
  }
  const groups = { local: ['test/contract/local.test.mjs'], desktop: ['test/contract/desktop.test.mjs'], 'live-site': ['test/contract/site.test.mjs'] };
  for (const [group, [file]] of Object.entries(groups)) {
    await writeFile(path.join(root, file!), `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(path.join(root, 'loaded'))}, ${JSON.stringify(group + '\n')});`);
  }
  const save = () => writeFile(path.join(root, 'test/contract-groups.json'), JSON.stringify(groups));
  await save();
  const env = { ...process.env };
  // This is a new CLI invocation, not a recursive node:test worker.
  delete env.NODE_TEST_CONTEXT;
  return {
    root, groups, save,
    run: (...args: string[]) => spawnSync(process.execPath, [path.join(root, 'scripts/run-contract-tests.mjs'), ...args], { env, encoding: 'utf8', timeout: 30_000 }),
    loaded: () => readFile(path.join(root, 'loaded'), 'utf8').catch(() => ''),
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

test('local selection loads only local files; listing and inventory checking load none', async () => {
  const f = await entryFixture();
  try {
    for (const args of [['--check'], ['live-site', '--list'], ['desktop', '--list']]) {
      const result = f.run(...args);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await f.loaded(), '', 'discovery must not evaluate any test');
    }
    const local = f.run('local');
    assert.equal(local.status, 0, local.stderr);
    assert.equal(await f.loaded(), 'local\n');
    const live = f.run('live-site');
    assert.equal(live.status, 0, live.stderr);
    assert.equal(await f.loaded(), 'local\nlive-site\n', 'explicit selection is required for Site files');
  } finally { await f.dispose(); }
});

test('unclassified, missing and duplicate files stop the entry before any test loads', async () => {
  const f = await entryFixture();
  try {
    const extra = path.join(f.root, 'test/contract/nested/new.test.ts');
    await mkdir(path.dirname(extra));
    await writeFile(extra, "throw new Error('must never be evaluated');");
    const unclassified = f.run('local');
    assert.equal(unclassified.status, 1);
    assert.match(unclassified.stderr, /unclassified.*nested\/new\.test\.ts/);
    await rm(extra);
    f.groups.local.push('test/contract/missing.test.ts');
    await f.save();
    const missing = f.run('--check');
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /missing.*missing\.test\.ts/);
    f.groups.local.pop();
    f.groups.desktop.push(f.groups.local[0]!);
    await f.save();
    const duplicate = f.run('local');
    assert.equal(duplicate.status, 1);
    assert.match(duplicate.stderr, /duplicates.*local\.test\.mjs/);
    assert.equal(await f.loaded(), '');
  } finally { await f.dispose(); }
});

test('a swallowed SSH start attempt still fails the local entry without starting SSH', async () => {
  const f = await entryFixture();
  try {
    await writeFile(path.join(f.root, f.groups.local[0]!), `
      import { spawnSync } from 'node:child_process';
      try { spawnSync('ssh', ['unreachable.invalid', 'true']); } catch {}
    `);
    const result = f.run('local');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /SSH subprocess attempts: 1/);
    assert.match(result.stderr, /"api":"spawnSync","command":"ssh"/);
  } finally { await f.dispose(); }
});

test('the SSH sentinel preserves execFile promise results and still refuses promisified SSH', async () => {
  const f = await entryFixture();
  try {
    await writeFile(path.join(f.root, f.groups.local[0]!), `
      import assert from 'node:assert/strict';
      import { execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      const run = promisify(execFile);
      const result = await run(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err")']);
      assert.deepEqual(result, { stdout: 'out', stderr: 'err' });
      await assert.rejects(run(process.execPath, ['-e', 'process.stderr.write("failed"); process.exit(7)']), { code: 7, stdout: '', stderr: 'failed' });
    `);
    const valid = f.run('local');
    assert.equal(valid.status, 0, valid.stderr);
    await writeFile(path.join(f.root, f.groups.local[0]!), `
      import { execFile } from 'node:child_process';
      import { promisify } from 'node:util';
      try { await promisify(execFile)('ssh', ['unreachable.invalid', 'true']); } catch {}
    `);
    const refused = f.run('local');
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /SSH subprocess attempts: 1/);
  } finally { await f.dispose(); }
});

test('an explicit subset runs only named files in its group and rejects empty or foreign selections', async () => {
  const f = await entryFixture();
  try {
    const other = 'test/contract/other.test.mjs';
    await writeFile(path.join(f.root, other), "throw new Error('unselected local file must not load');");
    f.groups.local.push(other);
    await f.save();
    for (const files of [[], [f.groups.desktop[0]!], ['test/contract/absent.test.mjs']]) {
      const rejected = f.run('local', '--files', ...files);
      assert.equal(rejected.status, 1, rejected.stderr);
      assert.equal(await f.loaded(), '', 'invalid subsets fail before module evaluation');
    }
    const selected = f.run('local', '--files', f.groups.local[0]!);
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(await f.loaded(), 'local\n');
    assert.match(selected.stderr, /1 selected; 1 unselected in local/);
    assert.match(selected.stderr, /command exit code: 0/);
  } finally { await f.dispose(); }
});
