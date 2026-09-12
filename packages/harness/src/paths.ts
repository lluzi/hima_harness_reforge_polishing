// Where the harness's own document and its own routes are, on the host that serves them. One reason
// to change: the shape of the URLs a person's browser asks the harness for.
//
// **A leaf: no imports at all**, and nothing here reaches a filesystem, a Site or a storage domain.
// That is the whole point of the file. Three modules need these paths and they cannot reach one
// another — `remote.ts` mounts the routes and imports the page renderer; `workbench.ts` renders the
// page, so it cannot import `remote.ts` back; `card-labels.ts` and `client/api.ts` are in the
// browser bundle, where a runtime import of either of those would ship the host's own routing and
// rendering to every browser. Each of them therefore held its own spelling of `/hima/api`, three
// tasks running deeper into the same workaround (the final review of step 3b, H3). A leaf both sides
// import is the fix the dependency direction was asking for.
//
// The builders are here rather than beside their callers for the same reason the two constants are:
// a route a face links to and the route the host mounts are one string, and the day the namespace
// moves is the day this file changes and nothing else does.

/** The Hima namespace: every route the harness answers hangs under this. */
export const HIMA_API_PREFIX = '/hima/api';

/** The workbench page's own path under the host's origin, which is a document and not an operation. */
export const HIMA_WORKBENCH_PATH = '/hima/';

/** Where the Runs live: the list, and each Run under it. */
export const HIMA_RUNS_PATH = `${HIMA_API_PREFIX}/runs`;

/** Where the start form posts. `POST` on the collection starts a Run; this is the explicit spelling
 *  the page's own form uses. */
export const HIMA_RUNS_START_PATH = `${HIMA_RUNS_PATH}/start`;

/** The same local Pack/Site preparation used by both workbench presentations. */
export const HIMA_START_OPTIONS_PATH = `${HIMA_API_PREFIX}/start-options`;

/** One Run's own route, which is what the card reads itself from. */
export const runPath = (runId: string): string => `${HIMA_RUNS_PATH}/${encodeURIComponent(runId)}`;

/** Where a control acts on a Run: stop it, or carry a waiting one on. */
export const runActionPath = (runId: string, action: 'cancel' | 'resume'): string => `${runPath(runId)}/${action}`;

/** Where a Model moment is opened on a Run (#59): the mechanism's one route, on the Run it belongs
 *  to, because a moment happens at a node of a Run and nowhere else. */
export const runMomentPath = (runId: string): string => `${runPath(runId)}/moment`;

/** The Markdown of a Run's technical report, as the Site has it: the `.md` route, read back and held
 *  against its recorded hash on the way through (#30). */
export const experienceMarkdownPath = (runId: string): string => `${runPath(runId)}/experience.md`;

/** Where the workbench shows one Run: the page's own path with the Run named on it, which is where
 *  the run list's links and the start form's landing both go. */
export const runCardPath = (runId: string): string => `${HIMA_WORKBENCH_PATH}?run=${encodeURIComponent(runId)}`;


/** A contract output is relative to its Campaign, before Permit resolves the real filesystem. */
export function campaignRelativePath(value: string, what: string): string {
  if (!value || /^(?:\/|[A-Za-z]:|\\)/.test(value) || value.split('/').some((segment) => segment === '..')) {
    throw new Error(`${what} must be a relative path inside the Campaign workspace: ${JSON.stringify(value)}`);
  }
  return value;
}
