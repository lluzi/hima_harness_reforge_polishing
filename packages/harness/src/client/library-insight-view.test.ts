import assert from 'node:assert/strict';
import test from 'node:test';

const subject: typeof import('./library-insight-view.js') = await import(`./library-insight-view.${'ts'}`);
const { libraryInsightRecalculationIntent, filterLoadedLibraryFindings, isNewLibraryInsightReport, libraryInsightIdentity, readLibraryInsightView } = subject;

const hash = (digit: string) => digit.repeat(64);
const report = {
  schema: 'hima-library-insight-report/1', evidenceClass: 'synthetic', analysis: 'library-performance',
  reportRef: 'record:one', version: '1', source: { recordId: 'record:one', sha256: hash('a'), createdAt: '2026-09-25T00:00:00.000Z' },
  conditions: { family: 'example', corners: ['slow', 'fast'], views: ['max'], unknowns: ['No design evidence.'] },
  findings: [
    { id: 'kept', title: 'Explicit zero', librarySeverity: 'critical', designRelevance: 'none', corner: 'slow', view: 'max', values: [{ name: 'delta', value: 0, unit: 'ps' }], provenance: [{ recordId: 'record:one', status: 'available' }], unknowns: ['Not used by this design.'], rankingReason: 'severity first' },
    { id: 'hidden', title: 'Missing value', librarySeverity: 'warning', designRelevance: 'unknown', corner: 'fast', view: 'max', values: [{ name: 'delta', value: null, missingReason: 'No measurement.' }], provenance: [{ status: 'unknown', reason: 'No source.' }], unknowns: ['Measurement unavailable.'], rankingReason: 'unknown remains visible' },
  ],
  summary: { best: ['kept'], unresolved: ['hidden'], nextActions: [{ text: 'Measure the missing value.', findingIds: ['hidden'] }] },
};

test('Library Insight accepts only a complete immutable report envelope and slices loaded findings locally', () => {
  const view = readLibraryInsightView(report);
  assert.ok(view);
  const before = JSON.stringify(view);
  assert.deepEqual(filterLoadedLibraryFindings(view, { corner: 'slow' }).map(finding => finding.id), ['kept']);
  assert.equal(JSON.stringify(view), before);
  assert.equal(readLibraryInsightView({ ...report, source: { ...report.source, recordId: 'record:other' } }), undefined);
  assert.equal(readLibraryInsightView({ ...report, findings: [report.findings[0], { ...report.findings[1], values: [{ name: 'delta', value: null }] }] }), undefined);
  assert.equal(readLibraryInsightView({ ...report, evidenceClass: 'native-qualified' })?.evidenceClass, 'native-qualified');
  assert.equal(readLibraryInsightView({ ...report, evidenceClass: 'unqualified' }), undefined);
  assert.equal(readLibraryInsightView({ ...report, extra: true }), undefined);
});

test('a local recalculation intent never computes or overwrites the viewed report', () => {
  const view = readLibraryInsightView(report);
  assert.ok(view);
  const previous = libraryInsightIdentity(view);
  assert.deepEqual(libraryInsightRecalculationIntent(view), { kind: 'library-insight-recalculation', previous });
  assert.equal(isNewLibraryInsightReport(previous, { ...previous, reportRef: 'record:two', recordId: 'record:two', version: '2', sha256: hash('b') }), true);
  assert.equal(isNewLibraryInsightReport(previous, { ...previous, version: '2' }), false);
});
