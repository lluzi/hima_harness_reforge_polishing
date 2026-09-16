// Contract-test support: the browser's side of the Hima namespace. A booted web host hands out its
// session at a tokened URL, exactly once, and every later request carries that cookie — the same
// fence `/api` sits behind (ADR-0002). These three helpers are how a test and the acceptance script
// both reach `/hima/api/...`, so neither can drift into talking to the host a different way.
import { HIMA_API_PREFIX, type ObserveBody } from '@hima/harness';
import type { BootedHost } from './boot-host.ts';

/**
 * Exchange the tokened boot URL for the web app's session cookie, the way a browser does.
 *
 * @param host - the booted web host.
 * @returns the `name=value` cookie to carry on every later request.
 */
export async function openSession(host: BootedHost): Promise<string> {
  const first = await fetch(host.url, { redirect: 'manual' });
  const cookie = first.headers.get('set-cookie')?.split(';')[0];
  if (first.status !== 303) throw new Error(`the tokened URL answered ${String(first.status)}, not the 303 that exchanges it for a session`);
  if (!cookie) throw new Error('the tokened URL issued no session cookie');
  return cookie;
}

/** One request to the host, carrying the browser session cookie. The host is whatever knows its URL:
 *  a booted subprocess, or the shell's `host` answer in driver mode. */
export function api(host: Pick<BootedHost, 'url'>, cookie: string, target: string, init: RequestInit = {}): Promise<Response> {
  const headers = { cookie, ...(init.headers as Record<string, string> | undefined) };
  return fetch(new URL(target, host.url), { ...init, headers });
}

/**
 * `POST /hima/api/observe`. The body is typed as the namespace declares it, and a malformed one is
 * allowed through on purpose: the tests that check the coded 400s must be able to send it.
 */
export function postObserve(host: BootedHost, cookie: string, body: ObserveBody | Record<string, unknown>): Promise<Response> {
  return api(host, cookie, `${HIMA_API_PREFIX}/observe`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Create a live conversation with a chosen workspace, through dsh's own public `session/create`
 * Host RPC — the same fixture seam `unified-workbench.test.ts` uses for `workspace/create`, over the
 * same `client-request` envelope every native session-management action already rides. Its answer
 * is the session id `agents.list()` carries, which is exactly what `?session=<id>` and a body's
 * `sessionId` name across the Hima namespace: no Electron window and no native folder picker are
 * needed to give a session a real, live cwd.
 *
 * @param host - the booted web host.
 * @param cookie - its browser session cookie.
 * @param cwd - the workspace this session's Agent stands in.
 * @returns the created session's id.
 */
export async function createLiveSession(host: BootedHost, cookie: string, cwd: string): Promise<string> {
  const response = await api(host, cookie, '/api/session/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `hima-session-${Date.now()}`, method: 'session/create', payload: { args: { request: { cwd } } } }),
  });
  const answer = await response.json() as { result?: { ok?: boolean; value?: { sessionId?: string } }; error?: unknown };
  if (answer.result?.ok !== true || typeof answer.result.value?.sessionId !== 'string') {
    throw new Error(`session/create did not answer a session id: ${JSON.stringify(answer)}`);
  }
  return answer.result.value.sessionId;
}
