import type { GenerationFeedbackReport } from '@hima/harness';

export interface GenerationFeedbackReportView {
  readonly kind: 'generation-feedback';
  readonly report: GenerationFeedbackReport;
  readonly reportRef: string;
  readonly version: string;
  readonly source: { readonly recordId: string; readonly sha256: string; readonly createdAt: string };
}

const hashPattern = /^[0-9a-f]{64}$/;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
};

/** The Host validates producer data against saved bytes; this checks the immutable view envelope. */
export function readGenerationFeedbackView(value: unknown): GenerationFeedbackReportView | undefined {
  if (!isRecord(value) || !exactKeys(value, ['kind', 'report', 'reportRef', 'version', 'source']) || value.kind !== 'generation-feedback'
      || typeof value.reportRef !== 'string' || value.reportRef === '' || typeof value.version !== 'string' || value.version === '' || !isRecord(value.source)
      || !exactKeys(value.source, ['recordId', 'sha256', 'createdAt']) || typeof value.source.recordId !== 'string' || value.source.recordId === ''
      || value.source.recordId !== value.reportRef || typeof value.source.sha256 !== 'string' || !hashPattern.test(value.source.sha256)
      || typeof value.source.createdAt !== 'string' || !Number.isFinite(Date.parse(value.source.createdAt))) return undefined;
  if (!isRecord(value.report) || value.report.schema !== 'hima-generation-feedback/1') return undefined;
  const report = value.report as unknown as GenerationFeedbackReport;
  return { kind: 'generation-feedback', report, reportRef: value.reportRef, version: value.version,
    source: { recordId: value.source.recordId, sha256: value.source.sha256, createdAt: value.source.createdAt } };
}

export function pageRows<T>(rows: readonly T[], page: number, size: number): { readonly rows: readonly T[]; readonly page: number; readonly pages: number } {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('page size must be a positive integer');
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(current * size, (current + 1) * size), page: current, pages };
}

export function technicalFieldLines(value: Readonly<Record<string, unknown>>): readonly string[] {
  const render = (item: unknown): string => item === null ? 'unknown'
    : typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? String(item)
      : Array.isArray(item) ? item.map(render).join(', ')
        : isRecord(item) ? Object.entries(item).map(([key, nested]) => `${key}=${render(nested)}`).join('; ')
          : 'unknown';
  return Object.entries(value).map(([key, item]) => `${key}: ${render(item)}`);
}
