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
 * A value as the card prints it: at most two decimals, trailing zeros dropped, a true minus sign,
 * thousands grouped with a thin space, and the chart's unit after a space ("−12.4 ps", "1.52 %").
 */
export function chartValueSaid(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const magnitude = Math.round(Math.abs(value) * 100) / 100;
  const [whole, fraction] = magnitude.toFixed(2).replace(/\.?0+$/, '').split('.') as [string, string | undefined];
  const grouped = whole.length > 4 ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : whole;
  const sign = value < 0 && magnitude > 0 ? '\u2212' : '';
  return `${sign}${grouped}${fraction === undefined ? '' : `.${fraction}`}${unit === '' ? '' : ` ${unit}`}`;
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

/** The tool's answer, read from the call's text, when it is one; anything else is not drawn. */
export function readChartAnswer(text: string): HimaChartAnswer | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (typeof value !== 'object' || value === null) return undefined;
  const chart = (value as { chart?: unknown }).chart as Partial<HimaChart> | undefined;
  if (chart === undefined || chart === null || chart.schema !== 'hima-chart/1' || !Array.isArray(chart.categories) || !Array.isArray(chart.series)) return undefined;
  if (chart.series.length === 0 || chart.series.some((series) => !Array.isArray(series?.values) || series.values.length !== chart.categories!.length)) return undefined;
  const full: HimaChart = {
    ...chart, schema: 'hima-chart/1', kind: 'bar', title: String(chart.title ?? ''), unit: chart.unit ?? '', highlight: chart.highlight ?? [],
    source: String(chart.source ?? ''), categories: chart.categories, series: chart.series.map((series) => ({ ...series, role: series.role ?? 'neutral' })),
  } as HimaChart;
  const answer = value as { source?: HimaChartAnswer['source']; note?: unknown };
  return { chart: full, ...(answer.source === undefined ? {} : { source: answer.source }), ...(typeof answer.note === 'string' && answer.note !== '' ? { note: answer.note } : {}) } as HimaChartAnswer;
}
