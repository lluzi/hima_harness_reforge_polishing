// What a person has not yet seen in a Run's Reports and Results views: the report files and round
// results that arrived since that person last opened the view. Per viewer (the scope names the viewer
// session and the Run) and in memory only: a reload starts again with everything unseen. No DOM and
// no imports, so it runs under Node's own loader in the contract tests.

const seen = new Map<string, Set<string>>();

/** The scope of one view of one Run for one viewer. */
export const newsScope = (view: 'reports' | 'results', viewer: string | undefined, runId: string): string => `${view}:${viewer ?? ''}:${runId}`;

/** How many of `keys` (report paths, result record ids) this scope has not seen. */
export function unseenCount(scope: string, keys: readonly string[]): number {
  const known = seen.get(scope);
  return known === undefined ? new Set(keys).size : new Set(keys.filter((key) => !known.has(key))).size;
}

/** The view is open: every key it shows now counts as seen. Answers whether anything changed. */
export function markSeen(scope: string, keys: readonly string[]): boolean {
  let known = seen.get(scope);
  if (known === undefined) { known = new Set(); seen.set(scope, known); }
  const before = known.size;
  for (const key of keys) known.add(key);
  return known.size !== before;
}

/** Forget everything seen (tests). */
export function forgetSeen(): void { seen.clear(); }
