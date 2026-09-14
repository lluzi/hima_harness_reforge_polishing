// @hima-seam tools direct
// The workshop: the three tools a Model moment opened at an act node may reach, and the instructions
// it is composed with. One reason to change: what the AI can do while it is writing code for a node.
//
// A workshop is the one place in this harness where a model writes something that is then run. That
// makes the whole of this module a boundary, and it is written as one: every value the model sends
// is held to a grammar on this side before the Site is asked anything, every path is decided by the
// Permit, and every write is then held a second time against the realpath of the directory it was
// supposed to land in — because a symlink an earlier script of the model's own left inside that
// directory is not a way out of it.
//
// The three tools are Hima's own (`hima_*`) and reach a Site only through HimaChannel under the
// Permit. None of them is one of the names the pack authoring guard governs (`GOVERNED_TOOLS`), which
// is what makes them tools a moment may be opened with at all: a moment has no shell and no host
// filesystem (D48), and `openMoment` refuses a request carrying one of those names outright.
//
// What is *not* here: anything about what gets written. The harness names no language, no wrapper, no
// design and no route — every one of those words comes out of the pack's own declaration, and the
// purpose the model is given is the pack author's sentence carried through verbatim.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractText } from 'unpdf';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { channelFor, mustRun, type Channel } from './channel.js';
import { retainRunMaterial } from './experience.js';
import { decideRead, decideWrite } from './shell.js';
import { pathsOf, type Site } from './sites.js';
import { currentRecordsIn, type KnowledgeRecord, type Ledger } from './ledger.js';
import { packKnowledgeManifestOf, type Pack, type PackWorkshop } from './packs.js';
import type { SemanticDeclaration } from './semantics.js';
import { experimentBudgetSpent, reserveResearchWrite } from './budget.js';
import { existingRun } from './runs.js';

/** One tool as `ctx.tools.register` takes it: whatever `defineTool` makes of a definition. */
type ToolDefinition = ReturnType<typeof defineTool>;

/** The three names a workshop's moment reaches, in the order they are registered — which is the order
 *  dsh reports them for that session's scope, and so the order the `opened` record carries. */
export const WORKSHOP_WRITE_TOOL = 'hima_workshop_write';
export const WORKSHOP_READ_TOOL = 'hima_workshop_read';
export const WORKSHOP_KNOWLEDGE_TOOL = 'hima_workshop_knowledge';

/**
 * How much of an output the read tool hands back: the first 262,144 **characters** of its decoded
 * text.
 *
 * A bound and not a convenience. A report a flow wrote can be tens of megabytes, and a tool answer is
 * a model message — an unbounded one would be a context window spent on one file and a turn that
 * never returns. Stated as a constant and reported in the answer (`truncated: true`), because a
 * silently shortened file is a file the model would reason about as though it had seen the end of it.
 * The answer's `bytes` is the file's own size, so the model can tell how much it did not see.
 *
 * Characters and not bytes, because what is capped is the string that becomes a message; the two
 * differ only for a report holding text outside ASCII, and the cap is a bound rather than a promise
 * about a byte count.
 */
export const WORKSHOP_READ_CAP = 256 * 1024;

/** One segment of a path inside the workshop directory: a plain name, never `.`, never `..`, never
 *  empty. The same grammar the declaration's own `directory` is held to, on this side of the wire. */
const segment = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * dsh's own session id of the moment these tools belong to, once there is one.
 *
 * A box and not a value, for the one reason a box is ever right here: the tools are handed to
 * `openMoment` and the session id is what `openMoment` answers with, so the id cannot exist before
 * the tools do. It is set by the turn between the moment opening and the model being asked anything,
 * which is before any of these can be called; a call that somehow arrived first is refused rather
 * than recorded against a session nobody can name.
 */
export interface WorkshopSession { id: string | undefined }

/**
 * **A byte on the Site this Run has no record of**, once one exists — and nothing at all while none
 * does, which is every ordinary moment.
 *
 * A box for the same reason `WorkshopSession` is one, and read by the turn that opened the moment
 * after that moment has closed. It exists because a tool cannot stop a turn: dsh's tool runtime hands
 * the model a *failed result* for a tool that throws and the turn goes on, so a write that landed,
 * verified, and that the ledger would not record would otherwise be known to the model and to nobody
 * else. The turn reads this and blocks the node naming the path, because a Campaign that carried on
 * would write another one at the next attempt.
 *
 * **Best effort, and deliberately not the only telling.** The box is read after the moment has
 * closed, so a host that goes away inside that same moment never reads it — which is exactly when the
 * ledger is already refusing writes. That is why the path also goes to the host log the instant the
 * append fails: the log is the operator's channel and the one that does not depend on this turn
 * reaching its end, or on the ledger working at all.
 *
 * Best effort in *reach*, though, and never in *order*: this is set before either of the other two
 * tellings is attempted, because the one that can fail is the log and a turn that read an empty box
 * would retry the node and land a second unrecorded file.
 */
export interface WorkshopFault { why: string | undefined }

/** One output the workshop may read, as the turn resolved it: the name the model asks by, and the
 *  path under the Campaign workspace the contract binds it to. */
export interface WorkshopReadable { readonly name: string; readonly path: string }

/** One knowledge file the workshop may read, as the turn resolved it: what it is for in the pack
 *  author's words, and where it is on *this* machine — never on a Site. */
export interface WorkshopKnowledge { readonly file: string; readonly purpose: string; readonly at: string }

/** Everything one workshop's tools are built against. Every path here was decided before the moment
 *  opened, which is what lets a tool refuse without asking the Site anything. */
export interface WorkshopScope {
  readonly packsDir?: string;
  readonly ledger: Ledger;
  readonly runId: string;
  readonly site: Site;
  readonly nodeId: string;
  readonly attempt: number;
  readonly session: WorkshopSession;
  /** Where a write the ledger would not record says so, for the turn to read after the moment. */
  readonly fault: WorkshopFault;
  /**
   * The host log, where a host gave one (`FabricDeps.log`, #18) — one line, and only for the failure
   * the ledger itself is: bytes on the Site that this Run could not record.
   *
   * Absent for a caller driving a Run outside a host, exactly as it is for the turn that hands it
   * down. Nothing else this file does is logged: what happens inside a moment belongs on the record,
   * and this is the one thing that happens when the record is what failed.
   *
   * **It may throw, and it is called as though it will.** This is the host's own callback — a logger
   * with an exporter of its own — so it is the one part of that failure path this module does not
   * own. It is called last, after the fault box is set and the answer composed, inside its own `try`,
   * and a throw is reported in the answer's reason and swallowed there.
   */
  readonly log?: (line: string) => void;
  readonly declaration: PackWorkshop;
  /**
   * The workshop directory on the Site, **realpath'd**: the directory the Permit resolved and the
   * turn then created. Every write is held to lying within this, after the Permit has had its say.
   */
  readonly workshopAbs: string;
  readonly reads: readonly WorkshopReadable[];
  readonly knowledge: readonly WorkshopKnowledge[];
  /** The branch of a fork this workshop is inside (#29); absent outside every fork. */
  readonly branchId?: string;
}

/**
 * Is `real` inside `root`, as a path on this Site? The containment test `shell.ts` makes, made again
 * one directory down: the Permit says "inside the workspace", and this says "inside the workshop".
 *
 * Exported because the turn that *makes* the workshop directory asks the same question of it — is
 * this root, resolved, inside the workspace's own `flow` or readers directory? — and two spellings of
 * "inside" is the one thing a containment rule cannot afford.
 */
export function within(real: string, root: string, site: Site): boolean {
  const p = pathsOf(site);
  return real === root || real.startsWith(root.endsWith(p.sep) ? root : root + p.sep);
}

/**
 * What a refused write or read writes down: a `refusal` record, signed `executor` because the
 * executor is what noticed.
 *
 * The same record every other thing this harness was not allowed to do is written as, and carrying
 * the path **as the model asked for it** rather than as anything resolved it: what a person reading
 * an audit needs is the spelling that was attempted, and a resolved path would hide the spelling that
 * is the whole subject of the refusal.
 *
 * No branch key, because a `refusal` record carries none: it is the Site's answer about a path, and
 * the five record kinds a fork is made of are the ones that carry a branch (`ledger.ts`).
 */
async function refuse(scope: WorkshopScope, path: string, reason: string): Promise<void> {
  await scope.ledger.appendRefusal(scope.runId, { path, reason }, 'executor');
}

/** Why a path the model asked to write is not one this workshop will take, or undefined when it is.
 *  Asked before the Site is asked anything at all: a refusal here sends nothing anywhere. */
function badWritePath(asked: string): string | undefined {
  if (asked === '') return 'a path inside the workshop directory, and an empty one names nothing';
  if (asked.startsWith('/')) return `"${asked}" is absolute, and a workshop's write is relative to its own directory`;
  for (const part of asked.split('/')) {
    if (segment.test(part)) continue;
    return `"${asked}" names "${part}", which is not a plain path segment: a workshop's write is one or more names of letters, digits, dots, dashes and underscores, each beginning with a letter or a digit — never "." and never ".."`;
  }
  return undefined;
}

/** What a thrown thing says, whatever it turned out to be. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * **Are the bytes at this path still the bytes this hash is of?** — asked of the Site, through the
 * channel, under the Permit.
 *
 * The one reading behind two promises (#62): what a `code` record says was written, and what a
 * workshop's Job is launched on. Both are claims about bytes on a Site that a process on that Site
 * can change between any two of this harness's commands, so both are made by reading rather than by
 * remembering — the write reads back what it sent before it records anything, and the launch reads
 * back what was recorded before it starts anything.
 *
 * Three questions, in this order, because each is only meaningful once the one before it holds: does
 * the path still resolve to itself (a component swapped for a link since would resolve somewhere
 * else, and the bytes there would be some other file's); do the bytes come back at all; and do they
 * hash to what they are supposed to. Every failure answers a sentence naming the path; none of them
 * answers "probably fine".
 *
 * What it does **not** promise is that nothing can change afterwards. A process running on the Site
 * with the Site user's rights can rewrite the file the instant after this returns; that boundary is
 * the Permit's and the Site login's, as it is for every Job (README, the workshop's write section).
 *
 * @param site - the Site the file is on, for the Permit's read decision and for its path semantics.
 * @param channel - the channel to ask, already warm.
 * @param at - the path, as this harness resolved it when it wrote the file.
 * @param expected - the sha256 the bytes there must have.
 * @param of - which of the two promises this reading is for, which is the whole of what the sentence
 *             differs by: `sent` is the write recording what it has just put there, `recorded` is the
 *             launch about to start what a `code` record already claims.
 * @returns undefined when all three hold, and otherwise why they do not.
 */
export async function readBack(site: Site, channel: Channel, at: string, expected: string, of: 'sent' | 'recorded'): Promise<string | undefined> {
  const decided = await decideRead(site, at, channel);
  if (!decided.ok) return `${at} cannot be read back: ${decided.reason}`;
  if (decided.absPath !== at) {
    return of === 'sent'
      ? `${at} resolves to ${decided.absPath} after the write, and not to itself: nothing is recorded about bytes at a path that has moved under it`
      : `${at} resolves to ${decided.absPath} and not to itself, so the file that was recorded is not the file this path now names`;
  }
  let landed: Uint8Array;
  try {
    landed = await channel.readFile(decided.absPath);
  } catch (err) {
    return `${at} cannot be read back: ${messageOf(err)}`;
  }
  const got = createHash('sha256').update(landed).digest('hex');
  if (got === expected) return undefined;
  return of === 'sent'
    ? `landed bytes at ${at} do not hash to what was sent: ${expected} sent, ${got} now`
    : `the entry ${at} no longer hashes to what was recorded (${expected} recorded, ${got} now)`;
}

/**
 * What each of the three tools answers with. Every field optional but `wrote`, and every absent one
 * genuinely absent rather than carrying `undefined`: a tool answer is a JSON value the model reads,
 * and a key that arrives as `undefined` is a key that did not survive the wire (`tools.ts`).
 *
 * Declared rather than inferred, because these are the shapes the schemas beside each tool promise —
 * and a schema and an answer that had drifted apart would be a model told one thing and handed
 * another.
 */
export interface WriteAnswer {
  wrote: boolean; path?: string; sha256?: string; bytes?: number; refused?: string; reason?: string;
  /** Durable pre-effect call identity and its cumulative charged standing. */
  writeReceipt?: string; usedWriteAttempts?: number; usedBytes?: number;
}
export interface ReadAnswer { read?: boolean; output?: string; path?: string; bytes?: number; text?: string; truncated?: boolean; reason?: string }
export interface KnowledgeAnswer { read?: boolean; file?: string; purpose?: string; text?: string; reason?: string }

export interface CapturedWorkshopInput {
  readonly file: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly recordId: string;
}

/**
 * Snapshot only the inputs this Workshop declaration names. This is a Host-side identity capture
 * for historical applicability checks: exposedBytes is zero because none of these bytes have been
 * returned to the Agent by this operation.
 */
export async function captureWorkshopInputs(scope: WorkshopScope): Promise<{
  readonly captured: readonly CapturedWorkshopInput[];
  readonly unavailable: readonly { readonly file: string; readonly reason: string }[];
}> {
  const captured: CapturedWorkshopInput[] = [];
  const unavailable: { file: string; reason: string }[] = [];
  const sessionId = scope.session.id;
  if (sessionId === undefined || scope.packsDir === undefined) {
    return { captured, unavailable: scope.reads.map((input) => ({ file: input.name, reason: 'input identity capture needs a recorded Agent session and installed Pack' })) };
  }
  const channel = channelFor(scope.site);
  for (const input of scope.reads) {
    try {
      const decided = await decideRead(scope.site, input.path, channel);
      if (!decided.ok) {
        await refuse(scope, input.path, decided.reason);
        unavailable.push({ file: input.name, reason: decided.reason });
        continue;
      }
      const bytes = Buffer.from(await channel.readFile(decided.absPath));
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const prior = currentRecordsIn(scope.ledger.records({ runId: scope.runId })).findLast((record): record is KnowledgeRecord =>
        record.type === 'knowledge' && record.origin === 'input' && record.exposedBytes === 0
        && record.nodeId === scope.nodeId && record.attempt === scope.attempt && record.workshop === scope.declaration.id
        && record.file === input.name && record.path === decided.absPath && record.sha256 === sha256 && record.bytes === bytes.byteLength);
      if (prior !== undefined) {
        captured.push({ file: input.name, path: decided.absPath, sha256, bytes: bytes.byteLength, recordId: prior.id });
        continue;
      }
      const retainedPath = await retainRunMaterial({ ledger: scope.ledger, packsDir: scope.packsDir }, scope.runId, bytes, sha256);
      const record = await scope.ledger.appendKnowledge(scope.runId, {
        ...(scope.branchId === undefined ? {} : { branchId: scope.branchId }),
        origin: 'input', ...(retainedPath === undefined ? {} : { retainedPath }), exposedBytes: 0,
        nodeId: scope.nodeId, attempt: scope.attempt, sessionId, workshop: scope.declaration.id,
        file: input.name, purpose: `Declared Workshop input "${input.name}" captured for content-identity comparison`,
        path: decided.absPath, sha256, bytes: bytes.byteLength,
      });
      captured.push({ file: input.name, path: decided.absPath, sha256, bytes: bytes.byteLength, recordId: record.id });
    } catch (error) {
      unavailable.push({ file: input.name, reason: messageOf(error) });
    }
  }
  return { captured, unavailable };
}

/**
 * The three tools of one workshop, built for one moment.
 *
 * Built per moment and not once per host, because every one of them is bound to this node, this
 * attempt and this session: a tool that took the workshop as an argument would be a tool a second
 * moment could be handed and would then record another node's files.
 *
 * The order is the order dsh reports for the session's scope, and the `opened` record carries that
 * list — so a test asserting which three tools a moment reached is asserting dsh's own answer.
 */
export function workshopTools(scope: WorkshopScope): ToolDefinition[] {
  return [
    defineTool({
      name: WORKSHOP_WRITE_TOOL,
      description: 'Write one file inside this workshop\'s own directory. `path` is relative to that directory; its bytes are `content`. Nothing is written anywhere else, and a path that leaves the directory is refused and recorded.',
      parameters: {
        path: { type: 'string', required: true, description: 'Where to write, relative to the workshop directory: one or more plain path segments, as in `entry.sh` or `lib/read.sh`. Never absolute and never containing `..`.' },
        content: { type: 'string', required: true, description: 'The whole of the file, as text.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            wrote: { type: 'boolean', required: true },
            path: { type: 'string', description: 'Where the file is on the site, absolute, when it was written.' },
            sha256: { type: 'string' },
            bytes: { type: 'integer' },
            refused: { type: 'string', description: 'The path as it was asked for, when the write was refused.' },
            reason: { type: 'string', description: 'Why it was refused.' },
            writeReceipt: { type: 'string', description: 'Ledger record for this charged writer call.' },
            usedWriteAttempts: { type: 'integer' },
            usedBytes: { type: 'integer' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => writeIntoWorkshop(scope, String(args.path), String(args.content)),
    }),
    defineTool({
      name: WORKSHOP_READ_TOOL,
      description: 'Read one of the outputs this workshop is allowed to read, by the name its contract gives it. The text is capped; the answer says when it was cut.',
      parameters: {
        output: { type: 'string', required: true, description: 'The output\'s name, as the workshop\'s declaration lists it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            read: { type: 'boolean', description: 'False when nothing was read; absent on a read that succeeded.' },
            output: { type: 'string' },
            path: { type: 'string' },
            bytes: { type: 'integer', description: 'How many bytes the file holds.' },
            text: { type: 'string' },
            truncated: { type: 'boolean', description: 'True when `text` is the beginning of a file larger than the cap, false when it is the whole file. Always present on a read that succeeded.' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => readForWorkshop(scope, String(args.output)),
    }),
    defineTool({
      name: WORKSHOP_KNOWLEDGE_TOOL,
      description: 'Read one of the knowledge files this pack carries and this workshop is allowed to read, by its file name.',
      parameters: {
        file: { type: 'string', required: true, description: 'The file\'s name, as the workshop\'s declaration lists it.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            read: { type: 'boolean', description: 'False when nothing was read; absent on a read that succeeded.' },
            file: { type: 'string' },
            purpose: { type: 'string', description: 'What the pack says the file is for.' },
            text: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: async (args) => knowledgeForWorkshop(scope, String(args.file)),
    }),
  ];

}

/**
 * Write one file inside the workshop directory, in the order that makes every refusal free.
 *
 * The grammar first, on this side of the wire, so a path that could never be allowed costs the Site
 * nothing and sends it nothing. Then the Permit, which decides where the harness may write at all.
 * Then the **second containment**: the path the Permit resolved must lie inside the realpath'd
 * workshop directory. That last one is not a repetition of the Permit's — the Permit's write roots
 * are the whole Campaign workspace, which holds the copy of the Golden Flow and every report the
 * flow wrote — and it is the one that a symlink an earlier script of the model's own left inside the
 * workshop would otherwise walk through, because `decideWrite` resolves the deepest existing
 * ancestor for real and would hand back a path in whatever the link points at.
 *
 * Only then is anything sent. The bytes travel on standard input to `tee`, never on the command
 * line, exactly as a reader's script and a workspace's `workspace.json` do: the wire carries the
 * command, not its payload, so no content a model wrote is ever a word of a shell line.
 */
export async function writeIntoWorkshop(scope: WorkshopScope, asked: string, content: string): Promise<WriteAnswer> {
  const channel = channelFor(scope.site);
  const p = pathsOf(scope.site);
  let receipt: { readonly recordId: string; readonly usedWriteAttempts: number; readonly usedBytes: number } | undefined;
  const withReceipt = <T extends WriteAnswer>(answer: T): T => receipt === undefined ? answer : {
    ...answer, writeReceipt: receipt.recordId, usedWriteAttempts: receipt.usedWriteAttempts, usedBytes: receipt.usedBytes,
  };
  const refused = async (reason: string): Promise<WriteAnswer> => {
    await refuse(scope, asked, reason);
    return withReceipt({ wrote: false, refused: asked, reason });
  };
  const sessionId = scope.session.id;
  if (sessionId === undefined) {
    return refused('this workshop\'s session is not open yet, so nothing written in it could be recorded against a session');
  }
  const bytes = Buffer.from(content, 'utf8');
  const reserved = await reserveResearchWrite(scope.ledger, scope.runId, {
    nodeId: scope.nodeId, attempt: scope.attempt, sessionId, scope: 'workshop', workshop: scope.declaration.id,
    path: asked, requestedBytes: bytes.byteLength, ...(scope.branchId === undefined ? {} : { branchId: scope.branchId }),
  });
  receipt = reserved;
  if (!reserved.allowed) return refused(reserved.reason!);
  const reserveStarted = (): boolean => experimentBudgetSpent(existingRun(scope.ledger, scope.runId), 0);
  const bad = badWritePath(asked);
  if (bad !== undefined) return refused(`a workshop writes only inside its own directory: ${bad}`);

  const target = p.join(scope.workshopAbs, asked);
  const decided = await decideWrite(scope.site, target, channel);
  if (!decided.ok) return refused(decided.reason);
  if (!within(decided.absPath, scope.workshopAbs, scope.site)) {
    return refused(`${decided.absPath} is outside the workshop directory ${scope.workshopAbs}: a path that resolves out of it is not a path this workshop may write, however it was spelled`);
  }

  // The parent, where the model asked for a file inside a subdirectory of its own. Its own write
  // decision, because making a directory is a write like any other and the Permit decides each one.
  const parent = p.dirname(decided.absPath);
  if (parent !== scope.workshopAbs) {
    const dir = await decideWrite(scope.site, parent, channel);
    if (!dir.ok) return refused(dir.reason);
    if (!within(dir.absPath, scope.workshopAbs, scope.site)) {
      return refused(`${dir.absPath} is outside the workshop directory ${scope.workshopAbs}`);
    }
    if (reserveStarted()) return refused('the Campaign entered its closing reserve before the workshop directory could be created; nothing was written');
    try {
      await mustRun(channel, ['mkdir', '-p', '--', dir.absPath], `create ${dir.absPath} on site ${scope.site.name}`);
    } catch (err) {
      return refused(messageOf(err));
    }
  }

  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (reserveStarted()) return refused('the Campaign entered its closing reserve before the workshop file could be written; nothing was written');
  try {
    await mustRun(channel, ['tee', '--', decided.absPath], `write ${decided.absPath} on site ${scope.site.name}`, { stdin: bytes });
  } catch (err) {
    // The bytes may have landed anyway — a partial file behind an ENOSPC, a whole one behind an ssh
    // response that never came back — so the refusal is written and the read-back below is not
    // reached. What this harness promises is not "nothing landed": it is that no landed byte goes
    // unrecorded, as a `code` record when it verified what is there and as a refusal naming the
    // path when it could not. (README, the workshop's write section.)
    return refused(messageOf(err));
  }

  // **What is recorded is what was read back.** The hash above is of what was *sent*; a record is
  // evidence only if it is of what is actually on the Site. So the file is read back through the
  // same channel, under the Permit, and three things are held before anything is written down: the
  // path still resolves to itself (a component swapped for a link between the decision and now
  // would resolve elsewhere), the bytes come back, and they hash to what was sent. Any of the three
  // failing is a refusal naming the path — never a `code` record, and never a silent pass.
  const landed = await readBack(scope.site, channel, decided.absPath, sha256, 'sent');
  if (landed !== undefined) return refused(landed);

  // The record after the bytes are on the Site, verified, and never before: it is the claim that
  // the file is there, and a claim written first would survive a channel that failed between the two.
  //
  // A record **per version**, and a second write to a path this attempt already recorded is not
  // refused: a model that writes its entry, thinks again and writes it over is doing the ordinary
  // thing, the launch runs the bytes the *latest* record hashes, and a person reads the history in
  // the order it happened. What a face counts is files — distinct paths — and never records.
  const inBranch = scope.branchId === undefined ? {} : { branchId: scope.branchId };
  try {
    const retainedPath = scope.packsDir === undefined ? undefined
      : await retainRunMaterial({ ledger: scope.ledger, packsDir: scope.packsDir }, scope.runId, bytes, sha256);
    await scope.ledger.appendCode(scope.runId, {
      ...inBranch,
      ...(retainedPath === undefined ? {} : { retainedPath }),
      nodeId: scope.nodeId,
      attempt: scope.attempt,
      sessionId,
      workshop: scope.declaration.id,
      path: decided.absPath,
      sha256,
      bytes: bytes.byteLength,
      language: scope.declaration.language,
    });
  } catch (err) {
    // **The one failure this promise cannot be kept through.** The bytes are there, verified, and
    // the one thing that would have said so has just failed. They stay there: nothing in this
    // harness removes a path on a Site — not a stale workspace, not a failed copy, and not this —
    // because a removing verb admitted for this case is permission to remove things on a
    // customer's machine, and a Site owner's `forbidden: deletions` is about their Site's content
    // rather than about which of the harness's writes went wrong. So what is left to do is to say
    // where the bytes are, in every channel that still works, and to stop the Campaign.
    //
    // Three tellings, none of them a record — the ledger is what failed, and an append made to say
    // that an append failed is an assumption about which of its writes are working:
    //
    //  1. the model's own answer, `{ wrote: false, reason }`, so the moment is not written on as
    //     though the file were recorded;
    //  2. the **host log**, at this instant, because it is the operator's channel and the one that
    //     does not depend on this turn reaching its end;
    //  3. the fault box, which the turn reads after the moment closes and blocks the node with —
    //     best effort by nature (see {@link WorkshopFault}), which is why it is not the only one.
    //
    // **And in that order, reversed: the fault first.** Two of the three are this module's own
    // objects and cannot fail; the log is a callback handed down from the host (`ctx.logger.info`),
    // and a logger has its own ways to fail. Called first, a throwing one took everything after it:
    // the model got a thrown tool instead of an answer, the fault box stayed empty, and the turn
    // then read the ordinary "wrote no <entry>" failure and spent a retry — a second moment landing
    // a second unrecorded file. So the fault is set before anything that can throw, the answer is
    // composed, and the log goes last inside its own `try`. Best effort is what the log is; it is
    // not licence to pre-empt the two that are not.
    const why = messageOf(err);
    const said = `${decided.absPath} was written and verified, and the ledger would not record it (${why}): this run cannot account for the bytes at that path, and nothing has been removed from the site`;
    scope.fault.why = said;
    let reason = said;
    try {
      // Without a `hima:` of its own: the turn hands this down as its own host-log writer, which is
      // the one place that prefix is written (`toHostLog`, `node-turns.ts`).
      scope.log?.(`workshop ${scope.declaration.id} landed ${decided.absPath} and the ledger would not record it: ${why}`);
    } catch (logErr) {
      // Swallowed here and nowhere else: the one channel left that still works is the answer the
      // model is about to read, so the failure of the operator's channel is said in it. Not a
      // record — the ledger is what failed — and not a rethrow, which would throw away the answer
      // to save the report of it.
      reason = `${said}; and the host log would not take that either (${messageOf(logErr)})`;
    }
    return withReceipt({ wrote: false, reason });
  }
  return withReceipt({ wrote: true, path: decided.absPath, sha256, bytes: bytes.byteLength });
}

/** Read one of the declared outputs, under the Permit, capped. */
export async function readForWorkshop(scope: WorkshopScope, asked: string): Promise<ReadAnswer> {
  const channel = channelFor(scope.site);
  const refused = async (path: string, reason: string): Promise<ReadAnswer> => {
    await refuse(scope, path, reason);
    return { read: false, reason };
  };
  const readable = scope.reads.find((r) => r.name === asked);
  if (!readable) {
    const allowed = scope.reads.map((r) => `"${r.name}"`).join(', ');
    return refused(asked, `this workshop may read ${allowed === '' ? 'no output at all' : allowed}, and "${asked}" is not one of them`);
  }
  const decided = await decideRead(scope.site, readable.path, channel);
  if (!decided.ok) return refused(readable.path, decided.reason);
  let bytes: Uint8Array;
  try {
    bytes = await channel.readFile(decided.absPath);
  } catch (err) {
    return refused(decided.absPath, `${decided.absPath} cannot be read: ${messageOf(err)}`);
  }
  const whole = Buffer.from(bytes).toString('utf8');
  const truncated = whole.length > WORKSHOP_READ_CAP;
  const text = truncated ? whole.slice(0, WORKSHOP_READ_CAP) : whole;
  const returned = Buffer.from(text, 'utf8');
  const sessionId = scope.session.id;
  if (sessionId !== undefined && scope.packsDir !== undefined) {
    try {
      const sha256 = createHash('sha256').update(returned).digest('hex');
      const sourceMaterialSha256 = createHash('sha256').update(bytes).digest('hex');
      const retainedPath = await retainRunMaterial({ ledger: scope.ledger, packsDir: scope.packsDir }, scope.runId, returned, sha256);
      await scope.ledger.appendKnowledge(scope.runId, {
        ...(scope.branchId === undefined ? {} : { branchId: scope.branchId }),
        origin: 'input', ...(retainedPath === undefined ? {} : { retainedPath }), exposedBytes: returned.byteLength,
        nodeId: scope.nodeId, attempt: scope.attempt, sessionId, workshop: scope.declaration.id,
        file: readable.name, purpose: `Declared Workshop input "${readable.name}" returned to the Agent`,
        path: decided.absPath, sha256, bytes: returned.byteLength,
        sourceMaterialSha256, sourceMaterialBytes: bytes.byteLength,
      });
    } catch (error) {
      return { read: false, reason: `${decided.absPath} was read but its returned bytes could not be recorded: ${messageOf(error)}` };
    }
  }
  // `truncated` always, both ways round — the one answer in this harness that states its false.
  // Everywhere else an absent key is how a fact is not claimed; here the fact is *about the answer
  // the model is reading*, and a model that has to infer "I saw all of it" from a missing key is
  // being asked to reason about a JSON shape instead of about the file. It costs one word.
  return {
    output: readable.name,
    path: decided.absPath,
    bytes: bytes.byteLength,
    text,
    truncated,
  };
}

/**
 * Read one of the pack's own knowledge files, from this machine.
 *
 * Never from a Site: a pack folder is installed where the harness runs, and a workshop reading its
 * own pack's knowledge over a channel would be reading a file that is not there. No refusal record
 * either, for the same reason — a `refusal` is what this harness writes when a *Site* would not let
 * it do something, and this never asks a Site anything.
 */
export async function knowledgeForWorkshop(scope: WorkshopScope, asked: string): Promise<KnowledgeAnswer> {
  const known = scope.knowledge.find((k) => k.file === asked);
  if (!known) {
    const allowed = scope.knowledge.map((k) => `"${k.file}"`).join(', ');
    return { read: false, reason: `this workshop may read ${allowed === '' ? 'no knowledge file at all' : allowed}, and "${asked}" is not one of them` };
  }
  // Held again here, and not only where the moment was composed. A pack folder is plain files a
  // person edits, and the window between resolution and this call is a whole model turn wide: a
  // file replaced in it by a symlink would be followed by `readFile` into whatever it names, and a
  // knowledge tool is the one tool of a workshop that reads this machine rather than a Site. So the
  // entry is looked at without following a link and must still be a plain file. `throwIfNoEntry`
  // is false because absence is an answer here; every other failure throws and is caught below,
  // which is the difference between "it is not there" and "this could not be looked at".
  try {
    const there = lstatSync(known.at, { throwIfNoEntry: false });
    if (there === undefined) return { read: false, reason: `the knowledge file "${known.file}" is not at ${known.at}` };
    if (!there.isFile()) return { read: false, reason: `the knowledge file "${known.file}" at ${known.at} is not a plain file, so nothing was read` };
    const bytes = await readFile(known.at);
    const sessionId = scope.session.id;
    if (sessionId === undefined) return { read: false, reason: `the knowledge file "${known.file}" was not returned because this workshop has no recorded Agent session` };
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const retainedPath = scope.packsDir === undefined ? undefined
      : await retainRunMaterial({ ledger: scope.ledger, packsDir: scope.packsDir }, scope.runId, bytes, sha256);
    await scope.ledger.appendKnowledge(scope.runId, {
      ...(scope.branchId === undefined ? {} : { branchId: scope.branchId }),
      origin: 'legacyPack', ...(retainedPath === undefined ? {} : { retainedPath }), exposedBytes: bytes.byteLength,
      nodeId: scope.nodeId,
      attempt: scope.attempt,
      sessionId,
      workshop: scope.declaration.id,
      file: known.file,
      purpose: known.purpose,
      path: known.at,
      sha256,
      bytes: bytes.byteLength,
    });
    return { file: known.file, purpose: known.purpose, text: bytes.toString('utf8') };
  } catch (err) {
    return { read: false, reason: `the knowledge file "${known.file}" at ${known.at} cannot be read: ${messageOf(err)}` };
  }
}

/** What the instructions say about the output the workshop must produce: the reader that reads it,
 *  and the value types that reader emits with the units the resolved semantics give them. */
export interface WorkshopProduces {
  readonly name: string;
  /** Where it must be written, absolute on the Site. */
  readonly path: string;
  readonly reader: string;
  /**
   * One entry per value type the reader emits: the type, and what it is measured in.
   *
   * Every one of them declared. A type the resolved semantics does not declare blocks the node before
   * a moment is opened (`resolveWorkshop`), so this shape cannot hold "no semantics file declares
   * this type" — a model told that about its own output is a model told to produce something nobody
   * could read.
   */
  readonly emits: readonly { readonly type: string; readonly declared: SemanticDeclaration }[];
}

/**
 * What the attempt before this one did (#62), for the instructions of a retry to put in front of the
 * model: which attempt it was, the reason its node record holds, and the tail of its Job's log.
 *
 * `tail` is always a string and never absent, because every way of not having one is itself something
 * to say — `(no job ran)` for an attempt that failed before it launched anything, and
 * `(the log could not be read: …)` for a Site that would not answer. A blank there would read as a
 * Job that printed nothing, which is a different fact.
 */
export interface WorkshopAttemptBefore {
  readonly attempt: number;
  readonly reason: string;
  readonly tail: string;
}

/** Everything the instructions of one workshop moment are composed from. Every line of them is either
 *  the harness's own frame or something the pack declared; nothing here is invented about a method. */
export interface WorkshopBriefing {
  readonly declaration: PackWorkshop;
  readonly nodeId: string;
  readonly attempt: number;
  /** How many attempts this node is allowed in all — the Retry allowance the Run was started with. */
  readonly allowance: number;
  readonly siteName: string;
  /** The workshop directory on the Site, absolute. */
  readonly workshopAbs: string;
  /** The entry file, absolute on the Site: what the command line below runs. */
  readonly entryAbs: string;
  /** The command line as it will be launched, every value already substituted. */
  readonly argv: readonly string[];
  readonly reads: readonly WorkshopReadable[];
  readonly knowledge: readonly WorkshopKnowledge[];
  readonly produces: WorkshopProduces;
  /** What the node supplies this attempt, by the name the declaration's `argv` references it as. */
  readonly values: Readonly<Record<string, string>>;
  /** What the attempt before this one did, on every attempt after the first. Absent on attempt 1, and
   *  on an attempt whose predecessor left no record saying what became of it. */
  readonly previous?: WorkshopAttemptBefore;
}

/**
 * The whole of a workshop moment's system prompt.
 *
 * A fixed frame in the harness's own words, with everything specific to this pack coming out of the
 * pack's own declaration — the purpose verbatim, the directory, the entry, what may be read, what must
 * be produced and in which value types. The frame says what a workshop *is*, because the model is in
 * a session with no history, no persona and no orientation of any kind: whatever this string does not
 * say, nothing else will.
 *
 * `purpose` is carried through as text and is never interpreted. A purpose holding `${…}`, Markdown,
 * or an instruction of its own is a sentence in a prompt and nothing more — nothing here substitutes
 * into it, and nothing the model then does escapes the three tools it has.
 */
export function workshopInstructions(brief: WorkshopBriefing): string {
  const { declaration } = brief;
  const listed = (lines: readonly string[], none: string): string => (lines.length === 0 ? `  ${none}` : lines.join('\n'));
  const emits = brief.produces.emits.map(({ type, declared }) =>
    `  ${type} in ${declared.unit}${declared.description === undefined ? '' : ` — ${declared.description}`}`);
  return [
    'You are one node of a campaign that HimaFabric is executing, and this node is a workshop: the one',
    'place in this system where you write code and the fabric then runs it. Nothing you say is acted on.',
    'What is acted on is what you write with the tools below, and the file that runs is named here.',
    '',
    `This is node ${brief.nodeId}, attempt ${brief.attempt} of ${brief.allowance}, on site ${brief.siteName}.`,
    '',
    // What the attempt before this one did, where there was one. The one part of these instructions
    // that is about this Run's own history rather than about the pack: a model asked to write the
    // same file again with nothing said about why the last one failed can only write it again.
    ...(brief.previous === undefined ? [] : [
      'What the previous attempt did:',
      `  attempt ${brief.previous.attempt}: ${brief.previous.reason}`,
      '  the last lines of its log:',
      ...brief.previous.tail.split('\n').map((line) => `    ${line}`),
      '',
    ]),
    'What this workshop is for, in the pack\'s own words:',
    '',
    declaration.purpose,
    '',
    `Where you write: ${brief.workshopAbs}`,
    `Every file goes there, through ${WORKSHOP_WRITE_TOOL}, whose \`path\` is relative to that directory.`,
    'Nothing you write anywhere else lands, and an attempt to is refused and recorded.',
    '',
    `What runs: ${declaration.entry}, at ${brief.entryAbs}.`,
    'The fabric launches it as a job on the site, under the site\'s permit, with this command line:',
    `  ${brief.argv.join(' ')}`,
    'Nothing else you write is run. Whatever else you write is there for that file to use.',
    '',
    'What you may read, by name:',
    listed(brief.reads.map((r) => `  ${r.name} at ${r.path}`), '(nothing)'),
    `Read one with ${WORKSHOP_READ_TOOL}.`,
    '',
    'What this pack knows:',
    listed(brief.knowledge.map((k) => `  ${k.file} — ${k.purpose}`), '(nothing)'),
    `Read one with ${WORKSHOP_KNOWLEDGE_TOOL}.`,
    '',
    `What you must produce: ${brief.produces.name}, the file ${brief.produces.path}.`,
    `It is read by ${brief.produces.reader}, which takes these value types out of it:`,
    listed(emits, '(none)'),
    'A file that reader cannot make sense of is a generation nobody can judge.',
    '',
    'The values this attempt supplies, which the command line above already carries:',
    listed(Object.entries(brief.values).map(([name, value]) => `  ${name} = ${value}`), '(none)'),
    '',
    'Your tools, and you have no others:',
    `  ${WORKSHOP_WRITE_TOOL} { path, content } — write one file inside the workshop directory.`,
    `  ${WORKSHOP_READ_TOOL} { output } — read one of the outputs named above.`,
    `  ${WORKSHOP_KNOWLEDGE_TOOL} { file } — read one of the knowledge files named above.`,
    '',
    `Write ${declaration.entry}, and then say that you have.`,
  ].join('\n');
}

/** The one thing a workshop's moment is asked, once its instructions are its whole system prompt. */
export const workshopAsk = (entry: string): string => `Write ${entry} now, and say so when it is written.`;

// ---------------------------------------------------------------------------------------------
// Offline document knowledge (PLS-30)
// ---------------------------------------------------------------------------------------------

/** A derived index can always be rebuilt from the identified source document. */
export const KNOWLEDGE_INDEX_SCHEMA = 'hima-knowledge-index/1' as const;
export const KNOWLEDGE_CHUNK_CHARS = 2_400;
export const KNOWLEDGE_SEARCH_LIMIT = 8;
/** Search is discovery only.  A short preview prevents a result list from becoming a document read. */
export const KNOWLEDGE_SNIPPET_CHARS = 360;
/** The text a read may expose to an Agent or record as used evidence. */
export const KNOWLEDGE_READ_CAP = 2_400;

export interface KnowledgeDocumentIdentity {
  readonly id: string;
  readonly title: string;
  readonly version?: string;
  readonly mediaType: 'text/markdown' | 'text/plain' | 'application/pdf';
  readonly sourcePath: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly scope: string;
  readonly source: 'pack' | 'current';
  /** PDF extraction is deliberately visible: an empty page is not silently treated as read. */
  readonly pages?: number;
  readonly extractedPages?: readonly number[];
  readonly extractionWarnings?: readonly string[];
}

export interface KnowledgeDocumentChunk {
  readonly id: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly page?: number;
  readonly section?: string;
  readonly text: string;
  readonly sha256: string;
}

export interface KnowledgeDocumentIndex {
  readonly schema: typeof KNOWLEDGE_INDEX_SCHEMA;
  readonly document: KnowledgeDocumentIdentity;
  readonly chunks: readonly KnowledgeDocumentChunk[];
}

export interface KnowledgeSearchHit extends KnowledgeDocumentChunk {
  readonly document: KnowledgeDocumentIdentity;
  readonly score: number;
}

/** A search candidate deliberately has no chunk body.  Call read with its identities for bytes. */
export interface KnowledgeSearchCandidate {
  readonly id: string;
  readonly documentId: string;
  readonly ordinal: number;
  readonly page?: number;
  readonly section?: string;
  readonly sha256: string;
  readonly document: KnowledgeDocumentIdentity;
  readonly score: number;
  readonly snippet: string;
}

const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const safeDocumentId = (id: string): string => {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error(`invalid knowledge document id ${JSON.stringify(id)}`);
  return id;
};
const canonicalKnowledgeRoot = (root: string): string => {
  const resolved = path.resolve(root);
  try { return realpathSync(resolved); } catch { return resolved; }
};
const scopeDirectory = (root: string, scope: string): string => {
  if (scope.trim() === '' || scope.length > 512) throw new Error('knowledge scope must be a non-empty bounded identity');
  return path.join(canonicalKnowledgeRoot(root), hash(scope));
};

/** The full issued proposal is the current-document scope. Repeated reads of one pending proposal
 * share it; a later Campaign with identical Pack/Site facts receives a different nonce and scope. */
export function campaignKnowledgeScope(proposalId: string): string {
  const [facts, nonce, signature, ...extra] = proposalId.split('.');
  if (extra.length !== 0 || !/^[a-f0-9]{64}$/.test(facts ?? '')
    || (nonce !== undefined && (!/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature ?? '')))) {
    throw new Error('current knowledge scope must be the id returned by HimaGuide Campaign preparation');
  }
  return nonce === undefined ? facts! : proposalId;
}

/** A small preparation projection, not a search: the later read still validates every identity. */
export function currentKnowledgeDocumentCount(root: string, proposalId: string): number {
  try {
    const directory = scopeDirectory(root, campaignKnowledgeScope(proposalId));
    const base = path.resolve(root);
    if (!lstatSync(base).isDirectory() || lstatSync(base).isSymbolicLink()) return 0;
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) return 0;
    return readdirSync(directory).filter((name) => /^[a-f0-9]{64}$/.test(name)).filter((id) => {
      try {
        const entry = path.join(directory, id);
        return lstatSync(entry).isDirectory() && !lstatSync(entry).isSymbolicLink();
      } catch { return false; }
    }).length;
  } catch { return 0; }
}

/** Reject links in every owned path component.  `path.resolve` alone only constrains spelling. */
async function plainPath(root: string, target: string, kind: 'file' | 'directory'): Promise<void> {
  const base = path.resolve(root);
  const resolved = path.resolve(target);
  const relative = path.relative(base, resolved);
  if (relative === '' ? kind === 'file' : relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`knowledge path escapes its root: ${resolved}`);
  }
  let at = base;
  const rootState = await lstat(at);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) throw new Error(`knowledge root is not a plain directory: ${base}`);
  for (const part of relative.split(path.sep).filter(Boolean)) {
    at = path.join(at, part);
    const state = await lstat(at);
    if (state.isSymbolicLink()) throw new Error(`knowledge path contains a symbolic link: ${at}`);
  }
  const state = await lstat(resolved);
  if ((kind === 'file' ? !state.isFile() : !state.isDirectory()) || state.isSymbolicLink()) {
    throw new Error(`knowledge source is not a plain ${kind}: ${resolved}`);
  }
}

async function plainSource(file: string): Promise<string> {
  const resolved = path.resolve(file);
  const leaf = await lstat(resolved);
  if (!leaf.isFile() || leaf.isSymbolicLink()) throw new Error(`knowledge source is not a plain file: ${resolved}`);
  const actualParent = await realpath(path.dirname(resolved));
  const actual = path.join(actualParent, path.basename(resolved));
  await plainPath(path.parse(actual).root, actual, 'file');
  return actual;
}

function mediaTypeOf(file: string): KnowledgeDocumentIdentity['mediaType'] {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.txt') return 'text/plain';
  throw new Error(`unsupported knowledge document ${path.basename(file)}; use PDF, Markdown or plain text`);
}

/** Break one page into bounded, paragraph-respecting excerpts. A page/section identity is kept on
 * every excerpt; no summary or model-generated text is placed in the index. */
function chunksOfPage(documentId: string, text: string, page: number | undefined, ordinalFrom: number): KnowledgeDocumentChunk[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const chunks: KnowledgeDocumentChunk[] = [];
  let held = '';
  let section: string | undefined;
  const put = () => {
    const body = held.trim();
    if (body === '') return;
    const ordinal = ordinalFrom + chunks.length;
    chunks.push({ id: `${documentId}:${ordinal}`, documentId, ordinal, ...(page === undefined ? {} : { page }),
      ...(section === undefined ? {} : { section }), text: body, sha256: hash(body) });
    held = '';
  };
  for (const paragraph of paragraphs.length === 0 ? [text.trim()] : paragraphs) {
    const heading = /^(?:#{1,6}\s+|CHAPTER\s+)(.+)$/im.exec(paragraph)?.[1]?.trim();
    if (heading) section = heading.slice(0, 200);
    for (let at = 0; at < paragraph.length; at += KNOWLEDGE_CHUNK_CHARS) {
      const piece = paragraph.slice(at, at + KNOWLEDGE_CHUNK_CHARS);
      if (held !== '' && held.length + 2 + piece.length > KNOWLEDGE_CHUNK_CHARS) put();
      held += `${held === '' ? '' : '\n\n'}${piece}`;
      if (piece.length === KNOWLEDGE_CHUNK_CHARS) put();
    }
  }
  put();
  return chunks;
}

/** Parse one local document entirely offline. PDF pages remain separate so every hit can cite a
 * page. The source bytes remain authoritative; this object is only a rebuildable search index. */
async function indexKnowledgeBytes(input: {
  readonly bytes: Uint8Array; readonly sourcePath: string; readonly title?: string; readonly version?: string;
  readonly scope: string; readonly source: 'pack' | 'current';
}): Promise<KnowledgeDocumentIndex> {
  const sourcePath = path.resolve(input.sourcePath);
  const bytes = input.bytes;
  const mediaType = mediaTypeOf(sourcePath);
  const id = hash(bytes);
  let pages: string[];
  if (mediaType === 'application/pdf') {
    const extracted = await extractText(new Uint8Array(bytes), { mergePages: false });
    if (!Array.isArray(extracted.text)) throw new Error(`PDF parser returned no page index for ${sourcePath}`);
    pages = extracted.text;
  } else {
    pages = [new TextDecoder('utf-8', { fatal: true }).decode(bytes)];
  }
  const extractedPages = mediaType === 'application/pdf'
    ? pages.flatMap((text, index) => text.trim() === '' ? [] : [index + 1]) : undefined;
  const extractionWarnings = mediaType === 'application/pdf'
    ? pages.flatMap((text, index) => text.trim() === '' ? [`page ${index + 1} has no extractable text`] : []) : undefined;
  const document: KnowledgeDocumentIdentity = {
    id, title: input.title?.trim() || path.basename(sourcePath), ...(input.version === undefined ? {} : { version: input.version }),
    mediaType, sourcePath, sha256: id, bytes: bytes.byteLength, scope: input.scope, source: input.source,
    ...(mediaType === 'application/pdf' ? { pages: pages.length, extractedPages, ...(extractionWarnings!.length === 0 ? {} : { extractionWarnings }) } : {}),
  };
  const chunks: KnowledgeDocumentChunk[] = [];
  for (let page = 0; page < pages.length; page++) chunks.push(...chunksOfPage(id, pages[page]!, mediaType === 'application/pdf' ? page + 1 : undefined, chunks.length));
  if (chunks.length === 0) throw new Error(`knowledge document has no extractable text: ${sourcePath}`);
  return { schema: KNOWLEDGE_INDEX_SCHEMA, document, chunks };
}

export async function indexKnowledgeDocument(input: {
  readonly file: string; readonly title?: string; readonly version?: string;
  readonly scope: string; readonly source: 'pack' | 'current';
}): Promise<KnowledgeDocumentIndex> {
  const sourcePath = await plainSource(input.file);
  return indexKnowledgeBytes({ ...input, sourcePath, bytes: await readFile(sourcePath) });
}

const currentIndexAt = (root: string, scope: string, id: string): string => path.join(scopeDirectory(root, scope), safeDocumentId(id), 'index.json');
const currentMetadataAt = (root: string, scope: string, id: string): string => path.join(scopeDirectory(root, scope), safeDocumentId(id), 'document.json');

/** Metadata is separate from the rebuildable index.  A damaged search cache never loses a title,
 * version, scope or source identity, while source bytes remain the authority for the actual text. */
function parseCurrentDocumentIdentity(value: unknown, at: string, scope: string, id: string): KnowledgeDocumentIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid knowledge document metadata at ${at}`);
  const document = value as Partial<KnowledgeDocumentIdentity>;
  if (document.id !== safeDocumentId(id) || document.source !== 'current' || document.scope !== scope
    || typeof document.title !== 'string' || document.title.trim() === '' || typeof document.sourcePath !== 'string'
    || !/^[a-f0-9]{64}$/.test(document.sha256 ?? '') || typeof document.bytes !== 'number' || !Number.isInteger(document.bytes) || document.bytes < 0
    || !['text/markdown', 'text/plain', 'application/pdf'].includes(String(document.mediaType))) {
    throw new Error(`knowledge document metadata does not match its durable scope at ${at}`);
  }
  return document as KnowledgeDocumentIdentity;
}

async function currentDocumentMetadata(root: string, scope: string, id: string): Promise<{ readonly document: KnowledgeDocumentIdentity; readonly bytes: Uint8Array }> {
  const at = currentMetadataAt(root, scope, id);
  let document: KnowledgeDocumentIdentity;
  try {
    await plainPath(canonicalKnowledgeRoot(root), at, 'file');
    document = parseCurrentDocumentIdentity(JSON.parse(await readFile(at, 'utf8')) as unknown, at, scope, id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // v1 stored identity beside the cache. Migrate only after validating the source under the owned
    // root; subsequent reads no longer depend on that cache for metadata.
    const legacyAt = currentIndexAt(root, scope, id);
    await plainPath(canonicalKnowledgeRoot(root), legacyAt, 'file');
    const legacy = parseKnowledgeIndex(JSON.parse(await readFile(legacyAt, 'utf8')) as unknown, legacyAt);
    document = parseCurrentDocumentIdentity(legacy.document, legacyAt, scope, id);
    await writeFile(at, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  }
  await plainPath(canonicalKnowledgeRoot(root), document.sourcePath, 'file');
  const bytes = await readFile(document.sourcePath);
  if (hash(bytes) !== document.sha256 || bytes.byteLength !== document.bytes) {
    throw new Error(`knowledge source bytes do not match durable identity at ${document.sourcePath}`);
  }
  return { document, bytes };
}

function parseKnowledgeIndex(value: unknown, at: string): KnowledgeDocumentIndex {
  const index = value as Partial<KnowledgeDocumentIndex>;
  if (index.schema !== KNOWLEDGE_INDEX_SCHEMA || !index.document || !Array.isArray(index.chunks)) throw new Error(`invalid knowledge index at ${at}`);
  safeDocumentId(index.document.id);
  if (index.chunks.some((chunk) => chunk.documentId !== index.document!.id || chunk.sha256 !== hash(chunk.text))) throw new Error(`changed knowledge chunks at ${at}`);
  return index as KnowledgeDocumentIndex;
}

async function readCurrentIndex(root: string, scope: string, id: string): Promise<KnowledgeDocumentIndex> {
  const at = currentIndexAt(root, scope, id);
  const held = await currentDocumentMetadata(root, scope, id);
  const document = held.document;
  const rebuilt = await indexKnowledgeBytes({ sourcePath: document.sourcePath, bytes: held.bytes, title: document.title,
    ...(document.version === undefined ? {} : { version: document.version }), scope, source: 'current' });
  const durable = { ...rebuilt, document };
  let valid = false;
  // Path safety is distinct from cache validity. A link or a path escape is never repaired through;
  // an ordinary malformed, truncated or forged index is just a cache miss and is rebuilt below.
  try { await plainPath(canonicalKnowledgeRoot(root), at, 'file'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    const index = parseKnowledgeIndex(JSON.parse(await readFile(at, 'utf8')) as unknown, at);
    valid = index.document.id === document.id && index.document.sha256 === document.sha256
      && JSON.stringify(index.chunks) === JSON.stringify(rebuilt.chunks);
  } catch { /* all ordinary index failures are rebuildable after source verification */ }
  // `index.json` is a cache. Rebuild it only after the separately stored identity and source bytes
  // have both verified; a forged cache is never returned, and a corrupt source remains a refusal.
  if (!valid) {
    const staged = `${at}.next-${process.pid}-${Date.now()}`;
    await writeFile(staged, `${JSON.stringify(durable, null, 2)}\n`, { mode: 0o600 });
    await rename(staged, at);
  }
  return durable;
}

/** Copy a user-selected document into Hima's current-knowledge root and publish its index atomically.
 * Re-importing identical bytes is idempotent and never mutates a Pack. */
export async function importCurrentKnowledge(input: {
  readonly root: string; readonly scope: string; readonly file: string; readonly title?: string; readonly version?: string;
}): Promise<KnowledgeDocumentIndex> {
  const sourceFile = await plainSource(input.file);
  await mkdir(path.resolve(input.root), { recursive: true });
  const ownedRoot = await realpath(path.resolve(input.root));
  await plainPath(path.parse(ownedRoot).root, ownedRoot, 'directory');
  const parsed = await indexKnowledgeDocument({ ...input, file: sourceFile, source: 'current' });
  const scopeDir = scopeDirectory(input.root, input.scope);
  const target = path.join(scopeDir, parsed.document.id);
  try { return await readCurrentIndex(input.root, input.scope, parsed.document.id); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(scopeDir, { recursive: true });
  await plainPath(canonicalKnowledgeRoot(input.root), scopeDir, 'directory');
  const staged = `${target}.next-${process.pid}-${Date.now()}`;
  await mkdir(staged, { recursive: false });
  try {
    const extension = path.extname(sourceFile).toLowerCase();
    const stagedSourcePath = path.join(staged, `source${extension}`);
    const sourcePath = path.join(target, `source${extension}`);
    await copyFile(sourceFile, stagedSourcePath, 0);
    const copied = await readFile(stagedSourcePath);
    if (hash(copied) !== parsed.document.sha256 || copied.byteLength !== parsed.document.bytes) {
      throw new Error('knowledge source changed while it was being imported');
    }
    const durable: KnowledgeDocumentIndex = { ...parsed, document: { ...parsed.document, sourcePath } };
    await writeFile(path.join(staged, 'document.json'), `${JSON.stringify(durable.document, null, 2)}\n`, { mode: 0o600 });
    await writeFile(path.join(staged, 'index.json'), `${JSON.stringify(durable, null, 2)}\n`, { mode: 0o600 });
    await rename(staged, target);
    return durable;
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}

export async function listCurrentKnowledge(root: string, scope: string): Promise<readonly KnowledgeDocumentIdentity[]> {
  const directory = scopeDirectory(root, scope);
  let names: string[];
  try { names = await readdir(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  await plainPath(canonicalKnowledgeRoot(root), directory, 'directory');
  const documents: KnowledgeDocumentIdentity[] = [];
  for (const id of names.filter((name) => /^[a-f0-9]{64}$/.test(name)).sort()) documents.push((await readCurrentIndex(root, scope, id)).document);
  return documents;
}

/** Remove only one explicitly identified current document. Pack knowledge and other scopes are
 * unreachable from this path. */
export async function clearCurrentKnowledge(root: string, scope: string, id: string): Promise<boolean> {
  const directory = path.dirname(currentIndexAt(root, scope, id));
  try { await plainPath(canonicalKnowledgeRoot(root), directory, 'directory'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  await rm(directory, { recursive: true, force: false });
  return true;
}

const queryTerms = (query: string): string[] => [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_.-]{2,}/gu) ?? [])];

const snippetOf = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, KNOWLEDGE_SNIPPET_CHARS);

export function searchKnowledgeIndexes(indexes: readonly KnowledgeDocumentIndex[], query: string, limit = 5): readonly KnowledgeSearchCandidate[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const phrase = query.trim().toLowerCase();
  const hits: KnowledgeSearchCandidate[] = [];
  for (const index of indexes) for (const chunk of index.chunks) {
    const text = chunk.text.toLowerCase();
    let score = phrase.length > 2 && text.includes(phrase) ? 20 : 0;
    for (const term of terms) {
      let at = text.indexOf(term), count = 0;
      while (at >= 0 && count < 8) { count++; at = text.indexOf(term, at + term.length); }
      score += count;
    }
    if (score > 0) hits.push({ id: chunk.id, documentId: chunk.documentId, ordinal: chunk.ordinal,
      ...(chunk.page === undefined ? {} : { page: chunk.page }), ...(chunk.section === undefined ? {} : { section: chunk.section }),
      sha256: chunk.sha256, document: index.document, score, snippet: snippetOf(chunk.text) });
  }
  return hits.sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id) || a.ordinal - b.ordinal)
    .slice(0, Math.max(1, Math.min(KNOWLEDGE_SEARCH_LIMIT, Math.floor(limit))));
}

export async function searchCurrentKnowledge(root: string, scope: string, query: string, limit = 5): Promise<readonly KnowledgeSearchCandidate[]> {
  const documents = await listCurrentKnowledge(root, scope);
  const indexes = await Promise.all(documents.map((document) => readCurrentIndex(root, scope, document.id)));
  return searchKnowledgeIndexes(indexes, query, limit);
}

export async function readCurrentKnowledge(root: string, scope: string, documentId: string, chunkId: string): Promise<KnowledgeSearchHit> {
  const index = await readCurrentIndex(root, scope, documentId);
  const chunk = index.chunks.find((item) => item.id === chunkId);
  if (!chunk) throw new Error(`unknown knowledge chunk ${JSON.stringify(chunkId)} in document ${documentId}`);
  return { ...chunk, text: chunk.text.slice(0, KNOWLEDGE_READ_CAP), sha256: hash(chunk.text.slice(0, KNOWLEDGE_READ_CAP)), document: index.document, score: 0 };
}

/** Build a bounded search view from the transparent knowledge files in one loaded Pack. */
async function packKnowledgeIndex(pack: Pack): Promise<readonly KnowledgeDocumentIndex[]> {
  const manifest = packKnowledgeManifestOf(pack);
  const metadata = new Map(manifest?.documents.map((document) => [document.file, document]) ?? []);
  return Promise.all(pack.contract.knowledge.map(async (declared) => {
    const found = metadata.get(declared.file);
    const relative = `knowledge/${declared.file}`;
    const bytes = pack.folder.files.get(relative);
    if (bytes === undefined) throw new Error(`Pack ${pack.id} does not hold ${relative} in its loaded snapshot`);
    return indexKnowledgeBytes({ bytes, sourcePath: path.join(pack.dir, relative), title: found?.title ?? declared.purpose,
      ...(found?.version === undefined ? {} : { version: found.version }), scope: `pack:${pack.id}@${pack.contract.version}`, source: 'pack' });
  }));
}

export async function searchPackKnowledge(pack: Pack, query: string, limit = 5): Promise<readonly KnowledgeSearchCandidate[]> {
  const indexes = await packKnowledgeIndex(pack);
  return searchKnowledgeIndexes(indexes, query, limit);
}

export async function readPackKnowledge(pack: Pack, documentId: string, chunkId: string): Promise<KnowledgeSearchHit> {
  const index = (await packKnowledgeIndex(pack)).find(item => item.document.id === safeDocumentId(documentId));
  if (!index) throw new Error(`unknown Pack knowledge document ${JSON.stringify(documentId)}`);
  const chunk = index.chunks.find(item => item.id === chunkId);
  if (!chunk) throw new Error(`unknown knowledge chunk ${JSON.stringify(chunkId)} in document ${documentId}`);
  const text = chunk.text.slice(0, KNOWLEDGE_READ_CAP);
  return { ...chunk, text, sha256: hash(text), document: index.document, score: 0 };
}

/** Record the exact excerpt that reached a Campaign Agent. Search hits alone are never evidence. */
export async function recordDocumentKnowledgeRead(input: {
  readonly ledger: Ledger; readonly packsDir?: string; readonly runId: string; readonly nodeId: string;
  readonly attempt: number; readonly sessionId: string; readonly workshop: string;
  /** Required for current documents: the Hima-owned root that selected this read. */
  readonly root?: string;
  readonly hit: KnowledgeSearchHit | KnowledgeSearchCandidate; readonly origin: 'document' | 'current'; readonly branchId?: string;
}): Promise<KnowledgeRecord> {
  const verified = input.hit.document.source === 'current'
    ? input.root === undefined ? (() => { throw new Error('current knowledge evidence requires its Hima-owned root'); })()
      : await readCurrentKnowledge(input.root, input.hit.document.scope, input.hit.document.id, input.hit.id)
    : await readPackDocumentIdentity(input.hit.document, input.hit.id);
  if (verified.document.id !== input.hit.document.id || verified.id !== input.hit.id || verified.sha256 !== input.hit.sha256) {
    throw new Error('knowledge read identity was not verified against durable source bytes');
  }
  const bytes = Buffer.from(verified.text, 'utf8');
  const sha256 = hash(bytes);
  const retainedPath = input.packsDir === undefined ? undefined
    : await retainRunMaterial({ ledger: input.ledger, packsDir: input.packsDir }, input.runId, bytes, sha256);
  return input.ledger.appendKnowledge(input.runId, {
    ...(input.branchId === undefined ? {} : { branchId: input.branchId }), origin: input.origin,
    ...(retainedPath === undefined ? {} : { retainedPath }), exposedBytes: bytes.byteLength,
    nodeId: input.nodeId, attempt: input.attempt, sessionId: input.sessionId, workshop: input.workshop,
    file: path.basename(verified.document.sourcePath), purpose: verified.document.title,
    path: verified.document.sourcePath, sha256, bytes: bytes.byteLength,
    sourceMaterialSha256: verified.document.sha256, sourceMaterialBytes: verified.document.bytes,
    documentId: verified.document.id, ...(verified.document.version === undefined ? {} : { documentVersion: verified.document.version }),
    chunkId: verified.id, ...(verified.page === undefined ? {} : { page: verified.page }),
    ...(verified.section === undefined ? {} : { section: verified.section }), knowledgeScope: verified.document.scope,
    conditions: [
      `Background knowledge selected for node ${input.nodeId}; current Campaign conclusions still require current execution evidence.`,
      `Source scope ${verified.document.scope}; document ${verified.document.id}${verified.document.version === undefined ? '' : ` version ${verified.document.version}`}.`,
    ],
  });
}

/** Rebuild the requested Pack chunk from its source before accepting it as Campaign evidence. */
async function readPackDocumentIdentity(document: KnowledgeDocumentIdentity, chunkId: string): Promise<KnowledgeSearchHit> {
  if (document.source !== 'pack') throw new Error('unsupported knowledge source identity');
  await plainSource(document.sourcePath);
  const rebuilt = await indexKnowledgeBytes({ sourcePath: document.sourcePath, bytes: await readFile(document.sourcePath), title: document.title,
    ...(document.version === undefined ? {} : { version: document.version }), scope: document.scope, source: 'pack' });
  if (rebuilt.document.id !== document.id || rebuilt.document.sha256 !== document.sha256 || rebuilt.document.bytes !== document.bytes) {
    throw new Error('Pack knowledge source bytes do not match document identity');
  }
  const chunk = rebuilt.chunks.find(item => item.id === chunkId);
  if (!chunk) throw new Error(`unknown knowledge chunk ${JSON.stringify(chunkId)} in document ${document.id}`);
  const text = chunk.text.slice(0, KNOWLEDGE_READ_CAP);
  return { ...chunk, text, sha256: hash(text), document: rebuilt.document, score: 0 };
}
