// The Resident analyses panel's own rules over the Host's summaries (ADR-0020): when an analysis is
// settled (so polling stops), which analyses may be built on, and the per-result detail cache that
// keeps polling from refetching or re-projecting a result that has not changed. Pure, React-free.
import type { LibInsightAnalysisDetail, LibInsightAnalysisEntry } from '../libinsight-analyses.js';

const FINAL_TASK = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Settled: a Run with a status is settled only when it ended or was cancelled — admission and delivery
 * run after the resident task, so its success alone settles nothing. Without a Run status, a final
 * resident task, or knowing neither (nothing will change it by waiting), settles it.
 */
export function analysisFinished(entry: Pick<LibInsightAnalysisEntry, 'status' | 'task'>): boolean {
  if (entry.status !== undefined) return entry.status.startsWith('ended') || entry.status.startsWith('cancelled');
  return entry.task === undefined || FINAL_TASK.has(entry.task.state);
}

/** The chip word: a settled Run status wins over a task projection that may lag it. */
export function analysisState(entry: Pick<LibInsightAnalysisEntry, 'status' | 'task'>): string {
  if (entry.status !== undefined && (entry.status.startsWith('ended') || entry.status.startsWith('cancelled'))) return entry.status;
  return entry.task?.state ?? entry.status ?? 'unknown';
}

/** `id@version` of every admitted analysis, newest first, once each: the only valid build-on choices. */
export function admittedAnalysisRefs(entries: readonly Pick<LibInsightAnalysisEntry, 'analysis'>[]): string[] {
  const refs = new Set<string>();
  for (const entry of entries) {
    const analysis = entry.analysis;
    if (analysis?.admitted === true && typeof analysis.id === 'string' && typeof analysis.version === 'number') refs.add(`${analysis.id}@${String(analysis.version)}`);
  }
  return [...refs];
}

/** Details by Reader-accepted result hash; the oldest is dropped past `limit`. */
export function rememberDetail(cache: Map<string, LibInsightAnalysisDetail>, resultSha256: string, detail: LibInsightAnalysisDetail, limit = 16): void {
  cache.delete(resultSha256);
  cache.set(resultSha256, detail);
  while (cache.size > limit) cache.delete(cache.keys().next().value!);
}
