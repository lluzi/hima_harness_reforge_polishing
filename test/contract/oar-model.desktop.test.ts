// #101 L3: actual Electron/Host model configuration, without member activation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, finishTeamOnboarding } from './support/team-playwright-electron.ts';

test('actual App saves private member models separately from definition references and reloads them', { timeout: 180000 }, async t => {
  const home = await createEmptyHome();
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/oar-model-playwright'), new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(evidence, { recursive: true });
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  const browser = await bootTeamPlaywright(home, evidence), page = browser.page;
  const models = '[data-hima-region="team-models"]';
  const memberReference = '[data-hima-region="himateam"] > fieldset.hima-memory-candidates label:has-text("Model reference") input';
  const memberReferenceValue = `Array.from(document.querySelectorAll('[data-hima-region="himateam"] > fieldset.hima-memory-candidates label')).find(label => label.textContent === 'Model reference')?.querySelector('input')?.value`;
  const fakeKey = 'L3_FAKE_MEMBER_KEY_NOT_VALID';
  const actions: string[] = [];
  page.on('request', request => {
    if (!request.url().endsWith('/hima/api/teams')) return;
    try {
      const value = JSON.parse(request.postData() ?? '{}');
      if (typeof value.request?.action === 'string') actions.push(value.request.action);
    } catch { /* Retain action names only, never request bodies or keys. */ }
  });
  const click = async (control: string) => page.locator(`[data-hima-control="${control}"]`).click();
  const modelInput = (label: string) => page.locator(`${models} label:has-text("${label}") input`);
  const profileText = () => page.evaluate<string>(`document.querySelector('${models}').innerText`);
  const capture = async (name: string) => {
    assert.equal(await page.evaluate<string>(`document.querySelector('${models} input[type="password"]').value`), '', 'capture only after the password is cleared');
    assert.equal((await page.evaluate<string>('document.body.innerText')).includes(fakeKey), false, 'the key is never rendered as text');
    await browser.screenshot({ path: path.join(evidence, name), fullPage: true, timeout: 10000 });
  };
  try {
    await finishTeamOnboarding(browser);
    const registered = await page.evaluate<{ result: { ok: boolean } }>(`fetch('/api/workspace/create', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'model-workspace',method:'workspace/create',payload:{args:{request:{path:${JSON.stringify(home.workspace)}}}}})}).then(response=>response.json())`);
    assert.equal(registered.result.ok, true);
    await browser.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
    await page.locator('[data-row-key^="workspace:"]:has(span:text-is("workspace"))').hover();
    await page.getByRole('button', { name: 'New session in workspace', exact: true }).click();
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    await click('open-workbench'); await click('studio-mode-team');
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    await page.locator(`${models} summary`).click();
    await browser.wait(`document.querySelector('${models}').open && !document.querySelector('${models} fieldset').disabled`);
    assert.equal(await page.evaluate<string>(memberReferenceValue), 'default');
    assert.equal(await page.evaluate<string>(`document.querySelector('${models} input[type="password"]').getAttribute('autocomplete')`), 'off');
    await capture('empty-model-form.png');

    // Two actual UI submissions exercise both runtime choices, without starting either runtime.
    for (const profile of [
      { reference: 'l3-pi-private', runtime: 'pi', model: 'fake-pi-model' },
      { reference: 'l3-opencode-private', runtime: 'opencode', model: 'fake-opencode-model' },
    ]) {
      await modelInput('Model reference').fill(profile.reference);
      await page.locator(`${models} label:has-text("Runtime") select`).selectOption(profile.runtime);
      await modelInput('Model ID').fill(profile.model);
      await modelInput('Model API endpoint').fill('https://models.example.invalid/v1');
      await modelInput('API key').fill(fakeKey);
      await page.getByRole('button', { name: 'Save member model', exact: true }).click();
      const listed = `${profile.reference} · ${profile.runtime} · ${profile.model} · https://models.example.invalid/v1`;
      await browser.wait(`document.querySelector('${models}').innerText.includes(${JSON.stringify(listed)}) && document.querySelector('${models} input[type="password"]').value === '' && !document.querySelector('${models} fieldset').disabled`);
      assert.equal((await profileText()).includes(listed), true);
      assert.equal(await page.evaluate<string>(memberReferenceValue), 'default', 'saving a profile does not rewrite the team member reference');
    }

    // A definition can retain an independently chosen reference before that profile exists.
    await page.locator(memberReference).fill('definition-reference-only');
    await page.locator('[data-hima-control="team-title"]').fill('Private model configuration boundary');
    await click('team-save');
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);
    const teamId = await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam`);
    await click('team-export');
    await browser.wait(`Array.from(document.querySelectorAll('label')).some(label => label.textContent.startsWith('Shareable definition') && label.querySelector('textarea')?.value.includes('definition-reference-only'))`);
    const exported = await page.evaluate<string>(`Array.from(document.querySelectorAll('label')).find(label => label.textContent.startsWith('Shareable definition')).querySelector('textarea').value`);
    assert.equal(JSON.parse(exported).members[0].modelRef, 'definition-reference-only');
    assert.doesNotMatch(exported, /L3_FAKE_MEMBER_KEY_NOT_VALID|apiKey|fake-pi-model|fake-opencode-model|models\.example\.invalid/);
    await capture('saved-profiles-independent-definition.png');

    await page.reload();
    await browser.wait(`document.body.innerText.includes('Configure later')`);
    await page.getByRole('button', { name: 'Configure later', exact: true }).click();
    await browser.wait(`!document.body.innerText.includes('Configure later')`);
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-mode-team"]') || document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    if (!await page.evaluate<boolean>(`!!document.querySelector('[data-hima-control="studio-mode-team"]')`)) await click('open-workbench');
    await click('studio-mode-team');
    await browser.wait(`!!document.querySelector('select[aria-label="Saved team"]') && !document.querySelector('select[aria-label="Saved team"]').disabled`);
    await page.locator('select[aria-label="Saved team"]').selectOption(teamId);
    await browser.wait(`${memberReferenceValue} === 'definition-reference-only'`);
    await page.locator(`${models} summary`).click();
    await browser.wait(`document.querySelector('${models}').innerText.includes('l3-pi-private · pi · fake-pi-model') && document.querySelector('${models}').innerText.includes('l3-opencode-private · opencode · fake-opencode-model')`);
    assert.equal(await page.evaluate<string>(`document.querySelector('[data-hima-control="team-title"]').value`), 'Private model configuration boundary');
    await capture('reloaded-private-model-profiles.png');
    assert.equal(actions.filter(action => action === 'configure-model').length, 2);
    assert.ok(actions.filter(action => action === 'list-models').length >= 2, 'reload reads retained profiles from the actual Host');
    assert.equal(actions.some(action => action === 'startTask' || action === 'control'), false, 'configuration never activates a native member task');
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', engine: 'Playwright Electron', teamId, productModelCalls: 0, nativeMemberTasks: 0, actions,
      exercised: ['native workspace and session', 'masked credential form', 'Pi and OpenCode profile saves', 'password cleared', 'independent definition reference', 'credential-free definition export', 'renderer reload persistence'],
      limitation: 'No workspace-switch isolation, native-runtime reception or real model qualification.' }, null, 2));
    t.diagnostic(`Playwright evidence: ${evidence}`);
  } catch (error) {
    // Clear even a failed submission before retaining a frame. No inherited credentials
    // enter this isolated Home; the only submitted key is the explicit fake above.
    await page.evaluate(`document.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; })`).catch(() => undefined);
    const body = await page.evaluate<string>('document.body.innerText').catch(() => 'Renderer unavailable');
    await writeFile(path.join(evidence, 'failure.txt'), `${String(error).replaceAll(fakeKey, '[fake key omitted]')}\n${body.replaceAll(fakeKey, '[fake key omitted]')}`);
    if (!body.includes(fakeKey)) await browser.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => undefined);
    t.diagnostic(`Playwright evidence: ${evidence}`); throw error;
  } finally { await browser.dispose(); await home.dispose(); }
});
