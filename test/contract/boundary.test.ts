// Ticket #57: the pack-first boundary, enforced rather than remembered.
//
// D46 says changes go into the HimaPack first and the harness changes only for a gap no pack can
// fill — so nothing in `packages/` names a design, a technology, a vendor's tool, a mining route or
// a report of one. That was a rule three reviews had to re-read the diff for. `check:boundary` is
// the rule as a check: one noun list at the top of one script, one exemption list beside it, each
// exemption naming the ticket that removes it.
//
// Two subjects here, and both can fail. The tree passes — which is the claim the pre-commit hook
// makes on every commit, and which also holds the exemption list honest, since the script refuses an
// exemption for a noun its file no longer holds. And a file with a noun in it does not pass: a check
// that cannot say no is not a check, and a fixture tree is how that is shown without writing a
// forbidden noun into this repository's own sources.
//
// No host and no Site: the subject is a script reading files, so this test runs it as a person does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { repoRoot } from './support/dsh-home.ts';

const run = promisify(execFile);

const script = path.join(repoRoot, 'scripts/check-boundary.mjs');

/** Run the check, and answer what it exited with and said — a non-zero exit is an answer here, not
 *  a reason to throw, because half of this test is about the check saying no. */
async function checkBoundary(args: readonly string[] = []): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args], { cwd: repoRoot });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    const failed = err as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, out: `${failed.stdout ?? ''}${failed.stderr ?? ''}` };
  }
}

test('the boundary check passes on this tree, with every exemption it allows still needed', async () => {
  const { code, out } = await checkBoundary();
  assert.equal(code, 0, out);
  assert.match(out, /^boundary: /m, `it says what it checked: ${out}`);
});

test('a vendor tool\'s name in a file under packages/ fails the boundary check, naming the noun, the file and the line', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const at = path.join(root, 'packages/harness/src');
  await mkdir(at, { recursive: true });
  // An illustrative comment of exactly the kind the wave-1 review found ~30 of: harmless-looking,
  // and a harness file naming the vendor's tool all the same.
  await writeFile(path.join(at, 'budget.ts'), '// A generation is two and a half minutes of dc_shell, so a budget is not a formality.\nexport const nothing = 0;\n');
  // And one file with nothing to find, so a pass is not the check failing to look.
  await writeFile(path.join(at, 'quiet.ts'), '// A generation is two and a half minutes of a licensed synthesis, so a budget is not a formality.\nexport const also = 0;\n');

  const { code, out } = await checkBoundary(['--root', root]);
  assert.equal(code, 1, `a noun outside every exemption fails: ${out}`);
  assert.match(out, /dc_shell/, `the noun is named: ${out}`);
  assert.match(out, /packages\/harness\/src\/budget\.ts:1/, `and the file and line a person has to edit: ${out}`);
  assert.doesNotMatch(out, /quiet\.ts/, `the file that names nothing is not reported: ${out}`);
});

test('an exemption whose file no longer names the noun it was written for fails the check, so the list says what is actually there', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // The file the check exempts for the bundle's own reader library, present and naming nothing:
  // which is what the day a pack ships scripts for these report kinds looks like. An exemption
  // nobody prunes is a list that has stopped being a list, so the check refuses it rather than
  // quietly allowing a noun that is no longer there.
  const at = path.join(root, 'packages/harness/src');
  await mkdir(at, { recursive: true });
  await writeFile(path.join(at, 'readers.ts'), '// Readers turn report bytes into typed semantics, and this one names no vendor at all.\nexport const nothing = 0;\n');

  const { code, out } = await checkBoundary(['--root', root]);
  assert.equal(code, 1, `a stale exemption fails: ${out}`);
  assert.match(out, /packages\/harness\/src\/readers\.ts: is exempted for "Design Compiler" \([^)]*\) and no longer names it — remove the exemption/, out);
  assert.match(out, /is exempted for "verify_drc"/, `every noun of that entry, one by one: ${out}`);
  // And no complaint about the exemptions whose files this fixture tree does not hold at all: that
  // would be an answer about the fixture rather than about the harness.
  assert.doesNotMatch(out, /local-site\.ts/, out);
});

test('a directory under the scanned tree that cannot be read fails the check, naming it, rather than reading as a directory holding nothing', async (t) => {
  // Fail closed (the wave-2 lesson): a scan whose `readdir` answers "nothing here" on any error is a
  // D46 check that passes for a tree it never looked at. Only `ENOENT` is absence — a path that is
  // simply not there answers nothing, which is what a fixture tree holding four of the scanned
  // directories and not the fifth relies on. Everything else names the path and stops.
  if (process.getuid?.() === 0) {
    t.skip('running as root, which reads a 0700-less directory anyway, so there is no unreadable directory to make');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'hima-boundary-'));
  const sealed = path.join(root, 'packages/harness/src/sealed');
  await mkdir(sealed, { recursive: true });
  await writeFile(path.join(sealed, 'inside.ts'), '// A generation is two and a half minutes of dc_shell.\nexport const hidden = 0;\n');
  await chmod(sealed, 0o000);
  t.after(async () => {
    // Restored however this ends, so the temporary tree can be removed at all.
    await chmod(sealed, 0o755).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  const { code, out } = await checkBoundary(['--root', root]);
  assert.equal(code, 1, `a directory the check cannot read is a failure, not a pass: ${out}`);
  assert.match(out, /cannot be read/, `and it says what went wrong: ${out}`);
  assert.match(out, /packages\/harness\/src\/sealed/, `naming the directory a person has to look at: ${out}`);
});
