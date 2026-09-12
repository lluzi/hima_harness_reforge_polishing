// A judge rule is data, never code: an identity and version, the semantic values it needs, and one
// deterministic predicate over one of them. Rules ship as YAML under `rules/` beside the built
// bundle so a person can read and review a rule without reading TypeScript. D6: every PASS or FAIL
// comes from a rule like this, applied to typed ledger values.
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { analysisMode, pathScope, semanticSlug } from './semantics.js';
import { dataOnDisk, placesLooked, readDataFile, type DataPlace } from './pack-data.js';
import { RuleReferenceError } from './errors.js';

/**
 * One semantic value a rule needs, named the way an observation carries it: a value type, narrowed
 * by analysis mode and path scope where those apply. An omitted `mode` or `scope` does not narrow.
 *
 * The type is a slug and not one of a fixed list since #61: a value type is declared in a
 * `semantics.yml` — the pack's own ahead of the bundle's — so the list this file could hold would be
 * the wrong one for every pack that brings a method of its own. That a rule's `type` and `unit` are
 * a pair the resolved semantics actually declare is `/hima pack check`'s to hold, where the pack's
 * file and the bundle's are both open; the Judge compares literally, as it always has, and a
 * requirement nothing in the observation matches goes UNDETERMINED naming it.
 */
export const requirement = z.strictObject({
  type: semanticSlug,
  mode: analysisMode.optional(),
  scope: pathScope.optional(),
});
export type Requirement = z.infer<typeof requirement>;

/** The comparisons a rule may make. Deliberately few: a rule is checkable, not programmable. */
export const predicateOp = z.enum(['gte', 'lte', 'gt', 'lt', 'eq']);
export type PredicateOp = z.infer<typeof predicateOp>;

/**
 * The one parameter a rule may declare: a name a caller binds at judge time with
 * `--param <name>=<value>`, and the unit that value is measured in. A rule with no `parameter`
 * takes its threshold from its own file alone.
 */
export const ruleParameter = z.strictObject({ name: z.string(), unit: semanticSlug });
export type RuleParameter = z.infer<typeof ruleParameter>;

/** A predicate's threshold references the rule's declared parameter, resolved at judge time. */
const parameterRef = z.strictObject({ parameter: z.string() });

export const rule = z
  .strictObject({
    id: z.string(),
    version: z.string(),
    title: z.string(),
    /** The one parameter this rule takes from the caller, if any; see `predicate.threshold`. */
    parameter: ruleParameter.optional(),
    requires: z.array(requirement).min(1),
    /** The one required value the predicate is applied to; it must appear in `requires`. */
    subject: requirement,
    /**
     * `threshold` is either a fixed number the rule file states outright, or `{ parameter: <name> }`
     * naming the rule's declared parameter — the value a caller binds at judge time takes its place.
     */
    predicate: z.strictObject({ op: predicateOp, threshold: z.union([z.number(), parameterRef]), unit: semanticSlug }),
  })
  .superRefine((r, ctx) => {
    if (!r.requires.some((q) => sameRequirement(q, r.subject))) {
      ctx.addIssue({ code: 'custom', message: `subject ${describeRequirement(r.subject)} is not listed in requires`, path: ['subject'] });
    }
    const { threshold } = r.predicate;
    if (typeof threshold === 'object') {
      if (!r.parameter) {
        ctx.addIssue({ code: 'custom', message: `predicate.threshold references parameter "${threshold.parameter}" but this rule declares no parameter`, path: ['predicate', 'threshold'] });
      } else if (r.parameter.name !== threshold.parameter) {
        ctx.addIssue({ code: 'custom', message: `predicate.threshold references parameter "${threshold.parameter}", but this rule's declared parameter is "${r.parameter.name}"`, path: ['predicate', 'threshold'] });
      } else if (r.parameter.unit !== r.predicate.unit) {
        ctx.addIssue({ code: 'custom', message: `parameter "${r.parameter.name}" is declared in ${r.parameter.unit}, but predicate.unit is ${r.predicate.unit}`, path: ['predicate', 'unit'] });
      }
    }
  });
export type Rule = z.infer<typeof rule>;

/** Two requirements name the same value when their type and their narrowing agree exactly. */
export function sameRequirement(a: Requirement, b: Requirement): boolean {
  return a.type === b.type && a.mode === b.mode && a.scope === b.scope;
}

/** A requirement as a person reads it in a verdict's reason: `setup_wns (mode setup, scope all)`. */
export function describeRequirement(r: Requirement): string {
  const narrowing = [r.mode && `mode ${r.mode}`, r.scope && `scope ${r.scope}`].filter(Boolean);
  return narrowing.length ? `${r.type} (${narrowing.join(', ')})` : r.type;
}

/** Rule ids are file names, so they are constrained to a safe shape rather than trusted. */
const RULE_ID = /^[a-z0-9][a-z0-9-]*$/;

/** The shipped rules directory, `rules/` beside `lib/` in this package. */
export const shippedRulesDir: string = fileURLToPath(new URL('../rules/', import.meta.url));

// Re-exported so a caller of `loadRule` finds the error it can throw right beside it.
export { RuleReferenceError };

/**
 * One rule as it was loaded, and **which of the directories asked it came out of** (#57).
 *
 * The directory is carried out of the lookup rather than worked out again afterwards, because the
 * two answers can differ: a file appearing, disappearing or refusing to open between the read and a
 * second look would have a caller report one file and a Campaign run another. Whether that directory
 * makes the rule the pack's or the bundle's is `originOf`'s to say, in `packs.ts`, which is where the
 * ordered list was composed.
 */
export interface LoadedRule {
  readonly rule: Rule;
  /** The directory of the place the file was read from. */
  readonly dir: string;
  /** The file itself. */
  readonly at: string;
}

/**
 * Load one rule by reference, and say where it was read from: `<id>` or `<id>@<version>`. An unknown
 * id, a file that declares a different id, a rule that fails its schema, or a version that does not
 * match all throw — a rule the harness cannot produce is an error, never a silent pass.
 *
 * `places` is an ordered list and the first of them holding `<id>.yml` wins (#57): a Run resolves
 * through its pack, which puts the pack's own `rules/` first and the bundle's second, so a pack that
 * brings a rule of its own runs on that rule and one that brings none runs on the bundle's. An id
 * neither place holds is refused naming **both**, because a person told only about the bundle would
 * go on editing the wrong folder.
 *
 * @param ref - `<id>` or `<id>@<version>`.
 * @param places - where to look, in order, each saying which instant its bytes are from (#64). The
 *                 bundle's own rules read off the disk, when nothing says otherwise.
 */
export function loadRuleFrom(ref: string, places: readonly DataPlace[] = [dataOnDisk(shippedRulesDir)]): LoadedRule {
  const [id = '', wantVersion, ...extra] = ref.split('@');
  if (extra.length > 0 || !RULE_ID.test(id)) throw new RuleReferenceError(`invalid rule reference "${ref}"; expected <id> or <id>@<version>`);
  const found = readDataFile(id, places);
  if (!found.ok) throw new RuleReferenceError(`unknown rule "${id}": no rule file at ${placesLooked(found.looked)}`);
  const file = found.at;
  const loaded = rule.parse(parse(found.text));
  if (loaded.id !== id) throw new Error(`rule file ${file} declares id "${loaded.id}", not "${id}"`);
  if (wantVersion !== undefined && loaded.version !== wantVersion) {
    throw new RuleReferenceError(`rule "${id}" is at version ${loaded.version}, not ${wantVersion}`);
  }
  return { rule: loaded, dir: found.dir, at: found.at };
}

/** The rule alone, for the callers that apply one and have no report to make about where it came
 *  from. Everything else is `loadRuleFrom`'s. */
export function loadRule(ref: string, places: readonly DataPlace[] = [dataOnDisk(shippedRulesDir)]): Rule {
  return loadRuleFrom(ref, places).rule;
}
