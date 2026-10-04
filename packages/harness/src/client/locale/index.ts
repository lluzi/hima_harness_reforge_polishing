// How the Hima client consumes the DSH shell's locale seam.
//
// Every other dsh client plugin receives its translator (`t`) as a slot prop (`PropsLocale<ns>`) on
// a component the shell itself renders. The Hima panels, though, are mostly children rendered deep
// inside one slot root (`HimaWorkbench`), so threading `t` through every intermediate component's
// props would be a large, churny change. Instead this module keeps the one `LocaleRuntime` the shell
// injected at `apply()` and exposes a `useHimaT()` hook that reads it through React's
// `useSyncExternalStore`: the hook subscribes to the runtime's own LocaleFace snapshot, so a language
// switch (which bumps the snapshot revision) re-renders every component that calls the hook — no
// restart, no prop threading. The bound translator the hook returns reads the active locale at call
// time, exactly as the shell's injected `t` does.
//
// When no runtime is installed (unit tests rendering a component directly, or any non-shell host),
// the hook falls back to resolving the English dictionary itself, so a component renders its original
// English wording with no shell present.
import { useSyncExternalStore } from 'react';
import { en, zh, HIMA_NS, type HimaDict } from './dictionaries.js';

export { HIMA_NS } from './dictionaries.js';

/** Interpolation variables for a translated template. */
export type TVars = Readonly<Record<string, string | number>>;

/** The translator shape — the same `(key, vars?)` call the shell's injected `t` carries. */
export type Translate = (key: string, vars?: TVars) => string;

/** The subset of the shell's `LocaleRuntime` this module needs: namespace registration, a bound
 *  translator, and the LocaleFace snapshot pair that drives continuous re-render. */
export interface LocaleRuntimeLike {
  register(ns: string, dicts: { zh: HimaDict; en: HimaDict }): () => void;
  bind(ns: string): Translate;
  subscribe(fn: () => void): () => void;
  getSnapshot(): unknown;
}

/** Fill `{name}` placeholders from `vars`; an absent key is left as written. */
function interpolate(template: string, vars?: TVars): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** The no-shell translator: resolve against the English dictionary, or echo the key if it is absent
 *  (the same residual behaviour the shell's lookup chain ends with). */
const fallbackT: Translate = (key, vars) => interpolate((en as HimaDict)[key] ?? key, vars);

// The one runtime the shell injected, captured at `apply()` and stable for the session. Bound forms
// are stored so `useSyncExternalStore` receives stable function identities (resubscribing every
// render otherwise).
let runtime: LocaleRuntimeLike | undefined;
let subscribeBound: (fn: () => void) => () => void = () => () => {};
let snapshotBound: () => unknown = () => 0;

/**
 * Register the Hima dictionaries and capture the runtime for {@link useHimaT}. Called once from the
 * client plugin's `apply()`, wrapped in `ctx.effect` so the returned disposer unregisters the
 * dictionaries and releases the runtime on unload.
 * @param rt - the shell's locale runtime (`ctx.locale`).
 * @returns a disposer that unregisters and clears the captured runtime.
 */
export function installHimaLocale(rt: LocaleRuntimeLike): () => void {
  runtime = rt;
  subscribeBound = (fn) => rt.subscribe(fn);
  snapshotBound = () => rt.getSnapshot();
  const dispose = rt.register(HIMA_NS, { zh: zh as HimaDict, en: en as HimaDict });
  return () => {
    dispose();
    if (runtime === rt) { runtime = undefined; subscribeBound = () => () => {}; snapshotBound = () => 0; }
  };
}

/**
 * The Hima namespace translator, re-rendering its caller on every locale switch. Safe to call with no
 * shell installed (tests): it then resolves the English dictionary directly.
 * @returns a `(key, vars?)` translator reading the active locale at call time.
 */
export function useHimaT(): Translate {
  useSyncExternalStore(subscribeBound, snapshotBound, snapshotBound);
  return runtime === undefined ? fallbackT : runtime.bind(HIMA_NS);
}

/**
 * Translate a value drawn from a stable enum (a Run status, a node state) whose English wording lives
 * in the shared `card-labels.ts` (host + client) and so cannot be moved here. The Hima dictionary
 * carries one key per known enum member; an enum value this bundle has no key for — a host upgraded
 * past this browser's build — falls back to the exact English `card-labels.ts` already resolved,
 * never a dropped or echoed key. English stays byte-identical because each key's `en` value equals
 * the `card-labels.ts` label it mirrors.
 * @param t - the active translator.
 * @param key - the Hima key mirroring this enum member.
 * @param fallback - the `card-labels.ts` English wording for an unknown member.
 */
export function labelKeyed(t: Translate, key: string, fallback: string): string {
  return (en as HimaDict)[key] === undefined ? fallback : t(key);
}
