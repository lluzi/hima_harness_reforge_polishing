// @hima-seam storage-domain direct
// HimaLedger: the append-only record of a Run's observations, refusals, and verdicts, kept in a
// durable dsh storage domain. Business meaning lives here; the fabric only points at records.
import { createHash, randomUUID } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain';
import { cancelSessions } from './record-views.js';
import { semanticSlug, semanticValue } from './semantics.js';
import { licenceName } from './sites.js';

/**
 * What a reader declares about itself, copied into every observation it produces: its identity and
 * version, the report kind it accepts, and the value types it can emit. A record therefore says not
 * only what was read but what its reader was capable of reading, so a pack can list the readers a
 * goal needs and a later verdict can be re-read against the reader that made it.
 *
 * Since #61 a reader is either one this bundle ships or **a script in a pack's tools folder**, and
 * the two are told apart on the record by `file` and `sha256`: which file of the pack folder ran, and
 * the hash of the very bytes that were shipped to the Site and launched. Both present exactly for a
 * pack script, both absent for a bundled reader — a bundled reader is code inside this bundle and has
 * no pack-relative file to name, and inventing one would make a record claim a file nobody wrote.
 * They are what lets a person, a year later, say which script produced a number: a pack folder is
 * plain files a person edits, so its id and version alone do not identify what ran.
 */
/**
 * **The script a pack reader is**, as its declaration writes it and as every observation it produces
 * carries it: a path under the pack's own `tools/` (#61).
 *
 * Under `tools/` and nowhere else, because that is where a pack keeps what it runs and where a person
 * reviewing a pack looks for it — a reader is a pack tool, and a declaration free to point at any
 * file under the folder would be a pack running bytes from wherever it liked. The shape refuses `..`,
 * an absolute path and a hidden segment before anything is joined; it is the first of two defences,
 * and `packReaderScript` resolves the file for real against that same folder because a segment that
 * is itself a symlink passes every shape a name can have.
 *
 * Declared here, beside `readerRef`, and read back by `packs.ts` for the declaration — the same way
 * that file reads `packDataOrigin` and `verdictOutcome` back out of this module — so the path a
 * record claims and the path a pack may declare are one shape and cannot come to disagree.
 */
export const packReaderFilePath = z.string().superRefine((file, ctx) => {
  if (!/^tools\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(file)) {
    ctx.addIssue({
      code: 'custom',
      message: `the file "${file}" is not one: a reader's script is a file under the pack's own tools/, as in "tools/count-candidates.sh"`,
    });
  }
});

/** A sha256 as this ledger records one: the 64 lower-case hex digits of the digest, and nothing that
 *  merely looks like one. A record carrying half a hash, or one in another case, would be evidence
 *  nobody could compare against the bytes it claims to be of. */
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 is 64 lower-case hex digits');

/**
 * A slug this ledger records as a word and reads as nothing else: a workshop's id, and the language a
 * pack says its files are written in. Held to a shape rather than trusted, exactly as a sha256 is,
 * because both land on a card and in a report and neither is ever parsed.
 */
const ledgerSlug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'a workshop id and a language are lowercase letters, digits and dashes');

/**
 * A path this ledger records as a place on a Site: absolute, always.
 *
 * Held in the schema and not only by the callers that join one, because a relative path in a record
 * is a path nothing can resolve afterwards — a later host reads these records from another process
 * with another working directory, and a Job's own workspace is not this harness's. Every path in this
 * harness that names a place on a Site is one the Permit resolved, and a Permit resolves nothing
 * relative; a record carrying `results/x.json` would be a claim about a file nobody could find.
 */
const absoluteSitePath = z.string().startsWith('/', 'a path on a site is the absolute one the permit resolved, never a relative one');

/**
 * The one file of a workshop the fabric runs, as the launch found it (#62): where it is on the Site
 * and the hash of the bytes that were there when the Job was launched.
 *
 * Nested and strict, as `launchedReading` is and for the same reason: this is the tie between a Job
 * and the bytes that stood at its entry path when it was launched, and half of it would tie nothing. The hash is the one the `code` record
 * carries, re-read from the Site and held against that record immediately before the launch — so a
 * `launched` record saying this is saying "these bytes, verified, are what started".
 *
 * **What it claims, exactly**: the file the wrapper was given as its **first operand**, at the hash
 * it had when the Job was launched. The declaration's schema is what makes that true of every
 * workshop — `argv[1]` is the entry and no other word references it (`packs.ts`) — so this block
 * names a real word of the command line on the audit beside it. It is not a claim about what the
 * wrapper *does* with that operand: a wrapper that read its first operand and ran something else
 * would be the Site owner's business, settled when they put that wrapper in their Permit.
 */
export const launchedWorkshop = z.strictObject({
  /** The workshop, as the contract declares it. */
  id: ledgerSlug,
  entry: z.strictObject({ path: absoluteSitePath, sha256: sha256Hex }),
});
export type LaunchedWorkshop = z.infer<typeof launchedWorkshop>;

export const readerRef = z
  .strictObject({
    id: z.string(),
    version: z.string(),
    /** The report kind this reader accepts: a word for the record, declared and never sniffed. */
    reportKind: z.string(),
    /** Every semantic value type this reader can emit; empty for a reader that records identity alone. */
    emits: z.array(semanticSlug),
    /** The script this reader is, relative to the pack folder; absent for a reader this bundle ships. */
    file: packReaderFilePath.optional(),
    /** The sha256 of that script's bytes, as they were shipped and run; absent for a bundled reader. */
    sha256: sha256Hex.optional(),
  })
  .superRefine((r, ctx) => {
    // Both or neither, enforced and not merely documented: a record carrying a file and no hash says
    // which script was meant and not which bytes ran, and one carrying a hash and no file says the
    // opposite — and `readerSaid`, which decides from the pair, would present either of them as a
    // reader this bundle ships, which is the one thing they are not.
    if ((r.file === undefined) === (r.sha256 === undefined)) return;
    ctx.addIssue({
      code: 'custom',
      message: 'a pack reader records the script it is and the hash of the bytes that ran; a bundled reader records neither, and one without the other identifies nothing',
      path: [r.file === undefined ? 'file' : 'sha256'],
    });
  });
export type ReaderRef = z.infer<typeof readerRef>;

/**
 * Which of the two places a rule, a chooser or a reader a pack names was resolved from (#57): the
 * pack's own folder, or the bundle's.
 *
 * Declared here because a decision record carries it and this file imports nothing of the pack
 * anatomy — the same reason `verdictOutcome` is here and not in `rules.ts`. `packs.ts` reads it back
 * out of this module, as it already reads `verdictOutcome` for a graph's edge labels.
 */
export const packDataOrigin = z.enum(['pack', 'bundle']);
export type PackDataOrigin = z.infer<typeof packDataOrigin>;

/**
 * Who appended a record. Only the judge may write verdicts; the shell writes refusals; `person` is
 * what a person did, which the executor may not sign for — a Hard blocker is by definition a failure
 * the harness could not clear on its own, so the record that clears it says a person cleared it.
 */
export const writerRole = z.enum(['executor', 'shell', 'judge', 'person']);
export type WriterRole = z.infer<typeof writerRole>;

const base = {
  id: z.string(),
  runId: z.string(),
  siteId: z.string(),
  seq: z.number().int().positive(),
  at: z.string(),
  writer: writerRole,
  /**
   * Which Generation of the Run's Loop this record belongs to (CONTEXT.md), counted from one.
   *
   * Stamped by the append below out of the run row, never passed by a caller: the generation is the
   * Run's own state, and a record that carried a caller's idea of it could disagree with the row it
   * was written against. Absent on a record of a Run no fabric started — an observation's own
   * Probe-campaign Run has no Loop to be in a generation of — which is how this ledger says so
   * everywhere.
   */
  generation: z.number().int().positive().optional(),
  /**
   * The drill-down Loop this record was written inside, if any (#28): the id the `loop` record that
   * opened it minted.
   *
   * Stamped by the append below out of the run row, beside the generation and for the same reason —
   * where a Run stands is the Run's own state — so a record written while a Loop is open nests under
   * it and a record written outside every Loop carries no key at all. It is what makes the outer
   * graph's path and the nested Loop's both readable off one Run's records, which is what drilling
   * down is for.
   */
  loopId: z.string().optional(),
};

/**
 * The branch of a fork a record was written inside, if any (#29): the id of that branch, which is
 * the id of its first node.
 *
 * **A field the fabric passes, and not a stamp the append below takes off the run row**, which is
 * what every other "where the Run stands" key on a record is. Branches run at the same moment and
 * append at the same moment, so there is no one place the row could be read from that would say
 * which branch *this* write belongs to — the row says where all of them stand at once. The branch
 * is the writer's own knowledge, so the writer states it, and a record written outside every fork
 * carries no key at all.
 *
 * Spread into the five record kinds a fork is made of rather than into `base`, because those five
 * are the whole of what a fork produces: a branch moves nodes, launches Jobs, reads reports and
 * blocks, and the join writes a verdict per rule per branch. Everything else a Run writes is the
 * Run's and not a branch's — a workspace, a cancel, a decision, a person's resume — and a key on
 * those would be a branch claiming something no branch did.
 *
 * The observation is the one of the five worth saying out loud. The join judges **each branch's
 * latest observation**, and a Run whose branches read two reports in the same instant cannot say
 * which reading was whose from the order they were appended in. So the reading carries its branch,
 * the verdict that cites it carries the same one, and the run view's branch rows are read off both.
 */
const inBranch = { branchId: z.string().optional() };

export const observationRecord = z.object({
  ...base,
  ...inBranch,
  type: z.literal('observation'),
  path: z.string(),
  contentSha256: z.string(),
  /** Pack-local byte snapshot held when observed; original path remains the Site provenance. */
  retainedPath: z.string().optional(),
  bytes: z.number().int().nonnegative(),
  reader: readerRef,
  values: z.array(semanticValue),
});
export const refusalRecord = z.object({ ...base, type: z.literal('refusal'), path: z.string(), reason: z.string() });

/** What a rule concluded. UNDETERMINED is the honest third answer, never folded into PASS or FAIL. */
export const verdictOutcome = z.enum(['PASS', 'FAIL', 'UNDETERMINED']);
export type VerdictOutcome = z.infer<typeof verdictOutcome>;

/**
 * What HimaJudge concluded about one rule over one run: the outcome, the rule's identity and
 * version, the observation records the values were read from (`cites`), and those typed values
 * copied exactly as read. UNDETERMINED always names the missing or unknown requirement in `reason`.
 * `boundParameters` is the value bound to each parameter the rule declared and could resolve —
 * absent for a rule with no parameter, or one left UNDETERMINED for lack of a bound value. D6 and D7.
 */
export const verdictRecord = z
  .object({
    ...base,
    ...inBranch,
    type: z.literal('verdict'),
    outcome: verdictOutcome,
    ruleId: z.string(),
    ruleVersion: z.string(),
    cites: z.array(z.string()),
    valuesAsRead: z.array(semanticValue),
    reason: z.string().optional(),
    boundParameters: z.record(z.string(), z.number()).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === 'UNDETERMINED' && !v.reason) {
      ctx.addIssue({ code: 'custom', message: 'reason is required when the outcome is UNDETERMINED', path: ['reason'] });
    }
  });
/**
 * Who a Job is, durably: the tmux session it runs in and the process id of that session's pane, the
 * workspace it runs in, the name it was launched under, when it started, and the command as sent —
 * the exact shell line the Site was given to run, the user's argv quoted with the redirections that
 * put its output in the log and its status in the exit file. Recorded so a later process can find
 * the same Job again from the ledger alone, rather than from a handle it no longer holds.
 */
/**
 * A report as the harness read it, at the moment it read it: where the Permit resolved it, the hash
 * of the bytes that were there, and how many there were (#61).
 *
 * The evidence half of an observation, taken **before** a reader is launched rather than after it
 * ends — so the record says what was read and not what happens to be there when the reading comes
 * back, and a report the flow overwrote in between does not take the reading with it.
 */
export const reportSeen = z.strictObject({
  path: z.string(),
  contentSha256: sha256Hex,
  bytes: z.number().int().nonnegative(),
});
export type ReportSeen = z.infer<typeof reportSeen>;

/**
 * **Everything the read-back of a pack reader's Job needs, as that Job's own launch recorded it**
 * (#61): who read, where the answer will be, and what was read.
 *
 * A Job outlives its host (#14), so the turn that reads a reader's answer is very often not the turn
 * that launched it — and a pack folder is plain files a person edits while a Run is between hosts.
 * Everything the read-back would otherwise resolve again is therefore settled here, at the launch,
 * and carried on the `launched` record: the reader as it will appear on the observation, the file
 * the script was told to write, and the report as it stood. A resume that re-read the folder would
 * hash bytes no Job ever ran, hold the answer to an `emits` the script it launched never promised,
 * and — where the declaration had since been deleted — settle the node from an exit code with no
 * observation in the Run at all.
 */
export const launchedReading = z.strictObject({
  /** The reader, exactly as the observation this Job's answer becomes will carry it. */
  reader: readerRef,
  /** `${OUT}`: the file this Job was told to write, as the Permit resolved it. */
  out: z.string(),
  /** The report this reading is of, as it stood when the Job was launched. */
  report: reportSeen,
});
export type LaunchedReading = z.infer<typeof launchedReading>;

/** Strict, as every shape this ledger stores is: a launch writes exactly these six facts about a
 *  Job, and a seventh dropped in silence would be a Job a later process could not find the same
 *  way twice. */
export const jobIdentity = z.strictObject({
  session: z.string(),
  /** Absent only when recovery confirmed a launch whose original response and pane PID were lost. */
  pid: z.number().int().positive().optional(),
  workspace: z.string(),
  name: z.string(),
  startedAt: z.string(),
  wire: z.string(),
});
export type JobIdentity = z.infer<typeof jobIdentity>;

/**
 * What became of one Job: it was launched, it finished (with the exit code read from the exit file
 * the launch wrote, never inferred from the session being gone), or it was killed and the stop was
 * observed. Written by the executor. `nodeId` names the fabric node the Job belongs to once there is
 * a fabric to name one; a Job launched from the `/hima job` face carries none.
 */
export const jobRecord = z
  .strictObject({
    ...base,
    ...inBranch,
    type: z.literal('job'),
    event: z.enum(['launched', 'finished', 'killed']),
    job: jobIdentity,
    exitCode: z.number().int().optional(),
    nodeId: z.string().optional(),
    /**
     * How many seats of each licence this Job holds on the Site while it runs, copied from the
     * declaration the pack's contract makes of the tool it runs. What the Site's licence counts are
     * counted over, and what the Run's licence meters are computed from.
     *
     * Only the `launched` record carries them, and the schema below says so: the launch is where a
     * Job takes its seats, and everything that needs to know what a Job holds — the count of what a
     * Site is holding, and the meter of how long each Run held it — reads that record and pairs it
     * with whatever settled the launch. Repeating the seats on the end of a Job would be the same
     * fact written twice, and two places for it to disagree.
     *
     * A Job holding none carries no key at all, as every absent fact in this ledger does: a Job
     * launched from the `/hima job` face runs a command line a person typed, which no contract
     * describes and which therefore reserves nothing.
     */
    licences: z.record(licenceName, z.number().int().positive()).optional(),
    /**
     * What a **reader's** Job was launched to do, when this Job is one (#61): the reader as the
     * observation will carry it, the file it was told to write, and the report it is a reading of.
     *
     * **One nested member and not three flat ones**, strict inside as well as out. This block is the
     * discriminator a host that never launched the Job decides the whole read-back branch on, so
     * `reading !== undefined` is one question about one object rather than three questions that can
     * disagree, and a key nothing declares here is a refusal rather than a field dropped in silence.
     * It sits on the `launched` record for the same reason `licences` does: the launch is where it
     * was true. A Job with none is a tool's, which a node settles from its exit code alone; a Job
     * with one is a reader's, which no node may be called `done` over until its answer has been
     * read, validated and written down.
     */
    reading: launchedReading.optional(),
    /**
     * **What a workshop's Job was launched with as the wrapper's first operand** (#62): the workshop, and the entry file with the
     * hash it had when this Job started.
     *
     * The same shape and the same reason as `reading` beside it. A workshop's Job runs bytes a model
     * wrote, and the `code` record is this ledger's claim that those bytes landed; this block is the
     * claim that *these* bytes are what ran, written from a re-read of the file taken immediately
     * before the launch and held against that record. Without it the ledger would prove one set of
     * bytes was written and leave what the Job executed unstated — which, for the one place in this
     * product where a model's own code runs, is the fact an audit is for.
     */
    workshop: launchedWorkshop.optional(),
    /**
     * **Which attempt at its node this Job is** (#62), on the `launched` record where the attempt is
     * known.
     *
     * The durable answer to a question a process that never launched the Job has to ask. Recovery
     * numbers the records it writes for a Job it picked up from the attempt that Job belonged to, and
     * read that off the node record carrying the Job's session — which is written *after* the launch
     * record, so a host that died between the two left the attempt unknowable and the next one
     * numbered the same turn twice (`attemptOfSession`). The launch is where the attempt is in hand,
     * so the launch is where it is written down.
     */
    attempt: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    if (r.event !== 'finished' && r.exitCode !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only a finished job has an exit code; a launched or killed one wrote none', path: ['exitCode'] });
    }
    if (r.event !== 'launched' && r.licences !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only a launched job says what it holds; the licences of a job are recorded once, where it took them', path: ['licences'] });
    }
    if (r.event !== 'launched' && r.reading !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only a launched job says what it was launched to read; a reader\'s job records that once, where it was decided', path: ['reading'] });
    }
    if (r.event !== 'launched' && r.workshop !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only a launched job says which bytes of which workshop it ran; a workshop\'s job records that once, where the entry was verified', path: ['workshop'] });
    }
    if (r.event !== 'launched' && r.attempt !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only a launched job says which attempt it is; the end of a job is numbered by the launch it belongs to', path: ['attempt'] });
    }
    // What used to be said here — all three of the reading's fields or none of them — is said by
    // `launchedReading` itself now: one strict object, every member required, so two of three is a
    // shape that cannot be written rather than a rule this refinement has to remember.
  });

/**
 * The Campaign workspace a Run acts in: where it is on the Site, what was copied into it from the
 * Site's own flow, and the container name the pack's tools bind that copy into.
 *
 * A record of its own rather than a job event, because preparing a workspace is not a Job: nothing is
 * launched, nothing runs detached, and there is no session, pid, or exit code to carry — a `job`
 * record shaped to hold this would have to invent all four. What it does carry is what a later
 * process needs to find the same workspace again and to clean up after it: `containerName` above all,
 * since the flow's wrapper creates that container on first use and only a name can remove it.
 *
 * `prepared` is written by the preparation that created the workspace; `reused` by one that found it
 * already there and did nothing, so a Run says which workspace it used whether or not it made it.
 */
export const workspaceRecord = z.object({
  ...base,
  type: z.literal('workspace'),
  event: z.enum(['prepared', 'reused']),
  campaignId: z.string(),
  packId: z.string(),
  packVersion: z.string(),
  /** Absent in legacy records; absence never establishes an original method identity. */
  packDigest: sha256Hex.optional(),
  /** Absolute, as the Site resolved it. */
  workspace: z.string(),
  /** The Site's own flow, read to make the copy and never written. */
  flowRoot: z.string(),
  /** Present only when the Pack declares a design input; generic Packs have none. */
  design: z.string().optional(),
  /** The container the pack's tools bind the copy into: `hima-<campaign>`, never the Site's own. */
  containerName: z.string(),
  /** What the run contract named, copied into `<workspace>/flow/`, in the order it was copied. */
  copied: z.array(z.string()),
  /** When the workspace was prepared — the original preparation's time, carried by a `reused` record too. */
  preparedAt: z.string(),
});

/** The four node kinds a HimaFabric graph is built from, and no more (D29, CONTEXT.md). */
export const nodeKind = z.enum(['act', 'judge', 'explore', 'wait']);
export type NodeKind = z.infer<typeof nodeKind>;

/**
 * What a node is doing. A small fixed set (D29): the business meaning of a node's work lives in the
 * observation, verdict, job and decision records it produced, never in this word.
 *
 * `waiting-for-slot` is a node that has work to launch and no free slot to launch it in: the Site's
 * parallel job cap is spent (D25, D33) and this node is queued behind whatever holds it. It is a
 * state of its own rather than a `running` node that happens not to have launched yet, because the
 * two are different things to a person looking at a Run that is taking a long time — one is a Job
 * running, the other is a Site that is full.
 */
export const nodeState = z.enum([
  'pending',
  'running',
  'done',
  'retrying',
  'blocked',
  'cancelled',
  'waiting-for-slot',
  'reconciled',
]);
export type NodeState = z.infer<typeof nodeState>;

/**
 * Does this node record give up on the launch its `jobSession` names? A node that went `retrying`,
 * `blocked` or `cancelled` against a session has stopped waiting for that Job, whatever the Job
 * itself does next: the job cap stops counting the launch (it holds no slot and no licence seat),
 * and the licence meter stops the clock on it, at this record's time. Stated once, here, because the
 * two would otherwise disagree the day a fourth state joins them.
 */
export const givesUpLaunch = (r: { readonly state: NodeState }): boolean =>
  r.state === 'retrying' || r.state === 'blocked' || r.state === 'cancelled';

/**
 * One transition of one fabric node, written by the executor as HimaFabric moves. A node is entered
 * (`running`, or `waiting-for-slot` when the Site is at its job cap) and settles (`done`, `blocked`,
 * `cancelled`); `retrying` is the state between a failed attempt and the next one. `pending` is what
 * a node the Run has not reached is in, and is therefore never written — a record says what
 * happened, and nothing has happened to such a node.
 *
 * `reconciled` is what a new process writes when it picks a node's attempt up again after a restart,
 * carrying in `reason` what it found of the Job that attempt launched: still running, finished with
 * the exit the launch wrote, or gone. It is not a settling state — the node goes on to `done`,
 * `blocked` or `cancelled` from there, and the attempt it belongs to is the one that was interrupted,
 * never a new one — but it is the transition that says a second process took the node over, which is
 * otherwise nowhere in the record.
 *
 * `attempt` counts this node's attempts within the Run, from one. `outcome` is what the node
 * concluded where a node concludes anything: a judge node's verdict outcome, which is also the label
 * of the edge the Run then took. `jobSession` names the tmux session an act node's attempt is
 * waiting on, so the Job a node belongs to is findable from the node's own record and not only from
 * the Job's — which is what a reconciliation after a restart (#14) reads.
 *
 * `reason` is why a node is in the state it is in, in words, and every `blocked` the fabric writes
 * carries one. A blocked node is where a Run stops needing a person, and a person who cannot read
 * the cause off the record has to reconstruct it from the code. The `blocker` record below is the
 * durable home for a node's *whole* failure — the last exit, the log tail — and never a reason to
 * leave a blocked node saying nothing.
 */
export const nodeRecord = z.object({
  ...base,
  ...inBranch,
  type: z.literal('node'),
  nodeId: z.string(),
  kind: nodeKind,
  state: nodeState,
  attempt: z.number().int().positive(),
  outcome: verdictOutcome.optional(),
  jobSession: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * A Hard blocker: a node whose Retry allowance is spent, written by the executor when it gives up.
 * The whole of the failure in one record, so that the person who has to clear it does not have to
 * reconstruct it from a node's one-line reason and a log file on a Site they may not be logged into.
 *
 * `attempts` is how many attempts this node had made in this Run when it gave up, the same number
 * the failing attempt's node record carries. `lastExitCode` is what the last Job exited with, and is
 * absent when there was none to read — a Job that vanished wrote no exit status, and no code is
 * invented for it. `logTail` is the last lines of that Job's own log, copied into the ledger at the
 * moment of failure rather than left on the Site: a workspace is cleaned up, a Site goes away, and a
 * blocker that pointed at a file nobody can still read would say nothing. It is absent when the
 * failure had no Job to tail. `reason` is the sentence a person reads first.
 */
export const blockerRecord = z.object({
  ...base,
  ...inBranch,
  type: z.literal('blocker'),
  nodeId: z.string(),
  attempts: z.number().int().positive(),
  lastExitCode: z.number().int().optional(),
  logTail: z.string().optional(),
  reason: z.string(),
});

/**
 * A person clearing a Hard blocker, written with the `person` writer because that is what happened:
 * `/hima resume`, the `hima_resume` tool, or the workbench's resume route. `who` is the session's
 * agent id, or `workbench` for the route, so the ledger says which person's action this was rather
 * than only that one occurred. `clears` names the blocker record this resume answers, when the Run
 * holds one — a Run waiting for another reason (a Wait node, a fault mid-drive) is resumable too,
 * and clears no blocker.
 *
 * `nodeId` is the node the Run re-enters, which is the blocked node itself and not the Wait node the
 * Run was routed to: re-entering the Wait node would only wait again.
 */
export const resumedRecord = z.object({
  ...base,
  type: z.literal('resumed'),
  nodeId: z.string(),
  who: z.string().min(1),
  clears: z.string().optional(),
});

/**
 * The knobs this Run is currently set to, by the names the pack that declares them uses (#58).
 *
 * A map and not a fixed shape, because what a Strategy is made of is the pack's to say: its contract
 * declares each knob with a type, a unit or a list, bounds and a default, the harness holds every
 * value against that declaration before a Run starts, and the ledger carries what was held. A
 * number for a number knob, one of the declared options for a choice knob, and nothing else — a
 * value of some third kind is a knob no declaration could have produced.
 *
 * Never empty: a pack declares at least one knob, so a Run of one is set to at least one thing.
 */
export const runStrategy = z
  .record(z.string().min(1), z.union([z.number(), z.string().min(1)]))
  .refine((s) => Object.keys(s).length > 0, { error: 'a strategy carries at least one knob, because a pack declares at least one' });
export type RunStrategy = z.infer<typeof runStrategy>;

/**
 * What an Explore node chose: the next strategy to try, that the Goal is met and there is nothing to
 * try next, or that the exploration has converged — successive generations moved the measured value
 * by less than the band the pack declared, so trying again would buy nothing. Exactly one of the
 * three, which is why they are separate shapes rather than one object with optional parts — a
 * decision carrying two of them, or none, is not a decision.
 *
 * `converged` carries the whole of the rule it was decided by, in the explore node's own words: the
 * chooser read it was measured over, the band and the number of generations the pack declared, and
 * the values compared, oldest first. A person re-derives the decision from this record alone, which
 * is what every other decision arm already promises.
 *
 * The next-strategy arm carries the *whole* Strategy chosen and not the knobs that moved (#58): what
 * the next generation is set to is what a person re-derives a decision against, and a record naming
 * only what changed would leave them to reconstruct the rest from the generations before it.
 */
export const decisionChoice = z.union([
  z.strictObject({ strategy: runStrategy }),
  z.strictObject({ goalMet: z.literal(true) }),
  z.strictObject({
    converged: z.strictObject({
      read: z.string().min(1),
      band: z.number(),
      generations: z.number().int().positive(),
      /** The measured values compared, oldest first: `generations + 1` of them. */
      values: z.array(z.number()).min(2),
    }),
  }),
]);
export type DecisionChoice = z.infer<typeof decisionChoice>;

/**
 * An accepted Explore decision, written by the executor. Historical records carry a deterministic
 * Pack choice. An `agent` provenance identifies the conversational owner's explicit choice and
 * rationale; the named chooser remains the Pack reference, not a claim that it chose this strategy.
 *
 * `rationale` holds only verified numeric evidence used by the decision. It is empty when the
 * owner's strategy differs from the advice; `agent.rationale` records that owner's explanation.
 * Historical records carry the numbers the chooser used, enough to re-derive the choice
 * with nothing but this record — for `timing-push`, the clock period the report stated, the setup
 * slack, and the pack's guard band. The outcomes it weighed are not copied here: they are in the
 * verdicts it `cites`, which also carry the values as read and the rule that produced each one.
 */
export const decisionRecord = z.object({
  ...base,
  type: z.literal('decision'),
  nodeId: z.string(),
  chooser: z.string(),
  /**
   * Where that chooser's file was read from (#57). A chooser id resolves in the pack's own
   * `choosers/` before the bundle's, so the id alone no longer says which file was applied — and a
   * decision a person cannot re-derive from the record and one file is not a decision on record.
   */
  chooserOrigin: packDataOrigin,
  /** Explicit owner choice; absent on historical deterministic chooser decisions. */
  agent: z.strictObject({ sessionId: z.string().min(1), executionId: z.string().min(1), rationale: z.string().min(1) }).optional(),
  chosen: decisionChoice,
  rationale: z.record(z.string(), z.number()),
  /** The verdict record ids the chooser weighed, then the observation record id it read. */
  cites: z.array(z.string()),
});

/**
 * That a person asked this Run to stop, written by the executor the moment the request arrives and
 * before anything is sent to the Site.
 *
 * The request only. What actually stopped is the `killed` job record and the `cancelled` node record
 * that follow, and a Run is not cancelled until those exist (#9): a cancel is a fact, not a wish, so
 * the asking and the observed stop are two records and never one. Written first for a second reason
 * as well — it is what tells the waiting loop of a Run being driven elsewhere that the Job about to
 * disappear was deliberately stopped, so the disappearance is not recorded as a fault.
 *
 * `nodeId` is the node the Run stood at when the request arrived, and `jobSessions` **every** Job it
 * found open, in the order it stopped them; both absent when the Run had neither. `nodeId` and the
 * sessions can name different nodes, and each says only its own thing: a cancel looks for an open
 * launch at *every* node of the graph rather than at the one the Run stands at, because a Run whose
 * Retry allowance is spent stands at the pack's Wait node while the Job it gave up on may still be
 * running on the Site, and a Run inside a fork stands at the join with a Job open in every branch.
 *
 * **Every session it stopped, and not only one** (#29). One `cancel` record is written whatever a
 * fork had running, so the record has to carry the whole list: a waiting loop holding a Job of its
 * own asks this record whether *its* session is one the cancel is stopping (`stoppedWithJob`), and
 * a cancel that named one Job of two would have the other branch conclude that somebody else was
 * stopping a Job nobody had ever seen — leaving it running on the Site, holding a licence, with the
 * Run already final and `reconcileRuns` passing over it for ever.
 *
 * `jobSession` is the first of `jobSessions`, kept because every face names one Job (`/hima cancel`
 * says which session it stopped, and `CancelResult.stopped` is that one): it is a spelling of the
 * list's head and never a fact of its own, and a record carrying one carries the other.
 */
export const cancelRecord = z.object({
  ...base,
  type: z.literal('cancel'),
  nodeId: z.string().optional(),
  jobSession: z.string().optional(),
  jobSessions: z.array(z.string()).optional(),
});

/**
 * **Is this Job one that cancel stopped?** Asked through the one reading of a cancel's sessions
 * (`cancelSessions`, `record-views.ts`), because the face that writes it and the loop that reads it
 * must not come to two answers about one Job (#29).
 *
 * By name only. A launch can be on record ahead of a `cancel` the cancel never saw — it reads what
 * the Run has open and appends afterwards — so "a cancel landed after my launch" is not the same
 * fact as "a cancel stopped me", and inside a fork the difference is a whole branch's Job left
 * running with the Run already final. `jobSession` is read as well as `jobSessions` so that a record
 * written before the list existed is still read the one way.
 */
export const cancelStopped = (cancel: CancelRecord, session: string): boolean =>
  cancelSessions(cancel).includes(session);

/**
 * How a drill-down Loop ended (#28), and the only labels an opening Explore node's outgoing edges
 * may carry.
 *
 * The three endings a Loop can reach, which are the Run's own three minus the ones a Loop cannot
 * have: `goal-met` and `converged` are its Explore node's decision, and `generation-limit` is its
 * own `converge.generationLimit` spent. A time box and a person's cancel end the whole Run and never
 * one Loop inside it, so neither is here.
 */
export const loopOutcome = z.enum(['goal-met', 'converged', 'generation-limit']);
export type LoopOutcome = z.infer<typeof loopOutcome>;

/**
 * That a drill-down Loop opened, and that it closed (#28) — the pair of records that brackets every
 * record written inside it, each of which carries this loop's `loopId` in its own header.
 *
 * `loopId` is required here where it is optional on every other record, because a `loop` record *is*
 * about a Loop: it is the record's subject and its header at once. `nodeId` is the Explore node that
 * opened it and `name` the name the pack declares it under, both written on the pair rather than
 * looked up in a pack later, because a Run must stay readable when the pack it ran has moved on.
 *
 * `outcome` and `generations` are on the `closed` record alone: what a Loop came to and how many
 * Generations it took to get there are not known when it opens, and a key that stood empty until
 * then would be a fact this ledger claimed before it had it.
 *
 * A Run cancelled inside a Loop has an `opened` with no `closed`, and that is the record: the Loop
 * really was left open, and the Run's own `cancelled` is the last word on it.
 */
export const loopRecord = z
  .object({
    ...base,
    type: z.literal('loop'),
    loopId: z.string().min(1),
    /** The Explore node whose `opens:` this Loop is. */
    nodeId: z.string(),
    /** The name the pack declares this Loop under, in `graph.yml`'s `loops:`. */
    name: z.string(),
    event: z.enum(['opened', 'closed']),
    outcome: loopOutcome.optional(),
    /** How many Generations the Loop ran, counted from one. */
    generations: z.number().int().positive().optional(),
  })
  .superRefine((r, ctx) => {
    for (const key of ['outcome', 'generations'] as const) {
      if (r.event !== 'closed' && r[key] !== undefined) {
        ctx.addIssue({ code: 'custom', message: `${key} is written only when a loop closes`, path: [key] });
      }
      if (r.event === 'closed' && r[key] === undefined) {
        ctx.addIssue({ code: 'custom', message: `${key} is required when a loop closes`, path: [key] });
      }
    }
  });

/**
 * One file of the Campaign's technical report, as the Site holds it (#30): where it is, what it
 * hashes to, and how big it is.
 *
 * The hash is the whole point of recording a file at all. The report lives on the Site, beside the
 * results, where the Site owner keeps it and where nothing in this harness will read it again unless
 * somebody asks (D44, D19) — so what the ledger keeps is not the report but the fact that this Run
 * wrote *this* report: a reader that fetches the file back holds it against this hash and knows
 * whether what it is reading is what the Campaign wrote.
 *
 * `bytes` beside the hash for the reason an observation carries both: a length is what a person
 * reads to know whether a file is a report or an empty one, and a hash tells them nothing until they
 * have the file.
 */
export const experienceFile = z.strictObject({
  /** The absolute path on the Site, as the Permit resolved it. */
  path: z.string().min(1),
  sha256: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type ExperienceFile = z.infer<typeof experienceFile>;

/**
 * That this Run's technical report was written, and where (#30): the Markdown people read and the
 * JSON machines read, each with its hash.
 *
 * Written once per Run, when the Run ends however it ends, and never again — which is what makes it
 * the idempotence of `writeExperience`: a Run that carries this record has its report, and a host
 * picking such a Run up leaves the Site alone. A Run whose ending landed and whose report did not is
 * a Run without this record, and the next boot's reconciliation is what finishes it.
 *
 * `writtenAt` beside the header's own `at` for the reason `workspaceRecord` carries `preparedAt`:
 * `at` is when this ledger appended the record, and this is the instant the report itself states —
 * the one written *inside* both files. They differ by however long the Site took, and a face that
 * re-renders the report from the run view has to compose the same instant the file carries or it
 * would render a report that differs from the one on the Site by one line.
 */
export const experienceRecord = z.object({
  ...base,
  type: z.literal('experience'),
  /** The instant both files state as their own; the header's `at` is when this record was appended. */
  writtenAt: z.string(),
  markdown: experienceFile,
  json: experienceFile,
});

/** One Pack-local byte in a completed Run asset delivery. */
export const archiveMaterial = z.strictObject({
  path: z.string().min(1), source: z.string().min(1), recordId: z.string().min(1).optional(), type: z.enum(['experience', 'observation', 'code', 'knowledge']).optional(), sha256: sha256Hex,
  bytes: z.number().int().nonnegative(), required: z.boolean(), missingReason: z.string().min(1).optional(),
});
/** The delivery lifecycle is separate from Run execution: only `complete` asserts offline bytes exist. */
export const archiveRecord = z.object({
  ...base,
  type: z.literal('archive'),
  delivery: z.enum(['pending', 'complete', 'failed']),
  directory: z.string().min(1),
  manifestSha256: sha256Hex.optional(),
  materials: z.array(archiveMaterial),
  reason: z.string().min(1).optional(),
});

/** How a Model moment ended (#59): the turn ran, the turn failed, or the host went away mid-moment. */
export const momentOutcome = z.enum(['completed', 'failed', 'interrupted']);
export type MomentOutcome = z.infer<typeof momentOutcome>;

/**
 * That a Model moment opened, and that it closed (#59) — the pair of records that brackets one
 * isolated model session, as the `loop` pair brackets a nested Loop.
 *
 * A moment is the one thing in this harness that a model takes part in, so what the pair says is
 * what an auditor of a Campaign has to be able to ask: which purpose the session was composed for
 * (`preset`), which session it was (`sessionId`, dsh's own id, so the session log on this machine
 * can be found from the ledger alone), which model answered (`model`, read off the session and never
 * assumed), where in the graph it happened (`nodeId` and `attempt`, with the Generation on the
 * header as on every record), and what the model could reach (`tools`, the names dsh itself reports
 * for that session's scope — a claim about the session and not about what a caller meant to give
 * it).
 *
 * `tools` is on the `opened` record alone and `outcome` on the `closed` one, and the schema below
 * says so: what a session could reach is settled when it is composed, and how it ended is not known
 * until it ends. A key standing empty until then would be a fact this ledger claimed before it had
 * it — the rule `loopRecord` states for `outcome` and `generations`.
 *
 * An `opened` with no `closed` is a host that went away with a moment open. It is not left that way:
 * the next boot's reconciliation appends the one `closed` it is missing, `interrupted`, and the
 * moment is opened again as the next attempt at that node.
 */
export const sessionRecord = z
  .object({
    ...base,
    type: z.literal('session'),
    event: z.enum(['opened', 'closed']),
    /** The purpose this session was composed for: the Hima agent preset it was mounted from. */
    preset: z.string().min(1),
    /** dsh's own session id, which is also the agent's: what finds this session's log on this machine. */
    sessionId: z.string().min(1),
    /** The model that answered, read off the session dsh composed and never off a configuration. */
    model: z.string().min(1),
    /** The node this moment belongs to, and which attempt at it. */
    nodeId: z.string().min(1),
    attempt: z.number().int().positive(),
    /** Every tool the session could reach, as dsh reports them for that session's own scope. */
    tools: z.array(z.string()).optional(),
    /**
     * **The workshop this moment was opened for** (#62), on the `opened` record alone: which workshop
     * of the pack's contract, the one file of it the fabric runs, and where that file is on the Site.
     *
     * Here rather than looked up in the pack folder, because this is what makes a workshop readable
     * off the ledger alone. Which node of a graph opens a workshop, and which file of it runs, are
     * two facts a Run's own records otherwise never carry — a `code` record names the workshop only
     * once something has been written, and nothing anywhere names the entry. A face that resolved
     * them by loading the pack would show nothing at all for a pack since uninstalled or edited into
     * something that will not load, which is exactly the Campaign whose card a person most needs.
     *
     * Nested and strict, as `reading` and `workshop` are on a Job: the pair is one fact about one
     * moment, and a record carrying half of it would name a workshop whose entry nothing could say.
     * A moment opened for anything else — the `/hima/api/runs/<id>/moment` route's own — carries none.
     */
    workshop: z.strictObject({
      id: ledgerSlug,
      entry: z.string().min(1),
      /**
       * The entry's own absolute path on the Site: `<the resolved workshop root>/<entry>`, the path
       * the turn launches on.
       *
       * Here because the fold that says whether the entry was written has no other way to ask the
       * question the turn asks. The turn holds a `code` record's `path` against this exact string;
       * a face left with the file *name* alone can only compare name to name, and `sub/miner.sh` is
       * then a moment that "wrote the entry" while the turn correctly finds none and fails the
       * attempt — two answers to one question. Deriving the root from the `code` records' own common
       * directory does not close it either: a moment that wrote nothing but `sub/miner.sh` has that
       * subdirectory as its common directory, and the namesake passes again. So the path is written
       * down where it is known, by the one thing that knows it.
       */
      entryPath: absoluteSitePath,
    }).optional(),
    outcome: momentOutcome.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.event !== 'opened' && r.tools !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'tools are written where a session is composed; only an opened moment says what it could reach', path: ['tools'] });
    }
    if (r.event === 'opened' && r.tools === undefined) {
      ctx.addIssue({ code: 'custom', message: 'tools are required when a moment opens; a session with none says so with an empty list', path: ['tools'] });
    }
    if (r.event !== 'opened' && r.workshop !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'the workshop a moment was opened for is written where it is composed; only an opened moment says which one it is', path: ['workshop'] });
    }
    if (r.event !== 'closed' && r.outcome !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'outcome is written only when a moment closes', path: ['outcome'] });
    }
    if (r.event === 'closed' && r.outcome === undefined) {
      ctx.addIssue({ code: 'custom', message: 'outcome is required when a moment closes', path: ['outcome'] });
    }
  });

/**
 * One file a Model moment wrote inside its workshop (#62): where it landed on the Site, what it
 * hashes to, how big it is, what the pack calls the language it is in, and the node, attempt and
 * session that wrote it.
 *
 * **Written after the bytes are on the Site and never before**, exactly as the `experience` record
 * is: this record is the claim that the file is there, and a claim written first would survive a
 * channel that failed between the two. A write the Permit or the containment rule refused writes no
 * record of this kind at all — it writes a `refusal`, which is where every other thing this harness
 * was not allowed to do is written.
 *
 * `sessionId` is what makes the pair of `session` records and this one readable as one act: a moment
 * opened, these files were written in it, and it closed. Nothing here says what the file *contains* —
 * that is on the Site, where a person and the Job both read it — and the hash is what says the file
 * on the Site is still the file that was written.
 *
 * Strict, because every field of it is settled at the moment it is written and a key this ledger did
 * not mean to store is a fault rather than a field to keep.
 */
export const codeRecord = z.strictObject({
  retainedPath: z.string().optional(),
  ...base,
  ...inBranch,
  type: z.literal('code'),
  nodeId: z.string().min(1),
  attempt: z.number().int().positive(),
  /** dsh's own session id of the Model moment that wrote it; the `session` pair carries the same one. */
  sessionId: z.string().min(1),
  /** The workshop it was written in, as the contract declares it. */
  workshop: ledgerSlug,
  /** Where it is on the Site: the absolute path the Permit resolved. */
  path: absoluteSitePath,
  sha256: sha256Hex,
  bytes: z.number().int().nonnegative(),
  /** What the pack calls the language of every file of this workshop. */
  language: ledgerSlug,
});

/**
 * A Pack knowledge file an Agent actually read while working one node.  This is deliberately not a
 * declaration: a Pack may offer many files, but only a successful tool read is evidence that its
 * contents reached the Agent.  The byte identity is held here so later views never call a changed
 * file the knowledge that was used.
 */
export const knowledgeRecord = z.strictObject({
  ...base,
  ...inBranch,
  type: z.literal('knowledge'),
  nodeId: z.string().min(1),
  attempt: z.number().int().positive(),
  sessionId: z.string().min(1),
  workshop: ledgerSlug,
  file: z.string().min(1),
  purpose: z.string().min(1),
  path: z.string().min(1),
  sha256: sha256Hex,
  bytes: z.number().int().nonnegative(),
});

/** Source-linked interpretation is never a Judge verdict or a measured observation. */
export const researchAnalysis = z.strictObject({
  question: z.string().min(1).max(4000),
  hypotheses: z.array(z.string().min(1).max(4000)).max(16),
  comparisons: z.array(z.string().min(1).max(4000)).max(16),
  limitations: z.array(z.string().min(1).max(4000)).min(1).max(16),
  nextExperiments: z.array(z.string().min(1).max(4000)).min(1).max(16),
  claims: z.array(z.strictObject({
    text: z.string().min(1).max(4000), cites: z.array(z.string().min(1)).min(1).max(32),
    measurements: z.array(z.strictObject({ recordId: z.string().min(1), field: z.string().min(1), value: z.number().finite(), unit: z.string().optional() })).max(32),
  })).max(32),
});
export type ResearchAnalysis = z.infer<typeof researchAnalysis>;
const analysisRecord = z.object({ ...base, type: z.literal('analysis'), sessionId: z.string(), nodeId: z.string(),
  requestId: z.string(), requestDigest: sha256Hex, analysis: researchAnalysis });

/** Proposal, admission and lifecycle facts for one additive per-Run research branch (PLS-10).
 * The proposal is JSON here because PackNode is owned by packs.ts, which already depends on Ledger
 * record vocabulary. Fabric parses this field through `growthProposal` before accepting or using it. */
export const growthRecord = z.strictObject({
  ...base,
  type: z.literal('growth'),
  proposalId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  proposalDigest: sha256Hex,
  event: z.enum(['proposed', 'accepted', 'rejected', 'started', 'completed', 'failed', 'cancelled', 'abandoned', 'returned']),
  proposal: z.json().optional(),
  proposalRecordId: z.string().optional(),
  parentNode: z.string().optional(),
  entry: z.string().optional(),
  returnNode: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  optional: z.boolean().optional(),
  reason: z.string().optional(),
  evidence: z.array(z.string()).optional(),
});

/** One accepted change to mutable Campaign material, and the validity boundary it creates (PLS-11).
 * The changed bytes live in the Campaign workspace and its immutable `.hima/revisions` store; this
 * record is the append-only index that tells later readers which historical facts remain current. */
export const revisionRecord = z.strictObject({
  ...base,
  type: z.literal('revision'),
  revisionId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  version: z.number().int().positive(),
  event: z.enum(['proposed', 'applied', 'refused']),
  proposalDigest: sha256Hex,
  proposal: z.json().optional(),
  reason: z.string().optional(),
  methodIdentity: sha256Hex,
  sourceIdentity: sha256Hex,
  inputIdentity: sha256Hex,
  environmentIdentity: sha256Hex,
  changedNodes: z.array(z.string()),
  affectedNodes: z.array(z.string()),
  assets: z.array(z.strictObject({
    nodeId: z.string(), scope: z.enum(['workshop', 'workspace']), logicalPath: z.string(),
    path: absoluteSitePath, beforeVersionPath: absoluteSitePath, afterVersionPath: absoluteSitePath,
    beforeSha256: sha256Hex, afterSha256: sha256Hex, bytes: z.number().int().nonnegative(),
  })).optional(),
  invalidates: z.array(z.string()).optional(),
  reuses: z.array(z.string()).optional(),
  supersedes: z.string().optional(),
});

export const ledgerRecord = z.discriminatedUnion('type', [
  observationRecord,
  refusalRecord,
  verdictRecord,
  jobRecord,
  workspaceRecord,
  nodeRecord,
  blockerRecord,
  resumedRecord,
  decisionRecord,
  cancelRecord,
  loopRecord,
  experienceRecord,
  archiveRecord,
  analysisRecord,
  sessionRecord,
  codeRecord,
  knowledgeRecord,
  growthRecord,
  revisionRecord,
]);
export type ObservationRecord = z.infer<typeof observationRecord>;
export type RefusalRecord = z.infer<typeof refusalRecord>;
export type VerdictRecord = z.infer<typeof verdictRecord>;
export type JobRecord = z.infer<typeof jobRecord>;
export type WorkspaceRecord = z.infer<typeof workspaceRecord>;
export type NodeRecord = z.infer<typeof nodeRecord>;
export type BlockerRecord = z.infer<typeof blockerRecord>;
export type ResumedRecord = z.infer<typeof resumedRecord>;
export type DecisionRecord = z.infer<typeof decisionRecord>;
export type CancelRecord = z.infer<typeof cancelRecord>;
export type LoopRecord = z.infer<typeof loopRecord>;
export type ExperienceRecord = z.infer<typeof experienceRecord>;
export type ArchiveRecord = z.infer<typeof archiveRecord>;
export type AnalysisRecord = z.infer<typeof analysisRecord>;
export type SessionRecord = z.infer<typeof sessionRecord>;
export type CodeRecord = z.infer<typeof codeRecord>;
export type KnowledgeRecord = z.infer<typeof knowledgeRecord>;
export type GrowthRecord = z.infer<typeof growthRecord>;
export type RevisionRecord = z.infer<typeof revisionRecord>;
export type LedgerRecord = z.infer<typeof ledgerRecord>;

/** What a caller states about a verdict; the ledger owns identity, sequence, time, and writer. */
export type VerdictData = Omit<VerdictRecord, keyof typeof base | 'type'>;

/**
 * What a caller states about a `loop` record. Every other appender's data is the record minus the
 * whole header; this one keeps `loopId`, because on a `loop` record that field is not the header's
 * stamp but the record's own subject — which Loop opened, and which one closed.
 */
export type LoopData = Omit<LoopRecord, keyof typeof base | 'type'> & Pick<LoopRecord, 'loopId'>;

/** Module-private: only this file can mint a VerdictWriter, so the capability cannot be forged. */
const mintedByLedger = Symbol('hima.ledger.verdictWriter');

/**
 * The capability to append verdict records. A Ledger mints exactly one and hands it out at most
 * once, to HimaJudge; the executor, the observe operation, the command face, and the tool face
 * never hold it, so none of them can write a verdict. D7.
 */
export class VerdictWriter {
  readonly #append: (runId: string, data: VerdictData) => Promise<VerdictRecord>;

  constructor(minted: symbol, append: (runId: string, data: VerdictData) => Promise<VerdictRecord>) {
    if (minted !== mintedByLedger) throw new Error('a VerdictWriter is minted by the Ledger alone');
    this.#append = append;
  }

  appendVerdict(runId: string, data: VerdictData): Promise<VerdictRecord> {
    return this.#append(runId, data);
  }
}

/**
 * Where a Run stands. `running` is the engine's to advance; `waiting` needs a person (a Wait node,
 * or a failure the harness cannot clear on its own); the four `ended-` states and `cancelled` are
 * final. A Run that HimaFabric never started — an observation's own Probe-campaign Run — has no
 * status at all, which is how the ledger says so rather than inventing a seventh word for it.
 *
 * `ended-converged` is a Loop that stopped exploring because it had stopped learning: the Goal was
 * not met, and successive generations moved the measured value by less than the pack's band. It is
 * its own ending rather than `ended-goal-not-met` because the two say different things to whoever
 * reads the Run — one is "this is the tightest this flow closes", the other "there is a next
 * strategy nobody tried".
 */
export const runStatus = z.enum(['running', 'waiting', 'cancelled', 'ended-goal-met', 'ended-goal-not-met', 'ended-converged', 'ended-budget-exhausted']);
export type RunStatus = z.infer<typeof runStatus>;

/** A Campaign's allowances on the meters tied to the design and the Site (D4). Never tokens or money. */
export const runBudget = z.strictObject({
  timeBoxMs: z.number().int().positive(),
  /** Attempts a node may make, since it was last resumed, before its failure becomes a Hard blocker. */
  retryAllowance: z.number().int().nonnegative(),
  /** The Site's declared parallel job count, copied at start: the cap a launch is counted against. */
  jobCap: z.number().int().positive(),
  /**
   * The Site's declared licence seats, copied at start beside the job cap and for the same reason: a
   * Run is held to what the Site declared when it started, whatever the site file says later. A
   * launch is counted against these exactly as it is against `jobCap` — the two are the slots of one
   * cap — and a licence absent here is one this Site declares none of, never one without a bound.
   */
  licences: z.record(licenceName, z.number().int().nonnegative()).default({}),
  /**
   * How many Generations this Campaign's Loop may open (CONTEXT.md, Generation). A meter of the
   * Budget and not a convergence: convergence is what the exploration learned, this is what the
   * Campaign was allowed. Copied at start from the request, the pack's `converge.generationLimit`,
   * or the harness default, so a Run says what it was allowed whatever the pack says later.
   *
   * Required, not optional: every Run HimaFabric starts has one, and a Budget without it would be a
   * Loop nothing bounds — which is the one thing a Budget exists to prevent.
   */
  generationLimit: z.number().int().positive(),
});
export type RunBudget = z.infer<typeof runBudget>;

/**
 * The drill-down Loop this Run is inside, while it is inside one (#28): which Loop, the Explore node
 * that opened it, and which Generation *of that Loop* the Run is in.
 *
 * The Run's position, and the whole of it: `currentNode` says which node, this says which graph that
 * node is being run in and which turn of it. A host that picks this Run up rebuilds where it stands
 * from these two fields and nothing else, exactly as it rebuilds everything else about a Run from
 * the row and the records.
 *
 * `generation` is the Loop's own counter and not the Run's. The row's `generation` above goes on
 * saying which Generation of the *outer* Loop the Campaign is in — the Budget's generation limit
 * bounds that one, and the Loop's own `converge.generationLimit` bounds this one — and it is this
 * number the ledger stamps records with while the Loop is open, because a record written inside a
 * Loop belongs to a turn of that Loop.
 *
 * Absent on a Run standing in its own graph, which is how this ledger says every absent fact.
 */
export const runLoop = z.strictObject({
  id: z.string().min(1),
  /** The Explore node whose `opens:` this is; where the Run stands again once the Loop closes. */
  nodeId: z.string(),
  name: z.string(),
  generation: z.number().int().positive(),
});
export type RunLoop = z.infer<typeof runLoop>;

/**
 * Where one branch of an open fork stands (#29): which of its act nodes it is at, and what it is
 * doing there.
 *
 * The four words a branch can be in, and no more. `running` is a branch this drive is advancing;
 * `waiting-for-slot` is one whose next Job is queued behind the Site's parallel job cap or one of
 * its licences, which is a different thing to a person watching a fork than a Job that is slow — on
 * a Site with one slot it is what every branch but the first is doing; `done` is a branch that
 * reached the join; `blocked` is one whose Retry allowance is spent, which blocks that branch and
 * not the others.
 *
 * They are deliberately the node states a branch can actually be in and not a set of their own: a
 * branch is a little chain of act nodes, so what a branch is doing is what its current node is
 * doing, and two vocabularies for that would be two answers.
 */
export const runBranch = z.strictObject({
  currentNode: z.string(),
  state: z.enum(['running', 'waiting-for-slot', 'done', 'blocked']),
});
export type RunBranch = z.infer<typeof runBranch>;

/**
 * The fork this Run is inside, while it is inside one (#29): the node whose several unlabelled edges
 * opened it, the judge node every branch converges into, and where each branch stands.
 *
 * The Run's position again, and the whole of it, exactly as `loop` is: `currentNode` is the join for
 * as long as the fork is open — that is where the Run is going and the one place it can be said to
 * be — and this says which branches are still on their way there. A host that picks the Run up
 * rebuilds the whole fork from these two fields and the records, and re-enters every branch.
 *
 * Keyed by branch id, which is the id of the branch's first node: a branch is the chain of act nodes
 * from one of the fork's edges to the join, and the node that edge leads to names it. Minting an id
 * would be a second name for something the graph already names, and a name a person reading
 * `graph.yml` could not find.
 *
 * Absent on a Run standing anywhere else, which is how this ledger says every absent fact.
 */
export const runFork = z.strictObject({
  /** The node whose unlabelled edges branched. Where the Run stood when the fork opened. */
  from: z.string(),
  /** The judge node every branch of this fork converges into, and where `currentNode` stands. */
  join: z.string(),
  branches: z.record(z.string(), runBranch),
});
export type RunFork = z.infer<typeof runFork>;

/**
 * What this Run has spent. `endedBy` names what ended it, on a Run something ended rather than the
 * graph: a spent meter, or a person's cancel. Its list grows as more meters are enforced. Neither
 * the job cap nor the Retry allowance nor a licence ends a Run: a spent allowance is a Hard blocker
 * a person clears, and a full Site — full of Jobs, or of one of the licences it declares — is
 * something to wait for.
 *
 * `waitedMs` is how much of `elapsedMs` the Run spent waiting on a person rather than running: the
 * time from each Hard blocker to the resume that cleared it. It is not a meter the Budget bounds —
 * it is what the time box is *widened* by, because the Budget meters the design and the EDA
 * environment and never the person (CONTEXT.md, Budget). A Run that has waited on nobody carries no
 * such key rather than a zero, the way every other absent fact in this ledger says so.
 */
export const runMeters = z.strictObject({
  elapsedMs: z.number().int().nonnegative(),
  jobsLaunched: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  waitedMs: z.number().int().nonnegative().optional(),
  /**
   * What this Run has spent of each licence, in licence-milliseconds: the seats a Job held times how
   * long it held them, summed over every Job of this Run that has settled. The Run's account of the
   * Site's scarcest meter, and the one number that says what a Campaign actually cost in seats
   * rather than in wall clock.
   *
   * Milliseconds and not minutes because every other duration this ledger keeps is milliseconds —
   * `elapsedMs`, `waitedMs`, the Budget's `timeBoxMs` — and one unit across a row is worth more than
   * a friendlier number on one line of it; a face spells it in whatever a person reads. A Run whose
   * Jobs held nothing carries no key rather than an empty map, as every absent fact here does.
   */
  licenceMs: z.record(licenceName, z.number().int().nonnegative()).optional(),
  /**
   * How long each Generation of this Run's Loop has taken, in milliseconds, oldest first: index 0 is
   * generation one. The Budget's account of where a Campaign's time box actually went — `elapsedMs`
   * says how much of it is spent, and this says on what.
   *
   * A list and not a total, because a Campaign explores generation by generation and the one number
   * a person watching it wants is whether this generation is taking longer than the last. It is the
   * span of each generation's own records, from its first to its last, and to now for the generation
   * a running Run is in, kept here as a meter so a face that is not showing the generations table
   * can still say where the box went.
   *
   * These are the generations of the *outer* Loop, the ones this row's own `generation` counts, and
   * one of them spans everything that happened while it was the outer generation — a drill-down
   * Loop's records among them, though those carry that Loop's generation in their own headers
   * (#28). So a Campaign's time is accounted for once, at the depth a person reads it at, and the
   * nested rows of the run view are where the same time is broken down further.
   *
   * The generation *count* is not here: that is the run row's own `generation`, and a second counter
   * beside it would be a second answer to one question. A Run that has opened no generation — one no
   * fabric started — carries no key rather than an empty list, as every absent fact here does.
   */
  generationMs: z.array(z.number().int().nonnegative()).optional(),
  endedBy: z.enum(['time-box', 'generation-limit', 'cancel']).optional(),
});
export type RunMeters = z.infer<typeof runMeters>;

/**
 * Has a Run in this status ended? The two ways one can: a person's cancel, and the graph or a spent
 * meter running it out. `running` and `waiting` are the two that have not.
 *
 * Exported because every face has to answer the same question — `/hima run` and `/hima resume` call a
 * Run that ended a success whichever way it ended, and the acceptance script gates the hosts it boots
 * on it — and a status added here must move all of them at once, which it cannot do if each of them
 * spells the test out again.
 */
export const hasEnded = (status: RunStatus | undefined): boolean => status === 'cancelled' || status?.startsWith('ended-') === true;

/**
 * The licence meters of two writes of one Run, taken licence by licence the way every other counter
 * here is taken: the further of the two answers, never the later of the two writes. A licence only
 * one of them names is that one's, because a meter this write knew nothing of is not a meter that
 * went back to nothing.
 */
const furtherLicenceMs = (held: RunMeters['licenceMs'], written: RunMeters['licenceMs']): RunMeters['licenceMs'] => {
  if (held === undefined) return written;
  if (written === undefined) return held;
  const merged: Record<string, number> = { ...held };
  for (const [name, ms] of Object.entries(written)) merged[name] = Math.max(merged[name] ?? 0, ms);
  return merged;
};

/**
 * The per-generation times of two writes of one Run, taken generation by generation the way every
 * other counter here is taken: the further of the two answers, element by element, never the later
 * of the two writes. A generation only one of them has an entry for is that one's, because a
 * generation this write knew nothing of is not a generation that took no time.
 */
const furtherGenerationMs = (held: RunMeters['generationMs'], written: RunMeters['generationMs']): RunMeters['generationMs'] => {
  if (held === undefined) return written;
  if (written === undefined) return held;
  const merged: number[] = [];
  for (let i = 0; i < Math.max(held.length, written.length); i += 1) merged.push(Math.max(held[i] ?? 0, written[i] ?? 0));
  return merged;
};

/**
 * The meters as they stand once a write of them lands, held against what the row already says and
 * the status that write leaves the Run in.
 *
 * A caller composes a whole `RunMeters` out of a Run it read a moment earlier, and two faces can be
 * writing one Run at once: a `/hima cancel` composing its ending while the drive it interrupted is
 * still counting the Job it had just launched. Whichever of those two writes lands second was
 * computed from a row that had already moved, so each meter is taken from the further of the two
 * answers rather than from the later of the two writes. The counters say what has happened, and what
 * has happened does not un-happen. `waitedMs` is one of them: a derived counter, taken the same way,
 * so that a drive counting a Job cannot roll back the wait a resume just closed. It is absent on a
 * Run that has waited on nobody, so the further of the two answers is the larger where both name
 * one, and the one that is named where only one does — never a zero standing in for no wait at all.
 *
 * `endedBy` is not a counter, and follows the status instead: it names what ended a Run, so it is
 * kept only while the Run has ended. A write that is only counting cannot unsay it — such a write
 * states no status, and the row's own is what decides. But a Run *moved back* to `running` or
 * `waiting` has not ended, and its `endedBy` goes with the ending it named. That is a live path, not
 * a hypothetical: a cancel whose kill did not take ends nothing, and the loop holding the Job moves
 * the Run to `waiting` for a person, which must not leave a waiting Run saying a cancel ended it —
 * nor, once such a Run is resumed (#15) and runs to its own end, leave `cancel` standing next to the
 * status the graph gave it.
 */
const movedOn = (held: RunMeters | undefined, written: RunMeters, status: RunStatus | undefined, count: MeterCount | undefined): RunMeters => {
  const waited = Math.max(held?.waitedMs ?? -1, written.waitedMs ?? -1);
  const licences = furtherLicenceMs(held?.licenceMs, written.licenceMs);
  const generations = furtherGenerationMs(held?.generationMs, written.generationMs);
  const moved: RunMeters = held === undefined ? written : {
    elapsedMs: Math.max(held.elapsedMs, written.elapsedMs),
    jobsLaunched: Math.max(held.jobsLaunched, written.jobsLaunched),
    attempts: Math.max(held.attempts, written.attempts),
    ...(waited < 0 ? {} : { waitedMs: waited }),
    ...(licences === undefined ? {} : { licenceMs: licences }),
    ...(generations === undefined ? {} : { generationMs: generations }),
  };
  // And then what this write is *counting*, added to the row as it is being written (#29). The two
  // halves are deliberately different: everything above is a whole meter recomputed from the records,
  // so the further of two answers is the true one; a count is an event that happened once, so it is
  // added to whatever the row already holds and never composed against a copy a caller read earlier.
  const counted: RunMeters = count === undefined ? moved : {
    ...moved,
    jobsLaunched: moved.jobsLaunched + (count.jobs ?? 0),
    attempts: moved.attempts + (count.attempts ?? 0),
  };
  // An absent key, never an undefined one, as everywhere else a record is composed.
  const ended = written.endedBy ?? held?.endedBy;
  const { endedBy: _dropped, ...counters } = counted;
  return ended === undefined || !hasEnded(status) ? counters : { ...counters, endedBy: ended };
};

/**
 * What one write of a Run's row **counts**: Jobs launched, attempts made — the two meters that say
 * how many times something happened rather than how much of something there now is (#27, #29).
 *
 * It is stated as a delta and applied inside `advanceRun`'s own update, and that is the whole point:
 * a fork's branches each launch a Job and each count it, and a caller that read the row, added one
 * and wrote the sum would have whichever of two branches read first lose the other's increment. The
 * ledger's own update is the one place that sees the row as it actually stands, so the composition
 * and the write are one turn there. Every other meter is recomputed from the records by `advance`
 * and merged by `movedOn`, which cannot lose anything by landing second.
 */
export interface MeterCount { readonly jobs?: number; readonly attempts?: number }

/**
 * A Run: what records belong to, and — once HimaFabric takes one over — the whole of its fabric
 * state. The engine holds nothing this record and the Run's records do not, so a later process
 * reading this row knows exactly what the previous one knew.
 *
 * `packId`, `goal`, `budget` and `firstStrategy` are written when the Run starts and never again: a
 * Run runs one pack, a Goal is immutable for the life of a Campaign (D3), so a new Goal is a new
 * Campaign, and what a Campaign was first set to is a fact about its start. `status`, `currentNode`,
 * `strategy`, `generation` and `meters` are what moves. All nine are absent on a Run no fabric
 * started.
 */
/**
 * A run id as this ledger mints one: `run-` and a UUID (`createRun`).
 *
 * Stated here, beside the call that mints them, because two other places have to *recognise* one
 * written down by a person or by a stage — the pack authoring pipeline's test record, whose `run:`
 * line names the Run a pack was tested by (#64), and the contract suite, which reads a run id off
 * the page's own run list. Unanchored, because both of those look for one inside a longer text; a
 * caller that wants the whole string to be one anchors it.
 */
export const runIdPattern = /run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * What a Run is for (#64): an ordinary Campaign, or the test run of a pack the authoring pipeline is
 * still carrying an author through.
 *
 * A fact about the Run and not about the pack, because the same pack folder is tested and then
 * released, and the Runs that tested it stay what they were. The pipeline's test stage marks its own
 * Run, and the test record of a pack rests on finding a Run marked this way.
 */
export const runPurpose = z.enum(['campaign', 'test']);
export type RunPurpose = z.infer<typeof runPurpose>;

/** Business ownership is durable Run state, obtained from the Host's actual conversation. */
export const launchIntent = z.strictObject({
  runId: z.string(), siteId: z.string(), job: jobIdentity.omit({ pid: true }),
  nodeId: z.string().optional(), branchId: z.string().optional(),
  licences: z.record(z.string(), z.number().int().nonnegative()).optional(),
  reading: launchedReading.optional(), workshop: launchedWorkshop.optional(), attempt: z.number().int().positive().optional(),
});
export const nodeExecution = z.strictObject({
  id: z.string(), nodeId: z.string(), kind: nodeKind,
  generation: z.number().int().positive(), loopId: z.string().optional(),
  loopGeneration: z.number().int().positive().optional(), branchId: z.string().optional(),
  attempt: z.number().int().positive(), methodDigest: sha256Hex, inputDigest: sha256Hex,
  phase: z.enum(['begun', 'working', 'ready', 'completed', 'failed', 'uncertain']),
  inputThroughSeq: z.number().int().nonnegative().optional(),
  humanClearance: z.strictObject({ actor: z.string().min(1), requestId: z.string().min(1) }).optional(),
  workshop: z.strictObject({ id: z.string(), entry: z.string(), entryPath: z.string(), directory: z.string() }).optional(),
  intent: launchIntent.optional(), jobSession: z.string().optional(),
  result: z.strictObject({
    kind: z.enum(['settled', 'blocked', 'retrying', 'hard-blocker', 'budget-exhausted', 'moved', 'stopped', 'pending', 'at-cap']),
    outcome: verdictOutcome.optional(), session: z.string().optional(), reason: z.string().optional(),
  }).optional(),
  reason: z.string().optional(),
  /** The applied revision that made this historical execution no longer current. */
  supersededBy: z.string().optional(),
});
export type NodeExecution = z.infer<typeof nodeExecution>;
export const executionReceipt = z.strictObject({
  requestId: z.string(), action: z.string(), executionId: z.string().optional(),
  owner: z.string().optional(), epoch: z.number().int().positive().optional(),
  data: z.json().optional(),
  stop: z.enum(['cancelled', 'not-stopped']).optional(), reason: z.string().optional(), session: z.string().optional(),
});
export type ExecutionReceipt = z.infer<typeof executionReceipt>;
export const executionRequest = z.strictObject({
  digest: sha256Hex, actor: z.string(), epoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(), at: z.string(),
  state: z.enum(['admitted', 'done', 'uncertain']), receipt: executionReceipt,
  origin: z.enum(['agent', 'human']).optional(),
});
export const runControl = z.strictObject({
  mode: z.literal('agent'),
  owner: z.string().min(1),
  epoch: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  paused: z.array(z.string()),
  stop: z.strictObject({ reason: z.enum(['cancel', 'budget']), requestId: z.string().optional(),
    status: z.enum(['requested', 'confirmed', 'uncertain']).optional(), detail: z.string().optional(), session: z.string().optional(),
  }).optional(),
  executions: z.record(z.string(), nodeExecution),
  requests: z.record(z.string(), executionRequest),
  siteDigest: sha256Hex.optional(),
  /** A new verification of old records, never a fabricated historical workspace digest. */
  adoption: z.strictObject({
    at: z.string(), workspaceSeq: z.number().int().positive(), workspaceMetadataSha256: sha256Hex,
    methodDigest: sha256Hex, legacyWaitedMs: z.number().int().nonnegative(),
  }).optional(),
});
export type RunControl = z.infer<typeof runControl>;

export const runRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  siteId: z.string(),
  createdAt: z.string(),
  nextSeq: z.number().int().positive(),
  control: runControl.optional(),
  status: runStatus.optional(),
  /**
   * The pack this Run runs. Recorded on the row itself, and not only on the workspace record the
   * preparation writes, because a reconciliation after a restart must be able to say what a Run was
   * for even when it never got as far as a workspace — which is exactly the Run that needs saying.
   */
  packId: z.string().optional(),
  /**
   * What this Run is for (#64): an ordinary Campaign, or the test run the pipeline's test stage
   * opened to write a pack's test record from.
   *
   * Optional, and an absent value reads `campaign`: every Run written before this field existed was
   * an ordinary Campaign, and a row that says nothing is not thereby a test of anything. Written when
   * the Run is opened and never again — what a Run was for is a fact about its start, exactly as its
   * Goal and its Budget are.
   */
  purpose: runPurpose.optional(),
  /**
   * What the pack folder hashed to when this Run started (#64): the digest over every regular file in
   * it but the pipeline's own records (`hashPackFiles`).
   *
   * On the row because a pack folder is plain files a person edits, and "which files did this
   * Campaign actually run" is otherwise unanswerable a day later — the pack id and its declared
   * version both stay the same when a rule is corrected. The test record rests on exactly this: a
   * folder whose digest no longer matches the Run its record names has not been tested as it now
   * stands.
   *
   * Optional for the reason `purpose` is: a row written before this field existed recorded no digest,
   * and a check that treated an absent one as a match would pass every old Run. A sha256 and not any
   * string: the whole of what the test record rests on is this value being comparable, and a row
   * carrying something that is not a digest would be a Run nothing could ever be held against.
   */
  packDigest: sha256Hex.optional(),
  /** The Goal as bound parameters: `declared_parameter` for the first pack. Typed, checkable, fixed (D3). */
  goal: z.record(z.string(), z.number()).optional(),
  budget: runBudget.optional(),
  currentNode: z.string().optional(),
  strategy: runStrategy.optional(),
  /**
   * The Strategy this Run was started with, written once by the call that opens the row and never
   * again — the only part of this row that is a fact about the Campaign's start rather than about
   * where it stands.
   *
   * `strategy` above is what the Run is set to *now*, and the row keeps no history of itself: a
   * revisit overwrites it with the Strategy the decision chose, and a Run that ends without meeting
   * its Goal ends carrying the Strategy it would have tried next. So what a person filled the start
   * form in with stopped being recoverable the moment the first decision was acted on — and it is
   * what generation one's row of the generations table says that generation asked the flow for.
   * This is that Strategy, kept where nothing can move it: `RunProgress` does not name this field,
   * so no advance of a Run can write it.
   *
   * Optional for the reason every other fabric field is: a Run no fabric started was set to nothing.
   */
  firstStrategy: runStrategy.optional(),
  /**
   * Which Generation of its Loop this Run is in, counted from one: set to 1 when HimaFabric starts
   * the Run, and incremented by the one write that follows a revisit edge. Absent on a Run no fabric
   * started, which is also why every record's own `generation` is optional — the ledger stamps each
   * record from this field, and a Run that has none writes records that have none.
   */
  generation: z.number().int().positive().optional(),
  /** The drill-down Loop the Run is inside, while it is inside one (#28); absent while it is not. */
  loop: runLoop.optional(),
  /** The fork the Run is inside, while it is inside one (#29); absent while it is not. */
  fork: runFork.optional(),
  meters: runMeters.optional(),
});
export type RunRecord = z.infer<typeof runRecord>;

/** What a caller states about a Run when it opens one; the ledger owns the id, the time, and the sequence.
 *  Not `loop`: a Run opens in its pack's own graph, and drills down only once an Explore node says so. */
export type RunOpening = Pick<RunRecord, 'campaignId' | 'siteId'> & Partial<Pick<RunRecord, 'status' | 'packId' | 'purpose' | 'packDigest' | 'goal' | 'budget' | 'currentNode' | 'strategy' | 'firstStrategy' | 'generation' | 'meters' | 'control'>>;

/** What HimaFabric may change about a Run as it moves. Never its identity, its Goal, its Budget, the
 *  Strategy it started with, or its sequence — a field this type does not name is one no advance can
 *  write, which is what keeps `firstStrategy` the start's own number for the life of the Run.
 *
 *  `loop` is the one field an advance can *unset*, and `null` is how it says so. Every other field
 *  here is either stated or left alone, because a Run always has one of each; a Loop is the only
 *  thing a Run stops being inside, and this ledger writes an absent fact as an absent key rather
 *  than as a key holding nothing — so "the loop closed" has to be said by something, and it is said
 *  by the one value a stored row can never hold. `fork` is the second such field and says it the
 *  same way, for the same reason: a fork is the other thing a Run stops being inside.
 *
 *  `branch` is not a field of the row at all — it is one branch's move, merged into `fork.branches`
 *  by key inside the one write below. Branches run at once and each of them moves on its own, so a
 *  branch that stated the whole `fork` would be stating where the *other* branches stood a moment
 *  ago, and whichever of two branches wrote second would put the first one back. */
export type RunProgress = Partial<Pick<RunRecord, 'status' | 'currentNode' | 'strategy' | 'generation' | 'meters' | 'control'>> & {
  readonly loop?: RunLoop | null;
  readonly fork?: RunFork | null;
  readonly branch?: { readonly id: string } & RunBranch;
  /**
   * What this write counts, added to the row's own meters inside the update below (`MeterCount` says
   * why it is a delta and not a sum). Only meaningful beside `meters`, which is the only thing it
   * moves, and stated by `advance` alone.
   */
  readonly count?: MeterCount;
  /**
   * Write nothing at all unless the row still says `running` when this write's turn comes.
   *
   * `stillDriving` asks the same question before a caller composes a move, and that is not the same
   * question: between it and the write, another face's ending can be *queued ahead of this write on
   * the Run's own chain*, so the row a caller looked at said `running` and the row this write lands
   * on does not. The two writes a person would read as "and then it went on" past an ending they
   * asked for — a fork closing (#29), a drill-down Loop closing — ask it here instead, where the row
   * being written is the row being asked about.
   */
  readonly onlyWhileRunning?: true;
};

export const ledgerSpec = defineDomain({
  name: 'hima_ledger',
  // 5: the record union grew `blocker`, `resumed` and `cancel`; the node state grew
  // `waiting-for-slot` and `reconciled`; the writer grew `person`; and the run row carries the pack
  // it runs. (4 was `node` and `decision` and the fabric state on the run row.) 6: the meters grew
  // `waitedMs`, and `endedBy` grew `cancel` — either of which a version-5 spec would reject outright,
  // because `runMeters` is a strict object, so a row written here is unreadable there. A domain whose
  // stored version differs from its spec is rejected at open rather than migrated, and nothing
  // shipped holds an earlier ledger — step 2 is still being built and every ledger so far is the
  // contract suite's own, in throwaway homes — so no compatibility is declared and none is owed. The
  // next growth of any of these shapes bumps this again. 7: a `semanticValue` — and so every
  // observation's `values` — carries the optional `group` naming the path group a reader read it out
  // of. This one grows in the readable direction: `group` is optional, so an observation written
  // under 6 still parses here. It is the other direction that earns the bump. `semanticValue` is a
  // plain object, not a strict one, so a version-6 spec reading a ledger written here would not
  // refuse those observations — it would silently drop `group` from every one of them and hand back
  // values that no longer say which group they came from. A version gate exists to turn exactly that
  // into a refusal at open rather than a quiet loss, and #20 is a ticket about a number that was
  // wrong while looking like a measurement. 8: licences are metered (#21) — a `launched` job record
  // carries the seats it holds, the Budget carries the Site's declared counts, and the meters carry
  // `licenceMs`. `runBudget` and `runMeters` are both strict objects, so a row written here is
  // unreadable under 7, which is exactly what a version gate is for. 9: the Loop (#25). The run row
  // carries `generation` and every record's header carries the generation it was written in; the
  // status grew `ended-converged`; the Budget grew `generationLimit`; `endedBy` grew
  // `generation-limit`; and a decision's `chosen` grew its third arm, `converged`. Two of those
  // alone earn the bump in the direction a version gate exists for: `runBudget` and `runMeters` are
  // strict objects, so a row written here is unreadable under 8, and `decisionChoice` is a union of
  // strict objects, so a version-8 spec reading a converged decision would refuse the record
  // outright. The record header's `generation` is the readable direction — optional, so a record
  // written under 8 still parses here — and it is the same silent-loss case `group` was under 7: a
  // version-8 spec reading this ledger would drop the generation from every record and hand back a
  // Campaign whose generations could not be told apart. 10: the run row carries `firstStrategy`, the
  // Strategy a Run was opened with (#25b). The readable direction again — optional, and `runRecord`
  // is a plain object, so a row written under 9 still parses here — and the same silent loss `group`
  // was under 7 and the header's `generation` was under 9: a version-9 spec reading this ledger
  // would drop the field from every row and hand back Campaigns whose first generation could not say
  // what period it asked the flow for, which is the one number that generation's measurement is read
  // against. A version gate exists to make that a refusal at open rather than a quiet blank. 11:
  // two growths land in it together. The meters carry `generationMs`, how long each Generation of
  // the Loop took (#27), so a Campaign's time box can be read against where it actually went; and
  // drill-down (#28) grew the record union by `loop`, the pair that brackets a nested Loop, every
  // record's header by `loopId`, and the run row by `loop` — which Loop the Run is inside and which
  // Generation of it. Either alone earns the bump in the direction a version gate exists for:
  // `runMeters` is a strict object, so a row written here is refused outright under 10 — which is
  // the whole reason the per-generation time is a meter on the row rather than a fold a face
  // computes — and `ledgerRecord` is a discriminated union, so a version-10 spec reading this
  // ledger refuses a `loop` record outright, `loop` being none of its ten arms. The header's
  // `loopId` and the row's `loop` are the readable direction — both optional, both on plain
  // objects — and both are the same silent-loss case `group` was under 7 and the header's
  // `generation` under 9: a version-10 spec would hand back a Campaign whose nested records no
  // longer said which Loop they were written in, and a Run that no longer said it was inside one.
  // 12: fork and join (#29). The observation, verdict, job, node and blocker records carry the
  // `branchId` of the branch of a fork they were written inside, the `cancel` record carries
  // `jobSessions` — every Job it stopped, because a fork holds one per branch and one record has to
  // name them all — and the run row carries `fork`: which node branched, which judge node the
  // branches converge into, and where each branch stands.
  // Both are the readable direction — every one of those fields is optional, and each of the five
  // records is a plain object, as is `cancelRecord` — and all of them are the same silent-loss case
  // `group` was under 7 and the header's `loopId` under 11: a version-11 spec reading this ledger
  // would hand back a Campaign whose two branches' readings and verdicts could no longer be told
  // apart, a Run standing at a join with no record of what it was waiting for, and a cancel that
  // looked as though it had stopped one Job when it stopped two. A version gate exists to make that
  // a refusal at open rather than a quiet blank.
  // 13: HimaExperience (#30). The record union grew `experience`, the pair of hashes that says this
  // Run's technical report was written on the Site and where. It is the direction a version gate
  // exists for and needs no argument beyond the union's own shape: `ledgerRecord` is a discriminated
  // union, so a version-12 spec reading this ledger refuses an `experience` record outright,
  // `experience` being none of its eleven arms — and a Campaign whose report could not be read back
  // is a Campaign whose evidence is on a Site with nothing left to say which Run wrote it.
  // 14: the Strategy is the pack's (#58). `runStrategy` widened from one fixed knob — the strict
  // object `{ periodNs: number }` the harness owned — to the knobs the pack's contract declares, by
  // name, each a number or one of a declared list; the run row's `strategy` and `firstStrategy` and
  // the decision's next-Strategy arm all carry that. It is the direction a version gate exists for
  // twice over. `decisionChoice` is a union of strict objects, so a version-13 spec reading a
  // decision that chose a string-valued knob refuses the record outright — and one that chose two
  // number knobs too, `periodNs` having been that object's only key. The row is the same fact one
  // step quieter: `runRecord` is a plain object, but `strategy` is parsed by that same widened
  // schema, so a version-13 spec would refuse every row of a Campaign whose pack declares a knob it
  // has never heard of, and a Run it could no longer name what it was set to is a Run nothing about
  // this ledger is worth reading.
  // 15: the Model moment (#59). The record union grew `session`, the pair that brackets one isolated
  // model session — which purpose it was composed for, which session and which model, where in the
  // graph, what it could reach, and how it ended. It is the direction a version gate exists for and
  // needs no argument beyond the union's own shape, exactly as 13 did: `ledgerRecord` is a
  // discriminated union, so a version-14 spec reading this ledger refuses a `session` record
  // outright, `session` being none of its twelve arms — and this is the first record in this harness
  // that says a model took part in a Campaign at all, so a ledger that dropped it would be a
  // Campaign whose one model turn had never happened.
  // 16: a pack folder carries its own choosers (#57). The decision record carries `chooserOrigin`,
  // which of the two places the chooser it applied was read from — the pack's own `choosers/`, or
  // the bundle's. It is the direction a version gate exists for: `decisionRecord` is a plain object,
  // so a version-15 spec reading this ledger would hand back decisions that still named a chooser id
  // and no longer said which file that id resolved to, and since this ticket two files may answer to
  // one id. A decision is re-derivable from its own record (D43) only if the record says which
  // clauses were applied, so dropping the origin is the same silent loss the header's `loopId` was
  // under 11 — and the field is required rather than optional because every decision written from
  // here on resolved through a pack, and a decision that could not say where its chooser came from
  // is one nothing wrote.
  // 17: readers are pack tools (#61). Two shapes grow together. `readerRef` — and so every
  // observation's `reader` — carries the optional `file` and `sha256` of the script a pack reader is,
  // present exactly for a reader that is a script in a pack folder; and a `semanticValue`'s `type`
  // and `unit` are no longer two enums this bundle owns but slugs declared in a `semantics.yml`, the
  // pack's own ahead of the bundle's. The second earns the bump on its own and in the direction a
  // version gate exists for: `semanticValue` is parsed by that widened schema, so a version-16 spec
  // reading this ledger would refuse every observation, verdict and decision of a Campaign whose pack
  // declared a value type it has never heard of — and a candidate count is exactly such a type. The
  // first is the readable direction, and the same silent-loss case `group` was under 7: a version-16
  // spec would hand back readings that still named a reader id and no longer said which script of
  // which pack folder produced them, which for a reader that is a plain file a person edits is the
  // whole of what identifies it. A third shape grows with them, and is part of the same ticket
  // rather than a bump of its own: a `launched` job record carries the optional `reading` — the reader,
  // the file its script writes and the report it reads, as one strict block. That is what makes a reader's Job
  // settleable by a host that never launched it (#14) without re-reading a pack folder a person may
  // have edited in between — and it is the readable direction for the same reason `licences` was
  // under 8: a version-16 spec would hand back a `launched` record that no longer said the Job was a
  // reader's at all, which is the one fact a reconciliation decides the whole branch on. That block
  // is nested rather than spread over three members of the record, and `jobRecord`, `jobIdentity`
  // and `readerRef` are strict, so the fact is one object a stored record carries whole or does not
  // carry: a boundary a Job is picked up again across is no place for a key dropped in silence, and
  // a record written in the flat shape this ticket first had is refused at open rather than read as
  // a tool's Job.
  // 18: the workshop (#62). The record union grew `code`, one per file a Model moment wrote inside
  // its workshop: where it is on the Site, what it hashes to, how big it is, the language the pack
  // says it is in, and the node, attempt and session that wrote it. It is the direction a version
  // gate exists for and needs no argument beyond the union's own shape, exactly as 13 and 15 did:
  // `ledgerRecord` is a discriminated union, so a version-17 spec reading this ledger refuses a
  // `code` record outright, `code` being none of its thirteen arms — and this is the first record in
  // this harness that says a model *wrote* something rather than merely answered, so a ledger that
  // dropped it would be a Campaign whose one piece of generated code had no author, no session and no
  // hash to hold the file on the Site against. Three shapes grow with it, in the same ticket and by
  // the same argument as 17's third: an `opened` session record carries the optional nested
  // `workshop` — which workshop of the contract the moment was opened for, the one file of it the
  // fabric runs, and that file's own absolute path on the Site, which is what a face holds a `code`
  // record against to say whether the entry itself was written — and a `launched` job record carries
  // the optional nested `workshop` (the entry it
  // ran, with the hash it had at the launch) and the optional `attempt` it belongs to. The first is
  // what makes a workshop readable off the ledger alone, so a Campaign whose pack has since been
  // uninstalled or edited still says on its card which node wrote code and what ran; the second ties
  // the Job to the very bytes the `code` record hashed; the third is what lets a host that never
  // launched a Job number the records it writes for it. All three are the readable direction and the
  // silent-loss case `licences` was under 8 and `reading` under 17: a version-17 spec would hand back
  // an `opened` record that no longer said which workshop it was, and a `launched` record that no
  // longer said which bytes ran or which attempt it was — each of them the one fact the reader of
  // that record decides on.
  // 19: a Run says what it is for and which files it ran (#64). The run row carries `purpose` — an
  // ordinary Campaign, or the test run the pack authoring pipeline's test stage opened — and
  // `packDigest`, the hash of every regular file of the pack folder but the pipeline's own records,
  // taken when the Run was opened. Both are the readable direction on their own — optional, on a
  // plain object — and together they are the same silent-loss case `group` was under 7, one level up:
  // a version-18 spec reading this ledger would hand back a test run that no longer said it was one,
  // and a Campaign that no longer said which bytes of a pack folder it ran. That matters more here
  // than it did there, because a *pack* rests on it: the test record of a pack folder is valid
  // exactly while the Run it names is a `test` whose `packDigest` is the folder's digest now, so a
  // reader that dropped either field would report every tested pack as untested — or, if it dropped
  // only the digest and read the rest, would report a pack whose rules had been rewritten since the
  // test as tested. A version gate exists to make that a refusal at open rather than a quiet blank.
  // `packDigest` is a sha256 and not any string, within this same version: nothing has ever written
  // one that is not, and a row carrying something a check could never match is a Run that would read
  // as untestable rather than as wrong.
  // 20: conversational ownership and execution receipts. Older builds must reject this domain
  // rather than strip ownership and re-enter drive. Within this unreleased version, workspace
  // design is optional: generic Packs already wrote its absence (JSON omitted undefined), so this
  // repairs the reader without rewriting those facts or inventing an input. Earlier v20 readers
  // refuse that absence; v19 still fails the version gate and its import schema stays unchanged.
  // 21: a `knowledge` record says a declared Pack file was actually returned to an Agent, including
  // its purpose, source session and byte identity. This is a new discriminant; a v20 reader would
  // reject it or lose the fact, so v21 refuses a v20 store until the explicit offline importer has
  // copied it into an empty v21 home. There is no in-place or automatic upgrade.
  // 22: an `archive` record distinguishes a completed Pack-local delivery from an execution that
  // ended while delivery is still missing or failed. It is a new union arm, so an older reader must
  // refuse rather than erase the evidence lifecycle.
  // 23: source-linked model analysis stays distinct from observed facts and Judge verdicts.
  // 24: accepted per-Run growth preserves the actual graph and its lifecycle.
  // 25: retain observed and written byte versions before later attempts overwrite source paths.
  version: 25,
  tables: {
    runs: domainTable<string, RunRecord>(runRecord),
    records: domainTable<string, LedgerRecord>(ledgerRecord),
  },
});

const recordKey = (runId: string, seq: number): string => `${runId}#${String(seq).padStart(6, '0')}`;

/**
 * One promise chain per Run, so that **no two writes of one Run's row are ever in flight at once**
 * (#29).
 *
 * A fork drives several branches at the same moment and every one of them moves this row: its own
 * entry under `fork.branches`, and the meters it counts. Two writes of one row in flight at once is
 * the shape everything else about a fork is defended against, and this is where that defence is
 * stated rather than assumed: one write of one Run at a time, and the next one begins against the
 * row the last one left.
 *
 * It is not the whole of the defence and does not have to be, because neither half of what a branch
 * writes can be lost by landing second. The meters are taken from the further of two answers and
 * never from the later of two writes (`movedOn`), and a branch states only its own entry
 * (`RunProgress.branch`), merged into whatever fork the row holds *inside* the update below — so a
 * branch that read the row before another branch moved cannot put that other branch back. What this
 * chain adds is that the two are the only things two branches ever race over: everything else a
 * caller states is written against a row nothing else is mid-write on.
 *
 * Keyed on the Ledger and then on the run id, exactly as `claimingSlotOn` is keyed on the Ledger and
 * the Site's name, and for the same reason: two homes booted in one process — which the contract
 * suite does — each own a ledger, and one home's Runs are nothing to do with the other's. Per Run
 * and not per ledger, because two Runs write two rows and serialising them against each other would
 * make a Campaign wait on a Campaign.
 *
 * `#append` below bumps the sequence through the storage domain's own atomic `update` and is
 * deliberately not chained here: it takes the next number and touches nothing a caller composed.
 */
const advancesPerRun = new WeakMap<Ledger, Map<string, Promise<unknown>>>();

/**
 * Run one advance of one Run with no other advance of that Run interleaved.
 *
 * @param ledger - the ledger the Run lives in, which is what identifies the home that owns it.
 * @param runId - the Run whose row is being moved.
 * @param write - the whole write: read the row, merge what the caller stated, store it.
 * @returns the stored row; a write that throws leaves the chain usable for the next one.
 */
function advancingRun(ledger: Ledger, runId: string, write: () => Promise<RunRecord>): Promise<RunRecord> {
  const chains = advancesPerRun.get(ledger) ?? new Map<string, Promise<unknown>>();
  advancesPerRun.set(ledger, chains);
  const mine = (chains.get(runId) ?? Promise.resolve()).then(write);
  // What is chained on is a settled-either-way copy: one write that threw must not take every later
  // write of that Run down with it, and must not leave an unhandled rejection behind either.
  chains.set(runId, mine.then(() => undefined, () => undefined));
  return mine;
}

/**
 * The branches of a fork once one branch's move lands: the fork as the row has it, with that one
 * branch's entry replaced and every other branch's left exactly as it was (#29).
 *
 * The whole reason `RunProgress` carries a branch rather than a fork. A branch knows where *it*
 * stands and nothing about where the others got to while it was launching a Job, so it states its
 * own entry and this merges it into the row as the row is being written — never into a copy of the
 * fork the caller read before the other branches moved.
 *
 * A move naming a branch this fork does not have is written all the same, because that is what the
 * caller said happened; a move arriving while no fork is open is dropped, because there is nothing
 * for it to be a branch of.
 */
const withBranch = (held: RunFork | undefined, branch: ({ readonly id: string } & RunBranch) | undefined): RunFork | undefined => {
  if (held === undefined || branch === undefined) return held;
  const { id, ...stands } = branch;
  return { ...held, branches: { ...held.branches, [id]: stands } };
};

export class Ledger {
  readonly #domain: Domain<typeof ledgerSpec>;
  #verdictWriter: VerdictWriter | undefined;

  constructor(domain: Domain<typeof ledgerSpec>) {
    this.#domain = domain;
    this.#verdictWriter = new VerdictWriter(mintedByLedger, (runId, data) =>
      this.#append(runId, 'judge', (h) => ({ ...h, type: 'verdict', ...data })),
    );
  }

  /**
   * Hand out this ledger's one verdict-writer capability. HimaJudge takes it at construction; the
   * second caller gets an error rather than a second writer.
   */
  takeVerdictWriter(): VerdictWriter {
    const writer = this.#verdictWriter;
    if (!writer) throw new Error('the verdict-writer capability has already been handed out; HimaJudge holds it');
    this.#verdictWriter = undefined;
    return writer;
  }

  async createRun(input: RunOpening): Promise<RunRecord> {
    const run: RunRecord = { id: `run-${randomUUID()}`, ...input, createdAt: new Date().toISOString(), nextSeq: 1 };
    await this.#domain.table('runs').put(run.id, run);
    return run;
  }

  /**
   * Move a Run's fabric state on. Only the four fields that move: a Run's identity, its Goal, its
   * Budget and its sequence are not this call's to touch, so no caller can quietly widen a Goal (D3)
   * or rewrite the record's own history.
   *
   * The meters only ever move forward and `endedBy` follows the status — see `movedOn`. Everything
   * else this takes is stated outright by the caller and written as given.
   *
   * Both are decided inside the update, against the row as it is being written rather than one the
   * caller read a moment earlier: a write that states no status is held against the status the row
   * already has, so a `/hima cancel` and the loop it interrupted cannot undo one another by landing
   * in the wrong order.
   *
   * @throws when there is no such Run.
   */
  async advanceRun(id: string, progress: RunProgress): Promise<RunRecord> {
    if (!this.run(id)) throw new Error(`unknown run ${id}`);
    // One write of this Run's row at a time (`advancingRun` says why): a fork's branches take turns,
    // and each of them writes against the row the last one left.
    return advancingRun(this, id, () =>
      this.#domain.table('runs').update(id, (r) => {
        // A move that is only a move: asked here rather than where it was composed, because this is
        // where the row it is about to land on can actually be seen (`RunProgress.onlyWhileRunning`).
        if (progress.onlyWhileRunning === true && r.status !== 'running') return r;
        // `loop` and `fork` are taken out of the spread and put back by hand, because they are the
        // two fields a caller can state as *nothing*: a Loop or a fork that has closed leaves the
        // row with no such key at all, never one holding `null` or `undefined`, exactly as every
        // other absent fact here is written. `branch` is taken out because it is not a field of this
        // row: it is one branch's own entry, merged into whatever fork the row now holds. `count`
        // and `onlyWhileRunning` are taken out because neither is a field either: one is a delta the
        // meters below apply, the other the question just asked.
        const { loop, fork, branch, count, onlyWhileRunning: _asked, ...stated } = progress;
        const moved = { ...r, ...stated };
        const { loop: _closedLoop, fork: _closedFork, ...bare } = moved;
        const inLoop = loop === undefined ? moved.loop : loop === null ? undefined : loop;
        const inFork = withBranch(fork === undefined ? moved.fork : fork === null ? undefined : fork, branch);
        const placed: RunRecord = {
          ...bare,
          ...(inLoop === undefined ? {} : { loop: inLoop }),
          ...(inFork === undefined ? {} : { fork: inFork }),
        };
        return progress.meters === undefined ? placed : { ...placed, meters: movedOn(r.meters, progress.meters, placed.status, count) };
      }),
    );
  }

  run(id: string): RunRecord | undefined {
    return this.#domain.table('runs').get(id);
  }

  /**
   * Every Run this ledger holds, oldest first. What a reconciliation reads when a host starts: the
   * only way to find the Runs a previous process left in flight is to ask the ledger for all of
   * them, because nothing else in this harness remembers that they exist.
   */
  runs(): RunRecord[] {
    const out: RunRecord[] = [];
    for (const [, r] of this.#domain.table('runs').entries()) out.push(r);
    return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  record(id: string): LedgerRecord | undefined {
    return this.#domain.table('records').get(id);
  }

  /** Records of one run in sequence order, optionally of one type. */
  records(query: { runId: string; type?: LedgerRecord['type'] }): LedgerRecord[] {
    const out: LedgerRecord[] = [];
    for (const [, r] of this.#domain.table('records').entries()) {
      if (r.runId === query.runId && (query.type === undefined || r.type === query.type)) out.push(r);
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  /**
   * The Jobs one Site is holding right now, as the ledger knows them: every Job with a `launched`
   * record and neither a `finished` nor a `killed` one, across every Run of that Site. This is what
   * every one of the Site's caps is counted over — its parallel job count (D25) and each licence it
   * declares (#21) — so the question is asked across Runs and not within one: a cap of one means one
   * Job on the Site, not one Job per Campaign, and one seat means one seat.
   *
   * Keyed on the tmux session, which is the Job's identity: a session name is offered only after the
   * Site has been asked whether it is free, so two Jobs on one Site never share one.
   *
   * This is the ledger's answer and only the ledger's: a Job that ended without anyone asking, and a
   * Job whose session vanished without writing an exit status, both still have a `launched` record
   * and no other, so both are counted here. Deciding which of them is really holding a slot on the
   * Site takes the Site itself, and is `heldJobSlots` in `job-cap.ts` — the one place the cap is
   * counted, by every face that launches.
   */
  openJobsOn(siteId: string): JobRecord[] {
    const launched: JobRecord[] = [];
    const settled = new Set<string>();
    for (const [, r] of this.#domain.table('records').entries()) {
      if (r.type !== 'job' || r.siteId !== siteId) continue;
      if (r.event === 'launched') launched.push(r);
      else settled.add(r.job.session);
    }
    return launched.filter((r) => !settled.has(r.job.session)).sort((a, b) => a.seq - b.seq);
  }

  async appendObservation(runId: string, data: Omit<ObservationRecord, keyof typeof base | 'type'>): Promise<ObservationRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'observation', ...data }));
  }

  /** What became of a Job, appended by the executor: launched, finished with its exit code, or killed. */
  async appendJob(runId: string, data: Omit<JobRecord, keyof typeof base | 'type'>): Promise<JobRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'job', ...data }));
  }

  /** The Campaign workspace this Run acts in, appended by the executor: prepared here, or found already there. */
  async appendWorkspace(runId: string, data: Omit<WorkspaceRecord, keyof typeof base | 'type'>): Promise<WorkspaceRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'workspace', ...data }));
  }

  /** One transition of one fabric node, appended by the executor as HimaFabric moves the Run. */
  async appendNode(runId: string, data: Omit<NodeRecord, keyof typeof base | 'type'>): Promise<NodeRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'node', ...data }));
  }

  /** A node whose Retry allowance is spent, appended by the executor with the whole of the failure. */
  async appendBlocker(runId: string, data: Omit<BlockerRecord, keyof typeof base | 'type'>): Promise<BlockerRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'blocker', ...data }));
  }

  /** A person clearing a blocked Run. The one appender that does not write as the executor: this
   *  record exists to say a person acted, and the executor may not sign a person's name. */
  async appendResumed(runId: string, data: Omit<ResumedRecord, keyof typeof base | 'type'>): Promise<ResumedRecord> {
    return this.#append(runId, 'person', (h) => ({ ...h, type: 'resumed', ...data }));
  }

  /** What an Explore node's chooser decided, appended by the executor. Never a verdict: D7 stands. */
  async appendDecision(runId: string, data: Omit<DecisionRecord, keyof typeof base | 'type'>): Promise<DecisionRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'decision', ...data }));
  }

  /** That a person asked this Run to stop, appended by the executor before anything is stopped. */
  async appendCancel(runId: string, data: Omit<CancelRecord, keyof typeof base | 'type'>): Promise<CancelRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'cancel', ...data }));
  }

  /**
   * That a drill-down Loop opened, or closed, appended by the executor (#28).
   *
   * `loopId` is the record's own and not the header's stamp, so that both halves of the pair name
   * the Loop whatever the row said at the moment each was written: the `opened` record is written
   * before the Run moves into the Loop, and the `closed` record before it moves out, which is the
   * order every other record of a move in this harness is written in — the record is the authority
   * and the row follows it.
   */
  async appendLoop(runId: string, data: LoopData): Promise<LoopRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'loop', ...data }));
  }

  /**
   * That this Run's technical report was written on the Site, and where (#30).
   *
   * Appended after both files are on the Site and never before: the record is the claim that they
   * are there, and a claim written first would survive a host that died between the two and tell the
   * next one there was nothing left to do.
   */
  async appendExperience(runId: string, data: Omit<ExperienceRecord, keyof typeof base | 'type'>): Promise<ExperienceRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'experience', ...data }));
  }

  /** Delivery fact for Pack-local customer assets; a failure names no false completion. */
  async appendArchive(runId: string, data: Omit<ArchiveRecord, keyof typeof base | 'type'>): Promise<ArchiveRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'archive', ...data }));
  }

  async appendAnalysis(runId: string, data: Omit<AnalysisRecord, keyof typeof base | 'type'>): Promise<AnalysisRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'analysis', ...data }));
  }

  /**
   * That a Model moment opened, and that it closed (#59), appended by the executor.
   *
   * The `opened` record is appended once the session exists and before the model is asked anything,
   * and the `closed` one once the session is disposed: a record written the other way round would
   * claim a session that was never composed, or a session still running under a ledger that says it
   * is over. A host that goes away between the two leaves an `opened` with no `closed`, which is
   * exactly what it should leave — the next boot's reconciliation is what closes it `interrupted`.
   */
  async appendSession(runId: string, data: Omit<SessionRecord, keyof typeof base | 'type'>): Promise<SessionRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'session', ...data }));
  }

  /**
   * That a Model moment wrote one file inside its workshop (#62), appended by the executor.
   *
   * Appended after the bytes are on the Site and never before, for the reason `appendExperience` is:
   * the record is the claim that the file is there, and a claim written first would survive a channel
   * that failed between the two and tell a person a file exists that does not.
   */
  async appendCode(runId: string, data: Omit<CodeRecord, keyof typeof base | 'type'>): Promise<CodeRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'code', ...data }));
  }

  /** Record only a successful, byte-identified Pack knowledge read. */
  async appendKnowledge(runId: string, data: Omit<KnowledgeRecord, keyof typeof base | 'type'>): Promise<KnowledgeRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'knowledge', ...data }));
  }

  /** Append one immutable growth fact. Fabric owns validation and ordering; Ledger owns identity,
   * sequence, time and writer exactly as for every other execution record. */
  async appendGrowth(runId: string, data: Omit<GrowthRecord, keyof typeof base | 'type'>): Promise<GrowthRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'growth', ...data }));
  }

  /** Append one immutable revision lifecycle/validity fact. */
  async appendRevision(runId: string, data: Omit<RevisionRecord, keyof typeof base | 'type'>): Promise<RevisionRecord> {
    return this.#append(runId, 'executor', (h) => ({ ...h, type: 'revision', ...data }));
  }

  /** Who refused: the shell for a permit decision (the default), the executor for a reader refusing a report kind. */
  async appendRefusal(runId: string, data: Omit<RefusalRecord, keyof typeof base | 'type'>, writer: WriterRole = 'shell'): Promise<RefusalRecord> {
    return this.#append(runId, writer, (h) => ({ ...h, type: 'refusal', ...data }));
  }

  /**
   * The one write path, private to this class: a caller reaches it only through the typed appenders
   * above.
   *
   * The record's Generation is stamped here, out of the run row this write just touched, and no
   * appender takes one: the generation is the Run's own state, so the row that hands out the
   * sequence number is also what says which generation that sequence number falls in. A Run with no
   * generation — one no fabric started — writes records with none, by omission as ever.
   *
   * A Run standing inside a drill-down Loop is stamped with that Loop's own generation and its id
   * (#28): a record written inside a Loop belongs to a turn of that Loop, not to the turn of the
   * outer one the Campaign happens to be in, and it nests under the Loop it was written in.
   */
  async #append<R extends LedgerRecord>(runId: string, writer: WriterRole, build: (head: { id: string; runId: string; siteId: string; seq: number; at: string; writer: WriterRole; generation?: number; loopId?: string }) => R): Promise<R> {
    const run = this.run(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    const updated = await this.#domain.table('runs').update(runId, (r) => ({ ...r, nextSeq: r.nextSeq + 1 }));
    const seq = updated.nextSeq - 1;
    const id = recordKey(runId, seq);
    const inGeneration = updated.loop?.generation ?? updated.generation;
    const generation = inGeneration === undefined ? {} : { generation: inGeneration };
    const loopId = updated.loop === undefined ? {} : { loopId: updated.loop.id };
    const rec = build({ id, runId, siteId: run.siteId, seq, at: new Date().toISOString(), writer, ...generation, ...loopId });
    await this.#domain.table('records').put(id, rec);
    return rec;
  }
}

/**
 * The node records of one Run, in sequence order: the whole history of what its nodes did.
 *
 * Here beside `appendNode` rather than in whichever module reads them, because reading a Run's node
 * records is what the Budget counts an attempt over, what the driver finds a running Job's attempt
 * in, and what a reconciliation numbers its own record with. One narrowing, so those three cannot
 * come to disagree about which records are a node's.
 */
export const nodeRecordsIn = (ledger: Ledger, runId: string): NodeRecord[] =>
  ledger.records({ runId, type: 'node' }).filter((r): r is NodeRecord => r.type === 'node');

/** Every immutable revision event in ledger order. Shared by projections that must show history. */
export const revisionRecordsIn = (ledger: Ledger, runId: string): RevisionRecord[] =>
  ledger.records({ runId, type: 'revision' }).filter((r): r is RevisionRecord => r.type === 'revision');

export interface RecordValidity { readonly valid: boolean; readonly invalidatedBy?: string }

/** Whether one historical record is current under all applied revisions in this record set. */
export function recordValidityOf(records: readonly LedgerRecord[], recordId: string): RecordValidity {
  const revision = records.findLast((record): record is RevisionRecord =>
    record.type === 'revision' && record.event === 'applied' && (record.invalidates ?? []).includes(recordId));
  return revision === undefined ? { valid: true } : { valid: false, invalidatedBy: revision.revisionId };
}

/** The current evidence view. History remains in the input and can be paired with recordValidityOf. */
export function currentRecordsIn(records: readonly LedgerRecord[]): LedgerRecord[] {
  const invalid = new Set(records
    .filter((record): record is RevisionRecord => record.type === 'revision' && record.event === 'applied')
    .flatMap((record) => record.invalidates ?? []));
  return records.filter((record) => !invalid.has(record.id));
}

export interface RetainedRecordMaterial {
  readonly path: string; readonly sha256: string; readonly bytes: number;
  readonly revisionId: string; readonly version: number;
}

/** Immutable bytes for a superseded code/observation record whose original path may since differ. */
export function retainedRecordMaterial(records: readonly LedgerRecord[], recordId: string): RetainedRecordMaterial | undefined {
  const original = records.find((record) => record.id === recordId);
  const path = original?.type === 'code' ? original.path : original?.type === 'observation' ? original.path : undefined;
  const sha256 = original?.type === 'code' ? original.sha256 : original?.type === 'observation' ? original.contentSha256 : undefined;
  const bytes = original?.type === 'code' || original?.type === 'observation' ? original.bytes : undefined;
  if (path === undefined || sha256 === undefined || bytes === undefined) return undefined;
  const revision = records.findLast((record): record is RevisionRecord => record.type === 'revision' && record.event === 'applied'
    && (record.invalidates ?? []).includes(recordId) && (record.assets ?? []).some((asset) => asset.path === path && asset.beforeSha256 === sha256));
  const asset = revision?.assets?.find((item) => item.path === path && item.beforeSha256 === sha256);
  return revision === undefined || asset === undefined ? undefined
    : { path: asset.beforeVersionPath, sha256, bytes, revisionId: revision.revisionId, version: revision.version };
}

/**
 * Write one node transition: an absent key, never an undefined one, so a record round-trips as
 * written.
 *
 * Beside the appender it wraps because every writer of a node record wants exactly this shape — the
 * driver moving a Run through its graph, the job cap announcing a Site that is full, the cancel and
 * the reconciliation settling a node on a Run they hold no drive of — and the "absent, never
 * undefined" rule is the ledger's own, stated here once for all of them.
 */
export async function recordNode(
  ledger: Ledger,
  runId: string,
  node: { readonly id: string; readonly kind: NodeKind },
  state: NodeState,
  attempt: number,
  extra: { outcome?: VerdictOutcome; jobSession?: string; reason?: string; branchId?: string } = {},
): Promise<NodeRecord> {
  const head = { nodeId: node.id, kind: node.kind, state, attempt };
  const withOutcome = extra.outcome === undefined ? head : { ...head, outcome: extra.outcome };
  const withSession = extra.jobSession === undefined ? withOutcome : { ...withOutcome, jobSession: extra.jobSession };
  // The branch a fork's drive is writing this transition for (#29), stated by that drive and by
  // nothing else: a node outside every fork carries no key at all.
  const withBranchId = extra.branchId === undefined ? withSession : { ...withSession, branchId: extra.branchId };
  return ledger.appendNode(runId, extra.reason === undefined ? withBranchId : { ...withBranchId, reason: extra.reason });
}

// Offline import is deliberately outside Ledger's live write path. A version gate is still a
// refusal, never an invitation to rewrite the old user's domain in place.
const legacyRunRecord = runRecord.pick({
  id: true, campaignId: true, siteId: true, createdAt: true, nextSeq: true, status: true,
  packId: true, purpose: true, packDigest: true, goal: true, budget: true, currentNode: true,
  strategy: true, firstStrategy: true, generation: true, loop: true, fork: true, meters: true,
}).strict();
const legacyLedgerRecord = z.discriminatedUnion('type', [
  observationRecord.omit({ retainedPath: true }), refusalRecord, verdictRecord,
  jobRecord.safeExtend({ job: jobIdentity.extend({ pid: z.number().int().positive() }) }),
  workspaceRecord.omit({ packDigest: true }).extend({ design: z.string() }), nodeRecord, blockerRecord, resumedRecord,
  // v20 decisions can name the conversational agent. These are the complete v19 fields.
  decisionRecord.pick({ id: true, runId: true, siteId: true, seq: true, at: true, writer: true,
    generation: true, loopId: true, type: true, nodeId: true, chooser: true,
    chooserOrigin: true, chosen: true, rationale: true, cites: true }),
  cancelRecord, loopRecord, experienceRecord, sessionRecord, codeRecord.omit({ retainedPath: true }),
]);
const legacyLedgerDocument = z.strictObject({
  unit: z.strictObject({ name: z.literal('hima_ledger'), version: z.literal(19) }),
  global: z.null(),
  tables: z.strictObject({
    runs: z.record(z.string(), legacyRunRecord),
    records: z.record(z.string(), legacyLedgerRecord),
  }),
});

/** The immediately previous domain's complete shapes, before PLS-24 added `knowledge`. */
const v20LedgerRecord = z.discriminatedUnion('type', [
  observationRecord.omit({ retainedPath: true }), refusalRecord, verdictRecord, jobRecord, workspaceRecord, nodeRecord, blockerRecord,
  resumedRecord, decisionRecord, cancelRecord, loopRecord, experienceRecord, sessionRecord, codeRecord.omit({ retainedPath: true }),
]);
const v20LedgerDocument = z.strictObject({
  unit: z.strictObject({ name: z.literal('hima_ledger'), version: z.literal(20) }),
  global: z.null(),
  tables: z.strictObject({ runs: z.record(z.string(), runRecord), records: z.record(z.string(), v20LedgerRecord) }),
});

const priorPolishingDocument = z.strictObject({
  unit: z.strictObject({ name: z.literal('hima_ledger'), version: z.union([z.literal(21), z.literal(22), z.literal(23), z.literal(24)]) }),
  global: z.null(),
  tables: z.strictObject({ runs: z.record(z.string(), runRecord), records: z.record(z.string(),
    z.discriminatedUnion('type', [...v20LedgerRecord.options, knowledgeRecord, archiveRecord, analysisRecord, growthRecord])) }),
}).superRefine((document, context) => {
  if (document.unit.version === 21 && Object.values(document.tables.records).some(record => record.type === 'archive' || record.type === 'analysis')) {
    context.addIssue({ code: 'custom', message: 'v21 did not support archive or analysis records' });
  }
  if (document.unit.version < 24 && Object.values(document.tables.records).some(record => record.type === 'growth')) context.addIssue({ code: 'custom', message: 'growth requires source v24' });
  if (document.unit.version === 22 && Object.values(document.tables.records).some(record => record.type === 'analysis')) context.addIssue({ code: 'custom', message: 'v22 did not support analysis records' });
});

type ImportDocument = { readonly tables: { readonly runs: Record<string, RunRecord>; readonly records: Record<string, LedgerRecord> } };

/** Shared relational checks, applied to every source schema before any target is staged. */
function validateImportDocument(document: ImportDocument): void {
  const { runs, records } = document.tables;
  for (const [key, run] of Object.entries(runs)) {
    if (key !== run.id || !new RegExp(`^${runIdPattern.source}$`).test(key)) throw new Error(`invalid imported Run identity: ${key}`);
    if (!Number.isSafeInteger(run.nextSeq)) throw new Error(`invalid imported nextSeq: ${key}`);
  }
  for (const [key, record] of Object.entries(records)) {
    const run = runs[record.runId];
    if (!run || record.siteId !== run.siteId) throw new Error(`invalid imported Run linkage: ${key}`);
    if (!Number.isSafeInteger(record.seq) || key !== record.id || key !== recordKey(run.id, record.seq) || record.seq >= run.nextSeq) {
      throw new Error(`invalid imported record identity or sequence: ${key}`);
    }
    // A failed append can reserve a sequence number without writing a record. Gaps are kept; only
    // collision, a mismatched key or a nextSeq that could overwrite a fact is refused.
    if (record.type === 'workspace' && record.campaignId !== run.campaignId) throw new Error(`invalid imported Campaign linkage: ${key}`);
    if (record.type === 'verdict' || record.type === 'decision') {
      for (const id of record.cites) {
        const cited = records[id];
        if (!cited || cited.runId !== run.id || cited.seq >= record.seq ||
          (cited.type !== 'observation' && (record.type !== 'decision' || cited.type !== 'verdict'))) {
          throw new Error(`invalid imported evidence linkage: ${key} cites ${id}`);
        }
      }
    }
  }
}

/** Validate a complete offline v19 JSON snapshot without deleting fields or inventing ownership. */
function readLegacyLedger(bytes: Buffer): z.infer<typeof legacyLedgerDocument> {
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const document = legacyLedgerDocument.parse(input);
  // Several historical nested schemas strip unknown keys. Refuse such a file rather than silently
  // lose facts, including future execution/control fields hidden inside a legacy-looking record.
  if (!isDeepStrictEqual(input, document)) throw new Error('legacy ledger contains unsupported fields or values; import would change stored facts');
  validateImportDocument(document as unknown as ImportDocument);
  return document;
}

/** Validate a v19 or v20 offline snapshot without changing fields or pretending it is live. */
function readImportLedger(bytes: Buffer): z.infer<typeof legacyLedgerDocument> | z.infer<typeof v20LedgerDocument> | z.infer<typeof priorPolishingDocument> {
  const input: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const version = (input as { unit?: { version?: unknown } } | null)?.unit?.version;
  const document = version === 21 || version === 22 || version === 23 || version === 24 ? priorPolishingDocument.parse(input)
    : version === 20 ? v20LedgerDocument.parse(input) : readLegacyLedger(bytes);
  if (!isDeepStrictEqual(input, document)) throw new Error('ledger import contains unsupported fields or values; import would change stored facts');
  validateImportDocument(document as unknown as ImportDocument);
  return document;
}

/** lstat every component, including ancestors: O_NOFOLLOW alone protects only the final file. */
async function importPathState(absolute: string, missingLeaf = false): Promise<BigIntStats | undefined> {
  const root = path.parse(absolute).root;
  let at = root;
  const parts = path.relative(root, absolute).split(path.sep).filter(Boolean);
  let state = await lstat(root, { bigint: true });
  for (let i = 0; i < parts.length; i++) {
    at = path.join(at, parts[i]!);
    try { state = await lstat(at, { bigint: true }); } catch (error) {
      if (missingLeaf && i === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (state.isSymbolicLink()) throw new Error(`ledger import refuses symlink paths: ${at}`);
    if (i < parts.length - 1 && !state.isDirectory()) throw new Error(`ledger import ancestor is not a directory: ${at}`);
  }
  return state;
}

function sameImportFile(a: BigIntStats | undefined, b: BigIntStats | undefined): boolean {
  return a !== undefined && b !== undefined && a.dev === b.dev && a.ino === b.ino;
}
function sameImportSnapshot(a: BigIntStats, b: BigIntStats): boolean {
  return sameImportFile(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

export interface LegacyLedgerImportReceipt {
  readonly format: 'hima-ledger-import-v1';
  readonly source: { readonly path: string; readonly version: 19 | 20 | 21 | 22 | 23 | 24; readonly sha256: string; readonly bytes: number; readonly backup: string };
  readonly target: { readonly version: number; readonly sha256: string; readonly file: string };
  readonly importedAt: string;
  readonly runs: number;
  readonly records: number;
  /** Recorded ownership is preserved; import never attaches or starts an executor. */
  readonly ownership: 'unchanged-unowned' | 'unchanged-owned';
}

/**
 * Copy an offline v19 snapshot into a new, empty home, then exit without opening a Host.
 *
 * The caller must stop the old Host before taking/transferring the snapshot. This cannot establish
 * that a different process or Site no longer drives old Jobs; it only preserves history. Adoption
 * into a conversation requires the separate runtime safety checks and an explicit owner binding.
 *
 * All output is built in an owned sibling directory and published by one rename. Existing homes,
 * symlink components, unknown fields and corrupt links are refused. Neither the source nor its
 * home is written. The destination parent must already exist; no ancestor is created or repaired.
 */
export async function importLegacyLedger(request: { readonly sourceFile: string; readonly home: string }): Promise<LegacyLedgerImportReceipt> {
  if (ledgerSpec.version !== 25) throw new Error('legacy import supports only the reviewed v19-v24-to-v25 transition');
  const source = path.resolve(request.sourceFile);
  const home = path.resolve(request.home);
  const parent = path.dirname(home);
  if (home === parent || source === home || source.startsWith(`${home}${path.sep}`)) {
    throw new Error('ledger import source must be outside the new home');
  }
  const sourceState = await importPathState(source);
  if (!sourceState?.isFile()) throw new Error('ledger import source must be a regular offline JSON file');
  const parentState = await importPathState(parent);
  if (!parentState?.isDirectory()) throw new Error('ledger import destination parent must be a directory');
  const homeState = await importPathState(home, true);
  if (homeState && (!homeState.isDirectory() || (await readdir(home)).length !== 0)) throw new Error('ledger import destination must be a new empty home');
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let stage: string | undefined;
  let stageState: BigIntStats | undefined;
  try {
    const opened = await sourceHandle.stat({ bigint: true });
    if (!opened.isFile() || !sameImportSnapshot(sourceState, opened)) throw new Error('ledger import source changed while opening');
    const bytes = await sourceHandle.readFile();
    const afterRead = await sourceHandle.stat({ bigint: true });
    if (!sameImportSnapshot(opened, afterRead) || !sameImportSnapshot(opened, (await importPathState(source))!)) {
      throw new Error('ledger import source changed while reading; stop the old Host and export a stable snapshot');
    }
    const document = readImportLedger(bytes);
    const target = Buffer.from(`${JSON.stringify({ ...document, unit: { ...document.unit, version: ledgerSpec.version } }, null, 2)}\n`);
    const receipt: LegacyLedgerImportReceipt = {
      format: 'hima-ledger-import-v1',
      source: { path: source, version: document.unit.version, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, backup: `ledger-import/source-v${String(document.unit.version)}.json` },
      target: { version: ledgerSpec.version, sha256: createHash('sha256').update(target).digest('hex'), file: 'storages/hima_ledger.json' },
      importedAt: new Date().toISOString(), runs: Object.keys(document.tables.runs).length,
      records: Object.keys(document.tables.records).length,
      ownership: Object.values(document.tables.runs).some((run) => 'control' in run && run.control !== undefined) ? 'unchanged-owned' : 'unchanged-unowned',
    };
    if (!sameImportFile(parentState, await importPathState(parent))) throw new Error('ledger import destination parent changed');
    stage = await mkdtemp(path.join(parent, '.hima-ledger-import-'));
    stageState = await importPathState(stage);
    await mkdir(path.join(stage, 'ledger-import'));
    await mkdir(path.join(stage, 'storages'));
    const writeDurable = async (relative: string, content: Buffer | string) => {
      const file = await open(path.join(stage!, relative), 'wx', 0o600);
      try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
    };
    await writeDurable(receipt.source.backup, bytes);
    await writeDurable('ledger-import/receipt.json', `${JSON.stringify(receipt, null, 2)}\n`);
    await writeDurable(receipt.target.file, target);
    for (const directory of ['ledger-import', 'storages', '.']) {
      const handle = await open(path.join(stage, directory), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
    }
    // Recheck both boundaries immediately before the one publication. Do not remove or clean an
    // existing destination; rename itself refuses if another writer has filled that directory.
    if (!sameImportSnapshot(opened, await sourceHandle.stat({ bigint: true })) ||
      !sameImportSnapshot(opened, (await importPathState(source))!)) throw new Error('ledger import source changed before publication');
    if (!sameImportFile(parentState, await importPathState(parent))) throw new Error('ledger import destination parent changed');
    const currentHome = await importPathState(home, true);
    if (homeState ? !sameImportFile(homeState, currentHome) : currentHome !== undefined) throw new Error('ledger import destination changed');
    if (currentHome && (await readdir(home)).length !== 0) throw new Error('ledger import destination must remain empty');
    await rename(stage, home);
    stage = undefined;
    return receipt;
  } finally {
    try { await sourceHandle.close(); } finally {
      // Never follow a replaced ancestor or remove somebody else's replacement directory while
      // cleaning up a failed import. A disappeared/moved staging directory is left for the owner.
      if (stage !== undefined && sameImportFile(stageState, await importPathState(stage, true))) {
        await rm(stage, { recursive: true, force: true });
      }
    }
  }
}
