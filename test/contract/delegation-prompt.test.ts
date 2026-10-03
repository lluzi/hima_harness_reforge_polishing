import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delegationTaskPrompt } from '@hima/harness';

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
  assert.match(prompt, /Return exactly one JSON object and no prose or Markdown/);
  assert.match(prompt, /Set schema to "xtop-timing-research\/1"/);
  assert.match(prompt, /include: schema, hypotheses, evidenceRefs, limitations\./);
  assert.match(prompt, /Set command to "hima_apply_action"/);
  assert.match(prompt, /arguments to exactly: kind, effort, setupTargetNs, holdTargetNs, setupMarginNs, holdMarginNs\./);
  assert.doesNotMatch(prompt, /capability: unavailable|contract: unavailable|Immutable reviewed action: none/);
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
    reviewOutput: { mode: 'scope', scopeField: 'scope', commands: ['atcs_size_cell', 'atcs_undo'], maxMutations: 40 } }));
  assert.match(reviewer, /Set scope to \{commands,maxMutations\}/);
  assert.match(reviewer, /chosen from atcs_size_cell, atcs_undo, and maxMutations from 1 to 40/);
  const planSha256 = 'b'.repeat(64);
  const operator = delegationTaskPrompt(contract, effective({ inlinePayload: { mode: 'scope', sourceResultRecordId: 'run-1#000002',
    adoptionRecordId: 'run-1#000003', planSha256, planHashArgument: 'planSha256',
    scope: { commands: ['atcs_size_cell'], maxMutations: 3 } } }));
  assert.match(operator, new RegExp(`carries planSha256 = ${planSha256}; at most 3 are admitted`));
});
