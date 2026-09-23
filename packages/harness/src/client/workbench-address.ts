/** Browser-local view selection. Host authorization and TargetAddress resolution stay server-side. */
export type WorkbenchAddress =
  | { readonly kind: 'campaign'; readonly runId?: string }
  | { readonly kind: 'insight'; readonly reportRef?: string; readonly scope?: string }
  | { readonly kind: 'child'; readonly parentSessionId: string; readonly childSessionId: string }
  | { readonly kind: 'invalid'; readonly code: 'hima/invalid-view-address'; readonly message: string };

type NavigationParams = { readonly kind?: unknown; readonly runId?: unknown; readonly reportRef?: unknown; readonly scope?: unknown; readonly parentSessionId?: unknown; readonly childSessionId?: unknown };

const text = (value: unknown): string | undefined => typeof value === 'string' && value !== '' ? value : undefined;

const invalid = (message: string): WorkbenchAddress => ({ kind: 'invalid', code: 'hima/invalid-view-address', message });

/** Decode only the fields this client owns. Empty navigation is preparation; an explicit bad address is an error. */
export function workbenchAddressOf(params: unknown): WorkbenchAddress {
  if (params === undefined || params === null) return { kind: 'campaign' };
  if (typeof params !== 'object' || Array.isArray(params)) return invalid('A Workbench address must be an object.');
  const value = params as NavigationParams;
  if (value.kind === undefined) {
    if (value.runId === undefined) return { kind: 'campaign' };
    const runId = text(value.runId);
    return runId === undefined ? invalid('Campaign runId must be a non-empty string.') : { kind: 'campaign', runId };
  }
  if (value.kind === 'campaign') {
    if (value.runId === undefined) return { kind: 'campaign' };
    const runId = text(value.runId);
    return runId === undefined ? invalid('Campaign runId must be a non-empty string.') : { kind: 'campaign', runId };
  }
  if (value.kind === 'insight') {
    if (value.reportRef !== undefined && text(value.reportRef) === undefined) return invalid('Insight reportRef must be a non-empty string when present.');
    if (value.scope !== undefined && text(value.scope) === undefined) return invalid('Insight scope must be a non-empty string when present.');
    return { kind: 'insight', ...(text(value.reportRef) === undefined ? {} : { reportRef: text(value.reportRef)! }), ...(text(value.scope) === undefined ? {} : { scope: text(value.scope)! }) };
  }
  if (value.kind === 'child') {
    const parentSessionId = text(value.parentSessionId); const childSessionId = text(value.childSessionId);
    return parentSessionId === undefined || childSessionId === undefined
      ? invalid('Child addresses require non-empty parentSessionId and childSessionId.')
      : { kind: 'child', parentSessionId, childSessionId };
  }
  return invalid('Unknown Workbench address kind.');
}

/** A canonical tuple keeps local async keys collision-free even when identity strings contain punctuation. */
export const workbenchAddressKey = (address: WorkbenchAddress): string => address.kind === 'campaign'
  ? JSON.stringify(['campaign', address.runId ?? null])
  : address.kind === 'insight'
    ? JSON.stringify(['insight', address.reportRef ?? null, address.scope ?? null])
    : address.kind === 'child'
      ? JSON.stringify(['child', address.parentSessionId, address.childSessionId])
      : JSON.stringify(['invalid', address.code, address.message]);

/** Only an existing Campaign address carries an execution identity; all other modes are read/preparation views. */
export const runIdForWorkbenchAddress = (address: WorkbenchAddress): string | undefined =>
  address.kind === 'campaign' ? address.runId : undefined;
