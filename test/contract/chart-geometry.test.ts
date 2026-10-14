// L1: the chat's chart card (`hima_chart`) draws bars from one scale for the whole chart, writes each
// value with its unit, and reads the tool's answer back without trusting anything else in the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, chartValueSaid, metricDelta, metricsTable, numberSaid, readChartAnswer } from '../../packages/harness/src/client/chart-geometry.ts';
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

// The metrics kind: the reference build's summary and the round's comparison with it.
const M = ['Fmax', 'Worst slack', 'TNS', 'Violating endpoints', 'Cell area', 'Utilization', 'Route DRC', 'New-cell instances'];
const comparison = himaChart.parse({
  schema: 'hima-chart/1', kind: 'metrics', title: 'Round 1: new library against the reference', unit: '', categories: M,
  units: ['MHz', 'ps', 'ns', '', 'µm²', '%', '', ''], digits: [2, 1, 3, 0, 0, 1, 0, 0],
  betterEach: ['higher', 'higher', 'higher', 'lower', 'lower', 'none', 'lower', 'none'],
  series: [{ name: 'Reference build', values: [1951.6, -12.4, -0.596, 74, 41200, 68.4, 0, 0], role: 'baseline' },
    { name: 'Round 1 new library', values: [1980.98, -4.8, -0.1, 33, 41481, 68.9, 0, 474], role: 'measured' }],
  highlight: ['Fmax'], source: 'RTL2GDS compare-round, round 1 (round-1.md)',
});

test('a metrics chart validates through himaChart; its per-row arrays must match the categories and are for metrics only', () => {
  assert.equal(comparison.kind, 'metrics');
  const bad = (patch: Record<string, unknown>) => himaChart.safeParse({ ...comparison, ...patch }).success;
  assert.equal(bad({ units: ['MHz'] }), false, 'one unit for eight rows');
  assert.equal(bad({ betterEach: [...comparison.betterEach!.slice(1), 'sideways'] }), false);
  assert.equal(bad({ kind: 'bar' }), false, 'units, digits and betterEach belong to a metrics chart');
  const answer = readChartAnswer(JSON.stringify({ chart: comparison, source: { kind: 'run', runId: 'r', path: 'reports/compare-round/r1/before-after.chart.json', sha256: 'x' } }));
  assert.equal(answer?.chart.kind, 'metrics', 'the card keeps the kind it was given');
  assert.deepEqual(answer?.chart.digits, comparison.digits);
});

test('numbers: digits are kept as given; without them, two decimals at most, trimmed', () => {
  assert.equal(numberSaid(1951.6, 2), '1951.60');
  assert.equal(numberSaid(-0.1, 3), '\u22120.100');
  assert.equal(numberSaid(41481, 0), '41\u2009481');
  assert.equal(numberSaid(68.4), '68.4');
  assert.equal(numberSaid(0, 1), '0.0');
});

test('the change: signed, with a relative change only where it means something, toned by which way is better', () => {
  assert.deepEqual(metricDelta(1951.6, 1980.98, 'MHz', 2, 'higher'), { display: '+29.38', percent: '+1.51 %', tone: 'better' });
  assert.deepEqual(metricDelta(-12.4, -4.8, 'ps', 1, 'higher'), { display: '+7.6', percent: '+61.3 %', tone: 'better' });
  assert.deepEqual(metricDelta(74, 33, '', 0, 'lower'), { display: '\u221241', percent: '\u221255.4 %', tone: 'better' });
  assert.deepEqual(metricDelta(41200, 41481, 'µm²', 0, 'lower'), { display: '+281', percent: '+0.68 %', tone: 'worse' });
  assert.deepEqual(metricDelta(-3.2, 1.4, 'ps', 1, 'higher'), { display: '+4.6', tone: 'better' }, 'no % for a slack that crosses zero');
  assert.deepEqual(metricDelta(0, 474, '', 0, 'none'), { display: '+474', tone: 'none' }, 'no % from a zero baseline; no better way');
  assert.deepEqual(metricDelta(68.4, 68.9, '%', 1, 'none'), { display: '+0.5', tone: 'none' }, 'no % of a %');
  assert.deepEqual(metricDelta(0, 0, '', 0, 'lower'), { display: '0', tone: 'same' });
  assert.deepEqual(metricDelta(18.6, 18.6, 'min', 1, 'lower'), { display: '0.0', tone: 'same' });
  assert.equal(metricDelta(10, 9, '', 0, undefined).tone, 'none', 'no better way named: muted');
});

test('the metrics table: one row per measure with its unit, a value per series, the change from the first to the last', () => {
  const table = metricsTable(comparison);
  assert.equal(table.change, true);
  assert.deepEqual(table.columns.map((c) => c.name), ['Reference build', 'Round 1 new library']);
  assert.deepEqual(table.legend.map((c) => c.role), ['baseline', 'measured']);
  const fmax = table.rows[0]!;
  assert.deepEqual([fmax.category, fmax.highlight, fmax.unit, fmax.values.map((v) => v.display), fmax.delta?.tone], ['Fmax', true, 'MHz', ['1951.60', '1980.98'], 'better']);
  assert.deepEqual(table.rows[2]!.values.map((v) => v.display), ['\u22120.596', '\u22120.100']);
  assert.equal(table.rows[4]!.delta?.tone, 'worse', 'more area is worse');
  const single = metricsTable({ ...comparison, series: [comparison.series[0]!] });
  assert.equal(single.change, false);
  assert.deepEqual(single.legend, [], 'one series: no legend, no change column');
  assert.ok(single.rows.every((row) => row.delta === undefined));
  const gap = metricsTable({ ...comparison, series: [comparison.series[0]!, { ...comparison.series[1]!, values: [null, ...comparison.series[1]!.values.slice(1)] }] });
  assert.deepEqual([gap.rows[0]!.values[1]!.display, gap.rows[0]!.delta], ['—', undefined], 'a missing value has no change');
});
