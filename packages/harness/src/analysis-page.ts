// The standalone page of one Resident analysis (ADR-0020, 2026-10-05 revision): the Host serves it as
// server-rendered HTML in its own window. A pure function of the Run's summary and its detail: the
// Reader-accepted result drawn as inline SVG from `analysis-plot.ts`'s geometry, its assumptions,
// limits and provenance. No script, no external asset; every model-authored string is escaped. Every
// mark carries a <title> tooltip, two or more series carry a legend, and every chart has its data one
// click away, so no value depends on colour or on hovering.
import type { LibInsightAnalysisDetail, LibInsightAnalysisEntry, LibInsightAnalysisResult } from './libinsight-analyses.js';
import { formatTick, formatValue, plotLimits, projectPlot, projectTable, scaleLinear, type AnalysisPlotSpec, type BandAxis, type LinearAxis, type PlotGeometry, type SeriesKey, type TableProjection } from './analysis-plot.js';

export interface AnalysisPageInput {
  readonly runId: string;
  /** The list summary of this Run (status, task state, admission), when known. */
  readonly entry?: LibInsightAnalysisEntry;
  readonly detail: LibInsightAnalysisDetail;
  /** Seconds between automatic reloads while the analysis is unfinished; omitted once settled. */
  readonly refreshSeconds?: number;
}

const W = 760, HEIGHT = 340, CHAR = 8; // viewBox width, chart height, average tick glyph width
const FINAL_TASK = new Set(['succeeded', 'failed', 'cancelled']);

const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (value: number): string => String(Math.round(value * 10) / 10);
const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
const short = (sha: string) => sha.slice(0, 12);
const sha = (value: string) => `<code class="sha" title="${esc(value)}">${esc(short(value))}</code>`;
const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;
const when = (at: string) => { const date = new Date(at); return Number.isNaN(date.getTime()) ? at : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`; };
const words = (status: string) => status.replace(/^ended-/, 'ended · ').replaceAll('-', ' ');

// ---------------------------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------------------------

const STYLE = `
:root{color-scheme:light dark;--paper:#fbfaf7;--card:#ffffff;--soft:#f3f1ec;--line:#e3dfd6;--line-strong:#00000029;--ink:#232120;--ink-2:#615c55;--ink-3:#8a847b;--good:#2f7a45;--good-soft:#e5f2e8;--warn:#8e620d;--warn-soft:#f8efd9;--bad:#ad3f36;--bad-soft:#f8e4e1;--accent:#4f5fd8;--accent-soft:#e8eafb;
--p1:#2a78d6;--p2:#eb6834;--p3:#1baf7a;--p4:#eda100;--p5:#e87ba4;--p6:#008300;--p7:#4a3aa7;--p8:#e34948;--q0:#cde2fb;--q1:#b7d3f6;--q2:#86b6ef;--q3:#6da7ec;--q4:#3987e5;--q5:#2a78d6;--q6:#1c5cab;--q7:#184f95;--q8:#0d366b;--axis:#c3c2b7}
@media (prefers-color-scheme:dark){:root{--paper:#1c1b1c;--card:#232223;--soft:#2a2927;--line:#3a3733;--line-strong:#ffffff29;--ink:#ece8e0;--ink-2:#b5afa4;--ink-3:#8f8a80;--good:#8fcb9c;--good-soft:#1f3326;--warn:#dcb45f;--warn-soft:#3a2f17;--bad:#e38f87;--bad-soft:#3d2321;--accent:#a3abff;--accent-soft:#272a4a;
--p1:#3987e5;--p2:#d95926;--p3:#199e70;--p4:#c98500;--p5:#d55181;--p6:#008300;--p7:#9085e9;--p8:#e66767;--q0:#0d366b;--q1:#184f95;--q2:#1c5cab;--q3:#2a78d6;--q4:#3987e5;--q5:#5598e7;--q6:#86b6ef;--q7:#9ec5f4;--q8:#cde2fb;--axis:#4a4844}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;overflow-x:hidden}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em}
.page{max-width:1440px;margin:0 auto;padding:28px 16px 56px}
@media (min-width:720px){.page{padding:44px 40px 72px}}
.top{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:28px}
.mark{font-size:19px;letter-spacing:-.01em}.mark b{font-weight:700}.mark span{font-weight:300}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
h1{font-size:clamp(26px,3.2vw,40px);line-height:1.18;letter-spacing:-.02em;font-weight:650;margin:0 0 18px;max-width:30em;overflow-wrap:anywhere}
h2{font-size:13px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin:0 0 14px}
h3{font-size:17px;font-weight:620;margin:0;letter-spacing:-.005em;overflow-wrap:anywhere}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;font-size:14px;color:var(--ink-2)}
.meta code{color:var(--ink-3)}
.pill{display:inline-flex;align-items:center;gap:8px;padding:5px 12px 5px 10px;border-radius:999px;font-weight:600;font-size:14px;background:var(--soft);color:var(--ink-2)}
.pill::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.pill[data-tone=good]{background:var(--good-soft);color:var(--good)}.pill[data-tone=warn]{background:var(--warn-soft);color:var(--warn)}
.pill[data-tone=bad]{background:var(--bad-soft);color:var(--bad)}.pill[data-tone=run]{background:var(--accent-soft);color:var(--accent)}
.reason{margin:10px 0 0;font-size:14px;color:var(--ink-2);max-width:60em}
.lead{font-size:clamp(17px,1.5vw,20px);line-height:1.6;max-width:46em;margin:32px 0 0;overflow-wrap:anywhere}
section{margin-top:44px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;min-width:0}
@media (max-width:540px){.card{padding:16px}}
.progress{margin-top:28px;display:flex;gap:16px;align-items:flex-start;border-color:var(--accent-soft);background:linear-gradient(var(--accent-soft),var(--card) 140%)}
.progress p{margin:0;color:var(--ink-2);max-width:60em}.progress strong{color:var(--ink)}
.spin{flex:none;width:18px;height:18px;margin-top:3px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);animation:spin 1.2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.alert{margin-top:28px;border-color:var(--bad);background:var(--bad-soft);color:var(--bad);font-weight:500}
.plots{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
@media (min-width:1200px){.plots{grid-template-columns:repeat(2,minmax(0,1fr))}.plots .wide{grid-column:1/-1}}
figure{margin:0;display:flex;flex-direction:column;gap:14px}
.chart svg{display:block;width:100%;height:auto;max-height:620px}
.tick{font-size:13.5px;fill:var(--ink-3)}.axis-title,.direct{font-size:14px;fill:var(--ink-2)}
.grid{stroke:var(--line);stroke-width:1;shape-rendering:crispEdges}.axis{stroke:var(--axis);stroke-width:1;shape-rendering:crispEdges}
.c1{--c:var(--p1)}.c2{--c:var(--p2)}.c3{--c:var(--p3)}.c4{--c:var(--p4)}.c5{--c:var(--p5)}.c6{--c:var(--p6)}.c7{--c:var(--p7)}.c8{--c:var(--p8)}
.q0{fill:var(--q0)}.q1{fill:var(--q1)}.q2{fill:var(--q2)}.q3{fill:var(--q3)}.q4{fill:var(--q4)}.q5{fill:var(--q5)}.q6{fill:var(--q6)}.q7{fill:var(--q7)}.q8{fill:var(--q8)}
.bar{fill:var(--c)}.bar:hover{opacity:.8}
.line{fill:none;stroke:var(--c);stroke-width:2.25;stroke-linejoin:round;stroke-linecap:round}
.dot{fill:var(--c);stroke:var(--card);stroke-width:2}
.hit{fill:transparent}.hit:hover{fill:var(--c);fill-opacity:.18}
.cell:hover{stroke:var(--ink);stroke-width:1}.missing{fill:var(--soft)}.hatch{stroke:var(--line-strong);stroke-width:1.5}
.legend{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;color:var(--ink-2)}
.legend li{display:inline-flex;align-items:center;gap:7px}
.notes{margin:0;padding-left:20px;font-size:13.5px;color:var(--ink-2)}p.notes{padding-left:0;margin-top:8px}
.cannot{margin:0;padding:12px 14px;background:var(--warn-soft);color:var(--warn);font-size:14px;border-radius:10px}
details>summary{cursor:pointer;font-size:14px;color:var(--ink-2);user-select:none}details>summary:hover{color:var(--ink)}
.table-wrap{max-height:420px;overflow:auto;margin-top:10px;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;font-size:13.5px;width:100%}
th,td{padding:7px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;white-space:nowrap}
th{position:sticky;top:0;background:var(--soft);font-weight:600;color:var(--ink-2)}
tbody tr:last-child td{border-bottom:0}
[data-type=number]{text-align:right;font-variant-numeric:tabular-nums}
.pair{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}@media (min-width:900px){.pair{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pair ul{margin:0;padding-left:20px;color:var(--ink-2)}.pair li+li{margin-top:8px}.pair li{overflow-wrap:anywhere}
.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:8px 20px;margin:0;font-size:14.5px}
.facts dt{color:var(--ink-3)}.facts dd{margin:0;overflow-wrap:anywhere}
.cmd{display:block;white-space:pre-wrap;word-break:break-all;background:var(--soft);padding:10px 12px;border-radius:8px}
.same{color:var(--good);font-weight:700}.changed{color:var(--warn);font-weight:600}
.code{margin-top:20px}.code pre{margin:12px 0 0;max-height:640px;overflow:auto;background:var(--soft);border-radius:10px;padding:16px;line-height:1.5;tab-size:4}
.files{margin:12px 0 0;padding-left:20px;font-size:14px}.sha{color:var(--ink-3)}
.prov{display:flex;flex-direction:column;gap:20px}
footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--ink-3);overflow-wrap:anywhere}
`;

function shell(title: string, body: string, refreshSeconds?: number): string {
  const refresh = refreshSeconds === undefined ? '' : `<meta http-equiv="refresh" content="${esc(Math.max(1, Math.round(refreshSeconds)))}">`;
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}`
    + `<title>${esc(clip(title, 90))} · HimaHarness</title><style>${STYLE}</style></head>`
    + `<body><main class="page"><header class="top"><div class="mark"><b>Hima</b><span>Harness</span></div><div class="eyebrow">Library analysis</div></header>${body}</main></body></html>\n`;
}

export function analysisPageMessage(title: string, message: string): string {
  return shell(title, `<h1>${esc(title)}</h1><div class="card"><p style="margin:0;color:var(--ink-2)">${esc(message)}</p></div>`);
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

type Tone = 'run' | 'wait' | 'good' | 'warn' | 'bad';

function statusOf({ entry, detail, refreshSeconds }: AnalysisPageInput): { tone: Tone; text: string; reason?: string; unfinished: boolean } {
  const status = entry?.status, task = entry?.task, result = detail.result;
  const ended = status !== undefined && (status.startsWith('ended') || status.startsWith('cancelled'));
  const unfinished = refreshSeconds !== undefined || (entry !== undefined && (status !== undefined ? !ended : task !== undefined && !FINAL_TASK.has(task.state)));
  const accepted = result !== undefined || detail.resultUnavailable !== undefined || entry?.analysis !== undefined;
  const taskReason = task?.reason !== undefined && (task.state === 'waiting' || task.state === 'failed') ? task.reason : undefined;
  if (accepted) {
    const admitted = entry?.analysis?.admitted ?? detail.admission.admitted;
    const id = entry?.analysis?.id ?? result?.id, version = entry?.analysis?.version ?? result?.version;
    if (admitted) return { tone: 'good', text: id !== undefined && version !== undefined ? `Admitted as ${id}@${String(version)}` : 'Admitted to the Site library', unfinished };
    const reason = entry?.analysis?.notAdmittedReason ?? detail.admission.reason;
    if (unfinished && (reason === undefined || reason === 'admission has not finished')) return { tone: 'wait', text: 'Reader accepted · admission pending', unfinished };
    return { tone: 'warn', text: 'Reader accepted · not admitted', reason: reason ?? 'reason not recorded', unfinished };
  }
  if (status?.startsWith('cancelled')) return { tone: 'bad', text: 'Cancelled before a result was accepted', ...(taskReason ? { reason: taskReason } : {}), unfinished: false };
  if (ended) return { tone: 'bad', text: `Ended without a Reader-accepted result · ${words(status!)}`, ...(taskReason ? { reason: taskReason } : {}), unfinished: false };
  if (!unfinished && task?.state === 'failed') return { tone: 'bad', text: 'The resident task failed', ...(taskReason ? { reason: taskReason } : {}), unfinished };
  if (!unfinished) return { tone: 'warn', text: 'No Reader-accepted result', ...(detail.admission.reason ? { reason: detail.admission.reason } : {}), unfinished };
  return { tone: 'run', text: `The resident agent is working · ${words(task?.state ?? status ?? 'starting')}`, ...(taskReason ? { reason: taskReason } : {}), unfinished };
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function analysisPage(input: AnalysisPageInput): string {
  const { runId, entry, detail, refreshSeconds } = input, result = detail.result;
  const question = result?.question ?? entry?.question ?? 'Library analysis';
  const state = statusOf(input);
  const meta = [`<span class="pill" data-tone="${state.tone}">${esc(state.text)}</span>`, `<span>Run <code>${esc(runId)}</code></span>`];
  if (entry?.createdAt) meta.push(`<span>${esc(when(entry.createdAt))}</span>`);
  if (result !== undefined) meta.push(`<span>${plural(result.plots.length, 'plot')} · ${plural(Object.keys(result.datasets ?? {}).length, 'dataset')}</span>`);
  let body = `<h1>${esc(question)}</h1><div class="meta">${meta.join('')}</div>`;
  if (state.reason !== undefined) body += `<p class="reason">${esc(state.reason)}</p>`;
  if (state.unfinished) {
    const reload = refreshSeconds === undefined ? 'Reload this page to see the latest state.' : `This page reloads itself every ${plural(Math.max(1, Math.round(refreshSeconds)), 'second')} until the analysis settles.`;
    body += `<div class="card progress" role="status"><div class="spin" aria-hidden="true"></div><p><strong>${result === undefined ? 'The analysis is still running.' : 'The result is in; admission is still deciding.'}</strong> `
      + `The resident agent writes and runs the analysis on the Site, the Pack Reader checks the delivered document, and admission files it in the Site library. ${reload}</p></div>`;
  }
  if (detail.resultUnavailable !== undefined) body += `<div class="card alert" role="alert">${esc(detail.resultUnavailable)}</div>`;
  else if (result !== undefined) body += resultBody(result);
  if (entry?.analysis?.resultSha256) body += `<footer>Shown from the bytes the Pack Reader accepted (result SHA-256 <code title="${esc(entry.analysis.resultSha256)}">${esc(entry.analysis.resultSha256)}</code>).</footer>`;
  return shell(question, body, refreshSeconds);
}

function resultBody(result: LibInsightAnalysisResult): string {
  let out = result.summary ? `<p class="lead">${esc(result.summary)}</p>` : '';
  const plots = Array.isArray(result.plots) ? result.plots : [];
  if (plots.length > 0) out += `<section><h2>Plots</h2><div class="plots">${plots.map((plot, i) => plotCard(result, plot, i)).join('')}</div></section>`;
  // Each dataset once, however many plots draw it, so no value depends on reading a chart.
  const datasets = Object.entries(result.datasets ?? {}).filter(([, data]) => data !== null && typeof data === 'object' && Array.isArray(data.rows));
  if (datasets.length > 0) out += `<section><h2>Data</h2><div class="card">${datasets.map(([name, data]) =>
    `<details><summary>Data table · ${esc(name)} · ${plural(data.rows.length, 'row')}</summary>${dataTable(projectTable(data))}</details>`).join('')}</div></section>`;
  const list = (title: string, items: readonly string[] | undefined) => `<div class="card"><h2>${title}</h2>${items === undefined || items.length === 0 ? '<p class="notes">None stated.</p>' : `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`}</div>`;
  out += `<section class="pair">${list('Assumptions', result.assumptions)}${list('Limits', result.limits)}</section>`;
  return out + provenance(result);
}

function provenance(result: LibInsightAnalysisResult): string {
  const sources = result.sources ?? [];
  const sourceTable = sources.length === 0 ? '<p class="notes">No library file was named.</p>'
    : `<div class="table-wrap"><table><thead><tr><th scope="col">Path</th><th scope="col">SHA-256 before</th><th scope="col">SHA-256 after</th><th scope="col">Unchanged</th></tr></thead><tbody>${sources.map(source =>
      `<tr><td><code>${esc(source.path)}</code></td><td>${sha(source.sha256Before)}</td><td>${sha(source.sha256After)}</td><td>${source.sha256After === source.sha256Before ? '<span class="same" title="the file was not changed by the run">✓</span>' : '<span class="changed">changed</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  const run = result.run, code = result.code, files = code?.files ?? [];
  const facts = run === undefined ? '' : `<dl class="facts"><dt>Command</dt><dd><code class="cmd">${esc(run.command)}</code></dd><dt>Exit code</dt><dd>${esc(run.exitCode)}</dd>`
    + `<dt>Elapsed</dt><dd>${esc(typeof run.elapsedSeconds === 'number' ? formatValue(run.elapsedSeconds) : run.elapsedSeconds)} s</dd><dt>QuaLib API used</dt><dd>${run.usedQualib ? 'yes' : 'no'}</dd></dl>`;
  const script = code?.main === undefined ? '' : `<details class="code"><summary>Main script <code>${esc(code.main.path)}</code> · SHA-256 ${sha(code.main.sha256)}${files.length === 0 ? '' : ` · ${plural(files.length, 'more file')}`}</summary>`
    + `<pre><code>${esc(code.main.text)}</code></pre></details>`
    + (files.length === 0 ? '' : `<ul class="files">${files.map(file => `<li><code>${esc(file.path)}</code> ${sha(file.sha256)}</li>`).join('')}</ul>`);
  return `<section><h2>Provenance</h2><div class="prov"><div class="card"><h3>Sources</h3>${sourceTable}</div><div class="card"><h3 style="margin-bottom:14px">Run</h3>${facts}${script}</div></div></section>`;
}

// ---------------------------------------------------------------------------------------------
// Plots
// ---------------------------------------------------------------------------------------------

function plotCard(result: LibInsightAnalysisResult, plot: AnalysisPlotSpec, index: number): string {
  const g = projectPlot(result, plot);
  let inner = `<h3>${esc(g.title)}</h3>`;
  if (g.kind === 'cannot-draw') inner += `<p class="cannot" role="status">Cannot draw this plot: ${esc(g.reason)}.</p>`;
  else if (g.kind === 'table') inner += dataTable(g.table);
  else {
    if (g.kind !== 'heatmap') inner += legend(g.series, g.kind);
    inner += `<div class="chart">${g.kind === 'bar' ? barChart(g) : g.kind === 'heatmap' ? heatmapChart(g, index) : xyChart(g)}</div>`;
    if (g.notes.length > 0) inner += `<ul class="notes">${g.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>`;
  }
  return `<figure class="card${g.kind === 'table' ? ' wide' : ''}" data-plot="${esc(g.kind)}">${inner}</figure>`;
}

function legend(series: readonly SeriesKey[], kind: 'bar' | 'line' | 'scatter'): string {
  if (series.length < 2) return '';
  const swatch = kind === 'line' ? '<line x1="1" y1="5" x2="15" y2="5" class="line"/>' : kind === 'scatter' ? '<circle cx="8" cy="5" r="4" class="dot"/>' : '<rect x="3" y="0" width="10" height="10" rx="2" class="bar"/>';
  return `<ul class="legend" aria-label="Series">${series.map(key => `<li><svg width="16" height="10" aria-hidden="true" class="c${String(key.slot)}">${swatch}</svg>${esc(key.name)}</li>`).join('')}</ul>`;
}

function dataTable(table: TableProjection): string {
  const head = table.columns.map(column => `<th scope="col" data-type="${esc(column.type)}">${esc(column.header)}</th>`).join('');
  const clip = (cell: string) => cell.length > 300 ? `${cell.slice(0, 299)}…` : cell;
  const rows = table.rows.map(row => `<tr>${row.map((cell, j) => `<td data-type="${esc(table.columns[j]?.type ?? 'string')}">${esc(clip(cell))}</td>`).join('')}</tr>`).join('');
  const more = table.shownRows < table.totalRows ? `<p class="notes">Showing the first ${String(table.shownRows)} of ${table.totalRows.toLocaleString('en-US')} rows.</p>` : '';
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>${more}`;
}

const svg = (height: number, label: string, inner: string) => `<svg viewBox="0 0 ${String(W)} ${n(height)}" role="img" aria-label="${esc(label)}">${inner}</svg>`;
const text = (cls: string, x: number, y: number, body: string, extra = '') => `<text class="${cls}" x="${n(x)}" y="${n(y)}"${extra}>${body}</text>`;
/** Room for the longest y tick label and the rotated axis title. */
const leftFor = (axis: LinearAxis) => Math.min(130, Math.max(...axis.ticks.map(t => formatTick(t, axis.step).length)) * CHAR + 34);

function yAxis(axis: LinearAxis, x0: number, x1: number, y: (v: number) => number): string {
  const middle = (y(axis.domain[0]) + y(axis.domain[1])) / 2;
  return axis.ticks.map(t => `<line class="${t === 0 ? 'axis' : 'grid'}" x1="${n(x0)}" x2="${n(x1)}" y1="${n(y(t))}" y2="${n(y(t))}"/>`
    + text('tick', x0 - 7, y(t), esc(formatTick(t, axis.step)), ' text-anchor="end" dominant-baseline="middle"')).join('')
    + `<text class="axis-title" transform="translate(13 ${n(middle)}) rotate(-90)" text-anchor="middle" dominant-baseline="middle">${esc(axis.title)}</text>`;
}

const MAX_LABEL = 16;
/** Band labels without a long shared prefix (cell names share their library's), which the axis title names once. */
function bandText(axis: BandAxis): { labels: readonly string[]; title: string } {
  const names = axis.categories;
  const common = names.length < 2 ? '' : names.reduce((p, name) => { let i = 0; while (i < p.length && p[i] === name[i]) i++; return p.slice(0, i); });
  const prefix = common.slice(0, common.search(/[-_./: ][^-_./: ]*$/) + 1);
  if (prefix.length < 4 || !names.every(name => name.length > prefix.length)) return { labels: names, title: axis.title };
  return { labels: names.map(name => `…${name.slice(prefix.length)}`), title: `${axis.title} · ${prefix}…` };
}
/** Which band labels to print, whether they must lean to fit, and the room they take below and to the left. */
function bandLayout(axis: BandAxis, band: number) {
  const { labels, title } = bandText(axis), count = labels.length;
  const longest = Math.min(MAX_LABEL, Math.max(1, ...labels.map(label => label.length))) * CHAR;
  const lean = longest > band - 4;
  const every = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(count * band / (lean ? 20 : longest + 8)))));
  return { labels, title, every, lean, bottom: lean ? 26 + longest * 0.64 + 24 : 50, reach: (lean ? longest * 0.77 : longest / 2) - band / 2 + 6 };
}

function bandTicks(axis: BandAxis, layout: ReturnType<typeof bandLayout>, at: (i: number) => number, y: number): string {
  const { labels, every, lean } = layout;
  return axis.categories.map((name, i) => i % every !== 0 ? ''
    : text('tick', at(i), y + 17, `<title>${esc(name)}</title>${esc(clip(labels[i] ?? name, MAX_LABEL))}`, lean ? ` text-anchor="end" transform="rotate(-40 ${n(at(i))} ${n(y + 17)})"` : ' text-anchor="middle"')).join('');
}

/** A column with a 4 px rounded data end and a square foot on the baseline. */
function columnPath(x: number, w: number, base: number, end: number): string {
  const r = Math.min(4, w / 2, Math.abs(base - end)), s = end <= base ? 1 : -1;
  return `M${n(x)},${n(base)}V${n(end + s * r)}Q${n(x)},${n(end)} ${n(x + r)},${n(end)}H${n(x + w - r)}Q${n(x + w)},${n(end)} ${n(x + w)},${n(end + s * r)}V${n(base)}Z`;
}

function barChart(g: Extract<PlotGeometry, { kind: 'bar' }>): string {
  const right = 16, top = 14, count = g.x.categories.length, yRoom = leftFor(g.y);
  const left = Math.max(yRoom, bandLayout(g.x, (W - yRoom - right) / count).reach);
  const innerW = W - left - right, band = innerW / count, labels = bandLayout(g.x, band), plotBottom = HEIGHT - labels.bottom;
  const y = scaleLinear(g.y.domain, [plotBottom, top]), base = y(0);
  const k = Math.max(1, g.series.length), gap = 2;
  const barW = Math.max(1, Math.min(28, (band * 0.8 - (k - 1) * gap) / k)), groupW = k * barW + (k - 1) * gap;
  const at = (i: number) => left + i * band + band / 2;
  const bars = g.bars.map(bar => `<path class="bar c${String(g.series.length === 0 ? 1 : (g.series[bar.series]?.slot ?? 1))}" d="${columnPath(at(bar.category) - groupW / 2 + bar.series * (barW + gap), barW, base, y(bar.value))}"><title>${esc(bar.tip)}</title></path>`).join('');
  return svg(HEIGHT, `${g.title}: ${g.y.title} by ${g.x.title}`, yAxis(g.y, left, W - right, y) + bars
    + `<line class="axis" x1="${n(left)}" x2="${n(W - right)}" y1="${n(base)}" y2="${n(base)}"/>` + bandTicks(g.x, labels, at, plotBottom)
    + text('axis-title', left + innerW / 2, HEIGHT - 6, esc(labels.title), ' text-anchor="middle"'));
}

function xyChart(g: Extract<PlotGeometry, { kind: 'line' | 'scatter' }>): string {
  const left = leftFor(g.y), top = 14, plotBottom = HEIGHT - 48;
  const y = scaleLinear(g.y.domain, [plotBottom, top]);
  // Up to four lines are labelled at their right end as well, unless their ends crowd together.
  const ends = g.kind === 'line' && g.series.length >= 2 && g.series.length <= 4 ? g.lines.map(line => ({ series: line.series, y: y(line.points.at(-1)!.y) })) : [];
  const sorted = [...ends].sort((a, b) => a.y - b.y);
  const labelled = ends.length > 0 && sorted.every((end, i) => i === 0 || end.y - sorted[i - 1]!.y >= 15);
  const right = labelled ? 18 + Math.min(12, Math.max(...g.series.map(s => s.name.length))) * CHAR : 18;
  const x = scaleLinear(g.x.domain, [left, W - right]);
  const total = g.lines.reduce((sum, line) => sum + line.points.length, 0);
  const markers = g.kind === 'scatter' || total <= 60 * Math.max(1, g.lines.length), hits = total <= 1500;
  const slotOf = (series: number) => g.series.length === 0 ? 1 : (g.series[series]?.slot ?? 1);
  const marks = g.lines.map(line => `<g class="c${String(slotOf(line.series))}">`
    + (g.kind === 'line' ? `<path class="line" d="${line.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(x(p.x))},${n(y(p.y))}`).join('')}"><title>${esc(g.series[line.series]?.name ?? g.title)}</title></path>` : '')
    + (markers ? line.points.map(p => `<circle class="dot" cx="${n(x(p.x))}" cy="${n(y(p.y))}" r="4">${hits ? '' : `<title>${esc(p.tip)}</title>`}</circle>`).join('') : '')
    + (hits ? line.points.map(p => `<circle class="hit" cx="${n(x(p.x))}" cy="${n(y(p.y))}" r="10"><title>${esc(p.tip)}</title></circle>`).join('') : '') + '</g>').join('');
  return svg(HEIGHT, `${g.title}: ${g.y.title} against ${g.x.title}`, yAxis(g.y, left, W - right, y)
    + `<line class="axis" x1="${n(left)}" x2="${n(W - right)}" y1="${n(plotBottom)}" y2="${n(plotBottom)}"/>`
    + g.x.ticks.map(t => text('tick', x(t), plotBottom + 16, esc(formatTick(t, g.x.step)), ' text-anchor="middle"')).join('') + marks
    + (labelled ? ends.map(end => text('direct', W - right + 6, end.y, esc(clip(g.series[end.series]?.name ?? '', 12)), ' dominant-baseline="middle"')).join('') : '')
    + text('axis-title', (left + W - right) / 2, HEIGHT - 6, esc(g.x.title), ' text-anchor="middle"'));
}

function heatmapChart(g: Extract<PlotGeometry, { kind: 'heatmap' }>, index: number): string {
  const right = 16, top = 8, nx = g.x.categories.length, ny = g.y.categories.length;
  const yRoom = Math.min(MAX_LABEL, Math.max(1, ...g.y.categories.map(c => c.length))) * CHAR + 40;
  const left = Math.max(yRoom, bandLayout(g.x, (W - yRoom - right) / nx).reach);
  const innerW = W - left - right, cellW = innerW / nx, cellH = Math.max(14, Math.min(34, 380 / ny));
  const labels = bandLayout(g.x, cellW), plotBottom = top + ny * cellH, bottom = labels.bottom;
  const legendTop = plotBottom + bottom + 10, height = legendTop + 46;
  const inset = cellW > 6 && cellH > 6 ? 1 : 0, hatch = `hatch-${String(index)}`;
  const swatch = Math.min(30, (innerW - 16) / plotLimits.sequentialSteps), unit = g.value.unit ? ` ${g.value.unit}` : '';
  const cells = g.cells.map(cell => `<rect class="${cell.step === undefined ? 'cell' : `cell q${String(cell.step)}`}"${cell.step === undefined ? ` fill="url(#${hatch})"` : ''} x="${n(left + cell.x * cellW + inset)}" y="${n(top + cell.y * cellH + inset)}" width="${n(Math.max(1, cellW - 2 * inset))}" height="${n(Math.max(1, cellH - 2 * inset))}" rx="${inset ? 2 : 0}"><title>${esc(cell.tip)}</title></rect>`).join('');
  const scale = g.value.steps.map((step, i) => `<rect class="cell q${String(i)}" x="${n(left + i * (swatch + 2))}" y="${n(legendTop)}" width="${n(swatch)}" height="10" rx="2"><title>${esc(`${formatValue(step.from)} to ${formatValue(step.to)}${unit}`)}</title></rect>`).join('');
  const end = left + plotLimits.sequentialSteps * (swatch + 2);
  return svg(height, `${g.title}: ${g.value.title} by ${g.x.title} and ${g.y.title}`,
    `<defs><pattern id="${hatch}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="missing"/><line x1="0" y1="0" x2="0" y2="6" class="hatch"/></pattern></defs>`
    + g.y.categories.map((name, i) => text('tick', left - 7, top + i * cellH + cellH / 2, `<title>${esc(name)}</title>${esc(clip(name, MAX_LABEL))}`, ' text-anchor="end" dominant-baseline="middle"')).join('')
    + `<text class="axis-title" transform="translate(13 ${n(top + ny * cellH / 2)}) rotate(-90)" text-anchor="middle" dominant-baseline="middle">${esc(g.y.title)}</text>`
    + cells + bandTicks(g.x, labels, i => left + i * cellW + cellW / 2, plotBottom)
    + text('axis-title', left + innerW / 2, plotBottom + bottom - 4, esc(labels.title), ' text-anchor="middle"')
    + `<g aria-label="${esc(`Colour scale for ${g.value.title}`)}">${scale}`
    + text('tick', left, legendTop + 26, esc(formatValue(g.value.domain[0])), ' text-anchor="start"')
    + text('tick', end - 2, legendTop + 26, esc(formatValue(g.value.domain[1])), ' text-anchor="end"')
    + text('axis-title', end + 8, legendTop + 9, esc(g.value.title)) + '</g>');
}
