// The tool reports a Run's Pack leaves in its Campaign workspace (`contract.reports.dir`), as the
// Reports face lists and opens them: `<workspace>/<dir>/<node id>/r<round>/<file>` on the Run's Site,
// local or SSH. Display only — nothing here is Ledger evidence and nothing here writes.
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
import path from 'node:path';
import { channelFor, mustRun, type Channel } from './channel.js';
import { ReportPathError, SiteUnreadableError } from './errors.js';
import type { Ledger, RunRecord, WorkspaceRecord } from './ledger.js';
import { runGraphsOf } from './packs.js';
import type { RunReportFile, RunReportsView, RunReportText } from './remote.js';
import { loadRunPack } from './release.js';
import { existingRun } from './runs.js';
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
/** Files per `wc -c`: keeps one ssh command line far below the remote shell's argument limit. */
const sizeBatch = 100;

/** What reading a Run's reports needs of its Host. */
export interface RunReportsDeps {
  readonly ledger: Ledger;
  readonly sitesDir: string;
  readonly packsDir: string;
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

/** A failure to list, worded for the person reading the Reports face; no host path in it. */
class Unlistable extends Error {}

const inside = (real: string, root: string, p: path.PlatformPath): boolean =>
  real === root || real.startsWith(root.endsWith(p.sep) ? root : root + p.sep);

/** The Campaign workspace this Run was prepared in, if it was. */
const workspaceOf = (ledger: Ledger, runId: string): WorkspaceRecord | undefined =>
  ledger.records({ runId, type: 'workspace' }).findLast((r): r is WorkspaceRecord => r.type === 'workspace');

/**
 * The Host's reader of Run tool reports, with the two caches that keep it cheap: one listing per Run
 * for `reportListTtlMs` (shared by every viewer polling it, in-flight included), and the reports
 * folder and node order of each verified method, which never change for a given method digest.
 */
export class RunReports {
  readonly #deps: () => RunReportsDeps;
  readonly #ttlMs: number;
  readonly #lists = new Map<string, { readonly at: number; readonly view: Promise<RunReportsView> }>();
  readonly #methods = new Map<string, ReportsMethod>();

  constructor(deps: () => RunReportsDeps, ttlMs = reportListTtlMs) {
    this.#deps = deps;
    this.#ttlMs = ttlMs;
  }

  /** `GET /hima/api/runs/<id>/reports`. Throws only for a Run the Ledger does not hold. */
  list(runId: string): Promise<RunReportsView> {
    existingRun(this.#deps().ledger, runId);
    const now = Date.now();
    const held = this.#lists.get(runId);
    if (held !== undefined && now - held.at < this.#ttlMs) return held.view;
    for (const [id, entry] of this.#lists) if (now - entry.at >= this.#ttlMs) this.#lists.delete(id);
    const view = listRunReports(this.#deps(), runId, (run) => this.#method(run));
    this.#lists.set(runId, { at: now, view });
    view.catch(() => this.#lists.delete(runId));
    return view;
  }

  /** `GET /hima/api/runs/<id>/reports/file?path=`. */
  read(runId: string, relative: string): Promise<RunReportText> {
    return readRunReport(this.#deps(), runId, relative, (run) => this.#method(run));
  }

  #method(run: RunRecord): ReportsMethod {
    if (run.packId === undefined || run.packDigest === undefined) throw new Error(`run ${run.id} has no recorded Pack method`);
    const key = `${run.packId}@${run.packDigest}`;
    const held = this.#methods.get(key);
    if (held !== undefined) return held;
    const pack = loadRunPack(this.#deps().packsDir, run.packId, run.packDigest);
    const order = new Map<string, number>();
    for (const node of runGraphsOf(pack).flatMap(({ graph }) => graph.nodes)) if (!order.has(node.id)) order.set(node.id, order.size);
    const method: ReportsMethod = { ...(pack.contract.reports === undefined ? {} : { dir: pack.contract.reports.dir }), order };
    this.#methods.set(key, method);
    return method;
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
  for (let start = 0; start < files.length; start += sizeBatch) {
    const batch = files.slice(start, start + sizeBatch);
    const answer = await channel.exec(['wc', '-c', '--', ...batch]);
    const wanted = new Set(batch);
    for (const line of Buffer.from(answer.stdout).toString('utf8').split('\n')) {
      const match = /^\s*(\d+) (.+)$/.exec(line);
      if (match !== null && wanted.has(match[2]!)) sizes.set(match[2]!, Number(match[1]));
    }
  }
  return sizes;
}

/** The listing itself. Never throws for a Site that cannot be asked: it answers `error` instead. */
export async function listRunReports(deps: RunReportsDeps, runId: string, method: (run: RunRecord) => ReportsMethod): Promise<RunReportsView> {
  const at = new Date().toISOString();
  const run = existingRun(deps.ledger, runId);
  let reports: ReportsMethod;
  try { reports = method(run); } catch {
    return { files: [], at, error: 'The Pack method of this Run cannot be read here, so its reports cannot be listed.' };
  }
  if (reports.dir === undefined) return { files: [], at };
  const dir = reports.dir;
  const prepared = workspaceOf(deps.ledger, runId);
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

/** One report's bounded text. Throws `ReportPathError` for a path the caller cannot have meant. */
export async function readRunReport(deps: RunReportsDeps, runId: string, relative: string, method: (run: RunRecord) => ReportsMethod): Promise<RunReportText> {
  const run = existingRun(deps.ledger, runId);
  let reports: ReportsMethod;
  try { reports = method(run); } catch { throw new ReportPathError('The Pack method of this Run cannot be read here, so its reports cannot be opened.', true); }
  if (reports.dir === undefined) throw new ReportPathError("This Run's Pack declares no reports folder.", true);
  if (!reportPathPattern(reports.dir).test(relative) || relative.split('/').some((part) => part === '.' || part === '..')) {
    throw new ReportPathError(`"${relative}" is not a report path; a report path is ${reports.dir}/<node>/r<round>/<file>`);
  }
  const prepared = workspaceOf(deps.ledger, runId);
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
  const text = textOf(truncated ? head.stdout.subarray(0, reportReadLimit) : head.stdout, truncated);
  if (text === undefined) throw new ReportPathError(`${relative} is a binary file, not a text report.`);
  return { path: relative, text, truncated };
}
