// A read-only fixture report contract for the existing Insight surface. Native
// Library production stays gated; this schema cannot label data as qualified.
import { z } from 'zod';

const text = z.string().min(1).max(2000);
const ref = z.string().min(1).max(1024);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const range = z.strictObject({ min: z.number().finite(), max: z.number().finite(), unit: text })
  .refine(value => value.max >= value.min, 'range max must not be below min');
const provenance = z.strictObject({
  sourceRef: ref.optional(), recordId: ref.optional(), sha256: hash.optional(),
  status: z.enum(['available', 'unknown', 'ambiguous']), reason: text.optional(),
}).superRefine((value, ctx) => {
  if (value.status === 'available' && !value.recordId && !(value.sourceRef && value.sha256)) ctx.addIssue({ code: 'custom', message: 'available provenance requires a record or hash-bound source' });
  if (value.status !== 'available' && !value.reason) ctx.addIssue({ code: 'custom', message: 'unknown provenance requires its reason' });
});
const numeric = z.strictObject({ name: text, value: z.number().finite().nullable(), unit: text.optional(), missingReason: text.optional() })
  .refine(value => value.value !== null || value.missingReason !== undefined, 'missing numeric values need a reason; never substitute zero');

export const libraryInsightDocument = z.strictObject({
  schema: z.literal('hima-library-insight-report/1'),
  evidenceClass: z.literal('synthetic'),
  analysis: z.enum(['library-health', 'library-performance', 'design-impact']),
  conditions: z.strictObject({ family: text, corners: z.array(text).min(1).max(32), views: z.array(text).min(1).max(32),
    load: range.optional(), slew: range.optional(), unknowns: z.array(text).max(32) }),
  findings: z.array(z.strictObject({
    id: ref, title: text, librarySeverity: z.enum(['critical', 'warning', 'info']), designRelevance: z.enum(['observed', 'none', 'unknown']),
    corner: text, view: text, values: z.array(numeric).max(64),
    provenance: z.array(provenance).min(1).max(32), unknowns: z.array(text).max(32), rankingReason: text,
  })).max(5000),
  summary: z.strictObject({ best: z.array(ref).max(100), unresolved: z.array(ref).max(100),
    nextActions: z.array(z.strictObject({ text, findingIds: z.array(ref).min(1).max(100) })).max(100) }),
}).superRefine((report, ctx) => {
  const ids = new Set(report.findings.map(finding => finding.id));
  if (ids.size !== report.findings.length) ctx.addIssue({ code: 'custom', message: 'finding identities must be unique' });
  for (const finding of report.findings) if (!report.conditions.corners.includes(finding.corner) || !report.conditions.views.includes(finding.view)) ctx.addIssue({ code: 'custom', message: `finding ${finding.id} is outside loaded conditions` });
  for (const id of [...report.summary.best, ...report.summary.unresolved, ...report.summary.nextActions.flatMap(action => action.findingIds)]) if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `summary names unknown finding ${id}` });
});
export type LibraryInsightDocument = z.infer<typeof libraryInsightDocument>;
export type LibraryInsightReportView = LibraryInsightDocument & {
  readonly reportRef: string;
  readonly version: string;
  readonly source: { readonly recordId: string; readonly sha256: string; readonly createdAt: string };
};

/** Producer ordering and evidence stay immutable; filters never calculate new measurements. */
export function filterLibraryFindings(report: LibraryInsightDocument, filters: { corner?: string; view?: string; severity?: string }) {
  return report.findings.filter(finding => (!filters.corner || finding.corner === filters.corner)
    && (!filters.view || finding.view === filters.view) && (!filters.severity || finding.librarySeverity === filters.severity));
}

export const libraryInsightReportView = libraryInsightDocument.safeExtend({
  reportRef: ref, version: ref,
  source: z.strictObject({ recordId: ref, sha256: hash, createdAt: z.string().datetime() }),
}).refine(report => report.source.recordId === report.reportRef, 'report must name its recorded byte source');
