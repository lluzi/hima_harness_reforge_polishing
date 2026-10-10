// The Reports view, for a Pack that declares a tool-report folder (`contract.yml` `reports`): the
// human-readable reports each tool and agent left, grouped by round (newest first), then by station
// and node, each opening in place as plain text in small monospace type. The Campaign's own technical
// report is the last entry ("Run report") and opens the existing Report view.
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { PackGraph } from '../packs.js';
import type { RunReportFile, RunReportsView, RunView } from '../remote.js';
import { fetchRunReport, fetchRunReports } from './api.js';
import { Glyph } from './glyphs.js';
import { useHimaT } from './locale/index.js';
import { useViewerSession } from './viewer-session.js';

const REFRESH_MS = 10_000;

/** A file size a person reads: bytes, KB or MB. */
export function sizeSaid(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface NodeGroup { readonly node: string; readonly label: string; readonly files: readonly RunReportFile[] }
interface StationGroup { readonly key: string; readonly label?: string; readonly nodes: readonly NodeGroup[] }
interface RoundGroup { readonly round: number; readonly stations: readonly StationGroup[] }

/** Files by round (newest first), then by station in the strip's order, then by node in checklist
 *  order; a node no station lists stands on its own after them. */
export function groupReports(files: readonly RunReportFile[], graph: Pick<PackGraph, 'nodes' | 'view'> | undefined): readonly RoundGroup[] {
  const nodeLabel = new Map((graph?.nodes ?? []).map((node) => [node.id, (node as { label?: string }).label ?? node.id]));
  const order: { station?: { id: string; label: string }; node: string }[] = [];
  for (const station of graph?.view?.stations ?? []) for (const item of station.checklist) for (const node of item.nodes) order.push({ station: { id: station.id, label: station.label }, node });
  const rank = (node: string) => { const at = order.findIndex((entry) => entry.node === node); return at < 0 ? order.length : at; };
  const rounds = [...new Set(files.map((file) => file.round))].sort((a, b) => b - a);
  return rounds.map((round) => {
    const here = files.filter((file) => file.round === round);
    const nodes = [...new Set(here.map((file) => file.node))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const stations: { key: string; label?: string; nodes: NodeGroup[] }[] = [];
    for (const node of nodes) {
      const station = order.find((entry) => entry.node === node)?.station;
      const key = station?.id ?? `node:${node}`;
      let group = stations.find((candidate) => candidate.key === key);
      if (group === undefined) { group = { key, ...(station === undefined ? {} : { label: station.label }), nodes: [] }; stations.push(group); }
      group.nodes.push({ node, label: nodeLabel.get(node) ?? node, files: here.filter((file) => file.node === node).sort((a, b) => a.name.localeCompare(b.name)) });
    }
    return { round, stations };
  });
}

interface Opened { readonly file: RunReportFile; readonly text?: string; readonly truncated?: boolean; readonly error?: string }

export function ReportsView({ runId, view, graph, runReport }: { runId: string; view: RunView; graph: Pick<PackGraph, 'nodes' | 'view'> | undefined; runReport(): ReactNode }): ReactElement {
  const t = useHimaT();
  const viewer = useViewerSession();
  const [list, setList] = useState<{ value?: RunReportsView; error?: string }>({});
  const [opened, setOpened] = useState<Opened>();
  const [showRunReport, setShowRunReport] = useState(false);
  const reading = useRef<AbortController>();
  const currentNode = view.run.currentNode;

  // Read on open, every 10 s while the window is visible, and whenever the Run moves to another node.
  useEffect(() => {
    const controller = new AbortController();
    const read = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const result = await fetchRunReports(runId, controller.signal, viewer);
      if (controller.signal.aborted) return;
      setList((previous) => result.ok ? { value: result.value } : { ...previous, error: result.error.message });
    };
    void read();
    const timer = setInterval(() => { void read(); }, REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [runId, viewer, currentNode]);
  useEffect(() => () => reading.current?.abort(), []);

  const open = (file: RunReportFile) => {
    reading.current?.abort();
    const controller = new AbortController(); reading.current = controller;
    setOpened({ file });
    void fetchRunReport(runId, file.path, controller.signal, viewer).then((result) => {
      if (controller.signal.aborted) return;
      setOpened(result.ok ? { file, text: result.value.text, truncated: result.value.truncated } : { file, error: result.error.message });
    });
  };
  const back = (
    <button type="button" className="hima-button hima-reports-back" data-hima-control="reports-back"
      onClick={() => { reading.current?.abort(); setOpened(undefined); setShowRunReport(false); }}>
      <span className="hima-reports-back-glyph"><Glyph name="arrow-right" size={12} /></span>{t('reports.back')}
    </button>
  );

  if (showRunReport) {
    return <div className="hima-reports" data-hima-region="reports-run-report"><div className="hima-reports-head">{back}</div>{runReport()}</div>;
  }
  if (opened !== undefined) {
    const nodeLabel = groupReports([opened.file], graph)[0]?.stations[0]?.nodes[0]?.label ?? opened.file.node;
    return (
      <div className="hima-reports hima-reports-file" data-hima-region="reports-file" data-hima-state-path={opened.file.path}>
        <div className="hima-reports-head">
          {back}
          <div className="hima-reports-title">
            <strong className="hima-mono">{opened.file.name}</strong>
            <span className="hima-muted">{t('reports.at', { node: nodeLabel, n: opened.file.round })}</span>
          </div>
        </div>
        {opened.error !== undefined ? <p className="hima-reports-error">{opened.error}</p>
          : opened.text === undefined ? <p className="hima-muted">{t('reports.reading')}</p>
            : <>
              <pre className="hima-report-text" data-hima-region="reports-text">{opened.text}</pre>
              {opened.truncated === true ? <p className="hima-muted hima-reports-truncated">{t('reports.truncated')}</p> : null}
            </>}
      </div>
    );
  }
  const files = list.value?.files ?? [];
  const error = list.error ?? list.value?.error;
  const groups = groupReports(files, graph);
  return (
    <div className="hima-reports" data-hima-region="reports" data-hima-state-files={String(files.length)}>
      {error === undefined ? null : <p className="hima-reports-error" data-hima-region="reports-error">{error}</p>}
      {list.value === undefined && error === undefined ? <p className="hima-muted">{t('reports.reading')}</p>
        : files.length === 0 ? <p className="hima-muted" data-hima-region="reports-empty">{t('reports.empty')}</p> : null}
      {groups.map((group) => (
        <section key={group.round} className="hima-reports-round" data-hima-region={`reports-round-${String(group.round)}`}>
          <h3 className="hima-reports-round-title">{t('results.round', { n: group.round })}</h3>
          {group.stations.map((station) => (
            <div key={station.key} className="hima-reports-station">
              {station.label === undefined ? null : <h4>{station.label}</h4>}
              {station.nodes.map((node) => (
                <div key={node.node} className="hima-reports-node">
                  <h5>{node.label}</h5>
                  <ul>
                    {node.files.map((file) => (
                      <li key={file.path}>
                        <button type="button" className="hima-reports-file-row" data-hima-control={`report-${file.path}`} onClick={() => open(file)}>
                          <span className="hima-mono">{file.name}</span>
                          <span className="hima-muted">{sizeSaid(file.bytes)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      <section className="hima-reports-round">
        <ul>
          <li>
            <button type="button" className="hima-reports-file-row" data-hima-control="reports-run-report" onClick={() => setShowRunReport(true)}>
              <span>{t('reports.runReport')}</span>
              <span className="hima-muted"><Glyph name="arrow-right" size={12} /></span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  );
}
