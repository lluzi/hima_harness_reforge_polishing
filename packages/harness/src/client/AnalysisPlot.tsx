// One plot of an admitted Resident analysis, drawn as inline SVG from `analysis-plot.ts`'s geometry.
// The viewBox follows the plot's measured width, so text stays at the sheet's own sizes at any width;
// colours are `--hima-plot-*` classes from `workbench-style.ts`, stepped separately for light and dark.
// Every mark carries a <title> tooltip, two or more series carry a legend, and the dataset is always
// one click away as a table, so no value depends on colour or on hovering.
import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from 'react';
import type { LibInsightAnalysisResult } from '../libinsight-analyses.js';
import { formatTick, formatValue, plotLimits, projectPlot, projectTable, scaleLinear, type AnalysisPlotSpec, type BandAxis, type LinearAxis, type PlotGeometry, type SeriesKey, type TableProjection } from './analysis-plot.js';

const CHAR = 7; // the eyebrow step's average glyph width, for label room
const HEIGHT = 300;
const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;

function useWidth(): [RefObject<HTMLElement>, number] {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observe = new ResizeObserver(entries => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(Math.max(280, next));
    });
    observe.observe(element);
    return () => observe.disconnect();
  }, []);
  return [ref, width];
}

export function AnalysisPlot({ result, plot }: { readonly result: Pick<LibInsightAnalysisResult, 'datasets'>; readonly plot: AnalysisPlotSpec }): ReactElement {
  const geometry = useMemo(() => projectPlot(result, plot), [result, plot]);
  const dataset = result.datasets?.[plot.dataset];
  const [ref, width] = useWidth();
  return <figure className='hima-plot' data-hima-region='resident-plot' data-hima-state-plot={geometry.kind} ref={ref}>
    <figcaption className='hima-plot-title'>{geometry.title}</figcaption>
    {geometry.kind === 'cannot-draw' ? <p className='hima-plot-cannot' role='status'>Cannot draw this plot: {geometry.reason}.</p>
      : geometry.kind === 'table' ? <DataTable table={geometry.table} />
      : <>
          {geometry.kind === 'heatmap' ? null : <Legend series={geometry.series} kind={geometry.kind} />}
          {geometry.kind === 'bar' ? <BarChart g={geometry} width={width} />
            : geometry.kind === 'heatmap' ? <HeatmapChart g={geometry} width={width} />
            : <XYChart g={geometry} width={width} />}
          {geometry.notes.length === 0 ? null : <ul className='hima-plot-notes'>{geometry.notes.map(note => <li key={note}>{note}</li>)}</ul>}
        </>}
    {geometry.kind === 'table' || dataset === undefined || !Array.isArray(dataset.rows) ? null
      : <details className='hima-plot-data'><summary>Data table · {plot.dataset}</summary><DataTable table={projectTable(dataset)} /></details>}
  </figure>;
}

function Legend({ series, kind }: { readonly series: readonly SeriesKey[]; readonly kind: 'bar' | 'line' | 'scatter' }): ReactElement | null {
  if (series.length < 2) return null;
  return <ul className='hima-plot-legend' aria-label='Series'>
    {series.map(key => <li key={key.name}>
      <svg width='16' height='10' aria-hidden='true' className={`hima-plot-c${String(key.slot)}`}>
        {kind === 'line' ? <line x1='1' y1='5' x2='15' y2='5' className='hima-plot-line' /> : kind === 'scatter' ? <circle cx='8' cy='5' r='4' className='hima-plot-dot' /> : <rect x='3' y='0' width='10' height='10' rx='2' className='hima-plot-bar' />}
      </svg>{key.name}</li>)}
  </ul>;
}

function DataTable({ table }: { readonly table: TableProjection }): ReactElement {
  return <div className='hima-plot-table-wrap'>
    <table className='hima-plot-table'>
      <thead><tr>{table.columns.map(column => <th key={column.name} scope='col' data-type={column.type}>{column.header}</th>)}</tr></thead>
      <tbody>{table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j} data-type={table.columns[j]?.type}>{cell}</td>)}</tr>)}</tbody>
    </table>
    {table.shownRows < table.totalRows ? <p className='hima-plot-notes'>Showing the first {table.shownRows} of {table.totalRows.toLocaleString('en-US')} rows.</p> : null}
  </div>;
}

/** Room for the longest y tick label and the rotated axis title. */
const leftFor = (axis: LinearAxis) => Math.min(120, Math.max(...axis.ticks.map(t => formatTick(t, axis.step).length)) * CHAR + 30);

function YAxis({ axis, x0, x1, y }: { readonly axis: LinearAxis; readonly x0: number; readonly x1: number; readonly y: (v: number) => number }): ReactElement {
  const middle = (y(axis.domain[0]) + y(axis.domain[1])) / 2;
  return <g>
    {axis.ticks.map(t => <g key={t}>
      <line className={t === 0 ? 'hima-plot-axis' : 'hima-plot-grid'} x1={x0} x2={x1} y1={y(t)} y2={y(t)} />
      <text className='hima-plot-tick' x={x0 - 6} y={y(t)} textAnchor='end' dominantBaseline='middle'>{formatTick(t, axis.step)}</text>
    </g>)}
    <text className='hima-plot-axis-title' transform={`translate(12 ${String(middle)}) rotate(-90)`} textAnchor='middle' dominantBaseline='middle'>{axis.title}</text>
  </g>;
}

function XTitle({ title, x, y }: { readonly title: string; readonly x: number; readonly y: number }): ReactElement {
  return <text className='hima-plot-axis-title' x={x} y={y} textAnchor='middle'>{title}</text>;
}

/** Which band labels to print, and whether they must lean to fit. */
function bandLabels(axis: BandAxis, band: number): { every: number; lean: boolean; max: number } {
  const n = axis.categories.length, max = 16;
  const longest = Math.min(max, Math.max(1, ...axis.categories.map(c => c.length))) * CHAR;
  const lean = longest > band - 4;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(n * band / (lean ? 18 : longest + 8)))));
  return { every, lean, max };
}

function BandTicks({ axis, at, band, y }: { readonly axis: BandAxis; readonly at: (i: number) => number; readonly band: number; readonly y: number }): ReactElement {
  const { every, lean, max } = bandLabels(axis, band);
  return <g>{axis.categories.map((name, i) => i % every !== 0 ? null
    : <text key={i} className='hima-plot-tick' x={at(i)} y={y + 14} textAnchor={lean ? 'end' : 'middle'} transform={lean ? `rotate(-40 ${String(at(i))} ${String(y + 14)})` : undefined}><title>{name}</title>{clip(name, max)}</text>)}</g>;
}

const bandBottom = (axis: BandAxis, band: number) => bandLabels(axis, band).lean ? 22 + Math.min(16, Math.max(...axis.categories.map(c => c.length))) * CHAR * 0.64 + 20 : 44;

/** A column with a 4 px rounded data end and a square foot on the baseline. */
function columnPath(x: number, w: number, base: number, end: number): string {
  const r = Math.min(4, w / 2, Math.abs(base - end));
  if (end <= base) return `M${x},${base}V${end + r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end + r}V${base}Z`;
  return `M${x},${base}V${end - r}Q${x},${end} ${x + r},${end}H${x + w - r}Q${x + w},${end} ${x + w},${end - r}V${base}Z`;
}

function BarChart({ g, width }: { readonly g: Extract<PlotGeometry, { kind: 'bar' }>; readonly width: number }): ReactElement {
  const left = leftFor(g.y), right = 16, top = 12;
  const innerW = width - left - right, n = g.x.categories.length, band = innerW / n;
  const bottom = bandBottom(g.x, band), plotBottom = HEIGHT - bottom;
  const y = scaleLinear(g.y.domain, [plotBottom, top]);
  const k = Math.max(1, g.series.length), gap = 2;
  const barW = Math.max(1, Math.min(24, (band * 0.8 - (k - 1) * gap) / k)), groupW = k * barW + (k - 1) * gap;
  const at = (i: number) => left + i * band + band / 2;
  const base = y(0);
  return <svg className='hima-plot-svg' viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`} role='img' aria-label={`${g.title}: ${g.y.title} by ${g.x.title}`}>
    <YAxis axis={g.y} x0={left} x1={width - right} y={y} />
    {g.bars.map((bar, i) => {
      const x = at(bar.category) - groupW / 2 + bar.series * (barW + gap);
      return <path key={i} className={`hima-plot-bar hima-plot-c${String(g.series.length === 0 ? 1 : (g.series[bar.series]?.slot ?? 1))}`} d={columnPath(x, barW, base, y(bar.value))}><title>{bar.tip}</title></path>;
    })}
    <line className='hima-plot-axis' x1={left} x2={width - right} y1={base} y2={base} />
    <BandTicks axis={g.x} at={at} band={band} y={plotBottom} />
    <XTitle title={g.x.title} x={left + innerW / 2} y={HEIGHT - 6} />
  </svg>;
}

function XYChart({ g, width }: { readonly g: Extract<PlotGeometry, { kind: 'line' | 'scatter' }>; readonly width: number }): ReactElement {
  const left = leftFor(g.y), top = 12, bottom = 44, plotBottom = HEIGHT - bottom;
  // Up to four lines are labelled at their right end as well, unless their ends crowd together.
  const ys0 = scaleLinear(g.y.domain, [plotBottom, top]);
  const ends = g.kind === 'line' && g.series.length >= 2 && g.series.length <= 4 ? g.lines.map(line => ({ series: line.series, y: ys0(line.points.at(-1)!.y) })) : [];
  const sorted = [...ends].sort((a, b) => a.y - b.y);
  const labelled = ends.length > 0 && sorted.every((end, i) => i === 0 || end.y - sorted[i - 1]!.y >= 14);
  const right = labelled ? 16 + Math.min(12, Math.max(...g.series.map(s => s.name.length))) * CHAR : 16;
  const x = scaleLinear(g.x.domain, [left, width - right]), y = ys0;
  const total = g.lines.reduce((sum, line) => sum + line.points.length, 0);
  const markers = g.kind === 'scatter' || total <= 60 * Math.max(1, g.lines.length);
  const hits = total <= 1500;
  const slotOf = (series: number) => g.series.length === 0 ? 1 : (g.series[series]?.slot ?? 1);
  return <svg className='hima-plot-svg' viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`} role='img' aria-label={`${g.title}: ${g.y.title} against ${g.x.title}`}>
    <YAxis axis={g.y} x0={left} x1={width - right} y={y} />
    <line className='hima-plot-axis' x1={left} x2={width - right} y1={plotBottom} y2={plotBottom} />
    {g.x.ticks.map(t => <text key={t} className='hima-plot-tick' x={x(t)} y={plotBottom + 14} textAnchor='middle'>{formatTick(t, g.x.step)}</text>)}
    {g.lines.map(line => <g key={line.series} className={`hima-plot-c${String(slotOf(line.series))}`}>
      {g.kind === 'line' ? <path className='hima-plot-line' d={line.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${String(x(p.x))},${String(y(p.y))}`).join('')}><title>{g.series[line.series]?.name ?? g.title}</title></path> : null}
      {markers ? line.points.map((p, i) => <circle key={i} className='hima-plot-dot' cx={x(p.x)} cy={y(p.y)} r={4}>{hits ? null : <title>{p.tip}</title>}</circle>) : null}
      {hits ? line.points.map((p, i) => <circle key={`h${String(i)}`} className='hima-plot-hit' cx={x(p.x)} cy={y(p.y)} r={10}><title>{p.tip}</title></circle>) : null}
    </g>)}
    {labelled ? ends.map(end => <text key={end.series} className='hima-plot-direct' x={width - right + 6} y={end.y} dominantBaseline='middle'>{clip(g.series[end.series]?.name ?? '', 12)}</text>) : null}
    <XTitle title={g.x.title} x={(left + width - right) / 2} y={HEIGHT - 6} />
  </svg>;
}

function HeatmapChart({ g, width }: { readonly g: Extract<PlotGeometry, { kind: 'heatmap' }>; readonly width: number }): ReactElement {
  const longestY = Math.min(16, Math.max(1, ...g.y.categories.map(c => c.length)));
  const left = longestY * CHAR + 34, right = 16, top = 8;
  const innerW = width - left - right, nx = g.x.categories.length, ny = g.y.categories.length;
  const cellW = innerW / nx, cellH = Math.max(14, Math.min(32, 360 / ny));
  const plotBottom = top + ny * cellH, bottom = bandBottom(g.x, cellW);
  const legendTop = plotBottom + bottom + 8, height = legendTop + 44;
  const inset = cellW > 6 && cellH > 6 ? 1 : 0;
  const swatch = Math.min(28, (innerW - 8 * 2) / plotLimits.sequentialSteps);
  return <svg className='hima-plot-svg' viewBox={`0 0 ${String(width)} ${String(height)}`} role='img' aria-label={`${g.title}: ${g.value.title} by ${g.x.title} and ${g.y.title}`}>
    <defs><pattern id='hima-plot-hatch' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='6' height='6' className='hima-plot-missing' /><line x1='0' y1='0' x2='0' y2='6' className='hima-plot-hatch-line' /></pattern></defs>
    {g.y.categories.map((name, i) => <text key={i} className='hima-plot-tick' x={left - 6} y={top + i * cellH + cellH / 2} textAnchor='end' dominantBaseline='middle'><title>{name}</title>{clip(name, 16)}</text>)}
    <text className='hima-plot-axis-title' transform={`translate(12 ${String(top + ny * cellH / 2)}) rotate(-90)`} textAnchor='middle' dominantBaseline='middle'>{g.y.title}</text>
    {g.cells.map((cell, i) => <rect key={i} className={cell.step === undefined ? 'hima-plot-cell-missing' : `hima-plot-cell hima-plot-q${String(cell.step)}`} fill={cell.step === undefined ? 'url(#hima-plot-hatch)' : undefined}
      x={left + cell.x * cellW + inset} y={top + cell.y * cellH + inset} width={Math.max(1, cellW - 2 * inset)} height={Math.max(1, cellH - 2 * inset)} rx={inset ? 2 : 0}><title>{cell.tip}</title></rect>)}
    <BandTicks axis={g.x} at={i => left + i * cellW + cellW / 2} band={cellW} y={plotBottom} />
    <XTitle title={g.x.title} x={left + innerW / 2} y={plotBottom + bottom - 4} />
    <g aria-label={`Colour scale for ${g.value.title}`}>
      {g.value.steps.map((step, i) => <rect key={i} className={`hima-plot-cell hima-plot-q${String(i)}`} x={left + i * (swatch + 2)} y={legendTop} width={swatch} height={10} rx={2}><title>{`${formatValue(step.from)} to ${formatValue(step.to)}${g.value.unit ? ` ${g.value.unit}` : ''}`}</title></rect>)}
      <text className='hima-plot-tick' x={left} y={legendTop + 24} textAnchor='start'>{formatValue(g.value.domain[0])}</text>
      <text className='hima-plot-tick' x={left + plotLimits.sequentialSteps * (swatch + 2) - 2} y={legendTop + 24} textAnchor='end'>{formatValue(g.value.domain[1])}</text>
      <text className='hima-plot-axis-title' x={left + plotLimits.sequentialSteps * (swatch + 2) + 8} y={legendTop + 9}>{g.value.title}</text>
    </g>
  </svg>;
}
