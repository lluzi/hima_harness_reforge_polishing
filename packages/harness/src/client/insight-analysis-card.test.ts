import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The card imports `../question-headline.js` (the built name); under type stripping the source is `.ts`.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) { if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context); throw error; }
} });

const { readInsightAnalysisCard }: typeof import('./insight-analysis-card.js') = await import(`./insight-analysis-card.${'ts'}`);
const block = (value: unknown, extra: { kind?: string; isError?: boolean } = { kind: 'result' }) =>
  ({ callId: 'c', ...extra, content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] });
const page = '/hima/analysis/run-1?session=s';

test('a proposal is shown for the person to answer, with what it would read and how long it may take', () => {
  const card = readInsightAnalysisCard(block({ action: 'propose', proposalId: 'p', ready: true, requestId: 'req', question: 'How does leakage scale with VT?',
    sources: ['/data/lib/a.lib'], buildsOn: ['vt-leakage@1'], pack: { id: 'libinsight-analysis', version: '0.1.0' }, site: 'linglong-libinsight', timeBoxMinutes: 45, unknowns: [], nextActions: [] }));
  assert.deepEqual(card, { kind: 'proposal', ready: true, question: 'How does leakage scale with VT?', sources: ['/data/lib/a.lib'], buildsOn: ['vt-leakage@1'],
    pack: 'libinsight-analysis 0.1.0', site: 'linglong-libinsight', timeBoxMinutes: 45, unknowns: [] });
  const unready = readInsightAnalysisCard(block({ action: 'propose', ready: false, question: 'q', unknowns: ['The Site is not reachable.'] }));
  assert.equal(unready.kind === 'proposal' && unready.ready, false);
  assert.deepEqual(unready.kind === 'proposal' ? unready.unknowns : [], ['The Site is not reachable.']);
});

test('a started analysis and a result open the analysis page; the state words follow admission first', () => {
  assert.deepEqual(readInsightAnalysisCard(block({ action: 'confirm', runId: 'run-1', kind: 'ran', page })), { kind: 'started', runId: 'run-1', page });
  const admitted = readInsightAnalysisCard(block({ action: 'result', runId: 'run-1', page, status: 'ended-goal-met', admission: { admitted: true }, analysis: 'vt-leakage@2',
    question: 'q', summary: 'HVT to LVT costs 9.9x leakage.', plots: [{}, {}] }));
  assert.deepEqual(admitted, { kind: 'result', runId: 'run-1', page, state: 'admitted', said: 'Admitted as vt-leakage@2', question: 'q', summary: 'HVT to LVT costs 9.9x leakage.', plotCount: 2 });
  const running = readInsightAnalysisCard(block({ action: 'result', runId: 'run-1', page, status: 'running', task: { state: 'running' }, admission: { admitted: false, reason: 'no Reader-accepted result yet' } }));
  assert.equal(running.kind === 'result' && running.said, 'Running · resident task running');
  const refused = readInsightAnalysisCard(block({ action: 'result', runId: 'run-1', page, status: 'ended-goal-not-met', admission: { admitted: false, reason: 'admission declined it' } }));
  assert.equal(refused.kind === 'result' && refused.state, 'not-admitted');
  assert.equal(refused.kind === 'result' && refused.said, 'ended-goal-not-met · admission declined it');
});

test('a list names each analysis with its page; pending, failed and unreadable calls keep their own words', () => {
  const list = readInsightAnalysisCard(block({ action: 'list', analyses: [
    { runId: 'run-2', page, question: 'q2', status: 'running' },
    { runId: 'run-1', page, question: 'q1', status: 'ended-goal-met', analysis: { id: 'a', version: 1, admitted: true } },
    { runId: 'run-0' },
  ] }));
  assert.deepEqual(list, { kind: 'list', rows: [{ runId: 'run-2', page, said: 'Running', question: 'q2' }, { runId: 'run-1', page, said: 'Admitted as a@1', question: 'q1' }] });
  assert.deepEqual(readInsightAnalysisCard({ callId: 'c' }), { kind: 'pending' });
  assert.deepEqual(readInsightAnalysisCard(block('Library analyses are unavailable on this Host.', { kind: 'result', isError: true })),
    { kind: 'text', text: 'Library analyses are unavailable on this Host.', error: true });
  assert.deepEqual(readInsightAnalysisCard(block('not json')), { kind: 'text', text: 'not json', error: false });
  assert.equal(readInsightAnalysisCard(block({ action: 'confirm' })).kind, 'text', 'a start without a Run and page is shown as text, not as a button to nowhere');
});

test('a long Guide-written question is shown on the card by its first sentence', () => {
  const long = 'At the typical corner tt0p8v25c, compare the SAED14 inverter cells in the three Vt flavours HVT, RVT and LVT. For each drive strength pair the variants and plot leakage against delay, evaluated at one fixed input transition and output load.';
  const card = readInsightAnalysisCard(block({ action: 'result', runId: 'run-1', page, status: 'ended-goal-met', admission: { admitted: true }, analysis: 'a@3', question: long }));
  assert.equal(card.kind === 'result' && card.question, 'At the typical corner tt0p8v25c, compare the SAED14 inverter cells in the three Vt flavours HVT, RVT and LVT.');
});
