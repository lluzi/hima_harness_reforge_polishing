// The tool reports a Run's Pack leaves in its Campaign workspace (`contract.reports.dir`), as the
// Reports face lists and opens them: `<workspace>/<dir>/<node id>/r<round>/<file>` on the Run's Site,
// local or SSH. Display only — nothing here is Ledger evidence and nothing here writes. A chart file
// (`<dir>/<node>/r<k>/<name>.chart.json`) is read the same way for `hima_chart` (`readChart`, its exact
// bytes; `chart-files.ts` validates them).
//
// Every read goes through the same machinery the Host reads any Run file with: the Site's own
// channel (its closed verb list, audited at the wire) and the Permit's `decideRead`, which resolves a
// path where it lives so a link out of the read roots is not a way around it. On top of that, both the
// listing and a report must resolve inside the Campaign workspace itself.
//
// Bounded throughout: the listing is one `find <reports root> -mindepth 3 -maxdepth 3 -type f -print0`
// (regular files exactly three levels down, links never followed, output capped by the channel), at
// most `reportListLimit` entries kept newest round first, and their sizes asked of `wc -c` in small
// batches; a report is read as its first `reportReadLimit` bytes with `head -c`, text only.
//
// On DBOS the three Run facts this needs come from the durable readers, not the Ledger: the Run
// itself (`readRun`), its Campaign workspace (`readRunRecords(runId, 'workspace')`, which the readers
// synthesize from the `preparation` flow fact), and its frozen method (`executionContext(runId).method`,
// whose `contract.reports.dir` is the folder and whose `reference` graph is the node order).
import path from 'node:path';
import { channelFor, mustRun, type Channel } from './channel.js';
import { ReportPathError, RunReferenceError, SiteUnreadableError } from './errors.js';
import type { createDurableViewReaders } from './durable-views.js';
import type { RunRecord, WorkspaceRecord } from './ledger.js';
import type { RunReportFile, RunReportsView, RunReportText } from './remote.js';
import { decideRead } from './shell.js';
import { loadSite, pathsOf, type Site } from './sites.js';

/** The most files one listing answers with; the oldest rounds are the ones left out. */
export const reportListLimit = 500;
/** The most bytes one report read returns; a longer report answers `truncated`. */
export const reportReadLimit = 256 * 1024;
/** How long one Run's listing is reused, so several viewers polling every ~10 s cost one listing. */
export const reportListTtlMs = 5_000;

const nodePattern = /^[a-z0-9][a-z0-9-]*$/;
const roundPattern = /^r([0-9]{1,3})$/;
const namePattern = /^[A-Za-z0-9._-]{1,120}$/;
/** Files per `wc -c`, and the most path bytes one `wc -c` carries: an ssh command multiplexed over a
 *  control master travels in one socket message, which macOS caps near 8 KiB, so long Campaign paths
 *  must go a few dozen at a time. */
const sizeBatch = 100;
const sizeBatchBytes = 3_000;

/** The durable readers this needs, and the Sites folder its Run's Site is loaded from. */
export interface RunReportsDeps {
  readonly readers: Pick<ReturnType<typeof createDurableViewReaders>, 'readRun' | 'readRunRecords' | 'executionContext'>;
  readonly sitesDir: string;
}

/** What the Run's own method says about its reports: the folder, and its nodes in graph order. */
interface ReportsMethod {
  readonly dir?: string;
  readonly order: ReadonlyMap<string, number>;
}

/** The one shape a report path may have: `<dir>/<node>/r<k>/<name>`, relative to the workspace. */
export function reportPathPattern(dir: string): RegExp {
  // `dir` is held to [a-z0-9_-] by the Pack schema, so it needs no escaping in a pattern.
  return new RegExp(`^${dir}/[a-z0-9][a-z0-9-]*/r[0-9]{1,3}/[A-Za-z0-9._-]{1,120}$`);
}

/** The one shape a Run chart path may have: a report path whose file is `<name>.chart.json`. */
export function chartPathPattern(dir: string): RegExp {
  return new RegExp(`^${dir}/[a-z0-9][a-z0-9-]*/r[0-9]{1,3}/[A-Za-z0-9._-]{1,120}\\.chart\\.json$`);
}

/** A failure to list, worded for the person reading the Reports face; no host path in it. */
class Unlistable extends Error {}

const inside = (real: string, root: string, p: path.PlatformPath): boolean =>
  real === root || real.startsWith(root.endsWith(p.sep) ? root : root + p.sep);

/** The Run itself, or `RunReferenceError` for one this Host does not hold. */
async function runOf(deps: RunReportsDeps, runId: string): Promise<RunRecord> {
  const run = await deps.readers.readRun(runId);
  if (run === undefined) throw new RunReferenceError(`There is no Run ${runId}.`);
  return run;
}

/** The Campaign workspace this Run was prepared in, if it was. */
async function workspaceOf(deps: RunReportsDeps, runId: string): Promise<WorkspaceRecord | undefined> {
  const records = await deps.readers.readRunRecords(runId, 'workspace');
  return records.findLast((r): r is WorkspaceRecord => r.type === 'workspace');
}

/** The reports folder and node order the Run's frozen method declares. */
async function methodOf(deps: RunReportsDeps, runId: string): Promise<ReportsMethod> {
  const context = await deps.readers.executionContext(runId);
  if (context.method === undefined) throw new Error(`run ${runId} has no recorded Pack method`);
  const order = new Map<string, number>();
  for (const node of context.method.reference.nodes) if (!order.has(node.id)) order.set(node.id, order.size);
  return { ...(context.method.contract.reports === undefined ? {} : { dir: context.method.contract.reports.dir }), order };
}

/**
 * The Host's reader of Run tool reports, with the listing cache that keeps it cheap: one listing per
 * Run for `reportListTtlMs` (shared by every viewer polling it, in-flight included).
 */
export class RunReports {
  readonly #deps: () => RunReportsDeps;
  readonly #ttlMs: number;
  readonly #lists = new Map<string, { readonly at: number; readonly view: Promise<RunReportsView> }>();

  constructor(deps: () => RunReportsDeps, ttlMs = reportListTtlMs) {
    this.#deps = deps;
    this.#ttlMs = ttlMs;
  }

  /** `GET /hima/api/runs/<id>/reports`. Throws only for a Run this Host does not hold. */
  async list(runId: string): Promise<RunReportsView> {
    const deps = this.#deps();
    await runOf(deps, runId);
    const now = Date.now();
    const held = this.#lists.get(runId);
    if (held !== undefined && now - held.at < this.#ttlMs) return held.view;
    for (const [id, entry] of this.#lists) if (now - entry.at >= this.#ttlMs) this.#lists.delete(id);
    const view = listRunReports(deps, runId);
    this.#lists.set(runId, { at: now, view });
    view.catch(() => this.#lists.delete(runId));
    return view;
  }

  /** `GET /hima/api/runs/<id>/reports/file?path=`. */
  read(runId: string, relative: string): Promise<RunReportText> {
    return readRunReport(this.#deps(), runId, relative);
  }

  /** One chart file's exact bytes (`hima_chart`): the same bounded, permit-checked read as a report,
   *  held to `chartPathPattern`. */
  readChart(runId: string, relative: string): Promise<RunReportBytes> {
    return readRunReportBytes(this.#deps(), runId, relative, chartShape);
  }
}

/** Where this Run's reports folder and workspace really are on the Site, or undefined when the
 *  folder is not there yet. Refuses a workspace or folder the Permit does not let it read, and a
 *  folder that resolves outside the workspace. */
async function locate(site: Site, channel: Channel, workspace: string, dir: string): Promise<{ readonly root: string; readonly workspace: string } | undefined> {
  const p = pathsOf(site);
  const ws = await decideRead(site, workspace, channel);
  if (!ws.ok) throw new Unlistable(`The Site ${site.name} does not permit reading this Run's Campaign workspace.`);
  const root = p.join(ws.absPath, dir);
  if (await channel.absent(root)) return undefined;
  const decided = await decideRead(site, root, channel);
  if (!decided.ok || !inside(decided.absPath, ws.absPath, p)) throw new Unlistable(`The reports folder of this Run on Site ${site.name} is outside its Campaign workspace.`);
  return { root: decided.absPath, workspace: ws.absPath };
}

/** Byte sizes of the listed files, asked of `wc -c` a batch at a time. A file that went away
 *  between the listing and this question simply has no size and is left out. */
async function sizesOf(channel: Channel, files: readonly string[]): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  for (const batch of sizeBatches(files)) {
    const answer = await channel.exec(['wc', '-c', '--', ...batch]);
    const wanted = new Set(batch);
    let answered = 0;
    for (const line of Buffer.from(answer.stdout).toString('utf8').split('\n')) {
      const match = /^\s*(\d+) (.+)$/.exec(line);
      if (match !== null && wanted.has(match[2]!)) { sizes.set(match[2]!, Number(match[1])); answered += 1; }
    }
    // `wc` answers 1 when a file went away and still sizes the rest; anything else with no sizes
    // at all (ssh's 255 among them) is a fault, never an empty folder.
    if (answered === 0 && answer.code !== 0 && answer.code !== 1) {
      throw new Error(`wc exited ${String(answer.code)}${answer.stderr.trim() ? `: ${answer.stderr.trim()}` : ''}`);
    }
  }
  return sizes;
}

/** The files in batches of at most `sizeBatch` paths and `sizeBatchBytes` path bytes (one path always fits). */
export function sizeBatches(files: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [], bytes = 0;
  for (const file of files) {
    const size = Buffer.byteLength(file) + 3;
    if (batch.length > 0 && (batch.length >= sizeBatch || bytes + size > sizeBatchBytes)) { batches.push(batch); batch = []; bytes = 0; }
    batch.push(file); bytes += size;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** The listing itself. Never throws for a Site that cannot be asked: it answers `error` instead. */
export async function listRunReports(deps: RunReportsDeps, runId: string): Promise<RunReportsView> {
  const at = new Date().toISOString();
  const run = await runOf(deps, runId);
  let reports: ReportsMethod;
  try { reports = await methodOf(deps, runId); } catch {
    return { files: [], at, error: 'The Pack method of this Run cannot be read here, so its reports cannot be listed.' };
  }
  if (reports.dir === undefined) return { files: [], at };
  const dir = reports.dir;
  const prepared = await workspaceOf(deps, runId);
  if (prepared === undefined) return { dir, files: [], at };
  let site: Site;
  try { site = loadSite(deps.sitesDir, run.siteId); } catch {
    return { dir, files: [], at, error: `The Site ${run.siteId} of this Run is not set up on this computer, so its reports cannot be listed.` };
  }
  const channel = channelFor(site);
  const p = pathsOf(site);
  try {
    const located = await locate(site, channel, prepared.workspace, dir);
    if (located === undefined) return { dir, files: [], at };
    const listed = await mustRun(channel, ['find', located.root, '-mindepth', '3', '-maxdepth', '3', '-type', 'f', '-print0'], `list the reports on site ${site.name}`);
    const found: { readonly node: string; readonly round: number; readonly roundDir: string; readonly name: string; readonly abs: string }[] = [];
    for (const abs of listed.split('\0')) {
      if (!abs.startsWith(located.root + p.sep)) continue;
      const parts = abs.slice(located.root.length + 1).split(p.sep);
      if (parts.length !== 3) continue;
      const [node, roundDir, name] = parts as [string, string, string];
      const round = roundPattern.exec(roundDir);
      if (round === null || !nodePattern.test(node) || !namePattern.test(name) || name === '.' || name === '..') continue;
      found.push({ node, round: Number(round[1]), roundDir, name, abs });
    }
    const rank = (node: string): number => reports.order.get(node) ?? Number.MAX_SAFE_INTEGER;
    found.sort((a, b) => b.round - a.round || rank(a.node) - rank(b.node) || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0)
      || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const kept = found.slice(0, reportListLimit);
    const sizes = await sizesOf(channel, kept.map((file) => file.abs));
    const files: RunReportFile[] = kept.flatMap((file) => {
      const bytes = sizes.get(file.abs);
      return bytes === undefined ? [] : [{ node: file.node, round: file.round, name: file.name, path: `${dir}/${file.node}/${file.roundDir}/${file.name}`, bytes }];
    });
    return { dir, files, at };
  } catch (error) {
    const sentence = error instanceof Unlistable ? error.message
      : error instanceof SiteUnreadableError ? `The Site ${site.name} could not be reached, so the reports cannot be listed right now.`
        : `The reports on Site ${site.name} could not be listed right now.`;
    return { dir, files: [], at, error: sentence };
  }
}

/** Whether these bytes are a text report: UTF-8 with no NUL. A read cut at the bound may end inside a
 *  character, so up to three trailing bytes are let go before deciding. */
function textOf(bytes: Uint8Array, truncated: boolean): string | undefined {
  if (bytes.includes(0)) return undefined;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let cut = 0; cut <= (truncated ? 3 : 0) && cut <= bytes.byteLength; cut += 1) {
    try { return decoder.decode(bytes.subarray(0, bytes.byteLength - cut)); } catch { /* try one byte shorter */ }
  }
  return undefined;
}

/** Which paths a read accepts, and how a refusal names that shape. */
interface ReportShape {
  readonly pattern: (dir: string) => RegExp;
  readonly what: string;
  readonly shape: (dir: string) => string;
}
const reportShape: ReportShape = { pattern: reportPathPattern, what: 'a report path', shape: (dir) => `a report path is ${dir}/<node>/r<round>/<file>` };
const chartShape: ReportShape = { pattern: chartPathPattern, what: 'a Run chart path', shape: (dir) => `a Run chart is ${dir}/<node>/r<round>/<name>.chart.json` };

/** One report's exact first bytes, bounded, and whether there were more. */
export interface RunReportBytes {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
}

/** One report's bounded bytes, under `pattern`. Throws `ReportPathError` for a path the caller cannot
 *  have meant, one that is missing or one that leads out of the Campaign workspace. */
export async function readRunReportBytes(deps: RunReportsDeps, runId: string, relative: string,
  shape: ReportShape = reportShape): Promise<RunReportBytes> {
  const run = await runOf(deps, runId);
  let reports: ReportsMethod;
  try { reports = await methodOf(deps, runId); } catch { throw new ReportPathError('The Pack method of this Run cannot be read here, so its reports cannot be opened.', true); }
  if (reports.dir === undefined) throw new ReportPathError("This Run's Pack declares no reports folder.", true);
  if (!shape.pattern(reports.dir).test(relative) || relative.split('/').some((part) => part === '.' || part === '..')) {
    throw new ReportPathError(`"${relative}" is not ${shape.what}; ${shape.shape(reports.dir)}`);
  }
  const prepared = await workspaceOf(deps, runId);
  if (prepared === undefined) throw new ReportPathError('This Run has no Campaign workspace yet, so it has no reports.', true);
  const site = loadSite(deps.sitesDir, run.siteId);
  const channel = channelFor(site);
  const p = pathsOf(site);
  const ws = await decideRead(site, prepared.workspace, channel);
  if (!ws.ok) throw new ReportPathError(`The Site ${site.name} does not permit reading this Run's Campaign workspace.`);
  const target = p.join(ws.absPath, ...relative.split('/'));
  if (await channel.absent(target)) throw new ReportPathError(`There is no report at ${relative}.`, true);
  const decided = await decideRead(site, target, channel);
  if (!decided.ok || !inside(decided.absPath, ws.absPath, p)) throw new ReportPathError(`${relative} resolves outside this Run's Campaign workspace.`);
  if ((await channel.exec(['test', '-f', decided.absPath])).code !== 0) throw new ReportPathError(`${relative} is not a file.`);
  const head = await channel.exec(['head', '-c', String(reportReadLimit + 1), '--', decided.absPath]);
  if (head.code !== 0) throw new Error(`cannot read ${relative} on site ${site.name}: head exited ${head.code}${head.stderr.trim() ? `: ${head.stderr.trim()}` : ''}`);
  const truncated = head.stdout.byteLength > reportReadLimit;
  return { path: relative, bytes: truncated ? head.stdout.subarray(0, reportReadLimit) : head.stdout, truncated };
}

/** One report's bounded text. Throws `ReportPathError` for a path the caller cannot have meant. */
export async function readRunReport(deps: RunReportsDeps, runId: string, relative: string): Promise<RunReportText> {
  const read = await readRunReportBytes(deps, runId, relative);
  const text = textOf(read.bytes, read.truncated);
  if (text === undefined) throw new ReportPathError(`${relative} is a binary file, not a text report.`);
  return { path: relative, text, truncated: read.truncated };
}
