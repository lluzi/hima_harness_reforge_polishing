// A judge rule is data, never code: an identity and version, the semantic values it needs, and one
// deterministic predicate over one of them. Rules ship as YAML under `rules/` beside the built
// bundle so a person can read and review a rule without reading TypeScript. D6: every PASS or FAIL
// comes from a rule like this, applied to typed ledger values.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';
import { analysisMode, pathScope, semanticUnit, semanticValueType } from './semantics.js';
import { RuleReferenceError } from './errors.js';

/**
 * One semantic value a rule needs, named the way an observation carries it: a value type, narrowed
 * by analysis mode and path scope where those apply. An omitted `mode` or `scope` does not narrow.
 */
export const requirement = z.strictObject({
  type: semanticValueType,
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
export const ruleParameter = z.strictObject({ name: z.string(), unit: semanticUnit });
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
    predicate: z.strictObject({ op: predicateOp, threshold: z.union([z.number(), parameterRef]), unit: semanticUnit }),
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
 * Load one rule by reference: `<id>` or `<id>@<version>`. An unknown id, a file that declares a
 * different id, a rule that fails its schema, or a version that does not match all throw — a rule
 * the harness cannot produce is an error, never a silent pass.
 */
export function loadRule(ref: string, dir: string = shippedRulesDir): Rule {
  const [id = '', wantVersion, ...extra] = ref.split('@');
  if (extra.length > 0 || !RULE_ID.test(id)) throw new RuleReferenceError(`invalid rule reference "${ref}"; expected <id> or <id>@<version>`);
  const file = path.join(dir, `${id}.yml`);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new RuleReferenceError(`unknown rule "${id}": no rule file at ${file}`);
  }
  const loaded = rule.parse(parse(text));
  if (loaded.id !== id) throw new Error(`rule file ${file} declares id "${loaded.id}", not "${id}"`);
  if (wantVersion !== undefined && loaded.version !== wantVersion) {
    throw new RuleReferenceError(`rule "${id}" is at version ${loaded.version}, not ${wantVersion}`);
  }
  return loaded;
}
