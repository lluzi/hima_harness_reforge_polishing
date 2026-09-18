// The browser side of the Hima remote interface: one fetch wrapper over the `/hima/api/` namespace,
// and the only place the HimaGuide module talks to the host. The wire contract lives in
// `../remote.ts`; this file imports it as types alone, so nothing host-side reaches the bundle.
import type { ExecutionContext } from '../fabric.js';
import type { CampaignFile } from '../campaign-file.js';
import type { CampaignFileView, HimaErrorBody, HimaErrorCode, LogTailView, MaterialAnswer, RunHeadView, RunView, SiteDiscoverBody, SiteHeadView } from '../remote.js';
import type { SiteDiscoveryResult } from '../sites.js';
import type { StartChoices } from '../workbench.js';
import { answeredWithNoCode, answeredWithoutJson, couldNotReach } from '../card-labels.js';
import { HIMA_CAMPAIGN_FILE_PATH, HIMA_RUNS_PATH, HIMA_RUNS_START_PATH, HIMA_SITES_PATH, HIMA_START_OPTIONS_PATH, runActionPath, runLogTailPath, runPath, siteDiscoverPath } from '../paths.js';

/**
 * Why a Hima request did not answer. `hima/unreachable` is the one code minted here rather than by
 * the host: the request never got an answer at all. Every other code is the host's own.
 */
export interface HimaFailure {
  readonly code: HimaErrorCode | 'hima/unreachable';
  readonly message: string;
  /** `hima/campaign-file-changed` alone: the file exactly as the Host now has it, so a caller who
   *  lost the save race can reconcile without a separate re-read (#41 task 7 review). */
  readonly current?: CampaignFileView;
}

/** A remote answer, coded either way: a failure is a value the caller must render, not an exception. */
export type HimaResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HimaFailure };

function failureFrom(status: number, body: unknown): HimaFailure {
  const error = (body as Partial<HimaErrorBody> | null)?.error;
  if (error && typeof error.code === 'string' && typeof error.message === 'string') {
    return { code: error.code, message: error.message, ...(error.current === undefined ? {} : { current: error.current }) };
  }
  return { code: 'hima/unreachable', message: answeredWithNoCode(String(status)) };
}

/**
 * Read one Run through the Hima namespace: the run, its observations and refusals, and its
 * verdicts with every citation already resolved to the observation it was read from.
 *
 * @param runId - the run to read.
 * @param signal - cancellation from the caller's render lifetime.
 * @returns the run view, or the coded reason there is none.
 */
export function fetchRun(runId: string, signal?: AbortSignal): Promise<HimaResult<RunView>> {
  return runRequest<RunView>(runPath(runId), { signal });
}

/** Read one Run-owned code or knowledge version after the Host has held it to its recorded hash. */
export function fetchMaterial(runId: string, recordId: string, signal?: AbortSignal): Promise<HimaResult<MaterialAnswer>> {
  return runRequest(`${runPath(runId)}/material/${encodeURIComponent(recordId)}`, { signal });
}

export function fetchArchive(runId: string, material?: string, signal?: AbortSignal): Promise<HimaResult<{ manifest: import('../experience-report.js').RunAssetManifest; text?: string }>> {
  return runRequest(`${runPath(runId)}/assets${material === undefined ? '' : `?material=${encodeURIComponent(material)}`}`, { signal });
}

export const fetchRuns = (signal?: AbortSignal): Promise<HimaResult<{ runs: RunHeadView[] }>> =>
  runRequest(HIMA_RUNS_PATH, { signal });

export function fetchStartChoices(pack?: string, site?: string, signal?: AbortSignal): Promise<HimaResult<StartChoices>> {
  const query = new URLSearchParams();
  if (pack !== undefined) query.set('pack', pack);
  if (site !== undefined) query.set('site', site);
  return runRequest(`${HIMA_START_OPTIONS_PATH}?${query}`, { signal });
}

export const startCampaign = (body: Record<string, unknown>, signal?: AbortSignal): Promise<HimaResult<RunView>> =>
  runRequest(HIMA_RUNS_START_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

export const reviewPackTransfer = (body: import('../remote.js').PackTransferBody & { sessionId: string }, signal?: AbortSignal): Promise<HimaResult<import('../release.js').PackTransferReview>> =>
  runRequest('/hima/api/packs/transfer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

/** Read the session's own Campaign file (#41 task 7): the draft exactly as the Host has it, and —
 *  once it names a Pack — the same preparation shape `fetchStartChoices` answers, computed with this
 *  file's own overrides. */
export function fetchCampaignFile(sessionId: string, signal?: AbortSignal): Promise<HimaResult<CampaignFileView>> {
  const query = new URLSearchParams({ session: sessionId });
  return runRequest(`${HIMA_CAMPAIGN_FILE_PATH}?${query}`, { signal });
}

/** Write the session's own Campaign file. `file` is handed to the Host unvalidated — its own schema
 *  check runs once, there, and a rejection answers the same one-sentence message a hand-edited file
 *  on disk would. */
export function saveCampaignFile(sessionId: string, file: CampaignFile, expectedMtimeMs?: number, signal?: AbortSignal): Promise<HimaResult<CampaignFileView>> {
  return runRequest(HIMA_CAMPAIGN_FILE_PATH, { method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, file, ...(expectedMtimeMs === undefined ? {} : { expectedMtimeMs }) }), signal });
}

/** Every saved Site (#41 task 4): what the Configuration page's Site picker and readiness roundel
 *  read, and nothing a Permit governs. */
export const fetchSites = (signal?: AbortSignal): Promise<HimaResult<{ sites: readonly SiteHeadView[] }>> =>
  runRequest(HIMA_SITES_PATH, { signal });

/** Learn a Site through the caller's own SSH identity (#41 task 4): a preview when `save` is left
 *  false or absent, a saved Site and Permit file when it is true. No credential is read or stored. */
export function discoverSite(body: SiteDiscoverBody, signal?: AbortSignal): Promise<HimaResult<{ result: SiteDiscoveryResult; saved?: SiteHeadView; reviewId?: string }>> {
  return runRequest(siteDiscoverPath(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
}

export const fetchExecutionContext = (runId: string, signal?: AbortSignal): Promise<HimaResult<ExecutionContext>> =>
  runRequest(`${runPath(runId)}/context`, { signal });

/** The bounded tail of the running node's own Job log, for the one line the canvas draws under it. */
export function fetchLogTail(runId: string, nodeId: string, lines = 1, signal?: AbortSignal): Promise<HimaResult<LogTailView>> {
  const query = new URLSearchParams({ node: nodeId, lines: String(lines) });
  return runRequest(`${runLogTailPath(runId)}?${query}`, { signal });
}

export interface ControlRunResult {
  readonly run: RunView;
  readonly notification: { readonly status: 'queued' | 'inactive' | 'owner-unavailable' | 'failed' | 'not-repeated' | 'not-requested'; readonly message: string };
}

export function controlRun(view: RunView, sessionId: string, action: 'pause' | 'continue' | 'cancel', nodeId?: string, signal?: AbortSignal): Promise<HimaResult<ControlRunResult>> {
  const control = view.run.control;
  if (!control) return Promise.resolve({ ok: false, error: { code: 'hima/run-not-in-state', message: 'This Run has no conversational owner.' } });
  return runRequest(`${runPath(view.run.id)}/control`, { method: 'POST', signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, action,
      expectedEpoch: control.epoch, expectedRevision: control.revision, requestId: `ui-${crypto.randomUUID()}`,
      ...(nodeId === undefined ? {} : { nodeId }),
    }),
  });
}

/**
 * Act on one Run from the card: stop it, or carry a waiting one on. Both answer with the Run in the
 * very view `fetchRun` reads, so the card that asked renders the answer and never a second shape.
 *
 * The person the ledger records is the route's own answer — `workbench`, because a request through
 * the web app's session fence is a person at the workbench — so there is no body to send and none is
 * sent (ADR-0002).
 *
 * @param runId - the Run to act on.
 * @param action - stop it, or carry it on.
 * @param signal - cancellation from the caller's render lifetime.
 * @returns the Run as it now stands, or the coded reason it was refused.
 */
export function actOnRun(runId: string, action: 'cancel' | 'resume', signal?: AbortSignal): Promise<HimaResult<RunView>> {
  return runRequest(runActionPath(runId, action), { method: 'POST', signal });
}

/** One request to the namespace answering with a Run: a failure is a value the caller renders. */
async function runRequest<T>(target: string, init: RequestInit): Promise<HimaResult<T>> {
  let response: Response;
  try {
    response = await fetch(target, { ...init, headers: { ...init.headers, accept: 'application/json' } });
  } catch (err) {
    return { ok: false, error: { code: 'hima/unreachable', message: couldNotReach((err as Error).message) } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: { code: 'hima/unreachable', message: answeredWithoutJson(String(response.status)) } };
  }
  if (!response.ok) return { ok: false, error: failureFrom(response.status, body) };
  return { ok: true, value: body as T };
}
