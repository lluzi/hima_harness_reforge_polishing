// HimaJudge: the role that turns ledger data into verdicts by declared deterministic rules. It is a
// plain service object — no model, no agent, no conversation, nothing to read but the ledger — and
// it is the only holder of the verdict-writer capability, so no other code path can write a verdict.
// D6: every PASS or FAIL is computed from typed values. D7: the executor cannot write verdicts, and
// every verdict cites the ledger record ids it used.
import type { Ledger, ObservationRecord, VerdictOutcome, VerdictRecord, VerdictWriter } from './ledger.js';
import type { SemanticValue } from './semantics.js';
import { describeRequirement, loadRule, sameRequirement, type PredicateOp, type Requirement, type Rule } from './rules.js';
import { loadRunPack } from './release.js';
import { dataOnDisk, type DataPlace } from './pack-data.js';

/**
 * One branch of a fork as the join judges it (#29): which branch, and the one reading its verdicts
 * are about — the latest observation that branch wrote.
 *
 * A branch that wrote no reading at all is handed over with none, and its rules come back
 * UNDETERMINED naming what they needed. That is the judge's own honest answer, and it is why this
 * carries an optional observation rather than being left out: a fork of two branches always has two
 * branches' worth of verdicts, whatever either of them managed to read.
 */
export interface JudgedBranch {
  readonly branchId: string;
  readonly observation?: ObservationRecord;
}

export interface JudgeRequest {
  readonly runId: string;
  /** Rule references, `<id>` or `<id>@<version>`; an unknown one is an error, never a silent pass. */
  readonly ruleIds: readonly string[];
  /**
   * Named values bound at judge time, `--param <name>=<value>`, one entry per parameter a rule
   * declares. A rule with no declared parameter ignores this map entirely; a rule that declares one
   * and finds no matching entry here is UNDETERMINED, naming the parameter — never a silent default.
   */
  readonly params?: Readonly<Record<string, number>>;
  /**
   * One branch of a fork to judge, and the one reading to judge it on (#29). Absent, the rules are
   * applied to everything the Run has observed, which is what every judge node outside a fork does.
   *
   * Given, the rules see that reading and no other, and every verdict carries the branch — so a join
   * writes one verdict per rule per branch, each citing its own branch's observation. The two go
   * together on purpose: judging one reading without saying whose it was would leave a Run with two
   * sets of verdicts nobody could tell apart, and naming a branch while judging everything would
   * attribute another branch's reading to it.
   */
  readonly over?: JudgedBranch;
}

/** One matched value and the observation record it was read from. */
interface Found {
  readonly value: SemanticValue;
  readonly recordId: string;
}

function matches(value: SemanticValue, req: Requirement): boolean {
  return value.type === req.type
    && (req.mode === undefined || value.mode === req.mode)
    && (req.scope === undefined || value.scope === req.scope);
}

/**
 * The value a requirement names, taken from the run's most recent observation that carries it:
 * a later reading of the same semantics supersedes an earlier one, and the choice is deterministic
 * because ledger records are ordered by sequence.
 */
function latestMatch(observations: readonly ObservationRecord[], req: Requirement): Found | undefined {
  let found: Found | undefined;
  for (const record of observations) {
    for (const value of record.values) {
      if (matches(value, req)) found = { value, recordId: record.id };
    }
  }
  return found;
}

function holds(op: PredicateOp, actual: number, threshold: number): boolean {
  switch (op) {
    case 'gte': return actual >= threshold;
    case 'lte': return actual <= threshold;
    case 'gt': return actual > threshold;
    case 'lt': return actual < threshold;
    case 'eq': return actual === threshold;
  }
}

/** A predicate's threshold, resolved to a number: fixed data, or the caller's bound parameter. */
type ThresholdResolution =
  | { readonly ok: true; readonly value: number; readonly boundParameters?: Readonly<Record<string, number>> }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve a rule's predicate threshold. A fixed number resolves as itself. A `{ parameter: name }`
 * threshold resolves from `params`, binding is required — no default and no last-known value — so a
 * rule judged without its parameter bound is UNDETERMINED, naming the parameter, never a silent pass.
 */
function resolveThreshold(rule: Rule, params: Readonly<Record<string, number>> | undefined): ThresholdResolution {
  const { threshold } = rule.predicate;
  if (typeof threshold === 'number') return { ok: true, value: threshold };
  const bound = params?.[threshold.parameter];
  if (bound === undefined) {
    return { ok: false, reason: `rule ${rule.id} requires parameter "${threshold.parameter}" to be bound, e.g. --param ${threshold.parameter}=<value>` };
  }
  return { ok: true, value: bound, boundParameters: { [threshold.parameter]: bound } };
}

export class Judge {
  readonly #ledger: Ledger;
  readonly #writer: VerdictWriter;
  readonly #packsDir: string;

  constructor(ledger: Ledger, writer: VerdictWriter, packsDir: string) {
    this.#ledger = ledger;
    this.#writer = writer;
    this.#packsDir = packsDir;
  }

  /**
   * Where this Run's rule ids resolve from, in order (#57): the pack's own `rules/` first, the
   * bundle's second.
   *
   * Read here, off the run row, rather than taken from each caller: a rule is resolved for a Run,
   * the run row names the pack, and `loadPack` is how a Run's pack is known. The three faces that
   * ask for a verdict — a judge node of a Campaign, `/hima judge`, and the observe tool's `judge`
   * argument — would otherwise each have to remember to pass the list, and one that forgot would
   * quietly judge a Campaign on the bundle's copy of a rule its pack had replaced.
   *
   * Undefined for a Run that names no pack at all — a Probe-campaign observation is judged against
   * the bundle's rules, there being no pack to have an opinion.
   *
   * A Run that *does* name a pack resolves through that pack or is refused: a pack this machine
   * cannot load is a pack whose `rules/` cannot be consulted, and falling back to the bundle there
   * would append a verdict from a rule the Run's pack never selected — two different rules share one
   * id precisely because a pack may replace the bundle's. The refusal names the pack and carries the
   * loader's own words about why, which is what a person acts on; nothing is written.
   */
  #rulePlaces(runId: string): readonly DataPlace[] | undefined {
    const run = this.#ledger.run(runId);
    const packId = run?.packId;
    if (packId === undefined) return undefined;
    try {
      return loadRunPack(this.#packsDir, packId, run?.packDigest).ruleDirs.map(dataOnDisk);
    } catch (err) {
      throw new Error(
        `run ${runId} runs pack "${packId}", whose own rules/ is where its rule ids are looked for first, and this machine cannot load that pack: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Apply each rule to the run's observations and append one verdict record per rule, in the order
   * asked. Every rule is loaded first, so an unknown rule id fails the whole call before anything is
   * written. Deterministic: the same ledger and the same rules give the same outcomes, citations,
   * and values.
   */
  async evaluate(request: JudgeRequest): Promise<VerdictRecord[]> {
    if (!this.#ledger.run(request.runId)) throw new Error(`unknown run ${request.runId}`);
    const rulePlaces = this.#rulePlaces(request.runId);
    const rules = request.ruleIds.map((ref) => loadRule(ref, rulePlaces));
    // One branch's own reading, or everything this Run has read: the narrowing is the caller's, and
    // it is the whole of what makes a join a join.
    const observations = request.over === undefined
      ? this.#ledger.records({ runId: request.runId, type: 'observation' }).filter((r): r is ObservationRecord => r.type === 'observation')
      : request.over.observation === undefined ? [] : [request.over.observation];
    const verdicts: VerdictRecord[] = [];
    for (const rule of rules) verdicts.push(await this.#judge(request.runId, rule, observations, request.params, request.over?.branchId));
    return verdicts;
  }

  async #judge(runId: string, rule: Rule, observations: readonly ObservationRecord[], params: Readonly<Record<string, number>> | undefined, branchId?: string): Promise<VerdictRecord> {
    const append = (outcome: VerdictOutcome, valuesAsRead: SemanticValue[], cites: string[], reason?: string, bound?: Readonly<Record<string, number>>): Promise<VerdictRecord> =>
      this.#append(runId, rule, outcome, valuesAsRead, cites, reason, bound, branchId);
    const valuesAsRead: SemanticValue[] = [];
    const cites: string[] = [];
    const numbers: number[] = [];

    for (const req of rule.requires) {
      const found = latestMatch(observations, req);
      if (!found) {
        return append('UNDETERMINED', valuesAsRead, cites, `run ${runId} has no observed ${describeRequirement(req)} value, which this rule requires`);
      }
      valuesAsRead.push(structuredClone(found.value));
      if (!cites.includes(found.recordId)) cites.push(found.recordId);
      if (found.value.value === null) {
        return append('UNDETERMINED', valuesAsRead, cites, `${describeRequirement(req)} is unknown in observation ${found.recordId}: ${found.value.unknownReason}`);
      }
      numbers.push(found.value.value);
    }

    // The rule schema guarantees the subject is one of the requirements, so this index exists.
    const at = rule.requires.findIndex((req) => sameRequirement(req, rule.subject));
    const subject = valuesAsRead[at]!;
    if (subject.unit !== rule.predicate.unit) {
      return append('UNDETERMINED', valuesAsRead, cites, `${describeRequirement(rule.subject)} is in ${subject.unit}, but this rule's threshold is in ${rule.predicate.unit}`);
    }
    const resolved = resolveThreshold(rule, params);
    if (!resolved.ok) {
      return append('UNDETERMINED', valuesAsRead, cites, resolved.reason);
    }
    const outcome: VerdictOutcome = holds(rule.predicate.op, numbers[at]!, resolved.value) ? 'PASS' : 'FAIL';
    return append(outcome, valuesAsRead, cites, undefined, resolved.boundParameters);
  }

  #append(
    runId: string,
    rule: Rule,
    outcome: VerdictOutcome,
    valuesAsRead: SemanticValue[],
    cites: string[],
    reason?: string,
    boundParameters?: Readonly<Record<string, number>>,
    branchId?: string,
  ): Promise<VerdictRecord> {
    // An absent key, never an undefined one, so a stored verdict round-trips as it was written: a
    // verdict about one branch of a fork says which, and one about the Run says so by omission.
    const inBranch = branchId === undefined ? {} : { branchId };
    const verdict = { outcome, ruleId: rule.id, ruleVersion: rule.version, cites, valuesAsRead, ...inBranch };
    const withReason = reason === undefined ? verdict : { ...verdict, reason };
    return this.#writer.appendVerdict(runId, boundParameters === undefined ? withReason : { ...withReason, boundParameters });
  }
}

/**
 * Build the judge, taking the ledger's one verdict-writer capability with it.
 *
 * @param ledger - the ledger a Run lives in and the only data a rule is applied to.
 * @param packsDir - where the installed packs are, so a rule id resolves through the Run's own pack
 *                   before the bundle (#57).
 */
export function createJudge(ledger: Ledger, packsDir: string): Judge {
  return new Judge(ledger, ledger.takeVerdictWriter(), packsDir);
}
