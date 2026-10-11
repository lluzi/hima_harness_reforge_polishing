// L3: native Team editor and real Host facts. No model, OAR or EDA qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyHome } from './support/dsh-home.ts';
import { bootTeamPlaywright } from './support/team-playwright-electron.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './support/dsh-home.ts';

test('Playwright Electron Team editor saves, clones, exports and rediscovers a controlled waiting task with honest stop receipts', async t => {
  const home = await createEmptyHome();
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/p01-playwright'), new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(evidence, { recursive: true });
  // A failed/unknown App shutdown retains its Home for inspection.
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  const browser = await bootTeamPlaywright(home, evidence);
  const page = browser.page;
  const region = '[data-hima-region="himateam"]';
  const fill = async (control: string, value: string) => { await page.locator(`[data-hima-control="${control}"]`).fill(value); };
  const click = async (control: string) => { await page.locator(`[data-hima-control="${control}"]`).click(); };
  try {
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await browser.wait(`!document.body.innerText.includes('Configure later')`);
    // Workspace registration uses the same authenticated renderer RPC as the existing
    // test fixture; all Team actions below use normal Playwright locators and clicks.
    const registered = await page.evaluate<{ result: { ok: boolean } }>(`fetch('/api/workspace/create', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        type: 'client-request', rpcId: 'team-editor-workspace', method: 'workspace/create',
        payload: { args: { request: { path: ${JSON.stringify(home.workspace)} } } }
      }) }).then(response => response.json())`);
    assert.equal(registered.result.ok, true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
    await page.locator('button:has-text("New Session")').click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    await click('open-workbench'); await click('studio-mode-team');
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    await fill('team-title', 'Retained desktop team');
    assert.equal(await page.evaluate(`document.querySelector('[data-hima-control="team-title"]').value`), 'Retained desktop team');
    await click('team-save');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);
    assert.equal(await page.evaluate(`document.querySelector('[data-hima-control="team-title"]').value`), 'Retained desktop team');
    const original = await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTeam`);
    await click('team-clone');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTeam !== ${JSON.stringify(original)} && !document.querySelector('[data-hima-control="team-export"]').disabled`);
    const teamId = await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTeam`);
    await click('team-export');
    await browser.wait(`!!document.querySelector(${JSON.stringify(region)} + ' textarea[readonly]')`);
    const exported = JSON.parse(await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)} + ' textarea[readonly]').value`)) as { schema: string; title: string; members: unknown[] };
    assert.equal(exported.title, 'Retained desktop team (copy)'); assert.equal(exported.schema, 'hima-team-definition/1'); assert.equal(exported.members.length, 1);
    await fill('team-goal', 'Retain an unexecuted task for UI control review');
    await fill('team-input', '{"desktopEvidence":true}');
    const deadline = new Date(Date.now() + 3600_000); // Local wall time for datetime-local.
    await fill('team-deadline', new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    await fill('team-closure', 'No execution claim; retain actual Host closure facts.');
    // A list refresh must preserve unsaved editor/opening inputs.
    await fill('team-title', 'Unsaved title');
    await page.getByRole('button', { name: 'Refresh teams', exact: true }).click();
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]').value === 'Unsaved title'`);
    assert.equal(await page.evaluate(`document.querySelector('[data-hima-control="team-input"]').value`), '{"desktopEvidence":true}');
    await click('team-start-task');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTask !== '' && !!document.querySelector('[data-hima-control="team-pause"]')`);
    const taskId = await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTask`);
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Execution: waiting')`);
    const text = await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).innerText`);
    assert.match(text, /Task is not ready:/); assert.match(text, /Execution: waiting/); assert.match(text, /Native OAR member delivery and memory remain unavailable/);
    await click('team-pause');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Host accepted pause request.')`);
    await browser.wait(`!!document.querySelector('[data-hima-control="team-continue"]')`);
    await click('team-continue');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Host accepted continue request.')`);
    await page.getByRole('button', { name: 'Back to team definition', exact: true }).click();
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.value === 'Unsaved title'`);
    assert.equal(await page.evaluate(`document.querySelector('[data-hima-control="team-goal"]').value`), 'Retain an unexecuted task for UI control review');
    await click('team-save');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Saved version 2.')`);
    await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${taskId}"]')`);
    await click(`team-task-${taskId}`);
    await browser.wait(`!!document.querySelector('[data-hima-control="team-cancel"]')`);
    await click('team-cancel');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Host accepted cancel request.')`);
    assert.match(await page.evaluate<string>(`document.querySelector('[data-hima-region="team-resource-state"]').innerText`), /Resources: (closed|active|unknown)\. Stop requested;/);
    // Reload the actual Electron renderer; discovery works without a remembered task address.
    await page.reload();
    // Keyless DSH onboarding reappears after reload; dismiss it through its normal
    // control before returning to Teams, rather than clicking through the modal.
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await browser.wait(`!document.body.innerText.includes('Configure later')`);
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-mode-team"]') || document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    if (!await page.evaluate(`!!document.querySelector('[data-hima-control="studio-mode-team"]')`)) await click('open-workbench');
    await click('studio-mode-team');
    await browser.wait(`!!document.querySelector('select[aria-label="Saved team"]') && !document.querySelector('select[aria-label="Saved team"]').disabled`);
    await page.locator('select[aria-label="Saved team"]').selectOption(teamId);
    await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${taskId}"]')`);
    await click(`team-task-${taskId}`);
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).innerText.includes('Frozen v1')`);
    assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTask`), taskId);
    await browser.screenshot({ path: path.join(evidence, 'frozen-v1-rediscovered.png'), fullPage: true, timeout: 10_000 });
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', engine: 'Playwright Electron', teamId, taskId,
      frozenVersion: 1, savedVersion: 2, productModelCalls: 0, exercised: ['save', 'clone', 'export', 'draft preservation', 'start waiting task', 'pause', 'continue', 'cancel', 'renderer reload', 'frozen v1 rediscovery'] }, null, 2));
  } catch (error) {
    const body = await page.evaluate<string>('document.body.innerText').catch(() => 'Renderer unavailable');
    await writeFile(path.join(evidence, 'failure.txt'), `${String(error)}\n${body}`);
    await browser.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true, timeout: 10_000 }).catch(() => undefined);
    t.diagnostic(`Playwright evidence: ${evidence}`); throw error;
  } finally { await browser.dispose(); await home.dispose(); }
});
