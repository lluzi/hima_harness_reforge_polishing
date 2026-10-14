import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// The page imports its sibling geometry module as `./analysis-plot.js` (the built name); under type
// stripping the source is the `.ts` file beside it.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) { if (specifier.startsWith('./') && specifier.endsWith('.js')) return next(`${specifier.slice(0, -3)}.ts`, context); throw error; }
} });

const subject: typeof import('./analysis-page.js') = await import(`./analysis-page.${'ts'}`);
const { analysisPage, analysisPageMessage, insightPage } = subject;
type Input = Parameters<typeof analysisPage>[0];
type Result = NonNullable<Input['detail']['result']>;

const before = 'a'.repeat(64), after = 'b'.repeat(64), mainSha = 'c'.repeat(64), resultSha = 'd'.repeat(64);
const result: Result = {
  schema: 'hima-libinsight-analysis/1', id: 'x', version: 2,
  question: 'How does delay scale with drive?', summary: 'Delay falls roughly as 1/drive.',
  sources: [{ path: '/libs/tt.lib', sha256Before: before, sha256After: before }],
  datasets: {
    cells: {
      columns: [{ name: 'cell', type: 'string' }, { name: 'family', type: 'string' }, { name: 'drive', type: 'number', unit: 'x' }, { name: 'rise', type: 'number', unit: 'ns', nullMeans: 'not characterised' }],
      rows: [['INV_1', 'INV', 1, 0.0341500006616], ['INV_2', 'INV', 2, 0.021], ['INVS_1', 'INVS', 1, 0.036], ['INVS_2', 'INVS', 2, null]],
    },
    grid: {
      columns: [{ name: 'slew', type: 'number', unit: 'ns' }, { name: 'load', type: 'number', unit: 'fF' }, { name: 'rise', type: 'number', unit: 'ns' }],
      rows: [[0.01, 1, 0.02], [0.02, 1, 0.03], [0.01, 2, 0.04], [0.02, 2, 0.05]],
    },
  },
  plots: [
    { id: 'bar', title: 'Rise by cell', kind: 'bar', dataset: 'cells', x: { column: 'cell' }, y: { column: 'rise', label: 'cell_rise' } },
    { id: 'line', title: 'Rise versus drive', kind: 'line', dataset: 'cells', x: { column: 'drive' }, y: { column: 'rise' }, series: { column: 'family' } },
    { id: 'scatter', title: 'Rise scatter', kind: 'scatter', dataset: 'cells', x: { column: 'drive' }, y: { column: 'rise' } },
    { id: 'heat', title: 'Rise grid', kind: 'heatmap', dataset: 'grid', x: { column: 'slew' }, y: { column: 'load' }, value: { column: 'rise' } },
    { id: 'table', title: 'All cells', kind: 'table', dataset: 'cells' },
  ],
  code: { main: { path: 'analysis/run.py', sha256: mainSha, text: 'import qualib\nprint(1 < 2)\n' }, files: [{ path: 'analysis/helper.py', sha256: after }] },
  run: { command: 'python3 analysis/run.py --lib /libs/tt.lib', exitCode: 0, elapsedSeconds: 1.4630000001, usedQualib: true },
  assumptions: ['Mid-grid point stands for the cell.'], limits: ['Only the TT corner was read.'],
};
const admitted: Input = {
  runId: 'run-1234', detail: { runId: 'run-1234', result, admission: { admitted: true } },
  entry: { runId: 'run-1234', createdAt: '2026-10-05T10:00:00Z', status: 'ended-goal-met', task: { state: 'succeeded' }, analysis: { id: 'x', version: 2, admitted: true, resultSha256: resultSha } },
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

test('an admitted result renders every plot, its data, and its provenance as one standalone page', () => {
  const html = analysisPage(admitted);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /<h1>How does delay scale with drive\?<\/h1>/);
  assert.match(html, /data-tone="good">Admitted as x@2</);
  assert.match(html, /Delay falls roughly as 1\/drive\./);
  for (const title of ['Rise by cell', 'Rise versus drive', 'Rise scatter', 'Rise grid', 'All cells']) assert.ok(html.includes(`<h3>${title}</h3>`), title);
  assert.equal(count(html, '<svg viewBox='), 4, 'one chart per drawable plot');
  assert.ok(html.includes('data-plot="table"') && html.includes('<th scope="col" data-type="number">rise (ns)</th>'));
  assert.equal(count(html, '<summary>Data table · '), Object.keys(admitted.detail.result!.datasets).length, 'each dataset once, however many plots draw it');
  assert.ok(html.includes('Data table · grid'));
  assert.ok(html.includes('0.03415') && !html.includes('0.0341500006616'), 'values are formatted, not raw float noise');
  assert.ok(html.includes('<ul class="legend"') && html.includes('>INVS</li>'), 'the two-series line has a legend');
  assert.ok(html.includes('<title>INV_1: 0.03415 ns</title>'), 'every mark carries its tooltip');
  assert.ok(html.includes('1 row with no rise (not characterised) not drawn'));
  assert.ok(html.includes('Mid-grid point stands for the cell.') && html.includes('Only the TT corner was read.'));
  assert.ok(html.includes(`title="${before}">${before.slice(0, 12)}</code>`) && html.includes('class="same"'));
  assert.ok(html.includes('python3 analysis/run.py --lib /libs/tt.lib') && html.includes('1.463 s'));
  assert.ok(html.includes('<dt>QuaLib API used</dt><dd>yes</dd>'));
  assert.ok(html.includes('<pre><code>import qualib\nprint(1 &lt; 2)\n</code></pre>') && html.includes('analysis/helper.py'));
  assert.ok(html.includes(`result SHA-256 <code title="${resultSha}">`));
  assert.ok(!html.includes('<script'), 'no script');
  assert.ok(!html.includes('http-equiv="refresh"'), 'a settled page does not reload');
  assert.ok(!/(?:src|href)="https?:/.test(html) && !html.includes('@import'), 'no external asset');
});

test('an unfinished analysis says the agent is working and reloads itself', () => {
  const html = analysisPage({ runId: 'run-9', refreshSeconds: 10, detail: { runId: 'run-9', admission: { admitted: false, reason: 'no Reader-accepted result yet' } },
    entry: { runId: 'run-9', createdAt: '2026-10-05T10:00:00Z', question: 'Which cell leaks most?', status: 'running', task: { state: 'running' } } });
  assert.ok(html.includes('<meta http-equiv="refresh" content="10">'));
  assert.match(html, /<h1>Which cell leaks most\?<\/h1>/);
  assert.ok(html.includes('data-tone="run">The resident agent is working · running<'));
  assert.ok(html.includes('reloads itself every 10 seconds'));
  assert.ok(!html.includes('<svg viewBox=') && !html.includes('<h2>Plots</h2>'));
});

test('a result in while admission runs is shown as pending; a declined one names its reason', () => {
  const pending = analysisPage({ runId: 'r', refreshSeconds: 5, detail: { runId: 'r', result, admission: { admitted: false, reason: 'admission has not finished' } },
    entry: { runId: 'r', createdAt: '2026-10-05T10:00:00Z', status: 'running', task: { state: 'succeeded' }, analysis: { admitted: false, notAdmittedReason: 'admission has not finished', resultSha256: resultSha } } });
  assert.ok(pending.includes('Reader accepted · admission pending') && pending.includes('<h2>Plots</h2>'));
  const declined = analysisPage({ runId: 'r', detail: { runId: 'r', result, admission: { admitted: false, reason: 'id x@2 already admitted with other bytes' } } });
  assert.ok(declined.includes('data-tone="warn">Reader accepted · not admitted<'));
  assert.ok(declined.includes('id x@2 already admitted with other bytes'));
});

test('an unreadable result is an alert, not plots; a Run that ended without one says so', () => {
  const html = analysisPage({ runId: 'r', detail: { runId: 'r', resultUnavailable: 'The accepted result cannot be read: checksum mismatch', admission: { admitted: true } } });
  assert.ok(html.includes('role="alert">The accepted result cannot be read: checksum mismatch<'));
  assert.ok(!html.includes('<svg viewBox='));
  const ended = analysisPage({ runId: 'r', detail: { runId: 'r', admission: { admitted: false } },
    entry: { runId: 'r', createdAt: '2026-10-05T10:00:00Z', status: 'ended-goal-not-met', task: { state: 'failed', reason: 'the script exited 1' } } });
  assert.ok(ended.includes('data-tone="bad">Ended without a Reader-accepted result · ended · goal not met<') && ended.includes('the script exited 1'));
});

test('model-authored text is escaped everywhere', () => {
  const evil = '<script>alert(1)</script>';
  const html = analysisPage({ runId: 'r"><script>', detail: { runId: 'r', admission: { admitted: true }, result: {
    ...result, question: evil, summary: evil, assumptions: [evil], limits: [evil],
    sources: [{ path: `/x/${evil}`, sha256Before: `"${evil}`, sha256After: before }],
    datasets: { [evil]: { columns: [{ name: evil, type: 'string' }, { name: 'v', type: 'number', unit: evil }], rows: [[evil, 1]] } },
    plots: [{ id: evil, title: evil, kind: 'bar', dataset: evil, x: { column: evil }, y: { column: 'v', label: evil } }, { id: 't', title: 't', kind: 'table', dataset: evil }, { id: 'n', title: evil, kind: 'line', dataset: 'nope' }],
    code: { main: { path: evil, sha256: evil, text: evil }, files: [{ path: evil, sha256: evil }] },
    run: { ...result.run, command: evil },
  } } });
  assert.ok(!html.includes('<script'), 'no raw script tag');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Cannot draw this plot: the result has no dataset nope.'));
  const message = analysisPageMessage(evil, `${evil} & more`);
  assert.ok(!message.includes('<script') && message.includes('&amp; more') && message.startsWith('<!doctype html>'));
});

test('a long specification-style question is headed by its first sentence, with the whole text one click away', () => {
  const { headlineOf } = subject;
  assert.equal(headlineOf('Short question?'), 'Short question?');
  const long = 'At the typical corner tt0p8v25c, compare the SAED14 inverter cells in the three Vt flavours HVT, RVT and LVT. For each drive strength pair the variants and plot leakage against delay, evaluated at one fixed input transition and output load.';
  assert.equal(headlineOf(long), 'At the typical corner tt0p8v25c, compare the SAED14 inverter cells in the three Vt flavours HVT, RVT and LVT.');
  const html = analysisPage({ ...admitted, detail: { ...admitted.detail, result: { ...admitted.detail.result!, question: long } } });
  assert.ok(html.includes('<h1>At the typical corner tt0p8v25c, compare the SAED14 inverter cells in the three Vt flavours HVT, RVT and LVT.</h1>'));
  assert.ok(html.includes('<summary>Full question</summary>') && html.includes('output load.</p></details>'));
  assert.ok(headlineOf('x'.repeat(400)).length <= 141, 'no sentence: cut to a heading length');
});

test('an insight page places the rules inertly in the template and names its one script by hash', async () => {
  const { createHash } = await import('node:crypto');
  const code = 'const d = JSON.parse(document.getElementById("insight-data").textContent);';
  const template = `<!doctype html><title>Library Insight</title><script type="application/json" id="insight-data">/*INSIGHT-DATA*/</script><script>${code}</script>`;
  const hostile = '</script><script>alert(1)</script>\u2028&';
  const { html, scriptSha256 } = insightPage({ template, rules: [{ id: 'vmin_bottleneck', kind: 'vmin', summary: hostile }], selected: 0 });
  assert.equal(scriptSha256, createHash('sha256').update(code, 'utf8').digest('base64'));
  assert.equal((html.match(/<script>/g) ?? []).length, 1, 'no data string opens a script');
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2, 'no data string closes the data element');
  const data = html.slice(html.indexOf('id="insight-data">') + 'id="insight-data">'.length, html.indexOf('</script>'));
  assert.deepEqual(JSON.parse(data), { rules: [{ id: 'vmin_bottleneck', kind: 'vmin', summary: hostile }], selected: 0 });
  assert.throws(() => insightPage({ template: template.replace('/*INSIGHT-DATA*/', ''), rules: [], selected: 0 }), /one data marker/);
  assert.throws(() => insightPage({ template: `${template}<script>more()</script>`, rules: [], selected: 0 }), /one executable script/);
});
