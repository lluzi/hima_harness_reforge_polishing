// Ticket #2: HimaHarness loads on DeepSeek Harness with the privacy overlay, proven on a booted host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { createHimaHome, runDsh } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';

interface Row { id?: string; name?: string; disabled?: boolean; config?: Record<string, unknown> }

test('the hima profile composes dsh-base, the Hima bundle, and the privacy overlay', async () => {
  const h = await createHimaHome();
  try {
    const run = await runDsh(h, ['--profile', 'hima', '--dump-config']);
    assert.equal(run.code, 0, run.stderr);
    const rows = parse(run.stdout) as Row[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.equal(byId.get('hima')?.name, '@hima/harness', 'the Hima bundle row is composed');
    assert.equal(byId.get('plugin-package-inventory-deepseek')?.config?.enabled, false, 'plugin-name reporting to the DeepSeek API is off');
    assert.equal(byId.get('session-telemetry-otel')?.disabled, true, 'session telemetry is off');
    assert.ok(byId.has('commands'), 'dsh-base is the first layer');
  } finally { await h.dispose(); }
});

test('the hima profile boots as a real host, serves the web app, and stops cleanly on SIGTERM', async () => {
  const h = await createHimaHome();
  try {
    const host = await bootHimaHost(h);
    try {
      // The tokened URL exchanges the token for a session cookie and redirects to the app root.
      const first = await fetch(host.url, { redirect: 'manual' });
      assert.equal(first.status, 303, 'the tokened URL is exchanged for a session');
      const cookie = first.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie, 'a session cookie is issued');
      const res = await fetch(new URL('/', host.url), { headers: { cookie } });
      assert.equal(res.status, 200, 'the web app answers with the session cookie');
      assert.doesNotMatch(host.stderr(), /plugin tree failed to load|failed to import|host preparation failed/i, 'no plugin failed to activate');
    } finally {
      const code = await host.stop();
      assert.equal(code, 0, `host exited ${code}\n${host.stderr()}`);
    }
  } finally { await h.dispose(); }
});
