// The browser side of the Hima remote interface: one fetch wrapper over the `/hima/api/` namespace,
// and the only place the HimaGuide module talks to the host. The wire contract lives in
// `../remote.ts`; this file imports it as types alone, so nothing host-side reaches the bundle.
import type { HimaErrorBody, HimaErrorCode, RunView } from '../remote.js';
import { answeredWithNoCode, answeredWithoutJson, couldNotReach } from '../card-labels.js';
import { runActionPath, runPath } from '../paths.js';

/**
 * Why a Hima request did not answer. `hima/unreachable` is the one code minted here rather than by
 * the host: the request never got an answer at all. Every other code is the host's own.
 */
export interface HimaFailure { readonly code: HimaErrorCode | 'hima/unreachable'; readonly message: string }

/** A remote answer, coded either way: a failure is a value the caller must render, not an exception. */
export type HimaResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HimaFailure };

function failureFrom(status: number, body: unknown): HimaFailure {
  const error = (body as Partial<HimaErrorBody> | null)?.error;
  if (error && typeof error.code === 'string' && typeof error.message === 'string') return { code: error.code, message: error.message };
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
  return runRequest(runPath(runId), { signal });
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
async function runRequest(target: string, init: RequestInit): Promise<HimaResult<RunView>> {
  let response: Response;
  try {
    response = await fetch(target, { ...init, headers: { accept: 'application/json' } });
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
  return { ok: true, value: body as RunView };
}
