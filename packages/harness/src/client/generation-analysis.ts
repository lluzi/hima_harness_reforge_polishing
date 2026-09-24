import type { AnalysisView } from '../remote.js';

export interface GenerationAnalysisGroup {
  readonly generation?: number;
  readonly loopId?: string;
  readonly analyses: readonly AnalysisView[];
}

/** Group only identities the Ledger projected; an absent generation stays explicitly unclassified. */
export function groupGenerationAnalyses(analyses: readonly AnalysisView[]): readonly GenerationAnalysisGroup[] {
  const groups = new Map<string, { generation?: number; loopId?: string; analyses: AnalysisView[] }>();
  for (const analysis of analyses) {
    const key = analysis.generation === undefined ? 'unclassified' : JSON.stringify([analysis.loopId ?? null, analysis.generation]);
    const held = groups.get(key);
    if (held) held.analyses.push(analysis);
    else groups.set(key, {
      ...(analysis.generation === undefined ? {} : { generation: analysis.generation }),
      ...(analysis.loopId === undefined ? {} : { loopId: analysis.loopId }),
      analyses: [analysis],
    });
  }
  return [...groups.values()].sort((left, right) => {
    if (left.generation === undefined) return 1;
    if (right.generation === undefined) return -1;
    return (left.loopId ?? '').localeCompare(right.loopId ?? '') || left.generation - right.generation;
  });
}
