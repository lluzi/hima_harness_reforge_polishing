// Drawable geometry for one plot of an admitted Resident analysis (ADR-0020, 2026-10-05 revision).
// The Pack Reader has already held the delivery to its schema; this module only turns a declared plot
// over its dataset into what a renderer draws: scales with nice ticks, marks with their tooltip text,
// series with fixed palette slots, and, when the declaration cannot be drawn, the reason in words.
// Pure and React-free, so the projections are tested apart from the SVG that paints them.
import type { LibInsightAnalysisResult } from '../libinsight-analyses.js';

export type AnalysisPlotSpec = LibInsightAnalysisResult['plots'][number];
export type AnalysisDataset = LibInsightAnalysisResult['datasets'][string];
type Column = AnalysisDataset['columns'][number];
type Cell = number | string | null;

/** How much one plot draws; the rest stays in the dataset and is counted, never silently dropped. */
export const plotLimits = { points: 5000, tableRows: 200, series: 8, sequentialSteps: 9 } as const;

/** `label` is the plot's own name for the column (or the column name); `title` adds the unit. */
export interface AxisTitle { readonly column: string; readonly label: string; readonly title: string; readonly unit?: string }
export interface LinearAxis extends AxisTitle { readonly kind: 'linear'; readonly domain: readonly [number, number]; readonly ticks: readonly number[]; readonly step: number }
export interface BandAxis extends AxisTitle { readonly kind: 'band'; readonly categories: readonly string[] }
/** One series in legend order; `slot` 1..8 is its fixed categorical colour. */
export interface SeriesKey { readonly name: string; readonly slot: number }
/** What a projection left out, in words a person can act on. */
export type PlotNotes = readonly string[];

export interface BarMark { readonly category: number; readonly series: number; readonly value: number; readonly tip: string }
export interface PointMark { readonly x: number; readonly y: number; readonly tip: string }
export interface HeatCell { readonly x: number; readonly y: number; readonly value: number | null; readonly step?: number; readonly tip: string }
export interface TableColumn { readonly name: string; readonly header: string; readonly type: Column['type'] }

export type PlotGeometry =
  | { readonly kind: 'cannot-draw'; readonly id: string; readonly title: string; readonly reason: string }
  | { readonly kind: 'bar'; readonly id: string; readonly title: string; readonly x: BandAxis; readonly y: LinearAxis; readonly series: readonly SeriesKey[]; readonly bars: readonly BarMark[]; readonly notes: PlotNotes }
  | { readonly kind: 'line' | 'scatter'; readonly id: string; readonly title: string; readonly x: LinearAxis; readonly y: LinearAxis; readonly series: readonly SeriesKey[]; readonly lines: readonly { readonly series: number; readonly points: readonly PointMark[] }[]; readonly notes: PlotNotes }
  | { readonly kind: 'heatmap'; readonly id: string; readonly title: string; readonly x: BandAxis; readonly y: BandAxis; readonly value: AxisTitle & { readonly domain: readonly [number, number]; readonly steps: readonly { readonly from: number; readonly to: number }[] }; readonly cells: readonly HeatCell[]; readonly notes: PlotNotes }
  | { readonly kind: 'table'; readonly id: string; readonly title: string; readonly table: TableProjection };

export interface TableProjection { readonly columns: readonly TableColumn[]; readonly rows: readonly (readonly string[])[]; readonly totalRows: number; readonly shownRows: number }

const isNumber = (value: Cell): value is number => typeof value === 'number' && Number.isFinite(value);

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/** 1, 2, 2.5 or 5 times a power of ten: the step a person reads without arithmetic. */
function niceStep(rough: number): number {
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  return (fraction < 1.5 ? 1 : fraction < 2.25 ? 2 : fraction < 3.5 ? 2.5 : fraction < 7.5 ? 5 : 10) * power;
}
const decimalsOf = (step: number): number => {
  if (Number.isInteger(step)) return 0;
  const text = step.toExponential(); const [mantissa = '', exponent = '0'] = text.split('e');
  const fraction = mantissa.split('.')[1]?.length ?? 0;
  return Math.max(0, fraction - Number(exponent));
};
const clean = (value: number, decimals: number): number => Number(value.toFixed(Math.min(20, decimals)));

/**
 * A domain widened to whole steps and the ticks inside it, about `count` of them. An empty span is
 * widened around its value so a constant series still has an axis.
 */
export function niceScale(min: number, max: number, count = 5): { domain: [number, number]; ticks: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) throw new RangeError('a scale needs finite bounds');
  if (min > max) [min, max] = [max, min];
  if (min === max) { const half = Math.abs(min) / 2 || 0.5; min -= half; max += half; }
  const step = niceStep((max - min) / Math.max(1, count));
  const decimals = decimalsOf(step);
  const low = clean(Math.floor(min / step + 1e-9) * step, decimals), high = clean(Math.ceil(max / step - 1e-9) * step, decimals);
  const ticks: number[] = [];
  for (let i = 0, at = low; at <= high + step / 2 && i < 1000; i++, at = clean(low + i * step, decimals)) ticks.push(at);
  return { domain: [low, high], ticks, step };
}

/** A tick label at the precision its step needs, thousands separated; exponent form at the extremes. */
export function formatTick(value: number, step: number): string {
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e7 || step < 1e-4) return value.toExponential(2).replace(/\.?0+e/, 'e');
  const decimals = Math.min(10, decimalsOf(step));
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** A data value as a tooltip shows it: up to six significant digits, no trailing zeros. */
export function formatValue(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e7 || abs < 1e-4) return value.toExponential(5).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(6)));
}

/** Map `value` from `domain` onto `range` linearly; a renderer's one scale function. */
export const scaleLinear = (domain: readonly [number, number], range: readonly [number, number]) => (value: number): number =>
  domain[1] === domain[0] ? (range[0] + range[1]) / 2 : range[0] + (value - domain[0]) / (domain[1] - domain[0]) * (range[1] - range[0]);

const withUnit = (value: string, unit?: string) => unit === undefined || unit === '' ? value : `${value} ${unit}`;

// ---------------------------------------------------------------------------------------------
// Columns and guards
// ---------------------------------------------------------------------------------------------

class CannotDraw extends Error {}

function columnOf(dataset: AnalysisDataset, datasetName: string, role: string, ref: { readonly column: string; readonly label?: string } | undefined): { index: number; column: Column; axis: AxisTitle } {
  if (ref === undefined || typeof ref.column !== 'string' || ref.column === '') throw new CannotDraw(`the plot names no ${role} column`);
  const index = dataset.columns.findIndex(column => column.name === ref.column);
  if (index < 0) throw new CannotDraw(`dataset ${datasetName} has no column ${ref.column} for ${role}`);
  const column = dataset.columns[index]!;
  const label = ref.label !== undefined && ref.label !== '' ? ref.label : column.name;
  return { index, column, axis: { column: column.name, label, title: column.unit ? `${label} (${column.unit})` : label, ...(column.unit ? { unit: column.unit } : {}) } };
}

function requireNumeric(dataset: AnalysisDataset, datasetName: string, role: string, at: { index: number; column: Column }): void {
  if (at.column.type !== 'number') throw new CannotDraw(`${role} column ${at.column.name} holds text; this plot needs numbers there`);
  dataset.rows.forEach((row, rowIndex) => {
    const value = row[at.index] ?? null;
    if (value === null) return;
    if (!isNumber(value)) throw new CannotDraw(`row ${String(rowIndex + 1)} of ${datasetName} has ${typeof value === 'number' ? String(value) : JSON.stringify(value)} in ${at.column.name}; ${role} needs a finite number`);
  });
}

const categoryText = (value: Cell): string => value === null ? '(missing)' : typeof value === 'number' ? formatValue(value) : value;

/** Series names in first-appearance order with fixed slots; series past the palette are counted, not repainted. */
function seriesOf(rows: readonly (readonly Cell[])[], index: number | undefined): { keys: SeriesKey[]; slotOf: Map<string, number>; dropped: number } {
  const names: string[] = [];
  if (index === undefined) names.push('');
  else for (const row of rows) { const name = categoryText(row[index] ?? null); if (!names.includes(name)) names.push(name); }
  const kept = names.slice(0, plotLimits.series);
  return { keys: kept.map((name, i) => ({ name, slot: i + 1 })), slotOf: new Map(kept.map((name, i) => [name, i])), dropped: names.length - kept.length };
}

function missingNote(count: number, column: Column): string | undefined {
  return count === 0 ? undefined : `${String(count)} row${count === 1 ? '' : 's'} with no ${column.name} (${column.nullMeans ?? 'missing'}) not drawn`;
}
const seriesNote = (dropped: number) => dropped === 0 ? undefined : `${String(dropped)} more series beyond the first ${String(plotLimits.series)} are not drawn; see the data table`;
const capNote = (drawn: number, total: number, what: string) => total <= drawn ? undefined : `first ${drawn.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${what} drawn`;
const notes = (...items: (string | undefined)[]): string[] => items.filter((item): item is string => item !== undefined);

// ---------------------------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------------------------

function projectBar(plot: AnalysisPlotSpec, dataset: AnalysisDataset): PlotGeometry {
  const x = columnOf(dataset, plot.dataset, 'x', plot.x), y = columnOf(dataset, plot.dataset, 'y', plot.y);
  requireNumeric(dataset, plot.dataset, 'y', y);
  const s = plot.series ? columnOf(dataset, plot.dataset, 'series', plot.series) : undefined;
  const { keys, slotOf, dropped } = seriesOf(dataset.rows, s?.index);
  const categories: string[] = [], seen = new Set<string>(), bars: BarMark[] = [];
  let missing = 0, repeated = 0, eligible = 0;
  for (const row of dataset.rows) {
    const value = row[y.index] ?? null;
    const seriesName = s === undefined ? '' : categoryText(row[s.index] ?? null);
    const series = slotOf.get(seriesName);
    if (series === undefined) continue;
    if (value === null) { missing++; continue; }
    eligible++;
    if (bars.length >= plotLimits.points) continue;
    const category = categoryText(row[x.index] ?? null);
    const key = JSON.stringify([category, seriesName]);
    if (seen.has(key)) { repeated++; continue; }
    seen.add(key);
    let at = categories.indexOf(category);
    if (at < 0) { at = categories.length; categories.push(category); }
    bars.push({ category: at, series, value: value as number, tip: `${category}${s === undefined ? '' : ` · ${seriesName}`}: ${withUnit(formatValue(value as number), y.column.unit)}` });
  }
  if (bars.length === 0) throw new CannotDraw(`dataset ${plot.dataset} has no ${y.column.name} values to draw`);
  const values = bars.map(bar => bar.value);
  const scale = niceScale(Math.min(0, ...values), Math.max(0, ...values));
  return { kind: 'bar', id: plot.id, title: plot.title, x: { kind: 'band', ...x.axis, categories }, y: { kind: 'linear', ...y.axis, ...scale }, series: s === undefined ? [] : keys, bars,
    notes: notes(missingNote(missing, y.column), seriesNote(dropped), capNote(plotLimits.points, eligible, 'bars'),
      repeated === 0 ? undefined : `${String(repeated)} row${repeated === 1 ? '' : 's'} repeat a ${x.column.name}${s === undefined ? '' : ` and ${s.column.name}`}; the first is drawn`) };
}

function projectXY(plot: AnalysisPlotSpec, dataset: AnalysisDataset, kind: 'line' | 'scatter'): PlotGeometry {
  const x = columnOf(dataset, plot.dataset, 'x', plot.x), y = columnOf(dataset, plot.dataset, 'y', plot.y);
  requireNumeric(dataset, plot.dataset, 'x', x); requireNumeric(dataset, plot.dataset, 'y', y);
  const s = plot.series ? columnOf(dataset, plot.dataset, 'series', plot.series) : undefined;
  const { keys, slotOf, dropped } = seriesOf(dataset.rows, s?.index);
  const lines = keys.map((_, series) => ({ series, points: [] as PointMark[] }));
  let missing = 0, eligible = 0, drawn = 0;
  for (const row of dataset.rows) {
    const seriesName = s === undefined ? '' : categoryText(row[s.index] ?? null);
    const series = slotOf.get(seriesName);
    if (series === undefined) continue;
    const xv = row[x.index] ?? null, yv = row[y.index] ?? null;
    if (xv === null || yv === null) { missing++; continue; }
    eligible++;
    if (drawn >= plotLimits.points) continue;
    drawn++;
    lines[series]!.points.push({ x: xv as number, y: yv as number, tip: `${s === undefined ? '' : `${seriesName} · `}${x.axis.label} ${withUnit(formatValue(xv as number), x.column.unit)}: ${withUnit(formatValue(yv as number), y.column.unit)}` });
  }
  if (drawn === 0) throw new CannotDraw(`dataset ${plot.dataset} has no rows with both ${x.column.name} and ${y.column.name}`);
  if (kind === 'line') for (const line of lines) line.points.sort((a, b) => a.x - b.x);
  const xs = lines.flatMap(line => line.points.map(point => point.x)), ys = lines.flatMap(line => line.points.map(point => point.y));
  return { kind, id: plot.id, title: plot.title, x: { kind: 'linear', ...x.axis, ...niceScale(Math.min(...xs), Math.max(...xs)) }, y: { kind: 'linear', ...y.axis, ...niceScale(Math.min(...ys), Math.max(...ys)) },
    series: s === undefined ? [] : keys, lines: lines.filter(line => line.points.length > 0),
    notes: notes(missing === 0 ? undefined : `${String(missing)} row${missing === 1 ? '' : 's'} missing ${x.column.name} or ${y.column.name} (${y.column.nullMeans ?? x.column.nullMeans ?? 'missing'}) not drawn`, seriesNote(dropped), capNote(plotLimits.points, eligible, 'points')) };
}

/** Band categories: numbers ascending (left to right, and bottom to top on y), text in first-appearance order. */
function bandOf(rows: readonly (readonly Cell[])[], at: { index: number; column: Column }, axis: 'x' | 'y'): string[] {
  const values: Cell[] = [];
  for (const row of rows) { const value = row[at.index] ?? null; if (value !== null && !values.includes(value)) values.push(value); }
  if (at.column.type === 'number') {
    const numbers = (values.filter(isNumber)).sort((a, b) => a - b);
    return (axis === 'y' ? numbers.reverse() : numbers).map(formatValue);
  }
  return values.map(categoryText);
}

function projectHeatmap(plot: AnalysisPlotSpec, dataset: AnalysisDataset): PlotGeometry {
  const x = columnOf(dataset, plot.dataset, 'x', plot.x), y = columnOf(dataset, plot.dataset, 'y', plot.y), v = columnOf(dataset, plot.dataset, 'value', plot.value);
  requireNumeric(dataset, plot.dataset, 'value', v);
  for (const [role, at] of [['x', x], ['y', y]] as const) if (at.column.type === 'number') requireNumeric(dataset, plot.dataset, role, at);
  const xs = bandOf(dataset.rows, x, 'x'), ys = bandOf(dataset.rows, y, 'y');
  const seen = new Set<string>(), raw: { x: number; y: number; value: number | null; xName: string; yName: string }[] = [];
  let repeated = 0, eligible = 0, unplaced = 0;
  for (const row of dataset.rows) {
    const xv = row[x.index] ?? null, yv = row[y.index] ?? null;
    if (xv === null || yv === null) { unplaced++; continue; }
    const xName = categoryText(xv), yName = categoryText(yv);
    eligible++;
    if (raw.length >= plotLimits.points) continue;
    const key = JSON.stringify([xName, yName]);
    if (seen.has(key)) { repeated++; continue; }
    seen.add(key);
    raw.push({ x: xs.indexOf(xName), y: ys.indexOf(yName), value: (row[v.index] ?? null) as number | null, xName, yName });
  }
  const values = raw.map(cell => cell.value).filter((value): value is number => value !== null);
  if (values.length === 0) throw new CannotDraw(`dataset ${plot.dataset} has no ${v.column.name} values to draw`);
  const min = Math.min(...values), max = Math.max(...values), count = plotLimits.sequentialSteps;
  const width = (max - min) / count;
  const steps = Array.from({ length: count }, (_, i) => ({ from: min + i * width, to: i === count - 1 ? max : min + (i + 1) * width }));
  const stepOf = (value: number) => max === min ? Math.floor(count / 2) : Math.min(count - 1, Math.floor((value - min) / (max - min) * count));
  const missing = raw.filter(cell => cell.value === null).length;
  const cells: HeatCell[] = raw.map(cell => ({ x: cell.x, y: cell.y, value: cell.value, ...(cell.value === null ? {} : { step: stepOf(cell.value) }),
    tip: `${x.axis.label} ${withUnit(cell.xName, x.column.unit)} · ${y.axis.label} ${withUnit(cell.yName, y.column.unit)}: ${cell.value === null ? v.column.nullMeans ?? 'missing' : withUnit(formatValue(cell.value), v.column.unit)}` }));
  return { kind: 'heatmap', id: plot.id, title: plot.title, x: { kind: 'band', ...x.axis, categories: xs }, y: { kind: 'band', ...y.axis, categories: ys },
    value: { ...v.axis, domain: [min, max], steps }, cells,
    notes: notes(missing === 0 ? undefined : `${String(missing)} cell${missing === 1 ? '' : 's'} with no ${v.column.name} (${v.column.nullMeans ?? 'missing'}) shown hatched`,
      unplaced === 0 ? undefined : `${String(unplaced)} row${unplaced === 1 ? '' : 's'} missing ${x.column.name} or ${y.column.name} not drawn`,
      capNote(plotLimits.points, eligible, 'cells'), repeated === 0 ? undefined : `${String(repeated)} row${repeated === 1 ? '' : 's'} repeat a cell; the first is drawn`) };
}

/** The dataset as a table: units in the headers, null as the column's own `nullMeans`, the first rows only. */
export function projectTable(dataset: AnalysisDataset, limit: number = plotLimits.tableRows): TableProjection {
  const columns = dataset.columns.map(column => ({ name: column.name, header: column.unit ? `${column.name} (${column.unit})` : column.name, type: column.type }));
  const rows = dataset.rows.slice(0, limit).map(row => dataset.columns.map((column, i) => {
    const value = row[i] ?? null;
    return value === null ? column.nullMeans ?? 'missing' : String(value);
  }));
  return { columns, rows, totalRows: dataset.rows.length, shownRows: rows.length };
}

/**
 * Project one declared plot of an admitted result into drawable geometry. Never throws for a
 * declaration it cannot draw: the answer is then `cannot-draw` with the reason.
 */
export function projectPlot(result: Pick<LibInsightAnalysisResult, 'datasets'>, plot: AnalysisPlotSpec): PlotGeometry {
  const id = typeof plot?.id === 'string' ? plot.id : '(unnamed)', title = typeof plot?.title === 'string' && plot.title !== '' ? plot.title : id;
  try {
    const dataset = result.datasets?.[plot.dataset];
    if (dataset === undefined || !Array.isArray(dataset.columns) || !Array.isArray(dataset.rows)) throw new CannotDraw(`the result has no dataset ${String(plot.dataset)}`);
    switch (plot.kind) {
      case 'bar': return projectBar(plot, dataset);
      case 'line': case 'scatter': return projectXY(plot, dataset, plot.kind);
      case 'heatmap': return projectHeatmap(plot, dataset);
      case 'table': return { kind: 'table', id, title, table: projectTable(dataset) };
      default: throw new CannotDraw(`plot kind ${String((plot as { kind?: unknown }).kind)} is not one this tab draws`);
    }
  } catch (error) {
    if (error instanceof CannotDraw) return { kind: 'cannot-draw', id, title, reason: error.message };
    throw error;
  }
}
