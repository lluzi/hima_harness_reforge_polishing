// Live files must be selected explicitly; a broad node --test glob is not a live opt-in.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function requireLiveSite(): void {
  assert.equal(process.env.HIMA_TEST_GROUP, 'live-site', 'select real Site tests with: node scripts/run-contract-tests.mjs live-site');
  assert.ok(process.env.HIMA_TEST_TMPDIR, 'live Site tests require a private temporary directory');
  assert.equal(realpathSync(os.tmpdir()), process.env.HIMA_TEST_TMPDIR, 'SSH control sockets must live in the test invocation directory');
}

/** Refuse to damage a socket outside this invocation, even if a future channel changes its path. */
export function ownControlPath(socket: string): string {
  requireLiveSite();
  assert.equal(path.dirname(socket), process.env.HIMA_TEST_TMPDIR, 'only a test-owned SSH control path may be changed');
  return socket;
}
