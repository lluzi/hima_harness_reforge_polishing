// #103 L3: actual Playwright Electron, native file input and real Host/PG material facts.
// No model or runtime-delivery qualification; shared integration build is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, type TeamPage } from './support/team-playwright-electron.ts';

type FileInput = ReturnType<TeamPage['locator']> & {
  setInputFiles(files: readonly { name: string; mimeType: string; buffer: Buffer }[]): Promise<void>;
};

test('Playwright Electron uploads, sends, reads and rediscovers retained material versions after draft removal', { timeout: 240000 }, async t => {
  const home = await createEmptyHome();
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/p06-playwright'), new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  const browser = await bootTeamPlaywright(home, evidence); const page = browser.page;
  const region = '[data-hima-region="himateam"]'; const materialRegion = '[data-hima-region="team-materials"]';
  const fill = async (control: string, value: string) => page.locator(`[data-hima-control="${control}"]`).fill(value);
  const click = async (control: string) => page.locator(`[data-hima-control="${control}"]`).click();
  let sessionId = '';
  page.on('request', request => {
    if (!new URL(request.url()).pathname.endsWith('/hima/api/teams') || !request.postData()) return;
    try { const body = JSON.parse(request.postData()!) as { sessionId?: string }; if (body.sessionId) sessionId = body.sessionId; } catch { /* No raw request evidence. */ }
  });
  const original = Buffer.from('# Material Q103\n\nThe attachment-only product bound is 7.625 ns.\n');
  const originalHash = createHash('sha256').update(original).digest('hex');
  const unsupported = Buffer.from([0, 1, 255, 7]); const unsupportedHash = createHash('sha256').update(unsupported).digest('hex');
  async function choose(name: string, buffer: Buffer, mimeType: string): Promise<void> {
    const input = page.locator('[data-hima-control="team-material-input"]') as FileInput;
    await input.setInputFiles([{ name, buffer, mimeType }]);
  }
  const rowExpression = (hash: string): string => `Array.from(document.querySelectorAll('${materialRegion} [data-hima-material]')).find(row => row.querySelector('code')?.textContent === ${JSON.stringify(hash)})`;
  async function stageId(hash: string): Promise<string> { return page.evaluate<string>(`${rowExpression(hash)}.dataset.himaMaterial`); }
  try {
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await browser.wait(`!document.body.innerText.includes('Configure later')`);
    const registered = await page.evaluate<{ result: { ok: boolean } }>(`fetch('/api/workspace/create', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'p06-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(home.workspace)}}}}})}).then(response=>response.json())`);
    assert.equal(registered.result.ok, true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
    await page.locator('button:has-text("New Session")').click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    await click('open-workbench'); await click('studio-mode-team');
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    await fill('team-title', 'Q103 document discussion'); await click('team-save');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);
    const teamId = await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTeam`);
    await fill('team-goal', 'Read supplied product document'); await fill('team-input', '{}');
    const deadline = new Date(Date.now() + 3600000);
    await fill('team-deadline', new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    await fill('team-closure', 'Preserve source material without claiming runtime use.'); await click('team-start-task');
    await browser.wait(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTask !== '' && document.querySelector('[data-hima-control="team-material-input"]')?.disabled === false`);
    const taskId = await page.evaluate<string>(`document.querySelector(${JSON.stringify(region)}).dataset.himaStateTask`);
    await choose('product.md', original, 'text/markdown');
    await browser.wait(`!!(${rowExpression(originalHash)}) && (${rowExpression(originalHash)}).innerText.includes('Text parsed')`);
    const originalStageId = await stageId(originalHash);
    assert.match(await page.evaluate<string>(`${rowExpression(originalHash)}.innerText`), /Draft: access is granted when the message is sent/);
    await choose('archive.bin', unsupported, 'application/octet-stream');
    await browser.wait(`!!(${rowExpression(unsupportedHash)}) && (${rowExpression(unsupportedHash)}).innerText.includes('Format unsupported; original saved')`);
    await page.locator('[data-hima-region="team-task-work"] input[type="checkbox"]').click();
    await fill('team-message-text', 'Please read these two original materials; parsing is not runtime read evidence.');
    await click('team-message-send');
    await browser.wait(`(${rowExpression(originalHash)}) && !(${rowExpression(originalHash)}).innerText.includes('Draft:') && document.querySelector('[data-hima-region="team-task-work"]').innerText.includes('Please read these two original materials')`);
    assert.ok(sessionId, 'real renderer Host action supplies its active session identity');
    async function originalBytes(): Promise<{ status: number; bytes: number[] }> {
      const url = `/hima/api/team-material?sessionId=${encodeURIComponent(sessionId)}&teamId=${encodeURIComponent(teamId)}&taskId=${encodeURIComponent(taskId)}&stageId=${encodeURIComponent(originalStageId)}`;
      return page.evaluate(`fetch(${JSON.stringify(url)}).then(async response=>({status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer()))}))`);
    }
    const read = await originalBytes(); assert.equal(read.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(read.bytes)).digest('hex'), originalHash);
    await page.locator(`[data-hima-material="${originalStageId}"] button:has-text("Read ")`).click();
    await browser.wait(`document.querySelector('[aria-label="Material excerpt"]')?.innerText.includes('7.625 ns')`);
    const revised = Buffer.from('A different same-name product revision with bound 8.5 ns.');
    const revisedHash = createHash('sha256').update(revised).digest('hex');
    await choose('product.md', revised, 'text/markdown'); await browser.wait(`!!(${rowExpression(revisedHash)})`);
    const removedStageId = await stageId(revisedHash); assert.notEqual(removedStageId, originalStageId);
    await page.locator(`[data-hima-material="${removedStageId}"] button:has-text("Remove from draft")`).click();
    await browser.wait(`!Array.from(document.querySelectorAll('[data-hima-material="${removedStageId}"] button')).some(button => button.textContent === 'Remove from draft')`);
    assert.equal((await originalBytes()).status, 200, 'removing a draft revision preserves the sent original');
    await page.reload();
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await browser.wait(`!document.body.innerText.includes('Configure later')`);
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-mode-team"]') || document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    if (!await page.evaluate(`!!document.querySelector('[data-hima-control="studio-mode-team"]')`)) await click('open-workbench');
    await click('studio-mode-team');
    await browser.wait(`!!document.querySelector('select[aria-label="Saved team"]') && !document.querySelector('select[aria-label="Saved team"]').disabled`);
    await page.locator('select[aria-label="Saved team"]').selectOption(teamId);
    await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${taskId}"]')`); await click(`team-task-${taskId}`);
    await browser.wait(`!!(${rowExpression(originalHash)}) && !!(${rowExpression(unsupportedHash)})`);
    assert.equal(await page.evaluate(`!!(${rowExpression(revisedHash)})`), false, 'removed unsent revision is not relabeled as retained linked material');
    const reopened = await originalBytes(); assert.equal(reopened.status, 200);
    assert.equal(createHash('sha256').update(Buffer.from(reopened.bytes)).digest('hex'), originalHash);
    await browser.screenshot({ path: path.join(evidence, 'retained-materials.png'), fullPage: true, timeout: 10000 });
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', engine: 'Playwright Electron', teamId, taskId, originalStageId, removedStageId, originalHash, unsupportedHash, productModelCalls: 0, exercised: ['native file input', 'exact original hash', 'parsed and unsupported states', 'atomic send links', 'authorized original bytes', 'source excerpt', 'same-name revision', 'draft removal preserves sent version', 'renderer reload material rediscovery'] }, null, 2));
  } catch (error) {
    await writeFile(path.join(evidence, 'failure.txt'), `${String(error)}\n${await page.evaluate<string>('document.body.innerText').catch(() => 'Renderer unavailable')}`);
    await browser.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => undefined);
    t.diagnostic(`Playwright evidence: ${evidence}`); throw error;
  } finally { await browser.dispose(); await home.dispose(); }
});
