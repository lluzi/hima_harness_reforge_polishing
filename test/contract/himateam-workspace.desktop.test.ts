// #102 L3: actual Electron/Host/PG UI; no model or native-runtime qualification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, finishTeamOnboarding } from './support/team-playwright-electron.ts';

test('actual App preserves task draft across navigation and renders native delivery and missing trace honestly', { timeout: 180000 }, async t => {
  const home = await createEmptyHome();
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/p05-playwright'), new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  const browser = await bootTeamPlaywright(home, evidence), page = browser.page;
  const actions: string[] = [];
  page.on('request', request => {
    if (!request.url().endsWith('/hima/api/teams')) return;
    try { const value = JSON.parse(request.postData() ?? '{}'); if (typeof value.request?.action === 'string') actions.push(value.request.action); } catch { /* No raw payload retained. */ }
  });
  const click = async (control: string) => page.locator(`[data-hima-control="${control}"]`).click();
  const fill = async (control: string, text: string) => page.locator(`[data-hima-control="${control}"]`).fill(text);
  try {
    await finishTeamOnboarding(browser);
    const registered = await page.evaluate<{ result: { ok: boolean } }>(`fetch('/api/workspace/create', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'message-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(home.workspace)}}}}})}).then(response=>response.json())`);
    assert.equal(registered.result.ok, true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
    await page.locator('[data-row-key^="workspace:"]:has(span:text-is("workspace"))').hover();
    await page.getByRole('button', { name: 'New session in workspace', exact: true }).click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    await click('open-workbench'); await click('studio-mode-team');
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    await fill('team-title', 'Message work view'); await click('team-save');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);
    await fill('team-goal', 'Retain actual directed message facts'); await fill('team-input', JSON.stringify({apiKey:'APP_DUMMY_SECRET',sourcePath:'/private/app-dummy-path',notes:'Original source: /private/app-inline-dummy-path',body:'evidence '.repeat(700)}));
    const deadline = new Date(Date.now() + 3600000);
    await fill('team-deadline', new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    await fill('team-closure', 'No native-runtime completion claim.'); await click('team-start-task');
    await browser.wait(`!!document.querySelector('[data-hima-region="team-task-work"]') && document.querySelector('[data-hima-control="team-message-text"]') !== null`);
    const taskId = await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask`);
    await page.locator('[data-hima-region="team-task-work"] input[type="checkbox"]').click();
    await fill('team-message-text', 'Draft retained while work remains running or waiting.');
    await page.getByRole('button', { name: 'Refresh task work', exact: true }).click();
    assert.equal(await page.evaluate<string>(`document.querySelector('[data-hima-control="team-message-text"]').value`), 'Draft retained while work remains running or waiting.');
    await page.getByRole('button', { name: 'Back to team definition', exact: true }).click();
    await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${taskId}"]')`); await click(`team-task-${taskId}`);
    await browser.wait(`document.querySelector('[data-hima-control="team-message-text"]')?.value === 'Draft retained while work remains running or waiting.'`);
    assert.equal(actions.includes('control'), false, 'draft edit/navigation/refresh never issues execution control');
    await click('team-message-send');
    await browser.wait(`document.querySelector('[data-hima-region="team-task-work"]').innerText.includes('Message retained.') && !!document.querySelector('[data-hima-delivery-state="pending"]')`);
    const workText = await page.evaluate<string>(`document.querySelector('[data-hima-region="team-task-work"]').innerText`);
    assert.match(workText, /0\/1 native receipts; business completion is separate/);
    assert.match(workText, /Draft retained while work remains running or waiting\./);
    assert.equal(await page.evaluate<string>(`document.querySelector('[data-hima-control="team-message-text"]').value`), '');
    await page.locator('nav[aria-label="Team task members"] button').click();
    await browser.wait(`!!document.querySelector('[data-hima-region="team-member-work"]') && /Trace: (missing|unavailable)/.test(document.querySelector('[data-hima-region="team-member-work"]').innerText)`);
    const memberText = await page.evaluate<string>(`document.querySelector('[data-hima-region="team-member-work"]').innerText`);
    assert.match(memberText, /Credentials or local paths omitted/);assert.match(memberText, /input is truncated/);assert.doesNotMatch(memberText, /APP_DUMMY_SECRET|\/private\/app-dummy-path|\/private\/app-inline-dummy-path/);
    assert.match(memberText, /Native connection:/); assert.doesNotMatch(memberText, /Trace: retained/);
    await browser.screenshot({ path: path.join(evidence, 'pending-message-missing-trace.png'), fullPage: true, timeout: 10000 });
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', engine: 'Playwright Electron', taskId, productModelCalls: 0, actions, exercised: ['draft edit', 'refresh', 'task navigation', 'actual send', 'pending receipt', 'missing native trace'] }, null, 2));
  } catch (error) {
    await writeFile(path.join(evidence, 'failure.txt'), `${String(error)}\n${await page.evaluate<string>('document.body.innerText').catch(() => 'Renderer unavailable')}`);
    await browser.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => undefined);
    t.diagnostic(`Evidence: ${evidence}`); throw error;
  } finally { await browser.dispose(); await home.dispose(); }
});
