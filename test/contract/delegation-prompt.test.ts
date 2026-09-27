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
        required: ['schema', 'hypotheses', 'evidenceRefs', 'limitations'] } },
  } as never;
  const prompt = delegationTaskPrompt(contract, effective);
  assert.match(prompt, /return exactly one JSON object and no prose or Markdown/);
  assert.match(prompt, /Set schema to "xtop-timing-research\/1"/);
  assert.match(prompt, /top-level fields: schema, hypotheses, evidenceRefs, limitations\./);
});
