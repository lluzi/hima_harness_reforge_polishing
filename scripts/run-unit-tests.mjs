// The unit-test half of the pre-commit hook, said honestly. HimaHarness's one agreed test seam is
// the booted Host (`test/contract`, ADR-0001), so today there are no unit tests at all — but "none
// to run" and "they all passed" must never look the same from the outside, and a shell one-liner
// that swallows node --test's exit code makes them identical. This script says which of the two
// happened and, when unit tests do exist, lets their failure stop the commit.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/** Every `*.test.ts` under a package's `src/`: where a unit test would live if one existed. */
function unitTestFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'lib') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) found.push(...unitTestFiles(p));
    else if (/\.test\.tsx?$/.test(name) && p.includes(`${path.sep}src${path.sep}`)) found.push(p);
  }
  return found;
}

const files = unitTestFiles('packages').sort();
if (files.length === 0) {
  console.log('no unit tests: the one test seam is the booted Host (test/contract)');
  process.exit(0);
}
console.log(`unit tests: ${String(files.length)} file(s)`);
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (run.error) throw run.error;
process.exit(run.status ?? 1);
