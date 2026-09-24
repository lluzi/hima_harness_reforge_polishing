import assert from 'node:assert/strict';
import test from 'node:test';

const subject: typeof import('./generation-feedback-report.js') = await import(`./generation-feedback-report.${'ts'}`);

const hash = 'a'.repeat(64);
const base = {
  schema: 'hima-generation-feedback/1' as const,
  generation: 2,
  subject: 'timing-endpoint' as const,
  sources: [{ id: 'before:g001', sha256: hash }],
  denominator: { kind: 'endpoint' as const, originalIds: ['A/D', 'B/D'], originalCount: 2 },
  coverage: {
    before: { status: 'measured' as const, coveredIds: ['A/D', 'B/D'], missingIds: [] },
    after: { status: 'measured' as const, coveredIds: ['B/D'], missingIds: ['A/D'] },
  },
  comparability: { status: 'comparable' as const, reasons: [] },
  endpointChanges: {
    fixed: { status: 'measured' as const, ids: [] },
    remaining: { status: 'measured' as const, ids: ['B/D'] },
    entrant: { status: 'measured' as const, ids: [] },
    regressed: { status: 'measured' as const, ids: [] },
    missing: { status: 'measured' as const, ids: ['A/D'] },
  },
  next: { kind: 'action' as const, status: 'available' as const, reason: 'one endpoint remains', items: [{
    id: 'plan-fix:g002', targetIds: ['A/D', 'B/D'], change: 'plan-fix', expectedEffect: 'reduce violations',
    validation: { status: 'known' as const, method: 'matched refresh' },
    stopCondition: { status: 'known' as const, text: 'stop on closure' }, sourceIds: ['before:g001'],
  }] },
  unknowns: [],
};

test('reads a nested Pack report without changing its original denominator', () => {
  const report = subject.readGenerationFeedback({ generation_feedback: base });
  assert.equal(report.denominator.originalCount, 2);
  assert.equal(subject.generationFeedbackCategoryCount(report, 'missing'), 1);
});

test('unknown endpoint evidence remains unknown instead of becoming a zero count', () => {
  const report = subject.readGenerationFeedback({
    ...base,
    comparability: { status: 'unknown', reasons: ['no commercial response'] },
    endpointChanges: { ...base.endpointChanges,
      fixed: { status: 'unknown', ids: [], reason: 'no commercial response' } },
    unknowns: ['no commercial response'],
  });
  assert.equal(subject.generationFeedbackCategoryCount(report, 'fixed'), undefined);
});

test('refuses coverage that silently drops an original target', () => {
  assert.throws(() => subject.readGenerationFeedback({ ...base,
    coverage: { ...base.coverage,
      after: { status: 'measured', coveredIds: ['B/D'], missingIds: [] } },
  }), /partition the original denominator/);
});
