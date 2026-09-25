import type { LibraryInsightReportView } from '../library-insight-report.js';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit = 2000): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === 'string' && values.includes(value as T);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).every(key => keys.includes(key));
const textList = (value: unknown, min = 0, max = 32): value is readonly string[] => Array.isArray(value) && value.length >= min && value.length <= max && value.every(item => text(item));

function range(value: unknown): boolean {
  return record(value) && exactKeys(value, ['min', 'max', 'unit']) && Number.isFinite(value.min) && Number.isFinite(value.max)
    && typeof value.min === 'number' && typeof value.max === 'number' && value.max >= value.min && text(value.unit);
}

function provenance(value: unknown): boolean {
  if (!record(value) || !onlyKeys(value, ['sourceRef', 'recordId', 'sha256', 'status', 'reason'])
    || !oneOf(value.status, ['available', 'unknown', 'ambiguous'])) return false;
  if (value.sourceRef !== undefined && !text(value.sourceRef, 1024)) return false;
  if (value.recordId !== undefined && !text(value.recordId, 1024)) return false;
  if (value.sha256 !== undefined && !hash(value.sha256)) return false;
  if (value.reason !== undefined && !text(value.reason)) return false;
  return value.status === 'available'
    ? value.recordId !== undefined || (value.sourceRef !== undefined && value.sha256 !== undefined)
    : value.reason !== undefined;
}

function numeric(value: unknown): boolean {
  return record(value) && onlyKeys(value, ['name', 'value', 'unit', 'missingReason']) && text(value.name)
    && (value.value === null || (typeof value.value === 'number' && Number.isFinite(value.value)))
    && (value.unit === undefined || text(value.unit)) && (value.missingReason === undefined || text(value.missingReason))
    && (value.value !== null || value.missingReason !== undefined);
}

function finding(value: unknown): boolean {
  return record(value) && exactKeys(value, ['id', 'title', 'librarySeverity', 'designRelevance', 'corner', 'view', 'values', 'provenance', 'unknowns', 'rankingReason'])
    && text(value.id, 1024) && text(value.title) && oneOf(value.librarySeverity, ['critical', 'warning', 'info'])
    && oneOf(value.designRelevance, ['observed', 'none', 'unknown']) && text(value.corner) && text(value.view)
    && Array.isArray(value.values) && value.values.length <= 64 && value.values.every(numeric)
    && Array.isArray(value.provenance) && value.provenance.length >= 1 && value.provenance.length <= 32 && value.provenance.every(provenance)
    && textList(value.unknowns) && text(value.rankingReason);
}

/**
 * The identity the renderer keeps with its local selection.  It deliberately includes the
 * recorded bytes as well as the report/version labels: a response for another saved report must
 * never inherit this report's filters or provenance display.
 */
export interface LibraryInsightIdentity {
  readonly reportRef: string;
  readonly version: string;
  readonly recordId: string;
  readonly sha256: string;
}

export interface LibraryInsightFilters {
  readonly corner?: string;
  readonly view?: string;
  readonly severity?: string;
}

/** A typed request boundary only.  Publishing a new report remains a controlled Host/Run action. */
export interface LibraryInsightRecalculationIntent {
  readonly kind: 'library-insight-recalculation';
  readonly previous: LibraryInsightIdentity;
}

/** The Host validates producer data against saved bytes; this checks the complete strict envelope without bundling the server-side schema runtime. */
export function readLibraryInsightView(value: unknown): LibraryInsightReportView | undefined {
  if (!record(value) || !exactKeys(value, ['schema', 'evidenceClass', 'analysis', 'conditions', 'findings', 'summary', 'reportRef', 'version', 'source'])
    || value.schema !== 'hima-library-insight-report/1' || !oneOf(value.evidenceClass, ['synthetic', 'native-qualified'])
    || !oneOf(value.analysis, ['library-health', 'library-performance', 'design-impact']) || !text(value.reportRef, 1024) || !text(value.version, 1024)
    || !record(value.source) || !exactKeys(value.source, ['recordId', 'sha256', 'createdAt']) || !text(value.source.recordId, 1024)
    || value.source.recordId !== value.reportRef || !hash(value.source.sha256) || !text(value.source.createdAt) || !Number.isFinite(Date.parse(value.source.createdAt))
    || !record(value.conditions) || !onlyKeys(value.conditions, ['family', 'corners', 'views', 'load', 'slew', 'unknowns']) || !text(value.conditions.family)
    || !textList(value.conditions.corners, 1) || !textList(value.conditions.views, 1) || !textList(value.conditions.unknowns)
    || (value.conditions.load !== undefined && !range(value.conditions.load)) || (value.conditions.slew !== undefined && !range(value.conditions.slew))
    || !Array.isArray(value.findings) || value.findings.length > 5000 || !value.findings.every(finding)
    || !record(value.summary) || !exactKeys(value.summary, ['best', 'unresolved', 'nextActions']) || !textList(value.summary.best, 0, 100) || !textList(value.summary.unresolved, 0, 100)
    || !Array.isArray(value.summary.nextActions) || value.summary.nextActions.length > 100) return undefined;
  const conditions = value.conditions as { readonly corners: readonly string[]; readonly views: readonly string[] };
  const findingIds = new Set(value.findings.map(item => (item as { id: string }).id));
  if (findingIds.size !== value.findings.length || value.findings.some(item => !conditions.corners.includes((item as { corner: string }).corner) || !conditions.views.includes((item as { view: string }).view))) return undefined;
  if (value.summary.best.some(id => !findingIds.has(id)) || value.summary.unresolved.some(id => !findingIds.has(id)) || value.summary.nextActions.some(action => !record(action) || !exactKeys(action, ['text', 'findingIds']) || !text(action.text) || !textList(action.findingIds, 1, 100) || action.findingIds.some(id => !findingIds.has(id)))) return undefined;
  return value as unknown as LibraryInsightReportView;
}

export function libraryInsightIdentity(report: LibraryInsightReportView): LibraryInsightIdentity {
  return { reportRef: report.reportRef, version: report.version, recordId: report.source.recordId, sha256: report.source.sha256 };
}

/**
 * Filters are a synchronous slice of producer-ordered, already-loaded findings.  It performs no
 * calculation and returns neither a new report nor a rewritten condition set.
 */
export function filterLoadedLibraryFindings(report: LibraryInsightReportView, filters: LibraryInsightFilters) {
  return report.findings.filter(finding => (!filters.corner || finding.corner === filters.corner)
    && (!filters.view || finding.view === filters.view) && (!filters.severity || finding.librarySeverity === filters.severity));
}

/** A recomputation result is admissible only when it names a distinct retained report/version. */
export function isNewLibraryInsightReport(previous: LibraryInsightIdentity, next: LibraryInsightIdentity): boolean {
  return previous.reportRef !== next.reportRef && previous.version !== next.version && previous.recordId !== next.recordId;
}

/** This is intentionally not a tool call: local Data Insight can request, but cannot execute, a recalculation. */
export function libraryInsightRecalculationIntent(report: LibraryInsightReportView): LibraryInsightRecalculationIntent {
  return { kind: 'library-insight-recalculation', previous: libraryInsightIdentity(report) };
}
