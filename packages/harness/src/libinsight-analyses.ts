// Custom library analyses (ADR-0020, ADR-0021): a person asks the Guide a library question in the
// conversation, the Host writes the request onto the Site, prepares one Run of the analysis Pack with
// that request as its input, and the person's confirmation starts it as an ordinary Guide-confirmed Run. The admitted result is the
// Reader's own retained input bytes, read back here hash-checked; nothing is read from the Site to show it.
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { channelFor, mustRun } from './channel.js';
import { decideWrite } from './shell.js';
import { installedPacks, loadPack } from './packs.js';
import { installedSites, loadSite, pathsOf, type Site } from './sites.js';
import type { PreparationOverrides } from './campaign-file.js';
import type { PreparationView } from './workbench.js';
import type { StartRunRequest, StartRunResult } from './fabric.js';
import type { RunHeadView, RunView } from './remote.js';
import { HIMA_ANALYSIS_PAGE_PREFIX } from './paths.js';

export const libInsightAnalysisDefaults = { pack: 'libinsight-analysis', site: 'linglong-libinsight', requestBinding: 'analysisRequests', requestInput: 'analysisRequest', resultOutput: 'analysisResult' } as const;
const requestSchema = 'hima-libinsight-request/1';
const analysisSchema = 'hima-libinsight-analysis/1';
const maxResultBytes = 4 * 1024 * 1024;

export const libInsightAnalysisRequest = z.strictObject({
  question: z.string().trim().min(1).max(4000),
  sources: z.array(z.string().regex(/^\/[^\0]*$/, 'a source is an absolute Site path').refine(p => !p.split('/').includes('..'), 'a source path may not climb with ..')).max(32).default([]),
  buildsOn: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}@[1-9][0-9]*$/, 'build on an admitted analysis as id@version')).max(8).default([]),
});
export type LibInsightAnalysisRequest = z.input<typeof libInsightAnalysisRequest>;

/** The admitted delivery as the Pack Reader accepted it; only the fields the tab draws are typed here. */
export interface LibInsightAnalysisResult {
  readonly schema: typeof analysisSchema;
  readonly id: string;
  readonly version: number;
  readonly question: string;
  readonly summary: string;
  readonly sources: readonly { readonly path: string; readonly sha256Before: string; readonly sha256After: string }[];
  readonly datasets: Readonly<Record<string, { readonly columns: readonly { readonly name: string; readonly type: 'number' | 'string'; readonly unit?: string; readonly nullMeans?: string }[]; readonly rows: readonly (readonly (number | string | null)[])[] }>>;
  readonly plots: readonly { readonly id: string; readonly title: string; readonly kind: 'table' | 'bar' | 'line' | 'scatter' | 'heatmap'; readonly dataset: string; readonly x?: { readonly column: string; readonly label?: string }; readonly y?: { readonly column: string; readonly label?: string }; readonly series?: { readonly column: string }; readonly value?: { readonly column: string; readonly label?: string } }[];
  readonly code: { readonly main: { readonly path: string; readonly sha256: string; readonly text: string }; readonly files: readonly { readonly path: string; readonly sha256: string }[] };
  readonly run: { readonly command: string; readonly exitCode: number; readonly elapsedSeconds: number; readonly usedQualib: boolean };
  readonly assumptions: readonly string[];
  readonly limits: readonly string[];
}

export interface LibInsightAnalysisProposal {
  readonly proposalId: string;
  readonly ready: boolean;
  readonly requestId: string;
  readonly question: string;
  readonly sources: readonly string[];
  readonly buildsOn: readonly string[];
  readonly pack: { readonly id: string; readonly version: string };
  readonly site: string;
  readonly timeBoxMinutes: number;
  /** Why the preparation is not ready, in the preparation's own words. */
  readonly unknowns: readonly string[];
  readonly nextActions: readonly string[];
}

export interface LibInsightAnalysisEntry {
  readonly runId: string;
  readonly createdAt: string;
  readonly question?: string;
  readonly status?: RunHeadView['status'];
  /** The resident task's own projection, so a waiting or failed analysis says why. */
  readonly task?: { readonly state: string; readonly reason?: string };
  /** What the Reader accepted and whether admission put it in the Site library; the result itself is
   *  read once per Run through `detail`, never on every look at the list. */
  readonly analysis?: { readonly id?: string; readonly version?: number; readonly plotCount?: number; readonly admitted: boolean; readonly notAdmittedReason?: string; readonly resultSha256: string };
}

export interface LibInsightAnalysisDetail {
  readonly runId: string;
  readonly result?: LibInsightAnalysisResult;
  /** Present when the Reader-accepted result exists but cannot be shown, with the reason. */
  readonly resultUnavailable?: string;
  readonly admission: { readonly admitted: boolean; readonly reason?: string };
}

export type LibInsightAnalysesStatus =
  | { readonly available: false; readonly reason: string }
  | { readonly available: true; readonly pack: string; readonly site: string };

export interface LibInsightAnalysesDeps {
  readonly packsDir: string;
  readonly sitesDir: string;
  /** A file of this Host's own: which request each Run answers. */
  readonly indexFile: string;
  readonly pack?: string;
  readonly site?: string;
  preparation(pack: ReturnType<typeof loadPack>, site: Site, overrides: PreparationOverrides): PreparationView;
  startGuidedRun(request: StartRunRequest): Promise<StartRunResult>;
  listRunHeads(): Promise<readonly RunHeadView[]>;
  readRunView(runId: string): Promise<RunView | undefined>;
  readRetained(runId: string, record: { runId: string; bytes: number; retainedPath?: string; type: 'observation'; contentSha256: string }, maxBytes: number): Promise<Buffer>;
  authorize(sessionId: string, runId: string): Promise<unknown>;
  /** How many messages a person typed have reached this conversation (ADR-0021): a confirmation needs one
   *  after the proposal, so a Guide cannot confirm its own proposal in the turn that made it. */
  humanMessages?(sessionId: string): number;
  /** Writes a new file on the Site; tests may replace it. */
  writeSiteFile?(site: Site, at: string, bytes: Uint8Array): Promise<string>;
  now?(): Date;
}

interface IndexRow { readonly requestId: string; readonly question: string; readonly sources: readonly string[]; readonly buildsOn: readonly string[]; readonly requestPath: string; readonly createdAt: string; readonly runId?: string }
interface Pending { readonly sessionId: string; readonly pack: string; readonly site: string; readonly overrides: PreparationOverrides; readonly proposal: PreparationView; readonly row: IndexRow; readonly humanMessages?: number }

export class LibInsightAnalysisError extends Error {
  constructor(readonly code: 'unavailable' | 'bad-request' | 'stale', message: string) { super(message); }
}

async function writeNewSiteFile(site: Site, at: string, bytes: Uint8Array): Promise<string> {
  try { return await writeRequestFile(site, at, bytes); }
  catch (error) {
    if (error instanceof LibInsightAnalysisError) throw error;
    throw new LibInsightAnalysisError('unavailable', `The request could not be written on the Site ${site.name}: ${(error as Error).message}`);
  }
}

async function writeRequestFile(site: Site, at: string, bytes: Uint8Array): Promise<string> {
  const on = channelFor(site);
  const directory = await decideWrite(site, pathsOf(site).dirname(at), on);
  if (!directory.ok) throw new LibInsightAnalysisError('unavailable', directory.reason);
  await mustRun(on, ['mkdir', '-p', '--', directory.absPath], 'create the analysis request folder');
  const file = await decideWrite(site, at, on);
  if (!file.ok) throw new LibInsightAnalysisError('unavailable', file.reason);
  if (!await on.absent(file.absPath)) throw new Error(`analysis request ${file.absPath} already exists`);
  await mustRun(on, ['tee', '--', file.absPath], 'write the analysis request', { stdin: bytes });
  const landed = Buffer.from(await on.readFile(file.absPath));
  if (!landed.equals(Buffer.from(bytes))) throw new Error(`analysis request ${file.absPath} did not land intact`);
  return file.absPath;
}

export function createLibInsightAnalyses(deps: LibInsightAnalysesDeps) {
  const packId = deps.pack ?? libInsightAnalysisDefaults.pack, siteName = deps.site ?? libInsightAnalysisDefaults.site;
  const pending = new Map<string, Pending>();
  const now = () => deps.now?.() ?? new Date();

  async function readIndex(): Promise<IndexRow[]> {
    try {
      const parsed = JSON.parse(await readFile(deps.indexFile, 'utf8')) as { schema?: string; requests?: IndexRow[] };
      return parsed.schema === 'hima-libinsight-analyses/1' && Array.isArray(parsed.requests) ? parsed.requests : [];
    } catch (error) {
      // The index only names each Run's question; a missing or unreadable one never hides the Runs.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }
  let indexWrite: Promise<unknown> = Promise.resolve();
  function recordRun(row: IndexRow, runId: string): Promise<void> {
    const next = indexWrite.then(async () => {
      const rows = (await readIndex()).filter(r => r.requestId !== row.requestId);
      rows.push({ ...row, runId });
      await mkdir(path.dirname(deps.indexFile), { recursive: true });
      const temp = `${deps.indexFile}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify({ schema: 'hima-libinsight-analyses/1', requests: rows }, null, 2)}\n`, { mode: 0o600 });
      await rename(temp, deps.indexFile);
    });
    indexWrite = next.catch(() => undefined);
    return next;
  }

  function status(): LibInsightAnalysesStatus {
    if (!installedPacks(deps.packsDir).includes(packId)) return { available: false, reason: `The analysis Pack ${packId} is not installed in this Home.` };
    if (!installedSites(deps.sitesDir).includes(siteName)) return { available: false, reason: `The Site ${siteName} is not installed in this Home.` };
    return { available: true, pack: packId, site: siteName };
  }
  function loaded() {
    const available = status();
    if (!available.available) throw new LibInsightAnalysisError('unavailable', available.reason);
    const site = loadSite(deps.sitesDir, siteName);
    const folder = site.bindings[libInsightAnalysisDefaults.requestBinding];
    if (typeof folder !== 'string' || !folder.startsWith('/')) throw new LibInsightAnalysisError('unavailable', `The Site ${siteName} binds no absolute ${libInsightAnalysisDefaults.requestBinding} folder.`);
    return { pack: loadPack(deps.packsDir, packId), site, folder };
  }

  async function propose(sessionId: string, input: LibInsightAnalysisRequest): Promise<LibInsightAnalysisProposal> {
    const parsed = libInsightAnalysisRequest.safeParse(input);
    if (!parsed.success) throw new LibInsightAnalysisError('bad-request', parsed.error.issues.map(i => `${i.path.join('.') || 'request'}: ${i.message}`).join('; '));
    const { pack, site, folder } = loaded();
    const at = now(), stamp = at.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const requestId = `req-${stamp}-${randomBytes(4).toString('hex').slice(0, 6)}`;
    const requestPath = pathsOf(site).join(folder, `${requestId}.json`);
    const body = { schema: requestSchema, requestId, question: parsed.data.question, sources: parsed.data.sources, buildsOn: parsed.data.buildsOn, createdAt: at.toISOString() };
    await (deps.writeSiteFile ?? writeNewSiteFile)(site, requestPath, Buffer.from(`${JSON.stringify(body, null, 2)}\n`));
    // A preparation with overrides fills no Goal from defaults; this Pack's Goal is its own declared one.
    const goal = Object.fromEntries(Object.entries(pack.contract.goal ?? {}).map(([name, declared]) => [name, declared.default]));
    const overrides: PreparationOverrides = { goal, inputs: { [libInsightAnalysisDefaults.requestInput]: requestPath } };
    const proposal = deps.preparation(pack, site, overrides);
    const row: IndexRow = { requestId, question: body.question, sources: body.sources, buildsOn: body.buildsOn, requestPath, createdAt: body.createdAt };
    for (const [id, held] of pending) if (held.sessionId === sessionId) pending.delete(id);
    const heard = deps.humanMessages?.(sessionId);
    pending.set(proposal.id, { sessionId, pack: packId, site: siteName, overrides, proposal, row, ...(heard === undefined ? {} : { humanMessages: heard }) });
    return { proposalId: proposal.id, ready: proposal.ready, requestId, question: body.question, sources: body.sources, buildsOn: body.buildsOn,
      pack: { id: pack.contract.id, version: pack.contract.version }, site: siteName, timeBoxMinutes: proposal.budget.timeBoxMinutes.value,
      unknowns: proposal.unknowns, nextActions: proposal.nextActions };
  }

  async function confirm(sessionId: string, proposalId: string): Promise<{ readonly runId: string; readonly kind: StartRunResult['kind'] }> {
    const held = pending.get(proposalId);
    if (!held || held.sessionId !== sessionId) throw new LibInsightAnalysisError('stale', 'This analysis proposal is no longer current in this conversation; ask again.');
    if (!held.proposal.ready) throw new LibInsightAnalysisError('bad-request', 'This analysis proposal is not ready; resolve what it lists first.');
    if (held.humanMessages !== undefined && (deps.humanMessages?.(sessionId) ?? 0) <= held.humanMessages) {
      throw new LibInsightAnalysisError('bad-request', 'The person has not answered this proposal yet. Show it to them and confirm only after they agree in this conversation.');
    }
    const started = await deps.startGuidedRun({ ownerSessionId: sessionId, proposalId, pack: held.pack, site: held.site,
      goal: held.proposal.goal, strategy: held.proposal.strategy, inputs: held.overrides.inputs, overrides: held.overrides } as StartRunRequest);
    if (started.kind === 'unfit') throw new LibInsightAnalysisError('bad-request', 'The Site cannot run this analysis Pack; open the Pack check for details.');
    pending.delete(proposalId);
    // The Run has started; failing to remember its question must not report it as not started.
    await recordRun(held.row, started.run.id).catch(() => undefined);
    return { runId: started.run.id, kind: started.kind };
  }

  type Observation = { type?: string; outputName?: string; runId: string; bytes: number; retainedPath?: string; contentSha256: string; values?: readonly { type?: string; value?: unknown }[] };
  const committed = (view: RunView | undefined, taskId: string) => view?.tasks?.find(task => task.taskId === taskId && task.current !== false && task.result)?.result?.value as Record<string, unknown> | undefined;
  /** The Reader's observation, as the resident task committed it: it names its output and the retained bytes. */
  function observationOf(view: RunView | undefined): Observation | undefined {
    const value = committed(view, 'custom-analysis') as { observations?: unknown } | undefined;
    return (Array.isArray(value?.observations) ? value.observations as Observation[] : [])
      .findLast(record => record.type === 'observation' && record.outputName === libInsightAnalysisDefaults.resultOutput);
  }
  /** Admitted only when admission committed this very result: the same bytes the Reader accepted. */
  function admissionOf(view: RunView | undefined, observation: Observation): { admitted: boolean; reason?: string; id?: string; version?: number } {
    const admission = committed(view, 'admit-analysis');
    const task = view?.tasks?.find(row => row.taskId === 'admit-analysis' && row.current !== false);
    const id = typeof admission?.id === 'string' ? admission.id : undefined, version = typeof admission?.version === 'number' ? admission.version : undefined;
    const named = { ...(id ? { id } : {}), ...(version ? { version } : {}) };
    if (admission?.admitted === true && admission.resultSha256 === observation.contentSha256) return { admitted: true, ...named };
    if (admission?.admitted === true) return { admitted: false, reason: 'admission recorded different result bytes than the Reader accepted', ...named };
    if (admission) return { admitted: false, reason: typeof admission.reason === 'string' ? admission.reason : 'admission declined it', ...named };
    if (task?.projection.state === 'failed') return { admitted: false, reason: task.projection.reason.message };
    return { admitted: false, reason: 'admission has not finished' };
  }

  function entryOf(head: RunHeadView, view: RunView | undefined, row: IndexRow | undefined): LibInsightAnalysisEntry {
    const projection = view?.tasks?.find(task => task.taskId === 'custom-analysis' && task.current !== false)?.projection;
    const observation = observationOf(view);
    const admission = observation ? admissionOf(view, observation) : undefined;
    const plotCount = observation?.values?.find(value => value.type === 'li_analysis_plot_count')?.value;
    return { runId: head.id, createdAt: head.createdAt, ...(row ? { question: row.question } : {}),
      ...(head.status ? { status: head.status } : {}),
      ...(projection ? { task: { state: projection.state, ...('reason' in projection ? { reason: projection.reason.message } : {}) } } : {}),
      ...(observation && admission ? { analysis: { ...(admission.id ? { id: admission.id } : {}), ...(admission.version ? { version: admission.version } : {}),
        ...(typeof plotCount === 'number' ? { plotCount } : {}), admitted: admission.admitted,
        ...(admission.reason ? { notAdmittedReason: admission.reason } : {}), resultSha256: observation.contentSha256 } } : {}) };
  }

  async function list(sessionId: string): Promise<{ readonly status: LibInsightAnalysesStatus; readonly analyses: readonly LibInsightAnalysisEntry[] }> {
    const index = await readIndex(), byRun = new Map(index.filter(r => r.runId).map(r => [r.runId!, r]));
    const heads = (await deps.listRunHeads()).filter(head => head.packId === packId);
    const analyses: LibInsightAnalysisEntry[] = [];
    for (const head of heads) {
      try { await deps.authorize(sessionId, head.id); } catch { continue; }
      analyses.push(entryOf(head, await deps.readRunView(head.id).catch(() => undefined), byRun.get(head.id)));
    }
    analyses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { status: status(), analyses };
  }

  /** One Run's summary, as `list` gives it, for a page or a tool that already knows the Run. */
  async function summary(sessionId: string, runId: string): Promise<LibInsightAnalysisEntry> {
    try { await deps.authorize(sessionId, runId); }
    catch { throw new LibInsightAnalysisError('bad-request', 'This analysis is not available in the selected project.'); }
    const head = (await deps.listRunHeads()).find(row => row.id === runId);
    if (head?.packId !== packId) throw new LibInsightAnalysisError('bad-request', 'This Run is not a library analysis.');
    const row = (await readIndex()).find(r => r.runId === runId);
    return entryOf(head, await deps.readRunView(runId).catch(() => undefined), row);
  }

  async function detail(sessionId: string, runId: string): Promise<LibInsightAnalysisDetail> {
    try { await deps.authorize(sessionId, runId); }
    catch { throw new LibInsightAnalysisError('bad-request', 'This analysis is not available in the selected project.'); }
    const view = await deps.readRunView(runId);
    if (view?.run.packId !== packId) throw new LibInsightAnalysisError('bad-request', 'This Run is not a library analysis.');
    const observation = observationOf(view);
    if (!observation) return { runId, admission: { admitted: false, reason: 'no Reader-accepted result yet' } };
    const admission = admissionOf(view, observation);
    const answer = { runId, admission: { admitted: admission.admitted, ...(admission.reason ? { reason: admission.reason } : {}) } };
    try {
      const bytes = await deps.readRetained(runId, { ...observation, type: 'observation' }, maxResultBytes);
      const value = JSON.parse(bytes.toString('utf8')) as LibInsightAnalysisResult;
      if (value?.schema !== analysisSchema || !Array.isArray(value.plots) || typeof value.datasets !== 'object' || value.datasets === null) return { ...answer, resultUnavailable: 'The accepted result is not a recognised analysis document.' };
      return { ...answer, result: value };
    } catch (error) {
      return { ...answer, resultUnavailable: `The accepted result cannot be read: ${(error as Error).message}` };
    }
  }

  /** What the Guide's `hima_insight_analysis` answers (ADR-0021): every action reads or starts through
   *  the same functions above, and a result is the Reader-accepted bytes, bounded for a conversation. */
  async function tool(sessionId: string, args: LibInsightAnalysisToolArgs): Promise<object> {
    const page = (runId: string) => analysisPagePath(runId, sessionId);
    if (args.action === 'propose') {
      if (args.question === undefined) throw new LibInsightAnalysisError('bad-request', 'propose needs the person\'s question');
      const proposal = await propose(sessionId, { question: args.question, sources: [...args.sources ?? []], buildsOn: [...args.buildsOn ?? []] });
      return { action: 'propose', ...proposal,
        next: proposal.ready ? 'Show this proposal to the person in your own words, ask whether to start it, and end your turn. Call confirm with this proposalId only after they explicitly agree in their next message.'
          : 'This proposal is not ready; tell the person what it lists and what would resolve it. Do not confirm it.' };
    }
    if (args.action === 'confirm') {
      if (args.proposalId === undefined) throw new LibInsightAnalysisError('bad-request', 'confirm needs the proposalId that propose returned');
      const started = await confirm(sessionId, args.proposalId);
      return { action: 'confirm', ...started, page: page(started.runId),
        next: 'Tell the person the analysis has started and that its page, opened with the Open analysis page button on this card, fills in as it runs. Do not paste the page path: it is not a link in the conversation. The Host notifies you when it ends; then call result.' };
    }
    if (args.action === 'list') {
      const answer = await list(sessionId);
      return { action: 'list', status: answer.status, analyses: answer.analyses.slice(0, 20).map(entry => ({ ...entry, page: page(entry.runId) })) };
    }
    if (args.runId === undefined) throw new LibInsightAnalysisError('bad-request', 'result needs the runId of an analysis');
    const entry = await summary(sessionId, args.runId);
    const read = await detail(sessionId, args.runId);
    const result = read.result;
    return { action: 'result', runId: args.runId, page: page(args.runId), ...(entry.status ? { status: entry.status } : {}), ...(entry.task ? { task: entry.task } : {}),
      admission: read.admission, ...(entry.analysis?.id && entry.analysis.version ? { analysis: `${entry.analysis.id}@${String(entry.analysis.version)}` } : {}),
      ...(read.resultUnavailable ? { resultUnavailable: read.resultUnavailable } : {}),
      ...(result ? { question: result.question, summary: result.summary, assumptions: result.assumptions, limits: result.limits,
        plots: result.plots.map(plot => ({ title: plot.title, kind: plot.kind, dataset: plot.dataset })),
        datasets: boundedDatasets(result.datasets), sources: result.sources, run: result.run } : {}),
      next: read.admission.admitted ? 'Explain the verified outcome from these datasets (the summary is the resident\'s reading of them) and name its limits. The charts are on the analysis page: point the person to the Open analysis page button on this result, and do not paste the page path, which is not a link in the conversation.'
        : 'Explain where the analysis stands or why it was not admitted, from these facts; do not present an unadmitted result as established.' };
  }

  return { status, propose, confirm, list, summary, detail, tool };
}

/** What one result answer may put into a conversation: rows, cell text and total serialized size. */
const toolRows = 40, toolCellChars = 200, toolDatasetBytes = 24 * 1024;

/** The datasets for a conversation: leading rows with short cells, shrunk until they fit the budget.
 *  The page has every row; `truncated` says where the conversation saw less. */
function boundedDatasets(datasets: LibInsightAnalysisResult['datasets']) {
  const cell = (value: number | string | null) => typeof value === 'string' && value.length > toolCellChars ? `${value.slice(0, toolCellChars - 1)}…` : value;
  for (const rows of [toolRows, 20, 10, 5, 0]) {
    const shown = Object.fromEntries(Object.entries(datasets).map(([name, data]) => [name, { columns: data.columns, rowCount: data.rows.length,
      rows: data.rows.slice(0, rows).map(row => row.map(cell)), ...(data.rows.length > rows ? { truncated: true } : {}) }]));
    if (JSON.stringify(shown).length <= toolDatasetBytes || rows === 0) return shown;
  }
  return {};
}
const finalTask = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * Settled: a Run with a status is settled only when it ended or was cancelled — admission and delivery
 * run after the resident task, so its success alone settles nothing. Without a Run status, a final
 * resident task, or knowing neither (nothing will change it by waiting), settles it.
 */
export function analysisSettled(entry: Pick<LibInsightAnalysisEntry, 'status' | 'task'>): boolean {
  if (entry.status !== undefined) return entry.status.startsWith('ended') || entry.status.startsWith('cancelled');
  return entry.task === undefined || finalTask.has(entry.task.state);
}

/** The page of one analysis, as the conversation links it (ADR-0021). */
export function analysisPagePath(runId: string, sessionId: string): string {
  return `${HIMA_ANALYSIS_PAGE_PREFIX}${encodeURIComponent(runId)}?session=${encodeURIComponent(sessionId)}`;
}

export interface LibInsightAnalysisToolArgs {
  readonly action: 'propose' | 'confirm' | 'list' | 'result';
  readonly question?: string;
  readonly sources?: readonly string[];
  readonly buildsOn?: readonly string[];
  readonly proposalId?: string;
  readonly runId?: string;
}
export type LibInsightAnalyses = ReturnType<typeof createLibInsightAnalyses>;
