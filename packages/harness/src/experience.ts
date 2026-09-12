// HimaExperience: the Campaign's technical report, written on the Site when a Run ends (#30, D44).
//
// One reason to change: where a Campaign's experience is put and how it is read back. What it *says*
// is `experience-report.ts`, which is pure and reaches nothing; this is the half that touches a Site
// and the ledger.
//
// Two files, under the Campaign workspace beside the results: `<workspace>/hima-experience/<runId>.md`
// for the people who read it and `<runId>.json` for the programs that do. They are written where the
// results are, and left there, because the evidence of a Campaign belongs to the Site owner and
// outlives this harness's session (D19, D16, user story 35) — the ledger keeps only a hash of each,
// which is what lets a later reader hold the file it fetched against what the Campaign actually
// wrote.
//
// Every write goes through the Permit first (`decideWrite`), exactly as preparing a workspace does,
// and is sent with the same two verbs of the channel's workspace plumbing: `mkdir` for the directory
// and `tee` for the file, whose content travels on standard input and never on the wire. Reading a
// report back is `cat`, which is a read-only probe. Nothing here removes anything on a Site.
//
// **Written once, and only after both files are on the Site.** The `experience` record is the claim
// that the report is there, so it is appended last: a host that dies between the two files leaves a
// Run without the record, and the next boot's reconciliation writes the report again from records
// that have not moved. That is also the idempotence — a Run that carries the record is a Run whose
// report is written, and this module leaves the Site alone.
import { createHash } from 'node:crypto';
import { channelFor, mustRun, type Channel } from './channel.js';
import { experienceReport, EXPERIENCE_DIR, type ExperienceJson } from './experience-report.js';
import { hasEnded, type ExperienceFile, type ExperienceRecord, type Ledger, type RunRecord, type WorkspaceRecord } from './ledger.js';
import { runView, type RunWords } from './remote.js';
import { runPackWords } from './packs.js';
import { existingRun } from './runs.js';
import { decideRead, decideWrite } from './shell.js';
import { loadSite, pathsOf, type Site } from './sites.js';

/** What writing or reading an experience needs: the ledger it is recorded on, and where the Sites
 *  are installed. Narrower than `FabricDeps` on purpose — this reaches no pack and no judge — and
 *  structural, so a caller holding the whole of `FabricDeps` satisfies it. */
export interface ExperienceDeps {
  readonly ledger: Ledger;
  readonly sitesDir: string;
  /**
   * Where the packs are installed, for the words the report is written in (#42, #58): a Campaign's
   * report says its Goal and every generation's Strategy in the pack's own words, exactly as the
   * card does, and the pack is the only thing that knows them. A pack that can no longer be read
   * leaves the report saying the names, which is what every other face falls back to.
   */
  readonly packsDir: string;
}

/** What became of writing one Run's report. */
export type WriteExperienceResult =
  /** The two files are on the Site and the record is on the ledger. */
  | { readonly kind: 'written'; readonly record: ExperienceRecord }
  /** This Run already had its report; the Site was not touched and nothing was written. */
  | { readonly kind: 'already'; readonly record: ExperienceRecord }
  /**
   * There is no report to write, and that is an answer rather than a fault: a Run that has not
   * ended, a Run HimaFabric never started, one with no Campaign workspace to write beside, or one
   * whose Permit refused the path (which is recorded as a refusal, as every refused path is).
   */
  | { readonly kind: 'nothing'; readonly why: string };

/** What became of reading one Run's report back off the Site. */
export type ReadExperienceResult =
  | { readonly kind: 'read'; readonly record: ExperienceRecord; readonly markdown: string; readonly json: ExperienceJson }
  /** This Run has no `experience` record: it has not ended, or its report is still to be written. */
  | { readonly kind: 'none'; readonly why?: string }
  /** The file on the Site is not the one the record hashed: somebody has changed it since. */
  | { readonly kind: 'changed'; readonly file: 'markdown' | 'json'; readonly path: string; readonly recorded: string; readonly found: string }
  /** The Site answered, and what it said was that the file the record names cannot be read. */
  | { readonly kind: 'unreadable'; readonly file: 'markdown' | 'json'; readonly path: string; readonly recorded: string; readonly why: string };

/**
 * One write of one Run's report at a time, per Ledger and per Run.
 *
 * A Run can reach its ending from two faces at once — the drive returning from a Job that finished
 * while a person's cancel was composing the ending — and both of them ask for the report afterwards.
 * The idempotence above is a read of the ledger followed by two writes to a Site, so two callers
 * that both read "no record yet" would both write, and the Run would end up with two reports and two
 * records of one Campaign. Chained here, the second caller finds the first one's record and leaves.
 *
 * Keyed exactly as `claimingSlotOn` is keyed on a Site and `advancingRun` on a Run: a WeakMap on the
 * Ledger, so a disposed host's chains go with it.
 */
const writesPerRun = new WeakMap<Ledger, Map<string, Promise<unknown>>>();

function writingExperience(ledger: Ledger, runId: string, write: () => Promise<WriteExperienceResult>): Promise<WriteExperienceResult> {
  const chains = writesPerRun.get(ledger) ?? new Map<string, Promise<unknown>>();
  writesPerRun.set(ledger, chains);
  const ahead = chains.get(runId) ?? Promise.resolve();
  const mine = ahead.then(write);
  // Chained on a copy that settles either way, so one write that throws neither takes the next one
  // down with it nor leaves an unhandled rejection behind.
  chains.set(runId, mine.then(() => undefined, () => undefined));
  return mine;
}

/**
 * Write this Run's technical report, if it has ended and has not got one.
 *
 * Called from the three places a Run can be found ended: after `drive` returns, after `cancelRun`
 * ends one, and by `reconcileRuns` for a Run whose ending landed under a host that then went away.
 * All three call it the same way, and this decides whether there is anything to do — a caller that
 * asked the question itself would be a fourth answer to it.
 *
 * A Site that cannot be written raises, exactly as every other Site fault does: the Run's ending is
 * already on the ledger and stands, nothing here writes a record claiming a report that is not
 * there, and the next boot's reconciliation writes it.
 *
 * @param deps - the ledger, and where the Sites are installed.
 * @param runId - the Run whose Campaign this is.
 * @returns the record it wrote, the one that was already there, or why there was nothing to write.
 */
export function writeExperience(deps: ExperienceDeps, runId: string): Promise<WriteExperienceResult> {
  return writingExperience(deps.ledger, runId, () => writeOnce(deps, runId));
}

async function writeOnce(deps: ExperienceDeps, runId: string): Promise<WriteExperienceResult> {
  const run = existingRun(deps.ledger, runId);
  const held = experienceOf(deps.ledger, runId);
  if (held !== undefined) return { kind: 'already', record: held };
  if (!hasEnded(run.status)) {
    return { kind: 'nothing', why: `run ${runId} is ${run.status ?? 'not a run HimaFabric started'}, and a campaign's experience is written when its run ends` };
  }
  const prepared = workspaceOf(deps.ledger, runId);
  if (prepared === undefined) {
    // The one ending a Run can reach without a workspace: a Campaign blocked at its entry node
    // because preparation never finished, then cancelled. There is nowhere beside the results to
    // write, because there are no results — and this harness writes nothing outside a workspace.
    return { kind: 'nothing', why: `run ${runId} has no campaign workspace: nothing was prepared, so there is nowhere beside the results to write its experience` };
  }
  const site = loadSite(deps.sitesDir, run.siteId);
  const p = pathsOf(site);
  const channel = channelFor(site);
  const writtenAt = new Date().toISOString();
  let words: RunWords | undefined;
  try { words = runPackWords(deps.packsDir, run); }
  catch { /* Preserve the report's raw-name fallback if its original method is unavailable. */ }
  const report = experienceReport(runView(deps.ledger, run, words), writtenAt);

  const dir = p.join(prepared.workspace, EXPERIENCE_DIR);
  const directory = await decideWrite(site, dir, channel);
  if (!directory.ok) return refused(deps, runId, directory.refused, directory.reason);
  await mustRun(channel, ['mkdir', '-p', '--', directory.absPath], `create ${directory.absPath} on site ${site.name}`);

  const markdown = await writeFile(site, channel, p.join(directory.absPath, `${runId}.md`), report.markdown);
  if ('refusal' in markdown) return refused(deps, runId, markdown.refusal.refused, markdown.refusal.reason);
  const json = await writeFile(site, channel, p.join(directory.absPath, `${runId}.json`), `${JSON.stringify(report.json, null, 2)}\n`);
  if ('refusal' in json) return refused(deps, runId, json.refusal.refused, json.refusal.reason);

  // Last, and only now: the record is the claim that both files are there.
  return { kind: 'written', record: await deps.ledger.appendExperience(runId, { writtenAt, markdown: markdown.file, json: json.file }) };
}

/** This Run's experience record, which is the one thing that says its report is already written. */
export const experienceOf = (ledger: Ledger, runId: string): ExperienceRecord | undefined =>
  ledger.records({ runId, type: 'experience' }).findLast((r): r is ExperienceRecord => r.type === 'experience');

/** The Campaign workspace this Run was prepared in, and the pack that prepared it. */
const workspaceOf = (ledger: Ledger, runId: string): WorkspaceRecord | undefined =>
  ledger.records({ runId, type: 'workspace' }).findLast((r): r is WorkspaceRecord => r.type === 'workspace');

/** One file, decided by the Permit and then written; `tee` takes its content on standard input, so
 *  the wire stays a command whatever the report holds. */
async function writeFile(
  site: Site,
  channel: Channel,
  target: string,
  content: string,
): Promise<{ readonly file: ExperienceFile } | { readonly refusal: { readonly refused: string; readonly reason: string } }> {
  const decision = await decideWrite(site, target, channel);
  if (!decision.ok) return { refusal: { refused: decision.refused, reason: decision.reason } };
  const bytes = Buffer.from(content, 'utf8');
  await mustRun(channel, ['tee', '--', decision.absPath], `write ${decision.absPath} on site ${site.name}`, { stdin: bytes });
  return { file: { path: decision.absPath, sha256: hashOf(bytes), bytes: bytes.byteLength } };
}

/** The hash the record keeps, over the bytes the Site was given — never over the string that made
 *  them, so what is hashed is what is in the file. */
const hashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** A path the Permit refused: recorded as a refusal, as every refused path in this harness is, and
 *  answered as nothing written rather than as a fault. The Run's ending is untouched. */
async function refused(deps: ExperienceDeps, runId: string, path: string, reason: string): Promise<WriteExperienceResult> {
  await deps.ledger.appendRefusal(runId, { path, reason });
  return { kind: 'nothing', why: `the permit refused ${path}: ${reason}` };
}

/**
 * Read this Run's report back off the Site, and hold both files against the hashes the ledger keeps.
 *
 * The point of reading it back at all is the holding: a report is evidence, and evidence nobody
 * checked is a file on a machine. So a file that no longer hashes to what the Campaign wrote is
 * reported as changed and never served as the report — the whole answer of the route this backs.
 *
 * @param deps - the ledger, and where the Sites are installed.
 * @param runId - the Run whose report to read.
 * @returns both files, or that there is no record, or which of the two no longer matches it.
 */
export async function readExperience(deps: ExperienceDeps, runId: string): Promise<ReadExperienceResult> {
  const run = existingRun(deps.ledger, runId);
  const record = experienceOf(deps.ledger, runId);
  if (record === undefined) return { kind: 'none', why: runView(deps.ledger, run).experienceUnavailable ?? `run ${runId} has not ended and has no saved report` };
  const site = loadSite(deps.sitesDir, run.siteId);
  const channel = channelFor(site);
  const markdown = await readFile(site, channel, 'markdown', record.markdown);
  if ('problem' in markdown) return markdown.problem;
  const json = await readFile(site, channel, 'json', record.json);
  if ('problem' in json) return json.problem;
  let document: ExperienceJson;
  try {
    const parsed = JSON.parse(Buffer.from(json.bytes).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || !['hima-experience/1', 'hima-experience/2'].includes(parsed.schema)
      || parsed.runId !== runId || parsed.writtenAt !== record.writtenAt) {
      throw new Error('unsupported report schema or report identity does not match the recorded Run and write time');
    }
    document = parsed as ExperienceJson;
  } catch (error) {
    return { kind: 'unreadable', file: 'json', path: record.json.path, recorded: record.json.sha256, why: `the verified bytes are not a supported report: ${(error as Error).message}` };
  }
  return {
    kind: 'read', record,
    markdown: Buffer.from(markdown.bytes).toString('utf8'),
    json: document,
  };
}

/** One file read back with `cat`, a read-only probe, and held against the hash on the record. */
async function readFile(
  site: Site,
  channel: Channel,
  which: 'markdown' | 'json',
  file: ExperienceFile,
): Promise<{ readonly bytes: Uint8Array } | { readonly problem: ReadExperienceResult }> {
  const unreadable = (why: string): { readonly problem: ReadExperienceResult } =>
    ({ problem: { kind: 'unreadable', file: which, path: file.path, recorded: file.sha256, why } });
  const decision = await decideRead(site, file.path, channel);
  if (!decision.ok) return unreadable(decision.reason);
  const answer = await channel.exec(['cat', '--', decision.absPath]);
  if (answer.code !== 0) {
    const said = answer.stderr.trim();
    return unreadable(`cat exited ${answer.code} on site ${site.name}${said === '' ? '' : `: ${said}`}`);
  }
  const found = hashOf(answer.stdout);
  if (found !== file.sha256) {
    return { problem: { kind: 'changed', file: which, path: file.path, recorded: file.sha256, found } };
  }
  return { bytes: answer.stdout };
}

/** Whether this Run is one an ending left without its report — what a reconciliation asks of every
 *  Run it passes over, so the question is stated once and asked the same way everywhere. */
export const owesAnExperience = (ledger: Ledger, run: RunRecord): boolean =>
  hasEnded(run.status) && experienceOf(ledger, run.id) === undefined;
