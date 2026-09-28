import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delegationTaskPrompt } from '../../packages/harness/src/delegation.ts';

test('Agent Team task prompt makes the Pack result schema an explicit JSON-only response contract', () => {
  const contract = {
    delegationId: 'researcher', parentSessionId: 'owner', role: 'researcher', task: 'Read retained evidence.',
    inputRefs: ['run-1#000001'], allowedTools: ['hima_delegation_input'],
    budgetShare: { maxElapsedMs: 1_000, maxFollowups: 0 }, dependencyIds: [],
    recipient: { kind: 'run-owner', sessionId: 'owner' }, status: 'requested',
  } as never;
  const effective = {
    delegationId: 'researcher', parentSessionId: 'owner', childSessionId: 'child', role: 'researcher',
    workspace: '/private/task', model: { provider: 'fixture', model: 'fixture' },
    tools: ['hima_delegation_input'], inputRefs: ['run-1#000001'],
    budgetShare: { maxElapsedMs: 1_000, maxFollowups: 0 },
    runRef: { runId: 'run-1', expectedEpoch: 1, expectedRevision: 1 }, nodeRef: 'run-xtop-fix',
    recipient: { kind: 'run-owner', sessionId: 'owner' }, unavailable: [],
    recipe: { teamId: 'timing-eco-team', version: '1', memberId: 'researcher', executionId: 'execution-1',
      recipeDigest: 'a'.repeat(64), resultSchema: { id: 'xtop-timing-research/1',
        required: ['schema', 'hypotheses', 'evidenceRefs', 'limitations'] },
      reviewOutput: { command: 'hima_apply_action', arguments: ['kind', 'effort', 'setupTargetNs', 'holdTargetNs', 'setupMarginNs', 'holdMarginNs'] } },
  } as never;
  const prompt = delegationTaskPrompt(contract, effective);
  assert.match(prompt, /return exactly one JSON object and no prose or Markdown/);
  assert.match(prompt, /Set schema to "xtop-timing-research\/1"/);
  assert.match(prompt, /top-level fields: schema, hypotheses, evidenceRefs, limitations\./);
  assert.match(prompt, /set command to "hima_apply_action"/);
  assert.match(prompt, /arguments to one object with exactly these fields and no others: kind, effort, setupTargetNs, holdTargetNs, setupMarginNs, holdMarginNs\./);
});

test('a reviewed scope reaches the Reviewer as its output contract and the Operator as its immutable bounds', () => {
  const contract = {
    delegationId: 'member', parentSessionId: 'owner', role: 'reviewer', task: 'Review.',
    inputRefs: [], allowedTools: ['hima_delegation_input'], budgetShare: { maxElapsedMs: 1_000, maxFollowups: 0 },
    dependencyIds: [], recipient: { kind: 'run-owner', sessionId: 'owner' }, status: 'requested',
  } as never;
  const effective = (recipe: Record<string, unknown>) => ({
    delegationId: 'member', parentSessionId: 'owner', childSessionId: 'child', role: 'reviewer',
    workspace: '/private/task', model: { provider: 'fixture', model: 'fixture' }, tools: ['hima_delegation_input'], inputRefs: [],
    budgetShare: { maxElapsedMs: 1_000, maxFollowups: 0 }, runRef: { runId: 'run-1', expectedEpoch: 1, expectedRevision: 1 },
    recipient: { kind: 'run-owner', sessionId: 'owner' }, unavailable: [],
    recipe: { teamId: 'atcs-worker-01', version: '4', memberId: 'reviewer', executionId: 'execution-1', recipeDigest: 'a'.repeat(64),
      resultSchema: { id: 'atcs-worker-review/2', required: ['schema', 'planSha256', 'scope'] }, ...recipe },
  }) as never;
  const reviewer = delegationTaskPrompt(contract, effective({
    reviewOutput: { scopeField: 'scope', commands: ['atcs_size_cell', 'atcs_undo'], maxMutations: 40 } }));
  assert.match(reviewer, /set scope to one object with exactly the fields commands and maxMutations/);
  assert.match(reviewer, /chosen from: atcs_size_cell, atcs_undo\. maxMutations is an integer from 1 to 40/);
  const planSha256 = 'b'.repeat(64);
  const operator = delegationTaskPrompt(contract, effective({ inlinePayload: { sourceResultRecordId: 'run-1#000002',
    adoptionRecordId: 'run-1#000003', planSha256, planHashArgument: 'planSha256',
    scope: { commands: ['atcs_size_cell'], maxMutations: 3 } } }));
  assert.match(operator, new RegExp(`carry planSha256 = ${planSha256}; the Host admits at most 3 mutations`));
});
