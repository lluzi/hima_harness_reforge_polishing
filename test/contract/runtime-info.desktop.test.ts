// The release runtime diagnostic exits before BrowserWindow or Host preparation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { electronBinary } from './support/driver.ts';
import { repoRoot, recordTestBoot } from './support/dsh-home.ts';
import path from 'node:path';

test('runtime-info is a no-window diagnostic and identifies the selected Node source without exposing its path', (t) => {
  const electron = electronBinary();
  if ('missing' in electron) { t.skip(electron.missing); return; }
  recordTestBoot('electron');
  const result = spawnSync(electron.at, [path.join(repoRoot, 'packages/desktop/lib/main.js'), '--runtime-info'], {
    cwd: repoRoot, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, HIMA_NODE: process.execPath },
  });
  assert.equal(result.status, 0, result.stderr);
  const info = JSON.parse(result.stdout) as { isPackaged: boolean; node: { source: string; available: boolean } };
  assert.equal(info.isPackaged, false);
  assert.deepEqual(info.node, { source: 'HIMA_NODE', available: true });
  assert.ok(!result.stdout.includes(process.execPath), 'the diagnostic reports selection only, not an environment path');
});
