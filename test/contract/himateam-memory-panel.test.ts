import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { MemoryView } from '@hima/harness';

// A hook/element fixture exercises UI state and request payloads only. It is not React DOM,
// Electron, authenticated Host persistence, or native indexing acceptance.
type Element = { type: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown>; children: unknown[] };
type Hooks = { values: unknown[]; effects: { deps: unknown[]; cleanup?: () => void }[]; cursor: number };
type Fixture = { current: Hooks; jobs: (() => void)[]; useState(value: unknown): [unknown, (value: unknown) => void]; useEffect(fn: () => (() => void) | void, deps: unknown[]): void };
const fixture: Fixture = {
  current: { values: [], effects: [], cursor: 0 }, jobs: [],
  useState(value) { const hooks = this.current, i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = value; return [hooks.values[i], next => { hooks.values[i] = typeof next === 'function' ? next(hooks.values[i]) : next; }]; },
  useEffect(fn, deps) { const hooks = this.current, i = hooks.cursor++, old = hooks.effects[i]; if (old && deps.every((dep, j) => Object.is(dep, old.deps[j]))) return; old?.cleanup?.(); this.jobs.push(() => { hooks.effects[i] = { deps, cleanup: fn() || undefined }; }); },
};
const modules = createRequire(new URL('../../packages/harness/package.json', import.meta.url));
const esbuild = modules('esbuild') as { build(options: unknown): Promise<{ outputFiles: { text: string }[] }> };
const sourcePath = new URL('../../packages/harness/src/client/WorkMemoryPanel.tsx', import.meta.url);
const original = await readFile(sourcePath, 'utf8');
const built = await esbuild.build({ stdin: { contents: original, loader: 'tsx', resolveDir: new URL('../../packages/harness/src/client/', import.meta.url).pathname }, bundle: true, write: false, format: 'esm', jsx: 'transform', jsxFactory: 'createElement', jsxFragment: 'Fragment', plugins: [{ name: 'ui-fixture', setup(build: { onResolve(options: unknown, callback: (args: { path: string }) => unknown): void; onLoad(options: unknown, callback: () => unknown): void }) {
  build.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'fixture-react' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-react' }, () => ({ contents: `const f=globalThis.__teamMemoryFixture; export const useState=v=>f.useState(v), useEffect=(fn,deps)=>f.useEffect(fn,deps), useRef=v=>{const [r]=f.useState({current:v});return r}, useCallback=(fn,deps)=>{const [r]=f.useState({fn,deps});if(!deps.every((d,i)=>Object.is(d,r.deps[i]))) {r.fn=fn;r.deps=deps};return r.fn};` }));
  build.onResolve({ filter: /api\.js$/ }, () => ({ path: 'api', namespace: 'fixture-api' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents: `export const correctExperience=()=>{}, fetchExperienceCandidates=()=>{}, fetchMemorySources=()=>{}, readMemory=()=>{}, saveMemory=()=>{};` }));
  build.onResolve({ filter: /workbench-state\.js$/ }, () => ({ path: 'state', namespace: 'fixture-state' }));
  build.onLoad({ filter: /.*/, namespace: 'fixture-state' }, () => ({ contents: `export const experienceCorrectionRequest=()=>{},memoryEvidenceMatches=()=>true,memoryScopeKey=(s,r)=>s+':'+r,memorySummaryInput=()=>{};` }));
} }], banner: { js: `const Fragment='fragment';const createElement=(type,props,...children)=>({type,props:props||{},children});` } });
(globalThis as unknown as { __teamMemoryFixture: Fixture }).__teamMemoryFixture = fixture;
const panelModule = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0]!.text).toString('base64')}`) as { WorkMemoryPanel(props: Record<string, unknown>): Element };
const draft = { subject: '', decisions: '', openQuestions: '', todo: '' };
function mounted(call: (action: string, request: unknown, signal?: AbortSignal) => Promise<unknown>) {
  const instances = new Map<string, Hooks>(); let props: Record<string, unknown> = { sessionId: 'session', draft, onDraft() {}, teamTarget: { teamId: 'team', taskId: 'task', members: [{ id: 'member', role: 'Engineer' }] }, teamOperations: { call } };
  let tree: Element;
  const expand = (element: unknown, path: string): unknown => {
    if (Array.isArray(element)) return element.map((child, i) => expand(child, `${path}.${i}`));
    if (element === null || typeof element !== 'object' || !('type' in element)) return element;
    const node = element as Element, identity = `${path}:${String(node.props.key ?? '')}`;
    if (typeof node.type === 'function') { const hooks = instances.get(identity) ?? { values: [], effects: [], cursor: 0 }; instances.set(identity, hooks); hooks.cursor = 0; fixture.current = hooks; return expand(node.type({ ...node.props, children: node.children }), identity); }
    return { ...node, children: node.children.map((child, i) => expand(child, `${identity}.${i}`)) };
  };
  const render = () => { tree = expand(panelModule.WorkMemoryPanel(props), 'root') as Element; return tree; };
  const nodes = () => { const result: Element[] = []; const walk = (value: unknown): void => { if (Array.isArray(value)) { value.forEach(walk); return; } if (!value || typeof value !== 'object' || !('type' in value)) return; const node = value as Element; result.push(node); node.children.forEach(walk); }; walk(tree); return result; };
  const text = (node: unknown): string => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' && 'children' in node ? text((node as Element).children) : node == null || typeof node === 'boolean' ? '' : String(node);
  const settle = async () => { for (let i = 0; i < 6; i++) { fixture.jobs.splice(0).forEach(job => job()); await Promise.resolve(); render(); } };
  const label = (name: string) => { const value = nodes().find(node => node.type === 'label' && text(node).startsWith(name)); assert.ok(value, name); return value.children.find(child => child && typeof child === 'object' && ['input', 'textarea', 'select'].includes(String((child as Element).type))) as Element; };
  const change = (name: string, value: string) => { (label(name).props.onChange as (event: unknown) => void)({ target: { value } }); render(); };
  const button = (name: string) => { const value = nodes().find(node => node.type === 'button' && text(node).trim() === name); assert.ok(value, name); return value; };
  const click = async (name: string) => { const node = button(name); assert.equal(node.props.disabled, false, name); (node.props.onClick as () => void)(); await settle(); };
  render();
  return { render, settle, text: () => text(tree), change, button, click, nodes, setTask(taskId: string) { for (const hooks of instances.values()) hooks.effects.forEach(effect => effect?.cleanup?.()); instances.clear(); props = { ...props, teamTarget: { ...(props.teamTarget as object), taskId } }; render(); } };
}
function record(state: 'candidate' | 'adopted' | 'disabled' = 'candidate', text = 'SRAM 上限 37 ns'): MemoryView {
  return { record: { schemaVersion: 1, memoryId: 'memory', version: 1, scope: { projectId: 'project', teamId: 'team', kind: 'team' }, sourceTaskId: 'task', sourceRunId: 'run', team: { teamId: 'team', version: 1, sha256: 'a'.repeat(64) }, kind: 'feedback', text, sha256: 'b'.repeat(64), conditions: ['SRAM'], sources: [{ kind: 'feedback', eventId: 'feedback-event', sha256: 'b'.repeat(64) }], createdAt: '2026-10-13T01:00:00Z', createdBy: { kind: 'human', actorId: 'person' } }, tip: { schemaVersion: 1, eventId: state === 'candidate' ? 'feedback-event' : `${state}-event`, requestId: 'request', payloadSha256: 'c'.repeat(64), memoryId: 'memory', version: 1, revision: 2, event: state === 'candidate' ? 'feedback' : state, state, actor: { kind: 'human', actorId: 'person' }, taskId: 'task', runId: 'run', createdAt: '2026-10-13T02:00:00Z', reason: 'User feedback', evidenceRefs: [], conditions: ['SRAM'] }, index: { schemaVersion: 1, operationId: 'operation', memoryId: 'memory', version: 1, adoptionRevision: 1, documentId: 'document-v1', state: 'unknown', revision: 1, createdAt: '', updatedAt: '', reason: 'Service offline' } };
}
test('existing Guide/Campaign path and props are preserved as a hook-owning child', () => {
  const guide = panelModule.WorkMemoryPanel({ sessionId: 'guide', draft, onDraft() {} });
  assert.equal(typeof guide.type, 'function'); assert.equal((guide.type as Function).name, 'LegacyWorkMemoryPanel');
  assert.equal(guide.props.draft, draft); const campaign = panelModule.WorkMemoryPanel({ sessionId: 'guide', runId: 'run', draft, onDraft() {} }); assert.equal(campaign.props.runId, 'run');
  assert.match(original, /Refresh exact sources/); assert.match(original, /Save source-linked summary/);
});
test('feedback stays candidate and adoption sends exact CAS and feedback provenance', async () => {
  const calls: { action: string; request: Record<string, unknown> }[] = []; const candidate = record();
  const ui = mounted(async (action, request) => { calls.push({ action, request: request as Record<string, unknown> }); return action === 'status' ? { records: [] } : action === 'adopt' ? record('adopted') : candidate; }); await ui.settle();
  ui.change('Feedback', candidate.record.text); ui.change('Reason', 'Reviewed SRAM constraint'); await ui.click('Save feedback candidate');
  assert.match(ui.text(), /Candidate — requires explicit adoption/); assert.match(ui.text(), /Index:\s+unknown/); assert.match(ui.text(), /Service offline/); assert.equal(calls.filter(call => call.action === 'adopt').length, 0);
  const box = ui.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox')!; (box.props.onChange as (event: unknown) => void)({ target: { checked: true } }); ui.render(); ui.change('Change reason', 'Accept source'); await ui.click('Adopt');
  const request = calls.find(call => call.action === 'adopt')!.request; assert.equal(request.expectedRevision, 2); assert.equal(request.expectedVersion, 1); assert.equal(request.supersedesEventId, 'feedback-event'); assert.deepEqual(request.evidenceRefs, [{ kind: 'feedback', eventId: 'feedback-event', sha256: candidate.record.sha256 }]); assert.ok(!('actor' in request)); assert.ok(!('bankId' in request)); assert.match(ui.text(), /Current state: adopted/);
});
test('disable requires new feedback for re-adoption and correction never adopts automatically', async () => {
  const disabled = record('disabled'); const calls: string[] = [];
  const ui = mounted(async action => { calls.push(action); return { records: [disabled] }; }); await ui.settle();
  assert.match(ui.text(), /New feedback after disable/); assert.equal(ui.button('Re-adopt with new evidence').props.disabled, true); assert.match(ui.text(), /Save new feedback in this scope after disable/);
  const candidate = record(); const correctionCalls: { action: string; request: Record<string, unknown> }[] = [];
  const correction = mounted(async (action, request) => { correctionCalls.push({ action, request: request as Record<string, unknown> }); return action === 'status' ? { records: [candidate] } : { ...candidate, record: { ...candidate.record, version: 2, text: 'SRAM 上限 23 ns' }, tip: { ...candidate.tip, event: 'corrected', eventId: 'corrected-event', revision: 3 } }; }); await correction.settle();
  const box = correction.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox')!; (box.props.onChange as (event: unknown) => void)({ target: { checked: true } }); correction.render(); correction.change('Change reason', 'Measured new cap'); correction.change('Replacement text', 'SRAM 上限 23 ns'); await correction.click('Correct to replacement candidate');
  assert.equal(correctionCalls.at(-1)!.action, 'correct'); assert.equal(correctionCalls.at(-1)!.request.text, 'SRAM 上限 23 ns'); assert.match(correction.text(), /Adopt it separately/); assert.equal(correctionCalls.some(call => call.action === 'adopt'), false);
});
test('scope change aborts stale query and resets draft/results/errors', async () => {
  let resolveQuery: ((value: unknown) => void) | undefined; let querySignal: AbortSignal | undefined;
  const ui = mounted(async (action, _request, signal) => action === 'status' ? { records: [record()] } : new Promise(resolve => { resolveQuery = resolve; querySignal = signal; })); await ui.settle(); ui.change('Feedback', 'old draft'); ui.change('Query memory', 'SRAM');
  const query = ui.button('Query memory'); (query.props.onClick as () => void)(); await Promise.resolve(); ui.change('Memory scope', 'member:member'); await ui.settle(); assert.equal(querySignal!.aborted, true); resolveQuery!({ records: [{ ...record('adopted'), retrieval: { documentId: 'document-v1', excerpt: 'stale result', label: 'retrieval-evidence' } }], diagnostics: [] }); await ui.settle(); assert.equal(ui.text().includes('stale result'), false); assert.equal(ui.text().includes('old draft'), false);
});
test('query labels checked record and retrieval provenance; API error preserves saved source', async () => {
  const item = record('adopted'); const ui = mounted(async action => action === 'status' ? { records: [item] } : action === 'query' ? { records: [{ ...item, retrieval: { documentId: 'document-v1', excerpt: 'retrieved SRAM detail', label: 'retrieval-evidence' } }], diagnostics: ['Index service pending'] } : Promise.reject(new Error('CAS conflict'))); await ui.settle(); ui.change('Query memory', 'SRAM latency'); await ui.click('Query memory'); assert.match(ui.text(), /Query results with provenance/); assert.match(ui.text(), /Retrieval evidence/); assert.match(ui.text(), /Source Task\s+task/);
  const box = ui.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox')!; (box.props.onChange as (event: unknown) => void)({ target: { checked: true } }); ui.render(); ui.change('Change reason', 'Invalidate'); await ui.click('Disable'); assert.match(ui.text(), /CAS conflict/); assert.match(ui.text(), /SRAM 上限 37 ns/);
});
test('re-adoption uses only a new feedback event after disable, never the adoption event', async () => {
  const disabled = record('disabled'); const newer = record(); newer.record.memoryId = 'new-feedback'; newer.record.createdAt = '2026-10-13T03:00:00Z'; newer.record.sources = [{ kind: 'feedback', eventId: 'new-feedback-event', sha256: newer.record.sha256 }]; newer.tip.eventId = 'new-feedback-event';
  let request: Record<string, unknown> | undefined;
  const ui = mounted(async (action, body) => { if (action === 'status') return { records: [disabled, newer] }; request = body as Record<string, unknown>; return { ...disabled, tip: { ...disabled.tip, eventId: 're-adopted-event', state: 're-adopted', event: 're-adopted' } }; }); await ui.settle();
  const box = ui.nodes().find(node => node.type === 'input' && node.props.type === 'checkbox')!; (box.props.onChange as (event: unknown) => void)({ target: { checked: true } }); ui.render(); ui.change('Change reason', 'New measurement supports reuse'); await ui.click('Re-adopt with new evidence');
  assert.equal(request!.action, 're-adopted'); assert.deepEqual(request!.evidenceRefs, [{ kind: 'feedback', eventId: 'new-feedback-event', sha256: newer.record.sha256 }]); assert.equal(request!.supersedesEventId, 'disabled-event');
});
test('changing task aborts pending save and prevents old task result appearing', async () => {
  let resolveSave: ((value: unknown) => void) | undefined; let saveSignal: AbortSignal | undefined;
  const ui = mounted(async (action, _body, signal) => action === 'status' ? { records: [] } : new Promise(resolve => { resolveSave = resolve; saveSignal = signal; })); await ui.settle(); ui.change('Feedback', 'Old task feedback'); ui.change('Reason', 'Old task reason'); (ui.button('Save feedback candidate').props.onClick as () => void)(); await Promise.resolve(); ui.setTask('new-task'); await ui.settle(); assert.equal(saveSignal!.aborted, true); resolveSave!(record()); await ui.settle(); assert.equal(ui.text().includes('37 ns'), false); assert.match(ui.text(), /new-task/);
});
test('material/artifact-backed adopted memory can be disabled or corrected without unrelated feedback', async () => {
  const sources: MemoryView['record']['sources'] = [
    { kind: 'material', taskId: 'task', stageId: 'input', materialId: 'spec', sha256: 'd'.repeat(64), bytes: 37 },
    { kind: 'artifact', taskId: 'task', runId: 'run', effectId: 'effect', name: 'report', sha256: 'e'.repeat(64), bytes: 23 },
  ];
  for (const source of sources) {
    for (const action of ['disabled', 'correct'] as const) {
      const adopted = record('adopted'); adopted.record.kind = 'experience'; adopted.record.sources = [source];
      const calls: { action: string; request: Record<string, unknown> }[] = [];
      const ui = mounted(async (operation, request) => {
        calls.push({ action: operation, request: request as Record<string, unknown> });
        return operation === 'status' ? { records: [adopted] } : { ...adopted, record: { ...adopted.record, ...(action === 'correct' ? { version: 2, text: 'Human corrected cap 23 ns' } : {}) }, tip: { ...adopted.tip, event: action === 'correct' ? 'corrected' : 'disabled', state: action === 'correct' ? 'candidate' : 'disabled', eventId: `${action}-event`, revision: 3 } };
      });
      await ui.settle(); assert.equal(ui.nodes().some(node => node.type === 'input' && node.props.type === 'checkbox'), false);
      assert.equal(ui.button('Disable').props.disabled, true); assert.equal(ui.button('Correct to replacement candidate').props.disabled, true);
      ui.change('Change reason', 'Human invalidates this source fact');
      if (action === 'correct') { assert.equal(ui.button('Correct to replacement candidate').props.disabled, true); ui.change('Replacement text', 'Human corrected cap 23 ns'); }
      await ui.click(action === 'correct' ? 'Correct to replacement candidate' : 'Disable');
      const sent = calls.at(-1)!; assert.equal(sent.action, action === 'correct' ? 'correct' : 'adopt');
      assert.equal(sent.request.expectedVersion, 1); assert.equal(sent.request.expectedRevision, 2); assert.equal(sent.request.supersedesEventId, 'adopted-event'); assert.deepEqual(sent.request.evidenceRefs, []);
      if (action === 'correct') { assert.equal(sent.request.text, 'Human corrected cap 23 ns'); assert.deepEqual(sent.request.sources, []); assert.match(ui.text(), /Adopt it separately/); assert.equal(ui.button('Adopt').props.disabled, true); }
      else { assert.equal(sent.request.action, 'disabled'); assert.equal(ui.button('Re-adopt with new evidence').props.disabled, true); }
    }
  }
});
test('explicit Refresh requests reconciliation and current event conditions replace historical record conditions', async () => {
  const adopted = record('adopted'); adopted.record.conditions = ['Historical-record-condition']; adopted.tip.conditions = ['Current-event-condition'];
  const calls: { action: string; request: Record<string, unknown> }[] = [];
  const ui = mounted(async (action, request) => { calls.push({ action, request: request as Record<string, unknown> }); return { records: [adopted] }; }); await ui.settle();
  assert.match(ui.text(), /Current-event-condition/); assert.equal(ui.text().includes('Historical-record-condition'), false);
  const replacementConditions = ui.nodes().find(node => node.type === 'textarea' && node.props.value === 'Current-event-condition'); assert.ok(replacementConditions);
  calls.length = 0; await ui.click('Refresh memory'); assert.equal(calls.length, 1); assert.equal(calls[0]!.action, 'status'); assert.equal(calls[0]!.request.reconcile, true); assert.deepEqual(calls[0]!.request.page, { limit: 30 });
});
test('initial adoption uses checked original material/artifact sources without manufacturing feedback', async () => {
  const sources: MemoryView['record']['sources'] = [
    { kind: 'material', taskId: 'task', stageId: 'input', materialId: 'spec', sha256: 'd'.repeat(64), bytes: 37 },
    { kind: 'artifact', taskId: 'task', runId: 'run', effectId: 'effect', name: 'report', sha256: 'e'.repeat(64), bytes: 23 },
  ];
  for (const source of sources) {
    const candidate = record(); candidate.record.kind = 'experience'; candidate.record.sources = [source]; candidate.tip.event = 'proposed'; candidate.tip.eventId = 'proposal-event';
    const calls: { action: string; request: Record<string, unknown> }[] = [];
    const ui = mounted(async (action, request) => {
      calls.push({ action, request: request as Record<string, unknown> });
      return action === 'status' ? { records: [candidate] } : { ...candidate, tip: { ...candidate.tip, eventId: 'adopted-event', event: 'adopted', state: 'adopted', revision: 3 } };
    }); await ui.settle();
    assert.equal(ui.nodes().some(node => node.type === 'input' && node.props.type === 'checkbox'), false); assert.match(ui.text(), /Optional supporting feedback/); assert.equal(ui.button('Adopt').props.disabled, true);
    ui.change('Change reason', 'Reviewed original source'); await ui.click('Adopt');
    const sent = calls.at(-1)!; assert.equal(sent.action, 'adopt'); assert.equal(sent.request.action, 'adopted'); assert.equal(sent.request.expectedVersion, 1); assert.equal(sent.request.expectedRevision, 2); assert.equal(sent.request.supersedesEventId, 'proposal-event'); assert.deepEqual(sent.request.evidenceRefs, []);
    assert.equal(calls.some(call => call.action === 'feedback'), false); assert.match(ui.text(), /Current state: adopted/);
  }
  const sourceless = record(); sourceless.record.kind = 'experience'; sourceless.record.sources = []; sourceless.tip.event = 'proposed';
  const ui = mounted(async () => ({ records: [sourceless] })); await ui.settle(); ui.change('Change reason', 'Reason cannot replace source proof'); assert.equal(ui.button('Adopt').props.disabled, true);
  const disabled = record('disabled'); disabled.record.kind = 'experience'; disabled.record.sources = [sources[0]!];
  const retry = mounted(async () => ({ records: [disabled] })); await retry.settle(); retry.change('Change reason', 'Original source alone is not new proof'); assert.equal(retry.button('Re-adopt with new evidence').props.disabled, true);
});
