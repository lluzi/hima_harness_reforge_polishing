// #109 caller proposal. L3 projection over I-admitted, stopped, same-candidate real data.
// One separately admitted Guide turn uses the existing composer. No synthetic facts, second browser, restore protocol or user-App signals.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RunView, TeamTaskView, TeamView, TeamDefinition, TeamMessagesPage, TeamMemberWorkPage, MemoryPage } from '@hima/harness';
import type { RunDelegationView } from '../../packages/harness/lib/types/delegation-runtime.js';
import type { LibInsightAnalysisDetail } from '../../packages/harness/lib/types/libinsight-analyses.js';
import { bootDriver, type BootedDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { api } from './support/hima-api.ts';
import { repoRoot, type HimaHome } from './support/dsh-home.ts';
import { himaProfileDir } from '../../packages/desktop/src/hima-home.ts';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;
interface SessionInput { sessionId: string; label: string; blank?: boolean }
interface AcceptanceInput {
  schema: 'hima.issue109.desktop-input/1';
  home: string; workspace: string; evidenceRoot: string;
  // I supplies a stopped, disposable test Home, not a live user's Home or a filesystem copy.
  expectedApplicationVersion: string; expectedDesktopMainSha256: string; expectedClientSha256:string;
  guide: SessionInput;
  task: { teamId: string; taskId: string; currentRunId: string; memberId: string;
    resultEffectId: string; materialSha256: string; expectedExecutionState: string };
  campaign?: { runId: string };
  resident?: { runId: string; parentSessionId: string; childSessionId: string; task: string };
  insight?: { expectedPageText: string };
  // An existing real Guide tool-card, not a new provider call. Opening its link would add a window.
  customInsight?: { guide: SessionInput; runId: string };
  memory?: { adopted: readonly { memoryId: string; eventId: string; requestId: string }[] };
  guideProbe?: { title: string; wallMs: number };
  retainedConfiguration?: {teamId: string; version: number; sha256: string; title: string};
}
const j = JSON.stringify;
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
async function absent(file: string): Promise<boolean> {
  try { await lstat(file); return false; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error;
  }
}
async function loadInput(file: string): Promise<AcceptanceInput> {
  const st = await lstat(file);
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.size <= 32_768, 'small plain input file');
  const c = JSON.parse(await readFile(file, 'utf8')) as AcceptanceInput;
  assert.equal(c.schema, 'hima.issue109.desktop-input/1');
  for (const k of ['home', 'workspace', 'evidenceRoot'] as const) {
    assert.equal(typeof c[k], 'string'); assert.ok(path.isAbsolute(c[k]));
  }
  c.home = await realpath(c.home); c.workspace = await realpath(c.workspace);
  assert.ok(c.home !== path.parse(c.home).root && c.workspace !== path.parse(c.workspace).root);
  assert.match(c.expectedApplicationVersion, /^hima-[0-9a-f]{64}$/);
  assert.match(c.expectedDesktopMainSha256, /^[0-9a-f]{64}$/);
  assert.match(c.expectedClientSha256, /^[0-9a-f]{64}$/);
  assert.ok(c.guide?.sessionId && c.guide.label && c.task?.teamId && c.task.taskId && c.task.memberId && c.task.currentRunId && c.task.resultEffectId);
  assert.match(c.task.materialSha256, /^[0-9a-f]{64}$/);
  if (c.insight) assert.ok(c.insight.expectedPageText.trim().length > 0, 'nonempty real viewer text required');
  assert.ok(['succeeded', 'failed', 'cancelled', 'waiting'].includes(c.task.expectedExecutionState));
  assert.ok(await absent(path.join(c.home, 'hima/database/data/postmaster.pid')), 'fixture precondition: I must normally stop this test Home first');
  const main = path.join(repoRoot, 'packages/desktop/lib/main.js');
  assert.equal(sha(await readFile(main)), c.expectedDesktopMainSha256, 'exact current built Desktop bytes');
  assert.equal(sha(await readFile(path.join(repoRoot,'packages/harness/lib/client.js'))),c.expectedClientSha256,'exact current renderer bundle (excluded from DBOS executable identity)');
  const runtime = await import(pathToFileURL(path.join(repoRoot, 'packages/harness/lib/durable-runtime.js')).href);
  assert.equal(runtime.executableApplicationVersion(await runtime.installedExecutableManifest(path.join(repoRoot, 'packages/harness'))), c.expectedApplicationVersion, 'exact current Harness bytes; no relabeling old evidence');
  return c;
}
async function click(d: BootedDriver, control: string) { const r = await d.click(control); assert.ok(r.ok, `click ${control}`); }
async function read(d: BootedDriver, region: string) { const r = await d.read(region); assert.ok(r.ok, `read ${region}`); return r; }
// Existing native tree semantic selector, as in agent-execution.desktop.test.ts normal reopen.
// Ambiguous labels are a fixture precondition failure, never silently the first user's session.
async function openGuide(d: BootedDriver, b: Inspector, session: SessionInput, initialOnboarding = false, allowCurrentBlank = false): Promise<string> {
  await d.open('/');
  if (initialOnboarding) {
    // Same staged boundary as finishTeamOnboarding: the tree can render behind
    // a notice before the next notice mounts, so it cannot release this wait.
    await b.wait(`document.body.innerText.includes('Internal Testing Notice') || document.body.innerText.includes('Preview Notice')`);
    if (await b.evaluate(`document.body.innerText.includes('Internal Testing Notice')`)) {
      await b.markText('button', 'Continue', 'acceptance-notice'); await click(d, 'acceptance-notice');
      await b.wait(`!document.body.innerText.includes('Internal Testing Notice')`);
    }
    await b.wait(`document.body.innerText.includes('Preview Notice')`);
    await b.markText('button', 'Continue', 'acceptance-preview'); await click(d, 'acceptance-preview');
    await b.wait(`!document.body.innerText.includes('Preview Notice')`);
  }
  await b.wait(`!!document.querySelector('[role="treegrid"], [role="tree"]') || document.body.innerText.includes('Configure later')`);
  if (await b.evaluate(`document.body.innerText.includes('Configure later')`)) {
    await b.markText('button', 'Configure later', 'acceptance-later'); await click(d, 'acceptance-later');
    await b.wait(`!document.body.innerText.includes('Configure later')`);
  }
  await b.wait(`!document.body.innerText.includes('Internal Testing Notice') && !document.body.innerText.includes('Preview Notice') && !document.querySelector('[role="dialog"][aria-modal="true"]') && !document.getElementById('root')?.inert`);
  if (!session.blank) {
    const selector = `[role="treeitem"]:has(button[aria-label=${j('Session actions for ' + session.label)}])`;
    await b.wait(`document.querySelectorAll(${j(selector)}).length > 0`, 20_000);
    assert.equal(await b.evaluate(`document.querySelectorAll(${j(selector)}).length`), 1, 'fixture precondition: unique retained Guide label');
    await b.mark(selector, 'acceptance-guide'); await click(d, 'acceptance-guide');
  }
  // rc.2 names the current blank row "New Session" and hides its actions.
  // Use normal navigation and verify the resulting identity, never rewrite metadata.
  await b.wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
  await click(d, 'open-workbench');
  await b.wait(`!!document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session')`);
  const actual = await b.evaluate<string>(`document.querySelector('[data-hima-region="studio"]').getAttribute('data-hima-state-session')`);
  if (!allowCurrentBlank) assert.equal(actual, session.sessionId, 'normal navigation preserves the selected session');
  return actual;
}
async function shown(b: Inspector, region: string, text: string) {
  await b.wait(`document.querySelector('[data-hima-region="${region}"]')?.innerText.includes(${j(text)})`);
}
// Inspect the already embedded viewer through the SAME existing optional Chromium inspector.
// No second browser/controller, no cross-origin contentDocument assumption.
function safeDocumentUrl(value: string): string {
  try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[invalid URL]'; }
}

async function viewerValue<T>(port: number, url: string, expression: string, observe?: (value: unknown) => Promise<unknown>): Promise<T> {
  assert.match(url, /^http:\/\/localhost:\d+\/$/, 'normal Host-returned LibInsight URL');
  let frame: Inspector | undefined;
  let targets: { type: string; url: string }[] = [];
  // Same OOPIF inspection entry as unified-workbench.test.ts: the embedded
  // cross-origin document has its own target, outside the main page's frame tree.
  for (let n = 0; n < 40 && !frame; n++) {
    targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as {type: string; url: string}[];
    const matches = targets.filter(entry => entry.type === 'iframe' && entry.url === url);
    if (matches.length === 1) frame = await inspectWindow(port, entry => entry.type === 'iframe' && entry.url === url);
    else if (matches.length > 1) break;
    else await new Promise(resolve => setTimeout(resolve, 250));
  }
  try {
    await observe?.({ expectedUrl: url, targets: targets.map(({type,url}) => ({type,url:safeDocumentUrl(url)})), matches: targets.filter(entry => entry.type === 'iframe' && entry.url === url).length });
    assert.ok(frame, 'the exact embedded LibInsight document has one iframe target');
    return await frame.evaluate<T>(expression);
  } finally { frame?.close(); }
}

async function viewerText(port: number, url: string): Promise<string> {
  return viewerValue<string>(port, url, 'document.body.innerText');
}

test('#109 one native Desktop window projects retained business and the four existing paths', { timeout: 480_000 }, async t => {
  if (process.env.HIMA_109_DESKTOP_ADMIT !== '1') { t.skip('UNRUN: I must admit the single L3 window after lower gates'); return; }
  const inputFile = process.env.HIMA_109_DESKTOP_INPUT;
  assert.ok(inputFile,'Admitted Desktop requires same-candidate stopped Home and identity input');
  assert.equal(process.env.HIMA_DRIVER_DISPLAY ?? 'Catsights', 'Catsights');
  const c = await loadInput(inputFile);
  if (process.env.HIMA_109_GUIDE_ADMIT === '1') {
    assert.equal(c.retainedConfiguration, undefined, 'Retained configuration projection cannot admit another Guide turn');
    assert.ok(c.guideProbe?.title && c.guideProbe.wallMs > 0 && c.guideProbe.wallMs <= 180_000, 'Admitted Guide requires its bounded single-turn input');
    assert.ok(c.memory?.adopted.length === 2, 'Admitted composition requires both actual adopted public statuses');
  }
  const evidence = path.join(c.evidenceRoot, `desktop-${randomUUID()}`);
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const save = (name: string, value: unknown) => writeFile(path.join(evidence, name + '.json'), j(value, null, 2) + '\n', { mode: 0o600 });
  // existing: prevents the helper seeding or deleting an admitted Home. driver gives it private userData.
  const home: HimaHome = { home: c.home, workspace: c.workspace, profileDir: himaProfileDir(c.home),
    env: { ...process.env, DSH_HOME: c.home, DSH_AGENTS_HOME: path.join(c.home, 'agents'), DSH_TELEMETRY_DISABLED: '1' },
    dispose: async () => { /* I owns retained success/failure data; never delete here. */ } };
  let d: BootedDriver | undefined, b: Inspector | undefined;
  const missing: string[] = [];
  let failed = false, normallyExited = false, failedCases = 0, drainAttempted = false;
  const closeNormally = async () => {
    if (!d || drainAttempted) return;
    drainAttempted = true;
    await save('app-close-attempt', { mode:'drain',at:new Date().toISOString(),caseAlreadyFailed:failed });
    try {
      const reply=await d.quit('drain'),exitCode=await d.exit(),pgPidAbsent=await absent(path.join(c.home,'hima/database/data/postmaster.pid'));
      normallyExited=reply.ok && exitCode===0 && pgPidAbsent;
      await save('app-close', { mode:'drain',replyOk:reply.ok,exitCode,pgPidAbsent,normalDrainConfirmed:normallyExited,caseAlreadyFailed:failed });
      assert.ok(reply.ok,'Normal existing App drain reply');assert.equal(exitCode,0,'App normal exit');assert.ok(pgPidAbsent,'Normal owned PG exit');
    } catch(error) {
      await save('app-close-failure', {errorName:error instanceof Error?error.name:'unknown',normalDrainConfirmed:false,existingDriverFallbackMayBeNeeded:true});throw error;
    }
  };
  let guideProof: { observedRequestHeaders: number; elapsedMs: number } | undefined;
  const runCase = (name: string, body: (sub: TestContext) => Promise<void>) => t.test(name, async sub => {
    if (failedCases) { missing.push(name + ' blocked'); sub.skip('BLOCKED_BY_PREVIOUS_FAILURE'); return; }
    try { await body(sub); } catch (error) { failedCases++; throw error; }
  });
  await save('input-identity', { inputSha256: sha(await readFile(inputFile)), applicationVersion: c.expectedApplicationVersion, desktopMainSha256: c.expectedDesktopMainSha256,clientSha256:c.expectedClientSha256 });
  try {
    const port = await freePort();
    // The general driver skips unavailable displays/binaries. Once admitted, those
    // are failed required preconditions, while optional comparison cases may still skip.
    const requiredWindow=new Proxy(t,{get(target,key){
      if(key==='skip')return(reason?:string)=>{throw new Error('Admitted Desktop launch unavailable: '+reason);};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
    d = await bootDriver(requiredWindow, { existing: home, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 },
      env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1' } });
    assert.ok(d,'Admitted Desktop driver must open its required window');
    b = await inspectWindow(port);
    const host = await d.host(); assert.ok(host.ok); const cookie = await d.cookie();
    const remote = async <T,>(method: string, args: unknown): Promise<T> => {
      const response = await api(host, cookie, '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: j({ type: 'client-request', rpcId: 'issue109-' + randomUUID(), method, payload: { args } }), signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200); const answer = await response.json() as { result?: { ok?: boolean; value?: T; error?: {code?:string;message?:string} } };
      if (answer.result?.ok !== true) await save('rpc-failure', {method,code:answer.result?.error?.code,message:answer.result?.error?.message});
      assert.equal(answer.result?.ok, true, 'Existing controller RPC ' + method); return answer.result!.value!;
    };
    const settings = await remote<{namespaces: {ns: string; value: {welcomeNoticeVersion?: string}}[]}>('settings/describe', {});
    const welcomeNoticeVersion = settings.namespaces.find(row => row.ns === 'ui-settings-general')?.value.welcomeNoticeVersion;
    const activeGuideId = await openGuide(d, b, c.guide, welcomeNoticeVersion !== '2026-09-28.1', c.guide.blank === true);
    const uiGuide = { ...c.guide, sessionId: activeGuideId };
    const sessions = await remote<{items: {sessionId: string; cwd?: string; blank: boolean; parentSessionId?: string; origin?: string}[]}>('session/list', {_request: {}});
    const active = sessions.items.find(row => row.sessionId === activeGuideId); assert.ok(active);
    assert.equal(active.cwd, c.workspace); assert.equal(active.blank, c.guide.blank === true, 'Selected session matches its admitted actual blank state');
    const projections = await remote<{values: {agentPreset?: string}}>('session/projections', {request: {sessionId: activeGuideId}});
    assert.equal(active.parentSessionId, undefined); assert.notEqual(active.origin, 'subagent', 'Actual UI Guide is a root conversation');
    assert.ok(['hima-moment', 'standard'].includes(projections.values.agentPreset ?? ''), 'Existing root preset with globally registered Hima Guide tools');
    await save('guide-session-identity', { inputSessionId: c.guide.sessionId, actualSessionId: activeGuideId,
      relation: activeGuideId === c.guide.sessionId ? (c.guide.blank ? 'normal-current-blank-reuse' : 'normal-named-session-open') : 'new-normal-ui-session; original Guide retained unused',
      workspace: active.cwd, blank: active.blank, agentPreset: projections.values.agentPreset, welcomeNoticeVersion });
    const get = async <T,>(target: string): Promise<T> => { const r = await api(host, cookie, target); assert.equal(r.status, 200, `Host read ${target.split('?')[0]}`); return r.json() as Promise<T>; };
    const team = async <T,>(action: string, request?: unknown): Promise<T> => {
      const r = await api(host, cookie, '/hima/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: j({ sessionId: activeGuideId, request: { action, teamId: c.task.teamId, ...(action === 'read' ? request as { version: number } : { taskId: c.task.taskId, ...(request === undefined ? {} : { request }) }) } }) });
      assert.equal(r.status, 200, `Host Team ${action}`); return r.json() as Promise<T>;
    };
    const before = await team<TeamTaskView>('readTask');
    assert.equal(before.currentRunId, c.task.currentRunId); assert.equal(before.execution?.state, c.task.expectedExecutionState);
    assert.equal(before.execution?.resourceState, 'closed', 'fixture precondition: physical task resource closure must be retained');
    const delivered = before.execution?.tasks.find(row => row.effectId === c.task.resultEffectId)?.result;
    assert.ok(delivered, 'fixture precondition: real committed result required');
    assert.equal(delivered.identity.applicationVersion, c.expectedApplicationVersion, 'business result belongs to this same candidate');
    const definition = await team<TeamView>('read', { version: before.team.version });
    const member = definition.definition.members.find(v => v.id === c.task.memberId); assert.ok(member);
    const messages = await team<TeamMessagesPage>('read-messages', { page: { limit: 50 } });
    assert.ok(messages.messages.some(v => v.materialRefs.some(m => m.sha256 === c.task.materialSha256)), 'fixture precondition: actual sent source reference in bounded first page');
    const work = await team<TeamMemberWorkPage>('read-member-work', { memberId: c.task.memberId, page: { limit: 50 } });
    assert.ok(work.records.some(v => v.result?.effectId === c.task.resultEffectId), 'fixture precondition: retained member result in bounded first page');
    const businessStamp = (v: TeamTaskView) => ({ run: v.currentRunId, runs: v.runIds, execution: v.execution });
    const baseline = businessStamp(before);

    await runCase('public person memory status projects the two actual adopted tips and honest index states', async sub => {
      if (!c.memory) { missing.push('public adopted memory status input'); sub.skip('Actual same-run adopted tips required'); return; }
      const response = await api(host, cookie, '/hima/api/memory', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: j({ sessionId: activeGuideId, teamId: c.task.teamId, taskId: c.task.taskId, action: 'status', request: { page: { limit: 100 } } }) });
      assert.equal(response.status, 200); const page = await response.json() as MemoryPage;
      for (const expected of c.memory.adopted) {
        const actual = page.records.find(row => row.record.memoryId === expected.memoryId); assert.ok(actual);
        assert.equal(actual.tip.eventId, expected.eventId); assert.equal(actual.tip.requestId, expected.requestId); assert.equal(actual.tip.state, 'adopted');
      }
      await save('public-memory-status', { page, scope: 'Existing authenticated person API; index states are observed, pending is not retrieval' });
    });

    await runCase('existing task → selected member → source/result and control/exit state are visible', async () => {
      await click(d!, 'studio-mode-team');
      await b!.wait(`!!document.querySelector('select[aria-label="Saved team"]')`);
      await b!.mark('select[aria-label="Saved team"]', 'acceptance-team'); assert.ok((await d!.fill('acceptance-team', c.task.teamId)).ok);
      await b!.wait(`!!document.querySelector('[data-hima-control="team-task-${c.task.taskId}"]')`); await click(d!, `team-task-${c.task.taskId}`);
      await shown(b!, 'himateam', c.task.currentRunId); await shown(b!, 'himateam', c.task.materialSha256);
      await shown(b!, 'himateam', c.task.resultEffectId); await shown(b!, 'himateam', `Execution: ${before.execution!.state}`);
      assert.match((await read(d!, 'team-resource-state')).text, /Resources: closed/);
      await shown(b!, 'team-task-work', `generation ${before.execution!.epoch} · revision ${before.execution!.revision}`);
      const selector = 'nav[aria-label="Team task members"] button';
      assert.equal(await b!.evaluate(`Array.from(document.querySelectorAll(${j(selector)})).filter(e => e.textContent.trim() === ${j(member.role)}).length`), 1, 'unique frozen member role label');
      await b!.markText(selector, member.role, 'acceptance-member'); await click(d!, 'acceptance-member');
      await shown(b!, 'team-member-work', c.task.memberId); await shown(b!, 'team-member-work', c.task.resultEffectId);
      await shown(b!, 'team-member-work', 'Retained committed result');
      const retainedResult = work.records.find(v => v.result?.effectId === c.task.resultEffectId)!.result!;
      await shown(b!, 'team-member-work', retainedResult.sha256);
      const offeredControls = (before.allowedActions ?? []).filter(action => action !== 'continue' || !before.definitionHandoff || before.definitionHandoff.state === 'adopted').sort();
      const visibleControls = await b!.evaluate<string[]>(`Array.from(document.querySelectorAll('[data-hima-control="team-pause"], [data-hima-control="team-continue"], [data-hima-control="team-cancel"]')).filter(e=>!e.disabled).map(e=>e.getAttribute('data-hima-control').slice(5)).sort()`);
      assert.deepEqual(visibleControls, offeredControls, 'Available UI controls project the actual Host actions');
      await save('task-control-projection', { state: before.execution!.state, resources: before.execution!.resourceState,
        allowedActions: before.allowedActions, availableUiActions: visibleControls,
        scope: 'Read/navigation only; no Stop/control was clicked. A closed terminal task may still offer Stop under the existing Host contract.' });
      assert.ok((await d!.screenshot(path.join(evidence, 'task-member-sources.png'))).ok);
    });

    const draft = `Unsent #109 Guide draft ${randomUUID()}`;
    await runCase('Guide accepts unsent input and keeps it across existing work-mode switches', async () => {
      await b!.wait(`!!document.querySelector('[contenteditable="true"]')`);
      assert.equal(await b!.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), '', 'fixture precondition: do not overwrite an existing human draft');
      await b!.evaluate(`document.querySelector('[contenteditable="true"]').focus()`); await b!.send('Input.insertText', { text: draft });
      const modes = c.insight ? ['campaign', 'insight', 'team'] : ['campaign', 'team'];
      for (const mode of modes) {
        await click(d!, `studio-mode-${mode}`);
        await b!.wait(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-mode') === ${j(mode)}`);
        assert.equal(await b!.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), draft);
      }
      // Remove only this test's unsent text through the real composer, never submit a provider turn.
      await b!.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
      await b!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: process.platform === 'darwin' ? 4 : 2 });
      await b!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: process.platform === 'darwin' ? 4 : 2 });
      await b!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
      await b!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
      assert.equal(await b!.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), '');
      await save('unsent-draft-modes', { modes, insight: c.insight ? 'visited' : 'not visited in this window; separate admitted evidence required' });
    });
    await runCase('existing Campaign canvas remains reachable', async sub => {
      if (!c.campaign) { missing.push('Campaign input'); sub.skip('FIXTURE_PRECONDITION: existing same-candidate Campaign Run required'); return; }
      await click(d!, 'studio-mode-campaign');
      const view = await get<RunView>(`/hima/api/runs/${encodeURIComponent(c.campaign.runId)}?sessionId=${encodeURIComponent(activeGuideId)}`);
      assert.equal(view.run.id, c.campaign.runId);
      assert.ok((await d!.fill('studio-run', c.campaign.runId)).ok);
      await b!.wait(`document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-run') === ${j(c.campaign.runId)}`);
      await b!.wait(`!!document.querySelector('[data-hima-region="campaign-graph"]')`);
      assert.ok((await d!.screenshot(path.join(evidence, 'campaign.png'))).ok);
    });
    await runCase('single Resident existing delegation → retained child evidence entry', async sub => {
      if (!c.resident) { missing.push('single Resident input'); sub.skip('FIXTURE_PRECONDITION: actual prior single Resident delegation required; Team is not a substitute'); return; }
      const delegations = await get<{delegations:readonly RunDelegationView[]}>(`/hima/api/delegations?sessionId=${encodeURIComponent(activeGuideId)}&runId=${encodeURIComponent(c.resident.runId)}`);
      const actual = delegations.delegations.filter(v => v.childSessionId === c.resident!.childSessionId && v.parentSessionId === c.resident!.parentSessionId && v.contract.task === c.resident!.task);
      assert.equal(actual.length, 1, 'actual single Resident delegation identity; no substituted Team member');
      await click(d!, 'studio-mode-campaign'); assert.ok((await d!.fill('studio-run', c.resident.runId)).ok);
      await shown(b!, 'agent-team', c.resident.childSessionId); await shown(b!, 'agent-team', c.resident.parentSessionId);
      await b!.evaluate(`(() => { const cards=Array.from(document.querySelectorAll('[data-hima-region="agent-team"] article')).filter(e=>e.textContent.includes(${j(c.resident.childSessionId)})&&e.textContent.includes(${j(c.resident.task)})); if(cards.length!==1)throw Error('unique existing Resident card required'); const button=Array.from(cards[0].querySelectorAll('button')).find(e=>e.textContent.trim()==='Inspect transcript'); if(!button)throw Error('missing existing Resident entry');button.setAttribute('data-hima-control','acceptance-resident'); })()`);
      await click(d!, 'acceptance-resident'); await shown(b!, 'child-session', c.resident.childSessionId);
      await shown(b!, 'child-session', c.resident.parentSessionId); await shown(b!, 'child-session', 'Native source');
      assert.ok((await d!.screenshot(path.join(evidence, 'single-resident.png'))).ok);
    });
    await runCase('Data Insight standard embedded page loads real admitted data', async sub => {
      if (!c.insight) { missing.push('standard Data Insight data'); sub.skip('FIXTURE_PRECONDITION: existing LibInsight code/data and expected visible text required'); return; }
      await click(d!, 'studio-mode-insight');
      await b!.wait(`!!document.querySelector('[data-hima-region="libinsight"]') && ['ready','unavailable','failed'].includes(document.querySelector('[data-hima-region="libinsight"]').getAttribute('data-hima-state-viewer'))`, 45_000);
      const state = (await read(d!, 'libinsight')).state.viewer;
      assert.equal(state, 'ready', 'provided real LibInsight input must load; unavailable is not PASS');
      const status = await get<{ state: string; url?: string }>(`/hima/api/libinsight?sessionId=${encodeURIComponent(activeGuideId)}`);
      assert.equal(status.state, 'ready'); assert.ok(status.url);
      assert.ok((await viewerText(port, status.url)).includes(c.insight.expectedPageText), 'actual embedded document shows supplied real data text');
      assert.ok((await d!.screenshot(path.join(evidence, 'data-insight.png'))).ok);
      await click(d!, 'insight-show-reports'); await b!.wait(`!!document.querySelector('[data-hima-control="insight-report-ref"]')`);
      await click(d!, 'insight-show-libinsight');
    });
    await runCase('Guide custom analysis existing real tool-card entry remains visible', async sub => {
      if (!c.customInsight) { missing.push('Guide custom analysis card'); sub.skip('FIXTURE_PRECONDITION: actual retained Guide hima_insight_analysis tool-call required; no provider turn admitted here'); return; }
      await openGuide(d!, b!, c.customInsight.guide);
      const detail = await get<LibInsightAnalysisDetail>(`/hima/api/libinsight/analyses?sessionId=${encodeURIComponent(c.customInsight.guide.sessionId)}&runId=${encodeURIComponent(c.customInsight.runId)}`);
      assert.equal(detail.runId, c.customInsight.runId);
      const question = detail.result?.question;
      assert.ok(question, 'fixture precondition: actual analysis question is required to identify the Guide card');
      await b!.wait(`Array.from(document.querySelectorAll('[data-hima-region="insight-analysis"]')).some(e=>e.textContent.includes(${j(question)})&&e.querySelector('[data-hima-control="open-analysis-page"]'))`);
      assert.ok((await d!.screenshot(path.join(evidence, 'guide-custom-analysis-entry.png'))).ok);
      // Do not click window.open: this caller is admitted for one window only.
    });
    await runCase(c.retainedConfiguration ? 'retained actual Guide-created configuration is visible without another turn' : 'one real Chinese Guide turn reads actual delivery and creates one new unstarted three-role configuration', async sub => {
      await openGuide(d!, b!, uiGuide);
      const operation = async <T,>(request: unknown): Promise<T> => {
        const response = await api(host, cookie, '/hima/api/teams', { method: 'POST', headers: { 'content-type': 'application/json' }, body: j({ sessionId: activeGuideId, request }) });
        assert.equal(response.status, 200); return response.json() as Promise<T>;
      };
      const showUnstartedConfiguration = async (fresh: TeamView) => {
        await click(d!, 'studio-mode-team'); await b!.markText('[data-hima-region="himateam"] button', 'Refresh teams', 'acceptance-refresh-teams'); await click(d!, 'acceptance-refresh-teams');
        await b!.wait(`Array.from(document.querySelector('select[aria-label="Saved team"]').options).some(o=>o.value===${j(fresh.teamId)})`);
        await b!.mark('select[aria-label="Saved team"]', 'acceptance-new-team'); assert.ok((await d!.fill('acceptance-new-team', fresh.teamId)).ok);
        await b!.wait(`document.querySelector('[data-hima-control="team-title"]')?.value===${j(fresh.definition.title)}`);
        await shown(b!, 'himateam', `Open an independent task using saved v${fresh.version}`);
        await shown(b!, 'team-tasks', 'No retained tasks.');
        const fields = await b!.evaluate<{legend: string; values: Record<string,string>}[]>(`Array.from(document.querySelectorAll('[data-hima-region="himateam"] > fieldset.hima-memory-candidates')).map(field=>({legend:field.querySelector('legend').innerText,values:Object.fromEntries(Array.from(field.querySelectorAll(':scope > label')).map(label=>[Array.from(label.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim(),label.querySelector('input,select,textarea').value]))}))`);
        await save('configuration-projection', { state:'OBSERVED_PENDING_VALIDATION',teamId:fresh.teamId,version:fresh.version,sha256:fresh.sha256,definition:fresh.definition,fields,scope:'Hash bound through actual API; UI displays its existing title/version/member fields. No Save/Clone/Task/control clicked.' });
        assert.ok((await d!.screenshot(path.join(evidence, 'guide-created-team.png'))).ok);
        assert.deepEqual(fields, fresh.definition.members.map(member=>({legend:member.role+' · '+member.id,values:{Role:member.role,Runtime:member.runtime,'Model reference':member.modelRef,'skills (reference IDs, comma separated)':member.skills.join(', '),'toolRefs (reference IDs, comma separated)':member.toolRefs.join(', '),'knowledgeRefs (reference IDs, comma separated)':member.knowledgeRefs.join(', '),Instructions:member.instructions}})), 'Actual rendered roles/runtime/refs/instructions match the sha-bound Host definition');
        await save('configuration-projection-validation', {result:'PASS',teamId:fresh.teamId,sha256:fresh.sha256});
      };
      if (c.retainedConfiguration) {
        assert.notEqual(process.env.HIMA_109_GUIDE_ADMIT, '1');
        const ref=c.retainedConfiguration, fresh=await operation<TeamView>({action:'read',teamId:ref.teamId});
        assert.notEqual(fresh.teamId,c.task.teamId);assert.equal(fresh.version,ref.version);assert.equal(fresh.sha256,ref.sha256);assert.equal(fresh.definition.title,ref.title);assert.equal(fresh.definition.members.length,3);
        assert.deepEqual((await operation<{tasks:TeamTaskView[]}>({action:'listTasks',teamId:fresh.teamId})).tasks,[]);
        await showUnstartedConfiguration(fresh);
        assert.deepEqual(await operation<TeamView>({action:'read',teamId:fresh.teamId}),fresh);
        await save('retained-configuration', {saved:fresh,newTasks:0,model:'No new prompt requested; consume separately qualified original Guide turn'});
        return;
      }
      if (process.env.HIMA_109_GUIDE_ADMIT !== '1') { missing.push('actual Guide natural-language turn'); sub.skip('Separate bounded Guide model admission required'); return; }
      const probe=c.guideProbe!;
      const rpc = <T,>(method: string, request: unknown): Promise<T> => remote<T>(method, {request});
      const originalTeam = await operation<TeamView>({ action: 'read', teamId: c.task.teamId });
      const originalTasks = (await operation<{tasks: TeamTaskView[]}>({ action: 'listTasks', teamId: c.task.teamId })).tasks.map(task => task.taskId).sort();
      const existing = await operation<{teams: TeamView[]}>({ action: 'list' });
      const births = (await readdir(path.join(c.home, 'hima/oar-members'))).sort();
      const prior = await rpc<{asOfSeq: number}>('session/projections', { sessionId: activeGuideId });
      const prompt = `请通过现有 Hima Team 工具读取团队 ${c.task.teamId} 的任务 ${c.task.taskId} 和该任务冻结的团队定义，简要告诉我实际 PR 链接、提交 SHA 与成员分工，并列出原冻结团队各角色的 Skills 与 knowledgeRefs 清单。然后另起草一份名为“${probe.title}”的全新团队配置供我审阅：Pi 负责人统筹，OpenCode 开发者完成工作，Pi 独立审查者复核同一个提交；成员采用当前可用的 default 模型引用，工具权限只沿用现有对应角色或已安装方法。携带内容由我明确选择：只保留负责人原有的 Skills，开发者和审查者的 Skills 为空，所有角色的 knowledgeRefs 为空；请说明携带与未携带的内容，不复制原任务专属工作指令或工程历史。请用现有工具保存为一个全新的未开工 Team 配置，不要修改原 Team。不要启动任何新 Task，不要继续或控制原任务，不要修改代码或 GitHub，不要合并、发布、安装或调用 native 成员。请返回新配置的 ID、版本和你读取原任务所得的事实。`;
      assert.equal(await b!.evaluate(`document.querySelector('[contenteditable="true"]').textContent`), '', 'Do not overwrite a human draft');
      await b!.evaluate(`document.querySelector('[contenteditable="true"]').focus()`);
      await b!.send('Input.insertText', { text: prompt });
      await b!.evaluate(`(() => { const editor=Array.from(document.querySelectorAll('[contenteditable="true"]')).find(e=>e.getBoundingClientRect().height>0); if(!editor)throw Error('missing Guide composer'); let root=editor.parentElement; for(let n=0;root&&n<8;n++,root=root.parentElement){ const buttons=Array.from(root.querySelectorAll('button')).filter(e=>e.getBoundingClientRect().height>0&&!e.disabled&&/send|start/i.test([e.textContent,e.getAttribute('aria-label')].join(' '))); if(buttons.length===1){buttons[0].setAttribute('data-hima-control','acceptance-guide-send');return;} if(buttons.length>1)throw Error('ambiguous Guide send control'); } throw Error('missing Guide send control'); })()`);
      const started = Date.now(); await click(d!, 'acceptance-guide-send');
      type Event = { seq: number; type: string; data: any };
      let events: Event[] = [], ended = false;
      try {
        while (Date.now() - started < probe.wallMs) {
          const current = await rpc<{asOfSeq: number}>('session/projections', { sessionId: activeGuideId });
          const page = await rpc<{records: {type: string; event: Event}[]; hasMore: boolean}>('session/page', {
            address: { kind: 'session', sessionId: activeGuideId }, throughSeq: current.asOfSeq, maxMessages: 200, turnWindow: { minMessages: 1, minTurns: 1 } });
          events = page.records.filter(row => row.type === 'event').map(row => row.event).filter(event => event.seq > prior.asOfSeq);
          if (events.some(event => event.type === 'turn/end')) { ended = true; break; }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } finally {
        if (!ended) await rpc('session/cancel', { sessionId: activeGuideId });
      }
      assert.ok(ended, 'One admitted Guide turn must end inside its original wall budget');
      const user = events.filter(event => event.type === 'user/message' && event.data?.source?.kind === 'user'); assert.equal(user.length, 1);
      const headers = events.filter(event => event.type === 'request/header').map(event => ({ seq: event.seq, provider: event.data.header.config.provider, model: event.data.header.config.model }));
      assert.ok(headers.length > 0, 'Actual model request headers required');
      for (const header of headers) { assert.equal(header.provider, 'deepseek-official'); assert.equal(header.model, 'deepseek-flash'); }
      const messages = events.filter(event => event.type === 'assistant/message').map(event => event.data.message);
      const calls = messages.flatMap(message => message.content.filter((block: any) => block.type === 'tool-call').map((block: any) => ({ name: block.name, args: JSON.parse(block.arguments) })));
      const requests = calls.filter(call => call.name === 'hima_team').map(call => call.args.request);
      assert.ok(requests.some(request => request.action === 'readTask' && request.teamId === c.task.teamId && request.taskId === c.task.taskId));
      assert.ok(requests.some(request => request.action === 'read' && request.teamId === c.task.teamId));
      assert.ok(calls.every(call => call.name === 'hima_team' && ['context','read','readTask','list','listVersions','save','clone'].includes(call.args.request.action)
        || call.name === 'hima_team_read' && call.args.teamId === c.task.teamId && call.args.taskId === c.task.taskId && ['read-messages','read-activity','read-pending-requests','read-member-work'].includes(call.args.action)), 'One turn may only inspect the original task and create the admitted configuration');
      const after = await operation<{teams: TeamView[]}>({ action: 'list' });
      const created = after.teams.filter(item => !existing.teams.some(old => old.teamId === item.teamId)); assert.equal(created.length, 1);
      const fresh = created[0]!; assert.equal(fresh.version, 1); assert.equal(fresh.definition.title, probe.title);
      const replies = messages.map(message => message.content.filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n'));
      const actualDelivery = delivered.value as {pullRequestUrl: string; headCommit: string};
      assert.ok(replies.join('\n').includes(actualDelivery.pullRequestUrl), 'Guide reports the actual PR without an answer supplied in the prompt');
      assert.ok(replies.join('\n').includes(actualDelivery.headCommit.slice(0, 7)), 'Guide reports the actual full or abbreviated commit');
      assert.ok(replies.join('\n').includes(fresh.teamId), 'Guide returns its actual new configuration identity');
      assert.ok(requests.some(request => request.action === 'save' && request.expectedVersion === null && !request.teamId && request.definition?.title === probe.title || request.action === 'clone' && request.teamId === c.task.teamId && request.title === probe.title), 'Actual model tool arguments must express new configuration creation');
      const members = fresh.definition.members, leader = members.find(member => member.id === fresh.definition.leaderMemberId); assert.equal(members.length, 3); assert.ok(leader); assert.equal(leader.runtime, 'pi');
      const developer = members.filter(member => member.runtime === 'opencode'); assert.equal(developer.length, 1);
      const reviewers = members.filter(member => member.runtime === 'pi' && member.id !== leader.id); assert.equal(reviewers.length, 1);
      const originalLeader = originalTeam.definition.members.find(member => member.id === originalTeam.definition.leaderMemberId); assert.ok(originalLeader);
      assert.deepEqual(leader.skills, originalLeader.skills, 'Human chose only the original leader Skills');
      assert.deepEqual(developer[0]!.skills, []); assert.deepEqual(reviewers[0]!.skills, []);
      for (const member of members) assert.deepEqual(member.knowledgeRefs, [], 'Human chose no knowledge references for the new configuration');
      const template = JSON.parse(await readFile(path.join(repoRoot, 'packages/harness/skills/hima-team-software/team.json'), 'utf8')) as TeamDefinition;
      for (const [member, role] of [[leader, 'lead'], [developer[0]!, 'developer'], [reviewers[0]!, 'reviewer']] as const) {
        assert.equal(member.modelRef, 'default');
        const allowed = new Set([...(template.members.find(item => item.id === role)?.toolRefs ?? []), ...(originalTeam.definition.members.find(item => item.id === role)?.toolRefs ?? [])]);
        assert.ok(member.toolRefs.every(ref => allowed.has(ref)), 'No privilege expansion for the corresponding role');
      }
      assert.deepEqual((await operation<{tasks: TeamTaskView[]}>({action:'listTasks',teamId:fresh.teamId})).tasks, []);
      assert.deepEqual((await operation<{tasks: TeamTaskView[]}>({action:'listTasks',teamId:c.task.teamId})).tasks.map(task => task.taskId).sort(), originalTasks);
      assert.deepEqual(await operation<TeamView>({action:'read',teamId:c.task.teamId}), originalTeam, 'Original frozen Team is unchanged');
      assert.deepEqual((await readdir(path.join(c.home, 'hima/oar-members'))).sort(), births, 'No new native lease or dispatch');
      assert.equal(sha(j(businessStamp(await team<TeamTaskView>('readTask')))), sha(j(baseline)));
      guideProof = { observedRequestHeaders: headers.length, elapsedMs: Date.now() - started };
      await save('guide-probe', { ...guideProof, prompt, userEvents: user.map(event => ({seq:event.seq,source:event.data.source})), headers, calls,
        replies, newTeam:fresh, originalTeam, originalGuideSessionId:c.guide.sessionId, actualGuideSessionId:activeGuideId,
        oldTeamUnchanged:true,newTasks:0,newNativeLeases:0,providerHttpRequests:'unmeasured; durable logical request headers are counted separately', tokenUsage:'unmeasured' });
      await showUnstartedConfiguration(fresh);
    });
    assert.equal(failedCases, 0, 'a failed UI subtest must never produce a PASS result file');
    assert.equal(sha(j(businessStamp(await team<TeamTaskView>('readTask')))), sha(j(baseline)), 'read/navigation/draft operations did not change the original task');
    b.close(); b = undefined;
    await closeNormally();
    await save('result', { result: missing.length ? 'PARTIAL_WITH_SKIPS' : 'PASS_SCOPED_L3', missing,
      scope: 'one real development Desktop window; projection/entry/unsent input/normal exit', applicationVersion: c.expectedApplicationVersion,
      taskId: c.task.taskId, runId: c.task.currentRunId, providerBusiness: 'not newly exercised; consume I actual provider evidence separately',
      productModelRequests: guideProof ?? 'No Guide turn admitted; provider requests unrun',
      nativeMenuOrLinux: 'UNRUN (#110 HOLD)', whole109Accepted: false, externalPidReconciliation: 'I watcher required' });
  } catch (error) {
    failed = true;
    // Never dump cookie, input payload, raw Host stderr, native transcript or secret-bearing errors.
    await save('failure', { result: 'FAIL_OR_FIXTURE_PRECONDITION', errorName: error instanceof Error ? error.name : 'unknown', retainedHome: c.home, normallyExited });
    if (b) await save('failure-navigation', await b.evaluate(`({ studioSession: document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-session'),
      treeRows: Array.from(document.querySelectorAll('[role="treeitem"]')).map(e=>e.innerText),
      internalNotice: document.body.innerText.includes('Internal Testing Notice'), previewNotice: document.body.innerText.includes('Preview Notice') })`)).catch(() => undefined);
    if (d) await d.screenshot(path.join(evidence, 'failure.png')).catch(() => undefined);
    t.diagnostic(`Retained private Home and evidence: ${evidence}`); throw error;
  } finally {
    b?.close();
    // Record one explicit drain even after a failed assertion; preserve that original failure.
    if (d && !drainAttempted) try { await closeNormally(); } catch { t.diagnostic('Normal drain was not confirmed; existing driver fallback/owned-resource review required.'); }
    // Existing helper owns only this spawned driver child; no custom signals or repeated caller stop.
    try { await d?.dispose(); } catch(error) { if (!failed) throw error; t.diagnostic('Existing driver disposal also failed; primary case failure retained.'); }
    await save('disposal', {drainAttempted,normalDrainConfirmed:normallyExited,caseFailed:failed,existingDriverFallbackPossible:!normallyExited});
    if (!normallyExited || failed) t.diagnostic('Home retained; I must reconcile actual owned resources before reuse.');
  }
});


// Separate admitted normal Home: the actual standard default page has no Team Task prerequisite.
test('#109 standard Data Insight default Health and Overall in one native Desktop window', {timeout:240_000}, async t => {
  if(process.env.HIMA_109_INSIGHT_ADMIT!=='1'){t.skip('UNRUN: separate standard Data Insight admission required');return;}
  assert.notEqual(process.env.HIMA_109_DESKTOP_ADMIT,'1','one admitted window only');
  assert.notEqual(process.env.HIMA_109_GUIDE_ADMIT,'1','no Guide provider turn in standard page acceptance');
  const file=process.env.HIMA_109_INSIGHT_INPUT;assert.ok(file,'Admitted standard page requires stopped normal Home input');
  const st=await lstat(file);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=32768);
  const c=JSON.parse(await readFile(file,'utf8')) as Pick<AcceptanceInput,'home'|'workspace'|'evidenceRoot'|'guide'|'expectedApplicationVersion'|'expectedDesktopMainSha256'|'expectedClientSha256'> & {
    schema:'hima.issue109.insight-desktop-input/1';kitIds:string[];defaultKit:string;
    retainedIdentity:{derived_format:string;manifest_sha256:string;analysis_revision:string};
    config:{path:string;sha256:string};library:{root:string;serverSha256:string;sourceManifest:string;sourceManifestSha256:string};
  };
  assert.equal(c.schema,'hima.issue109.insight-desktop-input/1');
  for(const key of ['home','workspace','evidenceRoot'] as const)assert.ok(path.isAbsolute(c[key]));
  c.home=await realpath(c.home);c.workspace=await realpath(c.workspace);
  assert.ok(await absent(path.join(c.home,'hima/database/data/postmaster.pid')),'normal Home must already be stopped');
  assert.equal(sha(await readFile(path.join(repoRoot,'packages/desktop/lib/main.js'))),c.expectedDesktopMainSha256);
  assert.equal(sha(await readFile(path.join(repoRoot,'packages/harness/lib/client.js'))),c.expectedClientSha256);
  const runtime=await import(pathToFileURL(path.join(repoRoot,'packages/harness/lib/durable-runtime.js')).href);
  assert.equal(runtime.executableApplicationVersion(await runtime.installedExecutableManifest(path.join(repoRoot,'packages/harness'))),c.expectedApplicationVersion);
  assert.equal(sha(await readFile(c.config.path)),c.config.sha256);
  assert.equal(sha(await readFile(c.library.sourceManifest)),c.library.sourceManifestSha256);
  const source=JSON.parse(await readFile(c.library.sourceManifest,'utf8')) as {sourceRoot:string;files:{path:string;sha256:string}[]};
  assert.equal(await realpath(source.sourceRoot),await realpath(c.library.root));
  for(const f of source.files)assert.equal(sha(await readFile(path.join(c.library.root,f.path))),f.sha256);
  assert.equal(sha(await readFile(path.join(c.library.root,'app/server.py'))),c.library.serverSha256);
  assert.equal(await realpath(process.env.HIMA_LIBINSIGHT_ROOT!),await realpath(c.library.root));
  assert.equal(await realpath(process.env.HIMA_LIBINSIGHT_DATA!),await realpath(path.dirname(c.config.path)));
  const evidence=path.join(c.evidenceRoot,'insight-'+randomUUID());await mkdir(evidence,{recursive:true});
  const save=(name:string,value:unknown)=>writeFile(path.join(evidence,name+'.json'),j(value,null,2)+'\n');
  const home:HimaHome={home:c.home,workspace:c.workspace,profileDir:himaProfileDir(c.home),env:{...process.env,DSH_HOME:c.home,DSH_AGENTS_HOME:path.join(c.home,'agents'),DSH_TELEMETRY_DISABLED:'1'},dispose:async()=>{}};
  let d:BootedDriver|undefined,b:Inspector|undefined,caseFailed=false,drainAttempted=false,normalDrainConfirmed=false;
  try{
    assert.equal(process.env.HIMA_DRIVER_DISPLAY,'Catsights');const port=await freePort();
    const requiredWindow=new Proxy(t,{get(target,key){if(key==='skip')return(reason?:string)=>{throw new Error('Admitted window unavailable: '+reason);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    d=await bootDriver(requiredWindow,{existing:home,remoteDebuggingPort:port,theme:'light',window:{width:1280,height:800},env:{HIMA_TEST_LEGACY_AUTO_DRIVE:'0',HIMA_TEST_SILENT_AGENT:'1'}});assert.ok(d);b=await inspectWindow(port);
    const host=await d.host();assert.ok(host.ok);const cookie=await d.cookie();
    const remote=async<T,>(method:string,args:unknown):Promise<T>=>{const response=await api(host,cookie,'/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:j({type:'client-request',rpcId:'109-insight-'+randomUUID(),method,payload:{args}})});assert.equal(response.status,200);const answer=await response.json() as {result?:{ok?:boolean;value?:T;error?:{code?:string;message?:string}}};if(answer.result?.ok!==true)await save('rpc-failure',{method,code:answer.result?.error?.code,message:answer.result?.error?.message});assert.equal(answer.result?.ok,true);return answer.result!.value!;};
    const settings=await remote<{namespaces:{ns:string;value:{welcomeNoticeVersion?:string}}[]}>('settings/describe',{});
    const actualGuideId=await openGuide(d,b,c.guide,settings.namespaces.find(v=>v.ns==='ui-settings-general')?.value.welcomeNoticeVersion!=='2026-09-28.1',true);
    const sessions=await remote<{items:{sessionId:string;cwd?:string;blank:boolean;parentSessionId?:string;origin?:string}[]}>('session/list',{_request:{}}),active=sessions.items.find(v=>v.sessionId===actualGuideId);assert.ok(active);assert.equal(active.cwd,c.workspace);assert.equal(active.blank,true);assert.equal(active.parentSessionId,undefined);assert.notEqual(active.origin,'subagent');
    await save('session-identity',{inputGuideId:c.guide.sessionId,actualGuideId,active,scope:'normal unused root; no prompt/Team API'});
    await click(d,'studio-mode-insight');await b.wait('!!document.querySelector(\'[data-hima-region="libinsight"]\') && ["ready","unavailable","failed"].includes(document.querySelector(\'[data-hima-region="libinsight"]\').getAttribute("data-hima-state-viewer"))',45_000);
    const region=await read(d,'libinsight');assert.equal(region.state.viewer,'ready');
    const statusResponse=await api(host,cookie,'/hima/api/libinsight?sessionId='+encodeURIComponent(actualGuideId));assert.equal(statusResponse.status,200);const status=await statusResponse.json() as {state:string;url?:string;kits:string[]};await save('viewer-status',{status,region});assert.equal(status.state,'ready');assert.ok(status.url);assert.deepEqual(status.kits,c.kitIds);
    assert.match(status.url,/^http:\/\/localhost:\d+\/$/);
    const frameSrc=await b.evaluate<string>(`document.querySelector('[data-hima-control="libinsight-frame"]').src`);
    await save('iframe-element-observed',{src:safeDocumentUrl(frameSrc),matchesHostUrl:frameSrc===status.url});assert.equal(frameSrc,status.url,'actual embedded frame src matches exact Host viewer URL');
    type ViewerDOM={url:string;text:string;selectedKit:string;kits:{id:string;label:string}[];mapLabel:string;mapSvgCount:number;mapShapes:number};
    const expression='JSON.parse(JSON.stringify({url:location.href,text:document.body.innerText,selectedKit:document.querySelector("#sel-kit")?.value,kits:Array.from(document.querySelectorAll("#sel-kit option"),o=>({id:o.value,label:o.textContent})),mapLabel:document.querySelector(".maplabel")?.value,mapSvgCount:document.querySelectorAll(".km svg").length,mapShapes:document.querySelectorAll(".km svg rect,.km svg path").length}))';
    let dom:ViewerDOM|undefined;for(let n=0;n<100;n++){dom=await viewerValue<ViewerDOM>(port,status.url,expression,value=>save('iframe-targets-observed',value));if(dom.mapSvgCount&&dom.mapShapes&&dom.text.includes('Overall map'))break;await new Promise(r=>setTimeout(r,100));}
    await save('embedded-dom-observed',{state:'OBSERVED_PENDING_ASSERT',dom});assert.ok((await d.screenshot(path.join(evidence,'standard-data-insight.png'))).ok);
    assert.ok(dom);assert.equal(new URL(dom.url).hash,'','actual default page, no alternate route');assert.equal(dom.selectedKit,c.defaultKit);assert.deepEqual(dom.kits.map(v=>v.id),c.kitIds);assert.equal(dom.mapLabel,'');assert.ok(dom.text.includes('Overall map'));assert.ok(dom.mapSvgCount>0&&dom.mapShapes>0,'actual embedded Overall SVG rendered');
    const gets=[];for(const route of ['/api/health?kit='+c.defaultKit,'/api/overall?kit='+c.defaultKit+'&label=&lens=',...c.kitIds.map(id=>'/api/run/status?kit='+id)]){const response=await fetch(new URL(route,status.url));const body=await response.json() as {run?:unknown;identity:Record<string,unknown>;matrix?:{rows:unknown[];cols:unknown[];cells:unknown[]};rows?:unknown[];cols?:unknown[];cells?:unknown[]};gets.push({path:route,status:response.status,body});await save('read-only-api',gets);assert.equal(response.status,200);if(route.includes('/run/status'))assert.equal(body.run,null);else{for(const [key,value]of Object.entries(c.retainedIdentity))assert.equal(body.identity[key],value);const matrix=body.matrix??body;assert.equal(matrix.rows?.length,9);assert.ok(matrix.cols!.length>0&&matrix.cells!.length>0);}}
    await click(d,'insight-show-reports');await b.wait('!!document.querySelector(\'[data-hima-control="insight-report-ref"]\')');await save('reports-navigation',{region:await read(d,'insight-preparation')});await click(d,'insight-show-libinsight');await b.wait('!!document.querySelector(\'[data-hima-region="libinsight"] iframe\')');
    await save('projection-validation',{state:'PASS_STANDARD_DEFAULT_PAGE',defaultKit:c.defaultKit,kitIds:c.kitIds,retainedIdentity:c.retainedIdentity,noRunStartRequested:true,noPromptOrTeamTaskRequested:true,scope:'real default embedded Health+Overall DOM/SVG and reports navigation, no analysis/settings writes'});
  }catch(error){caseFailed=true;await save('failure',{name:error instanceof Error?error.name:'unknown',message:error instanceof Error?error.message:'unknown'});if(d)try{await save('failure-screenshot',await d.screenshot(path.join(evidence,'failure.png')));}catch(captureError){await save('failure-screenshot',{captureError:captureError instanceof Error?captureError.name:'unknown'});}throw error;}
  finally{
    b?.close();try{if(d){drainAttempted=true;const reply=await d.quit('drain'),exitCode=await d.exit(),pgPidAbsent=await absent(path.join(c.home,'hima/database/data/postmaster.pid'));normalDrainConfirmed=reply.ok&&exitCode===0&&pgPidAbsent;await save('app-close',{replyOk:reply.ok,exitCode,pgPidAbsent,normalDrainConfirmed,caseFailed});assert.ok(normalDrainConfirmed,'original normal App drain+exit0+PG absent');}}
    catch(error){await save('app-close-failure',{name:error instanceof Error?error.name:'unknown',normalDrainConfirmed:false,caseFailed});if(!caseFailed)throw error;}
    finally{await d?.dispose();await save('disposal',{drainAttempted,normalDrainConfirmed,caseFailed,existingDriverFallbackPossible:!normalDrainConfirmed});}
  }
});
