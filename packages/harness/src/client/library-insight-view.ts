import type { LibraryInsightReportView } from '../library-insight-report.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** The Host validates the typed document against saved bytes; the client checks its address envelope. */
export function readLibraryInsightView(value: unknown): LibraryInsightReportView | undefined {
  if (!record(value) || value.schema !== 'hima-library-insight-report/1' || value.evidenceClass !== 'synthetic'
    || typeof value.reportRef !== 'string' || value.reportRef === ''
    || typeof value.version !== 'string' || value.version === '' || !record(value.source)
    || value.source.recordId !== value.reportRef || !hash(value.source.sha256)
    || typeof value.source.createdAt !== 'string' || !Number.isFinite(Date.parse(value.source.createdAt))) return undefined;
  return value as unknown as LibraryInsightReportView;
}
