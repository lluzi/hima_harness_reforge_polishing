// PLS-11 L1: exact dependency closure and append-only record validity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPack, revisionImpactOf, currentRecordsIn, recordValidityOf, retainedRecordMaterial, type LedgerRecord } from '@hima/harness';
import { shippedPacksDir, timingProbePackId } from './support/pack.ts';

test('A to B to C invalidation excludes independent D and includes every downstream consumer', () => {
  const pack = loadPack(shippedPacksDir, timingProbePackId);
  const withIndependent = { ...pack, graph: { ...pack.graph,
    nodes: [...pack.graph.nodes, { id: 'independent-d', kind: 'wait' as const, parameters: { blocker: 'independent evidence' } }],
  } };
  assert.deepEqual(new Set(revisionImpactOf(withIndependent, ['read-qor'])), new Set(['read-qor', 'judge', 'next-period']));
  assert.equal(revisionImpactOf(withIndependent, ['read-qor']).includes('independent-d'), false);
  assert.deepEqual(new Set(revisionImpactOf(withIndependent, ['synthesize'])), new Set(['synthesize', 'read-qor', 'judge', 'next-period']));
});

test('current records exclude invalidated history while retained code bytes stay addressable', () => {
  const code = { id: 'code-old', runId: 'run', siteId: 'local', seq: 1, at: 't1', writer: 'executor', generation: 1,
    type: 'code', nodeId: 'b', attempt: 1, sessionId: 'owner', workshop: 'mine', path: '/work/old.sh',
    sha256: 'a'.repeat(64), bytes: 4, language: 'sh' } as LedgerRecord;
  const revision = { id: 'revision-2', runId: 'run', siteId: 'local', seq: 2, at: 't2', writer: 'executor', generation: 1,
    type: 'revision', revisionId: 'rev-b', version: 1, event: 'applied', proposalDigest: 'b'.repeat(64),
    methodIdentity: 'c'.repeat(64), sourceIdentity: 'd'.repeat(64), inputIdentity: 'e'.repeat(64), environmentIdentity: 'f'.repeat(64),
    changedNodes: ['b'], affectedNodes: ['b', 'c'], invalidates: ['code-old'], reuses: [], assets: [{ nodeId: 'b', scope: 'workshop',
      logicalPath: 'old.sh', path: '/work/old.sh', beforeVersionPath: '/work/.hima/revisions/rev-b/before/old.sh',
      afterVersionPath: '/work/.hima/revisions/rev-b/after/old.sh', beforeSha256: 'a'.repeat(64), afterSha256: '1'.repeat(64), bytes: 8 }] } as LedgerRecord;
  const records = [code, revision];
  assert.deepEqual(recordValidityOf(records, code.id), { valid: false, invalidatedBy: 'rev-b' });
  assert.equal(currentRecordsIn(records).some((record) => record.id === code.id), false);
  assert.deepEqual(retainedRecordMaterial(records, code.id), { path: '/work/.hima/revisions/rev-b/before/old.sh',
    sha256: 'a'.repeat(64), bytes: 4, revisionId: 'rev-b', version: 1 });
});

test('same report path, later timestamp and branch name do not make another branch current', () => {
  const observation = (id: string, seq: number, branchId: string, hash: string) => ({ id, runId: 'run', siteId: 'local', seq,
    at: seq === 1 ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z', writer: 'executor', generation: 1, branchId,
    type: 'observation', path: '/same/report.rpt', contentSha256: hash, bytes: 8,
    reader: { id: 'raw', version: '1', reportKind: 'raw', emits: [] }, values: [] }) as LedgerRecord;
  const oldA = observation('a-old-late-time', 1, 'same-name-a', 'a'.repeat(64));
  const currentB = observation('b-current', 2, 'same-name-b', 'b'.repeat(64));
  const invalidation = { id: 'rev', runId: 'run', siteId: 'local', seq: 3, at: 't', writer: 'executor', generation: 1,
    type: 'revision', revisionId: 'branch-a-revision', version: 1, event: 'applied', proposalDigest: '1'.repeat(64),
    methodIdentity: '2'.repeat(64), sourceIdentity: '3'.repeat(64), inputIdentity: '4'.repeat(64), environmentIdentity: '5'.repeat(64),
    changedNodes: ['a'], affectedNodes: ['a'], invalidates: [oldA.id], reuses: [currentB.id] } as LedgerRecord;
  const current = currentRecordsIn([oldA, currentB, invalidation]);
  assert.deepEqual(current.filter((record) => record.type === 'observation').map((record) => record.id), ['b-current']);
});
