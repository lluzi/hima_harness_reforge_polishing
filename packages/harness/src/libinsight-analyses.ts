// Data Insight's Resident analyses (ADR-0020, 2026-10-05 revision): a person asks a library question,
// the Host writes the request onto the Site, prepares one Run of the analysis Pack with that request as
// its input, and a confirmation starts it as an ordinary Guide-confirmed Run. The admitted result is the
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
import type { LedgerRecord } from './ledger.js';

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
  readonly result?: LibInsightAnalysisResult;
  /** Present when the admitted result exists but cannot be shown, with the reason. */
  readonly resultUnavailable?: string;
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
  readRunRecords(runId: string, type: 'observation'): Promise<readonly LedgerRecord[]>;
  readRetained(runId: string, record: { runId: string; bytes: number; retainedPath?: string; type: 'observation'; contentSha256: string }, maxBytes: number): Promise<Buffer>;
  authorize(sessionId: string, runId: string): Promise<unknown>;
  /** Writes a new file on the Site; tests may replace it. */
  writeSiteFile?(site: Site, at: string, bytes: Uint8Array): Promise<string>;
  now?(): Date;
}

interface IndexRow { readonly requestId: string; readonly question: string; readonly sources: readonly string[]; readonly buildsOn: readonly string[]; readonly requestPath: string; readonly createdAt: string; readonly runId?: string }
interface Pending { readonly sessionId: string; readonly pack: string; readonly site: string; readonly overrides: PreparationOverrides; readonly proposal: PreparationView; readonly row: IndexRow }

export class LibInsightAnalysisError extends Error {
  constructor(readonly code: 'unavailable' | 'bad-request' | 'stale', message: string) { super(message); }
}

async function writeNewSiteFile(site: Site, at: string, bytes: Uint8Array): Promise<string> {
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
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
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
    const overrides: PreparationOverrides = { inputs: { [libInsightAnalysisDefaults.requestInput]: requestPath } };
    const proposal = deps.preparation(pack, site, overrides);
    const row: IndexRow = { requestId, question: body.question, sources: body.sources, buildsOn: body.buildsOn, requestPath, createdAt: body.createdAt };
    for (const [id, held] of pending) if (held.sessionId === sessionId) pending.delete(id);
    pending.set(proposal.id, { sessionId, pack: packId, site: siteName, overrides, proposal, row });
    return { proposalId: proposal.id, ready: proposal.ready, requestId, question: body.question, sources: body.sources, buildsOn: body.buildsOn,
      pack: { id: pack.contract.id, version: pack.contract.version }, site: siteName, timeBoxMinutes: proposal.budget.timeBoxMinutes.value,
      unknowns: proposal.unknowns, nextActions: proposal.nextActions };
  }

  async function confirm(sessionId: string, proposalId: string): Promise<{ readonly runId: string; readonly kind: StartRunResult['kind'] }> {
    const held = pending.get(proposalId);
    if (!held || held.sessionId !== sessionId) throw new LibInsightAnalysisError('stale', 'This analysis proposal is no longer current in this conversation; ask again.');
    if (!held.proposal.ready) throw new LibInsightAnalysisError('bad-request', 'This analysis proposal is not ready; resolve what it lists first.');
    const started = await deps.startGuidedRun({ ownerSessionId: sessionId, proposalId, pack: held.pack, site: held.site,
      goal: held.proposal.goal, strategy: held.proposal.strategy, inputs: held.overrides.inputs, overrides: held.overrides } as StartRunRequest);
    if (started.kind === 'unfit') throw new LibInsightAnalysisError('bad-request', 'The Site cannot run this analysis Pack; open the Pack check for details.');
    pending.delete(proposalId);
    await recordRun(held.row, started.run.id);
    return { runId: started.run.id, kind: started.kind };
  }

  async function resultOf(runId: string): Promise<Pick<LibInsightAnalysisEntry, 'result' | 'resultUnavailable'>> {
    const observation = (await deps.readRunRecords(runId, 'observation')).findLast(record =>
      record.type === 'observation' && (record as { outputName?: string }).outputName === libInsightAnalysisDefaults.resultOutput);
    if (!observation || observation.type !== 'observation') return {};
    try {
      const bytes = await deps.readRetained(runId, observation as never, maxResultBytes);
      const value = JSON.parse(bytes.toString('utf8')) as LibInsightAnalysisResult;
      if (value?.schema !== analysisSchema || !Array.isArray(value.plots) || typeof value.datasets !== 'object') return { resultUnavailable: 'The admitted result is not a recognised analysis document.' };
      return { result: value };
    } catch (error) {
      return { resultUnavailable: `The admitted result cannot be read: ${(error as Error).message}` };
    }
  }

  async function list(sessionId: string): Promise<{ readonly status: LibInsightAnalysesStatus; readonly analyses: readonly LibInsightAnalysisEntry[] }> {
    const index = await readIndex(), byRun = new Map(index.filter(r => r.runId).map(r => [r.runId!, r]));
    const heads = (await deps.listRunHeads()).filter(head => head.packId === packId);
    const analyses: LibInsightAnalysisEntry[] = [];
    for (const head of heads) {
      try { await deps.authorize(sessionId, head.id); } catch { continue; }
      const view = await deps.readRunView(head.id).catch(() => undefined);
      const resident = view?.tasks?.find(task => task.taskId === 'custom-analysis' || task.tool === 'custom-analysis');
      const projection = resident?.projection;
      analyses.push({ runId: head.id, createdAt: head.createdAt, ...(byRun.get(head.id) ? { question: byRun.get(head.id)!.question } : {}),
        ...(head.status ? { status: head.status } : {}),
        ...(projection ? { task: { state: projection.state, ...('reason' in projection ? { reason: projection.reason.message } : {}) } } : {}),
        ...await resultOf(head.id) });
    }
    analyses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { status: status(), analyses };
  }

  return { status, propose, confirm, list };
}
export type LibInsightAnalyses = ReturnType<typeof createLibInsightAnalyses>;
