// L3: actual native Desktop/Workbench with deterministic HTTP fixtures at the browser boundary.
// No model, SSH, EDA, or second UI seam. The test asserts the controls and exact request bodies.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunView } from '@hima/harness';
import { bootDriver, fillConfiguration, type BootedDriver } from './support/driver.ts';
import { freePort } from './support/boot-host.ts';
import { inspectWindow } from './support/inspect-window.ts';
import { api } from './support/hima-api.ts';
import { localHome } from './support/fabric.ts';
import { timingProbePackId } from './support/pack.ts';

type Inspector = Awaited<ReturnType<typeof inspectWindow>>;
type Paused = Awaited<ReturnType<Inspector['nextPaused']>> & { request: { url: string; method: string; postData?: string } };
const hash = (digit: string) => digit.repeat(64);

async function prepareSession(d: BootedDriver, browser: Inspector) {
  await d.open('/');
  await browser.wait(`document.body.innerText.includes('Internal Testing Notice')`);
  await browser.markText('button', 'Continue', 'remaining-ui-notice'); assert.ok((await d.click('remaining-ui-notice')).ok);
  await browser.wait(`document.body.innerText.includes('Configure later') || document.body.innerText.includes('Choose a workspace to begin')`);
  if (await browser.evaluate(`document.body.innerText.includes('Configure later')`)) {
    await browser.markText('button', 'Configure later', 'remaining-ui-models-later'); assert.ok((await d.click('remaining-ui-models-later')).ok);
  }
  const host = await d.host(); assert.ok(host.ok);
  const cookie = await d.cookie();
  const workspace = await api(host, cookie, '/api/workspace/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    type: 'client-request', rpcId: 'remaining-ui-workspace', method: 'workspace/create', payload: { args: { request: { path: d.home.workspace } } },
  }) });
  assert.equal((await workspace.json() as { result: { ok: boolean } }).result.ok, true);
  await browser.wait(`document.querySelector('[role="treegrid"], [role="tree"]')?.textContent.includes('workspace') || [...document.querySelectorAll('[role="row"]')].some(e=>e.textContent.trim()==='workspace')`);
  await browser.markText('button', 'New Session', 'remaining-ui-new-session'); assert.ok((await d.click('remaining-ui-new-session')).ok);
  await browser.wait(`!document.querySelector('[data-hima-control="open-workbench"]').disabled`);
  assert.ok((await d.click('open-workbench')).ok);
  await browser.wait(`!!document.querySelector('[data-hima-region="configuration"]')`);
  return { host, cookie };
}

async function enable(browser: Inspector, patterns: readonly string[]): Promise<void> {
  await browser.send('Fetch.enable', { patterns: patterns.map(urlPattern => ({ urlPattern, requestStage: 'Request' })) });
}

async function next(browser: Inspector, predicate: (paused: Paused) => boolean): Promise<Paused> {
  for (;;) {
    const paused = await browser.nextPaused() as Paused;
    if (predicate(paused)) return paused;
    try { await browser.send('Fetch.continueRequest', { requestId: paused.requestId }); }
    catch (error) {
      if (!(error instanceof Error) || !error.message.includes('Invalid InterceptionId')) throw error;
      // Fetch.disable releases paused requests, while the lightweight inspector intentionally keeps
      // its received-event queue. A later phase may therefore observe that already-released event.
    }
  }
}

async function fulfill(browser: Inspector, paused: Paused, body: unknown, status = 200): Promise<void> {
  await browser.send('Fetch.fulfillRequest', { requestId: paused.requestId, responseCode: status,
    responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
}

const requestBody = (paused: Paused): Record<string, unknown> => JSON.parse(paused.request.postData ?? '{}') as Record<string, unknown>;

test('native Workbench saves exact memory, corrects experience, controls and reads a child, and renders retained Insight', async (t) => {
  const home = await localHome(t, { sleepSeconds: 0 });
  if (!home) return;
  const port = await freePort();
  const d = await bootDriver(t, { existing: home.h, remoteDebuggingPort: port, theme: 'light', window: { width: 1440, height: 960 },
    env: { HIMA_TEST_LEGACY_AUTO_DRIVE: '0', HIMA_TEST_SILENT_AGENT: '1' } });
  if (!d) { await home.h.dispose(); return; }
  const browser = await inspectWindow(port);
  try {
    const { host, cookie } = await prepareSession(d, browser);
    await fillConfiguration(d, browser, { pack: timingProbePackId, site: 'local', goal: { target_period_ns: '2.25' }, knobs: { periodNs: '2.3' }, budget: { timeBoxMinutes: '5', retries: '0', generations: '2' } });
    assert.ok((await d.click('config-confirm')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="studio"]')?.getAttribute('data-hima-state-run')`, 15_000);
    const studio = await d.read('studio'); assert.ok(studio.ok); const runId = studio.state.run; const sessionId = studio.state.session;
    assert.ok(runId && sessionId);
    const actualView = await (await api(host, cookie, `/hima/api/runs/${runId}?sessionId=${encodeURIComponent(sessionId)}`)).json() as RunView;
    const control = actualView.run.control; assert.ok(control, 'guided fixture has an actual owner epoch and revision');

    // Work Memory: the UI must refresh Host-minted sources, preserve their exact identities, and
    // send the editor's four fields without inventing a hash or another scope.
    const scope = { kind: 'campaign' as const, workspaceRef: home.h.workspace, runId };
    const references = [{ recordId: 'observation:current', contentIdentity: hash('a'), conditions: ['exact current fixture evidence'] }];
    const sources = [{ runId, throughSeq: 7, observedControlRevision: control.revision }];
    await enable(browser, ['*/hima/api/memory']);
    await browser.markText('button', 'Refresh exact sources', 'remaining-memory-sources'); assert.ok((await d.click('remaining-memory-sources')).ok);
    const sourcesRequest = await next(browser, paused => requestBody(paused).action === 'sources');
    assert.deepEqual(requestBody(sourcesRequest), { sessionId, runId, action: 'sources' });
    await fulfill(browser, sourcesRequest, { kind: 'sources', scope, references, sources, nativeSources: [] });
    await browser.wait(`document.querySelector('[data-hima-region="work-memory"]')?.innerText.includes('Ready with 1 record references')`);
    await browser.mark('.hima-memory-editor input', 'remaining-memory-subject');
    const textareas = await browser.evaluate<number>(`(() => { const rows=[...document.querySelectorAll('.hima-memory-editor textarea')]; rows.forEach((row,index)=>row.setAttribute('data-hima-control','remaining-memory-'+index)); return rows.length; })()`);
    assert.equal(textareas, 3);
    assert.ok((await d.fill('remaining-memory-subject', 'Clock closure handoff')).ok);
    assert.ok((await d.fill('remaining-memory-0', 'Keep the measured corner')).ok);
    assert.ok((await d.fill('remaining-memory-1', 'Which endpoint remains?')).ok);
    assert.ok((await d.fill('remaining-memory-2', 'Measure the next candidate')).ok);
    await browser.markText('button', 'Save source-linked summary', 'remaining-memory-save'); assert.ok((await d.click('remaining-memory-save')).ok);
    const saveRequest = await next(browser, paused => requestBody(paused).action === 'save');
    const savedBody = requestBody(saveRequest);
    assert.equal(savedBody.sessionId, sessionId); assert.equal(savedBody.runId, runId);
    assert.deepEqual(savedBody.summary, { subject: 'Clock closure handoff', decisions: ['Keep the measured corner'], openQuestions: ['Which endpoint remains?'], todo: ['Measure the next candidate'], references, sources, nativeSources: [] });
    const summary = { schema: 'hima-work-memory/1', scope, subject: 'Clock closure handoff', decisions: ['Keep the measured corner'], openQuestions: ['Which endpoint remains?'], todo: ['Measure the next candidate'], references, sources, nativeSources: [], generatedAt: '2026-09-23T12:00:00.000Z', modelGenerated: true };
    await fulfill(browser, saveRequest, { kind: 'current', scope, summary, authority: [{ runId, status: actualView.run.status,
      currentNode: actualView.run.currentNode, generation: actualView.run.generation ?? 0, controlRevision: control.revision,
      holds: control.paused, jobs: [], reportRefs: [] }], references, sources, nativeSources: [] });
    await browser.wait(`document.querySelector('[data-hima-region="work-memory"]')?.innerText.includes('Clock closure handoff')`);
    await browser.send('Fetch.disable');

    // Experience correction: remount the exact Run scope to refresh candidates. No checkbox is
    // preselected; the submitted body must carry only the evidence the person selected and wrote.
    const candidate = { sourceRun: 'run-source', sourceManifestSha256: hash('b'), sourceMaterialPath: 'experience.json', sourceMaterialSha256: hash('c') };
    await enable(browser, ['*/hima/api/experience/candidates']);
    assert.ok((await d.click('studio-mode-insight')).ok); assert.ok((await d.click('studio-mode-campaign')).ok);
    const candidateRequest = await next(browser, paused => paused.request.method === 'POST');
    assert.deepEqual(requestBody(candidateRequest), { sessionId, runId });
    await fulfill(browser, candidateRequest, { candidates: [{ candidate, title: 'Verified source Run', availableEvidence: [{ recordId: 'evidence:one', label: 'first evidence' }, { recordId: 'evidence:two', label: 'second evidence' }] }] });
    await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="work-memory"]')?.innerText.includes('Verified source Run')`);
    assert.equal(await browser.evaluate(`document.querySelector('.hima-memory-candidates input[type="checkbox"]').checked`), false, 'evidence is never silently selected');
    assert.equal(await browser.evaluate(`(() => { const boxes=document.querySelectorAll('.hima-memory-candidates input[type="checkbox"]'); boxes[1].setAttribute('data-hima-control','remaining-evidence'); return boxes.length; })()`), 2);
    assert.ok((await d.click('remaining-evidence')).ok);
    await browser.mark('.hima-memory-candidates textarea', 'remaining-reason'); assert.ok((await d.fill('remaining-reason', 'The current measurement contradicts this history.')).ok);
    await enable(browser, ['*/hima/api/experience/adoption']);
    await browser.markText('button', 'Disable exact experience', 'remaining-correction'); assert.ok((await d.click('remaining-correction')).ok);
    const correctionRequest = await next(browser, paused => paused.request.method === 'POST');
    const corrected = requestBody(correctionRequest);
    assert.equal(corrected.reason, 'The current measurement contradicts this history.'); assert.deepEqual(corrected.evidenceRefs, ['evidence:two']); assert.deepEqual(corrected.candidate, candidate);
    await fulfill(browser, correctionRequest, { id: 'adoption:new', event: 'disabled', reason: corrected.reason, evidenceRefs: corrected.evidenceRefs });
    await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="work-memory"]')?.innerText.includes('recorded against the exact archived experience identity')`);

    // Team control: the retained contract is rendered, and each action carries the current control
    // epoch/revision. Result output remains a candidate and is visibly separated from Run facts.
    const childSessionId = 'hima-child-fixture'; const delegationId = 'delegation:fixture';
    const contract = { delegationId, parentSessionId: control.owner, role: 'researcher', task: 'Inspect the failing endpoint', inputRefs: [], workspaceRef: home.h.workspace,
      runRef: { runId, expectedEpoch: control.epoch, expectedRevision: control.revision }, allowedTools: ['read'], budgetShare: { maxElapsedMs: 60_000, maxFollowups: 3 }, dependencyIds: [], recipient: { kind: 'run-owner', sessionId: control.owner }, status: 'requested' };
    const effective = { delegationId, parentSessionId: control.owner, childSessionId, role: 'researcher', workspace: home.h.workspace, model: { provider: 'fixture', model: 'fixture' }, tools: ['read'], readScope: { root: home.h.workspace }, budgetShare: { maxElapsedMs: 60_000, maxFollowups: 3 }, runRef: contract.runRef, recipient: contract.recipient, unavailable: [] };
    const delegation = { contract, effective, reservation: { reservationId: 'reservation:fixture', deadlineAt: '2099-01-01T00:00:00.000Z', admittedEpoch: control.epoch, admittedRevision: control.revision }, delegationId, parentSessionId: control.owner, childSessionId, state: 'accepted', status: 'accepted', requestDigest: hash('d'), initialMessageId: 'message:initial', recordId: 'delegation-record:1', followups: 0, requested: { allowedTools: ['read'], budgetShare: contract.budgetShare }, nativeStatus: 'idle', unknowns: [], artifacts: [] };
    await enable(browser, ['*/hima/api/delegations*']);
    await browser.markText('button', 'Refresh team', 'remaining-team-refresh'); assert.ok((await d.click('remaining-team-refresh')).ok);
    await fulfill(browser, await next(browser, paused => paused.request.method === 'GET'), { delegations: [delegation], asOf: '2026-09-23T12:00:00.000Z', sourceRevision: control.revision });
    await browser.wait(`document.querySelector('[data-hima-region="agent-team"]')?.innerText.includes('Inspect the failing endpoint')`);
    await browser.mark('.hima-team-card textarea', 'remaining-followup'); assert.ok((await d.fill('remaining-followup', 'Check the exact arc and report evidence.')).ok);
    await browser.markText('button', 'Send follow-up', 'remaining-send-followup'); assert.ok((await d.click('remaining-send-followup')).ok);
    const followup = await next(browser, paused => paused.request.method === 'POST');
    assert.deepEqual({ ...requestBody(followup), requestId: '<dynamic>' }, { sessionId, runId, action: 'followup', requestId: '<dynamic>', expectedEpoch: control.epoch, expectedRevision: control.revision, delegationId, text: 'Check the exact arc and report evidence.' });
    await fulfill(browser, followup, { status: 'accepted', receipt: { requestDigest: hash('e'), childSessionId }, artifacts: [], unknowns: [] });
    await fulfill(browser, await next(browser, paused => paused.request.method === 'GET'), { delegations: [delegation], asOf: '2026-09-23T12:00:01.000Z', sourceRevision: control.revision });
    await browser.markText('button', 'Read result', 'remaining-read-result'); assert.ok((await d.click('remaining-read-result')).ok);
    const resultRequest = await next(browser, paused => paused.request.method === 'POST'); assert.equal(requestBody(resultRequest).action, 'result');
    await fulfill(browser, resultRequest, { status: 'candidate', childSessionId, output: [{ type: 'text', text: 'Candidate: inspect U42/A to U77/Z.' }], transcript: { childSessionId, source: 'native-live-session', availability: 'available', nativeMessages: [], messages: [], lastAssistantText: 'Candidate: inspect U42/A to U77/Z.' }, unknowns: [] });
    await fulfill(browser, await next(browser, paused => paused.request.method === 'GET'), { delegations: [delegation], asOf: '2026-09-23T12:00:02.000Z', sourceRevision: control.revision });
    await browser.wait(`document.querySelector('[data-hima-region="agent-team"]')?.innerText.includes('Candidate: inspect U42/A to U77/Z.')`);
    await browser.markText('button', 'Request cancel', 'remaining-cancel'); assert.ok((await d.click('remaining-cancel')).ok);
    const cancelRequest = await next(browser, paused => paused.request.method === 'POST'); assert.equal(requestBody(cancelRequest).action, 'cancel');
    assert.equal(requestBody(cancelRequest).expectedEpoch, control.epoch); assert.equal(requestBody(cancelRequest).expectedRevision, control.revision);
    await fulfill(browser, cancelRequest, { status: 'accepted', receipt: { requestDigest: hash('f'), childSessionId, effect: 'unknown' }, artifacts: [], unknowns: ['Stop requested; quiescence is unknown.'] });
    await fulfill(browser, await next(browser, paused => paused.request.method === 'GET'), { delegations: [delegation], asOf: '2026-09-23T12:00:03.000Z', sourceRevision: control.revision });
    await browser.send('Fetch.disable');

    // A completed child may receive an explicit refinement inside its original deadline and
    // follow-up allowance, while a new cancellation cannot rewrite the completed outcome.
    const completedDelegation={...delegation,state:'completed',status:'completed',followups:1};
    await enable(browser,['*/hima/api/delegations*']);
    assert.ok((await d.click('remaining-team-refresh')).ok);
    await fulfill(browser,await next(browser,paused=>paused.request.method==='GET'),
      {delegations:[completedDelegation],asOf:'2026-09-23T12:00:03.500Z',sourceRevision:control.revision});
    await browser.wait(`document.querySelector('[data-hima-region="agent-team"]')?.innerText.includes('completed')`);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('.hima-team-card button')].find(button=>button.innerText==='Request cancel').disabled`),true);
    await browser.mark('.hima-team-card textarea','remaining-completed-followup');
    assert.ok((await d.fill('remaining-completed-followup','Refine the measured arc in the same retained child.')).ok);
    assert.ok((await d.click('remaining-send-followup')).ok);
    const completedFollowup=await next(browser,paused=>paused.request.method==='POST');
    assert.equal(requestBody(completedFollowup).delegationId,delegationId);
    assert.equal(requestBody(completedFollowup).text,'Refine the measured arc in the same retained child.');
    await fulfill(browser,completedFollowup,{status:'accepted',receipt:{requestDigest:hash('7'),childSessionId},artifacts:[],unknowns:[]});
    await fulfill(browser,await next(browser,paused=>paused.request.method==='GET'),
      {delegations:[{...completedDelegation,followups:2}],asOf:'2026-09-23T12:00:03.600Z',sourceRevision:control.revision});
    await browser.send('Fetch.disable');

    // Child view: identity read plus two real UI pages; the second page appends rather than replacing
    // the first, and current context events are shown separately from unavailable historical inputs.
    await enable(browser, ['*/hima/api/context', '*/hima/api/context/session']);
    await browser.markText('button', 'Inspect transcript', 'remaining-inspect-child'); assert.ok((await d.click('remaining-inspect-child')).ok);
    for (let answered = 0; answered < 2; answered += 1) {
      const paused = await next(browser, request => request.request.method === 'POST'); const body = requestBody(paused);
      if (paused.request.url.endsWith('/context/session')) await fulfill(browser, paused, { sessionId: childSessionId, parentSessionId: control.owner,
        events: [{ seq: 0, kind: 'user', text: 'Inspect the failing endpoint' }, { seq: 1, kind: 'tool-result', text: 'first retained page' }], nextSeq: 2, truncated: true,
        context: { availability: 'available', kind: 'current-native-surface', capturedThroughSeq: 9, events: [{ seq: 9, kind: 'tool-result', text: 'current context event' }], truncated: false, missing: ['Historical provider prompt is unavailable.'] }, asOf: '2026-09-23T12:00:04.000Z', sources: [childSessionId] });
      else await fulfill(browser, paused, { requestId: body.requestId, target: body.target, scope: { workspaceRef: home.h.workspace, sessionId }, asOf: '2026-09-23T12:00:04.000Z', facts: { nativeAddress: { parentSessionId: control.owner, childSessionId, mode: 'continuable' } }, sources: [childSessionId], missing: [] });
    }
    await browser.wait(`document.querySelector('[data-hima-region="child-session"]')?.innerText.includes('current context event')`);
    await browser.markText('button', 'Load next retained events', 'remaining-child-next'); assert.ok((await d.click('remaining-child-next')).ok);
    const later = await next(browser, paused => paused.request.url.endsWith('/context/session')); assert.equal(requestBody(later).fromSeq, 2);
    await fulfill(browser, later, { sessionId: childSessionId, parentSessionId: control.owner, events: [{ seq: 2, kind: 'assistant', text: 'second retained page' }], nextSeq: 3, truncated: false,
      context: { availability: 'unavailable', reason: 'Current model surface was released.' }, asOf: '2026-09-23T12:00:05.000Z', sources: [childSessionId] });
    await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="child-session"]')?.innerText.includes('first retained page') && document.querySelector('[data-hima-region="child-session"]')?.innerText.includes('second retained page') && document.querySelector('[data-hima-region="child-session"]')?.innerText.includes('Current context unavailable')`);

    // Retained Insight: inject only the recorded report head into the existing Run projection, then
    // exercise the exact report-address/context read pair. The result is rendered as report blocks.
    assert.ok((await d.click('studio-mode-campaign')).ok);
    const reportRef = 'experience:fixture';
    await enable(browser, [`*/hima/api/runs/${runId}?*`, '*/hima/api/context/report-address', '*/hima/api/context']);
    const runRead = await next(browser, paused => paused.request.method === 'GET' && paused.request.url.includes(`/runs/${runId}?`));
    await fulfill(browser, runRead, { ...actualView, experience: { recordId: reportRef, writtenAt: '2026-09-23T12:00:00.000Z', markdown: { path: '/fixture/report.md', sha256: hash('1'), bytes: 80 }, json: { path: '/fixture/report.json', sha256: hash('2'), bytes: 160 } } });
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-open-retained-insight"]')`);
    assert.ok((await d.click('studio-open-retained-insight')).ok);
    const addressRequest = await next(browser, paused => paused.request.url.endsWith('/context/report-address')); assert.equal(requestBody(addressRequest).reportRef, reportRef);
    const address = { kind: 'report', reportRef, version: '42', sha256: hash('2') }; await fulfill(browser, addressRequest, address);
    const contextRequest = await next(browser, paused => paused.request.url.endsWith('/context'));
    assert.deepEqual(requestBody(contextRequest).target, address);
    await fulfill(browser, contextRequest, { requestId: requestBody(contextRequest).requestId, target: address, scope: { workspaceRef: home.h.workspace, sessionId }, asOf: '2026-09-23T12:00:06.000Z', sourceRevision: 42,
      facts: { kind: 'read', record: { id: reportRef }, markdown: '# Verified retained report\n\nVerified report body from exact saved bytes.\n', json: { schema: 'hima-experience/4', runId } }, sources: [reportRef], missing: [] });
    await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="insight-report"]')?.innerText.includes('Verified report body from exact saved bytes.')`);
    const insightText = await browser.evaluate<string>(`document.querySelector('[data-hima-region="insight-report"]').innerText`);
    assert.match(insightText, /does not claim native Liberty analysis/); assert.doesNotMatch(insightText, /\{"kind"/);
    // The exact retained Wave 2 report uses the same surface and immutable source addressing.
    await enable(browser, [`*/hima/api/runs/${runId}?*`, '*/hima/api/context/report-address', '*/hima/api/context']);
    assert.ok((await d.click('studio-mode-campaign')).ok);
    const libraryRunRead=await next(browser,paused=>paused.request.url.includes(`/runs/${runId}?`));
    const {readFile}=await import('node:fs/promises');const path=(await import('node:path')).default;const {repoRoot}=await import('./support/dsh-home.ts');
    const wave2Root=path.join(repoRoot,'docs/assessment/2026-09-25/next-stage/wave2-library-attempt9');
    const wave2Evidence=JSON.parse(await readFile(path.join(wave2Root,'evidence.json'),'utf8'));
    const fixture=JSON.parse(await readFile(path.join(wave2Root,'insight-report.json'),'utf8'));
    const libraryRef=wave2Evidence.reportTarget.reportRef as string;
    await fulfill(browser,libraryRunRead,{...actualView,experience:{recordId:libraryRef,writtenAt:'2026-09-23T12:00:07.000Z',markdown:{path:'/fixture/library.md',sha256:hash('3'),bytes:80},json:{path:'/fixture/library.json',sha256:hash('4'),bytes:160}}});
    await browser.wait(`!!document.querySelector('[data-hima-control="studio-open-retained-insight"]')`);
    assert.ok((await d.click('studio-open-retained-insight')).ok);
    const libraryAddress=await next(browser,paused=>paused.request.url.endsWith('/context/report-address'));
    assert.equal(requestBody(libraryAddress).reportRef,libraryRef);
    const bound=wave2Evidence.reportTarget;await fulfill(browser,libraryAddress,bound);
    const libraryContext=await next(browser,paused=>paused.request.url.endsWith('/context'));
    await fulfill(browser,libraryContext,{requestId:requestBody(libraryContext).requestId,target:bound,scope:{workspaceRef:home.h.workspace,sessionId},asOf:'2026-09-25T13:47:28.000Z',facts:{...fixture,reportRef:libraryRef,version:bound.version,source:{recordId:libraryRef,sha256:bound.sha256,createdAt:'2026-09-25T13:47:28.000Z'}},sources:[libraryRef],missing:[]});
    await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="library-insight"]')?.innerText.includes('1 of 1 loaded findings')`);
    assert.ok((await d.fill('insight-corner','tt0p9v25c')).ok);
    await browser.wait(`document.querySelector('[data-hima-region="library-insight"]')?.innerText.includes('1 of 1 loaded findings')`);
    const filtered=await browser.evaluate<string>(`document.querySelector('[data-hima-region="library-insight"]').innerText`);
    assert.match(filtered,/Evidence class: native-qualified/);assert.match(filtered,/Library: info.*Design relevance: unknown/);assert.match(filtered,/Design evidence was not supplied/);
    assert.ok((await d.click('insight-finding-same-source-zero-delta')).ok);
    await browser.wait(`document.querySelector('[contenteditable="true"]')?.innerText.includes('Inspect native-qualified finding same-source-zero-delta')`);

    // A different exact record goes through the same Host address and byte identity check. A
    // missing producer category remains visibly unknown while the report reference appends to
    // the existing composer draft left by the Library fixture.
    await browser.markText('button', 'Choose another report', 'remaining-choose-feedback');
    assert.ok((await d.click('remaining-choose-feedback')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="insight-preparation"]')`);
    const feedbackRef=`${runId}#000044`;
    assert.ok((await d.fill('insight-report-ref',feedbackRef)).ok);
    await enable(browser,['*/hima/api/context/report-address','*/hima/api/context']);
    assert.ok((await d.click('insight-open-report')).ok);
    const feedbackAddress=await next(browser,paused=>paused.request.url.endsWith('/context/report-address'));
    assert.equal(requestBody(feedbackAddress).reportRef,feedbackRef);
    const feedbackBound={kind:'report',reportRef:feedbackRef,version:'44',sha256:hash('5')};
    await fulfill(browser,feedbackAddress,feedbackBound);
    const feedbackContext=await next(browser,paused=>paused.request.url.endsWith('/context'));
    assert.deepEqual(requestBody(feedbackContext).target,feedbackBound);
    const feedbackReport={schema:'hima-generation-feedback/1',generation:2,subject:'cell-demand',
      sources:[{id:'commercial:g001',sha256:hash('6')}],
      denominator:{kind:'cell-demand',originalIds:['NAND2_X1','AOI21_X1'],originalCount:2},
      coverage:{before:{status:'measured',coveredIds:['NAND2_X1','AOI21_X1'],missingIds:[]},
        after:{status:'measured',coveredIds:['AOI21_X1'],missingIds:['NAND2_X1']}},
      comparability:{status:'unknown',reasons:['No matched corner response was retained.']},
      endpointChanges:{fixed:{status:'unknown',ids:[],reason:'No matched corner response was retained.'},
        remaining:{status:'measured',ids:['AOI21_X1']},entrant:{status:'measured',ids:[]},
        regressed:{status:'measured',ids:[]},missing:{status:'measured',ids:['NAND2_X1']}},
      next:{kind:'cell-demand',status:'available',reason:'One original demand lacks measured coverage.',items:[{
        id:'demand:g002',targetIds:['NAND2_X1'],change:'Size the NAND2 pull-down stack',expectedEffect:'lower local fall delay',
        validation:{status:'known',method:'Measure the same arc, corner, load and slew'},
        stopCondition:{status:'known',text:'Stop if matched local delay fails to improve'},sourceIds:['commercial:g001'],
        demand:{inputPins:['A','B'],outputs:[{name:'Y',function:'!(A&B)'}],
          truthTable:{inputOrder:['A','B'],outputOrder:['Y'],outputTruthTablesHex:{Y:'7'}},
          timingArcs:[{from:'A',to:'Y',sense:'negative_unate'}],
          conditionalDelayTarget:{requiredDelayNs:0.12,targetEndpoints:['NAND2_X1/A->Y'],slewNs:0.03,loadPf:0.02,corner:'ss',unknowns:[]},
          implementation:{sizing:'candidate-2'}}}]},unknowns:['Global PPA is unmeasured.']};
    await fulfill(browser,feedbackContext,{requestId:requestBody(feedbackContext).requestId,target:feedbackBound,
      scope:{workspaceRef:home.h.workspace,sessionId},asOf:'2026-09-23T12:00:08.000Z',
      facts:{kind:'generation-feedback',report:feedbackReport,reportRef:feedbackRef,version:'44',
        source:{recordId:feedbackRef,sha256:hash('5'),createdAt:'2026-09-23T12:00:08.000Z'}},
      sources:[feedbackRef],missing:[]});
    await browser.send('Fetch.disable');
    await browser.wait(`document.querySelector('[data-hima-region="generation-feedback"]')?.innerText.includes('Original denominator')`);
    const feedbackText=await browser.evaluate<string>(`document.querySelector('[data-hima-region="generation-feedback"]').innerText`);
    assert.match(feedbackText,/2 cell-demands declared by the producer/);
    assert.match(feedbackText,/Fixed\s+Unknown · No matched corner response was retained/);
    assert.doesNotMatch(feedbackText,/Fixed\s+0 declared/);
    assert.match(feedbackText,/Concrete Cell Demand/);
    assert.match(feedbackText,/NAND2_X1\/A->Y/);
    assert.ok((await d.click('feedback-add-report-reference')).ok);
    await browser.wait(`document.querySelector('[contenteditable="true"]')?.innerText.includes('Inspect generation feedback report ${feedbackRef}')`);
    const draftText=await browser.evaluate<string>(`document.querySelector('[contenteditable="true"]').innerText`);
    assert.match(draftText,/Inspect native-qualified finding same-source-zero-delta/);
    assert.match(draftText,/Inspect generation feedback report/);

    // A delayed response for report A must never replace report B after the
    // person changes the exact report reference in this same Insight panel.
    await browser.markText('button', 'Choose another report', 'remaining-race-choose-a');
    assert.ok((await d.click('remaining-race-choose-a')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="insight-preparation"]')`);
    assert.ok((await d.fill('insight-report-ref','race:a')).ok);
    await enable(browser,['*/hima/api/context/report-address','*/hima/api/context']);
    assert.ok((await d.click('insight-open-report')).ok);
    const addressA=await next(browser,paused=>paused.request.url.endsWith('/context/report-address'));
    const boundA={kind:'report',reportRef:'race:a',version:'a',sha256:hash('a')};
    await fulfill(browser,addressA,boundA);
    const contextA=await next(browser,paused=>paused.request.url.endsWith('/context'));
    await browser.markText('button','Choose another report','remaining-race-choose-b');
    assert.ok((await d.click('remaining-race-choose-b')).ok);
    await browser.wait(`!!document.querySelector('[data-hima-region="insight-preparation"]')`);
    assert.ok((await d.fill('insight-report-ref','race:b')).ok);
    assert.ok((await d.click('insight-open-report')).ok);
    const addressB=await next(browser,paused=>paused.request.url.endsWith('/context/report-address'));
    const boundB={kind:'report',reportRef:'race:b',version:'b',sha256:hash('b')};
    await fulfill(browser,addressB,boundB);
    const contextB=await next(browser,paused=>paused.request.url.endsWith('/context'));
    await fulfill(browser,contextB,{requestId:requestBody(contextB).requestId,target:boundB,
      scope:{workspaceRef:home.h.workspace,sessionId},asOf:'2026-09-23T12:00:09.000Z',sourceRevision:45,
      facts:{kind:'read',record:{id:'race:b'},markdown:'# Report B\n\nThe current report is B.\n',json:{schema:'hima-experience/4',runId}},
      sources:['race:b'],missing:[]});
    await browser.wait(`document.querySelector('[data-hima-region="insight-report"]')?.innerText.includes('The current report is B.')`);
    // CDP may reject a fulfilment once AbortController has cancelled A. Either
    // outcome is acceptable; displaying A again is not.
    await fulfill(browser,contextA,{requestId:requestBody(contextA).requestId,target:boundA,
      scope:{workspaceRef:home.h.workspace,sessionId},asOf:'2026-09-23T12:00:10.000Z',sourceRevision:43,
      facts:{kind:'read',record:{id:'race:a'},markdown:'# Report A\n\nStale A must stay hidden.\n',json:{schema:'hima-experience/4',runId}},
      sources:['race:a'],missing:[]}).catch(error => {
      if (!(error instanceof Error) || !error.message.includes('Invalid InterceptionId')) throw error;
    });
    const visible=await browser.evaluate<string>(`document.querySelector('[data-hima-region="insight-report"]').innerText`);
    assert.match(visible,/The current report is B\./);
    assert.doesNotMatch(visible,/Stale A must stay hidden/);
    await browser.send('Fetch.disable');

  } catch (error) {
    t.diagnostic(await browser.evaluate<string>('document.body.innerText')); t.diagnostic(d.stderr()); throw error;
  } finally {
    await browser.send('Fetch.disable').catch(() => undefined); browser.close(); await d.dispose(); await home.h.dispose();
  }
});
