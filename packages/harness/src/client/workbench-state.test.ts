import assert from 'node:assert/strict';
import test from 'node:test';
import type { RunControl } from '../ledger.js';
import type { ExperienceCandidate, MemorySourcesAnswer, SessionContextAnswer } from './api.js';
const state: typeof import('./workbench-state.js') = await import(`./workbench-state.${'ts'}`);
const { appendTranscriptPage, delegationActionRequest, experienceCorrectionRequest, memoryEvidenceMatches, memoryScopeKey, memorySummaryInput } = state;

const hash = (digit: string) => digit.repeat(64);

test('memory drafts and Host evidence stay bound to the exact Guide or Run scope', () => {
  assert.notEqual(memoryScopeKey('guide', 'run:a'), memoryScopeKey('guide', 'run:b'));
  const sources: MemorySourcesAnswer = {
    kind: 'sources', scope: { kind: 'campaign', workspaceRef: '/project', runId: 'run:a' },
    references: [{ recordId: 'observation:1', contentIdentity: hash('a'), conditions: ['current'] }],
    sources: [{ runId: 'run:a', throughSeq: 4, observedControlRevision: 2 }], nativeSources: [],
  };
  assert.equal(memoryEvidenceMatches(sources, 'guide', 'run:a'), true);
  assert.equal(memoryEvidenceMatches(sources, 'guide', 'run:b'), false);
  assert.deepEqual(memorySummaryInput({ subject: '  Hold timing  ', decisions: 'keep A\n\n keep B ', openQuestions: 'why?', todo: 'measure' }, sources), {
    subject: 'Hold timing', decisions: ['keep A', 'keep B'], openQuestions: ['why?'], todo: ['measure'],
    references: sources.references, sources: sources.sources, nativeSources: [],
  });
});

test('experience correction requires a human reason and explicit evidence selection', () => {
  const candidate: ExperienceCandidate = {
    title: 'source run', candidate: { sourceRun: 'source', sourceManifestSha256: hash('a'), sourceMaterialPath: 'experience.json', sourceMaterialSha256: hash('b') },
    adoption: { id: 'adoption:1', event: 'disabled', reason: 'old reason', evidenceRefs: ['old'], changedBy: 'guide', at: '2026-09-23T00:00:00.000Z' },
    availableEvidence: [{ recordId: 'new:1', label: 'new:1' }, { recordId: 'new:2', label: 'new:2' }],
  };
  assert.throws(() => experienceCorrectionRequest({ sessionId: 'guide', runId: 'run', candidate, reason: 'because', evidenceRefs: [], requestId: 'request' }), /Select at least one/);
  const request = experienceCorrectionRequest({ sessionId: 'guide', runId: 'run', candidate, reason: '  new measurement  ', evidenceRefs: ['new:2'], requestId: 'request' });
  assert.equal(request.event, 're-adopted');
  assert.equal(request.reason, 'new measurement');
  assert.deepEqual(request.evidenceRefs, ['new:2']);
  assert.equal(request.supersedes, 'adoption:1');
  assert.deepEqual(request.candidate, candidate.candidate);
});

test('native transcript pages append for one child and expose the current context events', () => {
  const page = (events: SessionContextAnswer['events'], nextSeq: number, truncated: boolean): SessionContextAnswer => ({
    sessionId: 'child', parentSessionId: 'parent', events, nextSeq, truncated, asOf: '2026-09-23T00:00:00.000Z', sources: ['child'],
    context: { availability: 'available', kind: 'current-native-surface', capturedThroughSeq: 9, events: [{ seq: 9, kind: 'tool-result', text: 'verified' }], truncated: false, missing: ['historical prompt unavailable'] },
  });
  const first = appendTranscriptPage('child', undefined, page([{ seq: 0, kind: 'user', text: 'task' }, { seq: 1, kind: 'assistant', text: 'working' }], 2, true));
  const second = appendTranscriptPage('child', first, page([{ seq: 2, kind: 'tool', text: 'read' }], 3, false));
  assert.deepEqual(second.events.map(event => event.seq), [0, 1, 2]);
  assert.equal(second.truncated, false);
  assert.equal(second.context.availability, 'available');
  if (second.context.availability === 'available') assert.equal(second.context.events[0]?.text, 'verified');
  assert.throws(() => appendTranscriptPage('child', second, { ...page([], 0, false), sessionId: 'other' }), /different child/);
});

test('delegation controls carry the currently rendered owner epoch and revision', () => {
  const control: RunControl = { mode: 'agent', owner: 'owner', guideSessionId: 'guide', epoch: 3, revision: 8, paused: [], executions: {}, requests: {} };
  assert.deepEqual(delegationActionRequest({ sessionId: 'guide', runId: 'run', control, delegationId: 'delegate:1', action: 'followup', text: '  Check the failing arc. ', requestId: 'request:1' }), {
    sessionId: 'guide', runId: 'run', action: 'followup', requestId: 'request:1', expectedEpoch: 3, expectedRevision: 8, delegationId: 'delegate:1', text: 'Check the failing arc.',
  });
  assert.throws(() => delegationActionRequest({ sessionId: 'guide', runId: 'run', control, delegationId: 'delegate:1', action: 'followup', text: ' ', requestId: 'request:2' }), /Write a follow-up/);
});
