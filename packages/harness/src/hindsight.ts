/** Thin Hindsight 0.10.3 wire adapter. Host owns payload equality, authority and retries. */
export interface HindsightConnection { origin: string; apiKey: string; generation: string }
export interface RetainInput {
  bankId: string; operationId: string; documentId: string; text: string;
  contentSha256: string; version: number; memoryId: string;
}
export interface HindsightOptions { fetch?: typeof globalThis.fetch; signal?: AbortSignal }
export type NativeRetentionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'not_found';
export interface RetentionReconciliation {
  state: 'confirmed' | 'unknown' | 'failed'; nativeStatus: NativeRetentionStatus; nativeDocumentHash?: string;
  /** Only absence of both parent and document permits Host to resubmit the original immutable payload. */
  resubmitAllowed?: boolean;
}
const statuses: readonly string[] = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'not_found'];
const safeError = () => new Error('Hindsight request failed');
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw safeError();
  return value as Record<string, unknown>;
};
function metadata(input: RetainInput): Record<string, string> {
  return { hima_memory_id: input.memoryId, hima_memory_version: String(input.version), hima_content_sha256: input.contentSha256, hima_operation_id: input.operationId };
}
function bankPath(bankId: string): string { return `/v1/default/banks/${encodeURIComponent(bankId)}`; }
async function request(connection: HindsightConnection, path: string, method: 'GET' | 'POST', options: HindsightOptions, body?: unknown, absentAllowed = false): Promise<Record<string, unknown> | undefined> {
  // Each request is finite even when the caller supplies a longer-lived signal.
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(`${connection.origin.replace(/\/$/, '')}${path}`, {
      method, headers: { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' }, signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (absentAllowed && response.status === 404) return undefined;
    if (!response.ok) throw safeError();
    return object(await response.json());
  } catch {
    // Do not propagate fetch causes, URLs, HTTP bodies, credentials or bank identities.
    throw safeError();
  }
}
/** An ACK means submitted only; it does not prove native parent completion or extraction. */
export async function retainExperience(connection: HindsightConnection, input: RetainInput, options: HindsightOptions = {}): Promise<{ operationId: string; status: 'submitted' }> {
  const result = await request(connection, `${bankPath(input.bankId)}/memories`, 'POST', options, {
    async: true, operation_id: input.operationId,
    items: [{ content: input.text, document_id: input.documentId, update_mode: 'replace', metadata: metadata(input) }],
  });
  if (result?.success !== true || result.async !== true || result.operation_id !== input.operationId) throw safeError();
  return { operationId: input.operationId, status: 'submitted' };
}
export async function readRetentionStatus(connection: HindsightConnection, bankId: string, operationId: string, options: HindsightOptions = {}): Promise<NativeRetentionStatus> {
  const result = await request(connection, `${bankPath(bankId)}/operations/${encodeURIComponent(operationId)}`, 'GET', options, undefined, true);
  if (!result) return 'not_found';
  if (result.operation_id !== operationId || typeof result.status !== 'string' || !statuses.includes(result.status)
    || (result.status !== 'not_found' && result.operation_type !== 'batch_retain')) throw safeError();
  return result.status as NativeRetentionStatus;
}
/** Pruned/absent parents remain unknown: document presence/count alone is not extraction proof. */
export async function reconcileRetention(connection: HindsightConnection, input: RetainInput, options: HindsightOptions = {}): Promise<RetentionReconciliation> {
  const nativeStatus = await readRetentionStatus(connection, input.bankId, input.operationId, options);
  if (nativeStatus === 'failed' || nativeStatus === 'cancelled') return { state: 'failed', nativeStatus };
  const document = await request(connection, `${bankPath(input.bankId)}/documents/${encodeURIComponent(input.documentId)}`, 'GET', options, undefined, true);
  if (!document && nativeStatus === 'not_found') return { state: 'unknown', nativeStatus, resubmitAllowed: true };
  if (!document || nativeStatus !== 'completed') return { state: 'unknown', nativeStatus };
  const expected = metadata(input);
  const actual = document.document_metadata;
  const matches = !!actual && typeof actual === 'object' && !Array.isArray(actual)
    && Object.keys(actual).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, value]) => (actual as Record<string, unknown>)[key] === value);
  if (document.id !== input.documentId || document.bank_id !== input.bankId || document.original_text !== input.text || !matches) return { state: 'unknown', nativeStatus };
  return { state: 'confirmed', nativeStatus, ...(typeof document.content_hash === 'string' ? { nativeDocumentHash: document.content_hash } : {}) };
}
export async function recallExperience(connection: HindsightConnection, input: { bankId: string; query: string; maxTokens?: number }, options: HindsightOptions = {}): Promise<{ documentId: string; text: string; memoryType: 'world' | 'experience' }[]> {
  const result = await request(connection, `${bankPath(input.bankId)}/memories/recall`, 'POST', options, {
    query: input.query, types: ['world', 'experience'], max_tokens: input.maxTokens ?? 4096,
  });
  if (!Array.isArray(result?.results)) throw safeError();
  return result.results.flatMap((value: unknown) => {
    const row = object(value);
    if ((row.type !== 'world' && row.type !== 'experience') || typeof row.document_id !== 'string' || !row.document_id || typeof row.text !== 'string') return [];
    return [{ documentId: row.document_id, text: row.text, memoryType: row.type }];
  });
}
