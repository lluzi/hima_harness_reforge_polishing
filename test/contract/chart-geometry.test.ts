// L1: the chat's chart card (`hima_chart`) draws bars from one scale for the whole chart, writes each
// value with its unit, and reads the tool's answer back without trusting anything else in the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, chartValueSaid, readChartAnswer } from '../../packages/harness/src/client/chart-geometry.ts';
import { himaChart } from '../../packages/harness/src/charts.ts';

const proposal = himaChart.parse({
  schema: 'hima-chart/1', title: 'Why these cells: timing', unit: 'ps', categories: ['XNOR3', 'BUF', 'XOR2'],
  series: [{ name: 'Stock delay', values: [24, 15, null], role: 'baseline' }, { name: 'AndesCell target', values: [21.6, 13.8, 18.4], role: 'proposed' }],
  highlight: ['XNOR3'], better: 'lower', source: 'HimaTime stage breakdown (stage_breakdown.rpt)',
});

test('one scale for every series: the longest bar spans the plot, each bar from zero to its value', () => {
  const g = chartGeometry(proposal);
  assert.equal(g.zero, 0);
  assert.equal(g.hasNegative, false);
  assert.equal(g.rows.length, 3);
  const [xnor3, buf, xor2] = g.rows;
  assert.equal(xnor3!.highlight, true);
  assert.equal(buf!.highlight, false);
  assert.equal(xnor3!.bars[0]!.end, 1, 'the largest value fills the plot');
  assert.equal(xnor3!.bars[1]!.end, 21.6 / 24);
  assert.equal(buf!.bars[0]!.end, 15 / 24);
  assert.ok(xnor3!.bars.every((bar) => bar.start === 0));
  assert.deepEqual([xor2!.bars[0]!.value, xor2!.bars[0]!.start, xor2!.bars[0]!.end, xor2!.bars[0]!.display], [null, 0, 0, '—'], 'a missing value draws no bar');
  assert.deepEqual(g.legend, [{ name: 'Stock delay', role: 'baseline' }, { name: 'AndesCell target', role: 'proposed' }]);
  assert.deepEqual(chartGeometry({ ...proposal, series: [proposal.series[0]!] }).legend, [], 'one series needs no legend');
});

test('no unit and several series (a share in %, a gain in ps): each series is drawn on its own scale', () => {
  const g = chartGeometry({ categories: ['XNOR3', 'BUF'], unit: '', highlight: [], series: [{ name: 'Share of worst-path delay (%)', values: [27.4, 18.1], role: 'baseline' }, { name: 'Estimated recovery (ps)', values: [7.9, 4.6], role: 'proposed' }] });
  assert.equal(g.shared, false);
  assert.equal(g.rows[0]!.bars[0]!.end, 1);
  assert.equal(g.rows[0]!.bars[1]!.end, 1, 'the largest recovery fills the plot too');
  assert.equal(g.rows[1]!.bars[1]!.end, 4.6 / 7.9);
  assert.equal(g.rows[0]!.bars[1]!.display, '7.9');
  assert.equal(chartGeometry(proposal).shared, true, 'a unit means one scale');
});

test('negative values: zero stands inside the plot and a negative bar grows left of it', () => {
  const g = chartGeometry({ categories: ['path 1', 'path 2'], unit: 'ps', highlight: [], series: [{ name: 'Before', values: [-12, -4], role: 'baseline' }, { name: 'After', values: [3, 6], role: 'measured' }] });
  assert.equal(g.hasNegative, true);
  assert.equal(g.hasPositive, true);
  assert.equal(g.zero, 12 / 18);
  const before = g.rows[0]!.bars[0]!, after = g.rows[0]!.bars[1]!;
  assert.deepEqual([before.start, before.end, before.negative], [0, 12 / 18, true]);
  assert.deepEqual([after.start, after.negative], [12 / 18, false]);
  assert.ok(Math.abs(after.end - 15 / 18) < 1e-12);
  const all = chartGeometry({ categories: ['a'], unit: '', highlight: [], series: [{ name: 's', values: [-5], role: 'neutral' }] });
  assert.deepEqual([all.zero, all.hasPositive, all.rows[0]!.bars[0]!.start, all.rows[0]!.bars[0]!.end], [1, false, 0, 1]);
});

test('values: two decimals at most, trailing zeros dropped, a true minus, the unit after a space', () => {
  assert.equal(chartValueSaid(21.6, 'ps'), '21.6 ps');
  assert.equal(chartValueSaid(1.52, '%'), '1.52 %');
  assert.equal(chartValueSaid(-12.345, 'ps'), '−12.35 ps');
  assert.equal(chartValueSaid(1968, 'MHz'), '1968 MHz');
  assert.equal(chartValueSaid(12000.5, ''), '12 000.5');
  assert.equal(chartValueSaid(0, 'ps'), '0 ps');
  assert.equal(chartValueSaid(null, 'ps'), '—');
});

test('the tool answer is read from its JSON text; anything else is not a chart', () => {
  const answer = readChartAnswer(JSON.stringify({ chart: proposal, source: { kind: 'pack', pack: 'andes-cell-fmax', file: 'charts/x.chart.json', sha256: 'ab' }, note: 'XNOR3 sits on 6 of the 20 worst stages.' }));
  assert.ok(answer !== undefined);
  assert.equal(answer.chart.title, 'Why these cells: timing');
  assert.equal(answer.note, 'XNOR3 sits on 6 of the 20 worst stages.');
  assert.equal(answer.source.kind, 'pack');
  assert.equal(readChartAnswer('not json'), undefined);
  assert.equal(readChartAnswer(JSON.stringify({ chart: { ...proposal, schema: 'other' } })), undefined);
  assert.equal(readChartAnswer(JSON.stringify({ chart: { ...proposal, series: [{ name: 'x', values: [1], role: 'neutral' }] } })), undefined, 'one value per category');
});
