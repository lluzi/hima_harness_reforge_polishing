// A chart a person reads in the chat (`hima_chart`): a small, plain bar chart whose every number
// comes from a file a tool or a Pack wrote — a Run report (`<reports dir>/<node>/r<k>/*.chart.json`)
// or a Pack's own knowledge (`knowledge/charts/*.chart.json`). The model names the file; it never
// types the numbers. Shared by the Host (reads and validates) and the client (draws).
import { z } from 'zod';

export const HIMA_CHART_SCHEMA = 'hima-chart/1';

export const himaChartSeries = z.strictObject({
  name: z.string().min(1).max(32),
  /** One value per category, in category order; null where the series has no value. */
  values: z.array(z.number().finite().nullable()).min(1).max(16),
  /** How the series reads: the stock/reference value, the proposed/target value, a measured result, or plain. */
  role: z.enum(['baseline', 'proposed', 'measured', 'neutral']).default('neutral'),
});

export const himaChart = z.strictObject({
  schema: z.literal(HIMA_CHART_SCHEMA),
  title: z.string().min(1).max(80),
  subtitle: z.string().min(1).max(120).optional(),
  /**
   * `bar`: horizontal bars, one row per category. `metrics`: a metric table, one row per category
   * (a measure such as Fmax or cell area) and one value column per series, with the change from the
   * first series to the last when there are two or more; each row carries its own unit and digits.
   */
  kind: z.enum(['bar', 'metrics']).default('bar'),
  unit: z.string().max(16).default(''),
  categories: z.array(z.string().min(1).max(24)).min(1).max(16),
  series: z.array(himaChartSeries).min(1).max(3),
  /** `metrics` only: one unit per category ('' for a count), in category order. */
  units: z.array(z.string().max(16)).max(16).optional(),
  /** `metrics` only: decimal places per category, in category order. */
  digits: z.array(z.number().int().min(0).max(4)).max(16).optional(),
  /** `metrics` only: which way is better per category, so the change can be coloured; 'none' for neither. */
  betterEach: z.array(z.enum(['higher', 'lower', 'none'])).max(16).optional(),
  /** Categories drawn emphasised (e.g. the proposed cell families). */
  highlight: z.array(z.string().min(1).max(24)).max(16).default([]),
  better: z.enum(['higher', 'lower']).optional(),
  /** Which tool and report produced the numbers, in plain words. */
  source: z.string().min(1).max(160),
  caption: z.string().min(1).max(200).optional(),
}).superRefine((chart, ctx) => {
  for (const [index, series] of chart.series.entries()) {
    if (series.values.length !== chart.categories.length) {
      ctx.addIssue({ code: 'custom', path: ['series', index, 'values'], message: `has ${String(series.values.length)} values for ${String(chart.categories.length)} categories` });
    }
  }
  for (const key of ['units', 'digits', 'betterEach'] as const) {
    const list = chart[key];
    if (list === undefined) continue;
    if (chart.kind !== 'metrics') ctx.addIssue({ code: 'custom', path: [key], message: 'is for a metrics chart only' });
    else if (list.length !== chart.categories.length) {
      ctx.addIssue({ code: 'custom', path: [key], message: `has ${String(list.length)} entries for ${String(chart.categories.length)} categories` });
    }
  }
  for (const name of chart.highlight) {
    if (!chart.categories.includes(name)) ctx.addIssue({ code: 'custom', path: ['highlight'], message: `names "${name}", which is not a category` });
  }
});
export type HimaChart = z.infer<typeof himaChart>;

/** Where a chart shown in the chat came from, as the `hima_chart` tool reports it. */
export type HimaChartSource =
  | { readonly kind: 'run'; readonly runId: string; readonly path: string; readonly sha256: string }
  | { readonly kind: 'pack'; readonly pack: string; readonly file: string; readonly sha256: string };

/** The `hima_chart` tool's answer: the validated chart, where it came from, and the agent's one-line note. */
export interface HimaChartAnswer {
  readonly chart: HimaChart;
  readonly source: HimaChartSource;
  readonly note?: string;
}
