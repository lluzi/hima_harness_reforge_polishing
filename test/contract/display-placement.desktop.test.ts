// A missing explicit display is a pre-window, pre-Host refusal. No UI is opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { electronBinary, whyNoWindow } from './support/driver.ts';
import { repoRoot, recordTestBoot } from './support/dsh-home.ts';

test('an explicit unavailable Catsights display refuses before the desktop shell opens a window or launches a Host', async (t) => {
  if (whyNoWindow() !== undefined) { t.skip('Electron has no window server in this session'); return; }
  const electron = electronBinary();
  if ('missing' in electron) { t.skip(electron.missing); return; }
  const home = await mkdtemp(path.join(os.tmpdir(), 'hima-display-refusal-'));
  try {
    recordTestBoot('electron');
    const result = spawnSync(electron.at, [path.join(repoRoot, 'packages/desktop/lib/main.js'), '--driver'], {
      cwd: home,
      encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, HIMA_DRIVER_DISPLAY: '__missing_catsights__', HIMA_NODE: process.execPath, HIMA_USER_DATA: path.join(home, 'electron'), DSH_HOME: path.join(home, 'dsh') },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /requested display .*unavailable; refusing before opening a window or starting a Host/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
