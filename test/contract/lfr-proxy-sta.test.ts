import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const timingDir = path.join(
  repoRoot, 'packs/custom-cell-fmax-dtco/flow/domain/cell_need_miner',
);

test('LFR strict Liberty and proxy-STA logic passes its fail-closed fixture suite', () => {
  const ran = spawnSync('/usr/bin/python3', [
    '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_liberty_timing.py', '-v',
  ], { cwd: timingDir, encoding: 'utf8' });
  assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
  assert.match(ran.stderr, /Ran \d+ tests/);
  assert.match(ran.stderr, /OK/);
});
