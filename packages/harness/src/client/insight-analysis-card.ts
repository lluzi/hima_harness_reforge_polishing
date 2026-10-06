// What the conversation card of one `hima_insight_analysis` call shows (ADR-0021): the tool's own
// answer, read back from its text, as a proposal, a started Run, a result or a list. Pure and
// React-free; anything it cannot read stays the tool's own text.
import type { ToolBlock } from './HimaRunCard.js';

export interface CardProposal {
  readonly kind: 'proposal';
  readonly ready: boolean;
  readonly question: string;
  readonly sources: readonly string[];
  readonly buildsOn: readonly string[];
  readonly pack?: string;
  readonly site?: string;
  readonly timeBoxMinutes?: number;
  readonly unknowns: readonly string[];
}
export interface CardStarted { readonly kind: 'started'; readonly runId: string; readonly page: string }
export interface CardResult {
  readonly kind: 'result';
  readonly runId: string;
  readonly page: string;
  /** `admitted`, `running`, `not-admitted` or `unavailable`, with the words the card says. */
  readonly state: 'admitted' | 'running' | 'not-admitted' | 'unavailable';
  readonly said: string;
  readonly question?: string;
  readonly summary?: string;
  readonly plotCount?: number;
}
export interface CardList { readonly kind: 'list'; readonly rows: readonly { readonly runId: string; readonly page: string; readonly question?: string; readonly said: string }[] }
export type InsightAnalysisCard =
  | { readonly kind: 'pending' }
  | { readonly kind: 'text'; readonly text: string; readonly error: boolean }
  | CardProposal | CardStarted | CardResult | CardList;

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value : undefined;
const ended = (status: unknown) => typeof status === 'string' && (status.startsWith('ended') || status.startsWith('cancelled'));

/** The words for an analysis's state, from its Run status, resident task and admission. */
function stateOf(value: Record<string, unknown>): Pick<CardResult, 'state' | 'said'> {
  const admission = value.admission as { admitted?: unknown; reason?: unknown } | undefined;
  const analysis = text(value.analysis);
  if (admission?.admitted === true) return { state: 'admitted', said: analysis ? `Admitted as ${analysis}` : 'Admitted' };
  if (text(value.resultUnavailable)) return { state: 'unavailable', said: `Result unavailable: ${String(value.resultUnavailable)}` };
  if (ended(value.status)) return { state: 'not-admitted', said: `${String(value.status)}${text(admission?.reason) ? ` · ${String(admission!.reason)}` : ''}` };
  const task = value.task as { state?: unknown } | undefined;
  return { state: 'running', said: `Running${text(task?.state) ? ` · resident task ${String(task!.state)}` : ''}` };
}

export function readInsightAnalysisCard(block: ToolBlock): InsightAnalysisCard {
  const raw = (block.content ?? []).filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text!).join('\n');
  if (block.kind === undefined) return { kind: 'pending' };
  if (block.isError) return { kind: 'text', text: raw || 'The analysis tool failed.', error: true };
  let value: Record<string, unknown>;
  try { value = JSON.parse(raw) as Record<string, unknown>; }
  catch { return { kind: 'text', text: raw, error: false }; }
  if (value === null || typeof value !== 'object') return { kind: 'text', text: raw, error: false };
  const page = text(value.page), runId = text(value.runId);
  switch (value.action) {
    case 'propose': {
      const pack = value.pack as { id?: unknown; version?: unknown } | undefined;
      return { kind: 'proposal', ready: value.ready === true, question: text(value.question) ?? '', sources: strings(value.sources), buildsOn: strings(value.buildsOn),
        ...(typeof pack?.id === 'string' ? { pack: `${pack.id}${typeof pack.version === 'string' ? ` ${pack.version}` : ''}` } : {}),
        ...(text(value.site) ? { site: String(value.site) } : {}),
        ...(typeof value.timeBoxMinutes === 'number' ? { timeBoxMinutes: value.timeBoxMinutes } : {}),
        unknowns: strings(value.unknowns) };
    }
    case 'confirm':
      return runId && page ? { kind: 'started', runId, page } : { kind: 'text', text: raw, error: false };
    case 'result':
      return runId && page ? { kind: 'result', runId, page, ...stateOf(value), ...(text(value.question) ? { question: String(value.question) } : {}),
        ...(text(value.summary) ? { summary: String(value.summary) } : {}), ...(Array.isArray(value.plots) ? { plotCount: value.plots.length } : {}) } : { kind: 'text', text: raw, error: false };
    case 'list': {
      const rows = (Array.isArray(value.analyses) ? value.analyses as Record<string, unknown>[] : []).flatMap(entry => {
        const id = text(entry.runId), at = text(entry.page);
        if (!id || !at) return [];
        const analysis = entry.analysis as { id?: unknown; version?: unknown; admitted?: unknown } | undefined;
        const said = analysis?.admitted === true && typeof analysis.id === 'string' ? `Admitted as ${analysis.id}@${String(analysis.version)}`
          : ended(entry.status) ? String(entry.status) : 'Running';
        return [{ runId: id, page: at, said, ...(text(entry.question) ? { question: String(entry.question) } : {}) }];
      });
      return { kind: 'list', rows };
    }
    default:
      return { kind: 'text', text: raw, error: false };
  }
}
