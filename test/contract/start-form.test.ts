// U9: current ConfigurationPage facts and confirmed Campaign-file admission on an actual Host.
// Standalone legacy /hima HTML form rendering is retired; API tests do not qualify native UI layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPack, packsDirOf, timingProbePackId, writePackVariant } from './support/pack.ts';
import { writeLocalSite, writeSiteWithDirPermit } from './support/site.ts';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHimaHome } from './support/dsh-home.ts';
import { bootHimaHost } from './support/boot-host.ts';
import { api, createLiveSession, openSession } from './support/hima-api.ts';
import { localHome, waitUntil } from './support/fabric.ts';

process.env.HIMA_TEST_LEGACY_AUTO_DRIVE = '0';
process.env.HIMA_TEST_SILENT_AGENT = '1';
const optionsPath = (pack: string, site = 'local') => `/hima/api/start-options?pack=${pack}&site=${site}`;
const headers = { 'content-type': 'application/json' };

async function preparedFile(host: Awaited<ReturnType<typeof bootHimaHost>>, cookie: string, sessionId: string, pack: string, goal: object, extra: object = {}) {
  const response = await api(host, cookie, '/hima/api/campaign', { method: 'PUT', headers,
    body: JSON.stringify({ sessionId, file: { schema: 'hima-campaign/1', pack: { id: pack }, site: { name: 'local' }, goal, ...extra } }) });
  const view = await response.json() as any;
  assert.equal(response.status, 200, JSON.stringify(view));
  return view;
}

function startFile(host: Awaited<ReturnType<typeof bootHimaHost>>, cookie: string, sessionId: string, pack: string, proposalId: string, extra: object = {}) {
  return api(host, cookie, '/hima/api/runs/start', { method: 'POST', headers,
    body: JSON.stringify({ sessionId, pack, site: 'local', proposalId, fromCampaignFile: true, ...extra }) });
}

async function launched(host: Awaited<ReturnType<typeof bootHimaHost>>, cookie: string, sessionId: string, runId: string) {
  await waitUntil('the confirmed Campaign launches its original real Job', async () => {
    const current = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${sessionId}`)).json() as any;
    return current.jobs?.some((job: any) => job.event === 'launched') === true;
  });
}

test('an empty home supplies no invented Pack, Site or Run and all preparation routes remain fenced', async () => {
  const home = await createHimaHome(); const host = await bootHimaHost(home);
  try {
    const cookie = await openSession(host); const sessionId = await createLiveSession(host, cookie, home.workspace);
    assert.deepEqual(await (await api(host, cookie, '/hima/api/start-options')).json(), { packs: [], sites: [] });
    assert.deepEqual(await (await api(host, cookie, `/hima/api/runs?sessionId=${sessionId}`)).json(), { runs: [] });
    const campaign = await (await api(host, cookie, `/hima/api/campaign?session=${sessionId}`)).json() as any;
    assert.equal(campaign.exists, false); assert.equal(campaign.file.pack, undefined); assert.equal(campaign.file.site, undefined);
    for (const route of ['/hima/api/start-options', `/hima/api/runs?sessionId=${sessionId}`]) {
      assert.equal((await fetch(new URL(route, host.url))).status, 401);
      assert.equal((await api(host, cookie, route, { headers: { origin: 'https://foreign.invalid' } })).status, 403);
      assert.equal((await api(host, cookie, route, { method: 'DELETE' })).status, 405);
    }
    assert.equal((await api(host, cookie, '/hima/api/audit')).status, 403, 'global diagnostic audit grants no current project authority');
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await home.dispose(); }
});

test('Pack/Site diagnostics and typed declarations precede admission without contacting the Site', async () => {
  const home = await createHimaHome(); await installPack(home); await writeLocalSite(home);
  const host = await bootHimaHost(home);
  try {
    const cookie = await openSession(host); const sessionId = await createLiveSession(host, cookie, home.workspace);
    const get = async (pack = timingProbePackId, site = 'local') => (await api(host, cookie, optionsPath(pack, site))).json() as Promise<any>;
    const unfit = await get(); assert.equal(unfit.check.fit, false); assert.match(JSON.stringify(unfit.check), /flowRoot.*not bound/);
    const refused = await api(host, cookie, '/hima/api/runs/start', { method: 'POST', headers, body: JSON.stringify({ sessionId, pack: timingProbePackId, site: 'local', goal: { target_period_ns: 2.3 } }) });
    assert.equal(refused.status, 400);
    await writeLocalSite(home, { bindings: { flowRoot: '/not-checked-remotely', design: 'opene902', workspaceRoot: home.workspace } });
    const fit = await get(); assert.equal(fit.check.fit, true); assert.equal(fit.proposal.ready, true); assert.ok('periodNs' in fit.strategy);
    const missing = await get('missing'); assert.equal(missing.preparation.kind, 'request'); assert.match(missing.preparation.message, /Select an installed Pack/);
    const badSite = await writeSiteWithDirPermit(home); assert.equal((await get(timingProbePackId, badSite.name)).preparation.kind, 'site');
    await writeFile(path.join(packsDirOf(home), timingProbePackId, 'contract.yml'), 'not: [valid');
    assert.equal((await get()).preparation.kind, 'pack');
    assert.deepEqual(await (await api(host, cookie, `/hima/api/runs?sessionId=${sessionId}`)).json(), { runs: [] });
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await home.dispose(); }
});

test('stale preparation and changed Strategy or Budget are refused; repaired Campaign facts admit normally', async t => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local);
  const { h, flow } = local; const host = await bootHimaHost(h);
  const site = { allowedReadRoots: [h.workspace, flow.root], allowedWriteRoots: [h.workspace], bindings: { flowRoot: flow.root, design: flow.design, workspaceRoot: h.workspace } };
  try {
    const cookie = await openSession(host); const sessionId = await createLiveSession(host, cookie, h.workspace);
    const original = await preparedFile(host, cookie, sessionId, timingProbePackId, { target_period_ns: 2.3 }, { budget: { generations: 1 } });
    assert.equal(original.preparation.proposal.ready, true);
    await writeLocalSite(h, { ...site, allowedWrappers: [] });
    const stale = await startFile(host, cookie, sessionId, timingProbePackId, original.preparation.proposal.id); assert.equal(stale.status, 400);
    const unfit = await (await api(host, cookie, optionsPath(timingProbePackId))).json() as any;
    assert.equal(unfit.check.fit, false); assert.match(JSON.stringify(unfit.check), /make.*not.*allowed|not.*permit|refus/i);
    await writePackVariant(packsDirOf(h), 'bad-rule', [['  - clock-period-at-most', '  - no-<script>alert(1)</script>']]);
    const rule = await (await api(host, cookie, optionsPath('bad-rule'))).json() as any; assert.equal(rule.check.fit, false); assert.match(JSON.stringify(rule.check), /no-<script>alert/);
    await writeLocalSite(h, site);
    for (const extra of [{ strategy: { periodNs: 0 } }, { timeBox: 0 }, { generations: 2 }]) assert.equal((await startFile(host, cookie, sessionId, timingProbePackId, original.preparation.proposal.id, extra)).status, 400);
    const unknown = await api(host, cookie, '/hima/api/campaign', { method: 'PUT', headers, body: JSON.stringify({ sessionId, file: { schema: 'hima-campaign/1', unknown: true } }) }); assert.equal(unknown.status, 400);
    assert.deepEqual(await (await api(host, cookie, `/hima/api/runs?sessionId=${sessionId}`)).json(), { runs: [] });
    const repaired = await preparedFile(host, cookie, sessionId, timingProbePackId, { target_period_ns: 2.3 }, { budget: { generations: 1 } });
    const started = await startFile(host, cookie, sessionId, timingProbePackId, repaired.preparation.proposal.id); const view = await started.json() as any;
    assert.equal(started.status, 200, JSON.stringify(view)); assert.deepEqual(view.run.goal, { target_period_ns: 2.3 }); assert.equal(view.run.budget.generationLimit, 1);
    await launched(host, cookie, sessionId, view.run.id);
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await h.dispose(); }
});

test('relative Goal declarations and raw numeric spelling remain typed and revalidated before physical work', async t => {
  const local = await localHome(t, { sleepSeconds: 0 }); assert.ok(local); const { h } = local; const pack = 'relative-goal';
  await writePackVariant(packsDirOf(h), pack, [['  target_period_ns:', '  improvement_pct:'], ['clock period at most, unit: ns', 'relative improvement, unit: "%"']], [['target_period_ns', 'improvement_pct']]);
  const file = path.join(packsDirOf(h), pack, 'contract.yml'); const original = (await readFile(file, 'utf8')).replace(/(improvement_pct:\n\s+label: relative improvement\n\s+unit:) ns/, '$1 %');
  const graphFile = path.join(packsDirOf(h), pack, 'graph.yml');
  await writeFile(graphFile, (await readFile(graphFile, 'utf8')).replaceAll('name: target_period_ns', 'name: improvement_pct'));
  const declaration = '\ngoal:\n  improvement_pct: { type: number, unit: "%", min: 0, max: 100, default: 5, precision: 2 }\n';
  await writeFile(file, original + declaration);
  const host = await bootHimaHost(h);
  try {
    const cookie = await openSession(host); const sessionId = await createLiveSession(host, cookie, h.workspace);
    const choices = await (await api(host, cookie, optionsPath(pack))).json() as any; assert.equal(choices.check.fit, true);
    assert.deepEqual(choices.goal, { improvement_pct: { type: 'number', unit: '%', min: 0, max: 100, default: 5, precision: 2 } });
    for (const goal of [{ improvement_pct: -1 }, { improvement_pct: 100.01 }, { improvement_pct: 1.001 }, { target_period_ns: 2.3 }]) {
      const response = await api(host, cookie, '/hima/api/runs/start', { method: 'POST', headers, body: JSON.stringify({ sessionId, proposalId: choices.proposal.id, pack, site: 'local', goal }) }); assert.equal(response.status, 400);
    }
    for (const { raw, expected } of [
      { raw: '"goal":{"improvement_pct":1,"improvement_pct":2}', expected: /duplicate/ },
      { raw: '"goal":{"improvement_pct":2.00000000000000001}', expected: /representable/ },
      { raw: '"goal":{"improvement_pct":5},"strategy":{"periodNs":2,"periodNs":3}', expected: /duplicate/ },
    ]) {
      const response = await api(host, cookie, '/hima/api/runs/start', { method: 'POST', headers, body: `{"sessionId":"${sessionId}","proposalId":"${choices.proposal.id}","pack":"${pack}","site":"local",${raw}}` });
      const message = await response.text(); assert.equal(response.status, 400, message); assert.match(message, expected);
    }
    // These parse correctly, but neither matches the reviewed Goal. Keep this distinct from
    // token-loss rejection: __proto__ is not currently a forbidden JSON token.
    for (const rawGoal of ['{"improvement_pct":2}', '{"__proto__":2}']) {
      const mismatch = await api(host, cookie, '/hima/api/runs/start', { method: 'POST', headers,
        body: `{"sessionId":"${sessionId}","proposalId":"${choices.proposal.id}","pack":"${pack}","site":"local","goal":${rawGoal}}` });
      assert.equal(mismatch.status, 400); assert.match(await mismatch.text(), /submitted Goal or Strategy differs/);
    }
    const prepared = await preparedFile(host, cookie, sessionId, pack, { improvement_pct: 25 }, { budget: { generations: 1 } });
    await writeFile(file, original + declaration.replace('max: 100', 'max: 10'));
    assert.equal((await startFile(host, cookie, sessionId, pack, prepared.preparation.proposal.id)).status, 400);
    assert.deepEqual(await (await api(host, cookie, `/hima/api/runs?sessionId=${sessionId}`)).json(), { runs: [] });
    const rawCampaign = await api(host, cookie, '/hima/api/campaign', { method: 'PUT', headers,
      body: `{"sessionId":"${sessionId}","file":{"schema":"hima-campaign/1","pack":{"id":"${pack}"},"site":{"name":"local"},"goal":{"improvement_pct":10.00},"budget":{"generations":1}}}` });
    const corrected = await rawCampaign.json() as any; assert.equal(rawCampaign.status, 200, JSON.stringify(corrected));
    assert.equal(corrected.preparation.proposal.ready, true);
    const admitted = await startFile(host, cookie, sessionId, pack, corrected.preparation.proposal.id); const view = await admitted.json() as any;
    assert.equal(admitted.status, 200, JSON.stringify(view)); assert.deepEqual(view.run.goal, { improvement_pct: 10 }); await launched(host, cookie, sessionId, view.run.id);
  } finally { assert.equal(await host.stop(), 0, host.stderr()); await h.dispose(); }
});
