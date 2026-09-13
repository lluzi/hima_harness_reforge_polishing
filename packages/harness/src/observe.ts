// The observe operation: site → run → permit → channel → reader → ledger. One path, every layer.
//
// And **the one place a reading becomes a record** (`appendReading`), which since #61 has two callers
// rather than one: this operation, which reads a report with a reader this bundle ships, and the
// fabric's observe node, which may instead run a script of the pack's own on the Site. They differ in
// how the values arrived and in nothing else — both are a claim about a report, both are held against
// the same semantics by the same validator, and both write the same record — so the validating and
// the writing are here, once, rather than beside each of them.
import { createHash } from 'node:crypto';
import type { Ledger, ObservationRecord, ReaderRef, RefusalRecord, RunRecord, WriterRole } from './ledger.js';
import { loadSite } from './sites.js';
import { channelFor } from './channel.js';
import { decideRead } from './shell.js';
import { declarationOf, readerNamed } from './readers.js';
import { bundleSemantics, semanticValue, validateReading, type Semantics } from './semantics.js';
import { runFor } from './runs.js';
import { retainRunMaterial } from './experience.js';

export interface ObserveRequest {
  readonly site: string;
  readonly path: string;
  readonly reader?: string;
  /**
   * An existing Run to append this observation to. Absent, the observation opens a Run of its own —
   * the probe case. Given, a Run spans several observations, which is what a fabric Loop needs
   * before it can read two reports and judge them together (D36).
   */
  readonly run?: string;
  /**
   * The branch of a fork this reading was taken inside, when a fork took it (#29). Carried onto the
   * observation record, because the join judges **each branch's latest observation** and a Run whose
   * branches read two reports in the same instant cannot say which reading was whose from the order
   * they were appended in. A reading taken outside every fork carries none.
   */
  readonly branchId?: string;
}
export type ObserveResult =
  | { readonly kind: 'observed'; readonly run: RunRecord; readonly record: ObservationRecord }
  | { readonly kind: 'refused'; readonly run: RunRecord; readonly record: RefusalRecord };

export interface ObserveDeps { readonly ledger: Ledger; readonly sitesDir: string; readonly packsDir?: string }

/** One reading, as either path produces it: what was read, from where, by whom, and what it said. */
export interface Reading {
  /** The report, as the record names it: the path the Permit resolved. */
  readonly path: string;
  readonly contentSha256: string;
  readonly bytes: number;
  readonly reader: ReaderRef;
  /**
   * What the reader said, **as it said it**: a pack script's JSON straight out of the document it
   * wrote, or a bundled reader's own objects, neither yet held to any shape.
   *
   * `unknown` and not `SemanticValue`, deliberately: what a value *is* is decided at the gate below,
   * once, for both paths — so a caller cannot arrive having already decided it, and a bundled reader
   * whose TypeScript says one thing and whose runtime does another (a JSON.parse, a number that came
   * out of a report as a string) meets the same schema a pack script's output does.
   */
  readonly values: readonly unknown[];
  /** The branch of a fork this reading was taken inside (#29); absent outside every fork. */
  readonly branchId?: string;
}

/** What became of one reading: the observation it was appended as, or the refusal it was refused as. */
export type AppendedReading =
  | { readonly kind: 'observed'; readonly record: ObservationRecord }
  | { readonly kind: 'refused'; readonly record: RefusalRecord };

/**
 * **Validate one reading and write it.** The one gate between a reader and HimaLedger (#61).
 *
 * Every value is parsed for being a value at all (`semanticValue`, strict) and then held against the
 * resolved semantics and against what the reader itself declares it emits (`validateReading`) — in
 * that order, because the second cannot be asked of something that failed the first — and a reading
 * that disagrees at either step is a **refusal record** rather than an exception: the reader ran, the
 * report was read, and what came back was not what the pack promised — a fact about that pack,
 * written where every other fact about the Run is, signed `executor` because the executor noticed. Nothing partial is ever appended: a reading either becomes one
 * observation whole or becomes one refusal.
 *
 * @param ledger - the ledger.
 * @param runId - the Run this reading belongs to.
 * @param reading - what was read.
 * @param semantics - the value types in force: the pack's own ahead of the bundle's, or the bundle's
 *                    alone for a reading taken outside any pack.
 */
export async function appendReading(ledger: Ledger, runId: string, reading: Reading, semantics: Semantics,
  retention?: { readonly packsDir: string; readonly bytes: Uint8Array }): Promise<AppendedReading> {
  const refuse = async (reason: string): Promise<AppendedReading> => ({
    kind: 'refused',
    record: await ledger.appendRefusal(runId, { path: reading.path, reason }, 'executor'),
  });
  // **The shape first, before anything else is asked of a value.** A unit cannot be compared and a
  // qualifier cannot be looked up on something that is not a value at all, and a value this ledger
  // cannot store is not a bad row in it — it is a domain the *next* host cannot open, because the
  // storage domain does not validate on `put`. So every reading meets `semanticValue` here, on both
  // paths and in one place: a pack script's JSON, which arrives parsed only as far as "a document
  // with a values array", and a bundled reader's own objects, which meet no schema anywhere else.
  const shaped = semanticValue.array().safeParse(reading.values);
  if (!shaped.success) {
    return refuse(shaped.error.issues.map((issue) => `reader "${reading.reader.id}" produced something that is not a value: ${valueSaid(reading.values, issue.path)}: ${issue.message}`).join('; '));
  }
  const failures = validateReading({ id: reading.reader.id, emits: reading.reader.emits }, shaped.data, semantics);
  if (failures.length > 0) {
    return refuse(failures.join('; '));
  }
  // An absent key, never an undefined one: a reading taken outside every fork says so by omission.
  const inBranch = reading.branchId === undefined ? {} : { branchId: reading.branchId };
  let retainedPath: string | undefined;
  if (retention) {
    try {
      if (retention.bytes.byteLength !== reading.bytes) return refuse('observed byte count changed before retention');
      retainedPath = await retainRunMaterial({ ledger, packsDir: retention.packsDir }, runId, retention.bytes, reading.contentSha256);
    } catch (error) { return refuse(`observed bytes could not be retained: ${(error as Error).message}`); }
  }
  return {
    kind: 'observed',
    record: await ledger.appendObservation(runId, {
      ...inBranch,
      path: reading.path,
      contentSha256: reading.contentSha256,
      ...(retainedPath === undefined ? {} : { retainedPath }),
      bytes: reading.bytes,
      reader: reading.reader,
      values: shaped.data,
    }),
  };
}

/**
 * Which value of a reading a shape failure is about, as the refusal names it: its place in the
 * output counted from one, the type it claimed if it claimed one a person could read, and the field
 * of it that is wrong when the failure is about a field.
 *
 * By place *and* by claimed type, because neither alone identifies it: a reader emitting two values
 * of the same type in different path groups would make the type ambiguous, and a person holding the
 * JSON the script wrote reads the position.
 */
function valueSaid(values: readonly unknown[], path: readonly PropertyKey[]): string {
  const [index, ...within] = path;
  if (typeof index !== 'number') return 'the values it produced';
  const claimed = values[index];
  const type = typeof claimed === 'object' && claimed !== null && typeof (claimed as { type?: unknown }).type === 'string'
    ? ` (of type "${(claimed as { type: string }).type}")`
    : '';
  return `value ${index + 1}${type}${within.length > 0 ? ` ${within.join('.')}` : ''}`;
}

/**
 * **The observe operation**, against the value types this bundle declares.
 *
 * What `/hima observe`, the `hima_observe` tool and the observe route answer with: a reading taken
 * outside any pack, so the bundle's own `semantics.yml` is the whole of the vocabulary there is —
 * nobody has named a pack, and resolving one would mean guessing which.
 */
export async function observe(deps: ObserveDeps, req: ObserveRequest): Promise<ObserveResult> {
  return read(deps, req, bundleSemantics().values);
}

/**
 * **The same operation inside a Run of a pack**, against the value types *that pack* resolves (#61):
 * its own `semantics.yml` first, the bundle's second.
 *
 * The same reading, the same bundled reader, the same record — and a different question asked of the
 * values, because a pack may declare that a name the bundle also declares means something else in
 * its method (D46), and a reading taken at one of its nodes is a reading of that method. Held apart
 * from `observe` above rather than expressed as a field of `ObserveRequest`, because which semantics
 * are in force is not something a *caller* of the observe face may choose: it follows from whether
 * there is a pack, and the one caller that has one is the fabric's own observe node.
 *
 * @param semantics - the resolved value types, the pack's ahead of the bundle's.
 */
export async function observeForPack(deps: ObserveDeps, req: ObserveRequest, semantics: Semantics): Promise<ObserveResult> {
  return read(deps, req, semantics);
}

async function read(deps: ObserveDeps, req: ObserveRequest, semantics: Semantics): Promise<ObserveResult> {
  const site = loadSite(deps.sitesDir, req.site);
  const run = await runFor(deps.ledger, site, req.run);
  /** Every way this operation declines to read: one recorded refusal, never a silent empty result. */
  const refuse = async (reason: string, writer?: WriterRole): Promise<ObserveResult> => ({
    kind: 'refused',
    run,
    record: await deps.ledger.appendRefusal(run.id, { path: req.path, reason }, writer),
  });
  // One channel for the whole operation: the permit decision resolves the path where the file lives,
  // then the same warm channel reads it.
  const channel = channelFor(site);
  const decision = await decideRead(site, req.path, channel);
  if (!decision.ok) return refuse(decision.reason);
  const reader = readerNamed(req.reader ?? 'raw');
  if (!reader) return refuse(`unknown reader "${req.reader}"`);
  const bytes = await channel.readFile(decision.absPath);
  // The executor's own decision, not the shell's: the permit allowed the read, the reader declined the report.
  if (!reader.accepts(bytes)) {
    return refuse(`reader "${reader.id}" does not accept ${req.path}: not a recognised report for this reader`, 'executor');
  }
  const { values } = reader.read(bytes);
  // Through the one gate, exactly as a pack's own reader script goes through it (#61): a reader this
  // bundle ships is code and is still a claim about a report, and a bundled reader whose `emits` and
  // whose readings had drifted apart would be the one thing nothing else here could catch.
  const appended = await appendReading(
    deps.ledger,
    run.id,
    {
      path: req.path,
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      reader: declarationOf(reader),
      values,
      ...(req.branchId === undefined ? {} : { branchId: req.branchId }),
    },
    semantics,
    deps.packsDir === undefined ? undefined : { packsDir: deps.packsDir, bytes },
  );
  return appended.kind === 'observed' ? { kind: 'observed', run, record: appended.record } : { kind: 'refused', run, record: appended.record };
}
