// Bounded L3: actual Electron Settings / real Host / private PostgreSQL.
// Retained native assets are explicit; no installer, member isolation or business claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, type TeamPage } from './support/team-playwright-electron.ts';
import type { TeamServiceReceipt } from '../../packages/harness/src/team-service-runtime.ts';

const region = '[data-hima-region="team-runtime-settings"]';
const control = (name: string) => `[data-hima-control="team-runtime-${name}"]`;
const receipt = (page: TeamPage) => page.evaluate<{ receipt: TeamServiceReceipt; history: TeamServiceReceipt[] }>(`fetch('/hima/api/team-runtime', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action:'status',serviceId:'hindsight'}) }).then(async r=>{if(!r.ok)throw Error('Runtime status HTTP '+r.status);return r.json();})`);

async function enterSettings(browser: Awaited<ReturnType<typeof bootTeamPlaywright>>) {
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.page.getByRole('button', { name: 'Continue', exact: true }).click();
  await browser.wait(`document.body.innerText.includes('Configure later')`);
  await browser.page.getByRole('button', { name: 'Configure later', exact: true }).click();
  await browser.wait(`!document.body.innerText.includes('Configure later')`);
  await browser.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await browser.page.getByRole('button', { name: 'HimaHarness', exact: true }).click();
  await browser.wait(`!!document.querySelector(${JSON.stringify(region)})`);
}

async function proveGuide(browser: Awaited<ReturnType<typeof bootTeamPlaywright>>, workspace: string) {
  await browser.page.getByRole('button', { name: 'Close', exact: true }).click();
  const registered = await browser.page.evaluate<{ result: { ok: boolean } }>(`fetch('/api/workspace/create',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'p03-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(workspace)}}}}})}).then(r=>r.json())`);
  assert.equal(registered.result.ok, true);
  await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
  await browser.page.locator('button:has-text("New Session")').click();
  await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
  await browser.page.locator('[data-hima-control="open-workbench"]').click();
  await browser.wait(`!!document.querySelector('[data-hima-control="studio-mode-team"]')`);
  // This proves ordinary Guide/session UI remains reachable; no Guide model call.
}

for (const native of [false, true]) test(`Playwright Electron Settings ${native ? 'starts and stops retained native Hindsight with owned receipts' : 'reports missing optional assets and keeps Guide available'}`, { timeout: 480_000 }, async t => {
  const runtime = process.env.HIMA_TEST_TEAM_NATIVE_RUNTIME;
  if (native && !runtime) { t.skip('Explicit retained native Team runtime required; never installed/downloaded by this test.'); return; }
  const home = await createEmptyHome();
  delete home.env.HIMA_TEAM_RUNTIME;
  if (runtime) home.env.HIMA_POSTGRES_RUNTIME = path.join(runtime, 'postgres');
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/p03-settings'), `${new Date().toISOString().replace(/[:.]/gu, '-')}-${native ? 'native' : 'missing'}`);
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  let llmCalls = 0;
  const llm = native ? createServer((_request, response) => { llmCalls++; response.end(JSON.stringify({ choices: [{ message: { content: 'Qualification fixture' } }] })); }) : undefined;
  if (llm) {
    await new Promise<void>(resolve => llm.listen(0, '127.0.0.1', resolve));
    const address = llm.address(); assert.ok(address && typeof address !== 'string');
    Object.assign(home.env, { HIMA_TEAM_RUNTIME: runtime, HIMA_HINDSIGHT_LLM_PROVIDER: 'openai', HIMA_HINDSIGHT_LLM_MODEL: 'qualification-fixture',
      HIMA_HINDSIGHT_LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, HIMA_HINDSIGHT_SKIP_LLM_VERIFICATION: 'true',
      HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL: path.join(runtime!, 'models/BAAI-bge-small-en-v1.5'),
      HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL: path.join(runtime!, 'models/cross-encoder-ms-marco-MiniLM-L-6-v2') });
  }
  let browser: Awaited<ReturnType<typeof bootTeamPlaywright>> | undefined;
  try {
    browser = await bootTeamPlaywright(home, evidence, { hindsightFixture: native });
    await enterSettings(browser);
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Hindsight: unavailable')`);
    await browser.page.locator(control('refresh')).click();
    await browser.wait(`!document.querySelector(${JSON.stringify(control('refresh'))}).disabled`);
    await browser.page.locator(control('start')).click();
    // Pin integrity hashes 53k real files before the service's bounded readiness probe.
    await browser.wait(`!document.querySelector(${JSON.stringify(control('refresh'))}).disabled && document.querySelector(${JSON.stringify(region)}).innerText.includes('Hindsight:')`, native ? 300_000 : 60_000);
    const started = await receipt(browser.page);
    assert.equal(started.receipt.state, native ? 'running' : 'unavailable', JSON.stringify(started.receipt));
    assert.ok(started.history.some(r => r.operation === 'start' && r.generation === started.receipt.generation));
    if (native) {
      assert.ok(started.receipt.owned.pid); assert.equal(started.receipt.owned.quiescent, false);
      await writeFile(path.join(evidence, 'running-receipts.json'), JSON.stringify(started, null, 2));
      await browser.page.screenshot({ path: path.join(evidence, 'settings-running.png'), fullPage: true, timeout: 10_000 });
      // Pause this proven test-owned process so the real health probe fails while it is live.
      const nativePid=started.receipt.owned.pid!;
      const command=execFileSync('/bin/ps',['-p',String(nativePid),'-o','command='],{encoding:'utf8'});
      assert.ok(command.includes(runtime!)&&command.includes('hindsight_api.main'));
      process.kill(nativePid,'SIGSTOP');
      try {
        const failed=await receipt(browser.page);
        assert.equal(failed.receipt.state,'failed');assert.equal(failed.receipt.owned.quiescent,false);
        await browser.page.locator(control('refresh')).click();
        await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Hindsight: failed')`);
        assert.equal(await browser.page.evaluate(`document.querySelector(${JSON.stringify(control('stop'))}).disabled`),false,'an unhealthy live owned service must remain stoppable');
        await writeFile(path.join(evidence,'unhealthy-live-receipts.json'),JSON.stringify(failed,null,2));
      }finally{process.kill(nativePid,'SIGCONT');}
      await browser.page.locator(control('stop')).click();
      await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Hindsight: stopped')`);
      const stopped = await receipt(browser.page);
      assert.equal(stopped.receipt.generation, started.receipt.generation);
      assert.equal(stopped.receipt.owned.quiescent, true);
      assert.ok(stopped.history.some(r => r.operation === 'stop' && r.generation === started.receipt.generation && r.owned.quiescent));
      assert.throws(() => process.kill(started.receipt.owned.pid!, 0));
      await writeFile(path.join(evidence, 'stopped-receipts.json'), JSON.stringify(stopped, null, 2));
    } else {
      assert.equal(started.receipt.diagnostic?.code, 'missing-assets');
      assert.equal(started.receipt.owned.quiescent, true);
      assert.equal(await browser.page.evaluate(`document.querySelector(${JSON.stringify(control('stop'))}).disabled`), true);
      await writeFile(path.join(evidence, 'unavailable-receipts.json'), JSON.stringify(started, null, 2));
    }
    await proveGuide(browser, home.workspace);
    await browser.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await browser.page.getByRole('button', { name: 'HimaHarness', exact: true }).click();
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes(${JSON.stringify(native ? 'Hindsight: stopped' : 'Hindsight: unavailable')})`);
    await browser.screenshot({ path: path.join(evidence, 'settings.png'), fullPage: true, timeout: 10_000 });
    assert.equal(llmCalls, 0, 'No business or verification LLM request');
    const identities = await Promise.all(['packages/desktop/lib/main.js', 'packages/harness/lib/index.js', 'packages/harness/lib/client.js', 'packages/harness/src/client/SettingsSection.tsx'].map(async file => ({ file, sha256: createHash('sha256').update(await readFile(path.join(repoRoot, file))).digest('hex') })));
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', engine: 'Playwright Electron', sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(), dirtySource: true, identities, platform: `${process.platform}-${process.arch}`, generation: started.receipt.generation, runtimeManifestSha256: native ? createHash('sha256').update(await readFile(path.join(runtime!, 'team-runtime.json'))).digest('hex') : undefined, productModelCalls: 0, fixtureLlmCalls: llmCalls, guideSessionReachable: true, scope: 'Settings lifecycle only; #100 remains open' }, null, 2));
    t.diagnostic(`Playwright evidence: ${evidence}`);
  } catch (error) {
    await writeFile(path.join(evidence, 'failure.txt'), `${String(error)}\n${await browser?.page.evaluate<string>('document.body.innerText').catch(() => 'Renderer unavailable')}`);
    await browser?.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true, timeout: 10_000 }).catch(() => undefined);
    t.diagnostic(`Playwright evidence: ${evidence}`); throw error;
  } finally {
    try { if (browser) { await browser.dispose(); await home.dispose(); } }
    finally { if (llm) await new Promise<void>(resolve => llm.close(() => resolve())); }
  }
});
