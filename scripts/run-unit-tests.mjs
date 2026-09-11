// An empty unit suite is not coverage. Propagate actual failures when unit files exist.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import './require-node.mjs';

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
  console.log('unit tests: 0 files; not run (no coverage claimed); command exit code: 0. Current L1/L2 checks are in test/contract.');
  process.exit(0);
}
console.log(`unit tests: ${String(files.length)} file(s)`);
const run = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (run.error) throw run.error;
console.log(`unit command exit code: ${run.status ?? 1}`);
process.exit(run.status ?? 1);
