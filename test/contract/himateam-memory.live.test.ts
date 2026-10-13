// L3 + L4: actual Electron / Host / private PG / pinned Hindsight / shared DeepSeek.
// Root admits this once inside the existing App + Hindsight 3 GiB / 600 s budget.
// This file never installs assets, creates model profiles, or starts native members.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MemoryPage, MemoryView, TeamMemoryContext } from '@hima/harness';
import { createEmptyHome, repoRoot } from './support/dsh-home.ts';
import { bootTeamPlaywright, finishTeamOnboarding } from './support/team-playwright-electron.ts';

const originalText = '项目 A 的 SRAM 存储器访问延迟上限为 37 ns。仅适用于当前项目和成员。';
const replacementText = '项目 A 的 SRAM 存储器访问延迟上限为 23 ns。仅适用于当前项目和成员。';
const queries = ['项目 A 中静态随机存储器的读取访问最多允许多少纳秒？', '项目 A 的 SRAM access latency cap 是多少 ns？'] as const;
const modelPins = [
  { directory: 'models/BAAI-bge-small-en-v1.5', commit: '5c38ec7c405ec4b44b94cc5a9bb96e735b38267a', weightSha256: '3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad' },
  { directory: 'models/cross-encoder-ms-marco-MiniLM-L-6-v2', commit: '233902d25c440f23af6f7d6e94d2946bac0bee0a', weightSha256: '821d1aa69520101d6e0737f78a042ae25b19e5cb9160701909d10434f4aeb0ae' },
] as const;
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const safeText = (text: string) => process.env.DEEPSEEK_API_KEY ? text.replaceAll(process.env.DEEPSEEK_API_KEY, '[redacted]') : text;
// Narrow JSON projections of the public lifecycle/installed manifest; no private
// module type import or service connection credential enters this acceptance.
interface NativeManifest { components: { id: string; version: string; source: string }[]; files: Record<string, string> }
interface ServiceReceipt { state: string; generation: string; owned: { pid?: number; quiescent: boolean } }
async function fileSha(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const cas = (item: MemoryView) => ({ memoryId: item.record.memoryId, expectedVersion: item.record.version,
  expectedRevision: item.tip.revision, supersedesEventId: item.tip.eventId });

test('actual Electron Chinese SRAM memory is explicitly adopted, corrected, disabled and isolated through pinned native retrieval', { timeout: 600_000 }, async t => {
  const runtime = process.env.HIMA_TEST_TEAM_NATIVE_RUNTIME;
  if (!runtime || !process.env.DEEPSEEK_API_KEY) {
    t.skip('Root must explicitly admit the existing relocated native runtime and existing DEEPSEEK_API_KEY; no download or credential synthesis.'); return;
  }
  assert.equal(process.env.HIMA_DRIVER_DISPLAY ?? 'Catsights', 'Catsights', 'Use the designated Catsights screen');
  assert.equal(process.env.DEEPSEEK_MODEL ?? 'deepseek-flash', 'deepseek-flash');
  // This acceptance consumes the shared Host route. Independent service overrides
  // would test a different producer and are rejected before starting any process.
  for (const key of ['HIMA_HINDSIGHT_LLM_PROVIDER', 'HIMA_HINDSIGHT_LLM_MODEL', 'HIMA_HINDSIGHT_LLM_API_KEY',
    'HIMA_HINDSIGHT_LLM_BASE_URL', 'HIMA_HINDSIGHT_SKIP_LLM_VERIFICATION']) assert.equal(process.env[key], undefined, `${key} overrides the shared producer`);
  const startedAt = Date.now();
  const deadline = startedAt + 600_000;
  // Leave cleanup time inside the already admitted combined budget, not a second run budget.
  const remaining = () => { const ms = deadline - Date.now() - 30_000; assert.ok(ms > 0, 'Acceptance deadline reached; preserve evidence and close owned processes'); return ms; };
  const evidence = path.join(process.env.HIMA_TEAM_EVIDENCE ?? path.join(repoRoot, '.scratch/issue104-memory-live'), new Date().toISOString().replace(/[:.]/gu, '-'));
  await mkdir(evidence, { recursive: true });
  const manifestBytes = await readFile(path.join(runtime, 'team-runtime.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as NativeManifest;
  assert.equal(manifest.components.find(component => component.id === 'hindsight')?.version, '0.10.3');
  const weights: { file: string; sha256: string; commit: string }[] = [];
  for (const pin of modelPins) {
    assert.ok(manifest.components.some(component => component.version === pin.commit), `Manifest must retain model commit ${pin.commit}`);
    const files = Object.keys(manifest.files).filter(file => file.startsWith(pin.directory + '/') && /(?:\.safetensors|pytorch_model\.bin)$/u.test(file));
    assert.ok(files.length > 0, `Pinned weights required: ${pin.directory}`);
    for (const file of files) {
      const digest = await fileSha(path.join(runtime, file));
      assert.equal(digest, manifest.files[file], `Pinned weight integrity: ${file}`);
      assert.equal(digest, pin.weightSha256, `Original fixed component weight: ${file}`);
      weights.push({ file, sha256: digest, commit: pin.commit });
    }
  }
  await writeFile(path.join(evidence, 'native-identity.json'), JSON.stringify({ runtimeManifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    weights, hindsightVersion: '0.10.3', extractionModel: 'deepseek-flash', display: 'Catsights', budget: 'existing combined App + Hindsight 3 GiB / 600 s; root admission and resource monitor',
    testedScope: 'Chinese retrieval + UI controls; late-callback/revoke races and PG immutable history belong to L2' }, null, 2));
  const home = await createEmptyHome();
  Object.assign(home.env, { HIMA_TEAM_RUNTIME: runtime, HIMA_POSTGRES_RUNTIME: path.join(runtime, 'postgres'),
    DEEPSEEK_MODEL: 'deepseek-flash', HIMA_HINDSIGHT_EMBEDDINGS_LOCAL_MODEL: path.join(runtime, modelPins[0].directory),
    HIMA_HINDSIGHT_RERANKER_LOCAL_MODEL: path.join(runtime, modelPins[1].directory) });
  await writeFile(path.join(evidence, 'home.json'), JSON.stringify({ home: home.home }));
  let browser: Awaited<ReturnType<typeof bootTeamPlaywright>> | undefined;
  let sessionId = '';
  let target = { teamId: '', taskId: '' };
  let serviceStarted = false;
  const observations: unknown[] = [];
  const uiActions: string[] = [];
  try {
    browser = await bootTeamPlaywright(home, evidence, { hindsightLive: true });
    const { page } = browser;
    page.on('request', request => {
      if (!request.url().endsWith('/hima/api/teams') || request.postData() === null) return;
      try { const body = JSON.parse(request.postData()!) as { sessionId?: string }; if (body.sessionId) sessionId = body.sessionId; } catch { /* No raw request or credentials retained. */ }
    });
    const wait = async (expression: string, maxMs = 60_000) => browser!.wait(expression, Math.min(maxMs, remaining()));
    const click = async (control: string) => page.locator(`[data-hima-control="${control}"]`).click();
    const fill = async (selector: string, value: string) => {
      const locator = page.locator(selector); await locator.click(); await locator.press('ControlOrMeta+A'); await locator.press('Backspace'); await locator.pressSequentially(value);
    };
    const post = async <T,>(url: string, body: unknown, maxMs = 45_000): Promise<{ status: number; body: T }> => {
      const result = await page.evaluate<{ status: number; body: T }>(`fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(body)}),signal:AbortSignal.timeout(${Math.min(maxMs, remaining())})}).then(async response=>({status:response.status,body:await response.json()}))`);
      return result;
    };
    const memory = async <T,>(action: string, request: unknown, ref = target, session = sessionId): Promise<T> => {
      const answer = await post<T>('/hima/api/memory', { sessionId: session, ...ref, action, request });
      assert.equal(answer.status, 200, `Memory ${action}: ${JSON.stringify(answer.body)}`); return answer.body;
    };
    const team = async <T,>(request: unknown): Promise<T> => {
      const answer = await post<T>('/hima/api/teams', { sessionId, request }); assert.equal(answer.status, 200, JSON.stringify(answer.body)); return answer.body;
    };
    const service = async (action: 'start' | 'status' | 'stop') => {
      const answer = await post<{ receipt: ServiceReceipt; history: ServiceReceipt[] }>('/hima/api/team-runtime', { action, serviceId: 'hindsight' }, action === 'start' ? 300_000 : 45_000);
      assert.equal(answer.status, 200, JSON.stringify(answer.body)); return answer.body;
    };
    const find = async (memoryId?: string): Promise<MemoryView> => {
      const status = await memory<MemoryPage>('status', { page: { limit: 30 } });
      const item = status.records.find(record => memoryId === undefined ? record.record.text === originalText : record.record.memoryId === memoryId);
      assert.ok(item, 'Actual saved Host memory must exist'); return item;
    };
    const confirmed = async (memoryId: string, version: number): Promise<MemoryView> => {
      // Explicit bounded status reconciliation only; never retry the whole test.
      for (let attempt = 0; attempt < 60; attempt++) {
        const status = await memory<MemoryPage>('status', { page: { limit: 30 }, reconcile: true });
        const item = status.records.find(record => record.record.memoryId === memoryId);
        assert.ok(item); assert.equal(item.record.version, version);
        observations.push({ action: 'reconcile', attempt, memoryId, version, index: item.index });
        if (item.index.state === 'confirmed' && item.index.nativeStatus === 'completed') return item;
        assert.notEqual(item.index.state, 'failed', JSON.stringify(item.index));
        assert.ok(remaining() > 1500);
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      assert.fail('Native exact document extraction did not confirm within bounded status calls');
    };

    await finishTeamOnboarding(browser,{providerConfigured:true});
    const workspace = await post<{ result: { ok: boolean } }>('/api/workspace/create', { type: 'client-request', rpcId: 'memory-live-workspace', method: 'workspace/create', payload: { args: { request: { path: home.workspace } } } });
    assert.equal(workspace.body.result.ok, true);
    await wait(`!!document.querySelector('[role="treegrid"], [role="tree"]')`);
    await page.locator('[data-row-key^="workspace:"]:has(span:text-is("workspace"))').hover();
    await page.getByRole('button', { name: 'New session in workspace', exact: true }).click();
    await wait(`document.querySelector('[data-hima-control="open-workbench"]')?.disabled === false`);
    await click('open-workbench'); await click('studio-mode-team');
    await wait(`document.querySelector('[data-hima-control="team-title"]')?.disabled === false`);
    await fill('[data-hima-control="team-title"]', 'Chinese native memory acceptance');
    await fill('[data-hima-region="himateam"] label:has-text("Model reference") input:visible', 'fixture-model');
    await click('team-save');
    await wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam !== '' && !document.querySelector('[data-hima-control="team-save"]').disabled`);
    assert.ok(sessionId, 'Session identity comes from the real renderer Host request');
    const teamId = await page.evaluate<string>(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTeam`);
    const definition = await team<{ definition: { members: { id: string; modelRef: string }[] }; version: number }>({ action: 'read', teamId });
    const memberId = definition.definition.members[0]!.id;
    assert.equal(definition.definition.members[0]!.modelRef, 'fixture-model');
    const models = await team<{ models: { modelRef: string }[] }>({ action: 'list-models' });
    assert.ok(!models.models.some(model => model.modelRef === 'fixture-model'), 'Unavailable member profile prevents native Pi/OpenCode model execution');
    const opened = await team<{ taskId: string }>({ action: 'startTask', teamId, request: { requestId: randomUUID(), teamId, expectedVersion: definition.version,
      goal: 'Validate scoped native Chinese SRAM memory only', input: {}, deadlineAt: new Date(deadline).toISOString(), closure: 'Unavailable member model: no native member execution.' } });
    await page.getByRole('button', { name: 'Refresh teams', exact: true }).click();
    await wait(`!!document.querySelector('[data-hima-control="team-task-${opened.taskId}"]')`);
    await click(`team-task-${opened.taskId}`);
    target = { teamId, taskId: opened.taskId };
    await wait(`document.querySelector('[data-hima-region="himateam"]').dataset.himaStateTask === ${JSON.stringify(opened.taskId)} && !!document.querySelector('[data-hima-region="work-memory"][data-hima-state-memory="team"]')`);
    await wait(`document.querySelector('[data-hima-region="himateam"]').innerText.includes('Execution: waiting')`);
    const panel = '[data-hima-region="work-memory"][data-hima-state-memory="team"]';
    await page.locator(`${panel} label:has-text("Memory scope") select`).selectOption(`member:${memberId}`);
    await wait(`!document.querySelector(${JSON.stringify(panel + ' button')}).disabled`);
    await fill(`${panel} label:text-is("Feedback") textarea`, originalText);
    await fill(`${panel} label:text-is("Conditions") textarea`, '项目 A；当前成员；SRAM');
    await fill(`${panel} label:text-is("Reason") textarea`, '工程师明确提供 SRAM 访问上限');
    await page.getByRole('button', { name: 'Save feedback candidate', exact: true }).click(); uiActions.push('feedback-save');
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Feedback saved as a candidate.')`);
    let item = await find();
    assert.equal(item.tip.state, 'candidate'); assert.equal(item.record.sha256, sha(originalText));
    assert.equal(item.record.scope.memberId, memberId); assert.equal(item.record.sourceTaskId, opened.taskId);
    assert.ok(item.record.sources.some(source => source.kind === 'feedback' && source.eventId === item.tip.eventId && source.sha256 === sha(originalText)));
    observations.push({ action: 'candidate', item });
    const article = `${panel} article:has(textarea):has-text(${JSON.stringify('Memory ' + item.record.memoryId)})`;
    const selectEvidence = async () => page.locator(`${article} input[type="checkbox"]`).click();
    await selectEvidence(); await fill(`${article} label:text-is("Change reason") textarea`, '明确采用工程师提供的37纳秒上限');
    await page.getByRole('button', { name: 'Adopt', exact: true }).click(); uiActions.push('explicit-adopt-v1');
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('adopted recorded.')`);
    assert.equal(item.index.state,'pending','Offline feedback is persisted before service/index work.');
    // Start the existing dependency only after genuine offline UI save/adoption succeeded.
    serviceStarted = true;
    const running = await service('start');
    assert.equal(running.receipt.state, 'running', JSON.stringify(running.receipt));assert.ok(running.receipt.owned.pid);
    observations.push({action:'service-start',...running});
    item = await confirmed(item.record.memoryId, 1);
    await page.getByRole('button', { name: 'Refresh memory', exact: true }).click();
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Index: confirmed')`);
    // A different scope/fact distinguishes SRAM retrieval from generic every-record projection.
    const distractor = await memory<MemoryView>('feedback', { requestId: randomUUID(), target: { kind: 'project' }, text: '项目 A 的 UART 波特率固定为 115200，串口不是 SRAM 存储器。', reason: '独立干扰事实', conditions: ['UART'] });
    await memory('adopt', { requestId: randomUUID(), ...cas(distractor), action: 'adopted', reason: '仅采用串口事实', evidenceRefs: distractor.record.sources });
    await confirmed(distractor.record.memoryId, 1);
    const checkQueries = async (expected: MemoryView, expectedText: string, expectedNs: 37 | 23) => {
      for (const query of queries) {
        const context = await memory<TeamMemoryContext>('query', { query, limit: 8, memberId });
        observations.push({ action: 'query', query, context });
        const applied = context.records.find(record => record.record.memoryId === expected.record.memoryId);
        assert.ok(applied, `Chinese retrieval missed SRAM fact: ${query}`);
        assert.equal(applied.record.text, expectedText); assert.equal(applied.record.version, expected.record.version);
        assert.equal(applied.record.sha256, sha(expectedText)); assert.equal(applied.tip.state, 'adopted');
        assert.deepEqual(applied.record.sources, expected.record.sources);
        assert.equal(applied.record.sourceTaskId, target.taskId); assert.equal(applied.record.scope.teamId, target.teamId);
        assert.equal(applied.retrieval.documentId, expected.index.documentId); assert.ok(applied.retrieval.excerpt.trim());
        assert.match(applied.retrieval.excerpt, /SRAM|静态随机|存储器|memory/iu, 'Native retrieval evidence must identify the SRAM fact');
        assert.match(applied.retrieval.excerpt, new RegExp(`\\b${expectedNs}\\b`, 'u'), 'Native extraction must preserve the independently expected cap');
        assert.equal(applied.retrieval.label, 'retrieval-evidence');
        assert.ok(context.records.every(record => record.record.memoryId !== expected.record.memoryId || record.record.version === expected.record.version));
      }
    };
    await checkQueries(item, originalText, 37);
    // Query through real UI too; API verification above is not claimed as a click.
    await fill(`${panel} label:text-is("Query memory") input`, queries[0]);
    await page.getByRole('button', { name: 'Query memory', exact: true }).click(); uiActions.push('query-v1');
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Retrieval evidence (${item.index.documentId})')`);
    await page.screenshot({ path: path.join(evidence, 'native-v1-confirmed.png'), fullPage: true, timeout: 10_000 });
    await selectEvidence(); await fill(`${article} label:text-is("Change reason") textarea`, '工程师纠正 SRAM 上限为23纳秒');
    await fill(`${article} label:text-is("Replacement text") textarea`, replacementText);
    await page.getByRole('button', { name: 'Correct to replacement candidate', exact: true }).click(); uiActions.push('correct-v2');
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Correction saved as a replacement candidate.')`);
    let corrected = await find(item.record.memoryId);
    assert.equal(corrected.record.version, 2); assert.equal(corrected.tip.state, 'candidate'); assert.equal(corrected.record.text, replacementText);
    assert.notEqual(corrected.index.documentId, item.index.documentId);
    const candidateContext = await memory<TeamMemoryContext>('query', { query: queries[1], limit: 8, memberId });
    assert.ok(candidateContext.records.every(record => record.record.memoryId !== item.record.memoryId), 'Correction immediately suppresses old 37 ns; 23 ns needs explicit adoption');
    await selectEvidence(); await fill(`${article} label:text-is("Change reason") textarea`, '明确采用更正后的23纳秒事实');
    await page.getByRole('button', { name: 'Adopt', exact: true }).click(); uiActions.push('explicit-adopt-v2');
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('adopted recorded.')`);
    corrected = await confirmed(item.record.memoryId, 2); await checkQueries(corrected, replacementText, 23);
    await page.getByRole('button', { name: 'Refresh memory', exact: true }).click();
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Index: confirmed')`);
    await page.screenshot({ path: path.join(evidence, 'native-v2-confirmed.png'), fullPage: true, timeout: 10_000 });
    await selectEvidence(); await fill(`${article} label:text-is("Change reason") textarea`, '撤销本事实的后续使用');
    await page.getByRole('button', { name: 'Disable', exact: true }).click(); uiActions.push('disable-v2');
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('disabled recorded.')`);
    assert.equal((await find(item.record.memoryId)).tip.state, 'disabled');
    const disabledContext = await memory<TeamMemoryContext>('query', { query: queries[1], limit: 8, memberId });
    observations.push({ action: 'disabled-query', context: disabledContext });
    assert.ok(disabledContext.records.every(record => record.record.memoryId !== item.record.memoryId));
    const clone = await team<{ teamId: string; version: number }>({ action: 'clone', teamId, title: 'No inherited private or project memory' });
    const cloneTask = await team<{ taskId: string }>({ action: 'startTask', teamId: clone.teamId, request: { requestId: randomUUID(), teamId: clone.teamId, expectedVersion: clone.version,
      goal: 'No inherited bank', input: {}, deadlineAt: new Date(deadline).toISOString(), closure: 'No member model execution' } });
    const cloneRef = { teamId: clone.teamId, taskId: cloneTask.taskId };
    assert.deepEqual((await memory<MemoryPage>('status', { page: { limit: 30 } }, cloneRef)).records, []);
    assert.deepEqual((await memory<TeamMemoryContext>('query', { query: queries[1], limit: 8 }, cloneRef)).records, []);
    const otherWorkspace = path.join(home.home, 'unrelated-project'); await mkdir(otherWorkspace);
    const otherSession = await post<{ result: { ok: boolean; value: { sessionId: string } } }>('/api/session/create', { type: 'client-request', rpcId: 'memory-other-project', method: 'session/create', payload: { args: { request: { cwd: otherWorkspace } } } });
    assert.equal(otherSession.body.result.ok, true);
    const refused = await post('/hima/api/memory', { sessionId: otherSession.body.result.value.sessionId, ...target, action: 'query', request: { query: queries[1], limit: 8, memberId } });
    assert.ok([403, 404].includes(refused.status), `Other-project session must refuse original task: HTTP ${refused.status}`);
    observations.push({ action: 'cross-project-refusal', status: refused.status });
    const stopped = await service('stop');
    assert.equal(stopped.receipt.state, 'stopped'); assert.equal(stopped.receipt.owned.quiescent, true);
    assert.equal(stopped.receipt.generation, running.receipt.generation);
    assert.throws(() => process.kill(running.receipt.owned.pid!, 0), 'Owned Hindsight process ended');
    serviceStarted = false; observations.push({ action: 'service-stop', ...stopped });
    const offline = await memory<MemoryPage>('status', { page: { limit: 30 } });
    assert.equal(offline.records.find(record => record.record.memoryId === item.record.memoryId)?.record.text, replacementText);
    await page.getByRole('button', { name: 'Refresh memory', exact: true }).click();
    await wait(`document.querySelector(${JSON.stringify(panel)}).innerText.includes('Current state: disabled')`);
    await browser.screenshot({ path: path.join(evidence, 'disabled-offline-readable.png'), fullPage: true, timeout: 10_000 });
    await writeFile(path.join(evidence, 'functional-result.json'), JSON.stringify({ result: 'functional-PASS-pending-cleanup', teamId, taskId: target.taskId, memberId, uiActions,
      memoryId: item.record.memoryId, originalDocumentId: item.index.documentId, correctedDocumentId: corrected.index.documentId,
      elapsedMs: Date.now() - startedAt, productMemberModelCalls: 0, extractionModel: 'deepseek-flash', extractionCalls: 'not measured; actual native extraction',
      sourceHistoryAndLateCallbackRaces: 'L2 responsibility; not independently covered here' }, null, 2));
  } catch (error) {
    // Do not copy raw network request bodies, env, tokens or credentials into evidence.
    await writeFile(path.join(evidence, 'failure.txt'), safeText(`${String(error)}\n${await browser?.page.evaluate<string>('document.body.innerText').catch(() => 'Renderer unavailable')}`));
    await browser?.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true, timeout: 10_000 }).catch(() => undefined);
    throw error;
  } finally {
    await writeFile(path.join(evidence, 'observations.json'), JSON.stringify(observations, null, 2));
    t.diagnostic(`Native Chinese memory evidence: ${evidence}`);
    // No unrelated process kill. A failed cleanup retains the complete isolated Home.
    if (browser) {
      let cleanupError: unknown;
      if (serviceStarted) {
        try {
          const stopped = await browser.page.evaluate<{ receipt: ServiceReceipt }>(`fetch('/hima/api/team-runtime',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop',serviceId:'hindsight'}),signal:AbortSignal.timeout(15000)}).then(response=>response.json())`);
          assert.equal(stopped.receipt.owned.quiescent, true, 'Preserve Home if actual service cleanup cannot be proven');
        } catch (error) { cleanupError = error; }
      }
      // Even a failed service stop must still attempt ordinary App/Host shutdown.
      try { await browser.dispose(); } catch (error) { cleanupError ??= error; }
      if (cleanupError !== undefined) throw cleanupError;
      await home.dispose();
    }
  }
  const functional=JSON.parse(await readFile(path.join(evidence,'functional-result.json'),'utf8'));
  const cleanup=JSON.parse(await readFile(path.join(evidence,'cleanup.json'),'utf8'));
  assert.deepEqual(cleanup.remainingPids,[]);assert.equal(cleanup.postmasterPidFileRemoved,true);
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({...functional,result:'PASS',cleanup:'owned processes and PG pidfile closed'},null,2));
});
