import assert from 'node:assert/strict';
import test from 'node:test';
import type { AnalysisView } from '../remote.js';

const moduleUnderTest: typeof import('./generation-analysis.js') = await import(`./generation-analysis.${'ts'}`);

const analysis = (recordId: string, generation?: number, loopId?: string): AnalysisView => ({
  recordId, at: '2026-09-23T00:00:00.000Z', sessionId: 'owner', nodeId: 'analyze',
  question: `Question ${recordId}`, hypotheses: [], comparisons: [], limitations: ['bounded'], nextExperiments: ['measure'], claims: [],
  ...(generation === undefined ? {} : { generation }), ...(loopId === undefined ? {} : { loopId }),
});

test('research analysis groups by exact Ledger generation and loop identity', () => {
  const groups = moduleUnderTest.groupGenerationAnalyses([analysis('outer-2', 2), analysis('loop-1', 1, 'loop:a'), analysis('outer-2b', 2)]);
  assert.deepEqual(groups.map(group => [group.loopId, group.generation, group.analyses.map(item => item.recordId)]), [
    [undefined, 2, ['outer-2', 'outer-2b']], ['loop:a', 1, ['loop-1']],
  ]);
});

test('analysis without a recorded generation remains unclassified and never becomes generation one', () => {
  const groups = moduleUnderTest.groupGenerationAnalyses([analysis('legacy'), analysis('g1', 1)]);
  assert.equal(groups[0]?.generation, 1);
  assert.equal(groups[1]?.generation, undefined);
  assert.deepEqual(groups[1]?.analyses.map(item => item.recordId), ['legacy']);
});
