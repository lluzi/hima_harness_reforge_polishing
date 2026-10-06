import assert from 'node:assert/strict';
import test from 'node:test';

const subject: typeof import('./analysis-plot.js') = await import(`./analysis-plot.${'ts'}`);
const { niceScale, formatTick, formatValue, projectPlot, projectTable, plotLimits, scaleLinear } = subject;
type Plot = Parameters<typeof projectPlot>[1];
type Datasets = Parameters<typeof projectPlot>[0]['datasets'];

const datasets: Datasets = {
  delay: {
    columns: [{ name: 'cell', type: 'string' }, { name: 'corner', type: 'string' }, { name: 'delay', type: 'number', unit: 'ps', nullMeans: 'not characterised' }],
    rows: [['INV_X1', 'ss', 42], ['INV_X1', 'ff', 18], ['NAND2_X1', 'ss', 55], ['NAND2_X1', 'ff', null], ['NOR2_X1', 'ss', -3]],
  },
  sweep: {
    columns: [{ name: 'load', type: 'number', unit: 'fF' }, { name: 'slew', type: 'number', unit: 'ps' }, { name: 'corner', type: 'string' }],
    rows: [[4, 30, 'ss'], [1, 12, 'ss'], [2, 19, 'ss'], [1, 8, 'ff'], [4, 21, 'ff'], [2, null, 'ff']],
  },
  grid: {
    columns: [{ name: 'vdd', type: 'number', unit: 'V' }, { name: 'temp', type: 'number', unit: 'C' }, { name: 'leak', type: 'number', unit: 'nW', nullMeans: 'did not converge' }],
    rows: [[0.72, -40, 1], [0.8, -40, 2], [0.72, 125, 10], [0.8, 125, null]],
  },
  words: { columns: [{ name: 'name', type: 'string' }, { name: 'note', type: 'string' }], rows: [['a', 'x']] },
  bad: { columns: [{ name: 'k', type: 'string' }, { name: 'v', type: 'number' }], rows: [['a', 1], ['b', 'oops' as unknown as number]] },
};
const plot = (over: Partial<Plot> & Pick<Plot, 'kind' | 'dataset'>): Plot => ({ id: 'p', title: 'P', ...over });

test('nice scales cover the data with 1/2/2.5/5 steps and readable ticks', () => {
  assert.deepEqual(niceScale(0, 55), { domain: [0, 60], ticks: [0, 10, 20, 30, 40, 50, 60], step: 10 });
  assert.deepEqual(niceScale(-3, 55).domain, [-10, 60]);
  assert.deepEqual(niceScale(0.12, 0.83), { domain: [0.1, 0.9], ticks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], step: 0.1 });
  assert.deepEqual(niceScale(1, 4).ticks, [1, 1.5, 2, 2.5, 3, 3.5, 4]);
  assert.deepEqual(niceScale(7, 7).domain, [3, 11], 'a constant is widened around its value');
  assert.deepEqual(niceScale(0, 0).domain, [-0.6, 0.6]);
  assert.equal(formatTick(1500, 500), '1,500');
  assert.equal(formatTick(0.2, 0.2), '0.2');
  assert.equal(formatTick(2.5, 2.5), '2.5');
  assert.equal(formatTick(3, 2.5), '3.0');
  assert.equal(formatValue(1 / 3), '0.333333');
  assert.equal(formatValue(42), '42');
  assert.equal(scaleLinear([0, 60], [300, 0])(15), 225);
});

test('a bar plot groups by series in first-appearance order, keeps the zero baseline and skips nulls with their meaning', () => {
  const g = projectPlot({ datasets }, plot({ kind: 'bar', dataset: 'delay', x: { column: 'cell' }, y: { column: 'delay', label: 'Delay' }, series: { column: 'corner' } }));
  assert.equal(g.kind, 'bar');
  if (g.kind !== 'bar') return;
  assert.deepEqual(g.x.categories, ['INV_X1', 'NAND2_X1', 'NOR2_X1']);
  assert.deepEqual(g.series, [{ name: 'ss', slot: 1 }, { name: 'ff', slot: 2 }]);
  assert.equal(g.y.title, 'Delay (ps)');
  assert.deepEqual(g.y.domain, [-10, 60]);
  assert.deepEqual(g.bars.map(b => [b.category, b.series, b.value]), [[0, 0, 42], [0, 1, 18], [1, 0, 55], [2, 0, -3]]);
  assert.equal(g.bars[1]!.tip, 'INV_X1 · ff: 18 ps');
  assert.deepEqual(g.notes, ['1 row with no delay (not characterised) not drawn']);
});

test('series beyond the palette are counted, and the drawn ones keep their slots', () => {
  const rows = Array.from({ length: 10 }, (_, i) => [`c${String(i)}`, `s${String(i)}`, i + 1]);
  const g = projectPlot({ datasets: { many: { columns: datasets.delay!.columns, rows } } }, plot({ kind: 'bar', dataset: 'many', x: { column: 'cell' }, y: { column: 'delay' }, series: { column: 'corner' } }));
  assert.equal(g.kind, 'bar');
  if (g.kind !== 'bar') return;
  assert.equal(g.series.length, 8);
  assert.deepEqual(g.series.map(s => s.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(g.bars.length, 8);
  assert.ok(g.notes.some(note => note.startsWith('2 more series')));
});

test('a line plot sorts each series by x; a scatter keeps row order', () => {
  const line = projectPlot({ datasets }, plot({ kind: 'line', dataset: 'sweep', x: { column: 'load' }, y: { column: 'slew' }, series: { column: 'corner' } }));
  assert.equal(line.kind, 'line');
  if (line.kind !== 'line') return;
  assert.deepEqual(line.lines.map(l => l.points.map(p => [p.x, p.y])), [[[1, 12], [2, 19], [4, 30]], [[1, 8], [4, 21]]]);
  assert.equal(line.x.title, 'load (fF)');
  assert.deepEqual(line.x.domain, [1, 4]);
  assert.deepEqual(line.y.domain, [5, 30]);
  assert.equal(line.lines[0]!.points[0]!.tip, 'ss · load 1 fF: 12 ps');
  assert.deepEqual(line.notes, ['1 row missing load or slew (missing) not drawn']);
  const scatter = projectPlot({ datasets }, plot({ kind: 'scatter', dataset: 'sweep', x: { column: 'load' }, y: { column: 'slew' } }));
  assert.equal(scatter.kind, 'scatter');
  if (scatter.kind !== 'scatter') return;
  assert.deepEqual(scatter.series, [], 'one series needs no legend');
  assert.deepEqual(scatter.lines[0]!.points.map(p => p.x), [4, 1, 2, 1, 4]);
});

test('drawing is capped and the cap is said', () => {
  const rows = Array.from({ length: plotLimits.points + 7 }, (_, i) => [i, i * 2, 'one']);
  const g = projectPlot({ datasets: { big: { columns: datasets.sweep!.columns, rows } } }, plot({ kind: 'scatter', dataset: 'big', x: { column: 'load' }, y: { column: 'slew' } }));
  assert.equal(g.kind, 'scatter');
  if (g.kind !== 'scatter') return;
  assert.equal(g.lines[0]!.points.length, 5000);
  assert.deepEqual(g.notes, ['first 5,000 of 5,007 points drawn']);
});

test('a heatmap orders numeric bands, steps its sequential scale and keeps a null cell visible with its meaning', () => {
  const g = projectPlot({ datasets }, plot({ kind: 'heatmap', dataset: 'grid', x: { column: 'vdd' }, y: { column: 'temp' }, value: { column: 'leak', label: 'Leakage' } }));
  assert.equal(g.kind, 'heatmap');
  if (g.kind !== 'heatmap') return;
  assert.deepEqual(g.x.categories, ['0.72', '0.8']);
  assert.deepEqual(g.y.categories, ['125', '-40'], 'the larger y is at the top');
  assert.deepEqual(g.value.domain, [1, 10]);
  assert.equal(g.value.title, 'Leakage (nW)');
  assert.equal(g.value.steps.length, 9);
  assert.deepEqual(g.value.steps[0], { from: 1, to: 2 });
  assert.deepEqual(g.cells.map(c => [c.x, c.y, c.step]), [[0, 1, 0], [1, 1, 1], [0, 0, 8], [1, 0, undefined]]);
  assert.equal(g.cells[3]!.tip, 'vdd 0.8 V · temp 125 C: did not converge');
  assert.equal(g.cells[2]!.tip, 'vdd 0.72 V · temp 125 C: 10 nW');
});

test('a table puts units in headers, shows null as its meaning and counts the rows it does not show', () => {
  const t = projectTable(datasets.delay!, 2);
  assert.deepEqual(t.columns.map(c => c.header), ['cell', 'corner', 'delay (ps)']);
  assert.equal(t.totalRows, 5); assert.equal(t.shownRows, 2);
  const g = projectPlot({ datasets }, plot({ kind: 'table', dataset: 'delay' }));
  assert.equal(g.kind, 'table');
  if (g.kind !== 'table') return;
  assert.deepEqual(g.table.rows[3], ['NAND2_X1', 'ff', 'not characterised']);
  const rows = Array.from({ length: 250 }, (_, i) => ['c', 'k', i]);
  const big = projectTable({ columns: datasets.delay!.columns, rows });
  assert.equal(big.shownRows, 200); assert.equal(big.totalRows, 250);
});

test('a declaration that cannot be drawn says why instead of throwing', () => {
  const reason = (p: Plot) => { const g = projectPlot({ datasets }, p); return g.kind === 'cannot-draw' ? g.reason : `drew ${g.kind}`; };
  assert.equal(reason(plot({ kind: 'bar', dataset: 'nothing', x: { column: 'a' }, y: { column: 'b' } })), 'the result has no dataset nothing');
  assert.equal(reason(plot({ kind: 'bar', dataset: 'delay', x: { column: 'cell' }, y: { column: 'power' } })), 'dataset delay has no column power for y');
  assert.equal(reason(plot({ kind: 'bar', dataset: 'delay', x: { column: 'cell' } })), 'the plot names no y column');
  assert.equal(reason(plot({ kind: 'line', dataset: 'delay', x: { column: 'cell' }, y: { column: 'delay' } })), 'x column cell holds text; this plot needs numbers there');
  assert.equal(reason(plot({ kind: 'bar', dataset: 'bad', x: { column: 'k' }, y: { column: 'v' } })), 'row 2 of bad has "oops" in v; y needs a finite number');
  assert.equal(reason(plot({ kind: 'heatmap', dataset: 'words', x: { column: 'name' }, y: { column: 'note' }, value: { column: 'note' } })), 'value column note holds text; this plot needs numbers there');
  assert.equal(reason(plot({ kind: 'pie' as Plot['kind'], dataset: 'delay' })), 'plot kind pie is not one this tab draws');
  const g = projectPlot({ datasets: { nf: { columns: datasets.bad!.columns, rows: [['a', Number.NaN]] } } }, plot({ kind: 'bar', dataset: 'nf', x: { column: 'k' }, y: { column: 'v' } }));
  assert.equal(g.kind === 'cannot-draw' ? g.reason : g.kind, 'row 1 of nf has NaN in v; y needs a finite number');
});

test('numeric bands and series are keyed by the exact number, not its rounded label', () => {
  const close: Datasets[string] = { columns: [{ name: 'a', type: 'number' }, { name: 'b', type: 'number' }, { name: 'v', type: 'number' }], rows: [[0.1, 1, 5], [0.1000001, 1, 7]] };
  const g = projectPlot({ datasets: { close } }, plot({ kind: 'heatmap', dataset: 'close', x: { column: 'a' }, y: { column: 'b' }, value: { column: 'v' } }));
  assert.equal(g.kind, 'heatmap');
  if (g.kind !== 'heatmap') return;
  assert.equal(g.x.categories.length, 2);
  assert.deepEqual(g.cells.map(c => c.x), [0, 1]);
  assert.ok(!g.notes.some(note => note.includes('repeat')), 'two different numbers are two cells');
  const s = projectPlot({ datasets: { close } }, plot({ kind: 'scatter', dataset: 'close', x: { column: 'b' }, y: { column: 'v' }, series: { column: 'a' } }));
  assert.equal(s.kind === 'scatter' ? s.series.length : 0, 2);
});

test('20 000 distinct values project in well under a second', () => {
  const n = 20_000;
  const wide: Datasets[string] = { columns: [{ name: 'x', type: 'number' }, { name: 'y', type: 'string' }, { name: 'v', type: 'number' }], rows: Array.from({ length: n }, (_, i) => [i * 1.5, `r${String(i)}`, i]) };
  const started = performance.now();
  const heat = projectPlot({ datasets: { wide } }, plot({ kind: 'heatmap', dataset: 'wide', x: { column: 'x' }, y: { column: 'y' }, value: { column: 'v' } }));
  const bar = projectPlot({ datasets: { wide } }, plot({ kind: 'bar', dataset: 'wide', x: { column: 'y' }, y: { column: 'v' }, series: { column: 'x' } }));
  const line = projectPlot({ datasets: { wide } }, plot({ kind: 'line', dataset: 'wide', x: { column: 'v' }, y: { column: 'x' }, series: { column: 'y' } }));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 200, `three projections took ${elapsed.toFixed(0)} ms`);
  assert.equal(heat.kind === 'heatmap' ? heat.x.categories.length : 0, n);
  assert.equal(heat.kind === 'heatmap' ? heat.cells.length : 0, plotLimits.points);
  assert.ok(bar.kind === 'bar' && bar.notes.some(note => note.startsWith(`${String(n - 8)} more series`)));
  assert.ok(line.kind === 'line' && line.series.length === 8);
});
