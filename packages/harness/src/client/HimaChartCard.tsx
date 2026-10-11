// The chat's chart card (`hima_chart`): a plain horizontal bar chart whose numbers come from a file a
// tool or a Pack wrote, never from the model. The agent's one-line reading stands above it, the title,
// the legend and one row per category in the middle, and the source in small muted type below. The
// geometry and the value words are `chart-geometry.ts`; this only draws them, in HTML, so the card
// follows the chat column from 320 to 760 px without measuring it.
import type { ReactElement } from 'react';
import type { HimaChartSource } from '../charts.js';
import { chartGeometry, metricsTable, readChartAnswer, type ChartBar, type MetricsTable } from './chart-geometry.js';
import type { ToolBlock } from './HimaRunCard.js';
import { useHimaT } from './locale/index.js';
import { HIMA_STYLE } from './workbench-style.js';

/** Every text the tool block carries, as one string. */
const textOf = (block: ToolBlock) => (block.content ?? []).filter((item) => item.type === 'text' && typeof item.text === 'string').map((item) => item.text!).join('\n').trim();

/** Where the file came from, for the source line's hover. */
function sourceTitle(source: HimaChartSource | undefined): string | undefined {
  if (source === undefined) return undefined;
  const where = source.kind === 'run' ? `${source.runId} · ${source.path}` : `${source.pack} · knowledge/${source.file}`;
  return `${where} · sha256 ${source.sha256.slice(0, 12)}`;
}

const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

/** One bar on the plot (the track less the label room at its ends, kept by the track's own padding):
 *  an SVG whose x runs in percent of the plot, its value printed past the bar's outer end. */
function Bar({ bar, zero, single }: { bar: ChartBar; zero?: number; single: boolean }): ReactElement {
  const height = single ? 16 : 12;
  return (
    <svg className="hima-chart-bar-track" width="100%" height={height} overflow="visible" aria-label={`${bar.series}: ${bar.display}`}>
      <title>{`${bar.series}: ${bar.display}`}</title>
      {zero === undefined ? null : <line className="hima-chart-zero" x1={pct(zero)} x2={pct(zero)} y1={-2} y2={height + 2} />}
      {bar.value === null ? null : <rect className={`hima-chart-bar hima-chart-role-${bar.role}`} x={pct(bar.start)} width={pct(Math.max(bar.end - bar.start, 0.002))} y={0} height={height} rx={2} />}
      <text className="hima-chart-value" x={pct(bar.negative ? bar.start : bar.end)} dx={bar.negative ? -4 : 4} y={height / 2} dominantBaseline="central" textAnchor={bar.negative ? 'end' : 'start'}>{bar.display}</text>
    </svg>
  );
}

/** The metrics table: measure | value (unit) with one series; measure | each series | change with two
 *  or more. Numbers right-aligned and tabular; the measure wraps, the numbers never do. In a narrow
 *  column a table of two or more series names each unit once, beside its measure, and puts the
 *  relative change under the absolute one. */
function Metrics({ table, title }: { table: MetricsTable; title: string }): ReactElement {
  const t = useHimaT();
  const header = table.columns.length >= 2;
  return (
    <table className={`hima-chart-metrics${header ? '' : ' hima-chart-metrics-single'}`} aria-label={title}>
      {!header ? null : (
        <thead>
          <tr>
            <th scope="col">{t('chart.measure')}</th>
            {table.columns.map((column) => <th key={column.name} scope="col">{column.name}</th>)}
            {table.change ? <th scope="col">{t('chart.change')}</th> : null}
          </tr>
        </thead>
      )}
      <tbody>
        {table.rows.map((row) => (
          <tr key={row.category} className={row.highlight ? 'hima-chart-row-highlight' : undefined}>
            <th scope="row">{row.category}{row.unit === '' ? null : <span className="hima-chart-measure-unit"> ({row.unit})</span>}</th>
            {row.values.map((value) => (
              <td key={value.series}>
                <span className="hima-chart-number">{value.display}</span>
                {row.unit === '' || value.value === null ? null : <span className="hima-chart-unit">{row.unit}</span>}
              </td>
            ))}
            {!table.change ? null : row.delta === undefined ? <td className="hima-chart-delta hima-chart-delta-same">—</td> : (
              <td className={`hima-chart-delta hima-chart-delta-${row.delta.tone}`} data-hima-state-tone={row.delta.tone}>
                <span className="hima-chart-number">{row.delta.display}</span>
                {row.unit === '' || row.delta.tone === 'same' ? null : <span className="hima-chart-unit">{row.unit}</span>}
                {row.delta.percent === undefined ? null : <span className="hima-chart-delta-pct">{row.delta.percent}</span>}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HimaChartCard({ block }: { block: ToolBlock }): ReactElement {
  const t = useHimaT();
  if (block.kind === undefined) {
    return <div className="hima-chart-card hima-root hima-muted"><style>{HIMA_STYLE}</style>{t('chart.reading')}</div>;
  }
  const text = textOf(block);
  const answer = block.isError === true ? undefined : readChartAnswer(text);
  if (answer === undefined) {
    return (
      <div className="hima-chart-card hima-root" data-hima-region="chart-card" data-hima-state-state="error">
        <style>{HIMA_STYLE}</style>
        <p className="hima-chart-error">{block.isError === true && text !== '' ? text : t('chart.failed')}</p>
      </div>
    );
  }
  const { chart, note } = answer;
  const metrics = chart.kind === 'metrics' ? metricsTable(chart) : undefined;
  const geometry = chartGeometry(chart);
  const legend = metrics?.legend ?? geometry.legend;
  const room = `${geometry.hasNegative ? ' hima-chart-room-left' : ''}${geometry.hasPositive ? ' hima-chart-room-right' : ''}`;
  // A zero line wherever a value is negative: inside the plot for mixed signs, at its right edge when
  // every value is below zero (worst slack through the flow), so the bars read as distances from it.
  const zero = geometry.shared && geometry.hasNegative ? geometry.zero : undefined;
  const single = chart.series.length === 1;
  return (
    <div className="hima-chart-card hima-root" data-hima-region="chart-card" data-hima-state-state="ok" data-hima-state-kind={chart.kind} data-hima-state-title={chart.title}>
      <style>{HIMA_STYLE}</style>
      {note === undefined ? null : <p className="hima-chart-note">{note}</p>}
      <figure className="hima-chart">
        <figcaption>
          <strong className="hima-chart-title">{chart.title}</strong>
          {chart.subtitle === undefined ? null : <span className="hima-chart-subtitle">{chart.subtitle}</span>}
        </figcaption>
        {legend.length === 0 && chart.better === undefined ? null : (
          <div className="hima-chart-legend">
            {legend.map((item) => (
              <span key={item.name} className="hima-chart-legend-item"><span className={`hima-chart-swatch hima-chart-role-${item.role}`} />{item.name}</span>
            ))}
            {chart.better === undefined ? null : <span className="hima-chart-better">{t(chart.better === 'lower' ? 'chart.lowerBetter' : 'chart.higherBetter')}</span>}
          </div>
        )}
        {metrics !== undefined ? <Metrics table={metrics} title={chart.title} /> : <div className="hima-chart-rows" role="table" aria-label={chart.title}>
          {geometry.rows.map((row) => (
            <div key={row.category} className={`hima-chart-row${row.highlight ? ' hima-chart-row-highlight' : ''}`} role="row">
              <span className="hima-chart-category" role="rowheader">{row.category}</span>
              <div className={`hima-chart-bars${room}`} role="cell">
                {row.bars.map((bar) => <Bar key={bar.series} bar={bar} {...(zero === undefined ? {} : { zero })} single={single} />)}
              </div>
            </div>
          ))}
        </div>}
        {chart.caption === undefined ? null : <p className="hima-chart-caption">{chart.caption}</p>}
      </figure>
      <p className="hima-chart-source" title={sourceTitle(answer.source)}>{t('chart.source', { source: chart.source })}</p>
    </div>
  );
}
