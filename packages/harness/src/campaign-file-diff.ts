// The pure diff between two Campaign files (final whole-branch review, H8): every dotted path whose
// value differs between `before` and `after`, e.g. `['goal.clock_period', 'inputs.design']` — what a
// person or HimaGuide changed, for an edit summary that names the field rather than dumping the whole
// document.
//
// A leaf module with no imports of its own, for the same reason `run-arguments.ts` is one:
// `campaign-file.ts` reaches `node:fs`, `node:crypto`, `node:path` and the `yaml` package to read and
// write the file on disk, and the browser bundle must never carry any of that in to compute a diff of
// two documents it already holds in memory. Both the Host (`campaign-file.ts`) and the client half
// import this one function from here directly.
//
// Held to no particular document shape: any two JSON-like objects diff the same way, so this module
// states nothing about what a Campaign file may contain — `campaign-file.ts`'s own `CampaignFile` is
// simply one caller's choice of `before`/`after`, and this file need not know that type exists to
// diff two values of it.

/** Every dotted path whose value differs between `before` and `after`. Object fields recurse;
 *  anything else (a string, a number, an array, `undefined`) is compared by its JSON identity and
 *  named whole. */
export function changedFields(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] {
  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const changed: string[] = [];
  const walk = (a: unknown, b: unknown, prefix: string): void => {
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        walk(a[key], b[key], prefix === '' ? key : `${prefix}.${key}`);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(prefix);
  };
  walk(before, after, '');
  return changed;
}
