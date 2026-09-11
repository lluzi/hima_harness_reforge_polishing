// Local check of the live test guard; does not create a channel or start SSH.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { requireLiveSite, ownControlPath } from '../../../../test/contract/support/live-site.ts';
const temporary = realpathSync(mkdtempSync('/tmp/hima-scope-'));
try {
  process.env.TMPDIR = temporary;
  process.env.HIMA_TEST_TMPDIR = temporary;
  process.env.HIMA_TEST_GROUP = 'local';
  assert.throws(requireLiveSite, /select real Site tests/);
  process.env.HIMA_TEST_GROUP = 'live-site';
  requireLiveSite();
  const owned = path.join(temporary, 'hima-ssh-0123456789abcdef');
  assert.equal(ownControlPath(owned), owned);
  assert.throws(() => ownControlPath('/tmp/hima-ssh-0123456789abcdef'), /only a test-owned/);
  process.env.TMPDIR = '/tmp';
  assert.throws(requireLiveSite, /SSH control sockets must live/);
  console.log('socket scope: explicit opt-in, owned path, shared-path refusal and TMPDIR mismatch checked; no SSH');
} finally { rmSync(temporary, { recursive: true, force: true }); }
