import assert from 'node:assert/strict';
import test from 'node:test';

const subject: typeof import('./generation-feedback-view.js') = await import(`./generation-feedback-view.${'ts'}`);
const hash = 'a'.repeat(64);
const report = {
  schema: 'hima-generation-feedback/1', generation: 2, subject: 'timing-endpoint',
  sources: [{ id: 'source:1', sha256: hash }],
  denominator: { kind: 'endpoint', originalIds: ['A', 'B'], originalCount: 2 },
  coverage: { before: { status: 'measured', coveredIds: ['A', 'B'], missingIds: [] }, after: { status: 'unknown', coveredIds: ['A'], missingIds: ['B'], reason: 'partial report' } },
  comparability: { status: 'unknown', reasons: ['conditions incomplete'] },
  endpointChanges: { fixed: { status: 'unknown', ids: [], reason: 'not measured' }, remaining: { status: 'measured', ids: ['A'] }, entrant: { status: 'measured', ids: [] }, regressed: { status: 'measured', ids: [] }, missing: { status: 'measured', ids: ['B'] } },
  next: { kind: 'stop', status: 'stop', items: [], reason: 'no comparable evidence' }, unknowns: ['global PPA not measured'],
};

test('strict feedback view keeps exact immutable identity and producer unknowns', () => {
  const view = subject.readGenerationFeedbackView({ kind: 'generation-feedback', report, reportRef: 'observation:1', version: '7', source: { recordId: 'observation:1', sha256: hash, createdAt: '2026-09-23T00:00:00.000Z' } });
  assert.ok(view);
  assert.equal(view.report.endpointChanges.fixed.status, 'unknown');
  assert.equal(view.source.sha256, hash);
});

test('feedback view rejects wrapper extras and mismatched source identity', () => {
  const base = { kind: 'generation-feedback', report, reportRef: 'observation:1', version: '7', source: { recordId: 'observation:1', sha256: hash, createdAt: '2026-09-23T00:00:00.000Z' } };
  assert.equal(subject.readGenerationFeedbackView({ ...base, extra: true }), undefined);
  assert.equal(subject.readGenerationFeedbackView({ ...base, source: { ...base.source, recordId: 'observation:2' } }), undefined);
});

test('pagination clamps without changing source row order', () => {
  assert.deepEqual(subject.pageRows(['a', 'b', 'c'], 1, 2), { rows: ['c'], page: 1, pages: 2 });
  assert.deepEqual(subject.pageRows(['a'], 9, 2), { rows: ['a'], page: 0, pages: 1 });
});
