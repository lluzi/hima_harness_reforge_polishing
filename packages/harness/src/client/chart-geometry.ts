// The chart card's arithmetic (`hima_chart`, `HimaChartCard.tsx`): where each bar starts and ends,
// how each value is written, and how the tool's answer is read back. Pure and type-only imports, so
// it runs under Node's own loader in the contract tests.
import type { HimaChart, HimaChartAnswer } from '../charts.js';

type Role = HimaChart['series'][number]['role'];

export interface ChartBar {
  readonly series: string;
  readonly role: Role;
  readonly value: number | null;
  /** The value as printed at the bar's end, with the unit; "—" for a missing value. */
  readonly display: string;
  /** Start and end of the bar, as fractions (0..1) of the plot width; equal for a missing value. */
  readonly start: number;
  readonly end: number;
  /** The bar grows left of the zero line: its value is printed before its start. */
  readonly negative: boolean;
}

export interface ChartRow { readonly category: string; readonly highlight: boolean; readonly bars: readonly ChartBar[] }

export interface ChartGeometry {
  /** Where zero stands, as a fraction of the plot width (0 when every value is ≥ 0, 1 when ≤ 0). */
  readonly zero: number;
  /** One scale for every series (a zero line can stand for all of them). */
  readonly shared: boolean;
  /** Some value is negative / positive: the plot keeps room for labels on that side. */
  readonly hasNegative: boolean;
  readonly hasPositive: boolean;
  readonly rows: readonly ChartRow[];
  /** The legend, when there are two or three series. */
  readonly legend: readonly { readonly name: string; readonly role: Role }[];
}

/**
 * A number as the card prints it: `digits` decimals when the chart names them (zeros kept, so a
 * column reads evenly), else at most two with trailing zeros dropped; a true minus sign, and the
 * thousands of a number of five or more digits grouped with a thin space ("41 481", "1951.60").
 */
export function numberSaid(value: number, digits?: number): string {
  const places = digits ?? 2;
  const factor = 10 ** places;
  const magnitude = Math.round(Math.abs(value) * factor) / factor;
  let text = magnitude.toFixed(places);
  if (digits === undefined && text.includes('.')) text = text.replace(/\.?0+$/, '');
  const [whole, fraction] = text.split('.') as [string, string | undefined];
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009') : whole;
  const sign = value < 0 && magnitude > 0 ? '\u2212' : '';
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

/**
 * A value as the card prints it: at most two decimals, trailing zeros dropped, a true minus sign,
 * thousands grouped with a thin space, and the chart's unit after a space ("−12.4 ps", "1.52 %").
 */
export function chartValueSaid(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${numberSaid(value)}${unit === '' ? '' : ` ${unit}`}`;
}

/** Bars for every category and series: one scale for the whole chart, from its lowest value (or 0)
 *  to its highest (or 0), so bars of different series compare directly. A chart with no unit and
 *  several series measures different things (a share in %, a gain in ps): each series then gets its
 *  own scale, and its longest bar spans the plot. */
export function chartGeometry(chart: Pick<HimaChart, 'categories' | 'series' | 'highlight' | 'unit'>): ChartGeometry {
  const finite = (values: readonly (number | null)[]) => values.filter((value): value is number => value !== null && Number.isFinite(value));
  const scaleOf = (values: readonly number[]) => {
    const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    const span = hi - lo || 1;
    return { lo, hi, at: (value: number) => (value - lo) / span };
  };
  const all = finite(chart.series.flatMap((series) => series.values));
  const shared = scaleOf(all);
  const independent = chart.unit === '' && chart.series.length > 1;
  const scales = chart.series.map((series) => (independent ? scaleOf(finite(series.values)) : shared));
  const highlight = new Set(chart.highlight);
  const rows = chart.categories.map((category, index) => ({
    category, highlight: highlight.has(category),
    bars: chart.series.map((series, s) => {
      const value = series.values[index] ?? null;
      const scale = scales[s]!;
      const zero = scale.at(0);
      const end = value === null || !Number.isFinite(value) ? zero : scale.at(value);
      return {
        series: series.name, role: series.role, value, display: chartValueSaid(value, chart.unit),
        start: Math.min(zero, end), end: Math.max(zero, end), negative: value !== null && value < 0,
      };
    }),
  }));
  return {
    zero: shared.at(0), shared: !independent, hasNegative: shared.lo < 0, hasPositive: shared.hi > 0 || all.length === 0, rows,
    legend: chart.series.length >= 2 ? chart.series.map((series) => ({ name: series.name, role: series.role })) : [],
  };
}

// ---------------------------------------------------------------------------------------------------
// The metrics table (`kind: 'metrics'`): one row per measure, one value column per series, and the
// change from the first series to the last.

/** How a change reads: the better way, the worse way, no better way named, or no change at all. */
export type DeltaTone = 'better' | 'worse' | 'none' | 'same';

export interface MetricDelta {
  /** The absolute change with its sign ("+29.38", "−41", "0"); its unit is the row's. */
  readonly display: string;
  /** The relative change ("+1.51 %"), when it means something: never from a zero baseline, never
   *  across zero (a slack that turns from negative to positive), and never for a row already in %. */
  readonly percent?: string;
  readonly tone: DeltaTone;
}

export interface MetricRow {
  readonly category: string;
  readonly highlight: boolean;
  readonly unit: string;
  /** Each series' value, as printed (number only; the unit stands beside it). "—" when missing. */
  readonly values: readonly { readonly series: string; readonly role: Role; readonly value: number | null; readonly display: string }[];
  /** The change from the first series to the last; absent with one series or a missing value. */
  readonly delta?: MetricDelta;
}

export interface MetricsTable {
  readonly columns: readonly { readonly name: string; readonly role: Role }[];
  /** A change column is shown (two or more series). */
  readonly change: boolean;
  readonly rows: readonly MetricRow[];
  readonly legend: readonly { readonly name: string; readonly role: Role }[];
}

/** A signed number: "+29.38", "−41", "0". */
const signed = (value: number, digits?: number): string => {
  const said = numberSaid(value, digits);
  return value > 0 && /[1-9]/.test(said) ? `+${said}` : said;
};

/** The change from `first` to `last`, worded and toned by which way is better. */
export function metricDelta(first: number, last: number, unit: string, digits: number | undefined, better: 'higher' | 'lower' | 'none' | undefined): MetricDelta {
  const diff = last - first;
  const places = digits ?? 2;
  const same = Math.round(Math.abs(diff) * 10 ** places) === 0;
  const display = same ? numberSaid(0, digits) : signed(diff, digits);
  const crosses = (first < 0 && last > 0) || (first > 0 && last < 0);
  let percent: string | undefined;
  if (!same && first !== 0 && !crosses && unit !== '%') {
    const pct = (diff / Math.abs(first)) * 100;
    percent = `${signed(pct, Math.abs(pct) < 10 ? 2 : 1)} %`;
  }
  const tone: DeltaTone = same ? 'same' : better === undefined || better === 'none' ? 'none'
    : (diff > 0) === (better === 'higher') ? 'better' : 'worse';
  return { display, ...(percent === undefined ? {} : { percent }), tone };
}

/** A metrics chart as a table: per-row unit and digits (`units`, `digits`), the change from the
 *  first series to the last toned by `betterEach` (else the chart's own `better`). */
export function metricsTable(chart: Pick<HimaChart, 'categories' | 'series' | 'highlight' | 'unit' | 'units' | 'digits' | 'betterEach' | 'better'>): MetricsTable {
  const n = chart.categories.length;
  const fits = <T,>(list: readonly T[] | undefined) => (list !== undefined && list.length === n ? list : undefined);
  const units = fits(chart.units), digits = fits(chart.digits), betterEach = fits(chart.betterEach);
  const highlight = new Set(chart.highlight);
  const change = chart.series.length >= 2;
  const rows = chart.categories.map((category, index) => {
    const unit = units?.[index] ?? chart.unit;
    const places = digits?.[index];
    const values = chart.series.map((series) => {
      const value = series.values[index] ?? null;
      return { series: series.name, role: series.role, value, display: value === null || !Number.isFinite(value) ? '—' : numberSaid(value, places) };
    });
    const first = values[0]!.value, last = values[values.length - 1]!.value;
    const delta = change && first !== null && last !== null ? metricDelta(first, last, unit, places, betterEach?.[index] ?? chart.better) : undefined;
    return { category, highlight: highlight.has(category), unit, values, ...(delta === undefined ? {} : { delta }) };
  });
  const columns = chart.series.map((series) => ({ name: series.name, role: series.role }));
  return { columns, change, rows, legend: change ? columns : [] };
}

/** The tool's answer, read from the call's text, when it is one; anything else is not drawn. */
export function readChartAnswer(text: string): HimaChartAnswer | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (typeof value !== 'object' || value === null) return undefined;
  const chart = (value as { chart?: unknown }).chart as Partial<HimaChart> | undefined;
  if (chart === undefined || chart === null || chart.schema !== 'hima-chart/1' || !Array.isArray(chart.categories) || !Array.isArray(chart.series)) return undefined;
  if (chart.series.length === 0 || chart.series.some((series) => !Array.isArray(series?.values) || series.values.length !== chart.categories!.length)) return undefined;
  const full: HimaChart = {
    ...chart, schema: 'hima-chart/1', kind: chart.kind === 'metrics' ? 'metrics' : 'bar', title: String(chart.title ?? ''), unit: chart.unit ?? '', highlight: chart.highlight ?? [],
    source: String(chart.source ?? ''), categories: chart.categories, series: chart.series.map((series) => ({ ...series, role: series.role ?? 'neutral' })),
  } as HimaChart;
  const answer = value as { source?: HimaChartAnswer['source']; note?: unknown };
  return { chart: full, ...(answer.source === undefined ? {} : { source: answer.source }), ...(typeof answer.note === 'string' && answer.note !== '' ? { note: answer.note } : {}) } as HimaChartAnswer;
}
