// The chat's chart card (`hima_chart`): a plain horizontal bar chart whose numbers come from a file a
// tool or a Pack wrote, never from the model. The agent's one-line reading stands above it, the title,
// the legend and one row per category in the middle, and the source in small muted type below. The
// geometry and the value words are `chart-geometry.ts`; this only draws them, in HTML, so the card
// follows the chat column from 320 to 760 px without measuring it.
import type { ReactElement } from 'react';
import type { HimaChartSource } from '../charts.js';
import { chartGeometry, readChartAnswer, type ChartBar } from './chart-geometry.js';
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
  const geometry = chartGeometry(chart);
  const room = `${geometry.hasNegative ? ' hima-chart-room-left' : ''}${geometry.hasPositive ? ' hima-chart-room-right' : ''}`;
  const zero = geometry.shared && geometry.hasNegative && geometry.hasPositive ? geometry.zero : undefined;
  const single = chart.series.length === 1;
  return (
    <div className="hima-chart-card hima-root" data-hima-region="chart-card" data-hima-state-state="ok" data-hima-state-title={chart.title}>
      <style>{HIMA_STYLE}</style>
      {note === undefined ? null : <p className="hima-chart-note">{note}</p>}
      <figure className="hima-chart">
        <figcaption>
          <strong className="hima-chart-title">{chart.title}</strong>
          {chart.subtitle === undefined ? null : <span className="hima-chart-subtitle">{chart.subtitle}</span>}
        </figcaption>
        {geometry.legend.length === 0 && chart.better === undefined ? null : (
          <div className="hima-chart-legend">
            {geometry.legend.map((item) => (
              <span key={item.name} className="hima-chart-legend-item"><span className={`hima-chart-swatch hima-chart-role-${item.role}`} />{item.name}</span>
            ))}
            {chart.better === undefined ? null : <span className="hima-chart-better">{t(chart.better === 'lower' ? 'chart.lowerBetter' : 'chart.higherBetter')}</span>}
          </div>
        )}
        <div className="hima-chart-rows" role="table" aria-label={chart.title}>
          {geometry.rows.map((row) => (
            <div key={row.category} className={`hima-chart-row${row.highlight ? ' hima-chart-row-highlight' : ''}`} role="row">
              <span className="hima-chart-category" role="rowheader">{row.category}</span>
              <div className={`hima-chart-bars${room}`} role="cell">
                {row.bars.map((bar) => <Bar key={bar.series} bar={bar} {...(zero === undefined ? {} : { zero })} single={single} />)}
              </div>
            </div>
          ))}
        </div>
        {chart.caption === undefined ? null : <p className="hima-chart-caption">{chart.caption}</p>}
      </figure>
      <p className="hima-chart-source" title={sourceTitle(answer.source)}>{t('chart.source', { source: chart.source })}</p>
    </div>
  );
}
