// #107 L3 through the product's existing native Electron driver. This driver
// owns a private Home and can run beside an unrelated person's App instance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bootDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { api } from './support/hima-api.ts';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { specDefinition } from './support/issue107/host.ts';
import { publicFixture } from './support/issue107/fixture.mjs';

test('native Electron shows the editable mixed research team, new task and exact original source references', { timeout: 150_000 }, async t => {
  assert.equal(process.env.HIMA_DRIVER_DISPLAY ?? 'Catsights', 'Catsights');
  const home = await createEmptyHome();
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/issue107-desktop'),
    new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(evidence, { recursive: true }); await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  const port = await freePort();
  let d: Awaited<ReturnType<typeof bootDriver>>, browser: Awaited<ReturnType<typeof inspectWindow>> | undefined;
  try {
    d = await bootDriver(t, { existing: home, remoteDebuggingPort: port, theme: 'light', window: { width: 1280, height: 860 } });
    if (!d) return;
    browser = await inspectWindow(port);
    await d.open('/');
    await browser.wait(`document.body.innerText.includes('Internal Testing Notice') || document.body.innerText.includes('Preview Notice')`);
    if (await browser.evaluate(`document.body.innerText.includes('Internal Testing Notice')`)) {
      await browser.markText('button', 'Continue', 'spec-notice-continue'); assert.ok((await d.click('spec-notice-continue')).ok);
    }
    if (await browser.evaluate(`document.body.innerText.includes('Preview Notice')`)) {
      await browser.markText('button', 'Continue', 'spec-preview-continue'); assert.ok((await d.click('spec-preview-continue')).ok);
    }
    await browser.wait(`document.body.innerText.includes('Configure later') || document.body.innerText.includes('Choose a workspace to begin')`);
    if (await browser.evaluate(`document.body.innerText.includes('Configure later')`)) {
      await browser.markText('button', 'Configure later', 'spec-models-later'); assert.ok((await d.click('spec-models-later')).ok);
    }
    const host = await d.host(); assert.ok(host.ok);
    const cookie = await d.cookie();
    const registered = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'spec-ui-workspace', method: 'workspace/create', payload: { args: { request: { path: home.workspace } } } }) });
    assert.equal((await registered.json() as { result: { ok: boolean } }).result.ok, true);
    await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace')`);
    const row = await browser.evaluate<{x:number;y:number}>(`(() => { const r=document.querySelector('[data-row-key^="workspace:"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: row.x, y: row.y });
    await browser.mark('button[aria-label="New session in workspace"]', 'spec-new-session');
    const newSession = await d.click('spec-new-session'); assert.ok(newSession.ok, JSON.stringify(newSession));
    await browser.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    assert.ok((await d.click('open-workbench')).ok);
    assert.ok((await d.click('studio-mode-team')).ok);
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    const sessionId = await browser.evaluate<string>(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session') || ''`);
    assert.ok(sessionId);
    const template = await specDefinition();
    const definition = { ...template, members: template.members.map(member => ({ ...member, modelRef: 'issue107-unconfigured' })) };
    const call = async <T,>(request: unknown): Promise<T> => {
      const response = await api(host, cookie, '/hima/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, request }) });
      assert.equal(response.status, 200, 'Real Host Team operation'); return response.json() as Promise<T>;
    };
    const team = await call<{ teamId: string; version: number }>({ action: 'save', definition, expectedVersion: null });
    await browser.markText('button', 'Refresh teams', 'spec-refresh-teams'); assert.ok((await d.click('spec-refresh-teams')).ok);
    await browser.wait(`!!document.querySelector('select[aria-label="Saved team"]')`);
    await browser.mark('select[aria-label="Saved team"]', 'spec-team-select'); assert.ok((await d.fill('spec-team-select', team.teamId)).ok);
    await browser.wait(`document.querySelector('[data-hima-control="team-title"]')?.value === ${JSON.stringify(template.title)}`);
    assert.ok((await d.click('team-export')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="himateam"] textarea[readonly]')`);
    const exported = JSON.parse(await browser.evaluate<string>(`document.querySelector('[data-hima-region="himateam"] textarea[readonly]').value`));
    assert.deepEqual(exported, definition);
    const task = await call<{ taskId: string; readiness: { ready: boolean } }>({ action: 'startTask', teamId: team.teamId, request: {
      requestId: 'spec-ui-task', teamId: team.teamId, expectedVersion: team.version,
      goal: 'Compare supplied documents for a developer-facing spec', input: { audience: 'Product developers', acceptance: ['Preserve conflicts and source identity'] },
      deadlineAt: new Date(Date.now() + 120_000).toISOString(), closure: 'Offline UI only; no model execution.' } });
    assert.equal(task.readiness.ready, false);
    const stages: { stageId: string; material: { sha256: string } }[] = [];
    for (const item of (await publicFixture('task1')).filter(item => item.name.startsWith('document-'))) {
      const upload = await api(host, cookie, `/api/session/uploadFileBinary?sessionId=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(item.name)}`,
        { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: item.bytes });
      assert.equal(upload.status, 200);
      const receipt = await upload.json() as { ok: boolean; value: { receiptId: string } }; assert.equal(receipt.ok, true);
      const stage = await call<{ stageId: string; material: { sha256: string } }>({ action: 'stage-attachment', teamId: team.teamId,
        taskId: task.taskId, request: { requestId: 'ui-stage-' + stages.length, receiptId: receipt.value.receiptId } });
      assert.equal(stage.material.sha256, item.identity.sha256); stages.push(stage);
    }
    await call({ action: 'send-message', teamId: team.teamId, taskId: task.taskId, request: {
      requestId: 'ui-source-message', recipientMemberIds: ['lead'], text: 'Two independently supplied originals; keep their conflict visible.',
      stagedAttachmentIds: stages.map(stage => stage.stageId) } });
    assert.ok((await d.click('spec-refresh-teams')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-control="team-task-${task.taskId}"]')`);
    assert.ok((await d.click(`team-task-${task.taskId}`)).ok);
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').innerText.includes('Execution: waiting')`);
    await browser.wait(`document.querySelector('[data-hima-region="himateam"]').innerText.includes('Two independently supplied originals')`);
    for (const stage of stages) await browser.wait(`document.querySelector('[data-hima-region="himateam"]').innerText.includes(${JSON.stringify(stage.material.sha256)})`);
    const shown = await d.read('himateam'); assert.ok(shown.ok);
    assert.ok(shown.text.includes('Two independently supplied originals'));
    for (const stage of stages) assert.ok(shown.text.includes(stage.material.sha256));
    const shot = await d.screenshot(path.join(evidence, 'research-sources-waiting.png')); assert.ok(shot.ok);
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ result: 'PASS', scope: 'native driver L3 definition/source/task presentation',
      modelCalls: 0, nativeMemberStarts: 0, teamId: team.teamId, taskId: task.taskId, sourceSha256: stages.map(stage => stage.material.sha256) }, null, 2));
  } finally {
    browser?.close(); await d?.dispose(); await home.dispose();
  }
});
