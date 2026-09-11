// L2: the real Host serves preparation facts before any Campaign exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPack, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite, writeSiteWithDirPermit } from './support/site.ts';
import { writeFile } from 'node:fs/promises';
import { writeStandinFlow } from './support/standin-flow.ts';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, openSession } from './support/hima-api.ts';

test('an empty home explains Pack and Site preparation without creating a Run or contacting a Site', async () => {
  const home = await createHimaHome();
  const host = await bootHimaHost(home);
  try {
    const cookie = await openSession(host);
    const response = await api(host, cookie, '/hima/');
    const html = await response.text();
    assert.equal(response.status, 200, html);
    assert.match(html, /No HimaPack is installed/);
    assert.match(html, /No Site is configured/);
    assert.match(html, /data-hima-state-count="0"/);
    assert.match(html, /data-hima-control="start"[^>]*disabled/);
    const audit = await api(host, cookie, '/hima/api/audit');
    assert.deepEqual((await audit.json() as { commands: unknown[] }).commands, []);
  } finally {
    assert.equal(await host.stop(), 0, host.stderr());
    await home.dispose();
  }
});


test('Pack/Site declarations are checked before start; mismatch and configuration diagnostics remain actionable and fenced', async () => {
  const home = await createHimaHome();
  await installPack(home);
  await writeLocalSite(home); // No bindings: a real static mismatch.
  const host = await bootHimaHost(home);
  try {
    const cookie = await openSession(host);
    const target = `/hima/?pack=${timingProbePackId}&site=local`;
    const html = await (await api(host, cookie, target)).text();
    assert.match(html, /data-hima-region="start-check"/);
    assert.match(html, /data-hima-state-status="unfit"/);
    assert.match(html, /flowRoot.*not bound/);
    assert.match(html, /Site owner/);
    assert.match(html, /Connections, available licences and tools have not been tested/);
    const refused = await api(host, cookie, '/hima/api/runs/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.3 } }),
    });
    assert.equal(refused.status, 400, await refused.text());
    assert.match(await (await api(host, cookie, '/hima/')).text(), /data-hima-state-count="0"/);
    assert.deepEqual((await (await api(host, cookie, '/hima/api/audit')).json() as { commands: unknown[] }).commands, []);
    assert.equal((await fetch(new URL(target, host.url))).status, 401);
    assert.equal((await api(host, cookie, target, { headers: { origin: 'https://foreign.invalid' } })).status, 403);
    await writeLocalSite(home, { bindings: { flowRoot: '/not-checked-remotely', design: 'opene902', workspaceRoot: home.workspace } });
    const fit = await (await api(host, cookie, target)).text();
    assert.match(fit, /data-hima-state-status="fit"/);
    assert.match(fit, /Static declarations match/);
    const unknown = await (await api(host, cookie, '/hima/?pack=missing&site=local')).text();
    assert.match(unknown, /data-hima-state-status="request"/);
    assert.match(unknown, /Select an installed Pack/);
    const badSite = await writeSiteWithDirPermit(home);
    const badConfig = await (await api(host, cookie, `/hima/?pack=${timingProbePackId}&site=${badSite.name}`)).text();
    assert.match(badConfig, /data-hima-state-status="site"/);
    assert.match(badConfig, /Site owner.*configuration/);
    const contract = path.join(packsDirOf(home), timingProbePackId, 'contract.yml');
    await writeFile(contract, 'not: [valid');
    const badPack = await (await api(host, cookie, target)).text();
    assert.match(badPack, /data-hima-state-status="pack"/);
    assert.match(badPack, /Pack owner/);
    assert.match(badPack, /data-hima-state-count="0"/);
  } finally {
    assert.equal(await host.stop(), 0, host.stderr());
    await home.dispose();
  }
});


test('a stale fit never authorizes a start, mismatched rules are escaped, and repaired inputs can start normally', async (t) => {
  const home = await createHimaHome();
  const flow = await writeStandinFlow(t, home);
  if (flow === undefined) { await home.dispose(); return; }
  await installPack(home);
  const options = {
    allowedReadRoots: [home.workspace, flow.root], allowedWriteRoots: [home.workspace],
    bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: home.workspace },
  };
  await writeLocalSite(home, options);
  const host = await bootHimaHost(home);
  try {
    const cookie = await openSession(host);
    const target = `/hima/?pack=${timingProbePackId}&site=local`;
    assert.match(await (await api(host, cookie, target)).text(), /data-hima-state-status="fit"/);
    const start = (changes: Record<string, unknown> = {}) => api(host, cookie, '/hima/api/runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.3 }, generations: 1, ...changes }),
    });
    await writeLocalSite(home, { ...options, allowedWrappers: [] });
    const denied = await start();
    assert.equal(denied.status, 400, await denied.text());
    const wrapper = await (await api(host, cookie, target)).text();
    assert.match(wrapper, /data-hima-state-status="unfit"/);
    assert.match(wrapper, /make.*not.*allowed|not.*permit|refus/i);
    await writePackVariant(packsDirOf(home), 'bad-rule', [['  - clock-period-at-most', '  - no-<script>alert(1)</script>']]);
    const rule = await (await api(host, cookie, '/hima/?pack=bad-rule&site=local')).text();
    assert.match(rule, /data-hima-state-status="unfit"/);
    assert.match(rule, /no-&lt;script&gt;alert/);
    assert.ok(!rule.includes('<script>alert(1)</script>'));
    await writeLocalSite(home, options);
    for (const changes of [{ strategy: { periodNs: 0 } }, { timeBox: 0 }, { pack: 'missing' }, { site: 'missing' }]) {
      const refused = await start(changes);
      assert.equal(refused.status, 400, await refused.text());
    }
    assert.match(await (await api(host, cookie, '/hima/')).text(), /data-hima-state-count="0"/);
    assert.deepEqual((await (await api(host, cookie, '/hima/api/audit')).json() as { commands: unknown[] }).commands, []);
    const valid = await start();
    const body = await valid.json() as { run: { id: string }; jobs: { event: string }[] };
    assert.equal(valid.status, 200, JSON.stringify(body));
    assert.ok(body.jobs.some((job) => job.event === 'launched'));
    assert.match(body.run.id, /^run-/);
    assert.match(await (await api(host, cookie, '/hima/')).text(), /data-hima-state-count="1"/);
  } finally {
    assert.equal(await host.stop(), 0, host.stderr());
    await home.dispose();
  }
});
