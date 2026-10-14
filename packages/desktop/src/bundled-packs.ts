// Which Pack methods the packaged App seeds into a fresh versioned Home. main.ts installs only the
// ones that are absent (an existing user Pack is never replaced); this module answers the prior
// question — which ids to seed at all — so it can be unit-tested without Electron.
//
// Default (env unset): the three methods every HUG demo home has carried. Set HIMA_BUNDLED_PACKS to
// a comma-separated list to override it (the empty string seeds none); a demo kit that must keep the
// Guide from wandering to XTop ships, say, `HIMA_BUNDLED_PACKS=libinsight-analysis`. An id the
// checkout's packs/ does not hold is refused with a message naming the ids that exist, rather than
// silently skipped, so a typo surfaces at startup instead of a Home missing a method.

/** The Pack methods seeded when HIMA_BUNDLED_PACKS is unset. */
export const DEFAULT_BUNDLED_PACK_IDS: readonly string[] = ['custom-cell-fmax-dtco', 'xtop-timing-closure', 'libinsight-analysis'];

/**
 * The Pack ids to seed into a fresh packaged Home, given the process env and the Pack ids the
 * checkout actually holds (`available`). Unset env ⇒ {@link DEFAULT_BUNDLED_PACK_IDS} unchanged. A set
 * value is split on commas, trimmed, de-duplicated in first-seen order; the empty string ⇒ none. Any
 * id not in `available` throws, naming the unknown ids and the ids that exist.
 */
export function bundledPackIds(env: { readonly HIMA_BUNDLED_PACKS?: string | undefined }, available: readonly string[]): string[] {
  const raw = env.HIMA_BUNDLED_PACKS;
  if (raw === undefined) return [...DEFAULT_BUNDLED_PACK_IDS];
  const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0))];
  const have = new Set(available);
  const unknown = ids.filter((id) => !have.has(id));
  if (unknown.length > 0) {
    const known = [...available].sort().join(', ') || '(none)';
    throw new Error(
      `HIMA_BUNDLED_PACKS names ${unknown.length === 1 ? 'a Pack id' : 'Pack ids'} the checkout's packs/ does not hold: ${unknown.join(', ')}. Pack ids available to bundle: ${known}.`,
    );
  }
  return ids;
}
